'use strict';

const { parseSrt, buildSrt } = require('./srt');
const { formatMs } = require('./time');

/** 每次处理的字幕条数范围与可用轨数。 */
const MIN_ENTRIES = 1;
const MAX_ENTRIES = 24;
const MAX_TRACKS = 4;

/** 两条目左闭右开区间 [start, end) 的交叠毫秒数；<= 0 表示可共轨（端点相接不算交叠）。 */
function overlapMs(a, b) {
  return Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs);
}

/**
 * 最大同时交叠深度（左闭右开：同一时刻先结束再开始，端点相接不计入）。
 * 返回 { depth, pointMs, positions }：positions 为达到最大深度时覆盖该时刻的条目下标。
 */
function maxOverlapDepth(entries) {
  const events = [];
  entries.forEach((e) => {
    events.push({ t: e.startMs, d: 1 });
    events.push({ t: e.endMs, d: -1 });
  });
  events.sort((a, b) => (a.t - b.t) || (a.d - b.d)); // 同一时刻 -1 先于 +1
  let cur = 0;
  let depth = 0;
  let pointMs = 0;
  for (const ev of events) {
    cur += ev.d;
    if (cur > depth) {
      depth = cur;
      pointMs = ev.t;
    }
  }
  const positions = [];
  entries.forEach((e, i) => {
    if (e.startMs <= pointMs && pointMs < e.endMs) positions.push(i);
  });
  return { depth, pointMs, positions };
}

/**
 * 全局求解：把全部字幕分配到 1..k 号轨。
 * 约束：每条字幕恰好出现一次；同轨字幕左闭右开区间不得有正长度交叠；锁定轨号不变。
 * 按原文件位置顺序深度优先、轨号升序尝试，第一个完整解即
 * “按原文件位置排列的轨号向量”字典序最小者（非逐条贪心）；无可行解返回 null。
 */
function solveAssignment(entries, locks, k) {
  const n = entries.length;
  // 冲突位掩码：同轨不得有正长度交叠（n <= 24，可用 32 位位掩码）
  const conflict = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (overlapMs(entries[i], entries[j]) > 0) {
        conflict[i] |= 1 << j;
        conflict[j] |= 1 << i;
      }
    }
  }

  const used = new Array(k + 1).fill(0); // used[t]：t 号轨已占字幕的位掩码
  const assign = new Array(n).fill(0);

  // 前向检查：每条未分配字幕至少还有一条可去的轨
  function forwardOk(from) {
    for (let j = from; j < n; j++) {
      const lj = locks[j];
      if (lj > 0) {
        if (lj > k || (conflict[j] & used[lj]) !== 0) return false;
        continue;
      }
      let ok = false;
      for (let t = 1; t <= k; t++) {
        if ((conflict[j] & used[t]) === 0) { ok = true; break; }
      }
      if (!ok) return false;
    }
    return true;
  }

  function dfs(i) {
    if (i === n) return true;
    const bit = 1 << i;
    const lock = locks[i];
    if (lock > 0) {
      if (lock <= k && (conflict[i] & used[lock]) === 0) {
        assign[i] = lock;
        used[lock] |= bit;
        if (forwardOk(i + 1) && dfs(i + 1)) return true;
        used[lock] &= ~bit;
      }
      return false;
    }
    for (let t = 1; t <= k; t++) {
      if ((conflict[i] & used[t]) === 0) {
        assign[i] = t;
        used[t] |= bit;
        if (forwardOk(i + 1) && dfs(i + 1)) return true;
        used[t] &= ~bit;
      }
    }
    return false;
  }

  return dfs(0) ? assign : null;
}

/** 组装成功结果：逐条轨号 + 各非空轨的 SRT（轨内按起点、原位置排序并从 1 编号）。 */
function buildResult(entries, locks, assign) {
  const n = entries.length;
  const outEntries = entries.map((e, i) => ({
    pos: i + 1,
    index: e.index,
    start: formatMs(e.startMs),
    end: formatMs(e.endMs),
    text: e.text.join('\n'),
    lock: locks[i],
    track: assign[i],
  }));

  const tracks = [];
  for (let t = 1; t <= MAX_TRACKS; t++) {
    const members = [];
    for (let i = 0; i < n; i++) if (assign[i] === t) members.push(i);
    if (!members.length) continue;
    // 轨内按（起点、原位置）排序，从 1 重新编号；时间与多行正文保持不变
    members.sort((a, b) => (entries[a].startMs - entries[b].startMs) || (a - b));
    const srt = buildSrt(
      members.map((i, ni) => ({
        index: ni + 1,
        startMs: entries[i].startMs,
        endMs: entries[i].endMs,
        text: entries[i].text,
      }))
    );
    tracks.push({ track: t, count: members.length, srt });
  }

  return {
    ok: true,
    trackCount: Math.max(...assign),
    entries: outEntries,
    tracks,
  };
}

