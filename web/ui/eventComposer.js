/**
 * 事件输入组件，见 task.md M6-02。
 * 每天至多 1 条：提交后输入禁用并回显内容。
 */
import { EVENT_TYPES, FIELD_LIMITS } from '../../shared/contracts/index.js';
import { validateEventInput } from '../../shared/contracts/event.js';

export const EVENT_TYPE_LABELS = Object.freeze({
  weather: '天气变化',
  newcomer: '外地人来镇',
  loss: '失物',
  business: '新店开张或歇业',
  rumor: '流言',
});

const PLACEHOLDERS = Object.freeze({
  weather: '例如：连下三天雨',
  newcomer: '例如：一个背吉他的年轻人住进了旅店',
  loss: '例如：有人在码头丢了一个钱包',
  business: '例如：五金店对面开了家便利店',
  rumor: '例如：有人在传陈望要卖店',
});

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * @param {{ onSubmit: (event: {type:string,payload:string}) => Promise<object> }} options
 */
export function createEventComposer({ onSubmit }) {
  const card = el('div', 'card stack event-composer');
  card.dataset.component = 'event-composer';

  const head = el('div', 'row event-composer__head');
  const title = el('h3', null, '给小镇投递一件外部事件');
  const dayTag = el('span', 'muted event-composer__day');
  head.append(title, dayTag);

  const hint = el(
    'p',
    'muted',
    '只能描述外部发生的事，不能指挥居民。每天至多 1 条，会在下一天生效。'
  );

  const grid = el('div', 'grid-2');
  const typeField = el('div', 'field');
  const typeLabel = el('label', null, '类型');
  const select = el('select', 'select');
  for (const type of EVENT_TYPES) {
    const option = el('option', null, EVENT_TYPE_LABELS[type] ?? type);
    option.value = type;
    select.append(option);
  }
  typeField.append(typeLabel, select);

  const payloadField = el('div', 'field');
  const payloadLabel = el('label', null, '事件内容');
  const textarea = el('textarea', 'textarea');
  textarea.maxLength = FIELD_LIMITS.EVENT_PAYLOAD_MAX;
  textarea.placeholder = PLACEHOLDERS[select.value] ?? '';
  textarea.rows = 3;
  payloadField.append(payloadLabel, textarea);
  grid.append(typeField, payloadField);

  select.addEventListener('change', () => {
    textarea.placeholder = PLACEHOLDERS[select.value] ?? '';
  });

  const actions = el('div', 'row');
  const submit = el('button', 'primary', '投递事件');
  const error = el('span', 'notice');
  error.hidden = true;
  actions.append(submit, error);

  const echo = el('p', 'event-composer__echo');
  echo.hidden = true;

  card.append(head, hint, grid, actions, echo);

  let currentDay = null;
  let existing = null;
  let disabled = false;

  function sync() {
    const submitted = Boolean(existing);
    const locked = disabled || submitted;
    select.disabled = locked;
    textarea.disabled = locked;
    submit.disabled = locked;
    card.dataset.state = submitted ? 'submitted' : disabled ? 'disabled' : 'idle';

    dayTag.textContent = currentDay ? `第 ${currentDay} 天` : '';
    if (submitted) {
      const label = EVENT_TYPE_LABELS[existing.type] ?? existing.type;
      echo.textContent = `已提交：${label} · ${existing.payload}`;
      echo.hidden = false;
      error.hidden = true;
    } else {
      echo.hidden = true;
    }
  }

  submit.addEventListener('click', async () => {
    if (disabled || existing) return;
    error.hidden = true;

    let validated;
    try {
      validated = validateEventInput({ type: select.value, payload: textarea.value });
    } catch (err) {
      error.textContent = err.message ?? '事件内容不合法';
      error.hidden = false;
      return;
    }

    submit.disabled = true;
    try {
      const saved = await onSubmit?.(validated);
      existing = saved ?? { ...validated };
      textarea.value = '';
      sync();
    } catch (err) {
      const message =
        err?.code === 'E_CONTENT_BLOCKED'
          ? '事件内容未通过安全校验，请换一种说法'
          : err?.message ?? '事件提交失败';
      error.textContent = message;
      error.hidden = false;
      submit.disabled = false;
    }
  });

  return {
    element: card,
    /** @param {{day:number, existing?:object|null, disabled?:boolean}} state */
    update({ day, existing: nextExisting = null, disabled: nextDisabled = false } = {}) {
      currentDay = day ?? null;
      existing = nextExisting;
      disabled = Boolean(nextDisabled);
      sync();
    },
  };
}
