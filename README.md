# @memmesh/sdk

TypeScript SDK for [app.memmesh.ai](https://app.memmesh.ai) — a managed memory + behavioral-pattern engine for AI agents.

Two resources:
- **`memory`** — admin + project memory CRUD, semantic search, promote/confirm/reject workflow, feedback
- **`lattice`** — behavioral pattern intelligence (extract, monitor, retrieve, search, observe)

Runs anywhere with a modern `fetch`: Node 18+, Bun, Deno, browsers, Cloudflare Workers.

---

## Install

```bash
npm install @memmesh/sdk
# or: pnpm add @memmesh/sdk
# or: bun add @memmesh/sdk
```

## Quick start

```ts
import { MemMesh } from '@memmesh/sdk'
// `ThinkFleetMemory` is the legacy alias — still exported for back-compat.

const tf = new MemMesh({
  apiKey: 'sk-...',           // Platform Admin → API Keys
  projectId: 'proj_...',      // Default project for all calls
})

// Dashboard stats
const stats = await tf.memory.admin.stats()
console.log(`${stats.total} memories, ${stats.pendingReview} pending review`)

// Seed a memory the agent should know
await tf.memory.admin.create({
  content: 'Customer prefers email over phone.',
  type: 'preference',
  scope: 'project',
})

// Semantic search
const hits = await tf.memory.admin.search({
  query: 'communication preferences',
  limit: 5,
})
```

---

## Configuration

```ts
const tf = new MemMesh({
  apiKey: 'sk-...',                              // Required
  projectId: 'proj_...',                         // Required default
  baseUrl: 'https://app.memmesh.ai',       // Default
  maxRetries: 2,                                 // Retries 429/5xx with backoff
  timeout: 30_000,                               // ms
  fetch: globalThis.fetch,                       // BYO fetch
  requestInterceptors:  [...],                   // Mutate RequestInit before send
  responseInterceptors: [...],                   // Inspect Response before JSON parse
})
```

### Per-request project override

```ts
await tf.memory.admin.list({ scope: 'project' }, { projectId: 'proj_other' })
```

### Cognito JWT instead of API key

Pass a request interceptor that swaps the `Authorization` header on each call:

```ts
const tf = new MemMesh({
  apiKey: 'unused',  // still required to be non-empty, but interceptor wins
  projectId: 'proj_...',
  requestInterceptors: [
    async (_url, init) => {
      const jwt = await getCognitoJwt()
      return {
        ...init,
        headers: {
          ...(init.headers as Record<string, string>),
          Authorization: `Bearer ${jwt}`,
        },
      }
    },
  ],
})
```

---

## Resources

### `tf.memory` — current-user memories

| Method                    | Endpoint                              |
| ------------------------- | ------------------------------------- |
| `observe(body)`           | `POST   /projects/:id/memory/observe` |
| `mine(params?)`           | `GET    /projects/:id/memory/mine`    |
| `delete(memoryId)`        | `DELETE /projects/:id/memory/:memId`  |
| `submitFeedback(body)`    | `POST   /projects/:id/memory/feedback`|

`observe()` is the primary write path. Hand it the raw turn, **verbatim** — the
engine runs extraction, dedupe, graph wiring, and embedding, and keeps only what
is worth remembering. Do not summarize or pre-filter first: extraction is the
thing you are paying for, and a pre-digested input makes it worse, not cheaper.

```ts
const { saved, candidateCount } = await tf.memory.observe({
  text: "I just moved to Denver and I'm still vegetarian.",
  role: 'user',
  userId: 'user-123',      // your identifier, recorded as provenance
  sessionId: 'thread-456', // keeps a conversation's turns linkable
})
```

`candidateCount` is what extraction proposed; `saved` is what survived dedupe and
the token budget. Filler comes back as `saved: []` — that is the system working.

`userId` is provenance, **not** a tenancy boundary: `admin.search({ chatIdentityId })`
filters permissively (`IS NULL OR = $1`) so project-wide memories stay visible to
every caller. Isolating one end user's memories from another's needs a project
per tenant.

### `tf.memory.admin` — admin / project-wide memory

| Method                                      | Endpoint                                          |
| ------------------------------------------- | ------------------------------------------------- |
| `list(params?)`                             | `GET    /projects/:id/admin/memory`               |
| `listPlatform(params?)`                     | `GET    /projects/:id/admin/memory/platform`      |
| `listPendingReview(params?)`                | `GET    /projects/:id/admin/memory/review`        |
| `stats()`                                   | `GET    /projects/:id/admin/memory/stats`         |
| `create(body)`                              | `POST   /projects/:id/admin/memory`               |
| `createProcedure(body)`                     | `POST   /projects/:id/admin/memory` (type=procedure)|
| `update(memId, body)`                       | `PATCH  /projects/:id/admin/memory/:memId`        |
| `confirm(memId, body)`                      | `POST   /projects/:id/admin/memory/:memId/confirm`|
| `promote(memId, body)`                      | `POST   /projects/:id/admin/memory/:memId/promote`|
| `search(body)`                              | `POST   /projects/:id/admin/memory/search`        |
| `getPrecedence()`                           | `GET    /projects/:id/admin/memory/precedence`    |
| `setPrecedence(policy)`                     | `PUT    /projects/:id/admin/memory/precedence`    |
| `delete(memId)`                             | `DELETE /projects/:id/admin/memory/:memId`        |
| `listFeedback(memId)`                       | `GET    /projects/:id/admin/memory/:memId/feedback`|

### `tf.memory.admin.graph` — the knowledge graph

Observing text doesn't only produce embeddable rows; extraction also resolves
entities and writes typed edges between them. That graph is what answers a
question no single memory states outright.

| Method                          | Endpoint                                            |
| ------------------------------- | --------------------------------------------------- |
| `stats()`                       | `GET  /projects/:id/admin/memory/graph/stats`        |
| `listEntities(params?)`         | `GET  /projects/:id/admin/memory/entities`           |
| `getEntity(entityId, params?)`  | `GET  /projects/:id/admin/memory/entities/:entityId` |
| `listEdges(params?)`            | `GET  /projects/:id/admin/memory/graph/edges`        |
| `traverse(entityId, params?)`   | `POST /projects/:id/admin/memory/graph/traverse`     |

```ts
// How much of what you remember made it into the graph?
const { entityCount, edgeCount, memoriesWithEdges } = await tf.memory.admin.graph.stats()

// Multi-hop: who does Sarah ultimately report to?
const [sarah] = await tf.memory.admin.graph.listEntities({ search: 'Sarah', limit: 1 })
const chain = await tf.memory.admin.graph.traverse(sarah.id, {
  hops: 2,
  predicates: ['member_of', 'led_by'],
})
```

Use `stats()` — not `listEntities().length` — for any "how big is it" question:
the list routes page, so their length is the page size, not the total.

Read-only by design. Entities and edges are written by extraction when you
`observe()`; a hand-maintained graph is the work the engine exists to do for you.

### `tf.lattice` — behavioral patterns

| Method                              | Endpoint                                              |
| ----------------------------------- | ----------------------------------------------------- |
| `extractPatterns(body?)`            | `POST /projects/:id/lattice/patterns/extract`         |
| `getPattern(patternId)`             | `GET  /projects/:id/lattice/patterns/:patternId`      |
| `listPatterns(contactId, params?)`  | `GET  /projects/:id/lattice/contacts/:cid/patterns`   |
| `getContext(contactId, params?)`    | `GET  /projects/:id/lattice/contacts/:cid/context`    |
| `runMonitorTick()`                  | `POST /projects/:id/lattice/monitor/tick`             |
| `getMonitorStatus()`                | `GET  /projects/:id/lattice/monitor/status`           |

### `tf.brains` — marketplace registry

Register, version, and manage the brains a project publishes (a brain = a Brain
Card manifest + a stable `externalId` slug). Once a brain is `PUBLISHED` +
`PUBLIC`, any caller consumes it over the hosted MCP endpoint
(`/brains/:brainId/mcp-server/http`) — an MCP connection, not a REST call, so it
lives outside this resource.

| Method                     | Endpoint                                  |
| -------------------------- | ----------------------------------------- |
| `create(body)`             | `POST   /projects/:id/brains`             |
| `list(params?)`            | `GET    /projects/:id/brains`             |
| `get(brainId)`             | `GET    /projects/:id/brains/:brainId`    |
| `update(brainId, body)`    | `PATCH  /projects/:id/brains/:brainId`    |
| `delete(brainId)`          | `DELETE /projects/:id/brains/:brainId`    |

```ts
const brain = await tf.brains.create({
  externalId: 'sec-edgar-financials',
  name: 'SEC EDGAR Financials',
  domain: 'finance',
  card: { provenance: [{ source: 'SEC EDGAR', license: 'public-domain' }] },
})
await tf.brains.update(brain.id, { visibility: 'PUBLIC', status: 'PUBLISHED' })

const page = await tf.brains.list({ limit: 20 })
for (const b of page.data) console.log(b.externalId, b.status)
```

---

## Predict anything (v2)

Don't pick a model. Declare *what* to predict — a churn event, a next-order
amount, a next-visit time, an anomaly — and the engine predicts it from the
subject's history, **calibrated, with provenance, and abstaining when there
isn't enough signal**.

```ts
const p = await tf.lattice.predictTarget(
  { kind: 'customer', externalId: 'acct-42' },
  { kind: 'event_occurrence', eventType: 'subscription_cancelled' },
  { horizonDays: 90 },
)

if (p.abstained) {
  // The whole trust story: "unknown" is a first-class answer. Never treat an
  // abstention as low risk.
  console.log('not enough signal —', p.abstentionReason)
} else {
  console.log(`churn risk ${(p.probability * 100).toFixed(0)}% `
    + `[${(p.probabilityLower * 100).toFixed(0)}–${(p.probabilityUpper * 100).toFixed(0)}%]`)
  console.log('why:', p.explanation, '| evidence:', p.evidenceMemoryIds)
}
```

`target.kind` is one of `event_occurrence` | `numeric` | `event_time` |
`anomaly`, and the kind selects the result fields (`probability*` / `value*` /
`expectedAt*` / `anomalyScore`). A target is just a question — adding a row to
your registry adds a prediction, with no SDK or engine change. That's how a
whole vertical (Shopify churn, health risk, fraud) is one registry over one
engine.

See [`examples/predict-anything.ts`](examples/predict-anything.ts) for all four
kinds end-to-end. The lower-level `tf.lattice.predict({ subject, target })`
returns the full `PredictResult` (`targetPrediction` + top-level `abstained`).

---

## Memory scopes

```ts
import { MemoryScope } from '@memmesh/sdk'

MemoryScope.PLATFORM   // visible to every project on the platform
MemoryScope.PROJECT    // visible to every user in this project
MemoryScope.AGENT      // tied to a specific chatbotId
MemoryScope.USER       // tied to a specific chatIdentityId
MemoryScope.SESSION    // tied to a specific sessionKey
```

## Error handling

All non-2xx responses throw a typed error. Catch the base type or the specific one:

```ts
import {
  ThinkFleetMemoryError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ValidationError,
  RateLimitError,
  ServerError,
  TimeoutError,
} from '@memmesh/sdk'

try {
  await tf.memory.admin.create({ content: '' })
} catch (err) {
  if (err instanceof ValidationError) {
    console.error('Bad request:', err.message, err.params)
  } else if (err instanceof RateLimitError) {
    console.warn('Throttled; retry after', err.retryAfterMs, 'ms')
  } else if (err instanceof ThinkFleetMemoryError) {
    console.error('API error:', err.code, err.statusCode, err.message)
  } else {
    throw err
  }
}
```

---

## License

MIT
