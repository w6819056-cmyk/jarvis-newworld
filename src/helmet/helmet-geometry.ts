import * as THREE from 'three';

export type ArmorGroupName = 'head' | 'chest' | 'abdomen' | 'left-arm' | 'right-arm' | 'left-leg' | 'right-leg';

export interface ArmorPart {
  name: string;
  groupName: ArmorGroupName;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>;
  assembledPosition: THREE.Vector3;
  assembledQuaternion: THREE.Quaternion;
  scatteredPosition: THREE.Vector3;
  scatteredQuaternion: THREE.Quaternion;
  internalScatteredPosition: THREE.Vector3;
}

export interface ArmorGroup {
  name: ArmorGroupName;
  object: THREE.Group;
  parts: ArmorPart[];
  assembledPosition: THREE.Vector3;
  scatteredPosition: THREE.Vector3;
  scatteredQuaternion: THREE.Quaternion;
}

export const ARMOR_GROUP_NAMES: readonly ArmorGroupName[] = ['head', 'chest', 'abdomen', 'left-arm', 'right-arm', 'left-leg', 'right-leg'];
const FRAGMENT_SPHERE_RADIUS = 2.5;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export interface ProjectedArmorGroup {
  name: ArmorGroupName;
  x: number;
  y: number;
}

const groupRowOffsets: Partial<Record<ArmorGroupName, number>> = {
  head: -0.9,
  abdomen: 0.9,
  'left-arm': -1.8,
  'right-arm': 1.8,
  'left-leg': -2.7,
  'right-leg': 2.7,
};

