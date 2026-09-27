// ============================================================================
// ThermalSentinel — Bayesian Source Inference Engine (Day 1A)
//
// Replaces the prototype additive scoring engine with a rigorous, log-space
// Bayesian posterior calculation over five candidate hypotheses:
//   1. GAS_FLARE
//   2. INDUSTRIAL_FIRE
//   3. AGRICULTURAL_BURN
//   4. WILDFIRE_VEGETATION
//   5. OTHER
//
// Core Formulation:
//   P(H | E1, E2, ..., En) ∝ P(H) × Π P(Ei | H)
//   logScore(H) = log(P(H)) + Σ log(P(Ei | H))
//   P(H | E) = exp(logScore(H) - logSumExp(logScores))
//
// Explicit Provenance Categories:
//   - EMPIRICAL: Direct frequency/measurement from verified external datasets
//   - EXPERT_PRIOR: Explicitly documented domain prior assumptions
//   - EXTERNAL: Third-party API/catalog response
//   - DERIVED: Mathematical transformation of empirical/expert parameters
//   - UNAVAILABLE: Missing/unsupported feature (neutral likelihood P=1.0)
//
// Dependency / Double-Counting Strategy:
//   Collinear features are unified into distinct Evidence Families so that
//   correlated measurements are evaluated via family-level joint likelihoods
//   rather than multiplied as pseudo-independent observations.
// ============================================================================

import {
  SourceHypothesisType,
  SpatialAssociationType,
  BehaviouralStatus,
  ContextualHypothesisItem,
  HypothesisFeatureContribution,
  UncertaintyAssessment,
  InvestigationPriorityResult,
  ThermalSourceDiscriminatorOutput,
  ServerFacility,
} from './types.js';
import { EmpiricalFacilityBaseline } from './historicalIngestion.js';
import { TemporalPersistenceContext } from './persistenceEngine.js';
import { OsmContextResponse } from './osm.js';
import { WeatherContextResponse } from './weather.js';
import { Sentinel2SwirResponse } from './types.js';

export const ALL_CANDIDATE_HYPOTHESES: SourceHypothesisType[] = [
  'GAS_FLARE',
  'INDUSTRIAL_FIRE',
  'AGRICULTURAL_BURN',
  'WILDFIRE_VEGETATION',
  'OTHER',
];

export const HYPOTHESIS_DISPLAY_LABELS: Record<SourceHypothesisType, string> = {
  GAS_FLARE: 'Routine / Relief Gas Flare',
  INDUSTRIAL_FIRE: 'Industrial Fire / Abnormal Heat',
  AGRICULTURAL_BURN: 'Agricultural / Crop Residue Burn',
  WILDFIRE_VEGETATION: 'Wildfire / Vegetation',
  OTHER: 'Other Process Heat / Sensor Artifact',
};

export type ProbabilityProvenance =
  | 'EMPIRICAL'
  | 'EXPERT_PRIOR'
  | 'EXTERNAL'
  | 'DERIVED'
  | 'UNAVAILABLE';

export type EvidenceIndependenceStatus =
  | 'INDEPENDENT'
  | 'CONDITIONALLY_INDEPENDENT'
  | 'DERIVED'
  | 'CORRELATED'
  | 'CONTROLLED'
  | 'UNAVAILABLE';

export type EvidenceFamily =
  | 'RADIOMETRY'
  | 'SPATIAL_CONTEXT'
  | 'BEHAVIOURAL_BASELINE'
  | 'TEMPORAL_PERSISTENCE'
  | 'INFRASTRUCTURE'
  | 'WEATHER'
  | 'LAND_CONTEXT'
  | 'OPTICAL'
  | 'ML_ADVISORY'
  | 'OPERATIONAL_CONTEXT';

export interface HypothesisPrior {
  hypothesis: SourceHypothesisType;
  probability: number;
  log_probability: number;
  provenance: ProbabilityProvenance;
  description: string;
}

export interface PriorDistribution {
  priors: Record<SourceHypothesisType, HypothesisPrior>;
  distribution: Record<SourceHypothesisType, number>;
  provenance: ProbabilityProvenance;
  rationale: string;
}

export interface BayesianEvidenceItem {
  evidence_id: string;
  evidence_family: EvidenceFamily;
  source: string;
  feature_name: string;
  value: any;
  unit?: string;
  timestamp: string;
  spatial_relationship?: string;
  provenance: ProbabilityProvenance;
  independence_status: EvidenceIndependenceStatus;
  depends_on: string[];
  reliability: 'HIGH' | 'MODERATE' | 'LOW';
  applicability: string;
  affected_hypotheses: SourceHypothesisType[];
  likelihood_by_hypothesis: Record<SourceHypothesisType, number>; // P(E | H) in (0, 1]
  log_likelihood_by_hypothesis: Record<SourceHypothesisType, number>; // ln P(E | H)
  likelihood_provenance: Record<SourceHypothesisType, ProbabilityProvenance>;
  explanation: string;
  is_incorporated: boolean;
}

export interface StructuredEvidenceConflict {
  has_conflict: boolean;
  severity: 'NONE' | 'LOW' | 'MODERATE' | 'HIGH';
  conflicting_sources: string[];
  hypotheses_involved: SourceHypothesisType[];
  reason: string;
  contextual_leading_hypothesis: string;
  contextual_support_pct: number;
  discriminator_class?: string;
  discriminator_score_pct?: number;
  resolution_requirement: string;
}

export interface BayesianModelMetadata {
  model_id: 'bayesian-source-inference-v1';
  version: '1.1.0';
  hypothesis_space: SourceHypothesisType[];
  inference_type: 'LOG_SPACE_BAYESIAN_POSTERIOR';
  formula: 'P(H|E) = exp(log P(H) + sum_{E_i in E_indep} log P(E_i|H) - logSumExp)';
  prior_provenance: ProbabilityProvenance;
  empirical_sources: string[];
  expert_assumptions: string[];
  geographic_scope: string;
  temporal_scope: string;
  calibration_status: string;
  known_limitations: string[];
  dependency_handling: string;
}

export interface BayesianPosteriorResult {
  posterior_probabilities: Record<SourceHypothesisType, number>; // exact probabilities summing to 1.0
  log_posterior_scores: Record<SourceHypothesisType, number>; // unnormalized log scores
  hypotheses_distribution: ContextualHypothesisItem[];
  primary_hypothesis: string;
  primary_hypothesis_type: SourceHypothesisType;
  prior_distribution: PriorDistribution;
  incorporated_evidence_items: BayesianEvidenceItem[];
  advisory_evidence_items: BayesianEvidenceItem[];
  evidence_families_evaluated: EvidenceFamily[];
  uncertainty: UncertaintyAssessment;
  evidence_conflict: StructuredEvidenceConflict;
  hypothesis_rationales: Array<{
    hypothesis: SourceHypothesisType;
    score: number;
    rationale: string;
  }>;
  model_registry: BayesianModelMetadata;
}

export interface BayesianInferenceInput {
  frp: number;
  brightness_kelvin?: number;
  brightness_ti4?: number;
  brightness_ti5?: number;
  brightness_delta?: number;
  sensor?: string;
  day_night?: 'D' | 'N';
  confidence?: 'low' | 'nominal' | 'high';
  satellite?: string;
  scan?: number;
  track?: number;

  spatial_association: SpatialAssociationType;
  distance_to_facility_meters?: number | null;
  distance_to_zone_meters?: number | null;
  facility_id?: string | null;
  facility_name?: string | null;
  facility_category?: string | null;
  matched_zone_name?: string | null;
  is_inside_polygon?: boolean;

  behavioural_status?: BehaviouralStatus;
  baseline?: EmpiricalFacilityBaseline | null;

  persistence_context?: Partial<TemporalPersistenceContext> | null;
  osm_context?: OsmContextResponse | null;
  weather_context?: WeatherContextResponse | null;
  land_cover_type?: string | null;
  sentinel_context?: Sentinel2SwirResponse | null;
  ml_discriminator?: ThermalSourceDiscriminatorOutput | null;

  user_priors?: Partial<Record<SourceHypothesisType, number>> | null;
  additional_evidence_items?: BayesianEvidenceItem[];
  custom_evidence_only?: boolean;
}

/**
 * Numerically stable Log-Sum-Exp computation:
 * logSumExp([x1, x2, ...]) = max(x) + log(sum(exp(xi - max(x))))
 */
export function logSumExp(logValues: number[]): number {
  if (logValues.length === 0) return -Infinity;
  const maxLog = Math.max(...logValues);
  if (!isFinite(maxLog) || maxLog === -Infinity) return -Infinity;
  let sumExp = 0;
  for (const lv of logValues) {
    sumExp += Math.exp(lv - maxLog);
  }
  return maxLog + Math.log(sumExp);
}

/**
 * Computes Shannon entropy directly from probability distribution:
 * H = -sum(p_i * log2(p_i))
 * H_max = log2(K)
 * H_norm = H / H_max
 */
export function calculateBayesianShannonEntropy(probabilities: number[]): {
  entropy_bits: number;
  max_possible_entropy_bits: number;
  normalized_entropy: number;
} {
  const K = probabilities.length;
  if (K <= 1) {
    return { entropy_bits: 0, max_possible_entropy_bits: 0, normalized_entropy: 0 };
  }
  let h = 0;
  for (const p of probabilities) {
    if (p > 1e-12) {
      h -= p * (Math.log(p) / Math.LN2);
    }
  }
  const maxH = Math.log(K) / Math.LN2;
  const normH = maxH > 0 ? Math.min(1.0, Math.max(0.0, h / maxH)) : 0;
  return {
    entropy_bits: Math.round(h * 1000) / 1000,
    max_possible_entropy_bits: Math.round(maxH * 1000) / 1000,
    normalized_entropy: Math.round(normH * 1000) / 1000,
  };
}

/**
 * ----------------------------------------------------------------------------
 * 1. PRIOR DEFINITIONS
 * ----------------------------------------------------------------------------
 * Explicit prior probabilities with documented provenance.
 */
