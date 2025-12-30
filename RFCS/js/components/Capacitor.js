/**
 * Capacitor Component
 * Z = 1/(jωC) = -j/(ωC) (pure imaginary negative impedance)
 */
class Capacitor extends Component {
    constructor(x, y, capacitance = 10e-12) {
        super('C', x, y);
        this.params = {
            capacitance: capacitance // Farads
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
     * Render capacitor body (parallel plates)
     */
    renderBody() {
        return `
            <g class="component-body">
                <!-- Lead lines to terminals -->
                <g class="plate-start">
                    <line x1="-40" y1="0" x2="-5" y2="0" stroke="currentColor" stroke-width="2"/>
                    <line x1="-5" y1="-10" x2="-5" y2="10" stroke="currentColor" stroke-width="2"/>
                </g>
                <g class="plate-end">
                    <line x1="5" y1="0" x2="40" y2="0" stroke="currentColor" stroke-width="2"/>
                    <line x1="5" y1="-10" x2="5" y2="10" stroke="currentColor" stroke-width="2"/>
                </g>
            </g>
        `;
    }

    /**
     * Render capacitance value
     */
    renderValue() {
        const valueStr = Component.formatValue(this.params.capacitance, 'F');
        return `<text class="component-value" x="0" y="18" text-anchor="middle">${valueStr}</text>`;
    }



    /**
     * Calculate impedance: Z = 1/(jωC) = -j/(ωC)
     * ω = 2πf
     */
    getImpedance(frequency) {
        const omega = 2 * Math.PI * frequency;
        if (omega * this.params.capacitance === 0) {
            return { real: Infinity, imag: 0 };
        }
        return {
            real: 0,
            imag: -1 / (omega * this.params.capacitance)
        };
    }

    /**
     * Create from JSON
     */
    static fromJSON(data) {
        const capacitor = new Capacitor(data.x, data.y, data.params.capacitance);
        capacitor.id = data.id;
        capacitor.rotation = data.rotation;
        if (data.showImpedance !== undefined) capacitor.showImpedance = data.showImpedance;
        capacitor.connections = data.connections;
        if (data.sliderRange) {
            capacitor.sliderRange = data.sliderRange;
        }
        return capacitor;
    }
}

window.Capacitor = Capacitor;

