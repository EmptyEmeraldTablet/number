import React, { useState } from 'react';
import {
  HistoryItem,
  stats,
  toJson,
  toTestCases,
  download,
  stamp,
} from './core/history';
import { getSolverMeta } from './core/search';

const BADGE: Record<HistoryItem['verdict'], { mark: string; label: string }> = {
  correct: { mark: '✓', label: '答对' },
  wrong: { mark: '✗', label: '答错' },
  unsolved: { mark: '?', label: '未解' },
  pending: { mark: '·', label: '待核对' },
};

interface Props {
  items: HistoryItem[];
  onLabel: (id: string, actual: string) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onReplay: (item: HistoryItem) => void;
}

export default function History({ items, onLabel, onRemove, onClear, onReplay }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const s = stats(items);
  const meta = getSolverMeta();

  const startEdit = (it: HistoryItem) => {
    setEditing(it.id);
    setDraft(it.actual);
  };

  const commit = () => {
    if (editing) onLabel(editing, draft.trim());
    setEditing(null);
  };

  return (
    <section className="panel hist">
      <div className="hist-head">
        <h2>
          历史记录
          <span className="sub">
            共 {s.total} · 首选命中 {s.topHit}
            {s.correct > s.topHit && ` · 位置靠后 ${s.correct - s.topHit}`} · 答错 {s.wrong} · 未解{' '}
            {s.unsolved}
          </span>
        </h2>
        <div className="hist-actions">
          <button
            className="mini"
            disabled={!items.length}
            onClick={() => download(`gwy-num-history-${stamp()}.json`, toJson(items))}
            title="导出完整记录（JSON）"
          >
            导出 JSON
          </button>
          <button
            className="mini"
            disabled={!items.length}
            onClick={() => download(`gwy-num-cases-${stamp()}.ts`, toTestCases(items))}
            title="导出可直接粘进测试集的待修复用例"
          >
            导出用例
          </button>
          <button className="mini danger" disabled={!items.length} onClick={onClear}>
            清空
          </button>
        </div>
      </div>

      <p className="hist-note">
        求解器 v{meta.version} · {meta.recognizers} 条规则 / {meta.ops} 个算子。
        给失败或答错的题填上正确答案，就能一键导出成回归用例。
      </p>

      {items.length === 0 ? (
        <p className="hint">还没有记录。每次求解都会自动存一条。</p>
      ) : (
        <div className="hist-list">
          {items.map((it) => (
            <div className={`hrow ${it.verdict}`} key={it.id}>
              <span
                className={`hbadge ${it.verdict}`}
                title={
                  it.verdict === 'correct' && it.hitRank
                    ? `答对，但排在第 ${it.hitRank + 1} 位`
                    : BADGE[it.verdict].label
                }
              >
                {it.verdict === 'correct' ? `✓${it.hitRank ? it.hitRank + 1 : ''}` : BADGE[it.verdict].mark}
              </span>
              <button className="hinput" onClick={() => onReplay(it)} title="点击重新求解">
                {it.input}
              </button>
              <span className="hcand" title="求解器给出的首选答案">
                {it.candidates[0]?.value ?? '—'}
              </span>
              {editing === it.id ? (
                <input
                  className="hact-input"
                  autoFocus
                  value={draft}
                  placeholder="正确答案"
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commit();
                    if (e.key === 'Escape') setEditing(null);
                  }}
                />
              ) : (
                <button
                  className={`hact-btn ${it.actual ? 'filled' : ''}`}
                  onClick={() => startEdit(it)}
                  title="标注正确答案"
                >
                  {it.actual || '标注答案'}
                </button>
              )}
              <span className="hmeta">
                {new Date(it.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                <em>{it.depth}级</em>
              </span>
              <button className="hdel" onClick={() => onRemove(it.id)} title="删除这条">
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
