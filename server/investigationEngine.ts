import {
  ServerThermalObservation,
  ServerFacility,
  SpatialAssociationType,
  BehaviouralStatus,
  SourceHypothesisType,
  ContextualHypothesisItem,
  PrototypeSourceHypotheses,
  SpatialAssessment,
  BehaviourAssessment,
  HypothesisAssessment,
  UncertaintyAssessment,
  EvidenceAssessment,
  NBEAssessment,
  ObservedThermalActivityZone,
  InvestigationCaseData,
  EvidenceStatusDetail,
  InvestigationPriorityResult,
  EvidenceCandidate,
  EvidenceCandidateType,
  NextBestEvidenceRecommendation,
  DecisionExplanation,
  EvidenceGuidedInvestigation,
  ThermalSourceDiscriminatorOutput,
  UtilityScoreBreakdown,
  ExplicitEvidenceItem,
  StructuredEvidenceConflict,
  InitialVsCurrentAssessment,
  InvestigationTimelineEventType,
  InvestigationTimelineEvent,
  EvidenceEffectRecord,
  InitialAssessmentSnapshot,
  InvestigatorResolution,
  InvestigationResolutionStatus,
  EvidenceDirection,
  HypothesisSupport,
} from './types.js';
import { evaluateThermalDiscriminator } from './thermalDiscriminator.js';
import {
  collectExplicitEvidenceItems,
  fuseEvidenceAndAssessUncertainty,
  calculateExactShannonEntropy,
  detectStructuredEvidenceConflict,
  ALL_CANDIDATE_HYPOTHESES,
  HYPOTHESIS_DISPLAY_LABELS,
} from './evidenceFusionEngine.js';
import { evaluateRealNextBestEvidence } from './nbeEngine.js';
import { EmpiricalFacilityBaseline } from './historicalIngestion.js';
import { BayesianPosteriorResult } from './bayesianEngine.js';
import { evaluateObservationAgainstBaseline, BehaviouralAssessmentResult } from './deviationEngine.js';
import { getFacilityBaselineSync } from './baselineRepository.js';
import { MONITORED_FACILITIES } from './facilities.js';
import { getCachedObservationById, getAllCachedObservations } from './firms.js';
import {
  haversineDistanceMeters,
  isPointInPolygon,
  findFacilitySpatialAssociation,
  distanceToPolygonBoundaryMeters,
} from './geospatial.js';
import { queryNearbyOsmInfrastructure } from './osm.js';
import { getHistoricalWeatherContext } from './weather.js';
import { fetchSentinel2SwirEvidence } from './sentinelHub.js';
import fs from 'fs';
import path from 'path';

// Active in-memory investigation case store
export const activeCasesMap = new Map<string, InvestigationCaseData>();

export const JAMNAGAR_OBSERVED_ACTIVITY_ZONES: ObservedThermalActivityZone[] = [
  {
    id: 'OBS-ZONE-JAM-01',
    facility_id: 'FAC-GUJ-JAMNAGAR-01',
    name: 'Observed Thermal Activity Zone (Southern Operating Footprint)',
    centroid: [22.3385, 69.8608],
    radius_meters: 850,
    observation_count: 290,
    percentage_of_historical: 98.6,
    sample_period: '2026-01-01 to 2026-04-22',
    median_frp_mw: 2.32,
    p95_frp_mw: 6.41,
    description:
      'Empirically derived cluster centroid from 290 historical VIIRS detections (2026-01-01 to 2026-04-22). Preserves distinction from unverified configured stack coordinates.',
  },
];

export type { InvestigationCaseData };

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

/**
 * Dynamic Investigation Priority Engine
 * Continuous, evidence-grounded operational triage score (10 - 100).
 * Evaluates real available evidence factors:
 * - Continuous FRP magnitude & log-radiance
 * - Empirical facility baseline deviation (ratio to median, percentile excursion)
 * - Spatial novelty (off-stack distance inside boundary, perimeter buffer)
 * - Hypothesis uncertainty & entropy
 * - Sensor confidence & detection quality
 */
export function calculateInvestigationPriority(
  frp: number,
  behaviouralStatus: BehaviouralStatus,
  spatialAssociation: SpatialAssociationType,
  baseline: EmpiricalFacilityBaseline | null,
  distanceToConfiguredZoneMeters: number | null,
  confidence: 'low' | 'nominal' | 'high',
  options?: {
    normalized_entropy?: number;
    entropy_bits?: number;
  }
): InvestigationPriorityResult {
  const reasons: string[] = [];
  let score = 15; // Base minimum triage baseline

  // 1. Continuous FRP Component (1 to 28 points)
  const safeFrp = Math.max(0.1, Number(frp) || 0.1);
  const frpScore = Math.min(28, Math.max(2, Math.round(5.5 * Math.log(1 + safeFrp))));
  score += frpScore;
  if (safeFrp >= 80) {
    reasons.push(`High thermal emission: FRP (${safeFrp.toFixed(1)} MW) indicates substantial energetic heat release (+${frpScore} pts).`);
  } else if (safeFrp >= 25) {
    reasons.push(`Moderate thermal output: FRP (${safeFrp.toFixed(1)} MW) exceeds routine low-intensity threshold (+${frpScore} pts).`);
  } else {
    reasons.push(`Radiative power: FRP is ${safeFrp.toFixed(1)} MW (+${frpScore} pts).`);
  }

  // 2. Behavioural Baseline & Deviation (up to 36 points)
  if (baseline && (baseline.baseline_status === 'EMPIRICAL' || baseline.baseline_status === 'CONTROLLED') && baseline.metrics.frp_median > 0) {
    const ratio = safeFrp / baseline.metrics.frp_median;
    const p95 = baseline.metrics.frp_p95;
    const p75 = baseline.metrics.frp_p75;
    const baselineTag = baseline.baseline_status === 'CONTROLLED' ? ' [Controlled Prototype]' : ' [Empirical]';

    if (safeFrp > p95) {
      const devBonus = Math.min(36, Math.round(20 + Math.min(16, (ratio - 1) * 3)));
      score += devBonus;
      reasons.push(`Anomalous surge${baselineTag}: FRP (${safeFrp.toFixed(1)} MW) exceeds 95th percentile (${p95.toFixed(1)} MW) by ${(safeFrp - p95).toFixed(1)} MW (${ratio.toFixed(2)}× baseline median, ${(safeFrp / p95).toFixed(1)}× P95 threshold, +${devBonus} pts).`);
    } else if (safeFrp > p75) {
      const devBonus = Math.min(24, Math.round(12 + (ratio - 1) * 2));
      score += devBonus;
      reasons.push(`Elevated output${baselineTag}: FRP exceeds 75th percentile (${p75.toFixed(1)} MW) by ${(safeFrp - p75).toFixed(1)} MW (+${devBonus} pts).`);
    } else {
      score += 4;
      reasons.push(`Conforms to facility operational baseline${baselineTag} (median: ${baseline.metrics.frp_median.toFixed(1)} MW).`);
    }
  } else {
    if (behaviouralStatus === 'ANOMALOUS') {
      score += 26;
      reasons.push('Assessed as ANOMALOUS deviation (+26 pts).');
    } else if (behaviouralStatus === 'ELEVATED') {
      score += 15;
      reasons.push('Assessed as ELEVATED emission (+15 pts).');
    } else if (behaviouralStatus === 'NORMAL') {
      score += 4;
      reasons.push('Assessed as NORMAL operational output (+4 pts).');
    } else {
      // UNASSOCIATED: outside monitored baseline
      if (safeFrp >= 50) {
        const unassocBonus = Math.min(24, Math.round(8 + (safeFrp - 50) * 0.2));
        score += unassocBonus;
        reasons.push(`Regional thermal excursion outside monitored facilities: FRP ${safeFrp.toFixed(1)} MW (+${unassocBonus} pts).`);
      } else {
        reasons.push('Regional thermal observation outside monitored operational facility baselines.');
      }
    }
  }

  // 3. Spatial Relationship & Novelty (up to 18 points)
  if (spatialAssociation === 'FACILITY_OFF_ZONE') {
    const dist = distanceToConfiguredZoneMeters || 600;
    const offZoneBonus = Math.min(18, Math.round(10 + Math.min(8, dist / 200)));
    score += offZoneBonus;
    reasons.push(`Spatial novelty: Located inside facility perimeter but offset from configured stack zones (${dist} m offset, +${offZoneBonus} pts).`);
  } else if (spatialAssociation === 'FACILITY_BUFFER') {
    score += 8;
    reasons.push('Perimeter event: Located in facility buffer envelope (+8 pts).');
  } else if (spatialAssociation === 'KNOWN_THERMAL_ZONE') {
    score += 4;
    reasons.push('Coincident with mapped active operational flare stack zone.');
  }

  // 4. Uncertainty / Competing Hypothesis Ambiguity (up to 12 points)
  const normEntropy = options?.normalized_entropy ?? 0.55;
  const entropyBonus = Math.round(normEntropy * 12);
  score += entropyBonus;
  if (normEntropy > 0.6) {
    reasons.push(`High hypothesis ambiguity (H_norm = ${(normEntropy * 100).toFixed(0)}%): Competing candidates require evidence resolution (+${entropyBonus} pts).`);
  }

  // 5. Sensor Confidence
  if (confidence === 'high') {
    score += 4;
    reasons.push('Detection confidence is HIGH (+4 pts).');
  } else if (confidence === 'low') {
    score = Math.max(10, score - 8);
    reasons.push('Detection confidence is LOW (-8 pts).');
  }

  // Final score clamping
  score = Math.min(100, Math.max(10, Math.round(score)));

  let level: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
  if (score >= 70 || behaviouralStatus === 'ANOMALOUS') {
    level = 'HIGH';
  } else if (score >= 45 || behaviouralStatus === 'ELEVATED') {
    level = 'MEDIUM';
  } else {
    level = 'LOW';
  }

  return {
    level,
    score,
    label: 'Dynamic Triage Priority',
    disclaimer: 'Operational triage score; not probability of fire or incident severity.',
    reasons,
  };
}

/**
 * Computes Shannon entropy over normalized hypothesis probabilities:
 * H = - sum(p_i * log2(p_i)) for p_i > 0
 * Max entropy for K hypotheses is log2(K) bits.
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

import { evaluateCanonicalHypotheses } from './hypothesisEngine.js';
import { evaluateTemporalPersistence } from './persistenceEngine.js';

/**
 * Evaluates competing source hypotheses and calculates Shannon entropy uncertainty
 * using the canonical universal evidence-guided hypothesis engine.
 */
export function calculateSourceHypothesesAndUncertainty(
  spatialAssociation: SpatialAssociationType,
  facility: ServerFacility | null,
  frp: number,
  baseline: EmpiricalFacilityBaseline | null,
  behaviouralStatus: BehaviouralStatus,
  distToObservedZone: number | null,
  distToConfiguredZone: number | null,
  confidence: 'low' | 'nominal' | 'high' = 'nominal',
  dayNight: 'D' | 'N' = 'N',
  coords?: [number, number],
  radiometry?: {
    brightness_kelvin?: number;
    brightness_ti4?: number;
    brightness_ti5?: number;
    brightness_delta?: number;
    sensor?: string;
  },
  extraSpatial?: {
    distance_to_facility_meters?: number | null;
    matched_zone_name?: string | null;
    is_inside_polygon?: boolean;
    facility_category?: string | null;
  }
): {
  source_hypotheses: PrototypeSourceHypotheses;
  uncertainty: UncertaintyAssessment;
  bayesian_result: BayesianPosteriorResult;
} {
  const persistence = coords ? evaluateTemporalPersistence(coords[0], coords[1]) : null;
  const result = evaluateCanonicalHypotheses({
    frp,
    brightness_kelvin: radiometry?.brightness_kelvin,
    brightness_ti4: radiometry?.brightness_ti4,
    brightness_ti5: radiometry?.brightness_ti5,
    brightness_delta: radiometry?.brightness_delta,
    sensor: radiometry?.sensor || 'VIIRS',
    day_night: dayNight,
    confidence,
    spatial_association: spatialAssociation,
    distance_to_facility_meters: extraSpatial?.distance_to_facility_meters ?? null,
    distance_to_zone_meters: distToConfiguredZone,
    facility_id: facility?.id || null,
    facility_name: facility?.name || null,
    facility_category: extraSpatial?.facility_category ?? facility?.category ?? null,
    matched_zone_name: extraSpatial?.matched_zone_name ?? null,
    is_inside_polygon: extraSpatial?.is_inside_polygon ?? Boolean(facility),
    behavioural_status: behaviouralStatus,
    baseline,
    persistence_context: persistence,
  });

  return {
    source_hypotheses: result.source_hypotheses,
    uncertainty: result.uncertainty,
    bayesian_result: result.bayesian_result,
  };
}

/**
 * Constructs structured evidence status separating available context from missing/future evidence
 */
