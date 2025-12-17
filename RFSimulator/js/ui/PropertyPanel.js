/**
 * Property Panel
 * Displays and edits selected component properties
 */
class PropertyPanel {
    constructor(circuit) {
        this.circuit = circuit;
        this.container = document.getElementById('propertiesContent');
        this.currentComponent = null;
        
        // Bind circuit selection callback
        this.circuit.onSelect = (selected) => this.onSelectionChange(selected);
        
        this.init();
    }

    /**
     * Initialize property panel
     */
    init() {
        this.showPlaceholder();
    }

    /**
     * Handle selection change
     */
    onSelectionChange(selectedIds) {
        if (selectedIds.length === 0) {
            this.currentComponent = null;
            this.showPlaceholder();
        } else if (selectedIds.length === 1) {
            const component = this.circuit.getComponent(selectedIds[0]);
            if (component) {
                this.currentComponent = component;
                this.showComponentProperties(component);
            } else {
                // Might be a wire
                const wire = this.circuit.getWire(selectedIds[0]);
                if (wire) {
                    this.showWireProperties(wire);
                }
            }
        } else {
            this.showMultipleSelection(selectedIds.length);
        }
    }

    /**
     * Show placeholder text
     */
    showPlaceholder() {
        this.container.innerHTML = `
            <p class="placeholder-text">Select a component to edit its properties</p>
        `;
    }

    /**
     * Show component properties
     */
    showComponentProperties(component) {
        let html = `
            <div class="component-header">
                <div class="color-indicator ${this.getColorClass(component.type)}"></div>
                <span class="component-type-name">${this.getTypeName(component.type)}</span>
                <span class="component-id">${component.id}</span>
            </div>
        `;

        // Component-specific parameters (먼저 표시)
        html += this.renderComponentParams(component);

        // Position info (나중에 표시)
        html += `
            <div class="property-group">
                <div class="property-group-title">Position</div>
                <div class="property-row">
                    <span class="property-label">X:</span>
                    <div class="property-input">
                        <input type="number" id="propX" value="${component.x}" step="20">
                    </div>
                </div>
                <div class="property-row">
                    <span class="property-label">Y:</span>
                    <div class="property-input">
                        <input type="number" id="propY" value="${component.y}" step="20">
                    </div>
                </div>
                <div class="property-row">
                    <span class="property-label">Rotation:</span>
                    <div class="property-input">
                        <select id="propRotation">
                            <option value="0" ${component.rotation === 0 ? 'selected' : ''}>0°</option>
                            <option value="90" ${component.rotation === 90 ? 'selected' : ''}>90°</option>
                            <option value="180" ${component.rotation === 180 ? 'selected' : ''}>180°</option>
                            <option value="270" ${component.rotation === 270 ? 'selected' : ''}>270°</option>
                        </select>
                    </div>
                </div>
            </div>
        `;

        // Actions
        html += `
            <div class="property-actions">
                <button class="btn secondary" id="btnRotate">Rotate</button>
                <button class="btn secondary" id="btnDeleteComp" style="color: var(--accent-danger)">Delete</button>
            </div>
        `;

        this.container.innerHTML = html;
        this.bindPropertyEvents(component);
    }

    /**
     * Render component-specific parameters
     */
    renderComponentParams(component) {
        let html = '<div class="property-group"><div class="property-group-title">Parameters</div>';

        switch (component.type) {
            case 'R':
                html += this.renderResistorParams(component);
                break;
            case 'L':
                html += this.renderInductorParams(component);
                break;
            case 'C':
                html += this.renderCapacitorParams(component);
                break;
            case 'TL':
                html += this.renderTransmissionLineParams(component);
                break;
            case 'PORT':
                html += this.renderPortParams(component);
                break;
            case 'GND':
                html += '<div class="property-row"><span class="property-label">No parameters</span></div>';
                break;
        }

        html += '</div>';
        return html;
    }

