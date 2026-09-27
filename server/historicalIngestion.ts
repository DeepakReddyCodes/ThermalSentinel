import fs from 'fs';
import path from 'path';
import { getDbPool } from './db.js';
import { MONITORED_FACILITIES } from './facilities.js';
import { associateObservationWithFacilities, haversineDistanceMeters } from './geospatial.js';
import { ServerFacility } from './types.js';
import { normalizeSatelliteAndSensor } from './firms.js';

export interface RawHistoricalQueryOptions {
  facilityId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  bbox: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  products: string[]; // e.g. ['VIIRS_NOAA20_SP', 'VIIRS_SNPP_SP']
}

export interface HistoricalThermalObservation {
  id: string;
  latitude: number;
  longitude: number;
  acquisition_date: string;
  acquisition_time: string;
  acquisition_timestamp: string;
  satellite: string;
  sensor: string;
  frp: number;
  confidence: 'low' | 'nominal' | 'high';
  brightness_kelvin: number;
  scan: number;
  track: number;
  day_night: 'D' | 'N';
  associated_facility_id: string;
  associated_facility_name: string;
  association_type: 'KNOWN_THERMAL_ZONE' | 'FACILITY_OFF_ZONE' | 'FACILITY_BUFFER' | 'UNASSOCIATED';
  matched_zone_id: string | null;
  matched_zone_name: string | null;
  distance_to_zone_meters: number | null;
  distance_to_facility_meters: number | null;
  is_inside_polygon: boolean;
  raw_payload?: Record<string, any>;
}

export interface EmpiricalFacilityBaseline {
  facility_id: string;
  facility_name: string;
  baseline_status: 'EMPIRICAL' | 'LIMITED' | 'CANDIDATE_EMPIRICAL_WITH_REVIEW' | 'CONTROLLED' | 'INSUFFICIENT_DATA' | 'NOT_ASSESSED' | 'NONE';
  minimum_threshold_required: number;
  provenance: string;
  cutoff_timestamp_iso?: string;
  provenance_type?: 'EVENT_SPECIFIC_SLICED' | 'PERSISTED_REGIONAL_SUMMARY' | 'CONTROLLED_PROTOTYPE' | 'INSUFFICIENT_DATA' | 'FACILITY_ASSOCIATED' | 'CANDIDATE_PILOT' | 'LIMITED_PILOT';
  population_scope?: 'FACILITY_ASSOCIATED' | 'REGIONAL_CORPUS' | 'CONTROLLED' | 'NOT_APPLICABLE';
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
    frp_mad: number; // Median Absolute Deviation
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
  cluster_centroid?: [number, number];
  cluster_radius_meters?: number;
  temporal_frequency?: number;
  recurrence_rate?: number;
  persistence_classification?: 'NO_HISTORY' | 'SINGLE_OBSERVATION' | 'RECURRENT' | 'PERSISTENT';
  created_at: string;
}

/**
 * Calculates percentiles using linear interpolation
 */
export function calculatePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (percentile / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  if (lower === upper) return Math.round(sorted[lower] * 100) / 100;
  const val = sorted[lower] * (1 - weight) + sorted[upper] * weight;
  return Math.round(val * 100) / 100;
}

/**
 * Calculates Median Absolute Deviation (MAD)
 */
export function calculateMad(values: number[], median: number): number {
  if (values.length === 0) return 0;
  const deviations = values.map((v) => Math.abs(v - median));
  return calculatePercentile(deviations, 50);
}

/**
 * Fetch historical data chunks from NASA FIRMS API
 */
