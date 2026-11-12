let counter = 0;

/**
 * 生成一个可按字典序大致排序的短 id。
 * 形如 时间戳36进制(9位) + 随机(8位) + 进程内计数器(2位)
 */
export function newId(prefix = '') {
  const time = Date.now().toString(36).padStart(9, '0');
  const rand = Math.random().toString(36).slice(2, 10).padEnd(8, '0');
  counter = (counter + 1) % 1296;
  const seq = counter.toString(36).padStart(2, '0');
  const id = `${time}${rand}${seq}`;
  return prefix ? `${prefix}_${id}` : id;
}
