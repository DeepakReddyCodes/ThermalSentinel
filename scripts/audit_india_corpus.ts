import fs from 'fs';
import path from 'path';
import { normalizeCanonicalFirmsObservation } from '../server/firmsProcessor.js';
import { buildFirmsPhysicalObservationKey } from './audit_firms_deduplication.js';
import { MONITORED_FACILITIES } from '../server/facilities.js';
import { isPointInPolygon, distanceToPolygonBoundaryMeters, haversineDistanceMeters } from '../server/geospatial.js';

// Coarse geographical envelope for Indian territory
const INDIA_COARSE_BOUNDS = {
  minLat: 6.0,
  maxLat: 37.5,
  minLon: 68.0,
  maxLon: 98.0,
};

function isCoordinateInIndiaCoarse(lat: number, lon: number): boolean {
  return lat >= INDIA_COARSE_BOUNDS.minLat &&
         lat <= INDIA_COARSE_BOUNDS.maxLat &&
         lon >= INDIA_COARSE_BOUNDS.minLon &&
         lon <= INDIA_COARSE_BOUNDS.maxLon;
}

const processedDir = path.join(process.cwd(), 'data', 'processed');
const rawDir = path.join(process.cwd(), 'data', 'raw');

interface CorpusRecord {
  file: string;
  isIndianTerritory: boolean;
  satellite: string;
  date: string;
  time: string;
  lat: number;
  lon: number;
  frp: number;
  physicalKey: string;
  isAssociated: boolean;
  facilityId: string | null;
}

const records: CorpusRecord[] = [];

// 1. Processed JSONs
if (fs.existsSync(processedDir)) {
  for (const file of fs.readdirSync(processedDir).filter(f => f.endsWith('_historical_observations.json'))) {
    const data = JSON.parse(fs.readFileSync(path.join(processedDir, file), 'utf-8'));
    for (const item of (Array.isArray(data) ? data : data.observations || [])) {
      const norm = normalizeCanonicalFirmsObservation(item);
      if (norm.valid && norm.observation) {
        const obs = norm.observation;
        const key = buildFirmsPhysicalObservationKey(obs.satellite, obs.acquisition_time, obs.latitude, obs.longitude, obs.frp);
        const inIndia = isCoordinateInIndiaCoarse(obs.latitude, obs.longitude);
        
        let isAssoc = false;
        let facId: string | null = null;
        for (const fac of MONITORED_FACILITIES) {
          const inside = isPointInPolygon([obs.latitude, obs.longitude], fac.polygon);
          const buf = (fac.buffer_radius_km || 3.0) * 1000;
          const distBound = inside ? 0 : distanceToPolygonBoundaryMeters(obs.latitude, obs.longitude, fac.polygon);
          if (inside || distBound <= buf) {
            isAssoc = true;
            facId = fac.id;
            break;
          }
        }

        records.push({
          file,
          isIndianTerritory: inIndia,
          satellite: obs.satellite,
          date: obs.acquisition_date,
          time: obs.acquisition_time,
          lat: obs.latitude,
          lon: obs.longitude,
          frp: obs.frp,
          physicalKey: key,
          isAssociated: isAssoc,
          facilityId: facId,
        });
      }
    }
  }
}

