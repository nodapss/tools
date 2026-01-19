/**
 * Graph Controller
 * Manages Graph Settings, Data Loading, and Graph Title
 */
class GraphController {
    constructor(sParamGraph, circuit, simulationController) {
        this.sParamGraph = sParamGraph;
        this.circuit = circuit;
        this.simulationController = simulationController;

        this.settings = {
            format: 'logMag',
            meas: 'S11', // Default to S11 instead of impedance
            xAxisScale: 'linear',
            xAxis: {
                autoScale: true,
                min: 1000000,
                max: 100000000
            },
            animation: false,
            // Matching Range specific settings
            matchingRange: {
                invertReactance: false,
                selectedComponents: [], // Array of component IDs
                frequency: 50e6, // Default 50 MHz
                frequency: 50e6, // Default 50 MHz
                pointsPerEdge: 20 // Points per edge for smoothness
            },
            absoluteImag: true, // Default to true
            highlightNegative: false, // Default to false (Red Highlight for negative imag)
            highlightNegative: false, // Default to false (Red Highlight for negative imag)
            showMarkerValue: false, // Default to false (Hidden)
            showInputImpedance: false, // Default to false (Hidden for Smith Chart)
            yAxis: {
                autoScale: true,
                min: -100,
                max: 0
            }
        };

        // Initialize DOM events
        this.initDOMEvents();

        // Initialize Draggable Modal
        this.initDraggableModal();
    }

    initDOMEvents() {
        // Bind load graph data button
        const btnLoadGraphData = document.getElementById('btnLoadGraphData');
        if (btnLoadGraphData) {
            btnLoadGraphData.addEventListener('click', () => this.loadGraphData());
        }

        // Bind save graph data button
        const btnSaveGraphData = document.getElementById('btnSaveGraphData');
        if (btnSaveGraphData) {
            btnSaveGraphData.addEventListener('click', () => {
                if (this.settings.meas === 'matchingRange') {
                    this.exportMatchingRangeToCSV();
                } else {
                    if (this.sParamGraph) this.sParamGraph.saveDataAsCSV();
                }
            });
        }

        // Bind Clear Graph
        const btnClearGraph = document.getElementById('btnClearGraph');
        if (btnClearGraph) {
            btnClearGraph.addEventListener('click', () => this.handleClearGraph());
        }

        // Bind graph settings button
        const btnGraphSettings = document.getElementById('btnGraphSettings');
        console.log('GraphController: Binding btnGraphSettings:', !!btnGraphSettings);
        if (btnGraphSettings) {
            btnGraphSettings.addEventListener('click', (e) => {
                console.log('GraphController: Settings button clicked');
                this.openSettingsModal();
            });
        }

        // Bind float graph button
        const btnFloatGraph = document.getElementById('btnFloatGraph');
        if (btnFloatGraph) {
            this.updateFloatButtonState(false); // Init state
            btnFloatGraph.addEventListener('click', () => this.toggleGraphWindow());
        }

        // Setup modal events
        this.setupModalEvents();

        // Listen for messages from popup
        window.addEventListener('message', (event) => {
            if (event.data.type === 'GRAPH_WINDOW_CLOSED') {
                this.handleExternalWindowClosure();
            } else if (event.data.type === 'DOCK_WINDOW') {
                if (this.externalWindow) this.externalWindow.close();
                this.handleExternalWindowClosure();
            } else if (event.data.type === 'DOCK_WITH_STATE') {
                if (this.externalWindow) this.externalWindow.close();
                this.handleExternalWindowClosure(event.data.state);
            } else if (event.data.type === 'GRAPH_WINDOW_OPENED') {
                // Send current settings immediately
                this.broadcastSettings();

                // Send current simulation data AND View State if available
                if (this.simulationController && this.simulationController.sParamGraph) {
                    // Since SimulationController manages data, we should trigger it.
                    // But for now, we rely on SimulationController's last result if accessible or 
                    // we can make SimulationController broadcast it.
                    // IMPORTANT: Since we just opened the window, we might want to send the *current* state 
                    // to make it seamless. 
                    if (this.currentSimulationData) {
                        const viewState = this.sParamGraph.getViewState();
                        this.broadcastSimulationData(this.currentSimulationData, false, viewState);
                    }
                }

                // Send Meas Options
                this.broadcastMeasOptions();

                // Send Tunable Components for Matching Range
                this.broadcastTunableComponents();

                // Send CSV Data
                this.broadcastCSVData();

                // Send Markers
                this.broadcastMarkers();

                // Send Matching Range Data if available
                if (this.settings.meas === 'matchingRange') {
                    this.calculateAndPlotMatchingRange(); // Re-calculate to safely get latest data
                    this.broadcastLoadedMatchingRangeData(); // Broadcast loaded data
                }
            } else if (event.data.type === 'SYNC_SETTINGS') {
                this.setSettings(event.data.settings);
            }
        });

        // Bind Axis Double Click Event from SParameterGraph
        if (this.sParamGraph && this.sParamGraph.canvas) {
            this.sParamGraph.canvas.addEventListener('axis-dblclick', (e) => {
                this.handleAxisDoubleClick(e.detail.axis);
            });
        }

        // Listen for component range changes to update Matching Range UI
        window.addEventListener('component-range-changed', () => {
            const modal = document.getElementById('graphSettingsModal');
            const isActive = modal && modal.classList.contains('active');
            const isMatchingRange = this.settings.meas === 'matchingRange';

            console.log('[GraphController] Received component-range-changed', {
                modalExists: !!modal,
                isActive,
                meas: this.settings.meas,
                shouldUpdate: isActive && isMatchingRange
            });

            if (isActive && isMatchingRange) {
                console.log('[GraphController] Refreshing Matching Range UI');
                this.populateComponentCheckboxes();
            }
        });
    }

    /**
     * Handle Axis Double Click
     * Opens Settings Modal, switches to Display tab, disables Auto Scale, and focuses Min input
     * @param {string} axis 'x' or 'y'
     */
    handleAxisDoubleClick(axis) {
        // 1. Open Settings Modal
        this.openSettingsModal();

        // 2. Switch to Display Tab
        const modal = document.getElementById('graphSettingsModal');
        if (!modal) return;

        // Display Tab Button
        const displayTabBtn = modal.querySelector('.settings-tab[data-tab="display"]');
        if (displayTabBtn) {
            displayTabBtn.click();
        }

        // 3. Handle Specific Axis Logic
        if (axis === 'y') {
            // Y-Axis Logic
            const yAxisAutoScale = document.getElementById('yAxisAutoScale');
            const yAxisMin = document.getElementById('yAxisMin');

            if (yAxisAutoScale && yAxisAutoScale.checked) {
                yAxisAutoScale.click(); // Uncheck and trigger change handler
            }

            // Focus and Select Min Input
            if (yAxisMin) {
                setTimeout(() => {
                    yAxisMin.focus();
                    yAxisMin.select();
                }, 100); // Slight delay for modal interaction
            }

        } else if (axis === 'x') {
            // X-Axis Logic
            const xAxisAutoScale = document.getElementById('xAxisAutoScale');
            const xAxisMin = document.getElementById('xAxisMin');

            if (xAxisAutoScale && xAxisAutoScale.checked) {
                xAxisAutoScale.click(); // Uncheck and trigger change handler
            }

            if (xAxisMin) {
                setTimeout(() => {
                    xAxisMin.focus();
                    xAxisMin.select();
                }, 100);
            }
        }
    }

    /**
     * Initialize draggable modal
     */
    initDraggableModal() {
        const modal = document.getElementById('graphSettingsModal');
        if (!modal) return;

        const header = modal.querySelector('.modal-header');
        if (!header) return;

        header.style.cursor = 'move';

        let isDragging = false;
        let startX, startY, initialLeft, initialTop;

        header.addEventListener('mousedown', (e) => {
            if (e.target.closest('.close-btn')) return; // Don't drag if closing

            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;

            const rect = modal.getBoundingClientRect();

            // Set initial positions based on current visual position
            initialLeft = rect.left;
            initialTop = rect.top;

            // Remove transform centering effectively by setting explicit pixel positions
            // This prevents the modal from jumping when we start setting left/top
            modal.style.transform = 'none';
            modal.style.left = `${initialLeft}px`;
            modal.style.top = `${initialTop}px`;
            modal.style.margin = '0'; // Clear any margin centering
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            e.preventDefault(); // Prevent text selection

            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            modal.style.left = `${initialLeft + dx}px`;
            modal.style.top = `${initialTop + dy}px`;
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
        });
    }

