/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

// 1. Mock Canvas getContext (JSDOM doesn't implement it)
HTMLCanvasElement.prototype.getContext = jest.fn(() => ({
    save: jest.fn(),
    restore: jest.fn(),
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    stroke: jest.fn(),
    fill: jest.fn(),
    measureText: jest.fn(() => ({ width: 0 })),
    fillText: jest.fn(),
    createLinearGradient: jest.fn(() => ({ addColorStop: jest.fn() })),
}));

// 2. Mock Chart.js
window.Chart = jest.fn(function () {
    this.ctx = {};
    this.chartArea = { top: 0, bottom: 100, left: 0, right: 100 };
    this.scales = {
        x: {
            getPixelForValue: jest.fn(x => x),
            getValueForPixel: jest.fn(x => x),
            min: 0, max: 100, left: 0, right: 100
        },
        y: {
            title: {},
            getPixelForValue: jest.fn(y => y),
            getValueForPixel: jest.fn(y => y),
            min: 0, max: 100
        }
    };
    this.canvas = document.createElement('canvas'); // Attach a real canvas element
    this.update = jest.fn();
    this.destroy = jest.fn();
    this.resize = jest.fn();
    this.data = { datasets: [] };
    this.options = {
        plugins: {
            zoom: { limits: {}, zoom: { mode: 'xy' }, pan: { enabled: true } }
        },
        scales: { x: { title: {} }, y: { title: {} } }
    };
});

// 3. Mock MarkerManager
class MockMarkerManager {
    constructor() {
        this.markers = [];
        this.measurementMode = 'sparameter';
        this.tableMode = 'cartesian';
    }
    setMeasurementMode(mode) { this.measurementMode = mode; }
    setTableMode(mode) { this.tableMode = mode; }
    updateTable() { }
    updateHeaders(xLabel, yLabel) { } // Added missing method
    clear() { this.markers = []; }
    addMarker(label, data) {
        // Ensure complexData is preserved if passed
        const marker = { id: 'test-marker-' + this.markers.length, type: label, ...data };
        this.markers.push(marker);
    }
    updateMarker(id, updates) {
        const m = this.markers.find(m => m.id === id);
        if (m) {
            // Deep merge logic simplified
            if (updates.y) m.y = updates.y;
            if (updates.x) m.x = updates.x;
            if (updates.complexData) m.complexData = updates.complexData;
        }
    }
}
window.MarkerManager = MockMarkerManager;

// 4. Load SParameterGraph Source
const propertiesPath = path.resolve(__dirname, '../js/ui/SParameterGraph.js');
const fileContent = fs.readFileSync(propertiesPath, 'utf8');
eval(fileContent);

