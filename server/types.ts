export type SpatialAssociationType =
  | 'KNOWN_THERMAL_ZONE'
  | 'FACILITY_OFF_ZONE'
  | 'FACILITY_BUFFER'
  | 'UNASSOCIATED';

export type BehaviouralStatus =
  | 'NORMAL'
  | 'ELEVATED'
  | 'ANOMALOUS'
  | 'NOT_ASSESSED';

export type SourceHypothesisType =
  | 'GAS_FLARE'
  | 'INDUSTRIAL_FIRE'
  | 'AGRICULTURAL_BURN'
  | 'WILDFIRE_VEGETATION'
  | 'OTHER';

export type ObservationProvenance =
  | 'REAL_FIRMS'
  | 'HISTORICAL_BASELINE'
  | 'CONTROLLED_TEST'
  | 'FIXTURE'
  | 'LOCAL_BENCHMARK_CACHE';

export interface ServerThermalObservation {
  id: string;
  latitude: number;
  longitude: number;
  acquisition_time: string; // ISO-8601 UTC
  acquisition_date?: string; // YYYY-MM-DD
  satellite: string;
  sensor: 'VIIRS' | 'MODIS' | string;
  instrument_pass?: 'DAY_PASS' | 'NIGHT_PASS';
  frp: number; // Fire Radiative Power in MW
  brightness_kelvin?: number;
  brightness_ti4?: number;
  brightness_ti5?: number;
  brightness_t31?: number;
  brightness_delta?: number;
  confidence: 'low' | 'nominal' | 'high';
  raw_confidence?: string;
  day_night: 'D' | 'N';
  scan?: number;
  track?: number;
  source_type: string;
  provenance: ObservationProvenance;
  is_real_data: boolean;
  raw_record?: string | Record<string, any>;
  spatial_association?: ServerSpatialAssociation;
}

// Canonical Source FIRMS Observation (Preserves authentic source measurements without derived labels)
export interface CanonicalFirmsObservation {
  id: string;
  source_provider: 'NASA_FIRMS' | string;
  provenance: ObservationProvenance;
  ingestion_timestamp: string; // ISO-8601 UTC timestamp of ingestion

  latitude: number; // Decimal degrees [-90.0, 90.0]
  longitude: number; // Decimal degrees [-180.0, 180.0]
  acquisition_time: string; // ISO-8601 UTC timestamp of satellite overpass
  acquisition_date: string; // YYYY-MM-DD

  frp: number; // Fire Radiative Power in MW (finite, non-negative)
  brightness_kelvin?: number | null; // Primary channel brightness in Kelvin
  brightness_ti4?: number | null; // VIIRS I4 MWIR (3.74 μm) in Kelvin
  brightness_ti5?: number | null; // VIIRS I5 LWIR (11.45 μm) in Kelvin
  brightness_t31?: number | null; // MODIS Ch31 Thermal (11.03 μm) in Kelvin
  brightness_delta?: number | null; // TI4 - TI5 in Kelvin (if both channels present)

  confidence: 'low' | 'nominal' | 'high';
  raw_confidence?: string | null;
  day_night: 'D' | 'N';
  satellite: string; // Normalized platform: "VIIRS-NOAA20", "VIIRS-SNPP", "MODIS-Terra", etc.
  sensor: 'VIIRS' | 'MODIS' | string;
  scan?: number | null; // Scan pixel dimension in km
  track?: number | null; // Track pixel dimension in km

  source_type: string;
  is_real_data: boolean;
  raw_record?: string | Record<string, any> | null;
}

export type CanonicalThermalObservation = ServerThermalObservation;

export type EvidenceAvailabilityStatus =
  | 'AVAILABLE'
  | 'NO_MAPPED_FEATURES'
  | 'UNAVAILABLE'
  | 'NOT_CURRENTLY_AVAILABLE'
  | 'ACQUISITION_FAILED'
  | 'OUT_OF_SCOPE';

export interface EvidenceAvailabilityMap {
  source_observation: 'AVAILABLE';
  spatial_context: 'AVAILABLE';
  facility_context: EvidenceAvailabilityStatus;
  behavioural_baseline: EvidenceAvailabilityStatus;
  temporal_persistence: EvidenceAvailabilityStatus;
  infrastructure: EvidenceAvailabilityStatus;
  weather: EvidenceAvailabilityStatus;
  optical: EvidenceAvailabilityStatus;
  ml_advisory: EvidenceAvailabilityStatus;
}

export type OperationalScopeStatus = 'IN_SCOPE' | 'OUT_OF_SCOPE' | 'RESEARCH_REFERENCE_ONLY';

export interface OperationalScopeConfig {
  country_code: string; // 'IN'
  country_name: string; // 'India'
  enabled: boolean;
  coarse_geographic_bounds: {
    min_lat: number;
    max_lat: number;
    min_lon: number;
    max_lon: number;
    filter_label: 'COARSE_DEVELOPMENT_FILTER' | 'AUTHORITATIVE_POLYGON';
  };
  authoritative_boundary_available: boolean;
}

