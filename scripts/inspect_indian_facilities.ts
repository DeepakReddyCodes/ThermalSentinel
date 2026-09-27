import { MONITORED_FACILITIES } from '../server/facilities.js';
import fs from 'fs';
import path from 'path';

console.log('Total facilities in registry:', MONITORED_FACILITIES.length);

const stateCounts: Record<string, number> = {};
const categoryCounts: Record<string, number> = {};

for (const fac of MONITORED_FACILITIES) {
  stateCounts[fac.state] = (stateCounts[fac.state] || 0) + 1;
  categoryCounts[fac.category] = (categoryCounts[fac.category] || 0) + 1;
}

console.log('\n--- FACILITIES BY INDIAN STATE ---');
for (const [state, count] of Object.entries(stateCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${state.padEnd(25)} : ${count} facilities`);
}

console.log('\n--- FACILITIES BY CATEGORY ---');
for (const [cat, count] of Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${cat.padEnd(25)} : ${count} facilities`);
}

// Check baseline files in data/processed
const processedDir = path.join(process.cwd(), 'data', 'processed');
const baselineFiles = fs.readdirSync(processedDir).filter(f => f.endsWith('_baseline.json'));
console.log('\n--- BASELINE COVERAGE ---');
console.log(`  Facilities with empirical baseline JSONs: ${baselineFiles.length}`);
for (const f of baselineFiles) {
  const content = JSON.parse(fs.readFileSync(path.join(processedDir, f), 'utf-8'));
  console.log(`  - ${f} : ${content.facility_name} (N=${content.metrics?.observation_count || 0}, status=${content.baseline_status})`);
}

console.log(`  Facilities without sufficient baseline data: ${MONITORED_FACILITIES.length - baselineFiles.length} (INSUFFICIENT_DATA)`);
