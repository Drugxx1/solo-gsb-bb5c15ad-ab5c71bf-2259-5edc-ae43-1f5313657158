'use strict';

const { parseSrt } = require('./srt');
const { formatMs } = require('./time');

/** DP 单元格数量上限：超出时拒绝对齐，避免矩阵耗尽内存。 */
const MAX_CELLS = 40 * 1000 * 1000;

// DP 选择编码
const PAIR = 0; // 配对当前条目
const SKIP_S = 1; // 跳过副轨条目
const SKIP_P = 2; // 跳过主轨条目

/** 两条目时间区间的交叠毫秒数；<= 0 表示不可配对。 */
function overlapMs(a, b) {
  return Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs);
}

/**
 * 保持两轨顺序的一对一最优配对（动态规划，允许跳过无对应字幕）。
 * 目标优先级：
 *  1. 配对交叠毫秒数总和最大；
 *  2. 平分时，配对的起点差 |主轨开始 − 副轨开始| 总和最小；
 *  3. 仍平分时按序号靠前确定：优先配对当前条目，其次跳过副轨条目，最后跳过主轨条目。
 *
 * primary / secondary 为 parseSrt 的 entries（按文件顺序）。
 * 返回 { pairs, unmatchedPrimary, unmatchedSecondary, totalOverlapMs }；
 * pairs 元素为 { primaryPos, secondaryPos, overlapMs, startDiffMs }，按两轨顺序排列；
 * unmatched* 为未配对条目的位置数组。条目数乘积超过上限时返回 null。
 */
function alignTracks(primary, secondary) {
  const m = primary.length;
  const n = secondary.length;
  if (m * n > MAX_CELLS) return null;

  const choice = new Uint8Array(m * n);
  // 滚动行：next* 为第 i+1 行，cur* 为第 i 行（后缀 DP，自底向上）
  let nextO = new Float64Array(n + 1); // 交叠总和
  let nextD = new Float64Array(n + 1); // 起点差总和
  let curO = new Float64Array(n + 1);
  let curD = new Float64Array(n + 1);

  for (let i = m - 1; i >= 0; i--) {
    const pi = primary[i];
    const rowBase = i * n;
    for (let j = n - 1; j >= 0; j--) {
      // 候选：跳过主轨（平分优先级最低）
      let bestO = nextO[j];
      let bestD = nextD[j];
      let bestC = SKIP_P;
      // 候选：跳过副轨（平分时优先于跳过主轨）
      if (curO[j + 1] > bestO || (curO[j + 1] === bestO && curD[j + 1] <= bestD)) {
        bestO = curO[j + 1];
        bestD = curD[j + 1];
        bestC = SKIP_S;
      }
      // 候选：配对（仅当交叠 > 0；平分时优先级最高）
      const sj = secondary[j];
      const ov = Math.min(pi.endMs, sj.endMs) - Math.max(pi.startMs, sj.startMs);
      if (ov > 0) {
        const po = ov + nextO[j + 1];
        const pd = Math.abs(pi.startMs - sj.startMs) + nextD[j + 1];
        if (po > bestO || (po === bestO && pd <= bestD)) {
          bestO = po;
          bestD = pd;
          bestC = PAIR;
        }
      }
      choice[rowBase + j] = bestC;
      curO[j] = bestO;
      curD[j] = bestD;
    }
    // 交换滚动行（cur 的末位保持 0，作为下一轮的边界）
    const tO = nextO; nextO = curO; curO = tO;
    const tD = nextD; nextD = curD; curD = tD;
  }

  // 回溯取配对
  const pairs = [];
  const matchedP = new Uint8Array(m);
  const matchedS = new Uint8Array(n);
  let totalOverlapMs = 0;
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    const c = choice[i * n + j];
    if (c === PAIR) {
      const ov = overlapMs(primary[i], secondary[j]);
      pairs.push({
        primaryPos: i,
        secondaryPos: j,
        overlapMs: ov,
        startDiffMs: Math.abs(primary[i].startMs - secondary[j].startMs),
      });
      totalOverlapMs += ov;
      matchedP[i] = 1;
      matchedS[j] = 1;
      i++;
      j++;
    } else if (c === SKIP_S) {
      j++;
    } else {
      i++;
    }
  }

  const unmatchedPrimary = [];
  for (let k = 0; k < m; k++) if (!matchedP[k]) unmatchedPrimary.push(k);
  const unmatchedSecondary = [];
  for (let k = 0; k < n; k++) if (!matchedS[k]) unmatchedSecondary.push(k);

  return { pairs, unmatchedPrimary, unmatchedSecondary, totalOverlapMs };
}

