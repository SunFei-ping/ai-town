/**
 * 模板只读端点，见 SPCD §7.2 端点 3 / 4 与 §7.4。
 *
 * 数据源与前端静态加载共用 data/templates/*.json，保证只有一份事实源：
 * 端点不写库、不鉴权、不做任何缓存，只把静态模板按契约形状返回。
 */
import indexData from '../../data/templates/index.json' with { type: 'json' };
import seaside from '../../data/templates/seaside.json' with { type: 'json' };
import campus from '../../data/templates/campus.json' with { type: 'json' };
import demolition from '../../data/templates/demolition.json' with { type: 'json' };

import { validateTemplate, validateTemplateMeta } from '../../shared/contracts/template.js';
import { toErrorResult, errorResult, JSON_HEADERS } from '../guard/http.js';
import { ERROR_CODES } from '../../shared/errors/codes.js';

const TEMPLATES = new Map(
  [seaside, campus, demolition].map((template) => [template.id, template])
);

const PATH_PATTERN = /^\/v1\/templates(?:\/([^/]+))?\/?$/;

function resolveTemplateId(path, explicit) {
  if (explicit) return decodeURIComponent(explicit);
  const match = PATH_PATTERN.exec(String(path ?? ''));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export default async function handler(options = {}) {
  const { method, path, templateId } = options;

  if (method !== 'GET') {
    return errorResult(ERROR_CODES.E_VALIDATION, 'templates 只支持 GET');
  }

  const id = resolveTemplateId(path, templateId);

  try {
    if (!id) {
      const templates = indexData.templates.map((meta) => validateTemplateMeta(meta));
      return { status: 200, headers: JSON_HEADERS, body: { templates } };
    }

    const template = TEMPLATES.get(id);
    if (!template) {
      return errorResult(ERROR_CODES.E_VALIDATION, `模板不存在：${id}`);
    }
    return { status: 200, headers: JSON_HEADERS, body: { template: validateTemplate(template) } };
  } catch (err) {
    return toErrorResult(err);
  }
}
