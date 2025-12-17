/**
 * Format 변환 유틸리티
 */
const FormatConverter = {
    /**
     * dB를 선형 크기로 변환
     */
    dbToLinear(db) {
        return Math.pow(10, db / 20);
    },

    /**
     * 선형 크기를 dB로 변환
     */
    linearToDb(linear) {
        if (linear <= 0) return -100;
        return 20 * Math.log10(linear);
    },

    /**
     * 반사계수 크기(dB)를 SWR로 변환
     */
    dbToSwr(db) {
        const gamma = Math.pow(10, db / 20);
        if (gamma >= 1) return 999;
        return (1 + gamma) / (1 - gamma);
    },

    /**
     * SWR을 반사계수 크기(dB)로 변환
     */
    swrToDb(swr) {
        if (swr <= 1) return -100;
        const gamma = (swr - 1) / (swr + 1);
        return 20 * Math.log10(gamma);
    },

    /**
     * 복소수에서 위상 계산 (degrees)
     */
    complexToPhase(real, imag) {
        return Math.atan2(imag, real) * (180 / Math.PI);
    },

    /**
     * 복소수에서 크기 계산 (dB)
     */
    complexToMagDb(real, imag) {
        const mag = Math.sqrt(real * real + imag * imag);
        return this.linearToDb(mag);
    }
};

/**
 * CSV 파서 유틸리티
 */
