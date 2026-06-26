/** @typedef {{ prompt: string, mjId: string|null, variantIndex: number|null, source: string, ext: string }} ParsedFilename */

/**
 * Parse AI media filenames (Midjourney, Seedance, etc.).
 * @param {string} name
 * @returns {ParsedFilename}
 */
function parseFilename(name) {
  const base = name.replace(/\.[^.]+$/, '');
  const ext = (name.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();
  const mj = base.match(/^(.+)_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:_(\d+))?$/i);
  if (mj) {
    const head = mj[1];
    const firstUnderscore = head.indexOf('_');
    const prompt = (firstUnderscore > -1 ? head.slice(firstUnderscore + 1) : head).replace(/_/g, ' ').trim();
    return { prompt, mjId: mj[2].toLowerCase(), variantIndex: mj[3] != null ? Number(mj[3]) : null, source: 'midjourney', ext };
  }
  let source = 'other';
  if (/seedance/i.test(base)) source = 'seedance';
  else if (/nano.?banana/i.test(base)) source = 'nanobanana';
  else if (/^(dalle|gpt|chatgpt|openai)/i.test(base)) source = 'gpt';
  return { prompt: '', mjId: null, variantIndex: null, source, ext };
}

module.exports = { parseFilename };
