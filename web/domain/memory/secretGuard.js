/**
 * C5 落地：secret 三级检测（词表 → 语义 → 重写），见 SPCD §8.6。
 *
 * - 词表：从 secret 抽取长度 ≥2 的关键短语，命中即判定泄露
 * - 语义：可注入一个轻量判定函数（M5 接真实模型），命中同样视为泄露
 * - 重写：命中后重写 1 次；仍命中则整句替换为通用表达
 *
 * 判定结果与重写次数写入 USAGE，用于观察泄露率。
 */
import * as dao from '../../infra/storage/dao.js';
import { USAGE_STAGES } from '../../../shared/contracts/index.js';

export const SECRET_FALLBACK = '有些话，想了想，还是没说出口。';

const SEPARATORS = /[^\p{L}\p{N}]+/gu;
/** 专名（老赵 / 小满 / 阿彪）或明确的数量词，才允许作为 2 字敏感片段 */
const DISTINCTIVE_SHORT =
  /^[老小阿][\p{L}]$|^[0-9]+(?:万|千|百|块|元|岁)?$|^[一二三四五六七八九十百千万亿两]+(?:万|千|百|块|元|岁)$/u;
/** 整段复述达到该长度才判为词表泄露，避免常用词误伤正常对话 */
const MIN_PHRASE_LENGTH = 5;

/**
 * 抽取敏感词：完整短语 + 5 字滑窗 + 有辨识度的专名/数量片段。
 * 不把每个 2 字碎片都当敏感词，否则「人的」「一个」「故事」会误伤正常对话。
 */
export function extractSecretTerms(secret) {
  if (typeof secret !== 'string' || secret.trim() === '') return [];
  const terms = new Set();

  for (const segment of secret.split(SEPARATORS)) {
    const phrase = segment.trim();
    if (phrase.length < 2) continue;

    if (phrase.length >= MIN_PHRASE_LENGTH) terms.add(phrase);

    for (let index = 0; index + 2 <= phrase.length; index += 2) {
      const bigram = phrase.slice(index, index + 2);
      if (DISTINCTIVE_SHORT.test(bigram)) terms.add(bigram);
    }

    for (let index = 0; index + MIN_PHRASE_LENGTH <= phrase.length; index += 1) {
      terms.add(phrase.slice(index, index + MIN_PHRASE_LENGTH));
    }
  }

  return [...terms];
}

export function inspectText(text, secrets = []) {
  const source = String(text ?? '');
  const terms = [...new Set(secrets.flatMap(extractSecretTerms))];
  const hits = terms.filter((term) => source.includes(term));
  return { hits, leaked: hits.length > 0 };
}

function maskTerms(text, hits) {
  let masked = text;
  for (const term of hits) {
    masked = masked.split(term).join('……');
  }
  return masked;
}

async function safeSemanticCheck(semanticCheck, text) {
  if (typeof semanticCheck !== 'function') return false;
  try {
    return Boolean(await semanticCheck(text));
  } catch {
    return false;
  }
}

/** 命中词表的句子整句替换为通用表达 */
async function replaceOffendingSentences(text, hits, semanticCheck) {
  const sentences = text.match(/[^。！？!?\n]+[。！？!?]?/gu) ?? [text];
  const replaced = [];
  for (const sentence of sentences) {
    const wordHit = hits.some((term) => sentence.includes(term));
    const semanticHit = wordHit ? false : await safeSemanticCheck(semanticCheck, sentence);
    replaced.push(wordHit || semanticHit ? SECRET_FALLBACK : sentence);
  }
  return replaced.join('');
}

/**
 * 对一段文本执行三级检测。
 * @param {object} options
 * @param {string} options.text
 * @param {string[]} options.secrets 全部居民的 secret，正文不得出现任何一条
 * @param {(payload: { text: string, hits: string[], secrets: string[] }) => Promise<string>|string} [options.rewrite]
 * @param {(text: string) => Promise<boolean>|boolean} [options.semanticCheck]
 */
export async function guardText({
  text,
  secrets = [],
  rewrite,
  semanticCheck,
  fallback = SECRET_FALLBACK,
}) {
  const source = String(text ?? '');
  const initial = inspectText(source, secrets);
  const semanticLeak = await safeSemanticCheck(semanticCheck, source);

  if (!initial.leaked && !semanticLeak) {
    return {
      text: source,
      hits: [],
      rewrites: 0,
      replaced: false,
      usage: { secret_hits: 0, secret_rewrites: 0 },
    };
  }

  // 第 3 级：重写 1 次
  let rewritten;
  if (typeof rewrite === 'function') {
    try {
      rewritten = await rewrite({ text: source, hits: initial.hits, secrets });
    } catch {
      rewritten = null;
    }
  }
  const rewrittenText =
    typeof rewritten === 'string' && rewritten.trim() !== ''
      ? rewritten
      : maskTerms(source, initial.hits);

  // 重写后仍命中：整句替换
  const after = inspectText(rewrittenText, secrets);
  const semanticAfter = await safeSemanticCheck(semanticCheck, rewrittenText);
  let finalText = rewrittenText;
  let replaced = false;
  if (after.leaked || semanticAfter) {
    finalText = await replaceOffendingSentences(rewrittenText, after.hits, semanticCheck);
    if (finalText === rewrittenText) finalText = fallback;
    replaced = true;
  }

  return {
    text: finalText,
    hits: initial.hits,
    rewrites: 1,
    replaced,
    usage: { secret_hits: initial.hits.length, secret_rewrites: 1 },
  };
}

/** 对一段对话的每轮正文执行检测 */
export async function guardDialogue({ dialogue, secrets, rewrite, semanticCheck }) {
  const transcript = [];
  let secretHits = 0;
  let secretRewrites = 0;

  for (const round of dialogue.transcript ?? []) {
    const result = await guardText({
      text: round.content,
      secrets,
      rewrite,
      semanticCheck,
    });
    secretHits += result.usage.secret_hits;
    secretRewrites += result.usage.secret_rewrites;
    transcript.push({ ...round, content: result.text });
  }

  return {
    dialogue: { ...dialogue, transcript },
    usage: { secret_hits: secretHits, secret_rewrites: secretRewrites },
  };
}

/** 泄露判定写入 USAGE；没有命中时不落库 */
export async function writeGuardUsage({ townId, day, stage, usage }) {
  if (!usage || usage.secret_hits <= 0) return null;
  if (!USAGE_STAGES.includes(stage)) return null;
  return dao.addUsage({
    town_id: townId,
    day,
    stage,
    input_tokens: 0,
    output_tokens: 0,
    duration_ms: 0,
    secret_hits: usage.secret_hits,
    secret_rewrites: usage.secret_rewrites,
  });
}