export function getPriorDistribution(params: {
  spatial_association?: SpatialAssociationType;
  is_inside_polygon?: boolean;
  facility_category?: string | null;
  user_priors?: Partial<Record<SourceHypothesisType, number>> | null;
}): PriorDistribution {
  // 1. User-supplied explicit priors if provided
  if (params.user_priors) {
    const raw: Record<SourceHypothesisType, number> = {
      GAS_FLARE: Math.max(0.0001, params.user_priors.GAS_FLARE ?? 0.20),
      INDUSTRIAL_FIRE: Math.max(0.0001, params.user_priors.INDUSTRIAL_FIRE ?? 0.20),
      AGRICULTURAL_BURN: Math.max(0.0001, params.user_priors.AGRICULTURAL_BURN ?? 0.20),
      WILDFIRE_VEGETATION: Math.max(0.0001, params.user_priors.WILDFIRE_VEGETATION ?? 0.20),
      OTHER: Math.max(0.0001, params.user_priors.OTHER ?? 0.20),
    };
    const sum = Object.values(raw).reduce((a, b) => a + b, 0);
    const priors: Record<SourceHypothesisType, HypothesisPrior> = {} as any;
    const dist: Record<SourceHypothesisType, number> = {} as any;

    for (const h of ALL_CANDIDATE_HYPOTHESES) {
      const p = raw[h] / sum;
      dist[h] = p;
      priors[h] = {
        hypothesis: h,
        probability: p,
        log_probability: Math.log(p),
        provenance: 'EXPERT_PRIOR',
        description: `User-specified investigative prior for ${h}.`,
      };
    }
    return {
      priors,
      distribution: dist,
      provenance: 'EXPERT_PRIOR',
      rationale: 'User-specified prior distribution.',
    };
  }

  // 2. Authoritative Spatially Independent Base Prior (Day 1C Correction)
  // To prevent spatial double-counting, the authoritative Bayesian prior is strictly
  // spatially invariant (uniform 0.20 per candidate hypothesis).
  // All spatial containment, facility perimeter, stack proximity, and land cover factors
  // are evaluated exclusively as conditional likelihoods in the SPATIAL_CONTEXT and
  // INFRASTRUCTURE evidence families.
  const raw: Record<SourceHypothesisType, number> = {
    GAS_FLARE: 0.20,
    INDUSTRIAL_FIRE: 0.20,
    AGRICULTURAL_BURN: 0.20,
    WILDFIRE_VEGETATION: 0.20,
    OTHER: 0.20,
  };

  const priors: Record<SourceHypothesisType, HypothesisPrior> = {} as any;
  for (const h of ALL_CANDIDATE_HYPOTHESES) {
    const p = raw[h];
    priors[h] = {
      hypothesis: h,
      probability: p,
      log_probability: Math.log(p),
      provenance: 'EXPERT_PRIOR',
      description: `Spatially invariant uniform baseline prior P(${h}) = 0.20.`,
    };
  }

  return {
    priors,
    distribution: raw,
    provenance: 'EXPERT_PRIOR',
    rationale:
      'BASELINE_ASSUMPTION / EXPERT_PRIOR: Spatially invariant uniform base prior (0.20 per hypothesis). Eliminates spatial prior double-counting; geospatial facility/stack containment and distance relationships are evaluated strictly via conditional likelihoods in the SPATIAL_CONTEXT evidence family.',
  };
}

/**
 * ----------------------------------------------------------------------------
 * 2. EVIDENCE FAMILY LIKELIHOOD GENERATORS
 * ----------------------------------------------------------------------------
 * Each generator evaluates a single, conditionally independent evidence family,
 * avoiding collinear sub-feature double-counting.
 */

// A. RADIOMETRY EVIDENCE FAMILY
export function evaluateRadiometryLikelihood(input: {
  frp: number;
  day_night?: 'D' | 'N';
  brightness_ti4?: number;
  brightness_ti5?: number;
  brightness_delta?: number;
}): BayesianEvidenceItem {
  const frp = Math.max(0.1, input.frp || 0.1);
  const isNight = (input.day_night || 'N') === 'N';
  const delta = input.brightness_delta !== undefined
    ? input.brightness_delta
    : (input.brightness_ti4 && input.brightness_ti5 ? input.brightness_ti4 - input.brightness_ti5 : 20.0);

  // Likelihood models (Expert-defined piecewise conditional models informed by empirical domain ranges):
  // GAS_FLARE (Informed by Jamnagar 294 empirical VIIRS observations and EOG flare signatures):
  //   - Nighttime observations strongly favor continuous flare combustion (84% of flare passes occur at night)
  //   - Steady FRP (empirical median 2.32 MW, 95th percentile ~6.41 MW)
  //   - High TI4-TI5 delta (high MWIR brightness relative to ambient LWIR)
  let pFlare = 0.40;
  if (isNight) pFlare *= 1.8; else pFlare *= 0.5;
  if (frp >= 1.0 && frp <= 20.0) pFlare *= 1.4;
  else if (frp > 50.0) pFlare *= 0.25;
  if (delta > 25.0) pFlare *= 1.3;
  pFlare = Math.min(0.95, Math.max(0.005, pFlare));

  // WILDFIRE_VEGETATION (Informed by 2,828 WFIGS wildfire observations):
  //   - Strong daytime prominence (solar heating + active convective spread)
  //   - Wide range of FRP with large high-energy tail (> 30 MW common)
  //   - Moderate to high brightness delta
  let pWildfire = 0.45;
  if (!isNight) pWildfire *= 1.6; else pWildfire *= 0.6;
  if (frp > 25.0) pWildfire *= 1.5;
  else if (frp < 2.0) pWildfire *= 0.4;
  pWildfire = Math.min(0.95, Math.max(0.005, pWildfire));

  // INDUSTRIAL_FIRE (Expert Prior — zero verified industrial fire training cases):
  //   - Elevated energetic radiance (unconfined structural fuel load, high FRP)
  //   - Can occur day or night
  //   - High thermal contrast with surroundings
  let pIndFire = 0.30;
  if (frp > 25.0) pIndFire *= 2.2;
  else if (frp > 10.0) pIndFire *= 1.4;
  else pIndFire *= 0.3;
  pIndFire = Math.min(0.95, Math.max(0.005, pIndFire));

  // AGRICULTURAL_BURN (Expert Prior — regional crop residue burning):
  //   - Almost strictly daytime burning (farmers burn post-harvest in daylight)
  //   - Low to moderate FRP (typically 3 to 25 MW)
  let pAgri = 0.40;
  if (!isNight) pAgri *= 1.8; else pAgri *= 0.15;
  if (frp >= 3.0 && frp <= 30.0) pAgri *= 1.4;
  else if (frp > 60.0) pAgri *= 0.2;
  pAgri = Math.min(0.95, Math.max(0.005, pAgri));

  // OTHER (Furnace exhaust, asphalt hot-work, solar artifact):
  let pOther = 0.25;
  if (frp < 5.0) pOther *= 1.5;
  else if (frp > 30.0) pOther *= 0.3;
  pOther = Math.min(0.95, Math.max(0.005, pOther));

  const likelihoods: Record<SourceHypothesisType, number> = {
    GAS_FLARE: Number(pFlare.toFixed(4)),
    INDUSTRIAL_FIRE: Number(pIndFire.toFixed(4)),
    AGRICULTURAL_BURN: Number(pAgri.toFixed(4)),
    WILDFIRE_VEGETATION: Number(pWildfire.toFixed(4)),
    OTHER: Number(pOther.toFixed(4)),
  };

  const logLikelihoods: Record<SourceHypothesisType, number> = {} as any;
  for (const h of ALL_CANDIDATE_HYPOTHESES) {
    logLikelihoods[h] = Math.log(likelihoods[h]);
  }

  return {
    evidence_id: 'EVID-FAMILY-RADIOMETRY',
    evidence_family: 'RADIOMETRY',
    source: 'NASA_FIRMS_VIIRS_SENSOR',
    feature_name: 'Joint Radiometric Intensity, Diurnal Timing & Spectral Delta',
    value: { frp, is_night: isNight, brightness_delta: delta },
    unit: 'MW, K',
    timestamp: new Date().toISOString(),
    provenance: 'DERIVED',
    independence_status: 'CONDITIONALLY_INDEPENDENT',
    depends_on: ['NASA_FIRMS_VIIRS_SENSOR'],
    reliability: 'HIGH',
    applicability: 'Evaluates joint radiative power, diurnal pass timing, and mid-to-long wave infrared contrast.',
    affected_hypotheses: ALL_CANDIDATE_HYPOTHESES,
    likelihood_by_hypothesis: likelihoods,
    log_likelihood_by_hypothesis: logLikelihoods,
    likelihood_provenance: {
      GAS_FLARE: 'EXPERT_PRIOR',
      WILDFIRE_VEGETATION: 'EXPERT_PRIOR',
      INDUSTRIAL_FIRE: 'EXPERT_PRIOR',
      AGRICULTURAL_BURN: 'EXPERT_PRIOR',
      OTHER: 'EXPERT_PRIOR',
    },
    explanation: `Joint radiometric signature: FRP=${frp.toFixed(1)} MW during ${isNight ? 'nighttime' : 'daytime'} pass (ΔT=${delta.toFixed(1)} K).`,
    is_incorporated: true,
  };
}

