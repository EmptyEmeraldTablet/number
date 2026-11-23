/**
 * 搜索层：在「算子链 + 基础模式」的空间里做迭代加深枚举。
 *
 * 求解流程
 * ────────
 * 1. 选项模式：每个选项填进去，跑完整搜索，用规律复杂度打分排序（最可靠）；
 * 2. 符号模式：把空缺当作符号 x 参与运算，由识别器精确反解；
 * 3. 多个空缺：按从左到右的顺序逐个解，每解一个序列就变长一项，
 *    这样每一轮都只有一个未知数，且能用上「后面新补出来的项」做交叉验证。
 *
 * 所有候选解统一按「规律复杂度 + 支持项数」排序，输出前若干名。
 */
import * as F from './fraction';
import { Frac, fr } from './fraction';
import { Term, KNOWN, VAR } from './term';
import { OPS, Op } from './ops';
import { Fit, RECOGNIZERS, describeDigitRule } from './patterns';

export interface Step {
  opId: string;
  tag: string;
  name: string;
  before: string[];
  after: string[];
}

export interface Round {
  value: Frac;
  pattern: string;
  desc: string;
}

export interface Solution {
  answer: Frac[];
  score: number;
  path: Step[];
  patternName: string;
  patternDesc: string;
  rounds: Round[];
  mode: 'symbol' | 'option' | 'analyze';
  /** 答案带 √radical 因子（根式数列） */
  radical?: number;
  /** 答案本身就是 √(值) */
  sqrtOnly?: boolean;
  /** 答案按几位小数展示 */
  decimals?: number;
  /** 逐项拆解说明 */
  lines?: string[];
}

export interface ParseResult {
  /** 数值序列，根式项以「系数」占位（仅在 hasRadical 时有意义） */
  values: (Frac | null)[];
  items: Item[];
  holes: number[];
  tokens: string[];
  hasRadical: boolean;
  /** 统一的小数位数；null 表示无小数或位数不一致 */
  decimals: number | null;
  error?: string;
}

export type Item =
  | { k: 'num'; v: Frac; dec?: number; raw: string }
  | { k: 'rad'; coef: Frac; userCoef: Frac; rad: number; orig: number; raw: string }
  | { k: 'hole'; raw: string };

/* ------------------------------------------------------------------ */
/* 输入解析                                                            */
/* ------------------------------------------------------------------ */
/** 把 n 拆成 a·√b，b 不含平方因子 */
export function simplifyRad(n: number): { coef: number; rad: number } {
  let coef = 1;
  let rad = n;
  for (let i = 2; i * i <= rad; i++) {
    while (rad % (i * i) === 0) {
      rad /= i * i;
      coef *= i;
    }
  }
  return { coef, rad };
}

export function parseRadical(tk: string): { coef: Frac; userCoef: Frac; rad: number; orig: number } | null {
  let s = tk.trim().replace(/\s+/g, '');
  s = s.replace(/√\(([^)]*)\)/g, '√$1');
  const m = /^(-?)(\d*)\s*√(\d+)$/.exec(s);
  if (!m) return null;
  const sign = m[1] === '-' ? -1n : 1n;
  const outer = m[2] === '' ? 1n : BigInt(m[2]);
  const under = Number(m[3]);
  if (!Number.isFinite(under) || under <= 0) return null;
  const { coef, rad } = simplifyRad(under);
  return { coef: F.fr(sign * outer * BigInt(coef)), userCoef: F.fr(sign * outer), rad, orig: under };
}

