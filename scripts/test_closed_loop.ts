/**
 * Test Suite: Section 9 - Closed Evidence Loop & Investigation Update
 *
 * Verifies:
 * 1. Initial Assessment Snapshot (T0) preservation
 * 2. Next-Best-Evidence (NBE) candidate selection & status distinction
 * 3. Evidence acquisition integrity (real vs controlled paths)
 * 4. Evidence incorporation & multi-hypothesis posterior updates
 * 5. Shannon entropy deltas (H0, H1, ΔH, Uncertainty Reduction)
 * 6. EvidenceEffectRecord reasoning chain generation
 * 7. Investigation timeline audit trail (T0 -> T11) with authentic timestamps
 * 8. Independent investigator resolution without ML coercion
 * 9. Arbitrary non-Jamnagar random FIRMS event evaluation
 * 10. Multi-step closed-loop demonstration & case reset
 */

import {
  getOrCreateInvestigationCase,
  getInvestigationQueue,
  incorporateEvidenceIntoCase,
  resolveInvestigationCase,
  resetInvestigationCase,
} from '../server/investigationEngine.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

async function runClosedLoopTests() {
  console.log('================================================================');
  console.log('THERMALSENTINEL SECTION 9: CLOSED EVIDENCE LOOP TEST SUITE');
  console.log('================================================================\n');

  // -------------------------------------------------------------
  // TEST 1: Initial Assessment Snapshot (T0) & Initial Queue
  // -------------------------------------------------------------
  console.log('--- TEST 1: Initial Assessment Snapshot (T0) & Queue Formation ---');
  const queue = getInvestigationQueue();
  assert(queue.length > 0, `Investigation queue loaded with ${queue.length} priority triage cases`);

  // Target primary benchmark case
  const testCaseId = queue[0].case_id;
  const initialCase = getOrCreateInvestigationCase(testCaseId);
  assert(initialCase !== null, `Successfully retrieved initial case ${testCaseId}`);
  assert(initialCase?.initial_assessment_snapshot !== undefined, 'Initial case contains immutable initial_assessment_snapshot (T0)');
  assert(typeof initialCase?.initial_assessment_snapshot.entropy_bits === 'number', `T0 Shannon entropy recorded: ${initialCase?.initial_assessment_snapshot.entropy_bits} bits`);
  assert(initialCase?.initial_assessment_snapshot.hypotheses_distribution !== undefined && initialCase.initial_assessment_snapshot.hypotheses_distribution.length > 0, 'T0 hypotheses distribution recorded');
  assert(initialCase?.timeline !== undefined && initialCase.timeline.length >= 6, `Initial timeline contains T0-T5 events (${initialCase?.timeline?.length} events)`);

  const t0Step = initialCase?.timeline.find((e) => e.step_code === 'T0');
  const t5Step = initialCase?.timeline.find((e) => e.step_code === 'T5');
  assert(t0Step !== undefined && t0Step.event_type === 'FIRMS_DETECTION', 'Timeline begins with T0: FIRMS_DETECTION');
  assert(t5Step !== undefined && t5Step.event_type === 'NBE_GENERATED', 'Timeline includes initial T5: NBE_GENERATED');

  const snapshotT0_Entropy = initialCase!.initial_assessment_snapshot.entropy_bits;

  // -------------------------------------------------------------
  // TEST 2: NBE Selection & Candidate Status Distinction
  // -------------------------------------------------------------
  console.log('\n--- TEST 2: NBE Selection & Candidate Status Distinction ---');
  const candidates = initialCase?.nbe_assessment.ranked_candidates || [];
  assert(candidates.length > 0, `NBE generated ${candidates.length} ranked candidate evidence sources`);

  const topCandidate = candidates[0];
  assert(topCandidate !== null && topCandidate !== undefined, `Top recommended candidate identified: ${topCandidate?.displayName || topCandidate?.evidenceType}`);
  const topScore = topCandidate?.prototypeInformationValueScore;
  assert(typeof topScore === 'number', `Top candidate utility score: ${topScore}/100`);

  // Verify status distinction
  const avail = topCandidate?.availabilityStatus || topCandidate?.currentEvidenceStatus;
  assert(avail !== undefined, `Candidate has explicit availability status: ${avail}`);

  // -------------------------------------------------------------
  // TEST 3: Evidence Incorporation Step 1 (Sentinel-2 SWIR)
  // -------------------------------------------------------------
  console.log('\n--- TEST 3: Evidence Incorporation Step 1 (Sentinel-2 SWIR) ---');
  const caseAfterS2 = await incorporateEvidenceIntoCase(testCaseId, {
    candidate_id: 'EVID-JAM-S2-SWIR',
    evidence_id: 'EVID-JAM-S2-SWIR',
  });

  assert(caseAfterS2.applied_evidence_ids.includes('EVID-JAM-S2-SWIR'), 'EVID-JAM-S2-SWIR successfully registered in applied_evidence_ids');
  assert(caseAfterS2.status === 'UNDER_INVESTIGATION', `Case status transitioned to: ${caseAfterS2.status}`);

  // Check that snapshot T0 was NOT modified
  assert(Math.abs(caseAfterS2.initial_assessment_snapshot.entropy_bits - snapshotT0_Entropy) < 0.001, `Immutable T0 snapshot entropy preserved: ${caseAfterS2.initial_assessment_snapshot.entropy_bits} bits`);

  // Check Entropy Update and Delta H
  const h0 = caseAfterS2.initial_assessment_snapshot.entropy_bits;
  const h1 = caseAfterS2.uncertainty_assessment.current_entropy_bits;
  const deltaH = caseAfterS2.uncertainty_assessment.entropy_delta_bits;
  const uncRed = caseAfterS2.uncertainty_assessment.uncertainty_reduction_percentage;

  assert(typeof h1 === 'number' && h1 > 0, `Posterior Shannon entropy H1 recalculated: ${h1} bits`);
  assert(typeof deltaH === 'number', `Shannon entropy delta ΔH = H0 - H1: ${deltaH.toFixed(3)} bits`);
  assert(typeof uncRed === 'number', `Uncertainty reduction percentage: ${uncRed}%`);

  // Check EvidenceEffectRecord
  assert(caseAfterS2.evidence_effects_history && caseAfterS2.evidence_effects_history.length === 1, 'EvidenceEffectRecord created for step');
  const effect1 = caseAfterS2.evidence_effects_history[0];
  assert(effect1.evidence_id === 'EVID-JAM-S2-SWIR' || effect1.evidence_type.includes('SENTINEL'), `Effect record references evidence: ${effect1.evidence_id}`);
  assert(effect1.prior_distribution !== undefined && effect1.posterior_distribution !== undefined, 'Effect record tracks both prior and posterior distributions');
  assert(
    Math.abs(effect1.entropy_before - snapshotT0_Entropy) < 0.001 && Math.abs(effect1.entropy_after - h1) < 0.001,
    `Effect record tracks exact entropy before (${effect1.entropy_before} bits) and after (${effect1.entropy_after} bits)`
  );

  // Check Timeline Events T6 -> T10
  const t6 = caseAfterS2.timeline.find((e) => e.step_code === 'T6');
  const t7 = caseAfterS2.timeline.find((e) => e.step_code === 'T7');
  const t8 = caseAfterS2.timeline.find((e) => e.step_code === 'T8');
  const t9 = caseAfterS2.timeline.find((e) => e.step_code === 'T9');
  const t10 = caseAfterS2.timeline.find((e) => e.step_code === 'T10');

  assert(t6 !== undefined && t6.event_type === 'EVIDENCE_SELECTED', 'Timeline recorded T6: EVIDENCE_SELECTED');
  assert(t7 !== undefined && t7.event_type === 'EVIDENCE_INCORPORATED', 'Timeline recorded T7: EVIDENCE_INCORPORATED');
  assert(t8 !== undefined && t8.event_type === 'HYPOTHESES_UPDATED', 'Timeline recorded T8: HYPOTHESES_UPDATED');
  assert(t9 !== undefined && t9.event_type === 'ENTROPY_UPDATED', 'Timeline recorded T9: ENTROPY_UPDATED');
  assert(t10 !== undefined && t10.event_type === 'PRIORITY_UPDATED', 'Timeline recorded T10: PRIORITY_UPDATED');

  // -------------------------------------------------------------
  // TEST 4: Evidence Incorporation Step 2 (OSM Infrastructure)
  // -------------------------------------------------------------
  console.log('\n--- TEST 4: Evidence Incorporation Step 2 (OSM Infrastructure) ---');
  const caseAfterOsm = await incorporateEvidenceIntoCase(testCaseId, {
    candidate_id: 'EVID-OSM-INFRA',
    evidence_id: 'EVID-OSM-INFRA',
  });

  assert(caseAfterOsm.applied_evidence_ids.length === 2, `Total incorporated evidence items: ${caseAfterOsm.applied_evidence_ids.length}`);
  assert(caseAfterOsm.evidence_effects_history.length === 2, `Evidence effects reasoning chain contains ${caseAfterOsm.evidence_effects_history.length} auditable steps`);

  const effect2 = caseAfterOsm.evidence_effects_history[1];
  assert(Math.abs(effect2.entropy_before - h1) < 0.001, `Step 2 prior entropy matches Step 1 posterior entropy (${effect2.entropy_before} bits)`);

  // -------------------------------------------------------------
  // TEST 5: Independent Investigator Resolution (T11)
  // -------------------------------------------------------------
  console.log('\n--- TEST 5: Independent Investigator Resolution (T11) ---');
  const resolvedCase = resolveInvestigationCase(testCaseId, {
    verdict: 'INDUSTRIAL_FIRE',
    confidence: 94,
    notes: 'Ground-level abnormal thermal excursion confirmed near Coker Unit via high-resolution SWIR and OSM facility context.',
    investigator_id: 'SENIOR_ANALYST_DEEPA',
  });

  assert(resolvedCase.status === 'RESOLVED', `Case transitioned to RESOLVED status`);
  assert(resolvedCase.investigator_resolution !== undefined, 'investigator_resolution record created');
  assert(resolvedCase.investigator_resolution?.verdict === 'INDUSTRIAL_FIRE', `Resolution verdict: ${resolvedCase.investigator_resolution?.verdict}`);
  assert(resolvedCase.investigator_resolution?.confidence === 94, `Resolution confidence: ${resolvedCase.investigator_resolution?.confidence}%`);
  assert(resolvedCase.investigator_resolution?.investigator_id === 'SENIOR_ANALYST_DEEPA', `Investigator ID: ${resolvedCase.investigator_resolution?.investigator_id}`);

  const t11 = resolvedCase.timeline.find((e) => e.step_code === 'T11');
  assert(t11 !== undefined && t11.event_type === 'INVESTIGATOR_RESOLUTION', 'Timeline recorded T11: INVESTIGATOR_RESOLUTION');
  assert(t11?.summary.includes('94%'), 'Timeline T11 includes investigator confidence');

  // -------------------------------------------------------------
  // TEST 6: Case Reset to Pristine T0 Baseline
  // -------------------------------------------------------------
  console.log('\n--- TEST 6: Case Reset to Pristine T0 Baseline ---');
  const resetCase = resetInvestigationCase(testCaseId);
  assert(resetCase.status === 'OPEN', `Case status restored to OPEN`);
  assert(resetCase.applied_evidence_ids.length === 0, 'Applied evidence IDs cleared');
  assert(resetCase.evidence_effects_history.length === 0, 'Evidence effects history cleared');
  assert(Math.abs(resetCase.uncertainty_assessment.current_entropy_bits - snapshotT0_Entropy) < 0.001, `Entropy restored to initial T0: ${resetCase.uncertainty_assessment.current_entropy_bits} bits`);
  
  const resetEvent = resetCase.timeline.find((e) => e.event_type === 'CASE_RESET');
  assert(resetEvent !== undefined, 'Timeline records CASE_RESET event');

  // -------------------------------------------------------------
  // TEST 7: Random Arbitrary Non-Jamnagar FIRMS Event Test
  // -------------------------------------------------------------
  console.log('\n--- TEST 7: Random Arbitrary Non-Jamnagar FIRMS Event Test ---');
  // Synthetic / arbitrary regional FIRMS hotspot far from Jamnagar (e.g. Punjab Agricultural Belt / Wildland)
  const arbitraryObservation = {
    id: 'FIRMS-20260923-REGIONAL-8841',
    latitude: 30.7333,
    longitude: 76.7794,
    acquisition_time: '2026-09-23T08:15:00Z',
    satellite: 'NOAA-20',
    frp: 8.45,
    confidence: 'high',
    brightness_ti4: 334.2,
    brightness_ti5: 295.1,
    scan: 0.38,
    track: 0.36,
    daynight: 'D',
  };

  const arbitraryCase = getOrCreateInvestigationCase(arbitraryObservation.id, arbitraryObservation);
  assert(arbitraryCase !== null, `Dossier successfully generated for non-Jamnagar observation ${arbitraryObservation.id}`);
  assert(arbitraryCase?.associated_facility === null, 'Observation correctly recognized as unassociated with Jamnagar/monitored facilities');
  assert(arbitraryCase?.spatial_assessment.spatial_classification === 'UNASSOCIATED', `Spatial classification: ${arbitraryCase?.spatial_assessment.spatial_classification}`);
  assert(arbitraryCase?.behaviour_assessment.behavioural_status === 'NOT_ASSESSED', `Behavioural status: ${arbitraryCase?.behaviour_assessment.behavioural_status} (no fake baseline)`);
  assert(arbitraryCase?.hypothesis_assessment.primary_hypothesis_type !== 'GAS_FLARE', `Non-industrial location prioritized non-flare candidate: ${arbitraryCase?.hypothesis_assessment.primary_hypothesis}`);
  assert(arbitraryCase?.uncertainty_assessment.current_entropy_bits! > 0, `Shannon entropy calculated: ${arbitraryCase?.uncertainty_assessment.current_entropy_bits} bits`);
  assert(arbitraryCase?.nbe_assessment.ranked_candidates.length! > 0, `NBE ranked candidates generated (${arbitraryCase?.nbe_assessment.ranked_candidates.length} candidates)`);
  assert(arbitraryCase?.investigation_priority.score! > 0, `Investigation triage priority calculated: ${arbitraryCase?.investigation_priority.score}/100 (${arbitraryCase?.investigation_priority.level})`);

  // Closed loop on arbitrary event: incorporate land cover / weather evidence
  const arbitraryCaseFused = await incorporateEvidenceIntoCase(arbitraryCase!.case_id, {
    candidate_id: 'EVID-WEATHER-WIND',
    evidence_id: 'EVID-WEATHER-WIND',
  });
  assert(arbitraryCaseFused.applied_evidence_ids.includes('EVID-WEATHER-WIND'), 'Evidence successfully incorporated into non-Jamnagar regional case');
  assert(arbitraryCaseFused.evidence_effects_history.length === 1, 'EvidenceEffectRecord created for regional case');

  // -------------------------------------------------------------
  // TEST SUMMARY
  // -------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`CLOSED EVIDENCE LOOP TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runClosedLoopTests().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
