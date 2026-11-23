/**
 * 识别器（Recognizer）：在一列数上判定"这是什么基本规律"，并给出外推能力。
 *
 * 每个识别器都要求能在「含一个未知项 x」的序列上工作：
 *  - 线性类（常数/等差/等比/多项式/递推）用仿射约束精确解出 x；
 *  - 值类（质数/平方/幂次/周期）跳过未知项匹配，再用规则把 x 反算回来。
 *
 * 复杂度（complexity）参与最终排序：越简单越优先。
 */
import * as F from './fraction';
import * as T from './term';
import { Frac, ZERO, ONE, fr } from './fraction';
import { Term, KNOWN, VAR } from './term';

export interface Fit {
  rid: string;
  name: string;
  complexity: number;
  /** 若序列含未知项，这里是解出的值 */
  x?: Frac;
  /** 纯数值外推：i < n 返回原项，i >= n 返回外推项 */
  at: (i: number) => Frac | null;
  describe: () => string;
  /** 逐项拆解说明（如因子分解），用于界面展示 */
  lines?: string[];
  /** 规律本身是开放的（满足条件的解不唯一），只能靠选项筛选 */
  openEnded?: boolean;
}

export interface Recognizer {
  id: string;
  name: string;
  cost: number;
  /** 仅在算子链深度不超过该值时才尝试（昂贵的识别器用） */
  maxDepth?: number;
  match(seq: Term[]): Fit | null;
}

/** 单变量线性约束收集器：a = b */
class Lin {
  private fixed: Frac | null = null;
  private bad = false;

  eq(a: Term, b: Term): boolean {
    if (this.bad) return false;
    const dk = F.sub(a.k, b.k);
    const dc = F.sub(b.c, a.c); // dk * x = dc
    if (F.isZero(dk)) {
      if (!F.isZero(dc)) {
        this.bad = true;
        return false;
      }
      return true;
    }
    const x = F.div(dc, dk);
    if (this.fixed === null) this.fixed = x;
    else if (!F.eq(this.fixed, x)) {
      this.bad = true;
      return false;
    }
    return true;
  }

  get ok() {
    return !this.bad;
  }
  get value() {
    return this.fixed;
  }
}

const hasVar = (seq: Term[]) => seq.some(T.isVar);
const allKnown = (seq: Term[]) => seq.every(T.isKnown);

/** k 阶差分 */
function kthDiff(seq: Term[], k: number): Term[] {
  let cur = seq.slice();
  for (let j = 0; j < k; j++) {
    const next: Term[] = [];
    for (let i = 1; i < cur.length; i++) next.push(T.tSub(cur[i], cur[i - 1]));
    cur = next;
  }
  return cur;
}

/** 纯数值差分表外推器 */
class DiffExtrap {
  rows: Frac[][];
  constructor(vals: Frac[]) {
    this.rows = [vals.slice()];
    let cur = vals.slice();
    while (cur.length > 1) {
      const nx: Frac[] = [];
      for (let i = 1; i < cur.length; i++) nx.push(F.sub(cur[i], cur[i - 1]));
      this.rows.push(nx);
      cur = nx;
    }
  }
  next(): Frac {
    const top = this.rows[this.rows.length - 1];
    let seed = top[top.length - 1];
    for (let r = this.rows.length - 2; r >= 0; r--) {
      const row = this.rows[r];
      const v = F.add(row[row.length - 1], seed);
      row.push(v);
      seed = v;
    }
    return seed;
  }
}

function cacheAt(vals: Frac[], gen: () => Frac): (i: number) => Frac | null {
  const cache = vals.slice();
  return (i: number) => {
    if (i < 0) return null;
    while (cache.length <= i) cache.push(gen());
    return cache[i];
  };
}

/* ------------------------------------------------------------------ */
/* 质数表                                                              */
/* ------------------------------------------------------------------ */
const PRIMES: number[] = (() => {
  const N = 20000;
  const mark = new Uint8Array(N + 1);
  const out: number[] = [];
  for (let i = 2; i <= N; i++) {
    if (!mark[i]) {
      out.push(i);
      for (let j = i * i; j <= N; j += i) mark[j] = 1;
    }
  }
  return out;
})();

const COMPOSITES: number[] = (() => {
  const out: number[] = [];
  for (let i = 4; i < 5000; i++) {
    if (PRIMES.indexOf(i) === -1) out.push(i);
  }
  return out;
})();

/* ------------------------------------------------------------------ */
/* 线性代数：解小型线性方程组（有理数）                                  */
/* ------------------------------------------------------------------ */
function solveLinear(A: Frac[][], b: Frac[]): Frac[] | null {
  const n = A.length;
  const m = A[0].length;
  const M = A.map((row, i) => [...row, b[i]]);
  let row = 0;
  for (let col = 0; col < m && row < n; col++) {
    let piv = -1;
    for (let r = row; r < n; r++) {
      if (!F.isZero(M[r][col])) {
        piv = r;
        break;
      }
    }
    if (piv === -1) continue;
    [M[row], M[piv]] = [M[piv], M[row]];
    const pv = M[row][col];
    for (let c = col; c <= m; c++) M[row][c] = F.div(M[row][c], pv);
    for (let r = 0; r < n; r++) {
      if (r === row) continue;
      const f = M[r][col];
      if (F.isZero(f)) continue;
      for (let c = col; c <= m; c++) M[r][c] = F.sub(M[r][c], F.mul(f, M[row][c]));
    }
    row++;
  }
  // 检查一致性
  for (let r = row; r < n; r++) {
    if (!F.isZero(M[r][m]) && M[r].slice(0, m).every(F.isZero)) return null;
  }
  if (row < m) return null; // 秩不足，解不唯一
  const sol: Frac[] = new Array(m).fill(ZERO);
  for (let r = 0; r < m; r++) sol[r] = M[r][m];
  return sol;
}

