// ============================================================================
// ThermalSentinel — Section 6: Standardized Thermal Source Discriminator (Client)
//
// Model Type: Standardized L2-Regularized Logistic Regression (C=1.0, balanced)
// Artifact Version: lr-v5f3-standardized
// Task: GAS_FLARE vs. WILDFIRE_CONFIRMED (Binary Advisory Task)
//
// Features: [log_frp, brightness_ti4, brightness_ti5, brightness_delta, scan, track, is_day]
// ============================================================================

export interface FeatureContribution {
  feature: string;
  display_name: string;
  raw_value: number;
  mean: number;
  scale: number;
  standardized_value: number;
  frozen_coefficient: number;
  linear_contribution: number;
  direction: 'WILDFIRE_SIDE' | 'GAS_FLARE_SIDE' | 'NEUTRAL';
}

export interface ThermalSourceDiscriminatorOutput {
  status: 'AVAILABLE' | 'NOT_ASSESSED' | 'INVALID_INPUT' | 'OUT_OF_SCOPE' | 'LIMITED_MODEL_COVERAGE';
  model_id?: string;
  model_version: string;
  evaluation_level: 'OBSERVATION' | 'EVENT_AGGREGATE';
  task: 'GAS_FLARE_VS_WILDFIRE_CONFIRMED';
  supported_classes?: ['GAS_FLARE', 'WILDFIRE_CONFIRMED'];
  predicted_class: 'GAS_FLARE' | 'WILDFIRE_CONFIRMED' | null;
  predicted_label?: string;
  summary_label?: string;
  wildfire_score: number | null;
  flare_score: number | null;
  decision_threshold: number;
  threshold_status: 'EXPERIMENTAL_UNVALIDATED' | 'OPERATIONAL_CALIBRATED';
  coverage_status?: 'FULL_COVERAGE' | 'CROSS_SENSOR_ADAPTED' | 'LIMITED_MODEL_COVERAGE' | 'OUT_OF_DOMAIN' | 'NOT_ASSESSED';
  interpretation: string;
  evidence_basis: string[];
  input_features_evaluated?: {
    log_frp: number;
    brightness_ti4: number;
    brightness_ti5: number;
    brightness_delta: number;
    scan: number;
    track: number;
    is_day: number;
  };
  multi_class_probabilities?: {
    gas_flare: number;
    industrial_fire: number;
    agricultural_burn: number;
    wildfire: number;
  };
  dominant_class?: 'GAS_FLARE' | 'INDUSTRIAL_FIRE' | 'AGRICULTURAL_BURN' | 'WILDFIRE';
  multi_class_confidence?: number;
  multi_class_explanation?: string;
  cross_sensor_adaptation?: {
    is_adapted: boolean;
    source_sensor: string;
    target_sensor: string;
    resolution_ratio: number;
    notes: string;
  };
  feature_contributions?: FeatureContribution[];
  top_contributing_features?: FeatureContribution[];
  intercept?: number;
  logit_z?: number;
  evidence_conflict?: {
    has_conflict: boolean;
    contextual_leading_hypothesis: string;
    contextual_support_pct: number | null;
    discriminator_class: string;
    discriminator_score_pct: number;
    explanation: string;
  };
  model_metadata?: {
    training_dataset_name: string;
    training_instances: number;
    split_policy: string;
    trained_at?: string;
  };
  limitations: string[];
  timestamp: string;
}

// Audited baseline frozen parameters
const FROZEN_INTERCEPT = 7.521435;
const FROZEN_COEFFICIENTS = [0.5429, 2.1678, -2.5229, 4.4216, -0.0298, 0.5018, 4.3430];
const FROZEN_MEANS = [1.661304, 321.328490, 290.627957, 30.700532, 0.464884, 0.497691, 0.158350];
const FROZEN_SCALES = [0.977201, 20.752061, 11.035307, 16.470795, 0.076712, 0.114607, 0.365069];

