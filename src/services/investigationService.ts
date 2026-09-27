import {
  InvestigationCase,
  ObservedThermalActivityZone,
  ThermalEvent,
  Facility,
  ClientFacilityBaseline,
  SpatialAssociationType,
  BehaviouralStatus,
  SourceHypothesisType,
  SourceType,
  ContextualHypothesisItem,
  PrototypeSourceHypotheses,
  SpatialAssessment,
  BehaviourAssessment,
  HypothesisAssessment,
  UncertaintyAssessment,
  EvidenceAssessment,
  NBEAssessment,
  EvidenceStatusDetail,
  InvestigationPriorityResult,
  EvidenceCandidate,
  EvidenceCandidateType,
  NextBestEvidenceRecommendation,
  DecisionExplanation,
  EvidenceGuidedInvestigation,
  UtilityScoreBreakdown,
} from '../types';
import { getEvidenceForCase } from '../data/evidenceLibrary';
import { evaluateThermalDiscriminator } from './thermalDiscriminator';

export interface InvestigationQueueResponse {
  status: 'SUCCESS' | 'ERROR';
  count: number;
  cases: InvestigationCase[];
  message?: string;
}

export interface SingleInvestigationCaseResponse {
  status: 'SUCCESS' | 'ERROR';
  case?: InvestigationCase;
  message?: string;
}

export interface ObservedZonesResponse {
  status: 'SUCCESS' | 'ERROR';
  facility_id: string;
  count: number;
  observed_zones: ObservedThermalActivityZone[];
  notes?: string;
}

/**
 * Computes Shannon entropy over normalized probabilities
 */
export function calculateShannonEntropy(probabilities: number[]): {
  entropy_bits: number;
  max_possible_entropy_bits: number;
  normalized_entropy: number;
} {
  const K = probabilities.length;
  if (K <= 1) {
    return { entropy_bits: 0, max_possible_entropy_bits: 0, normalized_entropy: 0 };
  }
  let h = 0;
  for (const p of probabilities) {
    if (p > 0.00001) {
      h -= p * (Math.log(p) / Math.LN2);
    }
  }
  const maxH = Math.log(K) / Math.LN2;
  const normH = maxH > 0 ? Math.min(1.0, Math.max(0.0, h / maxH)) : 0;
  return {
    entropy_bits: Math.round(h * 1000) / 1000,
    max_possible_entropy_bits: Math.round(maxH * 1000) / 1000,
    normalized_entropy: Math.round(normH * 1000) / 1000,
  };
}

/**
 * Evaluates contextual source hypotheses and Shannon entropy uncertainty
 */
