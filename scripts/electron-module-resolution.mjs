import { existsSync } from 'node:fs';
import path from 'node:path';

export function rewriteElectronRequires(source, mappings = {}) {
  let rewritten = source;
  for (const [from, to] of Object.entries(mappings)) {
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    rewritten = rewritten.replace(new RegExp(`require\\(([\"'])${escaped}\\1\\)`, 'g'), `require('${to}')`);
  }
  return rewritten.replace(/require\((["'])(\.\/[^"']+)\1\)/g, (_match, _quote, specifier) =>
    `require('${specifier.endsWith('.cjs') ? specifier : `${specifier}.cjs`}')`);
}

export function assertLocalRequiresResolvable(source, entryPath) {
  const entryDirectory = path.dirname(entryPath);
  const references = [...source.matchAll(/require\((["'])(\.\/[^"']+)\1\)/g)].map(match => match[2]);
  const missing = references.filter(reference => !existsSync(path.resolve(entryDirectory, reference)));
  if (missing.length) throw new Error(`Unresolved Electron modules in ${path.basename(entryPath)}: ${missing.join(', ')}`);
}