    /**
     * Render resistor parameters
     */
    renderResistorParams(component) {
        return `
            <div class="property-row">
                <span class="property-label">Resistance:</span>
                <div class="property-input value-with-unit">
                    <input type="number" id="paramResistance" 
                           value="${this.extractValue(component.params.resistance)}" 
                           step="any" min="0">
                    <select id="paramResistanceUnit">
                        ${this.renderUnitOptions('Ω', component.params.resistance)}
                    </select>
                </div>
            </div>
        `;
    }

    /**
     * Render inductor parameters
     */
    renderInductorParams(component) {
        return `
            <div class="property-row">
                <span class="property-label">Inductance:</span>
                <div class="property-input value-with-unit">
                    <input type="number" id="paramInductance" 
                           value="${this.extractValue(component.params.inductance)}" 
                           step="any" min="0">
                    <select id="paramInductanceUnit">
                        ${this.renderUnitOptions('H', component.params.inductance)}
                    </select>
                </div>
            </div>
        `;
    }

    /**
     * Render capacitor parameters
     */
    renderCapacitorParams(component) {
        return `
            <div class="property-row">
                <span class="property-label">Capacitance:</span>
                <div class="property-input value-with-unit">
                    <input type="number" id="paramCapacitance" 
                           value="${this.extractValue(component.params.capacitance)}" 
                           step="any" min="0">
                    <select id="paramCapacitanceUnit">
                        ${this.renderUnitOptions('F', component.params.capacitance)}
                    </select>
                </div>
            </div>
        `;
    }

    /**
     * Render transmission line parameters
     */
    renderTransmissionLineParams(component) {
        return `
            <div class="property-row">
                <span class="property-label">Z₀:</span>
                <div class="property-input value-with-unit">
                    <input type="number" id="paramZ0" value="${component.params.z0}" step="any" min="0">
                    <span style="color: var(--text-muted)">Ω</span>
                </div>
            </div>
            <div class="property-row">
                <span class="property-label">Length:</span>
                <div class="property-input value-with-unit">
                    <input type="number" id="paramLength" 
                           value="${this.extractValue(component.params.length)}" 
                           step="any" min="0">
                    <select id="paramLengthUnit">
                        ${this.renderLengthUnitOptions(component.params.length)}
                    </select>
                </div>
            </div>
            <div class="property-row">
                <span class="property-label">Velocity:</span>
                <div class="property-input value-with-unit">
                    <input type="number" id="paramVelocity" 
                           value="${(component.params.velocity / 3e8).toFixed(4)}" 
                           step="0.0001" min="0" max="1">
                    <span style="color: var(--text-muted)">× c</span>
                </div>
            </div>
        `;
    }

    /**
     * Render port parameters
     */
    renderPortParams(component) {
        return `
            <div class="property-row">
                <span class="property-label">Port #:</span>
                <div class="property-input">
                    <input type="number" id="paramPortNumber" 
                           value="${component.params.portNumber}" 
                           step="1" min="1">
                </div>
            </div>
            <div class="property-row">
                <span class="property-label">Impedance:</span>
                <div class="property-input value-with-unit">
                    <input type="number" id="paramImpedance" 
                           value="${component.params.impedance}" 
                           step="any" min="0">
                    <span style="color: var(--text-muted)">Ω</span>
                </div>
            </div>
        `;
    }

    /**
     * Render unit options for SI prefixes
     */
    renderUnitOptions(baseUnit, value) {
        const units = [
            { prefix: 'T', multiplier: 1e12 },
            { prefix: 'G', multiplier: 1e9 },
            { prefix: 'M', multiplier: 1e6 },
            { prefix: 'k', multiplier: 1e3 },
            { prefix: '', multiplier: 1 },
            { prefix: 'm', multiplier: 1e-3 },
            { prefix: 'μ', multiplier: 1e-6 },
            { prefix: 'n', multiplier: 1e-9 },
            { prefix: 'p', multiplier: 1e-12 },
            { prefix: 'f', multiplier: 1e-15 }
        ];

        const selectedUnit = this.getBestUnit(value, units);
        
        return units.map(u => 
            `<option value="${u.multiplier}" ${u.multiplier === selectedUnit ? 'selected' : ''}>
                ${u.prefix}${baseUnit}
            </option>`
        ).join('');
    }

