import { describe, it, expect } from 'vitest';
import * as contracts from '../../shared/contracts/index.js';

describe('契约常量快照', () => {
  it('枚举与上限保持稳定', () => {
    expect({
      townStatuses: contracts.TOWN_STATUSES,
      tickStates: contracts.TICK_STATES,
      dayStatuses: contracts.DAY_STATUSES,
      memoryTiers: contracts.MEMORY_TIERS,
      relationLabels: contracts.RELATION_LABELS,
      sectionKinds: contracts.SECTION_KINDS,
      reportGenerationModes: contracts.REPORT_GENERATION_MODES,
      eventTypes: contracts.EVENT_TYPES,
      frameTypes: contracts.FRAME_TYPES,
      usageStages: contracts.USAGE_STAGES,
      paceModes: contracts.PACE_MODES,
      limits: contracts.LIMITS,
      fieldLimits: contracts.FIELD_LIMITS,
    }).toMatchSnapshot();
  });

  it('版本号与服务端约定一致', () => {
    expect(contracts.API_VERSION).toBe('v1');
    expect(contracts.SCHEMA_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
