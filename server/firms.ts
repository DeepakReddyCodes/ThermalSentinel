import fs from 'fs';
import path from 'path';
import {
  ServerThermalObservation,
  ServerFirmsResponse,
  ServerFacility,
  ObservationProvenance,
  IngestionValidationSummary,
  ValidationRecordError,
} from './types.js';
import { associateObservationWithFacilities } from './geospatial.js';

const PUBLIC_FEEDS: Record<string, string> = {
  VIIRS_NOAA20_NRT:
    'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_South_Asia_24h.csv',
  VIIRS_SNPP_NRT:
    'https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_South_Asia_24h.csv',
  MODIS_NRT:
    'https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_South_Asia_24h.csv',
};

// In-memory cache for all observations served or ingested
const GLOBAL_OBSERVATIONS_CACHE = new Map<string, ServerThermalObservation>();

export function getCachedObservationById(id: string): ServerThermalObservation | undefined {
  return GLOBAL_OBSERVATIONS_CACHE.get(id);
}

export function getAllCachedObservations(): ServerThermalObservation[] {
  return Array.from(GLOBAL_OBSERVATIONS_CACHE.values());
}

/**
 * Normalizes satellite identifier and instrument sensor deterministically
 */
export function normalizeSatelliteAndSensor(
  satRaw: string,
  sourceLabel = ''
): { satellite: string; sensor: 'VIIRS' | 'MODIS' } {
  const satUpper = (satRaw || '').trim().toUpperCase();
  const srcUpper = (sourceLabel || '').trim().toUpperCase();

  // 1. Direct match on satellite record column first
  if (
    satUpper.includes('N20') ||
    satUpper.includes('NOAA-20') ||
    satUpper.includes('NOAA20') ||
    satUpper.includes('J1') ||
    satUpper.includes('JPSS-1')
  ) {
    return { satellite: 'VIIRS-NOAA20', sensor: 'VIIRS' };
  }

  if (
    satUpper.includes('N21') ||
    satUpper.includes('NOAA-21') ||
    satUpper.includes('NOAA21') ||
    satUpper.includes('J2') ||
    satUpper.includes('JPSS-2')
  ) {
    return { satellite: 'VIIRS-NOAA21', sensor: 'VIIRS' };
  }

  if (
    satUpper.includes('SNPP') ||
    satUpper.includes('NPP') ||
    satUpper.includes('SUOMI') ||
    satUpper === 'N'
  ) {
    return { satellite: 'VIIRS-SNPP', sensor: 'VIIRS' };
  }

  if (
    satUpper.includes('TERRA') ||
    satUpper === '1' ||
    satUpper === 'T'
  ) {
    return { satellite: 'MODIS-Terra', sensor: 'MODIS' };
  }

  if (
    satUpper.includes('AQUA') ||
    satUpper === '2' ||
    satUpper === 'A'
  ) {
    return { satellite: 'MODIS-Aqua', sensor: 'MODIS' };
  }

  // 2. If sat column is empty or uninformative, infer from source feed label
  if (srcUpper.includes('NOAA20') || srcUpper.includes('NOAA-20')) {
    return { satellite: 'VIIRS-NOAA20', sensor: 'VIIRS' };
  }
  if (srcUpper.includes('NOAA21') || srcUpper.includes('NOAA-21')) {
    return { satellite: 'VIIRS-NOAA21', sensor: 'VIIRS' };
  }
  if (srcUpper.includes('SNPP') || srcUpper.includes('SUOMI')) {
    return { satellite: 'VIIRS-SNPP', sensor: 'VIIRS' };
  }
  if (srcUpper.includes('TERRA')) {
    return { satellite: 'MODIS-Terra', sensor: 'MODIS' };
  }
  if (srcUpper.includes('AQUA') || srcUpper.includes('MODIS')) {
    return { satellite: 'MODIS-Aqua', sensor: 'MODIS' };
  }
  if (srcUpper.includes('VIIRS')) {
    return { satellite: satRaw ? `VIIRS-${satRaw}` : 'VIIRS-NOAA20', sensor: 'VIIRS' };
  }

  return { satellite: satRaw || 'VIIRS-NOAA20', sensor: 'VIIRS' };
}

/**
 * Validates raw observation fields before they enter the analytical pipeline
 */
