(function () {
    // FFT/Time Graph Settings
    const fftSettings = {
        input: {
            autoScale: true,
            independentAxis: true,  // V/I use independent Y-axes
            margin: 10,
            yMin: 0,
            yMax: 100,
            vOffset: 0,  // Voltage baseline offset (%)
            iOffset: 0,  // Current baseline offset (%)
            samplingRate: 100000000,  // 100 MHz
            fftLength: 1024,
            xAxisDisplay: 'physical'  // 'physical' or 'index'
        },
        output: {
            autoScale: true,
            independentAxis: true,  // V/I use independent Y-axes
            margin: 10,
            yMin: 0,
            yMax: 100,
            vOffset: 0,  // Voltage baseline offset (%)
            iOffset: 0,  // Current baseline offset (%)
            samplingRate: 100000000,  // 100 MHz
            fftLength: 1024,
            xAxisDisplay: 'physical'  // 'physical' or 'index'
        }
    };

    // Expose settings getter/setter
    RF.ui.getFftSettings = function () {
        return fftSettings;
    };

    RF.ui.setFftSettings = function (sensor, settings) {
        if (fftSettings[sensor]) {
            Object.assign(fftSettings[sensor], settings);
        }
    };

    RF.ui.updateLed = function (id, state) {
        const el = document.getElementById(id);
        if (!el) return;

        // Reset
        el.classList.remove('on-green', 'on-red');

        // Logic depends on LED type
        if (id === 'ledCover' || id === 'ledFanLock') {
            // Interlocks: ON means Error (Red)
            if (state) el.classList.add('on-red');
            else el.classList.add('on-green'); // Safe
        } else if (id === 'ledCable') {
            // Cable: ON means Connected (Green)
            if (state) el.classList.add('on-green');
            else el.classList.add('on-red');
        } else {
            // Normal Status: ON means Active (Green)
            if (state) el.classList.add('on-green');
        }
    };

    RF.ui.setConnectedState = function (connected) {
        document.getElementById('btnConnect').disabled = connected;
        document.getElementById('btnRequestPort').disabled = connected;
        document.getElementById('btnDisconnect').disabled = !connected;

        // Update Status LEDs
        RF.ui.updateLed('ledEthercat', connected); // Mock Ethercat status linked to connection
    };

    // Update VVC Position bar display with limit warning colors
    // motorNum: 1 or 2 (1-based), percent: 0~100
    RF.ui.updateVvcBar = function (motorNum, percent) {
        const posEl = document.getElementById(`vvc${motorNum}Pos`);
        const valEl = document.getElementById(`vvc${motorNum}Val`);
        
        // Clamp percent to 0~100
        const clampedPercent = Math.max(0, Math.min(100, percent));
        
        if (posEl) {
            posEl.style.width = `${clampedPercent}%`;
            
            // Remove existing state classes
            posEl.classList.remove('warning', 'danger');
            
            // Check limits from settings
            const vvcSettings = RF.settings[`vvc${motorNum}`];
            if (vvcSettings) {
                const position = vvcSettings.position;
                const lowerLimit = vvcSettings.lowerLimit;
                const upperLimit = vvcSettings.upperLimit;
                
                // Apply danger class if position exceeds limits
                if (position !== undefined && lowerLimit !== undefined && upperLimit !== undefined) {
                    if (position < lowerLimit || position > upperLimit) {
                        posEl.classList.add('danger');
                    } else {
                        // Calculate warning threshold (within 5% of limits)
                        const range = upperLimit - lowerLimit;
                        const warningMargin = range * 0.05;
                        if (position < lowerLimit + warningMargin || position > upperLimit - warningMargin) {
                            posEl.classList.add('warning');
                        }
                    }
                }
            }
        }
        if (valEl) {
            valEl.textContent = `${clampedPercent}%`;
        }
        
        console.log(`VVC ${motorNum} bar updated: ${clampedPercent}%`);
    };

    // Sensor command sending helper with new command mapping
    // Old command → New command mapping for consistency
    const sensorCmdMap = {
        'rs': 'rrs',    // RF Run Stream (impedance)
        'rt': 'rrv',    // RF Run V/I stream
        'rc': 'rsc',    // RF Set Calibration
        // Commands that stay the same:
        'ri': 'ri',     // RF Init
        'rf': 'rf',     // RF FFT
        'rz': 'rz',     // RF impedance (Z)
        'rk': 'rk',     // RF coupling
        'rr': 'rr'      // RF Reset
    };
    
    RF.ui.sendSensorCommand = function (command, sensor, ...args) {
        const sensorArg = sensor === 'input' ? 'i' : 'o';
        const mappedCmd = sensorCmdMap[command] || command;
        const fullCmd = `${mappedCmd} ${sensorArg} ${args.join(' ')}`.trim();
        RF.core.sendCommand(fullCmd);
    };

    // Graph mode switching
    let currentDataMode = 'time'; // 'time' or 'fft'

    // FFT data storage for V/I dual channel
    const fftDataStorage = {
        input: { voltage: null, current: null, visibility: { voltage: true, current: true } },
        output: { voltage: null, current: null, visibility: { voltage: true, current: true } }
    };

    // Expose FFT data storage getter
    RF.ui.getFftDataStorage = function () {
        return fftDataStorage;
    };

    // Toggle visibility for FFT legend
    RF.ui.toggleFftVisibility = function (sensor, channel) {
        if (fftDataStorage[sensor]) {
            fftDataStorage[sensor].visibility[channel] = !fftDataStorage[sensor].visibility[channel];
            // Redraw the graph
            RF.ui.drawFftDualGraph(sensor);
        }
    };

    RF.ui.switchToFFTMode = function () {
        if (currentDataMode === 'fft') return; // Already in FFT mode

        const rfGraphInput = document.getElementById('rfGraphInput');
        const rfGraphOutput = document.getElementById('rfGraphOutput');
        const fftGraphInput = document.getElementById('fftGraphInput');
        const fftGraphOutput = document.getElementById('fftGraphOutput');
        const title = document.getElementById('dataPanelTitle');
        const btnToggle = document.getElementById('btnToggleData');

        if (rfGraphInput) rfGraphInput.style.display = 'none';
        if (rfGraphOutput) rfGraphOutput.style.display = 'none';
        if (fftGraphInput) fftGraphInput.style.display = 'block';
        if (fftGraphOutput) fftGraphOutput.style.display = 'block';
        if (title) title.textContent = 'Frequency Domain (FFT)';
        if (btnToggle) btnToggle.textContent = '↔ Time';

        currentDataMode = 'fft';
    };

    RF.ui.switchToTimeMode = function () {
        if (currentDataMode === 'time') return; // Already in Time mode

        const rfGraphInput = document.getElementById('rfGraphInput');
        const rfGraphOutput = document.getElementById('rfGraphOutput');
        const fftGraphInput = document.getElementById('fftGraphInput');
        const fftGraphOutput = document.getElementById('fftGraphOutput');
        const title = document.getElementById('dataPanelTitle');
        const btnToggle = document.getElementById('btnToggleData');

        if (rfGraphInput) rfGraphInput.style.display = 'block';
        if (rfGraphOutput) rfGraphOutput.style.display = 'block';
        if (fftGraphInput) fftGraphInput.style.display = 'none';
        if (fftGraphOutput) fftGraphOutput.style.display = 'none';
        if (title) title.textContent = 'Time Domain';
        if (btnToggle) btnToggle.textContent = '↔ FFT';

        currentDataMode = 'time';
    };

    // FFT graph update (Voltage channel)
    RF.ui.updateFftGraph = function (sensor, fftData) {
        console.log(`Updating FFT Voltage graph for ${sensor} sensor with ${fftData.length} points`);

        // Store voltage FFT data
        fftDataStorage[sensor].voltage = fftData.slice();

        // Switch to FFT mode
        RF.ui.switchToFFTMode();

        // If current data is already available, draw dual graph
        // Otherwise, draw voltage only (current will trigger full draw when it arrives)
        RF.ui.drawFftDualGraph(sensor);
    };

    // FFT graph update (Current channel)
    RF.ui.updateFftGraphCurrent = function (sensor, fftData) {
        console.log(`Updating FFT Current graph for ${sensor} sensor with ${fftData.length} points`);

        // Store current FFT data
        fftDataStorage[sensor].current = fftData.slice();

        // Switch to FFT mode
        RF.ui.switchToFFTMode();

        // Draw dual graph (voltage should already be available)
        RF.ui.drawFftDualGraph(sensor);
    };

    // Draw FFT dual channel graph (V and I with independent Y-axes)
    RF.ui.drawFftDualGraph = function (sensor, highlightIndex = -1) {
        const storage = fftDataStorage[sensor];
        const settings = fftSettings[sensor];
        const canvasId = sensor === 'input' ? 'fftGraphInput' : 'fftGraphOutput';
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;

        // Get zoom/pan state from charts.js
        const viewState = RF.ui.getFftViewState ? RF.ui.getFftViewState(canvasId) : null;
        const viewStart = viewState ? viewState.start : 0;
        const viewEnd = viewState ? viewState.end : 1;

        // Clear
        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, w, h);

        // Draw grid line at half height
        ctx.strokeStyle = '#333';
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();

        const margin = (settings.margin || 10) / 100;
        const visibility = storage.visibility;
        const independentAxis = settings.independentAxis !== false; // Default true

        // Calculate visible data range
        const dataLength = storage.voltage ? storage.voltage.length : (storage.current ? storage.current.length : 0);
        const startIdx = Math.floor(viewStart * dataLength);
        const endIdx = Math.ceil(viewEnd * dataLength);
        
        // Get visible data slices
        const visibleVoltage = storage.voltage ? storage.voltage.slice(startIdx, endIdx) : null;
        const visibleCurrent = storage.current ? storage.current.slice(startIdx, endIdx) : null;

        // Calculate Y-axis ranges based on visible data
        let vMin = 0, vMax = 1, iMin = 0, iMax = 1;
        
        if (independentAxis) {
            // Independent Y-axes for V and I
            if (visibleVoltage && visibleVoltage.length > 0) {
                const vMaxVal = Math.max(...visibleVoltage, 0.001);
                vMin = 0;
                vMax = vMaxVal * (1 + margin);
            }
            
            if (visibleCurrent && visibleCurrent.length > 0) {
                const iMaxVal = Math.max(...visibleCurrent, 0.001);
                iMin = 0;
                iMax = iMaxVal * (1 + margin);
            }
        } else {
            // Shared Y-axis for V and I
            const allValues = [];
            if (visibleVoltage) allValues.push(...visibleVoltage);
            if (visibleCurrent) allValues.push(...visibleCurrent);
            
            if (allValues.length > 0) {
                const maxVal = Math.max(...allValues, 0.001);
                vMin = iMin = 0;
                vMax = iMax = maxVal * (1 + margin);
            }
        }

        const vRange = vMax - vMin || 1;
        const iRange = iMax - iMin || 1;
        const visibleCount = endIdx - startIdx;

        // Get baseline offsets (% of canvas height)
        const vOffset = (settings.vOffset || 0) / 100 * h;
        const iOffset = (settings.iOffset || 0) / 100 * h;

        // Calculate which visible bar index is highlighted
        const highlightVisibleIndex = (highlightIndex >= startIdx && highlightIndex < endIdx) 
            ? highlightIndex - startIdx : -1;

        // Draw Voltage FFT (green) if visible - prioritize for highlight
        if (visibleVoltage && visibility.voltage && visibleCount > 0) {
            const barWidth = w / visibleCount;
            
            visibleVoltage.forEach((val, i) => {
                const normalizedVal = Math.max(0, Math.min(1, (val - vMin) / vRange));
                const barH = normalizedVal * h;
                // Apply V offset to baseline
                const baseY = h - vOffset;
                // Highlight this bar if it matches
                if (i === highlightVisibleIndex) {
                    ctx.fillStyle = '#ffffff'; // White highlight
                } else {
                    ctx.fillStyle = 'rgba(78, 201, 176, 0.7)'; // #4ec9b0 with alpha
                }
                ctx.fillRect(i * barWidth, baseY - barH, Math.max(barWidth - 1, 1), barH);
            });
        }

        // Draw Current FFT (yellow) if visible - highlight only if voltage not visible
        if (visibleCurrent && visibility.current && visibleCount > 0) {
            const barWidth = w / visibleCount;
            const shouldHighlightCurrent = !visibility.voltage; // Only highlight current if voltage hidden
            
            visibleCurrent.forEach((val, i) => {
                const normalizedVal = Math.max(0, Math.min(1, (val - iMin) / iRange));
                const barH = normalizedVal * h;
                // Apply I offset to baseline
                const baseY = h - iOffset;
                // Highlight this bar if voltage is hidden and this is the hover index
                if (shouldHighlightCurrent && i === highlightVisibleIndex) {
                    ctx.fillStyle = '#ffffff'; // White highlight
                } else {
                    ctx.fillStyle = 'rgba(220, 220, 170, 0.7)'; // #dcdcaa with alpha
                }
                // Offset slightly to see both bars
                ctx.fillRect(i * barWidth + 1, baseY - barH, Math.max(barWidth - 2, 1), barH);
            });
        }

        // Draw clickable legend
        const legendX = w - 130;
        const legendY = 10;
        const boxSize = 12;
        const textOffset = 18;

        // Voltage legend
        ctx.fillStyle = visibility.voltage ? '#4ec9b0' : '#333';
        ctx.fillRect(legendX, legendY, boxSize, boxSize);
        ctx.strokeStyle = '#4ec9b0';
        ctx.strokeRect(legendX, legendY, boxSize, boxSize);
        ctx.fillStyle = visibility.voltage ? '#ccc' : '#666';
        ctx.font = '11px sans-serif';
        ctx.fillText('Voltage', legendX + textOffset, legendY + 10);

        // Current legend
        ctx.fillStyle = visibility.current ? '#dcdcaa' : '#333';
        ctx.fillRect(legendX, legendY + 18, boxSize, boxSize);
        ctx.strokeStyle = '#dcdcaa';
        ctx.strokeRect(legendX, legendY + 18, boxSize, boxSize);
        ctx.fillStyle = visibility.current ? '#ccc' : '#666';
        ctx.fillText('Current', legendX + textOffset, legendY + 28);

        // Store legend click areas for event handling
        canvas.legendAreas = [
            { x: legendX, y: legendY, w: 80, h: 14, channel: 'voltage' },
            { x: legendX, y: legendY + 18, w: 80, h: 14, channel: 'current' }
        ];
        canvas.fftSensor = sensor;

        // Set lastDrawData for tooltip functionality
        canvas.lastDrawData = {
            type: 'fftDual',
            voltage: storage.voltage,
            current: storage.current,
            visibility: visibility,
            viewStart: viewStart,
            viewEnd: viewEnd,
            ranges: {
                voltage: [vMin, vMax],
                current: [iMin, iMax]
            },
            sensor: sensor,
            samplingRate: settings.samplingRate,
            fftLength: settings.fftLength,
            mode: 'fft',
            xAxisDisplay: settings.xAxisDisplay
        };
    };

    // Strip chart data storage
    const stripChartData = {
        input: { voltage: [], current: [], maxPoints: 100 },
        output: { voltage: [], current: [], maxPoints: 100 }
    };

    RF.ui.updateStripChart = function (sensor, voltage, current) {
        console.log(`Updating strip chart for ${sensor}: V=${voltage}, I=${current}`);

        // Switch to time mode
        RF.ui.switchToTimeMode();

        // Store data
        const data = stripChartData[sensor];
        data.voltage.push(voltage);
        data.current.push(current);

        // Keep only last maxPoints
        if (data.voltage.length > data.maxPoints) {
            data.voltage.shift();
            data.current.shift();
        }

        // Draw strip chart
        const canvasId = sensor === 'input' ? 'rfGraphInput' : 'rfGraphOutput';
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;

        // Clear
        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, w, h);

        // Grid (center line)
        ctx.strokeStyle = '#222';
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();

        // Get margin and offset from settings
        const settings = fftSettings[sensor];
        const margin = (settings.margin || 10) / 100;
        const vOffsetPx = (settings.vOffset || 0) / 100 * h;  // V offset in pixels
        const iOffsetPx = (settings.iOffset || 0) / 100 * h;  // I offset in pixels

        // Calculate independent Y-axis ranges for Voltage and Current
        const vMin = Math.min(...data.voltage);
        const vMax = Math.max(...data.voltage);
        const vRange = vMax - vMin || 1;
        const vMinWithMargin = vMin - vRange * margin;
        const vMaxWithMargin = vMax + vRange * margin;
        const vRangeWithMargin = vMaxWithMargin - vMinWithMargin;

        const iMin = Math.min(...data.current);
        const iMax = Math.max(...data.current);
        const iRange = iMax - iMin || 1;
        const iMinWithMargin = iMin - iRange * margin;
        const iMaxWithMargin = iMax + iRange * margin;
        const iRangeWithMargin = iMaxWithMargin - iMinWithMargin;

        const step = w / (data.maxPoints - 1);

        // Draw voltage (green) - independent Y-axis (left) with offset
        if (data.voltage.length > 1) {
            ctx.strokeStyle = '#4ec9b0';
            ctx.lineWidth = 2;
            ctx.beginPath();

            data.voltage.forEach((val, i) => {
                const x = i * step;
                const y = h - ((val - vMinWithMargin) / vRangeWithMargin) * h - vOffsetPx;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            });
            ctx.stroke();
        }

        // Draw current (yellow) - independent Y-axis (right) with offset
        if (data.current.length > 1) {
            ctx.strokeStyle = '#dcdcaa';
            ctx.lineWidth = 2;
            ctx.beginPath();

            data.current.forEach((val, i) => {
                const x = i * step;
                const y = h - ((val - iMinWithMargin) / iRangeWithMargin) * h - iOffsetPx;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            });
            ctx.stroke();
        }

        // Draw legend with range info
        ctx.fillStyle = '#4ec9b0';
        ctx.fillRect(10, 10, 15, 10);
        ctx.fillStyle = '#ccc';
        ctx.font = '10px sans-serif';
        ctx.fillText(`V: ${vMin.toFixed(1)}~${vMax.toFixed(1)}`, 30, 19);

        ctx.fillStyle = '#dcdcaa';
        ctx.fillRect(10, 25, 15, 10);
        ctx.fillStyle = '#ccc';
        ctx.fillText(`I: ${iMin.toFixed(1)}~${iMax.toFixed(1)}`, 30, 34);

        // IMPORTANT: Set lastDrawData for tooltip functionality
        canvas.lastDrawData = {
            type: 'line',
            dataArrays: [data.voltage.slice(), data.current.slice()],  // Copy arrays
            colors: ['#4ec9b0', '#dcdcaa'],
            ranges: {  // Store individual ranges for each data series
                voltage: [vMinWithMargin, vMaxWithMargin],
                current: [iMinWithMargin, iMaxWithMargin]
            },
            offsets: {  // Store offsets for V/I baselines
                voltage: vOffsetPx,
                current: iOffsetPx
            },
            sensor: sensor,
            samplingRate: settings.samplingRate,
            mode: 'time',
            xAxisDisplay: settings.xAxisDisplay
        };
    };

})();
