/**
 * Resistor Component
 * Z = R (pure real impedance)
 */
class Resistor extends Component {
    constructor(x, y, resistance = 50) {
        super('R', x, y);
        this.params = {
            resistance: resistance // Ohms
        };

        // Terminal positions aligned to grid (40 = 2 * GRID_SIZE)
        this.terminals = {
            start: { x: -40, y: 0 },
            end: { x: 40, y: 0 }
        };

        // Re-snap after setting terminals
        this.snapTerminalsToGrid();
    }

    /**
     * Render resistor body (zigzag pattern)
     */
    renderBody() {
        return `
            <g class="component-body">
                <!-- Lead lines to terminals -->
                <line x1="-40" y1="0" x2="-20" y2="0" stroke="currentColor" stroke-width="2"/>
                <line x1="20" y1="0" x2="40" y2="0" stroke="currentColor" stroke-width="2"/>
                <!-- Zigzag body -->
                <path d="M-20,0 L-16,-8 L-8,8 L0,-8 L8,8 L16,-8 L20,0" 
                      fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
            </g>
        `;
    }

    /**
     * Render resistance value
     */
    renderValue() {
        const valueStr = Component.formatValue(this.params.resistance, 'Ω');
        return `<text class="component-value" x="0" y="18" text-anchor="middle">${valueStr}</text>`;
    }

    /**
     * Calculate impedance (pure resistance)
     */
    getImpedance(frequency) {
        return {
            real: this.params.resistance,
            imag: 0
        };
    }

    /**
     * Create from JSON
     */
    static fromJSON(data) {
        const resistor = new Resistor(data.x, data.y, data.params.resistance);
        resistor.id = data.id;
        resistor.rotation = data.rotation;
        if (data.showImpedance !== undefined) resistor.showImpedance = data.showImpedance;
        resistor.connections = data.connections;
        if (data.sliderRange) {
            resistor.sliderRange = data.sliderRange;
        }
        return resistor;
    }
}

window.Resistor = Resistor;

