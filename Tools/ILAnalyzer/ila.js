// ILAnalyzer - Vivado ILA 데이터 분석 도구
let charts = new Map(); // 신호별 Chart 인스턴스 저장
let parsedData = null;
let signals = [];
let selectedSignals = new Set();
let currentRadix = {};
let signalRadixSettings = new Map(); // 신호별 Radix 설정 {inputRadix, outputRadix, plotType}
let busSplits = new Map(); // 신호별 버스 분리 정보 {originalSignal, splits: [{name, bits}]}
let cursorMarkers = new Map(); // 신호별 커서 마커 정보 {signalName: {cursor1: {x, y}, cursor2: {x, y}}}
let cursorTooltipEnabled = true; // 커서 툴팁 활성화 여부

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  registerCursorCaptionPlugin();
  initDragAndDrop();
  initFileInput();
  initToggles();
  initSignalControls();
  initWaveformControls();
  initSettings();
  initGlobalCursor();
  initEscKeyListener();
});

// Initialize drag and drop
function initDragAndDrop() {
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');

  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, preventDefaults, false);
    document.body.addEventListener(eventName, preventDefaults, false);
  });

  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => {
      dropZone.classList.add('dragover');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => {
      dropZone.classList.remove('dragover');
    }, false);
  });

  dropZone.addEventListener('drop', handleDrop, false);
  dropZone.addEventListener('click', () => fileInput.click(), false);
}

function preventDefaults(e) {
  e.preventDefault();
  e.stopPropagation();
}

function handleDrop(e) {
  const dt = e.dataTransfer;
  const files = dt.files;
  if (files.length > 0) {
    handleFile(files[0]);
  }
}

// Initialize file input
function initFileInput() {
  const fileInput = document.getElementById('fileInput');
  const btnSelectFile = document.getElementById('btnSelectFile');

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFile(e.target.files[0]);
    }
  });

  btnSelectFile.addEventListener('click', () => {
    fileInput.click();
  });
}

// Handle file
async function handleFile(file) {
  if (!file.name.toLowerCase().endsWith('.csv')) {
    setFileStatus('CSV 파일만 지원됩니다.', 'error');
    return;
  }

  setFileStatus('파일 읽는 중...');
  try {
    const text = await file.text();
    parseCSV(text);
    setFileStatus(`파일 로드 완료: ${file.name} (${signals.length}개 신호, ${parsedData.length}개 샘플)`);
  } catch (e) {
    setFileStatus('파일 읽기 실패: ' + e.message, 'error');
    console.error(e);
  }
}

function setFileStatus(message, type = '') {
  const status = document.getElementById('fileStatus');
  status.textContent = message;
  status.className = 'status' + (type ? ' ' + type : '');
}

// Parse CSV
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 3) {
    throw new Error('CSV 파일 형식이 올바르지 않습니다. 최소 3줄 (헤더, Radix, 데이터)이 필요합니다.');
  }

  // Parse header (line 1)
  const headerLine = lines[0];
  const headers = parseCSVLine(headerLine);
  
  // Parse Radix (line 2)
  const radixLine = lines[1];
  const radixValues = parseCSVLine(radixLine);
  
  // Remove "Radix - " prefix if present
  const radixes = radixValues.map(r => {
    const cleaned = r.replace(/^Radix\s*-\s*/i, '').trim().toUpperCase();
    return cleaned;
  });

  // Parse data (lines 3+)
  const dataRows = [];
  for (let i = 2; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length === headers.length) {
      dataRows.push(values);
    }
  }

  // Build signals array
  signals = [];
  currentRadix = {};
  
  for (let i = 0; i < headers.length; i++) {
    const name = headers[i];
    const radix = radixes[i] || 'UNSIGNED';
    
    // Skip system columns
    if (name === 'Sample in Buffer' || name === 'Sample in Window' || name === 'TRIGGER') {
      continue;
    }

    // Parse signal data based on radix
    const values = dataRows.map(row => {
      const rawValue = row[i];
      return parseValue(rawValue, radix);
    });

    signals.push({
      name: name,
      radix: radix,
      values: values,
      rawValues: dataRows.map(row => row[i])
    });
    
    currentRadix[name] = radix;
  }

  // Store parsed data for x-axis
  parsedData = dataRows.map((row, idx) => ({
    sampleInWindow: parseInt(row[1] || idx, 10),
    trigger: parseInt(row[2] || 0, 10),
    rawRow: row
  }));

  // Update UI
  updateSignalList();
  updateRadixSelect();
}

