import { describe, it, expect, beforeEach } from 'vitest';
import { resetDB, fiveAgents } from '../../support/db.js';
import * as dao from '../../../web/infra/storage/dao.js';
import {
  extractSecretTerms,
  inspectText,
  guardText,
  guardDialogue,
  writeGuardUsage,
  SECRET_FALLBACK,
} from '../../../web/domain/memory/secretGuard.js';

const SECRET = '欠了码头老赵三万块钱';

describe('secret 三级检测（secret-guard）', () => {
  it('从 secret 抽取长度 ≥2 的关键短语', () => {
    const terms = extractSecretTerms(SECRET);
    expect(terms).toContain('老赵');
    expect(terms).toContain('三万');
    expect(terms.every((term) => term.length >= 2)).toBe(true);
    expect(inspectText('老赵今天没来码头', [SECRET]).leaked).toBe(true);
  });

  it('常用词不被当作敏感词，正常对话不误伤', () => {
    const secrets = ['她记录别人的故事，是为了不写自己的。'];
    const normal = '我跟你说，做买卖跟写文章一个道理，人的故事我听多了。';
    expect(inspectText(normal, secrets).leaked).toBe(false);
    expect(inspectText('她记录别人的故事，是为了不写自己的。', secrets).leaked).toBe(true);

    const miao = '她把大人说的话都记在一个本子上，谁也不给看。';
    expect(inspectText('回去也是一个人坐着，不如吹吹风。', [miao]).leaked).toBe(false);
    expect(extractSecretTerms(miao)).not.toContain('一个');
  });

  it('词表命中即拦截，默认重写后不再包含敏感词', async () => {
    const result = await guardText({
      text: '老赵，那三万块钱我下个月还你。',
      secrets: [SECRET],
    });

    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.rewrites).toBe(1);
    expect(result.usage.secret_hits).toBeGreaterThan(0);
    expect(result.usage.secret_rewrites).toBe(1);
    expect(result.text).not.toContain('老赵');
    expect(result.text).not.toContain('三万');
  });

  it('命中后只调用重写 1 次', async () => {
    let rewriteCalls = 0;
    const result = await guardText({
      text: '老赵欠我三万。',
      secrets: [SECRET],
      rewrite: ({ text }) => {
        rewriteCalls += 1;
        return text.replace('老赵', '他').replace('三万', '那笔钱');
      },
    });

    expect(rewriteCalls).toBe(1);
    expect(result.text).not.toContain('老赵');
    expect(result.replaced).toBe(false);
  });

  it('重写后仍命中则整句替换为通用表达', async () => {
    const result = await guardText({
      text: '老赵欠我三万。',
      secrets: [SECRET],
      rewrite: ({ text }) => text,
    });

    expect(result.replaced).toBe(true);
    expect(result.text).toBe(SECRET_FALLBACK);
    expect(result.text).not.toContain('老赵');
  });

  it('语义判定命中时同样视为泄露', async () => {
    const result = await guardText({
      text: '天一黑他就不敢出门。',
      secrets: ['他其实一直怕黑'],
      semanticCheck: (text) => text.includes('不敢出门'),
    });

    expect(result.replaced).toBe(true);
    expect(result.text).not.toContain('不敢出门');
  });

  it('未命中时不重写、不产生用量', async () => {
    const result = await guardText({ text: '今天风很大。', secrets: [SECRET] });
    expect(result.text).toBe('今天风很大。');
    expect(result.rewrites).toBe(0);
    expect(result.usage).toEqual({ secret_hits: 0, secret_rewrites: 0 });
  });

  it('一段对话逐轮检测，统计命中次数', async () => {
    const dialogue = {
      transcript: [
        { speaker: '甲', content: '老赵来了吗？' },
        { speaker: '乙', content: '风比昨天大。' },
      ],
    };
    const guarded = await guardDialogue({ dialogue, secrets: [SECRET] });
    expect(guarded.usage.secret_hits).toBeGreaterThan(0);
    expect(guarded.dialogue.transcript[0].content).not.toContain('老赵');
    expect(guarded.dialogue.transcript[1].content).toBe('风比昨天大。');
  });

  describe('写入 USAGE', () => {
    beforeEach(async () => {
      await resetDB();
    });

    it('泄露判定次数与重写次数落库；无命中不写', async () => {
      const town = await dao.createTown(
        { name: '测试镇', templateId: 'seaside', paceMode: 'quick' },
        fiveAgents()
      );

      await writeGuardUsage({
        townId: town.id,
        day: 1,
        stage: 'dialogue',
        usage: { secret_hits: 2, secret_rewrites: 1 },
      });
      await writeGuardUsage({
        townId: town.id,
        day: 1,
        stage: 'unsay',
        usage: { secret_hits: 0, secret_rewrites: 0 },
      });

      const usage = await dao.listUsage(town.id, 1);
      expect(usage).toHaveLength(1);
      expect(usage[0].stage).toBe('dialogue');
      expect(usage[0].secret_hits).toBe(2);
      expect(usage[0].secret_rewrites).toBe(1);
    });
  });
});
