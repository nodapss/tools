
// Mock Window for ComplexMath compatibility
const window = {};

// --- Paste ComplexMath.js Content (or simplified version) ---
class Complex {
    constructor(real = 0, imag = 0) { this.real = real; this.imag = imag; }
    add(other) { return new Complex(this.real + other.real, this.imag + other.imag); }
    sub(other) { return new Complex(this.real - other.real, this.imag - other.imag); }
    mul(other) { return new Complex(this.real * other.real - this.imag * other.imag, this.real * other.imag + this.imag * other.real); }
    div(other) {
        const den = other.real * other.real + other.imag * other.imag;
        if (den === 0) return new Complex(Infinity, 0);
        return new Complex((this.real * other.real + this.imag * other.imag) / den, (this.imag * other.real - this.real * other.imag) / den);
    }
    inverse() {
        const magSq = this.real * this.real + this.imag * this.imag;
        if (magSq === 0) return new Complex(Infinity, 0);
        return new Complex(this.real / magSq, -this.imag / magSq);
    }
    scale(scalar) { return new Complex(this.real * scalar, this.imag * scalar); }
    magnitude() { return Math.sqrt(this.real * this.real + this.imag * this.imag); }
    clone() { return new Complex(this.real, this.imag); }
    toString() { return `${this.real.toFixed(4)} + ${this.imag.toFixed(4)}j`; }
    static fromReal(r) { return new Complex(r, 0); }
}

class ComplexMatrix {
    constructor(rows, cols) {
        this.rows = rows; this.cols = cols;
        this.data = [];
        for (let i = 0; i < rows; i++) {
            this.data[i] = [];
            for (let j = 0; j < cols; j++) this.data[i][j] = new Complex(0, 0);
        }
    }
    get(r, c) { return this.data[r][c]; }
    set(r, c, v) { this.data[r][c] = (v instanceof Complex) ? v : new Complex(v, 0); }
    add(other) {
        const res = new ComplexMatrix(this.rows, this.cols);
        for (let i = 0; i < this.rows; i++) for (let j = 0; j < this.cols; j++) res.set(i, j, this.get(i, j).add(other.get(i, j)));
        return res;
    }
    subtract(other) {
        const res = new ComplexMatrix(this.rows, this.cols);
        for (let i = 0; i < this.rows; i++) for (let j = 0; j < this.cols; j++) res.set(i, j, this.get(i, j).sub(other.get(i, j)));
        return res;
    }
    multiply(other) {
        const res = new ComplexMatrix(this.rows, other.cols);
        for (let i = 0; i < this.rows; i++) {
            for (let j = 0; j < other.cols; j++) {
                let sum = new Complex(0, 0);
                for (let k = 0; k < this.cols; k++) sum = sum.add(this.get(i, k).mul(other.get(k, j)));
                res.set(i, j, sum);
            }
        }
        return res;
    }
    scale(scalar) {
        const res = new ComplexMatrix(this.rows, this.cols);
        const s = (scalar instanceof Complex) ? scalar : new Complex(scalar, 0);
        for (let i = 0; i < this.rows; i++) for (let j = 0; j < this.cols; j++) res.set(i, j, this.get(i, j).mul(s));
        return res;
    }
    inverse() {
        // Simplified generic inverse for 2x2. For NxN need full Gauss-Jordan but defined here for 2x2 mainly.
        // Actually the code uses solve for Z extraction, and inverse for (Z+Z0)^-1. 
        // Let's implement full Gauss-Jordan from original file or simpler one?
        // Copying the full one is safer.
        if (this.rows !== this.cols) throw new Error("Square only");
        const n = this.rows;
        const aug = new ComplexMatrix(n, 2 * n);
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) aug.set(i, j, this.get(i, j).clone());
            aug.set(i, i + n, new Complex(1, 0));
        }
        for (let col = 0; col < n; col++) {
            let pivot = aug.get(col, col);
            // Simple pivot check (omit partial pivoting for brevity unless needed for stability)
            if (pivot.magnitude() < 1e-12) {
                // Try to swap
                for (let r = col + 1; r < n; r++) {
                    if (aug.get(r, col).magnitude() > 1e-12) {
                        // swap
                        for (let k = 0; k < 2 * n; k++) {
                            const tmp = aug.get(col, k);
                            aug.set(col, k, aug.get(r, k));
                            aug.set(r, k, tmp);
                        }
                        pivot = aug.get(col, col);
                        break;
                    }
                }
            }
            const pivInv = pivot.inverse();
            for (let j = col; j < 2 * n; j++) aug.set(col, j, aug.get(col, j).mul(pivInv));
            for (let row = 0; row < n; row++) {
                if (row !== col) {
                    const f = aug.get(row, col);
                    for (let j = col; j < 2 * n; j++) aug.set(row, j, aug.get(row, j).sub(f.mul(aug.get(col, j))));
                }
            }
        }
        const res = new ComplexMatrix(n, n);
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) res.set(i, j, aug.get(i, j + n));
        return res;
    }
    static identity(size) {
        const I = new ComplexMatrix(size, size);
        for (let i = 0; i < size; i++) I.set(i, i, new Complex(1, 0));
        return I;
    }
    static solve(A, b) {
        // A is Matrix, b is vector (Complex[])
        // Uses Ax=b => x = A^-1 * b
        const inv = A.inverse();
        if (!inv) return null;
        const x = [];
        for (let i = 0; i < A.rows; i++) {
            let sum = new Complex(0, 0);
            for (let k = 0; k < A.cols; k++) {
                sum = sum.add(inv.get(i, k).mul(b[k]));
            }
            x.push(sum);
        }
        return x;
    }
}

