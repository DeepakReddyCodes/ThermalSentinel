import fs from 'fs';
import crypto from 'crypto';

function hash(filePath: string) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

console.log('Jamnagar Baseline SHA256:', hash('data/processed/FAC-GUJ-JAMNAGAR-01_baseline.json'));
console.log('Vadinar Baseline SHA256: ', hash('data/processed/FAC-GUJ-VADINAR-02_baseline.json'));
