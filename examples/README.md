# Examples

## `financial-demo.ts` — financial vertical, end to end

A runnable sample app that pulls **real data from public, no-API-key sources**,
loads it into ThinkFleet memory, and reads the financial vertical back out.

| Step | What it does | Source |
|------|--------------|--------|
| Pull | Daily price history | Yahoo Finance chart endpoint, JSON (no key) |
| Pull | Recent headlines | Yahoo Finance RSS (no key) |
| Ingest | `tf.financial.ingestPrices` / `ingestNews` / `ingestHolding` | — |
| Read | Indicators + portfolio risk | `tf.financial.getProfile` |
| Read | Calibrated buy/sell/hold calls | `tf.financial.predict` |
| Read | Score due calls + calibration curve | `tf.financial.reconcile` / `getCalibration` |

### Run it

```bash
# Data-pull half only — no credentials needed (proves the public feeds work):
npx tsx examples/financial-demo.ts --fetch-only

# Full end-to-end (needs a project with @thinkfleet/pack-financial enabled):
export THINKFLEET_API_KEY="sk-..."
export THINKFLEET_PROJECT_ID="..."
export THINKFLEET_BASE_URL="https://app.memmesh.ai"   # optional
export DEMO_TICKERS="AAPL,MSFT,NVDA"                        # optional
npm run demo:financial
```

### Notes

- **The engine owns the analysis; this app only maps data in and uses what
  comes out.** That's the intended division of responsibility — your system
  decides where data originates (here: Yahoo Finance) and what to do with the
  results.
- On a **first run**, predictions are made "now" with a 30-day horizon, so
  `reconcile` scores 0 and the calibration curve is empty. Run `reconcile` on a
  schedule (e.g. daily); the curve fills in as calls mature, and that feedback
  is what tunes reported confidence over time.
- **Informational only — not investment advice.** Yahoo Finance data is
  provided as-is for demonstration.

## `next-best-offer.ts` — which offer, when, and how it learns

A runnable sample for the lifecycle question: **which offer is right for a
contact, when should it go out, and how does the system get better each time an
offer lands?** The engine owns memory, pattern-mining, prediction, and
calibration; **Claude** (`claude-opus-4-8`) owns the judgement call (which offer,
when); this app is the glue.

| Step | What it does | Calls |
|------|--------------|-------|
| Learn | Ingest each contact's activity, mine behavior patterns | `tf.memory.observe` → `tf.lattice.mineMemories` |
| Understand | Read who the subject is + what they'll do next (the send-time signal) | `tf.lattice.getProfile` / `tf.lattice.predict` |
| Decide | Claude picks the offer + send time, grounded in the signal AND what has worked | `tf.learning.getEffectiveness` → Claude (`messages.parse`) → `tf.learning.recordDecision` |
| For a list | Rank a set of contacts by confidence / soonest send | loop the above |
| Act + learn | Record the realized outcome; every informing pattern is re-calibrated | `tf.learning.recordOutcome` → `tf.learning.getEffectiveness` |

The decision records `informedBy` the patterns/predictions it leaned on, so when
the outcome comes in, **those** patterns' calibrated confidence moves — that's
the closed loop. Run it twice: the second Decide step sees the first run's
effectiveness and shifts toward what actually converted.

### Run it

```bash
npm install   # pulls @anthropic-ai/sdk + zod (dev deps for this example)

export THINKFLEET_API_KEY="sk-..."
export THINKFLEET_PROJECT_ID="..."
export ANTHROPIC_API_KEY="sk-ant-..."
export THINKFLEET_BASE_URL="https://app.memmesh.ai"   # optional
npm run demo:nbo
```

### Notes

- **Domain stays in your app.** The engine never sees "offer" — the loop records
  the generic `action_type="send_offer"` with the chosen offer id as the
  `decision_type`, so `getEffectiveness({ groupBy: 'decision_type' })` rolls up
  per offer. Nothing consumer-specific leaks into the engine.
- **Cold start is honest.** On the first run there's no outcome history, so
  Claude reasons from the profile + predictions; effectiveness fills in as
  outcomes accumulate and steers later runs.
- **Flobyte pieces** (Activepieces) can drive the same loop as a no-code flow —
  the `recordDecision` / `recordOutcome` / `getEffectiveness` REST routes are the
  same ones this SDK calls. This example is the code-first version of that flow.
