/**
 * Simulation Controller
 * Manages run mode, single shot, and communication with Calculator
 */
class SimulationController {
    constructor(calculator, sParamGraph) {
        this.calculator = calculator;
        this.sParamGraph = sParamGraph;

        // State
        this.isRunMode = false;
        this.runModeDebounceTimer = null;
        this.RUN_MODE_DEBOUNCE_MS = 300;

        // Graph Reset State
        this.isFirstSingleShotAfterLoad = true;
        this.currentSimulationFitView = true;

    }

    setGraphSettingsController(controller) {
        this.graphSettingsController = controller;
    }

    /**
     * Set graph reset pending state
     */
    setGraphResetPending(pending) {
        this.isFirstSingleShotAfterLoad = pending;
        console.log('Graph reset pending state set to:', pending);
    }



    /**
     * Setup event listeners for real-time updates
     */
    setupEventListeners() {
        window.addEventListener('circuit-modified', () => {
            this.updateRealtime();
        });
    }

    /**
     * Update visualization in real-time if enabled
     */


    /**
     * Setup simulation callbacks
     */
    setupCallbacks() {
        this.calculator.onProgress = (progress) => {
            const btn = document.getElementById('btnSingleShot');
            if (btn) {
                btn.innerHTML = `<span class="icon">⏳</span> ${progress.toFixed(0)}%`;
            }
        };

        this.calculator.onComplete = (results) => {
            const btn = document.getElementById('btnSingleShot');
            if (btn) {
                btn.innerHTML = '<span class="icon">▶</span> Single Shot';
            }

            // Store last sweep results (Graph Data)
            this.lastSweepResults = results;

            // Update graph with results
            if (this.sParamGraph) {
                this.sParamGraph.setSimulationData(results, this.currentSimulationFitView);
            }

            // Update external graph if open
            if (this.graphSettingsController) {
                this.graphSettingsController.updateGraphTitle();
                if (typeof this.graphSettingsController.broadcastSimulationData === 'function') {
                    this.graphSettingsController.broadcastSimulationData(results, this.currentSimulationFitView);
                }
            }

            // Show result summary
            this.showSummary(results);

            console.log('Simulation completed:', results);


        };

        this.calculator.onError = (error) => {
            const btn = document.getElementById('btnSingleShot');
            if (btn) {
                btn.innerHTML = '<span class="icon">▶</span> Single Shot';
            }

            if (window.notificationManager) {
                window.notificationManager.show(error, 'error');
            } else {
                console.error(error);
            }
            console.error('Simulation error:', error);
        };
    }



    /**
     * Toggle Run Mode
     */
    toggleRunMode() {
        if (this.isRunMode) {
            this.stopRunMode();
        } else {
            this.startRunMode();
        }
    }

    /**
     * Start Run Mode
     */
    startRunMode() {
        this.isRunMode = true;
        const btn = document.getElementById('btnRunMode');
        if (btn) {
            btn.innerHTML = '<span class="icon">⏹</span> Stop';
            btn.classList.remove('secondary');
            btn.classList.add('danger');
        }
        console.log('Run Mode started');

        // Reset zoom on start
        if (this.sParamGraph) {
            this.sParamGraph.resetZoom();
        }

        // Run initial simulation
        this.runSimulation(true);
    }

    /**
     * Stop Run Mode
     */
    stopRunMode() {
        this.isRunMode = false;

        if (this.runModeDebounceTimer) {
            clearTimeout(this.runModeDebounceTimer);
            this.runModeDebounceTimer = null;
        }

        const btn = document.getElementById('btnRunMode');
        if (btn) {
            btn.innerHTML = '<span class="icon">🔄</span> Run Mode';
            btn.classList.remove('danger');
            btn.classList.add('secondary');
        }
        console.log('Run Mode stopped');
    }

    /**
     * Handle circuit change event
     */
    onCircuitChange() {
        if (!this.isRunMode) return;

        if (this.runModeDebounceTimer) {
            clearTimeout(this.runModeDebounceTimer);
        }

        this.runModeDebounceTimer = setTimeout(() => {
            this.runSimulation(true); // Always fit view to data
        }, this.RUN_MODE_DEBOUNCE_MS);
    }

    /**
     * Single Shot Execution
     */
    async runSingleShot() {
        if (this.isRunMode) {
            this.stopRunMode();
        }

        // Always fit view on single shot
        await this.runSimulation(true);

        if (this.isFirstSingleShotAfterLoad) {
            this.isFirstSingleShotAfterLoad = false;
        }
    }

    /**
     * Plot Impedance for a single component (Simulation based)
     */
    async plotSingleComponentImp(component) {
        if (!component.impedanceConfig) return;

        console.log(`[Debug] plotSingleComponentImp for ${component.id}`, component.impedanceConfig);

        try {
            const results = await this.calculator.simulateSingleComponent(component);

            if (results && this.sParamGraph) {
                // Overlay on graph
                const label = `${component.type}${component.id.split('_').pop()} (Z)`;
                console.log(`[Debug] Adding Component Trace: ${label}, Points: ${results.zin.length}`);
                this.sParamGraph.addComponentTrace(label, results.frequencies, results.zin);
            } else {
                console.warn('[Debug] No results or graph missing');
            }

        } catch (error) {
            console.error("Single Component Sim Failed:", error);
        }
    }

