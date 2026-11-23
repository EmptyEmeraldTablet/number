import { makeItem, upsert, judgeAnswer, toJson, toTestCases, stats } from '../src/core/history';

const cands = [
  { value: '26', pattern: '等差', score: 1 },
  { value: '28', pattern: '质数', score: 3 },
];

let pass = 0;
let fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else {
    fail++;
    console.log(`✗ ${name}\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`);
  }
}

check('命中候选', judgeAnswer('26', cands), { verdict: 'correct', hitRank: 0 });
check('未命中', judgeAnswer('27', cands), { verdict: 'wrong', hitRank: null });
check('空答案有候选', judgeAnswer('', cands), { verdict: 'pending', hitRank: null });
check('空答案无候选', judgeAnswer('', []), { verdict: 'unsolved', hitRank: null });
check(
  '多答案分隔符',
  judgeAnswer('8， 13', [{ value: '8、13', pattern: '二阶递推', score: 2 }]),
  { verdict: 'correct', hitRank: 0 },
);

// upsert 去重 + 保留标注
const a = makeItem({ input: '1, 2, 3, ?', options: '', depth: 2, candidates: [{ value: '4', pattern: '等差', score: 1 }], ms: 5, nodes: 10 });
const b = makeItem({ input: '1, 2, 3, ?', options: '', depth: 2, candidates: [{ value: '4', pattern: '等差', score: 1 }], ms: 9, nodes: 12 });
let list = upsert([a], b);
check('同题去重', list.length, 1);
check('保留最新', list[0].ms, 9);

list = [{ ...list[0], actual: '4', verdict: 'correct', hitRank: 0 }];
const c = makeItem({ input: '1, 2, 3, ?', options: '', depth: 2, candidates: [{ value: '4', pattern: '等差', score: 1 }], ms: 11, nodes: 14 });
list = upsert(list, c);
check('重复求解保留旧标注', list[0].actual, '4');
check('重复求解重新判定', list[0].verdict, 'correct');

// 统计
const wrongOne = makeItem({ input: '1, 18, 75, ?', options: '', depth: 2, candidates: [{ value: '1918', pattern: '二阶递推', score: 4 }], ms: 70, nodes: 900 });
wrongOne.actual = '2197';
wrongOne.verdict = 'wrong';
const unsolvedOne = makeItem({ input: '9, 8, 7, ?', options: '', depth: 2, candidates: [], ms: 3, nodes: 5 });
unsolvedOne.actual = '5, 4';
unsolvedOne.verdict = 'unsolved';
const all = [list[0], wrongOne, unsolvedOne];
check('统计', stats(all), { total: 3, correct: 1, topHit: 1, wrong: 1, unsolved: 1, labeled: 3 });

// 导出
const json = JSON.parse(toJson(all));
check('JSON 版本', json.solverVersion, '0.3.0');
check('JSON 用例数', json.cases.length, 3);

const ts = toTestCases(all);
check('用例只含失败', ts.includes('待修复-1') && ts.includes('待修复-2') && !ts.includes('待修复-3'), true);
check('用例格式正确', ts.includes("input: '1, 18, 75, ?', expect: '2197'"), true);
check('多答案被规范化', ts.includes("expect: '5, 4'"), true);

console.log(`\n通过 ${pass}/${pass + fail}`);
