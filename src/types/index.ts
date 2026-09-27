export type SatelliteSensor =
  | 'VIIRS-NOAA20'
  | 'VIIRS-SNPP'
  | 'VIIRS-NOAA21'
  | 'MODIS-Aqua'
  | 'MODIS-Terra'
  | string;

export type ObservationProvenance =
  | 'REAL_FIRMS'
  | 'HISTORICAL_BASELINE'
  | 'CONTROLLED_TEST'
  | 'FIXTURE'
  | 'LOCAL_BENCHMARK_CACHE';

export interface ThermalEvent {
  id: string;
  latitude: number;
  longitude: number;
  acquisitionTime: string; // ISO string
  satellite: SatelliteSensor;
  sensor?: 'VIIRS' | 'MODIS' | string;
  instrumentPass?: 'DAY_PASS' | 'NIGHT_PASS';
  frp: number; // Fire Radiative Power (MW)
  brightness: number; // Kelvin (e.g. 330 - 380 K)
  brightnessTi4?: number;
  brightnessTi5?: number;
  brightnessT31?: number;
  brightnessDelta?: number;
  confidence: 'low' | 'nominal' | 'high';
  rawConfidence?: string;
  dayNight: 'D' | 'N';
  scan?: number;
  track?: number;
  facilityId: string | null;
  facilityName?: string | null;
  facilityDistanceMeters: number;
  landCoverType: LandCoverType;
  spatialAssociation: SpatialAssociationType;
  behaviouralStatus: BehaviouralStatus;
  baselineStatus?: 'EMPIRICAL' | 'LIMITED' | 'CANDIDATE_EMPIRICAL_WITH_REVIEW' | 'CONTROLLED' | 'INSUFFICIENT_DATA' | 'NOT_ASSESSED' | 'NONE';
  provenance?: 'REAL' | 'CONTROLLED' | 'DERIVED' | 'NONE' | ObservationProvenance;
  deviationStatus: 'NORMAL' | 'ELEVATED' | 'ANOMALOUS' | 'NOT_ASSESSED' | 'MODERATE_DEVIATION' | 'HIGH_DEVIATION';
  isAmbiguous: boolean;
  uncertaintyDetails: string;
  reasons?: string[];
  empiricalMetrics?: {
    current_frp: number;
    baseline_frp_median: number | null;
    baseline_frp_p75: number | null;
    baseline_frp_p95: number | null;
    baseline_frp_max: number | null;
    frp_ratio_to_median: number | null;
    frp_delta_from_median: number | null;
  };
  evaluationParameters?: {
    rule_type: string;
    thresholds_used: {
      elevated_percentile: number;
      anomalous_percentile: number;
    };
    label: string;
  };
  caseId?: string;
  notes?: string;
  matchedZoneId?: string | null;
  isInsideKnownZone: boolean;
  isRealData?: boolean;
  spatialAssociationLabel?: string;
  distanceToZoneMeters?: number;
  distanceToFacilityMeters?: number;
  matchedZoneName?: string;
  sourceHypotheses: Record<SourceType, number>; // values 0 - 1
  hypothesisRationales?: {
    hypothesis: SourceHypothesisType;
    score: number;
    rationale: string;
  }[];
  uncertainty?: {
    shannon_entropy_bits: number;
    normalized_entropy: number;
    uncertainty_level: 'LOW' | 'MODERATE' | 'HIGH';
    scientific_explanation?: string;
  };
  investigationPriority?: {
    level: 'LOW' | 'MEDIUM' | 'HIGH';
    score: number;
    label: string;
    reasons?: string[];
  };
  isControlledScenario?: boolean;
  rawRecord?: string | Record<string, any>;
  rawServerData?: Record<string, any>;
}

export type LandCoverType = 'industrial' | 'agricultural' | 'forest' | 'water' | 'urban_residential' | 'barren';

export type SourceType = 
  | 'gas_flare'
  | 'industrial_fire'
  | 'agricultural_burn'
  | 'wildfire'
  | 'mining_smelter'
  | 'other_thermal';

export type FacilityCategory = 
  | 'refinery'
  | 'petrochemical'
  | 'steel_smelter'
  | 'metal_smelter'
  | 'power_plant'
  | 'chemical_fertilizer'
  | 'thermal_power'
  | 'lng_terminal'
  | 'other';

