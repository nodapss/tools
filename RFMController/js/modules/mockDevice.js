/**
 * MockDevice - Virtual device state management for Mock Serial Engine
 * Simulates MatFW_001 firmware state
 */
(function () {
    'use strict';

    // Motor Controller class - simulates MotorController from MotionBoard.hpp
    class MotorController {
        constructor(index) {
            this.index = index;
            
            // Position state
            this.position = 32000;      // Current position
            this.targetPosition = 32000; // Target position
            this.rpm = 0;               // Current RPM (0 when stopped)
            this.overrideRpm = 0;       // Override RPM (0 = disabled)
            
            // Limits
            this.minValue = 0;
            this.maxValue = 64000;
            this.lowerLimit = 4000;
            this.upperLimit = 60000;
            
            // Capacitance (pF × 100 for 0.01pF precision)
            this.minCap = 0;           // 0 pF
            this.maxCap = 100000;      // 1000.00 pF
            
            // Cubic fitting coefficients (normalized)
            // C(xNorm) = a3*xNorm^3 + a2*xNorm^2 + a1*xNorm + a0
            this.fitCoeffs = [0, 0, 0, 0]; // [a0, a1, a2, a3]
            
            // Extended info
            this.indexPos = 0;
            this.stallDetected = false;
            this.firstIndexPos = 0;     // Saved first index position
        }

        // Get position as percentage (0~100)
        getPositionPercent() {
            if (this.maxValue <= this.minValue) return 0;
            let percent = ((this.position - this.minValue) * 100) / (this.maxValue - this.minValue);
            return Math.max(0, Math.min(100, Math.round(percent)));
        }

        // Check if fitting coefficients are calibrated
        isFittingCalibrated() {
            return this.fitCoeffs.some(c => c !== 0);
        }

        // Get capacitance (pF × 100) at current position
        getCapacitance() {
            return this.getCapacitanceAt(this.position);
        }

        // Get capacitance (pF × 100) for a specific position
        getCapacitanceAt(pos) {
            const xRange = this.maxValue - this.minValue;
            
            // If fitting coefficients are calibrated, use normalized cubic polynomial
            if (this.isFittingCalibrated() && xRange > 0) {
                const xNorm = (pos - this.minValue) / xRange;
                const cap = this.fitCoeffs[3] * Math.pow(xNorm, 3) +
                           this.fitCoeffs[2] * Math.pow(xNorm, 2) +
                           this.fitCoeffs[1] * xNorm +
                           this.fitCoeffs[0];
                return Math.round(cap * 100);
            }
            
            // Fallback to linear interpolation
            if (this.maxValue <= this.minValue) return this.minCap;
            const posOffset = Math.max(0, Math.min(pos - this.minValue, xRange));
            return Math.round(this.minCap + ((this.maxCap - this.minCap) * posOffset) / xRange);
        }

        // Get position for target capacitance (pF × 100) - inverse calculation
        getPositionFromCap(targetCap) {
            const targetCapPf = targetCap / 100.0;
            const xRange = this.maxValue - this.minValue;
            
            if (this.isFittingCalibrated() && xRange > 0) {
                // Newton-Raphson iteration
                const xNormLower = (this.lowerLimit - this.minValue) / xRange;
                const xNormUpper = (this.upperLimit - this.minValue) / xRange;
                let xNorm = (xNormLower + xNormUpper) / 2;
                
                for (let i = 0; i < 20; i++) {
                    const fx = this.fitCoeffs[3] * Math.pow(xNorm, 3) +
                              this.fitCoeffs[2] * Math.pow(xNorm, 2) +
                              this.fitCoeffs[1] * xNorm +
                              this.fitCoeffs[0] - targetCapPf;
                    const fpx = 3 * this.fitCoeffs[3] * Math.pow(xNorm, 2) +
                               2 * this.fitCoeffs[2] * xNorm +
                               this.fitCoeffs[1];
                    
                    if (Math.abs(fx) < 0.1) break;
                    if (Math.abs(fpx) < 1e-10) break;
                    
                    xNorm = xNorm - fx / fpx;
                    xNorm = Math.max(xNormLower, Math.min(xNormUpper, xNorm));
                }
                
                return Math.round(xNorm * xRange + this.minValue);
            }
            
            // Fallback to linear interpolation
            if (this.maxCap <= this.minCap) return this.minValue;
            const capOffset = Math.max(0, Math.min(targetCap - this.minCap, this.maxCap - this.minCap));
            return Math.round(this.minValue + (xRange * capOffset) / (this.maxCap - this.minCap));
        }

        // Run motor to target position (with limit checking)
        runMotor(targetPos) {
            this.targetPosition = Math.max(this.lowerLimit, Math.min(this.upperLimit, targetPos));
            this.rpm = this.overrideRpm > 0 ? this.overrideRpm : 60; // Default RPM when moving
        }

        // Force run motor (bypass limits)
        runMotorForce(targetPos) {
            this.targetPosition = targetPos;
            this.rpm = this.overrideRpm > 0 ? this.overrideRpm : 60;
        }

        // Set motor origin
        setOrigin(pos = 0) {
            this.position = pos;
            this.targetPosition = pos;
        }
    }

    // RF Sensor class - simulates RFSensor from RFSensor.hpp
    class RFSensor {
        constructor(isInput) {
            this.isInput = isInput;
            
            // Calibration
            this.voltageGain = 1.0;
            this.currentGain = 1.0;
            this.phaseDiffDeg = 0.0;
            
            // Average count
            this.avgCount = 512;
            
            // Coupling mode (true = AC, false = DC)
            this.acCoupling = true;
            
            // Last measured values (for simulation)
            this.lastR = 50.0;
            this.lastX = 0.0;
            this.lastV = 100.0;
            this.lastI = 2.0;
            this.lastPhase = 0.0;
        }
    }

    // Main MockDevice class
    class MockDevice {
        constructor() {
            // Device info
            this.modelName = 'MOCK-RF1000';
            this.makeDate = '2024-01-01';
            this.serialNum = 'MOCK-SN-001';
            
            // Motors (2 motors: index 0 and 1)
            this.motors = [
                new MotorController(0),
                new MotorController(1)
            ];
            
            // VVC 0 (Motor 0) settings
            this.motors[0].minValue = 0;
            this.motors[0].maxValue = 68200;
            this.motors[0].lowerLimit = 1000;
            this.motors[0].upperLimit = 68200;
            this.motors[0].minCap = 8800;    // 88.00 pF × 100
            this.motors[0].maxCap = 101000;  // 1010.00 pF × 100
            this.motors[0].position = 34100; // Start at center
            this.motors[0].targetPosition = 34100;
            
            // VVC 1 (Motor 1) settings
            this.motors[1].minValue = 0;
            this.motors[1].maxValue = 67000;
            this.motors[1].lowerLimit = 1000;
            this.motors[1].upperLimit = 67000;
            this.motors[1].minCap = 3800;    // 38.00 pF × 100
            this.motors[1].maxCap = 51000;   // 510.00 pF × 100
            this.motors[1].position = 33500; // Start at center
            this.motors[1].targetPosition = 33500
            
            // RF Sensors (Input and Output)
            this.inputSensor = new RFSensor(true);
            this.outputSensor = new RFSensor(false);
            
            // VSWR Settings
            this.vswrStart = 1.04;
            this.vswrStop = 1.02;
            this.vswrRestart = 1.04;
            
            // Stream Settings (ms)
            this.impStreamRate = 100;
            this.viStreamRate = 100;
            this.motorPosStreamRate = 100;
            
            // AMS Settings
            this.amsInterval = 10;
            this.amsTimeout = 0;
            this.amsLogInterval = 10;
            
            // Streaming state
            this.streams = {
                impedanceInput: { enabled: false, rate: 100, lastTime: 0 },
                impedanceOutput: { enabled: false, rate: 100, lastTime: 0 },
                viInput: { enabled: false, rate: 100, lastTime: 0 },
                viOutput: { enabled: false, rate: 100, lastTime: 0 },
                motorPosition: { enabled: false, rate: 100, lastTime: 0 }
            };
            
            // Debug mode
            this.debugMode = true;
            
            // Matching algorithm constants (13.56 MHz)
            this.rfFrequencyHz = 13560000;
            this.omega = 2 * Math.PI * this.rfFrequencyHz;
            this.Z0 = 50; // Characteristic impedance
            
            // Coil inductance (example value for L-match)
            this.coilInductance = 1.5e-6; // 1.5 µH
        }

        // Get motor by index (0 or 1)
        getMotor(idx) {
            if (idx === 0 || idx === 1) {
                return this.motors[idx];
            }
            return null;
        }

        // Get sensor by type ('i' or 'o')
        getSensor(type) {
            if (type === 'i') return this.inputSensor;
            if (type === 'o') return this.outputSensor;
            return null;
        }

        // Reset device to defaults
        reset() {
            this.motors.forEach(m => {
                m.position = 32000;
                m.targetPosition = 32000;
                m.rpm = 0;
            });
            
            this.inputSensor.avgCount = 512;
            this.outputSensor.avgCount = 512;
        }

        // Serialize state for debugging
        getState() {
            return {
                device: {
                    model: this.modelName,
                    date: this.makeDate,
                    serial: this.serialNum
                },
                motors: this.motors.map(m => ({
                    position: m.position,
                    target: m.targetPosition,
                    percent: m.getPositionPercent(),
                    capacitance: m.getCapacitance()
                })),
                sensors: {
                    input: { vGain: this.inputSensor.voltageGain, iGain: this.inputSensor.currentGain },
                    output: { vGain: this.outputSensor.voltageGain, iGain: this.outputSensor.currentGain }
                },
                vswr: {
                    start: this.vswrStart,
                    stop: this.vswrStop,
                    restart: this.vswrRestart
                }
            };
        }
    }

    // Create singleton instance
    const mockDevice = new MockDevice();

    // Export to RF namespace
    if (typeof window.RF === 'undefined') {
        window.RF = {};
    }
    if (typeof RF.mock === 'undefined') {
        RF.mock = {};
    }
    
    RF.mock.device = mockDevice;
    RF.mock.MotorController = MotorController;
    RF.mock.RFSensor = RFSensor;
    RF.mock.MockDevice = MockDevice;

    console.log('MockDevice initialized:', mockDevice.getState());
})();

