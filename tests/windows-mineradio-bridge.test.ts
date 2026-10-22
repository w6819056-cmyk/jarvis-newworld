import assert from 'node:assert/strict';
import test from 'node:test';
import { MineradioBridge, mineradioActionForTool, mineradioToolSpecs } from '../electron/mineradio-bridge.ts';

test('uses a unique local named pipe and emits a one-time Mineradio launch token', async () => {
  const first = new MineradioBridge();
  const second = new MineradioBridge();
  assert.match(first.endpoint, /^\\\\\.\\pipe\\mineradio-jarvis-[a-f0-9]{32}$/);
  assert.notEqual(first.endpoint, second.endpoint);
  assert.equal(first.token.length, 64);
  assert.deepEqual(first.launchArgs, ['--jarvis-pipe', first.endpoint, '--jarvis-token', first.token]);
  await first.close(); await second.close();
});

test('registers structured music actions as strict Codex tools', () => {
  const search = mineradioToolSpecs.find(tool => tool.name === 'jarvis_mineradio_search_play');
  assert.ok(search);
  assert.deepEqual(search.inputSchema.required, ['query']);
  assert.equal(search.inputSchema.additionalProperties, false);
});

test('maps generated Mineradio tool names to the same allowlisted actions', () => {
  assert.equal(mineradioActionForTool('jarvis_mineradio_visual_set_preset'), 'visual.set_preset');
  assert.equal(mineradioActionForTool('jarvis_mineradio_player_get_state'), 'player.get_state');
});
