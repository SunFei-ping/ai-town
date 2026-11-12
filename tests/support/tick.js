/**
 * M5 测试共用夹具：会话、tick 上下文、SSE 解析。
 */
import { LocalKV } from '../../scripts/local-kv.mjs';
import sessionHandler from '../../functions/session/index.js';

export { LocalKV };

const NAMES = ['陈望', '林小满', '周秀兰', '阿彪', '苗苗'];
const OCCUPATIONS = ['五金店老板', '学生', '裁缝', '渔民', '邮差'];

export function makeAgents(day = 1) {
  return NAMES.map((name, index) => ({
    id: `agent-${index}`,
    name,
    age: 22 + index * 6,
    occupation: OCCUPATIONS[index],
    persona: `${name}在镇上住了很多年。`,
    secret: `秘密${index}：年轻时离开过一次。`,
    conflict_goal: '想把眼前的日子撑下去。',
    speech_style: '短句，偶尔停顿。',
    current_location: null,
    plan: [],
    memories: {
      impressions: [],
      summaries: day > 1 ? [{ day: day - 1, content: `第 ${day - 1} 天过得还算平静。` }] : [],
      today_events: [],
    },
  }));
}

export function makeContext({ townId = 'town-test', day = 1, maxContextTokens = 6000 } = {}) {
  return {
    town: {
      id: townId,
      name: '测试镇',
      pace_mode: 'quick',
      day_index: day,
      template_id: 'seaside',
    },
    day_state: { weather: '晴，有风', user_event: null },
    agents: makeAgents(day),
    relations: [],
    limits: {
      max_dialogue_rounds: 6,
      max_context_tokens: maxContextTokens,
      budget_remaining_yuan: 5,
    },
  };
}

export async function openSession({ kv, env = { MODEL_MODE: 'stub' }, fetchImpl, apiKey = 'sk-test-1234567890' } = {}) {
  const response = await sessionHandler({
    method: 'POST',
    body: { api_key: apiKey },
    kv,
    env,
    fetchImpl,
  });
  return { response, token: response.body?.session_token };
}

export function tickRequest({
  townId = 'town-test',
  token,
  body,
  headers = {},
  kv,
  env = { MODEL_MODE: 'stub' },
  ...rest
} = {}) {
  return {
    method: 'POST',
    path: `/v1/towns/${townId}/tick`,
    headers: { authorization: `Bearer ${token}`, ...headers },
    body,
    kv,
    env,
    ...rest,
  };
}

export async function readFrames(result) {
  const text = await new Response(result.stream).text();
  return parseSSE(text);
}

export function parseSSE(text) {
  const frames = [];
  for (const block of String(text ?? '').split(/\n\n/)) {
    let id = null;
    let event = null;
    const dataLines = [];
    for (const rawLine of block.split(/\n/)) {
      const line = rawLine.replace(/\r$/, '');
      if (!line || line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'id') id = Number(value);
      else if (field === 'event') event = value;
      else if (field === 'data') dataLines.push(value);
    }
    if (!event) continue;
    let data = {};
    try {
      data = JSON.parse(dataLines.join('\n'));
    } catch {
      data = { raw: dataLines.join('\n') };
    }
    frames.push({ id, event, data });
  }
  return frames;
}

export function framesOfType(frames, type) {
  return frames.filter((frame) => frame.event === type);
}
