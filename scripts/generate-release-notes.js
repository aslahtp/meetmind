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
  // Matches headers like "## v2.0.7" or "## 2.0.7"
  const sectionRegex = /^##\s+v?(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)\s*$/gm;
  const sections = [];
  let match;
  const matches = [];

  while ((match = sectionRegex.exec(content)) !== null) {
    matches.push({
      version: match[1],
      index: match.index,
      headerLength: match[0].length,
    });
  }

  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const next = matches[i + 1];
    const rawBody = content.substring(
      cur.index + cur.headerLength,
      next ? next.index : content.length
    ).trim();

    sections.push({
      version: cur.version,
      rawHeader: `## v${cur.version}`,
      body: rawBody,
    });
  }

  return sections;
}

function extractChangelogBody(currentVer, prevTag) {
  if (!fs.existsSync(changelogPath)) {
    return `- Release updates for v${currentVer}`;
  }

  const content = fs.readFileSync(changelogPath, 'utf8');
  const sections = parseChangelogSections(content);

  if (sections.length === 0) {
    return `- Release updates for v${currentVer}`;
  }

  const prevVer = prevTag ? prevTag.replace(/^v/, '') : null;
  const targetSections = [];

  for (const s of sections) {
    // If we've reached the previous release, stop
    if (prevVer && s.version === prevVer) {
      break;
    }
    targetSections.push(s);
  }

  // If no sections matched or targetSections is empty, fallback to the first section
  if (targetSections.length === 0) {
    const matching = sections.find((s) => s.version === currentVer) || sections[0];
    return matching.body || `- Release updates for v${currentVer}`;
  }

  // If only 1 version section is in scope:
  if (targetSections.length === 1) {
    return targetSections[0].body || `- Release updates for v${currentVer}`;
  }

  // If multiple versions accumulated between releases:
  // Render each with a sub-heading:
  // ### v2.0.7
  // - points...
  return targetSections
    .map((s) => `### v${s.version}\n\n${s.body}`)
    .join('\n\n')
    .trim();
}

function generateReleaseNotes() {
  const version = getPackageVersion();
  const currentTag = `v${version}`;
  const prevTag = process.env.PREV_TAG || getPreviousTag(currentTag);

  console.log(`Generating release notes for ${currentTag} (previous release tag: ${prevTag || 'none'})...`);

  const changelogBody = extractChangelogBody(version, prevTag);

  let template = '## Changelog\n\n{CHANGELOG_BODY}\n\n## Downloads\n\n- `MeetMind Setup x.y.z.exe`';
  if (fs.existsSync(templatePath)) {
    template = fs.readFileSync(templatePath, 'utf8');
  }

  template = template.replace(/^\uFEFF/, ''); // strip BOM if any
  const output = template
    .replace(/{VERSION}/g, version)
    .replace(/x\.y\.z/g, version)
    .replace(/{CHANGELOG_BODY}/g, changelogBody);

  fs.writeFileSync(outputPath, output, 'utf8');
  console.log(`✓ release_notes.md generated successfully (${output.length} bytes).`);
}

if (require.main === module) {
  generateReleaseNotes();
}

module.exports = { generateReleaseNotes, extractChangelogBody };
