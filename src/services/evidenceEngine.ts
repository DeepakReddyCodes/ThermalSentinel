import { SourceType, EvidenceItem } from '../types';

/**
 * Calculates Shannon Information Entropy: H(p) = - sum(p_i * log2(p_i))
 * Higher entropy = higher uncertainty / ambiguity between competing hypotheses.
 */
export function calculateEntropy(probabilities: Record<SourceType, number>): number {
  let entropy = 0;
  for (const key of Object.keys(probabilities) as SourceType[]) {
    const p = probabilities[key];
    if (p > 0.0001) {
      entropy -= p * Math.log2(p);
    }
  }
  return parseFloat(entropy.toFixed(3));
}

/**
 * Normalizes probabilities so they sum up to exactly 1.0
 */
export function normalizeHypotheses(raw: Record<SourceType, number>): Record<SourceType, number> {
  const keys = Object.keys(raw) as SourceType[];
  const sum = keys.reduce((acc, k) => acc + Math.max(0.001, raw[k] || 0), 0);
  const normalized: Partial<Record<SourceType, number>> = {};
  for (const k of keys) {
    normalized[k] = parseFloat((Math.max(0.001, raw[k] || 0) / sum).toFixed(4));
  }
  return normalized as Record<SourceType, number>;
}

/**
 * Applies evidence findings to update hypothesis probabilities.
 */
export function fuseEvidenceIntoHypotheses(
  current: Record<SourceType, number>,
  evidenceList: EvidenceItem[]
): {
  updatedHypotheses: Record<SourceType, number>;
  entropyBefore: number;
  entropyAfter: number;
  uncertaintyReductionPercent: number;
  topHypothesis: { source: SourceType; probability: number };
} {
  const entropyBefore = calculateEntropy(current);
  const updated = { ...current };

  for (const evidence of evidenceList) {
    if (evidence.status === 'APPLIED') {
      for (const [sourceKey, delta] of Object.entries(evidence.hypothesisShifts)) {
        const key = sourceKey as SourceType;
        updated[key] = Math.max(0.005, (updated[key] || 0) + delta);
      }
    }
  }

  const normalized = normalizeHypotheses(updated);
  const entropyAfter = calculateEntropy(normalized);

  const reductionPct =
    entropyBefore > 0
      ? Math.max(0, Math.round(((entropyBefore - entropyAfter) / entropyBefore) * 100))
      : 0;

  // Find top hypothesis
  let topSource: SourceType = 'other_thermal';
  let maxProb = -1;
  for (const [k, p] of Object.entries(normalized) as [SourceType, number][]) {
    if (p > maxProb) {
      maxProb = p;
      topSource = k;
    }
  }

  return {
    updatedHypotheses: normalized,
    entropyBefore,
    entropyAfter,
    uncertaintyReductionPercent: reductionPct,
    topHypothesis: { source: topSource, probability: Math.round(maxProb * 100) },
  };
}

/**
 * Calculates the Investigation Priority Score (0 - 100)
 */
export function calculateInvestigationPriorityScore(params: {
  intensityDeltaPct: number;
  newZoneDetected: boolean;
  isAmbiguous: boolean;
  facilityCategory: string;
  frp: number;
  appliedEvidenceCount: number;
  currentIndustrialFireProb: number;
}): { score: number; level: 'HIGH' | 'MEDIUM' | 'LOW'; breakdown: Record<string, number> } {
  let score = 20; // baseline

  // 1. Intensity deviation impact (up to 30 pts)
  const intensityPoints = Math.min(30, Math.max(0, params.intensityDeltaPct * 0.2));
  score += intensityPoints;

  // 2. Spatial novelty / off-stack location (up to 25 pts)
  const spatialPoints = params.newZoneDetected ? 25 : 5;
  score += spatialPoints;

  // 3. Current Fire Hazard probability (up to 30 pts)
  const fireHazardPoints = Math.round(params.currentIndustrialFireProb * 30);
  score += fireHazardPoints;

  // 4. Critical facility type weighting (up to 15 pts)
  const facilityPoints =
    params.facilityCategory === 'refinery' || params.facilityCategory === 'petrochemical'
      ? 15
      : 8;
  score += facilityPoints;

  const finalScore = Math.min(100, Math.max(5, Math.round(score)));
  const level = finalScore >= 80 ? 'HIGH' : finalScore >= 50 ? 'MEDIUM' : 'LOW';

  return {
    score: finalScore,
    level,
    breakdown: {
      intensityWeight: Math.round(intensityPoints),
      spatialNoveltyWeight: spatialPoints,
      fireHazardWeight: fireHazardPoints,
      facilityCriticalityWeight: facilityPoints,
    },
  };
}

export function formatSourceLabel(source: SourceType): string {
  switch (source) {
    case 'gas_flare':
      return 'Authorized Gas Flare';
    case 'industrial_fire':
      return 'Industrial Fire / Hazard';
    case 'agricultural_burn':
      return 'Agricultural Crop Burn';
    case 'wildfire':
      return 'Wildfire / Vegetation';
    case 'mining_smelter':
      return 'Smelter / Slag Cooling';
    case 'other_thermal':
      return 'Other Thermal Source';
  }
}
