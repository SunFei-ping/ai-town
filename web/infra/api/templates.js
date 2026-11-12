/**
 * 模板加载与结构校验。
 * 结构定义见 SPCD §7.4，模板数据放在 data/templates 下。
 */
import { fail } from '../../../shared/errors/app-error.js';
import { ERROR_CODES } from '../../../shared/errors/codes.js';
import { LIMITS, FIELD_LIMITS } from '../../../shared/contracts/index.js';

const TEMPLATE_FIELDS = [
  ['name', FIELD_LIMITS.AGENT_NAME_MAX],
  ['occupation', 20],
  ['persona', FIELD_LIMITS.AGENT_PERSONA_MAX],
  ['secret', FIELD_LIMITS.AGENT_SECRET_MAX],
  ['conflict_goal', FIELD_LIMITS.AGENT_CONFLICT_GOAL_MAX],
  ['speech_style', FIELD_LIMITS.AGENT_SPEECH_STYLE_MAX],
];

export function validateTemplate(template) {
  if (!template || typeof template !== 'object') {
    fail(ERROR_CODES.E_VALIDATION, '模板为空');
  }
  if (!Array.isArray(template.agents) || template.agents.length !== LIMITS.AGENTS_PER_TOWN) {
    fail(ERROR_CODES.E_VALIDATION, `模板必须包含 ${LIMITS.AGENTS_PER_TOWN} 个居民`);
  }
  const names = new Set();
  for (const agent of template.agents) {
    for (const [field, max] of TEMPLATE_FIELDS) {
      const value = agent?.[field];
      if (typeof value !== 'string' || value.trim() === '') {
        fail(ERROR_CODES.E_VALIDATION, `模板居民缺少字段 ${field}`);
      }
      if (value.length > max) {
        fail(ERROR_CODES.E_VALIDATION, `模板字段 ${field} 超过 ${max} 个字符`);
      }
    }
    if (!Number.isInteger(agent.age) || agent.age < 1 || agent.age > 120) {
      fail(ERROR_CODES.E_VALIDATION, '模板居民年龄不合法');
    }
    if (names.has(agent.name)) {
      fail(ERROR_CODES.E_VALIDATION, `模板内居民名重复：${agent.name}`);
    }
    names.add(agent.name);
  }
  return template;
}

export async function listTemplates() {
  const res = await fetch('/data/templates/index.json');
  if (!res.ok) fail(ERROR_CODES.E_INTERNAL, '模板索引加载失败');
  const data = await res.json();
  return data.templates ?? [];
}

export async function loadTemplate(templateId) {
  const res = await fetch(`/data/templates/${templateId}.json`);
  if (!res.ok) fail(ERROR_CODES.E_INTERNAL, '模板加载失败');
  return validateTemplate(await res.json());
}
