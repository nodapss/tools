/**
 * VVC Calibration Helper - Serial Communication Module
 * Simplified Web Serial API wrapper for motor control
 */

const VVCSerial = (function () {
    let port = null;
    let reader = null;
    let keepReading = false;
    let buffer = '';

    // Response callback
    let onDataReceived = null;
    let onLogMessage = null;

    // Pending response handling
    const pendingResponses = new Map();
    const RESPONSE_TIMEOUT = 2000;

    /**
     * Check if Web Serial API is supported
     */
    function isSupported() {
        return 'serial' in navigator;
    }

    /**
     * Request a serial port from the user
     */
    async function requestPort() {
        if (!isSupported()) {
            throw new Error('Web Serial API not supported in this browser');
        }

        try {
            port = await navigator.serial.requestPort();
            log('Port selected', 'info');
            return true;
        } catch (e) {
            if (e.name === 'NotFoundError') {
                log('Port selection cancelled', 'info');
            } else {
                log('Port selection failed: ' + e.message, 'error');
            }
            return false;
        }
    }

    /**
     * Connect to the selected port
     */
    async function connect(baudRate = 921600) {
        if (!port) {
            throw new Error('No port selected');
        }

        try {
            await port.open({ baudRate });
            keepReading = true;
            readLoop();
            log(`Connected at ${baudRate} baud`, 'info');
            return true;
        } catch (e) {
            log('Connection failed: ' + e.message, 'error');
            throw e;
        }
    }

    /**
     * Disconnect from the port
     */
    async function disconnect() {
        keepReading = false;

        if (reader) {
            try {
                await reader.cancel();
            } catch (e) { /* ignore */ }
            try {
                reader.releaseLock();
            } catch (e) { /* ignore */ }
            reader = null;
        }

        if (port) {
            try {
                await port.close();
            } catch (e) { /* ignore */ }
        }

        log('Disconnected', 'info');
    }

    /**
     * Check if connected
     */
    function isConnected() {
        return port && port.readable && keepReading;
    }

    /**
     * Send a command to the device
     */
    async function sendCommand(cmd, waitForResponse = false, responseKey = null) {
        if (!cmd) return null;

        log(cmd, 'sent');

        if (!port || !port.writable) {
            log('Not connected', 'error');
            return null;
        }

        try {
            const encoder = new TextEncoder();
            const writer = port.writable.getWriter();
            await writer.write(encoder.encode(cmd + '\r\n'));
            writer.releaseLock();

            if (waitForResponse && responseKey) {
                return new Promise((resolve, reject) => {
                    const timeoutId = setTimeout(() => {
                        pendingResponses.delete(responseKey);
                        reject(new Error(`Timeout waiting for response: ${responseKey}`));
                    }, RESPONSE_TIMEOUT);

                    pendingResponses.set(responseKey, {
                        resolve: (data) => {
                            clearTimeout(timeoutId);
                            pendingResponses.delete(responseKey);
                            resolve(data);
                        },
                        reject: (error) => {
                            clearTimeout(timeoutId);
                            pendingResponses.delete(responseKey);
                            reject(error);
                        }
                    });
                });
            }

            return true;
        } catch (e) {
            log('Send error: ' + e.message, 'error');
            throw e;
        }
    }

    /**
     * Read loop for incoming data
     */
    async function readLoop() {
        while (port.readable && keepReading) {
            const textDecoder = new TextDecoderStream();
            const readableStreamClosed = port.readable.pipeTo(textDecoder.writable);
            reader = textDecoder.readable.getReader();

            try {
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    if (value) {
                        processIncomingData(value);
                    }
                }
            } catch (e) {
                if (keepReading) {
                    console.error('Read error:', e);
                }
            } finally {
                reader.releaseLock();
            }
        }
    }

    /**
     * Process incoming data chunks
     */
    function processIncomingData(chunk) {
        buffer += chunk;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop(); // Keep incomplete line

        lines.forEach(line => {
            if (line.trim().length > 0) {
                parseLine(line.trim());
            }
        });
    }

    /**
     * Parse a complete line of data
     */
    function parseLine(line) {
        log(line, 'received');

        // Parse OpCode format: OPCODE,value1,value2,...,EN
        const parts = line.split(',');
        if (parts.length < 2 || parts[parts.length - 1] !== 'EN') {
            return;
        }

        const opcode = parts[0].toUpperCase();
        const dataFields = parts.slice(1, -1);

        // Handle specific opcodes
        switch (opcode) {
            case 'MGP':
                // Motor Get Position: MGP,idx,position,percent,EN
                handleMotorPosition(dataFields);
                break;
            case 'ACK':
                // Acknowledgment: ACK,command,status,EN
                handleAck(dataFields);
                break;
            case 'MPB':
                // Motor Position Both: MPB,pos0,percent0,cap0,pos1,percent1,cap1,EN
                handleMotorPositionBoth(dataFields);
                break;
            default:
                // Notify callback for unknown opcodes
                if (onDataReceived) {
                    onDataReceived(opcode, dataFields);
                }
        }
    }

    /**
     * Handle Motor Position response
     */
    function handleMotorPosition(fields) {
        if (fields.length < 3) return;

        const motorIndex = parseInt(fields[0]);
        const position = parseInt(fields[1]);
        const percent = parseInt(fields[2]);

        const responseKey = `mgp_${motorIndex}`;
        const pending = pendingResponses.get(responseKey);

        const data = { motorIndex, position, percent };

        if (pending) {
            pending.resolve(data);
        }

        if (onDataReceived) {
            onDataReceived('MGP', data);
        }
    }

    /**
     * Handle Motor Position Both response
     */
    function handleMotorPositionBoth(fields) {
        if (fields.length < 6) return;

        const data = {
            motor0: {
                position: parseInt(fields[0]),
                percent: parseInt(fields[1]),
                capacitance: parseInt(fields[2]) / 10
            },
            motor1: {
                position: parseInt(fields[3]),
                percent: parseInt(fields[4]),
                capacitance: parseInt(fields[5]) / 10
            }
        };

        if (onDataReceived) {
            onDataReceived('MPB', data);
        }
    }

    /**
     * Handle ACK response
     */
    function handleAck(fields) {
        if (fields.length < 2) return;

        const command = fields[0].toLowerCase();
        const status = fields[1];

        const pending = pendingResponses.get(command);
        if (pending) {
            if (status === 'OK') {
                pending.resolve(status);
            } else {
                pending.reject(new Error(`ACK error: ${status}`));
            }
        }

        if (onDataReceived) {
            onDataReceived('ACK', { command, status });
        }
    }

    /**
     * Log a message
     */
    function log(message, type = 'info') {
        if (onLogMessage) {
            onLogMessage(message, type);
        }
    }

    /**
     * Set callback for received data
     */
    function setDataCallback(callback) {
        onDataReceived = callback;
    }

    /**
     * Set callback for log messages
     */
    function setLogCallback(callback) {
        onLogMessage = callback;
    }

    // Motor control commands

    /**
     * Read motor position
     * @param {number} motorIndex - 0 or 1
     */
    async function readMotorPosition(motorIndex) {
        const cmd = `MGP ${motorIndex}`;
        return sendCommand(cmd, true, `mgp_${motorIndex}`);
    }

    /**
     * Move motor to position (force move)
     * @param {number} motorIndex - 0 or 1
     * @param {number} position - Target position
     */
    async function moveMotor(motorIndex, position) {
        const cmd = `mf ${motorIndex} ${position}`;
        return sendCommand(cmd, false);
    }

    /**
     * Set motor to standby mode (CTRL register = 553 = 0x229)
     * @param {number} motorIndex - 0 or 1
     */
    async function motorStandby(motorIndex) {
        const cmd = `msc ${motorIndex} 553`;
        return sendCommand(cmd, false);
    }

    /**
     * Initialize motor driver (same as standby for now)
     * @param {number} motorIndex - 0 or 1
     */
    async function motorInit(motorIndex) {
        const cmd = `msc ${motorIndex} 553`;
        return sendCommand(cmd, false);
    }

    /**
     * Disable motor driver (CTRL register = 552 = 0x228)
     * @param {number} motorIndex - 0 or 1
     */
    async function motorDisable(motorIndex) {
        const cmd = `msc ${motorIndex} 552`;
        return sendCommand(cmd, false);
    }

    /**
     * Set motor origin (current position as zero)
     * @param {number} motorIndex - 0 or 1
     */
    async function motorSetOrigin(motorIndex) {
        const cmd = `mo ${motorIndex}`;
        return sendCommand(cmd, false);
    }

    /**
     * Start motor position streaming
     * @param {number} rateMs - Update rate in milliseconds
     */
    async function startPositionStream(rateMs = 100) {
        const cmd = `mrp run ${rateMs}`;
        return sendCommand(cmd, false);
    }

    /**
     * Stop motor position streaming
     */
    async function stopPositionStream() {
        const cmd = `mrp stop`;
        return sendCommand(cmd, false);
    }

    // Public API
    return {
        isSupported,
        requestPort,
        connect,
        disconnect,
        isConnected,
        sendCommand,
        setDataCallback,
        setLogCallback,

        // Motor commands
        readMotorPosition,
        moveMotor,
        motorStandby,
        motorInit,
        motorDisable,
        motorSetOrigin,
        startPositionStream,
        stopPositionStream
    };
})();

