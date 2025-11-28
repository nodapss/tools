// Global Namespace Definition
window.RF = {
    core: {},
    modules: {},
    ui: {},
    settings: {
        impedanceStreamRate: 100,  // Default 100ms
        viStreamRate: 100,         // Default 100ms
        motorPosStreamRate: 100,   // Default 100ms for motor position polling
        motorPosSaveRate: 100,     // Default 100ms for FRAM save interval
        motorPosSaveEnabled: true, // Default enabled for FRAM auto-save
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
        }
    }
};
window.RF.core = {};
window.RF.modules = {};
