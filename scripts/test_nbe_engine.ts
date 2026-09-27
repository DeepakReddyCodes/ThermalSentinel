// ============================================================================
// ThermalSentinel — Section 8 Test Suite: Next-Best-Evidence & Expected Information Gain (EIG)
//
// Tests:
// 1. Low-entropy case (concentrated distribution → low EIG across candidates)
// 2. High-entropy case (ambiguous distribution → high EIG for discriminative sources)
// 3. Flare vs Industrial-Fire case → Sentinel-2 SWIR / Nightfire prioritized
// 4. Agricultural vs Wildfire case → High-Resolution Land Cover prioritized
// 5. Unavailable evidence handling (proper UNAVAILABLE status, zero false claims)
// 6. Temporally distant Sentinel-2 handling (FORENSIC_CONTEXT, overpass tasking recommended)
// 7. Real event-adjacent Sentinel-2 handling (EVENT_ADJACENT, full weight)
// 8. Distinct candidates receiving mathematically distinct EIG values
// 9. Deterministic ranking & reproducible calculations
// 10. No-fabrication behavior (SCADA marked CONTROLLED/future prototype, not claimed connected)
// 11. Mathematical invariants: EIG >= 0 within floating point tolerance, expected posterior entropy <= H_current
// ============================================================================

import {
  calculateExpectedInformationGain,
  evaluateTargetAmbiguity,
  evaluateTemporalSuitability,
  evaluateRealNextBestEvidence,
  CANDIDATE_OUTCOME_MODELS,
} from '../server/nbeEngine.js';
import { calculateExactShannonEntropy } from '../server/evidenceFusionEngine.js';
import { buildInvestigationCase } from '../server/investigationEngine.js';
import { SourceHypothesisType, ContextualHypothesisItem } from '../server/types.js';

