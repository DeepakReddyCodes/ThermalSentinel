import {
  ServerFacility,
  ServerSpatialAssociation,
  SpatialAssociationType,
  BehaviouralStatus,
} from './types.js';
import { getFacilityBaselineSync } from './baselineRepository.js';
import { evaluateObservationAgainstBaseline } from './deviationEngine.js';
import { evaluateCanonicalHypotheses } from './hypothesisEngine.js';
import { evaluateTemporalPersistence } from './persistenceEngine.js';

/**
 * Computes geodesic distance between two points in meters using Haversine formula
 */
export function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000.0; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180.0;
  const dLon = ((lon2 - lon1) * Math.PI) / 180.0;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180.0) *
      Math.cos((lat2 * Math.PI) / 180.0) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Ray casting algorithm for point-in-polygon test
 */
export function isPointInPolygon(
  point: [number, number],
  polygon: [number, number][]
): boolean {
  if (!polygon || polygon.length < 3) return false;
  const [lat, lng] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];

    const intersect =
      yi > lng !== yj > lng && lat < ((xj - xi) * (lng - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Calculates perpendicular or endpoint geodesic distance in meters from point (pLat, pLon)
 * to line segment between (aLat, aLon) and (bLat, bLon).
 */
export function distancePointToSegmentMeters(
  pLat: number,
  pLon: number,
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number
): number {
  const R = 6371000.0;
  const rad = Math.PI / 180.0;
  const meanLat = ((aLat + bLat + pLat) / 3.0) * rad;
  const cosLat = Math.cos(meanLat);

  // Local equirectangular Cartesian projection
  const px = pLon * rad * cosLat * R;
  const py = pLat * rad * R;
  const ax = aLon * rad * cosLat * R;
  const ay = aLat * rad * R;
  const bx = bLon * rad * cosLat * R;
  const by = bLat * rad * R;

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    const dpx = px - ax;
    const dpy = py - ay;
    return Math.sqrt(dpx * dpx + dpy * dpy);
  }

  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const projX = ax + t * dx;
  const projY = ay + t * dy;

  const distSq = (px - projX) * (px - projX) + (py - projY) * (py - projY);
  return Math.sqrt(distSq);
}

/**
 * Calculates minimum distance in meters from a point to the perimeter of a polygon.
 */
export function distanceToPolygonBoundaryMeters(
  lat: number,
  lon: number,
  polygon: [number, number][]
): number {
  if (!polygon || polygon.length < 2) return Infinity;
  let minDist = Infinity;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [aLat, aLon] = polygon[j];
    const [bLat, bLon] = polygon[i];
    const d = distancePointToSegmentMeters(lat, lon, aLat, aLon, bLat, bLon);
    if (d < minDist) {
      minDist = d;
    }
  }

  return Math.round(minDist * 10) / 10;
}

export interface FacilitySpatialAssociationResult {
  is_associated: boolean;
  spatial_association: SpatialAssociationType;
  spatial_association_label: string;
  matched_facility: ServerFacility | null;
  facility_distance_meters: number | null;
  distance_to_center_meters: number | null;
  distance_to_boundary_meters: number | null;
  is_inside_polygon: boolean;
  matched_zone: ServerFacility['known_thermal_zones'][0] | null;
  distance_to_zone_meters: number | null;
  is_inside_known_zone: boolean;
  spatial_confidence: 'HIGH' | 'MODERATE' | 'LOW';
  reasons: string[];
}

/**
 * Evaluates geometric spatial relationship between observation coordinates and all monitored facilities
 */
