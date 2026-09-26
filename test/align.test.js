'use strict';

const assert = require('assert');
const { alignSrt, alignTracks, overlapMs, buildCsv } = require('../lib/align');

function entry(index, startMs, endMs, text) {
  return { index, startMs, endMs, text: Array.isArray(text) ? text : [text || ''] };
}

// ---------- overlapMs ----------
assert.strictEqual(overlapMs(entry(1, 0, 100), entry(1, 50, 150)), 50);
assert.strictEqual(overlapMs(entry(1, 0, 100), entry(1, 100, 200)), 0, '端点相接不算交叠');
assert.ok(overlapMs(entry(1, 0, 100), entry(1, 200, 300)) < 0);

// ---------- 基本配对 + 两侧未配对 ----------
{
  const P = [entry(1, 0, 100), entry(2, 200, 300)];
  const S = [entry(1, 50, 150), entry(2, 400, 500)];
  const r = alignTracks(P, S);
  assert.strictEqual(r.pairs.length, 1);
  assert.deepStrictEqual([r.pairs[0].primaryPos, r.pairs[0].secondaryPos], [0, 0]);
  assert.strictEqual(r.pairs[0].overlapMs, 50);
  assert.deepStrictEqual(r.unmatchedPrimary, [1]);
  assert.deepStrictEqual(r.unmatchedSecondary, [1]);
  assert.strictEqual(r.totalOverlapMs, 50);
}

// ---------- 顺序保持：交叉配对不被允许 ----------
{
  // P1=[0,200] P2=[300,500]；S1=[350,600] 只与 P2 交叠 150，S2=[100,400] 与 P1 交叠 100、与 P2 交叠 100
  // 交叉方案 P1-S2 + P2-S1（250）违反顺序，保序最优为 P2-S1（150）
  const P = [entry(1, 0, 200), entry(2, 300, 500)];
  const S = [entry(1, 350, 600), entry(2, 100, 400)];
  const r = alignTracks(P, S);
  assert.strictEqual(r.totalOverlapMs, 150);
  assert.deepStrictEqual(
    r.pairs.map((p) => [p.primaryPos, p.secondaryPos]),
    [[1, 0]]
  );
}

// ---------- 交叠总和最大（全局最优而非局部贪心） ----------
{
  // S1 与两条主轨各交叠 500；S2/S3 各只能贡献 60。
  // 全局最优为 P1-S1 + P2-S3 = 560，而非单对 500 或两小对 120。
  const P = [entry(1, 0, 500), entry(2, 600, 1100)];
  const S = [entry(1, 0, 1100), entry(2, 100, 160), entry(3, 700, 760)];
  const r = alignTracks(P, S);
  assert.strictEqual(r.totalOverlapMs, 560);
  assert.deepStrictEqual(
    r.pairs.map((p) => [p.primaryPos, p.secondaryPos]),
    [[0, 0], [1, 2]]
  );
}

// ---------- 平分（交叠相同）时取起点差总和较小 ----------
{
  const P = [entry(1, 1000, 1100)];
  const S = [entry(1, 1000, 1060), entry(2, 900, 1060)]; // 交叠均为 60，起点差 0 vs 100
  const r = alignTracks(P, S);
  assert.deepStrictEqual(
    r.pairs.map((p) => p.secondaryPos),
    [0],
    '交叠相同应选起点差更小的副轨 1'
  );
  assert.strictEqual(r.pairs[0].startDiffMs, 0);
}

// ---------- 仍平分：按序号靠前确定 ----------
{
  // 两条副轨完全相同：配对序号靠前者
  const r1 = alignTracks([entry(1, 0, 100)], [entry(1, 0, 100), entry(2, 0, 100)]);
  assert.deepStrictEqual(r1.pairs.map((p) => p.secondaryPos), [0]);
  assert.deepStrictEqual(r1.unmatchedSecondary, [1]);

  // 两条主轨完全相同：配对序号靠前者
  const r2 = alignTracks([entry(1, 0, 100), entry(2, 0, 100)], [entry(1, 0, 100)]);
  assert.deepStrictEqual(r2.pairs.map((p) => p.primaryPos), [0]);
  assert.deepStrictEqual(r2.unmatchedPrimary, [1]);
}

// ---------- 端点相接（交叠为 0）不配对 ----------
{
  const r = alignTracks([entry(1, 0, 100)], [entry(1, 100, 200)]);
  assert.strictEqual(r.pairs.length, 0);
  assert.deepStrictEqual(r.unmatchedPrimary, [0]);
  assert.deepStrictEqual(r.unmatchedSecondary, [0]);
}

