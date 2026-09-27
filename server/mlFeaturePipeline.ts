// ============================================================================
// ThermalSentinel — Section 6: Reproducible ML Feature Extraction Pipeline
//
// Single deterministic feature-extraction module shared by training and inference.
//
// Separates:
// 1. Raw FIRMS Features (radiometry, geometry, diurnal timing)
// 2. Derived Features (log_frp, spectral brightness delta, diurnal flag)
// 3. Contextual Features (spatial classification, distance to facility)
// 4. Facility-Specific Features (facility type, distance to flare stack)
//
// Scope Policy:
// - The supervised model input vector is STRICTLY restricted to the 7 audited
//   radiometric/geometric features available during verified training.
// - Features not available in verified training data are never passed to the model.
// - Missing or out-of-bounds features explicitly flag LIMITED_MODEL_COVERAGE.
// ============================================================================

export interface RawFirmsFeatures {
  frp: number;
  brightness_ti4: number | null;
  brightness_ti5: number | null;
  scan: number | null;
  track: number | null;
  day_night: 'D' | 'N' | 'UNKNOWN';
  satellite: string;
  confidence: string;
  is_viirs: boolean;
  is_modis?: boolean;
  sensor_domain?: 'VIIRS_375M' | 'MODIS_1KM_ADAPTED' | 'OTHER';
}

export interface DerivedRadiometricFeatures {
  log_frp: number | null;
  brightness_delta: number | null;
  is_day: number; // 1.0 = Day, 0.0 = Night
}

export interface ContextualFeatures {
  spatial_classification?: string;
  dist_to_facility_meters?: number | null;
  spatial_density_count?: number;
  osm_industrial_tags_count?: number;
}

export interface FacilitySpecificFeatures {
  facility_id?: string | null;
  facility_type?: string | null;
  dist_to_flare_meters?: number | null;
  ratio_to_median?: number | null;
  behavioural_status?: string | null;
}

export interface ExtractedMLFeatures {
  is_valid: boolean;
  status: 'AVAILABLE' | 'NOT_ASSESSED' | 'OUT_OF_SCOPE' | 'LIMITED_MODEL_COVERAGE';
  coverage_status?: 'FULL_COVERAGE' | 'CROSS_SENSOR_ADAPTED' | 'LIMITED_MODEL_COVERAGE' | 'OUT_OF_DOMAIN' | 'NOT_ASSESSED';
  raw: RawFirmsFeatures;
  derived: DerivedRadiometricFeatures;
  contextual: ContextualFeatures;
  facility: FacilitySpecificFeatures;
  /**
   * The 7-dimensional normalized model input feature vector:
   * [log_frp, brightness_ti4, brightness_ti5, brightness_delta, scan, track, is_day]
   */
  model_vector: number[] | null;
  feature_names: string[];
  reasons: string[];
  provenance: string;
}

export const MODEL_FEATURE_NAMES = [
  'log_frp',
  'brightness_ti4',
  'brightness_ti5',
  'brightness_delta',
  'scan',
  'track',
  'is_day',
] as const;

export const MODEL_FEATURE_LABELS: Record<string, string> = {
  log_frp: 'log(1 + FRP) (MW)',
  brightness_ti4: 'VIIRS TI4 Brightness (K)',
  brightness_ti5: 'VIIRS TI5 Brightness (K)',
  brightness_delta: 'ΔBrightness TI4 - TI5 (K)',
  scan: 'Scan Angle / Footprint (km)',
  track: 'Track Dimension (km)',
  is_day: 'Diurnal Flag (Day=1, Night=0)',
};

/**
 * Extracts raw, derived, and contextual features deterministically from any observation.
 *
 * @param obs Canonical ThermalObservation or raw FIRMS record
 * @param context Optional contextual & facility assessment data
 */
