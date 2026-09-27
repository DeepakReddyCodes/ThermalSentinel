import { ThermalEvent, SatelliteSensor, SpatialAssociationType, BehaviouralStatus, Facility } from '../types';
import { analyzeThermalDeviation } from './deviationEngine';

export interface FirmsQueryOptions {
  apiKey?: string;
  source: 'VIIRS_NOAA20_NRT' | 'VIIRS_SNPP_NRT' | 'MODIS_NRT';
  country?: string; // e.g. 'IND'
  areaCoordinates?: [number, number, number, number]; // [west, south, east, north]
  dayRange: number; // 1 to 10
}

/**
 * Parses raw NASA FIRMS CSV output into ThermalEvent records
 */
/**
 * Parses raw NASA FIRMS CSV output into validated, canonical ThermalEvent records
 */
export function parseFirmsCsv(csvText: string, facilities: Facility[]): ThermalEvent[] {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const latIdx = headers.indexOf('latitude');
  const lonIdx = headers.indexOf('longitude');
  const frpIdx = headers.indexOf('frp');
  const brightTi4Idx = headers.indexOf('bright_ti4');
  const brightIdx = headers.indexOf('brightness');
  const brightTi5Idx = headers.indexOf('bright_ti5');
  const brightT31Idx = headers.indexOf('bright_t31');
  const acqDateIdx = headers.indexOf('acq_date');
  const acqTimeIdx = headers.indexOf('acq_time');
  const confIdx = headers.indexOf('confidence');
  const dayNightIdx = headers.indexOf('daynight');
  const satIdx = headers.indexOf('satellite');
  const scanIdx = headers.indexOf('scan');
  const trackIdx = headers.indexOf('track');

  if (latIdx === -1 || lonIdx === -1) {
    throw new Error('Invalid FIRMS CSV: mandatory "latitude" and "longitude" headers not found.');
  }

  const events: ThermalEvent[] = [];
  const seenFingerprints = new Set<string>();

  for (let i = 1; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine) continue;
    const cols = rawLine.split(',').map((c) => c.trim());
    if (cols.length <= Math.max(latIdx, lonIdx)) continue;

    const latRaw = parseFloat(cols[latIdx]);
    const lonRaw = parseFloat(cols[lonIdx]);

    // Validation: bounds & finite numbers
    if (isNaN(latRaw) || isNaN(lonRaw) || !isFinite(latRaw) || !isFinite(lonRaw)) continue;
    if (latRaw < -90.0 || latRaw > 90.0 || lonRaw < -180.0 || lonRaw > 180.0) continue;

    const frpRaw = frpIdx !== -1 && !isNaN(parseFloat(cols[frpIdx])) ? parseFloat(cols[frpIdx]) : 0.0;
    if (frpRaw < 0 || frpRaw > 10000) continue;
    const frp = Math.round(frpRaw * 100) / 100;

    // Brightness fields (only extract if present in CSV, do NOT fabricate!)
    let brightnessTi4: number | undefined = undefined;
    if (brightTi4Idx !== -1 && cols[brightTi4Idx]) {
      const p = parseFloat(cols[brightTi4Idx]);
      if (!isNaN(p) && p >= 150 && p <= 600) brightnessTi4 = Math.round(p * 10) / 10;
    }

    let brightnessTi5: number | undefined = undefined;
    if (brightTi5Idx !== -1 && cols[brightTi5Idx]) {
      const p = parseFloat(cols[brightTi5Idx]);
      if (!isNaN(p) && p >= 150 && p <= 600) brightnessTi5 = Math.round(p * 10) / 10;
    }

    let brightnessT31: number | undefined = undefined;
    if (brightT31Idx !== -1 && cols[brightT31Idx]) {
      const p = parseFloat(cols[brightT31Idx]);
      if (!isNaN(p) && p >= 150 && p <= 600) brightnessT31 = Math.round(p * 10) / 10;
    }

    let brightnessPrimary: number | undefined = undefined;
    if (brightIdx !== -1 && cols[brightIdx]) {
      const p = parseFloat(cols[brightIdx]);
      if (!isNaN(p) && p >= 150 && p <= 600) brightnessPrimary = Math.round(p * 10) / 10;
    } else if (brightnessTi4 !== undefined) {
      brightnessPrimary = brightnessTi4;
    }

    const brightness = brightnessPrimary || 340.0;

    let brightnessDelta: number | undefined = undefined;
    if (brightnessTi4 !== undefined && brightnessTi5 !== undefined) {
      brightnessDelta = Math.round((brightnessTi4 - brightnessTi5) * 10) / 10;
    }

    let scan: number | undefined = undefined;
    if (scanIdx !== -1 && cols[scanIdx]) {
      const p = parseFloat(cols[scanIdx]);
      if (!isNaN(p) && p > 0 && p <= 10) scan = Math.round(p * 100) / 100;
    }

    let track: number | undefined = undefined;
    if (trackIdx !== -1 && cols[trackIdx]) {
      const p = parseFloat(cols[trackIdx]);
      if (!isNaN(p) && p > 0 && p <= 10) track = Math.round(p * 100) / 100;
    }
    
    // Parse and normalize time
    const dateStr = acqDateIdx !== -1 && cols[acqDateIdx] ? cols[acqDateIdx].trim() : '2026-09-01';
    const timeStr = acqTimeIdx !== -1 && cols[acqTimeIdx] ? cols[acqTimeIdx].replace(':', '').trim().padStart(4, '0') : '1200';
    const hour = timeStr.substring(0, 2);
    const minute = timeStr.substring(2, 4);
    const isoTime = `${dateStr}T${hour}:${minute}:00Z`;

    // Deduplicate
    const normLat = Number(latRaw.toFixed(5));
    const normLon = Number(lonRaw.toFixed(5));
    const satStr = satIdx !== -1 ? cols[satIdx].trim().toUpperCase() : 'VIIRS-NOAA20';
    const dedupeKey = `${normLat}_${normLon}_${isoTime}_${satStr}_${frp}`;
    if (seenFingerprints.has(dedupeKey)) continue;
    seenFingerprints.add(dedupeKey);

    const confRaw = confIdx !== -1 ? cols[confIdx].toLowerCase().trim() : 'nominal';
    const confNum = parseInt(confRaw, 10);
    const confidence: 'low' | 'nominal' | 'high' =
      confRaw === 'h' || confRaw === 'high' || (!isNaN(confNum) && confNum >= 80)
        ? 'high'
        : confRaw === 'l' || confRaw === 'low' || (!isNaN(confNum) && confNum < 40)
        ? 'low'
        : 'nominal';

    const dayNight: 'D' | 'N' = dayNightIdx !== -1 && cols[dayNightIdx].toUpperCase().trim() === 'N' ? 'N' : 'D';
    
    let satellite: SatelliteSensor = 'VIIRS-NOAA20';
    let sensor: 'VIIRS' | 'MODIS' = 'VIIRS';

    if (satStr.includes('SNPP') || satStr.includes('SUOMI')) {
      satellite = 'VIIRS-SNPP';
      sensor = 'VIIRS';
    } else if (satStr.includes('N21') || satStr.includes('NOAA21') || satStr.includes('NOAA-21') || satStr.includes('J2')) {
      satellite = 'VIIRS-NOAA21';
      sensor = 'VIIRS';
    } else if (satStr.includes('TERRA') || satStr === '1' || satStr === 'T') {
      satellite = 'MODIS-Terra';
      sensor = 'MODIS';
    } else if (satStr.includes('AQUA') || satStr === '2' || satStr === 'A') {
      satellite = 'MODIS-Aqua';
      sensor = 'MODIS';
    } else if (satStr.includes('MODIS')) {
      satellite = 'MODIS-Aqua';
      sensor = 'MODIS';
    } else {
      satellite = 'VIIRS-NOAA20';
      sensor = 'VIIRS';
    }

    // Run contextual analysis
    const dev = analyzeThermalDeviation(normLat, normLon, frp, isoTime, facilities);

    // Baseline probabilistic source hypotheses
    let gasFlareProb = 0.15;
    let fireProb = 0.20;
    let agriProb = 0.35;
    let wildProb = 0.20;
    let smelterProb = 0.05;
    let otherProb = 0.05;

    if (dev.facilityId) {
      if (dev.isInsideKnownZone) {
        gasFlareProb = 0.85;
        fireProb = 0.08;
        agriProb = 0.02;
        wildProb = 0.01;
        smelterProb = 0.03;
        otherProb = 0.01;
      } else {
        gasFlareProb = 0.48;
        fireProb = 0.43;
        agriProb = 0.04;
        wildProb = 0.02;
        smelterProb = 0.02;
        otherProb = 0.01;
      }
    }

    events.push({
      id: `FIRMS-${dateStr.replace(/-/g, '')}-${satellite.replace(/[^a-zA-Z0-9]/g, '')}-${i}`,
      latitude: normLat,
      longitude: normLon,
      acquisitionTime: isoTime,
      satellite,
      sensor,
      instrumentPass: dayNight === 'N' ? 'NIGHT_PASS' : 'DAY_PASS',
      frp,
      brightness,
      brightnessTi4,
      brightnessTi5,
      brightnessT31,
      brightnessDelta,
      scan,
      track,
      confidence,
      rawConfidence: confRaw,
      dayNight,
      facilityId: dev.facilityId,
      facilityName: dev.facilityName || null,
      facilityDistanceMeters: Math.round(dev.distanceToFacilityMeters),
      landCoverType: dev.facilityId ? 'industrial' : 'agricultural',
      spatialAssociation: dev.spatialAssociation,
      behaviouralStatus: dev.behaviouralStatus,
      baselineStatus: dev.facilityId === 'FAC-GUJ-JAMNAGAR-01' ? 'EMPIRICAL' : dev.facilityId ? 'CONTROLLED' : 'NONE',
      provenance: 'REAL_FIRMS',
      isRealData: true,
      deviationStatus: dev.behaviouralStatus,
      sourceHypotheses: {
        gas_flare: gasFlareProb,
        industrial_fire: fireProb,
        agricultural_burn: agriProb,
        wildfire: wildProb,
        mining_smelter: smelterProb,
        other_thermal: otherProb,
      },
      isAmbiguous: dev.facilityId !== null && !dev.isInsideKnownZone,
      uncertaintyDetails: dev.explanation,
      matchedZoneId: dev.matchedZone?.id || null,
      isInsideKnownZone: dev.isInsideKnownZone,
      rawRecord: rawLine,
    });
  }

  return events;
}

