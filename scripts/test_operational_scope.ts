// ============================================================================
// ThermalSentinel — Operational Geographic Scope Test Suite (Day 2A.2)
//
// Rigorously tests the Indian operational domain architecture:
//   A. Indian FIRMS observation -> IN_SCOPE
//   B. Known non-India observation -> OUT_OF_SCOPE
//   C. India boundary edge behavior (North, South, East, West borders)
//   D. Out-of-scope observation is not facility-associated with Indian facilities
//   E. Production operational corpus contains only in-scope observations
//   F. US research/reference records remain accessible to dedicated research/test paths
//   G. Jamnagar remains IN_SCOPE
//   H. Vadinar remains IN_SCOPE
//   I. Rural Maharashtra remains IN_SCOPE
//   J. No hardcoded Jamnagar/Maharashtra geographic special cases
//   K. Source provenance remains preserved
//   L. Unique-observation deduplication remains unchanged
// ============================================================================

import {
  evaluateOperationalScope,
  PRODUCTION_OPERATIONAL_SCOPE,
} from '../server/operationalScope.js';
import {
  processFirmsObservation,
  buildBayesianInferenceInput,
} from '../server/firmsProcessor.js';
import { MONITORED_FACILITIES } from '../server/facilities.js';
import { buildFirmsPhysicalObservationKey } from './audit_firms_deduplication.js';
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

