import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createArmorGroups, createArmorParts, findDirectionalArmorGroup } from '../src/helmet/helmet-geometry.ts';

function makeModel(): THREE.Group {
  const model = new THREE.Group();
  const parts: Array<[number, number]> = [
    [0, 90], [0, 70], [-28, 70], [28, 70], [0, 55], [-28, 55], [28, 55], [0, 45], [-28, 40], [28, 40], [0, 35], [-28, 32], [28, 32], [-10, 22], [10, 22], [-10, 12], [10, 12], [-10, 3], [10, 3],
  ];
  for (const [index, [x, y]] of parts.entries()) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([x - 1, y, 0, x + 1, y, 0, x, y + 2, 0], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute([1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1], 4));
    geometry.setAttribute('tangent', new THREE.Float32BufferAttribute([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1], 4));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xff0000 }));
    mesh.name = `part-${index}`;
    model.add(mesh);
  }
  return model;
}

test('separates the full suit into named body parts without dropping source triangles', () => {
  const parts = createArmorParts(makeModel(), 42);
  const names = new Set(parts.map(part => part.name));
  assert.ok(names.has('helmet'));
  assert.ok(names.has('chest'));
  assert.ok(names.has('left-upper-arm'));
  assert.ok(names.has('right-upper-arm'));
  assert.ok(names.has('left-thigh'));
  assert.ok(names.has('right-foot'));
  assert.equal(parts.reduce((sum, part) => sum + part.mesh.geometry.attributes.position.count, 0), 19 * 3);
  assert.ok(names.has('left-shoulder'));
  assert.ok(names.has('right-shoulder'));
  assert.ok(parts.every(part => part.mesh.geometry.attributes.uv));
  assert.ok(parts.every(part => part.mesh.geometry.attributes.color?.itemSize === 4));
  assert.ok(parts.every(part => part.mesh.geometry.attributes.tangent?.itemSize === 4));
  assert.ok(parts.every(part => [...part.mesh.geometry.attributes.position.array].every(Number.isFinite)));
});

test('names lateral parts from the viewer perspective', () => {
  const parts = createArmorParts(makeModel(), 42);
  const leftSource = parts.find(part => part.mesh.name === 'part-5');
  const rightSource = parts.find(part => part.mesh.name === 'part-6');
  assert.equal(leftSource?.name, 'right-upper-arm');
  assert.equal(rightSource?.name, 'left-upper-arm');
});

test('scatters every mode-one fragment onto a uniform sphere around the armor center', () => {
  const parts = createArmorParts(makeModel(), 42);
  const radii = parts.map(part => part.scatteredPosition.length());
  assert.ok(radii.every(radius => Math.abs(radius - 2.5) < 1e-8));
  assert.ok(new Set(parts.map(part => part.scatteredPosition.toArray().join(','))).size > parts.length * 0.9);
});

test('matches viewer-right limb geometry from the mirrored viewer-left source', () => {
  const parts = createArmorParts(makeModel(), 42);
  const viewerRight = parts.find(part => part.name === 'right-upper-arm')!;
  const viewerLeft = parts.find(part => part.name === 'left-upper-arm')!;
  assert.ok(Math.abs(viewerRight.assembledQuaternion.z) < 0.01);
  assert.ok(viewerRight.mesh.geometry.attributes.position.count === viewerLeft.mesh.geometry.attributes.position.count);
});

test('uses the trusted paired node center when a right-side source transform is offset', () => {
  const model = new THREE.Group();
  const makePart = (name: string, x: number, y: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.2, 0.12), new THREE.MeshStandardMaterial());
    mesh.name = name;
    mesh.position.set(x, y, 0);
    model.add(mesh);
  };
  makePart('Object005', -0.4, 0.42);
  makePart('Object031', 0.4, 0.86);
  makePart('center', 0, 0.9);

  const parts = createArmorParts(model, 42);
  const trusted = parts.find(part => part.mesh.name === 'Object005')!;
  const mirrored = parts.find(part => part.mesh.name === 'Object031')!;

  assert.equal(mirrored.name.replace(/^left-/, 'right-'), trusted.name);
  assert.ok(Math.abs(mirrored.assembledPosition.x + trusted.assembledPosition.x) < 1e-6);
  assert.ok(Math.abs(mirrored.assembledPosition.y - trusted.assembledPosition.y) < 1e-6);
  assert.ok(Math.abs(mirrored.assembledPosition.z - trusted.assembledPosition.z) < 1e-6);
});

