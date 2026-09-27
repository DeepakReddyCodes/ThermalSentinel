// ============================================================================
// ThermalSentinel — Bayesian Source Inference Engine Test Suite (Day 1C)
//
// Rigorously tests the corrected probabilistic and mathematical mechanics:
//   1. Spatially independent base prior (eliminates prior double-counting)
//   2. Spatial context carried strictly via SPATIAL_CONTEXT likelihood
//   3. Derived ML Advisory excluded from authoritative posterior multiplication
//   4. Diagnostic ML advisory retained for conflict/support metadata
//   5. Conditional dependency tracking for behavioural baseline & persistence
//   6. Authoritative empirical Jamnagar baseline (294 observations, median 2.32 MW)
//   7. Controlled benchmarks explicitly labeled CONTROLLED
//   8. Exact posterior normalization and Shannon entropy calculation
// ============================================================================

import {
  evaluateBayesianSourceHypotheses,
  getPriorDistribution,
  logSumExp,
  calculateBayesianShannonEntropy,
  evaluateRadiometryLikelihood,
  evaluateSpatialContextLikelihood,
  evaluateBehaviouralBaselineLikelihood,
  evaluateTemporalPersistenceLikelihood,
  evaluateMLAdvisoryLikelihood,
  ALL_CANDIDATE_HYPOTHESES,
  BayesianEvidenceItem,
  BayesianInferenceInput,
} from '../server/bayesianEngine.js';
import { SourceHypothesisType, ThermalSourceDiscriminatorOutput } from '../server/types.js';
import { EmpiricalFacilityBaseline } from '../server/historicalIngestion.js';
import { TemporalPersistenceContext } from '../server/persistenceEngine.js';
import { OsmContextResponse } from '../server/osm.js';
import { WeatherContextResponse } from '../server/weather.js';
import fs from 'fs';
import path from 'path';

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

