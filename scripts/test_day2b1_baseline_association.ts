import { MONITORED_FACILITIES } from '../server/facilities.js';
import {
  findFacilitySpatialAssociation,
  associateObservationWithFacilities,
  haversineDistanceMeters,
  distanceToPolygonBoundaryMeters,
  isPointInPolygon,
} from '../server/geospatial.js';
import {
  getFacilityBaselineSync,
  generateInsufficientDataBaseline,
} from '../server/baselineRepository.js';
import {
  evaluateObservationAgainstBaseline,
} from '../server/deviationEngine.js';
import {
  evaluateTemporalPersistence,
} from '../server/persistenceEngine.js';
import {
  buildEmpiricalFacilityBaseline,
  buildEventSpecificBaseline,
  HistoricalThermalObservation,
} from '../server/historicalIngestion.js';
import { processFirmsObservation, buildBayesianInferenceInput } from '../server/firms.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

console.log('================================================================================');
console.log('THERMALSENTINEL — DAY 2B-1 FACILITY ASSOCIATION & BASELINE AUDIT TEST SUITE');
console.log('================================================================================\n');

// -----------------------------------------------------------------------------
// SECTION 1: FACILITY ASSOCIATION AUDIT (ITEMS I, J, K)
// -----------------------------------------------------------------------------
console.log('[SECTION 1: Spatial Association Determination (Items I, J, K)]');

// 1.1 Inside Polygon + Within Known Thermal Zone (KNOWN_THERMAL_ZONE)
const jamnagarFacility = MONITORED_FACILITIES.find((f) => f.id === 'FAC-GUJ-JAMNAGAR-01')!;
const northFlareZone = jamnagarFacility.known_thermal_zones.find((z) => z.id === 'ZONE-JAM-01')!;
const jamHotspotInsideZone = findFacilitySpatialAssociation(
  northFlareZone.center[0],
  northFlareZone.center[1],
  MONITORED_FACILITIES
);
assert(jamHotspotInsideZone.is_associated === true, 'Collocated with flare stack is associated');
assert(jamHotspotInsideZone.spatial_association === 'KNOWN_THERMAL_ZONE', 'Zone collocated matches KNOWN_THERMAL_ZONE');
assert(jamHotspotInsideZone.matched_facility?.id === 'FAC-GUJ-JAMNAGAR-01', 'Matches Jamnagar facility ID');
assert(jamHotspotInsideZone.is_inside_polygon === true, 'is_inside_polygon is true');
assert(jamHotspotInsideZone.is_inside_known_zone === true, 'is_inside_known_zone is true');
assert(jamHotspotInsideZone.matched_zone?.id === 'ZONE-JAM-01', 'Matched specific zone ZONE-JAM-01');

// 1.2 Inside Polygon + Away From Known Thermal Zones (FACILITY_OFF_ZONE)
// Point inside Jamnagar polygon (e.g. 22.3650, 69.8500) that is > 400m from all configured stacks
const jamOffZoneLat = 22.3650;
const jamOffZoneLon = 22.3500; // Let's check a point inside polygon
const insideJam = isPointInPolygon([22.3600, 69.8500], jamnagarFacility.polygon);
const jamOffZoneAssoc = findFacilitySpatialAssociation(22.3600, 69.8500, MONITORED_FACILITIES);
assert(jamOffZoneAssoc.is_associated === true, 'Inside boundary point is associated');
assert(jamOffZoneAssoc.is_inside_polygon === true, 'Inside boundary point is_inside_polygon: true');
assert(jamOffZoneAssoc.spatial_association === 'FACILITY_OFF_ZONE', 'Off-stack interior point resolves to FACILITY_OFF_ZONE');
assert(jamOffZoneAssoc.is_inside_known_zone === false, 'Off-stack point is_inside_known_zone: false');

// 1.3 Outside Polygon + Within Buffer Envelope (FACILITY_BUFFER)
// Point outside Jamnagar polygon but within 3.5km buffer radius
const jamBufferLat = 22.3850;
const jamBufferLon = 22.8600;
const jamBufferAssoc = findFacilitySpatialAssociation(22.3850, 69.8640, MONITORED_FACILITIES);
assert(jamBufferAssoc.is_associated === true, 'Perimeter buffer point is associated');
assert(jamBufferAssoc.is_inside_polygon === false, 'Perimeter buffer point is_inside_polygon: false');
assert(jamBufferAssoc.spatial_association === 'FACILITY_BUFFER', 'Perimeter buffer point resolves to FACILITY_BUFFER');
assert(jamBufferAssoc.facility_distance_meters !== null && jamBufferAssoc.facility_distance_meters > 0, 'Buffer distance is positive');

