/**
 * Inline Slider
 * Shows a slider above the component for quick parameter adjustment
 */
class InlineSlider {
    constructor(circuit) {
        this.circuit = circuit;
        this.element = null;
        this.slider = null;
        this.valueDisplay = null;
        this.labelDisplay = null;
        this.currentComponent = null;
        this.currentConfig = null;

        // Re-use logic from ComponentModal (simplified)
        // Unit multipliers
        this.UNIT_MULTIPLIERS = {
            'mΩ': 1e-3, 'Ω': 1, 'kΩ': 1e3, 'MΩ': 1e6,
            'pH': 1e-12, 'nH': 1e-9, 'μH': 1e-6, 'mH': 1e-3, 'H': 1,
            'fF': 1e-15, 'pF': 1e-12, 'nF': 1e-9, 'μF': 1e-6, 'mF': 1e-3, 'F': 1,
            'mm': 1e-3, 'cm': 1e-2, 'm': 1
        };

        // Simplified config for primary parameter only
        this.PARAM_CONFIG = {
            'R': { name: 'resistance', label: 'Resistance', unit: 'Ω', min: 1, max: 10000, log: true, unitList: ['mΩ', 'Ω', 'kΩ', 'MΩ'] },
            'L': { name: 'inductance', label: 'Inductance', unit: 'nH', min: 1e-9, max: 1e-3, log: true, unitList: ['pH', 'nH', 'μH', 'mH', 'H'] },
            'C': { name: 'capacitance', label: 'Capacitance', unit: 'pF', min: 1e-12, max: 1e-6, log: true, unitList: ['fF', 'pF', 'nF', 'μF', 'mF', 'F'] },
            'TL': { name: 'length', label: 'Length', unit: 'cm', min: 0.001, max: 1, log: true, unitList: ['mm', 'cm', 'm'] },
            'PORT': { name: 'impedance', label: 'Impedance', unit: 'Ω', min: 10, max: 1000, log: true, unitList: ['Ω', 'kΩ'] }
        };

        this.init();
    }

    init() {
        // Create container
        this.element = document.createElement('div');
        this.element.className = 'inline-slider-container';

        // Header (Label + Value)
        const header = document.createElement('div');
        header.className = 'slider-header';

        this.labelDisplay = document.createElement('span');
        this.labelDisplay.textContent = 'Param';

        this.valueDisplay = document.createElement('span');
        this.valueDisplay.className = 'slider-value';
        this.valueDisplay.textContent = '0';

        header.appendChild(this.labelDisplay);
        header.appendChild(this.valueDisplay);

        // Slider Input
        this.slider = document.createElement('input');
        this.slider.type = 'range';
        this.slider.className = 'inline-slider';
        this.slider.min = 0;
        this.slider.max = 1000;
        this.slider.value = 500;

        this.element.appendChild(header);
        this.element.appendChild(this.slider);

        document.body.appendChild(this.element);

        // Events
        this.slider.addEventListener('input', (e) => this.handleInput(e));
        this.slider.addEventListener('mousedown', (e) => e.stopPropagation()); // Prevent drag start on canvas
        this.element.addEventListener('mousedown', (e) => e.stopPropagation());

        // Mouse wheel support
        this.element.addEventListener('wheel', (e) => this.handleWheel(e), { passive: false });
    }

    /**
     * Handle mouse wheel
     */
    handleWheel(e) {
        if (!this.currentComponent || !this.currentConfig) return;

        e.preventDefault();

        // Get sensitivity from global settings or default to 2% (0.02) - Inline feels better with a bit more
        // But matching Global Setting is key. Default is 0.01 (1%)
        const sensitivity = window.globalSettings?.wheelSensitivity || 0.01;

        // Slider range is 0-1000
        const range = 1000;
        const step = range * sensitivity;

        const direction = e.deltaY > 0 ? -1 : 1; // Down = decrease, Up = increase

        let currentVal = parseFloat(this.slider.value);
        let newVal = currentVal + (direction * step);

        newVal = Math.max(0, Math.min(1000, newVal));

        if (newVal !== currentVal) {
            this.slider.value = newVal;
            // Manually trigger input event logic
            this.handleInput({ target: this.slider });
        }
    }

