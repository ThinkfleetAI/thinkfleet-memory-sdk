import type { HttpClient } from '../core/http-client.js'
import type { RequestOptions } from '../core/types.js'
import { MemoryItemType, MemoryScope, type MemoryItem } from '../types/memory.js'
import type {
  CalibrationOptions,
  FinancialCalibrationReport,
  FinancialProfile,
  FundamentalInput,
  HoldingInput,
  NewsInput,
  PredictFinancialResult,
  PredictOptions,
  PriceInput,
  ReconcileFinancialResult,
  Subject,
} from '../types/financial.js'

/**
 * Financial — technical indicators, portfolio risk, and a self-calibrating
 * directional prediction loop for the memory engine's financial vertical.
 *
 * Financial data is just memory data: you ingest price bars, fundamentals,
 * holdings, and news as memory items, and the engine derives indicators
 * (SMA/EMA, RSI, MACD, Bollinger, volatility, drawdown, Sharpe, beta),
 * portfolio risk (VaR, weighted beta, HHI concentration, allocation), and
 * buy/sell/hold calls whose REPORTED confidence is the strategy's structural
 * agreement times its *realized* hit-rate. As calls come due they are scored
 * against actual prices (`reconcile`), and that feedback recalibrates future
 * confidence — so the engine gets more honest over time, not just louder.
 *
 * You decide where the data originates — a market-data vendor, a brokerage
 * feed, a news scraper. The SDK only gives you the typed way in and out.
 *
 * Requires the `@thinkfleet/pack-financial` pack enabled on the project; the
 * read methods return FAILED_PRECONDITION otherwise. Ingestion works
 * regardless (it's plain memory).
 *
 * Everything here is informational only — NOT investment advice.
 *
 * Authorization: the engine isolates by tenant (your API key → platform +
 * project). A `subject` (e.g. a portfolio) is caller-asserted — the engine
 * does NOT verify the end-user owns the subject you pass. In a multi-user
 * app YOU are responsible for only ever passing a subject the current user
 * is entitled to. Market data (prices/fundamentals/news) is pooled across
 * the project; holdings are private to their subject.
 *
 * @example
 * ```ts
 * // Backfill price history (market data — no subject).
 * await tf.financial.ingestPrices(history.map((b) => ({ ticker: 'AAPL', close: b.close, asOf: b.date })))
 * await tf.financial.ingestNews({ ticker: 'AAPL', headline: 'Apple beats earnings', sentiment: 0.7 })
 *
 * // Record a portfolio position (subject-private).
 * const portfolio = { kind: 'portfolio', externalId: 'acct-123' }
 * await tf.financial.ingestHolding(portfolio, { ticker: 'AAPL', shares: 100, costBasis: 150 })
 *
 * // Read indicators + risk, and generate calibrated calls.
 * const profile = await tf.financial.getProfile(portfolio)
 * const { signals, strategyReliability } = await tf.financial.predict({ kind: 'ticker', externalId: 'AAPL' })
 *
 * // Later — score due calls and inspect calibration.
 * await tf.financial.reconcile()
 * const cal = await tf.financial.getCalibration()
 * ```
 */
export class FinancialResource {
  constructor(private readonly http: HttpClient) {}

  // ── Input — ingest market data + positions (stored as memory items) ──

  /** Ingest a single price bar. Market data — not subject-attributed. */
  async ingestPrice(price: PriceInput, options?: RequestOptions): Promise<MemoryItem> {
    return this.http.post<MemoryItem>(
      '/admin/memory',
      {
        content: `${price.ticker} close ${price.close}${price.asOf ? ` @ ${price.asOf}` : ''}`,
        type: MemoryItemType.FACT,
        scope: MemoryScope.PROJECT,
        category: 'financial',
        source: 'sdk:financial',
        metadata: { price },
      },
      options,
    )
  }

  /**
   * Ingest many price bars (e.g. a backfill). Issued concurrently; resolves
   * once all are stored. For very large histories, batch in chunks yourself.
   */
  async ingestPrices(prices: PriceInput[], options?: RequestOptions): Promise<MemoryItem[]> {
    return Promise.all(prices.map((p) => this.ingestPrice(p, options)))
  }

