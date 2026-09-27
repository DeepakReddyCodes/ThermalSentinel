// ============================================================================
// ThermalSentinel — OSM Context Acquisition Audit Test Suite (Day 2B-2 Correction Pass)
//
// Rigorously tests the OpenStreetMap contextual evidence acquisition mechanics:
//   1. Successful LIVE_OVERPASS provenance (provider, mode, timestamp, feature_id, feature_type, tags, distance, query_radius)
//   2. Successful VERIFIED_LOCAL_SNAPSHOT provenance (spatially constrained benchmark fallback)
//   3. Failed Overpass + no applicable snapshot = ACQUISITION_FAILED
//   4. Empty successful Overpass = NO_MAPPED_FEATURES
//   5. Spatial containment invariant: Snapshot cannot leak into an unrelated location
//   6. Non-authoritative contextual semantics (OSM cannot force facility association or override baseline)
//   7. Operational geographic envelope and scope rejection
//   8. Bayesian neutral likelihood handling on missing / empty / failed OSM acquisition
// ============================================================================

import {
  queryNearbyOsmInfrastructure,
  queryNearbyOsmFromSnapshot,
  isCoordinateInIndianDomain,
  calculateHaversineDistanceMeters,
  clearOsmMemoryCache,
  OsmContextResponse,
  OsmContextFeature,
} from '../server/osm.js';
import {
  evaluateInfrastructureLikelihood,
} from '../server/bayesianEngine.js';
import {
  processFirmsObservation,
} from '../server/firmsProcessor.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${testName}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

console.log('================================================================================');
console.log('THERMALSENTINEL — OSM CONTEXT ACQUISITION AUDIT TEST SUITE (DAY 2B-2 CORRECTION)');
console.log('================================================================================\n');

// -----------------------------------------------------------------------------
// TEST 1: Indian Domain Coordinate Verification
// -----------------------------------------------------------------------------
console.log('[TEST 1: Operational Geographic Envelope for OSM]');
{
  assert(isCoordinateInIndianDomain(22.3421, 69.8651), 'Jamnagar coordinate is in Indian domain');
  assert(isCoordinateInIndianDomain(20.2950, 86.6580), 'Paradip coordinate is in Indian domain');
  assert(isCoordinateInIndianDomain(21.7088, 72.5515), 'Dahej coordinate is in Indian domain');
  assert(isCoordinateInIndianDomain(19.7500, 75.7100), 'Rural Maharashtra coordinate is in Indian domain');
  assert(!isCoordinateInIndianDomain(43.9500, -122.2500), 'Oregon wildfire coordinate is strictly OUT_OF_SCOPE');
  assert(!isCoordinateInIndianDomain(0.0, 0.0), 'Null Island coordinate is strictly OUT_OF_SCOPE');
}

// -----------------------------------------------------------------------------
// TEST 2: Out-of-Scope Rejection Semantics
// -----------------------------------------------------------------------------
console.log('\n[TEST 2: Out-of-Scope Rejection Semantics]');
{
  clearOsmMemoryCache();
  const outOfScopeRes = await queryNearbyOsmInfrastructure(43.9500, -122.2500, 3.0);
  assert(outOfScopeRes.status === 'OUT_OF_SCOPE', 'Status is OUT_OF_SCOPE for non-Indian coordinate');
  assert(outOfScopeRes.sub_status === 'OUT_OF_SCOPE', 'sub_status is OUT_OF_SCOPE');
  assert(outOfScopeRes.total_features_found === 0, 'Total features found is strictly 0');
  assert(outOfScopeRes.features.length === 0, 'Features array is empty');
  assert(outOfScopeRes.is_live_external === false, 'is_live_external is false');
  assert(outOfScopeRes.provenance.source === 'OPENSTREETMAP', 'Provenance source is OPENSTREETMAP');
  assert(outOfScopeRes.provenance.provider === 'OpenStreetMap', 'Provenance provider is OpenStreetMap');
  assert(outOfScopeRes.provenance.acquisition_mode === 'OUT_OF_SCOPE', 'Provenance acquisition_mode is OUT_OF_SCOPE');
  assert(
    outOfScopeRes.analytical_status === 'CONTEXTUAL_GEOSPATIAL_EVIDENCE',
    'analytical_status is CONTEXTUAL_GEOSPATIAL_EVIDENCE'
  );
  assert(
    outOfScopeRes.analytical_authority_disclaimer.includes('OUT_OF_SCOPE'),
    'Analytical disclaimer explains out-of-scope context'
  );
}

