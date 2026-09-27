// ============================================================================
// ThermalSentinel — Model Training & Evaluation CLI Script
//
// Usage: npx tsx scripts/train_model.ts
// ============================================================================

import path from 'path';
import { trainAndPersistModel } from '../server/mlTrainer.js';

function run() {
  console.log('='.repeat(78));
  console.log('ThermalSentinel — Executing Model Training & Evaluation Pipeline');
  console.log('='.repeat(78));

  const csvPath = path.join(process.cwd(), 'data', 'training_v4', 'training_candidates_v4.csv');
  const outPath = path.join(process.cwd(), 'data', 'models', 'thermal_discriminator_v1.json');

  console.log(`[1/4] Loading verified training candidates from: ${csvPath}`);
  const startTime = Date.now();

  const artifact = trainAndPersistModel(csvPath, outPath);
  const elapsedMs = Date.now() - startTime;

  console.log(`[2/4] Training completed in ${elapsedMs}ms`);
  console.log(`[3/4] Model artifact saved to: ${outPath}`);

  console.log('\n' + '-'.repeat(78));
  console.log(`MODEL METADATA: ${artifact.model_id} (v${artifact.model_version})`);
  console.log(`Task: ${artifact.task}`);
  console.log(`Dataset: ${artifact.training_dataset.name} (${artifact.training_dataset.total_eligible_instances} usable obs, ${artifact.training_dataset.total_events} events)`);
  console.log(`Intercept: ${artifact.intercept}`);
  console.log('Coefficients:');
  artifact.feature_names.forEach((name, idx) => {
    console.log(`  - ${name.padEnd(20)}: ${artifact.coefficients[idx]} (μ=${artifact.preprocessing.means[idx].toFixed(4)}, σ=${artifact.preprocessing.scales[idx].toFixed(4)})`);
  });

  console.log('\n' + '-'.repeat(78));
  console.log('EVALUATION RESULTS (Group-Preserved Zero-Leakage Partitions):');
  console.log('-'.repeat(78));

  const { train, validation, test } = artifact.evaluation_metrics;

  console.log(`[TRAIN]       Obs: ${train.total_obs} (${train.flare_obs} flare, ${train.wildfire_obs} wf) | Accuracy: ${(train.accuracy * 100).toFixed(2)}% | Macro F1: ${(train.macro_f1 * 100).toFixed(2)}% | ROC-AUC: ${(train.roc_auc * 100).toFixed(2)}% | Flare PR-AUC: ${(train.pr_auc_flare * 100).toFixed(2)}%`);
  console.log(`              Event-level: ${train.event_level.flare_events_correct}/${train.event_level.flare_events_total} flare events, ${train.event_level.wildfire_events_correct}/${train.event_level.wildfire_events_total} wf events | Event Acc: ${(train.event_level.event_accuracy * 100).toFixed(2)}%`);

  console.log(`[VALIDATION]  Obs: ${validation.total_obs} (${validation.flare_obs} flare, ${validation.wildfire_obs} wf) | Accuracy: ${(validation.accuracy * 100).toFixed(2)}% | Macro F1: ${(validation.macro_f1 * 100).toFixed(2)}% | ROC-AUC: ${(validation.roc_auc * 100).toFixed(2)}% | Flare PR-AUC: ${(validation.pr_auc_flare * 100).toFixed(2)}%`);
  console.log(`              Event-level: ${validation.event_level.flare_events_correct}/${validation.event_level.flare_events_total} flare events, ${validation.event_level.wildfire_events_correct}/${validation.event_level.wildfire_events_total} wf events | Event Acc: ${(validation.event_level.event_accuracy * 100).toFixed(2)}%`);

  console.log(`[TEST]        Obs: ${test.total_obs} (${test.flare_obs} flare, ${test.wildfire_obs} wf) | Accuracy: ${(test.accuracy * 100).toFixed(2)}% | Macro F1: ${(test.macro_f1 * 100).toFixed(2)}% | ROC-AUC: ${(test.roc_auc * 100).toFixed(2)}% | Flare PR-AUC: ${(test.pr_auc_flare * 100).toFixed(2)}% (Prevalence: ${test.flare_prevalence_pct}%)`);
  console.log(`              Confusion Matrix: True Flare=[${test.confusion_matrix.true_flares_as_flare} correct, ${test.confusion_matrix.true_flares_as_wildfire} miss] | True WF=[${test.confusion_matrix.true_wildfires_as_wildfire} correct, ${test.confusion_matrix.true_wildfires_as_flare} miss]`);
  console.log(`              Event-level: ${test.event_level.flare_events_correct}/${test.event_level.flare_events_total} flare events, ${test.event_level.wildfire_events_correct}/${test.event_level.wildfire_events_total} wf events | Event Acc: ${(test.event_level.event_accuracy * 100).toFixed(2)}% | Event Macro F1: ${(test.event_level.event_macro_f1 * 100).toFixed(2)}%`);

  console.log('\n[4/4] Model training and evaluation successfully verified.');
  console.log('='.repeat(78));
}

run();
