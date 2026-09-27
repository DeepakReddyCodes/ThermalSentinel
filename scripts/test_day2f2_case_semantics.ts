import 'dotenv/config';
import { buildInvestigationCase, incorporateEvidenceIntoCase, resolveInvestigationCase } from '../server/investigationEngine.js';
import { MONITORED_FACILITIES } from '../server/facilities.js';

async function validateDay2F2Semantics() {
  console.log('================================================================================');
  console.log('DAY 2F-2 — INVESTIGATION CASE SEMANTICS VALIDATION');
  console.log('================================================================================\n');

  // Case A: Jamnagar Refining Complex
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

  const caseJam = buildInvestigationCase(firmsJamnagar, jamnagar);

  // Case B: Unassociated Regional Hotspot
  const firmsUnassoc = {
    id: 'FIRMS-20260225-UNASSOC-01',
    latitude: 23.5000,
    longitude: 70.5000,
    acquisition_timestamp: '2026-02-25T09:30:00Z',
    satellite: 'VIIRS-NOAA20',
    sensor: 'VIIRS',
    frp: 22.0,
    confidence: 'nominal' as const,
    day_night: 'N' as const,
    brightness_kelvin: 320.0,
    brightness_ti4: 320.0,
    brightness_ti5: 290.0,
    brightness_delta: 30.0,
  };

  const caseUnassoc = buildInvestigationCase(firmsUnassoc, null);

  function printCaseAudit(title: string, c: typeof caseJam) {
    console.log(`--------------------------------------------------------------------------------`);
    console.log(title);
    console.log(`--------------------------------------------------------------------------------`);
    console.log(`1. Observation Timestamp:        ${c.timestamp}`);
    console.log(`2. Baseline Obs-Period Start/End: ${c.behaviour_assessment?.baseline_period?.observation_period_start ?? 'N/A'} to ${c.behaviour_assessment?.baseline_period?.observation_period_end ?? 'N/A'}`);
    console.log(`3. Baseline Sample Count:        ${c.behaviour_assessment?.baseline_sample_count ?? 0} observations`);
    console.log(`4. Observation-Day Count:        ${c.behaviour_assessment?.baseline_period?.observation_days ?? 0} unique observation days`);
    console.log(`5. Configured Analysis Window:   ${c.behaviour_assessment?.baseline_period?.analysis_window_days ? `${c.behaviour_assessment.baseline_period.analysis_window_days} days` : 'N/A'}`);
    console.log(`   Temporal Summary:             ${c.behaviour_assessment?.temporal_coverage_summary ?? 'No empirical baseline configured'}`);
    console.log(`6. Population Scope:             ${c.behaviour_assessment?.population_scope}`);
    console.log(`7. Baseline Provenance:          ${c.behaviour_assessment?.provenance_type || c.behaviour_assessment?.baseline_status}`);
    console.log(`8. Behaviour Status:             ${c.behaviour_assessment?.behavioural_status}`);
    console.log(`9. Prior Distribution:           ${c.hypothesis_assessment?.prior_distribution?.map((h) => `${h.hypothesis}: ${h.percentage}%`).join(', ') || 'N/A'}`);
    console.log(`10. Posterior Distribution:      ${c.hypothesis_assessment?.posterior_distribution?.map((h) => `${h.hypothesis}: ${h.percentage}%`).join(', ') || 'N/A'}`);
    console.log(`11. Shannon Entropy:             ${c.uncertainty_assessment?.current_entropy_bits?.toFixed(3)} bits`);
    console.log(`12. NBE Target Ambiguity:        ${c.nbe_assessment?.target_ambiguity}`);
    console.log(`13. Candidate Evidence State:    ${c.evidence_assessment?.all_candidates?.length} total candidates available in strategy model`);
    console.log(`14. Acquired Evidence State:     ${c.applied_evidence_items?.filter((e) => e.is_acquired).length} items acquired`);
    console.log(`15. Evaluated Evidence State:    ${c.applied_evidence_items?.filter((e) => e.is_evaluated).length} items evaluated`);
    console.log(`16. Temporally Eligible Evidence: ${c.applied_evidence_items?.filter((e) => e.is_temporally_eligible).length} items eligible`);
    console.log(`17. Incorporated Evidence:       ${c.applied_evidence_items?.filter((e) => e.is_incorporated).length} items incorporated into posterior`);
    console.log(`18. Actually Changed Posterior:  ${c.applied_evidence_items?.filter((e) => e.changed_posterior).length} items adjusted probabilities`);
    console.log(`19. Resolution Status:           ${c.resolution_status}`);
    console.log(`20. Provenance Distinction:      Case: ${c.provenance} | Baseline: ${c.behaviour_assessment?.provenance_type} | ML: ${c.evidence_assessment?.radiometric_discriminator?.status} | Spatial: ${c.spatial_assessment?.spatial_classification}\n`);
  }

  printCaseAudit('CASE A: JAMNAGAR REFINING COMPLEX (FACILITY-ASSOCIATED ANOMALY)', caseJam);
  printCaseAudit('CASE B: UNASSOCIATED REGIONAL HOTSPOT (RURAL / WILDLAND TERRAIN)', caseUnassoc);

  // Test Resolution Lifecycle
  console.log('--- TESTING FORMAL INVESTIGATION RESOLUTION LIFECYCLE ---');
  const resolvedCase = resolveInvestigationCase(caseJam.case_id, {
    verdict: 'INDUSTRIAL_FIRE',
    confidence: 90,
    notes: 'Ground operations confirmed containment team dispatch.',
  });
  console.log(`Resolution Status after operator verdict: ${resolvedCase.resolution_status} (Expected: CONCURRED_WITH_PRIMARY)`);
  console.log(`Verdict: ${resolvedCase.investigator_resolution?.verdict} | Confidence: ${resolvedCase.investigator_resolution?.confidence}%\n`);

  // Assertions
  const checkJam_temporal = caseJam.behaviour_assessment?.baseline_period?.observation_days === 88 && caseJam.behaviour_assessment?.baseline_sample_count === 294;
  const checkJam_ambiguity = typeof caseJam.nbe_assessment?.target_ambiguity === 'string' && caseJam.nbe_assessment.target_ambiguity.length > 0;
  const checkJam_priorPost = Boolean(caseJam.hypothesis_assessment?.prior_distribution && caseJam.hypothesis_assessment?.posterior_distribution);
  const checkJam_res = caseJam.resolution_status === 'PENDING_INVESTIGATION' && resolvedCase.resolution_status === 'CONCURRED_WITH_PRIMARY';
  const checkUnassoc_scope = caseUnassoc.behaviour_assessment?.population_scope === 'NOT_APPLICABLE' && caseUnassoc.spatial_assessment?.spatial_classification === 'UNASSOCIATED';

  console.log('================================================================================');
  console.log('DAY 2F-2 SEMANTIC AUDIT CHECKS');
  console.log('================================================================================');
  console.log(`1. Baseline Temporal Semantics (88 days, 294 obs): ${checkJam_temporal ? 'PASS' : 'FAIL'}`);
  console.log(`2. Canonical NBE Target Ambiguity Exposed:          ${checkJam_ambiguity ? 'PASS' : 'FAIL'}`);
  console.log(`3. Explicit Prior & Posterior Distributions:        ${checkJam_priorPost ? 'PASS' : 'FAIL'}`);
  console.log(`4. Formal Investigation Resolution Status:          ${checkJam_res ? 'PASS' : 'FAIL'}`);
  console.log(`5. Unassociated Case Semantics & Population Scope:  ${checkUnassoc_scope ? 'PASS' : 'FAIL'}`);

  if (!checkJam_temporal || !checkJam_ambiguity || !checkJam_priorPost || !checkJam_res || !checkUnassoc_scope) {
    throw new Error('Day 2F-2 validation failed');
  }

  console.log('\nDAY 2F-2 VALIDATION PASSED SUCCESSFULLY.');
}

validateDay2F2Semantics().catch((err) => {
  console.error('Day 2F-2 error:', err);
  process.exit(1);
});
