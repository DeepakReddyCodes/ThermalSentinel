// ============================================================================
// ThermalSentinel — Section 7: Real Evidence Fusion & Uncertainty Engine
//
// Bridges the Contextual Hypothesis Engine, Behavioral Baseline Engine, and
// ML Advisory Discriminator into a unified, inspectable Evidence Fusion layer
// that quantifies Shannon Entropy uncertainty before and after evidence incorporation.
//
// Core Rules:
// 1. Evidence items have explicit provenance: REAL, DERIVED, CONTROLLED.
// 2. ML Advisory (GAS_FLARE ↔ WILDFIRE_CONFIRMED) is incorporated as advisory evidence
//    without fabricating unsupported multi-class predictions.
// 3. Evidence conflicts (e.g. contextual industrial fire vs wildfire-side radiometrics)
//    are explicitly exposed as structured conflicts rather than masked.
// 4. Shannon entropy is strictly computed from the active hypothesis distribution:
//    H = -Σ [ p_i * log2(p_i) ], H_max = log2(5) ≈ 2.322 bits, H_norm = H / H_max.
// 5. Initial vs. Current assessment tracks ΔH = H_initial - H_current dynamically.
// 6. Fused hypothesis distributions strictly sum to 100% (1.0).
// ============================================================================

import type {
  SourceHypothesisType,
  HypothesisSupport,
  UncertaintyAssessment,
  ThermalSourceDiscriminatorOutput,
  ExplicitEvidenceItem,
} from './types.js';

export type { ExplicitEvidenceItem };

export type EvidenceProvenance = 'REAL' | 'DERIVED' | 'CONTROLLED';
export type EvidenceReliability = 'HIGH' | 'MODERATE' | 'LOW';
export type EvidenceDirection = 'INCREASES_SUPPORT' | 'DECREASES_SUPPORT' | 'NEUTRAL';

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

export interface EntropyEvaluation {
  entropy_bits: number;
  max_possible_entropy_bits: number;
  normalized_entropy: number;
  uncertainty_percentage: number;
  uncertainty_level: 'LOW' | 'MODERATE' | 'HIGH';
  ambiguity_level: 'LOW' | 'MODERATE' | 'HIGH';
  is_ambiguous: boolean;
  summary: string;
  interpretation: string;
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
  entropy_delta_bits: number; // ΔH = H_initial - H_current
  uncertainty_reduction_percentage: number;
  uncertainty_status: 'UNCERTAINTY_REDUCED' | 'AMBIGUITY_INCREASED' | 'UNCHANGED';
  applied_evidence_count: number;
  applied_evidence_ids: string[];
}

export interface EvidenceFusionResult {
  fused_hypotheses: HypothesisSupport[];
  primary_hypothesis: string;
  primary_hypothesis_type: SourceHypothesisType;
  uncertainty: UncertaintyAssessment;
  evidence_items: ExplicitEvidenceItem[];
  applied_evidence: ExplicitEvidenceItem[];
  evidence_conflict: StructuredEvidenceConflict;
  initial_vs_current: InitialVsCurrentAssessment;
  methodology: {
    description: string;
    entropy_formula: string;
    normalization_check: string;
    uncalibrated_heuristic_notice: string;
  };
}

/**
 * Mathematically calculates Shannon Entropy directly from any hypothesis distribution.
 *
 * H = -Σ [ p_i * log2(p_i) ]
 * H_max = log2(K) (for K=5, H_max ≈ 2.3219 bits)
 * H_norm = H / H_max ∈ [0.0, 1.0]
 */
export function calculateExactShannonEntropy(
  distribution: Array<{ percentage: number; hypothesis?: string }>
): EntropyEvaluation {
  const K = ALL_CANDIDATE_HYPOTHESES.length; // 5 supported candidates
  const maxH = Math.log2(K); // ≈ 2.321928 bits

  if (!distribution || distribution.length === 0) {
    return {
      entropy_bits: 0,
      max_possible_entropy_bits: Math.round(maxH * 1000) / 1000,
      normalized_entropy: 0,
      uncertainty_percentage: 0,
      uncertainty_level: 'LOW',
      ambiguity_level: 'LOW',
      is_ambiguous: false,
      summary: 'Zero entropy (no active distribution)',
      interpretation: 'No distribution provided.',
    };
  }

  // Normalize percentages to probabilities p_i summing to 1.0
  const totalPct = distribution.reduce((sum, h) => sum + (h.percentage || 0), 0);
  const probs = distribution.map((h) => {
    const rawP = totalPct > 0 ? (h.percentage || 0) / totalPct : 1.0 / distribution.length;
    return Math.max(0.0001, rawP);
  });

  // Normalize probabilities exactly
  const pSum = probs.reduce((sum, p) => sum + p, 0);
  const normalizedProbs = probs.map((p) => p / pSum);

  // Compute Shannon Entropy H
  let H = 0;
  for (const p of normalizedProbs) {
    if (p > 0) {
      H -= p * Math.log2(p);
    }
  }

  // Round values
  const entropyBits = Math.max(0, Math.round(H * 1000) / 1000);
  const maxPossibleBits = Math.round(maxH * 1000) / 1000;
  const normH = Math.max(0, Math.min(1.0, Math.round((entropyBits / maxPossibleBits) * 1000) / 1000));
  const uncertaintyPct = Math.round(normH * 100);

  const topPct = Math.max(...distribution.map((h) => h.percentage || 0));

  const uncertaintyLevel: 'LOW' | 'MODERATE' | 'HIGH' =
    topPct >= 70 || normH < 0.35
      ? 'LOW'
      : topPct >= 45 || normH <= 0.65
      ? 'MODERATE'
      : 'HIGH';

  const isAmbiguous = uncertaintyLevel !== 'LOW';

  let interpretation = '';
  if (uncertaintyLevel === 'LOW') {
    interpretation = `Low Shannon entropy (H = ${entropyBits.toFixed(3)} bits, H_norm = ${uncertaintyPct}%) indicates concentrated support under a dominant candidate.`;
  } else if (uncertaintyLevel === 'MODERATE') {
    interpretation = `Moderate Shannon entropy (H = ${entropyBits.toFixed(3)} bits, H_norm = ${uncertaintyPct}%) indicates competition between secondary candidates. Next-Best-Evidence acquisition is recommended.`;
  } else {
    interpretation = `High Shannon entropy (H = ${entropyBits.toFixed(3)} bits, H_norm = ${uncertaintyPct}%) indicates substantial ambiguity across multiple plausible source classes. High-utility evidence is required to resolve conflicting explanations.`;
  }

  return {
    entropy_bits: entropyBits,
    max_possible_entropy_bits: maxPossibleBits,
    normalized_entropy: normH,
    uncertainty_percentage: uncertaintyPct,
    uncertainty_level: uncertaintyLevel,
    ambiguity_level: uncertaintyLevel,
    is_ambiguous: isAmbiguous,
    summary: `${uncertaintyLevel} Uncertainty (${entropyBits.toFixed(3)} bits, ${uncertaintyPct}% normalized)`,
    interpretation,
  };
}

