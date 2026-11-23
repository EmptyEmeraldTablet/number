import { solve } from '../src/core/search';
import { fracToString } from '../src/core/fraction';

interface Case {
  name: string;
  input: string;
  expect: string;
  opts?: string;
  /** 标记为「目前不支持的题型」，只记录不计数 */
  known?: boolean;
}

const CASES: Case[] = [
  // ── 基础 / 多级差分 ──
  { name: '一级等差', input: '1, 6, 11, 16, 21, ?', expect: '26' },
  { name: '二级等差', input: '12, 13, 15, 18, 22, ?', expect: '27' },
  { name: '三级等差', input: '1, 2, 4, 7, 11, 16, ?', expect: '22' },
  { name: '差为质数', input: '-3, -1, 2, 7, 14, ?', expect: '25' },
  { name: '差为等比', input: '7, 23, 47, 83, 137, ?', expect: '218' },
  { name: '差为2的幂', input: '4, 5, 7, 11, 19, ?', expect: '35' },
  { name: '差1..5', input: '3, 4, 6, 9, 13, ?', expect: '18' },
  { name: '差为偶数', input: '2, 4, 8, 14, 22, ?', expect: '32' },
  { name: '差9', input: '19, 28, 37, 46, ?', expect: '55' },
  { name: '递增差', input: '20, 22, 25, 30, 37, ?', expect: '48' },
  { name: '差为合数', input: '4, 6, 10, 16, 24, ?', expect: '34' },

  // ── 等比 / 做商 ──
  { name: '等比', input: '3, 6, 12, 24, 48, ?', expect: '96' },
  { name: '等比1.5', input: '16, 24, 36, 54, ?', expect: '81' },
  { name: '商为等差', input: '1, 2, 6, 24, 120, ?', expect: '720' },
  { name: '商为质数', input: '2, 4, 12, 60, 420, ?', expect: '4620' },

  // ── 幂次 ──
  { name: '平方数', input: '1, 4, 9, 16, 25, ?', expect: '36' },
  { name: '立方数', input: '1, 8, 27, 64, 125, ?', expect: '216' },
  { name: 'n²+1', input: '2, 5, 10, 17, 26, ?', expect: '37' },
  { name: '2ⁿ−1', input: '3, 7, 15, 31, 63, ?', expect: '127' },
  { name: '2n²', input: '2, 8, 18, 32, ?', expect: '50' },
  { name: '奇数平方', input: '1, 9, 25, 49, ?', expect: '81' },
  { name: '平方减1', input: '0, 3, 8, 15, 24, ?', expect: '35' },

  // ── 递推 ──
  { name: '斐波那契', input: '1, 1, 2, 3, 5, ?, ?', expect: '8, 13' },
  { name: '递推和', input: '3, 8, 11, 19, 30, 49, ?', expect: '79' },
  { name: '倍加', input: '2, 7, 22, 67, 202, ?', expect: '607' },
  { name: '×3+1', input: '1, 4, 13, 40, 121, ?', expect: '364' },
  { name: '×2−1', input: '2, 3, 5, 9, 17, ?', expect: '33' },
  { name: '×3−1', input: '1, 2, 5, 14, 41, ?', expect: '122' },
  { name: '×2+1', input: '5, 11, 23, 47, ?', expect: '95' },
  { name: '前三项和', input: '1, 2, 3, 6, 11, 20, ?', expect: '37' },

  // ── 质数 / 合数 ──
  { name: '质数', input: '2, 3, 5, 7, 11, ?', expect: '13' },
  { name: '质数中段', input: '13, 17, 19, 23, ?', expect: '29' },

  // ── 分数 ──
  { name: '分子分母同步', input: '1/2, 2/3, 3/4, 4/5, ?', expect: '5/6' },
  { name: '单位分数', input: '1/2, 1/3, 1/4, 1/5, ?', expect: '1/6' },
  { name: '等比分数', input: '2/3, 4/9, 8/27, ?', expect: '16/81' },
  { name: '分子奇数分母幂', input: '1/2, 3/4, 5/8, 7/16, ?', expect: '9/32' },
  { name: '分母等差分子常数', input: '1/2, 1/4, 1/6, 1/8, ?', expect: '1/10' },

  // ── 交叉 / 多重 ──
  { name: '交叉正负', input: '2, -5, 8, -11, 14, -17, 20, ?', expect: '-23' },
  { name: '交叉两列', input: '1, 2, 2, 4, 3, 6, ?', expect: '4' },
  { name: '交叉2', input: '1, 4, 3, 8, 5, 12, ?', expect: '7' },

  // ── 分组 ──
  { name: '两两分组', input: '10, 3, 13, 1, 14, 2, 16, 9, ?', expect: '25' },
  { name: '三三分组', input: '1, 2, 3, 4, 5, 9, 6, 7, ?', expect: '13' },
  { name: '两两倍数', input: '1, 3, 2, 6, 3, 9, ?', expect: '4' },

  // ── 周期 ──
  { name: '周期2', input: '1, 5, 1, 5, 1, ?', expect: '5' },
  { name: '周期3', input: '1, 2, 3, 1, 2, 3, 1, ?', expect: '2' },

  // ── 因式分解 / 阶乘 ──
  { name: '因式分解', input: '2, 6, 12, 20, 30, ?', expect: '42' },
  { name: '阶乘', input: '1, 2, 6, 24, 120, ?', expect: '720' },

  // ── 中间挖空 ──
  { name: '中间-等差', input: '1, 3, 5, ?, 9, 11', expect: '7' },
  { name: '中间-二级差', input: '4, 6, ?, 13, 18', expect: '9' },
  { name: '中间-等比', input: '3, 6, ?, 24, 48', expect: '12' },
  { name: '中间-递推', input: '2, 3, 5, ?, 13, 21', expect: '8' },
  { name: '中间-平方', input: '1, 4, ?, 16, 25', expect: '9' },

  // ── 真题风格补充 ──
  { name: '差为平方数', input: '1, 2, 6, 15, 31, ?', expect: '56' },
  { name: '差为奇数列', input: '1, 2, 5, 10, 17, ?', expect: '26' },
  { name: '2ⁿ−1长', input: '1, 3, 7, 15, 31, ?', expect: '63' },
  { name: '3a−b递推', input: '1, 4, 11, 29, 76, ?', expect: '199' },
  { name: '×2−1长', input: '3, 5, 9, 17, 33, ?', expect: '65' },

  // ── 选项模式 ──
  { name: '选项-等差', input: '1, 3, 5, ?, 9, 11', expect: '7', opts: '6, 7, 8, 10' },
  { name: '选项-干扰大', input: '2, 6, 12, 20, ?, 42', expect: '30', opts: '26, 28, 30, 34' },
  { name: '选项-分数', input: '1/2, 2/3, 3/4, ?, 5/6', expect: '4/5', opts: '4/5, 5/7, 3/5, 2/3' },
];