function parseCSVLine(line) {
  // Simple CSV parser (handles quoted strings)
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function parseValue(rawValue, radix) {
  const value = String(rawValue).trim();
  
  if (radix === 'HEX') {
    // Try to parse hex as number for display, but keep original string
    const num = parseInt(value, 16);
    return isNaN(num) ? 0 : num;
  } else if (radix === 'SIGNED') {
    return parseInt(value, 10);
  } else if (radix === 'UNSIGNED') {
    return parseInt(value, 10);
  } else {
    // Default: try to parse as number
    const num = parseFloat(value);
    return isNaN(num) ? 0 : num;
  }
}

// Convert value based on radix (for output display)
function convertValue(val, radix, rawValue) {
  if (radix === 'FLOAT32') {
    // 32-bit float 변환
    try {
      // HEX 문자열에서 정수로 변환
      const cleanHex = String(rawValue || '0').replace(/^0x/, '').padStart(8, '0');
      const intVal = parseInt(cleanHex.substring(0, 8), 16);
      const buffer = new ArrayBuffer(4);
      const view = new DataView(buffer);
      view.setUint32(0, intVal, true); // Little-endian
      return view.getFloat32(0, true);
    } catch (e) {
      return val;
    }
  } else if (radix === 'FLOAT64') {
    // 64-bit float 변환
    try {
      // HEX 문자열에서 BigInt로 변환
      const cleanHex = String(rawValue || '0').replace(/^0x/, '').padStart(16, '0');
      const intVal = BigInt('0x' + cleanHex.substring(0, 16));
      const buffer = new ArrayBuffer(8);
      const view = new DataView(buffer);
      view.setBigUint64(0, intVal, true); // Little-endian
      return view.getFloat64(0, true);
    } catch (e) {
      return val;
    }
  } else if (radix === 'HEX') {
    return parseInt(rawValue || '0', 16);
  } else if (radix === 'SIGNED') {
    return parseInt(rawValue || '0', 10);
  } else if (radix === 'UNSIGNED') {
    return parseInt(rawValue || '0', 10);
  } else {
    return val;
  }
}

// Update signal list
function updateSignalList() {
  const signalList = document.getElementById('signalList');
  signalList.innerHTML = '';

  if (signals.length === 0) {
    signalList.innerHTML = '<p class="small" style="color:#666; margin:8px;">신호가 없습니다.</p>';
    return;
  }

  signals.forEach((signal, index) => {
    const item = document.createElement('div');
    item.className = 'signal-item';
    item.dataset.signalIndex = index;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `signal-${index}`;
    checkbox.checked = selectedSignals.has(signal.name);
    checkbox.addEventListener('change', (e) => {
      if (e.target.checked) {
        selectedSignals.add(signal.name);
        // Update radix select when signal is selected
        const radixSelect = document.getElementById('selectedSignalRadix');
        if (radixSelect && selectedSignals.size === 1) {
          radixSelect.value = signal.name;
          updateSignalValueDisplay(signal);
          updateRadixSettings(signal);
        }
      } else {
        selectedSignals.delete(signal.name);
      }
      item.classList.toggle('selected', e.target.checked);
      updateNewBusButton();
      updateWaveform();
    });

    const nameSpan = document.createElement('span');
    nameSpan.className = 'signal-name';
    nameSpan.textContent = signal.name;
    nameSpan.title = signal.name;

    const valueSpan = document.createElement('span');
    valueSpan.className = 'signal-value';
    updateSignalValue(valueSpan, signal);

    item.appendChild(checkbox);
    item.appendChild(nameSpan);
    item.appendChild(valueSpan);

    // 행 전체 클릭 시 체크박스 토글 (체크박스 자체 클릭은 제외)
    item.addEventListener('click', (e) => {
      // 체크박스 자체를 클릭한 경우는 제외 (이미 change 이벤트가 발생함)
      if (e.target === checkbox || e.target.tagName === 'INPUT') {
        return;
      }
      
      // 신호명, 데이터 값, 행의 빈 공간 클릭 시 체크박스 토글
      checkbox.checked = !checkbox.checked;
      checkbox.dispatchEvent(new Event('change'));
      
      // Update selected signal in radix select
      if (checkbox.checked) {
        const radixSelect = document.getElementById('selectedSignalRadix');
        if (radixSelect && selectedSignals.size === 1) {
          radixSelect.value = signal.name;
          updateSignalValueDisplay(signal);
          updateRadixSettings(signal);
        }
      }
    });

    if (selectedSignals.has(signal.name)) {
      item.classList.add('selected');
    }

    signalList.appendChild(item);
  });
}

function updateSignalValue(span, signal) {
  if (!parsedData || parsedData.length === 0) return;
  
  const lastIndex = parsedData.length - 1;
  const lastValue = signal.values[lastIndex];
  const lastRawValue = signal.rawValues[lastIndex];
  
  if (signal.radix === 'HEX') {
    span.textContent = lastRawValue || '0';
  } else {
    span.textContent = String(lastValue);
  }
}

// Update waveform - 각 신호별로 독립적인 그래프 생성
function updateWaveform() {
  if (!parsedData || parsedData.length === 0) return;

  const container = document.getElementById('waveformContainer');
  if (!container) return;

  const selected = Array.from(selectedSignals);
  
  // 기존 그래프 중 선택 해제된 신호의 그래프 제거
  charts.forEach((chart, signalName) => {
    if (!selectedSignals.has(signalName)) {
      const item = document.getElementById(`waveform-item-${signalName}`);
      if (item) {
        item.remove();
      }
      chart.destroy();
      charts.delete(signalName);
    }
  });

  if (selected.length === 0) {
    // 전역축 요소를 먼저 저장
    const globalCursor = container.querySelector('#globalCursor');
    
    // placeholder만 표시
    if (!container.querySelector('.waveform-placeholder')) {
      container.innerHTML = '<div class="waveform-placeholder"><p class="small" style="color:#666; text-align:center; padding:40px;">신호를 선택하세요.</p></div>';
      
      // 전역축 요소 복원
      if (globalCursor) {
        container.insertBefore(globalCursor, container.firstChild);
      }
    }
    return;
  }

  // Placeholder 제거
  const placeholder = container.querySelector('.waveform-placeholder');
  if (placeholder) {
    placeholder.remove();
  }

  // 선택된 신호별로 그래프 생성/업데이트
  selected.forEach(signalName => {
    const signal = signals.find(s => s.name === signalName);
    if (!signal) return;

    let chart = charts.get(signalName);
    let waveformItem = document.getElementById(`waveform-item-${signalName}`);

    // 신호 그래프가 없으면 새로 생성
    if (!waveformItem) {
      waveformItem = document.createElement('div');
      waveformItem.className = 'waveform-item';
      waveformItem.id = `waveform-item-${signalName}`;
      waveformItem.setAttribute('data-signal-name', signalName);

      const header = document.createElement('div');
      header.className = 'waveform-item-header';
      
      const nameSpan = document.createElement('span');
      nameSpan.className = 'waveform-item-name';
      nameSpan.textContent = signalName;
      
      const valueSpan = document.createElement('span');
      valueSpan.className = 'waveform-item-value';
      valueSpan.id = `waveform-value-${signalName}`;
      updateWaveformSignalValue(valueSpan, signal);

      header.appendChild(nameSpan);
      header.appendChild(valueSpan);
      
      // 타이틀바 클릭 이벤트: 그래프 선택 및 시각적 효과 업데이트
      header.style.cursor = 'pointer'; // 커서를 포인터로 변경하여 클릭 가능함을 표시
      header.addEventListener('click', () => {
        const radixSelect = document.getElementById('selectedSignalRadix');
        if (radixSelect) {
          radixSelect.value = signalName;
          radixSelect.dispatchEvent(new Event('change'));
        }
      });

      const canvasWrap = document.createElement('div');
      canvasWrap.className = 'canvas-wrap';
      canvasWrap.id = `canvas-wrap-${signalName}`;

      const canvas = document.createElement('canvas');
      canvas.className = 'waveform-chart';
      canvas.id = `waveform-chart-${signalName}`;
      canvas.width = 1280;
      canvas.height = 200;

      canvasWrap.appendChild(canvas);
      waveformItem.appendChild(header);
      waveformItem.appendChild(canvasWrap);
      container.appendChild(waveformItem);
      
      // 그래프 클릭 시 콤보박스에서 해당 신호 선택
      canvasWrap.addEventListener('click', (e) => {
        if (e.target === canvas || e.target === canvasWrap) {
          const radixSelect = document.getElementById('selectedSignalRadix');
          if (radixSelect) {
            radixSelect.value = signalName;
            // change 이벤트 트리거하여 설정 업데이트
            radixSelect.dispatchEvent(new Event('change'));
          }
        }
      });

      // Chart 생성
      const ctx = canvas.getContext('2d');
      chart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: [],
          datasets: []
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          resizeDelay: 0,
          animation: false,
          parsing: false,
          spanGaps: true,
          interaction: {
            mode: 'index',
            intersect: false
          },
          plugins: {
            legend: {
              display: false
            },
            tooltip: {
              enabled: true,
              displayColors: false,
              backgroundColor: 'rgba(0, 0, 0, 0.8)',
              titleColor: '#fff',
              bodyColor: '#fff',
              borderColor: '#666',
              borderWidth: 1,
              callbacks: {
                title: () => '', // 제목 제거
                label: (context) => {
                  const x = context.parsed.x;
                  const y = context.parsed.y;
                  if (!Number.isFinite(x) || !Number.isFinite(y)) {
                    return '';
                  }
                  
                  // 차트에서 신호명 찾기
                  let signalName = '';
                  const chartId = context.chart.canvas.id;
                  if (chartId && chartId.startsWith('waveform-chart-')) {
                    signalName = chartId.replace('waveform-chart-', '');
                  }
                  
                  // 신호의 Output Radix 확인 (부동소수점인지 체크)
                  let isFloat = false;
                  if (signalName) {
                    const signal = signals.find(s => s.name === signalName);
                    if (signal) {
                      const settings = signalRadixSettings.get(signal.name) || {outputRadix: signal.radix || 'AUTO'};
                      const outputRadix = settings.outputRadix || signal.radix || 'AUTO';
                      isFloat = outputRadix === 'FLOAT32' || outputRadix === 'FLOAT64';
                    }
                  }
                  
                  // X는 항상 정수, Y는 부동소수점이면 소수점 3자리, 아니면 정수 또는 소수점 3자리
                  const xStr = x.toFixed(0);
                  const yStr = isFloat ? y.toFixed(3) : (Number.isInteger(y) ? y.toString() : y.toFixed(3));
                  
                  return `x=${xStr}, y=${yStr}`;
                },
                labelTextColor: () => '#fff',
                footer: () => '' // 푸터 제거
              },
              filter: () => true
            }
          },
          scales: {
            x: {
              type: 'linear',
              title: {
                display: true,
                text: document.getElementById('xLabel')?.value || 'Sample in Window',
                color: '#e8e8e8'
              },
              grid: {
                color: 'rgba(255, 255, 255, 0.1)'
              },
              ticks: {
                color: '#e8e8e8'
              }
            },
            y: {
              title: {
                display: true,
                text: 'Value',
                color: '#e8e8e8'
              },
              grid: {
                color: 'rgba(255, 255, 255, 0.1)'
              },
              ticks: {
                color: '#e8e8e8',
                padding: 8
              },
              afterFit: function(scale) {
                // Y축 레이블 너비를 고정하기 위한 최소 너비 설정
                // 모든 차트에서 동일한 공간을 사용하도록 보장
              }
            }
          },
          plugins: {
            legend: {
              labels: {
                color: '#e8e8e8'
              }
            }
          }
        }
      });
      charts.set(signalName, chart);
      
      // 휠 줌 설정
      setupChartWheelZoom(signalName, chart, canvasWrap, canvas);
      
      // 툴팁 클릭 이벤트 설정
      setupTooltipClick(signalName, chart, canvas);
    }

    // 데이터 업데이트 - Output Radix 적용
    const settings = signalRadixSettings.get(signalName) || {
      outputRadix: 'AUTO', 
      plotType: 'solid-dot',
      lineWidth: 1,
      pointRadius: 1
    };
    const outputRadix = settings.outputRadix || signal.radix || 'AUTO';
    
    const data = parsedData.map((point, i) => ({
      x: Math.max(0, point.sampleInWindow), // X축 최소값 0으로 제한
      y: convertValue(signal.values[i], outputRadix, signal.rawValues[i])
    }));

    const plotType = settings.plotType || 'solid-dot';
    const lineWidth = settings.lineWidth !== undefined ? settings.lineWidth : 1;
    const pointRadius = settings.pointRadius !== undefined ? settings.pointRadius : 1;
    
    const isDot = plotType === 'dot';
    const isSolidDot = plotType === 'solid-dot';
    
    chart.data.datasets = [{
      label: '', // 신호명 제거 - 툴팁에 표시되지 않도록
      data: data,
      borderColor: '#2ca02c',
      backgroundColor: '#2ca02c40',
      borderWidth: lineWidth,
      pointRadius: (isDot || isSolidDot) ? pointRadius : 0,
      pointHoverRadius: (isDot || isSolidDot) ? pointRadius + 2 : 0,
      tension: 0,
      spanGaps: true,
      showLine: !isDot
    }];

    // X축 설정
    const xMin = Math.min(...parsedData.map(p => p.sampleInWindow));
    const xMax = Math.max(...parsedData.map(p => p.sampleInWindow));
    
    const xLabel = document.getElementById('xLabel')?.value || 'Sample in Window';
    
    const currentMin = document.getElementById('xMin')?.value ? parseFloat(document.getElementById('xMin').value) : undefined;
    const currentMax = document.getElementById('xMax')?.value ? parseFloat(document.getElementById('xMax').value) : undefined;
    
    // X축 최소값을 0으로 제한
    const xMinValue = currentMin !== undefined ? Math.max(0, currentMin) : undefined;
    const xMaxValue = currentMax !== undefined ? Math.max(0, currentMax) : undefined;
    
    chart.options.scales.x = {
      type: 'linear',
      title: {
        display: true,
        text: xLabel,
        color: '#e8e8e8'
      },
      grid: {
        color: 'rgba(255, 255, 255, 0.1)'
      },
      ticks: {
        color: '#e8e8e8'
      },
      min: xMinValue,
      max: xMaxValue
    };

    // Tooltip 옵션 업데이트 (기존 차트도 tooltip 설정 다시 적용)
    chart.options.plugins.tooltip = {
      enabled: true,
      displayColors: false,
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      titleColor: '#fff',
      bodyColor: '#fff',
      borderColor: '#666',
      borderWidth: 1,
      callbacks: {
        title: () => '', // 제목 제거
        label: (context) => {
          const x = context.parsed.x;
          const y = context.parsed.y;
          if (!Number.isFinite(x) || !Number.isFinite(y)) {
            return '';
          }
          
          // 커서 데이터셋은 tooltip에서 완전히 제외 (캡션으로 대체)
          const datasetLabel = context.dataset.label;
          if (datasetLabel === '__cursor1_point__' || datasetLabel === '__cursor2_point__') {
            return ''; // 빈 문자열 반환하여 tooltip 표시 안 함
          }
          
          // 일반 데이터 포인트
          // 신호의 Output Radix 확인 (부동소수점인지 체크)
          const settings = signalRadixSettings.get(signalName) || {outputRadix: signal.radix || 'AUTO'};
          const outputRadix = settings.outputRadix || signal.radix || 'AUTO';
          const isFloat = outputRadix === 'FLOAT32' || outputRadix === 'FLOAT64';
          
          // X는 항상 정수, Y는 부동소수점이면 소수점 3자리, 아니면 정수 또는 소수점 3자리
          const xStr = x.toFixed(0);
          const yStr = isFloat ? y.toFixed(3) : (Number.isInteger(y) ? y.toString() : y.toFixed(3));
          
          return `x=${xStr}, y=${yStr} (클릭하여 커서 추가)`;
        },
        labelTextColor: () => '#fff', // 기본 흰색
        footer: () => '' // 푸터 제거
      },
      filter: (tooltipItem) => {
        // 커서 데이터셋은 항상 tooltip에서 제외 (캡션으로 대체)
        const datasetLabel = tooltipItem.dataset.label;
        if (datasetLabel === '__cursor1_point__' || datasetLabel === '__cursor2_point__') {
          return false;
        }
        return true;
      }
    };
    
    // Y축 설정 (신호별 설정 우선, 없으면 자동 스케일링)
    const yAxisSettings = settings.yMin !== undefined || settings.yMax !== undefined;
    
    if (yAxisSettings) {
      // 신호별 Y축 설정값 사용
      chart.options.scales.y.min = settings.yMin;
      chart.options.scales.y.max = settings.yMax;
    } else {
      // Y축 자동 스케일링 (Output Radix 변경 시 데이터 범위가 바뀔 수 있음)
      // 실제 데이터셋만 사용 (커서 데이터셋 제외)
      const actualDataset = chart.data.datasets.find(ds => ds.label === '');
      if (actualDataset && actualDataset.data.length > 0) {
        const yValues = [];
        actualDataset.data.forEach(pt => {
          if (Number.isFinite(pt.y)) yValues.push(pt.y);
        });
        
        if (yValues.length > 0) {
          const yMin = Math.min(...yValues);
          const yMax = Math.max(...yValues);
          const yPad = (yMax - yMin) * 0.05 || 1; // 0으로 나누기 방지
          
          chart.options.scales.y.min = yMin - yPad;
          chart.options.scales.y.max = yMax + yPad;
        }
      }
    }
    
    // 커서 마커 업데이트
    updateCursorMarkers(signalName, chart);
    
    chart.update();
    
    // 스크롤바 업데이트
    updateSignalScrollbar(signalName, chart);
    
    // 데이터 컨테이너 업데이트
    updateCursorDataDisplay(signalName);
    
    // 값 업데이트
    const valueSpan = document.getElementById(`waveform-value-${signalName}`);
    if (valueSpan) {
      updateWaveformSignalValue(valueSpan, signal);
    }
  });

  // 신호 목록의 값도 업데이트
  signals.forEach(signal => {
    const item = document.querySelector(`[data-signal-index="${signals.indexOf(signal)}"]`);
    if (item) {
      const valueSpan = item.querySelector('.signal-value');
      if (valueSpan) {
        updateSignalValue(valueSpan, signal);
      }
    }
  });

  // 선택된 신호 콤보박스 업데이트
  updateRadixSelect();
  
  // 첫 번째 선택된 신호를 자동으로 선택 (콤보박스가 비어있을 때만)
  const radixSelect = document.getElementById('selectedSignalRadix');
  if (radixSelect && selected.length > 0 && !radixSelect.value) {
    radixSelect.value = selected[0];
    // change 이벤트 트리거하여 설정 업데이트
    radixSelect.dispatchEvent(new Event('change'));
  }
  
  // 모든 차트 업데이트 후 Y축 레이블 공간 정렬
  setTimeout(() => {
    alignYAxisLabels();
  }, 0);
}

