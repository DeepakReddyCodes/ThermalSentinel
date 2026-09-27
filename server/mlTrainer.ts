// ============================================================================
// ThermalSentinel — Section 6: Reproducible Machine Learning Training Pipeline
//
// Standalone, deterministic training and evaluation pipeline for the
// ThermalSentinel Thermal Source Discriminator.
//
// Protocol:
// 1. Authoritative training dataset loading (training_candidates_v4.csv)
// 2. Strict label verification (GAS_FLARE = 0, WILDFIRE_CONFIRMED = 1)
// 3. Group-preserved train/validation/test evaluation (zero event leakage)
// 4. StandardScaler fitted strictly on the TRAIN partition
// 5. L2-Regularized Logistic Regression with balanced class weighting
// 6. Complete machine-readable metrics: Macro F1, ROC-AUC, PR-AUC, Confusion Matrix,
//    and Event-Level aggregated performance.
// 7. Model artifact and metadata serialization to data/models/thermal_discriminator_v1.json
// ============================================================================

import fs from 'fs';
import path from 'path';
import { extractMLFeatures, MODEL_FEATURE_NAMES, MODEL_FEATURE_LABELS } from './mlFeaturePipeline.js';

export interface ObservationRecord {
  event_group_id: string;
  firms_observation_id: string;
  acq_datetime: string;
  label: 'GAS_FLARE' | 'WILDFIRE_CONFIRMED';
  split_assignment: 'TRAIN' | 'VALIDATION' | 'TEST' | 'EXCLUDED_FROM_SPLIT';
  target_y: number; // 0 = GAS_FLARE, 1 = WILDFIRE_CONFIRMED
  features: number[]; // 7 model features
}

export interface ScalerParams {
  means: number[];
  scales: number[];
}

export interface PartitionMetrics {
  total_obs: number;
  flare_obs: number;
  wildfire_obs: number;
  flare_prevalence_pct: number;
  total_events: number;
  flare_events: number;
  wildfire_events: number;
  accuracy: number;
  precision_flare: number;
  recall_flare: number;
  f1_flare: number;
  precision_wildfire: number;
  recall_wildfire: number;
  f1_wildfire: number;
  macro_f1: number;
  roc_auc: number;
  pr_auc_flare: number;
  pr_auc_wildfire: number;
  confusion_matrix: {
    true_flares_as_flare: number;
    true_flares_as_wildfire: number;
    true_wildfires_as_wildfire: number;
    true_wildfires_as_flare: number;
  };
  event_level: {
    flare_events_correct: number;
    flare_events_total: number;
    wildfire_events_correct: number;
    wildfire_events_total: number;
    event_accuracy: number;
    event_macro_f1: number;
  };
}

export interface SerializedModelArtifact {
  model_id: string;
  model_version: string;
  model_type: string;
  task: 'GAS_FLARE_VS_WILDFIRE_CONFIRMED';
  supported_classes: ['GAS_FLARE', 'WILDFIRE_CONFIRMED'];
  intercept: number;
  coefficients: number[];
  feature_names: string[];
  feature_labels: Record<string, string>;
  preprocessing: ScalerParams;
  training_dataset: {
    name: string;
    csv_file: string;
    total_eligible_instances: number;
    flaring_instances: number;
    wildfire_instances: number;
    total_events: number;
    split_policy: string;
  };
  evaluation_metrics: {
    train: PartitionMetrics;
    validation: PartitionMetrics;
    test: PartitionMetrics;
  };
  limitations: string[];
  trained_at: string;
}

/**
 * Loads and parses training_candidates_v4.csv
 */
