/**
 * 前后端共享契约的唯一事实源。
 * 本文件只放枚举、常量与运行上限；具体的请求/响应 schema
 * 由后续任务按 SPCD §7.3 / §7.4 / §7.7 / §6.2 逐个补入。
 */

export const API_VERSION = 'v1';
export const SCHEMA_VERSION = '1.0.0';

/** 小镇生命周期，见 SPCD §8.1 */
export const TOWN_STATUSES = Object.freeze([
  'draft',
  'configuring',
  'running',
  'completed',
]);

/** Tick 状态，见 SPCD §8.2 */
export const TICK_STATES = Object.freeze([
  'idle',
  'validating',
  'planning',
  'simulating',
  'reflecting',
  'reporting',
  'degraded',
  'done',
  'rejected',
]);

/** 当日状态，见 SPCD §6.2 */
export const DAY_STATUSES = Object.freeze([
  'pending',
  'running',
  'done',
  'partial',
]);

/** 记忆分层，见 SPCD §8.6 */
export const MEMORY_TIERS = Object.freeze([
  'event',
  'summary',
  'impression',
]);

/** 关系标签，见 SPCD §8.5 */
export const RELATION_LABELS = Object.freeze([
  'stranger',
  'familiar',
  'friend',
  'knot',
]);

/** 小报版块类型，见 SPCD §6.2 */
export const SECTION_KINDS = Object.freeze([
  'headline',
  'scene',
  'relation',
  'unsaid',
]);

/** 小报生成模式，见 SPCD §6.2 */
export const REPORT_GENERATION_MODES = Object.freeze([
  'normal',
  'backfill',
  'degraded',
]);

/** 事件类型白名单，见 SPCD §7.7 */
export const EVENT_TYPES = Object.freeze([
  'weather',
  'newcomer',
  'loss',
  'business',
  'rumor',
]);

/** SSE 帧类型，见 SPCD §7.6 */
export const FRAME_TYPES = Object.freeze([
  'accepted',
  'planning',
  'dialogue',
  'unsaid',
  'report_ready',
  'warning',
  'error',
  'done',
]);

/** 模型调用阶段，用于 USAGE 计量，见 SPCD §6.2 */
export const USAGE_STAGES = Object.freeze([
  'plan',
  'dialogue',
  'unsay',
  'report',
]);

/** 节奏模式，见 SPCD §6.2 */
export const PACE_MODES = Object.freeze([
  'quick',
  'realtime',
]);

/** 运行上限初始值，见 SPCD §13.2 */
export const LIMITS = Object.freeze({
  SESSION_TTL_MS: 2 * 60 * 60 * 1000,
  BUDGET_PER_TOWN_YUAN: 5,
  CTX_TOKEN_LIMIT: 6000,
  MAX_DIALOGUE_ROUNDS: 6,
  SSE_HEARTBEAT_MS: 15000,
  RATE_LIMIT_PER_MIN: 6,
  BACKFILL_BATCH_DAYS: 2,
  TICK_LOCK_TTL_SECONDS: 600,
  MAX_PAYLOAD_BYTES: 256 * 1024,
  MAX_DIALOGUES_PER_HOUR: 2,
  AGENTS_PER_TOWN: 5,
  DAYS_PER_TOWN: 7,
});

/** 字段长度上限，见 SPCD §6.2 */
export const FIELD_LIMITS = Object.freeze({
  TOWN_NAME_MAX: 16,
  AGENT_NAME_MAX: 8,
  AGENT_PERSONA_MAX: 300,
  AGENT_SECRET_MAX: 200,
  AGENT_CONFLICT_GOAL_MAX: 200,
  AGENT_SPEECH_STYLE_MAX: 200,
  MEMORY_EVENT_MAX: 300,
  MEMORY_SUMMARY_MAX: 80,
  MEMORY_IMPRESSION_MAX: 120,
  EVENT_PAYLOAD_MAX: 200,
  WEATHER_MAX: 30,
  LOCATION_MAX: 20,
});

export const CONTRACTS = Object.freeze({
  version: SCHEMA_VERSION,
  apiVersion: API_VERSION,
});