/**
 * Generates synthetic controlled anomaly scenarios for testing algorithm performance (§52)
 * Strictly marked with CONTROLLED_TEST provenance and isRealData: false.
 */
export function generateControlledAnomaly(
  facility: Facility,
  scenarioType: 'TANK_FARM_CONTAINMENT_BREACH' | 'INTENSE_OFF_STACK_FLARING' | 'AGRICULTURAL_BOUNDARY_INTRUSION'
): ThermalEvent {
  const now = new Date().toISOString();
  if (scenarioType === 'TANK_FARM_CONTAINMENT_BREACH') {
    // Generate hotspot ~700m away from flare stacks inside facility polygon
    const offsetLat = facility.center[0] - 0.0075;
    const offsetLng = facility.center[1] - 0.0060;
    const frp = 68.5; // very high FRP

    return {
      id: `DEMO-SYNTHETIC-TANK-BREACH-${Math.floor(1000 + Math.random() * 9000)}`,
      latitude: parseFloat(offsetLat.toFixed(5)),
      longitude: parseFloat(offsetLng.toFixed(5)),
      acquisitionTime: now,
      satellite: 'VIIRS-NOAA20',
      sensor: 'VIIRS',
      instrumentPass: 'DAY_PASS',
      frp,
      brightness: 378.2,
      brightnessTi4: 378.2,
      brightnessTi5: 295.4,
      brightnessDelta: 82.8,
      scan: 0.45,
      track: 0.45,
      confidence: 'high',
      rawConfidence: 'high',
      dayNight: 'D',
      facilityId: facility.id,
      facilityDistanceMeters: 750,
      landCoverType: 'industrial',
      spatialAssociation: 'FACILITY_OFF_ZONE',
      behaviouralStatus: 'ANOMALOUS',
      deviationStatus: 'ANOMALOUS',
      spatialAssociationLabel: 'Inside Facility Boundary (Off-Zone / Ambiguous)',
      baselineStatus: 'CONTROLLED',
      provenance: 'CONTROLLED_TEST',
      isRealData: false,
      sourceHypotheses: {
        gas_flare: 0.45,
        industrial_fire: 0.46,
        agricultural_burn: 0.03,
        wildfire: 0.02,
        mining_smelter: 0.02,
        other_thermal: 0.02,
      },
      isAmbiguous: true,
      uncertaintyDetails: `CONTROLLED ANOMALY SCENARIO [DEMO]: High-intensity thermal event (+${Math.round(((frp - (facility.baselineProfile?.typicalFrpMw.median || 20)) / (facility.baselineProfile?.typicalFrpMw.median || 20)) * 100)}% FRP) generated outside historical flare footprint to test ambiguity resolution.`,
      isControlledScenario: true,
      matchedZoneId: null,
      isInsideKnownZone: false,
    };
  } else if (scenarioType === 'INTENSE_OFF_STACK_FLARING') {
    const zone = facility.knownThermalZones[0];
    const frp = 55.0;
    return {
      id: `DEMO-SYNTHETIC-ELEVATED-FLARE-${Math.floor(1000 + Math.random() * 9000)}`,
      latitude: parseFloat((zone ? zone.center[0] : facility.center[0]).toFixed(5)),
      longitude: parseFloat((zone ? zone.center[1] : facility.center[1]).toFixed(5)),
      acquisitionTime: now,
      satellite: 'VIIRS-SNPP',
      sensor: 'VIIRS',
      instrumentPass: 'NIGHT_PASS',
      frp,
      brightness: 358.0,
      brightnessTi4: 358.0,
      brightnessTi5: 292.0,
      brightnessDelta: 66.0,
      scan: 0.45,
      track: 0.45,
      confidence: 'high',
      rawConfidence: 'high',
      dayNight: 'N',
      facilityId: facility.id,
      facilityDistanceMeters: 40,
      landCoverType: 'industrial',
      spatialAssociation: 'KNOWN_THERMAL_ZONE',
      behaviouralStatus: 'ELEVATED',
      deviationStatus: 'ELEVATED',
      spatialAssociationLabel: `Inside Facility Boundary (${zone?.name || 'Flare Stack'})`,
      baselineStatus: 'CONTROLLED',
      provenance: 'CONTROLLED_TEST',
      isRealData: false,
      sourceHypotheses: {
        gas_flare: 0.82,
        industrial_fire: 0.12,
        agricultural_burn: 0.02,
        wildfire: 0.01,
        mining_smelter: 0.02,
        other_thermal: 0.01,
      },
      isAmbiguous: false,
      uncertaintyDetails: 'CONTROLLED SCENARIO [DEMO]: Elevated operational flare burn exceeding typical median FRP in primary relief stack.',
      isControlledScenario: true,
      matchedZoneId: zone ? zone.id : null,
      isInsideKnownZone: true,
    };
  } else {
    // Agricultural boundary intrusion
    const offsetLat = facility.center[0] + 0.035;
    const offsetLng = facility.center[1] + 0.035;
    return {
      id: `DEMO-SYNTHETIC-AGRI-BUFFER-${Math.floor(1000 + Math.random() * 9000)}`,
      latitude: parseFloat(offsetLat.toFixed(5)),
      longitude: parseFloat(offsetLng.toFixed(5)),
      acquisitionTime: now,
      satellite: 'MODIS-Aqua',
      sensor: 'MODIS',
      instrumentPass: 'DAY_PASS',
      frp: 21.0,
      brightness: 328.5,
      confidence: 'nominal',
      rawConfidence: 'nominal',
      dayNight: 'D',
      facilityId: null,
      facilityDistanceMeters: 5200,
      landCoverType: 'agricultural',
      spatialAssociation: 'UNASSOCIATED',
      behaviouralStatus: 'NOT_ASSESSED',
      deviationStatus: 'NOT_ASSESSED',
      spatialAssociationLabel: 'Unassociated Regional Hotspot',
      baselineStatus: 'NONE',
      provenance: 'CONTROLLED_TEST',
      isRealData: false,
      sourceHypotheses: {
        agricultural_burn: 0.89,
        wildfire: 0.06,
        industrial_fire: 0.02,
        gas_flare: 0.01,
        mining_smelter: 0.01,
        other_thermal: 0.01,
      },
      isAmbiguous: false,
      uncertaintyDetails: 'CONTROLLED SCENARIO [DEMO]: Field boundary biomass clearance 5.2km upwind from industrial complex.',
      isControlledScenario: true,
      matchedZoneId: null,
      isInsideKnownZone: false,
    };
  }
}