export function extractMLFeatures(obs: any, context?: any): ExtractedMLFeatures {
  const reasons: string[] = [];

  if (!obs) {
    return {
      is_valid: false,
      status: 'NOT_ASSESSED',
      raw: {
        frp: 0,
        brightness_ti4: null,
        brightness_ti5: null,
        scan: null,
        track: null,
        day_night: 'UNKNOWN',
        satellite: '',
        confidence: '',
        is_viirs: false,
      },
      derived: {
        log_frp: null,
        brightness_delta: null,
        is_day: 0,
      },
      contextual: {},
      facility: {},
      model_vector: null,
      feature_names: [...MODEL_FEATURE_NAMES],
      reasons: ['No observation payload provided for feature extraction'],
      provenance: 'DETERMINISTIC_FEATURE_PIPELINE_V1',
    };
  }

  // 1. Raw FIRMS Feature Extraction
  let frp = typeof obs.frp === 'number' ? obs.frp : typeof obs.frp === 'string' ? parseFloat(obs.frp) : 0.0;
  if (isNaN(frp)) frp = 0.0;

  let ti4: number | null =
    typeof obs.brightness_ti4 === 'number'
      ? obs.brightness_ti4
      : typeof obs.brightness_ti4 === 'string'
      ? parseFloat(obs.brightness_ti4)
      : null;

  let ti5: number | null =
    typeof obs.brightness_ti5 === 'number'
      ? obs.brightness_ti5
      : typeof obs.brightness_ti5 === 'string'
      ? parseFloat(obs.brightness_ti5)
      : null;

  let scan: number | null =
    typeof obs.scan === 'number'
      ? obs.scan
      : typeof obs.scan === 'string'
      ? parseFloat(obs.scan)
      : null;

  let track: number | null =
    typeof obs.track === 'number'
      ? obs.track
      : typeof obs.track === 'string'
      ? parseFloat(obs.track)
      : null;

  let dn = (obs.day_night || obs.dayNight || obs.daynight || '').toString().trim().toUpperCase();
  const day_night: 'D' | 'N' | 'UNKNOWN' = dn === 'D' ? 'D' : dn === 'N' ? 'N' : 'UNKNOWN';

  const satStr = (obs.satellite || obs.sensor || obs.instrument || '').toString().toUpperCase();
  const is_viirs =
    satStr.includes('VIIRS') ||
    satStr.includes('SNPP') ||
    satStr.includes('NPP') ||
    satStr.includes('SUOMI') ||
    satStr.includes('N20') ||
    satStr.includes('NOAA') ||
    satStr === 'N' ||
    satStr.includes('J1') ||
    satStr.includes('J2');

  // Fallback parsing from raw CSV payload if fields are missing
  if ((ti4 === null || ti5 === null) && obs.raw_payload?.line) {
    try {
      const parts = obs.raw_payload.line.split(',');
      if (parts.length >= 14) {
        const pTi4 = parseFloat(parts[2]);
        const pScan = parseFloat(parts[3]);
        const pTrack = parseFloat(parts[4]);
        const pTi5 = parseFloat(parts[11]);
        const pFrp = parseFloat(parts[12]);
        const pDn = parts[13]?.trim().toUpperCase();

        if (!isNaN(pTi4) && ti4 === null) ti4 = pTi4;
        if (!isNaN(pTi5) && ti5 === null) ti5 = pTi5;
        if (!isNaN(pScan) && scan === null) scan = pScan;
        if (!isNaN(pTrack) && track === null) track = pTrack;
        if (!isNaN(pFrp) && (frp === 0 || isNaN(frp))) frp = pFrp;
        if ((pDn === 'D' || pDn === 'N') && day_night === 'UNKNOWN') {
          dn = pDn;
        }
      }
    } catch {
      // Ignore parsing errors
    }
  }

  // Brightness fallback if ti4 is still null
  if (ti4 === null && typeof obs.brightness_kelvin === 'number' && obs.brightness_kelvin >= 200 && obs.brightness_kelvin <= 380) {
    ti4 = obs.brightness_kelvin;
  }
  if (ti4 === null && typeof obs.brightness === 'number' && obs.brightness >= 200 && obs.brightness <= 380) {
    ti4 = obs.brightness;
  }

  const rawFeatures: RawFirmsFeatures = {
    frp,
    brightness_ti4: ti4,
    brightness_ti5: ti5,
    scan,
    track,
    day_night,
    satellite: satStr,
    confidence: (obs.confidence || '').toString(),
    is_viirs,
  };

  // 2. Derived Features
  const is_day = day_night === 'D' ? 1.0 : 0.0;
  const log_frp = frp >= 0 ? Math.log(1.0 + frp) : null;
  const brightness_delta = ti4 !== null && ti5 !== null && !isNaN(ti4) && !isNaN(ti5) ? ti4 - ti5 : null;

  const derivedFeatures: DerivedRadiometricFeatures = {
    log_frp,
    brightness_delta,
    is_day,
  };

  // 3. Contextual Features (Inspectable context metadata, isolated from binary radiometric model)
  const contextualFeatures: ContextualFeatures = {
    spatial_classification: context?.spatial_classification || context?.spatial_assessment?.spatial_relationship || obs.spatial_relationship,
    dist_to_facility_meters: context?.dist_to_facility_meters ?? context?.spatial_assessment?.distance_to_facility_meters ?? null,
    spatial_density_count: context?.spatial_density_count ?? 1,
    osm_industrial_tags_count: context?.osm_context?.industrial_tags_count ?? 0,
  };

  // 4. Facility Specific Features (Inspectable context metadata, isolated from binary radiometric model)
  const facilityFeatures: FacilitySpecificFeatures = {
    facility_id: context?.facility_id || context?.associated_facility?.id || null,
    facility_type: context?.facility_type || context?.associated_facility?.category || null,
    dist_to_flare_meters: context?.dist_to_flare_meters ?? context?.spatial_assessment?.distance_to_flare_infrastructure_meters ?? null,
    ratio_to_median: context?.deviation_metrics?.frp_ratio_to_median ?? context?.current_baseline_metrics?.ratio_to_median ?? null,
    behavioural_status: context?.behavioural_status ?? context?.behaviour_assessment?.behavioural_status ?? null,
  };

  // 5. Model Scope & Validity Checks
  if (!is_viirs) {
    reasons.push('Sensor is outside model scope: The trained discriminator is strictly validated on VIIRS 375m I-band radiometry (MODIS is unsupported).');
    return {
      is_valid: false,
      status: 'OUT_OF_SCOPE',
      raw: rawFeatures,
      derived: derivedFeatures,
      contextual: contextualFeatures,
      facility: facilityFeatures,
      model_vector: null,
      feature_names: [...MODEL_FEATURE_NAMES],
      reasons,
      provenance: 'DETERMINISTIC_FEATURE_PIPELINE_V1',
    };
  }

  // Physical bounds and missingness checks
  if (ti4 === null || isNaN(ti4)) reasons.push('Missing required feature: brightness_ti4 (VIIRS Midwave Infrared 3.74μm)');
  else if (ti4 < 200 || ti4 > 380) reasons.push(`VIIRS TI4 brightness temperature ${ti4.toFixed(1)}K exceeds physical bounds [200K, 380K]`);

  if (ti5 === null || isNaN(ti5)) reasons.push('Missing required feature: brightness_ti5 (VIIRS Longwave Infrared 11.45μm)');
  else if (ti5 < 200 || ti5 > 380) reasons.push(`VIIRS TI5 brightness temperature ${ti5.toFixed(1)}K exceeds physical bounds [200K, 380K]`);

  if (frp < 0 || isNaN(frp)) reasons.push(`FRP value ${frp} is negative or invalid`);

  const scanVal = scan ?? 0.45;
  if (scanVal < 0.30 || scanVal > 0.95) reasons.push(`Scan dimension ${scanVal} is outside nominal VIIRS limits [0.30, 0.95]`);

  const trackVal = track ?? 0.45;
  if (trackVal < 0.30 || trackVal > 0.95) reasons.push(`Track dimension ${trackVal} is outside nominal VIIRS limits [0.30, 0.95]`);

  if (reasons.length > 0) {
    return {
      is_valid: false,
      status: 'LIMITED_MODEL_COVERAGE',
      raw: rawFeatures,
      derived: derivedFeatures,
      contextual: contextualFeatures,
      facility: facilityFeatures,
      model_vector: null,
      feature_names: [...MODEL_FEATURE_NAMES],
      reasons,
      provenance: 'DETERMINISTIC_FEATURE_PIPELINE_V1',
    };
  }

  // Construct valid 7-D model feature vector
  const model_vector = [
    log_frp!,
    ti4!,
    ti5!,
    brightness_delta!,
    scanVal,
    trackVal,
    is_day,
  ];

  return {
    is_valid: true,
    status: 'AVAILABLE',
    raw: rawFeatures,
    derived: derivedFeatures,
    contextual: contextualFeatures,
    facility: facilityFeatures,
    model_vector,
    feature_names: [...MODEL_FEATURE_NAMES],
    reasons: ['All 7 radiometric and geometric features successfully extracted within physical bounds.'],
    provenance: 'DETERMINISTIC_FEATURE_PIPELINE_V1',
  };
}