let pass = 0;
let skip = 0;
const fails: string[] = [];
const t0 = Date.now();
let slowest = { name: '', ms: 0 };

for (const c of CASES) {
  const s0 = Date.now();
  const r = solve(c.input, c.opts ?? '');
  const dt = Date.now() - s0;
  if (dt > slowest.ms) slowest = { name: c.name, ms: dt };
  const top = r.solutions[0];
  const got = top ? top.answer.map(fracToString).join(', ') : '(空)';
  if (c.known) {
    skip++;
    continue;
  }
  const ok = got === c.expect;
  if (ok) pass++;
  else
    fails.push(
      `  ✗ ${c.name.padEnd(14)} 期望 ${c.expect.padEnd(9)} 得到 ${got.padEnd(9)} [${top?.patternName ?? '-'}]  ${c.input}`,
    );
  if (process.env.VERBOSE) {
    console.log(`${ok ? '✓' : '✗'} ${c.name.padEnd(16)} → ${got.padEnd(10)} ${dt}ms  ${top?.patternName ?? ''}`);
  }
}

const ms = Date.now() - t0;
const total = CASES.length - skip;
console.log(
  `\n通过 ${pass}/${total}  (${((pass / total) * 100).toFixed(1)}%)  总耗时 ${ms}ms  最慢 ${slowest.name} ${slowest.ms}ms`,
);
if (fails.length) {
  console.log('\n失败用例：');
  fails.forEach((f) => console.log(f));
}