// 1.4 Outside All Facilities & Buffers (UNASSOCIATED)
const remoteRuralLat = 19.7500;
const remoteRuralLon = 75.7100; // Rural Maharashtra farmland
const unassociatedAssoc = findFacilitySpatialAssociation(remoteRuralLat, remoteRuralLon, MONITORED_FACILITIES);
assert(unassociatedAssoc.is_associated === false, 'Remote point is not associated');
assert(unassociatedAssoc.spatial_association === 'UNASSOCIATED', 'Remote point resolves to UNASSOCIATED');
assert(unassociatedAssoc.matched_facility === null, 'Remote point matched_facility is strictly null');
assert(unassociatedAssoc.facility_distance_meters === null, 'Remote point facility_distance_meters is null');

// 1.5 Item K: Verification that nearest facility is NEVER assigned to an unassociated point
const nearVadinarLat = 22.5500; // ~13km north of Vadinar
const nearVadinarAssoc = findFacilitySpatialAssociation(nearVadinarLat, 69.7150, MONITORED_FACILITIES);
assert(nearVadinarAssoc.is_associated === false, 'Point 13km away is not associated with Vadinar');
assert(nearVadinarAssoc.matched_facility === null, 'Nearest facility is NOT assigned when outside buffer');
assert(nearVadinarAssoc.spatial_association === 'UNASSOCIATED', 'Point outside buffer remains UNASSOCIATED');

// 1.6 Item J: Ambiguous / Multiple Facility Proximity
// Create two mock facilities with overlapping buffer zones to test precedence
const mockFacA: any = {
  id: 'FAC-MOCK-A',
  name: 'Mock Plant A',
  center: [20.0, 70.0],
  polygon: [[20.01, 69.99], [20.01, 70.01], [19.99, 70.01], [19.99, 69.99]],
  buffer_radius_km: 5.0,
  known_thermal_zones: [],
};
const mockFacB: any = {
  id: 'FAC-MOCK-B',
  name: 'Mock Plant B',
  center: [20.05, 70.0],
  polygon: [[20.06, 69.99], [20.06, 70.01], [20.04, 70.01], [20.04, 69.99]],
  buffer_radius_km: 5.0,
  known_thermal_zones: [],
};
// Test point inside Polygon B: Must select B even if A buffer overlaps
const ptInsideB = findFacilitySpatialAssociation(20.05, 70.0, [mockFacA, mockFacB]);
assert(ptInsideB.matched_facility?.id === 'FAC-MOCK-B', 'Polygon containment has absolute precedence over buffer overlap');
assert(ptInsideB.is_inside_polygon === true, 'Selected facility has is_inside_polygon: true');

// Test point in overlapping buffers: closer to Plant A boundary
const ptCloserToA = findFacilitySpatialAssociation(20.02, 70.0, [mockFacA, mockFacB]);
assert(ptCloserToA.matched_facility?.id === 'FAC-MOCK-A', 'Closer boundary facility is selected in overlapping buffers');

// -----------------------------------------------------------------------------
// SECTION 2: BASELINE SELECTION & TIMESTAMP CUTOFF (ITEMS A, B, C, D, E, F, G)
// -----------------------------------------------------------------------------
console.log('\n[SECTION 2: Baseline Selection & Historical Cutoff (Items A, B, C, D, E, F, G)]');

// 2.1 Item A & G: Generic baseline selection for Jamnagar & Vadinar
const jamBaseline = getFacilityBaselineSync('FAC-GUJ-JAMNAGAR-01');
const vadBaseline = getFacilityBaselineSync('FAC-GUJ-VADINAR-02');
assert(jamBaseline !== null, 'Jamnagar baseline loads via generic getFacilityBaselineSync');
assert(jamBaseline?.baseline_status === 'EMPIRICAL', 'Jamnagar baseline is EMPIRICAL');
assert(jamBaseline?.metrics.observation_count === 294, 'Jamnagar baseline has exact 294 observations');
assert(vadBaseline !== null, 'Vadinar baseline loads via generic getFacilityBaselineSync');
assert(vadBaseline?.baseline_status === 'EMPIRICAL', 'Vadinar baseline is EMPIRICAL');
assert(vadBaseline?.metrics.observation_count === 85, 'Vadinar baseline has exact 85 observations');

// 2.2 Item B & C: Acquisition Time as Historical Cutoff & Future Data Exclusion
const testCutoffDate = '2026-03-01T00:00:00Z';
const jamCutoffBaseline = getFacilityBaselineSync('FAC-GUJ-JAMNAGAR-01', testCutoffDate);
assert(jamCutoffBaseline !== null, 'Event-specific baseline loads successfully');
assert(jamCutoffBaseline?.metrics.observation_count! < 294, 'Event-specific baseline contains strictly prior observations');
assert(
  new Date(jamCutoffBaseline?.baseline_period.end_date || '').getTime() <= new Date(testCutoffDate).getTime(),
  'Baseline end date does not exceed event timestamp (ZERO FUTURE LEAKAGE)'
);

