'use strict';

const { parseSrt, buildSrt } = require('./srt');
const { formatMs } = require('./time');

/** 每次处理的字幕条数上限。 */
const MAX_ENTRIES = 24;
/** 可用轨号上限（轨号 1..MAX_TRACKS）。 */
const MAX_TRACKS = 4;

/** 左闭右开区间是否存在正长度交叠（端点相接不算交叠）。 */
function overlapsPositive(a, b) {
  return a.startMs < b.endMs && b.startMs < a.endMs;
}

/** 同一时刻最多同时进行的字幕条数（端点相接不计入同时）。 */
function maxOverlapDepth(entries) {
  const points = [];
  entries.forEach((e) => {
    points.push({ t: e.startMs, d: 1 });
    points.push({ t: e.endMs, d: -1 });
  });
  // 同一时刻先处理结束再处理开始：end == start 的两者不重叠
  points.sort((a, b) => (a.t - b.t) || (a.d - b.d));
  let cur = 0;
  let max = 0;
  points.forEach((p) => {
    cur += p.d;
    if (cur > max) max = cur;
  });
  return max;
}

/**
 * 可行性判定：把 entries（任意顺序）分配到 k 条轨，
 * 使同轨字幕两两无正长度交叠，且 locked.get(pos) 指定的轨号不变。
 * 返回 true/false。
 *
 * 做法：按（开始时间, 原位置）排序后做状态 DP。
 * 状态 = 各轨当前占用到的结束时间向量（按轨号索引，-1 表示空闲；
 * 锁定依赖具体轨号，故状态不按大小排序归并）。
 * 对区间调度而言该状态已足够：一条轨能否再用只取决于它上面最后一条字幕的结束时间。
 * 轨数 <= 4、条数 <= 24，状态数有限（<= (n+1)^k），属全局精确求解而非逐条贪心。
 */
function feasible(entries, k, locked) {
  const order = entries
    .slice()
    .sort((a, b) => (a.startMs - b.startMs) || (a.pos - b.pos));

  const FREE = -1;
  let states = new Set([new Array(k).fill(FREE).join(',')]);
  for (const e of order) {
    const lock = locked.has(e.pos) ? locked.get(e.pos) : 0;
    const next = new Set();
    for (const key of states) {
      const ends = key.split(',').map(Number);
      const tryTrack = (t) => {
        if (ends[t - 1] > e.startMs) return; // 该轨被占用到未来，不可接（端点相接可以）
        const ne = ends.slice();
        ne[t - 1] = e.endMs;
        next.add(ne.join(','));
      };
      if (lock) {
        if (lock <= k) tryTrack(lock);
      } else {
        for (let t = 1; t <= k; t++) tryTrack(t);
      }
    }
    states = next;
    if (states.size === 0) return false;
  }
  return states.size > 0;
}

/**
 * 全局求解分轨方案：
 *  1. 先求可行方案中的最小轨数 k（1..MAX_TRACKS 依次判定）；
 *  2. 在该 k 下，按原文件位置顺序逐条尝试最小可用轨号，
 *     每次用 feasibility DP 校验剩余部分仍可解，
 *     从而得到“按原位置排列的轨号向量”字典序最小的方案。
 * 全部可行则返回 { assignment }（assignment[i] = 位置 i 的轨号），否则返回 null。
 */
function solveSplit(entries, locked) {
  let kMin = 0;
  for (let k = 1; k <= MAX_TRACKS; k++) {
    if (feasible(entries, k, locked)) {
      kMin = k;
      break;
    }
  }
  if (!kMin) return null;

  const assignment = new Array(entries.length).fill(0);
  for (let i = 0; i < entries.length; i++) {
    const lock = locked.has(i) ? locked.get(i) : 0;
    if (lock) {
      assignment[i] = lock; // 锁定轨号不得改变
      continue;
    }
    for (let t = 1; t <= kMin; t++) {
      assignment[i] = t;
      const partial = new Map(locked);
      for (let j = 0; j <= i; j++) partial.set(j, assignment[j]);
      if (feasible(entries, kMin, partial)) break;
      assignment[i] = 0;
    }
    if (!assignment[i]) return null; // 与 kMin 可行性矛盾，不可达
  }
  return { assignment, trackCount: kMin };
}

/**
 * 分轨接口主入口：splitTracks(srtText, rawLocks)
 * srtText 为最近一次校正成功的主轨 SRT；rawLocks 形如 [{ position, track }]。
 * 返回：
 *  - { ok:false, parseErrors }  SRT 解析问题
 *  - { ok:false, splitErrors }  条数超限 / 非法锁定 / 非正时长 / 四轨内无解
 *  - { ok, stats, entries, tracks }  entries 按原位置排列；tracks 仅含非空轨
 */