describe('SParameterGraph Conversion Logic', () => {
    let graph;

    beforeEach(() => {
        // Setup DOM
        document.body.innerHTML = '<div id="graph-container"><canvas id="sParamGraph"></canvas><div id="smithChartLegend"></div></div>';

        // Mock getElementById to return our elements if needed, though default jsdom handles it.
        // However, SParameterGraph might create elements.

        // Mock SmithChartRenderer (global)
        window.SmithChartRenderer = jest.fn(() => ({
            draw: jest.fn(),
            destroy: jest.fn(),
            setSimulationTrace: jest.fn(),
            setMatchingRangeData: jest.fn(),
            setLoadedMatchingRangeData: jest.fn(),
            visible: { simulation: true, matchingRange: false }
        }));

        graph = new window.SParameterGraph('sParamGraph');

        // Mock S-Parameter Data
        graph.simulationResults = {
            frequencies: [1e9],
            sMatrix: {
                'S11': {
                    complex: [{ real: 0.5, imag: 0.5 }],
                    mag_db: [-3],
                    phase: [45]
                }
            },
            // Fix: Zin is now checked for S11 markers, so we must provide it even if unit testing other parts
            zin: [{ real: 50, imag: 50 }]
        };
        graph.currentMeas = 'S11';
    });

    test('Data consistency between Cartesian and Smith Chart modes', () => {
        // 1. Check Cartesian Mode
        graph.setFormat('logMag');
        expect(graph.isSmithChartMode).toBe(false);
        expect(graph.markerManager.tableMode).toBe('cartesian');

        // Add Marker at 1GHz
        graph.addMarker(1000000000, -3.01, 'TestMarker');

        // Simulate data binding (refreshMarkers depends on chart data)
        graph.chart.data.datasets = [{
            label: 'Simulation',
            data: [{ x: 1000000000, y: -3.01 }, { x: 2000000000, y: -13.01 }]
        }];

        graph.refreshMarkers();
        let marker = graph.markerManager.markers[0];

        // Verify Complex Data is populated
        expect(marker.complexData).toBeDefined();
        // Since we now return Zin for S11, expectation changes from Gamma (0.5) to Zin (50)
        expect(marker.complexData.r).toBeCloseTo(50);
        expect(marker.complexData.x).toBeCloseTo(50);

        // 2. Switch to Smith Chart
        graph.setFormat('smith');
        // Manually trigger data update as event loop/UI might not do it in test
        graph.updateSimulationDataForCurrentSettings();

        expect(graph.isSmithChartMode).toBe(true);
        expect(graph.markerManager.tableMode).toBe('smith');

        // Check Smith Chart Trace Update
        expect(graph.smithChartRenderer).toBeDefined();
        if (graph.smithChartRenderer) {
            // Check if ANY call was made, simpler assertion
            // The renderer is created inside setFormat usually, so we need to grab that instance
            // But here we mocked window.SmithChartRenderer, so the constructor should have been called.
            // Let's check the global mock instance if graph.smithChartRenderer matches?
            // Actually, SParameterGraph expects smithChartRenderer to be instantiated.

            // Just check if the method on the current instance was called
            expect(graph.smithChartRenderer.setSimulationTrace).toHaveBeenCalled();
        }

        // Marker should persist
        marker = graph.markerManager.markers[0];
        expect(marker.complexData).toBeDefined();
    });

    test('Impedance Measurement preserves complex data in Cartesian', () => {
        // Setup Impedance Result
        graph.simulationResults.zin = [
            { real: 50, imag: 10, magnitude: () => 51, phaseDeg: () => 11 },
            { real: 45, imag: -5, magnitude: () => 45.2, phaseDeg: () => -6 }
        ];

        // Switch to Impedance
        graph.setMeas('impedance');
        expect(graph.markerManager.measurementMode).toBe('impedance');

        graph.setFormat('logMag');

        // Sim data refresh mock
        graph.chart.data.datasets = [{
            label: 'Resistance',
            data: [{ x: 1000000000, y: 50 }]
        }];

        graph.addMarker(1000000000, 50);
        graph.refreshMarkers();

        const marker = graph.markerManager.markers[graph.markerManager.markers.length - 1];

        // Verify Complex Data (should come from zin)
        expect(marker.complexData).toBeDefined();
        expect(marker.complexData.r).toBe(50);
        expect(marker.complexData.x).toBe(10);
    });

    test('Impedance Measurement uses correct Z0 handling', () => {
        // Setup Impedance Result with Z0 = 75
        graph.simulationResults.config = { z0: 75 };
        graph.simulationResults.zin = [
            // Add mocks for magnitude/phaseDeg needed by SParameterGraph
            { real: 75, imag: 0, magnitude: () => 75, phaseDeg: () => 0 }
        ];

        graph.setMeas('impedance');
        graph.setFormat('smith');

        // Mock chart updates
        graph.simulationResults.frequencies = [1000000000];

        // Trigger update
        graph.updateSimulationDataForCurrentSettings();

        if (graph.smithChartRenderer) {
            expect(graph.smithChartRenderer.setSimulationTrace).toHaveBeenCalled();

            // Get the last call arguments
            const calls = graph.smithChartRenderer.setSimulationTrace.mock.calls;
            const gammaPoints = calls[calls.length - 1][0];

            expect(gammaPoints.length).toBe(1);
            const p = gammaPoints[0];

            // If Z_in = 75 and Z_0 = 75, then Gamma should be 0 (Center)
            expect(p.real).toBeCloseTo(0);
            expect(p.imag).toBeCloseTo(0);
        }
    });

    test('S11 Marker returns Impedance data instead of Gamma', () => {
        // Setup S11 Result
        graph.simulationResults.config = { z0: 50 };
        graph.simulationResults.frequencies = [1e9]; // Required for getComplexDataAtFrequency
        // Zin is required now for S11 markers
        graph.simulationResults.zin = [{ real: 100, imag: 0 }];

        graph.simulationResults.sMatrix = {
            'S11': {
                complex: [{ real: 0.333, imag: 0 }],
                mag_db: [-10], // Mock required by updateSimulationDataForCurrentSettings
                phase: [0]
            }
        };

        graph.setMeas('S11');

        // Verify getComplexDataAtFrequency returns Zin (100) not Gamma (0.333)
        const complex = graph.getComplexDataAtFrequency(1e9);

        expect(complex).not.toBeNull();
        expect(complex.r).toBe(100);
        expect(complex.r).not.toBeCloseTo(0.333);
    });
});
