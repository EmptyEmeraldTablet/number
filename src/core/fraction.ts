/**
 * 有理数运算，全部基于 BigInt，保证行测数列（含分数、大数）的精确性。
 * 不接受浮点误差 —— 这是整套求解器可靠性的基础。
 */
export interface Frac {
  readonly n: bigint;
  readonly d: bigint;
}

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a || 1n;
}

export function fr(n: bigint | number, d: bigint | number = 1n): Frac {
  let nn = typeof n === 'bigint' ? n : BigInt(Math.trunc(n));
  let dd = typeof d === 'bigint' ? d : BigInt(Math.trunc(d));
  if (dd === 0n) throw new Error('division by zero');
  if (dd < 0n) {
    nn = -nn;
    dd = -dd;
  }
  const g = gcd(nn, dd);
  return { n: nn / g, d: dd / g };
}

export const ZERO = fr(0n);
export const ONE = fr(1n);

export const add = (a: Frac, b: Frac) => fr(a.n * b.d + b.n * a.d, a.d * b.d);
export const sub = (a: Frac, b: Frac) => fr(a.n * b.d - b.n * a.d, a.d * b.d);
export const mul = (a: Frac, b: Frac) => fr(a.n * b.n, a.d * b.d);
export const div = (a: Frac, b: Frac) => {
  if (b.n === 0n) throw new Error('division by zero');
  return fr(a.n * b.d, a.d * b.n);
};
export const neg = (a: Frac) => fr(-a.n, a.d);
export const inv = (a: Frac) => {
  if (a.n === 0n) throw new Error('division by zero');
  return fr(a.d, a.n);
};
export const abs = (a: Frac) => (a.n < 0n ? neg(a) : a);
export const isZero = (a: Frac) => a.n === 0n;
export const eq = (a: Frac, b: Frac) => a.n === b.n && a.d === b.d;
export const isInt = (a: Frac) => a.d === 1n;
export const sign = (a: Frac) => (a.n > 0n ? 1 : a.n < 0n ? -1 : 0);
export const cmp = (a: Frac, b: Frac) => sign(sub(a, b));

export const toNumber = (a: Frac) => Number(a.n) / Number(a.d);
export const fromNumber = (v: number): Frac => {
  if (Number.isInteger(v)) return fr(BigInt(v));
  // 通过十进制字符串精确还原
  const s = v.toString();
  if (s.includes('e') || s.includes('E')) return fr(BigInt(Math.round(v)));
  const [ip, fp = ''] = s.split('.');
  const den = 10n ** BigInt(fp.length);
  return fr(BigInt(ip + fp), den);
};

export function fracToString(a: Frac): string {
  if (a.d === 1n) return a.n.toString();
  const whole = a.n / a.d;
  const rem = a.n % a.d;
  if (whole === 0n) return `${rem}/${a.d}`;
  return `${whole}${rem < 0n ? '' : ' '}${rem < 0n ? -rem : rem}/${a.d}`;
}

/** 化简后的唯一字符串，用于状态去重。 */
export const keyOf = (a: Frac) => `${a.n}/${a.d}`;