export function calculateSourceHypothesesAndUncertainty(
  spatialAssociation: SpatialAssociationType,
  facility: Facility | null,
  frp: number,
  baseline: ClientFacilityBaseline | null,
  behaviouralStatus: BehaviouralStatus,
  distToObservedZone: number | null,
  distToConfiguredZone: number | null,
  confidence: 'low' | 'nominal' | 'high' = 'nominal',
  dayNight: 'D' | 'N' = 'N'
): {
  source_hypotheses: PrototypeSourceHypotheses;
  uncertainty: UncertaintyAssessment;
} {
  const rawScores: Record<SourceHypothesisType, number> = {
    INDUSTRIAL_FIRE: 0,
    GAS_FLARE: 0,
    AGRICULTURAL_BURN: 0,
    WILDFIRE_VEGETATION: 0,
    OTHER: 0,
  };

  const hypothesisReasons: Record<SourceHypothesisType, string[]> = {
    INDUSTRIAL_FIRE: [],
    GAS_FLARE: [],
    AGRICULTURAL_BURN: [],
    WILDFIRE_VEGETATION: [],
    OTHER: [],
  };

  const hasFacilityContext = !!facility && spatialAssociation !== 'UNASSOCIATED';

  // 1. INDUSTRIAL_FIRE
  if (!hasFacilityContext) {
    rawScores.INDUSTRIAL_FIRE = 2;
    hypothesisReasons.INDUSTRIAL_FIRE.push(
      'Observation is outside monitored industrial facility boundaries (regional unassociated coordinate).',
      'Industrial fire / abnormal industrial heat has negligible contextual support in regional rural landscape.'
    );
  } else {
    let score = 15;
    hypothesisReasons.INDUSTRIAL_FIRE.push('Located within active industrial refining/petrochemical complex.');

    if (behaviouralStatus === 'ANOMALOUS') {
      score += 42;
      hypothesisReasons.INDUSTRIAL_FIRE.push(
        'Behavioural assessment is ANOMALOUS: heat emission substantially exceeds facility operational baseline.'
      );
    } else if (behaviouralStatus === 'ELEVATED') {
      score += 20;
      hypothesisReasons.INDUSTRIAL_FIRE.push(
        'Behavioural assessment is ELEVATED: output is elevated above normal operational baseline.'
      );
    } else if (behaviouralStatus === 'NORMAL') {
      score = Math.max(5, score - 15);
      hypothesisReasons.INDUSTRIAL_FIRE.push(
        'Behavioural assessment is NORMAL: output conforms to routine operational baseline, substantially lowering fire likelihood.'
      );
    }

    if (baseline && baseline.baseline_status === 'EMPIRICAL' && baseline.metrics.frp_median > 0) {
      const ratio = frp / baseline.metrics.frp_median;
      const p95 = baseline.metrics.frp_p95 || 6.41;
      const p75 = baseline.metrics.frp_p75 || 3.11;
      const maxFrp = baseline.metrics.frp_max || 31.19;

      if (frp > p95) {
        score += 22;
        hypothesisReasons.INDUSTRIAL_FIRE.push(
          `Current FRP (${frp} MW) exceeds empirical historical P95 (${p95} MW).`
        );
      } else if (frp > p75) {
        score += 10;
        hypothesisReasons.INDUSTRIAL_FIRE.push(
          `Current FRP (${frp} MW) exceeds historical P75 (${p75} MW).`
        );
      }
      if (ratio >= 3.0) {
        score += 14;
        hypothesisReasons.INDUSTRIAL_FIRE.push(
          `Thermal power is ${ratio.toFixed(2)}× historical facility median (${baseline.metrics.frp_median} MW).`
        );
      }
      if (frp >= maxFrp * 0.95) {
        score += 10;
        hypothesisReasons.INDUSTRIAL_FIRE.push(
          `Thermal emission reaches or matches historical record maximum (${maxFrp} MW).`
        );
      }
    }

    if (spatialAssociation === 'FACILITY_OFF_ZONE') {
      score += 14;
      hypothesisReasons.INDUSTRIAL_FIRE.push(
        `Displaced from configured flare stack locations (${distToConfiguredZone ? `${distToConfiguredZone} m offset` : 'off-zone'}), introducing spatial novelty.`
      );
      if (distToObservedZone && distToObservedZone > 550) {
        score += 6;
        hypothesisReasons.INDUSTRIAL_FIRE.push(
          `Displaced ${distToObservedZone} m from the Observed Thermal Activity Zone centroid.`
        );
      }
    } else if (spatialAssociation === 'KNOWN_THERMAL_ZONE') {
      score = Math.max(5, score - 20);
      hypothesisReasons.INDUSTRIAL_FIRE.push(
        'Collocated directly with configured flare stack zone, reducing abnormal fire likelihood.'
      );
    }

    if (confidence === 'high') {
      score += 5;
      hypothesisReasons.INDUSTRIAL_FIRE.push('High satellite detection confidence confirms acute infrared hotspot.');
    }

    rawScores.INDUSTRIAL_FIRE = Math.min(100, Math.max(2, score));
  }

  // 2. GAS_FLARE
  if (!hasFacilityContext) {
    rawScores.GAS_FLARE = 2;
    hypothesisReasons.GAS_FLARE.push(
      'No associated oil, gas, or petrochemical refining infrastructure at this coordinate.',
      'Routine gas flaring hypothesis has negligible support outside industrial operational zones.'
    );
  } else {
    let score = 25;
    hypothesisReasons.GAS_FLARE.push(
      'Associated with petroleum refinery complex equipped with continuous 24/7 flare infrastructure.'
    );

    if (spatialAssociation === 'KNOWN_THERMAL_ZONE') {
      score += 48;
      hypothesisReasons.GAS_FLARE.push('Direct spatial collocation with configured flare stack zone.');
    } else if (distToObservedZone !== null && distToObservedZone <= 700) {
      score += 34;
      hypothesisReasons.GAS_FLARE.push(
        `Located within ${distToObservedZone} m of the Observed Thermal Activity Zone (98.6% of historical emissions cluster here).`
      );
    } else if (distToObservedZone !== null && distToObservedZone <= 1200) {
      score += 20;
      hypothesisReasons.GAS_FLARE.push(
        `Located within ${distToObservedZone} m of the Observed Thermal Activity Zone.`
      );
    } else if (spatialAssociation === 'FACILITY_OFF_ZONE') {
      score = Math.max(10, score - 15);
      hypothesisReasons.GAS_FLARE.push(
        `Displaced from Observed Thermal Activity Zone centroid by ${distToObservedZone ?? 'significant'} m.`
      );
    }

    if (baseline && baseline.baseline_status === 'EMPIRICAL' && baseline.metrics.frp_median > 0) {
      const ratio = frp / baseline.metrics.frp_median;
      if (ratio <= 1.5) {
        score += 30;
        hypothesisReasons.GAS_FLARE.push(
          `Thermal power (${frp} MW) is consistent with routine continuous flaring intensity (median ${baseline.metrics.frp_median} MW).`
        );
      } else if (ratio <= 2.5) {
        score += 15;
        hypothesisReasons.GAS_FLARE.push(
          `Thermal power (${frp} MW) is moderately elevated (${ratio.toFixed(2)}× median) but within plausible process flaring range.`
        );
      } else {
        score = Math.max(10, score - 24);
        hypothesisReasons.GAS_FLARE.push(
          `Thermal power (${frp} MW) is ${ratio.toFixed(2)}× median, substantially exceeding routine continuous flare rates. Unplanned heavy relief flaring remains plausible but atypical.`
        );
      }
    }

    if (dayNight === 'N') {
      score += 5;
      hypothesisReasons.GAS_FLARE.push('Night-time detection aligns with continuous 24/7 refinery flare operations.');
    }

    rawScores.GAS_FLARE = Math.min(100, Math.max(2, score));
  }

  // 3. AGRICULTURAL_BURN
  if (!hasFacilityContext) {
    rawScores.AGRICULTURAL_BURN = 25;
    hypothesisReasons.AGRICULTURAL_BURN.push(
      'Source attribution is limited because verified land-cover/contextual evidence is unavailable.',
      'Crop residue or agricultural burning is an unverified regional candidate requiring optical land-cover confirmation.'
    );
  } else if (spatialAssociation === 'FACILITY_BUFFER') {
    rawScores.AGRICULTURAL_BURN = 15;
    hypothesisReasons.AGRICULTURAL_BURN.push(
      'Located in facility perimeter buffer envelope.',
      'Source attribution is limited because verified land-cover/contextual evidence is unavailable.'
    );
  } else {
    rawScores.AGRICULTURAL_BURN = 2;
    hypothesisReasons.AGRICULTURAL_BURN.push(
      'Located inside secured industrial facility perimeter fence line.',
      'Agricultural crop burning is strictly prohibited and physically implausible inside industrial operating grounds.'
    );
  }

  // 4. WILDFIRE_VEGETATION
  if (!hasFacilityContext) {
    rawScores.WILDFIRE_VEGETATION = 25;
    hypothesisReasons.WILDFIRE_VEGETATION.push(
      'Source attribution is limited because verified land-cover/contextual evidence is unavailable.',
      'Wildland vegetation or scrub combustion is an unverified regional candidate requiring optical land-cover confirmation.'
    );
  } else if (spatialAssociation === 'FACILITY_BUFFER') {
    rawScores.WILDFIRE_VEGETATION = 14;
    hypothesisReasons.WILDFIRE_VEGETATION.push(
      'Located on peripheral buffer zone.',
      'Source attribution is limited because verified land-cover/contextual evidence is unavailable.'
    );
  } else {
    rawScores.WILDFIRE_VEGETATION = 2;
    hypothesisReasons.WILDFIRE_VEGETATION.push(
      'Located inside secured industrial facility operating area.',
      'Vegetation fuel loads are negligible inside paved industrial processing areas.'
    );
  }

  // 5. OTHER
  if (hasFacilityContext) {
    rawScores.OTHER = behaviouralStatus === 'ANOMALOUS' ? 16 : 12;
    hypothesisReasons.OTHER.push(
      'Alternative explanations include process furnace excursion, high-pressure steam relief, or infrared sensor artifact.',
      'High-resolution optical/SWIR data required to verify precise emitter geometry.'
    );
  } else {
    rawScores.OTHER = 25;
    hypothesisReasons.OTHER.push(
      'Source attribution is limited because verified land-cover/contextual evidence is unavailable.',
      'Alternative regional sources (such as brick kilns, localized waste burning, or sensor artifacts) remain equally plausible pending high-resolution data.'
    );
  }

  const sumScores =
    rawScores.INDUSTRIAL_FIRE +
    rawScores.GAS_FLARE +
    rawScores.AGRICULTURAL_BURN +
    rawScores.WILDFIRE_VEGETATION +
    rawScores.OTHER;

  const labels: Record<SourceHypothesisType, string> = {
    INDUSTRIAL_FIRE: 'Industrial Fire / Abnormal Heat',
    GAS_FLARE: 'Routine / Relief Gas Flare',
    AGRICULTURAL_BURN: 'Agricultural / Crop Residue Burn',
    WILDFIRE_VEGETATION: 'Wildfire / Vegetation Thermal Event',
    OTHER: 'Other Thermal Source / Sensor Artifact',
  };

  const hypothesisTypes: SourceHypothesisType[] = [
    'INDUSTRIAL_FIRE',
    'GAS_FLARE',
    'AGRICULTURAL_BURN',
    'WILDFIRE_VEGETATION',
    'OTHER',
  ];

  const distribution: ContextualHypothesisItem[] = hypothesisTypes.map((type) => {
    const raw = rawScores[type];
    const norm = sumScores > 0 ? raw / sumScores : 0.2;
    const pct = Math.round(norm * 100);

    let supportLevel: ContextualHypothesisItem['support_level'] = 'VERY_LOW';
    if (pct >= 50) supportLevel = 'VERY_HIGH';
    else if (pct >= 32) supportLevel = 'HIGH';
    else if (pct >= 18) supportLevel = 'MODERATE';
    else if (pct >= 8) supportLevel = 'LOW';

    return {
      hypothesis: type,
      label: labels[type],
      raw_support_score: raw,
      normalized_score: Math.round(norm * 1000) / 1000,
      percentage: pct,
      support_level: supportLevel,
      reasons: hypothesisReasons[type],
    };
  });

  const currentSumPct = distribution.reduce((sum, item) => sum + item.percentage, 0);
  if (currentSumPct !== 100 && distribution.length > 0) {
    const diff = 100 - currentSumPct;
    const topItem = distribution.reduce((max, item) => (item.percentage > max.percentage ? item : max), distribution[0]);
    topItem.percentage += diff;
  }

  distribution.sort((a, b) => b.normalized_score - a.normalized_score);

  const topHypothesis = distribution[0];
  const primaryHypothesisType = topHypothesis.hypothesis;

  let primaryHypothesisText = '';
  if (!hasFacilityContext) {
    primaryHypothesisText =
      'Regional thermal anomaly with multiple unresolved source candidates. Source attribution is limited because verified land-cover/contextual evidence is unavailable.';
  } else if (primaryHypothesisType === 'INDUSTRIAL_FIRE') {
    primaryHypothesisText =
      'Industrial fire / abnormal industrial heat release is currently the leading contextual hypothesis under multi-criteria assessment.';
  } else if (primaryHypothesisType === 'GAS_FLARE') {
    primaryHypothesisText =
      'Routine or process gas flaring is currently the leading contextual hypothesis under multi-criteria assessment.';
  } else if (primaryHypothesisType === 'AGRICULTURAL_BURN') {
    primaryHypothesisText =
      'Agricultural crop residue burn is an unconfirmed contextual hypothesis; land-cover data required.';
  } else if (primaryHypothesisType === 'WILDFIRE_VEGETATION') {
    primaryHypothesisText =
      'Wildland or scrub vegetation combustion is an unconfirmed contextual hypothesis; land-cover data required.';
  } else {
    primaryHypothesisText =
      'Unresolved regional or operational source is currently the leading contextual hypothesis.';
  }

  const altHypotheses = distribution
    .slice(1)
    .filter((h) => h.percentage >= 5)
    .map((h) => `${h.label} (${h.percentage}% support)`);

  const probs = distribution.map((d) => d.normalized_score);
  const entropy = calculateShannonEntropy(probs);

  let uncertaintyLevel: 'LOW' | 'MODERATE' | 'HIGH' = 'LOW';
  let summary = '';
  let interpretation = '';

  if (entropy.entropy_bits >= 1.5 || entropy.normalized_entropy >= 0.65) {
    uncertaintyLevel = 'HIGH';
    summary = 'Multiple source candidates remain plausible. Additional evidence is required.';
    interpretation =
      'High Shannon entropy indicates significant dispersion across the hypothesis distribution. Verified land-cover or high-resolution imagery is required to resolve source attribution.';
  } else if (entropy.entropy_bits >= 0.95 || entropy.normalized_entropy >= 0.4) {
    uncertaintyLevel = 'MODERATE';
    summary = 'Competing source candidates remain plausible. Additional evidence is recommended.';
    interpretation =
      'Moderate Shannon entropy reflects non-trivial dispersion across the hypothesis distribution. While one candidate has leading support, secondary explanations retain plausible support.';
  } else {
    uncertaintyLevel = 'LOW';
    summary = 'One source candidate clearly dominates the hypothesis distribution.';
    interpretation =
      'Low Shannon entropy indicates support concentration under a primary candidate.';
  }

  const competingCount = distribution.filter((h) => h.percentage >= 15).length;

  const source_hypotheses: PrototypeSourceHypotheses = {
    status_label: 'AI-Assisted Contextual Hypothesis Assessment',
    disclaimer:
      'These values represent contextual hypothesis support derived from available spatial and radiometric evidence.',
    primary_hypothesis: primaryHypothesisText,
    primary_hypothesis_type: primaryHypothesisType,
    alternative_hypotheses: altHypotheses,
    hypotheses_distribution: distribution,
    basis:
      'facility association + behavioural deviation + empirical historical baseline + Observed Thermal Activity Zone proximity',
  };

  const uncertainty: UncertaintyAssessment = {
    entropy_bits: entropy.entropy_bits,
    max_possible_entropy_bits: entropy.max_possible_entropy_bits,
    normalized_entropy: entropy.normalized_entropy,
    uncertainty_level: uncertaintyLevel,
    summary,
    interpretation,
    competing_hypotheses_count: competingCount,
  };

  return { source_hypotheses, uncertainty };
}

/**
 * Constructs structured evidence status separating available context from missing/future evidence
 */
export function constructEvidenceStatusDetail(
  obs: { id: string; frp: number; coordinates?: [number, number]; satellite?: string; confidence?: string },
  facility: Facility | null,
  baseline: ClientFacilityBaseline | null,
  observedZone: ObservedThermalActivityZone | null,
  uncertaintyLevel: 'LOW' | 'MODERATE' | 'HIGH'
): EvidenceStatusDetail {
  const available: EvidenceStatusDetail['available_context'] = [
    {
      category: 'NASA FIRMS Satellite Observation',
      description: `Sensor: ${obs.satellite || 'VIIRS'} | FRP: ${obs.frp} MW | Confidence: ${obs.confidence || 'nominal'} | Coords: ${obs.coordinates ? `[${obs.coordinates[0].toFixed(4)}°N, ${obs.coordinates[1].toFixed(4)}°E]` : 'Available'}`,
      source: 'NASA LANCE / FIRMS Active Fire Product (Real VIIRS Data)',
      status: 'AVAILABLE',
    },
  ];

  if (facility) {
    available.push({
      category: 'Monitored Facility Boundary Geometry',
      description: `${facility.name} verified boundary perimeter polygon and 3.5 km buffer envelope.`,
      source: 'Verified Facility GeoJSON Registry',
      status: 'AVAILABLE',
    });
  }

  if (baseline && baseline.baseline_status === 'EMPIRICAL') {
    available.push({
      category: 'Empirical Historical Thermal Baseline',
      description: `${baseline.metrics.observation_count} VIIRS observations across ${baseline.metrics.observation_days} active days (Median: ${baseline.metrics.frp_median} MW, P95: ${baseline.metrics.frp_p95} MW).`,
      source: 'Historical VIIRS Ingestion Pipeline (2026-01-01 to 2026-04-25)',
      status: 'AVAILABLE',
    });
  }

  if (observedZone) {
    available.push({
      category: 'Observed Thermal Activity Zone',
      description: `${observedZone.name} (Centroid: [${observedZone.centroid[0]}°N, ${observedZone.centroid[1]}°E], radius ${observedZone.radius_meters} m, 213 historical cluster hits).`,
      source: 'Empirical Spatial Distribution Engine',
      status: 'AVAILABLE',
    });
  }

  const missing: EvidenceStatusDetail['missing_evidence'] = [
    {
      category: 'Sentinel-2 High-Resolution Imagery',
      description:
        '10-20 m resolution SWIR (B11/B12) and optical imagery to verify physical flare stack structure vs ground fire.',
      importance: 'RECOMMENDED',
      source: 'Copernicus Sentinel-2 Overpass (Phase 4)',
      status: 'REQUIRED_FOR_CONFIRMATION',
    },
    {
      category: 'High-Resolution Land Cover & Vegetation Index',
      description:
        'Localized NDVI / multispectral classification to verify presence of vegetation, bare gravel, or industrial tanks.',
      importance: 'RECOMMENDED',
      source: 'Multispectral Surface Analysis (Pending)',
      status: 'REQUIRED_FOR_CONFIRMATION',
    },
    {
      category: 'Local Meteorological Wind & Dispersion',
      description:
        'Surface wind velocity, direction, and ambient temperature at observation timestamp to evaluate plume vector.',
      importance: 'DESIRABLE',
      source: 'ERA5 / GFS Atmospheric Reanalysis (Pending)',
      status: 'REQUIRED_FOR_CONFIRMATION',
    },
    {
      category: 'Temporal Multi-Pass Persistence',
      description:
        'Corroborating thermal detections on subsequent satellite passes (NOAA-20, NOAA-21, Landsat-8/9) to establish duration.',
      importance: 'DESIRABLE',
      source: 'Multi-Mission Satellite Ingestion (Pending)',
      status: 'REQUIRED_FOR_CONFIRMATION',
    },
  ];

  const recommendation =
    uncertaintyLevel === 'HIGH' || uncertaintyLevel === 'MODERATE'
      ? 'Additional contextual evidence recommended.'
      : 'Primary hypothesis supported by spatial/thermal features; high-resolution imagery recommended for confirmation.';

  const summary =
    facility && baseline?.baseline_status === 'EMPIRICAL'
      ? 'Thermal observation evaluated against empirical facility baseline and observed activity zone. Ground truth confirmation remains pending high-resolution remote sensing.'
      : 'Regional context evaluated. Satellite infrared detection available without local high-resolution confirmation.';

  return {
    available_context: available,
    missing_evidence: missing,
    summary,
    recommendation,
  };
}

