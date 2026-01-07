/**
 * Transmission Line Component
 * Uses ABCD matrix for S-parameter calculation
 */
class TransmissionLine extends Component {
    constructor(x, y, z0 = 50, length = 0.1, velocity = 3e8) {
        super('TL', x, y);
        this.params = {
            modelType: 'standard', // 'standard' or 'rlgc'

            // Standard Params
            z0: z0,              // Characteristic impedance (Ohms)
            length: length,      // Physical length (meters)
            velocity: velocity,  // Phase velocity (m/s)
            loss: 0,             // Attenuation (dB/m)

            // RLGC Params (per meter)
            r: 0,                // Resistance (Ohms/m)
            l: 250e-9,           // Inductance (H/m) - approx for 50ohm
            g: 0,                // Conductance (S/m)
            c: 100e-12           // Capacitance (F/m) - approx for 50ohm
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
        const lenStr = Component.formatValue(this.params.length, 'm');

        if (this.params.modelType === 'rlgc') {
            return `
                <text class="component-value" x="0" y="22" text-anchor="middle">RLGC, ${lenStr}</text>
            `;
        } else {
            const z0Str = `${this.params.z0}Ω`;
            const lossStr = this.params.loss > 0 ? `, ${this.params.loss}dB/m` : '';
            return `
                <text class="component-value" x="0" y="22" text-anchor="middle">${z0Str}, ${lenStr}${lossStr}</text>
            `;
        }
    }

    /**
     * Complex Hyperbolic Functions Helper
     * cosh(x + jy) = cosh(x)cos(y) + j sinh(x)sin(y)
     * sinh(x + jy) = sinh(x)cos(y) + j cosh(x)sin(y)
     */
    static complexCosh(alpha, beta) {
        return {
            real: Math.cosh(alpha) * Math.cos(beta),
            imag: Math.sinh(alpha) * Math.sin(beta)
        };
    }

    static complexSinh(alpha, beta) {
        return {
            real: Math.sinh(alpha) * Math.cos(beta),
            imag: Math.cosh(alpha) * Math.sin(beta)
        };
    }

    /**
     * Get ABCD matrix for transmission line
     * Supports both Standard (Lossy) and RLGC models
     */
    getABCDMatrix(frequency) {
        const w = 2 * Math.PI * frequency;
        const len = this.params.length;

        let alpha, beta; // Propagation constant components: gamma = alpha + j*beta
        let Zc; // Characteristic Impedance (Complex)

        if (this.params.modelType === 'rlgc') {
            // RLGC Model
            const R = this.params.r;
            const L = this.params.l;
            const G = this.params.g;
            const C = this.params.c;

            // Z = R + jwL
            const Z_series = new Complex(R, w * L);
            // Y = G + jwC
            const Y_shunt = new Complex(G, w * C);

            // Gamma = sqrt(Z * Y)
            const gammaSq = Z_series.mul(Y_shunt);
            // Sqrt of complex number (a+bi)
            // r = sqrt(a^2+b^2), phi = atan2(b,a)
            // sqrt = sqrt(r) * (cos(phi/2) + j sin(phi/2))
            const gammaMag = Math.sqrt(gammaSq.magnitude());
            const gammaPhase = gammaSq.phase() / 2;

            alpha = gammaMag * Math.cos(gammaPhase);
            beta = gammaMag * Math.sin(gammaPhase);

            // Zc = sqrt(Z / Y)
            const zcSq = Z_series.div(Y_shunt);
            const zcMag = Math.sqrt(zcSq.magnitude());
            const zcPhase = zcSq.phase() / 2;
            Zc = new Complex(zcMag * Math.cos(zcPhase), zcMag * Math.sin(zcPhase));

        } else {
            // Standard Model
            // alpha (Np/m) = Loss(dB/m) * ln(10)/20
            alpha = (this.params.loss * Math.LN10) / 20;
            // beta (rad/m) = w / v
            beta = w / this.params.velocity;

            // Zc is real Z0
            Zc = new Complex(this.params.z0, 0);
        }

        // Apply length
        const al = alpha * len;
        const bl = beta * len;

        // Calculate hyperbolic terms
        const ch = TransmissionLine.complexCosh(al, bl);
        const sh = TransmissionLine.complexSinh(al, bl);

        const coshGammaL = new Complex(ch.real, ch.imag);
        const sinhGammaL = new Complex(sh.real, sh.imag);

        // A = cosh(gamma*l)
        // B = Zc * sinh(gamma*l)
        // C = (1/Zc) * sinh(gamma*l)
        // D = A

        const A = coshGammaL;
        const B = Zc.mul(sinhGammaL);
        const C = sinhGammaL.div(Zc);
        const D = coshGammaL;

        return { A, B, C, D };
    }

    /**
     * For basic impedance query
     * Returns Z0 (Standard) or approx sqrt(L/C) (RLGC)
     */
    getImpedance(frequency) {
        if (this.params.modelType === 'rlgc') {
            // Return Zc at frequency
            const w = 2 * Math.PI * frequency;
            const Z = new Complex(this.params.r, w * this.params.l);
            const Y = new Complex(this.params.g, w * this.params.c);
            const Zc2 = Z.div(Y);
            const mag = Math.sqrt(Zc2.magnitude());
            const ang = Zc2.phase() / 2;
            return new Complex(mag * Math.cos(ang), mag * Math.sin(ang));
        }
        return new Complex(this.params.z0, 0);
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
     * Custom hitbox for TransmissionLine
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

        // Restore extended params
        if (data.params.loss !== undefined) tline.params.loss = data.params.loss;
        if (data.params.modelType) tline.params.modelType = data.params.modelType;
        if (data.params.r !== undefined) tline.params.r = data.params.r;
        if (data.params.l !== undefined) tline.params.l = data.params.l;
        if (data.params.g !== undefined) tline.params.g = data.params.g;
        if (data.params.c !== undefined) tline.params.c = data.params.c;

        if (data.sliderRange) {
            tline.sliderRange = data.sliderRange;
        }
        return tline;
    }
}

window.TransmissionLine = TransmissionLine;

