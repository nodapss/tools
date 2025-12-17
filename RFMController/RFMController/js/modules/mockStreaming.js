/**
 * MockStreaming - Streaming manager for Mock Serial Engine
 * Handles periodic data transmission (impedance, V/I, motor position)
 */
(function () {
    'use strict';

    // Streaming intervals
    let streamIntervals = {
        impedanceInput: null,
        impedanceOutput: null,
        viInput: null,
        viOutput: null,
        motorPosition: null
    };

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
     * Generate OpCode response string
     * @param {string} opcode - OpCode
     * @param {...any} values - Values to include
     * @returns {string} Formatted response
     */
    function generateResponse(opcode, ...values) {
        return `${opcode},${values.join(',')},EN\r\n`;
    }

    /**
     * Send response to protocol processor
     * @param {string} response - Response string
     */
    function sendResponse(response) {
        if (typeof RF.modules.processIncomingData === 'function') {
            RF.modules.processIncomingData(response);
        }
    }

    /**
     * Get mock device instance
     * @returns {object} MockDevice instance
     */
    function getDevice() {
        return RF.mock.device;
    }

    // ========================================
    // Stream Generators
    // ========================================

    /**
     * Generate and send impedance data
     * @param {boolean} isInput - True for input sensor, false for output
     */
    function streamImpedance(isInput) {
        const opcode = isInput ? 'ZI' : 'ZO';
        
        // Use physics simulator with correct function for input/output
        let data;
        if (RF.mock.physics) {
            if (isInput && RF.mock.physics.calculateInputImpedance) {
                data = RF.mock.physics.calculateInputImpedance();
            } else if (!isInput && RF.mock.physics.calculateOutputImpedance) {
                data = RF.mock.physics.calculateOutputImpedance();
            }
        }
        
        // Fallback to simple simulation
        if (!data) {
            data = {
                R: isInput ? 50 + (Math.random() - 0.5) * 20 : 9 + (Math.random() - 0.5) * 0.02,
                X: isInput ? (Math.random() - 0.5) * 30 : 10 + (Math.random() - 0.5) * 0.02,
                V: isInput ? 100 + (Math.random() - 0.5) * 10 : 30,
                I: isInput ? 2 + (Math.random() - 0.5) * 0.4 : 3.3,
                phase: (Math.random() - 0.5) * 30
            };
        }
        
        sendResponse(generateResponse(opcode,
            formatFloat(data.R, 2),
            formatFloat(data.X, 2),
            formatFloat(data.V, 2),
            formatFloat(data.I, 2),
            formatFloat(data.phase, 2)
        ));
    }

    /**
     * Generate and send V/I magnitude data
     * @param {boolean} isInput - True for input sensor, false for output
     */
    function streamVIMag(isInput) {
        const opcode = isInput ? 'VI' : 'VO';
        
        // Use physics simulator with correct function for input/output
        let V, I;
        if (RF.mock.physics) {
            let data;
            if (isInput && RF.mock.physics.calculateInputImpedance) {
                data = RF.mock.physics.calculateInputImpedance();
            } else if (!isInput && RF.mock.physics.calculateOutputImpedance) {
                data = RF.mock.physics.calculateOutputImpedance();
            }
            if (data) {
                V = data.V;
                I = data.I;
            }
        }
        
        // Fallback
        if (V === undefined) {
            V = isInput ? 100 + (Math.random() - 0.5) * 10 : 30;
            I = isInput ? 2 + (Math.random() - 0.5) * 0.4 : 3.3;
        }
        
        sendResponse(generateResponse(opcode,
            formatFloat(V, 2),
            formatFloat(I, 2)
        ));
    }

    /**
     * Generate and send motor position data for both motors
     */
    function streamMotorPosition() {
        const device = getDevice();
        if (!device) return;
        
        const m0 = device.motors[0];
        const m1 = device.motors[1];
        
        sendResponse(generateResponse('MPB',
            m0.position,
            m0.getPositionPercent(),
            m0.getCapacitance(),
            m1.position,
            m1.getPositionPercent(),
            m1.getCapacitance()
        ));
    }

    // ========================================
    // Stream Control
    // ========================================

    /**
     * Start a specific stream
     * @param {string} streamType - Stream type (impedanceInput, impedanceOutput, viInput, viOutput, motorPosition)
     * @param {number} rateMs - Rate in milliseconds
     */
    function startStream(streamType, rateMs) {
        stopStream(streamType);
        
        let streamFunc;
        switch (streamType) {
            case 'impedanceInput':
                streamFunc = () => streamImpedance(true);
                break;
            case 'impedanceOutput':
                streamFunc = () => streamImpedance(false);
                break;
            case 'viInput':
                streamFunc = () => streamVIMag(true);
                break;
            case 'viOutput':
                streamFunc = () => streamVIMag(false);
                break;
            case 'motorPosition':
                streamFunc = streamMotorPosition;
                break;
            default:
                console.warn('[MockStreaming] Unknown stream type:', streamType);
                return;
        }
        
        streamIntervals[streamType] = setInterval(streamFunc, rateMs);
        console.log(`[MockStreaming] Started ${streamType} stream at ${rateMs}ms`);
    }

    /**
     * Stop a specific stream
     * @param {string} streamType - Stream type
     */
    function stopStream(streamType) {
        if (streamIntervals[streamType]) {
            clearInterval(streamIntervals[streamType]);
            streamIntervals[streamType] = null;
            console.log(`[MockStreaming] Stopped ${streamType} stream`);
        }
    }

    /**
     * Stop all streams
     */
    function stopAllStreams() {
        Object.keys(streamIntervals).forEach(stopStream);
    }

    /**
     * Update streams based on device state
     * Called periodically or when stream settings change
     */
    function updateStreams() {
        const device = getDevice();
        if (!device) return;
        
        // Impedance Input Stream
        if (device.streams.impedanceInput.enabled) {
            if (!streamIntervals.impedanceInput) {
                startStream('impedanceInput', device.streams.impedanceInput.rate);
            }
        } else {
            stopStream('impedanceInput');
        }
        
        // Impedance Output Stream
        if (device.streams.impedanceOutput.enabled) {
            if (!streamIntervals.impedanceOutput) {
                startStream('impedanceOutput', device.streams.impedanceOutput.rate);
            }
        } else {
            stopStream('impedanceOutput');
        }
        
        // V/I Input Stream
        if (device.streams.viInput.enabled) {
            if (!streamIntervals.viInput) {
                startStream('viInput', device.streams.viInput.rate);
            }
        } else {
            stopStream('viInput');
        }
        
        // V/I Output Stream
        if (device.streams.viOutput.enabled) {
            if (!streamIntervals.viOutput) {
                startStream('viOutput', device.streams.viOutput.rate);
            }
        } else {
            stopStream('viOutput');
        }
        
        // Motor Position Stream
        if (device.streams.motorPosition.enabled) {
            if (!streamIntervals.motorPosition) {
                startStream('motorPosition', device.streams.motorPosition.rate);
            }
        } else {
            stopStream('motorPosition');
        }
    }

    // Stream update check interval
    let streamUpdateInterval = null;

    /**
     * Start stream manager (monitors device stream state)
     */
    function startStreamManager() {
        if (streamUpdateInterval) return;
        
        streamUpdateInterval = setInterval(updateStreams, 100);
        console.log('[MockStreaming] Stream manager started');
    }

    /**
     * Stop stream manager
     */
    function stopStreamManager() {
        if (streamUpdateInterval) {
            clearInterval(streamUpdateInterval);
            streamUpdateInterval = null;
        }
        stopAllStreams();
        console.log('[MockStreaming] Stream manager stopped');
    }

    // ========================================
    // Export API
    // ========================================

    if (typeof RF.mock === 'undefined') {
        RF.mock = {};
    }

    RF.mock.streaming = {
        // Stream control
        start: startStreamManager,
        stop: stopStreamManager,
        
        // Individual stream control
        startStream: startStream,
        stopStream: stopStream,
        stopAllStreams: stopAllStreams,
        
        // Update streams based on device state
        updateStreams: updateStreams,
        
        // Manual stream functions (for testing)
        streamImpedance: streamImpedance,
        streamVIMag: streamVIMag,
        streamMotorPosition: streamMotorPosition
    };

    console.log('MockStreaming initialized');
})();

