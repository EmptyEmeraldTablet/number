import { solve, formatDecimal, simplifyRad } from '../src/core/search';

function show(sol: any): string {
  if (!sol) return '(空)';
  return sol.answer
    .map((a: any) => {
      if (sol.sqrtOnly) {
        const n = Number(a.n) / Number(a.d);
        if (Number.isInteger(n) && n > 0) {
          const { coef, rad } = simplifyRad(n);
          if (rad === 1) return String(coef);
          return coef === 1 ? `√${rad}` : `${coef}√${rad}`;
        }
      }
      if (sol.radical && sol.radical > 1) {
        const c = a.d === 1n ? a.n.toString() : `${a.n}/${a.d}`;
        if (a.n === 1n && a.d === 1n) return `√${sol.radical}`;
        if (a.n === -1n && a.d === 1n) return `-√${sol.radical}`;
        return `${c}√${sol.radical}`;
      }
      if (sol.decimals !== undefined) return formatDecimal(a, sol.decimals);
      return a.d === 1n ? a.n.toString() : `${a.n}/${a.d}`;
    })
    .join(', ');
}

const CASES: [string, string, string?][] = [
  // 根式
  ['√2, √8, √18, √32, ?', '5√2'],
  ['√3, 2√3, 3√3, 4√3, ?', '5√3'],
  ['√2, 2√2, 3√2, ?', '4√2'],
  ['2√5, 4√5, 6√5, 8√5, ?', '10√5'],
  ['√2, √5, √8, √11, ?', '?'],
  // 小数
  ['1.1, 2.2, 4.4, 7.7, ?', '11.11'],
  ['1.5, 2.6, 3.7, 4.8, ?', '5.9'],
  ['0.1, 0.2, 0.4, 0.8, ?', '1.6'],
  ['2.1, 3.2, 5.4, 8.7, ?', '12.11'],
  ['0.2, 0.5, 0.8, 1.1, ?', '1.4'],
  // 数位等式（靠选项筛选，规律本身不唯一）
  ['2675, 3448, 3699, 4226, 5378, ?', '7268', '5645, 6541, 6652, 7268'],

  // 因子分解
  ['1, 18, 75, 245, 567, 1331, ?', '2197'],
  ['1, 8, 27, 80, 175, ?', '396'],
  ['2, 12, 36, 80, 150, ?', '252'],

  // 数位拆分
  ['12, 23, 34, 45, ?', '56'],
  ['123, 234, 345, ?', '456'],
  ['11, 24, 39, 416, ?', '?'],
  ['21, 32, 43, 54, ?', '65'],
];

let pass = 0;
for (const [inp, exp, opts] of CASES) {
  const t0 = Date.now();
  const r = solve(inp, opts ?? '', 2);
  const got = show(r.solutions[0]);
  const ok = got === exp;
  if (ok) pass++;
  console.log(`${ok ? '✓' : '✗'} ${inp.padEnd(30)} → ${got.padEnd(10)} ${exp === '?' ? '(仅观察)' : '期望 ' + exp}  ${Date.now() - t0}ms  ${r.solutions[0]?.patternName ?? ''}`);
}
console.log(`\n通过 ${pass}/${CASES.filter(c => c[1] !== '?').length}`);
