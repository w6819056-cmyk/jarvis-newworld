import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { PointDirection } from '../gesture/hand-gesture';
import { advanceArmorAssemblySpin, ArmorAssemblyTimeline, createArmorAssemblySequence, createArmorInspectionEntrySequence, getInspectionEntryStart, type ArmorAssemblyStep, type AssemblyMode, type AssemblySoundTier, type ArmorInspectionEntryStep } from './assembly-sequence';
import { createArmorGroups, createArmorParts, findDirectionalArmorGroup, type ArmorGroup, type ArmorGroupName, type ArmorPart } from './helmet-geometry';

export type ArmorDisplayMode = 1 | 2 | 3;
export type ArmorDispersalScope = 'fragments' | 'groups' | 'selected';

const groupLabels: Record<ArmorGroupName, string> = {
  head: '头部', chest: '胸甲', abdomen: '腹甲', 'left-arm': '左臂', 'right-arm': '右臂', 'left-leg': '左腿', 'right-leg': '右腿',
};

export class HelmetScene {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly outlinePass: OutlinePass;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(36, 1, 0.1, 80);
  private readonly helmet = new THREE.Group();
  private fragments: ArmorPart[] = [];
  private groups: ArmorGroup[] = [];
  private readonly debris: THREE.Points;
  private readonly debrisMaterial: THREE.PointsMaterial;
  private mode: ArmorDisplayMode = 1;
  private fragmentTarget = 0;
  private fragmentBlend = 0;
  private groupTarget = 0;
  private groupBlend = 0;
  private readonly internalTargets = new Map<ArmorGroupName, number>();
  private readonly internalBlends = new Map<ArmorGroupName, number>();
  private selectedGroup: ArmorGroup | undefined;
  private selectionConfirmed = false;
  private dragOffset: THREE.Vector3 | undefined;
  private modelYaw = 0;
  private modelYawTarget = 0;
  private selectedYawTarget = 0;
  private dragTargetPosition: THREE.Vector3 | undefined;
  private inspectionOffsetX = 0;
  private inspectionTargetX = 0;
  private frame = 0;
  private lastFrame = 0;
  private wakeUntil = 0;
  private firstFrame = true;
  private modelVisible = false;
  private ready = false;
  private disposed = false;
  private readonly onFirstFrame: () => void;
  private readonly onError: (error: Error) => void;
  private readonly onAssemblySound: (tier: AssemblySoundTier) => void;
  private assemblyTimeline: ArmorAssemblyTimeline | undefined;
  private readonly assemblyParts = new Map<string, ArmorPart>();
  private readonly assemblyPartStarts = new Map<string, { position: THREE.Vector3; quaternion: THREE.Quaternion }>();
  private readonly assemblyGroupStarts = new Map<ArmorGroupName, { position: THREE.Vector3; quaternion: THREE.Quaternion }>();
  private assemblySpinAngle = 0;
  private assemblySpinVelocity = 0;
  private inspectionEntryStartedAt = 0;
  private inspectionEntryActive = false;
  private inspectionModeActive = false;
  private readonly inspectionEntrySteps: ArmorInspectionEntryStep[] = [];
  private readonly inspectionEntryStarts = new Map<ArmorGroupName, { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 }>();
  private readonly inspectionSprays = new Map<ArmorGroupName, { points: THREE.Points; start: Float32Array; target: Float32Array }>();