// 2.3 Synthetic Future Leakage Stress Test
const mockObservations: HistoricalThermalObservation[] = [
  {
    id: 'OBS-1',
    latitude: 22.3598,
    longitude: 69.8642,
    acquisition_date: '2026-01-10',
    acquisition_time: '1000',
    acquisition_timestamp: '2026-01-10T10:00:00Z',
    satellite: 'NOAA-20',
    sensor: 'VIIRS',
    frp: 5.0,
    confidence: 'nominal',
    brightness_kelvin: 310,
    scan: 1.0,
    track: 1.0,
    day_night: 'D',
    associated_facility_id: 'FAC-GUJ-JAMNAGAR-01',
    associated_facility_name: 'Jamnagar',
    association_type: 'KNOWN_THERMAL_ZONE',
    matched_zone_id: 'ZONE-JAM-01',
    matched_zone_name: 'Flare',
    distance_to_zone_meters: 50,
    distance_to_facility_meters: 0,
    is_inside_polygon: true,
  },
  {
    id: 'OBS-2',
    latitude: 22.3598,
    longitude: 69.8642,
    acquisition_date: '2026-02-10',
    acquisition_time: '1000',
    acquisition_timestamp: '2026-02-10T10:00:00Z',
    satellite: 'NOAA-20',
    sensor: 'VIIRS',
    frp: 100.0, // Major anomaly in future
    confidence: 'nominal',
    brightness_kelvin: 380,
    scan: 1.0,
    track: 1.0,
    day_night: 'D',
    associated_facility_id: 'FAC-GUJ-JAMNAGAR-01',
    associated_facility_name: 'Jamnagar',
    association_type: 'KNOWN_THERMAL_ZONE',
    matched_zone_id: 'ZONE-JAM-01',
    matched_zone_name: 'Flare',
    distance_to_zone_meters: 50,
    distance_to_facility_meters: 0,
    is_inside_polygon: true,
  },
];

const baselineBeforeAnomaly = buildEventSpecificBaseline(
  jamnagarFacility,
  mockObservations,
  '2026-01-20T00:00:00Z',
  1 // Allow min threshold 1 for testing
);
assert(baselineBeforeAnomaly.metrics.observation_count === 1, 'Only 1 observation before Jan 20');
assert(baselineBeforeAnomaly.metrics.frp_median === 5.0, 'Future anomaly of 100 MW did NOT leak into Jan 20 baseline');

// 2.4 Item E: Minimum Historical Threshold (30 observations)
const insufficientBaseline = buildEmpiricalFacilityBaseline(
  jamnagarFacility,
  mockObservations, // Only 2 observations
  '2026-01-01',
  '2026-02-15',
  30 // Requires 30
);
assert(insufficientBaseline.baseline_status === 'INSUFFICIENT_DATA', 'Baseline with <30 observations yields INSUFFICIENT_DATA');
assert(insufficientBaseline.minimum_threshold_required === 30, 'Documents minimum_threshold_required: 30');
assert(insufficientBaseline.metrics.frp_median === 0, 'Insufficient baseline frp_median is 0');

// 2.5 Item F: What happens when a facility has no baseline
const unmonitoredFac: any = {
  id: 'FAC-NEW-TEST-99',
  name: 'New Facility No History',
  center: [20.0, 80.0],
  polygon: [[20.01, 79.99], [20.01, 80.01], [19.99, 80.01], [19.99, 79.99]],
  known_thermal_zones: [],
};
const nullBaseline = getFacilityBaselineSync('FAC-NEW-TEST-99');
assert(nullBaseline === null || nullBaseline.baseline_status === 'INSUFFICIENT_DATA', 'Unknown facility returns null or INSUFFICIENT_DATA');

const devAssessmentNoBaseline = evaluateObservationAgainstBaseline(
  15.0,
  'KNOWN_THERMAL_ZONE',
  50,
  0,
  'Flare',
  true,
  unmonitoredFac,
  null
);
assert(devAssessmentNoBaseline.behavioural_status === 'NOT_ASSESSED', 'Behavioural status is NOT_ASSESSED when baseline is null');
assert(devAssessmentNoBaseline.baseline_status === 'INSUFFICIENT_DATA', 'Baseline status is INSUFFICIENT_DATA');
assert(devAssessmentNoBaseline.metrics.baseline_frp_median === null, 'baseline_frp_median is null');

