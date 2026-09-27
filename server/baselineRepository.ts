import fs from 'fs';
import path from 'path';
import { getDbPool } from './db.js';
import { MONITORED_FACILITIES } from './facilities.js';
import { ServerFacility } from './types.js';
import {
  EmpiricalFacilityBaseline,
  HistoricalThermalObservation,
  buildEmpiricalFacilityBaseline,
  buildEventSpecificBaseline,
  calculatePercentile,
  calculateMad,
} from './historicalIngestion.js';
import { haversineDistanceMeters } from './geospatial.js';

// In-memory cache for baselines
const baselineCache = new Map<string, EmpiricalFacilityBaseline>();

/**
 * Invalidates the in-memory baseline cache for a specific facility or globally.
 */
export function invalidateBaselineCache(facilityId?: string): void {
  if (facilityId) {
    for (const key of baselineCache.keys()) {
      if (key.startsWith(facilityId)) {
        baselineCache.delete(key);
      }
    }
  } else {
    baselineCache.clear();
  }
}

/**
 * Generates an Unassessed / Insufficient Data baseline object when 0 or < 30 observations exist
 */
export function generateInsufficientDataBaseline(
  facility: ServerFacility,
  count: number = 0
): EmpiricalFacilityBaseline {
  const isZero = count === 0;
  const status = isZero ? 'NOT_ASSESSED' : 'LIMITED';
  const prov = isZero
    ? 'NOT ASSESSED · NO HISTORICAL COVERAGE (0 records found)'
    : `LIMITED · REAL NASA FIRMS (${count} records found, minimum 30 required for empirical baseline)`;

  return {
    facility_id: facility.id,
    facility_name: facility.name,
    baseline_status: status,
    minimum_threshold_required: 30,
    provenance: prov,
    baseline_period: {
      start_date: 'N/A',
      end_date: 'N/A',
      total_days: 0,
    },
    metrics: {
      observation_count: count,
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
    persistence_classification: count === 1 ? 'SINGLE_OBSERVATION' : count > 1 ? 'RECURRENT' : 'NO_HISTORY',
    provenance_type: 'INSUFFICIENT_DATA',
    population_scope: isZero ? 'NOT_APPLICABLE' : 'FACILITY_ASSOCIATED',
    created_at: new Date().toISOString(),
  };
}

/**
 * Constructs baseline profile from candidate observations (e.g. Jamshedpur, Dahej, Paradip).
 */
function buildCandidateBaselineFromObservations(
  facility: ServerFacility,
  rawObservations: HistoricalThermalObservation[],
  eventTimestampIso?: string
): EmpiricalFacilityBaseline {
  // Filter associated observations strictly
  let associated = rawObservations.filter(
    (o) =>
      o.associated_facility_id === facility.id &&
      (o.association_type === 'KNOWN_THERMAL_ZONE' ||
        o.association_type === 'FACILITY_OFF_ZONE' ||
        o.association_type === 'FACILITY_BUFFER')
  );

  if (eventTimestampIso) {
    const cutoffTime = new Date(eventTimestampIso).getTime();
    associated = associated.filter((o) => new Date(o.acquisition_timestamp).getTime() < cutoffTime);
  }

  if (associated.length === 0) {
    return generateInsufficientDataBaseline(facility, 0);
  }

  const dates = associated.map((o) => o.acquisition_date).sort();
  const startDate = dates[0] || '2026-01-01';
  const endDate = dates[dates.length - 1] || '2026-04-25';
  const totalDays = Math.max(
    1,
    Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 86400)) + 1
  );
  const uniqueDates = new Set(dates);
  const observationDays = uniqueDates.size;
  const observationsPerDay = Math.round((associated.length / totalDays) * 100) / 100;

  // Calculate FRP statistics
  const frpValues = associated.map((o) => o.frp).sort((a, b) => a - b);
  const frpMedian = calculatePercentile(frpValues, 50);
  const frpP25 = calculatePercentile(frpValues, 25);
  const frpP75 = calculatePercentile(frpValues, 75);
  const frpP90 = calculatePercentile(frpValues, 90);
  const frpP95 = calculatePercentile(frpValues, 95);
  const frpMax = frpValues.length > 0 ? frpValues[frpValues.length - 1] : 0;
  const frpIqr = Math.round((frpP75 - frpP25) * 100) / 100;
  const frpMad = calculateMad(frpValues, frpMedian);

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

  // Spatial distribution
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

  // Cluster Centroid & Radius
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
  const clusterRadiusMeters = Math.round(calculatePercentile(distancesFromCentroid, 95));

  // Recurrence & Persistence
  const recurrenceRate = Math.round((observationDays / Math.max(1, totalDays)) * 1000) / 10;
  let persistenceClassification: 'NO_HISTORY' | 'SINGLE_OBSERVATION' | 'RECURRENT' | 'PERSISTENT' = 'NO_HISTORY';
  if (associated.length === 0) persistenceClassification = 'NO_HISTORY';
  else if (associated.length === 1) persistenceClassification = 'SINGLE_OBSERVATION';
  else if (associated.length >= 15 && observationDays >= 7) persistenceClassification = 'PERSISTENT';
  else persistenceClassification = 'RECURRENT';

  // Classification logic based on operational rules:
  // Jamshedpur (N=1302 >= 30, but multi-complex steel plant with single modeled thermal zone -> CANDIDATE_EMPIRICAL_WITH_REVIEW)
  // Dahej (N=18 < 30 -> LIMITED)
  // Paradip (N=10 < 30 -> LIMITED)
  if (facility.id === 'FAC-JHK-JAMSHEDPUR-27') {
    return {
      facility_id: facility.id,
      facility_name: facility.name,
      baseline_status: 'CANDIDATE_EMPIRICAL_WITH_REVIEW',
      minimum_threshold_required: 30,
      provenance: `CANDIDATE · REAL NASA FIRMS · REVIEW REQUIRED (${associated.length} associated observations across ${observationDays} active days / ${totalDays} calendar days [${Math.round((observationDays / totalDays) * 1000) / 10}% active-day coverage], ${nightPct}% night / ${dayPct}% day — candidate empirical baseline, review required)`,
      provenance_type: 'FACILITY_ASSOCIATED',
      population_scope: 'FACILITY_ASSOCIATED',
      cutoff_timestamp_iso: eventTimestampIso,
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
      created_at: new Date().toISOString(),
    };
  }

  if (associated.length < 30) {
    return {
      facility_id: facility.id,
      facility_name: facility.name,
      baseline_status: 'LIMITED',
      minimum_threshold_required: 30,
      provenance: `LIMITED · REAL NASA FIRMS (${associated.length} associated records found across ${observationDays} active days, minimum 30 required for empirical baseline)`,
      provenance_type: 'INSUFFICIENT_DATA',
      population_scope: 'FACILITY_ASSOCIATED',
      cutoff_timestamp_iso: eventTimestampIso,
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
      created_at: new Date().toISOString(),
    };
  }

  // Fallback for general N >= 30 candidate
  return {
    facility_id: facility.id,
    facility_name: facility.name,
    baseline_status: 'CANDIDATE_EMPIRICAL_WITH_REVIEW',
    minimum_threshold_required: 30,
    provenance: `CANDIDATE · REAL NASA FIRMS · REVIEW REQUIRED (${associated.length} records, ${observationDays} active days)`,
    provenance_type: 'FACILITY_ASSOCIATED',
    population_scope: 'FACILITY_ASSOCIATED',
    cutoff_timestamp_iso: eventTimestampIso,
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
    created_at: new Date().toISOString(),
  };
}

