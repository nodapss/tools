let selectedPort = null;
let reader = null;
let writer = null;
let reading = false;
let lineBuffer = '';
let chart = null;
let datasetCounter = 0;
let datasetList = []; // {id,label,values,caption}
let streamBuffer = '';
let pendingCaption = null; // {id, caption}
let lastAction = '';
// Request larger serial ring buffer from browser (if supported by Web Serial)
const SERIAL_BUFFER_SIZE = 1024 * 1024; // 1 MiB

function setStatus(msg) { document.getElementById('status').textContent = msg; }
function appendTerm(text) {
  const term = document.getElementById('terminal');
  term.textContent += text;
  term.scrollTop = term.scrollHeight;
}
function clearTerminal() { document.getElementById('terminal').textContent = ''; datasetList = []; datasetCounter = 0; streamBuffer = ''; refreshDatasetSelect(); }

// refreshPortList 제거 (포트 콤보 롤백)

async function requestPort() {
  if (!('serial' in navigator)) {
    alert('이 브라우저는 Web Serial을 지원하지 않습니다. Chrome/Edge 사용 및 HTTPS 또는 file://에서 여세요.');
    return;
  }
  try {
    selectedPort = await navigator.serial.requestPort();
    document.getElementById('btnConnect').disabled = false;
    setStatus('포트 선택됨');
  } catch (e) {
    setStatus('포트 선택 취소');
  }
}

async function connect() {
  if (!selectedPort) { alert('먼저 포트를 선택하세요.'); return; }
  const baud = Number(document.getElementById('baud').value);
  const dataBits = Number(document.getElementById('dataBits').value);
  const parity = document.getElementById('parity').value;
  const stopBits = Number(document.getElementById('stopBits').value);
  const flow = document.getElementById('flow').value;
  const flowControl = flow === 'hardware' ? 'hardware' : undefined;
  try {
    // Note: bufferSize is best-effort; browsers may ignore if unsupported
    await selectedPort.open({ baudRate: baud, dataBits, parity, stopBits, flowControl, bufferSize: SERIAL_BUFFER_SIZE });
    writer = selectedPort.writable.getWriter();
    startReadLoop();
    setStatus(`연결됨 @ ${baud}bps, ${dataBits}${parity[0].toUpperCase()}${stopBits}`);
    document.getElementById('btnDisconnect').disabled = false;
    document.getElementById('btnConnect').disabled = true;
    appendTerm(`>> CONNECTED @ ${baud}bps\n`);
  } catch (e) {
    alert('연결 실패: ' + (e.message || e));
  }
}

async function disconnect() {
  try {
    reading = false;
    if (reader) {
      try { await reader.cancel(); } catch {}
      try { reader.releaseLock(); } catch {}
      reader = null;
    }
    if (writer) {
      try { await writer.close(); } catch {}
      try { writer.releaseLock(); } catch {}
      writer = null;
    }
    if (selectedPort) {
      try { await selectedPort.close(); } catch {}
    }
    setStatus('해제됨');
    document.getElementById('btnDisconnect').disabled = true;
    document.getElementById('btnConnect').disabled = false;
    appendTerm('>> DISCONNECTED\n');
  } catch (e) {
    setStatus('해제 처리 중 오류');
  }
}

async function startReadLoop() {
  try {
    const textDecoder = new TextDecoderStream();
    const readableStreamClosed = selectedPort.readable.pipeTo(textDecoder.writable);
    reader = textDecoder.readable.getReader();
    reading = true;
    while (reading) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) handleIncomingText(value);
    }
  } catch (e) {
    setStatus('읽기 종료: ' + (e.message || e));
  } finally {
    try { if (reader) reader.releaseLock(); } catch {}
  }
}

function tryExtractDatasetsFromBuffer() {
  // 1) Pick up caption lines if present at line starts
  const capRe = /\[Plot_(\d{4}):\s*([^\]]+)\]/;
  let foundLineBreak;
  do {
    foundLineBreak = false;
    const nl = streamBuffer.indexOf('\n');
    if (nl >= 0) {
      const line = streamBuffer.slice(0, nl).trim();
      const m = line.match(capRe);
      if (m) {
        pendingCaption = { id: `Plot_${m[1]}`, caption: m[2] };
        streamBuffer = streamBuffer.slice(nl + 1);
        foundLineBreak = true;
      }
    }
  } while (foundLineBreak);

  // 2) Extract DataStart..DataEnd segments

  // parse segments: DataStart ... DataEnd
  while (true) {
    const s = streamBuffer.indexOf('DataStart');
    if (s < 0) { return; }
    const e = streamBuffer.indexOf('DataEnd', s);
    if (e < 0) { return; }
    // If caption not yet captured by newline logic, try to back-search right before DataStart
    if (!pendingCaption) {
      const pre = streamBuffer.slice(0, s);
      const mm = pre.match(/\[Plot_(\d{4}):\s*([^\]]+)\]\s*$/);
      if (mm) pendingCaption = { id: `Plot_${mm[1]}`, caption: mm[2] };
    }
    const payload = streamBuffer.substring(s + 'DataStart'.length + 1, e) // skip comma after DataStart
      .replace(/\s+/g, '');
    // Convert to numbers
    const parts = payload.split(',').filter(Boolean);
    const values = parts.map(x => Number(x)).filter(v => Number.isFinite(v));
    const id = pendingCaption && pendingCaption.id ? pendingCaption.id : `Plot_${String(datasetCounter).padStart(4,'0')}`;
    const caption = pendingCaption && pendingCaption.caption ? pendingCaption.caption : `Dataset`;
    const label = `${id}: ${caption}`;
    datasetList.push({ id, label, caption, values });
    try { console.debug('[webterm] dataset parsed', { id, caption, length: values.length }); } catch(_) {}
    if (!pendingCaption) datasetCounter += 1; // if caption absent, advance internal counter
    pendingCaption = null;
    // shrink buffer to after DataEnd
    streamBuffer = streamBuffer.slice(e + 'DataEnd'.length);
    // auto plot latest if enabled
    try {
      if (document.getElementById('autoPlot')?.checked) {
        const sel = document.getElementById('datasetSelect');
        if (sel) { sel.value = id; }
        const isTimeCap = /^TIME_/i.test(caption || '');
        try { console.debug('[webterm] autoPlot', { id, caption, isTimeCap, length: values.length }); } catch(_) {}
        // Directly plot with explicit fullForTime flag to avoid race on select value
        plotMagnitudeDual(values, null, { fullForTime: isTimeCap });
        // autoscale after plotting (respect keepX/keepY1/keepY2)
        try { autoScaleAxes(); } catch(_) {}
      }
    } catch (_) {}
  }
}

