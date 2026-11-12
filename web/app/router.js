import { ROUTES, ROUTE_LABELS, parseHash, resolveRoute, toHash } from './routes.js';
import * as home from './screens/home.js';
import * as create from './screens/create.js';
import * as town from './screens/town.js';
import * as year from './screens/year.js';

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

export function startRouter() {
  if (!window.location.hash) {
    window.location.hash = toHash(ROUTES[0]);
  }
  window.addEventListener('hashchange', render);
  render();
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startRouter, { once: true });
  } else {
    startRouter();
  }
}
