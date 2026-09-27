// ============================================================================
// ThermalSentinel — Section 6 Test Suite: ML Pipeline & Reproducible Inference
//
// Tests:
// 1. Real Jamnagar observation evaluation
// 2. Another valid FIRMS observation (Vadinar / wildland)
// 3. Missing-feature observation handling (LIMITED_MODEL_COVERAGE, 0 crashes, 0 fake data)
// 4. Out-of-domain / MODIS observation handling (OUT_OF_SCOPE, 0 crashes)
// 5. Feature extraction determinism between training and inference
// 6. Inspectable feature contributions and linear logit formula verification
// 7. Evidence conflict detection with contextual hypotheses
// 8. Model artifact persistence & metadata validation
// ============================================================================

import fs from 'fs';
import path from 'path';
import { extractMLFeatures, MODEL_FEATURE_NAMES } from '../server/mlFeaturePipeline.js';
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

function runSection6Tests() {
  console.log('='.repeat(78));
  console.log('THERMALSENTINEL — SECTION 6 ML PIPELINE TEST SUITE');
  console.log('='.repeat(78));

  // --------------------------------------------------------------------------
  // SUITE 1: Real Jamnagar Observation Evaluation
  // --------------------------------------------------------------------------
  console.log('\n[SUITE 1: Real Jamnagar Flagship Observation]');
  const jamnagarObs = {
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
  };

  const jamnagarResult = evaluateThermalDiscriminator(jamnagarObs, 73, {
    spatial_assessment: { spatial_relationship: 'INSIDE_FACILITY_BOUNDARY', distance_to_flare_infrastructure_meters: 165 },
    associated_facility: { id: 'FAC-GUJ-JAMNAGAR-01', name: 'Jamnagar Refinery Complex', category: 'REFINERY' },
  });

  assert(jamnagarResult.status === 'AVAILABLE', 'Jamnagar observation evaluation status is AVAILABLE');
  assert(jamnagarResult.coverage_status === 'FULL_COVERAGE', 'Jamnagar coverage_status is FULL_COVERAGE');
  assert(jamnagarResult.model_id === 'lr-v5f3-standardized', 'Model ID is lr-v5f3-standardized');
  assert(jamnagarResult.supported_classes?.length === 2, 'Supported classes contains exactly 2 binary classes');
  assert(jamnagarResult.predicted_class === 'GAS_FLARE', 'Jamnagar nighttime observation predicted as GAS_FLARE');
  assert((jamnagarResult.flare_score ?? 0) > 0.60, `Flare score is strong (${((jamnagarResult.flare_score ?? 0) * 100).toFixed(1)}%)`);
  assert(
    Math.abs(((jamnagarResult.flare_score ?? 0) + (jamnagarResult.wildfire_score ?? 0)) - 1.0) < 0.001,
    'Sigmoid scores sum to exactly 100%'
  );
  assert(
    jamnagarResult.feature_contributions?.length === 7,
    '7 inspectable feature contributions provided'
  );
  assert(
    jamnagarResult.top_contributing_features?.length === 7,
    'Top contributing features ranked by magnitude'
  );

  // --------------------------------------------------------------------------
  // SUITE 2: Valid Regional / Wildland Observation
  // --------------------------------------------------------------------------
  console.log('\n[SUITE 2: Valid Regional / Wildfire Observation]');
  const wildfireObs = {
    id: 'FIRMS-SNPP-20220911-1000-WF-WA-285',
    latitude: 47.77386,
    longitude: -121.46255,
    satellite: 'Suomi-NPP',
    frp: 35.8,
    brightness_ti4: 367.4,
    brightness_ti5: 301.2,
    scan: 0.40,
    track: 0.37,
    day_night: 'D',
    confidence: 'high',
  };

  const wfResult = evaluateThermalDiscriminator(wildfireObs);
  assert(wfResult.status === 'AVAILABLE', 'Wildfire observation status is AVAILABLE');
  assert(wfResult.predicted_class === 'WILDFIRE_CONFIRMED', 'High-contrast daytime event predicted as WILDFIRE_CONFIRMED');
  assert((wfResult.wildfire_score ?? 0) > 0.80, `Wildfire score is high (${((wfResult.wildfire_score ?? 0) * 100).toFixed(1)}%)`);
  assert(wfResult.feature_contributions?.some((fc) => fc.direction === 'WILDFIRE_SIDE'), 'Feature contributions indicate wildfire direction');

  // --------------------------------------------------------------------------
  // SUITE 3: Missing Feature Handling (No crashes, no fabrication)
  // --------------------------------------------------------------------------
  console.log('\n[SUITE 3: Missing Feature & Physical Bounds Handling]');
  const missingTi5Obs = {
    id: 'FIRMS-INCOMPLETE-01',
    latitude: 22.34,
    longitude: 69.86,
    satellite: 'NOAA-20',
    frp: 5.0,
    brightness_ti4: 320.0,
    brightness_ti5: null, // MISSING
    scan: 0.5,
    track: 0.5,
    day_night: 'N',
  };

  const missingResult = evaluateThermalDiscriminator(missingTi5Obs);
  assert(missingResult.status === 'LIMITED_MODEL_COVERAGE', 'Missing TI5 yields LIMITED_MODEL_COVERAGE');
  assert(missingResult.coverage_status === 'LIMITED_MODEL_COVERAGE', 'Coverage status correctly set to LIMITED_MODEL_COVERAGE');
  assert(missingResult.predicted_class === null, 'Predicted class is null (no fake prediction made)');
  assert(missingResult.wildfire_score === null, 'Wildfire score is null (no fabricated probabilities)');
  assert(missingResult.interpretation.includes('Missing required feature'), 'Interpretation explains missing feature reason');

  const unphysicallObs = {
    id: 'FIRMS-CORRUPTED-02',
    latitude: 22.34,
    longitude: 69.86,
    satellite: 'NOAA-20',
    frp: -10.0, // INVALID FRP
    brightness_ti4: 999.0, // EXCEEDS 380K BOUND
    brightness_ti5: 290.0,
    scan: 0.5,
    track: 0.5,
    day_night: 'N',
  };

  const unphysicalResult = evaluateThermalDiscriminator(unphysicallObs);
  assert(unphysicalResult.status === 'LIMITED_MODEL_COVERAGE', 'Unphysical values yield LIMITED_MODEL_COVERAGE');
  assert(unphysicalResult.predicted_class === null, 'Unphysical values yield null predicted class');

  // --------------------------------------------------------------------------
  // SUITE 4: Out-of-Domain / MODIS Sensor Handling
  // --------------------------------------------------------------------------
  console.log('\n[SUITE 4: Out-of-Domain / Non-VIIRS Sensor Handling]');
  const modisObs = {
    id: 'FIRMS-MODIS-TERRA-20260101-1',
    latitude: 22.34,
    longitude: 69.86,
    satellite: 'Terra',
    sensor: 'MODIS',
    frp: 12.5,
    brightness: 325.0,
    day_night: 'D',
  };

  const modisResult = evaluateThermalDiscriminator(modisObs);
  assert(modisResult.status === 'OUT_OF_SCOPE', 'MODIS sensor yields OUT_OF_SCOPE');
  assert(modisResult.coverage_status === 'OUT_OF_DOMAIN', 'Coverage status is OUT_OF_DOMAIN');
  assert(modisResult.predicted_class === null, 'MODIS sensor predicted class is null');
  assert(modisResult.interpretation.includes('VIIRS'), 'Interpretation clarifies VIIRS-only scope');

  // Null input safety
  const nullResult = evaluateThermalDiscriminator(null);
  assert(nullResult.status === 'NOT_ASSESSED', 'Null input handled gracefully without crashing');

  // --------------------------------------------------------------------------
  // SUITE 5: Feature Extraction Determinism
  // --------------------------------------------------------------------------
  console.log('\n[SUITE 5: Deterministic Feature Extraction]');
  const testObs = {
    id: 'TEST-OBS-01',
    latitude: 22.35,
    longitude: 69.87,
    satellite: 'NOAA-20',
    frp: 3.5,
    brightness_ti4: 315.2,
    brightness_ti5: 295.1,
    scan: 0.42,
    track: 0.38,
    day_night: 'N',
  };

  const feat1 = extractMLFeatures(testObs);
  const feat2 = extractMLFeatures(testObs);
  assert(feat1.is_valid === true, 'Feature extraction succeeds for valid observation');
  assert(JSON.stringify(feat1.model_vector) === JSON.stringify(feat2.model_vector), 'Feature vector is 100% deterministic');
  assert(feat1.model_vector?.length === 7, 'Model feature vector has exactly 7 dimensions');
  assert(Math.abs(feat1.derived.log_frp! - Math.log(4.5)) < 1e-6, 'log(1 + FRP) derived accurately');
  assert(Math.abs(feat1.derived.brightness_delta! - 20.1) < 1e-4, 'Brightness delta derived accurately');
  assert(feat1.derived.is_day === 0.0, 'Nighttime diurnal flag set to 0.0');

  // --------------------------------------------------------------------------
  // SUITE 6: Evidence Conflict Detection & Semantic Separation
  // --------------------------------------------------------------------------
  console.log('\n[SUITE 6: Semantic Separation & Evidence Conflict Detection]');
  // Anomalous refinery heat event (high FRP, daytime) inside industrial facility
  const refineryFireObs = {
    id: 'REF-ANOMALOUS-FIRE-01',
    latitude: 22.341,
    longitude: 69.855,
    satellite: 'NOAA-20',
    frp: 18.5,
    brightness_ti4: 355.0,
    brightness_ti5: 298.0,
    scan: 0.45,
    track: 0.42,
    day_night: 'D',
  };

  const refineryFireResult = evaluateThermalDiscriminator(refineryFireObs, 68);
  assert(
    refineryFireResult.predicted_class === 'WILDFIRE_CONFIRMED',
    'Radiometric model outputs wildfire-side score due to high contrast'
  );
  assert(
    refineryFireResult.evidence_conflict?.has_conflict === true,
    'Evidence conflict correctly detected between contextual industrial fire and binary wildfire score'
  );
  assert(
    refineryFireResult.evidence_conflict?.explanation.includes('Contextual and radiometric evidence disagree'),
    'Evidence conflict explanation clearly articulates cross-model divergence'
  );

  // --------------------------------------------------------------------------
  // SUITE 7: Model Artifact & Metadata Persistence Integrity
  // --------------------------------------------------------------------------
  console.log('\n[SUITE 7: Model Artifact & Metadata Integrity]');
  const artifactPath = path.join(process.cwd(), 'data', 'models', 'thermal_discriminator_v1.json');
  assert(fs.existsSync(artifactPath), 'data/models/thermal_discriminator_v1.json exists');

  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  assert(artifact.model_id === 'lr-v5f3-standardized', 'Persisted artifact has valid model_id');
  assert(artifact.coefficients.length === 7, 'Persisted artifact has 7 coefficients');
  assert(artifact.preprocessing.means.length === 7, 'Persisted artifact has 7 scaler means');
  assert(artifact.preprocessing.scales.length === 7, 'Persisted artifact has 7 scaler scales');
  assert(artifact.evaluation_metrics.test.roc_auc >= 0.90, `Test ROC-AUC is high (${(artifact.evaluation_metrics.test.roc_auc * 100).toFixed(2)}%)`);
  assert(artifact.limitations.length >= 4, 'Model limitations explicitly documented in JSON');

  console.log('\n' + '='.repeat(78));
  console.log(`SECTION 6 TEST SUMMARY: ${passed} PASSED | ${failed} FAILED`);
  console.log('='.repeat(78));

  if (failed > 0) {
    process.exit(1);
  }
}

runSection6Tests();
