import fs from 'fs';
import path from 'path';
import 'dotenv/config';
import { MONITORED_FACILITIES } from '../server/facilities.js';
import { findFacilitySpatialAssociation } from '../server/geospatial.js';
import { normalizeSatelliteAndSensor } from '../server/firms.js';
import { calculatePercentile, calculateMad, HistoricalThermalObservation, EmpiricalFacilityBaseline } from '../server/historicalIngestion.js';
import { buildFirmsPhysicalObservationKey } from './audit_firms_deduplication.js';
import { ServerFacility } from '../server/types.js';

interface HubConfig {
  facilityId: string;
  bbox: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
}

const TARGET_HUBS: HubConfig[] = [
  {
    facilityId: 'FAC-GUJ-HAZIRA-04',
    bbox: [72.64, 21.08, 72.72, 21.16],
  },
  {
    facilityId: 'FAC-MAH-TROMBAY-07',
    bbox: [72.87, 18.97, 72.93, 19.04],
  },
  {
    facilityId: 'FAC-HAR-PANIPAT-19',
    bbox: [76.84, 29.36, 76.92, 29.43],
  },
  {
    facilityId: 'FAC-WB-HALDIA-16',
    bbox: [88.05, 22.03, 88.11, 22.09],
  },
  {
    facilityId: 'FAC-PUN-BHATINDA-20',
    bbox: [74.90, 30.01, 74.97, 30.07],
  },
];

const START_DATE = '2026-01-01';
const END_DATE = '2026-04-25';
const PRODUCTS = ['VIIRS_NOAA20_SP', 'VIIRS_SNPP_SP', 'VIIRS_NOAA21_SP'];