// ---------- 与暴力枚举对照（随机小规模） ----------
{
  function bruteForceMaxOverlap(P, S) {
    const memo = new Map();
    function go(i, j) {
      if (i >= P.length || j >= S.length) return 0;
      const key = i * 100 + j;
      if (memo.has(key)) return memo.get(key);
      let best = Math.max(go(i + 1, j), go(i, j + 1));
      const ov = overlapMs(P[i], S[j]);
      if (ov > 0) best = Math.max(best, ov + go(i + 1, j + 1));
      memo.set(key, best);
      return best;
    }
    return go(0, 0);
  }

  let seed = 42;
  function rand(n) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  }

  for (let t = 0; t < 50; t++) {
    const m = 1 + rand(5);
    const n = 1 + rand(5);
    const P = [];
    const S = [];
    for (let i = 0; i < m; i++) {
      const s = rand(500);
      P.push(entry(i + 1, s, s + rand(300)));
    }
    for (let j = 0; j < n; j++) {
      const s = rand(500);
      S.push(entry(j + 1, s, s + rand(300)));
    }
    const r = alignTracks(P, S);
    assert.strictEqual(
      r.totalOverlapMs,
      bruteForceMaxOverlap(P, S),
      `第 ${t} 组随机用例交叠总和应达最优`
    );
    // 配对位置在两轨上均严格递增（保持顺序）
    for (let k = 1; k < r.pairs.length; k++) {
      assert.ok(r.pairs[k].primaryPos > r.pairs[k - 1].primaryPos);
      assert.ok(r.pairs[k].secondaryPos > r.pairs[k - 1].secondaryPos);
    }
    // 未配对 + 配对 = 全部条目
    assert.strictEqual(r.unmatchedPrimary.length + r.pairs.length, m);
    assert.strictEqual(r.unmatchedSecondary.length + r.pairs.length, n);
  }
}

// ---------- 条目过多时拒绝（保护内存） ----------
{
  const big = [];
  for (let i = 0; i < 7000; i++) big.push(entry(i + 1, i * 10, i * 10 + 5));
  assert.strictEqual(alignTracks(big, big), null, '7000×7000 超出上限应返回 null');
}

// ---------- alignSrt：副轨解析错误 ----------
{
  const good = '1\n00:00:01,000 --> 00:00:02,000\n你好\n';
  const bad = '1\n没有时间行\n';
  const r = alignSrt(good, bad);
  assert.strictEqual(r.ok, false);
  assert.ok(r.secondaryParseErrors && r.secondaryParseErrors.length > 0);
  assert.strictEqual(r.csv, undefined, '副轨无效时不应生成 CSV');
}

// ---------- alignSrt：主轨为空 / 副轨为空 ----------
{
  const good = '1\n00:00:01,000 --> 00:00:02,000\n你好\n';
  assert.ok(alignSrt('', good).primaryParseErrors);
  assert.ok(alignSrt(good, '').secondaryParseErrors);
  assert.ok(alignSrt(good, '   ').secondaryParseErrors);
}

// ---------- alignSrt：完整流程 + CSV 内容 ----------
{
  const primary = [
    '1',
    '00:00:02,000 --> 00:00:04,000',
    '你好',
    '',
    '2',
    '00:00:10,000 --> 00:00:12,000',
    '世界',
  ].join('\n');
  const secondary = [
    '1',
    '00:00:02,500 --> 00:00:03,500',
    'Hello',
    '',
    '2',
    '00:00:20,000 --> 00:00:21,000',
    'Unmatched line',
  ].join('\n');
  const r = alignSrt(primary, secondary);
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.stats.pairs, 1);
  assert.strictEqual(r.stats.unmatchedPrimary, 1);
  assert.strictEqual(r.stats.unmatchedSecondary, 1);
  assert.strictEqual(r.stats.totalOverlapMs, 1000);
  assert.strictEqual(r.pairs[0].primary.index, 1);
  assert.strictEqual(r.pairs[0].secondary.index, 1);
  assert.strictEqual(r.pairs[0].overlapMs, 1000);
  assert.strictEqual(r.unmatchedPrimary[0].index, 2);
  assert.strictEqual(r.unmatchedSecondary[0].index, 2);
  // CSV：含双方序号、时间、正文，带 BOM
  assert.strictEqual(r.csv.charCodeAt(0), 0xfeff);
  assert.ok(r.csv.includes('主轨序号') && r.csv.includes('副轨序号'));
  assert.ok(r.csv.includes('你好') && r.csv.includes('Hello'));
  assert.ok(r.csv.includes('00:00:02,000') && r.csv.includes('00:00:02,500'));
  assert.ok(r.csv.includes('主轨未配对') && r.csv.includes('副轨未配对'));
  assert.ok(r.csv.includes('世界') && r.csv.includes('Unmatched line'));
}

// ---------- CSV 转义：逗号、引号、换行 ----------
{
  const csv = buildCsv(
    [
      {
        primary: { index: 1, start: '00:00:01,000', end: '00:00:02,000', text: '他说 "你好"，然后\n走了' },
        secondary: { index: 1, start: '00:00:01,000', end: '00:00:02,000', text: 'He said "hi", then left' },
        overlapMs: 1000,
        startDiffMs: 0,
      },
    ],
    [],
    []
  );
  assert.ok(csv.includes('"他说 ""你好""，然后\n走了"'), '中文正文应正确转义');
  assert.ok(csv.includes('"He said ""hi"", then left"'), '英文正文应正确转义');
}

console.log('对齐模块测试通过 ✔');
