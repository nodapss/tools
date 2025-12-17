/**
 * ScriptModal.js
 * Manages the Script Editor Modal for directly editing Circuit JSON and Graph CSV data.
 * Implements a Transactional Model: Changes are only applied on "Apply", and reverted on "Cancel".
 */
class ScriptModal {
    constructor() {
        this.modal = document.getElementById('scriptModal');

        // UI Elements
        this.tabs = document.querySelectorAll('.script-tab');
        this.panels = document.querySelectorAll('.script-panel');
        this.circuitEditor = document.getElementById('circuitScriptEditor');
        this.graphEditor = document.getElementById('graphScriptEditor');
        this.graphSubTabsContainer = document.getElementById('graphSubTabs');
        this.btnAddGraphTab = document.getElementById('btnAddGraphTab');

        // State Management
        // activeMainTab: 'circuit' or 'graph'
        this.activeMainTab = 'circuit';

        // committedState: The state currently applied to the application (Source of Truth for "Cancel")
        this.committedState = {
            circuitJson: '', // Will be loaded on open if empty
            graphTabs: []    // Array of { id, name, content }
        };

        // workingState: The state being edited in the modal (Source of Truth for "Apply")
        this.workingState = {
            circuitJson: '',
            graphTabs: [],
            activeGraphTabId: null
        };

        this.tabCounter = 0;

        this.init();
    }

    init() {
        // Initialize with one empty graph tab in committed state effectively
        this.createInitialCommittedState();

        this.bindEvents();
    }

    createInitialCommittedState() {
        this.tabCounter++;
        const id = `graph-tab-${Date.now()}-${this.tabCounter}`;
        this.committedState.graphTabs = [{
            id: id,
            name: `Graph 1`,
            content: ''
        }];
        this.committedState.circuitJson = '';
    }