export async function ingestFacilityFirmsHistorical(
  facilityId: string,
  customBbox?: [number, number, number, number]
): Promise<{ success: boolean; observationCount: number; activeDays: number; status: string; message: string }> {
  const apiKey = process.env.FIRMS_MAP_KEY;
  if (!apiKey) {
    return { success: false, observationCount: 0, activeDays: 0, status: 'NOT_ASSESSED', message: 'FIRMS_MAP_KEY not configured.' };
  }

  const facility = MONITORED_FACILITIES.find((f) => f.id === facilityId);
  if (!facility) {
    return { success: false, observationCount: 0, activeDays: 0, status: 'NOT_ASSESSED', message: `Facility ${facilityId} not found in registry.` };
  }

  const bbox: [number, number, number, number] = customBbox || [
    Math.round((facility.center[1] - 0.05) * 100) / 100,
    Math.round((facility.center[0] - 0.05) * 100) / 100,
    Math.round((facility.center[1] + 0.05) * 100) / 100,
    Math.round((facility.center[0] + 0.05) * 100) / 100,
  ];

  const rawDir = path.join(process.cwd(), 'data', 'raw');
  const processedDir = path.join(process.cwd(), 'data', 'processed');
  fs.mkdirSync(rawDir, { recursive: true });
  fs.mkdirSync(processedDir, { recursive: true });

  const allParsedRows: any[] = [];
  const bboxStr = `${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]}`;

  for (const product of PRODUCTS) {
    const rawCsvPath = path.join(rawDir, `${facility.id}_${product}_${START_DATE}_${END_DATE}_raw.csv`);
    const productRawLines: string[] = [];
    let headerRecorded = false;

    if (fs.existsSync(rawCsvPath)) {
      const content = fs.readFileSync(rawCsvPath, 'utf8');
      const lines = content.trim().split('\n');
      if (lines.length > 0 && lines[0].includes('latitude')) {
        for (let i = 1; i < lines.length; i++) {
          const row = lines[i].trim();
          if (row) {
            const cols = row.split(',');
            allParsedRows.push({
              lat: parseFloat(cols[0]),
              lon: parseFloat(cols[1]),
              brightness_ti4: parseFloat(cols[2]),
              scan: parseFloat(cols[3]),
              track: parseFloat(cols[4]),
              acq_date: cols[5],
              acq_time: cols[6],
              satellite: cols[7],
              instrument: cols[8],
              confidence: cols[9],
              version: cols[10],
              brightness_ti5: parseFloat(cols[11]),
              frp: parseFloat(cols[12]),
              daynight: cols[13]?.trim().toUpperCase(),
              product,
              raw_line: row,
            });
          }
        }
      }
    } else {
      let current = new Date(START_DATE);
      const end = new Date(END_DATE);

      while (current <= end) {
        const dateStr = current.toISOString().slice(0, 10);
        const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${apiKey}/${product}/${bboxStr}/5/${dateStr}`;
        try {
          const resp = await fetch(url);
          if (resp.ok) {
            const text = await resp.text();
            if (!text.startsWith('Invalid')) {
              const lines = text.trim().split('\n');
              if (lines.length > 0 && lines[0].includes('latitude')) {
                if (!headerRecorded) {
                  productRawLines.push(lines[0]);
                  headerRecorded = true;
                }
                for (let i = 1; i < lines.length; i++) {
                  const row = lines[i].trim();
                  if (row && !productRawLines.includes(row)) {
                    productRawLines.push(row);
                    const cols = row.split(',');
                    allParsedRows.push({
                      lat: parseFloat(cols[0]),
                      lon: parseFloat(cols[1]),
                      brightness_ti4: parseFloat(cols[2]),
                      scan: parseFloat(cols[3]),
                      track: parseFloat(cols[4]),
                      acq_date: cols[5],
                      acq_time: cols[6],
                      satellite: cols[7],
                      instrument: cols[8],
                      confidence: cols[9],
                      version: cols[10],
                      brightness_ti5: parseFloat(cols[11]),
                      frp: parseFloat(cols[12]),
                      daynight: cols[13]?.trim().toUpperCase(),
                      product,
                      raw_line: row,
                    });
                  }
                }
              }
            }
          }
        } catch (err) {
          // Continue
        }
        current.setDate(current.getDate() + 5);
        await new Promise((r) => setTimeout(r, 120));
      }

      if (productRawLines.length > 1) {
        fs.writeFileSync(rawCsvPath, productRawLines.join('\n') + '\n', 'utf8');
      }
    }
  }

  // Deduplicate by physical observation key
  const uniqueKeyMap = new Map<string, any>();
  for (const row of allParsedRows) {
    const acqPadded = (row.acq_time || '0000').padStart(4, '0');
    const timeStr = `${row.acq_date}T${acqPadded.slice(0, 2)}:${acqPadded.slice(2, 4)}:00Z`;
    const key = buildFirmsPhysicalObservationKey(row.satellite, timeStr, row.lat, row.lon, row.frp);
    if (!uniqueKeyMap.has(key)) {
      uniqueKeyMap.set(key, row);
    }
  }

  const uniqueRows = Array.from(uniqueKeyMap.values());
  const processedObs: HistoricalThermalObservation[] = [];
  const associatedObs: HistoricalThermalObservation[] = [];

  for (let idx = 0; idx < uniqueRows.length; idx++) {
    const row = uniqueRows[idx];
    const { satellite, sensor } = normalizeSatelliteAndSensor(row.satellite, row.instrument);
    const dayNight: 'D' | 'N' = row.daynight === 'D' ? 'D' : 'N';
    const acqTimePadded = (row.acq_time || '0000').padStart(4, '0');
    const timeFormatted = `${acqTimePadded.slice(0, 2)}:${acqTimePadded.slice(2, 4)}:00`;
    const acqTimestamp = `${row.acq_date}T${timeFormatted}Z`;

    const rawPayload: Record<string, any> = {
      line: row.raw_line,
      product: row.product,
      satellite_raw: row.satellite,
      instrument_raw: row.instrument,
      brightness_ti4: row.brightness_ti4,
      brightness_ti5: row.brightness_ti5,
      scan: row.scan,
      track: row.track,
      confidence_raw: row.confidence,
      version: row.version,
      daynight: row.daynight,
    };

    const spatialMatch = findFacilitySpatialAssociation(row.lat, row.lon, MONITORED_FACILITIES as unknown as ServerFacility[]);
    const isTargetFacility = spatialMatch.matched_facility?.id === facility.id;

    const obsItem: HistoricalThermalObservation = {
      id: `FIRMS-HIST-${facility.id.replace('FAC-', '')}-${row.acq_date.replace(/-/g, '')}-${idx + 1}`,
      latitude: Number(row.lat.toFixed(5)),
      longitude: Number(row.lon.toFixed(5)),
      acquisition_date: row.acq_date,
      acquisition_time: timeFormatted,
      acquisition_timestamp: acqTimestamp,
      satellite,
      sensor,
      frp: Math.round(row.frp * 100) / 100,
      confidence: row.confidence === 'h' ? 'high' : row.confidence === 'l' ? 'low' : 'nominal',
      brightness_kelvin: Math.round(row.brightness_ti4 * 10) / 10,
      scan: row.scan,
      track: row.track,
      day_night: dayNight,
      associated_facility_id: isTargetFacility ? facility.id : 'UNASSOCIATED',
      associated_facility_name: isTargetFacility ? facility.name : 'Unassociated Regional Hotspot',
      association_type: isTargetFacility ? spatialMatch.spatial_association : 'UNASSOCIATED',
      matched_zone_id: isTargetFacility ? spatialMatch.matched_zone?.id || null : null,
      matched_zone_name: isTargetFacility ? spatialMatch.matched_zone?.name || null : null,
      distance_to_zone_meters: isTargetFacility ? spatialMatch.distance_to_zone_meters : null,
      distance_to_facility_meters: isTargetFacility ? spatialMatch.facility_distance_meters : null,
      is_inside_polygon: isTargetFacility ? spatialMatch.is_inside_polygon : false,
      raw_payload: rawPayload,
    };

    processedObs.push(obsItem);
    if (isTargetFacility && spatialMatch.spatial_association !== 'UNASSOCIATED') {
      associatedObs.push(obsItem);
    }
  }

  // Save candidate observations
  const candidateObsPath = path.join(processedDir, `${facility.id}_candidate_observations.json`);
  fs.writeFileSync(candidateObsPath, JSON.stringify(processedObs, null, 2), 'utf8');

  const distinctDates = Array.from(new Set(associatedObs.map((o) => o.acquisition_date))).sort();
  const activeDays = distinctDates.length;
  const count = associatedObs.length;

  let baselineStatus: 'EMPIRICAL' | 'LIMITED' | 'CANDIDATE_EMPIRICAL_WITH_REVIEW' | 'NOT_ASSESSED' = 'NOT_ASSESSED';
  if (count >= 30) {
    baselineStatus = 'EMPIRICAL';
  } else if (count > 0) {
    baselineStatus = 'LIMITED';
  }

  if (count > 0) {
    const frpVals = associatedObs.map((o) => o.frp);
    const medianFrp = calculatePercentile(frpVals, 50);
    const p25Frp = calculatePercentile(frpVals, 25);
    const p75Frp = calculatePercentile(frpVals, 75);
    const p90Frp = calculatePercentile(frpVals, 90);
    const p95Frp = calculatePercentile(frpVals, 95);
    const maxFrp = frpVals.length > 0 ? Math.max(...frpVals) : 0;
    const madFrp = calculateMad(frpVals, medianFrp);

    const dayCount = associatedObs.filter((o) => o.day_night === 'D').length;
    const nightCount = associatedObs.filter((o) => o.day_night === 'N').length;

    const candidateBaseline: EmpiricalFacilityBaseline = {
      facility_id: facility.id,
      facility_name: facility.name,
      baseline_status: baselineStatus,
      minimum_threshold_required: 30,
      provenance: 'REAL_NASA_FIRMS',
      provenance_type: count >= 30 ? 'FACILITY_ASSOCIATED' : 'LIMITED_PILOT',
      population_scope: 'FACILITY_ASSOCIATED',
      baseline_period: {
        start_date: distinctDates[0] || START_DATE,
        end_date: distinctDates[distinctDates.length - 1] || END_DATE,
        total_days: 115,
      },
      metrics: {
        observation_count: count,
        observation_days: activeDays,
        observations_per_day: Math.round((count / Math.max(1, activeDays)) * 100) / 100,
        frp_median: medianFrp,
        frp_p25: p25Frp,
        frp_p75: p75Frp,
        frp_p90: p90Frp,
        frp_p95: p95Frp,
        frp_max: maxFrp,
        frp_iqr: Math.round((p75Frp - p25Frp) * 100) / 100,
        frp_mad: madFrp,
      },
      diurnal: {
        day_count: dayCount,
        night_count: nightCount,
        day_pct: Math.round((dayCount / Math.max(1, count)) * 100),
        night_pct: Math.round((nightCount / Math.max(1, count)) * 100),
        hour_distribution: [],
      },
      spatial_distribution: {
        known_zone_count: associatedObs.filter((o) => o.association_type === 'KNOWN_THERMAL_ZONE').length,
        off_zone_count: associatedObs.filter((o) => o.association_type === 'FACILITY_OFF_ZONE').length,
        buffer_count: associatedObs.filter((o) => o.association_type === 'FACILITY_BUFFER').length,
        zones: [],
      },
      temporal_frequency: Math.round((activeDays / 115) * 100) / 100,
      persistence_classification: activeDays >= 10 ? 'PERSISTENT' : activeDays >= 3 ? 'RECURRENT' : 'SINGLE_OBSERVATION',
      created_at: new Date().toISOString(),
    };

    const baselineJsonPath = path.join(processedDir, `${facility.id}_candidate_baseline.json`);
    fs.writeFileSync(baselineJsonPath, JSON.stringify(candidateBaseline, null, 2), 'utf8');
  }

  return {
    success: true,
    observationCount: count,
    activeDays,
    status: baselineStatus,
    message: `Ingested ${uniqueRows.length} bbox detections, ${count} associated observations (${activeDays} active days). Status: ${baselineStatus}`,
  };
}

async function main() {
  console.log('='.repeat(80));
  console.log('INGESTING REAL NASA FIRMS DATA FOR KEY INDUSTRIAL HUBS');
  console.log('='.repeat(80));

  for (const hub of TARGET_HUBS) {
    console.log(`\nQuerying FIRMS for ${hub.facilityId}...`);
    const result = await ingestFacilityFirmsHistorical(hub.facilityId, hub.bbox);
    console.log(`Result: [${result.status}] ${result.message}`);
  }

  console.log('\nIngestion completed successfully.');
}

if (process.argv[1] && process.argv[1].includes('ingest_key_industrial_hubs')) {
  main().catch(console.error);
}