/* ------------------------------------------------------------------ */
/* 参数"数值复杂度"惩罚：系数越大，越不像人为设计的规律                    */
/* ------------------------------------------------------------------ */
function sizePenalty(params: Frac[]): number {
  let s = 0;
  for (const p of params) {
    const v = Math.abs(Number(p.n) / Number(p.d));
    if (!Number.isFinite(v)) {
      s += 1.5;
      continue;
    }
    if (v > 100) s += 2.0;
    else if (v > 10) s += 1.2;
    else if (v > 3) s += 0.5;
  }
  return s;
}

/* ------------------------------------------------------------------ */
/* 1. 常数                                                             */
/* ------------------------------------------------------------------ */
const constantRec: Recognizer = {
  id: 'const',
  name: '常数数列',
  cost: 1.5,
  match(seq) {
    if (seq.length < 3) return null;
    const lin = new Lin();
    for (let i = 1; i < seq.length; i++) if (!lin.eq(seq[i], seq[0])) return null;
    if (!lin.ok) return null;
    if (hasVar(seq) && lin.value === null) return null;
    const base = T.isKnown(seq[0]) ? seq[0].c : lin.value!;
    return {
      rid: 'const',
      name: '常数',
      complexity: 0.5,
      x: lin.value ?? undefined,
      at: (i) => (i < 0 ? null : base),
      describe: () => `各项恒为 ${F.fracToString(base)}`,
    };
  },
};

/* ------------------------------------------------------------------ */
/* 2. 等差                                                             */
/* ------------------------------------------------------------------ */
const arithRec: Recognizer = {
  id: 'arith',
  name: '等差数列',
  cost: 1,
  match(seq) {
    if (seq.length < 3) return null;
    const d: Term[] = [];
    for (let i = 1; i < seq.length; i++) d.push(T.tSub(seq[i], seq[i - 1]));
    const lin = new Lin();
    for (let i = 1; i < d.length; i++) if (!lin.eq(d[i], d[0])) return null;
    if (!lin.ok) return null;
    const needX = hasVar(seq);
    const x = lin.value;
    if (needX && x === null) return null;

    const sub = (t: Term) => (T.isKnown(t) ? t.c : F.add(t.c, F.mul(t.k, x!)));
    const base = sub(seq[0]);
    const dd = sub(d[0]);
    const at = (i: number) => F.add(base, F.mul(dd, fr(i)));
    return {
      rid: 'arith',
      name: '等差',
      complexity: 1,
      x: x ?? undefined,
      at: (i) => (i < 0 ? null : at(i)),
      describe: () => `等差数列，公差 ${F.fracToString(dd)}`,
    };
  },
};

/* ------------------------------------------------------------------ */
/* 3. 等比                                                             */
/* ------------------------------------------------------------------ */
const geomRec: Recognizer = {
  id: 'geom',
  name: '等比数列',
  cost: 1.2,
  match(seq) {
    if (seq.length < 3) return null;
    // 先用全部已知相邻对确定公比
    let r: Frac | null = null;
    for (let i = 0; i + 1 < seq.length; i++) {
      const a = seq[i];
      const b = seq[i + 1];
      if (!T.isKnown(a) || !T.isKnown(b)) continue;
      if (F.isZero(a.c)) return null;
      const rr = F.div(b.c, a.c);
      if (r === null) r = rr;
      else if (!F.eq(r, rr)) return null;
    }
    if (r === null) return null;
    if (F.isZero(r)) return null;

    // 用仿射约束解未知项
    const lin = new Lin();
    for (let i = 0; i + 1 < seq.length; i++) {
      const lhs = seq[i + 1];
      const rhs = T.tScale(seq[i], r);
      if (!lin.eq(lhs, rhs)) return null;
    }
    if (!lin.ok) return null;
    const needX = hasVar(seq);
    const x = lin.value;
    if (needX && x === null) return null;

    let a0: Frac;
    if (T.isKnown(seq[0])) a0 = seq[0].c;
    else if (x !== null) a0 = F.add(seq[0].c, F.mul(seq[0].k, x));
    else return null;

    const at = (i: number) => {
      let v = a0;
      for (let j = 0; j < i; j++) v = F.mul(v, r!);
      return v;
    };
    return {
      rid: 'geom',
      name: '等比',
      complexity: 1.2,
      x: x ?? undefined,
      at: (i) => (i < 0 ? null : at(i)),
      describe: () => `等比数列，公比 ${F.fracToString(r!)}`,
    };
  },
};

/* ------------------------------------------------------------------ */
/* 4. 多项式 / 多级差分                                                 */
/* ------------------------------------------------------------------ */
const polyRec: Recognizer = {
  id: 'poly',
  name: '多级差分',
  cost: 2.2,
  match(seq) {
    const n = seq.length;
    const maxDeg = Math.min(4, n - 3);
    for (let k = 2; k <= maxDeg; k++) {
      const d = kthDiff(seq, k);
      if (d.length < 3) continue;
      const lin = new Lin();
      let ok = true;
      for (let i = 1; i < d.length; i++) {
        if (!lin.eq(d[i], d[0])) {
          ok = false;
          break;
        }
      }
      if (!ok || !lin.ok) continue;
      const needX = hasVar(seq);
      if (needX && lin.value === null) continue;

      const vals = seq.map((t) =>
        T.isKnown(t) ? t.c : F.add(t.c, F.mul(t.k, lin.value!)),
      );
      const ex = new DiffExtrap(vals);
      const cache = cacheAt(vals, () => ex.next());
      const cst = T.isKnown(d[0])
        ? d[0].c
        : F.add(d[0].c, F.mul(d[0].k, lin.value!));
      return {
        rid: 'poly',
        name: `${k} 阶差分恒定`,
        complexity: 1 + 1.2 * k,
        x: lin.value ?? undefined,
        at: cache,
        describe: () =>
          `连续做 ${k} 次差，第 ${k} 阶差分恒为 ${F.fracToString(cst)}`,
      };
    }
    return null;
  },
};