export function validateRawObservation(
  fields: {
    lat: number;
    lon: number;
    frp: number;
    isoTimestamp: string;
    satellite: string;
    confidenceRaw?: string;
    dayNightRaw?: string;
    brightnessTi4?: number;
    brightnessTi5?: number;
    brightnessT31?: number;
    brightnessPrimary?: number;
    scan?: number;
    track?: number;
  },
  lineNum = 1
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // 1. Latitude range [-90, 90]
  if (typeof fields.lat !== 'number' || isNaN(fields.lat) || !isFinite(fields.lat)) {
    errors.push(`Line ${lineNum}: Latitude must be a finite number (got ${fields.lat}).`);
  } else if (fields.lat < -90.0 || fields.lat > 90.0) {
    errors.push(`Line ${lineNum}: Latitude ${fields.lat} out of range [-90.0, 90.0].`);
  }

  // 2. Longitude range [-180, 180]
  if (typeof fields.lon !== 'number' || isNaN(fields.lon) || !isFinite(fields.lon)) {
    errors.push(`Line ${lineNum}: Longitude must be a finite number (got ${fields.lon}).`);
  } else if (fields.lon < -180.0 || fields.lon > 180.0) {
    errors.push(`Line ${lineNum}: Longitude ${fields.lon} out of range [-180.0, 180.0].`);
  }

  // 3. Timestamp validity
  if (!fields.isoTimestamp || typeof fields.isoTimestamp !== 'string') {
    errors.push(`Line ${lineNum}: Missing or invalid acquisition timestamp.`);
  } else {
    const parsedTime = new Date(fields.isoTimestamp).getTime();
    if (isNaN(parsedTime)) {
      errors.push(`Line ${lineNum}: Malformed timestamp "${fields.isoTimestamp}".`);
    } else {
      const year = new Date(parsedTime).getUTCFullYear();
      if (year < 2000 || year > 2100) {
        errors.push(`Line ${lineNum}: Acquisition year ${year} is outside valid satellite era [2000, 2100].`);
      }
    }
  }

  // 4. FRP numeric validity (must be non-negative finite number <= 10000 MW)
  if (typeof fields.frp !== 'number' || isNaN(fields.frp) || !isFinite(fields.frp)) {
    errors.push(`Line ${lineNum}: FRP must be a valid finite number.`);
  } else if (fields.frp < 0.0) {
    errors.push(`Line ${lineNum}: FRP cannot be negative (got ${fields.frp} MW).`);
  } else if (fields.frp > 10000.0) {
    errors.push(`Line ${lineNum}: FRP ${fields.frp} MW exceeds maximum plausible sensor threshold (10,000 MW).`);
  }

  // 5. Brightness temperature physical range (150K to 600K)
  const checkBrightness = (val: number | undefined, name: string) => {
    if (val !== undefined) {
      if (isNaN(val) || !isFinite(val) || val < 150.0 || val > 600.0) {
        errors.push(`Line ${lineNum}: ${name} ${val} K is outside physically plausible thermal range [150 K, 600 K].`);
      }
    }
  };
  checkBrightness(fields.brightnessPrimary, 'Brightness');
  checkBrightness(fields.brightnessTi4, 'bright_ti4');
  checkBrightness(fields.brightnessTi5, 'bright_ti5');
  checkBrightness(fields.brightnessT31, 'bright_t31');

  // 6. Scan & Track pixel dimensions (if present, must be > 0 and <= 10 km)
  if (fields.scan !== undefined && (isNaN(fields.scan) || fields.scan <= 0 || fields.scan > 10.0)) {
    errors.push(`Line ${lineNum}: Scan dimension ${fields.scan} is invalid (must be (0, 10] km).`);
  }
  if (fields.track !== undefined && (isNaN(fields.track) || fields.track <= 0 || fields.track > 10.0)) {
    errors.push(`Line ${lineNum}: Track dimension ${fields.track} is invalid (must be (0, 10] km).`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Parses raw CSV text returned from NASA FIRMS into validated, normalized ServerThermalObservation[]
 * with full validation summary and duplicate tracking.
 */
export function parseAndValidateFirmsCsv(
  csvText: string,
  sourceLabel: string,
  provenance: ObservationProvenance = 'REAL_FIRMS'
): {
  observations: ServerThermalObservation[];
  validation: IngestionValidationSummary;
} {
  const lines = csvText.trim().split('\n');
  const validation: IngestionValidationSummary = {
    total_raw_records: 0,
    valid_records: 0,
    invalid_records: 0,
    duplicate_records: 0,
    rejection_reasons: [],
  };

  if (lines.length < 2) {
    return { observations: [], validation };
  }

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
    throw new Error('Invalid NASA FIRMS CSV: mandatory "latitude" and "longitude" headers not found.');
  }

  const observations: ServerThermalObservation[] = [];
  const seenFingerprints = new Set<string>();

  for (let i = 1; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine) continue;
    validation.total_raw_records++;

    const cols = rawLine.split(',').map((c) => c.trim());
    if (cols.length <= Math.max(latIdx, lonIdx)) {
      validation.invalid_records++;
      validation.rejection_reasons.push({
        line: i + 1,
        reason: `Insufficient column count (${cols.length}) for required lat/lon headers.`,
        raw: rawLine,
      });
      continue;
    }

    const latRaw = parseFloat(cols[latIdx]);
    const lonRaw = parseFloat(cols[lonIdx]);

    // FRP
    let frp = 0.0;
    if (frpIdx !== -1 && cols[frpIdx]) {
      const parsedFrp = parseFloat(cols[frpIdx]);
      if (!isNaN(parsedFrp)) frp = parsedFrp;
    }

    // Brightness TI4 (VIIRS Mid-Wave)
    let brightnessTi4: number | undefined = undefined;
    if (brightTi4Idx !== -1 && cols[brightTi4Idx]) {
      const p = parseFloat(cols[brightTi4Idx]);
      if (!isNaN(p)) brightnessTi4 = p;
    }

    // Brightness TI5 (VIIRS Long-Wave)
    let brightnessTi5: number | undefined = undefined;
    if (brightTi5Idx !== -1 && cols[brightTi5Idx]) {
      const p = parseFloat(cols[brightTi5Idx]);
      if (!isNaN(p)) brightnessTi5 = p;
    }

    // Brightness T31 (MODIS Channel 31)
    let brightnessT31: number | undefined = undefined;
    if (brightT31Idx !== -1 && cols[brightT31Idx]) {
      const p = parseFloat(cols[brightT31Idx]);
      if (!isNaN(p)) brightnessT31 = p;
    }

    // Primary Brightness
    let brightnessPrimary: number | undefined = undefined;
    if (brightIdx !== -1 && cols[brightIdx]) {
      const p = parseFloat(cols[brightIdx]);
      if (!isNaN(p)) brightnessPrimary = p;
    } else if (brightnessTi4 !== undefined) {
      brightnessPrimary = brightnessTi4;
    }

    // Scan & Track (Do NOT invent placeholder values if missing!)
    let scan: number | undefined = undefined;
    if (scanIdx !== -1 && cols[scanIdx]) {
      const p = parseFloat(cols[scanIdx]);
      if (!isNaN(p)) scan = Math.round(p * 100) / 100;
    }

    let track: number | undefined = undefined;
    if (trackIdx !== -1 && cols[trackIdx]) {
      const p = parseFloat(cols[trackIdx]);
      if (!isNaN(p)) track = Math.round(p * 100) / 100;
    }

    // Date & Time normalization
    const acqDate = acqDateIdx !== -1 && cols[acqDateIdx] ? cols[acqDateIdx].trim() : '2026-09-01';
    const rawTime = acqTimeIdx !== -1 && cols[acqTimeIdx] ? cols[acqTimeIdx].replace(':', '').trim().padStart(4, '0') : '0000';
    const hour = rawTime.substring(0, 2);
    const minute = rawTime.substring(2, 4);
    const isoTimestamp = `${acqDate}T${hour}:${minute}:00Z`;

    // Satellite & Sensor normalization
    const satCol = satIdx !== -1 && cols[satIdx] ? cols[satIdx] : '';
    const { satellite, sensor } = normalizeSatelliteAndSensor(satCol, sourceLabel);

    // Validate raw record
    const valResult = validateRawObservation(
      {
        lat: latRaw,
        lon: lonRaw,
        frp,
        isoTimestamp,
        satellite,
        confidenceRaw: confIdx !== -1 ? cols[confIdx] : undefined,
        dayNightRaw: dayNightIdx !== -1 ? cols[dayNightIdx] : undefined,
        brightnessTi4,
        brightnessTi5,
        brightnessT31,
        brightnessPrimary,
        scan,
        track,
      },
      i + 1
    );

    if (!valResult.valid) {
      validation.invalid_records++;
      for (const err of valResult.errors) {
        validation.rejection_reasons.push({
          line: i + 1,
          reason: err,
          raw: rawLine,
        });
      }
      continue;
    }

    // Deterministic Normalization
    const normLat = Number(latRaw.toFixed(5));
    const normLon = Number(lonRaw.toFixed(5));
    const normFrp = Math.round(frp * 100) / 100;

    // Deduplication key
    const dedupeKey = `${normLat}_${normLon}_${isoTimestamp}_${satellite}_${normFrp}`;
    if (seenFingerprints.has(dedupeKey)) {
      validation.duplicate_records++;
      validation.rejection_reasons.push({
        line: i + 1,
        reason: `Duplicate observation detected for key [${dedupeKey}]. Skipped duplicate.`,
        raw: rawLine,
      });
      continue;
    }
    seenFingerprints.add(dedupeKey);

    // Confidence normalization
    const rawConf = confIdx !== -1 && cols[confIdx] ? cols[confIdx].trim() : 'nominal';
    const rawConfLower = rawConf.toLowerCase();
    let confidence: 'low' | 'nominal' | 'high' = 'nominal';
    const confNum = parseInt(rawConf, 10);
    if (rawConfLower === 'h' || rawConfLower === 'high' || (!isNaN(confNum) && confNum >= 80)) {
      confidence = 'high';
    } else if (rawConfLower === 'l' || rawConfLower === 'low' || (!isNaN(confNum) && confNum < 40)) {
      confidence = 'low';
    }

    // Day / Night normalization
    const dayNightCol = dayNightIdx !== -1 ? cols[dayNightIdx]?.trim().toUpperCase() : 'D';
    const dayNight: 'D' | 'N' = dayNightCol === 'N' || dayNightCol === 'NIGHT' ? 'N' : 'D';
    const instrumentPass: 'DAY_PASS' | 'NIGHT_PASS' = dayNight === 'N' ? 'NIGHT_PASS' : 'DAY_PASS';

    // Brightness Delta (only if both ti4 and ti5 are available)
    let brightnessDelta: number | undefined = undefined;
    if (brightnessTi4 !== undefined && brightnessTi5 !== undefined) {
      brightnessDelta = Math.round((brightnessTi4 - brightnessTi5) * 10) / 10;
    }

    const obsId = `FIRMS-${acqDate.replace(/-/g, '')}-${satellite.replace(/[^a-zA-Z0-9]/g, '')}-${i}`;

    const obsObj: ServerThermalObservation = {
      id: obsId,
      latitude: normLat,
      longitude: normLon,
      acquisition_time: isoTimestamp,
      acquisition_date: acqDate,
      satellite,
      sensor,
      instrument_pass: instrumentPass,
      frp: normFrp,
      brightness_kelvin: brightnessPrimary !== undefined ? Math.round(brightnessPrimary * 10) / 10 : undefined,
      brightness_ti4: brightnessTi4 !== undefined ? Math.round(brightnessTi4 * 10) / 10 : undefined,
      brightness_ti5: brightnessTi5 !== undefined ? Math.round(brightnessTi5 * 10) / 10 : undefined,
      brightness_t31: brightnessT31 !== undefined ? Math.round(brightnessT31 * 10) / 10 : undefined,
      brightness_delta: brightnessDelta,
      confidence,
      raw_confidence: rawConf,
      day_night: dayNight,
      scan,
      track,
      source_type: 'thermal_anomaly',
      provenance,
      is_real_data: provenance !== 'CONTROLLED_TEST',
      raw_record: rawLine,
    };

    observations.push(obsObj);
    validation.valid_records++;
  }

  for (const o of observations) {
    GLOBAL_OBSERVATIONS_CACHE.set(o.id, o);
  }

  return { observations, validation };
}

/**
 * Standard parse interface for backwards compatibility.
 * Consolidates all input paths through parseAndValidateFirmsCsv.
 */
export function parseFirmsCsv(csvText: string, sourceLabel: string): ServerThermalObservation[] {
  const result = parseAndValidateFirmsCsv(csvText, sourceLabel, 'REAL_FIRMS');
  return result.observations;
}

/**
 * Fetches real live NASA FIRMS thermal anomaly observations and runs universal assessment
 */
export async function fetchLiveFirmsObservations(options: {
  source?: string;
  country?: string;
  dayRange?: number;
  minFrp?: number;
  associateFacilities?: boolean;
  facilities?: ServerFacility[];
}): Promise<ServerFirmsResponse> {
  const source = options.source || 'VIIRS_NOAA20_NRT';
  const country = options.country || 'IND';
  const dayRange = Math.min(10, Math.max(1, options.dayRange || 1));
  const minFrp = options.minFrp || 0.0;
  const apiKey = process.env.FIRMS_MAP_KEY?.trim();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);

  try {
    // 1. If FIRMS_MAP_KEY configured, attempt NASA FIRMS REST API
    if (apiKey) {
      const restUrl = `https://firms.modaps.eosdis.nasa.gov/api/country/csv/${apiKey}/${source}/${country}/${dayRange}`;
      try {
        const resp = await fetch(restUrl, { signal: controller.signal });
        if (resp.ok) {
          const text = await resp.text();
          if (!text.trim().startsWith('Invalid API call')) {
            clearTimeout(timeoutId);
            const { observations: parsedObs, validation } = parseAndValidateFirmsCsv(
              text,
              source,
              'REAL_FIRMS'
            );
            let obs = parsedObs;
            if (minFrp > 0) {
              obs = obs.filter((o) => o.frp >= minFrp);
            }
            if (options.associateFacilities && options.facilities) {
              for (const o of obs) {
                o.spatial_association = associateObservationWithFacilities(
                  o.latitude,
                  o.longitude,
                  o.frp,
                  options.facilities,
                  o.confidence,
                  {
                    obsId: o.id,
                    dayNight: o.day_night,
                    brightness_kelvin: o.brightness_kelvin,
                    brightness_ti4: o.brightness_ti4,
                    brightness_ti5: o.brightness_ti5,
                    brightness_delta: o.brightness_delta,
                    sensor: o.sensor,
                    satellite: o.satellite,
                  }
                );
              }
            }
            return {
              status: 'SUCCESS',
              count: obs.length,
              source: `NASA FIRMS REST API (${source}, country=${country}, days=${dayRange})`,
              is_live_external: true,
              data_mode: 'LIVE_EXTERNAL',
              observations: obs,
              validation_summary: validation,
              notes: 'Live observations retrieved via NASA FIRMS REST API with FIRMS_MAP_KEY.',
              timestamp: new Date().toISOString(),
            };
          }
        }
      } catch {
        // Fall back to open feed
      }
    }

    // 2. Open Near Real-Time 24-hour Feeds
    const feedUrl = PUBLIC_FEEDS[source] || PUBLIC_FEEDS['VIIRS_NOAA20_NRT'];
    const resp = await fetch(feedUrl, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!resp.ok) {
      return loadFallbackObservations(
        options,
        `NASA FIRMS feed returned HTTP status ${resp.status}`
      );
    }

    const text = await resp.text();
    const { observations: parsedObs, validation } = parseAndValidateFirmsCsv(
      text,
      source,
      'REAL_FIRMS'
    );
    let obs = parsedObs;

    if (minFrp > 0) {
      obs = obs.filter((o) => o.frp >= minFrp);
    }

    if (options.associateFacilities && options.facilities) {
      for (const o of obs) {
        o.spatial_association = associateObservationWithFacilities(
          o.latitude,
          o.longitude,
          o.frp,
          options.facilities,
          o.confidence,
          {
            obsId: o.id,
            dayNight: o.day_night,
            brightness_kelvin: o.brightness_kelvin,
            brightness_ti4: o.brightness_ti4,
            brightness_ti5: o.brightness_ti5,
            brightness_delta: o.brightness_delta,
            sensor: o.sensor,
            satellite: o.satellite,
          }
        );
      }
    }

    return {
      status: 'SUCCESS',
      count: obs.length,
      source: `NASA FIRMS Open NRT Feed (${source})`,
      is_live_external: true,
      data_mode: 'PUBLIC_FEED_LIVE',
      observations: obs,
      validation_summary: validation,
      notes:
        'Real satellite observations retrieved directly from NASA FIRMS Open NRT 24-hour feed. Universal evidence-guided source intelligence pipeline active across all detections.',
      timestamp: new Date().toISOString(),
    };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    const errorMsg = err instanceof Error ? err.message : String(err);
    return loadFallbackObservations(options, errorMsg);
  }
}

