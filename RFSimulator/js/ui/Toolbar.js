/**
 * Toolbar
 * Manages tool buttons and component palette interactions
 */
class Toolbar {
    constructor(dragDropHandler, wireManager) {
        this.dragDropHandler = dragDropHandler;
        this.wireManager = wireManager;

        this.init();
    }

    /**
     * Initialize toolbar
     */
    init() {
        this.bindToolButtons();
        this.bindHeaderButtons();
    }

    /**
     * Bind tool button events
     */
    bindToolButtons() {
        // Deselect button (Null mode)
        const btnDeselect = document.getElementById('btnDeselect');
        if (btnDeselect) {
            btnDeselect.addEventListener('click', () => {
                this.dragDropHandler.setMode(null);
                // Explicitly exit paint mode if active
                if (window.drawingManager) {
                    window.drawingManager.exitPaintMode();
                }
            });
        }

        // Select button
        const btnSelect = document.getElementById('btnSelect');
        if (btnSelect) {
            btnSelect.addEventListener('click', () => {
                this.dragDropHandler.setMode('select');
                if (window.drawingManager) window.drawingManager.exitPaintMode();
            });
        }

        // Wire button (moved to palette)
        const btnWire = document.getElementById('btnWireComponent');
        if (btnWire) {
            btnWire.addEventListener('click', () => {
                // Determine if we should toggle or set
                // For a component-like button, it usually just sets the mode
                this.dragDropHandler.setMode('wire');
                if (window.drawingManager) window.drawingManager.exitPaintMode();
            });
        }

        // Paint button
        const btnPaint = document.getElementById('btnPaint');
        if (btnPaint) {
            btnPaint.addEventListener('click', () => {
                if (window.drawingManager) {
                    if (window.drawingManager.isPaintMode) {
                        // Toggle Off
                        window.drawingManager.exitPaintMode();
                    } else {
                        // Toggle On (Default to Pen)
                        window.drawingManager.setTool('pen');
                    }
                }
            });
        }

        // Delete button removed
    }

    /**
     * Bind header button events
     */
    bindHeaderButtons() {
        // New circuit
        const btnNew = document.getElementById('btnNew');
        if (btnNew) {
            btnNew.addEventListener('click', () => this.newCircuit());
        }

        // Save circuit
        const btnSave = document.getElementById('btnSave');
        if (btnSave) {
            btnSave.addEventListener('click', () => this.saveCircuit());
        }

        // Load circuit
        const btnLoad = document.getElementById('btnLoad');
        if (btnLoad) {
            btnLoad.addEventListener('click', () => this.loadCircuit());
        }

        // Single Shot (Simulate)
        const btnSingleShot = document.getElementById('btnSingleShot');
        if (btnSingleShot) {
            // Note: Event is also bound in main.js
            // btnSingleShot.addEventListener('click', () => this.simulate());
        }
    }

    /**
     * Create new circuit
     */
    newCircuit() {
        if (confirm('Create new circuit? All unsaved changes will be lost.')) {
            window.circuit.clear();
            window.canvasManager.renderComponents();
            window.canvasManager.resetView();

            // 새 회로 생성 후 첫 Single Shot에서 그래프 리셋되도록 설정
            if (window.setGraphResetPending) {
                window.setGraphResetPending(true);
            }
        }
    }

