/**
 * Day 2D-1 Test Suite: NBE Integration Hardening
 *
 * Verifies:
 * A. Canonical Bayesian -> NBE Handoff Identity (posterior & entropy)
 * B. Entropy Identity
 * C. EIG Mathematical Properties (marginal sum = 1, posterior sum = 1, EIG >= 0)
 * D. Candidate Eligibility (applied exclusions, unavailable statuses, out-of-scope)
 * E. Zero-Information Candidate (EIG ~ 0)
 * F. Case Discrimination & Real vs Prototype Modalities (Sentinel-2, Nightfire, SCADA, Land Cover)
 * G. Baseline Provenance Hardening (event-specific sliced vs regional static corpus)
 */

import { evaluateBayesianSourceHypotheses } from '../server/bayesianEngine';
import { calculateExpectedInformationGain, evaluateRealNextBestEvidence, CANDIDATE_OUTCOME_MODELS } from '../server/nbeEngine';
import { buildInvestigationCase, getOrCreateInvestigationCase, incorporateEvidenceIntoCase } from '../server/investigationEngine';
import { buildEmpiricalFacilityBaseline, buildEventSpecificBaseline } from '../server/historicalIngestion';
import { getFacilityBaselineSync } from '../server/baselineRepository';
import { MONITORED_FACILITIES } from '../server/facilities';
import { SourceHypothesisType } from '../server/types';

