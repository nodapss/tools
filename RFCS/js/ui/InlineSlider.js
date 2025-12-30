/**
 * Inline Slider
 * Shows a slider above the component for quick parameter adjustment
 */
class InlineSlider {
    constructor(circuit) {
        this.circuit = circuit;
        this.element = null;
        this.sliderRows = []; // Array of { element, slider, valueDisplay, config }
        this.currentComponent = null;
        this.currentConfigs = null; // Array of configs

        // Re-use logic from ComponentModal (simplified)
        // Unit multipliers
        this.UNIT_MULTIPLIERS = {
            'mΩ': 1e-3, 'Ω': 1, 'kΩ': 1e3, 'MΩ': 1e6,
            'pH': 1e-12, 'nH': 1e-9, 'μH': 1e-6, 'mH': 1e-3, 'H': 1,
            'fF': 1e-15, 'pF': 1e-12, 'nF': 1e-9, 'μF': 1e-6, 'mF': 1e-3, 'F': 1,
            'mm': 1e-3, 'cm': 1e-2, 'm': 1
        };

        // Simplified config for parameters
        this.PARAM_CONFIG = {
            'R': [{ name: 'resistance', label: 'Resistance', unit: 'Ω', min: 1, max: 10000, log: true, unitList: ['mΩ', 'Ω', 'kΩ', 'MΩ'] }],
            'L': [{ name: 'inductance', label: 'Inductance', unit: 'nH', min: 1e-9, max: 1e-3, log: true, unitList: ['pH', 'nH', 'μH', 'mH', 'H'] }],
            'C': [{ name: 'capacitance', label: 'Capacitance', unit: 'pF', min: 1e-12, max: 1e-6, log: true, unitList: ['fF', 'pF', 'nF', 'μF', 'mF', 'F'] }],
            'TL': [{ name: 'length', label: 'Length', unit: 'cm', min: 0.001, max: 1, log: true, unitList: ['mm', 'cm', 'm'] }],
            'PORT': [{ name: 'impedance', label: 'Impedance', unit: 'Ω', min: 10, max: 1000, log: true, unitList: ['Ω', 'kΩ'] }],
            'Z': [
                { name: 'resistance', label: 'Resistance', unit: 'Ω', min: 0, max: 1000, log: false, unitList: ['mΩ', 'Ω', 'kΩ'] },
                { name: 'reactance', label: 'Reactance', unit: 'Ω', min: -1000, max: 1000, log: false, unitList: ['mΩ', 'Ω', 'kΩ'] }
            ]
        };

        this.init();
    }

    init() {
        // Create container (wrapper for all sliders)
        this.element = document.createElement('div');
        this.element.className = 'inline-slider-container';
        // Stop events from propagating to canvas
        this.element.addEventListener('mousedown', (e) => e.stopPropagation());
        this.element.addEventListener('wheel', (e) => this.handleWheel(e), { passive: false });

        document.body.appendChild(this.element);
    }

    /**
     * Create a single slider row
     */
    createSliderRow(config) {
        const row = document.createElement('div');
        row.className = 'slider-row';
        row.style.marginBottom = '8px';

        // Header (Label + Value)
        const header = document.createElement('div');
        header.className = 'slider-header';

        const labelDisplay = document.createElement('span');
        labelDisplay.textContent = config.label;

        const valueDisplay = document.createElement('span');
        valueDisplay.className = 'slider-value';
        valueDisplay.textContent = '0';

        header.appendChild(labelDisplay);
        header.appendChild(valueDisplay);

        // Slider Input
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.className = 'inline-slider';
        slider.min = 0;
        slider.max = 1000;
        slider.value = 500;

        row.appendChild(header);
        row.appendChild(slider);

        // Bind events for this specific slider
        slider.addEventListener('input', (e) => this.handleInput(e, config, slider, valueDisplay));
        slider.addEventListener('mousedown', (e) => e.stopPropagation());

        return { element: row, slider, valueDisplay, config };
    }

    /**
     * Show slider for component
     */
    show(component, screenX, screenY) {
        if (!component) return;

        let configs = this.PARAM_CONFIG[component.type];
        if (!configs) {
            this.hide();
            return;
        }

        this.currentComponent = component;
        // Clone configs deeply enough
        this.currentConfigs = JSON.parse(JSON.stringify(configs));

        // Clear existing content
        this.element.innerHTML = '';
        this.sliderRows = [];

        // Generate rows
        this.currentConfigs.forEach((config, index) => {
            // Check for persisted range from ComponentModal
            // (Note: persistence logic might need update for multi-param, assuming simple mapping for now)
            const persisted = component.sliderRange?.[config.name];
            if (persisted) {
                const minMultiplier = this.UNIT_MULTIPLIERS[persisted.minUnit] || 1;
                const maxMultiplier = this.UNIT_MULTIPLIERS[persisted.maxUnit] || 1;
                config.min = persisted.min * minMultiplier;
                config.max = persisted.max * maxMultiplier;

                // Fix for log scale if min <= 0
                if (config.log && config.min <= 0) {
                    config.min = Math.max(1e-15, config.min);
                }
            }

            const rowObj = this.createSliderRow(config);
            this.sliderRows.push(rowObj);
            this.element.appendChild(rowObj.element);

            // Initial update
            this.updateSliderUI(rowObj, component);
        });

        // Position element
        this.element.style.left = `${screenX}px`;
        this.element.style.top = `${screenY}px`;
        this.element.classList.add('active');
    }