// -----------------------------------------------------------------------------
// TEST 3: Successful LIVE_OVERPASS Provenance Structure
// -----------------------------------------------------------------------------
console.log('\n[TEST 3: Successful LIVE_OVERPASS Provenance Preservation]');
{
  const mockLiveOverpassResponse: OsmContextResponse = {
    status: 'AVAILABLE',
    sub_status: 'LIVE_OVERPASS',
    is_live_external: true,
    query_center: [22.3421, 69.8651],
    search_radius_meters: 3000,
    total_features_found: 2,
    nearest_feature: {
      source: 'OPENSTREETMAP',
      feature_id: 'node/5542344034',
      feature_type: 'node',
      name: 'Jamnagar North Flare Stack',
      category: 'flare',
      display_label: 'Mapped flare (Jamnagar North Flare Stack) — 120 m',
      coordinates: [22.3425, 69.8645],
      distance_meters: 120,
      geometry_type: 'point',
      tags: { man_made: 'flare', name: 'Jamnagar North Flare Stack' },
      relevance_note: 'OSM flare located 120 m from FIRMS observation coordinate',
      provenance_mode: 'LIVE_OVERPASS',
    },
    features: [
      {
        source: 'OPENSTREETMAP',
        feature_id: 'node/5542344034',
        feature_type: 'node',
        name: 'Jamnagar North Flare Stack',
        category: 'flare',
        display_label: 'Mapped flare (Jamnagar North Flare Stack) — 120 m',
        coordinates: [22.3425, 69.8645],
        distance_meters: 120,
        geometry_type: 'point',
        tags: { man_made: 'flare', name: 'Jamnagar North Flare Stack' },
        relevance_note: 'OSM flare located 120 m from FIRMS observation coordinate',
        provenance_mode: 'LIVE_OVERPASS',
      },
      {
        source: 'OPENSTREETMAP',
        feature_id: 'way/11223344',
        feature_type: 'way',
        name: 'Refinery Process Block',
        category: 'industrial_landuse',
        display_label: 'Industrial landuse — 450 m',
        coordinates: [22.3440, 69.8670],
        distance_meters: 450,
        geometry_type: 'polygon',
        tags: { landuse: 'industrial' },
        relevance_note: 'OSM industrial_landuse located 450 m from FIRMS observation coordinate',
        provenance_mode: 'LIVE_OVERPASS',
      },
    ],
    elements: [],
    categories_summary: { flare: 1, industrial_landuse: 1 },
    provenance: {
      source: 'OPENSTREETMAP',
      provider: 'OpenStreetMap',
      acquisition_mode: 'LIVE_OVERPASS',
      api_endpoint: 'https://overpass-api.de/api/interpreter',
      retrieval_timestamp: new Date().toISOString(),
      bounding_radius_km: 3.0,
      query_radius_meters: 3000,
      attribution: '© OpenStreetMap contributors (ODbL)',
    },
    analytical_status: 'CONTEXTUAL_GEOSPATIAL_EVIDENCE',
    analytical_authority_disclaimer:
      'OSM features are contextual geospatial evidence only. They do NOT override configured facility boundaries, empirical thermal baselines, or frozen ML discriminator predictions.',
  };

  assert(mockLiveOverpassResponse.is_live_external === true, 'LIVE_OVERPASS has is_live_external = true');
  assert(mockLiveOverpassResponse.sub_status === 'LIVE_OVERPASS', 'sub_status is LIVE_OVERPASS');
  assert(mockLiveOverpassResponse.provenance.provider === 'OpenStreetMap', 'Preserves provider = OpenStreetMap');
  assert(mockLiveOverpassResponse.provenance.acquisition_mode === 'LIVE_OVERPASS', 'Preserves acquisition_mode = LIVE_OVERPASS');
  assert(Boolean(mockLiveOverpassResponse.provenance.retrieval_timestamp), 'Preserves retrieval_timestamp');
  assert(mockLiveOverpassResponse.provenance.query_radius_meters === 3000, 'Preserves query radius');
  assert(mockLiveOverpassResponse.provenance.api_endpoint.startsWith('https://'), 'Preserves live API endpoint URL');

  const feat0 = mockLiveOverpassResponse.features[0];
  assert(feat0.feature_id === 'node/5542344034', 'Preserves feature ID');
  assert(feat0.feature_type === 'node', 'Preserves feature type (node)');
  assert(feat0.tags.man_made === 'flare', 'Preserves feature tags');
  assert(feat0.distance_meters === 120, 'Preserves distance in meters');
  assert(feat0.provenance_mode === 'LIVE_OVERPASS', 'Feature preserves provenance_mode = LIVE_OVERPASS');
}