export interface BackendHealthResponse {
  status: string;
  system: string;
  version: string;
  timestamp: string;
  firms_configured: boolean;
  firms_data_mode: 'NASA_REST_API' | 'NASA_OPEN_NRT_FEED';
  database: {
    status: string;
    message: string;
    postgis_enabled: boolean;
  };
  external_data_sources: Record<string, string>;
}

export async function fetchBackendHealth(): Promise<BackendHealthResponse | null> {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export interface BackendFirmsResult {
  status: 'SUCCESS' | 'ERROR';
  count: number;
  source: string;
  isLiveExternal: boolean;
  dataMode: 'LIVE_EXTERNAL' | 'PUBLIC_FEED_LIVE' | 'UNAVAILABLE_NO_KEY' | 'LOCAL_BENCHMARK_CACHE';
  events: ThermalEvent[];
  validationSummary?: {
    total_raw_records: number;
    valid_records: number;
    invalid_records: number;
    duplicate_records: number;
  };
  notes?: string;
  timestamp: string;
}

export async function fetchBackendFirmsObservations(options?: {
  source?: 'VIIRS_NOAA20_NRT' | 'VIIRS_SNPP_NRT' | 'MODIS_NRT';
  country?: string;
  dayRange?: number;
  minFrp?: number;
}): Promise<BackendFirmsResult> {
  const source = options?.source || 'VIIRS_NOAA20_NRT';
  const country = options?.country || 'IND';
  const dayRange = options?.dayRange || 1;
  const minFrp = options?.minFrp || 0.0;

  const url = `/api/firms/observations?source=${source}&country=${country}&day_range=${dayRange}&min_frp=${minFrp}&associate_facilities=true`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`NASA FIRMS backend query failed with status: ${res.status}`);
  }

  const data = await res.json();
  const rawList = data.observations || [];

  const events: ThermalEvent[] = rawList.map((obs: any) => {
    const satStr = obs.satellite || '';
    const satellite: SatelliteSensor = satStr.includes('SNPP')
      ? 'VIIRS-SNPP'
      : satStr.includes('NOAA21') || satStr.includes('N21')
      ? 'VIIRS-NOAA21'
      : satStr.includes('Terra')
      ? 'MODIS-Terra'
      : satStr.includes('Aqua') || satStr.includes('MODIS')
      ? 'MODIS-Aqua'
      : 'VIIRS-NOAA20';

    const assoc = obs.spatial_association;
    const isInsideZone = assoc?.is_inside_known_zone ?? false;

    // Strict semantic separation
    const spatialAssociation: SpatialAssociationType =
      assoc?.association_type === 'KNOWN_THERMAL_ZONE'
        ? 'KNOWN_THERMAL_ZONE'
        : assoc?.association_type === 'FACILITY_OFF_ZONE'
        ? 'FACILITY_OFF_ZONE'
        : assoc?.association_type === 'FACILITY_BUFFER'
        ? 'FACILITY_BUFFER'
        : 'UNASSOCIATED';

    const baselineStatus: 'EMPIRICAL' | 'LIMITED' | 'CANDIDATE_EMPIRICAL_WITH_REVIEW' | 'CONTROLLED' | 'INSUFFICIENT_DATA' | 'NOT_ASSESSED' | 'NONE' =
      assoc?.baseline_status || (spatialAssociation === 'UNASSOCIATED' ? 'NONE' : 'CONTROLLED');

    const behaviouralStatus: BehaviouralStatus =
      assoc?.behavioural_status || (spatialAssociation === 'UNASSOCIATED' ? 'NOT_ASSESSED' : 'NORMAL');

    const provenance = obs.provenance || (baselineStatus === 'EMPIRICAL' ? 'HISTORICAL_BASELINE' : 'REAL_FIRMS');

    const isAmbiguous = spatialAssociation === 'FACILITY_OFF_ZONE' || (spatialAssociation === 'FACILITY_BUFFER' && obs.frp > 35);

    const sHyp = assoc?.source_hypotheses;
    const sourceHypotheses = {
      gas_flare: sHyp?.GAS_FLARE ?? (spatialAssociation === 'KNOWN_THERMAL_ZONE' ? 0.88 : 0.01),
      industrial_fire: sHyp?.INDUSTRIAL_FIRE ?? (spatialAssociation === 'FACILITY_OFF_ZONE' ? 0.54 : 0.01),
      agricultural_burn: sHyp?.AGRICULTURAL_BURN ?? (spatialAssociation === 'UNASSOCIATED' ? 0.65 : 0.01),
      wildfire: sHyp?.WILDFIRE_VEGETATION ?? (spatialAssociation === 'UNASSOCIATED' ? 0.25 : 0.01),
      mining_smelter: 0.01,
      other_thermal: sHyp?.OTHER ?? 0.06,
    };

    return {
      id: obs.id,
      latitude: obs.latitude,
      longitude: obs.longitude,
      acquisitionTime: obs.acquisition_time,
      satellite,
      sensor: obs.sensor || 'VIIRS',
      instrumentPass: obs.instrument_pass || (obs.day_night === 'N' ? 'NIGHT_PASS' : 'DAY_PASS'),
      frp: obs.frp,
      brightness: obs.brightness_kelvin ?? obs.brightness_ti4 ?? 340.0,
      brightnessTi4: obs.brightness_ti4,
      brightnessTi5: obs.brightness_ti5,
      brightnessT31: obs.brightness_t31,
      brightnessDelta: obs.brightness_delta,
      scan: obs.scan,
      track: obs.track,
      confidence: obs.confidence,
      rawConfidence: obs.raw_confidence || obs.confidence,
      dayNight: obs.day_night,
      facilityId: assoc?.facility_id || null,
      facilityName: assoc?.facility_name || null,
      facilityDistanceMeters: assoc?.distance_meters || 0,
      landCoverType: spatialAssociation === 'UNASSOCIATED' ? 'agricultural' : 'industrial',
      spatialAssociation,
      behaviouralStatus,
      baselineStatus,
      provenance,
      deviationStatus: behaviouralStatus,
      reasons: assoc?.reasons || [],
      empiricalMetrics: assoc?.empirical_metrics,
      evaluationParameters: assoc?.evaluation_parameters,
      sourceHypotheses,
      hypothesisRationales: assoc?.hypothesis_rationales || [],
      uncertainty: assoc?.uncertainty ? {
        shannon_entropy_bits: assoc.uncertainty.shannon_entropy_bits,
        normalized_entropy: assoc.uncertainty.normalized_entropy,
        uncertainty_level: assoc.uncertainty.uncertainty_level,
        scientific_explanation: assoc.uncertainty.scientific_explanation,
      } : undefined,
      investigationPriority: assoc?.investigation_priority ? {
        level: assoc.investigation_priority.level,
        score: assoc.investigation_priority.score,
        label: assoc.investigation_priority.label,
        reasons: assoc.investigation_priority.reasons,
      } : undefined,
      isAmbiguous,
      uncertaintyDetails:
        assoc?.notes ||
        (spatialAssociation === 'UNASSOCIATED'
          ? 'Thermal observation is outside monitored industrial facility footprints. Evaluated via regional satellite telemetry.'
          : `${assoc?.association_label || spatialAssociation} (${assoc?.distance_meters || 0}m from facility center)`),
      matchedZoneId: assoc?.matched_zone || null,
      isInsideKnownZone: isInsideZone,
      isRealData: obs.is_real_data ?? (provenance !== 'CONTROLLED_TEST'),
      spatialAssociationLabel: assoc?.association_label || (spatialAssociation === 'UNASSOCIATED' ? 'Unassociated (Regional Detection)' : spatialAssociation),
      rawRecord: obs.raw_record,
      rawServerData: obs,
    };
  });

  return {
    status: data.status,
    count: data.count,
    source: data.source,
    isLiveExternal: data.is_live_external,
    dataMode: data.data_mode,
    events,
    validationSummary: data.validation_summary,
    notes: data.notes,
    timestamp: data.timestamp,
  };
}

