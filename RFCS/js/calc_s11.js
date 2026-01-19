// Minimal mock for Component class
class Component {
    constructor(type, x, y) {
        this.type = type;
        this.x = x;
        this.y = y;
        this.params = {};
        this.terminals = { start: { x: 0, y: 0 }, end: { x: 0, y: 0 } };
    }
    snapTerminalsToGrid() { }
    static formatValue(val) { return val; }
}
// Export for TransmissionLine to extend
global.Component = Component;

// --- ComplexMath.js Content ---
class Complex {
    constructor(real = 0, imag = 0) {
        this.real = real;
        this.imag = imag;
    }
    add(other) { return new Complex(this.real + other.real, this.imag + other.imag); }
    sub(other) { return new Complex(this.real - other.real, this.imag - other.imag); }
    mul(other) {
        return new Complex(
            this.real * other.real - this.imag * other.imag,
            this.real * other.imag + this.imag * other.real
        );
    }
    div(other) {
        const denominator = other.real * other.real + other.imag * other.imag;
        if (denominator === 0) return new Complex(Infinity, 0);
        return new Complex(
            (this.real * other.real + this.imag * other.imag) / denominator,
            (this.imag * other.real - this.real * other.imag) / denominator
        );
    }
    magnitude() { return Math.sqrt(this.real * this.real + this.imag * this.imag); }
    phase() { return Math.atan2(this.imag, this.real); }
    inverse() {
        const magSq = this.real * this.real + this.imag * this.imag;
        if (magSq === 0) return new Complex(Infinity, 0);
        return new Complex(this.real / magSq, -this.imag / magSq);
    }
    toString() { return `${this.real.toFixed(4)}${this.imag >= 0 ? '+' : ''}${this.imag.toFixed(4)}j`; }
}

// --- TransmissionLine Logic (Extracted from file) ---
class TransmissionLine extends Component {
    constructor(x, y, z0 = 50, length = 0.1, velocity = 3e8) {
        super('TL', x, y);
        this.params = {
            modelType: 'standard',
            z0: z0,
            z0_imag: 0,
            length: length,
            velocity: velocity,
            loss: 0
        };
    }

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

    getImpedance(frequency) {
        // This is characteristic impedance, not input
        return new Complex(this.params.z0, this.params.z0_imag || 0);
    }

    // Custom method for input impedance of Shorted Line
    // Zin = Zc * tanh(gamma * l)
    // Tanh(z) = sinh(z) / cosh(z)
    getInputImpedanceShorted(frequency) {
        const w = 2 * Math.PI * frequency;
        const len = this.params.length;

        // Standard Model
        const alpha = (this.params.loss * Math.LN10) / 20;
        const beta = w / this.params.velocity;

        const Zc = new Complex(this.params.z0, this.params.z0_imag || 0);

        const al = alpha * len;
        const bl = beta * len;

        const sh = TransmissionLine.complexSinh(al, bl);
        const ch = TransmissionLine.complexSinh(al, bl); // WAIT typo in original logic? No, static helper.
        // wait, helper ch need cosh logic
        const ch_real = Math.cosh(al) * Math.cos(bl);
        const ch_imag = Math.sinh(al) * Math.sin(bl);

        // Tanh = sinh/cosh
        const sinh = new Complex(sh.real, sh.imag);
        const cosh = new Complex(ch_real, ch_imag);
        const tanh = sinh.div(cosh);

        return Zc.mul(tanh);
    }
}

// --- Simulation Script ---

// 1. Setup Components
// TL1: 50+j50, 0.1m, Shorted
const tl1 = new TransmissionLine(0, 0, 50, 0.1);
tl1.params.z0_imag = 50;
tl1.params.velocity = 3e8;

// TL2: 50-j20, 0.1m, Shorted
const tl2 = new TransmissionLine(0, 0, 50, 0.1);
tl2.params.z0_imag = -20;
tl2.params.velocity = 3e8;

console.log("Freq (MHz) | S11 Log Mag (dB)");
console.log("-----------|----------------");

// 2. Frequency Sweep
const startFreq = 100e6; // 100 MHz
const stopFreq = 1000e6; // 1000 MHz
const steps = 10;
const stepSize = (stopFreq - startFreq) / (steps - 1);

for (let i = 0; i < steps; i++) {
    const f = startFreq + i * stepSize;

    // Calculate Zin for each shorted TL
    const zin1 = tl1.getInputImpedanceShorted(f);
    const zin2 = tl2.getInputImpedanceShorted(f);

    // Parallel Connection: 1/Ztotal = 1/Zin1 + 1/Zin2
    // Ztotal = Zin1 * Zin2 / (Zin1 + Zin2)
    const num = zin1.mul(zin2);
    const den = zin1.add(zin2);
    const zTotal = num.div(den);

    // Calculate S11 (Port Z0 = 50 Ohm)
    // Gamma = (Ztotal - 50) / (Ztotal + 50)
    const z0 = new Complex(50, 0);
    const gammaTop = zTotal.sub(z0);
    const gammaBot = zTotal.add(z0);
    const gamma = gammaTop.div(gammaBot);

    // Log Mag
    const mag = gamma.magnitude();
    const db = 20 * Math.log10(mag);

    console.log(`${(f / 1e6).toFixed(0).padStart(4)}       | ${db.toFixed(4)}`);
}
