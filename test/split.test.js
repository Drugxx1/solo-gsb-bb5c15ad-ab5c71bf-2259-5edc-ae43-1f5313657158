'use strict';

const assert = require('assert');
const { splitTracks, solveAssignment, maxOverlapDepth } = require('../lib/split');

function makeSrt(blocks) {
  // blocks: [start, end, text]
  return (
    blocks
      .map((b, i) => `${i + 1}\n${b[0]} --> ${b[1]}\n${b[2] || '正文'}`)
      .join('\n\n') + '\n'
  );
}

// ---------- 全部不重叠：单轨，全部 1 号轨 ----------
{
  const r = splitTracks(makeSrt([
    ['00:00:01,000', '00:00:02,000', '甲'],
    ['00:00:03,000', '00:00:04,000', '乙'],
  ]));
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.trackCount, 1);
  assert.deepStrictEqual(r.entries.map((e) => e.track), [1, 1]);
  assert.strictEqual(r.tracks.length, 1);
  assert.strictEqual(r.tracks[0].track, 1);
  assert.strictEqual(r.tracks[0].count, 2);
}

// ---------- 端点相接（左闭右开）可共轨 ----------
{
  const r = splitTracks(makeSrt([
    ['00:00:01,000', '00:00:02,000', '甲'],
    ['00:00:02,000', '00:00:03,000', '乙'],
  ]));
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.trackCount, 1, '端点相接应可共轨');
  assert.deepStrictEqual(r.entries.map((e) => e.track), [1, 1]);
}

// ---------- 正长度交叠：两轨；字典序最小 ----------
{
  // A=[1,11] B=[6,16] C=[11,21]：A-C 端点相接可共轨
  // 可行向量有 (1,2,1) 与 (2,1,2)，字典序最小为 (1,2,1)
  const r = splitTracks(makeSrt([
    ['00:00:01,000', '00:00:11,000', 'A'],
    ['00:00:06,000', '00:00:16,000', 'B'],
    ['00:00:11,000', '00:00:21,000', 'C'],
  ]));
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.trackCount, 2);
  assert.deepStrictEqual(r.entries.map((e) => e.track), [1, 2, 1]);
}

// ---------- 全局求解：逐条贪心会多开一轨 ----------
{
  // 文件顺序 P,R,Q,X：P=[0,2] R=[10,12] Q=[9,11] X=[1,10]
  // 按文件顺序贪心（首适配）需要 3 轨；全局最优只需 2 轨，字典序最小向量为 (1,2,1,2)
  const r = splitTracks(makeSrt([
    ['00:00:00,000', '00:00:02,000', 'P'],
    ['00:00:10,000', '00:00:12,000', 'R'],
    ['00:00:09,000', '00:00:11,000', 'Q'],
    ['00:00:01,000', '00:00:10,000', 'X'],
  ]));
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.trackCount, 2, '须全局求解，不能像贪心一样开到 3 轨');
  assert.deepStrictEqual(r.entries.map((e) => e.track), [1, 2, 1, 2]);
}

// ---------- 锁定：轨号不变，且最小化最大轨号 ----------
{
  // 两条不重叠，第二条锁定 3 号轨 → 最大轨号至少为 3
  const r = splitTracks(
    makeSrt([
      ['00:00:01,000', '00:00:02,000', '甲'],
      ['00:00:03,000', '00:00:04,000', '乙'],
    ]),
    [0, 3]
  );
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.trackCount, 3);
  assert.deepStrictEqual(r.entries.map((e) => e.track), [1, 3]);
  assert.deepStrictEqual(r.entries.map((e) => e.lock), [0, 3]);
  // 非空轨只有 1、3 两轨可下载
  assert.deepStrictEqual(r.tracks.map((t) => t.track), [1, 3]);
}

