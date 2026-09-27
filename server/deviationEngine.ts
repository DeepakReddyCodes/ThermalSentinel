import { EmpiricalFacilityBaseline } from './historicalIngestion.js';
import { ServerFacility } from './types.js';

export type BehaviouralStatus = 'NORMAL' | 'ELEVATED' | 'ANOMALOUS' | 'NOT_ASSESSED';

export interface BehaviouralAssessmentResult {
  behavioural_status: BehaviouralStatus;
  baseline_status: 'EMPIRICAL' | 'LIMITED' | 'CANDIDATE_EMPIRICAL_WITH_REVIEW' | 'CONTROLLED' | 'INSUFFICIENT_DATA' | 'NOT_ASSESSED' | 'NONE';
  reasons: string[];
  metrics: {
    current_frp: number;
    baseline_frp_median: number | null;
    baseline_frp_p75: number | null;
    baseline_frp_p95: number | null;
    baseline_frp_max: number | null;
    frp_ratio_to_median: number | null;
    frp_delta_from_median: number | null;
  };
  spatial_context: {
    association_type: 'KNOWN_THERMAL_ZONE' | 'FACILITY_OFF_ZONE' | 'FACILITY_BUFFER' | 'UNASSOCIATED';
    matched_zone_name: string | null;
    distance_to_zone_meters: number | null;
    distance_to_facility_meters: number | null;
    is_inside_polygon: boolean;
  };
  evaluation_parameters: {
    rule_type: 'EMPIRICAL_PERCENTILE_MODEL' | 'CANDIDATE_EMPIRICAL_MODEL' | 'CONTROLLED_PROTOTYPE_MODEL' | 'LIMITED_DATA_FALLBACK' | 'INSUFFICIENT_DATA_FALLBACK' | 'UNASSOCIATED_REGIONAL';
    thresholds_used: {
      elevated_percentile: number;
      anomalous_percentile: number;
    };
    label: string;
  };
}

export interface DeviationConfig {
  minObservationsForBaseline?: number;
  elevatedPercentileThreshold?: number; // default 75
  anomalousPercentileThreshold?: number; // default 95
}