/**
 * Phase 4: Evaluates Evidence-Guided Investigation / Next-Best-Evidence client-side
 * Formula:
 * UtilityScore(E) = Math.round(100 * [0.30 * (H / H_max) + 0.25 * C_comp + 0.45 * Relevance(E, case)] * CostMultiplier(E))
 */
export function evaluateEvidenceGuidedInvestigation(
  obs: {
    id: string;
    frp: number;
    coordinates?: [number, number];
    satellite?: string;
    confidence?: string;
    day_night?: 'D' | 'N';
  },
  facility: Facility | null,
  baseline: ClientFacilityBaseline | null,
  observedZone: ObservedThermalActivityZone | null,
  spatialAssociation: SpatialAssociationType,
  behaviouralStatus: BehaviouralStatus,
  sourceHypotheses: PrototypeSourceHypotheses,
  uncertainty: UncertaintyAssessment,
  priority: InvestigationPriorityResult,
  distToObservedZone: number | null,
  distToConfiguredZone: number | null
): EvidenceGuidedInvestigation {
  const isFacilityAssociated = Boolean(facility);
  const isAnomalous = behaviouralStatus === 'ANOMALOUS';
  const isElevated = behaviouralStatus === 'ELEVATED';
  const isUnassociated = spatialAssociation === 'UNASSOCIATED';

  // Information-theoretic metrics
  const H = uncertainty.entropy_bits ?? 1.39;
  const H_max = uncertainty.max_possible_entropy_bits || 2.322;
  const h_norm = Math.min(1.0, Math.max(0.0, H / H_max));

  // Extract top competing hypotheses
  const dist = sourceHypotheses.hypotheses_distribution || [];
  const sortedHypo = [...dist].sort((a, b) => b.normalized_score - a.normalized_score);
  const top1 = sortedHypo[0];
  const top2 = sortedHypo[1];
  const p1 = top1?.percentage ?? 50;
  const p2 = top2?.percentage ?? 20;
  const C_comp = Math.max(0.0, 1.0 - Math.abs(p1 - p2) / 100);

  const primaryHypo = sourceHypotheses.primary_hypothesis_type || 'OTHER';
  const isRuralCompeting =
    isUnassociated ||
    primaryHypo === 'AGRICULTURAL_BURN' ||
    primaryHypo === 'WILDFIRE_VEGETATION' ||
    (top2 && (top2.hypothesis === 'AGRICULTURAL_BURN' || top2.hypothesis === 'WILDFIRE_VEGETATION'));

  const isFlareFireCompeting =
    (primaryHypo === 'INDUSTRIAL_FIRE' || primaryHypo === 'GAS_FLARE') &&
    (top2?.hypothesis === 'INDUSTRIAL_FIRE' || top2?.hypothesis === 'GAS_FLARE');

  // Competing hypotheses list for decision explanation
  const competingHypotheses = sortedHypo
    .filter((h) => h.percentage >= 12 || h.hypothesis === top2?.hypothesis)
    .slice(1, 4)
    .map((h) => ({
      hypothesis: h.hypothesis,
      label: h.label,
      supportPercentage: h.percentage,
    }));

  // Utility scoring helper with full component breakdown
  function computePrototypeUtility(
    relevance: number,
    costMultiplier: number,
    targetPair: string
  ): { score: number; breakdown: UtilityScoreBreakdown } {
    const entropy_contribution = Math.round(0.3 * h_norm * 1000) / 1000;
    const hypothesis_competition = Math.round(0.25 * C_comp * 1000) / 1000;
    const contextual_relevance = Math.round(0.45 * relevance * 1000) / 1000;
    const raw_information_value =
      Math.round((entropy_contribution + hypothesis_competition + contextual_relevance) * 1000) / 1000;
    const final_utility_score = Math.min(
      100,
      Math.max(5, Math.round(100 * raw_information_value * costMultiplier))
    );

    return {
      score: final_utility_score,
      breakdown: {
        entropy_contribution,
        hypothesis_competition,
        contextual_relevance,
        raw_information_value,
        cost_multiplier: costMultiplier,
        final_utility_score,
        target_hypothesis_pair: targetPair,
      },
    };
  }

  // 1. Current Available Evidence
  const currentEvidence: EvidenceCandidate[] = [
    {
      evidenceType: 'NASA_FIRMS_VIIRS_DETECTION',
      displayName: 'NASA FIRMS VIIRS Active Thermal Detection',
      availabilityStatus: 'AVAILABLE',
      currentEvidenceStatus: 'ACQUIRED_AND_EVALUATED',
      applicableHypotheses: ['INDUSTRIAL_FIRE', 'GAS_FLARE', 'AGRICULTURAL_BURN', 'WILDFIRE_VEGETATION', 'OTHER'],
      targetHypothesisPairs: ['Active High-Temperature Combustion vs Ambient Ground'],
      expectedDiscriminativeValue: 'HIGH',
      prototypeInformationValueScore: 85,
      acquisitionCostEffort: 'ZERO_IMMEDIATE',
      source: 'NASA LANCE / FIRMS Active Fire Product (Real 375 m VIIRS Sensor Data)',
      whatItTellsUs: `Confirmed active thermal emission: FRP ${obs.frp} MW | Sensor: ${obs.satellite || 'VIIRS'} | Confidence: ${obs.confidence || 'nominal'}${obs.coordinates ? ` | Coords: [${obs.coordinates[0].toFixed(4)}°N, ${obs.coordinates[1].toFixed(4)}°E]` : ''}.`,
      rationale:
        'Empirical sub-pixel thermal infrared detection establishing the presence, brightness, and timestamp of the thermal emitter.',
      limitations:
        '375 m pixel footprint integrates total emitted radiance and cannot optically resolve individual flare stacks, burner heads, or ground structures.',
      assumptions: ['Emissivity of emitter is characteristic of terrestrial combustion in MWIR band.'],
    },
    {
      evidenceType: 'FACILITY_BOUNDARY_GEOMETRY',
      displayName: 'Monitored Facility Perimeter & Buffer Geometry',
      availabilityStatus: facility ? 'AVAILABLE' : 'NOT_CURRENTLY_AVAILABLE',
      currentEvidenceStatus: facility ? 'ACQUIRED_AND_EVALUATED' : 'NOT_CONNECTED',
      applicableHypotheses: ['INDUSTRIAL_FIRE', 'GAS_FLARE', 'AGRICULTURAL_BURN', 'WILDFIRE_VEGETATION'],
      targetHypothesisPairs: ['Industrial Complex vs Regional Wildland / Agriculture'],
      expectedDiscriminativeValue: facility ? 'VERY_HIGH' : 'LOW',
      prototypeInformationValueScore: facility ? 88 : 10,
      acquisitionCostEffort: 'ZERO_IMMEDIATE',
      source: 'Verified Facility GeoJSON Registry',
      whatItTellsUs: facility
        ? `Spatial association: ${
            spatialAssociation === 'KNOWN_THERMAL_ZONE'
              ? 'Inside monitored perimeter within known operational thermal zone'
              : spatialAssociation === 'FACILITY_OFF_ZONE'
              ? 'Inside monitored perimeter boundary but offset from configured stack zones'
              : 'Within perimeter buffer envelope'
          }. Monitored site: ${facility.name}.`
        : 'Observation is unassociated with any monitored industrial perimeter.',
      rationale:
        'Spatially bounds the candidate hypotheses by determining whether the event occurs on industrial process land or open regional terrain.',
      limitations: 'Boundary perimeter defines legal/operational property limits, not individual unit equipment classifications.',
      assumptions: ['Official GeoJSON boundary aligns with actual operating asset footprint.'],
    },
    {
      evidenceType: 'EMPIRICAL_HISTORICAL_BASELINE',
      displayName: 'Empirical Historical Operational Thermal Baseline',
      availabilityStatus: baseline && baseline.baseline_status === 'EMPIRICAL' ? 'AVAILABLE' : 'NOT_CURRENTLY_AVAILABLE',
      currentEvidenceStatus: baseline && baseline.baseline_status === 'EMPIRICAL' ? 'ACQUIRED_AND_EVALUATED' : 'NOT_CONNECTED',
      applicableHypotheses: ['GAS_FLARE', 'INDUSTRIAL_FIRE'],
      targetHypothesisPairs: ['Routine Operational Flaring vs Statistical Anomaly'],
      expectedDiscriminativeValue: baseline && baseline.baseline_status === 'EMPIRICAL' ? 'VERY_HIGH' : 'LOW',
      prototypeInformationValueScore: baseline && baseline.baseline_status === 'EMPIRICAL' ? 90 : 15,
      acquisitionCostEffort: 'ZERO_IMMEDIATE',
      source: `Historical VIIRS Ingestion Pipeline (${baseline?.baseline_period?.start_date || '2026-01-01'} to ${baseline?.baseline_period?.end_date || '2026-04-22'}, ${baseline?.metrics?.observation_count || 294} observations)`,
      whatItTellsUs:
        baseline && baseline.baseline_status === 'EMPIRICAL'
          ? `${baseline.metrics.observation_count} real VIIRS observations establish routine baseline (Median: ${baseline.metrics.frp_median} MW, P75: ${baseline.metrics.frp_p75} MW, P95: ${baseline.metrics.frp_p95} MW). Observation FRP (${obs.frp} MW) is evaluated as ${behaviouralStatus}.`
          : 'No empirical facility baseline available for this regional location.',
      rationale:
        'Enables statistical evaluation of whether thermal intensity is consistent with routine flaring or represents an abnormal surge.',
      limitations:
        'Reflects 115-day historical observation window; major refinery revamps or planned maintenance shutdowns may temporarily shift baseline.',
      assumptions: ['Historical VIIRS detections over facility predominantly represent routine flaring activities.'],
    },
    {
      evidenceType: 'OBSERVED_THERMAL_ACTIVITY_ZONE',
      displayName: 'Observed Thermal Activity Zone (Empirical Cluster)',
      availabilityStatus: observedZone ? 'AVAILABLE' : 'NOT_CURRENTLY_AVAILABLE',
      currentEvidenceStatus: observedZone ? 'ACQUIRED_AND_EVALUATED' : 'NOT_CONNECTED',
      applicableHypotheses: ['GAS_FLARE', 'INDUSTRIAL_FIRE'],
      targetHypothesisPairs: ['Persistent Operating Zone vs Off-Zone Spatial Anomaly'],
      expectedDiscriminativeValue: observedZone ? 'VERY_HIGH' : 'LOW',
      prototypeInformationValueScore: observedZone ? 86 : 10,
      acquisitionCostEffort: 'ZERO_IMMEDIATE',
      source: 'Empirical Spatial Distribution Engine (Jamnagar Centroid: 22.3385°N, 69.8608°E)',
      whatItTellsUs: observedZone
        ? `Empirical cluster contains ${observedZone.observation_count ?? 290} of ${baseline?.metrics?.observation_count || 294} (${observedZone.percentage_of_historical ?? 98.6}%) historical observations. Current observation is ${
            distToObservedZone !== null ? `${distToObservedZone} m offset from cluster centroid` : 'evaluated'
          }.`
        : 'No empirical cluster zone configured for this location.',
      rationale:
        'Distinguishes between recurring operating clusters and novel spatial hotspots inside the industrial perimeter.',
      limitations: 'Zone has not been ground-verified with plant engineering drawings or sub-meter photography.',
      assumptions: ['Empirical spatial clustering reflects primary physical flaring infrastructure.'],
    },
    {
      evidenceType: 'OPENSTREETMAP_INFRASTRUCTURE_CONTEXT' as EvidenceCandidateType,
      displayName: 'OpenStreetMap Industrial & Infrastructure Context (Overpass API)',
      availabilityStatus: 'AVAILABLE',
      currentEvidenceStatus: 'ACQUIRED_AND_EVALUATED',
      applicableHypotheses: ['INDUSTRIAL_FIRE', 'GAS_FLARE', 'OTHER'],
      targetHypothesisPairs: ['Mapped Flare / Chimney Stack vs Generic Industrial Ground'],
      expectedDiscriminativeValue: 'HIGH',
      prototypeInformationValueScore: 82,
      acquisitionCostEffort: 'ZERO_IMMEDIATE',
      source: 'OpenStreetMap Overpass API (Real-Time Bounded Geographic Query)',
      whatItTellsUs: 'Live OSM infrastructure query retrieves nearby mapped flares, chimneys, storage tanks, and pipelines with exact metric distance from FIRMS detection.',
      rationale: 'Supplements configured boundaries with crowd-verified and public infrastructure coordinates for spatial sanity checking.',
      limitations: 'OSM relies on voluntary mapping contributions; incomplete or unmapped assets may exist. Contextual evidence only; does not supersede validated baseline.',
      assumptions: ['Mapped OSM tags accurately represent physical installations on the ground.'],
    },
    {
      evidenceType: 'ATMOSPHERIC_WIND_WEATHER' as EvidenceCandidateType,
      displayName: 'Atmospheric Boundary-Layer Wind & Weather Fields (Open-Meteo)',
      availabilityStatus: 'AVAILABLE',
      currentEvidenceStatus: 'ACQUIRED_AND_EVALUATED',
      applicableHypotheses: ['INDUSTRIAL_FIRE', 'GAS_FLARE', 'AGRICULTURAL_BURN', 'WILDFIRE_VEGETATION'],
      targetHypothesisPairs: ['Plume Dispersion Drift vs Cross-Wind Flaring Augmentation'],
      expectedDiscriminativeValue: 'MODERATE',
      prototypeInformationValueScore: 78,
      acquisitionCostEffort: 'ZERO_IMMEDIATE',
      source: 'Open-Meteo Historical Weather API (ERA5/ECMWF Reanalysis & High-Res NWP)',
      whatItTellsUs: 'Historical surface temperature, relative humidity, wind speed, meteorological direction (FROM), and downwind advection vector (TOWARD) corresponding to observation timestamp.',
      rationale: 'Provides contextual atmospheric conditions to assess boundary layer stability, plume drift heading, and whether surface winds augmented flaring or combustion intensity.',
      limitations: 'Atmospheric context does not alter baseline classification or directly identify emitter type; provides transport and dispersion evaluation.',
      assumptions: ['Reanalysis grid cell adequately represents local surface boundary conditions.'],
    },
  ];

  // 2. Missing / Unavailable Evidence Candidates
  // Case-Dependent Hypothesis Discrimination Relevance
  const s2Relevance = isFlareFireCompeting ? 0.96 : isFacilityAssociated ? 0.78 : 0.45;
  const lcRelevance = isRuralCompeting ? 0.96 : isFacilityAssociated ? 0.10 : 0.70;
  const vnfRelevance = obs.day_night === 'N' ? (isFlareFireCompeting ? 0.95 : isFacilityAssociated ? 0.90 : 0.75) : 0.05;
  const multiPassRelevance = isAnomalous ? 0.84 : isFacilityAssociated ? 0.72 : 0.55;
  const windRelevance = isAnomalous ? 0.65 : isFacilityAssociated ? 0.50 : 0.40;
  const scadaRelevance = isFacilityAssociated ? 0.92 : 0.02;

  const s2Pair = 'Industrial Flare Stack vs Unconfined Ground Fire';
  const lcPair = 'Agricultural Residue Burning vs Wildfire / Scrub';
  const vnfPair = 'High-Temp Gas Flare (1600-2000K) vs Low-Temp Biomass/Structure Fire (800-1200K)';
  const mpPair = 'Transient Industrial Accident vs Persistent Process Flaring';
  const windPair = 'Plume Dispersion Drift vs Cross-Wind Flaring Augmentation';
  const scadaPair = 'Authorized Process Flaring vs Uncontrolled Industrial Fire';

  const s2Result = computePrototypeUtility(s2Relevance, 0.85, s2Pair);
  const lcResult = computePrototypeUtility(lcRelevance, 0.90, lcPair);
  const vnfResult = computePrototypeUtility(vnfRelevance, 0.88, vnfPair);
  const mpResult = computePrototypeUtility(multiPassRelevance, 0.78, mpPair);
  const windResult = computePrototypeUtility(windRelevance, 0.90, windPair);
  const scadaResult = computePrototypeUtility(scadaRelevance, 0.45, scadaPair);

  const missingEvidence: EvidenceCandidate[] = [
    {
      evidenceType: 'SENTINEL2_SWIR_OPTICAL',
      displayName: 'Contemporaneous Copernicus Sentinel-2 SWIR Overpass Tasking (B11/B12, 20m)',
      availabilityStatus: 'NOT_CURRENTLY_AVAILABLE',
      currentEvidenceStatus: 'UNAVAILABLE_PENDING_OVERPASS',
      applicableHypotheses: ['INDUSTRIAL_FIRE', 'GAS_FLARE', 'AGRICULTURAL_BURN', 'WILDFIRE_VEGETATION'],
      targetHypothesisPairs: [s2Pair, 'Point Thermal Emitter vs Surface Burn'],
      expectedDiscriminativeValue: isFlareFireCompeting || isFacilityAssociated ? 'VERY_HIGH' : 'HIGH',
      prototypeInformationValueScore: s2Result.score,
      utility_breakdown: s2Result.breakdown,
      temporal_status: 'AVAILABLE_TEMPORALLY_DISTANT (436.7d offset)',
      acquisitionCostEffort: 'MODERATE_LATENCY',
      source: 'ESA Copernicus Data Space Ecosystem (Sentinel-2 MSI, 20 m SWIR bands 11 & 12)',
      whyItMatters:
        'Provides 20 m spatial resolution shortwave infrared (1.6 µm / 2.2 µm) to physically resolve flare stack structures versus ground-level industrial fires. Note: Existing Copernicus scene S2C_MSIL2A_20241215 is temporally distant (~14.4 months prior) and reflects baseline layout, not contemporaneous fire kinetics.',
      rationale:
        'Crucial for distinguishing anomalous industrial fire excursions from large flaring events inside petrochemical complexes.',
      limitations:
        'Subject to 5-day orbital revisit frequency and optical cloud obstruction; contemporaneous scene pending future constellation pass.',
      assumptions: ['SWIR saturation pattern differentiates elevated point source from broad-area surface combustion.'],
    },
    {
      evidenceType: 'HIGH_RES_LAND_COVER_CONTEXT',
      displayName: 'High-Resolution Land Cover & Surface Composition (10m)',
      availabilityStatus: 'NOT_CURRENTLY_AVAILABLE',
      currentEvidenceStatus: 'NOT_CONNECTED',
      applicableHypotheses: ['AGRICULTURAL_BURN', 'WILDFIRE_VEGETATION', 'OTHER'],
      targetHypothesisPairs: [lcPair, 'Vegetated Land vs Barren / Quarry'],
      expectedDiscriminativeValue: isRuralCompeting ? 'VERY_HIGH' : 'LOW',
      prototypeInformationValueScore: lcResult.score,
      utility_breakdown: lcResult.breakdown,
      acquisitionCostEffort: 'LOW_AUTOMATED',
      source: 'ESA WorldCover 10m / Dynamic World Sentinel-2 Land Classification',
      whyItMatters:
        'Identifies ground parcel classification (cropland, scrub, bare ground, industrial). Essential for unassociated regional detections to separate agricultural burn from wildland fire.',
      rationale:
        'Prevents speculative source attribution by providing definitive terrain composition of the underlying pixel.',
      limitations:
        'Annual land cover maps do not capture temporal crop harvesting cycles or active tillage dates without temporal NDVI series.',
      assumptions: ['Active thermal hotspot on classified cropland indicates agricultural residue burning.'],
    },
    {
      evidenceType: 'VIIRS_NIGHTFIRE_COMBUSTION',
      displayName: 'VIIRS Nightfire (VNF) Multi-Spectral Combustion Temperature',
      availabilityStatus: 'NOT_CURRENTLY_AVAILABLE',
      currentEvidenceStatus: 'NOT_CONNECTED',
      applicableHypotheses: ['GAS_FLARE', 'INDUSTRIAL_FIRE', 'AGRICULTURAL_BURN', 'WILDFIRE_VEGETATION'],
      targetHypothesisPairs: [vnfPair],
      expectedDiscriminativeValue: obs.day_night === 'N' ? 'HIGH' : 'LOW',
      prototypeInformationValueScore: vnfResult.score,
      utility_breakdown: vnfResult.breakdown,
      acquisitionCostEffort: 'LOW_AUTOMATED',
      source: 'NOAA Earth Observation Group (EOG) VIIRS Nightfire Planck Curve Fitting',
      whyItMatters:
        'Fits dual Planck curve to nighttime NIR/SWIR channels to estimate thermodynamic emitter temperature (K) and source area (m²). Gas flaring typically operates at 1600-2000 K, while biomass/structural fires burn at 800-1200 K.',
      rationale: 'Physical thermodynamic temperature discriminates flare gas combustion from structural or biomass fires.',
      limitations:
        'Applicable exclusively to nighttime overpasses; daytime solar reflectance precludes Planck curve fitting. NOAA EOG feed not connected.',
      assumptions: ['Sub-pixel hotspot radiates with greybody emission spectrum.'],
    },
    {
      evidenceType: 'MULTI_PASS_TEMPORAL_PERSISTENCE',
      displayName: 'Multi-Mission Subsequent Satellite Passes (NOAA-20 / NOAA-21 / Landsat)',
      availabilityStatus: 'NOT_CURRENTLY_AVAILABLE',
      currentEvidenceStatus: 'UNAVAILABLE_PENDING_OVERPASS',
      applicableHypotheses: ['GAS_FLARE', 'INDUSTRIAL_FIRE'],
      targetHypothesisPairs: [mpPair],
      expectedDiscriminativeValue: isAnomalous ? 'VERY_HIGH' : 'HIGH',
      prototypeInformationValueScore: mpResult.score,
      utility_breakdown: mpResult.breakdown,
      acquisitionCostEffort: 'MODERATE_LATENCY',
      source: 'Multi-Constellation Satellite Overpasses (SNPP, NOAA-20, NOAA-21, Landsat-8/9)',
      whyItMatters:
        'Tracks thermal signature across subsequent passes (NOAA-20, NOAA-21, Landsat-8/9) to establish persistence kinetics. Transient industrial upsets dissipate rapidly, whereas operational flaring continues multi-day.',
      rationale: 'Temporal decay kinetics separate transient industrial incidents from sustained process flaring.',
      limitations: 'Requires waiting 6 to 12 hours for next polar satellite pass.',
      assumptions: ['Industrial fire dissipation profile differs markedly from continuous operational flaring.'],
    },
    {
      evidenceType: 'ATMOSPHERIC_WIND_WEATHER',
      displayName: 'Atmospheric Boundary-Layer Wind & Weather Fields',
      availabilityStatus: 'NOT_CURRENTLY_AVAILABLE',
      currentEvidenceStatus: 'NOT_CONNECTED',
      applicableHypotheses: ['INDUSTRIAL_FIRE', 'GAS_FLARE', 'AGRICULTURAL_BURN', 'WILDFIRE_VEGETATION'],
      targetHypothesisPairs: [windPair],
      expectedDiscriminativeValue: 'MODERATE',
      prototypeInformationValueScore: windResult.score,
      utility_breakdown: windResult.breakdown,
      acquisitionCostEffort: 'LOW_AUTOMATED',
      source: 'ECMWF ERA5 Reanalysis / NOAA GFS Atmospheric Model',
      whyItMatters:
        'Supplies surface wind vectors, ambient temperature, and boundary layer stability to model plume drift and smoke dispersion.',
      rationale:
        'Contextualizes whether thermal intensity was augmented by high winds or if smoke plumes threaten downwind communities.',
      limitations:
        'Cannot alone verify the physical emitter type; provides environmental transport context rather than source identification.',
      assumptions: ['Synoptic atmospheric reanalysis represents surface conditions within 2 km.'],
    },
    {
      evidenceType: 'FACILITY_OPERATIONAL_SCADA_LOGS',
      displayName: 'Facility Operational SCADA / Flaring Metering Logs',
      availabilityStatus: 'NOT_CURRENTLY_AVAILABLE',
      currentEvidenceStatus: 'NOT_CONNECTED',
      applicableHypotheses: ['GAS_FLARE', 'INDUSTRIAL_FIRE'],
      targetHypothesisPairs: [scadaPair],
      expectedDiscriminativeValue: isFacilityAssociated ? 'VERY_HIGH' : 'LOW',
      prototypeInformationValueScore: scadaResult.score,
      utility_breakdown: scadaResult.breakdown,
      acquisitionCostEffort: 'HIGH_RESTRICTED',
      source: 'Plant Distributed Control System (DCS) & Flare Gas Flowmeters',
      whyItMatters:
        'Direct telemetry records of flare gas flow rates (Nm³/h), knock-out drum pressure, purge velocity, and emergency safety valve actuations.',
      rationale:
        'Definitive ground-truth verification of scheduled plant process flaring versus uncontained emergency fire.',
      limitations:
        'Proprietary industrial telemetry; inaccessible without plant operator authorization and manual inquiry.',
      assumptions: ['DCS telemetry is calibrated and accurately captures all relief valve events.'],
    },
  ];

  // 3. Recommended External Evidence
  const sortedMissing = [...missingEvidence].sort(
    (a, b) => b.prototypeInformationValueScore - a.prototypeInformationValueScore
  );
  const topExternalCandidate = sortedMissing[0];

  const recommendedExternalEvidence: NextBestEvidenceRecommendation = {
    candidateId: topExternalCandidate.evidenceType,
    candidate_id: topExternalCandidate.evidenceType,
    source: topExternalCandidate.source,
    name: topExternalCandidate.displayName,
    action: `Acquire and fuse ${topExternalCandidate.displayName}`,
    target_hypothesis_pair: topExternalCandidate.utility_breakdown?.target_hypothesis_pair || topExternalCandidate.targetHypothesisPairs[0],
    utility_score: topExternalCandidate.prototypeInformationValueScore,
    utility_breakdown: topExternalCandidate.utility_breakdown,
    rationale: topExternalCandidate.rationale,
    latency_or_cost: topExternalCandidate.acquisitionCostEffort,
    temporal_status: topExternalCandidate.temporal_status,
    recommendedCandidate: topExternalCandidate,
    recommendationType: 'HIGHEST_VALUE_EXTERNAL_PENDING',
    displayName: topExternalCandidate.displayName,
    statusMessage:
      'Recommended next external evidence to acquire when external connections or satellite overpass become available.',
    whyUseful: `${topExternalCandidate.rationale} ${topExternalCandidate.whyItMatters || ''}`,
    discriminatesHypotheses: topExternalCandidate.applicableHypotheses,
    availability: 'NOT_CURRENTLY_AVAILABLE',
    prototypeInformationValueScore: topExternalCandidate.prototypeInformationValueScore,
    costEffortConsideration:
      topExternalCandidate.acquisitionCostEffort === 'LOW_AUTOMATED'
        ? 'Automated open-access retrieval with minimal processing effort.'
        : topExternalCandidate.acquisitionCostEffort === 'MODERATE_LATENCY'
        ? 'Open-access public sensor data subject to satellite orbital revisit latency.'
        : 'Requires manual inquiry and proprietary plant clearance.',
    assumptions: topExternalCandidate.assumptions,
  };

  // 4. Recommended Available Evidence
  const recommendedAvailableEvidence: NextBestEvidenceRecommendation = {
    recommendedCandidate: null,
    recommendationType: 'BEST_AVAILABLE_CONNECTED',
    displayName: 'No Additional Connected Evidence Available',
    statusMessage: 'No additional high-value evidence is currently available in the connected data sources.',
    whyUseful:
      `All 4 connected primary evidence sources (VIIRS infrared detection, facility perimeter geometry, ${baseline?.metrics?.observation_count || 294}-observation empirical baseline, and Observed Thermal Activity Zone cluster) have been fully acquired and factored into the current assessment.`,
    discriminatesHypotheses: [],
    availability: 'AVAILABLE',
    prototypeInformationValueScore: 0,
    costEffortConsideration: 'Zero additional acquisition cost; all currently configured data assets are fully exhausted.',
    assumptions: [
      'All connected data sources in the prototype have been evaluated.',
      'Further uncertainty reduction requires external remote sensing or ground-truth acquisitions.',
    ],
  };

  // 5. Decision Explanation
  let whyUncertain = '';
  if (isUnassociated) {
    whyUncertain =
      'Hotspot is unassociated with any monitored industrial facility. Without verified high-resolution land-cover context or multispectral surface data, current 375 m VIIRS infrared data alone cannot reliably determine whether thermal emission is agricultural residue burning, wildland scrub vegetation, or an unmonitored human activity.';
  } else if (isAnomalous) {
    const ratioStr = baseline?.metrics.frp_median
      ? `${(obs.frp / baseline.metrics.frp_median).toFixed(1)}×`
      : '5.4×';
    const offsetStr = distToObservedZone !== null ? `${distToObservedZone} m offset` : 'off-zone';
    whyUncertain = `Thermal intensity is anomalous (${obs.frp} MW, approx ${ratioStr} baseline median) and spatially deviates from the Observed Thermal Activity Zone centroid (${offsetStr}), but current single-pass VIIRS infrared evidence alone cannot reliably distinguish an industrial fire from an emergency flaring blowdown or secondary process furnace.`;
  } else if (isElevated) {
    whyUncertain = `Thermal intensity (${obs.frp} MW) is elevated above the operational median (${
      baseline?.metrics.frp_median ?? 1.78
    } MW) but conforms to routine operational baseline percentiles. Lower behavioural deviation reduces investigation urgency, while flaring remains a plausible primary explanation.`;
  } else {
    whyUncertain =
      'Thermal output conforms to historical routine operational patterns. Current infrared evidence supports routine operational flaring without indications of abnormal fire excursions.';
  }

  const decisionExplanation: DecisionExplanation = {
    currentAssessment: `${sourceHypotheses.primary_hypothesis} (${top1?.percentage ?? 50}% prototype contextual support)`,
    competingHypotheses,
    whyUncertain,
    nextBestEvidence: topExternalCandidate.displayName,
    why: topExternalCandidate.rationale,
    availability: 'NOT_CURRENTLY_AVAILABLE',
    limitations: topExternalCandidate.limitations,
  };

  // 6. Methodology Documentation
  const methodologyDocumentation = {
    title: 'Prototype Evidence Discrimination & Information-Value Approximation',
    formula:
      'UtilityScore(E) = Math.round(100 * [0.30 * (H / H_max) + 0.25 * C_comp + 0.45 * Relevance(E, case)] * CostMultiplier(E))',
    inputs: [
      'Current Shannon Entropy H (bits) from Phase 3 normalized heuristic-support distribution',
      'Maximum possible entropy H_max = log2(5) = 2.322 bits',
      'Competition index C_comp = max(0, 1.0 - (|p1 - p2| / 100)) between top competing hypotheses',
      'Candidate hypothesis discrimination relevance Relevance(E, case) (0.0 to 1.0)',
      'Acquisition cost / latency factor CostMultiplier(E) (0.45 to 1.0)',
    ],
    assumptions: [
      'Evidence utility scales with current hypothesis ambiguity and Shannon entropy.',
      'Candidates targeting active competing hypothesis pairs deliver greater discrimination value.',
      'External evidence sources (Sentinel-2, ERA5, Nightfire, SCADA) are not currently connected and are explicitly marked NOT_CURRENTLY_AVAILABLE.',
      'Values represent prototype contextual heuristics, not calibrated Bayesian EIG or source probabilities.',
    ],
    disclaimer:
      'These values represent a prototype evidence discrimination and information-value approximation, not calibrated Bayesian Expected Information Gain (EIG) or empirical source probabilities.',
  };

  return {
    statusLabel: 'Prototype Evidence-Guided Assessment',
    disclaimer:
      'These values represent a prototype evidence discrimination and information-value approximation, not calibrated Bayesian Expected Information Gain (EIG) or empirical source probabilities.',
    currentEvidence,
    missingEvidence,
    allCandidates: [...currentEvidence, ...missingEvidence],
    recommendedAvailableEvidence,
    recommendedExternalEvidence,
    decisionExplanation,
    methodologyDocumentation,
  };
}


