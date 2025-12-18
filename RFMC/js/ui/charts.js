(function () {
    const Z0 = 50; // Characteristic Impedance
    const MAX_POINTS = 50;
    let smithChartInstance;
    
    // FFT Graph zoom/pan state
    const fftViewState = {
        fftGraphInput: { start: 0, end: 1, isDragging: false, lastX: 0 },
        fftGraphOutput: { start: 0, end: 1, isDragging: false, lastX: 0 }
    };

    RF.ui.initSmithChart = function () {
        // Assumes SmithChart class is available globally from smithchart.js
        if (typeof SmithChart !== 'undefined') {
            smithChartInstance = new SmithChart('smithChart');
            return smithChartInstance;
        }
        console.error('SmithChart library not loaded');
    };

    RF.ui.getSmithChart = function () {
        return smithChartInstance;
    };

    RF.ui.resizeGraphs = function () {
        const graphIds = ['rfGraphInput', 'rfGraphOutput', 'fftGraphInput', 'fftGraphOutput', 'teGraph', 'niGraph'];
        graphIds.forEach(id => {
            const canvas = document.getElementById(id);
            if (!canvas) return;
            const container = canvas.parentElement;
            // Set internal resolution to match display size
            canvas.width = container.clientWidth;
            canvas.height = container.clientHeight;
        });

        if (smithChartInstance) smithChartInstance.resize();
    };

    RF.ui.updateSmithChart = function (data) {
        if (!smithChartInstance) return;

        // Use directly provided R, X if available (new format), otherwise calculate from magnitude/phase
        let r, x;
        if (data.R !== undefined && data.X !== undefined) {
            r = data.R;
            x = data.X;
        } else {
            // Backward compatibility: calculate from magnitude and phase
            const rad = data.zPhase * (Math.PI / 180);
            r = data.zMag * Math.cos(rad);
            x = data.zMag * Math.sin(rad);
        }

        // Normalize to Z0
        const zNormR = r / Z0;
        const zNormX = x / Z0;

        // Gamma = (z - 1) / (z + 1)
        // z = r + jx
        // Gamma = ((r-1) + jx) / ((r+1) + jx)
        const denom = (zNormR + 1) * (zNormR + 1) + zNormX * zNormX;
        const gammaR = ((zNormR * zNormR + zNormX * zNormX) - 1) / denom;
        const gammaI = (2 * zNormX) / denom;

        // Default to true if undefined (backward compatibility)
        const isInput = (data.isInput !== undefined) ? data.isInput : true;

        // Update UI based on sensor type (Input or Output)
        // New display order: R, X, V, I, Phase
        if (isInput) {
            const elRIn = document.getElementById('valRIn');
            const elXIn = document.getElementById('valXIn');
            const elVIn = document.getElementById('valVIn');
            const elIIn = document.getElementById('valIIn');
            const elPhaseIn = document.getElementById('valPhaseIn');

            if (elRIn) elRIn.textContent = r.toFixed(2);
            if (elXIn) elXIn.textContent = x.toFixed(2);
            if (elVIn && data.V !== undefined) elVIn.textContent = data.V.toFixed(2);
            if (elIIn && data.I !== undefined) elIIn.textContent = data.I.toFixed(2);
            if (elPhaseIn) elPhaseIn.textContent = data.zPhase.toFixed(2);

            // Also update Matching Algorithm R, X input fields (if not focused by user)
            const matchingInputR = document.getElementById('matchingInputR');
            const matchingInputX = document.getElementById('matchingInputX');
            
            if (matchingInputR && document.activeElement !== matchingInputR) {
                matchingInputR.value = r.toFixed(2);
            }
            if (matchingInputX && document.activeElement !== matchingInputX) {
                matchingInputX.value = x.toFixed(2);
            }
        } else {
            const elROut = document.getElementById('valROut');
            const elXOut = document.getElementById('valXOut');
            const elVOut = document.getElementById('valVOut');
            const elIOut = document.getElementById('valIOut');
            const elPhaseOut = document.getElementById('valPhaseOut');

            if (elROut) elROut.textContent = r.toFixed(2);
            if (elXOut) elXOut.textContent = x.toFixed(2);
            if (elVOut && data.V !== undefined) elVOut.textContent = data.V.toFixed(2);
            if (elIOut && data.I !== undefined) elIOut.textContent = data.I.toFixed(2);
            if (elPhaseOut) elPhaseOut.textContent = data.zPhase.toFixed(2);
            
            // Also update Matching Algorithm Output R, X fields (if not focused by user)
            const matchingOutputR = document.getElementById('matchingOutputR');
            const matchingOutputX = document.getElementById('matchingOutputX');
            
            if (matchingOutputR && document.activeElement !== matchingOutputR) {
                matchingOutputR.value = r.toFixed(2);
            }
            if (matchingOutputX && document.activeElement !== matchingOutputX) {
                matchingOutputX.value = x.toFixed(2);
            }
        }

        smithChartInstance.addPoint(gammaR, gammaI, isInput);
    };

    RF.ui.setSmithChartSettings = function (settings) {
        if (smithChartInstance) {
            smithChartInstance.updateSettings(settings);
        }
    };

    RF.ui.drawGraph = function (canvasId, dataArrays, colors, range, highlightIndex = -1) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;

        // Clear
        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, w, h);

        // Grid
        ctx.strokeStyle = '#222';
        ctx.beginPath();
        ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);
        ctx.stroke();

        // Preserve existing lastDrawData settings (mode, samplingRate, xAxisDisplay, ranges)
        // Only update dataArrays, colors
        if (canvas.lastDrawData && canvas.lastDrawData.type === 'line') {
            canvas.lastDrawData.dataArrays = dataArrays;
            canvas.lastDrawData.colors = colors;
            // Keep existing ranges if present, otherwise use legacy range
            if (!canvas.lastDrawData.ranges) {
                canvas.lastDrawData.range = range;
            }
        } else {
            // Create new lastDrawData if it doesn't exist
            canvas.lastDrawData = {
                type: 'line',
                dataArrays: dataArrays,
                range: range,
                colors: colors
            };
        }

        // Check if we have independent ranges (strip chart mode)
        const hasIndependentRanges = canvas.lastDrawData.ranges;
        const hasOffsets = canvas.lastDrawData.offsets;
        const dataLength = dataArrays[0] ? dataArrays[0].length : MAX_POINTS;
        const step = w / (dataLength - 1 || 1);

        // Calculate scales for each data series
        const scales = dataArrays.map((data, idx) => {
            if (hasIndependentRanges) {
                const rangeKey = idx === 0 ? 'voltage' : 'current';
                const r = canvas.lastDrawData.ranges[rangeKey];
                if (r) {
                    const min = r[0];
                    const max = r[1];
                    return { min, max, scale: h / (max - min || 1) };
                }
            }
            // Fallback to shared range
            const min = range[0];
            const max = range[1];
            return { min, max, scale: h / (max - min || 1) };
        });

        // Get offsets for each data series
        const offsets = dataArrays.map((data, idx) => {
            if (hasOffsets) {
                const offsetKey = idx === 0 ? 'voltage' : 'current';
                return canvas.lastDrawData.offsets[offsetKey] || 0;
            }
            return 0;
        });

        dataArrays.forEach((data, idx) => {
            ctx.strokeStyle = colors[idx];
            ctx.lineWidth = 2;
            ctx.beginPath();

            const { min, scale } = scales[idx];
            const offset = offsets[idx];
            data.forEach((val, i) => {
                const x = i * step;
                const y = h - (val - min) * scale - offset;  // Apply offset
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            });
            ctx.stroke();
        });

        // Draw Highlight (Cursor Line & Dots)
        if (highlightIndex >= 0 && highlightIndex < dataLength) {
            const x = highlightIndex * step;

            // Vertical Line
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.stroke();
            ctx.setLineDash([]);

            // Dots on data points - use independent scales and offsets
            dataArrays.forEach((data, idx) => {
                if (highlightIndex < data.length) {
                    const val = data[highlightIndex];
                    const { min, scale } = scales[idx];
                    const offset = offsets[idx];
                    const y = h - (val - min) * scale - offset;  // Apply offset

                    ctx.beginPath();
                    ctx.arc(x, y, 4, 0, 2 * Math.PI);
                    ctx.fillStyle = colors[idx];
                    ctx.fill();
                    ctx.strokeStyle = '#fff';
                    ctx.lineWidth = 1;
                    ctx.stroke();
                }
            });
        }

        // Legend is now drawn in updateStripChart with range info
    };

    // drawBarGraph - preserves existing lastDrawData settings (mode, samplingRate, etc.)
    RF.ui.drawBarGraph = function (canvasId, data, color, highlightIndex = -1) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;

        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, w, h);

        // Preserve existing lastDrawData settings (mode, samplingRate, fftLength, xAxisDisplay)
        // Only update data and color
        if (canvas.lastDrawData && canvas.lastDrawData.type === 'bar') {
            canvas.lastDrawData.data = data;
            canvas.lastDrawData.color = color;
        } else {
            // Create new lastDrawData if it doesn't exist
            canvas.lastDrawData = {
                type: 'bar',
                data: data,
                color: color
            };
        }

        // Use dynamic scaling based on max value (with 10% margin for FFT graphs)
        const maxVal = Math.max(...data, 1);
        const scaledMaxVal = maxVal * 1.10; // Add 10% margin to prevent clipping

        const barWidth = w / data.length;

        data.forEach((val, i) => {
            // Use dynamic scaling instead of fixed /100
            const barH = (val / scaledMaxVal) * h;

            if (i === highlightIndex) {
                ctx.fillStyle = '#fff'; // Highlight color
            } else {
                ctx.fillStyle = color;
            }

            ctx.fillRect(i * barWidth + 1, h - barH, barWidth - 2, barH);
        });
    };
    RF.ui.initGraphTooltips = function () {
        const graphIds = ['rfGraphInput', 'rfGraphOutput', 'fftGraphInput', 'fftGraphOutput', 'teGraph', 'niGraph'];
        const tooltip = document.getElementById('graphTooltip');

        graphIds.forEach(id => {
            const canvas = document.getElementById(id);
            if (!canvas) return;

            // Track last index to avoid unnecessary redraws
            canvas.lastHighlightIndex = -1;

            canvas.addEventListener('mousemove', (e) => {
                if (!canvas.lastDrawData) return;

                const rect = canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const w = canvas.width;
                const h = canvas.height;
                const dataObj = canvas.lastDrawData;

                let html = '';
                let index = -1;

                if (dataObj.type === 'line') {
                    // Line Graph Logic
                    const dataLength = dataObj.dataArrays[0] ? dataObj.dataArrays[0].length : MAX_POINTS;
                    const step = w / (dataLength - 1 || 1);
                    index = Math.round(x / step);

                    if (index >= 0 && index < dataLength) {
                        // Check xAxisDisplay setting (default to 'physical' if not set)
                        const xAxisDisplay = dataObj.xAxisDisplay || 'physical';
                        
                        if (xAxisDisplay === 'physical' && dataObj.mode === 'time' && dataObj.samplingRate) {
                            // Time mode: X-axis is time (auto unit: ns/us/ms)
                            const timeSec = index / dataObj.samplingRate;
                            let timeStr;
                            if (timeSec < 1e-6) {
                                timeStr = (timeSec * 1e9).toFixed(2) + ' ns';
                            } else if (timeSec < 1e-3) {
                                timeStr = (timeSec * 1e6).toFixed(2) + ' µs';
                            } else {
                                timeStr = (timeSec * 1e3).toFixed(2) + ' ms';
                            }
                            html += `<div class="tooltip-row"><span class="tooltip-label">Time:</span><span class="tooltip-value">${timeStr}</span></div>`;
                        } else {
                            html += `<div class="tooltip-row"><span class="tooltip-label">Index:</span><span class="tooltip-value">${index}</span></div>`;
                        }

                        dataObj.dataArrays.forEach((arr, idx) => {
                            if (index < arr.length) {
                                const val = arr[index];
                                const label = (dataObj.colors.length > 1 && idx === 0) ? 'V' :
                                    (dataObj.colors.length > 1 && idx === 1) ? 'I' : 'Val';
                                html += `<div class="tooltip-row"><span class="tooltip-label">${label}:</span><span class="tooltip-value">${val.toFixed(2)}</span></div>`;
                            }
                        });
                    } else {
                        index = -1;
                    }
                } else if (dataObj.type === 'bar') {
                    // Bar Graph Logic - handle zoomed view
                    const dataLength = dataObj.data.length;
                    const viewStart = dataObj.viewStart !== undefined ? dataObj.viewStart : 0;
                    const viewEnd = dataObj.viewEnd !== undefined ? dataObj.viewEnd : 1;
                    
                    // Calculate visible range
                    const startIdx = Math.floor(viewStart * dataLength);
                    const endIdx = Math.ceil(viewEnd * dataLength);
                    const visibleCount = endIdx - startIdx;
                    
                    const barWidth = w / visibleCount;
                    const visibleIndex = Math.floor(x / barWidth);
                    index = startIdx + visibleIndex; // Convert to actual data index

                    if (index >= 0 && index < dataLength && visibleIndex >= 0 && visibleIndex < visibleCount) {
                        const val = dataObj.data[index];
                        
                        // Check xAxisDisplay setting (default to 'physical' if not set)
                        const xAxisDisplay = dataObj.xAxisDisplay || 'physical';
                        
                        // Calculate X-axis value based on display setting
                        if (xAxisDisplay === 'physical' && dataObj.mode === 'fft' && dataObj.samplingRate && dataObj.fftLength) {
                            // FFT mode: X-axis is frequency (MHz)
                            const freqHz = (index * dataObj.samplingRate) / dataObj.fftLength;
                            const freqMHz = freqHz / 1000000;
                            html += `<div class="tooltip-row"><span class="tooltip-label">Freq:</span><span class="tooltip-value">${freqMHz.toFixed(3)} MHz</span></div>`;
                        } else if (xAxisDisplay === 'physical' && dataObj.mode === 'time' && dataObj.samplingRate) {
                            // Time mode: X-axis is time (auto unit: ns/us/ms)
                            const timeSec = index / dataObj.samplingRate;
                            let timeStr;
                            if (timeSec < 1e-6) {
                                timeStr = (timeSec * 1e9).toFixed(2) + ' ns';
                            } else if (timeSec < 1e-3) {
                                timeStr = (timeSec * 1e6).toFixed(2) + ' µs';
                            } else {
                                timeStr = (timeSec * 1e3).toFixed(2) + ' ms';
                            }
                            html += `<div class="tooltip-row"><span class="tooltip-label">Time:</span><span class="tooltip-value">${timeStr}</span></div>`;
                        } else {
                            // Show index (either by setting or fallback)
                            html += `<div class="tooltip-row"><span class="tooltip-label">Index:</span><span class="tooltip-value">${index}</span></div>`;
                        }
                        
                        html += `<div class="tooltip-row"><span class="tooltip-label">Value:</span><span class="tooltip-value">${val.toFixed(2)}</span></div>`;
                    } else {
                        index = -1;
                    }
                } else if (dataObj.type === 'fftDual') {
                    // FFT Dual channel (V/I) Logic
                    const dataLength = dataObj.voltage ? dataObj.voltage.length : (dataObj.current ? dataObj.current.length : 0);
                    if (dataLength === 0) return;

                    const viewStart = dataObj.viewStart !== undefined ? dataObj.viewStart : 0;
                    const viewEnd = dataObj.viewEnd !== undefined ? dataObj.viewEnd : 1;
                    
                    const startIdx = Math.floor(viewStart * dataLength);
                    const endIdx = Math.ceil(viewEnd * dataLength);
                    const visibleCount = endIdx - startIdx;
                    
                    const barWidth = w / visibleCount;
                    const visibleIndex = Math.floor(x / barWidth);
                    index = startIdx + visibleIndex;

                    if (index >= 0 && index < dataLength && visibleIndex >= 0 && visibleIndex < visibleCount) {
                        const xAxisDisplay = dataObj.xAxisDisplay || 'physical';
                        
                        // X-axis value (frequency)
                        if (xAxisDisplay === 'physical' && dataObj.samplingRate && dataObj.fftLength) {
                            const freqHz = (index * dataObj.samplingRate) / dataObj.fftLength;
                            const freqMHz = freqHz / 1000000;
                            html += `<div class="tooltip-row"><span class="tooltip-label">Freq:</span><span class="tooltip-value">${freqMHz.toFixed(3)} MHz</span></div>`;
                        } else {
                            html += `<div class="tooltip-row"><span class="tooltip-label">Index:</span><span class="tooltip-value">${index}</span></div>`;
                        }
                        
                        // Show V and I values if visible
                        if (dataObj.voltage && dataObj.visibility.voltage) {
                            const vVal = dataObj.voltage[index];
                            html += `<div class="tooltip-row"><span class="tooltip-label" style="color:#4ec9b0">V:</span><span class="tooltip-value">${vVal.toFixed(4)}</span></div>`;
                        }
                        if (dataObj.current && dataObj.visibility.current) {
                            const iVal = dataObj.current[index];
                            html += `<div class="tooltip-row"><span class="tooltip-label" style="color:#dcdcaa">I:</span><span class="tooltip-value">${iVal.toFixed(4)}</span></div>`;
                        }
                    } else {
                        index = -1;
                    }
                }

                // Redraw if index changed
                if (canvas.lastHighlightIndex !== index) {
                    canvas.lastHighlightIndex = index;
                    if (dataObj.type === 'line') {
                        RF.ui.drawGraph(id, dataObj.dataArrays, dataObj.colors, dataObj.range, index);
                    } else if (dataObj.type === 'bar') {
                        // For FFT graphs with zoom state, use redrawFftGraph to preserve zoom
                        if ((id === 'fftGraphInput' || id === 'fftGraphOutput') && fftViewState[id]) {
                            RF.ui.redrawFftGraphWithHighlight(id, index);
                        } else {
                            RF.ui.drawBarGraph(id, dataObj.data, dataObj.color, index);
                        }
                    } else if (dataObj.type === 'fftDual') {
                        // Redraw with highlight for fftDual
                        const sensor = dataObj.sensor || (id === 'fftGraphInput' ? 'input' : 'output');
                        RF.ui.drawFftDualGraph(sensor, index);
                    }
                }

                if (html && index !== -1) {
                    tooltip.innerHTML = html;
                    tooltip.style.display = 'block';
                    tooltip.style.left = e.clientX + 'px';
                    tooltip.style.top = e.clientY + 'px';
                } else {
                    tooltip.style.display = 'none';
                }
            });

            canvas.addEventListener('mouseout', () => {
                tooltip.style.display = 'none';
                // Clear highlight
                if (canvas.lastHighlightIndex !== -1 && canvas.lastDrawData) {
                    canvas.lastHighlightIndex = -1;
                    const dataObj = canvas.lastDrawData;
                    if (dataObj.type === 'line') {
                        RF.ui.drawGraph(id, dataObj.dataArrays, dataObj.colors, dataObj.range, -1);
                    } else if (dataObj.type === 'bar') {
                        // For FFT graphs with zoom state, use redrawFftGraph to preserve zoom
                        if ((id === 'fftGraphInput' || id === 'fftGraphOutput') && fftViewState[id]) {
                            RF.ui.redrawFftGraphWithHighlight(id, -1);
                        } else {
                            RF.ui.drawBarGraph(id, dataObj.data, dataObj.color, -1);
                        }
                    } else if (dataObj.type === 'fftDual') {
                        // Clear highlight for fftDual
                        const sensor = dataObj.sensor || (id === 'fftGraphInput' ? 'input' : 'output');
                        RF.ui.drawFftDualGraph(sensor, -1);
                    }
                }
            });
            
            // FFT Graph zoom/pan events (only for fft graphs)
            if (id === 'fftGraphInput' || id === 'fftGraphOutput') {
                const state = fftViewState[id];
                
                // Legend click handler for hide/show toggle
                canvas.addEventListener('click', (e) => {
                    if (!canvas.legendAreas || !canvas.fftSensor) return;
                    
                    const rect = canvas.getBoundingClientRect();
                    const clickX = e.clientX - rect.left;
                    const clickY = e.clientY - rect.top;
                    
                    // Check if click is on any legend area
                    for (const area of canvas.legendAreas) {
                        if (clickX >= area.x && clickX <= area.x + area.w &&
                            clickY >= area.y && clickY <= area.y + area.h) {
                            // Toggle visibility for this channel
                            RF.ui.toggleFftVisibility(canvas.fftSensor, area.channel);
                            return;
                        }
                    }
                });
                
                // Mouse wheel zoom
                canvas.addEventListener('wheel', (e) => {
                    e.preventDefault();
                    if (!canvas.lastDrawData || (canvas.lastDrawData.type !== 'bar' && canvas.lastDrawData.type !== 'fftDual')) return;
                    
                    const rect = canvas.getBoundingClientRect();
                    const mouseX = e.clientX - rect.left;
                    const canvasWidth = canvas.width;
                    
                    // Calculate mouse position as ratio (0-1)
                    const mouseRatio = mouseX / canvasWidth;
                    
                    // Current view range
                    const viewStart = state.start;
                    const viewEnd = state.end;
                    const viewRange = viewEnd - viewStart;
                    
                    // Zoom factor
                    const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;
                    const newRange = Math.min(1, Math.max(0.01, viewRange * zoomFactor));
                    
                    // Zoom towards mouse position
                    const mousePos = viewStart + mouseRatio * viewRange;
                    const newStart = Math.max(0, mousePos - mouseRatio * newRange);
                    const newEnd = Math.min(1, newStart + newRange);
                    
                    // Adjust if we hit the bounds
                    state.start = newEnd > 1 ? 1 - newRange : newStart;
                    state.end = state.start + newRange;
                    
                    // Redraw
                    RF.ui.redrawFftGraph(id);
                }, { passive: false });
                
                // Mouse drag pan
                canvas.addEventListener('mousedown', (e) => {
                    if (!canvas.lastDrawData || (canvas.lastDrawData.type !== 'bar' && canvas.lastDrawData.type !== 'fftDual')) return;
                    state.isDragging = true;
                    state.lastX = e.clientX;
                    canvas.style.cursor = 'grabbing';
                });
                
                canvas.addEventListener('mousemove', (e) => {
                    if (!state.isDragging || !canvas.lastDrawData) return;
                    
                    const dx = e.clientX - state.lastX;
                    state.lastX = e.clientX;
                    
                    const canvasWidth = canvas.width;
                    const viewRange = state.end - state.start;
                    const delta = -(dx / canvasWidth) * viewRange;
                    
                    let newStart = state.start + delta;
                    let newEnd = state.end + delta;
                    
                    // Clamp to bounds
                    if (newStart < 0) {
                        newStart = 0;
                        newEnd = viewRange;
                    }
                    if (newEnd > 1) {
                        newEnd = 1;
                        newStart = 1 - viewRange;
                    }
                    
                    state.start = newStart;
                    state.end = newEnd;
                    
                    // Redraw
                    RF.ui.redrawFftGraph(id);
                });
                
                canvas.addEventListener('mouseup', () => {
                    state.isDragging = false;
                    canvas.style.cursor = 'default';
                });
                
                canvas.addEventListener('mouseleave', () => {
                    state.isDragging = false;
                    canvas.style.cursor = 'default';
                });
                
                // Double-click reset
                canvas.addEventListener('dblclick', () => {
                    state.start = 0;
                    state.end = 1;
                    RF.ui.redrawFftGraph(id);
                });
            }
        });
    };
    
    // Redraw FFT graph with current view state
    RF.ui.redrawFftGraph = function (canvasId, highlightIndex = -1) {
        const canvas = document.getElementById(canvasId);
        if (!canvas || !canvas.lastDrawData) return;
        
        const dataObj = canvas.lastDrawData;
        const state = fftViewState[canvasId];
        if (!state) return;
        
        // Handle fftDual type - just redraw via ui.js function
        if (dataObj.type === 'fftDual') {
            const sensor = dataObj.sensor || (canvasId === 'fftGraphInput' ? 'input' : 'output');
            RF.ui.drawFftDualGraph(sensor);
            return;
        }
        
        // Original bar type handling
        if (dataObj.type !== 'bar') return;
        
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;
        const data = dataObj.data;
        const color = dataObj.color;
        
        // Clear
        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, w, h);
        
        // Calculate visible data range
        const dataLength = data.length;
        const startIdx = Math.floor(state.start * dataLength);
        const endIdx = Math.ceil(state.end * dataLength);
        const visibleData = data.slice(startIdx, endIdx);
        
        if (visibleData.length === 0) return;
        
        // Calculate scaling
        const maxVal = Math.max(...visibleData, 0.001);
        const margin = 0.10; // 10% margin
        const scaledMaxVal = maxVal * (1 + margin);
        
        // Draw bars
        const barWidth = w / visibleData.length;
        
        visibleData.forEach((val, i) => {
            const barH = (val / scaledMaxVal) * h;
            const actualIndex = startIdx + i;
            
            // Use highlight color or normal color
            if (actualIndex === highlightIndex) {
                ctx.fillStyle = '#fff';
            } else {
                ctx.fillStyle = color;
            }
            
            ctx.fillRect(i * barWidth, h - barH, Math.max(barWidth - 1, 1), barH);
        });
        
        // Draw grid line at half height
        ctx.strokeStyle = '#333';
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();
        
        // Update lastDrawData with view info for tooltip
        canvas.lastDrawData.viewStart = state.start;
        canvas.lastDrawData.viewEnd = state.end;
    };
    
    // Redraw FFT graph with highlight (wrapper for mousemove)
    RF.ui.redrawFftGraphWithHighlight = function (canvasId, highlightIndex) {
        RF.ui.redrawFftGraph(canvasId, highlightIndex);
    };
    
    // Get FFT view state for a canvas
    RF.ui.getFftViewState = function (canvasId) {
        return fftViewState[canvasId];
    };
    
    // Reset FFT view state
    RF.ui.resetFftViewState = function (canvasId) {
        if (fftViewState[canvasId]) {
            fftViewState[canvasId].start = 0;
            fftViewState[canvasId].end = 1;
        }
    };
})();