export interface OperationalScopeEvaluationResult {
  is_in_scope: boolean;
  scope_status: OperationalScopeStatus;
  country_code: string;
  country_name: string;
  filter_method: 'COARSE_DEVELOPMENT_FILTER' | 'FACILITY_VICINITY' | 'AUTHORITATIVE_POLYGON';
  exclusion_reason?: string;
}

export interface DerivedObservationContext {
  operational_scope?: OperationalScopeEvaluationResult;
  spatial_association: SpatialAssociationType;
  spatial_association_label: string;
  is_associated: boolean;
  associated_facility: {
    id: string;
    name: string;
    operator?: string;
    category?: string;
    state?: string;
    region?: string;
    center?: [number, number];
    buffer_radius_km?: number;
  } | null;
  facility_distance_meters: number | null;
  distance_to_boundary_meters: number | null;
  is_inside_polygon: boolean;
  is_inside_known_zone: boolean;
  matched_zone_name: string | null;
  distance_to_zone_meters: number | null;
  distance_to_observed_zone_meters?: number | null;

  baseline_status: 'EMPIRICAL' | 'LIMITED' | 'CANDIDATE_EMPIRICAL_WITH_REVIEW' | 'CONTROLLED' | 'INSUFFICIENT_DATA' | 'NOT_ASSESSED' | 'NONE';
  behavioural_status: BehaviouralStatus;
  baseline_metrics?: {
    observation_count: number;
    median_frp: number | null;
    p75_frp: number | null;
    p95_frp: number | null;
    max_frp: number | null;
    ratio_to_median: number | null;
    delta_from_median: number | null;
  } | null;

  persistence_status: 'PERSISTENT' | 'RECURRENT' | 'SINGLE_OBSERVATION' | 'NO_HISTORICAL_DATA';
  persistence_summary?: string;

  reasons: string[];
}

export interface GenericDetectionProcessingResult {
  source_observation: CanonicalFirmsObservation;
  derived_context: DerivedObservationContext;
  evidence_availability: EvidenceAvailabilityMap;
  processing_status: 'SUCCESS' | 'INVALID_OBSERVATION' | 'PROCESSING_ERROR' | 'OUT_OF_SCOPE';
  validation_errors: string[];
}

export interface ValidationRecordError {
  line?: number;
  record_id?: string;
  field?: string;
  reason: string;
  raw?: string;
}

export interface IngestionValidationSummary {
  total_raw_records: number;
  valid_records: number;
  invalid_records: number;
  duplicate_records: number;
  rejection_reasons: ValidationRecordError[];
}

export interface ServerSpatialAssociation {
  associated: boolean;
  association_type: SpatialAssociationType;
  association_label: string;
  behavioural_status: BehaviouralStatus;
  baseline_status: 'EMPIRICAL' | 'LIMITED' | 'CANDIDATE_EMPIRICAL_WITH_REVIEW' | 'CONTROLLED' | 'INSUFFICIENT_DATA' | 'NOT_ASSESSED' | 'NONE';
  provenance?: 'REAL' | 'CONTROLLED' | 'DERIVED' | 'NONE' | ObservationProvenance;
  facility_id: string | null;
  facility_name: string | null;
  distance_meters: number | null;
  is_inside_polygon: boolean;
  is_inside_known_zone: boolean;
  matched_zone: string | null;
  distance_to_zone_meters: number | null;
  reasons: string[];
  empirical_metrics?: {
    current_frp: number;
    baseline_frp_median: number | null;
    baseline_frp_p75: number | null;
    baseline_frp_p95: number | null;
    baseline_frp_max: number | null;
    frp_ratio_to_median: number | null;
    frp_delta_from_median: number | null;
  };
  evaluation_parameters?: {
    rule_type: string;
    thresholds_used: {
      elevated_percentile: number;
      anomalous_percentile: number;
    };
    label: string;
  };
  source_hypotheses: Record<SourceHypothesisType, number>;
  hypothesis_rationales: {
    hypothesis: SourceHypothesisType;
    score: number;
    rationale: string;
  }[];
  uncertainty?: {
    shannon_entropy_bits: number;
    normalized_entropy: number;
    uncertainty_level: 'LOW' | 'MODERATE' | 'HIGH';
    scientific_explanation: string;
  };
  investigation_priority?: {
    level: 'LOW' | 'MEDIUM' | 'HIGH';
    score: number;
    label: string;
    reasons: string[];
  };
  notes: string;
}

export interface ServerFacility {
  id: string;
  name: string;
  operator: string;
  category: string;
  state: string;
  region: string;
  center: [number, number]; // [lat, lon]
  polygon: [number, number][]; // [[lat, lon], ...]
  buffer_radius_km: number;
  known_thermal_zones: {
    id: string;
    name: string;
    type?: string;
    center: [number, number];
    expected_max_frp: number;
  }[];
}

