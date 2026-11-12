import { describe, it, expect, beforeEach } from 'vitest';
import { resetDB, fiveAgents } from '../support/db.js';
import * as dao from '../../web/infra/storage/dao.js';
import * as db from '../../web/infra/storage/idb.js';

beforeEach(async () => {
  await resetDB();
});

describe('数据层：建镇', () => {
  it('C1：不足 5 个居民时拒绝创建', async () => {
    await expect(
      dao.createTown({ name: '测试镇', templateId: 'seaside', paceMode: 'quick' }, fiveAgents().slice(0, 4))
    ).rejects.toMatchObject({ code: 'E_VALIDATION' });
  });

  it('创建成功后恰好 5 个居民，状态为 running', async () => {
    const town = await dao.createTown(
      { name: '测试镇', templateId: 'seaside', paceMode: 'quick' },
      fiveAgents()
    );
    const agents = await dao.listAgents(town.id);
    expect(town.status).toBe('running');
    expect(town.day_index).toBe(0);
    expect(agents).toHaveLength(5);
  });

  it('节奏模式不合法时拒绝', async () => {
    await expect(
      dao.createTown({ name: '测试镇', templateId: 'seaside', paceMode: 'turbo' }, fiveAgents())
    ).rejects.toMatchObject({ code: 'E_VALIDATION' });
  });
});

describe('数据层：天数', () => {
  it('C2：天数不能回退', async () => {
    const town = await dao.createTown(
      { name: '测试镇', templateId: 'seaside', paceMode: 'quick' },
      fiveAgents()
    );
    await dao.updateTownDay(town.id, 2);
    await expect(dao.updateTownDay(town.id, 1)).rejects.toMatchObject({ code: 'E_TOWN_STATE' });
  });

  it('C2：天数不能超过 7，第 7 天自动完成', async () => {
    const town = await dao.createTown(
      { name: '测试镇', templateId: 'seaside', paceMode: 'quick' },
      fiveAgents()
    );
    const done = await dao.updateTownDay(town.id, 7);
    expect(done.status).toBe('completed');
    await expect(dao.updateTownDay(town.id, 8)).rejects.toMatchObject({ code: 'E_TOWN_STATE' });
  });
});

describe('数据层：关系与事件', () => {
  it('C8：跨小镇的关系被拒绝', async () => {
    const a = await dao.createTown({ name: '甲镇', templateId: 'seaside', paceMode: 'quick' }, fiveAgents());
    const b = await dao.createTown({ name: '乙镇', templateId: 'seaside', paceMode: 'quick' }, fiveAgents());
    const agentsA = await dao.listAgents(a.id);
    const agentsB = await dao.listAgents(b.id);

    await expect(
      dao.putRelation({
        town_id: a.id,
        from_agent_id: agentsA[0].id,
        to_agent_id: agentsB[0].id,
        affinity: 10,
        label: 'familiar',
        updated_day: 1,
      })
    ).rejects.toMatchObject({ code: 'E_VALIDATION' });
  });

  it('同小镇关系可写入，且同一对只保留一条', async () => {
    const town = await dao.createTown(
      { name: '测试镇', templateId: 'seaside', paceMode: 'quick' },
      fiveAgents()
    );
    const [a, b] = await dao.listAgents(town.id);
    await dao.putRelation({
      town_id: town.id,
      from_agent_id: a.id,
      to_agent_id: b.id,
      affinity: 10,
      label: 'familiar',
      updated_day: 1,
    });
    await dao.putRelation({
      town_id: town.id,
      from_agent_id: a.id,
      to_agent_id: b.id,
      affinity: 20,
      label: 'familiar',
      updated_day: 2,
    });
    const relations = await dao.listRelations(town.id);
    expect(relations).toHaveLength(1);
    expect(relations[0].affinity).toBe(20);
  });

  it('C3：同一天不能投递第二条用户事件', async () => {
    const town = await dao.createTown(
      { name: '测试镇', templateId: 'seaside', paceMode: 'quick' },
      fiveAgents()
    );
    await dao.addEvent({ town_id: town.id, day: 1, type: 'weather', payload: '下雨', source: 'user', created_at: Date.now() });
    await expect(
      dao.addEvent({ town_id: town.id, day: 1, type: 'loss', payload: '丢钱包', source: 'user', created_at: Date.now() })
    ).rejects.toMatchObject({ code: 'E_VALIDATION' });
  });
});

describe('数据层：记忆与级联删除', () => {
  it('C4：印象层对同一对象只保留一条', async () => {
    const town = await dao.createTown(
      { name: '测试镇', templateId: 'seaside', paceMode: 'quick' },
      fiveAgents()
    );
    const [a, b] = await dao.listAgents(town.id);
    const base = {
      agent_id: a.id,
      tier: 'impression',
      target_agent_id: b.id,
      weight: 5,
      created_day: 1,
      expire_day: null,
    };
    await dao.putMemory({ ...base, content: '第一次印象' });
    await dao.putMemory({ ...base, content: '改过的印象' });
    const impressions = await dao.listMemories(a.id, 'impression');
    expect(impressions).toHaveLength(1);
    expect(impressions[0].content).toBe('改过的印象');
  });

  it('删除小镇后所有子表清空', async () => {
    const town = await dao.createTown(
      { name: '测试镇', templateId: 'seaside', paceMode: 'quick' },
      fiveAgents()
    );
    const [a, b] = await dao.listAgents(town.id);
    await dao.putRelation({
      town_id: town.id,
      from_agent_id: a.id,
      to_agent_id: b.id,
      affinity: 5,
      label: 'familiar',
      updated_day: 1,
    });
    await dao.addEvent({ town_id: town.id, day: 1, type: 'weather', payload: '下雨', source: 'user', created_at: Date.now() });
    await dao.putDayState({
      town_id: town.id,
      day: 1,
      weather: '晴',
      user_event_id: null,
      status: 'done',
      started_at: Date.now(),
      finished_at: Date.now(),
    });
    await dao.putMemory({
      agent_id: a.id,
      tier: 'event',
      content: '一句话',
      target_agent_id: null,
      weight: 5,
      created_day: 1,
      expire_day: 1,
    });

    await dao.deleteTown(town.id);

    expect(await db.get('town', town.id)).toBeUndefined();
    expect(await dao.listAgents(town.id)).toHaveLength(0);
    expect(await dao.listRelations(town.id)).toHaveLength(0);
    expect(await dao.listEvents(town.id, 1)).toHaveLength(0);
    expect(await dao.getDayState(town.id, 1)).toBeNull();
    expect(await dao.listMemories(a.id, 'event')).toHaveLength(0);
  });
});
