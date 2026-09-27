import {
  SourceHypothesisType,
  SpatialAssociationType,
  BehaviouralStatus,
  ContextualHypothesisItem,
  HypothesisFeatureContribution,
  PrototypeSourceHypotheses,
  UncertaintyAssessment,
  InvestigationPriorityResult,
} from './types.js';
import { TemporalPersistenceContext } from './persistenceEngine.js';
import { OsmContextResponse } from './osm.js';
import { EmpiricalFacilityBaseline } from './historicalIngestion.js';
import { evaluateBayesianSourceHypotheses } from './bayesianEngine.js';
import type { BayesianPosteriorResult } from './bayesianEngine.js';

export { evaluateBayesianSourceHypotheses };
export type { BayesianPosteriorResult };

export interface CanonicalHypothesisInput {
  // FIRMS Radiometry
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

  // Spatial Context
  spatial_association: SpatialAssociationType;
  distance_to_facility_meters?: number | null;
  distance_to_zone_meters?: number | null;
  facility_id?: string | null;
  facility_name?: string | null;
  facility_category?: string | null;
  matched_zone_name?: string | null;
  is_inside_polygon?: boolean;

  // Baseline & Behavioural Status
  behavioural_status?: BehaviouralStatus;
  baseline?: EmpiricalFacilityBaseline | null;

  // Auxiliary Context
  osm_context?: OsmContextResponse | null;
  persistence_context?: Partial<TemporalPersistenceContext> | null;
  land_cover_type?: 'industrial' | 'agricultural' | 'forest' | 'water' | 'urban_residential' | 'barren' | string | null;
  wind_speed_kmh?: number | null;
  sentinel_status?: 'AUTHENTIC_LIVE' | 'TEMPORALLY_RELEVANT' | 'TEMPORALLY_DISTANT' | 'UNAVAILABLE' | string | null;
}

export interface CanonicalAssessmentResult {
  source_hypotheses: PrototypeSourceHypotheses;
  hypothesis_rationales: {
    hypothesis: SourceHypothesisType;
    score: number;
    rationale: string;
  }[];
  uncertainty: UncertaintyAssessment;
  investigation_priority: InvestigationPriorityResult;
  bayesian_result?: BayesianPosteriorResult;
}

/**
 * Computes Shannon entropy over normalized hypothesis probabilities:
 * H = - sum(p_i * log2(p_i)) for p_i > 0
 * Max entropy for K hypotheses is log2(K) bits.
 * Normalized entropy H_norm = H / H_max.
 */
