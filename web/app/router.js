import { ROUTES, ROUTE_LABELS, parseHash, resolveRoute, toHash } from './routes.js';
import * as home from './screens/home.js';
import * as create from './screens/create.js';
import * as town from './screens/town.js';
import * as year from './screens/year.js';
import { storageMode } from '../infra/storage/idb.js';
import { fetchHealth } from '../infra/api/health.js';
import { SCHEMA_VERSION, isSchemaCompatible } from '../../shared/contracts/index.js';

const SCREENS = { home, create, town, year };

let activeScreen = null;

function currentRoute() {
  return resolveRoute(parseHash(window.location.hash));
}

export function navigate(route) {
  const next = toHash(route);
  if (window.location.hash === next) {
    render();
    return;
  }
  window.location.hash = next;
}

function syncNav(route) {
  document.querySelectorAll('.app-nav__link[data-route]').forEach((el) => {
    if (el.dataset.route === route) {
      el.setAttribute('aria-current', 'page');
    } else {
      el.removeAttribute('aria-current');
    }
  });
}

function render() {
  const route = currentRoute();
  const screen = SCREENS[route];
  const root = document.getElementById('screen');
  if (!root || !screen) return;

  activeScreen?.destroy?.();
  root.dataset.screenRoute = route;
  screen.render(root);
  activeScreen = screen;
  syncNav(route);
  document.title = `${ROUTE_LABELS[route]} · AI小镇`;
}

function showBanner(id, text) {
  const node = document.getElementById(id);
  if (!node) return;
  node.textContent = text;
  node.hidden = false;
}

/** 隐私模式下 IndexedDB 不可用，页面常驻提示，见 task.md M6-06 */
async function checkStorageMode() {
  try {
    if ((await storageMode()) === 'memory') {
      showBanner(
        'storage-notice',
        '隐私模式：数据只保存在内存中，刷新即丢失。请及时导出备份。'
      );
    }
  } catch {
    /* 探测失败时安静处理 */
  }
}

/** 静态资源与函数的版本兼容校验，见 SPCD §13.4 */
async function checkVersion() {
  try {
    const health = await fetchHealth();
    if (!isSchemaCompatible(SCHEMA_VERSION, health?.version)) {
      showBanner(
        'version-notice',
        `版本不兼容：页面 ${SCHEMA_VERSION}，服务端 ${health?.version ?? '未知'}。请先导出备份，再升级页面或函数。`
      );
    }
  } catch {
    /* 纯静态托管或离线时不阻塞页面 */
  }
}

function checkEnvironment() {
  checkStorageMode();
  checkVersion();
}

export function startRouter() {
  if (!window.location.hash) {
    window.location.hash = toHash(ROUTES[0]);
  }
  window.addEventListener('hashchange', render);
  render();
  checkEnvironment();
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startRouter, { once: true });
  } else {
    startRouter();
  }
}