export function constructEvidenceStatusDetail(
  obs: { id: string; frp: number; coordinates?: [number, number]; satellite?: string; confidence?: string },
  facility: ServerFacility | null,
  baseline: EmpiricalFacilityBaseline | null,
  observedZone: ObservedThermalActivityZone | null,
  uncertaintyLevel: 'LOW' | 'MODERATE' | 'HIGH'
): EvidenceStatusDetail {
  const available: EvidenceStatusDetail['available_context'] = [
    {
      category: 'NASA FIRMS Satellite Observation',
      description: `Sensor: ${obs.satellite || 'VIIRS'} | FRP: ${obs.frp} MW | Confidence: ${obs.confidence || 'nominal'} | Coords: ${obs.coordinates ? `[${obs.coordinates[0].toFixed(4)}°N, ${obs.coordinates[1].toFixed(4)}°E]` : 'Available'}`,
      source: 'NASA LANCE / FIRMS Active Fire Product (Real VIIRS Data)',
      status: 'AVAILABLE',
    },
  ];

  if (facility) {
    available.push({
      category: 'Monitored Facility Boundary Geometry',
      description: `${facility.name} verified boundary perimeter polygon and 3.5 km buffer envelope.`,
      source: 'Verified Facility GeoJSON Registry',
      status: 'AVAILABLE',
    });
  }

  if (baseline && baseline.baseline_status === 'EMPIRICAL') {
    available.push({
      category: 'Empirical Historical Thermal Baseline',
      description: `${baseline.metrics.observation_count} VIIRS observations across ${baseline.metrics.observation_days} active days (Median: ${baseline.metrics.frp_median} MW, P95: ${baseline.metrics.frp_p95} MW).`,
      source: 'Historical VIIRS Ingestion Pipeline (2026-01-01 to 2026-04-25)',
      status: 'AVAILABLE',
    });
  }

  if (observedZone) {
    available.push({
      category: 'Observed Thermal Activity Zone',
      description: `${observedZone.name} (Centroid: [${observedZone.centroid[0]}°N, ${observedZone.centroid[1]}°E], radius ${observedZone.radius_meters} m, 213 historical cluster hits).`,
      source: 'Empirical Spatial Distribution Engine',
      status: 'AVAILABLE',
    });
  }

  available.push({
    category: 'Local Meteorological Wind & Dispersion',
    description: 'Open-Meteo ERA5 Reanalysis & High-Res NWP archive matching observation timestamp.',
    source: 'Open-Meteo Historical Weather API',
    status: 'AVAILABLE',
  });

  const missing: EvidenceStatusDetail['missing_evidence'] = [
    {
      category: 'Sentinel-2 High-Resolution Imagery',
      description:
        '10-20 m resolution SWIR (B11/B12) and optical imagery to verify physical flare stack structure vs ground fire.',
      importance: 'RECOMMENDED',
      source: 'Copernicus Sentinel-2 Overpass (Phase 4)',
      status: 'REQUIRED_FOR_CONFIRMATION',
    },
    {
      category: 'High-Resolution Land Cover & Vegetation Index',
      description:
        'Localized NDVI / multispectral classification to verify presence of vegetation, bare gravel, or industrial tanks.',
      importance: 'RECOMMENDED',
      source: 'Multispectral Surface Analysis (Pending)',
      status: 'REQUIRED_FOR_CONFIRMATION',
    },
    {
      category: 'Temporal Multi-Pass Persistence',
      description:
        'Corroborating thermal detections on subsequent satellite passes (NOAA-20, NOAA-21, Landsat-8/9) to establish duration.',
      importance: 'DESIRABLE',
      source: 'Multi-Mission Satellite Ingestion (Pending)',
      status: 'REQUIRED_FOR_CONFIRMATION',
    },
  ];

  const recommendation =
    uncertaintyLevel === 'HIGH' || uncertaintyLevel === 'MODERATE'
      ? 'Additional contextual evidence recommended.'
      : 'Primary hypothesis supported by spatial/thermal features; high-resolution imagery recommended for confirmation.';

  const summary =
    facility && baseline?.baseline_status === 'EMPIRICAL'
      ? 'Thermal observation evaluated against empirical facility baseline and observed activity zone. Ground truth confirmation remains pending high-resolution remote sensing.'
      : 'Regional context evaluated. Satellite infrared detection available without local high-resolution confirmation.';

  return {
    available_context: available,
    missing_evidence: missing,
    summary,
    recommendation,
  };
}

/**
 * Evaluates Phase 4 Evidence-Guided Investigation / Next-Best-Evidence
 *
 * Implements a transparent, documented Prototype Evidence Discrimination / Information-Value Approximation.
 * Strictly distinguishes:
 * - AVAILABLE EVIDENCE (genuinely acquired in prototype)
 * - RECOMMENDED NEXT-BEST EVIDENCE (highest utility among available sources, or external candidate when sources exhausted)
 * - MISSING / UNAVAILABLE EVIDENCE (external candidates marked NOT_CURRENTLY_AVAILABLE with clear limitations)
 *
 * Formula:
 * UtilityScore(E) = Math.round(100 * [0.30 * (H / H_max) + 0.25 * C_comp + 0.45 * Relevance(E, case)] * CostMultiplier(E))
 */
export function evaluateEvidenceGuidedInvestigation(
  obs: {
    id: string;
    frp: number;
    coordinates?: [number, number];
    satellite?: string;
    confidence?: string;
    day_night?: 'D' | 'N';
    timestamp?: string;
    sentinel2_context?: {
      scene_id?: string;
      scene_timestamp?: string;
      cloud_cover_pct?: number;
      temporal_status?: string;
    };
  },
  facility: ServerFacility | null,
  baseline: EmpiricalFacilityBaseline | null,
  observedZone: ObservedThermalActivityZone | null,
  spatialAssociation: SpatialAssociationType,
  behaviouralStatus: BehaviouralStatus,
  sourceHypotheses: PrototypeSourceHypotheses,
  uncertainty: UncertaintyAssessment,
  priority: InvestigationPriorityResult,
  distToObservedZone: number | null,
  distToConfiguredZone: number | null,
  bayesianPosterior?: BayesianPosteriorResult,
  appliedEvidenceIds?: string[]
): EvidenceGuidedInvestigation {
  return evaluateRealNextBestEvidence({
    obs,
    facility,
    baseline,
    observedZone,
    spatialAssociation,
    behaviouralStatus,
    sourceHypotheses,
    uncertainty,
    priority,
    distToObservedZone,
    distToConfiguredZone,
    bayesianPosterior,
    appliedEvidenceIds,
  });
}


/**
 * Builds an explainable investigation case from any thermal observation and facility context
 */
