/**
 * IndexedDB 不可用时的内存兜底，见 task.md M6-06。
 *
 * 只实现 idb.js 需要的最小操作集合；数据随页面刷新丢失，
 * 因此界面必须常驻提示用户及时导出。
 */
import { STORES } from './schema.js';

const stores = new Map();

function clone(value) {
  if (value === undefined) return value;
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function storeOf(name) {
  const def = STORES[name];
  if (!def) throw new Error(`未知的表 ${name}`);
  if (!stores.has(name)) stores.set(name, new Map());
  return stores.get(name);
}

function keyOf(name, record) {
  return record?.[STORES[name].keyPath];
}

function indexDefinition(name, indexName) {
  const index = STORES[name]?.indexes.find((item) => item.name === indexName);
  if (!index) throw new Error(`未知的索引 ${name}.${indexName}`);
  return index;
}

function indexKeyOf(name, indexName, record) {
  const { keyPath } = indexDefinition(name, indexName);
  return Array.isArray(keyPath) ? keyPath.map((path) => record?.[path]) : record?.[keyPath];
}

function equals(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => value === b[index]);
  }
  return a === b;
}

function startsWith(key, prefix) {
  const keyParts = Array.isArray(key) ? key : [key];
  const prefixParts = Array.isArray(prefix) ? prefix : [prefix];
  if (keyParts.length < prefixParts.length) return false;
  return prefixParts.every((value, index) => keyParts[index] === value);
}

export function get(name, key) {
  const found = storeOf(name).get(key);
  return clone(found);
}

export function put(name, record) {
  storeOf(name).set(keyOf(name, record), clone(record));
  return clone(record);
}

export function del(name, key) {
  return storeOf(name).delete(key);
}

export function getAll(name) {
  return clone([...storeOf(name).values()]);
}

export function getAllByIndex(name, indexName, key) {
  indexDefinition(name, indexName);
  const rows = [...storeOf(name).values()].filter((record) =>
    equals(indexKeyOf(name, indexName, record), key)
  );
  return clone(rows);
}

export function getAllByIndexPrefix(name, indexName, prefix) {
  indexDefinition(name, indexName);
  const rows = [...storeOf(name).values()].filter((record) =>
    startsWith(indexKeyOf(name, indexName, record), prefix)
  );
  return clone(rows);
}

export function deleteByIndex(name, indexName, key) {
  indexDefinition(name, indexName);
  const store = storeOf(name);
  for (const [primaryKey, record] of [...store.entries()]) {
    if (equals(indexKeyOf(name, indexName, record), key)) store.delete(primaryKey);
  }
}

export function deleteByIndexPrefix(name, indexName, prefix) {
  indexDefinition(name, indexName);
  const store = storeOf(name);
  for (const [primaryKey, record] of [...store.entries()]) {
    if (startsWith(indexKeyOf(name, indexName, record), prefix)) store.delete(primaryKey);
  }
}

export function clearAll() {
  for (const store of stores.values()) store.clear();
  stores.clear();
}