    /**
     * Render length unit options
     */
    renderLengthUnitOptions(value) {
        const units = [
            { prefix: 'km', multiplier: 1e3 },
            { prefix: 'm', multiplier: 1 },
            { prefix: 'cm', multiplier: 1e-2 },
            { prefix: 'mm', multiplier: 1e-3 },
            { prefix: 'μm', multiplier: 1e-6 }
        ];

        const selectedUnit = this.getBestUnit(value, units);
        
        return units.map(u => 
            `<option value="${u.multiplier}" ${u.multiplier === selectedUnit ? 'selected' : ''}>
                ${u.prefix}
            </option>`
        ).join('');
    }

    /**
     * Get best unit for value display
     */
    getBestUnit(value, units) {
        const absValue = Math.abs(value);
        for (const unit of units) {
            if (absValue >= unit.multiplier) {
                return unit.multiplier;
            }
        }
        return units[units.length - 1].multiplier;
    }

    /**
     * Extract display value based on best unit
     */
    extractValue(value) {
        const absValue = Math.abs(value);
        const prefixes = [1e12, 1e9, 1e6, 1e3, 1, 1e-3, 1e-6, 1e-9, 1e-12, 1e-15];
        
        for (const mult of prefixes) {
            if (absValue >= mult) {
                return (value / mult).toFixed(4).replace(/\.?0+$/, '');
            }
        }
        return value.toExponential(2);
    }

    /**
     * Bind property input events
     */
    bindPropertyEvents(component) {
        // Position X
        const propX = document.getElementById('propX');
        if (propX) {
            propX.addEventListener('change', () => {
                component.moveTo(parseInt(propX.value), component.y);
                this.updateWires(component);
            });
        }

        // Position Y
        const propY = document.getElementById('propY');
        if (propY) {
            propY.addEventListener('change', () => {
                component.moveTo(component.x, parseInt(propY.value));
                this.updateWires(component);
            });
        }

        // Rotation
        const propRotation = document.getElementById('propRotation');
        if (propRotation) {
            propRotation.addEventListener('change', () => {
                component.rotation = parseInt(propRotation.value);
                component.updateElement();
                this.updateWires(component);
            });
        }

        // Component-specific params
        this.bindComponentParams(component);

        // Action buttons
        const btnRotate = document.getElementById('btnRotate');
        if (btnRotate) {
            btnRotate.addEventListener('click', () => {
                component.rotate();
                propRotation.value = component.rotation;
                this.updateWires(component);
            });
        }

        const btnDeleteComp = document.getElementById('btnDeleteComp');
        if (btnDeleteComp) {
            btnDeleteComp.addEventListener('click', () => {
                this.circuit.removeComponent(component.id);
                window.canvasManager.renderComponents();
            });
        }
    }

    /**
     * Bind component-specific parameter events
     */
    bindComponentParams(component) {
        switch (component.type) {
            case 'R':
                this.bindValueWithUnit('paramResistance', 'paramResistanceUnit', 
                    (val) => { component.params.resistance = val; });
                break;
            case 'L':
                this.bindValueWithUnit('paramInductance', 'paramInductanceUnit',
                    (val) => { component.params.inductance = val; });
                break;
            case 'C':
                this.bindValueWithUnit('paramCapacitance', 'paramCapacitanceUnit',
                    (val) => { component.params.capacitance = val; });
                break;
            case 'TL':
                const z0Input = document.getElementById('paramZ0');
                if (z0Input) {
                    z0Input.addEventListener('change', () => {
                        component.params.z0 = parseFloat(z0Input.value);
                        component.render();
                    });
                }
                this.bindValueWithUnit('paramLength', 'paramLengthUnit',
                    (val) => { component.params.length = val; });
                const velInput = document.getElementById('paramVelocity');
                if (velInput) {
                    velInput.addEventListener('change', () => {
                        component.params.velocity = parseFloat(velInput.value) * 3e8;
                    });
                }
                break;
            case 'PORT':
                const portNumInput = document.getElementById('paramPortNumber');
                if (portNumInput) {
                    portNumInput.addEventListener('change', () => {
                        component.params.portNumber = parseInt(portNumInput.value);
                        component.render();
                    });
                }
                const impInput = document.getElementById('paramImpedance');
                if (impInput) {
                    impInput.addEventListener('change', () => {
                        component.params.impedance = parseFloat(impInput.value);
                        component.render();
                    });
                }
                break;
        }
    }

