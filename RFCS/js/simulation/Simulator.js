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