const CSVParser = {
    /**
     * Keysight VNA CSV 형식인지 확인
     */
    isKeysightFormat(csvString) {
        return csvString.startsWith('!CSV') || csvString.includes('!Keysight');
    },

    /**
     * Keysight VNA CSV 파싱
     */
    parseKeysight(csvString) {
        const lines = csvString.trim().split('\n');
        const result = {
            metadata: { version: '', device: '', date: '', source: '' },
            header: '',
            measurementType: '',
            sParameter: '',
            unit: '',
            data: []
        };

        let inDataBlock = false;
        let headerParsed = false;

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            if (trimmed.startsWith('!')) {
                if (trimmed.startsWith('!CSV')) {
                    result.metadata.version = trimmed.substring(5).trim();
                } else if (trimmed.includes('Keysight') || trimmed.includes('Agilent')) {
                    result.metadata.device = trimmed.substring(1).trim();
                } else if (trimmed.startsWith('!Date:')) {
                    result.metadata.date = trimmed.substring(6).trim();
                } else if (trimmed.startsWith('!Source:')) {
                    result.metadata.source = trimmed.substring(8).trim();
                }
                continue;
            }

            if (trimmed.startsWith('BEGIN')) {
                inDataBlock = true;
                continue;
            }

            if (trimmed === 'END') {
                inDataBlock = false;
                continue;
            }

            if (inDataBlock) {
                if (!headerParsed && trimmed.toLowerCase().includes('freq')) {
                    result.header = trimmed;
                    this._parseKeysightHeader(trimmed, result);
                    headerParsed = true;
                    continue;
                }

                const values = trimmed.split(',').map(v => parseFloat(v.trim()));
                if (values.length >= 2 && !isNaN(values[0]) && !isNaN(values[1])) {
                    result.data.push({
                        frequency: values[0],
                        value: values[1]
                    });
                }
            }
        }

        return result;
    },

    /**
     * Keysight 헤더 파싱
     */
    _parseKeysightHeader(header, result) {
        const sParamMatch = header.match(/S(\d)(\d)/i);
        if (sParamMatch) {
            result.sParameter = `S${sParamMatch[1]}${sParamMatch[2]}`;
        }

        const headerLower = header.toLowerCase();

        if (headerLower.includes('log mag')) {
            result.measurementType = 'Log Mag';
            result.unit = 'dB';
        } else if (headerLower.includes('lin mag')) {
            result.measurementType = 'Lin Mag';
            result.unit = 'U';
        } else if (headerLower.includes('phase')) {
            result.measurementType = 'Phase';
            result.unit = '°';
        } else if (headerLower.includes('swr')) {
            result.measurementType = 'SWR';
            result.unit = 'U';
        } else if (headerLower.includes('delay')) {
            result.measurementType = 'Delay';
            result.unit = 's';
        }
    },

    /**
     * Keysight 데이터를 그래프용으로 변환
     */
    convertKeysightToGraphData(keysightData) {
        const { measurementType, data } = keysightData;

        return data.map(point => {
            const result = {
                frequency: point.frequency,
                value: point.value,
                measurementType: measurementType
            };

            switch (measurementType) {
                case 'Log Mag':
                    result.s11_db = point.value;
                    break;
                case 'Lin Mag':
                    result.s11_db = FormatConverter.linearToDb(point.value);
                    break;
                case 'SWR':
                    result.s11_db = FormatConverter.swrToDb(point.value);
                    break;
                case 'Phase':
                    result.phase = point.value;
                    result.s11_db = 0;
                    break;
                default:
                    result.s11_db = point.value;
            }

            return result;
        });
    },

    /**
     * Custom Format Parser (User Defined)
     * A1: S-Param, B1: R0, C1: X0
     * Row 3+: Freq, Real, Imag
     */
    parseCustomFormat(csvString) {
        const lines = csvString.trim().split('\n');
        const data = [];
        let metadata = { sParameter: '', z0: { r: 50, x: 0 } };

        // Parse Header (Row 1)
        if (lines.length >= 1) {
            const parts = lines[0].split(',').map(s => s.trim());
            metadata.sParameter = parts[0];
            if (parts.length >= 2) metadata.z0.r = parseFloat(parts[1]) || 50;
            if (parts.length >= 3) metadata.z0.x = parseFloat(parts[2]) || 0;
        }

        // Parse Data (Row 3 onwards)
        for (let i = 2; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const values = line.split(/[,\t;]+/).map(v => parseFloat(v));
            if (values.length >= 3 && !isNaN(values[0])) {
                const freq = values[0];
                const real = values[1];
                const imag = values[2];

                data.push({
                    frequency: freq,
                    s11_real: real,
                    s11_imag: imag,
                    s11_db: FormatConverter.complexToMagDb(real, imag),
                    phase: FormatConverter.complexToPhase(real, imag)
                });
            }
        }

        return { data, metadata };
    },

    /**
     * Matching Range CSV 파싱
     */
    parseMatchingRange(csvString) {
        const lines = csvString.trim().split('\n');
        const paths = []; // Array of { points: [] }
        let currentPathId = -1;

        // Skip Header (Row 1 is "Matching Range...", Row 2 is "PathId,Real,Imag")
        // Start from Row 3
        for (let i = 2; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const values = line.split(/[,\t;]+/).map(v => parseFloat(v));
            if (values.length >= 3 && !isNaN(values[0])) {
                const pathId = values[0];
                const real = values[1];
                const imag = values[2];

                // If new path ID, start new path object
                if (pathId !== currentPathId) {
                    currentPathId = pathId;
                    // Ensure the array index exists
                    while (paths.length <= pathId) {
                        paths.push({ points: [] });
                    }
                }

                paths[pathId].points.push({ real, imag });
            }
        }

        // Filter out empty paths
        const validPaths = paths.filter(p => p && p.points && p.points.length > 0);

        return {
            dataType: 'matchingRange',
            paths: validPaths,
            metadata: { type: 'matchingRange' }
        };
    },

    /**
     * CSV 파싱 (자동 형식 감지)
     */
    parse(csvString) {
        const lines = csvString.trim().split('\n');

        // Check for Matching Range Format
        if (lines.length > 0) {
            const firstLine = lines[0].toLowerCase();
            if (firstLine.includes('matching range')) {
                return this.parseMatchingRange(csvString);
            }
        }

        // Custom Format Check (Row 1 Col 1 is S-Param)
        if (lines.length > 0) {
            const firstCell = lines[0].split(',')[0].trim().toUpperCase();
            if (['S11', 'S12', 'S21', 'S22'].includes(firstCell)) {
                return this.parseCustomFormat(csvString);
            }
        }

        if (this.isKeysightFormat(csvString)) {
            const keysightData = this.parseKeysight(csvString);
            const graphData = this.convertKeysightToGraphData(keysightData);
            return {
                data: graphData,
                metadata: {
                    ...keysightData.metadata,
                    sParameter: keysightData.sParameter,
                    measurementType: keysightData.measurementType,
                    unit: keysightData.unit
                }
            };
        }

        if (lines.length < 2) return { data: [], metadata: {} };

        const header = lines[0].toLowerCase();
        const hasHeader = header.includes('freq') || header.includes('hz') || header.includes('s11');
        const startLine = hasHeader ? 1 : 0;

        const data = [];

        for (let i = startLine; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const values = line.split(/[,\t;]+/).map(v => parseFloat(v.trim()));

            if (values.length >= 2 && !isNaN(values[0]) && !isNaN(values[1])) {
                if (values.length >= 3 && !isNaN(values[2])) {
                    const real = values[1];
                    const imag = values[2];
                    data.push({
                        frequency: values[0],
                        s11_db: FormatConverter.complexToMagDb(real, imag),
                        phase: FormatConverter.complexToPhase(real, imag),
                        s11_real: real,
                        s11_imag: imag
                    });
                } else {
                    data.push({
                        frequency: values[0],
                        s11_db: values[1]
                    });
                }
            }
        }

        return { data, metadata: {} };
    },

    /**
     * Touchstone 파일 파싱
     */
    parseTouchstone(content) {
        const lines = content.trim().split('\n');
        const data = [];

        let format = 'RI';
        let freqUnit = 1e9;
        let z0 = 50;

        for (const line of lines) {
            const trimmed = line.trim();

            if (trimmed.startsWith('!')) continue;

            if (trimmed.startsWith('#')) {
                const parts = trimmed.toUpperCase().split(/\s+/);

                if (parts.includes('HZ')) freqUnit = 1;
                else if (parts.includes('KHZ')) freqUnit = 1e3;
                else if (parts.includes('MHZ')) freqUnit = 1e6;
                else if (parts.includes('GHZ')) freqUnit = 1e9;

                if (parts.includes('RI')) format = 'RI';
                else if (parts.includes('MA')) format = 'MA';
                else if (parts.includes('DB')) format = 'DB';

                const rIdx = parts.indexOf('R');
                if (rIdx !== -1 && rIdx + 1 < parts.length) {
                    z0 = parseFloat(parts[rIdx + 1]) || 50;
                }

                continue;
            }

            const values = trimmed.split(/\s+/).map(parseFloat);
            if (values.length >= 3 && !isNaN(values[0])) {
                const freq = values[0] * freqUnit;
                let s11_db, phase;

                if (format === 'RI') {
                    s11_db = FormatConverter.complexToMagDb(values[1], values[2]);
                    phase = FormatConverter.complexToPhase(values[1], values[2]);
                } else if (format === 'MA') {
                    s11_db = FormatConverter.linearToDb(values[1]);
                    phase = values[2];
                } else if (format === 'DB') {
                    s11_db = values[1];
                    phase = values[2];
                }

                data.push({ frequency: freq, s11_db, phase });
            }
        }

        return { data, metadata: { z0, format, freqUnit } };
    }
};

window.FormatConverter = FormatConverter;
window.CSVParser = CSVParser;
