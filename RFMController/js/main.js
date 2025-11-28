(function () {
    document.addEventListener('DOMContentLoaded', () => {
        try {
            RF.ui.initSmithChart();
            RF.ui.initGraphTooltips();
            RF.ui.log('System Initialized');
            RF.modules.startMockData(); // Start generating mock data for dashboard
        } catch (e) {
            console.error(e);
            if (RF.ui && RF.ui.log) RF.ui.log('Error initializing SmithChart: ' + e.message);
        }

        // Event Listeners
        const btnRequestPort = document.getElementById('btnRequestPort');
        if (btnRequestPort) btnRequestPort.addEventListener('click', RF.core.requestPort);

        const btnConnect = document.getElementById('btnConnect');
        if (btnConnect) btnConnect.addEventListener('click', RF.core.connect);

        const btnDisconnect = document.getElementById('btnDisconnect');
        if (btnDisconnect) btnDisconnect.addEventListener('click', RF.core.disconnect);

        const btnToggleMock = document.getElementById('btnToggleMock');
        if (btnToggleMock) {
            btnToggleMock.addEventListener('click', () => {
                const enabled = RF.modules.toggleMockData();
                RF.ui.log(enabled ? 'Mock Data: ON' : 'Mock Data: OFF');
            });
        }

        const btnSend = document.getElementById('btnSend');
        if (btnSend) btnSend.addEventListener('click', sendManualCommand);

        const cmdInput = document.getElementById('cmdInput');
        if (cmdInput) {
            cmdInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') sendManualCommand();
            });
        }

        // Terminal Clear Button
        const btnClearTerminal = document.getElementById('btnClearTerminal');
        if (btnClearTerminal) {
            btnClearTerminal.addEventListener('click', () => {
                RF.ui.clearTerminal();
            });
        }

        // Terminal Copy Button
        const btnCopyTerminal = document.getElementById('btnCopyTerminal');
        if (btnCopyTerminal) {
            btnCopyTerminal.addEventListener('click', () => {
                RF.ui.copyTerminal();
            });
        }

        // Improved modal close logic - prevent closing when dragging
        function setupModalCloseHandler(modal) {
            let mouseDownTarget = null;

            modal.addEventListener('mousedown', (e) => {
                mouseDownTarget = e.target;
            });

            modal.addEventListener('mouseup', (e) => {
                // Only close if both mousedown and mouseup happened on the modal backdrop
                if (mouseDownTarget === modal && e.target === modal) {
                    modal.style.display = 'none';
                }
                mouseDownTarget = null;
            });
        }

        // Terminal Settings Button
        const btnTerminalSettings = document.getElementById('btnTerminalSettings');
        const terminalSettingsModal = document.getElementById('terminalSettingsModal');
        if (btnTerminalSettings && terminalSettingsModal) {
            btnTerminalSettings.addEventListener('click', () => {
                // Load current setting
                const maxLinesInput = document.getElementById('maxTerminalLines');
                if (maxLinesInput) {
                    maxLinesInput.value = RF.ui.getMaxTerminalLines();
                }
                terminalSettingsModal.style.display = 'flex';
            });
        }

        // Settings Modal Close Button
        const btnCloseSettings = document.getElementById('btnCloseSettings');
        if (btnCloseSettings && terminalSettingsModal) {
            btnCloseSettings.addEventListener('click', () => {
                terminalSettingsModal.style.display = 'none';
            });
        }

        // Settings Modal Cancel Button
        const btnCancelSettings = document.getElementById('btnCancelSettings');
        if (btnCancelSettings && terminalSettingsModal) {
            btnCancelSettings.addEventListener('click', () => {
                terminalSettingsModal.style.display = 'none';
            });
        }

        // Settings Modal Save Button
        const btnSaveSettings = document.getElementById('btnSaveSettings');
        if (btnSaveSettings && terminalSettingsModal) {
            btnSaveSettings.addEventListener('click', () => {
                const maxLinesInput = document.getElementById('maxTerminalLines');
                if (maxLinesInput) {
                    RF.ui.setMaxTerminalLines(maxLinesInput.value);
                    RF.ui.log('Settings Saved. Max Lines: ' + maxLinesInput.value);
                }
                terminalSettingsModal.style.display = 'none';
            });
        }

        // Close modal when clicking outside (with drag protection)
        if (terminalSettingsModal) {
            setupModalCloseHandler(terminalSettingsModal);
        }

        // Smith Chart Settings Button
        const btnSmithSettings = document.getElementById('btnSmithSettings');
        const smithSettingsModal = document.getElementById('smithSettingsModal');
        if (btnSmithSettings && smithSettingsModal) {
            btnSmithSettings.addEventListener('click', () => {
                const chart = RF.ui.getSmithChart();
                if (chart && chart.settings) {
                    const chkInput = document.getElementById('chkShowInput');
                    const chkOutput = document.getElementById('chkShowOutput');
                    const inpTrace = document.getElementById('traceLength');
                    const radioPoints = document.querySelector('input[name="traceMode"][value="points"]');
                    const radioLine = document.querySelector('input[name="traceMode"][value="line"]');

                    if (chkInput) chkInput.checked = chart.settings.showInput;
                    if (chkOutput) chkOutput.checked = chart.settings.showOutput;
                    if (inpTrace) inpTrace.value = chart.settings.traceLength;

                    if (chart.settings.traceMode === 'line') {
                        if (radioLine) radioLine.checked = true;
                    } else {
                        if (radioPoints) radioPoints.checked = true;
                    }
                }
                smithSettingsModal.style.display = 'flex';
            });
        }

        // Smith Settings Modal Close/Cancel
        const btnCloseSmithSettings = document.getElementById('btnCloseSmithSettings');
        const btnCancelSmithSettings = document.getElementById('btnCancelSmithSettings');
        if (smithSettingsModal) {
            if (btnCloseSmithSettings) {
                btnCloseSmithSettings.addEventListener('click', () => {
                    smithSettingsModal.style.display = 'none';
                });
            }
            if (btnCancelSmithSettings) {
                btnCancelSmithSettings.addEventListener('click', () => {
                    smithSettingsModal.style.display = 'none';
                });
            }
            // Close on click outside (with drag protection)
            setupModalCloseHandler(smithSettingsModal);
        }

        // Smith Settings Save
        const btnSaveSmithSettings = document.getElementById('btnSaveSmithSettings');
        if (btnSaveSmithSettings && smithSettingsModal) {
            btnSaveSmithSettings.addEventListener('click', () => {
                const chkInput = document.getElementById('chkShowInput');
                const chkOutput = document.getElementById('chkShowOutput');
                const inpTrace = document.getElementById('traceLength');
                const selectedMode = document.querySelector('input[name="traceMode"]:checked');

                const showInput = chkInput ? chkInput.checked : true;
                const showOutput = chkOutput ? chkOutput.checked : false;
                const traceLength = inpTrace ? (parseInt(inpTrace.value, 10) || 1) : 1;
                const traceMode = selectedMode ? selectedMode.value : 'points';

                RF.ui.setSmithChartSettings({
                    showInput,
                    showOutput,
                    traceLength,
                    traceMode
                });

                smithSettingsModal.style.display = 'none';
            });
        }

        // Controls Settings Button
        const btnControlsSettings = document.getElementById('btnControlsSettings');
        const controlsSettingsModal = document.getElementById('controlsSettingsModal');
        if (btnControlsSettings && controlsSettingsModal) {
            btnControlsSettings.addEventListener('click', () => {
                // Load current settings
                const impedanceRateInput = document.getElementById('impedanceStreamRate');
                const viRateInput = document.getElementById('viStreamRate');
                const motorPosRateInput = document.getElementById('motorPosStreamRate');
                const motorPosSaveRateInput = document.getElementById('motorPosSaveRate');
                const motorPosSaveEnabledInput = document.getElementById('motorPosSaveEnabled');
                const impedanceAvgCountInput = document.getElementById('impedanceAvgCount');
                const modelNameInput = document.getElementById('deviceModelName');
                const manufactureDateInput = document.getElementById('deviceManufactureDate');
                const serialNumberInput = document.getElementById('deviceSerialNumber');

                if (impedanceRateInput) impedanceRateInput.value = RF.settings.impedanceStreamRate || 100;
                if (viRateInput) viRateInput.value = RF.settings.viStreamRate || 100;
                if (motorPosRateInput) motorPosRateInput.value = RF.settings.motorPosStreamRate || 100;
                if (motorPosSaveRateInput) motorPosSaveRateInput.value = RF.settings.motorPosSaveRate || 100;
                if (motorPosSaveEnabledInput) motorPosSaveEnabledInput.checked = RF.settings.motorPosSaveEnabled !== false;
                if (impedanceAvgCountInput) impedanceAvgCountInput.value = RF.settings.impedanceAvgCount || 512;
                if (modelNameInput) modelNameInput.value = RF.settings.modelName || '';
                if (manufactureDateInput) manufactureDateInput.value = RF.settings.manufactureDate || '';
                if (serialNumberInput) serialNumberInput.value = RF.settings.serialNumber || '';
                controlsSettingsModal.style.display = 'flex';
            });
        }

        // Controls Settings Modal Close/Cancel
        const btnCloseControlsSettings = document.getElementById('btnCloseControlsSettings');
        const btnCancelControlsSettings = document.getElementById('btnCancelControlsSettings');
        if (controlsSettingsModal) {
            if (btnCloseControlsSettings) {
                btnCloseControlsSettings.addEventListener('click', () => {
                    controlsSettingsModal.style.display = 'none';
                });
            }
            if (btnCancelControlsSettings) {
                btnCancelControlsSettings.addEventListener('click', () => {
                    controlsSettingsModal.style.display = 'none';
                });
            }
            // Close on click outside (with drag protection)
            setupModalCloseHandler(controlsSettingsModal);
        }

        // Controls Settings Read
        const btnReadControlsSettings = document.getElementById('btnReadControlsSettings');
        if (btnReadControlsSettings) {
            btnReadControlsSettings.addEventListener('click', () => {
                // Send commands sequentially, waiting for each response before sending next
                RF.core.sendCommand('dgi', { waitForResponse: true }) // Device Get Info
                    .then(() => RF.core.sendCommand('rga i', { waitForResponse: true })) // RF Get Average input
                    .then(() => RF.core.sendCommand('rga o', { waitForResponse: true })) // RF Get Average output
                    .then(() => RF.core.sendCommand('msg', { waitForResponse: true })) // Motor Settings Get
                    .catch(err => {
                        RF.ui.log(`Error reading settings: ${err.message}`);
                    });
                RF.ui.log('Sent Read Commands: dgi, rga i, rga o, msg');
            });
        }

        // Controls Settings Save
        const btnSaveControlsSettings = document.getElementById('btnSaveControlsSettings');
        if (btnSaveControlsSettings && controlsSettingsModal) {
            btnSaveControlsSettings.addEventListener('click', () => {
                const impedanceRateInput = document.getElementById('impedanceStreamRate');
                const viRateInput = document.getElementById('viStreamRate');
                const motorPosRateInput = document.getElementById('motorPosStreamRate');
                const motorPosSaveRateInput = document.getElementById('motorPosSaveRate');
                const motorPosSaveEnabledInput = document.getElementById('motorPosSaveEnabled');
                const impedanceAvgCountInput = document.getElementById('impedanceAvgCount');
                const modelNameInput = document.getElementById('deviceModelName');
                const manufactureDateInput = document.getElementById('deviceManufactureDate');
                const serialNumberInput = document.getElementById('deviceSerialNumber');

                if (impedanceRateInput) {
                    RF.settings.impedanceStreamRate = parseInt(impedanceRateInput.value) || 100;
                }
                if (viRateInput) {
                    RF.settings.viStreamRate = parseInt(viRateInput.value) || 100;
                }
                if (motorPosRateInput) {
                    RF.settings.motorPosStreamRate = parseInt(motorPosRateInput.value) || 100;
                }
                if (motorPosSaveRateInput) {
                    RF.settings.motorPosSaveRate = parseInt(motorPosSaveRateInput.value) || 100;
                }
                if (motorPosSaveEnabledInput) {
                    RF.settings.motorPosSaveEnabled = motorPosSaveEnabledInput.checked;
                }
                if (impedanceAvgCountInput) {
                    RF.settings.impedanceAvgCount = parseInt(impedanceAvgCountInput.value) || 512;
                }

                if (modelNameInput) RF.settings.modelName = modelNameInput.value;
                if (manufactureDateInput) RF.settings.manufactureDate = manufactureDateInput.value;
                if (serialNumberInput) RF.settings.serialNumber = serialNumberInput.value;

                // Send commands sequentially to avoid WritableStream lock error
                let commandChain = Promise.resolve();
                
                // Send SW command first if device info exists
                if (modelNameInput && manufactureDateInput && serialNumberInput) {
                    const cmd = `dsi ${RF.settings.modelName},${RF.settings.manufactureDate},${RF.settings.serialNumber}`;
                    commandChain = RF.core.sendCommand(cmd, { waitForAck: true });
                }

                // Send average count commands after SW command completes
                if (impedanceAvgCountInput) {
                    const avgCount = RF.settings.impedanceAvgCount || 512;
                    RF.ui.log(`Sending average count: ${avgCount} to both sensors`);
                    commandChain = commandChain
                        .then(() => RF.core.sendCommand(`rsa i ${avgCount}`, { waitForAck: true }))
                        .then(() => RF.core.sendCommand(`rsa o ${avgCount}`, { waitForAck: true }))
                        .catch(err => {
                            RF.ui.log(`Error sending commands: ${err.message}`);
                        });
                }

                // Send stream settings command (all rates + save settings)
                const impRate = RF.settings.impedanceStreamRate || 100;
                const viRate = RF.settings.viStreamRate || 100;
                const posStreamRate = RF.settings.motorPosStreamRate || 100;
                const saveRate = RF.settings.motorPosSaveRate || 100;
                const saveEnabled = RF.settings.motorPosSaveEnabled ? 1 : 0;
                commandChain = commandChain
                    .then(() => RF.core.sendCommand(`mss ${impRate} ${viRate} ${posStreamRate} ${saveRate} ${saveEnabled}`, { waitForAck: true }))
                    .catch(err => {
                        RF.ui.log(`Error sending stream settings: ${err.message}`);
                    });

                RF.ui.log(`Controls Settings Saved: Imp=${RF.settings.impedanceStreamRate}ms, VI=${RF.settings.viStreamRate}ms, MotorPos=${RF.settings.motorPosStreamRate}ms, SaveRate=${RF.settings.motorPosSaveRate}ms (${RF.settings.motorPosSaveEnabled ? 'ON' : 'OFF'}), Avg=${RF.settings.impedanceAvgCount}`);
                controlsSettingsModal.style.display = 'none';
            });
        }

        // Function to load VVC settings
        function loadVvcSettings() {
            // Load VVC 1 settings
            const vvc1Settings = RF.settings.vvc1 || {};
            const vvc1CurrentInput = document.getElementById('vvc1CurrentValue');
            const vvc1PercentInput = document.getElementById('vvc1Percent');
            const vvc1MaxInput = document.getElementById('vvc1MaxValue');
            const vvc1MinInput = document.getElementById('vvc1MinValue');
            const vvc1UpperLimitInput = document.getElementById('vvc1UpperLimit');
            const vvc1LowerLimitInput = document.getElementById('vvc1LowerLimit');
            const vvc1MinCapInput = document.getElementById('vvc1MinCap');
            const vvc1MaxCapInput = document.getElementById('vvc1MaxCap');

            if (vvc1CurrentInput) vvc1CurrentInput.value = vvc1Settings.currentValue || 0;
            if (vvc1PercentInput) vvc1PercentInput.value = vvc1Settings.percent || 0;
            if (vvc1MaxInput) vvc1MaxInput.value = vvc1Settings.maxValue || 64000;
            if (vvc1MinInput) vvc1MinInput.value = vvc1Settings.minValue || 0;
            if (vvc1UpperLimitInput) vvc1UpperLimitInput.value = vvc1Settings.upperLimit || 60000;
            if (vvc1LowerLimitInput) vvc1LowerLimitInput.value = vvc1Settings.lowerLimit || 4000;
            if (vvc1MinCapInput) vvc1MinCapInput.value = vvc1Settings.minCap || 0;
            if (vvc1MaxCapInput) vvc1MaxCapInput.value = vvc1Settings.maxCap || 1000;
            
            // Load VVC 1 fitting coefficients (normalized)
            const vvc1FitCoeffs = vvc1Settings.fitCoeffs || [0, 0, 0, 0];
            const vvc1FitA0 = document.getElementById('vvc1FitA0');
            const vvc1FitA1 = document.getElementById('vvc1FitA1');
            const vvc1FitA2 = document.getElementById('vvc1FitA2');
            const vvc1FitA3 = document.getElementById('vvc1FitA3');
            if (vvc1FitA0) vvc1FitA0.value = vvc1FitCoeffs[0] || 0;
            if (vvc1FitA1) vvc1FitA1.value = vvc1FitCoeffs[1] || 0;
            if (vvc1FitA2) vvc1FitA2.value = vvc1FitCoeffs[2] || 0;
            if (vvc1FitA3) vvc1FitA3.value = vvc1FitCoeffs[3] || 0;

            // Load VVC 2 settings
            const vvc2Settings = RF.settings.vvc2 || {};
            const vvc2CurrentInput = document.getElementById('vvc2CurrentValue');
            const vvc2PercentInput = document.getElementById('vvc2Percent');
            const vvc2MaxInput = document.getElementById('vvc2MaxValue');
            const vvc2MinInput = document.getElementById('vvc2MinValue');
            const vvc2UpperLimitInput = document.getElementById('vvc2UpperLimit');
            const vvc2LowerLimitInput = document.getElementById('vvc2LowerLimit');
            const vvc2MinCapInput = document.getElementById('vvc2MinCap');
            const vvc2MaxCapInput = document.getElementById('vvc2MaxCap');

            if (vvc2CurrentInput) vvc2CurrentInput.value = vvc2Settings.currentValue || 0;
            if (vvc2PercentInput) vvc2PercentInput.value = vvc2Settings.percent || 0;
            if (vvc2MaxInput) vvc2MaxInput.value = vvc2Settings.maxValue || 64000;
            if (vvc2MinInput) vvc2MinInput.value = vvc2Settings.minValue || 0;
            if (vvc2UpperLimitInput) vvc2UpperLimitInput.value = vvc2Settings.upperLimit || 60000;
            if (vvc2LowerLimitInput) vvc2LowerLimitInput.value = vvc2Settings.lowerLimit || 4000;
            if (vvc2MinCapInput) vvc2MinCapInput.value = vvc2Settings.minCap || 0;
            if (vvc2MaxCapInput) vvc2MaxCapInput.value = vvc2Settings.maxCap || 1000;
            
            // Load VVC 2 fitting coefficients (normalized)
            const vvc2FitCoeffs = vvc2Settings.fitCoeffs || [0, 0, 0, 0];
            const vvc2FitA0 = document.getElementById('vvc2FitA0');
            const vvc2FitA1 = document.getElementById('vvc2FitA1');
            const vvc2FitA2 = document.getElementById('vvc2FitA2');
            const vvc2FitA3 = document.getElementById('vvc2FitA3');
            if (vvc2FitA0) vvc2FitA0.value = vvc2FitCoeffs[0] || 0;
            if (vvc2FitA1) vvc2FitA1.value = vvc2FitCoeffs[1] || 0;
            if (vvc2FitA2) vvc2FitA2.value = vvc2FitCoeffs[2] || 0;
            if (vvc2FitA3) vvc2FitA3.value = vvc2FitCoeffs[3] || 0;
        }
        
        // Function to calculate capacitance from position using normalized cubic polynomial
        // Uses normalized coefficients: C(xNorm) = a3*xNorm^3 + a2*xNorm^2 + a1*xNorm + a0
        // where xNorm = (step - minValue) / (maxValue - minValue)
        // xMin and xRange are derived from Motor Limits (Min/Max values)
        function calculateCapacitance(vvcKey, position) {
            const settings = RF.settings[vvcKey] || {};
            const fitCoeffs = settings.fitCoeffs || [0, 0, 0, 0]; // [a0, a1, a2, a3] - normalized coeffs
            const a0 = fitCoeffs[0] || 0;
            const a1 = fitCoeffs[1] || 0;
            const a2 = fitCoeffs[2] || 0;
            const a3 = fitCoeffs[3] || 0;
            
            // Use Motor Limits as normalization parameters
            const minValue = settings.minValue || 0;
            const maxValue = settings.maxValue || 64000;
            const xMin = minValue;
            const xRange = maxValue - minValue;
            
            // If all coefficients are zero (not calibrated), fallback to linear interpolation
            if (a0 === 0 && a1 === 0 && a2 === 0 && a3 === 0) {
                const minCap = settings.minCap || 0;
                const maxCap = settings.maxCap || 1000;
                
                if (xRange <= 0) return minCap;
                let ratio = (position - minValue) / xRange;
                if (ratio < 0) ratio = 0;
                if (ratio > 1) ratio = 1;
                return minCap + (maxCap - minCap) * ratio;
            }
            
            // Calculate normalized x: xNorm = (step - minValue) / (maxValue - minValue)
            if (xRange <= 0) return a0;
            const xNorm = (position - xMin) / xRange;
            
            // Cubic polynomial calculation with normalized x
            const capacitance = a3 * Math.pow(xNorm, 3) + a2 * Math.pow(xNorm, 2) + a1 * xNorm + a0;
            return capacitance;
        }
        
        // Function to calculate position from capacitance using Newton-Raphson method
        // Uses normalized polynomial: C(xNorm) = a3*xNorm^3 + a2*xNorm^2 + a1*xNorm + a0
        // Solves for xNorm, then converts back: step = xNorm * xRange + xMin
        // xMin and xRange are derived from Motor Limits (Min/Max values)
        function calculatePositionFromCap(vvcKey, targetCap) {
            const settings = RF.settings[vvcKey] || {};
            const fitCoeffs = settings.fitCoeffs || [0, 0, 0, 0]; // [a0, a1, a2, a3] - normalized coeffs
            const a0 = fitCoeffs[0] || 0;
            const a1 = fitCoeffs[1] || 0;
            const a2 = fitCoeffs[2] || 0;
            const a3 = fitCoeffs[3] || 0;
            
            // Use Motor Limits as normalization parameters
            const minValue = settings.minValue || 0;
            const maxValue = settings.maxValue || 64000;
            const xMin = minValue;
            const xRange = maxValue - minValue;
            const lowerLimit = settings.lowerLimit || minValue;
            const upperLimit = settings.upperLimit || maxValue;
            
            // If all coefficients are zero (not calibrated), fallback to linear interpolation
            if (a0 === 0 && a1 === 0 && a2 === 0 && a3 === 0) {
                const minCap = settings.minCap || 0;
                const maxCap = settings.maxCap || 1000;
                
                if (maxCap <= minCap) return minValue;
                let ratio = (targetCap - minCap) / (maxCap - minCap);
                if (ratio < 0) ratio = 0;
                if (ratio > 1) ratio = 1;
                return Math.round(minValue + xRange * ratio);
            }
            
            if (xRange <= 0) return minValue;
            
            // Convert limits to normalized range for Newton-Raphson
            const xNormLower = (lowerLimit - xMin) / xRange;
            const xNormUpper = (upperLimit - xMin) / xRange;
            
            // Newton-Raphson method on normalized x
            // f(xNorm) = a3*xNorm^3 + a2*xNorm^2 + a1*xNorm + a0 - targetCap = 0
            // f'(xNorm) = 3*a3*xNorm^2 + 2*a2*xNorm + a1
            let xNorm = (xNormLower + xNormUpper) / 2; // Initial guess
            const maxIterations = 20;
            const tolerance = 0.1; // pF tolerance
            
            for (let i = 0; i < maxIterations; i++) {
                const fx = a3 * Math.pow(xNorm, 3) + a2 * Math.pow(xNorm, 2) + a1 * xNorm + a0 - targetCap;
                const fpx = 3 * a3 * Math.pow(xNorm, 2) + 2 * a2 * xNorm + a1;
                
                if (Math.abs(fx) < tolerance) break;
                if (Math.abs(fpx) < 1e-10) break; // Avoid division by zero
                
                xNorm = xNorm - fx / fpx;
                
                // Clamp to valid normalized range
                if (xNorm < xNormLower) xNorm = xNormLower;
                if (xNorm > xNormUpper) xNorm = xNormUpper;
            }
            
            // Convert back to actual step position: step = xNorm * xRange + xMin
            const step = xNorm * xRange + xMin;
            return Math.round(step);
        }
        
        // Function to update Min/Max capacitance display from fitting coefficients
        function updateCapRangeFromFitting(vvcKey) {
            const settings = RF.settings[vvcKey] || {};
            const lowerLimit = settings.lowerLimit || 0;
            const upperLimit = settings.upperLimit || 64000;
            
            const minCap = calculateCapacitance(vvcKey, lowerLimit);
            const maxCap = calculateCapacitance(vvcKey, upperLimit);
            
            settings.minCap = Math.min(minCap, maxCap);
            settings.maxCap = Math.max(minCap, maxCap);
        }
        
        // Function to update VVC display based on current displayMode
        function updateVvcDisplay(vvcKey, vvcNum) {
            const settings = RF.settings[vvcKey] || {};
            const displayMode = settings.displayMode || 0;
            const position = settings.currentValue || 0;
            const percent = settings.percent || 0;
            // Use firmware-reported capacitance if available, otherwise calculate
            const capacitance = (settings.capacitance !== undefined) ? settings.capacitance : calculateCapacitance(vvcKey, position);
            
            const valueEl = document.getElementById(`vvc${vvcNum}Val`);
            if (valueEl) {
                switch (displayMode) {
                    case 0: // Percent
                        valueEl.textContent = `${percent}%`;
                        break;
                    case 1: // Position
                        valueEl.textContent = `${position}`;
                        break;
                    case 2: // Capacitance
                        valueEl.textContent = `${capacitance.toFixed(1)} pF`;
                        break;
                }
            }
        }
        
        // VVC display mode toggle on double-click
        const vvc1Val = document.getElementById('vvc1Val');
        const vvc2Val = document.getElementById('vvc2Val');
        
        if (vvc1Val) {
            vvc1Val.style.cursor = 'pointer';
            vvc1Val.addEventListener('dblclick', () => {
                if (!RF.settings.vvc1) RF.settings.vvc1 = {};
                RF.settings.vvc1.displayMode = ((RF.settings.vvc1.displayMode || 0) + 1) % 3;
                updateVvcDisplay('vvc1', 1);
                const modeNames = ['Percent', 'Position', 'Capacitance'];
                RF.ui.log(`VVC 0 display mode: ${modeNames[RF.settings.vvc1.displayMode]}`);
            });
        }
        
        if (vvc2Val) {
            vvc2Val.style.cursor = 'pointer';
            vvc2Val.addEventListener('dblclick', () => {
                if (!RF.settings.vvc2) RF.settings.vvc2 = {};
                RF.settings.vvc2.displayMode = ((RF.settings.vvc2.displayMode || 0) + 1) % 3;
                updateVvcDisplay('vvc2', 2);
                const modeNames = ['Percent', 'Position', 'Capacitance'];
                RF.ui.log(`VVC 1 display mode: ${modeNames[RF.settings.vvc2.displayMode]}`);
            });
        }
        
        // Export functions to global scope for protocol handler use
        RF.ui.updateVvcDisplay = updateVvcDisplay;
        RF.ui.calculateCapacitance = calculateCapacitance;
        RF.ui.calculatePositionFromCap = calculatePositionFromCap;
        RF.ui.updateCapRangeFromFitting = updateCapRangeFromFitting;

        // VVC Settings Button
        const btnVvcSettings = document.getElementById('btnVvcSettings');
        const vvcSettingsModal = document.getElementById('vvcSettingsModal');
        if (btnVvcSettings && vvcSettingsModal) {
            btnVvcSettings.addEventListener('click', () => {
                loadVvcSettings();
                vvcSettingsModal.style.display = 'flex';
            });
        }

        // VVC Settings Modal Close/Cancel
        const btnCloseVvcSettings = document.getElementById('btnCloseVvcSettings');
        const btnCancelVvcSettings = document.getElementById('btnCancelVvcSettings');
        if (vvcSettingsModal) {
            if (btnCloseVvcSettings) {
                btnCloseVvcSettings.addEventListener('click', () => {
                    vvcSettingsModal.style.display = 'none';
                });
            }
            if (btnCancelVvcSettings) {
                btnCancelVvcSettings.addEventListener('click', () => {
                    vvcSettingsModal.style.display = 'none';
                });
            }
            // Close on click outside (with drag protection)
            setupModalCloseHandler(vvcSettingsModal);
        }

        // VVC Settings Read Button
        const btnReadVvcSettings = document.getElementById('btnReadVvcSettings');
        if (btnReadVvcSettings) {
            btnReadVvcSettings.addEventListener('click', () => {
                // MGL commands return data, wait for each response before sending next
                // MFC commands read fitting coefficients
                // Using motorIndex: 0 for Motor0/VVC1, 1 for Motor1/VVC2
                RF.core.sendCommand('mgl 0', { waitForResponse: true })
                    .then(() => RF.core.sendCommand('mgl 1', { waitForResponse: true }))
                    .then(() => RF.core.sendCommand('mfc 0', { waitForResponse: true }))
                    .then(() => RF.core.sendCommand('mfc 1', { waitForResponse: true }))
                    .catch(err => {
                        RF.ui.log(`Error reading VVC settings: ${err.message}`);
                    });
                RF.ui.log('Sent Read Commands: mgl 0, mgl 1, mfc 0, mfc 1');
            });
        }

        // VVC Settings Save
        const btnSaveVvcSettings = document.getElementById('btnSaveVvcSettings');
        if (btnSaveVvcSettings && vvcSettingsModal) {
            btnSaveVvcSettings.addEventListener('click', () => {
                // Save VVC 1 settings (excluding Current value)
                const vvc1MaxInput = document.getElementById('vvc1MaxValue');
                const vvc1MinInput = document.getElementById('vvc1MinValue');
                const vvc1UpperLimitInput = document.getElementById('vvc1UpperLimit');
                const vvc1LowerLimitInput = document.getElementById('vvc1LowerLimit');
                const vvc1MinCapInput = document.getElementById('vvc1MinCap');
                const vvc1MaxCapInput = document.getElementById('vvc1MaxCap');

                if (!RF.settings.vvc1) {
                    RF.settings.vvc1 = {};
                }

                let vvc1Min = 0;
                let vvc1Max = 64000;
                let vvc1LowerLimit = 4000;
                let vvc1UpperLimit = 60000;

                if (vvc1MaxInput) {
                    const parsed = parseInt(vvc1MaxInput.value);
                    vvc1Max = isNaN(parsed) ? 64000 : parsed;
                    RF.settings.vvc1.maxValue = vvc1Max;
                }
                if (vvc1MinInput) {
                    const parsed = parseInt(vvc1MinInput.value);
                    vvc1Min = isNaN(parsed) ? 0 : parsed;
                    RF.settings.vvc1.minValue = vvc1Min;
                }
                if (vvc1UpperLimitInput) {
                    const parsed = parseInt(vvc1UpperLimitInput.value);
                    vvc1UpperLimit = isNaN(parsed) ? 60000 : parsed;
                    RF.settings.vvc1.upperLimit = vvc1UpperLimit;
                }
                if (vvc1LowerLimitInput) {
                    const parsed = parseInt(vvc1LowerLimitInput.value);
                    vvc1LowerLimit = isNaN(parsed) ? 4000 : parsed;
                    RF.settings.vvc1.lowerLimit = vvc1LowerLimit;
                }
                // Save VVC 1 Min/Max Cap values
                if (vvc1MinCapInput) {
                    const parsed = parseFloat(vvc1MinCapInput.value);
                    RF.settings.vvc1.minCap = isNaN(parsed) ? 0 : parsed;
                }
                if (vvc1MaxCapInput) {
                    const parsed = parseFloat(vvc1MaxCapInput.value);
                    RF.settings.vvc1.maxCap = isNaN(parsed) ? 1000 : parsed;
                }
                
                // Save VVC 1 fitting coefficients (normalized)
                const vvc1FitA0 = document.getElementById('vvc1FitA0');
                const vvc1FitA1 = document.getElementById('vvc1FitA1');
                const vvc1FitA2 = document.getElementById('vvc1FitA2');
                const vvc1FitA3 = document.getElementById('vvc1FitA3');
                
                if (!RF.settings.vvc1.fitCoeffs) RF.settings.vvc1.fitCoeffs = [0, 0, 0, 0];
                if (vvc1FitA0) RF.settings.vvc1.fitCoeffs[0] = parseFloat(vvc1FitA0.value) || 0;
                if (vvc1FitA1) RF.settings.vvc1.fitCoeffs[1] = parseFloat(vvc1FitA1.value) || 0;
                if (vvc1FitA2) RF.settings.vvc1.fitCoeffs[2] = parseFloat(vvc1FitA2.value) || 0;
                if (vvc1FitA3) RF.settings.vvc1.fitCoeffs[3] = parseFloat(vvc1FitA3.value) || 0;

                // Save VVC 2 settings (excluding Current value)
                const vvc2MaxInput = document.getElementById('vvc2MaxValue');
                const vvc2MinInput = document.getElementById('vvc2MinValue');
                const vvc2UpperLimitInput = document.getElementById('vvc2UpperLimit');
                const vvc2LowerLimitInput = document.getElementById('vvc2LowerLimit');
                const vvc2MinCapInput = document.getElementById('vvc2MinCap');
                const vvc2MaxCapInput = document.getElementById('vvc2MaxCap');

                if (!RF.settings.vvc2) {
                    RF.settings.vvc2 = {};
                }

                let vvc2Min = 0;
                let vvc2Max = 64000;
                let vvc2LowerLimit = 4000;
                let vvc2UpperLimit = 60000;

                if (vvc2MaxInput) {
                    const parsed = parseInt(vvc2MaxInput.value);
                    vvc2Max = isNaN(parsed) ? 64000 : parsed;
                    RF.settings.vvc2.maxValue = vvc2Max;
                }
                if (vvc2MinInput) {
                    const parsed = parseInt(vvc2MinInput.value);
                    vvc2Min = isNaN(parsed) ? 0 : parsed;
                    RF.settings.vvc2.minValue = vvc2Min;
                }
                if (vvc2UpperLimitInput) {
                    const parsed = parseInt(vvc2UpperLimitInput.value);
                    vvc2UpperLimit = isNaN(parsed) ? 60000 : parsed;
                    RF.settings.vvc2.upperLimit = vvc2UpperLimit;
                }
                if (vvc2LowerLimitInput) {
                    const parsed = parseInt(vvc2LowerLimitInput.value);
                    vvc2LowerLimit = isNaN(parsed) ? 4000 : parsed;
                    RF.settings.vvc2.lowerLimit = vvc2LowerLimit;
                }
                // Save VVC 2 Min/Max Cap values
                if (vvc2MinCapInput) {
                    const parsed = parseFloat(vvc2MinCapInput.value);
                    RF.settings.vvc2.minCap = isNaN(parsed) ? 0 : parsed;
                }
                if (vvc2MaxCapInput) {
                    const parsed = parseFloat(vvc2MaxCapInput.value);
                    RF.settings.vvc2.maxCap = isNaN(parsed) ? 1000 : parsed;
                }
                
                // Save VVC 2 fitting coefficients (normalized)
                const vvc2FitA0 = document.getElementById('vvc2FitA0');
                const vvc2FitA1 = document.getElementById('vvc2FitA1');
                const vvc2FitA2 = document.getElementById('vvc2FitA2');
                const vvc2FitA3 = document.getElementById('vvc2FitA3');
                
                if (!RF.settings.vvc2.fitCoeffs) RF.settings.vvc2.fitCoeffs = [0, 0, 0, 0];
                if (vvc2FitA0) RF.settings.vvc2.fitCoeffs[0] = parseFloat(vvc2FitA0.value) || 0;
                if (vvc2FitA1) RF.settings.vvc2.fitCoeffs[1] = parseFloat(vvc2FitA1.value) || 0;
                if (vvc2FitA2) RF.settings.vvc2.fitCoeffs[2] = parseFloat(vvc2FitA2.value) || 0;
                if (vvc2FitA3) RF.settings.vvc2.fitCoeffs[3] = parseFloat(vvc2FitA3.value) || 0;

                // Send commands to device (MSL = Motor Set Limits + Capacitance)
                // Format: msl [idx] min,max,lower,upper,minCap,maxCap
                // NOTE: Firmware expects pF×100 (e.g., 100.55 pF -> 10055), UI stores actual pF
                const vvc1MinCap = RF.settings.vvc1.minCap || 0;
                const vvc1MaxCap = RF.settings.vvc1.maxCap || 1000;
                const vvc2MinCap = RF.settings.vvc2.minCap || 0;
                const vvc2MaxCap = RF.settings.vvc2.maxCap || 1000;
                
                // Convert pF to pF×100 for firmware (round to nearest integer)
                const vvc1MinCapFW = Math.round(vvc1MinCap * 100);
                const vvc1MaxCapFW = Math.round(vvc1MaxCap * 100);
                const vvc2MinCapFW = Math.round(vvc2MinCap * 100);
                const vvc2MaxCapFW = Math.round(vvc2MaxCap * 100);
                
                const cmd1 = `msl 0 ${vvc1Min},${vvc1Max},${vvc1LowerLimit},${vvc1UpperLimit},${vvc1MinCapFW},${vvc1MaxCapFW}`;
                const cmd2 = `msl 1 ${vvc2Min},${vvc2Max},${vvc2LowerLimit},${vvc2UpperLimit},${vvc2MinCapFW},${vvc2MaxCapFW}`;
                
                // Build mfc commands for fitting coefficients
                // Format: mfc [idx] a0,a1,a2,a3
                // Note: xMin and xRange are derived from Motor Limits (Min/Max), not sent separately
                // Limit precision to 8 significant digits to prevent buffer overflow in firmware
                const vvc1Fit = RF.settings.vvc1.fitCoeffs || [0, 0, 0, 0];
                const vvc2Fit = RF.settings.vvc2.fitCoeffs || [0, 0, 0, 0];
                const formatCoeff = (v) => parseFloat(v || 0).toPrecision(8);
                const cmd3 = `mfc 0 ${formatCoeff(vvc1Fit[0])},${formatCoeff(vvc1Fit[1])},${formatCoeff(vvc1Fit[2])},${formatCoeff(vvc1Fit[3])}`;
                const cmd4 = `mfc 1 ${formatCoeff(vvc2Fit[0])},${formatCoeff(vvc2Fit[1])},${formatCoeff(vvc2Fit[2])},${formatCoeff(vvc2Fit[3])}`;
                
                RF.core.sendCommand(cmd1, { waitForAck: true })
                    .then(() => RF.core.sendCommand(cmd2, { waitForAck: true }))
                    .then(() => RF.core.sendCommand(cmd3, { waitForAck: true }))
                    .then(() => RF.core.sendCommand(cmd4, { waitForAck: true }))
                    .catch(err => {
                        RF.ui.log(`Error sending VVC settings: ${err.message}`);
                    });

                // Also update motor settings with same values
                if (!RF.settings.motor1) RF.settings.motor1 = {};
                RF.settings.motor1.minValue = vvc1Min;
                RF.settings.motor1.maxValue = vvc1Max;
                RF.settings.motor1.lowerLimit = vvc1LowerLimit;
                RF.settings.motor1.upperLimit = vvc1UpperLimit;

                if (!RF.settings.motor2) RF.settings.motor2 = {};
                RF.settings.motor2.minValue = vvc2Min;
                RF.settings.motor2.maxValue = vvc2Max;
                RF.settings.motor2.lowerLimit = vvc2LowerLimit;
                RF.settings.motor2.upperLimit = vvc2UpperLimit;

                const vvc1 = RF.settings.vvc1;
                const vvc2 = RF.settings.vvc2;
                RF.ui.log(`VVC Settings Saved - VVC0: [${vvc1.minValue}~${vvc1.maxValue}], Cap=[${vvc1MinCap}~${vvc1MaxCap}pF] | VVC1: [${vvc2.minValue}~${vvc2.maxValue}], Cap=[${vvc2MinCap}~${vvc2MaxCap}pF]`);
                RF.ui.log(`VVC0 Fit: a0=${vvc1Fit[0]}, a1=${vvc1Fit[1]}, a2=${vvc1Fit[2]}, a3=${vvc1Fit[3]}`);
                RF.ui.log(`VVC1 Fit: a0=${vvc2Fit[0]}, a1=${vvc2Fit[1]}, a2=${vvc2Fit[2]}, a3=${vvc2Fit[3]}`);
                RF.ui.log(`Sent Commands: ${cmd1}, ${cmd2}, ${cmd3}, ${cmd4}`);
                vvcSettingsModal.style.display = 'none';
            });
        }

        // Function to load Motor Driver settings (DRV8711 SPI registers)
        function loadMotorDriverSettings() {
            // Load Motor 1 driver settings
            const motor1Drv = RF.settings.motor1Drv || {};
            document.getElementById('motor1StandbyVal').value = motor1Drv.standbyVal || 553;
            document.getElementById('motor1DisableVal').value = motor1Drv.disableVal || 552;
            document.getElementById('motor1RegCtrl').value = motor1Drv.regCtrl || 552;
            document.getElementById('motor1RegTorque').value = motor1Drv.regTorque || 384;
            document.getElementById('motor1RegOff').value = motor1Drv.regOff || 15;
            document.getElementById('motor1RegBlank').value = motor1Drv.regBlank || 336;
            document.getElementById('motor1RegDecay').value = motor1Drv.regDecay || 508;
            document.getElementById('motor1RegStall').value = motor1Drv.regStall || 1200;
            document.getElementById('motor1RegDrive').value = motor1Drv.regDrive || 5;

            // Load Motor 2 driver settings
            const motor2Drv = RF.settings.motor2Drv || {};
            document.getElementById('motor2StandbyVal').value = motor2Drv.standbyVal || 553;
            document.getElementById('motor2DisableVal').value = motor2Drv.disableVal || 552;
            document.getElementById('motor2RegCtrl').value = motor2Drv.regCtrl || 552;
            document.getElementById('motor2RegTorque').value = motor2Drv.regTorque || 384;
            document.getElementById('motor2RegOff').value = motor2Drv.regOff || 15;
            document.getElementById('motor2RegBlank').value = motor2Drv.regBlank || 336;
            document.getElementById('motor2RegDecay').value = motor2Drv.regDecay || 508;
            document.getElementById('motor2RegStall').value = motor2Drv.regStall || 1200;
            document.getElementById('motor2RegDrive').value = motor2Drv.regDrive || 5;
        }

        // Motor Settings Button
        const btnMotorSettings = document.getElementById('btnMotorSettings');
        const motorSettingsModal = document.getElementById('motorSettingsModal');
        if (btnMotorSettings && motorSettingsModal) {
            btnMotorSettings.addEventListener('click', () => {
                loadMotorDriverSettings();
                motorSettingsModal.style.display = 'flex';
            });
        }

        // Motor Settings Modal Close/Cancel
        const btnCloseMotorSettings = document.getElementById('btnCloseMotorSettings');
        const btnCancelMotorSettings = document.getElementById('btnCancelMotorSettings');
        if (motorSettingsModal) {
            if (btnCloseMotorSettings) {
                btnCloseMotorSettings.addEventListener('click', () => {
                    motorSettingsModal.style.display = 'none';
                });
            }
            if (btnCancelMotorSettings) {
                btnCancelMotorSettings.addEventListener('click', () => {
                    motorSettingsModal.style.display = 'none';
                });
            }
            // Close on click outside (with drag protection)
            setupModalCloseHandler(motorSettingsModal);
        }

        // Motor 1 Read Status Button
        const btnReadStatus1 = document.getElementById('btnReadStatus1');
        if (btnReadStatus1) {
            btnReadStatus1.addEventListener('click', () => {
                RF.core.sendCommand('mgs 0');
                RF.ui.log('Reading Motor 0 status registers...');
            });
        }

        // Motor 1 Read Status Button
        const btnReadStatus2 = document.getElementById('btnReadStatus2');
        if (btnReadStatus2) {
            btnReadStatus2.addEventListener('click', () => {
                RF.core.sendCommand('mgs 1');
                RF.ui.log('Reading Motor 1 status registers...');
            });
        }

        // Motor Settings Save Button
        const btnSaveMotorSettings = document.getElementById('btnSaveMotorSettings');
        if (btnSaveMotorSettings && motorSettingsModal) {
            btnSaveMotorSettings.addEventListener('click', () => {
                // Save Motor 1 driver settings to RF.settings
                if (!RF.settings.motor1Drv) RF.settings.motor1Drv = {};
                RF.settings.motor1Drv.standbyVal = parseInt(document.getElementById('motor1StandbyVal').value) || 553;
                RF.settings.motor1Drv.disableVal = parseInt(document.getElementById('motor1DisableVal').value) || 552;
                RF.settings.motor1Drv.regCtrl = parseInt(document.getElementById('motor1RegCtrl').value) || 552;
                RF.settings.motor1Drv.regTorque = parseInt(document.getElementById('motor1RegTorque').value) || 384;
                RF.settings.motor1Drv.regOff = parseInt(document.getElementById('motor1RegOff').value) || 15;
                RF.settings.motor1Drv.regBlank = parseInt(document.getElementById('motor1RegBlank').value) || 336;
                RF.settings.motor1Drv.regDecay = parseInt(document.getElementById('motor1RegDecay').value) || 508;
                RF.settings.motor1Drv.regStall = parseInt(document.getElementById('motor1RegStall').value) || 1200;
                RF.settings.motor1Drv.regDrive = parseInt(document.getElementById('motor1RegDrive').value) || 5;

                // Save Motor 2 driver settings to RF.settings
                if (!RF.settings.motor2Drv) RF.settings.motor2Drv = {};
                RF.settings.motor2Drv.standbyVal = parseInt(document.getElementById('motor2StandbyVal').value) || 553;
                RF.settings.motor2Drv.disableVal = parseInt(document.getElementById('motor2DisableVal').value) || 552;
                RF.settings.motor2Drv.regCtrl = parseInt(document.getElementById('motor2RegCtrl').value) || 552;
                RF.settings.motor2Drv.regTorque = parseInt(document.getElementById('motor2RegTorque').value) || 384;
                RF.settings.motor2Drv.regOff = parseInt(document.getElementById('motor2RegOff').value) || 15;
                RF.settings.motor2Drv.regBlank = parseInt(document.getElementById('motor2RegBlank').value) || 336;
                RF.settings.motor2Drv.regDecay = parseInt(document.getElementById('motor2RegDecay').value) || 508;
                RF.settings.motor2Drv.regStall = parseInt(document.getElementById('motor2RegStall').value) || 1200;
                RF.settings.motor2Drv.regDrive = parseInt(document.getElementById('motor2RegDrive').value) || 5;

                // Send MSD (Motor Set Driver) command to firmware
                // Format: msd <idx> <standby>,<disable>,<ctrl>,<torque>,<off>,<blank>,<decay>,<stall>,<drive>
                const m1 = RF.settings.motor1Drv;
                const m2 = RF.settings.motor2Drv;
                const cmd1 = `msd 0 ${m1.standbyVal},${m1.disableVal},${m1.regCtrl},${m1.regTorque},${m1.regOff},${m1.regBlank},${m1.regDecay},${m1.regStall},${m1.regDrive}`;
                const cmd2 = `msd 1 ${m2.standbyVal},${m2.disableVal},${m2.regCtrl},${m2.regTorque},${m2.regOff},${m2.regBlank},${m2.regDecay},${m2.regStall},${m2.regDrive}`;
                
                RF.core.sendCommand(cmd1, { waitForAck: true })
                    .then(() => RF.core.sendCommand(cmd2, { waitForAck: true }))
                    .catch(err => {
                        RF.ui.log(`Error saving motor driver settings: ${err.message}`);
                    });

                RF.ui.log(`Motor Driver Settings Saved`);
                RF.ui.log(`  M1: Standby=${m1.standbyVal}, Disable=${m1.disableVal}, Regs=[${m1.regCtrl},${m1.regTorque},${m1.regOff},${m1.regBlank},${m1.regDecay},${m1.regStall},${m1.regDrive}]`);
                RF.ui.log(`  M2: Standby=${m2.standbyVal}, Disable=${m2.disableVal}, Regs=[${m2.regCtrl},${m2.regTorque},${m2.regOff},${m2.regBlank},${m2.regDecay},${m2.regStall},${m2.regDrive}]`);
                motorSettingsModal.style.display = 'none';
            });
        }

        // Command Buttons
        document.querySelectorAll('.cmd-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const cmd = btn.dataset.cmd;
                if (cmd) RF.core.sendCommand(cmd);
            });
        });

        // Dynamic Command Buttons
        document.querySelectorAll('.cmd-btn-dynamic').forEach(btn => {
            btn.addEventListener('click', () => {
                let cmd = btn.dataset.template;
                if (btn.dataset.input) {
                    const valInput = document.getElementById(btn.dataset.input);
                    if (valInput) {
                        const val = valInput.value;
                        cmd = cmd.replace('{val}', val);
                    }
                }
                if (btn.dataset.select) {
                    const valSelect = document.getElementById(btn.dataset.select);
                    if (valSelect) {
                        const val = valSelect.value;
                        cmd = cmd.replace('{sel}', val);
                    }
                }
                RF.core.sendCommand(cmd);
            });
        });

        // Motor Force Move Button (MRF command - bypasses limit checking)
        const btnMotorForce = document.getElementById('btnMotorForce');
        if (btnMotorForce) {
            btnMotorForce.addEventListener('click', () => {
                const motorSelect = document.getElementById('motorForceSelect');
                const posInput = document.getElementById('motorForcePos');
                if (motorSelect && posInput) {
                    const motor = motorSelect.value;
                    const position = posInput.value;
                    // Confirm before force move
                    if (confirm(`WARNING: Force move M${motor} to ${position}?\nThis bypasses limit checking and may damage equipment!`)) {
                        RF.core.sendCommand(`mf ${motor} ${position}`);
                        RF.ui.log(`Force move: M${motor} -> ${position} (limits bypassed)`);
                    }
                }
            });
        }

        // Motor Move Button (with limit clamping and field update)
        const btnMotorMove = document.getElementById('btnMotorMove');
        if (btnMotorMove) {
            btnMotorMove.addEventListener('click', () => {
                const motorSelect = document.getElementById('motorSelect');
                const posInput = document.getElementById('motorPos');
                if (motorSelect && posInput) {
                    const motor = parseInt(motorSelect.value);
                    let position = parseInt(posInput.value);
                    
                    // Get motor limits (motor 0 = vvc1, motor 1 = vvc2)
                    const settings = motor === 0 ? RF.settings.vvc1 : RF.settings.vvc2;
                    const lowerLimit = settings?.lowerLimit ?? 0;
                    const upperLimit = settings?.upperLimit ?? 64000;
                    
                    // Clamp position to limits and update field if needed
                    let clampedPosition = position;
                    if (position < lowerLimit) {
                        clampedPosition = lowerLimit;
                        posInput.value = clampedPosition;
                        RF.ui.log(`Position clamped to lower limit: ${clampedPosition}`);
                    } else if (position > upperLimit) {
                        clampedPosition = upperLimit;
                        posInput.value = clampedPosition;
                        RF.ui.log(`Position clamped to upper limit: ${clampedPosition}`);
                    }
                    
                    RF.core.sendCommand(`mr ${motor} ${clampedPosition}`);
                    RF.ui.log(`Move: M${motor} -> ${clampedPosition}`);
                }
            });
        }

        // Set Origin Buttons (with confirmation)
        document.querySelectorAll('.origin-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const motor = btn.dataset.motor;
                if (confirm(`WARNING: Set M${motor} origin to current position?\nThis will reset the motor's reference point!`)) {
                    RF.core.sendCommand(`mo ${motor}`);
                    RF.ui.log(`Set Origin: M${motor}`);
                }
            });
        });

        // Motor Position Run Button (streams both motors position)
        const btnMotorPosRun = document.getElementById('btnMotorPosRun');
        if (btnMotorPosRun) {
            btnMotorPosRun.addEventListener('click', function () {
                const isActive = this.classList.contains('active');
                const rate = RF.settings.motorPosStreamRate || 100;
                if (isActive) {
                    RF.core.sendCommand('mrp stop');
                    RF.ui.log('Motor Position Stream: STOP');
                } else {
                    RF.core.sendCommand(`mrp run ${rate}`);
                    RF.ui.log(`Motor Position Stream: RUN @ ${rate}ms`);
                }
                this.classList.toggle('active');
                this.textContent = isActive ? 'Run' : 'Stop';
            });
        }

        // Motor Driver Buttons (Init, Standby, Disable - use configured register values)
        // motorNum is now 0-based index (0 or 1)
        document.querySelectorAll('.motor-drv-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const motorIdx = btn.dataset.motor; // "0" or "1"
                const action = btn.dataset.action;  // "init", "standby", "disable"
                
                // Get driver settings for this motor (motor0Drv or motor1Drv)
                // Settings use 1-based naming internally
                const settingsKey = motorIdx === "0" ? "motor1Drv" : "motor2Drv";
                const drvSettings = RF.settings[settingsKey] || {
                    standbyVal: 553,
                    disableVal: 552
                };
                
                let cmd = '';
                switch (action) {
                    case 'init':
                        cmd = `mi ${motorIdx}`;
                        RF.ui.log(`Motor ${motorIdx}: Initialize (using configured registers)`);
                        break;
                    case 'standby':
                        cmd = `msc ${motorIdx} ${drvSettings.standbyVal}`;
                        RF.ui.log(`Motor ${motorIdx}: Standby (CTRL=${drvSettings.standbyVal})`);
                        break;
                    case 'disable':
                        cmd = `msc ${motorIdx} ${drvSettings.disableVal}`;
                        RF.ui.log(`Motor ${motorIdx}: Disable (CTRL=${drvSettings.disableVal})`);
                        break;
                }
                
                if (cmd) {
                    RF.core.sendCommand(cmd);
                }
            });
        });

        // ===== RF Sensor Controls =====

        // Input Sensor - Impedance Single Shot
        const btnImpSingleInput = document.getElementById('btnImpSingleInput');
        if (btnImpSingleInput) {
            btnImpSingleInput.addEventListener('click', () => {
                RF.ui.sendSensorCommand('rz', 'input', '10');
            });
        }

        // Input Sensor - Impedance Run/Stop (with refresh rate)
        const btnImpRunInput = document.getElementById('btnImpRunInput');
        if (btnImpRunInput) {
            btnImpRunInput.addEventListener('click', function () {
                const isActive = this.classList.contains('active');
                const rate = RF.settings.impedanceStreamRate || 100;
                RF.ui.sendSensorCommand('rs', 'input', isActive ? 'stop' : `run ${rate}`);
                this.classList.toggle('active');
                this.textContent = isActive ? 'Run' : 'Stop';
            });
        }

        // Input Sensor - Get FFT
        const btnFftInput = document.getElementById('btnFftInput');
        if (btnFftInput) {
            btnFftInput.addEventListener('click', () => {
                RF.ui.sendSensorCommand('rf', 'input');
                RF.ui.switchToFFTMode();
            });
        }

        // Input Sensor - V/I Stream Run/Stop (with refresh rate)
        const btnVIRunInput = document.getElementById('btnVIRunInput');
        if (btnVIRunInput) {
            btnVIRunInput.addEventListener('click', function () {
                const isActive = this.classList.contains('active');
                const rate = RF.settings.viStreamRate || 100;
                RF.ui.sendSensorCommand('rt', 'input', isActive ? 'stop' : `run ${rate}`);
                this.classList.toggle('active');
                this.textContent = isActive ? 'Run' : 'Stop';
                if (!isActive) RF.ui.switchToTimeMode();
            });
        }

        // Input Sensor - Calibration V/I/P
        const btnSetCalVInput = document.getElementById('btnSetCalVInput');
        if (btnSetCalVInput) {
            btnSetCalVInput.addEventListener('click', () => {
                const val = document.getElementById('calVInput').value;
                RF.ui.sendSensorCommand('rc', 'input', 'v', val);
            });
        }

        const btnSetCalIInput = document.getElementById('btnSetCalIInput');
        if (btnSetCalIInput) {
            btnSetCalIInput.addEventListener('click', () => {
                const val = document.getElementById('calIInput').value;
                RF.ui.sendSensorCommand('rc', 'input', 'i', val);
            });
        }

        const btnSetCalPInput = document.getElementById('btnSetCalPInput');
        if (btnSetCalPInput) {
            btnSetCalPInput.addEventListener('click', () => {
                const val = document.getElementById('calPInput').value;
                RF.ui.sendSensorCommand('rc', 'input', 'p', val);
            });
        }

        // Input Sensor - AC/DC Coupling
        const btnCouplingInput = document.getElementById('btnCouplingInput');
        if (btnCouplingInput) {
            btnCouplingInput.addEventListener('click', function () {
                const isAC = this.textContent === 'AC';
                RF.ui.sendSensorCommand('rk', 'input', isAC ? 'dc' : 'ac');
                this.textContent = isAC ? 'DC' : 'AC';
            });
        }

        // Input Sensor - Reset
        const btnResetInput = document.getElementById('btnResetInput');
        if (btnResetInput) {
            btnResetInput.addEventListener('click', () => {
                RF.ui.sendSensorCommand('rr', 'input');
                // Reset UI values
                document.getElementById('calVInput').value = '1.0';
                document.getElementById('calIInput').value = '1.0';
                document.getElementById('calPInput').value = '0.0';
                const coupling = document.getElementById('btnCouplingInput');
                if (coupling) coupling.textContent = 'AC';
            });
        }

        // Output Sensor - Impedance Single Shot
        const btnImpSingleOutput = document.getElementById('btnImpSingleOutput');
        if (btnImpSingleOutput) {
            btnImpSingleOutput.addEventListener('click', () => {
                RF.ui.sendSensorCommand('rz', 'output', '10');
            });
        }

        // Output Sensor - Impedance Run/Stop (with refresh rate)
        const btnImpRunOutput = document.getElementById('btnImpRunOutput');
        if (btnImpRunOutput) {
            btnImpRunOutput.addEventListener('click', function () {
                const isActive = this.classList.contains('active');
                const rate = RF.settings.impedanceStreamRate || 100;
                RF.ui.sendSensorCommand('rs', 'output', isActive ? 'stop' : `run ${rate}`);
                this.classList.toggle('active');
                this.textContent = isActive ? 'Run' : 'Stop';
            });
        }

        //  Output Sensor - Get FFT
        const btnFftOutput = document.getElementById('btnFftOutput');
        if (btnFftOutput) {
            btnFftOutput.addEventListener('click', () => {
                RF.ui.sendSensorCommand('rf', 'output');
                RF.ui.switchToFFTMode();
            });
        }

        // Output Sensor - V/I Stream Run/Stop (with refresh rate)
        const btnVIRunOutput = document.getElementById('btnVIRunOutput');
        if (btnVIRunOutput) {
            btnVIRunOutput.addEventListener('click', function () {
                const isActive = this.classList.contains('active');
                const rate = RF.settings.viStreamRate || 100;
                RF.ui.sendSensorCommand('rt', 'output', isActive ? 'stop' : `run ${rate}`);
                this.classList.toggle('active');
                this.textContent = isActive ? 'Run' : 'Stop';
                if (!isActive) RF.ui.switchToTimeMode();
            });
        }

        // Output Sensor - Calibration V/I/P
        const btnSetCalVOutput = document.getElementById('btnSetCalVOutput');
        if (btnSetCalVOutput) {
            btnSetCalVOutput.addEventListener('click', () => {
                const val = document.getElementById('calVOutput').value;
                RF.ui.sendSensorCommand('rc', 'output', 'v', val);
            });
        }

        const btnSetCalIOutput = document.getElementById('btnSetCalIOutput');
        if (btnSetCalIOutput) {
            btnSetCalIOutput.addEventListener('click', () => {
                const val = document.getElementById('calIOutput').value;
                RF.ui.sendSensorCommand('rc', 'output', 'i', val);
            });
        }

        const btnSetCalPOutput = document.getElementById('btnSetCalPOutput');
        if (btnSetCalPOutput) {
            btnSetCalPOutput.addEventListener('click', () => {
                const val = document.getElementById('calPOutput').value;
                RF.ui.sendSensorCommand('rc', 'output', 'p', val);
            });
        }

        // Output Sensor - AC/DC Coupling
        const btnCouplingOutput = document.getElementById('btnCouplingOutput');
        if (btnCouplingOutput) {
            btnCouplingOutput.addEventListener('click', function () {
                const isAC = this.textContent === 'AC';
                RF.ui.sendSensorCommand('rk', 'output', isAC ? 'dc' : 'ac');
                this.textContent = isAC ? 'DC' : 'AC';
            });
        }

        // Output Sensor - Reset
        const btnResetOutput = document.getElementById('btnResetOutput');
        if (btnResetOutput) {
            btnResetOutput.addEventListener('click', () => {
                RF.ui.sendSensorCommand('rr', 'output');
                // Reset UI values
                document.getElementById('calVOutput').value = '1.0';
                document.getElementById('calIOutput').value = '1.0';
                document.getElementById('calPOutput').value = '0.0';
                const coupling = document.getElementById('btnCouplingOutput');
                if (coupling) coupling.textContent = 'AC';
            });
        }

        // Toggle Data Panel (Time Domain <-> FFT)
        const btnToggleData = document.getElementById('btnToggleData');
        let showingTimeDomain = true;
        if (btnToggleData) {
            btnToggleData.addEventListener('click', () => {
                const rfGraphInput = document.getElementById('rfGraphInput');
                const rfGraphOutput = document.getElementById('rfGraphOutput');
                const fftGraphInput = document.getElementById('fftGraphInput');
                const fftGraphOutput = document.getElementById('fftGraphOutput');
                const title = document.getElementById('dataPanelTitle');

                if (showingTimeDomain) {
                    // Switch to FFT
                    if (rfGraphInput) rfGraphInput.style.display = 'none';
                    if (rfGraphOutput) rfGraphOutput.style.display = 'none';
                    if (fftGraphInput) fftGraphInput.style.display = 'block';
                    if (fftGraphOutput) fftGraphOutput.style.display = 'block';
                    if (title) title.textContent = 'Frequency Domain (FFT)';
                    btnToggleData.textContent = '↔ Time';
                } else {
                    // Switch to Time Domain
                    if (rfGraphInput) rfGraphInput.style.display = 'block';
                    if (rfGraphOutput) rfGraphOutput.style.display = 'block';
                    if (fftGraphInput) fftGraphInput.style.display = 'none';
                    if (fftGraphOutput) fftGraphOutput.style.display = 'none';
                    if (title) title.textContent = 'Time Domain';
                    btnToggleData.textContent = '↔ FFT';
                }
                showingTimeDomain = !showingTimeDomain;
            });
        }

        // FFT Settings Modal
        const btnFftSettings = document.getElementById('btnFftSettings');
        const fftSettingsModal = document.getElementById('fftSettingsModal');
        
        // Helper function to update input disabled state based on auto-scale checkbox
        function updateFftInputDisabledState(sensor) {
            const autoScale = document.getElementById(`fftAutoScale${sensor}`);
            const yMin = document.getElementById(`fftYMin${sensor}`);
            const yMax = document.getElementById(`fftYMax${sensor}`);
            
            if (autoScale && yMin && yMax) {
                const disabled = autoScale.checked;
                yMin.disabled = disabled;
                yMax.disabled = disabled;
            }
        }
        
        if (btnFftSettings && fftSettingsModal) {
            btnFftSettings.addEventListener('click', () => {
                // Load current settings into modal
                const settings = RF.ui.getFftSettings();
                
                // Input sensor
                document.getElementById('fftAutoScaleInput').checked = settings.input.autoScale;
                document.getElementById('fftIndependentAxisInput').checked = settings.input.independentAxis !== false;
                document.getElementById('fftMarginInput').value = settings.input.margin;
                document.getElementById('fftYMinInput').value = settings.input.yMin;
                document.getElementById('fftYMaxInput').value = settings.input.yMax;
                document.getElementById('fftVOffsetInput').value = settings.input.vOffset || 0;
                document.getElementById('fftIOffsetInput').value = settings.input.iOffset || 0;
                document.getElementById('fftSamplingRateInput').value = settings.input.samplingRate;
                document.getElementById('fftLengthInput').value = settings.input.fftLength;
                document.getElementById('fftXAxisDisplayInput').value = settings.input.xAxisDisplay || 'physical';
                
                // Output sensor
                document.getElementById('fftAutoScaleOutput').checked = settings.output.autoScale;
                document.getElementById('fftIndependentAxisOutput').checked = settings.output.independentAxis !== false;
                document.getElementById('fftMarginOutput').value = settings.output.margin;
                document.getElementById('fftYMinOutput').value = settings.output.yMin;
                document.getElementById('fftYMaxOutput').value = settings.output.yMax;
                document.getElementById('fftVOffsetOutput').value = settings.output.vOffset || 0;
                document.getElementById('fftIOffsetOutput').value = settings.output.iOffset || 0;
                document.getElementById('fftSamplingRateOutput').value = settings.output.samplingRate;
                document.getElementById('fftLengthOutput').value = settings.output.fftLength;
                document.getElementById('fftXAxisDisplayOutput').value = settings.output.xAxisDisplay || 'physical';
                
                // Update disabled states
                updateFftInputDisabledState('Input');
                updateFftInputDisabledState('Output');
                
                fftSettingsModal.style.display = 'flex';
            });
            
            // Auto-scale checkbox change handlers
            const autoScaleInput = document.getElementById('fftAutoScaleInput');
            const autoScaleOutput = document.getElementById('fftAutoScaleOutput');
            
            if (autoScaleInput) {
                autoScaleInput.addEventListener('change', () => updateFftInputDisabledState('Input'));
            }
            if (autoScaleOutput) {
                autoScaleOutput.addEventListener('change', () => updateFftInputDisabledState('Output'));
            }
            
            // Close/Cancel buttons
            const btnCloseFftSettings = document.getElementById('btnCloseFftSettings');
            const btnCancelFftSettings = document.getElementById('btnCancelFftSettings');
            
            if (btnCloseFftSettings) {
                btnCloseFftSettings.addEventListener('click', () => {
                    fftSettingsModal.style.display = 'none';
                });
            }
            if (btnCancelFftSettings) {
                btnCancelFftSettings.addEventListener('click', () => {
                    fftSettingsModal.style.display = 'none';
                });
            }
            
            // Save button
            const btnSaveFftSettings = document.getElementById('btnSaveFftSettings');
            if (btnSaveFftSettings) {
                btnSaveFftSettings.addEventListener('click', () => {
                    // Save Input sensor settings
                    RF.ui.setFftSettings('input', {
                        autoScale: document.getElementById('fftAutoScaleInput').checked,
                        independentAxis: document.getElementById('fftIndependentAxisInput').checked,
                        margin: parseFloat(document.getElementById('fftMarginInput').value) || 10,
                        yMin: parseFloat(document.getElementById('fftYMinInput').value) || 0,
                        yMax: parseFloat(document.getElementById('fftYMaxInput').value) || 100,
                        vOffset: parseFloat(document.getElementById('fftVOffsetInput').value) || 0,
                        iOffset: parseFloat(document.getElementById('fftIOffsetInput').value) || 0,
                        samplingRate: parseFloat(document.getElementById('fftSamplingRateInput').value) || 100000000,
                        fftLength: parseInt(document.getElementById('fftLengthInput').value) || 1024,
                        xAxisDisplay: document.getElementById('fftXAxisDisplayInput').value || 'physical'
                    });
                    
                    // Save Output sensor settings
                    RF.ui.setFftSettings('output', {
                        autoScale: document.getElementById('fftAutoScaleOutput').checked,
                        independentAxis: document.getElementById('fftIndependentAxisOutput').checked,
                        margin: parseFloat(document.getElementById('fftMarginOutput').value) || 10,
                        yMin: parseFloat(document.getElementById('fftYMinOutput').value) || 0,
                        yMax: parseFloat(document.getElementById('fftYMaxOutput').value) || 100,
                        vOffset: parseFloat(document.getElementById('fftVOffsetOutput').value) || 0,
                        iOffset: parseFloat(document.getElementById('fftIOffsetOutput').value) || 0,
                        samplingRate: parseFloat(document.getElementById('fftSamplingRateOutput').value) || 100000000,
                        fftLength: parseInt(document.getElementById('fftLengthOutput').value) || 1024,
                        xAxisDisplay: document.getElementById('fftXAxisDisplayOutput').value || 'physical'
                    });
                    
                    RF.ui.log('FFT/Graph settings saved');
                    fftSettingsModal.style.display = 'none';
                });
            }
            
            // Close modal when clicking outside
            setupModalCloseHandler(fftSettingsModal);
        }

        // Resize Observer for Graphs
        window.addEventListener('resize', () => {
            RF.ui.resizeGraphs();
        });

        // Initial Resize
        setTimeout(RF.ui.resizeGraphs, 100);
    });

    function sendManualCommand() {
        const input = document.getElementById('cmdInput');
        if (!input) return;
        RF.core.sendCommand(input.value);
        input.value = '';
    }
})();