/**
 * 分轨接口主入口：splitTracks(srtText, rawLocks)
 * srtText 为最近一次校正成功的主轨 SRT；rawLocks 为逐条锁定值数组
 * （0 / null / undefined = 自动，1～4 = 锁定到对应轨），可整体缺省。
 * 返回：
 *  - { ok:false, parseErrors }           主轨 SRT 解析问题
 *  - { ok:false, splitErrors }           条数超限 / 锁定值非法 / 时长非正（逐条定位）
 *  - { ok:false, infeasible, message }   四轨内无可行分轨（不生成任何分轨文件）
 *  - { ok, trackCount, entries, tracks } 分轨结果；tracks 仅含非空轨，各自带可下载 SRT
 */
function splitTracks(srtText, rawLocks) {
  if (typeof srtText !== 'string' || srtText.trim() === '') {
    return { ok: false, parseErrors: ['主轨 SRT 为空：请先完成时间校正'] };
  }
  const { entries, errors: parseErrors } = parseSrt(srtText);
  if (parseErrors.length) return { ok: false, parseErrors };

  // 条数范围：每次处理 1～24 条
  const n = entries.length;
  if (n < MIN_ENTRIES || n > MAX_ENTRIES) {
    return {
      ok: false,
      splitErrors: [`字幕条数为 ${n}，超出每次 ${MIN_ENTRIES}～${MAX_ENTRIES} 条的处理范围`],
    };
  }

  // 逐条校验：时长必须为正；锁定值必须为 0（自动）或 1～4 的整数
  const splitErrors = [];
  entries.forEach((e, i) => {
    if (e.endMs <= e.startMs) {
      splitErrors.push(
        `第 ${i + 1} 条字幕（序号 ${e.index}）：时长非正` +
        `（${formatMs(e.startMs)} --> ${formatMs(e.endMs)}），无法分轨`
      );
    }
  });

  const locks = new Array(n).fill(0);
  if (rawLocks !== undefined && rawLocks !== null) {
    if (!Array.isArray(rawLocks)) {
      splitErrors.push('锁定值格式无效：应为与字幕一一对应的数组');
    } else if (rawLocks.length !== n) {
      splitErrors.push(`锁定值数量（${rawLocks.length}）与字幕条数（${n}）不一致`);
    } else {
      rawLocks.forEach((v, i) => {
        if (v === null || v === undefined || v === 0) return; // 自动
        if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_TRACKS) {
          locks[i] = v;
          return;
        }
        splitErrors.push(
          `第 ${i + 1} 条字幕（序号 ${entries[i].index}）：锁定值无效（${JSON.stringify(v)}），` +
          `应为 1～${MAX_TRACKS} 的整数或 0（自动）`
        );
      });
    }
  }
  if (splitErrors.length) return { ok: false, splitErrors };

  // 锁定冲突：同轨锁定字幕相互交叠，锁定轨号不得改变 → 直接无解
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (locks[i] > 0 && locks[i] === locks[j] && overlapMs(entries[i], entries[j]) > 0) {
        return {
          ok: false,
          infeasible: true,
          message:
            `四轨内无可行分轨：第 ${i + 1} 条与第 ${j + 1} 条字幕均锁定到 ${locks[i]} 号轨，` +
            `但时间区间交叠（锁定轨号不得改变）`,
        };
      }
    }
  }

  // 最大交叠深度超过 4 → 任何分配都不可能
  const depthInfo = maxOverlapDepth(entries);
  if (depthInfo.depth > MAX_TRACKS) {
    const list = depthInfo.positions.map((p) => p + 1).join('、');
    return {
      ok: false,
      infeasible: true,
      message:
        `四轨内无可行分轨：第 ${list} 条字幕在 ${formatMs(depthInfo.pointMs)} 同时交叠，` +
        `共 ${depthInfo.depth} 条，超过 ${MAX_TRACKS} 轨上限`,
    };
  }

  // 全局求解：先最小化最大轨号（k 从小到大），再取轨号向量字典序最小者
  const maxLock = Math.max(0, ...locks);
  for (let k = Math.max(1, maxLock); k <= MAX_TRACKS; k++) {
    if (depthInfo.depth > k) continue;
    const assign = solveAssignment(entries, locks, k);
    if (assign) return buildResult(entries, locks, assign);
  }

  return {
    ok: false,
    infeasible: true,
    message:
      `四轨内无可行分轨：在当前锁定条件下，1～${MAX_TRACKS} 号轨无法容纳这些相互交叠的字幕，` +
      `请调整锁定或减少每批字幕条数`,
  };
}

module.exports = { splitTracks, solveAssignment, maxOverlapDepth, overlapMs, MAX_ENTRIES, MAX_TRACKS };
