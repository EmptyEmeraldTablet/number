import React, { useEffect, useMemo, useState } from 'react';
import { solve, SolveResult, Solution, formatDecimal, simplifyRad } from './core/search';
import History from './History';
import {
  HistoryItem,
  loadHistory,
  saveHistory,
  makeItem,
  upsert,
  judgeAnswer,
} from './core/history';
import { Frac } from './core/fraction';

const EXAMPLES: { label: string; input: string; opts?: string }[] = [
  { label: '一级等差', input: '1, 6, 11, 16, 21, ?' },
  { label: '二级差分', input: '12, 13, 15, 18, 22, ?' },
  { label: '差为质数', input: '-3, -1, 2, 7, 14, ?' },
  { label: '幂次修正', input: '2, 5, 10, 17, 26, ?' },
  { label: '交叉数列', input: '2, -5, 8, -11, 14, -17, 20, ?' },
  { label: '两两分组', input: '10, 3, 13, 1, 14, 2, 16, 9, ?' },
  { label: '中间挖空', input: '1, 3, 5, ?, 9, 11', opts: '6, 7, 8, 10' },
  { label: '分数数列', input: '1/2, 2/3, 3/4, 4/5, ?' },
  { label: '双空递推', input: '1, 1, 2, 3, 5, ?, ?' },
  { label: '三阶递推', input: '1, 2, 3, 6, 11, 20, ?' },
  { label: '根式数列', input: '√2, √8, √18, √32, ?' },
  { label: '小数分列', input: '2.1, 3.2, 5.4, 8.7, ?' },
  { label: '数位拆分', input: '123, 234, 345, ?' },
  { label: '因子分解', input: '1, 18, 75, 245, 567, 1331, ?' },
];

/** 0 = 未覆盖, 1 = 已覆盖, 2 = 部分覆盖 */
const COVERAGE: { group: string; items: [string, 0 | 1 | 2][] }[] = [
  {
    group: '基础数列',
    items: [
      ['常数', 1],
      ['等差', 1],
      ['等比', 1],
      ['质数 / 合数', 1],
      ['周期循环', 1],
      ['平方、立方', 1],
      ['简单递推和差积商', 1],
    ],
  },
  {
    group: '多级数列',
    items: [
      ['一级差分', 1],
      ['二 / 三级差分', 1],
      ['做和', 1],
      ['做商', 1],
      ['做积', 1],
      ['差分后接质数 / 等比 / 递推', 1],
      ['累加（前缀和）', 1],
      ['隔项相减等复合变换', 1],
    ],
  },
  {
    group: '幂次数列',
    items: [
      ['n²、n³、n⁴', 1],
      ['aⁿ（2ⁿ、3ⁿ）', 1],
      ['幂次 ± 常数修正', 1],
      ['底数、指数各自成列', 2],
      ['幂次 ± 等差修正', 0],
    ],
  },
  {
    group: '分数数列',
    items: [
      ['分子分母各自成列', 1],
      ['分子分母整体做商 / 做积', 1],
      ['反约分 / 广义通分', 2],
      ['负幂次转换', 1],
      ['带分数', 2],
    ],
  },
  {
    group: '递推数列',
    items: [
      ['和 / 差 / 积 / 商递推', 1],
      ['倍数递推（×k ± b）', 1],
      ['一、二、三阶线性递推', 1],
      ['隔项递推', 1],
      ['四项及以上递推', 0],
    ],
  },
  {
    group: '多重数列',
    items: [
      ['交叉（奇偶位）', 1],
      ['两两分组', 1],
      ['三三分组', 1],
      ['数位和 / 数位倒序 / 去个位', 1],
      ['多位数按位拆分', 1],
      ['数位等式（a×b = c+d 这类）', 1],
      ['小数：整数 / 小数部分分列', 1],
    ],
  },
  {
    group: '特殊题型',
    items: [
      ['因式分解（双因子各自成规律）', 1],
      ['阶乘', 1],
      ['根式数列（a·√b 与 √n 两种口径）', 1],
      ['对数数列', 0],
      ['图形数阵（圆 / 三角 / 九宫格）', 0],
    ],
  },
];

const MARK = ['✗', '✓', '◐'];

function disp(f: Frac): string {
  return f.d === 1n ? f.n.toString() : `${f.n}/${f.d}`;
}

