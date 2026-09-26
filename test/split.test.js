'use strict';

const assert = require('assert');
const { splitTracks, solveSplit, feasible, maxOverlapDepth } = require('../lib/split');

function srtBlock(n, start, end, text) {
  return [String(n), start + ' --> ' + end, text || '字幕' + n].join('\n');
}

function makeSrt(parts) {
  return parts.map((p) => srtBlock(p[0], p[1], p[2], p[3])).join('\n\n') + '\n';
}

// ---------- 基础：三条同时交叠 → 必须 3 轨，字典序最小 ----------
{
  const srt = makeSrt([
    [1, '00:00:00,000', '00:00:05,000'],
    [2, '00:00:01,000', '00:00:04,000'],
    [3, '00:00:02,000', '00:00:03,000'],
  ]);
  const r = splitTracks(srt, []);
  assert.strictEqual(r.ok, true, JSON.stringify(r.splitErrors));
  assert.strictEqual(r.stats.tracks, 3);
  assert.deepStrictEqual(r.entries.map((e) => e.track), [1, 2, 3], '无锁定时按位置字典序最小');
  assert.deepStrictEqual(r.entries.map((e) => e.locked), [null, null, null]);
  assert.strictEqual(r.tracks.length, 3);
  assert.deepStrictEqual(r.tracks.map((t) => t.count), [1, 1, 1]);
}

// ---------- 端点相接可共轨；时间顺序倒置也可以（只看区间） ----------
{
  const srt = makeSrt([
    [1, '00:00:00,000', '00:00:05,000'],
    [2, '00:00:05,000', '00:00:10,000'],
    [3, '00:00:10,000', '00:00:15,000'],
  ]);
  const r = splitTracks(srt, []);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.stats.tracks, 1, '首尾相接只需 1 轨');
  assert.deepStrictEqual(r.entries.map((e) => e.track), [1, 1, 1]);
  assert.strictEqual(r.tracks.length, 1);
}

// ---------- 锁定轨号不得改变 ----------
{
  const srt = makeSrt([
    [1, '00:00:00,000', '00:00:05,000'],
    [2, '00:00:01,000', '00:00:04,000'],
  ]);
  const r = splitTracks(srt, [{ position: 1, track: 3 }]);
  assert.strictEqual(r.ok, true, JSON.stringify(r.splitErrors));
  assert.strictEqual(r.stats.tracks, 3, '锁到 3 号轨使最大轨号至少为 3');
  assert.strictEqual(r.entries[0].track, 3, '锁定轨号不得改变');
  assert.strictEqual(r.entries[0].locked, 3);
  assert.strictEqual(r.entries[1].locked, null);
  assert.strictEqual(r.entries[1].track, 1, '其余自动分配到更小的空轨');
  // 1、2 号轨非空（2 号轨？）——只有两条：锁 3 + 自动 1，2 号轨为空不输出
  assert.deepStrictEqual(r.tracks.map((t) => t.track), [1, 3], '仅输出非空轨');
}

// ---------- 锁定改变其余条目的自动分配 ----------
{
  // A=[0,6) B=[2,8) C=[5,10)：三者两两交叠（A∩C 为 [5,6)），必为 3 轨。
  const srt = makeSrt([
    [1, '00:00:00,000', '00:00:06,000'],
    [2, '00:00:02,000', '00:00:08,000'],
    [3, '00:00:05,000', '00:00:10,000'],
  ]);
  const r = splitTracks(srt, []);
  assert.deepStrictEqual(r.entries.map((e) => e.track), [1, 2, 3]);
  // 锁住第 2 条到 3 号轨 → 第 3 条取 2 号轨
  const r2 = splitTracks(srt, [{ position: 2, track: 3 }]);
  assert.strictEqual(r2.ok, true);
  assert.deepStrictEqual(r2.entries.map((e) => e.track), [1, 3, 2]);
}

// ---------- 端点相接可共轨（非团时字典序最小取 1） ----------
{
  // A=[0,6) B=[2,8) C=[6,10)：C 与 A 端点相接可共轨，与 B 交叠。
  const srt = makeSrt([
    [1, '00:00:00,000', '00:00:06,000'],
    [2, '00:00:02,000', '00:00:08,000'],
    [3, '00:00:06,000', '00:00:10,000'],
  ]);
  const r = splitTracks(srt, []);
  assert.deepStrictEqual(r.entries.map((e) => e.track), [1, 2, 1]);
}

