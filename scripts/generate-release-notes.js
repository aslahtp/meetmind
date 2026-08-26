/**
 * Generates release_notes.md from CHANGELOG.md and .github/release_template.md
 * Extracts all changelog sections between the new release version and the previous release tag on GitHub.
 * Run: node scripts/generate-release-notes.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const pkgPath = path.join(ROOT, 'package.json');
const changelogPath = path.join(ROOT, 'CHANGELOG.md');
const templatePath = path.join(ROOT, '.github', 'release_template.md');
const outputPath = path.join(ROOT, 'release_notes.md');

function getPackageVersion() {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  return pkg.version;
}

function getPreviousTag(currentTag) {
  try {
    const stdout = execSync('git tag --sort=-v:refname', { encoding: 'utf8', cwd: ROOT, stdio: ['pipe', 'pipe', 'ignore'] });
    const tags = stdout
      .split(/\r?\n/)
      .map((t) => t.trim())
      .filter(Boolean);

    for (const tag of tags) {
      if (tag !== currentTag && tag !== `v${currentTag}`) {
        return tag;
      }
    }
  } catch (err) {
    console.warn('Note: Could not determine previous git tag from local repo:', err.message);
  }
  return null;
}

function parseChangelogSections(content) {
  const headerRe = /^##\s+(?:\[)?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)\]?(?:\s+[-–—]\s+.*)?\s*$/gm;
  const matches = [];
  let match;

  while ((match = headerRe.exec(content)) !== null) {
    matches.push({
      version: match[1],
      index: match.index,
      headerLength: match[0].length,
    });
  }

  const sections = [];
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const next = matches[i + 1];
    const rawBody = content
      .substring(cur.index + cur.headerLength, next ? next.index : content.length)
      .trim();

    sections.push({
      version: cur.version,
      rawHeader: `## v${cur.version}`,
      body: rawBody,
    });
  }

  return sections;
}

function collectSectionsUntilPrevious(sections, prevTag) {
  const prevVer = prevTag ? String(prevTag).replace(/^v/, '') : null;
  const targetSections = [];

  for (const s of sections) {
    if (prevVer && s.version === prevVer) break;
    targetSections.push(s);
  }

  return targetSections;
}

function renderChangelogBody(targetSections, currentVer) {
  if (!targetSections.length) {
    return `- Release updates for v${currentVer}`;
  }
  if (targetSections.length === 1) {
    return targetSections[0].body || `- Release updates for v${currentVer}`;
  }
  return targetSections
    .map((s) => `### v${s.version}\n\n${s.body}`)
    .join('\n\n')
    .trim();
}

function extractChangelogBody(currentVer, prevTag) {
  if (!fs.existsSync(changelogPath)) {
    throw new Error(`CHANGELOG.md not found at ${changelogPath}`);
  }

  const content = fs.readFileSync(changelogPath, 'utf8');
  const sections = parseChangelogSections(content);

  if (sections.length === 0) {
    throw new Error(
      'CHANGELOG.md has no version headings. Expected Keep a Changelog format: "## [X.Y.Z] - YYYY-MM-DD".'
    );
  }

  const current = sections.find((s) => s.version === currentVer);
  if (!current) {
    throw new Error(
      `CHANGELOG.md has no section for v${currentVer}. Add a heading like "## [${currentVer}] - YYYY-MM-DD".`
    );
  }

  const targetSections = collectSectionsUntilPrevious(sections, prevTag);
  if (targetSections.length === 0) {
    return current.body || `- Release updates for v${currentVer}`;
  }

  return renderChangelogBody(targetSections, currentVer);
}

function generateReleaseNotes() {
  const version = getPackageVersion();
  const currentTag = `v${version}`;
  const prevTag = process.env.PREV_TAG || getPreviousTag(currentTag);

  console.log(`Generating release notes for ${currentTag} (previous release tag: ${prevTag || 'none'})...`);

  const changelogBody = extractChangelogBody(version, prevTag);
  if (!changelogBody.trim() || changelogBody.trim() === `- Release updates for v${version}`) {
    throw new Error(`Changelog body for v${version} was empty or fell back to a placeholder.`);
  }

  let template = '## Changelog\n\n{CHANGELOG_BODY}\n\n## Downloads\n\n- `MeetMind Setup x.y.z.exe`';
  if (fs.existsSync(templatePath)) {
    template = fs.readFileSync(templatePath, 'utf8');
  }

  template = template.replace(/^\uFEFF/, '');
  const output = template
    .replace(/{VERSION}/g, version)
    .replace(/x\.y\.z/g, version)
    .replace(/{CHANGELOG_BODY}/g, changelogBody);

  fs.writeFileSync(outputPath, output, 'utf8');
  console.log(`✓ release_notes.md generated successfully (${output.length} bytes).`);
}

function assert(condition, message) {
  if (!condition) throw new Error(`self-test failed: ${message}`);
}

function selfTest() {
  const sample = `---
tags: [meta, changelog]
---
# Changelog

Intro text that must not become a section.

## [2.9.0] - 2026-08-26

### Added

- New toggle.

## [2.8.0] - 2026-08-25

### Added

- Dashboard limit.

## v2.0.8

- Legacy header.

## 1.5.0

- Unprefixed header.
`;

  const sections = parseChangelogSections(sample);
  assert(sections.length === 4, `expected 4 sections, got ${sections.length}`);
  assert(sections[0].version === '2.9.0', `first version ${sections[0].version}`);
  assert(sections[0].body.includes('### Added'), 'Keep a Changelog category heading should be kept');
  assert(sections[0].body.includes('New toggle.'), '2.9.0 body missing');
  assert(!sections[0].body.includes('Dashboard limit.'), '2.9.0 body leaked into next section');
  assert(sections[1].version === '2.8.0', `second version ${sections[1].version}`);
  assert(sections[2].version === '2.0.8', `legacy v-prefix not parsed: ${sections[2].version}`);
  assert(sections[3].version === '1.5.0', `unprefixed header not parsed: ${sections[3].version}`);

  const untilPrev = collectSectionsUntilPrevious(sections, 'v2.8.0');
  assert(untilPrev.length === 1 && untilPrev[0].version === '2.9.0', 'should stop at previous tag');

  const multi = collectSectionsUntilPrevious(sections, 'v2.0.8');
  assert(multi.map((s) => s.version).join(',') === '2.9.0,2.8.0', 'should include all versions after previous tag');

  const rendered = renderChangelogBody(untilPrev, '2.9.0');
  assert(rendered.includes('New toggle.'), 'rendered body missing current notes');
  assert(!rendered.includes('Dashboard limit.'), 'rendered body included previous release');

  console.log('✓ generate-release-notes self-test passed');
}

if (require.main === module) {
  selfTest();
  generateReleaseNotes();
}

module.exports = {
  generateReleaseNotes,
  extractChangelogBody,
  parseChangelogSections,
  collectSectionsUntilPrevious,
  selfTest,
};