/**
 * Synchronously loads or constructs baseline for a facility from memory, disk, or historical observations.
 * When eventTimestampIso is provided, only observations prior to that event are included (prevents future leakage).
 */
export function getFacilityBaselineSync(
  facilityId: string,
  eventTimestampIso?: string
): EmpiricalFacilityBaseline | null {
  const cacheKey = eventTimestampIso ? `${facilityId}_${eventTimestampIso}` : facilityId;
  if (baselineCache.has(cacheKey)) {
    return baselineCache.get(cacheKey)!;
  }

  const facility = MONITORED_FACILITIES.find((f) => f.id === facilityId);
  if (!facility) return null;

  // 1. Check if a pre-compiled verified baseline JSON exists (Jamnagar, Vadinar)
  if (!eventTimestampIso) {
    const baselineFilePath = path.join(process.cwd(), 'data', 'processed', `${facilityId}_baseline.json`);
    if (fs.existsSync(baselineFilePath)) {
      try {
        const raw = fs.readFileSync(baselineFilePath, 'utf8');
        const parsed: EmpiricalFacilityBaseline = JSON.parse(raw);
        if (!parsed.provenance_type) {
          parsed.provenance_type = 'PERSISTED_REGIONAL_SUMMARY';
        }
        if (!parsed.population_scope) {
          parsed.population_scope = 'REGIONAL_CORPUS';
        }
        baselineCache.set(cacheKey, parsed);
        return parsed;
      } catch (e) {
        console.error(`[Baseline Repository] Error reading file ${baselineFilePath}:`, e);
      }
    }
  }

  // 2. Check if we have processed historical observations for this facility
  const obsFilePath = path.join(process.cwd(), 'data', 'processed', `${facilityId}_historical_observations.json`);
  if (fs.existsSync(obsFilePath)) {
    try {
      const raw = fs.readFileSync(obsFilePath, 'utf8');
      const observations: HistoricalThermalObservation[] = JSON.parse(raw);

      if (eventTimestampIso) {
        const eventBaseline = buildEventSpecificBaseline(facility, observations, eventTimestampIso, 30);
        baselineCache.set(cacheKey, eventBaseline);
        return eventBaseline;
      }

      if (observations.length >= 30) {
        const dates = observations.map((o) => o.acquisition_date).sort();
        const fullBaseline = buildEmpiricalFacilityBaseline(
          facility,
          observations,
          dates[0] || '2026-01-01',
          dates[dates.length - 1] || '2026-04-25',
          30
        );
        baselineCache.set(cacheKey, fullBaseline);
        return fullBaseline;
      } else {
        const limited = buildCandidateBaselineFromObservations(facility, observations, eventTimestampIso);
        baselineCache.set(cacheKey, limited);
        return limited;
      }
    } catch (e) {
      console.error(`[Baseline Repository] Error reading historical observations from ${obsFilePath}:`, e);
    }
  }

  // 3. Check if candidate observations exist from the historical pilot (Jamshedpur, Dahej, Paradip)
  const candidateFilePath = path.join(process.cwd(), 'data', 'processed', `${facilityId}_candidate_observations.json`);
  if (fs.existsSync(candidateFilePath)) {
    try {
      const raw = fs.readFileSync(candidateFilePath, 'utf8');
      const candidateObs: HistoricalThermalObservation[] = JSON.parse(raw);
      const baseline = buildCandidateBaselineFromObservations(facility, candidateObs, eventTimestampIso);
      baselineCache.set(cacheKey, baseline);
      return baseline;
    } catch (e) {
      console.error(`[Baseline Repository] Error reading candidate observations from ${candidateFilePath}:`, e);
    }
  }

  // 4. Unassessed facilities lacking historical data (remaining 75 facilities)
  const unassessed = generateInsufficientDataBaseline(facility, 0);
  baselineCache.set(cacheKey, unassessed);
  return unassessed;
}