export function buildInvestigationCase(
  obs: {
    id: string;
    latitude: number;
    longitude: number;
    acquisition_time?: string;
    acquisition_timestamp?: string;
    satellite?: string;
    frp: number;
    confidence?: 'low' | 'nominal' | 'high';
    day_night?: 'D' | 'N';
    associated_facility_id?: string | null;
    associated_facility_name?: string | null;
    association_type?: SpatialAssociationType;
    distance_to_facility_meters?: number | null;
    distance_to_zone_meters?: number | null;
    matched_zone_name?: string | null;
    is_inside_polygon?: boolean;
    sensor?: string;
    brightness_kelvin?: number;
    brightness_ti4?: number;
    brightness_ti5?: number;
    brightness_delta?: number;
    scan?: number;
    track?: number;
    osm_context?: any;
    weather_context?: any;
    sentinel2_context?: any;
    additional_evidence?: any[];
    applied_evidence_ids?: string[];
  },
  facilityInput?: ServerFacility | null,
  baselineInput?: EmpiricalFacilityBaseline | null
): InvestigationCaseData {
  const caseId = `CASE-${obs.id.replace('FIRMS-', '').replace('HIST-', '')}`;
  const timestamp = obs.acquisition_timestamp || obs.acquisition_time || new Date().toISOString();
  const sat = obs.satellite === 'N' ? 'Suomi NPP VIIRS' : obs.satellite === 'N20' ? 'NOAA-20 VIIRS' : obs.satellite || 'VIIRS-NOAA20';
  const confidence = obs.confidence || 'nominal';

  // 1. Dynamic Geometric Spatial Association Resolution
  let facility: ServerFacility | null = null;
  let assocType: SpatialAssociationType = 'UNASSOCIATED';
  let isInsidePoly = false;
  let distToFacility: number | null = null;
  let distToConfiguredZone: number | null = null;
  let matchedZoneName: string | null = null;
  let isInsideKnownZone = false;

  if (facilityInput === undefined) {
    // Dynamic evaluation across all monitored facilities
    const spatialResult = findFacilitySpatialAssociation(obs.latitude, obs.longitude, MONITORED_FACILITIES);
    facility = spatialResult.matched_facility;
    assocType = obs.association_type || spatialResult.spatial_association;
    isInsidePoly = obs.is_inside_polygon !== undefined ? obs.is_inside_polygon : spatialResult.is_inside_polygon;
    distToFacility = obs.distance_to_facility_meters !== undefined ? obs.distance_to_facility_meters : spatialResult.facility_distance_meters;
    distToConfiguredZone = obs.distance_to_zone_meters !== undefined ? obs.distance_to_zone_meters : spatialResult.distance_to_zone_meters;
    matchedZoneName = obs.matched_zone_name || spatialResult.matched_zone?.name || null;
    isInsideKnownZone = spatialResult.is_inside_known_zone;
  } else if (facilityInput !== null) {
    facility = facilityInput;
    isInsidePoly = isPointInPolygon([obs.latitude, obs.longitude], facility.polygon);
    const distToCenter = haversineDistanceMeters(obs.latitude, obs.longitude, facility.center[0], facility.center[1]);
    const distToBoundary = isInsidePoly ? 0 : distanceToPolygonBoundaryMeters(obs.latitude, obs.longitude, facility.polygon);
    const bufferMeters = (facility.buffer_radius_km || 3.0) * 1000.0;

    let closestZone: ServerFacility['known_thermal_zones'][0] | null = null;
    let minZoneDist = Infinity;
    if (facility.known_thermal_zones && facility.known_thermal_zones.length > 0) {
      for (const z of facility.known_thermal_zones) {
        const d = haversineDistanceMeters(obs.latitude, obs.longitude, z.center[0], z.center[1]);
        if (d < minZoneDist) {
          minZoneDist = d;
          closestZone = z;
        }
      }
    }

    const zoneTolerance = (closestZone as any)?.radius_meters || 400.0;
    isInsideKnownZone = isInsidePoly && closestZone !== null && minZoneDist <= zoneTolerance;

    if (obs.association_type) {
      assocType = obs.association_type;
    } else if (isInsidePoly) {
      assocType = isInsideKnownZone ? 'KNOWN_THERMAL_ZONE' : 'FACILITY_OFF_ZONE';
    } else if (distToBoundary <= bufferMeters || distToCenter <= bufferMeters) {
      assocType = 'FACILITY_BUFFER';
    } else {
      assocType = 'UNASSOCIATED';
    }

    distToFacility = obs.distance_to_facility_meters !== undefined ? obs.distance_to_facility_meters : (isInsidePoly ? 0 : Math.round(distToBoundary * 10) / 10);
    distToConfiguredZone = obs.distance_to_zone_meters !== undefined ? obs.distance_to_zone_meters : (closestZone ? Math.round(minZoneDist * 10) / 10 : null);
    matchedZoneName = obs.matched_zone_name || (closestZone ? closestZone.name : null);
  } else {
    facility = null;
    assocType = 'UNASSOCIATED';
    isInsidePoly = false;
    distToFacility = null;
    distToConfiguredZone = null;
    matchedZoneName = null;
    isInsideKnownZone = false;
  }

  const baseline: EmpiricalFacilityBaseline | null =
    baselineInput !== undefined ? baselineInput : (facility ? getFacilityBaselineSync(facility.id) : null);

  // Compute distance to Observed Thermal Activity Zone for Jamnagar
  const obsZone = facility?.id === 'FAC-GUJ-JAMNAGAR-01' ? JAMNAGAR_OBSERVED_ACTIVITY_ZONES[0] : null;
  let distToObservedZone: number | null = null;
  if (obsZone) {
    distToObservedZone = haversineMeters(obs.latitude, obs.longitude, obsZone.centroid[0], obsZone.centroid[1]);
  }

  // Run behavioural evaluation
  const evalResult: BehaviouralAssessmentResult = evaluateObservationAgainstBaseline(
    obs.frp,
    assocType,
    distToConfiguredZone,
    distToFacility,
    matchedZoneName,
    isInsidePoly,
    facility,
    baseline
  );

  // Compute investigation priority
  const priority = calculateInvestigationPriority(
    obs.frp,
    evalResult.behavioural_status,
    assocType,
    baseline,
    distToConfiguredZone,
    confidence
  );

  // Construct current baseline metrics
  const isEmpirical = Boolean(baseline && baseline.baseline_status === 'EMPIRICAL');
  const isCandidate = Boolean(baseline && baseline.baseline_status === 'CANDIDATE_EMPIRICAL_WITH_REVIEW');
  const isLimited = Boolean(baseline && baseline.baseline_status === 'LIMITED');
  const isControlled = Boolean(baseline && baseline.baseline_status === 'CONTROLLED');
  const hasBaseline = isEmpirical || isCandidate || isControlled;
  const currentBaselineMetrics = {
    sample_size: (hasBaseline || isLimited) && baseline ? baseline.metrics.observation_count : 0,
    sample_period: (isEmpirical || isCandidate || isLimited) && baseline
      ? `${baseline.baseline_period.start_date} → ${baseline.baseline_period.end_date} (${baseline.baseline_period.total_days} days)`
      : isControlled
      ? 'CONTROLLED PROTOTYPE BASELINE'
      : 'N/A',
    median_frp: hasBaseline && baseline ? baseline.metrics.frp_median : null,
    p75_frp: hasBaseline && baseline ? baseline.metrics.frp_p75 : null,
    p95_frp: hasBaseline && baseline ? baseline.metrics.frp_p95 : null,
    max_frp: hasBaseline && baseline ? baseline.metrics.frp_max : null,
    ratio_to_median: hasBaseline && baseline && baseline.metrics.frp_median > 0 ? Math.round((obs.frp / baseline.metrics.frp_median) * 100) / 100 : null,
    delta_from_median: hasBaseline && baseline ? Math.round((obs.frp - baseline.metrics.frp_median) * 100) / 100 : null,
  };

  const exceedsP75 = Boolean(hasBaseline && baseline && baseline.metrics.frp_p75 !== null && obs.frp > baseline.metrics.frp_p75);
  const exceedsP95 = Boolean(hasBaseline && baseline && baseline.metrics.frp_p95 !== null && obs.frp > baseline.metrics.frp_p95);

  // Generate plain-English explanation reasons
  const explanationReasons: string[] = [];
  if (hasBaseline && baseline) {
    const ratioStr = currentBaselineMetrics.ratio_to_median ? `${currentBaselineMetrics.ratio_to_median}×` : '1.0×';
    const tag = isControlled ? 'controlled prototype' : isCandidate ? 'candidate empirical' : 'empirical';
    if (exceedsP95) {
      explanationReasons.push(
        `Current FRP is ${obs.frp} MW, approximately ${ratioStr} the facility-associated ${tag} median of ${baseline.metrics.frp_median} MW and above the ${tag} P95 of ${baseline.metrics.frp_p95} MW.`
      );
    } else if (exceedsP75) {
      explanationReasons.push(
        `Current FRP is ${obs.frp} MW, approximately ${ratioStr} the facility-associated ${tag} median of ${baseline.metrics.frp_median} MW (above ${tag} P75 of ${baseline.metrics.frp_p75} MW, but below P95 of ${baseline.metrics.frp_p95} MW).`
      );
    } else {
      explanationReasons.push(
        `Current FRP is ${obs.frp} MW, which is within the routine operational baseline range (${tag} median: ${baseline.metrics.frp_median} MW, P75: ${baseline.metrics.frp_p75} MW).`
      );
    }

    if (assocType === 'FACILITY_OFF_ZONE') {
      explanationReasons.push(
        `Observation occurs inside the monitored facility boundary but outside the currently configured thermal activity zones (${distToConfiguredZone !== null ? `${distToConfiguredZone} m from nearest configured stack zone` : 'off-zone'}).`
      );
      if (distToObservedZone !== null) {
        explanationReasons.push(
          `Spatial context: Located ${distToObservedZone} m from the facility's Observed Thermal Activity Zone centroid (where ${obsZone ? `${obsZone.observation_count} of ${baseline?.metrics?.observation_count || 294}` : 'majority of'} historical observations cluster).`
        );
      }
    } else if (assocType === 'KNOWN_THERMAL_ZONE') {
      explanationReasons.push(
        `Observation is collocated with ${obs.matched_zone_name || 'configured thermal zone'} (${distToConfiguredZone !== null ? `${distToConfiguredZone} m` : 'on-site'}).`
      );
    } else if (assocType === 'FACILITY_BUFFER') {
      explanationReasons.push(
        `Observation occurs in the facility perimeter buffer envelope (${distToFacility !== null ? `${distToFacility} m from facility center` : 'buffer'}).`
      );
    }

    if (evalResult.behavioural_status === 'ANOMALOUS') {
      explanationReasons.push('Potential abnormal industrial thermal event requiring investigation.');
    } else if (evalResult.behavioural_status === 'ELEVATED') {
      explanationReasons.push('Elevated thermal activity requiring operational monitoring.');
    } else {
      explanationReasons.push('Thermal output matches routine operational flaring behaviour.');
    }
  } else if (assocType === 'UNASSOCIATED' || !facility) {
    explanationReasons.push(
      `Observation location (${obs.latitude.toFixed(4)}°N, ${obs.longitude.toFixed(4)}°E) is outside monitored industrial facility boundaries and buffer envelopes.`
    );
    explanationReasons.push(
      'Regional unassociated thermal source. Not assessed against industrial facility operational baselines.'
    );
  } else {
    explanationReasons.push(
      `Located inside ${facility.name}, but historical observations (< 30) are insufficient to establish an empirical operational baseline.`
    );
    explanationReasons.push('Behavioural deviation assessment is suspended to prevent false positive alerts.');
  }

  // Evaluate source hypotheses and uncertainty using universal evidence-guided engine
  const { source_hypotheses, uncertainty, bayesian_result } = calculateSourceHypothesesAndUncertainty(
    assocType,
    facility,
    obs.frp,
    baseline,
    evalResult.behavioural_status,
    distToObservedZone,
    distToConfiguredZone,
    confidence,
    obs.day_night || 'N',
    [obs.latitude, obs.longitude],
    {
      brightness_kelvin: (obs as any).brightness_kelvin,
      brightness_ti4: (obs as any).brightness_ti4,
      brightness_ti5: (obs as any).brightness_ti5,
      brightness_delta: (obs as any).brightness_delta,
      sensor: (obs as any).sensor,
    },
    {
      distance_to_facility_meters: distToFacility,
      matched_zone_name: matchedZoneName,
      is_inside_polygon: isInsidePoly,
      facility_category: facility?.category,
    }
  );


  const evidenceStatusDetail = constructEvidenceStatusDetail(
    {
      id: obs.id,
      frp: obs.frp,
      coordinates: [obs.latitude, obs.longitude],
      satellite: sat,
      confidence,
    },
    facility,
    baseline,
    obsZone,
    uncertainty.uncertainty_level
  );

  const spatialLabel =
    assocType === 'KNOWN_THERMAL_ZONE'
      ? 'Inside Facility (Known Thermal Zone)'
      : assocType === 'FACILITY_OFF_ZONE'
      ? 'Inside Facility Boundary (Off-Zone)'
      : assocType === 'FACILITY_BUFFER'
      ? 'Facility Perimeter Buffer'
      : 'Unassociated Regional Hotspot';

  const evidenceGuidedInvestigation = evaluateEvidenceGuidedInvestigation(
    {
      id: obs.id,
      frp: obs.frp,
      coordinates: [obs.latitude, obs.longitude],
      satellite: sat,
      confidence,
      day_night: obs.day_night || 'N',
      timestamp,
      sentinel2_context: obs.sentinel2_context,
    },
    facility,
    baseline,
    obsZone,
    assocType,
    evalResult.behavioural_status,
    source_hypotheses,
    uncertainty,
    priority,
    distToObservedZone,
    distToConfiguredZone,
    bayesian_result,
    obs.applied_evidence_ids || []
  );

  // Canonical Assessment 1: Spatial Assessment
  const spatial_assessment: SpatialAssessment = {
    spatial_classification: assocType,
    spatial_classification_label: spatialLabel,
    is_associated: Boolean(facility),
    matched_facility: facility
      ? {
          id: facility.id,
          name: facility.name,
          operator: facility.operator,
          category: facility.category,
          state: facility.state,
          region: facility.region,
          center: facility.center,
          buffer_radius_km: facility.buffer_radius_km,
        }
      : null,
    facility_distance_meters: distToFacility,
    distance_to_nearest_configured_zone_meters: distToConfiguredZone,
    distance_to_observed_activity_zone_meters: distToObservedZone,
    is_inside_polygon: isInsidePoly,
    is_inside_known_zone: isInsideKnownZone,
    matched_zone_name: matchedZoneName,
    spatial_confidence:
      assocType === 'KNOWN_THERMAL_ZONE'
        ? 'HIGH'
        : assocType === 'FACILITY_OFF_ZONE'
        ? 'MODERATE'
        : assocType === 'FACILITY_BUFFER'
        ? 'MODERATE'
        : 'HIGH',
    reasons: explanationReasons.filter(
      (r) => r.includes('boundary') || r.includes('zone') || r.includes('perimeter') || r.includes('outside')
    ),
  };

  // Canonical Assessment 2: Behaviour Assessment
  const facilityBaselineStatus: 'EMPIRICAL' | 'LIMITED' | 'CANDIDATE_EMPIRICAL_WITH_REVIEW' | 'CONTROLLED' | 'INSUFFICIENT_DATA' | 'NOT_ASSESSED' | 'NONE' =
    baseline?.baseline_status === 'EMPIRICAL'
      ? 'EMPIRICAL'
      : baseline?.baseline_status === 'CANDIDATE_EMPIRICAL_WITH_REVIEW'
      ? 'CANDIDATE_EMPIRICAL_WITH_REVIEW'
      : baseline?.baseline_status === 'LIMITED'
      ? 'LIMITED'
      : baseline?.baseline_status === 'CONTROLLED'
      ? 'CONTROLLED'
      : baseline?.baseline_status === 'NOT_ASSESSED'
      ? 'NOT_ASSESSED'
      : facility
      ? 'INSUFFICIENT_DATA'
      : 'NONE';

  const observationDays = (hasBaseline || isLimited) && baseline?.metrics?.observation_days ? baseline.metrics.observation_days : (isEmpirical ? 88 : 0);
  const totalDays = (hasBaseline || isLimited) && baseline?.baseline_period?.total_days ? baseline.baseline_period.total_days : 0;
  const startDate = (hasBaseline || isLimited) && baseline?.baseline_period?.start_date ? baseline.baseline_period.start_date : 'N/A';
  const endDate = (hasBaseline || isLimited) && baseline?.baseline_period?.end_date ? baseline.baseline_period.end_date : 'N/A';

  const temporalSummary = (isEmpirical || isCandidate) && baseline
    ? `${baseline.metrics.observation_count} real VIIRS observations across ${observationDays} unique observation days between ${startDate} and ${endDate} (analysis window: ${totalDays} days).`
    : isLimited && baseline
    ? `${baseline.metrics.observation_count} real VIIRS observations across ${observationDays} unique observation days (insufficient sample size N < 30 for baseline establishment).`
    : undefined;

  const behaviour_assessment: BehaviourAssessment = {
    baseline_status: facilityBaselineStatus,
    baseline_availability: hasBaseline,
    baseline_sample_count: (hasBaseline || isLimited) && baseline ? baseline.metrics.observation_count : 0,
    cutoff_timestamp_iso: baseline?.cutoff_timestamp_iso,
    provenance_type: baseline?.provenance_type,
    population_scope: facility ? (baseline?.population_scope || 'FACILITY_ASSOCIATED') : 'NOT_APPLICABLE',
    baseline_period:
      (isEmpirical || isCandidate || isLimited) && baseline
        ? {
            start_date: startDate,
            end_date: endDate,
            total_days: totalDays,
            analysis_window_days: totalDays,
            observation_period_start: startDate,
            observation_period_end: endDate,
            observation_days: observationDays,
          }
        : undefined,
    temporal_coverage_summary: temporalSummary,
    baseline_metrics: {
      frp_median: hasBaseline && baseline ? baseline.metrics.frp_median : null,
      frp_p25: hasBaseline && baseline?.metrics.frp_p25 !== undefined ? baseline.metrics.frp_p25 : null,
      frp_p75: hasBaseline && baseline ? baseline.metrics.frp_p75 : null,
      frp_p90: hasBaseline && baseline?.metrics.frp_p90 !== undefined ? baseline.metrics.frp_p90 : null,
      frp_p95: hasBaseline && baseline ? baseline.metrics.frp_p95 : null,
      frp_max: hasBaseline && baseline ? baseline.metrics.frp_max : null,
      frp_iqr: hasBaseline && baseline?.metrics.frp_iqr !== undefined ? baseline.metrics.frp_iqr : null,
      frp_mad: hasBaseline && baseline?.metrics.frp_mad !== undefined ? baseline.metrics.frp_mad : null,
    },
    deviation_metrics: {
      current_frp: obs.frp,
      frp_ratio_to_median: currentBaselineMetrics.ratio_to_median,
      frp_delta_from_median: currentBaselineMetrics.delta_from_median,
      exceeds_p75: exceedsP75,
      exceeds_p95: exceedsP95,
    },
    behavioural_status: evalResult.behavioural_status,
    reasons:
      evalResult.reasons ||
      explanationReasons.filter(
        (r) => r.includes('baseline') || r.includes('FRP') || r.includes('percentile') || r.includes('deviation')
      ),
    evaluation_parameters: evalResult.evaluation_parameters || {
      rule_type: 'PERCENTILE_EXCURSION',
      thresholds_used: {
        elevated_percentile: 75,
        anomalous_percentile: 95,
      },
      label: evalResult.behavioural_status,
    },
  };

  // Evaluate ML Advisory Discriminator
  const leadingHypoPct = source_hypotheses?.hypotheses_distribution?.[0]?.percentage ?? undefined;
  const discriminatorResult = evaluateThermalDiscriminator(obs, leadingHypoPct, {
    spatial_assessment,
    behaviour_assessment,
    associated_facility: facility,
  });

  // Section 7: Collect explicit evidence items with provenance
  const explicitEvidenceItems = collectExplicitEvidenceItems({
    obs,
    spatial_assessment,
    behaviour_assessment,
    ml_discriminator: discriminatorResult,
    osm_context: (obs as any).osm_context,
    weather_context: (obs as any).weather_context,
    sentinel2_context: (obs as any).sentinel2_context,
    additional_evidence: (obs as any).additional_evidence,
    is_controlled: isControlled,
  });

  // Section 7: Fuse evidence and calculate initial vs current Shannon entropy
  const fusionResult = fuseEvidenceAndAssessUncertainty({
    initialDistribution: source_hypotheses.hypotheses_distribution || [],
    evidenceItems: explicitEvidenceItems,
    mlDiscriminator: discriminatorResult,
    appliedEvidenceIds: (obs as any).applied_evidence_ids,
  });

  // Canonical Assessment 3: Hypothesis Assessment
  const bayesPriorMap = bayesian_result?.prior_distribution?.distribution;
  const basePriorDistribution: HypothesisSupport[] = ['GAS_FLARE', 'INDUSTRIAL_FIRE', 'AGRICULTURAL_BURN', 'WILDFIRE_VEGETATION', 'OTHER'].map((h: any) => ({
    hypothesis: h,
    label: h === 'GAS_FLARE' ? 'Routine / Relief Gas Flare' : h === 'INDUSTRIAL_FIRE' ? 'Industrial Fire / Abnormal Heat' : h === 'AGRICULTURAL_BURN' ? 'Agricultural / Crop Residue Burn' : h === 'WILDFIRE_VEGETATION' ? 'Wildfire / Vegetation' : 'Other Process Heat / Sensor Artifact',
    percentage: Math.round(((bayesPriorMap as any)?.[h] ?? 0.20) * 100),
    normalized_score: (bayesPriorMap as any)?.[h] ?? 0.20,
    support_level: 'MODERATE',
    reasons: ['Spatially invariant uniform baseline prior before event evidence (20% per candidate hypothesis).'],
  }));

  const initialPosteriorDistribution: HypothesisSupport[] = (source_hypotheses.hypotheses_distribution || []).map((h) => ({
    hypothesis: h.hypothesis,
    label: h.label,
    percentage: h.percentage,
    normalized_score: h.normalized_score,
    support_level: h.support_level,
    reasons: h.reasons,
  }));

  const hypothesis_assessment: HypothesisAssessment = {
    primary_hypothesis: fusionResult.primary_hypothesis || source_hypotheses.primary_hypothesis,
    primary_hypothesis_type: fusionResult.primary_hypothesis_type || source_hypotheses.primary_hypothesis_type || 'OTHER',
    base_prior_distribution: basePriorDistribution,
    initial_posterior_distribution: initialPosteriorDistribution,
    prior_distribution: initialPosteriorDistribution,
    posterior_distribution: fusionResult.fused_hypotheses,
    candidate_hypotheses: source_hypotheses.hypotheses_distribution || [],
    hypotheses_distribution: source_hypotheses.hypotheses_distribution || [],
    fused_hypotheses: fusionResult.fused_hypotheses,
    initial_vs_current: fusionResult.initial_vs_current,
    hypothesis_rationales: (source_hypotheses.hypotheses_distribution || []).map((h) => ({
      hypothesis: h.hypothesis,
      score: h.normalized_score,
      rationale: h.reasons?.join('; ') || `Score ${h.percentage}% support`,
    })),
    alternative_hypotheses: source_hypotheses.alternative_hypotheses || [],
    provenance_method: 'Authoritative Bayesian Evidence Fusion & Contextual Priors',
    basis_explanation:
      'Authoritative Bayesian posterior evaluated from contextual baseline priors updated with incorporated evidence likelihoods.',
    feature_contributions_summary: source_hypotheses.feature_contributions_summary,
    evidence_breakdown: source_hypotheses.evidence_breakdown,
    bayesian_result: bayesian_result || (source_hypotheses as any).bayesian_result,
  };

  // Canonical Assessment 4: Uncertainty Assessment
  const uncertainty_assessment: UncertaintyAssessment = {
    ...uncertainty,
    entropy_bits: fusionResult.initial_vs_current.initial_assessment.entropy_bits,
    initial_entropy_bits: fusionResult.initial_vs_current.initial_assessment.entropy_bits,
    current_entropy_bits: fusionResult.initial_vs_current.current_assessment.entropy_bits,
    entropy_delta_bits: fusionResult.initial_vs_current.entropy_delta_bits,
    uncertainty_reduction_percentage: fusionResult.initial_vs_current.uncertainty_reduction_percentage,
  };

  // Canonical Assessment 5: Evidence Assessment
  const evidence_assessment: EvidenceAssessment = {
    current_evidence: evidenceGuidedInvestigation.currentEvidence,
    missing_evidence: evidenceGuidedInvestigation.missingEvidence,
    all_candidates: evidenceGuidedInvestigation.allCandidates,
    summary: evidenceStatusDetail.summary,
    recommendation_statement: evidenceStatusDetail.recommendation,
    evidence_conflict: discriminatorResult.evidence_conflict,
    structured_conflict: fusionResult.evidence_conflict,
    explicit_evidence_items: explicitEvidenceItems,
    radiometric_discriminator: discriminatorResult,
  };

  // Canonical Assessment 6: NBE Assessment
  const canonicalTargetAmbiguity =
    evidenceGuidedInvestigation.recommendedExternalEvidence?.target_ambiguity ||
    evidenceGuidedInvestigation.recommendedExternalEvidence?.target_hypothesis_pair ||
    evidenceGuidedInvestigation.recommendedExternalEvidence?.targetHypothesisPairs?.[0] ||
    evidenceGuidedInvestigation.recommendedAvailableEvidence?.target_ambiguity ||
    'None (Evaluated / Unambiguous)';

  const nbe_assessment: NBEAssessment = {
    recommended_available_evidence: evidenceGuidedInvestigation.recommendedAvailableEvidence,
    recommended_external_evidence: evidenceGuidedInvestigation.recommendedExternalEvidence,
    decision_explanation: evidenceGuidedInvestigation.decisionExplanation,
    ranked_candidates: [...evidenceGuidedInvestigation.allCandidates].sort(
      (a, b) => (b.prototypeInformationValueScore ?? 0) - (a.prototypeInformationValueScore ?? 0)
    ),
    target_ambiguity: canonicalTargetAmbiguity,
    current_entropy_bits: uncertainty_assessment.current_entropy_bits ?? uncertainty_assessment.entropy_bits,
    methodology: evidenceGuidedInvestigation.methodologyDocumentation,
  };

  // Section 9: Build initial T0 Assessment Snapshot
  const initial_assessment_snapshot: InitialAssessmentSnapshot = {
    hypotheses_distribution: [...(source_hypotheses.hypotheses_distribution || [])],
    primary_hypothesis: source_hypotheses.primary_hypothesis,
    primary_hypothesis_type: source_hypotheses.primary_hypothesis_type || 'OTHER',
    entropy_bits: fusionResult.initial_vs_current.initial_assessment.entropy_bits,
    max_possible_entropy_bits: uncertainty.max_possible_entropy_bits,
    normalized_entropy: fusionResult.initial_vs_current.initial_assessment.normalized_entropy,
    uncertainty_level: fusionResult.initial_vs_current.initial_assessment.uncertainty_level,
    ml_advisory: discriminatorResult,
    evidence_state: evidenceStatusDetail,
    spatial_assessment: { ...spatial_assessment },
    behaviour_assessment: { ...behaviour_assessment },
    priority: { ...priority },
    initial_nbe: evidenceGuidedInvestigation.recommendedExternalEvidence || evidenceGuidedInvestigation.recommendedAvailableEvidence,
    created_at: new Date().toISOString(),
  };

  // Section 9: Build T0 -> T5 timeline
  const initialTimeline = buildInvestigationTimelineT0toT5({
    obsId: obs.id,
    satellite: sat,
    detectionTimestamp: timestamp,
    coords: [obs.latitude, obs.longitude],
    frp: obs.frp,
    spatialAssociation: assocType,
    spatialLabel,
    facilityName: facility?.name || null,
    behaviouralStatus: evalResult.behavioural_status,
    baselineStatus: facilityBaselineStatus,
    primaryHypothesis: source_hypotheses.primary_hypothesis,
    primaryHypothesisType: source_hypotheses.primary_hypothesis_type || 'OTHER',
    primaryPercentage: source_hypotheses.hypotheses_distribution?.[0]?.percentage || 0,
    entropyBits: uncertainty.entropy_bits,
    normalizedEntropy: uncertainty.normalized_entropy,
    uncertaintyLevel: uncertainty.uncertainty_level,
    recommendedCandidateName: evidenceGuidedInvestigation.recommendedAvailableEvidence?.displayName || evidenceGuidedInvestigation.recommendedExternalEvidence?.displayName || 'Sentinel-2 SWIR',
    priorityScore: priority.score,
    priorityLevel: priority.level,
  });

  const createdCase: InvestigationCaseData = {
    case_id: caseId,
    firms_observation_id: obs.id,
    timestamp,
    satellite: sat,
    coordinates: [obs.latitude, obs.longitude],
    frp: obs.frp,
    confidence,
    day_night: obs.day_night || (obs as any).daynight || 'N',
    status: 'OPEN',
    resolution_status: 'PENDING_INVESTIGATION',

    // Section 9: Closed Investigation Loop Artifacts
    initial_assessment_snapshot,
    timeline: initialTimeline,
    evidence_effects_history: [],
    applied_evidence_items: explicitEvidenceItems.filter((i) => i.is_incorporated),
    applied_evidence_ids: (obs as any).applied_evidence_ids || explicitEvidenceItems.filter((i) => i.is_incorporated).map((i) => i.evidence_id),
    investigator_resolution: undefined,

    // Canonical Intelligence Assessments
    spatial_assessment,
    behaviour_assessment,
    hypothesis_assessment,
    uncertainty_assessment,
    evidence_assessment,
    nbe_assessment,
    bayesian_result: bayesian_result || (source_hypotheses as any).bayesian_result,

    // Backwards-compatible legacy fields
    associated_facility: facility
      ? {
          id: facility.id,
          name: facility.name,
          category: facility.category,
        }
      : null,
    spatial_association: assocType,
    spatial_association_label: spatialLabel,
    facility_baseline_status: facilityBaselineStatus,
    current_baseline_metrics: currentBaselineMetrics,
    behavioural_status: evalResult.behavioural_status,
    deviation_metrics: {
      frp_ratio_to_median: currentBaselineMetrics.ratio_to_median,
      frp_delta_from_median: currentBaselineMetrics.delta_from_median,
      exceeds_p75: exceedsP75,
      exceeds_p95: exceedsP95,
      distance_to_nearest_configured_zone_meters: distToConfiguredZone,
      distance_to_observed_activity_zone_meters: distToObservedZone,
      distance_to_facility_meters: distToFacility,
    },
    explanation_reasons: explanationReasons,
    source_hypotheses,
    uncertainty: uncertainty_assessment,
    evidence_status: evidenceStatusDetail.summary,
    evidence_status_detail: evidenceStatusDetail,
    investigation_priority: priority,
    evidence_guided_investigation: evidenceGuidedInvestigation,
    thermal_discriminator: discriminatorResult,
    thermalDiscriminator: discriminatorResult,
    provenance: (obs as any).provenance || (obs.id.startsWith('DEMO-') ? 'CONTROLLED_TEST' : isEmpirical ? 'HISTORICAL_BASELINE' : 'REAL_FIRMS'),
    is_real_data: (obs as any).is_real_data !== undefined ? (obs as any).is_real_data : (!obs.id.startsWith('DEMO-')),
    // UI convenience aliases
    caseId,
    primaryEventId: obs.id,
    facilityId: facility?.id,
    facilityName: facility?.name || (obs as any).facility_name || (assocType === 'UNASSOCIATED' ? 'Regional Thermal Hotspot' : 'Monitored Facility'),
    priorityLevel: priority.level,
    priorityScore: priority.score,
  };

  // Cache in active store
  activeCasesMap.set(caseId, createdCase);
  if (createdCase.caseId) activeCasesMap.set(createdCase.caseId, createdCase);
  if (createdCase.firms_observation_id) activeCasesMap.set(createdCase.firms_observation_id, createdCase);

  return createdCase;
}