test('preserves the source hierarchy when assigning small armor fragments to body groups', () => {
  const model = new THREE.Group();
  const chest = new THREE.Group();
  chest.name = '胸部';
  model.add(chest);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshStandardMaterial());
  mesh.name = 'chest-detail';
  mesh.position.set(0, 0.95, 0);
  chest.add(mesh);

  const parts = createArmorParts(model, 42);
  assert.equal(parts[0]?.groupName, 'chest');
});

test('assembled body parts retain exact transforms and deterministic scatter targets', () => {
  const first = createArmorParts(makeModel(), 7);
  const second = createArmorParts(makeModel(), 7);
  assert.equal(first.length, second.length);
  for (let i = 0; i < first.length; i++) {
    const a = first[i]!;
    const b = second[i]!;
    assert.deepEqual(a.mesh.position.toArray(), a.assembledPosition.toArray());
    assert.deepEqual(a.mesh.quaternion.toArray(), a.assembledQuaternion.toArray());
    assert.deepEqual(a.scatteredPosition.toArray(), b.scatteredPosition.toArray());
    assert.ok(a.scatteredPosition.distanceTo(a.assembledPosition) > 0.4);
    assert.equal((a.mesh.material as THREE.MeshStandardMaterial).color.getHex(), 0xff0000);
  }
});

test('keeps separate source meshes independently movable inside the same body region', () => {
  const model = new THREE.Group();
  for (const [name, offset] of [['front-panel', -0.15], ['rear-panel', 0.15]] as const) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      -0.03, 0.8, offset,
      0.03, 0.8, offset,
      0, 0.86, offset,
    ], 3));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x999999 }));
    mesh.name = name;
    model.add(mesh);
  }

  const parts = createArmorParts(model, 12);

  assert.equal(parts.length, 2);
  assert.deepEqual(parts.map(part => part.mesh.geometry.attributes.position.count), [3, 3]);
  assert.ok(parts.every(part => part.scatteredPosition.distanceTo(part.assembledPosition) > 0.4));
});

test('preserves world-space placement of compressed meshes with parent transforms', () => {
  const model = new THREE.Group();
  const parent = new THREE.Group();
  parent.position.set(0.2, 1.1, -0.1);
  parent.scale.setScalar(0.1);
  model.add(parent);
  const geometry = new THREE.BoxGeometry(2, 3, 1);
  const source = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x999999 }));
  source.position.set(0.4, 0.2, 0.3);
  source.name = 'scaled-part';
  parent.add(source);
  const extra = new THREE.Mesh(new THREE.BoxGeometry(1, 10, 1), new THREE.MeshStandardMaterial());
  extra.position.set(-1, 0, 0);
  model.add(extra);
  model.updateMatrixWorld(true);
  const modelBounds = new THREE.Box3().setFromObject(model);
  const modelCenter = modelBounds.getCenter(new THREE.Vector3());
  const scale = 3.8 / modelBounds.getSize(new THREE.Vector3()).y;

  const part = createArmorParts(model, 4).find(entry => entry.mesh.name === 'scaled-part')!;
  const sourcePosition = new THREE.Vector3().fromBufferAttribute(source.geometry.attributes.position, 0).applyMatrix4(source.matrixWorld);
  const expected = sourcePosition.sub(modelCenter).multiplyScalar(scale);
  if (part.assembledQuaternion.z) {
    expected.sub(part.assembledPosition).applyQuaternion(part.assembledQuaternion).add(part.assembledPosition);
  }
  part.mesh.updateMatrixWorld(true);
  const actual = new THREE.Vector3().fromBufferAttribute(part.mesh.geometry.attributes.position, 0).applyMatrix4(part.mesh.matrixWorld);

  assert.ok(actual.distanceTo(expected) < 1e-5);
  assert.ok(Math.abs(part.mesh.scale.x - 1) < 1e-5);
});

