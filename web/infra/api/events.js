/**
 * 事件端点客户端，见 SPCD §7.2 端点 6。
 * 只有连接真实模型（持有会话）时才走服务端；否则前端本地校验后直接落库。
 */
import { AppError } from '../../../shared/errors/app-error.js';
import { ERROR_CODES } from '../../../shared/errors/codes.js';

export async function submitEvent({
  townId,
  day,
  type,
  payload,
  sessionToken,
  idempotencyKey,
  fetchImpl = globalThis.fetch,
}) {
  const headers = {
    Authorization: `Bearer ${sessionToken ?? ''}`,
    'Content-Type': 'application/json',
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  const res = await fetchImpl(`/v1/towns/${encodeURIComponent(townId)}/events`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ day, type, payload }),
  });
  const data = await res.json().catch(() => null);

  if (!res.ok) {
    throw new AppError(
      data?.error?.code ?? ERROR_CODES.E_INTERNAL,
      data?.error?.message ?? '事件提交失败',
      data
    );
  }
  return data?.event ?? null;
}