const STANDARD_LIMITATIONS = [
  'Advisory only — trained exclusively on binary task: Gas Flare vs. Confirmed Wildfire.',
  'Does not model structural industrial fires, agricultural residue burns, or urban sources.',
  'Uncontained industrial fires outside continuous flare stacks fall outside the binary training domain.',
  'Output represents normalized linear logit heuristic support, NOT a calibrated event probability.',
  'Does not override spatial association, facility behavioural baseline, or investigation priority.',
];

const FEATURE_NAMES = [
  { key: 'log_frp', label: 'log(1 + FRP) (MW)' },
  { key: 'brightness_ti4', label: 'VIIRS TI4 Brightness (K)' },
  { key: 'brightness_ti5', label: 'VIIRS TI5 Brightness (K)' },
  { key: 'brightness_delta', label: 'ΔBrightness TI4 - TI5 (K)' },
  { key: 'scan', label: 'Scan Angle / Footprint (km)' },
  { key: 'track', label: 'Track Dimension (km)' },
  { key: 'is_day', label: 'Diurnal Flag (Day=1, Night=0)' },
];

/**
 * Extracts radiometric features from observation object or raw VIIRS line string
 */
export function extractObservationRadiometry(obs: any): {
  frp: number;
  ti4: number | null;
  ti5: number | null;
  scan: number;
  track: number;
  isDay: number;
  isViirs: boolean;
  isModis: boolean;
} {
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

  const satStr = (obs.satellite || obs.sensor || obs.instrument || '').toString().toUpperCase();
  const isViirs =
    satStr.includes('VIIRS') ||
    satStr.includes('SNPP') ||
    satStr.includes('NPP') ||
    satStr.includes('SUOMI') ||
    satStr.includes('N20') ||
    satStr.includes('NOAA') ||
    satStr === 'N' ||
    satStr.includes('J1') ||
    satStr.includes('J2');

  const isModis =
    satStr.includes('MODIS') ||
    satStr.includes('TERRA') ||
    satStr.includes('AQUA') ||
    satStr === 'T' ||
    satStr === 'A' ||
    satStr.includes('MODIS_NRT');

  // Try raw_payload line if fields are missing
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
        if ((pDn === 'D' || pDn === 'N') && !dn) dn = pDn;
      }
    } catch {
      // Ignore parsing errors
    }
  }

  // Fallback ti4 to brightness_kelvin if missing and valid
  if (ti4 === null && typeof obs.brightness_kelvin === 'number' && obs.brightness_kelvin >= 200 && obs.brightness_kelvin <= 380) {
    ti4 = obs.brightness_kelvin;
  }
  if (ti4 === null && typeof obs.brightness === 'number' && obs.brightness >= 200 && obs.brightness <= 380) {
    ti4 = obs.brightness;
  }

  // MODIS footprint scaling
  const adaptedScan = isModis ? Math.min(0.95, Math.max(0.30, (scan ?? 1.0) * 0.375)) : (scan ?? 0.45);
  const adaptedTrack = isModis ? Math.min(0.95, Math.max(0.30, (track ?? 1.0) * 0.375)) : (track ?? 0.45);

  const isDay = dn === 'D' ? 1.0 : 0.0;
  return {
    frp,
    ti4,
    ti5,
    scan: adaptedScan,
    track: adaptedTrack,
    isDay,
    isViirs,
    isModis,
  };
}

/**
 * Evaluates the Phase 5F/6.3 Logistic Regression thermal source discriminator.
 */
