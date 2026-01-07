/**
 * ComponentModal.js
 * Component parameter editing modal with unit selection and slider
 */

class ComponentModal {
    constructor() {
        this.modal = document.getElementById('componentModal');
        this.modalTitle = document.getElementById('componentModalTitle');
        this.modalBody = document.getElementById('componentModalBody');
        this.currentComponent = null;
        this.paramStates = {};  // Stores current param values and ranges
        this.originalParams = null;  // 원래 파라미터 값 저장 (Cancel용)

        // Unit multipliers
        this.UNIT_MULTIPLIERS = {
            // Resistance/Impedance (Ω)
            'mΩ': 1e-3, 'Ω': 1, 'kΩ': 1e3, 'MΩ': 1e6,
            // Inductance (H)
            'pH': 1e-12, 'nH': 1e-9, 'μH': 1e-6, 'mH': 1e-3, 'H': 1,
            // Capacitance (F)
            'fF': 1e-15, 'pF': 1e-12, 'nF': 1e-9, 'μF': 1e-6, 'mF': 1e-3, 'F': 1,
            // Length (m)
            'mm': 1e-3, 'cm': 1e-2, 'm': 1,
            // Velocity (m/s)
            'm/s': 1,
            // Port number (dimensionless)
            '': 1,

            // Per-meter units (Transmission Line)
            'mΩ/m': 1e-3, 'Ω/m': 1, 'kΩ/m': 1e3,
            'pH/m': 1e-12, 'nH/m': 1e-9, 'μH/m': 1e-6,
            'fF/m': 1e-15, 'pF/m': 1e-12, 'nF/m': 1e-9, 'μF/m': 1e-6,
            'nS/m': 1e-9, 'μS/m': 1e-6, 'mS/m': 1e-3, 'S/m': 1,
            'dB/m': 1
        };

        // Parameter configurations per component type
        this.PARAM_CONFIG = {
            'R': [{
                name: 'resistance',
                label: 'Resistance',
                units: ['mΩ', 'Ω', 'kΩ', 'MΩ'],
                defaultUnit: 'Ω',
                defaultMin: { value: 0, unit: 'Ω' },
                defaultMax: { value: 10, unit: 'kΩ' }
            }],
            'L': [{
                name: 'inductance',
                label: 'Inductance',
                units: ['pH', 'nH', 'μH', 'mH', 'H'],
                defaultUnit: 'μH',
                defaultMin: { value: 1, unit: 'μH' },
                defaultMax: { value: 20, unit: 'μH' }
            }],
            'C': [{
                name: 'capacitance',
                label: 'Capacitance',
                units: ['fF', 'pF', 'nF', 'μF', 'mF', 'F'],
                defaultUnit: 'pF',
                defaultMin: { value: 1, unit: 'pF' },
                defaultMax: { value: 20, unit: 'pF' }
            }],
            'PORT': [
                {
                    name: 'portNumber',
                    label: 'Port Number',
                    units: [''],
                    defaultUnit: '',
                    defaultMin: { value: 1, unit: '' },
                    defaultMax: { value: 4, unit: '' },
                    isInteger: true
                },
                {
                    name: 'impedance',
                    label: 'Impedance',
                    units: ['Ω', 'kΩ'],
                    defaultUnit: 'Ω',
                    defaultMin: { value: 1, unit: 'Ω' },
                    defaultMax: { value: 1, unit: 'kΩ' }
                }
            ],
            'TL': [
                {
                    name: 'modelType',
                    label: 'Model Type',
                    type: 'select',
                    options: [
                        { value: 'standard', label: 'Standard (Z₀, v, Loss)' },
                        { value: 'rlgc', label: 'Physical (RLGC)' }
                    ],
                    units: [''],
                    defaultUnit: '',
                    defaultMin: { value: 0, unit: '' },
                    defaultMax: { value: 0, unit: '' }
                },
                // Standard Model Params
                {
                    name: 'z0',
                    label: 'Characteristic Impedance (Z₀)',
                    units: ['Ω', 'kΩ'],
                    defaultUnit: 'Ω',
                    defaultMin: { value: 10, unit: 'Ω' },
                    defaultMax: { value: 200, unit: 'Ω' },
                    condition: (params) => !params.modelType || params.modelType === 'standard'
                },
                {
                    name: 'velocity',
                    label: 'Velocity Factor',
                    units: [''], // Will handle scale internally or display float
                    defaultUnit: '',
                    defaultMin: { value: 0.1, unit: '' },
                    defaultMax: { value: 1.0, unit: '' },
                    scale: 3e8, // Special handling for velocity if needed, but keeping simple for now
                    condition: (params) => !params.modelType || params.modelType === 'standard'
                },
                {
                    name: 'loss',
                    label: 'Loss (dB/m)',
                    units: ['dB/m'],
                    defaultUnit: 'dB/m',
                    defaultMin: { value: 0, unit: 'dB/m' },
                    defaultMax: { value: 10, unit: 'dB/m' },
                    condition: (params) => !params.modelType || params.modelType === 'standard'
                },
                // RLGC Params
                {
                    name: 'r',
                    label: 'Resistance (R)',
                    units: ['mΩ/m', 'Ω/m', 'kΩ/m'],
                    defaultUnit: 'Ω/m',
                    defaultMin: { value: 0, unit: 'Ω/m' },
                    defaultMax: { value: 100, unit: 'Ω/m' },
                    condition: (params) => params.modelType === 'rlgc'
                },
                {
                    name: 'l',
                    label: 'Inductance (L)',
                    units: ['pH/m', 'nH/m', 'μH/m'],
                    defaultUnit: 'nH/m',
                    defaultMin: { value: 10, unit: 'nH/m' },
                    defaultMax: { value: 1000, unit: 'nH/m' },
                    condition: (params) => params.modelType === 'rlgc'
                },
                {
                    name: 'g',
                    label: 'Conductance (G)',
                    units: ['nS/m', 'μS/m', 'mS/m', 'S/m'],
                    defaultUnit: 'S/m',
                    defaultMin: { value: 0, unit: 'S/m' },
                    defaultMax: { value: 1, unit: 'S/m' },
                    condition: (params) => params.modelType === 'rlgc'
                },
                {
                    name: 'c',
                    label: 'Capacitance (C)',
                    units: ['fF/m', 'pF/m', 'nF/m', 'μF/m'],
                    defaultUnit: 'pF/m',
                    defaultMin: { value: 1, unit: 'pF/m' },
                    defaultMax: { value: 200, unit: 'pF/m' },
                    condition: (params) => params.modelType === 'rlgc'
                },
                // Common Params
                {
                    name: 'length',
                    label: 'Length',
                    units: ['mm', 'cm', 'm'],
                    defaultUnit: 'cm',
                    defaultMin: { value: 1, unit: 'mm' },
                    defaultMax: { value: 1, unit: 'm' }
                }
            ],
            'Z': [
                {
                    name: 'resistance',
                    label: 'Resistance (Real)',
                    units: ['mΩ', 'Ω', 'kΩ', 'MΩ'],
                    defaultUnit: 'Ω',
                    defaultMin: { value: 0, unit: 'Ω' },
                    defaultMax: { value: 100, unit: 'Ω' }
                },
                {
                    name: 'reactance',
                    label: 'Reactance (Imag)',
                    units: ['mΩ', 'Ω', 'kΩ', 'MΩ'], // Include same units
                    defaultUnit: 'Ω',
                    defaultMin: { value: -100, unit: 'Ω' },
                    defaultMax: { value: 100, unit: 'Ω' },
                    disableAutoRange: false
                }
            ],
            'GND': []  // Ground has no editable parameters
        };

        this.bindEvents();
    }