export function parseInput(raw: string): ParseResult {
  const tokens = raw
    .replace(/[，、;；]/g, ',')
    .replace(/[（(]/g, ' ( ')
    .replace(/[）)]/g, ' ) ')
    .split(/[\s,]+/)
    .filter((s) => s.length > 0);

  const values: (Frac | null)[] = [];
  const items: Item[] = [];
  const holes: number[] = [];
  let hasRadical = false;

  for (const tk of tokens) {
    if (/^[?_xX]+$/.test(tk) || tk === '()') {
      holes.push(items.length);
      values.push(null);
      items.push({ k: 'hole', raw: tk });
      continue;
    }
    const rad = parseRadical(tk);
    if (rad) {
      hasRadical = true;
      items.push({
        k: 'rad',
        coef: rad.coef,
        userCoef: rad.userCoef,
        rad: rad.rad,
        orig: rad.orig,
        raw: tk,
      });
      values.push(rad.coef);
      continue;
    }
    const v = parseNumber(tk);
    if (v === null) {
      return {
        values,
        items,
        holes,
        tokens,
        hasRadical,
        decimals: null,
        error: `无法识别「${tk}」`,
      };
    }
    const decMatch = /^-?\d+\.(\d+)$/.exec(tk.trim());
    items.push({ k: 'num', v, dec: decMatch ? decMatch[1].length : undefined, raw: tk });
    values.push(v);
  }

  // 判断小数位是否统一
  let decimals: number | null = null;
  const numItems = items.filter((it) => it.k === 'num') as Extract<Item, { k: 'num' }>[];
  if (numItems.length >= 3 && numItems.every((it) => it.dec !== undefined)) {
    const d = numItems[0].dec!;
    if (numItems.every((it) => it.dec === d)) decimals = d;
  }

  const base = { values, items, holes, tokens, hasRadical, decimals };
  if (values.length < 3) return { ...base, error: '至少需要输入 3 项' };
  if (!holes.length) return { ...base, error: '请用 ? 标出需要补全的位置' };
  return base;
}

export function parseNumber(tk: string): Frac | null {
  let s = tk.trim();
  const m = /^(-?\d+)\s*\/\s*(-?\d+)$/.exec(s);
  if (m) {
    const d = BigInt(m[2]);
    if (d === 0n) return null;
    return F.fr(BigInt(m[1]), d);
  }
  const m2 = /^(-?\d+)\s+(\d+)\s*\/\s*(\d+)$/.exec(s);
  if (m2) {
    const whole = BigInt(m2[1]);
    const nn = BigInt(m2[2]);
    const d = BigInt(m2[3]);
    if (d === 0n) return null;
    const sign = whole < 0n ? -1n : 1n;
    return F.fr(whole * d + sign * nn, d);
  }
  if (/^-?\d*\.\d+$/.test(s)) {
    const neg = s.startsWith('-');
    if (neg) s = s.slice(1);
    const [ip, fp] = s.split('.');
    const den = 10n ** BigInt(fp.length);
    const num = BigInt((ip || '0') + fp);
    return F.fr(neg ? -num : num, den);
  }
  if (/^-?\d+$/.test(s)) return F.fr(BigInt(s));
  return null;
}

/* ------------------------------------------------------------------ */
/* 单状态规律提取                                                       */
/* ------------------------------------------------------------------ */
interface Raw {
  path: Op[];
  fit: Fit;
  cost: number;
  support: number;
}