export interface KnownThermalZone {
  id: string;
  name: string;
  type: 'flare_stack' | 'coker_unit' | 'furnace_area' | 'crude_distillation' | 'boiler_stack' | 'slag_cooling';
  center: [number, number]; // [lat, lng]
  radiusMeters: number;
  expectedMaxFrpMw: number;
  description: string;
}

export interface FacilityThermalProfile {
  typicalDetectionsPerDay: { min: number; avg: number; max: number };
  typicalFrpMw: { p25: number; median: number; p75: number; maxNormal: number };
  diurnalDistribution: { hour: number; probability: number; avgFrp: number }[]; // 24 entries
  durationHours: { avg: number; max: number };
  historicalObservationDays: number;
  knownZoneCoveragePercent: number;
  flareFootprintRadiusMeters: number;
}

export interface Facility {
  id: string;
  name: string;
  operator: string;
  category: FacilityCategory;
  state: string;
  region: string;
  center: [number, number];
  polygon: [number, number][];
  bufferRadiusKm: number;
  knownThermalZones: KnownThermalZone[];
  baselineProfile?: FacilityThermalProfile;
  currentStatus: {
    activeEventsCount: number;
    currentFrpTotal: number;
    deviationLevel: 'NORMAL' | 'MODERATE' | 'CRITICAL' | 'NOT_ASSESSED';
    intensityDeviationPct: number;
    frequencyDeviationPct: number;
    hasNewZone: boolean;
    historicalMatchScore: number; // 0 - 100
    lastPassTime: string;
  };
}

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

export type EvidenceType = 
  | 'SENTINEL2_SWIR'
  | 'HIGH_RES_OPTICAL'
  | 'TEMPORAL_REPEAT_PASS'
  | 'SMOKE_PLUME_VECTOR'
  | 'LAND_COVER_BUFFER'
  | 'FACILITY_TELEMETRY';

export interface EvidenceItem {
  id: string;
  type: EvidenceType;
  title: string;
  sensor: string;
  acquisitionTimestamp: string;
  dataProvenance?: 'REAL' | 'DERIVED FROM REAL DATA' | 'CONTEXTUAL' | 'CONTROLLED EVIDENCE SCENARIO';
  utilityScore: number; // 1 - 100 ranking of utility
  costOrLatency: string;
  status: 'AVAILABLE' | 'ACQUIRING' | 'APPLIED';
  rationale: string;
  evidenceFindings: {
    spatialExpansion: boolean;
    uncontainedSpread: boolean;
    swirThermalPattern: 'point_flare_stack' | 'diffuse_ground_fire' | 'containment_vessel' | 'ambient_cooling';
    smokePlumeDetected: boolean;
    windAzimuthDegrees: number;
    spectralIndex_NBR: number; // Normalized Burn Ratio (-1 to +1)
    pixelFootprintSqMeters: number;
    summary: string;
  };
  simulatedBands?: {
    swir22: string; // visualization descriptor / color
    nir: string;
    trueColor: string;
  };
  hypothesisShifts: Record<SourceType, number>; // Probability shift delta
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
  description: string;
}

