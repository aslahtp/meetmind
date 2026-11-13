/**
 * Checks the output of a packaged app's `--smoke` self-test (electron/smoke.ts): finds the
 * `MEETMIND_SMOKE {json}` line, prints each check, adds a table to the GitHub Actions job summary
 * when $GITHUB_STEP_SUMMARY is set, and exits 1 unless every check passed.
 *
 * Run: tsx scripts/check-smoke.ts <file with the app's stdout> [label]
 */

'use strict';

import fs from 'fs';

const MARKER = 'MEETMIND_SMOKE ';

function parseReport(text: any) {
  const line = text.split(/\r?\n/).find((l: any) => l.startsWith(MARKER));
  if (!line) return null;
  return JSON.parse(line.slice(MARKER.length));
}

function detailOf(check: any) {
  if (!check.ok) return check.error || 'failed';
  if (check.detail == null) return '';
  return JSON.stringify(check.detail).replace(/\|/g, '\\|');
}

function summaryMarkdown(report: any, label: any) {
  const rows = report.checks.map((c: any) => `| ${c.ok ? '✅' : '❌'} | ${c.name} | ${detailOf(c)} |`);
  return [
    `### Smoke test${label ? `: ${label}` : ''} — ${report.ok ? 'passed' : 'FAILED'}`,
    '',
    `MeetMind ${report.version} · ${report.platform} ${report.arch}${report.packaged ? ' · packaged' : ''}`,
    '',
    '| | Check | Detail |',
    '| --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}

function main() {
  const [file, label] = process.argv.slice(2);
  if (!file) throw new Error('usage: tsx scripts/check-smoke.ts <output file> [label]');
  const report = parseReport(fs.readFileSync(file, 'utf8'));
  if (!report) {
    console.error(`::error::No ${MARKER.trim()} line in ${file}: the app crashed or never ran its self-test.`);
    process.exit(1);
  }

  for (const c of report.checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name} ${detailOf(c)}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryMarkdown(report, label));
  }

  if (!report.ok) {
    const failed = report.checks.filter((c: any) => !c.ok).map((c: any) => c.name).join(', ');
    console.error(`::error::Smoke test failed: ${failed}`);
    process.exit(1);
  }
}

if (require.main === module) main();

export { parseReport, summaryMarkdown };
