import 'fake-indexeddb/auto';
import { closeDB } from '../../web/infra/storage/idb.js';
import { DB_NAME } from '../../web/infra/storage/schema.js';

/** 每个用例前清空数据库，保证互不影响 */
export async function resetDB() {
  await closeDB();
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

export function agentFixture(index = 0) {
  const names = ['陈望', '林小满', '周秀兰', '阿彪', '苗苗'];
  return {
    name: names[index] ?? `居民${index}`,
    age: 20 + index,
    occupation: '测试职业',
    persona: '测试人设',
    secret: '测试秘密',
    conflict_goal: '测试目标',
    speech_style: '测试口癖',
  };
}

export function fiveAgents() {
  return [0, 1, 2, 3, 4].map(agentFixture);
}