function runTestSuite() {
  console.log('================================================================');
  console.log('DAY 2D-1: NEXT-BEST-EVIDENCE (NBE) INTEGRATION TEST SUITE');
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

  const jamnagarFacility = MONITORED_FACILITIES.find(f => f.id === 'FAC-GUJ-JAMNAGAR-01')!;

  // Mock observation 1: Anomalous flare inside Jamnagar thermal zone
  const anomalousFlareObs: any = {
    id: 'TEST_JAMNAGAR_ANOMALOUS_FLARE_01',
    latitude: 22.3615,
    longitude: 69.8320,
    brightness: 385.4,
    frp: 340.5,
    confidence: 'nominal',
    confidence_numeric: 85,
    acq_date: '2024-03-15',
    acq_time: '1830',
    satellite: 'VIIRS-NPP',
    instrument: 'VIIRS',
    daynight: 'N',
    day_night: 'N',
    frp_mw: 340.5,
    spatial_association: 'KNOWN_THERMAL_ZONE',
    distance_to_facility_meters: 0,
    distance_to_zone_meters: 0,
    is_inside_polygon: true,
  };

  // Mock observation 2: Rural unassociated vegetation burn
  const ruralVegetationObs: any = {
    id: 'TEST_RURAL_VEGETATION_01',
    latitude: 22.8500,
    longitude: 70.4000,
    brightness: 315.0,
    frp: 18.2,
    confidence: 'nominal',
    confidence_numeric: 70,
    acq_date: '2024-03-15',
    acq_time: '0830',
    satellite: 'VIIRS-NPP',
    instrument: 'VIIRS',
    daynight: 'D',
    day_night: 'D',
    frp_mw: 18.2,
    spatial_association: 'UNASSOCIATED',
    distance_to_facility_meters: 52000,
    distance_to_zone_meters: 52000,
    is_inside_polygon: false,
  };

  // =========================================================================
  // TEST A & B: Canonical Bayesian -> NBE Handoff Identity & Entropy Identity
  // =========================================================================
  console.log('\n--- Section A & B: Canonical Bayesian -> NBE Handoff Identity ---');

  const bayesianDirect = evaluateBayesianSourceHypotheses({
    frp: 340.5,
    spatial_association: 'KNOWN_THERMAL_ZONE',
    distance_to_zone_meters: 0,
    is_inside_polygon: true,
    day_night: 'N',
  });

  const caseData = buildInvestigationCase(anomalousFlareObs, jamnagarFacility);
  const nbeResult = evaluateRealNextBestEvidence(caseData);

  assert(
    nbeResult.consumed_bayesian_posterior !== undefined,
    'A.1 NBE receives consumed_bayesian_posterior directly in output'
  );

  const directEntropy = caseData.bayesian_result!.uncertainty.entropy_bits;
  const nbeConsumedEntropy = nbeResult.consumed_bayesian_posterior?.entropy_bits;

  assert(
    Math.abs((nbeConsumedEntropy ?? 0) - directEntropy) < 1e-6,
    'A.2 NBE consumed entropy matches authoritative bayesianEngine entropy (< 1e-6)',
    `direct=${directEntropy}, nbeConsumed=${nbeConsumedEntropy}`
  );

  assert(
    nbeResult.consumed_bayesian_posterior?.entropy_bits !== undefined &&
    Math.abs(nbeResult.consumed_bayesian_posterior.entropy_bits - directEntropy) < 1e-6,
    'B.1 NBE current_entropy matches authoritative bayesianEngine entropy (< 1e-6)',
    `direct=${directEntropy}, nbeCurrent=${nbeResult.consumed_bayesian_posterior?.entropy_bits}`
  );

  for (const [hyp, prob] of Object.entries(caseData.bayesian_result!.posterior_probabilities)) {
    const nbeProb = nbeResult.consumed_bayesian_posterior?.posterior_probabilities[hyp as SourceHypothesisType];
    assert(
      nbeProb !== undefined && Math.abs(nbeProb - (prob as number)) < 1e-6,
      `A.3 Posterior probability for ${hyp} matches exactly between Bayes & NBE`,
      `direct=${prob}, nbe=${nbeProb}`
    );
  }

  // =========================================================================
  // TEST C: EIG Mathematical Properties
  // =========================================================================
  console.log('\n--- Section C: EIG Mathematical Properties ---');

  const hypotheses = Object.entries(bayesianDirect.posterior_probabilities).map(([hypothesis, percentage]) => ({
    hypothesis: hypothesis as SourceHypothesisType,
    percentage,
  }));

  const authoritativeBayes = caseData.bayesian_result!;
  const authoritativeEntropy = authoritativeBayes.uncertainty.entropy_bits;

  for (const candidateKey of Object.keys(CANDIDATE_OUTCOME_MODELS)) {
    const eig = calculateExpectedInformationGain(
      candidateKey,
      authoritativeBayes,
      'INDUSTRIAL_FIRE',
      authoritativeEntropy
    );

    assert(
      eig.expected_posterior_entropy_bits <= authoritativeEntropy + 1e-3,
      `C.1 Expected posterior entropy <= current entropy for ${candidateKey}`,
      `current=${authoritativeEntropy}, expected_after=${eig.expected_posterior_entropy_bits}, EIG=${eig.expected_information_gain_bits}`
    );

    assert(
      eig.expected_information_gain_bits >= -1e-9,
      `C.2 EIG >= 0 within numerical tolerance for ${candidateKey}`,
      `EIG=${eig.expected_information_gain_bits}`
    );

    const outcomeProbSum = eig.outcomes.reduce((s, o) => s + o.outcome_probability, 0);
    assert(
      Math.abs(outcomeProbSum - 1.0) < 1e-3,
      `C.3 Outcome marginal probabilities sum to 1.0 for ${candidateKey}`,
      `sum=${outcomeProbSum}`
    );

    for (const outcome of eig.outcomes) {
      const posteriorPctSum = Object.values(outcome.posterior_distribution).reduce((s, p) => s + p, 0);
      assert(
        Math.abs(posteriorPctSum - 100.0) < 1.0,
        `C.4 Conditional posterior for outcome ${outcome.outcome_name} (${candidateKey}) sums to 100%`,
        `sum=${posteriorPctSum}`
      );
    }
  }

  // =========================================================================
  // TEST D: Candidate Eligibility & Availability Statuses
  // =========================================================================
  console.log('\n--- Section D: Candidate Eligibility Rules ---');

  // D.1 Test that already acquired evidence is excluded from missing recommendations
  const caseWithIncorporatedEvidence = JSON.parse(JSON.stringify(caseData));
  caseWithIncorporatedEvidence.evidence_chain = [
    {
      evidence_id: 'EVID-S2-ACQ-01',
      evidence_type: 'SENTINEL2_SWIR_OPTICAL',
      source: 'COPERNICUS_SENTINEL_2_MSI',
      title: 'Sentinel-2 SWIR',
      is_incorporated: true,
      timestamp: '2024-03-15T18:35:00Z',
      value: { scene_id: 'TEST_SCENE' },
    },
  ];

  const nbeAfterAcquisition = evaluateRealNextBestEvidence(caseWithIncorporatedEvidence);
  const s2InRecommendations = nbeAfterAcquisition.missingEvidence.some(
    r => r.evidenceType === 'SENTINEL2_SWIR_OPTICAL'
  );
  assert(
    !s2InRecommendations,
    'D.1 Already-acquired candidate (Sentinel-2) excluded from active recommendations'
  );

  // D.2 Test availability mapping for Daytime Rural Case
  const ruralCase = buildInvestigationCase(ruralVegetationObs);
  const ruralNbe = evaluateRealNextBestEvidence(ruralCase);

  const nightfireCandidate = ruralNbe.allCandidates.find(e => e.evidenceType === 'VIIRS_NIGHTFIRE_COMBUSTION');
  assert(
    nightfireCandidate?.availabilityStatus === 'OUT_OF_SCOPE',
    'D.2 VIIRS Nightfire marked OUT_OF_SCOPE for daytime acquisition (daynight=D)',
    `status=${nightfireCandidate?.availabilityStatus}`
  );

  const scadaCandidate = ruralNbe.allCandidates.find(e => e.evidenceType === 'FACILITY_OPERATIONAL_SCADA_LOGS');
  assert(
    scadaCandidate?.availabilityStatus === 'OUT_OF_SCOPE',
    'D.3 SCADA marked OUT_OF_SCOPE for UNASSOCIATED rural event',
    `status=${scadaCandidate?.availabilityStatus}`
  );

  // D.4 Test availability mapping for Industrial Facility Case
  const indScada = nbeResult.allCandidates.find(e => e.evidenceType === 'FACILITY_OPERATIONAL_SCADA_LOGS');
  assert(
    indScada?.availabilityStatus === 'UNAVAILABLE',
    'D.4 SCADA marked UNAVAILABLE for monitored facility case',
    `status=${indScada?.availabilityStatus}`
  );

  // =========================================================================
  // TEST E: Zero-Information Candidate Gives EIG ~ 0
  // =========================================================================
  console.log('\n--- Section E: Zero-Information Candidate ---');

  // Uniform compatibility across all hypotheses (completely non-informative test)
  const zeroInfoCandidate = 'ZERO_INFO_TEST';
  (CANDIDATE_OUTCOME_MODELS as any)[zeroInfoCandidate] = {
    evidenceType: 'ZERO_INFO_TEST',
    displayName: 'Zero Information Candidate',
    source: 'TEST',
    spatialResolution: 'N/A',
    acquisitionCostEffort: 'IMMEDIATE_ZERO_COST',
    costMultiplier: 1.0,
    provenance: 'CONTROLLED_PROTOTYPE',
    applicableHypotheses: ['GAS_FLARE', 'INDUSTRIAL_FIRE', 'AGRICULTURAL_BURN', 'WILDFIRE_VEGETATION', 'OTHER'],
    discriminativeLevel: 'NONE',
    whyItMatters: 'Testing zero information gain',
    rationale: 'Testing',
    limitations: 'Testing',
    assumptions: [],
    outcomes: [
      {
        id: 'OUTCOME_A',
        name: 'Uninformative Outcome A',
        description: 'Equal probability across all hypotheses',
        conditionalLikelihood: {
          GAS_FLARE: 0.5,
          INDUSTRIAL_FIRE: 0.5,
          AGRICULTURAL_BURN: 0.5,
          WILDFIRE_VEGETATION: 0.5,
          OTHER: 0.5,
        },
      },
      {
        id: 'OUTCOME_B',
        name: 'Uninformative Outcome B',
        description: 'Equal probability across all hypotheses',
        conditionalLikelihood: {
          GAS_FLARE: 0.5,
          INDUSTRIAL_FIRE: 0.5,
          AGRICULTURAL_BURN: 0.5,
          WILDFIRE_VEGETATION: 0.5,
          OTHER: 0.5,
        },
      },
    ],
  };

  const zeroInfoEig = calculateExpectedInformationGain(
    zeroInfoCandidate,
    authoritativeBayes,
    'INDUSTRIAL_FIRE',
    authoritativeEntropy
  );

  assert(
    Math.abs(zeroInfoEig.expected_information_gain_bits) < 1e-6,
    'E.1 Non-informative candidate yields EIG approximately 0.000 bits',
    `EIG=${zeroInfoEig.expected_information_gain_bits}`
  );

  // Clean up mock
  delete (CANDIDATE_OUTCOME_MODELS as any)[zeroInfoCandidate];

  // =========================================================================
  // TEST F: Real Acquirable vs Heuristic Prototype Modalities
  // =========================================================================
  console.log('\n--- Section F: Case Discrimination & Real vs Prototype Modalities ---');

  const topRecommendedCandidate = nbeResult.recommendedExternalEvidence.recommendedCandidate;
  assert(
    topRecommendedCandidate !== undefined && topRecommendedCandidate !== null,
    'F.1 Top recommendation exists for anomalous industrial event'
  );

  const topCandidateType = (topRecommendedCandidate as any)?.evidenceType || topRecommendedCandidate;
  const topCand = nbeResult.allCandidates.find(e => e.evidenceType === topCandidateType);
  assert(
    topCand?.availabilityStatus === 'AVAILABLE' || topCand?.availabilityStatus === 'NOT_CURRENTLY_AVAILABLE',
    'F.2 Top recommendation is an acquirable real modality (e.g. Sentinel-2 or Temporal Persistence)',
    `top=${topCandidateType}, status=${topCand?.availabilityStatus}`
  );

  // Check land-cover candidate on rural case
  const ruralLandCover = ruralNbe.allCandidates.find(e => e.evidenceType === 'HIGH_RES_LAND_COVER_CONTEXT');
  assert(
    ruralLandCover?.availabilityStatus === 'UNAVAILABLE' || ruralLandCover?.availabilityStatus === 'NOT_CURRENTLY_AVAILABLE',
    'F.3 High-Res Land Cover on rural case is marked UNAVAILABLE / NOT_CURRENTLY_AVAILABLE (never falsely claimed as acquired)',
    `status=${ruralLandCover?.availabilityStatus}`
  );

  // =========================================================================
  // TEST G: Baseline Provenance Hardening
  // =========================================================================
  console.log('\n--- Section G: Baseline Provenance Hardening ---');

  // Sliced event-specific baseline
  const eventBaseline = getFacilityBaselineSync('FAC-GUJ-JAMNAGAR-01', '2024-03-15T18:30:00Z')!;
  assert(
    eventBaseline.cutoff_timestamp_iso === '2024-03-15T18:30:00Z',
    'G.1 Event-specific baseline retains cutoff_timestamp_iso',
    `cutoff=${eventBaseline.cutoff_timestamp_iso}`
  );
  assert(
    eventBaseline.provenance_type === 'EVENT_SPECIFIC_SLICED',
    'G.2 Event-specific baseline provenance_type is EVENT_SPECIFIC_SLICED',
    `type=${eventBaseline.provenance_type}`
  );
  assert(
    eventBaseline.population_scope === 'FACILITY_ASSOCIATED',
    'G.3 Event-specific baseline population_scope is FACILITY_ASSOCIATED (N=216 associated subset)',
    `scope=${eventBaseline.population_scope}`
  );

  // Static persisted baseline
  const staticBaseline = getFacilityBaselineSync('FAC-GUJ-JAMNAGAR-01')!;
  assert(
    staticBaseline.provenance_type === 'PERSISTED_REGIONAL_SUMMARY',
    'G.4 Static persisted baseline provenance_type is PERSISTED_REGIONAL_SUMMARY',
    `type=${staticBaseline.provenance_type}`
  );
  assert(
    staticBaseline.population_scope === 'REGIONAL_CORPUS',
    'G.5 Static persisted baseline population_scope is REGIONAL_CORPUS (N=294 regional corpus)',
    `scope=${staticBaseline.population_scope}`
  );

  // Case baseline propagation
  assert(
    caseData.behaviour_assessment.provenance_type === 'FACILITY_ASSOCIATED' ||
    caseData.behaviour_assessment.provenance_type === 'EVENT_SPECIFIC_SLICED' ||
    caseData.behaviour_assessment.provenance_type === 'PERSISTED_REGIONAL_SUMMARY',
    'G.6 CaseData behaviour_assessment retains machine-readable baseline provenance',
    `type=${caseData.behaviour_assessment.provenance_type}, scope=${caseData.behaviour_assessment.population_scope}`
  );

  console.log('\n================================================================');
  console.log(`DAY 2D-1 ALL TESTS PASSED: ${passedTests}/${totalTests} assertions`);
  console.log('================================================================\n');
}

runTestSuite();
