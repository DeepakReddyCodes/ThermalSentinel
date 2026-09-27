// ============================================================================
// ThermalSentinel — Generic FIRMS Detection Pipeline Test Suite (Day 2A)
//
// Rigorously tests the canonical generic FIRMS observation pipeline:
//   A. Valid FIRMS observation
//   B. Missing optional fields
//   C. Invalid coordinates
//   D. Invalid/negative FRP
//   E. Timestamp normalization
//   F. Facility-associated detection
//   G. Unassociated detection
//   H. No flare-stack match (facility off-zone/buffer)
//   I. Unavailable contextual evidence (explicit availability flags, not negative evidence)
//   J. Provenance preservation
//   K. Jamnagar observation passes through generic path without Jamnagar branch
//   L. Unassociated Maharashtra fixture passes through generic path without Maharashtra branch
//
// Real Data Pipeline Audit:
//   - Audits all real FIRMS observations in data/processed and data/raw
//   - Reports exact counts: examined, normalized, rejected, associated, unassociated, failures
// ============================================================================

import {
  normalizeCanonicalFirmsObservation,
  processFirmsObservation,
  buildBayesianInferenceInput,
} from '../server/firmsProcessor.js';
import {
  evaluateBayesianSourceHypotheses,
} from '../server/bayesianEngine.js';
import { MONITORED_FACILITIES } from '../server/facilities.js';
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

