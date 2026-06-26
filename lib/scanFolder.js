const fs = require('fs');
const path = require('path');
const { isMediaPath } = require('./mediaTypes');

/**
 * @param {string} root
 * @param {number} [maxDepth]
 * @returns {string[]}
 */
function collectMediaFiles(root, maxDepth = 8) {
  const files = [];
  function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.name.startsWith('.') || ent.name === 'node_modules') continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full, depth + 1);
      else if (ent.isFile() && isMediaPath(full)) files.push(full);
    }
  }
  walk(root, 0);
  return files;
}

/**
 * @param {string} rootPath
 * @param {object} opts
 * @param {(filePath: string) => Promise<{ skipped?: boolean, item?: object }>} opts.importFile
 * @param {(payload: object) => void} opts.onBatchComplete
 */
async function scanFolder(rootPath, opts) {
  const { importFile, onBatchComplete } = opts;
  const files = collectMediaFiles(rootPath);
  const batch = { added: 0, skipped: 0, failed: 0, items: [] };

  for (const filePath of files) {
    try {
      const result = await importFile(filePath);
      if (result.skipped) batch.skipped += 1;
      else if (result.item) {
        batch.added += 1;
        batch.items.push(result.item);
      }
    } catch (err) {
      console.error('Scan import failed:', filePath, err.message);
      batch.failed += 1;
    }
  }

  if (batch.added || batch.skipped || batch.failed) {
    onBatchComplete({
      type: 'watch-import',
      source: 'scan',
      added: batch.added,
      skipped: batch.skipped,
      failed: batch.failed,
      items: batch.items,
    });
  }
  return batch;
}

module.exports = { collectMediaFiles, scanFolder };