function handleIncomingText(chunk) {
  const text = chunk.replace(/\r\n|\n\r/g, '\n').replace(/\r/g, '\n');
  lineBuffer += text;
  streamBuffer += text; // for dataset extraction
  const parts = lineBuffer.split('\n');
  for (let i = 0; i < parts.length - 1; i++) {
    appendTerm(parts[i] + '\n');
  }
  lineBuffer = parts[parts.length - 1];
  tryExtractDatasetsFromBuffer();
  refreshDatasetSelect();
}

async function sendRaw(data) {
  if (!writer) { alert('연결 후 전송 가능합니다.'); return; }
  try {
    const encoded = new TextEncoder().encode(data);
    await writer.write(encoded);
    appendTerm('>> TX ' + JSON.stringify(Array.from(encoded)) + '\n');
  } catch (e) {
    setStatus('전송 실패: ' + (e.message || e));
  }
}

async function sendText() {
  const input = document.getElementById('tx');
  const nl = document.getElementById('newline').value;
  let data = input.value;
  if (nl === 'CRLF') data += '\r\n';
  else if (nl === 'CR') data += '\r';
  else if (nl === 'LF') data += '\n';
  await sendRaw(data);
  input.value = '';
  input.focus();
}

// Plot helpers
function parseFftLinesFromTerminal() {
  try { console.log('[parse] start'); } catch (_) {}
  const status = (msg) => { try { console.log(msg); } catch(_) {} try { const el=document.getElementById('plotStatus'); if (el) el.textContent = msg; } catch(_) {} };
  const text = document.getElementById('terminal').textContent || '';
  const lines = text.split(/\n+/);

  // 1) 가장 마지막 "Dump Start" 라인을 찾는다 (End가 아닌 Start 기준)
  let startIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const L = lines[i].trim();
    if (L.startsWith('<<') && /start/i.test(L)) { startIdx = i; break; }
  }

  // 2) Start 이후 연속되는 숫자 콤마 라인만 수집. End나 공백/텍스트 만나면 중단
  const rows = [];
  if (startIdx !== -1) {
    status(`[parse] start at line ${startIdx}`);
    const dataLineRe = /^(\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)/;
    for (let j = startIdx + 1; j < lines.length; j++) {
      const line = (lines[j] || '').trim();
      if (line.startsWith('<<')) break; // End 도달 시 종료
      if (line === '') continue;        // 공백 라인은 무시
      const m = line.match(dataLineRe);
      if (!m) continue;                 // 기타 텍스트는 스킵
      const idx = parseInt(m[1], 10);
      const r = parseFloat(m[2]);
      const i = parseFloat(m[3]);
      const mag = parseFloat(m[4]);
      if (Number.isFinite(idx) && Number.isFinite(r) && Number.isFinite(i) && Number.isFinite(mag)) {
        rows.push([idx, r, i, mag]);
      }
    }
  }

  // 3) 보강: Start를 못 찾았을 때, 마지막으로 보이는 숫자 콤마 라인 덩어리를 수집
  if (!rows.length) {
    const dataLineRe = /^(\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)/;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (dataLineRe.test(lines[i])) { startIdx = i; break; }
    }
    if (startIdx !== -1) {
      for (let j = startIdx; j < lines.length; j++) {
        const m = (lines[j] || '').trim().match(dataLineRe);
        if (!m) break;
        rows.push([parseInt(m[1],10), parseFloat(m[2]), parseFloat(m[3]), parseFloat(m[4])]);
      }
    }
  }

  if (!rows.length) { status('[parse] no rows'); throw new Error("데이터를 찾을 수 없습니다. 'index,real,imag,mag' 형식의 라인이 필요합니다."); }
  status(`[parse] rows=${rows.length}`);
  return rows;
}