    /**
     * Hide slider
     */
    hide() {
        this.element.classList.remove('active');
        this.currentComponent = null;
        this.sliderRows = [];
    }

    /**
     * Update specific slider UI from component state
     */
    updateSliderUI(rowObj, component) {
        const config = rowObj.config;
        const val = component.params[config.name];

        // Text Display
        const { displayValue, displayUnit } = this.formatDisplay(val, config.unitList);
        rowObj.valueDisplay.textContent = `${displayValue}${displayUnit}`;

        // Slider Position (0-1000)
        let normalized = 0;
        if (config.log) {
            const minLog = Math.log10(config.min);
            const maxLog = Math.log10(config.max);
            const valLog = Math.log10(Math.max(config.min, val)); // Protect against <=0 in log
            normalized = (valLog - minLog) / (maxLog - minLog);
        } else {
            normalized = (val - config.min) / (config.max - config.min);
        }

        rowObj.slider.value = Math.max(0, Math.min(1000, normalized * 1000));
    }

    /**
     * Handle slider input
     */
    handleInput(e, config, slider, valueDisplay) {
        if (!this.currentComponent) return;

        const sliderVal = parseInt(slider.value) / 1000;
        let newVal = 0;

        if (config.log) {
            const minLog = Math.log10(config.min);
            const maxLog = Math.log10(config.max);
            newVal = Math.pow(10, minLog + sliderVal * (maxLog - minLog));
        } else {
            newVal = config.min + sliderVal * (config.max - config.min);
        }

        // Update Component
        this.currentComponent.params[config.name] = newVal;

        // Update UI Text
        const { displayValue, displayUnit } = this.formatDisplay(newVal, config.unitList);
        valueDisplay.textContent = `${displayValue}${displayUnit}`;

        // Re-render
        if (this.currentComponent.element && this.currentComponent.element.parentNode) {
            const newEl = this.currentComponent.render();
            // Handle if element was replaced (re-attach event listeners? 
            // DragDropHandler handles standard events. InlineSlider is external.)
            this.currentComponent.element.parentNode.replaceChild(newEl, this.currentComponent.element);
            // Make sure we update the reference in currentComponent if render creates a new object wrapper? 
            // Logic in Component.js usually updates `this.element`.
        }

        // Notify Circuit
        if (window.circuit) {
            window.circuit.notifyChange();
        }
    }

    /**
     * Handle mouse wheel
     */
    handleWheel(e) {
        if (!this.currentComponent || this.sliderRows.length === 0) return;

        e.preventDefault();

        // Determine which slider to affect. 
        // Simple heuristic: If hovering a specific row, use that. 
        // If not, default to the first one? Or maybe just don't do anything if not over a row?
        // Since the event listener is on the container, e.target should tell us.

        let targetRow = this.sliderRows.find(row => row.element.contains(e.target));

        // Fallback: If not clearly on a row (e.g. padding), maybe use the first one 
        // or just ignore. Let's use the first one if only 1 exists (common case).
        if (!targetRow && this.sliderRows.length === 1) {
            targetRow = this.sliderRows[0];
        }

        if (!targetRow) return;

        const sensitivity = window.globalSettings?.wheelSensitivity || 0.01;
        const range = 1000;
        const step = range * sensitivity;
        const direction = e.deltaY > 0 ? -1 : 1;

        let currentVal = parseFloat(targetRow.slider.value);
        let newVal = currentVal + (direction * step);

        newVal = Math.max(0, Math.min(1000, newVal));

        if (newVal !== currentVal) {
            targetRow.slider.value = newVal;
            // Trigger input logic
            this.handleInput(
                { target: targetRow.slider },
                targetRow.config,
                targetRow.slider,
                targetRow.valueDisplay
            );
        }
    }

    /**
     * Helper to format display value
     */
    formatDisplay(val, unitList) {
        // Handle negative values for linear scales (like reactance)
        const absVal = Math.abs(val);
        const sign = val < 0 ? '-' : '';

        // Simple auto-range
        let bestUnit = unitList[0];
        let bestVal = absVal;

        for (const unit of unitList) {
            const multiplier = this.UNIT_MULTIPLIERS[unit];
            const testVal = absVal / multiplier;

            // If it's reasonable size (>=1) or it's the smallest unit
            if (testVal >= 1 || unit === unitList[unitList.length - 1]) {
                // If it's the largest unit, just take it
                if (unit === unitList[unitList.length - 1]) {
                    bestUnit = unit;
                    bestVal = testVal;
                    break;
                }

                // If it's not too huge, take it. 
                // E.g. 1500 ohms -> 1.5 kOhm
                if (testVal < 1000) {
                    bestUnit = unit;
                    bestVal = testVal;
                    break;
                }
            }
        }

        // Rounding
        if (bestVal >= 100) bestVal = Math.round(bestVal);
        else if (bestVal >= 10) bestVal = Math.round(bestVal * 10) / 10;
        else bestVal = Math.round(bestVal * 100) / 100;

        return { displayValue: `${sign}${bestVal}`, displayUnit: bestUnit };
    }
}

window.InlineSlider = InlineSlider;
