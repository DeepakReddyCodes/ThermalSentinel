import fs from 'fs';
import path from 'path';
import { normalizeCanonicalFirmsObservation, processFirmsObservation, buildBayesianInferenceInput } from '../server/firmsProcessor.js';
function buildFirmsPhysicalObservationKey(sat: string, time: string, lat: number, lon: number, frp: number): string {
  const normSat = sat.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const normTime = time ? time.trim() : 'UNKNOWN_TIME';
  const normLat = Number(lat.toFixed(4));
  const normLon = Number(lon.toFixed(4));
  const normFrp = Math.round(frp * 10) / 10;
  return `${normSat}_${normTime}_${normLat}_${normLon}_${normFrp}`;
}
import { MONITORED_FACILITIES } from '../server/facilities.js';
import { isPointInPolygon, distanceToPolygonBoundaryMeters, haversineDistanceMeters } from '../server/geospatial.js';
import { queryNearbyOsmInfrastructure, isCoordinateInIndianDomain } from '../server/osm.js';
import { evaluateBayesianSourceHypotheses } from '../server/bayesianEngine.js';
import { getFacilityBaselineSync, getAllFacilityBaselines } from '../server/baselineRepository.js';

interface IndianRecord {
  file: string;
  satellite: string;
  date: string;
  time: string;
  timestamp: string;
  lat: number;
  lon: number;
  frp: number;
  physicalKey: string;
}

// 1. Gather all 379 unique Indian FIRMS observations
const processedDir = path.join(process.cwd(), 'data', 'processed');
const rawDir = path.join(process.cwd(), 'data', 'raw');

const uniqueIndiaObsMap = new Map<string, IndianRecord>();

if (fs.existsSync(processedDir)) {
  for (const file of fs.readdirSync(processedDir).filter(f => f.endsWith('_historical_observations.json'))) {
    const data = JSON.parse(fs.readFileSync(path.join(processedDir, file), 'utf-8'));
    for (const item of (Array.isArray(data) ? data : data.observations || [])) {
      const norm = normalizeCanonicalFirmsObservation(item);
      if (norm.valid && norm.observation) {
        const obs = norm.observation;
        if (isCoordinateInIndianDomain(obs.latitude, obs.longitude)) {
          const key = buildFirmsPhysicalObservationKey(obs.satellite, obs.acquisition_time, obs.latitude, obs.longitude, obs.frp);
          if (!uniqueIndiaObsMap.has(key)) {
            uniqueIndiaObsMap.set(key, {
              file,
              satellite: obs.satellite,
              date: obs.acquisition_date,
              time: obs.acquisition_time,
              timestamp: obs.acquisition_time,
              lat: obs.latitude,
              lon: obs.longitude,
              frp: obs.frp,
              physicalKey: key,
            });
          }
        }
      }
    }
  }
}

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
        if (isCoordinateInIndianDomain(obs.latitude, obs.longitude)) {
          const key = buildFirmsPhysicalObservationKey(obs.satellite, obs.acquisition_time, obs.latitude, obs.longitude, obs.frp);
          if (!uniqueIndiaObsMap.has(key)) {
            uniqueIndiaObsMap.set(key, {
              file,
              satellite: obs.satellite,
              date: obs.acquisition_date,
              time: obs.acquisition_time,
              timestamp: obs.acquisition_time,
              lat: obs.latitude,
              lon: obs.longitude,
              frp: obs.frp,
              physicalKey: key,
            });
          }
        }
      }
    }
  }
}

const allIndianObs = Array.from(uniqueIndiaObsMap.values());
console.log(`[Validation] Loaded ${allIndianObs.length} unique Indian FIRMS observations.`);