function makeFrequencyAxis(nPoints) {
  const half = Math.floor(nPoints / 2);
  const out = new Array(half);
  for (let k = 0; k < half; k++) out[k] = k; // 데이터는 인덱스 좌표 유지
  return out;
}

function applyAxes(ch, freq, values, opts = {}) {
  const xl = (document.getElementById('xLabel')?.value || 'Index');
  const yl = (document.getElementById('yLabel')?.value || 'Amplitude');
  const y2l = (document.getElementById('y2Label')?.value || 'Amplitude 2');
  const xminDisp = parseFloat(document.getElementById('xMin')?.value);
  const xmaxDisp = parseFloat(document.getElementById('xMax')?.value);
  const yminDisp = parseFloat(document.getElementById('yMin')?.value);
  const ymaxDisp = parseFloat(document.getElementById('yMax')?.value);
  const y2minDisp = parseFloat(document.getElementById('y2Min')?.value);
  const y2maxDisp = parseFloat(document.getElementById('y2Max')?.value);
  const xTickScale = parseFloat(document.getElementById('xScale')?.value) || 1;
  const yTickScale = parseFloat(document.getElementById('yScale')?.value) || 1;
  const y2TickScale = parseFloat(document.getElementById('y2Scale')?.value) || 1;

  const xScale = { type: 'linear', title: { display: !document.getElementById('keepX')?.checked, text: xl }, ticks: { callback: (v)=> (v * xTickScale).toFixed(0) } };
  if (Number.isFinite(xminDisp)) xScale.min = xminDisp;
  if (Number.isFinite(xmaxDisp)) xScale.max = xmaxDisp;

  const keepY1 = !!document.getElementById('keepY1')?.checked;
  const keepY2 = !!document.getElementById('keepY2')?.checked;

  const yScale = { title: { display: !keepY1, text: yl }, ticks: { callback: (v)=> (v * yTickScale).toFixed(0) } };
  if (Number.isFinite(yminDisp)) yScale.min = yminDisp;
  if (Number.isFinite(ymaxDisp)) yScale.max = ymaxDisp;

  const y2Scale = { position: 'right', grid: { drawOnChartArea: false }, title: { display: !keepY2, text: y2l }, ticks: { callback: (v)=> (v * y2TickScale).toFixed(0) } };
  if (Number.isFinite(y2minDisp)) y2Scale.min = y2minDisp;
  if (Number.isFinite(y2maxDisp)) y2Scale.max = y2maxDisp;
  if (!keepY2 && opts.y2Min !== undefined) y2Scale.min = opts.y2Min;
  if (!keepY2 && opts.y2Max !== undefined) y2Scale.max = opts.y2Max;

  ch.options.scales = { x: xScale, y: yScale, y2: y2Scale };
}

function refreshDatasetSelect() {
  const sel1 = document.getElementById('datasetSelect');
  const sel2 = document.getElementById('datasetSelect2');
  if (!sel1 && !sel2) return;
  const prev1 = sel1 ? sel1.value : null;
  const prev2 = sel2 ? sel2.value : null;
  const fill = (sel) => {
    if (!sel) return;
    sel.innerHTML = '';
    datasetList.forEach((d) => {
      const opt = document.createElement('option');
      opt.value = d.id; opt.textContent = `${d.id}: ${d.caption}`; sel.appendChild(opt);
    });
  };
  fill(sel1); fill(sel2);
  // restore selection if still present
  const hasId = (id) => !!datasetList.find(d => d.id === id);
  if (sel1) {
    if (prev1 && hasId(prev1)) sel1.value = prev1;
    else if (sel1.options.length) sel1.selectedIndex = sel1.options.length - 1; // default latest
  }
  if (sel2) {
    if (prev2 && hasId(prev2)) sel2.value = prev2;
    else if (sel2.options.length >= 2) sel2.selectedIndex = sel2.options.length - 2; // default previous
  }
}

function rebuildDatasetsFromTerminal() {
  const text = document.getElementById('terminal').textContent || '';
  const lines = text.split(/\n+/);
  const capRe = /^\[Plot_(\d{4}):\s*(.*?)\]\s*$/;
  let current = null; // {id, caption}
  let buffer = '';
  datasetList = [];
  datasetCounter = 0;
  streamBuffer = '';
  for (let i = 0; i < lines.length; i++) {
    const L = (lines[i]||'').trim();
    const m = L.match(capRe);
    if (m) { current = { id: `Plot_${m[1]}`, caption: m[2] }; continue; }
    if (L.includes('DataStart') || L.includes('DataEnd') || /,/.test(L)) {
      buffer += (buffer ? '\n' : '') + L; // accumulate contiguous lines if any
      // When DataEnd appears, finalize
      if (L.includes('DataEnd')) {
        const s = buffer.indexOf('DataStart');
        const e = buffer.lastIndexOf('DataEnd');
        if (s >= 0 && e > s) {
          const payload = buffer.substring(s + 'DataStart'.length + 1, e).replace(/\s+/g,'');
          const parts = payload.split(',').filter(Boolean);
          const values = parts.map(x=>Number(x)).filter(Number.isFinite);
          const id = current && current.id ? current.id : `Plot_${String(datasetCounter).padStart(4,'0')}`;
          const caption = current && current.caption ? current.caption : 'Dataset';
          datasetList.push({ id, caption, values });
          datasetCounter = Math.max(datasetCounter, parseInt(id.slice(-4),10)+1);
        }
        buffer = '';
        current = null;
      }
    } else {
      buffer = '';
    }
  }
  refreshDatasetSelect();
}