// ---------- 全局求解：按位置贪心会误报无解，全局解存在（k=2 陷阱） ----------
{
  // 文件顺序（与起点顺序不同），秒：
  // 1: [12,13) 锁 1    2: [0,1)    3: [8,13)
  // 4: [16,25)         5: [0,1) 锁 1    6: [4,9)
  // 按文件顺序贪心：条目 2 被放上 1 号轨 → 条目 5（锁 1）无法落轨，误判 2 轨无解；
  // 全局可行：T1=[12,13),[16,25),[0,1)锁,[4,9)；T2=[0,1),[8,13)。
  const srt = makeSrt([
    [1, '00:00:12,000', '00:00:13,000'],
    [2, '00:00:00,000', '00:00:01,000'],
    [3, '00:00:08,000', '00:00:13,000'],
    [4, '00:00:16,000', '00:00:25,000'],
    [5, '00:00:00,000', '00:00:01,000'],
    [6, '00:00:04,000', '00:00:09,000'],
  ]);
  const r = splitTracks(srt, [
    { position: 1, track: 1 },
    { position: 5, track: 1 },
  ]);
  assert.strictEqual(r.ok, true, '全局求解应找到 2 轨方案，错误：' + JSON.stringify(r.splitErrors));
  assert.strictEqual(r.stats.tracks, 2);
  assert.deepStrictEqual(r.entries.map((e) => e.track), [1, 2, 2, 1, 1, 1]);
}

// ---------- 全局求解：k=3 陷阱（贪心需 4 轨，全局最优 3 轨） ----------
{
  // 秒：1:[4,13)  2:[12,17)  3:[16,17)  4:[12,13)锁1  5:[4,9)  6:[4,5)  7:[16,25)锁1
  // 按文件顺序贪心：条目 1 占 1 号轨 → 条目 4（锁 1）无法落轨，3 轨内误判无解；
  // 全局 3 轨：T1=[12,13)锁,[4,9),[16,25)锁；T2=[4,13),[16,17)；T3=[12,17),[4,5)。
  const srt = makeSrt([
    [1, '00:00:04,000', '00:00:13,000'],
    [2, '00:00:12,000', '00:00:17,000'],
    [3, '00:00:16,000', '00:00:17,000'],
    [4, '00:00:12,000', '00:00:13,000'],
    [5, '00:00:04,000', '00:00:09,000'],
    [6, '00:00:04,000', '00:00:05,000'],
    [7, '00:00:16,000', '00:00:25,000'],
  ]);
  const r = splitTracks(srt, [
    { position: 4, track: 1 },
    { position: 7, track: 1 },
  ]);
  assert.strictEqual(r.ok, true, JSON.stringify(r.splitErrors));
  assert.strictEqual(r.stats.tracks, 3, '全局最小最大轨号应为 3 而非贪心的 4');
  assert.deepStrictEqual(r.entries.map((e) => e.track), [2, 3, 2, 1, 1, 3, 1]);
  // 验证同轨无正长度交叠
  for (let t = 1; t <= r.stats.tracks; t++) {
    const mem = r.entries.filter((e) => e.track === t);
    for (let a = 0; a < mem.length; a++) {
      for (let b = a + 1; b < mem.length; b++) {
        assert.ok(!(mem[a].start < mem[b].end && mem[b].start < mem[a].end),
          '同轨存在正长度交叠：' + JSON.stringify([mem[a], mem[b]]));
      }
    }
  }
}

// ---------- 四轨内无解：5 条同时交叠 ----------
{
  const parts = [];
  for (let i = 1; i <= 5; i++) {
    parts.push([i, '00:00:01,000', '00:00:02,000']);
  }
  const r = splitTracks(makeSrt(parts), []);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.tracks, undefined, '无解时不生成任何下载');
  assert.ok(r.splitErrors[0].includes('无可行分轨'), JSON.stringify(r.splitErrors));
  assert.ok(r.splitErrors[0].includes('5 条'), '应说明交叠深度：' + r.splitErrors[0]);
}

// ---------- 锁定冲突（同轨交叠）直接定位 ----------
{
  const srt = makeSrt([
    [1, '00:00:00,000', '00:00:05,000'],
    [2, '00:00:01,000', '00:00:04,000'],
  ]);
  const r = splitTracks(srt, [
    { position: 1, track: 2 },
    { position: 2, track: 2 },
  ]);
  assert.strictEqual(r.ok, false);
  assert.ok(r.splitErrors[0].includes('锁定冲突'), JSON.stringify(r.splitErrors));
  assert.ok(r.splitErrors[0].includes('第 1 条') && r.splitErrors[0].includes('第 2 条'));
  assert.strictEqual(r.tracks, undefined);
}