function runBayesianTestSuite() {
  console.log('='.repeat(80));
  console.log('THERMALSENTINEL — BAYESIAN SOURCE INFERENCE ENGINE TEST SUITE (DAY 1C)');
  console.log('='.repeat(80));

  // --------------------------------------------------------------------------
  // TEST A: Spatially Independent Base Prior (Eliminating Prior Double-Counting)
  // --------------------------------------------------------------------------
  console.log('\n[TEST A: Spatially Independent Base Prior]');
  {
    const priorInsideZone = getPriorDistribution({ spatial_association: 'KNOWN_THERMAL_ZONE' });
    const priorOffZone = getPriorDistribution({ spatial_association: 'FACILITY_OFF_ZONE' });
    const priorBuffer = getPriorDistribution({ spatial_association: 'FACILITY_BUFFER' });
    const priorUnassociated = getPriorDistribution({ spatial_association: 'UNASSOCIATED' });

    assert(
      priorInsideZone.distribution.GAS_FLARE === 0.20 &&
      priorOffZone.distribution.GAS_FLARE === 0.20 &&
      priorBuffer.distribution.GAS_FLARE === 0.20 &&
      priorUnassociated.distribution.GAS_FLARE === 0.20,
      'Base prior P(GAS_FLARE) is spatially invariant (0.20 across all spatial associations)'
    );

    let allEqual = true;
    for (const h of ALL_CANDIDATE_HYPOTHESES) {
      if (
        priorInsideZone.distribution[h] !== 0.20 ||
        priorOffZone.distribution[h] !== 0.20 ||
        priorBuffer.distribution[h] !== 0.20 ||
        priorUnassociated.distribution[h] !== 0.20
      ) {
        allEqual = false;
        break;
      }
    }
    assert(allEqual, 'All 5 hypotheses share exact 0.20 uniform baseline prior regardless of location');
    assert(priorInsideZone.provenance === 'EXPERT_PRIOR', 'Prior provenance is explicitly marked EXPERT_PRIOR');
  }

  // --------------------------------------------------------------------------
  // TEST B: Spatial Context Carried Exclusively via SPATIAL_CONTEXT Likelihood
  // --------------------------------------------------------------------------
  console.log('\n[TEST B: Spatial Context Carried via Likelihood]');
  {
    const insideZoneLikelihood = evaluateSpatialContextLikelihood({
      spatial_association: 'KNOWN_THERMAL_ZONE',
      distance_to_zone_meters: 10,
    });
    const offZoneLikelihood = evaluateSpatialContextLikelihood({
      spatial_association: 'FACILITY_OFF_ZONE',
      distance_to_zone_meters: 500,
    });
    const unassociatedLikelihood = evaluateSpatialContextLikelihood({
      spatial_association: 'UNASSOCIATED',
    });

    assert(
      insideZoneLikelihood.likelihood_by_hypothesis.GAS_FLARE > insideZoneLikelihood.likelihood_by_hypothesis.AGRICULTURAL_BURN,
      'Inside zone spatial likelihood strongly favors GAS_FLARE over AGRICULTURAL_BURN'
    );
    assert(
      offZoneLikelihood.likelihood_by_hypothesis.INDUSTRIAL_FIRE > offZoneLikelihood.likelihood_by_hypothesis.GAS_FLARE,
      'Off-zone spatial likelihood shifts weight to INDUSTRIAL_FIRE over routine GAS_FLARE'
    );
    assert(
      unassociatedLikelihood.likelihood_by_hypothesis.AGRICULTURAL_BURN > unassociatedLikelihood.likelihood_by_hypothesis.GAS_FLARE,
      'Unassociated spatial likelihood strongly favors AGRICULTURAL_BURN over GAS_FLARE'
    );
    assert(
      insideZoneLikelihood.independence_status === 'CONDITIONALLY_INDEPENDENT',
      'SPATIAL_CONTEXT independence_status is CONDITIONALLY_INDEPENDENT'
    );
  }

  // --------------------------------------------------------------------------
  // TEST C: ML Advisory Does NOT Multiply Authoritative Posterior (Derived Signal)
  // --------------------------------------------------------------------------
  console.log('\n[TEST C: ML Advisory Excluded from Authoritative Posterior]');
  {
    const mockML: ThermalSourceDiscriminatorOutput = {
      status: 'AVAILABLE',
      model_id: 'lr-v5f3-standardized',
      model_version: '5.3.0',
      evaluation_level: 'OBSERVATION',
      task: 'GAS_FLARE_VS_WILDFIRE_CONFIRMED',
      predicted_class: 'GAS_FLARE',
      flare_score: 0.98,
      wildfire_score: 0.02,
      decision_threshold: 0.50,
      threshold_status: 'OPERATIONAL_CALIBRATED',
      coverage_status: 'FULL_COVERAGE',
      interpretation: 'Very strong point-source flaring signature',
      evidence_basis: ['FRP', 'Brightness delta'],
      limitations: ['Binary model only'],
      timestamp: '2026-03-24T18:00:00Z',
    };

    const inputBase: BayesianInferenceInput = {
      frp: 25.0,
      day_night: 'N',
      brightness_ti4: 345.0,
      brightness_ti5: 295.0,
      brightness_delta: 50.0,
      confidence: 'nominal',
      sensor: 'VIIRS',
      spatial_association: 'KNOWN_THERMAL_ZONE',
      distance_to_zone_meters: 0,
    };

    const resultWithoutML = evaluateBayesianSourceHypotheses(inputBase);
    const resultWithML = evaluateBayesianSourceHypotheses({
      ...inputBase,
      ml_discriminator: mockML,
    });

    let maxPostDiff = 0;
    for (const h of ALL_CANDIDATE_HYPOTHESES) {
      maxPostDiff = Math.max(
        maxPostDiff,
        Math.abs(resultWithoutML.posterior_probabilities[h] - resultWithML.posterior_probabilities[h])
      );
    }

    assert(
      maxPostDiff < 1e-12,
      `Authoritative posterior is identical with and without ML advisory (max diff: ${maxPostDiff.toExponential(4)})`
    );

    assert(
      resultWithML.advisory_evidence_items.some((e) => e.evidence_family === 'ML_ADVISORY'),
      'ML Advisory is preserved in advisory_evidence_items for diagnostic inspection'
    );
    assert(
      !resultWithML.incorporated_evidence_items.some((e) => e.evidence_family === 'ML_ADVISORY'),
      'ML Advisory is excluded from incorporated_evidence_items to prevent collinear double-counting'
    );
  }

  // --------------------------------------------------------------------------
  // TEST D: ML Conflict Detection Retained as Advisory Cross-Check
  // --------------------------------------------------------------------------
  console.log('\n[TEST D: ML Conflict Detection]');
  {
    // High-heat off-zone industrial fire where ML outputs Wildfire-side prediction
    const mockWildfireML: ThermalSourceDiscriminatorOutput = {
      status: 'AVAILABLE',
      model_id: 'lr-v5f3-standardized',
      model_version: '5.3.0',
      evaluation_level: 'OBSERVATION',
      task: 'GAS_FLARE_VS_WILDFIRE_CONFIRMED',
      predicted_class: 'WILDFIRE_CONFIRMED',
      flare_score: 0.08,
      wildfire_score: 0.92,
      decision_threshold: 0.50,
      threshold_status: 'OPERATIONAL_CALIBRATED',
      coverage_status: 'FULL_COVERAGE',
      interpretation: 'Broad energetic thermal bloom',
      evidence_basis: ['FRP', 'Brightness'],
      limitations: ['Binary model only'],
      timestamp: '2026-03-24T18:00:00Z',
    };

    const input: BayesianInferenceInput = {
      frp: 85.0,
      day_night: 'N',
      spatial_association: 'FACILITY_OFF_ZONE',
      distance_to_zone_meters: 650,
      distance_to_facility_meters: 0,
      facility_id: 'FAC-GUJ-JAMNAGAR-01',
      facility_name: 'Jamnagar Refinery Complex',
      ml_discriminator: mockWildfireML,
    };

    const result = evaluateBayesianSourceHypotheses(input);

    assert(
      result.evidence_conflict.has_conflict,
      `Engine flags structured evidence conflict between spatial industrial facility and wildfire ML (severity: ${result.evidence_conflict.severity})`
    );
    assert(
      result.evidence_conflict.discriminator_score_pct === 92,
      'Conflict metadata accurately reports ML discriminator score'
    );
  }

  // --------------------------------------------------------------------------
  // TEST E: Dependency Metadata for Baseline & Persistence (Day 1E Correction)
  // --------------------------------------------------------------------------
  console.log('\n[TEST E: Dependency Metadata & Non-Multiplication for Baseline & Persistence]');
  {
    const baselineEvid = evaluateBehaviouralBaselineLikelihood({
      behavioural_status: 'NORMAL',
      baseline: {
        facility_id: 'FAC-GUJ-JAMNAGAR-01',
        facility_name: 'Jamnagar Refinery Complex',
        baseline_status: 'EMPIRICAL',
        minimum_threshold_required: 30,
        provenance: 'Historical sample',
        baseline_period: { start_date: '2026-01-01', end_date: '2026-04-22', total_days: 111 },
        metrics: {
          observation_count: 294,
          observation_days: 88,
          observations_per_day: 2.65,
          frp_median: 2.32,
          frp_p25: 1.56,
          frp_p75: 3.11,
          frp_p90: 4.27,
          frp_p95: 6.41,
          frp_max: 31.19,
          frp_iqr: 1.55,
          frp_mad: 0.76,
        },
        diurnal: { day_count: 48, night_count: 246, day_pct: 16, night_pct: 84, hour_distribution: [] },
        spatial_distribution: { known_zone_count: 0, off_zone_count: 110, buffer_count: 106, zones: [] },
        created_at: '2026-04-22T00:00:00Z',
      },
      frp: 2.5,
    });

    assert(
      baselineEvid.independence_status === 'DERIVED',
      'Baseline evidence is marked DERIVED (derived from current FRP + historical baseline)'
    );
    assert(
      baselineEvid.is_incorporated === false,
      'Baseline evidence is marked is_incorporated: false (excluded from independent posterior multiplication)'
    );
    assert(
      baselineEvid.depends_on.includes('RADIOMETRY') && baselineEvid.depends_on.includes('FACILITY_BASELINE_ENGINE'),
      'Baseline evidence explicitly documents dependencies on RADIOMETRY and FACILITY_BASELINE_ENGINE'
    );

    const persistEvid = evaluateTemporalPersistenceLikelihood({
      status: 'PERSISTENT',
      is_persistent: true,
      cluster_observation_count: 45,
      distinct_active_days: 28,
    });

    assert(
      persistEvid.independence_status === 'DERIVED',
      'Temporal persistence is marked DERIVED (shares historical observation archive with baseline)'
    );
    assert(
      persistEvid.is_incorporated === false,
      'Temporal persistence is marked is_incorporated: false (excluded from independent posterior multiplication)'
    );
    assert(
      persistEvid.depends_on.includes('HISTORICAL_VIIRS_ARCHIVE') && persistEvid.depends_on.includes('TEMPORAL_PERSISTENCE_ENGINE'),
      'Persistence evidence documents dependencies on HISTORICAL_VIIRS_ARCHIVE and TEMPORAL_PERSISTENCE_ENGINE'
    );

    // Verify that adding baseline and persistence metadata does not alter the authoritative Bayesian posterior
    const baseInput: BayesianInferenceInput = {
      frp: 3.5,
      day_night: 'N',
      confidence: 'nominal',
      sensor: 'VIIRS',
      spatial_association: 'KNOWN_THERMAL_ZONE',
      distance_to_zone_meters: 10,
    };
    const resWithoutDerived = evaluateBayesianSourceHypotheses(baseInput);
    const resWithDerived = evaluateBayesianSourceHypotheses({
      ...baseInput,
      behavioural_status: 'NORMAL',
      baseline: {
        facility_id: 'FAC-GUJ-JAMNAGAR-01',
        facility_name: 'Jamnagar Refinery Complex',
        baseline_status: 'EMPIRICAL',
        minimum_threshold_required: 30,
        provenance: 'Historical sample',
        baseline_period: { start_date: '2026-01-01', end_date: '2026-04-22', total_days: 111 },
        metrics: {
          observation_count: 294,
          observation_days: 88,
          observations_per_day: 2.65,
          frp_median: 2.32,
          frp_p25: 1.56,
          frp_p75: 3.11,
          frp_p90: 4.27,
          frp_p95: 6.41,
          frp_max: 31.19,
          frp_iqr: 1.55,
          frp_mad: 0.76,
        },
        diurnal: { day_count: 48, night_count: 246, day_pct: 16, night_pct: 84, hour_distribution: [] },
        spatial_distribution: { known_zone_count: 0, off_zone_count: 110, buffer_count: 106, zones: [] },
        created_at: '2026-04-22T00:00:00Z',
      },
      persistence_context: {
        status: 'PERSISTENT',
        is_persistent: true,
        cluster_observation_count: 45,
        distinct_active_days: 28,
      },
    });

    let maxDerivedDiff = 0;
    for (const h of ALL_CANDIDATE_HYPOTHESES) {
      maxDerivedDiff = Math.max(
        maxDerivedDiff,
        Math.abs(resWithoutDerived.posterior_probabilities[h] - resWithDerived.posterior_probabilities[h])
      );
    }
    assert(
      maxDerivedDiff < 1e-12,
      `Authoritative posterior is unchanged when baseline/persistence context are attached (diff: ${maxDerivedDiff.toExponential(4)})`
    );
    assert(
      resWithDerived.advisory_evidence_items.some((e) => e.evidence_family === 'BEHAVIOURAL_BASELINE'),
      'Baseline is preserved in advisory_evidence_items'
    );
    assert(
      resWithDerived.advisory_evidence_items.some((e) => e.evidence_family === 'TEMPORAL_PERSISTENCE'),
      'Persistence is preserved in advisory_evidence_items'
    );
  }

  // --------------------------------------------------------------------------
  // TEST F: Authoritative Empirical Jamnagar Baseline from Dataset
  // --------------------------------------------------------------------------
  console.log('\n[TEST F: Authoritative Empirical Jamnagar Baseline]');
  {
    const baselinePath = path.join(process.cwd(), 'data', 'processed', 'FAC-GUJ-JAMNAGAR-01_baseline.json');
    let loadedBaseline: EmpiricalFacilityBaseline | null = null;
    if (fs.existsSync(baselinePath)) {
      loadedBaseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    }

    assert(loadedBaseline !== null, 'Found and loaded authoritative Jamnagar baseline JSON');
    if (loadedBaseline) {
      assert(loadedBaseline.metrics.observation_count === 294, `Empirical count is 294 (actual: ${loadedBaseline.metrics.observation_count})`);
      assert(loadedBaseline.metrics.frp_median === 2.32, `Empirical median FRP is 2.32 MW (actual: ${loadedBaseline.metrics.frp_median})`);
      assert(loadedBaseline.metrics.frp_p95 === 6.41, `Empirical P95 FRP is 6.41 MW (actual: ${loadedBaseline.metrics.frp_p95})`);
      assert(loadedBaseline.diurnal.night_pct === 84, `Empirical night ratio is 84% (actual: ${loadedBaseline.diurnal.night_pct}%)`);

      // Test real Jamnagar routine observation (FRP = 2.8 MW, Night, Inside zone)
      const input: BayesianInferenceInput = {
        frp: 2.8,
        day_night: 'N',
        brightness_ti4: 342.0,
        brightness_ti5: 293.0,
        brightness_delta: 49.0,
        confidence: 'nominal',
        sensor: 'VIIRS',
        spatial_association: 'KNOWN_THERMAL_ZONE',
        distance_to_zone_meters: 15,
        distance_to_facility_meters: 0,
        facility_id: 'FAC-GUJ-JAMNAGAR-01',
        facility_name: loadedBaseline.facility_name,
        behavioural_status: 'NORMAL',
        baseline: loadedBaseline,
      };

      const result = evaluateBayesianSourceHypotheses(input);
      const flareP = result.posterior_probabilities.GAS_FLARE;
      assert(flareP > 0.70, `Genuine Jamnagar routine flare observation evaluates to dominant GAS_FLARE (P = ${(flareP * 100).toFixed(1)}%)`);
      assert(result.uncertainty.entropy_bits < 1.0, `Entropy is low (${result.uncertainty.entropy_bits.toFixed(3)} bits)`);
    }
  }

  // --------------------------------------------------------------------------
  // TEST G: Controlled Benchmarks Labeled CONTROLLED
  // --------------------------------------------------------------------------
  console.log('\n[TEST G: Controlled Benchmark Labeling]');
  {
    const controlledBaseline: EmpiricalFacilityBaseline = {
      facility_id: 'FAC-CONTROLLED-01',
      facility_name: 'Controlled High-Excursion Test Rig',
      baseline_status: 'CONTROLLED',
      minimum_threshold_required: 10,
      provenance: 'CONTROLLED',
      baseline_period: { start_date: '2026-01-01', end_date: '2026-03-20', total_days: 79 },
      metrics: {
        observation_count: 50,
        observation_days: 40,
        observations_per_day: 1.25,
        frp_median: 32.1,
        frp_p25: 18.0,
        frp_p75: 42.5,
        frp_p90: 68.0,
        frp_p95: 89.2,
        frp_max: 142.0,
        frp_iqr: 24.5,
        frp_mad: 14.2,
      },
      diurnal: { day_count: 5, night_count: 45, day_pct: 10, night_pct: 90, hour_distribution: [] },
      spatial_distribution: { known_zone_count: 50, off_zone_count: 0, buffer_count: 0, zones: [] },
      created_at: '2026-03-24T00:00:00Z',
    };

    const baselineEvid = evaluateBehaviouralBaselineLikelihood({
      behavioural_status: 'NORMAL',
      baseline: controlledBaseline,
      frp: 35.0,
    });

    assert(
      baselineEvid.independence_status === 'CONTROLLED',
      'Controlled baseline evidence has independence_status CONTROLLED'
    );
  }

  // --------------------------------------------------------------------------
  // TEST H: Real Unassociated Rural Hotspot
  // --------------------------------------------------------------------------
  console.log('\n[TEST H: Real Unassociated Rural Hotspot]');
  {
    const ruralOsm: OsmContextResponse = {
      status: 'AUTHENTIC_LIVE',
      is_live_external: true,
      query_center: [19.852, 75.312],
      search_radius_meters: 2000,
      total_features_found: 1,
      nearest_feature: {
        source: 'OPENSTREETMAP',
        feature_id: 'way/12345',
        name: 'Wheat Farmland',
        category: 'farmland',
        display_label: 'Farmland — 15m',
        coordinates: [19.852, 75.312],
        distance_meters: 15,
        geometry_type: 'polygon',
        tags: { landuse: 'farmland' },
      },
      features: [],
      categories_summary: { farmland: 1 },
      provenance: {
        source: 'OPENSTREETMAP',
        api_endpoint: 'https://overpass-api.de',
        retrieval_timestamp: '2026-03-24T14:10:00Z',
        bounding_radius_km: 2.0,
        attribution: 'OpenStreetMap',
      },
      analytical_status: 'CONTEXTUAL_GEOSPATIAL_EVIDENCE',
      analytical_authority_disclaimer: 'Contextual only',
    };

    const input: BayesianInferenceInput = {
      frp: 18.2,
      day_night: 'D',
      confidence: 'nominal',
      sensor: 'VIIRS',
      satellite: 'VIIRS-NOAA20',
      spatial_association: 'UNASSOCIATED',
      distance_to_facility_meters: 42000,
      osm_context: ruralOsm,
      baseline: null,
    };

    const result = evaluateBayesianSourceHypotheses(input);

    const gasFlare = result.posterior_probabilities.GAS_FLARE;
    const agBurn = result.posterior_probabilities.AGRICULTURAL_BURN;
    const wildVeg = result.posterior_probabilities.WILDFIRE_VEGETATION;

    assert(gasFlare < 0.05, `GAS_FLARE posterior is near zero for unassociated farmland (actual: ${gasFlare.toFixed(4)})`);
    assert(
      agBurn > 0.35 || wildVeg > 0.35,
      `Vegetation / Agricultural burn dominates unassociated farmland (Ag: ${agBurn.toFixed(3)}, Wild: ${wildVeg.toFixed(3)})`
    );
  }

  // --------------------------------------------------------------------------
  // TEST I: Deterministic Repeatability Across 100 Runs
  // --------------------------------------------------------------------------
  console.log('\n[TEST I: Deterministic Repeatability Across 100 Runs]');
  {
    const input: BayesianInferenceInput = {
      frp: 32.0,
      day_night: 'N',
      confidence: 'nominal',
      sensor: 'VIIRS',
      satellite: 'VIIRS-NPP',
      spatial_association: 'KNOWN_THERMAL_ZONE',
      distance_to_zone_meters: 0,
      facility_id: 'FAC-GUJ-JAMNAGAR-01',
    };

    const firstRun = evaluateBayesianSourceHypotheses(input);
    let isBitExact = true;

    for (let i = 0; i < 100; i++) {
      const currentRun = evaluateBayesianSourceHypotheses(input);
      for (const h of ALL_CANDIDATE_HYPOTHESES) {
        if (firstRun.posterior_probabilities[h] !== currentRun.posterior_probabilities[h]) {
          isBitExact = false;
          break;
        }
      }
      if (!isBitExact) break;
    }

    assert(isBitExact, '100 sequential runs produce bit-exact identical posterior distributions');
  }

  // --------------------------------------------------------------------------
  // Summary
  // --------------------------------------------------------------------------
  console.log('\n' + '='.repeat(80));
  console.log(`BAYESIAN ENGINE TEST SUITE SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('='.repeat(80));

  if (failed > 0) {
    process.exit(1);
  }
}

runBayesianTestSuite();