export function calculateShannonEntropy(probabilities: number[]): {
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
    if (p > 0.00001) {
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
 * Section 5: Authoritative Bayesian Source Hypothesis Engine (Day 1A Upgrade)
 *
 * Evaluates posterior probabilities P(H | E1..En) in log-space over the five hypotheses:
 *   1. GAS_FLARE
 *   2. INDUSTRIAL_FIRE
 *   3. AGRICULTURAL_BURN
 *   4. WILDFIRE_VEGETATION
 *   5. OTHER
 *
 * Integrates family-level likelihoods for radiometry, spatial containment, empirical
 * behavioural baseline, temporal persistence, OSM infrastructure, weather, and ML advisory.
 */
export function evaluateCanonicalHypotheses(input: CanonicalHypothesisInput): CanonicalAssessmentResult {
  const bayesianResult = evaluateBayesianSourceHypotheses({
    frp: input.frp,
    brightness_kelvin: input.brightness_kelvin,
    brightness_ti4: input.brightness_ti4,
    brightness_ti5: input.brightness_ti5,
    brightness_delta: input.brightness_delta,
    sensor: input.sensor,
    day_night: input.day_night,
    confidence: input.confidence,
    satellite: input.satellite,
    scan: input.scan,
    track: input.track,
    spatial_association: input.spatial_association,
    distance_to_facility_meters: input.distance_to_facility_meters,
    distance_to_zone_meters: input.distance_to_zone_meters,
    facility_id: input.facility_id,
    facility_name: input.facility_name,
    facility_category: input.facility_category,
    matched_zone_name: input.matched_zone_name,
    is_inside_polygon: input.is_inside_polygon,
    behavioural_status: input.behavioural_status,
    baseline: input.baseline,
    persistence_context: input.persistence_context,
    osm_context: input.osm_context,
    land_cover_type: input.land_cover_type,
  });

  const source_hypotheses: PrototypeSourceHypotheses = {
    status_label: 'Normalized Heuristic Support — Prototype Contextual Assessment',
    disclaimer: 'Authoritative Log-Space Bayesian Posterior Inference (P(H|E)) evaluated across 5 source classes.',
    primary_hypothesis: bayesianResult.primary_hypothesis,
    primary_hypothesis_type: bayesianResult.primary_hypothesis_type,
    alternative_hypotheses: bayesianResult.hypotheses_distribution.slice(1).map((h) => `${h.label} (${h.percentage}%)`),
    hypotheses_distribution: bayesianResult.hypotheses_distribution,
    basis: `Bayesian Posterior (product of ${bayesianResult.prior_distribution.provenance} prior and ${bayesianResult.incorporated_evidence_items.length} conditionally independent evidence families)`,
    feature_contributions_summary: bayesianResult.incorporated_evidence_items.map((e) => ({
      feature_name: e.feature_name,
      impact_summary: e.explanation,
    })),
    evidence_breakdown: bayesianResult.hypotheses_distribution.map((h) => ({
      hypothesis: h.hypothesis,
      supporting_factors: h.reasons,
      opposing_factors: [],
    })),
  };

  // Compute triage priority score
  const safeFrp = Math.max(0.1, input.frp || 0.1);
  const frpScore = Math.min(28, Math.max(2, Math.round(5.5 * Math.log(1 + safeFrp))));
  let priorityScore = 15 + frpScore;
  const priorityReasons: string[] = [`Radiative power: FRP is ${safeFrp.toFixed(1)} MW (+${frpScore} pts).`];

  const baseline = input.baseline;
  if (baseline && (baseline.baseline_status === 'EMPIRICAL' || baseline.baseline_status === 'CONTROLLED') && baseline.metrics.frp_median > 0) {
    const ratio = safeFrp / baseline.metrics.frp_median;
    const p95 = baseline.metrics.frp_p95;
    const p75 = baseline.metrics.frp_p75;
    if (safeFrp > p95) {
      const devBonus = Math.min(36, Math.round(20 + Math.min(16, (ratio - 1) * 3)));
      priorityScore += devBonus;
      priorityReasons.push(`Anomalous surge: FRP exceeds 95th percentile (+${devBonus} pts).`);
    } else if (safeFrp > p75) {
      const devBonus = Math.min(24, Math.round(12 + (ratio - 1) * 2));
      priorityScore += devBonus;
      priorityReasons.push(`Elevated output: FRP exceeds 75th percentile (+${devBonus} pts).`);
    } else {
      priorityScore += 4;
      priorityReasons.push(`Conforms to facility historical operational baseline (median: ${baseline.metrics.frp_median.toFixed(1)} MW).`);
    }
  } else if (input.behavioural_status === 'ANOMALOUS') {
    priorityScore += 26;
    priorityReasons.push('Assessed as ANOMALOUS deviation (+26 pts).');
  }

  if (input.spatial_association === 'FACILITY_OFF_ZONE') {
    const dist = input.distance_to_zone_meters || 600;
    const offZoneBonus = Math.min(18, Math.round(10 + Math.min(8, dist / 200)));
    priorityScore += offZoneBonus;
    priorityReasons.push(`Spatial novelty: Anomaly located inside facility perimeter off-stack (+${offZoneBonus} pts).`);
  } else if (input.spatial_association === 'FACILITY_BUFFER') {
    priorityScore += 8;
    priorityReasons.push('Perimeter event: Located in facility buffer envelope (+8 pts).');
  } else if (input.spatial_association === 'KNOWN_THERMAL_ZONE') {
    priorityScore += 4;
    priorityReasons.push('Coincident with mapped active operational flare stack zone.');
  }

  const entropyBonus = Math.round(bayesianResult.uncertainty.normalized_entropy * 12);
  priorityScore += entropyBonus;

  if (input.confidence === 'high') {
    priorityScore += 4;
    priorityReasons.push('Detection confidence is HIGH (+4 pts).');
  } else if (input.confidence === 'low') {
    priorityScore = Math.max(10, priorityScore - 8);
    priorityReasons.push('Detection confidence is LOW (-8 pts).');
  }

  priorityScore = Math.min(100, Math.max(10, Math.round(priorityScore)));
  const priorityLevel = priorityScore >= 70 ? 'HIGH' : priorityScore >= 45 ? 'MEDIUM' : 'LOW';

  const investigation_priority: InvestigationPriorityResult = {
    level: priorityLevel,
    score: priorityScore,
    label: 'Dynamic Triage Priority',
    disclaimer: 'Operational triage score; not probability of fire or incident severity.',
    reasons: priorityReasons,
  };

  const hypothesisRationales = bayesianResult.hypotheses_distribution.map((d) => ({
    hypothesis: d.hypothesis,
    score: d.percentage / 100,
    rationale: d.reasons.join(' '),
  }));

  return {
    source_hypotheses,
    hypothesis_rationales: hypothesisRationales,
    uncertainty: bayesianResult.uncertainty,
    investigation_priority,
    bayesian_result: bayesianResult,
  };
}

/**
 * Helper to record explicit inspectable feature contributions in legacy heuristic engine
 */
function recordContribution(
  feature: string,
  targetHypothesis: SourceHypothesisType,
  delta: number,
  reason: string,
  rawScores: Record<SourceHypothesisType, number>,
  featureContributions: Record<SourceHypothesisType, HypothesisFeatureContribution[]>,
  supportingEvidence: Record<SourceHypothesisType, string[]>,
  opposingEvidence: Record<SourceHypothesisType, string[]>
) {
  rawScores[targetHypothesis] += delta;
  const direction: 'SUPPORTS' | 'OPPOSES' | 'NEUTRAL' =
    delta > 0 ? 'SUPPORTS' : delta < 0 ? 'OPPOSES' : 'NEUTRAL';

  featureContributions[targetHypothesis].push({
    feature,
    delta,
    direction,
    reason,
  });

  if (delta > 0) {
    supportingEvidence[targetHypothesis].push(reason);
  } else if (delta < 0) {
    opposingEvidence[targetHypothesis].push(reason);
  }
}

/**
 * Legacy Heuristic Contextual Source Hypothesis Engine (Preserved for baseline comparison).
 */
export function evaluateCanonicalHypothesesLegacy(input: CanonicalHypothesisInput): CanonicalAssessmentResult {
  const frp = Math.max(0, input.frp || 0);
  const dayNight: 'D' | 'N' = input.day_night === 'N' ? 'N' : 'D';
  const confidence = input.confidence || 'nominal';
  const spatialAssoc = input.spatial_association || 'UNASSOCIATED';
  const behavStatus = input.behavioural_status || (spatialAssoc === 'UNASSOCIATED' ? 'NOT_ASSESSED' : 'NORMAL');
  const baseline = input.baseline;
  const isEmpiricalBaseline = Boolean(baseline && baseline.baseline_status === 'EMPIRICAL');

  const types: SourceHypothesisType[] = [
    'GAS_FLARE',
    'INDUSTRIAL_FIRE',
    'AGRICULTURAL_BURN',
    'WILDFIRE_VEGETATION',
    'OTHER',
  ];

  // Starting neutral prior = 10 pts for each candidate
  const rawScores: Record<SourceHypothesisType, number> = {
    GAS_FLARE: 10,
    INDUSTRIAL_FIRE: 10,
    AGRICULTURAL_BURN: 10,
    WILDFIRE_VEGETATION: 10,
    OTHER: 10,
  };

  const featureContributions: Record<SourceHypothesisType, HypothesisFeatureContribution[]> = {
    GAS_FLARE: [],
    INDUSTRIAL_FIRE: [],
    AGRICULTURAL_BURN: [],
    WILDFIRE_VEGETATION: [],
    OTHER: [],
  };

  const supportingEvidence: Record<SourceHypothesisType, string[]> = {
    GAS_FLARE: [],
    INDUSTRIAL_FIRE: [],
    AGRICULTURAL_BURN: [],
    WILDFIRE_VEGETATION: [],
    OTHER: [],
  };

  const opposingEvidence: Record<SourceHypothesisType, string[]> = {
    GAS_FLARE: [],
    INDUSTRIAL_FIRE: [],
    AGRICULTURAL_BURN: [],
    WILDFIRE_VEGETATION: [],
    OTHER: [],
  };

  // -------------------------------------------------------------------------
  // 1. SPATIAL RELATIONSHIP & FACILITY GEOMETRY
  // -------------------------------------------------------------------------
  if (spatialAssoc === 'KNOWN_THERMAL_ZONE') {
    recordContribution(
      'spatial_facility_relationship',
      'GAS_FLARE',
      55,
      `Collocated with authorized facility combustion zone (${input.matched_zone_name || 'Configured Flare Stack Cluster'}).`,
      rawScores,
      featureContributions,
      supportingEvidence,
      opposingEvidence
    );

    recordContribution(
      'spatial_facility_relationship',
      'AGRICULTURAL_BURN',
      -30,
      'Open field burning physically implausible inside industrial process unit limits.',
      rawScores,
      featureContributions,
      supportingEvidence,
      opposingEvidence
    );

    recordContribution(
      'spatial_facility_relationship',
      'WILDFIRE_VEGETATION',
      -30,
      'Vegetation fuel load negligible inside paved industrial battery.',
      rawScores,
      featureContributions,
      supportingEvidence,
      opposingEvidence
    );

    recordContribution(
      'spatial_facility_relationship',
      'OTHER',
      10,
      'Authorized industrial process combustion context.',
      rawScores,
      featureContributions,
      supportingEvidence,
      opposingEvidence
    );

    if (input.distance_to_zone_meters !== null && input.distance_to_zone_meters !== undefined && input.distance_to_zone_meters <= 100) {
      recordContribution(
        'flare_infrastructure_proximity',
        'GAS_FLARE',
        10,
        `Tight spatial collocation (${Math.round(input.distance_to_zone_meters)}m from stack centroid).`,
        rawScores,
        featureContributions,
        supportingEvidence,
        opposingEvidence
      );
    }
  } else if (spatialAssoc === 'FACILITY_OFF_ZONE') {
    recordContribution(
      'spatial_facility_relationship',
      'INDUSTRIAL_FIRE',
      45,
      `Located inside facility boundary but ${input.distance_to_zone_meters ? `${Math.round(input.distance_to_zone_meters)}m` : 'offset'} from configured flare stacks. High potential for uncontained process leak, tank farm event, or structural fire.`,
      rawScores,
      featureContributions,
      supportingEvidence,
      opposingEvidence
    );

    recordContribution(
      'spatial_facility_relationship',
      'OTHER',
      20,
      'Auxiliary industrial process: maintenance hot-work, steam venting, or furnace exhaust.',
      rawScores,
      featureContributions,
      supportingEvidence,
      opposingEvidence
    );

    recordContribution(
      'spatial_facility_relationship',
      'GAS_FLARE',
      12,
      'Alternative industrial candidate: unmapped mobile ground flare, emergency pit, or auxiliary combustor.',
      rawScores,
      featureContributions,
      supportingEvidence,
      opposingEvidence
    );

    recordContribution(
      'spatial_facility_relationship',
      'AGRICULTURAL_BURN',
      -25,
      'Inside secure industrial perimeter; agricultural burning ruled out.',
      rawScores,
      featureContributions,
      supportingEvidence,
      opposingEvidence
    );

    recordContribution(
      'spatial_facility_relationship',
      'WILDFIRE_VEGETATION',
      -25,
      'Inside paved industrial boundary; wildland fuel load absent.',
      rawScores,
      featureContributions,
      supportingEvidence,
      opposingEvidence
    );
  } else if (spatialAssoc === 'FACILITY_BUFFER') {
    recordContribution(
      'spatial_facility_relationship',
      'AGRICULTURAL_BURN',
      22,
      'Located in facility perimeter buffer envelope adjacent to surrounding rural land.',
      rawScores,
      featureContributions,
      supportingEvidence,
      opposingEvidence
    );

    recordContribution(
      'spatial_facility_relationship',
      'WILDFIRE_VEGETATION',
      20,
      'Vegetation or brush thermal signature in surrounding buffer terrain.',
      rawScores,
      featureContributions,
      supportingEvidence,
      opposingEvidence
    );

    recordContribution(
      'spatial_facility_relationship',
      'INDUSTRIAL_FIRE',
      16,
      'Perimeter industrial hazard, off-site pipeline corridor, or boundary fence incident.',
      rawScores,
      featureContributions,
      supportingEvidence,
      opposingEvidence
    );

    recordContribution(
      'spatial_facility_relationship',
      'OTHER',
      12,
      'Perimeter auxiliary infrastructure or utility emission.',
      rawScores,
      featureContributions,
      supportingEvidence,
      opposingEvidence
    );

    recordContribution(
      'spatial_facility_relationship',
      'GAS_FLARE',
      8,
      'Adjacent industrial vicinity.',
      rawScores,
      featureContributions,
      supportingEvidence,
      opposingEvidence
    );
  } else {
    // UNASSOCIATED: Regional observation outside monitored facilities
    recordContribution(
      'spatial_facility_relationship',
      'AGRICULTURAL_BURN',
      25,
      'Regional rural landscape outside monitored industrial facilities.',
      rawScores,
      featureContributions,
      supportingEvidence,
      opposingEvidence
    );

    recordContribution(
      'spatial_facility_relationship',
      'WILDFIRE_VEGETATION',
      25,
      'Regional wildland/vegetation landscape outside industrial envelopes.',
      rawScores,
      featureContributions,
      supportingEvidence,
      opposingEvidence
    );

    recordContribution(
      'spatial_facility_relationship',
      'OTHER',
      15,
      'Unmonitored regional thermal source.',
      rawScores,
      featureContributions,
      supportingEvidence,
      opposingEvidence
    );

    recordContribution(
      'spatial_facility_relationship',
      'INDUSTRIAL_FIRE',
      8,
      'Distant from monitored industrial facilities (facility-specific terms unavailable).',
      rawScores,
      featureContributions,
      supportingEvidence,
      opposingEvidence
    );

    recordContribution(
      'spatial_facility_relationship',
      'GAS_FLARE',
      5,
      'Distant from monitored gas flaring facilities.',
      rawScores,
      featureContributions,
      supportingEvidence,
      opposingEvidence
    );
  }

  // -------------------------------------------------------------------------
  // 2. HISTORICAL BEHAVIOURAL BASELINE & DEVIATION
  // -------------------------------------------------------------------------
  if (isEmpiricalBaseline && baseline) {
    const med = baseline.metrics.frp_median;
    const p75 = baseline.metrics.frp_p75;
    const p95 = baseline.metrics.frp_p95;

    if (behavStatus === 'NORMAL') {
      recordContribution(
        'historical_behaviour_deviation',
        'GAS_FLARE',
        18,
        `FRP (${frp} MW) is within routine facility operational baseline (median: ${med} MW, P75: ${p75} MW).`,
        rawScores,
        featureContributions,
        supportingEvidence,
        opposingEvidence
      );

      recordContribution(
        'historical_behaviour_deviation',
        'INDUSTRIAL_FIRE',
        -15,
        'Thermal output conforms to routine operational baseline, substantially lowering fire likelihood.',
        rawScores,
        featureContributions,
        supportingEvidence,
        opposingEvidence
      );
    } else if (behavStatus === 'ELEVATED') {
      recordContribution(
        'historical_behaviour_deviation',
        'INDUSTRIAL_FIRE',
        18,
        `FRP (${frp} MW) is elevated above baseline 75th percentile (${p75} MW). Warrants operational monitoring.`,
        rawScores,
        featureContributions,
        supportingEvidence,
        opposingEvidence
      );

      recordContribution(
        'historical_behaviour_deviation',
        'GAS_FLARE',
        8,
        'Elevated flare output during flaring surge / process upset.',
        rawScores,
        featureContributions,
        supportingEvidence,
        opposingEvidence
      );
    } else if (behavStatus === 'ANOMALOUS') {
      recordContribution(
        'historical_behaviour_deviation',
        'INDUSTRIAL_FIRE',
        40,
        `FRP (${frp} MW) substantially exceeds empirical 95th percentile (${p95} MW) by ${(frp - p95).toFixed(1)} MW (${(frp / med).toFixed(1)}× median). Significant anomaly indicative of major flare blowout or uncontained fire.`,
        rawScores,
        featureContributions,
        supportingEvidence,
        opposingEvidence
      );

      recordContribution(
        'historical_behaviour_deviation',
        'GAS_FLARE',
        -12,
        `Combustion intensity substantially exceeds routine facility baseline range (P95: ${p95} MW).`,
        rawScores,
        featureContributions,
        supportingEvidence,
        opposingEvidence
      );
    }
  } else {
    // For unassociated or insufficient data facilities, explicitly note unavailable
    if (spatialAssoc === 'UNASSOCIATED') {
      // No baseline delta applied - cleanly preserved
    } else {
      // Facility with insufficient data
      recordContribution(
        'historical_behaviour_deviation',
        'OTHER',
        0,
        'Facility operational baseline is insufficient (< 30 observations); behavioural deviation term suspended.',
        rawScores,
        featureContributions,
        supportingEvidence,
        opposingEvidence
      );
    }
  }

  // -------------------------------------------------------------------------
  // 3. TEMPORAL PERSISTENCE & MULTI-PASS REPETITION
  // -------------------------------------------------------------------------
  const persistence = input.persistence_context;
  if (persistence) {
    if (persistence.status === 'PERSISTENT') {
      if (persistence.is_night_dominant) {
        recordContribution(
          'temporal_persistence_repetition',
          'GAS_FLARE',
          45,
          `Stationary persistent thermal emitter with ${persistence.cluster_observation_count} multi-pass detections (${Math.round(persistence.night_fraction * 100)}% night-dominant). Definitive characteristic of continuous industrial flaring.`,
          rawScores,
          featureContributions,
          supportingEvidence,
          opposingEvidence
        );

        recordContribution(
          'temporal_persistence_repetition',
          'OTHER',
          20,
          'Stationary persistent thermal signature matches continuous smelter/furnace process heat.',
          rawScores,
          featureContributions,
          supportingEvidence,
          opposingEvidence
        );

        recordContribution(
          'temporal_persistence_repetition',
          'AGRICULTURAL_BURN',
          -30,
          'Agricultural stubble burns are short-lived 1-2 day events, incompatible with year-round stationary persistence.',
          rawScores,
          featureContributions,
          supportingEvidence,
          opposingEvidence
        );

        recordContribution(
          'temporal_persistence_repetition',
          'WILDFIRE_VEGETATION',
          -25,
          'Wildfires are transient propagating events, incompatible with multi-month stationary point emission.',
          rawScores,
          featureContributions,
          supportingEvidence,
          opposingEvidence
        );
      } else {
        recordContribution(
          'temporal_persistence_repetition',
          'GAS_FLARE',
          22,
          `Persistent thermal activity recorded across ${persistence.distinct_observation_days} distinct observation days.`,
          rawScores,
          featureContributions,
          supportingEvidence,
          opposingEvidence
        );

        recordContribution(
          'temporal_persistence_repetition',
          'OTHER',
          18,
          'Persistent multi-day industrial thermal activity.',
          rawScores,
          featureContributions,
          supportingEvidence,
          opposingEvidence
        );
      }
    } else if (persistence.status === 'RECURRENT') {
      recordContribution(
        'temporal_persistence_repetition',
        'GAS_FLARE',
        18,
        `Recurrent thermal activity (${persistence.cluster_observation_count} detections across ${persistence.distinct_observation_days} days).`,
        rawScores,
        featureContributions,
        supportingEvidence,
        opposingEvidence
      );

      recordContribution(
        'temporal_persistence_repetition',
        'OTHER',
        12,
        'Recurrent process heat emission.',
        rawScores,
        featureContributions,
        supportingEvidence,
        opposingEvidence
      );
    } else if (persistence.status === 'SINGLE_OBSERVATION') {
      if (spatialAssoc === 'FACILITY_OFF_ZONE' || (spatialAssoc === 'KNOWN_THERMAL_ZONE' && behavStatus === 'ANOMALOUS')) {
        recordContribution(
          'temporal_persistence_repetition',
          'INDUSTRIAL_FIRE',
          18,
          'Single isolated thermal surge in industrial area without continuous baseline history.',
          rawScores,
          featureContributions,
          supportingEvidence,
          opposingEvidence
        );
      } else if (spatialAssoc === 'UNASSOCIATED' || spatialAssoc === 'FACILITY_BUFFER') {
        recordContribution(
          'temporal_persistence_repetition',
          'AGRICULTURAL_BURN',
          20,
          'Single transient non-persistent detection characteristic of agricultural residue burning.',
          rawScores,
          featureContributions,
          supportingEvidence,
          opposingEvidence
        );

        recordContribution(
          'temporal_persistence_repetition',
          'WILDFIRE_VEGETATION',
          18,
          'Transient non-persistent detection consistent with open vegetation fire.',
          rawScores,
          featureContributions,
          supportingEvidence,
          opposingEvidence
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // 4. OPENSTREETMAP (OSM) INFRASTRUCTURE CONTEXT
  // -------------------------------------------------------------------------
  const osm = input.osm_context;
  if (
    osm &&
    (osm.status === 'AVAILABLE' ||
      osm.status === 'AUTHENTIC_LIVE' ||
      osm.status === 'VERIFIED_LOCAL_CACHE') &&
    osm.features &&
    osm.features.length > 0
  ) {
    const features = osm.features || [];

    // A. Mapped Flare
    const flareFeature = features.find((f) => f.category === 'flare' || f.tags?.man_made === 'flare');
    if (flareFeature) {
      const dist = flareFeature.distance_meters;
      const boost = dist <= 500 ? 50 : dist <= 1200 ? 32 : 18;
      recordContribution(
        'osm_infrastructure_proximity',
        'GAS_FLARE',
        boost,
        `OSM infrastructure: Mapped gas flare (${flareFeature.name || 'Flare Stack'}) located ${dist}m away.`,
        rawScores,
        featureContributions,
        supportingEvidence,
        opposingEvidence
      );
    }

    // B. Industrial Works / Power Plant / Storage Tanks / Chimney
    const industrialFeature = features.find(
      (f) =>
        f.category === 'chimney' ||
        f.category === 'works' ||
        f.category === 'storage_tank' ||
        f.category === 'power_infrastructure' ||
        f.category === 'industrial_landuse' ||
        f.tags?.landuse === 'industrial' ||
        f.tags?.power === 'plant'
    );
    if (industrialFeature) {
      const dist = industrialFeature.distance_meters;
      if (dist <= 600) {
        recordContribution(
          'osm_infrastructure_proximity',
          'INDUSTRIAL_FIRE',
          25,
          `OSM industrial infrastructure: ${industrialFeature.category.replace('_', ' ')} (${industrialFeature.name || 'Industrial feature'}) within ${dist}m.`,
          rawScores,
          featureContributions,
          supportingEvidence,
          opposingEvidence
        );

        recordContribution(
          'osm_infrastructure_proximity',
          'OTHER',
          22,
          `Industrial process heat or furnace emission consistent with nearby ${industrialFeature.category.replace('_', ' ')}.`,
          rawScores,
          featureContributions,
          supportingEvidence,
          opposingEvidence
        );

        recordContribution(
          'osm_infrastructure_proximity',
          'GAS_FLARE',
          18,
          `Industrial facility vicinity mapped in OSM (${dist}m).`,
          rawScores,
          featureContributions,
          supportingEvidence,
          opposingEvidence
        );
      } else if (dist <= 2000) {
        recordContribution(
          'osm_infrastructure_proximity',
          'INDUSTRIAL_FIRE',
          12,
          `OSM industrial landuse within ${dist}m.`,
          rawScores,
          featureContributions,
          supportingEvidence,
          opposingEvidence
        );

        recordContribution(
          'osm_infrastructure_proximity',
          'OTHER',
          10,
          `Regional industrial works within ${dist}m.`,
          rawScores,
          featureContributions,
          supportingEvidence,
          opposingEvidence
        );
      }
    }

    // C. Agricultural / Farmland OSM Tags
    const agriFeature = features.find(
      (f) =>
        f.tags?.landuse === 'farmland' ||
        f.tags?.landuse === 'farm' ||
        f.tags?.landuse === 'orchard' ||
        f.tags?.landuse === 'allotments'
    );
    if (agriFeature) {
      recordContribution(
        'osm_infrastructure_proximity',
        'AGRICULTURAL_BURN',
        35,
        `OSM landuse: Farmland/agricultural land mapped ${agriFeature.distance_meters}m from hotspot.`,
        rawScores,
        featureContributions,
        supportingEvidence,
        opposingEvidence
      );

      recordContribution(
        'osm_infrastructure_proximity',
        'GAS_FLARE',
        -15,
        'Mapped agricultural terrain opposes continuous flare hypothesis.',
        rawScores,
        featureContributions,
        supportingEvidence,
        opposingEvidence
      );
    }

    // D. Forest / Wood / Scrub OSM Tags
    const forestFeature = features.find(
      (f) =>
        f.tags?.landuse === 'forest' ||
        f.tags?.natural === 'wood' ||
        f.tags?.natural === 'scrub' ||
        f.tags?.natural === 'grassland'
    );
    if (forestFeature) {
      recordContribution(
        'osm_infrastructure_proximity',
        'WILDFIRE_VEGETATION',
        35,
        `OSM natural context: Mapped woodland/vegetation canopy within ${forestFeature.distance_meters}m.`,
        rawScores,
        featureContributions,
        supportingEvidence,
        opposingEvidence
      );

      recordContribution(
        'osm_infrastructure_proximity',
        'GAS_FLARE',
        -15,
        'Mapped natural woodland terrain opposes continuous industrial flare hypothesis.',
        rawScores,
        featureContributions,
        supportingEvidence,
        opposingEvidence
      );
    }
  }

  // -------------------------------------------------------------------------
  // 5. RADIOMETRY, FRP & DIURNAL CHARACTERISTICS
  // -------------------------------------------------------------------------
  // Day / Night Diurnal Characteristic
  if (dayNight === 'N') {
    recordContribution(
      'diurnal_timing',
      'GAS_FLARE',
      14,
      'Nighttime satellite pass rules out solar reflection/glint.',
      rawScores,
      featureContributions,
      supportingEvidence,
      opposingEvidence
    );

    recordContribution(
      'diurnal_timing',
      'OTHER',
      10,
      'Nighttime acquisition indicates sustained non-solar thermal emission.',
      rawScores,
      featureContributions,
      supportingEvidence,
      opposingEvidence
    );

    recordContribution(
      'diurnal_timing',
      'AGRICULTURAL_BURN',
      -15,
      'Nighttime acquisition; agricultural stubble burning is predominantly a daytime operational activity.',
      rawScores,
      featureContributions,
      supportingEvidence,
      opposingEvidence
    );

    if (spatialAssoc === 'UNASSOCIATED' && (!persistence || persistence.status !== 'PERSISTENT')) {
      recordContribution(
        'diurnal_timing',
        'WILDFIRE_VEGETATION',
        14,
        'Active nighttime combustion outside agricultural daytime burning windows indicates wildland brush fire.',
        rawScores,
        featureContributions,
        supportingEvidence,
        opposingEvidence
      );
    }
  } else {
    // Daytime
    if (spatialAssoc === 'UNASSOCIATED' || spatialAssoc === 'FACILITY_BUFFER') {
      recordContribution(
        'diurnal_timing',
        'AGRICULTURAL_BURN',
        22,
        'Daytime acquisition aligns with regional diurnal peak for agricultural crop residue burning.',
        rawScores,
        featureContributions,
        supportingEvidence,
        opposingEvidence
      );
    }
  }

  // FRP Radiative Power Intensity
  if (frp >= 80) {
    if (spatialAssoc !== 'UNASSOCIATED') {
      recordContribution(
        'radiometry_frp_intensity',
        'INDUSTRIAL_FIRE',
        35,
        `Very high FRP (${frp} MW) indicates massive energetic heat release substantially above routine process limits.`,
        rawScores,
        featureContributions,
        supportingEvidence,
        opposingEvidence
      );
    } else {
      recordContribution(
        'radiometry_frp_intensity',
        'WILDFIRE_VEGETATION',
        35,
        `Very high FRP (${frp} MW) indicates intense large-scale wildland or high fuel-load vegetation combustion.`,
        rawScores,
        featureContributions,
        supportingEvidence,
        opposingEvidence
      );
    }
  } else if (frp >= 30) {
    if (spatialAssoc !== 'UNASSOCIATED') {
      recordContribution(
        'radiometry_frp_intensity',
        'INDUSTRIAL_FIRE',
        18,
        `Elevated FRP (${frp} MW) exceeds normal pilot flare threshold.`,
        rawScores,
        featureContributions,
        supportingEvidence,
        opposingEvidence
      );
    } else {
      recordContribution(
        'radiometry_frp_intensity',
        'WILDFIRE_VEGETATION',
        20,
        `Substantial thermal power (${frp} MW) matches open landscape wildland fire.`,
        rawScores,
        featureContributions,
        supportingEvidence,
        opposingEvidence
      );

      recordContribution(
        'radiometry_frp_intensity',
        'AGRICULTURAL_BURN',
        15,
        `Significant open-field burning output (${frp} MW).`,
        rawScores,
        featureContributions,
        supportingEvidence,
        opposingEvidence
      );
    }
  } else if (frp <= 8.0) {
    if (spatialAssoc === 'KNOWN_THERMAL_ZONE' || spatialAssoc === 'FACILITY_OFF_ZONE') {
      recordContribution(
        'radiometry_frp_intensity',
        'GAS_FLARE',
        12,
        `Low-to-moderate FRP (${frp} MW) matches routine operational purge/pilot flaring.`,
        rawScores,
        featureContributions,
        supportingEvidence,
        opposingEvidence
      );

      recordContribution(
        'radiometry_frp_intensity',
        'OTHER',
        10,
        'Moderate process heat emission.',
        rawScores,
        featureContributions,
        supportingEvidence,
        opposingEvidence
      );
    } else {
      recordContribution(
        'radiometry_frp_intensity',
        'AGRICULTURAL_BURN',
        14,
        `Low-intensity surface burn (${frp} MW) typical of crop residue burning.`,
        rawScores,
        featureContributions,
        supportingEvidence,
        opposingEvidence
      );
    }
  }

  // Thermal Contrast (VIIRS Brightness Delta)
  const delta =
    input.brightness_delta ??
    (input.brightness_ti4 && input.brightness_ti5 ? input.brightness_ti4 - input.brightness_ti5 : null);

  if (delta !== null && delta >= 35) {
    recordContribution(
      'thermal_contrast',
      'GAS_FLARE',
      18,
      `Strong sub-pixel infrared contrast (ΔTI4-TI5 = ${delta.toFixed(1)} K) indicates high-temperature point-source combustion.`,
      rawScores,
      featureContributions,
      supportingEvidence,
      opposingEvidence
    );

    recordContribution(
      'thermal_contrast',
      'OTHER',
      12,
      'High thermal gradient characteristic of concentrated industrial flame/furnace.',
      rawScores,
      featureContributions,
      supportingEvidence,
      opposingEvidence
    );
  }

  // -------------------------------------------------------------------------
  // 6. FACILITY CATEGORY, LAND-COVER & WEATHER CONTEXT
  // -------------------------------------------------------------------------
  const category = (input.facility_category || '').toLowerCase();
  if (category.includes('refinery') || category.includes('petrochemical')) {
    recordContribution(
      'facility_operational_category',
      'GAS_FLARE',
      10,
      `Facility category (${category}): Operational hydrocarbon processing baseline involves routine flare relief systems.`,
      rawScores,
      featureContributions,
      supportingEvidence,
      opposingEvidence
    );
  } else if (category.includes('steel') || category.includes('smelter') || category.includes('cement')) {
    recordContribution(
      'facility_operational_category',
      'OTHER',
      18,
      `Facility category (${category}): High continuous process heat from blast furnaces, kilns, or smelting units.`,
      rawScores,
      featureContributions,
      supportingEvidence,
      opposingEvidence
    );
  } else if (category.includes('power')) {
    recordContribution(
      'facility_operational_category',
      'OTHER',
      12,
      `Thermal power generation facility (${category}).`,
      rawScores,
      featureContributions,
      supportingEvidence,
      opposingEvidence
    );
  }

  const landCover = (input.land_cover_type || '').toLowerCase();
  if (landCover.includes('agri') || landCover.includes('cropland') || landCover.includes('farm')) {
    recordContribution(
      'land_cover_context',
      'AGRICULTURAL_BURN',
      28,
      `Land-cover classification: Verified agricultural field terrain (${landCover}).`,
      rawScores,
      featureContributions,
      supportingEvidence,
      opposingEvidence
    );
  } else if (
    landCover.includes('forest') ||
    landCover.includes('tree') ||
    landCover.includes('shrub') ||
    landCover.includes('scrub')
  ) {
    recordContribution(
      'land_cover_context',
      'WILDFIRE_VEGETATION',
      30,
      `Land-cover classification: Dense vegetation or forest canopy (${landCover}).`,
      rawScores,
      featureContributions,
      supportingEvidence,
      opposingEvidence
    );
  }

  if (input.wind_speed_kmh && input.wind_speed_kmh >= 25) {
    recordContribution(
      'weather_environmental',
      'INDUSTRIAL_FIRE',
      5,
      `Elevated ambient surface wind (${input.wind_speed_kmh} km/h) increases thermal dispersion hazard.`,
      rawScores,
      featureContributions,
      supportingEvidence,
      opposingEvidence
    );

    recordContribution(
      'weather_environmental',
      'WILDFIRE_VEGETATION',
      8,
      `High ambient surface wind (${input.wind_speed_kmh} km/h) supports accelerated fire front propagation.`,
      rawScores,
      featureContributions,
      supportingEvidence,
      opposingEvidence
    );
  }

  // -------------------------------------------------------------------------
  // 7. NORMALIZATION & HEURISTIC SUPPORT CALCULATION (Sums to 100%)
  // -------------------------------------------------------------------------
  // Ensure non-negative scores (minimum clamp = 1.0)
  for (const t of types) {
    rawScores[t] = Math.max(1.0, rawScores[t]);
  }

  const totalScore = types.reduce((sum, t) => sum + rawScores[t], 0);

  const labels: Record<SourceHypothesisType, string> = {
    INDUSTRIAL_FIRE: 'Industrial Fire / Abnormal Heat',
    GAS_FLARE: 'Gas Flare / Continuous Industrial Combustion',
    AGRICULTURAL_BURN: 'Agricultural / Crop Residue Burn',
    WILDFIRE_VEGETATION: 'Wildfire / Vegetation Thermal Event',
    OTHER: 'Other Thermal Source / Process Heat',
  };

  const distribution: ContextualHypothesisItem[] = types.map((type) => {
    const raw = rawScores[type];
    const norm = totalScore > 0 ? raw / totalScore : 0.20;
    const pct = Math.round(norm * 100);

    let supportLevel: ContextualHypothesisItem['support_level'] = 'VERY_LOW';
    if (pct >= 50) supportLevel = 'VERY_HIGH';
    else if (pct >= 32) supportLevel = 'HIGH';
    else if (pct >= 18) supportLevel = 'MODERATE';
    else if (pct >= 8) supportLevel = 'LOW';

    const reasons =
      supportingEvidence[type].length > 0
        ? supportingEvidence[type]
        : [`Evaluated under contextual heuristic baseline (${pct}% support).`];

    return {
      hypothesis: type,
      label: labels[type],
      raw_support_score: Math.round(raw * 10) / 10,
      normalized_score: Math.round(norm * 1000) / 1000,
      percentage: pct,
      support_level: supportLevel,
      reasons,
      feature_contributions: featureContributions[type],
      supporting_evidence: supportingEvidence[type],
      opposing_evidence: opposingEvidence[type],
    };
  });

  // Ensure exact 100% sum
  const sumPct = distribution.reduce((sum, d) => sum + d.percentage, 0);
  if (sumPct !== 100 && distribution.length > 0) {
    const diff = 100 - sumPct;
    const top = distribution.reduce((max, item) => (item.percentage > max.percentage ? item : max), distribution[0]);
    top.percentage += diff;
  }

  // Sort descending
  distribution.sort((a, b) => b.normalized_score - a.normalized_score);

  const topHypothesis = distribution[0];
  const primaryType = topHypothesis.hypothesis;

  const altHypotheses = distribution
    .slice(1)
    .filter((h) => h.percentage >= 8)
    .map((h) => `${h.label} (${h.percentage}% support)`);

  let primaryText = '';
  if (spatialAssoc === 'KNOWN_THERMAL_ZONE') {
    primaryText =
      primaryType === 'GAS_FLARE'
        ? `Authorized combustion flaring is the primary contextual hypothesis (${topHypothesis.percentage}% support).`
        : `Abnormal thermal emission inside authorized zone (${topHypothesis.percentage}% support for ${labels[primaryType]}).`;
  } else if (spatialAssoc === 'FACILITY_OFF_ZONE') {
    primaryText = `Off-stack industrial thermal anomaly inside facility footprint (${topHypothesis.percentage}% support for ${labels[primaryType]}).`;
  } else if (spatialAssoc === 'FACILITY_BUFFER') {
    primaryText = `Facility perimeter buffer thermal event (${topHypothesis.percentage}% support for ${labels[primaryType]}).`;
  } else {
    primaryText = `Regional thermal observation outside configured facilities (${topHypothesis.percentage}% support for ${labels[primaryType]}).`;
  }

  // Feature contributions summary
  const featureContributionsSummary = [
    {
      feature_name: 'Spatial Relationship',
      impact_summary: `${spatialAssoc} (${input.distance_to_zone_meters !== null && input.distance_to_zone_meters !== undefined ? `${Math.round(input.distance_to_zone_meters)}m from stack` : 'regional'})`,
    },
    {
      feature_name: 'Thermal Radiometry',
      impact_summary: `FRP ${frp} MW, ${dayNight === 'N' ? 'Night pass' : 'Day pass'}${delta !== null ? `, ΔT=${delta.toFixed(1)}K` : ''}`,
    },
    {
      feature_name: 'Historical Behaviour',
      impact_summary: isEmpiricalBaseline
        ? `${behavStatus} (baseline median: ${baseline?.metrics.frp_median} MW, P95: ${baseline?.metrics.frp_p95} MW)`
        : 'UNAVAILABLE / NOT_ASSESSED (no baseline)',
    },
    {
      feature_name: 'Temporal Persistence',
      impact_summary: persistence ? `${persistence.status} (${persistence.cluster_observation_count} passes)` : 'SINGLE_DETECTION',
    },
  ];

  const evidenceBreakdown = types.map((t) => ({
    hypothesis: t,
    supporting_factors: supportingEvidence[t],
    opposing_factors: opposingEvidence[t],
  }));

  // -------------------------------------------------------------------------
  // 8. SHANNON ENTROPY (Uncertainty Quantification)
  // -------------------------------------------------------------------------
  const probs = distribution.map((d) => d.percentage / 100.0).filter((p) => p > 0);
  const entropy = calculateShannonEntropy(probs);

  let uncertaintyLevel: 'LOW' | 'MODERATE' | 'HIGH' = 'LOW';
  let summary = '';
  let interpretation = '';

  if (distribution[0]?.percentage >= 70 || entropy.normalized_entropy < 0.45) {
    uncertaintyLevel = 'LOW';
    summary = 'One source candidate clearly dominates the normalized heuristic support distribution.';
    interpretation = `Low Shannon entropy (H = ${entropy.entropy_bits} bits, H_norm = ${(entropy.normalized_entropy * 100).toFixed(1)}%) indicates concentrated support under the primary candidate (${labels[primaryType]}: ${topHypothesis.percentage}%).`;
  } else if (distribution[0]?.percentage >= 45 || entropy.normalized_entropy < 0.70) {
    uncertaintyLevel = 'MODERATE';
    summary = 'One leading hypothesis with non-trivial competing secondary explanations.';
    interpretation = `Moderate Shannon entropy (H = ${entropy.entropy_bits} bits, H_norm = ${(entropy.normalized_entropy * 100).toFixed(1)}%) indicates that while ${labels[primaryType]} leads, secondary candidates retain non-trivial plausibility.`;
  } else {
    uncertaintyLevel = 'HIGH';
    summary = 'Multiple source candidates retain comparable plausibility. High Shannon entropy indicates hypothesis dispersion.';
    interpretation = `High Shannon entropy (H = ${entropy.entropy_bits} bits, H_norm = ${(entropy.normalized_entropy * 100).toFixed(1)}%) reflects significant dispersion across competing explanations. High-resolution multispectral imagery or ground verification recommended.`;
  }

  const competingCount = distribution.filter((h) => h.percentage >= 15).length;

  const source_hypotheses: PrototypeSourceHypotheses = {
    status_label: 'Normalized Heuristic Support — Prototype Contextual Assessment',
    disclaimer: 'These values represent normalized contextual heuristic support, not calibrated source probabilities.',
    primary_hypothesis: primaryText,
    primary_hypothesis_type: primaryType,
    alternative_hypotheses: altHypotheses,
    hypotheses_distribution: distribution,
    basis: 'FIRMS radiometry + spatial association + OSM infrastructure + temporal persistence + land context',
    feature_contributions_summary: featureContributionsSummary,
    evidence_breakdown: evidenceBreakdown,
  };

  const uncertainty: UncertaintyAssessment = {
    entropy_bits: entropy.entropy_bits,
    max_possible_entropy_bits: entropy.max_possible_entropy_bits,
    normalized_entropy: entropy.normalized_entropy,
    uncertainty_level: uncertaintyLevel,
    is_ambiguous: uncertaintyLevel === 'HIGH' || competingCount >= 2,
    summary,
    interpretation,
    competing_hypotheses_count: competingCount,
    active_hypotheses_count: distribution.filter((h) => h.percentage > 0).length,
  };

  // -------------------------------------------------------------------------
  // 9. OPERATIONAL INVESTIGATION PRIORITY
  // -------------------------------------------------------------------------
  let priorityScore = 15;
  const priorityReasons: string[] = [];

  const safeFrp = Math.max(0.1, Number(frp) || 0.1);
  const frpScore = Math.min(28, Math.max(2, Math.round(5.5 * Math.log(1 + safeFrp))));
  priorityScore += frpScore;
  if (safeFrp >= 80) {
    priorityReasons.push(`High thermal emission: FRP (${safeFrp.toFixed(1)} MW) indicates substantial energetic heat release (+${frpScore} pts).`);
  } else if (safeFrp >= 25) {
    priorityReasons.push(`Moderate thermal output: FRP (${safeFrp.toFixed(1)} MW) exceeds routine low-intensity threshold (+${frpScore} pts).`);
  } else {
    priorityReasons.push(`Radiative power: FRP is ${safeFrp.toFixed(1)} MW (+${frpScore} pts).`);
  }

  if (baseline && baseline.baseline_status === 'EMPIRICAL' && baseline.metrics.frp_median > 0) {
    const ratio = safeFrp / baseline.metrics.frp_median;
    const p95 = baseline.metrics.frp_p95;
    const p75 = baseline.metrics.frp_p75;

    if (safeFrp > p95) {
      const devBonus = Math.min(36, Math.round(20 + Math.min(16, (ratio - 1) * 3)));
      priorityScore += devBonus;
      priorityReasons.push(`Anomalous surge: FRP (${safeFrp.toFixed(1)} MW) exceeds empirical 95th percentile (${p95.toFixed(1)} MW) by ${(safeFrp - p95).toFixed(1)} MW (${ratio.toFixed(2)}× baseline median, +${devBonus} pts).`);
    } else if (safeFrp > p75) {
      const devBonus = Math.min(24, Math.round(12 + (ratio - 1) * 2));
      priorityScore += devBonus;
      priorityReasons.push(`Elevated output: FRP exceeds 75th percentile (${p75.toFixed(1)} MW) by ${(safeFrp - p75).toFixed(1)} MW (+${devBonus} pts).`);
    } else {
      priorityScore += 4;
      priorityReasons.push(`Conforms to facility historical operational baseline (median: ${baseline.metrics.frp_median.toFixed(1)} MW).`);
    }
  } else {
    if (behavStatus === 'ANOMALOUS') {
      priorityScore += 26;
      priorityReasons.push('Assessed as ANOMALOUS deviation (+26 pts).');
    } else if (behavStatus === 'ELEVATED') {
      priorityScore += 15;
      priorityReasons.push('Assessed as ELEVATED emission (+15 pts).');
    } else if (behavStatus === 'NORMAL') {
      priorityScore += 4;
      priorityReasons.push('Assessed as NORMAL operational output (+4 pts).');
    } else {
      if (safeFrp >= 50) {
        const unassocBonus = Math.min(24, Math.round(8 + (safeFrp - 50) * 0.2));
        priorityScore += unassocBonus;
        priorityReasons.push(`Regional thermal excursion outside monitored facilities: FRP ${safeFrp.toFixed(1)} MW (+${unassocBonus} pts).`);
      } else {
        priorityReasons.push('Regional thermal observation outside monitored operational facility baselines.');
      }
    }
  }

  if (spatialAssoc === 'FACILITY_OFF_ZONE') {
    const dist = input.distance_to_zone_meters || 600;
    const offZoneBonus = Math.min(18, Math.round(10 + Math.min(8, dist / 200)));
    priorityScore += offZoneBonus;
    priorityReasons.push(`Spatial novelty: Anomaly located inside facility perimeter but offset from configured flare stacks (${Math.round(dist)}m offset, +${offZoneBonus} pts).`);
  } else if (spatialAssoc === 'FACILITY_BUFFER') {
    priorityScore += 8;
    priorityReasons.push('Perimeter event: Located in facility buffer envelope adjacent to industrial boundary (+8 pts).');
  } else if (spatialAssoc === 'KNOWN_THERMAL_ZONE') {
    priorityScore += 4;
    priorityReasons.push('Coincident with mapped active operational flare stack zone.');
  }

  const normEntropy = entropy.normalized_entropy ?? 0.55;
  const entropyBonus = Math.round(normEntropy * 12);
  priorityScore += entropyBonus;
  if (normEntropy > 0.6) {
    priorityReasons.push(`High hypothesis ambiguity (H_norm = ${(normEntropy * 100).toFixed(0)}%): Competing source candidates require evidence resolution (+${entropyBonus} pts).`);
  }

  if (confidence === 'high') {
    priorityScore += 4;
    priorityReasons.push('Detection confidence is HIGH (+4 pts).');
  } else if (confidence === 'low') {
    priorityScore = Math.max(10, priorityScore - 8);
    priorityReasons.push('Detection confidence is LOW (-8 pts).');
  }

  priorityScore = Math.min(100, Math.max(10, Math.round(priorityScore)));

  let priorityLevel: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
  if (priorityScore >= 70 || behavStatus === 'ANOMALOUS') {
    priorityLevel = 'HIGH';
  } else if (priorityScore >= 45 || behavStatus === 'ELEVATED') {
    priorityLevel = 'MEDIUM';
  } else {
    priorityLevel = 'LOW';
  }

  const investigation_priority: InvestigationPriorityResult = {
    level: priorityLevel,
    score: priorityScore,
    label: 'Dynamic Triage Priority',
    disclaimer: 'Operational triage score; not probability of fire or incident severity.',
    reasons: priorityReasons,
  };

  const hypothesisRationales = distribution.map((d) => ({
    hypothesis: d.hypothesis,
    score: d.percentage / 100,
    rationale: d.reasons.join(' '),
  }));

  return {
    source_hypotheses,
    hypothesis_rationales: hypothesisRationales,
    uncertainty,
    investigation_priority,
  };
}
