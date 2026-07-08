#!/usr/bin/env npx tsx
/**
 * @thinkfleet/memory-sdk — financial vertical end-to-end demo
 *
 * A working sample app that pulls REAL data from public, no-API-key sources,
 * loads it into ThinkFleet memory, and reads the financial vertical back out:
 *
 *   1. Daily price history  ← Yahoo Finance chart endpoint (JSON, no key)
 *   2. Recent news          ← Yahoo Finance RSS (no key)
 *   3. ingest → memory      (tf.financial.ingestPrices / ingestNews / ingestHolding)
 *   4. read   → profile     (indicators + portfolio risk)
 *   5. read   → predict     (calibrated buy/sell/hold calls)
 *   6. read   → reconcile + calibration (the self-improving loop)
 *
 * The engine owns the analysis; this app only shows how an external system
 * maps its data in and uses what comes out. Informational only — not advice.
 *
 * Usage:
 *   export THINKFLEET_API_KEY="sk-..."
 *   export THINKFLEET_PROJECT_ID="..."          # must have @thinkfleet/pack-financial enabled
 *   export THINKFLEET_BASE_URL="https://app.memmesh.ai"   # optional
 *   export DEMO_TICKERS="AAPL,MSFT,NVDA"        # optional
 *   npx tsx examples/financial-demo.ts
 *
 * Tip: you can dry-run the data-pull half with no credentials:
 *   npx tsx examples/financial-demo.ts --fetch-only
 */

import { ThinkFleetMemory } from '../src/index.js'
import type { PriceInput, NewsInput } from '../src/index.js'

// ── Config ──────────────────────────────────────────────────────────

const FETCH_ONLY = process.argv.includes('--fetch-only')
const API_KEY = process.env.THINKFLEET_API_KEY
const PROJECT_ID = process.env.THINKFLEET_PROJECT_ID
const BASE_URL = process.env.THINKFLEET_BASE_URL ?? 'https://app.memmesh.ai'
const TICKERS = (process.env.DEMO_TICKERS ?? 'AAPL,MSFT,NVDA')
  .split(',')
  .map((t) => t.trim().toUpperCase())
  .filter(Boolean)
/** The engine's beta benchmark (financial::observation::BENCHMARK_TICKER). */
const BENCHMARK = 'SPY'
/** ~1 trading year of daily bars is plenty for SMA200 + stable indicators. */
const HISTORY_BARS = 260

if (!FETCH_ONLY && (!API_KEY || !PROJECT_ID)) {
  console.error('Missing required environment variables:')
  console.error('  THINKFLEET_API_KEY=sk-...')
  console.error('  THINKFLEET_PROJECT_ID=...   (project must have @thinkfleet/pack-financial enabled)')
  console.error('  THINKFLEET_BASE_URL=https://app.memmesh.ai   (optional)')
  console.error('\nOr run the data-pull half only:  npx tsx examples/financial-demo.ts --fetch-only')
  process.exit(1)
}

// ── Public data sources (no API key) ────────────────────────────────

/**
 * Daily close history from Yahoo Finance's public chart endpoint (JSON, no
 * key). Returns ~1 trading year of bars ascending by date. Some sessions can
 * have a null close (holidays/gaps) — those are skipped.
 */