/**
 * Section 9: Timeline Generator for initial Assessment T0 through T5
 */
export function buildInvestigationTimelineT0toT5(params: {
  obsId: string;
  satellite: string;
  detectionTimestamp: string;
  coords: [number, number];
  frp: number;
  spatialAssociation: SpatialAssociationType;
  spatialLabel: string;
  facilityName?: string | null;
  behaviouralStatus: BehaviouralStatus;
  baselineStatus: string;
  primaryHypothesis: string;
  primaryHypothesisType: SourceHypothesisType;
  primaryPercentage: number;
  entropyBits: number;
  normalizedEntropy: number;
  uncertaintyLevel: string;
  recommendedCandidateName: string;
  priorityScore: number;
  priorityLevel: string;
}): InvestigationTimelineEvent[] {
  const t0Time = params.detectionTimestamp || new Date().toISOString();
  const baseEpoch = new Date(t0Time).getTime();
  const validBase = isNaN(baseEpoch) ? Date.now() : baseEpoch;

  const t1Time = new Date(validBase + 12000).toISOString();
  const t2Time = new Date(validBase + 24000).toISOString();
  const t3Time = new Date(validBase + 36000).toISOString();
  const t4Time = new Date(validBase + 48000).toISOString();
  const t5Time = new Date(validBase + 60000).toISOString();

  return [
    {
      step_index: 0,
      step_code: 'T0',
      event_type: 'FIRMS_DETECTION',
      title: `NASA FIRMS Hotspot Ingestion (${params.obsId})`,
      actor: `${params.satellite} Ingestion Daemon`,
      timestamp: t0Time,
      summary: `Acquired thermal detection at [${params.coords[0].toFixed(4)}°N, ${params.coords[1].toFixed(4)}°E] with FRP = ${params.frp.toFixed(1)} MW.`,
      details: {
        obs_id: params.obsId,
        satellite: params.satellite,
        frp: params.frp,
        coordinates: params.coords,
      },
    },
    {
      step_index: 1,
      step_code: 'T1',
      event_type: 'SPATIAL_ASSOCIATION',
      title: `Geospatial Facility Association: ${params.spatialLabel}`,
      actor: 'Geospatial Intelligence Engine',
      timestamp: t1Time,
      summary: params.facilityName
        ? `Associated observation with monitored perimeter of ${params.facilityName} (${params.spatialAssociation}).`
        : 'Assessed as Unassociated Regional Hotspot outside monitored industrial perimeters.',
      details: {
        spatial_association: params.spatialAssociation,
        facility_name: params.facilityName,
      },
    },
    {
      step_index: 2,
      step_code: 'T2',
      event_type: 'BEHAVIOURAL_ASSESSMENT',
      title: `Facility Behavioural Profiler: ${params.behaviouralStatus}`,
      actor: 'Behavioural Deviation Engine',
      timestamp: t2Time,
      summary: `Evaluated emission against facility operational baseline (${params.baselineStatus}). Classified as ${params.behaviouralStatus}.`,
      details: {
        behavioural_status: params.behaviouralStatus,
        baseline_status: params.baselineStatus,
      },
    },
    {
      step_index: 3,
      step_code: 'T3',
      event_type: 'INITIAL_HYPOTHESIS_ASSESSMENT',
      title: `Initial Contextual Hypothesis Assessment (T0)`,
      actor: 'Contextual Multi-Hypothesis Engine',
      timestamp: t3Time,
      summary: `Leading initial hypothesis: ${HYPOTHESIS_DISPLAY_LABELS[params.primaryHypothesisType] || params.primaryHypothesisType} (${params.primaryPercentage}% support).`,
      details: {
        primary_hypothesis_type: params.primaryHypothesisType,
        primary_percentage: params.primaryPercentage,
      },
    },
    {
      step_index: 4,
      step_code: 'T4',
      event_type: 'UNCERTAINTY_CALCULATED',
      title: `Shannon Entropy Uncertainty Evaluation (H0)`,
      actor: 'Information & Uncertainty Engine',
      timestamp: t4Time,
      summary: `Initial Shannon Entropy H0 = ${params.entropyBits.toFixed(3)} bits (Normalized: ${(params.normalizedEntropy * 100).toFixed(1)}%, Level: ${params.uncertaintyLevel}).`,
      details: {
        entropy_bits: params.entropyBits,
        normalized_entropy: params.normalizedEntropy,
        uncertainty_level: params.uncertaintyLevel,
      },
    },
    {
      step_index: 5,
      step_code: 'T5',
      event_type: 'NBE_GENERATED',
      title: `Next-Best-Evidence (NBE) Discrimination Ranking`,
      actor: 'Information-Theoretic NBE Engine',
      timestamp: t5Time,
      summary: `Generated candidate information gains. Top recommended candidate: ${params.recommendedCandidateName} (Triage Priority: Score ${params.priorityScore}/100 [${params.priorityLevel}]).`,
      details: {
        recommended_candidate: params.recommendedCandidateName,
        priority_score: params.priorityScore,
        priority_level: params.priorityLevel,
      },
    },
  ];
}