export function evaluateObservationAgainstBaseline(
  currentFrp: number,
  associationType: 'KNOWN_THERMAL_ZONE' | 'FACILITY_OFF_ZONE' | 'FACILITY_BUFFER' | 'UNASSOCIATED',
  distanceToZoneMeters: number | null,
  distanceToFacilityMeters: number | null,
  matchedZoneName: string | null,
  isInsidePolygon: boolean,
  facility: ServerFacility | null,
  baseline: EmpiricalFacilityBaseline | null,
  config: DeviationConfig = {}
): BehaviouralAssessmentResult {
  const minRequired = config.minObservationsForBaseline || 30;
  const elevatedPct = config.elevatedPercentileThreshold || 75;
  const anomalousPct = config.anomalousPercentileThreshold || 95;

  const spatialContext = {
    association_type: associationType,
    matched_zone_name: matchedZoneName,
    distance_to_zone_meters: distanceToZoneMeters,
    distance_to_facility_meters: distanceToFacilityMeters,
    is_inside_polygon: isInsidePolygon,
  };

  // Case 1: Unassociated regional observation
  if (associationType === 'UNASSOCIATED' || !facility) {
    return {
      behavioural_status: 'NOT_ASSESSED',
      baseline_status: 'NONE',
      reasons: [
        `Observation location is outside monitored facility boundaries and buffer radius (${distanceToFacilityMeters !== null ? `${Math.round(distanceToFacilityMeters)} m away` : 'remote'}).`,
        'Regional unassociated hotspots are not assessed against industrial facility operational baselines.',
      ],
      metrics: {
        current_frp: currentFrp,
        baseline_frp_median: null,
        baseline_frp_p75: null,
        baseline_frp_p95: null,
        baseline_frp_max: null,
        frp_ratio_to_median: null,
        frp_delta_from_median: null,
      },
      spatial_context: spatialContext,
      evaluation_parameters: {
        rule_type: 'UNASSOCIATED_REGIONAL',
        thresholds_used: { elevated_percentile: elevatedPct, anomalous_percentile: anomalousPct },
        label: 'Regional Hotspot (Unmonitored Area)',
      },
    };
  }

  // Case 2A: LIMITED historical baseline (< 30 observations)
  if (baseline && baseline.baseline_status === 'LIMITED') {
    const obsFound = baseline.metrics.observation_count;
    const daysFound = baseline.metrics.observation_days || 0;
    return {
      behavioural_status: 'NOT_ASSESSED',
      baseline_status: 'LIMITED',
      reasons: [
        `Limited historical observations available for this facility (${obsFound} associated records across ${daysFound} active days).`,
        `Sample size is below the operational threshold (N >= ${minRequired}) required for an authoritative empirical baseline.`,
        'Behavioural deviation assessment is suspended; historical context provided for exploratory review only.',
      ],
      metrics: {
        current_frp: currentFrp,
        baseline_frp_median: null,
        baseline_frp_p75: null,
        baseline_frp_p95: null,
        baseline_frp_max: null,
        frp_ratio_to_median: null,
        frp_delta_from_median: null,
      },
      spatial_context: spatialContext,
      evaluation_parameters: {
        rule_type: 'LIMITED_DATA_FALLBACK',
        thresholds_used: { elevated_percentile: elevatedPct, anomalous_percentile: anomalousPct },
        label: `Limited Historical Baseline (${obsFound}/${minRequired} records, ${daysFound} active days)`,
      },
    };
  }

  // Case 2B: INSUFFICIENT DATA / NOT ASSESSED for baseline
  const hasValidBaseline =
    baseline &&
    (baseline.baseline_status === 'EMPIRICAL' ||
      baseline.baseline_status === 'CANDIDATE_EMPIRICAL_WITH_REVIEW' ||
      baseline.baseline_status === 'CONTROLLED');

  if (!hasValidBaseline) {
    const obsFound = baseline ? baseline.metrics.observation_count : 0;
    return {
      behavioural_status: 'NOT_ASSESSED',
      baseline_status: 'INSUFFICIENT_DATA',
      reasons: [
        'Insufficient observations to establish a facility baseline.',
        `Sample size: ${obsFound} observations available (minimum ${minRequired} required for statistical baseline).`,
        'Behavioural deviation assessment is suspended.',
      ],
      metrics: {
        current_frp: currentFrp,
        baseline_frp_median: null,
        baseline_frp_p75: null,
        baseline_frp_p95: null,
        baseline_frp_max: null,
        frp_ratio_to_median: null,
        frp_delta_from_median: null,
      },
      spatial_context: spatialContext,
      evaluation_parameters: {
        rule_type: 'INSUFFICIENT_DATA_FALLBACK',
        thresholds_used: { elevated_percentile: elevatedPct, anomalous_percentile: anomalousPct },
        label: `Insufficient Data (${obsFound}/${minRequired})`,
      },
    };
  }

  // Case 3: Genuine EMPIRICAL, CANDIDATE_EMPIRICAL_WITH_REVIEW, or CONTROLLED Baseline Comparison
  const isEmpirical = baseline.baseline_status === 'EMPIRICAL';
  const isCandidate = baseline.baseline_status === 'CANDIDATE_EMPIRICAL_WITH_REVIEW';
  const baselineStatus = baseline.baseline_status;
  const provenanceLabel = isEmpirical
    ? 'Real Historical Baseline'
    : isCandidate
    ? 'Candidate Historical Baseline (Review Required)'
    : 'Controlled Prototype Baseline';

  const bMed = baseline.metrics.frp_median;
  const bP75 = baseline.metrics.frp_p75;
  const bP95 = baseline.metrics.frp_p95;
  const bMax = baseline.metrics.frp_max;

  const ratio = bMed > 0 ? Math.round((currentFrp / bMed) * 100) / 100 : 1;
  const delta = Math.round((currentFrp - bMed) * 100) / 100;

  const metrics = {
    current_frp: currentFrp,
    baseline_frp_median: bMed,
    baseline_frp_p75: bP75,
    baseline_frp_p95: bP95,
    baseline_frp_max: bMax,
    frp_ratio_to_median: ratio,
    frp_delta_from_median: delta,
  };

  const evalParams = {
    rule_type: (isEmpirical
      ? 'EMPIRICAL_PERCENTILE_MODEL'
      : isCandidate
      ? 'CANDIDATE_EMPIRICAL_MODEL'
      : 'CONTROLLED_PROTOTYPE_MODEL') as any,
    thresholds_used: {
      elevated_percentile: elevatedPct,
      anomalous_percentile: anomalousPct,
    },
    label: isEmpirical
      ? `Empirical Percentile Baseline (N=${baseline.metrics.observation_count}, P75=${bP75} MW, P95=${bP95} MW)`
      : isCandidate
      ? `Candidate Empirical Baseline (N=${baseline.metrics.observation_count}, Review Required, P75=${bP75} MW, P95=${bP95} MW)`
      : `Controlled Prototype Baseline (${facility.category}, Median=${bMed} MW, P75=${bP75} MW, P95=${bP95} MW)`,
  };

  // 3A: Off-Zone Detection inside facility boundary
  if (associationType === 'FACILITY_OFF_ZONE') {
    if (currentFrp >= bP75) {
      return {
        behavioural_status: 'ANOMALOUS',
        baseline_status: baselineStatus,
        reasons: [
          `Current FRP = ${currentFrp} MW exceeds ${provenanceLabel.toLowerCase()} median (${bMed} MW) by ${delta} MW (${ratio}×).`,
          `Observation is located inside the facility fence line but off-stack (${distanceToZoneMeters !== null ? `${Math.round(distanceToZoneMeters)} m from nearest stack` : 'away from stacks'}).`,
          `Spatially anomalous relative to configured facility thermal zones (potential uncontained heat release or off-flare combustion is treated as a hypothesis requiring further evidence).`,
        ],
        metrics,
        spatial_context: spatialContext,
        evaluation_parameters: evalParams,
      };
    } else {
      return {
        behavioural_status: 'ELEVATED',
        baseline_status: baselineStatus,
        reasons: [
          `Current FRP = ${currentFrp} MW is moderate (${provenanceLabel.toLowerCase()} median: ${bMed} MW), but detection is located off known process stacks.`,
          `Spatially unexpected relative to configured facility thermal zones (${distanceToFacilityMeters !== null ? `${Math.round(distanceToFacilityMeters)} m inside centroid` : 'inside boundary'}); warrants verification against maintenance or ground activities.`,
        ],
        metrics,
        spatial_context: spatialContext,
        evaluation_parameters: evalParams,
      };
    }
  }

  // 3B: Known Thermal Zone Detection
  if (associationType === 'KNOWN_THERMAL_ZONE') {
    if (currentFrp > bP95) {
      return {
        behavioural_status: 'ANOMALOUS',
        baseline_status: baselineStatus,
        reasons: [
          `Current FRP = ${currentFrp} MW exceeds the ${provenanceLabel.toLowerCase()} 95th percentile (${bP95} MW) by ${(currentFrp - bP95).toFixed(1)} MW.`,
          `Intensity represents a ${ratio}× multiple of the facility ${provenanceLabel.toLowerCase()} median (${bMed} MW).`,
          `Collocated with ${matchedZoneName || 'process flare / stack'} (${distanceToZoneMeters !== null ? `${Math.round(distanceToZoneMeters)} m` : 'on-site'}).`,
        ],
        metrics,
        spatial_context: spatialContext,
        evaluation_parameters: evalParams,
      };
    } else if (currentFrp > bP75) {
      return {
        behavioural_status: 'ELEVATED',
        baseline_status: baselineStatus,
        reasons: [
          `Current FRP = ${currentFrp} MW is above ${provenanceLabel.toLowerCase()} median (${bMed} MW) and exceeds the 75th percentile (${bP75} MW).`,
          `Combustion intensity is higher than routine operations but remains below the 95th percentile outlier cutoff (${bP95} MW).`,
          `Collocated with ${matchedZoneName || 'known stack'} within normal positional tolerance.`,
        ],
        metrics,
        spatial_context: spatialContext,
        evaluation_parameters: evalParams,
      };
    } else {
      return {
        behavioural_status: 'NORMAL',
        baseline_status: baselineStatus,
        reasons: [
          `Current FRP = ${currentFrp} MW is within the typical ${provenanceLabel.toLowerCase()} operating range (Median: ${bMed} MW, P75: ${bP75} MW).`,
          `Combustion intensity matches routine operational flaring at ${matchedZoneName || 'designated stack'}.`,
        ],
        metrics,
        spatial_context: spatialContext,
        evaluation_parameters: evalParams,
      };
    }
  }

  // 3C: Buffer Area
  if (currentFrp > bP95) {
    return {
      behavioural_status: 'ANOMALOUS',
      baseline_status: baselineStatus,
      reasons: [
        `Current FRP = ${currentFrp} MW in facility perimeter buffer exceeds facility ${provenanceLabel.toLowerCase()} P95 (${bP95} MW).`,
        `Location is ${distanceToFacilityMeters !== null ? `${Math.round(distanceToFacilityMeters)} m` : 'perimeter'} from facility center.`,
      ],
      metrics,
      spatial_context: spatialContext,
      evaluation_parameters: evalParams,
    };
  } else if (currentFrp > bP75) {
    return {
      behavioural_status: 'ELEVATED',
      baseline_status: baselineStatus,
      reasons: [
        `Current FRP = ${currentFrp} MW in perimeter buffer is above ${provenanceLabel.toLowerCase()} median (${bMed} MW).`,
      ],
      metrics,
      spatial_context: spatialContext,
      evaluation_parameters: evalParams,
    };
  } else {
    return {
      behavioural_status: 'NORMAL',
      baseline_status: baselineStatus,
      reasons: [
        `Current FRP = ${currentFrp} MW in perimeter buffer is within expected baseline levels.`,
      ],
      metrics,
      spatial_context: spatialContext,
      evaluation_parameters: evalParams,
    };
  }
}
