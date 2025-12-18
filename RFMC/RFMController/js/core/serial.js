(function () {
    let port;
    let reader;
    let writer;
    let keepReading = false;
    
    // Response waiting mechanism (for both ACK and data responses)
    const pendingResponses = new Map(); // Map<responseKey, {resolve, reject, timeout}>
    const RESPONSE_TIMEOUT = 1000; // 1 second timeout
    
    // Map commands to expected response OpCodes
    // Format: command -> {opcode, keyExtractor}
    // New command naming: r*=RF, m*=Motor, d*=Device
    function getExpectedResponse(cmd) {
        if (!cmd) return null;
        const parts = cmd.trim().split(/\s+/);
        const baseCmd = parts[0].toUpperCase();
        
        // ===== ACK responses (Set commands) =====
        // Device Set Info
        if (baseCmd === 'DSI') {
            return { opcode: 'ACK', key: 'dsi', keyExtractor: null };
        }
        // RF Set Average
        if (baseCmd === 'RSA') {
            return { opcode: 'ACK', key: 'rsa', keyExtractor: null };
        }
        // Motor Set Limits
        if (baseCmd === 'MSL') {
            return { opcode: 'ACK', key: 'msl', keyExtractor: null };
        }
        // Motor Set Driver
        if (baseCmd === 'MSD') {
            return { opcode: 'ACK', key: 'msd', keyExtractor: null };
        }
        // RF Set Calibration
        if (baseCmd === 'RSC') {
            return { opcode: 'ACK', key: 'rsc', keyExtractor: null };
        }
        // Motor Run Position (stream)
        if (baseCmd === 'MRP') {
            return { opcode: 'ACK', key: 'mrp', keyExtractor: null };
        }
        // Motor Save Setting
        if (baseCmd === 'MSS') {
            return { opcode: 'ACK', key: 'mss', keyExtractor: null };
        }
        // Motor Settings Get
        if (baseCmd === 'MSG') {
            return { opcode: 'MST', key: 'msg', keyExtractor: null };
        }
        
        // ===== Data responses (Get commands) =====
        // Device Get Info (DGI → DGI response)
        if (baseCmd === 'DGI') {
            return { opcode: 'DGI', key: 'dgi', keyExtractor: null };
        }
        
        // RF Get Average (RGA i/o → RGA response)
        if (baseCmd === 'RGA') {
            const channel = parts.length > 1 ? parts[1].toLowerCase() : null;
            if (channel === 'i' || channel === 'o') {
                return { opcode: 'RGA', key: `rga_${channel}`, keyExtractor: channel };
            }
            return null;
        }
        
        // RF Get Calibration (RGC i/o → RGC response)
        if (baseCmd === 'RGC') {
            const channel = parts.length > 1 ? parts[1].toLowerCase() : null;
            if (channel === 'i' || channel === 'o') {
                return { opcode: 'RGC', key: `rgc_${channel}`, keyExtractor: channel };
            }
            return null;
        }
        
        // Motor Get Limits (MGL 0/1 → MGL response)
        if (baseCmd === 'MGL') {
            const motor = parts.length > 1 ? parts[1] : null;
            const motorIdx = parseInt(motor);
            if (!isNaN(motorIdx) && (motorIdx === 0 || motorIdx === 1)) {
                return { opcode: 'MGL', key: `mgl_${motorIdx}`, keyExtractor: motorIdx.toString() };
            }
            return null;
        }
        
        // Motor Fitting Coefficients (MFC 0/1 → MFC response)
        if (baseCmd === 'MFC') {
            const motor = parts.length > 1 ? parts[1] : null;
            const motorIdx = parseInt(motor);
            if (!isNaN(motorIdx) && (motorIdx === 0 || motorIdx === 1)) {
                return { opcode: 'MFC', key: `mfc_${motorIdx}`, keyExtractor: motorIdx.toString() };
            }
            return null;
        }
        
        // Motor Get Position (MGP 0/1 → MGP response)
        if (baseCmd === 'MGP') {
            const motor = parts.length > 1 ? parts[1] : null;
            const motorIdx = parseInt(motor);
            if (!isNaN(motorIdx) && (motorIdx === 0 || motorIdx === 1)) {
                return { opcode: 'MGP', key: `mgp_${motorIdx}`, keyExtractor: motorIdx.toString() };
            }
            return null;
        }
        
        // Motor Get Status (MGS 0/1 → MGS response)
        if (baseCmd === 'MGS') {
            const motor = parts.length > 1 ? parts[1] : null;
            const motorIdx = parseInt(motor);
            if (!isNaN(motorIdx) && (motorIdx === 0 || motorIdx === 1)) {
                return { opcode: 'MGS', key: `mgs_${motorIdx}`, keyExtractor: motorIdx.toString() };
            }
            return null;
        }
        
        // ===== Legacy command support (backwards compatibility) =====
        if (baseCmd === 'SW' || baseCmd === 'SA' || baseCmd === 'SM') {
            return { opcode: 'ACK', key: baseCmd.toLowerCase(), keyExtractor: null };
        }
        if (baseCmd === 'SR') {
            return { opcode: 'SR', key: 'sr', keyExtractor: null };
        }
        if (baseCmd === 'GA') {
            const channel = parts.length > 1 ? parts[1].toLowerCase() : null;
            if (channel === 'i' || channel === 'o') {
                return { opcode: 'GA', key: `ga_${channel}`, keyExtractor: channel };
            }
            return null;
        }
        if (baseCmd === 'GM') {
            const motor = parts.length > 1 ? parts[1] : null;
            const motorIdx = parseInt(motor);
            if (!isNaN(motorIdx) && motorIdx >= 0 && motorIdx <= 31) {
                return { opcode: 'GM', key: `gm_${motorIdx}`, keyExtractor: motorIdx.toString() };
            }
            return null;
        }
        if (baseCmd === 'MP') {
            const motor = parts.length > 1 ? parts[1] : null;
            const motorIdx = parseInt(motor);
            if (!isNaN(motorIdx) && motorIdx >= 0 && motorIdx <= 31) {
                return { opcode: 'MP',
                    key: `mp_${motorIdx}`,
                    keyExtractor: motorIdx.toString()
                };
            }
            return null;
        }
        
        return null;
    }

    RF.core.requestPort = async function () {
        if (!navigator.serial) {
            alert('Web Serial API not supported.');
            return;
        }
        try {
            port = await navigator.serial.requestPort();
            RF.ui.log('Port selected');
            const btnConnect = document.getElementById('btnConnect');
            if (btnConnect) btnConnect.disabled = false;
        } catch (e) {
            RF.ui.log('Port selection failed/cancelled: ' + e.message);
        }
    };

    RF.core.connect = async function () {
        if (!port) {
            alert('Please select a port first.');
            return;
        }

        try {
            const baudRateInput = document.getElementById('baudRate');
            const baudRate = baudRateInput ? parseInt(baudRateInput.value) : 115200;

            await port.open({ baudRate });

            RF.ui.setConnectedState(true);
            RF.ui.log(`Connected at ${baudRate} baud`);

            // Auto-disable mock data when serial is connected
            if (RF.modules.stopMockData) {
                RF.modules.stopMockData();
            }

            keepReading = true;
            readLoop();
        } catch (err) {
            console.error(err);
            RF.ui.log(`Connection failed: ${err.message}`);
            alert('Connection failed: ' + err.message);
        }
    };

    RF.core.disconnect = async function () {
        keepReading = false;
        if (reader) {
            try { await reader.cancel(); } catch (e) { }
            try { await reader.releaseLock(); } catch (e) { }
            reader = null;
        }
        if (writer) {
            try { await writer.close(); } catch (e) { }
            try { await writer.releaseLock(); } catch (e) { }
            writer = null;
        }
        if (port) {
            try { await port.close(); } catch (e) { }
            // port = null; // Keep port selected to allow reconnect
        }
        RF.ui.setConnectedState(false);
        RF.ui.log('Disconnected');
    };

    RF.core.sendCommand = async function (cmd, options = {}) {
        if (!cmd) return Promise.resolve();
        const waitForResponse = options.waitForAck || options.waitForResponse || false;
        
        RF.ui.log(cmd, true);

        // Check if Mock Engine is enabled
        if (RF.mock && RF.mock.isEnabled && RF.mock.isEnabled()) {
            // Route command to Mock Engine
            const handled = RF.mock.processCommand(cmd);
            if (handled) {
                // Mock Engine will send response via processIncomingData
                // Return resolved promise immediately (mock responses are async)
                return Promise.resolve();
            }
        }

        if (!port || !port.writable) {
            return Promise.resolve();
        }

        try {
            const encoder = new TextEncoder();
            const writer = port.writable.getWriter();
            await writer.write(encoder.encode(cmd + '\r\n')); // Add CRLF
            writer.releaseLock();
            
            // If waiting for response, create a promise that resolves when response is received
            if (waitForResponse) {
                const expectedResponse = getExpectedResponse(cmd);
                if (!expectedResponse) {
                    RF.ui.log(`Warning: Cannot determine expected response for: ${cmd}`);
                    return Promise.resolve();
                }
                
                return new Promise((resolve, reject) => {
                    // Set timeout
                    const timeoutId = setTimeout(() => {
                        pendingResponses.delete(expectedResponse.key);
                        const errorMsg = `Timeout waiting for response: ${expectedResponse.opcode} (key: ${expectedResponse.key})`;
                        RF.ui.log(`Error: ${errorMsg}`);
                        reject(new Error(errorMsg));
                    }, RESPONSE_TIMEOUT);
                    
                    // Store promise resolvers
                    pendingResponses.set(expectedResponse.key, {
                        resolve: (data) => {
                            clearTimeout(timeoutId);
                            pendingResponses.delete(expectedResponse.key);
                            resolve(data);
                        },
                        reject: (error) => {
                            clearTimeout(timeoutId);
                            pendingResponses.delete(expectedResponse.key);
                            reject(error);
                        },
                        timeout: timeoutId,
                        opcode: expectedResponse.opcode,
                        keyExtractor: expectedResponse.keyExtractor
                    });
                });
            }
            
            return Promise.resolve();
        } catch (err) {
            RF.ui.log(`Send error: ${err.message}`);
            return Promise.reject(err);
        }
    };
    
    // Resolve pending response promise (called from protocol.js)
    RF.core.resolveResponse = function (opcode, keyExtractor, data) {
        // For ACK responses
        if (opcode === 'ACK') {
            const pending = pendingResponses.get(keyExtractor.toLowerCase());
            if (pending) {
                const status = data && data.status ? data.status : 'OK';
                if (status === 'OK' || status === 'SAVE_FAIL') {
                    pending.resolve(status);
                } else {
                    pending.reject(new Error(`ACK status: ${status}`));
                }
            }
            return;
        }
        
        // For data responses, find matching pending response
        for (const [key, pending] of pendingResponses.entries()) {
            if (pending.opcode === opcode) {
                // Check if keyExtractor matches
                if (pending.keyExtractor === null && keyExtractor === null) {
                    // No key extractor needed (e.g., SR)
                    pending.resolve(data);
                    return;
                } else if (pending.keyExtractor === keyExtractor) {
                    // Key extractor matches (e.g., GA i, GA o, GM 1, GM 2)
                    pending.resolve(data);
                    return;
                }
            }
        }
    };
    
    // Legacy function name for backward compatibility
    RF.core.resolveAck = function (ackCommand, status) {
        RF.core.resolveResponse('ACK', ackCommand, { status: status });
    };

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
                        RF.modules.processIncomingData(value);
                    }
                }
            } catch (err) {
                console.error(err);
            } finally {
                reader.releaseLock();
            }
        }
    }
})();