/**
 * Section 9: Closed Evidence Loop — Incorporate evidence into an existing investigation case.
 * Executes full recalibration pipeline:
 * 1. Validates & stores evidence with provenance
 * 2. Runs bounded evidence fusion
 * 3. Updates hypothesis distribution P(H|E)
 * 4. Recalculates exact Shannon entropy H1, ΔH, and uncertainty reduction
 * 5. Recalculates structured evidence conflict
 * 6. Recalculates NBE expected information gains
 * 7. Recalculates triage priority
 * 8. Appends EvidenceEffectRecord and auditable timeline events T6 -> T10
 */
export async function incorporateEvidenceIntoCase(
  caseId: string,
  evidenceInput: {
    candidate_id?: string;
    evidence_id?: string;
    outcome_id?: string;
    outcome_name?: string;
    likelihood_by_hypothesis?: Record<SourceHypothesisType, number>;
    log_likelihood_by_hypothesis?: Record<SourceHypothesisType, number>;
    title?: string;
    description?: string;
    evidence_type?: string;
    value?: any;
    provenance?: 'REAL' | 'DERIVED' | 'CONTROLLED';
    reliability?: 'HIGH' | 'MODERATE' | 'LOW';
    applicability?: string;
    affected_hypotheses?: SourceHypothesisType[];
    direction_of_influence?: Record<SourceHypothesisType, EvidenceDirection>;
    strength_of_influence?: Record<SourceHypothesisType, number>;
    is_incorporated?: boolean;
    incorporation_rationale?: string;
  }
): Promise<InvestigationCaseData> {
  const currentCase = getOrCreateInvestigationCase(caseId);
  if (!currentCase) {
    throw new Error(`Investigation case ${caseId} not found`);
  }

  // 1. Record Prior State
  const priorDistribution: Record<SourceHypothesisType, number> = {
    GAS_FLARE: 0,
    INDUSTRIAL_FIRE: 0,
    AGRICULTURAL_BURN: 0,
    WILDFIRE_VEGETATION: 0,
    OTHER: 0,
  };
  const activeHypotheses =
    currentCase.hypothesis_assessment.fused_hypotheses ||
    currentCase.hypothesis_assessment.hypotheses_distribution ||
    [];
  for (const h of activeHypotheses) {
    priorDistribution[h.hypothesis] = h.percentage;
  }
  const history = currentCase.evidence_effects_history || [];
  const entropyBefore =
    history.length > 0
      ? history[history.length - 1].entropy_after
      : (currentCase.initial_assessment_snapshot?.entropy_bits ?? currentCase.uncertainty_assessment.current_entropy_bits ?? 1.539);

  // 2. Resolve or construct explicit evidence item
  const lat = currentCase.coordinates[0];
  const lon = currentCase.coordinates[1];
  const obsTimestamp = currentCase.timestamp;
  const now = new Date().toISOString();

  let resolvedItem: ExplicitEvidenceItem;

  const candidateKey = (evidenceInput.candidate_id || evidenceInput.evidence_id || evidenceInput.evidence_type || '').toUpperCase();

  if (candidateKey.includes('SENTINEL2') || candidateKey.includes('SWIR')) {
    let s2Val = evidenceInput.value;
    let s2Prov: 'REAL' | 'CONTROLLED' = evidenceInput.provenance === 'REAL' ? 'REAL' : 'CONTROLLED';

    if (!s2Val) {
      const s2Res = await fetchSentinel2SwirEvidence({
        lat,
        lon,
        date: obsTimestamp ? obsTimestamp.split('T')[0] : undefined,
        timestamp: obsTimestamp,
        obsId: currentCase.firms_observation_id,
        facilityId: currentCase.associated_facility?.id || undefined,
      });
      s2Val = s2Res;
      s2Prov = s2Res.status === 'AUTHENTIC_LIVE' ? 'REAL' : 'CONTROLLED';
    }

    const isTemporallyEligible =
      s2Val?.temporal_status === 'TEMPORALLY_RELEVANT' &&
      s2Val?.is_event_adjacent === true;

    if (!isTemporallyEligible) {
      // Stale / Temporally distant satellite scene:
      // Retained strictly as contextual / structural surface baseline evidence.
      // Must NOT alter event-level Bayesian posterior.
      const isAuthenticLive = s2Val?.status === 'AUTHENTIC_LIVE' || s2Val?.is_live_external;
      const temporalHuman = s2Val?.temporal_difference_human || (s2Val?.temporal_difference_hours ? `${s2Val.temporal_difference_hours}h prior` : 'temporally distant');
      const advisoryText = s2Val?.advisory_note || `TEMPORALLY DISTANT: Sentinel-2 scene acquired ${temporalHuman}. Provides high-resolution structural layout and historical baseline flare context; NOT contemporaneous event evidence.`;

      resolvedItem = {
        evidence_id: evidenceInput.evidence_id || 'EVID-SENTINEL2-CONTEXTUAL',
        source: 'COPERNICUS_SENTINEL_2_MSI',
        evidence_type: 'SENTINEL2_SWIR_OPTICAL',
        outcome_id: 'TEMPORALLY_DISTANT_SURFACE_CONTEXT',
        outcome_name: 'Historical / Stale Structural Context (Temporally Distant Overpass)',
        title: isAuthenticLive
          ? `Sentinel-2 Structural Context (AUTHENTIC_LIVE — Stale Overpass: ${temporalHuman})`
          : `Sentinel-2 Structural Context (${s2Val?.scene_id || 'Contextual Baseline'})`,
        description: `${advisoryText} [AUTHENTIC_LIVE + TEMPORALLY_DISTANT = real satellite data, but not event-level evidence].`,
        value: s2Val,
        timestamp: s2Val?.acquisition_timestamp || now,
        provenance: evidenceInput.provenance || s2Prov,
        reliability: 'HIGH',
        applicability: 'Contextual structural and terrain layout inspection. Excluded from event-level Bayesian posterior updates.',
        affected_hypotheses: ['GAS_FLARE', 'INDUSTRIAL_FIRE', 'WILDFIRE_VEGETATION'],
        likelihood_by_hypothesis: {
          GAS_FLARE: 0.20,
          INDUSTRIAL_FIRE: 0.20,
          AGRICULTURAL_BURN: 0.20,
          WILDFIRE_VEGETATION: 0.20,
          OTHER: 0.20,
        },
        is_acquired: true,
        is_evaluated: true,
        is_temporally_eligible: false,
        temporal_status: 'TEMPORALLY_DISTANT',
        is_incorporated: false,
        changed_posterior: false,
        entropy_delta_bits: 0.0,
        incorporation_rationale:
          'Temporally distant satellite overpass retained as contextual structural evidence only; excluded from event-level Bayesian posterior updates.',
      };
    } else {
      // Contemporaneous / Temporally adjacent overpass within event window:
      const uncontainedSpread = s2Val?.evidence_findings?.uncontained_spread ?? false;
      const spatialExpansion = s2Val?.evidence_findings?.spatial_expansion ?? false;

      const isFlarePattern = (s2Val?.evidence_findings?.swir_thermal_pattern || '').includes('flare') || (s2Val?.evidence_findings?.swir_thermal_pattern || '').includes('point');
      const outcomeId = (uncontainedSpread || spatialExpansion)
        ? 'SURFACE_SPREAD_PROCESS_STRUCTURE'
        : isFlarePattern || !uncontainedSpread
        ? 'POINT_EMITTER_ELEVATED_STACK'
        : 'INCONCLUSIVE_CLOUD_COVER_OR_AMBIENT';

      const defaultLikelihood: Record<SourceHypothesisType, number> = outcomeId === 'SURFACE_SPREAD_PROCESS_STRUCTURE'
        ? { GAS_FLARE: 0.04, INDUSTRIAL_FIRE: 0.80, AGRICULTURAL_BURN: 0.04, WILDFIRE_VEGETATION: 0.04, OTHER: 0.08 }
        : outcomeId === 'POINT_EMITTER_ELEVATED_STACK'
        ? { GAS_FLARE: 0.82, INDUSTRIAL_FIRE: 0.04, AGRICULTURAL_BURN: 0.01, WILDFIRE_VEGETATION: 0.01, OTHER: 0.12 }
        : { GAS_FLARE: 0.20, INDUSTRIAL_FIRE: 0.20, AGRICULTURAL_BURN: 0.20, WILDFIRE_VEGETATION: 0.20, OTHER: 0.20 };

      resolvedItem = {
        evidence_id: evidenceInput.evidence_id || 'EVID-SENTINEL2-SWIR',
        source: 'COPERNICUS_SENTINEL_2_MSI',
        evidence_type: 'SENTINEL2_SWIR_OPTICAL',
        outcome_id: evidenceInput.outcome_id || outcomeId,
        title: evidenceInput.title || `Sentinel-2 SWIR Optical Inspection (${s2Val?.scene_id || 'MSI-20M'})`,
        description:
          evidenceInput.description ||
          `20m resolution optical/SWIR inspection. Spatial expansion: ${spatialExpansion ? 'DETECTED' : 'NONE'}, Uncontained ground spread: ${uncontainedSpread ? 'CONFIRMED' : 'NEGATIVE'}.`,
        value: s2Val,
        timestamp: s2Val?.acquisition_timestamp || now,
        provenance: evidenceInput.provenance || s2Prov,
        reliability: evidenceInput.reliability || 'HIGH',
        applicability: 'High-resolution optical discrimination of emitter geometry and ground-level structural fire spread.',
        affected_hypotheses: ['GAS_FLARE', 'INDUSTRIAL_FIRE', 'WILDFIRE_VEGETATION'],
        likelihood_by_hypothesis: evidenceInput.likelihood_by_hypothesis || defaultLikelihood,
        is_acquired: true,
        is_evaluated: true,
        is_temporally_eligible: true,
        temporal_status: 'TEMPORALLY_RELEVANT',
        is_incorporated: true,
        changed_posterior: true,
        incorporation_rationale:
          evidenceInput.incorporation_rationale ||
          'High-resolution multispectral imagery resolves ground-level combustion geometry.',
      };
    }
  } else if (candidateKey.includes('OSM') || candidateKey.includes('INFRASTRUCTURE')) {
    let osmVal = evidenceInput.value;
    if (!osmVal) {
      osmVal = await queryNearbyOsmInfrastructure(lat, lon, 3.0);
    }
    const elements = osmVal?.elements || [];
    const hasFlare = elements.some(
      (el: any) =>
        el.tags?.man_made === 'flare' ||
        el.tags?.industrial === 'flare_stack' ||
        el.tags?.name?.toLowerCase().includes('flare')
    );
    const hasTank = elements.some(
      (el: any) =>
        el.tags?.man_made === 'storage_tank' ||
        el.tags?.content === 'oil' ||
        el.tags?.content === 'petroleum'
    );

    const outcomeId = hasFlare
      ? 'PROXIMATE_MAPPED_FLARE_OR_CHIMNEY'
      : hasTank
      ? 'PROXIMATE_STORAGE_TANK_OR_PROCESS_UNIT'
      : 'RURAL_OR_UNMAPPED_TERRAIN';

    const defaultLikelihood: Record<SourceHypothesisType, number> = hasFlare
      ? { GAS_FLARE: 0.85, INDUSTRIAL_FIRE: 0.08, AGRICULTURAL_BURN: 0.01, WILDFIRE_VEGETATION: 0.01, OTHER: 0.05 }
      : hasTank
      ? { GAS_FLARE: 0.12, INDUSTRIAL_FIRE: 0.78, AGRICULTURAL_BURN: 0.01, WILDFIRE_VEGETATION: 0.01, OTHER: 0.08 }
      : { GAS_FLARE: 0.01, INDUSTRIAL_FIRE: 0.03, AGRICULTURAL_BURN: 0.52, WILDFIRE_VEGETATION: 0.42, OTHER: 0.02 };

    resolvedItem = {
      evidence_id: evidenceInput.evidence_id || 'EVID-OSM-INFRASTRUCTURE',
      source: 'OPENSTREETMAP_OVERPASS_API',
      evidence_type: 'OPENSTREETMAP_INFRASTRUCTURE_CONTEXT',
      outcome_id: evidenceInput.outcome_id || outcomeId,
      title: evidenceInput.title || `OSM Infrastructure Context (${elements.length} features mapped)`,
      description:
        evidenceInput.description ||
        `Overpass query returned ${elements.length} industrial elements. Flare infrastructure: ${hasFlare ? 'PRESENT' : 'NOT_MAPPED'}; Storage tanks: ${hasTank ? 'PRESENT' : 'NOT_MAPPED'}.`,
      value: osmVal,
      timestamp: now,
      provenance: evidenceInput.provenance || 'REAL',
      reliability: evidenceInput.reliability || 'HIGH',
      applicability: 'Physical equipment verification (flare stacks, fuel storage tanks, process furnaces).',
      affected_hypotheses: ['GAS_FLARE', 'INDUSTRIAL_FIRE', 'AGRICULTURAL_BURN', 'WILDFIRE_VEGETATION'],
      likelihood_by_hypothesis: evidenceInput.likelihood_by_hypothesis || defaultLikelihood,
      is_incorporated: true,
      incorporation_rationale: 'Mapped ground infrastructure corroborates physical plant installations.',
    };
  } else if (candidateKey.includes('WEATHER') || candidateKey.includes('WIND')) {
    let weatherVal = evidenceInput.value;
    if (!weatherVal) {
      weatherVal = await getHistoricalWeatherContext({ lat, lon, timestamp: obsTimestamp });
    }
    const windSpeed = weatherVal?.current?.wind_speed_10m || weatherVal?.wind_speed_kmh || 0;
    const humidity = weatherVal?.current?.relative_humidity_2m || weatherVal?.relative_humidity_pct || 50;

    const outcomeId = (windSpeed > 25 && humidity < 30)
      ? 'HIGH_VENTILATION_STRONG_WINDS'
      : (windSpeed < 5)
      ? 'STAGNANT_CALM_AIR'
      : 'MODERATE_STABLE_CONDITIONS';

    const defaultLikelihood: Record<SourceHypothesisType, number> = (windSpeed > 25 && humidity < 30)
      ? { GAS_FLARE: 0.20, INDUSTRIAL_FIRE: 0.35, AGRICULTURAL_BURN: 0.20, WILDFIRE_VEGETATION: 0.20, OTHER: 0.05 }
      : (windSpeed < 5)
      ? { GAS_FLARE: 0.25, INDUSTRIAL_FIRE: 0.15, AGRICULTURAL_BURN: 0.20, WILDFIRE_VEGETATION: 0.10, OTHER: 0.30 }
      : { GAS_FLARE: 0.25, INDUSTRIAL_FIRE: 0.20, AGRICULTURAL_BURN: 0.20, WILDFIRE_VEGETATION: 0.20, OTHER: 0.15 };

    resolvedItem = {
      evidence_id: evidenceInput.evidence_id || 'EVID-WEATHER-ATMOSPHERIC',
      source: 'OPEN_METEO_HISTORICAL_API',
      evidence_type: 'ATMOSPHERIC_WIND_WEATHER',
      outcome_id: evidenceInput.outcome_id || outcomeId,
      title: evidenceInput.title || `Surface Weather (Wind: ${windSpeed.toFixed(1)} km/h, Humidity: ${humidity}%)`,
      description:
        evidenceInput.description ||
        `Surface wind: ${windSpeed.toFixed(1)} km/h, relative humidity: ${humidity}%, temp: ${weatherVal?.current?.temperature_2m || 25}°C.`,
      value: weatherVal,
      timestamp: now,
      provenance: evidenceInput.provenance || 'REAL',
      reliability: 'HIGH',
      applicability: 'Governs combustion dispersion and atmospheric open-air flame propagation conditions.',
      affected_hypotheses: ['INDUSTRIAL_FIRE', 'WILDFIRE_VEGETATION', 'AGRICULTURAL_BURN'],
      likelihood_by_hypothesis: evidenceInput.likelihood_by_hypothesis || defaultLikelihood,
      is_incorporated: true,
      incorporation_rationale: 'Local atmospheric reanalysis informs combustion spread risks.',
    };
  } else if (candidateKey.includes('PERSISTENCE') || candidateKey.includes('TEMPORAL')) {
    const persistenceVal = evaluateTemporalPersistence(lat, lon);
    const isPersistent = persistenceVal.status === 'PERSISTENT' || persistenceVal.is_persistent;
    const isRecurrent = persistenceVal.status === 'RECURRENT';

    const outcomeId = isPersistent
      ? 'PERSISTENT_MULTI_DAY_HOTSPOT'
      : isRecurrent
      ? 'INTERMITTENT_PULSING_HOTSPOT'
      : 'TRANSIENT_DISSIPATED_HOTSPOT';

    const defaultLikelihood: Record<SourceHypothesisType, number> = isPersistent
      ? { GAS_FLARE: 0.82, INDUSTRIAL_FIRE: 0.08, AGRICULTURAL_BURN: 0.04, WILDFIRE_VEGETATION: 0.02, OTHER: 0.04 }
      : isRecurrent
      ? { GAS_FLARE: 0.65, INDUSTRIAL_FIRE: 0.10, AGRICULTURAL_BURN: 0.10, WILDFIRE_VEGETATION: 0.05, OTHER: 0.10 }
      : { GAS_FLARE: 0.08, INDUSTRIAL_FIRE: 0.45, AGRICULTURAL_BURN: 0.40, WILDFIRE_VEGETATION: 0.05, OTHER: 0.02 };

    resolvedItem = {
      evidence_id: evidenceInput.evidence_id || 'EVID-TEMPORAL-PERSISTENCE',
      source: 'MULTI_PASS_TEMPORAL_PERSISTENCE_ENGINE',
      evidence_type: 'MULTI_PASS_TEMPORAL_PERSISTENCE',
      outcome_id: evidenceInput.outcome_id || outcomeId,
      title: evidenceInput.title || `Temporal Multi-Pass Persistence (${persistenceVal.status})`,
      description:
        evidenceInput.description ||
        `${persistenceVal.cluster_observation_count} multi-pass detections across observation history. Night pass ratio: ${(persistenceVal.night_fraction * 100).toFixed(0)}%. ${persistenceVal.summary}`,
      value: persistenceVal,
      timestamp: now,
      provenance: evidenceInput.provenance || 'REAL',
      reliability: 'HIGH',
      applicability: 'Separates chronic stationary process flaring from transient short-duration fire incidents.',
      affected_hypotheses: ['GAS_FLARE', 'INDUSTRIAL_FIRE', 'AGRICULTURAL_BURN', 'WILDFIRE_VEGETATION'],
      likelihood_by_hypothesis: evidenceInput.likelihood_by_hypothesis || defaultLikelihood,
      is_incorporated: true,
      incorporation_rationale: 'Stationary temporal recurrence strongly corroborates permanent combustion installations.',
    };
  } else {
    // Custom or explicit evidence item
    resolvedItem = {
      evidence_id: evidenceInput.evidence_id || `EVID-${Date.now()}`,
      source: evidenceInput.candidate_id || evidenceInput.evidence_type || 'EXPLICIT_INVESTIGATION_EVIDENCE',
      evidence_type: evidenceInput.evidence_type || 'CONTEXTUAL_EVIDENCE',
      outcome_id: evidenceInput.outcome_id,
      outcome_name: evidenceInput.outcome_name,
      title: evidenceInput.title || 'Investigator Incorporated Evidence Layer',
      description: evidenceInput.description || 'Incorporated evidence item for hypothesis discrimination.',
      value: evidenceInput.value ?? {},
      timestamp: now,
      provenance: evidenceInput.provenance || 'CONTROLLED',
      reliability: evidenceInput.reliability || 'HIGH',
      applicability: evidenceInput.applicability || 'Case-specific hypothesis discrimination.',
      affected_hypotheses: evidenceInput.affected_hypotheses || ALL_CANDIDATE_HYPOTHESES,
      likelihood_by_hypothesis: evidenceInput.likelihood_by_hypothesis || {
        GAS_FLARE: 0.20,
        INDUSTRIAL_FIRE: 0.20,
        AGRICULTURAL_BURN: 0.20,
        WILDFIRE_VEGETATION: 0.20,
        OTHER: 0.20,
      },
      is_incorporated: true,
      incorporation_rationale: evidenceInput.incorporation_rationale || 'Explicit evidence layer added by investigator.',
    };
  }

  // 3. Update applied evidence list (avoid duplicates)
  const existingApplied = currentCase.applied_evidence_items ? [...currentCase.applied_evidence_items] : [];
  const existingIndex = existingApplied.findIndex((e) => e.evidence_id === resolvedItem.evidence_id);
  if (existingIndex >= 0) {
    existingApplied[existingIndex] = resolvedItem;
  } else {
    existingApplied.push(resolvedItem);
  }
  const appliedIds = Array.from(
    new Set([
      ...(currentCase.applied_evidence_ids || []),
      resolvedItem.evidence_id,
    ].filter(Boolean))
  );

  // 4. Pass into evidence fusion engine using initial T0 distribution
  const initialDistribution = currentCase.initial_assessment_snapshot.hypotheses_distribution;
  const fusionResult = fuseEvidenceAndAssessUncertainty({
    initialDistribution,
    evidenceItems: existingApplied,
    mlDiscriminator: currentCase.evidence_assessment.radiometric_discriminator,
    appliedEvidenceIds: appliedIds,
  });

  // 5. Calculate Posterior State
  const posteriorDistribution: Record<SourceHypothesisType, number> = {
    GAS_FLARE: 0,
    INDUSTRIAL_FIRE: 0,
    AGRICULTURAL_BURN: 0,
    WILDFIRE_VEGETATION: 0,
    OTHER: 0,
  };
  for (const h of fusionResult.fused_hypotheses) {
    posteriorDistribution[h.hypothesis] = h.percentage;
  }
  const entropyAfter = fusionResult.initial_vs_current.current_assessment.entropy_bits;
  const stepEntropyDelta = Math.round((entropyBefore - entropyAfter) * 1000) / 1000;
  const stepUncertaintyReduction = entropyBefore > 0
    ? Math.round(((entropyBefore - entropyAfter) / entropyBefore) * 1000) / 10
    : 0;

  // 6. Recalculate Structured Conflict
  const structuredConflict = detectStructuredEvidenceConflict(
    fusionResult.fused_hypotheses,
    currentCase.evidence_assessment.radiometric_discriminator
  );

  // 7. Recalculate NBE Recommendations with updated distribution & entropy
  const updatedNbeResult = evaluateRealNextBestEvidence({
    obs: {
      id: currentCase.firms_observation_id,
      frp: currentCase.frp,
      coordinates: currentCase.coordinates,
      satellite: currentCase.satellite,
      confidence: currentCase.confidence,
    },
    facility: currentCase.spatial_assessment.matched_facility as any,
    baseline: (currentCase.behaviour_assessment.baseline_metrics as any)
      ? ({
          metrics: currentCase.behaviour_assessment.baseline_metrics,
          baseline_status: currentCase.behaviour_assessment.baseline_status,
          baseline_period: currentCase.behaviour_assessment.baseline_period || { start_date: '', end_date: '', total_days: 0 },
        } as any)
      : null,
    observedZone:
      currentCase.spatial_assessment.distance_to_observed_activity_zone_meters !== null
        ? JAMNAGAR_OBSERVED_ACTIVITY_ZONES[0]
        : null,
    spatialAssociation: currentCase.spatial_assessment.spatial_classification,
    behaviouralStatus: currentCase.behaviour_assessment.behavioural_status,
    sourceHypotheses: {
      status_label: 'Normalized Heuristic Support — Prototype Contextual Assessment',
      disclaimer: 'Posterior distribution evaluated post-evidence fusion.',
      primary_hypothesis: fusionResult.primary_hypothesis,
      primary_hypothesis_type: fusionResult.primary_hypothesis_type,
      alternative_hypotheses: fusionResult.fused_hypotheses.slice(1).map((h) => `${h.label} (${h.percentage}%)`),
      hypotheses_distribution: fusionResult.fused_hypotheses as any,
      basis: 'Initial Contextual Prior + Incorporated Evidence Layers',
    },
    uncertainty: fusionResult.uncertainty,
    priority: currentCase.investigation_priority,
    distToObservedZone: currentCase.spatial_assessment.distance_to_observed_activity_zone_meters,
    distToConfiguredZone: currentCase.spatial_assessment.distance_to_nearest_configured_zone_meters,
    appliedEvidenceIds: appliedIds,
  });

  // 8. Recalculate Priority Score
  const updatedPriority = calculateInvestigationPriority(
    currentCase.frp,
    currentCase.behaviour_assessment.behavioural_status,
    currentCase.spatial_assessment.spatial_classification,
    null,
    currentCase.spatial_assessment.distance_to_nearest_configured_zone_meters,
    currentCase.confidence,
    {
      normalized_entropy: fusionResult.uncertainty.normalized_entropy,
      entropy_bits: entropyAfter,
    }
  );

  // 9. Create EvidenceEffectRecord
  const effectRecord: EvidenceEffectRecord = {
    evidence_id: resolvedItem.evidence_id,
    evidence_title: resolvedItem.title,
    evidence_type: resolvedItem.evidence_type,
    affected_hypotheses: resolvedItem.affected_hypotheses,
    direction_of_influence: resolvedItem.direction_of_influence,
    strength_of_influence: resolvedItem.strength_of_influence,
    prior_distribution: priorDistribution,
    posterior_distribution: posteriorDistribution,
    entropy_before: entropyBefore,
    entropy_after: entropyAfter,
    entropy_delta: stepEntropyDelta,
    uncertainty_reduction_percentage: stepUncertaintyReduction,
    provenance: resolvedItem.provenance,
    timestamp: now,
    incorporation_step: 'T7',
  };

  const updatedEffectsHistory = [...(currentCase.evidence_effects_history || []), effectRecord];

  // 10. Append Timeline Events
  const currentTimeline = [...(currentCase.timeline || [])];
  let nextIdx = currentTimeline.length;

  const topHypoLabel =
    HYPOTHESIS_DISPLAY_LABELS[fusionResult.primary_hypothesis_type] || fusionResult.primary_hypothesis_type;
  const topPct = posteriorDistribution[fusionResult.primary_hypothesis_type];

  // T6: Evidence Selected
  currentTimeline.push({
    step_index: nextIdx++,
    step_code: 'T6',
    event_type: 'EVIDENCE_SELECTED',
    title: `Evidence Candidate Selected: ${resolvedItem.title}`,
    actor: 'Investigator',
    timestamp: now,
    summary: `Selected candidate '${resolvedItem.evidence_type}' for incorporation into active hypothesis fusion.`,
    details: {
      evidence_id: resolvedItem.evidence_id,
      evidence_type: resolvedItem.evidence_type,
      provenance: resolvedItem.provenance,
    },
  });

  // T7: Evidence Incorporated
  currentTimeline.push({
    step_index: nextIdx++,
    step_code: 'T7',
    event_type: 'EVIDENCE_INCORPORATED',
    title: `Evidence Layer Ingested (${resolvedItem.provenance} Provenance)`,
    actor: 'Evidence Fusion Engine',
    timestamp: new Date(Date.now() + 500).toISOString(),
    summary: `Incorporated ${resolvedItem.title}. Provenance validated as ${resolvedItem.provenance}. Strength deltas applied to candidate hypotheses.`,
    details: {
      strength_of_influence: resolvedItem.strength_of_influence,
      direction_of_influence: resolvedItem.direction_of_influence,
    },
  });

  // T8: Hypotheses Updated
  currentTimeline.push({
    step_index: nextIdx++,
    step_code: 'T8',
    event_type: 'HYPOTHESES_UPDATED',
    title: `Posterior Hypotheses Updated: ${topHypoLabel} (${topPct}%)`,
    actor: 'Contextual Multi-Hypothesis Engine',
    timestamp: new Date(Date.now() + 1000).toISOString(),
    summary: `Recalculated normalized posterior hypothesis distribution post-fusion. Leading candidate is ${topHypoLabel} (${topPct}%).`,
    details: {
      prior_distribution: priorDistribution,
      posterior_distribution: posteriorDistribution,
    },
  });

  // T9: Entropy Updated
  const entropyMsg =
    stepEntropyDelta >= 0
      ? `Entropy reduced from ${entropyBefore.toFixed(3)} to ${entropyAfter.toFixed(3)} bits (ΔH = +${stepEntropyDelta.toFixed(3)} bits, ${stepUncertaintyReduction}% reduction).`
      : `Entropy increased from ${entropyBefore.toFixed(3)} to ${entropyAfter.toFixed(3)} bits (ΔH = ${stepEntropyDelta.toFixed(3)} bits, ambiguity increased due to competing evidence).`;

  currentTimeline.push({
    step_index: nextIdx++,
    step_code: 'T9',
    event_type: 'ENTROPY_UPDATED',
    title: `Shannon Entropy Updated: ${entropyAfter.toFixed(3)} bits`,
    actor: 'Information & Uncertainty Engine',
    timestamp: new Date(Date.now() + 1500).toISOString(),
    summary: entropyMsg,
    details: {
      entropy_before: entropyBefore,
      entropy_after: entropyAfter,
      entropy_delta: stepEntropyDelta,
      uncertainty_reduction_percentage: stepUncertaintyReduction,
    },
  });

  // T10: Priority Updated
  currentTimeline.push({
    step_index: nextIdx++,
    step_code: 'T10',
    event_type: 'PRIORITY_UPDATED',
    title: `Investigation Triage Priority Updated: Score ${updatedPriority.score}/100 (${updatedPriority.level})`,
    actor: 'Operational Triage Engine',
    timestamp: new Date(Date.now() + 2000).toISOString(),
    summary: `Triage priority updated to ${updatedPriority.score}/100 (${updatedPriority.level}) reflecting posterior entropy and leading source probability.`,
    details: {
      priority_score: updatedPriority.score,
      priority_level: updatedPriority.level,
    },
  });

  // 11. Construct Updated Case
  const updatedCase: InvestigationCaseData = {
    ...currentCase,
    status: currentCase.status === 'RESOLVED' ? 'RESOLVED' : 'UNDER_INVESTIGATION',
    timeline: currentTimeline,
    evidence_effects_history: updatedEffectsHistory,
    applied_evidence_items: existingApplied,
    applied_evidence_ids: appliedIds,
    hypothesis_assessment: {
      ...currentCase.hypothesis_assessment,
      primary_hypothesis: fusionResult.primary_hypothesis,
      primary_hypothesis_type: fusionResult.primary_hypothesis_type,
      prior_distribution: currentCase.initial_assessment_snapshot.hypotheses_distribution,
      posterior_distribution: fusionResult.fused_hypotheses,
      fused_hypotheses: fusionResult.fused_hypotheses,
      initial_vs_current: fusionResult.initial_vs_current,
    },
    uncertainty_assessment: {
      ...fusionResult.uncertainty,
      initial_entropy_bits: currentCase.initial_assessment_snapshot.entropy_bits,
      current_entropy_bits: entropyAfter,
      entropy_delta_bits: fusionResult.initial_vs_current.entropy_delta_bits,
      uncertainty_reduction_percentage: fusionResult.initial_vs_current.uncertainty_reduction_percentage,
    },
    evidence_assessment: {
      ...currentCase.evidence_assessment,
      current_evidence: updatedNbeResult.currentEvidence,
      missing_evidence: updatedNbeResult.missingEvidence,
      all_candidates: updatedNbeResult.allCandidates,
      structured_conflict: structuredConflict,
      explicit_evidence_items: existingApplied,
    },
    nbe_assessment: {
      ...currentCase.nbe_assessment,
      recommended_available_evidence: updatedNbeResult.recommendedAvailableEvidence,
      recommended_external_evidence: updatedNbeResult.recommendedExternalEvidence,
      decision_explanation: updatedNbeResult.decisionExplanation,
      ranked_candidates: [...updatedNbeResult.allCandidates].sort(
        (a, b) => (b.prototypeInformationValueScore ?? 0) - (a.prototypeInformationValueScore ?? 0)
      ),
      target_ambiguity:
        updatedNbeResult.recommendedExternalEvidence?.target_ambiguity ||
        updatedNbeResult.recommendedExternalEvidence?.target_hypothesis_pair ||
        updatedNbeResult.recommendedExternalEvidence?.targetHypothesisPairs?.[0] ||
        'None (Evaluated / Saturated State)',
      current_entropy_bits: entropyAfter,
    },
    evidence_guided_investigation: updatedNbeResult,
    investigation_priority: updatedPriority,
    priorityLevel: updatedPriority.level,
    priorityScore: updatedPriority.score,
  };

  // Cache in activeCasesMap
  activeCasesMap.set(updatedCase.case_id, updatedCase);
  if (updatedCase.caseId) activeCasesMap.set(updatedCase.caseId, updatedCase);
  if (updatedCase.firms_observation_id) activeCasesMap.set(updatedCase.firms_observation_id, updatedCase);

  return updatedCase;
}

