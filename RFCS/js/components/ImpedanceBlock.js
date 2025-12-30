/**
 * Impedance Block Component
 * Z = R + jX
 */
class ImpedanceBlock extends Component {
    constructor(x, y, resistance = 50, reactance = 0) {
        super('Z', x, y);
        this.params = {
            resistance: resistance, // Ohms (Real part)
            reactance: reactance    // Ohms (Imaginary part)
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
     * Render component body (Box with Z label)
     */
    renderBody() {
        return `
            <g class="component-body">
                <!-- Lead lines to terminals -->
                <line x1="-40" y1="0" x2="-20" y2="0" stroke="currentColor" stroke-width="2"/>
                <line x1="20" y1="0" x2="40" y2="0" stroke="currentColor" stroke-width="2"/>
                
                <!-- Box body -->
                <rect x="-20" y="-15" width="40" height="30" 
                      fill="var(--bg-color)" stroke="currentColor" stroke-width="2"/>
                
                <!-- Label -->
                <text x="0" y="5" text-anchor="middle" font-size="14" fill="currentColor" font-weight="bold">Z</text>
            </g>
        `;
    }

    /**
     * Render value
     */
    renderValue() {
        // Format as R + jX
        const r = Component.formatValue(this.params.resistance, '');
        const x = Component.formatValue(Math.abs(this.params.reactance), '');
        const sign = this.params.reactance >= 0 ? '+' : '-';

        let valueStr = `${r} ${sign} j${x} Ω`;

        // Simplify if one part is zero (optional, but keeping full format for clarity might be better for this specific block)
        // keeping full format for now as requested "Z block" implies explicit complex impedance

        return `<text class="component-value" x="0" y="28" text-anchor="middle" font-size="10">${valueStr}</text>`;
    }

    /**
     * Calculate impedance (Complex)
     */
    getImpedance(frequency) {
        return {
            real: this.params.resistance,
            imag: this.params.reactance
        };
    }

    /**
     * Create from JSON
     */
    static fromJSON(data) {
        const block = new ImpedanceBlock(data.x, data.y, data.params.resistance, data.params.reactance);
        block.id = data.id;
        block.rotation = data.rotation;
        block.connections = data.connections;
        return block;
    }
}

window.ImpedanceBlock = ImpedanceBlock;
