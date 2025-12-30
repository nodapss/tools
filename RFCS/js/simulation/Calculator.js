/**
 * Calculator.js
 * 다중 포트 S-파라미터 계산 엔진
 * 주파수 스윕을 수행하고 각 주파수에서 모든 S-파라미터 계산
 */

class Calculator {
    constructor(circuit) {
        this.circuit = circuit;
        this.analyzer = null;
        this.results = null;
        this.isRunning = false;

        // 시뮬레이션 설정
        this.config = {
            freqStart: 1e6,
            freqEnd: 100e6,
            freqPoints: 201,
            z0: 50
        };

        // 콜백
        this.onProgress = null;
        this.onComplete = null;
        this.onError = null;
    }

    /**
     * Analyzer 인스턴스 획득 (없는 경우 생성)
     */
    getAnalyzer() {
        if (!this.analyzer) {
            this.analyzer = new NetworkAnalyzer(this.circuit);
        }
        return this.analyzer;
    }

    /**
     * Reset Analyzer (Force re-analysis of topology)
     */
    resetAnalyzer() {
        this.analyzer = null;
    }

    /**
     * 시뮬레이션 설정 업데이트
     */
    setConfig(config) {
        Object.assign(this.config, config);
    }

    /**
     * UI에서 주파수 설정 읽기
     */
    readFrequencySettings() {
        const freqStart = parseFloat(document.getElementById('freqStart')?.value || 1);
        const freqStartUnit = parseFloat(document.getElementById('freqStartUnit')?.value || 1e6);
        const freqEnd = parseFloat(document.getElementById('freqEnd')?.value || 100);
        const freqEndUnit = parseFloat(document.getElementById('freqEndUnit')?.value || 1e6);
        const freqPoints = parseInt(document.getElementById('freqPoints')?.value || 201);

        this.config.freqStart = freqStart * freqStartUnit;
        this.config.freqEnd = freqEnd * freqEndUnit;
        this.config.freqPoints = Math.max(2, Math.min(10001, freqPoints));

        // Port의 기준 임피던스 가져오기
        const ports = this.circuit.getAllComponents().filter(c => c.type === 'PORT');
        if (ports.length > 0) {
            this.config.z0 = ports[0].params.impedance || 50;
        }
    }

    /**
     * 시뮬레이션 실행 (다중 포트 지원)
     */
    async run() {
        if (this.isRunning) {
            return { success: false, error: '시뮬레이션이 이미 실행 중입니다.' };
        }

        this.isRunning = true;
        this.results = null;

        try {
            this.readFrequencySettings();

            // 네트워크 분석기 초기화
            this.analyzer = new NetworkAnalyzer(this.circuit);

            const analysisResult = this.analyzer.analyze();
            if (!analysisResult.success) {
                this.isRunning = false;
                if (this.onError) this.onError(analysisResult.error);
                return { success: false, error: analysisResult.error };
            }

            const portCount = analysisResult.portCount;
            const frequencies = this.generateFrequencies();

            // S-파라미터 계산
            const results = await this.calculateAllSParameters(frequencies, portCount);

            // 하위 호환성을 위한 S11 데이터
            const s11Data = results.sMatrix.S11;

            this.results = {
                success: true,
                frequencies: frequencies,
                portCount: portCount,
                sMatrix: results.sMatrix,
                // 하위 호환성
                s11: s11Data ? s11Data.complex : [],
                s11_db: s11Data ? s11Data.mag_db : [],
                s11_phase: s11Data ? s11Data.phase : [],
                zin: results.zin,
                config: { ...this.config }
            };

            this.isRunning = false;

            if (this.onComplete) {
                this.onComplete(this.results);
            }

            return this.results;

        } catch (error) {
            this.isRunning = false;
            const errorMsg = `시뮬레이션 오류: ${error.message}`;
            if (this.onError) this.onError(errorMsg);
            return { success: false, error: errorMsg };
        }
    }

    /**
     * 주파수 배열 생성 (선형)
     */
    generateFrequencies() {
        const { freqStart, freqEnd, freqPoints } = this.config;
        const frequencies = [];
        const step = (freqEnd - freqStart) / (freqPoints - 1);

        for (let i = 0; i < freqPoints; i++) {
            frequencies.push(freqStart + i * step);
        }

        return frequencies;
    }