function formatOne(a: Frac, sol: Solution): string {
  if (sol.sqrtOnly) {
    const n = Number(a.n) / Number(a.d);
    if (Number.isInteger(n) && n > 0) {
      const { coef, rad } = simplifyRad(n);
      if (rad === 1) return String(coef);
      return coef === 1 ? `√${rad}` : `${coef}√${rad}`;
    }
  }
  if (sol.radical && sol.radical > 1) {
    if (a.n === 1n && a.d === 1n) return `√${sol.radical}`;
    if (a.n === -1n && a.d === 1n) return `-√${sol.radical}`;
    const c = a.d === 1n ? a.n.toString() : `${a.n}/${a.d}`;
    return `${c}√${sol.radical}`;
  }
  if (sol.decimals !== undefined) return formatDecimal(a, sol.decimals);
  return a.d === 1n ? a.n.toString() : `${a.n}/${a.d}`;
}

function formatAnswer(sol: Solution): string {
  return sol.answer.map((a) => formatOne(a, sol)).join('、');
}

/** 统一输入格式：全角转半角、逗号规范化、去掉多余空格 */
function normalizeInput(s: string): string {
  return s
    .replace(/[，、;；]/g, ',')
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/．/g, '.')
    .replace(/－/g, '-')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .replace(/[,\s]+$/, '')
    .trim();
}

const KEYS: [string, string, 'num' | 'sym' | 'fn'][] = [
  ['7', '7', 'num'],
  ['8', '8', 'num'],
  ['9', '9', 'num'],
  ['⌫', 'back', 'fn'],
  ['4', '4', 'num'],
  ['5', '5', 'num'],
  ['6', '6', 'num'],
  ['/', '/', 'sym'],
  ['1', '1', 'num'],
  ['2', '2', 'num'],
  ['3', '3', 'num'],
  ['√', 'sqrt', 'sym'],
  ['0', '0', 'num'],
  ['.', '.', 'sym'],
  ['−', 'neg', 'sym'],
  ['?', 'hole', 'fn'],
  [',', 'sep', 'sym'],
  ['(', '(', 'sym'],
  [')', ')', 'sym'],
  ['清空', 'clear', 'fn'],
];