export function loadTrainingCandidatesCsv(csvPath: string): ObservationRecord[] {
  if (!fs.existsSync(csvPath)) {
    throw new Error(`Training dataset CSV not found at path: ${csvPath}`);
  }

  const content = fs.readFileSync(csvPath, 'utf8');
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    throw new Error(`Training dataset CSV contains no data rows: ${csvPath}`);
  }

  const header = lines[0].split(',');
  const colIdx = {
    event_group_id: header.indexOf('event_group_id'),
    firms_observation_id: header.indexOf('firms_observation_id'),
    acq_datetime: header.indexOf('acq_datetime'),
    label: header.indexOf('label'),
    label_status: header.indexOf('label_status'),
    split_assignment: header.indexOf('split_assignment'),
    frp: header.indexOf('frp'),
    brightness_ti4: header.indexOf('brightness_ti4'),
    brightness_ti5: header.indexOf('brightness_ti5'),
    scan: header.indexOf('scan'),
    track: header.indexOf('track'),
    day_night: header.indexOf('day_night'),
    satellite: header.indexOf('satellite'),
  };

  const records: ObservationRecord[] = [];

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length < header.length) continue;

    const labelStatus = parts[colIdx.label_status]?.trim();
    const splitAssignment = parts[colIdx.split_assignment]?.trim() as any;
    const labelRaw = parts[colIdx.label]?.trim();

    // Filter to valid supervised binary target instances
    if (labelStatus !== 'MATCHED' || splitAssignment === 'EXCLUDED_FROM_SPLIT') {
      continue;
    }
    if (labelRaw !== 'GAS_FLARE' && labelRaw !== 'WILDFIRE_CONFIRMED') {
      continue;
    }

    const obs = {
      id: parts[colIdx.firms_observation_id]?.trim(),
      frp: parseFloat(parts[colIdx.frp]),
      brightness_ti4: parseFloat(parts[colIdx.brightness_ti4]),
      brightness_ti5: parseFloat(parts[colIdx.brightness_ti5]),
      scan: parseFloat(parts[colIdx.scan]),
      track: parseFloat(parts[colIdx.track]),
      day_night: parts[colIdx.day_night]?.trim(),
      satellite: parts[colIdx.satellite]?.trim() || 'VIIRS',
    };

    const extracted = extractMLFeatures(obs);
    if (!extracted.is_valid || !extracted.model_vector) {
      continue;
    }

    records.push({
      event_group_id: parts[colIdx.event_group_id]?.trim(),
      firms_observation_id: obs.id,
      acq_datetime: parts[colIdx.acq_datetime]?.trim(),
      label: labelRaw as 'GAS_FLARE' | 'WILDFIRE_CONFIRMED',
      split_assignment: splitAssignment,
      target_y: labelRaw === 'WILDFIRE_CONFIRMED' ? 1 : 0,
      features: extracted.model_vector,
    });
  }

  return records;
}

/**
 * Fits StandardScaler on TRAIN rows only.
 */
export function fitStandardScaler(trainRows: ObservationRecord[]): ScalerParams {
  const numFeatures = MODEL_FEATURE_NAMES.length;
  const n = trainRows.length;
  if (n === 0) throw new Error('Cannot fit scaler on empty dataset');

  const means: number[] = new Array(numFeatures).fill(0);
  const vars: number[] = new Array(numFeatures).fill(0);

  // Compute means
  for (const row of trainRows) {
    for (let j = 0; j < numFeatures; j++) {
      means[j] += row.features[j];
    }
  }
  for (let j = 0; j < numFeatures; j++) {
    means[j] /= n;
  }

  // Compute variances
  for (const row of trainRows) {
    for (let j = 0; j < numFeatures; j++) {
      const diff = row.features[j] - means[j];
      vars[j] += diff * diff;
    }
  }
  const scales: number[] = new Array(numFeatures).fill(1);
  for (let j = 0; j < numFeatures; j++) {
    const variance = vars[j] / n;
    scales[j] = variance > 1e-8 ? Math.sqrt(variance) : 1.0;
  }

  return { means, scales };
}

/**
 * Trains L2-Regularized Logistic Regression with balanced class weighting.
 *
 * Loss: J(w, b) = - Σ w_c [ y_i ln σ(z_i) + (1 - y_i) ln(1 - σ(z_i)) ] + (1 / (2 * C)) ||w||^2
 */
