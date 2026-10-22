// Visual assembly and particles adapted from the original Jarvis renderer (GPL-3.0).
export function attachWindowsVisuals(root: HTMLElement) {
const $ = <T extends Element>(s: string) => root.querySelector<T>(s)!;
const shell = root;
const state = { mode: 'ready', level: 0 };
type VisualParticle = {
  fromX: number;
  fromY: number;
  targetX: number;
  targetY: number;
  size: number;
  phase: number;
  delay: number;
  curve: number;
  amber: boolean;
  dx: number; dy: number; nx: number; ny: number;
};

const particleCanvas = $("#particle-field") as HTMLCanvasElement;
const particleContext = particleCanvas.getContext("2d")!;
const characterImage = $("#jarvis-character") as HTMLImageElement;
const armorShardLayer = $<HTMLElement>(".armor-shards");
const armorShardSpecs = [
  ["polygon(35% 4%,65% 4%,63% 23%,37% 23%)", 0, -390, -8, 80],
  ["polygon(17% 9%,37% 4%,38% 31%,22% 35%)", -430, -280, -24, 0],
  ["polygon(63% 4%,83% 9%,78% 35%,62% 31%)", 430, -280, 24, 20],
  ["polygon(37% 22%,63% 22%,61% 45%,39% 45%)", 30, -320, 10, 170],
  ["polygon(20% 31%,39% 27%,43% 48%,19% 49%)", -470, -120, -32, 100],
  ["polygon(61% 27%,80% 31%,81% 49%,57% 48%)", 470, -120, 32, 120],
  ["polygon(16% 45%,43% 44%,46% 57%,20% 59%)", -520, -20, -18, 220],
  ["polygon(57% 44%,84% 45%,80% 59%,54% 57%)", 520, -20, 18, 240],
  ["polygon(42% 43%,58% 43%,59% 70%,41% 70%)", 0, 390, -10, 300],
  ["polygon(19% 56%,42% 54%,41% 73%,24% 78%)", -480, 180, -28, 280],
  ["polygon(58% 54%,81% 56%,76% 78%,59% 73%)", 480, 180, 28, 300],
  ["polygon(24% 73%,42% 68%,45% 84%,31% 88%)", -340, 330, 22, 390],
  ["polygon(58% 68%,76% 73%,69% 88%,55% 84%)", 340, 330, -22, 410],
  ["polygon(41% 68%,59% 68%,56% 88%,44% 88%)", 40, 430, 14, 470],
  ["polygon(31% 85%,45% 82%,44% 96%,36% 94%)", -250, 460, -30, 500],
  ["polygon(55% 82%,69% 85%,64% 94%,56% 96%)", 250, 460, 30, 520],
  ["polygon(43% 86%,57% 86%,56% 98%,44% 98%)", 0, 520, -12, 560],
  ["polygon(12% 25%,24% 19%,22% 45%,14% 52%)", -560, -210, -38, 180],
  ["polygon(76% 19%,88% 25%,86% 52%,78% 45%)", 560, -210, 38, 200],
] as const;

for (const [clip, translateX, translateY, rotation, delay] of armorShardSpecs) {
  const shard = document.createElement("i");
  shard.className = "armor-shard";
  shard.style.setProperty("--shard-clip", clip);
  shard.style.setProperty("--shard-x", `${translateX}px`);
  shard.style.setProperty("--shard-y", `${translateY}px`);
  shard.style.setProperty("--shard-rotation", `${rotation}deg`);
  shard.style.setProperty("--shard-delay", `${Math.round(delay * .32)}ms`);
  if (Math.abs(rotation) >= 28 || delay % 3 === 0) shard.classList.add("amber-edge");
  armorShardLayer.append(shard);
}

let visualParticles: VisualParticle[] = [];
let formationStartedAt = -10_000;
let particleTargetBounds = { left: 0, top: 0, width: 1, height: 1 };
const FORMATION_DURATION = 4200;

let formationFrame = 0;

function scatterParticleFromWindowEdge(particle: VisualParticle) {
  const edge = Math.floor(Math.random() * 4);
  const inset = Math.random() * 24;
  if (edge === 0) {
    particle.fromX = inset;
    particle.fromY = Math.random() * particleCanvas.height;
  } else if (edge === 1) {
    particle.fromX = particleCanvas.width - inset;
    particle.fromY = Math.random() * particleCanvas.height;
  } else {
    particle.fromX = Math.random() * particleCanvas.width;
    particle.fromY = edge === 2 ? inset : particleCanvas.height - inset;
  }
  particle.dx = particle.targetX - particle.fromX;
  particle.dy = particle.targetY - particle.fromY;
  const distance = Math.max(1, Math.hypot(particle.dx, particle.dy));
  particle.nx = -particle.dy / distance; particle.ny = particle.dx / distance;
}

function syncParticleCanvasSize() {
  const bounds = shell.getBoundingClientRect();
  const width = Math.max(1, Math.round(bounds.width));
  const height = Math.max(1, Math.round(bounds.height));
  if (particleCanvas.width !== width) particleCanvas.width = width;
  if (particleCanvas.height !== height) particleCanvas.height = height;
}

function prepareVisualParticles() {
  if (!characterImage.naturalWidth) return;
  syncParticleCanvasSize();
  const sample = document.createElement("canvas");
  // Read only a small avatar-sized buffer, never the full monitor.
  const characterBounds = characterImage.getBoundingClientRect();
  const shellBounds = shell.getBoundingClientRect();
  const left = characterBounds.left - shellBounds.left;
  const top = characterBounds.top - shellBounds.top;
  particleTargetBounds = { left, top, width: characterBounds.width, height: characterBounds.height };
  sample.width = 530;
  sample.height = Math.max(1, Math.round(sample.width * characterBounds.height / characterBounds.width));
  const context = sample.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(characterImage, 0, 0, sample.width, sample.height);
  const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
  const candidates: {x: number; y: number}[] = [];
  for (let y = 0; y < sample.height; y += 7) {
    for (let x = 0; x < sample.width; x += 7) {
      if (pixels[(y * sample.width + x) * 4 + 3] >= 46 && Math.random() <= .82) candidates.push({x,y});
    }
  }
  visualParticles = [];
  const count = candidates.length;
  for (let i = 0; i < count; i++) {
    const {x,y} = candidates[Math.floor((i + .5) * candidates.length / count)];
    const particle: VisualParticle = {
      fromX: 0, fromY: 0, dx: 0, dy: 0, nx: 0, ny: 0,
      targetX: left + x / sample.width * characterBounds.width,
      targetY: top + y / sample.height * characterBounds.height,
      size: Math.random() > .965 ? 2.6 + Math.random() * 1.8 : .45 + Math.random() * 1.65, phase: Math.random() * Math.PI * 2,
      delay: Math.random() * .16, curve: (Math.random() - .5) * 180,
      amber: i % 8 === 0,
    };
    scatterParticleFromWindowEdge(particle);
    visualParticles.push(particle);
  }
}

function startParticleFormation() {
  if (!visualParticles.length) prepareVisualParticles();
  formationStartedAt = performance.now();
  for (const particle of visualParticles) scatterParticleFromWindowEdge(particle);
  cancelAnimationFrame(formationFrame);
  formationFrame = requestAnimationFrame(drawParticleField);
}

function easeFormation(value: number) {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * (3 - 2 * clamped);
}

function particlePosition(particle: VisualParticle, progress: number) {
  const eased = easeFormation(progress);
  const bend = Math.sin(eased * Math.PI) * particle.curve;
  return {
    x: particle.fromX + particle.dx * eased + particle.nx * bend,
    y: particle.fromY + particle.dy * eased + particle.ny * bend,
  };
}

function drawFormationEnergy(now: number, rawProgress: number) {
  if (rawProgress < 0 || rawProgress > 1.12) return;
  const progress = Math.max(0, Math.min(1, rawProgress));
  const centerX = particleTargetBounds.left + particleTargetBounds.width / 2;
  const centerY = particleTargetBounds.top + particleTargetBounds.height / 2;
  const intensity = Math.sin(progress * Math.PI);
  const outerRadius = Math.max(particleCanvas.width, particleCanvas.height) * .56;
  const targetRadius = Math.max(particleTargetBounds.width, particleTargetBounds.height) * .48;
  const radius = outerRadius + (targetRadius - outerRadius) * easeFormation(progress);

  particleContext.save();
  particleContext.globalCompositeOperation = "lighter";
  particleContext.translate(centerX, centerY);
  particleContext.scale(1, .72);
  for (let index = 0; index < 2; index += 1) {
    const ringRadius = radius + index * 34;
    particleContext.beginPath();
    particleContext.setLineDash([16 + index * 5, 34 + index * 7]);
    particleContext.lineDashOffset = (index % 2 ? 1 : -1) * now / (12 + index * 3);
    particleContext.arc(0, 0, ringRadius, 0, Math.PI * 2);
    particleContext.lineWidth = index === 0 ? 1.8 : .75;
    particleContext.strokeStyle = index === 2
      ? `rgba(255,155,47,${intensity * .48})`
      : `rgba(34,199,255,${intensity * (.56 - index * .08)})`;
    particleContext.stroke();
  }
  particleContext.restore();

  const shock = Math.max(0, Math.min(1, (progress - .68) / .25));
  if (shock > 0 && shock < 1) {
    particleContext.save();
    particleContext.globalCompositeOperation = "lighter";
    particleContext.beginPath();
    particleContext.ellipse(
      centerX,
      centerY,
      targetRadius * (.65 + shock * 1.35),
      targetRadius * (.48 + shock * .95),
      0,
      0,
      Math.PI * 2,
    );
    particleContext.strokeStyle = `rgba(134,229,255,${(1 - shock) * .85})`;
    particleContext.shadowColor = "#22c7ff";
    particleContext.shadowBlur = 0;
    particleContext.lineWidth = 2.4;
    particleContext.stroke();
    particleContext.restore();
  }
}

function drawParticleField(now: number) {
  particleContext.clearRect(0, 0, particleCanvas.width, particleCanvas.height);
  const rawProgress = (now - formationStartedAt) / FORMATION_DURATION;
  if (rawProgress >= 1 || rawProgress < 0) return;
  const fade = 1 - easeFormation((rawProgress - .70) / .30);
  particleContext.globalCompositeOperation = "lighter";
  particleContext.globalAlpha = fade;
  // Two batched paths replace hundreds of individual canvas draw calls.
  for (const amber of [false, true]) {
    particleContext.beginPath();
    for (const particle of visualParticles) {
      if (particle.amber !== amber) continue;
      const progress = Math.max(0, Math.min(1, (rawProgress - particle.delay) / (1 - particle.delay)));
      const point = particlePosition(particle, progress);
      const previous = particlePosition(particle, Math.max(0, progress - .016));
      particleContext.moveTo(previous.x, previous.y);
      particleContext.lineTo(point.x, point.y);
    }
    particleContext.strokeStyle = amber ? '#ff9b2f99' : '#22c7ff99';
    particleContext.lineWidth = 1;
    particleContext.stroke();
    particleContext.beginPath();
    for (const particle of visualParticles) {
      if (particle.amber !== amber) continue;
      const progress = Math.max(0, Math.min(1, (rawProgress - particle.delay) / (1 - particle.delay)));
      const {x,y} = particlePosition(particle, progress);
      particleContext.moveTo(x + particle.size, y);
      particleContext.arc(x, y, particle.size, 0, Math.PI * 2);
    }
    particleContext.fillStyle = amber ? '#ffb75c' : '#76e1ff';
    particleContext.fill();
  }
  drawFormationEnergy(now, rawProgress);
  particleContext.globalAlpha = 1;
  particleContext.globalCompositeOperation = "source-over";
  formationFrame = requestAnimationFrame(drawParticleField);
}

if (characterImage.complete && characterImage.naturalWidth) prepareVisualParticles();
else characterImage.addEventListener("load", prepareVisualParticles, { once: true });
new ResizeObserver(() => prepareVisualParticles()).observe(shell);


return {
  wake() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    shell.classList.remove('is-forming'); void shell.clientWidth;
    shell.classList.add('is-forming'); startParticleFormation();
  },
  update(mode: string, level: number) {
    state.mode = mode;
    if (Math.abs(state.level - level) < .015) return;
    state.level = level;
    shell.style.setProperty('--voice-pulse', String(1 + level * .026));
    shell.style.setProperty('--voice-glow', String(.45 + level * .55));
  }
};
}