function collect(seq: Term[], path: Op[], agg: number): Raw[] {
  const out: Raw[] = [];
  const baseCost = path.reduce((a, o) => a + o.cost, 0);
  // 支持项数：相邻聚合算子不损失信息量，按原长度计；抽样类（奇偶位）不补偿
  const n = seq.length + agg;
  const supportPenalty = n < 4 ? 2.0 : n === 4 ? 0.8 : 0;
  for (const rec of RECOGNIZERS) {
    if (rec.maxDepth !== undefined && path.length > rec.maxDepth) continue;
    let fit: Fit | null = null;
    try {
      fit = rec.match(seq);
    } catch {
      fit = null;
    }
    if (!fit) continue;
    if (seq.some((t) => t.k.n !== 0n) && fit.x === undefined) continue;
    out.push({ path, fit, cost: baseCost + fit.complexity + supportPenalty, support: n });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 搜索                                                                */
/* ------------------------------------------------------------------ */
const MAX_NODES = 40000;

export function search(
  seq: Term[],
  maxDepth: number,
): { raws: Raw[]; nodes: number; truncated: boolean } {
  const raws: Raw[] = [];
  const seen = new Map<string, number>();
  let nodes = 0;
  let truncated = false;

  const dfs = (cur: Term[], path: Op[], depth: number, agg: number) => {
    if (nodes > MAX_NODES) {
      truncated = true;
      return;
    }
    nodes++;
    raws.push(...collect(cur, path, agg));

    if (depth >= maxDepth) return;
    if (cur.length < 4) return;

    const k = cur.map((t) => `${t.c.n}/${t.c.d}|${t.k.n}/${t.k.d}`).join(',');
    const prev = seen.get(k);
    if (prev !== undefined && prev <= depth) return;
    seen.set(k, depth);

    for (const op of OPS) {
      let nxt: Term[] | null = null;
      try {
        nxt = op.apply(cur);
      } catch {
        nxt = null;
      }
      if (!nxt || nxt.length < 3) continue;
      dfs(nxt, [...path, op], depth + 1, agg + (op.agg ? 1 : 0));
    }
  };

  dfs(seq, [], 0, 0);
  return { raws, nodes, truncated };
}

/* ------------------------------------------------------------------ */
/* 打分                                                                */
/* ------------------------------------------------------------------ */
function answerPenalty(answer: Frac[]): number {
  let s = 0;
  for (const a of answer) {
    if (!F.isInt(a)) s += 0.35;
    const num = Number(a.n) / Number(a.d);
    if (!Number.isFinite(num) || Math.abs(num) > 1e9) s += 1.0;
    if (Math.abs(num) > 1e4) s += 0.3;
  }
  return s;
}

/* ------------------------------------------------------------------ */
/* 由 Raw 生成可展示的解法                                              */
/* ------------------------------------------------------------------ */
function buildPath(raw: Raw, base: Frac[], mask?: boolean[]): Step[] | null {
  const path: Step[] = [];
  let cur: Term[] = base.map((v) => KNOWN(v));
  let first = true;
  for (const op of raw.path) {
    const before = cur.map((t, i) =>
      first && mask?.[i] ? '?' : t.k.n === 0n ? F.fracToString(t.c) : `${F.fracToString(t.c)}+x`,
    );
    first = false;
    const nxt = op.apply(cur);
    if (!nxt) return null;
    path.push({
      opId: op.id,
      tag: op.tag,
      name: op.name,
      before,
      after: nxt.map((t) => (t.k.n === 0n ? F.fracToString(t.c) : `${F.fracToString(t.c)}+${F.fracToString(t.k)}x`)),
    });
    cur = nxt;
  }
  return path;
}

function makeSolution(
  chain: { resolved: (Frac | null)[]; rounds: { raw: Raw; base: Frac[]; value: Frac; mask?: boolean[] }[] },
  holes: number[],
  mode: Solution['mode'],
): Solution | null {
  const last = chain.rounds[chain.rounds.length - 1];
  const path = buildPath(last.raw, last.base, last.mask) ?? [];
  const answer = holes.map((h) => chain.resolved[h]!);
  const totalCost = chain.rounds.reduce((a, r) => a + r.raw.cost, 0);
  return {
    answer,
    score: totalCost / chain.rounds.length + answerPenalty(answer) + 0.15 * last.raw.path.length,
    path,
    patternName: chain.rounds.map((r) => r.raw.fit.name).join(' → '),
    patternDesc: last.raw.fit.describe(),
    rounds: chain.rounds.map((r) => ({
      value: r.value,
      pattern: r.raw.fit.name,
      desc: r.raw.fit.describe(),
    })),
    mode,
  };
}

/* ------------------------------------------------------------------ */
/* 顺序求解：逐个补全空缺                                               */
/* ------------------------------------------------------------------ */
interface ChainResult {
  resolved: (Frac | null)[];
  rounds: { raw: Raw; base: Frac[]; value: Frac; mask?: boolean[] }[];
  nodes: number;
  truncated: boolean;
  failedAt?: number;
}

function solveChain(
  values: (Frac | null)[],
  holes: number[],
  maxDepth: number,
): ChainResult {
  const resolved = values.slice();
  const rounds: { raw: Raw; base: Frac[]; value: Frac; mask?: boolean[] }[] = [];
  let nodes = 0;
  let truncated = false;

  for (let hi = 0; hi < holes.length; hi++) {
    const h = holes[hi];
    const hasLaterHole = hi < holes.length - 1;
    const end = hasLaterHole ? h + 1 : values.length;
    const seg = resolved.slice(0, end);
    // 段内除当前空外不应再有空
    const bad = seg.some((v, i) => v === null && i !== h);
    if (bad) return { resolved, rounds, nodes, truncated, failedAt: h };

    const seq: Term[] = seg.map((v, i) => (i === h ? VAR : KNOWN(v!)));
    const r = search(seq, maxDepth);
    nodes += r.nodes;
    truncated = truncated || r.truncated;

    const cands = r.raws.filter((x) => x.fit.x !== undefined);
    if (!cands.length) return { resolved, rounds, nodes, truncated, failedAt: h };
    cands.sort((a, b) => a.cost - b.cost);
    const best = cands[0];
    resolved[h] = best.fit.x!;
    rounds.push({
      raw: best,
      base: seg.map((v) => (v === null ? best.fit.x! : v)) as Frac[],
      value: best.fit.x!,
      mask: seg.map((v) => v === null),
    });
  }
  return { resolved, rounds, nodes, truncated };
}

/* ------------------------------------------------------------------ */
/* 反向传播：已知「变换后序列的下一项」，还原「原序列的下一项」            */
/* ------------------------------------------------------------------ */
type PushNext = (inVals: Frac[], nextOut: Frac) => Frac | null;

const PUSH: Record<string, PushNext> = {
  diff: (inVals, v) => (inVals.length ? F.add(inVals[inVals.length - 1], v) : null),
  rdiff: (inVals, v) => (inVals.length ? F.sub(inVals[inVals.length - 1], v) : null),
  sum: (inVals, v) => (inVals.length ? F.sub(v, inVals[inVals.length - 1]) : null),
  ratio: (inVals, v) => (inVals.length ? F.mul(inVals[inVals.length - 1], v) : null),
  prod: (inVals, v) => {
    if (!inVals.length) return null;
    const last = inVals[inVals.length - 1];
    if (F.isZero(last)) return null;
    return F.div(v, last);
  },
  cumsum: (inVals, v) => {
    const s = inVals.reduce((a, b) => F.add(a, b), F.fr(0));
    return F.sub(v, s);
  },
  sqrt: (_in, v) => (v.n < 0n ? null : F.mul(v, v)),
  cbrt: (_in, v) => F.mul(F.mul(v, v), v),
  recip: (_in, v) => (F.isZero(v) ? null : F.inv(v)),
  neg: (_in, v) => F.neg(v),
  odd: (inVals, v) => (inVals.length % 2 === 0 ? v : null),
  even: (inVals, v) => (inVals.length % 2 === 1 ? v : null),
};

/** 沿算子链把「末端外推值」反向还原成原序列的下一项 */
function extendAnswer(
  path: Op[],
  base: Frac[],
  fit: Fit,
  need: number,
): Frac[] | null {
  const out: Frac[] = [];
  const cur = base.slice();
  for (let step = 0; step < need; step++) {
    const layers: Frac[][] = [cur.slice()];
    let ok = true;
    for (const op of path) {
      const nxt = op.apply(layers[layers.length - 1].map((v) => KNOWN(v)));
      if (!nxt) {
        ok = false;
        break;
      }
      layers.push(nxt.map((t) => t.c));
    }
    if (!ok) return null;

    const lastLayer = layers[layers.length - 1];
    const v = fit.at(lastLayer.length);
    if (v === null) return null;

    let val: Frac | null = v;
    for (let d = path.length - 1; d >= 0 && val; d--) {
      const push = PUSH[path[d].id];
      if (!push) return null;
      val = push(layers[d], val);
    }
    if (!val) return null;
    cur.push(val);
    out.push(val);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 主入口                                                              */
/* ------------------------------------------------------------------ */
/** 求解器版本；规则集发生变化时递增，历史记录用它区分结果来源 */
export const SOLVER_VERSION = '0.3.0';

export function getSolverMeta() {
  return {
    version: SOLVER_VERSION,
    recognizers: RECOGNIZERS.length,
    ops: OPS.length,
    fingerprint: `${RECOGNIZERS.length}r/${OPS.length}o`,
  };
}

/** 规范化用户填写的答案，便于比对：忽略空格与各种分隔符 */
export function normalizeAnswer(s: string): string {
  return s.replace(/[\s,，、;；]/g, '');
}

export interface SolveResult {
  parse: ParseResult;
  solutions: Solution[];
  note?: string;
  nodes: number;
  truncated: boolean;
  /** 检测到数位等式规律但首选解不是它时给出，用于提醒结果可能不是命题意图 */
  digitHint?: string;
}

const MAX_SOLUTIONS = 5;

/** 用纯数值序列构造伪解析结果，供根式 / 小数分支复用主流程 */
function pseudoParse(vals: (Frac | null)[], tokens: string[]): ParseResult {
  const holes: number[] = [];
  const items: Item[] = vals.map((v, i) => {
    if (v === null) {
      holes.push(i);
      return { k: 'hole', raw: '?' } as Item;
    }
    return { k: 'num', v, raw: v.d === 1n ? v.n.toString() : '' } as Item;
  });
  return { values: vals, items, holes, tokens, hasRadical: false, decimals: null };
}

function parseOptions(raw: string, rad?: number): Frac[] {
  const out: Frac[] = [];
  if (!raw.trim()) return out;
  for (const tk of raw.replace(/[，、;；]/g, ',').split(/[\s,]+/).filter(Boolean)) {
    const r = parseRadical(tk);
    if (r) {
      if (rad === undefined || r.rad !== rad) continue;
      out.push(r.coef);
      continue;
    }
    const v = parseNumber(tk);
    if (v && (rad === undefined || rad === 1)) out.push(v);
  }
  return out;
}

export function solve(inputRaw: string, optionRaw = '', maxDepth = 3): SolveResult {
  const parse = parseInput(inputRaw);
  if (parse.error) {
    return { parse, solutions: [], note: parse.error, nodes: 0, truncated: false };
  }
  if (parse.hasRadical) return solveRadical(parse, optionRaw, maxDepth);

  const plain = solvePlain(parse, optionRaw, maxDepth);
  if (parse.decimals !== null) {
    plain.solutions = plain.solutions.map((s) => ({ ...s, decimals: parse.decimals! }));
  }
  if (parse.decimals !== null && !optionRaw.trim()) {
    const dec = solveDecimal(parse, maxDepth);
    if (dec.solutions.length) {
      const merged = [...dec.solutions, ...plain.solutions].sort((a, b) => a.score - b.score);
      const seen = new Set<string>();
      const out: Solution[] = [];
      for (const s of merged) {
        const k = s.answer.map(F.keyOf).join('|');
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(s);
        if (out.length >= MAX_SOLUTIONS) break;
      }
      return {
        ...plain,
        solutions: out,
        nodes: plain.nodes + dec.nodes,
        truncated: plain.truncated || dec.truncated,
        note: '小数题会同时尝试「整数部分/小数部分分列」与整体规律，候选按复杂度排序。',
      };
    }
  }
  return plain;
}

function solvePlain(parse: ParseResult, optionRaw: string, maxDepth: number): SolveResult {
  const { values, holes } = parse;
  const options = parseOptions(optionRaw);

  const solutions: Solution[] = [];
  let nodes = 0;
  let truncated = false;

  /** 末尾连续空缺的起点（-1 表示不存在） */
  const tailStart = (() => {
    const sorted = [...holes].sort((a, b) => a - b);
    if (!sorted.length) return -1;
    if (sorted[sorted.length - 1] !== values.length - 1) return -1;
    if (sorted[0] + sorted.length - 1 !== sorted[sorted.length - 1]) return -1;
    return sorted[0];
  })();

  /* ---- A. 选项模式（单空）---- */
  if (options.length > 0 && holes.length === 1) {
    const h = holes[0];
    for (const opt of options) {
      const filled = values.slice();
      filled[h] = opt;
      const seq = filled.map((v) => KNOWN(v!));
      const r = search(seq, maxDepth);
      nodes += r.nodes;
      truncated = truncated || r.truncated;
      const mask = values.map((v) => v === null);
      for (const raw of r.raws) {
        const path = buildPath(raw, filled as Frac[], mask);
        if (!path) continue;
        solutions.push({
          answer: [opt],
          score: raw.cost + answerPenalty([opt]) + 0.15 * raw.path.length,
          path,
          patternName: raw.fit.name,
          patternDesc: raw.fit.describe(),
          rounds: [{ value: opt, pattern: raw.fit.name, desc: raw.fit.describe() }],
          mode: 'option',
        });
      }
    }
  }

  /* ---- B. 末尾空缺：剥离后外推（可用全部算子）---- */
  if (tailStart > 0 && !(options.length > 0 && holes.length === 1)) {
    const known = values.slice(0, tailStart) as Frac[];
    const need = values.length - tailStart;
    const r = search(known.map(KNOWN), maxDepth);
    nodes += r.nodes;
    truncated = truncated || r.truncated;
    for (const raw of r.raws) {
      const ans = extendAnswer(raw.path, known, raw.fit, need);
      if (!ans) continue;
      const path = buildPath(raw, known);
      if (!path) continue;
      solutions.push({
        answer: ans,
        score: raw.cost + answerPenalty(ans) + 0.15 * raw.path.length,
        path,
        patternName: raw.fit.name,
        patternDesc: raw.fit.describe(),
        rounds: ans.map((v) => ({ value: v, pattern: raw.fit.name, desc: raw.fit.describe() })),
        mode: 'symbol',
        lines: raw.fit.lines,
      });
    }
  }

  /* ---- C. 符号顺序求解（中间空缺，或外推失败的兜底）---- */
  if (!(options.length > 0 && holes.length === 1) && (tailStart <= 0 || solutions.length === 0)) {
    const chain = solveChain(values, holes, maxDepth);
    nodes += chain.nodes;
    truncated = truncated || chain.truncated;
    if (chain.rounds.length === holes.length) {
      const sol = makeSolution(chain, holes, 'symbol');
      if (sol) solutions.push(sol);
    }
  }

  solutions.sort((a, b) => a.score - b.score);
  const uniq: Solution[] = [];
  const seen = new Set<string>();
  for (const s of solutions) {
    const k = s.answer.map(F.keyOf).join('|');
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(s);
    if (uniq.length >= MAX_SOLUTIONS) break;
  }

  let note: string | undefined;
  if (!uniq.length) {
    const known = values.filter((v): v is Frac => v !== null);
    const digitHint = describeDigitRule(known);
    note = digitHint
      ? `这题是数位规律「${digitHint}」——满足条件的答案不唯一，请补充选项后再求解。`
      : '未能在当前搜索深度内找到规律。可以尝试加大深度，或补充选项。';
  } else if (truncated) {
    note = '搜索达到节点上限，结果可能不完整（已按复杂度排序输出最优的几条）。';
  }

  const knownAll = values.filter((v): v is Frac => v !== null);
  const digitRule = describeDigitRule(knownAll) ?? undefined;
  const topIsDigit = uniq.length > 0 && uniq[0].patternName.includes('数位');
  return {
    parse,
    solutions: uniq,
    note,
    nodes,
    truncated,
    digitHint: digitRule && !topIsDigit ? digitRule : undefined,
  };
}

/* ------------------------------------------------------------------ */
/* 根式数列：统一成 a·√b，对系数 a 求规律                               */
/* ------------------------------------------------------------------ */
function solveRadical(parse: ParseResult, optionRaw: string, maxDepth: number): SolveResult {
  const items = parse.items;
  const sols: Solution[] = [];
  let nodes = 0;
  let truncated = false;
  const notes: string[] = [];

  /* 口径 A：统一化简成 a·√b，对系数 a 求规律 */
  const radSet = new Set<number>();
  for (const it of items) {
    if (it.k === 'hole') continue;
    radSet.add(it.k === 'rad' ? it.rad : 1);
  }
  if (radSet.size === 1) {
    const r = [...radSet][0];
    const coefs: (Frac | null)[] = items.map((it) =>
      it.k === 'hole' ? null : it.k === 'rad' ? it.coef : it.v,
    );
    const res = solvePlain(pseudoParse(coefs, parse.tokens), optionRaw, maxDepth);
    nodes += res.nodes;
    truncated = truncated || res.truncated;
    for (const s of res.solutions) {
      sols.push({
        ...s,
        radical: r === 1 ? undefined : r,
        patternName: `系数${s.patternName}`,
        patternDesc: `${s.patternDesc}（${r === 1 ? '各项数值' : `a·√${r} 中的系数 a`}的规律）`,
      });
    }
    if (res.solutions.length) notes.push(`化简为 ${r === 1 ? '有理数' : `a·√${r}`} 后系数成规律`);
  }

  /* 口径 B：系数恒定，根号内的数（不化简）成规律 */
  const radItems = items.filter((it) => it.k === 'rad') as Extract<Item, { k: 'rad' }>[];
  if (radItems.length === items.length - parse.holes.length && radItems.length >= 3) {
    const coefs = radItems.map((it) => it.userCoef);
    if (coefs.every((c) => F.eq(c, coefs[0]))) {
      const origs: (Frac | null)[] = items.map((it) =>
        it.k === 'hole' ? null : F.fr(it.k === 'rad' ? it.orig : 1),
      );
      const res = solvePlain(pseudoParse(origs, parse.tokens), optionRaw, maxDepth);
      nodes += res.nodes;
      truncated = truncated || res.truncated;
      for (const s of res.solutions) {
        sols.push({
          ...s,
          sqrtOnly: true,
          patternName: `根号内${s.patternName}`,
          patternDesc: `${s.patternDesc}（根号内数字的规律）`,
        });
      }
      if (res.solutions.length) notes.push('根号内的数单独成规律');
    }
  }

  if (!sols.length) {
    return {
      parse,
      solutions: [],
      note: '根式数列暂只支持两种形式：同一根号下系数成规律，或系数恒定、根号内的数成规律。',
      nodes,
      truncated,
    };
  }

  sols.sort((a, b) => a.score - b.score);
  const seen = new Set<string>();
  const out: Solution[] = [];
  for (const s of sols) {
    const k = s.answer.map(F.keyOf).join('|');
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= MAX_SOLUTIONS) break;
  }
  return { parse, solutions: out, note: notes.join('；'), nodes, truncated };
}

/* ------------------------------------------------------------------ */
/* 小数数列：整数部分与小数部分分列                                     */
/* ------------------------------------------------------------------ */
function solveDecimal(parse: ParseResult, maxDepth: number): SolveResult {
  const d = parse.decimals!;
  const scale = F.fr(10n ** BigInt(d));
  const ints: (Frac | null)[] = [];
  const fracs: (Frac | null)[] = [];
  for (const it of parse.items) {
    if (it.k !== 'num') {
      ints.push(null);
      fracs.push(null);
      continue;
    }
    const [ip, fp = ''] = it.raw.trim().split('.');
    ints.push(F.fr(BigInt(ip)));
    fracs.push(F.fr(BigInt(fp || '0')));
  }

  const knownInts = ints.filter((v): v is Frac => v !== null);
  if (knownInts.length >= 3 && knownInts.every((v) => F.eq(v, knownInts[0]))) {
    return { parse, solutions: [], note: '', nodes: 0, truncated: false };
  }

  const ri = solvePlain(pseudoParse(ints, parse.tokens), '', maxDepth);
  const rf = solvePlain(pseudoParse(fracs, parse.tokens), '', maxDepth);
  if (!ri.solutions.length || !rf.solutions.length) {
    return { parse, solutions: [], note: '小数部分或整数部分未能找到规律。', nodes: ri.nodes + rf.nodes, truncated: false };
  }

  const fracDigits = (f: Frac): number => {
    const a = f.n < 0n ? -f.n : f.n;
    return a === 0n ? 1 : a.toString().length;
  };

  const combos: Solution[] = [];
  for (const a of ri.solutions.slice(0, 2)) {
    for (const b of rf.solutions.slice(0, 2)) {
      if (a.answer.length !== b.answer.length) continue;
      // 拼接语义：小数部分按其自身位数补在小数点后（11.11 而不是 12.1）
      const ans = a.answer.map((v, i) => {
        const fr = b.answer[i];
        const dg = fracDigits(fr);
        return F.add(v, F.div(fr, F.fr(10n ** BigInt(dg))));
      });
      const maxDg = Math.max(1, ...b.answer.map(fracDigits));
      combos.push({
        answer: ans,
        score: (a.score + b.score) / 2 + 0.3,
        path: a.path.length >= b.path.length ? a.path : b.path,
        patternName: `整数位：${a.patternName} · 小数位：${b.patternName}`,
        patternDesc: `整数部分${a.patternDesc}；小数部分${b.patternDesc}`,
        rounds: [],
        mode: 'symbol',
        decimals: maxDg,
      });
    }
  }

  combos.sort((x, y) => x.score - y.score);
  return {
    parse,
    solutions: combos.slice(0, MAX_SOLUTIONS),
    note: '按小数点拆成整数部分与小数部分，分别求规律后合并。',
    nodes: ri.nodes + rf.nodes,
    truncated: ri.truncated || rf.truncated,
  };
}

/** 把有理数格式化成指定小数位 */
export function formatDecimal(f: Frac, digits: number): string {
  if (f.d === 1n) return f.n.toString();
  const scale = 10n ** BigInt(digits);
  const num = f.n * scale;
  if (num % f.d !== 0n) return F.fracToString(f);
  const scaled = num / f.d;
  const neg = scaled < 0n;
  const a = neg ? -scaled : scaled;
  const ip = a / scale;
  const fp = a % scale;
  if (digits === 0) return `${neg ? '-' : ''}${ip}`;
  return `${neg ? '-' : ''}${ip}.${fp.toString().padStart(digits, '0')}`;
}

/* ------------------------------------------------------------------ */
/* 纯规律分析（不外推）                                                 */
/* ------------------------------------------------------------------ */
export function analyze(inputRaw: string, maxDepth = 3) {
  const vals: Frac[] = [];
  for (const tk of inputRaw.replace(/[，、;；]/g, ',').split(/[\s,]+/).filter(Boolean)) {
    const v = parseNumber(tk);
    if (!v) return { fits: [] as { name: string; desc: string; cost: number }[] };
    vals.push(v);
  }
  if (vals.length < 3) return { fits: [] };
  const r = search(vals.map(KNOWN), maxDepth);
  const fits = r.raws
    .filter((x) => x.path.length === 0)
    .sort((a, b) => a.cost - b.cost)
    .slice(0, 6)
    .map((x) => ({ name: x.fit.name, desc: x.fit.describe(), cost: x.cost }));
  return { fits };
}