// Y축 레이블 공간을 일정하게 정렬
function alignYAxisLabels() {
  if (charts.size === 0) return;
  
  // 모든 차트의 Y축 레이블 최대 너비 계산
  let maxLabelWidth = 0;
  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');
  
  // 먼저 모든 차트가 완전히 렌더링될 때까지 기다림
  charts.forEach((chart) => {
    if (!chart || !chart.scales || !chart.scales.y) return;
    
    const yScale = chart.scales.y;
    
    // Chart.js의 내부 폰트 설정 가져오기
    const ctx = chart.ctx;
    const fontString = ctx.font || '12px Arial';
    tempCtx.font = fontString;
    
    // 모든 Y축 눈금 레이블의 너비 측정
    if (yScale.ticks && Array.isArray(yScale.ticks)) {
      yScale.ticks.forEach((tick) => {
        const label = tick.label || '';
        if (label) {
          const width = tempCtx.measureText(String(label)).width;
          maxLabelWidth = Math.max(maxLabelWidth, width);
        }
      });
    }
    
    // Y축 제목이 있으면 포함
    if (yScale.options && yScale.options.title && yScale.options.title.display) {
      const titleText = yScale.options.title.text || '';
      if (titleText) {
        const titleWidth = tempCtx.measureText(String(titleText)).width;
        maxLabelWidth = Math.max(maxLabelWidth, titleWidth * 0.3); // 제목은 회전되어 있으므로 일부만 고려
      }
    }
  });
  
  // 최소 너비 보장 (최소 70px, 최대 너비 + 여유 공간 30px)
  const fixedPadding = Math.max(70, maxLabelWidth + 30);
  
  // 모든 차트의 Y축에 동일한 afterFit 콜백 설정
  charts.forEach((chart) => {
    if (!chart || !chart.options || !chart.options.scales || !chart.options.scales.y) return;
    
    // afterFit 콜백 설정 (차트 업데이트 시마다 실행됨)
    const originalAfterFit = chart.options.scales.y.afterFit;
    
    chart.options.scales.y.afterFit = function(scale) {
      // 원본 afterFit 실행 (있는 경우)
      if (originalAfterFit && typeof originalAfterFit === 'function') {
        originalAfterFit.call(this, scale);
      }
      
      // Y축 너비를 고정 패딩으로 확장
      const currentWidth = scale.width || 0;
      if (currentWidth < fixedPadding) {
        const diff = fixedPadding - currentWidth;
        scale.width = fixedPadding;
        // left 위치 조정 (차트 영역 유지)
        scale.left = (scale.left || 0) - diff;
      }
    };
    
    // 차트 업데이트하여 변경사항 적용
    chart.update('none');
  });
}

function updateWaveformSignalValue(span, signal) {
  if (!parsedData || parsedData.length === 0) {
    span.textContent = '-';
    return;
  }
  
  const lastIndex = parsedData.length - 1;
  const lastValue = signal.values[lastIndex];
  const lastRawValue = signal.rawValues[lastIndex];
  const radix = signal.radix || 'UNSIGNED';
  
  let displayValue = '';
  if (radix === 'HEX') {
    displayValue = lastRawValue || '0';
  } else {
    displayValue = String(lastValue);
  }
  
  span.textContent = displayValue;
}

// Initialize mouse wheel zoom for all charts - 각 차트별로 updateWaveform에서 setupChartWheelZoom 호출

// Initialize toggles
function initToggles() {
  document.querySelectorAll('.toggle').forEach(toggle => {
    toggle.addEventListener('click', () => {
      const section = toggle.closest('.section');
      section.classList.toggle('collapsed');
      toggle.textContent = section.classList.contains('collapsed') ? '펼치기' : '접기';
    });
  });
}

// Initialize signal controls
function initSignalControls() {
  document.getElementById('btnSelectAll')?.addEventListener('click', () => {
    signals.forEach(signal => {
      selectedSignals.add(signal.name);
      const checkbox = document.getElementById(`signal-${signals.indexOf(signal)}`);
      if (checkbox) checkbox.checked = true;
      const item = checkbox?.closest('.signal-item');
      if (item) item.classList.add('selected');
    });
    updateNewBusButton();
    updateWaveform();
  });

  document.getElementById('btnDeselectAll')?.addEventListener('click', () => {
    selectedSignals.clear();
    signals.forEach(signal => {
      const checkbox = document.getElementById(`signal-${signals.indexOf(signal)}`);
      if (checkbox) checkbox.checked = false;
      const item = checkbox?.closest('.signal-item');
      if (item) item.classList.remove('selected');
    });
    updateNewBusButton();
    updateWaveform();
  });

  document.getElementById('btnNewBus')?.addEventListener('click', () => {
    openNewBusDialog();
  });

  // 신호 선택 변경 시 New Bus 버튼 업데이트
  document.addEventListener('change', (e) => {
    if (e.target.type === 'checkbox' && e.target.id.startsWith('signal-')) {
      updateNewBusButton();
    }
  });
}

function updateNewBusButton() {
  const btnNewBus = document.getElementById('btnNewBus');
  if (!btnNewBus) return;
  
  // 신호 목록에서 체크된 항목 수 확인
  const checkedSignals = Array.from(document.querySelectorAll('#signalList input[type="checkbox"]:checked'));
  
  // 정확히 1개만 체크되었을 때만 활성화
  if (checkedSignals.length === 1) {
    btnNewBus.disabled = false;
  } else {
    btnNewBus.disabled = true;
  }
}

