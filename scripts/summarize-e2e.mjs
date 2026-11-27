import { readFile, writeFile } from 'node:fs/promises';

const report = JSON.parse(await readFile('reports/e2e/results.json', 'utf8'));
const counts = { passed: 0, failed: 0, skipped: 0 };
function visit(suites = []) {
  for (const suite of suites) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const status = test.results?.at(-1)?.status ?? 'skipped';
        counts[status === 'passed' ? 'passed' : status === 'skipped' ? 'skipped' : 'failed']++;
      }
    }
    visit(suite.suites);
  }
}
visit(report.suites);
const summary = { ...counts, total: counts.passed + counts.failed + counts.skipped };
await writeFile('reports/e2e/summary.json', JSON.stringify(summary, null, 2) + '\n');
console.log(`E2E: passed=${counts.passed} failed=${counts.failed} skipped=${counts.skipped}`);
if (counts.failed) process.exitCode = 1;