    /**
     * 주파수 배열 생성 (로그)
     */
    generateFrequenciesLog() {
        const { freqStart, freqEnd, freqPoints } = this.config;
        const frequencies = [];
        const logStart = Math.log10(freqStart);
        const logEnd = Math.log10(freqEnd);
        const step = (logEnd - logStart) / (freqPoints - 1);

        for (let i = 0; i < freqPoints; i++) {
            frequencies.push(Math.pow(10, logStart + i * step));
        }

        return frequencies;
    }

    /**
     * 모든 S-파라미터 계산
     */
    async calculateAllSParameters(frequencies, portCount) {
        const z0 = this.config.z0;
        const totalPoints = frequencies.length;

        // S-파라미터 키 생성 (S11, S21, S12, S22, ...)
        const sParamKeys = [];
        for (let i = 1; i <= portCount; i++) {
            for (let j = 1; j <= portCount; j++) {
                sParamKeys.push(`S${i}${j}`);
            }
        }

        // 결과 구조 초기화
        const sMatrix = {};
        sParamKeys.forEach(key => {
            sMatrix[key] = {
                complex: [],
                mag_db: [],
                phase: []
            };
        });

        const zin = [];

        for (let i = 0; i < totalPoints; i++) {
            const freq = frequencies[i];

            // S-파라미터 계산
            const sParams = this.analyzer.calculateSParameters(freq, z0);

            // 각 S-파라미터 저장
            sParamKeys.forEach(key => {
                const s = sParams[key] || new Complex(0, 0);

                sMatrix[key].complex.push(s);

                const mag = s.magnitude();
                const mag_db = mag > 0 ? 20 * Math.log10(mag) : -100;
                sMatrix[key].mag_db.push(mag_db);

                const phase = s.phaseDeg();
                sMatrix[key].phase.push(phase);
            });

            // 입력 임피던스 (첫 번째 포트)
            const Zin = this.analyzer.calculateInputImpedance(freq);
            zin.push(Zin);

            // 진행 상황
            if (this.onProgress && i % Math.ceil(totalPoints / 100) === 0) {
                const progress = ((i + 1) / totalPoints) * 100;
                this.onProgress(progress);
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        return { sMatrix, zin };
    }

    /**
     * 결과 가져오기
     */
    getResults() {
        return this.results;
    }

    /**
     * 특정 주파수에서 즉시 계산 (캐시 없이)
     * Matching Range 계산에 사용
     * 매번 새로 분석하여 컴포넌트 값 변경을 반영
     */
    calculateAtFrequency(frequency) {
        try {
            // 매번 새로 분석 (컴포넌트 값 변경 반영을 위해)
            const analyzer = new NetworkAnalyzer(this.circuit);
            const analysisResult = analyzer.analyze();
            if (!analysisResult.success) {
                return null;
            }

            // 입력 임피던스 계산
            const zin = analyzer.calculateInputImpedance(frequency);

            // S-파라미터 계산
            const z0 = this.config.z0 || 50;
            const sParams = analyzer.calculateSParameters(frequency, z0);

            return {
                zin: zin,
                sParams: sParams,
                frequency: frequency
            };

        } catch (error) {
            console.warn('calculateAtFrequency error:', error);
            return null;
        }
    }

    /**
     * Simulate a single component in isolation
     * Creates a temporary circuit with PORT and GND connected to specified terminals
     */
    async simulateSingleComponent(component) {
        if (!component.impedanceConfig) return null;

        // --- FAST PATH for IntegratedComponent ---
        // Reuse internal getImpedance logic directly without creating outer tempCircuit
        if (component.type === 'INTEGRATED') {
            console.log('[Calculator] Using Fast Path for IntegratedComponent');
            const compJson = component.toJSON();
            const compClone = new window.IntegratedComponent(0, 0);

            // Restore Internal Data
            if (compJson.subComponents) compClone.subComponents = JSON.parse(JSON.stringify(compJson.subComponents));
            if (compJson.subWires) compClone.subWires = JSON.parse(JSON.stringify(compJson.subWires));
            if (compJson.internalPortConfig) compClone.internalPortConfig = { ...compJson.internalPortConfig };

            // Note: We use strictly the Internal Port Config for calculation as defined by the component's internal structure.
            // The External impedanceConfig (user selection) is implicitly assuming we measure the device as defined.
            // If we needed to measure from arbitrary external pins, we'd need to map 'start'/'end' to internal nodes here.
            // But since IntegratedComponent is 1-Port Shunt defined by internalPortConfig, we just use that.

            const frequencies = this.generateFrequencies();
            const zin = [];

            for (const freq of frequencies) {
                const z = compClone.getImpedance(freq);
                zin.push(new Complex(z.real, z.imag));
            }

            return { frequencies, zin };
        }
        // -----------------------------------------

        // Create temporary circuit
        const tempCircuit = new Circuit();

        // Clone Component
        const compJson = component.toJSON();
        console.log('[Debug] simulateSingleComponent Cloning:', compJson);

        let compClone;
        const type = compJson.type;
        const x = 0, y = 0; // Center it

        // Explicit Factory Logic
        switch (type) {
            case 'R': compClone = new window.Resistor(x, y); break;
            case 'L': compClone = new window.Inductor(x, y); break;
            case 'C': compClone = new window.Capacitor(x, y); break;
            case 'TL': compClone = new window.TransmissionLine(x, y); break;
            case 'Z': compClone = new window.ImpedanceBlock(x, y); break;
            case 'INTEGRATED':
                compClone = new window.IntegratedComponent(x, y);
                // Copy Internal Data
                if (compJson.subComponents) compClone.subComponents = JSON.parse(JSON.stringify(compJson.subComponents));
                if (compJson.subWires) compClone.subWires = JSON.parse(JSON.stringify(compJson.subWires));
                // Copy Config (renamed from impedanceConfig -> internalPortConfig in previous step)
                if (compJson.internalPortConfig) compClone.internalPortConfig = { ...compJson.internalPortConfig };
                break;

            // Add other primitive types as needed
            default:
                if (type.startsWith('COMPOSITE:')) {
                    // Composite Component need special handling or just generic loader
                    // Since specific JS classes might not exist for composite types
                    compClone = new window.CompositeComponent(type, x, y);
                    // For composite, we might need to restore its internal circuit?
                    // toJSON/fromJSON of Composite is complex.
                    // But assume toJSON saves enough info or we can just deep copy logic if needed.
                    if (window.Circuit && window.Circuit.deserialize) {
                        // actually CompositeComponent handles its own structure loading if we pass params
                    }
                } else {
                    // Fallback for basics
                    compClone = new window.Component(type, x, y);
                }
        }

        // Restore params
        if (compClone) {
            compClone.params = { ...compJson.params };
            if (compJson.impedanceConfig) {
                compClone.impedanceConfig = { ...compJson.impedanceConfig };
            }
            if (compJson.rotation) compClone.rotation = compJson.rotation;
            compClone.id = compJson.id + '_sim'; // avoid id conflict

            // CRITICAL: Update terminals to ensure correct positioning after rotation/placement
            if (compClone.updateTerminals) compClone.updateTerminals();

            console.log('[Debug] Cloned Component Terminals:', compClone.terminals);
        } else {
            console.error('[Debug] Failed to clone component:', type);
            return null;
        }

        tempCircuit.addComponent(compClone);

        // Terminals
        const inputTermName = component.impedanceConfig.inputTerminal;
        const gndTermName = component.impedanceConfig.groundTerminal;

        // CRITICAL FIX: Use getTerminalPosition to get ABSOLUTE coordinates (rotated/translated)
        // Accessing .terminals property only gives relative offsets!
        const startPosRaw = compClone.getTerminalPosition(inputTermName);
        const endPosRaw = compClone.getTerminalPosition(gndTermName);

        if (!startPosRaw || !endPosRaw) {
            throw new Error(`Invalid terminals: ${inputTermName}, ${gndTermName}`);
        }

        // Round coordinates to avoid floating point mismatch
        const sx = Math.round(startPosRaw.x);
        const sy = Math.round(startPosRaw.y);
        const ex = Math.round(endPosRaw.x);
        const ey = Math.round(endPosRaw.y);

        // 1. Add PORT (Input)
        // Check relative position to determine port placement
        // Default to Left of startPos. 
        // For rotated components, we might want to be smarter, but fixed offset is fine for topological connection.
        // As long as Wire connects Port to StartPos, it works.
        const portX = sx - 60;
        const portY = sy;
        const port = new window.Port(portX, portY, 1, 50);
        tempCircuit.addComponent(port);

        // 2. Add GND (Reference)
        const gnd = new window.Ground(ex + 60, ey); // Use ex, ey for GND placement
        tempCircuit.addComponent(gnd);

        // 3. Connect Wires
        // Port -> Input Terminal
        // Port terminal is at x + 20. We must start wire there.
        const wire1 = new Wire(port.x + 20, port.y, sx, sy); // Use sx, sy
        wire1.startComponent = port.id; wire1.startTerminal = 'start'; // Port only has 'start' terminal (check Port.js)
        wire1.endComponent = compClone.id; wire1.endTerminal = inputTermName;
        tempCircuit.addWire(wire1);

        // Ground Terminal -> GND
        // Ground terminal is at (0, -20) relative. So gnd.y - 20 is correct.
        const wire2 = new Wire(ex, ey, gnd.x, gnd.y - 20); // Use ex, ey
        wire2.startComponent = compClone.id; wire2.startTerminal = gndTermName;
        wire2.endComponent = gnd.id; wire2.endTerminal = 'start'; // Ground terminal is 'start'
        tempCircuit.addWire(wire2);

        // Debug: Check wire connectivity logic
        // NetworkAnalyzer.js generally relies on spatial analysis OR component.connections if built?
        // Let's explicitly set connections on compClone just in case spatial analysis fails or is skipped for single comp
        // Actually NetworkAnalyzer uses performSpatialAnalysis which builds nodes based on touching wires.
        // But let's look at compClone's connections.
        compClone.connections[inputTermName] = wire1.id;
        compClone.connections[gndTermName] = wire2.id;

        // Also ensure Port and GND have connections set
        port.connections['end'] = wire1.id;
        gnd.connections['start'] = wire2.id;

        console.log('[Debug] Connectivity patched. Wire1:', wire1.id, 'Wire2:', wire2.id);

        // Run Frequency Sweep
        const frequencies = this.generateFrequencies();
        const totalPoints = frequencies.length;
        const zin = [];

        const tempAnalyzer = new NetworkAnalyzer(tempCircuit);
        const analysis = tempAnalyzer.analyze();
        if (!analysis.success) {
            console.error('[Debug] Temp Circuit Analysis Failed:', analysis.error);
            throw new Error(analysis.error);
        }

        for (let i = 0; i < totalPoints; i++) {
            const freq = frequencies[i];
            // Calculate S11
            const sParams = tempAnalyzer.calculateSParameters(freq, 50);
            if (sParams && sParams.S11) {
                // Convert S11 to Zin
                const S11 = sParams.S11;
                const one = new Complex(1, 0);
                const num = one.add(S11);
                const den = one.sub(S11);

                if (den.magnitude() < 1e-9) {
                    zin.push(new Complex(Infinity, 0));
                } else {
                    zin.push(num.div(den).scale(50));
                }
            } else {
                zin.push(new Complex(0, 0));
            }
        }

        console.log(`[Debug] Single Component Sim Complete. Zin[0]: ${zin[0] ? zin[0].toString() : 'N/A'}, Count: ${zin.length}`);
        return { frequencies, zin };
    }

    /**
     * Simulate a sub-circuit (Group Plot)
     * Clones selected components and wires, attaches Port/Ground, and simulates.
     */
    async simulateSubCircuit(groupConfig) {
        if (!groupConfig || !groupConfig.componentIds || groupConfig.componentIds.length === 0) return null;

        const tempCircuit = new Circuit();
        const idMap = new Map(); // Original ID -> Clone Object

        // 1. Clone Components
        for (const id of groupConfig.componentIds) {
            const original = this.circuit.getComponent(id);
            if (!original) continue;

            const compJson = original.toJSON();
            const type = compJson.type;
            const x = compJson.x;
            const y = compJson.y;
            let compClone;

            // Factory (Duplicate of simulateSingleComponent)
            switch (type) {
                case 'R': compClone = new window.Resistor(x, y); break;
                case 'L': compClone = new window.Inductor(x, y); break;
                case 'C': compClone = new window.Capacitor(x, y); break;
                case 'TL': compClone = new window.TransmissionLine(x, y); break;
                case 'Z': compClone = new window.ImpedanceBlock(x, y); break;
                default:
                    if (type.startsWith('COMPOSITE:')) {
                        compClone = new window.CompositeComponent(type, x, y);
                    } else {
                        compClone = new window.Component(type, x, y);
                    }
            }

            if (compClone) {
                compClone.params = { ...compJson.params }; // Deep copy params?
                if (compJson.rotation) compClone.rotation = compJson.rotation;
                compClone.id = `${original.id}_sim`; // Unique ID

                if (compClone.updateTerminals) compClone.updateTerminals();

                tempCircuit.addComponent(compClone);
                idMap.set(original.id, compClone);
            }
        }

        // 2. Clone Wires
        // Only clone wires that are fully internal (both ends in selection) or explicitly selected?
        // Logic: Use wires provided in groupConfig.wireIds
        if (groupConfig.wireIds) {
            for (const textId of groupConfig.wireIds) { // wireIds are usually strings? Check context menu logic.
                // In ContextMenu we passed wire objects or IDs?
                // ContextMenu logic: keys from selectedItems (which are strings) maps to getWire(id).
                // groupConfig.wireIds is array of strings.

                const originalWire = this.circuit.getWire(textId);
                if (!originalWire) continue;

                // Create new wire
                const wireClone = new Wire(originalWire.startX, originalWire.startY, originalWire.endX, originalWire.endY);

                // Remap Connections
                // If start/end component is in our cloned set, map it. Otherwise leave null (open).
                if (originalWire.startComponent && idMap.has(originalWire.startComponent)) {
                    wireClone.startComponent = idMap.get(originalWire.startComponent).id;
                    wireClone.startTerminal = originalWire.startTerminal;
                }
                if (originalWire.endComponent && idMap.has(originalWire.endComponent)) {
                    wireClone.endComponent = idMap.get(originalWire.endComponent).id;
                    wireClone.endTerminal = originalWire.endTerminal;
                }

                tempCircuit.addWire(wireClone);

                // Note: We don't need to manually update compClone.connections because NetworkAnalyzer
                // uses performSpatialAnalysis which rebuilds connectivity based on coordinates.
                // HOWEVER, simulateSingleComponent explicitly set connections.
                // Let's rely on spatial analysis for the sub-circuit, as it's more robust for complex wiring.
                // EXCEPT we need to ensure terminals align.
            }
        }

        // Helper to find coordinate from location object
        const getCoordinates = (loc) => {
            console.log(`[Debug] getCoordinates called for:`, loc);
            // Modal splits "Wire:wire_123" -> id="Wire", terminal="wire_123"
            if (loc.componentId === 'Wire' || loc.componentId.startsWith('Wire:')) {
                // If "Wire:wire_123" was somehow passed as ID (legacy/safety), handle it
                let wireId = loc.terminal;
                if (loc.componentId.startsWith('Wire:')) {
                    wireId = loc.componentId.split(':')[1];
                }

                console.log(`[Debug] Attempting to find wire: ${wireId}`);

                const originalWire = this.circuit.getWire(wireId);
                if (!originalWire) {
                    console.error(`[Debug] Wire lookup failed for ID: ${wireId}`);
                    return null;
                }

                console.log(`[Debug] Found wire. Start coords: ${originalWire.startX}, ${originalWire.startY}`);

                // Use Start position of wire
                return { x: originalWire.startX, y: originalWire.startY };

            } else {
                // Component Terminal
                const comp = idMap.get(loc.componentId);
                if (!comp) {
                    console.error(`[Debug] Component lookup failed for ID: ${loc.componentId} in idMap`);
                    return null;
                }
                return comp.getTerminalPosition(loc.terminal);
            }
        };

        // 3. Attach Input Port
        const inputPos = getCoordinates(groupConfig.inputLocation);
        if (inputPos) {
            const sx = Math.round(inputPos.x);
            const sy = Math.round(inputPos.y);
            console.log(`[Debug] Creating Input Port at ${sx}, ${sy}`);

            // Create Port
            const port = new window.Port(sx - 60, sy, 1, 50);
            tempCircuit.addComponent(port);

            // Connect Wire
            const wireIn = new Wire(port.x + 20, port.y, sx, sy);
            wireIn.startComponent = port.id; wireIn.startTerminal = 'start';

            if (groupConfig.inputLocation.componentId !== 'Wire' && !groupConfig.inputLocation.componentId.startsWith('Wire:')) {
                const clonedComp = idMap.get(groupConfig.inputLocation.componentId);
                if (clonedComp) {
                    wireIn.endComponent = clonedComp.id;
                    wireIn.endTerminal = groupConfig.inputLocation.terminal;
                }
            }
            tempCircuit.addWire(wireIn);
            console.log(`[Debug] Input Port Created: ${port.id}`);
        } else {
            console.error(`[Debug] Failed to determine Input Position. Port NOT created.`);
        }

        // 4. Attach Output Ground
        const outputPos = getCoordinates(groupConfig.outputLocation);
        if (outputPos) {
            const ex = Math.round(outputPos.x);
            const ey = Math.round(outputPos.y);

            // Create Ground
            const gnd = new window.Ground(ex + 60, ey);
            tempCircuit.addComponent(gnd);

            // Connect Wire
            const wireOut = new Wire(ex, ey, gnd.x, gnd.y - 20);

            if (groupConfig.outputLocation.componentId !== 'Wire' && !groupConfig.outputLocation.componentId.startsWith('Wire:')) {
                const clonedComp = idMap.get(groupConfig.outputLocation.componentId);
                if (clonedComp) {
                    wireOut.startComponent = clonedComp.id;
                    wireOut.startTerminal = groupConfig.outputLocation.terminal;
                }
            }

            wireOut.endComponent = gnd.id; wireOut.endTerminal = 'start';

            tempCircuit.addWire(wireOut);
        }

        // 5. Run Simulation
        const frequencies = this.generateFrequencies();
        const zin = [];
        const tempAnalyzer = new NetworkAnalyzer(tempCircuit);
        const analysis = tempAnalyzer.analyze();

        if (!analysis.success) {
            console.error('[Debug] Sub-Circuit Analysis Failed:', analysis.error);
            // return null or empty result?
            // Throwing might break the main loop, let's log and return empty.
            return { frequencies, zin: [] };
        }

        for (let i = 0; i < frequencies.length; i++) {
            const freq = frequencies[i];
            const sParams = tempAnalyzer.calculateSParameters(freq, 50);
            if (sParams && sParams.S11) {
                const S11 = sParams.S11;
                const one = new Complex(1, 0);
                const num = one.add(S11);
                const den = one.sub(S11);
                if (den.magnitude() < 1e-9) {
                    zin.push(new Complex(Infinity, 0));
                } else {
                    zin.push(num.div(den).scale(50));
                }
            } else {
                zin.push(new Complex(0, 0));
            }
        }

        console.log(`[Debug] Group Sim Complete (${groupConfig.name}). Points: ${zin.length}`);
        return { frequencies, zin };
    }

    /**
     * 특정 주파수 결과
     */
    getResultAtFrequency(targetFreq) {
        if (!this.results || !this.results.success) return null;

        const { frequencies, sMatrix } = this.results;

        let minDiff = Infinity;
        let idx = 0;

        for (let i = 0; i < frequencies.length; i++) {
            const diff = Math.abs(frequencies[i] - targetFreq);
            if (diff < minDiff) {
                minDiff = diff;
                idx = i;
            }
        }

        const result = {
            frequency: frequencies[idx],
            index: idx
        };

        // 모든 S-파라미터 값 추가
        Object.keys(sMatrix).forEach(key => {
            result[key] = {
                complex: sMatrix[key].complex[idx],
                mag_db: sMatrix[key].mag_db[idx],
                phase: sMatrix[key].phase[idx]
            };
        });

        return result;
    }

    /**
     * 최소 S11 찾기 (공진점)
     */
    findMinimumS11() {
        if (!this.results || !this.results.success) return null;
        if (!this.results.sMatrix || !this.results.sMatrix.S11) return null;

        const { frequencies } = this.results;
        const s11_db = this.results.sMatrix.S11.mag_db;

        let minDb = Infinity;
        let minIdx = 0;

        for (let i = 0; i < s11_db.length; i++) {
            if (s11_db[i] < minDb) {
                minDb = s11_db[i];
                minIdx = i;
            }
        }

        return {
            frequency: frequencies[minIdx],
            s11_db: minDb,
            index: minIdx
        };
    }

    /**
     * 특정 S-파라미터의 최소값 찾기
     */
    findMinimum(sParam = 'S11') {
        if (!this.results || !this.results.success) return null;
        if (!this.results.sMatrix || !this.results.sMatrix[sParam]) return null;

        const { frequencies } = this.results;
        const mag_db = this.results.sMatrix[sParam].mag_db;

        let minDb = Infinity;
        let minIdx = 0;

        for (let i = 0; i < mag_db.length; i++) {
            if (mag_db[i] < minDb) {
                minDb = mag_db[i];
                minIdx = i;
            }
        }

        return {
            frequency: frequencies[minIdx],
            mag_db: minDb,
            index: minIdx,
            sParam: sParam
        };
    }

    /**
     * 대역폭 계산
     */
    calculateBandwidth(sParam = 'S11', level = -3) {
        if (!this.results || !this.results.success) return null;
        if (!this.results.sMatrix || !this.results.sMatrix[sParam]) return null;

        const { frequencies } = this.results;
        const mag_db = this.results.sMatrix[sParam].mag_db;

        const minPoint = this.findMinimum(sParam);
        if (!minPoint) return null;

        const threshold = minPoint.mag_db - level;

        let leftIdx = minPoint.index;
        while (leftIdx > 0 && mag_db[leftIdx] < threshold) {
            leftIdx--;
        }

        let rightIdx = minPoint.index;
        while (rightIdx < mag_db.length - 1 && mag_db[rightIdx] < threshold) {
            rightIdx++;
        }

        const lowerFreq = frequencies[leftIdx];
        const upperFreq = frequencies[rightIdx];
        const bandwidth = upperFreq - lowerFreq;
        const centerFreq = (lowerFreq + upperFreq) / 2;
        const qFactor = centerFreq / bandwidth;

        return {
            lowerFreq,
            upperFreq,
            bandwidth,
            centerFreq,
            qFactor,
            level,
            sParam
        };
    }

    /**
     * CSV 내보내기
     */
    exportToCSV(sParam = 'S11') {
        if (!this.results || !this.results.success) return null;
        if (!this.results.sMatrix || !this.results.sMatrix[sParam]) return null;

        const { frequencies } = this.results;
        const data = this.results.sMatrix[sParam];

        let csv = `Frequency (Hz),${sParam} Magnitude (dB),${sParam} Phase (deg)\n`;

        for (let i = 0; i < frequencies.length; i++) {
            csv += `${frequencies[i]},${data.mag_db[i].toFixed(4)},${data.phase[i].toFixed(4)}\n`;
        }

        return csv;
    }

    /**
     * 전체 S-파라미터 CSV 내보내기
     */
    exportAllToCSV() {
        if (!this.results || !this.results.success) return null;

        const { frequencies, sMatrix } = this.results;
        const sParams = Object.keys(sMatrix);

        // 헤더
        let csv = 'Frequency (Hz)';
        sParams.forEach(key => {
            csv += `,${key} Mag (dB),${key} Phase (deg)`;
        });
        csv += '\n';

        // 데이터
        for (let i = 0; i < frequencies.length; i++) {
            csv += frequencies[i];
            sParams.forEach(key => {
                csv += `,${sMatrix[key].mag_db[i].toFixed(4)},${sMatrix[key].phase[i].toFixed(4)}`;
            });
            csv += '\n';
        }

        return csv;
    }

    /**
     * CSV 다운로드
     */
    downloadCSV(filename = 's_parameters.csv') {
        const csv = this.exportAllToCSV();
        if (!csv) return;

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
        URL.revokeObjectURL(link.href);
    }

    /**
     * Touchstone 내보내기
     */
    exportToTouchstone() {
        if (!this.results || !this.results.success) return null;

        const { frequencies, sMatrix, portCount } = this.results;
        const z0 = this.config.z0;

        let snp = `! Touchstone file exported from RF Circuit Calculator\n`;
        snp += `! Date: ${new Date().toISOString()}\n`;
        snp += `! Port Count: ${portCount}\n`;
        snp += `# Hz S RI R ${z0}\n`;

        for (let i = 0; i < frequencies.length; i++) {
            snp += `${frequencies[i].toExponential(6)}`;

            for (let p1 = 1; p1 <= portCount; p1++) {
                for (let p2 = 1; p2 <= portCount; p2++) {
                    const key = `S${p1}${p2}`;
                    const s = sMatrix[key].complex[i];
                    snp += ` ${s.real.toFixed(8)} ${s.imag.toFixed(8)}`;
                }
            }
            snp += '\n';
        }

        return snp;
    }

    /**
     * 사용 가능한 S-파라미터 목록
     */
    getAvailableSParams() {
        if (!this.results || !this.results.sMatrix) return [];
        return Object.keys(this.results.sMatrix);
    }
}

// 전역 노출
window.Calculator = Calculator;