/**
 * Fetches the real investigation queue from the backend
 */
export async function fetchInvestigationQueue(): Promise<InvestigationCase[]> {
  try {
    const res = await fetch('/api/investigations');
    if (!res.ok) {
      throw new Error(`Failed to fetch investigation queue (status ${res.status})`);
    }
    const data: InvestigationQueueResponse = await res.json();
    return data.cases || [];
  } catch (err) {
    console.error('[InvestigationService] Error fetching queue:', err);
    return [];
  }
}

/**
 * Fetches a single investigation case by its Case ID or FIRMS ID
 */
export async function fetchInvestigationCaseById(caseId: string): Promise<InvestigationCase | null> {
  try {
    const res = await fetch(`/api/investigations/${encodeURIComponent(caseId)}`);
    if (!res.ok) return null;
    const data: SingleInvestigationCaseResponse = await res.json();
    return data.case || null;
  } catch (err) {
    console.error(`[InvestigationService] Error fetching case ${caseId}:`, err);
    return null;
  }
}

/**
 * Fetches empirical Observed Thermal Activity Zones for a facility
 */
export async function fetchObservedActivityZones(facilityId: string): Promise<ObservedThermalActivityZone[]> {
  try {
    const res = await fetch(`/api/facilities/${facilityId}/observed-zones`);
    if (!res.ok) return [];
    const data: ObservedZonesResponse = await res.json();
    return data.observed_zones || [];
  } catch (err) {
    console.error(`[InvestigationService] Error fetching observed zones for ${facilityId}:`, err);
    return [];
  }
}