export interface ServerFirmsResponse {
  status: 'SUCCESS' | 'ERROR';
  count: number;
  source: string;
  is_live_external: boolean;
  data_mode: 'LIVE_EXTERNAL' | 'PUBLIC_FEED_LIVE' | 'UNAVAILABLE_NO_KEY' | 'LOCAL_BENCHMARK_CACHE';
  observations: ServerThermalObservation[];
  validation_summary?: IngestionValidationSummary;
  notes?: string;
  timestamp: string;
}

export interface ObservedThermalActivityZone {
  id: string;
  facility_id: string;
  name: string;
  centroid: [number, number]; // [lat, lon]
  radius_meters: number;
  observation_count: number;
  percentage_of_historical: number;
  sample_period: string;
  median_frp_mw: number;
  p95_frp_mw: number;
  confidence_rating?: 'HIGH_STATISTICAL_DENSITY' | 'MODERATE' | 'LOW';
  operational_significance?: string;
  description?: string;
}

export interface SpatialAssessment {
  spatial_classification: SpatialAssociationType;
  spatial_classification_label: string;
  is_associated: boolean;
  matched_facility: {
    id: string;
    name: string;
    operator?: string;
    category?: string;
    state?: string;
    region?: string;
    center?: [number, number];
    buffer_radius_km?: number;
  } | null;
  facility_distance_meters: number | null;
  distance_to_nearest_configured_zone_meters: number | null;
  distance_to_observed_activity_zone_meters: number | null;
  is_inside_polygon: boolean;
  is_inside_known_zone: boolean;
  matched_zone_name: string | null;
  spatial_confidence: 'HIGH' | 'MODERATE' | 'LOW';
  nearby_osm_context?: {
    queried: boolean;
    feature_count: number;
    nearest_flare_distance_meters: number | null;
    nearest_chimney_distance_meters: number | null;
    nearest_tank_distance_meters: number | null;
    nearest_industrial_feature: string | null;
    features_summary: string;
  };
  reasons: string[];
}

export interface BaselinePeriod {
  start_date: string;
  end_date: string;
  total_days: number;
  analysis_window_days?: number;
  observation_period_start?: string;
  observation_period_end?: string;
  observation_days?: number;
}

export interface BehaviourAssessment {
  baseline_status: 'EMPIRICAL' | 'LIMITED' | 'CANDIDATE_EMPIRICAL_WITH_REVIEW' | 'CONTROLLED' | 'INSUFFICIENT_DATA' | 'NOT_ASSESSED' | 'NONE';
  baseline_availability: boolean;
  baseline_sample_count: number;
  cutoff_timestamp_iso?: string;
  provenance_type?: 'EVENT_SPECIFIC_SLICED' | 'PERSISTED_REGIONAL_SUMMARY' | 'CONTROLLED_PROTOTYPE' | 'INSUFFICIENT_DATA' | 'FACILITY_ASSOCIATED' | 'CANDIDATE_PILOT' | 'LIMITED_PILOT';
  population_scope?: 'FACILITY_ASSOCIATED' | 'REGIONAL_CORPUS' | 'CONTROLLED' | 'NOT_APPLICABLE';
  baseline_period?: BaselinePeriod;
  temporal_coverage_summary?: string;
  baseline_metrics: {
    frp_median: number | null;
    frp_p25: number | null;
    frp_p75: number | null;
    frp_p90: number | null;
    frp_p95: number | null;
    frp_max: number | null;
    frp_iqr: number | null;
    frp_mad: number | null;
  };
  deviation_metrics: {
    current_frp: number;
    frp_ratio_to_median: number | null;
    frp_delta_from_median: number | null;
    exceeds_p75: boolean;
    exceeds_p95: boolean;
  };
  behavioural_status: BehaviouralStatus;
  persistence_state?: {
    level: 'NO_HISTORY' | 'SINGLE_OBSERVATION' | 'RECURRENT' | 'PERSISTENT';
    historical_count: number;
    night_pass_ratio: number;
    summary: string;
  };
  reasons: string[];
  evaluation_parameters: {
    rule_type: string;
    thresholds_used: {
      elevated_percentile: number;
      anomalous_percentile: number;
    };
    label: string;
  };
}

export interface HypothesisFeatureContribution {
  feature: string;
  delta: number;
  direction: 'SUPPORTS' | 'OPPOSES' | 'NEUTRAL';
  reason: string;
}