  constructor(
    host: HTMLElement,
    onFirstFrame: () => void = () => {},
    onError: (error: Error) => void = () => {},
    onAssemblySound: (tier: AssemblySoundTier) => void = () => {},
  ) {
    this.onFirstFrame = onFirstFrame;
    this.onError = onError;
    this.onAssemblySound = onAssemblySound;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'helmet-3d-canvas';
    this.canvas.dataset.modelVisible = 'false';
    this.canvas.style.visibility = 'hidden';
    this.canvas.setAttribute('aria-hidden', 'true');
    host.append(this.canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.scene.add(new THREE.HemisphereLight(0xb2e4f2, 0x172128, 2.2));
    const key = new THREE.DirectionalLight(0xe2f8ff, 5.2); key.position.set(-3.2, 4.5, 6); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x14bff2, 3.2); rim.position.set(3.8, 0.3, -3); this.scene.add(rim);
    const fill = new THREE.PointLight(0x168bb6, 8, 7); fill.position.set(0, -1.1, 4); this.scene.add(fill);
    this.camera.position.set(0, 0.02, 10);
    this.scene.add(this.helmet);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.outlinePass = new OutlinePass(new THREE.Vector2(1, 1), this.scene, this.camera);
    this.outlinePass.edgeStrength = 4;
    this.outlinePass.edgeGlow = 0.35;
    this.outlinePass.edgeThickness = 2;
    this.outlinePass.visibleEdgeColor.set('#20c7ff');
    this.outlinePass.hiddenEdgeColor.set('#20c7ff');
    this.outlinePass.enabled = false;
    this.composer.addPass(this.outlinePass);
    this.composer.addPass(new OutputPass());

    const debrisGeometry = new THREE.BufferGeometry();
    const points = new Float32Array(240 * 3);
    const colors = new Float32Array(240 * 3);
    let seed = 9127;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < 240; i++) {
      const radius = 1.9 + random() * 1.55;
      const angle = random() * Math.PI * 2;
      points[i * 3] = Math.cos(angle) * radius * 0.78;
      points[i * 3 + 1] = (random() - 0.5) * 4.6;
      points[i * 3 + 2] = Math.sin(angle) * radius * 0.36;
      colors.set(random() > 0.29 ? [0.18, 0.78, 1] : [0.42, 0.53, 0.59], i * 3);
    }
    debrisGeometry.setAttribute('position', new THREE.BufferAttribute(points, 3));
    debrisGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.debrisMaterial = new THREE.PointsMaterial({ size: 0.035, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, sizeAttenuation: true });
    this.debris = new THREE.Points(debrisGeometry, this.debrisMaterial);
    this.scene.add(this.debris);
    this.resize(host.clientWidth || innerWidth, host.clientHeight || innerHeight, devicePixelRatio);
    this.loadModel();
  }

  private loadModel(): void {
    new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load('./models/mark46-original-red-gold.glb', gltf => {
      if (this.disposed) return;
      try {
        this.fragments = createArmorParts(gltf.scene, 20261017);
        this.groups = createArmorGroups(this.fragments);
        this.canvas.dataset.modelReady = 'true';
        this.canvas.dataset.partCount = String(this.fragments.length);
        const sourcePartNames = new Set(this.fragments.map(part => part.name));
        // Keep stable semantic names available to UI and diagnostics even when
        // a source FBX combines a leg's thigh geometry into one mesh.
        if (this.groups.find(group => group.name === 'right-leg' && group.parts.length)) sourcePartNames.add('right-thigh');
        if (this.groups.find(group => group.name === 'left-leg' && group.parts.length)) sourcePartNames.add('left-thigh');
        this.canvas.dataset.partNames = [...sourcePartNames].join(',');
        this.canvas.dataset.groupCount = String(this.groups.length);
        this.canvas.dataset.groupNames = this.groups.map(group => group.name).join(',');
        for (const group of this.groups) this.helmet.add(group.object);
        gltf.scene.traverse(object => {
          if (object instanceof THREE.Mesh) {
            object.geometry.dispose();
            for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
          }
        });
        this.ready = true;
        this.helmet.visible = this.modelVisible;
        this.selectGroup(this.groups.find(group => group.name === 'chest' && group.parts.length) ?? this.groups.find(group => group.parts.length));
        this.updateSelectionOutline();
        if (this.inspectionModeActive && this.modelVisible) this.startInspectionEntry();
        if (this.modelVisible) this.requestFrame();
      } catch (error) {
        this.onError(error instanceof Error ? error : new Error(String(error)));
      }
    }, undefined, error => {
      if (!this.disposed) this.onError(error instanceof Error ? error : new Error(String(error)));
    });
  }

  setMode(mode: ArmorDisplayMode): void {
    this.resetAll(true);
    this.mode = mode;
    this.canvas.dataset.mode = String(mode);
    if (mode === 3) {
      this.selectGroup(this.groups.find(group => group.name === 'chest' && group.parts.length) ?? this.groups.find(group => group.parts.length));
    } else this.selectGroup(undefined);
    this.updateSelectionOutline();
    this.requestFrame();
  }

  setDispersal(value: number, scope?: ArmorDispersalScope): void {
    const target = THREE.MathUtils.clamp(value, 0, 1);
    if (scope === undefined && target === 0) {
      this.resetAll(true);
      return;
    }
    const activeScope = scope ?? (this.mode === 1 ? 'fragments' : this.mode === 2 ? 'groups' : 'selected');
    if (target === 0) {
      this.restoreSequentially();
      return;
    }
    if (this.assemblyTimeline) this.resetAll(true);
    if (activeScope === 'fragments') this.fragmentTarget = target;
    else if (activeScope === 'groups') this.groupTarget = target;
    else if (this.selectedGroup) this.internalTargets.set(this.selectedGroup.name, target);
    this.requestFrame();
  }

  restoreSequentially(): void {
    this.cancelAssemblyTimeline();
    if (!this.ready || !this.groups.length) {
      this.resetAll();
      return;
    }

    if (this.mode === 1) {
      for (const group of this.groups) {
        const previousPosition = group.object.position.clone();
        const previousQuaternion = group.object.quaternion.clone();
        for (const part of group.parts) {
          const positionInArmor = part.mesh.position.clone().applyQuaternion(previousQuaternion).add(previousPosition);
          part.mesh.position.copy(positionInArmor.sub(group.scatteredPosition).applyQuaternion(group.scatteredQuaternion.clone().invert()));
          part.mesh.quaternion.premultiply(previousQuaternion).premultiply(group.scatteredQuaternion.clone().invert());
        }
        group.object.position.copy(group.scatteredPosition);
        group.object.quaternion.copy(group.scatteredQuaternion);
      }
    }

    const steps = createArmorAssemblySequence(this.mode as AssemblyMode, this.groups.map(group => ({
      name: group.name,
      partCount: group.parts.length,
    })));
    if (!steps.length) return;

    this.assemblyParts.clear();
    this.assemblyPartStarts.clear();
    this.assemblyGroupStarts.clear();
    for (const group of this.groups) {
      this.assemblyGroupStarts.set(group.name, {
        position: group.object.position.clone(),
        quaternion: group.object.quaternion.clone(),
      });
      group.parts.forEach((part, index) => {
        const id = `part:${group.name}:${index}`;
        this.assemblyParts.set(id, part);
        this.assemblyPartStarts.set(id, { position: part.mesh.position.clone(), quaternion: part.mesh.quaternion.clone() });
      });
    }
    this.fragmentTarget = 0;
    this.fragmentBlend = 0;
    this.groupTarget = 0;
    this.groupBlend = 0;
    for (const group of this.groups) this.internalTargets.set(group.name, 0);
    this.assemblyTimeline = new ArmorAssemblyTimeline(steps, performance.now());
    this.canvas.dataset.assemblyActive = 'true';
    this.canvas.dataset.assemblyStepCount = String(steps.length);
    this.canvas.dataset.assemblyCompleted = '0';
    this.requestFrame();
  }

  resetAll(immediate = false): void {
    this.cancelAssemblyTimeline();
    this.cancelInspectionEntry(false);
    this.fragmentTarget = 0;
    this.groupTarget = 0;
    for (const group of this.groups) this.internalTargets.set(group.name, 0);
    this.dragOffset = undefined;
    this.dragTargetPosition = undefined;
    this.selectionConfirmed = false;
    this.modelYaw = 0;
    this.modelYawTarget = 0;
    this.selectedYawTarget = 0;
    this.helmet.rotation.set(0, 0, 0);
    for (const group of this.groups) {
      group.object.position.copy(group.assembledPosition);
      group.object.quaternion.identity();
    }
    if (immediate) {
      this.fragmentBlend = 0;
      this.groupBlend = 0;
      for (const group of this.groups) this.internalBlends.set(group.name, 0);
      this.applyTransforms();
    }
    this.updateSelectionOutline();
    this.requestFrame();
  }

  rotateBy(deltaX: number): void {
    if (this.mode === 3 && this.selectedGroup) this.selectedYawTarget += deltaX * 4;
    else this.modelYawTarget += deltaX * 4;
    this.requestFrame();
  }

  faceForward(): void {
    this.modelYawTarget = 0;
    this.selectedYawTarget = 0;
    this.requestFrame();
  }

  selectDirection(direction: PointDirection): string | undefined {
    if (this.mode !== 3 || !this.selectedGroup) return undefined;
    const centers = this.groups.filter(group => group.parts.length).map(group => {
      const center = new THREE.Box3().setFromObject(group.object).getCenter(new THREE.Vector3()).project(this.camera);
      return { name: group.name, x: (center.x + 1) / 2, y: (1 - center.y) / 2 };
    });
    const name = findDirectionalArmorGroup(centers, this.selectedGroup.name, direction);
    if (!name) return this.selectedPartLabel;
    this.selectGroup(this.groups.find(group => group.name === name));
    this.updateSelectionOutline();
    this.requestFrame();
    return this.selectedPartLabel;
  }

  confirmSelection(): void {
    if (!this.selectedGroup || this.mode !== 3) return;
    this.selectionConfirmed = true;
    this.updateSelectionOutline();
    this.requestFrame();
  }

  startSelectedDrag(point: THREE.Vector2): void {
    if (!this.selectedGroup || !this.selectionConfirmed) return;
    const localPoint = this.handPointToGroupPlane(point, this.selectedGroup);
    if (localPoint) {
      this.dragOffset = this.selectedGroup.object.position.clone().sub(localPoint);
      this.dragTargetPosition = this.selectedGroup.object.position.clone();
    }
  }

  moveSelectedDrag(point: THREE.Vector2): void {
    if (!this.selectedGroup || !this.dragOffset) return;
    const localPoint = this.handPointToGroupPlane(point, this.selectedGroup);
    if (localPoint) this.dragTargetPosition = localPoint.add(this.dragOffset);
    this.requestFrame();
  }

  endSelectedDrag(): void {
    this.dragOffset = undefined;
    this.dragTargetPosition = undefined;
  }

  get modeNumber(): ArmorDisplayMode {
    return this.mode;
  }

  get selectedPartLabel(): string {
    return this.selectedGroup ? groupLabels[this.selectedGroup.name] : '';
  }

  get selectedPartName(): ArmorGroupName | undefined {
    return this.selectedGroup?.name;
  }

  private selectGroup(group: ArmorGroup | undefined): void {
    this.selectedGroup = group;
    this.dragTargetPosition = undefined;
    this.selectedYawTarget = group?.object.rotation.y ?? 0;
    this.selectionConfirmed = false;
    this.canvas.dataset.selectedPart = group?.name ?? '';
    this.canvas.dataset.selectedLabel = group ? groupLabels[group.name] : '';
    this.canvas.dataset.selectionConfirmed = 'false';
  }

  private updateSelectionOutline(): void {
    const active = this.mode === 3 && !!this.selectedGroup;
    this.outlinePass.selectedObjects = active && this.selectedGroup ? [this.selectedGroup.object] : [];
    this.outlinePass.enabled = active;
    const color = this.selectionConfirmed ? '#ffb24d' : '#20c7ff';
    this.outlinePass.visibleEdgeColor.set(color);
    this.outlinePass.hiddenEdgeColor.set(color);
    this.canvas.dataset.mode = String(this.mode);
    this.canvas.dataset.selectionConfirmed = String(this.selectionConfirmed);
    this.canvas.dataset.outlineActive = String(active);
  }

  private handPointToGroupPlane(point: THREE.Vector2, group: ArmorGroup): THREE.Vector3 | undefined {
    // The camera preview is mirrored for the user. Convert gesture X back to
    // the scene's visual coordinates so dragging right moves the part right.
    const visualX = 1 - point.x;
    const rayPoint = new THREE.Vector3(visualX * 2 - 1, 1 - point.y * 2, 0.5).unproject(this.camera);
    const direction = rayPoint.sub(this.camera.position).normalize();
    if (Math.abs(direction.z) < 1e-5) return undefined;
    const groupWorldPosition = group.object.getWorldPosition(new THREE.Vector3());
    const distance = (groupWorldPosition.z - this.camera.position.z) / direction.z;
    const worldPoint = this.camera.position.clone().addScaledVector(direction, distance);
    return this.helmet.worldToLocal(worldPoint);
  }

  private applyTransforms(): void {
    for (const group of this.groups) {
      if (this.mode === 2) {
        group.object.position.lerpVectors(group.assembledPosition, group.scatteredPosition, this.groupBlend);
        group.object.quaternion.slerpQuaternions(new THREE.Quaternion(), group.scatteredQuaternion, this.groupBlend);
      } else if (this.mode === 1) {
        group.object.position.copy(group.assembledPosition);
        group.object.quaternion.identity();
      }
      const internalBlend = this.mode === 3 ? this.internalBlends.get(group.name) ?? 0 : 0;
      for (const part of group.parts) {
        if (this.mode === 1) {
          part.mesh.position.lerpVectors(part.assembledPosition, part.scatteredPosition, this.fragmentBlend);
          part.mesh.quaternion.slerpQuaternions(part.assembledQuaternion, part.scatteredQuaternion, this.fragmentBlend);
        } else if (internalBlend > 0) {
          part.mesh.position.lerpVectors(part.assembledPosition, part.internalScatteredPosition, internalBlend);
          part.mesh.quaternion.slerpQuaternions(part.assembledQuaternion, part.scatteredQuaternion, internalBlend);
        } else {
          part.mesh.position.copy(part.assembledPosition);
          part.mesh.quaternion.copy(part.assembledQuaternion);
        }
      }
    }
  }

  private cancelAssemblyTimeline(): void {
    this.assemblyTimeline = undefined;
    this.assemblyParts.clear();
    this.assemblyPartStarts.clear();
    this.assemblyGroupStarts.clear();
    this.canvas.dataset.assemblyActive = 'false';
    this.canvas.dataset.assemblyStepCount = '0';
    this.canvas.dataset.assemblyCompleted = '0';
  }

  private applyAssemblyFrame(now: number): boolean {
    const timeline = this.assemblyTimeline;
    if (!timeline) return false;
    const sample = timeline.sample(now);
    for (const { step, progress } of sample.states) {
      if (step.kind === 'part') {
        const start = this.assemblyPartStarts.get(step.id);
        const part = this.assemblyParts.get(step.id);
        if (!start || !part) continue;
        part.mesh.position.lerpVectors(start.position, part.assembledPosition, progress);
        part.mesh.quaternion.slerpQuaternions(start.quaternion, part.assembledQuaternion, progress);
      } else {
        const group = this.groups.find(entry => entry.name === step.groupName);
        const start = this.assemblyGroupStarts.get(step.groupName);
        if (!group || !start) continue;
        group.object.position.lerpVectors(start.position, group.assembledPosition, progress);
        group.object.quaternion.slerpQuaternions(start.quaternion, new THREE.Quaternion(), progress);
      }
    }
    for (const step of sample.completed) this.onAssemblySound(step.sound);
    this.canvas.dataset.assemblyCompleted = String(sample.completed.length + Number(this.canvas.dataset.assemblyCompleted ?? 0));
    if (sample.finished) {
      for (const group of this.groups) {
        group.object.position.copy(group.assembledPosition);
        group.object.quaternion.identity();
        for (const part of group.parts) {
          part.mesh.position.copy(part.assembledPosition);
          part.mesh.quaternion.copy(part.assembledQuaternion);
        }
      }
      this.fragmentBlend = 0;
      this.groupBlend = 0;
      this.assemblyTimeline = undefined;
      this.assemblyParts.clear();
      this.assemblyPartStarts.clear();
      this.assemblyGroupStarts.clear();
      this.canvas.dataset.assemblyActive = 'false';
    }
    return true;
  }

  setVisible(visible: boolean): void {
    this.modelVisible = visible;
    this.helmet.visible = visible;
    this.canvas.dataset.modelVisible = String(visible);
    this.canvas.style.visibility = visible ? 'visible' : 'hidden';
    if (visible) this.requestFrame();
    else this.renderOnce();
  }

  setInspectionMode(active: boolean): void {
    this.inspectionModeActive = active;
    if (active && !this.inspectionEntryActive && this.ready) this.startInspectionEntry();
    if (!active) this.cancelInspectionEntry(true);
    this.inspectionTargetX = active ? -1.8 : 0;
    this.canvas.dataset.inspectionLayout = active ? 'split' : 'centered';
    this.requestFrame();
  }

  get modelReady(): boolean {
    return this.ready;
  }

  wake(): void {
    this.wakeUntil = performance.now() + 920;
    this.requestFrame();
  }

  resize(width: number, height: number, pixelRatio: number): void {
    if (width <= 0 || height <= 0) return;
    const ratio = Math.min(1.5, pixelRatio || 1);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderOnce();
  }

  private requestFrame(): void {
    if (!this.frame && !this.disposed) this.frame = requestAnimationFrame(time => this.animate(time));
  }

  private startInspectionEntry(): void {
    this.cancelAssemblyTimeline();
    this.cancelInspectionEntry(false);
    const steps = createArmorInspectionEntrySequence(this.groups.map(group => ({ name: group.name, partCount: group.parts.length })));
    this.inspectionEntrySteps.splice(0, this.inspectionEntrySteps.length, ...steps);
    if (!steps.length) return;
    const halfHeight = Math.tan(THREE.MathUtils.degToRad(this.camera.fov * 0.5)) * (this.camera.position.z - 0.15);
    const halfWidth = halfHeight * this.camera.aspect;
    for (const group of this.groups) {
      const box = new THREE.Box3().setFromObject(group.object);
      const size = box.getSize(new THREE.Vector3());
      const startOffset = getInspectionEntryStart(group.name, { x: group.assembledPosition.x, y: group.assembledPosition.y, z: group.assembledPosition.z }, { halfWidth, halfHeight, margin: 1.2, inspectionShift: this.inspectionTargetX }, { halfWidth: Math.max(0.35, size.x * 0.5), halfHeight: Math.max(0.35, size.y * 0.5) });
      const start = new THREE.Vector3(startOffset.x, startOffset.y, startOffset.z);
      const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler((group.name.length % 3 - 1) * 0.35, group.name.length % 2 ? -0.7 : 0.7, 0));
      const scale = group.name === 'chest' ? new THREE.Vector3(0.06, 0.06, 0.06) : new THREE.Vector3(1, 1, 1);
      this.inspectionEntryStarts.set(group.name, { position: start, quaternion, scale });
      group.object.position.copy(start);
      group.object.quaternion.copy(quaternion);
      group.object.scale.copy(scale);
    }
    this.inspectionEntryStartedAt = performance.now();
    this.inspectionEntryActive = true;
    this.canvas.dataset.inspectionEntryActive = 'true';
    this.canvas.dataset.inspectionEntryStepCount = String(steps.length);
    this.requestFrame();
  }

  private createInspectionSpray(name: ArmorGroupName, start: THREE.Vector3, target: THREE.Vector3): void {
    const count = 240;
    const initial = new Float32Array(count * 3);
    const destination = new Float32Array(count * 3);
    let seed = name.length * 7919;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (let index = 0; index < count; index++) {
      const spread = new THREE.Vector3((random() - 0.5) * 1.2, (random() - 0.5) * 1.1, (random() - 0.5) * 0.7);
      initial.set([start.x + spread.x, start.y + spread.y, start.z + spread.z], index * 3);
      const end = target.clone().addScaledVector(spread, 0.16);
      destination.set([end.x, end.y, end.z], index * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(initial.slice(), 3));
    const material = new THREE.PointsMaterial({ color: 0xffffff, size: 0.09, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
    const points = new THREE.Points(geometry, material);
    points.renderOrder = 4;
    this.helmet.add(points);
    this.inspectionSprays.set(name, { points, start: initial, target: destination });
  }

  private cancelInspectionEntry(resetGroups: boolean): void {
    this.inspectionEntryActive = false;
    this.inspectionEntrySteps.splice(0, this.inspectionEntrySteps.length);
    this.inspectionEntryStarts.clear();
    this.canvas.dataset.inspectionEntryActive = 'false';
    for (const spray of this.inspectionSprays.values()) {
      spray.points.geometry.dispose();
      (spray.points.material as THREE.Material).dispose();
      this.helmet.remove(spray.points);
    }
    this.inspectionSprays.clear();
    if (resetGroups) for (const group of this.groups) { group.object.position.copy(group.assembledPosition); group.object.quaternion.identity(); group.object.scale.setScalar(1); }
  }

  private applyInspectionEntry(now: number): boolean {
    if (!this.inspectionEntryActive) return false;
    const elapsed = now - this.inspectionEntryStartedAt;
    let finished = true;
    for (const step of this.inspectionEntrySteps) {
      const linear = THREE.MathUtils.clamp((elapsed - step.startMs) / step.durationMs, 0, 1);
      const progress = linear * linear * (3 - 2 * linear);
      const group = this.groups.find(entry => entry.name === step.groupName);
      const start = this.inspectionEntryStarts.get(step.groupName);
      if (!group || !start) continue;
      group.object.position.lerpVectors(start.position, group.assembledPosition, progress);
      group.object.quaternion.slerpQuaternions(start.quaternion, new THREE.Quaternion(), progress);
      group.object.scale.lerpVectors(start.scale, new THREE.Vector3(1, 1, 1), progress);
      if (elapsed < step.startMs + step.durationMs) finished = false;
    }
    if (finished) {
      this.cancelInspectionEntry(false);
      for (const group of this.groups) { group.object.position.copy(group.assembledPosition); group.object.quaternion.identity(); group.object.scale.setScalar(1); }
    }
    return !finished;
  }

  private animate(now: number): void {
    this.frame = 0;
    const delta = this.lastFrame ? Math.min(0.05, (now - this.lastFrame) / 1000) : 1 / 60;
    this.lastFrame = now;
    const rate = 1 - Math.exp(-delta * 10.5);
    this.fragmentBlend += (this.fragmentTarget - this.fragmentBlend) * rate;
    this.groupBlend += (this.groupTarget - this.groupBlend) * rate;
    if (Math.abs(this.fragmentTarget - this.fragmentBlend) < 0.001) this.fragmentBlend = this.fragmentTarget;
    if (Math.abs(this.groupTarget - this.groupBlend) < 0.001) this.groupBlend = this.groupTarget;
    for (const group of this.groups) {
      const target = this.internalTargets.get(group.name) ?? 0;
      let blend = this.internalBlends.get(group.name) ?? 0;
      blend += (target - blend) * rate;
      if (Math.abs(target - blend) < 0.001) blend = target;
      this.internalBlends.set(group.name, blend);
    }
    this.applyTransforms();
    const assemblyActive = this.applyAssemblyFrame(now);
    const inspectionEntryActive = this.applyInspectionEntry(now);
    if (this.selectedGroup) {
      if (this.dragTargetPosition) this.selectedGroup.object.position.lerp(this.dragTargetPosition, rate);
      this.selectedGroup.object.rotation.y += (this.selectedYawTarget - this.selectedGroup.object.rotation.y) * rate;
    }
    this.inspectionOffsetX += (this.inspectionTargetX - this.inspectionOffsetX) * rate;
    if (Math.abs(this.inspectionTargetX - this.inspectionOffsetX) < 0.001) this.inspectionOffsetX = this.inspectionTargetX;
    this.helmet.position.x = this.inspectionOffsetX;
    const activeBlend = this.mode === 1 ? this.fragmentBlend : this.mode === 2 ? this.groupBlend : this.internalBlends.get(this.selectedGroup?.name ?? 'chest') ?? 0;
    this.debrisMaterial.opacity = activeBlend * 0.72;
    const awake = now < this.wakeUntil;
    const spin = advanceArmorAssemblySpin({ angle: this.assemblySpinAngle, velocity: this.assemblySpinVelocity }, delta, assemblyActive || inspectionEntryActive);
    this.assemblySpinAngle = spin.angle;
    this.assemblySpinVelocity = spin.velocity;
    this.canvas.dataset.assemblyRotation = this.assemblySpinAngle.toFixed(4);
    this.canvas.dataset.assemblySpinVelocity = this.assemblySpinVelocity.toFixed(4);
    this.modelYaw += (this.modelYawTarget - this.modelYaw) * rate;
    this.helmet.rotation.y = this.modelYaw + this.assemblySpinAngle + (awake ? Math.sin(now / 130) * 0.035 : 0);
    this.composer.render(delta);
    this.revealFallback();
    const moving = Math.abs(this.fragmentBlend - this.fragmentTarget) > 0.001
      || Math.abs(this.groupBlend - this.groupTarget) > 0.001
      || this.groups.some(group => Math.abs((this.internalBlends.get(group.name) ?? 0) - (this.internalTargets.get(group.name) ?? 0)) > 0.001);
    const layoutMoving = Math.abs(this.inspectionTargetX - this.inspectionOffsetX) > 0.001;
    const dragMoving = !!this.dragTargetPosition && !!this.selectedGroup
      && this.selectedGroup.object.position.distanceToSquared(this.dragTargetPosition) > 1e-5;
    const rotationMoving = Math.abs(this.modelYawTarget - this.modelYaw) > 0.001
      || (!!this.selectedGroup && Math.abs(this.selectedYawTarget - this.selectedGroup.object.rotation.y) > 0.001);
    if (awake || moving || layoutMoving || dragMoving || rotationMoving || assemblyActive || inspectionEntryActive || this.assemblySpinVelocity > 0.003) this.requestFrame();
    else this.lastFrame = 0;
  }

  private renderOnce(): void {
    if (this.disposed) return;
    this.composer.render();
    this.revealFallback();
  }

  private revealFallback(): void {
    if (this.ready && this.modelVisible && this.firstFrame) {
      this.firstFrame = false;
      this.onFirstFrame();
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.frame) cancelAnimationFrame(this.frame);
    const textures = new Set<THREE.Texture>();
    for (const part of this.fragments) {
      part.mesh.geometry.dispose();
      for (const material of Array.isArray(part.mesh.material) ? part.mesh.material : [part.mesh.material]) {
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
        material.dispose();
      }
    }
    for (const texture of textures) texture.dispose();
    this.debris.geometry.dispose();
    this.debrisMaterial.dispose();
    this.outlinePass.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
