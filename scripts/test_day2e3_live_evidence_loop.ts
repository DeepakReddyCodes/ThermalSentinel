import 'dotenv/config';
import { fetchSentinel2SwirEvidence } from '../server/sentinelHub.js';
import {
  buildInvestigationCase,
  incorporateEvidenceIntoCase,
  activeCasesMap,
} from '../server/investigationEngine.js';
import { MONITORED_FACILITIES } from '../server/facilities.js';

async function runDay2E3LiveEvidenceLoop() {
  console.log('================================================================================');
  console.log('DAY 2E-3 — LIVE CLOSED-LOOP EVIDENCE ACQUISITION & NBE ADAPTATION VALIDATION');
  console.log('================================================================================\n');

  // Step 1: Real FIRMS event definition from Jamnagar scenario
  const jamnagar = MONITORED_FACILITIES.find((f) => f.id === 'FAC-GUJ-JAMNAGAR-01');
  if (!jamnagar) {
    throw new Error('Facility FAC-GUJ-JAMNAGAR-01 not found');
  }

  const firmsObservation = {
    id: 'FIRMS-20260225-JAM-ANOMALY',
    latitude: 22.3385,
    longitude: 69.8608,
    acquisition_timestamp: '2026-02-25T08:13:00Z',
    satellite: 'VIIRS-NOAA20',
    sensor: 'VIIRS',
    frp: 38.5,
    confidence: 'high' as const,
    day_night: 'N' as const,
    brightness_kelvin: 345.2,
    brightness_ti4: 345.2,
    brightness_ti5: 295.1,
    brightness_delta: 50.1,
  };

  console.log('--- 1. INITIATING FIRMS OBSERVATION ---');
  console.log(`Event ID:             ${firmsObservation.id}`);
  console.log(`Facility:             ${jamnagar.name} (${jamnagar.id})`);
  console.log(`Coordinates:          Lat ${firmsObservation.latitude}°N, Lon ${firmsObservation.longitude}°E`);
  console.log(`Observation Time:     ${firmsObservation.acquisition_timestamp}`);
  console.log(`Radiometry:           FRP = ${firmsObservation.frp} MW, TI4 = ${firmsObservation.brightness_ti4} K, TI5 = ${firmsObservation.brightness_ti5} K, ΔT = ${firmsObservation.brightness_delta} K\n`);

  // Step 2 & 3: Build Investigation Case and evaluate initial state
  console.log('--- 2. INITIAL INVESTIGATION CASE (T0 STATE) ---');
  const initialCase = buildInvestigationCase(firmsObservation, jamnagar);
  activeCasesMap.set(initialCase.case_id, initialCase);

  const spatialClassification = initialCase.spatial_assessment.spatial_classification;
  const baselineProvenance = initialCase.behaviour_assessment.provenance_type || initialCase.behaviour_assessment.baseline_status;
  const initialPriors = initialCase.hypothesis_assessment.fused_hypotheses || initialCase.hypothesis_assessment.hypotheses_distribution;
  const initialEntropy = initialCase.uncertainty_assessment.current_entropy_bits ?? initialCase.uncertainty_assessment.entropy_bits;
  const priorityScore = initialCase.investigation_priority.score ?? (initialCase.investigation_priority as any).overall_score;
  const priorityLevel = (initialCase.investigation_priority as any).priority_level ?? initialCase.investigation_priority.level;

  console.log(`Case ID:                ${initialCase.case_id}`);
  console.log(`Spatial Classification: ${spatialClassification} (${initialCase.spatial_assessment.spatial_classification_label})`);
  console.log(`Baseline Status:        ${initialCase.behaviour_assessment.baseline_status} (Provenance: ${baselineProvenance})`);
  console.log(`Behavioural Status:     ${initialCase.behaviour_assessment.behavioural_status}`);
  console.log(`Investigation Priority: Score ${priorityScore}/100 [${priorityLevel}]`);
  console.log('\nInitial Bayesian Posterior (T0):');
  for (const h of initialPriors) {
    console.log(`  ${h.hypothesis.padEnd(22)}: ${h.percentage.toFixed(1)}%`);
  }
  console.log(`Initial Shannon Entropy: ${initialEntropy.toFixed(3)} bits (Max: 2.322 bits)\n`);

  // Step 4: Run initial NBE and inspect top recommendation
  console.log('--- 3. INITIAL NBE RECOMMENDATION ---');
  const initialNbe = initialCase.evidence_guided_investigation;
  const topCandidate = initialNbe?.recommendedExternalEvidence;
  console.log(`Top Recommended Candidate: ${topCandidate?.displayName || 'N/A'}`);
  console.log(`Candidate Action:           ${topCandidate?.action || topCandidate?.whyUseful}`);
  console.log(`Expected Information Gain:  ${topCandidate?.expected_information_gain_bits?.toFixed(3)} bits`);
  console.log(`Expected Posterior Entropy: ${topCandidate?.expected_posterior_entropy_bits?.toFixed(3)} bits`);
  console.log(`Target Ambiguity:           ${topCandidate?.target_ambiguity || 'N/A'}`);
  console.log(`Missing Candidates Count:   ${initialNbe?.missingEvidence?.length ?? 0}`);
  console.log(`Current Evidence Count:     ${initialNbe?.currentEvidence?.length ?? 0}\n`);

  // Step 5 & 6: Execute Real CDSE Acquisition for Sentinel-2
  console.log('--- 4. EXECUTING LIVE COPERNICUS (CDSE) ACQUISITION ---');
  const startTime = Date.now();
  const cdseResult = await fetchSentinel2SwirEvidence({
    lat: firmsObservation.latitude,
    lon: firmsObservation.longitude,
    timestamp: firmsObservation.acquisition_timestamp,
    facilityId: jamnagar.id,
    bufferKm: 2.0,
  });
  const durationMs = Date.now() - startTime;

  console.log(`CDSE query executed in ${durationMs} ms.`);
  console.log(`Status:               ${cdseResult.status}`);
  console.log(`Is Live External:     ${cdseResult.is_live_external}`);
  console.log(`Scene ID:             ${cdseResult.scene_id}`);
  console.log(`Acquisition Time:     ${cdseResult.acquisition_timestamp}`);
  console.log(`Cloud Coverage:       ${cdseResult.cloud_coverage ?? cdseResult.cloud_cover_pct}%`);
  console.log(`Temporal Difference:  ${cdseResult.temporal_difference_human} (${cdseResult.temporal_difference_hours} hours)`);
  console.log(`Temporal Status:      ${cdseResult.temporal_status}`);
  console.log(`Is Event Adjacent:    ${cdseResult.is_event_adjacent}`);
  console.log(`Provenance:           ${cdseResult.provenance}`);
  console.log(`Advisory Note:        ${cdseResult.advisory_note}\n`);

  // Step 7 & 8: Evidence Incorporation & Temporal Gate Check
  console.log('--- 5. TEMPORAL GATE & EVIDENCE INCORPORATION ---');
  const isTemporallyRelevant = cdseResult.temporal_status === 'TEMPORALLY_RELEVANT' && cdseResult.is_event_adjacent === true;
  console.log(`Temporal Eligibility Decision: ${isTemporallyRelevant ? 'TEMPORALLY_RELEVANT (Event-Level Update)' : 'TEMPORALLY_DISTANT (Contextual-Only, No Event Update)'}`);

  const updatedCase = await incorporateEvidenceIntoCase(initialCase.case_id, {
    candidate_id: 'SENTINEL2_SWIR_OPTICAL',
    value: cdseResult,
    provenance: cdseResult.is_live_external ? 'REAL' : 'CONTROLLED',
  });

  const updatedPriors = updatedCase.hypothesis_assessment.fused_hypotheses;
  const updatedEntropy = updatedCase.uncertainty_assessment.current_entropy_bits ?? updatedCase.uncertainty_assessment.entropy_bits;
  const entropyDelta = (initialEntropy - updatedEntropy);

  console.log('\nPost-Evidence Bayesian Posterior (T1):');
  for (const h of updatedPriors) {
    console.log(`  ${h.hypothesis.padEnd(22)}: ${h.percentage.toFixed(1)}%`);
  }
  console.log(`Post-Evidence Entropy:   ${updatedEntropy.toFixed(3)} bits`);
  console.log(`Entropy Delta (ΔH):      ${entropyDelta.toFixed(3)} bits\n`);

  const appliedItem = updatedCase.applied_evidence_items?.find((e) => e.evidence_type === 'SENTINEL2_SWIR_OPTICAL');
  console.log('Incorporated Evidence Item Record:');
  console.log(`  Evidence ID:             ${appliedItem?.evidence_id}`);
  console.log(`  Outcome ID:              ${appliedItem?.outcome_id}`);
  console.log(`  Outcome Name:            ${appliedItem?.outcome_name}`);
  console.log(`  Is Incorporated:         ${appliedItem?.is_incorporated}`);
  console.log(`  Provenance:              ${appliedItem?.provenance}`);
  console.log(`  Title:                   ${appliedItem?.title}`);
  console.log(`  Incorporation Rationale: ${appliedItem?.incorporation_rationale}\n`);

  // Step 9 & 10: NBE Adaptation and Duplicate Check
  console.log('--- 6. RE-ASSESSING NEXT-BEST-EVIDENCE (NBE ADAPTATION) ---');
  const adaptedNbe = updatedCase.evidence_guided_investigation;
  console.log(`Post-Acquisition Missing Candidates: ${adaptedNbe?.missingEvidence?.map((c) => c.evidenceType).join(', ')}`);
  console.log(`Post-Acquisition Current Evidence:   ${adaptedNbe?.currentEvidence?.map((c) => c.evidenceType).join(', ')}`);
  console.log(`New Top Recommendation:              ${adaptedNbe?.recommendedExternalEvidence?.displayName || 'None (All High-Value Evidence Evaluated)'}`);

  const isSentinel2InMissing = adaptedNbe?.missingEvidence?.some((c) => c.evidenceType === 'SENTINEL2_SWIR_OPTICAL');
  const isSentinel2InCurrent = adaptedNbe?.currentEvidence?.some((c) => c.evidenceType === 'SENTINEL2_SWIR_OPTICAL');
  console.log(`\nNBE Candidate Tracking:`);
  console.log(`  Sentinel-2 in Missing Evidence: ${isSentinel2InMissing ? 'YES (UNEXPECTED)' : 'NO (CORRECTLY REMOVED)'}`);
  console.log(`  Sentinel-2 in Current Evidence: ${isSentinel2InCurrent ? 'YES (CORRECTLY REGISTERED)' : 'NO (UNEXPECTED)'}`);

  // Duplicate Check: Attempting second incorporation of same evidence
  console.log('\n--- 7. DUPLICATE EVIDENCE RESISTANCE TEST ---');
  const caseAfterSecondInc = await incorporateEvidenceIntoCase(updatedCase.case_id, {
    candidate_id: 'SENTINEL2_SWIR_OPTICAL',
    value: cdseResult,
    provenance: 'REAL',
  });
  const s2ItemCount = (caseAfterSecondInc.applied_evidence_items || []).filter((e) => e.evidence_type === 'SENTINEL2_SWIR_OPTICAL').length;
  console.log(`Sentinel-2 evidence item count after re-incorporation: ${s2ItemCount} (Expected: 1)`);

  // System Verification Assertions
  const check1_cdseLive = cdseResult.status === 'AUTHENTIC_LIVE' && cdseResult.is_live_external === true;
  const check2_temporalDistant = cdseResult.temporal_status === 'TEMPORALLY_DISTANT';
  const check3_notIncorporated = appliedItem?.is_incorporated === false;
  const check4_posteriorUnchanged = Math.abs(updatedPriors[0].percentage - initialPriors[0].percentage) < 0.01;
  const check5_entropyUnchanged = Math.abs(initialEntropy - updatedEntropy) < 0.001;
  const check6_nbeAdapted = !isSentinel2InMissing && isSentinel2InCurrent;
  const check7_noDuplicate = s2ItemCount === 1;

  console.log('\n================================================================================');
  console.log('SYSTEM VALIDATION SUMMARY');
  console.log('================================================================================');
  console.log(`1. Authentic CDSE Live Acquisition:           ${check1_cdseLive ? 'PASS (AUTHENTIC_LIVE from CDSE)' : 'FAIL'}`);
  console.log(`2. Temporal Status is TEMPORALLY_DISTANT:     ${check2_temporalDistant ? 'PASS (Δt = 10,490h)' : 'FAIL'}`);
  console.log(`3. Contextual Gating (is_incorporated=false): ${check3_notIncorporated ? 'PASS' : 'FAIL'}`);
  console.log(`4. Event Bayesian Posterior Unchanged:        ${check4_posteriorUnchanged ? 'PASS' : 'FAIL'}`);
  console.log(`5. Shannon Entropy Unchanged (ΔH = 0.000):    ${check5_entropyUnchanged ? 'PASS' : 'FAIL'}`);
  console.log(`6. NBE Candidate Adaptation:                  ${check6_nbeAdapted ? 'PASS' : 'FAIL'}`);
  console.log(`7. Duplicate Evidence Resistance:             ${check7_noDuplicate ? 'PASS' : 'FAIL'}`);

  if (!check1_cdseLive || !check2_temporalDistant || !check3_notIncorporated || !check4_posteriorUnchanged || !check5_entropyUnchanged || !check6_nbeAdapted || !check7_noDuplicate) {
    throw new Error('DAY 2E-3 VALIDATION FAILED: Invariant check failed');
  }

  console.log('\n================================================================================');
  console.log('DAY 2E-3 LIVE EVIDENCE LOOP VALIDATION COMPLETED SUCCESSFULLY');
  console.log('================================================================================');
}

runDay2E3LiveEvidenceLoop().catch((err) => {
  console.error('Day 2E-3 test error:', err);
  process.exit(1);
});
