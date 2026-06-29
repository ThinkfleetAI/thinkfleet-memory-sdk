// Health prediction types — biological ("health") age + condition
// prediction + cohort outcomes, served by the memory engine's health
// vertical (gated behind the @thinkfleet/pack-healthcare pack).
//
// Health data IS memory data: you record biomarkers / demographics /
// diagnoses as memory items (see HealthResource.record*), and the engine
// derives the profile from them. You decide where the data comes from —
// EHR, document extraction, manual entry — the SDK just gives you the
// typed way in.

import type { Subject } from './lattice.js'

export type { Subject }

/** Canonical biomarker keys the engine understands. Free-form string on
 *  the wire (so new markers don't break the contract); these are the
 *  recognized values. */
export type Biomarker =
  // PhenoAge panel
  | 'albumin'
  | 'creatinine'
  | 'glucose_fasting'
  | 'crp'
  | 'lymphocyte_pct'
  | 'mcv'
  | 'rdw'
  | 'alkaline_phosphatase'
  | 'wbc'
  // Cardiometabolic
  | 'hba1c'
  | 'ldl'
  | 'hdl'
  | 'total_cholesterol'
  | 'triglycerides'
  | 'systolic_bp'
  | 'diastolic_bp'

export type Sex = 'male' | 'female' | 'unknown'
export type ActivityLevel = 'sedentary' | 'low' | 'moderate' | 'high'
export type ConditionStatus = 'active' | 'resolved' | 'historical'

export interface DemographicsInput {
  ageYears?: number
  sex?: Sex
  weightKg?: number
  heightCm?: number
  activity?: ActivityLevel
}

export interface ConditionInput {
  /** ICD-10 code, e.g. "E11.9". */
  icd10: string
  status?: ConditionStatus
  /** ISO timestamp. */
  onsetAt?: string
}

// ── Read shapes ──

export interface HealthAgeComponent {
  label: string
  yearsDelta: number
}

export interface BiologicalAge {
  biologicalAgeYears: number
  chronologicalAgeYears: number
  deltaYears: number
  /** "phenoage_hybrid" | "composite" */
  method: string
  confidence: number
  components: HealthAgeComponent[]
  /** 10-year mortality score (0..1) from PhenoAge, when available. */
  mortalityScore?: number | null
}

export interface PredictedHealthCondition {
  /** Canonical key, e.g. "type2_diabetes". */
  condition: string
  label: string
  /** "above_threshold_now" | "threshold_projection" */
  basis: string
  biomarker: string
  currentValue: number
  threshold: number
  /** ISO timestamp; set only for threshold_projection. */
  projectedOnsetAt?: string | null
  confidence: number
  rationale: string
  sourceMemoryIds: string[]
}

export interface BiomarkerReading {
  biomarker: string
  value: number
  unit: string
  observedAt: string
}

export interface HealthProfile {
  subject: Subject
  biologicalAge?: BiologicalAge | null
  predictedConditions: PredictedHealthCondition[]
  /** ICD-10 codes already diagnosed (active) on record. */
  diagnosedConditions: string[]
  latestBiomarkers: BiomarkerReading[]
  /** Always populated — these are screening indicators, not a diagnosis. */
  disclaimer: string
  generatedAt: string
}

export interface CohortConditionRisk {
  condition: string
  /** Fraction of the cohort carrying this condition (0..1). */
  cohortPrevalence: number
  cohortSize: number
  countWith: number
  meanSimilarity: number
  confidence: number
  rationale: string
}

export interface CohortHealthRisk {
  subject: Subject
  cohortSize: number
  populationSize: number
  risks: CohortConditionRisk[]
  disclaimer: string
  generatedAt: string
}