export async function fetchHistoricalFirmsData(
  options: RawHistoricalQueryOptions,
  apiKey: string
): Promise<{ rawFiles: string[]; totalRecordsFetched: number; observations: HistoricalThermalObservation[] }> {
  const { facilityId, startDate, endDate, bbox, products } = options;
  const facility = MONITORED_FACILITIES.find((f) => f.id === facilityId);
  if (!facility) throw new Error(`Facility ${facilityId} not found`);

  const rawDir = path.join(process.cwd(), 'data', 'raw');
  const processedDir = path.join(process.cwd(), 'data', 'processed');
  fs.mkdirSync(rawDir, { recursive: true });
  fs.mkdirSync(processedDir, { recursive: true });

  const rawFiles: string[] = [];
  const allParsedRows: any[] = [];

  const start = new Date(startDate);
  const end = new Date(endDate);
  const bboxStr = `${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]}`;

  for (const product of products) {
    let current = new Date(start);
    const productRawLines: string[] = [];
    let headerRecorded = false;

    console.log(`[Historical Ingestion] Querying NASA FIRMS for ${product} from ${startDate} to ${endDate}...`);

    while (current <= end) {
      const chunkStartStr = current.toISOString().slice(0, 10);
      const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${apiKey}/${product}/${bboxStr}/5/${chunkStartStr}`;

      try {
        const resp = await fetch(url);
        if (resp.ok) {
          const text = await resp.text();
          if (!text.startsWith('Invalid')) {
            const lines = text.trim().split('\n');
            if (lines.length > 0) {
              if (!headerRecorded) {
                productRawLines.push(lines[0]);
                headerRecorded = true;
              }
              for (let i = 1; i < lines.length; i++) {
                if (lines[i].trim()) {
                  productRawLines.push(lines[i]);
                  // Also record for parsing
                  allParsedRows.push({ line: lines[i], header: lines[0], product });
                }
              }
            }
          }
        }
      } catch (err) {
        console.error(`[Historical Ingestion] Error querying ${url}:`, err);
      }

      // Increment by 5 days
      current.setDate(current.getDate() + 5);
      // Small pause to be gentle with NASA rate limits
      await new Promise((r) => setTimeout(r, 150));
    }

    // Save RAW CSV separately (Step 1 requirement: Never mutate raw source data)
    const rawFileName = `${facilityId}_${product}_${startDate}_${endDate}_raw.csv`;
    const rawFilePath = path.join(rawDir, rawFileName);
    fs.writeFileSync(rawFilePath, productRawLines.join('\n'), 'utf8');
    rawFiles.push(rawFilePath);
    console.log(`[Historical Ingestion] Saved raw dataset: ${rawFilePath} (${productRawLines.length - 1} records)`);
  }

  // Parse raw rows into normalized observations
  const observations: HistoricalThermalObservation[] = [];
  let rowSeq = 1;

  for (const item of allParsedRows) {
    const headers = item.header.split(',').map((h: string) => h.trim().toLowerCase());
    const cols = item.line.split(',').map((c: string) => c.trim());

    const latIdx = headers.indexOf('latitude');
    const lonIdx = headers.indexOf('longitude');
    const frpIdx = headers.indexOf('frp');
    const brightIdx = headers.indexOf('bright_ti4') !== -1 ? headers.indexOf('bright_ti4') : headers.indexOf('brightness');
    const dateIdx = headers.indexOf('acq_date');
    const timeIdx = headers.indexOf('acq_time');
    const satIdx = headers.indexOf('satellite');
    const confIdx = headers.indexOf('confidence');
    const dnIdx = headers.indexOf('daynight');
    const scanIdx = headers.indexOf('scan');
    const trackIdx = headers.indexOf('track');

    if (latIdx === -1 || lonIdx === -1) continue;
    const lat = parseFloat(cols[latIdx]);
    const lon = parseFloat(cols[lonIdx]);
    if (isNaN(lat) || isNaN(lon)) continue;

    const frp = frpIdx !== -1 && cols[frpIdx] ? parseFloat(cols[frpIdx]) : 0;
    const bright = brightIdx !== -1 && cols[brightIdx] ? parseFloat(cols[brightIdx]) : 0;
    const acqDate = dateIdx !== -1 && cols[dateIdx] ? cols[dateIdx] : '2026-01-01';
    const rawTime = timeIdx !== -1 && cols[timeIdx] ? cols[timeIdx].padStart(4, '0') : '0000';
    const hour = rawTime.substring(0, 2);
    const min = rawTime.substring(2, 4);
    const timestamp = `${acqDate}T${hour}:${min}:00Z`;

    const satRaw = satIdx !== -1 && cols[satIdx] ? cols[satIdx] : item.product;
    const { satellite: sat, sensor } = normalizeSatelliteAndSensor(satRaw, item.product);
    const rawConf = confIdx !== -1 && cols[confIdx] ? cols[confIdx].toLowerCase() : 'nominal';
    let conf: 'low' | 'nominal' | 'high' = 'nominal';
    const confNum = parseInt(rawConf, 10);
    if (rawConf === 'h' || rawConf === 'high' || (!isNaN(confNum) && confNum >= 80)) conf = 'high';
    else if (rawConf === 'l' || rawConf === 'low' || (!isNaN(confNum) && confNum < 40)) conf = 'low';

    const dayNight: 'D' | 'N' = dnIdx !== -1 && cols[dnIdx]?.toUpperCase() === 'N' ? 'N' : 'D';
    const scan = scanIdx !== -1 && cols[scanIdx] && !isNaN(parseFloat(cols[scanIdx])) ? parseFloat(cols[scanIdx]) : 0.45;
    const track = trackIdx !== -1 && cols[trackIdx] && !isNaN(parseFloat(cols[trackIdx])) ? parseFloat(cols[trackIdx]) : 0.45;

    const normLat = Number(lat.toFixed(5));
    const normLon = Number(lon.toFixed(5));

    // Run spatial association against the facility
    const assoc = associateObservationWithFacilities(normLat, normLon, frp, [facility], conf);

    const obs: HistoricalThermalObservation = {
      id: `HIST-${acqDate.replace(/-/g, '')}-${sat.replace(/[^a-zA-Z0-9]/g, '')}-${rowSeq++}`,
      latitude: normLat,
      longitude: normLon,
      acquisition_date: acqDate,
      acquisition_time: rawTime,
      acquisition_timestamp: timestamp,
      satellite: sat,
      sensor,
      frp: Math.round(frp * 100) / 100,
      confidence: conf,
      brightness_kelvin: Math.round(bright * 10) / 10,
      scan,
      track,
      day_night: dayNight,
      associated_facility_id: facility.id,
      associated_facility_name: facility.name,
      association_type: assoc.associated ? (assoc.association_type as any) : 'UNASSOCIATED',
      matched_zone_id: assoc.matched_zone ? 'ZONE-MATCHED' : null,
      matched_zone_name: assoc.matched_zone || null,
      distance_to_zone_meters: assoc.distance_to_zone_meters,
      distance_to_facility_meters: assoc.distance_meters,
      is_inside_polygon: assoc.is_inside_polygon,
      raw_payload: { line: item.line, product: item.product },
    };

    observations.push(obs);
  }

  // Save processed observations
  const processedFilePath = path.join(processedDir, `${facilityId}_historical_observations.json`);
  fs.writeFileSync(processedFilePath, JSON.stringify(observations, null, 2), 'utf8');
  console.log(`[Historical Ingestion] Saved ${observations.length} processed observations to ${processedFilePath}`);

  return {
    rawFiles,
    totalRecordsFetched: allParsedRows.length,
    observations,
  };
}

/**
 * Calculates empirical baseline metrics from the historical observation dataset
 */
export function buildEmpiricalFacilityBaseline(
  facility: ServerFacility,
  observations: HistoricalThermalObservation[],
  startDate: string,
  endDate: string,
  minSampleThreshold = 30
): EmpiricalFacilityBaseline {
  // Filter observations strictly associated with this facility (inside boundary or buffer)
  const associated = observations.filter(
    (o) =>
      o.associated_facility_id === facility.id &&
      (o.association_type === 'KNOWN_THERMAL_ZONE' ||
        o.association_type === 'FACILITY_OFF_ZONE' ||
        o.association_type === 'FACILITY_BUFFER')
  );

  const totalDays = Math.max(
    1,
    Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24))
  );

  if (associated.length < minSampleThreshold) {
    return {
      facility_id: facility.id,
      facility_name: facility.name,
      baseline_status: 'INSUFFICIENT_DATA',
      minimum_threshold_required: minSampleThreshold,
      provenance: `NASA FIRMS (${associated.length} records found, minimum ${minSampleThreshold} required)`,
      provenance_type: 'INSUFFICIENT_DATA',
      population_scope: 'FACILITY_ASSOCIATED',
      baseline_period: {
        start_date: startDate,
        end_date: endDate,
        total_days: totalDays,
      },
      metrics: {
        observation_count: associated.length,
        observation_days: 0,
        observations_per_day: 0,
        frp_median: 0,
        frp_p25: 0,
        frp_p75: 0,
        frp_p90: 0,
        frp_p95: 0,
        frp_max: 0,
        frp_iqr: 0,
        frp_mad: 0,
      },
      diurnal: {
        day_count: 0,
        night_count: 0,
        day_pct: 0,
        night_pct: 0,
        hour_distribution: Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0, frequency: 0 })),
      },
      spatial_distribution: {
        known_zone_count: 0,
        off_zone_count: 0,
        buffer_count: 0,
        zones: [],
      },
      created_at: new Date().toISOString(),
    };
  }

  // Calculate FRP statistics
  const frpValues = associated.map((o) => o.frp);
  const frpMedian = calculatePercentile(frpValues, 50);
  const frpP25 = calculatePercentile(frpValues, 25);
  const frpP75 = calculatePercentile(frpValues, 75);
  const frpP90 = calculatePercentile(frpValues, 90);
  const frpP95 = calculatePercentile(frpValues, 95);
  const frpMax = Math.max(...frpValues);
  const frpIqr = Math.round((frpP75 - frpP25) * 100) / 100;
  const frpMad = calculateMad(frpValues, frpMedian);

  // Observation days & frequency
  const uniqueDates = new Set(associated.map((o) => o.acquisition_date));
  const observationDays = uniqueDates.size;
  const observationsPerDay = Math.round((associated.length / totalDays) * 100) / 100;

  // Day / Night distribution
  const dayCount = associated.filter((o) => o.day_night === 'D').length;
  const nightCount = associated.filter((o) => o.day_night === 'N').length;
  const dayPct = Math.round((dayCount / associated.length) * 100);
  const nightPct = Math.round((nightCount / associated.length) * 100);

  // 24-hour distribution
  const hourCounts = new Array(24).fill(0);
  for (const obs of associated) {
    const hr = parseInt(obs.acquisition_time.substring(0, 2), 10);
    if (!isNaN(hr) && hr >= 0 && hr < 24) {
      hourCounts[hr]++;
    }
  }
  const hourDistribution = hourCounts.map((count, hr) => ({
    hour: hr,
    count,
    frequency: Math.round((count / associated.length) * 1000) / 1000,
  }));

  // Spatial distribution across known zones vs off-zone vs buffer
  const knownZoneCount = associated.filter((o) => o.association_type === 'KNOWN_THERMAL_ZONE').length;
  const offZoneCount = associated.filter((o) => o.association_type === 'FACILITY_OFF_ZONE').length;
  const bufferCount = associated.filter((o) => o.association_type === 'FACILITY_BUFFER').length;

  const zones = facility.known_thermal_zones.map((zone) => {
    const zoneObs = associated.filter((o) => o.matched_zone_name === zone.name || o.matched_zone_id === zone.id);
    const zFrps = zoneObs.map((o) => o.frp);
    return {
      zone_id: zone.id,
      zone_name: zone.name,
      count: zoneObs.length,
      pct: Math.round((zoneObs.length / associated.length) * 100),
      empirical_frp_median: calculatePercentile(zFrps, 50),
      empirical_frp_p95: calculatePercentile(zFrps, 95),
    };
  });

  // Cluster Centroid and Radius Calculation
  const lats = associated.map((o) => o.latitude);
  const lons = associated.map((o) => o.longitude);
  const meanLat = lats.reduce((sum, v) => sum + v, 0) / associated.length;
  const meanLon = lons.reduce((sum, v) => sum + v, 0) / associated.length;
  const clusterCentroid: [number, number] = [
    Math.round(meanLat * 10000) / 10000,
    Math.round(meanLon * 10000) / 10000,
  ];

  const distancesFromCentroid = associated.map((o) =>
    haversineDistanceMeters(meanLat, meanLon, o.latitude, o.longitude)
  );
  const p95Radius = calculatePercentile(distancesFromCentroid, 95);
  const clusterRadiusMeters = Math.round(p95Radius);

  // Recurrence & Persistence Classification
  const recurrenceRate = Math.round((observationDays / Math.max(1, totalDays)) * 1000) / 10;
  let persistenceClassification: 'NO_HISTORY' | 'SINGLE_OBSERVATION' | 'RECURRENT' | 'PERSISTENT' = 'NO_HISTORY';
  if (associated.length === 0) {
    persistenceClassification = 'NO_HISTORY';
  } else if (associated.length === 1) {
    persistenceClassification = 'SINGLE_OBSERVATION';
  } else if (associated.length >= 15 && observationDays >= 7) {
    persistenceClassification = 'PERSISTENT';
  } else {
    persistenceClassification = 'RECURRENT';
  }

  return {
    facility_id: facility.id,
    facility_name: facility.name,
    baseline_status: 'EMPIRICAL',
    minimum_threshold_required: minSampleThreshold,
    provenance: `Historical sample: ${startDate} to ${endDate} (${totalDays} days, ${associated.length} VIIRS observations)`,
    baseline_period: {
      start_date: startDate,
      end_date: endDate,
      total_days: totalDays,
    },
    metrics: {
      observation_count: associated.length,
      observation_days: observationDays,
      observations_per_day: observationsPerDay,
      frp_median: frpMedian,
      frp_p25: frpP25,
      frp_p75: frpP75,
      frp_p90: frpP90,
      frp_p95: frpP95,
      frp_max: frpMax,
      frp_iqr: frpIqr,
      frp_mad: frpMad,
    },
    diurnal: {
      day_count: dayCount,
      night_count: nightCount,
      day_pct: dayPct,
      night_pct: nightPct,
      hour_distribution: hourDistribution,
    },
    spatial_distribution: {
      known_zone_count: knownZoneCount,
      off_zone_count: offZoneCount,
      buffer_count: bufferCount,
      zones,
    },
    cluster_centroid: clusterCentroid,
    cluster_radius_meters: clusterRadiusMeters,
    temporal_frequency: observationsPerDay,
    recurrence_rate: recurrenceRate,
    persistence_classification: persistenceClassification,
    provenance_type: 'FACILITY_ASSOCIATED',
    population_scope: 'FACILITY_ASSOCIATED',
    created_at: new Date().toISOString(),
  };
}

/**
 * Constructs an event-specific empirical baseline strictly using observations BEFORE the evaluated event.
 * Prevents future-data leakage.
 */
export function buildEventSpecificBaseline(
  facility: ServerFacility,
  observations: HistoricalThermalObservation[],
  eventTimestampIso: string,
  minSampleThreshold = 30
): EmpiricalFacilityBaseline {
  const eventTime = new Date(eventTimestampIso).getTime();
  const priorObs = observations.filter((o) => {
    const t = new Date(o.acquisition_timestamp || `${o.acquisition_date}T00:00:00Z`).getTime();
    return !isNaN(t) && t < eventTime;
  });

  if (priorObs.length === 0) {
    return {
      facility_id: facility.id,
      facility_name: facility.name,
      baseline_status: 'INSUFFICIENT_DATA',
      minimum_threshold_required: minSampleThreshold,
      provenance: `Event-specific historical baseline prior to ${eventTimestampIso} (0 prior records, minimum ${minSampleThreshold} required)`,
      cutoff_timestamp_iso: eventTimestampIso,
      provenance_type: 'EVENT_SPECIFIC_SLICED',
      population_scope: 'FACILITY_ASSOCIATED',
      baseline_period: {
        start_date: 'N/A',
        end_date: eventTimestampIso.slice(0, 10),
        total_days: 0,
      },
      metrics: {
        observation_count: 0,
        observation_days: 0,
        observations_per_day: 0,
        frp_median: 0,
        frp_p25: 0,
        frp_p75: 0,
        frp_p90: 0,
        frp_p95: 0,
        frp_max: 0,
        frp_iqr: 0,
        frp_mad: 0,
      },
      diurnal: {
        day_count: 0,
        night_count: 0,
        day_pct: 0,
        night_pct: 0,
        hour_distribution: Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0, frequency: 0 })),
      },
      spatial_distribution: {
        known_zone_count: 0,
        off_zone_count: 0,
        buffer_count: 0,
        zones: [],
      },
      temporal_frequency: 0,
      recurrence_rate: 0,
      persistence_classification: 'NO_HISTORY',
      created_at: new Date().toISOString(),
    };
  }

  const dates = priorObs.map((o) => o.acquisition_date).sort();
  const startDate = dates[0];
  const endDate = dates[dates.length - 1];

  const baseline = buildEmpiricalFacilityBaseline(facility, priorObs, startDate, endDate, minSampleThreshold);
  baseline.cutoff_timestamp_iso = eventTimestampIso;
  baseline.provenance_type = 'EVENT_SPECIFIC_SLICED';
  baseline.population_scope = 'FACILITY_ASSOCIATED';
  baseline.provenance = `Historical sample strictly prior to ${eventTimestampIso}: ${startDate} to ${endDate} (${priorObs.length} facility observations, minimum ${minSampleThreshold} required)`;
  return baseline;
}

/**
 * Persists observations and baseline to PostgreSQL
 */
export async function persistToDatabase(
  observations: HistoricalThermalObservation[],
  baseline: EmpiricalFacilityBaseline
) {
  const db = getDbPool();
  if (!db) {
    console.log('[Database Persistence] No DB pool available. Data saved to file-backed JSON.');
    return;
  }

  try {
    // 1. Insert facility baseline
    await db.query(`
      INSERT INTO facility_baselines (
        facility_id, facility_name, baseline_period_start, baseline_period_end,
        total_observations, observation_days, observations_per_day,
        frp_median, frp_p25, frp_p75, frp_p90, frp_p95, frp_max, frp_mad,
        day_count, night_count, hour_distribution, zone_distributions,
        baseline_status, provenance, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, NOW()
      )
      ON CONFLICT (facility_id) DO UPDATE SET
        total_observations = EXCLUDED.total_observations,
        observation_days = EXCLUDED.observation_days,
        observations_per_day = EXCLUDED.observations_per_day,
        frp_median = EXCLUDED.frp_median,
        frp_p25 = EXCLUDED.frp_p25,
        frp_p75 = EXCLUDED.frp_p75,
        frp_p90 = EXCLUDED.frp_p90,
        frp_p95 = EXCLUDED.frp_p95,
        frp_max = EXCLUDED.frp_max,
        frp_mad = EXCLUDED.frp_mad,
        day_count = EXCLUDED.day_count,
        night_count = EXCLUDED.night_count,
        hour_distribution = EXCLUDED.hour_distribution,
        zone_distributions = EXCLUDED.zone_distributions,
        baseline_status = EXCLUDED.baseline_status,
        provenance = EXCLUDED.provenance,
        updated_at = NOW();
    `, [
      baseline.facility_id,
      baseline.facility_name,
      baseline.baseline_period.start_date,
      baseline.baseline_period.end_date,
      baseline.metrics.observation_count,
      baseline.metrics.observation_days,
      baseline.metrics.observations_per_day,
      baseline.metrics.frp_median,
      baseline.metrics.frp_p25,
      baseline.metrics.frp_p75,
      baseline.metrics.frp_p90,
      baseline.metrics.frp_p95,
      baseline.metrics.frp_max,
      baseline.metrics.frp_mad,
      baseline.diurnal.day_count,
      baseline.diurnal.night_count,
      JSON.stringify(baseline.diurnal.hour_distribution),
      JSON.stringify(baseline.spatial_distribution),
      baseline.baseline_status,
      baseline.provenance,
    ]);

    // 2. Batch insert observations (in chunks of 100)
    for (let i = 0; i < observations.length; i += 100) {
      const chunk = observations.slice(i, i + 100);
      const queryValues: any[] = [];
      const rowPlaceholders: string[] = [];

      chunk.forEach((o, idx) => {
        const offset = idx * 17;
        rowPlaceholders.push(`(
          $${offset + 1}, $${offset + 2}, $${offset + 3}, ST_SetSRID(ST_MakePoint($${offset + 3}, $${offset + 2}), 4326),
          $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10},
          $${offset + 11}, $${offset + 12}, TRUE, $${offset + 13}, $${offset + 14}, $${offset + 15}, $${offset + 16}, $${offset + 17}
        )`);
        queryValues.push(
          o.id,
          o.latitude,
          o.longitude,
          o.acquisition_timestamp,
          o.satellite,
          o.sensor,
          o.frp,
          o.brightness_kelvin,
          o.confidence,
          o.day_night,
          o.scan,
          o.track,
          o.associated_facility_id,
          o.association_type,
          o.matched_zone_id,
          o.distance_to_zone_meters,
          o.distance_to_facility_meters
        );
      });

      const sql = `
        INSERT INTO thermal_observations (
          id, latitude, longitude, geom, acquisition_time, satellite, sensor, frp,
          brightness_kelvin, confidence, day_night, scan, track, is_historical,
          associated_facility_id, association_type, matched_zone_id,
          distance_to_zone_meters, distance_to_facility_meters
        ) VALUES ${rowPlaceholders.join(', ')}
        ON CONFLICT (id) DO NOTHING;
      `;
      await db.query(sql, queryValues);
    }

    console.log(`[Database Persistence] Successfully persisted ${observations.length} observations and baseline to PostgreSQL!`);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[Database Persistence] Warning during DB persist:', errorMsg);
  }
}