async function fetchYahooDaily(ticker: string): Promise<PriceInput[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    ticker,
  )}?range=1y&interval=1d`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 thinkfleet-demo' } })
  if (!res.ok) throw new Error(`Yahoo chart ${ticker}: HTTP ${res.status}`)
  const json: any = await res.json()
  const result = json?.chart?.result?.[0]
  const timestamps: number[] | undefined = result?.timestamp
  const quote = result?.indicators?.quote?.[0]
  const closes: Array<number | null> | undefined = quote?.close
  const volumes: Array<number | null> | undefined = quote?.volume
  if (!timestamps?.length || !closes?.length) {
    throw new Error(`Yahoo chart ${ticker}: no data`)
  }
  const bars: PriceInput[] = []
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i]
    if (close == null || !Number.isFinite(close) || close <= 0) continue
    bars.push({
      ticker,
      close,
      currency: 'USD',
      volume: volumes?.[i] ?? undefined,
      asOf: new Date(timestamps[i] * 1000).toISOString(),
    })
  }
  return bars.slice(-HISTORY_BARS)
}

/**
 * Recent headlines from Yahoo Finance's per-ticker RSS feed. No sentiment is
 * supplied, so the engine scores each headline with its built-in lexicon.
 */
async function fetchYahooNews(ticker: string): Promise<NewsInput[]> {
  const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(
    ticker,
  )}&region=US&lang=en-US`
  const res = await fetch(url, { headers: { 'User-Agent': 'thinkfleet-demo' } })
  if (!res.ok) throw new Error(`Yahoo news ${ticker}: HTTP ${res.status}`)
  const xml = await res.text()
  const items: NewsInput[] = []
  for (const block of xml.split('<item>').slice(1)) {
    const headline = decodeXml(matchTag(block, 'title'))
    if (!headline) continue
    const pub = matchTag(block, 'pubDate')
    const publishedAt = pub ? new Date(pub).toISOString() : undefined
    items.push({ ticker, headline, source: 'Yahoo Finance', publishedAt })
  }
  return items
}

