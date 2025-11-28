/**
 * VVC Calibration Helper - Main Application
 * Data management, UI interactions, and interactive graph
 */

(function () {
    'use strict';

    // ========== State ==========
    const state = {
        selectedVvc: 0,
        stepInterval: 1000,
        vnaFrequency: 13.56, // MHz
        currentPosition: null,
        dataPoints: [], // { id, step, reactance, capacitance, selected }
        lastFittingResult: null,
        nextDataId: 1,
        positionStreamRunning: false,
        positionStreamRate: 100 // ms
    };

    // ========== Graph State ==========
    const graphState = {
        canvas: null,
        ctx: null,
        // View transform
        offsetX: 60,
        offsetY: 20,
        scaleX: 1,
        scaleY: 1,
        // Data bounds
        dataMinX: 0,
        dataMaxX: 100,
        dataMinY: 0,
        dataMaxY: 100,
        // Interaction
        isDragging: false,
        lastMouseX: 0,
        lastMouseY: 0,
        panOffsetX: 0,
        panOffsetY: 0,
        zoomLevel: 1,
        // Tooltip
        hoveredPoint: null
    };

    // ========== Constants ==========
    const GRAPH_PADDING = { top: 30, right: 30, bottom: 50, left: 70 };
    const POINT_RADIUS = 5;
    const SELECTED_RADIUS = 7;

    // ========== Initialization ==========
    document.addEventListener('DOMContentLoaded', init);

    function init() {
        setupSerialCallbacks();
        setupEventListeners();
        setupGraph();
        loadFromLocalStorage();
        updateUI();
    }

    // ========== Serial Communication ==========
    function setupSerialCallbacks() {
        VVCSerial.setLogCallback((message, type) => {
            logToTerminal(message, type);
        });

        VVCSerial.setDataCallback((opcode, data) => {
            handleSerialData(opcode, data);
        });
    }

    function handleSerialData(opcode, data) {
        if (opcode === 'MGP') {
            if (data.motorIndex === state.selectedVvc) {
                state.currentPosition = data.position;
                updatePositionDisplay();
            }
        } else if (opcode === 'MPB') {
            const motorData = state.selectedVvc === 0 ? data.motor0 : data.motor1;
            state.currentPosition = motorData.position;
            updatePositionDisplay();
        }
    }

    // ========== Event Listeners ==========
    function setupEventListeners() {
        // Connection buttons
        document.getElementById('btnRequestPort').addEventListener('click', async () => {
            const success = await VVCSerial.requestPort();
            if (success) {
                document.getElementById('btnConnect').disabled = false;
            }
        });

        document.getElementById('btnConnect').addEventListener('click', async () => {
            const baudRate = parseInt(document.getElementById('baudRate').value);
            try {
                await VVCSerial.connect(baudRate);
                updateConnectionUI(true);
            } catch (e) {
                logToTerminal('Connection failed: ' + e.message, 'error');
            }
        });

        document.getElementById('btnDisconnect').addEventListener('click', async () => {
            await VVCSerial.disconnect();
            updateConnectionUI(false);
        });

        // VVC Selection
        document.querySelectorAll('input[name="vvcSelect"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                state.selectedVvc = parseInt(e.target.value);
                state.currentPosition = null;
                updatePositionDisplay();
            });
        });

        // Settings inputs
        document.getElementById('stepInterval').addEventListener('change', (e) => {
            state.stepInterval = parseInt(e.target.value) || 1000;
        });

        document.getElementById('vnaFrequency').addEventListener('change', (e) => {
            state.vnaFrequency = parseFloat(e.target.value) || 13.56;
            updateCapacitancePreview();
        });

        // Motor control
        document.getElementById('btnStandby').addEventListener('click', async () => {
            await VVCSerial.motorStandby(state.selectedVvc);
            logToTerminal(`Motor ${state.selectedVvc}: Standby`, 'info');
        });

        document.getElementById('btnDisable').addEventListener('click', async () => {
            await VVCSerial.motorDisable(state.selectedVvc);
            logToTerminal(`Motor ${state.selectedVvc}: Disabled`, 'info');
        });

        document.getElementById('btnSetOrigin').addEventListener('click', async () => {
            if (!confirm(`Set current position as origin for VVC ${state.selectedVvc}?`)) return;
            await VVCSerial.motorSetOrigin(state.selectedVvc);
            logToTerminal(`Motor ${state.selectedVvc}: Origin set`, 'info');
        });

        document.getElementById('btnReadPos').addEventListener('click', async () => {
            try {
                const result = await VVCSerial.readMotorPosition(state.selectedVvc);
                state.currentPosition = result.position;
                updatePositionDisplay();
            } catch (e) {
                logToTerminal('Failed to read position: ' + e.message, 'error');
            }
        });

        document.getElementById('btnPosStreamToggle').addEventListener('click', async () => {
            const btn = document.getElementById('btnPosStreamToggle');
            if (state.positionStreamRunning) {
                await VVCSerial.stopPositionStream();
                state.positionStreamRunning = false;
                btn.textContent = 'Run Stream';
                btn.classList.remove('active');
                logToTerminal('Position stream stopped', 'info');
            } else {
                await VVCSerial.startPositionStream(state.positionStreamRate);
                state.positionStreamRunning = true;
                btn.textContent = 'Stop Stream';
                btn.classList.add('active');
                logToTerminal(`Position stream started @ ${state.positionStreamRate}ms`, 'info');
            }
        });

        document.getElementById('btnPrevStep').addEventListener('click', async () => {
            if (state.currentPosition === null) {
                logToTerminal('Read position first', 'error');
                return;
            }
            const newPos = Math.max(0, state.currentPosition - state.stepInterval);
            await VVCSerial.moveMotor(state.selectedVvc, newPos);
            state.currentPosition = newPos;
            updatePositionDisplay();
            document.getElementById('targetPosition').value = newPos;
        });

        document.getElementById('btnNextStep').addEventListener('click', handleNextStep);
        document.getElementById('btnNextStep').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleNextStep();
            }
        });

        async function handleNextStep() {
            if (state.currentPosition === null) {
                logToTerminal('Read position first', 'error');
                return;
            }
            const newPos = state.currentPosition + state.stepInterval;
            await VVCSerial.moveMotor(state.selectedVvc, newPos);
            state.currentPosition = newPos;
            updatePositionDisplay();
            document.getElementById('targetPosition').value = newPos;
            // Focus on reactance input for next measurement
            document.getElementById('reactanceInput').focus();
        }

        document.getElementById('btnMoveToTarget').addEventListener('click', async () => {
            const targetPos = parseInt(document.getElementById('targetPosition').value) || 0;
            await VVCSerial.moveMotor(state.selectedVvc, targetPos);
            state.currentPosition = targetPos;
            updatePositionDisplay();
        });

        // Reactance input
        document.getElementById('reactanceInput').addEventListener('input', updateCapacitancePreview);
        document.getElementById('reactanceInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                recordDataPoint();
                // Focus on Next Step button for workflow continuation
                document.getElementById('btnNextStep').focus();
            }
        });

        // Record data
        document.getElementById('btnRecordData').addEventListener('click', recordDataPoint);
        document.getElementById('btnRecordData').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                recordDataPoint();
                // Focus on Next Step button for workflow continuation
                document.getElementById('btnNextStep').focus();
            }
        });

        // Terminal
        document.getElementById('btnSend').addEventListener('click', sendTerminalCommand);
        document.getElementById('cmdInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendTerminalCommand();
        });

        // Table actions
        document.getElementById('btnClearData').addEventListener('click', clearAllData);
        document.getElementById('btnExportCsv').addEventListener('click', exportToCsv);
        document.getElementById('btnImportCsv').addEventListener('click', () => {
            document.getElementById('csvFileInput').click();
        });
        document.getElementById('csvFileInput').addEventListener('change', importFromCsv);

        // Fitting
        document.getElementById('btnFitSelected').addEventListener('click', () => fitCurve(true));
        document.getElementById('btnFitAll').addEventListener('click', () => fitCurve(false));

        // Graph
        document.getElementById('btnResetZoom').addEventListener('click', resetGraphZoom);

        // Window resize
        window.addEventListener('resize', debounce(resizeGraph, 100));
    }

    // ========== UI Updates ==========
    function updateConnectionUI(connected) {
        document.getElementById('btnConnect').disabled = connected;
        document.getElementById('btnDisconnect').disabled = !connected;
        const status = document.getElementById('connectionStatus');
        status.textContent = connected ? 'Connected' : 'Disconnected';
        status.className = 'status-badge ' + (connected ? 'connected' : 'disconnected');
    }

    function updatePositionDisplay() {
        const display = document.getElementById('currentPosition');
        display.textContent = state.currentPosition !== null ? state.currentPosition : '--';
    }

    function updateCapacitancePreview() {
        const reactanceInput = document.getElementById('reactanceInput');
        const display = document.getElementById('calculatedCapacitance');
        const X = parseFloat(reactanceInput.value);

        if (isNaN(X) || X === 0) {
            display.textContent = '-- pF';
            return;
        }

        const capacitance = calculateCapacitance(X, state.vnaFrequency);
        display.textContent = capacitance.toFixed(2) + ' pF';
    }

    function calculateCapacitance(reactance, frequencyMHz) {
        // C = -1 / (2 * π * f * X)
        // f in Hz, result in Farads, convert to pF
        const f = frequencyMHz * 1e6;
        const C = -1 / (2 * Math.PI * f * reactance);
        return C * 1e12; // Convert to pF
    }

    // ========== Data Management ==========
    function recordDataPoint() {
        const reactance = parseFloat(document.getElementById('reactanceInput').value);

        if (isNaN(reactance) || reactance === 0) {
            logToTerminal('Enter a valid reactance value', 'error');
            return;
        }

        if (state.currentPosition === null) {
            logToTerminal('Read motor position first', 'error');
            return;
        }

        const capacitance = calculateCapacitance(reactance, state.vnaFrequency);

        const dataPoint = {
            id: state.nextDataId++,
            step: state.currentPosition,
            reactance: reactance,
            capacitance: capacitance,
            selected: true // Auto-select new points
        };

        state.dataPoints.push(dataPoint);
        updateDataTable();
        updateGraph();
        saveToLocalStorage();

        // Clear input for next measurement
        document.getElementById('reactanceInput').value = '';
        document.getElementById('calculatedCapacitance').textContent = '-- pF';

        logToTerminal(`Recorded: Step=${dataPoint.step}, X=${reactance}Ω, C=${capacitance.toFixed(2)}pF`, 'info');
    }

    function updateDataTable() {
        const tbody = document.getElementById('dataTableBody');
        tbody.innerHTML = '';

        state.dataPoints.forEach((point, index) => {
            const tr = document.createElement('tr');
            tr.className = point.selected ? 'selected' : '';
            tr.dataset.id = point.id;

            tr.innerHTML = `
                <td>${index + 1}</td>
                <td>${point.step}</td>
                <td>${point.reactance.toFixed(2)}</td>
                <td>${point.capacitance.toFixed(2)}</td>
                <td><button class="delete-btn" data-id="${point.id}">×</button></td>
            `;

            tr.addEventListener('click', (e) => {
                if (e.target.classList.contains('delete-btn')) return;
                togglePointSelection(point.id, e.ctrlKey, e.shiftKey, index);
            });

            tbody.appendChild(tr);
        });

        // Delete button handlers
        tbody.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteDataPoint(parseInt(btn.dataset.id));
            });
        });

        updateDataCounts();
    }

    function togglePointSelection(id, ctrlKey, shiftKey, index) {
        if (shiftKey && state.lastSelectedIndex !== undefined) {
            // Range selection
            const start = Math.min(state.lastSelectedIndex, index);
            const end = Math.max(state.lastSelectedIndex, index);
            for (let i = start; i <= end; i++) {
                state.dataPoints[i].selected = true;
            }
        } else if (ctrlKey) {
            // Toggle single
            const point = state.dataPoints.find(p => p.id === id);
            if (point) point.selected = !point.selected;
        } else {
            // Single select (deselect others)
            state.dataPoints.forEach(p => p.selected = p.id === id);
        }

        state.lastSelectedIndex = index;
        updateDataTable();
        updateGraph();
    }

    function deleteDataPoint(id) {
        state.dataPoints = state.dataPoints.filter(p => p.id !== id);
        updateDataTable();
        updateGraph();
        saveToLocalStorage();
    }

    function clearAllData() {
        if (state.dataPoints.length === 0) return;
        if (!confirm('Clear all data points?')) return;

        state.dataPoints = [];
        state.lastFittingResult = null;
        updateDataTable();
        updateGraph();
        updateFittingResults(null);
        saveToLocalStorage();
    }

    function updateDataCounts() {
        const total = state.dataPoints.length;
        const selected = state.dataPoints.filter(p => p.selected).length;
        document.getElementById('dataCount').textContent = `${total} point${total !== 1 ? 's' : ''}`;
        document.getElementById('selectedCount').textContent = `${selected} selected`;
    }

    // ========== CSV Import/Export ==========
    function exportToCsv() {
        if (state.dataPoints.length === 0) {
            logToTerminal('No data to export', 'error');
            return;
        }

        const header = 'Index,Step,Reactance_Ohm,Capacitance_pF\n';
        const rows = state.dataPoints.map((p, i) =>
            `${i + 1},${p.step},${p.reactance.toFixed(4)},${p.capacitance.toFixed(4)}`
        ).join('\n');

        const csv = header + rows;
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `vvc${state.selectedVvc}_calibration_${Date.now()}.csv`;
        a.click();

        URL.revokeObjectURL(url);
        logToTerminal('CSV exported successfully', 'info');
    }

    function importFromCsv(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const lines = event.target.result.split('\n');
                const imported = [];

                for (let i = 1; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (!line) continue;

                    const parts = line.split(',');
                    if (parts.length < 4) continue;

                    const step = parseInt(parts[1]);
                    const reactance = parseFloat(parts[2]);
                    const capacitance = parseFloat(parts[3]);

                    if (!isNaN(step) && !isNaN(reactance) && !isNaN(capacitance)) {
                        imported.push({
                            id: state.nextDataId++,
                            step,
                            reactance,
                            capacitance,
                            selected: true
                        });
                    }
                }

                if (imported.length > 0) {
                    state.dataPoints = [...state.dataPoints, ...imported];
                    updateDataTable();
                    updateGraph();
                    saveToLocalStorage();
                    logToTerminal(`Imported ${imported.length} data points`, 'info');
                } else {
                    logToTerminal('No valid data found in CSV', 'error');
                }
            } catch (err) {
                logToTerminal('CSV import error: ' + err.message, 'error');
            }
        };

        reader.readAsText(file);
        e.target.value = ''; // Reset file input
    }

    // ========== Curve Fitting ==========
    function fitCurve(selectedOnly) {
        const points = selectedOnly
            ? state.dataPoints.filter(p => p.selected)
            : state.dataPoints;

        if (points.length < 2) {
            logToTerminal('Need at least 2 data points for fitting', 'error');
            return;
        }

        const fittingType = document.getElementById('fittingType').value;
        const xyPoints = points.map(p => ({ x: p.step, y: p.capacitance }));

        try {
            const result = VVCFitting.fit(xyPoints, fittingType);
            state.lastFittingResult = result;
            updateFittingResults(result);
            updateGraph();
            logToTerminal(`Fitting complete: R² = ${result.stats.r2.toFixed(4)}`, 'info');
        } catch (err) {
            logToTerminal('Fitting error: ' + err.message, 'error');
        }
    }

    function updateFittingResults(result) {
        const container = document.getElementById('fittingResults');

        if (!result) {
            container.innerHTML = '<div class="result-placeholder">Select data points and click "Fit" to calculate</div>';
            return;
        }

        // For polynomial fitting, show NORMALIZED coefficients for firmware use
        let coeffsHtml = '';
        if (result.type && result.type.startsWith('poly')) {
            // Use normalized coefficients - these are what firmware will use
            const coeffs = result.normalizedCoeffs || [];
            
            // Always show 4 coefficients (a0~a3) in single column (vertical)
            const labels = ['a0 (const)', 'a1 (×xNorm)', 'a2 (×xNorm²)', 'a3 (×xNorm³)'];
            
            coeffsHtml = '<div class="fitting-coeffs">';
            coeffsHtml += '<div class="coeff-section-title" style="font-weight:bold;margin-bottom:5px;color:#0af;">Normalized Coefficients (for VVC Settings):</div>';
            // Single column (vertical) layout
            for (let i = 0; i <= 3; i++) {
                const val = i < coeffs.length ? coeffs[i] : 0;
                coeffsHtml += `<div class="coeff-row" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;"><span class="coeff-label" style="font-size:0.85em;color:#888;">${labels[i]}:</span><input type="text" class="coeff-value" style="width:140px;text-align:right;" value="${val}" readonly onclick="this.select()"></div>`;
            }
            // Note: xNorm = (step - Motor Min) / (Motor Max - Motor Min)
            coeffsHtml += '<div style="margin-top:8px;font-size:0.8em;color:#888;">Note: xNorm = (step - Min) / (Max - Min)</div>';
            coeffsHtml += '</div>';
        }

        container.innerHTML = `
            <div class="fitting-equation">${result.equation}</div>
            ${coeffsHtml}
            <div class="fitting-stats">
                <span><span class="label">R²:</span> <span class="value">${result.stats.r2.toFixed(6)}</span></span>
                <span><span class="label">RMSE:</span> <span class="value">${result.stats.rmse.toFixed(4)} pF</span></span>
                <span><span class="label">Points:</span> <span class="value">${result.stats.n}</span></span>
            </div>
        `;
    }

    // ========== Graph ==========
    function setupGraph() {
        graphState.canvas = document.getElementById('calibrationGraph');
        graphState.ctx = graphState.canvas.getContext('2d');

        // Mouse events
        graphState.canvas.addEventListener('wheel', handleGraphWheel, { passive: false });
        graphState.canvas.addEventListener('mousedown', handleGraphMouseDown);
        graphState.canvas.addEventListener('mousemove', handleGraphMouseMove);
        graphState.canvas.addEventListener('mouseup', handleGraphMouseUp);
        graphState.canvas.addEventListener('mouseleave', handleGraphMouseLeave);
        graphState.canvas.addEventListener('dblclick', resetGraphZoom);

        resizeGraph();
    }

    function resizeGraph() {
        const container = graphState.canvas.parentElement;
        const rect = container.getBoundingClientRect();

        // Set canvas size with device pixel ratio for sharp rendering
        const dpr = window.devicePixelRatio || 1;
        graphState.canvas.width = rect.width * dpr;
        graphState.canvas.height = rect.height * dpr;
        graphState.canvas.style.width = rect.width + 'px';
        graphState.canvas.style.height = rect.height + 'px';

        graphState.ctx.scale(dpr, dpr);
        graphState.width = rect.width;
        graphState.height = rect.height;

        updateGraph();
    }

    function updateGraph() {
        const ctx = graphState.ctx;
        const w = graphState.width;
        const h = graphState.height;

        if (!ctx || !w || !h) return;

        // Clear
        ctx.clearRect(0, 0, w, h);

        // Calculate data bounds
        calculateDataBounds();

        // Draw
        drawAxes();
        drawGridLines();
        drawFittingCurve();
        drawDataPoints();
    }

    function calculateDataBounds() {
        if (state.dataPoints.length === 0) {
            graphState.dataMinX = 0;
            graphState.dataMaxX = 100;
            graphState.dataMinY = 0;
            graphState.dataMaxY = 100;
            return;
        }

        const steps = state.dataPoints.map(p => p.step);
        const caps = state.dataPoints.map(p => p.capacitance);

        graphState.dataMinX = Math.min(...steps);
        graphState.dataMaxX = Math.max(...steps);
        graphState.dataMinY = Math.min(...caps);
        graphState.dataMaxY = Math.max(...caps);

        // Add padding
        const xPad = (graphState.dataMaxX - graphState.dataMinX) * 0.1 || 100;
        const yPad = (graphState.dataMaxY - graphState.dataMinY) * 0.1 || 10;

        graphState.dataMinX -= xPad;
        graphState.dataMaxX += xPad;
        graphState.dataMinY -= yPad;
        graphState.dataMaxY += yPad;

        // Ensure min Y is not negative for capacitance
        if (graphState.dataMinY < 0) graphState.dataMinY = 0;
    }

    function getPlotArea() {
        const zoom = graphState.zoomLevel;
        const panX = graphState.panOffsetX;
        const panY = graphState.panOffsetY;

        return {
            x: GRAPH_PADDING.left,
            y: GRAPH_PADDING.top,
            w: graphState.width - GRAPH_PADDING.left - GRAPH_PADDING.right,
            h: graphState.height - GRAPH_PADDING.top - GRAPH_PADDING.bottom,
            zoom,
            panX,
            panY
        };
    }

    function dataToCanvas(dataX, dataY) {
        const plot = getPlotArea();
        const rangeX = graphState.dataMaxX - graphState.dataMinX;
        const rangeY = graphState.dataMaxY - graphState.dataMinY;

        let x = plot.x + ((dataX - graphState.dataMinX) / rangeX) * plot.w;
        let y = plot.y + plot.h - ((dataY - graphState.dataMinY) / rangeY) * plot.h;

        // Apply zoom and pan
        const centerX = plot.x + plot.w / 2;
        const centerY = plot.y + plot.h / 2;

        x = centerX + (x - centerX) * plot.zoom + plot.panX;
        y = centerY + (y - centerY) * plot.zoom + plot.panY;

        return { x, y };
    }

    function canvasToData(canvasX, canvasY) {
        const plot = getPlotArea();
        const rangeX = graphState.dataMaxX - graphState.dataMinX;
        const rangeY = graphState.dataMaxY - graphState.dataMinY;

        // Reverse zoom and pan
        const centerX = plot.x + plot.w / 2;
        const centerY = plot.y + plot.h / 2;

        let x = (canvasX - plot.panX - centerX) / plot.zoom + centerX;
        let y = (canvasY - plot.panY - centerY) / plot.zoom + centerY;

        const dataX = graphState.dataMinX + ((x - plot.x) / plot.w) * rangeX;
        const dataY = graphState.dataMinY + ((plot.y + plot.h - y) / plot.h) * rangeY;

        return { x: dataX, y: dataY };
    }

    function drawAxes() {
        const ctx = graphState.ctx;
        const plot = getPlotArea();

        ctx.strokeStyle = '#444';
        ctx.lineWidth = 1;

        // X axis
        ctx.beginPath();
        ctx.moveTo(plot.x, plot.y + plot.h);
        ctx.lineTo(plot.x + plot.w, plot.y + plot.h);
        ctx.stroke();

        // Y axis
        ctx.beginPath();
        ctx.moveTo(plot.x, plot.y);
        ctx.lineTo(plot.x, plot.y + plot.h);
        ctx.stroke();

        // Labels
        ctx.fillStyle = '#888';
        ctx.font = '11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Step Position', plot.x + plot.w / 2, graphState.height - 10);

        ctx.save();
        ctx.translate(15, plot.y + plot.h / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('Capacitance (pF)', 0, 0);
        ctx.restore();
    }

    function drawGridLines() {
        const ctx = graphState.ctx;
        const plot = getPlotArea();

        ctx.strokeStyle = '#2a2a2a';
        ctx.lineWidth = 1;
        ctx.fillStyle = '#666';
        ctx.font = '10px JetBrains Mono, monospace';

        // X grid lines
        const xTicks = calculateTicks(graphState.dataMinX, graphState.dataMaxX, 6);
        xTicks.forEach(tick => {
            const pos = dataToCanvas(tick, graphState.dataMinY);
            if (pos.x >= plot.x && pos.x <= plot.x + plot.w) {
                ctx.beginPath();
                ctx.moveTo(pos.x, plot.y);
                ctx.lineTo(pos.x, plot.y + plot.h);
                ctx.stroke();

                ctx.textAlign = 'center';
                ctx.fillText(formatTickLabel(tick), pos.x, plot.y + plot.h + 15);
            }
        });

        // Y grid lines
        const yTicks = calculateTicks(graphState.dataMinY, graphState.dataMaxY, 5);
        yTicks.forEach(tick => {
            const pos = dataToCanvas(graphState.dataMinX, tick);
            if (pos.y >= plot.y && pos.y <= plot.y + plot.h) {
                ctx.beginPath();
                ctx.moveTo(plot.x, pos.y);
                ctx.lineTo(plot.x + plot.w, pos.y);
                ctx.stroke();

                ctx.textAlign = 'right';
                ctx.fillText(formatTickLabel(tick), plot.x - 8, pos.y + 4);
            }
        });
    }

    function calculateTicks(min, max, count) {
        const range = max - min;
        const step = Math.pow(10, Math.floor(Math.log10(range / count)));
        const normalizedStep = range / count / step;

        let tickStep;
        if (normalizedStep <= 1) tickStep = step;
        else if (normalizedStep <= 2) tickStep = step * 2;
        else if (normalizedStep <= 5) tickStep = step * 5;
        else tickStep = step * 10;

        const ticks = [];
        let tick = Math.ceil(min / tickStep) * tickStep;
        while (tick <= max) {
            ticks.push(tick);
            tick += tickStep;
        }
        return ticks;
    }

    function formatTickLabel(value) {
        if (Math.abs(value) >= 10000) {
            return (value / 1000).toFixed(0) + 'k';
        }
        if (Math.abs(value) < 0.01 && value !== 0) {
            return value.toExponential(1);
        }
        if (Number.isInteger(value)) {
            return value.toString();
        }
        return value.toFixed(2);
    }

    function drawDataPoints() {
        const ctx = graphState.ctx;
        const plot = getPlotArea();

        state.dataPoints.forEach(point => {
            const pos = dataToCanvas(point.step, point.capacitance);

            // Check if in view
            if (pos.x < plot.x - 10 || pos.x > plot.x + plot.w + 10 ||
                pos.y < plot.y - 10 || pos.y > plot.y + plot.h + 10) {
                return;
            }

            const isHovered = graphState.hoveredPoint === point;
            const radius = point.selected ? SELECTED_RADIUS : POINT_RADIUS;

            ctx.beginPath();
            ctx.arc(pos.x, pos.y, radius + (isHovered ? 2 : 0), 0, Math.PI * 2);

            if (point.selected) {
                ctx.fillStyle = '#4ec9b0';
                ctx.strokeStyle = '#2a8a76';
            } else {
                ctx.fillStyle = '#007acc';
                ctx.strokeStyle = '#005a9c';
            }

            ctx.fill();
            ctx.lineWidth = 2;
            ctx.stroke();
        });
    }

    function drawFittingCurve() {
        if (!state.lastFittingResult) return;

        const ctx = graphState.ctx;
        const plot = getPlotArea();
        const result = state.lastFittingResult;

        ctx.strokeStyle = '#f44747';
        ctx.lineWidth = 2;
        ctx.beginPath();

        const steps = 200;
        const xRange = graphState.dataMaxX - graphState.dataMinX;

        for (let i = 0; i <= steps; i++) {
            const dataX = graphState.dataMinX + (i / steps) * xRange;
            let dataY;

            try {
                dataY = result.evaluate(dataX);
            } catch (e) {
                continue;
            }

            if (!isFinite(dataY) || dataY < 0) continue;

            const pos = dataToCanvas(dataX, dataY);

            if (i === 0 || pos.x < plot.x || pos.x > plot.x + plot.w) {
                ctx.moveTo(pos.x, pos.y);
            } else {
                ctx.lineTo(pos.x, pos.y);
            }
        }

        ctx.stroke();
    }

    // ========== Graph Interactions ==========
    function handleGraphWheel(e) {
        e.preventDefault();

        const rect = graphState.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.max(0.5, Math.min(10, graphState.zoomLevel * zoomFactor));

        // Zoom towards mouse position
        const plot = getPlotArea();
        const centerX = plot.x + plot.w / 2;
        const centerY = plot.y + plot.h / 2;

        graphState.panOffsetX = mouseX - centerX - (mouseX - centerX - graphState.panOffsetX) * (newZoom / graphState.zoomLevel);
        graphState.panOffsetY = mouseY - centerY - (mouseY - centerY - graphState.panOffsetY) * (newZoom / graphState.zoomLevel);
        graphState.zoomLevel = newZoom;

        updateGraph();
    }

    function handleGraphMouseDown(e) {
        graphState.isDragging = true;
        graphState.lastMouseX = e.clientX;
        graphState.lastMouseY = e.clientY;
        graphState.canvas.style.cursor = 'grabbing';
    }

    function handleGraphMouseMove(e) {
        const rect = graphState.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        if (graphState.isDragging) {
            graphState.panOffsetX += e.clientX - graphState.lastMouseX;
            graphState.panOffsetY += e.clientY - graphState.lastMouseY;
            graphState.lastMouseX = e.clientX;
            graphState.lastMouseY = e.clientY;
            updateGraph();
        } else {
            // Check for hovered point
            const prevHovered = graphState.hoveredPoint;
            graphState.hoveredPoint = null;

            for (const point of state.dataPoints) {
                const pos = dataToCanvas(point.step, point.capacitance);
                const dist = Math.sqrt((pos.x - mouseX) ** 2 + (pos.y - mouseY) ** 2);
                if (dist < 10) {
                    graphState.hoveredPoint = point;
                    break;
                }
            }

            if (graphState.hoveredPoint !== prevHovered) {
                updateGraph();
                updateTooltip(e.clientX, e.clientY);
            } else if (graphState.hoveredPoint) {
                updateTooltip(e.clientX, e.clientY);
            }

            graphState.canvas.style.cursor = graphState.hoveredPoint ? 'pointer' : 'grab';
        }
    }

    function handleGraphMouseUp() {
        graphState.isDragging = false;
        graphState.canvas.style.cursor = graphState.hoveredPoint ? 'pointer' : 'grab';
    }

    function handleGraphMouseLeave() {
        graphState.isDragging = false;
        graphState.hoveredPoint = null;
        hideTooltip();
        updateGraph();
    }

    function resetGraphZoom() {
        graphState.zoomLevel = 1;
        graphState.panOffsetX = 0;
        graphState.panOffsetY = 0;
        updateGraph();
    }

    // ========== Tooltip ==========
    function updateTooltip(x, y) {
        const tooltip = document.getElementById('graphTooltip');
        const point = graphState.hoveredPoint;

        if (!point) {
            hideTooltip();
            return;
        }

        tooltip.innerHTML = `
            <div class="tooltip-title">Data Point</div>
            <div class="tooltip-row">
                <span class="tooltip-label">Step:</span>
                <span class="tooltip-value">${point.step}</span>
            </div>
            <div class="tooltip-row">
                <span class="tooltip-label">X:</span>
                <span class="tooltip-value">${point.reactance.toFixed(2)} Ω</span>
            </div>
            <div class="tooltip-row">
                <span class="tooltip-label">C:</span>
                <span class="tooltip-value">${point.capacitance.toFixed(2)} pF</span>
            </div>
        `;

        tooltip.style.display = 'block';
        tooltip.style.left = (x + 15) + 'px';
        tooltip.style.top = (y + 15) + 'px';
    }

    function hideTooltip() {
        document.getElementById('graphTooltip').style.display = 'none';
    }

    // ========== Terminal ==========
    function logToTerminal(message, type = 'info') {
        const terminal = document.getElementById('terminal');
        const entry = document.createElement('div');
        entry.className = 'log-entry ' + (type === 'sent' ? 'sent' : type === 'error' ? 'error' : 'received');

        const time = new Date().toLocaleTimeString('en-US', { hour12: false });
        const prefix = type === 'sent' ? '→ ' : type === 'error' ? '✗ ' : '← ';
        entry.textContent = `[${time}] ${prefix}${message}`;

        terminal.appendChild(entry);
        terminal.scrollTop = terminal.scrollHeight;

        // Limit entries
        while (terminal.children.length > 500) {
            terminal.removeChild(terminal.firstChild);
        }
    }

    function sendTerminalCommand() {
        const input = document.getElementById('cmdInput');
        const cmd = input.value.trim();
        if (!cmd) return;

        VVCSerial.sendCommand(cmd);
        input.value = '';
    }

    // ========== Persistence ==========
    function saveToLocalStorage() {
        const data = {
            dataPoints: state.dataPoints,
            nextDataId: state.nextDataId,
            selectedVvc: state.selectedVvc,
            stepInterval: state.stepInterval,
            vnaFrequency: state.vnaFrequency
        };
        localStorage.setItem('vvcCalibrationData', JSON.stringify(data));
    }

    function loadFromLocalStorage() {
        try {
            const saved = localStorage.getItem('vvcCalibrationData');
            if (saved) {
                const data = JSON.parse(saved);
                state.dataPoints = data.dataPoints || [];
                state.nextDataId = data.nextDataId || 1;
                state.selectedVvc = data.selectedVvc ?? 0;
                state.stepInterval = data.stepInterval || 1000;
                state.vnaFrequency = data.vnaFrequency || 13.56;

                // Update UI
                document.querySelectorAll('input[name="vvcSelect"]').forEach(radio => {
                    radio.checked = parseInt(radio.value) === state.selectedVvc;
                });
                document.getElementById('stepInterval').value = state.stepInterval;
                document.getElementById('vnaFrequency').value = state.vnaFrequency;
            }
        } catch (e) {
            console.error('Failed to load saved data:', e);
        }
    }

    function updateUI() {
        updateDataTable();
        updateGraph();
    }

    // ========== Utilities ==========
    function debounce(func, wait) {
        let timeout;
        return function (...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }
})();