    bindEvents() {
        // Main Tab Switching
        this.tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const target = tab.dataset.tab;
                this.switchMainTab(target);
            });
        });

        // Close Button (Treat as Cancel)
        const btnClose = document.getElementById('btnCloseScriptModal');
        if (btnClose) {
            btnClose.addEventListener('click', () => this.cancel());
        }

        // Cancel Button
        const btnCancel = document.getElementById('btnCancelScript');
        if (btnCancel) {
            btnCancel.addEventListener('click', () => this.cancel());
        }

        // Apply Button
        const btnApply = document.getElementById('btnApplyScript');
        if (btnApply) {
            btnApply.addEventListener('click', () => this.apply());
        }

        // Add Graph Tab Button
        if (this.btnAddGraphTab) {
            this.btnAddGraphTab.addEventListener('click', () => this.addGraphTab());
        }

        // Graph Editor Input Handling
        if (this.graphEditor) {
            this.graphEditor.addEventListener('input', (e) => {
                this.updateActiveGraphTabContent(e.target.value);
            });

            // Ctrl+A Support
            this.graphEditor.addEventListener('keydown', (e) => this.handleEditorKeydown(e));
        }

        // Circuit Editor Input Handling
        if (this.circuitEditor) {
            this.circuitEditor.addEventListener('input', (e) => {
                this.workingState.circuitJson = e.target.value;
            });

            // Ctrl+A Support
            this.circuitEditor.addEventListener('keydown', (e) => this.handleEditorKeydown(e));
        }

        // Overlay Click (Treat as Cancel)
        if (this.modal) {
            const overlay = this.modal.querySelector('.modal-overlay');
            if (overlay) {
                overlay.addEventListener('click', () => this.cancel());
            }
        }
    }

    handleEditorKeydown(e) {
        // Support Ctrl+A to select all text
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
            e.preventDefault();
            e.target.select();
        }
    }

    open() {
        if (this.modal) {
            // 1. Sync Committed State with Actual Application State (Current Circuit)
            this.loadCurrentCircuitToCommitted();

            // 2. Clone Committed State to Working State (Start Transaction)
            this.workingState = JSON.parse(JSON.stringify(this.committedState));

            // 3. Set Active Graph Tab (Default to first if none selected or invalid)
            if (this.workingState.graphTabs.length > 0) {
                this.workingState.activeGraphTabId = this.workingState.graphTabs[0].id;
            }

            // 4. Update UI
            this.circuitEditor.value = this.workingState.circuitJson;
            this.renderGraphTabs();
            this.updateGraphEditorContent();

            this.modal.classList.add('active');
        }
    }

    cancel() {
        // Discard working state
        this.workingState = null; // Clean up
        this.close();
    }

    close() {
        if (this.modal) {
            this.modal.classList.remove('active');
        }
    }

    // --- State Management Helpers ---

    loadCurrentCircuitToCommitted() {
        // Generates JSON from current window.circuit and updates committedState.circuitJson
        if (!window.circuit) return;

        try {
            const circuitData = window.circuit.toJSON();
            const simSettings = {
                freqStart: document.getElementById('freqStart')?.value || 1,
                freqStartUnit: document.getElementById('freqStartUnit')?.value || 1e6,
                freqEnd: document.getElementById('freqEnd')?.value || 100,
                freqEndUnit: document.getElementById('freqEndUnit')?.value || 1e6,
                freqPoints: document.getElementById('freqPoints')?.value || 201
            };

            // Graph Settings
            let graphSettings = {};
            if (window.sParamGraph) {
                graphSettings = {
                    format: window.sParamGraph.currentFormat,
                    meas: window.sParamGraph.currentMeas,
                    xAxisScale: window.sParamGraph.currentXAxisScale,
                    animation: window.sParamGraph.config.animation
                };
            }

            const saveData = {
                version: '1.0',
                circuit: circuitData,
                simulation: simSettings,
                graph: graphSettings,
                timestamp: new Date().toISOString()
            };

            this.committedState.circuitJson = JSON.stringify(saveData, null, 2);
        } catch (e) {
            console.error('Failed to load current circuit into state', e);
        }
    }

    switchMainTab(tabName) {
        this.activeMainTab = tabName;

        // Update Tab UI
        this.tabs.forEach(t => {
            if (t.dataset.tab === tabName) t.classList.add('active');
            else t.classList.remove('active');
        });

        // Update Panel UI
        this.panels.forEach(p => {
            if (p.id === `scriptPanel${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`) {
                p.classList.add('active');
            } else {
                p.classList.remove('active');
            }
        });
    }

    // --- Graph Tab Management (Operates on Working State) ---

    addGraphTab() {
        this.tabCounter++;
        const id = `graph-tab-${Date.now()}-${this.tabCounter}`;
        const name = `Graph ${this.tabCounter}`;

        const newTab = {
            id: id,
            name: name,
            content: ''
        };

        this.workingState.graphTabs.push(newTab);
        this.switchGraphTab(id);
    }

    removeGraphTab(id, event) {
        if (event) event.stopPropagation();

        if (this.workingState.graphTabs.length <= 1) {
            alert('At least one graph tab is required.');
            return;
        }

        const index = this.workingState.graphTabs.findIndex(t => t.id === id);
        if (index === -1) return;

        this.workingState.graphTabs.splice(index, 1);

        // If removing active tab, switch to another one
        if (this.workingState.activeGraphTabId === id) {
            const nextTab = this.workingState.graphTabs[index] || this.workingState.graphTabs[index - 1];
            if (nextTab) {
                this.switchGraphTab(nextTab.id);
            }
        } else {
            this.renderGraphTabs();
        }
    }

    switchGraphTab(id) {
        this.workingState.activeGraphTabId = id;
        this.renderGraphTabs();
        this.updateGraphEditorContent();
    }

    updateActiveGraphTabContent(content) {
        const tab = this.workingState.graphTabs.find(t => t.id === this.workingState.activeGraphTabId);
        if (tab) {
            tab.content = content;
        }
    }

    updateGraphEditorContent() {
        const tab = this.workingState.graphTabs.find(t => t.id === this.workingState.activeGraphTabId);
        if (tab && this.graphEditor) {
            this.graphEditor.value = tab.content;
        }
    }

    renderGraphTabs() {
        // Clear existing tabs (except the + button)
        const tabs = Array.from(this.graphSubTabsContainer.querySelectorAll('.graph-sub-tab'));
        tabs.forEach(t => t.remove());

        // Render tabs from working state
        this.workingState.graphTabs.forEach(tab => {
            const btn = document.createElement('button');
            btn.className = `graph-sub-tab ${tab.id === this.workingState.activeGraphTabId ? 'active' : ''}`;
            btn.innerHTML = `
                <span>${tab.name}</span>
                <span class="graph-sub-tab-close" title="Remove Tab">×</span>
            `;

            btn.addEventListener('click', () => this.switchGraphTab(tab.id));

            const closeBtn = btn.querySelector('.graph-sub-tab-close');
            closeBtn.addEventListener('click', (e) => this.removeGraphTab(tab.id, e));

            this.graphSubTabsContainer.insertBefore(btn, this.btnAddGraphTab);
        });
    }

    // --- Apply Logic (Commit Transaction) ---

    apply() {
        // Validate and Apply Circuit Script
        // Only if there is content in circuit editor
        const circuitJson = this.workingState.circuitJson.trim();
        if (circuitJson) {
            try {
                this.applyCircuitScript(circuitJson);
            } catch (e) {
                alert(`Error applying Circuit Script: ${e.message}`);
                return; // Stop if circuit script fails
            }
        }

        // Validate and Apply Graph Scripts
        try {
            this.applyGraphScripts();
        } catch (e) {
            alert(`Error applying Graph Script: ${e.message}`);
            return;
        }

        // If all successful:
        // 1. Commit state
        this.committedState = JSON.parse(JSON.stringify(this.workingState));

        // 2. Close modal
        this.close();

        if (window.showNotification) {
            window.showNotification('Scripts applied successfully!', 'success');
        } else {
            console.log('Scripts applied successfully!');
        }
    }

    applyCircuitScript(jsonString) {
        const data = JSON.parse(jsonString);

        // Validation roughly
        if (!data.circuit && !Array.isArray(data)) {
            throw new Error('Invalid circuit JSON format');
        }

        // Apply Circuit Logic
        if (window.circuit) {
            window.circuit.clear();
            if (data.circuit) {
                window.circuit.fromJSON(data.circuit);

                // Simulation Settings
                if (data.simulation) {
                    if (document.getElementById('freqStart')) document.getElementById('freqStart').value = data.simulation.freqStart;
                    if (document.getElementById('freqStartUnit')) document.getElementById('freqStartUnit').value = data.simulation.freqStartUnit;
                    if (document.getElementById('freqEnd')) document.getElementById('freqEnd').value = data.simulation.freqEnd;
                    if (document.getElementById('freqEndUnit')) document.getElementById('freqEndUnit').value = data.simulation.freqEndUnit;
                    if (document.getElementById('freqPoints')) document.getElementById('freqPoints').value = data.simulation.freqPoints;
                }

                // Graph Settings
                if (data.graph && window.updateGraphSettingsState) {
                    // Update main.js settings object (visual only as we apply directly below)
                }

                if (window.sParamGraph && data.graph) {
                    window.sParamGraph.setFormat(data.graph.format || 'logMag');
                    window.sParamGraph.setMeas(data.graph.meas || 'impedance');
                    window.sParamGraph.setXAxisScale(data.graph.xAxisScale || 'linear');
                    window.sParamGraph.setAnimation(data.graph.animation || false);

                    // Sync UI controls
                    const formatSelect = document.getElementById('formatSelect');
                    const measSelect = document.getElementById('measSelect');
                    const xAxisSelect = document.getElementById('xAxisSelect');
                    const animationToggle = document.getElementById('animationToggle');

                    if (formatSelect && data.graph.format) formatSelect.value = data.graph.format;
                    if (measSelect && data.graph.meas) measSelect.value = data.graph.meas;
                    if (xAxisSelect && data.graph.xAxisScale) xAxisSelect.value = data.graph.xAxisScale;
                    if (animationToggle && data.graph.animation !== undefined) animationToggle.checked = data.graph.animation;
                }

                // Reset Graph pending
                if (window.setGraphResetPending) {
                    window.setGraphResetPending(true);
                }

            } else if (Array.isArray(data)) {
                window.circuit.fromJSON(data);
            }

            if (window.canvasManager) {
                window.canvasManager.renderComponents();
                window.canvasManager.fitToContent();
            }
            if (window.toolbar) {
                window.toolbar.updateCircuitInfo();
            }
        }
    }

    applyGraphScripts() {
        if (!window.sParamGraph || !window.CSVParser) return;

        // Collect all non-empty scripts from WORKING state
        const validTabs = this.workingState.graphTabs.filter(t => t.content.trim().length > 0);

        // Always clear existing CSV data on Apply
        window.sParamGraph.clearCsvData();

        if (validTabs.length === 0) return; // Nothing more to do (Result: graph cleared)

        let appliedCount = 0;

        for (const tab of validTabs) {
            const csvContent = tab.content;

            // Parse
            let parseResult;
            try {
                if (csvContent.trim().startsWith('!') || csvContent.trim().startsWith('#')) {
                    parseResult = window.CSVParser.parseTouchstone(csvContent);
                } else {
                    parseResult = window.CSVParser.parse(csvContent);
                }

                if (parseResult.dataType === 'matchingRange' || (parseResult.metadata && parseResult.metadata.type === 'matchingRange')) {
                    if (window.sParamGraph.currentMeas !== 'matchingRange') {
                        if (window.notificationManager) {
                            window.notificationManager.show('Meas를 "Matching Range"로 변경한 후 적용해 주세요.', 'warning');
                        }
                        return; // Stop applying this tab
                    }

                    if (window.sParamGraph.setLoadedMatchingRangeData) {
                        window.sParamGraph.setLoadedMatchingRangeData(parseResult.paths);
                        appliedCount++;
                    }
                } else if (parseResult.data && parseResult.data.length > 0) {
                    window.sParamGraph.addCsvData(parseResult.data, {
                        fileName: tab.name,
                        ...parseResult.metadata
                    });
                    appliedCount++;
                } else {
                    console.warn(`Tab ${tab.name}: No valid data found.`);
                }
            } catch (err) {
                throw new Error(`Tab '${tab.name}': ${err.message}`);
            }
        }

        if (appliedCount > 0) {
            if (window.setGraphResetPending) window.setGraphResetPending(true);
        }
    }
}

window.ScriptModal = ScriptModal;