function plotFromDataset() {
  const sel1 = document.getElementById('datasetSelect');
  const sel2 = document.getElementById('datasetSelect2');
  const id1 = sel1 && sel1.value;
  const id2 = sel2 && sel2.value;
  if (!id1 && !id2) { alert('데이터셋을 선택하세요.'); return; }
  const ds1 = id1 ? datasetList.find(d => d.id === id1) : null;
  const ds2 = id2 ? datasetList.find(d => d.id === id2) : null;
  if (!ds1 && !ds2) { alert('선택한 데이터셋을 찾을 수 없습니다.'); return; }
  const isTime = (d)=> !!d && /^TIME_/i.test(String(d.caption||''));
  const full = isTime(ds1) || isTime(ds2);
  try { console.debug('[webterm] plotFromDataset', { id1, id2, fullForTime: full, len1: ds1?.values?.length, len2: ds2?.values?.length }); } catch(_) {}
  plotMagnitudeDual(ds1 ? ds1.values : null, ds2 ? ds2.values : null, { fullForTime: full });
  try { autoScaleAxes(); } catch(_) {}
}

function autoScaleAxes() {
  if (!chart) return;
  try {
    const d0 = chart.data.datasets[0] || null;
    const d1 = chart.data.datasets[1] || null;
    const keepX  = !!document.getElementById('keepX')?.checked;
    const keepY1 = !!document.getElementById('keepY1')?.checked;
    const keepY2 = !!document.getElementById('keepY2')?.checked;

    const xs = (d0?.data || d1?.data || []).map(p => p.x).filter(Number.isFinite);
    if (!xs.length) return;
    const xmin = Math.min(...xs), xmax = Math.max(...xs);

    const getYBounds = (ds) => {
      if (!ds) return [undefined, undefined];
      const ys = (ds.data||[]).map(p=>p.y).filter(Number.isFinite);
      if (!ys.length) return [undefined, undefined];
      const min = Math.min(...ys), max = Math.max(...ys);
      const pad = (max - min) * 0.05; // 동일 퍼센티지 적용
      return [min - pad, max + pad];
    };
    const [ymin1, ymax1] = getYBounds(d0);
    const [ymin2, ymax2] = getYBounds(d1);

    // 업데이트는 유지 체크가 해제된 축만 수행
    if (!keepY1) {
      if (ymin1!==undefined) document.getElementById('yMin').value = ymin1.toFixed(3);
      if (ymax1!==undefined) document.getElementById('yMax').value = ymax1.toFixed(3);
    }
    if (!keepY2) {
      if (ymin2!==undefined) document.getElementById('y2Min').value = ymin2.toFixed(3);
      if (ymax2!==undefined) document.getElementById('y2Max').value = ymax2.toFixed(3);
    }
    if (!keepX) {
      document.getElementById('xMin').value = xmin.toFixed(3);
      document.getElementById('xMax').value = xmax.toFixed(3);
    }

    const opts = {};
    if (!keepY2) { opts.y2Min = ymin2; opts.y2Max = ymax2; }
    applyAxes(chart, xs, null, opts);
    chart.update();
  } catch (e) { try { console.error('[autoScale] error', e); } catch(_) {} }
}

function plotMagnitudeArray(values) {
  // If selected dataset is TIME_*, don't halve the array
  const sel = document.getElementById('datasetSelect');
  const selectedId = sel && sel.value;
  const isTime = (()=>{
    if (!selectedId) return false;
    const ds = datasetList.find(d=>d.id===selectedId);
    const cap = ds && ds.caption ? String(ds.caption) : '';
    return /^TIME_/i.test(cap);
  })();
  plotMagnitudeDual(values, null, { fullForTime: isTime });
}

function notifyChartUpdated() {
  try { window.dispatchEvent(new CustomEvent('webterm:chart-updated')); } catch(_) {}
}