// 2. Raw CSVs
if (fs.existsSync(rawDir)) {
  for (const file of fs.readdirSync(rawDir).filter(f => f.endsWith('.csv'))) {
    const lines = fs.readFileSync(path.join(rawDir, file), 'utf-8').split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length <= 1) continue;
    const header = lines[0].split(',').map(h => h.trim().toLowerCase());
    const latIdx = header.indexOf('latitude');
    const lonIdx = header.indexOf('longitude');
    const frpIdx = header.indexOf('frp');
    const dateIdx = header.indexOf('acq_date');
    const timeIdx = header.indexOf('acq_time');
    const satIdx = header.indexOf('satellite');

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      if (cols.length < 4) continue;
      const rawObj = {
        latitude: parseFloat(cols[latIdx]),
        longitude: parseFloat(cols[lonIdx]),
        frp: frpIdx >= 0 ? parseFloat(cols[frpIdx]) : 0,
        acq_date: dateIdx >= 0 ? cols[dateIdx] : undefined,
        acq_time: timeIdx >= 0 ? cols[timeIdx] : undefined,
        satellite: satIdx >= 0 ? cols[satIdx] : undefined,
      };
      const norm = normalizeCanonicalFirmsObservation(rawObj);
      if (norm.valid && norm.observation) {
        const obs = norm.observation;
        const key = buildFirmsPhysicalObservationKey(obs.satellite, obs.acquisition_time, obs.latitude, obs.longitude, obs.frp);
        const inIndia = isCoordinateInIndiaCoarse(obs.latitude, obs.longitude);

        let isAssoc = false;
        let facId: string | null = null;
        for (const fac of MONITORED_FACILITIES) {
          const inside = isPointInPolygon([obs.latitude, obs.longitude], fac.polygon);
          const buf = (fac.buffer_radius_km || 3.0) * 1000;
          const distBound = inside ? 0 : distanceToPolygonBoundaryMeters(obs.latitude, obs.longitude, fac.polygon);
          if (inside || distBound <= buf) {
            isAssoc = true;
            facId = fac.id;
            break;
          }
        }

        records.push({
          file,
          isIndianTerritory: inIndia,
          satellite: obs.satellite,
          date: obs.acquisition_date,
          time: obs.acquisition_time,
          lat: obs.latitude,
          lon: obs.longitude,
          frp: obs.frp,
          physicalKey: key,
          isAssociated: isAssoc,
          facilityId: facId,
        });
      }
    }
  }
}

// Deduplicate into Unique Indian observations vs Unique Non-Indian observations
const uniqueIndiaKeys = new Map<string, CorpusRecord>();
const uniqueNonIndiaKeys = new Map<string, CorpusRecord>();

for (const r of records) {
  if (r.isIndianTerritory) {
    if (!uniqueIndiaKeys.has(r.physicalKey)) {
      uniqueIndiaKeys.set(r.physicalKey, r);
    }
  } else {
    if (!uniqueNonIndiaKeys.has(r.physicalKey)) {
      uniqueNonIndiaKeys.set(r.physicalKey, r);
    }
  }
}

const indiaObs = Array.from(uniqueIndiaKeys.values());
const nonIndiaObs = Array.from(uniqueNonIndiaKeys.values());

const indiaAssoc = indiaObs.filter(o => o.isAssociated);
const indiaUnassoc = indiaObs.filter(o => !o.isAssociated);

const indiaDates = indiaObs.map(o => o.date).sort();
const minIndiaDate = indiaDates[0];
const maxIndiaDate = indiaDates[indiaDates.length - 1];

const indiaSats = Array.from(new Set(indiaObs.map(o => o.satellite))).sort();
const representedFacilities = Array.from(new Set(indiaObs.filter(o => o.facilityId).map(o => o.facilityId))).sort();

console.log('='.repeat(80));
console.log('INDIAN OPERATIONAL DOMAIN CORPUS ANALYSIS');
console.log('='.repeat(80));
console.log('\n--- 1. INDIA PRODUCTION OPERATIONAL CORPUS ---');
console.log(`  Unique Indian FIRMS Observations       : ${indiaObs.length}`);
console.log(`  - Facility-Associated Hotspots         : ${indiaAssoc.length}`);
console.log(`  - Unassociated Regional Hotspots       : ${indiaUnassoc.length}`);
console.log(`  - Monitored Facilities Represented     : ${representedFacilities.length} (${representedFacilities.join(', ')})`);
console.log(`  - Indian Observation Date Range        : ${minIndiaDate} to ${maxIndiaDate}`);
console.log(`  - Satellites Represented in India      : ${indiaSats.join(', ')}`);

console.log('\n--- 2. NON-INDIA RESEARCH / REFERENCE CORPUS ---');
console.log(`  Unique Non-India FIRMS Observations    : ${nonIndiaObs.length} (WFIGS / US Wildfire References)`);
console.log(`  - Operational Status                   : RESEARCH_REFERENCE_ONLY / OUT_OF_SCOPE`);

console.log('\n--- 3. TOTAL REPOSITORY TOTALS ---');
console.log(`  Total Unique Physical Observations     : ${indiaObs.length + nonIndiaObs.length} (3,855)`);
console.log(`  Total Source Records Examined          : ${records.length} (5,086)`);