    /**
     * Bind value input with unit selector
     */
    bindValueWithUnit(inputId, unitId, callback) {
        const input = document.getElementById(inputId);
        const unit = document.getElementById(unitId);
        
        if (input && unit) {
            const updateValue = () => {
                const value = parseFloat(input.value) * parseFloat(unit.value);
                callback(value);
                if (this.currentComponent) {
                    this.currentComponent.render();
                }
            };
            
            input.addEventListener('change', updateValue);
            unit.addEventListener('change', updateValue);
        }
    }

    /**
     * Update connected wires after component change
     */
    updateWires(component) {
        const wires = this.circuit.getWiresConnectedTo(component.id);
        wires.forEach(wire => {
            wire.updateFromComponents(this.circuit);
        });
    }

    /**
     * Show wire properties
     */
    showWireProperties(wire) {
        this.container.innerHTML = `
            <div class="component-header">
                <div class="color-indicator" style="background: var(--component-wire)"></div>
                <span class="component-type-name">Wire</span>
                <span class="component-id">${wire.id}</span>
            </div>
            <div class="property-group">
                <div class="property-group-title">Connections</div>
                <div class="property-row">
                    <span class="property-label">Start:</span>
                    <span class="property-readonly">${wire.startComponent || 'Free'}</span>
                </div>
                <div class="property-row">
                    <span class="property-label">End:</span>
                    <span class="property-readonly">${wire.endComponent || 'Free'}</span>
                </div>
            </div>
            <div class="property-actions">
                <button class="btn secondary" id="btnDeleteWire" style="color: var(--accent-danger)">Delete Wire</button>
            </div>
        `;

        const btnDeleteWire = document.getElementById('btnDeleteWire');
        if (btnDeleteWire) {
            btnDeleteWire.addEventListener('click', () => {
                this.circuit.removeWire(wire.id);
                window.canvasManager.renderComponents();
            });
        }
    }

    /**
     * Show multiple selection info
     */
    showMultipleSelection(count) {
        this.container.innerHTML = `
            <div class="component-header">
                <span class="component-type-name">${count} items selected</span>
            </div>
            <div class="property-actions">
                <button class="btn secondary" id="btnDeleteMultiple" style="color: var(--accent-danger)">Delete All</button>
            </div>
        `;

        const btnDeleteMultiple = document.getElementById('btnDeleteMultiple');
        if (btnDeleteMultiple) {
            btnDeleteMultiple.addEventListener('click', () => {
                this.circuit.deleteSelected();
                window.canvasManager.renderComponents();
            });
        }
    }

    /**
     * Get type display name
     */
    getTypeName(type) {
        const names = {
            'R': 'Resistor',
            'L': 'Inductor',
            'C': 'Capacitor',
            'GND': 'Ground',
            'TL': 'Transmission Line',
            'PORT': 'Port'
        };
        return names[type] || type;
    }

    /**
     * Get color class for component type
     */
    getColorClass(type) {
        const classes = {
            'R': 'resistor',
            'L': 'inductor',
            'C': 'capacitor',
            'GND': 'ground',
            'TL': 'tline',
            'PORT': 'port'
        };
        return classes[type] || '';
    }

    /**
     * Focus first input field
     */
    focusFirstInput() {
        const firstInput = this.container.querySelector('input');
        if (firstInput) {
            firstInput.focus();
            firstInput.select();
        }
    }
}

window.PropertyPanel = PropertyPanel;

