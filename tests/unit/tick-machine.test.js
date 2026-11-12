import { describe, it, expect } from 'vitest';
import { TickMachine, canTransition, TERMINAL_TICK_STATES } from '../../web/domain/simulation/tick-machine.js';

describe('Tick 状态机', () => {
  it('正常路径可以走到 done', () => {
    const machine = new TickMachine();
    for (const state of ['validating', 'planning', 'simulating', 'reflecting', 'reporting', 'done']) {
      machine.to(state);
    }
    expect(machine.state).toBe('done');
    expect(machine.isTerminal()).toBe(true);
    expect(machine.dayStatus()).toBe('done');
  });

  it('校验失败可以走到 rejected', () => {
    const machine = new TickMachine();
    machine.to('validating');
    machine.to('rejected');
    expect(machine.isTerminal()).toBe(true);
    expect(machine.dayStatus()).toBe('pending');
  });

  it('任意阶段可降级，降级后仍能出稿并完成', () => {
    const machine = new TickMachine();
    machine.to('validating');
    machine.to('planning');
    machine.to('degraded');
    expect(machine.degraded).toBe(true);
    machine.to('reporting');
    machine.to('done');
    expect(machine.dayStatus()).toBe('partial');
  });

  it('非法迁移抛 E_TOWN_STATE', () => {
    const machine = new TickMachine();
    expect(() => machine.to('planning')).toThrowError(/非法的状态迁移/);
    try {
      machine.to('done');
    } catch (err) {
      expect(err.code).toBe('E_TOWN_STATE');
    }
  });

  it('终态不可继续迁移', () => {
    const machine = new TickMachine();
    machine.to('validating');
    machine.to('rejected');
    expect(() => machine.to('planning')).toThrow();
    expect(TERMINAL_TICK_STATES).toContain('rejected');
  });

  it('canTransition 与转移表一致', () => {
    expect(canTransition('idle', 'validating')).toBe(true);
    expect(canTransition('idle', 'done')).toBe(false);
    expect(canTransition('degraded', 'reporting')).toBe(true);
    expect(canTransition('done', 'idle')).toBe(false);
    expect(canTransition('nope', 'idle')).toBe(false);
  });

  it('记录完整迁移历史', () => {
    const seen = [];
    const machine = new TickMachine('idle', (state) => seen.push(state));
    machine.to('validating');
    machine.to('planning');
    expect(machine.history).toEqual(['idle', 'validating', 'planning']);
    expect(seen).toEqual(['validating', 'planning']);
  });
});
