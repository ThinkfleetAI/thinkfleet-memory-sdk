/**
 * Runnable checks for the integration layer: `npm run test:integrations`.
 *
 * These run against FAKE provider clients rather than the real SDKs, on
 * purpose — the things most likely to break here are the proxy mechanics and
 * the failure contract, and both are testable without a network.
 *
 * The private-field client below is the important one. Provider SDKs use real
 * `#private` fields, and the natural proxy implementation (return methods
 * unbound, or pass the proxy as the Reflect.get receiver) throws on them at
 * runtime while typechecking perfectly.
 */
import assert from 'node:assert/strict'

import { withAnthropic, withMemory, withOpenAI, MemoryMiddleware, normalizeMessages } from '../src/integrations/index.js'

let failures = 0
async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn()
    console.log(`  ok  ${name}`)
  }
  catch (err) {
    failures++
    console.error(`FAIL  ${name}`)
    console.error(err)
  }
}

/** Records what the middleware asked memory for, and what it wrote back. */
function fakeMemory(overrides: { context?: string | null, throwOn?: 'context' | 'capture' } = {}) {
  const calls = { context: [] as any[], observe: [] as any[] }
  return {
    calls,
    client: {
      context: {
        async forConversation(body: any) {
          calls.context.push(body)
          if (overrides.throwOn === 'context') throw new Error('memory down')
          const context = overrides.context === undefined ? 'user prefers Postgres' : overrides.context
          return {
            context,
            subject: null,
            memoryIds: context ? ['m1'] : [],
            tokensEstimate: 12,
            tokenBudget: 1200,
            droppedForBudget: 0,
            query: 'q',
          }
        },
      },
      memory: {
        async observe(body: any) {
          calls.observe.push(body)
          if (overrides.throwOn === 'capture') throw new Error('memory down')
          return { saved: [], candidateCount: 0 }
        },
      },
    } as any,
  }
}

