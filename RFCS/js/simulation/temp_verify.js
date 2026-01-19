
// Trace Logic Verification
class Component {
    constructor(type, id, params) {
        this.type = type;
        this.id = id;
        this.params = params || {};
    }
}

// Mock Complex / Matrix classes (Minimal)
class Complex {
    constructor(r, i) { this.real = r; this.imag = i; }
    add(o) { return new Complex(this.real + o.real, this.imag + o.imag); }
    sub(o) { return new Complex(this.real - o.real, this.imag - o.imag); }
    multiply(o) { return new Complex(this.real * o.real - this.imag * o.imag, this.real * o.imag + this.imag * o.real); }
    div(o) {
        const d = o.real * o.real + o.imag * o.imag;
        return new Complex((this.real * o.real + this.imag * o.imag) / d, (this.imag * o.real - this.real * o.imag) / d);
    }
    inverse() { return new Complex(1, 0).div(this); }
    magnitude() { return Math.sqrt(this.real ** 2 + this.imag ** 2); }
}

const console = {
    log: (...args) => print(args.join(' ')),
    warn: (...args) => print("WARN: " + args.join(' '))
};

function print(msg) {
    // Standard output shim
    if (typeof process !== 'undefined') process.stdout.write(msg + '\n');
}

// Emulate extraction logic
function testLogic() {
    const port1 = new Component('PORT', 'p1', { impedance: 100, portNumber: 1 });
    const port2 = new Component('PORT', 'p2', { impedance: 50, portNumber: 2 }); // Not used, assume 1-port test
    const portComponents = [port1];
    const portCount = 1;
    const z0 = 50; // Global fallback

    print("--- Test 1: Port Impedance Reading ---");
    // Logic from NetworkAnalyzer
    for (let i = 0; i < portCount; i++) {
        const portComp = portComponents[i];
        const rawImp = portComp && portComp.params ? portComp.params.impedance : undefined;
        const portZ0 = (rawImp !== undefined && rawImp !== null)
            ? parseFloat(rawImp)
            : (z0 || 50);

        print(`Port ${i + 1} Impedance: Raw=${rawImp}, Used=${portZ0}, GlobalZ0=${z0}`);

        if (portZ0 === 100) {
            print("PASS: Port Z0 correctly identified as 100.");
        } else {
            print("FAIL: Port Z0 should be 100.");
        }
    }

    print("\n--- Test 2: S11 Calculation (Logic Check) ---");
    // Assume Zp (Input Impedance calculated) is 100 Ohm (Resistor)
    const Zp = new Complex(100, 0);

    // Case A: Port Z0 = 100 (Correct)
    // Zref = 100
    // S = (100 - 100) / (100 + 100) = 0.
    // Mag = 0 -> -Inf dB.
    {
        const Zref = new Complex(100, 0);
        const Num = Zp.sub(Zref);
        const Den = Zp.add(Zref);
        const S = Num.div(Den);
        print(`Case A (Port=100, Load=100): S=${S.real},${S.imag} Mag=${S.magnitude()}`);
    }

    // Case B: Port Z0 = 50 (Bug Ref)
    // Zref = 50
    // S = (100 - 50) / (100 + 50) = 50/150 = 0.333.
    // Mag = 0.333 -> -9.54 dB.
    {
        const Zref = new Complex(50, 0);
        const Num = Zp.sub(Zref);
        const Den = Zp.add(Zref);
        const S = Num.div(Den);
        print(`Case B (Port=50, Load=100): S=${S.real.toFixed(3)},${S.imag} Mag=${S.magnitude().toFixed(3)}`);
    }

    // Case C: Explaining +212dB
    // +212dB means S approx 1e10.
    // S = Num / Den. Den must be approx 0.
    // Den = Zp + Zref.
    // If Zp = 100, Zref must be approx -100? No.
    // Or numerical error?
    // What if Zp came out huge?
    // If Zp = 1e12 (Open).
    // S = (1e12 - 50)/(1e12 + 50) = 1.
    // S = (1e12 - 100)/(1e12 + 100) = 1.
    // Still 0 dB.

    // What if Zp is small?
    // Zp = 0.001. S = (0 - 50)/(0 + 50) = -1. Mag = 1. 0 dB.

    // Is it possible the Matrix invert failed in the main code?
    // DenInv = null. -> returns Default S Params (Open).
    // Default S Params: Sii = 1. 0 dB.

    print("\n--- Mystery Investigation ---");
    print("Cannot reproduce +212dB with standard Z values. Must be calculation artifact.");
}

testLogic();