/**
 * Asynchronously loads baseline for a facility.
 */
export async function getFacilityBaseline(
  facilityId: string,
  eventTimestampIso?: string
): Promise<EmpiricalFacilityBaseline | null> {
  const syncBaseline = getFacilityBaselineSync(facilityId, eventTimestampIso);
  if (syncBaseline && (syncBaseline.baseline_status === 'EMPIRICAL' || syncBaseline.baseline_status === 'CANDIDATE_EMPIRICAL_WITH_REVIEW')) {
    return syncBaseline;
  }

  // Check PostgreSQL if available
  const db = getDbPool();
  if (db) {
    try {
      const res = await db.query('SELECT * FROM facility_baselines WHERE facility_id = $1;', [facilityId]);
      if (res.rows.length > 0) {
        const row = res.rows[0];
        const baseline: EmpiricalFacilityBaseline = {
          facility_id: row.facility_id,
          facility_name: row.facility_name,
          baseline_status: row.baseline_status,
          minimum_threshold_required: 30,
          provenance: row.provenance,
          baseline_period: {
            start_date: row.baseline_period_start.toISOString ? row.baseline_period_start.toISOString().slice(0, 10) : String(row.baseline_period_start),
            end_date: row.baseline_period_end.toISOString ? row.baseline_period_end.toISOString().slice(0, 10) : String(row.baseline_period_end),
            total_days: Math.round(
              (new Date(row.baseline_period_end).getTime() - new Date(row.baseline_period_start).getTime()) / (1000 * 3600 * 24)
            ),
          },
          metrics: {
            observation_count: row.total_observations,
            observation_days: row.observation_days,
            observations_per_day: row.observations_per_day,
            frp_median: row.frp_median,
            frp_p25: row.frp_p25,
            frp_p75: row.frp_p75,
            frp_p90: row.frp_p90,
            frp_p95: row.frp_p95,
            frp_max: row.frp_max,
            frp_iqr: Math.round((row.frp_p75 - row.frp_p25) * 100) / 100,
            frp_mad: row.frp_mad,
          },
          diurnal: {
            day_count: row.day_count,
            night_count: row.night_count,
            day_pct: row.total_observations > 0 ? Math.round((row.day_count / row.total_observations) * 100) : 0,
            night_pct: row.total_observations > 0 ? Math.round((row.night_count / row.total_observations) * 100) : 0,
            hour_distribution: row.hour_distribution,
          },
          spatial_distribution: row.zone_distributions,
          created_at: row.updated_at.toISOString(),
        };
        baselineCache.set(facilityId, baseline);
        return baseline;
      }
    } catch (e) {
      console.error(`[Baseline Repository] Error reading DB for ${facilityId}:`, e);
    }
  }

  return syncBaseline;
}

export async function getAllFacilityBaselines(): Promise<EmpiricalFacilityBaseline[]> {
  const baselines: EmpiricalFacilityBaseline[] = [];
  for (const fac of MONITORED_FACILITIES) {
    const b = await getFacilityBaseline(fac.id);
    if (b) baselines.push(b);
  }
  return baselines;
}

