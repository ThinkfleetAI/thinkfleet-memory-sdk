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
export THINKFLEET_BASE_URL="https://memory.thinkfleet.ai"   # optional
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