// B. SPATIAL CONTEXT EVIDENCE FAMILY
export function evaluateSpatialContextLikelihood(input: {
  spatial_association: SpatialAssociationType;
  distance_to_zone_meters?: number | null;
  distance_to_facility_meters?: number | null;
  matched_zone_name?: string | null;
  is_inside_polygon?: boolean;
}): BayesianEvidenceItem {
  const spatial = input.spatial_association || 'UNASSOCIATED';
  const distZone = input.distance_to_zone_meters;

  let likelihoods: Record<SourceHypothesisType, number>;
  let explanation = '';

  if (spatial === 'KNOWN_THERMAL_ZONE') {
    const isVeryClose = distZone !== null && distZone !== undefined && distZone <= 150;
    likelihoods = {
      GAS_FLARE: isVeryClose ? 0.92 : 0.84,
      INDUSTRIAL_FIRE: 0.12,
      OTHER: 0.25,
      AGRICULTURAL_BURN: 0.001,
      WILDFIRE_VEGETATION: 0.001,
    };
    explanation = `Observation collocated with authorized facility combustion zone (${input.matched_zone_name || 'Mapped Flare Stack Cluster'}${distZone != null ? `, dist: ${Math.round(distZone)}m` : ''}).`;
  } else if (spatial === 'FACILITY_OFF_ZONE') {
    likelihoods = {
      INDUSTRIAL_FIRE: 0.72,
      OTHER: 0.45,
      GAS_FLARE: 0.14,
      AGRICULTURAL_BURN: 0.005,
      WILDFIRE_VEGETATION: 0.005,
    };
    explanation = `Observation located inside industrial perimeter but offset from configured flare stacks (${distZone != null ? `${Math.round(distZone)}m off-stack` : 'off-zone'}). High physical probability of unconfined process leak or structural fire.`;
  } else if (spatial === 'FACILITY_BUFFER') {
    likelihoods = {
      AGRICULTURAL_BURN: 0.65,
      WILDFIRE_VEGETATION: 0.55,
      OTHER: 0.20,
      INDUSTRIAL_FIRE: 0.18,
      GAS_FLARE: 0.06,
    };
    explanation = `Observation located in facility boundary buffer envelope (${input.distance_to_facility_meters != null ? `${Math.round(input.distance_to_facility_meters)}m from facility` : 'buffer'}).`;
  } else {
    // UNASSOCIATED
    likelihoods = {
      AGRICULTURAL_BURN: 0.78,
      WILDFIRE_VEGETATION: 0.75,
      OTHER: 0.25,
      INDUSTRIAL_FIRE: 0.01,
      GAS_FLARE: 0.002,
    };
    explanation = `Observation located in regional open terrain outside all monitored industrial facilities.`;
  }

  const logLikelihoods: Record<SourceHypothesisType, number> = {} as any;
  for (const h of ALL_CANDIDATE_HYPOTHESES) {
    logLikelihoods[h] = Math.log(likelihoods[h]);
  }

  return {
    evidence_id: 'EVID-FAMILY-SPATIAL-CONTEXT',
    evidence_family: 'SPATIAL_CONTEXT',
    source: 'FACILITY_GEOMETRY_REGISTRY',
    feature_name: 'Spatial Containment & Infrastructure Proximity',
    value: { spatial_association: spatial, distance_to_zone: distZone },
    unit: 'meters',
    timestamp: new Date().toISOString(),
    provenance: 'EXPERT_PRIOR',
    independence_status: 'CONDITIONALLY_INDEPENDENT',
    depends_on: ['FACILITY_GEOMETRY_REGISTRY'],
    reliability: 'HIGH',
    applicability: 'Discriminates authorized stack flaring, uncontained facility fire, and open rural land burning.',
    affected_hypotheses: ALL_CANDIDATE_HYPOTHESES,
    likelihood_by_hypothesis: likelihoods,
    log_likelihood_by_hypothesis: logLikelihoods,
    likelihood_provenance: {
      GAS_FLARE: 'EXPERT_PRIOR',
      INDUSTRIAL_FIRE: 'EXPERT_PRIOR',
      AGRICULTURAL_BURN: 'EXPERT_PRIOR',
      WILDFIRE_VEGETATION: 'EXPERT_PRIOR',
      OTHER: 'EXPERT_PRIOR',
    },
    explanation,
    is_incorporated: true,
  };
}

// C. BEHAVIOURAL BASELINE EVIDENCE FAMILY
export function evaluateBehaviouralBaselineLikelihood(input: {
  behavioural_status?: BehaviouralStatus;
  baseline?: EmpiricalFacilityBaseline | null;
  frp: number;
}): BayesianEvidenceItem {
  const status = input.behavioural_status || 'NOT_ASSESSED';
  const hasBaseline = Boolean(input.baseline && (input.baseline.baseline_status === 'EMPIRICAL' || input.baseline.baseline_status === 'CONTROLLED'));

  // If facility has no empirical baseline (or unassociated), return neutral likelihood (P=1.0 for all H)
  if (!hasBaseline || status === 'NOT_ASSESSED') {
    const neutralLikelihoods: Record<SourceHypothesisType, number> = {
      GAS_FLARE: 1.0,
      INDUSTRIAL_FIRE: 1.0,
      AGRICULTURAL_BURN: 1.0,
      WILDFIRE_VEGETATION: 1.0,
      OTHER: 1.0,
    };
    const neutralLogs: Record<SourceHypothesisType, number> = {
      GAS_FLARE: 0.0,
      INDUSTRIAL_FIRE: 0.0,
      AGRICULTURAL_BURN: 0.0,
      WILDFIRE_VEGETATION: 0.0,
      OTHER: 0.0,
    };
    return {
      evidence_id: 'EVID-FAMILY-BEHAVIOURAL-BASELINE',
      evidence_family: 'BEHAVIOURAL_BASELINE',
      source: 'FACILITY_BASELINE_ENGINE',
      feature_name: 'Empirical Operational Baseline Excursion',
      value: { status: 'UNAVAILABLE_OR_NOT_ASSESSED' },
      timestamp: new Date().toISOString(),
      provenance: 'UNAVAILABLE',
      independence_status: 'UNAVAILABLE',
      depends_on: ['FACILITY_BASELINE_ENGINE'],
      reliability: 'LOW',
      applicability: 'Baseline comparison unavailable; contributes neutral likelihood.',
      affected_hypotheses: ALL_CANDIDATE_HYPOTHESES,
      likelihood_by_hypothesis: neutralLikelihoods,
      log_likelihood_by_hypothesis: neutralLogs,
      likelihood_provenance: {
        GAS_FLARE: 'UNAVAILABLE',
        INDUSTRIAL_FIRE: 'UNAVAILABLE',
        AGRICULTURAL_BURN: 'UNAVAILABLE',
        WILDFIRE_VEGETATION: 'UNAVAILABLE',
        OTHER: 'UNAVAILABLE',
      },
      explanation: 'No historical empirical baseline available for this facility/region; evidence is neutral.',
      is_incorporated: false,
    };
  }

  let likelihoods: Record<SourceHypothesisType, number>;
  let explanation = '';
  const median = input.baseline?.metrics.frp_median || 2.32;
  const p95 = input.baseline?.metrics.frp_p95 || 6.41;
  const ratio = median > 0 ? input.frp / median : 1.0;

  if (status === 'NORMAL') {
    // Within P75: routine flaring behaviour
    likelihoods = {
      GAS_FLARE: 0.85,
      OTHER: 0.65,
      INDUSTRIAL_FIRE: 0.04,
      AGRICULTURAL_BURN: 0.20,
      WILDFIRE_VEGETATION: 0.20,
    };
    explanation = `Conditional contextual likelihood: Thermal output (${input.frp.toFixed(1)} MW) conforms to empirical routine operational baseline (< P75: ${input.baseline?.metrics.frp_p75} MW, median: ${median} MW).`;
  } else if (status === 'ELEVATED') {
    // Between P75 and P95
    likelihoods = {
      GAS_FLARE: 0.35,
      INDUSTRIAL_FIRE: 0.45,
      OTHER: 0.35,
      AGRICULTURAL_BURN: 0.20,
      WILDFIRE_VEGETATION: 0.20,
    };
    explanation = `Conditional contextual likelihood: Thermal output (${input.frp.toFixed(1)} MW) is elevated between 75th and 95th baseline percentiles (${ratio.toFixed(1)}× median).`;
  } else {
    // ANOMALOUS (> P95)
    likelihoods = {
      INDUSTRIAL_FIRE: 0.88,
      OTHER: 0.20,
      GAS_FLARE: 0.05,
      AGRICULTURAL_BURN: 0.10,
      WILDFIRE_VEGETATION: 0.20,
    };
    explanation = `Conditional contextual likelihood: Statistically anomalous thermal surge: FRP (${input.frp.toFixed(1)} MW) exceeds 95th percentile empirical baseline (${p95.toFixed(1)} MW) by ${(input.frp - p95).toFixed(1)} MW (${ratio.toFixed(1)}× median). Routine flaring rarely exceeds P95.`;
  }

  const logLikelihoods: Record<SourceHypothesisType, number> = {} as any;
  for (const h of ALL_CANDIDATE_HYPOTHESES) {
    logLikelihoods[h] = Math.log(likelihoods[h]);
  }

  const isControlled = input.baseline?.baseline_status === 'CONTROLLED' || input.baseline?.provenance === 'CONTROLLED';

  return {
    evidence_id: 'EVID-FAMILY-BEHAVIOURAL-BASELINE',
    evidence_family: 'BEHAVIOURAL_BASELINE',
    source: 'FACILITY_BASELINE_ENGINE',
    feature_name: 'Empirical Operational Baseline Excursion',
    value: { status, frp: input.frp, ratio_to_median: ratio, median, p95 },
    unit: 'MW',
    timestamp: new Date().toISOString(),
    provenance: 'DERIVED',
    independence_status: isControlled ? 'CONTROLLED' : 'DERIVED',
    depends_on: ['RADIOMETRY', 'FACILITY_BASELINE_ENGINE'],
    reliability: 'HIGH',
    applicability: 'Evaluates conditional percentile departure P(current FRP | historical operational baseline, H). Evaluated as derived contextual operational metadata; excluded from authoritative posterior calculation to avoid double-counting current-pass FRP with RADIOMETRY.',
    affected_hypotheses: ALL_CANDIDATE_HYPOTHESES,
    likelihood_by_hypothesis: likelihoods,
    log_likelihood_by_hypothesis: logLikelihoods,
    likelihood_provenance: {
      GAS_FLARE: isControlled ? 'EXPERT_PRIOR' : 'DERIVED',
      INDUSTRIAL_FIRE: isControlled ? 'EXPERT_PRIOR' : 'DERIVED',
      AGRICULTURAL_BURN: 'EXPERT_PRIOR',
      WILDFIRE_VEGETATION: 'EXPERT_PRIOR',
      OTHER: isControlled ? 'EXPERT_PRIOR' : 'DERIVED',
    },
    explanation,
    is_incorporated: false,
  };
}

