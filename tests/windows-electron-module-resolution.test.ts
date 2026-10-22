import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertLocalRequiresResolvable, rewriteElectronRequires } from '../scripts/electron-module-resolution.mjs';

test('rewrites the shared Codex voice source to a packaged Electron module', () => {
  const source = 'const voice = require("../src/codex-voice");';
  assert.equal(
    rewriteElectronRequires(source, { '../src/codex-voice': './codex-voice' }),
    "const voice = require('./codex-voice.cjs');",
  );
});

test('fails the package build when a local main-process module is missing', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'jarvis-electron-modules-'));
  try {
    const entry = path.join(root, 'main.cjs');
    assert.throws(
      () => assertLocalRequiresResolvable("require('./missing.cjs')", entry),
      /Unresolved Electron modules/,
    );
    writeFileSync(path.join(root, 'present.cjs'), '');
    assertLocalRequiresResolvable("require('./present.cjs')", entry);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