// ---------- 锁定使 4 轨无解（虽深度仅 3） ----------
{
  // 三条同时交叠，分别锁到 4 个不同轨没问题；这里构造：4 条深度 4，
  // 其中第 4 条被锁到与第 1 条同轨且交叠 → 冲突定位优先
  const srt = makeSrt([
    [1, '00:00:00,000', '00:00:09,000'],
    [2, '00:00:01,000', '00:00:08,000'],
    [3, '00:00:02,000', '00:00:07,000'],
    [4, '00:00:03,000', '00:00:06,000'],
    [5, '00:00:05,000', '00:00:10,000'],
  ]);
  // 深度：t=5..6 时 5 条同时在场（前 4 条 + 第 5 条）→ 5 > 4 无解
  const r = splitTracks(srt, []);
  assert.strictEqual(r.ok, false);
  assert.ok(r.splitErrors[0].includes('无可行分轨'));
}

// ---------- 条数超出 24 ----------
{
  const parts = [];
  for (let i = 1; i <= 25; i++) parts.push([i, `00:00:${String(i).padStart(2, '0')},000`, `00:00:${String(i).padStart(2, '0')},500`]);
  const r = splitTracks(makeSrt(parts), []);
  assert.strictEqual(r.ok, false);
  assert.ok(r.splitErrors[0].includes('25') && r.splitErrors[0].includes('1～24'));
  assert.strictEqual(r.tracks, undefined);
}

// ---------- 空 / 1 条边界 ----------
{
  const one = srtBlock(1, '00:00:01,000', '00:00:02,000', '唯一一条');
  const r = splitTracks(one, []);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.stats.entries, 1);
  assert.strictEqual(r.stats.tracks, 1);
  assert.strictEqual(r.entries[0].track, 1);
  assert.strictEqual(r.entries[0].position, 1);
  assert.ok(splitTracks('', []).parseErrors);
}

// ---------- 非法锁定值定位 ----------
{
  const srt = makeSrt([
    [1, '00:00:00,000', '00:00:05,000'],
    [2, '00:00:06,000', '00:00:08,000'],
  ]);
  // 轨号越界
  let r = splitTracks(srt, [{ position: 1, track: 5 }]);
  assert.ok(r.splitErrors[0].includes('锁定轨号 5 非法'));
  r = splitTracks(srt, [{ position: 1, track: 0 }]);
  assert.ok(r.splitErrors[0].includes('锁定轨号 0 非法'));
  r = splitTracks(srt, [{ position: 1, track: 2.5 }]);
  assert.ok(r.splitErrors[0].includes('锁定轨号 2.5 非法'));
  // 位置越界
  r = splitTracks(srt, [{ position: 3, track: 1 }]);
  assert.ok(r.splitErrors[0].includes('锁定位置 3 无效'));
  r = splitTracks(srt, [{ position: 0, track: 1 }]);
  assert.ok(r.splitErrors[0].includes('锁定位置 0 无效'));
  // 重复锁定
  r = splitTracks(srt, [
    { position: 1, track: 1 },
    { position: 1, track: 2 },
  ]);
  assert.ok(r.splitErrors[0].includes('第 1 条字幕被重复锁定'));
  // locks 非数组
  r = splitTracks(srt, {});
  assert.ok(r.splitErrors[0].includes('locks 应为数组'));
}

// ---------- 非正时长定位 ----------
{
  const srt = [
    srtBlock(1, '00:00:00,000', '00:00:05,000'),
    srtBlock(2, '00:00:06,000', '00:00:06,000', '零时长'),
    srtBlock(3, '00:00:08,000', '00:00:07,000', '负时长'),
  ].join('\n\n') + '\n';
  const r = splitTracks(srt, []);
  assert.strictEqual(r.ok, false);
  assert.ok(r.splitErrors.some((e) => e.includes('第 2 条') && e.includes('时长非正')));
  assert.ok(r.splitErrors.some((e) => e.includes('第 3 条') && e.includes('时长非正')));
}

// ---------- SRT 解析错误 ----------
{
  const r = splitTracks('1\n没有时间行\n', []);
  assert.strictEqual(r.ok, false);
  assert.ok(r.parseErrors.length > 0);
}