export interface ClientFacilityBaseline {
  facility_id: string;
  baseline_status: 'EMPIRICAL' | 'LIMITED' | 'CANDIDATE_EMPIRICAL_WITH_REVIEW' | 'CONTROLLED' | 'INSUFFICIENT_DATA' | 'NOT_ASSESSED' | 'NONE';
  metrics: {
    observation_count: number;
    observation_days: number;
    frp_median: number;
    frp_p25?: number;
    frp_p75?: number;
    frp_p90?: number;
    frp_p95?: number;
    frp_max?: number;
    observations_per_day?: number;
  };
  baseline_period: {
    start_date: string;
    end_date: string;
    total_days: number;
  };
  spatial_distribution: {
    inside_boundary_count: number;
    buffer_count: number;
    off_zone_count: number;
    known_zone_count: number;
  };
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

export interface BehaviourAssessment {
  baseline_status: 'EMPIRICAL' | 'LIMITED' | 'CANDIDATE_EMPIRICAL_WITH_REVIEW' | 'CONTROLLED' | 'INSUFFICIENT_DATA' | 'NOT_ASSESSED' | 'NONE';
  baseline_availability: boolean;
  baseline_sample_count: number;
  baseline_period?: {
    start_date: string;
    end_date: string;
    total_days: number;
  };
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

export interface HypothesisAssessment {
  primary_hypothesis: string;
  primary_hypothesis_type: SourceHypothesisType;
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
}

export type EvidenceProvenance = 'REAL' | 'DERIVED' | 'CONTROLLED';
export type EvidenceReliability = 'HIGH' | 'MODERATE' | 'LOW';
export type EvidenceDirection = 'INCREASES_SUPPORT' | 'DECREASES_SUPPORT' | 'NEUTRAL';

export interface ExplicitEvidenceItem {
  evidence_id: string;
  source: string;
  evidence_type: string;
  title: string;
  description: string;
  value: any;
  timestamp: string;
  spatial_relationship?: string;
  provenance: EvidenceProvenance;
  reliability: EvidenceReliability;
  applicability: string;
  affected_hypotheses: SourceHypothesisType[];
  direction_of_influence: Record<SourceHypothesisType, EvidenceDirection>;
  strength_of_influence: Record<SourceHypothesisType, number>;
  is_incorporated: boolean;
  incorporation_rationale?: string;
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
    hypotheses_distribution: ContextualHypothesisItem[];
    entropy_bits: number;
    normalized_entropy: number;
    uncertainty_level: 'LOW' | 'MODERATE' | 'HIGH';
  };
  current_assessment: {
    hypotheses_distribution: ContextualHypothesisItem[];
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

export interface InvestigationPriorityResult {
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  score: number; // 0 - 100 prototype rating
  label?: string; // 'Prototype Investigation Priority'
  disclaimer?: string; // 'Operational triage score; not probability of fire or incident severity.'
  reasons: string[];
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
  status_label: 'AI-Assisted Contextual Hypothesis Assessment' | 'Normalized Heuristic Support — Prototype Contextual Assessment' | string;
  disclaimer: string;
  primary_hypothesis: string;
  primary_hypothesis_type?: SourceHypothesisType;
  alternative_hypotheses: string[];
  hypotheses_distribution?: ContextualHypothesisItem[];
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

export interface UncertaintyAssessment {
  entropy_bits: number; // Shannon entropy: - sum(p_i * log2(p_i))
  max_possible_entropy_bits: number; // log2(K)
  normalized_entropy: number; // 0.0 to 1.0
  uncertainty_level: 'LOW' | 'MODERATE' | 'HIGH';
  is_ambiguous?: boolean;
  summary: string;
  interpretation: string;
  competing_hypotheses_count: number;
  active_hypotheses_count?: number;
  initial_entropy_bits?: number;
  current_entropy_bits?: number;
  entropy_delta_bits?: number;
  uncertainty_reduction_percentage?: number;
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

export type EvidenceAvailabilityStatus = 'AVAILABLE' | 'NOT_CURRENTLY_AVAILABLE';

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
  statusLabel: 'Evidence-Guided Investigation Assessment' | 'Prototype Evidence-Guided Assessment' | string;
  disclaimer: string;
  currentEvidence: EvidenceCandidate[];
  missingEvidence: EvidenceCandidate[];
  allCandidates: EvidenceCandidate[];
  recommendedAvailableEvidence: NextBestEvidenceRecommendation;
  recommendedExternalEvidence: NextBestEvidenceRecommendation;
  decisionExplanation: DecisionExplanation;
  methodologyDocumentation: {
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
  direction_of_influence: Record<SourceHypothesisType, 'INCREASES_SUPPORT' | 'DECREASES_SUPPORT' | 'NEUTRAL'>;
  strength_of_influence: Record<SourceHypothesisType, number>;
  prior_distribution: Record<SourceHypothesisType, number>;
  posterior_distribution: Record<SourceHypothesisType, number>;
  entropy_before: number;
  entropy_after: number;
  entropy_delta: number;
  uncertainty_reduction_percentage: number;
  provenance: 'REAL' | 'DERIVED' | 'CONTROLLED';
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

export interface InvestigatorResolution {
  verdict: SourceHypothesisType;
  verdict_label: string;
  confidence: number;
  notes: string;
  evidence_used: string[];
  investigator_id?: string;
  resolved_at: string;
  status: 'RESOLVED';
}

export interface InvestigationCase {
  case_id?: string;
  firms_observation_id?: string;
  timestamp?: string;
  satellite?: string;
  coordinates?: [number, number];
  frp?: number;
  confidence?: 'low' | 'nominal' | 'high';

  // Section 9: Closed Investigation Loop Artifacts
  initial_assessment_snapshot?: InitialAssessmentSnapshot;
  timeline?: InvestigationTimelineEvent[];
  evidence_effects_history?: EvidenceEffectRecord[];
  applied_evidence_items?: any[];
  applied_evidence_ids?: string[];
  investigator_resolution?: InvestigatorResolution;
  investigator_notes?: string;

  // Strongly-typed Canonical Pipeline Assessments
  spatial_assessment?: SpatialAssessment;
  behaviour_assessment?: BehaviourAssessment;
  hypothesis_assessment?: HypothesisAssessment;
  uncertainty_assessment?: UncertaintyAssessment;
  evidence_assessment?: EvidenceAssessment;
  nbe_assessment?: NBEAssessment;

  associated_facility?: {
    id: string;
    name: string;
    category?: string;
  } | null;
  spatial_association?: SpatialAssociationType;
  spatial_association_label?: string;
  facility_baseline_status?: 'EMPIRICAL' | 'LIMITED' | 'CANDIDATE_EMPIRICAL_WITH_REVIEW' | 'CONTROLLED' | 'INSUFFICIENT_DATA' | 'NOT_ASSESSED' | 'NONE';
  current_baseline_metrics?: {
    sample_size: number;
    sample_period: string;
    median_frp: number | null;
    p75_frp: number | null;
    p95_frp: number | null;
    max_frp: number | null;
    ratio_to_median: number | null;
    delta_from_median: number | null;
  };
  behavioural_status?: BehaviouralStatus;
  deviation_metrics?: {
    frp_ratio_to_median: number | null;
    frp_delta_from_median: number | null;
    exceeds_p75: boolean;
    exceeds_p95: boolean;
    distance_to_nearest_configured_zone_meters: number | null;
    distance_to_observed_activity_zone_meters: number | null;
    distance_to_facility_meters: number | null;
  };
  explanation_reasons?: string[];
  source_hypotheses?: PrototypeSourceHypotheses;
  uncertainty?: UncertaintyAssessment;
  evidence_status?: string;
  evidence_status_detail?: EvidenceStatusDetail;
  investigation_priority?: InvestigationPriorityResult;
  evidence_guided_investigation?: EvidenceGuidedInvestigation;

  // Compatibility / convenience aliases
  caseId?: string;
  primaryEventId?: string;
  facilityId?: string | null;
  facilityName?: string;
  priorityScore?: number;
  priorityLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
  status?: 'ACTIVE_UNRESOLVED' | 'UNDER_REVIEW' | 'EVIDENCE_FUSED' | 'CLOSED_RESOLVED' | 'OPEN' | 'UNDER_INVESTIGATION' | 'RESOLVED';
  creationTimestamp?: string;
  initialHypotheses?: Record<SourceType, number>;
  currentHypotheses?: Record<SourceType, number>;
  deviationSummary?: {
    intensityDeltaPct: number;
    frequencyDeltaPct: number;
    durationDeltaPct: number;
    newZoneDetected: boolean;
    footprintExceededMeters: number;
    historicalMatchScore: number;
  };
  uncertaintyStatement?: string;
  recommendedEvidence?: EvidenceItem[];
  appliedEvidenceIds?: string[];
  auditTrail?: {
    timestamp: string;
    actor: string;
    action: string;
    note: string;
  }[];
  investigatorNotes?: string;
  uncertaintyReductionMetric?: {
    entropyBefore: number;
    entropyAfter: number;
    uncertaintyReductionPercent: number;
    confidenceGainPercent: number;
  };
  resolution?: {
    finalVerdict: SourceType;
    confidence: number;
    resolvedAt: string;
    actionRecommended: string;
  };
  thermal_discriminator?: ThermalSourceDiscriminatorOutput;
  thermalDiscriminator?: ThermalSourceDiscriminatorOutput;
}

export type InvestigationCaseData = InvestigationCase;

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

export interface BaselineComparisonMetrics {
  level: string;
  name: string;
  inputsUsed: string[];
  primaryOutput: string;
  explanationDepth: string;
  uncertaintyHandling: string;
  actionabilityScore: number; // 0 - 100
  falseAlarmRateReduction: number; // %
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

export type OsmAcquisitionMode =
  | 'LIVE_OVERPASS'
  | 'VERIFIED_LOCAL_SNAPSHOT'
  | 'NO_MAPPED_FEATURES'
  | 'ACQUISITION_FAILED'
  | 'OUT_OF_SCOPE';

export type OsmContextStatus =
  | 'AVAILABLE'
  | 'NO_MAPPED_FEATURES'
  | 'ACQUISITION_FAILED'
  | 'OUT_OF_SCOPE'
  | 'NOT_CURRENTLY_AVAILABLE'
  | 'LIVE_OVERPASS'
  | 'VERIFIED_LOCAL_SNAPSHOT'
  | 'AUTHENTIC_LIVE'
  | 'VERIFIED_LOCAL_CACHE'
  | 'NO_RELEVANT_FEATURES'
  | 'OSM_UNAVAILABLE'
  | 'SIMULATED_FALLBACK'
  | 'ERROR';

export interface OsmContextFeature {
  source: 'OPENSTREETMAP';
  feature_id: string;
  feature_type?: 'node' | 'way' | 'relation' | 'point' | 'polygon' | string;
  name: string | null;
  category: string;
  coordinates: [number, number];
  distance_meters: number;
  geometry_type: 'point' | 'way' | 'polygon' | 'relation';
  tags: Record<string, string>;
  relevance_note?: string;
  display_label?: string;
  display_tag?: string;
  provenance_mode?: 'LIVE_OVERPASS' | 'VERIFIED_LOCAL_SNAPSHOT';
}

export interface OsmProvenance {
  source: 'OPENSTREETMAP';
  provider?: 'OpenStreetMap';
  acquisition_mode?: OsmAcquisitionMode;
  api_endpoint: string;
  retrieval_timestamp: string;
  bounding_radius_km: number;
  query_radius_meters?: number;
  attribution: string;
}

export interface OsmContextResponse {
  status: OsmContextStatus;
  sub_status?:
    | 'LIVE_OVERPASS'
    | 'VERIFIED_LOCAL_SNAPSHOT'
    | 'AUTHENTIC_LIVE'
    | 'VERIFIED_LOCAL_CACHE'
    | 'NO_MAPPED_FEATURES'
    | 'ACQUISITION_FAILED'
    | 'OUT_OF_SCOPE'
    | 'NOT_CURRENTLY_AVAILABLE';
  is_live_external: boolean;
  query_center: [number, number];
  search_radius_meters: number;
  total_features_found: number;
  nearest_feature: OsmContextFeature | null;
  features: OsmContextFeature[];
  elements?: OsmContextFeature[];
  categories_summary: Record<string, number>;
  provenance: OsmProvenance;
  analytical_status: 'CONTEXTUAL_GEOSPATIAL_EVIDENCE';
  analytical_authority_disclaimer: string;
}


export interface WeatherMetrics {
  temperature_c: number | null;
  relative_humidity_pct: number | null;
  precipitation_mm: number | null;
  weather_code: number | null;
  weather_condition: string;
  wind_speed_kmh: number | null;
  wind_speed_ms: number | null;
  wind_direction_from_deg: number | null;
  wind_direction_toward_deg: number | null;
  wind_cardinal_from: string;
  wind_cardinal_toward: string;
}

export interface WeatherContextResponse {
  status: 'AUTHENTIC_HISTORICAL' | 'SIMULATED_FALLBACK' | 'UNAVAILABLE';
  provider: string;
  source_endpoint: string;
  station_or_grid_point: {
    requested_lat: number;
    requested_lon: number;
    grid_lat?: number;
    grid_lon?: number;
    elevation_m?: number;
    distance_to_grid_km?: number;
  };
  observation_alignment: {
    firms_timestamp_utc: string;
    weather_record_timestamp_utc: string;
    temporal_difference_minutes: number;
    match_method: 'nearest_hourly_observation' | 'interpolated' | 'fallback';
  };
  metrics: WeatherMetrics;
  atmospheric_assessment: {
    dispersion_potential: 'POOR' | 'MODERATE' | 'GOOD' | 'HIGH';
    wind_stability: string;
    smoke_plume_advection_heading_deg: number | null;
    smoke_plume_advection_cardinal: string;
    fire_weather_risk_factor: 'LOW' | 'MODERATE' | 'ELEVATED' | 'EXTREME';
    summary: string;
  };
  confidence_score: number;
  retrieved_at_utc: string;
}