function randomGenerator(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function partName(height: number, lateral: number, side: string): string {
  if (height >= 0.78) return 'helmet';
  if (height >= 0.68) return lateral >= 0.3 ? `${side}-shoulder` : 'neck';
  if (height >= 0.52) return lateral >= 0.25 ? `${side}-upper-arm` : 'chest';
  if (height >= 0.38) return lateral >= 0.2 ? `${side}-forearm` : 'abdomen';
  if (height >= 0.26) return lateral >= 0.18 ? `${side}-hand` : 'pelvis';
  if (height >= 0.14) return `${side}-thigh`;
  if (height >= 0.05) return `${side}-shin`;
  return `${side}-foot`;
}

function groupName(name: string): ArmorGroupName {
  if (name === 'helmet' || name === 'neck') return 'head';
  if (name === 'chest' || name.endsWith('-shoulder')) return 'chest';
  if (name === 'abdomen' || name === 'pelvis') return 'abdomen';
  if (/^(left|right)-(upper-arm|forearm|hand)$/.test(name)) return name.startsWith('left-') ? 'left-arm' : 'right-arm';
  if (/^(left|right)-(thigh|shin|foot)$/.test(name)) return name.startsWith('left-') ? 'left-leg' : 'right-leg';
  return 'chest';
}

// The source FBX contains a few right-side nodes with stale transforms. Keep
// their geometry paired with the corresponding viewer-right (negative-X)
// source node instead of inferring the pair from the broken bounds.
const mirroredSourceByObjectName: Record<string, string> = {
  Object029: 'Object028',
  Object031: 'Object005',
  Object030: 'Object027',
  Object045: 'Object035',
  Object047: 'Object039',
  Object046: 'Object038',
  Object044: 'Object034',
  Object040: 'Object032',
  Object043: 'Object033',
  Object041: 'Object025',
  Object042: 'Object002',
};

function hierarchyGroup(object: THREE.Object3D, centerX: number, modelCenterX: number): ArmorGroupName | undefined {
  let current: THREE.Object3D | null = object.parent;
  while (current) {
    const name = current.name;
    if (name === '头部' || name === 'head') return 'head';
    if (name === '胸部' || name === 'chest') return 'chest';
    if (name === '腰部' || name === 'abdomen' || name === 'waist') return 'abdomen';
    if (name === '手部' || name === 'arm' || name === 'right-arm') {
      return centerX < modelCenterX ? 'right-arm' : 'left-arm';
    }
    if (name === '手部001' || name === 'left-arm') return 'left-arm';
    if (name === 'Group004' || name === 'right-leg') {
      return centerX < modelCenterX ? 'right-leg' : 'left-leg';
    }
    if (name === 'Group005' || name === 'left-leg') return 'left-leg';
    current = current.parent;
  }
  return undefined;
}

export function createArmorParts(model: THREE.Object3D, seed: number): ArmorPart[] {
  model.updateMatrixWorld(true);
  const modelBounds = new THREE.Box3().setFromObject(model);
  const modelSize = modelBounds.getSize(new THREE.Vector3());
  if (modelBounds.isEmpty() || modelSize.y <= 0 || modelSize.x <= 0) throw new Error('The Iron Man model has no usable bounds.');
  const modelCenter = modelBounds.getCenter(new THREE.Vector3());
  const scale = 3.8 / modelSize.y;
  const random = randomGenerator(seed);
  const parts: ArmorPart[] = [];

  const sourceMeshes: THREE.Mesh[] = [];
  model.traverse(object => { if (object instanceof THREE.Mesh) sourceMeshes.push(object); });
  const records = sourceMeshes.map(object => {
    const bounds = new THREE.Box3().setFromObject(object);
    return { object, bounds, center: bounds.getCenter(new THREE.Vector3()), size: bounds.getSize(new THREE.Vector3()) };
  });

  sourceMeshes.forEach((object, index) => {
    const record = records.find(entry => entry.object === object)!;
    const geometry = object.geometry.clone();
    const sourceBounds = record.bounds;
    const sourceCenter = record.center;
    const height = (sourceCenter.y - modelBounds.min.y) / modelSize.y;
    const lateral = Math.abs(sourceCenter.x - modelCenter.x) / (modelSize.x / 2);
    // Negative X is the viewer's right side when the armor faces the user.
    const name = partName(height, lateral, sourceCenter.x < modelCenter.x ? 'right' : 'left');
    const material = Array.isArray(object.material)
      ? object.material.map(entry => entry.clone())
      : object.material.clone();
    // FBX-derived GLB meshes often keep their spatial placement in the
    // vertex buffer while the node transform is identity. Bake the complete
    // world transform and recenter each mesh so group placement is stable for
    // both node-transformed and vertex-positioned source assets.
    // Some FBX meshes on the screen-right side contain an inverted local
    // vertex layout. Match them to the closest screen-left source mesh by
    // mirrored bounds and mirror that trusted geometry across the model axis.
    const mirrored = sourceCenter.x > modelCenter.x
      ? records.find(entry => entry.object.name === mirroredSourceByObjectName[object.name])
      : undefined;
    const mirrorMatrix = new THREE.Matrix4()
      .makeTranslation(modelCenter.x * 2, 0, 0)
      .multiply(new THREE.Matrix4().makeScale(-1, 1, 1));
    const assembledCenter = mirrored
      ? mirrored.center.clone().applyMatrix4(mirrorMatrix)
      : sourceCenter.clone();
    const assembledName = mirrored
      ? partName(
        (mirrored.center.y - modelBounds.min.y) / modelSize.y,
        Math.abs(mirrored.center.x - modelCenter.x) / (modelSize.x / 2),
        'left',
      )
      : name;
    const semanticGroup = hierarchyGroup(object, sourceCenter.x, modelCenter.x);
    if (mirrored) {
      geometry.copy(mirrored.object.geometry);
      geometry.applyMatrix4(mirrored.object.matrixWorld);
      geometry.applyMatrix4(mirrorMatrix);
    } else geometry.applyMatrix4(object.matrixWorld);
    geometry.translate(-assembledCenter.x, -assembledCenter.y, -assembledCenter.z);
    geometry.scale(scale, scale, scale);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = object.name || name;
    mesh.position.copy(assembledCenter).sub(modelCenter).multiplyScalar(scale);
    mesh.quaternion.identity();
    mesh.scale.setScalar(1);
    const assembledPosition = mesh.position.clone();

    const sphereY = 1 - 2 * (index + 0.5) / sourceMeshes.length;
    const sphereRing = Math.sqrt(1 - sphereY * sphereY);
    const sphereAngle = index * GOLDEN_ANGLE;
    const scatteredPosition = new THREE.Vector3(
      sphereRing * Math.cos(sphereAngle),
      sphereY,
      sphereRing * Math.sin(sphereAngle),
    ).multiplyScalar(FRAGMENT_SPHERE_RADIUS);
    const limb = semanticGroup === 'left-arm' || semanticGroup === 'right-arm'
      || semanticGroup === 'left-leg' || semanticGroup === 'right-leg'
      || /^(left|right)-(upper-arm|forearm|hand|shoulder|thigh|shin|foot)$/.test(assembledName);
    const scatteredQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      (random() - 0.5) * (limb ? 0.35 : 1.7),
      (random() - 0.5) * (limb ? 0.9 : 1.7),
      (random() - 0.5) * (limb ? 0.35 : 1.7),
    ));
    const internalAzimuth = random() * Math.PI * 2;
    const internalElevation = (random() - 0.5) * 1.1;
    const internalDirection = new THREE.Vector3(
      Math.cos(internalAzimuth) * Math.cos(internalElevation),
      Math.sin(internalElevation),
      Math.sin(internalAzimuth) * Math.cos(internalElevation),
    );
    parts.push({
      name: assembledName,
      groupName: semanticGroup ?? groupName(assembledName),
      mesh,
      assembledPosition,
      assembledQuaternion: mesh.quaternion.clone(),
      scatteredPosition,
      scatteredQuaternion,
      internalScatteredPosition: assembledPosition.clone().addScaledVector(internalDirection, 0.25 + random() * 0.5),
    });
  });

  return parts;
}