    /**
     * Plot Impedance for a component Group (Sub-circuit)
     */
    async plotGroupImp(groupConfig) {
        if (!groupConfig.enabled) return;

        console.log(`[Debug] plotGroupImp for ${groupConfig.name} (${groupConfig.id})`);

        try {
            const results = await this.calculator.simulateSubCircuit(groupConfig);

            if (results && this.sParamGraph) {
                // Overlay on graph
                const label = groupConfig.name || "Group Plot";
                console.log(`[Debug] Adding Group Trace: ${label}, Points: ${results.zin.length}`);
                this.sParamGraph.addComponentTrace(label, results.frequencies, results.zin, groupConfig.color);
            } else {
                console.warn('[Debug] Group Sim: No results or graph missing');
            }
        } catch (error) {
            console.error("Group Sim Failed:", error);
        }
    }

    /**
     * Run auxiliary simulations for enabled components AND groups
     */
    async runAuxiliarySimulations() {
        if (!window.circuit) return;

        // 1. Single Components
        const components = window.circuit.getAllComponents();
        const enabledComponents = components.filter(c => c.impedanceConfig && c.impedanceConfig.enabled);

        if (enabledComponents.length > 0) {
            console.log(`[Debug] Running auxiliary simulations for ${enabledComponents.length} components`);
            for (const comp of enabledComponents) {
                await this.plotSingleComponentImp(comp);
            }
        }

        // 2. Groups
        const groups = window.circuit.getGroupPlots();
        const enabledGroups = groups.filter(g => g.enabled);

        if (enabledGroups.length > 0) {
            console.log(`[Debug] Running auxiliary simulations for ${enabledGroups.length} groups`);
            for (const group of enabledGroups) {
                await this.plotGroupImp(group);
            }
        }

        if (enabledComponents.length === 0 && enabledGroups.length === 0) {
            console.log('[Debug] No auxiliary simulations enabled');
        }
    }

    /**
     * Run simulation
     */
    async runSimulation(fitView = true) {
        // 1. Clear previous component overlays
        if (this.sParamGraph && this.sParamGraph.clearComponentTraces) {
            this.sParamGraph.clearComponentTraces();
        }

        // Check for parameter changes (Frequency Range)
        if (this.calculator && this.calculator.config) {
            const currentConfig = this.calculator.config;

            // Check if frequency range changed
            if (this.lastSimConfig) {
                if (this.lastSimConfig.freqStart !== currentConfig.freqStart ||
                    this.lastSimConfig.freqEnd !== currentConfig.freqEnd) {
                    fitView = true;
                }
            }

            // Update last config
            this.lastSimConfig = {
                freqStart: currentConfig.freqStart,
                freqEnd: currentConfig.freqEnd
            };
        }

        this.currentSimulationFitView = fitView;

        const btn = document.getElementById('btnSingleShot');
        if (btn) {
            btn.innerHTML = '<span class="icon">⏳</span> Running...';
            btn.disabled = true;
        }

        // Special handling for Matching Range mode
        if (this.graphSettingsController &&
            this.graphSettingsController.settings.meas === 'matchingRange') {

            try {
                // Directly trigger matching range calculation without running full frequency sweep
                this.graphSettingsController.calculateAndPlotMatchingRange();

                // If in Run Mode, we might want to ensure the graph title or other UI elements are updated
                this.graphSettingsController.updateGraphTitle();

                return;
            } catch (error) {
                console.error('Matching Range error:', error);
                if (window.notificationManager) {
                    window.notificationManager.show('매칭 범위 계산 중 오류: ' + error.message, 'error');
                }
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<span class="icon">▶</span> Single Shot';
                }
            }
            return;
        }

        try {
            const result = await this.calculator.run();
            if (!result.success && window.notificationManager) {
                window.notificationManager.show(result.error, 'error');
            } else {
                // Success! Run enabled component simulations
                await this.runAuxiliarySimulations();
            }
        } catch (error) {
            if (window.notificationManager) {
                window.notificationManager.show('시뮬레이션 중 오류가 발생했습니다: ' + error.message, 'error');
            }
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<span class="icon">▶</span> Single Shot';
            }
        }
    }

    /**
     * Show simulation result summary
     */
    showSummary(results) {
        if (!results || !results.success || !this.graphSettingsController) return;

        const currentMeas = this.graphSettingsController.settings.meas;
        const currentFormat = this.graphSettingsController.settings.format;

        const minPoint = this.calculator.findMinimum(currentMeas);

        if (minPoint) {
            const freqStr = this.formatFrequency(minPoint.frequency);
            console.log(`최소 ${currentMeas}: ${minPoint.mag_db.toFixed(2)} dB @ ${freqStr}`);

            if (this.sParamGraph) {
                this.sParamGraph.clearMarkers();

                let markerValue = minPoint.mag_db;
                if (currentFormat === 'linMag') {
                    markerValue = Math.pow(10, minPoint.mag_db / 20);
                } else if (currentFormat === 'swr') {
                    const gamma = Math.pow(10, minPoint.mag_db / 20);
                    markerValue = (1 + gamma) / (1 - gamma);
                }

                // this.sParamGraph.addMarker(minPoint.frequency, markerValue, 'Min');
            }

            if (window.notificationManager) {
                window.notificationManager.show(`최소 ${currentMeas}: ${minPoint.mag_db.toFixed(2)} dB @ ${freqStr}`, 'success');
            }
        }
    }

    formatFrequency(freq) {
        if (freq >= 1e9) {
            return (freq / 1e9).toFixed(3) + ' GHz';
        } else if (freq >= 1e6) {
            return (freq / 1e6).toFixed(3) + ' MHz';
        } else if (freq >= 1e3) {
            return (freq / 1e3).toFixed(3) + ' kHz';
        } else {
            return freq.toFixed(3) + ' Hz';
        }
    }


}