function plotMagnitudeDual(values1, values2, opts = {}) {
  const ctx = document.getElementById('chart').getContext('2d');
  const ch = ensureChart(ctx);
  const makeMaybeHalf = (arr) => {
    if (!arr) return [];
    if (opts && opts.fullForTime) return arr.slice();
    const N = arr.length;
    const half = Math.floor(N/2);
    return arr.slice(0, half);
  };
  const v1 = makeMaybeHalf(values1);
  const v2 = makeMaybeHalf(values2);
  const N = (opts && opts.fullForTime) ? Math.max(values1?.length||0, values2?.length||0) : Math.max(v1.length, v2.length) * 2; // 추정 원본 길이
  const freq = (opts && opts.fullForTime)
    ? Array.from({ length: v1.length }, (_, i) => i)
    : makeFrequencyAxis(N);
  try { console.debug('[webterm] plotMagnitudeDual', { fullForTime: !!(opts&&opts.fullForTime), v1: v1.length, v2: v2.length, N }); } catch(_) {}

  ch.data.labels = [];
  const ds = [];
  if (v1.length) {
    ds.push({ label: 'Ch1', yAxisID: 'y', data: v1.map((y,i)=>({x:freq[i],y:y})), parsing:false, borderColor:'#2ca02c', pointRadius:0, tension:0, spanGaps:true, showLine:true });
  }
  if (v2.length) {
    ds.push({ label: 'Ch2', yAxisID: 'y2', data: v2.map((y,i)=>({x:freq[i],y:y})), parsing:false, borderColor:'#ff7f0e', pointRadius:0, tension:0, spanGaps:true, showLine:true });
  }
  ch.data.datasets = ds;
  ch.options.plugins.legend.display = true;

  // 이벤트로 분석 갱신 통지
  notifyChartUpdated();

  // autoscale per axis
  const ys1 = v1.filter(Number.isFinite);
  const ys2 = v2.filter(Number.isFinite);
  const xs = (ds[0]?.data || []).map(p=>p.x);
  const y1min = ys1.length ? Math.min(...ys1) : undefined;
  const y1max = ys1.length ? Math.max(...ys1) : undefined;
  const y2min = ys2.length ? Math.min(...ys2) : undefined;
  const y2max = ys2.length ? Math.max(...ys2) : undefined;
  const padPct = 0.05; // 동일 퍼센티지 사용
  const pad = (min,max)=>{ const d=(max-min)*padPct; return [min-d, max+d]; };
  const [yy1min, yy1max] = (y1min!==undefined&&y1max!==undefined) ? pad(y1min,y1max) : [undefined, undefined];
  const [yy2min, yy2max] = (y2min!==undefined&&y2max!==undefined) ? pad(y2min,y2max) : [undefined, undefined];

  const keepY1 = !!document.getElementById('keepY1')?.checked;
  const keepY2 = !!document.getElementById('keepY2')?.checked;

  const axesOpts = {};
  if (!keepY2) { axesOpts.y2Min = yy2min; axesOpts.y2Max = yy2max; }
  applyAxes(ch, xs, v1, axesOpts);

  // 입력칸 업데이트는 유지가 꺼져 있을 때만
  if (!keepY1) {
    if (yy1min!==undefined) document.getElementById('yMin').value = yy1min.toFixed(3);
    if (yy1max!==undefined) document.getElementById('yMax').value = yy1max.toFixed(3);
  }
  if (!keepY2) {
    if (yy2min!==undefined) document.getElementById('y2Min').value = yy2min.toFixed(3);
    if (yy2max!==undefined) document.getElementById('y2Max').value = yy2max.toFixed(3);
  }

  ch.update();
  notifyChartUpdated();
}

function initPlaceholderPlot() {
  try {
    const ctx = document.getElementById('chart').getContext('2d');
    const ch = ensureChart(ctx);
    const N = 1024;
    const zeros = new Array(N).fill(0);
    plotMagnitudeArray(zeros);
    const ps = document.getElementById('plotStatus'); if (ps) ps.textContent = '플롯 준비됨 (placeholder)';
  } catch (_) {}
}

function ensureChart(ctx) {
  if (chart) return chart;
  chart = new Chart(ctx, {
    type: 'line',
    data: { labels: [], datasets: [] },
    options: {
      responsive: true,
      animation: false,
      parsing: false,
      spanGaps: true,
      interaction: { mode: 'nearest', intersect: false },
      plugins: { legend: { display: false }, tooltip: { enabled: true, callbacks: { title(items){ try { const xs = parseFloat(document.getElementById('xScale')?.value)||1; const x = (items && items.length && items[0].parsed && Number.isFinite(items[0].parsed.x)) ? items[0].parsed.x : undefined; return (x!==undefined) ? (x*xs).toFixed(3) : ''; } catch(_) { return ''; } }, label(ctx){ try { const axisId = ctx.dataset.yAxisID || 'y'; const y1s = parseFloat(document.getElementById('yScale')?.value)||1; const y2s = parseFloat(document.getElementById('y2Scale')?.value)||1; const scale = axisId === 'y2' ? y2s : y1s; const y = (ctx && ctx.parsed && Number.isFinite(ctx.parsed.y)) ? ctx.parsed.y : undefined; return (y!==undefined) ? (y*scale).toFixed(3) : ''; } catch(_) { return ''; } } } }, },
      maintainAspectRatio: false,
      scales: {
        x: { type: 'linear', title: { display: true, text: 'Index' } },
        y: { title: { display: true, text: 'Amplitude' } },
        y2: { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'Amplitude 2' } }
      }
    }
  });
  return chart;
}

