/**
 * 用户事件内容校验，见 SPCD §7.7。
 * 规则本体在 shared/contracts/event.js，前后端共用同一份实现。
 */
export { validateEventInput } from '../../shared/contracts/event.js';
