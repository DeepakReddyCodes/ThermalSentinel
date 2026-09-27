import 'dotenv/config';
import { fetchSentinel2SwirEvidence } from '../server/sentinelHub.js';
import {
  buildInvestigationCase,
  incorporateEvidenceIntoCase,
  activeCasesMap,
} from '../server/investigationEngine.js';
import { MONITORED_FACILITIES } from '../server/facilities.js';
import { Sentinel2SwirResponse } from '../server/types.js';

async function runLiveSentinelVerification() {
  console.log('================================================================================');
  console.log('DAY 2E-2: SENTINEL-2 TEMPORAL EVIDENCE GATING & CDSE LIVE VERIFICATION');
  console.log('================================================================================\n');

  // Step 1: Check environment credentials
  const clientId = process.env.COPERNICUS_CLIENT_ID?.trim();
  const clientSecret = process.env.COPERNICUS_CLIENT_SECRET?.trim();

  console.log('--- CREDENTIAL STATUS ---');
  console.log(`COPERNICUS_CLIENT_ID configured:     ${clientId ? 'YES (' + clientId.slice(0, 8) + '...)' : 'NO'}`);
  console.log(`COPERNICUS_CLIENT_SECRET configured: ${clientSecret ? 'YES (' + clientSecret.slice(0, 4) + '...)' : 'NO'}\n`);

  if (!clientId || !clientSecret) {
    console.error('ERROR: Copernicus CDSE credentials are missing in .env.');
    process.exit(1);
  }

  // Target facility coordinate: Jamnagar Refinery
  const jamnagar = MONITORED_FACILITIES.find((f) => f.id === 'FAC-GUJ-JAMNAGAR-01');
  if (!jamnagar) {
    throw new Error('Jamnagar facility definition not found');
  }

  const testLat = 22.3385;
  const testLon = 69.8608;
  const testTimestamp = '2026-02-25T08:13:00Z'; // FIRMS benchmark observation

  console.log('--- TEST TARGET COORDINATES ---');
  console.log(`Facility:    ${jamnagar.name} (${jamnagar.id})`);
  console.log(`Coordinates: Lat ${testLat}°N, Lon ${testLon}°E`);
  console.log(`Event Time:  ${testTimestamp}\n`);

  // Step 2: Fetch real CDSE scene
  console.log('--- EXECUTING LIVE COPERNICUS PIPELINE ---');
  const startTime = Date.now();
  const liveS2Result = await fetchSentinel2SwirEvidence({
    lat: testLat,
    lon: testLon,
    timestamp: testTimestamp,
    facilityId: jamnagar.id,
    bufferKm: 2.0,
  });
  const durationMs = Date.now() - startTime;

  console.log(`Query completed in ${durationMs} ms.\n`);
  console.log('--- RAW ACQUISITION RESULT ---');
  console.log(`Status:               ${liveS2Result.status}`);
  console.log(`Is Live External:     ${liveS2Result.is_live_external}`);
  console.log(`Scene ID:             ${liveS2Result.scene_id || 'N/A'}`);
  console.log(`Acquisition Time:     ${liveS2Result.acquisition_timestamp || 'N/A'}`);
  console.log(`Cloud Coverage:       ${liveS2Result.cloud_coverage ?? liveS2Result.cloud_cover_pct ?? 'N/A'}%`);
  console.log(`Bands Used:           ${liveS2Result.bands_used?.join(', ') || 'N/A'}`);
  console.log(`Spatial Resolution:   ${liveS2Result.spatial_resolution}`);
  console.log(`Provenance:           ${liveS2Result.provenance}`);
  console.log(`Image Data URL:       ${liveS2Result.image_data_url ? liveS2Result.image_data_url.slice(0, 40) + '... (Length: ' + liveS2Result.image_data_url.length + ' chars)' : 'NONE'}`);
  console.log(`Temporal Status:      ${liveS2Result.temporal_status}`);
  console.log(`Temporal Delta:       ${liveS2Result.temporal_difference_human || liveS2Result.temporal_difference_hours + ' hours'}`);
  console.log(`Is Event Adjacent:    ${liveS2Result.is_event_adjacent}`);
  console.log(`Advisory Note:        ${liveS2Result.advisory_note}\n`);

  // ============================================================================
  // TEST 1 — TEMPORALLY_DISTANT LIVE SCENE GATING
  // ============================================================================
  console.log('================================================================================');
  console.log('TEST 1 — TEMPORALLY_DISTANT LIVE SCENE GATING');
  console.log('================================================================================');
  
  const mockObs1 = {
    id: 'FIRMS-20260225-TEST-DISTANT',
    latitude: testLat,
    longitude: testLon,
    acquisition_timestamp: testTimestamp,
    satellite: 'VIIRS-NOAA20',
    frp: 38.5,
    confidence: 'high' as const,
    day_night: 'N' as const,
  };

  const case1 = buildInvestigationCase(mockObs1, jamnagar);
  activeCasesMap.set(case1.case_id, case1);

  const initialPriors1 = case1.hypothesis_assessment.fused_hypotheses;
  const initialEntropy1 = case1.uncertainty_assessment.current_entropy_bits;
  console.log('Initial (T0) Hypothesis Distribution:');
  for (const h of initialPriors1) {
    console.log(`  ${h.hypothesis.padEnd(22)}: ${h.percentage.toFixed(1)}%`);
  }
  console.log(`Initial Entropy: ${initialEntropy1.toFixed(3)} bits\n`);

  console.log('Incorporating Live TEMPORALLY_DISTANT Sentinel-2 Scene...');
  const updatedCase1 = await incorporateEvidenceIntoCase(case1.case_id, {
    candidate_id: 'SENTINEL2_SWIR_OPTICAL',
    value: liveS2Result,
    provenance: 'REAL',
  });

  const postPriors1 = updatedCase1.hypothesis_assessment.fused_hypotheses;
  const postEntropy1 = updatedCase1.uncertainty_assessment.current_entropy_bits;
  console.log('Post-Evidence (T1) Hypothesis Distribution:');
  for (const h of postPriors1) {
    console.log(`  ${h.hypothesis.padEnd(22)}: ${h.percentage.toFixed(1)}%`);
  }
  console.log(`Post-Evidence Entropy: ${postEntropy1.toFixed(3)} bits`);
  console.log(`Entropy Delta (ΔH):    ${(initialEntropy1 - postEntropy1).toFixed(3)} bits\n`);

  const appliedItem1 = updatedCase1.applied_evidence_items?.find((e) => e.evidence_type === 'SENTINEL2_SWIR_OPTICAL');
  console.log('Applied Evidence Item Details:');
  console.log(`  ID:              ${appliedItem1?.evidence_id}`);
  console.log(`  Outcome ID:      ${appliedItem1?.outcome_id}`);
  console.log(`  Outcome Name:    ${appliedItem1?.outcome_name}`);
  console.log(`  Is Incorporated: ${appliedItem1?.is_incorporated}`);
  console.log(`  Provenance:      ${appliedItem1?.provenance}`);
  console.log(`  Title:           ${appliedItem1?.title}`);

  // Assertions for TEST 1
  const t1_isDistant = liveS2Result.temporal_status === 'TEMPORALLY_DISTANT';
  const t1_notIncorporated = appliedItem1?.is_incorporated === false;
  const t1_noEventOutcome = appliedItem1?.outcome_id !== 'POINT_EMITTER_ELEVATED_STACK' && appliedItem1?.outcome_id !== 'SURFACE_SPREAD_PROCESS_STRUCTURE';
  const t1_posteriorUnchanged = Math.abs(postPriors1[0].percentage - initialPriors1[0].percentage) < 0.01 &&
                                Math.abs(postPriors1[1].percentage - initialPriors1[1].percentage) < 0.01;
  const t1_entropyUnchanged = Math.abs(initialEntropy1 - postEntropy1) < 0.001;

  console.log(`\nTEST 1 GATING VERIFICATION:`);
  console.log(`  1.1 Temporal status is TEMPORALLY_DISTANT:            ${t1_isDistant ? 'PASS' : 'FAIL'}`);
  console.log(`  1.2 Evidence item marked is_incorporated = false:     ${t1_notIncorporated ? 'PASS' : 'FAIL'}`);
  console.log(`  1.3 No event-level point/spread outcome assigned:     ${t1_noEventOutcome ? 'PASS (Outcome: ' + appliedItem1?.outcome_id + ')' : 'FAIL'}`);
  console.log(`  1.4 Event-level Bayesian posterior strictly UNCHANGED: ${t1_posteriorUnchanged ? 'PASS' : 'FAIL'}`);
  console.log(`  1.5 Entropy strictly UNCHANGED (ΔH = 0.000):          ${t1_entropyUnchanged ? 'PASS' : 'FAIL'}`);

  if (!t1_isDistant || !t1_notIncorporated || !t1_noEventOutcome || !t1_posteriorUnchanged || !t1_entropyUnchanged) {
    throw new Error('TEST 1 FAILED: Stale Sentinel-2 evidence modified event-level Bayesian state');
  }

  // ============================================================================
  // TEST 2 — TEMPORALLY_RELEVANT CONTROLLED SCENARIO
  // ============================================================================
  console.log('\n================================================================================');
  console.log('TEST 2 — TEMPORALLY_RELEVANT CONTEMPORANEOUS SCENARIO');
  console.log('================================================================================');

  const relevantS2Result: Sentinel2SwirResponse = {
    status: 'AUTHENTIC_LIVE',
    is_live_external: true,
    scene_id: 'S2B_MSIL2A_CONTEMPORANEOUS_PASS',
    acquisition_timestamp: '2026-02-25T05:30:00Z',
    cloud_coverage: 0.5,
    bands_used: ['B12 (2190nm)', 'B11 (1610nm)', 'B8A (865nm)'],
    spatial_resolution: '20m (SWIR) / 10m (NIR)',
    bounding_box: [69.84, 22.31, 69.88, 22.36],
    center_coordinates: [testLat, testLon],
    evidence_findings: {
      spatial_expansion: false,
      uncontained_spread: false,
      swir_thermal_pattern: 'concentrated_emission_with_stack_glow',
      spectral_index_nbr: -0.38,
      pixel_footprint_sq_meters: 3600,
      summary: 'Contemporaneous 20m SWIR confirms point-source stack glow.',
    },
    firms_observation_timestamp: testTimestamp,
    temporal_status: 'TEMPORALLY_RELEVANT',
    temporal_difference_hours: 2.7,
    temporal_difference_days: 0.1,
    temporal_difference_human: '2.7 hours prior to FIRMS observation',
    temporal_threshold_hours: 72,
    is_event_adjacent: true,
    advisory_note: 'Contemporaneous Sentinel-2 overpass within ±72h event window.',
    provenance: 'Copernicus Data Space Ecosystem (CDSE) Sentinel Hub Process API (Live Authenticated)',
    timestamp: new Date().toISOString(),
  };

  const mockObs2 = {
    id: 'FIRMS-20260225-TEST-RELEVANT',
    latitude: testLat,
    longitude: testLon,
    acquisition_timestamp: testTimestamp,
    satellite: 'VIIRS-NOAA20',
    frp: 38.5,
    confidence: 'high' as const,
    day_night: 'N' as const,
  };

  const case2 = buildInvestigationCase(mockObs2, jamnagar);
  activeCasesMap.set(case2.case_id, case2);

  const initialPriors2 = case2.hypothesis_assessment.fused_hypotheses;
  const initialEntropy2 = case2.uncertainty_assessment.current_entropy_bits;
  console.log('Initial (T0) Hypothesis Distribution:');
  for (const h of initialPriors2) {
    console.log(`  ${h.hypothesis.padEnd(22)}: ${h.percentage.toFixed(1)}%`);
  }
  console.log(`Initial Entropy: ${initialEntropy2.toFixed(3)} bits\n`);

  console.log('Incorporating Contemporaneous TEMPORALLY_RELEVANT Sentinel-2 Scene...');
  const updatedCase2 = await incorporateEvidenceIntoCase(case2.case_id, {
    candidate_id: 'SENTINEL2_SWIR_OPTICAL',
    value: relevantS2Result,
    provenance: 'REAL',
  });

  const postPriors2 = updatedCase2.hypothesis_assessment.fused_hypotheses;
  const postEntropy2 = updatedCase2.uncertainty_assessment.current_entropy_bits;
  console.log('Post-Evidence (T1) Hypothesis Distribution:');
  for (const h of postPriors2) {
    console.log(`  ${h.hypothesis.padEnd(22)}: ${h.percentage.toFixed(1)}%`);
  }
  console.log(`Post-Evidence Entropy: ${postEntropy2.toFixed(3)} bits`);
  console.log(`Entropy Delta (ΔH):    ${(initialEntropy2 - postEntropy2).toFixed(3)} bits\n`);

  const appliedItem2 = updatedCase2.applied_evidence_items?.find((e) => e.evidence_type === 'SENTINEL2_SWIR_OPTICAL');
  console.log('Applied Evidence Item Details:');
  console.log(`  ID:              ${appliedItem2?.evidence_id}`);
  console.log(`  Outcome ID:      ${appliedItem2?.outcome_id}`);
  console.log(`  Is Incorporated: ${appliedItem2?.is_incorporated}`);
  console.log(`  Likelihood Map:  ${JSON.stringify(appliedItem2?.likelihood_by_hypothesis)}`);

  // Assertions for TEST 2
  const t2_isRelevant = relevantS2Result.temporal_status === 'TEMPORALLY_RELEVANT' && relevantS2Result.is_event_adjacent === true;
  const t2_incorporated = appliedItem2?.is_incorporated === true;
  const t2_outcomeAssigned = appliedItem2?.outcome_id === 'POINT_EMITTER_ELEVATED_STACK';
  const t2_posteriorUpdated = postPriors2.find((h) => h.hypothesis === 'GAS_FLARE')!.percentage > initialPriors2.find((h) => h.hypothesis === 'GAS_FLARE')!.percentage;

  console.log(`\nTEST 2 GATING VERIFICATION:`);
  console.log(`  2.1 Temporal status is TEMPORALLY_RELEVANT:           ${t2_isRelevant ? 'PASS' : 'FAIL'}`);
  console.log(`  2.2 Evidence item marked is_incorporated = true:      ${t2_incorporated ? 'PASS' : 'FAIL'}`);
  console.log(`  2.3 Outcome POINT_EMITTER_ELEVATED_STACK assigned:    ${t2_outcomeAssigned ? 'PASS' : 'FAIL'}`);
  console.log(`  2.4 Bayesian posterior correctly updated via P(E|H):  ${t2_posteriorUpdated ? 'PASS' : 'FAIL'}`);

  if (!t2_isRelevant || !t2_incorporated || !t2_outcomeAssigned || !t2_posteriorUpdated) {
    throw new Error('TEST 2 FAILED: Contemporaneous Sentinel-2 failed to update Bayesian posterior');
  }

  // ============================================================================
  // TEST 3 — PROVENANCE VS TEMPORAL ELIGIBILITY PRECEDENCE
  // ============================================================================
  console.log('\n================================================================================');
  console.log('TEST 3 — PROVENANCE VS TEMPORAL ELIGIBILITY PRECEDENCE');
  console.log('================================================================================');

  console.log(`Verifying: AUTHENTIC_LIVE + TEMPORALLY_DISTANT cannot become event evidence...`);
  console.log(`  Live Scene Provenance: ${liveS2Result.provenance}`);
  console.log(`  Live Scene Temporal:   ${liveS2Result.temporal_status}`);
  console.log(`  Incorporated in Bayes: ${appliedItem1?.is_incorporated === false ? 'NO (Excluded by Temporal Gate)' : 'YES (VIOLATION)'}`);

  const t3_precedencePass = appliedItem1?.provenance === 'REAL' && appliedItem1?.is_incorporated === false;
  console.log(`  3.1 Temporal eligibility overrides AUTHENTIC_LIVE:   ${t3_precedencePass ? 'PASS' : 'FAIL'}`);

  if (!t3_precedencePass) {
    throw new Error('TEST 3 FAILED: Stale scene was incorporated solely due to AUTHENTIC_LIVE provenance');
  }

  console.log('\n================================================================================');
  console.log('DAY 2E-2 ALL REGRESSION TESTS PASSED SUCCESSFULLY');
  console.log('================================================================================');
}

runLiveSentinelVerification().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