// D. TEMPORAL PERSISTENCE EVIDENCE FAMILY
export function evaluateTemporalPersistenceLikelihood(
  persistence?: Partial<TemporalPersistenceContext> | null
): BayesianEvidenceItem {
  if (!persistence || persistence.status === 'NO_HISTORICAL_DATA') {
    const neutralLikelihoods: Record<SourceHypothesisType, number> = {
      GAS_FLARE: 1.0,
      INDUSTRIAL_FIRE: 1.0,
      AGRICULTURAL_BURN: 1.0,
      WILDFIRE_VEGETATION: 1.0,
      OTHER: 1.0,
    };
    return {
      evidence_id: 'EVID-FAMILY-TEMPORAL-PERSISTENCE',
      evidence_family: 'TEMPORAL_PERSISTENCE',
      source: 'TEMPORAL_PERSISTENCE_ENGINE',
      feature_name: 'Multi-Pass Cluster Persistence',
      value: { status: 'NO_HISTORY' },
      timestamp: new Date().toISOString(),
      provenance: 'UNAVAILABLE',
      independence_status: 'UNAVAILABLE',
      depends_on: ['TEMPORAL_PERSISTENCE_ENGINE'],
      reliability: 'LOW',
      applicability: 'Temporal recurrence data unavailable; neutral likelihood.',
      affected_hypotheses: ALL_CANDIDATE_HYPOTHESES,
      likelihood_by_hypothesis: neutralLikelihoods,
      log_likelihood_by_hypothesis: { GAS_FLARE: 0, INDUSTRIAL_FIRE: 0, AGRICULTURAL_BURN: 0, WILDFIRE_VEGETATION: 0, OTHER: 0 },
      likelihood_provenance: { GAS_FLARE: 'UNAVAILABLE', INDUSTRIAL_FIRE: 'UNAVAILABLE', AGRICULTURAL_BURN: 'UNAVAILABLE', WILDFIRE_VEGETATION: 'UNAVAILABLE', OTHER: 'UNAVAILABLE' },
      explanation: 'No historical multi-pass cluster data found within 1000m search radius.',
      is_incorporated: false,
    };
  }

  const isPersistent = persistence.is_persistent || persistence.status === 'PERSISTENT';
  const isRecurrent = persistence.status === 'RECURRENT';

  let likelihoods: Record<SourceHypothesisType, number>;
  let explanation = '';

  if (isPersistent) {
    likelihoods = {
      GAS_FLARE: 0.88,
      OTHER: 0.45,
      INDUSTRIAL_FIRE: 0.05,
      AGRICULTURAL_BURN: 0.01,
      WILDFIRE_VEGETATION: 0.01,
    };
    explanation = `Stationary multi-pass persistence confirmed (${persistence.cluster_observation_count ?? persistence.distinct_active_days ?? 'multiple'} historical passes across preceding 180-day window, excluding current observation). Characteristic of permanent flare stack infrastructure.`;
  } else if (isRecurrent) {
    likelihoods = {
      GAS_FLARE: 0.65,
      OTHER: 0.35,
      INDUSTRIAL_FIRE: 0.15,
      AGRICULTURAL_BURN: 0.08,
      WILDFIRE_VEGETATION: 0.08,
    };
    explanation = `Recurrent intermittent thermal emission detected across satellite overpasses in historical window (excluding current observation).`;
  } else {
    // Single transient pass
    likelihoods = {
      INDUSTRIAL_FIRE: 0.60,
      AGRICULTURAL_BURN: 0.70,
      WILDFIRE_VEGETATION: 0.70,
      OTHER: 0.35,
      GAS_FLARE: 0.15,
    };
    explanation = `Single transient thermal detection with zero prior persistent clustering in historical catalog.`;
  }

  const logLikelihoods: Record<SourceHypothesisType, number> = {} as any;
  for (const h of ALL_CANDIDATE_HYPOTHESES) {
    logLikelihoods[h] = Math.log(likelihoods[h]);
  }

  return {
    evidence_id: 'EVID-FAMILY-TEMPORAL-PERSISTENCE',
    evidence_family: 'TEMPORAL_PERSISTENCE',
    source: 'TEMPORAL_PERSISTENCE_ENGINE',
    feature_name: 'Multi-Pass Cluster Persistence',
    value: persistence,
    timestamp: new Date().toISOString(),
    provenance: 'DERIVED',
    independence_status: 'DERIVED',
    depends_on: ['HISTORICAL_VIIRS_ARCHIVE', 'TEMPORAL_PERSISTENCE_ENGINE'],
    reliability: 'HIGH',
    applicability: 'Historical multi-pass clustering context. Evaluated as derived contextual evidence; excluded from authoritative posterior calculation to avoid double-counting historical observation archives with facility baselines.',
    affected_hypotheses: ALL_CANDIDATE_HYPOTHESES,
    likelihood_by_hypothesis: likelihoods,
    log_likelihood_by_hypothesis: logLikelihoods,
    likelihood_provenance: {
      GAS_FLARE: 'DERIVED',
      INDUSTRIAL_FIRE: 'EXPERT_PRIOR',
      AGRICULTURAL_BURN: 'EXPERT_PRIOR',
      WILDFIRE_VEGETATION: 'EXPERT_PRIOR',
      OTHER: 'EXPERT_PRIOR',
    },
    explanation,
    is_incorporated: false,
  };
}

// E. INFRASTRUCTURE EVIDENCE FAMILY (OpenStreetMap Overpass)
export function evaluateInfrastructureLikelihood(
  osm?: OsmContextResponse | null
): BayesianEvidenceItem {
  if (
    !osm ||
    osm.status === 'NO_MAPPED_FEATURES' ||
    osm.status === 'NO_RELEVANT_FEATURES' ||
    osm.status === 'ACQUISITION_FAILED' ||
    osm.status === 'OSM_UNAVAILABLE' ||
    osm.status === 'OUT_OF_SCOPE' ||
    osm.status === 'NOT_CURRENTLY_AVAILABLE' ||
    osm.status === 'ERROR' ||
    !osm.features ||
    osm.features.length === 0
  ) {
    const neutralLikelihoods: Record<SourceHypothesisType, number> = {
      GAS_FLARE: 1.0,
      INDUSTRIAL_FIRE: 1.0,
      AGRICULTURAL_BURN: 1.0,
      WILDFIRE_VEGETATION: 1.0,
      OTHER: 1.0,
    };
    const explanation =
      osm?.status === 'NO_MAPPED_FEATURES' || osm?.status === 'NO_RELEVANT_FEATURES'
        ? 'OpenStreetMap returned 0 mapped infrastructure elements in search radius. Absence of mapped public infrastructure does not indicate absence of industrial activity in reality; evidence is neutral.'
        : osm?.status === 'OUT_OF_SCOPE'
        ? 'Observation coordinates outside active operational scope; infrastructure evidence is neutral.'
        : osm?.status === 'ACQUISITION_FAILED'
        ? 'OSM Overpass query timed out or was unreachable; contextual evidence acquisition failed. Contributes neutral likelihood.'
        : 'No mapped industrial infrastructure elements found in immediate search radius; neutral likelihood.';

    return {
      evidence_id: 'EVID-FAMILY-INFRASTRUCTURE-OSM',
      evidence_family: 'INFRASTRUCTURE',
      source: 'OPENSTREETMAP_OVERPASS_API',
      feature_name: 'Mapped Industrial Equipment & Infrastructure',
      value: { status: osm?.status || 'UNAVAILABLE', features_count: 0 },
      timestamp: osm?.provenance?.retrieval_timestamp || new Date().toISOString(),
      provenance: 'UNAVAILABLE',
      independence_status: 'UNAVAILABLE',
      depends_on: ['OPENSTREETMAP_OVERPASS_API'],
      reliability: 'LOW',
      applicability: 'OSM infrastructure features unavailable or absent; neutral likelihood.',
      affected_hypotheses: ALL_CANDIDATE_HYPOTHESES,
      likelihood_by_hypothesis: neutralLikelihoods,
      log_likelihood_by_hypothesis: { GAS_FLARE: 0, INDUSTRIAL_FIRE: 0, AGRICULTURAL_BURN: 0, WILDFIRE_VEGETATION: 0, OTHER: 0 },
      likelihood_provenance: { GAS_FLARE: 'UNAVAILABLE', INDUSTRIAL_FIRE: 'UNAVAILABLE', AGRICULTURAL_BURN: 'UNAVAILABLE', WILDFIRE_VEGETATION: 'UNAVAILABLE', OTHER: 'UNAVAILABLE' },
      explanation,
      is_incorporated: false,
    };
  }

  const elements = osm.features;
  const hasFlare = elements.some((el) => el.category === 'flare' || el.tags?.man_made === 'flare');
  const hasTank = elements.some((el) => el.category === 'storage_tank' || el.tags?.man_made === 'storage_tank');
  const hasChimney = elements.some((el) => el.category === 'chimney' || el.tags?.man_made === 'chimney');
  const hasWorks = elements.some((el) => el.category === 'works' || el.tags?.landuse === 'industrial');

  let likelihoods: Record<SourceHypothesisType, number>;
  let explanation = '';

  if (hasFlare) {
    likelihoods = {
      GAS_FLARE: 0.85,
      OTHER: 0.30,
      INDUSTRIAL_FIRE: 0.15,
      AGRICULTURAL_BURN: 0.005,
      WILDFIRE_VEGETATION: 0.005,
    };
    explanation = `OpenStreetMap verifies mapped flare stack infrastructure in immediate vicinity (${elements.length} mapped elements).`;
  } else if (hasTank) {
    likelihoods = {
      INDUSTRIAL_FIRE: 0.65,
      OTHER: 0.35,
      GAS_FLARE: 0.20,
      AGRICULTURAL_BURN: 0.01,
      WILDFIRE_VEGETATION: 0.01,
    };
    explanation = `OpenStreetMap verifies fuel storage tanks / process infrastructure nearby (${elements.length} mapped features).`;
  } else if (hasWorks || hasChimney) {
    likelihoods = {
      OTHER: 0.50,
      GAS_FLARE: 0.40,
      INDUSTRIAL_FIRE: 0.40,
      AGRICULTURAL_BURN: 0.02,
      WILDFIRE_VEGETATION: 0.02,
    };
    explanation = `OpenStreetMap verifies industrial works and chimney installations.`;
  } else {
    likelihoods = {
      AGRICULTURAL_BURN: 0.50,
      WILDFIRE_VEGETATION: 0.50,
      OTHER: 0.30,
      INDUSTRIAL_FIRE: 0.10,
      GAS_FLARE: 0.05,
    };
    explanation = `OpenStreetMap shows non-industrial or rural context.`;
  }

  const logLikelihoods: Record<SourceHypothesisType, number> = {} as any;
  for (const h of ALL_CANDIDATE_HYPOTHESES) {
    logLikelihoods[h] = Math.log(likelihoods[h]);
  }

  return {
    evidence_id: 'EVID-FAMILY-INFRASTRUCTURE-OSM',
    evidence_family: 'INFRASTRUCTURE',
    source: 'OPENSTREETMAP_OVERPASS_API',
    feature_name: 'Mapped Industrial Equipment & Infrastructure',
    value: { element_count: elements.length, categories: osm.categories_summary },
    timestamp: new Date().toISOString(),
    provenance: 'EXTERNAL',
    independence_status: 'CONDITIONALLY_INDEPENDENT',
    depends_on: ['OPENSTREETMAP_OVERPASS_API'],
    reliability: 'HIGH',
    applicability: 'Physical infrastructure grounding (flare stacks, fuel storage tanks, process furnaces).',
    affected_hypotheses: ALL_CANDIDATE_HYPOTHESES,
    likelihood_by_hypothesis: likelihoods,
    log_likelihood_by_hypothesis: logLikelihoods,
    likelihood_provenance: {
      GAS_FLARE: 'EXTERNAL',
      INDUSTRIAL_FIRE: 'EXTERNAL',
      AGRICULTURAL_BURN: 'EXTERNAL',
      WILDFIRE_VEGETATION: 'EXTERNAL',
      OTHER: 'EXTERNAL',
    },
    explanation,
    is_incorporated: true,
  };
}

