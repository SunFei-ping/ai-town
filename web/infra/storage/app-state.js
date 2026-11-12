/**
 * 当前小镇的指针。小镇数据本身存在 IndexedDB，这里只记 id。
 * 清浏览器数据即丢失，这是首版「不支持跨设备」的既然后果（ADR-003）。
 */
const KEY = 'ai-town.current-town';

export function getCurrentTownId() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setCurrentTownId(townId) {
  try {
    localStorage.setItem(KEY, townId);
  } catch {
    /* 隐私模式下忽略 */
  }
}

export function clearCurrentTownId() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 隐私模式下忽略 */
  }
}
