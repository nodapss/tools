/**
 * Inductor Component
 * Z = jωL (pure imaginary positive impedance)
 */
class Inductor extends Component {
    constructor(x, y, inductance = 10e-6) {
        super('L', x, y);
        this.params = {
            inductance: inductance // Henries
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
     * Render inductor body (coil pattern)
     */
    renderBody() {
        return `
            <g class="component-body">
                <!-- Lead lines to terminals -->
                <line x1="-40" y1="0" x2="-22" y2="0" stroke="currentColor" stroke-width="2"/>
                <line x1="22" y1="0" x2="40" y2="0" stroke="currentColor" stroke-width="2"/>
                <!-- Coil arcs -->
                <path d="M-22,0 Q-16,-10 -11,0 Q-5,-10 0,0 Q5,-10 11,0 Q16,-10 22,0" 
                      fill="none" stroke="currentColor" stroke-width="2"/>
            </g>
        `;
    }

    /**
     * Render inductance value
     */
    renderValue() {
        const valueStr = Component.formatValue(this.params.inductance, 'H');
        return `<text class="component-value" x="0" y="18" text-anchor="middle">${valueStr}</text>`;
    }

    /**
     * Calculate impedance: Z = jωL
     * ω = 2πf
     */
    getImpedance(frequency) {
        const omega = 2 * Math.PI * frequency;
        return {
            real: 0,
            imag: omega * this.params.inductance
        };
    }

    /**
     * Create from JSON
     */
    static fromJSON(data) {
        const inductor = new Inductor(data.x, data.y, data.params.inductance);
        inductor.id = data.id;
        inductor.rotation = data.rotation;
        inductor.connections = data.connections;
        if (data.sliderRange) {
            inductor.sliderRange = data.sliderRange;
        }
        return inductor;
    }
}

window.Inductor = Inductor;