/**
 * Section 9: Formal Investigator Resolution
 * Records human investigator resolution separate from ML/heuristics and closes the case.
 */
export function resolveInvestigationCase(
  caseId: string,
  resolution: {
    verdict: SourceHypothesisType;
    confidence: number;
    notes: string;
    evidence_used?: string[];
    investigator_id?: string;
    provenance?: 'REAL' | 'CONTROLLED';
    resolution_type?: 'REAL_FIELD_INVESTIGATION' | 'CONTROLLED_SIMULATION_DEMO';
  }
): InvestigationCaseData {
  const currentCase = getOrCreateInvestigationCase(caseId);
  if (!currentCase) {
    throw new Error(`Investigation case ${caseId} not found`);
  }

  if (!ALL_CANDIDATE_HYPOTHESES.includes(resolution.verdict)) {
    throw new Error(`Invalid source hypothesis verdict: ${resolution.verdict}`);
  }

  const now = new Date().toISOString();
  const verdictLabel = HYPOTHESIS_DISPLAY_LABELS[resolution.verdict] || resolution.verdict;

  const resolutionRecord: InvestigatorResolution = {
    verdict: resolution.verdict,
    verdict_label: verdictLabel,
    confidence: Math.min(100, Math.max(0, Math.round(resolution.confidence))),
    notes: resolution.notes || 'Case formally concluded by investigator.',
    evidence_used: resolution.evidence_used || currentCase.applied_evidence_ids || [],
    investigator_id: resolution.investigator_id || 'SENIOR_INVESTIGATOR_01',
    resolved_at: now,
    status: 'RESOLVED',
    provenance: resolution.provenance || 'REAL',
    resolution_type: resolution.resolution_type || (resolution.provenance === 'CONTROLLED' ? 'CONTROLLED_SIMULATION_DEMO' : 'REAL_FIELD_INVESTIGATION'),
  };

  const currentTimeline = [...(currentCase.timeline || [])];
  currentTimeline.push({
    step_index: currentTimeline.length,
    step_code: 'T11',
    event_type: 'INVESTIGATOR_RESOLUTION',
    title: `Investigation Formally Resolved: ${verdictLabel} (${resolutionRecord.confidence}% Confidence)`,
    actor: resolutionRecord.investigator_id || 'Investigator',
    timestamp: now,
    summary: `Case closed with finding '${verdictLabel}'. Investigator confidence: ${resolutionRecord.confidence}%. ${resolutionRecord.notes}`,
    details: {
      verdict: resolutionRecord.verdict,
      verdict_label: verdictLabel,
      confidence: resolutionRecord.confidence,
      evidence_used: resolutionRecord.evidence_used,
      notes: resolutionRecord.notes,
    },
  });

  const resolutionStatus: InvestigationResolutionStatus =
    resolution.verdict === currentCase.hypothesis_assessment?.primary_hypothesis_type
      ? 'CONCURRED_WITH_PRIMARY'
      : resolution.verdict === 'OTHER' && (resolution.notes || '').toLowerCase().includes('false positive')
      ? 'CLOSED_FALSE_POSITIVE'
      : 'OVERRIDDEN_BY_OPERATOR';

  const updatedCase: InvestigationCaseData = {
    ...currentCase,
    status: 'RESOLVED',
    resolution_status: resolutionStatus,
    investigator_resolution: resolutionRecord,
    investigator_notes: resolution.notes,
    investigatorNotes: resolution.notes,
    timeline: currentTimeline,
    resolution: {
      finalVerdict: resolution.verdict,
      confidence: resolutionRecord.confidence,
      resolvedAt: now,
      actionRecommended:
        resolution.verdict === 'INDUSTRIAL_FIRE'
          ? 'High-priority alert dispatched to Industrial Safety Directorate & Refinery Incident Control Room.'
          : 'Routine flare log confirmed with process operations supervisor.',
    },
  };

  activeCasesMap.set(updatedCase.case_id, updatedCase);
  if (updatedCase.caseId) activeCasesMap.set(updatedCase.caseId, updatedCase);
  if (updatedCase.firms_observation_id) activeCasesMap.set(updatedCase.firms_observation_id, updatedCase);

  return updatedCase;
}

