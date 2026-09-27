import { Facility, KnownThermalZone, SpatialAssociationType, BehaviouralStatus, FacilityThermalProfile } from '../types';

export function getCategoryBaselineProfile(category?: string, facilityId?: string): FacilityThermalProfile {
  const cat = (category || '').toLowerCase();
  let median = 18.0;
  let p25 = 10.5;
  let p75 = 26.0;
  let maxNormal = 42.0;

  if (cat.includes('petrochem')) {
    median = 15.2; p25 = 8.8; p75 = 22.4; maxNormal = 36.0;
  } else if (cat.includes('steel') || cat.includes('iron')) {
    median = 22.0; p25 = 12.8; p75 = 31.0; maxNormal = 48.0;
  } else if (cat.includes('smelter') || cat.includes('metal') || cat.includes('aluminium') || cat.includes('copper')) {
    median = 19.0; p25 = 11.2; p75 = 27.5; maxNormal = 44.0;
  } else if (cat.includes('power') || cat.includes('thermal')) {
    median = 25.0; p25 = 14.0; p75 = 36.0; maxNormal = 55.0;
  } else if (cat.includes('chem') || cat.includes('fertilizer')) {
    median = 12.0; p25 = 6.8; p75 = 17.5; maxNormal = 29.0;
  } else if (cat.includes('lng') || cat.includes('gas') || cat.includes('terminal')) {
    median = 8.5; p25 = 4.8; p75 = 13.0; maxNormal = 22.5;
  }

  if (facilityId) {
    let hashVal = 0;
    for (let i = 0; i < facilityId.length; i++) {
      hashVal = (hashVal * 31 + facilityId.charCodeAt(i)) % 1000;
    }
    const mod = 0.92 + (hashVal % 17) * 0.01;
    median = Math.round(median * mod * 10) / 10;
    p25 = Math.round(p25 * mod * 10) / 10;
    p75 = Math.round(p75 * mod * 10) / 10;
    maxNormal = Math.round(maxNormal * mod * 10) / 10;
  }

  return {
    typicalDetectionsPerDay: { min: 2, avg: 4.5, max: 8 },
    typicalFrpMw: { p25, median, p75, maxNormal },
    durationHours: { avg: 2.0, max: 4.0 },
    historicalObservationDays: 120,
    knownZoneCoveragePercent: 90,
    flareFootprintRadiusMeters: 450,
    diurnalDistribution: Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      probability: (h < 6 || h >= 19) ? 0.72 : 0.48,
      avgFrp: median,
    })),
  };
}

export function calculateDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3; // Earth radius in meters
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