// ---------- 每条必须且只能出现一次（总数守恒） ----------
{
  const srt = makeSrt([
    [1, '00:00:00,000', '00:00:09,000'],
    [2, '00:00:01,000', '00:00:02,000'],
    [3, '00:00:01,500', '00:00:08,000'],
    [4, '00:00:03,000', '00:00:04,000'],
    [5, '00:00:03,500', '00:00:07,000'],
  ]);
  const r = splitTracks(srt, [{ position: 1, track: 4 }, { position: 3, track: 2 }]);
  assert.strictEqual(r.ok, true, JSON.stringify(r.splitErrors));
  const total = r.tracks.reduce((s, t) => s + t.count, 0);
  assert.strictEqual(total, 5, '全部字幕必须出现一次');
  assert.deepStrictEqual(r.entries.map((e) => e.position), [1, 2, 3, 4, 5]);
  assert.strictEqual(r.stats.locked, 2);
  assert.strictEqual(r.entries[0].track, 4);
  assert.strictEqual(r.entries[2].track, 2);
}

// ---------- 轨内排序与重新编号；时间与多行正文不变 ----------
{
  // 文件顺序故意打乱起点顺序（parseSrt 保留文件顺序）
  const srt = [
    '1', '00:00:10,000 --> 00:00:12,000', '晚的字幕',
    '',
    '2', '00:00:01,000 --> 00:00:03,000', '早的字幕', '第二行',
    '',
    '3', '00:00:02,000 --> 00:00:04,000', '交叠字幕',
  ].join('\n');
  const r = splitTracks(srt, []);
  assert.strictEqual(r.ok, true, JSON.stringify(r.splitErrors));
  // 第 1 条与第 3 条不与 2 在不同轨：2=[1,3),3=[2,4) 交叠 → 不同轨；1 与二者都不交叠 → 1 号轨
  // 字典序：pos1(=文件条目1,[10,12)) → 1 号轨；pos2 → 1 号轨（不与 1 交叠）；
  // 等等 pos2 [1,3) 与 pos1 [10,12) 不交叠 → 同 1 号轨；pos3 [2,4) 与 pos2 交叠 → 2 号轨
  assert.deepStrictEqual(r.entries.map((e) => e.track), [1, 1, 2]);
  const track1 = r.tracks.find((t) => t.track === 1);
  // 轨内按起点排序：[1,3) 在前并重新编号为 1；[10,12) 编号 2
  assert.ok(track1.srt.startsWith('1\n00:00:01,000 --> 00:00:03,000\n早的字幕\n第二行\n\n2\n00:00:10,000 --> 00:00:12,000\n晚的字幕\n'));
  // 时间与多行正文原样保留
  assert.ok(track1.srt.includes('00:00:01,000 --> 00:00:03,000'));
  assert.ok(track1.srt.includes('早的字幕\n第二行'));
}

// ---------- maxOverlapDepth：端点相接不叠加 ----------
{
  const E = (s, e) => ({ startMs: s, endMs: e });
  assert.strictEqual(maxOverlapDepth([E(0, 5), E(5, 10)]), 1);
  assert.strictEqual(maxOverlapDepth([E(0, 5), E(4, 10), E(5, 6)]), 2);
  assert.strictEqual(maxOverlapDepth([E(0, 10), E(1, 9), E(2, 8), E(3, 7)]), 4);
}

// ---------- feasible 直接调用：锁定冲突不可行 ----------
{
  const E = (pos, s, e) => ({ pos, startMs: s, endMs: e });
  const list = [E(0, 0, 5), E(1, 1, 4)];
  const locked = new Map([[0, 1], [1, 1]]);
  assert.strictEqual(feasible(list, 4, locked), false);
  assert.strictEqual(feasible(list, 4, new Map([[0, 1], [1, 2]])), true);
}

// ---------- feasible：状态必须保留轨号身份（不能按结束时间排序归并） ----------
{
  // A[0,10)锁1  B[0,5)锁2  C[5,8)锁2（2 号轨端点相接，可接）  D[10,20)锁1（1 号轨端点相接，可接）
  // 真实 2 轨可行；若状态把结束时间排序归并，会把轨号身份对调而误判为不可行。
  const E = (pos, s, e) => ({ pos, startMs: s, endMs: e });
  const list = [E(0, 0, 10), E(1, 0, 5), E(2, 5, 8), E(3, 10, 20)];
  const locked = new Map([[0, 1], [1, 2], [2, 2], [3, 1]]);
  assert.strictEqual(feasible(list, 2, locked), true);
  assert.strictEqual(feasible(list, 1, locked), false);
}

