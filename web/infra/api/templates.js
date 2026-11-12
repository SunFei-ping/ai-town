/**
 * 模板加载：结构校验的唯一事实源在 shared/contracts/template.js。
 * 模板数据放在 data/templates 下，见 SPCD §7.4。
 */
import { fail } from '../../../shared/errors/app-error.js';
import { ERROR_CODES } from '../../../shared/errors/codes.js';
import { validateTemplate, validateTemplateMeta } from '../../../shared/contracts/template.js';

export async function listTemplates() {
  const res = await fetch('/data/templates/index.json');
  if (!res.ok) fail(ERROR_CODES.E_INTERNAL, '模板索引加载失败');
  const data = await res.json();
  return (data.templates ?? []).map(validateTemplateMeta);
}

export async function loadTemplate(templateId) {
  const res = await fetch(`/data/templates/${templateId}.json`);
  if (!res.ok) fail(ERROR_CODES.E_INTERNAL, '模板加载失败');
  return validateTemplate(await res.json());
}