function plotHere() {
  // 최신 데이터셋에서 magnitude만 플롯
  const status = (msg) => { try { console.log(msg); } catch(_) {} try { const el=document.getElementById('plotStatus'); if (el) el.textContent = msg; } catch(_) {} };
  let rows;
  try { rows = parseFftLinesFromTerminal(); }
  catch (e) { status('[plot] parse error: ' + (e.message||e)); alert(e.message || String(e)); return; }

  // 인덱스를 기준으로 재배열하여 누락 인덱스는 NaN으로 채움
  const maxIdx = rows.reduce((m, r) => Math.max(m, r[0]), -1);
  const N = maxIdx + 1;
  const real = new Array(N).fill(NaN);
  const imag = new Array(N).fill(NaN);
  const mag  = new Array(N).fill(NaN);
  for (const [idx, r, i, m] of rows) {
    if (idx >= 0 && idx < N) { real[idx] = r; imag[idx] = i; mag[idx] = m; }
  }

  const freq = makeFrequencyAxis(N);

  const ctx = document.getElementById('chart').getContext('2d');
  const ch = ensureChart(ctx);
  const half = Math.floor(N/2);
  const magHalf  = mag.slice(0, half).map(v => Number.isFinite(v) ? +v : NaN);

  ch.data.labels = [];
  const yScale = parseFloat(document.getElementById('yScale')?.value) || 1;
  ch.data.datasets = [{ label: '', data: magHalf.map((y,i)=>({x:freq[i],y:y})), parsing:false, borderColor:'#2ca02c', pointRadius:0, tension:0, spanGaps:true, showLine:true }];
  ch.options.plugins.legend.display = false;
  applyAxes(ch, freq, magHalf);
  ch.update();
}

function plotInNewWindow() {
  let rows;
  try { rows = parseFftLinesFromTerminal(); }
  catch (e) { alert(e.message || String(e)); return; }
  const N = rows.length;
  const Fs = Number(document.getElementById('fs').value);
  if (!(Number.isFinite(Fs) && Fs > 0)) { alert('샘플링 레이트(Fs)를 올바르게 입력하세요.'); return; }
  const freq = makeFrequencyAxis(Fs, N);
  const real = rows.map(r => r[1]).slice(0, Math.floor(N/2));
  const imag = rows.map(r => r[2]).slice(0, Math.floor(N/2));
  const mag  = rows.map(r => r[3]).slice(0, Math.floor(N/2));
  const showReal = document.getElementById('showReal').checked;
  const showImag = document.getElementById('showImag').checked;
  const showMag  = document.getElementById('showMag').checked;
  const win = window.open('', '_blank');
  if (!win) { alert('팝업이 차단되었습니다. 새창 허용 후 다시 시도하세요.'); return; }
  const tpl = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FFT Plot</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"><\/script></head><body>
  <h3 style="font-family:Arial, sans-serif; margin:12px 16px;">FFT Plot</h3>
  <div style="padding:0 16px;">
  <canvas id="c" height="240"></canvas>
  </div>
  <script>
  const labels = ${JSON.stringify(freq)};
  const real = ${JSON.stringify(real)};
  const imag = ${JSON.stringify(imag)};
  const mag  = ${JSON.stringify(mag)};
  const showReal = ${JSON.stringify(showReal)};
  const showImag = ${JSON.stringify(showImag)};
  const showMag  = ${JSON.stringify(showMag)};
  const ctx = document.getElementById('c').getContext('2d');
  const ds = [];
  if (showReal) ds.push({ label: 'Real', data: real, borderColor: '#1f77b4', pointRadius: 0, tension: 0 });
  if (showImag) ds.push({ label: 'Imag', data: imag, borderColor: '#ff7f0e', pointRadius: 0, tension: 0 });
  if (showMag)  ds.push({ label: 'Magnitude', data: mag, borderColor: '#2ca02c', pointRadius: 0, tension: 0 });
  new Chart(ctx, { type:'line', data:{ labels, datasets: ds }, options:{ responsive:true, animation:false, parsing:false, scales:{ x:{ title:{ display:true, text:'Frequency (MHz)'} }, y:{ title:{ display:true, text:'Amplitude'} } } } });
  <\/script>
  </body></html>`;
  win.document.open();
  win.document.write(tpl);
  win.document.close();
}

function copyTerminal() {
  const text = document.getElementById('terminal').textContent || '';
  navigator.clipboard.writeText(text).then(()=>setStatus('터미널 복사 완료')).catch(()=>alert('복사 실패'));
}
function importTerminal() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.txt,.log,.csv,text/plain';
  input.onchange = async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const text = await file.text();
    appendTerm(text);
    streamBuffer += text;
    tryExtractDatasetsFromBuffer();
    refreshDatasetSelect();
  };
  input.click();
}

function saveTerminal() {
  const text = document.getElementById('terminal').textContent || '';
  const blob = new Blob([text], {type:'text/plain'});
  const a = document.createElement('a');
  const ts = new Date().toISOString().replace(/[:.]/g,'-');
  a.href = URL.createObjectURL(blob);
  a.download = `web-terminal-${ts}.txt`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setStatus('터미널 저장 완료');
}

function saveVizToFile() {
  const lines = [];
  const pushKV = (k, v) => lines.push(`${k}=${v}`);
  pushKV('xLabel', document.getElementById('xLabel')?.value || '');
  pushKV('xMin', document.getElementById('xMin')?.value || '');
  pushKV('xMax', document.getElementById('xMax')?.value || '');
  pushKV('xScale', document.getElementById('xScale')?.value || '1');
  pushKV('yLabel', document.getElementById('yLabel')?.value || '');
  pushKV('yMin', document.getElementById('yMin')?.value || '');
  pushKV('yMax', document.getElementById('yMax')?.value || '');
  pushKV('yScale', document.getElementById('yScale')?.value || '1');
  pushKV('y2Label', document.getElementById('y2Label')?.value || '');
  pushKV('y2Min', document.getElementById('y2Min')?.value || '');
  pushKV('y2Max', document.getElementById('y2Max')?.value || '');
  pushKV('y2Scale', document.getElementById('y2Scale')?.value || '1');
  const blob = new Blob([lines.join('\n') + '\n'], {type:'text/plain'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'webterm_viz.txt';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}
function loadVizFromFile() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.txt,text/plain';
  input.onchange = async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const text = await file.text();
    const map = {};
    text.split(/\r?\n/).forEach(line => {
      const m = line.match(/^\s*([a-zA-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) map[m[1]] = m[2];
    });
    const setIf = (id, key) => { if (map[key] !== undefined) document.getElementById(id).value = map[key]; };
    setIf('xLabel','xLabel'); setIf('xMin','xMin'); setIf('xMax','xMax'); setIf('xScale','xScale');
    setIf('yLabel','yLabel'); setIf('yMin','yMin'); setIf('yMax','yMax'); setIf('yScale','yScale');
    setIf('y2Label','y2Label'); setIf('y2Min','y2Min'); setIf('y2Max','y2Max'); setIf('y2Scale','y2Scale');
    if (chart) { plotFromDataset(); }
  };
  input.click();
}

function saveVizSettings() {
  const s = {
    xLabel: document.getElementById('xLabel')?.value || '',
    xMin: document.getElementById('xMin')?.value || '',
    xMax: document.getElementById('xMax')?.value || '',
    xScale: document.getElementById('xScale')?.value || '1',
    xOffset: document.getElementById('xOffset')?.value || '0',
    yLabel: document.getElementById('yLabel')?.value || '',
    yMin: document.getElementById('yMin')?.value || '',
    yMax: document.getElementById('yMax')?.value || ''
  };
  try { localStorage.setItem('webterm_viz', JSON.stringify(s)); } catch(_) {}
}
function loadVizSettings() { /* 로컬스토리지 사용 제거 - no-op */ }

function downloadHeaders() {
  const readme = `WebTerminal 사용 가이드 (Vitis/Zynq)

1) 파일 복사
- WebTerminal.h, WebTerminal.c를 Vitis 프로젝트의 src 폴더에 추가합니다.
- main.cpp에서 "WebTerminal.h"를 include 하세요.

