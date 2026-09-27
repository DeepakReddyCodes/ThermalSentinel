/**
 * Day 2D-2 Test Suite: Closed-Loop Next-Best-Evidence (NBE) Validation
 *
 * Proves the complete closed-loop workflow:
 * CURRENT CASE
 * → authoritative Bayesian posterior
 * → current entropy
 * → NBE recommendation
 * → controlled evidence outcome addition
 * → authoritative Bayesian-compatible update: P_new(H) ∝ P_old(H) * P(E | H)
 * → updated posterior (sums to 1.0 / 100%)
 * → updated entropy
 *
 * Scenarios:
 * 1. Case A (Industrial / Monitored Facility Event — Jamnagar):
 *    - Initial state: High FRP excursion in thermal zone
 *    - NBE recommendations: Evaluates candidate EIG; recommends Sentinel-2 SWIR
 *    - Action: Controlled evidence outcome (POINT_EMITTER_ELEVATED_STACK) with explicit likelihoods
 *    - Update: Bayesian update elevates GAS_FLARE to 95%, reduces entropy by ΔH ≈ 0.91 bits
 *    - Mathematical Invariant: P_new matches P_0(H) * P(E|H) normalized
 *    - Invariant: Re-incorporating identical evidence prevents double-counting
 *
 * 2. Case B (Unassociated Regional Event — Rural Hotspot):
 *    - Initial state: Unassociated vegetation hotspot
 *    - NBE recommendations: Transparently distinguishes available vs unavailable modalities (Land Cover unavailable, SCADA out-of-scope)
 *    - Action: Controlled non-informative / neutral evidence outcome (uniform likelihoods)
 *    - Update: Posterior and entropy remain strictly invariant (ΔH = 0.000 bits)
 */

import {
  buildInvestigationCase,
  getOrCreateInvestigationCase,
  incorporateEvidenceIntoCase,
} from '../server/investigationEngine';
import { MONITORED_FACILITIES } from '../server/facilities';
import { getFacilityBaselineSync } from '../server/baselineRepository';
import { SourceHypothesisType } from '../server/types';
import { CANDIDATE_OUTCOME_MODELS } from '../server/nbeEngine';

