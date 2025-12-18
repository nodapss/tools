// App Logic
let port;
let reader;
let writer;
let keepReading = false;
let smithChart;

// Constants
const Z0 = 50; // Characteristic Impedance

// Mock Data State
let mockDataInterval;
const graphData = {
    rf: { v: [], i: [] },
    plasma: { te: [], ni: [] },
    fft: []
};
const MAX_POINTS = 50;

document.addEventListener('DOMContentLoaded', () => {
    try {
        smithChart = new SmithChart('smithChart');
        log('System Initialized');
        startMockData(); // Start generating mock data for dashboard
    } catch (e) {
        console.error(e);
        log('Error initializing SmithChart: ' + e.message);
    }

    // Event Listeners
    document.getElementById('btnRequestPort').addEventListener('click', requestPort);
    document.getElementById('btnConnect').addEventListener('click', connect);
    document.getElementById('btnDisconnect').addEventListener('click', disconnect);
    document.getElementById('btnSend').addEventListener('click', sendManualCommand);
    document.getElementById('cmdInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendManualCommand();
    });

    // Command Buttons
    document.querySelectorAll('.cmd-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const cmd = btn.dataset.cmd;
            if (cmd) sendCommand(cmd);
        });
    });

    // Dynamic Command Buttons
    document.querySelectorAll('.cmd-btn-dynamic').forEach(btn => {
        btn.addEventListener('click', () => {
            let cmd = btn.dataset.template;
            if (btn.dataset.input) {
                const val = document.getElementById(btn.dataset.input).value;
                cmd = cmd.replace('{val}', val);
            }
            if (btn.dataset.select) {
                const val = document.getElementById(btn.dataset.select).value;
                cmd = cmd.replace('{sel}', val);
            }
            sendCommand(cmd);
        });
    });

    // Resize Observer for Graphs
    window.addEventListener('resize', () => {
        if (smithChart) smithChart.resize();
        resizeGraphs();
    });

    // Initial Resize
    setTimeout(resizeGraphs, 100);
});

function resizeGraphs() {
    const graphIds = ['rfGraph', 'fftGraph', 'teGraph', 'niGraph'];
    graphIds.forEach(id => {
        const canvas = document.getElementById(id);
        if (!canvas) return;
        const container = canvas.parentElement;
        // Set internal resolution to match display size
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
    });
}

function log(msg, isTx = false) {
    const term = document.getElementById('terminal');
    if (!term) return;
    const line = document.createElement('div');
    line.textContent = (isTx ? '> ' : '') + msg;
    if (isTx) line.style.color = '#4ec9b0';
    term.appendChild(line);
    term.scrollTop = term.scrollHeight;
}

async function requestPort() {
    if (!navigator.serial) {
        alert('Web Serial API not supported.');
        return;
    }
    try {
        port = await navigator.serial.requestPort();
        log('Port selected');
        document.getElementById('btnConnect').disabled = false;
    } catch (e) {
        log('Port selection failed/cancelled: ' + e.message);
    }
}

async function connect() {
    if (!port) {
        alert('Please select a port first.');
        return;
    }

    try {
        const baudRate = parseInt(document.getElementById('baudRate').value);
        await port.open({ baudRate });

        setConnectedState(true);
        log(`Connected at ${baudRate} baud`);

        keepReading = true;
        readLoop();
    } catch (err) {
        console.error(err);
        log(`Connection failed: ${err.message}`);
        alert('Connection failed: ' + err.message);
    }
}

async function disconnect() {
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
    setConnectedState(false);
    log('Disconnected');
}

function setConnectedState(connected) {
    document.getElementById('btnConnect').disabled = connected;
    document.getElementById('btnRequestPort').disabled = connected;
    document.getElementById('btnDisconnect').disabled = !connected;

    // Update Status LEDs
    updateLed('ledEthercat', connected); // Mock Ethercat status linked to connection
}

async function sendCommand(cmd) {
    if (!cmd) return;
    log(cmd, true);

    if (!port || !port.writable) return;

    try {
        const encoder = new TextEncoder();
        const writer = port.writable.getWriter();
        await writer.write(encoder.encode(cmd + '\r\n')); // Add CRLF
        writer.releaseLock();
    } catch (err) {
        log(`Send error: ${err.message}`);
    }
}

function sendManualCommand() {
    const input = document.getElementById('cmdInput');
    sendCommand(input.value);
    input.value = '';
}

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
        } catch (err) {
            console.error(err);
        } finally {
            reader.releaseLock();
        }
    }
}

let buffer = '';
function processIncomingData(chunk) {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop(); // Keep incomplete line

    lines.forEach(line => {
        log(line);
        parseLine(line);
    });
}

// Parsing Logic
let parsingImpedance = false;
let impData = {};

function parseLine(line) {
    // Impedance Results Parsing
    if (line.includes('Impedance Results:')) {
        parsingImpedance = true;
        impData = {};
    } else if (parsingImpedance) {
        if (line.includes('Voltage Magnitude:')) impData.vMag = parseFloat(line.split(':')[1]);
        else if (line.includes('Current Magnitude:')) impData.iMag = parseFloat(line.split(':')[1]);
        else if (line.includes('Impedance Magnitude:')) impData.zMag = parseFloat(line.split(':')[1]);
        else if (line.includes('Impedance Phase:')) {
            impData.zPhase = parseFloat(line.split(':')[1]);
            parsingImpedance = false;
            updateSmithChart(impData);
        }
    }
}

