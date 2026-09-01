import type { ThinkFleetMemory } from '../client.js'
import { MemoryMiddleware, type MemoryMiddlewareOptions } from './memory-middleware.js'
import { hasMethodAt, proxyPath } from './proxy.js'

export { MemoryMiddleware, type MemoryMiddlewareOptions } from './memory-middleware.js'
export { normalizeMessages, lastHumanTurn } from './messages.js'

const OPENAI_PATH = ['chat', 'completions', 'create']
const ANTHROPIC_PATH = ['messages', 'create']

/** Pull the assistant's text out of an OpenAI chat completion. */
function openAiText(result: unknown): string | undefined {
  const choices = (result as { choices?: Array<{ message?: { content?: unknown } }> })?.choices
  const content = choices?.[0]?.message?.content
  return typeof content === 'string' && content.length > 0 ? content : undefined
}

/** Pull the assistant's text out of an Anthropic message. */
function anthropicText(result: unknown): string | undefined {
  const content = (result as { content?: Array<{ type?: string, text?: string }> })?.content
  if (!Array.isArray(content)) return undefined
  const text = content
    .filter((p) => p?.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text as string)
    .join('\n')
    .trim()
  return text.length > 0 ? text : undefined
}

/**
 * A streaming call returns an async iterator, not a message. Injection still
 * works (it happens before the call); capturing the assistant half does not,
 * because the text does not exist yet and consuming the stream to get it
 * would break the caller's stream.
 *
 * So streaming turns capture the USER half only, and say so here rather than
 * appearing to work. Capturing the assistant half of a stream needs a tee,
 * which belongs to the caller's code, not to a proxy.
 */
function isStreaming(params: unknown): boolean {
  return (params as { stream?: unknown })?.stream === true
}

/**
 * Wrap an OpenAI client so every `chat.completions.create` retrieves context
 * first and writes the turn back after.
 *
 * @example
 * ```ts
 * const openai = withOpenAI(new OpenAI(), mm, { subject: { kind: 'user', externalId: userId } })
 * // ...every existing call site is unchanged, and now has memory.
 * ```
 */
export function withOpenAI<T extends object>(
  client: T,
  mm: ThinkFleetMemory,
  options: MemoryMiddlewareOptions = {},
): T {
  const mw = new MemoryMiddleware(mm, options)
  return proxyPath(client, OPENAI_PATH, (create) => async (params: any, ...rest: any[]) => {
    const messages = Array.isArray(params?.messages) ? params.messages : []
    const prepared = await mw.withContext(messages)
    const result = await create({ ...params, messages: prepared }, ...rest)
    await mw.capture(messages, isStreaming(params) ? undefined : openAiText(result))
    return result
  })
}

/**
 * Wrap an Anthropic client so every `messages.create` retrieves context first
 * and writes the turn back after.
 *
 * Anthropic carries the system prompt in its own top-level `system` field
 * rather than as a message, so the context block is appended THERE — a
 * `{role:'system'}` entry in `messages` is rejected by the API.
 */
export function withAnthropic<T extends object>(
  client: T,
  mm: ThinkFleetMemory,
  options: MemoryMiddlewareOptions = {},
): T {
  const mw = new MemoryMiddleware(mm, options)
  return proxyPath(client, ANTHROPIC_PATH, (create) => async (params: any, ...rest: any[]) => {
    const messages = Array.isArray(params?.messages) ? params.messages : []
    const bundle = await mw.context(messages)

    let next = params
    if (bundle != null) {
      const block = mw.block(bundle)
      // Append after the caller's own system prompt, never before it: their
      // system prompt is their product, and memory is context, not policy.
      const system = typeof params?.system === 'string' && params.system.length > 0
        ? `${params.system}\n\n${block}`
        : block
      next = { ...params, system }
    }

    const result = await create(next, ...rest)
    await mw.capture(messages, isStreaming(params) ? undefined : anthropicText(result))
    return result
  })
}

/**
 * Middleware for the Vercel AI SDK's `wrapLanguageModel`.
 *
 * @example
 * ```ts
 * const model = wrapLanguageModel({
 *   model: openai('gpt-4o'),
 *   middleware: memoryMiddleware(mm, { subject }),
 * })
 * ```
 *
 * Implemented as `transformParams` only. The AI SDK calls it before every
 * generate AND every stream, which is exactly the injection point; it is not
 * a capture point, so capture rides the same hook off the incoming prompt
 * (the user half is fully present there). The assistant half needs `onFinish`
 * in the caller's own `streamText`/`generateText` call, which is where the
 * completed text actually lands — see the README.
 */
export function memoryMiddleware(
  mm: ThinkFleetMemory,
  options: MemoryMiddlewareOptions = {},
): { transformParams: (opts: { params: any }) => Promise<any> } {
  const mw = new MemoryMiddleware(mm, options)
  return {
    async transformParams({ params }: { params: any }) {
      const prompt = Array.isArray(params?.prompt) ? params.prompt : []
      const prepared = await mw.withContext(prompt)
      await mw.capture(prompt)
      return { ...params, prompt: prepared }
    },
  }
}

/**
 * Detect which client this is and wrap it.
 *
 * Shape detection rather than `instanceof`, so the SDK takes no dependency on
 * any provider package — a hard dependency on three provider SDKs to support
 * three provider SDKs is how an integration layer becomes unusable to
 * everyone using the fourth.
 */
export function withMemory<T extends object>(
  client: T,
  mm: ThinkFleetMemory,
  options: MemoryMiddlewareOptions = {},
): T {
  if (hasMethodAt(client, OPENAI_PATH)) return withOpenAI(client, mm, options)
  if (hasMethodAt(client, ANTHROPIC_PATH)) return withAnthropic(client, mm, options)
  throw new Error(
    'withMemory: unrecognised client. Expected an OpenAI-shaped client '
    + '(chat.completions.create) or an Anthropic-shaped one (messages.create). '
    + 'For the Vercel AI SDK use memoryMiddleware() with wrapLanguageModel(); '
    + 'for anything else use the MemoryMiddleware class directly.',
  )
}