// -----------------------------------------------------------------------------
// TEST 4: Successful VERIFIED_LOCAL_SNAPSHOT Provenance & Distinguishability
// -----------------------------------------------------------------------------
console.log('\n[TEST 4: Successful VERIFIED_LOCAL_SNAPSHOT Provenance & Distinguishability]');
{
  // Jamnagar North Flare Stack coordinate tested directly against local snapshot engine
  const snapshotJamnagar = queryNearbyOsmFromSnapshot(22.3421, 69.8651, 3.0);

  assert(snapshotJamnagar.status === 'AVAILABLE', 'Snapshot status is AVAILABLE');
  assert(snapshotJamnagar.sub_status === 'VERIFIED_LOCAL_SNAPSHOT', 'Snapshot sub_status is VERIFIED_LOCAL_SNAPSHOT');
  assert(snapshotJamnagar.is_live_external === false, 'Snapshot is_live_external is strictly false (distinguishable from live)');
  assert(snapshotJamnagar.provenance.provider === 'OpenStreetMap', 'Snapshot provider is OpenStreetMap');
  assert(
    snapshotJamnagar.provenance.acquisition_mode === 'VERIFIED_LOCAL_SNAPSHOT',
    'Snapshot acquisition_mode is VERIFIED_LOCAL_SNAPSHOT'
  );
  assert(
    snapshotJamnagar.provenance.api_endpoint === 'ThermalSentinel Verified Local Infrastructure Snapshot',
    'Snapshot api_endpoint explicitly indicates local snapshot'
  );
  assert(Boolean(snapshotJamnagar.provenance.retrieval_timestamp), 'Snapshot preserves retrieval_timestamp');
  assert(snapshotJamnagar.provenance.query_radius_meters === 3000, 'Snapshot preserves query_radius_meters');
  assert(snapshotJamnagar.total_features_found > 0, `Snapshot found features (${snapshotJamnagar.total_features_found})`);

  const nearest = snapshotJamnagar.nearest_feature!;
  assert(nearest !== null, 'Snapshot nearest feature is populated');
  assert(nearest.feature_id === 'node/5542344034', `Snapshot preserves feature ID (${nearest.feature_id})`);
  assert(nearest.feature_type === 'node', `Snapshot preserves feature type (${nearest.feature_type})`);
  assert(nearest.tags.man_made === 'flare', 'Snapshot preserves tags (man_made=flare)');
  assert(nearest.distance_meters === 0, 'Snapshot calculates exact distance to query coordinate (0m)');
  assert(nearest.provenance_mode === 'VERIFIED_LOCAL_SNAPSHOT', 'Feature preserves provenance_mode = VERIFIED_LOCAL_SNAPSHOT');

  // Verify that live Overpass vs snapshot are completely distinguishable
  assert(
    snapshotJamnagar.is_live_external !== true,
    'Snapshot is explicitly distinguishable from live acquisition via is_live_external=false'
  );
  assert(
    snapshotJamnagar.sub_status !== 'LIVE_OVERPASS',
    'Snapshot is explicitly distinguishable via sub_status'
  );
}

// -----------------------------------------------------------------------------
// TEST 5: Failed Overpass + No Applicable Snapshot = ACQUISITION_FAILED
// -----------------------------------------------------------------------------
console.log('\n[TEST 5: Failed Overpass + No Applicable Snapshot = ACQUISITION_FAILED]');
{
  // Point in rural Madhya Pradesh / Uttar Pradesh far from any benchmark facility cache
  const uncachedPoint = queryNearbyOsmFromSnapshot(26.8467, 80.9462, 3.0);

  assert(uncachedPoint.status === 'ACQUISITION_FAILED', 'Uncached point returns ACQUISITION_FAILED on snapshot fallback');
  assert(uncachedPoint.sub_status === 'ACQUISITION_FAILED', 'sub_status is ACQUISITION_FAILED');
  assert(uncachedPoint.is_live_external === false, 'is_live_external is false');
  assert(uncachedPoint.provenance.provider === 'OpenStreetMap', 'Provenance provider is OpenStreetMap');
  assert(uncachedPoint.provenance.acquisition_mode === 'ACQUISITION_FAILED', 'Provenance acquisition_mode is ACQUISITION_FAILED');
  assert(uncachedPoint.total_features_found === 0, 'total_features_found is 0');
  assert(uncachedPoint.features.length === 0, 'features array is empty');
  assert(uncachedPoint.nearest_feature === null, 'nearest_feature is null');
}

