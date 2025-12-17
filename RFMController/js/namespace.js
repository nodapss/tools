// Global Namespace Definition
window.RF = {
    core: {},
    modules: {},
    ui: {},
    events: {
        _listeners: {},
        on: function(event, callback) {
            if (!this._listeners[event]) {
                this._listeners[event] = [];
            }
            this._listeners[event].push(callback);
        },
        off: function(event, callback) {
            if (!this._listeners[event]) return;
            this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
        },
        emit: function(event, data) {
            if (!this._listeners[event]) return;
            this._listeners[event].forEach(callback => callback(data));
        }
    },
    settings: {
        impedanceStreamRate: 100,  // Default 100ms
        viStreamRate: 100,         // Default 100ms
        motorPosStreamRate: 100,   // Default 100ms for motor position polling
        impedanceAvgCount: 512,     // Default 512 samples
        modelName: '',
        manufactureDate: '',
        serialNumber: '',
        vvc1: {
            currentValue: 0,
            percent: 0,
            minValue: 0,
            maxValue: 64000,
            lowerLimit: 4000,
            upperLimit: 60000,
            minCap: 0,      // Capacitance at minValue (pF)
            maxCap: 1000,   // Capacitance at maxValue (pF)
            displayMode: 0  // 0: percent, 1: position, 2: capacitance
        },
        vvc2: {
            currentValue: 0,
            percent: 0,
            minValue: 0,
            maxValue: 64000,
            lowerLimit: 4000,
            upperLimit: 60000,
            minCap: 0,      // Capacitance at minValue (pF)
            maxCap: 1000,   // Capacitance at maxValue (pF)
            displayMode: 0  // 0: percent, 1: position, 2: capacitance
        },
        motor1: {
            minValue: 0,
            maxValue: 64000,
            lowerLimit: 4000,
            upperLimit: 60000
        },
        motor2: {
            minValue: 0,
            maxValue: 64000,
            lowerLimit: 4000,
            upperLimit: 60000
        },
        vswr: {
            start: 1.04,        // Start matching when VSWR >= this
            stop: 1.02,         // Stop matching when VSWR <= this (match complete)
            restart: 1.04,      // Restart matching if VSWR >= this after match complete
            showStart: false,   // Show Start VSWR on Smith Chart
            showStop: true,     // Show Stop VSWR on Smith Chart
            showRestart: false  // Show Restart VSWR on Smith Chart
        }
    }
};
window.RF.core = {};
window.RF.modules = {};