export interface ContextualHypothesisItem {
  hypothesis: SourceHypothesisType;
  label: string;
  raw_support_score?: number;
  normalized_score: number; // 0.0 to 1.0 (sums to 1.0 across active hypotheses)
  percentage: number; // 0 to 100%
  support_level: 'VERY_HIGH' | 'HIGH' | 'MODERATE' | 'LOW' | 'VERY_LOW' | string;
  reasons: string[];
  feature_contributions?: HypothesisFeatureContribution[];
  supporting_evidence?: string[];
  opposing_evidence?: string[];
}

export interface HypothesisSupport {
  hypothesis: SourceHypothesisType;
  label: string;
  raw_support_score?: number;
  percentage: number;
  normalized_score?: number;
  support_level?: 'VERY_HIGH' | 'HIGH' | 'MODERATE' | 'LOW' | 'VERY_LOW' | string;
  reasons?: string[];
  feature_contributions?: HypothesisFeatureContribution[];
  supporting_evidence?: string[];
  opposing_evidence?: string[];
}

export interface PrototypeSourceHypotheses {
  status_label: 'Normalized Heuristic Support — Prototype Contextual Assessment';
  disclaimer: string;
  primary_hypothesis: string;
  primary_hypothesis_type: SourceHypothesisType;
  alternative_hypotheses: string[];
  hypotheses_distribution: ContextualHypothesisItem[];
  basis: string;
  feature_contributions_summary?: {
    feature_name: string;
    impact_summary: string;
  }[];
  evidence_breakdown?: {
    hypothesis: SourceHypothesisType;
    supporting_factors: string[];
    opposing_factors: string[];
  }[];
}

export interface HypothesisAssessment {
  primary_hypothesis: string;
  primary_hypothesis_type: SourceHypothesisType;
  base_prior_distribution?: HypothesisSupport[];
  initial_posterior_distribution?: HypothesisSupport[];
  prior_distribution?: HypothesisSupport[];
  posterior_distribution?: HypothesisSupport[];
  candidate_hypotheses: ContextualHypothesisItem[];
  hypotheses_distribution: ContextualHypothesisItem[];
  hypothesis_rationales: {
    hypothesis: SourceHypothesisType;
    score: number;
    rationale: string;
  }[];
  alternative_hypotheses: string[];
  provenance_method: string;
  basis_explanation: string;
  feature_contributions_summary?: {
    feature_name: string;
    impact_summary: string;
  }[];
  evidence_breakdown?: {
    hypothesis: SourceHypothesisType;
    supporting_factors: string[];
    opposing_factors: string[];
  }[];
  initial_vs_current?: InitialVsCurrentAssessment;
  fused_hypotheses?: HypothesisSupport[];
  bayesian_result?: any;
}

export interface UncertaintyAssessment {
  entropy_bits: number; // Shannon entropy: - sum(p_i * log2(p_i))
  max_possible_entropy_bits: number; // log2(K)
  normalized_entropy: number; // 0.0 to 1.0
  uncertainty_level: 'LOW' | 'MODERATE' | 'HIGH';
  is_ambiguous: boolean;
  summary: string;
  interpretation: string;
  competing_hypotheses_count: number;
  active_hypotheses_count: number;
  initial_entropy_bits?: number;
  current_entropy_bits?: number;
  entropy_delta_bits?: number;
  uncertainty_reduction_percentage?: number;
}

export interface InvestigationPriorityResult {
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  score: number;
  label?: string;
  disclaimer?: string;
  reasons: string[];
}

export interface EvidenceStatusDetail {
  available_context: {
    category: string;
    description: string;
    source: string;
    status: 'AVAILABLE';
  }[];
  missing_evidence: {
    category: string;
    description: string;
    importance: 'RECOMMENDED' | 'CRITICAL' | 'DESIRABLE';
    source: string;
    status: 'REQUIRED_FOR_CONFIRMATION';
  }[];
  summary: string;
  recommendation: string;
}

export type EvidenceCandidateType =
  | 'NASA_FIRMS_VIIRS_DETECTION'
  | 'FACILITY_BOUNDARY_GEOMETRY'
  | 'EMPIRICAL_HISTORICAL_BASELINE'
  | 'OBSERVED_THERMAL_ACTIVITY_ZONE'
  | 'SENTINEL2_SWIR_OPTICAL'
  | 'HIGH_RES_LAND_COVER_CONTEXT'
  | 'ATMOSPHERIC_WIND_WEATHER'
  | 'VIIRS_NIGHTFIRE_COMBUSTION'
  | 'MULTI_PASS_TEMPORAL_PERSISTENCE'
  | 'FACILITY_OPERATIONAL_SCADA_LOGS'
  | 'OPENSTREETMAP_INFRASTRUCTURE_CONTEXT';

export type DiscriminativeValueLevel = 'VERY_HIGH' | 'HIGH' | 'MODERATE' | 'LOW';

export type AcquisitionCostEffort =
  | 'ZERO_IMMEDIATE'
  | 'LOW_AUTOMATED'
  | 'MODERATE_LATENCY'
  | 'HIGH_MANUAL'
  | 'HIGH_RESTRICTED'
  | 'EXTREME_COMMERCIAL';

