/**
 * 模板数据结构与校验，唯一事实源，见 SPCD §7.4。
 * 模板数据只读，不得包含任何真实个人信息。
 */
import { LIMITS, FIELD_LIMITS } from './index.js';
import { fail } from '../errors/app-error.js';
import { ERROR_CODES } from '../errors/codes.js';

export const TEMPLATE_AGENT_FIELDS = Object.freeze([
  { key: 'name', max: FIELD_LIMITS.AGENT_NAME_MAX },
  { key: 'occupation', max: 20 },
  { key: 'persona', max: FIELD_LIMITS.AGENT_PERSONA_MAX },
  { key: 'secret', max: FIELD_LIMITS.AGENT_SECRET_MAX },
  { key: 'conflict_goal', max: FIELD_LIMITS.AGENT_CONFLICT_GOAL_MAX },
  { key: 'speech_style', max: FIELD_LIMITS.AGENT_SPEECH_STYLE_MAX },
]);

/** 明显的真实个人信息：手机号 / 邮箱 / 身份证号 */
const PRIVATE_INFO_PATTERNS = Object.freeze([
  /1[3-9]\d{9}/,
  /[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}/,
  /\d{17}[\dXx]/,
]);

function assertText(value, label, max) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(ERROR_CODES.E_VALIDATION, `模板缺少字段 ${label}`);
  }
  if (value.length > max) {
    fail(ERROR_CODES.E_VALIDATION, `模板字段 ${label} 超过 ${max} 个字符`);
  }
}

function assertNoPrivateInfo(values) {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    for (const pattern of PRIVATE_INFO_PATTERNS) {
      if (pattern.test(value)) {
        fail(ERROR_CODES.E_VALIDATION, '模板不得包含真实个人信息');
      }
    }
  }
}

function assertCoverHue(value) {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < 0 || value > 360) {
    fail(ERROR_CODES.E_VALIDATION, '模板 cover_hue 必须是 0–360 的整数');
  }
}

/** 列表接口的元信息，见 §7.4 GET /v1/templates */
export function validateTemplateMeta(meta) {
  if (!meta || typeof meta !== 'object') {
    fail(ERROR_CODES.E_VALIDATION, '模板元信息为空');
  }
  assertText(meta.id, 'id', 40);
  assertText(meta.name, 'name', 40);
  assertText(meta.summary, 'summary', 120);
  assertCoverHue(meta.cover_hue);
  if (meta.agent_count !== LIMITS.AGENTS_PER_TOWN) {
    fail(ERROR_CODES.E_VALIDATION, `模板必须包含 ${LIMITS.AGENTS_PER_TOWN} 个居民`);
  }
  assertNoPrivateInfo([meta.name, meta.summary]);
  return meta;
}

/** 完整模板，见 §7.4 GET /v1/templates/{id} */
export function validateTemplate(template) {
  if (!template || typeof template !== 'object') {
    fail(ERROR_CODES.E_VALIDATION, '模板为空');
  }
  assertText(template.id, 'id', 40);
  assertText(template.name, 'name', 40);
  assertText(template.summary, 'summary', 120);
  assertText(template.opening_scene, 'opening_scene', 300);
  assertCoverHue(template.cover_hue);

  if (!Array.isArray(template.agents) || template.agents.length !== LIMITS.AGENTS_PER_TOWN) {
    fail(ERROR_CODES.E_VALIDATION, `模板必须包含 ${LIMITS.AGENTS_PER_TOWN} 个居民`);
  }
  if (template.agent_count !== undefined && template.agent_count !== LIMITS.AGENTS_PER_TOWN) {
    fail(ERROR_CODES.E_VALIDATION, `模板必须包含 ${LIMITS.AGENTS_PER_TOWN} 个居民`);
  }

  const names = new Set();
  const texts = [template.name, template.summary, template.opening_scene];

  for (const agent of template.agents) {
    if (!agent || typeof agent !== 'object') {
      fail(ERROR_CODES.E_VALIDATION, '模板居民字段不完整');
    }
    for (const field of TEMPLATE_AGENT_FIELDS) {
      assertText(agent[field.key], field.key, field.max);
      texts.push(agent[field.key]);
    }
    if (!Number.isInteger(agent.age) || agent.age < 1 || agent.age > 120) {
      fail(ERROR_CODES.E_VALIDATION, '模板居民年龄不合法');
    }
    if (names.has(agent.name)) {
      fail(ERROR_CODES.E_VALIDATION, `模板内居民名重复：${agent.name}`);
    }
    names.add(agent.name);
  }

  assertNoPrivateInfo(texts);
  return template;
}