// F. WEATHER EVIDENCE FAMILY (Open-Meteo ERA5 Reanalysis)
export function evaluateWeatherLikelihood(
  weather?: WeatherContextResponse | null
): BayesianEvidenceItem {
  if (!weather || weather.status === 'UNAVAILABLE') {
    const neutralLikelihoods: Record<SourceHypothesisType, number> = {
      GAS_FLARE: 1.0,
      INDUSTRIAL_FIRE: 1.0,
      AGRICULTURAL_BURN: 1.0,
      WILDFIRE_VEGETATION: 1.0,
      OTHER: 1.0,
    };
    return {
      evidence_id: 'EVID-FAMILY-WEATHER-ATMOSPHERIC',
      evidence_family: 'WEATHER',
      source: 'OPEN_METEO_HISTORICAL_API',
      feature_name: 'Atmospheric Wind & Surface Humidity',
      value: { status: 'UNAVAILABLE' },
      timestamp: new Date().toISOString(),
      provenance: 'UNAVAILABLE',
      independence_status: 'UNAVAILABLE',
      depends_on: ['OPEN_METEO_HISTORICAL_API'],
      reliability: 'LOW',
      applicability: 'Weather context unavailable; neutral likelihood.',
      affected_hypotheses: ALL_CANDIDATE_HYPOTHESES,
      likelihood_by_hypothesis: neutralLikelihoods,
      log_likelihood_by_hypothesis: { GAS_FLARE: 0, INDUSTRIAL_FIRE: 0, AGRICULTURAL_BURN: 0, WILDFIRE_VEGETATION: 0, OTHER: 0 },
      likelihood_provenance: { GAS_FLARE: 'UNAVAILABLE', INDUSTRIAL_FIRE: 'UNAVAILABLE', AGRICULTURAL_BURN: 'UNAVAILABLE', WILDFIRE_VEGETATION: 'UNAVAILABLE', OTHER: 'UNAVAILABLE' },
      explanation: 'Meteorological data unavailable; evidence is neutral.',
      is_incorporated: false,
    };
  }

  const windSpeed = weather.metrics?.wind_speed_kmh ?? (weather as any).wind_speed_10m_kmh ?? (weather as any).wind_speed_kmh ?? 0;
  const humidity = weather.metrics?.relative_humidity_pct ?? (weather as any).relative_humidity_pct ?? 50;

  // Likelihood adjustments based on high fire weather risk:
  // High winds and low humidity increase probability of open vegetative/structural fire spread
  let likelihoods: Record<SourceHypothesisType, number>;
  if (windSpeed > 25 && humidity < 30) {
    likelihoods = {
      WILDFIRE_VEGETATION: 0.85,
      AGRICULTURAL_BURN: 0.70,
      INDUSTRIAL_FIRE: 0.55,
      GAS_FLARE: 0.30,
      OTHER: 0.30,
    };
  } else if (humidity < 35) {
    likelihoods = {
      AGRICULTURAL_BURN: 0.65,
      WILDFIRE_VEGETATION: 0.60,
      INDUSTRIAL_FIRE: 0.40,
      GAS_FLARE: 0.40,
      OTHER: 0.35,
    };
  } else {
    // Normal ambient atmospheric state
    likelihoods = {
      GAS_FLARE: 0.50,
      INDUSTRIAL_FIRE: 0.40,
      AGRICULTURAL_BURN: 0.50,
      WILDFIRE_VEGETATION: 0.45,
      OTHER: 0.40,
    };
  }

  const logLikelihoods: Record<SourceHypothesisType, number> = {} as any;
  for (const h of ALL_CANDIDATE_HYPOTHESES) {
    logLikelihoods[h] = Math.log(likelihoods[h]);
  }

  return {
    evidence_id: 'EVID-FAMILY-WEATHER-ATMOSPHERIC',
    evidence_family: 'WEATHER',
    source: 'OPEN_METEO_HISTORICAL_API',
    feature_name: 'Atmospheric Wind & Surface Humidity',
    value: { wind_speed_kmh: windSpeed, relative_humidity_pct: humidity, dispersion: weather.atmospheric_assessment?.dispersion_potential },
    unit: 'km/h, %',
    timestamp: weather.retrieved_at_utc || new Date().toISOString(),
    provenance: 'EXTERNAL',
    independence_status: 'INDEPENDENT',
    depends_on: ['OPEN_METEO_HISTORICAL_API'],
    reliability: 'HIGH',
    applicability: 'Governs combustion spread risk and atmospheric open-air plume advection.',
    affected_hypotheses: ['INDUSTRIAL_FIRE', 'AGRICULTURAL_BURN', 'WILDFIRE_VEGETATION'],
    likelihood_by_hypothesis: likelihoods,
    log_likelihood_by_hypothesis: logLikelihoods,
    likelihood_provenance: {
      GAS_FLARE: 'EXTERNAL',
      INDUSTRIAL_FIRE: 'EXTERNAL',
      AGRICULTURAL_BURN: 'EXTERNAL',
      WILDFIRE_VEGETATION: 'EXTERNAL',
      OTHER: 'EXTERNAL',
    },
    explanation: `Surface weather: wind ${windSpeed.toFixed(1)} km/h, humidity ${humidity.toFixed(0)}%. ${weather.atmospheric_assessment?.summary || ''}`,
    is_incorporated: true,
  };
}

// G. MACHINE LEARNING ADVISORY EVIDENCE FAMILY
// Architecture (Day 1C): ML Advisory is a DERIVED signal sharing underlying VIIRS features with
// RADIOMETRY and SPATIAL_CONTEXT. To preserve Bayesian conditional independence, it is excluded
// from authoritative posterior multiplication (is_incorporated = false, independence_status = 'DERIVED')
// but retained for diagnostic comparison, conflict detection, and explanation.
export function evaluateMLAdvisoryLikelihood(
  ml?: ThermalSourceDiscriminatorOutput | null
): BayesianEvidenceItem {
  const status = ml?.status ?? (ml as any)?.prediction_status;
  const isAvailable = status === 'AVAILABLE';
  const predictedClass = ml?.predicted_class;

  if (!ml || !isAvailable || !predictedClass) {
    const neutralLikelihoods: Record<SourceHypothesisType, number> = {
      GAS_FLARE: 1.0,
      INDUSTRIAL_FIRE: 1.0,
      AGRICULTURAL_BURN: 1.0,
      WILDFIRE_VEGETATION: 1.0,
      OTHER: 1.0,
    };
    return {
      evidence_id: 'EVID-FAMILY-ML-ADVISORY',
      evidence_family: 'ML_ADVISORY',
      source: 'THERMAL_SOURCE_DISCRIMINATOR_LR',
      feature_name: 'Radiometric Logistic Regression Advisory Signal',
      value: { status: status || 'NOT_ASSESSED', coverage_status: ml?.coverage_status || 'NOT_ASSESSED' },
      timestamp: new Date().toISOString(),
      provenance: 'UNAVAILABLE',
      independence_status: 'UNAVAILABLE',
      depends_on: ['RADIOMETRY', 'SPATIAL_CONTEXT'],
      reliability: 'LOW',
      applicability: 'ML advisory unavailable or out-of-scope; neutral advisory signal.',
      affected_hypotheses: ALL_CANDIDATE_HYPOTHESES,
      likelihood_by_hypothesis: neutralLikelihoods,
      log_likelihood_by_hypothesis: { GAS_FLARE: 0, INDUSTRIAL_FIRE: 0, AGRICULTURAL_BURN: 0, WILDFIRE_VEGETATION: 0, OTHER: 0 },
      likelihood_provenance: { GAS_FLARE: 'UNAVAILABLE', INDUSTRIAL_FIRE: 'UNAVAILABLE', AGRICULTURAL_BURN: 'UNAVAILABLE', WILDFIRE_VEGETATION: 'UNAVAILABLE', OTHER: 'UNAVAILABLE' },
      explanation: ml?.interpretation || (ml as any)?.status_reason || 'ML discriminator is out of scope or feature inputs were incomplete.',
      is_incorporated: false,
    };
  }

  // Model is binary: GAS_FLARE vs WILDFIRE_CONFIRMED
  // Map binary score into diagnostic likelihood space
  const isFlare = predictedClass === 'GAS_FLARE';
  const flareScore = ml.flare_score ?? (ml as any).gas_flare_probability ?? 0.5;
  const wildScore = ml.wildfire_score ?? (ml as any).wildfire_probability ?? 0.5;

  let likelihoods: Record<SourceHypothesisType, number>;
  let explanation = '';

  if (isFlare) {
    likelihoods = {
      GAS_FLARE: Math.min(0.95, 0.70 + 0.25 * flareScore),
      OTHER: 0.40,
      INDUSTRIAL_FIRE: 0.15,
      AGRICULTURAL_BURN: 0.05,
      WILDFIRE_VEGETATION: 0.02,
    };
    explanation = `Diagnostic ML advisory (${ml.model_id || 'lr-v5f3'}): Strong Gas Flare signal (${(flareScore * 100).toFixed(1)}%). Evaluated as derived advisory metadata; excluded from authoritative posterior to prevent collinear double-counting with RADIOMETRY.`;
  } else {
    // Wildfire-side prediction (high contrast / high energetic radiance)
    likelihoods = {
      WILDFIRE_VEGETATION: Math.min(0.95, 0.70 + 0.25 * wildScore),
      AGRICULTURAL_BURN: 0.65,
      INDUSTRIAL_FIRE: 0.55,
      OTHER: 0.15,
      GAS_FLARE: 0.04,
    };
    explanation = `Diagnostic ML advisory (${ml.model_id || 'lr-v5f3'}): Wildfire-side signal (${(wildScore * 100).toFixed(1)}%). Evaluated as derived advisory metadata; excluded from authoritative posterior to prevent collinear double-counting with RADIOMETRY.`;
  }

  const logLikelihoods: Record<SourceHypothesisType, number> = {} as any;
  for (const h of ALL_CANDIDATE_HYPOTHESES) {
    logLikelihoods[h] = Math.log(likelihoods[h]);
  }

  return {
    evidence_id: 'EVID-FAMILY-ML-ADVISORY',
    evidence_family: 'ML_ADVISORY',
    source: 'THERMAL_SOURCE_DISCRIMINATOR_LR',
    feature_name: 'Radiometric Logistic Regression Advisory Signal',
    value: {
      model_id: ml.model_id,
      predicted_class: ml.predicted_class,
      flare_score: flareScore,
      wildfire_score: wildScore,
    },
    timestamp: ml.timestamp || new Date().toISOString(),
    provenance: 'DERIVED',
    independence_status: 'DERIVED',
    depends_on: ['RADIOMETRY', 'SPATIAL_CONTEXT'],
    reliability: 'HIGH',
    applicability: 'Diagnostic cross-check; excluded from posterior calculation to prevent double-counting shared VIIRS features.',
    affected_hypotheses: ALL_CANDIDATE_HYPOTHESES,
    likelihood_by_hypothesis: likelihoods,
    log_likelihood_by_hypothesis: logLikelihoods,
    likelihood_provenance: {
      GAS_FLARE: 'DERIVED',
      WILDFIRE_VEGETATION: 'DERIVED',
      INDUSTRIAL_FIRE: 'EXPERT_PRIOR',
      AGRICULTURAL_BURN: 'EXPERT_PRIOR',
      OTHER: 'EXPERT_PRIOR',
    },
    explanation,
    is_incorporated: false,
  };
}