export function trainLogisticRegression(
  trainRows: ObservationRecord[],
  scaler: ScalerParams,
  config: { C?: number; maxIter?: number; learningRate?: number } = {}
): { intercept: number; coefficients: number[] } {
  const C = config.C ?? 1.0;
  const maxIter = config.maxIter ?? 1000;
  const lr = config.learningRate ?? 0.05;
  const numFeatures = MODEL_FEATURE_NAMES.length;
  const n = trainRows.length;

  const nClass0 = trainRows.filter((r) => r.target_y === 0).length;
  const nClass1 = trainRows.filter((r) => r.target_y === 1).length;

  // Balanced class weights: w_c = n / (2 * n_c)
  const weight0 = n / (2.0 * nClass0);
  const weight1 = n / (2.0 * nClass1);

  // Standardize training feature matrix X
  const X_std: number[][] = trainRows.map((r) =>
    r.features.map((val, j) => (val - scaler.means[j]) / scaler.scales[j])
  );
  const y: number[] = trainRows.map((r) => r.target_y);
  const sampleWeights: number[] = y.map((label) => (label === 1 ? weight1 : weight0));

  // Initialize weights
  let b = 0.0;
  const w: number[] = new Array(numFeatures).fill(0.0);

  // Gradient descent with L2 regularization
  const l2_reg = 1.0 / C;

  for (let iter = 0; iter < maxIter; iter++) {
    let grad_b = 0.0;
    const grad_w: number[] = new Array(numFeatures).fill(0.0);

    for (let i = 0; i < n; i++) {
      let z = b;
      for (let j = 0; j < numFeatures; j++) {
        z += w[j] * X_std[i][j];
      }
      // Clamped sigmoid to prevent overflow
      const p = 1.0 / (1.0 + Math.exp(-Math.max(-25, Math.min(25, z))));
      const err = (p - y[i]) * sampleWeights[i];

      grad_b += err;
      for (let j = 0; j < numFeatures; j++) {
        grad_w[j] += err * X_std[i][j];
      }
    }

    // Add L2 penalty gradient to weights
    for (let j = 0; j < numFeatures; j++) {
      grad_w[j] = grad_w[j] / n + (l2_reg * w[j]) / n;
      w[j] -= lr * grad_w[j];
    }
    b -= lr * (grad_b / n);
  }

  return {
    intercept: b,
    coefficients: w,
  };
}

/**
 * Computes Area Under ROC curve via trapezoidal rule
 */
function computeRocAuc(scores: number[], targets: number[]): number {
  const combined = scores.map((s, idx) => ({ score: s, target: targets[idx] }));
  combined.sort((a, b) => b.score - a.score);

  const nPos = targets.filter((t) => t === 1).length;
  const nNeg = targets.filter((t) => t === 0).length;
  if (nPos === 0 || nNeg === 0) return 1.0;

  let tp = 0;
  let fp = 0;
  let prevTp = 0;
  let prevFp = 0;
  let auc = 0;

  for (const item of combined) {
    if (item.target === 1) tp++;
    else fp++;

    // Trapezoidal step
    auc += ((tp + prevTp) / 2.0) * (fp - prevFp);
    prevTp = tp;
    prevFp = fp;
  }

  return Math.max(0, Math.min(1.0, auc / (nPos * nNeg)));
}

/**
 * Computes Area Under Precision-Recall curve
 */
function computePrAuc(scores: number[], targets: number[], posClass: number = 1): number {
  const binaryTargets = targets.map((t) => (t === posClass ? 1 : 0));
  const effectiveScores = posClass === 1 ? scores : scores.map((s) => 1.0 - s);

  const combined = effectiveScores.map((s, idx) => ({ score: s, target: binaryTargets[idx] }));
  combined.sort((a, b) => b.score - a.score);

  const totalPos = binaryTargets.filter((t) => t === 1).length;
  if (totalPos === 0) return 0;

  let tp = 0;
  let fp = 0;
  let prevRecall = 0;
  let prAuc = 0;

  for (const item of combined) {
    if (item.target === 1) tp++;
    else fp++;

    const precision = tp / (tp + fp);
    const recall = tp / totalPos;

    prAuc += precision * (recall - prevRecall);
    prevRecall = recall;
  }

  return Math.max(0, Math.min(1.0, prAuc));
}

/**
 * Evaluates a partition of observations and event groups
 */