/**
 * Constructs structured, explicit evidence items from contextual, spatial, behavioural,
 * radiometric, and ML advisory signals with strict provenance tracking.
 */
export function collectExplicitEvidenceItems(params: {
  obs: any;
  spatial_assessment?: any;
  behaviour_assessment?: any;
  ml_discriminator?: ThermalSourceDiscriminatorOutput;
  osm_context?: any;
  weather_context?: any;
  sentinel2_context?: any;
  additional_evidence?: ExplicitEvidenceItem[];
  is_controlled?: boolean;
}): ExplicitEvidenceItem[] {
  const {
    obs,
    spatial_assessment,
    behaviour_assessment,
    ml_discriminator,
    osm_context,
    weather_context,
    sentinel2_context,
    additional_evidence = [],
    is_controlled = false,
  } = params;

  const items: ExplicitEvidenceItem[] = [];
  const now = obs?.timestamp || new Date().toISOString();
  const baseProvenance: EvidenceProvenance = is_controlled ? 'CONTROLLED' : 'REAL';

  // --------------------------------------------------------------------------
  // 1. FIRMS Radiometric Intensity & Diurnal Timing Evidence
  // --------------------------------------------------------------------------
  const frp = typeof obs?.frp === 'number' ? obs.frp : 0;
  const dn = (obs?.day_night || obs?.dayNight || 'N').toString().toUpperCase();
  const isNight = dn === 'N';

  items.push({
    evidence_id: 'EVID-FIRMS-RADIOMETRY',
    source: 'NASA_FIRMS_VIIRS',
    evidence_type: 'RADIOMETRIC_INTENSITY_AND_DIURNAL_TIMING',
    title: `FIRMS VIIRS Detection (FRP: ${frp.toFixed(1)} MW, ${isNight ? 'Night' : 'Day'})`,
    description: `VIIRS detection with Fire Radiative Power ${frp.toFixed(1)} MW during ${isNight ? 'nighttime pass (infrared contrast with ambient terrain)' : 'daytime pass'}.`,
    value: { frp, day_night: dn, brightness_ti4: obs?.brightness_ti4, brightness_ti5: obs?.brightness_ti5 },
    timestamp: now,
    spatial_relationship: spatial_assessment?.spatial_classification || 'UNKNOWN',
    provenance: baseProvenance,
    reliability: 'HIGH',
    applicability: 'Initial thermal signal detection, diurnal timing, and radiative intensity bounds.',
    affected_hypotheses: ['GAS_FLARE', 'INDUSTRIAL_FIRE', 'AGRICULTURAL_BURN', 'WILDFIRE_VEGETATION'],
    direction_of_influence: {
      GAS_FLARE: isNight ? 'INCREASES_SUPPORT' : 'NEUTRAL',
      INDUSTRIAL_FIRE: frp >= 15 ? 'INCREASES_SUPPORT' : 'NEUTRAL',
      AGRICULTURAL_BURN: !isNight ? 'INCREASES_SUPPORT' : 'DECREASES_SUPPORT',
      WILDFIRE_VEGETATION: frp >= 25 ? 'INCREASES_SUPPORT' : 'NEUTRAL',
      OTHER: 'NEUTRAL',
    },
    strength_of_influence: {
      GAS_FLARE: 0,
      INDUSTRIAL_FIRE: 0,
      AGRICULTURAL_BURN: 0,
      WILDFIRE_VEGETATION: 0,
      OTHER: 0,
    },
    is_acquired: true,
    is_evaluated: true,
    is_temporally_eligible: true,
    temporal_status: 'TEMPORALLY_RELEVANT',
    is_incorporated: false,
    changed_posterior: false,
    incorporation_rationale: 'Primary satellite infrared observation defining baseline thermal detection, incorporated into contextual prior.',
  });

  // --------------------------------------------------------------------------
  // 2. Geospatial Facility Association Evidence
  // --------------------------------------------------------------------------
  if (spatial_assessment) {
    const isInside = spatial_assessment.is_inside_polygon;
    const isKnownZone = spatial_assessment.spatial_classification === 'KNOWN_THERMAL_ZONE';
    const isOffZone = spatial_assessment.spatial_classification === 'FACILITY_OFF_ZONE';
    const isBuffer = spatial_assessment.spatial_classification === 'FACILITY_BUFFER';
    const isUnassociated = spatial_assessment.spatial_classification === 'UNASSOCIATED' || !spatial_assessment.is_associated;

    items.push({
      evidence_id: 'EVID-GEOSPATIAL-FACILITY',
      source: 'FACILITY_GEOMETRY_REGISTRY',
      evidence_type: 'POINT_IN_POLYGON_SPATIAL_RELATIONSHIP',
      title: `Spatial Relationship: ${spatial_assessment.spatial_classification_label || spatial_assessment.spatial_classification}`,
      description: spatial_assessment.matched_facility
        ? `Observation is located ${spatial_assessment.spatial_classification_label} of ${spatial_assessment.matched_facility.name} (distance: ${spatial_assessment.facility_distance_meters != null ? `${spatial_assessment.facility_distance_meters}m` : '0m'}).`
        : 'Observation is located outside all monitored industrial facility perimeters in regional terrain.',
      value: {
        spatial_classification: spatial_assessment.spatial_classification,
        facility_id: spatial_assessment.matched_facility?.id || null,
        distance_meters: spatial_assessment.facility_distance_meters,
      },
      timestamp: now,
      spatial_relationship: spatial_assessment.spatial_classification,
      provenance: 'DERIVED',
      reliability: 'HIGH',
      applicability: 'Discriminates industrial facility-associated events from open rural/vegetative burning.',
      affected_hypotheses: ALL_CANDIDATE_HYPOTHESES,
      direction_of_influence: {
        GAS_FLARE: isKnownZone ? 'INCREASES_SUPPORT' : isUnassociated ? 'DECREASES_SUPPORT' : 'NEUTRAL',
        INDUSTRIAL_FIRE: isOffZone ? 'INCREASES_SUPPORT' : isUnassociated ? 'DECREASES_SUPPORT' : 'NEUTRAL',
        AGRICULTURAL_BURN: isUnassociated ? 'INCREASES_SUPPORT' : 'DECREASES_SUPPORT',
        WILDFIRE_VEGETATION: isUnassociated ? 'INCREASES_SUPPORT' : 'DECREASES_SUPPORT',
        OTHER: 'NEUTRAL',
      },
      strength_of_influence: {
        GAS_FLARE: 0,
        INDUSTRIAL_FIRE: 0,
        AGRICULTURAL_BURN: 0,
        WILDFIRE_VEGETATION: 0,
        OTHER: 0,
      },
      is_acquired: false,
      is_evaluated: true,
      is_temporally_eligible: false,
      temporal_status: 'NOT_APPLICABLE',
      is_incorporated: false,
      changed_posterior: false,
      incorporation_rationale: 'Geometric containment and buffer boundaries evaluated from facility registry as spatial likelihood.',
    });
  }

  // --------------------------------------------------------------------------
  // 3. Empirical Behavioural Baseline & Percentile Excursion Evidence
  // --------------------------------------------------------------------------
  if (behaviour_assessment && behaviour_assessment.baseline_status === 'EMPIRICAL') {
    const bStatus = behaviour_assessment.behavioural_status;
    const ratio = behaviour_assessment.deviation_metrics?.frp_ratio_to_median ?? 1.0;
    const isAnomalous = bStatus === 'ANOMALOUS';
    const isElevated = bStatus === 'ELEVATED';
    const isNormal = bStatus === 'NORMAL';

    items.push({
      evidence_id: 'EVID-BEHAVIOURAL-BASELINE',
      source: 'FACILITY_BEHAVIOURAL_BASELINE_ENGINE',
      evidence_type: 'EMPIRICAL_PERCENTILE_EXCURSION',
      title: `Behavioural Baseline: ${bStatus} (${ratio.toFixed(1)}× median)`,
      description: `Observed thermal intensity (${frp.toFixed(1)} MW) is ${ratio.toFixed(1)}× the historical empirical operational median (${behaviour_assessment.baseline_metrics.frp_median?.toFixed(1) || 2.3} MW). Baseline P95: ${behaviour_assessment.baseline_metrics.frp_p95?.toFixed(1) || 6.4} MW.`,
      value: {
        behavioural_status: bStatus,
        ratio_to_median: ratio,
        median: behaviour_assessment.baseline_metrics.frp_median,
        p75: behaviour_assessment.baseline_metrics.frp_p75,
        p95: behaviour_assessment.baseline_metrics.frp_p95,
      },
      timestamp: now,
      spatial_relationship: spatial_assessment?.spatial_classification,
      provenance: 'DERIVED',
      reliability: 'HIGH',
      applicability: 'Distinguishes routine flaring within expected operational envelope from abnormal heat excursions.',
      affected_hypotheses: ['GAS_FLARE', 'INDUSTRIAL_FIRE', 'OTHER'],
      direction_of_influence: {
        GAS_FLARE: isNormal ? 'INCREASES_SUPPORT' : isAnomalous ? 'DECREASES_SUPPORT' : 'NEUTRAL',
        INDUSTRIAL_FIRE: isAnomalous ? 'INCREASES_SUPPORT' : isNormal ? 'DECREASES_SUPPORT' : 'NEUTRAL',
        AGRICULTURAL_BURN: 'NEUTRAL',
        WILDFIRE_VEGETATION: 'NEUTRAL',
        OTHER: 'NEUTRAL',
      },
      strength_of_influence: {
        GAS_FLARE: 0,
        INDUSTRIAL_FIRE: 0,
        AGRICULTURAL_BURN: 0,
        WILDFIRE_VEGETATION: 0,
        OTHER: 0,
      },
      is_acquired: false,
      is_evaluated: true,
      is_temporally_eligible: false,
      temporal_status: 'NOT_APPLICABLE',
      is_incorporated: false,
      changed_posterior: false,
      incorporation_rationale: 'Empirical multi-month facility baseline distribution evaluated as contextual operational metadata.',
    });
  }

  // --------------------------------------------------------------------------
  // 4. ML Advisory Radiometric Discriminator Evidence (Binary Task Safe)
  // --------------------------------------------------------------------------
  if (ml_discriminator && ml_discriminator.status === 'AVAILABLE') {
    const isWfSide = ml_discriminator.predicted_class === 'WILDFIRE_CONFIRMED';
    const flareScore = ml_discriminator.flare_score ?? 0.5;
    const wfScore = ml_discriminator.wildfire_score ?? 0.5;

    // Bounded advisory weights reflecting binary task scope
    const mlStrength: Record<SourceHypothesisType, number> = {
      GAS_FLARE: flareScore >= 0.70 ? 8 : flareScore >= 0.50 ? 4 : -5,
      INDUSTRIAL_FIRE: 0, // Model does NOT predict industrial fire; zero direct contribution
      AGRICULTURAL_BURN: isWfSide ? 2 : -2,
      WILDFIRE_VEGETATION: wfScore >= 0.80 ? 8 : wfScore >= 0.50 ? 4 : -5,
      OTHER: 0,
    };

    items.push({
      evidence_id: 'EVID-ML-DISCRIMINATOR',
      source: 'THERMAL_SOURCE_DISCRIMINATOR_LR',
      evidence_type: 'STANDARDIZED_LOGISTIC_REGRESSION_ADVISORY',
      title: `ML Discriminator: ${ml_discriminator.predicted_label || (isWfSide ? 'Wildfire-side' : 'Gas Flare')} (${isWfSide ? `${(wfScore * 100).toFixed(0)}%` : `${(flareScore * 100).toFixed(0)}%`})`,
      description: `Standardized VIIRS I-band logistic regression advisory signal conditional on binary task (Gas Flare ↔ Wildfire). Flare score: ${(flareScore * 100).toFixed(1)}%, Wildfire-side score: ${(wfScore * 100).toFixed(1)}%. Note: Uncontained industrial fire is outside the binary training scope.`,
      value: {
        model_id: ml_discriminator.model_id || 'lr-v5f3-standardized',
        predicted_class: ml_discriminator.predicted_class,
        flare_score: flareScore,
        wildfire_score: wfScore,
        decision_boundary: 0.50,
      },
      timestamp: now,
      provenance: 'DERIVED',
      reliability: 'MODERATE',
      applicability: 'Binary radiometric spectral contrast (VIIRS TI4 vs TI5) discrimination.',
      affected_hypotheses: ['GAS_FLARE', 'WILDFIRE_VEGETATION'],
      direction_of_influence: {
        GAS_FLARE: flareScore >= 0.60 ? 'INCREASES_SUPPORT' : 'DECREASES_SUPPORT',
        INDUSTRIAL_FIRE: 'NEUTRAL',
        AGRICULTURAL_BURN: 'NEUTRAL',
        WILDFIRE_VEGETATION: wfScore >= 0.60 ? 'INCREASES_SUPPORT' : 'DECREASES_SUPPORT',
        OTHER: 'NEUTRAL',
      },
      strength_of_influence: mlStrength,
      is_acquired: false,
      is_evaluated: true,
      is_temporally_eligible: false,
      temporal_status: 'NOT_APPLICABLE',
      is_incorporated: false,
      changed_posterior: false,
      incorporation_rationale: 'Standardized logistic regression radiometric advisory; evaluated internally as derived signal for structured conflict analysis and feature explainability but excluded from authoritative Bayesian posterior.',
    });
  }

  // --------------------------------------------------------------------------
  // 5. OpenStreetMap Infrastructure Context Evidence (Where available)
  // --------------------------------------------------------------------------
  if (osm_context && osm_context.status === 'OK' && osm_context.elements) {
    const hasFlareStack = osm_context.elements.some((el: any) =>
      (el.tags?.man_made === 'flare' || el.tags?.industrial === 'flare_stack' || el.tags?.name?.toLowerCase().includes('flare'))
    );
    const hasPetroleumTank = osm_context.elements.some((el: any) =>
      (el.tags?.man_made === 'storage_tank' || el.tags?.content === 'oil' || el.tags?.content === 'petroleum')
    );

    const osmStrength: Record<SourceHypothesisType, number> = {
      GAS_FLARE: hasFlareStack ? 12 : 0,
      INDUSTRIAL_FIRE: hasPetroleumTank ? 8 : 0,
      AGRICULTURAL_BURN: -5,
      WILDFIRE_VEGETATION: -5,
      OTHER: 3,
    };

    items.push({
      evidence_id: 'EVID-OSM-INFRASTRUCTURE',
      source: 'OPENSTREETMAP_OVERPASS_API',
      evidence_type: 'MAPPED_INFRASTRUCTURE_TAGS',
      title: `OSM Infrastructure (${osm_context.elements.length} nearby features mapped)`,
      description: `Mapped industrial elements within radius: ${hasFlareStack ? 'Active Flare Stack identified; ' : ''}${hasPetroleumTank ? 'Petroleum Storage Tanks mapped; ' : ''}${osm_context.elements.length} total OSM geometry tags.`,
      value: { element_count: osm_context.elements.length, has_flare_stack: hasFlareStack, has_storage_tank: hasPetroleumTank },
      timestamp: now,
      provenance: 'REAL',
      reliability: 'MODERATE',
      applicability: 'Confirms physical ground equipment locations (flare stacks, processing units, fuel tanks).',
      affected_hypotheses: ['GAS_FLARE', 'INDUSTRIAL_FIRE'],
      direction_of_influence: {
        GAS_FLARE: hasFlareStack ? 'INCREASES_SUPPORT' : 'NEUTRAL',
        INDUSTRIAL_FIRE: hasPetroleumTank ? 'INCREASES_SUPPORT' : 'NEUTRAL',
        AGRICULTURAL_BURN: 'DECREASES_SUPPORT',
        WILDFIRE_VEGETATION: 'DECREASES_SUPPORT',
        OTHER: 'NEUTRAL',
      },
      strength_of_influence: osmStrength,
      is_acquired: true,
      is_evaluated: true,
      is_temporally_eligible: true,
      temporal_status: 'TEMPORALLY_RELEVANT',
      is_incorporated: false,
      changed_posterior: false,
      incorporation_rationale: 'Ground infrastructure tags corroborate physical equipment presence.',
    });
  }

  // --------------------------------------------------------------------------
  // 6. Weather / Atmospheric Dispersion Context Evidence (Where available)
  // --------------------------------------------------------------------------
  if (weather_context && weather_context.current) {
    const windSpeed = weather_context.current.wind_speed_10m || 0;
    const humidity = weather_context.current.relative_humidity_2m || 50;

    const weatherStrength: Record<SourceHypothesisType, number> = {
      GAS_FLARE: 0,
      INDUSTRIAL_FIRE: windSpeed > 25 ? 5 : 0,
      AGRICULTURAL_BURN: humidity < 30 ? 5 : 0,
      WILDFIRE_VEGETATION: (windSpeed > 30 && humidity < 25) ? 8 : 0,
      OTHER: 0,
    };

    items.push({
      evidence_id: 'EVID-WEATHER-ATMOSPHERIC',
      source: 'OPEN_METEO_HISTORICAL_API',
      evidence_type: 'SURFACE_METEOROLOGICAL_CONDITIONS',
      title: `Surface Weather: Wind ${windSpeed.toFixed(1)} km/h, Humidity ${humidity}%`,
      description: `Surface wind speed: ${windSpeed.toFixed(1)} km/h, relative humidity: ${humidity}%, ambient temperature: ${weather_context.current.temperature_2m || 25}°C.`,
      value: { wind_speed_kmh: windSpeed, relative_humidity_pct: humidity },
      timestamp: now,
      provenance: 'REAL',
      reliability: 'HIGH',
      applicability: 'Informs atmospheric combustion dispersion and potential open-air flame propagation risk.',
      affected_hypotheses: ['INDUSTRIAL_FIRE', 'WILDFIRE_VEGETATION', 'AGRICULTURAL_BURN'],
      direction_of_influence: {
        GAS_FLARE: 'NEUTRAL',
        INDUSTRIAL_FIRE: windSpeed > 25 ? 'INCREASES_SUPPORT' : 'NEUTRAL',
        AGRICULTURAL_BURN: humidity < 30 ? 'INCREASES_SUPPORT' : 'NEUTRAL',
        WILDFIRE_VEGETATION: windSpeed > 30 ? 'INCREASES_SUPPORT' : 'NEUTRAL',
        OTHER: 'NEUTRAL',
      },
      strength_of_influence: weatherStrength,
      is_acquired: true,
      is_evaluated: true,
      is_temporally_eligible: true,
      temporal_status: 'TEMPORALLY_RELEVANT',
      is_incorporated: false,
      changed_posterior: false,
      incorporation_rationale: 'Local meteorological state governs flame behavior and propagation conditions.',
    });
  }

  // --------------------------------------------------------------------------
  // 7. Additional Applied / User-Provided Evidence Items (e.g. Sentinel-2 Optical)
  // --------------------------------------------------------------------------
  if (sentinel2_context && sentinel2_context.scene_id) {
    const hasUncontainedSpread = sentinel2_context.evidence_findings?.uncontained_spread ?? false;
    const hasSpatialExpansion = sentinel2_context.evidence_findings?.spatial_expansion ?? false;

    const s2Strength: Record<SourceHypothesisType, number> = {
      GAS_FLARE: (hasUncontainedSpread || hasSpatialExpansion) ? -40 : 25,
      INDUSTRIAL_FIRE: hasUncontainedSpread ? 45 : hasSpatialExpansion ? 30 : -10,
      AGRICULTURAL_BURN: 0,
      WILDFIRE_VEGETATION: hasSpatialExpansion ? 35 : 0,
      OTHER: -10,
    };

    items.push({
      evidence_id: 'EVID-SENTINEL2-SWIR',
      source: 'SENTINEL_HUB_S2_L2A',
      evidence_type: 'OPTICAL_SWIR_REFLECTANCE_INSPECTION',
      title: `Sentinel-2 SWIR Inspection (${sentinel2_context.scene_id})`,
      description: `20m resolution optical/SWIR inspection. Spatial expansion: ${hasSpatialExpansion ? 'DETECTED' : 'NONE'}, Uncontained ground spread: ${hasUncontainedSpread ? 'CONFIRMED' : 'NEGATIVE'}.`,
      value: sentinel2_context,
      timestamp: sentinel2_context.acquisition_timestamp || now,
      provenance: sentinel2_context.status === 'AUTHENTIC_LIVE' ? 'REAL' : 'CONTROLLED',
      reliability: 'HIGH',
      applicability: 'High-resolution optical discrimination of emitter geometry and ground-level structural fire spread.',
      affected_hypotheses: ['GAS_FLARE', 'INDUSTRIAL_FIRE', 'WILDFIRE_VEGETATION'],
      direction_of_influence: {
        GAS_FLARE: hasUncontainedSpread ? 'DECREASES_SUPPORT' : 'INCREASES_SUPPORT',
        INDUSTRIAL_FIRE: hasUncontainedSpread ? 'INCREASES_SUPPORT' : 'DECREASES_SUPPORT',
        AGRICULTURAL_BURN: 'NEUTRAL',
        WILDFIRE_VEGETATION: hasSpatialExpansion ? 'INCREASES_SUPPORT' : 'NEUTRAL',
        OTHER: 'NEUTRAL',
      },
      strength_of_influence: s2Strength,
      is_acquired: true,
      is_evaluated: true,
      is_temporally_eligible: sentinel2_context.status === 'AUTHENTIC_LIVE' ? false : true,
      temporal_status: sentinel2_context.status === 'AUTHENTIC_LIVE' ? 'TEMPORALLY_DISTANT' : 'TEMPORALLY_RELEVANT',
      is_incorporated: false,
      changed_posterior: false,
      incorporation_rationale: 'High-resolution multispectral imagery resolves ground-level combustion geometry.',
    });
  }

  // Include user or scenario additional evidence
  for (const add of additional_evidence) {
    items.push(add);
  }

  return items;
}

