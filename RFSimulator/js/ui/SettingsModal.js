/**
 * SettingsModal
 * Handles the main settings dialog
 */
class SettingsModal {
    constructor() {
        this.modal = document.getElementById('settingsModal');
        this.btnOpenShortcuts = document.getElementById('btnOpenShortcuts');
        this.btnClose = document.getElementById('btnCloseSettings');
        this.btnCloseIcon = document.getElementById('btnCloseSettingsModal');
        this.btnSettings = document.getElementById('btnSettings');

        // Settings Elements
        this.wheelSensitivityInput = document.getElementById('wheelSensitivity');
        this.wheelSensitivityValue = document.getElementById('wheelSensitivityValue');

        // Global Settings Object
        window.globalSettings = {
            wheelSensitivity: 0.01 // Default 1%
        };

        this.init();
    }

    init() {
        // Load Settings
        this.loadSettings();

        // Open Modal
        if (this.btnSettings) {
            this.btnSettings.addEventListener('click', () => this.open());
        }

        // Close Modal
        if (this.btnClose) {
            this.btnClose.addEventListener('click', () => this.close());
        }
        if (this.btnCloseIcon) {
            this.btnCloseIcon.addEventListener('click', () => this.close());
        }

        // Open Shortcuts Modal
        if (this.btnOpenShortcuts) {
            this.btnOpenShortcuts.addEventListener('click', () => {
                this.close(); // Close settings to open shortcuts (or stack them if preferred, but close is cleaner for now)
                if (window.shortcutModal) {
                    window.shortcutModal.open();
                }
            });
        }

        // Wheel Sensitivity Input
        if (this.wheelSensitivityInput) {
            this.wheelSensitivityInput.addEventListener('input', () => {
                const val = parseInt(this.wheelSensitivityInput.value);
                const percentage = (val / 10).toFixed(1);

                if (this.wheelSensitivityValue) {
                    this.wheelSensitivityValue.textContent = `${percentage}%`;
                }

                // Update global setting (val is 1-50, representing 0.1% to 5.0%)
                // stored as fraction 0.001 to 0.05
                window.globalSettings.wheelSensitivity = val / 1000;

                this.saveSettings();
            });
        }

        // Close on outside click
        window.addEventListener('click', (e) => {
            if (e.target === this.modal) {
                this.close();
            }
        });
    }

    loadSettings() {
        const stored = localStorage.getItem('rf_circuit_sim_global_settings');
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                // Merge with defaults
                window.globalSettings = { ...window.globalSettings, ...parsed };
            } catch (e) {
                console.error('Failed to load global settings', e);
            }
        }

        // Update UI
        if (this.wheelSensitivityInput) {
            // fraction to input value (0.01 -> 10)
            const inputVal = Math.round(window.globalSettings.wheelSensitivity * 1000);
            this.wheelSensitivityInput.value = inputVal;

            if (this.wheelSensitivityValue) {
                this.wheelSensitivityValue.textContent = `${(inputVal / 10).toFixed(1)}%`;
            }
        }
    }

    saveSettings() {
        localStorage.setItem('rf_circuit_sim_global_settings', JSON.stringify(window.globalSettings));
    }

    open() {
        if (this.modal) {
            this.modal.style.display = 'block';
            this.loadSettings(); // Reload to ensure UI is in sync
        }
    }

    close() {
        if (this.modal) {
            this.modal.style.display = 'none';
        }
    }
}