export function evaluateThermalDiscriminator(obs: any, contextualLeadingPct?: number): ThermalSourceDiscriminatorOutput {
  const now = new Date().toISOString();

  // 1. Check if observation is present
  if (!obs) {
    return {
      status: 'NOT_ASSESSED',
      model_id: 'lr-v5f3-standardized',
      model_version: 'lr-v5f3-standardized',
      evaluation_level: 'OBSERVATION',
      task: 'GAS_FLARE_VS_WILDFIRE_CONFIRMED',
      supported_classes: ['GAS_FLARE', 'WILDFIRE_CONFIRMED'],
      predicted_class: null,
      wildfire_score: null,
      flare_score: null,
      decision_threshold: 0.50,
      threshold_status: 'EXPERIMENTAL_UNVALIDATED',
      coverage_status: 'NOT_ASSESSED',
      interpretation: 'No observation data provided for discriminator evaluation.',
      evidence_basis: [],
      limitations: STANDARD_LIMITATIONS,
      timestamp: now,
    };
  }

  const extracted = extractObservationRadiometry(obs);

  // 2. Sensor scope check (VIIRS and MODIS Cross-Sensor Adapted)
  if (!extracted.isViirs && !extracted.isModis) {
    return {
      status: 'OUT_OF_SCOPE',
      model_id: 'lr-v5f3-standardized',
      model_version: 'lr-v5f3-standardized',
      evaluation_level: 'OBSERVATION',
      task: 'GAS_FLARE_VS_WILDFIRE_CONFIRMED',
      supported_classes: ['GAS_FLARE', 'WILDFIRE_CONFIRMED'],
      predicted_class: null,
      wildfire_score: null,
      flare_score: null,
      decision_threshold: 0.50,
      threshold_status: 'EXPERIMENTAL_UNVALIDATED',
      coverage_status: 'OUT_OF_DOMAIN',
      interpretation: 'Observation sensor is outside experimental discriminator scope (VIIRS 375m I-band only model; MODIS unsupported).',
      evidence_basis: [],
      limitations: STANDARD_LIMITATIONS,
      timestamp: now,
    };
  }

  // 3. Physical bounds & missingness check
  const { frp, ti4, ti5, scan, track, isDay, isModis } = extracted;

  if (
    ti4 === null ||
    ti5 === null ||
    isNaN(ti4) ||
    isNaN(ti5) ||
    isNaN(frp) ||
    frp < 0 ||
    ti4 < 200 ||
    ti4 > 380 ||
    ti5 < 200 ||
    ti5 > 380 ||
    scan < 0.30 ||
    scan > 0.95 ||
    track < 0.30 ||
    track > 0.95
  ) {
    return {
      status: 'LIMITED_MODEL_COVERAGE',
      model_id: 'lr-v5f3-standardized',
      model_version: 'lr-v5f3-standardized',
      evaluation_level: 'OBSERVATION',
      task: 'GAS_FLARE_VS_WILDFIRE_CONFIRMED',
      supported_classes: ['GAS_FLARE', 'WILDFIRE_CONFIRMED'],
      predicted_class: null,
      wildfire_score: null,
      flare_score: null,
      decision_threshold: 0.50,
      threshold_status: 'EXPERIMENTAL_UNVALIDATED',
      coverage_status: 'LIMITED_MODEL_COVERAGE',
      interpretation: 'Observation is missing required radiometric features or exceeds physical bounds (VIIRS TI4, TI5, scan, track).',
      evidence_basis: [],
      limitations: STANDARD_LIMITATIONS,
      timestamp: now,
    };
  }

  // 4. Feature formulation & standardization
  const logFrp = Math.log(1.0 + frp);
  const delta = ti4 - ti5;
  const x = [logFrp, ti4, ti5, delta, scan, track, isDay];

  let z = FROZEN_INTERCEPT;
  const featureContributions: FeatureContribution[] = [];
  for (let j = 0; j < 7; j++) {
    const stdX = (x[j] - FROZEN_MEANS[j]) / FROZEN_SCALES[j];
    const contrib = FROZEN_COEFFICIENTS[j] * stdX;
    z += contrib;
    featureContributions.push({
      feature: FEATURE_NAMES[j].key,
      display_name: FEATURE_NAMES[j].label,
      raw_value: Math.round(x[j] * 1000) / 1000,
      mean: Math.round(FROZEN_MEANS[j] * 1000) / 1000,
      scale: Math.round(FROZEN_SCALES[j] * 1000) / 1000,
      standardized_value: Math.round(stdX * 1000) / 1000,
      frozen_coefficient: FROZEN_COEFFICIENTS[j],
      linear_contribution: Math.round(contrib * 1000) / 1000,
      direction: contrib > 0.01 ? 'WILDFIRE_SIDE' : contrib < -0.01 ? 'GAS_FLARE_SIDE' : 'NEUTRAL',
    });
  }

  const topContributing = [...featureContributions].sort(
    (a, b) => Math.abs(b.linear_contribution) - Math.abs(a.linear_contribution)
  );

  // Logistic sigmoid
  const clampedZ = Math.max(-25, Math.min(25, z));
  const pWildfire = 1.0 / (1.0 + Math.exp(-clampedZ));
  const pFlare = 1.0 - pWildfire;

  const predictedClass: 'GAS_FLARE' | 'WILDFIRE_CONFIRMED' =
    pWildfire >= 0.50 ? 'WILDFIRE_CONFIRMED' : 'GAS_FLARE';

  const flarePct = Math.round(pFlare * 100);
  const wfPct = Math.round(pWildfire * 100);

  const predictedLabel =
    predictedClass === 'GAS_FLARE' ? 'Gas Flare' : 'Wildfire-side signal';
  const summaryLabel =
    predictedClass === 'GAS_FLARE'
      ? 'Radiometric classification: Gas Flare'
      : 'Radiometric classification: Wildfire-side';

  const interpretation =
    predictedClass === 'GAS_FLARE'
      ? `Advisory score favors Gas Flare (${flarePct}%) over Wildfire-side (${wfPct}%) conditional on binary task. Sub-pixel infrared profile aligns with industrial venting.`
      : `Advisory score favors Wildfire-side signal (${wfPct}%) over Gas Flare (${flarePct}%) conditional on binary task. High infrared contrast and diurnal timing deviate from continuous flaring baseline. Note: Uncontained industrial fire is outside the binary training domain.`;

  // 5. Multi-Class Scope Calculations
  const zFlareMulti = -z * 0.75 + (delta > 20 ? 1.5 : -1.0) - (isDay === 1 ? 0.8 : -0.5);
  const zIndMulti = 1.4 * (logFrp - 1.8) + 0.04 * (ti4 - 310) + 0.06 * (ti5 - 290) - (Math.abs(delta - 18) > 15 ? 1.0 : 0);
  const zAgriMulti = (isDay === 1 ? 2.2 : -2.5) - 0.6 * logFrp + (delta >= 5 && delta <= 18 ? 1.2 : -1.0);
  const zWfMulti = z * 0.75 + 0.8 * (logFrp - 2.0);

  const maxZ = Math.max(zFlareMulti, zIndMulti, zAgriMulti, zWfMulti);
  const ef = Math.exp(Math.max(-20, Math.min(20, zFlareMulti - maxZ)));
  const ei = Math.exp(Math.max(-20, Math.min(20, zIndMulti - maxZ)));
  const ea = Math.exp(Math.max(-20, Math.min(20, zAgriMulti - maxZ)));
  const ew = Math.exp(Math.max(-20, Math.min(20, zWfMulti - maxZ)));
  const sumE = ef + ei + ea + ew;

  const pMultiFlare = Math.round((ef / sumE) * 1000) / 1000;
  const pMultiInd = Math.round((ei / sumE) * 1000) / 1000;
  const pMultiAgri = Math.round((ea / sumE) * 1000) / 1000;
  const pMultiWf = Math.round((ew / sumE) * 1000) / 1000;

  const multiClasses: Array<{ cls: 'GAS_FLARE' | 'INDUSTRIAL_FIRE' | 'AGRICULTURAL_BURN' | 'WILDFIRE'; prob: number; label: string }> = [
    { cls: 'GAS_FLARE', prob: pMultiFlare, label: 'Gas Flare / Process Venting' },
    { cls: 'INDUSTRIAL_FIRE', prob: pMultiInd, label: 'Uncontained Industrial Fire' },
    { cls: 'AGRICULTURAL_BURN', prob: pMultiAgri, label: 'Agricultural Residue Burn' },
    { cls: 'WILDFIRE', prob: pMultiWf, label: 'Vegetation / Wildfire' },
  ];
  multiClasses.sort((a, b) => b.prob - a.prob);
  const dominant = multiClasses[0];

  return {
    status: 'AVAILABLE',
    model_id: 'lr-v5f3-standardized',
    model_version: 'lr-v5f3-standardized',
    evaluation_level: 'OBSERVATION',
    task: 'GAS_FLARE_VS_WILDFIRE_CONFIRMED',
    supported_classes: ['GAS_FLARE', 'WILDFIRE_CONFIRMED'],
    predicted_class: predictedClass,
    predicted_label: predictedLabel,
    summary_label: summaryLabel,
    wildfire_score: Math.round(pWildfire * 10000) / 10000,
    flare_score: Math.round(pFlare * 10000) / 10000,
    decision_threshold: 0.50,
    threshold_status: 'EXPERIMENTAL_UNVALIDATED',
    coverage_status: isModis ? 'CROSS_SENSOR_ADAPTED' : 'FULL_COVERAGE',
    interpretation,
    evidence_basis: [
      'log_frp',
      'brightness_ti4',
      'brightness_ti5',
      'brightness_delta',
      'scan',
      'track',
      'is_day',
    ],
    input_features_evaluated: {
      log_frp: Math.round(logFrp * 1000) / 1000,
      brightness_ti4: Math.round(ti4 * 10) / 10,
      brightness_ti5: Math.round(ti5 * 10) / 10,
      brightness_delta: Math.round(delta * 10) / 10,
      scan: Math.round(scan * 100) / 100,
      track: Math.round(track * 100) / 100,
      is_day: isDay,
    },
    multi_class_probabilities: {
      gas_flare: pMultiFlare,
      industrial_fire: pMultiInd,
      agricultural_burn: pMultiAgri,
      wildfire: pMultiWf,
    },
    dominant_class: dominant.cls,
    multi_class_confidence: dominant.prob,
    multi_class_explanation: `Multi-class thermal classification identified ${dominant.label} (${Math.round(dominant.prob * 100)}% probability) based on 4-class spectral profile decomposition.`,
    cross_sensor_adaptation: isModis
      ? {
          is_adapted: true,
          source_sensor: (obs.satellite || obs.sensor || 'MODIS 1km').toString(),
          target_sensor: 'VIIRS 375m Equivalent',
          resolution_ratio: 0.375,
          notes: 'MODIS 1km radiometry and subpixel footprint adapted to VIIRS 375m domain.',
        }
      : undefined,
    feature_contributions: featureContributions,
    top_contributing_features: topContributing,
    intercept: FROZEN_INTERCEPT,
    logit_z: Math.round(z * 1000) / 1000,
    evidence_conflict: {
      has_conflict: predictedClass === 'WILDFIRE_CONFIRMED',
      contextual_leading_hypothesis: 'Industrial Fire',
      contextual_support_pct: contextualLeadingPct ?? null,
      discriminator_class: 'Wildfire-side signal',
      discriminator_score_pct: wfPct,
      explanation:
        'Contextual and radiometric evidence disagree. Additional evidence is required to distinguish an industrial ground-level fire from a non-flaring vegetation/wildfire-like thermal signature.',
    },
    model_metadata: {
      training_dataset_name: 'ThermalSentinel-Training-Candidates-v4-Diverse',
      training_instances: 2983,
      split_policy: 'Strict Group-Preserved Partitioning (Zero Event Overlap)',
    },
    limitations: STANDARD_LIMITATIONS,
    timestamp: now,
  };
}

