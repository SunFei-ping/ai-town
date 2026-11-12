/**
 * 主界面小镇 3D 场景（Three.js，本地 vendored，无 CDN）。
 *
 * 数据只来自现有契约：
 * - 居民与 plan_json / tick 返回的 plans
 * - dialogue 的 hour / location / participant_ids / transcript
 *
 * 场景负责把「一天」演成一段低多边形动画：居民按计划移动，
 * 空闲时散步、吃饭、看海、看摊，相遇时出现气泡。
 * 不改变任何业务契约；WebGL 不可用时降级为文字提示。
 */
import * as THREE from '../vendor/three.module.js';
import { locationAt, encounterLocationKey } from '../domain/simulation/encounter.js';

const HOURS = Array.from({ length: 17 }, (_, index) => index + 6);
const STEP_MS = 1200;
const MOVE_RATIO = 0.68;
const MAX_PIXEL_RATIO = 2;

const KNOWN_LOCATIONS = {
  五金店: { x: 4.1, z: 1.7 },
  咖啡店: { x: -3.8, z: -3.4 },
  学校: { x: -4.0, z: 3.2 },
  菜市场: { x: -4.9, z: 0.1 },
  面馆: { x: 3.0, z: -3.9 },
  小卖部: { x: 5.0, z: -2.0 },
  码头: { x: 0.4, z: 6.2 },
  街口: { x: 0, z: 0 },
};

const BEHAVIOR_BY_LOCATION = {
  五金店: 'work',
  咖啡店: 'eat',
  学校: 'study',
  菜市场: 'browse',
  面馆: 'eat',
  小卖部: 'browse',
  码头: 'sea',
  街口: 'stroll',
};

const ACTION_LABELS = {
  stroll: '散步',
  browse: '看摊',
  eat: '吃饭',
  sea: '吹风',
  work: '干活',
  study: '看书',
};

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < String(value).length; index += 1) {
    hash ^= String(value).charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function easeInOut(value) {
  return value < 0.5 ? 2 * value * value : 1 - (-2 * value + 2) ** 2 / 2;
}

function lerpAngle(current, target, ratio) {
  const diff = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
  return current + diff * ratio;
}

function supportsWebGL() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

/** 从设计令牌里读取颜色；解析失败时退回给定色值 */
function readColor(name, fallback) {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const hsl = /^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/.exec(raw);
    if (hsl) {
      return new THREE.Color().setHSL(Number(hsl[1]) / 360, Number(hsl[2]) / 100, Number(hsl[3]) / 100);
    }
    if (raw.startsWith('#')) return new THREE.Color(raw);
  } catch {
    /* 忽略 */
  }
  return new THREE.Color(fallback);
}

function readPalette() {
  return {
    bg: readColor('--color-bg', '#f7f3ea'),
    bgDeep: readColor('--color-bg-deep', '#ece5d9'),
    surface: readColor('--color-surface', '#ffffff'),
    ink: readColor('--color-ink', '#232936'),
    inkSoft: readColor('--color-ink-soft', '#646b78'),
    inkFaint: readColor('--color-ink-faint', '#969ca6'),
    line: readColor('--color-line', '#ddd5c8'),
    accent: readColor('--color-accent', '#32647d'),
    accentSoft: readColor('--color-accent-soft', '#dbe9ef'),
    warn: readColor('--color-warn', '#b24a33'),
    ok: readColor('--color-ok', '#3d7a62'),
  };
}

function makeLabelTexture(text, { color = '#232936', background = 'rgba(255,255,255,0.88)', fontSize = 26 } = {}) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = `600 ${fontSize}px "PingFang SC", "Microsoft YaHei", sans-serif`;
  ctx.font = font;
  const textWidth = Math.ceil(ctx.measureText(text).width);
  const padding = 14;
  const width = textWidth + padding * 2;
  const height = fontSize + padding * 2;
  const ratio = 2;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  ctx.scale(ratio, ratio);
  ctx.font = font;

  ctx.fillStyle = background;
  const radius = height / 2;
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.lineTo(width - radius, 0);
  ctx.quadraticCurveTo(width, 0, width, radius);
  ctx.lineTo(width, height - radius);
  ctx.quadraticCurveTo(width, height, width - radius, height);
  ctx.lineTo(radius, height);
  ctx.quadraticCurveTo(0, height, 0, height - radius);
  ctx.lineTo(0, radius);
  ctx.quadraticCurveTo(0, 0, radius, 0);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, width / 2, height / 2 + 1);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, width, height };
}

function makeLabelSprite(text, palette, options = {}) {
  const { texture, width, height } = makeLabelTexture(text, {
    color: `#${palette.ink.getHexString()}`,
    background: options.background ?? 'rgba(255,255,255,0.88)',
    fontSize: options.fontSize ?? 26,
  });
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  const scale = options.scale ?? 0.0085;
  sprite.scale.set(width * scale, height * scale, 1);
  return sprite;
}

function makeRing(radius, color, opacity = 0.5) {
  const geometry = new THREE.RingGeometry(radius * 0.75, radius, 40);
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(geometry, material);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  return ring;
}

function createFallback(container, message) {
  container.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'town-scene__fallback';
  box.textContent = message;
  container.append(box);
  return {
    supported: false,
    showStatic() {},
    playDay() {},
    destroy() {
      container.innerHTML = '';
    },
    resize() {},
  };
}

