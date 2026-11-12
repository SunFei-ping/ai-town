/**
 * Tick 状态机，严格对应 docs/spcd.md §8.2。
 * 纯逻辑，不依赖 DOM 与网络，便于单测覆盖全部迁移。
 */
import { fail } from '../../../shared/errors/app-error.js';
import { ERROR_CODES } from '../../../shared/errors/codes.js';
import { TICK_STATES } from '../../../shared/contracts/index.js';

export const TICK_TRANSITIONS = Object.freeze({
  idle: ['validating'],
  validating: ['planning', 'rejected'],
  planning: ['simulating', 'degraded'],
  simulating: ['reflecting', 'degraded'],
  reflecting: ['reporting', 'degraded'],
  reporting: ['done'],
  degraded: ['reporting'],
  done: [],
  rejected: [],
});

export const TERMINAL_TICK_STATES = Object.freeze(['done', 'rejected']);

export function canTransition(from, to) {
  if (!TICK_STATES.includes(from) || !TICK_STATES.includes(to)) return false;
  return (TICK_TRANSITIONS[from] ?? []).includes(to);
}

export class TickMachine {
  #degraded = false;

  constructor(initial = 'idle', onChange) {
    if (!TICK_STATES.includes(initial)) {
      fail(ERROR_CODES.E_TOWN_STATE, `未知的 Tick 状态：${initial}`);
    }
    this.state = initial;
    this.history = [initial];
    this.onChange = onChange;
  }

  to(next) {
    if (!canTransition(this.state, next)) {
      fail(ERROR_CODES.E_TOWN_STATE, `非法的状态迁移：${this.state} → ${next}`);
    }
    if (next === 'degraded') this.#degraded = true;
    this.state = next;
    this.history.push(next);
    this.onChange?.(next, this);
    return this.state;
  }

  isTerminal() {
    return TERMINAL_TICK_STATES.includes(this.state);
  }

  get degraded() {
    return this.#degraded;
  }

  /** 映射到 DAY_STATE.status，见 SPCD §8.2 的状态与数据对应表 */
  dayStatus() {
    if (this.state === 'done') return this.#degraded ? 'partial' : 'done';
    if (this.state === 'rejected' || this.state === 'idle') return 'pending';
    return 'running';
  }
}