let passedAssertions = 0;
let failedAssertions = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passedAssertions++;
    console.log(`  ✓ PASS: ${message}`);
  } else {
    failedAssertions++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

console.log('==============================================================================');
console.log('THERMALSENTINEL — SECTION 8 NEXT-BEST-EVIDENCE & EIG TEST SUITE');
console.log('==============================================================================\n');

// ----------------------------------------------------------------------------
// SUITE 1: Low-Entropy Case (Concentrated Distribution → Low EIG)
// ----------------------------------------------------------------------------
console.log('[SUITE 1: Low-Entropy Distribution → Low EIG]');
const lowEntropyDist: Array<{ hypothesis: SourceHypothesisType; percentage: number }> = [
  { hypothesis: 'GAS_FLARE', percentage: 92 },
  { hypothesis: 'INDUSTRIAL_FIRE', percentage: 4 },
  { hypothesis: 'OTHER', percentage: 2 },
  { hypothesis: 'AGRICULTURAL_BURN', percentage: 1 },
  { hypothesis: 'WILDFIRE_VEGETATION', percentage: 1 },
];

const lowEntropyEval = calculateExactShannonEntropy(lowEntropyDist);
const s2LowEig = calculateExpectedInformationGain(lowEntropyDist, CANDIDATE_OUTCOME_MODELS.SENTINEL2_SWIR_OPTICAL);

assert(
  lowEntropyEval.entropy_bits < 0.60,
  `Low-entropy distribution has concentrated entropy (H = ${lowEntropyEval.entropy_bits} bits < 0.60)`
);
assert(
  s2LowEig.expected_information_gain_bits <= 0.25,
  `Low-entropy prior results in low EIG (EIG = ${s2LowEig.expected_information_gain_bits} bits <= 0.25)`
);
assert(
  s2LowEig.expected_posterior_entropy_bits <= lowEntropyEval.entropy_bits + 1e-4,
  `Expected posterior entropy (${s2LowEig.expected_posterior_entropy_bits}) <= current entropy (${lowEntropyEval.entropy_bits})`
);

// ----------------------------------------------------------------------------
// SUITE 2: High-Entropy Case (Competing Hypotheses → High EIG)
// ----------------------------------------------------------------------------
console.log('\n[SUITE 2: High-Entropy Distribution → High EIG for Discriminative Evidence]');
const highEntropyDist: Array<{ hypothesis: SourceHypothesisType; percentage: number }> = [
  { hypothesis: 'GAS_FLARE', percentage: 35 },
  { hypothesis: 'INDUSTRIAL_FIRE', percentage: 35 },
  { hypothesis: 'OTHER', percentage: 10 },
  { hypothesis: 'AGRICULTURAL_BURN', percentage: 10 },
  { hypothesis: 'WILDFIRE_VEGETATION', percentage: 10 },
];

const highEntropyEval = calculateExactShannonEntropy(highEntropyDist);
const s2HighEig = calculateExpectedInformationGain(highEntropyDist, CANDIDATE_OUTCOME_MODELS.SENTINEL2_SWIR_OPTICAL);

assert(
  highEntropyEval.entropy_bits >= 1.80,
  `High-entropy distribution has high uncertainty (H = ${highEntropyEval.entropy_bits} bits >= 1.80)`
);
assert(
  s2HighEig.expected_information_gain_bits >= 0.40,
  `Discriminative candidate yields high EIG under high entropy (EIG = ${s2HighEig.expected_information_gain_bits} bits >= 0.40)`
);
assert(
  s2HighEig.expected_information_gain_bits > s2LowEig.expected_information_gain_bits,
  `High-entropy EIG (${s2HighEig.expected_information_gain_bits}) strictly exceeds low-entropy EIG (${s2LowEig.expected_information_gain_bits})`
);

// ----------------------------------------------------------------------------
// SUITE 3: Flare vs Industrial-Fire Case (Sentinel-2 SWIR / Nightfire Prioritized)
// ----------------------------------------------------------------------------
console.log('\n[SUITE 3: Flare vs Industrial-Fire Competition]');
const flareFireCase = buildInvestigationCase({
  id: 'FIRMS-ANOMALOUS-FLARE-01',
  latitude: 22.3385,
  longitude: 69.8608,
  frp: 14.5, // Anomalous excursion
  day_night: 'N',
  acquisition_time: '2026-04-22T21:30:00Z',
});

const flareFireAmbiguity = evaluateTargetAmbiguity(
  flareFireCase.hypothesis_assessment.candidate_hypotheses.map((h) => ({
    hypothesis: h.hypothesis,
    percentage: h.percentage,
    label: h.label,
  }))
);

assert(
  flareFireAmbiguity.targetPair.includes('Industrial') || flareFireAmbiguity.targetPair.includes('Flare'),
  `Target ambiguity correctly identifies industrial competition: "${flareFireAmbiguity.targetPair}"`
);

const flareFireTopExt = flareFireCase.nbe_assessment.recommended_external_evidence;
assert(
  flareFireTopExt.recommendedCandidate?.evidenceType === 'SENTINEL2_SWIR_OPTICAL' ||
  flareFireTopExt.recommendedCandidate?.evidenceType === 'VIIRS_NIGHTFIRE_COMBUSTION',
  `Top recommended external candidate is Sentinel-2 SWIR or VIIRS Nightfire (actual: ${flareFireTopExt.recommendedCandidate?.evidenceType})`
);
assert(
  (flareFireTopExt.utility_score ?? 0) >= 70,
  `Utility score is elevated for industrial resolution (Score: ${flareFireTopExt.utility_score}/100)`
);

// ----------------------------------------------------------------------------
// SUITE 4: Agricultural vs Wildfire Case (High-Res Land Cover Prioritized)
// ----------------------------------------------------------------------------
console.log('\n[SUITE 4: Agricultural vs Wildfire Competition]');
const ruralCase = buildInvestigationCase({
  id: 'FIRMS-RURAL-HARVEST-01',
  latitude: 20.8765,
  longitude: 70.4321,
  frp: 7.2,
  day_night: 'D',
  acquisition_time: '2026-04-22T08:30:00Z',
});

const ruralAmbiguity = evaluateTargetAmbiguity(
  ruralCase.hypothesis_assessment.candidate_hypotheses.map((h) => ({
    hypothesis: h.hypothesis,
    percentage: h.percentage,
    label: h.label,
  }))
);

assert(
  ruralAmbiguity.targetPair.includes('Agricultural') || ruralAmbiguity.targetPair.includes('Wildland') || ruralAmbiguity.targetPair.includes('Burn'),
  `Target ambiguity identifies rural competition: "${ruralAmbiguity.targetPair}"`
);

const ruralTopExt = ruralCase.nbe_assessment.recommended_external_evidence;
assert(
  ruralTopExt.recommendedCandidate?.evidenceType === 'HIGH_RES_LAND_COVER_CONTEXT',
  `Top recommended external candidate for unassociated rural detection is High-Resolution Land Cover (actual: ${ruralTopExt.recommendedCandidate?.evidenceType})`
);
assert(
  ruralTopExt.recommendedCandidate?.targetHypothesisPairs.some((p) => p.includes('Agricultural') || p.includes('Wildfire')) ?? false,
  'Target hypothesis pair explicitly mentions Agricultural vs Wildfire discrimination'
);

// ----------------------------------------------------------------------------
// SUITE 5: Unavailable Evidence Handling (Proper Status & Zero False Claims)
// ----------------------------------------------------------------------------
console.log('\n[SUITE 5: Unavailable Evidence Status Integrity]');
const missingEvidenceList = flareFireCase.evidence_assessment.missing_evidence;
for (const cand of missingEvidenceList) {
  assert(
    cand.availabilityStatus === 'NOT_CURRENTLY_AVAILABLE',
    `${cand.displayName} availability is strictly NOT_CURRENTLY_AVAILABLE`
  );
  assert(
    cand.currentEvidenceStatus === 'NOT_CONNECTED' || cand.currentEvidenceStatus === 'UNAVAILABLE_PENDING_OVERPASS',
    `${cand.displayName} status is ${cand.currentEvidenceStatus} (no false claim of connection)`
  );
}

// ----------------------------------------------------------------------------
// SUITE 6: Temporally Distant Sentinel-2 Handling (FORENSIC_CONTEXT)
// ----------------------------------------------------------------------------
console.log('\n[SUITE 6: Temporally Distant Sentinel-2 Scene]');
const distantS2Suitability = evaluateTemporalSuitability({
  candidateType: 'SENTINEL2_SWIR_OPTICAL',
  eventTimestamp: '2026-04-22T21:30:00Z',
  sceneTimestamp: '2024-12-15T05:40:00Z', // 493 days prior
});

assert(
  distantS2Suitability.status === 'FORENSIC_CONTEXT',
  `Archival scene is classified as FORENSIC_CONTEXT (status: ${distantS2Suitability.status})`
);
assert(
  (distantS2Suitability.temporalOffsetHours ?? 0) > 24,
  `Temporal offset is substantial (${distantS2Suitability.temporalOffsetHours?.toFixed(1)} hours > 24)`
);
assert(
  distantS2Suitability.suitabilityMultiplier === 0.70,
  'Suitability multiplier scales down archival scene (factor: 0.70)'
);

// ----------------------------------------------------------------------------
// SUITE 7: Event-Adjacent Sentinel-2 Handling (EVENT_ADJACENT)
// ----------------------------------------------------------------------------
console.log('\n[SUITE 7: Event-Adjacent Contemporaneous Sentinel-2 Scene]');
const adjacentS2Suitability = evaluateTemporalSuitability({
  candidateType: 'SENTINEL2_SWIR_OPTICAL',
  eventTimestamp: '2026-04-22T21:30:00Z',
  sceneTimestamp: '2026-04-22T19:00:00Z', // 2.5 hours prior
  cloudCoverPct: 5,
});

assert(
  adjacentS2Suitability.status === 'EVENT_ADJACENT',
  `Contemporaneous scene is classified as EVENT_ADJACENT (status: ${adjacentS2Suitability.status})`
);
assert(
  (adjacentS2Suitability.temporalOffsetHours ?? 0) <= 24,
  `Temporal offset is within 24h (${adjacentS2Suitability.temporalOffsetHours?.toFixed(1)} hours)`
);
assert(
  adjacentS2Suitability.suitabilityMultiplier === 1.0,
  'Suitability multiplier is 1.0 (100% full weight for event-adjacent imagery)'
);

// ----------------------------------------------------------------------------
// SUITE 8: Distinct Candidates Receive Distinct EIG Values
// ----------------------------------------------------------------------------
console.log('\n[SUITE 8: Candidate Discrimination & Distinct EIG Values]');
const testPrior: Array<{ hypothesis: SourceHypothesisType; percentage: number }> = [
  { hypothesis: 'GAS_FLARE', percentage: 40 },
  { hypothesis: 'INDUSTRIAL_FIRE', percentage: 35 },
  { hypothesis: 'AGRICULTURAL_BURN', percentage: 10 },
  { hypothesis: 'WILDFIRE_VEGETATION', percentage: 5 },
  { hypothesis: 'OTHER', percentage: 10 },
];

const s2Eig = calculateExpectedInformationGain(testPrior, CANDIDATE_OUTCOME_MODELS.SENTINEL2_SWIR_OPTICAL);
const lcEig = calculateExpectedInformationGain(testPrior, CANDIDATE_OUTCOME_MODELS.HIGH_RES_LAND_COVER_CONTEXT);
const osmEig = calculateExpectedInformationGain(testPrior, CANDIDATE_OUTCOME_MODELS.OPENSTREETMAP_INFRASTRUCTURE_CONTEXT);
const weatherEig = calculateExpectedInformationGain(testPrior, CANDIDATE_OUTCOME_MODELS.ATMOSPHERIC_WIND_WEATHER);

assert(
  s2Eig.expected_information_gain_bits !== lcEig.expected_information_gain_bits,
  `Sentinel-2 EIG (${s2Eig.expected_information_gain_bits} bits) != Land Cover EIG (${lcEig.expected_information_gain_bits} bits)`
);
assert(
  osmEig.expected_information_gain_bits !== weatherEig.expected_information_gain_bits,
  `OSM EIG (${osmEig.expected_information_gain_bits} bits) != Weather EIG (${weatherEig.expected_information_gain_bits} bits)`
);
assert(
  s2Eig.outcomes.length === 4,
  `Sentinel-2 outcome model defines 4 inspectable outcomes (actual: ${s2Eig.outcomes.length})`
);
assert(
  lcEig.outcomes.length === 4,
  `Land Cover outcome model defines 4 inspectable outcomes (actual: ${lcEig.outcomes.length})`
);

// ----------------------------------------------------------------------------
// SUITE 9: Deterministic Ranking & Reproducibility
// ----------------------------------------------------------------------------
console.log('\n[SUITE 9: Deterministic Execution & Ranking Reproducibility]');
const run1 = calculateExpectedInformationGain(testPrior, CANDIDATE_OUTCOME_MODELS.SENTINEL2_SWIR_OPTICAL);
const run2 = calculateExpectedInformationGain(testPrior, CANDIDATE_OUTCOME_MODELS.SENTINEL2_SWIR_OPTICAL);

assert(
  run1.expected_information_gain_bits === run2.expected_information_gain_bits,
  `Deterministic EIG: Run 1 (${run1.expected_information_gain_bits}) === Run 2 (${run2.expected_information_gain_bits})`
);
assert(
  run1.expected_posterior_entropy_bits === run2.expected_posterior_entropy_bits,
  `Deterministic expected posterior entropy: Run 1 (${run1.expected_posterior_entropy_bits}) === Run 2 (${run2.expected_posterior_entropy_bits})`
);

// ----------------------------------------------------------------------------
// SUITE 10: SCADA Provenance & Zero-Fabrication Safeguard
// ----------------------------------------------------------------------------
console.log('\n[SUITE 10: SCADA Provenance & Zero-Fabrication Safeguards]');
const scadaModel = CANDIDATE_OUTCOME_MODELS.FACILITY_OPERATIONAL_SCADA_LOGS;
assert(
  scadaModel.provenance === 'CONTROLLED',
  `SCADA model provenance is strictly CONTROLLED (actual: ${scadaModel.provenance})`
);
assert(
  scadaModel.acquisitionCostEffort === 'HIGH_RESTRICTED',
  `SCADA acquisition cost is HIGH_RESTRICTED (cost multiplier: ${scadaModel.costMultiplier})`
);

const scadaEig = calculateExpectedInformationGain(testPrior, scadaModel);
assert(
  scadaEig.information_model_name.includes('PROTOTYPE_INFORMATION_MODEL'),
  `Information model explicitly documented as PROTOTYPE_INFORMATION_MODEL ("${scadaEig.information_model_name}")`
);

// ----------------------------------------------------------------------------
// SUITE 11: Mathematical Invariants Verification
// ----------------------------------------------------------------------------
console.log('\n[SUITE 11: Mathematical Invariants Verification]');
const testDistributions: Array<Array<{ hypothesis: SourceHypothesisType; percentage: number }>> = [
  // 1. Concentrated single hypothesis
  [{ hypothesis: 'GAS_FLARE', percentage: 90 }, { hypothesis: 'INDUSTRIAL_FIRE', percentage: 5 }, { hypothesis: 'OTHER', percentage: 5 }],
  // 2. 50/50 flare vs industrial fire
  [{ hypothesis: 'GAS_FLARE', percentage: 50 }, { hypothesis: 'INDUSTRIAL_FIRE', percentage: 50 }],
  // 3. 50/50 agricultural vs wildfire
  [{ hypothesis: 'AGRICULTURAL_BURN', percentage: 50 }, { hypothesis: 'WILDFIRE_VEGETATION', percentage: 50 }],
  // 4. Uniform 5-candidate distribution
  [
    { hypothesis: 'GAS_FLARE', percentage: 20 },
    { hypothesis: 'INDUSTRIAL_FIRE', percentage: 20 },
    { hypothesis: 'AGRICULTURAL_BURN', percentage: 20 },
    { hypothesis: 'WILDFIRE_VEGETATION', percentage: 20 },
    { hypothesis: 'OTHER', percentage: 20 },
  ],
  // 5. Asymmetric skew
  [
    { hypothesis: 'INDUSTRIAL_FIRE', percentage: 60 },
    { hypothesis: 'GAS_FLARE', percentage: 25 },
    { hypothesis: 'OTHER', percentage: 10 },
    { hypothesis: 'WILDFIRE_VEGETATION', percentage: 5 },
  ],
];

const candidatesToTest = [
  CANDIDATE_OUTCOME_MODELS.SENTINEL2_SWIR_OPTICAL,
  CANDIDATE_OUTCOME_MODELS.HIGH_RES_LAND_COVER_CONTEXT,
  CANDIDATE_OUTCOME_MODELS.VIIRS_NIGHTFIRE_COMBUSTION,
  CANDIDATE_OUTCOME_MODELS.MULTI_PASS_TEMPORAL_PERSISTENCE,
  CANDIDATE_OUTCOME_MODELS.OPENSTREETMAP_INFRASTRUCTURE_CONTEXT,
  CANDIDATE_OUTCOME_MODELS.ATMOSPHERIC_WIND_WEATHER,
];

let invariantCheckCount = 0;
for (const dist of testDistributions) {
  const currentH = calculateExactShannonEntropy(dist).entropy_bits;
  for (const cand of candidatesToTest) {
    const eigRes = calculateExpectedInformationGain(dist, cand);
    invariantCheckCount++;

    // Invariant 1: EIG >= 0
    assert(
      eigRes.expected_information_gain_bits >= 0,
      `[Invariant] ${cand.evidenceType} EIG >= 0 bits (actual: ${eigRes.expected_information_gain_bits})`
    );

    // Invariant 2: Expected Posterior Entropy <= Current Entropy
    assert(
      eigRes.expected_posterior_entropy_bits <= currentH + 1e-3,
      `[Invariant] ${cand.evidenceType} E[H] (${eigRes.expected_posterior_entropy_bits}) <= H_current (${currentH})`
    );

    // Invariant 3: Outcome probabilities sum to exactly 1.0 (100%)
    const outcomeProbSum = eigRes.outcomes.reduce((sum, o) => sum + o.outcome_probability, 0);
    assert(
      Math.abs(outcomeProbSum - 1.0) <= 0.01,
      `[Invariant] ${cand.evidenceType} outcome probabilities sum to 1.0 (actual: ${outcomeProbSum.toFixed(3)})`
    );
  }
}

console.log('\n==============================================================================');
console.log(`SECTION 8 TEST SUMMARY: ${passedAssertions} PASSED | ${failedAssertions} FAILED`);
console.log('==============================================================================\n');

if (failedAssertions > 0) {
  process.exit(1);
}
