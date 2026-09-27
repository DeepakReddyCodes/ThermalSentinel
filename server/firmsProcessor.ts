// ============================================================================
// ThermalSentinel — Generic FIRMS Detection Processor (Day 2A)
//
// Establishes a canonical generic FIRMS observation pipeline that:
//   1. Preserves authentic source measurements without derived labels
//   2. Strictly separates source observation from derived context
//   3. Evaluates spatial facility associations generically across all facilities
//   4. Exposes explicit evidence availability for downstream Bayesian inference
//   5. Eliminates all Jamnagar / regional hardcoded branches
// ============================================================================

import {
  CanonicalFirmsObservation,
  DerivedObservationContext,
  EvidenceAvailabilityMap,
  EvidenceAvailabilityStatus,
  GenericDetectionProcessingResult,
  ObservationProvenance,
  ServerFacility,
  SpatialAssociationType,
  BehaviouralStatus,
} from './types.js';
import { MONITORED_FACILITIES } from './facilities.js';
import {
  findFacilitySpatialAssociation,
  haversineDistanceMeters,
} from './geospatial.js';
import { getFacilityBaselineSync } from './baselineRepository.js';
import { evaluateObservationAgainstBaseline } from './deviationEngine.js';
import { evaluateTemporalPersistence } from './persistenceEngine.js';
import { normalizeSatelliteAndSensor } from './firms.js';
import { BayesianInferenceInput } from './bayesianEngine.js';
import { OsmContextResponse } from './osm.js';
import { WeatherContextResponse } from './weather.js';
import { Sentinel2SwirResponse } from './types.js';
import { ThermalSourceDiscriminatorOutput, OperationalScopeConfig, OperationalScopeEvaluationResult } from './types.js';
import { evaluateOperationalScope, PRODUCTION_OPERATIONAL_SCOPE } from './operationalScope.js';

export interface ProcessFirmsOptions {
  facilities?: ServerFacility[];
  defaultProvenance?: ObservationProvenance;
  operationalScope?: OperationalScopeConfig | null; // null disables operational scope filter (e.g. in research/test mode)
  enableExternalEnrichment?: {
    osm?: OsmContextResponse | null;
    weather?: WeatherContextResponse | null;
    optical?: Sentinel2SwirResponse | null;
    ml?: ThermalSourceDiscriminatorOutput | null;
  };
}

/**
 * Validates and normalizes raw input into a CanonicalFirmsObservation object.
 * Preserves authentic source measurements rather than replacing them with derived labels.
 */