export function runGenericFirmsPipelineTestSuite() {
  console.log('='.repeat(80));
  console.log('THERMALSENTINEL — GENERIC FIRMS DETECTION PIPELINE TEST SUITE (DAY 2A)');
  console.log('='.repeat(80));

  // --------------------------------------------------------------------------
  // TEST A: Valid FIRMS observation
  // --------------------------------------------------------------------------
  console.log('\n[TEST A: Valid FIRMS Observation]');
  {
    const validRaw = {
      id: 'FIRMS-20260225-N20-001',
      latitude: 22.33776,
      longitude: 69.86501,
      frp: 2.32,
      acquisition_time: '2026-02-25T21:32:00Z',
      satellite: 'VIIRS-NOAA20',
      sensor: 'VIIRS',
      confidence: 'nominal',
      day_night: 'N',
      brightness_kelvin: 302.16,
      brightness_ti4: 302.16,
      brightness_ti5: 291.3,
      scan: 0.58,
      track: 0.52,
    };

    const norm = normalizeCanonicalFirmsObservation(validRaw);
    assert(norm.valid === true, 'Valid raw FIRMS observation normalizes successfully');
    assert(norm.observation !== undefined, 'Canonical observation object is created');
    assert(norm.observation?.latitude === 22.33776, 'Latitude correctly preserved');
    assert(norm.observation?.longitude === 69.86501, 'Longitude correctly preserved');
    assert(norm.observation?.frp === 2.32, 'FRP correctly preserved');
    assert(norm.observation?.brightness_delta === 10.9, 'Brightness delta computed from TI4 and TI5 (302.16 - 291.3 = 10.9)');
    assert(norm.observation?.is_real_data === true, 'Default provenance marks is_real_data as true');
  }

  // --------------------------------------------------------------------------
  // TEST B: Missing Optional Fields
  // --------------------------------------------------------------------------
  console.log('\n[TEST B: Missing Optional Fields]');
  {
    const minimalRaw = {
      latitude: 18.5204,
      longitude: 73.8567,
      frp: 5.5,
      acquisition_time: '2026-03-01T10:00:00Z',
    };

    const norm = normalizeCanonicalFirmsObservation(minimalRaw);
    assert(norm.valid === true, 'Minimal FIRMS observation with missing optional fields is valid');
    assert(norm.observation?.brightness_kelvin === null, 'Missing brightness_kelvin is null (not invented)');
    assert(norm.observation?.brightness_ti4 === null, 'Missing brightness_ti4 is null (not invented)');
    assert(norm.observation?.brightness_ti5 === null, 'Missing brightness_ti5 is null (not invented)');
    assert(norm.observation?.brightness_delta === null, 'Missing brightness_delta is null (not invented)');
    assert(norm.observation?.scan === null, 'Missing scan is null');
    assert(norm.observation?.track === null, 'Missing track is null');
    assert(norm.observation?.confidence === 'nominal', 'Default confidence falls back to nominal');
    assert(norm.observation?.satellite === 'VIIRS-NOAA20', 'Default satellite set cleanly');
  }

  // --------------------------------------------------------------------------
  // TEST C: Invalid Coordinates
  // --------------------------------------------------------------------------
  console.log('\n[TEST C: Invalid Coordinates]');
  {
    const invalidLat = normalizeCanonicalFirmsObservation({
      latitude: 95.0,
      longitude: 70.0,
      frp: 2.0,
      acquisition_time: '2026-01-01T00:00:00Z',
    });
    assert(invalidLat.valid === false, 'Rejects latitude > 90.0');
    assert(invalidLat.errors.some(e => e.includes('Latitude 95')), 'Provides clear error message for out-of-bounds latitude');

    const invalidLon = normalizeCanonicalFirmsObservation({
      latitude: 20.0,
      longitude: 195.0,
      frp: 2.0,
      acquisition_time: '2026-01-01T00:00:00Z',
    });
    assert(invalidLon.valid === false, 'Rejects longitude > 180.0');

    const nanCoord = normalizeCanonicalFirmsObservation({
      latitude: NaN,
      longitude: 70.0,
      frp: 2.0,
      acquisition_time: '2026-01-01T00:00:00Z',
    });
    assert(nanCoord.valid === false, 'Rejects NaN coordinate');
  }

  // --------------------------------------------------------------------------
  // TEST D: Invalid / Negative FRP
  // --------------------------------------------------------------------------
  console.log('\n[TEST D: Invalid / Negative FRP]');
  {
    const negFrp = normalizeCanonicalFirmsObservation({
      latitude: 22.0,
      longitude: 70.0,
      frp: -5.0,
      acquisition_time: '2026-01-01T00:00:00Z',
    });
    assert(negFrp.valid === false, 'Rejects negative FRP (-5.0 MW)');
    assert(negFrp.errors.some(e => e.includes('FRP cannot be negative')), 'Error mentions non-negative FRP requirement');

    const excessiveFrp = normalizeCanonicalFirmsObservation({
      latitude: 22.0,
      longitude: 70.0,
      frp: 15000.0,
      acquisition_time: '2026-01-01T00:00:00Z',
    });
    assert(excessiveFrp.valid === false, 'Rejects implausible FRP (> 10,000 MW)');
  }

  // --------------------------------------------------------------------------
  // TEST E: Timestamp Normalization
  // --------------------------------------------------------------------------
  console.log('\n[TEST E: Timestamp Normalization]');
  {
    // E1: ISO string
    const isoNorm = normalizeCanonicalFirmsObservation({
      latitude: 22.0,
      longitude: 70.0,
      frp: 2.0,
      acquisition_time: '2026-02-25T21:32:00Z',
    });
    assert(isoNorm.valid === true, 'Accepts valid ISO-8601 UTC string');
    assert(isoNorm.observation?.acquisition_time === '2026-02-25T21:32:00.000Z', 'Standardizes to ISO UTC representation');
    assert(isoNorm.observation?.acquisition_date === '2026-02-25', 'Extracts YYYY-MM-DD acquisition date');

    // E2: acq_date + acq_time (e.g. 2132 or 910 from raw CSV)
    const csvNorm = normalizeCanonicalFirmsObservation({
      latitude: 22.0,
      longitude: 70.0,
      frp: 2.0,
      acq_date: '2026-01-06',
      acq_time: 910,
    });
    assert(csvNorm.valid === true, 'Normalizes raw CSV acq_date + acq_time integer (910 -> 09:10:00Z)');
    assert(csvNorm.observation?.acquisition_time === '2026-01-06T09:10:00.000Z', 'Constructs correct UTC ISO string for morning satellite pass');

    // E3: Invalid timestamp
    const badTime = normalizeCanonicalFirmsObservation({
      latitude: 22.0,
      longitude: 70.0,
      frp: 2.0,
      acquisition_time: 'invalid-date-string',
    });
    assert(badTime.valid === false, 'Rejects malformed date strings');
  }

  // --------------------------------------------------------------------------
  // TEST F: Facility-Associated Detection (Inside Known Flare Zone)
  // --------------------------------------------------------------------------
  console.log('\n[TEST F: Facility-Associated Detection]');
  {
    // Jamnagar North Flare Stack Cluster center coordinates (inside known thermal zone)
    const flareDetection = {
      latitude: 22.3685,
      longitude: 69.8690,
      frp: 2.32,
      acquisition_time: '2026-02-25T21:32:00Z',
      satellite: 'VIIRS-NOAA20',
      day_night: 'N',
    };

    const res = processFirmsObservation(flareDetection);
    assert(res.processing_status === 'SUCCESS', 'Processing succeeds for facility detection');
    assert(res.derived_context.is_associated === true, 'Identified as associated with facility');
    assert(res.derived_context.associated_facility?.id === 'FAC-GUJ-JAMNAGAR-01', 'Correctly matches Jamnagar facility ID');
    assert(res.derived_context.spatial_association === 'KNOWN_THERMAL_ZONE', 'Spatial association is KNOWN_THERMAL_ZONE');
    assert(res.derived_context.is_inside_known_zone === true, 'is_inside_known_zone is true');
    assert(res.evidence_availability.facility_context === 'AVAILABLE', 'facility_context is marked AVAILABLE');
    assert(res.evidence_availability.behavioural_baseline === 'AVAILABLE', 'behavioural_baseline is marked AVAILABLE');
  }

  // --------------------------------------------------------------------------
  // TEST G: Unassociated Detection
  // --------------------------------------------------------------------------
  console.log('\n[TEST G: Unassociated Detection]');
  {
    // Location in rural Maharashtra far from any monitored industrial facility
    const ruralHotspot = {
      latitude: 19.8765,
      longitude: 75.3456,
      frp: 8.5,
      acquisition_time: '2026-03-01T18:00:00Z',
      satellite: 'VIIRS-SNPP',
      day_night: 'N',
    };

    const res = processFirmsObservation(ruralHotspot);
    assert(res.processing_status === 'SUCCESS', 'Processing succeeds for remote hotspot');
    assert(res.derived_context.is_associated === false, 'is_associated is strictly false');
    assert(res.derived_context.associated_facility === null, 'associated_facility is null (not forced to nearest)');
    assert(res.derived_context.spatial_association === 'UNASSOCIATED', 'spatial_association is UNASSOCIATED');
    assert(res.derived_context.baseline_status === 'NONE', 'baseline_status is NONE');
    assert(res.derived_context.behavioural_status === 'NOT_ASSESSED', 'behavioural_status is NOT_ASSESSED');
    assert(res.evidence_availability.facility_context === 'UNAVAILABLE', 'facility_context is marked UNAVAILABLE');
    assert(res.evidence_availability.behavioural_baseline === 'UNAVAILABLE', 'behavioural_baseline is marked UNAVAILABLE');
  }

  // --------------------------------------------------------------------------
  // TEST H: No Flare-Stack Match (Facility Off-Zone / Buffer)
  // --------------------------------------------------------------------------
  console.log('\n[TEST H: No Flare-Stack Match (Facility Off-Zone)]');
  {
    // Location within Jamnagar polygon boundary but far from flare stacks
    const offZoneHotspot = {
      latitude: 22.330,
      longitude: 69.815,
      frp: 3.5,
      acquisition_time: '2026-02-25T21:32:00Z',
      satellite: 'VIIRS-NOAA20',
      day_night: 'N',
    };

    const res = processFirmsObservation(offZoneHotspot);
    assert(res.derived_context.is_associated === true, 'Associated with facility due to boundary enclosure');
    assert(res.derived_context.spatial_association === 'FACILITY_OFF_ZONE' || res.derived_context.spatial_association === 'FACILITY_BUFFER',
      `Spatial state reflects non-flare zone (got ${res.derived_context.spatial_association})`);
    assert(res.derived_context.is_inside_known_zone === false, 'is_inside_known_zone is strictly false');
    assert(res.derived_context.distance_to_zone_meters !== null && (res.derived_context.distance_to_zone_meters || 0) > 500,
      `distance_to_zone_meters is recorded correctly (${res.derived_context.distance_to_zone_meters} m)`);
  }

  // --------------------------------------------------------------------------
  // TEST I: Unavailable Contextual Evidence (Explicit Availability Mapping)
  // --------------------------------------------------------------------------
  console.log('\n[TEST I: Unavailable Contextual Evidence]');
  {
    const unassistedHotspot = {
      latitude: 22.3685,
      longitude: 69.8690,
      frp: 2.32,
      acquisition_time: '2026-02-25T21:32:00Z',
    };

    // Process without optional external enrichments (no weather, optical, or ML supplied)
    const res = processFirmsObservation(unassistedHotspot);

    assert(res.evidence_availability.source_observation === 'AVAILABLE', 'source_observation is AVAILABLE');
    assert(res.evidence_availability.spatial_context === 'AVAILABLE', 'spatial_context is AVAILABLE');
    assert(res.evidence_availability.infrastructure === 'UNAVAILABLE', 'infrastructure is UNAVAILABLE when not acquired');
    assert(res.evidence_availability.weather === 'UNAVAILABLE', 'weather is UNAVAILABLE when not acquired');
    assert(res.evidence_availability.optical === 'UNAVAILABLE', 'optical is UNAVAILABLE when not acquired');
    assert(res.evidence_availability.ml_advisory === 'UNAVAILABLE', 'ml_advisory is UNAVAILABLE when not acquired');

    // Feed to Bayesian engine and verify unavailable evidence is NOT counted as negative evidence
    const bayesInput = buildBayesianInferenceInput(res);
    const bayesResult = evaluateBayesianSourceHypotheses(bayesInput);

    // Verify incorporated evidence items only include available evidence
    const incFamilies = bayesResult.incorporated_evidence_items.map(e => e.evidence_family);
    assert(incFamilies.includes('SPATIAL_CONTEXT'), 'Incorporates available spatial context');
    assert(incFamilies.includes('RADIOMETRY'), 'Incorporates available radiometry');
    assert(!incFamilies.includes('INFRASTRUCTURE'), 'Does NOT incorporate unavailable infrastructure evidence');
    assert(!incFamilies.includes('WEATHER'), 'Does NOT incorporate unavailable weather evidence');
    assert(!incFamilies.includes('OPTICAL'), 'Does NOT incorporate unavailable optical evidence');
  }

  // --------------------------------------------------------------------------
  // TEST J: Provenance Preservation
  // --------------------------------------------------------------------------
  console.log('\n[TEST J: Provenance Preservation]');
  {
    const rawRecordPayload = { raw_line: '22.33776,69.86501,302.16,0.58,0.52,2026-01-01,2132,N20,VIIRS,n,2,291.3,2.06,N,2' };
    const provHotspot = {
      latitude: 22.33776,
      longitude: 69.86501,
      frp: 2.06,
      acquisition_time: '2026-01-01T21:32:00Z',
      provenance: 'REAL_FIRMS' as const,
      raw_record: rawRecordPayload,
    };

    const res = processFirmsObservation(provHotspot);
    assert(res.source_observation.provenance === 'REAL_FIRMS', 'Provenance REAL_FIRMS preserved');
    assert(res.source_observation.is_real_data === true, 'is_real_data is true for REAL_FIRMS');
    assert(res.source_observation.raw_record !== null, 'Original raw_record preserved intact');

    const controlledHotspot = {
      latitude: 22.33776,
      longitude: 69.86501,
      frp: 2.06,
      acquisition_time: '2026-01-01T21:32:00Z',
      provenance: 'CONTROLLED_TEST' as const,
    };
    const ctrlRes = processFirmsObservation(controlledHotspot);
    assert(ctrlRes.source_observation.provenance === 'CONTROLLED_TEST', 'Provenance CONTROLLED_TEST preserved');
    assert(ctrlRes.source_observation.is_real_data === false, 'is_real_data is false for CONTROLLED_TEST');
  }

  // --------------------------------------------------------------------------
  // TEST K: Jamnagar Observation Passes Through Generic Path Without Jamnagar-Specific Branch
  // --------------------------------------------------------------------------
  console.log('\n[TEST K: Jamnagar Observation in Generic Path]');
  {
    const jamnagarRaw = {
      id: 'JAM-GENERIC-TEST-001',
      latitude: 22.3685,
      longitude: 69.8690,
      frp: 2.32,
      acquisition_time: '2026-02-25T21:32:00Z',
      day_night: 'N',
      satellite: 'VIIRS-NOAA20',
      confidence: 'nominal',
      brightness_ti4: 307.02,
      brightness_ti5: 292.99,
    };

    // Pass through generic processor without specifying facility
    const genericRes = processFirmsObservation(jamnagarRaw);
    assert(genericRes.processing_status === 'SUCCESS', 'Jamnagar observation processes successfully via generic pipeline');
    assert(genericRes.derived_context.associated_facility?.id === 'FAC-GUJ-JAMNAGAR-01', 'Geometrically resolved to Jamnagar facility');
    assert(genericRes.derived_context.spatial_association === 'KNOWN_THERMAL_ZONE', 'Resolved spatial association geometrically');
    assert(genericRes.derived_context.baseline_status === 'EMPIRICAL', 'Empirical baseline loaded via generic registry');

    const bayesInput = buildBayesianInferenceInput(genericRes);
    const bayesResult = evaluateBayesianSourceHypotheses(bayesInput);
    assert(bayesResult.primary_hypothesis_type === 'GAS_FLARE', 'Primary hypothesis is GAS_FLARE');
    assert(bayesResult.posterior_probabilities.GAS_FLARE > 0.85, `Posterior for GAS_FLARE > 85% (got ${(bayesResult.posterior_probabilities.GAS_FLARE * 100).toFixed(2)}%)`);
  }

  // --------------------------------------------------------------------------
  // TEST L: Unassociated Maharashtra Hotspot Passes Through Generic Path Without Maharashtra-Specific Branch
  // --------------------------------------------------------------------------
  console.log('\n[TEST L: Unassociated Maharashtra Hotspot in Generic Path]');
  {
    const maharashtraHotspot = {
      id: 'MAH-GENERIC-TEST-001',
      latitude: 19.7515,
      longitude: 75.7139,
      frp: 12.4,
      acquisition_time: '2026-03-10T14:30:00Z',
      day_night: 'D',
      satellite: 'VIIRS-SNPP',
      confidence: 'high',
    };

    const res = processFirmsObservation(maharashtraHotspot);
    assert(res.processing_status === 'SUCCESS', 'Maharashtra hotspot processes successfully via generic pipeline');
    assert(res.derived_context.is_associated === false, 'Unassociated with any facility');
    assert(res.derived_context.associated_facility === null, 'associated_facility is null');
    assert(res.derived_context.spatial_association === 'UNASSOCIATED', 'spatial_association is UNASSOCIATED');
    assert(res.derived_context.baseline_status === 'NONE', 'baseline_status is NONE');

    const bayesInput = buildBayesianInferenceInput(res);
    const bayesResult = evaluateBayesianSourceHypotheses(bayesInput);
    assert(bayesResult.primary_hypothesis_type === 'AGRICULTURAL_BURN' || bayesResult.primary_hypothesis_type === 'WILDFIRE_VEGETATION',
      `Primary hypothesis for unassociated daytime rural hotspot is vegetation/burn (got ${bayesResult.primary_hypothesis_type})`);
    assert(bayesResult.posterior_probabilities.GAS_FLARE < 0.05, `Gas flare posterior is low (< 5%, got ${(bayesResult.posterior_probabilities.GAS_FLARE * 100).toFixed(2)}%)`);
  }

  // --------------------------------------------------------------------------
  // REAL DATA PIPELINE EVALUATION (Section 8)
  // --------------------------------------------------------------------------
  console.log('\n' + '='.repeat(80));
  console.log('REAL DATA AUDIT: PROCESSING ALL REAL FIRMS DATA IN REPOSITORY');
  console.log('='.repeat(80));

  let totalObservationsExamined = 0;
  let totalSuccessfullyNormalized = 0;
  let totalRejectedInvalid = 0;
  let totalFacilityAssociated = 0;
  let totalUnassociated = 0;
  let totalMissingContext = 0;
  let totalProcessingFailures = 0;

  const datasetBreakdown: Record<string, {
    total: number;
    normalized: number;
    invalid: number;
    associated: number;
    unassociated: number;
    missingContext: number;
  }> = {};

  // 3. Physical Observation Deduplication Tracking
  const uniquePhysicalKeys = new Set<string>();
  const uniqueAssociatedKeys = new Set<string>();
  const uniqueUnassociatedKeys = new Set<string>();

  // Function to build standard physical identity key
  const getPhysicalKey = (obs: any) => {
    const lat = Number(obs.latitude).toFixed(4);
    const lon = Number(obs.longitude).toFixed(4);
    const time = new Date(obs.acquisition_time).toISOString();
    const sat = String(obs.satellite).trim().toUpperCase();
    const frp = (Math.round(obs.frp * 100) / 100).toFixed(2);
    return `${sat}|${time}|${lat}|${lon}|${frp}`;
  };

  // 1. Process all historical observations from data/processed/
  const processedDir = path.join(process.cwd(), 'data', 'processed');
  if (fs.existsSync(processedDir)) {
    const files = fs.readdirSync(processedDir).filter(f => f.endsWith('_historical_observations.json'));
    for (const file of files) {
      const filePath = path.join(processedDir, file);
      const rawData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const items: any[] = Array.isArray(rawData) ? rawData : (rawData.observations || []);

      const stats = { total: 0, normalized: 0, invalid: 0, associated: 0, unassociated: 0, missingContext: 0 };

      for (const item of items) {
        totalObservationsExamined++;
        stats.total++;

        const res = processFirmsObservation(item);
        if (res.processing_status === 'SUCCESS') {
          totalSuccessfullyNormalized++;
          stats.normalized++;

          const pKey = getPhysicalKey(res.source_observation);
          uniquePhysicalKeys.add(pKey);

          if (res.derived_context.is_associated) {
            totalFacilityAssociated++;
            stats.associated++;
            uniqueAssociatedKeys.add(pKey);
          } else {
            totalUnassociated++;
            stats.unassociated++;
            uniqueUnassociatedKeys.add(pKey);
          }

          // Check for missing optional thermal/satellite fields
          if (res.source_observation.brightness_ti5 === null || res.source_observation.scan === null) {
            totalMissingContext++;
            stats.missingContext++;
          }
        } else {
          totalRejectedInvalid++;
          stats.invalid++;
          if (res.processing_status !== 'INVALID_OBSERVATION') {
            totalProcessingFailures++;
          }
        }
      }
      datasetBreakdown[file] = stats;
    }
  }

  // 2. Process all raw CSV files from data/raw/
  const rawDir = path.join(process.cwd(), 'data', 'raw');
  if (fs.existsSync(rawDir)) {
    const rawFiles = fs.readdirSync(rawDir).filter(f => f.endsWith('.csv'));
    for (const file of rawFiles) {
      const filePath = path.join(rawDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
      if (lines.length <= 1) continue;

      const header = lines[0].split(',').map(h => h.trim().toLowerCase());
      const latIdx = header.indexOf('latitude');
      const lonIdx = header.indexOf('longitude');
      const frpIdx = header.indexOf('frp');
      const dateIdx = header.indexOf('acq_date');
      const timeIdx = header.indexOf('acq_time');
      const satIdx = header.indexOf('satellite');
      const confIdx = header.indexOf('confidence');
      const dnIdx = header.indexOf('daynight');
      const ti4Idx = header.indexOf('bright_ti4');
      const ti5Idx = header.indexOf('bright_ti5');
      const scanIdx = header.indexOf('scan');
      const trackIdx = header.indexOf('track');

      const stats = { total: 0, normalized: 0, invalid: 0, associated: 0, unassociated: 0, missingContext: 0 };

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        if (cols.length < 4) continue;

        totalObservationsExamined++;
        stats.total++;

        const rawObj: Record<string, any> = {
          latitude: parseFloat(cols[latIdx]),
          longitude: parseFloat(cols[lonIdx]),
          frp: frpIdx >= 0 ? parseFloat(cols[frpIdx]) : 0,
          acq_date: dateIdx >= 0 ? cols[dateIdx] : undefined,
          acq_time: timeIdx >= 0 ? cols[timeIdx] : undefined,
          satellite: satIdx >= 0 ? cols[satIdx] : undefined,
          confidence: confIdx >= 0 ? cols[confIdx] : undefined,
          day_night: dnIdx >= 0 ? cols[dnIdx] : undefined,
          brightness_ti4: ti4Idx >= 0 ? parseFloat(cols[ti4Idx]) : undefined,
          brightness_ti5: ti5Idx >= 0 ? parseFloat(cols[ti5Idx]) : undefined,
          scan: scanIdx >= 0 ? parseFloat(cols[scanIdx]) : undefined,
          track: trackIdx >= 0 ? parseFloat(cols[trackIdx]) : undefined,
          raw_record: lines[i],
        };

        const res = processFirmsObservation(rawObj);
        if (res.processing_status === 'SUCCESS' || res.processing_status === 'OUT_OF_SCOPE') {
          totalSuccessfullyNormalized++;
          stats.normalized++;

          const pKey = getPhysicalKey(res.source_observation);
          uniquePhysicalKeys.add(pKey);

          if (res.derived_context.is_associated) {
            totalFacilityAssociated++;
            stats.associated++;
            uniqueAssociatedKeys.add(pKey);
          } else {
            totalUnassociated++;
            stats.unassociated++;
            uniqueUnassociatedKeys.add(pKey);
          }

          if (res.source_observation.brightness_ti5 === null || res.source_observation.scan === null) {
            totalMissingContext++;
            stats.missingContext++;
          }
        } else {
          totalRejectedInvalid++;
          stats.invalid++;
          if (res.processing_status !== 'INVALID_OBSERVATION') {
            totalProcessingFailures++;
          }
        }
      }
      datasetBreakdown[file] = stats;
    }
  }

  const uniquePhysicalCount = uniquePhysicalKeys.size;
  const duplicateRecordsCount = totalObservationsExamined - uniquePhysicalCount;

  console.log('\n--- Real Dataset Breakdown ---');
  for (const [name, stats] of Object.entries(datasetBreakdown)) {
    console.log(`  ${name.padEnd(65)} : ${stats.total.toString().padStart(5)} total | ${stats.normalized.toString().padStart(5)} norm | ${stats.associated.toString().padStart(4)} assoc | ${stats.unassociated.toString().padStart(5)} unassoc | ${stats.invalid} invalid`);
  }

  console.log('\n--- Real Data Pipeline Summary ---');
  console.log(`  Total Source Records Examined      : ${totalObservationsExamined}`);
  console.log(`  Successfully Normalized Records    : ${totalSuccessfullyNormalized}`);
  console.log(`  Unique Physical FIRMS Observations : ${uniquePhysicalCount}`);
  console.log(`  Duplicate Source Records Identified: ${duplicateRecordsCount}`);
  console.log(`  Unique Facility-Associated Hotspots: ${uniqueAssociatedKeys.size}`);
  console.log(`  Unique Unassociated Hotspots       : ${uniqueUnassociatedKeys.size}`);
  console.log(`  Observations with Missing Context  : ${totalMissingContext}`);
  console.log(`  Processing Failures / Exceptions   : ${totalProcessingFailures}`);

  assert(totalObservationsExamined === 5086, `Expected total source record count (5086 records)`);
  assert(uniquePhysicalCount === 3855, `Exact unique physical observation count (3855 observations)`);
  assert(duplicateRecordsCount === 1231, `Exact duplicate source record count (1231 duplicates)`);
  assert(totalSuccessfullyNormalized === 5086, `High normalization success rate (5086 normalized)`);
  assert(totalProcessingFailures === 0, `Zero unexpected processing failures (0 failures)`);

  console.log('\n' + '='.repeat(80));
  console.log(`TEST SUITE RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('='.repeat(80));

  if (failed > 0) {
    process.exit(1);
  }
}

// Execute test suite if run directly
runGenericFirmsPipelineTestSuite();