// ---------- 锁定冲突：同轨锁定字幕交叠 → 无可行分轨 ----------
{
  const r = splitTracks(
    makeSrt([
      ['00:00:01,000', '00:00:05,000', '甲'],
      ['00:00:03,000', '00:00:06,000', '乙'],
    ]),
    [2, 2]
  );
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.infeasible, true);
  assert.ok(r.message.includes('无可行分轨') && r.message.includes('锁定'), r.message);
  assert.strictEqual(r.tracks, undefined, '无解时不得生成任何分轨下载');
  assert.strictEqual(r.entries, undefined);
}

// ---------- 五条同时交叠：超过 4 轨上限 → 无可行分轨 ----------
{
  const blocks = [];
  for (let i = 0; i < 5; i++) blocks.push(['00:00:01,000', '00:00:10,000', `第${i + 1}条`]);
  const r = splitTracks(makeSrt(blocks));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.infeasible, true);
  assert.ok(r.message.includes('无可行分轨') && r.message.includes('5'), r.message);
  assert.strictEqual(r.tracks, undefined);
}

// ---------- 条数范围：25 条超限 / 空内容 ----------
{
  const blocks = [];
  for (let i = 0; i < 25; i++) {
    blocks.push([`00:00:${String(i).padStart(2, '0')},000`, `00:00:${String(i).padStart(2, '0')},500`, 'x']);
  }
  const r = splitTracks(makeSrt(blocks));
  assert.strictEqual(r.ok, false);
  assert.ok(r.splitErrors && r.splitErrors.some((e) => e.includes('25') && e.includes('1～24')));
  assert.strictEqual(r.tracks, undefined);

  const empty = splitTracks('');
  assert.ok(empty.parseErrors && empty.parseErrors.length > 0);
}

// ---------- 非正时长：逐条定位 ----------
{
  const r = splitTracks(makeSrt([
    ['00:00:01,000', '00:00:02,000', '正常'],
    ['00:00:03,000', '00:00:03,000', '零时长'],
    ['00:00:06,000', '00:00:05,000', '倒置'],
  ]));
  assert.strictEqual(r.ok, false);
  assert.ok(r.splitErrors.some((e) => e.includes('第 2 条') && e.includes('时长非正')), JSON.stringify(r.splitErrors));
  assert.ok(r.splitErrors.some((e) => e.includes('第 3 条') && e.includes('时长非正')), JSON.stringify(r.splitErrors));
  assert.strictEqual(r.tracks, undefined);
}

// ---------- 非法锁定值：逐条定位 ----------
{
  const two = makeSrt([
    ['00:00:01,000', '00:00:02,000', '甲'],
    ['00:00:03,000', '00:00:04,000', '乙'],
  ]);
  // 超出 1～4
  let r = splitTracks(two, [1, 5]);
  assert.ok(r.splitErrors && r.splitErrors.some((e) => e.includes('第 2 条') && e.includes('锁定值无效')));
  // 非整数类型
  r = splitTracks(two, [1, '2']);
  assert.ok(r.splitErrors && r.splitErrors.some((e) => e.includes('第 2 条')));
  r = splitTracks(two, [1, 1.5]);
  assert.ok(r.splitErrors && r.splitErrors.some((e) => e.includes('第 2 条')));
  // 数量不一致
  r = splitTracks(two, [1]);
  assert.ok(r.splitErrors && r.splitErrors.some((e) => e.includes('不一致')));
  // 非数组
  r = splitTracks(two, 'x');
  assert.ok(r.splitErrors && r.splitErrors.some((e) => e.includes('锁定值格式无效')));
  // 0 / null 表示自动，合法
  r = splitTracks(two, [0, null]);
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  // 整体缺省 locks
  r = splitTracks(two);
  assert.strictEqual(r.ok, true, JSON.stringify(r));
}