function splitTracks(srtText, rawLocks) {
  if (typeof srtText !== 'string' || srtText.trim() === '') {
    return { ok: false, parseErrors: ['主轨 SRT 为空：请先完成时间校正'] };
  }
  const parsed = parseSrt(srtText);
  if (parsed.errors.length) return { ok: false, parseErrors: parsed.errors };
  if (!parsed.entries.length) return { ok: false, parseErrors: ['主轨未解析到任何字幕条目'] };

  const n = parsed.entries.length;
  const splitErrors = [];
  if (n > MAX_ENTRIES) {
    splitErrors.push(
      `字幕条数超出范围：共 ${n} 条，每次仅支持 1～${MAX_ENTRIES} 条，请分段处理`
    );
  }

  // 非正时长逐条定位
  parsed.entries.forEach((e, i) => {
    if (e.endMs <= e.startMs) {
      splitErrors.push(
        `第 ${i + 1} 条字幕（序号 ${e.index}）时长非正：` +
        `${formatMs(e.startMs)} --> ${formatMs(e.endMs)}`
      );
    }
  });

  // 锁定值校验：position 为 1..n 的整数，track 为 1..4 的整数，位置不得重复
  const locked = new Map();
  if (rawLocks !== undefined && rawLocks !== null) {
    if (!Array.isArray(rawLocks)) {
      splitErrors.push('锁定值格式无效：locks 应为数组，元素形如 { "position": 1, "track": 2 }');
    } else {
      rawLocks.forEach((l, i) => {
        const where = `locks[${i}]`;
        if (!l || typeof l !== 'object') {
          splitErrors.push(`${where}：锁定项格式无效（应为 { "position": 1, "track": 2 }）`);
          return;
        }
        const pos = l.position;
        const track = l.track;
        if (!Number.isInteger(pos) || pos < 1 || pos > n) {
          splitErrors.push(`${where}：锁定位置 ${JSON.stringify(pos)} 无效（应为 1～${n} 的整数）`);
          return;
        }
        if (!Number.isInteger(track) || track < 1 || track > MAX_TRACKS) {
          splitErrors.push(
            `${where}：锁定轨号 ${JSON.stringify(track)} 非法（应为 1～${MAX_TRACKS} 的整数）`
          );
          return;
        }
        if (locked.has(pos - 1)) {
          splitErrors.push(`${where}：第 ${pos} 条字幕被重复锁定`);
          return;
        }
        locked.set(pos - 1, track);
      });
    }
  }
  if (splitErrors.length) return { ok: false, splitErrors };

  const entries = parsed.entries.map((e, i) => ({
    pos: i,
    index: e.index,
    startMs: e.startMs,
    endMs: e.endMs,
    text: e.text,
  }));

  // 锁定到同一轨且时间正交叠：直接定位冲突，必无解
  const lockConflictErrors = [];
  for (let i = 0; i < n; i++) {
    if (!locked.has(i)) continue;
    for (let j = i + 1; j < n; j++) {
      if (locked.get(j) !== locked.get(i)) continue;
      if (overlapsPositive(entries[i], entries[j])) {
        lockConflictErrors.push(
          `锁定冲突：第 ${i + 1} 条与第 ${j + 1} 条均锁定到 ${locked.get(i)} 号轨，` +
          `但时间区间交叠（${formatMs(entries[i].startMs)} --> ${formatMs(entries[i].endMs)} 与 ` +
          `${formatMs(entries[j].startMs)} --> ${formatMs(entries[j].endMs)}）`
        );
      }
    }
  }
  if (lockConflictErrors.length) return { ok: false, splitErrors: lockConflictErrors };

  const solved = solveSplit(entries, locked);
  if (!solved) {
    const depth = maxOverlapDepth(entries);
    const hint =
      depth > MAX_TRACKS
        ? `有 ${depth} 条字幕在同一时刻相互交叠，${MAX_TRACKS} 条轨无法容纳`
        : '锁定约束与时间交叠叠加后，四条轨无法容纳全部字幕';
    return {
      ok: false,
      splitErrors: [`无可行分轨：${hint}；请调整锁定或减少同时交叠的字幕`],
    };
  }

  const { assignment, trackCount } = solved;

  // 组装各轨：轨内按（开始时间, 原位置）排序并从 1 重新编号，时间与正文保持不变
  const tracks = [];
  for (let t = 1; t <= trackCount; t++) {
    const members = entries
      .filter((e) => assignment[e.pos] === t)
      .sort((a, b) => (a.startMs - b.startMs) || (a.pos - b.pos));
    if (!members.length) continue;
    tracks.push({
      track: t,
      count: members.length,
      srt: buildSrt(
        members.map((e, i) => ({ index: i + 1, startMs: e.startMs, endMs: e.endMs, text: e.text }))
      ),
    });
  }

  return {
    ok: true,
    stats: {
      entries: n,
      tracks: trackCount,
      locked: locked.size,
    },
    entries: entries.map((e) => ({
      position: e.pos + 1,
      index: e.index,
      start: formatMs(e.startMs),
      end: formatMs(e.endMs),
      text: e.text.join('\n'),
      locked: locked.has(e.pos) ? locked.get(e.pos) : null,
      track: assignment[e.pos],
    })),
    tracks,
  };
}

module.exports = { splitTracks, solveSplit, feasible, maxOverlapDepth, MAX_ENTRIES, MAX_TRACKS };