export function findFacilitySpatialAssociation(
  lat: number,
  lon: number,
  facilities: ServerFacility[]
): FacilitySpatialAssociationResult {
  let matchedFacility: ServerFacility | null = null;
  let isInsideBoundary = false;
  let minBoundaryDist = Infinity;
  let minCenterDist = Infinity;

  // 1. Evaluate point against all facility geometries
  for (const fac of facilities) {
    const inside = isPointInPolygon([lat, lon], fac.polygon);
    const distToCenter = haversineDistanceMeters(lat, lon, fac.center[0], fac.center[1]);
    const distToBoundary = inside ? 0 : distanceToPolygonBoundaryMeters(lat, lon, fac.polygon);
    const bufferMeters = (fac.buffer_radius_km || 3.0) * 1000.0;

    if (inside) {
      if (!isInsideBoundary || distToCenter < minCenterDist) {
        matchedFacility = fac;
        isInsideBoundary = true;
        minBoundaryDist = 0;
        minCenterDist = distToCenter;
      }
    } else if (!isInsideBoundary && (distToBoundary <= bufferMeters || distToCenter <= bufferMeters)) {
      if (distToBoundary < minBoundaryDist) {
        matchedFacility = fac;
        isInsideBoundary = false;
        minBoundaryDist = distToBoundary;
        minCenterDist = distToCenter;
      }
    }
  }

  // Case A: UNASSOCIATED
  if (!matchedFacility) {
    return {
      is_associated: false,
      spatial_association: 'UNASSOCIATED',
      spatial_association_label: 'Unassociated Regional Hotspot',
      matched_facility: null,
      facility_distance_meters: null,
      distance_to_center_meters: null,
      distance_to_boundary_meters: null,
      is_inside_polygon: false,
      matched_zone: null,
      distance_to_zone_meters: null,
      is_inside_known_zone: false,
      spatial_confidence: 'HIGH',
      reasons: [
        `Observation location (${lat.toFixed(4)}°N, ${lon.toFixed(4)}°E) is outside all monitored industrial facility boundaries and perimeter buffers.`,
        'Geospatial classification: UNASSOCIATED regional thermal observation.',
      ],
    };
  }

  // Case B: Associated (evaluate known thermal zones)
  let closestZone: ServerFacility['known_thermal_zones'][0] | null = null;
  let minZoneDist = Infinity;

  if (matchedFacility.known_thermal_zones && matchedFacility.known_thermal_zones.length > 0) {
    for (const zone of matchedFacility.known_thermal_zones) {
      const zDist = haversineDistanceMeters(lat, lon, zone.center[0], zone.center[1]);
      if (zDist < minZoneDist) {
        minZoneDist = zDist;
        closestZone = zone;
      }
    }
  }

  const ZONE_TOLERANCE_METERS = (closestZone as any)?.radius_meters || 400.0;
  const isInsideKnownZone = isInsideBoundary && closestZone !== null && minZoneDist <= ZONE_TOLERANCE_METERS;

  let associationType: SpatialAssociationType = 'UNASSOCIATED';
  let associationLabel = '';
  let confidenceLevel: 'HIGH' | 'MODERATE' | 'LOW' = 'HIGH';
  const reasons: string[] = [];

  if (isInsideBoundary) {
    if (isInsideKnownZone) {
      associationType = 'KNOWN_THERMAL_ZONE';
      associationLabel = `Inside Facility Boundary (${closestZone?.name || 'Known Flare Zone'})`;
      confidenceLevel = 'HIGH';
      reasons.push(
        `Observation is inside ${matchedFacility.name} boundary polygon and within ${Math.round(minZoneDist)}m of ${closestZone?.name || 'known thermal zone'}.`
      );
    } else {
      associationType = 'FACILITY_OFF_ZONE';
      associationLabel = 'Inside Facility Boundary (Off-Zone / Novel Location)';
      confidenceLevel = 'MODERATE';
      reasons.push(
        `Observation is inside ${matchedFacility.name} boundary polygon, but offset ${closestZone ? `${Math.round(minZoneDist)}m from nearest configured stack (${closestZone.name})` : 'from configured zones'}.`
      );
    }
  } else {
    associationType = 'FACILITY_BUFFER';
    associationLabel = `Within Facility Buffer Envelope (${Math.round(minBoundaryDist)}m from perimeter)`;
    confidenceLevel = 'MODERATE';
    reasons.push(
      `Observation is in the perimeter buffer envelope of ${matchedFacility.name} (${Math.round(minBoundaryDist)}m from boundary, ${Math.round(minCenterDist)}m from facility center).`
    );
  }

  return {
    is_associated: true,
    spatial_association: associationType,
    spatial_association_label: associationLabel,
    matched_facility: matchedFacility,
    facility_distance_meters: isInsideBoundary ? 0 : Math.round(minBoundaryDist * 10) / 10,
    distance_to_center_meters: Math.round(minCenterDist * 10) / 10,
    distance_to_boundary_meters: Math.round(minBoundaryDist * 10) / 10,
    is_inside_polygon: isInsideBoundary,
    matched_zone: closestZone,
    distance_to_zone_meters: closestZone ? Math.round(minZoneDist * 10) / 10 : null,
    is_inside_known_zone: isInsideKnownZone,
    spatial_confidence: confidenceLevel,
    reasons,
  };
}