// --- Logic to Verify ---

function calculateSParameters_Standalone(Y, portNodes, groundNode, z0 = 50) {
    const matrixSize = Y.rows;
    const portCount = portNodes.length;

    // GMIN Injection
    const GMIN = new Complex(1e-12, 0);
    for (let k = 0; k < matrixSize; k++) {
        Y.set(k, k, Y.get(k, k).add(GMIN));
    }

    const Yp_reduced = new ComplexMatrix(portCount, portCount);

    // Z-Parameter Extraction Loop
    for (let j = 0; j < portCount; j++) {
        const pjIdx = portNodes[j]; // Assuming direct index mapping for this test

        const I_vec = [];
        for (let k = 0; k < matrixSize; k++) I_vec.push(new Complex(0, 0));
        I_vec[pjIdx] = new Complex(1, 0); // 1A Source

        try {
            const V_vec = ComplexMatrix.solve(Y, I_vec);

            for (let i = 0; i < portCount; i++) {
                const piIdx = portNodes[i];
                Yp_reduced.set(i, j, V_vec[piIdx]); // Z_ij = V_i
            }
        } catch (e) {
            console.error("Solver Error:", e);
            return null;
        }
    }

    const Zp = Yp_reduced;

    // Convert Z -> S
    // S = (Z - Z0*I) * (Z + Z0*I)^-1
    const I = ComplexMatrix.identity(portCount);
    const Z0_I = I.scale(new Complex(z0, 0));

    const Num = Zp.subtract(Z0_I);
    const Den = Zp.add(Z0_I);
    const DenInv = Den.inverse();

    if (!DenInv) return null;

    return Num.multiply(DenInv);
}

// --- Test Cases ---

function runTest(name, setupFn) {
    console.log(`\n--- Test: ${name} ---`);
    const { Y, portNodes } = setupFn();

    const S = calculateSParameters_Standalone(Y, portNodes, -1); // ground is implicit or ignored in simple matrix setup
    if (!S) {
        console.log("Result: FAILED (Solver/Math Error)");
        return;
    }

    // Print S-Matrix
    for (let i = 0; i < S.rows; i++) {
        let rowStr = "";
        for (let j = 0; j < S.cols; j++) {
            const val = S.get(i, j);
            const mag = val.magnitude();
            const db = 20 * Math.log10(mag + 1e-20);
            rowStr += `S${i + 1}${j + 1}: ${val.toString()} (|${mag.toFixed(4)}|, ${db.toFixed(2)} dB)\t`;
        }
        console.log(rowStr);
    }
}

// Case 1: Series Resistor 50 Ohm
// Node 0: Port 1
// Node 1: Port 2
// Connectivity: Port 1 -- R=50 -- Port 2
// Y-Matrix (2x2):
// [ 1/R   -1/R ]
// [ -1/R   1/R ]
// Plus GMIN handled in calc function.
runTest("Series Resistor 50 Ohm", () => {
    const Y = new ComplexMatrix(2, 2);
    const G = 1 / 50;
    Y.set(0, 0, G); Y.set(0, 1, -G);
    Y.set(1, 0, -G); Y.set(1, 1, G);
    // Ports are at node 0 and 1
    return { Y, portNodes: [0, 1] };
});

// Case 2: Thru (Zero Ohm)
// approximated by R=1e-6
runTest("Thru (Resistor 1e-6 Ohm)", () => {
    const Y = new ComplexMatrix(2, 2);
    const G = 1 / 1e-6;
    Y.set(0, 0, G); Y.set(0, 1, -G);
    Y.set(1, 0, -G); Y.set(1, 1, G);
    return { Y, portNodes: [0, 1] };
});

// Case 3: Isolation (Open)
// Port 1 connected to nothing (except maybe logic GMIN), Port 2 connected to nothing
// Y = Zeros
runTest("Isolation (Open)", () => {
    const Y = new ComplexMatrix(2, 2);
    // Empty Y
    return { Y, portNodes: [0, 1] };
});

// Case 4: Reverse Port Order (Series Resistor)
// Swapping port definition
runTest("Series Resistor 50 Ohm (Reversed Ports)", () => {
    const Y = new ComplexMatrix(2, 2);
    const G = 1 / 50;
    Y.set(0, 0, G); Y.set(0, 1, -G);
    Y.set(1, 0, -G); Y.set(1, 1, G);
    // Ports are at node 1 and 0 (Swap)
    return { Y, portNodes: [1, 0] };
});