// ---------- 轨内排序与编号：按（起点、原位置），从 1 编号，正文多行保持 ----------
{
  // 文件顺序与时间顺序不一致：先出现的字幕起点更晚
  const srt = [
    '7',
    '00:00:10,000 --> 00:00:12,000',
    '后出现的字幕',
    '',
    '3',
    '00:00:01,000 --> 00:00:03,000',
    '先出现的字幕',
    '第二行正文',
  ].join('\n');
  const r = splitTracks(srt);
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.trackCount, 1);
  assert.strictEqual(r.tracks.length, 1);
  const s = r.tracks[0].srt;
  // 轨内按起点排序并从 1 编号：01 秒的在前且编号为 1
  assert.ok(s.startsWith('1\n00:00:01,000 --> 00:00:03,000\n先出现的字幕\n第二行正文'), s);
  assert.ok(s.includes('2\n00:00:10,000 --> 00:00:12,000\n后出现的字幕'), s);
  // 页面条目保留原序号与原位置
  assert.strictEqual(r.entries[0].index, 7);
  assert.strictEqual(r.entries[0].pos, 1);
  assert.strictEqual(r.entries[1].index, 3);
  assert.strictEqual(r.entries[1].pos, 2);
}

// ---------- 每条字幕恰好出现一次 ----------
{
  const r = splitTracks(makeSrt([
    ['00:00:01,000', '00:00:05,000', 'A'],
    ['00:00:02,000', '00:00:03,000', 'B'],
    ['00:00:04,000', '00:00:06,000', 'C'],
    ['00:00:07,000', '00:00:08,000', 'D'],
  ]));
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  const total = r.tracks.reduce((sum, t) => sum + t.count, 0);
  assert.strictEqual(total, 4, '各轨条数之和应等于字幕总数（每条恰好一次）');
  assert.strictEqual(r.entries.length, 4);
  // 同轨无正长度交叠
  const byTrack = new Map();
  r.entries.forEach((e) => {
    if (!byTrack.has(e.track)) byTrack.set(e.track, []);
    byTrack.get(e.track).push(e);
  });
  const toMs = (s) => {
    const m = s.match(/(\d+):(\d+):(\d+),(\d+)/);
    return (+m[1]) * 3600000 + (+m[2]) * 60000 + (+m[3]) * 1000 + (+m[4]);
  };
  byTrack.forEach((list) => {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const ov = Math.min(toMs(list[i].end), toMs(list[j].end)) -
          Math.max(toMs(list[i].start), toMs(list[j].start));
        assert.ok(ov <= 0, `同轨字幕不得交叠：${list[i].start}~${list[i].end} 与 ${list[j].start}~${list[j].end}`);
      }
    }
  });
}

// ---------- 锁定到 4 号轨且四条同时交叠：恰好可行 ----------
{
  const r = splitTracks(
    makeSrt([
      ['00:00:01,000', '00:00:10,000', 'A'],
      ['00:00:02,000', '00:00:10,000', 'B'],
      ['00:00:03,000', '00:00:10,000', 'C'],
      ['00:00:04,000', '00:00:10,000', 'D'],
    ]),
    [0, 0, 0, 4]
  );
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.trackCount, 4);
  assert.strictEqual(r.entries[3].track, 4, '锁定轨号不得改变');
}

// ---------- maxOverlapDepth：端点相接不计 ----------
{
  const entries = [
    { startMs: 0, endMs: 100 },
    { startMs: 100, endMs: 200 },
    { startMs: 50, endMs: 150 },
  ];
  const d = maxOverlapDepth(entries);
  assert.strictEqual(d.depth, 2, '端点相接不应累加深度');
}

// ---------- solveAssignment：无可行解返回 null ----------
{
  const entries = [];
  for (let i = 0; i < 5; i++) entries.push({ startMs: 0, endMs: 1000 });
  assert.strictEqual(solveAssignment(entries, [0, 0, 0, 0, 0], 4), null, '5 条互叠 4 轨无解');
  assert.ok(solveAssignment(entries, [0, 0, 0, 0, 0], 5), '5 条互叠 5 轨有解');
}

console.log('分轨模块测试通过 ✔');
