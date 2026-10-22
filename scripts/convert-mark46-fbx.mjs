import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

if (process.argv.length < 4) {
  throw new Error('Usage: node scripts/convert-mark46-fbx.mjs <source.fbx> <output.glb>');
}

const [sourcePath, outputPath] = process.argv.slice(2);
const source = await fs.readFile(sourcePath);

// FBXLoader expects a browser image element for texture references. The FBX
// contains V-Ray maps that cannot be carried into the browser build, so the
// converter deliberately replaces those maps with authored PBR materials.
globalThis.window ??= globalThis;
globalThis.document ??= { createElementNS: () => ({}) };
globalThis.FileReader ??= class FileReader {
  result = null;
  onloadend = null;
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.(); });
  }
};
THREE.ImageLoader.prototype.load = function loadPlaceholder(_url, onLoad) {
  onLoad?.({});
};

const buffer = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
const model = new FBXLoader().parse(buffer, path.dirname(path.resolve(sourcePath)) + path.sep);
const excludedNames = new Set(['地面', '环境反射', 'Camera001-前面', 'Camera001']);
const materialCache = new Map();

function materialFor(name) {
  const key = String(name || '').toLowerCase();
  if (materialCache.has(key)) return materialCache.get(key).clone();
  let color = 0xaeb7bf;
  let metalness = 0.9;
  let roughness = 0.28;
  let emissive = 0x000000;
  if (key.includes('红') || key.includes('red')) color = 0x8f1018;
  else if (key.includes('金') || key.includes('gold')) color = 0xd19b28;
  else if (key.includes('gdhfh') || key.includes('glass')) {
    color = 0xa7e8ff;
    metalness = 0.25;
    roughness = 0.12;
    emissive = 0x123c55;
  } else if (key.includes('地面') || key.includes('default') || key.includes('environment')) {
    color = 0x30343a;
    metalness = 0.1;
    roughness = 0.7;
  }
  const material = new THREE.MeshStandardMaterial({
    name: String(name || 'mark46-metal'), color, metalness, roughness, emissive,
    side: THREE.DoubleSide,
  });
  materialCache.set(key, material);
  return material.clone();
}

let meshCount = 0;
let triangleCount = 0;
let removedCount = 0;
model.traverse(object => {
  if (excludedNames.has(object.name)) {
    object.visible = false;
    removedCount++;
    return;
  }
  if (!(object instanceof THREE.Mesh)) return;
  const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
  // FBX may represent one source part as hundreds of material groups. The
  // Jarvis gesture controller moves source meshes independently, so collapse
  // those groups back to one mesh instead of exporting one GLTF primitive per
  // group. The first material is the authored material for that source part.
  object.geometry.clearGroups();
  object.material = materialFor(sourceMaterials[0]?.name);
  meshCount++;
  triangleCount += object.geometry.index ? object.geometry.index.count / 3 : object.geometry.attributes.position.count / 3;
});

if (meshCount < 2) throw new Error(`Expected separate armor meshes, found ${meshCount}.`);
model.updateMatrixWorld(true);
const binary = await new GLTFExporter().parseAsync(model, { binary: true, trs: false });
await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
await fs.writeFile(outputPath, Buffer.from(binary));
console.log(JSON.stringify({ meshCount, triangleCount, removedCount, outputPath }, null, 2));