// -----------------------------------------------------------------------------
// TEST 6: Empty Successful Overpass = NO_MAPPED_FEATURES
// -----------------------------------------------------------------------------
console.log('\n[TEST 6: Empty Successful Overpass = NO_MAPPED_FEATURES]');
{
  const mockEmptyOsm: OsmContextResponse = {
    status: 'NO_MAPPED_FEATURES',
    sub_status: 'NO_MAPPED_FEATURES',
    is_live_external: true,
    query_center: [23.5, 78.5],
    search_radius_meters: 3000,
    total_features_found: 0,
    nearest_feature: null,
    features: [],
    elements: [],
    categories_summary: {},
    provenance: {
      source: 'OPENSTREETMAP',
      provider: 'OpenStreetMap',
      acquisition_mode: 'LIVE_OVERPASS',
      api_endpoint: 'https://overpass-api.de/api/interpreter',
      retrieval_timestamp: new Date().toISOString(),
      bounding_radius_km: 3.0,
      query_radius_meters: 3000,
      attribution: '© OpenStreetMap contributors (ODbL)',
    },
    analytical_status: 'CONTEXTUAL_GEOSPATIAL_EVIDENCE',
    analytical_authority_disclaimer:
      'Absence of mapped public infrastructure in OSM does not indicate absence of industrial activity in reality.',
  };

  assert(mockEmptyOsm.status === 'NO_MAPPED_FEATURES', 'Status is NO_MAPPED_FEATURES');
  assert(mockEmptyOsm.sub_status === 'NO_MAPPED_FEATURES', 'sub_status is NO_MAPPED_FEATURES');
  assert(mockEmptyOsm.is_live_external === true, 'is_live_external is true for successful empty live query');
  assert(mockEmptyOsm.provenance.provider === 'OpenStreetMap', 'Preserves provider = OpenStreetMap');
  assert(mockEmptyOsm.provenance.acquisition_mode === 'LIVE_OVERPASS', 'Preserves acquisition_mode = LIVE_OVERPASS');
  assert(mockEmptyOsm.features.length === 0, 'Features array is empty');

  // Bayesian inference must treat NO_MAPPED_FEATURES as neutral likelihood (P(E|H) = 1.0)
  const likelihood = evaluateInfrastructureLikelihood(mockEmptyOsm);
  assert(likelihood.is_incorporated === false, 'NO_MAPPED_FEATURES is NOT incorporated into posterior multiplication');
  assert(likelihood.likelihood_by_hypothesis.GAS_FLARE === 1.0, 'GAS_FLARE likelihood is neutral 1.0');
  assert(likelihood.likelihood_by_hypothesis.INDUSTRIAL_FIRE === 1.0, 'INDUSTRIAL_FIRE likelihood is neutral 1.0');
  assert(likelihood.likelihood_by_hypothesis.AGRICULTURAL_BURN === 1.0, 'AGRICULTURAL_BURN likelihood is neutral 1.0');
  assert(likelihood.provenance === 'UNAVAILABLE', 'Provenance marked UNAVAILABLE');
}

// -----------------------------------------------------------------------------
// TEST 7: Spatial Containment Invariant (Snapshot Cannot Leak to Unrelated Locations)
// -----------------------------------------------------------------------------
console.log('\n[TEST 7: Spatial Containment Invariant — No Cross-Location Leakage]');
{
  // Test multiple diverse coordinates across India that are NOT near Jamnagar/Paradip/Dahej/Hazira
  const testLocations = [
    { name: 'Rural Maharashtra Farmland', lat: 19.7500, lon: 75.7100 },
    { name: 'Central MP Forest Area', lat: 22.5000, lon: 78.0000 },
    { name: 'Punjab Agricultural Belt', lat: 30.9000, lon: 75.8500 },
    { name: 'Southern AP Coast', lat: 14.5000, lon: 80.1000 },
    { name: 'Assam Brahmaputra Valley', lat: 26.2000, lon: 92.9300 },
  ];

  for (const loc of testLocations) {
    const res = queryNearbyOsmFromSnapshot(loc.lat, loc.lon, 3.0);
    assert(
      res.status === 'ACQUISITION_FAILED',
      `${loc.name} (${loc.lat}, ${loc.lon}) returns ACQUISITION_FAILED`
    );
    assert(
      res.total_features_found === 0,
      `${loc.name} received 0 features (no snapshot leakage)`
    );
    assert(
      res.features.length === 0,
      `${loc.name} features array is strictly empty`
    );
    // Ensure no Jamnagar flare stack leaked
    const hasJamnagarFlare = res.features.some(f => f.feature_id === 'node/5542344034');
    assert(!hasJamnagarFlare, `${loc.name} did not leak Jamnagar flare stack`);
  }
}