// Initialize waveform controls - 모든 차트에 동시 적용
function initWaveformControls() {
  document.getElementById('btnZoomIn')?.addEventListener('click', () => {
    if (charts.size === 0 || !parsedData) return;
    
    // 첫 번째 차트의 현재 범위 확인
    const firstChart = Array.from(charts.values())[0];
    const currentMin = firstChart.options.scales.x.min;
    const currentMax = firstChart.options.scales.x.max;
    
    if (currentMin !== undefined && currentMax !== undefined) {
      const center = (currentMin + currentMax) / 2;
      const range = currentMax - currentMin;
      const newRange = range * 0.8;
      
      let newMin = center - newRange / 2;
      let newMax = center + newRange / 2;
      
      // 최소값을 0으로 제한
      if (newMin < 0) {
        newMin = 0;
        newMax = newRange;
      }
      
      document.getElementById('xMin').value = newMin;
      document.getElementById('xMax').value = newMax;
      
      // 모든 차트에 적용
      charts.forEach((chart, signalName) => {
        chart.options.scales.x.min = newMin;
        chart.options.scales.x.max = newMax;
        chart.update();
        updateSignalScrollbar(signalName, chart);
      });
    }
  });

  document.getElementById('btnZoomOut')?.addEventListener('click', () => {
    if (charts.size === 0 || !parsedData) return;
    
    const firstChart = Array.from(charts.values())[0];
    const currentMin = firstChart.options.scales.x.min;
    const currentMax = firstChart.options.scales.x.max;
    
    if (currentMin !== undefined && currentMax !== undefined) {
      const center = (currentMin + currentMax) / 2;
      const range = currentMax - currentMin;
      const newRange = range * 1.25;
      
      let newMin = center - newRange / 2;
      let newMax = center + newRange / 2;
      
      // 최소값을 0으로 제한
      if (newMin < 0) {
        newMin = 0;
        newMax = Math.max(newRange, Math.max(...parsedData.map(p => p.sampleInWindow)));
      }
      
      document.getElementById('xMin').value = newMin;
      document.getElementById('xMax').value = newMax;
      
      charts.forEach((chart, signalName) => {
        chart.options.scales.x.min = newMin;
        chart.options.scales.x.max = newMax;
        chart.update();
        updateSignalScrollbar(signalName, chart);
      });
    }
  });

  document.getElementById('btnZoomFit')?.addEventListener('click', () => {
    if (!parsedData) return;
    
    // 선택된 신호 확인
    const signalSelect = document.getElementById('selectedSignalRadix');
    const selectedSignalName = signalSelect?.value;
    
    if (selectedSignalName && charts.has(selectedSignalName)) {
      // 선택된 신호만 맞춤
      const chart = charts.get(selectedSignalName);
      const xMin = Math.max(0, Math.min(...parsedData.map(p => p.sampleInWindow)));
      const xMax = Math.max(...parsedData.map(p => p.sampleInWindow));
      
      document.getElementById('xMin').value = xMin;
      document.getElementById('xMax').value = xMax;
      
      chart.options.scales.x.min = xMin;
      chart.options.scales.x.max = xMax;
      
      // Y축 자동 스케일 (실제 데이터셋만 사용, 커서 데이터셋 제외)
      const actualDataset = chart.data.datasets.find(ds => ds.label === '');
      if (actualDataset && actualDataset.data.length > 0) {
        const yValues = [];
        actualDataset.data.forEach(pt => {
          if (Number.isFinite(pt.y)) yValues.push(pt.y);
        });
        
        if (yValues.length > 0) {
          const yMin = Math.min(...yValues);
          const yMax = Math.max(...yValues);
          const yPad = (yMax - yMin) * 0.05 || 1;
          const yMinValue = yMin - yPad;
          const yMaxValue = yMax + yPad;
          
          chart.options.scales.y.min = yMinValue;
          chart.options.scales.y.max = yMaxValue;
          
          // Y축 입력 필드 업데이트
          const yMinInput = document.getElementById('yMin');
          const yMaxInput = document.getElementById('yMax');
          if (yMinInput) yMinInput.value = yMinValue;
          if (yMaxInput) yMaxInput.value = yMaxValue;
          
          // 신호별 Y축 설정값 저장
          const settings = signalRadixSettings.get(selectedSignalName) || {
            inputRadix: 'AUTO',
            outputRadix: 'AUTO',
            plotType: 'solid-dot',
            lineWidth: 1,
            pointRadius: 1
          };
          settings.yMin = yMinValue;
          settings.yMax = yMaxValue;
          signalRadixSettings.set(selectedSignalName, settings);
        }
      }
      
      chart.update();
      updateSignalScrollbar(selectedSignalName, chart);
    } else {
      // 선택된 신호가 없으면 모든 차트 맞춤
      const xMin = Math.max(0, Math.min(...parsedData.map(p => p.sampleInWindow)));
      const xMax = Math.max(...parsedData.map(p => p.sampleInWindow));
      
      document.getElementById('xMin').value = xMin;
      document.getElementById('xMax').value = xMax;
      
      charts.forEach((chart, signalName) => {
        chart.options.scales.x.min = xMin;
        chart.options.scales.x.max = xMax;
        
        // Y축 자동 스케일 (실제 데이터셋만 사용, 커서 데이터셋 제외)
        const actualDataset = chart.data.datasets.find(ds => ds.label === '');
        if (actualDataset && actualDataset.data.length > 0) {
          const yValues = [];
          actualDataset.data.forEach(pt => {
            if (Number.isFinite(pt.y)) yValues.push(pt.y);
          });
          
          if (yValues.length > 0) {
            const yMin = Math.min(...yValues);
            const yMax = Math.max(...yValues);
            const yPad = (yMax - yMin) * 0.05 || 1;
            const yMinValue = yMin - yPad;
            const yMaxValue = yMax + yPad;
            
            chart.options.scales.y.min = yMinValue;
            chart.options.scales.y.max = yMaxValue;
            
            // 신호별 Y축 설정값 저장
            const settings = signalRadixSettings.get(signalName) || {
              inputRadix: 'AUTO',
              outputRadix: 'AUTO',
              plotType: 'solid-dot',
              lineWidth: 1,
              pointRadius: 1
            };
            settings.yMin = yMinValue;
            settings.yMax = yMaxValue;
            signalRadixSettings.set(signalName, settings);
          }
        }
        
        chart.update();
        updateSignalScrollbar(signalName, chart);
      });
      
      // 선택된 신호가 있다면 입력 필드도 업데이트
      if (selectedSignalName && signalRadixSettings.has(selectedSignalName)) {
        const settings = signalRadixSettings.get(selectedSignalName);
        const yMinInput = document.getElementById('yMin');
        const yMaxInput = document.getElementById('yMax');
        if (yMinInput && settings.yMin !== undefined) yMinInput.value = settings.yMin;
        if (yMaxInput && settings.yMax !== undefined) yMaxInput.value = settings.yMax;
      }
    }
  });

  document.getElementById('btnResetZoom')?.addEventListener('click', () => {
    document.getElementById('xMin').value = '';
    document.getElementById('xMax').value = '';
    
    charts.forEach((chart, signalName) => {
      chart.options.scales.x.min = undefined;
      chart.options.scales.x.max = undefined;
      chart.options.scales.y.min = undefined;
      chart.options.scales.y.max = undefined;
      chart.update();
      updateSignalScrollbar(signalName, chart);
    });
  });

  document.getElementById('btnExportCSV')?.addEventListener('click', () => {
    exportToCSV();
  });
}

// CSV 출력 함수
function exportToCSV() {
  if (!parsedData || parsedData.length === 0) {
    alert('출력할 데이터가 없습니다.');
    return;
  }

  const selected = Array.from(selectedSignals);
  if (selected.length === 0) {
    alert('출력할 신호가 선택되지 않았습니다.');
    return;
  }

  // 헤더 생성
  const headers = ['Sample in Window'];
  selected.forEach(signalName => {
    headers.push(signalName);
  });

  // 데이터 행 생성 (Output Radix 적용)
  const rows = [];
  parsedData.forEach((point, i) => {
    const row = [point.sampleInWindow];
    
    selected.forEach(signalName => {
      const signal = signals.find(s => s.name === signalName);
      if (!signal) {
        row.push('');
        return;
      }

      const settings = signalRadixSettings.get(signalName) || {outputRadix: 'AUTO'};
      const outputRadix = settings.outputRadix || signal.radix || 'AUTO';
      
      // Output Radix에 따른 값 변환
      let value;
      if (outputRadix === 'FLOAT32') {
        try {
          const cleanHex = String(signal.rawValues[i] || '0').replace(/^0x/, '').padStart(8, '0');
          const intVal = parseInt(cleanHex.substring(0, 8), 16);
          const buffer = new ArrayBuffer(4);
          const view = new DataView(buffer);
          view.setUint32(0, intVal, true);
          value = view.getFloat32(0, true).toFixed(6);
        } catch (e) {
          value = signal.values[i];
        }
      } else if (outputRadix === 'FLOAT64') {
        try {
          const cleanHex = String(signal.rawValues[i] || '0').replace(/^0x/, '').padStart(16, '0');
          const intVal = BigInt('0x' + cleanHex.substring(0, 16));
          const buffer = new ArrayBuffer(8);
          const view = new DataView(buffer);
          view.setBigUint64(0, intVal, true);
          value = view.getFloat64(0, true).toFixed(15);
        } catch (e) {
          value = signal.values[i];
        }
      } else if (outputRadix === 'HEX') {
        value = signal.rawValues[i] || '0';
      } else if (outputRadix === 'BINARY') {
        const intVal = parseInt(String(signal.rawValues[i] || '0').replace(/^0x/, ''), 16);
        value = intVal.toString(2);
      } else if (outputRadix === 'SIGNED') {
        value = signal.values[i];
      } else {
        value = signal.values[i];
      }
      
      row.push(value);
    });
    
    rows.push(row);
  });

  // CSV 문자열 생성
  const csvLines = [];
  csvLines.push(headers.join(','));
  rows.forEach(row => {
    csvLines.push(row.join(','));
  });

  const csvContent = csvLines.join('\n');
  
  // 다운로드
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `ila_export_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// New Bus 다이얼로그 열기
function openNewBusDialog() {
  const selected = Array.from(selectedSignals);
  if (selected.length !== 1) return;
  
  const signalName = selected[0];
  const signal = signals.find(s => s.name === signalName);
  if (!signal) return;
  
  // 버스 비트 범위 추출
  const bitMatch = signal.name.match(/\[(\d+):(\d+)\]/);
  if (!bitMatch) {
    alert('버스 신호가 아닙니다.');
    return;
  }
  
  const highBit = parseInt(bitMatch[1]);
  const lowBit = parseInt(bitMatch[2]);
  const totalBits = Math.abs(highBit - lowBit) + 1;
  
  // 다이얼로그 HTML 생성
  const dialog = document.createElement('div');
  dialog.className = 'modal-overlay';
  dialog.innerHTML = `
    <div class="modal-dialog">
      <div class="modal-header">
        <h3>New Bus - 신호 분리</h3>
        <button class="modal-close">&times;</button>
      </div>
      <div class="modal-body">
        <p>신호: <strong>${signalName}</strong></p>
        <p>비트 범위: [${highBit}:${lowBit}] (${totalBits} bits)</p>
        <div style="margin-top:12px;">
          <label>분리 설정 (쉼표로 구분, 예: 32,32 또는 16,16,16,16):</label>
          <input type="text" id="busSplitInput" value="${totalBits >= 64 ? '32,32' : totalBits >= 32 ? '16,16' : totalBits >= 16 ? '8,8' : totalBits + ''}" style="width:100%; margin-top:4px; padding:4px;">
          <p class="small" style="color:#666; margin-top:4px;">총 비트 수가 ${totalBits}와 일치해야 합니다.</p>
        </div>
      </div>
      <div class="modal-footer">
        <button id="btnBusSplitOk" class="primary">확인</button>
        <button id="btnBusSplitCancel" class="secondary">취소</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(dialog);
  
  // 닫기 이벤트
  dialog.querySelector('.modal-close').addEventListener('click', () => {
    document.body.removeChild(dialog);
  });
  
  dialog.querySelector('#btnBusSplitCancel').addEventListener('click', () => {
    document.body.removeChild(dialog);
  });
  
  dialog.querySelector('#btnBusSplitOk').addEventListener('click', () => {
    const input = dialog.querySelector('#busSplitInput').value.trim();
    const splits = input.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n > 0);
    
    const sum = splits.reduce((a, b) => a + b, 0);
    if (sum !== totalBits) {
      alert(`총 비트 수가 일치하지 않습니다. (입력: ${sum}, 필요: ${totalBits})`);
      return;
    }
    
    // 신호 분리 처리
    splitBusSignal(signalName, splits, highBit, lowBit);
    document.body.removeChild(dialog);
  });
  
  // 배경 클릭 시 닫기
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) {
      document.body.removeChild(dialog);
    }
  });
}

