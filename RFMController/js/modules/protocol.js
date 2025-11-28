(function () {
    let buffer = '';

    // OpCode configuration (embedded to avoid CORS issues with file:// protocol)
    const opcodeRegistry = {
        "opcodes": {
            "ZI": {
                "name": "Input Impedance",
                "description": "Input sensor impedance measurement",
                "fields": ["magnitude", "phase"],
                "handler": "handleInputImpedance"
            },
            "ZO": {
                "name": "Output Impedance",
                "description": "Output sensor impedance measurement",
                "fields": ["magnitude", "phase"],
                "handler": "handleOutputImpedance"
            },
            "FI": {
                "name": "FFT Input",
                "description": "FFT magnitude data for input sensor",
                "fields": ["*array"],
                "handler": "handleFftInput"
            },
            "FO": {
                "name": "FFT Output",
                "description": "FFT magnitude data for output sensor (Voltage)",
                "fields": ["*array"],
                "handler": "handleFftOutput"
            },
            "CI": {
                "name": "FFT Current Input",
                "description": "FFT magnitude data for input sensor (Current)",
                "fields": ["*array"],
                "handler": "handleFftCurrentInput"
            },
            "CO": {
                "name": "FFT Current Output",
                "description": "FFT magnitude data for output sensor (Current)",
                "fields": ["*array"],
                "handler": "handleFftCurrentOutput"
            },
            "VI": {
                "name": "V/I Magnitude Input",
                "description": "Voltage and current magnitude for input sensor",
                "fields": ["voltage", "current"],
                "handler": "handleVIMagInput"
            },
            "VO": {
                "name": "V/I Magnitude Output",
                "description": "Voltage and current magnitude for output sensor",
                "fields": ["voltage", "current"],
                "handler": "handleVIMagOutput"
            },
            "ACK": {
                "name": "Acknowledgment",
                "description": "Command acknowledgment with status",
                "fields": ["command", "status"],
                "handler": "handleAck"
            },
            "FT": {
                "name": "FFT Data",
                "description": "Fourier transform frequency domain data",
                "fields": ["*array"],
                "handler": "handleFftData"
            },
            "RT": {
                "name": "Raw Time Data",
                "description": "Time domain raw sensor data",
                "fields": ["*array"],
                "handler": "handleRawTimeData"
            },
            "RGC": {
                "name": "RF Get Calibration",
                "description": "Calibration values for sensor",
                "fields": ["channel", "v_gain", "i_gain", "phase_deg"],
                "handler": "handleGetCalibration"
            },
            "DGI": {
                "name": "Device Get Info",
                "description": "Device information (Model, Date, Serial)",
                "fields": ["model", "date", "serial"],
                "handler": "handleDeviceGetInfo"
            },
            "MGL": {
                "name": "Motor Get Limits",
                "description": "Motor limits with capacitance (motorIndex, min, max, lower, upper, minCap, maxCap, pos, percent, cap)",
                "fields": ["motorIndex", "min", "max", "lowerLimit", "upperLimit", "minCap", "maxCap", "position", "percent", "capacitance"],
                "handler": "handleGetMotorLimits"
            },
            "MGP": {
                "name": "Motor Get Position",
                "description": "Motor position and percentage (motorIndex, position, percent)",
                "fields": ["motorIndex", "position", "percent"],
                "handler": "handleMotorPosition"
            },
            "RGA": {
                "name": "RF Get Average",
                "description": "Average count for sensor measurements",
                "fields": ["channel", "count"],
                "handler": "handleGetAverageCount"
            },
            "MGS": {
                "name": "Motor Get Status",
                "description": "Motor driver status registers (8 registers)",
                "fields": ["idx", "reg0", "reg1", "reg2", "reg3", "reg4", "reg5", "reg6", "reg7"],
                "handler": "handleMotorStatus"
            },
            "MPB": {
                "name": "Motor Position Both",
                "description": "Both motors position, percentage, and capacitance",
                "fields": ["pos0", "percent0", "cap0", "pos1", "percent1", "cap1"],
                "handler": "handleMotorPositionBoth"
            },
            "MST": {
                "name": "Motor Settings",
                "description": "Motor settings (position stream rate, FRAM save rate, save enabled)",
                "fields": ["posStreamRate", "saveRate", "saveEnabled"],
                "handler": "handleMotorSettings"
            },
            "SST": {
                "name": "Sensor Stream Settings",
                "description": "Sensor stream settings (impedance rate, V/I rate)",
                "fields": ["impRate", "viRate"],
                "handler": "handleSensorStreamSettings"
            },
            "MFC": {
                "name": "Motor Fitting Coefficients",
                "description": "Cubic fitting coefficients for capacitance calculation (a0, a1, a2, a3)",
                "fields": ["motorIndex", "a0", "a1", "a2", "a3"],
                "handler": "handleMotorFittingCoeffs"
            }
        },
        "endMarker": "EN",
        "description": "OpCode registry for RF Matcher communication protocol. Format: OPCODE,value1,value2,...,EN"
    };

    console.log('OpCode registry loaded:', opcodeRegistry);

    RF.modules.processIncomingData = function (chunk) {
        buffer += chunk;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop(); // Keep incomplete line

        lines.forEach(line => {
            if (line.trim().length > 0) {
                parseLine(line.trim());
            }
        });
    };

    function parseLine(line) {
        // Always show raw data in terminal
        RF.ui.log(line);

        // Parse as OpCode message for background processing (UI updates)
        if (opcodeRegistry) {
            parseOpCodeMessage(line);
        }
    }

    function parseOpCodeMessage(line) {
        // OpCode format: OPCODE,value1,value2,...,EN
        const parts = line.split(',');
        if (parts.length < 2) {
            return false; // Not enough parts
        }

        const opcode = parts[0].toUpperCase();
        const endMarker = opcodeRegistry.endMarker || 'EN';

        // Check if last element is the end marker
        if (parts[parts.length - 1] !== endMarker) {
            return false; // No valid end marker
        }

        // Check if opcode exists in registry
        const opcodeConfig = opcodeRegistry.opcodes[opcode];
        if (!opcodeConfig) {
            return false; // Unknown opcode
        }

        // Extract data (remove opcode and end marker)
        const dataFields = parts.slice(1, -1);

        // Call appropriate handler (background processing for UI updates)
        const handlerName = opcodeConfig.handler;
        if (typeof handlers[handlerName] === 'function') {
            try {
                handlers[handlerName](dataFields, opcodeConfig);
            } catch (error) {
                console.error(`Error in handler ${handlerName}:`, error);
            }
        } else {
            console.warn(`Handler not found: ${handlerName}`);
        }

        return true; // Successfully parsed
    }

    // Handler functions for different OpCodes
    const handlers = {
        handleInputImpedance: function (fields, config) {
            if (fields.length !== 2) {
                console.error('ZI: Expected 2 fields (magnitude, phase), got', fields.length);
                return;
            }

            const magnitude = parseFloat(fields[0]);
            const phase = parseFloat(fields[1]);

            if (isNaN(magnitude) || isNaN(phase)) {
                console.error('ZI: Invalid numeric values', fields);
                return;
            }

            // Update Smith Chart with input impedance
            const impData = {
                zMag: magnitude,
                zPhase: phase,
                isInput: true
            };

            RF.ui.updateSmithChart(impData);
        },

        handleOutputImpedance: function (fields, config) {
            if (fields.length !== 2) {
                console.error('ZO: Expected 2 fields (magnitude, phase), got', fields.length);
                return;
            }

            const magnitude = parseFloat(fields[0]);
            const phase = parseFloat(fields[1]);

            if (isNaN(magnitude) || isNaN(phase)) {
                console.error('ZO: Invalid numeric values', fields);
                return;
            }

            // Update Smith Chart with output impedance
            const impData = {
                zMag: magnitude,
                zPhase: phase,
                isInput: false
            };

            RF.ui.updateSmithChart(impData);
        },

        handleFftData: function (fields, config) {
            // Future implementation for FFT data
            console.log('FFT data received:', fields.length, 'values');
            // Will update FFT graph when implemented
        },

        handleRawTimeData: function (fields, config) {
            // Future implementation for raw time data
            console.log('Raw time data received:', fields.length, 'values');
            // Will update time-domain graph when implemented
        },

        handleFftInput: function (fields, config) {
            console.log('FFT Input data received:', fields.length, 'values');
            // Parse FFT data array
            const fftData = fields.map(v => parseFloat(v));

            // Update FFT graph for input sensor
            if (typeof RF.ui.updateFftGraph === 'function') {
                RF.ui.updateFftGraph('input', fftData);
            }
        },

        handleFftOutput: function (fields, config) {
            console.log('FFT Output (Voltage) data received:', fields.length, 'values');
            // Parse FFT data array
            const fftData = fields.map(v => parseFloat(v));

            // Update FFT graph for output sensor (Voltage)
            if (typeof RF.ui.updateFftGraph === 'function') {
                RF.ui.updateFftGraph('output', fftData);
            }
        },

        handleFftCurrentInput: function (fields, config) {
            console.log('FFT Current Input data received:', fields.length, 'values');
            // Parse FFT data array
            const fftData = fields.map(v => parseFloat(v));

            // Update FFT graph for input sensor (Current)
            if (typeof RF.ui.updateFftGraphCurrent === 'function') {
                RF.ui.updateFftGraphCurrent('input', fftData);
            }
        },

        handleFftCurrentOutput: function (fields, config) {
            console.log('FFT Current Output data received:', fields.length, 'values');
            // Parse FFT data array
            const fftData = fields.map(v => parseFloat(v));

            // Update FFT graph for output sensor (Current)
            if (typeof RF.ui.updateFftGraphCurrent === 'function') {
                RF.ui.updateFftGraphCurrent('output', fftData);
            }
        },

        handleVIMagInput: function (fields, config) {
            if (fields.length !== 2) {
                console.error('VI: Expected 2 fields (voltage, current), got', fields.length);
                return;
            }

            const voltage = parseFloat(fields[0]);
            const current = parseFloat(fields[1]);

            if (isNaN(voltage) || isNaN(current)) {
                console.error('VI: Invalid numeric values', fields);
                return;
            }

            // Update strip chart for input sensor
            if (typeof RF.ui.updateStripChart === 'function') {
                RF.ui.updateStripChart('input', voltage, current);
            }
        },

        handleVIMagOutput: function (fields, config) {
            if (fields.length !== 2) {
                console.error('VO: Expected 2 fields (voltage, current), got', fields.length);
                return;
            }

            const voltage = parseFloat(fields[0]);
            const current = parseFloat(fields[1]);

            if (isNaN(voltage) || isNaN(current)) {
                console.error('VO: Invalid numeric values', fields);
                return;
            }

            // Update strip chart for output sensor
            if (typeof RF.ui.updateStripChart === 'function') {
                RF.ui.updateStripChart('output', voltage, current);
            }
        },

        handleAck: function (fields, config) {
            if (fields.length >= 2) {
                const command = fields[0];
                const status = fields[1];
                console.log(`ACK: ${command} - ${status}`);
                
                // Resolve pending response promise if waiting
                if (typeof RF.core.resolveResponse === 'function') {
                    RF.core.resolveResponse('ACK', command, { status: status });
                } else if (typeof RF.core.resolveAck === 'function') {
                    // Legacy support
                    RF.core.resolveAck(command, status);
                }
                
                // If SA command was acknowledged, log success
                if (command === 'sa' && status === 'OK') {
                    RF.ui.log(`Average count saved successfully`);
                }
                // Could show a toast notification or update UI status
            }
        },

        handleGetCalibration: function (fields, config) {
            // Format: GC,[i|o],[v_gain],[i_gain],[phase_deg]
            if (fields.length !== 4) {
                console.error('GC: Expected 4 fields (channel, v, i, p), got', fields.length);
                return;
            }

            const channel = fields[0].toLowerCase();
            const vGain = parseFloat(fields[1]);
            const iGain = parseFloat(fields[2]);
            const phaseDeg = parseFloat(fields[3]);

            if (isNaN(vGain) || isNaN(iGain) || isNaN(phaseDeg)) {
                console.error('GC: Invalid numeric values', fields);
                return;
            }

            // Update UI fields based on channel
            if (channel === 'i') {
                if (document.getElementById('calVInput')) document.getElementById('calVInput').value = vGain;
                if (document.getElementById('calIInput')) document.getElementById('calIInput').value = iGain;
                if (document.getElementById('calPInput')) document.getElementById('calPInput').value = phaseDeg;
                console.log('Updated Input Calibration UI');
            } else if (channel === 'o') {
                if (document.getElementById('calVOutput')) document.getElementById('calVOutput').value = vGain;
                if (document.getElementById('calIOutput')) document.getElementById('calIOutput').value = iGain;
                if (document.getElementById('calPOutput')) document.getElementById('calPOutput').value = phaseDeg;
                console.log('Updated Output Calibration UI');
            } else {
                console.warn('RGC: Unknown channel', channel);
            }
            
            // Resolve pending response promise if waiting (RGC = RF Get Calibration)
            if (typeof RF.core.resolveResponse === 'function') {
                RF.core.resolveResponse('RGC', channel, { channel, vGain, iGain, phaseDeg });
            }
        },

        handleDeviceGetInfo: function (fields, config) {
            // Format: DGI,Model,Date,Serial
            if (fields.length !== 3) {
                console.error('SR: Expected 3 fields (Model, Date, Serial), got', fields.length);
                return;
            }
            const model = fields[0];
            const date = fields[1];
            const serial = fields[2];

            // Update global settings so they persist when modal is reopened
            if (window.RF && window.RF.settings) {
                window.RF.settings.modelName = model;
                window.RF.settings.manufactureDate = date;
                window.RF.settings.serialNumber = serial;
            }

            // Update UI fields in Controls Settings modal
            if (document.getElementById('deviceModelName')) document.getElementById('deviceModelName').value = model;
            if (document.getElementById('deviceManufactureDate')) document.getElementById('deviceManufactureDate').value = date;
            if (document.getElementById('deviceSerialNumber')) document.getElementById('deviceSerialNumber').value = serial;

            console.log('Updated Device Info UI:', model, date, serial);
            
            // Resolve pending response promise if waiting (DGI = Device Get Info)
            if (typeof RF.core.resolveResponse === 'function') {
                RF.core.resolveResponse('DGI', null, { model, date, serial });
            }
        },

        handleGetMotorLimits: function (fields, config) {
            // Format: MGL,idx,min,max,lower,upper,minCap,maxCap,pos,percent,cap
            // motorIndex: 0~31 (currently using 0 and 1, expandable up to 32 motors)
            // NOTE: Capacitance values from firmware are pF×100 (integer), divide by 100 for actual pF
            if (fields.length !== 10) {
                console.error('MGL: Expected 10 fields (idx,min,max,lower,upper,minCap,maxCap,pos,percent,cap), got', fields.length);
                return;
            }

            const motorIndex = parseInt(fields[0]);
            const minVal = parseInt(fields[1]);
            const maxVal = parseInt(fields[2]);
            const lowerLimitVal = parseInt(fields[3]);
            const upperLimitVal = parseInt(fields[4]);
            // Capacitance values: firmware sends pF×100, convert to pF
            const minCapVal = parseInt(fields[5]) / 100;
            const maxCapVal = parseInt(fields[6]) / 100;
            const positionVal = parseInt(fields[7]);
            const percentVal = parseInt(fields[8]);
            const capacitanceVal = parseInt(fields[9]) / 100;

            // Validate motorIndex (0~31 range for future expansion)
            if (isNaN(motorIndex) || motorIndex < 0 || motorIndex > 31) {
                console.error('MGL: Invalid motor index (must be 0~31)', fields);
                return;
            }

            // NaN check - 0 is a valid value
            if (isNaN(minVal) || isNaN(maxVal) || isNaN(lowerLimitVal) || isNaN(upperLimitVal) ||
                isNaN(minCapVal) || isNaN(maxCapVal) || isNaN(positionVal) || isNaN(percentVal) || isNaN(capacitanceVal)) {
                console.error('MGL: Invalid numeric values', fields);
                return;
            }
            
            // Resolve pending response promise if waiting (MGL = Motor Get Limits)
            if (typeof RF.core.resolveResponse === 'function') {
                RF.core.resolveResponse('MGL', motorIndex.toString(), {
                    motorIndex: motorIndex,
                    min: minVal,
                    max: maxVal,
                    lowerLimit: lowerLimitVal,
                    upperLimit: upperLimitVal,
                    minCap: minCapVal,
                    maxCap: maxCapVal,
                    position: positionVal,
                    percent: percentVal,
                    capacitance: capacitanceVal
                });
            }

            // Update global settings and UI
            // Currently mapping: motorIndex 0 -> Motor1/VVC1, motorIndex 1 -> Motor2/VVC2
            if (window.RF && window.RF.settings) {
                const motorNum = motorIndex + 1;  // Convert index to 1-based for UI
                const motorKey = `motor${motorNum}`;
                const vvcKey = `vvc${motorNum}`;
                
                // Initialize settings objects if needed
                if (!RF.settings[motorKey]) RF.settings[motorKey] = {};
                if (!RF.settings[vvcKey]) RF.settings[vvcKey] = {};
                
                // Update settings (including capacitance)
                RF.settings[motorKey].minValue = minVal;
                RF.settings[motorKey].maxValue = maxVal;
                RF.settings[motorKey].lowerLimit = lowerLimitVal;
                RF.settings[motorKey].upperLimit = upperLimitVal;
                RF.settings[motorKey].position = positionVal;
                RF.settings[motorKey].percent = percentVal;
                
                RF.settings[vvcKey].minValue = minVal;
                RF.settings[vvcKey].maxValue = maxVal;
                RF.settings[vvcKey].lowerLimit = lowerLimitVal;
                RF.settings[vvcKey].upperLimit = upperLimitVal;
                RF.settings[vvcKey].minCap = minCapVal;
                RF.settings[vvcKey].maxCap = maxCapVal;
                RF.settings[vvcKey].currentValue = positionVal;
                RF.settings[vvcKey].position = positionVal;
                RF.settings[vvcKey].percent = percentVal;
                RF.settings[vvcKey].capacitance = capacitanceVal;

                // Update UI fields (only if elements exist)
                const motorFields = ['MinValue', 'MaxValue', 'LowerLimit', 'UpperLimit'];
                const values = [minVal, maxVal, lowerLimitVal, upperLimitVal];
                
                motorFields.forEach((field, i) => {
                    const motorEl = document.getElementById(`motor${motorNum}${field}`);
                    const vvcEl = document.getElementById(`vvc${motorNum}${field}`);
                    if (motorEl) motorEl.value = values[i];
                    if (vvcEl) vvcEl.value = values[i];
                });
                
                // Update capacitance fields
                const vvcMinCapEl = document.getElementById(`vvc${motorNum}MinCap`);
                const vvcMaxCapEl = document.getElementById(`vvc${motorNum}MaxCap`);
                if (vvcMinCapEl) vvcMinCapEl.value = minCapVal;
                if (vvcMaxCapEl) vvcMaxCapEl.value = maxCapVal;
                
                // Update position and percent fields (read-only)
                const vvcCurrentEl = document.getElementById(`vvc${motorNum}CurrentValue`);
                const vvcPercentEl = document.getElementById(`vvc${motorNum}Percent`);
                if (vvcCurrentEl) vvcCurrentEl.value = positionVal;
                if (vvcPercentEl) vvcPercentEl.value = percentVal;
                
                // Update VVC Position bar display
                if (typeof RF.ui.updateVvcBar === 'function') {
                    RF.ui.updateVvcBar(motorNum, percentVal);
                }
                
                // Update VVC value text display based on displayMode
                if (typeof RF.ui.updateVvcDisplay === 'function') {
                    RF.ui.updateVvcDisplay(vvcKey, motorNum);
                }
                
                console.log(`MGL: Motor ${motorNum} (idx=${motorIndex}) - Pos: ${positionVal}, ${percentVal}%, ${capacitanceVal}pF, Cap Range: ${minCapVal}~${maxCapVal}pF`);
            }
        },

        handleGetAverageCount: function (fields, config) {
            // Format: GA,channel,count
            if (fields.length !== 2) {
                console.error('GA: Expected 2 fields (channel, count), got', fields.length);
                return;
            }

            const channel = fields[0].toLowerCase();
            const count = parseInt(fields[1]);

            if (isNaN(count)) {
                console.error('GA: Invalid count value', fields);
                return;
            }

            // Update global settings
            if (window.RF && window.RF.settings) {
                window.RF.settings.impedanceAvgCount = count;
            }

            // Update UI field in Controls Settings modal
            const avgCountInput = document.getElementById('impedanceAvgCount');
            if (avgCountInput) {
                avgCountInput.value = count;
            }

            console.log(`Updated Average Count UI: ${channel} sensor = ${count}`);
            
            // Resolve pending response promise if waiting (RGA = RF Get Average)
            if (typeof RF.core.resolveResponse === 'function') {
                RF.core.resolveResponse('RGA', channel, { channel, count });
            }
        },

        handleMotorPosition: function (fields, config) {
            // Format: MP,motorIndex,position,percent
            if (fields.length !== 3) {
                console.error('MP: Expected 3 fields (motorIndex, position, percent), got', fields.length);
                return;
            }

            const motorIndex = parseInt(fields[0]);
            const positionVal = parseInt(fields[1]);
            const percentVal = parseInt(fields[2]);

            // Validate motorIndex (0~31 range for future expansion)
            if (isNaN(motorIndex) || motorIndex < 0 || motorIndex > 31) {
                console.error('MP: Invalid motor index (must be 0~31)', fields);
                return;
            }

            // NaN check
            if (isNaN(positionVal) || isNaN(percentVal)) {
                console.error('MP: Invalid numeric values', fields);
                return;
            }
            
            // Resolve pending response promise if waiting (MGP = Motor Get Position)
            if (typeof RF.core.resolveResponse === 'function') {
                RF.core.resolveResponse('MGP', motorIndex.toString(), {
                    motorIndex: motorIndex,
                    position: positionVal,
                    percent: percentVal
                });
            }

            // Update UI
            if (window.RF && window.RF.settings) {
                const motorNum = motorIndex + 1;  // Convert index to 1-based for UI
                const vvcKey = `vvc${motorNum}`;
                
                // Initialize settings object if needed
                if (!RF.settings[vvcKey]) RF.settings[vvcKey] = {};
                
                // Update settings
                RF.settings[vvcKey].position = positionVal;
                RF.settings[vvcKey].percent = percentVal;

                // Update VVC Position Settings modal fields
                const vvcCurrentEl = document.getElementById(`vvc${motorNum}CurrentValue`);
                const vvcPercentEl = document.getElementById(`vvc${motorNum}Percent`);
                if (vvcCurrentEl) vvcCurrentEl.value = positionVal;
                if (vvcPercentEl) vvcPercentEl.value = percentVal;
                
                // Update VVC Position bar display
                if (typeof RF.ui.updateVvcBar === 'function') {
                    RF.ui.updateVvcBar(motorNum, percentVal);
                }
                
                console.log(`Updated VVC ${motorNum} (index=${motorIndex}) - Position: ${positionVal}, Percent: ${percentVal}%`);
            }
        },

        handleMotorStatus: function (fields, config) {
            // Format: MGS,idx,reg0,reg1,reg2,reg3,reg4,reg5,reg6,reg7
            // idx is 0-based motor index (0 or 1)
            if (fields.length !== 9) {
                console.error('MGS: Expected 9 fields (idx, reg0-7), got', fields.length);
                return;
            }

            const idx = parseInt(fields[0]);
            const regs = fields.slice(1).map(v => parseInt(v, 16)); // Parse as hex

            // Validate motor index (0 or 1)
            if (isNaN(idx) || (idx !== 0 && idx !== 1)) {
                console.error('MGS: Invalid motor index (must be 0 or 1)', fields);
                return;
            }

            // Register names for display
            const regNames = ['CTRL', 'TORQUE', 'OFF', 'BLANK', 'DECAY', 'STALL', 'DRIVE', 'STATUS'];
            
            // Build status display text
            let statusText = '';
            regs.forEach((val, i) => {
                statusText += `${regNames[i]}: 0x${val.toString(16).toUpperCase().padStart(4, '0')} (${val})\n`;
            });

            // Update the appropriate motor status display (UI uses 1-based: motor1StatusDisplay, motor2StatusDisplay)
            const uiIdx = idx + 1;
            const displayEl = document.getElementById(`motor${uiIdx}StatusDisplay`);
            if (displayEl) {
                displayEl.textContent = statusText.trim();
                displayEl.style.color = '#4ec9b0'; // Success color
            }

            console.log(`Motor ${idx} Status Registers:`, regs);
            
            // Resolve pending response promise if waiting (MGS = Motor Get Status)
            if (typeof RF.core.resolveResponse === 'function') {
                RF.core.resolveResponse('MGS', idx.toString(), { idx, regs });
            }
        },

        handleMotorPositionBoth: function (fields, config) {
            // Format: MPB,pos0,percent0,cap0,pos1,percent1,cap1
            // NOTE: Capacitance values from firmware are pF×100 (integer), divide by 100 for actual pF
            if (fields.length !== 6) {
                console.error('MPB: Expected 6 fields (pos0, percent0, cap0, pos1, percent1, cap1), got', fields.length);
                return;
            }

            const pos0 = parseInt(fields[0]);
            const percent0 = parseInt(fields[1]);
            // Capacitance: firmware sends pF×100, convert to pF
            const cap0 = parseInt(fields[2]) / 100;
            const pos1 = parseInt(fields[3]);
            const percent1 = parseInt(fields[4]);
            const cap1 = parseInt(fields[5]) / 100;

            // NaN check
            if (isNaN(pos0) || isNaN(percent0) || isNaN(cap0) || isNaN(pos1) || isNaN(percent1) || isNaN(cap1)) {
                console.error('MPB: Invalid numeric values', fields);
                return;
            }

            // Update settings and UI for both motors
            if (window.RF && window.RF.settings) {
                // Motor 0 (VVC 1)
                if (!RF.settings.vvc1) RF.settings.vvc1 = {};
                RF.settings.vvc1.currentValue = pos0;
                RF.settings.vvc1.position = pos0;
                RF.settings.vvc1.percent = percent0;
                RF.settings.vvc1.capacitance = cap0;

                // Motor 1 (VVC 2)
                if (!RF.settings.vvc2) RF.settings.vvc2 = {};
                RF.settings.vvc2.currentValue = pos1;
                RF.settings.vvc2.position = pos1;
                RF.settings.vvc2.percent = percent1;
                RF.settings.vvc2.capacitance = cap1;

                // Update VVC Settings modal fields
                const vvc1CurrentEl = document.getElementById('vvc1CurrentValue');
                const vvc1PercentEl = document.getElementById('vvc1Percent');
                if (vvc1CurrentEl) vvc1CurrentEl.value = pos0;
                if (vvc1PercentEl) vvc1PercentEl.value = percent0;

                const vvc2CurrentEl = document.getElementById('vvc2CurrentValue');
                const vvc2PercentEl = document.getElementById('vvc2Percent');
                if (vvc2CurrentEl) vvc2CurrentEl.value = pos1;
                if (vvc2PercentEl) vvc2PercentEl.value = percent1;

                // Update VVC Position bar displays (progress bar uses percent)
                if (typeof RF.ui.updateVvcBar === 'function') {
                    RF.ui.updateVvcBar(1, percent0);
                    RF.ui.updateVvcBar(2, percent1);
                }
                
                // Update VVC value text display based on displayMode
                if (typeof RF.ui.updateVvcDisplay === 'function') {
                    RF.ui.updateVvcDisplay('vvc1', 1);
                    RF.ui.updateVvcDisplay('vvc2', 2);
                }

                console.log(`MPB: M0=${pos0} (${percent0}%, ${cap0}pF), M1=${pos1} (${percent1}%, ${cap1}pF)`);
            }
        },

        handleMotorSettings: function (fields, config) {
            // Format: MST,posStreamRate,saveRate,saveEnabled
            if (fields.length !== 3) {
                console.error('MST: Expected 3 fields (posStreamRate, saveRate, saveEnabled), got', fields.length);
                return;
            }

            const posStreamRate = parseInt(fields[0]);
            const saveRate = parseInt(fields[1]);
            const saveEnabled = parseInt(fields[2]);

            // NaN check
            if (isNaN(posStreamRate) || isNaN(saveRate) || isNaN(saveEnabled)) {
                console.error('MST: Invalid numeric values', fields);
                return;
            }

            // Update global settings
            if (window.RF && window.RF.settings) {
                RF.settings.motorPosStreamRate = posStreamRate;
                RF.settings.motorPosSaveRate = saveRate;
                RF.settings.motorPosSaveEnabled = (saveEnabled === 1);

                // Update UI fields in Controls Settings modal
                const posStreamRateInput = document.getElementById('motorPosStreamRate');
                const saveRateInput = document.getElementById('motorPosSaveRate');
                const saveEnabledInput = document.getElementById('motorPosSaveEnabled');

                if (posStreamRateInput) posStreamRateInput.value = posStreamRate;
                if (saveRateInput) saveRateInput.value = saveRate;
                if (saveEnabledInput) saveEnabledInput.checked = (saveEnabled === 1);

                console.log(`MST: PosStreamRate=${posStreamRate}ms, SaveRate=${saveRate}ms, SaveEnabled=${saveEnabled === 1}`);
            }

            // Resolve pending response promise if waiting (MST = Motor Settings)
            if (typeof RF.core.resolveResponse === 'function') {
                RF.core.resolveResponse('MST', null, { posStreamRate, saveRate, saveEnabled: saveEnabled === 1 });
            }
        },

        handleSensorStreamSettings: function (fields, config) {
            // Format: SST,impRate,viRate
            if (fields.length !== 2) {
                console.error('SST: Expected 2 fields (impRate, viRate), got', fields.length);
                return;
            }

            const impRate = parseInt(fields[0]);
            const viRate = parseInt(fields[1]);

            // NaN check
            if (isNaN(impRate) || isNaN(viRate)) {
                console.error('SST: Invalid numeric values', fields);
                return;
            }

            // Update global settings
            if (window.RF && window.RF.settings) {
                RF.settings.impedanceStreamRate = impRate;
                RF.settings.viStreamRate = viRate;

                // Update UI fields in Controls Settings modal
                const impRateInput = document.getElementById('impedanceStreamRate');
                const viRateInput = document.getElementById('viStreamRate');

                if (impRateInput) impRateInput.value = impRate;
                if (viRateInput) viRateInput.value = viRate;

                console.log(`SST: ImpRate=${impRate}ms, ViRate=${viRate}ms`);
            }

            // Resolve pending response promise if waiting (SST = Sensor Stream Settings)
            if (typeof RF.core.resolveResponse === 'function') {
                RF.core.resolveResponse('SST', null, { impRate, viRate });
            }
        },

        handleMotorFittingCoeffs: function (fields, config) {
            // Format: MFC,idx,a0,a1,a2,a3
            // Note: xMin and xRange are derived from Motor Limits (Min/Max), not sent separately
            if (fields.length < 5) {
                console.error('MFC: Expected 5 fields (idx, a0, a1, a2, a3), got', fields.length);
                return;
            }

            const motorIndex = parseInt(fields[0]);
            const a0 = parseFloat(fields[1]);
            const a1 = parseFloat(fields[2]);
            const a2 = parseFloat(fields[3]);
            const a3 = parseFloat(fields[4]);

            // Validate motorIndex (0 or 1)
            if (isNaN(motorIndex) || (motorIndex !== 0 && motorIndex !== 1)) {
                console.error('MFC: Invalid motor index (must be 0 or 1)', fields);
                return;
            }

            // NaN check for coefficients - allow 0 values
            if (isNaN(a0) || isNaN(a1) || isNaN(a2) || isNaN(a3)) {
                console.error('MFC: Invalid numeric values', fields);
                return;
            }

            // Update global settings and UI
            if (window.RF && window.RF.settings) {
                const vvcKey = motorIndex === 0 ? 'vvc1' : 'vvc2';
                const vvcNum = motorIndex + 1;
                
                // Initialize settings object if needed
                if (!RF.settings[vvcKey]) RF.settings[vvcKey] = {};
                
                // Update fitting coefficients (normalized)
                RF.settings[vvcKey].fitCoeffs = [a0, a1, a2, a3];
                
                // Update UI fields in VVC Settings modal
                const fitA0El = document.getElementById(`vvc${vvcNum}FitA0`);
                const fitA1El = document.getElementById(`vvc${vvcNum}FitA1`);
                const fitA2El = document.getElementById(`vvc${vvcNum}FitA2`);
                const fitA3El = document.getElementById(`vvc${vvcNum}FitA3`);
                
                if (fitA0El) fitA0El.value = a0;
                if (fitA1El) fitA1El.value = a1;
                if (fitA2El) fitA2El.value = a2;
                if (fitA3El) fitA3El.value = a3;
                
                // Note: Min/Max Cap are user-input values from MGL, not auto-calculated from fitting coefficients
                
                console.log(`MFC: Motor ${motorIndex} (VVC${motorIndex}) - a0=${a0}, a1=${a1}, a2=${a2}, a3=${a3}`);
            }
            
            // Resolve pending response promise if waiting (MFC = Motor Fitting Coefficients)
            if (typeof RF.core.resolveResponse === 'function') {
                RF.core.resolveResponse('MFC', motorIndex.toString(), { motorIndex, a0, a1, a2, a3 });
            }
        }
    };

    // Expose handlers for testing/debugging
    RF.modules.opcodeHandlers = handlers;
    RF.modules.getOpcodeRegistry = () => opcodeRegistry;

})();