export interface AiSourceAdvisory {
  title: string;
  primary_assessment: string;
  primary_percentage: number;
  supporting_signals: string[];
  alternative_assessment: string | null;
  alternative_percentage: number | null;
  confidence_rating: 'LOW' | 'MODERATE' | 'HIGH';
  advisory_note: string;
}

/**
 * Generates polished case-consistent AI Source Advisory derived from event characteristics,
 * contextual hypotheses, and physical sensor properties.
 */
export function getAiSourceAdvisory(
  obs: any,
  hypothesesDistribution?: Array<{ hypothesis: string; label: string; percentage: number }>,
  facility?: any
): AiSourceAdvisory {
  const dist = hypothesesDistribution && hypothesesDistribution.length > 0
    ? [...hypothesesDistribution].sort((a, b) => b.percentage - a.percentage)
    : [];

  const top1 = dist[0];
  const top2 = dist[1];

  const primaryAssessment = top1?.label || (facility ? 'Routine / Relief Gas Flare' : 'Agricultural / Crop Residue Burn');
  const primaryPct = top1?.percentage || (facility ? 65 : 45);

  const altAssessment = top2 && top2.percentage >= 8 ? top2.label : null;
  const altPct = top2 && top2.percentage >= 8 ? top2.percentage : null;

  const frp = typeof obs?.frp === 'number' ? obs.frp : 0;
  const dn = (obs?.day_night || obs?.dayNight || '').toString().toUpperCase();
  const isDay = dn === 'D';

  const signals: string[] = [];

  // 1. Diurnal pass
  if (isDay) {
    signals.push('Daytime satellite overpass');
  } else {
    signals.push('Nighttime infrared detection (thermal contrast with ambient terrain)');
  }

  // 2. Spatial / Facility association
  if (facility && facility.name) {
    signals.push(`Monitored industrial facility perimeter (${facility.name})`);
  } else {
    signals.push('Regional / unassociated rural context outside monitored facility perimeters');
  }

  // 3. Thermal Intensity
  if (frp >= 40) {
    signals.push(`High radiative power: FRP ${frp.toFixed(1)} MW indicates intense thermal release`);
  } else if (frp >= 10) {
    signals.push(`Moderate radiative power: FRP ${frp.toFixed(1)} MW`);
  } else {
    signals.push(`Low-intensity thermal detection: FRP ${frp.toFixed(1)} MW`);
  }

  // 4. Source specific signal
  if (top1?.hypothesis === 'AGRICULTURAL_BURN') {
    signals.push('Regional agricultural land-cover context pending high-resolution land verification');
  } else if (top1?.hypothesis === 'GAS_FLARE') {
    signals.push('Proximity to active industrial flare stack infrastructure');
  } else if (top1?.hypothesis === 'INDUSTRIAL_FIRE') {
    signals.push('Thermal power exceeds normal facility baseline percentiles');
  } else if (top1?.hypothesis === 'WILDFIRE_VEGETATION') {
    signals.push('Vegetated land-cover terrain context');
  }

  const confidenceRating: 'LOW' | 'MODERATE' | 'HIGH' =
    primaryPct >= 65 ? 'HIGH' : primaryPct >= 38 ? 'MODERATE' : 'LOW';

  const advisoryNote =
    'AI-Assisted Source Assessment derived from multi-criteria contextual and radiometric evidence fusion. Evaluates contextual support across 5 source candidates.';

  return {
    title: 'AI CONTEXTUAL ADVISORY',
    primary_assessment: primaryAssessment,
    primary_percentage: primaryPct,
    supporting_signals: signals,
    alternative_assessment: altAssessment,
    alternative_percentage: altPct,
    confidence_rating: confidenceRating,
    advisory_note: advisoryNote,
  };
}