/* ------------------------------------------------------------------ */
/* 5. 周期                                                             */
/* ------------------------------------------------------------------ */
const periodicRec: Recognizer = {
  id: 'periodic',
  name: '周期数列',
  cost: 2.0,
  match(seq) {
    const n = seq.length;
    for (let p = 2; p <= 4; p++) {
      if (n < p * 2) break;
      const lin = new Lin();
      let ok = true;
      for (let i = p; i < n; i++) {
        if (!lin.eq(seq[i], seq[i % p])) {
          ok = false;
          break;
        }
      }
      if (!ok || !lin.ok) continue;
      if (hasVar(seq) && lin.value === null) continue;
      const vals = seq.map((t) =>
        T.isKnown(t) ? t.c : F.add(t.c, F.mul(t.k, lin.value!)),
      );
      // 四位数以上还考"周期循环"的极少，实际考的是数位关系，这里降权
      const big = vals.length > 0 && vals.every((v) => F.isInt(v) && (v.n >= 100n || v.n <= -100n));
      return {
        rid: 'periodic',
        name: `周期 ${p}`,
        complexity: 1.6 + 0.2 * p + (big ? 1.6 : 0),
        x: lin.value ?? undefined,
        at: (i) => (i < 0 ? null : vals[i % p]),
        describe: () => `以 ${p} 为周期循环，循环节 [${vals.slice(0, p).map(F.fracToString).join(', ')}]`,
      };
    }
    return null;
  },
};

/* ------------------------------------------------------------------ */
/* 6. 质数 / 合数                                                      */
/* ------------------------------------------------------------------ */
function tableRec(
  id: string,
  name: string,
  table: number[],
  tableName: string,
  cost: number,
): Recognizer {
  return {
    id,
    name,
    cost,
    match(seq) {
      const n = seq.length;
      // 用第一个已知项确定起点
      let anchor = -1;
      for (let i = 0; i < n; i++) {
        if (T.isKnown(seq[i])) {
          anchor = i;
          break;
        }
      }
      if (anchor === -1) return null;
      if (!F.isInt(seq[anchor].c)) return null;
      const v = Number(seq[anchor].c.n);
      const start = table.indexOf(v) - anchor;
      if (start < 0) return null;
      const lin = new Lin();
      for (let i = 0; i < n; i++) {
        const target = table[start + i];
        if (target === undefined) return null;
        const t = seq[i];
        if (T.isKnown(t)) {
          if (!F.isInt(t.c) || Number(t.c.n) !== target) return null;
        }
      }
      // 未知项反算
      let x: Frac | undefined;
      for (let i = 0; i < n; i++) {
        if (T.isVar(seq[i])) {
          const tv = fr(table[start + i]);
          if (F.isZero(seq[i].k)) continue;
          const xx = F.div(F.sub(tv, seq[i].c), seq[i].k);
          if (x === undefined) x = xx;
          else if (!F.eq(x, xx)) return null;
        }
      }
      if (hasVar(seq) && x === undefined) return null;
      return {
        rid: id,
        name,
        complexity: 1.8,
        x,
        at: (i) => {
          const v = table[start + i];
          return v === undefined ? null : fr(v);
        },
        describe: () => `连续${tableName}，从 ${table[start]} 开始`,
      };
    },
  };
}

const primeRec = tableRec('prime', '质数', PRIMES, '质数', 1.8);
const compositeRec = tableRec('composite', '合数', COMPOSITES, '合数', 3.2);

/* ------------------------------------------------------------------ */
/* 7. 幂次型：n^k、a^n、带常数修正                                       */
/* ------------------------------------------------------------------ */
interface PowForm {
  label: string;
  f: (i: number) => number;
}

const POW_FORMS: PowForm[] = [
  { label: '(n+1)²', f: (i) => (i + 1) * (i + 1) },
  { label: '(n+1)³', f: (i) => (i + 1) ** 3 },
  { label: 'n²', f: (i) => i * i },
  { label: 'n³', f: (i) => i ** 3 },
  { label: '(n+1)⁴', f: (i) => (i + 1) ** 4 },
  { label: '2^(n+1)', f: (i) => 2 ** (i + 1) },
  { label: '3^(n+1)', f: (i) => 3 ** (i + 1) },
  { label: '2^n', f: (i) => 2 ** i },
];