export function createTownScene({ container, onSelect } = {}) {
  if (!container) return createFallback(document.createElement('div'), '场景容器不存在');
  if (!supportsWebGL()) {
    return createFallback(container, '当前设备不支持 WebGL，已保留文字版小镇。');
  }

  const palette = readPalette();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 160);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  container.innerHTML = '';
  container.append(renderer.domElement);

  const hud = document.createElement('div');
  hud.className = 'town-scene__hud';
  hud.textContent = '第 0 天';
  const hint = document.createElement('div');
  hint.className = 'town-scene__hint';
  hint.textContent = '拖动旋转 · 滚轮缩放';
  const bubble = document.createElement('div');
  bubble.className = 'town-scene__bubble';
  bubble.hidden = true;
  container.append(hud, hint, bubble);
  container.setAttribute('role', 'img');
  container.setAttribute('aria-label', '小镇 3D 场景');

  const controls = document.createElement('div');
  controls.className = 'town-scene__controls';
  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.textContent = '暂停';
  const speedSelect = document.createElement('select');
  speedSelect.setAttribute('aria-label', '播放速度');
  for (const value of [1, 2, 4]) {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = `${value}x`;
    speedSelect.append(option);
  }
  const timeline = document.createElement('input');
  timeline.type = 'range';
  timeline.min = '0';
  timeline.max = String(HOURS.length - 1);
  timeline.step = '1';
  timeline.value = '0';
  timeline.setAttribute('aria-label', '时间轴');
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.textContent = '重置视角';
  controls.append(toggleBtn, speedSelect, timeline, resetBtn);
  container.append(controls);

  const panel = document.createElement('aside');
  panel.className = 'town-scene__panel';
  panel.hidden = true;
  const panelClose = document.createElement('button');
  panelClose.type = 'button';
  panelClose.className = 'town-scene__panel-close';
  panelClose.textContent = '×';
  panelClose.setAttribute('aria-label', '关闭信息面板');
  const panelTitle = document.createElement('h3');
  const panelMeta = document.createElement('p');
  const panelBody = document.createElement('div');
  const panelActions = document.createElement('div');
  panelActions.className = 'town-scene__panel-actions';
  panel.append(panelClose, panelTitle, panelMeta, panelBody, panelActions);
  container.append(panel);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x8a94a6, 1.4);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(6, 12, 5);
  scene.add(sun);

  const ground = new THREE.Group();
  scene.add(ground);

  const skinColor = new THREE.Color('#e8c4a2');
  const hairColor = new THREE.Color('#2c2a2e');
  const windowColor = palette.accentSoft.clone().lerp(palette.surface, 0.35);
  const windowMaterial = new THREE.MeshLambertMaterial({ color: windowColor });
  const lampMaterial = new THREE.MeshLambertMaterial({ color: palette.warn });
  const sandColor = palette.bg.clone().offsetHSL(-0.02, 0.2, -0.04);
  const woodColor = palette.inkSoft.clone().offsetHSL(0.04, 0.15, -0.05);
  const dayWaterColor = palette.accent.clone();
  const nightWaterColor = palette.accent.clone().offsetHSL(0, 0, -0.16);
  const daySunColor = new THREE.Color('#ffffff');
  const nightSunColor = new THREE.Color('#8fa9d6');

  const steamSources = [];
  const clouds = [];

  /* ------------------------------ 环境 ------------------------------ */

  const waterGeometry = new THREE.PlaneGeometry(80, 80, 48, 48);
  const waterPositions = waterGeometry.attributes.position;
  const water = new THREE.Mesh(
    waterGeometry,
    new THREE.MeshLambertMaterial({
      color: palette.accent,
      transparent: true,
      opacity: 0.4,
      flatShading: true,
    })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = -0.2;
  ground.add(water);

  const sand = new THREE.Mesh(
    new THREE.CircleGeometry(9.7, 64),
    new THREE.MeshLambertMaterial({ color: sandColor })
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.y = -0.02;
  ground.add(sand);

  const island = new THREE.Mesh(
    new THREE.CircleGeometry(8.75, 64),
    new THREE.MeshLambertMaterial({ color: palette.bgDeep })
  );
  island.rotation.x = -Math.PI / 2;
  island.position.y = 0.01;
  ground.add(island);

  const coast = new THREE.Mesh(
    new THREE.TorusGeometry(8.76, 0.055, 8, 64),
    new THREE.MeshLambertMaterial({ color: palette.line })
  );
  coast.rotation.x = -Math.PI / 2;
  coast.position.y = 0.02;
  ground.add(coast);

  const plaza = new THREE.Mesh(
    new THREE.CircleGeometry(1.8, 40),
    new THREE.MeshLambertMaterial({ color: palette.line })
  );
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.y = 0.035;
  ground.add(plaza);

  const plazaInner = new THREE.Mesh(
    new THREE.RingGeometry(1.35, 1.55, 40),
    new THREE.MeshBasicMaterial({ color: palette.accentSoft, transparent: true, opacity: 0.8 })
  );
  plazaInner.rotation.x = -Math.PI / 2;
  plazaInner.position.y = 0.038;
  ground.add(plazaInner);

  for (const direction of [0, Math.PI / 2]) {
    const path = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 15.5),
      new THREE.MeshLambertMaterial({ color: palette.surface })
    );
    path.rotation.x = -Math.PI / 2;
    path.rotation.z = direction;
    path.position.y = 0.028;
    ground.add(path);
  }

  // 草地斑块
  for (let index = 0; index < 26; index += 1) {
    const angle = (index / 26) * Math.PI * 2 + 0.2;
    const radius = 2.8 + (index % 6) * 0.95;
    const patch = new THREE.Mesh(
      new THREE.CircleGeometry(0.22 + (index % 3) * 0.08, 7),
      new THREE.MeshLambertMaterial({
        color: palette.ok,
        transparent: true,
        opacity: 0.14,
      })
    );
    patch.rotation.x = -Math.PI / 2;
    patch.position.set(Math.cos(angle) * radius, 0.032, Math.sin(angle) * radius);
    ground.add(patch);
  }

  // 树与灌木
  for (let index = 0; index < 16; index += 1) {
    const angle = (index / 16) * Math.PI * 2 + 0.35;
    const radius = 7.25 + (index % 3) * 0.22;
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.075, 0.11, 0.6, 6),
      new THREE.MeshLambertMaterial({ color: woodColor })
    );
    trunk.position.y = 0.3;
    const crown =
      index % 3 === 0
        ? new THREE.Mesh(
            new THREE.SphereGeometry(0.42, 8, 6),
            new THREE.MeshLambertMaterial({ color: palette.ok })
          )
        : new THREE.Mesh(
            new THREE.ConeGeometry(0.42, 1.0, 7),
            new THREE.MeshLambertMaterial({ color: palette.ok })
          );
    crown.position.y = index % 3 === 0 ? 1.0 : 1.02;
    tree.add(trunk, crown);
    tree.position.set(Math.cos(angle) * radius, 0.01, Math.sin(angle) * radius);
    tree.scale.setScalar(0.82 + (index % 4) * 0.06);
    ground.add(tree);
  }

  for (let index = 0; index < 12; index += 1) {
    const angle = (index / 12) * Math.PI * 2 + 0.9;
    const radius = 6.6 + (index % 2) * 0.35;
    const bush = new THREE.Mesh(
      new THREE.SphereGeometry(0.2 + (index % 3) * 0.05, 7, 5),
      new THREE.MeshLambertMaterial({ color: palette.ok })
    );
    bush.position.set(Math.cos(angle) * radius, 0.18, Math.sin(angle) * radius);
    bush.scale.y = 0.75;
    ground.add(bush);
  }

  // 礁石
  for (let index = 0; index < 12; index += 1) {
    const angle = (index / 12) * Math.PI * 2 + 0.15;
    const radius = 9.15 + (index % 3) * 0.18;
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.16 + (index % 3) * 0.07, 0),
      new THREE.MeshLambertMaterial({ color: palette.inkFaint })
    );
    rock.position.set(Math.cos(angle) * radius, 0.03, Math.sin(angle) * radius);
    rock.rotation.set(index, index * 0.7, index * 0.3);
    ground.add(rock);
  }

  function addBench(x, z, rotation = 0) {
    const bench = new THREE.Group();
    const seat = new THREE.Mesh(
      new THREE.BoxGeometry(0.95, 0.07, 0.32),
      new THREE.MeshLambertMaterial({ color: woodColor })
    );
    seat.position.y = 0.3;
    const back = new THREE.Mesh(
      new THREE.BoxGeometry(0.95, 0.3, 0.06),
      new THREE.MeshLambertMaterial({ color: woodColor })
    );
    back.position.set(0, 0.47, -0.14);
    for (const side of [-0.35, 0.35]) {
      const leg = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.3, 0.26),
        new THREE.MeshLambertMaterial({ color: palette.inkSoft })
      );
      leg.position.set(side, 0.15, 0);
      bench.add(leg);
    }
    bench.add(seat, back);
    bench.position.set(x, 0.01, z);
    bench.rotation.y = rotation;
    ground.add(bench);
  }

  function addLamp(x, z) {
    const lamp = new THREE.Group();
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.06, 1.35, 6),
      new THREE.MeshLambertMaterial({ color: palette.inkSoft })
    );
    pole.position.y = 0.67;
    const globe = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 10, 8),
      lampMaterial
    );
    globe.position.y = 1.4;
    lamp.add(pole, globe);
    lamp.position.set(x, 0.01, z);
    ground.add(lamp);
  }

  addBench(-2.0, 1.7, Math.PI * 0.1);
  addBench(2.1, -1.6, Math.PI * 0.9);
  addBench(1.9, 2.0, Math.PI * 0.75);
  addLamp(-2.6, 2.8);
  addLamp(2.7, -2.7);
  addLamp(-2.9, -1.2);
  addLamp(2.4, 2.6);

  // 云
  for (let index = 0; index < 4; index += 1) {
    const cloud = new THREE.Group();
    for (let puff = 0; puff < 3; puff += 1) {
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.28 + puff * 0.08, 8, 6),
        new THREE.MeshLambertMaterial({ color: palette.surface, transparent: true, opacity: 0.72 })
      );
      sphere.position.set((puff - 1) * 0.42, (puff % 2) * 0.1, 0);
      cloud.add(sphere);
    }
    const angle = (index / 4) * Math.PI * 2 + 0.6;
    const radius = 5.4 + (index % 2) * 0.6;
    cloud.position.set(
      Math.cos(angle) * radius,
      7.8 + index * 0.4,
      Math.sin(angle) * radius
    );
    cloud.scale.setScalar(0.72 + (index % 3) * 0.08);
    cloud.userData.baseX = cloud.position.x;
    cloud.userData.phase = index * 1.7;
    scene.add(cloud);
    clouds.push(cloud);
  }

  /* ------------------------------ 建筑 ------------------------------ */

  const locationNodes = new Map();
  const townGroup = new THREE.Group();
  const agentGroup = new THREE.Group();
  scene.add(townGroup, agentGroup);
  let dynamicLocationIndex = 0;

  function pointForLocation(key) {
    if (KNOWN_LOCATIONS[key]) {
      return new THREE.Vector3(KNOWN_LOCATIONS[key].x, 0, KNOWN_LOCATIONS[key].z);
    }
    const angle = dynamicLocationIndex * 2.399 + 0.4;
    dynamicLocationIndex += 1;
    const radius = 6.4;
    return new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
  }

  function addContactShadow(group, radius) {
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.08, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.05;
    group.add(shadow);
  }

  function addCrate(parent, x, z, scale = 1) {
    const crate = new THREE.Mesh(
      new THREE.BoxGeometry(0.28 * scale, 0.24 * scale, 0.28 * scale),
      new THREE.MeshLambertMaterial({ color: woodColor })
    );
    crate.position.set(x, (0.24 * scale) / 2 + 0.02, z);
    crate.rotation.y = x * 1.7 + z;
    parent.add(crate);
  }

  function createHouse({ width = 1.5, depth = 1.4, height = 1.35, bodyColor, roofColor, awningColor, windows = 2 }) {
    const group = new THREE.Group();
    addContactShadow(group, Math.max(width, depth) * 0.72);

    const base = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.14, 0.12, depth + 0.14),
      new THREE.MeshLambertMaterial({ color: palette.line })
    );
    base.position.y = 0.06;
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, depth),
      new THREE.MeshLambertMaterial({ color: bodyColor })
    );
    body.position.y = height / 2 + 0.08;
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(Math.max(width, depth) * 0.82, 0.56, 4),
      new THREE.MeshLambertMaterial({ color: roofColor })
    );
    roof.position.y = height + 0.08 + 0.28;
    roof.rotation.y = Math.PI / 4;

    const door = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.5, 0.04),
      new THREE.MeshLambertMaterial({ color: palette.ink })
    );
    door.position.set(0, 0.33, depth / 2 + 0.03);

    const awning = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.9, 0.05, 0.42),
      new THREE.MeshLambertMaterial({ color: awningColor ?? palette.accentSoft })
    );
    awning.position.set(0, height * 0.68 + 0.08, depth / 2 + 0.2);
    awning.rotation.x = -0.24;

    group.add(base, body, roof, door, awning);

    for (let index = 0; index < windows; index += 1) {
      const offset = windows === 1 ? 0 : (index - (windows - 1) / 2) * (width * 0.42);
      const windowMesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.28, 0.24, 0.04),
        windowMaterial
      );
      windowMesh.position.set(offset, height * 0.5 + 0.08, depth / 2 + 0.03);
      group.add(windowMesh);
    }

    if (hashString(`${width}${height}`) % 2 === 0) {
      const chimney = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.38, 0.16),
        new THREE.MeshLambertMaterial({ color: palette.inkFaint })
      );
      chimney.position.set(width * 0.24, height + 0.36, -depth * 0.18);
      group.add(chimney);
    }

    return group;
  }

  function createCafePatio(group) {
    const tableTop = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.28, 0.05, 12),
      new THREE.MeshLambertMaterial({ color: palette.surface })
    );
    tableTop.position.set(-0.95, 0.52, 0.75);
    const leg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.045, 0.5, 6),
      new THREE.MeshLambertMaterial({ color: palette.inkSoft })
    );
    leg.position.set(-0.95, 0.26, 0.75);
    const umbrellaPole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.03, 1.2, 6),
      new THREE.MeshLambertMaterial({ color: palette.inkSoft })
    );
    umbrellaPole.position.set(-0.95, 0.6, 0.75);
    const umbrella = new THREE.Mesh(
      new THREE.ConeGeometry(0.62, 0.28, 8),
      new THREE.MeshLambertMaterial({ color: palette.accentSoft })
    );
    umbrella.position.set(-0.95, 1.18, 0.75);
    group.add(tableTop, leg, umbrellaPole, umbrella);
    addCrate(group, -1.45, 0.55, 0.7);
    addCrate(group, -1.35, 0.85, 0.6);
  }

  function createMarketStalls(group) {
    const stalls = [
      { x: -0.85, z: 0.1, color: palette.accent },
      { x: 0.75, z: 0.25, color: palette.warn },
      { x: -0.05, z: -0.75, color: palette.ok },
    ];
    for (const stall of stalls) {
      const holder = new THREE.Group();
      const canopy = new THREE.Mesh(
        new THREE.BoxGeometry(1.0, 0.06, 0.78),
        new THREE.MeshLambertMaterial({ color: stall.color })
      );
      canopy.position.y = 1.0;
      for (const sx of [-0.42, 0.42]) {
        for (const sz of [-0.32, 0.32]) {
          const pole = new THREE.Mesh(
            new THREE.CylinderGeometry(0.025, 0.035, 1.0, 5),
            new THREE.MeshLambertMaterial({ color: palette.inkSoft })
          );
          pole.position.set(sx, 0.5, sz);
          holder.add(pole);
        }
      }
      const counter = new THREE.Mesh(
        new THREE.BoxGeometry(0.92, 0.1, 0.7),
        new THREE.MeshLambertMaterial({ color: woodColor })
      );
      counter.position.y = 0.56;
      holder.add(canopy, counter);
      for (let item = 0; item < 4; item += 1) {
        const produce = new THREE.Mesh(
          new THREE.SphereGeometry(0.055, 6, 5),
          new THREE.MeshLambertMaterial({
            color: [palette.warn, palette.ok, palette.accentSoft][item % 3],
          })
        );
        produce.position.set(-0.3 + item * 0.18, 0.67, (item % 2) * 0.12 - 0.06);
        holder.add(produce);
      }
      holder.position.set(stall.x, 0, stall.z);
      group.add(holder);
    }
    addContactShadow(group, 1.25);
  }

  function createPier(group) {
    for (let index = 0; index < 8; index += 1) {
      const plank = new THREE.Mesh(
        new THREE.BoxGeometry(0.95, 0.06, 0.28),
        new THREE.MeshLambertMaterial({ color: woodColor })
      );
      plank.position.set(0, 0.04, 0.4 + index * 0.3);
      group.add(plank);
    }
    for (const x of [-0.48, 0.48]) {
      for (const z of [1.1, 2.2]) {
        const post = new THREE.Mesh(
          new THREE.CylinderGeometry(0.055, 0.07, 1.0, 6),
          new THREE.MeshLambertMaterial({ color: palette.inkSoft })
        );
        post.position.set(x, 0.5, z);
        group.add(post);
      }
    }
    const boat = new THREE.Group();
    const hull = new THREE.Mesh(
      new THREE.BoxGeometry(0.95, 0.22, 0.42),
      new THREE.MeshLambertMaterial({ color: palette.accent })
    );
    hull.position.y = 0.11;
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.03, 0.9, 5),
      new THREE.MeshLambertMaterial({ color: palette.inkSoft })
    );
    mast.position.set(0.1, 0.65, 0);
    const sail = new THREE.Mesh(
      new THREE.PlaneGeometry(0.32, 0.55),
      new THREE.MeshLambertMaterial({ color: palette.surface, side: THREE.DoubleSide })
    );
    sail.position.set(0.28, 0.72, 0);
    sail.rotation.y = Math.PI / 2;
    boat.add(hull, mast, sail);
    boat.position.set(1.45, -0.12, 1.9);
    boat.rotation.y = -0.25;
    group.add(boat);
  }

  function createFountain(group) {
    const basin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.95, 0.95, 0.26, 20),
      new THREE.MeshLambertMaterial({ color: palette.line })
    );
    basin.position.y = 0.13;
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(0.78, 20),
      new THREE.MeshLambertMaterial({ color: palette.accent, transparent: true, opacity: 0.55 })
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.27;
    const column = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.16, 0.6, 8),
      new THREE.MeshLambertMaterial({ color: palette.line })
    );
    column.position.y = 0.5;
    const top = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 10, 8),
      new THREE.MeshLambertMaterial({ color: palette.accentSoft })
    );
    top.position.y = 0.86;
    group.add(basin, water, column, top);
  }

  function createSteam(group) {
    for (let index = 0; index < 3; index += 1) {
      const puff = new THREE.Mesh(
        new THREE.SphereGeometry(0.11 + index * 0.03, 7, 5),
        new THREE.MeshBasicMaterial({ color: palette.surface, transparent: true, opacity: 0.35 })
      );
      puff.position.set(0.25 + index * 0.08, 1.9, 0.1);
      group.add(puff);
      steamSources.push({
        mesh: puff,
        baseY: 1.85,
        phase: index / 3,
      });
    }
  }

  function addLocationNode(key, label, { agentIndex = 0, privateHome = false } = {}) {
    if (locationNodes.has(key)) return locationNodes.get(key);
    const point = privateHome
      ? new THREE.Vector3(
          Math.cos((agentIndex / 5) * Math.PI * 2 + 0.6) * 7.15,
          0,
          Math.sin((agentIndex / 5) * Math.PI * 2 + 0.6) * 7.15
        )
      : pointForLocation(key);

    const node = new THREE.Group();
    node.position.copy(point);

    if (key === '街口') {
      createFountain(node);
    } else if (key === '码头') {
      createPier(node);
    } else if (key === '菜市场') {
      createMarketStalls(node);
    } else if (key === '面馆') {
      node.add(
        createHouse({
          width: 1.6,
          depth: 1.35,
          height: 1.25,
          bodyColor: palette.warn,
          roofColor: palette.accentSoft,
          awningColor: palette.warn,
          windows: 2,
        })
      );
      const lanternMaterial = lampMaterial;
      for (const x of [-0.55, 0.55]) {
        const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), lanternMaterial);
        lantern.position.set(x, 1.15, 0.72);
        node.add(lantern);
      }
      createSteam(node);
      addCrate(node, -1.0, 0.62, 0.8);
    } else if (key === '咖啡店') {
      node.add(
        createHouse({
          width: 1.5,
          depth: 1.35,
          height: 1.3,
          bodyColor: palette.accent,
          roofColor: palette.accentSoft,
          awningColor: palette.accentSoft,
          windows: 2,
        })
      );
      createCafePatio(node);
    } else if (key === '学校') {
      node.add(
        createHouse({
          width: 1.7,
          depth: 1.45,
          height: 1.55,
          bodyColor: palette.ok,
          roofColor: palette.accentSoft,
          awningColor: palette.ok,
          windows: 3,
        })
      );
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.04, 1.9, 6),
        new THREE.MeshLambertMaterial({ color: palette.inkSoft })
      );
      pole.position.set(-0.95, 0.95, 0.7);
      const flag = new THREE.Mesh(
        new THREE.PlaneGeometry(0.42, 0.26),
        new THREE.MeshLambertMaterial({ color: palette.warn, side: THREE.DoubleSide })
      );
      flag.position.set(-0.73, 1.68, 0.7);
      node.add(pole, flag);
    } else if (key === '五金店') {
      node.add(
        createHouse({
          width: 1.65,
          depth: 1.4,
          height: 1.35,
          bodyColor: palette.accent,
          roofColor: palette.inkFaint,
          awningColor: palette.accentSoft,
          windows: 2,
        })
      );
      addCrate(node, -0.95, 0.65, 1.0);
      addCrate(node, -0.6, 0.75, 0.8);
      addCrate(node, 0.95, 0.6, 0.7);
    } else if (key === '小卖部') {
      node.add(
        createHouse({
          width: 1.25,
          depth: 1.2,
          height: 1.1,
          bodyColor: palette.inkFaint,
          roofColor: palette.accentSoft,
          awningColor: palette.warn,
          windows: 1,
        })
      );
      addCrate(node, 0.75, 0.55, 0.8);
      addCrate(node, 0.95, 0.45, 0.6);
    } else if (privateHome) {
      const house = createHouse({
        width: 0.9,
        depth: 0.85,
        height: 0.8,
        bodyColor: palette.bgDeep,
        roofColor: palette.line,
        awningColor: palette.line,
        windows: 1,
      });
      node.add(house);
    } else {
      node.add(
        createHouse({
          width: 1.35,
          depth: 1.25,
          height: 1.15,
          bodyColor: palette.inkFaint,
          roofColor: palette.accentSoft,
          awningColor: palette.accentSoft,
          windows: 2,
        })
      );
    }

    if (!privateHome) {
      const labelSprite = makeLabelSprite(label, palette, {
        fontSize: 24,
        scale: 0.008,
        background: 'rgba(255,255,255,0.9)',
      });
      labelSprite.position.y = 2.35;
      node.add(labelSprite);
    }

    townGroup.add(node);
    node.userData.locationKey = key;
    node.userData.locationLabel = label;
    locationNodes.set(key, { point, node, label });
    return locationNodes.get(key);
  }

  /* ------------------------------ 居民 ------------------------------ */

  const agentViews = new Map();

  function createAgentModel(agent, index) {
    const color = palette.accent.clone().offsetHSL((index * 0.13) % 1, 0.03, 0.04);
    const bodyMaterial = new THREE.MeshLambertMaterial({ color });
    const skinMaterial = new THREE.MeshLambertMaterial({ color: skinColor });
    const hairMaterial = new THREE.MeshLambertMaterial({ color: hairColor });
    const pantsMaterial = new THREE.MeshLambertMaterial({ color: palette.inkSoft });

    const root = new THREE.Group();

    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.21, 0.48, 10), bodyMaterial);
    torso.position.y = 0.74;
    if (index % 2 === 1) {
      const bag = new THREE.Mesh(
        new THREE.BoxGeometry(0.26, 0.3, 0.12),
        new THREE.MeshLambertMaterial({ color: palette.accentSoft })
      );
      bag.position.set(0, 0.78, -0.2);
      root.add(bag);
    }

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.08, 8), skinMaterial);
    neck.position.y = 1.0;

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 12), skinMaterial);
    head.position.y = 1.12;

    const hairMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.178, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.6),
      hairMaterial
    );
    hairMesh.position.y = 1.14;
    hairMesh.rotation.x = -0.08;

    const eyeGeometry = new THREE.SphereGeometry(0.017, 6, 6);
    const eyeMaterial = new THREE.MeshBasicMaterial({ color: palette.ink });
    for (const x of [-0.055, 0.055]) {
      const eye = new THREE.Mesh(eyeGeometry, eyeMaterial);
      eye.position.set(x, 1.13, 0.155);
      root.add(eye);
    }

    const armGeometry = new THREE.CylinderGeometry(0.05, 0.06, 0.36, 6);
    armGeometry.translate(0, -0.18, 0);
    const leftArm = new THREE.Group();
    leftArm.position.set(-0.22, 0.9, 0);
    leftArm.add(new THREE.Mesh(armGeometry, bodyMaterial));
    leftArm.rotation.z = 0.1;
    const rightArm = new THREE.Group();
    rightArm.position.set(0.22, 0.9, 0);
    rightArm.add(new THREE.Mesh(armGeometry, bodyMaterial));
    rightArm.rotation.z = -0.1;

    const legGeometry = new THREE.CylinderGeometry(0.065, 0.075, 0.34, 6);
    legGeometry.translate(0, -0.17, 0);
    const leftLeg = new THREE.Group();
    leftLeg.position.set(-0.09, 0.42, 0);
    leftLeg.add(new THREE.Mesh(legGeometry, pantsMaterial));
    const rightLeg = new THREE.Group();
    rightLeg.position.set(0.09, 0.42, 0);
    rightLeg.add(new THREE.Mesh(legGeometry, pantsMaterial));

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.3, 18),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.12, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.015;

    // 吃饭道具
    const bowl = new THREE.Group();
    const bowlBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.09, 0.07, 10),
      new THREE.MeshLambertMaterial({ color: palette.surface })
    );
    bowlBody.position.y = 0.035;
    const food = new THREE.Mesh(
      new THREE.SphereGeometry(0.085, 8, 6),
      new THREE.MeshLambertMaterial({ color: palette.warn })
    );
    food.position.y = 0.09;
    food.scale.y = 0.55;
    bowl.add(bowlBody, food);
    bowl.position.set(0, 0.42, 0.32);
    bowl.visible = false;

    const cup = new THREE.Group();
    const cupBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.045, 0.1, 8),
      new THREE.MeshLambertMaterial({ color: palette.surface })
    );
    cupBody.position.y = 0.05;
    cup.add(cupBody);
    cup.position.set(0.16, 0.42, 0.28);
    cup.visible = false;

    const label = makeLabelSprite(agent.name, palette, {
      fontSize: 24,
      scale: 0.0068,
      background: 'rgba(255,255,255,0.85)',
    });
    label.position.y = 1.7;

    const actionSprites = {};
    for (const [behavior, text] of Object.entries(ACTION_LABELS)) {
      const sprite = makeLabelSprite(text, palette, {
        fontSize: 16,
        scale: 0.0045,
        background: 'rgba(219,233,239,0.94)',
      });
      sprite.position.y = 1.32;
      sprite.visible = false;
      root.add(sprite);
      actionSprites[behavior] = sprite;
    }

    root.add(torso, neck, head, hairMesh, leftArm, rightArm, leftLeg, rightLeg, shadow, bowl, cup, label);
    root.userData = {
      agentId: agent.id,
      phase: index * 1.7,
      behavior: 'idle',
      foodType: null,
      from: new THREE.Vector3(0, 0, 3),
      to: new THREE.Vector3(0, 0, 3),
      base: new THREE.Vector3(0, 0, 3),
      targetFacing: index * 1.2,
      torso,
      head,
      hair: hairMesh,
      leftArm,
      rightArm,
      leftLeg,
      rightLeg,
      bowl,
      cup,
      actionSprites,
      currentAction: null,
    };
    root.position.copy(root.userData.base);
    root.scale.setScalar(1.12);
    agentGroup.add(root);
    agentViews.set(agent.id, root);
    return root;
  }

  function addAgent(agent, index) {
    if (agentViews.has(agent.id)) return agentViews.get(agent.id);
    return createAgentModel(agent, index);
  }

  function agentOffsetPoint(agentId, key, index) {
    const base = locationNodes.get(key)?.point ?? pointForLocation(key);
    const angle = index * 2.399 + (hashString(key) % 100) / 100;
    const radius = key.startsWith('__private__') ? 0.6 : key === '街口' ? 2.2 : 1.55;
    return new THREE.Vector3(base.x + Math.cos(angle) * radius, 0, base.z + Math.sin(angle) * radius);
  }

  function behaviorForKey(key) {
    if (!key || key.startsWith('__private__')) return 'idle';
    return BEHAVIOR_BY_LOCATION[key] ?? 'stroll';
  }

  function buildHourStates({ agents, plans }) {
    const planByAgent = new Map((plans ?? []).map((entry) => [entry.agent_id, entry.plan ?? []]));
    return HOURS.map((hour) => {
      const state = new Map();
      agents.forEach((agent, index) => {
        addAgent(agent, index);
        const plan = planByAgent.get(agent.id) ?? [];
        const segment = locationAt(plan, hour) ?? plan[0] ?? null;
        if (!segment?.location) {
          const key = '街口';
          addLocationNode(key, '街口');
          state.set(agent.id, {
            point: agentOffsetPoint(agent.id, key, index),
            key,
            location: '街口',
          });
          return;
        }
        const key = encounterLocationKey(agent.id, segment.location);
        const privateHome = key.startsWith('__private__');
        addLocationNode(key, segment.location, { agentIndex: index, privateHome });
        state.set(agent.id, {
          point: agentOffsetPoint(agent.id, key, index),
          key,
          location: segment.location,
        });
      });
      return state;
    });
  }

  function setAgentTarget(view, entry, { teleport = false } = {}) {
    const data = view.userData;
    const point = entry?.point ?? data.to;
    data.from.copy(teleport ? point : data.base);
    data.to.copy(point);
    data.base.copy(point);
    data.behavior = behaviorForKey(entry?.key);
    data.foodType =
      entry?.key === '面馆' ? 'noodle' : entry?.key === '咖啡店' ? 'coffee' : null;
    if (entry?.key === '码头') {
      data.targetFacing = 0;
    } else if (entry?.key === '面馆' || entry?.key === '咖啡店') {
      data.targetFacing = 0;
    } else if (entry?.key === '街口') {
      data.targetFacing = data.phase;
    } else {
      const nodePoint = locationNodes.get(entry?.key)?.point;
      data.targetFacing = nodePoint
        ? Math.atan2(nodePoint.x - point.x, nodePoint.z - point.z)
        : data.phase;
    }
    if (teleport) view.position.copy(point);
  }

  function applyState(state) {
    for (const [agentId, view] of agentViews) {
      const entry = state.get(agentId);
      if (!entry) continue;
      setAgentTarget(view, entry, { teleport: true });
      view.rotation.y = view.userData.targetFacing;
    }
  }

  /* ------------------------------ 播放状态 ------------------------------ */

  let day = 0;
  let playing = false;
  let hourIndex = 0;
  let elapsed = 0;
  let fromState = null;
  let toState = null;
  let states = [];
  let dialoguesByHour = new Map();
  let agentNames = new Map();
  let animationFrame = null;
  let lastFrame = 0;
  let visible = true;
  let bubbleTimer = null;
  const pulses = [];
  let sceneData = { agents: [], plans: [], dialogues: [], day: 0 };
  let plansByAgent = new Map();
  let selected = null;
  let speed = 1;
  let displayHour = HOURS[0];
  let currentBubbleDialogue = null;

  const selectionRing = makeRing(0.62, palette.warn, 0.85);
  selectionRing.visible = false;
  scene.add(selectionRing);

  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  function setHud(hour) {
    hud.textContent =
      hour !== null
        ? `${String(hour).padStart(2, '0')}:00 · 第 ${day} 天`
        : `第 ${day} 天`;
  }

  function showBubble(text) {
    bubble.textContent = text;
    bubble.hidden = false;
    if (bubbleTimer) clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => {
      bubble.hidden = true;
    }, 2400);
  }

  function pulseAt(point) {
    const ring = makeRing(0.7, palette.accent, 0.65);
    ring.position.set(point.x, 0.04, point.z);
    scene.add(ring);
    pulses.push({ mesh: ring, time: 0 });
  }

  function triggerDialogues(hour) {
    const list = dialoguesByHour.get(hour) ?? [];
    if (list.length === 0) {
      currentBubbleDialogue = null;
      return;
    }
    const dialogue = list[0];
    currentBubbleDialogue = dialogue;
    const names = (dialogue.participant_ids ?? [])
      .map((id) => agentNames.get(id))
      .filter(Boolean);
    const firstLine = dialogue.transcript?.[0]?.content ?? '';
    const prefix = names.length > 0 ? `${names.join('和')}在${dialogue.location}：` : `${dialogue.location}：`;
    showBubble(`${prefix}${firstLine.slice(0, 42)}${firstLine.length > 42 ? '…' : ''}`);
    const point = agentViews.get(dialogue.participant_ids?.[0])?.position;
    if (point) pulseAt(point);
  }

  /* ------------------------------ 信息面板与交互 ------------------------------ */

  function makeParagraph(text) {
    const p = document.createElement('p');
    p.textContent = text;
    return p;
  }

  function makeList(items) {
    const ul = document.createElement('ul');
    for (const text of items) {
      const li = document.createElement('li');
      li.textContent = text;
      ul.append(li);
    }
    return ul;
  }

  function currentEntry(agentId) {
    const plan = plansByAgent.get(agentId) ?? [];
    const segment = locationAt(plan, displayHour) ?? plan[plan.length - 1] ?? null;
    if (!segment?.location) return { key: '街口', location: '街口' };
    return { key: encounterLocationKey(agentId, segment.location), location: segment.location };
  }

  function updatePanel() {
    if (!selected) {
      panel.hidden = true;
      selectionRing.visible = false;
      return;
    }
    panel.hidden = false;
    panelBody.replaceChildren();
    panelActions.replaceChildren();

    if (selected.type === 'agent') {
      const agent = sceneData.agents.find((item) => item.id === selected.id);
      if (!agent) {
        clearSelection();
        return;
      }
      const entry = currentEntry(agent.id);
      const behavior = behaviorForKey(entry.key);
      panelTitle.textContent = agent.name;
      panelMeta.textContent = `${agent.age ?? ''} 岁 · ${agent.occupation ?? ''}`;
      panelBody.append(
        makeParagraph(`现在在 ${entry.location} · ${ACTION_LABELS[behavior] ?? '发呆'}`)
      );

      const plan = plansByAgent.get(agent.id) ?? [];
      if (plan.length > 0) {
        panelBody.append(makeParagraph('今日计划'));
        panelBody.append(
          makeList(
            plan.map(
              (item) =>
                `${String(item.hour).padStart(2, '0')}:00 ${item.location} — ${item.intent}`
            )
          )
        );
      }

      const talks = (sceneData.dialogues ?? []).filter((dialogue) =>
        dialogue.participant_ids?.includes(agent.id)
      );
      if (talks.length > 0) {
        panelBody.append(makeParagraph('今天说过的话'));
        panelBody.append(
          makeList(
            talks.map((dialogue) => {
              const firstLine = dialogue.transcript?.[0]?.content ?? '';
              return `${String(dialogue.hour).padStart(2, '0')}:00 ${dialogue.location}：${firstLine}`;
            })
          )
        );
      }

      const followBtn = document.createElement('button');
      followBtn.type = 'button';
      followBtn.textContent = '镜头跟随';
      followBtn.addEventListener('click', () => {
        camera.userData.focusAgentId = agent.id;
        camera.userData.radius = Math.min(camera.userData.radius, 11);
        updateCamera();
      });
      panelActions.append(followBtn);
      return;
    }

    if (selected.type === 'location') {
      const node = locationNodes.get(selected.key);
      panelTitle.textContent = node?.label ?? selected.key;
      panelMeta.textContent = `第 ${day} 天 · ${String(displayHour).padStart(2, '0')}:00`;
      const here = sceneData.agents.filter((agent) => currentEntry(agent.id).key === selected.key);
      panelBody.append(
        makeParagraph(
          here.length > 0
            ? `现在在这里：${here.map((agent) => agent.name).join('、')}`
            : '现在没有人在这里'
        )
      );

      const talks = (sceneData.dialogues ?? []).filter(
        (dialogue) =>
          node && encounterLocationKey('', dialogue.location) === encounterLocationKey('', node.label)
      );
      if (talks.length > 0) {
        panelBody.append(makeParagraph('今天这里发生过的对话'));
        panelBody.append(
          makeList(
            talks.map((dialogue) => {
              const firstLine = dialogue.transcript?.[0]?.content ?? '';
              return `${String(dialogue.hour).padStart(2, '0')}:00 ${firstLine}`;
            })
          )
        );
      }

      const visitors = sceneData.agents.filter((agent) =>
        (plansByAgent.get(agent.id) ?? []).some(
          (segment) => encounterLocationKey(agent.id, segment.location) === selected.key
        )
      );
      if (visitors.length > 0) {
        panelBody.append(
          makeParagraph(`今天来过：${visitors.map((agent) => agent.name).join('、')}`)
        );
      }

      const focusBtn = document.createElement('button');
      focusBtn.type = 'button';
      focusBtn.textContent = '镜头聚焦';
      focusBtn.addEventListener('click', () => {
        if (!node) return;
        camera.userData.focusAgentId = null;
        camera.userData.focusPoint.set(node.point.x, 1.1, node.point.z);
        camera.userData.radius = Math.min(camera.userData.radius, 13);
        updateCamera();
      });
      panelActions.append(focusBtn);
      return;
    }

    if (selected.type === 'dialogue') {
      const dialogue = selected.dialogue;
      panelTitle.textContent = `${dialogue.location} · ${String(dialogue.hour).padStart(2, '0')}:00`;
      panelMeta.textContent = (dialogue.participant_ids ?? [])
        .map((id) => agentNames.get(id))
        .filter(Boolean)
        .join('、');
      panelBody.append(
        makeList(
          (dialogue.transcript ?? []).map((round) => `${round.speaker}：${round.content}`)
        )
      );
    }
  }

  function selectAgent(id) {
    selected = { type: 'agent', id };
    selectionRing.visible = true;
    camera.userData.focusAgentId = id;
    camera.userData.radius = Math.min(camera.userData.radius, 11);
    updatePanel();
    updateCamera();
    onSelect?.({ type: 'agent', id });
  }

  function selectLocation(key) {
    selected = { type: 'location', key };
    selectionRing.visible = true;
    camera.userData.focusAgentId = null;
    const node = locationNodes.get(key);
    if (node) {
      camera.userData.focusPoint.set(node.point.x, 1.1, node.point.z);
      camera.userData.radius = Math.min(camera.userData.radius, 13);
      updateCamera();
    }
    updatePanel();
    onSelect?.({ type: 'location', key });
  }

  function clearSelection() {
    selected = null;
    panel.hidden = true;
    selectionRing.visible = false;
    camera.userData.focusAgentId = null;
    camera.userData.focusPoint.set(0, 1.15, 0);
    updateCamera();
    onSelect?.(null);
  }

  function resetView() {
    clearSelection();
    camera.userData.radius = container.clientWidth < 520 ? 24 : 18.5;
    camera.userData.theta = Math.PI / 4;
    camera.userData.phi = 1.05;
    camera.userData.focusPoint.set(0, 1.15, 0);
    updateCamera();
  }

  function pause() {
    playing = false;
    toggleBtn.textContent = '继续';
  }

  function resume() {
    if (sceneData.agents.length === 0) return;
    if (hourIndex >= states.length - 1) {
      playDay(sceneData);
      return;
    }
    playing = true;
    lastFrame = 0;
    toggleBtn.textContent = '暂停';
  }

  function jumpToHour(index) {
    if (states.length === 0) return;
    const clamped = clamp(index, 0, states.length - 1);
    playing = false;
    hourIndex = clamped;
    displayHour = HOURS[clamped];
    elapsed = 0;
    fromState = states[clamped];
    toState = states[clamped];
    applyState(states[clamped]);
    setHud(displayHour);
    timeline.value = String(clamped);
    toggleBtn.textContent = '播放';
    triggerDialogues(displayHour);
    updatePanel();
  }

  function smoothstep(edge0, edge1, value) {
    const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function updateLighting(hour) {
    const daylight = smoothstep(6.5, 8.5, hour) * (1 - smoothstep(17, 19.5, hour));
    sun.intensity = 0.35 + daylight * 1.2;
    sun.color.copy(nightSunColor).lerp(daySunColor, daylight);
    hemi.intensity = 0.85 + daylight * 0.6;
    water.material.color.copy(nightWaterColor).lerp(dayWaterColor, daylight);
    const glow = 1 - daylight;
    windowMaterial.emissive.setRGB(0.95 * glow, 0.72 * glow, 0.38 * glow);
    lampMaterial.emissive.setRGB(0.8 * glow, 0.55 * glow, 0.2 * glow);
  }

  toggleBtn.addEventListener('click', () => {
    if (playing) pause();
    else resume();
  });
  speedSelect.addEventListener('change', () => {
    speed = Number(speedSelect.value) || 1;
  });
  timeline.addEventListener('input', () => jumpToHour(Number(timeline.value)));
  resetBtn.addEventListener('click', resetView);
  panelClose.addEventListener('click', clearSelection);
  bubble.addEventListener('click', () => {
    if (!currentBubbleDialogue) return;
    selected = { type: 'dialogue', dialogue: currentBubbleDialogue };
    selectionRing.visible = false;
    updatePanel();
    panel.hidden = false;
    onSelect?.({ type: 'dialogue' });
  });

  function stepTo(nextIndex) {
    if (nextIndex >= states.length) {
      playing = false;
      displayHour = HOURS[HOURS.length - 1];
      timeline.value = String(HOURS.length - 1);
      toggleBtn.textContent = '重播';
      setHud(null);
      updatePanel();
      return;
    }
    hourIndex = nextIndex;
    fromState = states[Math.max(0, hourIndex - 1)] ?? states[0];
    toState = states[hourIndex];
    for (const [agentId, view] of agentViews) {
      const fromEntry = fromState.get(agentId);
      const toEntry = toState.get(agentId);
      if (!toEntry) continue;
      const data = view.userData;
      data.from.copy(fromEntry?.point ?? data.base);
      data.to.copy(toEntry.point);
      data.behavior = behaviorForKey(toEntry.key);
      data.foodType =
        toEntry.key === '面馆' ? 'noodle' : toEntry.key === '咖啡店' ? 'coffee' : null;
      const dx = data.to.x - data.from.x;
      const dz = data.to.z - data.from.z;
      if (Math.hypot(dx, dz) > 0.2) {
        data.targetFacing = Math.atan2(dx, dz);
      } else if (toEntry.key === '码头' || toEntry.key === '面馆' || toEntry.key === '咖啡店') {
        data.targetFacing = 0;
      } else if (toEntry.key === '街口') {
        data.targetFacing = data.phase;
      } else {
        const nodePoint = locationNodes.get(toEntry.key)?.point;
        data.targetFacing = nodePoint
          ? Math.atan2(nodePoint.x - data.to.x, nodePoint.z - data.to.z)
          : data.phase;
      }
    }
    elapsed = 0;
    displayHour = HOURS[hourIndex];
    timeline.value = String(hourIndex);
    setHud(HOURS[hourIndex]);
    triggerDialogues(HOURS[hourIndex]);
    updatePanel();
  }

  function behaviorOffset(behavior, time, phase) {
    if (behavior === 'stroll') {
      return { x: Math.sin(time * 0.55 + phase) * 0.32, z: Math.cos(time * 0.42 + phase) * 0.26 };
    }
    if (behavior === 'browse') {
      return { x: Math.sin(time * 0.9 + phase) * 0.16, z: 0 };
    }
    if (behavior === 'idle') {
      return { x: Math.sin(time * 0.4 + phase) * 0.05, z: Math.cos(time * 0.35 + phase) * 0.05 };
    }
    return { x: 0, z: 0 };
  }

  function animateAgent(view, behavior, { moving, time }) {
    const data = view.userData;
    const phase = data.phase;
    const swing = Math.sin(time * 7 + phase);
    const amplitude = moving ? 0.55 : behavior === 'stroll' ? 0.3 : 0;

    data.torso.rotation.set(0, 0, 0);
    data.head.rotation.set(0, 0, 0);
    data.leftLeg.rotation.x = swing * amplitude;
    data.rightLeg.rotation.x = -swing * amplitude;
    data.leftArm.rotation.x = -swing * amplitude * 0.8;
    data.rightArm.rotation.x = swing * amplitude * 0.8;
    data.leftArm.rotation.z = 0.1;
    data.rightArm.rotation.z = -0.1;
    data.torso.position.y = 0.74 + (moving ? Math.abs(swing) * 0.025 : Math.sin(time * 1.8 + phase) * 0.008);
    data.bowl.visible = false;
    data.cup.visible = false;

    if (behavior === 'eat') {
      const lift = (Math.sin(time * 3.2 + phase) + 1) / 2;
      data.leftArm.rotation.x = -1.0 - lift * 0.2;
      data.rightArm.rotation.x = -1.2 - lift * 0.5;
      data.leftArm.rotation.z = 0.28;
      data.rightArm.rotation.z = -0.28;
      data.head.rotation.x = 0.04 + lift * 0.12;
      data.bowl.visible = data.foodType === 'noodle';
      data.cup.visible = data.foodType === 'coffee';
    } else if (behavior === 'sea') {
      data.leftArm.rotation.x = 0.12 + Math.sin(time * 0.8 + phase) * 0.05;
      data.rightArm.rotation.x = 0.12 + Math.cos(time * 0.7 + phase) * 0.05;
      data.head.rotation.x = -0.08;
      data.torso.rotation.z = Math.sin(time * 0.6 + phase) * 0.03;
    } else if (behavior === 'browse') {
      data.head.rotation.y = Math.sin(time * 1.2 + phase) * 0.55;
      data.torso.rotation.y = Math.sin(time * 0.9 + phase) * 0.08;
    } else if (behavior === 'work') {
      data.rightArm.rotation.x = -0.8 + Math.sin(time * 6 + phase) * 0.5;
      data.torso.rotation.x = 0.03;
    } else if (behavior === 'study') {
      data.head.rotation.x = 0.12;
    } else if (behavior === 'stroll') {
      data.head.rotation.y = Math.sin(time * 0.7 + phase) * 0.25;
    }

    const action = behavior === 'walk' ? null : behavior;
    if (data.currentAction !== action) {
      for (const [key, sprite] of Object.entries(data.actionSprites)) {
        sprite.visible = key === action;
      }
      data.currentAction = action;
    }
  }

  function updateCamera() {
    const radius = camera.userData.radius ?? 18.5;
    const theta = camera.userData.theta ?? Math.PI / 4;
    const phi = camera.userData.phi ?? 1.05;
    const target = camera.userData.focusPoint ?? new THREE.Vector3(0, 1.15, 0);
    camera.position.set(
      target.x + radius * Math.sin(phi) * Math.sin(theta),
      target.y + radius * Math.cos(phi),
      target.z + radius * Math.sin(phi) * Math.cos(theta)
    );
    camera.lookAt(target);
  }

  function renderFrame(now) {
    animationFrame = requestAnimationFrame(renderFrame);
    if (!visible) return;
    const delta = now - (lastFrame || now);
    lastFrame = now;
    const time = now / 1000;

    // 海面波动
    for (let index = 0; index < waterPositions.count; index += 1) {
      const x = waterPositions.getX(index);
      const y = waterPositions.getY(index);
      const wave =
        Math.sin(x * 0.55 + time * 1.1) * 0.035 + Math.cos(y * 0.65 + time * 0.8) * 0.025;
      waterPositions.setZ(index, wave);
    }
    waterPositions.needsUpdate = true;

    // 云漂移
    for (const cloud of clouds) {
      cloud.position.x = cloud.userData.baseX + Math.sin(time * 0.08 + cloud.userData.phase) * 1.8;
      cloud.rotation.y = time * 0.02 + cloud.userData.phase;
    }

    // 面馆蒸汽
    for (const steam of steamSources) {
      const progress = (time * 0.32 + steam.phase) % 1;
      steam.mesh.position.y = steam.baseY + progress * 0.9;
      steam.mesh.material.opacity = 0.32 * (1 - progress);
    }

    if (playing && fromState && toState) {
      elapsed += delta * speed;
      const raw = Math.min(1, elapsed / STEP_MS);
      const moveProgress = Math.min(1, raw / MOVE_RATIO);
      const eased = easeInOut(moveProgress);

      for (const [agentId, view] of agentViews) {
        const data = view.userData;
        const targetEntry = toState.get(agentId);
        if (!targetEntry) continue;
        const targetPoint = targetEntry.point;
        const distance = data.from.distanceTo(targetPoint);
        if (distance > 0.2 && raw < MOVE_RATIO) {
          data.targetFacing = Math.atan2(targetPoint.x - data.from.x, targetPoint.z - data.from.z);
        }
        data.base.lerpVectors(data.from, targetPoint, eased);
        const moving = distance > 0.2 && raw < MOVE_RATIO;
        const offset = moving ? { x: 0, z: 0 } : behaviorOffset(data.behavior, time, data.phase);
        view.position.set(data.base.x + offset.x, 0, data.base.z + offset.z);
        view.rotation.y = lerpAngle(view.rotation.y, data.targetFacing, Math.min(1, delta / 280));
        animateAgent(view, moving ? 'walk' : data.behavior, { moving, time });
      }

      if (raw >= 1) stepTo(hourIndex + 1);
    } else {
      for (const view of agentViews.values()) {
        const data = view.userData;
        const offset = behaviorOffset(data.behavior, time, data.phase);
        view.position.set(data.base.x + offset.x, 0, data.base.z + offset.z);
        view.rotation.y = lerpAngle(view.rotation.y, data.targetFacing, Math.min(1, delta / 320));
        animateAgent(view, data.behavior, { moving: false, time });
      }
    }

    const continuousHour = playing
      ? Math.min(22, HOURS[hourIndex] + (elapsed / STEP_MS) * (HOURS[1] - HOURS[0]))
      : displayHour;
    updateLighting(continuousHour);

    if (selected?.type === 'agent') {
      const view = agentViews.get(selected.id);
      if (view) {
        selectionRing.position.set(view.position.x, 0.06, view.position.z);
        selectionRing.visible = true;
        selectionRing.scale.setScalar(1 + Math.sin(time * 3) * 0.08);
      }
    } else if (selected?.type === 'location') {
      const node = locationNodes.get(selected.key);
      if (node) {
        selectionRing.position.set(node.point.x, 0.06, node.point.z);
        selectionRing.visible = true;
        selectionRing.scale.setScalar(1 + Math.sin(time * 3) * 0.08);
      }
    } else {
      selectionRing.visible = false;
    }

    if (camera.userData.focusAgentId) {
      const view = agentViews.get(camera.userData.focusAgentId);
      if (view) {
        camera.userData.focusPoint.lerp(
          new THREE.Vector3(view.position.x, 1.1, view.position.z),
          Math.min(1, delta / 260)
        );
        updateCamera();
      }
    }

    for (let index = pulses.length - 1; index >= 0; index -= 1) {
      const pulse = pulses[index];
      pulse.time += delta / 900;
      const scale = 1 + pulse.time * 2.4;
      pulse.mesh.scale.setScalar(scale);
      pulse.mesh.material.opacity = Math.max(0, 0.65 * (1 - pulse.time));
      if (pulse.time >= 1) {
        scene.remove(pulse.mesh);
        pulse.mesh.geometry.dispose();
        pulse.mesh.material.dispose();
        pulses.splice(index, 1);
      }
    }

    renderer.render(scene, camera);
  }

  function resize() {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (!camera.userData.fitted) {
      camera.userData.fitted = true;
      camera.userData.radius = width < 520 ? 24 : 18.5;
      updateCamera();
    }
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);

  const visibilityObserver = new IntersectionObserver(
    (entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      if (visible) lastFrame = 0;
    },
    { threshold: 0.05 }
  );
  visibilityObserver.observe(container);

  function onVisibilityChange() {
    visible = !document.hidden;
    if (visible) lastFrame = 0;
  }
  document.addEventListener('visibilitychange', onVisibilityChange);

  // 相机拖拽与缩放
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let downPoint = null;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  camera.userData = {
    radius: 18.5,
    theta: Math.PI / 4,
    phi: 1.05,
    focusPoint: new THREE.Vector3(0, 1.15, 0),
    focusAgentId: null,
  };

  function findAncestor(object, key) {
    let current = object;
    while (current) {
      if (current.userData?.[key]) return current;
      current = current.parent;
    }
    return null;
  }

  function handleClick(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    for (const hit of raycaster.intersectObjects(agentGroup.children, true)) {
      const agentNode = findAncestor(hit.object, 'agentId');
      if (agentNode) {
        selectAgent(agentNode.userData.agentId);
        return;
      }
    }

    for (const hit of raycaster.intersectObjects(townGroup.children, true)) {
      const locationNode = findAncestor(hit.object, 'locationKey');
      if (locationNode) {
        selectLocation(locationNode.userData.locationKey);
        return;
      }
    }

    clearSelection();
  }

  function onPointerDown(event) {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    downPoint = { x: event.clientX, y: event.clientY };
    renderer.domElement.setPointerCapture?.(event.pointerId);
  }
  function onPointerMove(event) {
    if (!dragging) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    camera.userData.theta -= dx * 0.006;
    camera.userData.phi = clamp(camera.userData.phi - dy * 0.005, 0.45, 1.3);
    updateCamera();
  }
  function onPointerUp(event) {
    dragging = false;
    if (
      downPoint &&
      Math.hypot(event.clientX - downPoint.x, event.clientY - downPoint.y) < 6
    ) {
      handleClick(event);
    }
    downPoint = null;
  }
  function onWheel(event) {
    event.preventDefault();
    camera.userData.radius = clamp(camera.userData.radius + event.deltaY * 0.012, 11, 32);
    updateCamera();
  }

  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointerup', onPointerUp);
  renderer.domElement.addEventListener('pointercancel', onPointerUp);
  renderer.domElement.addEventListener('wheel', onWheel, { passive: false });

  updateCamera();
  resize();
  animationFrame = requestAnimationFrame(renderFrame);

  function prepare({ agents = [], plans = [], dialogues = [], nextDay = 0 }) {
    day = nextDay;
    sceneData = { agents, plans, dialogues, day: nextDay };
    plansByAgent = new Map((plans ?? []).map((entry) => [entry.agent_id, entry.plan ?? []]));
    agentNames = new Map(agents.map((agent) => [agent.id, agent.name]));
    dialoguesByHour = new Map();
    for (const dialogue of dialogues) {
      if (!dialoguesByHour.has(dialogue.hour)) dialoguesByHour.set(dialogue.hour, []);
      dialoguesByHour.get(dialogue.hour).push(dialogue);
    }
    agents.forEach(addAgent);
    states = buildHourStates({ agents, plans });
  }

  function showStatic(data) {
    playing = false;
    prepare({ ...data, nextDay: data.day ?? 0 });
    const last = states[states.length - 1] ?? states[0];
    if (last) applyState(last);
    displayHour = HOURS[HOURS.length - 1];
    timeline.value = String(HOURS.length - 1);
    toggleBtn.textContent = '播放';
    setHud(null);
    updateLighting(displayHour);
    updatePanel();
    bubble.hidden = true;
    container.setAttribute(
      'aria-label',
      `第 ${day} 天的小镇 3D 场景，共 ${data.agents?.length ?? 0} 位居民`
    );
  }

  function playDay(data) {
    playing = false;
    prepare({ ...data, nextDay: data.day ?? 0 });
    if (reduceMotion || states.length === 0) {
      showStatic(data);
      return;
    }
    if (bubbleTimer) clearTimeout(bubbleTimer);
    bubble.hidden = true;
    applyState(states[0]);
    displayHour = HOURS[0];
    timeline.value = '0';
    toggleBtn.textContent = '暂停';
    setHud(HOURS[0]);
    updateLighting(HOURS[0]);
    updatePanel();
    playing = true;
    hourIndex = 0;
    elapsed = 0;
    fromState = states[0];
    toState = states[0];
    lastFrame = 0;
    container.setAttribute(
      'aria-label',
      `正在播放第 ${day} 天的小镇 3D 动画，共 ${data.agents?.length ?? 0} 位居民`
    );
  }

  function destroy() {
    playing = false;
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = null;
    if (bubbleTimer) clearTimeout(bubbleTimer);
    resizeObserver.disconnect();
    visibilityObserver.disconnect();
    document.removeEventListener('visibilitychange', onVisibilityChange);
    renderer.domElement.removeEventListener('pointerdown', onPointerDown);
    renderer.domElement.removeEventListener('pointermove', onPointerMove);
    renderer.domElement.removeEventListener('pointerup', onPointerUp);
    renderer.domElement.removeEventListener('pointercancel', onPointerUp);
    renderer.domElement.removeEventListener('wheel', onWheel);
    scene.traverse((object) => {
      object.geometry?.dispose?.();
      if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose?.());
      else object.material?.dispose?.();
      object.material?.map?.dispose?.();
    });
    renderer.dispose();
    container.innerHTML = '';
  }

  showStatic({ agents: [], plans: [], dialogues: [], day: 0 });

  return {
    supported: true,
    showStatic,
    playDay,
    pause,
    resume,
    jumpToHour,
    resetView,
    selectAgent,
    selectLocation,
    clearSelection,
    setSpeed(value) {
      speed = Number(value) || 1;
      speedSelect.value = String(speed);
    },
    destroy,
    resize,
  };
}
