/**
 * 算子（Transform）集合。
 *
 * 每个算子把一条数列变成另一条数列，是"降维/换视角"的动作。
 * 求解器通过枚举算子链，把原数列压平到某个基础模式能识别的形态。
 *
 * 约定：
 *  - apply 返回 null 表示该算子在此数列上不适用（如含负数做数位和）。
 *  - 非线性算子（乘法/除法/开方/数位）要求序列全部已知，即不含未知项 x；
 *    线性算子（加减/线性组合）可以携带未知项，用于反解。
 */
import { Term, isKnown, tAdd, tSub, tNeg, tMul, tDiv, tScale, KNOWN, termToString } from './term';
import { Frac, ZERO, ONE, add, sub, mul, div, isZero, isInt, cmp, fr, toNumber, inv, neg } from './fraction';

export type OpGroup = 'multi' | 'struct' | 'power' | 'digit' | 'misc';

export interface Op {
  id: string;
  /** 面板上的显示名 */
  name: string;
  /** 解释串里的短标签 */
  tag: string;
  /** 先验代价：越大越靠后、越可疑 */
  cost: number;
  group: OpGroup;
  /** 是否需要序列全部已知 */
  needKnown: boolean;
  /** 是否为「相邻聚合」算子：会减少项数但信息量守恒，支持项数按原长度计 */
  agg?: boolean;
  apply(seq: Term[]): Term[] | null;
  /** 生成一句人话解释，例如「相邻两项作差」 */
  desc(): string;
}

const allKnown = (seq: Term[]) => seq.every(isKnown);

/** 所有数都是非负整数 */
function allNonNegInt(seq: Term[]): Frac[] | null {
  const out: Frac[] = [];
  for (const t of seq) {
    if (!isKnown(t)) return null;
    if (!isInt(t.c) || t.c.n < 0n) return null;
    out.push(t.c);
  }
  return out;
}

function digitsOf(v: bigint): bigint[] {
  const s = v.toString();
  return [...s].map((ch) => BigInt(ch));
}