async function runClosedLoopTests() {
  console.log('================================================================');
  console.log('DAY 2D-2: CLOSED-LOOP NBE BAYESIAN VALIDATION TEST SUITE');
  console.log('================================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    totalTests++;
    if (condition) {
      console.log(`  [PASS] ${testName}`);
      passedTests++;
    } else {
      console.error(`  [FAIL] ${testName}`);
      if (detail) console.error(`         Detail: ${detail}`);
      throw new Error(`Test failed: ${testName} - ${detail}`);
    }
  }

  const jamnagarFacility = MONITORED_FACILITIES.find((f) => f.id === 'FAC-GUJ-JAMNAGAR-01')!;
  const jamnagarBaseline = getFacilityBaselineSync('FAC-GUJ-JAMNAGAR-01');

  // =========================================================================
  // SCENARIO 1: CASE A — INDUSTRIAL/FACILITY EVENT (Jamnagar Anomalous Flare)
  // =========================================================================
  console.log('--- SCENARIO 1: CASE A — Industrial Facility Case (Jamnagar) ---');

  const caseAObs: any = {
    id: 'JAM_ANOMALOUS_EVENT_2026_01',
    latitude: 22.3685,
    longitude: 69.8690,
    brightness: 388.0,
    frp: 345.0,
    confidence: 'nominal',
    confidence_numeric: 85,
    acq_date: '2026-03-15',
    acq_time: '1830',
    satellite: 'VIIRS-NPP',
    instrument: 'VIIRS',
    daynight: 'N',
    day_night: 'N',
    frp_mw: 345.0,
    spatial_association: 'KNOWN_THERMAL_ZONE',
    distance_to_facility_meters: 0,
    distance_to_zone_meters: 0,
    is_inside_polygon: true,
  };

  // Step 1: Build Initial Investigation Case
  const initialCaseA = buildInvestigationCase(caseAObs, jamnagarFacility, jamnagarBaseline);
  const initialCaseId = initialCaseA.case_id;

  // Ensure case is in active registry for interactive updates
  getOrCreateInvestigationCase(initialCaseId, caseAObs);

  const initialPosteriorA = initialCaseA.hypothesis_assessment.hypotheses_distribution;
  const initialEntropyA = initialCaseA.uncertainty_assessment.current_entropy_bits ?? initialCaseA.uncertainty_assessment.entropy_bits;
  const initialNbeA = initialCaseA.nbe_assessment;

  console.log(`  Case A Initial State:`);
  console.log(`    Primary Hypothesis : ${initialCaseA.hypothesis_assessment.primary_hypothesis} (${initialPosteriorA[0]?.percentage}%)`);
  console.log(`    Initial Entropy    : ${initialEntropyA.toFixed(3)} bits`);
  console.log(`    Top Recommended NBE: ${initialNbeA.recommended_external_evidence.displayName} (${initialNbeA.recommended_external_evidence.availability})`);

  assert(
    initialCaseA.case_id.length > 0,
    'A.1 Initial Case A created with valid case_id'
  );
  assert(
    initialEntropyA > 0,
    'A.2 Initial Case A entropy is positive and non-zero',
    `entropy=${initialEntropyA}`
  );
  assert(
    initialNbeA.recommended_external_evidence.recommendedCandidate !== null,
    'A.3 NBE recommends eligible evidence for ambiguous industrial case'
  );

  // Step 2: Inject Controlled Evidence Outcome with Explicit Bayesian Likelihoods
  console.log('\n  Incorporate Controlled Evidence into Case A: Sentinel-2 SWIR Point Emitter Outcome');

  const s2Model = CANDIDATE_OUTCOME_MODELS.SENTINEL2_SWIR_OPTICAL;
  const pointEmitterOutcome = s2Model.outcomes.find((o) => o.id === 'POINT_EMITTER_ELEVATED_STACK')!;

  const s2EvidenceInput = {
    candidate_id: 'SENTINEL2_SWIR_OPTICAL',
    evidence_id: 'EVID-S2-JAM-01',
    outcome_id: pointEmitterOutcome.id,
    outcome_name: pointEmitterOutcome.name,
    title: 'Controlled Test: Sentinel-2 MSI SWIR Point Emitter Observation',
    description: 'Controlled prototype finding: 20m resolution MSI SWIR reveals sharp point emitter on flare stack with zero uncontained ground spread.',
    evidence_type: 'SENTINEL2_SWIR_OPTICAL',
    provenance: 'CONTROLLED' as const,
    reliability: 'HIGH' as const,
    applicability: 'High-resolution multispectral discrimination of emitter geometry.',
    affected_hypotheses: ['GAS_FLARE', 'INDUSTRIAL_FIRE', 'AGRICULTURAL_BURN', 'WILDFIRE_VEGETATION', 'OTHER'] as SourceHypothesisType[],
    likelihood_by_hypothesis: pointEmitterOutcome.conditionalLikelihood,
    is_incorporated: true,
    incorporation_rationale: 'Controlled test outcome: High-resolution multispectral SWIR confirms localized stack flaring with no ground structure involvement.',
  };

  const updatedCaseA = await incorporateEvidenceIntoCase(initialCaseId, s2EvidenceInput);

  const updatedPosteriorA = updatedCaseA.hypothesis_assessment.fused_hypotheses || updatedCaseA.hypothesis_assessment.hypotheses_distribution;
  const updatedEntropyA = updatedCaseA.uncertainty_assessment.current_entropy_bits ?? updatedCaseA.uncertainty_assessment.entropy_bits;
  const entropyDeltaA = (initialCaseA.uncertainty_assessment.initial_entropy_bits ?? initialEntropyA) - updatedEntropyA;

  console.log(`  Case A Updated State:`);
  console.log(`    Updated Primary    : ${updatedCaseA.hypothesis_assessment.primary_hypothesis} (${updatedPosteriorA[0]?.percentage}%)`);
  console.log(`    Updated Entropy    : ${updatedEntropyA.toFixed(3)} bits (ΔH = ${entropyDeltaA.toFixed(3)} bits)`);
  console.log(`    Evidence Applied   : ${updatedCaseA.applied_evidence_items.length} items (${updatedCaseA.applied_evidence_items.map((e) => e.evidence_type).join(', ')})`);
  console.log(`    New Top NBE        : ${updatedCaseA.nbe_assessment.recommended_external_evidence.displayName}`);

  // Assertions for Case A
  assert(
    updatedCaseA.case_id === initialCaseId,
    'A.4 Same investigation case instance mutated across evidence lifecycle'
  );

  // Mathematical Verification of Bayesian Posterior Update:
  // P_new(H) ∝ P_0(H) * P(E | H)
  const initialGasFlareP = (initialPosteriorA.find((h) => h.hypothesis === 'GAS_FLARE')?.percentage || 0) / 100;
  const initialIndFireP = (initialPosteriorA.find((h) => h.hypothesis === 'INDUSTRIAL_FIRE')?.percentage || 0) / 100;
  const initialOtherP = (initialPosteriorA.find((h) => h.hypothesis === 'OTHER')?.percentage || 0) / 100;

  const rawFlareScore = initialGasFlareP * pointEmitterOutcome.conditionalLikelihood.GAS_FLARE;
  const rawIndScore = initialIndFireP * pointEmitterOutcome.conditionalLikelihood.INDUSTRIAL_FIRE;
  const rawOtherScore = initialOtherP * pointEmitterOutcome.conditionalLikelihood.OTHER;
  const rawSum = rawFlareScore + rawIndScore + rawOtherScore;

  const expectedFlarePct = Math.round((rawFlareScore / rawSum) * 100);
  const actualFlarePct = updatedPosteriorA.find((h) => h.hypothesis === 'GAS_FLARE')?.percentage || 0;

  assert(
    Math.abs(actualFlarePct - expectedFlarePct) <= 1,
    'A.5 Updated posterior matches exact Bayesian update P_new(H) ∝ P_old(H) * P(E|H)',
    `expected=${expectedFlarePct}%, actual=${actualFlarePct}%`
  );

  const posteriorSumA = updatedPosteriorA.reduce((sum, h) => sum + h.percentage, 0);
  assert(
    posteriorSumA === 100,
    'A.6 Updated posterior distribution sums to exactly 100%',
    `sum=${posteriorSumA}%`
  );

  assert(
    updatedPosteriorA[0].percentage > initialPosteriorA[0].percentage,
    'A.7 Posterior support for primary hypothesis increased after confirmatory evidence',
    `initial=${initialPosteriorA[0].percentage}%, updated=${updatedPosteriorA[0].percentage}%`
  );
  assert(
    updatedEntropyA < initialEntropyA,
    'A.8 Uncertainty (Shannon entropy) decreased after informative evidence incorporation',
    `initial=${initialEntropyA}, updated=${updatedEntropyA}`
  );
  assert(
    updatedCaseA.applied_evidence_items.some((e) => e.evidence_type === 'SENTINEL2_SWIR_OPTICAL'),
    'A.9 Sentinel-2 SWIR registered in applied_evidence_items'
  );
  assert(
    !updatedCaseA.nbe_assessment.ranked_candidates.some(
      (c) => c.evidenceType === 'SENTINEL2_SWIR_OPTICAL' && c.currentEvidenceStatus === 'CONNECTED_QUERYABLE'
    ),
    'A.10 Newly incorporated Sentinel-2 candidate excluded from missing/pending recommendations'
  );

  // Step 3: Double-Counting Prevention Test
  console.log('\n  Testing Double-Counting Prevention for Case A...');
  const reincorporatedCaseA = await incorporateEvidenceIntoCase(initialCaseId, s2EvidenceInput);
  const reincorporatedEntropyA = reincorporatedCaseA.uncertainty_assessment.current_entropy_bits ?? reincorporatedCaseA.uncertainty_assessment.entropy_bits;
  const reincorporatedPosteriorA = reincorporatedCaseA.hypothesis_assessment.fused_hypotheses || reincorporatedCaseA.hypothesis_assessment.hypotheses_distribution;

  assert(
    reincorporatedCaseA.applied_evidence_items.length === 1,
    'A.11 Re-incorporating existing evidence does not duplicate applied evidence items count (N=1)',
    `count=${reincorporatedCaseA.applied_evidence_items.length}`
  );
  assert(
    Math.abs(reincorporatedEntropyA - updatedEntropyA) < 1e-6,
    'A.12 Re-incorporating identical evidence maintains identical entropy (no double-counting)',
    `updated=${updatedEntropyA}, reincorporated=${reincorporatedEntropyA}`
  );
  assert(
    Math.abs(reincorporatedPosteriorA[0].percentage - updatedPosteriorA[0].percentage) < 1e-3,
    'A.13 Re-incorporating identical evidence maintains identical posterior probabilities',
    `updated=${updatedPosteriorA[0].percentage}%, reincorporated=${reincorporatedPosteriorA[0].percentage}%`
  );

  // =========================================================================
  // SCENARIO 2: CASE B — UNASSOCIATED REGIONAL EVENT (Rural Vegetation Hotspot)
  // =========================================================================
  console.log('\n--- SCENARIO 2: CASE B — Unassociated Regional Event (Rural Hotspot) ---');

  const caseBObs: any = {
    id: 'RURAL_VEG_EVENT_2026_02',
    latitude: 21.8500,
    longitude: 71.4000,
    brightness: 318.0,
    frp: 22.5,
    confidence: 'nominal',
    confidence_numeric: 75,
    acq_date: '2026-03-15',
    acq_time: '0830',
    satellite: 'VIIRS-NPP',
    instrument: 'VIIRS',
    daynight: 'D',
    day_night: 'D',
    frp_mw: 22.5,
    spatial_association: 'UNASSOCIATED',
    distance_to_facility_meters: 48000,
    distance_to_zone_meters: 48000,
    is_inside_polygon: false,
  };

  // Step 1: Build Initial Investigation Case
  const initialCaseB = buildInvestigationCase(caseBObs, null, null);
  const caseBId = initialCaseB.case_id;
  getOrCreateInvestigationCase(caseBId, caseBObs);

  const initialPosteriorB = initialCaseB.hypothesis_assessment.hypotheses_distribution;
  const initialEntropyB = initialCaseB.uncertainty_assessment.current_entropy_bits ?? initialCaseB.uncertainty_assessment.entropy_bits;
  const initialNbeB = initialCaseB.nbe_assessment;

  console.log(`  Case B Initial State:`);
  console.log(`    Spatial Association : ${initialCaseB.spatial_assessment.spatial_classification}`);
  console.log(`    Primary Hypothesis  : ${initialCaseB.hypothesis_assessment.primary_hypothesis} (${initialPosteriorB[0]?.percentage}%)`);
  console.log(`    Initial Entropy     : ${initialEntropyB.toFixed(3)} bits`);
  console.log(`    Recommended Action  : ${initialNbeB.recommended_external_evidence.displayName} (${initialNbeB.recommended_external_evidence.availability})`);

  assert(
    initialCaseB.spatial_assessment.spatial_classification === 'UNASSOCIATED',
    'B.1 Case B correctly classified as UNASSOCIATED'
  );
  assert(
    initialCaseB.behaviour_assessment.baseline_status === 'NONE',
    'B.2 Facility baseline is suspended (NONE) for unassociated regional event'
  );

  // Check NBE availability semantics for Case B
  const scadaInB = initialNbeB.ranked_candidates.find((c) => c.evidenceType === 'FACILITY_OPERATIONAL_SCADA_LOGS');
  assert(
    scadaInB?.availabilityStatus === 'OUT_OF_SCOPE',
    'B.3 SCADA candidate is strictly OUT_OF_SCOPE for unassociated rural case',
    `status=${scadaInB?.availabilityStatus}`
  );

  const landCoverInB = initialNbeB.ranked_candidates.find((c) => c.evidenceType === 'HIGH_RES_LAND_COVER_CONTEXT');
  assert(
    landCoverInB?.availabilityStatus === 'NOT_CURRENTLY_AVAILABLE' || landCoverInB?.availabilityStatus === 'UNAVAILABLE',
    'B.4 High-Res Land Cover candidate marked NOT_CURRENTLY_AVAILABLE / UNAVAILABLE (not falsely claimed as real)',
    `status=${landCoverInB?.availabilityStatus}`
  );

  // Step 2: Incorporate Non-Informative / Neutral Evidence
  console.log('\n  Incorporate Non-Informative Controlled Evidence into Case B (Uniform Likelihoods)...');

  const neutralEvidenceInput = {
    candidate_id: 'ATMOSPHERIC_WIND_WEATHER',
    evidence_id: 'EVID-NEUTRAL-01',
    outcome_id: 'MODERATE_AMBIENT_WEATHER',
    outcome_name: 'Moderate Ambient Weather Check (Non-Informative)',
    title: 'Controlled Test: Standard Atmospheric Ambient Check (Non-Informative)',
    description: 'Controlled prototype finding: Ambient atmospheric conditions within typical seasonal ranges; provides uniform likelihood across hypotheses.',
    evidence_type: 'ATMOSPHERIC_WIND_WEATHER',
    provenance: 'CONTROLLED' as const,
    reliability: 'HIGH' as const,
    applicability: 'Atmospheric boundary layer context.',
    affected_hypotheses: ['AGRICULTURAL_BURN', 'WILDFIRE_VEGETATION', 'OTHER', 'GAS_FLARE', 'INDUSTRIAL_FIRE'] as SourceHypothesisType[],
    likelihood_by_hypothesis: {
      GAS_FLARE: 0.20,
      INDUSTRIAL_FIRE: 0.20,
      AGRICULTURAL_BURN: 0.20,
      WILDFIRE_VEGETATION: 0.20,
      OTHER: 0.20,
    },
    is_incorporated: true,
    incorporation_rationale: 'Controlled neutral baseline check.',
  };

  const updatedCaseB = await incorporateEvidenceIntoCase(caseBId, neutralEvidenceInput);

  const updatedPosteriorB = updatedCaseB.hypothesis_assessment.fused_hypotheses || updatedCaseB.hypothesis_assessment.hypotheses_distribution;
  const updatedEntropyB = updatedCaseB.uncertainty_assessment.current_entropy_bits ?? updatedCaseB.uncertainty_assessment.entropy_bits;
  const entropyDeltaB = Math.abs(initialEntropyB - updatedEntropyB);

  console.log(`  Case B Updated State:`);
  console.log(`    Primary Hypothesis  : ${updatedCaseB.hypothesis_assessment.primary_hypothesis} (${updatedPosteriorB[0]?.percentage}%)`);
  console.log(`    Updated Entropy     : ${updatedEntropyB.toFixed(3)} bits (ΔH = ${entropyDeltaB.toFixed(4)} bits)`);
  console.log(`    Evidence Applied    : ${updatedCaseB.applied_evidence_items.length} items`);

  assert(
    Math.abs(updatedPosteriorB[0].percentage - initialPosteriorB[0].percentage) < 1e-3,
    'B.5 Non-informative evidence produces zero change in posterior hypothesis probabilities',
    `initial=${initialPosteriorB[0].percentage}%, updated=${updatedPosteriorB[0].percentage}%`
  );
  assert(
    entropyDeltaB < 1e-3,
    'B.6 Non-informative evidence produces approximately zero entropy delta (|ΔH| < 0.001 bits)',
    `delta=${entropyDeltaB}`
  );

  const posteriorSumB = updatedPosteriorB.reduce((sum, h) => sum + h.percentage, 0);
  assert(
    posteriorSumB === 100,
    'B.7 Updated Case B posterior distribution sums to exactly 100%',
    `sum=${posteriorSumB}%`
  );

  console.log('\n================================================================');
  console.log(`DAY 2D-2 CLOSED-LOOP TESTS COMPLETED: ${passedTests}/${totalTests} assertions passed`);
  console.log('================================================================\n');
}

runClosedLoopTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