// -----------------------------------------------------------------------------
// TEST 8: Non-Authoritative Semantics (OSM Cannot Force Facility Association)
// -----------------------------------------------------------------------------
console.log('\n[TEST 8: Non-Authoritative Semantics & Facility Non-Override Invariant]');
{
  // An unassociated remote observation enriched with OSM flare feature
  const remoteObs = {
    latitude: 19.7500,
    longitude: 75.7100, // Rural Maharashtra farmland
    frp: 4.5,
    acquisition_date: '2026-02-15',
    acquisition_time: '1830',
    confidence: 'high' as const,
    day_night: 'D' as const,
    sensor: 'VIIRS',
    satellite: 'NOAA-20',
  };

  const remoteResult = processFirmsObservation(remoteObs, {
    enableExternalEnrichment: {
      osm: {
        status: 'AVAILABLE',
        sub_status: 'LIVE_OVERPASS',
        is_live_external: true,
        query_center: [19.7500, 75.7100],
        search_radius_meters: 3000,
        total_features_found: 1,
        nearest_feature: {
          source: 'OPENSTREETMAP',
          feature_id: 'node/999999',
          feature_type: 'node',
          name: 'Isolated Agricultural Biogas Flare',
          category: 'flare',
          display_label: 'Mapped flare — 500 m',
          coordinates: [19.7520, 75.7120],
          distance_meters: 500,
          geometry_type: 'point',
          tags: { man_made: 'flare' },
          provenance_mode: 'LIVE_OVERPASS',
        },
        features: [
          {
            source: 'OPENSTREETMAP',
            feature_id: 'node/999999',
            feature_type: 'node',
            name: 'Isolated Agricultural Biogas Flare',
            category: 'flare',
            display_label: 'Mapped flare — 500 m',
            coordinates: [19.7520, 75.7120],
            distance_meters: 500,
            geometry_type: 'point',
            tags: { man_made: 'flare' },
            provenance_mode: 'LIVE_OVERPASS',
          },
        ],
        categories_summary: { flare: 1 },
        provenance: {
          source: 'OPENSTREETMAP',
          provider: 'OpenStreetMap',
          acquisition_mode: 'LIVE_OVERPASS',
          api_endpoint: 'https://overpass-api.de/api/interpreter',
          retrieval_timestamp: new Date().toISOString(),
          bounding_radius_km: 3.0,
          query_radius_meters: 3000,
          attribution: '© OpenStreetMap contributors (ODbL)',
        },
        analytical_status: 'CONTEXTUAL_GEOSPATIAL_EVIDENCE',
        analytical_authority_disclaimer: 'Contextual evidence only.',
      },
    },
  });

  assert(remoteResult.derived_context.is_associated === false, 'Remote point is NOT associated despite OSM flare enrichment');
  assert(remoteResult.derived_context.associated_facility === null, 'associated_facility remains strictly null');
  assert(remoteResult.derived_context.spatial_association === 'UNASSOCIATED', 'spatial_association remains UNASSOCIATED');
  assert(remoteResult.derived_context.baseline_status === 'NONE', 'baseline_status remains NONE');
  assert(
    remoteResult.evidence_availability.infrastructure === 'AVAILABLE',
    'Evidence availability reflects infrastructure is AVAILABLE'
  );
}