export type CurrentEvidenceStatus =
  | 'ACQUIRED_AND_EVALUATED'
  | 'CONNECTED_QUERYABLE'
  | 'NOT_CONNECTED'
  | 'UNAVAILABLE_PENDING_OVERPASS';

export type TemporalSuitabilityStatus = 'EVENT_ADJACENT' | 'FORENSIC_CONTEXT' | 'UNAVAILABLE';
export type EvidenceProvenanceStatus = 'REAL_AVAILABLE' | 'CONTROLLED' | 'UNAVAILABLE';

export interface ExpectedEntropyOutcome {
  outcome_id: string;
  outcome_name: string;
  outcome_probability: number; // P(o | E, current)
  posterior_entropy_bits: number; // H(P(. | o))
  posterior_top_hypothesis: SourceHypothesisType;
  posterior_distribution: Record<SourceHypothesisType, number>; // percentages
}

export interface ExpectedEntropyAnalysis {
  current_entropy_bits: number;
  expected_posterior_entropy_bits: number;
  expected_information_gain_bits: number; // EIG = H_current - E[H]
  target_ambiguity: string;
  outcomes: ExpectedEntropyOutcome[];
  information_model_name: string;
}

export interface EvidenceCandidate {
  evidenceType: EvidenceCandidateType;
  displayName: string;
  availabilityStatus: EvidenceAvailabilityStatus;
  currentEvidenceStatus: CurrentEvidenceStatus;
  provenanceStatus?: EvidenceProvenanceStatus;
  temporalSuitability?: TemporalSuitabilityStatus;
  temporalOffsetHours?: number;
  expectedInformationGainBits?: number;
  expectedPosteriorEntropyBits?: number;
  currentEntropyBits?: number;
  targetAmbiguity?: string;
  expectedEntropyAnalysis?: ExpectedEntropyAnalysis;
  applicableHypotheses: SourceHypothesisType[];
  targetHypothesisPairs: string[];
  expectedDiscriminativeValue: DiscriminativeValueLevel;
  prototypeInformationValueScore: number; // 0 to 100 prototype discrimination approximation
  acquisitionCostEffort: AcquisitionCostEffort;
  source: string;
  whatItTellsUs?: string;
  whyItMatters?: string;
  rationale: string;
  limitations: string;
  assumptions: string[];
  utility_breakdown?: UtilityScoreBreakdown;
  temporal_status?: string;
}

export interface UtilityScoreBreakdown {
  entropy_contribution: number; // 0.30 * (H / H_max)
  hypothesis_competition: number; // 0.25 * C_comp
  contextual_relevance: number; // 0.45 * Relevance
  raw_information_value: number; // entropy_contribution + hypothesis_competition + contextual_relevance (0 to 1)
  cost_multiplier: number; // 0.45 to 1.0
  final_utility_score: number; // Math.round(100 * raw_information_value * cost_multiplier)
  target_hypothesis_pair: string;
  eig_bits?: number;
  eig_contribution?: number;
  temporal_suitability_factor?: number;
}

export interface NextBestEvidenceRecommendation {
  recommendedCandidate: EvidenceCandidate | null;
  recommendationType: 'BEST_AVAILABLE_CONNECTED' | 'HIGHEST_VALUE_EXTERNAL_PENDING';
  displayName: string;
  whyUseful: string;
  discriminatesHypotheses: SourceHypothesisType[];
  availability: EvidenceAvailabilityStatus;
  provenance_status?: EvidenceProvenanceStatus;
  temporal_suitability?: TemporalSuitabilityStatus;
  expected_information_gain_bits?: number;
  current_entropy_bits?: number;
  expected_posterior_entropy_bits?: number;
  target_ambiguity?: string;
  expected_entropy_analysis?: ExpectedEntropyAnalysis;
  prototypeInformationValueScore: number;
  costEffortConsideration: string;
  assumptions: string[];
  statusMessage: string;
  targetHypothesisPairs?: string[];
  utility_breakdown?: UtilityScoreBreakdown;
  utility_score?: number;
  temporal_status?: string;
  candidateId?: string;
  candidate_id?: string;
  source?: string;
  name?: string;
  action?: string;
  target_hypothesis_pair?: string;
  rationale?: string;
  latency_or_cost?: string;
}

export interface DecisionExplanation {
  currentAssessment: string;
  competingHypotheses: {
    hypothesis: SourceHypothesisType;
    label: string;
    supportPercentage: number;
  }[];
  whyUncertain: string;
  nextBestEvidence: string;
  why: string;
  availability: EvidenceAvailabilityStatus;
  limitations: string;
}