/**
 * Section 9: Reset Case back to pristine T0 baseline
 */
export function resetInvestigationCase(caseId: string): InvestigationCaseData {
  const currentCase = getOrCreateInvestigationCase(caseId);
  if (!currentCase) {
    throw new Error(`Investigation case ${caseId} not found`);
  }

  const cleanId = (currentCase.firms_observation_id || caseId).replace(/^CASE-/, '');
  let obs = getCachedObservationById(cleanId);
  if (!obs) {
    const filePath = path.join(process.cwd(), 'data', 'processed', 'FAC-GUJ-JAMNAGAR-01_historical_observations.json');
    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const allObs = JSON.parse(raw);
        obs = allObs.find((o: any) => o.id === cleanId || o.id === currentCase.firms_observation_id);
      } catch {}
    }
  }

  if (!obs) {
    obs = {
      id: currentCase.firms_observation_id,
      latitude: currentCase.coordinates[0],
      longitude: currentCase.coordinates[1],
      acquisition_time: currentCase.timestamp,
      satellite: currentCase.satellite || 'VIIRS-NPP',
      sensor: currentCase.satellite?.includes('MODIS') ? 'MODIS' : 'VIIRS',
      frp: currentCase.frp,
      confidence: currentCase.confidence || 'nominal',
      day_night: 'N',
      source_type: 'FIRMS',
      provenance: 'REAL_FIRMS',
      is_real_data: true,
    };
  }

  const spatialAssoc = findFacilitySpatialAssociation(obs.latitude, obs.longitude, MONITORED_FACILITIES);
  const matchedFacility = spatialAssoc.matched_facility;
  const facilityBaseline = matchedFacility ? getFacilityBaselineSync(matchedFacility.id) : null;

  const pristineCase = buildInvestigationCase(
    {
      ...obs,
      applied_evidence_ids: [],
      association_type: spatialAssoc.spatial_association,
      distance_to_facility_meters: spatialAssoc.facility_distance_meters,
      distance_to_zone_meters: spatialAssoc.distance_to_zone_meters,
      matched_zone_name: spatialAssoc.matched_zone?.name || null,
      is_inside_polygon: spatialAssoc.is_inside_polygon,
    },
    matchedFacility,
    facilityBaseline
  );

  const resetTimeline = [...pristineCase.timeline];
  resetTimeline.push({
    step_index: resetTimeline.length,
    step_code: 'T0',
    event_type: 'CASE_RESET',
    title: 'Investigation Reset to Pristine T0 Baseline',
    actor: 'Investigator',
    timestamp: new Date().toISOString(),
    summary: 'Case has been cleared of all provisional evidence and reset to pristine T0 assessment.',
  });

  pristineCase.timeline = resetTimeline;
  pristineCase.status = 'OPEN';

  activeCasesMap.set(pristineCase.case_id, pristineCase);
  if (pristineCase.caseId) activeCasesMap.set(pristineCase.caseId, pristineCase);
  if (pristineCase.firms_observation_id) activeCasesMap.set(pristineCase.firms_observation_id, pristineCase);

  return pristineCase;
}

