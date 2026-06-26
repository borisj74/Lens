const path = require('path');
const os = require('os');
const fs = require('fs');
const chokidar = require('chokidar');
const { isMediaPath } = require('./mediaTypes');

/**
 * @param {object} opts
 * @param {() => { watchedFolders: Array<{id:string,path:string}>, watchSettings: { autoImport?: boolean } }} opts.getConfig
 * @param {(filePath: string) => Promise<{ skipped?: boolean, item?: object, reason?: string }>} opts.importFile
 * @param {(payload: object) => void} opts.onBatchComplete
 */
function createFolderWatcher(opts) {
  const { getConfig, importFile, onBatchComplete } = opts;
  /** @type {import('chokidar').FSWatcher|null} */
  let watcher = null;
  /** @type {Map<string, NodeJS.Timeout>} */
  const timers = new Map();
  /** @type {Map<string, { added: number, skipped: number, failed: number, items: object[] }>} */
  const batches = new Map();

  function expandUserPath(p) {
    const trimmed = String(p || '').trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('~/')) return path.join(os.homedir(), trimmed.slice(2));
    return path.resolve(trimmed);
  }

  function flushBatch(key) {
    const batch = batches.get(key);
    timers.delete(key);
    batches.delete(key);
    if (!batch || (!batch.added && !batch.skipped && !batch.failed)) return;
    onBatchComplete({
      type: 'watch-import',
      added: batch.added,
      skipped: batch.skipped,
      failed: batch.failed,
      items: batch.items,
    });
  }

  function scheduleBatch(key) {
    if (timers.has(key)) clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => flushBatch(key), 1200));
  }

  async function handleFile(filePath) {
    const { watchSettings } = getConfig();
    if (watchSettings && watchSettings.autoImport === false) return;
    if (!isMediaPath(filePath)) return;

    const batchKey = 'default';
    if (!batches.has(batchKey)) {
      batches.set(batchKey, { added: 0, skipped: 0, failed: 0, items: [] });
    }
    const batch = batches.get(batchKey);

    try {
      const result = await importFile(filePath);
      if (result.skipped) batch.skipped += 1;
      else if (result.item) {
        batch.added += 1;
        batch.items.push(result.item);
      }
    } catch (err) {
      console.error('Watched import failed:', filePath, err.message);
      batch.failed += 1;
    }
    scheduleBatch(batchKey);
  }

  function stop() {
    if (watcher) {
      watcher.close();
      watcher = null;
    }
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    batches.clear();
  }

  function restart() {
    stop();
    const { watchedFolders, watchSettings } = getConfig();
    if (!watchedFolders || !watchedFolders.length) return;
    if (watchSettings && watchSettings.autoImport === false) return;

    const roots = watchedFolders
      .map((f) => expandUserPath(f.path))
      .filter((p) => p && fs.existsSync(p));

    if (!roots.length) {
      console.warn('Folder watch: no valid watched paths');
      return;
    }

    watcher = chokidar.watch(roots, {
      ignored: (p) => {
        const base = path.basename(p);
        return base.startsWith('.') || base === 'node_modules';
      },
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 900, pollInterval: 120 },
      depth: 8,
    });

    watcher.on('add', (p) => { void handleFile(p); });
    watcher.on('change', (p) => { void handleFile(p); });
    watcher.on('error', (err) => console.error('Folder watch error:', err.message));

    console.log(`Watching ${roots.length} folder(s) for new media`);
  }

  return { restart, stop, expandUserPath };
}

module.exports = { createFolderWatcher };