// H. OPTICAL SWIR MULTISPECTRAL EVIDENCE FAMILY (Sentinel-2)
export function evaluateOpticalSwirLikelihood(
  sentinel?: Sentinel2SwirResponse | null
): BayesianEvidenceItem {
  const isDistant = sentinel?.temporal_status === 'TEMPORALLY_DISTANT' || sentinel?.is_event_adjacent === false;

  if (!sentinel || sentinel.status === 'ERROR' || !sentinel.evidence_findings || isDistant) {
    const neutralLikelihoods: Record<SourceHypothesisType, number> = {
      GAS_FLARE: 1.0,
      INDUSTRIAL_FIRE: 1.0,
      AGRICULTURAL_BURN: 1.0,
      WILDFIRE_VEGETATION: 1.0,
      OTHER: 1.0,
    };
    return {
      evidence_id: 'EVID-FAMILY-OPTICAL-SWIR',
      evidence_family: 'OPTICAL',
      source: 'COPERNICUS_SENTINEL_2_MSI',
      feature_name: 'Multispectral SWIR 20m Spatial Inspection',
      value: { status: isDistant ? 'TEMPORALLY_DISTANT' : (sentinel?.status || 'UNAVAILABLE'), findings: sentinel?.evidence_findings },
      timestamp: sentinel?.acquisition_timestamp || new Date().toISOString(),
      provenance: isDistant && (sentinel?.status === 'AUTHENTIC_LIVE' || sentinel?.is_live_external) ? 'EXTERNAL' : 'UNAVAILABLE',
      independence_status: isDistant ? 'CONTROLLED' : 'UNAVAILABLE',
      depends_on: ['COPERNICUS_SENTINEL_2_MSI'],
      reliability: 'LOW',
      applicability: isDistant
        ? 'Sentinel-2 scene is temporally distant from FIRMS event; retained as non-incorporated contextual imagery.'
        : 'Sentinel-2 SWIR imagery unavailable; neutral likelihood.',
      affected_hypotheses: ALL_CANDIDATE_HYPOTHESES,
      likelihood_by_hypothesis: neutralLikelihoods,
      log_likelihood_by_hypothesis: { GAS_FLARE: 0, INDUSTRIAL_FIRE: 0, AGRICULTURAL_BURN: 0, WILDFIRE_VEGETATION: 0, OTHER: 0 },
      likelihood_provenance: { GAS_FLARE: 'UNAVAILABLE', INDUSTRIAL_FIRE: 'UNAVAILABLE', AGRICULTURAL_BURN: 'UNAVAILABLE', WILDFIRE_VEGETATION: 'UNAVAILABLE', OTHER: 'UNAVAILABLE' },
      explanation: isDistant
        ? `Temporally distant Sentinel-2 pass (${sentinel?.temporal_difference_human || 'stale'}). Retained as contextual baseline only; excluded from event-level Bayesian posterior.`
        : 'No contemporaneous Sentinel-2 MSI SWIR overpass available.',
      is_incorporated: false,
    };
  }

  const findings = sentinel.evidence_findings;
  const isUncontained = findings.uncontained_spread === true;
  const isExpanded = findings.spatial_expansion === true;
  const pattern = findings.swir_thermal_pattern || '';

  let likelihoods: Record<SourceHypothesisType, number>;
  let explanation = '';

  if (isUncontained || pattern.includes('ground_fire') || pattern.includes('diffuse')) {
    likelihoods = {
      INDUSTRIAL_FIRE: 0.92,
      WILDFIRE_VEGETATION: 0.45,
      OTHER: 0.10,
      AGRICULTURAL_BURN: 0.05,
      GAS_FLARE: 0.02,
    };
    explanation = `Sentinel-2 20m SWIR inspection reveals diffuse ground-level thermal bloom across storage bunds/process area. Rules out localized point-source flare stack.`;
  } else if (pattern.includes('point_flare') || pattern.includes('stack')) {
    likelihoods = {
      GAS_FLARE: 0.94,
      OTHER: 0.20,
      INDUSTRIAL_FIRE: 0.04,
      AGRICULTURAL_BURN: 0.001,
      WILDFIRE_VEGETATION: 0.001,
    };
    explanation = `Sentinel-2 20m SWIR inspection confirms localized point-source saturation on elevated flare stack. Zero ground-level spread.`;
  } else {
    // General optical surface context
    likelihoods = {
      GAS_FLARE: 0.50,
      INDUSTRIAL_FIRE: 0.50,
      AGRICULTURAL_BURN: 0.40,
      WILDFIRE_VEGETATION: 0.40,
      OTHER: 0.30,
    };
    explanation = `Sentinel-2 inspection provided surface context without conclusive point-vs-diffuse discrimination.`;
  }

  const logLikelihoods: Record<SourceHypothesisType, number> = {} as any;
  for (const h of ALL_CANDIDATE_HYPOTHESES) {
    logLikelihoods[h] = Math.log(likelihoods[h]);
  }

  return {
    evidence_id: 'EVID-FAMILY-OPTICAL-SWIR',
    evidence_family: 'OPTICAL',
    source: 'COPERNICUS_SENTINEL_2_MSI',
    feature_name: 'Multispectral SWIR 20m Spatial Inspection',
    value: { scene_id: sentinel.scene_id, findings },
    timestamp: sentinel.acquisition_timestamp || new Date().toISOString(),
    provenance: sentinel.status === 'AUTHENTIC_LIVE' ? 'EXTERNAL' : 'DERIVED',
    independence_status: 'INDEPENDENT',
    depends_on: ['COPERNICUS_SENTINEL_2_MSI'],
    reliability: 'HIGH',
    applicability: 'High-resolution optical/SWIR discrimination of elevated stack vs uncontained surface fire.',
    affected_hypotheses: ALL_CANDIDATE_HYPOTHESES,
    likelihood_by_hypothesis: likelihoods,
    log_likelihood_by_hypothesis: logLikelihoods,
    likelihood_provenance: {
      GAS_FLARE: 'EXTERNAL',
      INDUSTRIAL_FIRE: 'EXPERT_PRIOR',
      AGRICULTURAL_BURN: 'EXPERT_PRIOR',
      WILDFIRE_VEGETATION: 'EXPERT_PRIOR',
      OTHER: 'EXPERT_PRIOR',
    },
    explanation,
    is_incorporated: true,
  };
}

/**
 * ----------------------------------------------------------------------------
 * 3. STRUCTURED CONFLICT DETECTOR
 * ----------------------------------------------------------------------------
 */