/**
 * Loads real observations and dynamically constructs a diverse 12-case Priority Triage Queue
 */
export function getInvestigationQueue(): InvestigationCaseData[] {
  const jamnagarBaseline = getFacilityBaselineSync('FAC-GUJ-JAMNAGAR-01');
  const jamnagarFacility = MONITORED_FACILITIES.find((f) => f.id === 'FAC-GUJ-JAMNAGAR-01') || null;

  const candidateCases: InvestigationCaseData[] = [];
  const benchmarkCases: InvestigationCaseData[] = [];

  // 1. Gather Jamnagar Benchmark Cases from local processed store
  const filePath = path.join(process.cwd(), 'data', 'processed', 'FAC-GUJ-JAMNAGAR-01_historical_observations.json');
  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const allObs = JSON.parse(raw);

      // Primary benchmark case HIST-20260225-N-261 (Anomalous, FRP 11.97 MW)
      const targetCaseObs = allObs.find((o: any) => o.id === 'HIST-20260225-N-261');
      if (targetCaseObs) {
        benchmarkCases.push(buildInvestigationCase(targetCaseObs, jamnagarFacility, jamnagarBaseline));
      }

      // Other curated benchmark cases
      const hist20 = allObs.find((o: any) => o.id === 'HIST-20260109-N20-20');
      if (hist20) {
        benchmarkCases.push(buildInvestigationCase(hist20, null, null));
      }

      const hist13 = allObs.find((o: any) => o.id === 'HIST-20260107-N20-13');
      if (hist13) {
        benchmarkCases.push(buildInvestigationCase(hist13, jamnagarFacility, jamnagarBaseline));
      }

      // Populate candidate pool with distinct real observations (high FRP, anomalous, elevated, and unassociated)
      const otherObs = allObs.filter((o: any) => !benchmarkCases.some((b) => b.firms_observation_id === o.id));
      for (const o of otherObs) {
        const fac = o.associated_facility_id === 'FAC-GUJ-JAMNAGAR-01' ? jamnagarFacility : null;
        const bLine = fac ? jamnagarBaseline : null;
        candidateCases.push(buildInvestigationCase(o, fac, bLine));
      }
    } catch (e) {
      console.error('Error constructing benchmark investigation cases:', e);
    }
  }

  // 2. Gather Real Detections from Global Live Cache across all regions
  const cachedLive = getAllCachedObservations();
  if (cachedLive && cachedLive.length > 0) {
    for (const obs of cachedLive) {
      const spatialAssoc = findFacilitySpatialAssociation(obs.latitude, obs.longitude, MONITORED_FACILITIES);
      const matchedFacility = spatialAssoc.matched_facility;
      const facilityBaseline = matchedFacility ? getFacilityBaselineSync(matchedFacility.id) : null;

      const cCase = buildInvestigationCase(
        {
          ...obs,
          association_type: spatialAssoc.spatial_association,
          distance_to_facility_meters: spatialAssoc.facility_distance_meters,
          distance_to_zone_meters: spatialAssoc.distance_to_zone_meters,
          matched_zone_name: spatialAssoc.matched_zone?.name || null,
          is_inside_polygon: spatialAssoc.is_inside_polygon,
        },
        matchedFacility,
        facilityBaseline
      );
      candidateCases.push(cCase);
    }
  }

  // 3. Apply Diversity & Triage Priority Selection (Target: 12 cases max)
  const finalCases: InvestigationCaseData[] = [];
  const addedIds = new Set<string>();

  for (const bCase of benchmarkCases) {
    // Check if active modified version exists
    const active = activeCasesMap.get(bCase.case_id) || activeCasesMap.get(bCase.firms_observation_id) || bCase;
    finalCases.push(active);
    addedIds.add(bCase.firms_observation_id);
    addedIds.add(bCase.case_id);
  }

  // Sort candidate pool by priority score descending
  candidateCases.sort((a, b) => (b.investigation_priority?.score ?? 0) - (a.investigation_priority?.score ?? 0));

  // Partition candidates to prevent single-facility or single-cluster dominance
  const entityCount: Record<string, number> = {
    'FAC-GUJ-JAMNAGAR-01': benchmarkCases.filter((c) => c.associated_facility?.id === 'FAC-GUJ-JAMNAGAR-01').length,
  };

  const MAX_PER_ENTITY = 2;

  for (const candidate of candidateCases) {
    if (finalCases.length >= 12) break;
    if (addedIds.has(candidate.firms_observation_id) || addedIds.has(candidate.case_id)) continue;

    const entityKey = candidate.associated_facility?.id ||
      `UNASSOC_${Math.floor((candidate.coordinates?.[0] || 0) / 1.5)}_${Math.floor((candidate.coordinates?.[1] || 0) / 1.5)}`;

    const currentCount = entityCount[entityKey] || 0;
    if (currentCount < MAX_PER_ENTITY) {
      const active = activeCasesMap.get(candidate.case_id) || activeCasesMap.get(candidate.firms_observation_id) || candidate;
      finalCases.push(active);
      addedIds.add(candidate.firms_observation_id);
      addedIds.add(candidate.case_id);
      entityCount[entityKey] = currentCount + 1;
    }
  }

  // If still slots remaining (< 12), fill with next highest priority candidates
  if (finalCases.length < 12) {
    for (const candidate of candidateCases) {
      if (finalCases.length >= 12) break;
      if (!addedIds.has(candidate.firms_observation_id) && !addedIds.has(candidate.case_id)) {
        const active = activeCasesMap.get(candidate.case_id) || activeCasesMap.get(candidate.firms_observation_id) || candidate;
        finalCases.push(active);
        addedIds.add(candidate.firms_observation_id);
        addedIds.add(candidate.case_id);
      }
    }
  }

  // Sort final queue by priority score descending
  finalCases.sort((a, b) => (b.investigation_priority?.score ?? 0) - (a.investigation_priority?.score ?? 0));

  return finalCases;
}

/**
 * Retrieves an existing investigation case by ID or dynamically constructs an InvestigationCaseData for ANY valid FIRMS observation
 */
export function getOrCreateInvestigationCase(targetId: string, customObs?: any): InvestigationCaseData | null {
  if (!targetId) return null;

  // Check active state store first
  const existingActive = activeCasesMap.get(targetId) || activeCasesMap.get(`CASE-${targetId}`) || activeCasesMap.get(targetId.replace(/^CASE-/, ''));
  if (existingActive) return existingActive;

  const queue = getInvestigationQueue();
  const matched = queue.find(
    (c) =>
      c.case_id === targetId ||
      c.caseId === targetId ||
      c.firms_observation_id === targetId ||
      c.primaryEventId === targetId
  );
  if (matched) {
    activeCasesMap.set(matched.case_id, matched);
    return matched;
  }

  const cleanId = targetId.replace(/^CASE-/, '');

  let obs: any = customObs || getCachedObservationById(cleanId) || getCachedObservationById(targetId);

  if (!obs) {
    const filePath = path.join(process.cwd(), 'data', 'processed', 'FAC-GUJ-JAMNAGAR-01_historical_observations.json');
    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const allObs = JSON.parse(raw);
        obs = allObs.find((o: any) => o.id === cleanId || o.id === targetId);
      } catch {}
    }
  }

  if (!obs) return null;

  // Associate observation with monitored facilities
  const spatialAssoc = findFacilitySpatialAssociation(obs.latitude, obs.longitude, MONITORED_FACILITIES);
  const matchedFacility = spatialAssoc.matched_facility;
  const facilityBaseline = matchedFacility ? getFacilityBaselineSync(matchedFacility.id) : null;

  const built = buildInvestigationCase(
    {
      ...obs,
      association_type: spatialAssoc.spatial_association,
      distance_to_facility_meters: spatialAssoc.facility_distance_meters,
      distance_to_zone_meters: spatialAssoc.distance_to_zone_meters,
      matched_zone_name: spatialAssoc.matched_zone?.name || null,
      is_inside_polygon: spatialAssoc.is_inside_polygon,
    },
    matchedFacility,
    facilityBaseline
  );

  activeCasesMap.set(built.case_id, built);
  if (built.caseId) activeCasesMap.set(built.caseId, built);
  if (built.firms_observation_id) activeCasesMap.set(built.firms_observation_id, built);

  return built;
}
