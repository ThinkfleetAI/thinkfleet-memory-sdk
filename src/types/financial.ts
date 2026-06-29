// Financial prediction types — technical indicators, portfolio risk, and a
// self-calibrating directional signal loop, served by the memory engine's
// financial vertical (gated behind the @thinkfleet/pack-financial pack).
//
// Financial data IS memory data: you record price bars, fundamentals,
// portfolio holdings, and news events as memory items (see
// FinancialResource.ingest*), and the engine derives indicators, risk, and
// directional calls from them. You decide where the data comes from — a
// market-data vendor, a brokerage feed, an RSS scraper — the SDK just gives
// you the typed way in and out.
//
// Market data (prices / fundamentals / news) is keyed by ticker and shared
// across subjects. Holdings are subject-private (attributed to a portfolio).

import type { Subject } from './lattice.js'

export type { Subject }

// ── Ingestion inputs ──

/** One price bar (daily close). Emit one per trading day to build history. */
export interface PriceInput {
  ticker: string
  close: number
  currency?: string
  volume?: number
  /** ISO timestamp of the bar; defaults to ingestion time. */
  asOf?: string
}

/** Latest-wins fundamentals for a ticker. */
export interface FundamentalInput {
  ticker: string
  peRatio?: number
  marketCap?: number
  dividendYield?: number
  eps?: number
  debtToEquity?: number
  /** Vendor-reported beta. The engine also computes beta from price history. */
  beta?: number
  asOf?: string
}

/** A portfolio position. Restated, not summed — the latest record wins. */
export interface HoldingInput {
  ticker: string
  shares: number
  costBasis?: number
  /** "equity" | "bond" | "cash" | "crypto" | ... Defaults to "equity". */
  assetClass?: string
}

/** A news event. Tag one ticker or many; supply a sentiment in [-1, 1] if you
 *  have a vendor/LLM score, otherwise the engine falls back to a lexicon. */
export interface NewsInput {
  ticker?: string
  tickers?: string[]
  headline: string
  /** [-1, 1]; omit to let the engine score the headline. */
  sentiment?: number
  source?: string
  publishedAt?: string
}

// ── Read shapes — profile ──

export interface TechnicalIndicators {
  ticker: string
  lastClose: number
  asOf: string
  sma20?: number | null
  sma50?: number | null
  sma200?: number | null
  ema12?: number | null
  ema26?: number | null
  rsi14?: number | null
  macd?: number | null
  macdSignal?: number | null
  macdHistogram?: number | null
  bollingerUpper?: number | null
  bollingerMid?: number | null
  bollingerLower?: number | null
  bollingerPctB?: number | null
  annualizedVolatility?: number | null
  trailingReturn?: number | null
  /** Negative fraction, e.g. -0.25 for a 25% peak-to-trough decline. */
  maxDrawdown?: number | null
  sharpe?: number | null
  beta?: number | null
  /** "none" | "computed" (from price history) | "reported" (vendor). */
  betaSource: string
  sampleSize: number
  sourceMemoryIds: string[]
}

export interface FundamentalSnapshot {
  ticker: string
  peRatio?: number | null
  marketCap?: number | null
  dividendYield?: number | null
  eps?: number | null
  debtToEquity?: number | null
  beta?: number | null
  asOf: string
  sourceMemoryId: string
}

export interface PortfolioPosition {
  ticker: string
  shares: number
  costBasis?: number | null
  lastClose: number
  marketValue: number
  /** Fraction of total portfolio value. */
  weight: number
  unrealizedPnl?: number | null
  assetClass: string
}

export interface AssetAllocation {
  assetClass: string
  value: number
  weight: number
}

export interface PortfolioRisk {
  totalValue: number
  weightedBeta?: number | null
  weightedAnnualizedVolatility?: number | null
  /** Parametric 1-day 95% VaR in currency units; see varMethod (ignores
   *  cross-asset correlation). */
  valueAtRisk95_1d?: number | null
  /** Herfindahl index of position weights, [0, 1]. 1 = single name. */
  concentrationHhi: number
  allocations: AssetAllocation[]
  varMethod: string
}

export interface FinancialProfile {
  subject: Subject
  indicators: TechnicalIndicators[]
  fundamentals: FundamentalSnapshot[]
  /** Empty in ticker mode (subject.kind === "ticker"). */
  positions: PortfolioPosition[]
  /** Absent in ticker mode or when the portfolio has no priced value. */
  portfolioRisk?: PortfolioRisk | null
  /** Held tickers with no market data in the corpus (couldn't be priced). */
  unpricedHoldings: string[]
  /** Always populated — informational only, not investment advice. */
  disclaimer: string
  generatedAt: string
}

// ── Read shapes — prediction loop ──

export type Direction = 'buy' | 'sell' | 'hold'

export interface FinancialSignal {
  ticker: string
  strategy: string
  direction: Direction
  /** Blended sub-signal score in [-1, 1], bullish positive. */
  score: number
  /** Raw model agreement before calibration. */
  structuralConfidence: number
  /** The number to trust: structural × the strategy's realized reliability. */
  reportedConfidence: number
  expectedReturn: number
  horizonDays: number
  basisClose: number
  /** ISO timestamp when the call becomes scoreable. */
  dueAt: string
  rationale: string[]
  newsUsed: boolean
  /** Set when the call was persisted for later scoring. */
  predictionId?: string | null
  sourceMemoryIds: string[]
}

export interface PredictFinancialResult {
  signals: FinancialSignal[]
  strategy: string
  /** Reliability multiplier applied this run, and how many resolved calls it
   *  was computed from (0 = untested → multiplier 1.0). */
  strategyReliability: number
  resolvedSample: number
  disclaimer: string
  generatedAt: string
}

export interface ReconcileFinancialResult {
  /** Newly resolved this pass. */
  scored: number
  hits: number
  misses: number
  /** Due-or-not, not yet scoreable. */
  stillPending: number
  generatedAt: string
}

export interface FinancialCalibrationBucket {
  lower: number
  upper: number
  predictions: number
  hits: number
  misses: number
  realizedHitRate: number
  hasData: boolean
}

export interface FinancialCalibrationReport {
  buckets: FinancialCalibrationBucket[]
  /** "all" when unfiltered. */
  strategy: string
  strategyReliability: number
  totalResolved: number
  generatedAt: string
}

// ── Method option bags ──

export interface PredictOptions {
  /** Horizon in days; default 30, clamped [1, 365]. */
  horizonDays?: number
  /** Persist each call for later scoring; default true. */
  persist?: boolean
}

export interface CalibrationOptions {
  /** Number of confidence bands; default 5, clamped [1, 20]. */
  bucketCount?: number
  /** Filter to one strategy; omit for all. */
  strategy?: string
}