function Keypad({ onKey }: { onKey: (k: string) => void }) {
  return (
    <div className="keypad">
      {KEYS.map(([label, k, cls]) => (
        <button key={k} className={`key ${cls}`} onClick={() => onKey(k)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function TermChip({ text, kind }: { text: string; kind?: 'hole' | 'out' | 'plain' }) {
  return <span className={`term ${kind ?? ''}`}>{text}</span>;
}

function SeqRow({ items, holeAt }: { items: string[]; holeAt?: number[] }) {
  return (
    <div className="seq">
      {items.map((t, i) => (
        <TermChip
          key={i}
          text={t}
          kind={holeAt?.includes(i) ? 'hole' : t.includes('x') ? 'out' : 'plain'}
        />
      ))}
    </div>
  );
}

export default function App() {
  const [input, setInput] = useState('12, 13, 15, 18, 22, ?');
  const [optText, setOptText] = useState('');
  const [depth, setDepth] = useState(2);
  const [result, setResult] = useState<SolveResult | null>(null);
  const [ms, setMs] = useState(0);
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [showCoverage, setShowCoverage] = useState(false);
  const [showKeypad, setShowKeypad] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>(() => loadHistory());

  const run = (text?: string, opts?: string, d?: number) => {
    const s = text ?? input;
    const o = opts ?? optText;
    const dd = d ?? depth;
    setBusy(true);
    setTimeout(() => {
      const t0 = performance.now();
      let r: SolveResult;
      try {
        r = solve(s, o, dd);
      } catch (e) {
        r = {
          parse: {
            values: [],
            items: [],
            holes: [],
            tokens: [],
            hasRadical: false,
            decimals: null,
            error: (e as Error).message,
          },
          solutions: [],
          nodes: 0,
          truncated: false,
        };
      }
      const cost = Math.round(performance.now() - t0);
      setMs(cost);
      setResult(r);
      setSel(0);
      setBusy(false);
      setHistory((prev) =>
        upsert(
          prev,
          makeItem({
            input: normalizeInput(s),
            options: o.trim(),
            depth: dd,
            candidates: r.solutions.map((x) => ({
              value: formatAnswer(x),
              pattern: x.patternName,
              score: x.score,
            })),
            ms: cost,
            nodes: r.nodes,
          }),
        ),
      );
    }, 16);
  };

  const applyKey = (k: string) => {
    setInput((prev) => {
      const endsSep = prev === '' || /[,\s]$/.test(prev);
      switch (k) {
        case 'back': {
          const t = prev.trimEnd();
          const i = Math.max(t.lastIndexOf(','), t.lastIndexOf(' '));
          return (i >= 0 ? t.slice(0, i) : '').replace(/[,\s]+$/, '');
        }
        case 'clear':
          return '';
        case 'sep':
          return endsSep ? prev : prev + ', ';
        case '.':
          if (/\?\s*$/.test(prev)) return prev.replace(/\?\s*$/, '') + '.';
          return endsSep ? prev : prev + '.';
        case '/':
          return endsSep ? prev : prev + '/';
        case 'hole':
          return endsSep ? prev + '?' : prev + ' ?';
        case 'sqrt':
          return endsSep ? prev + '√' : prev + ' √';
        case 'neg':
          if (endsSep) return prev + '-';
          return /[\/(]$/.test(prev) ? prev + '-' : prev;
        case '(':
        case ')':
          return prev + k;
        default:
          // 末尾是 ? 时，用输入的数字替换掉它
          if (/\?\s*$/.test(prev)) return prev.replace(/\?\s*$/, '') + k;
          return prev + k;
      }
    });
  };

  useEffect(() => {
    saveHistory(history);
  }, [history]);

  const labelItem = (id: string, actual: string) => {
    setHistory((prev) =>
      prev.map((it) =>
        it.id === id ? { ...it, actual, ...judgeAnswer(actual, it.candidates) } : it,
      ),
    );
  };

  const removeItem = (id: string) => setHistory((prev) => prev.filter((it) => it.id !== id));

  const clearHistory = () => {
    if (confirm('确定清空全部历史记录？此操作不可撤销。')) setHistory([]);
  };

  const replay = (it: HistoryItem) => {
    setInput(it.input);
    setOptText(it.options);
    setDepth(it.depth);
    run(it.input, it.options, it.depth);
  };

  useEffect(() => {
    run('12, 13, 15, 18, 22, ?');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tokens = result?.parse.tokens ?? [];
  const holes = result?.parse.holes ?? [];
  const solutions = result?.solutions ?? [];
  const sol: Solution | undefined = solutions[sel];

  const answerText = sol ? formatAnswer(sol) : '';

  return (
    <div className="app">
      <header className="hero">
        <div className="hero-left">
          <h1>数列推理求解器</h1>
          <p>
            枚举「算子链 × 基础模式」的全部组合，用规律复杂度排序，给出可解释的候选答案。
          </p>
        </div>
        <div className="hero-badge">
          <span>数字推理</span>
          <strong>行测</strong>
        </div>
      </header>

      <section className="panel">
        <div className="field">
          <label>数列　用 <code>?</code> 标出空缺，支持分数（1/2）、负数</label>
          <div className="input-row">
            <input
              className="seq-input"
              value={input}
              spellCheck={false}
              onChange={(e) => setInput(e.target.value)}
              onBlur={() => setInput((v) => normalizeInput(v))}
              onKeyDown={(e) => e.key === 'Enter' && run(normalizeInput(input))}
              placeholder="例如 1, 6, 11, 16, 21, ?  或  √2, √8, √18, ?"
            />
            <button
              className={`kbd-toggle ${showKeypad ? 'on' : ''}`}
              onClick={() => setShowKeypad((v) => !v)}
              title="数字键盘"
            >
              ⌨
            </button>
            <button className="primary" onClick={() => run(normalizeInput(input))} disabled={busy}>
              {busy ? '求解中' : '求 解'}
            </button>
          </div>
        </div>

        {showKeypad && (
          <div className="kbd-row">
            <Keypad onKey={applyKey} />
            <div className="kbd-tips">
              <div className="kbd-tips-title">输入规则</div>
              <p><b>√</b> 开方，如 √2、√8</p>
              <p><b>/</b> 分数，如 1/2、3/4</p>
              <p><b>.</b> 小数，如 1.5</p>
              <p><b>?</b> 待填空缺</p>
              <p><b>,</b> 分隔下一项</p>
            </div>
          </div>
        )}

        {tokens.length > 0 && !result?.parse.error && (
          <div className="preview">
            <SeqRow items={tokens} holeAt={holes} />
          </div>
        )}

        <div className="grid2">
          <div className="field">
            <label>选项（可选，逗号分隔）</label>
            <input
              value={optText}
              spellCheck={false}
              onChange={(e) => setOptText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && run()}
              placeholder="26, 28, 30, 34"
            />
          </div>
          <div className="field">
            <label>搜索深度</label>
            <div className="seg">
              {[1, 2, 3].map((d) => (
                <button
                  key={d}
                  className={depth === d ? 'on' : ''}
                  onClick={() => {
                    setDepth(d);
                    run(undefined, undefined, d);
                  }}
                >
                  {d} 级
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="examples">
          {EXAMPLES.map((e) => (
            <button
              key={e.label}
              className="chip"
              onClick={() => {
                setInput(e.input);
                setOptText(e.opts ?? '');
                run(e.input, e.opts ?? '', depth);
              }}
            >
              {e.label}
            </button>
          ))}
        </div>
      </section>

      {result?.parse.error && <div className="panel error">{result.parse.error}</div>}

      {result?.digitHint && (
        <div className="panel warn">
          <strong>可能不是一个普通数列</strong>
          <p>
            这些数存在数位规律：{result.digitHint}。这类题按字符串处理，满足条件的答案不唯一，
            下方结果多半是巧合拟合，建议补充选项后再求解。
          </p>
        </div>
      )}

      {sol && (
        <>
          <section className="panel answer">
            <div className="answer-head">
              <span className="answer-label">答案</span>
              <span className="answer-value">{answerText}</span>
              <span className="answer-meta">
                {sol.patternName} · {ms < 1 ? '<1' : ms}ms · {result?.nodes.toLocaleString()} 状态
              </span>
            </div>
            <p className="answer-desc">{sol.patternDesc}</p>
            {result?.note && <p className="answer-note">{result.note}</p>}
          </section>

          {sol.lines && sol.lines.length > 0 && (
            <section className="panel">
              <h2>因式拆解</h2>
              <div className="factor-lines">
                {sol.lines.map((l, i) => (
                  <div className={`fline ${i === sol.lines!.length - 1 ? 'last' : ''}`} key={i}>
                    {l}
                  </div>
                ))}
              </div>
            </section>
          )}

          {sol.path.length > 0 && (
          <section className="panel">
            <h2>推导过程</h2>
            {(
              <div className="steps">
                {sol.path.map((st, i) => (
                  <div className="step" key={i}>
                    <div className="step-head">
                      <span className="step-no">{i + 1}</span>
                      <span className="step-name">{st.name}</span>
                    </div>
                    <div className="step-body">
                      <SeqRow items={st.before} />
                      <div className="step-arrow">↓</div>
                      <SeqRow items={st.after} />
                    </div>
                  </div>
                ))}
                <div className="final-rule">
                  <span className="tick">✓</span>
                  在第 {sol.path.length} 层得到：{sol.patternDesc}
                </div>
              </div>
            )}
          </section>
          )}

          {solutions.length > 1 && (
            <section className="panel">
              <h2>
                其他候选 <span className="sub">共 {solutions.length} 条</span>
              </h2>
              <div className="cands">
                {solutions.map((s, i) => (
                  <button
                    key={i}
                    className={`cand ${i === sel ? 'active' : ''}`}
                    onClick={() => setSel(i)}
                  >
                    <span className="cand-rank">#{i + 1}</span>
                    <span className="cand-val">{formatAnswer(s)}</span>
                    <span className="cand-pat">{s.patternName}</span>
                    <span className="cand-score">复杂度 {s.score.toFixed(2)}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {result && !result.parse.error && solutions.length === 0 && (
        <div className="panel empty">
          <strong>没能找到符合的规律</strong>
          <p>{result.note ?? '可以尝试加大搜索深度，或补充选项帮助定位。'}</p>
        </div>
      )}

      {showHistory && (
        <History
          items={history}
          onLabel={labelItem}
          onRemove={removeItem}
          onClear={clearHistory}
          onReplay={replay}
        />
      )}

      <footer className="foot">
        <div className="foot-links">
          <button className="link" onClick={() => setShowHistory((v) => !v)}>
            历史记录{history.length ? ` (${history.length})` : ''}
          </button>
          <span className="sep">·</span>
          <button className="link" onClick={() => setShowCoverage((v) => !v)}>
            {showCoverage ? '收起规律清单' : '规律覆盖清单'}
          </button>
        </div>
        <span>
          引擎覆盖：做差 / 做和 / 做商 / 做积 / 累加 · 交叉 / 分组 / 数位 · 幂次 / 质数 / 周期 ·
          递推（1~3 阶）
        </span>
      </footer>

      {showCoverage && (
        <section className="panel">
          <h2>
            规律覆盖清单 <span className="sub">✓ 已支持 · ◐ 部分支持 · ✗ 未支持</span>
          </h2>
          <div className="coverage">
            {COVERAGE.map((g) => (
              <div className="cov-group" key={g.group}>
                <div className="cov-title">{g.group}</div>
                {g.items.map(([name, lv]) => (
                  <div className={`cov-item lv${lv}`} key={name}>
                    <span className="cov-mark">{MARK[lv]}</span>
                    <span>{name}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