export function detectBayesianEvidenceConflicts(params: {
  posteriorProbabilities: Record<SourceHypothesisType, number>;
  evidenceItems: BayesianEvidenceItem[];
  mlDiscriminator?: ThermalSourceDiscriminatorOutput | null;
}): StructuredEvidenceConflict {
  const { posteriorProbabilities, evidenceItems, mlDiscriminator } = params;

  // Find top hypothesis and runner up
  const sorted = ALL_CANDIDATE_HYPOTHESES
    .map((h) => ({ hypothesis: h, prob: posteriorProbabilities[h] }))
    .sort((a, b) => b.prob - a.prob);

  const top = sorted[0];
  const runnerUp = sorted[1];

  // Conflict 1: Spatial/Baseline strongly supports Industrial Fire inside facility, but ML radiometry indicates Wildfire
  const isMlAvailable = (mlDiscriminator?.status === 'AVAILABLE' || (mlDiscriminator as any)?.prediction_status === 'AVAILABLE');
  const mlPred = mlDiscriminator?.predicted_class;
  const mlWildScore = mlDiscriminator?.wildfire_score ?? (mlDiscriminator as any)?.wildfire_probability ?? 0;
  const mlFlareScore = mlDiscriminator?.flare_score ?? (mlDiscriminator as any)?.gas_flare_probability ?? 0;

  if (isMlAvailable && mlPred === 'WILDFIRE_CONFIRMED' && (top.hypothesis === 'INDUSTRIAL_FIRE' || top.hypothesis === 'GAS_FLARE')) {
    return {
      has_conflict: true,
      severity: 'HIGH',
      conflicting_sources: [
        'FACILITY_GEOMETRY_REGISTRY',
        'THERMAL_SOURCE_DISCRIMINATOR_LR',
      ],
      hypotheses_involved: [top.hypothesis, 'WILDFIRE_VEGETATION'],
      reason: `Spatial containment and facility association indicate ${HYPOTHESIS_DISPLAY_LABELS[top.hypothesis]} (${Math.round(top.prob * 100)}%), while radiometric ML discriminator outputs a Wildfire-side score (${Math.round(mlWildScore * 100)}%). Analytical cause: Uncontained industrial fire is outside the binary training scope (Gas Flare ↔ Wildfire); high energetic ground heat triggers the wildfire-side score.`,
      contextual_leading_hypothesis: HYPOTHESIS_DISPLAY_LABELS[top.hypothesis],
      contextual_support_pct: Math.round(top.prob * 100),
      discriminator_class: 'Wildfire-side signal',
      discriminator_score_pct: Math.round(mlWildScore * 100),
      resolution_requirement: 'Acquire Next-Best-Evidence (Sentinel-2 20m SWIR optical inspection or operational SCADA logs) to resolve emitter geometry.',
    };
  }

  // Conflict 2: Contextual land context favors Wildfire/Vegetation while ML radiometry indicates Gas Flare
  if (isMlAvailable && mlPred === 'GAS_FLARE' && (top.hypothesis === 'WILDFIRE_VEGETATION' || top.hypothesis === 'AGRICULTURAL_BURN')) {
    return {
      has_conflict: true,
      severity: 'MODERATE',
      conflicting_sources: [
        'REGIONAL_LAND_COVER',
        'THERMAL_SOURCE_DISCRIMINATOR_LR',
      ],
      hypotheses_involved: [top.hypothesis, 'GAS_FLARE'],
      reason: `Regional land context favors ${HYPOTHESIS_DISPLAY_LABELS[top.hypothesis]} (${Math.round(top.prob * 100)}%), but radiometric features align with point-source flaring (${Math.round(mlFlareScore * 100)}%).`,
      contextual_leading_hypothesis: HYPOTHESIS_DISPLAY_LABELS[top.hypothesis],
      contextual_support_pct: Math.round(top.prob * 100),
      discriminator_class: 'Gas Flare',
      discriminator_score_pct: Math.round(mlFlareScore * 100),
      resolution_requirement: 'Query OpenStreetMap Overpass or satellite imagery to verify unmapped industrial infrastructure.',
    };
  }

  // Conflict 3: Physical Evidence Conflict across Evidence Families (e.g. Spatial Flare/Facility vs Extreme Wildfire Radiometry/Weather)
  const spatialEvid = evidenceItems.find(e => e.evidence_family === 'SPATIAL_CONTEXT');
  const weatherEvid = evidenceItems.find(e => e.evidence_family === 'WEATHER');
  const radEvid = evidenceItems.find(e => e.evidence_family === 'RADIOMETRY');

  const spatialSupportsFlare = (spatialEvid?.likelihood_by_hypothesis?.GAS_FLARE ?? 0) >= 0.40;
  const weatherSupportsWildfire = (weatherEvid?.likelihood_by_hypothesis?.WILDFIRE_VEGETATION ?? 0) >= 0.65;
  const radSupportsWildfire = (radEvid?.likelihood_by_hypothesis?.WILDFIRE_VEGETATION ?? 0) >= 0.65;

  if (spatialSupportsFlare && (weatherSupportsWildfire || radSupportsWildfire)) {
    return {
      has_conflict: true,
      severity: 'MODERATE',
      conflicting_sources: [
        'FACILITY_GEOMETRY_REGISTRY',
        weatherSupportsWildfire ? 'ATMOSPHERIC_WEATHER_REANALYSIS' : 'RADIOMETRIC_INTENSITY_ANALYTICS',
      ],
      hypotheses_involved: ['GAS_FLARE', 'WILDFIRE_VEGETATION', 'INDUSTRIAL_FIRE'],
      reason: 'Spatial proximity suggests facility process flaring, but extreme combustion energy and critical fire weather indicate rapid open vegetative/structural combustion spread.',
      contextual_leading_hypothesis: HYPOTHESIS_DISPLAY_LABELS[top.hypothesis],
      contextual_support_pct: Math.round(top.prob * 100),
      resolution_requirement: 'Multi-spectral spatial inspection required to confirm if fire is inside facility perimeter.',
    };
  }

  // Conflict 4: High-entropy close competition between divergent hypotheses
  if (top.prob < 0.60 && runnerUp.prob > 0.25) {
    return {
      has_conflict: true,
      severity: 'LOW',
      conflicting_sources: ['CROSS_FAMILY_EVIDENCE_SYNTHESIS'],
      hypotheses_involved: [top.hypothesis, runnerUp.hypothesis],
      reason: `Competing evidence distributions between ${HYPOTHESIS_DISPLAY_LABELS[top.hypothesis]} (${Math.round(top.prob * 100)}%) and ${HYPOTHESIS_DISPLAY_LABELS[runnerUp.hypothesis]} (${Math.round(runnerUp.prob * 100)}%).`,
      contextual_leading_hypothesis: HYPOTHESIS_DISPLAY_LABELS[top.hypothesis],
      contextual_support_pct: Math.round(top.prob * 100),
      resolution_requirement: 'Acquire supplementary high-resolution optical or temporal evidence.',
    };
  }

  return {
    has_conflict: false,
    severity: 'NONE',
    conflicting_sources: [],
    hypotheses_involved: [],
    reason: 'Evidence sources are in directional agreement.',
    contextual_leading_hypothesis: HYPOTHESIS_DISPLAY_LABELS[top.hypothesis],
    contextual_support_pct: Math.round(top.prob * 100),
    resolution_requirement: 'Routine operational monitoring.',
  };
}

/**
 * ----------------------------------------------------------------------------
 * 4. MAIN AUTHORITATIVE BAYESIAN INFERENCE ENGINE
 * ----------------------------------------------------------------------------
 */
