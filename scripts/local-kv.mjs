/**
 * 本地开发用的边缘 KV 模拟。
 * 只实现 SPCD §10.3 需要的四类能力：set / get / delete / incr，全部带 TTL。
 * 生产环境由平台的 KV 实现，本文件不参与部署。
 */
export class LocalKV {
  #store = new Map();

  #read(key) {
    const entry = this.#store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.#store.delete(key);
      return undefined;
    }
    return entry;
  }

  set(key, value, ttlSeconds = null) {
    const expiresAt = ttlSeconds === null ? null : Date.now() + ttlSeconds * 1000;
    this.#store.set(key, { value, expiresAt });
    return true;
  }

  get(key) {
    return this.#read(key)?.value;
  }

  has(key) {
    return this.#read(key) !== undefined;
  }

  delete(key) {
    return this.#store.delete(key);
  }

  incr(key, ttlSeconds = 60) {
    const entry = this.#read(key);
    if (!entry) {
      this.set(key, 1, ttlSeconds);
      return 1;
    }
    const next = Number(entry.value) + 1;
    this.#store.set(key, { value: next, expiresAt: entry.expiresAt });
    return next;
  }

  ttlMs(key) {
    const entry = this.#read(key);
    if (!entry || entry.expiresAt === null) return null;
    return Math.max(0, entry.expiresAt - Date.now());
  }

  size() {
    return this.#store.size;
  }

  clear() {
    this.#store.clear();
  }
}
