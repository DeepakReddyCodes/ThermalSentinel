// ============================================================================
// ThermalSentinel — Section 7 Test Suite: Evidence Fusion & Uncertainty Engine
//
// Tests:
// A. Strong single-hypothesis case → low entropy
// B. Balanced competing hypotheses → high entropy (H = log2(5) ≈ 2.322 bits)
// C. ML/context agreement → no conflict
// D. ML/context disagreement → evidence conflict (structured representation)
// E. Adding evidence → current distribution updates deterministically
// F. Zero-information evidence → entropy remains unchanged (ΔH ≈ 0)
// G. Ambiguity-increasing evidence → entropy increases (ΔH < 0)
// H. Unassociated event → full 5-class distribution and entropy without facility baseline
// I. Flagship Jamnagar benchmark preservation
// J. Mathematical verification: sum(p) == 100% and H == exact Shannon entropy formula
// ============================================================================

import {
  calculateExactShannonEntropy,
  collectExplicitEvidenceItems,
  fuseEvidenceAndAssessUncertainty,
  detectStructuredEvidenceConflict,
  ALL_CANDIDATE_HYPOTHESES,
  ExplicitEvidenceItem,
} from '../server/evidenceFusionEngine.js';
import { ContextualHypothesisItem, HypothesisSupport, SourceHypothesisType } from '../server/types.js';
import { evaluateCanonicalHypotheses } from '../server/hypothesisEngine.js';
import { buildInvestigationCase } from '../server/investigationEngine.js';
import { evaluateThermalDiscriminator } from '../server/thermalDiscriminator.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ PASS: ${testName}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${testName}${detail ? ` — ${detail}` : ''}`);
  }
}

