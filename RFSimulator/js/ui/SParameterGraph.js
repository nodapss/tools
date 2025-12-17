/**
 * SParameterGraph.js
 * Chart.js 기반 S-Parameter 그래프 컴포넌트
 * 다중 포트 S-파라미터 및 다양한 Format 지원
 */

class SParameterGraph {
    constructor(canvasId) {
        this.canvasId = canvasId;
        this.canvas = document.getElementById(canvasId);
        this.chart = null;

        // 데이터셋
        this.simulationData = null;
        this.simulationResults = null;  // 전체 시뮬레이션 결과 저장

        // Hover State
        this.hoveredDatasetIndex = null;

        // CSV 데이터셋 배열로 관리
        this.csvDatasets = []; // Array of { rawData: [], processedData: {}, metadata: {}, color: '...' }

        // Format/Meas 설정
        this.currentFormat = 'logMag';  // logMag, linMag, phase, swr, delay, smith
        this.currentMeas = 'impedance';       // S11, S21, S12, S22, ... or impedance or matchingRange
        this.currentXAxisScale = 'linear'; // 'linear' or 'logarithmic'

        // Smith Chart Renderer (for smith format and matching range)
        this.smithChartRenderer = null;
        this.matchingRangeData = null;
        this.isSmithChartMode = false;

        // Highlighted Marker ID
        this.highlightedMarkerId = null;

        // 그래프 설정
        this.config = {
            showSimulation: true,
            showCsv: true,
            yMin: -50,
            yMax: 0,
            autoScale: true,
            autoScale: true,
            absoluteImag: true, // Default to true (Absolute Value) for Lin R, X
            highlightNegative: false // Highlight negative imaginary values in Lin R, X
        };

        // 색상 테마 및 팔레트
        this.colors = {
            simulation: {
                line: '#00d4ff',
                fill: 'rgba(0, 212, 255, 0.1)',
                point: '#00d4ff'
            },
            // CSV 기본 색상 (첫 번째)
            csv: {
                line: '#ff6b6b',
                fill: 'rgba(255, 107, 107, 0.1)',
                point: '#ff6b6b'
            },
            // 다중 CSV용 색상 팔레트
            csvPalette: [
                '#ff6b6b', // Red
                '#51cf66', // Green
                '#fcc419', // Yellow
                '#845ef7', // Violet
                '#ff922b', // Orange
                '#20c997', // Teal
                '#e64980'  // Pink (Fixed: was duplicate red)
            ],
            grid: 'rgba(255, 255, 255, 0.1)',
            text: '#a0a0a0'
        };

        // ... (FormatConfig remains same) ...
        this.formatConfig = {
            logMag: { label: 'Magnitude (dB)', unit: 'dB', min: -50, max: 0 },
            linMag: { label: 'Magnitude', unit: '', min: 0, max: 1 },
            phase: { label: 'Phase (°)', unit: '°', min: -180, max: 180 },
            swr: { label: 'SWR', unit: '', min: 1, max: 10 },
            delay: { label: 'Delay (ns)', unit: 'ns', min: null, max: null }
        };

        // Format별 Y축 설정 (Impedance용)
        this.impedanceFormatConfig = {
            logMag: { label: '|Z| (dBΩ)', unit: 'dBΩ', min: null, max: null },
            linMag: { label: '|Z| (Ω)', unit: 'Ω', min: 0, max: null },
            phase: { label: 'Z Phase (°)', unit: '°', min: -90, max: 90 },
            swr: { label: '|Z| (Ω)', unit: 'Ω', min: 0, max: null },
            delay: { label: '|Z| (Ω)', unit: 'Ω', min: null, max: null },
            linRabsX: { label: 'R & |X| (Ω)', unit: 'Ω', min: null, max: null }
        };

        // Format Config for S-Parameters (Generic)
        // If we want to support linRabsX for S-params (Real & |Imag|)
        this.formatConfig.linRabsX = { label: 'Real & |Imag|', unit: '', min: -1, max: 1 };

        // Marker Manager
        this.markerManager = new MarkerManager();
        // Initialize measurement mode
        if (this.currentMeas) {
            this.markerManager.setMeasurementMode(this.currentMeas === 'impedance' ? 'impedance' : 'sparameter');
        }

        // Listen for marker removal to redraw
        window.addEventListener('marker-removed', () => {
            if (this.chart) this.chart.update();
            if (this.smithChartRenderer) this.smithChartRenderer.draw();
        });

        // Listen for marker display changes (Show Value, Size, etc.)
        window.addEventListener('marker-display-change', () => {
            if (this.chart) this.chart.update('none'); // Efficient redraw
            if (this.smithChartRenderer) this.smithChartRenderer.draw(); // Redraw Smith Chart
        });

        // Graph Context Menu
        this.contextMenu = document.getElementById('graphContextMenu');
        document.addEventListener('click', () => {
            if (this.contextMenu) this.contextMenu.style.display = 'none';
        });

        this.init();
    }