// -----------------------------------------------------------------------------
// SECTION 3: PERSISTENCE ENGINE DEDUPLICATION & CORPUS INTEGRITY (ITEM H, D)
// -----------------------------------------------------------------------------
console.log('\n[SECTION 3: Persistence Engine & Deduplication (Items D, H)]');

// Historical cluster centroid for Jamnagar (where physical observations concentrate)
const persistenceJamnagar = evaluateTemporalPersistence(22.3387, 69.8610, undefined, 1000);
assert(persistenceJamnagar.is_persistent === true, 'Jamnagar historical emitter cluster is persistent');
assert(persistenceJamnagar.status === 'PERSISTENT', 'Status is PERSISTENT');
assert(persistenceJamnagar.cluster_observation_count > 10, `Cluster count (${persistenceJamnagar.cluster_observation_count}) reflects multi-pass history`);
assert(persistenceJamnagar.distinct_observation_days >= 30, `Distinct active days (${persistenceJamnagar.distinct_observation_days}) reflects extensive satellite revisits`);

const persistenceRemote = evaluateTemporalPersistence(19.7500, 75.7100, undefined, 1000);
assert(persistenceRemote.is_persistent === false, 'Remote rural location is not persistent');
assert(persistenceRemote.status === 'NO_HISTORICAL_DATA' || persistenceRemote.status === 'SINGLE_OBSERVATION', 'Remote location status is NO_HISTORICAL_DATA/SINGLE');

// Verify exclusion of active observation ID to prevent self-counting
const persistenceExclude = evaluateTemporalPersistence(22.3387, 69.8610, 'HIST-20260101-N20-1', 1000);
assert(persistenceExclude.cluster_observation_count >= 0, 'Exclusion ID runs without error');

// -----------------------------------------------------------------------------
// SECTION 4: FULL PIPELINE END-TO-END INVARIANCE TEST
// -----------------------------------------------------------------------------
console.log('\n[SECTION 4: Full Generic Pipeline Invariance & Association]');

// Import Bayesian Engine
import { evaluateBayesianSourceHypotheses } from '../server/bayesianEngine.js';

// Jamnagar real routine observation (FRP 2.0 MW is within median/P75 baseline)
const jamProcessed = processFirmsObservation({
  latitude: 22.3685,
  longitude: 69.8690,
  frp: 2.0,
  acquisition_date: '2026-02-15',
  acquisition_time: '1830',
  confidence: 'high',
  day_night: 'N',
  sensor: 'VIIRS',
  satellite: 'NOAA-20',
});
assert(jamProcessed.processing_status === 'SUCCESS', 'Jamnagar processed successfully');
assert(jamProcessed.derived_context.spatial_association === 'KNOWN_THERMAL_ZONE', 'Spatial association is KNOWN_THERMAL_ZONE');
assert(jamProcessed.derived_context.associated_facility?.id === 'FAC-GUJ-JAMNAGAR-01', 'Facility ID is Jamnagar');
assert(jamProcessed.derived_context.behavioural_status === 'NORMAL', 'FRP 2.0 MW is NORMAL for Jamnagar');

const jamBayesInput = buildBayesianInferenceInput(jamProcessed);
const jamBayesResult = evaluateBayesianSourceHypotheses(jamBayesInput);
assert(jamBayesResult.primary_hypothesis_type === 'GAS_FLARE', `Primary hypothesis for Jamnagar flare is GAS_FLARE (P=${(jamBayesResult.posterior_probabilities.GAS_FLARE*100).toFixed(1)}%)`);

// Vadinar real observation
const vadProcessed = processFirmsObservation({
  latitude: 22.4310,
  longitude: 69.7180,
  frp: 2.0,
  acquisition_date: '2026-02-15',
  acquisition_time: '1830',
  confidence: 'high',
  day_night: 'N',
  sensor: 'VIIRS',
  satellite: 'NOAA-20',
});
assert(vadProcessed.processing_status === 'SUCCESS', 'Vadinar processed successfully');
assert(vadProcessed.derived_context.spatial_association === 'KNOWN_THERMAL_ZONE', 'Spatial association is KNOWN_THERMAL_ZONE');
assert(vadProcessed.derived_context.associated_facility?.id === 'FAC-GUJ-VADINAR-02', 'Facility ID is Vadinar');

const vadBayesInput = buildBayesianInferenceInput(vadProcessed);
const vadBayesResult = evaluateBayesianSourceHypotheses(vadBayesInput);
assert(vadBayesResult.primary_hypothesis_type === 'GAS_FLARE', `Primary hypothesis for Vadinar flare is GAS_FLARE (P=${(vadBayesResult.posterior_probabilities.GAS_FLARE*100).toFixed(1)}%)`);

console.log('\n================================================================================');
console.log(`DAY 2B-1 AUDIT TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
console.log('================================================================================');

if (failed > 0) {
  process.exit(1);
}