/**
 * Detects structured evidence conflicts between Contextual Hypothesis Engine,
 * Behaviour Engine, and ML Discriminator without masking disagreements.
 */
export function detectStructuredEvidenceConflict(
  contextualDistribution: HypothesisSupport[],
  mlDiscriminator?: ThermalSourceDiscriminatorOutput
): StructuredEvidenceConflict {
  if (!mlDiscriminator || mlDiscriminator.status !== 'AVAILABLE') {
    return {
      has_conflict: false,
      severity: 'NONE',
      conflicting_sources: [],
      hypotheses_involved: [],
      reason: 'No conflicting evidence detected (ML advisory is out of scope or not evaluated).',
      contextual_leading_hypothesis: contextualDistribution?.[0]?.label || 'Unknown',
      contextual_support_pct: contextualDistribution?.[0]?.percentage || 0,
      resolution_requirement: 'None required.',
    };
  }

  const topContextual = contextualDistribution?.[0];
  const topContextType = topContextual?.hypothesis as SourceHypothesisType;
  const isContextualIndustrial = topContextType === 'INDUSTRIAL_FIRE' || topContextType === 'GAS_FLARE';
  const isMlWildfire = mlDiscriminator.predicted_class === 'WILDFIRE_CONFIRMED' || (mlDiscriminator.wildfire_score ?? 0) >= 0.65;
  const isMlFlare = mlDiscriminator.predicted_class === 'GAS_FLARE' || (mlDiscriminator.flare_score ?? 0) >= 0.70;

  // Case 1: Contextual engine favors Industrial Fire / Abnormal Heat while ML favors Wildfire-side
  if (topContextType === 'INDUSTRIAL_FIRE' && isMlWildfire) {
    return {
      has_conflict: true,
      severity: 'HIGH',
      conflicting_sources: [
        'CONTEXTUAL_HYPOTHESIS_ENGINE',
        'FACILITY_BEHAVIOURAL_BASELINE_ENGINE',
        'THERMAL_SOURCE_DISCRIMINATOR_LR',
      ],
      hypotheses_involved: ['INDUSTRIAL_FIRE', 'WILDFIRE_VEGETATION'],
      reason: `Contextual and behavioural baseline evidence strongly favor Industrial Fire (${topContextual.percentage}%) inside facility boundary, whereas radiometric ML discriminator indicates a Wildfire-side spectral contrast (${Math.round((mlDiscriminator.wildfire_score ?? 1) * 100)}%). Analytical cause: Uncontained industrial fire is outside the binary training scope of the discriminator (Gas Flare ↔ Wildfire); anomalous ground-level heat triggers the wildfire-side score.`,
      contextual_leading_hypothesis: topContextual.label,
      contextual_support_pct: topContextual.percentage,
      discriminator_class: 'Wildfire-side signal',
      discriminator_score_pct: Math.round((mlDiscriminator.wildfire_score ?? 1) * 100),
      resolution_requirement: 'Acquire Next-Best-Evidence (Sentinel-2 SWIR optical inspection or operational SCADA logs) to resolve ground emitter geometry.',
    };
  }

  // Case 2: Contextual engine favors Wildfire / Vegetation while ML favors Gas Flare
  if (topContextType === 'WILDFIRE_VEGETATION' && isMlFlare) {
    return {
      has_conflict: true,
      severity: 'MODERATE',
      conflicting_sources: [
        'CONTEXTUAL_HYPOTHESIS_ENGINE',
        'THERMAL_SOURCE_DISCRIMINATOR_LR',
      ],
      hypotheses_involved: ['WILDFIRE_VEGETATION', 'GAS_FLARE'],
      reason: `Contextual land context favors Wildfire/Vegetation (${topContextual.percentage}%), but radiometric features align with high-temperature point-source flaring (${Math.round((mlDiscriminator.flare_score ?? 1) * 100)}%). Note: Binary training scope evaluates point-source contrast without land-use priors.`,
      contextual_leading_hypothesis: topContextual.label,
      contextual_support_pct: topContextual.percentage,
      discriminator_class: 'Gas Flare',
      discriminator_score_pct: Math.round((mlDiscriminator.flare_score ?? 1) * 100),
      resolution_requirement: 'Query OpenStreetMap Overpass or satellite imagery to verify unmapped industrial infrastructure in the area.',
    };
  }

  return {
    has_conflict: false,
    severity: 'NONE',
    conflicting_sources: [],
    hypotheses_involved: [],
    reason: 'Contextual hypothesis assessment and radiometric ML advisory are in directional agreement.',
    contextual_leading_hypothesis: topContextual?.label || 'Routine Gas Flare',
    contextual_support_pct: topContextual?.percentage || 70,
    discriminator_class: mlDiscriminator.predicted_label,
    discriminator_score_pct: Math.round(((mlDiscriminator.predicted_class === 'GAS_FLARE' ? mlDiscriminator.flare_score : mlDiscriminator.wildfire_score) ?? 0.8) * 100),
    resolution_requirement: 'Routine operational monitoring.',
  };
}