// 버스 신호 분리 처리
function splitBusSignal(originalSignalName, splits, highBit, lowBit) {
  const originalSignal = signals.find(s => s.name === originalSignalName);
  if (!originalSignal) return;
  
  // 기존 신호 선택 해제
  selectedSignals.delete(originalSignalName);
  
  // 분리된 신호 생성
  let currentHigh = highBit;
  const newSignals = [];
  
  splits.forEach((bitWidth, idx) => {
    const currentLow = currentHigh - bitWidth + 1;
    const newName = `${originalSignalName}_split_${idx}[${currentHigh}:${currentLow}]`;
    
    // 원본 신호의 raw 값에서 비트 추출
    const extractBits = (rawValue, high, low) => {
      const hexValue = rawValue.replace(/^0x/, '');
      const bigInt = BigInt('0x' + hexValue || '0');
      const mask = (1n << BigInt(high - low + 1)) - 1n;
      const extracted = (bigInt >> BigInt(low)) & mask;
      return extracted.toString(16).padStart(Math.ceil((high - low + 1) / 4), '0');
    };
    
    const newSignal = {
      name: newName,
      radix: originalSignal.radix,
      values: originalSignal.values.map((val, i) => {
        const rawVal = originalSignal.rawValues[i];
        const extractedHex = extractBits(rawVal, currentHigh, currentLow);
        return parseInt(extractedHex, 16);
      }),
      rawValues: originalSignal.rawValues.map((rawVal, i) => {
        return extractBits(rawVal, currentHigh, currentLow);
      })
    };
    
    newSignals.push(newSignal);
    signals.push(newSignal);
    selectedSignals.add(newName);
    
    currentHigh = currentLow - 1;
  });
  
  // 신호 목록 업데이트
  updateSignalList();
  // 설정창의 "선택된 신호" 드롭다운에 분리된 신호 추가
  updateRadixSelect();
  // 첫 번째 분리된 신호를 설정창에서 선택
  if (newSignals.length > 0) {
    const radixSelect = document.getElementById('selectedSignalRadix');
    if (radixSelect) {
      radixSelect.value = newSignals[0].name;
      updateRadixSettings(newSignals[0]);
      updateSignalValueDisplay(newSignals[0]);
    }
  }
  updateWaveform();
}

// Initialize settings
function initSettings() {
  document.getElementById('showGrid')?.addEventListener('change', (e) => {
    updateGridSetting();
  });

  document.getElementById('xLabel')?.addEventListener('change', () => {
    const xLabel = document.getElementById('xLabel').value;
    charts.forEach(chart => {
      chart.options.scales.x.title.text = xLabel;
      chart.update();
    });
  });

  const updateAllChartsXRange = () => {
    let xMin = document.getElementById('xMin')?.value ? parseFloat(document.getElementById('xMin').value) : undefined;
    const xMax = document.getElementById('xMax')?.value ? parseFloat(document.getElementById('xMax').value) : undefined;
    
    // X축 최소값을 0으로 제한
    if (xMin !== undefined && xMin < 0) {
      xMin = 0;
      document.getElementById('xMin').value = 0;
    }
    
    charts.forEach((chart, signalName) => {
      chart.options.scales.x.min = xMin;
      chart.options.scales.x.max = xMax;
      chart.update();
      updateSignalScrollbar(signalName, chart);
    });
  };

  document.getElementById('xMin')?.addEventListener('change', updateAllChartsXRange);
  document.getElementById('xMax')?.addEventListener('change', updateAllChartsXRange);
  
  // Y축 범위 업데이트 (선택된 신호만)
  const updateSelectedChartYRange = () => {
    const signalSelect = document.getElementById('selectedSignalRadix');
    const selectedSignalName = signalSelect?.value;
    
    if (selectedSignalName && charts.has(selectedSignalName)) {
      const chart = charts.get(selectedSignalName);
      const yMinInput = document.getElementById('yMin');
      const yMaxInput = document.getElementById('yMax');
      
      let yMin = yMinInput?.value ? parseFloat(yMinInput.value) : undefined;
      let yMax = yMaxInput?.value ? parseFloat(yMaxInput.value) : undefined;
      
      // 신호별 Y축 설정값 저장
      const settings = signalRadixSettings.get(selectedSignalName) || {
        inputRadix: 'AUTO',
        outputRadix: 'AUTO',
        plotType: 'solid-dot',
        lineWidth: 1,
        pointRadius: 1
      };
      settings.yMin = yMin;
      settings.yMax = yMax;
      signalRadixSettings.set(selectedSignalName, settings);
      
      // 차트 업데이트
      chart.options.scales.y.min = yMin;
      chart.options.scales.y.max = yMax;
      chart.update();
    }
  };
  
  document.getElementById('yMin')?.addEventListener('change', updateSelectedChartYRange);
  document.getElementById('yMax')?.addEventListener('change', updateSelectedChartYRange);

  // 커서 툴팁 체크박스 이벤트 리스너
  document.getElementById('cursorTooltipEnabled')?.addEventListener('change', (e) => {
    cursorTooltipEnabled = e.target.checked;
    // 모든 차트의 tooltip 설정 업데이트
    charts.forEach((chart, signalName) => {
      updateCursorMarkers(signalName, chart);
    });
  });

  document.getElementById('selectedSignalRadix')?.addEventListener('change', (e) => {
    const signalName = e.target.value;
    
    // 모든 그래프에서 selected 클래스 제거
    document.querySelectorAll('.waveform-item').forEach(item => {
      item.classList.remove('selected');
    });
    
    if (signalName && signals.length > 0) {
      const signal = signals.find(s => s.name === signalName);
      if (signal) {
        // 선택된 그래프에 selected 클래스 추가
        const waveformItem = document.querySelector(`[data-signal-name="${signalName}"]`);
        if (waveformItem) {
          waveformItem.classList.add('selected');
        }
        
        updateRadixSettings(signal);
        updateSignalValueDisplay(signal);
        // 커서 데이터 표시 업데이트
        updateCursorDataDisplay(signalName);
      }
    } else {
      const valueDisplay = document.getElementById('signalValue');
      if (valueDisplay) {
        valueDisplay.querySelector('p').textContent = '값: -';
      }
      // 커서 데이터 초기화
      updateCursorDataDisplay('');
    }
  });

  document.getElementById('inputRadixSelect')?.addEventListener('change', (e) => {
    const signalSelect = document.getElementById('selectedSignalRadix');
    if (signalSelect && signalSelect.value) {
      const settings = signalRadixSettings.get(signalSelect.value) || {};
      settings.inputRadix = e.target.value;
      signalRadixSettings.set(signalSelect.value, settings);
    }
  });

  document.getElementById('outputRadixSelect')?.addEventListener('change', (e) => {
    const signalSelect = document.getElementById('selectedSignalRadix');
    if (signalSelect && signalSelect.value) {
      const settings = signalRadixSettings.get(signalSelect.value) || {};
      settings.outputRadix = e.target.value;
      signalRadixSettings.set(signalSelect.value, settings);
      // Output Radix 변경 시 그래프 즉시 업데이트
      updateWaveform();
    }
  });

  document.getElementById('plotTypeSelect')?.addEventListener('change', (e) => {
    const signalSelect = document.getElementById('selectedSignalRadix');
    if (signalSelect && signalSelect.value) {
      const settings = signalRadixSettings.get(signalSelect.value) || {};
      settings.plotType = e.target.value;
      signalRadixSettings.set(signalSelect.value, settings);
      updateWaveform();
    }
  });

  // 선 두께 슬라이더
  const lineWidthSlider = document.getElementById('lineWidthSlider');
  const lineWidthValue = document.getElementById('lineWidthValue');
  if (lineWidthSlider && lineWidthValue) {
    lineWidthSlider.addEventListener('input', (e) => {
      const value = parseFloat(e.target.value);
      lineWidthValue.textContent = value;
      
      const signalSelect = document.getElementById('selectedSignalRadix');
      if (signalSelect && signalSelect.value) {
        // 현재 선택된 신호 저장
        const currentSelected = signalSelect.value;
        const settings = signalRadixSettings.get(currentSelected) || {};
        settings.lineWidth = value;
        signalRadixSettings.set(currentSelected, settings);
        updateWaveform();
        
        // 선택된 신호 복원 (updateWaveform에서 드롭다운이 재생성될 수 있음)
        if (signalSelect.value !== currentSelected && charts.has(currentSelected)) {
          signalSelect.value = currentSelected;
        }
      }
    });
  }

  // Dot 두께 슬라이더
  const pointRadiusSlider = document.getElementById('pointRadiusSlider');
  const pointRadiusValue = document.getElementById('pointRadiusValue');
  if (pointRadiusSlider && pointRadiusValue) {
    pointRadiusSlider.addEventListener('input', (e) => {
      const value = parseFloat(e.target.value);
      pointRadiusValue.textContent = value;
      
      const signalSelect = document.getElementById('selectedSignalRadix');
      if (signalSelect && signalSelect.value) {
        // 현재 선택된 신호 저장
        const currentSelected = signalSelect.value;
        const settings = signalRadixSettings.get(currentSelected) || {};
        settings.pointRadius = value;
        signalRadixSettings.set(currentSelected, settings);
        updateWaveform();
        
        // 선택된 신호 복원 (updateWaveform에서 드롭다운이 재생성될 수 있음)
        if (signalSelect.value !== currentSelected && charts.has(currentSelected)) {
          signalSelect.value = currentSelected;
        }
      }
    });
  }
}