export interface EvidenceGuidedInvestigation {
  statusLabel: 'Prototype Evidence-Guided Assessment';
  disclaimer: string;
  currentEvidence: EvidenceCandidate[];
  missingEvidence: EvidenceCandidate[];
  allCandidates: EvidenceCandidate[];
  recommendedAvailableEvidence: NextBestEvidenceRecommendation;
  recommendedExternalEvidence: NextBestEvidenceRecommendation;
  decisionExplanation: DecisionExplanation;
  consumed_bayesian_posterior?: {
    posterior_probabilities: Record<SourceHypothesisType, number>;
    entropy_bits: number;
    normalized_entropy: number;
    hypotheses_distribution: ContextualHypothesisItem[];
    incorporated_evidence_count: number;
    advisory_evidence_count: number;
  };
  methodologyDocumentation: {
    title: string;
    formula: string;
    inputs: string[];
    assumptions: string[];
    disclaimer: string;
  };
}

export type EvidenceProvenance = 'REAL' | 'DERIVED' | 'CONTROLLED';
export type EvidenceReliability = 'HIGH' | 'MODERATE' | 'LOW';
export type EvidenceDirection = 'INCREASES_SUPPORT' | 'DECREASES_SUPPORT' | 'NEUTRAL';

export interface ExplicitEvidenceItem {
  evidence_id: string;
  source: string;
  evidence_type: string;
  outcome_id?: string;
  outcome_name?: string;
  title: string;
  description: string;
  value: any;
  timestamp: string;
  spatial_relationship?: string;
  provenance: EvidenceProvenance;
  reliability: EvidenceReliability;
  applicability: string;
  affected_hypotheses: SourceHypothesisType[];
  likelihood_by_hypothesis?: Record<SourceHypothesisType, number>;
  log_likelihood_by_hypothesis?: Record<SourceHypothesisType, number>;
  direction_of_influence?: Record<SourceHypothesisType, EvidenceDirection>;
  strength_of_influence?: Record<SourceHypothesisType, number>;
  is_candidate?: boolean;
  is_acquired?: boolean;
  is_evaluated?: boolean;
  is_temporally_eligible?: boolean;
  temporal_status?: 'TEMPORALLY_RELEVANT' | 'TEMPORALLY_DISTANT' | 'NOT_APPLICABLE' | 'PENDING_EVALUATION' | string;
  is_incorporated: boolean;
  incorporation_rationale?: string;
  changed_posterior?: boolean;
  entropy_delta_bits?: number;
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

export interface InitialVsCurrentAssessment {
  initial_assessment: {
    hypotheses_distribution: HypothesisSupport[];
    entropy_bits: number;
    normalized_entropy: number;
    uncertainty_level: 'LOW' | 'MODERATE' | 'HIGH';
  };
  current_assessment: {
    hypotheses_distribution: HypothesisSupport[];
    entropy_bits: number;
    normalized_entropy: number;
    uncertainty_level: 'LOW' | 'MODERATE' | 'HIGH';
  };
  entropy_delta_bits: number;
  uncertainty_reduction_percentage: number;
  uncertainty_status: 'UNCERTAINTY_REDUCED' | 'AMBIGUITY_INCREASED' | 'UNCHANGED';
  applied_evidence_count: number;
  applied_evidence_ids: string[];
}

export interface EvidenceAssessment {
  current_evidence: EvidenceCandidate[];
  missing_evidence: EvidenceCandidate[];
  all_candidates: EvidenceCandidate[];
  summary: string;
  recommendation_statement: string;
  evidence_conflict?: {
    has_conflict: boolean;
    contextual_leading_hypothesis: string;
    contextual_support_pct: number | null;
    discriminator_class: string;
    discriminator_score_pct: number;
    explanation: string;
  };
  structured_conflict?: StructuredEvidenceConflict;
  explicit_evidence_items?: ExplicitEvidenceItem[];
  radiometric_discriminator?: ThermalSourceDiscriminatorOutput;
}

export interface NBEAssessment {
  recommended_available_evidence: NextBestEvidenceRecommendation;
  recommended_external_evidence: NextBestEvidenceRecommendation;
  decision_explanation: DecisionExplanation;
  ranked_candidates: EvidenceCandidate[];
  target_ambiguity?: string;
  current_entropy_bits?: number;
  methodology: {
    title: string;
    formula: string;
    inputs: string[];
    assumptions: string[];
    disclaimer: string;
  };
}

export type InvestigationTimelineEventType =
  | 'FIRMS_DETECTION'
  | 'SPATIAL_ASSOCIATION'
  | 'BEHAVIOURAL_ASSESSMENT'
  | 'INITIAL_HYPOTHESIS_ASSESSMENT'
  | 'UNCERTAINTY_CALCULATED'
  | 'NBE_GENERATED'
  | 'EVIDENCE_SELECTED'
  | 'EVIDENCE_INCORPORATED'
  | 'HYPOTHESES_UPDATED'
  | 'ENTROPY_UPDATED'
  | 'PRIORITY_UPDATED'
  | 'INVESTIGATOR_RESOLUTION'
  | 'CASE_RESET';

export interface InvestigationTimelineEvent {
  step_index: number;
  step_code: string; // 'T0', 'T1', ..., 'T11'
  event_type: InvestigationTimelineEventType;
  title: string;
  actor: string;
  timestamp: string;
  summary: string;
  details?: Record<string, any>;
}

export interface EvidenceEffectRecord {
  evidence_id: string;
  evidence_title: string;
  evidence_type: string;
  affected_hypotheses: SourceHypothesisType[];
  direction_of_influence: Record<SourceHypothesisType, EvidenceDirection>;
  strength_of_influence: Record<SourceHypothesisType, number>;
  prior_distribution: Record<SourceHypothesisType, number>;
  posterior_distribution: Record<SourceHypothesisType, number>;
  entropy_before: number;
  entropy_after: number;
  entropy_delta: number;
  uncertainty_reduction_percentage: number;
  provenance: EvidenceProvenance;
  timestamp: string;
  incorporation_step?: string;
}

export interface InitialAssessmentSnapshot {
  hypotheses_distribution: HypothesisSupport[];
  primary_hypothesis: string;
  primary_hypothesis_type: SourceHypothesisType;
  entropy_bits: number;
  max_possible_entropy_bits: number;
  normalized_entropy: number;
  uncertainty_level: 'LOW' | 'MODERATE' | 'HIGH';
  ml_advisory?: ThermalSourceDiscriminatorOutput;
  evidence_state: EvidenceStatusDetail;
  spatial_assessment: SpatialAssessment;
  behaviour_assessment: BehaviourAssessment;
  priority: InvestigationPriorityResult;
  initial_nbe?: NextBestEvidenceRecommendation;
  created_at: string;
}

export type InvestigationResolutionStatus =
  | 'PENDING_INVESTIGATION'
  | 'CONCURRED_WITH_PRIMARY'
  | 'OVERRIDDEN_BY_OPERATOR'
  | 'CLOSED_FALSE_POSITIVE';

export interface InvestigatorResolution {
  verdict: SourceHypothesisType;
  verdict_label: string;
  confidence: number;
  notes: string;
  evidence_used: string[];
  investigator_id?: string;
  resolved_at: string;
  status: 'RESOLVED';
  provenance?: 'REAL' | 'CONTROLLED';
  resolution_type?: 'REAL_FIELD_INVESTIGATION' | 'CONTROLLED_SIMULATION_DEMO';
}

export interface InvestigationCaseData {
  case_id: string;
  firms_observation_id: string;
  timestamp: string;
  satellite: string;
  coordinates: [number, number];
  frp: number;
  confidence: 'low' | 'nominal' | 'high';
  day_night?: 'D' | 'N';
  status?: 'OPEN' | 'UNDER_INVESTIGATION' | 'RESOLVED';
  resolution_status: InvestigationResolutionStatus;