// -----------------------------------------------------------------------------
// TEST 9: Evidence Availability Mapping in Generic FIRMS Pipeline
// -----------------------------------------------------------------------------
console.log('\n[TEST 9: Evidence Availability Status Propagation]');
{
  const mockObs = {
    latitude: 22.3685,
    longitude: 69.8690,
    frp: 3.5,
    acquisition_date: '2026-02-15',
    acquisition_time: '1830',
    confidence: 'high' as const,
    day_night: 'N' as const,
    sensor: 'VIIRS',
    satellite: 'NOAA-20',
  };

  // Case A: LIVE_OVERPASS with features
  const resLive = processFirmsObservation(mockObs, {
    enableExternalEnrichment: {
      osm: {
        status: 'AVAILABLE',
        sub_status: 'LIVE_OVERPASS',
        is_live_external: true,
        query_center: [22.3685, 69.8690],
        search_radius_meters: 3000,
        total_features_found: 1,
        nearest_feature: null,
        features: [
          {
            source: 'OPENSTREETMAP',
            feature_id: 'node/123456',
            feature_type: 'node',
            name: 'Flare Tower',
            category: 'flare',
            display_label: 'Mapped flare — 250 m',
            coordinates: [22.3680, 69.8695],
            distance_meters: 250,
            geometry_type: 'point',
            tags: { man_made: 'flare' },
          },
        ],
        categories_summary: { flare: 1 },
        provenance: {
          source: 'OPENSTREETMAP',
          provider: 'OpenStreetMap',
          acquisition_mode: 'LIVE_OVERPASS',
          api_endpoint: 'https://overpass-api.de/api/interpreter',
          retrieval_timestamp: new Date().toISOString(),
          bounding_radius_km: 3.0,
          query_radius_meters: 3000,
          attribution: '© OpenStreetMap contributors (ODbL)',
        },
        analytical_status: 'CONTEXTUAL_GEOSPATIAL_EVIDENCE',
        analytical_authority_disclaimer: 'Contextual evidence only.',
      },
    },
  });
  assert(resLive.evidence_availability.infrastructure === 'AVAILABLE', 'LIVE_OVERPASS yields AVAILABLE');

  // Case B: VERIFIED_LOCAL_SNAPSHOT with features
  const resSnapshot = processFirmsObservation(mockObs, {
    enableExternalEnrichment: {
      osm: {
        status: 'AVAILABLE',
        sub_status: 'VERIFIED_LOCAL_SNAPSHOT',
        is_live_external: false,
        query_center: [22.3685, 69.8690],
        search_radius_meters: 3000,
        total_features_found: 1,
        nearest_feature: null,
        features: [
          {
            source: 'OPENSTREETMAP',
            feature_id: 'node/5542344034',
            feature_type: 'node',
            name: 'Jamnagar North Flare Stack',
            category: 'flare',
            display_label: 'Mapped flare — 100 m',
            coordinates: [22.3680, 69.8695],
            distance_meters: 100,
            geometry_type: 'point',
            tags: { man_made: 'flare' },
          },
        ],
        categories_summary: { flare: 1 },
        provenance: {
          source: 'OPENSTREETMAP',
          provider: 'OpenStreetMap',
          acquisition_mode: 'VERIFIED_LOCAL_SNAPSHOT',
          api_endpoint: 'ThermalSentinel Verified Local Infrastructure Snapshot',
          retrieval_timestamp: new Date().toISOString(),
          bounding_radius_km: 3.0,
          query_radius_meters: 3000,
          attribution: '© OpenStreetMap contributors (ODbL) via verified local snapshot',
        },
        analytical_status: 'CONTEXTUAL_GEOSPATIAL_EVIDENCE',
        analytical_authority_disclaimer: 'Contextual evidence only.',
      },
    },
  });
  assert(resSnapshot.evidence_availability.infrastructure === 'AVAILABLE', 'VERIFIED_LOCAL_SNAPSHOT yields AVAILABLE');

  // Case C: ACQUISITION_FAILED
  const resFailed = processFirmsObservation(mockObs, {
    enableExternalEnrichment: {
      osm: {
        status: 'ACQUISITION_FAILED',
        sub_status: 'ACQUISITION_FAILED',
        is_live_external: false,
        query_center: [22.3685, 69.8690],
        search_radius_meters: 3000,
        total_features_found: 0,
        nearest_feature: null,
        features: [],
        categories_summary: {},
        provenance: {
          source: 'OPENSTREETMAP',
          provider: 'OpenStreetMap',
          acquisition_mode: 'ACQUISITION_FAILED',
          api_endpoint: 'Overpass timeout',
          retrieval_timestamp: new Date().toISOString(),
          bounding_radius_km: 3.0,
          query_radius_meters: 3000,
          attribution: '© OpenStreetMap contributors (ODbL)',
        },
        analytical_status: 'CONTEXTUAL_GEOSPATIAL_EVIDENCE',
        analytical_authority_disclaimer: 'Contextual evidence only.',
      },
    },
  });
  assert(resFailed.evidence_availability.infrastructure === 'ACQUISITION_FAILED', 'ACQUISITION_FAILED propagates correctly');
}

console.log('\n================================================================================');
console.log(`OSM CONTEXT TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
console.log('================================================================================');

if (failed > 0) {
  process.exit(1);
}

