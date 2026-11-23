/**
 * 历史记录：把每次求解的输入、候选答案、求解器版本和用户标注的正确答案存下来。
 *
 * 目的是给「提升覆盖率」这件事攒素材——尤其是求解失败或答错的题，
 * 标注正确答案后可以一键导出成回归测试用例，直接补进 tests/run.ts。
 */
import { getSolverMeta, normalizeAnswer } from './search';

export type Verdict = 'correct' | 'wrong' | 'unsolved' | 'pending';

export interface CandidateRecord {
  value: string;
  pattern: string;
  score: number;
}

export interface HistoryItem {
  id: string;
  ts: number;
  input: string;
  options: string;
  depth: number;
  /** 求解器给出的候选答案，按复杂度排序 */
  candidates: CandidateRecord[];
  /** 用户标注的正确答案 */
  actual: string;
  verdict: Verdict;
  /** 命中的候选名次（0 起），未命中为 null */
  hitRank: number | null;
  ms: number;
  nodes: number;
  version: string;
  fingerprint: string;
}

const STORAGE_KEY = 'gwy-num-history-v1';
const MAX_ITEMS = 200;

export function loadHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((x) => x && typeof x.input === 'string');
  } catch {
    return [];
  }
}

export function saveHistory(items: HistoryItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
  } catch {
    /* 隐私模式下 localStorage 不可用，忽略即可 */
  }
}

export function judgeAnswer(
  actual: string,
  candidates: CandidateRecord[],
): { verdict: Verdict; hitRank: number | null } {
  const a = normalizeAnswer(actual);
  if (!a) return { verdict: candidates.length ? 'pending' : 'unsolved', hitRank: null };
  const idx = candidates.findIndex((c) => normalizeAnswer(c.value) === a);
  if (idx >= 0) return { verdict: 'correct', hitRank: idx };
  return { verdict: 'wrong', hitRank: null };
}

export function makeItem(params: {
  input: string;
  options: string;
  depth: number;
  candidates: CandidateRecord[];
  ms: number;
  nodes: number;
}): HistoryItem {
  const meta = getSolverMeta();
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ts: Date.now(),
    input: params.input,
    options: params.options,
    depth: params.depth,
    candidates: params.candidates,
    actual: '',
    verdict: params.candidates.length ? 'pending' : 'unsolved',
    hitRank: null,
    ms: params.ms,
    nodes: params.nodes,
    version: meta.version,
    fingerprint: meta.fingerprint,
  };
}

/** 同一题（输入+选项+深度都相同）只保留最新一条，避免反复求解刷屏 */
export function upsert(items: HistoryItem[], item: HistoryItem): HistoryItem[] {
  const key = (x: HistoryItem) => `${x.input}|${x.options}|${x.depth}`;
  const rest = items.filter((x) => key(x) !== key(item));
  // 若旧记录已标注过答案，保留标注
  const old = items.find((x) => key(x) === key(item));
  const merged = old && old.actual ? { ...item, actual: old.actual, ...judgeAnswer(old.actual, item.candidates) } : item;
  return [merged, ...rest].slice(0, MAX_ITEMS);
}

export function stats(items: HistoryItem[]) {
  const total = items.length;
  const correct = items.filter((x) => x.verdict === 'correct').length;
  /** 首选答案就对的条数——比"候选里有对的"更能反映真实水平 */
  const topHit = items.filter((x) => x.verdict === 'correct' && x.hitRank === 0).length;
  const wrong = items.filter((x) => x.verdict === 'wrong').length;
  const unsolved = items.filter((x) => x.verdict === 'unsolved').length;
  const labeled = items.filter((x) => x.actual.trim().length > 0).length;
  return { total, correct, topHit, wrong, unsolved, labeled };
}

/* ------------------------------------------------------------------ */
/* 导出                                                                */
/* ------------------------------------------------------------------ */
export function toJson(items: HistoryItem[]): string {
  const meta = getSolverMeta();
  const s = stats(items);
  return JSON.stringify(
    {
      solverVersion: meta.version,
      fingerprint: meta.fingerprint,
      recognizers: meta.recognizers,
      ops: meta.ops,
      exportedAt: new Date().toISOString(),
      summary: s,
      cases: items.map((x) => ({
        input: x.input,
        options: x.options || undefined,
        depth: x.depth,
        candidates: x.candidates.map((c) => c.value),
        patterns: x.candidates.map((c) => c.pattern),
        actual: x.actual || undefined,
        verdict: x.verdict,
        hitRank: x.hitRank,
        ms: x.ms,
        nodes: x.nodes,
        ts: new Date(x.ts).toISOString(),
        version: x.version,
      })),
    },
    null,
    2,
  );
}

/** 把用户填写的答案整理成测试集里的标准写法（逗号分隔） */
function tidyAnswer(s: string): string {
  return s
    .replace(/[，、;；]/g, ',')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .join(', ');
}

/** 生成可以直接粘进 tests/run.ts 的用例：只导出「答错」和「没解出来」的 */
export function toTestCases(items: HistoryItem[]): string {
  const pick = items.filter(
    (x) => x.actual.trim().length > 0 && (x.verdict === 'wrong' || x.verdict === 'unsolved'),
  );
  const meta = getSolverMeta();
  const lines = [
    `// 由历史记录导出 · ${new Date().toLocaleString('zh-CN')}`,
    `// 求解器 v${meta.version} · ${meta.recognizers} 条规则 / ${meta.ops} 个算子`,
  ];
  if (!pick.length) {
    lines.push('// 没有「已标注答案但求解错误 / 未解」的记录，暂无待修复用例。');
    return lines.join('\n');
  }
  const wrong = pick.filter((x) => x.verdict === 'wrong').length;
  const unsolved = pick.filter((x) => x.verdict === 'unsolved').length;
  lines.push(`// ${pick.length} 条用例：求解错误 ${wrong} 条，完全未解 ${unsolved} 条`);
  lines.push('// 直接把下面每一项粘进 tests/run.ts 的 CASES 数组即可', '');
  lines.push('const REGRESSION_CASES: { name: string; input: string; expect: string; opts?: string }[] = [');
  pick.forEach((x, i) => {
    const opts = x.options ? `, opts: '${x.options}'` : '';
    lines.push(
      `  { name: '待修复-${i + 1}', input: '${x.input}', expect: '${tidyAnswer(x.actual)}'${opts} },`,
    );
  });
  lines.push('];');
  return lines.join('\n');
}

export function download(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
