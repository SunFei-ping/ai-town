import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import {
  validateTemplate,
  validateTemplateMeta,
} from '../../shared/contracts/template.js';

const TEMPLATE_DIR = new URL('../../data/templates/', import.meta.url);

function readJson(name) {
  return JSON.parse(readFileSync(new URL(name, TEMPLATE_DIR), 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function expectValidation(run) {
  let error = null;
  try {
    run();
  } catch (err) {
    error = err;
  }
  expect(error?.code).toBe('E_VALIDATION');
}

const templateFiles = readdirSync(TEMPLATE_DIR).filter(
  (name) => name.endsWith('.json') && name !== 'index.json'
);
const seaside = readJson('seaside.json');

describe('模板契约（template）', () => {
  it('全部模板数据通过校验，各恰好 5 人且名字唯一', () => {
    expect(templateFiles.length).toBeGreaterThan(0);
    for (const file of templateFiles) {
      const template = validateTemplate(readJson(file));
      const names = template.agents.map((agent) => agent.name);
      expect(template.agents).toHaveLength(5);
      expect(new Set(names).size).toBe(5);
    }
  });

  it('模板索引元信息通过校验', () => {
    const index = readJson('index.json');
    expect(index.templates.length).toBeGreaterThan(0);
    for (const meta of index.templates) {
      expect(validateTemplateMeta(meta)).toEqual(meta);
    }
  });

  it('templates-all：三套模板齐全，各 5 人且与索引一致', () => {
    const index = readJson('index.json');
    const ids = index.templates.map((meta) => meta.id);
    expect(new Set(ids)).toEqual(new Set(['seaside', 'campus', 'demolition']));

    for (const meta of index.templates) {
      const template = validateTemplate(readJson(`${meta.id}.json`));
      expect(template.id).toBe(meta.id);
      expect(template.name).toBe(meta.name);
      expect(template.agents).toHaveLength(5);
    }
  });

  it('居民不足 5 人返回 E_VALIDATION', () => {
    const broken = clone(seaside);
    broken.agents = broken.agents.slice(0, 4);
    expectValidation(() => validateTemplate(broken));
  });

  it('字段缺失或超长返回 E_VALIDATION', () => {
    const missing = clone(seaside);
    delete missing.agents[1].speech_style;
    expectValidation(() => validateTemplate(missing));

    const tooLong = clone(seaside);
    tooLong.agents[0].persona = '人'.repeat(301);
    expectValidation(() => validateTemplate(tooLong));

    const noScene = clone(seaside);
    delete noScene.opening_scene;
    expectValidation(() => validateTemplate(noScene));
  });

  it('模板内居民重名返回 E_VALIDATION', () => {
    const broken = clone(seaside);
    broken.agents[1].name = broken.agents[0].name;
    expectValidation(() => validateTemplate(broken));
  });

  it('含真实个人信息返回 E_VALIDATION', () => {
    const broken = clone(seaside);
    broken.agents[0].persona = '联系电话 13800138000';
    expectValidation(() => validateTemplate(broken));

    const email = clone(seaside);
    email.agents[2].secret = '邮箱 someone@example.com';
    expectValidation(() => validateTemplate(email));
  });

  it('元信息缺少字段或人数不符返回 E_VALIDATION', () => {
    expectValidation(() => validateTemplateMeta({ ...readJson('index.json').templates[0], agent_count: 4 }));
    expectValidation(() => validateTemplateMeta({ ...readJson('index.json').templates[0], cover_hue: 400 }));
    expectValidation(() => validateTemplateMeta({ ...readJson('index.json').templates[0], name: '' }));
  });
});