export function evaluatePartition(
  model: { intercept: number; coefficients: number[] },
  scaler: ScalerParams,
  records: ObservationRecord[]
): PartitionMetrics {
  const total_obs = records.length;
  const flareRecords = records.filter((r) => r.target_y === 0);
  const wildfireRecords = records.filter((r) => r.target_y === 1);

  const flare_obs = flareRecords.length;
  const wildfire_obs = wildfireRecords.length;
  const flare_prevalence_pct = Math.round((flare_obs / total_obs) * 10000) / 100;

  // Observation-level inference
  const scores: number[] = [];
  const targets: number[] = [];

  let tp = 0; // True Wildfire
  let fp = 0; // Flare predicted as Wildfire
  let tn = 0; // True Flare
  let fn = 0; // Wildfire predicted as Flare

  // Event group map for event-level evaluation
  const eventPredictions = new Map<string, { totalP: number; count: number; trueLabel: number }>();

  for (const record of records) {
    let z = model.intercept;
    for (let j = 0; j < MODEL_FEATURE_NAMES.length; j++) {
      const stdVal = (record.features[j] - scaler.means[j]) / scaler.scales[j];
      z += model.coefficients[j] * stdVal;
    }
    const pWildfire = 1.0 / (1.0 + Math.exp(-Math.max(-25, Math.min(25, z))));
    scores.push(pWildfire);
    targets.push(record.target_y);

    const predClass = pWildfire >= 0.5 ? 1 : 0;
    if (record.target_y === 1) {
      if (predClass === 1) tp++;
      else fn++;
    } else {
      if (predClass === 0) tn++;
      else fp++;
    }

    // Accumulate event group predictions
    const grp = eventPredictions.get(record.event_group_id) || {
      totalP: 0,
      count: 0,
      trueLabel: record.target_y,
    };
    grp.totalP += pWildfire;
    grp.count += 1;
    eventPredictions.set(record.event_group_id, grp);
  }

  // Observation metrics
  const accuracy = Math.round(((tp + tn) / total_obs) * 10000) / 10000;

  const precFlare = tn + fn > 0 ? tn / (tn + fn) : 0;
  const recFlare = flare_obs > 0 ? tn / flare_obs : 0;
  const f1Flare = precFlare + recFlare > 0 ? (2 * precFlare * recFlare) / (precFlare + recFlare) : 0;

  const precWildfire = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recWildfire = wildfire_obs > 0 ? tp / wildfire_obs : 0;
  const f1Wildfire = precWildfire + recWildfire > 0 ? (2 * precWildfire * recWildfire) / (precWildfire + recWildfire) : 0;

  const macro_f1 = Math.round(((f1Flare + f1Wildfire) / 2.0) * 10000) / 10000;
  const rocAuc = Math.round(computeRocAuc(scores, targets) * 10000) / 10000;
  const prAucFlare = Math.round(computePrAuc(scores, targets, 0) * 10000) / 10000;
  const prAucWildfire = Math.round(computePrAuc(scores, targets, 1) * 10000) / 10000;

  // Event level evaluation
  let flareEventsTotal = 0;
  let flareEventsCorrect = 0;
  let wfEventsTotal = 0;
  let wfEventsCorrect = 0;

  for (const [, grp] of eventPredictions) {
    const meanP = grp.totalP / grp.count;
    const predEvent = meanP >= 0.5 ? 1 : 0;
    if (grp.trueLabel === 0) {
      flareEventsTotal++;
      if (predEvent === 0) flareEventsCorrect++;
    } else {
      wfEventsTotal++;
      if (predEvent === 1) wfEventsCorrect++;
    }
  }

  const totalEvents = flareEventsTotal + wfEventsTotal;
  const totalEventsCorrect = flareEventsCorrect + wfEventsCorrect;
  const eventAccuracy = totalEvents > 0 ? Math.round((totalEventsCorrect / totalEvents) * 10000) / 10000 : 1.0;

  const eventRecFlare = flareEventsTotal > 0 ? flareEventsCorrect / flareEventsTotal : 0;
  const eventRecWf = wfEventsTotal > 0 ? wfEventsCorrect / wfEventsTotal : 0;
  const eventF1 = Math.round(((eventRecFlare + eventRecWf) / 2.0) * 10000) / 10000;

  return {
    total_obs,
    flare_obs,
    wildfire_obs,
    flare_prevalence_pct,
    total_events: totalEvents,
    flare_events: flareEventsTotal,
    wildfire_events: wfEventsTotal,
    accuracy,
    precision_flare: Math.round(precFlare * 10000) / 10000,
    recall_flare: Math.round(recFlare * 10000) / 10000,
    f1_flare: Math.round(f1Flare * 10000) / 10000,
    precision_wildfire: Math.round(precWildfire * 10000) / 10000,
    recall_wildfire: Math.round(recWildfire * 10000) / 10000,
    f1_wildfire: Math.round(f1Wildfire * 10000) / 10000,
    macro_f1,
    roc_auc: rocAuc,
    pr_auc_flare: prAucFlare,
    pr_auc_wildfire: prAucWildfire,
    confusion_matrix: {
      true_flares_as_flare: tn,
      true_flares_as_wildfire: fp,
      true_wildfires_as_wildfire: tp,
      true_wildfires_as_flare: fn,
    },
    event_level: {
      flare_events_correct: flareEventsCorrect,
      flare_events_total: flareEventsTotal,
      wildfire_events_correct: wfEventsCorrect,
      wildfire_events_total: wfEventsTotal,
      event_accuracy: eventAccuracy,
      event_macro_f1: eventF1,
    },
  };
}

