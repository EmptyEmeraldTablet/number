/**
 * Term = 「常数 + 系数 × x」的仿射表达式。
 * x 代表数列中被挖空的那一项（只有一个）。
 *
 * 为什么用仿射而不是完整符号计算：
 * 行测里 90% 的"中间挖空"题都落在 做差 / 做和 / 累加 / 多项式 这几类，
 * 这些算子对仿射形式是封闭的（只做加减和常数倍），可以精确反解；
 * 做商、做积这类非线性的，改用"跳过未知项 + 代入求值"的方式处理。
 */
import {
  Frac, ZERO, add, sub, mul, div, neg, eq, isZero, fracToString, keyOf, cmp,
} from './fraction';

export interface Term {
  /** 常数部分 */
  readonly c: Frac;
  /** x 的系数，0 表示该项已知 */
  readonly k: Frac;
}

export const KNOWN = (v: Frac): Term => ({ c: v, k: ZERO });
export const VAR: Term = { c: ZERO, k: { n: 1n, d: 1n } };

export const isKnown = (t: Term) => isZero(t.k);
export const isVar = (t: Term) => !isZero(t.k);

export const tAdd = (a: Term, b: Term): Term => ({ c: add(a.c, b.c), k: add(a.k, b.k) });
export const tSub = (a: Term, b: Term): Term => ({ c: sub(a.c, b.c), k: sub(a.k, b.k) });
export const tNeg = (a: Term): Term => ({ c: neg(a.c), k: neg(a.k) });
export const tScale = (a: Term, s: Frac): Term => ({ c: mul(a.c, s), k: mul(a.k, s) });

/** 乘法：若两边都含 x 则退化为二次，超出仿射表达范围，返回 null。 */
export function tMul(a: Term, b: Term): Term | null {
  if (isVar(a) && isVar(b)) return null;
  if (isVar(a)) return { c: mul(a.c, b.c), k: mul(a.k, b.c) };
  if (isVar(b)) return { c: mul(a.c, b.c), k: mul(a.c, b.k) };
  return { c: mul(a.c, b.c), k: ZERO };
}

/** 除法：分母含 x 时非线性，返回 null。 */
export function tDiv(a: Term, b: Term): Term | null {
  if (isVar(b)) return null;
  return { c: div(a.c, b.c), k: div(a.k, b.c) };
}

export const tEq = (a: Term, b: Term) => eq(a.c, b.c) && eq(a.k, b.k);

/** 把含 x 的项解出来：c + k·x = target → x = (target - c) / k */
export function solveTerm(t: Term, target: Frac): Frac | null {
  if (isZero(t.k)) return eq(t.c, target) ? null : null; // 无 x 参与时不产生解
  return div(sub(target, t.c), t.k);
}

export function termToString(t: Term): string {
  if (isZero(t.k)) return fracToString(t.c);
  const k = t.k;
  const kStr = eq(k, { n: 1n, d: 1n }) ? 'x' : eq(k, { n: -1n, d: 1n }) ? '-x' : `${fracToString(k)}x`;
  if (isZero(t.c)) return kStr;
  const sign = cmp(t.c, ZERO) < 0 ? '-' : '+';
  const cAbs = cmp(t.c, ZERO) < 0 ? neg(t.c) : t.c;
  return `${kStr} ${sign} ${fracToString(cAbs)}`;
}

export const termKey = (t: Term) => `${keyOf(t.c)}|${keyOf(t.k)}`;
