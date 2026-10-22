import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

if (process.argv.length < 4) {
  throw new Error('Usage: node scripts/convert-mark46-model.mjs <source.obj> <output.glb>');
}

globalThis.FileReader ??= class FileReader {
  result = null;
  onloadend = null;
  onerror = null;

  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then(result => {
      this.result = result;
      this.onloadend?.();
    }, error => {
      this.onerror?.(error);
    });
  }
};

const [sourcePath, outputPath] = process.argv.slice(2);
const source = await fs.readFile(sourcePath, 'utf8');
const model = new OBJLoader().parse(source);
let meshCount = 0;
let triangleCount = 0;
let vertexCount = 0;

model.traverse(object => {
  if (!(object instanceof THREE.Mesh)) return;
  const optimized = mergeVertices(object.geometry, 1e-5);
  object.geometry.dispose();
  object.geometry = optimized;
  if (!optimized.attributes.normal) optimized.computeVertexNormals();
  const materials = Array.isArray(object.material) ? object.material : [object.material];
  const convertedMaterials = materials.map(material => {
    const color = material.name === 'gdhfh' ? 0xd1e8f5 : 0x737b82;
    const emissive = material.name === 'gdhfh' ? 0x153647 : 0x000000;
    return new THREE.MeshStandardMaterial({
      name: material.name,
      color,
      emissive,
      metalness: material.name === 'gdhfh' ? 0.58 : 0.78,
      roughness: material.name === 'gdhfh' ? 0.32 : 0.43,
      side: THREE.DoubleSide,
    });
  });
  object.material = convertedMaterials.length === 1 ? convertedMaterials[0] : convertedMaterials;
  meshCount++;
  triangleCount += optimized.index ? optimized.index.count / 3 : optimized.attributes.position.count / 3;
  vertexCount += optimized.attributes.position.count;
});

if (meshCount < 2) throw new Error(`Expected separate body meshes, found ${meshCount}.`);

const binary = await new GLTFExporter().parseAsync(model, { binary: true });
await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
await fs.writeFile(outputPath, Buffer.from(binary));
const { size } = await fs.stat(outputPath);
console.log(JSON.stringify({ meshCount, triangleCount, vertexCount, bytes: size, outputPath }, null, 2));