export const STANDARD_LIMITATIONS = [
  'Advisory only — trained exclusively on binary task: Gas Flare vs. Confirmed Wildfire.',
  'Does not model structural industrial fires, agricultural residue burns, or urban sources.',
  'Uncontained industrial fires outside continuous flare stacks fall outside the binary training domain.',
  'Output represents normalized linear logit heuristic support, NOT a calibrated event probability.',
  'Does not override spatial association, facility behavioural baseline, or investigation priority.',
];

/**
 * End-to-end training and serialization pipeline
 */
export function trainAndPersistModel(
  csvPath: string,
  outputArtifactPath: string
): SerializedModelArtifact {
  const records = loadTrainingCandidatesCsv(csvPath);

  const trainRows = records.filter((r) => r.split_assignment === 'TRAIN');
  const valRows = records.filter((r) => r.split_assignment === 'VALIDATION');
  const testRows = records.filter((r) => r.split_assignment === 'TEST');

  if (trainRows.length === 0 || testRows.length === 0) {
    throw new Error(`Insufficient partitioned data (Train: ${trainRows.length}, Test: ${testRows.length})`);
  }

  // 1. Fit scaler strictly on TRAIN rows
  const scaler = fitStandardScaler(trainRows);

  // 2. Train regularized logistic regression
  // Phase 5F audited parameters provide proven exact weights; our solver aligns with C=1.0 L2 regularization
  const trainedModel = trainLogisticRegression(trainRows, scaler, { C: 1.0, maxIter: 1500, learningRate: 0.08 });

  // 3. Evaluate partitions
  const trainMetrics = evaluatePartition(trainedModel, scaler, trainRows);
  const valMetrics = evaluatePartition(trainedModel, scaler, valRows);
  const testMetrics = evaluatePartition(trainedModel, scaler, testRows);

  const artifact: SerializedModelArtifact = {
    model_id: 'lr-v5f3-standardized',
    model_version: '1.0.0',
    model_type: 'Standardized L2-Regularized Logistic Regression (C=1.0, balanced)',
    task: 'GAS_FLARE_VS_WILDFIRE_CONFIRMED',
    supported_classes: ['GAS_FLARE', 'WILDFIRE_CONFIRMED'],
    intercept: Math.round(trainedModel.intercept * 1000000) / 1000000,
    coefficients: trainedModel.coefficients.map((c) => Math.round(c * 10000) / 10000),
    feature_names: [...MODEL_FEATURE_NAMES],
    feature_labels: MODEL_FEATURE_LABELS,
    preprocessing: {
      means: scaler.means.map((m) => Math.round(m * 1000000) / 1000000),
      scales: scaler.scales.map((s) => Math.round(s * 1000000) / 1000000),
    },
    training_dataset: {
      name: 'ThermalSentinel-Training-Candidates-v4-Diverse',
      csv_file: path.basename(csvPath),
      total_eligible_instances: records.length,
      flaring_instances: records.filter((r) => r.target_y === 0).length,
      wildfire_instances: records.filter((r) => r.target_y === 1).length,
      total_events: new Set(records.map((r) => r.event_group_id)).size,
      split_policy: 'Strict Group-Preserved Partitioning (Zero Event Overlap)',
    },
    evaluation_metrics: {
      train: trainMetrics,
      validation: valMetrics,
      test: testMetrics,
    },
    limitations: STANDARD_LIMITATIONS,
    trained_at: new Date().toISOString(),
  };

  const dir = path.dirname(outputArtifactPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(outputArtifactPath, JSON.stringify(artifact, null, 2), 'utf8');
  return artifact;
}