/**
 * Resolves the conditional likelihood vector P(E | H) for an evidence item.
 * Explicitly maps to PROTOTYPE_INFORMATION_MODEL conditional likelihood matrices.
 */
export function getEvidenceLikelihoodMap(
  item: ExplicitEvidenceItem
): Record<SourceHypothesisType, number> {
  // 1. Explicit likelihood vector attached to item
  if (item.likelihood_by_hypothesis) {
    return item.likelihood_by_hypothesis;
  }

  // 2. Map from outcome_id if present
  if (item.outcome_id === 'POINT_EMITTER_ELEVATED_STACK') {
    return { GAS_FLARE: 0.82, INDUSTRIAL_FIRE: 0.04, AGRICULTURAL_BURN: 0.01, WILDFIRE_VEGETATION: 0.01, OTHER: 0.12 };
  }
  if (item.outcome_id === 'SURFACE_SPREAD_PROCESS_STRUCTURE') {
    return { GAS_FLARE: 0.04, INDUSTRIAL_FIRE: 0.80, AGRICULTURAL_BURN: 0.04, WILDFIRE_VEGETATION: 0.04, OTHER: 0.08 };
  }

  // 3. Fallback for legacy items with strength_of_influence
  if (item.strength_of_influence) {
    const minStrength = Math.min(...Object.values(item.strength_of_influence));
    const maxStrength = Math.max(...Object.values(item.strength_of_influence));
    if (minStrength !== maxStrength) {
      const res: Record<SourceHypothesisType, number> = {} as any;
      for (const h of ALL_CANDIDATE_HYPOTHESES) {
        const d = item.strength_of_influence[h] ?? 0;
        res[h] = Math.exp(d / 20);
      }
      return res;
    }
  }

  // 4. Default neutral likelihood if non-informative / uncalibrated
  return {
    GAS_FLARE: 0.20,
    INDUSTRIAL_FIRE: 0.20,
    AGRICULTURAL_BURN: 0.20,
    WILDFIRE_VEGETATION: 0.20,
    OTHER: 0.20,
  };
}