function runSection7Tests() {
  console.log('='.repeat(78));
  console.log('THERMALSENTINEL — SECTION 7 EVIDENCE FUSION & UNCERTAINTY TEST SUITE');
  console.log('='.repeat(78));

  // --------------------------------------------------------------------------
  // TEST A: Strong Single-Hypothesis Case (Low Entropy)
  // --------------------------------------------------------------------------
  console.log('\n[TEST A: Strong Single-Hypothesis Case (Low Entropy)]');
  const concentratedDistribution: HypothesisSupport[] = [
    { hypothesis: 'GAS_FLARE', percentage: 90, label: 'Gas Flare', support_level: 'VERY_HIGH', normalized_score: 0.90, reasons: [] },
    { hypothesis: 'INDUSTRIAL_FIRE', percentage: 4, label: 'Industrial Fire', support_level: 'LOW', normalized_score: 0.04, reasons: [] },
    { hypothesis: 'AGRICULTURAL_BURN', percentage: 2, label: 'Agricultural Burn', support_level: 'MINIMAL', normalized_score: 0.02, reasons: [] },
    { hypothesis: 'WILDFIRE_VEGETATION', percentage: 2, label: 'Wildfire', support_level: 'MINIMAL', normalized_score: 0.02, reasons: [] },
    { hypothesis: 'OTHER', percentage: 2, label: 'Other', support_level: 'MINIMAL', normalized_score: 0.02, reasons: [] },
  ];

  const lowEntropyResult = calculateExactShannonEntropy(concentratedDistribution);
  assert(lowEntropyResult.entropy_bits < 0.70, `Concentrated distribution yields low entropy (H = ${lowEntropyResult.entropy_bits} < 0.70 bits)`);
  assert(lowEntropyResult.uncertainty_level === 'LOW', 'Uncertainty level correctly classified as LOW');
  assert(lowEntropyResult.is_ambiguous === false, 'is_ambiguous is false for low uncertainty');
  assert(lowEntropyResult.normalized_entropy < 0.35, `Normalized entropy is low (H_norm = ${lowEntropyResult.normalized_entropy})`);

  // Edge case: 100% single hypothesis -> H = 0.000 bits
  const singleHypoDistribution: HypothesisSupport[] = [
    { hypothesis: 'GAS_FLARE', percentage: 100, label: 'Gas Flare', support_level: 'VERY_HIGH', normalized_score: 1.0, reasons: [] },
  ];
  const zeroEntropyResult = calculateExactShannonEntropy(singleHypoDistribution);
  assert(zeroEntropyResult.entropy_bits === 0, `100% single candidate produces exact H = 0.000 bits (actual: ${zeroEntropyResult.entropy_bits})`);

  // --------------------------------------------------------------------------
  // TEST B: Balanced Competing Hypotheses (High Entropy)
  // --------------------------------------------------------------------------
  console.log('\n[TEST B: Balanced Competing Hypotheses (High Entropy)]');
  const uniformDistribution: HypothesisSupport[] = [
    { hypothesis: 'GAS_FLARE', percentage: 20, label: 'Gas Flare', support_level: 'MODERATE', normalized_score: 0.20, reasons: [] },
    { hypothesis: 'INDUSTRIAL_FIRE', percentage: 20, label: 'Industrial Fire', support_level: 'MODERATE', normalized_score: 0.20, reasons: [] },
    { hypothesis: 'AGRICULTURAL_BURN', percentage: 20, label: 'Agricultural Burn', support_level: 'MODERATE', normalized_score: 0.20, reasons: [] },
    { hypothesis: 'WILDFIRE_VEGETATION', percentage: 20, label: 'Wildfire', support_level: 'MODERATE', normalized_score: 0.20, reasons: [] },
    { hypothesis: 'OTHER', percentage: 20, label: 'Other', support_level: 'MODERATE', normalized_score: 0.20, reasons: [] },
  ];

  const maxEntropyResult = calculateExactShannonEntropy(uniformDistribution);
  assert(
    Math.abs(maxEntropyResult.entropy_bits - 2.322) < 0.01,
    `Uniform 5-candidate distribution yields maximum Shannon entropy log2(5) ≈ 2.322 bits (actual: ${maxEntropyResult.entropy_bits})`
  );
  assert(
    Math.abs(maxEntropyResult.normalized_entropy - 1.0) < 0.01,
    `Normalized entropy is 1.0 (100%) for uniform distribution (actual: ${maxEntropyResult.normalized_entropy})`
  );
  assert(maxEntropyResult.uncertainty_level === 'HIGH', 'Uncertainty level is HIGH for balanced competition');
  assert(maxEntropyResult.is_ambiguous === true, 'is_ambiguous is true for balanced competition');

  // --------------------------------------------------------------------------
  // TEST C: ML / Context Agreement (No Conflict)
  // --------------------------------------------------------------------------
  console.log('\n[TEST C: ML / Context Agreement (No Conflict)]');
  const flareContextualDistribution: HypothesisSupport[] = [
    { hypothesis: 'GAS_FLARE', percentage: 75, label: 'Gas Flare', support_level: 'VERY_HIGH', normalized_score: 0.75, reasons: [] },
    { hypothesis: 'INDUSTRIAL_FIRE', percentage: 12, label: 'Industrial Fire', support_level: 'LOW', normalized_score: 0.12, reasons: [] },
    { hypothesis: 'OTHER', percentage: 8, label: 'Other', support_level: 'MINIMAL', normalized_score: 0.08, reasons: [] },
    { hypothesis: 'AGRICULTURAL_BURN', percentage: 3, label: 'Agricultural Burn', support_level: 'MINIMAL', normalized_score: 0.03, reasons: [] },
    { hypothesis: 'WILDFIRE_VEGETATION', percentage: 2, label: 'Wildfire', support_level: 'MINIMAL', normalized_score: 0.02, reasons: [] },
  ];

  const agreeingMlDiscriminator = {
    status: 'AVAILABLE' as const,
    model_id: 'lr-v5f3-standardized',
    model_version: '1.0.0',
    evaluation_level: 'OBSERVATION' as const,
    task: 'GAS_FLARE_VS_WILDFIRE_CONFIRMED' as const,
    supported_classes: ['GAS_FLARE', 'WILDFIRE_CONFIRMED'] as ['GAS_FLARE', 'WILDFIRE_CONFIRMED'],
    predicted_class: 'GAS_FLARE' as const,
    predicted_label: 'Gas Flare',
    wildfire_score: 0.15,
    flare_score: 0.85,
    decision_threshold: 0.50,
    threshold_status: 'EXPERIMENTAL_UNVALIDATED' as const,
    coverage_status: 'FULL_COVERAGE' as const,
    interpretation: 'Flare-side agreement.',
    evidence_basis: [],
    limitations: [],
    timestamp: new Date().toISOString(),
  };

  const agreeConflict = detectStructuredEvidenceConflict(flareContextualDistribution, agreeingMlDiscriminator);
  assert(agreeConflict.has_conflict === false, 'Directional agreement results in has_conflict: false');
  assert(agreeConflict.severity === 'NONE', 'Conflict severity is NONE');
  assert(agreeConflict.conflicting_sources.length === 0, 'Zero conflicting sources recorded');

  // --------------------------------------------------------------------------
  // TEST D: ML / Context Disagreement (Structured Evidence Conflict)
  // --------------------------------------------------------------------------
  console.log('\n[TEST D: ML / Context Disagreement (Structured Conflict)]');
  const industrialFireContextual: HypothesisSupport[] = [
    { hypothesis: 'INDUSTRIAL_FIRE', percentage: 68, label: 'Industrial Fire / Abnormal Heat', support_level: 'HIGH', normalized_score: 0.68, reasons: [] },
    { hypothesis: 'GAS_FLARE', percentage: 18, label: 'Gas Flare', support_level: 'LOW', normalized_score: 0.18, reasons: [] },
    { hypothesis: 'OTHER', percentage: 8, label: 'Other', support_level: 'MINIMAL', normalized_score: 0.08, reasons: [] },
    { hypothesis: 'AGRICULTURAL_BURN', percentage: 4, label: 'Agricultural Burn', support_level: 'MINIMAL', normalized_score: 0.04, reasons: [] },
    { hypothesis: 'WILDFIRE_VEGETATION', percentage: 2, label: 'Wildfire', support_level: 'MINIMAL', normalized_score: 0.02, reasons: [] },
  ];

  const disagreeingMlDiscriminator = {
    status: 'AVAILABLE' as const,
    model_id: 'lr-v5f3-standardized',
    model_version: '1.0.0',
    evaluation_level: 'OBSERVATION' as const,
    task: 'GAS_FLARE_VS_WILDFIRE_CONFIRMED' as const,
    supported_classes: ['GAS_FLARE', 'WILDFIRE_CONFIRMED'] as ['GAS_FLARE', 'WILDFIRE_CONFIRMED'],
    predicted_class: 'WILDFIRE_CONFIRMED' as const,
    predicted_label: 'Wildfire-side signal',
    wildfire_score: 0.92,
    flare_score: 0.08,
    decision_threshold: 0.50,
    threshold_status: 'EXPERIMENTAL_UNVALIDATED' as const,
    coverage_status: 'FULL_COVERAGE' as const,
    interpretation: 'High contrast daytime detection.',
    evidence_basis: [],
    limitations: [],
    timestamp: new Date().toISOString(),
  };

  const structuredConflict = detectStructuredEvidenceConflict(industrialFireContextual, disagreeingMlDiscriminator);
  assert(structuredConflict.has_conflict === true, 'Disagreement triggers structured evidence conflict');
  assert(structuredConflict.severity === 'HIGH', 'Severity is HIGH for facility industrial fire vs ML wildfire divergence');
  assert(structuredConflict.conflicting_sources.length >= 2, 'Conflicting sources identified (Contextual, Behaviour, ML)');
  assert(structuredConflict.hypotheses_involved.includes('INDUSTRIAL_FIRE'), 'Hypotheses involved includes INDUSTRIAL_FIRE');
  assert(structuredConflict.hypotheses_involved.includes('WILDFIRE_VEGETATION'), 'Hypotheses involved includes WILDFIRE_VEGETATION');
  assert(structuredConflict.reason.includes('binary training scope'), 'Conflict explanation clarifies ML binary training scope');
  assert(structuredConflict.resolution_requirement.includes('Next-Best-Evidence'), 'Conflict defines resolution requirement');

  // --------------------------------------------------------------------------
  // TEST E: Adding Evidence Updates Distribution Deterministically
  // --------------------------------------------------------------------------
  console.log('\n[TEST E: Adding Evidence Updates Distribution Deterministically]');
  const initialDist: HypothesisSupport[] = [
    { hypothesis: 'INDUSTRIAL_FIRE', percentage: 40, label: 'Industrial Fire', support_level: 'MODERATE', normalized_score: 0.40, reasons: [] },
    { hypothesis: 'GAS_FLARE', percentage: 35, label: 'Gas Flare', support_level: 'MODERATE', normalized_score: 0.35, reasons: [] },
    { hypothesis: 'OTHER', percentage: 15, label: 'Other', support_level: 'LOW', normalized_score: 0.15, reasons: [] },
    { hypothesis: 'AGRICULTURAL_BURN', percentage: 5, label: 'Agricultural Burn', support_level: 'MINIMAL', normalized_score: 0.05, reasons: [] },
    { hypothesis: 'WILDFIRE_VEGETATION', percentage: 5, label: 'Wildfire', support_level: 'MINIMAL', normalized_score: 0.05, reasons: [] },
  ];

  // Optical SWIR evidence confirming uncontained ground fire
  const opticalEvidence: ExplicitEvidenceItem = {
    evidence_id: 'EVID-S2-UNCONTAINED-SPREAD',
    source: 'SENTINEL_HUB_S2_L2A',
    evidence_type: 'OPTICAL_SWIR_INSPECTION',
    title: 'Sentinel-2 SWIR: Uncontained Ground Spread Confirmed',
    description: 'Ground-level diffuse combustion detected outside flare stack stack zone.',
    value: { uncontained_spread: true },
    timestamp: new Date().toISOString(),
    provenance: 'REAL',
    reliability: 'HIGH',
    applicability: 'Resolves flare vs structural fire.',
    affected_hypotheses: ['INDUSTRIAL_FIRE', 'GAS_FLARE'],
    direction_of_influence: {
      INDUSTRIAL_FIRE: 'INCREASES_SUPPORT',
      GAS_FLARE: 'DECREASES_SUPPORT',
      AGRICULTURAL_BURN: 'NEUTRAL',
      WILDFIRE_VEGETATION: 'NEUTRAL',
      OTHER: 'NEUTRAL',
    },
    strength_of_influence: {
      INDUSTRIAL_FIRE: 40,
      GAS_FLARE: -30,
      AGRICULTURAL_BURN: 0,
      WILDFIRE_VEGETATION: 0,
      OTHER: -10,
    },
    is_incorporated: true,
  };

  const fusedWithOptical = fuseEvidenceAndAssessUncertainty({
    initialDistribution: initialDist,
    evidenceItems: [opticalEvidence],
  });

  const industrialFireFused = fusedWithOptical.fused_hypotheses.find((h) => h.hypothesis === 'INDUSTRIAL_FIRE')!;
  const flareFused = fusedWithOptical.fused_hypotheses.find((h) => h.hypothesis === 'GAS_FLARE')!;

  assert(industrialFireFused.percentage > 40, `Industrial fire support increased after confirmatory evidence (${industrialFireFused.percentage}% > 40%)`);
  assert(flareFused.percentage < 35, `Gas flare support decreased after uncontained spread confirmed (${flareFused.percentage}% < 35%)`);
  assert(fusedWithOptical.initial_vs_current.entropy_delta_bits > 0, `Uncertainty decreased (ΔH = ${fusedWithOptical.initial_vs_current.entropy_delta_bits} bits > 0)`);
  assert(fusedWithOptical.initial_vs_current.uncertainty_status === 'UNCERTAINTY_REDUCED', 'Uncertainty status is UNCERTAINTY_REDUCED');

  // --------------------------------------------------------------------------
  // TEST F: Zero-Information Evidence (Entropy Unchanged)
  // --------------------------------------------------------------------------
  console.log('\n[TEST F: Zero-Information Evidence (Entropy Unchanged)]');
  const neutralEvidence: ExplicitEvidenceItem = {
    evidence_id: 'EVID-NEUTRAL-STATUS',
    source: 'STATUS_MONITOR',
    evidence_type: 'NOMINAL_TELEMETRY',
    title: 'Neutral telemetry status',
    description: 'Provides no discriminative information across source classes.',
    value: {},
    timestamp: new Date().toISOString(),
    provenance: 'DERIVED',
    reliability: 'HIGH',
    applicability: 'General telemetry check.',
    affected_hypotheses: ALL_CANDIDATE_HYPOTHESES,
    direction_of_influence: {
      GAS_FLARE: 'NEUTRAL',
      INDUSTRIAL_FIRE: 'NEUTRAL',
      AGRICULTURAL_BURN: 'NEUTRAL',
      WILDFIRE_VEGETATION: 'NEUTRAL',
      OTHER: 'NEUTRAL',
    },
    strength_of_influence: {
      GAS_FLARE: 0,
      INDUSTRIAL_FIRE: 0,
      AGRICULTURAL_BURN: 0,
      WILDFIRE_VEGETATION: 0,
      OTHER: 0,
    },
    is_incorporated: true,
  };

  const fusedNeutral = fuseEvidenceAndAssessUncertainty({
    initialDistribution: initialDist,
    evidenceItems: [neutralEvidence],
  });

  assert(
    Math.abs(fusedNeutral.initial_vs_current.entropy_delta_bits) < 0.05,
    `Neutral evidence leaves Shannon entropy unchanged (ΔH = ${fusedNeutral.initial_vs_current.entropy_delta_bits} bits ≈ 0)`
  );
  assert(
    fusedNeutral.initial_vs_current.uncertainty_status === 'UNCHANGED',
    'Uncertainty status is UNCHANGED for neutral evidence'
  );

  // --------------------------------------------------------------------------
  // TEST G: Ambiguity-Increasing Evidence (Entropy Increases, ΔH < 0)
  // --------------------------------------------------------------------------
  console.log('\n[TEST G: Ambiguity-Increasing Evidence (Entropy Increases, ΔH < 0)]');
  // Start with concentrated 75% gas flare distribution
  const startFlare: ContextualHypothesisItem[] = [
    { hypothesis: 'GAS_FLARE', percentage: 75, label: 'Gas Flare', support_level: 'VERY_HIGH' as const, normalized_score: 0.75, reasons: [] },
    { hypothesis: 'INDUSTRIAL_FIRE', percentage: 10, label: 'Industrial Fire', support_level: 'LOW' as const, normalized_score: 0.10, reasons: [] },
    { hypothesis: 'OTHER', percentage: 7, label: 'Other', support_level: 'MINIMAL' as const, normalized_score: 0.07, reasons: [] },
    { hypothesis: 'AGRICULTURAL_BURN', percentage: 4, label: 'Agricultural Burn', support_level: 'MINIMAL' as const, normalized_score: 0.04, reasons: [] },
    { hypothesis: 'WILDFIRE_VEGETATION', percentage: 4, label: 'Wildfire', support_level: 'MINIMAL' as const, normalized_score: 0.04, reasons: [] },
  ];

  // Contradictory evidence suggesting strong alternative hypothesis (e.g. dense crop residue burn reports)
  const contradictoryEvidence: ExplicitEvidenceItem = {
    evidence_id: 'EVID-CONTRADICTORY-AGRI',
    source: 'STATE_POLLUTION_CONTROL_BOARD_LOGS',
    evidence_type: 'REPORTED_FIELD_BURN_SCAR',
    title: 'Report of active crop burning in adjacent zone',
    description: 'Introduces competing agricultural burn hypothesis.',
    value: {},
    timestamp: new Date().toISOString(),
    provenance: 'REAL',
    reliability: 'MODERATE',
    applicability: 'Alternative source hypothesis.',
    affected_hypotheses: ['AGRICULTURAL_BURN', 'GAS_FLARE'],
    direction_of_influence: {
      GAS_FLARE: 'DECREASES_SUPPORT',
      INDUSTRIAL_FIRE: 'NEUTRAL',
      AGRICULTURAL_BURN: 'INCREASES_SUPPORT',
      WILDFIRE_VEGETATION: 'INCREASES_SUPPORT',
      OTHER: 'NEUTRAL',
    },
    strength_of_influence: {
      GAS_FLARE: -35,
      INDUSTRIAL_FIRE: 0,
      AGRICULTURAL_BURN: 45,
      WILDFIRE_VEGETATION: 20,
      OTHER: 0,
    },
    is_incorporated: true,
  };

  const fusedAmbiguous = fuseEvidenceAndAssessUncertainty({
    initialDistribution: startFlare,
    evidenceItems: [contradictoryEvidence],
  });

  assert(
    fusedAmbiguous.initial_vs_current.entropy_delta_bits < 0,
    `Ambiguity-increasing evidence increases Shannon entropy (ΔH = ${fusedAmbiguous.initial_vs_current.entropy_delta_bits} bits < 0)`
  );
  assert(
    fusedAmbiguous.initial_vs_current.uncertainty_status === 'AMBIGUITY_INCREASED',
    'Uncertainty status is AMBIGUITY_INCREASED (system does not artificially force ΔH > 0)'
  );

  // --------------------------------------------------------------------------
  // TEST H: Unassociated Event (Full 5-Class Distribution & Entropy)
  // --------------------------------------------------------------------------
  console.log('\n[TEST H: Unassociated Regional Event]');
  const regionalCase = buildInvestigationCase({
    id: 'FIRMS-REGIONAL-RURAL-01',
    latitude: 20.8765,
    longitude: 85.2345,
    satellite: 'NOAA-20',
    frp: 8.5,
    confidence: 'nominal',
    day_night: 'D',
  });

  assert(regionalCase.spatial_assessment.is_associated === false, 'Regional case is unassociated');
  assert(regionalCase.behaviour_assessment.baseline_status === 'NONE', 'Regional case baseline_status is NONE');
  assert(regionalCase.hypothesis_assessment.candidate_hypotheses.length === 5, 'Regional case evaluates full 5-class candidate distribution');
  assert(regionalCase.uncertainty_assessment.entropy_bits > 0, 'Regional case evaluates positive Shannon entropy');
  assert(regionalCase.evidence_assessment.explicit_evidence_items !== undefined, 'Regional case includes explicit evidence items');
  assert(
    regionalCase.evidence_assessment.explicit_evidence_items?.some((e) => e.provenance === 'REAL'),
    'Regional case explicit evidence items include REAL provenance items'
  );

  // --------------------------------------------------------------------------
  // TEST I: Jamnagar Benchmark Preservation
  // --------------------------------------------------------------------------
  console.log('\n[TEST I: Jamnagar Benchmark Preservation]');
  const jamnagarCase = buildInvestigationCase({
    id: 'FIRMS-NOAA-20-20260101-2132-1',
    latitude: 22.33776,
    longitude: 69.86501,
    satellite: 'NOAA-20',
    sensor: 'VIIRS',
    frp: 2.06,
    brightness_ti4: 302.16,
    brightness_ti5: 291.30,
    scan: 0.58,
    track: 0.52,
    day_night: 'N',
    confidence: 'nominal',
  });

  assert(jamnagarCase.associated_facility?.id === 'FAC-GUJ-JAMNAGAR-01', 'Jamnagar facility matched');
  assert(jamnagarCase.spatial_assessment.spatial_classification === 'FACILITY_OFF_ZONE', 'Jamnagar off-stack observation is classified as FACILITY_OFF_ZONE');
  assert(jamnagarCase.hypothesis_assessment.hypotheses_distribution.length === 5, 'Jamnagar off-zone evaluates 5 candidate hypotheses');
  assert(jamnagarCase.uncertainty_assessment.entropy_bits > 0, `Jamnagar entropy evaluated deterministically (${jamnagarCase.uncertainty_assessment.entropy_bits} bits)`);

  // Collocated Stack Zone benchmark case
  const stackCase = buildInvestigationCase({
    id: 'FIRMS-20260920-INSPECT-01',
    latitude: 22.3685,
    longitude: 69.8690,
    frp: 4.50,
    confidence: 'high',
    day_night: 'N',
  });
  assert(stackCase.spatial_assessment.spatial_classification === 'KNOWN_THERMAL_ZONE', 'Stack case matches KNOWN_THERMAL_ZONE');
  assert(stackCase.hypothesis_assessment.primary_hypothesis_type === 'GAS_FLARE', 'Stack case primary hypothesis is GAS_FLARE');
  const stackFlarePct = stackCase.hypothesis_assessment.hypotheses_distribution.find((h) => h.hypothesis === 'GAS_FLARE')?.percentage || 0;
  assert(stackFlarePct >= 60, `Stack case flare support is dominant (${stackFlarePct}% >= 60%)`);

  // --------------------------------------------------------------------------
  // TEST J: Mathematical Invariants Verification
  // --------------------------------------------------------------------------
  console.log('\n[TEST J: Mathematical Invariants Verification]');
  // 1. Probabilities sum to 100% across multiple diverse cases
  const testDistributions = [
    fusedWithOptical.fused_hypotheses,
    fusedNeutral.fused_hypotheses,
    fusedAmbiguous.fused_hypotheses,
    regionalCase.hypothesis_assessment.hypotheses_distribution,
    jamnagarCase.hypothesis_assessment.hypotheses_distribution,
  ];

  for (let i = 0; i < testDistributions.length; i++) {
    const dist = testDistributions[i];
    const sum = dist.reduce((acc, h) => acc + h.percentage, 0);
    assert(sum === 100, `Distribution ${i + 1} candidate percentages sum to exactly 100% (actual: ${sum}%)`);
    assert(dist.length === 5, `Distribution ${i + 1} has all 5 candidate hypotheses present`);
    assert(dist.every((h) => h.percentage >= 0), `Distribution ${i + 1} contains strictly non-negative percentages`);
  }

  // 2. Exact entropy formula verification
  // For distribution: [50%, 25%, 12.5%, 6.25%, 6.25%]
  // H = -(0.5*log2(0.5) + 0.25*log2(0.25) + 0.125*log2(0.125) + 2 * (0.0625*log2(0.0625)))
  // H = -(0.5*(-1) + 0.25*(-2) + 0.125*(-3) + 2 * 0.0625*(-4))
  // H = -(-0.5 - 0.5 - 0.375 - 0.5) = 1.875 bits.
  const analyticDist = [
    { hypothesis: 'GAS_FLARE', percentage: 50 },
    { hypothesis: 'INDUSTRIAL_FIRE', percentage: 25 },
    { hypothesis: 'AGRICULTURAL_BURN', percentage: 12.5 },
    { hypothesis: 'WILDFIRE_VEGETATION', percentage: 6.25 },
    { hypothesis: 'OTHER', percentage: 6.25 },
  ];
  const analyticEntropy = calculateExactShannonEntropy(analyticDist);
  assert(
    Math.abs(analyticEntropy.entropy_bits - 1.875) < 0.005,
    `Exact Shannon formula matches analytic expectation: H = 1.875 bits (calculated: ${analyticEntropy.entropy_bits})`
  );

  console.log('\n' + '='.repeat(78));
  console.log(`SECTION 7 TEST SUMMARY: ${passed} PASSED | ${failed} FAILED`);
  console.log('='.repeat(78));

  if (failed > 0) {
    process.exit(1);
  }
}

runSection7Tests();