export function normalizeCanonicalFirmsObservation(
  input: Partial<CanonicalFirmsObservation> | Record<string, any>,
  defaultProvenance: ObservationProvenance = 'REAL_FIRMS'
): {
  valid: boolean;
  observation?: CanonicalFirmsObservation;
  errors: string[];
} {
  const errors: string[] = [];

  // 1. Latitude validation [-90.0, 90.0]
  const rawLat = input.latitude ?? (input as any).lat;
  const lat = typeof rawLat === 'number' ? rawLat : parseFloat(String(rawLat));
  if (isNaN(lat) || !isFinite(lat)) {
    errors.push(`Latitude must be a valid finite number (got ${rawLat}).`);
  } else if (lat < -90.0 || lat > 90.0) {
    errors.push(`Latitude ${lat} is outside the valid range [-90.0, 90.0].`);
  }

  // 2. Longitude validation [-180.0, 180.0]
  const rawLon = input.longitude ?? (input as any).lon ?? (input as any).lng;
  const lon = typeof rawLon === 'number' ? rawLon : parseFloat(String(rawLon));
  if (isNaN(lon) || !isFinite(lon)) {
    errors.push(`Longitude must be a valid finite number (got ${rawLon}).`);
  } else if (lon < -180.0 || lon > 180.0) {
    errors.push(`Longitude ${lon} is outside the valid range [-180.0, 180.0].`);
  }

  // 3. FRP validation (finite, non-negative, <= 10,000 MW)
  const rawFrp = input.frp ?? (input as any).frp_mw;
  const frp = typeof rawFrp === 'number' ? rawFrp : parseFloat(String(rawFrp ?? 0.0));
  if (isNaN(frp) || !isFinite(frp)) {
    errors.push(`FRP must be a valid finite number (got ${rawFrp}).`);
  } else if (frp < 0.0) {
    errors.push(`FRP cannot be negative (got ${frp} MW).`);
  } else if (frp > 10000.0) {
    errors.push(`FRP ${frp} MW exceeds the plausible satellite sensor threshold (10,000 MW).`);
  }

  // 4. Timestamp normalization (ISO-8601 UTC)
  let rawTime =
    (input as any).acquisition_timestamp ||
    (input as any).acq_time_iso;

  const acqDateInput = input.acquisition_date || (input as any).acq_date;
  const acqTimeCandidate = input.acquisition_time || (input as any).acq_time;

  if (!rawTime && acqTimeCandidate) {
    const timeStr = String(acqTimeCandidate).trim();
    if (timeStr.includes('-') || timeStr.includes('T')) {
      rawTime = timeStr;
    } else if (acqDateInput) {
      const padded = timeStr.padStart(4, '0');
      const hh = padded.slice(0, 2);
      const mm = padded.slice(2, 4);
      rawTime = `${acqDateInput}T${hh}:${mm}:00Z`;
    }
  }

  if (!rawTime && acqDateInput) {
    rawTime = `${acqDateInput}T12:00:00Z`;
  }

  let isoTimestamp = '';
  let acqDate = '';
  if (!rawTime || typeof rawTime !== 'string') {
    errors.push('Acquisition timestamp is required.');
  } else {
    const parsed = new Date(rawTime).getTime();
    if (isNaN(parsed)) {
      errors.push(`Malformed acquisition timestamp "${rawTime}".`);
    } else {
      const dt = new Date(parsed);
      const year = dt.getUTCFullYear();
      if (year < 2000 || year > 2100) {
        errors.push(`Acquisition year ${year} is outside valid satellite era [2000, 2100].`);
      } else {
        isoTimestamp = dt.toISOString();
        acqDate = isoTimestamp.slice(0, 10);
      }
    }
  }

  // 5. Satellite & Sensor normalization
  const rawSat = String(input.satellite || (input as any).sat || 'VIIRS-NOAA20');
  const rawSensor = String(input.sensor || '');
  const { satellite, sensor } = normalizeSatelliteAndSensor(rawSat, rawSensor || rawSat);

  // 6. Confidence normalization ('low' | 'nominal' | 'high')
  const rawConf = String(input.confidence || input.raw_confidence || 'nominal').trim();
  const rawConfLower = rawConf.toLowerCase();
  let confidence: 'low' | 'nominal' | 'high' = 'nominal';
  const confNum = parseInt(rawConf, 10);
  if (rawConfLower === 'h' || rawConfLower === 'high' || (!isNaN(confNum) && confNum >= 80)) {
    confidence = 'high';
  } else if (rawConfLower === 'l' || rawConfLower === 'low' || (!isNaN(confNum) && confNum < 40)) {
    confidence = 'low';
  }

  // 7. Day / Night normalization ('D' | 'N')
  const rawDayNight = String(input.day_night || (input as any).daynight || 'N').trim().toUpperCase();
  const dayNight: 'D' | 'N' = rawDayNight === 'D' || rawDayNight === 'DAY' ? 'D' : 'N';

  // 8. Brightness temperatures (physical validity check 150K to 600K)
  const parseBrightness = (val: any, name: string): number | null => {
    if (val === undefined || val === null || val === '') return null;
    const n = typeof val === 'number' ? val : parseFloat(String(val));
    if (isNaN(n) || !isFinite(n)) {
      errors.push(`${name} must be a valid number.`);
      return null;
    }
    if (n < 150.0 || n > 600.0) {
      errors.push(`${name} ${n} K is outside physically plausible thermal range [150 K, 600 K].`);
      return null;
    }
    return Math.round(n * 10) / 10;
  };

  const bPrimary = parseBrightness(input.brightness_kelvin ?? (input as any).brightness, 'Brightness Primary');
  const bTi4 = parseBrightness(input.brightness_ti4 ?? (input as any).bright_ti4, 'Brightness TI4');
  const bTi5 = parseBrightness(input.brightness_ti5 ?? (input as any).bright_ti5, 'Brightness TI5');
  const bT31 = parseBrightness(input.brightness_t31 ?? (input as any).bright_t31, 'Brightness T31');

  let bDelta: number | null = null;
  if (bTi4 !== null && bTi5 !== null) {
    bDelta = Math.round((bTi4 - bTi5) * 10) / 10;
  } else if (input.brightness_delta !== undefined && input.brightness_delta !== null) {
    bDelta = Number(input.brightness_delta);
  }

  // 9. Scan / Track pixel dimensions (valid range (0, 10] km)
  const parsePixelDim = (val: any, name: string): number | null => {
    if (val === undefined || val === null || val === '') return null;
    const n = typeof val === 'number' ? val : parseFloat(String(val));
    if (isNaN(n) || n <= 0 || n > 10.0) {
      errors.push(`${name} dimension ${val} is invalid (must be (0, 10] km).`);
      return null;
    }
    return Math.round(n * 100) / 100;
  };

  const scan = parsePixelDim(input.scan, 'Scan');
  const track = parsePixelDim(input.track, 'Track');

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const provenance: ObservationProvenance = input.provenance || defaultProvenance;
  const isRealData = provenance !== 'CONTROLLED_TEST';
  const normLat = Number(lat.toFixed(5));
  const normLon = Number(lon.toFixed(5));
  const normFrp = Math.round(frp * 100) / 100;

  const id = input.id || `FIRMS-${acqDate.replace(/-/g, '')}-${satellite.replace(/[^a-zA-Z0-9]/g, '')}-${normLat}_${normLon}`;

  const observation: CanonicalFirmsObservation = {
    id,
    source_provider: input.source_provider || 'NASA_FIRMS',
    provenance,
    ingestion_timestamp: input.ingestion_timestamp || new Date().toISOString(),
    latitude: normLat,
    longitude: normLon,
    acquisition_time: isoTimestamp,
    acquisition_date: acqDate,
    frp: normFrp,
    brightness_kelvin: bPrimary,
    brightness_ti4: bTi4,
    brightness_ti5: bTi5,
    brightness_t31: bT31,
    brightness_delta: bDelta,
    confidence,
    raw_confidence: rawConf,
    day_night: dayNight,
    satellite,
    sensor,
    scan,
    track,
    source_type: input.source_type || 'thermal_anomaly',
    is_real_data: isRealData,
    raw_record: input.raw_record ?? null,
  };

  return {
    valid: true,
    observation,
    errors: [],
  };
}

