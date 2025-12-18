/**
 * Transmission Line Component
 * Uses ABCD matrix for S-parameter calculation
 */
class TransmissionLine extends Component {
    constructor(x, y, z0 = 50, length = 0.1, velocity = 3e8) {
        super('TL', x, y);
        this.params = {
            z0: z0,              // Characteristic impedance (Ohms)
            length: length,       // Physical length (meters)
            velocity: velocity    // Phase velocity (m/s), default is speed of light
        };

        // Wider component for transmission line - aligned to grid
        this.terminals = {
            start: { x: -40, y: 0 },
            end: { x: 40, y: 0 }
        };

        // Re-snap after setting terminals
        this.snapTerminalsToGrid();
    }

    /**
     * Render transmission line body (two parallel lines)
     */
    renderBody() {
        return `
            <g class="component-body">
                <!-- Top conductor -->
                <line x1="-40" y1="-5" x2="40" y2="-5" stroke="currentColor" stroke-width="2"/>
                <!-- Bottom conductor -->
                <line x1="-40" y1="5" x2="40" y2="5" stroke="currentColor" stroke-width="2"/>
                <!-- End caps -->
                <line x1="-40" y1="-5" x2="-40" y2="5" stroke="currentColor" stroke-width="1" stroke-dasharray="2,2"/>
                <line x1="40" y1="-5" x2="40" y2="5" stroke="currentColor" stroke-width="1" stroke-dasharray="2,2"/>
                <!-- Z0 indicator -->
                <text x="0" y="3" text-anchor="middle" font-size="9" fill="currentColor" font-family="var(--font-mono)">Z₀</text>
            </g>
        `;
    }

    /**
     * Render transmission line values
     */
    renderValue() {
        const z0Str = `${this.params.z0}Ω`;
        const lengthStr = Component.formatValue(this.params.length, 'm');
        return `
            <text class="component-value" x="0" y="22" text-anchor="middle">${z0Str}, ${lengthStr}</text>
        `;
    }

    /**
     * Calculate electrical length (β * l)
     * β = ω/v = 2πf/v
     */
    getElectricalLength(frequency) {
        const beta = (2 * Math.PI * frequency) / this.params.velocity;
        return beta * this.params.length;
    }

    /**
     * Get ABCD matrix for transmission line
     * [A B]   [cos(βl)      jZ0*sin(βl)]
     * [C D] = [j/Z0*sin(βl) cos(βl)    ]
     */
    getABCDMatrix(frequency) {
        const theta = this.getElectricalLength(frequency);
        const z0 = this.params.z0;

        const cosTheta = Math.cos(theta);
        const sinTheta = Math.sin(theta);

        return {
            A: { real: cosTheta, imag: 0 },
            B: { real: 0, imag: z0 * sinTheta },
            C: { real: 0, imag: sinTheta / z0 },
            D: { real: cosTheta, imag: 0 }
        };
    }

    /**
     * Calculate input impedance when terminated with ZL
     * Zin = Z0 * (ZL + jZ0*tan(βl)) / (Z0 + jZL*tan(βl))
     */
    getInputImpedance(frequency, zLoad) {
        const theta = this.getElectricalLength(frequency);
        const z0 = this.params.z0;
        const tanTheta = Math.tan(theta);

        // Complex arithmetic
        // Zin = Z0 * (ZL + jZ0*tan(θ)) / (Z0 + jZL*tan(θ))

        const numReal = zLoad.real;
        const numImag = zLoad.imag + z0 * tanTheta;

        const denReal = z0 - zLoad.imag * tanTheta;
        const denImag = zLoad.real * tanTheta;

        const denMagSq = denReal * denReal + denImag * denImag;

        if (denMagSq === 0) {
            return { real: Infinity, imag: 0 };
        }

        return {
            real: z0 * (numReal * denReal + numImag * denImag) / denMagSq,
            imag: z0 * (numImag * denReal - numReal * denImag) / denMagSq
        };
    }

    /**
     * For basic impedance query, return characteristic impedance
     */
    getImpedance(frequency) {
        return { real: this.params.z0, imag: 0 };
    }

    /**
     * Check bounds (wider than normal components)
     */
    containsPoint(x, y) {
        const dx = x - this.x;
        const dy = y - this.y;
        return Math.abs(dx) <= 45 && Math.abs(dy) <= 15;
    }

    /**
     * Custom hitbox for TransmissionLine (약간 더 넓음)
     */
    renderHitbox() {
        return `<rect class="hitbox" 
                      x="-45" y="-15" 
                      width="90" height="30"
                      fill="transparent" 
                      style="pointer-events: all;"/>`;
    }

    /**
     * Create from JSON
     */
    static fromJSON(data) {
        const tline = new TransmissionLine(
            data.x, data.y,
            data.params.z0,
            data.params.length,
            data.params.velocity
        );
        tline.id = data.id;
        tline.rotation = data.rotation;
        tline.connections = data.connections;
        if (data.sliderRange) {
            tline.sliderRange = data.sliderRange;
        }
        return tline;
    }
}

window.TransmissionLine = TransmissionLine;