function matchTag(xml: string, tag: string): string | undefined {
  // Handles <tag>..</tag> and <tag><![CDATA[..]]></tag>.
  const m = xml.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`))
  return m?.[1]?.trim() || undefined
}

function decodeXml(s?: string): string | undefined {
  if (!s) return undefined
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
}

// ── Pretty printing ─────────────────────────────────────────────────

const fmt = (n: number | null | undefined, d = 2) =>
  n == null ? '—' : Number(n).toFixed(d)
const pct = (n: number | null | undefined, d = 1) =>
  n == null ? '—' : `${(Number(n) * 100).toFixed(d)}%`
const hr = (label: string) => console.log(`\n${'─'.repeat(4)} ${label} ${'─'.repeat(Math.max(0, 56 - label.length))}`)

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log(`ThinkFleet financial demo · tickers: ${TICKERS.join(', ')} (benchmark ${BENCHMARK})`)

  // 1) Pull public data for every ticker + the benchmark.
  hr('1. Pull public data (Yahoo Finance prices + news)')
  const symbols = [...TICKERS, BENCHMARK]
  const prices: Record<string, PriceInput[]> = {}
  const news: Record<string, NewsInput[]> = {}
  for (const sym of symbols) {
    try {
      prices[sym] = await fetchYahooDaily(sym)
      // News only for the watchlist (not the benchmark).
      news[sym] = TICKERS.includes(sym) ? await fetchYahooNews(sym).catch(() => []) : []
      console.log(`  ${sym.padEnd(6)} ${prices[sym].length} bars, ${news[sym].length} headlines`)
    } catch (err) {
      console.warn(`  ${sym.padEnd(6)} fetch failed: ${(err as Error).message}`)
      prices[sym] = []
      news[sym] = []
    }
  }

  if (FETCH_ONLY) {
    hr('Fetch-only mode — sample of pulled data')
    const sample = TICKERS[0]
    console.log(`Latest ${sample} bar:`, prices[sample]?.at(-1))
    console.log(`Latest ${sample} headline:`, news[sample]?.[0]?.headline ?? '(none)')
    console.log('\nDone (no ingestion — credentials not required for --fetch-only).')
    return
  }

  const tf = new ThinkFleetMemory({
    apiKey: API_KEY!,
    projectId: PROJECT_ID!,
    baseUrl: BASE_URL,
    timeout: 60_000,
  })

  // 2) Ingest everything into memory. The engine stores it verbatim; the
  //    financial plugin reads the metadata shapes on analysis.
  hr('2. Ingest into ThinkFleet memory')
  for (const sym of symbols) {
    if (prices[sym]?.length) {
      await tf.financial.ingestPrices(prices[sym])
      console.log(`  ingested ${prices[sym].length} ${sym} price bars`)
    }
    for (const n of news[sym] ?? []) await tf.financial.ingestNews(n)
    if (news[sym]?.length) console.log(`  ingested ${news[sym].length} ${sym} headlines`)
  }

  // 3) Per-ticker profile (indicators) + a calibrated prediction.
  for (const ticker of TICKERS) {
    const subject = { kind: 'ticker', externalId: ticker }
    hr(`3. ${ticker} — indicators + prediction`)
    const profile = await tf.financial.getProfile(subject)
    const ind = profile.indicators[0]
    if (ind) {
      console.log(
        `  close ${fmt(ind.lastClose)} | RSI14 ${fmt(ind.rsi14)} | SMA50 ${fmt(ind.sma50)} | SMA200 ${fmt(ind.sma200)}`,
      )
      console.log(
        `  MACD ${fmt(ind.macd, 3)} (hist ${fmt(ind.macdHistogram, 3)}) | vol(ann) ${pct(ind.annualizedVolatility)} | beta ${fmt(ind.beta)} (${ind.betaSource}) | maxDD ${pct(ind.maxDrawdown)}`,
      )
    } else {
      console.log('  (no indicators — not enough price history ingested)')
    }
    const { signals, strategyReliability, resolvedSample } = await tf.financial.predict(subject)
    for (const s of signals) {
      console.log(`  → ${s.direction.toUpperCase()} conf ${pct(s.reportedConfidence)} (structural ${pct(s.structuralConfidence)} × reliability ${fmt(strategyReliability)})`)
      console.log(`    expected ${pct(s.expectedReturn)} over ${s.horizonDays}d · news used: ${s.newsUsed}`)
      console.log(`    why: ${s.rationale.join(' | ')}`)
    }
    console.log(`  (reliability is based on ${resolvedSample} resolved past call(s))`)
  }

  // 4) A demo portfolio → risk rollup.
  hr('4. Demo portfolio — risk rollup')
  const portfolio = { kind: 'portfolio', externalId: 'demo-portfolio' }
  const shares: Record<string, number> = { AAPL: 100, MSFT: 50, NVDA: 25 }
  for (const ticker of TICKERS) {
    const last = prices[ticker]?.at(-1)?.close
    await tf.financial.ingestHolding(portfolio, {
      ticker,
      shares: shares[ticker] ?? 10,
      costBasis: last ? last * 0.8 : undefined,
      assetClass: 'equity',
    })
  }
  const pf = await tf.financial.getProfile(portfolio)
  if (pf.portfolioRisk) {
    const r = pf.portfolioRisk
    console.log(`  total value ${fmt(r.totalValue)} | weighted beta ${fmt(r.weightedBeta)} | weighted vol ${pct(r.weightedAnnualizedVolatility)}`)
    console.log(`  1-day 95% VaR ${fmt(r.valueAtRisk95_1d)} (${r.varMethod}) | concentration (HHI) ${fmt(r.concentrationHhi)}`)
    for (const a of r.allocations) console.log(`    ${a.assetClass}: ${pct(a.weight)} (${fmt(a.value)})`)
  }
  for (const p of pf.positions) {
    console.log(`  ${p.ticker}: ${p.shares} @ ${fmt(p.lastClose)} = ${fmt(p.marketValue)} (${pct(p.weight)})  PnL ${fmt(p.unrealizedPnl)}`)
  }
  if (pf.unpricedHoldings.length) console.log(`  unpriced: ${pf.unpricedHoldings.join(', ')}`)

  // 5) The loop: score due predictions, then show calibration.
  hr('5. Feedback loop — reconcile + calibration')
  const rec = await tf.financial.reconcile()
  console.log(`  reconcile: scored ${rec.scored} (hits ${rec.hits}, misses ${rec.misses}), still pending ${rec.stillPending}`)
  const cal = await tf.financial.getCalibration()
  console.log(`  calibration over ${cal.totalResolved} resolved call(s), reliability ${fmt(cal.strategyReliability)}:`)
  for (const b of cal.buckets) {
    const bar = b.hasData ? `realized ${pct(b.realizedHitRate)} (${b.hits}/${b.hits + b.misses})` : '(no data yet)'
    console.log(`    ${pct(b.lower, 0)}–${pct(b.upper, 0)} conf: ${bar}`)
  }
  console.log(
    '\nNote: on a first run, predictions are made "now" with a 30-day horizon, so reconcile\n' +
      'scores 0 and calibration is empty. Run reconcile on a schedule (e.g. daily) and the\n' +
      'calibration curve fills in as calls mature — that feedback is what tunes confidence.',
  )

  console.log('\nDone. Informational only — not investment advice.')
}

main().catch((err) => {
  console.error('\nDemo failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
