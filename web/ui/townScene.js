/**
 * 主界面小镇 3D 场景（Three.js，本地 vendored，无 CDN）。
 *
 * 数据只来自现有契约：
 * - 居民与 plan_json / tick 返回的 plans
 * - dialogue 的 hour / location / participant_ids / transcript
 *
 * 场景负责把「一天」演成一段低多边形动画：居民按计划移动，相遇时出现气泡。
 * 不改变任何业务契约；WebGL 不可用时降级为文字提示。
 */
import * as THREE from '../vendor/three.module.js';
import { locationAt, encounterLocationKey } from '../domain/simulation/encounter.js';

const HOURS = Array.from({ length: 17 }, (_, index) => index + 6);
const STEP_MS = 620;
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

export function createTownScene({ container }) {
  if (!container) return createFallback(document.createElement('div'), '场景容器不存在');
  if (!supportsWebGL()) {
    return createFallback(container, '当前设备不支持 WebGL，已保留文字版小镇。');
  }

  const palette = readPalette();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);
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

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a94a6, 1.35));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(6, 12, 5);
  scene.add(sun);

  const ground = new THREE.Group();
  scene.add(ground);

  const water = new THREE.Mesh(
    new THREE.CircleGeometry(10.8, 64),
    new THREE.MeshBasicMaterial({
      color: palette.accent,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
    })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = -0.16;
  ground.add(water);

  const island = new THREE.Mesh(
    new THREE.CircleGeometry(8.7, 64),
    new THREE.MeshLambertMaterial({ color: palette.bgDeep })
  );
  island.rotation.x = -Math.PI / 2;
  ground.add(island);

  const border = makeRing(8.72, palette.line, 0.55);
  border.scale.setScalar(1.006);
  ground.add(border);

  const plaza = new THREE.Mesh(
    new THREE.CircleGeometry(1.5, 40),
    new THREE.MeshLambertMaterial({ color: palette.line })
  );
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.y = 0.012;
  ground.add(plaza);

  for (const direction of [0, Math.PI / 2]) {
    const path = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 15.5),
      new THREE.MeshLambertMaterial({ color: palette.surface })
    );
    path.rotation.x = -Math.PI / 2;
    path.rotation.z = direction;
    path.position.y = 0.008;
    ground.add(path);
  }

  // 低多边形树，增加空间层次
  for (let index = 0; index < 14; index += 1) {
    const angle = (index / 14) * Math.PI * 2 + 0.4;
    const radius = 7.6 + (index % 3) * 0.25;
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.11, 0.55, 6),
      new THREE.MeshLambertMaterial({ color: palette.inkSoft })
    );
    trunk.position.y = 0.27;
    const crown = new THREE.Mesh(
      new THREE.ConeGeometry(0.42, 0.95, 7),
      new THREE.MeshLambertMaterial({ color: palette.ok })
    );
    crown.position.y = 0.98;
    tree.add(trunk, crown);
    tree.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    tree.scale.setScalar(0.85 + (index % 4) * 0.06);
    ground.add(tree);
  }

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
      const lamp = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.07, 1.5, 6),
        new THREE.MeshLambertMaterial({ color: palette.inkSoft })
      );
      lamp.position.y = 0.75;
      const lightBall = new THREE.Mesh(
        new THREE.SphereGeometry(0.13, 12, 10),
        new THREE.MeshLambertMaterial({ color: palette.warn })
      );
      lightBall.position.y = 1.55;
      node.add(lamp, lightBall);
    } else if (key === '码头') {
      const deck = new THREE.Mesh(
        new THREE.BoxGeometry(2.4, 0.16, 1.4),
        new THREE.MeshLambertMaterial({ color: palette.inkSoft })
      );
      deck.position.y = 0.08;
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.09, 1.2, 6),
        new THREE.MeshLambertMaterial({ color: palette.ink })
      );
      post.position.set(0.9, 0.6, 0.4);
      node.add(deck, post);
    } else {
      const height = privateHome ? 0.8 : 1.25 + (hashString(key) % 5) * 0.16;
      const width = privateHome ? 0.95 : 1.55;
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(width, height, width),
        new THREE.MeshLambertMaterial({
          color: privateHome ? palette.bgDeep : [palette.accent, palette.warn, palette.ok, palette.inkFaint][hashString(key) % 4],
        })
      );
      body.position.y = height / 2;
      const roof = new THREE.Mesh(
        new THREE.ConeGeometry(width * 0.8, privateHome ? 0.4 : 0.62, 4),
        new THREE.MeshLambertMaterial({ color: privateHome ? palette.line : palette.accentSoft })
      );
      roof.position.y = height + (privateHome ? 0.2 : 0.31);
      roof.rotation.y = Math.PI / 4;
      node.add(body, roof);
    }

    const labelSprite = makeLabelSprite(label, palette, {
      fontSize: privateHome ? 20 : 24,
      scale: privateHome ? 0.0068 : 0.008,
      background: privateHome ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.9)',
    });
    if (!privateHome) {
      labelSprite.position.y = 2.25;
      node.add(labelSprite);
    }

    townGroup.add(node);
    locationNodes.set(key, { point, node, label });
    return locationNodes.get(key);
  }

  const agentViews = new Map();

  function addAgent(agent, index) {
    if (agentViews.has(agent.id)) return agentViews.get(agent.id);
    const color = palette.accent.clone().offsetHSL((index * 0.12) % 1, 0.02, 0.04);
    const view = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.28, 0.62, 8),
      new THREE.MeshLambertMaterial({ color })
    );
    body.position.y = 0.34;
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.21, 14, 12),
      new THREE.MeshLambertMaterial({ color: palette.surface })
    );
    head.position.y = 0.82;
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.32, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.12, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;

    const label = makeLabelSprite(agent.name, palette, {
      fontSize: 22,
      scale: 0.0065,
      background: 'rgba(255,255,255,0.82)',
    });
    label.position.y = 1.28;

    view.add(body, head, shadow, label);
    view.userData.from = new THREE.Vector3(0, 0, 3);
    view.userData.to = new THREE.Vector3(0, 0, 3);
    view.position.copy(view.userData.from);
    agentGroup.add(view);
    agentViews.set(agent.id, view);
    return view;
  }

  function agentOffsetPoint(agentId, key, index) {
    const base = locationNodes.get(key)?.point ?? pointForLocation(key);
    const angle = index * 2.399 + (hashString(key) % 100) / 100;
    const radius = key.startsWith('__private__') ? 0.55 : key === '街口' ? 1.7 : 1.05;
    return new THREE.Vector3(base.x + Math.cos(angle) * radius, 0, base.z + Math.sin(angle) * radius);
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
          state.set(agent.id, agentOffsetPoint(agent.id, key, index));
          return;
        }
        const key = encounterLocationKey(agent.id, segment.location);
        const privateHome = key.startsWith('__private__');
        addLocationNode(key, segment.location, { agentIndex: index, privateHome });
        state.set(agent.id, agentOffsetPoint(agent.id, key, index));
      });
      return state;
    });
  }

  function applyState(state) {
    for (const [agentId, view] of agentViews) {
      const target = state.get(agentId);
      if (!target) continue;
      view.position.copy(target);
      view.userData.from.copy(target);
      view.userData.to.copy(target);
    }
  }

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

  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  function setHud(hour) {
    hud.textContent =
      playing && hour !== null
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
    if (list.length === 0) return;
    const dialogue = list[0];
    const names = (dialogue.participant_ids ?? [])
      .map((id) => agentNames.get(id))
      .filter(Boolean);
    const firstLine = dialogue.transcript?.[0]?.content ?? '';
    const prefix = names.length > 0 ? `${names.join('和')}在${dialogue.location}：` : `${dialogue.location}：`;
    showBubble(`${prefix}${firstLine.slice(0, 42)}${firstLine.length > 42 ? '…' : ''}`);
    const point = agentViews.get(dialogue.participant_ids?.[0])?.position;
    if (point) pulseAt(point);
  }

  function stepTo(nextIndex) {
    if (nextIndex >= states.length) {
      playing = false;
      setHud(null);
      return;
    }
    hourIndex = nextIndex;
    fromState = states[Math.max(0, hourIndex - 1)] ?? states[0];
    toState = states[hourIndex];
    for (const [agentId, view] of agentViews) {
      const from = fromState.get(agentId) ?? view.position;
      const to = toState.get(agentId) ?? from;
      view.userData.from.copy(from);
      view.userData.to.copy(to);
    }
    elapsed = 0;
    setHud(HOURS[hourIndex]);
    triggerDialogues(HOURS[hourIndex]);
  }

  function updateCamera() {
    const radius = camera.userData.radius ?? 18.5;
    const theta = camera.userData.theta ?? Math.PI / 4;
    const phi = camera.userData.phi ?? 1.05;
    const target = new THREE.Vector3(0, 1.05, 0);
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

    if (playing && fromState && toState) {
      elapsed += delta;
      const progress = Math.min(1, elapsed / STEP_MS);
      const eased = easeInOut(progress);
      for (const [agentId, view] of agentViews) {
        view.position.lerpVectors(view.userData.from, view.userData.to, eased);
      }
      if (progress >= 1) stepTo(hourIndex + 1);
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
      camera.userData.radius = width < 520 ? 23.5 : 18.5;
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
  camera.userData = { radius: 18.5, theta: Math.PI / 4, phi: 1.05 };

  function onPointerDown(event) {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
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
  function onPointerUp() {
    dragging = false;
  }
  function onWheel(event) {
    event.preventDefault();
    camera.userData.radius = clamp(camera.userData.radius + event.deltaY * 0.012, 11, 30);
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
    setHud(null);
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
    setHud(HOURS[0]);
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

  return { supported: true, showStatic, playDay, destroy, resize };
}