  /** Ingest/refresh a ticker's fundamentals. Latest values win. */
  async ingestFundamentals(
    fundamental: FundamentalInput,
    options?: RequestOptions,
  ): Promise<MemoryItem> {
    return this.http.post<MemoryItem>(
      '/admin/memory',
      {
        content: `Fundamentals ${fundamental.ticker}`,
        type: MemoryItemType.FACT,
        scope: MemoryScope.PROJECT,
        category: 'financial',
        source: 'sdk:financial',
        metadata: { fundamental },
      },
      options,
    )
  }

  /**
   * Record a portfolio position. Subject-private — attributed to the owner
   * (use a `{ kind: 'portfolio', externalId }` subject). Restated, not
   * summed: re-recording a ticker replaces the prior position.
   */
  async ingestHolding(
    subject: Subject,
    holding: HoldingInput,
    options?: RequestOptions,
  ): Promise<MemoryItem> {
    return this.http.post<MemoryItem>(
      '/admin/memory',
      {
        content: `Holding ${holding.shares} ${holding.ticker}`,
        type: MemoryItemType.FACT,
        scope: MemoryScope.PROJECT,
        category: 'financial',
        source: 'sdk:financial',
        metadata: { subject, holding },
      },
      options,
    )
  }

  /** Ingest a news event. Market data — tag one or many tickers. */
  async ingestNews(news: NewsInput, options?: RequestOptions): Promise<MemoryItem> {
    const label = news.ticker ?? news.tickers?.join(',') ?? 'news'
    return this.http.post<MemoryItem>(
      '/admin/memory',
      {
        content: `News [${label}]: ${news.headline}`,
        type: MemoryItemType.FACT,
        scope: MemoryScope.PROJECT,
        category: 'financial',
        source: 'sdk:financial',
        metadata: { newsEvent: news },
      },
      options,
    )
  }

  // ── Read — indicators, risk, calibrated predictions ──

  /**
   * Technical indicators + (for a portfolio subject) a risk rollup, derived
   * from ingested market data and holdings. Read-only and forecast-free.
   *
   * `subject.kind === 'ticker'` → single-name analysis (externalId is the
   * ticker). Any other kind → portfolio mode over the subject's holdings.
   */
  async getProfile(subject: Subject, options?: RequestOptions): Promise<FinancialProfile> {
    return this.http.post<FinancialProfile>('/lattice/financial/profile', { subject }, options)
  }

  /**
   * Generate directional buy/sell/hold calls. Reported confidence =
   * structural agreement × the strategy's realized reliability. By default
   * each call is persisted so it can be scored at horizon by `reconcile`.
   */
  async predict(
    subject: Subject,
    opts?: PredictOptions,
    options?: RequestOptions,
  ): Promise<PredictFinancialResult> {
    return this.http.post<PredictFinancialResult>(
      '/lattice/financial/predict',
      {
        subject,
        ...(opts?.horizonDays != null ? { horizonDays: opts.horizonDays } : {}),
        ...(opts?.persist != null ? { persist: opts.persist } : {}),
      },
      options,
    )
  }

  /**
   * Run the feedback loop: score every persisted prediction whose horizon has
   * elapsed against the realized close, and mark it resolved. This is what
   * makes the engine learn — reliability and calibration are recomputed from
   * these outcomes. Idempotent; safe to run on a schedule.
   */
  async reconcile(options?: RequestOptions): Promise<ReconcileFinancialResult> {
    return this.http.post<ReconcileFinancialResult>('/lattice/financial/reconcile', {}, options)
  }

  /**
   * The honesty proof: resolved predictions bucketed by the confidence we
   * reported, with the realized hit-rate per band — so "calls we rated ~70%"
   * can be checked against whether ~70% actually landed.
   */
  async getCalibration(
    opts?: CalibrationOptions,
    options?: RequestOptions,
  ): Promise<FinancialCalibrationReport> {
    return this.http.post<FinancialCalibrationReport>(
      '/lattice/financial/calibration',
      {
        ...(opts?.bucketCount != null ? { bucketCount: opts.bucketCount } : {}),
        ...(opts?.strategy != null ? { strategy: opts.strategy } : {}),
      },
      options,
    )
  }
}