/** 序列化条目供页面展示：{ index, start, end, text }。 */
function serializeEntry(e) {
  return {
    index: e.index,
    start: formatMs(e.startMs),
    end: formatMs(e.endMs),
    text: e.text.join('\n'),
  };
}

/** CSV 单元格转义（RFC 4180）。 */
function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * 生成对齐结果 CSV：含双方序号、时间、正文。
 * 先列出全部配对行，再依次列出主轨、副轨未配对行；带 BOM 便于 Excel 直接打开。
 */
function buildCsv(pairs, unmatchedPrimary, unmatchedSecondary) {
  const rows = [
    ['状态', '主轨序号', '主轨开始', '主轨结束', '主轨正文', '副轨序号', '副轨开始', '副轨结束', '副轨正文', '交叠毫秒'],
  ];
  pairs.forEach((p) => {
    rows.push([
      '配对',
      p.primary.index, p.primary.start, p.primary.end, p.primary.text,
      p.secondary.index, p.secondary.start, p.secondary.end, p.secondary.text,
      p.overlapMs,
    ]);
  });
  unmatchedPrimary.forEach((e) => {
    rows.push(['主轨未配对', e.index, e.start, e.end, e.text, '', '', '', '', '']);
  });
  unmatchedSecondary.forEach((e) => {
    rows.push(['副轨未配对', '', '', '', '', e.index, e.start, e.end, e.text, '']);
  });
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/**
 * 对齐接口主入口：alignSrt(primarySrtText, secondarySrtText)
 * 主轨为 /api/convert 成功返回的校正后 SRT，副轨为成片时间轴上的另一语言 SRT。
 * 返回：
 *  - { ok:false, primaryParseErrors }   主轨解析问题
 *  - { ok:false, secondaryParseErrors } 副轨解析问题
 *  - { ok:false, alignErrors }          对齐本身无法进行（如条目过多）
 *  - { ok, stats, pairs, unmatchedPrimary, unmatchedSecondary, csv }
 */
function alignSrt(primaryText, secondaryText) {
  if (typeof primaryText !== 'string' || primaryText.trim() === '') {
    return { ok: false, primaryParseErrors: ['主轨 SRT 为空：请先完成时间校正'] };
  }
  const primary = parseSrt(primaryText);
  if (primary.errors.length) return { ok: false, primaryParseErrors: primary.errors };
  if (!primary.entries.length) return { ok: false, primaryParseErrors: ['主轨未解析到任何字幕条目'] };

  if (typeof secondaryText !== 'string' || secondaryText.trim() === '') {
    return { ok: false, secondaryParseErrors: ['副轨 SRT 内容为空，请粘贴或上传字幕文件'] };
  }
  const secondary = parseSrt(secondaryText);
  if (secondary.errors.length) return { ok: false, secondaryParseErrors: secondary.errors };
  if (!secondary.entries.length) return { ok: false, secondaryParseErrors: ['副轨未解析到任何字幕条目'] };

  const aligned = alignTracks(primary.entries, secondary.entries);
  if (!aligned) {
    return {
      ok: false,
      alignErrors: [
        `字幕条目过多（主轨 ${primary.entries.length} 条 × 副轨 ${secondary.entries.length} 条），超出对齐上限`,
      ],
    };
  }

  const pEntries = primary.entries;
  const sEntries = secondary.entries;
  const pairs = aligned.pairs.map((p) => ({
    primary: serializeEntry(pEntries[p.primaryPos]),
    secondary: serializeEntry(sEntries[p.secondaryPos]),
    overlapMs: p.overlapMs,
    startDiffMs: p.startDiffMs,
  }));
  const unmatchedPrimary = aligned.unmatchedPrimary.map((pos) => serializeEntry(pEntries[pos]));
  const unmatchedSecondary = aligned.unmatchedSecondary.map((pos) => serializeEntry(sEntries[pos]));

  return {
    ok: true,
    stats: {
      pairs: pairs.length,
      unmatchedPrimary: unmatchedPrimary.length,
      unmatchedSecondary: unmatchedSecondary.length,
      totalOverlapMs: aligned.totalOverlapMs,
    },
    pairs,
    unmatchedPrimary,
    unmatchedSecondary,
    csv: buildCsv(pairs, unmatchedPrimary, unmatchedSecondary),
  };
}

module.exports = { alignSrt, alignTracks, overlapMs, buildCsv };