2) 빌드 설정
- 추가 설정은 필요 없습니다. UART 출력(xil_printf)이 활성화되어 있어야 합니다.

3) 사용 방법
- 배열에 데이터(예: FFT magnitude)를 채운 뒤 WebTerm_PrintDataset을 호출합니다.

  #include "WebTerminal.h"\n  int32_t mag[1024];\n  // ... mag 채우기 ...\n  WebTerm_PrintDataset("ADC1/Q2 FFT", mag, 1024);

- 출력 포맷(웹과 연동):
  [Plot_XXXX: Caption]\r\n
  DataStart,1,2,3,...,N,DataEnd\r\n
- 카운터를 초기화하려면 부팅 시 또는 필요 시 WebTerm_ResetCounter()를 호출합니다.

4) 웹 측 사용
- 페이지 상단에서 헤더 파일을 다운로드하여 펌웨어에 반영합니다.
- 브라우저에서 연결 → 명령 전송(예: 4) → 데이터셋 콤보에서 Plot_XXXX 선택 후 플롯.

5) 팁
- 긴 라인 전송은 .c 내부에서 안전하게 청크로 처리됩니다.
- 캡션은 콤보박스에 그대로 반영되므로 구분 가능한 설명을 사용하세요.
`;

  const h = `#pragma once\n#include <stdint.h>\n#include <stddef.h>\n#ifdef __cplusplus\nextern \"C\" {\n#endif\nvoid WebTerm_ResetCounter(void);\nvoid WebTerm_PrintDataset(const char* caption, const int32_t* data, size_t length);\n#ifdef __cplusplus\n}\n#endif\n`;
  const c = `#include \"WebTerminal.h\"\n#include \"xil_printf.h\"\nstatic uint32_t g_plotCounter=0;\nvoid WebTerm_ResetCounter(void){g_plotCounter=0;}\nstatic void WebTerm_PrintCommaSeparated(const int32_t* data, size_t length){const size_t chunk=64;size_t idx=0;while(idx<length){size_t end=idx+chunk; if(end>length) end=length; for(size_t i=idx;i<end;++i){xil_printf(\"%d\",data[i]); if(i!=length-1) xil_printf(\",\");} idx=end;}}\nvoid WebTerm_PrintDataset(const char* caption,const int32_t* data,size_t length){xil_printf(\"[Plot_%04lu: %s]\\r\\n\",(unsigned long)g_plotCounter,(caption?caption:\"\"));xil_printf(\"DataStart,\");WebTerm_PrintCommaSeparated(data,length);xil_printf(\",DataEnd\\r\\n\");g_plotCounter++;}\n`;
  const save = (name, content) => { const blob = new Blob([content], {type:'text/plain'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; document.body.appendChild(a); a.click(); document.body.removeChild(a); };
  save('WebTerminal.h', h); save('WebTerminal.c', c); save('WebTerminal_README.txt', readme);
}

window.addEventListener('DOMContentLoaded', () => {
  // 포트 콤보 이벤트 제거
  document.getElementById('btnRequest').addEventListener('click', requestPort);
  document.getElementById('btnConnect').addEventListener('click', connect);
  document.getElementById('btnDisconnect').addEventListener('click', disconnect);
  document.getElementById('btnClear').addEventListener('click', clearTerminal);
  document.getElementById('btnCopy').addEventListener('click', copyTerminal);
  document.getElementById('btnSave').addEventListener('click', saveTerminal);
  document.getElementById('btnImport').addEventListener('click', importTerminal);
  document.getElementById('editableToggle').addEventListener('change', (e)=>{
    const term = document.getElementById('terminal');
    term.contentEditable = e.target.checked ? 'true' : 'false';
    // 콘텐츠 편집 후 데이터셋 목록 재구성
    if (!e.target.checked) rebuildDatasetsFromTerminal();
  });
  document.getElementById('btnSend').addEventListener('click', sendText);
  const syncAutoPlot = (checked)=>{ try { const a=document.getElementById('autoPlot'); if(a) a.checked=!!checked; } catch(_){} };
  const apFloat = document.getElementById('autoPlotFloating');
  if (apFloat) apFloat.addEventListener('change', (e)=>{ syncAutoPlot(e.target.checked); });
  const apHidden = document.getElementById('autoPlot');
  if (apHidden) apHidden.addEventListener('change', (e)=>{ if(apFloat) apFloat.checked = e.target.checked; });
  document.getElementById('btnAutoScale').addEventListener('click', autoScaleAxes);
  const reapply = ()=>{ if(chart){ applyAxes(chart, chart.data?.datasets?.[0]?.data?.map(p=>p.x) || [], null); chart.update(); } };
  document.getElementById('xLabel').addEventListener('change', reapply);
  document.getElementById('yLabel').addEventListener('change', reapply);
  document.getElementById('y2Label').addEventListener('change', reapply);
  document.getElementById('xMin').addEventListener('change', reapply);
  document.getElementById('xMax').addEventListener('change', reapply);
  document.getElementById('yMin').addEventListener('change', reapply);
  document.getElementById('yMax').addEventListener('change', reapply);
  document.getElementById('y2Min').addEventListener('change', reapply);
  document.getElementById('y2Max').addEventListener('change', reapply);
  const onScaleInput = ()=>{ reapply(); autoScaleAxes(); };
  document.getElementById('xScale').addEventListener('change', onScaleInput);
  document.getElementById('yScale').addEventListener('change', onScaleInput);
  document.getElementById('y2Scale').addEventListener('change', onScaleInput);
  document.getElementById('xScale').addEventListener('input', onScaleInput);
  document.getElementById('yScale').addEventListener('input', onScaleInput);
  document.getElementById('y2Scale').addEventListener('input', onScaleInput);
  document.getElementById('btnSaveViz').addEventListener('click', saveVizToFile);
  document.getElementById('btnLoadViz').addEventListener('click', loadVizFromFile);
  const analyzeNow = ()=>{
    try {
      const d0 = chart?.data?.datasets?.[0]?.data || [];
      const d1 = chart?.data?.datasets?.[1]?.data || [];
      const getStats = (arr)=>{
        const ys = arr.map(p=>p.y).filter(Number.isFinite);
        if (!ys.length) return {min: NaN, max: NaN, offset: NaN};
        const min = Math.min(...ys); const max = Math.max(...ys);
        const offset = (min + max) / 2;
        return {min, max, offset};
      };
      const s1 = getStats(d0), s2 = getStats(d1);
      const set = (id,v)=>{ const el=document.getElementById(id); if (el) el.value = Number.isFinite(v) ? v.toFixed(3) : ''; };
      set('anCh1Max', s1.max); set('anCh1Min', s1.min); set('anCh1Offset', s1.offset);
      set('anCh2Max', s2.max); set('anCh2Min', s2.min); set('anCh2Offset', s2.offset);
    } catch (e) { try { console.error('[analyze] error', e); } catch(_) {} }
  };
  const ba = document.getElementById('btnAnalyze'); if (ba) ba.addEventListener('click', analyzeNow);
  document.getElementById('downloadHeaders').addEventListener('click', (e)=>{ e.preventDefault(); downloadHeaders(); });

  // 섹션 접기/펼치기
  const bindToggle = (btnId, secId) => {
    const b = document.getElementById(btnId);
    const s = document.getElementById(secId);
    if (!b || !s) return;
    b.addEventListener('click', () => {
      s.classList.toggle('collapsed');
      b.textContent = s.classList.contains('collapsed') ? '펼치기' : '접기';
    });
  };
  bindToggle('tg-connect','sec-connect');
  bindToggle('tg-terminal','sec-terminal');
  bindToggle('tg-plot','sec-plot');
  bindToggle('tg-analysis','sec-analysis');

  // 초기 placeholder 그래프 그리기
  initPlaceholderPlot();
  // 초기 축 범위/라벨 설정 적용
  try { const ch = chart; if (ch) { applyAxes(ch, [], []); ch.update(); } } catch(_) {}
  document.getElementById('btnPlotSelected').addEventListener('click', () => plotFromDataset());
  // 설정 로드
  loadVizSettings();
  const tx = document.getElementById('tx');
  tx.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && document.getElementById('enterSend').checked) {
      ev.preventDefault();
      sendText();
    }
  });
});