export function runOperationalScopeTestSuite() {
  console.log('='.repeat(80));
  console.log('THERMALSENTINEL — OPERATIONAL GEOGRAPHIC SCOPE TEST SUITE (DAY 2A.2)');
  console.log('='.repeat(80));

  // --------------------------------------------------------------------------
  // TEST A: Indian FIRMS Observation -> IN_SCOPE
  // --------------------------------------------------------------------------
  console.log('\n[TEST A: Indian FIRMS Observation -> IN_SCOPE]');
  {
    const indiaObs = {
      latitude: 22.3598,
      longitude: 69.8642,
      frp: 3.5,
      acquisition_time: '2026-03-15T21:30:00Z',
    };

    const scope = evaluateOperationalScope(indiaObs.latitude, indiaObs.longitude);
    assert(scope.is_in_scope === true, 'Indian coordinate is marked is_in_scope: true');
    assert(scope.scope_status === 'IN_SCOPE', 'Scope status is IN_SCOPE');
    assert(scope.country_code === 'IN', 'Country code is IN');
    assert(scope.country_name === 'India', 'Country name is India');

    const res = processFirmsObservation(indiaObs);
    assert(res.processing_status === 'SUCCESS', 'Processing status is SUCCESS for in-scope observation');
    assert(res.derived_context.operational_scope?.is_in_scope === true, 'Derived context operational scope is in-scope');
  }

  // --------------------------------------------------------------------------
  // TEST B: Known Non-India Observation -> OUT_OF_SCOPE
  // --------------------------------------------------------------------------
  console.log('\n[TEST B: Known Non-India Observation -> OUT_OF_SCOPE]');
  {
    // US Cedar Creek wildfire coordinates (Oregon, USA: 43.88°N, -122.04°W)
    const usWildfireObs = {
      latitude: 43.8820,
      longitude: -122.0430,
      frp: 85.4,
      acquisition_time: '2022-09-11T19:45:00Z',
      satellite: 'VIIRS-SNPP',
      provenance: 'REAL_FIRMS' as const,
    };

    const scope = evaluateOperationalScope(usWildfireObs.latitude, usWildfireObs.longitude, usWildfireObs.provenance);
    assert(scope.is_in_scope === false, 'US wildfire coordinate is marked is_in_scope: false');
    assert(scope.scope_status === 'OUT_OF_SCOPE', 'Scope status is OUT_OF_SCOPE');
    assert(scope.exclusion_reason !== undefined && scope.exclusion_reason.includes('outside the operational domain'), 'Exclusion reason clearly documented');

    const res = processFirmsObservation(usWildfireObs);
    assert(res.processing_status === 'OUT_OF_SCOPE', 'Processor marks non-India observation as OUT_OF_SCOPE');
    assert(res.source_observation.latitude === 43.882, 'Source measurements preserved intact');
    assert(res.source_observation.frp === 85.4, 'Source FRP preserved intact (not zeroed)');
  }

  // --------------------------------------------------------------------------
  // TEST C: India Boundary Edge Behavior
  // --------------------------------------------------------------------------
  console.log('\n[TEST C: India Boundary Edge Behavior]');
  {
    // Southern edge: Kanyakumari (8.08°N, 77.53°E) -> IN_SCOPE
    const southIn = evaluateOperationalScope(8.08, 77.53);
    assert(southIn.is_in_scope === true, 'Southern edge (Kanyakumari 8.08°N) is IN_SCOPE');

    // Outside South: Indian Ocean (4.50°N, 77.53°E) -> OUT_OF_SCOPE
    const southOut = evaluateOperationalScope(4.50, 77.53);
    assert(southOut.is_in_scope === false, 'Equatorial Indian Ocean (4.50°N) is OUT_OF_SCOPE');

    // Northern edge: Kashmir (34.08°N, 74.79°E) -> IN_SCOPE
    const northIn = evaluateOperationalScope(34.08, 74.79);
    assert(northIn.is_in_scope === true, 'Northern edge (Kashmir 34.08°N) is IN_SCOPE');

    // Outside North: Central Asia (39.50°N, 74.79°E) -> OUT_OF_SCOPE
    const northOut = evaluateOperationalScope(39.50, 74.79);
    assert(northOut.is_in_scope === false, 'Central Asia (39.50°N) is OUT_OF_SCOPE');

    // Eastern edge: Assam (27.47°N, 94.91°E) -> IN_SCOPE
    const eastIn = evaluateOperationalScope(27.47, 94.91);
    assert(eastIn.is_in_scope === true, 'Eastern edge (Assam 94.91°E) is IN_SCOPE');

    // Outside East: Southeast Asia (27.47°N, 102.50°E) -> OUT_OF_SCOPE
    const eastOut = evaluateOperationalScope(27.47, 102.50);
    assert(eastOut.is_in_scope === false, 'Southeast Asia (102.50°E) is OUT_OF_SCOPE');

    // Western edge: Gujarat coast (22.36°N, 69.05°E) -> IN_SCOPE
    const westIn = evaluateOperationalScope(22.36, 69.05);
    assert(westIn.is_in_scope === true, 'Western edge (Gujarat 69.05°E) is IN_SCOPE');

    // Outside West: Arabian Sea off Oman (22.36°N, 62.00°E) -> OUT_OF_SCOPE
    const westOut = evaluateOperationalScope(22.36, 62.00);
    assert(westOut.is_in_scope === false, 'Arabian Sea west of boundary (62.00°E) is OUT_OF_SCOPE');
  }

  // --------------------------------------------------------------------------
  // TEST D: Out-of-Scope Observation is NOT Facility-Associated
  // --------------------------------------------------------------------------
  console.log('\n[TEST D: Out-of-Scope Non-Association]');
  {
    const outOfScopeObs = {
      latitude: 51.5074, // London, UK
      longitude: -0.1278,
      frp: 12.0,
      acquisition_time: '2026-03-01T12:00:00Z',
    };

    const res = processFirmsObservation(outOfScopeObs);
    assert(res.processing_status === 'OUT_OF_SCOPE', 'Processing status is OUT_OF_SCOPE');
    assert(res.derived_context.is_associated === false, 'is_associated is strictly false');
    assert(res.derived_context.associated_facility === null, 'associated_facility is strictly null');
    assert(res.derived_context.spatial_association === 'UNASSOCIATED', 'spatial_association is UNASSOCIATED');
    assert(res.derived_context.baseline_status === 'NONE', 'baseline_status is NONE');
    assert(res.derived_context.behavioural_status === 'NOT_ASSESSED', 'behavioural_status is NOT_ASSESSED');
    assert(res.evidence_availability.facility_context === 'OUT_OF_SCOPE', 'facility_context availability is OUT_OF_SCOPE');
    assert(res.evidence_availability.behavioural_baseline === 'OUT_OF_SCOPE', 'behavioural_baseline availability is OUT_OF_SCOPE');
    assert(res.evidence_availability.ml_advisory === 'OUT_OF_SCOPE', 'ml_advisory availability is OUT_OF_SCOPE');
  }

  // --------------------------------------------------------------------------
  // TEST E: Production Corpus Contains Only In-Scope Observations
  // --------------------------------------------------------------------------
  console.log('\n[TEST E: Production Corpus In-Scope Isolation]');
  {
    const processedDir = path.join(process.cwd(), 'data', 'processed');
    let inScopeCount = 0;
    let outOfScopeCount = 0;

    if (fs.existsSync(processedDir)) {
      for (const file of fs.readdirSync(processedDir).filter(f => f.endsWith('_historical_observations.json'))) {
        const raw = JSON.parse(fs.readFileSync(path.join(processedDir, file), 'utf-8'));
        const list = Array.isArray(raw) ? raw : (raw.observations || []);
        for (const item of list) {
          const scope = evaluateOperationalScope(item.latitude, item.longitude);
          if (scope.is_in_scope) inScopeCount++;
          else outOfScopeCount++;
        }
      }
    }

    assert(inScopeCount === 379, `Production processed historical archives contain exactly 379 in-scope Indian observations (actual: ${inScopeCount})`);
    assert(outOfScopeCount === 0, `Production processed historical archives contain 0 out-of-scope records (actual: ${outOfScopeCount})`);
  }

  // --------------------------------------------------------------------------
  // TEST F: US Research Records Remain Accessible via Dedicated Research Mode
  // --------------------------------------------------------------------------
  console.log('\n[TEST F: Research Reference Mode Accessibility]');
  {
    const usObs = {
      latitude: 47.7650, // Bolt Creek Wildfire, WA, USA
      longitude: -121.3420,
      frp: 45.2,
      acquisition_time: '2022-09-11T18:00:00Z',
      satellite: 'VIIRS-SNPP',
      provenance: 'CONTROLLED_TEST' as const,
    };

    // 1. Process in default production mode -> OUT_OF_SCOPE / RESEARCH_REFERENCE_ONLY
    const prodRes = processFirmsObservation(usObs);
    assert(prodRes.processing_status === 'OUT_OF_SCOPE', 'Default production mode tags as OUT_OF_SCOPE');
    assert(prodRes.derived_context.operational_scope?.scope_status === 'RESEARCH_REFERENCE_ONLY', 'Provenance flags as RESEARCH_REFERENCE_ONLY');

    // 2. Process in research mode (operationalScope disabled) -> SUCCESS
    const researchRes = processFirmsObservation(usObs, { operationalScope: null });
    assert(researchRes.processing_status === 'SUCCESS', 'Research mode (operationalScope: null) allows full evaluation');
    assert(researchRes.source_observation.frp === 45.2, 'Research observation measurements preserved');
  }

  // --------------------------------------------------------------------------
  // TEST G: Jamnagar Remains IN_SCOPE
  // --------------------------------------------------------------------------
  console.log('\n[TEST G: Jamnagar IN_SCOPE]');
  {
    const jamObs = {
      latitude: 22.3685,
      longitude: 69.8690,
      frp: 2.32,
      acquisition_time: '2026-02-25T21:32:00Z',
      satellite: 'VIIRS-NOAA20',
      day_night: 'N' as const,
    };

    const res = processFirmsObservation(jamObs);
    assert(res.processing_status === 'SUCCESS', 'Jamnagar observation processes with SUCCESS');
    assert(res.derived_context.operational_scope?.is_in_scope === true, 'Jamnagar is IN_SCOPE');
    assert(res.derived_context.associated_facility?.id === 'FAC-GUJ-JAMNAGAR-01', 'Associated with Jamnagar facility');
    assert(res.derived_context.spatial_association === 'KNOWN_THERMAL_ZONE', 'Inside known thermal zone');
  }

  // --------------------------------------------------------------------------
  // TEST H: Vadinar Remains IN_SCOPE
  // --------------------------------------------------------------------------
  console.log('\n[TEST H: Vadinar IN_SCOPE]');
  {
    const vadObs = {
      latitude: 22.4042,
      longitude: 69.7125,
      frp: 4.30,
      acquisition_time: '2026-03-01T21:15:00Z',
      satellite: 'VIIRS-NOAA20',
      day_night: 'N' as const,
    };

    const res = processFirmsObservation(vadObs);
    assert(res.processing_status === 'SUCCESS', 'Vadinar observation processes with SUCCESS');
    assert(res.derived_context.operational_scope?.is_in_scope === true, 'Vadinar is IN_SCOPE');
    assert(res.derived_context.associated_facility?.id === 'FAC-GUJ-VADINAR-02', 'Associated with Vadinar facility');
    assert(res.derived_context.baseline_status === 'EMPIRICAL', 'Empirical baseline loaded for Vadinar');
  }

  // --------------------------------------------------------------------------
  // TEST I: Rural Maharashtra Remains IN_SCOPE
  // --------------------------------------------------------------------------
  console.log('\n[TEST I: Rural Maharashtra IN_SCOPE]');
  {
    const mahObs = {
      latitude: 19.7515,
      longitude: 75.7139,
      frp: 12.4,
      acquisition_time: '2026-03-10T14:30:00Z',
      day_night: 'D' as const,
      satellite: 'VIIRS-SNPP',
    };

    const res = processFirmsObservation(mahObs);
    assert(res.processing_status === 'SUCCESS', 'Rural Maharashtra hotspot processes with SUCCESS');
    assert(res.derived_context.operational_scope?.is_in_scope === true, 'Maharashtra is IN_SCOPE');
    assert(res.derived_context.is_associated === false, 'Recognized as unassociated regional hotspot');
    assert(res.derived_context.spatial_association === 'UNASSOCIATED', 'spatial_association is UNASSOCIATED');
  }

  // --------------------------------------------------------------------------
  // TEST J: No Hardcoded Facility / Regional Special Cases
  // --------------------------------------------------------------------------
  console.log('\n[TEST J: No Hardcoded Facility Special Cases]');
  {
    // Test points across all 4 quadrants of India (Odisha, Tamil Nadu, Punjab, Assam)
    const testPoints = [
      { name: 'Odisha Industrial Belt', lat: 20.9517, lon: 85.0985 },
      { name: 'Tamil Nadu Coast', lat: 11.7480, lon: 79.7714 },
      { name: 'Punjab Farmland', lat: 30.7333, lon: 76.7794 },
      { name: 'Assam Valley', lat: 26.2006, lon: 92.9376 },
    ];

    for (const pt of testPoints) {
      const scope = evaluateOperationalScope(pt.lat, pt.lon);
      assert(scope.is_in_scope === true, `${pt.name} evaluated generically as IN_SCOPE without branch`);
    }
  }

  // --------------------------------------------------------------------------
  // TEST K: Source Provenance Remains Preserved
  // --------------------------------------------------------------------------
  console.log('\n[TEST K: Source Provenance Preservation]');
  {
    const realFirmsObs = {
      latitude: 22.3685,
      longitude: 69.8690,
      frp: 2.32,
      acquisition_time: '2026-02-25T21:32:00Z',
      provenance: 'REAL_FIRMS' as const,
    };
    const resReal = processFirmsObservation(realFirmsObs);
    assert(resReal.source_observation.provenance === 'REAL_FIRMS', 'REAL_FIRMS provenance preserved');
    assert(resReal.source_observation.is_real_data === true, 'is_real_data is true');

    const controlledObs = {
      latitude: 22.3685,
      longitude: 69.8690,
      frp: 2.32,
      acquisition_time: '2026-02-25T21:32:00Z',
      provenance: 'CONTROLLED_TEST' as const,
    };
    const resCtrl = processFirmsObservation(controlledObs);
    assert(resCtrl.source_observation.provenance === 'CONTROLLED_TEST', 'CONTROLLED_TEST provenance preserved');
    assert(resCtrl.source_observation.is_real_data === false, 'is_real_data is false');
  }

  // --------------------------------------------------------------------------
  // TEST L: Unique-Observation Deduplication Remains Invariant
  // --------------------------------------------------------------------------
  console.log('\n[TEST L: Unique-Observation Deduplication Invariance]');
  {
    // Verify that the physical identity key formula produces deterministic unique keys
    const k1 = buildFirmsPhysicalObservationKey('VIIRS-NOAA20', '2026-01-01T21:32:00Z', 22.33776, 69.86501, 2.06);
    const k2 = buildFirmsPhysicalObservationKey('VIIRS-NOAA20', '2026-01-01T21:32:00Z', 22.33776, 69.86501, 2.06);
    const k3 = buildFirmsPhysicalObservationKey('VIIRS-SNPP', '2026-01-01T21:32:00Z', 22.33776, 69.86501, 2.06);

    assert(k1 === k2, 'Identical observations generate identical physical key');
    assert(k1 !== k3, 'Different satellites generate distinct physical keys');
  }

  console.log('\n' + '='.repeat(80));
  console.log(`OPERATIONAL SCOPE TEST SUITE RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('='.repeat(80));

  if (failed > 0) {
    process.exit(1);
  }
}

// Execute if run directly
runOperationalScopeTestSuite();
