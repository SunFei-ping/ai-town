/**
 * IndexedDB 的最小适配层。
 * 只提供 SPCD §6 需要的原子操作，不做业务校验（校验在 dao.js）。
 *
 * IndexedDB 不可用（隐私模式、被策略禁用）时自动降级到内存实现，
 * 由界面常驻提示「刷新即丢失」（task.md M6-06）。
 */
import { DB_NAME, DB_VERSION, STORES } from './schema.js';
import * as memory from './memoryFallback.js';

let dbPromise = null;
let fallback = false;

function upgrade(db) {
  for (const [name, def] of Object.entries(STORES)) {
    if (db.objectStoreNames.contains(name)) continue;
    const store = db.createObjectStore(name, { keyPath: def.keyPath });
    for (const index of def.indexes) {
      store.createIndex(index.name, index.keyPath, { unique: Boolean(index.unique) });
    }
  }
}

function indexedDBAvailable() {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

/** 是否已降级到内存存储 */
export function isMemoryFallback() {
  return fallback;
}

/** 探测当前存储模式，供界面提示使用 */
export async function storageMode() {
  await openDB();
  return fallback ? 'memory' : 'indexeddb';
}

export function openDB() {
  if (fallback) return Promise.resolve(null);
  if (!indexedDBAvailable()) {
    fallback = true;
    return Promise.resolve(null);
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => upgrade(req.result);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch(() => {
      // 隐私模式下 open 可能直接失败：降级而不是让整个应用挂掉
      fallback = true;
      dbPromise = null;
      return null;
    });
  }
  return dbPromise;
}

async function run(storeName, mode, executor) {
  const db = await openDB();
  if (!db) throw new Error('IndexedDB 不可用');
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    try {
      result = executor(store);
    } catch (err) {
      reject(err);
      return;
    }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function toPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function get(storeName, key) {
  const db = await openDB();
  if (!db) return memory.get(storeName, key);
  const tx = db.transaction(storeName, 'readonly');
  return toPromise(tx.objectStore(storeName).get(key));
}

export async function put(storeName, record) {
  const db = await openDB();
  if (!db) return memory.put(storeName, record);
  await run(storeName, 'readwrite', (store) => store.put(record));
  return record;
}

export async function del(storeName, key) {
  const db = await openDB();
  if (!db) return memory.del(storeName, key);
  await run(storeName, 'readwrite', (store) => store.delete(key));
  return undefined;
}

export async function getAll(storeName) {
  const db = await openDB();
  if (!db) return memory.getAll(storeName);
  const tx = db.transaction(storeName, 'readonly');
  return toPromise(tx.objectStore(storeName).getAll());
}

export async function getAllByIndex(storeName, indexName, key) {
  const db = await openDB();
  if (!db) return memory.getAllByIndex(storeName, indexName, key);
  const tx = db.transaction(storeName, 'readonly');
  return toPromise(tx.objectStore(storeName).index(indexName).getAll(key));
}

/**
 * 复合索引的前缀查询：取 keyPath 以 prefix 开头的所有记录。
 * IndexedDB 的键比较中数组排在数字之后，所以上界用 [...prefix, []]。
 */
export async function getAllByIndexPrefix(storeName, indexName, prefix) {
  const db = await openDB();
  if (!db) return memory.getAllByIndexPrefix(storeName, indexName, prefix);
  const tx = db.transaction(storeName, 'readonly');
  const range = IDBKeyRange.bound(prefix, [...prefix, []]);
  return toPromise(tx.objectStore(storeName).index(indexName).getAll(range));
}

export async function deleteByIndexPrefix(storeName, indexName, prefix) {
  const db = await openDB();
  if (!db) {
    memory.deleteByIndexPrefix(storeName, indexName, prefix);
    return;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const range = IDBKeyRange.bound(prefix, [...prefix, []]);
    const req = tx.objectStore(storeName).index(indexName).openCursor(range);
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteByIndex(storeName, indexName, key) {
  const db = await openDB();
  if (!db) {
    memory.deleteByIndex(storeName, indexName, key);
    return;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const index = tx.objectStore(storeName).index(indexName);
    const req = index.openCursor(key);
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAll() {
  const db = await openDB();
  if (!db) {
    memory.clearAll();
    return;
  }
  for (const name of Object.keys(STORES)) {
    await run(name, 'readwrite', (store) => store.clear());
  }
}

export async function closeDB() {
  if (!dbPromise) return;
  const db = await dbPromise;
  db?.close();
  dbPromise = null;
}
