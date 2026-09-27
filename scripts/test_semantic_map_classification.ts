import { strict as assert } from 'assert';
import { getCanonicalAssessment } from '../src/services/canonicalAssessment';
import { ThermalEvent } from '../src/types';
import { INITIAL_FACILITIES } from '../src/data/facilities';

console.log('============================================================');
console.log('DAY 2J: CANONICAL MAP SEMANTIC REFACTOR TEST SUITE');
console.log('============================================================\n');

// 1. Test Unassociated High-Intensity Observation -> ANOMALOUS, RED, UNASSOCIATED, Baseline NOT_ASSESSED
const unassocAnomalousEvent: ThermalEvent = {
  id: 'HIST-20260109-N20-20',
  latitude: 22.8541,
  longitude: 70.1245,
  acquisitionTime: '2026-01-09T08:30:00Z',
  satellite: 'VIIRS-NOAA20',
  frp: 35.8,
  brightness: 372.4,
  confidence: 'high',
  dayNight: 'D',
  facilityId: null,
  facilityDistanceMeters: 14500,
  landCoverType: 'barren',
  spatialAssociation: 'UNASSOCIATED',
  behaviouralStatus: 'NOT_ASSESSED',
  deviationStatus: 'NOT_ASSESSED',
  isAmbiguous: false,
  uncertaintyDetails: 'Regional satellite thermal observation',
  isInsideKnownZone: false,
  sourceHypotheses: {
    gas_flare: 0.05,
    industrial_fire: 0.15,
    agricultural_burn: 0.50,
    wildfire: 0.25,
    mining_smelter: 0.02,
    other_thermal: 0.03,
  },
};

const assess1 = getCanonicalAssessment(unassocAnomalousEvent, INITIAL_FACILITIES);
console.log('Test 1: Unassociated High-FRP Event (35.8 MW)');
console.log('  - Observation Classification:', assess1.observationClassification);
console.log('  - Facility Association:', assess1.facilityAssociation);
console.log('  - Baseline Status:', assess1.baselineStatus);
console.log('  - Marker Fill Color:', assess1.markerFillColor);
console.log('  - Title:', assess1.facilityName);

assert.equal(assess1.observationClassification, 'ANOMALOUS', 'High FRP unassociated event must be classified as ANOMALOUS');
assert.equal(assess1.facilityAssociation, 'UNASSOCIATED', 'Facility association must be UNASSOCIATED');
assert.equal(assess1.baselineStatus, 'NOT_ASSESSED', 'Facility baseline must be NOT_ASSESSED');
assert.equal(assess1.markerFillColor, '#ef4444', 'Marker must be RED, not grey');
assert.notEqual(assess1.facilityName, 'Unassociated Regional Hotspot', 'Title must not be Unassociated Regional Hotspot');
console.log('  ✓ PASSED\n');

// 2. Test Unassociated Moderate Observation -> ELEVATED, AMBER, UNASSOCIATED
const unassocElevatedEvent: ThermalEvent = {
  id: 'HIST-20260109-N20-21',
  latitude: 23.1122,
  longitude: 71.4455,
  acquisitionTime: '2026-01-09T08:30:00Z',
  satellite: 'VIIRS-NOAA20',
  frp: 8.4,
  brightness: 342.1,
  confidence: 'nominal',
  dayNight: 'D',
  facilityId: null,
  facilityDistanceMeters: 25000,
  landCoverType: 'agricultural',
  spatialAssociation: 'UNASSOCIATED',
  behaviouralStatus: 'NOT_ASSESSED',
  deviationStatus: 'NOT_ASSESSED',
  isAmbiguous: false,
  uncertaintyDetails: 'Regional satellite thermal observation',
  isInsideKnownZone: false,
  sourceHypotheses: {
    gas_flare: 0.02,
    industrial_fire: 0.05,
    agricultural_burn: 0.70,
    wildfire: 0.20,
    mining_smelter: 0.01,
    other_thermal: 0.02,
  },
};

