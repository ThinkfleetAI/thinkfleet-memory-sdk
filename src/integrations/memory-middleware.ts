import type { ThinkFleetMemory } from '../client.js'
import type { ConversationContextBundle, ConversationTurn } from '../resources/context.js'
import { lastHumanTurn, normalizeMessages } from './messages.js'

/**
 * The provider-agnostic half of the integration layer.
 *
 * WHY THIS EXISTS
 *
 * Before it, every integrator wrote the same forty lines: pull a query out of
 * the conversation, call search, decide how much fits, prepend a system
 * message, and remember to write the turn back. Memory quality therefore
 * varied with how well each of them wrote those forty lines, and the most
 * common version of them was "nothing" — which is why a real deployment can
 * hold 182k memories and 98 subjects. An SDK that only exposes the API has
 * handed the hard part to the caller.
 *
 * WHAT IT GUARANTEES
 *
 * Memory NEVER breaks the host's turn. Every call in here is wrapped: a
 * memory outage, a timeout, a 500, a malformed response all degrade to "no
 * context this turn" and the model runs exactly as it would have without any
 * of this. That is not defensive coding, it is the contract — the moment
 * adding memory can take an app down, nobody leaves it switched on.
 */

export interface MemoryMiddlewareOptions {
  /**
   * WHO the conversation is about. Strongly recommended: without it the
   * server infers a subject from the turn, which is right most of the time
   * and is still a guess. Passing it makes every memory this writes reachable
   * by prediction, profiling and cohorting.
   */
  subject?: { kind: string, externalId: string }
  /** Groups turns into one session for later session-level extraction. */
  sessionId?: string
  /** Who is SPEAKING (distinct from `subject`, who it is ABOUT). */
  userId?: string
  agentId?: string
  /** Max tokens of memory injected per turn. Default 1200. */
  tokenBudget?: number
  /** Candidate pool before budgeting. Default 25. */
  limit?: number
  /** Withhold these categories from retrieval on this surface. */
  excludeCategories?: string[]
  /** Required when the conversation is consuming a published brain. */
  brainId?: string
  /** Inject retrieved context into the prompt. Default true. */
  inject?: boolean
  /** Write the conversation back to memory. Default true. */
  capture?: boolean
  /**
   * Await the capture write before returning the model's response.
   *
   * Default TRUE, which costs the turn one round trip. Set false only if you
   * are certain your runtime survives a floating promise — a serverless
   * function that freezes on response return will silently drop every write,
   * which looks exactly like memory not working and is invisible in logs.
   */
  awaitCapture?: boolean
  /**
   * How the context block is worded when injected. The default names memory
   * as the source, which measurably matters: a model handed unattributed
   * facts treats them as its own assumptions and will defend them, where one
   * told they came from a memory store will say "your saved preference is X,
   * is that still right?" — which is the behaviour you want when a stored
   * fact has gone stale.
   */
  systemPreamble?: string
  /** Called on any memory-side failure. Default: console.warn once per phase. */
  onError?: (error: unknown, phase: 'context' | 'capture') => void
}

const DEFAULT_PREAMBLE =
  'The following facts come from the user\'s persistent memory store. '
  + 'Treat them as background you already know, and say so if you rely on one. '
  + 'If something here conflicts with what the user says now, the user is right — '
  + 'prefer the live turn and note the discrepancy.'

export class MemoryMiddleware {
  private warned = new Set<string>()

  constructor(
    private readonly mm: ThinkFleetMemory,
    private readonly options: MemoryMiddlewareOptions = {},
  ) {}

  private fail(error: unknown, phase: 'context' | 'capture'): void {
    if (this.options.onError) {
      this.options.onError(error, phase)
      return
    }
    // Warn ONCE per phase. A broken key on a chat surface would otherwise
    // print on every keystroke and get muted wholesale, taking the useful
    // first warning with it.
    if (this.warned.has(phase)) return
    this.warned.add(phase)
    console.warn(`[memmesh] ${phase} failed; continuing without memory.`, error)
  }

  /**
   * Retrieve the context bundle for a conversation. Returns null on any
   * failure and on "nothing relevant", which the caller treats identically.
   */
  async context(messages: unknown, intent?: string): Promise<ConversationContextBundle | null> {
    if (this.options.inject === false) return null
    const turns = normalizeMessages(messages)
    if (turns.length === 0) return null
    try {
      const bundle = await this.mm.context.forConversation({
        turns,
        intent,
        tokenBudget: this.options.tokenBudget,
        limit: this.options.limit,
        excludeCategories: this.options.excludeCategories,
        brainId: this.options.brainId,
      })
      return bundle.context ? bundle : null
    }
    catch (error) {
      this.fail(error, 'context')
      return null
    }
  }

  /** The system-message text for a bundle, preamble included. */
  block(bundle: ConversationContextBundle): string {
    const preamble = this.options.systemPreamble ?? DEFAULT_PREAMBLE
    return `${preamble}\n\n${bundle.context}`
  }

  /**
   * Return a copy of `messages` with the context injected as a system turn.
   *
   * APPENDED after any existing system messages, not prepended: the host's own
   * system prompt is its product, and a memory block that lands above it reads
   * to the model as the higher-priority instruction. Memory is context, not
   * policy.
   */
  async withContext<T extends unknown[]>(messages: T, intent?: string): Promise<T> {
    const bundle = await this.context(messages, intent)
    if (bundle == null) return messages
    const injected = [...messages] as unknown[]
    let insertAt = 0
    while (
      insertAt < injected.length
      && (injected[insertAt] as { role?: string })?.role === 'system'
    ) insertAt++
    injected.splice(insertAt, 0, { role: 'system', content: this.block(bundle) })
    return injected as T
  }

  /**
   * Write the turn back to memory.
   *
   * Sends BOTH sides when an assistant reply is supplied. A store that holds
   * only the user's half records questions without answers — "asked about the
   * refund policy" with no trace of what they were told — which is the half
   * that later turns actually need.
   */
  async capture(messages: unknown, assistantText?: string): Promise<void> {
    if (this.options.capture === false) return
    const turns = normalizeMessages(messages)
    const human = lastHumanTurn(turns)
    if (human == null && !assistantText) return

    const text = [
      human ? human.content : null,
      assistantText ? `assistant: ${assistantText}` : null,
    ].filter(Boolean).join('\n')
    if (text.trim().length === 0) return

    const write = this.mm.memory.observe({
      text,
      role: 'user',
      userId: this.options.userId,
      agentId: this.options.agentId,
      sessionId: this.options.sessionId,
      subject: this.options.subject,
    }).then(() => undefined).catch((error: unknown) => this.fail(error, 'capture'))

    if (this.options.awaitCapture === false) {
      // Explicitly opted out of durability. Attach the handler anyway so the
      // rejection is reported rather than becoming an unhandled rejection.
      void write
      return
    }
    await write
  }

  /** One call for the common case: inject, run, capture. */
  async run<T>(
    messages: ConversationTurn[] | unknown[],
    call: (messages: unknown[]) => Promise<T>,
    extract: (result: T) => string | undefined,
    intent?: string,
  ): Promise<T> {
    const prepared = await this.withContext(messages as unknown[], intent)
    const result = await call(prepared)
    await this.capture(messages, extract(result))
    return result
  }
}
