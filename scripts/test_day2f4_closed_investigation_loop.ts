import 'dotenv/config';
import {
  buildInvestigationCase,
  incorporateEvidenceIntoCase,
  resolveInvestigationCase,
} from '../server/investigationEngine.js';
import { MONITORED_FACILITIES } from '../server/facilities.js';
import { calculateExactShannonEntropy } from '../server/evidenceFusionEngine.js';

async function testDay2F4ClosedInvestigationLoop() {
  console.log('================================================================================');
  console.log('DAY 2F-4 — CLOSED INVESTIGATION LOOP VALIDATION (END-TO-END)');
  console.log('================================================================================\n');

  // STEP 1: DETECT
  console.log('--- STEP 1: DETECT (FIRMS Ingestion & Facility Spatial Association) ---');
  const jamnagar = MONITORED_FACILITIES.find((f) => f.id === 'FAC-GUJ-JAMNAGAR-01');
  if (!jamnagar) throw new Error('Jamnagar facility not found');

  const firmsJamnagar = {
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

  const initialCase = buildInvestigationCase(firmsJamnagar, jamnagar);
  console.log(`Case ID:                ${initialCase.case_id}`);
  console.log(`Spatial Association:    ${initialCase.spatial_assessment?.spatial_classification} (${initialCase.spatial_assessment?.spatial_classification_label})`);
  console.log(`Behavioural Status:     ${initialCase.behaviour_assessment?.behavioural_status}`);
  console.log(`Triage Priority Score:  ${initialCase.investigation_priority?.score}/100 [${initialCase.investigation_priority?.level}]`);
  console.log(`Initial Resolution:     ${initialCase.resolution_status}`);

  // STEP 2: EXPLAIN
  console.log('\n--- STEP 2: EXPLAIN (Initial Contextual Posterior & Entropy) ---');
  const t0Hypo = initialCase.hypothesis_assessment?.posterior_distribution || [];
  console.log('Authoritative T0 Posterior Distribution:');
  for (const h of t0Hypo) {
    console.log(`  - ${h.hypothesis.padEnd(20)}: ${h.percentage}% (${h.normalized_score.toFixed(4)})`);
  }
  const h0 = initialCase.uncertainty_assessment?.current_entropy_bits ?? 0;
  console.log(`Initial Shannon Entropy (H0): ${h0.toFixed(3)} bits`);

  const t0_ind = t0Hypo.find((h) => h.hypothesis === 'INDUSTRIAL_FIRE')?.percentage ?? 0;
  const t0_flare = t0Hypo.find((h) => h.hypothesis === 'GAS_FLARE')?.percentage ?? 0;
  const t0_other = t0Hypo.find((h) => h.hypothesis === 'OTHER')?.percentage ?? 0;

  // STEP 3: QUESTION (NBE Engine)
  console.log('\n--- STEP 3: QUESTION (NBE Recommendations & Ambiguity) ---');
  console.log(`Target Ambiguity:       ${initialCase.nbe_assessment?.target_ambiguity}`);
  console.log(`Top Available NBE:      ${initialCase.nbe_assessment?.recommended_available_evidence?.displayName || 'N/A'}`);
  console.log(`Top External NBE:       ${initialCase.nbe_assessment?.recommended_external_evidence?.displayName || 'N/A'}`);
  console.log(`Ranked Candidates Count:${initialCase.nbe_assessment?.ranked_candidates?.length}`);

  const topExtCandidate = initialCase.nbe_assessment?.recommended_external_evidence?.recommendedCandidate;
  console.log(`Top External Candidate: ${topExtCandidate?.evidenceType} (EIG = ${topExtCandidate?.expectedInformationGainBits?.toFixed(3)} bits)`);

  // STEP 4: ACQUIRE / ADD CONTROLLED EVIDENCE
  console.log('\n--- STEP 4: ACQUIRE / ADD EVIDENCE (Controlled Contemporaneous Sentinel-2 SWIR) ---');
  console.log('Executing controlled evidence incorporation with explicit outcome model...');

  const controlledS2Likelihood = {
    INDUSTRIAL_FIRE: 0.80,
    GAS_FLARE: 0.04,
    OTHER: 0.08,
    AGRICULTURAL_BURN: 0.04,
    WILDFIRE_VEGETATION: 0.04,
  };

  const updatedCase = await incorporateEvidenceIntoCase(initialCase.case_id, {
    candidate_id: 'SENTINEL2_SWIR_OPTICAL',
    evidence_id: 'EVID-SENTINEL2-CONTEMPORANEOUS-CONTROLLED',
    outcome_id: 'SURFACE_SPREAD_PROCESS_STRUCTURE',
    outcome_name: 'Multi-Pixel Ground Bloom over Process Unit / Storage Area',
    title: 'Contemporaneous Sentinel-2 SWIR Inspection (CONTROLLED)',
    description: 'Controlled demonstration of contemporaneous 20m SWIR overpass resolving ground-level structural fire spread.',
    provenance: 'CONTROLLED',
    reliability: 'HIGH',
    is_incorporated: true,
    likelihood_by_hypothesis: controlledS2Likelihood,
    value: {
      scene_id: 'S2_CONTROLLED_CONTEMPORANEOUS_20260225',
      temporal_status: 'TEMPORALLY_RELEVANT',
      is_event_adjacent: true,
      temporal_difference_hours: 0.5,
      evidence_findings: {
        uncontained_spread: true,
        spatial_expansion: true,
        swir_thermal_pattern: 'ground_fire_diffuse_bloom',
      },
    },
    incorporation_rationale: 'Contemporaneous high-resolution SWIR satellite inspection confirms uncontained ground spread over process equipment.',
  });

  const t1Hypo = updatedCase.hypothesis_assessment?.posterior_distribution || [];
  console.log('\nUpdated T1 Posterior Distribution:');
  for (const h of t1Hypo) {
    console.log(`  - ${h.hypothesis.padEnd(20)}: ${h.percentage}% (${h.normalized_score.toFixed(4)})`);
  }
  const h1 = updatedCase.uncertainty_assessment?.current_entropy_bits ?? 0;
  const deltaH = updatedCase.uncertainty_assessment?.entropy_delta_bits ?? (h0 - h1);
  const redPct = updatedCase.uncertainty_assessment?.uncertainty_reduction_percentage ?? 0;
  console.log(`Updated Shannon Entropy (H1): ${h1.toFixed(3)} bits`);
  console.log(`Entropy Delta (ΔH):           +${deltaH.toFixed(3)} bits (${redPct}% reduction)`);
  console.log(`Post-Evidence Resolution Status: ${updatedCase.resolution_status} (Expected: PENDING_INVESTIGATION)`);

  const t1_ind = t1Hypo.find((h) => h.hypothesis === 'INDUSTRIAL_FIRE')?.percentage ?? 0;
  const t1_flare = t1Hypo.find((h) => h.hypothesis === 'GAS_FLARE')?.percentage ?? 0;
  const t1_other = t1Hypo.find((h) => h.hypothesis === 'OTHER')?.percentage ?? 0;

  // STEP 5: RESOLVE (Controlled Demonstration of Investigator Resolution)
  console.log('\n--- STEP 5: RESOLVE (Formal Investigator Resolution - Controlled Demonstration) ---');
  const resolvedCase = resolveInvestigationCase(updatedCase.case_id, {
    verdict: 'INDUSTRIAL_FIRE',
    confidence: 98,
    provenance: 'CONTROLLED',
    resolution_type: 'CONTROLLED_SIMULATION_DEMO',
    investigator_id: 'DEMO_WORKFLOW_VERIFIER',
    notes:
      'Controlled demonstration of investigation resolution workflow. Operator concurs with mathematical posterior (98%) following incorporation of controlled contemporaneous Sentinel-2 SWIR evidence. This is a synthetic workflow validation, not an externally verified physical incident report.',
    evidence_used: [
      'NASA_FIRMS_VIIRS_DETECTION',
      'FACILITY_BOUNDARY_GEOMETRY',
      'EVID-SENTINEL2-CONTEMPORANEOUS-CONTROLLED',
    ],
  });

  console.log(`Final Resolution Status: ${resolvedCase.resolution_status} (Expected: CONCURRED_WITH_PRIMARY)`);
  console.log(`Final Verdict:           ${resolvedCase.investigator_resolution?.verdict}`);
  console.log(`Resolution Provenance:   ${resolvedCase.investigator_resolution?.provenance} (${resolvedCase.investigator_resolution?.resolution_type})`);
  console.log(`Investigator Confidence: ${resolvedCase.investigator_resolution?.confidence}%`);
  console.log(`Investigator ID:         ${resolvedCase.investigator_resolution?.investigator_id}`);
  console.log(`Investigator Notes:      ${resolvedCase.investigator_resolution?.notes}`);
  console.log(`Timeline Events Count:   ${resolvedCase.timeline?.length} events`);

  // VALIDATION ASSERTIONS
  console.log('\n================================================================================');
  console.log('DAY 2F-4 PROOF OBLIGATION CHECKS');
  console.log('================================================================================');

  const c1_initial = t0_ind === 74 && t0_flare === 21 && t0_other === 5 && Math.abs(h0 - 1.013) < 0.01;
  console.log(`1. Initial Posterior equals established T0 (74/21/5, H0=1.013):   ${c1_initial ? 'PASS' : 'FAIL'}`);

  const c2_nbe_input = initialCase.nbe_assessment?.current_entropy_bits !== undefined && initialCase.nbe_assessment.current_entropy_bits > 0;
  console.log(`2. NBE receives authoritative posterior & entropy as input:        ${c2_nbe_input ? 'PASS' : 'FAIL'}`);

  const appliedS2 = updatedCase.applied_evidence_items?.find((e) => e.evidence_id === 'EVID-SENTINEL2-CONTEMPORANEOUS-CONTROLLED');
  const c3_lifecycle =
    appliedS2 !== undefined &&
    appliedS2.provenance === 'CONTROLLED' &&
    appliedS2.is_acquired === true &&
    appliedS2.is_evaluated === true &&
    appliedS2.is_temporally_eligible === true &&
    appliedS2.temporal_status === 'TEMPORALLY_RELEVANT';
  console.log(`3. Controlled evidence represented with valid lifecycle/provenance:${c3_lifecycle ? 'PASS' : 'FAIL'}`);

  const c4_incorporated = appliedS2?.is_incorporated === true && appliedS2?.changed_posterior === true;
  console.log(`4. Controlled evidence is actually incorporated into posterior:    ${c4_incorporated ? 'PASS' : 'FAIL'}`);

  const sumP = t1Hypo.reduce((acc, h) => acc + h.percentage, 0);
  const c5_normalized = sumP === 100;
  console.log(`5. New posterior is mathematically normalized (sum = ${sumP}%):     ${c5_normalized ? 'PASS' : 'FAIL'}`);

  const c6_posterior_diff = t1_ind === 98 && t1_flare === 1 && t1_other === 1;
  console.log(`6. New posterior shifts correctly under likelihood (98/1/1):       ${c6_posterior_diff ? 'PASS' : 'FAIL'}`);

  const c7_entropy = h1 < h0 && deltaH > 0.80;
  console.log(`7. Entropy reduced consistently (H0=${h0.toFixed(3)} -> H1=${h1.toFixed(3)}, ΔH=+${deltaH.toFixed(3)}): ${c7_entropy ? 'PASS' : 'FAIL'}`);

  const c8_nbe_distinction = initialCase.nbe_assessment?.target_ambiguity?.includes('Industrial Flare Stack vs Unconfined Industrial Fire');
  console.log(`8. NBE candidate recommendation correctly distinguishes target:    ${c8_nbe_distinction ? 'PASS' : 'FAIL'}`);

  const staleS2 = initialCase.applied_evidence_items?.find((e) => e.temporal_status === 'TEMPORALLY_DISTANT');
  const c9_stale_gated = staleS2 ? staleS2.is_incorporated === false : true;
  console.log(`9. Stale Sentinel-2 remains non-incorporated (temporal gate):       ${c9_stale_gated ? 'PASS' : 'FAIL'}`);

  const mlEvidence = initialCase.evidence_assessment?.explicit_evidence_items?.find((e) => e.evidence_id === 'EVID-ML-DISCRIMINATOR');
  const c10_ml_advisory = mlEvidence?.is_incorporated === false && mlEvidence?.changed_posterior === false;
  console.log(`10. ML evidence excluded from Bayesian likelihood product:         ${c10_ml_advisory ? 'PASS' : 'FAIL'}`);

  const c11_resolution =
    updatedCase.resolution_status === 'PENDING_INVESTIGATION' &&
    resolvedCase.resolution_status === 'CONCURRED_WITH_PRIMARY' &&
    resolvedCase.investigator_resolution?.verdict === 'INDUSTRIAL_FIRE' &&
    resolvedCase.investigator_resolution?.provenance === 'CONTROLLED' &&
    resolvedCase.investigator_resolution?.resolution_type === 'CONTROLLED_SIMULATION_DEMO';
  console.log(`11. Formal controlled resolution verified with explicit provenance:${c11_resolution ? 'PASS' : 'FAIL'}`);

  const allPassed =
    c1_initial &&
    c2_nbe_input &&
    c3_lifecycle &&
    c4_incorporated &&
    c5_normalized &&
    c6_posterior_diff &&
    c7_entropy &&
    c8_nbe_distinction &&
    c9_stale_gated &&
    c10_ml_advisory &&
    c11_resolution;

  if (!allPassed) {
    throw new Error('Day 2F-4 closed-loop test assertions failed');
  }

  console.log('\n================================================================================');
  console.log('DAY 2F-4 CLOSED INVESTIGATION LOOP VALIDATION PASSED (11/11 CHECKS)');
  console.log('================================================================================\n');
}

testDay2F4ClosedInvestigationLoop().catch((err) => {
  console.error('Day 2F-4 error:', err);
  process.exit(1);
});