function updateRadixSettings(signal) {
  const settings = signalRadixSettings.get(signal.name) || {
    inputRadix: 'AUTO', 
    outputRadix: signal.radix || 'AUTO', 
    plotType: 'solid-dot',
    lineWidth: 1,
    pointRadius: 1,
    yMin: undefined,
    yMax: undefined
  };
  
  const inputRadixSelect = document.getElementById('inputRadixSelect');
  const outputRadixSelect = document.getElementById('outputRadixSelect');
  const plotTypeSelect = document.getElementById('plotTypeSelect');
  const lineWidthSlider = document.getElementById('lineWidthSlider');
  const lineWidthValue = document.getElementById('lineWidthValue');
  const pointRadiusSlider = document.getElementById('pointRadiusSlider');
  const pointRadiusValue = document.getElementById('pointRadiusValue');
  const yMinInput = document.getElementById('yMin');
  const yMaxInput = document.getElementById('yMax');
  
  if (inputRadixSelect) inputRadixSelect.value = settings.inputRadix || 'AUTO';
  if (outputRadixSelect) outputRadixSelect.value = settings.outputRadix || signal.radix || 'AUTO';
  if (plotTypeSelect) plotTypeSelect.value = settings.plotType || 'solid-dot';
  if (lineWidthSlider && lineWidthValue) {
    const lineWidth = settings.lineWidth !== undefined ? settings.lineWidth : 1;
    lineWidthSlider.value = lineWidth;
    lineWidthValue.textContent = lineWidth;
  }
  if (pointRadiusSlider && pointRadiusValue) {
    const pointRadius = settings.pointRadius !== undefined ? settings.pointRadius : 1;
    pointRadiusSlider.value = pointRadius;
    pointRadiusValue.textContent = pointRadius;
  }
  
  // Y축 설정값 로드
  if (yMinInput) {
    yMinInput.value = settings.yMin !== undefined ? settings.yMin : '';
  }
  if (yMaxInput) {
    yMaxInput.value = settings.yMax !== undefined ? settings.yMax : '';
  }
  
  signalRadixSettings.set(signal.name, settings);
}

// Initialize global cursor (Vivado ILA-style yellow axis)
function initGlobalCursor() {
  const waveformContainer = document.getElementById('waveformContainer');
  const globalCursor = document.getElementById('globalCursor');
  const globalCursorCheckbox = document.getElementById('globalCursorEnabled');
  
  if (!waveformContainer || !globalCursor) return;
  
  // 체크박스 변경 시 전역 축 표시/숨김
  if (globalCursorCheckbox) {
    globalCursorCheckbox.addEventListener('change', (e) => {
      if (!e.target.checked) {
        globalCursor.style.display = 'none';
      }
      // checked일 때는 mousemove 이벤트에서 표시됨
    });
  }
  
  // 마우스 이동 시 전역 축 위치 업데이트
  waveformContainer.addEventListener('mousemove', (e) => {
    // 체크박스가 체크되어 있을 때만 표시
    if (globalCursorCheckbox && !globalCursorCheckbox.checked) {
      globalCursor.style.display = 'none';
      return;
    }
    
    const containerRect = waveformContainer.getBoundingClientRect();
    const mouseX = e.clientX - containerRect.left;
    
    // 컨테이너 범위 내에서만 표시
    if (mouseX >= 0 && mouseX <= containerRect.width) {
      globalCursor.style.left = `${mouseX}px`;
      globalCursor.style.display = 'block';
    } else {
      globalCursor.style.display = 'none';
    }
  });
  
  // 마우스가 컨테이너를 벗어나면 축 숨김
  waveformContainer.addEventListener('mouseleave', () => {
    globalCursor.style.display = 'none';
  });
}

// Initialize ESC key listener for cursor deletion
function initEscKeyListener() {
  document.addEventListener('keydown', (e) => {
    // ESC 키 확인
    if (e.key === 'Escape' || e.keyCode === 27) {
      // 현재 선택된 신호 확인
      const signalSelect = document.getElementById('selectedSignalRadix');
      const selectedSignalName = signalSelect?.value;
      
      if (selectedSignalName && cursorMarkers.has(selectedSignalName)) {
        // 해당 신호의 커서 삭제
        cursorMarkers.delete(selectedSignalName);
        
        // 차트에서 커서 제거
        const chart = charts.get(selectedSignalName);
        if (chart) {
          updateCursorMarkers(selectedSignalName, chart);
          updateCursorDataDisplay(selectedSignalName);
        }
      }
    }
  });
}

// Register cursor caption plugin for Chart.js
function registerCursorCaptionPlugin() {
  const cursorCaptionPlugin = {
    id: 'cursorCaption',
    afterDraw: (chart, args, options) => {
      // 커서 툴팁이 비활성화되어 있으면 캡션을 그리지 않음
      if (!cursorTooltipEnabled) {
        return;
      }
      
      const ctx = chart.ctx;
      const chartId = chart.canvas.id;
      if (!chartId || !chartId.startsWith('waveform-chart-')) {
        return;
      }
      
      const signalName = chartId.replace('waveform-chart-', '');
      const signal = signals.find(s => s.name === signalName);
      if (!signal) return;
      
      const settings = signalRadixSettings.get(signalName) || {outputRadix: signal.radix || 'AUTO'};
      const outputRadix = settings.outputRadix || signal.radix || 'AUTO';
      const isFloat = outputRadix === 'FLOAT32' || outputRadix === 'FLOAT64';
      
      // 커서 데이터셋 찾기
      chart.data.datasets.forEach(dataset => {
        if (dataset.label === '__cursor1_point__' || dataset.label === '__cursor2_point__') {
          if (dataset.data && dataset.data.length > 0) {
            const point = dataset.data[0];
            const x = point.x;
            const y = point.y;
            
            if (Number.isFinite(x) && Number.isFinite(y)) {
              // 데이터 좌표를 픽셀 좌표로 변환
              const xPixel = chart.scales.x.getPixelForValue(x);
              const yPixel = chart.scales.y.getPixelForValue(y);
              
              // 색상 결정
              const color = dataset.label === '__cursor1_point__' ? '#2196F3' : '#f44336';
              
              // 텍스트 형식
              const xStr = x.toFixed(0);
              const yStr = isFloat ? y.toFixed(3) : (Number.isInteger(y) ? y.toString() : y.toFixed(3));
              const text = `x=${xStr}, y=${yStr}`;
              
              // 텍스트 스타일 설정
              ctx.save();
              ctx.font = '12px sans-serif';
              ctx.fillStyle = color;
              ctx.textAlign = 'left';
              ctx.textBaseline = 'top';
              
              // 텍스트 배경 (가독성을 위해)
              const metrics = ctx.measureText(text);
              const textWidth = metrics.width;
              const textHeight = 16;
              const padding = 4;
              
              ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
              ctx.fillRect(
                xPixel + 8,
                yPixel - textHeight - padding - 2,
                textWidth + padding * 2,
                textHeight + padding * 2
              );
              
              // 텍스트 그리기
              ctx.fillStyle = color;
              ctx.fillText(
                text,
                xPixel + 8 + padding,
                yPixel - textHeight - padding - 2 + padding
              );
              
              ctx.restore();
            }
          }
        }
      });
    }
  };
  
  Chart.register(cursorCaptionPlugin);
}

function updateGridSetting() {
  const showGrid = document.getElementById('showGrid')?.checked ?? true;
  
  charts.forEach(chart => {
    chart.options.scales.x.grid.display = showGrid;
    chart.options.scales.y.grid.display = showGrid;
    chart.update();
  });
}