// ---------- 与暴力枚举对照（小规模随机，检验最优轨数与同轨约束） ----------
{
  function brute(E, locks, k) {
    const asg = new Array(E.length).fill(0);
    locks.forEach((t, p) => { asg[p] = t; });
    if ([...locks.values()].some((t) => t > k)) return false; // 锁定轨号超出可用轨数
    function okSoFar(i) {
      for (let a = 0; a <= i; a++) {
        for (let b = a + 1; b <= i; b++) {
          if (asg[a] === asg[b] && E[a].startMs < E[b].endMs && E[b].startMs < E[a].endMs) return false;
        }
      }
      return true;
    }
    function go(i) {
      if (i === E.length) return true;
      if (asg[i]) return okSoFar(i) && go(i + 1);
      for (let t = 1; t <= k; t++) {
        asg[i] = t;
        if (okSoFar(i) && go(i + 1)) return true;
      }
      asg[i] = 0;
      return false;
    }
    return go(0);
  }

  let seed = 7;
  function rand(n) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  }

  for (let trial = 0; trial < 200; trial++) {
    const n = 1 + rand(8);
    const E = [];
    for (let i = 0; i < n; i++) {
      const s = rand(100);
      E.push({ pos: i, startMs: s, endMs: s + 1 + rand(40) });
    }
    const locks = new Map();
    if (rand(2) === 0) {
      const cnt = 1 + rand(Math.min(3, n));
      const used = new Set();
      for (let q = 0; q < cnt; q++) {
        const p = rand(n);
        if (used.has(p)) continue;
        used.add(p);
        locks.set(p, 1 + rand(4));
      }
    }
    let expect = 0;
    for (let k = 1; k <= 4; k++) {
      if (brute(E, locks, k)) { expect = k; break; }
    }
    const got = solveSplit(E, locks);
    if (expect === 0) {
      assert.strictEqual(got, null, `trial ${trial}：应为无解`);
    } else {
      assert.ok(got, `trial ${trial}：应有解`);
      assert.strictEqual(got.trackCount, expect, `trial ${trial}：最小轨数应为 ${expect}`);
      // 校验分配合法：锁定不变、同轨不交叠、全集覆盖
      got.assignment.forEach((t, p) => {
        assert.ok(t >= 1 && t <= expect);
        if (locks.has(p)) assert.strictEqual(t, locks.get(p), `trial ${trial}：锁定被改动`);
      });
      for (let a = 0; a < n; a++) {
        for (let b = a + 1; b < n; b++) {
          if (got.assignment[a] === got.assignment[b]) {
            assert.ok(!(E[a].startMs < E[b].endMs && E[b].startMs < E[a].endMs),
              `trial ${trial}：同轨交叠`);
          }
        }
      }
    }
  }
}

// ---------- 字典序最小：与按位置全排列暴力比较 ----------
{
  function bruteLex(E, locks, k) {
    const asg = new Array(E.length).fill(0);
    locks.forEach((t, p) => { asg[p] = t; });
    function valid() {
      for (let a = 0; a < E.length; a++) {
        for (let b = a + 1; b < E.length; b++) {
          if (asg[a] === asg[b] && E[a].startMs < E[b].endMs && E[b].startMs < E[a].endMs) return false;
        }
      }
      return true;
    }
    let best = null;
    function go(i) {
      if (i === E.length) {
        if (valid() && (!best || asg.join(',') < best.join(','))) best = asg.slice();
        return;
      }
      if (asg[i]) { go(i + 1); return; }
      for (let t = 1; t <= k; t++) {
        asg[i] = t;
        go(i + 1);
      }
      asg[i] = 0;
    }
    go(0);
    return best;
  }

  let seed = 99;
  function rand(n) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  }

  for (let trial = 0; trial < 100; trial++) {
    const n = 1 + rand(7);
    const E = [];
    for (let i = 0; i < n; i++) {
      const s = rand(60);
      E.push({ pos: i, startMs: s, endMs: s + 1 + rand(30) });
    }
    const locks = new Map();
    if (rand(3) === 0) locks.set(rand(n), 1 + rand(4));
    const got = solveSplit(E, locks);
    if (!got) continue;
    const want = bruteLex(E, locks, got.trackCount);
    assert.deepStrictEqual(got.assignment, want, `trial ${trial}：轨号向量应为字典序最小`);
  }
}

// ---------- 24 条上限性能：最坏场景快速返回 ----------
{
  const parts = [];
  for (let i = 1; i <= 24; i++) {
    parts.push([i, '00:00:01,000', '00:00:02,000']);
  }
  const started = Date.now();
  const r = splitTracks(makeSrt(parts), []);
  assert.strictEqual(r.ok, false);
  assert.ok(r.splitErrors[0].includes('无可行分轨'));
  assert.ok(Date.now() - started < 5000, '24 条无解判定应在 5s 内完成');
}

console.log('分轨模块测试通过 ✔');