export function createArmorGroups(parts: ArmorPart[]): ArmorGroup[] {
  const grouped = ARMOR_GROUP_NAMES.map(name => {
    const groupParts = parts.filter(part => part.groupName === name);
    const bounds = new THREE.Box3();
    for (const part of groupParts) bounds.expandByObject(part.mesh);
    const center = bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3());
    return { name, groupParts, center };
  });
  const chestCenter = grouped.find(group => group.name === 'chest')?.center ?? new THREE.Vector3();

  return grouped.map(({ name, groupParts, center }) => {
    const object = new THREE.Group();
    object.name = name;
    object.position.copy(center);

    for (const part of groupParts) {
      part.mesh.position.sub(center);
      part.assembledPosition.sub(center);
      part.scatteredPosition.sub(center);
      part.internalScatteredPosition.sub(center);
      object.add(part.mesh);
    }

    return {
      name,
      object,
      parts: groupParts,
      assembledPosition: center,
      scatteredPosition: name === 'chest'
        ? center.clone()
        : new THREE.Vector3(chestCenter.x + groupRowOffsets[name]!, chestCenter.y, chestCenter.z + 0.8),
      scatteredQuaternion: new THREE.Quaternion(),
    };
  });
}

export function findDirectionalArmorGroup(
  centers: readonly ProjectedArmorGroup[],
  currentName: ArmorGroupName,
  direction: 'up' | 'down' | 'left' | 'right',
): ArmorGroupName | undefined {
  const current = centers.find(group => group.name === currentName);
  if (!current) return undefined;
  const axis = direction === 'left' ? [-1, 0] : direction === 'right' ? [1, 0] : direction === 'up' ? [0, -1] : [0, 1];
  let best: { name: ArmorGroupName; score: number } | undefined;
  for (const candidate of centers) {
    if (candidate.name === currentName) continue;
    const dx = candidate.x - current.x;
    const dy = candidate.y - current.y;
    const forward = dx * axis[0]! + dy * axis[1]!;
    if (forward <= 0.005) continue;
    const lateral = Math.abs(dx * axis[1]! - dy * axis[0]!);
    const score = lateral / forward + forward * 0.08;
    if (!best || score < best.score) best = { name: candidate.name, score };
  }
  return best?.name;
}
