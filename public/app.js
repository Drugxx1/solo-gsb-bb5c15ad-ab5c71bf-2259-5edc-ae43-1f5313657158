'use strict';

(function () {
  var srtInput = document.getElementById('srtInput');
  var fileInput = document.getElementById('fileInput');
  var anchorBody = document.getElementById('anchorBody');
  var addAnchorBtn = document.getElementById('addAnchorBtn');
  var convertBtn = document.getElementById('convertBtn');
  var downloadBtn = document.getElementById('downloadBtn');
  var loadSampleBtn = document.getElementById('loadSampleBtn');
  var clearBtn = document.getElementById('clearBtn');
  var messageBox = document.getElementById('message');
  var resultCard = document.getElementById('resultCard');
  var resultBody = document.getElementById('resultBody');
  var entryCount = document.getElementById('entryCount');
  var secondaryInput = document.getElementById('secondaryInput');
  var secondaryFileInput = document.getElementById('secondaryFileInput');
  var loadSecondarySampleBtn = document.getElementById('loadSecondarySampleBtn');
  var clearSecondaryBtn = document.getElementById('clearSecondaryBtn');
  var alignBtn = document.getElementById('alignBtn');
  var downloadCsvBtn = document.getElementById('downloadCsvBtn');
  var alignMessageBox = document.getElementById('alignMessage');
  var alignResultCard = document.getElementById('alignResultCard');
  var pairBody = document.getElementById('pairBody');
  var unmatchedPrimaryBody = document.getElementById('unmatchedPrimaryBody');
  var unmatchedSecondaryBody = document.getElementById('unmatchedSecondaryBody');
  var pairCount = document.getElementById('pairCount');
  var unmatchedPrimaryCount = document.getElementById('unmatchedPrimaryCount');
  var unmatchedSecondaryCount = document.getElementById('unmatchedSecondaryCount');
  var loadOverlapSampleBtn = document.getElementById('loadOverlapSampleBtn');
  var splitBtn = document.getElementById('splitBtn');
  var splitMessageBox = document.getElementById('splitMessage');
  var splitTableWrap = document.getElementById('splitTableWrap');
  var splitBody = document.getElementById('splitBody');
  var splitEntryCount = document.getElementById('splitEntryCount');
  var splitTrackCount = document.getElementById('splitTrackCount');
  var splitDownloads = document.getElementById('splitDownloads');

  var correctedSrt = null;
  var alignCsv = null;

  // ---------- 锚点行 ----------

  function addAnchorRow(src, dst) {
    var tr = document.createElement('tr');

    var tdNo = document.createElement('td');
    var tdSrc = document.createElement('td');
    var tdDst = document.createElement('td');
    var tdOp = document.createElement('td');

    var srcInput = document.createElement('input');
    srcInput.type = 'text';
    srcInput.placeholder = '00:00:00,000';
    srcInput.className = 'anchor-src';
    if (src) srcInput.value = src;

    var dstInput = document.createElement('input');
    dstInput.type = 'text';
    dstInput.placeholder = '00:00:00,000';
    dstInput.className = 'anchor-dst';
    if (dst) dstInput.value = dst;

    var delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'danger';
    delBtn.textContent = '删除';
    delBtn.addEventListener('click', function () {
      tr.remove();
      renumber();
    });

    tdSrc.appendChild(srcInput);
    tdDst.appendChild(dstInput);
    tdOp.appendChild(delBtn);
    tr.appendChild(tdNo);
    tr.appendChild(tdSrc);
    tr.appendChild(tdDst);
    tr.appendChild(tdOp);
    anchorBody.appendChild(tr);
    renumber();
  }

  function renumber() {
    var rows = anchorBody.querySelectorAll('tr');
    for (var i = 0; i < rows.length; i++) {
      rows[i].firstChild.textContent = String(i + 1);
    }
  }

  function collectAnchors() {
    var anchors = [];
    var rows = anchorBody.querySelectorAll('tr');
    for (var i = 0; i < rows.length; i++) {
      anchors.push({
        src: rows[i].querySelector('.anchor-src').value.trim(),
        dst: rows[i].querySelector('.anchor-dst').value.trim()
      });
    }
    return anchors;
  }

  // ---------- 消息 ----------

  function showMessage(kind, lines) {
    messageBox.hidden = false;
    messageBox.className = 'message ' + kind;
    messageBox.textContent = Array.isArray(lines) ? lines.join('\n') : String(lines);
  }

  function hideMessage() {
    messageBox.hidden = true;
    messageBox.textContent = '';
  }

  // ---------- 结果表 ----------

  function renderEntries(entries, errors) {
    resultBody.innerHTML = '';
    entryCount.textContent = String(entries.length);
    entries.forEach(function (e) {
      var tr = document.createElement('tr');
      if (errors && errors.length && errors.some(function (msg) {
        return msg.indexOf('字幕 ' + e.index + '：') === 0 || msg.indexOf('字幕 ' + e.index + '（') !== -1;
      })) {
        tr.className = 'problem';
      }
      ['index', 'oldStart', 'oldEnd', 'newStart', 'newEnd'].forEach(function (k) {
        var td = document.createElement('td');
        td.textContent = String(e[k]);
        if (k !== 'index') td.className = 'time';
        tr.appendChild(td);
      });
      var tdText = document.createElement('td');
      tdText.className = 'text';
      tdText.textContent = e.text;
      tr.appendChild(tdText);
      resultBody.appendChild(tr);
    });
    resultCard.hidden = entries.length === 0;
  }

  // ---------- 对齐结果 ----------

  function showAlignMessage(kind, lines) {
    alignMessageBox.hidden = false;
    alignMessageBox.className = 'message ' + kind;
    alignMessageBox.textContent = Array.isArray(lines) ? lines.join('\n') : String(lines);
  }

  function hideAlignMessage() {
    alignMessageBox.hidden = true;
    alignMessageBox.textContent = '';
  }

  // 主轨变化后旧对齐结果失效
  function resetAlign() {
    alignCsv = null;
    downloadCsvBtn.disabled = true;
    alignResultCard.hidden = true;
    hideAlignMessage();
  }

  function fillUnmatchedTable(tbody, entries) {
    tbody.innerHTML = '';
    if (!entries.length) {
      var emptyTr = document.createElement('tr');
      var emptyTd = document.createElement('td');
      emptyTd.colSpan = 4;
      emptyTd.className = 'empty';
      emptyTd.textContent = '（无）';
      emptyTr.appendChild(emptyTd);
      tbody.appendChild(emptyTr);
      return;
    }
    entries.forEach(function (e) {
      var tr = document.createElement('tr');
      [e.index, e.start, e.end].forEach(function (v, k) {
        var td = document.createElement('td');
        td.textContent = String(v);
        if (k > 0) td.className = 'time';
        tr.appendChild(td);
      });
      var tdText = document.createElement('td');
      tdText.className = 'text';
      tdText.textContent = e.text;
      tr.appendChild(tdText);
      tbody.appendChild(tr);
    });
  }

  function renderAlign(data) {
    pairCount.textContent = String(data.stats.pairs);
    unmatchedPrimaryCount.textContent = String(data.stats.unmatchedPrimary);
    unmatchedSecondaryCount.textContent = String(data.stats.unmatchedSecondary);

    pairBody.innerHTML = '';
    if (!data.pairs.length) {
      var emptyTr = document.createElement('tr');
      var emptyTd = document.createElement('td');
      emptyTd.colSpan = 7;
      emptyTd.className = 'empty';
      emptyTd.textContent = '（无配对）';
      emptyTr.appendChild(emptyTd);
      pairBody.appendChild(emptyTr);
    } else {
      data.pairs.forEach(function (p) {
        var tr = document.createElement('tr');
        [
          p.primary.index,
          p.primary.start + ' --> ' + p.primary.end,
          p.secondary.index,
          p.secondary.start + ' --> ' + p.secondary.end,
          p.overlapMs,
        ].forEach(function (v, k) {
          var td = document.createElement('td');
          td.textContent = String(v);
          if (k === 1 || k === 3) td.className = 'time';
          tr.appendChild(td);
        });
        [p.primary.text, p.secondary.text].forEach(function (t) {
          var td = document.createElement('td');
          td.className = 'text';
          td.textContent = t;
          tr.appendChild(td);
        });
        pairBody.appendChild(tr);
      });
    }

    fillUnmatchedTable(unmatchedPrimaryBody, data.unmatchedPrimary);
    fillUnmatchedTable(unmatchedSecondaryBody, data.unmatchedSecondary);
    alignResultCard.hidden = false;
  }

  // ---------- 对齐请求 ----------

  function align() {
    resetAlign();
    if (!correctedSrt) {
      showAlignMessage('error', '请先完成第 3 步校正：对齐使用校正成功后返回的主轨 SRT。');
      return;
    }
    fetch('/api/align', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ primary: correctedSrt, secondary: secondaryInput.value })
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.primaryParseErrors) {
          showAlignMessage('error', ['主轨 SRT 解析失败：'].concat(data.primaryParseErrors));
          return;
        }
        if (data.secondaryParseErrors) {
          // 副轨无效只提示解析错误，不影响主轨 SRT 的导出
          showAlignMessage('error', ['副轨 SRT 解析失败（不影响主轨 SRT 导出）：'].concat(data.secondaryParseErrors));
          return;
        }
        if (data.alignErrors) {
          showAlignMessage('error', ['无法对齐：'].concat(data.alignErrors));
          return;
        }
        renderAlign(data);
        alignCsv = data.csv;
        downloadCsvBtn.disabled = false;
        showAlignMessage('ok', '对齐完成：配对 ' + data.stats.pairs + ' 对，主轨未配对 ' +
          data.stats.unmatchedPrimary + ' 条，副轨未配对 ' + data.stats.unmatchedSecondary +
          ' 条，交叠共 ' + data.stats.totalOverlapMs + ' ms，可下载 CSV。');
      })
      .catch(function (err) {
        showAlignMessage('error', '请求失败：' + err.message);
      });
  }

  // ---------- 对齐 CSV 下载 ----------

  function downloadCsv() {
    if (!alignCsv) return;
    var blob = new Blob([alignCsv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'aligned.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ---------- 分轨 ----------

  function showSplitMessage(kind, lines) {
    splitMessageBox.hidden = false;
    splitMessageBox.className = 'message ' + kind;
    splitMessageBox.textContent = Array.isArray(lines) ? lines.join('\n') : String(lines);
  }

  function hideSplitMessage() {
    splitMessageBox.hidden = true;
    splitMessageBox.textContent = '';
  }

  // 主轨或锁定值改变后，旧分轨结果失效（保留字幕清单与锁定选择）
  function resetSplitResults() {
    splitDownloads.innerHTML = '';
    splitTrackCount.textContent = '0';
    hideSplitMessage();
    var cells = splitBody.querySelectorAll('.split-track-cell');
    for (var i = 0; i < cells.length; i++) cells[i].textContent = '—';
  }

  function clearSplitTable() {
    splitBody.innerHTML = '';
    splitTableWrap.hidden = true;
    splitEntryCount.textContent = '0';
    resetSplitResults();
  }

  // 校正成功后，按主轨字幕（文件顺序）渲染清单：位置 / 序号 / 时间 / 锁定 / 轨号 / 正文
  function buildSplitTable(entries) {
    splitBody.innerHTML = '';
    splitEntryCount.textContent = String(entries.length);
    entries.forEach(function (e, i) {
      var tr = document.createElement('tr');

      var tdPos = document.createElement('td');
      tdPos.textContent = String(i + 1);
      tr.appendChild(tdPos);

      var tdIndex = document.createElement('td');
      tdIndex.textContent = String(e.index);
      tr.appendChild(tdIndex);

      var tdTime = document.createElement('td');
      tdTime.className = 'time';
      tdTime.textContent = e.newStart + ' --> ' + e.newEnd;
      tr.appendChild(tdTime);

      var tdLock = document.createElement('td');
      var sel = document.createElement('select');
      sel.className = 'lock-select';
      [['0', '自动'], ['1', '1 号轨'], ['2', '2 号轨'], ['3', '3 号轨'], ['4', '4 号轨']]
        .forEach(function (opt) {
          var o = document.createElement('option');
          o.value = opt[0];
          o.textContent = opt[1];
          sel.appendChild(o);
        });
      sel.addEventListener('change', function () { resetSplitResults(); });
      tdLock.appendChild(sel);
      tr.appendChild(tdLock);

      var tdTrack = document.createElement('td');
      tdTrack.className = 'split-track-cell';
      tdTrack.textContent = '—';
      tr.appendChild(tdTrack);

      var tdText = document.createElement('td');
      tdText.className = 'text';
      tdText.textContent = e.text;
      tr.appendChild(tdText);

      splitBody.appendChild(tr);
    });
    splitTableWrap.hidden = false;
    resetSplitResults();
  }

  function renderSplit(data) {
    splitTrackCount.textContent = String(data.trackCount);
    var rows = splitBody.querySelectorAll('tr');
    data.entries.forEach(function (e, i) {
      var row = rows[i];
      if (!row) return;
      var cell = row.querySelector('.split-track-cell');
      cell.innerHTML = '';
      var badge = document.createElement('span');
      badge.className = 'track-badge track-' + e.track;
      badge.textContent = e.track + ' 号轨';
      cell.appendChild(badge);
    });
    splitDownloads.innerHTML = '';
    data.tracks.forEach(function (t) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'secondary';
      btn.textContent = '下载 ' + t.track + ' 号轨 SRT（' + t.count + ' 条）';
      btn.addEventListener('click', function () { downloadTrack(t.track, t.srt); });
      splitDownloads.appendChild(btn);
    });
  }

  function split() {
    resetSplitResults();
    if (!correctedSrt) {
      showSplitMessage('error', '请先完成第 3 步校正：分轨使用校正成功后返回的主轨 SRT。');
      return;
    }
    var locks = [];
    var selects = splitBody.querySelectorAll('.lock-select');
    for (var i = 0; i < selects.length; i++) locks.push(Number(selects[i].value));
    fetch('/api/split-tracks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ srt: correctedSrt, locks: locks })
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.parseErrors) {
          showSplitMessage('error', ['主轨 SRT 解析失败：'].concat(data.parseErrors));
          return;
        }
        if (data.splitErrors) {
          showSplitMessage('error', ['无法分轨：'].concat(data.splitErrors));
          return;
        }
        if (data.infeasible) {
          showSplitMessage('error', data.message);
          return;
        }
        renderSplit(data);
        showSplitMessage('ok', '分轨完成：共 ' + data.entries.length + ' 条字幕，使用 ' +
          data.trackCount + ' 条轨，可分别下载各非空轨的 SRT。');
      })
      .catch(function (err) {
        showSplitMessage('error', '请求失败：' + err.message);
      });
  }

  function downloadTrack(track, srt) {
    var blob = new Blob([srt], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'track-' + track + '.srt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ---------- 校正请求 ----------

  function convert() {
    hideMessage();
    correctedSrt = null;
    downloadBtn.disabled = true;
    resetAlign();
    clearSplitTable();

    var payload = { srt: srtInput.value, anchors: collectAnchors() };
    fetch('/api/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.anchorErrors) {
          resultCard.hidden = true;
          showMessage('error', ['锚点设置有误：'].concat(data.anchorErrors));
          return;
        }
        if (data.parseErrors) {
          resultCard.hidden = true;
          showMessage('error', ['SRT 解析失败：'].concat(data.parseErrors));
          return;
        }
        renderEntries(data.entries || [], data.errors);
        if (data.errors && data.errors.length) {
          showMessage('error', ['校正结果存在问题，已阻止导出：'].concat(data.errors));
          return;
        }
        correctedSrt = data.srt;
        downloadBtn.disabled = false;
        buildSplitTable(data.entries || []);
        showMessage('ok', '校正完成，共 ' + (data.entries ? data.entries.length : 0) + ' 条字幕，可下载导出。');
      })
      .catch(function (err) {
        showMessage('error', '请求失败：' + err.message);
      });
  }

  // ---------- 下载 ----------

  function download() {
    if (!correctedSrt) return;
    var blob = new Blob([correctedSrt], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'corrected.srt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ---------- 事件绑定 ----------

  fileInput.addEventListener('change', function () {
    var file = fileInput.files && fileInput.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () { srtInput.value = String(reader.result || ''); };
    reader.readAsText(file, 'utf-8');
  });

  loadSampleBtn.addEventListener('click', function () {
    srtInput.value = [
      '1',
      '00:00:01,000 --> 00:00:03,500',
      '第一行字幕',
      '跨两行显示',
      '',
      '2',
      '00:00:05,000 --> 00:00:07,000',
      '第二段对白',
      '',
      '3',
      '00:00:12,000 --> 00:00:14,500',
      '第三段对白'
    ].join('\n');
  });

  clearBtn.addEventListener('click', function () {
    srtInput.value = '';
    fileInput.value = '';
    resultCard.hidden = true;
    correctedSrt = null;
    downloadBtn.disabled = true;
    resetAlign();
    clearSplitTable();
    hideMessage();
  });

  secondaryFileInput.addEventListener('change', function () {
    var file = secondaryFileInput.files && secondaryFileInput.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () { secondaryInput.value = String(reader.result || ''); };
    reader.readAsText(file, 'utf-8');
  });

  loadSecondarySampleBtn.addEventListener('click', function () {
    secondaryInput.value = [
      '1',
      '00:00:02,100 --> 00:00:04,800',
      'First line of dialogue',
      '',
      '2',
      '00:00:06,900 --> 00:00:09,000',
      'Second line of dialogue',
      '',
      '3',
      '00:00:15,200 --> 00:00:17,300',
      'Third line of dialogue',
      '',
      '4',
      '00:00:20,000 --> 00:00:21,500',
      'Extra line without counterpart'
    ].join('\n');
  });

  clearSecondaryBtn.addEventListener('click', function () {
    secondaryInput.value = '';
    secondaryFileInput.value = '';
    resetAlign();
  });

  alignBtn.addEventListener('click', align);
  downloadCsvBtn.addEventListener('click', downloadCsv);

  splitBtn.addEventListener('click', split);

  loadOverlapSampleBtn.addEventListener('click', function () {
    srtInput.value = [
      '1',
      '00:00:01,000 --> 00:00:04,000',
      '会议现场（长句）',
      '',
      '2',
      '00:00:02,000 --> 00:00:03,000',
      '同期声',
      '',
      '3',
      '00:00:05,000 --> 00:00:08,000',
      '旁白第一段',
      '跨两行显示',
      '',
      '4',
      '00:00:05,500 --> 00:00:06,500',
      '重叠字幕示例',
      '',
      '5',
      '00:00:06,000 --> 00:00:09,000',
      '旁白第二段'
    ].join('\n');
  });

  addAnchorBtn.addEventListener('click', function () { addAnchorRow(); });
  convertBtn.addEventListener('click', convert);
  downloadBtn.addEventListener('click', download);

  // 默认两个锚点行
  addAnchorRow('00:00:01,000', '00:00:02,000');
  addAnchorRow('00:00:12,000', '00:00:15,000');
})();