export interface ClientFacilityBaseline {
  facility_id: string;
  facility_name: string;
  baseline_status: 'EMPIRICAL' | 'LIMITED' | 'CANDIDATE_EMPIRICAL_WITH_REVIEW' | 'CONTROLLED' | 'INSUFFICIENT_DATA' | 'NOT_ASSESSED' | 'NONE';
  minimum_threshold_required: number;
  provenance: string;
  baseline_period: {
    start_date: string;
    end_date: string;
    total_days: number;
  };
  metrics: {
    observation_count: number;
    observation_days: number;
    observations_per_day: number;
    frp_median: number;
    frp_p25: number;
    frp_p75: number;
    frp_p90: number;
    frp_p95: number;
    frp_max: number;
    frp_iqr: number;
    frp_mad: number;
  };
  diurnal: {
    day_count: number;
    night_count: number;
    day_pct: number;
    night_pct: number;
    hour_distribution: { hour: number; count: number; frequency: number }[];
  };
  spatial_distribution: {
    known_zone_count: number;
    off_zone_count: number;
    buffer_count: number;
    zones: {
      zone_id: string;
      zone_name: string;
      count: number;
      pct: number;
      empirical_frp_median: number;
      empirical_frp_p95: number;
    }[];
  };
  created_at: string;
}

export async function fetchFacilityBaseline(facilityId: string): Promise<ClientFacilityBaseline | null> {
  try {
    const res = await fetch(`/api/baselines/${facilityId}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.baseline || null;
  } catch {
    return null;
  }
}

export async function fetchAllFacilityBaselines(): Promise<ClientFacilityBaseline[]> {
  try {
    const res = await fetch('/api/baselines');
    if (!res.ok) return [];
    const data = await res.json();
    return data.baselines || [];
  } catch {
    return [];
  }
}

export async function fetchFacilityHistoricalObservations(facilityId: string): Promise<any[]> {
  try {
    const res = await fetch(`/api/observations/historical/${facilityId}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.observations || [];
  } catch {
    return [];
  }
}