/**
 * Canonical Generic FIRMS Detection Processor (Day 2A)
 *
 * Fully generic, non-facility-hardcoded observation processing pipeline:
 *   1. Validates and normalizes source measurements
 *   2. Evaluates geometric facility containment & buffer proximity
 *   3. Evaluates empirical facility baseline & multi-pass persistence
 *   4. Generates explicit evidence availability mapping
 *   5. Constructs clean Bayesian inference inputs
 */
export function processFirmsObservation(
  input: Partial<CanonicalFirmsObservation> | Record<string, any>,
  options?: ProcessFirmsOptions
): GenericDetectionProcessingResult {
  const facilities = options?.facilities || MONITORED_FACILITIES;
  const defaultProvenance = options?.defaultProvenance || 'REAL_FIRMS';

  // 1. Normalize and validate source observation
  const normResult = normalizeCanonicalFirmsObservation(input, defaultProvenance);
  if (!normResult.valid || !normResult.observation) {
    const dummyObservation: CanonicalFirmsObservation = {
      id: input.id || 'INVALID_OBSERVATION',
      source_provider: 'NASA_FIRMS',
      provenance: defaultProvenance,
      ingestion_timestamp: new Date().toISOString(),
      latitude: typeof input.latitude === 'number' ? input.latitude : 0,
      longitude: typeof input.longitude === 'number' ? input.longitude : 0,
      acquisition_time: new Date().toISOString(),
      acquisition_date: 'INVALID',
      frp: 0,
      confidence: 'nominal',
      day_night: 'N',
      satellite: 'UNKNOWN',
      sensor: 'VIIRS',
      source_type: 'thermal_anomaly',
      is_real_data: false,
      raw_record: null,
    };

    const emptyDerived: DerivedObservationContext = {
      spatial_association: 'UNASSOCIATED',
      spatial_association_label: 'Invalid Observation',
      is_associated: false,
      associated_facility: null,
      facility_distance_meters: null,
      distance_to_boundary_meters: null,
      is_inside_polygon: false,
      is_inside_known_zone: false,
      matched_zone_name: null,
      distance_to_zone_meters: null,
      baseline_status: 'NONE',
      behavioural_status: 'NOT_ASSESSED',
      persistence_status: 'NO_HISTORICAL_DATA',
      reasons: normResult.errors,
    };

    const emptyAvailability: EvidenceAvailabilityMap = {
      source_observation: 'AVAILABLE',
      spatial_context: 'AVAILABLE',
      facility_context: 'UNAVAILABLE',
      behavioural_baseline: 'UNAVAILABLE',
      temporal_persistence: 'UNAVAILABLE',
      infrastructure: 'UNAVAILABLE',
      weather: 'UNAVAILABLE',
      optical: 'UNAVAILABLE',
      ml_advisory: 'UNAVAILABLE',
    };

    return {
      source_observation: dummyObservation,
      derived_context: emptyDerived,
      evidence_availability: emptyAvailability,
      processing_status: 'INVALID_OBSERVATION',
      validation_errors: normResult.errors,
    };
  }

  const obs = normResult.observation;

  // 2. Evaluate operational geographic scope (production domain = India)
  const scopeConfig = options?.operationalScope !== undefined
    ? options.operationalScope
    : PRODUCTION_OPERATIONAL_SCOPE;

  let scopeResult: OperationalScopeEvaluationResult | undefined;
  if (scopeConfig && scopeConfig.enabled) {
    scopeResult = evaluateOperationalScope(obs.latitude, obs.longitude, obs.provenance, scopeConfig);
    if (!scopeResult.is_in_scope) {
      const outOfScopeDerived: DerivedObservationContext = {
        operational_scope: scopeResult,
        spatial_association: 'UNASSOCIATED',
        spatial_association_label: 'Out of Operational Domain (Non-India Detection)',
        is_associated: false,
        associated_facility: null,
        facility_distance_meters: null,
        distance_to_boundary_meters: null,
        is_inside_polygon: false,
        is_inside_known_zone: false,
        matched_zone_name: null,
        distance_to_zone_meters: null,
        baseline_status: 'NONE',
        behavioural_status: 'NOT_ASSESSED',
        persistence_status: 'NO_HISTORICAL_DATA',
        reasons: [scopeResult.exclusion_reason || 'Observation is outside the active operational domain (India).'],
      };

      const outOfScopeAvailability: EvidenceAvailabilityMap = {
        source_observation: 'AVAILABLE',
        spatial_context: 'AVAILABLE',
        facility_context: 'OUT_OF_SCOPE',
        behavioural_baseline: 'OUT_OF_SCOPE',
        temporal_persistence: 'UNAVAILABLE',
        infrastructure: 'UNAVAILABLE',
        weather: 'UNAVAILABLE',
        optical: 'UNAVAILABLE',
        ml_advisory: 'OUT_OF_SCOPE',
      };

      return {
        source_observation: obs,
        derived_context: outOfScopeDerived,
        evidence_availability: outOfScopeAvailability,
        processing_status: 'OUT_OF_SCOPE',
        validation_errors: [],
      };
    }
  }

  // 3. Determine spatial association against facility registry
  const spatialResult = findFacilitySpatialAssociation(obs.latitude, obs.longitude, facilities);
  const matchedFacility = spatialResult.matched_facility;
  const isAssociated = spatialResult.is_associated && matchedFacility !== null;

  // 4. Retrieve facility baseline & behavioural deviation
  let baselineStatus: 'EMPIRICAL' | 'CONTROLLED' | 'INSUFFICIENT_DATA' | 'NONE' = 'NONE';
  let behaviouralStatus: BehaviouralStatus = 'NOT_ASSESSED';
  let baselineMetrics: DerivedObservationContext['baseline_metrics'] = null;

  if (isAssociated && matchedFacility) {
    // Look up baseline with event-timestamp to guarantee zero future data leakage
    const baseline = getFacilityBaselineSync(matchedFacility.id, obs.acquisition_time);
    if (baseline && (baseline.baseline_status === 'EMPIRICAL' || baseline.baseline_status === 'CONTROLLED')) {
      baselineStatus = baseline.baseline_status;
      const devRes = evaluateObservationAgainstBaseline(
        obs.frp,
        spatialResult.spatial_association,
        spatialResult.distance_to_zone_meters,
        spatialResult.facility_distance_meters,
        spatialResult.matched_zone?.name || null,
        spatialResult.is_inside_polygon,
        matchedFacility,
        baseline
      );
      behaviouralStatus = devRes.behavioural_status;
      baselineMetrics = {
        observation_count: baseline.metrics.observation_count,
        median_frp: baseline.metrics.frp_median,
        p75_frp: baseline.metrics.frp_p75,
        p95_frp: baseline.metrics.frp_p95,
        max_frp: baseline.metrics.frp_max,
        ratio_to_median: devRes.metrics.frp_ratio_to_median,
        delta_from_median: devRes.metrics.frp_delta_from_median,
      };
    } else {
      baselineStatus = 'INSUFFICIENT_DATA';
      behaviouralStatus = 'NOT_ASSESSED';
    }
  }

  // 5. Evaluate temporal multi-pass persistence context
  const persistenceContext = evaluateTemporalPersistence(obs.latitude, obs.longitude, obs.id);
  const persistenceStatus = persistenceContext.status;

  // 6. Construct Derived Observation Context
  const derivedContext: DerivedObservationContext = {
    operational_scope: scopeResult,
    spatial_association: spatialResult.spatial_association,
    spatial_association_label: spatialResult.spatial_association_label,
    is_associated: isAssociated,
    associated_facility: matchedFacility
      ? {
          id: matchedFacility.id,
          name: matchedFacility.name,
          operator: matchedFacility.operator,
          category: matchedFacility.category,
          state: matchedFacility.state,
          region: matchedFacility.region,
          center: matchedFacility.center,
          buffer_radius_km: matchedFacility.buffer_radius_km,
        }
      : null,
    facility_distance_meters: spatialResult.facility_distance_meters,
    distance_to_boundary_meters: spatialResult.distance_to_boundary_meters,
    is_inside_polygon: spatialResult.is_inside_polygon,
    is_inside_known_zone: spatialResult.is_inside_known_zone,
    matched_zone_name: spatialResult.matched_zone?.name || null,
    distance_to_zone_meters: spatialResult.distance_to_zone_meters,
    baseline_status: baselineStatus,
    behavioural_status: behaviouralStatus,
    baseline_metrics: baselineMetrics,
    persistence_status: persistenceStatus,
    persistence_summary: persistenceContext.summary,
    reasons: spatialResult.reasons,
  };

  // 6. Construct Explicit Evidence Availability Mapping
  const ext = options?.enableExternalEnrichment;

  let osmAvailable: EvidenceAvailabilityStatus = 'UNAVAILABLE';
  if (ext?.osm) {
    if (
      ext.osm.status === 'AVAILABLE' ||
      ext.osm.status === 'LIVE_OVERPASS' ||
      ext.osm.status === 'VERIFIED_LOCAL_SNAPSHOT' ||
      ext.osm.status === 'AUTHENTIC_LIVE' ||
      ext.osm.status === 'VERIFIED_LOCAL_CACHE'
    ) {
      osmAvailable = (ext.osm.features?.length ?? 0) > 0 ? 'AVAILABLE' : 'NO_MAPPED_FEATURES';
    } else if (ext.osm.status === 'NO_MAPPED_FEATURES' || ext.osm.status === 'NO_RELEVANT_FEATURES') {
      osmAvailable = 'NO_MAPPED_FEATURES';
    } else if (ext.osm.status === 'ACQUISITION_FAILED' || ext.osm.status === 'OSM_UNAVAILABLE' || ext.osm.status === 'ERROR') {
      osmAvailable = 'ACQUISITION_FAILED';
    } else if (ext.osm.status === 'OUT_OF_SCOPE') {
      osmAvailable = 'OUT_OF_SCOPE';
    } else if (ext.osm.status === 'NOT_CURRENTLY_AVAILABLE') {
      osmAvailable = 'NOT_CURRENTLY_AVAILABLE';
    }
  }

  const weatherAvailable: EvidenceAvailabilityStatus =
    ext?.weather && ext.weather.status !== 'UNAVAILABLE' ? 'AVAILABLE' : 'UNAVAILABLE';

  const opticalAvailable: EvidenceAvailabilityStatus =
    ext?.optical && ext.optical.status !== 'ERROR' && Boolean(ext.optical.evidence_findings)
      ? 'AVAILABLE'
      : 'UNAVAILABLE';

  let mlAvailable: EvidenceAvailabilityStatus = 'UNAVAILABLE';
  if (ext?.ml) {
    if (ext.ml.status === 'AVAILABLE') {
      mlAvailable = 'AVAILABLE';
    } else if (ext.ml.coverage_status === 'OUT_OF_DOMAIN' || ext.ml.status === 'OUT_OF_SCOPE') {
      mlAvailable = 'OUT_OF_SCOPE';
    } else {
      mlAvailable = 'UNAVAILABLE';
    }
  }

  const evidenceAvailability: EvidenceAvailabilityMap = {
    source_observation: 'AVAILABLE',
    spatial_context: 'AVAILABLE',
    facility_context: isAssociated ? 'AVAILABLE' : 'UNAVAILABLE',
    behavioural_baseline:
      baselineStatus === 'EMPIRICAL' || baselineStatus === 'CONTROLLED' ? 'AVAILABLE' : 'UNAVAILABLE',
    temporal_persistence: persistenceStatus !== 'NO_HISTORICAL_DATA' ? 'AVAILABLE' : 'UNAVAILABLE',
    infrastructure: osmAvailable,
    weather: weatherAvailable,
    optical: opticalAvailable,
    ml_advisory: mlAvailable,
  };

  return {
    source_observation: obs,
    derived_context: derivedContext,
    evidence_availability: evidenceAvailability,
    processing_status: 'SUCCESS',
    validation_errors: [],
  };
}