test('organizes every source mesh under seven named armor groups without changing assembled placement', () => {
  const parts = createArmorParts(makeModel(), 42);
  const originalWorldPositions = new Map(parts.map(part => [part.mesh, part.mesh.position.clone()]));
  const groups = createArmorGroups(parts);
  assert.deepEqual(groups.map(group => group.name), ['head', 'chest', 'abdomen', 'left-arm', 'right-arm', 'left-leg', 'right-leg']);
  assert.equal(groups.reduce((sum, group) => sum + group.parts.length, 0), parts.length);
  assert.ok(parts.every(part => part.mesh.parent !== null));
  for (const group of groups) group.object.updateMatrixWorld(true);
  for (const part of parts) {
    part.mesh.updateMatrixWorld(true);
    const actual = new THREE.Vector3().setFromMatrixPosition(part.mesh.matrixWorld);
    assert.ok(actual.distanceTo(originalWorldPositions.get(part.mesh)!) < 1e-5, `${part.name} must keep its assembled world position`);
  }
  assert.ok(groups.filter(group => group.name !== 'chest').every(group => group.scatteredPosition.distanceTo(group.assembledPosition) > 0.25));
  assert.ok(groups.every(group => group.scatteredPosition.distanceTo(group.assembledPosition) < 4));
  assert.ok(groups.flatMap(group => group.parts).every(part => part.internalScatteredPosition.distanceTo(part.assembledPosition) > 0.1));
});

test('mode two places body groups in a forward-facing horizontal row centered on the chest', () => {
  const groups = createArmorGroups(createArmorParts(makeModel(), 42));
  const chest = groups.find(group => group.name === 'chest')!;
  assert.deepEqual(chest.scatteredPosition.toArray(), chest.assembledPosition.toArray());
  for (const group of groups) {
    assert.ok(Math.abs(group.scatteredPosition.y - chest.assembledPosition.y) < 1e-8, `${group.name} must share the chest row`);
    if (group.name !== 'chest') assert.ok(group.scatteredPosition.z > chest.assembledPosition.z, `${group.name} must move toward the viewer, not behind the armor`);
  }
  assert.equal(new Set(groups.map(group => group.scatteredPosition.x)).size, groups.length);
});

test('uses transformed mesh bounds when placing arm and leg groups', () => {
  const model = new THREE.Group();
  const parent = new THREE.Group();
  parent.position.set(0.7, 0.4, 0);
  parent.scale.setScalar(1.8);
  model.add(parent);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.4, 0.2), new THREE.MeshStandardMaterial());
  mesh.position.set(0.2, 0.5, 0);
  parent.add(mesh);
  model.updateMatrixWorld(true);
  const parts = createArmorParts(model, 12);
  const groups = createArmorGroups(parts);
  const group = groups.find(entry => entry.parts.includes(parts[0]!))!;
  group.object.updateMatrixWorld(true);
  const expected = parts[0]!.assembledPosition.clone();
  const actual = new THREE.Vector3().setFromMatrixPosition(parts[0]!.mesh.matrixWorld);
  assert.ok(actual.distanceTo(expected) < 1e-5);
});

test('directional navigation chooses the closest armor group in the requested screen direction', () => {
  const centers = [
    { name: 'head' as const, x: 0.5, y: 0.2 },
    { name: 'chest' as const, x: 0.5, y: 0.5 },
    { name: 'abdomen' as const, x: 0.5, y: 0.66 },
    { name: 'left-arm' as const, x: 0.22, y: 0.44 },
    { name: 'right-arm' as const, x: 0.78, y: 0.44 },
    { name: 'left-leg' as const, x: 0.39, y: 0.82 },
    { name: 'right-leg' as const, x: 0.61, y: 0.82 },
  ];
  assert.equal(findDirectionalArmorGroup(centers, 'chest', 'up'), 'head');
  assert.equal(findDirectionalArmorGroup(centers, 'chest', 'down'), 'abdomen');
  assert.equal(findDirectionalArmorGroup(centers, 'chest', 'left'), 'left-arm');
  assert.equal(findDirectionalArmorGroup(centers, 'chest', 'right'), 'right-arm');
  assert.equal(findDirectionalArmorGroup(centers, 'head', 'up'), undefined);
});
