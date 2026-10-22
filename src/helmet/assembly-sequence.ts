import type { ArmorGroupName } from './helmet-geometry';

export type AssemblyMode = 1 | 2 | 3;
export type AssemblySoundTier = 'small' | 'large';

export interface ArmorInspectionEntryStep {
  groupName: ArmorGroupName;
  startMs: number;
  durationMs: number;
}

export interface ArmorAssemblySpin {
  angle: number;
  velocity: number;
}

export function advanceArmorAssemblySpin(
  spin: ArmorAssemblySpin,
  deltaSeconds: number,
  active: boolean,
): ArmorAssemblySpin {
  const delta = Math.max(0, Math.min(0.05, deltaSeconds));
  const response = 2.4;
  const velocity = active
    ? spin.velocity + (0.32 - spin.velocity) * (1 - Math.exp(-delta * response))
    : spin.velocity * Math.exp(-delta * response);
  return { angle: spin.angle + velocity * delta, velocity };
}

export interface AssemblyGroupInput {
  name: ArmorGroupName;
  partCount: number;
}

const INSPECTION_ENTRY_ORDER: readonly ArmorGroupName[] = [
  'chest', 'head', 'abdomen', 'left-arm', 'right-arm', 'left-leg', 'right-leg',
];

export interface InspectionEntryOffset { x: number; y: number; z: number; }

export interface InspectionViewport { halfWidth: number; halfHeight: number; margin: number; inspectionShift: number; }
export interface InspectionGroupBounds { halfWidth: number; halfHeight: number; }

export function getInspectionEntryOffset(groupName: ArmorGroupName): InspectionEntryOffset {
  switch (groupName) {
    case 'left-arm': case 'left-leg': return { x: -5.8, y: 0, z: 0.4 };
    case 'right-arm': case 'right-leg': return { x: 5.8, y: 0, z: 0.4 };
    case 'head': return { x: 0, y: 5.6, z: 0.2 };
    case 'abdomen': return { x: 0, y: -4.8, z: -0.2 };
    case 'chest': return { x: 0, y: -0.7, z: -1.6 };
  }
}

export function getInspectionEntryStart(groupName: ArmorGroupName, target: InspectionEntryOffset, viewport: InspectionViewport, bounds: InspectionGroupBounds): InspectionEntryOffset {
  if (groupName === 'chest') return { x: 0, y: -0.7, z: -1.6 };
  if (groupName === 'head') return { x: target.x, y: viewport.halfHeight + bounds.halfHeight + viewport.margin, z: target.z + 0.2 };
  if (groupName === 'abdomen') return { x: target.x, y: -viewport.halfHeight - bounds.halfHeight - viewport.margin, z: target.z - 0.2 };
  const side = groupName === 'left-arm' || groupName === 'left-leg' ? -1 : 1;
  return { x: side * (viewport.halfWidth + bounds.halfWidth + viewport.margin) - viewport.inspectionShift, y: target.y, z: target.z + 0.4 };
}

export function createArmorInspectionEntrySequence(groups: readonly AssemblyGroupInput[]): ArmorInspectionEntryStep[] {
  const known = new Set(groups.map(group => group.name));
  return INSPECTION_ENTRY_ORDER.filter(name => known.has(name)).map((groupName, index) => ({
    groupName,
    startMs: index * 650,
    durationMs: 1550,
  }));
}

export interface ArmorAssemblyStep {
  id: string;
  kind: 'part' | 'group';
  groupName: ArmorGroupName;
  partIndex?: number;
  sound: AssemblySoundTier;
  startMs: number;
  durationMs: number;
}

export interface AssemblyStepState {
  step: ArmorAssemblyStep;
  progress: number;
}

const SMALL_STAGGER_MS = 90;
const SMALL_DURATION_MS = 280;
const PHASE_GAP_MS = 180;
const LARGE_STAGGER_MS = 340;
const LARGE_DURATION_MS = 560;
const LARGE_GROUP_ORDER: readonly ArmorGroupName[] = [
  'chest', 'head', 'abdomen', 'left-arm', 'right-arm', 'left-leg', 'right-leg',
];

export function createArmorAssemblySequence(mode: AssemblyMode, groups: readonly AssemblyGroupInput[]): ArmorAssemblyStep[] {
  const steps: ArmorAssemblyStep[] = [];
  let smallIndex = 0;

  if (mode === 1) {
    for (const group of groups) {
      for (let partIndex = 0; partIndex < group.partCount; partIndex++) {
        steps.push({
          id: `part:${group.name}:${partIndex}`,
          kind: 'part',
          groupName: group.name,
          partIndex,
          sound: 'small',
          startMs: smallIndex++ * SMALL_STAGGER_MS,
          durationMs: SMALL_DURATION_MS,
        });
      }
    }
  }

  const lastSmall = steps.at(-1);
  const largeStart = lastSmall ? lastSmall.startMs + lastSmall.durationMs + PHASE_GAP_MS : 0;
  const orderedGroups = [...groups].sort((a, b) => LARGE_GROUP_ORDER.indexOf(a.name) - LARGE_GROUP_ORDER.indexOf(b.name));
  orderedGroups.forEach((group, index) => {
    steps.push({
      id: `group:${group.name}`,
      kind: 'group',
      groupName: group.name,
      sound: 'large',
      startMs: largeStart + index * LARGE_STAGGER_MS,
      durationMs: LARGE_DURATION_MS,
    });
  });
  return steps;
}

export class ArmorAssemblyTimeline {
  private readonly steps: readonly ArmorAssemblyStep[];
  private readonly startedAtMs: number;
  private readonly completed = new Set<string>();
  private readonly finishedAtMs: number;

  constructor(steps: readonly ArmorAssemblyStep[], startedAtMs: number) {
    this.steps = steps;
    this.startedAtMs = startedAtMs;
    this.finishedAtMs = steps.reduce((latest, step) => Math.max(latest, step.startMs + step.durationMs), 0);
  }

  sample(nowMs: number): { states: AssemblyStepState[]; completed: ArmorAssemblyStep[]; finished: boolean } {
    const elapsed = Math.max(0, nowMs - this.startedAtMs);
    const completedNow: ArmorAssemblyStep[] = [];
    const states = this.steps.map(step => {
      const linear = Math.max(0, Math.min(1, (elapsed - step.startMs) / step.durationMs));
      const progress = linear * linear * (3 - 2 * linear);
      if (linear >= 1 && !this.completed.has(step.id)) {
        this.completed.add(step.id);
        completedNow.push(step);
      }
      return { step, progress };
    });
    return { states, completed: completedNow, finished: elapsed >= this.finishedAtMs };
  }
}
