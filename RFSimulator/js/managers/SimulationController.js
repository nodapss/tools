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

        // Note: graphSettings needs to be accessed. 
        // Ideally pass a settings object or settings manager.
        // For now, we will expect graphSettings to be available via window or passed in.
        // Let's assume window.graphSettingsController for now or pass context.
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
            this.runSimulation(false); // Preserve zoom
        }, this.RUN_MODE_DEBOUNCE_MS);
    }

    /**
     * Single Shot Execution
     */
    async runSingleShot() {
        if (this.isRunMode) {
            this.stopRunMode();
        }

        const shouldFit = this.isFirstSingleShotAfterLoad;
        await this.runSimulation(shouldFit);

        if (this.isFirstSingleShotAfterLoad) {
            if (this.sParamGraph) {
                this.sParamGraph.resetZoom();
            }
            this.isFirstSingleShotAfterLoad = false;
            console.log('Graph reset executed (First Single Shot after load)');
        }
    }

    /**
     * Run simulation
     */
    async runSimulation(fitView = true) {
        // Check for parameter changes (Frequency Range)
        if (this.calculator && this.calculator.config) {
            const currentConfig = this.calculator.config;

            // Check if frequency range changed
            if (this.lastSimConfig) {
                if (this.lastSimConfig.freqStart !== currentConfig.freqStart ||
                    this.lastSimConfig.freqEnd !== currentConfig.freqEnd) {
                    fitView = true;
                    // console.log('Frequency range changed, forcing fitView');
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

                // Simulate a "complete" for UI consistency
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<span class="icon">▶</span> Single Shot';
                }
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