const powerRec: Recognizer = {
  id: 'power',
  name: '幂次数列',
  cost: 2.4,
  match(seq) {
    const n = seq.length;
    if (n < 4) return null;
    for (const form of POW_FORMS) {
      // 用第一个已知项与 form(0) 确定偏移量
      let anchor = -1;
      for (let i = 0; i < n; i++) {
        if (T.isKnown(seq[i])) {
          anchor = i;
          break;
        }
      }
      if (anchor === -1) continue;
      if (!F.isInt(seq[anchor].c)) continue;
      const off = F.sub(seq[anchor].c, fr(form.f(anchor)));
      let ok = true;
      for (let i = 0; i < n; i++) {
        const t = seq[i];
        if (!T.isKnown(t)) continue;
        if (!F.eq(t.c, F.add(fr(form.f(i)), off))) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      // 未知项反算
      let x: Frac | undefined;
      for (let i = 0; i < n; i++) {
        if (T.isVar(seq[i])) {
          const tv = F.add(fr(form.f(i)), off);
          const xx = F.div(F.sub(tv, seq[i].c), seq[i].k);
          if (x === undefined) x = xx;
          else if (!F.eq(x, xx)) {
            ok = false;
            break;
          }
        }
      }
      if (!ok) continue;
      if (hasVar(seq) && x === undefined) continue;
      // 纯幂次（无修正）时复杂度更低
      const noOff = F.isZero(off);
      return {
        rid: 'power',
        name: noOff ? '幂次' : '幂次修正',
        complexity: noOff ? 1.6 : 2.3,
        x,
        at: (i) => F.add(fr(form.f(i)), off),
        describe: () =>
          noOff
            ? `通项为 ${form.label}`
            : `通项为 ${form.label} ${F.cmp(off, ZERO) < 0 ? '−' : '+'} ${F.fracToString(
                F.cmp(off, ZERO) < 0 ? F.neg(off) : off,
              )}`,
      };
    }
    return null;
  },
};

/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/* 8~10. 线性递推：aₙ = p₁·aₙ₋₁ + … + p_k·aₙ₋ₖ + s                      */
/*                                                                     */
/* 约束足够时用精确消元；约束不足（短序列或中间挖空）时枚举小整数系数，   */
/* 用「参数绝对值之和」作为奥卡姆代价，取最简且能验证通过的那一组。      */
/* ------------------------------------------------------------------ */
function matchRecur(seq: Term[], order: number, maxP: number): Fit | null {
  const n = seq.length;
  if (n < order + 3) return null;

  const rows: Frac[][] = [];
  const rhs: Frac[] = [];
  const knownWin: number[] = [];
  for (let i = 0; i + order < n; i++) {
    let ok = true;
    const w: Frac[] = [];
    for (let j = 0; j < order; j++) {
      const t = seq[i + order - 1 - j];
      if (!T.isKnown(t)) {
        ok = false;
        break;
      }
      w.push(t.c);
    }
    if (!ok || !T.isKnown(seq[i + order])) continue;
    rows.push([...w, ONE]);
    rhs.push(seq[i + order].c);
    knownWin.push(i);
  }

  const verify = (p: Frac[], s: Frac): Lin | null => {
    const lin = new Lin();
    for (let i = 0; i + order < n; i++) {
      let pred: Term = KNOWN(s);
      for (let j = 0; j < order; j++) pred = T.tAdd(pred, T.tScale(seq[i + order - 1 - j], p[j]));
      if (!lin.eq(seq[i + order], pred)) return null;
    }
    return lin.ok ? lin : null;
  };

  let params: Frac[] | null = null;

  // 路径 1：约束足够 → 只走精确解（超定无解时不必再枚举）
  if (rows.length >= order + 2) {
    const sol = solveLinear(rows, rhs);
    if (!sol) return null;
    if (!verify(sol.slice(0, order), sol[order])) return null;
    params = sol;
  }

  // 路径 2：约束不足 → 枚举小整数系数
  if (!params && knownWin.length >= 1) {
    const i0 = knownWin[0];
    const xs: Frac[] = [];
    for (let j = 0; j < order; j++) xs.push(seq[i0 + order - 1 - j].c);
    const lhs0 = seq[i0 + order].c;

    const cands: { p: Frac[]; s: Frac; cost: number }[] = [];
    const idx = new Array(order).fill(0);
    const gen = (d: number) => {
      if (d === order) {
        const pp = idx.map((v) => fr(v));
        let acc = lhs0;
        for (let j = 0; j < order; j++) acc = F.sub(acc, F.mul(pp[j], xs[j]));
        const absS = Math.abs(Number(acc.n) / Number(acc.d));
        if (!Number.isFinite(absS) || absS > 200) return;
        const cost = idx.reduce((a, v) => a + Math.abs(v), 0) + absS;
        cands.push({ p: pp, s: acc, cost });
        return;
      }
      for (let v = -maxP; v <= maxP; v++) {
        idx[d] = v;
        gen(d + 1);
      }
    };
    gen(0);
    cands.sort((a, b) => a.cost - b.cost);
    for (const c of cands) {
      if (verify(c.p, c.s)) {
        params = [...c.p, c.s];
        break;
      }
    }
  }

  if (!params) return null;

  const pc = params.slice(0, order);
  const sc = params[order];
  const lin = verify(pc, sc);
  if (!lin) return null;
  const x = lin.value;
  if (seq.some(T.isVar) && x === null) return null;

  const sub = (t: Term) => (T.isKnown(t) ? t.c : F.add(t.c, F.mul(t.k, x!)));
  const vals = seq.map(sub);
  const cache = cacheAt(vals, () => {
    const m = vals.length;
    let v = sc;
    for (let j = 0; j < order; j++) v = F.add(v, F.mul(vals[m - 1 - j], pc[j]));
    vals.push(v);
    return v;
  });

  const parts: string[] = [];
  for (let j = 0; j < order; j++) {
    if (F.isZero(pc[j])) continue;
    const c = pc[j];
    const coefStr = F.eq(c, ONE) ? '' : F.eq(c, F.neg(ONE)) ? '−' : `${F.fracToString(c)}·`;
    parts.push(`${coefStr}aₙ₋${j + 1}`);
  }
  if (!F.isZero(sc)) parts.push(F.fracToString(sc));

  const baseCost = order === 1 ? 2.6 : order === 2 ? 3.2 : 3.9;
  return {
    rid: `linRec${order}`,
    name: order === 1 ? '一阶递推' : `${order} 阶递推`,
    complexity: baseCost + sizePenalty([...pc, sc]),
    x: x ?? undefined,
    at: cache,
    describe: () => `每项 = ${parts.join(' + ').replace(/\+ −/g, '− ')}`,
  };
}

const affineRecRec: Recognizer = {
  id: 'affineRec',
  name: '一阶递推（倍加）',
  cost: 2.6,
  match: (seq) => matchRecur(seq, 1, 6),
};

const linRec2: Recognizer = {
  id: 'linRec2',
  name: '二阶线性递推',
  cost: 3.2,
  match: (seq) => matchRecur(seq, 2, 3),
};

const linRec3: Recognizer = {
  id: 'linRec3',
  name: '三阶线性递推',
  cost: 3.9,
  match: (seq) => matchRecur(seq, 3, 3),
};


/* ------------------------------------------------------------------ */
/* 10. 因式分解型：aᵢ = f(i)·g(i)（连续整数之积 / 平方差）                */
/* ------------------------------------------------------------------ */
const productRec: Recognizer = {
  id: 'product',
  name: '因式分解',
  cost: 2.8,
  match(seq) {
    const n = seq.length;
    if (n < 4) return null;
    if (!allKnown(seq)) return null;
    const vals = seq.map((t) => t.c);
    if (vals.some((v) => !F.isInt(v) || v.n <= 0n)) return null;

    // 形式：k(k+1) / (k-1)k / k(k+2)
    const forms: { label: string; ok: (v: bigint, k: bigint) => boolean; f: (k: bigint) => bigint }[] = [
      { label: 'n(n+1)', ok: (v, k) => v === k * (k + 1n), f: (k) => k },
      { label: '(n-1)n', ok: (v, k) => v === (k - 1n) * k, f: (k) => k },
      { label: 'n(n+2)', ok: (v, k) => v === k * (k + 2n), f: (k) => k },
    ];
    for (const form of forms) {
      // 由第一项反推 k
      const v0 = vals[0].n;
      const r0 = Number.isFinite(Number(v0)) ? Math.round(Math.sqrt(Number(v0))) : 0;
      let matched: bigint[] | null = null;
      for (let cand = Math.max(1, r0 - 2); cand <= r0 + 2; cand++) {
        const k0 = BigInt(cand);
        if (!form.ok(v0, k0)) continue;
        const ks: bigint[] = [k0];
        let good = true;
        for (let i = 1; i < n; i++) {
          ks.push(k0 + BigInt(i));
          if (!form.ok(vals[i].n, ks[i])) {
            good = false;
            break;
          }
        }
        if (good) {
          matched = ks;
          break;
        }
      }
      if (!matched) continue;
      return {
        rid: 'product',
        name: '因式分解',
        complexity: 2.6,
        at: (i) => {
          const k = matched![0] + BigInt(i);
          const v = form.label === 'n(n+1)' ? k * (k + 1n) : form.label === '(n-1)n' ? (k - 1n) * k : k * (k + 2n);
          return fr(v);
        },
        describe: () => `每项拆成两个因子之积，形如 ${form.label}`,
      };
    }
    return null;
  },
};

/* ------------------------------------------------------------------ */
/* 11. 阶乘型                                                          */
/* ------------------------------------------------------------------ */
const FACT: number[] = (() => {
  const out = [1];
  for (let i = 1; i <= 16; i++) out.push(out[i - 1] * i);
  return out;
})();

const factorialRec: Recognizer = {
  id: 'factorial',
  name: '阶乘数列',
  cost: 3.4,
  match(seq) {
    const n = seq.length;
    if (n < 4) return null;
    for (const off of [0, 1, -1]) {
      const startIdx = FACT.indexOf(Number(seq[0]?.c?.n ?? -999)) - off;
      if (startIdx < 0) continue;
      let ok = true;
      for (let i = 0; i < n; i++) {
        if (!T.isKnown(seq[i]) || !F.isInt(seq[i].c)) {
          ok = false;
          break;
        }
        if (Number(seq[i].c.n) !== FACT[startIdx + i] + off) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      return {
        rid: 'factorial',
        name: '阶乘',
        complexity: 3.0,
        at: (i) => (FACT[startIdx + i] === undefined ? null : fr(FACT[startIdx + i] + off)),
        describe: () => (off === 0 ? '各项为阶乘数' : `各项为阶乘数 ${off > 0 ? '+' : '−'} 1`),
      };
    }
    return null;
  },
};

/* ------------------------------------------------------------------ */
/* 12. 分数拆分数列：分子、分母各自成规律                                 */
/* ------------------------------------------------------------------ */
/** 轻量外推：只识别等差 / 等比 / 二阶差分 / 质数 */
function simpleExtrap(vals: Frac[]): ((i: number) => Frac | null) | null {
  const n = vals.length;
  if (n < 3) return null;

  const d = F.sub(vals[1], vals[0]);
  if (vals.every((v, i) => i === 0 || F.eq(F.sub(v, vals[i - 1]), d))) {
    return (i) => F.add(vals[0], F.mul(d, fr(i)));
  }

  if (!F.isZero(vals[0])) {
    const r = F.div(vals[1], vals[0]);
    if (!F.isZero(r) && vals.every((v, i) => i === 0 || F.eq(F.div(v, vals[i - 1]), r))) {
      return (i) => {
        let v = vals[0];
        for (let j = 0; j < i; j++) v = F.mul(v, r);
        return v;
      };
    }
  }

  if (n >= 4) {
    const d1 = vals.slice(1).map((v, i) => F.sub(v, vals[i]));
    const d2 = d1.slice(1).map((v, i) => F.sub(v, d1[i]));
    if (d2.every((v) => F.eq(v, d2[0]))) {
      const ex = new DiffExtrap(vals);
      const cache = cacheAt(vals, () => ex.next());
      return cache;
    }
  }

  // 1 打头的连续质数：1, 2, 3, 5, 7, 11…
  if (n >= 4 && F.isInt(vals[0]) && vals[0].n === 1n && vals.slice(1).every(F.isInt)) {
    const start = PRIMES.indexOf(Number(vals[1].n));
    if (start >= 0 && vals.slice(1).every((v, i) => Number(v.n) === PRIMES[start + i])) {
      return (i) => {
        if (i === 0) return fr(1);
        const p = PRIMES[start + i - 1];
        return p === undefined ? null : fr(p);
      };
    }
  }

  if (vals.every((v) => F.isInt(v) && v.n > 0n)) {
    const start = PRIMES.indexOf(Number(vals[0].n));
    if (start >= 0 && vals.every((v, i) => Number(v.n) === PRIMES[start + i])) {
      return (i) => {
        const p = PRIMES[start + i];
        return p === undefined ? null : fr(p);
      };
    }
  }
  return null;
}

const fracSplitRec: Recognizer = {
  id: 'fracSplit',
  name: '分数拆分',
  cost: 2.2,
  match(seq) {
    if (seq.length < 4 || !seq.every(T.isKnown)) return null;
    const vals = seq.map((t) => t.c);
    const fracCount = vals.filter((v) => v.d !== 1n).length;
    if (fracCount < 3) return null;

    const nums = vals.map((v) => fr(v.n));
    const dens = vals.map((v) => fr(v.d));
    const fn = simpleExtrap(nums);
    const fd = simpleExtrap(dens);
    if (!fn || !fd) return null;

    const at = (i: number) => {
      const a = fn(i);
      const b = fd(i);
      if (!a || !b || F.isZero(b)) return null;
      return F.div(a, b);
    };
    return {
      rid: 'fracSplit',
      name: '分数拆分',
      complexity: 2.2,
      at,
      describe: () => '分子、分母各自构成规律，分别外推后再相除',
    };
  },
};

/* ------------------------------------------------------------------ */
/* 13. 分组规律：三三分组 a+b=c、两两分组组内关系                        */
/* ------------------------------------------------------------------ */
const groupRec: Recognizer = {
  id: 'group',
  name: '分组规律',
  cost: 2.1,
  match(seq) {
    if (seq.length < 6 || !seq.every(T.isKnown)) return null;
    const v = seq.map((t) => t.c);
    const n = v.length;

    // 三三分组：a+b=c 或 a×b=c
    for (const kind of ['sum', 'prod'] as const) {
      let groups = 0;
      let ok = true;
      for (let i = 0; i + 2 < n; i += 3) {
        const lhs = kind === 'sum' ? F.add(v[i], v[i + 1]) : F.mul(v[i], v[i + 1]);
        if (!F.eq(lhs, v[i + 2])) {
          ok = false;
          break;
        }
        groups++;
      }
      if (!ok || groups < 2) continue;
      return {
        rid: 'group',
        name: '三三分组',
        complexity: 2.0,
        at: (i) => {
          if (i < 0) return null;
          if (i < n) return v[i];
          if (i % 3 !== 2) return null;
          return kind === 'sum' ? F.add(v[i - 2], v[i - 1]) : F.mul(v[i - 2], v[i - 1]);
        },
        describe: () =>
          kind === 'sum'
            ? '每三项一组，前两项之和等于第三项'
            : '每三项一组，前两项之积等于第三项',
      };
    }

    // 两两分组：组内差恒定 / 和恒定 / 倍数恒定
    const heads = v.filter((_, i) => i % 2 === 0);
    const headFit = simpleExtrap(heads);
    const rels: { name: string; f: (a: Frac) => Frac; test: (a: Frac, b: Frac) => boolean }[] = [
      { name: '差恒定', f: (a) => F.add(a, F.sub(v[1], v[0])), test: (a, b) => F.eq(F.sub(b, a), F.sub(v[1], v[0])) },
      { name: '和恒定', f: (a) => F.sub(F.add(v[0], v[1]), a), test: (a, b) => F.eq(F.add(a, b), F.add(v[0], v[1])) },
    ];
    if (!F.isZero(v[0])) {
      const c = F.div(v[1], v[0]);
      rels.push({ name: '倍数恒定', f: (a) => F.mul(a, c), test: (a, b) => F.eq(F.mul(a, c), b) });
    }
    for (const rel of rels) {
      let ok = true;
      let pairs = 0;
      for (let i = 0; i + 1 < n; i += 2) {
        if (!rel.test(v[i], v[i + 1])) {
          ok = false;
          break;
        }
        pairs++;
      }
      if (!ok || pairs < 2) continue;
      return {
        rid: 'group',
        name: '两两分组',
        complexity: 2.0,
        at: (i) => {
          if (i < 0) return null;
          if (i < n) return v[i];
          if (i % 2 === 1) return rel.f(v[i - 1]);
          // 组首项需要单独成规律
          return headFit ? headFit(i / 2) : null;
        },
        describe: () => `每两项一组，组内${rel.name}`,
      };
    }
    return null;
  },
};

/* ------------------------------------------------------------------ */
/* 14. 隔项递推：aᵢ + aᵢ₊₁ = aᵢ₊₂（偶数位起）                            */
/* ------------------------------------------------------------------ */
const pairChainRec: Recognizer = {
  id: 'pairChain',
  name: '隔项递推',
  cost: 2.4,
  match(seq) {
    if (seq.length < 6 || !seq.every(T.isKnown)) return null;
    const v = seq.map((t) => t.c);
    const n = v.length;
    let checked = 0;
    for (let i = 0; i + 2 < n; i += 2) {
      if (!F.eq(F.add(v[i], v[i + 1]), v[i + 2])) return null;
      checked++;
    }
    if (checked < 2) return null;
    return {
      rid: 'pairChain',
      name: '隔项递推',
      complexity: 2.2,
      at: (i) => {
        if (i < 0) return null;
        if (i < n) return v[i];
        if (i % 2 !== 0) return null;
        return F.add(v[i - 2], v[i - 1]);
      },
      describe: () => '每两项之和等于后面的第三项，再跳一项继续',
    };
  },
};

/* ------------------------------------------------------------------ */
/* 14b. 因子分解：每项拆成两个因子之积，两个因子各自成规律                 */
/*                                                                     */
/* 例：1, 18, 75, 245, 567, 1331 → 1×1, 2×9, 3×25, 5×49, 7×81, 11×121   */
/*     即「质数 × 奇数平方」。每项分解不唯一，需搜索出让两条因子序列同时   */
/*     规整的那一组分解。用前 4 项枚举、后续项在线验证来剪枝。            */
/* ------------------------------------------------------------------ */
const FACTOR_CACHE = new Map<string, [bigint, bigint][]>();

function factorPairsOf(n: bigint, limit = 24): [bigint, bigint][] {
  if (n === 1n) return [[1n, 1n]];
  if (n < 1n || n > 10_000_000n) return [];
  const key = n.toString();
  const cached = FACTOR_CACHE.get(key);
  if (cached) return cached;
  const out: [bigint, bigint][] = [];
  for (let i = 1n; i * i <= n; i++) {
    if (n % i === 0n) {
      out.push([i, n / i]);
      if (out.length >= limit) break;
    }
  }
  if (FACTOR_CACHE.size < 5000) FACTOR_CACHE.set(key, out);
  return out;
}

const factorRec: Recognizer = {
  id: 'factor',
  name: '因子分解',
  cost: 2.7,
  maxDepth: 0,
  match(seq) {
    const n = seq.length;
    if (n < 4 || n > 10) return null;
    if (!seq.every(T.isKnown)) return null;

    const vals: bigint[] = [];
    for (const t of seq) {
      if (!F.isInt(t.c) || t.c.n < 1n) return null;
      vals.push(t.c.n);
    }
    const pairs = vals.map((v) => factorPairsOf(v));
    if (pairs.some((p) => p.length === 0)) return null;
    // 若每项都只有 (1, p) 一种拆法（质数），分解没有意义
    if (pairs.every((p) => p.length === 1)) return null;

    const K = Math.min(4, n);
    let space = 1;
    for (let i = 0; i < K; i++) space *= pairs[i].length;
    if (space > 2500) return null;

    const idx = new Array(K).fill(0);
    type Hit = { fa: (i: number) => Frac | null; fb: (i: number) => Frac | null };
    const box: { hit?: Hit } = {};
    let tried = 0;

    const gen = (d: number) => {
      if (box.hit || tried > 2500) return;
      if (d === K) {
        tried++;
        const aVals = idx.map((k, i) => pairs[i][k][0]);
        if (aVals.every((v) => v === 1n)) return; // 退化成原序列
        const bVals = idx.map((k, i) => pairs[i][k][1]);
        const fa = simpleExtrap(aVals.map((v) => fr(v)));
        const fb = simpleExtrap(bVals.map((v) => fr(v)));
        if (!fa || !fb) return;
        for (let i = K; i < n; i++) {
          const pa = fa(i);
          const pb = fb(i);
          if (!pa || !pb) return;
          if (!pairs[i].some(([x, y]) => F.eq(pa, fr(x)) && F.eq(pb, fr(y)))) return;
        }
        box.hit = { fa, fb };
        return;
      }
      for (let k = 0; k < pairs[d].length; k++) {
        idx[d] = k;
        gen(d + 1);
        if (box.hit) return;
      }
    };
    gen(0);
    if (!box.hit) return null;

    const { fa, fb } = box.hit;
    const fmt = (v: Frac) => (F.isInt(v) ? v.n.toString() : `${v.n}/${v.d}`);
    const lines: string[] = [];
    for (let i = 0; i < n; i++) {
      const a = fa(i);
      const b = fb(i);
      if (!a || !b) break;
      lines.push(`${fmt(seq[i].c)} = ${fmt(a)} × ${fmt(b)}`);
    }
    const na = fa(n);
    const nb = fb(n);
    if (na && nb) lines.push(`? = ${fmt(na)} × ${fmt(nb)} = ${fmt(F.mul(na, nb))}`);

    return {
      rid: 'factor',
      name: '因子分解',
      complexity: 2.5,
      at: (i) => {
        const a = fa(i);
        const b = fb(i);
        if (!a || !b) return null;
        return F.mul(a, b);
      },
      describe: () => '每项拆成两个因子之积，两个因子各自构成规律',
      lines,
    };
  },
};

/* ------------------------------------------------------------------ */
/* 14c. 数位等式：各位数字分成两组，组内运算后相等                        */
/*                                                                     */
/* 例：2675 → 2×6 = 7+5 = 12；3448 → 3×4 = 4+8 = 12。                   */
/* 这类题按字符串处理，不参与大数运算；规律本身不唯一，需要选项才能定答案。*/
/* ------------------------------------------------------------------ */
interface Agg {
  id: string;
  label: string;
  sym: string;
  f: (ds: Frac[]) => Frac | null;
}

const AGGS: Agg[] = [
  { id: 'sum', label: '和', sym: '+', f: (ds) => ds.reduce((a, b) => F.add(a, b), ZERO) },
  { id: 'prod', label: '积', sym: '×', f: (ds) => ds.reduce((a, b) => F.mul(a, b), ONE) },
  { id: 'diff', label: '差', sym: '−', f: (ds) => (ds.length === 2 ? F.sub(ds[0], ds[1]) : null) },
  {
    id: 'absdiff',
    label: '绝对差',
    sym: '|−|',
    f: (ds) => (ds.length === 2 ? F.abs(F.sub(ds[0], ds[1])) : null),
  },
  {
    id: 'sqsum',
    label: '平方和',
    sym: '²+',
    f: (ds) => ds.reduce((a, b) => F.add(a, F.mul(b, b)), ZERO),
  },
];

const DIGIT_POS = ['a', 'b', 'c', 'd', 'e', 'f'];

/** 仅用于提示：判断一组「位数相同的多位数」是否存在数位等式规律 */
export function describeDigitRule(vals: Frac[]): string | null {
  if (vals.length < 4) return null;
  try {
    const fit = digitEqRec.match(vals.map((v) => KNOWN(v)));
    return fit ? fit.describe() : null;
  } catch {
    return null;
  }
}

function exprText(start: number, len: number, agg: Agg): string {
  const names = DIGIT_POS.slice(start, start + len);
  return names.join(agg.sym) + (agg.id === 'sqsum' ? '²' : '');
}

const digitEqRec: Recognizer = {
  id: 'digitEq',
  name: '数位等式',
  cost: 2.3,
  maxDepth: 0,
  match(seq) {
    const n = seq.length;
    if (n < 4 || n > 10) return null;
    if (!seq.every(T.isKnown)) return null;

    const dsList: Frac[][] = [];
    let width = -1;
    for (const t of seq) {
      if (!F.isInt(t.c) || t.c.n < 0n) return null;
      const str = t.c.n.toString();
      if (width === -1) width = str.length;
      else if (str.length !== width) return null;
      dsList.push([...str].map((ch) => fr(BigInt(ch))));
    }
    if (width < 3) return null;

    // 分组方案：连续二分 + 首尾一组
    const splits: { pick: (ds: Frac[]) => [Frac[], Frac[]] | null; label: string }[] = [];
    for (let p = 1; p < width; p++) {
      splits.push({
        label: `${p}-${width - p}`,
        pick: (ds) => [ds.slice(0, p), ds.slice(p)],
      });
    }
    if (width >= 4) {
      splits.push({
        label: '首尾-中',
        pick: (ds) => (ds.length >= 4 ? [[ds[0], ds[ds.length - 1]], ds.slice(1, -1)] : null),
      });
    }

    for (const sp of splits) {
      for (const fa of AGGS) {
        for (const fb of AGGS) {
          if (fa.id === fb.id && fa.id !== 'sum' && fa.id !== 'prod') continue;
          let ok = true;
          for (const ds of dsList) {
            const g = sp.pick(ds);
            if (!g) {
              ok = false;
              break;
            }
            const a = fa.f(g[0]);
            const b = fb.f(g[1]);
            if (!a || !b || !F.eq(a, b)) {
              ok = false;
              break;
            }
          }
          if (!ok) continue;
          // 两边都是"和"的约束最弱，加点成本
          const weak = fa.id === 'sum' && fb.id === 'sum';
          const left = sp.label === '首尾-中' ? `a${fa.sym}${DIGIT_POS[width - 1]}` : exprText(0, Number(sp.label.split('-')[0]), fa);
          const right =
            sp.label === '首尾-中'
              ? DIGIT_POS.slice(1, width - 1).join(fb.sym)
              : exprText(Number(sp.label.split('-')[0]), Number(sp.label.split('-')[1]), fb);
          return {
            rid: 'digitEq',
            name: '数位等式',
            complexity: (weak ? 2.9 : 2.2) + (width === 4 ? 0 : 0.2),
            at: (i) => (i >= 0 && i < n ? seq[i].c : null),
            describe: () => `各位数字满足 ${left} = ${right}`,
            openEnded: true,
          };
        }
      }
    }
    return null;
  },
};

/* ------------------------------------------------------------------ */
/* 15. 数位拆分：多位数按位拆列，各列分别成规律                          */
/* ------------------------------------------------------------------ */
const digitSplitRec: Recognizer = {
  id: 'digitSplit',
  name: '数位拆分',
  cost: 2.4,
  match(seq) {
    if (seq.length < 4 || !seq.every(T.isKnown)) return null;
    const vals = seq.map((t) => t.c);
    if (!vals.every((v) => F.isInt(v) && v.n > 0n && v.n < 100000n)) return null;
    const strs = vals.map((v) => v.n.toString());
    const len = strs[0].length;
    if (len < 2 || !strs.every((s) => s.length === len)) return null;
    // 至少一半以上的位要"有变化"，否则不如直接当整数看
    const cols: Frac[][] = [];
    for (let p = 0; p < len; p++) cols.push(strs.map((s) => fr(BigInt(s[p]))));
    const fits = cols.map((c) => simpleExtrap(c));
    if (fits.some((f) => !f)) return null;
    const varying = cols.filter((c) => c.some((v) => !F.eq(v, c[0]))).length;
    if (varying === 0) return null;

    return {
      rid: 'digitSplit',
      name: '数位拆分',
      complexity: 2.1 + 0.2 * len,
      at: (i) => {
        if (i < 0) return null;
        let total = ZERO;
        for (let p = 0; p < len; p++) {
          const v = fits[p]!(i);
          if (!v) return null;
          total = F.add(F.mul(total, fr(10)), v);
        }
        return total;
      },
      describe: () => `按位拆成 ${len} 列，每列各自成规律`,
    };
  },
};

/* ------------------------------------------------------------------ */
export const RECOGNIZERS: Recognizer[] = [
  constantRec,
  arithRec,
  geomRec,
  primeRec,
  polyRec,
  periodicRec,
  powerRec,
  affineRecRec,
  linRec2,
  linRec3,
  fracSplitRec,
  groupRec,
  pairChainRec,
  digitSplitRec,
  digitEqRec,
  factorRec,
  productRec,
  compositeRec,
  factorialRec,
];

export { PRIMES };
