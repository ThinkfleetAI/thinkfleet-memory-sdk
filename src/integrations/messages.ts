import type { ConversationTurn } from '../resources/context.js'

/**
 * Normalise the message shapes the major chat SDKs use into plain turns.
 *
 * Every provider has converged on `{role, content}` and then diverged on what
 * `content` is: a string (OpenAI's simple form, Anthropic's simple form), an
 * array of typed parts (OpenAI vision, Anthropic tool use, the Vercel AI
 * SDK's prompt format), or a mix within one conversation. Memory only ever
 * wants the text, so this flattens parts and drops everything it does not
 * understand rather than throwing — an unrecognised content part is a reason
 * to have slightly less context, never a reason to fail the caller's turn.
 */

type UnknownPart = { type?: string, text?: string, content?: unknown }

function partToText(part: unknown): string {
  if (typeof part === 'string') return part
  if (part == null || typeof part !== 'object') return ''
  const p = part as UnknownPart
  // OpenAI: {type:'text', text}. Anthropic: {type:'text', text}.
  // Vercel AI SDK: {type:'text', text}. Tool calls/images have no text and
  // deliberately contribute nothing.
  if (typeof p.text === 'string') return p.text
  if (typeof p.content === 'string') return p.content
  return ''
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map(partToText).filter((t) => t.length > 0).join('\n')
  }
  return partToText(content)
}

export function normalizeMessages(messages: unknown): ConversationTurn[] {
  if (!Array.isArray(messages)) return []
  const turns: ConversationTurn[] = []
  for (const m of messages) {
    if (m == null || typeof m !== 'object') continue
    const msg = m as { role?: unknown, content?: unknown }
    const content = contentToText(msg.content).trim()
    if (content.length === 0) continue
    turns.push({
      role: typeof msg.role === 'string' ? msg.role : undefined,
      content,
    })
  }
  return turns
}

/** The most recent turn written by a person, which is what memory captures. */
export function lastHumanTurn(turns: ConversationTurn[]): ConversationTurn | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const role = (turns[i].role ?? 'user').toLowerCase()
    if (role !== 'assistant' && role !== 'system' && role !== 'tool') return turns[i]
  }
  return null
}