/** An OpenAI-shaped client using a real #private field, like the real one. */
class FakeOpenAI {
  #instanceLabel = 'inner-state'
  lastParams: any = null
  chat = {
    completions: {
      create: async (params: any) => {
        // Touching a #private field is what breaks under a naive proxy.
        void openAiSelf!.label()
        openAiSelf!.lastParams = params
        return { choices: [{ message: { content: 'the answer' } }] }
      },
    },
  }
  label(): string { return this.#instanceLabel }
}
let openAiSelf: FakeOpenAI | null = null

class FakeAnthropic {
  lastParams: any = null
  messages = {
    create: async (params: any) => {
      anthropicSelf!.lastParams = params
      return { content: [{ type: 'text', text: 'the answer' }] }
    },
  }
}
let anthropicSelf: FakeAnthropic | null = null

async function main(): Promise<void> {
  console.log('integrations')

  await test('withOpenAI injects context as a system message and captures both halves', async () => {
    const mem = fakeMemory()
    const raw = new FakeOpenAI()
    openAiSelf = raw
    const client = withOpenAI(raw, mem.client, { subject: { kind: 'user', externalId: 'u1' } })

    const messages = [{ role: 'user', content: 'which database should I use?' }]
    const result: any = await (client as any).chat.completions.create({ model: 'gpt-4o', messages })

    assert.equal(result.choices[0].message.content, 'the answer')
    const sent = raw.lastParams.messages
    assert.equal(sent.length, 2, 'a system message should have been inserted')
    assert.equal(sent[0].role, 'system')
    assert.ok(sent[0].content.includes('user prefers Postgres'))
    // The caller's own array must not be mutated.
    assert.equal(messages.length, 1)
    // Capture sends the user turn AND the assistant reply.
    assert.equal(mem.calls.observe.length, 1)
    assert.ok(mem.calls.observe[0].text.includes('which database'))
    assert.ok(mem.calls.observe[0].text.includes('the answer'))
    assert.deepEqual(mem.calls.observe[0].subject, { kind: 'user', externalId: 'u1' })
  })

  await test('the proxy does not break #private field access', async () => {
    const mem = fakeMemory()
    const raw = new FakeOpenAI()
    openAiSelf = raw
    const client = withOpenAI(raw, mem.client, {})
    // Throws "Cannot read private member" if the method is invoked with the
    // proxy as `this` instead of the real instance.
    await (client as any).chat.completions.create({ messages: [{ role: 'user', content: 'hi' }] })
    assert.equal((client as any).label(), 'inner-state')
  })

  await test('a memory outage never breaks the model call', async () => {
    const mem = fakeMemory({ throwOn: 'context' })
    const raw = new FakeOpenAI()
    openAiSelf = raw
    const errors: string[] = []
    const client = withOpenAI(raw, mem.client, { onError: (_e, phase) => errors.push(phase) })

    const result: any = await (client as any).chat.completions.create({
      messages: [{ role: 'user', content: 'hi' }],
    })
    assert.equal(result.choices[0].message.content, 'the answer')
    assert.deepEqual(raw.lastParams.messages, [{ role: 'user', content: 'hi' }], 'no context injected')
    assert.ok(errors.includes('context'))
  })

  await test('a capture failure is reported, not thrown', async () => {
    const mem = fakeMemory({ throwOn: 'capture' })
    const raw = new FakeOpenAI()
    openAiSelf = raw
    const errors: string[] = []
    const client = withOpenAI(raw, mem.client, { onError: (_e, phase) => errors.push(phase) })
    await (client as any).chat.completions.create({ messages: [{ role: 'user', content: 'hi' }] })
    assert.ok(errors.includes('capture'))
  })

  await test('nothing relevant means the prompt is left exactly as it was', async () => {
    const mem = fakeMemory({ context: null })
    const raw = new FakeOpenAI()
    openAiSelf = raw
    const client = withOpenAI(raw, mem.client, {})
    await (client as any).chat.completions.create({ messages: [{ role: 'user', content: 'hi' }] })
    assert.equal(raw.lastParams.messages.length, 1)
  })

  await test('context lands AFTER the caller\'s own system prompt, never before', async () => {
    const mem = fakeMemory()
    const raw = new FakeOpenAI()
    openAiSelf = raw
    const client = withOpenAI(raw, mem.client, {})
    await (client as any).chat.completions.create({
      messages: [
        { role: 'system', content: 'YOU ARE ACME SUPPORT' },
        { role: 'user', content: 'hi' },
      ],
    })
    const sent = raw.lastParams.messages
    assert.equal(sent[0].content, 'YOU ARE ACME SUPPORT', 'the host system prompt must stay first')
    assert.ok(sent[1].content.includes('user prefers Postgres'))
  })

  await test('withAnthropic appends to `system`, not to `messages`', async () => {
    const mem = fakeMemory()
    const raw = new FakeAnthropic()
    anthropicSelf = raw
    const client = withAnthropic(raw, mem.client, {})
    await (client as any).messages.create({
      model: 'claude-sonnet-5',
      system: 'YOU ARE ACME SUPPORT',
      messages: [{ role: 'user', content: 'hi' }],
    })
    // A {role:'system'} entry in `messages` is rejected by the Anthropic API.
    assert.equal(raw.lastParams.messages.length, 1)
    assert.ok(raw.lastParams.system.startsWith('YOU ARE ACME SUPPORT'))
    assert.ok(raw.lastParams.system.includes('user prefers Postgres'))
  })

  await test('streaming injects but does not fabricate an assistant capture', async () => {
    const mem = fakeMemory()
    const raw = new FakeOpenAI()
    openAiSelf = raw
    const client = withOpenAI(raw, mem.client, {})
    await (client as any).chat.completions.create({
      stream: true,
      messages: [{ role: 'user', content: 'stream me' }],
    })
    assert.equal(raw.lastParams.messages.length, 2, 'injection still happens')
    assert.ok(mem.calls.observe[0].text.includes('stream me'))
    assert.ok(!mem.calls.observe[0].text.includes('assistant:'), 'no assistant half is invented')
  })

  await test('withMemory detects the client shape', async () => {
    const mem = fakeMemory()
    const oa = new FakeOpenAI()
    openAiSelf = oa
    assert.doesNotThrow(() => withMemory(oa, mem.client, {}))
    const an = new FakeAnthropic()
    anthropicSelf = an
    assert.doesNotThrow(() => withMemory(an, mem.client, {}))
    assert.throws(() => withMemory({} as any, mem.client, {}), /unrecognised client/)
  })

  await test('normalizeMessages flattens content parts and drops non-text', async () => {
    const turns = normalizeMessages([
      { role: 'user', content: 'plain' },
      { role: 'user', content: [{ type: 'text', text: 'part one' }, { type: 'image_url', image_url: {} }] },
      { role: 'assistant', content: [] },
      null,
    ])
    assert.deepEqual(turns, [
      { role: 'user', content: 'plain' },
      { role: 'user', content: 'part one' },
    ])
  })

  await test('MemoryMiddleware can be used directly for unsupported clients', async () => {
    const mem = fakeMemory()
    const mw = new MemoryMiddleware(mem.client, {})
    const prepared = await mw.withContext([{ role: 'user', content: 'hi' }])
    assert.equal(prepared.length, 2)
  })

  console.log(failures === 0 ? '\nall integration checks passed' : `\n${failures} failed`)
  process.exit(failures === 0 ? 0 : 1)
}

void main()