const assess2 = getCanonicalAssessment(unassocElevatedEvent, INITIAL_FACILITIES);
console.log('Test 2: Unassociated Moderate-FRP Event (8.4 MW)');
console.log('  - Observation Classification:', assess2.observationClassification);
console.log('  - Marker Fill Color:', assess2.markerFillColor);
assert.equal(assess2.observationClassification, 'ELEVATED', 'Moderate FRP unassociated event must be classified as ELEVATED');
assert.equal(assess2.markerFillColor, '#f59e0b', 'Marker must be AMBER');
console.log('  ✓ PASSED\n');

// 3. Test Unassociated Nominal Observation -> NORMAL, GREEN, UNASSOCIATED
const unassocNormalEvent: ThermalEvent = {
  id: 'HIST-20260109-N20-22',
  latitude: 21.9876,
  longitude: 72.3344,
  acquisitionTime: '2026-01-09T08:30:00Z',
  satellite: 'VIIRS-NOAA20',
  frp: 2.1,
  brightness: 320.5,
  confidence: 'nominal',
  dayNight: 'N',
  facilityId: null,
  facilityDistanceMeters: 18000,
  landCoverType: 'agricultural',
  spatialAssociation: 'UNASSOCIATED',
  behaviouralStatus: 'NOT_ASSESSED',
  deviationStatus: 'NOT_ASSESSED',
  isAmbiguous: false,
  uncertaintyDetails: 'Regional satellite thermal observation',
  isInsideKnownZone: false,
  sourceHypotheses: {
    gas_flare: 0.01,
    industrial_fire: 0.02,
    agricultural_burn: 0.85,
    wildfire: 0.10,
    mining_smelter: 0.01,
    other_thermal: 0.01,
  },
};

const assess3 = getCanonicalAssessment(unassocNormalEvent, INITIAL_FACILITIES);
console.log('Test 3: Unassociated Nominal-FRP Event (2.1 MW)');
console.log('  - Observation Classification:', assess3.observationClassification);
console.log('  - Marker Fill Color:', assess3.markerFillColor);
assert.equal(assess3.observationClassification, 'NORMAL', 'Low FRP unassociated event must be classified as NORMAL');
assert.equal(assess3.markerFillColor, '#10b981', 'Marker must be GREEN');
console.log('  ✓ PASSED\n');

// 4. Test Genuinely Unclassifiable Observation -> NOT_ASSESSED, GREY
const unclassifiableEvent: ThermalEvent = {
  id: 'CORRUPT-OBS-001',
  latitude: 20.0,
  longitude: 70.0,
  acquisitionTime: '2026-01-09T08:30:00Z',
  satellite: 'VIIRS-NOAA20',
  frp: 0,
  brightness: 0,
  confidence: 'low',
  dayNight: 'D',
  facilityId: null,
  facilityDistanceMeters: 50000,
  landCoverType: 'barren',
  spatialAssociation: 'UNASSOCIATED',
  behaviouralStatus: 'NOT_ASSESSED',
  deviationStatus: 'NOT_ASSESSED',
  isAmbiguous: true,
  uncertaintyDetails: 'Invalid radiometry',
  isInsideKnownZone: false,
  sourceHypotheses: {
    gas_flare: 0,
    industrial_fire: 0,
    agricultural_burn: 0,
    wildfire: 0,
    mining_smelter: 0,
    other_thermal: 1,
  },
};

const assess4 = getCanonicalAssessment(unclassifiableEvent, INITIAL_FACILITIES);
console.log('Test 4: Genuinely Unclassifiable Event (0 FRP)');
console.log('  - Observation Classification:', assess4.observationClassification);
console.log('  - Marker Fill Color:', assess4.markerFillColor);
assert.equal(assess4.observationClassification, 'NOT_ASSESSED', 'Corrupt event must remain NOT_ASSESSED');
assert.equal(assess4.markerFillColor, '#94a3b8', 'Marker must be GREY');
console.log('  ✓ PASSED\n');

