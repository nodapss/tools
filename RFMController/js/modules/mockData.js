(function () {
    // Mock Data State
    let mockDataInterval;
    let mockDataEnabled = true; // Default: ON
    const graphData = {
        rfInput: { v: [], i: [] },
        rfOutput: { v: [], i: [] },
        plasma: { te: [], ni: [] },
        fftInput: [],
        fftOutput: []
    };
    const MAX_POINTS = 50;

    RF.modules.startMockData = function () {
        // Initial Status
        RF.ui.updateLed('ledCover', false); // Closed (Green)
        RF.ui.updateLed('ledCable', true);  // Connected (Green)
        RF.ui.updateLed('ledFanLock', false); // OK (Green)

        RF.ui.updateLed('ledRf', false); // Off
        RF.ui.updateLed('ledAuto', true); // Auto Mode

        mockDataInterval = setInterval(() => {
            if (mockDataEnabled) {
                updateGraphs();
                updateVvcIndicators();
            }
        }, 100); // 10Hz update
    };

    RF.modules.toggleMockData = function () {
        mockDataEnabled = !mockDataEnabled;
        updateMockButton();
        return mockDataEnabled;
    };

    RF.modules.stopMockData = function () {
        if (mockDataEnabled) {
            mockDataEnabled = false;
            updateMockButton();
            RF.ui.log('Mock Data: Auto-disabled (Serial connected)');
        }
    };

    RF.modules.isMockDataEnabled = function () {
        return mockDataEnabled;
    };

    function updateMockButton() {
        const btnToggleMock = document.getElementById('btnToggleMock');
        if (btnToggleMock) {
            btnToggleMock.textContent = mockDataEnabled ? 'Mock: ON' : 'Mock: OFF';
            btnToggleMock.style.backgroundColor = mockDataEnabled ? '#333' : '#555';
        }
    }

    function updateVvcIndicators() {
        // Simulate slow movement
        const t = Date.now() / 2000;
        const v1 = (Math.sin(t) + 1) * 50; // 0-100
        const v2 = (Math.cos(t * 0.7) + 1) * 50; // 0-100

        const elVvc1Pos = document.getElementById('vvc1Pos');
        const elVvc1Val = document.getElementById('vvc1Val');
        const elVvc2Pos = document.getElementById('vvc2Pos');
        const elVvc2Val = document.getElementById('vvc2Val');

        if (elVvc1Pos) elVvc1Pos.style.width = `${v1}%`;
        if (elVvc1Val) elVvc1Val.textContent = `${v1.toFixed(0)}%`;

        if (elVvc2Pos) elVvc2Pos.style.width = `${v2}%`;
        if (elVvc2Val) elVvc2Val.textContent = `${v2.toFixed(0)}%`;
    }

    function updateGraphs() {
        // Generate random data
        const t = Date.now() / 1000;

        // RF Data - Input Sensor
        const vInput = 50 + Math.sin(t * 5) * 10 + Math.random() * 2;
        const iInput = 2 + Math.sin(t * 5 + 1) * 0.5 + Math.random() * 0.1;
        pushData(graphData.rfInput.v, vInput);
        pushData(graphData.rfInput.i, iInput);
        RF.ui.drawGraph('rfGraphInput', [graphData.rfInput.v, graphData.rfInput.i], ['#4ec9b0', '#007acc'], [0, 100]);

        // RF Data - Output Sensor
        const vOutput = 45 + Math.sin(t * 5 + 0.5) * 12 + Math.random() * 2;
        const iOutput = 1.8 + Math.sin(t * 5 + 1.5) * 0.6 + Math.random() * 0.1;
        pushData(graphData.rfOutput.v, vOutput);
        pushData(graphData.rfOutput.i, iOutput);
        RF.ui.drawGraph('rfGraphOutput', [graphData.rfOutput.v, graphData.rfOutput.i], ['#4ec9b0', '#007acc'], [0, 100]);

        // Plasma Data
        const te = 3 + Math.random() * 0.5;
        const ni = 8 + Math.random() * 1;
        pushData(graphData.plasma.te, te);
        pushData(graphData.plasma.ni, ni);
        RF.ui.drawGraph('teGraph', [graphData.plasma.te], ['#cca700'], [0, 5]);
        RF.ui.drawGraph('niGraph', [graphData.plasma.ni], ['#f44747'], [0, 15]);

        // FFT (Bar chart style) - Input
        const fftInput = Array(20).fill(0).map((_, k) => Math.random() * 50 * (1.0 / (k + 1)));
        RF.ui.drawBarGraph('fftGraphInput', fftInput, '#007acc');

        // FFT (Bar chart style) - Output
        const fftOutput = Array(20).fill(0).map((_, k) => Math.random() * 45 * (1.0 / (k + 0.8)));
        RF.ui.drawBarGraph('fftGraphOutput', fftOutput, '#4ec9b0');
    }

    function pushData(arr, val) {
        arr.push(val);
        if (arr.length > MAX_POINTS) arr.shift();
    }
})();