// 신호명 간략화 함수 (뒤에서 maxLength 글자만 표시, 앞부분은 "/..."로 생략)
function truncateSignalName(signalName, maxLength = 30) {
  if (!signalName || signalName.length <= maxLength) {
    return signalName;
  }
  // 뒤에서 maxLength 글자만 가져오기
  const truncated = signalName.substring(signalName.length - maxLength);
  return '/...' + truncated;
}

function updateRadixSelect() {
  const select = document.getElementById('selectedSignalRadix');
  if (!select) return;
  
  // 현재 선택된 값 저장
  const currentValue = select.value;
  
  // 현재 그려진 그래프 목록만 표시 (선택된 신호만)
  const selected = Array.from(selectedSignals);
  select.innerHTML = '<option value="">없음</option>';
  
  selected.forEach(signalName => {
    const signal = signals.find(s => s.name === signalName);
    if (signal) {
      const option = document.createElement('option');
      option.value = signal.name;
      option.textContent = truncateSignalName(signal.name, 30); // 간략화된 이름 표시
      option.title = signal.name; // 전체 이름을 툴팁으로 표시
      select.appendChild(option);
    }
  });
  
  // 저장된 선택 값 복원 (여전히 유효한 경우)
  if (currentValue && selected.includes(currentValue)) {
    select.value = currentValue;
  }
}

function updateSignalValueDisplay(signal) {
  const valueDisplay = document.getElementById('signalValue');
  if (!valueDisplay || !signal) return;
  
  if (!parsedData || parsedData.length === 0) {
    valueDisplay.querySelector('p').textContent = '값: -';
    return;
  }
  
  const lastIndex = parsedData.length - 1;
  const lastValue = signal.values[lastIndex];
  const lastRawValue = signal.rawValues[lastIndex];
  const radix = signal.radix || 'UNSIGNED';
  
  let displayValue = '';
  if (radix === 'HEX') {
    displayValue = lastRawValue || '0';
  } else if (radix === 'SIGNED') {
    displayValue = String(lastValue);
  } else {
    displayValue = String(lastValue);
  }
  
  valueDisplay.querySelector('p').textContent = `값: ${displayValue} (${radix})`;
}

// Setup wheel zoom for a specific chart
function setupChartWheelZoom(signalName, chart, canvasWrap, canvas) {
  // 컨트롤 키 + 휠로만 줌 작동
  canvasWrap.addEventListener('wheel', (e) => {
    if (!chart || !parsedData || parsedData.length === 0) return;
    
    // 컨트롤 키가 눌려있지 않으면 일반 스크롤 허용
    if (!e.ctrlKey && !e.metaKey) {
      return;
    }
    
    e.preventDefault();
    
    // Get mouse position relative to canvas
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    
    // Convert mouse X position to chart X value (fallback)
    const scale = chart.scales.x;
    if (!scale) return;
    
    const mouseChartX = scale.getValueForPixel(mouseX);
    if (!Number.isFinite(mouseChartX)) return;
    
    // Get current X range
    const currentMin = chart.options.scales.x.min !== undefined 
      ? chart.options.scales.x.min 
      : Math.min(...parsedData.map(p => p.sampleInWindow));
    const currentMax = chart.options.scales.x.max !== undefined 
      ? chart.options.scales.x.max 
      : Math.max(...parsedData.map(p => p.sampleInWindow));
    
    // Calculate zoom factor (10% per scroll)
    const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;
    
    // Determine zoom center point based on cursors
    let chartX = mouseChartX; // Default: mouse position
    let useCursorMin = false; // Flag for special case: cursor1 only -> use as min
    
    // Check if cursors exist for this signal
    if (cursorMarkers.has(signalName)) {
      const markers = cursorMarkers.get(signalName);
      const hasCursor1 = markers.cursor1 !== null;
      const hasCursor2 = markers.cursor2 !== null;
      
      if (hasCursor1 && hasCursor2) {
        // Both cursors exist
        const x1 = markers.cursor1.x;
        const x2 = markers.cursor2.x;
        
        if (x1 < x2) {
          // Normal order: cursor1 (blue) is left, use center of two cursors
          chartX = (x1 + x2) / 2;
        } else {
          // Wrong order: cursor1 is right of cursor2, use mouse position
          chartX = mouseChartX;
        }
      } else if (hasCursor1) {
        // Only cursor1 (blue) exists -> use as minimum value
        useCursorMin = true;
        chartX = markers.cursor1.x;
      } else if (hasCursor2) {
        // Only cursor2 (red) exists -> use as zoom center (right side)
        chartX = markers.cursor2.x;
      }
    }
    
    // Calculate new range
    const range = currentMax - currentMin;
    const newRange = range * zoomFactor;
    
    let newMin, newMax;
    
    if (useCursorMin) {
      // Special case: cursor1 only -> use cursor as minimum
      newMin = chartX;
      newMax = chartX + newRange;
    } else {
      // Normal zoom centered on chartX
      const centerOffset = (chartX - (currentMin + currentMax) / 2);
      newMin = chartX - (newRange / 2) - centerOffset * (1 - zoomFactor);
      newMax = chartX + (newRange / 2) - centerOffset * (1 - zoomFactor);
    }
    
    // Clamp to data bounds and ensure min >= 0
    const dataMin = Math.max(0, Math.min(...parsedData.map(p => p.sampleInWindow)));
    const dataMax = Math.max(...parsedData.map(p => p.sampleInWindow));
    
    if (newMin < dataMin) {
      newMin = dataMin;
      newMax = Math.min(newMin + newRange, dataMax);
    }
    if (newMax > dataMax) {
      newMax = dataMax;
      newMin = Math.max(dataMin, newMax - newRange);
    }
    
    // 최종적으로 최소값이 0 이상인지 확인
    if (newMin < 0) {
      newMin = 0;
      newMax = Math.max(newRange, dataMax);
    }
    
    // Apply zoom to this chart
    chart.options.scales.x.min = newMin;
    chart.options.scales.x.max = newMax;
    
    // Update input fields (shared across all charts)
    const xMinInput = document.getElementById('xMin');
    const xMaxInput = document.getElementById('xMax');
    if (xMinInput) xMinInput.value = newMin.toFixed(0);
    if (xMaxInput) xMaxInput.value = newMax.toFixed(0);
    
    chart.update();
    
    // Check if scrollbar is needed and update
    updateSignalScrollbar(signalName, chart);
    
    // Update all charts with same X range (synchronized zoom)
    charts.forEach((otherChart, otherSignalName) => {
      if (otherSignalName !== signalName) {
        otherChart.options.scales.x.min = newMin;
        otherChart.options.scales.x.max = newMax;
        otherChart.update();
        updateSignalScrollbar(otherSignalName, otherChart);
      }
    });
  }, { passive: false });
}

// Setup tooltip click for cursor marker
function setupTooltipClick(signalName, chart, canvas) {
  let lastTooltipData = null;
  let tooltipActive = false;
  
  // Chart.js의 tooltip 이벤트를 감지하여 툴팁 데이터 캡처
  // tooltip 표시 시 데이터 저장
  chart.options.plugins.tooltip.onHover = (active, event) => {
    if (active && active.length > 0) {
      const activeElement = active[0];
      if (activeElement && activeElement.parsed) {
        lastTooltipData = {
          x: activeElement.parsed.x,
          y: activeElement.parsed.y,
          index: activeElement.dataIndex
        };
        tooltipActive = true;
      }
    } else {
      tooltipActive = false;
    }
  };
  
  // 캔버스 클릭 이벤트
  canvas.addEventListener('click', (e) => {
    e.stopPropagation(); // 이벤트 버블링 방지
    
    // 먼저 선택된 신호를 업데이트 (다른 그래프 클릭 시)
    const radixSelect = document.getElementById('selectedSignalRadix');
    if (radixSelect && radixSelect.value !== signalName) {
      radixSelect.value = signalName;
      radixSelect.dispatchEvent(new Event('change'));
      // 선택 변경 후에도 커서 추가는 계속 진행 (그래프 클릭이므로)
    }
    
    // 커서 추가 (삭제 로직 제거됨)
    // Chart.js의 getElementsAtEventForMode를 사용하여 클릭 지점의 데이터 포인트 찾기
    const points = chart.getElementsAtEventForMode(e, 'nearest', { intersect: true }, true);
    
    let dataPoint = null;
    
    // 툴팁 데이터가 있으면 우선 사용
    if (lastTooltipData && tooltipActive) {
      dataPoint = lastTooltipData;
    }
    // Chart.js가 반환한 포인트 사용
    else if (points && points.length > 0) {
      const point = points[0];
      
      // Chart.js v3에서는 parsed 속성이 없을 수 있으므로 scales를 사용하여 변환
      if (point && point.index !== undefined) {
        const scaleX = chart.scales.x;
        const scaleY = chart.scales.y;
        
        if (scaleX && scaleY && point.element) {
          // element의 위치에서 데이터 값 추출
          const pixelX = point.element.x;
          const pixelY = point.element.y;
          
          const xValue = scaleX.getValueForPixel(pixelX);
          const yValue = scaleY.getValueForPixel(pixelY);
          
          if (Number.isFinite(xValue) && Number.isFinite(yValue)) {
            dataPoint = {
              x: xValue,
              y: yValue,
              index: point.index
            };
          } else if (point.parsed) {
            // parsed가 있으면 사용
            dataPoint = {
              x: point.parsed.x,
              y: point.parsed.y,
              index: point.index
            };
          }
        }
      }
    }
    
    // 위 방법으로 찾지 못했을 경우 마우스 위치에서 직접 찾기
    if (!dataPoint) {
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const scaleX = chart.scales.x;
      
      if (scaleX) {
        const chartX = scaleX.getValueForPixel(mouseX);
        const signal = signals.find(s => s.name === signalName);
        if (!signal || !parsedData) return;
        
        // X값과 가장 가까운 데이터 포인트 찾기
        let minDistance = Infinity;
        parsedData.forEach((point, i) => {
          const distance = Math.abs(point.sampleInWindow - chartX);
          if (distance < minDistance) {
            minDistance = distance;
            dataPoint = {
              x: point.sampleInWindow,
              y: signal.values[i],
              index: i
            };
          }
        });
      }
    }
    
    if (dataPoint && Number.isFinite(dataPoint.x) && Number.isFinite(dataPoint.y)) {
      // Output Radix 적용하여 Y값 변환
      const signal = signals.find(s => s.name === signalName);
      if (!signal) return;
      
      const settings = signalRadixSettings.get(signalName) || {outputRadix: signal.radix || 'AUTO'};
      const outputRadix = settings.outputRadix || signal.radix || 'AUTO';
      const convertedY = convertValue(signal.values[dataPoint.index], outputRadix, signal.rawValues[dataPoint.index]);
      
      addCursorMarker(signalName, dataPoint.x, convertedY);
    }
  });
}