  // Section 9: Closed Investigation Loop Artifacts
  initial_assessment_snapshot: InitialAssessmentSnapshot;
  timeline: InvestigationTimelineEvent[];
  evidence_effects_history: EvidenceEffectRecord[];
  applied_evidence_items: ExplicitEvidenceItem[];
  applied_evidence_ids: string[];
  investigator_resolution?: InvestigatorResolution;
  investigator_notes?: string;
  investigatorNotes?: string;

  // Strongly-typed Canonical Pipeline Assessments
  spatial_assessment: SpatialAssessment;
  behaviour_assessment: BehaviourAssessment;
  hypothesis_assessment: HypothesisAssessment;
  uncertainty_assessment: UncertaintyAssessment;
  evidence_assessment: EvidenceAssessment;
  nbe_assessment: NBEAssessment;
  bayesian_result?: any;

  // Backwards-compatible legacy flat properties
  associated_facility: {
    id: string;
    name: string;
    category?: string;
  } | null;
  spatial_association: SpatialAssociationType;
  spatial_association_label: string;
  facility_baseline_status: 'EMPIRICAL' | 'LIMITED' | 'CANDIDATE_EMPIRICAL_WITH_REVIEW' | 'CONTROLLED' | 'INSUFFICIENT_DATA' | 'NOT_ASSESSED' | 'NONE';
  current_baseline_metrics: {
    sample_size: number;
    sample_period: string;
    median_frp: number | null;
    p75_frp: number | null;
    p95_frp: number | null;
    max_frp: number | null;
    ratio_to_median: number | null;
    delta_from_median: number | null;
  };
  behavioural_status: BehaviouralStatus;
  deviation_metrics: {
    frp_ratio_to_median: number | null;
    frp_delta_from_median: number | null;
    exceeds_p75: boolean;
    exceeds_p95: boolean;
    distance_to_nearest_configured_zone_meters: number | null;
    distance_to_observed_activity_zone_meters: number | null;
    distance_to_facility_meters: number | null;
  };
  explanation_reasons: string[];
  source_hypotheses: PrototypeSourceHypotheses;
  uncertainty: UncertaintyAssessment;
  evidence_status: string;
  evidence_status_detail: EvidenceStatusDetail;
  investigation_priority: InvestigationPriorityResult;
  evidence_guided_investigation?: EvidenceGuidedInvestigation;
  thermal_discriminator?: ThermalSourceDiscriminatorOutput;
  thermalDiscriminator?: ThermalSourceDiscriminatorOutput;
  provenance?: string;
  is_real_data?: boolean;
  resolution?: any;
  auditTrail?: any[];
  // UI aliases
  caseId?: string;
  primaryEventId?: string;
  facilityId?: string;
  facilityName?: string;
  priorityLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
  priorityScore?: number;
}

export type ServerInvestigationCase = InvestigationCaseData;

export interface FeatureContribution {
  feature: string;
  display_name: string;
  raw_value: number;
  mean: number;
  scale: number;
  standardized_value: number;
  frozen_coefficient: number;
  linear_contribution: number;
  direction: 'WILDFIRE_SIDE' | 'GAS_FLARE_SIDE' | 'NEUTRAL';
}

export interface ThermalSourceDiscriminatorOutput {
  status: 'AVAILABLE' | 'NOT_ASSESSED' | 'INVALID_INPUT' | 'OUT_OF_SCOPE' | 'LIMITED_MODEL_COVERAGE';
  model_id?: string;
  model_version: string;
  evaluation_level: 'OBSERVATION' | 'EVENT_AGGREGATE';
  task: 'GAS_FLARE_VS_WILDFIRE_CONFIRMED';
  supported_classes?: ['GAS_FLARE', 'WILDFIRE_CONFIRMED'];
  predicted_class: 'GAS_FLARE' | 'WILDFIRE_CONFIRMED' | null;
  predicted_label?: string; // e.g. "Wildfire-side signal" | "Gas Flare"
  summary_label?: string; // e.g. "Radiometric classification: Wildfire-side"
  wildfire_score: number | null;
  flare_score: number | null;
  decision_threshold: number;
  threshold_status: 'EXPERIMENTAL_UNVALIDATED' | 'OPERATIONAL_CALIBRATED';
  coverage_status?: 'FULL_COVERAGE' | 'CROSS_SENSOR_ADAPTED' | 'LIMITED_MODEL_COVERAGE' | 'OUT_OF_DOMAIN' | 'NOT_ASSESSED';
  interpretation: string;
  evidence_basis: string[];
  input_features_evaluated?: {
    log_frp: number;
    brightness_ti4: number;
    brightness_ti5: number;
    brightness_delta: number;
    scan: number;
    track: number;
    is_day: number;
  };
  feature_contributions?: FeatureContribution[];
  top_contributing_features?: FeatureContribution[];
  intercept?: number;
  logit_z?: number;
  evidence_conflict?: {
    has_conflict: boolean;
    contextual_leading_hypothesis: string;
    contextual_support_pct: number | null;
    discriminator_class: string;
    discriminator_score_pct: number;
    explanation: string;
  };
  model_metadata?: {
    training_dataset_name: string;
    training_instances: number;
    split_policy: string;
    trained_at?: string;
  };
  limitations: string[];
  timestamp: string;
}

export interface Sentinel2SwirResponse {
  status: 'AUTHENTIC_LIVE' | 'FALLBACK_SIMULATED' | 'ERROR';
  is_live_external: boolean;
  scene_id?: string;
  acquisition_timestamp?: string;
  acquisition_date?: string;
  cloud_coverage?: number;
  cloud_cover_pct?: number;
  image_data_url?: string;
  bands_used: string[];
  spatial_resolution: string;
  spatial_resolution_meters?: number;
  bounding_box: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  center_coordinates: [number, number]; // [lat, lon]
  evidence_findings: {
    spatial_expansion: boolean;
    uncontained_spread: boolean;
    swir_thermal_pattern: string;
    spectral_index_nbr?: number;
    pixel_footprint_sq_meters?: number;
    summary: string;
  };
  // Temporal Hardening Fields
  firms_observation_timestamp?: string;
  sentinel_acquisition_timestamp?: string;
  temporal_status?: 'TEMPORALLY_RELEVANT' | 'TEMPORALLY_DISTANT' | 'NO_SUITABLE_SCENE';
  temporal_difference_hours?: number;
  temporal_difference_days?: number;
  temporal_difference_human?: string;
  temporal_threshold_hours?: number;
  is_event_adjacent?: boolean;
  advisory_note?: string;

  provenance: string;
  notes?: string;
  timestamp: string;
}

export type { OsmContextFeature, OsmContextResponse } from './osm.js';
export type { WeatherContextResponse, WeatherMetrics } from './weather.js';