export function isPointInPolygon(
  point: [number, number],
  polygon: [number, number][]
): boolean {
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

export interface DeviationAnalysisResult {
  facilityId: string | null;
  facilityName: string | null;
  distanceToFacilityMeters: number;
  isInsideFacilityPolygon: boolean;
  matchedZone: KnownThermalZone | null;
  distanceToClosestZoneMeters: number;
  isInsideKnownZone: boolean;
  intensityDeltaPct: number;
  diurnalProbability: number;
  isDiurnallyAbnormal: boolean;
  newZoneDetected: boolean;
  spatialAssociation: SpatialAssociationType;
  behaviouralStatus: BehaviouralStatus;
  deviationStatus: 'NORMAL' | 'ELEVATED' | 'ANOMALOUS' | 'NOT_ASSESSED' | 'MODERATE_DEVIATION' | 'HIGH_DEVIATION';
  historicalMatchScore: number; // 0 to 100
  explanation: string;
}

export function analyzeThermalDeviation(
  lat: number,
  lng: number,
  frp: number,
  acquisitionTimeIso: string,
  facilities: Facility[]
): DeviationAnalysisResult {
  const date = new Date(acquisitionTimeIso);
  const hour = isNaN(date.getUTCHours()) ? 12 : date.getUTCHours();

  let matchedFacility: Facility | null = null;
  let isInsideBoundary = false;
  let minBoundaryDist = Infinity;
  let minCenterDist = Infinity;

  // 1. Spatial Match against Facilities
  for (const fac of facilities) {
    const insidePoly = isPointInPolygon([lat, lng], fac.polygon);
    const distCenter = calculateDistanceMeters(lat, lng, fac.center[0], fac.center[1]);
    const distBoundary = insidePoly ? 0 : distanceToPolygonBoundaryMeters(lat, lng, fac.polygon);
    const bufferMeters = (fac.bufferRadiusKm || 3.0) * 1000;

    if (insidePoly) {
      if (!isInsideBoundary || distCenter < minCenterDist) {
        matchedFacility = fac;
        isInsideBoundary = true;
        minBoundaryDist = 0;
        minCenterDist = distCenter;
      }
    } else if (!isInsideBoundary && (distBoundary <= bufferMeters || distCenter <= bufferMeters)) {
      if (distBoundary < minBoundaryDist) {
        matchedFacility = fac;
        isInsideBoundary = false;
        minBoundaryDist = distBoundary;
        minCenterDist = distCenter;
      }
    }
  }

  // Case 1: UNASSOCIATED
  if (!matchedFacility) {
    return {
      facilityId: null,
      facilityName: null,
      distanceToFacilityMeters: minBoundaryDist !== Infinity ? minBoundaryDist : 0,
      isInsideFacilityPolygon: false,
      matchedZone: null,
      distanceToClosestZoneMeters: Infinity,
      isInsideKnownZone: false,
      intensityDeltaPct: 0,
      diurnalProbability: 1,
      isDiurnallyAbnormal: false,
      newZoneDetected: false,
      spatialAssociation: 'UNASSOCIATED',
      behaviouralStatus: 'NOT_ASSESSED',
      deviationStatus: 'NOT_ASSESSED',
      historicalMatchScore: 0,
      explanation: 'Thermal anomaly is outside monitored industrial facility footprints. No facility baseline exists; behavioural status is NOT_ASSESSED.',
    };
  }

  // 2. Zone Proximity check
  let closestZone: KnownThermalZone | null = null;
  let minZoneDist = Infinity;
  for (const zone of matchedFacility.knownThermalZones) {
    const dist = calculateDistanceMeters(lat, lng, zone.center[0], zone.center[1]);
    if (dist < minZoneDist) {
      minZoneDist = dist;
      closestZone = zone;
    }
  }

  const profile = matchedFacility.baselineProfile || getCategoryBaselineProfile(matchedFacility.category, matchedFacility.id);
  const isInsideKnownZone = minZoneDist <= (profile.flareFootprintRadiusMeters || 400);

  // 3. Intensity Deviation
  const medianFrp = profile.typicalFrpMw.median || 20;
  const intensityDeltaPct = Math.round(((frp - medianFrp) / medianFrp) * 100);

  // 4. Diurnal Profile Check
  const diurnalEntry = profile.diurnalDistribution.find((d) => d.hour === hour) || {
    hour,
    probability: 0.5,
    avgFrp: medianFrp,
  };
  const isDiurnallyAbnormal = diurnalEntry.probability < 0.45;

  // 5. Historical Match Score calculation (0 - 100)
  let score = 100;
  if (!isInsideKnownZone) {
    score -= Math.min(50, minZoneDist / 20);
  }
  if (intensityDeltaPct > 50) {
    score -= Math.min(35, (intensityDeltaPct - 50) * 0.4);
  }
  if (isDiurnallyAbnormal) {
    score -= 15;
  }
  const historicalMatchScore = Math.max(0, Math.min(100, Math.round(score)));

  // 6. Classification of Spatial Association & Behavioural Status
  let spatialAssociation: SpatialAssociationType = 'UNASSOCIATED';
  let behaviouralStatus: BehaviouralStatus = 'NOT_ASSESSED';
  let explanation = '';

  if (isInsideBoundary && isInsideKnownZone) {
    spatialAssociation = 'KNOWN_THERMAL_ZONE';
    if (historicalMatchScore < 45 || intensityDeltaPct > 100) {
      behaviouralStatus = 'ANOMALOUS';
      explanation = `ANOMALOUS FLARING: FRP (+${intensityDeltaPct}% above ${medianFrp} MW baseline) severely exceeds authorized threshold at ${closestZone?.name || 'Known Flare Zone'}.`;
    } else if (historicalMatchScore < 75 || intensityDeltaPct > 30) {
      behaviouralStatus = 'ELEVATED';
      explanation = `ELEVATED FLARING: Thermal output is +${intensityDeltaPct}% above typical baseline for ${closestZone?.name || 'Authorized Stack'}.`;
    } else {
      behaviouralStatus = 'NORMAL';
      explanation = `NORMAL OPERATIONAL BEHAVIOUR: Fully aligned with historical baseline for ${closestZone?.name || 'Flare Stack'}.`;
    }
  } else if (isInsideBoundary && !isInsideKnownZone) {
    spatialAssociation = 'FACILITY_OFF_ZONE';
    behaviouralStatus = 'ANOMALOUS';
    explanation = `HIGH BEHAVIOURAL ANOMALY: Observation located within ${matchedFacility.name} boundary but ${Math.round(minZoneDist)}m off-stack outside all registered thermal zones.`;
  } else {
    spatialAssociation = 'FACILITY_BUFFER';
    const isNearFence = minBoundaryDist <= 1500;
    if (isNearFence || frp > 40) {
      behaviouralStatus = 'ELEVATED';
      explanation = `ELEVATED BUFFER EVENT: Detected ${Math.round(minBoundaryDist)}m from facility perimeter; requires investigation for perimeter breach or external vegetation fire.`;
    } else {
      behaviouralStatus = 'NOT_ASSESSED';
      explanation = `BUFFER OBSERVATION (${Math.round(minBoundaryDist)}m from facility boundary, ${Math.round(minCenterDist)}m from center): External to facility fence line; lacks verifiable facility baseline.`;
    }
  }

  return {
    facilityId: matchedFacility.id,
    facilityName: matchedFacility.name,
    distanceToFacilityMeters: isInsideBoundary ? 0 : Math.round(minBoundaryDist),
    isInsideFacilityPolygon: isInsideBoundary,
    matchedZone: isInsideKnownZone ? closestZone : null,
    distanceToClosestZoneMeters: Math.round(minZoneDist),
    isInsideKnownZone,
    intensityDeltaPct,
    diurnalProbability: diurnalEntry.probability,
    isDiurnallyAbnormal,
    newZoneDetected: !isInsideKnownZone,
    spatialAssociation,
    behaviouralStatus,
    deviationStatus: behaviouralStatus,
    historicalMatchScore: behaviouralStatus === 'NOT_ASSESSED' ? 0 : historicalMatchScore,
    explanation,
  };
}