/**
 * Canonical Spatial Association & Evidence Assessment Pipeline.
 *
 * Distinct dimensions:
 * 1. SPATIAL ASSOCIATION: KNOWN_THERMAL_ZONE | FACILITY_OFF_ZONE | FACILITY_BUFFER | UNASSOCIATED
 * 2. BEHAVIOURAL STATUS: NORMAL | ELEVATED | ANOMALOUS | NOT_ASSESSED
 * 3. PERSISTENCE CONTEXT: NO_HISTORY | SINGLE_OBSERVATION | RECURRENT | PERSISTENT
 * 4. SOURCE HYPOTHESES: Dynamic evidence-driven normalized heuristic support
 * 5. UNCERTAINTY: Exact Shannon entropy H and normalized entropy H_norm
 * 6. INVESTIGATION PRIORITY: Operational triage score and tier
 */
export function associateObservationWithFacilities(
  lat: number,
  lon: number,
  frp: number,
  facilities: ServerFacility[],
  confidence: 'low' | 'nominal' | 'high' = 'nominal',
  additionalOptions?: {
    obsId?: string;
    dayNight?: 'D' | 'N';
    brightness_kelvin?: number;
    brightness_ti4?: number;
    brightness_ti5?: number;
    brightness_delta?: number;
    sensor?: string;
    satellite?: string;
    landCoverType?: string;
  }
): ServerSpatialAssociation {
  const spatialResult = findFacilitySpatialAssociation(lat, lon, facilities);
  const persistenceContext = evaluateTemporalPersistence(lat, lon, additionalOptions?.obsId);

  // Case 1: UNASSOCIATED (Outside all configured facility boundaries and buffer envelopes)
  if (!spatialResult.matched_facility) {
    const unassociatedAssessment = evaluateObservationAgainstBaseline(
      frp,
      'UNASSOCIATED',
      null,
      null,
      null,
      false,
      null,
      null
    );

    // Run canonical evidence-guided hypothesis calculation
    const assessmentResult = evaluateCanonicalHypotheses({
      frp,
      brightness_kelvin: additionalOptions?.brightness_kelvin,
      brightness_ti4: additionalOptions?.brightness_ti4,
      brightness_ti5: additionalOptions?.brightness_ti5,
      brightness_delta: additionalOptions?.brightness_delta,
      sensor: additionalOptions?.sensor || 'VIIRS',
      day_night: additionalOptions?.dayNight || 'D',
      confidence,
      satellite: additionalOptions?.satellite,
      spatial_association: 'UNASSOCIATED',
      distance_to_facility_meters: null,
      distance_to_zone_meters: null,
      facility_id: null,
      facility_name: null,
      matched_zone_name: null,
      is_inside_polygon: false,
      behavioural_status: 'NOT_ASSESSED',
      baseline: null,
      persistence_context: persistenceContext,
      land_cover_type: additionalOptions?.landCoverType || 'agricultural',
    });

    const hypothesesMap: Record<string, number> = {};
    for (const h of assessmentResult.source_hypotheses.hypotheses_distribution) {
      hypothesesMap[h.hypothesis] = h.percentage / 100;
    }

    const reasons = [
      'Observation is not spatially associated with a currently configured/monitored facility.',
      'Facility operational baseline is UNAVAILABLE; behavioural status is NOT_ASSESSED.',
      `Temporal persistence: ${persistenceContext.summary}`,
      `Leading explanation: ${assessmentResult.source_hypotheses.primary_hypothesis}`,
    ];

    return {
      associated: false,
      association_type: 'UNASSOCIATED',
      association_label: 'Unassociated Regional Hotspot',
      behavioural_status: 'NOT_ASSESSED',
      baseline_status: 'NONE',
      facility_id: null,
      facility_name: null,
      distance_meters: null,
      is_inside_polygon: false,
      is_inside_known_zone: false,
      matched_zone: null,
      distance_to_zone_meters: null,
      reasons,
      evaluation_parameters: unassociatedAssessment.evaluation_parameters,
      source_hypotheses: hypothesesMap as any,
      hypothesis_rationales: assessmentResult.hypothesis_rationales,
      uncertainty: {
        shannon_entropy_bits: assessmentResult.uncertainty.entropy_bits,
        normalized_entropy: assessmentResult.uncertainty.normalized_entropy,
        uncertainty_level: assessmentResult.uncertainty.uncertainty_level,
        scientific_explanation: assessmentResult.uncertainty.interpretation,
      },
      investigation_priority: {
        level: assessmentResult.investigation_priority.level,
        score: assessmentResult.investigation_priority.score,
        label: assessmentResult.investigation_priority.label,
        reasons: assessmentResult.investigation_priority.reasons,
      },
      notes: 'Observation is outside configured facility boundaries. Facility baseline is UNAVAILABLE (status: NOT_ASSESSED); universal evidence-guided source intelligence continues.',
    };
  }

  const closestFacility = spatialResult.matched_facility;
  const closestZone = spatialResult.matched_zone;
  const baseline = getFacilityBaselineSync(closestFacility.id);

  // Evaluate behavioural deviation against baseline
  const devAssessment = evaluateObservationAgainstBaseline(
    frp,
    spatialResult.spatial_association,
    spatialResult.distance_to_zone_meters,
    spatialResult.facility_distance_meters,
    closestZone ? closestZone.name : null,
    spatialResult.is_inside_polygon,
    closestFacility,
    baseline
  );

  // Run canonical evidence-guided hypothesis calculation
  const assessmentResult = evaluateCanonicalHypotheses({
    frp,
    brightness_kelvin: additionalOptions?.brightness_kelvin,
    brightness_ti4: additionalOptions?.brightness_ti4,
    brightness_ti5: additionalOptions?.brightness_ti5,
    brightness_delta: additionalOptions?.brightness_delta,
    sensor: additionalOptions?.sensor || 'VIIRS',
    day_night: additionalOptions?.dayNight || 'D',
    confidence,
    satellite: additionalOptions?.satellite,
    spatial_association: spatialResult.spatial_association,
    distance_to_facility_meters: spatialResult.facility_distance_meters,
    distance_to_zone_meters: spatialResult.distance_to_zone_meters,
    facility_id: closestFacility.id,
    facility_name: closestFacility.name,
    matched_zone_name: closestZone ? closestZone.name : null,
    is_inside_polygon: spatialResult.is_inside_polygon,
    behavioural_status: devAssessment.behavioural_status,
    baseline,
    persistence_context: persistenceContext,
    land_cover_type: spatialResult.is_inside_polygon ? 'industrial' : 'agricultural',
  });

  const hypothesesMap: Record<string, number> = {};
  for (const h of assessmentResult.source_hypotheses.hypotheses_distribution) {
    hypothesesMap[h.hypothesis] = h.percentage / 100;
  }

  return {
    associated: true,
    association_type: spatialResult.spatial_association,
    association_label: spatialResult.spatial_association_label,
    behavioural_status: devAssessment.behavioural_status,
    baseline_status: devAssessment.baseline_status,
    facility_id: closestFacility.id,
    facility_name: closestFacility.name,
    distance_meters: spatialResult.facility_distance_meters,
    is_inside_polygon: spatialResult.is_inside_polygon,
    is_inside_known_zone: spatialResult.is_inside_known_zone,
    matched_zone: closestZone ? closestZone.name : null,
    distance_to_zone_meters: spatialResult.distance_to_zone_meters,
    reasons: devAssessment.reasons,
    empirical_metrics: devAssessment.metrics,
    evaluation_parameters: devAssessment.evaluation_parameters,
    source_hypotheses: hypothesesMap as any,
    hypothesis_rationales: assessmentResult.hypothesis_rationales,
    uncertainty: {
      shannon_entropy_bits: assessmentResult.uncertainty.entropy_bits,
      normalized_entropy: assessmentResult.uncertainty.normalized_entropy,
      uncertainty_level: assessmentResult.uncertainty.uncertainty_level,
      scientific_explanation: assessmentResult.uncertainty.interpretation,
    },
    investigation_priority: {
      level: assessmentResult.investigation_priority.level,
      score: assessmentResult.investigation_priority.score,
      label: assessmentResult.investigation_priority.label,
      reasons: assessmentResult.investigation_priority.reasons,
    },
    notes: devAssessment.reasons.join(' | '),
  };
}
