/**
 * 部署脚本，见 SPCD §13.3 / §13.4 与 task.md M6-07。
 *
 * 静态与函数分别发布：
 * 1) 静态资源 → Cloudflare Pages（web/）
 * 2) 函数 → Cloudflare Workers（functions/worker.js）
 * 3) 发布后跑远端冒烟，校验 /v1/health 的版本字段
 *
 * 需要的环境变量：
 * - CF_PAGES_PROJECT   Pages 项目名（必填）
 * - BASE_URL           部署后的访问地址；缺省时按 Pages 默认域名推导
 * - MODEL_BASE_URL     模型服务地址（必填，写入 Worker 变量）
 * - MODEL_NAME         模型名（可选，默认 deepseek-chat）
 * - CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID（CI 中必填；本地可先 wrangler login）
 *
 * 用法：
 *   npm run deploy:preview
 *   npm run deploy:preview -- --dry-run
 */
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const envIndex = args.findIndex((a) => a === '--env');
const deployEnv = envIndex >= 0 ? args[envIndex + 1] : 'preview';

function fail(message) {
  console.error(`[deploy] ${message}`);
  process.exit(1);
}

function npxBin() {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

function run(command, commandArgs, extraEnv = {}) {
  const printable = [command, ...commandArgs].join(' ');
  console.log(`[deploy] ${printable}`);
  if (dryRun) return 0;
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
    shell: false,
  });
  if (result.error) fail(`执行失败：${result.error.message}`);
  if (result.status !== 0) fail(`命令失败（exit ${result.status}）：${printable}`);
  return result.status ?? 0;
}

if (!['preview', 'production'].includes(deployEnv)) {
  fail(`未知环境：${deployEnv}（只支持 preview / production）`);
}

const project = process.env.CF_PAGES_PROJECT;
const modelBaseUrl = process.env.MODEL_BASE_URL;
const modelName = process.env.MODEL_NAME ?? 'deepseek-chat';
const baseUrl =
  process.env.BASE_URL ??
  (project
    ? deployEnv === 'production'
      ? `https://${project}.pages.dev`
      : `https://${deployEnv}.${project}.pages.dev`
    : '');

if (!dryRun) {
  if (!project) fail('缺少 CF_PAGES_PROJECT（Cloudflare Pages 项目名）');
  if (!modelBaseUrl) fail('缺少 MODEL_BASE_URL（模型服务地址）');
  if (!baseUrl) fail('缺少 BASE_URL，且无法从项目名推导');
  if (!process.env.CLOUDFLARE_API_TOKEN) {
    console.warn('[deploy] 未设置 CLOUDFLARE_API_TOKEN，将依赖本机 wrangler login 的登录态');
  }
}

console.log(`[deploy] 环境：${deployEnv}${dryRun ? '（dry-run）' : ''}`);
console.log(`[deploy] 静态：web/ → ${project ?? '<CF_PAGES_PROJECT>'}`);
console.log(`[deploy] 函数：functions/worker.js → ai-town-api-${deployEnv}`);
console.log(`[deploy] 校验地址：${baseUrl || '<BASE_URL>'}`);

// 1) 静态资源
run(npxBin(), [
  'wrangler',
  'pages',
  'deploy',
  'web',
  '--project-name',
  project ?? 'ai-town',
  '--branch',
  deployEnv === 'production' ? 'main' : deployEnv,
  '--commit-dirty=true',
]);

// 2) 函数与 KV 绑定
run(npxBin(), [
  'wrangler',
  'deploy',
  '--env',
  deployEnv,
  '--var',
  `MODEL_BASE_URL:${modelBaseUrl ?? 'https://api.deepseek.com/v1'}`,
  '--var',
  `MODEL_NAME:${modelName}`,
]);

// 3) 远端冒烟（含版本兼容校验）
if (baseUrl) {
  run(process.execPath, [join(root, 'scripts', 'smoke.mjs'), '--remote'], {
    BASE_URL: baseUrl,
  });
} else {
  console.warn('[deploy] 未提供 BASE_URL，跳过远端冒烟');
}

console.log('[deploy] 完成。静态与函数必须同版本发布；回滚时以整体版本为单位。');
