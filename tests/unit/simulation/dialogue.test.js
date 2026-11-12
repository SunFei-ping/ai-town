import { describe, it, expect } from 'vitest';
import {
  generateDialogue,
  normalizeTranscript,
  MAX_DIALOGUE_ROUNDS,
} from '../../../web/domain/simulation/dialogue.js';

const initiator = { id: 'agent_a', name: '陈望' };
const partner = { id: 'agent_b', name: '林小满' };
const town = { id: 'town_test' };
const encounter = { hour: 14, location: '码头' };

function createModel(result) {
  const calls = [];
  return {
    calls,
    async complete(payload) {
      calls.push(payload);
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

describe('对话生成与轮次控制（dialogue）', () => {
  it('最多 6 轮，超出部分自然中断', async () => {
    const rounds = Array.from({ length: 8 }, (_, index) => ({
      speaker: index % 2 === 0 ? initiator.name : partner.name,
      content: `第 ${index + 1} 轮`,
    }));
    const model = createModel({ rounds });

    const dialogue = await generateDialogue({
      model,
      town,
      encounter,
      initiator,
      partner,
      day: 1,
    });

    expect(dialogue.transcript).toHaveLength(MAX_DIALOGUE_ROUNDS);
    expect(dialogue.rounds).toBe(MAX_DIALOGUE_ROUNDS);
    expect(dialogue.truncated).toBe(true);
    expect(model.calls[0]).toMatchObject({
      stage: 'dialogue',
      hour: 14,
      location: '码头',
    });
  });

  it('transcript 每轮都含说话人与内容，且记录参与者', async () => {
    const model = createModel({
      rounds: [
        { speaker: initiator.name, content: ' 你也来了。 ' },
        { speaker: partner.name, content: '嗯，风比昨天大。' },
        { speaker: initiator.name, content: '早点回吧。' },
      ],
    });

    const dialogue = await generateDialogue({
      model,
      town,
      encounter,
      initiator,
      partner,
      day: 1,
    });

    expect(dialogue.transcript).toEqual([
      { speaker: '陈望', content: '你也来了。' },
      { speaker: '林小满', content: '嗯，风比昨天大。' },
      { speaker: '陈望', content: '早点回吧。' },
    ]);
    expect(dialogue.initiator_agent_id).toBe('agent_a');
    expect(dialogue.participant_ids).toEqual(['agent_a', 'agent_b']);
    expect(dialogue).toMatchObject({ town_id: 'town_test', day: 1, hour: 14 });
  });

  it('空对话或非法说话人返回 E_MODEL_OUTPUT', async () => {
    await expect(
      generateDialogue({
        model: createModel({ rounds: [] }),
        town,
        encounter,
        initiator,
        partner,
        day: 1,
      })
    ).rejects.toMatchObject({ code: 'E_MODEL_OUTPUT' });

    await expect(
      generateDialogue({
        model: createModel({ rounds: [{ speaker: '路人', content: '你好' }] }),
        town,
        encounter,
        initiator,
        partner,
        day: 1,
      })
    ).rejects.toMatchObject({ code: 'E_MODEL_OUTPUT' });
  });

  it('轮次内容为空时拒绝', () => {
    let error = null;
    try {
      normalizeTranscript([{ speaker: initiator.name, content: '   ' }], [initiator, partner]);
    } catch (err) {
      error = err;
    }
    expect(error?.code).toBe('E_MODEL_OUTPUT');
  });
});