/**
 * Executes Authoritative Bayesian-Compatible Evidence Fusion:
 * Takes the initial baseline distribution P_0(H) from the Contextual Hypothesis Engine,
 * incorporates applied evidence items E_j via exact likelihood multiplication:
 *
 *   P_new(H) ∝ P_0(H) * ∏_{j} P(E_j | H)
 *
 * followed by normalization to ∑ P_new(H) = 1.0 (100%), and calculates exact
 * Shannon entropy and uncertainty delta (ΔH).
 */
export function fuseEvidenceAndAssessUncertainty(params: {
  initialDistribution: HypothesisSupport[];
  evidenceItems: ExplicitEvidenceItem[];
  mlDiscriminator?: ThermalSourceDiscriminatorOutput;
  appliedEvidenceIds?: string[];
}): EvidenceFusionResult {
  const {
    initialDistribution,
    evidenceItems,
    mlDiscriminator,
    appliedEvidenceIds,
  } = params;

  // 1. Initial Assessment Baseline
  const initialEntropy = calculateExactShannonEntropy(initialDistribution);
  const initialAssoc: HypothesisSupport[] = [...initialDistribution];

  // 2. Filter evidence items to incorporate with strict deduplication by evidence_id
  const seenIds = new Set<string>();
  const appliedItems: ExplicitEvidenceItem[] = [];
  for (const item of evidenceItems) {
    const isRequested = appliedEvidenceIds !== undefined
      ? appliedEvidenceIds.includes(item.evidence_id)
      : true;
    const shouldInclude = isRequested && item.is_incorporated === true;
    if (shouldInclude && !seenIds.has(item.evidence_id)) {
      seenIds.add(item.evidence_id);
      appliedItems.push(item);
    }
  }

  // 3. Exact Bayesian Posterior Computation
  let fusedDistribution: HypothesisSupport[];
  let currentEntropy: ReturnType<typeof calculateExactShannonEntropy>;

  if (appliedItems.length === 0) {
    fusedDistribution = [...initialDistribution];
    currentEntropy = initialEntropy;
  } else {
    // Extract initial probability vector P_0(h)
    const initialProbMap: Record<SourceHypothesisType, number> = {
      GAS_FLARE: 0,
      INDUSTRIAL_FIRE: 0,
      AGRICULTURAL_BURN: 0,
      WILDFIRE_VEGETATION: 0,
      OTHER: 0,
    };
    for (const h of initialDistribution) {
      const key = h.hypothesis as SourceHypothesisType;
      if (initialProbMap[key] !== undefined) {
        initialProbMap[key] = (h.percentage || 0) / 100;
      }
    }

    // Accumulate unnormalized posterior scores: S(h) = P_0(h) * ∏_{j} P(E_j | h)
    const unnormalizedScores: Record<SourceHypothesisType, number> = {
      GAS_FLARE: initialProbMap.GAS_FLARE,
      INDUSTRIAL_FIRE: initialProbMap.INDUSTRIAL_FIRE,
      AGRICULTURAL_BURN: initialProbMap.AGRICULTURAL_BURN,
      WILDFIRE_VEGETATION: initialProbMap.WILDFIRE_VEGETATION,
      OTHER: initialProbMap.OTHER,
    };

    for (const item of appliedItems) {
      const likelihoods = getEvidenceLikelihoodMap(item);
      for (const hType of ALL_CANDIDATE_HYPOTHESES) {
        const l = likelihoods[hType] ?? 0.20;
        unnormalizedScores[hType] = unnormalizedScores[hType] * l;
      }
    }

    // Normalization factor Z = ∑ S(h')
    const scoreSum = Object.values(unnormalizedScores).reduce((sum, v) => sum + v, 0);

    const normalizedPosteriors: Record<SourceHypothesisType, number> = {} as any;
    for (const hType of ALL_CANDIDATE_HYPOTHESES) {
      normalizedPosteriors[hType] = scoreSum > 0
        ? unnormalizedScores[hType] / scoreSum
        : initialProbMap[hType];
    }

    // Largest Remainder Method: convert float probabilities to exact integers summing to 100
    const rawPercentages: Record<SourceHypothesisType, number> = {} as any;
    const floored: Record<SourceHypothesisType, number> = {} as any;
    const remainders: Array<{ type: SourceHypothesisType; rem: number }> = [];
    let flooredSum = 0;

    for (const hType of ALL_CANDIDATE_HYPOTHESES) {
      const rawPct = normalizedPosteriors[hType] * 100;
      rawPercentages[hType] = rawPct;
      const floorVal = Math.floor(rawPct);
      floored[hType] = floorVal;
      flooredSum += floorVal;
      remainders.push({ type: hType, rem: rawPct - floorVal });
    }

    let remainderToDistribute = 100 - flooredSum;
    remainders.sort((a, b) => b.rem - a.rem);
    for (let i = 0; i < remainderToDistribute; i++) {
      floored[remainders[i % remainders.length].type] += 1;
    }

    // Build final sorted fused hypothesis distribution
    fusedDistribution = ALL_CANDIDATE_HYPOTHESES.map((hType) => {
      const pct = floored[hType];
      const initialItem = initialDistribution.find((h) => h.hypothesis === hType);
      return {
        hypothesis: hType,
        label: HYPOTHESIS_DISPLAY_LABELS[hType],
        percentage: pct,
        normalized_score: Math.round((pct / 100) * 1000) / 1000,
        support_level:
          pct >= 70
            ? 'VERY_HIGH'
            : pct >= 45
            ? 'HIGH'
            : pct >= 20
            ? 'MODERATE'
            : pct >= 5
            ? 'LOW'
            : 'MINIMAL',
        reasons: initialItem?.reasons || [],
        feature_contributions: initialItem?.feature_contributions || [],
      };
    }).sort((a, b) => b.percentage - a.percentage);

    currentEntropy = calculateExactShannonEntropy(fusedDistribution);
  }

  // 5. Compute ΔH = H_initial - H_current
  const deltaH = Math.round((initialEntropy.entropy_bits - currentEntropy.entropy_bits) * 1000) / 1000;
  const initialH = initialEntropy.entropy_bits;
  const uncertaintyReductionPct =
    initialH > 0 ? Math.round((deltaH / initialH) * 100) : 0;

  const uncertaintyStatus: 'UNCERTAINTY_REDUCED' | 'AMBIGUITY_INCREASED' | 'UNCHANGED' =
    deltaH > 0.005
      ? 'UNCERTAINTY_REDUCED'
      : deltaH < -0.005
      ? 'AMBIGUITY_INCREASED'
      : 'UNCHANGED';

  // 6. Detect Evidence Conflict
  const conflict = detectStructuredEvidenceConflict(fusedDistribution, mlDiscriminator);

  const topFused = fusedDistribution[0];

  const uncertaintyAssessment: UncertaintyAssessment = {
    entropy_bits: currentEntropy.entropy_bits,
    max_possible_entropy_bits: currentEntropy.max_possible_entropy_bits,
    normalized_entropy: currentEntropy.normalized_entropy,
    uncertainty_level: currentEntropy.uncertainty_level,
    is_ambiguous: currentEntropy.is_ambiguous,
    summary: currentEntropy.summary,
    interpretation: currentEntropy.interpretation,
    competing_hypotheses_count: fusedDistribution.filter((h) => h.percentage >= 15).length,
    active_hypotheses_count: fusedDistribution.filter((h) => h.percentage > 0).length,
  };

  const initialVsCurrent: InitialVsCurrentAssessment = {
    initial_assessment: {
      hypotheses_distribution: initialAssoc,
      entropy_bits: initialEntropy.entropy_bits,
      normalized_entropy: initialEntropy.normalized_entropy,
      uncertainty_level: initialEntropy.uncertainty_level,
    },
    current_assessment: {
      hypotheses_distribution: fusedDistribution,
      entropy_bits: currentEntropy.entropy_bits,
      normalized_entropy: currentEntropy.normalized_entropy,
      uncertainty_level: currentEntropy.uncertainty_level,
    },
    entropy_delta_bits: deltaH,
    uncertainty_reduction_percentage: uncertaintyReductionPct,
    uncertainty_status: uncertaintyStatus,
    applied_evidence_count: appliedItems.length,
    applied_evidence_ids: appliedItems.map((e) => e.evidence_id),
  };

  return {
    fused_hypotheses: fusedDistribution,
    primary_hypothesis: topFused.label,
    primary_hypothesis_type: topFused.hypothesis as SourceHypothesisType,
    uncertainty: uncertaintyAssessment,
    evidence_items: evidenceItems,
    applied_evidence: appliedItems,
    evidence_conflict: conflict,
    initial_vs_current: initialVsCurrent,
    methodology: {
      description: 'Bounded additive heuristic evidence weighting fused over contextual spatial and empirical behavioural priors.',
      entropy_formula: 'H(p) = -Σ [ p_i * log2(p_i) ], H_max = log2(5) ≈ 2.322 bits, H_norm = H / H_max.',
      normalization_check: 'Candidate support percentages strictly sum to 100%.',
      uncalibrated_heuristic_notice: 'Support values reflect normalized heuristic evidence weights and Shannon entropy, not calibrated incident likelihoods.',
    },
  };
}