    /**
     * Show slider for component
     */
    show(component, screenX, screenY) {
        if (!component) return;

        const config = this.PARAM_CONFIG[component.type];
        if (!config) {
            this.hide();
            return;
        }

        this.currentComponent = component;
        // Clone config to allow overriding
        this.currentConfig = { ...config };

        // Check for persisted range from ComponentModal
        const persisted = component.sliderRange?.[config.name];
        if (persisted) {
            const minMultiplier = this.UNIT_MULTIPLIERS[persisted.minUnit] || 1;
            const maxMultiplier = this.UNIT_MULTIPLIERS[persisted.maxUnit] || 1;
            this.currentConfig.min = persisted.min * minMultiplier;
            this.currentConfig.max = persisted.max * maxMultiplier;

            // Fix for log scale if min <= 0 (prevents NaN)
            if (this.currentConfig.log && this.currentConfig.min <= 0) {
                // Set to a very small positive number or default min
                this.currentConfig.min = Math.max(1e-15, config.min);
            }
        }

        // Update Label
        this.labelDisplay.textContent = config.label;

        // Update Slider Position & Value
        this.updateUIFromComponent();

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
    }

    /**
     * Update UI (Slider + Text) from component state
     */
    updateUIFromComponent() {
        if (!this.currentComponent || !this.currentConfig) return;

        const paramName = this.currentConfig.name;
        const val = this.currentComponent.params[paramName];

        // Text Display
        const { displayValue, displayUnit } = this.formatDisplay(val, this.currentConfig.unitList);
        this.valueDisplay.textContent = `${displayValue}${displayUnit}`;

        // Slider Position (0-1000)
        let normalized = 0;
        if (this.currentConfig.log) {
            const minLog = Math.log10(this.currentConfig.min);
            const maxLog = Math.log10(this.currentConfig.max);
            const valLog = Math.log10(Math.max(this.currentConfig.min, val));
            normalized = (valLog - minLog) / (maxLog - minLog);
        } else {
            normalized = (val - this.currentConfig.min) / (this.currentConfig.max - this.currentConfig.min);
        }

        this.slider.value = Math.max(0, Math.min(1000, normalized * 1000));
    }

    /**
     * Handle slider input
     */
    handleInput(e) {
        if (!this.currentComponent || !this.currentConfig) return;

        const sliderVal = parseInt(e.target.value) / 1000;
        let newVal = 0;

        if (this.currentConfig.log) {
            const minLog = Math.log10(this.currentConfig.min);
            const maxLog = Math.log10(this.currentConfig.max);
            newVal = Math.pow(10, minLog + sliderVal * (maxLog - minLog));
        } else {
            newVal = this.currentConfig.min + sliderVal * (this.currentConfig.max - this.currentConfig.min);
        }

        // Update Component
        this.currentComponent.params[this.currentConfig.name] = newVal;

        // Update UI Text
        const { displayValue, displayUnit } = this.formatDisplay(newVal, this.currentConfig.unitList);
        this.valueDisplay.textContent = `${displayValue}${displayUnit}`;

        // Re-render
        if (this.currentComponent.element && this.currentComponent.element.parentNode) {
            const newEl = this.currentComponent.render();
            this.currentComponent.element.parentNode.replaceChild(newEl, this.currentComponent.element);
        }

        // Notify Circuit
        if (window.circuit) {
            window.circuit.notifyChange();
        }
    }

    /**
     * Helper to format display value
     */
    formatDisplay(val, unitList) {
        // Simple auto-range
        let bestUnit = unitList[0];
        let bestVal = val;

        for (const unit of unitList) {
            const multiplier = this.UNIT_MULTIPLIERS[unit];
            const testVal = val / multiplier;
            if (testVal >= 1 || unit === unitList[unitList.length - 1]) {
                bestUnit = unit;
                bestVal = testVal;
                // If it's too big, try next
                if (testVal >= 1000 && unit !== unitList[unitList.length - 1]) {
                    continue;
                }
                break;
            }
        }

        // Rounding
        if (bestVal >= 100) bestVal = Math.round(bestVal);
        else if (bestVal >= 10) bestVal = Math.round(bestVal * 10) / 10;
        else bestVal = Math.round(bestVal * 100) / 100;

        return { displayValue: bestVal, displayUnit: bestUnit };
    }
}

window.InlineSlider = InlineSlider;