// 5. Test Facility-Associated Empirical Anomaly (Jamnagar Off-Zone)
const jamnagarOffZone: ThermalEvent = {
  id: 'HIST-20260225-N-261',
  latitude: 22.355,
  longitude: 69.865,
  acquisitionTime: '2026-02-25T20:30:00Z',
  satellite: 'VIIRS-NOAA20',
  frp: 12.0,
  brightness: 360.0,
  confidence: 'high',
  dayNight: 'N',
  facilityId: 'FAC-GUJ-JAMNAGAR-01',
  facilityDistanceMeters: 0,
  landCoverType: 'industrial',
  spatialAssociation: 'FACILITY_OFF_ZONE',
  behaviouralStatus: 'ANOMALOUS',
  deviationStatus: 'ANOMALOUS',
  baselineStatus: 'EMPIRICAL',
  isAmbiguous: true,
  uncertaintyDetails: 'Off-zone anomaly at Jamnagar',
  isInsideKnownZone: false,
  sourceHypotheses: {
    gas_flare: 0.45,
    industrial_fire: 0.45,
    agricultural_burn: 0.02,
    wildfire: 0.01,
    mining_smelter: 0.05,
    other_thermal: 0.02,
  },
};

const assess5 = getCanonicalAssessment(jamnagarOffZone, INITIAL_FACILITIES);
console.log('Test 5: Jamnagar Off-Zone Anomaly');
console.log('  - Observation Classification:', assess5.observationClassification);
console.log('  - Facility Association:', assess5.facilityAssociation);
console.log('  - Baseline Status:', assess5.baselineStatus);
console.log('  - Facility Name:', assess5.facilityName);
console.log('  - Marker Fill Color:', assess5.markerFillColor);

assert.equal(assess5.observationClassification, 'ANOMALOUS', 'Must be ANOMALOUS');
assert.equal(assess5.facilityAssociation, 'FACILITY_OFF_ZONE', 'Must be FACILITY_OFF_ZONE');
assert.equal(assess5.baselineStatus, 'EMPIRICAL', 'Must be EMPIRICAL');
assert.equal(assess5.markerFillColor, '#ef4444', 'Must be RED');
assert.equal(assess5.facilityName, 'Jamnagar Refining & Petrochemical Complex', 'Must display actual facility name');
console.log('  ✓ PASSED\n');

// 6. Test Facility-Associated Routine Flaring (Jamnagar In-Zone Normal)
const jamnagarNormalFlare: ThermalEvent = {
  id: 'HIST-20260225-N-001',
  latitude: 22.360,
  longitude: 69.870,
  acquisitionTime: '2026-02-25T20:30:00Z',
  satellite: 'VIIRS-NOAA20',
  frp: 2.1,
  brightness: 335.0,
  confidence: 'high',
  dayNight: 'N',
  facilityId: 'FAC-GUJ-JAMNAGAR-01',
  facilityDistanceMeters: 0,
  landCoverType: 'industrial',
  spatialAssociation: 'KNOWN_THERMAL_ZONE',
  behaviouralStatus: 'NORMAL',
  deviationStatus: 'NORMAL',
  baselineStatus: 'EMPIRICAL',
  isAmbiguous: false,
  uncertaintyDetails: 'Routine operational flare',
  isInsideKnownZone: true,
  sourceHypotheses: {
    gas_flare: 0.95,
    industrial_fire: 0.01,
    agricultural_burn: 0.01,
    wildfire: 0.01,
    mining_smelter: 0.01,
    other_thermal: 0.01,
  },
};

const assess6 = getCanonicalAssessment(jamnagarNormalFlare, INITIAL_FACILITIES);
console.log('Test 6: Jamnagar Normal Flare');
console.log('  - Observation Classification:', assess6.observationClassification);
console.log('  - Facility Association:', assess6.facilityAssociation);
console.log('  - Marker Fill Color:', assess6.markerFillColor);

assert.equal(assess6.observationClassification, 'NORMAL', 'Must be NORMAL');
assert.equal(assess6.facilityAssociation, 'KNOWN_THERMAL_ZONE', 'Must be KNOWN_THERMAL_ZONE');
assert.equal(assess6.markerFillColor, '#10b981', 'Must be GREEN');
console.log('  ✓ PASSED\n');

console.log('============================================================');
console.log('ALL 6 SEMANTIC REFACTOR TESTS PASSED PERFECTLY!');
console.log('============================================================');