async function runValidation() {
  console.log('='.repeat(80));
  console.log('THERMALSENTINEL — DAY 2B EMPIRICAL VALIDATION & BASELINE AUDIT');
  console.log('='.repeat(80));

  let associatedCount = 0;
  let unassociatedCount = 0;
  let jamnagarCount = 0;
  let vadinarCount = 0;
  let otherFacCount = 0;

  let osmAvailableCount = 0;
  let osmNoFeaturesCount = 0;
  let osmFailureCount = 0;
  let osmOutOfScopeCount = 0;

  let totalOsmFeaturesRetrieved = 0;
  const categoryCounts: Record<string, number> = {};
  let hotspotsWithNearbyChimney = 0;
  let hotspotsWithNearbyFlare = 0;
  let hotspotsWithOtherIndustrial = 0;

  const sampleJamnagar: any[] = [];
  const sampleVadinar: any[] = [];
  const sampleUnassociated: any[] = [];

  for (let i = 0; i < allIndianObs.length; i++) {
    const item = allIndianObs[i];
    
    // 1. Process via Generic Pipeline
    const procResult = processFirmsObservation({
      latitude: item.lat,
      longitude: item.lon,
      frp: item.frp,
      acquisition_time: item.timestamp,
      acquisition_date: item.date,
      satellite: item.satellite,
    });

    const isAssoc = procResult.derived_context.is_associated;
    const facId = procResult.derived_context.associated_facility?.id;

    if (isAssoc) {
      associatedCount++;
      if (facId === 'FAC-GUJ-JAMNAGAR-01') {
        jamnagarCount++;
        if (sampleJamnagar.length < 3) sampleJamnagar.push({ item, procResult });
      } else if (facId === 'FAC-GUJ-VADINAR-02') {
        vadinarCount++;
        if (sampleVadinar.length < 3) sampleVadinar.push({ item, procResult });
      } else {
        otherFacCount++;
      }
    } else {
      unassociatedCount++;
      if (sampleUnassociated.length < 3) sampleUnassociated.push({ item, procResult });
    }

    // 2. Query OSM Context (with in-memory cache)
    const osm = await queryNearbyOsmInfrastructure(item.lat, item.lon, 3.0);
    
    if (osm.status === 'AVAILABLE' || osm.status === 'AUTHENTIC_LIVE' || osm.status === 'VERIFIED_LOCAL_CACHE') {
      if (osm.features.length > 0) {
        osmAvailableCount++;
        totalOsmFeaturesRetrieved += osm.features.length;

        let hasChimney = false;
        let hasFlare = false;
        let hasOtherInd = false;

        for (const f of osm.features) {
          categoryCounts[f.category] = (categoryCounts[f.category] || 0) + 1;
          if (f.category === 'chimney') hasChimney = true;
          if (f.category === 'flare') hasFlare = true;
          if (f.category === 'works' || f.category === 'storage_tank' || f.category === 'industrial_landuse' || f.category === 'power_infrastructure') hasOtherInd = true;
        }

        if (hasChimney) hotspotsWithNearbyChimney++;
        if (hasFlare) hotspotsWithNearbyFlare++;
        if (hasOtherInd) hotspotsWithOtherIndustrial++;
      } else {
        osmNoFeaturesCount++;
      }
    } else if (osm.status === 'NO_MAPPED_FEATURES' || osm.status === 'NO_RELEVANT_FEATURES') {
      osmNoFeaturesCount++;
    } else if (osm.status === 'ACQUISITION_FAILED' || osm.status === 'OSM_UNAVAILABLE' || osm.status === 'ERROR') {
      osmFailureCount++;
    } else if (osm.status === 'OUT_OF_SCOPE') {
      osmOutOfScopeCount++;
    }

    // 3. Test Bayesian Posterior Invariance with/without derived baseline & persistence & OSM
    const bayesInputClean = buildBayesianInferenceInput(procResult);
    const postClean = evaluateBayesianSourceHypotheses(bayesInputClean);

    const bayesInputEnriched = buildBayesianInferenceInput(procResult, { osm_context: osm });
    const postEnriched = evaluateBayesianSourceHypotheses(bayesInputEnriched);

    // If OSM is NO_MAPPED_FEATURES / UNAVAILABLE / ACQUISITION_FAILED, postClean and postEnriched MUST BE 100% IDENTICAL
    if (osm.status === 'NO_MAPPED_FEATURES' || osm.status === 'ACQUISITION_FAILED' || osm.features.length === 0) {
      for (const h of ['GAS_FLARE', 'INDUSTRIAL_FIRE', 'AGRICULTURAL_BURN', 'WILDFIRE_VEGETATION', 'OTHER'] as const) {
        const diff = Math.abs(postClean.posterior_probabilities[h] - postEnriched.posterior_probabilities[h]);
        if (diff > 0.001) {
          console.error(`[VIOLATION] Inactive OSM caused posterior drift on ${item.physicalKey}: ${diff}`);
        }
      }
    }
  }

  console.log('\n--- PART 6 EMPIRICAL VALIDATION RESULTS ---');
  console.log(`  Indian Hotspots Processed        : ${allIndianObs.length}`);
  console.log(`  - Facility-Associated Hotspots   : ${associatedCount} (${((associatedCount/allIndianObs.length)*100).toFixed(1)}%)`);
  console.log(`    * Jamnagar Complex             : ${jamnagarCount}`);
  console.log(`    * Vadinar Complex              : ${vadinarCount}`);
  console.log(`    * Other Facilities             : ${otherFacCount}`);
  console.log(`  - Unassociated Regional Hotspots : ${unassociatedCount} (${((unassociatedCount/allIndianObs.length)*100).toFixed(1)}%)`);
  console.log(`\n--- OSM INFRASTRUCTURE ENRICHMENT BREAKDOWN ---`);
  console.log(`  - Successful OSM Acquisition     : ${osmAvailableCount}`);
  console.log(`  - OSM NO_MAPPED_FEATURES         : ${osmNoFeaturesCount}`);
  console.log(`  - OSM Acquisition Failed/Timeout : ${osmFailureCount}`);
  console.log(`  - Out of Operational Scope       : ${osmOutOfScopeCount}`);
  console.log(`  - Total OSM Features Retrieved   : ${totalOsmFeaturesRetrieved}`);
  console.log(`  - Feature-Type Distribution      :`, categoryCounts);
  console.log(`  - Hotspots with Nearby Flare     : ${hotspotsWithNearbyFlare}`);
  console.log(`  - Hotspots with Nearby Chimney   : ${hotspotsWithNearbyChimney}`);
  console.log(`  - Hotspots with Other Industrial : ${hotspotsWithOtherIndustrial}`);

  console.log('\n--- PART 7 BASELINE EMPIRICAL COVERAGE ---');
  const allBaselines = await getAllFacilityBaselines();
  const empiricalBaselines = allBaselines.filter(b => b.baseline_status === 'EMPIRICAL');
  const insufficientBaselines = allBaselines.filter(b => b.baseline_status === 'INSUFFICIENT_DATA');

  console.log(`  Total Facilities Monitored in Registry : ${MONITORED_FACILITIES.length}`);
  console.log(`  Facilities with Usable Empirical Baselines (N >= 30) : ${empiricalBaselines.length}`);
  for (const b of empiricalBaselines) {
    console.log(`    * [${b.facility_id}] ${b.facility_name}: N=${b.metrics.observation_count} obs, Median=${b.metrics.frp_median} MW, P95=${b.metrics.frp_p95} MW, Period: ${b.baseline_period.start_date} to ${b.baseline_period.end_date} (${b.baseline_period.total_days} days)`);
  }
  console.log(`  Facilities with Insufficient Data / No History (N < 30) : ${insufficientBaselines.length}`);
  
  console.log('\n--- BENCHMARK SAMPLES VERIFICATION ---');
  console.log('\nA. Jamnagar Benchmark Sample (Inside Known Thermal Zone):');
  if (sampleJamnagar.length > 0) {
    const s = sampleJamnagar[0];
    console.log(`   ID: ${s.item.physicalKey}`);
    console.log(`   Coord: [${s.item.lat}, ${s.item.lon}], FRP: ${s.item.frp} MW`);
    console.log(`   Spatial: ${s.procResult.derived_context.spatial_association}`);
    console.log(`   Matched Facility: ${s.procResult.derived_context.associated_facility?.name}`);
    console.log(`   Matched Zone: ${s.procResult.derived_context.matched_zone_name} (${s.procResult.derived_context.distance_to_zone_meters}m)`);
    console.log(`   Baseline Status: ${s.procResult.derived_context.baseline_status}, Behaviour: ${s.procResult.derived_context.behavioural_status}`);
  }

  console.log('\nB. Vadinar Benchmark Sample (Inside Facility / Flare Vicinity):');
  if (sampleVadinar.length > 0) {
    const s = sampleVadinar[0];
    console.log(`   ID: ${s.item.physicalKey}`);
    console.log(`   Coord: [${s.item.lat}, ${s.item.lon}], FRP: ${s.item.frp} MW`);
    console.log(`   Spatial: ${s.procResult.derived_context.spatial_association}`);
    console.log(`   Matched Facility: ${s.procResult.derived_context.associated_facility?.name}`);
    console.log(`   Matched Zone: ${s.procResult.derived_context.matched_zone_name || 'Off-stack internal'} (${s.procResult.derived_context.distance_to_zone_meters}m)`);
    console.log(`   Baseline Status: ${s.procResult.derived_context.baseline_status}, Behaviour: ${s.procResult.derived_context.behavioural_status}`);
  }

  console.log('\nC. Unassociated Regional Hotspot Sample:');
  if (sampleUnassociated.length > 0) {
    const s = sampleUnassociated[0];
    console.log(`   ID: ${s.item.physicalKey}`);
    console.log(`   Coord: [${s.item.lat}, ${s.item.lon}], FRP: ${s.item.frp} MW`);
    console.log(`   Spatial: ${s.procResult.derived_context.spatial_association}`);
    console.log(`   Associated: ${s.procResult.derived_context.is_associated}`);
    console.log(`   Facility: ${s.procResult.derived_context.associated_facility}`);
    console.log(`   Baseline: ${s.procResult.derived_context.baseline_status}, Behaviour: ${s.procResult.derived_context.behavioural_status}`);
  }
}

runValidation().catch(console.error);