/**
 * Prepares clean input bundle for the Day 1 Bayesian source inference engine.
 * Converts GenericDetectionProcessingResult into BayesianInferenceInput without
 * modifying any frozen Bayesian inference mathematics.
 */
export function buildBayesianInferenceInput(
  result: GenericDetectionProcessingResult,
  extraContext?: {
    osm_context?: OsmContextResponse | null;
    weather_context?: WeatherContextResponse | null;
    sentinel_context?: Sentinel2SwirResponse | null;
    ml_discriminator?: ThermalSourceDiscriminatorOutput | null;
  }
): BayesianInferenceInput {
  const obs = result.source_observation;
  const ctx = result.derived_context;

  const baseline = ctx.associated_facility
    ? getFacilityBaselineSync(ctx.associated_facility.id, obs.acquisition_time)
    : null;

  return {
    frp: obs.frp,
    brightness_kelvin: obs.brightness_kelvin ?? undefined,
    brightness_ti4: obs.brightness_ti4 ?? undefined,
    brightness_ti5: obs.brightness_ti5 ?? undefined,
    brightness_delta: obs.brightness_delta ?? undefined,
    sensor: obs.sensor,
    day_night: obs.day_night,
    confidence: obs.confidence,
    satellite: obs.satellite,
    scan: obs.scan ?? undefined,
    track: obs.track ?? undefined,

    spatial_association: ctx.spatial_association,
    distance_to_facility_meters: ctx.facility_distance_meters,
    distance_to_zone_meters: ctx.distance_to_zone_meters,
    facility_id: ctx.associated_facility?.id || null,
    facility_name: ctx.associated_facility?.name || null,
    facility_category: ctx.associated_facility?.category || null,
    matched_zone_name: ctx.matched_zone_name,
    is_inside_polygon: ctx.is_inside_polygon,

    behavioural_status: ctx.behavioural_status,
    baseline,

    persistence_context: {
      status: ctx.persistence_status,
      summary: ctx.persistence_summary,
    },

    osm_context: extraContext?.osm_context ?? null,
    weather_context: extraContext?.weather_context ?? null,
    sentinel_context: extraContext?.sentinel_context ?? null,
    ml_discriminator: extraContext?.ml_discriminator ?? null,
  };
}