export const OPS: Op[] = [
  {
    id: 'diff',
    agg: true,
    name: '做差',
    tag: 'Δ',
    cost: 1.0,
    group: 'multi',
    needKnown: false,
    desc: () => '相邻两项作差（后项减前项）',
    apply: (s) => (s.length < 3 ? null : s.slice(1).map((t, i) => tSub(t, s[i]))),
  },
  {
    id: 'rdiff',
    agg: true,
    name: '做差（前减后）',
    tag: 'Δ⁻',
    cost: 3.0,
    group: 'multi',
    needKnown: false,
    desc: () => '相邻两项作差（前项减后项）',
    apply: (s) => (s.length < 3 ? null : s.slice(1).map((t, i) => tSub(s[i], t))),
  },
  {
    id: 'sum',
    agg: true,
    name: '做和',
    tag: 'Σ',
    cost: 1.4,
    group: 'multi',
    needKnown: false,
    desc: () => '相邻两项作和',
    apply: (s) => (s.length < 3 ? null : s.slice(1).map((t, i) => tAdd(t, s[i]))),
  },
  {
    id: 'ratio',
    agg: true,
    name: '做商',
    tag: '÷',
    cost: 1.6,
    group: 'multi',
    needKnown: true,
    desc: () => '相邻两项作商（后项除前项）',
    apply: (s) => {
      if (s.length < 3 || !allKnown(s)) return null;
      const out: Term[] = [];
      for (let i = 1; i < s.length; i++) {
        if (isZero(s[i - 1].c)) return null;
        out.push(KNOWN(div(s[i].c, s[i - 1].c)));
      }
      return out;
    },
  },
  {
    id: 'prod',
    agg: true,
    name: '做积',
    tag: '×',
    cost: 2.2,
    group: 'multi',
    needKnown: true,
    desc: () => '相邻两项作积',
    apply: (s) => {
      if (s.length < 3 || !allKnown(s)) return null;
      return s.slice(1).map((t, i) => KNOWN(mul(t.c, s[i].c)));
    },
  },
  {
    id: 'cumsum',
    name: '累加（前缀和）',
    tag: 'CS',
    cost: 2.0,
    group: 'struct',
    needKnown: false,
    desc: () => '逐项累加，得到前缀和数列',
    apply: (s) => {
      let acc = KNOWN(ZERO);
      return s.map((t) => {
        acc = tAdd(acc, t);
        return acc;
      });
    },
  },
  {
    id: 'odd',
    name: '奇数位',
    tag: 'odd',
    cost: 1.5,
    group: 'struct',
    needKnown: false,
    desc: () => '抽出第 1、3、5… 项单独成列（交叉数列）',
    apply: (s) => {
      if (s.length < 5) return null;
      const out = s.filter((_, i) => i % 2 === 0);
      return out.length >= 2 ? out : null;
    },
  },
  {
    id: 'even',
    name: '偶数位',
    tag: 'even',
    cost: 1.5,
    group: 'struct',
    needKnown: false,
    desc: () => '抽出第 2、4、6… 项单独成列（交叉数列）',
    apply: (s) => {
      if (s.length < 5) return null;
      const out = s.filter((_, i) => i % 2 === 1);
      return out.length >= 2 ? out : null;
    },
  },
  {
    id: 'pairSum',
    name: '两两分组求和',
    tag: 'G2+',
    cost: 2.0,
    group: 'struct',
    needKnown: false,
    desc: () => '两两一组，组内求和',
    apply: (s) => {
      if (s.length < 5 || s.length % 2 !== 0) return null;
      const out: Term[] = [];
      for (let i = 0; i + 1 < s.length; i += 2) out.push(tAdd(s[i], s[i + 1]));
      return out.length >= 2 ? out : null;
    },
  },
  {
    id: 'pairDiff',
    name: '两两分组求差',
    tag: 'G2−',
    cost: 2.2,
    group: 'struct',
    needKnown: false,
    desc: () => '两两一组，组内求差（后减前）',
    apply: (s) => {
      if (s.length < 5 || s.length % 2 !== 0) return null;
      const out: Term[] = [];
      for (let i = 0; i + 1 < s.length; i += 2) out.push(tSub(s[i + 1], s[i]));
      return out.length >= 2 ? out : null;
    },
  },
  {
    id: 'tripleSum',
    name: '三三分组求和',
    tag: 'G3+',
    cost: 2.8,
    group: 'struct',
    needKnown: false,
    desc: () => '三三一组，组内求和',
    apply: (s) => {
      if (s.length < 6 || s.length % 3 !== 0) return null;
      const out: Term[] = [];
      for (let i = 0; i + 2 < s.length; i += 3) out.push(tAdd(tAdd(s[i], s[i + 1]), s[i + 2]));
      return out.length >= 2 ? out : null;
    },
  },
  {
    id: 'recip',
    name: '取倒数',
    tag: '1/x',
    cost: 2.4,
    group: 'misc',
    needKnown: true,
    desc: () => '各项取倒数（调和数列）',
    apply: (s) => {
      if (!allKnown(s)) return null;
      if (s.some((t) => isZero(t.c))) return null;
      return s.map((t) => KNOWN(inv(t.c)));
    },
  },
  {
    id: 'neg',
    name: '取相反数',
    tag: '−',
    cost: 3.2,
    group: 'misc',
    needKnown: false,
    desc: () => '各项取相反数（符号循环规律）',
    apply: (s) => s.map((t) => tNeg(t)),
  },
  {
    id: 'abs',
    name: '取绝对值',
    tag: '|x|',
    cost: 3.2,
    group: 'misc',
    needKnown: true,
    desc: () => '各项取绝对值',
    apply: (s) => {
      if (!allKnown(s)) return null;
      return s.map((t) => KNOWN(cmp(t.c, ZERO) < 0 ? neg(t.c) : t.c));
    },
  },
  {
    id: 'sqrt',
    name: '开平方',
    tag: '√',
    cost: 2.2,
    group: 'power',
    needKnown: true,
    desc: () => '各项开平方（均为完全平方数）',
    apply: (s) => {
      if (!allKnown(s)) return null;
      const out: Term[] = [];
      for (const t of s) {
        if (!isInt(t.c) || t.c.n < 0n) return null;
        const r = isqrt(t.c.n);
        if (r === null) return null;
        out.push(KNOWN(fr(r)));
      }
      return out;
    },
  },
  {
    id: 'cbrt',
    name: '开立方',
    tag: '∛',
    cost: 2.4,
    group: 'power',
    needKnown: true,
    desc: () => '各项开立方（均为完全立方数）',
    apply: (s) => {
      if (!allKnown(s)) return null;
      const out: Term[] = [];
      for (const t of s) {
        if (!isInt(t.c) || t.c.n < 0n) return null;
        const r = icbrt(t.c.n);
        if (r === null) return null;
        out.push(KNOWN(fr(r)));
      }
      return out;
    },
  },
  {
    id: 'digitSum',
    name: '数位求和',
    tag: 'Σd',
    cost: 3.0,
    group: 'digit',
    needKnown: true,
    desc: () => '每项拆成各位数字后求和',
    apply: (s) => {
      const ints = allNonNegInt(s);
      if (!ints) return null;
      return ints.map((v) => KNOWN(fr(digitsOf(v.n).reduce((a, b) => a + b, 0n))));
    },
  },
  {
    id: 'digitRev',
    name: '数位倒序',
    tag: 'rev d',
    cost: 3.6,
    group: 'digit',
    needKnown: true,
    desc: () => '每项的数字倒过来写',
    apply: (s) => {
      const ints = allNonNegInt(s);
      if (!ints) return null;
      const out: Term[] = [];
      for (const v of ints) {
        const rev = BigInt([...v.n.toString()].reverse().join(''));
        out.push(KNOWN(fr(rev)));
      }
      return out;
    },
  },
  {
    id: 'digitTens',
    name: '取十位及以上',
    tag: 'd⌊/10⌋',
    cost: 3.8,
    group: 'digit',
    needKnown: true,
    desc: () => '每项去掉个位（相当于整除以 10）',
    apply: (s) => {
      const ints = allNonNegInt(s);
      if (!ints) return null;
      return ints.map((v) => KNOWN(fr(v.n / 10n)));
    },
  },
];

export function isqrt(v: bigint): bigint | null {
  if (v < 0n) return null;
  if (v < 2n) return v;
  let x = v;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + v / x) / 2n;
  }
  return x * x === v ? x : null;
}

export function icbrt(v: bigint): bigint | null {
  if (v < 0n) return null;
  if (v < 2n) return v;
  let x = BigInt(Math.round(Math.cbrt(Number(v)))) + 2n;
  while (x > 0n && x * x * x > v) x--;
  return x * x * x === v ? x : null;
}

export const OP_MAP = new Map(OPS.map((o) => [o.id, o]));