// Add cursor marker to chart
function addCursorMarker(signalName, x, y) {
  if (!cursorMarkers.has(signalName)) {
    cursorMarkers.set(signalName, {cursor1: null, cursor2: null});
  }
  
  const markers = cursorMarkers.get(signalName);
  
  // 첫 번째 클릭: 파란색 (시작)
  if (!markers.cursor1) {
    markers.cursor1 = {x, y};
  } 
  // 두 번째 클릭: 빨간색 (끝)
  else if (!markers.cursor2) {
    markers.cursor2 = {x, y};
  }
  // 세 번째 클릭부터: 파란색을 새로 설정
  else {
    markers.cursor1 = {x, y};
    markers.cursor2 = null;
  }
  
  cursorMarkers.set(signalName, markers);
  
  // 차트 업데이트
  const chart = charts.get(signalName);
  if (chart) {
    updateCursorMarkers(signalName, chart);
    updateCursorDataDisplay(signalName);
  }
}

// Update cursor markers on chart
function updateCursorMarkers(signalName, chart) {
  if (!chart) return;
  
  // 커서가 없으면 기존 커서 데이터셋만 제거
  if (!cursorMarkers.has(signalName)) {
    chart.data.datasets = chart.data.datasets.filter(ds => 
      ds.label !== '__cursor1__' && 
      ds.label !== '__cursor2__' && 
      ds.label !== '__cursor1_point__' && 
      ds.label !== '__cursor2_point__'
    );
    chart.update();
    return;
  }
  
  const markers = cursorMarkers.get(signalName);
  
  // 기존 annotation 데이터셋 제거 (커서 관련 데이터셋만 필터링)
  chart.data.datasets = chart.data.datasets.filter(ds => 
    ds.label !== '__cursor1__' && 
    ds.label !== '__cursor2__' && 
    ds.label !== '__cursor1_point__' && 
    ds.label !== '__cursor2_point__'
  );
  
  // 파란색 커서 (시작)
  if (markers.cursor1) {
    const x1 = markers.cursor1.x;
    const y1 = markers.cursor1.y;
    
    // Y축 범위 가져오기
    const yMin = chart.scales.y.min !== undefined ? chart.scales.y.min : (chart.options.scales.y.min || 0);
    const yMax = chart.scales.y.max !== undefined ? chart.scales.y.max : (chart.options.scales.y.max || 100);
    
    // 수직선 그리기
    const verticalLine = {
      label: '__cursor1__',
      data: [
        {x: x1, y: yMin},
        {x: x1, y: yMax}
      ],
      borderColor: '#2196F3',
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderDash: [5, 5],
      pointRadius: 0,
      tension: 0,
      showLine: true,
      spanGaps: false,
      order: -1 // 맨 앞으로 표시
    };
    
    // 데이터 포인트 마커
    const point1 = {
      label: '__cursor1_point__',
      data: [{x: x1, y: y1}],
      borderColor: '#2196F3',
      backgroundColor: '#2196F3',
      borderWidth: 1,
      pointRadius: 1, // 커서 닷 크기 1로 설정
      pointHoverRadius: 1, // hover 시에도 크기 변경 없음 (tooltip 없으므로)
      showLine: false,
      order: -1 // 맨 앞으로 표시
    };
    
    chart.data.datasets.push(verticalLine);
    chart.data.datasets.push(point1);
  }
  
  // 빨간색 커서 (끝)
  if (markers.cursor2) {
    const x2 = markers.cursor2.x;
    const y2 = markers.cursor2.y;
    
    // Y축 범위 가져오기
    const yMin2 = chart.scales.y.min !== undefined ? chart.scales.y.min : (chart.options.scales.y.min || 0);
    const yMax2 = chart.scales.y.max !== undefined ? chart.scales.y.max : (chart.options.scales.y.max || 100);
    
    // 수직선 그리기
    const verticalLine = {
      label: '__cursor2__',
      data: [
        {x: x2, y: yMin2},
        {x: x2, y: yMax2}
      ],
      borderColor: '#f44336',
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderDash: [5, 5],
      pointRadius: 0,
      tension: 0,
      showLine: true,
      spanGaps: false,
      order: -1 // 맨 앞으로 표시
    };
    
    // 데이터 포인트 마커
    const point2 = {
      label: '__cursor2_point__',
      data: [{x: x2, y: y2}],
      borderColor: '#f44336',
      backgroundColor: '#f44336',
      borderWidth: 1,
      pointRadius: 1, // 커서 닷 크기 1로 설정
      pointHoverRadius: 1, // hover 시에도 크기 변경 없음 (tooltip 없으므로)
      showLine: false,
      order: -1 // 맨 앞으로 표시
    };
    
    chart.data.datasets.push(verticalLine);
    chart.data.datasets.push(point2);
  }
  
  chart.update();
}

// Update cursor data display
function updateCursorDataDisplay(signalName) {
  const cursor1Info = document.getElementById('cursor1Info');
  const cursor2Info = document.getElementById('cursor2Info');
  const cursorDelta = document.getElementById('cursorDelta');
  
  if (!cursor1Info || !cursor2Info || !cursorDelta) return;
  
  if (!cursorMarkers.has(signalName)) {
    cursor1Info.textContent = '-';
    cursor2Info.textContent = '-';
    cursorDelta.textContent = '-';
    return;
  }
  
  const markers = cursorMarkers.get(signalName);
  const signal = signals.find(s => s.name === signalName);
  
  if (!signal) return;
  
  const settings = signalRadixSettings.get(signalName) || {outputRadix: signal.radix || 'AUTO'};
  const outputRadix = settings.outputRadix || signal.radix || 'AUTO';
  const isFloat = outputRadix === 'FLOAT32' || outputRadix === 'FLOAT64';
  
  // 파란색 커서 정보
  if (markers.cursor1) {
    const x1Str = markers.cursor1.x.toFixed(0);
    const y1Str = isFloat 
      ? markers.cursor1.y.toFixed(3) 
      : (Number.isInteger(markers.cursor1.y) ? markers.cursor1.y.toString() : markers.cursor1.y.toFixed(3));
    cursor1Info.textContent = `x=${x1Str}, y=${y1Str}`;
  } else {
    cursor1Info.textContent = '-';
  }
  
  // 빨간색 커서 정보
  if (markers.cursor2) {
    const x2Str = markers.cursor2.x.toFixed(0);
    const y2Str = isFloat 
      ? markers.cursor2.y.toFixed(3) 
      : (Number.isInteger(markers.cursor2.y) ? markers.cursor2.y.toString() : markers.cursor2.y.toFixed(3));
    cursor2Info.textContent = `x=${x2Str}, y=${y2Str}`;
  } else {
    cursor2Info.textContent = '-';
  }
  
  // 거리 계산
  if (markers.cursor1 && markers.cursor2) {
    const deltaX = markers.cursor2.x - markers.cursor1.x;
    const deltaY = markers.cursor2.y - markers.cursor1.y;
    const deltaXStr = deltaX.toFixed(0);
    const deltaYStr = isFloat 
      ? deltaY.toFixed(3) 
      : (Number.isInteger(deltaY) ? deltaY.toString() : deltaY.toFixed(3));
    cursorDelta.textContent = `Δx=${deltaXStr}, Δy=${deltaYStr}`;
  } else {
    cursorDelta.textContent = '-';
  }
}

// Update scrollbar visibility for a specific signal's chart
function updateSignalScrollbar(signalName, chart) {
  if (!chart || !parsedData || parsedData.length === 0) return;
  
  const canvasWrap = document.getElementById(`canvas-wrap-${signalName}`);
  const canvas = document.getElementById(`waveform-chart-${signalName}`);
  if (!canvasWrap || !canvas) return;
  
  const dataMin = Math.min(...parsedData.map(p => p.sampleInWindow));
  const dataMax = Math.max(...parsedData.map(p => p.sampleInWindow));
  
  let currentMin = chart.options.scales.x.min !== undefined 
    ? chart.options.scales.x.min 
    : dataMin;
  const currentMax = chart.options.scales.x.max !== undefined 
    ? chart.options.scales.x.max 
    : dataMax;
  
  // X축 최소값을 0으로 제한
  if (currentMin < 0) {
    currentMin = 0;
  }
  
  const range = currentMax - currentMin;
  const totalRange = dataMax - dataMin;
  
  // Calculate zoom ratio
  const zoomRatio = totalRange / range;
  
  // 줌 시 그래프 크기는 고정하고 X축 범위만 변경 (스크롤바는 필요할 때만 표시)
  // Chart.js의 responsive가 이미 그래프 크기를 고정하므로 추가 작업 불필요
  // 스크롤바는 overflow-x: auto로 자동 처리
  const needsScroll = range < totalRange * 0.99 && zoomRatio > 1;
  
  if (needsScroll) {
    // 캔버스 너비를 조정하지 않고, Chart.js가 자동으로 처리하도록 함
    canvasWrap.classList.add('scrolled');
  } else {
    canvasWrap.classList.remove('scrolled');
  }
}
