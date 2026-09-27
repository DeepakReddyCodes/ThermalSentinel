import fs from 'fs';
import path from 'path';
import { haversineDistanceMeters } from './geospatial.js';
import { getAllCachedObservations } from './firms.js';

export interface TemporalPersistenceContext {
  status: 'PERSISTENT' | 'RECURRENT' | 'SINGLE_OBSERVATION' | 'NO_HISTORICAL_DATA';
  is_persistent: boolean;
  persistence_category: 'PERSISTENT_MULTI_DAY' | 'RECURRING_INTERMITTENT' | 'TRANSIENT_SINGLE_PASS' | 'INSUFFICIENT_HISTORY';
  cluster_observation_count: number;
  collocated_observations_count: number;
  distinct_observation_days: number;
  distinct_active_days: number;
  night_fraction: number;
  is_night_dominant: boolean;
  first_observed_timestamp?: string;
  latest_observed_timestamp?: string;
  mean_frp_mw?: number;
  max_frp_mw?: number;
  search_radius_meters: number;
  summary: string;
  description: string;
}

let _cachedHistoricalObservations: Array<{
  id: string;
  latitude: number;
  longitude: number;
  acq_date?: string;
  day_night?: string;
  frp: number;
}> | null = null;

function loadLocalHistoricalObservationsSync(): Array<{
  id: string;
  latitude: number;
  longitude: number;
  acq_date?: string;
  day_night?: string;
  frp: number;
}> {
  if (_cachedHistoricalObservations !== null) {
    return _cachedHistoricalObservations;
  }

  const results: Array<{
    id: string;
    latitude: number;
    longitude: number;
    acq_date?: string;
    day_night?: string;
    frp: number;
  }> = [];

  const processedDir = path.join(process.cwd(), 'data', 'processed');
  if (fs.existsSync(processedDir)) {
    try {
      const files = fs.readdirSync(processedDir);
      for (const file of files) {
        if (!file.endsWith('_historical_observations.json') && !file.endsWith('_candidate_observations.json')) continue;
        const filePath = path.join(processedDir, file);
        try {
          const raw = fs.readFileSync(filePath, 'utf8');
          const allHist = JSON.parse(raw);
          const list = Array.isArray(allHist) ? allHist : (allHist.observations || []);
          for (const obs of list) {
            const dateStr =
              obs.acquisition_date ||
              obs.acq_date ||
              (obs.acquisition_timestamp ? obs.acquisition_timestamp.slice(0, 10) : undefined) ||
              (obs.acquisition_time && obs.acquisition_time.length >= 10 ? obs.acquisition_time.slice(0, 10) : 'unknown');

            results.push({
              id: obs.id,
              latitude: obs.latitude,
              longitude: obs.longitude,
              acq_date: dateStr,
              day_night: obs.day_night || obs.dayNight,
              frp: obs.frp,
            });
          }
        } catch {}
      }
    } catch {}
  }

  _cachedHistoricalObservations = results;
  return results;
}

/**
 * Evaluates whether an active thermal detection at (lat, lon) shows recurring historical multi-pass persistence
 * within a spatial radius (default 1000 meters).
 */
export function evaluateTemporalPersistence(
  lat: number,
  lon: number,
  excludeObsId?: string,
  radiusMeters: number = 1000
): TemporalPersistenceContext {
  const matchingObservations: Array<{
    id: string;
    latitude: number;
    longitude: number;
    acq_date?: string;
    day_night?: string;
    frp: number;
  }> = [];

  // 1. Check in-memory global FIRMS cache
  const cached = getAllCachedObservations();
  for (const obs of cached) {
    if (excludeObsId && obs.id === excludeObsId) continue;
    const dist = haversineDistanceMeters(lat, lon, obs.latitude, obs.longitude);
    if (dist <= radiusMeters) {
      matchingObservations.push({
        id: obs.id,
        latitude: obs.latitude,
        longitude: obs.longitude,
        acq_date: obs.acquisition_date || (obs.acquisition_time && obs.acquisition_time.length >= 10 ? obs.acquisition_time.slice(0, 10) : 'unknown'),
        day_night: obs.day_night,
        frp: obs.frp,
      });
    }
  }

  // 2. Check cached local processed datasets across all facilities
  const localHistorical = loadLocalHistoricalObservationsSync();
  for (const obs of localHistorical) {
    if (excludeObsId && obs.id === excludeObsId) continue;
    if (matchingObservations.some((m) => m.id === obs.id)) continue;
    const dist = haversineDistanceMeters(lat, lon, obs.latitude, obs.longitude);
    if (dist <= radiusMeters) {
      matchingObservations.push({
        id: obs.id,
        latitude: obs.latitude,
        longitude: obs.longitude,
        acq_date: obs.acq_date || 'unknown',
        day_night: obs.day_night,
        frp: obs.frp,
      });
    }
  }

  const count = matchingObservations.length;
  const distinctDays = new Set(matchingObservations.map((o) => o.acq_date || 'unknown')).size;
  const nightCount = matchingObservations.filter((o) => o.day_night === 'N').length;
  const nightFraction = count > 0 ? nightCount / count : 0;
  const isNightDominant = nightFraction >= 0.5;

  let totalFrp = 0;
  let maxFrp = 0;
  for (const o of matchingObservations) {
    totalFrp += o.frp || 0;
    if ((o.frp || 0) > maxFrp) maxFrp = o.frp;
  }
  const meanFrp = count > 0 ? Math.round((totalFrp / count) * 10) / 10 : 0;

  let status: TemporalPersistenceContext['status'] = 'NO_HISTORICAL_DATA';
  let category: TemporalPersistenceContext['persistence_category'] = 'INSUFFICIENT_HISTORY';
  let isPersistent = false;
  let desc = '';

  if (count >= 5 && distinctDays >= 3) {
    status = 'PERSISTENT';
    category = 'PERSISTENT_MULTI_DAY';
    isPersistent = true;
    desc = `Persistent thermal emitter: ${count} collocated detections across ${distinctDays} separate satellite passes within ${radiusMeters} m.`;
  } else if (count >= 2) {
    status = 'RECURRENT';
    category = 'RECURRING_INTERMITTENT';
    isPersistent = true;
    desc = `Recurring thermal activity: ${count} collocated detections across ${distinctDays} active days.`;
  } else if (count === 1) {
    status = 'SINGLE_OBSERVATION';
    category = 'TRANSIENT_SINGLE_PASS';
    isPersistent = false;
    desc = 'Single isolated detection in historical dataset; suggests transient burn event or low revisit history.';
  } else {
    status = 'NO_HISTORICAL_DATA';
    category = 'INSUFFICIENT_HISTORY';
    isPersistent = false;
    desc = 'No prior historical detections found within radius.';
  }

  return {
    status,
    is_persistent: isPersistent,
    persistence_category: category,
    cluster_observation_count: count,
    collocated_observations_count: count,
    distinct_observation_days: distinctDays,
    distinct_active_days: distinctDays,
    night_fraction: nightFraction,
    is_night_dominant: isNightDominant,
    mean_frp_mw: meanFrp,
    max_frp_mw: maxFrp,
    search_radius_meters: radiusMeters,
    summary: desc,
    description: desc,
  };
}
