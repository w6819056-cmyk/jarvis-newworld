import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceArmorAssemblySpin, createArmorAssemblySequence, createArmorInspectionEntrySequence, getInspectionEntryStart, ArmorAssemblyTimeline } from '../src/helmet/assembly-sequence.ts';

const groups = [
  { name: 'head' as const, partCount: 2 },
  { name: 'chest' as const, partCount: 2 },
  { name: 'abdomen' as const, partCount: 1 },
  { name: 'left-arm' as const, partCount: 2 },
  { name: 'right-arm' as const, partCount: 1 },
  { name: 'left-leg' as const, partCount: 1 },
  { name: 'right-leg' as const, partCount: 1 },
];

test('mode one completes all small pieces before assembling large groups chest-first', () => {
  const steps = createArmorAssemblySequence(1, groups);
  const small = steps.filter(step => step.kind === 'part');
  const large = steps.filter(step => step.kind === 'group');
  assert.equal(small.length, 10);
  assert.equal(large.length, 7);
  assert.equal(steps.slice(0, 10).every(step => step.kind === 'part' && step.sound === 'small'), true);
  assert.equal(steps.slice(10).every(step => step.kind === 'group' && step.sound === 'large'), true);
  assert.equal(large[0]?.groupName, 'chest');
  assert.ok(steps[10]!.startMs >= steps[9]!.startMs + steps[9]!.durationMs);
});

test('modes two and three assemble only large groups in the same stable order', () => {
  for (const mode of [2, 3] as const) {
    const steps = createArmorAssemblySequence(mode, groups);
    assert.equal(steps.length, 7);
    assert.deepEqual(steps.map(step => step.groupName), ['chest', 'head', 'abdomen', 'left-arm', 'right-arm', 'left-leg', 'right-leg']);
    assert.ok(steps.every(step => step.kind === 'group' && step.sound === 'large'));
  }
});

test('timeline eases steps in and emits each completion only once', () => {
  const [step] = createArmorAssemblySequence(2, groups);
  const timeline = new ArmorAssemblyTimeline([step!], 1000);
  assert.equal(timeline.sample(999).states[0]?.progress, 0);
  assert.equal(timeline.sample(1000).states[0]?.progress, 0);
  assert.equal(timeline.sample(1000 + step!.durationMs / 2).states[0]?.progress, 0.5);
  assert.deepEqual(timeline.sample(1000 + step!.durationMs).completed, [step]);
  assert.deepEqual(timeline.sample(1000 + step!.durationMs + 10).completed, []);
  assert.equal(timeline.sample(1000 + step!.durationMs + 10).finished, true);
});

test('assembly rotation builds slowly and eases out without snapping when interrupted', () => {
  let spin = { angle: 0, velocity: 0 };
  for (let frame = 0; frame < 60; frame++) spin = advanceArmorAssemblySpin(spin, 1 / 60, true);
  assert.ok(spin.velocity > 0.2 && spin.velocity < 0.32);
  assert.ok(spin.angle > 0.1 && spin.angle < 0.32);

  const angleAtCancel = spin.angle;
  spin = advanceArmorAssemblySpin(spin, 1 / 60, false);
  assert.ok(spin.angle > angleAtCancel, 'rotation should continue while slowing down');
  assert.ok(spin.velocity > 0, 'interruption should not zero angular velocity');
  for (let frame = 0; frame < 180; frame++) spin = advanceArmorAssemblySpin(spin, 1 / 60, false);
  assert.ok(spin.velocity < 0.003, 'rotation should settle after the sequence is interrupted');
});

test('inspection entry flies seven large groups in a stable body-first order', () => {
  const steps = createArmorInspectionEntrySequence(groups);
  assert.deepEqual(steps.map(step => step.groupName), ['chest', 'head', 'abdomen', 'left-arm', 'right-arm', 'left-leg', 'right-leg']);
  assert.equal(steps[0]?.startMs, 0);
  assert.ok(steps.every(step => step.durationMs >= 360));
  assert.ok(steps.every((step, index) => index === 0 || step.startMs > steps[index - 1]!.startMs));
  assert.ok(steps.at(-1)!.startMs + steps.at(-1)!.durationMs < 6500);
});

test('inspection entry uses viewer-facing screen directions and a centered chest reveal', () => {
  const target = { x: 0, y: 0, z: 0 };
  const viewport = { halfWidth: 10, halfHeight: 5, margin: 0.8, inspectionShift: -1.8 };
  const bounds = { halfWidth: 1.2, halfHeight: 1.2 };
  const leftArm = getInspectionEntryStart('left-arm', target, viewport, bounds);
  const leftLeg = getInspectionEntryStart('left-leg', target, viewport, bounds);
  const rightArm = getInspectionEntryStart('right-arm', target, viewport, bounds);
  const rightLeg = getInspectionEntryStart('right-leg', target, viewport, bounds);
  const head = getInspectionEntryStart('head', target, viewport, bounds);
  const abdomen = getInspectionEntryStart('abdomen', target, viewport, bounds);
  const chest = getInspectionEntryStart('chest', target, viewport, bounds);
  assert.ok(leftArm.x + viewport.inspectionShift < -viewport.halfWidth - bounds.halfWidth);
  assert.ok(leftLeg.x + viewport.inspectionShift < -viewport.halfWidth - bounds.halfWidth);
  assert.ok(rightArm.x + viewport.inspectionShift > viewport.halfWidth + bounds.halfWidth);
  assert.ok(rightLeg.x + viewport.inspectionShift > viewport.halfWidth + bounds.halfWidth);
  assert.ok(head.y > viewport.halfHeight + bounds.halfHeight);
  assert.ok(abdomen.y < -viewport.halfHeight - bounds.halfHeight);
  assert.deepEqual(chest, { x: 0, y: -0.7, z: -1.6 });
});