    /**
     * Bind modal events
     */
    bindEvents() {
        // Close button (X) → Cancel
        document.getElementById('btnCloseComponentModal')?.addEventListener('click', () => this.cancel());

        // Cancel button → Cancel (원래 값 복원)
        document.getElementById('btnCancelComponent')?.addEventListener('click', () => this.cancel());

        // Apply button → 확정 (이미 실시간 적용됨)
        document.getElementById('btnApplyComponent')?.addEventListener('click', () => this.applyChanges());

        // Overlay click → Cancel
        this.modal?.querySelector('.modal-overlay')?.addEventListener('click', () => this.cancel());

        // ESC key → Cancel
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.modal?.classList.contains('active')) {
                this.cancel();
            }
        });
    }

    /**
     * Open modal for a component
     */
    open(component) {
        if (!component || !this.modal) return;

        const config = this.PARAM_CONFIG[component.type];
        if (!config || config.length === 0) {
            console.log('No editable parameters for this component type');
            return;
        }

        this.currentComponent = component;
        this.paramStates = {};

        // 원래 파라미터 값 저장 (Cancel용)
        this.originalParams = {};
        config.forEach(paramConfig => {
            this.originalParams[paramConfig.name] = component.params[paramConfig.name];
        });

        // Set title
        const typeNames = {
            'R': 'Resistor',
            'L': 'Inductor',
            'C': 'Capacitor',
            'PORT': 'Port',
            'TL': 'Transmission Line',
            'Z': 'Impedance Block',
            'GND': 'Ground'
        };
        this.modalTitle.textContent = `${typeNames[component.type] || component.type} Settings`;

        // Generate content
        this.modalBody.innerHTML = this.generateContent(component, config);

        // Initialize event listeners for dynamic elements
        this.initDynamicEvents();

        // Show modal
        this.modal.classList.add('active');
    }

    /**
     * Close modal
     */
    close() {
        if (this.modal) {
            this.modal.classList.remove('active');
            this.currentComponent = null;
            this.paramStates = {};
        }
    }

    /**
     * Generate modal content HTML
     */
    generateContent(component, config) {
        // ID Input Section
        const idSection = `
            <div class="param-section" style="margin-bottom: 15px; border-bottom: 1px solid var(--border-color); padding-bottom: 15px;">
                <label class="param-label">Component ID</label>
                <div class="value-row">
                    <input type="text" 
                           class="value-input" 
                           id="componentIdInput" 
                           value="${component.id}" 
                           style="width: 100%; text-align: left;">
                </div>
            </div>
        `;

        const paramsHtml = config.map((paramConfig, index) => {
            const currentValue = component.params[paramConfig.name];

            // Handle Select Type
            if (paramConfig.type === 'select') {
                this.paramStates[paramConfig.name] = {
                    value: currentValue || paramConfig.options[0]?.value,
                    config: paramConfig
                };

                // Check visibility
                const isVisible = paramConfig.condition ? paramConfig.condition(component.params) : true;
                const displayStyle = isVisible ? 'block' : 'none';

                return this.createSelectSection(paramConfig, currentValue, displayStyle);
            }

            // Validating numeric params
            let displayVal, displayUnit;
            if (paramConfig.name === 'velocity' && component.type === 'TL') {
                // Velocity special case: store as m/s (3e8), display as ratio (1.0)
                // Actually component param stores 3e8.
                // We want to show 1.0 c. 
                // Let's rely on unit multipliers? 'c': 3e8? 
                // For now, let's treat it as a float: 0.66
                // component.params.velocity is e.g. 2e8

                // Simple hack for velocity: treat unit as empty, value as ratio to c
                displayVal = (currentValue / 3e8).toFixed(4);
                displayUnit = '';
            } else {
                const res = this.convertToDisplay(currentValue, paramConfig);
                displayVal = res.displayValue;
                displayUnit = res.displayUnit;
            }

            // Check for persisted range config
            const persisted = component.sliderRange?.[paramConfig.name];

            // Initialize param state
            this.paramStates[paramConfig.name] = {
                value: displayVal,
                unit: displayUnit,
                minValue: persisted ? persisted.min : paramConfig.defaultMin.value,
                minUnit: persisted ? persisted.minUnit : paramConfig.defaultMin.unit,
                maxValue: persisted ? persisted.max : paramConfig.defaultMax.value,
                maxUnit: persisted ? persisted.maxUnit : paramConfig.defaultMax.unit,
                isManual: persisted ? persisted.isManual : false,
                config: paramConfig
            };

            // Check visibility
            const isVisible = paramConfig.condition ? paramConfig.condition(component.params) : true;
            const displayStyle = isVisible ? 'block' : 'none';

            return this.createParamSection(paramConfig, displayVal, displayUnit, index, displayStyle);
        }).join('');

        return idSection + paramsHtml;
    }

    /**
     * Create HTML for Select parameter
     */
    createSelectSection(config, value, displayStyle) {
        const optionsHtml = config.options.map(opt =>
            `<option value="${opt.value}" ${opt.value === value ? 'selected' : ''}>${opt.label}</option>`
        ).join('');

        return `
            <div class="param-section" data-param="${config.name}" style="display: ${displayStyle}">
                <label class="param-label">${config.label}</label>
                <div class="value-row">
                    <select class="value-input" id="select_${config.name}" style="width: 100%">
                        ${optionsHtml}
                    </select>
                </div>
            </div>
        `;
    }

    /**
     * Create HTML for a parameter section
     */
    createParamSection(config, value, unit, index, displayStyle = 'block') {
        const unitOptions = config.units.map(u =>
            `<option value="${u}" ${u === unit ? 'selected' : ''}>${u || '-'}</option>`
        ).join('');

        const currentMinUnit = this.paramStates[config.name].minUnit;
        const currentMaxUnit = this.paramStates[config.name].maxUnit;

        const minUnitOptions = config.units.map(u =>
            `<option value="${u}" ${u === currentMinUnit ? 'selected' : ''}>${u || '-'}</option>`
        ).join('');

        const maxUnitOptions = config.units.map(u =>
            `<option value="${u}" ${u === currentMaxUnit ? 'selected' : ''}>${u || '-'}</option>`
        ).join('');

        const step = config.isInteger ? '1' : 'any';

        return `
            <div class="param-section" data-param="${config.name}" style="display: ${displayStyle}">
                <label class="param-label">${config.label}</label>
                
                <!-- Value Input -->
                <div class="value-row">
                    <input type="number" 
                           class="value-input" 
                           id="value_${config.name}" 
                           value="${value}" 
                           step="${step}">
                    <select class="unit-select" id="unit_${config.name}">
                        ${unitOptions}
                    </select>
                </div>
                
                <!-- Range Section -->
                <div class="range-section">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                        <label class="range-label" style="margin-bottom: 0;">Range</label>
                        <div style="display: flex; align-items: center; gap: 5px;">
                            <input type="checkbox" id="manual_${config.name}" ${this.paramStates[config.name].isManual ? 'checked' : ''}>
                            <label for="manual_${config.name}" style="font-size: 12px; color: var(--text-muted); cursor: pointer;">Manual</label>
                        </div>
                    </div>
                    <div class="range-row">
                        <div class="range-group">
                            <label>Min</label>
                            <input type="number" 
                                   class="range-input" 
                                   id="min_${config.name}" 
                                   value="${this.paramStates[config.name].minValue}"
                                   step="${step}">
                            <select class="range-unit" id="minUnit_${config.name}">
                                ${minUnitOptions}
                            </select>
                        </div>
                        <div class="range-group">
                            <label>Max</label>
                            <input type="number" 
                                   class="range-input" 
                                   id="max_${config.name}" 
                                   value="${this.paramStates[config.name].maxValue}"
                                   step="${step}">
                            <select class="range-unit" id="maxUnit_${config.name}">
                                ${maxUnitOptions}
                            </select>
                        </div>
                    </div>
                </div>
                
                <!-- Slider -->
                <div class="slider-section">
                    <input type="range" 
                           class="param-slider" 
                           id="slider_${config.name}"
                           min="0" 
                           max="1000" 
                           value="500">
                    <div class="slider-labels">
                        <span id="sliderMin_${config.name}">${this.paramStates[config.name].minValue} ${this.paramStates[config.name].minUnit}</span>
                        <span id="sliderMax_${config.name}">${this.paramStates[config.name].maxValue} ${this.paramStates[config.name].maxUnit}</span>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Initialize event listeners for dynamically created elements
     */
    initDynamicEvents() {
        Object.keys(this.paramStates).forEach(paramName => {
            const state = this.paramStates[paramName];

            // Handle Select Type Events
            if (state.config.type === 'select') {
                const selectElement = document.getElementById(`select_${paramName}`);
                if (selectElement) {
                    selectElement.addEventListener('change', () => {
                        state.value = selectElement.value;
                        this.applyParamImmediately(paramName);
                        // Trigger visibility check
                        this.updateVisibility();
                    });
                }
                return; // Skip numeric initialization
            }

            // Value input change
            const valueInput = document.getElementById(`value_${paramName}`);
            const unitSelect = document.getElementById(`unit_${paramName}`);
            const slider = document.getElementById(`slider_${paramName}`);
            const minInput = document.getElementById(`min_${paramName}`);
            const maxInput = document.getElementById(`max_${paramName}`);
            const minUnitSelect = document.getElementById(`minUnit_${paramName}`);
            const maxUnitSelect = document.getElementById(`maxUnit_${paramName}`);

            // Value input → Update slider + 즉시 적용 + Range 자동 업데이트
            valueInput?.addEventListener('input', () => {
                state.value = parseFloat(valueInput.value) || 0;

                // Auto-update range (Min: 0, Max: Value*2)
                if (!state.config.disableAutoRange && !state.isManual) {
                    this.autoUpdateRange(paramName);
                }

                this.updateSliderFromValue(paramName);
                this.applyParamImmediately(paramName);
            });

            // Unit select → Update slider position + 즉시 적용 + Range 자동 업데이트
            unitSelect?.addEventListener('change', () => {
                state.unit = unitSelect.value;

                // Auto-update range (Sync units)
                if (!state.config.disableAutoRange && !state.isManual) {
                    this.autoUpdateRange(paramName);
                }

                this.updateSliderFromValue(paramName);
                this.applyParamImmediately(paramName);
            });

            // Slider → Update value input + 즉시 적용
            slider?.addEventListener('input', () => {
                this.updateValueFromSlider(paramName);
                this.applyParamImmediately(paramName);
            });

            // Min/Max inputs → Update slider range
            minInput?.addEventListener('input', () => {
                state.minValue = parseFloat(minInput.value) || 0;
                this.updateSliderRange(paramName);
                this.updateSliderFromValue(paramName);
                this.saveRangeToComponent(paramName);
                window.circuit?.notifyChange(); // Update Run Mode
            });

            maxInput?.addEventListener('input', () => {
                state.maxValue = parseFloat(maxInput.value) || 0;
                this.updateSliderRange(paramName);
                this.updateSliderFromValue(paramName);
                this.saveRangeToComponent(paramName);
                window.circuit?.notifyChange(); // Update Run Mode
            });

            minUnitSelect?.addEventListener('change', () => {
                state.minUnit = minUnitSelect.value;
                this.updateSliderRange(paramName);
                this.updateSliderFromValue(paramName);
                this.saveRangeToComponent(paramName);
                window.circuit?.notifyChange(); // Update Run Mode
            });

            maxUnitSelect?.addEventListener('change', () => {
                state.maxUnit = maxUnitSelect.value;
                this.updateSliderRange(paramName);
                this.updateSliderFromValue(paramName);
                this.saveRangeToComponent(paramName);
                window.circuit?.notifyChange(); // Update Run Mode
            });

            // Manual Checkbox
            const manualCheckbox = document.getElementById(`manual_${paramName}`);
            manualCheckbox?.addEventListener('change', () => {
                state.isManual = manualCheckbox.checked;
                this.saveRangeToComponent(paramName);

                // If unchecked, immediately auto-update
                if (!state.isManual) {
                    this.autoUpdateRange(paramName);
                    this.updateSliderFromValue(paramName);
                }
            });

            // Initial slider position
            this.updateSliderRange(paramName);
            this.updateSliderFromValue(paramName);

            // Wheel event for Slider
            slider?.addEventListener('wheel', (e) => {
                e.preventDefault();

                // Get sensitivity from global settings or default to 1% (0.01)
                const sensitivity = window.globalSettings?.wheelSensitivity || 0.01;
                const rangeDiff = parseInt(slider.max) - parseInt(slider.min); // Usually 1000
                const step = rangeDiff * sensitivity;

                const direction = e.deltaY > 0 ? -1 : 1; // Down = decrease

                let newVal = parseFloat(slider.value) + (direction * step);
                newVal = Math.max(parseFloat(slider.min), Math.min(parseFloat(slider.max), newVal));

                slider.value = newVal;

                // Trigger updates
                this.updateValueFromSlider(paramName);
                this.applyParamImmediately(paramName);
            }, { passive: false });
        });
    }

    /**
     * Update visibility of parameters based on current state (and conditions)
     */
    updateVisibility() {
        if (!this.currentComponent) return;

        // Re-evaluate params (as they might have changed via applyParamImmediately)
        const params = this.currentComponent.params;

        Object.keys(this.paramStates).forEach(paramName => {
            const state = this.paramStates[paramName];
            if (state.config.condition) {
                const isVisible = state.config.condition(params);
                const section = this.modalBody.querySelector(`.param-section[data-param="${paramName}"]`);
                if (section) {
                    section.style.display = isVisible ? 'block' : 'none';
                }
            }
        });
    }

    /**
     * Update slider range labels
     */
    updateSliderRange(paramName) {
        const state = this.paramStates[paramName];
        const minLabel = document.getElementById(`sliderMin_${paramName}`);
        const maxLabel = document.getElementById(`sliderMax_${paramName}`);

        if (minLabel) {
            minLabel.textContent = `${state.minValue} ${state.minUnit}`;
        }
        if (maxLabel) {
            maxLabel.textContent = `${state.maxValue} ${state.maxUnit}`;
        }
    }

    /**
     * Update slider position from value input
     */
    updateSliderFromValue(paramName) {
        const state = this.paramStates[paramName];
        const slider = document.getElementById(`slider_${paramName}`);
        if (!slider) return;

        // Convert all to base units for comparison
        const valueBase = state.value * (this.UNIT_MULTIPLIERS[state.unit] || 1);
        const minBase = state.minValue * (this.UNIT_MULTIPLIERS[state.minUnit] || 1);
        const maxBase = state.maxValue * (this.UNIT_MULTIPLIERS[state.maxUnit] || 1);

        if (maxBase <= minBase) {
            slider.value = 500;
            return;
        }

        // Use logarithmic scale for large ranges
        const useLog = (maxBase / minBase) > 100 && minBase > 0;

        let normalizedValue;
        if (useLog) {
            const logMin = Math.log10(minBase);
            const logMax = Math.log10(maxBase);
            const logValue = Math.log10(Math.max(valueBase, minBase));
            normalizedValue = (logValue - logMin) / (logMax - logMin);
        } else {
            normalizedValue = (valueBase - minBase) / (maxBase - minBase);
        }

        slider.value = Math.round(Math.max(0, Math.min(1, normalizedValue)) * 1000);
    }

    /**
     * Update value input from slider
     */
    updateValueFromSlider(paramName) {
        const state = this.paramStates[paramName];
        const slider = document.getElementById(`slider_${paramName}`);
        const valueInput = document.getElementById(`value_${paramName}`);
        if (!slider || !valueInput) return;

        const sliderValue = parseInt(slider.value) / 1000;

        // Convert min/max to base units
        const minBase = state.minValue * (this.UNIT_MULTIPLIERS[state.minUnit] || 1);
        const maxBase = state.maxValue * (this.UNIT_MULTIPLIERS[state.maxUnit] || 1);

        if (maxBase <= minBase) return;

        // Use logarithmic scale for large ranges
        const useLog = (maxBase / minBase) > 100 && minBase > 0;

        let valueBase;
        if (useLog) {
            const logMin = Math.log10(minBase);
            const logMax = Math.log10(maxBase);
            valueBase = Math.pow(10, logMin + sliderValue * (logMax - logMin));
        } else {
            valueBase = minBase + sliderValue * (maxBase - minBase);
        }

        // Convert back to display unit
        const unitMultiplier = this.UNIT_MULTIPLIERS[state.unit] || 1;
        let displayValue = valueBase / unitMultiplier;

        // Round to reasonable precision
        if (state.config.isInteger) {
            displayValue = Math.round(displayValue);
        } else {
            displayValue = this.roundToPrecision(displayValue, 3);
        }

        state.value = displayValue;
        valueInput.value = displayValue;
    }

    /**
     * Convert base value to display value with appropriate unit
     */
    /**
     * Convert base value to display value with appropriate unit
     */
    convertToDisplay(baseValue, config) {
        const units = config.units;
        const multipliers = units.map(u => this.UNIT_MULTIPLIERS[u] || 1);

        // Find best unit (where value is between 1 and 1000)
        let bestUnit = config.defaultUnit;
        let bestValue = baseValue / (this.UNIT_MULTIPLIERS[bestUnit] || 1);

        const absBaseValue = Math.abs(baseValue); // Use absolute value for unit check

        for (let i = 0; i < units.length; i++) {
            const absTestValue = absBaseValue / multipliers[i];

            // Fix floating point precision: treat very close to 1000 as 1000 (move to next unit)
            // e.g., 999.999999 should not be valid for this unit if next unit is 1.0
            const epsilon = 1e-6;

            // Allow 0 to be unitless or base unit, but if it has value:
            if (absTestValue >= 1 - epsilon && absTestValue < 1000 - epsilon) {
                bestUnit = units[i];
                bestValue = baseValue / multipliers[i]; // Keep sign
                break;
            }
        }

        // Round to reasonable precision
        if (config.isInteger) {
            bestValue = Math.round(bestValue);
        } else {
            bestValue = this.roundToPrecision(bestValue, 4);
        }

        return { displayValue: bestValue, displayUnit: bestUnit };
    }

    /**
     * Round number to specified significant figures
     */
    roundToPrecision(num, precision) {
        if (num === 0) return 0;
        const magnitude = Math.floor(Math.log10(Math.abs(num)));
        const scale = Math.pow(10, precision - magnitude - 1);
        return Math.round(num * scale) / scale;
    }

    /**
     * 파라미터 즉시 적용 (슬라이더/값 변경 시)
     */
    applyParamImmediately(paramName) {
        if (!this.currentComponent) return;

        const state = this.paramStates[paramName];
        if (!state) return;

        let baseValue;

        if (state.config.type === 'select') {
            baseValue = state.value;
        } else if (paramName === 'velocity' && this.currentComponent.type === 'TL') {
            // Special handling for velocity if we treated it as ratio
            // state.value is 0.66, we need to save 0.66 * 3e8
            baseValue = state.value * 3e8;
        } else {
            // Standard numeric conversion
            baseValue = state.value * (this.UNIT_MULTIPLIERS[state.unit] || 1);
        }

        // Update component parameter
        this.currentComponent.params[paramName] = baseValue;

        // Re-render component
        this.reRenderComponent();

        // Notify circuit change (triggers Run Mode auto-simulation)
        window.circuit?.notifyChange();
    }

    /**
     * Save current range config to component
     */
    saveRangeToComponent(paramName) {
        if (!this.currentComponent) return;
        const state = this.paramStates[paramName];

        if (!this.currentComponent.sliderRange) {
            this.currentComponent.sliderRange = {};
        }

        this.currentComponent.sliderRange[paramName] = {
            min: state.minValue,
            max: state.maxValue,
            minUnit: state.minUnit,
            maxUnit: state.maxUnit,
            isManual: state.isManual
        };
    }

    /**
     * 컴포넌트 다시 렌더링
     */
    reRenderComponent() {
        if (!this.currentComponent?.element) return;

        const parent = this.currentComponent.element.parentNode;
        if (parent) {
            const newElement = this.currentComponent.render();
            parent.replaceChild(newElement, this.currentComponent.element);
        }
    }

    /**
     * Cancel - 원래 값으로 복원하고 모달 닫기
     */
    cancel() {
        try {
            // 원래 값 복원
            if (this.currentComponent && this.originalParams) {
                Object.keys(this.originalParams).forEach(paramName => {
                    this.currentComponent.params[paramName] = this.originalParams[paramName];
                });

                // Re-render component with original values
                this.reRenderComponent();

                // Notify circuit change
                window.circuit?.notifyChange();
            }
        } catch (error) {
            console.error('Error in cancel:', error);
        }

        // 항상 모달 닫기
        this.close();
    }

    /**
     * Apply - 변경사항 확정하고 모달 닫기
     * (이미 실시간으로 적용되어 있으므로 그냥 닫기)
     */
    applyChanges() {
        // Handle Rename Logic
        const idInput = document.getElementById('componentIdInput');
        if (this.currentComponent && idInput) {
            const newId = idInput.value.trim();
            const oldId = this.currentComponent.id;

            if (newId !== oldId) {
                if (!newId) {
                    alert('ID cannot be empty.');
                    return; // Don't close modal
                }

                // Check for uniqueness provided by Circuit.renameComponent return value
                // Or check beforehand if desired, but renameComponent returns success boolean
                const success = window.circuit?.renameComponent(oldId, newId);

                if (!success) {
                    alert('Failed to rename component. ID might already exist or be invalid.');
                    return; // Don't close modal
                }
            }
        }

        // 원래 값 데이터 클리어 (복원 방지)
        this.originalParams = null;

        // 모달 닫기
        this.close();
    }
    /**
     * Auto update range based on current value
     * Min = 0
     * Max = Value * 2
     * Units synced to current value unit
     */
    autoUpdateRange(paramName) {
        const state = this.paramStates[paramName];
        if (!state) return;

        // Sync units
        state.minUnit = state.unit;
        state.maxUnit = state.unit;

        // Calculate Min/Max (0 to 200%)
        state.minValue = 0;

        // If value is 0, set max to 10 (to allow sliding), otherwise value * 2
        if (state.value === 0) {
            state.maxValue = 10;
        } else {
            state.maxValue = state.value * 2;
        }

        // Update UI
        this.updateRangeUI(paramName);

        // Update slider constraints
        this.updateSliderRange(paramName);
        this.saveRangeToComponent(paramName);
    }

    /**
     * Update Range Input UI elements from state
     */
    updateRangeUI(paramName) {
        const state = this.paramStates[paramName];
        const minInput = document.getElementById(`min_${paramName}`);
        const maxInput = document.getElementById(`max_${paramName}`);
        const minUnitSelect = document.getElementById(`minUnit_${paramName}`);
        const maxUnitSelect = document.getElementById(`maxUnit_${paramName}`);

        if (minInput) minInput.value = state.minValue;
        if (maxInput) maxInput.value = state.maxValue;
        if (minUnitSelect) minUnitSelect.value = state.minUnit;
        if (maxUnitSelect) maxUnitSelect.value = state.maxUnit;
    }
}

// Global instance
window.ComponentModal = ComponentModal;

