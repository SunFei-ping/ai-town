import { AppError } from '../../../shared/errors/app-error.js';
import { ERROR_CODES } from '../../../shared/errors/codes.js';

export const DB_NAME = 'ai-town';
export const DB_VERSION = 1;

/**
 * 表与索引定义，与 docs/spcd.md §6.2 / §6.3 一一对应。
 * 共 11 张表、10 条索引。
 */
export const STORES = Object.freeze({
  town: {
    keyPath: 'id',
    indexes: [],
  },
  agent: {
    keyPath: 'id',
    indexes: [
      { name: 'by_town', keyPath: 'town_id' },
      { name: 'by_town_name', keyPath: ['town_id', 'name'], unique: true },
    ],
  },
  day_state: {
    keyPath: 'id',
    indexes: [{ name: 'by_town_day', keyPath: ['town_id', 'day'], unique: true }],
  },
  memory: {
    keyPath: 'id',
    indexes: [
      { name: 'by_agent_tier', keyPath: ['agent_id', 'tier'] },
      { name: 'by_agent_target', keyPath: ['agent_id', 'target_agent_id'] },
    ],
  },
  relation: {
    keyPath: 'id',
    indexes: [
      { name: 'by_town', keyPath: 'town_id' },
      { name: 'by_pair', keyPath: ['from_agent_id', 'to_agent_id'], unique: true },
    ],
  },
  event: {
    keyPath: 'id',
    indexes: [{ name: 'by_town_day', keyPath: ['town_id', 'day'] }],
  },
  dialogue: {
    keyPath: 'id',
    indexes: [{ name: 'by_town_day_hour', keyPath: ['town_id', 'day', 'hour'] }],
  },
  daily_report: {
    keyPath: 'id',
    indexes: [{ name: 'by_town_day', keyPath: ['town_id', 'day'], unique: true }],
  },
  report_section: {
    keyPath: 'id',
    indexes: [{ name: 'by_report', keyPath: 'report_id' }],
  },
  unsay: {
    keyPath: 'id',
    indexes: [{ name: 'by_report', keyPath: 'report_id' }],
  },
  usage: {
    keyPath: 'id',
    indexes: [{ name: 'by_town_day', keyPath: ['town_id', 'day'] }],
  },
});

/** 删除小镇时需要级联清理的子表 */
export const CASCADE_STORES = Object.freeze([
  'agent',
  'day_state',
  'memory',
  'relation',
  'event',
  'dialogue',
  'daily_report',
  'report_section',
  'unsay',
  'usage',
]);

export function validateSchema(db) {
  for (const [name, def] of Object.entries(STORES)) {
    if (!db.objectStoreNames.contains(name)) {
      throw new AppError(ERROR_CODES.E_INTERNAL, `缺少表 ${name}`);
    }
  }
  return true;
}