    /**
     * Toggle between local and external graph window
     */
    toggleGraphWindow() {
        if (this.externalWindow && !this.externalWindow.closed) {
            // New window -> Dock
            this.externalWindow.close();
            this.handleExternalWindowClosure();
        } else {
            // Open new window
            this.openExternalWindow();
        }
    }

    openExternalWindow() {
        const sidebar = document.getElementById('graphSidebar');
        let width = 800;
        let height = 600;

        // Capture current size
        if (sidebar) {
            const rect = sidebar.getBoundingClientRect();
            width = Math.max(300, rect.width);
            height = Math.max(300, rect.height);
        }

        // Center on screen
        const left = (window.screen.width - width) / 2;
        const top = (window.screen.height - height) / 2;

        // Capture Sim Data for initial sync
        // We need the data to send it to the new window. 
        // We'll access it via SParameterGraph or SimulationController.
        // Ideally SParameterGraph has the latest 'simulationResults'.
        if (this.sParamGraph) {
            this.currentSimulationData = this.sParamGraph.simulationResults;
        }

        this.externalWindow = window.open(
            'graph.html',
            'RFGraphWindow',
            `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
        );

        if (this.externalWindow) {
            this.updateFloatButtonState(true);

            // Hide local sidebar
            if (sidebar) sidebar.classList.add('hidden');
            const mainContent = document.querySelector('.main-content');
            if (mainContent) mainContent.classList.add('graph-hidden');

        } else {
            if (window.notificationManager) {
                window.notificationManager.show('Cannot open graph window. Please allow pop-ups.', 'error');
            }
        }
    }

    resetGraphZoom() {
        if (this.externalWindow && !this.externalWindow.closed) {
            // Reset external first
            // Actually external has its own button.
        }
        if (this.sParamGraph) {
            this.sParamGraph.resetZoom();
        }
    }

    /**
     * Handle external window closure (docking)
     * @param {Object} syncedState - State returned from floating window (optional)
     */
    handleExternalWindowClosure(syncedState = null) {
        this.externalWindow = null;
        this.updateFloatButtonState(false);

        // Show local sidebar
        const sidebar = document.getElementById('graphSidebar');
        if (sidebar) sidebar.classList.remove('hidden');

        const mainContent = document.querySelector('.main-content');
        if (mainContent) mainContent.classList.remove('graph-hidden');

        // Restore State
        if (syncedState && this.sParamGraph) {
            // Restore Markers & Table
            if (syncedState.markers) {
                this.sParamGraph.markerManager.markers = syncedState.markers;
                this.sParamGraph.markerManager.updateTable(); // Ensure local table updates

                // Explicitly update table visibility
                const container = document.getElementById('markerTableContainer');
                if (container) {
                    container.style.display = syncedState.markers.length > 0 ? 'block' : 'none';
                }
            }
            // Restore View (Zoom/Pan)
            if (syncedState.viewState) {
                this.sParamGraph.setViewState(syncedState.viewState);
            }
            // Restore CSV Data
            if (syncedState.csvDatasets && syncedState.csvDatasets.length > 0) {
                this.sParamGraph.clearCsvData();
                syncedState.csvDatasets.forEach(ds => {
                    this.sParamGraph.addCsvData(ds.rawData, {
                        fileName: ds.fileName,
                        ...ds.metadata
                    });
                });
            }

            // Restore Loaded Matching Range Data
            if (syncedState.loadedMatchingRangeData) {
                this.sParamGraph.setLoadedMatchingRangeData(syncedState.loadedMatchingRangeData);
            }
        }

        // Force graph resize
        if (this.sParamGraph && this.sParamGraph.chart) {
            this.sParamGraph.chart.resize();
            this.sParamGraph.chart.update();
        }
        if (this.sParamGraph && this.sParamGraph.smithChartRenderer) {
            this.sParamGraph.smithChartRenderer.resize();
        }
    }

    updateFloatButtonState(isExternal) {
        const btn = document.getElementById('btnFloatGraph');
        if (!btn) return;

        const icon = btn.querySelector('.icon');
        if (isExternal) {
            icon.textContent = '⚓'; // Anchor icon for docking
            btn.title = 'Dock Window';
        } else {
            icon.textContent = '❐'; // Pop-out icon
            btn.title = 'Pop-out Graph';
        }
    }

    /**
     * Broadcast simulation results to external window
     */
    broadcastSimulationData(results, fitView, viewState = null) {
        if (this.externalWindow && !this.externalWindow.closed) {
            this.externalWindow.postMessage({
                type: 'SIMULATION_DATA',
                data: results, // JSON serializable properties only (Complex objects need reconstruction on receiver)
                fitView: fitView,
                viewState: viewState
            }, '*');
        }
    }

    /**
     * Broadcast settings
     */
    broadcastSettings() {
        if (this.externalWindow && !this.externalWindow.closed) {
            this.externalWindow.postMessage({
                type: 'GRAPH_SETTINGS',
                settings: this.settings
            }, '*');
        }
    }

    broadcastMeasOptions() {
        if (this.externalWindow && !this.externalWindow.closed) {
            const stats = this.circuit.getStats();
            const portCount = Math.max(1, Math.min(4, stats.ports));
            const sParams = [];
            for (let i = 1; i <= portCount; i++) {
                for (let j = 1; j <= portCount; j++) {
                    sParams.push(`S${i}${j}`);
                }
            }

            const options = [...sParams]; // Removed 'impedance'

            this.externalWindow.postMessage({
                type: 'INIT_MEAS_OPTIONS',
                options: options
            }, '*');
        }
    }


    /**
     * Broadcast Matching Range Data
     */
    broadcastMatchingRangeData(data, invertReactance) {
        if (this.externalWindow && !this.externalWindow.closed) {
            this.externalWindow.postMessage({
                type: 'MATCHING_RANGE_DATA',
                data: data,
                invertReactance: invertReactance
            }, '*');
        }
    }

    /**
     * Broadcast Loaded Matching Range Data
     */
    broadcastLoadedMatchingRangeData() {
        if (this.externalWindow && !this.externalWindow.closed && this.sParamGraph && this.sParamGraph.loadedMatchingRangeData) {
            this.externalWindow.postMessage({
                type: 'LOADED_MATCHING_RANGE_DATA',
                data: this.sParamGraph.loadedMatchingRangeData
            }, '*');
        }
    }

    broadcastMarkers() {
        if (this.externalWindow && !this.externalWindow.closed && this.sParamGraph && this.sParamGraph.markerManager) {
            this.externalWindow.postMessage({
                type: 'MARKERS_DATA',
                markers: this.sParamGraph.markerManager.markers
            }, '*');
        }
    }

    /**
     * Broadcast CSV Data
     */
    broadcastCSVData() {
        if (this.externalWindow && !this.externalWindow.closed && this.sParamGraph && this.sParamGraph.csvDatasets) {
            // Map datasets to serializable format (rawData + metadata)
            const serializableData = this.sParamGraph.csvDatasets.map(ds => ({
                rawData: ds.rawData,
                metadata: ds.metadata,
                fileName: ds.fileName
            }));

            this.externalWindow.postMessage({
                type: 'CSV_DATA',
                datasets: serializableData
            }, '*');
        }
    }

    /**
     * Broadcast Tunable Components
     */
    broadcastTunableComponents() {
        if (this.externalWindow && !this.externalWindow.closed) {
            const tunableComponents = this.getTunableComponents();
            this.externalWindow.postMessage({
                type: 'TUNABLE_COMPONENTS',
                components: tunableComponents
            }, '*');
        }
    }

    setupModalEvents() {
        const modal = document.getElementById('graphSettingsModal');
        if (!modal) return;

        const closeBtn = document.getElementById('btnCloseModal');
        if (closeBtn) closeBtn.addEventListener('click', () => this.closeSettingsModal());

        const cancelBtn = document.getElementById('btnCancelSettings');
        if (cancelBtn) cancelBtn.addEventListener('click', () => this.closeSettingsModal());

        const applyBtn = document.getElementById('btnApplySettings');
        if (applyBtn) applyBtn.addEventListener('click', () => this.applySettings());

        const overlay = modal.querySelector('.modal-overlay');
        if (overlay) overlay.addEventListener('click', () => this.closeSettingsModal());

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.classList.contains('active')) {
                this.closeSettingsModal();
            }
        });

        // Tab Switching Logic
        const tabs = modal.querySelectorAll('.settings-tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                // Remove active class from all tabs
                tabs.forEach(t => t.classList.remove('active'));
                // Add active class to clicked tab
                tab.classList.add('active');

                // Hide all tab contents
                const contents = modal.querySelectorAll('.settings-tab-content');
                contents.forEach(content => content.classList.remove('active'));

                // Show target tab content
                const targetId = tab.getAttribute('data-tab');
                const targetContent = modal.querySelector(`#tab${targetId.charAt(0).toUpperCase() + targetId.slice(1)}`);
                if (targetContent) {
                    targetContent.classList.add('active');
                }
            });
        });
    }

    /**
     * Update Meas select options based on circuit port count
     */
    updateMeasOptions() {
        const measSelect = document.getElementById('measSelect');
        if (!measSelect) return;

        const stats = this.circuit.getStats();
        const portCount = Math.max(1, Math.min(4, stats.ports));

        const sParams = [];
        for (let i = 1; i <= portCount; i++) {
            for (let j = 1; j <= portCount; j++) {
                sParams.push(`S${i}${j}`);
            }
        }

        measSelect.innerHTML = '';
        sParams.forEach(param => {
            const option = document.createElement('option');
            option.value = param;
            option.textContent = param;
            if (param === this.settings.meas) {
                option.selected = true;
            }
            measSelect.appendChild(option);
        });

        // Add Matching Range option
        const matchingRangeOption = document.createElement('option');
        matchingRangeOption.value = 'matchingRange';
        matchingRangeOption.textContent = 'Matching Range';
        if (this.settings.meas === 'matchingRange') {
            matchingRangeOption.selected = true;
        }
        measSelect.appendChild(matchingRangeOption);

        const availableValues = [...sParams, 'matchingRange'];
        if (!availableValues.includes(this.settings.meas)) {
            // Default to S11 if current invalid (e.g. was impedance)
            this.settings.meas = 'S11';
            measSelect.value = 'S11';
        }
    }

    /**
     * Get tunable components from circuit (R, L, C with sliderRange)
     */
    getTunableComponents() {
        const components = this.circuit.components || [];
        const tunable = [];

        components.forEach(comp => {
            if (['R', 'L', 'C'].includes(comp.type)) {
                const paramName = this.getComponentParamName(comp.type);
                const range = comp.sliderRange?.[paramName];

                tunable.push({
                    id: comp.id,
                    type: comp.type,
                    paramName: paramName,
                    currentValue: comp.params[paramName],
                    min: range ? range.min * (this.getUnitMultiplier(range.minUnit) || 1) : comp.params[paramName] * 0.5,
                    max: range ? range.max * (this.getUnitMultiplier(range.maxUnit) || 1) : comp.params[paramName] * 1.5,
                    minDisplay: range ? `${range.min}${range.minUnit}` : this.formatValue(comp.params[paramName] * 0.5, comp.type),
                    maxDisplay: range ? `${range.max}${range.maxUnit}` : this.formatValue(comp.params[paramName] * 1.5, comp.type)
                });
            }
        });

        return tunable;
    }

    getComponentParamName(type) {
        const paramMap = {
            'R': 'resistance',
            'L': 'inductance',
            'C': 'capacitance'
        };
        return paramMap[type];
    }

    getUnitMultiplier(unit) {
        const multipliers = {
            'mΩ': 1e-3, 'Ω': 1, 'kΩ': 1e3, 'MΩ': 1e6,
            'pH': 1e-12, 'nH': 1e-9, 'μH': 1e-6, 'mH': 1e-3, 'H': 1,
            'fF': 1e-15, 'pF': 1e-12, 'nF': 1e-9, 'μF': 1e-6, 'mF': 1e-3, 'F': 1
        };
        return multipliers[unit] || 1;
    }

    formatValue(value, type) {
        const units = {
            'R': [{ suffix: 'kΩ', mult: 1e3 }, { suffix: 'Ω', mult: 1 }, { suffix: 'mΩ', mult: 1e-3 }],
            'L': [{ suffix: 'mH', mult: 1e-3 }, { suffix: 'μH', mult: 1e-6 }, { suffix: 'nH', mult: 1e-9 }, { suffix: 'pH', mult: 1e-12 }],
            'C': [{ suffix: 'μF', mult: 1e-6 }, { suffix: 'nF', mult: 1e-9 }, { suffix: 'pF', mult: 1e-12 }, { suffix: 'fF', mult: 1e-15 }]
        };

        const typeUnits = units[type] || [];
        for (const u of typeUnits) {
            const displayVal = value / u.mult;
            if (displayVal >= 1 && displayVal < 1000) {
                return `${displayVal.toFixed(2)}${u.suffix}`;
            }
        }
        return value.toExponential(2);
    }

    /**
     * Populate component checkboxes for Matching Range
     */
    populateComponentCheckboxes() {
        const container = document.getElementById('componentCheckboxes');
        if (!container) return;

        const tunableComponents = this.getTunableComponents();

        if (tunableComponents.length === 0) {
            container.innerHTML = '<p style="color: var(--text-muted); font-size: 12px;">No tunable components found. Add R, L, or C components with slider ranges.</p>';
            return;
        }

        container.innerHTML = tunableComponents.map(comp => `
            <div class="component-checkbox-item">
                <input type="checkbox" 
                       id="compCheck_${comp.id}" 
                       value="${comp.id}"
                       ${this.settings.matchingRange.selectedComponents.includes(comp.id) ? 'checked' : ''}>
                <label for="compCheck_${comp.id}">${comp.id}</label>
                <span class="range-info">${comp.minDisplay} - ${comp.maxDisplay}</span>
            </div>
        `).join('');

        // Bind checkbox change events for real-time highlighting
        const checkboxes = container.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(cb => {
            cb.addEventListener('change', (e) => {
                const compId = e.target.value;
                const isChecked = e.target.checked;
                const comp = this.circuit.getComponent(compId);
                if (comp) {
                    comp.setMatchingHighlight(isChecked);
                }
            });
        });

        // Apply initial highlights based on checked state
        if (this.settings.meas === 'matchingRange') {
            tunableComponents.forEach(comp => {
                const cb = document.getElementById(`compCheck_${comp.id}`);
                const isChecked = cb ? cb.checked : false;
                const component = this.circuit.getComponent(comp.id);
                if (component) {
                    component.setMatchingHighlight(isChecked);
                }
            });
        }
    }

    /**
     * Handle Meas selection change - show/hide Matching Range options
     */
    handleMeasChange() {
        const measSelect = document.getElementById('measSelect');
        const matchingRangeOptions = document.getElementById('matchingRangeOptions');
        const formatSelect = document.getElementById('formatSelect');
        const xAxisSelect = document.getElementById('xAxisSelect');
        const linRXOptions = document.getElementById('linRXOptions'); // New Option Section

        if (!measSelect || !matchingRangeOptions) return;

        const isMatchingRange = measSelect.value === 'matchingRange';

        // Show/hide Matching Range options
        matchingRangeOptions.style.display = isMatchingRange ? 'block' : 'none';

        // Restrict Format to Smith only when Matching Range is selected
        if (formatSelect) {
            const options = formatSelect.options;
            for (let i = 0; i < options.length; i++) {
                if (isMatchingRange) {
                    options[i].disabled = options[i].value !== 'smith';
                } else {
                    options[i].disabled = false;
                }
            }

            if (isMatchingRange) {
                formatSelect.value = 'smith';
            }
        }

        // Disable X-Axis Scale when Matching Range is selected
        if (xAxisSelect) {
            xAxisSelect.disabled = isMatchingRange;
        }

        // Handle Lin R, X Options Visibility
        if (linRXOptions && formatSelect) {
            linRXOptions.style.display = (formatSelect.value === 'linRabsX') ? 'block' : 'none';
        }

        // Populate component checkboxes
        if (isMatchingRange) {
            this.populateComponentCheckboxes();
        } else {
            // Clear all highlights if not Matching Range
            if (this.circuit) {
                const components = this.circuit.getAllComponents();
                components.forEach(comp => comp.setMatchingHighlight(false));
            }
        }

        // Handle Smith Chart Options Visibility
        const smithChartOptions = document.getElementById('smithChartOptions');
        if (smithChartOptions && formatSelect) {
            // Show if (Meas is SParam or Impedance OR MatchingRange) AND (Format is Smith)
            // matchingRange force sets format to smith, so checking format is usually sufficient if we trust sync.
            // But let's be explicit.
            const isSmithFormat = formatSelect.value === 'smith';
            // Allow for S-Param/Impedance modes as well as Matching Range
            // Actually user requested: "Meas가 Sparameter/Impedance 일 때... Format이 Smith Chart"
            // For matchingRange, we might want it too, but let's prioritize the request.
            // Matching range usually ALWAYS shows input impedance (Yellow Triangle) effectively as start point? 
            // Or maybe user wants to toggle it there too. 
            // For now, enable for any Smith Chart format.
            if (isSmithFormat) {
                smithChartOptions.style.display = 'block';
            } else {
                smithChartOptions.style.display = 'none';
            }
        }
    }

    openSettingsModal() {
        const modal = document.getElementById('graphSettingsModal');
        if (modal) {
            this.updateMeasOptions();
            modal.classList.add('active');

            const formatSelect = document.getElementById('formatSelect');
            const measSelect = document.getElementById('measSelect');
            const xAxisSelect = document.getElementById('xAxisSelect');
            const animationToggle = document.getElementById('animationToggle');
            const invertReactance = document.getElementById('invertReactance');
            const matchingRangeFreq = document.getElementById('matchingRangeFreq');
            const matchingRangeFreqUnit = document.getElementById('matchingRangeFreqUnit');
            const linRXAbsolute = document.getElementById('linRXAbsolute');
            const linRXHighlightNegative = document.getElementById('linRXHighlightNegative');
            const showMarkerValue = document.getElementById('showMarkerValueGlobal');
            const smithInputImpedance = document.getElementById('smithInputImpedance');
            const smithChartFreq = document.getElementById('smithChartFreq');
            const smithChartFreqUnit = document.getElementById('smithChartFreqUnit');

            if (measSelect) measSelect.value = this.settings.meas;

            // Sync UI state (enable/disable options based on meas)
            console.log('DEBUG_UI: Calling handleMeasChange...');
            try {
                this.handleMeasChange();
                console.log('DEBUG_UI: handleMeasChange success');
            } catch (e) {
                console.error('DEBUG_UI: handleMeasChange failed', e);
            }

            // DEBUG LOG Start
            console.log('DEBUG_UI:', {
                settingFormat: this.settings.format,
                selectValueBefore: formatSelect ? formatSelect.value : 'N/A',
                impedanceOptionDisabled: formatSelect ? formatSelect.querySelector('option[value="impedance"]')?.disabled : 'N/A'
            });
            // DEBUG LOG End

            if (formatSelect) {
                formatSelect.value = this.settings.format;
                console.log('DEBUG_UI: Select Value After:', formatSelect.value);
            }
            if (xAxisSelect) xAxisSelect.value = this.settings.xAxisScale;

            // Y-Axis Scale UI Binding
            const yAxisAutoScale = document.getElementById('yAxisAutoScale');
            const yAxisManualInputs = document.getElementById('yAxisManualInputs');
            const yAxisMin = document.getElementById('yAxisMin');
            const yAxisMax = document.getElementById('yAxisMax');

            if (yAxisAutoScale) {
                // Set initial state
                // Ensure yAxis object exists in settings (for backward compat if loaded from old defaults)
                if (!this.settings.yAxis) this.settings.yAxis = { autoScale: true, min: -100, max: 0 };

                yAxisAutoScale.checked = this.settings.yAxis.autoScale;
                yAxisManualInputs.style.opacity = this.settings.yAxis.autoScale ? '0.5' : '1';
                yAxisManualInputs.style.pointerEvents = this.settings.yAxis.autoScale ? 'none' : 'auto';

                let currentMin = this.settings.yAxis.min;
                let currentMax = this.settings.yAxis.max;

                // Sync with current graph view if Auto Scale is enabled
                if (this.settings.yAxis.autoScale && this.sParamGraph && this.sParamGraph.getViewState) {
                    try {
                        const viewState = this.sParamGraph.getViewState();
                        if (viewState && viewState.y && typeof viewState.y.min === 'number' && typeof viewState.y.max === 'number') {
                            // Use current view values, rounded to 2 decimals
                            currentMin = parseFloat(viewState.y.min.toFixed(2));
                            currentMax = parseFloat(viewState.y.max.toFixed(2));
                        }
                    } catch (e) {
                        console.warn('Failed to sync Y-axis view state:', e);
                    }
                }

                if (yAxisMin) yAxisMin.value = currentMin;
                if (yAxisMax) yAxisMax.value = currentMax;

                // Change Event
                yAxisAutoScale.addEventListener('change', (e) => {
                    const isAuto = e.target.checked;
                    yAxisManualInputs.style.opacity = isAuto ? '0.5' : '1';
                    yAxisManualInputs.style.pointerEvents = isAuto ? 'none' : 'auto';
                });
            }
            if (yAxisAutoScale) {
                yAxisAutoScale.onclick = () => {
                    const manualInputs = document.getElementById('yAxisManualInputs');
                    if (manualInputs) {
                        if (yAxisAutoScale.checked) {
                            manualInputs.style.opacity = '0.5';
                            manualInputs.style.pointerEvents = 'none';
                        } else {
                            manualInputs.style.opacity = '1';
                            manualInputs.style.pointerEvents = 'auto';
                        }
                    }
                };
                // Trigger initial state
                yAxisAutoScale.onclick();
            }

            // --- X-Axis Logic ---
            // Ensure X-Axis default exists
            if (!this.settings.xAxis) {
                this.settings.xAxis = {
                    autoScale: true,
                    min: 1000000,
                    max: 100000000
                };
            }

            const xAxisAutoScale = document.getElementById('xAxisAutoScale');
            const xAxisManualInputs = document.getElementById('xAxisManualInputs');
            const xAxisMin = document.getElementById('xAxisMin');
            const xAxisMax = document.getElementById('xAxisMax');
            const xAxisMinUnit = document.getElementById('xAxisMinUnit');
            const xAxisMaxUnit = document.getElementById('xAxisMaxUnit');

            if (xAxisAutoScale && xAxisManualInputs && xAxisMin && xAxisMax && xAxisMinUnit && xAxisMaxUnit) {
                xAxisAutoScale.checked = this.settings.xAxis.autoScale;

                // Smart Init: Determine best unit for current values
                const minUnitVal = this.determineBestUnit(this.settings.xAxis.min);
                const maxUnitVal = this.determineBestUnit(this.settings.xAxis.max);

                // Set Units
                xAxisMinUnit.value = minUnitVal;
                xAxisMaxUnit.value = maxUnitVal;

                // Set Scaled Values
                xAxisMin.value = this.settings.xAxis.min / minUnitVal;
                xAxisMax.value = this.settings.xAxis.max / maxUnitVal;

                // X-Axis Auto Scale Toggle Logic
                const updateXAxisState = () => {
                    if (xAxisAutoScale.checked) {
                        xAxisManualInputs.style.opacity = '0.5';
                        xAxisManualInputs.style.pointerEvents = 'none';
                        // Hide if using display:none/flex approach (index.html used display:none initially)
                        // But our updated HTML uses display: flex style in parent div for toggling.
                        // Wait, the replaced HTML used style="display: none ..." in HTML source?
                        // Let's force flex if we want to show it, or check CSS. 
                        // Actually standard behavior here is just opacity toggle if layout permits.
                        // But if it was display:none, we need to show it.
                        // Let's follow Y-axis pattern: visual disable.
                        // Check if xAxisManualInputs was hidden by default in HTML? 
                        // Yes, user replaced it with style="display: none; ..." 
                        // We should show it always? Or only when manual?
                        // The Y-axis logic in existing code (lines 789-798 above) just toggles opacity/pointerEvents.
                        // Let's force display:flex if it's currently none to ensure it's seen.
                        if (xAxisManualInputs.style.display === 'none') xAxisManualInputs.style.display = 'flex';
                    } else {
                        xAxisManualInputs.style.opacity = '1';
                        xAxisManualInputs.style.pointerEvents = 'auto';
                        if (xAxisManualInputs.style.display === 'none') xAxisManualInputs.style.display = 'flex';
                    }
                };

                xAxisAutoScale.onclick = updateXAxisState;
                updateXAxisState();

                // Auto-Conversion Logic (Smart Unit Binding)
                const setupAutoConversion = (input, unitSelect) => {
                    // Store previous unit to calculate conversion ratio
                    input.dataset.lastUnit = unitSelect.value;

                    unitSelect.onchange = () => {
                        const oldUnit = parseFloat(input.dataset.lastUnit || 1);
                        const newUnit = parseFloat(unitSelect.value);
                        const currentVal = parseFloat(input.value);

                        if (!isNaN(currentVal)) {
                            // Convert value to maintain actual Frequency
                            // displayed * oldUnit = newDisplayed * newUnit
                            // newDisplayed = displayed * (oldUnit / newUnit)
                            const newVal = currentVal * (oldUnit / newUnit);
                            input.value = newVal; // Step matches 'any' so decimals are fine
                        }

                        input.dataset.lastUnit = newUnit;
                    };

                    // Update lastUnit when user manually types a number? 
                    // No need, lastUnit tracks the *unit dropdown state*. 
                    // The number itself changes freely.
                };

                setupAutoConversion(xAxisMin, xAxisMinUnit);
                setupAutoConversion(xAxisMax, xAxisMaxUnit);
            }

            if (animationToggle) animationToggle.checked = this.settings.animation;
            if (showMarkerValue) showMarkerValue.checked = (this.settings.showMarkerValue !== undefined) ? this.settings.showMarkerValue : true;
            if (invertReactance) invertReactance.checked = this.settings.matchingRange.invertReactance;
            if (linRXAbsolute) linRXAbsolute.checked = (this.settings.absoluteImag !== undefined) ? this.settings.absoluteImag : true;
            if (linRXHighlightNegative) {
                linRXHighlightNegative.checked = (this.settings.highlightNegative !== undefined) ? this.settings.highlightNegative : false;
            }
            if (smithInputImpedance) {
                smithInputImpedance.checked = (this.settings.showInputImpedance !== undefined) ? this.settings.showInputImpedance : false;
            }

            // Set frequency with appropriate unit
            if (matchingRangeFreq && matchingRangeFreqUnit) {
                const freq = this.settings.matchingRange.frequency;
                const { value, unit } = this.frequencyToDisplay(freq);
                matchingRangeFreq.value = value;
                matchingRangeFreqUnit.value = unit;
            }

            // Sync Smith Chart Freq input as well
            if (smithChartFreq && smithChartFreqUnit) {
                const freq = this.settings.matchingRange.frequency;
                const { value, unit } = this.frequencyToDisplay(freq);
                smithChartFreq.value = value;
                smithChartFreqUnit.value = unit;
            }

            // Set points per edge
            const matchingRangePoints = document.getElementById('matchingRangePoints');
            if (matchingRangePoints) {
                matchingRangePoints.value = this.settings.matchingRange.pointsPerEdge || 20;
            }

            // Bind Meas change event
            if (measSelect) {
                measSelect.removeEventListener('change', this._measChangeHandler);
                this._measChangeHandler = () => this.handleMeasChange();
                measSelect.addEventListener('change', this._measChangeHandler);
            }

            // Bind Format change event (for hiding/showing Lin R, X options)
            if (formatSelect) {
                formatSelect.removeEventListener('change', this._measChangeHandler); // Re-use same handler as it calls updateUI
                formatSelect.addEventListener('change', this._measChangeHandler);
            }

            // Initial state setup
            this.handleMeasChange();



            // Reset to Measurement Tab
            const tabs = modal.querySelectorAll('.settings-tab');
            const contents = modal.querySelectorAll('.settings-tab-content');

            tabs.forEach(t => t.classList.remove('active'));
            contents.forEach(c => c.classList.remove('active'));

            const measTab = modal.querySelector('.settings-tab[data-tab="measurement"]');
            const measContent = document.getElementById('tabMeasurement');

            if (measTab) measTab.classList.add('active');
            if (measContent) measContent.classList.add('active');
        }
    }

    /**
     * Convert frequency to display value with appropriate unit
     */
    frequencyToDisplay(freq) {
        if (freq >= 1e9) {
            return { value: freq / 1e9, unit: '1e9' };
        } else if (freq >= 1e6) {
            return { value: freq / 1e6, unit: '1e6' };
        } else {
            return { value: freq / 1e3, unit: '1e3' };
        }
    }

    closeSettingsModal() {
        const modal = document.getElementById('graphSettingsModal');
        if (modal) {
            modal.classList.remove('active');
            // Revert any temporary highlights (e.g. if cancelled)
            this.updateComponentHighlights();
        }
    }

    /**
     * Set settings (e.g. from loaded file)
     * Handles legacy migration and updates graph
     */
    setSettings(newSettings) {
        if (!newSettings) return;

        console.log('GraphController: setSettings called', newSettings);

        // 1. Migration Logic (Legacy 'impedance' meas -> 'S11' meas + 'impedance' format)
        if (newSettings.meas === 'impedance') {
            console.warn('GraphController: Migrating legacy "impedance" setting');
            newSettings.meas = 'S11';
            newSettings.format = 'impedance';
        }

        // 2. Merge Settings
        this.settings = { ...this.settings, ...newSettings };

        // 3. Apply to SParameterGraph
        if (this.sParamGraph) {
            // Apply Format
            if (this.settings.format) {
                this.sParamGraph.setFormat(this.settings.format);
            }
            // Apply Measurement
            if (this.settings.meas) {
                this.sParamGraph.setMeas(this.settings.meas);
            }
            // Apply Axis Scale
            if (this.settings.xAxisScale) {
                this.sParamGraph.setXAxisScale(this.settings.xAxisScale);
            }
            // Apply Animation
            if (this.settings.animation !== undefined) {
                this.sParamGraph.setAnimation(this.settings.animation);
            }
        }

        // 4. Update Float Window if open
        this.broadcastSettings();

        // 5. Update Modal UI if open (optional but good for consistency)
        // If modal is active, re-sync values
        const modal = document.getElementById('graphSettingsModal');
        if (modal && modal.classList.contains('active')) {
            const formatSelect = document.getElementById('formatSelect');
            const measSelect = document.getElementById('measSelect');
            if (formatSelect) formatSelect.value = this.settings.format;
            if (measSelect) measSelect.value = this.settings.meas;
            this.handleMeasChange(); // Refresh UI state
        }
    }

    /**
     * Get current settings for saving
     */
    getSettings() {
        return JSON.parse(JSON.stringify(this.settings));
    }

    /**
     * Set settings (e.g., from loaded file)
     */
    setSettings(newSettings) {
        if (!newSettings) return;

        // Legacy Data Migration: 'impedance' measurement -> 'S11' meas + 'impedance' format
        if (newSettings.meas === 'impedance') {
            console.warn('GraphController: Migrating legacy impedance measurement to S11 + impedance format');
            newSettings.meas = 'S11';
            newSettings.format = 'impedance';
        }

        // Merge settings
        this.settings = { ...this.settings, ...newSettings };
        if (newSettings.matchingRange) {
            this.settings.matchingRange = { ...this.settings.matchingRange, ...newSettings.matchingRange };
        }
        // Ensure highlightNegative is initialized if not present
        if (this.settings.highlightNegative === undefined) {
            this.settings.highlightNegative = false;
        }


        // Apply visual updates
        if (this.sParamGraph) {
            this.sParamGraph.setFormat(this.settings.format);
            this.sParamGraph.setMeas(this.settings.meas);
            this.sParamGraph.setXAxisScale(this.settings.xAxisScale);
            // Apply X-Axis Config
            if (this.sParamGraph.setXAxisConfig && this.settings.xAxis) {
                this.sParamGraph.setXAxisConfig(this.settings.xAxis);
            }
            this.sParamGraph.setAnimation(this.settings.animation);
            this.sParamGraph.setAbsoluteImag(this.settings.absoluteImag);
            this.sParamGraph.setHighlightNegative(this.settings.highlightNegative);
            // Apply Y-Axis Config
            if (this.sParamGraph.setYAxisConfig) {
                this.sParamGraph.setYAxisConfig(this.settings.yAxis);
            }
            // Apply Show Marker Value
            if (this.sParamGraph.markerManager) {
                const showVal = this.settings.showMarkerValue !== undefined ? this.settings.showMarkerValue : true;
                this.sParamGraph.markerManager.setShowValueOnMarker(showVal);
            }
            // Apply Show Input Impedance (Smith Chart)
            if (this.sParamGraph.setShowInputImpedance) {
                this.sParamGraph.setShowInputImpedance(this.settings.showInputImpedance);
            }
            // Ensure Z0 is synced (e.g. if Port impedance changed or mode changed)
            if (this.sParamGraph.setZ0) {
                this.sParamGraph.setZ0(this.getCurrentZ0());
            }

            // Immediate update for Input Impedance Marker in Normal Mode
            if (this.settings.showInputImpedance && this.settings.meas !== 'matchingRange') {
                const targetFreq = this.settings.matchingRange.frequency || 50e6;
                const zin = this.calculateInputImpedance(targetFreq);
                if (this.sParamGraph.setPortImpedance) {
                    this.sParamGraph.setPortImpedance(zin);
                }
            }
        }

        this.updateGraphTitle();
        this.handleMeasChange(); // Update UI state (checkboxes, matching range options)

        // If Matching Range, trigger calculation
        if (this.settings.meas === 'matchingRange') {
            this.calculateAndPlotMatchingRange();
        }

        // Update component highlights on canvas
        this.updateComponentHighlights();

        this.broadcastSettings();
    }

    /**
     * Update component highlights based on current settings
     */
    updateComponentHighlights() {
        if (!this.circuit) return;

        // First clear all highlights
        this.circuit.getAllComponents().forEach(c => c.setMatchingHighlight(false));

        // If Matching Range mode, apply highlights
        if (this.settings.meas === 'matchingRange' && this.settings.matchingRange.selectedComponents) {
            this.settings.matchingRange.selectedComponents.forEach(id => {
                const comp = this.circuit.getComponent(id);
                if (comp) comp.setMatchingHighlight(true);
            });
        }
    }



    applySettings() {
        try {
            const formatSelect = document.getElementById('formatSelect');
            const measSelect = document.getElementById('measSelect');
            const xAxisSelect = document.getElementById('xAxisSelect');
            const animationToggle = document.getElementById('animationToggle');
            const invertReactance = document.getElementById('invertReactance');
            const linRXAbsolute = document.getElementById('linRXAbsolute');
            const linRXHighlightNegative = document.getElementById('linRXHighlightNegative');
            const showMarkerValue = document.getElementById('showMarkerValueGlobal');
            const smithInputImpedance = document.getElementById('smithInputImpedance');

            const newSettings = { ...this.settings };

            if (formatSelect) newSettings.format = formatSelect.value;
            if (measSelect) newSettings.meas = measSelect.value;
            if (xAxisSelect) newSettings.xAxisScale = xAxisSelect.value;

            // X-Axis Settings
            const xAxisAutoScale = document.getElementById('xAxisAutoScale');
            const xAxisMin = document.getElementById('xAxisMin');
            const xAxisMax = document.getElementById('xAxisMax');
            const xAxisMinUnit = document.getElementById('xAxisMinUnit');
            const xAxisMaxUnit = document.getElementById('xAxisMaxUnit');

            if (xAxisAutoScale) {
                const parsedMin = parseFloat(xAxisMin.value);
                const parsedMax = parseFloat(xAxisMax.value);
                const minUnit = parseFloat(xAxisMinUnit ? xAxisMinUnit.value : 1);
                const maxUnit = parseFloat(xAxisMaxUnit ? xAxisMaxUnit.value : 1);

                newSettings.xAxis = {
                    autoScale: xAxisAutoScale.checked,
                    min: isNaN(parsedMin) ? 1000000 : parsedMin * minUnit,
                    max: isNaN(parsedMax) ? 100000000 : parsedMax * maxUnit
                };
            }

            if (animationToggle) newSettings.animation = animationToggle.checked;
            if (showMarkerValue) newSettings.showMarkerValue = showMarkerValue.checked;
            if (linRXAbsolute) newSettings.absoluteImag = linRXAbsolute.checked;
            if (linRXHighlightNegative) newSettings.highlightNegative = linRXHighlightNegative.checked;
            if (smithInputImpedance) newSettings.showInputImpedance = smithInputImpedance.checked;

            // Y-Axis Settings
            const yAxisAutoScale = document.getElementById('yAxisAutoScale');
            const yAxisMin = document.getElementById('yAxisMin');
            const yAxisMax = document.getElementById('yAxisMax');

            if (yAxisAutoScale) {
                const parsedMin = parseFloat(yAxisMin.value);
                const parsedMax = parseFloat(yAxisMax.value);

                newSettings.yAxis = {
                    autoScale: yAxisAutoScale.checked,
                    min: isNaN(parsedMin) ? -100 : parsedMin,
                    max: isNaN(parsedMax) ? 0 : parsedMax
                };
            }

            // Handle Matching Range specific settings
            if (newSettings.meas === 'matchingRange') {
                if (invertReactance) newSettings.matchingRange.invertReactance = invertReactance.checked;

                // Get frequency setting
                const matchingRangeFreq = document.getElementById('matchingRangeFreq');
                const matchingRangeFreqUnit = document.getElementById('matchingRangeFreqUnit');
                if (matchingRangeFreq && matchingRangeFreqUnit) {
                    newSettings.matchingRange.frequency =
                        parseFloat(matchingRangeFreq.value) * parseFloat(matchingRangeFreqUnit.value);
                }

                // Get points per edge setting
                const matchingRangePoints = document.getElementById('matchingRangePoints');
                if (matchingRangePoints) {
                    newSettings.matchingRange.pointsPerEdge =
                        Math.max(2, Math.min(1000, parseInt(matchingRangePoints.value) || 20));
                }

                // Collect selected components
                const checkboxes = document.querySelectorAll('#componentCheckboxes input[type="checkbox"]:checked');
                newSettings.matchingRange.selectedComponents = Array.from(checkboxes).map(cb => cb.value);

                // Force Smith chart format
                newSettings.format = 'smith';
            } else {
                // Also allow updating frequency if in Smith Chart Normal Mode
                // because "Show Input Impedance" relies on this frequency
                const smithChartFreq = document.getElementById('smithChartFreq');
                const smithChartFreqUnit = document.getElementById('smithChartFreqUnit');
                if (newSettings.format === 'smith' && smithChartFreq && smithChartFreqUnit) {
                    const val = parseFloat(smithChartFreq.value);
                    const unit = parseFloat(smithChartFreqUnit.value);
                    if (!isNaN(val) && !isNaN(unit)) {
                        newSettings.matchingRange.frequency = val * unit;
                    }
                }
            }

            // Apply the consolidated settings
            this.setSettings(newSettings);

            if (window.notificationManager) {
                window.notificationManager.show(`설정 적용됨: ${this.settings.meas} - ${this.getFormatDisplayName(this.settings.format)}`, 'success');
            }

            this.closeSettingsModal();
        } catch (error) {
            console.error('Failed to apply settings:', error);
            if (window.notificationManager) {
                window.notificationManager.show(`설정 적용 실패: ${error.message}`, 'error');
            }
            // Attempt to close modal anyway to prevent being stuck
            this.closeSettingsModal();
        }
    }

    /**
     * Calculate and plot Matching Range on Smith Chart
     */
    calculateAndPlotMatchingRange() {
        const selectedIds = this.settings.matchingRange.selectedComponents;
        if (selectedIds.length === 0) {
            if (window.notificationManager) {
                window.notificationManager.show('Please select at least one component for Matching Range', 'warning');
            }
            return;
        }

        // Get selected components with their ranges
        const tunableComponents = this.getTunableComponents();
        const selectedComponents = tunableComponents.filter(comp => selectedIds.includes(comp.id));

        if (selectedComponents.length === 0) {
            return;
        }

        // Calculate matching range path
        const matchingRangeData = this.generateMatchingRangePath(selectedComponents);

        // Pass to SParameterGraph for Smith chart rendering
        if (this.sParamGraph && this.sParamGraph.setMatchingRangeData) {
            this.sParamGraph.setMatchingRangeData(
                matchingRangeData,
                this.settings.matchingRange.invertReactance
            );
        }

        // Broadcast to external window
        this.broadcastMatchingRangeData(
            matchingRangeData,
            this.settings.matchingRange.invertReactance
        );
    }

    /**
     * Generate N-bit Gray Code sequence
     * Gray Code ensures adjacent values differ by only 1 bit
     * This creates a path where only one component changes at a time
     * @param {number} n - Number of bits (components)
     * @returns {number[]} Array of Gray Code values [0, 1, 3, 2, 6, 7, 5, 4, ...]
     */
    generateGrayCode(n) {
        if (n <= 0) return [0];

        const count = 1 << n; // 2^n
        const grayCode = [];

        for (let i = 0; i < count; i++) {
            // Gray code formula: G(i) = i XOR (i >> 1)
            grayCode.push(i ^ (i >> 1));
        }

        return grayCode;
    }

    /**
     * Find the bit position that differs between two Gray Code values
     * @param {number} g1 - First Gray Code value
     * @param {number} g2 - Second Gray Code value
     * @returns {number} Bit position that changed (0-indexed from right)
     */
    findChangedBit(g1, g2) {
        const diff = g1 ^ g2;
        // Find position of the single set bit
        return Math.log2(diff);
    }

    /**
     * Generate matching range path for Smith chart
     * Supports N components using Gray Code for closed path traversal
     */
    generateMatchingRangePath(selectedComponents) {
        const numSteps = this.settings.matchingRange.pointsPerEdge || 20;
        const paths = [];
        const invertReactance = this.settings.matchingRange.invertReactance;
        const centerFreq = this.settings.matchingRange.frequency || 50e6;
        const n = selectedComponents.length;

        // Dynamic Z0 from Port 1
        const currentZ0 = this.getCurrentZ0();

        // Update Graph Z0
        if (this.sParamGraph) {
            this.sParamGraph.setZ0(currentZ0);
        }

        if (n === 0) {
            return { paths: [], frequency: centerFreq, invertReactance, components: [] };
        }

        // Generate Gray Code sequence for N components
        const grayCode = this.generateGrayCode(n);

        // Add closing edge back to start
        const fullSequence = [...grayCode, grayCode[0]];

        // Collect all points along the path
        const allPoints = [];

        for (let edge = 0; edge < fullSequence.length - 1; edge++) {
            const currentCode = fullSequence[edge];
            const nextCode = fullSequence[edge + 1];

            // Find which component changes in this edge
            const changedBit = this.findChangedBit(currentCode, nextCode);
            const changingComp = selectedComponents[changedBit];

            // Determine direction: 0->1 means Min->Max, 1->0 means Max->Min
            const isIncreasing = ((nextCode >> changedBit) & 1) === 1;

            // Generate points along this edge
            for (let i = 0; i <= numSteps; i++) {
                // Skip first point of each edge except first edge (to avoid duplicates)
                if (edge > 0 && i === 0) continue;

                const t = i / numSteps;

                // Build values array for all components
                const values = selectedComponents.map((comp, idx) => {
                    if (idx === changedBit) {
                        // This component is being swept
                        if (isIncreasing) {
                            return comp.min + t * (comp.max - comp.min);
                        } else {
                            return comp.max - t * (comp.max - comp.min);
                        }
                    } else {
                        // This component is fixed at its current state
                        const bitValue = (currentCode >> idx) & 1;
                        return bitValue === 0 ? comp.min : comp.max;
                    }
                });

                // Calculate gamma at these values
                const gamma = this.calculateGammaAtNValues(selectedComponents, values, centerFreq, invertReactance);

                // [DEBUG-MR] Log Start, Mid, End points
                if (i === 0 || i === Math.floor(numSteps / 2) || i === numSteps) {
                    const mag = Math.sqrt(gamma.real * gamma.real + gamma.imag * gamma.imag);
                    const phase = Math.atan2(gamma.imag, gamma.real) * (180 / Math.PI);
                    console.log(`[Debug-MR] Edge ${edge + 1} | Step ${i}/${numSteps} | Sweep: ${changingComp.id} (${isIncreasing ? 'Min->Max' : 'Max->Min'})`);
                    console.log(`[Debug-MR]   Values: ${values.map(v => v.toPrecision(4)).join(', ')}`);
                    console.log(`[Debug-MR]   Gamma: r=${gamma.real.toFixed(5)}, i=${gamma.imag.toFixed(5)} (|G|=${mag.toFixed(5)}, Ang=${phase.toFixed(2)}°)`);
                }

                allPoints.push(gamma);
            }
        }

        // Determine path type based on component count
        const pathTypes = {
            1: 'line',
            2: 'rectangle',
            3: 'cube',
            4: 'hypercube'
        };

        paths.push({
            componentIds: selectedComponents.map(c => c.id),
            points: allPoints,
            type: pathTypes[n] || `${n}D-hypercube`,
            edgeCount: fullSequence.length - 1
        });

        // Calculate current Port Impedance (Zin at current component values)
        // This ensures the yellow triangle is updated to the current state even if we are sweeping others
        const currentZin = this.calculateInputImpedance(centerFreq);

        return {
            paths: paths,
            frequency: centerFreq,
            invertReactance: invertReactance,
            components: selectedComponents,
            portImpedance: currentZin
        };
    }

    /**
     * Calculate Gamma with N component values set
     * Generalized version for any number of components
     */
    calculateGammaAtNValues(components, values, frequency, invertReactance) {
        // Store original values
        const originals = [];
        const circuitComponents = [];

        for (let i = 0; i < components.length; i++) {
            const comp = components[i];
            const circuitComp = this.circuit.getComponent(comp.id);

            if (!circuitComp) {
                // Restore any already changed values and return default
                for (let j = 0; j < i; j++) {
                    circuitComponents[j].params[components[j].paramName] = originals[j];
                }
                return { real: 0, imag: 0 };
            }

            circuitComponents.push(circuitComp);
            originals.push(circuitComp.params[comp.paramName]);

            // Set new value
            circuitComp.params[comp.paramName] = values[i];
        }

        // Calculate impedance with all values set
        const z = this.calculateInputImpedance(frequency);

        // Restore all original values
        for (let i = 0; i < components.length; i++) {
            circuitComponents[i].params[components[i].paramName] = originals[i];
        }

        // Convert to Gamma
        const gamma = this.impedanceToGamma(z);

        // Apply reactance inversion at the gamma level
        if (invertReactance) {
            gamma.imag = -gamma.imag;
        }

        return gamma;
    }

    /**
     * Determine best unit for frequency value
     * @param {number} hz 
     * @returns {number} unit multiplier
     */
    determineBestUnit(hz) {
        if (!hz || hz === 0) return 1;
        const absHz = Math.abs(hz);
        if (absHz >= 1e9) return 1e9;
        if (absHz >= 1e6) return 1e6;
        if (absHz >= 1e3) return 1e3;
        return 1;
    }

    /**
     * Calculate input impedance at a frequency using the circuit's calculator
     */
    calculateInputImpedance(frequency) {
        // Use the circuit's existing simulation infrastructure
        if (window.calculator) {
            try {
                const result = window.calculator.calculateAtFrequency(frequency);
                if (result && result.zin) {
                    return result.zin;
                }
            } catch (e) {
                console.warn('Failed to calculate impedance:', e);
            }
        }

        // Fallback: return 50 ohms (matched)
        return { real: 50, imag: 0 };
    }

    /**
     * Convert impedance to reflection coefficient (Gamma)
     */
    impedanceToGamma(z) {
        const Z0 = this.getCurrentZ0(); // Dynamic Z0
        let zReal = z.real || z.r || 0;
        let zImag = z.imag || z.i || 0;

        // Gamma = (Z - Z0) / (Z + Z0)
        const denomReal = zReal + Z0;
        const denomImag = zImag;
        const denomMagSq = denomReal * denomReal + denomImag * denomImag;

        if (denomMagSq === 0) {
            return { real: 1, imag: 0 };
        }

        const numReal = zReal - Z0;
        const numImag = zImag;

        const gammaReal = (numReal * denomReal + numImag * denomImag) / denomMagSq;
        const gammaImag = (numImag * denomReal - numReal * denomImag) / denomMagSq;

        return { real: gammaReal, imag: gammaImag };
    }


    /**
     * Get current Reference Impedance (Z0) from Port 1
     */
    getCurrentZ0() {
        if (!this.circuit) return 50;

        // Find Port 1
        const components = this.circuit.getAllComponents();
        const port1 = components.find(c => c.type === 'PORT' && c.params.portNumber === 1);

        if (port1 && port1.params.impedance) {
            return parseFloat(port1.params.impedance);
        }

        return 50; // Default
    }

    updateGraphTitle() {
        const titleElement = document.getElementById('graphTitle');
        if (titleElement && this.sParamGraph) {
            titleElement.textContent = this.sParamGraph.getGraphTitle();
        }
    }

    getFormatDisplayName(format) {
        const names = {
            'logMag': 'Log Mag',
            'linMag': 'Lin Mag',
            'phase': 'Phase',
            'delay': 'Delay',
            'smith': 'Smith',
            'polar': 'Polar',
            'swr': 'SWR'
        };
        return names[format] || format;
    }

    /**
     * Load graph data from CSV
     */
    /**
     * Load graph data from CSV
     */
    async loadGraphData() {
        try {
            // Use File System Access API if available
            if (window.showOpenFilePicker) {
                const handles = await window.showOpenFilePicker({
                    multiple: true,
                    types: [{
                        description: 'Data Files',
                        accept: {
                            'text/csv': ['.csv'],
                            'text/plain': ['.s1p', '.s2p', '.txt']
                        }
                    }]
                });

                if (!handles || handles.length === 0) return;

                const btn = document.getElementById('btnLoadGraphData');
                if (btn) {
                    btn.innerHTML = '<span class="icon">⏳</span> Loading...';
                    btn.disabled = true;
                }

                this.sParamGraph.clearCsvData();
                let loadCount = 0;

                for (const handle of handles) {
                    const file = await handle.getFile();
                    await this.processLoadedFile(file);
                    loadCount++;
                }

                this.finalizeLoad(loadCount);
                if (btn) {
                    btn.innerHTML = '<span class="icon">📂</span> Load';
                    btn.disabled = false;
                }

            } else {
                // Fallback to input element
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.csv,.s1p,.s2p,.txt';
                input.multiple = true;

                input.onchange = async (e) => {
                    const files = Array.from(e.target.files);
                    if (files.length === 0) return;

                    const btn = document.getElementById('btnLoadGraphData');
                    if (btn) {
                        btn.innerHTML = '<span class="icon">⏳</span> Loading...';
                        btn.disabled = true;
                    }

                    this.sParamGraph.clearCsvData();
                    let loadCount = 0;

                    for (const file of files) {
                        await this.processLoadedFile(file);
                        loadCount++;
                    }

                    this.finalizeLoad(loadCount);
                    if (btn) {
                        btn.innerHTML = '<span class="icon">📂</span> Load';
                        btn.disabled = false;
                    }
                };
                input.click();
            }
        } catch (err) {
            console.error('File load error:', err);
            if (err.name !== 'AbortError') {
                if (window.notificationManager) window.notificationManager.show('Error loading files: ' + err.message, 'error');
            }
        }
    }

    async processLoadedFile(file) {
        try {
            const text = await file.text();
            const fileName = file.name.toLowerCase();
            let parseResult;

            if (fileName.endsWith('.s1p') || fileName.endsWith('.s2p')) {
                parseResult = CSVParser.parseTouchstone(text);
            } else {
                parseResult = CSVParser.parse(text);
            }

            // Check for Matching Range Data
            if (parseResult.metadata && parseResult.metadata.type === 'matchingRange') {
                if (this.settings.meas !== 'matchingRange') {
                    if (window.notificationManager) {
                        window.notificationManager.show('Meas를 "Matching Range"로 변경한 후 로드해 주세요.', 'warning');
                    }
                    return;
                }

                if (this.sParamGraph && this.sParamGraph.setLoadedMatchingRangeData) {
                    this.sParamGraph.setLoadedMatchingRangeData(parseResult.paths);
                    if (window.notificationManager) {
                        window.notificationManager.show(`Matching Range Loaded: ${parseResult.paths.length} paths`, 'success');
                    }
                }
                return;
            }

            // Normal Graph Data
            if (parseResult.data && parseResult.data.length > 0) {
                this.sParamGraph.addCsvData(parseResult.data, {
                    fileName: file.name,
                    ...parseResult.metadata
                });
            }
        } catch (err) {
            console.error(`Error parsing ${file.name}:`, err);
            if (window.notificationManager) window.notificationManager.show(`Error loading ${file.name}: ${err.message}`, 'error');
        }
    }

    finalizeLoad(count) {
        if (count > 0) {
            if (this.simulationController) {
                this.simulationController.setGraphResetPending(true);
            }
            // If we are in Matching Range mode, broadcast the newly loaded data
            if (this.settings.meas === 'matchingRange') {
                this.broadcastLoadedMatchingRangeData();
            }
        }
    }

    handleClearGraph() {
        if (this.sParamGraph) {
            this.sParamGraph.clear();
            if (this.sParamGraph.markerManager && typeof this.sParamGraph.markerManager.clear === 'function') {
                this.sParamGraph.markerManager.clear();
            }
            if (typeof this.sParamGraph.clearMarkers === 'function') {
                this.sParamGraph.clearMarkers();
            }
            if (window.notificationManager) {
                window.notificationManager.show('Graph cleared', 'info');
            }
        }
    }

    /**
     * Export current Matching Range to CSV
     */
    exportMatchingRangeToCSV() {
        if (!this.sParamGraph || !this.sParamGraph.matchingRangeData) {
            if (window.notificationManager) window.notificationManager.show('저장할 Matching Range 데이터가 없습니다.', 'warning');
            return;
        }

        const data = this.sParamGraph.matchingRangeData;
        if (!data.paths || data.paths.length === 0) {
            if (window.notificationManager) window.notificationManager.show('저장할 Matching Range 데이터가 없습니다.', 'warning');
            return;
        }

        // CSV Header
        // Use Characteristic Impedance (Z0)
        let z0Real = 50;
        let z0Imag = 0;

        if (this.sParamGraph && this.sParamGraph.simulationResults &&
            this.sParamGraph.simulationResults.config &&
            this.sParamGraph.simulationResults.config.z0 !== undefined) {
            z0Real = this.sParamGraph.simulationResults.config.z0;
        }

        let csvContent = `Matching Range,${z0Real},${z0Imag}\n`;
        csvContent += "PathID,Real,Imag\n";

        // CSV Data
        data.paths.forEach((path, pathIndex) => {
            if (path.points) {
                path.points.forEach(point => {
                    csvContent += `${pathIndex},${point.real},${point.imag}\n`;
                });
            }
        });

        // Download
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', 'matching_range_data.csv');
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}