    init() {
        // 이미 차트가 있으면 제거
        if (this.chart) {
            this.chart.destroy();
        }

        const ctx = this.canvas.getContext('2d');
        const options = this.getChartOptions();

        // Glow Effect Plugin
        const glowPlugin = {
            id: 'glowEffect',
            beforeDatasetDraw: (chart, args, options) => {
                const index = args.index;

                // Only apply to the hovered dataset if it matches
                if (this.hoveredDatasetIndex === index) {
                    const ctx = chart.ctx;
                    const meta = chart.getDatasetMeta(index);
                    const dataset = chart.data.datasets[index];

                    // 데이터가 없거나 숨겨진 상태면 패스
                    if (!meta.data || meta.data.length === 0 || meta.hidden) return;

                    ctx.save();

                    // 글로우 설정
                    ctx.shadowColor = dataset.borderColor; // 데이터셋 색상 그대로 사용
                    ctx.shadowBlur = 20; // 글로우 강도
                    ctx.shadowOffsetX = 0;
                    ctx.shadowOffsetY = 0;

                    // 글로우 선 설정 (약간 투명하게)
                    ctx.strokeStyle = dataset.borderColor;
                    ctx.lineWidth = 6; // 글로우 두께

                    // 경로 그리기 (수동)
                    ctx.beginPath();

                    // 캔버스 좌표로 변환된 포인트들을 연결
                    let started = false;
                    for (let i = 0; i < meta.data.length; i++) {
                        const point = meta.data[i];

                        // 포인트가 건너뛰어진 경우 (null check inside Chart.js) 체크
                        if (point.skip) continue;

                        const x = point.x;
                        const y = point.y;

                        if (!started) {
                            ctx.moveTo(x, y);
                            started = true;
                        } else {
                            ctx.lineTo(x, y);
                        }
                    }

                    if (started) {
                        ctx.stroke();
                    }

                    ctx.restore();
                }
            },
            afterDatasetDraw: (chart, args, options) => {
                // No restore needed as we used save/restore inside beforeDatasetDraw
            }
        };

        // Marker Plugin
        const markerPlugin = {
            id: 'markerPlugin',
            afterDraw: (chart) => {
                this.drawMarkers(chart);
            }
        };

        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: []
            },
            options: options,
            plugins: [glowPlugin, markerPlugin]
        });

        // Context Menu Event
        this.canvas.addEventListener('contextmenu', (e) => this.handleContextMenu(e));

        // Drag Events
        this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        window.addEventListener('mouseup', (e) => this.handleMouseUp(e));

        // Dynamic Zoom Mode based on Mouse Position

        // Dynamic Zoom Mode based on Mouse Position
        this.canvas.addEventListener('mousemove', (event) => {
            if (this.draggingMarker) {
                this.handleMouseMove(event);
                return;
            }
            this.handleMouseMove(event); // For hover cursor on marker

            if (!this.chart) return;
            // ... (rest of zoom logic)

            const { offsetX, offsetY } = event;
            const scales = this.chart.scales;

            // Check if chart is ready and scales exist
            if (!scales.x || !scales.y) return;

            let mode = 'xy';

            // Check boundaries
            // If to the left of X-axis start (meaning over Y-axis labels/ticks)
            if (offsetX < scales.x.left) {
                mode = 'y';
            }
            // If below the Y-axis end (meaning over X-axis labels/ticks)
            else if (offsetY > scales.y.bottom) {
                mode = 'x';
            }

            // Only update if changed to avoid unnecessary re-renders
            if (this.chart.options.plugins.zoom.zoom.mode !== mode) {
                this.chart.options.plugins.zoom.zoom.mode = mode;
                this.chart.update('none'); // Update options without re-render

                // Optional: Change cursor style to indicate zoom mode
                if (mode === 'y') this.canvas.style.cursor = 'ns-resize';
                else if (mode === 'x') this.canvas.style.cursor = 'ew-resize';
                else this.canvas.style.cursor = 'default';
            }
        });

        // Double-click to reset zoom
        this.canvas.ondblclick = () => {
            this.resetZoom();
        };

        // Listen for marker hover from table
        window.addEventListener('marker-hover', (e) => {
            this.highlightedMarkerId = e.detail.hovering ? e.detail.id : null;
            this.chart.update('none');
        });

        // Listen for marker edit request from table
        window.addEventListener('marker-edit-request', (e) => {
            this.handleMarkerEditRequest(e.detail.id, e.detail.field, e.detail.value);
        });

        // Listen for marker step request from table (Wheel)
        // Listen for marker step request from table (Wheel)
        window.addEventListener('marker-step-request', (e) => {
            this.handleMarkerStepRequest(e.detail.id, e.detail.steps);
        });
    }

    /**
     * Handle Marker Step Request (Wheel)
     * @param {string} id 
     * @param {number} steps +N or -N
     */
    handleMarkerStepRequest(id, steps) {
        if (this.isSmithChartMode && this.smithChartRenderer) {
            // Optional: Implement stepping for Smith Chart if needed
            // For now, ignoring or could implement similar logic if SmithRenderer holds data
            return;
        }

        const marker = this.markerManager.markers.find(m => m.id === id);
        if (!marker) return;

        // 1. Find the active dataset
        let targetDataset = null;
        if (this.chart && this.chart.data) {
            for (let i = 0; i < this.chart.data.datasets.length; i++) {
                const ds = this.chart.data.datasets[i];
                const meta = this.chart.getDatasetMeta(i);
                if (!meta.hidden && ds.data && ds.data.length > 0 && ds.label !== 'Markers') {
                    targetDataset = ds;
                    break;
                }
            }
        }

        if (!targetDataset) return;

        // 2. Find current index
        let closestIndex = -1;
        let minDiff = Infinity;

        targetDataset.data.forEach((pt, index) => {
            const diff = Math.abs(pt.x - marker.x);
            if (diff < minDiff) {
                minDiff = diff;
                closestIndex = index;
            }
        });

        if (closestIndex === -1) return;

        // 3. Step
        let newIndex = closestIndex + steps;

        // 4. Clamp
        if (newIndex < 0) newIndex = 0;
        if (newIndex >= targetDataset.data.length) newIndex = targetDataset.data.length - 1;

        if (newIndex === closestIndex) return;

        const point = targetDataset.data[newIndex];

        // 5. Update
        const updates = { x: point.x, y: point.y };

        // Fetch complex data if available (Fix for Value not updating on scroll)
        const complex = this.getComplexDataAtFrequency(point.x);
        if (complex) {
            updates.complexData = complex;
        }

        this.markerManager.updateMarker(id, updates);

        // 6. Update Graph
        if (this.chart) this.chart.update();
    }

    /**
     * Helper: Dynamic Border Color (Scriptable Option)
     */
    getDynamicBorderColor(baseColor) {
        return (context) => {
            // Dimming Logic Removed: Always return base color
            return baseColor;
        };
    }

    /**
     * Helper: Dynamic Border Width (Scriptable Option)
     */
    getDynamicBorderWidth() {
        return (context) => {
            const datasetIndex = context.datasetIndex;
            // 호버된 놈은 약간 굵게 (3px)
            if (this.hoveredDatasetIndex === datasetIndex) {
                return 4;
            }
            return 2;
        };
    }

    /**
     * Chart.js 옵션 생성
     */
    getChartOptions() {
        return {
            responsive: true,
            maintainAspectRatio: false,
            animation: this.config.animation !== undefined ? this.config.animation : false,
            layout: {
                padding: 3 // Reduced padding to maximize area
            },
            interaction: {
                mode: 'nearest',
                axis: 'x',
                intersect: false
            },
            plugins: {
                title: {
                    display: false
                },
                legend: {
                    display: true,
                    labels: {
                        color: '#a0a0a0',
                        usePointStyle: true,
                        boxWidth: 8
                    },
                    onHover: (e, legendItem, legend) => {
                        const index = legendItem.datasetIndex;
                        if (this.hoveredDatasetIndex !== index) {
                            this.hoveredDatasetIndex = index;
                            // 상태만 변경하고 차트 업데이트 -> Scriptable Options가 재평가됨
                            legend.chart.update();
                        }
                    },
                    onLeave: (e, legendItem, legend) => {
                        if (this.hoveredDatasetIndex !== null) {
                            this.hoveredDatasetIndex = null;
                            legend.chart.update();
                        }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(20, 20, 30, 0.9)',
                    titleColor: '#fff',
                    bodyColor: '#ccc',
                    borderColor: '#444',
                    borderWidth: 1,
                    displayColors: true,
                    callbacks: {
                        label: (context) => {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                label += context.parsed.y.toFixed(4);
                                // 단위 추가
                                if (this.currentMeas === 'impedance') {
                                    label += ' ' + (this.impedanceFormatConfig[this.currentFormat]?.unit || '');
                                } else {
                                    label += ' ' + (this.formatConfig[this.currentFormat]?.unit || '');
                                }
                            }
                            return label;
                        },
                        title: (context) => {
                            if (context.length > 0) {
                                return this.formatFrequency(context[0].parsed.x);
                            }
                            return '';
                        }
                    }
                },
                zoom: {
                    zoom: {
                        wheel: {
                            enabled: true,
                            // modifierKey removed for direct zoom
                        },
                        pinch: {
                            enabled: true
                        },
                        mode: 'xy',
                    },
                    pan: {
                        enabled: true,
                        mode: 'xy',
                        // modifierKey removed for direct pan
                    }
                }
            },
            scales: {
                x: {
                    type: this.currentXAxisScale, // Dynamic
                    position: 'bottom',
                    grid: {
                        color: this.colors.grid,
                        borderColor: '#444'
                    },
                    ticks: {
                        color: this.colors.text,
                        callback: (value, index, values) => {
                            // 로그 스케일에서 주요 눈금만 표시
                            const str = value.toString();
                            if (str.startsWith('1') || str.startsWith('2') || str.startsWith('5')) {
                                return this.formatFrequency(value);
                            }
                            return '';
                        }
                    },
                    title: {
                        display: true,
                        text: 'Frequency (Hz)',
                        color: this.colors.text,
                        padding: { top: 4, bottom: 0 } // Tight padding
                    }
                },
                y: {
                    type: 'linear',
                    position: 'left',
                    grid: {
                        color: this.colors.grid,
                        borderColor: '#444'
                    },
                    ticks: {
                        color: this.colors.text
                    },
                    title: {
                        display: true,
                        text: 'Magnitude (dB)', // 동적으로 변경됨
                        color: this.colors.text,
                        padding: { bottom: 4, top: 0 } // Tight padding
                    }
                }
            }
        };
    }

    /**
     * 데이터 새로고침 (Format/Meas 변경 시)
     */
    /**
     * 데이터 새로고침 (Format/Meas 변경 시)
     * 포맷 변경 시에는 스케일 조정이 필요할 수 있음 (기본 fitView=true 유지)
     */
    refreshData() {
        // 시뮬레이션 데이터 업데이트
        if (this.simulationResults && this.simulationResults.success) {
            this.updateSimulationDataForCurrentSettings();
        }

        // 모든 CSV 데이터셋 업데이트
        this.updateCsvDataForCurrentSettings();

        // 포맷 변경 시에는 보통 뷰를 리셋하는 것이 좋음
        this.updateChart(true);
    }

    /**
     * Refresh markers with current dataset values
     */
    refreshMarkers() {
        if (!this.markerManager || this.markerManager.markers.length === 0) return;
        if (!this.chart || !this.chart.data || this.chart.data.datasets.length === 0) return;

        // Find primary dataset (Simulation or first CSV)
        let targetDataset = null;
        const datasets = this.chart.data.datasets;

        // Prefer simulation dataset if visible
        const simDataset = datasets.find(ds => ds.label === 'Simulation' || ds.label === 'S-Parameter');
        if (simDataset && !simDataset.hidden) {
            targetDataset = simDataset;
        } else {
            // Otherwise first visible CSV
            targetDataset = datasets.find(ds => !ds.hidden && ds.label !== 'Markers');
        }

        if (!targetDataset || !targetDataset.data) return;

        this.markerManager.markers.forEach(marker => {
            // Find closest point by X (Frequency)
            // Assuming data is sorted by x
            // We can optimize, but linear search is fine for < 10000 points usually, otherwise binary search.
            // Let's do a simple find for now as robust fallback.

            let closestPoint = null;
            let minDiff = Infinity;

            // Optimization: If sorted, use binary search? 
            // Most data here is freq sorted.
            // For now, let's just stick to a clean linear search to be safe against unsorted CSVs.

            for (const pt of targetDataset.data) {
                const diff = Math.abs(pt.x - marker.x);
                if (diff < minDiff) {
                    minDiff = diff;
                    closestPoint = pt;
                }
            }

            if (closestPoint) {
                // Update marker Y value
                const updates = { y: closestPoint.y };

                // If Smith Chart or Complex Data available
                if (closestPoint.extra) {
                    // Update complex data if available in the point
                    updates.complexData = closestPoint.extra;
                } else if (this.simulationResults) {
                    // Fallback to fetching from raw simulation results if available (better precision)
                    // Use getComplexDataAtFrequency which finds exact or closest frequency match
                    const complex = this.getComplexDataAtFrequency(closestPoint.x);
                    if (complex) {
                        updates.complexData = complex;
                    }
                }

                this.markerManager.updateMarker(marker.id, updates);
            }
        });
    }

    /**
     * 포맷 설정
     */
    setFormat(format) {
        this.currentFormat = format;

        // Check if switching to/from Smith chart mode
        const wasSmithMode = this.isSmithChartMode;
        // ENABLE SMITH CHART for 'smith', 'SParameter', or 'Impedance' format, OR 'matchingRange' measurement
        this.isSmithChartMode = (format === 'smith' || format === 'SParameter' || format === 'impedance' || format === 'Impedance') || (this.currentMeas === 'matchingRange');

        if (this.isSmithChartMode && !wasSmithMode) {
            this.initSmithChart();
        } else if (!this.isSmithChartMode && wasSmithMode) {
            this.destroySmithChart();
        }

        // Set Marker Table Mode
        if (this.markerManager) {
            this.markerManager.setTableMode(this.isSmithChartMode ? 'smith' : 'cartesian');
        }

        // Reset Markers on format change -> NO, keep them!
        // if (this.markerManager) this.markerManager.clear();

        this.refreshData();

        // Refresh Marker Values for new format
        this.refreshMarkers();

        // Force Redraw to apply marker updates to the canvas
        if (this.chart && this.chart.canvas.style.display !== 'none') {
            this.chart.update('none');
        }
        if (this.isSmithChartMode && this.smithChartRenderer) {
            this.smithChartRenderer.draw();
        }

        // Fix: Explicitly update MarkerManager table mode
        if (this.markerManager) {
            this.markerManager.setTableMode(this.isSmithChartMode ? 'smith' : 'cartesian');
        }

        // updateMarkerTableHeaders is redundant and OVERWRITES the correct mode set by setTableMode above.
        // markerManager.setTableMode handles header updates properly.
        // this.updateMarkerTableHeaders(); // <-- CAUSING BUG
    }

    /**
     * 측정 항목 설정
     */
    setMeas(meas) {
        const oldMeas = this.currentMeas;
        this.currentMeas = meas;

        // Force Smith chart mode for Matching Range
        if (meas === 'matchingRange') {
            this.currentFormat = 'smith';
            this.isSmithChartMode = true;
            this.initSmithChart();

            // Force legend update and toggle visibility
            if (this.smithChartRenderer) {
                this.smithChartRenderer.visible.simulation = false;
                this.smithChartRenderer.visible.matchingRange = true; // Show Matching Range
                this.updateSmithChartLegend();
                this.smithChartRenderer.draw();
            }
        } else {
            // Restore visibility for other modes
            if (this.smithChartRenderer) {
                this.smithChartRenderer.visible.simulation = true;
                this.smithChartRenderer.visible.matchingRange = false; // Hide Matching Range by default in other modes
                // Note: We might want to keep 'loadedMatchingRange' visible or not depending on user preference, 
                // but for now strictly following the request for "Matching Range" picture.
            }

            if (this.currentFormat !== 'smith' && this.currentFormat !== 'SParameter' && this.currentFormat !== 'impedance' && this.currentFormat !== 'Impedance') {
                this.isSmithChartMode = false;
                this.destroySmithChart();
            }
        }

        // Update Marker Manager Measurement Mode
        if (this.markerManager) {
            const mode = (meas === 'impedance') ? 'impedance' : 'sparameter';
            this.markerManager.setMeasurementMode(mode);
        }

        // Reset Markers on meas change (Only if actually changed)
        if (this.markerManager && oldMeas !== meas) {
            this.markerManager.clear();
        }

        this.refreshData();
        this.updateMarkerTableHeaders();
    }

    // ============ Smith Chart & Legend Management ============

    /**
     * Set Loaded Matching Range data from CSV
     */
    setLoadedMatchingRangeData(paths) {
        this.loadedMatchingRangeData = paths;
        // Ensure switch to smith mode implies we show it
        if (this.isSmithChartMode && this.smithChartRenderer) {
            this.smithChartRenderer.setLoadedMatchingRangeData(paths);
            this.updateSmithChartLegend();
        }
    }

    /**
     * Initialize Smith Chart renderer with Legend
     */
    initSmithChart() {
        if (this.smithChartRenderer) return;

        // Hide Chart.js canvas, show Smith chart canvas
        if (this.chart) {
            this.chart.canvas.style.display = 'none';
        }

        // Create Smith chart canvas if not exists
        let smithCanvas = document.getElementById(this.canvasId + '_smith');
        if (!smithCanvas) {
            smithCanvas = document.createElement('canvas');
            smithCanvas.id = this.canvasId + '_smith';
            smithCanvas.style.width = '100%';
            smithCanvas.style.height = '100%';
            this.canvas.parentElement.appendChild(smithCanvas);
        }
        smithCanvas.style.display = 'block';

        this.smithChartRenderer = new SmithChartRenderer(smithCanvas.id, this.markerManager);

        // Pass data if exists
        if (this.matchingRangeData) {
            this.smithChartRenderer.setMatchingRangeData(this.matchingRangeData, this.matchingRangeInvertReactance);
        }
        if (this.loadedMatchingRangeData) {
            this.smithChartRenderer.setLoadedMatchingRangeData(this.loadedMatchingRangeData);
        }

        // Setup Legend
        this.createSmithChartLegend();
    }

    /**
     * Destroy Smith Chart renderer and Legend
     */
    destroySmithChart() {
        if (this.smithChartRenderer) {
            this.smithChartRenderer.destroy();
            this.smithChartRenderer = null;
        }

        // Remove Legend
        this.removeSmithChartLegend();

        // Hide Smith chart canvas, show Chart.js canvas
        const smithCanvas = document.getElementById(this.canvasId + '_smith');
        if (smithCanvas) {
            smithCanvas.style.display = 'none';
        }

        if (this.chart) {
            this.chart.canvas.style.display = 'block';
        }
    }

    // ============ Custom Legend Overlay ============

    createSmithChartLegend() {
        const parent = this.canvas.parentElement;
        if (!parent) return;

        // Check existing
        let legend = document.getElementById('smithChartLegend');
        if (!legend) {
            legend = document.createElement('div');
            legend.id = 'smithChartLegend';
            legend.style.position = 'absolute';
            legend.style.top = '10px';
            legend.style.left = '60px'; // Adjusted to not overlap freq
            legend.style.backgroundColor = 'rgba(20, 20, 30, 0.8)';
            legend.style.padding = '8px 12px';
            legend.style.borderRadius = '4px';
            legend.style.color = '#ccc';
            legend.style.fontSize = '12px';
            legend.style.fontFamily = 'Inter, sans-serif';
            legend.style.cursor = 'default';
            legend.style.zIndex = '100'; // Above canvas
            legend.style.display = 'flex';
            legend.style.flexDirection = 'column';
            legend.style.gap = '6px';
            parent.style.position = 'relative'; // Ensure positioning
            parent.appendChild(legend);
        }

        this.updateSmithChartLegend();
    }

    updateSmithChartLegend() {
        const legend = document.getElementById('smithChartLegend');
        if (!legend || !this.smithChartRenderer) return;

        legend.innerHTML = '';

        const items = [];

        // 1. Current Matching Range
        if (this.matchingRangeData && this.currentMeas === 'matchingRange') {
            items.push({
                id: 'matchingRange',
                label: 'Matching Range',
                color: '#00d4ff'
            });
        }

        // 2. Loaded Data
        if (this.loadedMatchingRangeData && this.loadedMatchingRangeData.length > 0) {
            items.push({
                id: 'loadedMatchingRange',
                label: 'Loaded Range',
                color: '#ff6b6b'
            });
        }

        // 3. Sim Trace
        // 3. Sim Trace
        if (this.currentMeas !== 'matchingRange') {
            items.push({
                id: 'simulation',
                label: 'Simulation',
                color: '#00ff00'
            });
        }

        items.forEach(item => {
            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.alignItems = 'center';
            row.style.gap = '8px';
            row.style.cursor = 'pointer';

            // Indicator
            const dot = document.createElement('div');
            dot.style.width = '12px';
            dot.style.height = '3px';
            dot.style.backgroundColor = item.color;
            dot.style.borderRadius = '2px';

            // Text
            const text = document.createElement('span');
            text.textContent = item.label;

            // Strikethrough if hidden
            const isVisible = this.smithChartRenderer.visible[item.id];
            if (!isVisible) {
                text.style.textDecoration = 'line-through';
                text.style.opacity = '0.5';
                dot.style.opacity = '0.5';
            }

            row.appendChild(dot);
            row.appendChild(text);

            // Events
            row.onclick = () => {
                this.smithChartRenderer.toggleVisibility(item.id);
                this.updateSmithChartLegend();
            };

            row.onmouseenter = () => {
                this.smithChartRenderer.setHighlightDataset(item.id);
            };

            row.onmouseleave = () => {
                this.smithChartRenderer.setHighlightDataset(null);
            };

            legend.appendChild(row);
        });
    }

    removeSmithChartLegend() {
        const legend = document.getElementById('smithChartLegend');
        if (legend) {
            legend.remove();
        }
    }

    /**
     * Set Loaded Matching Range data from CSV
     */
    setLoadedMatchingRangeData(paths) {
        this.loadedMatchingRangeData = paths;
        // Ensure we update the renderer if it exists and we are in Smith Chart mode
        if (this.isSmithChartMode && this.smithChartRenderer) {
            this.smithChartRenderer.setLoadedMatchingRangeData(paths);
            this.updateSmithChartLegend();
        }
    }

    /**
     * Set Matching Range data for Smith chart
     */
    setMatchingRangeData(data, invertReactance = false) {
        this.matchingRangeData = data;
        this.matchingRangeInvertReactance = invertReactance;

        // Ensure we're in Smith chart mode
        if (!this.isSmithChartMode) {
            this.currentFormat = 'smith';
            this.isSmithChartMode = true;
            this.initSmithChart();
        }

        if (this.smithChartRenderer) {
            if (data && data.portImpedance) {
                this.smithChartRenderer.portImpedance = { r: data.portImpedance.real, x: data.portImpedance.imag };
            }
            this.smithChartRenderer.setMatchingRangeData(data, invertReactance);
            // Ensure redraw is triggered (setMatchingRangeData calls draw, but we want to be sure)
            this.smithChartRenderer.draw();
        }
    }

    /**
     * 애니메이션 설정
     */
    setAnimation(enabled) {
        this.config.animation = enabled;
        // 차트 옵션 재생성 필요
        if (this.chart) {
            this.chart.options.animation = enabled;
        }
    }

    setAbsoluteImag(absolute) {
        if (this.config.absoluteImag === absolute) return;
        this.config.absoluteImag = absolute;
        this.updateDataForCurrentSettings();
    }

    /**
     * Set Highlight Negative (Lin R, X)
     */
    setHighlightNegative(highlight) {
        if (this.config.highlightNegative === highlight) return;
        this.config.highlightNegative = highlight;
        this.updateDataForCurrentSettings();
    }

    /**
     * Update data for current settings
     */
    updateDataForCurrentSettings() {
        // Data update required
        if (this.currentFormat === 'linRabsX') {
            if (this.simulationResults) this.updateSimulationDataForCurrentSettings();
            if (this.csvDatasets.length > 0) this.updateCsvDataForCurrentSettings();
            this.updateChart();

            // Update Title/Labels
            if (this.chart) {
                this.chart.options.plugins.title.text = this.getGraphTitle();
                // Y Axis title might need update too if we change unit label
                let section = this.currentMeas === 'impedance' ? this.impedanceFormatConfig : this.formatConfig;
                let label = section[this.currentFormat]?.label || 'Value';
                // Dynamic Label Update for Lin R, X
                if (this.currentFormat === 'linRabsX') {
                    label = this.config.absoluteImag ? 'R & |X| (Ω)' : 'R & X (Ω)';
                }
                this.chart.options.scales.y.title.text = label;
                this.chart.update();
            }
        } else {
            // For other formats, just update existing data if needed
            if (this.simulationResults) this.updateSimulationDataForCurrentSettings();
            if (this.csvDatasets.length > 0) this.updateCsvDataForCurrentSettings();
            this.updateChart();
        }
    }

    /**
     * X축 스케일 설정
     */
    setXAxisScale(scale) {
        this.currentXAxisScale = scale;
        // 차트 옵션 재생성 필요 (Scale type 변경은 옵션 전체 갱신이 안전)
        if (this.chart) {
            this.chart.options.scales.x.type = scale;
            this.chart.update();
        }
    }

    /**
     * Get Gradient for Negative Highlighting
     */
    getNegativeGradient(context, posColor, negColor) {
        const chart = context.chart;
        const { ctx, chartArea, scales } = chart;
        const colorPositive = posColor || '#ff922b'; // Default Orange
        const colorNegative = negColor || '#4ecdc4'; // Default Teal

        if (!chartArea) {
            // Initial render or no area yet
            return colorPositive;
        }

        const yScale = scales.y;
        if (!yScale) return colorPositive;

        // Calculate y-position of 0 value
        const yZero = yScale.getPixelForValue(0);
        const top = chartArea.top;
        const bottom = chartArea.bottom;

        // If 0 is outside, return appropriate solid color
        if (yZero > bottom) {
            // 0 is Below the chart area. All visible values are > 0. (Positive)
            return colorPositive;
        }
        if (yZero < top) {
            // 0 is above the chart area. All visible values are < 0. (Negative)
            return colorNegative;
        }

        // Calculate gradient stop position (0 to 1)
        const gradient = ctx.createLinearGradient(0, top, 0, bottom);
        const stop = (yZero - top) / (bottom - top);

        // Standard Chart.js gradient stops for hard transition
        // Top (Max) -> Zero (Positive)
        // Zero -> Bottom (Min) (Negative)

        gradient.addColorStop(0, colorPositive);
        gradient.addColorStop(stop, colorPositive);
        gradient.addColorStop(stop, colorNegative); // Transition point
        gradient.addColorStop(1, colorNegative);

        return gradient;
    }

    /**
     * Generate a distinct secondary color (Complementary implementation)
     * @param {string} hex - Base Hex Color
     * @returns {string} - Secondary Hex Color
     */
    getSecondaryColor(hex) {
        if (!hex || typeof hex !== 'string') return '#888888';

        // Remove # if present
        hex = hex.replace('#', '');

        // Handle short hex (e.g. F00)
        if (hex.length === 3) {
            hex = hex.split('').map(c => c + c).join('');
        }

        // Parse RGB
        let r = parseInt(hex.substring(0, 2), 16);
        let g = parseInt(hex.substring(2, 4), 16);
        let b = parseInt(hex.substring(4, 6), 16);

        // RGB to HSL
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h, s, l = (max + min) / 2;

        if (max === min) {
            h = s = 0; // achromatic
        } else {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            h /= 6;
        }

        // Shift Hue by 180 degrees (Complementary)
        // Adjust Saturation/Lightness slightly to ensure visibility
        h = (h + 0.5) % 1;
        // Force saturation to be at least 50% for vibrancy
        if (s < 0.5) s = 0.6;
        // Keep lightness balanced
        if (l < 0.3) l = 0.5;
        if (l > 0.8) l = 0.6;

        // HSL to RGB
        let r1, g1, b1;
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };

        if (s === 0) {
            r1 = g1 = b1 = l;
        } else {
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r1 = hue2rgb(p, q, h + 1 / 3);
            g1 = hue2rgb(p, q, h);
            b1 = hue2rgb(p, q, h - 1 / 3);
        }

        const toHex = x => {
            const hex = Math.round(x * 255).toString(16);
            return hex.length === 1 ? '0' + hex : hex;
        };

        return `#${toHex(r1)}${toHex(g1)}${toHex(b1)}`;
    }

    /**
     * Generate a shifted color by adjusting Hue
     * @param {string} hex - Base Hex Color
     * @param {number} degree - Hue shift degree (default 180)
     * @returns {string} - Shifted Hex Color
     */
    getShiftedColor(hex, degree = 180) {
        if (!hex || typeof hex !== 'string') return '#888888';

        // Remove # if present
        hex = hex.replace('#', '');

        // Handle short hex (e.g. F00)
        if (hex.length === 3) {
            hex = hex.split('').map(c => c + c).join('');
        }

        // Parse RGB
        let r = parseInt(hex.substring(0, 2), 16);
        let g = parseInt(hex.substring(2, 4), 16);
        let b = parseInt(hex.substring(4, 6), 16);

        // RGB to HSL
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h, s, l = (max + min) / 2;

        if (max === min) {
            h = s = 0; // achromatic
        } else {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            h /= 6;
        }

        // Shift Hue
        h = (h + (degree / 360)) % 1;
        if (h < 0) h += 1;

        // Force saturation to be at least 50% for vibrancy
        if (s < 0.5) s = 0.6;
        // Keep lightness balanced
        if (l < 0.3) l = 0.5;
        if (l > 0.8) l = 0.6;

        // HSL to RGB
        let r1, g1, b1;
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };

        if (s === 0) {
            r1 = g1 = b1 = l;
        } else {
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r1 = hue2rgb(p, q, h + 1 / 3);
            g1 = hue2rgb(p, q, h);
            b1 = hue2rgb(p, q, h - 1 / 3);
        }

        const toHex = x => {
            const hex = Math.round(x * 255).toString(16);
            return hex.length === 1 ? '0' + hex : hex;
        };

        return `#${toHex(r1)}${toHex(g1)}${toHex(b1)}`;
    }

    /**
     * 현재 설정에 맞게 시뮬레이션 데이터 업데이트
     */
    updateSimulationDataForCurrentSettings() {
        if (!this.simulationResults) return;

        const results = this.simulationResults;
        const frequencies = results.frequencies;
        const currentMeas = this.currentMeas; // 'S11' or 'impedance'
        const currentFormat = this.currentFormat;

        let yData = [];



        // Special handling for 'linRabsX' -> return array of 2 datasets
        if (currentFormat === 'linRabsX') {
            let yDataR = [];
            let yDataX = [];

            if (currentMeas === 'impedance') {
                const zin = results.zin;
                yDataR = zin.map(z => z.real);
                yDataX = zin.map(z => Math.abs(z.imag));
            } else {
                if (!results.sMatrix || !results.sMatrix[currentMeas]) return;
                const sData = results.sMatrix[currentMeas];
                yDataR = sData.complex.map(c => c.real);
                yDataX = sData.complex.map(c => Math.abs(c.imag));
            }

            const datasetR = {
                label: currentMeas === 'impedance' ? 'Resistance' : 'Real',
                data: frequencies.map((f, i) => ({ x: f, y: yDataR[i] })),
                label: currentMeas === 'impedance' ? 'Resistance' : 'Real',
                data: frequencies.map((f, i) => ({ x: f, y: yDataR[i] })),
                borderColor: this.getDynamicBorderColor(this.colors.simulation.line), // Default Blue
                borderWidth: this.getDynamicBorderWidth(),
                borderWidth: this.getDynamicBorderWidth(),
                backgroundColor: this.colors.simulation.fill,
                pointBackgroundColor: this.colors.simulation.point,
                fill: false,
                pointRadius: 0,
                pointHoverRadius: 4,
                tension: 0.1
            };

            const datasetX = {
                label: (currentMeas === 'impedance'
                    ? (this.config.absoluteImag ? '|Reactance|' : 'Reactance')
                    : (this.config.absoluteImag ? '|Imag|' : 'Imag')),
                data: frequencies.map((f, i) => ({ x: f, y: this.config.absoluteImag ? yDataX[i] : (currentMeas === 'impedance' ? this.simulationResults.zin[i].imag : this.simulationResults.sMatrix[currentMeas].complex[i].imag) })),
                borderColor: (this.currentFormat === 'linRabsX' && !this.config.absoluteImag && this.config.highlightNegative)
                    ? (context) => this.getNegativeGradient(context, '#ff922b', '#4ecdc4') // Pos: Orange, Neg: Teal
                    : '#ff922b', // Default Orange (matches Point Fill)
                borderWidth: this.getDynamicBorderWidth(),
                backgroundColor: 'rgba(255, 146, 43, 0.1)', // Orange Fill
                pointBackgroundColor: '#ff922b', // Orange Point
                pointBorderColor: '#4ecdc4', // Teal Border
                pointRadius: 0,
                pointHoverRadius: 5,
                // Fix Hover Gradient: Explicit solid colors
                pointHoverBackgroundColor: '#ff922b',
                pointHoverBorderColor: '#4ecdc4',
                fill: false,
                tension: 0.1
            };

            this.simulationData = [datasetR, datasetX];

        } else {
            // Standard single dataset handling
            let yData = [];
            if (currentMeas === 'impedance') {
                const zin = results.zin;
                yData = zin.map(z => {
                    switch (currentFormat) {
                        case 'logMag': return z.magnitude() > 0 ? 20 * Math.log10(z.magnitude()) : -100;
                        case 'linMag': return z.magnitude();
                        case 'phase': return z.phaseDeg();
                        default: return z.magnitude();
                    }
                });
            } else {
                if (!results.sMatrix || !results.sMatrix[currentMeas]) return;
                const sData = results.sMatrix[currentMeas];
                switch (currentFormat) {
                    case 'logMag': yData = sData.mag_db; break;
                    case 'linMag': yData = sData.complex.map(c => c.magnitude()); break;
                    case 'phase': yData = sData.phase; break;
                    case 'swr': yData = sData.mag_db.map(db => FormatConverter.dbToSwr(db)); break;
                    default: yData = sData.mag_db;
                }
            }

            // 데이터셋 구성 (Scriptable Options 적용)
            this.simulationData = {
                label: currentMeas === 'impedance' ? 'Zin (Sim)' : `${currentMeas} (Sim)`,
                data: frequencies.map((f, i) => ({ x: f, y: yData[i] })),

                // Scriptable Options
                borderColor: this.getDynamicBorderColor(this.colors.simulation.line),
                borderWidth: this.getDynamicBorderWidth(),

                backgroundColor: this.colors.simulation.fill,
                pointBackgroundColor: this.colors.simulation.point,
                fill: false,
                pointRadius: 0,
                pointHoverRadius: 4,
                tension: 0.1
            };
        }

        // Y축 라벨 업데이트
        if (this.chart) {
            let label = '';
            if (currentMeas === 'impedance') {
                label = this.impedanceFormatConfig[currentFormat]?.label || 'Value';
            } else {
                label = this.formatConfig[currentFormat]?.label || 'Value';
            }
            this.chart.options.scales.y.title.text = label;
        }

        // Update Port Impedance for Smith Chart (if loaded)
        if (this.smithChartRenderer) {
            // 1. Port Impedance (Start Point)
            if (results.zin && results.zin.length > 0) {
                const z0 = results.zin[0];
                this.smithChartRenderer.portImpedance = { r: z0.real, x: z0.imag };
            }

            // 2. Simulation Trace (Frequency Sweep)
            // Calculate Gamma points for the entire frequency range
            let gammaPoints = [];

            if (currentMeas === 'impedance' && results.zin) {
                // Convert Zin to Gamma
                // Use system Z0 from simulation config, default to 50 if missing
                const systemZ0 = (results.config && results.config.z0) ? results.config.z0 : 50;

                gammaPoints = results.zin.map((z, i) => {
                    const rNorm = z.real / systemZ0;
                    const xNorm = z.imag / systemZ0;
                    const den = (rNorm + 1) * (rNorm + 1) + xNorm * xNorm;

                    const freq = (results.frequencies && results.frequencies[i] !== undefined) ? results.frequencies[i] : null;

                    if (den === 0) return { real: 1, imag: 0, freq: freq };

                    const gr = ((rNorm * rNorm) + (xNorm * xNorm) - 1) / den;
                    const gi = (2 * xNorm) / den;
                    return { real: gr, imag: gi, freq: freq };
                });
            } else if (results.sMatrix) {
                // S-Parameters are already Gamma (reflection coefficient)
                // Use currentMeas (e.g. 'S11', 'S21') if available, otherwise default to 'S11'
                const measKey = (currentMeas && results.sMatrix[currentMeas]) ? currentMeas : 'S11';

                if (results.sMatrix[measKey]) {
                    // Check if it's the processed Map form
                    if (results.sMatrix[measKey].complex) {
                        gammaPoints = results.sMatrix[measKey].complex.map((c, i) => ({
                            real: c.real,
                            imag: c.imag,
                            freq: (results.frequencies && results.frequencies[i] !== undefined) ? results.frequencies[i] : null
                        }));
                    }
                } else if (results.sMatrix[0] && results.sMatrix[0][0]) {
                    // Fallback to array based generic S11
                    gammaPoints = results.sMatrix[0][0].map((s, i) => ({
                        real: s.re,
                        imag: s.im,
                        freq: (results.frequencies && results.frequencies[i] !== undefined) ? results.frequencies[i] : null
                    }));
                }
            }

            // Pass the trace to renderer
            this.smithChartRenderer.setSimulationTrace(gammaPoints);

            this.smithChartRenderer.draw();
        }

        this.updateMarkerTableHeaders();
    }

    /**
     * 현재 설정에 맞게 모든 CSV 데이터셋 업데이트
     */
    updateCsvDataForCurrentSettings() {
        if (!this.csvDatasets || this.csvDatasets.length === 0) return;

        const currentMeas = this.currentMeas.toLowerCase();

        this.csvDatasets.forEach(dataset => {
            const z0 = (dataset.metadata && dataset.metadata.z0 && dataset.metadata.z0.r) ? dataset.metadata.z0.r : 50;
            const lineColor = dataset.color; // Real part uses Base Color

            // Generate Dynamic Colors for Imaginary Part
            // X Positive: Complementary (180deg)
            const imagColorPos = this.getShiftedColor(dataset.color, 180);
            // X Negative: Distinct Shift (e.g., 90deg) instead of fixed Teal
            const imagColorNeg = this.getShiftedColor(dataset.color, 90);

            // Special handling for 'linRabsX': Generate TWO datasets (Real & Imag)
            if (this.currentFormat === 'linRabsX') {
                const dataR = [];
                const dataX = [];

                dataset.rawData.forEach(point => {
                    let real, imag;
                    if (point.s11_real !== undefined && point.s11_imag !== undefined) {
                        real = point.s11_real; imag = point.s11_imag;
                    } else {
                        const db = point.s11_db !== undefined ? point.s11_db : 0;
                        const phaseDeg = point.phase !== undefined ? point.phase : 0;
                        const mag = Math.pow(10, db / 20);
                        const phaseRad = phaseDeg * (Math.PI / 180);
                        real = mag * Math.cos(phaseRad); imag = mag * Math.sin(phaseRad);
                    }
                    if (currentMeas === 'impedance') {
                        const den = Math.pow(1 - real, 2) + Math.pow(imag, 2);
                        if (den === 0) { real = 1e9; imag = 0; } else {
                            const zNormReal = (1 - real * real - imag * imag) / den;
                            const zNormImag = (2 * imag) / den;
                            real = zNormReal * z0; imag = zNormImag * z0;
                        }
                    }

                    dataR.push({ x: point.frequency, y: real });
                    dataX.push({ x: point.frequency, y: this.config.absoluteImag ? Math.abs(imag) : imag });
                });

                // Style: Real (Original Color), Imag (Complementary/Different Color)
                // Simple complement: Invert or Hue Shift. Let's start with a fixed hue shift or just lighter/darker?
                // User requested "Different Color".
                // Let's use a secondary color derived from palette or just an accent.
                // Ideally, we associate the second color with the first.
                // E.g. Red -> Orange, Green -> Blue?
                // Simplest: Shift Hue by 180 (Complementary) or 30?
                // Let's use getComputedStyle/Color manipulation if complex, but simple string manip is safer.
                // Actually, we can just pick the NEXT color in palette?
                // But multiple CSVs need consistent pairing.
                // Let's use a semi-transparent version or a distinct valid color.
                // Or just hardcode a secondary color logic?
                // Let's assume dataset.color is a hex or standard name.
                // Let's try to pass a specific Imag color.
                const imagColor = '#888888'; // Fallback if simple
                // Or just use the SAME color but Dashed? User specifically said "Real과 다른 색상, 실선".
                // Let's try to generate a variant.

                const datasetR = {
                    label: (dataset.label || 'Data') + ' (R)',
                    data: dataR,
                    borderColor: this.getDynamicBorderColor(dataset.color),
                    borderWidth: this.getDynamicBorderWidth(),
                    pointRadius: 0,
                    pointHoverRadius: 5,
                    fill: false,
                    tension: 0.1,
                    backgroundColor: dataset.color,
                    pointBackgroundColor: dataset.color
                };

                const datasetX = {
                    label: (dataset.label || 'Data') + (this.config.absoluteImag ? ' (|X|)' : ' (X)'),
                    data: dataX,
                    // Use imagColorPos (Positive) and imagColorNeg (Negative)
                    borderColor: (this.currentFormat === 'linRabsX' && !this.config.absoluteImag && this.config.highlightNegative)
                        ? (context) => this.getNegativeGradient(context, imagColorPos, imagColorNeg)
                        : imagColorPos,

                    borderWidth: this.getDynamicBorderWidth(),
                    pointRadius: 0,
                    pointHoverRadius: 5,
                    fill: false,
                    tension: 0.1,
                    backgroundColor: imagColorPos,
                    pointBackgroundColor: imagColorPos,
                    // Legend Border Color: Neg Color if Highlight Active, else Pos Color
                    pointBorderColor: (this.currentFormat === 'linRabsX' && !this.config.absoluteImag && this.config.highlightNegative)
                        ? imagColorNeg
                        : imagColorPos,
                    // Fix Hover Artifacts & Match Style
                    pointHoverBackgroundColor: imagColorPos,
                    pointHoverBorderColor: imagColorNeg // Use Negative color for hover border to match legend style? or just simple?
                };

                dataset.processedData = [datasetR, datasetX];

            } else {
                // Standard Implementation
                // ... existing logic ...
                const yData = dataset.rawData.map(point => {
                    // ... (Existing implementation repeated for correctness)
                    let real, imag;
                    if (point.s11_real !== undefined && point.s11_imag !== undefined) {
                        real = point.s11_real; imag = point.s11_imag;
                    } else {
                        const db = point.s11_db !== undefined ? point.s11_db : 0;
                        const phaseDeg = point.phase !== undefined ? point.phase : 0;
                        const mag = Math.pow(10, db / 20);
                        const phaseRad = phaseDeg * (Math.PI / 180);
                        real = mag * Math.cos(phaseRad); imag = mag * Math.sin(phaseRad);
                    }
                    if (currentMeas === 'impedance') {
                        const den = Math.pow(1 - real, 2) + Math.pow(imag, 2);
                        if (den === 0) { real = 1e9; imag = 0; } else {
                            const zNormReal = (1 - real * real - imag * imag) / den;
                            const zNormImag = (2 * imag) / den;
                            real = zNormReal * z0; imag = zNormImag * z0;
                        }
                    }
                    switch (this.currentFormat) {
                        case 'logMag': return FormatConverter.complexToMagDb(real, imag);
                        case 'linMag': return Math.sqrt(real * real + imag * imag);
                        case 'phase': return FormatConverter.complexToPhase(real, imag);
                        case 'swr':
                            // ... existing impedance SWR logic
                            if (currentMeas === 'impedance') {
                                let gR, gI;
                                if (point.s11_real !== undefined) { gR = point.s11_real; gI = point.s11_imag; }
                                else {
                                    const db = point.s11_db || 0;
                                    const mag = Math.pow(10, db / 20);
                                    const ph = (point.phase || 0) * Math.PI / 180;
                                    gR = mag * Math.cos(ph); gI = mag * Math.sin(ph);
                                }
                                const gMag = Math.sqrt(gR * gR + gI * gI);
                                if (gMag >= 1) return 999;
                                return (1 + gMag) / (1 - gMag);
                            } else {
                                const mag = Math.sqrt(real * real + imag * imag);
                                if (mag >= 1) return 999;
                                return (1 + mag) / (1 - mag);
                            }
                        default: return FormatConverter.complexToMagDb(real, imag);
                    }
                });

                dataset.processedData = {
                    label: dataset.label || `Data ${this.csvDatasets.indexOf(dataset) + 1}`,
                    data: dataset.rawData.map((point, i) => ({ x: point.frequency, y: yData[i] })),
                    borderColor: this.getDynamicBorderColor(dataset.color),
                    borderWidth: this.getDynamicBorderWidth(),
                    backgroundColor: dataset.color,
                    pointBackgroundColor: dataset.color,
                    pointBorderColor: dataset.color,
                    pointRadius: 0,
                    pointHoverRadius: 5,
                    fill: false,
                    tension: 0.1
                };
            }
        });

        // Smith Chart Update for CSV Data (Existing)
        if (this.isSmithChartMode && this.smithChartRenderer) {
            // ... (Same as before)
            const loadedPaths = [];
            this.csvDatasets.forEach(dataset => {
                const points = dataset.rawData.map(point => {
                    let real, imag;
                    if (point.s11_real !== undefined && point.s11_imag !== undefined) {
                        real = point.s11_real; imag = point.s11_imag;
                    } else {
                        const db = point.s11_db !== undefined ? point.s11_db : 0;
                        const phaseDeg = point.phase !== undefined ? point.phase : 0;
                        const mag = Math.pow(10, db / 20);
                        const phaseRad = phaseDeg * (Math.PI / 180);
                        real = mag * Math.cos(phaseRad); imag = mag * Math.sin(phaseRad);
                    }
                    return { real: real, imag: imag };
                });
                loadedPaths.push({ points: points });
            });
            this.setLoadedMatchingRangeData(loadedPaths);
        }
    }

    /**
     * 주파수 포맷팅
     */
    formatFrequency(hz) {
        if (hz >= 1e9) return (hz / 1e9).toFixed(2) + ' GHz';
        if (hz >= 1e6) return (hz / 1e6).toFixed(2) + ' MHz';
        if (hz >= 1e3) return (hz / 1e3).toFixed(2) + ' kHz';
        return hz.toFixed(0) + ' Hz';
    }

    /**
     * 시뮬레이션 결과 설정
     */
    /**
     * 시뮬레이션 결과 설정
     * @param {Object} results - Simulation results
     * @param {boolean} fitView - Whether to auto-scale the Y-axis
     */
    setSimulationData(results, fitView = true) {
        this.simulationResults = results;
        this.updateSimulationDataForCurrentSettings();
        this.updateChart(fitView);
    }

    /**
     * CSV 데이터 추가 (이전 데이터 유지)
     */
    addCsvData(data, metadata = {}) {
        if (!data || data.length === 0) return;

        // 색상 선택 (순환)
        const colorIndex = this.csvDatasets.length % this.colors.csvPalette.length;
        const color = this.colors.csvPalette[colorIndex];

        const newDataset = {
            rawData: data,
            metadata: metadata,
            label: metadata.fileName || `Data ${this.csvDatasets.length + 1}`,
            color: color,
            processedData: null // Will be generated in updateCsvDataForCurrentSettings
        };

        this.csvDatasets.push(newDataset);

        // 현재 설정으로 데이터 업데이트 및 차트 갱신
        this.updateCsvDataForCurrentSettings();
        this.updateChart();
    }

    /**
     * Legacy support wrapper (optional, or remove if unused)
     */
    setCsvData(data) {
        this.clearCsvData(); // Clear old logic
        this.addCsvData(data);
    }

    /**
     * CSV 데이터만 초기화
     */
    clearCsvData() {
        this.csvDatasets = [];
        this.updateChart();
    }

    /**
     * 차트 업데이트
     */
    /**
     * 차트 업데이트
     * @param {boolean} fitView - Whether to auto-scale the Y-axis
     */
    updateChart(fitView = true) {
        if (!this.chart) return;

        const datasets = [];

        if (this.simulationData && this.config.showSimulation) {
            if (Array.isArray(this.simulationData)) {
                datasets.push(...this.simulationData);
            } else {
                datasets.push(this.simulationData);
            }
        }

        if (this.config.showCsv && this.csvDatasets.length > 0) {
            this.csvDatasets.forEach(ds => {
                if (ds.processedData) {
                    if (Array.isArray(ds.processedData)) {
                        datasets.push(...ds.processedData);
                    } else {
                        datasets.push(ds.processedData);
                    }
                }
            });
        }

        this.chart.data.datasets = datasets;

        // Y축 자동 스케일 (fitView가 true일 때만 실행)
        // Calculate Global Min/Max X and Y
        if (datasets.length > 0 && fitView) {
            let minY = Infinity;
            let maxY = -Infinity;
            let minX = Infinity;
            let maxX = -Infinity;

            datasets.forEach(ds => {
                ds.data.forEach(point => {
                    // Y Axis Calc
                    if (isFinite(point.y)) {
                        if (point.y < minY) minY = point.y;
                        if (point.y > maxY) maxY = point.y;
                    }
                    // X Axis Calc
                    if (isFinite(point.x)) {
                        if (point.x < minX) minX = point.x;
                        if (point.x > maxX) maxX = point.x;
                    }
                });
            });

            // Calculate Margins (Padding)
            let paddedMinX = minX;
            let paddedMaxX = maxX;
            let paddedMinY = minY;
            let paddedMaxY = maxY;

            // Y-Axis Padding (10%)
            if (isFinite(minY) && isFinite(maxY)) {
                let yMargin = (maxY - minY) * 0.1;
                if (yMargin === 0) yMargin = 5; // Default for single value
                paddedMinY = minY - yMargin;
                paddedMaxY = maxY + yMargin;
            }

            // X-Axis Padding (5%)
            if (isFinite(minX) && isFinite(maxX)) {
                let xMargin = (maxX - minX) * 0.05;
                if (xMargin === 0) xMargin = minX * 0.05 || 10; // Default margin
                paddedMinX = Math.max(0, minX - xMargin); // Freq cannot be negative usually
                paddedMaxX = maxX + xMargin;
            }

            // Apply Y-Axis Auto Scale & Limits
            if (this.config.autoScale && isFinite(paddedMinY) && isFinite(paddedMaxY)) {
                // Set initial view
                this.chart.options.scales.y.min = paddedMinY;
                this.chart.options.scales.y.max = paddedMaxY;

                // Ensure limits object exists
                if (!this.chart.options.plugins.zoom.limits) {
                    this.chart.options.plugins.zoom.limits = {};
                }

                // Set Zoom/Pan Limits
                this.chart.options.plugins.zoom.limits.y = {
                    min: paddedMinY,
                    max: paddedMaxY,
                    minRange: (paddedMaxY - paddedMinY) * 0.01
                };
            }

            // Apply X-Axis Auto Scale & Limits
            if (isFinite(paddedMinX) && isFinite(paddedMaxX)) {
                // Set initial view
                this.chart.options.scales.x.min = paddedMinX;
                this.chart.options.scales.x.max = paddedMaxX;

                // Set Zoom/Pan Limits
                this.chart.options.plugins.zoom.limits.x = {
                    min: paddedMinX,
                    max: paddedMaxX,
                    minRange: (paddedMaxX - paddedMinX) * 0.01
                };
            }
        }


        this.updateMarkersWithNewData();
        this.chart.update();
    }

    /**
     * 현재 그래프의 View State (Zoom/Pan 상태) 반환
     */
    getViewState() {
        if (!this.chart) return null;

        const scales = this.chart.scales;
        return {
            x: {
                min: scales.x.min,
                max: scales.x.max
            },
            y: {
                min: scales.y.min,
                max: scales.y.max
            }
        };
    }

    /**
     * 그래프 View State 복원
     */
    setViewState(state) {
        if (!this.chart || !state) return;

        // Explicitly set limits to restore zoom/pan
        if (state.x) {
            this.chart.options.scales.x.min = state.x.min;
            this.chart.options.scales.x.max = state.x.max;
        }
        if (state.y) {
            this.chart.options.scales.y.min = state.y.min;
            this.chart.options.scales.y.max = state.y.max;
        }

        this.chart.update();
    }

    /**
     * 그래프 제목 가져오기
     */
    getGraphTitle() {
        const formatNames = {
            logMag: 'Log Mag',
            linMag: 'Lin Mag',
            phase: 'Phase',
            swr: 'SWR',
            delay: 'Delay',
            smith: 'Smith Chart',
            polar: 'Polar',
            linRabsX: this.config.absoluteImag ? 'Lin R, |X|' : 'Lin R, X'
        };

        // Matching Range
        if (this.currentMeas === 'matchingRange') {
            return 'Matching Range - Smith Chart';
        }

        // Impedance일 때 더 명확한 제목
        if (this.currentMeas === 'impedance') {
            const impedanceFormatNames = {
                logMag: '|Z| (dBΩ)',
                linMag: '|Z| (Ω)',
                phase: 'Z Phase (°)',
                smith: 'Smith Chart',
                linRabsX: this.config.absoluteImag ? 'R, |X| (Ω)' : 'R, X (Ω)'
            };
            return `Impedance ${impedanceFormatNames[this.currentFormat] || formatNames[this.currentFormat]} vs Frequency`;
        }

        // Smith chart format
        if (this.currentFormat === 'smith') {
            return `${this.currentMeas} - Smith Chart`;
        }

        return `${this.currentMeas} ${formatNames[this.currentFormat] || this.currentFormat} vs Frequency`;
    }

    /**
     * 그래프 초기화
     */
    clear() {
        this.simulationData = null;
        this.simulationResults = null;
        this.csvData = null; // Legacy
        this.csvRawData = null; // Legacy
        this.csvDatasets = []; // Clear all CSV datasets
        this.updateChart();
    }

    /**
     * 마커 추가
     */
    addMarker(frequency, value, label = 'Point') {
        if (!this.markerManager) return;

        this.markerManager.addMarker(label, {
            x: frequency,
            y: value,
            unitX: 'Hz',
            unitY: '' // Let formatting handle it based on context if strictly number, but 'value' is usually dB or similar
        });

        if (this.chart) this.chart.update();
    }

    /**
     * 마커 제거
     */
    clearMarkers() {
        if (!this.chart) return;
        this.chart.data.datasets = this.chart.data.datasets.filter(ds => ds.label !== 'Markers');
        this.chart.update();
    }

    /**
     * 줌 리셋
     */
    resetZoom() {
        if (this.chart && this.chart.resetZoom) {
            this.chart.resetZoom();
        }
    }

    /**
     * 그래프 이미지 다운로드
     */
    downloadImage(filename = 'sparam_graph.png') {
        if (!this.chart) return;
        const link = document.createElement('a');
        link.download = filename;
        link.href = this.chart.toBase64Image();
        link.click();
    }

    /**
     * 데이터 CSV로 저장 (Keysight 호환)
     */
    saveDataAsCSV() {
        let data = null;
        if (this.simulationData) {
            data = this.simulationData.data;
        } else if (this.csvDatasets && this.csvDatasets.length > 0) {
            // If multiple CSVs, save the last one for now or maybe merge?
            // Existing logic suggests saving 'the' loaded data. 
            // We'll save the most recently loaded one.
            const lastDataset = this.csvDatasets[this.csvDatasets.length - 1];
            if (lastDataset && lastDataset.processedData) {
                data = lastDataset.processedData.data;
            }
        }

        if (!data || data.length === 0) {
            alert('저장할 데이터가 없습니다.');
            return;
        }

        const now = new Date().toLocaleString('en-US', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
        });

        // 헤더 생성
        let csvContent = '!CSV A.01.01\n';
        // User requested: A2=RF_Circuit_Calculator, B2=Simulated, C2=A.01.00
        csvContent += 'RF_Circuit_Calculator,Simulated,A.01.00\n';
        csvContent += `!Date: ${now}\n`;
        csvContent += '!Source: Simulation\n\n';
        csvContent += 'BEGIN CH1_DATA\n';

        // 컬럼 헤더 및 데이터 포맷 결정
        const meas = this.currentMeas; // e.g., 'S11'
        let colName = 'Lin Mag(U)';
        let formatter = (val) => val; // Default linear

        // unitMap for Keysight standard usually: Lin Mag(U), Log Mag(dB), Phase(deg)
        // Check current format
        switch (this.currentFormat) {
            case 'logMag':
                colName = 'Log Mag(dB)';
                break;
            case 'linMag':
                colName = 'Lin Mag(U)';
                break;
            case 'phase':
                colName = 'Phase(deg)';
                break;
            case 'swr':
                colName = 'SWR(U)';
                break;
            case 'linRabsX':
                // This format generates two datasets, so CSV export needs special handling
                // For now, we'll just export the first dataset (Real part)
                colName = 'R(ohm)';
                break;
            default:
                colName = 'Lin Mag(U)';
        }

        if (meas === 'impedance') {
            // Impedance is special, maybe just save as Magnitude for now?
            // Or "Z Mag(ohm)"? Keysight CSV usually specific for S-Params.
            // Let's format nicely: Freq(Hz),Z Mag(ohm) or Z Mag(dB)
            const unit = this.formatConfig[this.currentFormat]?.unit || '';
            colName = `Z ${this.currentFormat}(${unit})`;
        }

        // Header Line: Freq(Hz),S11 Log Mag(dB)
        csvContent += `Freq(Hz),${meas} ${colName}\n`;

        // Data Rows
        data.forEach(point => {
            csvContent += `${point.x},${point.y}\n`;
        });

        csvContent += 'END\n';

        // Download
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const filename = this.simulationData ? 'simulation_data.csv' : 'graph_data.csv';
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
    }

    // ============ Marker Logic ============

    handleContextMenu(e) {
        e.preventDefault();

        if (!this.contextMenu) return;

        // Calculate Position
        const mouseX = e.clientX;
        const mouseY = e.clientY;

        // Clear existing items
        this.contextMenu.innerHTML = '';

        // Add Items based on functionality
        const addMenuItem = (text, icon, onClick) => {
            const li = document.createElement('li');
            li.className = 'context-menu-item';
            li.innerHTML = `<span class="icon">${icon}</span> ${text}`;
            li.onclick = (evt) => {
                evt.stopPropagation();
                this.contextMenu.style.display = 'none';
                onClick();
            };
            this.contextMenu.appendChild(li);
        };

        const canvasRect = this.canvas.getBoundingClientRect();
        const x = e.clientX - canvasRect.left;
        const y = e.clientY - canvasRect.top;

        // Add Marker (Generic)
        addMenuItem('Add Marker', '▼', () => {
            this.addInteractiveMarker('Marker', x, y);
        });

        // Show Menu
        this.contextMenu.style.display = 'block';
        this.contextMenu.style.left = `${mouseX}px`;
        this.contextMenu.style.top = `${mouseY}px`;
    }

    addInteractiveMarker(type, clientX, clientY) {
        if (!this.chart) return;

        const scales = this.chart.scales;
        const xVal = scales.x.getValueForPixel(clientX);
        const yVal = scales.y.getValueForPixel(clientY);

        let displayData = {
            x: xVal,
            y: yVal,
            unitX: 'Hz',
            unitY: '',
            format: this.currentFormat
        };

        let targetY = yVal;
        let targetX = xVal;

        if (type === 'Marker') {
            // Try to find nearest data point in visible datasets
            let minDist = Infinity;
            let snapY = yVal;
            let snapX = xVal;

            this.chart.data.datasets.forEach((dataset, i) => {
                const meta = this.chart.getDatasetMeta(i);
                if (meta.hidden) return;

                const data = dataset.data;
                if (!data) return;

                // Find closest x
                const closest = data.reduce((prev, curr) => {
                    return (Math.abs(curr.x - xVal) < Math.abs(prev.x - xVal) ? curr : prev);
                });

                if (closest) {
                    const pixelX = scales.x.getPixelForValue(closest.x);
                    const dist = Math.abs(pixelX - clientX);
                    if (dist < minDist) {
                        minDist = dist;
                        snapX = closest.x;
                        snapY = closest.y;
                    }
                }
            });

            // Always snap to trace if possible, otherwise use loose values
            targetX = snapX;
            targetY = snapY;

            displayData.x = targetX;
            displayData.y = targetY;

            // Fetch complex data if available
            const complex = this.getComplexDataAtFrequency(targetX);
            if (complex) {
                displayData.complexData = complex;
            }
        }

        this.markerManager.addMarker(type, displayData);
        this.chart.update();
    }

    /**
     * Helper: Find closest data point from visible datasets for a given X value
     */
    getClosestDataPoint(xValue) {
        if (!this.chart || !this.chart.data || this.chart.data.datasets.length === 0) return null;

        // Usually we want to snap to the main trace (Simulation) if it exists.

        let targetDataset = null;

        // Find first visible dataset with data
        for (let i = 0; i < this.chart.data.datasets.length; i++) {
            const ds = this.chart.data.datasets[i];
            const meta = this.chart.getDatasetMeta(i);

            // Skip hidden datasets or marker datasets (if any)
            if (!meta.hidden && ds.data && ds.data.length > 0 && ds.label !== 'Markers') {
                targetDataset = ds;
                break; // Found a valid dataset
            }
        }

        if (!targetDataset) return null;

        return this._findClosestPointInDataset(targetDataset, xValue);
    }

    /**
     * Helper: Find closest point in a specific dataset
     */
    _findClosestPointInDataset(dataset, xValue) {
        if (!dataset || !dataset.data || dataset.data.length === 0) return null;
        return dataset.data.reduce((prev, curr) => {
            return (Math.abs(curr.x - xValue) < Math.abs(prev.x - xValue) ? curr : prev);
        });
    }

    /**
     * Update existing markers with new simulation data
     */
    updateMarkersWithNewData() {
        if (!this.markerManager || !this.markerManager.markers.length || !this.chart) return;

        // Iterate through all markers
        this.markerManager.markers.forEach(marker => {
            // Only update Markers (tracking Frequency)
            if (marker.type === 'Marker' || (typeof marker.type === 'string' && marker.type.includes('X Marker'))) {
                const valX = marker.x; // Frequency

                // Always try to fetch complex data
                const complex = this.getComplexDataAtFrequency(valX);
                const updates = {};
                if (complex) {
                    updates.complexData = complex;
                }

                if (this.currentFormat === 'linRabsX') {
                    // Special handling for Lin R, |X|
                    // We need to find Y values for BOTH datasets
                    // Assume simulationData is array [datasetR, datasetX]
                    if (Array.isArray(this.simulationData) && this.simulationData.length === 2) {
                        const dsR = this.simulationData[0];
                        const dsX = this.simulationData[1];

                        const closestR = this._findClosestPointInDataset(dsR, valX);
                        const closestX = this._findClosestPointInDataset(dsX, valX);

                        if (closestR && closestX) {
                            updates.y = { r: closestR.y, x: closestX.y };
                        }
                    }
                } else {
                    // Standard case
                    const closest = this.getClosestDataPoint(valX);
                    if (closest) {
                        updates.y = closest.y;
                    }
                }

                this.markerManager.updateMarker(marker.id, updates);
            }

        });
    }

    /**
     * Helper: Get complex data (R, X) at a specific frequency from raw simulation results
     */
    getComplexDataAtFrequency(freq) {
        if (!this.simulationResults || !this.simulationResults.frequencies) return null;

        const freqs = this.simulationResults.frequencies;
        if (freqs.length === 0) return null;

        // Find closest index
        let closestIdx = -1;
        let minDiff = Infinity;

        for (let i = 0; i < freqs.length; i++) {
            const diff = Math.abs(freqs[i] - freq);
            if (diff < minDiff) {
                minDiff = diff;
                closestIdx = i;
            }
        }

        if (closestIdx === -1) return null;

        // Use Impedance data if mode is Impedance OR if it's S11 (Input Reflection)
        // This ensures markers on Smith Chart show Impedance (Ohm) instead of Gamma (Unitless)
        if (this.currentMeas === 'impedance' || this.currentMeas === 'S11') {
            if (this.simulationResults.zin && this.simulationResults.zin[closestIdx]) {
                const z = this.simulationResults.zin[closestIdx]; // {real, imag}
                return { r: z.real, x: z.imag };
            }
        }

        // Other S-Parameters or fallback
        if (this.currentMeas !== 'impedance' && this.currentMeas !== 'S11') {
            // S-Parameters (S11, S21, etc)
            const sMatrix = this.simulationResults.sMatrix;
            if (sMatrix) {
                // 1. Try Key Access (Standard)
                if (sMatrix[this.currentMeas]) {
                    // Check if it's the processed Map form with 'complex' array
                    if (sMatrix[this.currentMeas].complex && sMatrix[this.currentMeas].complex[closestIdx]) {
                        const c = sMatrix[this.currentMeas].complex[closestIdx];
                        return { r: c.real, x: c.imag };
                    }
                }

                // 2. Fallback: Array Access (Legacy support if data structure differs)
                // Try to find if currentMeas matches a port index pattern if needed, 
                // but usually updateSimulationDataForCurrentSettings relies on key access.
                // If specific key fails, checking [0][0] is risky as it implies S11 always.
                // We will stick to key access as primary.
            }
        }
        return null;
    }

    drawMarkers(chart) {
        if (!this.markerManager) return;
        const markers = this.markerManager.markers;
        if (markers.length === 0) return;

        const ctx = chart.ctx;
        const scales = chart.scales;
        const meta = {
            x: scales.x,
            y: scales.y
        };

        if (!meta.x || !meta.y) return;

        ctx.save();

        const isDragging = !!this.draggingMarker;

        markers.forEach(marker => {
            const markerColor = marker.color || '#ffcc00';
            ctx.strokeStyle = markerColor;
            ctx.fillStyle = markerColor; // For text
            ctx.lineWidth = 2; // Thicker for visibility

            // Highlight Logic
            const isHighlighted = (marker.id === this.highlightedMarkerId);

            // If dragging this specific marker, highlight it
            if (this.draggingMarker === marker || isHighlighted) {
                ctx.lineWidth = 3;
                ctx.shadowColor = markerColor; // Use marker color for glow
                ctx.shadowBlur = 10;
            } else {
                ctx.lineWidth = 2;
                ctx.shadowBlur = 0;
            }

            if (marker.type === 'Marker' || marker.type.includes('Marker') || marker.type === 'Point') {
                const xPixel = meta.x.getPixelForValue(marker.x);
                let yVal = marker.y;
                if (typeof marker.y === 'object' && marker.y.r !== undefined) {
                    // If complex, use magnitude or real part depending on mode? 
                    // Usually chart Y-axis expects a number.
                    // SParameterGraph converts data before plotting, so marker.y should ideally be numeric for the graph scale.
                    // However, marker.y might be updated as complex object. 
                    // If so, we need to map it back to what's plotted (e.g. dB or Mag).
                    // But for drawing on existing scale, we assume marker.y matches scale type or we use the data point.
                    // Simplified: Just trust graph's value matching or use stored numeric if available.
                    // As per previous logic 'typeof marker.y === object' check suggested it might be complex.
                    yVal = marker.y.r; // Default fallback
                }
                const yPixel = meta.y.getPixelForValue(yVal);

                // Visual Offset
                const offset = 12;
                const markerY = yPixel - offset;

                // 2. Draw Marker Symbol (Offset)
                // Use dynamic marker size
                const size = this.markerManager.markerSize || 6;

                ctx.beginPath();
                // Draw Triangle for X/Y Markers
                // Tip at bottom (xPixel, markerY + size)
                // Or standard shape centered at markerY? 
                // Let's draw centered at markerY.

                ctx.moveTo(xPixel, markerY + size);
                ctx.lineTo(xPixel - size, markerY - size);
                ctx.lineTo(xPixel + size, markerY - size);
                ctx.closePath();

                ctx.fill();
                ctx.stroke();

                // Calculate Dynamic Font Sizes based on Marker Size
                // Base: ID=12px, Value=10px for Size=6
                const scaleDelta = Math.max(0, size - 6);
                const idFontSize = 12 + scaleDelta;
                const valFontSize = 12 + scaleDelta;

                // Label (ID) - Below Marker
                ctx.font = `bold ${idFontSize}px sans-serif`;
                ctx.fillStyle = this.colors.text || '#a0a0a0';

                // Position ID below the marker
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top'; // Easier positioning
                ctx.fillText(marker.id, xPixel, markerY + size + 7);

                // Show Value on Marker (if enabled) - Above Marker
                if (this.markerManager.showValueOnMarker) {
                    ctx.save();
                    ctx.font = `${valFontSize}px sans-serif`;
                    ctx.fillStyle = markerColor; // Use marker color for value
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'bottom'; // Draw above

                    // Unified Formatting: Use MarkerManager's logic (same as table)
                    let displayVal = this.markerManager.getMarkerValueString(marker);

                    // Position just above the triangle
                    ctx.fillText(displayVal, xPixel, markerY - size - 4);
                    ctx.restore();
                }
            }
        });

        ctx.restore();
    }

    /**
     * Update Marker Table Headers based on current mode
     */
    updateMarkerTableHeaders() {
        if (!this.markerManager) return;

        let xLabel = 'Frequency';
        let yLabel = 'Value';

        if (this.currentMeas === 'matchingRange' || this.isSmithChartMode) {
            xLabel = 'Resistance';
            if (this.currentMeas === 'matchingRange') {
                yLabel = 'Reactance';
            } else {
                yLabel = 'Value';
            }
        } else {
            // Cartesian / Standard
            xLabel = 'Frequency';

            // Get Y Label from config
            if (this.currentMeas === 'impedance') {
                yLabel = this.impedanceFormatConfig[this.currentFormat]?.label || 'Value';
            } else {
                yLabel = this.formatConfig[this.currentFormat]?.label || 'Value';
            }
        }

        this.markerManager.updateHeaders(xLabel, yLabel);
    }

    /**
     * Handle Marker Edit Request
     * @param {string} id 
     * @param {string} field 'x' or 'y'
     * @param {number} value 
     */
    handleMarkerEditRequest(id, field, value) {
        if (this.isSmithChartMode && this.smithChartRenderer) {
            this.smithChartRenderer.updateMarkerFromValue(id, field, value);
            return;
        }

        // Cartesian Logic
        const marker = this.markerManager.markers.find(m => m.id === id);
        if (!marker) return;

        if (field === 'x') {
            // Updated Frequency/X-Axis
            let newValY = marker.y;

            // Use helper to find closest point
            const closest = this.getClosestDataPoint(value);

            if (closest) {
                // Snap X to closest available frequency to ensure accuracy
                value = closest.x;
                newValY = closest.y;
            }

            // Update Marker
            this.markerManager.updateMarker(id, { x: value, y: newValY });
        } else if (field === 'y') {
            // Just update Y value (move vertically)
            this.markerManager.updateMarker(id, { y: value });
        }

        // Redraw
        if (this.chart) this.chart.update();
    }

    // ============ Drag Logic ============

    isOverMarker(e) {
        if (!this.markerManager || this.markerManager.markers.length === 0 || !this.chart) return null;

        const scales = this.chart.scales;
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const threshold = 10; // px tolerance

        for (const marker of this.markerManager.markers) {
            let dist = Infinity;

            if (marker.type === 'Marker') {
                const xPx = scales.x.getPixelForValue(marker.x);
                // Allow some tolerance on Y as well for better UX, but primary selection is X
                // But user wants to drag the triangle which is at specific Y.
                // Let's check proximity to the triangle point.

                let valY = typeof marker.y === 'object' ? marker.y.r : marker.y;
                // Apply 10px offset to hit test to match visual
                const yPx = scales.y.getPixelForValue(valY) - 10;

                const dist = Math.sqrt(Math.pow(xPx - mouseX, 2) + Math.pow(yPx - mouseY, 2));
                if (dist < 15) { // 15px radius for triangle
                    return marker;
                }

                // Also support grabbing the vertical line for convenience? 
                // User said "Triangle move only for simulation graph", but maybe they just mean visual constraint.
                // Let's stick to the triangle for strict compliance with "this inverted triangle marker can only move..."
            }

            if (dist < threshold) {
                return marker;
            }
        }
        return null;
    }

    handleMouseDown(e) {
        // Check if over marker
        const hoveredMarker = this.isOverMarker(e);
        if (hoveredMarker) {
            this.draggingMarker = hoveredMarker;

            // Disable Pan
            if (this.chart.options.plugins.zoom.pan.enabled) {
                this.chart.options.plugins.zoom.pan.enabled = false;
                this.wasPanEnabled = true;
            }

            // Cursor
            this.canvas.style.cursor = 'grabbing';
            e.preventDefault();
        }
    }

    /**
     * Calculate global min/max for X and Y from all datasets (Sim + CSV)
     */
    calculateGlobalDataRange() {
        let xMin = Infinity, xMax = -Infinity;
        let yMin = Infinity, yMax = -Infinity;
        let hasData = false;

        // 1. Simulation Data
        if (this.simulationData && this.simulationData.data && this.simulationData.data.length > 0) {
            this.simulationData.data.forEach(p => {
                if (typeof p.x === 'number' && !isNaN(p.x)) {
                    if (p.x < xMin) xMin = p.x;
                    if (p.x > xMax) xMax = p.x;
                }
                if (typeof p.y === 'number' && !isNaN(p.y)) {
                    if (p.y < yMin) yMin = p.y;
                    if (p.y > yMax) yMax = p.y;
                }
            });
            hasData = true;
        }

        // 2. CSV Data
        if (this.chart && this.chart.data && this.chart.data.datasets) {
            this.chart.data.datasets.forEach(ds => {
                // If it looks like a valid dataset (has data array)
                if (ds.data && ds !== this.simulationData && ds.data.length > 0) {
                    ds.data.forEach(p => {
                        if (typeof p.x === 'number' && !isNaN(p.x)) {
                            if (p.x < xMin) xMin = p.x;
                            if (p.x > xMax) xMax = p.x;
                        }
                        if (typeof p.y === 'number' && !isNaN(p.y)) {
                            if (p.y < yMin) yMin = p.y;
                            if (p.y > yMax) yMax = p.y;
                        }
                    });
                    hasData = true;
                }
            });
        }

        if (!hasData || xMin === Infinity || yMin === Infinity) {
            // Default to axis limits if no data found
            const scales = this.chart ? this.chart.scales : null;
            if (scales && scales.x && scales.y) {
                return {
                    xMin: scales.x.min, xMax: scales.x.max,
                    yMin: scales.y.min, yMax: scales.y.max
                };
            }
            return { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
        }

        // Add a tiny margin if min == max (single point) to allow slight movement or just clamp
        if (xMin === xMax) { xMin -= 1e-9; xMax += 1e-9; }
        if (yMin === yMax) { yMin -= 1e-9; yMax += 1e-9; }

        return { xMin, xMax, yMin, yMax };
    }

    handleMouseMove(e) {
        if (!this.draggingMarker) {
            // Hover logic when not dragging
            if (!this.chart) return;
            const hovered = this.isOverMarker(e);
            if (hovered && typeof hovered.type === 'string') {
                this.canvas.style.cursor = 'pointer';
            } else {
                // Check for zoom/pan cursor updates if implemented, or default
                // this.canvas.style.cursor = 'default'; 
            }
            return;
        }

        // Dragging Logic
        const rect = this.canvas.getBoundingClientRect();

        let val;
        const range = this.calculateGlobalDataRange();

        if (this.draggingMarker.type === 'Marker') {
            // Convert pixel to value
            val = this.chart.scales.x.getValueForPixel(e.clientX - rect.left);

            // Clamp to DATA limits (Union of Sim and CSV)
            val = Math.max(range.xMin, Math.min(range.xMax, val));

            // Sync Y Value
            const closest = this.getClosestDataPoint(val);
            let update = { x: val };
            let targetFreq = val;

            if (closest) {
                update.x = closest.x; // Snap exact X
                update.y = closest.y;
                targetFreq = closest.x;
            }

            // Fetch complex data (R, X) during drag for dynamic table updates
            const complex = this.getComplexDataAtFrequency(targetFreq);
            if (complex) {
                update.complexData = complex;
            }

            // Update Marker
            this.markerManager.updateMarker(this.draggingMarker.id, update);
        }

        this.chart.update('none'); // Re-draw markers cheaply
    }

    handleMouseUp(e) {
        if (this.draggingMarker) {
            this.draggingMarker = null;
            if (this.wasPanEnabled) {
                this.chart.options.plugins.zoom.pan.enabled = true;
                this.wasPanEnabled = false;
            }
            this.canvas.style.cursor = 'default';
        }
    }

    /**
     * 리사이즈 핸들러
     */
    resize() {
        if (this.chart) {
            this.chart.resize();
        }
    }

    /**
     * 소멸자
     */
    destroy() {
        if (this.chart) {
            this.chart.destroy();
            this.chart = null;
        }
    }
}

// CSVParser was extracted to js/ui/CSVParser.js

// 전역 노출
window.SParameterGraph = SParameterGraph;

// 하위 호환성을 위한 별칭
window.S11Graph = SParameterGraph;

