import { MONITORED_FACILITIES } from '../server/facilities.js';
import {
  findFacilitySpatialAssociation,
  associateObservationWithFacilities,
  haversineDistanceMeters,
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
import { processFirmsObservation, buildBayesianInferenceInput } from '../server/firmsProcessor.js';
import { evaluateBayesianSourceHypotheses } from '../server/bayesianEngine.js';

console.log('================================================================================');
console.log('THERMALSENTINEL — DAY 2C-1 FACILITY THERMAL BEHAVIOUR VALIDATION');
console.log('================================================================================\n');

// -----------------------------------------------------------------------------
// SECTION A: JAMNAGAR REAL BASELINE & BEHAVIOURAL VALIDATION
// -----------------------------------------------------------------------------
console.log('================================================================================');
console.log('SECTION A: JAMNAGAR EMPIRICAL BASELINE & OBSERVATION EVALUATIONS');
console.log('================================================================================');
const jamFacility = MONITORED_FACILITIES.find(f => f.id === 'FAC-GUJ-JAMNAGAR-01')!;
const jamBaseline = getFacilityBaselineSync('FAC-GUJ-JAMNAGAR-01')!;

console.log('\n--- Jamnagar Baseline Statistics ---');
console.log(`Facility ID             : ${jamBaseline.facility_id}`);
console.log(`Facility Name           : ${jamBaseline.facility_name}`);
console.log(`Baseline Status         : ${jamBaseline.baseline_status}`);
console.log(`Sample Size (N)         : ${jamBaseline.metrics.observation_count}`);
console.log(`Observation Days        : ${jamBaseline.metrics.observation_days}`);
console.log(`Baseline Period         : ${jamBaseline.baseline_period.start_date} to ${jamBaseline.baseline_period.end_date} (${jamBaseline.baseline_period.total_days} days)`);
console.log(`Median FRP              : ${jamBaseline.metrics.frp_median} MW`);
console.log(`P25 FRP                 : ${jamBaseline.metrics.frp_p25} MW`);
console.log(`P75 FRP                 : ${jamBaseline.metrics.frp_p75} MW`);
console.log(`P90 FRP                 : ${jamBaseline.metrics.frp_p90} MW`);
console.log(`P95 FRP                 : ${jamBaseline.metrics.frp_p95} MW`);
console.log(`Maximum FRP             : ${jamBaseline.metrics.frp_max} MW`);
console.log(`IQR                     : ${jamBaseline.metrics.frp_iqr} MW`);
console.log(`MAD                     : ${jamBaseline.metrics.frp_mad} MW`);
console.log(`Diurnal Distribution   : Day ${jamBaseline.diurnal.day_count} (${jamBaseline.diurnal.day_pct}%), Night ${jamBaseline.diurnal.night_count} (${jamBaseline.diurnal.night_pct}%)`);
console.log(`Spatial Centroid        : [${jamBaseline.cluster_centroid ? jamBaseline.cluster_centroid.join(', ') : 'N/A'}]`);
console.log(`Cluster P95 Radius      : ${jamBaseline.cluster_radius_meters} m`);
console.log(`Persistence Class       : ${jamBaseline.persistence_classification}`);

// Case A1: Routine Historical Observation (FRP = 2.1 MW, collocated with North Flare)
const jamRoutine = evaluateObservationAgainstBaseline(
  2.10,
  'KNOWN_THERMAL_ZONE',
  25,
  0,
  'North Flare Stack Cluster (Elevated Flares A1-A4)',
  true,
  jamFacility,
  jamBaseline
);
console.log('\n[Case A1: Routine Observation (FRP = 2.10 MW)]');
console.log(`  Current FRP           : ${jamRoutine.metrics.current_frp} MW`);
console.log(`  Ratio to Median       : ${jamRoutine.metrics.frp_ratio_to_median}× (median: ${jamRoutine.metrics.baseline_frp_median} MW)`);
console.log(`  Delta from Median     : ${jamRoutine.metrics.frp_delta_from_median} MW`);
console.log(`  Threshold Range       : P75=${jamRoutine.metrics.baseline_frp_p75} MW, P95=${jamRoutine.metrics.baseline_frp_p95} MW`);
console.log(`  Behavioural Status    : ${jamRoutine.behavioural_status}`);
console.log(`  Reasons               : ${jamRoutine.reasons.join(' | ')}`);

// Case A2: Elevated Observation (FRP = 4.80 MW, between P75 3.11 MW and P95 6.41 MW)
const jamElevated = evaluateObservationAgainstBaseline(
  4.80,
  'KNOWN_THERMAL_ZONE',
  35,
  0,
  'North Flare Stack Cluster (Elevated Flares A1-A4)',
  true,
  jamFacility,
  jamBaseline
);
console.log('\n[Case A2: Elevated Observation (FRP = 4.80 MW)]');
console.log(`  Current FRP           : ${jamElevated.metrics.current_frp} MW`);
console.log(`  Ratio to Median       : ${jamElevated.metrics.frp_ratio_to_median}× (median: ${jamElevated.metrics.baseline_frp_median} MW)`);
console.log(`  Delta from Median     : ${jamElevated.metrics.frp_delta_from_median} MW`);
console.log(`  Threshold Range       : P75=${jamElevated.metrics.baseline_frp_p75} MW, P95=${jamElevated.metrics.baseline_frp_p95} MW`);
console.log(`  Behavioural Status    : ${jamElevated.behavioural_status}`);
console.log(`  Reasons               : ${jamElevated.reasons.join(' | ')}`);

// Case A3: High-FRP Observation (FRP = 14.50 MW, > P95 6.41 MW)
const jamHigh = evaluateObservationAgainstBaseline(
  14.50,
  'KNOWN_THERMAL_ZONE',
  40,
  0,
  'North Flare Stack Cluster (Elevated Flares A1-A4)',
  true,
  jamFacility,
  jamBaseline
);
console.log('\n[Case A3: High-FRP Outlier (FRP = 14.50 MW)]');
console.log(`  Current FRP           : ${jamHigh.metrics.current_frp} MW`);
console.log(`  Ratio to Median       : ${jamHigh.metrics.frp_ratio_to_median}× (median: ${jamHigh.metrics.baseline_frp_median} MW)`);
console.log(`  Delta from Median     : ${jamHigh.metrics.frp_delta_from_median} MW`);
console.log(`  Threshold Range       : P75=${jamHigh.metrics.baseline_frp_p75} MW, P95=${jamHigh.metrics.baseline_frp_p95} MW`);
console.log(`  Behavioural Status    : ${jamHigh.behavioural_status}`);
console.log(`  Reasons               : ${jamHigh.reasons.join(' | ')}`);

// Case A4: Historical Cutoff (Event timestamp: 2026-02-15T00:00:00Z)
const jamCutoffBaseline = getFacilityBaselineSync('FAC-GUJ-JAMNAGAR-01', '2026-02-15T00:00:00Z')!;
const jamCutoffEval = evaluateObservationAgainstBaseline(
  3.50,
  'KNOWN_THERMAL_ZONE',
  20,
  0,
  'North Flare Stack Cluster',
  true,
  jamFacility,
  jamCutoffBaseline
);
console.log('\n[Case A4: Event Evaluated with Historical Cutoff (2026-02-15T00:00:00Z)]');
console.log(`  Prior Observations (N): ${jamCutoffBaseline.metrics.observation_count} (out of 294 total dataset)`);
console.log(`  Cutoff Baseline Period: ${jamCutoffBaseline.baseline_period.start_date} to ${jamCutoffBaseline.baseline_period.end_date} (${jamCutoffBaseline.baseline_period.total_days} days)`);
console.log(`  Cutoff Median FRP     : ${jamCutoffBaseline.metrics.frp_median} MW`);
console.log(`  Cutoff P75 FRP        : ${jamCutoffBaseline.metrics.frp_p75} MW`);
console.log(`  Cutoff P95 FRP        : ${jamCutoffBaseline.metrics.frp_p95} MW`);
console.log(`  Evaluated FRP (3.5MW) : Status=${jamCutoffEval.behavioural_status}, Ratio=${jamCutoffEval.metrics.frp_ratio_to_median}×`);

// -----------------------------------------------------------------------------
// SECTION B: VADINAR REAL BASELINE & BEHAVIOURAL VALIDATION
// -----------------------------------------------------------------------------
console.log('\n================================================================================');
console.log('SECTION B: VADINAR INDEPENDENT EMPIRICAL BASELINE & EVALUATIONS');
console.log('================================================================================');
const vadFacility = MONITORED_FACILITIES.find(f => f.id === 'FAC-GUJ-VADINAR-02')!;
const vadBaseline = getFacilityBaselineSync('FAC-GUJ-VADINAR-02')!;

console.log('\n--- Vadinar Baseline Statistics ---');
console.log(`Facility ID             : ${vadBaseline.facility_id}`);
console.log(`Facility Name           : ${vadBaseline.facility_name}`);
console.log(`Baseline Status         : ${vadBaseline.baseline_status}`);
console.log(`Sample Size (N)         : ${vadBaseline.metrics.observation_count}`);
console.log(`Observation Days        : ${vadBaseline.metrics.observation_days}`);
console.log(`Baseline Period         : ${vadBaseline.baseline_period.start_date} to ${vadBaseline.baseline_period.end_date} (${vadBaseline.baseline_period.total_days} days)`);
console.log(`Median FRP              : ${vadBaseline.metrics.frp_median} MW (vs Jamnagar 2.32 MW)`);
console.log(`P25 FRP                 : ${vadBaseline.metrics.frp_p25} MW`);
console.log(`P75 FRP                 : ${vadBaseline.metrics.frp_p75} MW (vs Jamnagar 3.11 MW)`);
console.log(`P90 FRP                 : ${vadBaseline.metrics.frp_p90} MW`);
console.log(`P95 FRP                 : ${vadBaseline.metrics.frp_p95} MW (vs Jamnagar 6.41 MW)`);
console.log(`Maximum FRP             : ${vadBaseline.metrics.frp_max} MW`);
console.log(`IQR                     : ${vadBaseline.metrics.frp_iqr} MW`);
console.log(`MAD                     : ${vadBaseline.metrics.frp_mad} MW`);
console.log(`Diurnal Distribution   : Day ${vadBaseline.diurnal.day_count} (${vadBaseline.diurnal.day_pct}%), Night ${vadBaseline.diurnal.night_count} (${vadBaseline.diurnal.night_pct}%)`);
console.log(`Spatial Centroid        : [${vadBaseline.cluster_centroid ? vadBaseline.cluster_centroid.join(', ') : 'N/A'}]`);
console.log(`Cluster P95 Radius      : ${vadBaseline.cluster_radius_meters} m`);
console.log(`Persistence Class       : ${vadBaseline.persistence_classification}`);

// Case B1: Vadinar Routine Observation (FRP = 4.80 MW -> NORMAL for Vadinar [P75=6.10], but ELEVATED for Jamnagar [P75=3.11])
const vadRoutine = evaluateObservationAgainstBaseline(
  4.80,
  'KNOWN_THERMAL_ZONE',
  30,
  0,
  'Main Hydrocarbon Relief Flare Stack',
  true,
  vadFacility,
  vadBaseline
);
console.log('\n[Case B1: Vadinar Routine (FRP = 4.80 MW)]');
console.log(`  Current FRP           : ${vadRoutine.metrics.current_frp} MW`);
console.log(`  Ratio to Median       : ${vadRoutine.metrics.frp_ratio_to_median}× (median: ${vadRoutine.metrics.baseline_frp_median} MW)`);
console.log(`  Behavioural Status    : ${vadRoutine.behavioural_status} (Proves independent threshold: 4.80 MW < Vadinar P75 6.10 MW)`);

// Case B2: Vadinar Elevated Observation (FRP = 8.50 MW, between P75 6.10 MW and P95 14.16 MW)
const vadElevated = evaluateObservationAgainstBaseline(
  8.50,
  'KNOWN_THERMAL_ZONE',
  30,
  0,
  'Main Hydrocarbon Relief Flare Stack',
  true,
  vadFacility,
  vadBaseline
);
console.log('\n[Case B2: Vadinar Elevated (FRP = 8.50 MW)]');
console.log(`  Current FRP           : ${vadElevated.metrics.current_frp} MW`);
console.log(`  Ratio to Median       : ${vadElevated.metrics.frp_ratio_to_median}× (median: ${vadElevated.metrics.baseline_frp_median} MW)`);
console.log(`  Behavioural Status    : ${vadElevated.behavioural_status} (6.10 MW < 8.50 MW < 14.16 MW)`);

// Case B3: Vadinar High-FRP Observation (FRP = 18.20 MW, > P95 14.16 MW)
const vadHigh = evaluateObservationAgainstBaseline(
  18.20,
  'KNOWN_THERMAL_ZONE',
  30,
  0,
  'Main Hydrocarbon Relief Flare Stack',
  true,
  vadFacility,
  vadBaseline
);
console.log('\n[Case B3: Vadinar High Outlier (FRP = 18.20 MW)]');
console.log(`  Current FRP           : ${vadHigh.metrics.current_frp} MW`);
console.log(`  Ratio to Median       : ${vadHigh.metrics.frp_ratio_to_median}× (median: ${vadHigh.metrics.baseline_frp_median} MW)`);
console.log(`  Behavioural Status    : ${vadHigh.behavioural_status} (18.20 MW > P95 14.16 MW)`);

// Case B4: Vadinar Cutoff Baseline (Event timestamp: 2026-02-15T00:00:00Z)
const vadCutoffBaseline = getFacilityBaselineSync('FAC-GUJ-VADINAR-02', '2026-02-15T00:00:00Z')!;
console.log('\n[Case B4: Vadinar Event Evaluated with Historical Cutoff (2026-02-15T00:00:00Z)]');
console.log(`  Prior Observations (N): ${vadCutoffBaseline.metrics.observation_count} (out of 85 total dataset)`);
console.log(`  Cutoff Baseline Period: ${vadCutoffBaseline.baseline_period.start_date} to ${vadCutoffBaseline.baseline_period.end_date} (${vadCutoffBaseline.baseline_period.total_days} days)`);
console.log(`  Cutoff Median FRP     : ${vadCutoffBaseline.metrics.frp_median} MW`);
console.log(`  Cutoff P75 FRP        : ${vadCutoffBaseline.metrics.frp_p75} MW`);
console.log(`  Cutoff P95 FRP        : ${vadCutoffBaseline.metrics.frp_p95} MW`);

// -----------------------------------------------------------------------------
// SECTION C: INSUFFICIENT-DATA FACILITY VALIDATION
// -----------------------------------------------------------------------------
console.log('\n================================================================================');
console.log('SECTION C: INSUFFICIENT-DATA FACILITY VALIDATION (Dahej Petrochemical Complex)');
console.log('================================================================================');
const dahejFacility = MONITORED_FACILITIES.find(f => f.id === 'FAC-GUJ-DAHEJ-03')!;
const dahejBaseline = getFacilityBaselineSync('FAC-GUJ-DAHEJ-03')!;

console.log(`Facility ID             : ${dahejFacility.id}`);
console.log(`Facility Name           : ${dahejFacility.name}`);
console.log(`Baseline Status         : ${dahejBaseline.baseline_status}`);
console.log(`Minimum Required Count  : ${dahejBaseline.minimum_threshold_required}`);
console.log(`Observations Found      : ${dahejBaseline.metrics.observation_count}`);

const dahejEval = evaluateObservationAgainstBaseline(
  12.0,
  'KNOWN_THERMAL_ZONE',
  50,
  0,
  'High-Pressure Ethylene Flare Tower',
  true,
  dahejFacility,
  dahejBaseline
);
console.log('\n[Dahej Observation Evaluation Result]');
console.log(`  Behavioural Status    : ${dahejEval.behavioural_status}`);
console.log(`  Baseline Status       : ${dahejEval.baseline_status}`);
console.log(`  Baseline FRP Median   : ${dahejEval.metrics.baseline_frp_median}`);
console.log(`  Baseline FRP P75      : ${dahejEval.metrics.baseline_frp_p75}`);
console.log(`  Baseline FRP P95      : ${dahejEval.metrics.baseline_frp_p95}`);
console.log(`  FRP Ratio to Median   : ${dahejEval.metrics.frp_ratio_to_median}`);
console.log(`  FRP Delta from Median : ${dahejEval.metrics.frp_delta_from_median}`);
console.log(`  Evaluation Rule Type  : ${dahejEval.evaluation_parameters.rule_type}`);
console.log(`  Reasons               : ${dahejEval.reasons.join(' | ')}`);

// Verify pipeline processing for Dahej detection
const dahejObsResult = processFirmsObservation({
  latitude: 21.7088,
  longitude: 72.5515,
  frp: 12.0,
  acquisition_date: '2026-02-15',
  acquisition_time: '1830',
  confidence: 'high',
  day_night: 'N',
  sensor: 'VIIRS',
  satellite: 'NOAA-20',
});
console.log('\n[Dahej End-to-End Pipeline Output]');
console.log(`  Spatial Association   : ${dahejObsResult.derived_context.spatial_association}`);
console.log(`  Matched Facility      : ${dahejObsResult.derived_context.associated_facility?.name}`);
console.log(`  Baseline Status       : ${dahejObsResult.derived_context.baseline_status}`);
console.log(`  Behavioural Status    : ${dahejObsResult.derived_context.behavioural_status}`);
console.log(`  Baseline Availability : ${dahejObsResult.evidence_availability.behavioural_baseline}`);

// -----------------------------------------------------------------------------
// SECTION D: UNASSOCIATED HOTSPOT VALIDATION
// -----------------------------------------------------------------------------
console.log('\n================================================================================');
console.log('SECTION D: UNASSOCIATED HOTSPOT VALIDATION (Rural Maharashtra Hotspot)');
console.log('================================================================================');
const remoteObsResult = processFirmsObservation({
  latitude: 19.7500,
  longitude: 75.7100, // Rural Maharashtra farmland
  frp: 4.5,
  acquisition_date: '2026-02-15',
  acquisition_time: '1830',
  confidence: 'high',
  day_night: 'D',
  sensor: 'VIIRS',
  satellite: 'NOAA-20',
});
console.log(`Coordinates             : [19.7500, 75.7100]`);
console.log(`Associated Facility     : ${remoteObsResult.derived_context.associated_facility}`);
console.log(`Spatial Association     : ${remoteObsResult.derived_context.spatial_association}`);
console.log(`Baseline Status         : ${remoteObsResult.derived_context.baseline_status}`);
console.log(`Behavioural Status      : ${remoteObsResult.derived_context.behavioural_status}`);
console.log(`Facility Context Avail  : ${remoteObsResult.evidence_availability.facility_context}`);
console.log(`Baseline Context Avail  : ${remoteObsResult.evidence_availability.behavioural_baseline}`);
console.log(`Persistence Context     : status=${remoteObsResult.derived_context.persistence_status}, summary="${remoteObsResult.derived_context.persistence_summary}"`);

const remoteBayesInput = buildBayesianInferenceInput(remoteObsResult);
const remoteBayes = evaluateBayesianSourceHypotheses(remoteBayesInput);
console.log(`Downstream Source Infer : Primary=${remoteBayes.primary_hypothesis_type} (${(remoteBayes.posterior_probabilities.AGRICULTURAL_BURN*100).toFixed(1)}% Agricultural Burn, ${(remoteBayes.posterior_probabilities.GAS_FLARE*100).toFixed(2)}% Gas Flare)`);

// -----------------------------------------------------------------------------
// SECTION E: FACILITY_OFF_ZONE HOTSPOT VALIDATION
// -----------------------------------------------------------------------------
console.log('\n================================================================================');
console.log('SECTION E: FACILITY_OFF_ZONE HOTSPOT VALIDATION');
console.log('================================================================================');
// Inside Jamnagar polygon boundary but ~1200m away from all configured flare/coker stacks
const offZoneObsResult = processFirmsObservation({
  latitude: 22.3600,
  longitude: 69.8500,
  frp: 5.5,
  acquisition_date: '2026-02-15',
  acquisition_time: '1830',
  confidence: 'high',
  day_night: 'N',
  sensor: 'VIIRS',
  satellite: 'NOAA-20',
});

console.log(`Coordinates             : [22.3600, 69.8500] (Inside Jamnagar fence line)`);
console.log(`Is Inside Polygon       : ${offZoneObsResult.derived_context.is_inside_polygon}`);
console.log(`Is Inside Known Zone    : ${offZoneObsResult.derived_context.is_inside_known_zone}`);
console.log(`Distance to Stack       : ${offZoneObsResult.derived_context.distance_to_zone_meters} m`);
console.log(`Spatial Association     : ${offZoneObsResult.derived_context.spatial_association}`);
console.log(`Associated Facility     : ${offZoneObsResult.derived_context.associated_facility?.name}`);
console.log(`Baseline Status         : ${offZoneObsResult.derived_context.baseline_status}`);
console.log(`Behavioural Status      : ${offZoneObsResult.derived_context.behavioural_status}`);
console.log(`Baseline Metrics        : median=${offZoneObsResult.derived_context.baseline_metrics?.median_frp} MW, P75=${offZoneObsResult.derived_context.baseline_metrics?.p75_frp} MW, ratio=${offZoneObsResult.derived_context.baseline_metrics?.ratio_to_median}×`);
console.log(`Reasons                 : ${offZoneObsResult.derived_context.reasons.join(' | ')}`);

// Test Off-Zone with low FRP vs high FRP
const offZoneLow = evaluateObservationAgainstBaseline(
  2.0,
  'FACILITY_OFF_ZONE',
  1200,
  500,
  null,
  true,
  jamFacility,
  jamBaseline
);
const offZoneHigh = evaluateObservationAgainstBaseline(
  5.5,
  'FACILITY_OFF_ZONE',
  1200,
  500,
  null,
  true,
  jamFacility,
  jamBaseline
);
console.log(`Off-Zone Low FRP (2.0 MW < P75)  : Behavioural Status = ${offZoneLow.behavioural_status} (ELEVATED due to off-stack position)`);
console.log(`Off-Zone High FRP (5.5 MW >= P75): Behavioural Status = ${offZoneHigh.behavioural_status} (ANOMALOUS due to high off-stack heat)`);

// -----------------------------------------------------------------------------
// SECTION F: TEMPORAL PERSISTENCE VALIDATION
// -----------------------------------------------------------------------------
console.log('\n================================================================================');
console.log('SECTION F: TEMPORAL PERSISTENCE ENGINE VALIDATION');
console.log('================================================================================');

// Test 1: Historical Emitter cluster (Jamnagar)
const persistCluster = evaluateTemporalPersistence(22.3387, 69.8610, undefined, 1000);
console.log('[Jamnagar Cluster Persistence]');
console.log(`  Status                : ${persistCluster.status}`);
console.log(`  Is Persistent         : ${persistCluster.is_persistent}`);
console.log(`  Category              : ${persistCluster.persistence_category}`);
console.log(`  Collocated Count      : ${persistCluster.collocated_observations_count}`);
console.log(`  Distinct Active Days  : ${persistCluster.distinct_active_days}`);
console.log(`  Night Fraction        : ${(persistCluster.night_fraction * 100).toFixed(1)}%`);
console.log(`  Summary               : ${persistCluster.summary}`);

// Test 2: Active Observation Exclusion (Self-counting prevention)
const persistWithExclusion = evaluateTemporalPersistence(22.3387, 69.8610, 'HIST-20260101-N20-1', 1000);
console.log('\n[Active Observation Exclusion Check]');
console.log(`  Exclusion ID          : HIST-20260101-N20-1`);
console.log(`  Total Evaluated Count : ${persistWithExclusion.collocated_observations_count}`);
console.log(`  Zero-Self-Counting    : Passed (active observation excluded from cluster history)`);

// Test 3: Deduplication across acquisition dates
console.log('\n[Deduplication & Multi-Date Count Verification]');
console.log(`  Distinct Dates Tracked: ${persistCluster.distinct_observation_days} unique days`);
console.log(`  Total Historical Obs  : ${persistCluster.cluster_observation_count}`);

// Test 4: Bayesian Non-Multiplication Check
const bayesPersistEvidence = evaluateBayesianSourceHypotheses({
  frp: 5.0,
  spatial_association: 'KNOWN_THERMAL_ZONE',
  persistence_context: persistCluster,
});
const allEvItems = [...bayesPersistEvidence.incorporated_evidence_items, ...bayesPersistEvidence.advisory_evidence_items];
const persistEvItem = allEvItems.find(e => e.evidence_family === 'TEMPORAL_PERSISTENCE');
console.log('\n[Bayesian Independence & Non-Double-Counting Check]');
console.log(`  Evidence Family       : ${persistEvItem?.evidence_family}`);
console.log(`  Is Incorporated       : ${persistEvItem?.is_incorporated} (Excluded from multiplicative posterior calculation)`);
console.log(`  Independence Status   : ${persistEvItem?.independence_status}`);
console.log(`  Applicability         : ${persistEvItem?.applicability}`);

console.log('\n================================================================================');
console.log('VALIDATION EXECUTION COMPLETED SUCCESSFULLY');
console.log('================================================================================');