function updateSmithChart(data) {
    // Z = |Z| * e^(j*theta)
    // Z_rect = |Z| * cos(theta) + j * |Z| * sin(theta)
    const rad = data.zPhase * (Math.PI / 180);
    const r = data.zMag * Math.cos(rad);
    const x = data.zMag * Math.sin(rad);

    // Normalize to Z0
    const zNormR = r / Z0;
    const zNormX = x / Z0;

    // Gamma = (z - 1) / (z + 1)
    // z = r + jx
    // Gamma = ((r-1) + jx) / ((r+1) + jx)
    const denom = (zNormR + 1) * (zNormR + 1) + zNormX * zNormX;
    const gammaR = ((zNormR * zNormR + zNormX * zNormX) - 1) / denom;
    const gammaI = (2 * zNormX) / denom;

    // Update UI
    document.getElementById('valMag').textContent = data.zMag.toFixed(2);
    document.getElementById('valPhase').textContent = data.zPhase.toFixed(2);
    document.getElementById('valR').textContent = r.toFixed(2);
    document.getElementById('valX').textContent = x.toFixed(2);

    smithChart.addPoint(gammaR, gammaI);
}

// ==========================================
// Dashboard Mock Data & Rendering
// ==========================================

function startMockData() {
    // Initial Status
    updateLed('ledCover', false); // Closed (Green)
    updateLed('ledCable', true);  // Connected (Green)
    updateLed('ledFanLock', false); // OK (Green)

    updateLed('ledRf', false); // Off
    updateLed('ledAuto', true); // Auto Mode

    setInterval(() => {
        updateGraphs();
        updateVvcIndicators();
    }, 100); // 10Hz update
}

function updateLed(id, state) {
    const el = document.getElementById(id);
    if (!el) return;

    // Reset
    el.classList.remove('on-green', 'on-red');

    // Logic depends on LED type
    if (id === 'ledCover' || id === 'ledFanLock') {
        // Interlocks: ON means Error (Red)
        if (state) el.classList.add('on-red');
        else el.classList.add('on-green'); // Safe
    } else if (id === 'ledCable') {
        // Cable: ON means Connected (Green)
        if (state) el.classList.add('on-green');
        else el.classList.add('on-red');
    } else {
        // Normal Status: ON means Active (Green)
        if (state) el.classList.add('on-green');
    }
}

function updateVvcIndicators() {
    // Simulate slow movement
    const t = Date.now() / 2000;
    const v1 = (Math.sin(t) + 1) * 50; // 0-100
    const v2 = (Math.cos(t * 0.7) + 1) * 50; // 0-100

    document.getElementById('vvc1Pos').style.width = `${v1}%`;
    document.getElementById('vvc1Val').textContent = `${v1.toFixed(0)}%`;

    document.getElementById('vvc2Pos').style.width = `${v2}%`;
    document.getElementById('vvc2Val').textContent = `${v2.toFixed(0)}%`;
}

function updateGraphs() {
    // Generate random data
    const t = Date.now() / 1000;

    // RF Data
    const v = 50 + Math.sin(t * 5) * 10 + Math.random() * 2;
    const i = 2 + Math.sin(t * 5 + 1) * 0.5 + Math.random() * 0.1;
    pushData(graphData.rf.v, v);
    pushData(graphData.rf.i, i);
    drawGraph('rfGraph', [graphData.rf.v, graphData.rf.i], ['#4ec9b0', '#007acc'], [0, 100]);

    // Plasma Data
    const te = 3 + Math.random() * 0.5;
    const ni = 8 + Math.random() * 1;
    pushData(graphData.plasma.te, te);
    pushData(graphData.plasma.ni, ni);
    drawGraph('teGraph', [graphData.plasma.te], ['#cca700'], [0, 5]);
    drawGraph('niGraph', [graphData.plasma.ni], ['#f44747'], [0, 15]);

    // FFT (Bar chart style)
    const fft = Array(20).fill(0).map((_, k) => Math.random() * 50 * (1.0 / (k + 1)));
    drawBarGraph('fftGraph', fft, '#007acc');
}

function pushData(arr, val) {
    arr.push(val);
    if (arr.length > MAX_POINTS) arr.shift();
}

function drawGraph(canvasId, dataArrays, colors, range) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    // Clear
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = '#222';
    ctx.beginPath();
    ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);
    ctx.stroke();

    dataArrays.forEach((data, idx) => {
        ctx.strokeStyle = colors[idx];
        ctx.lineWidth = 2;
        ctx.beginPath();

        const step = w / (MAX_POINTS - 1);
        const min = range[0];
        const max = range[1];
        const scale = h / (max - min);

        data.forEach((val, i) => {
            const x = i * step;
            const y = h - (val - min) * scale;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();
    });
}

function drawBarGraph(canvasId, data, color) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, w, h);

    const barWidth = w / data.length;
    ctx.fillStyle = color;

    data.forEach((val, i) => {
        const barH = (val / 100) * h;
        ctx.fillRect(i * barWidth + 1, h - barH, barWidth - 2, barH);
    });
}
