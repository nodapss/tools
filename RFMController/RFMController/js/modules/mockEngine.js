/**
 * MockEngine - Command parsing and response generation for Mock Serial Engine
 * Simulates MatFW_001 firmware command processing
 */
(function () {
    'use strict';

    // Response delay simulation (ms)
    const RESPONSE_DELAY = 10;

    // Mock engine state
    let mockEngineEnabled = false;

    /**
     * Parse a command string into command and arguments
     * @param {string} cmdLine - Command line (e.g., "mr 0 50000")
     * @returns {{cmd: string, args: string[]}} Parsed command
     */
    function parseCommand(cmdLine) {
        const trimmed = cmdLine.trim();
        const parts = trimmed.split(/\s+/);
        const cmd = parts[0] || '';
        const args = parts.slice(1);
        return { cmd: cmd.toLowerCase(), args };
    }

    /**
     * Generate OpCode response string
     * @param {string} opcode - OpCode (e.g., "ZI", "MGP")
     * @param {...any} values - Values to include
     * @returns {string} Formatted response (e.g., "ZI,50.0,0.0,100.0,2.0,0.0,EN")
     */
    function generateResponse(opcode, ...values) {
        return `${opcode},${values.join(',')},EN\r\n`;
    }

    /**
     * Generate ACK response
     * @param {string} cmd - Original command
     * @param {string} status - Status ("OK" or error message)
     * @returns {string} ACK response
     */
    function generateAck(cmd, status = 'OK') {
        return generateResponse('ACK', cmd, status);
    }

    /**
     * Format float with fixed precision
     * @param {number} value - Value to format
     * @param {number} decimals - Decimal places (default 2)
     * @returns {string} Formatted value
     */
    function formatFloat(value, decimals = 2) {
        return value.toFixed(decimals);
    }

    /**
     * Send simulated response back to protocol processor
     * @param {string} response - Response string to send
     */
    function sendResponse(response) {
        setTimeout(() => {
            if (typeof RF.modules.processIncomingData === 'function') {
                RF.modules.processIncomingData(response);
            }
        }, RESPONSE_DELAY);
    }

    /**
     * Get mock device instance
     * @returns {object} MockDevice instance
     */
    function getDevice() {
        return RF.mock.device;
    }

    // ========================================
    // Command Handlers
    // ========================================

    const commandHandlers = {
        // ----- Device Commands (d*) -----

        dh: function (args) {
            // Device Help - return help text (as simple log)
            sendResponse('--- Mock Device Commands ---\r\n');
            sendResponse('dgi: Get device info\r\n');
            sendResponse('dsi: Set device info\r\n');
            sendResponse('dh: This help\r\n');
        },

        dgi: function (args) {
            // Device Get Info
            const device = getDevice();
            sendResponse(generateResponse('DGI',
                device.modelName,
                device.makeDate,
                device.serialNum
            ));
        },

        dsi: function (args) {
            // Device Set Info: dsi [model] [date] [serial]
            const device = getDevice();
            if (args.length >= 1) device.modelName = args[0];
            if (args.length >= 2) device.makeDate = args[1];
            if (args.length >= 3) device.serialNum = args[2];
            sendResponse(generateAck('dsi', 'OK'));
        },

        // ----- RF Sensor Commands (r*) -----

        ri: function (args) {
            // RF Initialize - reset sensors
            const device = getDevice();
            device.inputSensor.voltageGain = 1.0;
            device.inputSensor.currentGain = 1.0;
            device.inputSensor.phaseDiffDeg = 0.0;
            device.outputSensor.voltageGain = 1.0;
            device.outputSensor.currentGain = 1.0;
            device.outputSensor.phaseDiffDeg = 0.0;
            sendResponse(generateAck('ri', 'OK'));
        },

        rz: function (args) {
            // RF Zero - zero calibration (placeholder)
            sendResponse(generateAck('rz', 'OK'));
        },

        rsc: function (args) {
            // RF Set Calibration: rsc [i|o] [v] [i] [p]
            if (args.length < 4) {
                sendResponse(generateAck('rsc', 'ERR_ARGS'));
                return;
            }
            const device = getDevice();
            const channel = args[0].toLowerCase();
            const sensor = device.getSensor(channel);
            if (!sensor) {
                sendResponse(generateAck('rsc', 'ERR_CHANNEL'));
                return;
            }
            sensor.voltageGain = parseFloat(args[1]) || 1.0;
            sensor.currentGain = parseFloat(args[2]) || 1.0;
            sensor.phaseDiffDeg = parseFloat(args[3]) || 0.0;
            sendResponse(generateAck('rsc', 'OK'));
        },

        rgc: function (args) {
            // RF Get Calibration: rgc [i|o]
            if (args.length < 1) {
                sendResponse(generateAck('rgc', 'ERR_ARGS'));
                return;
            }
            const device = getDevice();
            const channel = args[0].toLowerCase();
            const sensor = device.getSensor(channel);
            if (!sensor) {
                sendResponse(generateAck('rgc', 'ERR_CHANNEL'));
                return;
            }
            sendResponse(generateResponse('RGC',
                channel,
                formatFloat(sensor.voltageGain, 4),
                formatFloat(sensor.currentGain, 4),
                formatFloat(sensor.phaseDiffDeg, 2)
            ));
        },

        rsa: function (args) {
            // RF Set Average: rsa [i|o] [count]
            if (args.length < 2) {
                sendResponse(generateAck('rsa', 'ERR_ARGS'));
                return;
            }
            const device = getDevice();
            const channel = args[0].toLowerCase();
            const sensor = device.getSensor(channel);
            if (!sensor) {
                sendResponse(generateAck('rsa', 'ERR_CHANNEL'));
                return;
            }
            sensor.avgCount = parseInt(args[1]) || 512;
            sendResponse(generateAck('rsa', 'OK'));
        },

        rga: function (args) {
            // RF Get Average: rga [i|o]
            if (args.length < 1) {
                sendResponse(generateAck('rga', 'ERR_ARGS'));
                return;
            }
            const device = getDevice();
            const channel = args[0].toLowerCase();
            const sensor = device.getSensor(channel);
            if (!sensor) {
                sendResponse(generateAck('rga', 'ERR_CHANNEL'));
                return;
            }
            sendResponse(generateResponse('RGA', channel, sensor.avgCount));
        },

        rrs: function (args) {
            // RF Run Stream: rrs [i|o] [run|stop] [rate_ms]
            if (args.length < 2) {
                sendResponse(generateAck('rrs', 'ERR_ARGS'));
                return;
            }
            const device = getDevice();
            const channel = args[0].toLowerCase();
            const action = args[1].toLowerCase();
            const rate = args.length >= 3 ? parseInt(args[2]) : 100;

            const streamKey = channel === 'i' ? 'impedanceInput' : 'impedanceOutput';

            if (action === 'run') {
                device.streams[streamKey].enabled = true;
                device.streams[streamKey].rate = rate;
                device.impStreamRate = rate;
            } else if (action === 'stop') {
                device.streams[streamKey].enabled = false;
            }

            sendResponse(generateAck('rrs', 'OK'));
        },

        rvs: function (args) {
            // RF V/I Stream: rvs [i|o] [run|stop] [rate_ms]
            if (args.length < 2) {
                sendResponse(generateAck('rvs', 'ERR_ARGS'));
                return;
            }
            const device = getDevice();
            const channel = args[0].toLowerCase();
            const action = args[1].toLowerCase();
            const rate = args.length >= 3 ? parseInt(args[2]) : 100;

            const streamKey = channel === 'i' ? 'viInput' : 'viOutput';

            if (action === 'run') {
                device.streams[streamKey].enabled = true;
                device.streams[streamKey].rate = rate;
                device.viStreamRate = rate;
            } else if (action === 'stop') {
                device.streams[streamKey].enabled = false;
            }

            sendResponse(generateAck('rvs', 'OK'));
        },

        rf: function (args) {
            // RF FFT (single shot) - generate mock FFT data
            // 1024 bins, 13.56 MHz center peak with Gaussian falloff
            const channel = args.length >= 1 ? args[0].toLowerCase() : 'i';
            const opcode = channel === 'i' ? 'FI' : 'FO';

            // Get current V, I values for peak amplitude
            let peakV = 100, peakI = 10;
            if (RF.mock && RF.mock.physics) {
                const impedance = channel === 'i'
                    ? RF.mock.physics.calculateInputImpedance()
                    : RF.mock.physics.calculateOutputImpedance();
                peakV = impedance.V || 100;
                peakI = impedance.I || 10;
            }

            // Generate 1024-point FFT data
            // 13.56 MHz signal appears at bin 139 (13.56 / 100 * 1024 = 138.85)
            const fftLength = 1024;
            const centerBin = 139;  // 13.56 MHz center
            const sigma = 1.0;  // Narrow peak

            const fftData = [];
            for (let i = 0; i < fftLength; i++) {
                // Gaussian peak centered at 13.56 MHz
                const distance = Math.abs(i - centerBin);
                const gV = peakV * Math.exp(-(distance * distance) / (2 * sigma * sigma));
                const gI = peakI * Math.exp(-(distance * distance) / (2 * sigma * sigma));

                // Add small noise floor
                const noiseFloor = 0.5;
                const noiseV = Math.random() * noiseFloor;
                const noiseI = Math.random() * (noiseFloor / 10); // Current is usually smaller

                // Push Voltage then Current (Interleaved)
                fftData.push(formatFloat(gV + noiseV, 2));
                fftData.push(formatFloat(gI + noiseI, 2));
            }

            sendResponse(`${opcode},${fftData.join(',')},EN\r\n`);
        },

        rk: function (args) {
            // RF Kill (stop all streams)
            const device = getDevice();
            Object.keys(device.streams).forEach(key => {
                device.streams[key].enabled = false;
            });
            sendResponse(generateAck('rk', 'OK'));
        },

        rr: function (args) {
            // RF Reset
            const device = getDevice();
            device.inputSensor.avgCount = 512;
            device.outputSensor.avgCount = 512;
            sendResponse(generateAck('rr', 'OK'));
        },

        // ----- Motor Commands (m*) -----

        mi: function (args) {
            // Motor Initialize
            const device = getDevice();
            device.motors.forEach(m => {
                m.position = 32000;
                m.targetPosition = 32000;
                m.rpm = 0;
            });
            sendResponse(generateAck('mi', 'OK'));
        },

        mor: function (args) {
            // Motor Override RPM: mor [idx] [rpm]
            if (args.length < 2) {
                sendResponse(generateAck('mor', 'ERR_ARGS'));
                return;
            }
            const device = getDevice();
            const idx = parseInt(args[0]);
            const rpm = parseInt(args[1]);
            const motor = device.getMotor(idx);

            if (!motor) {
                sendResponse(generateAck('mor', 'ERR_MOTOR'));
                return;
            }

            motor.overrideRpm = rpm;
            sendResponse(generateAck('mor', 'OK'));
        },

        mr: function (args) {
            // Motor Run: mr [idx] [position]
            if (args.length < 2) {
                sendResponse(generateAck('mr', 'ERR_ARGS'));
                return;
            }
            const device = getDevice();
            const idx = parseInt(args[0]);
            const pos = parseInt(args[1]);
            const motor = device.getMotor(idx);

            if (!motor) {
                sendResponse(generateAck('mr', 'ERR_MOTOR'));
                return;
            }

            motor.runMotor(pos);
            sendResponse(generateAck('mr', 'OK'));

            // Start motor position streaming during movement
            if (RF.mock.physics && RF.mock.physics.startMotorStream) {
                RF.mock.physics.startMotorStream();
            }
        },

        mf: function (args) {
            // Motor Force Run: mf [idx] [position] (bypass limits)
            if (args.length < 2) {
                sendResponse(generateAck('mf', 'ERR_ARGS'));
                return;
            }
            const device = getDevice();
            const idx = parseInt(args[0]);
            const pos = parseInt(args[1]);
            const motor = device.getMotor(idx);

            if (!motor) {
                sendResponse(generateAck('mf', 'ERR_MOTOR'));
                return;
            }

            motor.runMotorForce(pos);
            sendResponse(generateAck('mf', 'OK'));

            // Start motor position streaming during movement
            if (RF.mock.physics && RF.mock.physics.startMotorStream) {
                RF.mock.physics.startMotorStream();
            }
        },

        mo: function (args) {
            // Motor Origin: mo [idx] [position]
            if (args.length < 1) {
                sendResponse(generateAck('mo', 'ERR_ARGS'));
                return;
            }
            const device = getDevice();
            const idx = parseInt(args[0]);
            const pos = args.length >= 2 ? parseInt(args[1]) : 0;
            const motor = device.getMotor(idx);

            if (!motor) {
                sendResponse(generateAck('mo', 'ERR_MOTOR'));
                return;
            }

            motor.setOrigin(pos);
            sendResponse(generateAck('mo', 'OK'));
        },

        mgp: function (args) {
            // Motor Get Position: mgp [idx]
            if (args.length < 1) {
                sendResponse(generateAck('mgp', 'ERR_ARGS'));
                return;
            }
            const device = getDevice();
            const idx = parseInt(args[0]);
            const motor = device.getMotor(idx);

            if (!motor) {
                sendResponse(generateAck('mgp', 'ERR_MOTOR'));
                return;
            }

            sendResponse(generateResponse('MGP',
                idx,
                motor.position,
                motor.getPositionPercent()
            ));
        },

        mgl: function (args) {
            // Motor Get Limits: mgl [idx]
            if (args.length < 1) {
                sendResponse(generateAck('mgl', 'ERR_ARGS'));
                return;
            }
            const device = getDevice();
            const idx = parseInt(args[0]);
            const motor = device.getMotor(idx);

            if (!motor) {
                sendResponse(generateAck('mgl', 'ERR_MOTOR'));
                return;
            }

            sendResponse(generateResponse('MGL',
                idx,
                motor.minValue,
                motor.maxValue,
                motor.lowerLimit,
                motor.upperLimit,
                motor.minCap,
                motor.maxCap,
                motor.position,
                motor.getPositionPercent(),
                motor.getCapacitance()
            ));
        },

        msl: function (args) {
            // Motor Set Limits: msl [idx] [lower] [upper]
            if (args.length < 3) {
                sendResponse(generateAck('msl', 'ERR_ARGS'));
                return;
            }
            const device = getDevice();
            const idx = parseInt(args[0]);
            const lower = parseInt(args[1]);
            const upper = parseInt(args[2]);
            const motor = device.getMotor(idx);

            if (!motor) {
                sendResponse(generateAck('msl', 'ERR_MOTOR'));
                return;
            }

            motor.lowerLimit = lower;
            motor.upperLimit = upper;
            sendResponse(generateAck('msl', 'OK'));
        },

        msc: function (args) {
            // Motor Set Capacitance Limits: msc [idx] [minCap] [maxCap]
            if (args.length < 3) {
                sendResponse(generateAck('msc', 'ERR_ARGS'));
                return;
            }
            const device = getDevice();
            const idx = parseInt(args[0]);
            const minCap = parseInt(args[1]);
            const maxCap = parseInt(args[2]);
            const motor = device.getMotor(idx);

            if (!motor) {
                sendResponse(generateAck('msc', 'ERR_MOTOR'));
                return;
            }

            motor.minCap = minCap;
            motor.maxCap = maxCap;
            sendResponse(generateAck('msc', 'OK'));
        },

        mfc: function (args) {
            // Motor Fitting Coefficients Get/Set: mfc [idx] OR mfc [idx] [a0] [a1] [a2] [a3]
            if (args.length < 1) {
                sendResponse(generateAck('mfc', 'ERR_ARGS'));
                return;
            }
            const device = getDevice();
            const idx = parseInt(args[0]);
            const motor = device.getMotor(idx);

            if (!motor) {
                sendResponse(generateAck('mfc', 'ERR_MOTOR'));
                return;
            }

            if (args.length >= 5) {
                // Set coefficients
                motor.fitCoeffs[0] = parseFloat(args[1]) || 0;
                motor.fitCoeffs[1] = parseFloat(args[2]) || 0;
                motor.fitCoeffs[2] = parseFloat(args[3]) || 0;
                motor.fitCoeffs[3] = parseFloat(args[4]) || 0;
                sendResponse(generateAck('mfc', 'OK'));
            } else {
                // Get coefficients
                sendResponse(generateResponse('MFC',
                    idx,
                    formatFloat(motor.fitCoeffs[0], 6),
                    formatFloat(motor.fitCoeffs[1], 6),
                    formatFloat(motor.fitCoeffs[2], 6),
                    formatFloat(motor.fitCoeffs[3], 6)
                ));
            }
        },

        mrp: function (args) {
            // Motor Run to Position: mrp [idx] [position]
            // Same as mr but with different feedback
            if (args.length < 2) {
                sendResponse(generateAck('mrp', 'ERR_ARGS'));
                return;
            }
            const device = getDevice();
            const idx = parseInt(args[0]);
            const pos = parseInt(args[1]);
            const motor = device.getMotor(idx);

            if (!motor) {
                sendResponse(generateAck('mrp', 'ERR_MOTOR'));
                return;
            }

            motor.runMotor(pos);
            sendResponse(generateAck('mrp', 'OK'));
        },

        mrc: function (args) {
            // Motor Run to Capacitance: mrc [idx] [capacitance_pF100]
            if (args.length < 2) {
                sendResponse(generateAck('mrc', 'ERR_ARGS'));
                return;
            }
            const device = getDevice();
            const idx = parseInt(args[0]);
            const targetCap = parseInt(args[1]);
            const motor = device.getMotor(idx);

            if (!motor) {
                sendResponse(generateAck('mrc', 'ERR_MOTOR'));
                return;
            }

            const targetPos = motor.getPositionFromCap(targetCap);
            motor.runMotor(targetPos);
            sendResponse(generateAck('mrc', 'OK'));
        },

        mps: function (args) {
            // Motor Position Stream: mps [run|stop] [rate_ms]
            if (args.length < 1) {
                sendResponse(generateAck('mps', 'ERR_ARGS'));
                return;
            }
            const device = getDevice();
            const action = args[0].toLowerCase();
            const rate = args.length >= 2 ? parseInt(args[1]) : 100;

            if (action === 'run') {
                device.streams.motorPosition.enabled = true;
                device.streams.motorPosition.rate = rate;
                device.motorPosStreamRate = rate;
            } else if (action === 'stop') {
                device.streams.motorPosition.enabled = false;
            }

            sendResponse(generateAck('mps', 'OK'));
        },

        mgs: function (args) {
            // Motor Get Status: mgs [idx]
            if (args.length < 1) {
                sendResponse(generateAck('mgs', 'ERR_ARGS'));
                return;
            }
            const idx = parseInt(args[0]);

            // Generate mock driver status registers (DRV8711 format)
            // Returns 8 hex values representing internal status
            const statusRegs = [
                0x0001,  // CTRL: Basic configuration
                0x0100,  // TORQUE: Torque setting
                0x0000,  // OFF: Off time
                0x0000,  // BLANK: Blanking time
                0x0000,  // DECAY: Decay mode
                0x0000,  // STALL: Stall detection (no stall)
                0x0000,  // DRIVE: Drive configuration
                0x0000   // STATUS: Status (no faults)
            ];

            const hexVals = statusRegs.map(v => v.toString(16).toUpperCase().padStart(4, '0'));
            sendResponse(generateResponse('MGS', idx, ...hexVals));
        },

        mgi: function (args) {
            // Motor Get Extended Info: mgi [idx]
            if (args.length < 1) {
                sendResponse(generateAck('mgi', 'ERR_ARGS'));
                return;
            }
            const device = getDevice();
            const idx = parseInt(args[0]);
            const motor = device.getMotor(idx);

            if (!motor) {
                sendResponse(generateAck('mgi', 'ERR_MOTOR'));
                return;
            }

            sendResponse(generateResponse('MXI',
                idx,
                motor.indexPos,
                motor.stallDetected ? 1 : 0
            ));
        },

        mfi: function (args) {
            // Motor Find Index: mfi [idx]
            if (args.length < 1) {
                sendResponse(generateAck('mfi', 'ERR_ARGS'));
                return;
            }
            const device = getDevice();
            const idx = parseInt(args[0]);
            const motor = device.getMotor(idx);

            if (!motor) {
                sendResponse(generateAck('mfi', 'ERR_MOTOR'));
                return;
            }

            // Simulate finding index after some movement
            setTimeout(() => {
                motor.indexPos = Math.floor(Math.random() * 1000) + 100;
                motor.firstIndexPos = motor.indexPos;
                const motorPosAtIndex = Math.floor(motor.position + (Math.random() - 0.5) * 2000);

                sendResponse(generateResponse('MFI',
                    idx,
                    1,  // found
                    motor.indexPos,
                    motorPosAtIndex,
                    motor.position
                ));
            }, 500);  // Simulate search time
        },

        mrw: function (args) {
            // Motor Rewind: mrw [idx] [direction]
            if (args.length < 2) {
                sendResponse(generateAck('mrw', 'ERR_ARGS'));
                return;
            }
            const device = getDevice();
            const idx = parseInt(args[0]);
            const direction = parseInt(args[1]);  // -1 or 1
            const motor = device.getMotor(idx);

            if (!motor) {
                sendResponse(generateAck('mrw', 'ERR_MOTOR'));
                return;
            }

            // Simulate rewind operation
            setTimeout(() => {
                const startPos = motor.position;
                if (direction < 0) {
                    motor.position = motor.minValue;
                } else {
                    motor.position = motor.maxValue;
                }
                motor.targetPosition = motor.position;
                const movement = Math.abs(motor.position - startPos);

                sendResponse(generateResponse('MRW',
                    idx,
                    1,  // completed
                    motor.position,
                    movement
                ));
            }, 1000);  // Simulate rewind time
        },

        mss: function (args) {
            // Motor Stream Settings (set): mss [posRate]
            if (args.length < 1) {
                sendResponse(generateAck('mss', 'ERR_ARGS'));
                return;
            }
            const device = getDevice();
            device.motorPosStreamRate = parseInt(args[0]) || 100;
            device.streams.motorPosition.rate = device.motorPosStreamRate;
            sendResponse(generateAck('mss', 'OK'));
        },

        msg: function (args) {
            // Motor Settings Get: msg
            const device = getDevice();
            sendResponse(generateResponse('MST', device.motorPosStreamRate));
        },

        // ----- Sensor Stream Settings -----

        sss: function (args) {
            // Sensor Stream Settings (set): sss [impRate] [viRate]
            if (args.length < 2) {
                sendResponse(generateAck('sss', 'ERR_ARGS'));
                return;
            }
            const device = getDevice();
            device.impStreamRate = parseInt(args[0]) || 100;
            device.viStreamRate = parseInt(args[1]) || 100;
            sendResponse(generateAck('sss', 'OK'));
        },

        ssg: function (args) {
            // Sensor Stream Settings (get): ssg
            const device = getDevice();
            sendResponse(generateResponse('SST', device.impStreamRate, device.viStreamRate));
        },

        // ----- VSWR Settings Commands -----

        asv: function (args) {
            // Auto-matching Set VSWR: asv [start] [stop] [restart]
            if (args.length < 3) {
                sendResponse(generateAck('asv', 'ERR_ARGS'));
                return;
            }
            const device = getDevice();
            device.vswrStart = parseFloat(args[0]) || 1.04;
            device.vswrStop = parseFloat(args[1]) || 1.02;
            device.vswrRestart = parseFloat(args[2]) || 1.04;
            sendResponse(generateAck('asv', 'OK'));
        },

        agv: function (args) {
            // Auto-matching Get VSWR: agv
            const device = getDevice();
            sendResponse(generateResponse('VSW',
                formatFloat(device.vswrStart, 2),
                formatFloat(device.vswrStop, 2),
                formatFloat(device.vswrRestart, 2)
            ));
        },

        // ----- AMS Commands -----

        ass: function (args) {
            // AMS Settings Set: ass [interval] [timeout] [logInterval]
            if (args.length < 3) {
                sendResponse(generateAck('ass', 'ERR_ARGS'));
                return;
            }
            const device = getDevice();
            device.amsInterval = parseInt(args[0]) || 10;
            device.amsTimeout = parseInt(args[1]) || 0;
            device.amsLogInterval = parseInt(args[2]) || 10;
            sendResponse(generateAck('ass', 'OK'));
        },

        asg: function (args) {
            // AMS Settings Get: asg
            const device = getDevice();
            sendResponse(generateResponse('AST',
                device.amsInterval,
                device.amsTimeout,
                device.amsLogInterval
            ));
        },

        // ----- Auto Matching Commands (AMC, AMG, AMR, AMS) -----

        amc: function (args) {
            // Auto Match Calculate: amc <Rm> <Xm> [Rpm] [Xpm]
            // Returns all impedance points A~E, Plasma, and VSWR
            if (args.length < 2) {
                sendResponse(generateAck('amc', 'ERR_ARGS'));
                return;
            }

            const device = getDevice();
            const Rm = parseFloat(args[0]);
            const Xm = parseFloat(args[1]);

            // Get current VVC capacitances (pF)
            const VVC0_pF = device.motors[0].getCapacitance() / 100;
            const VVC1_pF = device.motors[1].getCapacitance() / 100;

            // Calculate all impedance points
            const pts = RF.mock.physics.calculateAllImpedances(Rm, Xm, VVC0_pF, VVC1_pF);

            // AMC,RA,XA,RB,XB,RC,XC,RD,XD,RE,XE,Rp,Xp,VSWR,EN
            sendResponse(generateResponse('AMC',
                formatFloat(pts.RA, 2), formatFloat(pts.XA, 2),
                formatFloat(pts.RB, 2), formatFloat(pts.XB, 2),
                formatFloat(pts.RC, 2), formatFloat(pts.XC, 2),
                formatFloat(pts.RD, 2), formatFloat(pts.XD, 2),
                formatFloat(pts.RE, 2), formatFloat(pts.XE, 2),
                formatFloat(pts.Rp, 2), formatFloat(pts.Xp, 2),
                formatFloat(pts.VSWR, 2)
            ));
            sendResponse(generateAck('amc', 'OK'));
        },

        amg: function (args) {
            // Auto Match Goals: amg <Rm> <Xm> [Rpm] [Xpm]
            // Returns target VVC values for 50Ω matching (2 solutions)
            if (args.length < 2) {
                sendResponse(generateAck('amg', 'ERR_ARGS'));
                return;
            }

            const device = getDevice();
            const Rm = parseFloat(args[0]);
            const Xm = parseFloat(args[1]);

            // Get current VVC capacitances (pF)
            const VVC0_pF = device.motors[0].getCapacitance() / 100;
            const VVC1_pF = device.motors[1].getCapacitance() / 100;

            // Calculate matching goals
            const goals = RF.mock.physics.calculateMatchingGoals(
                Rm, Xm, VVC0_pF, VVC1_pF,
                device.motors[0], device.motors[1]
            );

            // AMG,VVC0G0,VVC1G0,Step0G0,Step1G0,Valid0,VVC0G1,VVC1G1,Step0G1,Step1G1,Valid1,EN
            sendResponse(generateResponse('AMG',
                formatFloat(goals.VVC0Goal0, 2), formatFloat(goals.VVC1Goal0, 2),
                goals.step0Goal0, goals.step1Goal0, goals.valid0 ? 1 : 0,
                formatFloat(goals.VVC0Goal1, 2), formatFloat(goals.VVC1Goal1, 2),
                goals.step0Goal1, goals.step1Goal1, goals.valid1 ? 1 : 0
            ));
            sendResponse(generateAck('amg', 'OK'));
        },

        amr: function (args) {
            // Auto Match Run: amr <Rm> <Xm> [Rpm] [Xpm]
            // Calculate goals and move motors to matching position
            if (args.length < 2) {
                sendResponse(generateAck('amr', 'ERR_ARGS'));
                return;
            }

            const device = getDevice();
            const Rm = parseFloat(args[0]);
            const Xm = parseFloat(args[1]);

            // Get current VVC capacitances (pF)
            const VVC0_pF = device.motors[0].getCapacitance() / 100;
            const VVC1_pF = device.motors[1].getCapacitance() / 100;

            // Calculate matching goals
            const goals = RF.mock.physics.calculateMatchingGoals(
                Rm, Xm, VVC0_pF, VVC1_pF,
                device.motors[0], device.motors[1]
            );

            // Check which goal is valid and within limits
            let selectedGoal = -1;
            let targetStep0 = 0, targetStep1 = 0;

            const m0 = device.motors[0];
            const m1 = device.motors[1];

            // Check Goal 0
            const cap0Goal0 = Math.round(goals.VVC0Goal0 * 100);
            const cap1Goal0 = Math.round(goals.VVC1Goal0 * 100);
            const goal0_valid = goals.valid0 &&
                cap0Goal0 >= m0.minCap && cap0Goal0 <= m0.maxCap &&
                cap1Goal0 >= m1.minCap && cap1Goal0 <= m1.maxCap;

            // Check Goal 1
            const cap0Goal1 = Math.round(goals.VVC0Goal1 * 100);
            const cap1Goal1 = Math.round(goals.VVC1Goal1 * 100);
            const goal1_valid = goals.valid1 &&
                cap0Goal1 >= m0.minCap && cap0Goal1 <= m0.maxCap &&
                cap1Goal1 >= m1.minCap && cap1Goal1 <= m1.maxCap;

            if (goal0_valid) {
                selectedGoal = 0;
                targetStep0 = goals.step0Goal0;
                targetStep1 = goals.step1Goal0;
            } else if (goal1_valid) {
                selectedGoal = 1;
                targetStep0 = goals.step0Goal1;
                targetStep1 = goals.step1Goal1;
            }

            if (selectedGoal >= 0) {
                // Move motors
                m0.runMotor(targetStep0);
                m1.runMotor(targetStep1);

                // Start motor streaming
                RF.mock.physics.startMotorStream();

                // AMR,SelectedGoal,Step0,Step1,EN
                sendResponse(generateResponse('AMR', selectedGoal, targetStep0, targetStep1));
                sendResponse(generateAck('amr', 'OK'));
            } else {
                sendResponse(generateAck('amr', 'NO_VALID_GOAL'));
            }
        },

        ams: function (args) {
            // Auto Matching with Sensor: ams [start|stop] [interval] [timeout]
            // Continuous matching using internal sensors
            const action = args.length >= 1 ? args[0].toLowerCase() : 'start';

            if (action === 'stop') {
                // Stop AMS
                if (RF.mock.ams && RF.mock.ams.stop) {
                    RF.mock.ams.stop();
                }
                sendResponse(generateAck('ams', 'STOP'));
                return;
            }

            // Parse optional parameters
            const device = getDevice();
            const interval = args.length >= 2 ? parseInt(args[1]) || device.amsInterval : device.amsInterval;
            const timeout = args.length >= 3 ? parseInt(args[2]) || device.amsTimeout : device.amsTimeout;

            // Start AMS
            if (RF.mock.ams && RF.mock.ams.start) {
                RF.mock.ams.start(interval, timeout);
            } else {
                // Fallback: simple simulation
                sendResponse(generateResponse('AMS', 'RUN', formatFloat(2.5, 2)));
                setTimeout(() => {
                    sendResponse(generateResponse('AMS', 'MATCHED', formatFloat(1.01, 2)));
                    sendResponse(generateAck('ams', 'SUCCESS'));
                }, 2000);
            }
        },

        // ----- Save Commands -----

        sa: function (args) {
            // Save All
            sendResponse(generateAck('sa', 'OK'));
        },

        si: function (args) {
            // Save Info
            sendResponse(generateAck('si', 'OK'));
        },

        sc: function (args) {
            // Save Calibration
            sendResponse(generateAck('sc', 'OK'));
        },

        sm: function (args) {
            // Save Motor
            sendResponse(generateAck('sm', 'OK'));
        },

        sv: function (args) {
            // Save VSWR
            sendResponse(generateAck('sv', 'OK'));
        },

        ss: function (args) {
            // Save Stream Settings
            sendResponse(generateAck('ss', 'OK'));
        }
    };

    // ========================================
    // Main Mock Engine Interface
    // ========================================

    /**
     * Process a command through the mock engine
     * @param {string} cmdLine - Full command line
     * @returns {boolean} True if command was handled
     */
    RF.mock.processCommand = function (cmdLine) {
        if (!mockEngineEnabled) {
            return false;
        }

        const { cmd, args } = parseCommand(cmdLine);

        if (cmd === '') {
            return false;
        }

        // Find handler
        const handler = commandHandlers[cmd];
        if (typeof handler === 'function') {
            console.log(`[MockEngine] Processing: ${cmd} ${args.join(' ')}`);
            try {
                handler(args);
            } catch (error) {
                console.error(`[MockEngine] Error processing ${cmd}:`, error);
                sendResponse(generateAck(cmd, 'ERR_INTERNAL'));
            }
            return true;
        } else {
            console.warn(`[MockEngine] Unknown command: ${cmd}`);
            sendResponse(`Unknown command: ${cmd}\r\n`);
            return true;  // Still handled (error response sent)
        }
    };

    /**
     * Enable or disable mock engine
     * @param {boolean} enabled - Enable state
     */
    RF.mock.setEnabled = function (enabled) {
        mockEngineEnabled = enabled;
        console.log(`[MockEngine] ${enabled ? 'Enabled' : 'Disabled'}`);
    };

    /**
     * Check if mock engine is enabled
     * @returns {boolean} Enable state
     */
    RF.mock.isEnabled = function () {
        return mockEngineEnabled;
    };

    /**
     * Get all registered command names
     * @returns {string[]} Command names
     */
    RF.mock.getCommands = function () {
        return Object.keys(commandHandlers);
    };

    console.log('MockEngine initialized with', Object.keys(commandHandlers).length, 'commands');
})();