export {
  normalizeCanonicalFirmsObservation,
  processFirmsObservation,
  buildBayesianInferenceInput,
  type ProcessFirmsOptions,
} from './firmsProcessor.js';

/**
 * Loads verified local benchmark cache when NASA live feeds are unreachable or offline
 * Clearly isolated with LOCAL_BENCHMARK_CACHE provenance and never masquerading as real live data.
 */
function loadFallbackObservations(
  options: {
    minFrp?: number;
    associateFacilities?: boolean;
    facilities?: ServerFacility[];
  },
  reason: string
): ServerFirmsResponse {
  try {
    const processedDir = path.join(process.cwd(), 'data', 'processed');
    const allLoadedObs: ServerThermalObservation[] = [];

    if (fs.existsSync(processedDir)) {
      const files = fs.readdirSync(processedDir).filter((f) => f.endsWith('_historical_observations.json'));
      for (const file of files) {
        const filePath = path.join(processedDir, file);
        try {
          const raw = fs.readFileSync(filePath, 'utf8');
          const cached = JSON.parse(raw);
          const mapped: ServerThermalObservation[] = cached.map((c: any) => {
            const { satellite, sensor } = normalizeSatelliteAndSensor(c.satellite || 'VIIRS-NOAA20', 'VIIRS');
            const dayNight: 'D' | 'N' = (c.day_night || 'N').toUpperCase() === 'N' ? 'N' : 'D';
            const brightTi4 = c.brightness_ti4 ?? c.brightness_kelvin;
            const brightTi5 = c.brightness_ti5 ?? c.raw_payload?.bright_ti5 ?? 290.65;
            const brightDelta = brightTi4 !== undefined && brightTi5 !== undefined
              ? Math.round((brightTi4 - brightTi5) * 10) / 10
              : undefined;

            return {
              id: c.id,
              latitude: Number(c.latitude.toFixed(5)),
              longitude: Number(c.longitude.toFixed(5)),
              acquisition_time: c.acquisition_timestamp || `${c.acquisition_date}T12:00:00Z`,
              acquisition_date: c.acquisition_date || (c.acquisition_timestamp ? c.acquisition_timestamp.slice(0, 10) : '2026-02-25'),
              satellite,
              sensor,
              instrument_pass: dayNight === 'N' ? 'NIGHT_PASS' : 'DAY_PASS',
              frp: Math.round(c.frp * 100) / 100,
              brightness_kelvin: c.brightness_kelvin ? Math.round(c.brightness_kelvin * 10) / 10 : undefined,
              brightness_ti4: brightTi4 !== undefined ? Math.round(brightTi4 * 10) / 10 : undefined,
              brightness_ti5: brightTi5 !== undefined ? Math.round(brightTi5 * 10) / 10 : undefined,
              brightness_delta: brightDelta,
              confidence: c.confidence || 'nominal',
              raw_confidence: c.confidence || 'nominal',
              day_night: dayNight,
              scan: c.scan !== undefined ? Number(c.scan.toFixed(2)) : undefined,
              track: c.track !== undefined ? Number(c.track.toFixed(2)) : undefined,
              source_type: 'thermal_anomaly',
              provenance: 'LOCAL_BENCHMARK_CACHE',
              is_real_data: true,
              raw_record: c.raw_payload?.line || undefined,
            };
          });
          allLoadedObs.push(...mapped);
        } catch {}
      }
    }

    if (allLoadedObs.length > 0) {
      let obs = allLoadedObs;

      if (options.minFrp && options.minFrp > 0) {
        obs = obs.filter((o) => o.frp >= options.minFrp!);
      }

      // Limit to 60 events for presentation performance
      obs = obs.slice(0, 60);

      if (options.associateFacilities && options.facilities) {
        for (const o of obs) {
          o.spatial_association = associateObservationWithFacilities(
            o.latitude,
            o.longitude,
            o.frp,
            options.facilities,
            o.confidence,
            {
              obsId: o.id,
              dayNight: o.day_night,
              brightness_kelvin: o.brightness_kelvin,
              brightness_ti4: o.brightness_ti4,
              brightness_ti5: o.brightness_ti5,
              brightness_delta: o.brightness_delta,
              sensor: o.sensor,
              satellite: o.satellite,
            }
          );
        }
      }

      for (const o of obs) {
        GLOBAL_OBSERVATIONS_CACHE.set(o.id, o);
      }

      return {
        status: 'SUCCESS',
        count: obs.length,
        source: 'ThermalSentinel Verified Local Benchmark Cache',
        is_live_external: false,
        data_mode: 'LOCAL_BENCHMARK_CACHE',
        observations: obs,
        notes: `Live feed fallback active (${reason}). Loaded verified historical benchmark observations.`,
        timestamp: new Date().toISOString(),
      };
    }
  } catch (err: unknown) {
    console.error('Error loading fallback observations:', err);
  }

  return {
    status: 'ERROR',
    count: 0,
    source: 'NASA FIRMS',
    is_live_external: false,
    data_mode: 'UNAVAILABLE_NO_KEY',
    observations: [],
    notes: `Failed to retrieve FIRMS observations: ${reason}`,
    timestamp: new Date().toISOString(),
  };
}