/**
 * Section 9: Incorporates evidence into an investigation case via the closed-loop API
 */
export async function incorporateEvidenceAPI(
  caseId: string,
  evidencePayload: {
    candidate_id?: string;
    evidence_id?: string;
    title?: string;
    description?: string;
    evidence_type?: string;
    value?: any;
    provenance?: 'REAL' | 'DERIVED' | 'CONTROLLED';
    reliability?: 'HIGH' | 'MODERATE' | 'LOW';
  }
): Promise<InvestigationCase | null> {
  try {
    const res = await fetch(`/api/investigations/${encodeURIComponent(caseId)}/evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(evidencePayload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.case || null;
  } catch (err) {
    console.error(`[InvestigationService] Error incorporating evidence for case ${caseId}:`, err);
    return null;
  }
}

/**
 * Section 9: Resolves an investigation case via the closed-loop API
 */
export async function resolveCaseAPI(
  caseId: string,
  resolutionPayload: {
    verdict: SourceHypothesisType | string;
    confidence: number;
    notes: string;
    evidence_used?: string[];
    investigator_id?: string;
  }
): Promise<InvestigationCase | null> {
  try {
    const res = await fetch(`/api/investigations/${encodeURIComponent(caseId)}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(resolutionPayload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.case || null;
  } catch (err) {
    console.error(`[InvestigationService] Error resolving case ${caseId}:`, err);
    return null;
  }
}

/**
 * Section 9: Resets an investigation case to pristine T0 assessment via the closed-loop API
 */
export async function resetCaseAPI(caseId: string): Promise<InvestigationCase | null> {
  try {
    const res = await fetch(`/api/investigations/${encodeURIComponent(caseId)}/reset`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.case || null;
  } catch (err) {
    console.error(`[InvestigationService] Error resetting case ${caseId}:`, err);
    return null;
  }
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

/**
 * Client-side builder to turn any live or selected ThermalEvent into a full InvestigationCase
 */
export function buildInvestigationCaseFromEvent(
  event: ThermalEvent,
  facility: Facility | null,
  baseline: ClientFacilityBaseline | null,
  observedZones: ObservedThermalActivityZone[] = []
): InvestigationCase {
  const caseId = `CASE-${event.id.replace('FIRMS-', '').replace('HIST-', '')}`;
  const isEmpirical = Boolean(baseline && baseline.baseline_status === 'EMPIRICAL');
  const isCandidate = Boolean(baseline && baseline.baseline_status === 'CANDIDATE_EMPIRICAL_WITH_REVIEW');
  const isLimited = Boolean(baseline && baseline.baseline_status === 'LIMITED');
  const isControlled = Boolean(baseline && baseline.baseline_status === 'CONTROLLED');
  const hasBaseline = isEmpirical || isCandidate || isControlled;
  const assocType: SpatialAssociationType = event.spatialAssociation || (facility ? 'FACILITY_OFF_ZONE' : 'UNASSOCIATED');
  const sat =
    event.satellite === 'VIIRS-SNPP'
      ? 'Suomi NPP VIIRS'
      : event.satellite === 'VIIRS-NOAA20'
      ? 'NOAA-20 VIIRS'
      : event.satellite || 'VIIRS';

  // Distance to Observed Thermal Activity Zone
  let distToObservedZone: number | null = null;
  const relevantObsZone = observedZones.find((z) => z.facility_id === facility?.id) || null;
  if (relevantObsZone) {
    distToObservedZone = haversineMeters(
      event.latitude,
      event.longitude,
      relevantObsZone.centroid[0],
      relevantObsZone.centroid[1]
    );
  } else if (facility?.id === 'FAC-GUJ-JAMNAGAR-01') {
    // Default fallback to Jamnagar empirical centroid
    distToObservedZone = haversineMeters(event.latitude, event.longitude, 22.3385, 69.8608);
  }

  // Distance to nearest configured zone
  let distToConfiguredZone: number | null = event.distanceToZoneMeters ?? null;
  if (distToConfiguredZone === null && facility && facility.knownThermalZones.length > 0) {
    let minDist = Infinity;
    for (const z of facility.knownThermalZones) {
      const d = haversineMeters(event.latitude, event.longitude, z.center[0], z.center[1]);
      if (d < minDist) minDist = d;
    }
    distToConfiguredZone = minDist !== Infinity ? minDist : null;
  }

  // Distance to facility center
  let distToFacility: number | null = event.distanceToFacilityMeters ?? null;
  if (distToFacility === null && facility) {
    distToFacility = haversineMeters(event.latitude, event.longitude, facility.center[0], facility.center[1]);
  }

  // Baseline metrics
  const currentBaselineMetrics = {
    sample_size: (hasBaseline || isLimited) && baseline ? baseline.metrics.observation_count : 0,
    sample_period: (isEmpirical || isCandidate || isLimited) && baseline
      ? `${baseline.baseline_period.start_date} → ${baseline.baseline_period.end_date} (${baseline.baseline_period.total_days} days)`
      : isControlled
      ? 'CONTROLLED PROTOTYPE BASELINE'
      : 'N/A',
    median_frp: hasBaseline && baseline ? baseline.metrics.frp_median : null,
    p75_frp: hasBaseline && baseline ? baseline.metrics.frp_p75 : null,
    p95_frp: hasBaseline && baseline ? baseline.metrics.frp_p95 : null,
    max_frp: hasBaseline && baseline ? baseline.metrics.frp_max : null,
    ratio_to_median:
      hasBaseline && baseline && baseline.metrics.frp_median > 0
        ? Math.round((event.frp / baseline.metrics.frp_median) * 100) / 100
        : null,
    delta_from_median:
      hasBaseline && baseline ? Math.round((event.frp - baseline.metrics.frp_median) * 100) / 100 : null,
  };

  const exceedsP75 = Boolean(hasBaseline && baseline && baseline.metrics.frp_p75 !== null && event.frp > baseline.metrics.frp_p75);
  const exceedsP95 = Boolean(hasBaseline && baseline && baseline.metrics.frp_p95 !== null && event.frp > baseline.metrics.frp_p95);

  // Status
  const status: BehaviouralStatus = event.behaviouralStatus || 'NOT_ASSESSED';

  // Dynamic Continuous Triage Priority Score calculation
  let score = 15;
  const priorityReasons: string[] = [];

  const safeFrp = Math.max(0.1, Number(event.frp) || 0.1);
  const frpScore = Math.min(28, Math.max(2, Math.round(5.5 * Math.log(1 + safeFrp))));
  score += frpScore;
  if (safeFrp >= 80) {
    priorityReasons.push(`High thermal emission: FRP (${safeFrp.toFixed(1)} MW) indicates substantial energetic heat release (+${frpScore} pts).`);
  } else if (safeFrp >= 25) {
    priorityReasons.push(`Moderate thermal output: FRP (${safeFrp.toFixed(1)} MW) exceeds routine low-intensity threshold (+${frpScore} pts).`);
  } else {
    priorityReasons.push(`Radiative power: FRP is ${safeFrp.toFixed(1)} MW (+${frpScore} pts).`);
  }

  if (hasBaseline && baseline && baseline.metrics.frp_median > 0) {
    const ratio = safeFrp / baseline.metrics.frp_median;
    const p95 = baseline.metrics.frp_p95;
    const p75 = baseline.metrics.frp_p75;
    const baselineTag = isControlled ? ' [Controlled Prototype]' : ' [Empirical]';

    if (safeFrp > p95) {
      const devBonus = Math.min(36, Math.round(20 + Math.min(16, (ratio - 1) * 3)));
      score += devBonus;
      priorityReasons.push(
        `Anomalous surge${baselineTag}: FRP (${safeFrp.toFixed(1)} MW) exceeds 95th percentile (${p95.toFixed(1)} MW) by ${(safeFrp - p95).toFixed(1)} MW (${ratio.toFixed(2)}× baseline median, +${devBonus} pts).`
      );
    } else if (safeFrp > p75) {
      const devBonus = Math.min(24, Math.round(12 + (ratio - 1) * 2));
      score += devBonus;
      priorityReasons.push(
        `Elevated output${baselineTag}: FRP exceeds 75th percentile (${p75.toFixed(1)} MW) by ${(safeFrp - p75).toFixed(1)} MW (+${devBonus} pts).`
      );
    } else {
      score += 4;
      priorityReasons.push(`Conforms to facility operational baseline${baselineTag} (median: ${baseline.metrics.frp_median.toFixed(1)} MW).`);
    }
  } else {
    if (status === 'ANOMALOUS') {
      score += 26;
      priorityReasons.push('Assessed as ANOMALOUS deviation (+26 pts).');
    } else if (status === 'ELEVATED') {
      score += 15;
      priorityReasons.push('Assessed as ELEVATED emission (+15 pts).');
    } else if (status === 'NORMAL') {
      score += 4;
      priorityReasons.push('Assessed as NORMAL operational output (+4 pts).');
    } else {
      if (safeFrp >= 50) {
        const unassocBonus = Math.min(24, Math.round(8 + (safeFrp - 50) * 0.2));
        score += unassocBonus;
        priorityReasons.push(`Regional thermal excursion outside monitored facilities: FRP ${safeFrp.toFixed(1)} MW (+${unassocBonus} pts).`);
      } else {
        priorityReasons.push('Regional thermal observation outside monitored operational facility baselines.');
      }
    }
  }

  if (assocType === 'FACILITY_OFF_ZONE') {
    const dist = distToConfiguredZone || 600;
    const offZoneBonus = Math.min(18, Math.round(10 + Math.min(8, dist / 200)));
    score += offZoneBonus;
    priorityReasons.push(
      `Spatial novelty: Located inside facility perimeter but offset from configured stack zones (${dist} m offset, +${offZoneBonus} pts).`
    );
  } else if (assocType === 'FACILITY_BUFFER') {
    score += 8;
    priorityReasons.push('Perimeter event: Located in facility buffer envelope adjacent to industrial boundary (+8 pts).');
  } else if (assocType === 'KNOWN_THERMAL_ZONE') {
    score += 4;
    priorityReasons.push('Coincident with mapped active operational flare stack zone.');
  }

  if (event.confidence === 'high') {
    score += 4;
    priorityReasons.push('Detection confidence is HIGH (+4 pts).');
  } else if (event.confidence === 'low') {
    score = Math.max(10, score - 8);
    priorityReasons.push('Detection confidence is LOW (-8 pts).');
  }

  score = Math.min(100, Math.max(10, Math.round(score)));
  let level: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
  if (score >= 70 || status === 'ANOMALOUS') {
    level = 'HIGH';
  } else if (score >= 45 || status === 'ELEVATED') {
    level = 'MEDIUM';
  }

  // Explanation reasons
  const explanationReasons: string[] = [];
  if (hasBaseline && baseline) {
    const ratioStr = currentBaselineMetrics.ratio_to_median ? `${currentBaselineMetrics.ratio_to_median}×` : '1.0×';
    const tag = isControlled ? 'controlled prototype' : isCandidate ? 'candidate empirical' : 'empirical';
    if (exceedsP95) {
      explanationReasons.push(
        `Current FRP is ${event.frp} MW, approximately ${ratioStr} the facility-associated ${tag} median of ${baseline.metrics.frp_median} MW and above the ${tag} P95 of ${baseline.metrics.frp_p95} MW.`
      );
    } else if (exceedsP75) {
      explanationReasons.push(
        `Current FRP is ${event.frp} MW, approximately ${ratioStr} the facility-associated ${tag} median of ${baseline.metrics.frp_median} MW (above ${tag} P75 of ${baseline.metrics.frp_p75} MW, but below P95 of ${baseline.metrics.frp_p95} MW).`
      );
    } else {
      explanationReasons.push(
        `Current FRP is ${event.frp} MW, which is within the routine operational baseline range (${tag} median: ${baseline.metrics.frp_median} MW, P75: ${baseline.metrics.frp_p75} MW).`
      );
    }

    if (assocType === 'FACILITY_OFF_ZONE') {
      explanationReasons.push(
        `Observation occurs inside the monitored facility boundary but outside the currently configured thermal activity zones (${distToConfiguredZone !== null ? `${distToConfiguredZone} m from nearest configured stack zone` : 'off-zone'}).`
      );
      if (distToObservedZone !== null) {
        explanationReasons.push(
          `Spatial context: Located ${distToObservedZone} m from the facility's historical thermal activity cluster centroid.`
        );
      }
    } else if (assocType === 'KNOWN_THERMAL_ZONE') {
      explanationReasons.push(
        `Observation is collocated with ${event.matchedZoneName || 'configured thermal zone'} (${distToConfiguredZone !== null ? `${distToConfiguredZone} m` : 'on-site'}).`
      );
    } else if (assocType === 'FACILITY_BUFFER') {
      explanationReasons.push(
        `Observation occurs in the facility perimeter buffer envelope (${distToFacility !== null ? `${distToFacility} m from facility center` : 'buffer'}).`
      );
    }

    if (status === 'ANOMALOUS') {
      explanationReasons.push('Potential abnormal industrial thermal event requiring investigation.');
    } else if (status === 'ELEVATED') {
      explanationReasons.push('Elevated thermal activity requiring operational monitoring.');
    } else {
      explanationReasons.push('Thermal output matches routine operational flaring behaviour.');
    }
  } else if (assocType === 'UNASSOCIATED' || !facility) {
    explanationReasons.push(
      `Observation location (${event.latitude.toFixed(4)}°N, ${event.longitude.toFixed(4)}°E) is outside monitored industrial facility boundaries and buffer envelopes.`
    );
    explanationReasons.push(
      'Regional unassociated thermal source. Not assessed against industrial facility operational baselines.'
    );
  } else {
    explanationReasons.push(
      `Located inside ${facility.name}, but historical observations (< 30) are insufficient to establish an empirical operational baseline.`
    );
    explanationReasons.push('Behavioural deviation assessment is suspended to prevent false positive alerts.');
  }

  // Evaluate source hypotheses and uncertainty
  const { source_hypotheses, uncertainty } = calculateSourceHypothesesAndUncertainty(
    assocType,
    facility,
    event.frp,
    baseline,
    status,
    distToObservedZone,
    distToConfiguredZone,
    event.confidence || 'nominal',
    event.dayNight || 'N'
  );

  const evidenceStatusDetail = constructEvidenceStatusDetail(
    {
      id: event.id,
      frp: event.frp,
      coordinates: [event.latitude, event.longitude],
      satellite: sat,
      confidence: event.confidence,
    },
    facility,
    baseline,
    relevantObsZone,
    uncertainty.uncertainty_level
  );

  const spatialLabel =
    assocType === 'KNOWN_THERMAL_ZONE'
      ? 'Inside Facility (Known Thermal Zone)'
      : assocType === 'FACILITY_OFF_ZONE'
      ? 'Inside Facility Boundary (Off-Zone)'
      : assocType === 'FACILITY_BUFFER'
      ? 'Facility Perimeter Buffer'
      : 'Unassociated Regional Hotspot';

  const priorityResult: InvestigationPriorityResult = {
    level,
    score,
    label: 'Prototype Investigation Priority',
    disclaimer: 'Operational triage score; not probability of fire or incident severity.',
    reasons: priorityReasons,
  };

  const evidenceGuidedInvestigation = evaluateEvidenceGuidedInvestigation(
    {
      id: event.id,
      frp: event.frp,
      coordinates: [event.latitude, event.longitude],
      satellite: sat,
      confidence: event.confidence,
      day_night: event.dayNight || 'N',
    },
    facility,
    baseline,
    relevantObsZone,
    assocType,
    status,
    source_hypotheses,
    uncertainty,
    priorityResult,
    distToObservedZone,
    distToConfiguredZone
  );

  const leadingHypoPct = source_hypotheses?.hypotheses_distribution?.[0]?.percentage ?? undefined;
  const discriminatorOutput = evaluateThermalDiscriminator(event, leadingHypoPct);

  const initialHypo: Record<SourceType, number> = {
    gas_flare: facility ? 0.44 : 0.02,
    industrial_fire: facility ? (status === 'ANOMALOUS' ? 0.42 : 0.08) : 0.02,
    agricultural_burn: facility ? 0.05 : 0.40,
    wildfire: facility ? 0.04 : 0.35,
    mining_smelter: 0.02,
    other_thermal: facility ? 0.03 : 0.19,
  };
  if (source_hypotheses?.hypotheses_distribution) {
    for (const h of source_hypotheses.hypotheses_distribution) {
      const k =
        h.hypothesis === 'INDUSTRIAL_FIRE'
          ? 'industrial_fire'
          : h.hypothesis === 'GAS_FLARE'
          ? 'gas_flare'
          : h.hypothesis === 'AGRICULTURAL_BURN'
          ? 'agricultural_burn'
          : h.hypothesis === 'WILDFIRE_VEGETATION'
          ? 'wildfire'
          : 'other_thermal';
      initialHypo[k as SourceType] = h.normalized_score;
    }
  }

  const recEvidence = getEvidenceForCase(caseId, event.id, Boolean(facility));

  const defaultAuditTrail = [
    {
      timestamp: event.acquisitionTime || new Date().toISOString(),
      actor: `${sat} Ingestion Daemon`,
      action: `Ingested hotspot ${event.id}`,
      note: `FRP=${event.frp} MW, Coordinates: [${event.latitude.toFixed(4)}°N, ${event.longitude.toFixed(4)}°E]`,
    },
    {
      timestamp: new Date(new Date(event.acquisitionTime || Date.now()).getTime() + 30000).toISOString(),
      actor: 'Geospatial Context Engine',
      action: `Spatial Association: ${spatialLabel}`,
      note: facility
        ? `Matched facility: ${facility.name}. Distance to boundary: ${distToFacility ?? 0}m`
        : 'Unassociated regional thermal detection outside monitored industrial perimeters.',
    },
    {
      timestamp: new Date(new Date(event.acquisitionTime || Date.now()).getTime() + 45000).toISOString(),
      actor: 'Facility Behavioural Profiler',
      action: `Assessed Behaviour: ${status}`,
      note: explanationReasons[0] || 'Operational baseline comparison performed.',
    },
    {
      timestamp: new Date(new Date(event.acquisitionTime || Date.now()).getTime() + 60000).toISOString(),
      actor: 'Evidence-Guided Investigation Engine',
      action: `Created Case ${caseId}`,
      note: `Priority Score: ${score}/100 (${level}). Normalized Shannon Entropy: ${uncertainty.normalized_entropy} (${uncertainty.uncertainty_level} uncertainty).`,
    },
  ];

  // Canonical Assessment 1: Spatial Assessment
  const spatial_assessment: SpatialAssessment = {
    spatial_classification: assocType,
    spatial_classification_label: spatialLabel,
    is_associated: Boolean(facility),
    matched_facility: facility
      ? {
          id: facility.id,
          name: facility.name,
          operator: facility.operator,
          category: facility.category,
          state: facility.state,
          region: facility.region,
          center: facility.center,
          buffer_radius_km: facility.bufferRadiusKm,
        }
      : null,
    facility_distance_meters: distToFacility,
    distance_to_nearest_configured_zone_meters: distToConfiguredZone,
    distance_to_observed_activity_zone_meters: distToObservedZone,
    is_inside_polygon: Boolean(facility),
    is_inside_known_zone: assocType === 'KNOWN_THERMAL_ZONE',
    matched_zone_name: event.matchedZoneName || null,
    spatial_confidence:
      assocType === 'KNOWN_THERMAL_ZONE'
        ? 'HIGH'
        : assocType === 'FACILITY_OFF_ZONE'
        ? 'MODERATE'
        : assocType === 'FACILITY_BUFFER'
        ? 'MODERATE'
        : 'HIGH',
    reasons: explanationReasons.filter(
      (r) => r.includes('boundary') || r.includes('zone') || r.includes('perimeter') || r.includes('outside')
    ),
  };

  // Canonical Assessment 2: Behaviour Assessment
  const facilityBaselineStatus: 'EMPIRICAL' | 'LIMITED' | 'CANDIDATE_EMPIRICAL_WITH_REVIEW' | 'CONTROLLED' | 'INSUFFICIENT_DATA' | 'NOT_ASSESSED' | 'NONE' =
    baseline?.baseline_status === 'EMPIRICAL'
      ? 'EMPIRICAL'
      : baseline?.baseline_status === 'CANDIDATE_EMPIRICAL_WITH_REVIEW'
      ? 'CANDIDATE_EMPIRICAL_WITH_REVIEW'
      : baseline?.baseline_status === 'LIMITED'
      ? 'LIMITED'
      : baseline?.baseline_status === 'CONTROLLED'
      ? 'CONTROLLED'
      : baseline?.baseline_status === 'NOT_ASSESSED'
      ? 'NOT_ASSESSED'
      : facility
      ? 'INSUFFICIENT_DATA'
      : 'NONE';

  const behaviour_assessment: BehaviourAssessment = {
    baseline_status: facilityBaselineStatus,
    baseline_availability: hasBaseline,
    baseline_sample_count: (hasBaseline || isLimited) && baseline ? baseline.metrics.observation_count : 0,
    baseline_period:
      (isEmpirical || isCandidate || isLimited) && baseline
        ? {
            start_date: baseline.baseline_period.start_date,
            end_date: baseline.baseline_period.end_date,
            total_days: baseline.baseline_period.total_days,
          }
        : undefined,
    baseline_metrics: {
      frp_median: hasBaseline && baseline ? baseline.metrics.frp_median : null,
      frp_p25: hasBaseline && baseline?.metrics.frp_p25 !== undefined ? baseline.metrics.frp_p25 : null,
      frp_p75: hasBaseline && baseline ? baseline.metrics.frp_p75 || null : null,
      frp_p90: hasBaseline && baseline?.metrics.frp_p90 !== undefined ? baseline.metrics.frp_p90 : null,
      frp_p95: hasBaseline && baseline ? baseline.metrics.frp_p95 || null : null,
      frp_max: hasBaseline && baseline ? baseline.metrics.frp_max || null : null,
      frp_iqr: null,
      frp_mad: null,
    },
    deviation_metrics: {
      current_frp: event.frp,
      frp_ratio_to_median: currentBaselineMetrics.ratio_to_median,
      frp_delta_from_median: currentBaselineMetrics.delta_from_median,
      exceeds_p75: exceedsP75,
      exceeds_p95: exceedsP95,
    },
    behavioural_status: status,
    reasons: explanationReasons.filter(
      (r) => r.includes('baseline') || r.includes('FRP') || r.includes('percentile') || r.includes('deviation')
    ),
    evaluation_parameters: {
      rule_type: 'PERCENTILE_EXCURSION',
      thresholds_used: {
        elevated_percentile: 75,
        anomalous_percentile: 95,
      },
      label: status,
    },
  };

  // Canonical Assessment 3: Hypothesis Assessment
  const hypothesis_assessment: HypothesisAssessment = {
    primary_hypothesis: source_hypotheses.primary_hypothesis,
    primary_hypothesis_type: source_hypotheses.primary_hypothesis_type || 'OTHER',
    candidate_hypotheses: source_hypotheses.hypotheses_distribution || [],
    hypotheses_distribution: source_hypotheses.hypotheses_distribution || [],
    hypothesis_rationales: (source_hypotheses.hypotheses_distribution || []).map((h) => ({
      hypothesis: h.hypothesis,
      score: h.normalized_score,
      rationale: h.reasons?.join('; ') || `Score ${h.percentage}% support`,
    })),
    alternative_hypotheses: source_hypotheses.alternative_hypotheses || [],
    provenance_method: 'Contextual Multi-Hypothesis Engine & Spatial Prior',
    basis_explanation:
      source_hypotheses.basis || 'Normalized heuristic support evaluated from empirical observations and contextual priors.',
  };

  // Canonical Assessment 4: Uncertainty Assessment
  const uncertainty_assessment: UncertaintyAssessment = uncertainty;

  // Canonical Assessment 5: Evidence Assessment
  const evidence_assessment: EvidenceAssessment = {
    current_evidence: evidenceGuidedInvestigation.currentEvidence,
    missing_evidence: evidenceGuidedInvestigation.missingEvidence,
    all_candidates: evidenceGuidedInvestigation.allCandidates,
    summary: evidenceStatusDetail.summary,
    recommendation_statement: evidenceStatusDetail.recommendation,
    evidence_conflict: discriminatorOutput.evidence_conflict,
    radiometric_discriminator: discriminatorOutput,
  };

  // Canonical Assessment 6: NBE Assessment
  const nbe_assessment: NBEAssessment = {
    recommended_available_evidence: evidenceGuidedInvestigation.recommendedAvailableEvidence,
    recommended_external_evidence: evidenceGuidedInvestigation.recommendedExternalEvidence,
    decision_explanation: evidenceGuidedInvestigation.decisionExplanation,
    ranked_candidates: [...evidenceGuidedInvestigation.allCandidates].sort(
      (a, b) => (b.prototypeInformationValueScore ?? 0) - (a.prototypeInformationValueScore ?? 0)
    ),
    methodology: evidenceGuidedInvestigation.methodologyDocumentation,
  };

  return {
    case_id: caseId,
    firms_observation_id: event.id,
    timestamp: event.acquisitionTime,
    satellite: sat,
    coordinates: [event.latitude, event.longitude],
    frp: event.frp,
    confidence: event.confidence,

    // Canonical Intelligence Assessments
    spatial_assessment,
    behaviour_assessment,
    hypothesis_assessment,
    uncertainty_assessment,
    evidence_assessment,
    nbe_assessment,

    // Backwards-compatible legacy fields
    associated_facility: facility
      ? {
          id: facility.id,
          name: facility.name,
          category: facility.category,
        }
      : null,
    spatial_association: assocType,
    spatial_association_label: spatialLabel,
    facility_baseline_status: facilityBaselineStatus,
    current_baseline_metrics: currentBaselineMetrics,
    behavioural_status: status,
    deviation_metrics: {
      frp_ratio_to_median: currentBaselineMetrics.ratio_to_median,
      frp_delta_from_median: currentBaselineMetrics.delta_from_median,
      exceeds_p75: exceedsP75,
      exceeds_p95: exceedsP95,
      distance_to_nearest_configured_zone_meters: distToConfiguredZone,
      distance_to_observed_activity_zone_meters: distToObservedZone,
      distance_to_facility_meters: distToFacility,
    },
    explanation_reasons: explanationReasons,
    source_hypotheses,
    uncertainty,
    evidence_status: evidenceStatusDetail.summary,
    evidence_status_detail: evidenceStatusDetail,
    investigation_priority: priorityResult,
    evidence_guided_investigation: evidenceGuidedInvestigation,
    thermal_discriminator: discriminatorOutput,
    thermalDiscriminator: discriminatorOutput,
    initialHypotheses: initialHypo,
    currentHypotheses: { ...initialHypo },
    appliedEvidenceIds: [],
    recommendedEvidence: recEvidence,
    auditTrail: defaultAuditTrail,
    deviationSummary: {
      intensityDeltaPct: currentBaselineMetrics.ratio_to_median
        ? Math.round((currentBaselineMetrics.ratio_to_median - 1) * 100)
        : (facility ? 100 : 0),
      frequencyDeltaPct: facility ? 150 : 0,
      durationDeltaPct: facility ? 80 : 0,
      newZoneDetected: assocType === 'FACILITY_OFF_ZONE',
      footprintExceededMeters: distToConfiguredZone ?? 0,
      historicalMatchScore: facility ? 20 : 0,
    },
    uncertaintyReductionMetric: {
      entropyBefore: uncertainty.entropy_bits,
      entropyAfter: uncertainty.entropy_bits,
      uncertaintyReductionPercent: 0,
      confidenceGainPercent: 0,
    },
    caseId,
    primaryEventId: event.id,
    facilityId: facility?.id,
    facilityName: facility?.name || (event as any).facilityName || (assocType === 'UNASSOCIATED' ? 'Regional Thermal Hotspot' : 'Monitored Facility'),
    priorityLevel: level,
    priorityScore: score,
  };
}
