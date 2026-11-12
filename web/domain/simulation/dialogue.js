/**
 * 对话生成与轮次控制，对应 SPCD §8.4 / §6.2。
 * transcript 结构固定为 [{ speaker, content }]，最多 6 轮，超出自然中断。
 */
import { fail } from '../../../shared/errors/app-error.js';
import { ERROR_CODES } from '../../../shared/errors/codes.js';
import { LIMITS } from '../../../shared/contracts/index.js';

export const MAX_DIALOGUE_ROUNDS = LIMITS.MAX_DIALOGUE_ROUNDS;

/**
 * 校验并归一化模型返回的轮次：
 * - 至少 1 轮，最多 6 轮（超出截断，视为自然中断）
 * - 每轮必须有合法的说话人与非空内容
 */
export function normalizeTranscript(rounds, agents) {
  if (!Array.isArray(rounds) || rounds.length === 0) {
    fail(ERROR_CODES.E_MODEL_OUTPUT, '对话至少需要 1 轮');
  }

  const names = new Set(agents.map((agent) => agent.name));
  const normalized = rounds.slice(0, MAX_DIALOGUE_ROUNDS).map((round, index) => {
    const speaker = round?.speaker;
    const content = round?.content;
    if (typeof speaker !== 'string' || !names.has(speaker)) {
      fail(ERROR_CODES.E_MODEL_OUTPUT, `第 ${index + 1} 轮说话人不合法`);
    }
    if (typeof content !== 'string' || content.trim() === '') {
      fail(ERROR_CODES.E_MODEL_OUTPUT, `第 ${index + 1} 轮内容为空`);
    }
    return { speaker, content: content.trim() };
  });

  return { rounds: normalized, truncated: rounds.length > MAX_DIALOGUE_ROUNDS };
}

/**
 * 生成一段对话并整理为可直接写入 DIALOGUE 的结构。
 */
export async function generateDialogue({ model, town, encounter, initiator, partner, day, context }) {
  const result = await model.complete({
    stage: 'dialogue',
    town,
    agent: initiator,
    agents: [initiator, partner],
    day,
    hour: encounter.hour,
    location: encounter.location,
    context,
  });

  const { rounds, truncated } = normalizeTranscript(result?.rounds, [initiator, partner]);

  return {
    town_id: town.id,
    day,
    hour: encounter.hour,
    location: encounter.location,
    initiator_agent_id: initiator.id,
    participant_ids: [initiator.id, partner.id],
    transcript: rounds,
    rounds: rounds.length,
    truncated,
    disagreement: Boolean(result?.disagreement),
  };
}
