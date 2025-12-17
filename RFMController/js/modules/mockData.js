/**
 * Mock Data Module - Mock Serial Engine Integration
 * Controls Mock Serial Engine state and plasma analysis mock
 */
(function () {
    'use strict';
    
    // Mock state
    let mockDataEnabled = true; // Default: ON
    let plasmaInterval = null;

    // ========================================
    // Plasma Analysis Mock (Simple, easy to modify/remove)
    // ========================================
    
    /**
     * Update plasma analysis display with mock data
     * Te: Electron temperature (2~5 eV)
     * Ni: Plasma density (1e10 ~ 1e11 cm⁻³)
     */
    function updatePlasmaAnalysis() {
        // Base values with small random variation
        const Te = 3.5 + (Math.random() - 0.5) * 1.0;  // 3.0 ~ 4.0 eV
        const Ni = 5e10 + (Math.random() - 0.5) * 2e10; // 4e10 ~ 6e10 cm⁻³
        
        // Update UI elements if they exist
        const teElement = document.querySelector('[data-plasma="te"]') || 
                         document.getElementById('plasmaTe');
        const niElement = document.querySelector('[data-plasma="ni"]') || 
                         document.getElementById('plasmaNi');
        
        if (teElement) {
            teElement.textContent = Te.toFixed(2) + ' eV';
        }
        if (niElement) {
            niElement.textContent = Ni.toExponential(2) + ' cm⁻³';
        }
    }
    
    /**
     * Start plasma analysis mock updates
     */
    function startPlasmaAnalysis() {
        if (plasmaInterval) return;
        plasmaInterval = setInterval(updatePlasmaAnalysis, 1000);  // 1Hz update
        updatePlasmaAnalysis();  // Initial update
    }
    
    /**
     * Stop plasma analysis mock updates
     */
    function stopPlasmaAnalysis() {
        if (plasmaInterval) {
            clearInterval(plasmaInterval);
            plasmaInterval = null;
        }
    }

    // ========================================
    // Mock Serial Engine Control
    // ========================================

    /**
     * Initialize Mock Serial Engine
     */
    RF.modules.startMockData = function () {
        // Initial LED Status
        RF.ui.updateLed('ledCover', false);    // Closed (Green)
        RF.ui.updateLed('ledCable', true);     // Connected (Green)
        RF.ui.updateLed('ledFanLock', false);  // OK (Green)
        RF.ui.updateLed('ledRf', false);       // Off
        RF.ui.updateLed('ledAuto', true);      // Auto Mode

        // Enable Mock Serial Engine
        if (mockDataEnabled) {
            if (RF.mock && RF.mock.setEnabled) {
                RF.mock.setEnabled(true);
            }
            if (RF.mock && RF.mock.physics && RF.mock.physics.start) {
                RF.mock.physics.start();
            }
            if (RF.mock && RF.mock.streaming && RF.mock.streaming.start) {
                RF.mock.streaming.start();
            }
            // Start plasma analysis mock
            startPlasmaAnalysis();
        }
        
        updateMockButton();
        console.log('[MockData] Mock Serial Engine initialized:', mockDataEnabled ? 'Enabled' : 'Disabled');
    };

    /**
     * Toggle Mock Serial Engine on/off
     */
    RF.modules.toggleMockData = function () {
        mockDataEnabled = !mockDataEnabled;
        updateMockButton();
        
        // Sync with Mock Serial Engine
        if (RF.mock && RF.mock.setEnabled) {
            RF.mock.setEnabled(mockDataEnabled);
        }
        
        if (mockDataEnabled) {
            // Start physics simulation and streaming
            if (RF.mock && RF.mock.physics && RF.mock.physics.start) {
                RF.mock.physics.start();
            }
            if (RF.mock && RF.mock.streaming && RF.mock.streaming.start) {
                RF.mock.streaming.start();
            }
            startPlasmaAnalysis();
            RF.ui.log('Mock Serial Engine: Enabled');
        } else {
            // Stop physics simulation and streaming
            if (RF.mock && RF.mock.physics && RF.mock.physics.stop) {
                RF.mock.physics.stop();
            }
            if (RF.mock && RF.mock.streaming && RF.mock.streaming.stop) {
                RF.mock.streaming.stop();
            }
            stopPlasmaAnalysis();
            RF.ui.log('Mock Serial Engine: Disabled');
        }
        
        return mockDataEnabled;
    };

    /**
     * Stop Mock Serial Engine (called when real serial is connected)
     */
    RF.modules.stopMockData = function () {
        if (mockDataEnabled) {
            mockDataEnabled = false;
            updateMockButton();
            
            // Disable Mock Serial Engine
            if (RF.mock && RF.mock.setEnabled) {
                RF.mock.setEnabled(false);
            }
            if (RF.mock && RF.mock.physics && RF.mock.physics.stop) {
                RF.mock.physics.stop();
            }
            if (RF.mock && RF.mock.streaming && RF.mock.streaming.stop) {
                RF.mock.streaming.stop();
            }
            stopPlasmaAnalysis();
            
            RF.ui.log('Mock Serial Engine: Auto-disabled (Serial connected)');
        }
    };

    /**
     * Check if Mock is enabled
     */
    RF.modules.isMockDataEnabled = function () {
        return mockDataEnabled;
    };

    /**
     * Update Mock button UI
     */
    function updateMockButton() {
        const btnToggleMock = document.getElementById('btnToggleMock');
        if (btnToggleMock) {
            btnToggleMock.textContent = mockDataEnabled ? 'Mock: ON' : 'Mock: OFF';
            btnToggleMock.style.backgroundColor = mockDataEnabled ? '#333' : '#555';
        }
    }

    console.log('[MockData] Module loaded (Mock Serial Engine integration only)');
})();