export function evaluateBayesianSourceHypotheses(input: BayesianInferenceInput): BayesianPosteriorResult {
  // 1. Get Prior Distribution
  const priorResult = getPriorDistribution({
    spatial_association: input.spatial_association,
    is_inside_polygon: input.is_inside_polygon,
    facility_category: input.facility_category,
    user_priors: input.user_priors,
  });

  // 2. Evaluate Evidence Items across Families
  const evidenceItems: BayesianEvidenceItem[] = [];

  if (input.custom_evidence_only) {
    if (input.additional_evidence_items) {
      for (const item of input.additional_evidence_items) {
        evidenceItems.push(item);
      }
    }
  } else {
    // Family 1: Radiometry
    evidenceItems.push(
      evaluateRadiometryLikelihood({
        frp: input.frp,
        day_night: input.day_night,
        brightness_ti4: input.brightness_ti4,
        brightness_ti5: input.brightness_ti5,
        brightness_delta: input.brightness_delta,
      })
    );

    // Family 2: Spatial Context
    evidenceItems.push(
      evaluateSpatialContextLikelihood({
        spatial_association: input.spatial_association,
        distance_to_zone_meters: input.distance_to_zone_meters,
        distance_to_facility_meters: input.distance_to_facility_meters,
        matched_zone_name: input.matched_zone_name,
        is_inside_polygon: input.is_inside_polygon,
      })
    );

    // Family 3: Behavioural Baseline
    evidenceItems.push(
      evaluateBehaviouralBaselineLikelihood({
        behavioural_status: input.behavioural_status,
        baseline: input.baseline,
        frp: input.frp,
      })
    );

    // Family 4: Temporal Persistence
    if (input.persistence_context) {
      evidenceItems.push(evaluateTemporalPersistenceLikelihood(input.persistence_context));
    }

    // Family 5: Infrastructure (OSM)
    if (input.osm_context) {
      evidenceItems.push(evaluateInfrastructureLikelihood(input.osm_context));
    }

    // Family 6: Weather
    if (input.weather_context) {
      evidenceItems.push(evaluateWeatherLikelihood(input.weather_context));
    }

    // Family 7: Optical SWIR
    if (input.sentinel_context) {
      evidenceItems.push(evaluateOpticalSwirLikelihood(input.sentinel_context));
    }

    // Family 8: ML Advisory
    if (input.ml_discriminator) {
      evidenceItems.push(evaluateMLAdvisoryLikelihood(input.ml_discriminator));
    }

    // Append any extra user-specified evidence items
    if (input.additional_evidence_items) {
      for (const item of input.additional_evidence_items) {
        evidenceItems.push(item);
      }
    }
  }

  // 3. Filter to incorporated evidence items vs advisory items
  // Authoritative Bayesian calculation strictly includes conditionally independent evidence items.
  // DERIVED signals (such as ML_ADVISORY, BEHAVIOURAL_BASELINE, TEMPORAL_PERSISTENCE) sharing features
  // with RADIOMETRY, SPATIAL_CONTEXT, or historical archives are segregated into advisory_evidence_items
  // to prevent collinear and historical archive double-counting.
  const incorporated = evidenceItems.filter(
    (e) => e.is_incorporated && e.independence_status !== 'DERIVED' && e.independence_status !== 'UNAVAILABLE' && e.independence_status !== 'CONTROLLED'
  );

  const advisoryItems = evidenceItems.filter(
    (e) => e.evidence_family === 'ML_ADVISORY' || e.independence_status === 'DERIVED' || e.independence_status === 'CONTROLLED' || !e.is_incorporated
  );

  // 4. Log-Space Bayesian Computation
  // logScore(H) = log(P(H)) + sum_i log P(E_i | H)
  const logScores: Record<SourceHypothesisType, number> = {
    GAS_FLARE: priorResult.priors.GAS_FLARE.log_probability,
    INDUSTRIAL_FIRE: priorResult.priors.INDUSTRIAL_FIRE.log_probability,
    AGRICULTURAL_BURN: priorResult.priors.AGRICULTURAL_BURN.log_probability,
    WILDFIRE_VEGETATION: priorResult.priors.WILDFIRE_VEGETATION.log_probability,
    OTHER: priorResult.priors.OTHER.log_probability,
  };

  for (const item of incorporated) {
    for (const h of ALL_CANDIDATE_HYPOTHESES) {
      const logL = item.log_likelihood_by_hypothesis[h] ?? 0;
      logScores[h] += logL;
    }
  }

  // 5. Normalization via Log-Sum-Exp
  const allLogScores = ALL_CANDIDATE_HYPOTHESES.map((h) => logScores[h]);
  const logZ = logSumExp(allLogScores);

  const posteriors: Record<SourceHypothesisType, number> = {} as any;
  for (const h of ALL_CANDIDATE_HYPOTHESES) {
    const logP = logScores[h] - logZ;
    posteriors[h] = Math.exp(logP);
  }

  // Renormalize strictly to 1.0 (float) and build integer percentages preserving 100% sum
  const sumPost = Object.values(posteriors).reduce((a, b) => a + b, 0);
  for (const h of ALL_CANDIDATE_HYPOTHESES) {
    posteriors[h] = posteriors[h] / sumPost;
  }

  // Integer percentage rounding preserving exact 100 sum
  const rawPcts: Record<SourceHypothesisType, number> = {} as any;
  const floored: Record<SourceHypothesisType, number> = {} as any;
  const remainders: Array<{ h: SourceHypothesisType; rem: number }> = [];
  let flooredSum = 0;

  for (const h of ALL_CANDIDATE_HYPOTHESES) {
    const rawPct = posteriors[h] * 100;
    rawPcts[h] = rawPct;
    const fl = Math.floor(rawPct);
    floored[h] = fl;
    flooredSum += fl;
    remainders.push({ h, rem: rawPct - fl });
  }

  let remDist = 100 - flooredSum;
  remainders.sort((a, b) => b.rem - a.rem);
  for (let i = 0; i < remDist; i++) {
    floored[remainders[i % remainders.length].h] += 1;
  }

  // 6. Build ContextualHypothesisItem array
  const featureMap: Record<EvidenceFamily, string> = {
    SPATIAL_CONTEXT: 'spatial_facility_relationship',
    TEMPORAL_PERSISTENCE: 'temporal_persistence_repetition',
    BEHAVIOURAL_BASELINE: 'historical_behaviour_deviation',
    RADIOMETRY: 'radiometry_intensity',
    WEATHER: 'weather_fire_risk',
    OPTICAL: 'optical_swir_footprint',
    ML_ADVISORY: 'ml_radiometric_classification',
    INFRASTRUCTURE: 'osm_infrastructure_context',
    LAND_CONTEXT: 'land_cover_context',
    OPERATIONAL_CONTEXT: 'operational_context',
  };

  const evaluatedItems = evidenceItems.filter((e) => e.independence_status !== 'UNAVAILABLE');

  const hypothesesDistribution: ContextualHypothesisItem[] = ALL_CANDIDATE_HYPOTHESES.map((h) => {
    const pct = floored[h];
    const normScore = Math.round(posteriors[h] * 1000) / 1000;
    const reasons: string[] = [];

    // Collect feature contribution reasons for this hypothesis
    for (const item of evaluatedItems) {
      const l = item.likelihood_by_hypothesis[h];
      if (l >= 0.70) {
        reasons.push(`${item.feature_name}: High likelihood P(E|${h})=${l.toFixed(2)} (${item.explanation})`);
      } else if (l <= 0.10) {
        reasons.push(`${item.feature_name}: Low likelihood P(E|${h})=${l.toFixed(2)} (${item.explanation})`);
      }
    }

    const featureContribs: HypothesisFeatureContribution[] = evaluatedItems.map((item) => {
      const l = item.likelihood_by_hypothesis[h] ?? 1.0;
      const featureKey = featureMap[item.evidence_family] || item.feature_name;
      const isPositive = l >= 0.40;
      return {
        feature: featureKey,
        delta: isPositive ? Math.round(l * 40) : -Math.round((1 - l) * 40),
        direction: l >= 0.50 ? 'SUPPORTS' : l <= 0.20 ? 'OPPOSES' : 'NEUTRAL',
        reason: item.explanation,
      };
    });

    const supporting_evidence = evaluatedItems
      .filter((item) => (item.likelihood_by_hypothesis[h] ?? 1.0) >= 0.40)
      .map((item) => `${item.feature_name}: ${item.explanation}`);

    const opposing_evidence = evaluatedItems
      .filter((item) => (item.likelihood_by_hypothesis[h] ?? 1.0) <= 0.20)
      .map((item) => `${item.feature_name}: Low likelihood P(E|${h})=${item.likelihood_by_hypothesis[h].toFixed(2)} (${item.explanation})`);

    return {
      hypothesis: h,
      label: HYPOTHESIS_DISPLAY_LABELS[h],
      raw_support_score: Math.round(logScores[h] * 100) / 100,
      normalized_score: normScore,
      percentage: pct,
      support_level:
        pct >= 70 ? 'VERY_HIGH' : pct >= 45 ? 'HIGH' : pct >= 20 ? 'MODERATE' : pct >= 5 ? 'LOW' : 'MINIMAL',
      reasons,
      feature_contributions: featureContribs,
      supporting_evidence,
      opposing_evidence,
    };
  }).sort((a, b) => b.percentage - a.percentage);

  // Top hypothesis
  const topItem = hypothesesDistribution[0];

  // 7. Calculate Exact Shannon Entropy on Bayesian Posterior
  const probList = ALL_CANDIDATE_HYPOTHESES.map((h) => posteriors[h]);
  const entropyResult = calculateBayesianShannonEntropy(probList);

  const uncertaintyLevel: 'LOW' | 'MODERATE' | 'HIGH' =
    topItem.percentage >= 70 || entropyResult.normalized_entropy < 0.35
      ? 'LOW'
      : topItem.percentage >= 45 || entropyResult.normalized_entropy <= 0.65
      ? 'MODERATE'
      : 'HIGH';

  let uncertaintySummary = '';
  let interpretation = '';
  if (uncertaintyLevel === 'LOW') {
    uncertaintySummary = `Low Uncertainty (${entropyResult.entropy_bits.toFixed(3)} bits, ${Math.round(entropyResult.normalized_entropy * 100)}% normalized)`;
    interpretation = `Low Shannon entropy indicates concentrated Bayesian posterior support under ${topItem.label} (${topItem.percentage}%).`;
  } else if (uncertaintyLevel === 'MODERATE') {
    uncertaintySummary = `Moderate Uncertainty (${entropyResult.entropy_bits.toFixed(3)} bits, ${Math.round(entropyResult.normalized_entropy * 100)}% normalized)`;
    interpretation = `Moderate Shannon entropy indicates competing explanations between ${topItem.label} (${topItem.percentage}%) and secondary candidates. Next-Best-Evidence acquisition is recommended.`;
  } else {
    uncertaintySummary = `High Uncertainty (${entropyResult.entropy_bits.toFixed(3)} bits, ${Math.round(entropyResult.normalized_entropy * 100)}% normalized)`;
    interpretation = `High Shannon entropy indicates substantial ambiguity across multiple hypotheses. High-utility evidence is required to resolve competing source mechanisms.`;
  }

  const uncertainty: UncertaintyAssessment = {
    entropy_bits: entropyResult.entropy_bits,
    max_possible_entropy_bits: entropyResult.max_possible_entropy_bits,
    normalized_entropy: entropyResult.normalized_entropy,
    uncertainty_level: uncertaintyLevel,
    is_ambiguous: uncertaintyLevel !== 'LOW',
    summary: uncertaintySummary,
    interpretation,
    competing_hypotheses_count: hypothesesDistribution.filter((h) => h.percentage >= 15).length,
    active_hypotheses_count: hypothesesDistribution.filter((h) => h.percentage > 0).length,
  };

  // 8. Detect Structured Evidence Conflict (Evaluates Authoritative Posterior vs Diagnostic ML)
  const conflict = detectBayesianEvidenceConflicts({
    posteriorProbabilities: posteriors,
    evidenceItems,
    mlDiscriminator: input.ml_discriminator,
  });

  // 9. Rationales
  const rationales = hypothesesDistribution.map((h) => ({
    hypothesis: h.hypothesis,
    score: h.percentage,
    rationale:
      h.reasons && h.reasons.length > 0
        ? h.reasons.join(' ')
        : `Posterior Bayesian probability evaluated from spatially invariant uniform prior and ${incorporated.length} conditionally independent evidence families.`,
  }));

  // 10. Model Registry Metadata
  const modelRegistry: BayesianModelMetadata = {
    model_id: 'bayesian-source-inference-v1',
    version: '1.1.0',
    hypothesis_space: ALL_CANDIDATE_HYPOTHESES,
    inference_type: 'LOG_SPACE_BAYESIAN_POSTERIOR',
    formula: 'P(H|E) = exp(log P(H) + sum_{E_i in E_indep} log P(E_i|H) - logSumExp)',
    prior_provenance: priorResult.provenance,
    empirical_sources: [
      'NASA FIRMS VIIRS 375m active fire radiometry',
      'Jamnagar 294 historical VIIRS observations (2026-01-01 to 2026-04-22)',
      '155 EOG-matched gas flaring instances',
      '2,828 WFIGS-matched wildfire instances across 17 US fire complexes',
      'Open-Meteo ERA5 atmospheric weather reanalysis',
      'OpenStreetMap Overpass industrial infrastructure',
    ],
    expert_assumptions: [
      'Spatially invariant uniform base prior (0.20 per hypothesis) to prevent spatial prior double-counting.',
      'Spatial containment and stack proximity evaluated strictly as conditional likelihoods in SPATIAL_CONTEXT.',
      'Binary ML advisory is classified as DERIVED evidence and excluded from authoritative posterior multiplication to avoid collinear double-counting with RADIOMETRY and SPATIAL_CONTEXT.',
      'Industrial fire likelihoods modeled via domain expert parameters (no verified industrial fire training corpus).',
      'Agricultural residue burning likelihoods modeled via regional harvest timing domain parameters.',
    ],
    geographic_scope: 'India National Industrial Monitoring (80 complexes) + Regional South Asia',
    temporal_scope: 'Real-time observation window + multi-pass history',
    calibration_status: 'EMPIRICAL_FLARE_WILDFIRE_WITH_EXPERT_PRIOR_EXTENSIONS',
    known_limitations: [
      'Industrial fire class lacks empirical labeled training events; relies on physical expert likelihoods.',
      'Agricultural burn class lacks formal ground-truth perimeter dataset.',
      'Binary ML model (lr-v5f3-standardized) provides diagnostic advisory cross-check and is not an independent 5-class multiplier.',
    ],
    dependency_handling: 'EXPLICIT_CONDITIONAL_INDEPENDENCE_WITH_DERIVED_ML_EXCLUSION',
  };

  const families = Array.from(new Set(incorporated.map((e) => e.evidence_family)));

  return {
    posterior_probabilities: posteriors,
    log_posterior_scores: logScores,
    hypotheses_distribution: hypothesesDistribution,
    primary_hypothesis: topItem.label,
    primary_hypothesis_type: topItem.hypothesis,
    prior_distribution: priorResult,
    incorporated_evidence_items: incorporated,
    advisory_evidence_items: advisoryItems,
    evidence_families_evaluated: families,
    uncertainty,
    evidence_conflict: conflict,
    hypothesis_rationales: rationales,
    model_registry: modelRegistry,
  };
}
