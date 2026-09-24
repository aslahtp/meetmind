const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');
const logger = require('../utils/logger');

const MAX_TITLE_LENGTH = 80;

// Windows-safe file name part: drops reserved and control characters, turns whitespace
// into hyphens and collapses repeats, e.g. "Q4: roadmap / sync?" → "Q4-roadmap-sync".
function sanitizeFileNamePart(text) {
  const cleaned = String(text || '')
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, MAX_TITLE_LENGTH)
    .replace(/[-.]+$/g, '');
  return cleaned || 'Meeting';
}

const pad = (n) => String(n).padStart(2, '0');

// "date-time-title.pdf" in local time: 2026-09-25-1430-Q4-roadmap-sync.pdf
function buildPdfFileName(startedAt, title) {
  const d = startedAt ? new Date(startedAt) : new Date();
  const date = Number.isNaN(d.getTime()) ? new Date() : d;
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  return `${stamp}-${sanitizeFileNamePart(title)}.pdf`;
}

// Never overwrite an earlier export: "name.pdf" → "name (2).pdf", "name (3).pdf", …
function uniquePath(dir, fileName) {
  const ext = path.extname(fileName);
  const base = fileName.slice(0, -ext.length);
  let candidate = path.join(dir, fileName);
  for (let n = 2; fs.existsSync(candidate); n++) {
    candidate = path.join(dir, `${base} (${n})${ext}`);
  }
  return candidate;
}

function resolveExportDir(configuredDir) {
  return configuredDir && configuredDir.trim() ? configuredDir.trim() : app.getPath('downloads');
}

const FOOTER_TEMPLATE = `
  <div style="width:100%; font-size:8px; color:#707070; font-family:'Segoe UI', sans-serif; padding:0 14mm; display:flex; justify-content:space-between;">
    <span class="title"></span>
    <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
  </div>`;

/**
 * Prints a self-contained HTML document (built by the renderer) to a PDF file.
 * Rendering happens in a hidden, sandboxed window with JavaScript disabled.
 * Returns { success: true, path } or { success: false, error }.
 */
async function exportPdf({ html, fileName, dir }) {
  const targetDir = resolveExportDir(dir);
  let win = null;
  const tmpFile = path.join(os.tmpdir(), `meetmind-pdf-${process.pid}-${Date.now()}.html`);

  try {
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(tmpFile, html, 'utf8');

    win = new BrowserWindow({
      show: false,
      width: 900,
      height: 1200,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        javascript: false,
        spellcheck: false,
      },
    });
    // The document is static; never follow links or open windows from it.
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    await win.loadFile(tmpFile);

    const pdf = await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { top: 0.6, bottom: 0.7, left: 0.55, right: 0.55 },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: FOOTER_TEMPLATE,
    });

    const outPath = uniquePath(targetDir, fileName);
    fs.writeFileSync(outPath, pdf);
    logger.info('Exported meeting PDF', { path: outPath, bytes: pdf.length });
    return { success: true, path: outPath };
  } catch (err) {
    logger.error('PDF export failed', { dir: targetDir, error: err.message });
    const folderProblem = ['EACCES', 'EPERM', 'ENOENT', 'EROFS', 'ENOTDIR', 'EINVAL'].includes(err.code);
    const reason = folderProblem
      ? `MeetMind can't save to ${targetDir}. Choose another folder in Settings → Notes → PDF export.`
      : err.message;
    return { success: false, error: reason };
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
    fs.rm(tmpFile, { force: true }, () => {});
  }
}

module.exports = { exportPdf, buildPdfFileName, sanitizeFileNamePart, resolveExportDir };