    /**
     * Save circuit to file
     * Includes simulation parameters and graph settings
     */
    saveCircuit() {
        // Circuit Structure
        const circuitData = window.circuit.toJSON();

        // Simulation Settings
        const simSettings = {
            freqStart: document.getElementById('freqStart')?.value || 1,
            freqStartUnit: document.getElementById('freqStartUnit')?.value || 1e6,
            freqEnd: document.getElementById('freqEnd')?.value || 100,
            freqEndUnit: document.getElementById('freqEndUnit')?.value || 1e6,
            freqPoints: document.getElementById('freqPoints')?.value || 201
        };

        // Graph Settings
        let graphSettings = {};
        if (window.graphController) {
            graphSettings = window.graphController.getSettings();
        } else if (window.sParamGraph) {
            // Fallback if graphController is not available (should not happen)
            graphSettings = {
                format: window.sParamGraph.currentFormat,
                meas: window.sParamGraph.currentMeas,
                xAxisScale: window.sParamGraph.currentXAxisScale,
                animation: window.sParamGraph.config.animation
            };
        }

        // Construct Save Object
        const saveData = {
            version: '1.0',
            circuit: circuitData,
            simulation: simSettings,
            graph: graphSettings,
            timestamp: new Date().toISOString()
        };

        const json = JSON.stringify(saveData, null, 2);

        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = 'circuit_data.json';
        a.click();

        URL.revokeObjectURL(url);
    }

    /**
     * Load circuit from file
     * Supports legacy (array) and new version (object with settings)
     */
    loadCircuit() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';

        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const data = JSON.parse(event.target.result);

                    // Check if it's new format or legacy
                    if (data.circuit) {
                        // New Format
                        window.circuit.fromJSON(data.circuit);

                        // 1. Render components first so SVG elements exist
                        window.canvasManager.renderComponents();
                        window.canvasManager.fitToContent();

                        // Load Simulation Settings
                        if (data.simulation) {
                            if (document.getElementById('freqStart')) document.getElementById('freqStart').value = data.simulation.freqStart;
                            if (document.getElementById('freqStartUnit')) document.getElementById('freqStartUnit').value = data.simulation.freqStartUnit;
                            if (document.getElementById('freqEnd')) document.getElementById('freqEnd').value = data.simulation.freqEnd;
                            if (document.getElementById('freqEndUnit')) document.getElementById('freqEndUnit').value = data.simulation.freqEndUnit;
                            if (document.getElementById('freqPoints')) document.getElementById('freqPoints').value = data.simulation.freqPoints;
                        }

                        // 2. Then apply graph settings (which triggers highlighting)
                        if (data.graph) {
                            if (window.graphController) {
                                window.graphController.setSettings(data.graph);
                            } else if (window.updateGraphSettingsState) {
                                window.updateGraphSettingsState(data.graph);
                            }
                        }

                        // 회로 로드 후 첫 Single Shot에서 그래프 리셋되도록 설정
                        if (window.setGraphResetPending) {
                            window.setGraphResetPending(true);
                        }

                    } else if (Array.isArray(data)) {
                        // Legacy Format (just circuit elements)
                        window.circuit.fromJSON(data);
                        window.canvasManager.renderComponents();
                        window.canvasManager.fitToContent();
                    } else {
                        throw new Error('Invalid file format');
                    }

                    // Trigger simulation info update if needed
                    if (window.toolbar) window.toolbar.updateCircuitInfo();

                } catch (err) {
                    alert('Error loading circuit: ' + err.message);
                    console.error(err);
                }
            };
            reader.readAsText(file);
        };

        input.click();
    }

    /**
     * Run simulation (placeholder for now)
     */
    simulate() {
        const stats = window.circuit.getStats();

        if (stats.ports === 0) {
            alert('Please add at least one Port component to run simulation.');
            return;
        }

        if (stats.totalComponents < 2) {
            alert('Please add more components to create a circuit.');
            return;
        }

        // TODO: Implement actual S-parameter simulation
        alert('Simulation feature will be implemented in Phase 2.');
    }

    /**
     * Update circuit info display
     */
    updateCircuitInfo() {
        const stats = window.circuit.getStats();

        const componentCount = document.getElementById('componentCount');
        if (componentCount) {
            componentCount.textContent = stats.totalComponents;
        }

        const wireCount = document.getElementById('wireCount');
        if (wireCount) {
            wireCount.textContent = stats.totalWires;
        }

        const portCount = document.getElementById('portCount');
        if (portCount) {
            portCount.textContent = stats.ports;
        }
    }
}

window.Toolbar = Toolbar;


