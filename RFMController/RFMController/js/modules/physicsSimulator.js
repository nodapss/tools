/**
 * PhysicsSimulator - Physics-based simulation for Mock Serial Engine
 * Implements MatchingAlgorithm.hpp calculations in JavaScript
 * 
 * Impedance flow: Plasma (Rp=9, Xp=10) → ZE → ZD → ZC → ZB(VVC0) → ZA → Zm(Input)
 */
(function () {
    'use strict';

    // ========================================
    // Circuit Constants (from MatchingAlgorithm.hpp)
    // ========================================

    const CONST = {
        // Unit conversion
        nH: 1.0e-9,
        pF: 1.0e-12,
        uH: 1.0e-6,

        // Operating frequency: 13.56 MHz
        FREQ: 13.56e6,
        PI: Math.PI,
        get OMEGA() { return 2.0 * this.PI * this.FREQ; },

        // Input stage (M → A)
        Lp: 36.0e-9,      // 36 nH
        Cp: 15.3e-12,     // 15.3 pF

        // B circuit (VVC0 branch)
        LB0: 157.0e-9,    // 157 nH
        RB0: 0.2,         // 0.2 Ω
        CB0: 1.9e-12,     // 1.9 pF

        // C circuit (intermediate)
        RC0: 0.2,         // 0.2 Ω
        LC0: 1.03e-6,     // 1.03 μH
        CC0: 2.0e-12,     // 2.0 pF
        CC1: 1.5e-12,     // 1.5 pF

        // D circuit (VVC1 branch)
        CD0: 31.0e-12,    // 31 pF

        // E circuit (output stage before plasma)
        RE0: 0.2,         // 0.2 Ω
        LE0: 15.0e-9,     // 15 nH

        // Target impedance
        Z0: 50.0          // 50 Ω
    };

    // Precompute omega
    const w = CONST.OMEGA;
    const w2 = w * w;

    // ========================================
    // Motor Physics Constants
    // ========================================

    // 60000 steps = 10 turns VVC → 1 turn = 6000 steps
    // RPM 100 = 100 turns/min = 1.667 turns/sec
    // 1.667 × 6000 = 10,000 steps/sec
    const MOTOR_STEPS_PER_SEC = 10000;
    const SIMULATION_RATE_MS = 20;  // 20ms update rate (50Hz)

    // Plasma impedance (fixed for simulation)
    const PLASMA_R = 9.0;   // Rp = 9 Ω
    const PLASMA_X = 10.0;  // Xp = 10 Ω

    // Noise level
    const NOISE_PERCENT = 0.1;  // 0.1% noise

    // Simulation state
    let simulationInterval = null;
    let motorStreamInterval = null;

    // ========================================
    // Utility Functions
    // ========================================

    /**
     * Get mock device instance
     */
    function getDevice() {
        return RF.mock.device;
    }

    /**
     * Add realistic measurement noise
     * @param {number} value - Base value
     * @param {number} noisePercent - Noise as percentage (default 0.1%)
     */
    function addNoise(value, noisePercent = NOISE_PERCENT) {
        if (Math.abs(value) < 1e-10) return value;
        const noise = value * (noisePercent / 100) * (Math.random() - 0.5) * 2;
        return value + noise;
    }

    /**
     * Format float for response
     */
    function formatFloat(value, decimals = 2) {
        return value.toFixed(decimals);
    }

    /**
     * Generate response and send to protocol
     */
    function sendResponse(response) {
        if (typeof RF.modules.processIncomingData === 'function') {
            RF.modules.processIncomingData(response);
        }
    }

    // ========================================
    // Complex Number Operations
    // ========================================

    /**
     * Complex number multiplication: (a + jb) * (c + jd)
     */
    function complexMul(aR, aX, bR, bX) {
        return {
            R: aR * bR - aX * bX,
            X: aR * bX + aX * bR
        };
    }

    /**
     * Complex number division: (a + jb) / (c + jd)
     */
    function complexDiv(aR, aX, bR, bX) {
        const denom = bR * bR + bX * bX;
        if (denom < 1e-20) return { R: 0, X: 0 };
        return {
            R: (aR * bR + aX * bX) / denom,
            X: (aX * bR - aR * bX) / denom
        };
    }

    /**
     * Parallel impedance: Z1 || Z2 = (Z1 * Z2) / (Z1 + Z2)
     */
    function parallelZ(z1R, z1X, z2R, z2X) {
        // Numerator: Z1 * Z2
        const num = complexMul(z1R, z1X, z2R, z2X);
        // Denominator: Z1 + Z2
        const denR = z1R + z2R;
        const denX = z1X + z2X;
        return complexDiv(num.R, num.X, denR, denX);
    }

    // ========================================
    // Impedance Calculations (Reverse: Plasma → Input)
    // Based on MatchingAlgorithm.hpp
    // ========================================

    /**
     * Get capacitance in Farads from motor
     */
    function getCapacitanceFarads(motor) {
        const capPf100 = motor.getCapacitance();  // pF × 100
        const capPf = capPf100 / 100;             // pF
        return capPf * 1e-12;                      // Farads
    }

    /**
     * Calculate ZE from Plasma impedance
     * ZE = Zplasma + (RE0 + j*w*LE0)
     */
    function calculateZE(Rp, Xp) {
        const RE = Rp + CONST.RE0;
        const XE = Xp + w * CONST.LE0;
        return { R: RE, X: XE };
    }

    /**
     * Calculate ZD from ZE (reverse of E circuit)
     * ZD = (ZE || 1/(j*w*CD0)) + 1/(j*w*VVC1)
     * 
     * But we need reverse: given ZE, VVC1, find ZD
     * Actually the circuit is: ZD → parallel(ZD, CD0) → series VVC1 → ZE
     * So: ZE = ((ZD || CD0) in series with VVC1)
     * 
     * Simplified approach: Calculate forward from ZD
     * For reverse, we iterate or use exact inverse formula
     */
    function calculateZDFromZE(ZE_R, ZE_X, VVC1_pF) {
        const VVC1 = VVC1_pF * CONST.pF;

        // ZE = (ZD || CD0) + 1/(j*w*VVC1)
        // Let ZD_CD0 = ZD || 1/(j*w*CD0)
        // ZE = ZD_CD0 + 1/(j*w*VVC1)
        // ZD_CD0 = ZE - 1/(j*w*VVC1)

        const XVVC1 = -1.0 / (w * VVC1);  // 1/(j*w*VVC1) = -j/(w*VVC1)

        // ZD_CD0 = ZE - j*XVVC1
        const ZD_CD0_R = ZE_R;
        const ZD_CD0_X = ZE_X - XVVC1;  // Subtract the series capacitor reactance

        // Now: ZD_CD0 = ZD || (1/(j*w*CD0))
        // ZD_CD0 = ZD * (-j/(w*CD0)) / (ZD - j/(w*CD0))
        // Solving for ZD: ZD = ZD_CD0 * (-j/(w*CD0)) / ((-j/(w*CD0)) - ZD_CD0)

        const XCD0 = -1.0 / (w * CONST.CD0);

        // ZD = ZD_CD0 * j*XCD0 / (j*XCD0 - ZD_CD0)
        // Numerator: ZD_CD0 * (0 + j*XCD0)
        const numR = -ZD_CD0_X * XCD0;  // Real part of ZD_CD0 * j*XCD0
        const numX = ZD_CD0_R * XCD0;   // Imag part

        // Denominator: j*XCD0 - ZD_CD0 = -ZD_CD0_R + j*(XCD0 - ZD_CD0_X)
        const denR = -ZD_CD0_R;
        const denX = XCD0 - ZD_CD0_X;

        return complexDiv(numR, numX, denR, denX);
    }

    /**
     * Calculate ZC from ZD (reverse of D→C circuit)
     * C circuit: RC0, LC0, CC0, CC1
     * 
     * Forward: ZD = f(ZC, circuit constants)
     * This is complex - using simplified approach based on MatchingAlgorithm.hpp
     */
    function calculateZCFromZD(ZD_R, ZD_X) {
        // The C circuit transformation is complex
        // For simulation, we use a simplified inverse approximation
        // 
        // Forward direction (from MatchingAlgorithm.hpp):
        // ZD is calculated from ZC using the C circuit elements
        // 
        // Simplified reverse: approximate ZC ≈ ZD (for small circuit losses)
        // Then add correction based on circuit reactances

        const ZLC_R = CONST.RC0;
        const ZLC_X = w * CONST.LC0;
        const XCC0 = -1.0 / (w * CONST.CC0);
        const XCC1 = -1.0 / (w * CONST.CC1);

        // ZC0 = ZLC || CC0
        const ZC0 = parallelZ(ZLC_R, ZLC_X, 0, XCC0);

        // Approximate reverse: ZC ≈ ZD - ZC0 (removing the C circuit contribution)
        // Then reverse the CC1 parallel

        // First, remove ZC0 from the series path
        let ZD_CC1_R = ZD_R - ZC0.R;
        let ZD_CC1_X = ZD_X - ZC0.X;

        // Reverse the CC1 parallel: ZD_CC1 = ZC_goal || CC1
        // ZC_goal = ZD_CC1 * j*XCC1 / (j*XCC1 - ZD_CC1)
        const numR = -ZD_CC1_X * XCC1;
        const numX = ZD_CC1_R * XCC1;
        const denR = -ZD_CC1_R;
        const denX = XCC1 - ZD_CC1_X;

        const ZC = complexDiv(numR, numX, denR, denX);

        // Clamp to reasonable values
        return {
            R: Math.max(0.1, Math.min(100, ZC.R)),
            X: Math.max(-200, Math.min(200, ZC.X))
        };
    }

    /**
     * Calculate ZA and ZB from ZC (parallel combination)
     * ZC = ZA || ZB
     * 
     * For VVC0 branch (ZB), we calculate ZB from VVC0
     * Then solve for ZA
     */
    function calculateZB(VVC0_pF) {
        const VVC0 = VVC0_pF * CONST.pF;

        // ZB = RB0 + j*w*LB0 + 1/(j*w*(CB0 + VVC0))
        // where CB0 and VVC0 are in parallel for the capacitive part

        const totalC = CONST.CB0 + VVC0;
        const XC = -1.0 / (w * totalC);

        const RB = CONST.RB0;
        const XB = w * CONST.LB0 + XC;

        return { R: RB, X: XB };
    }

    /**
     * Calculate ZC from Output impedance (reverse path)
     * Based on MatchingAlgorithm.hpp::calculateZCFromOutput()
     * 
     * @param {number} Rpm - Output resistance (Ohms)
     * @param {number} Xpm - Output reactance (Ohms)
     * @param {number} VVC1_pF - VVC1 capacitance in pF
     * @returns {{R: number, X: number}} ZC impedance
     */
    function calculateZCFromOutput(Rpm, Xpm, VVC1_pF) {
        const VVC1 = VVC1_pF * CONST.pF;

        // Step 1: ZE = (Rpm + RE0) + j*(Xpm + w*LE0)
        const wLE0 = w * CONST.LE0;
        const ZE_R = Rpm + CONST.RE0;
        const ZE_X = Xpm + wLE0;

        // Step 2: ZE || 1/(j*w*CD0)
        // 1/(j*w*CD0) = -j/(w*CD0), so real=0, imag = -1/(w*CD0)
        const XCD0 = -1.0 / (w * CONST.CD0);

        // Complex: ZE * (j*XCD0) = (ZE_R + j*ZE_X) * (j*XCD0)
        //        = j*ZE_R*XCD0 + j²*ZE_X*XCD0 = -ZE_X*XCD0 + j*ZE_R*XCD0
        let num_R = -ZE_X * XCD0;
        let num_X = ZE_R * XCD0;

        // Complex: ZE + (j*XCD0) = ZE_R + j*(ZE_X + XCD0)
        let den_R = ZE_R;
        let den_X = ZE_X + XCD0;

        // Complex division: num / den
        let den_mag2 = den_R * den_R + den_X * den_X;
        if (den_mag2 < 1e-30) {
            return { R: Rpm, X: Xpm };
        }

        const ZE_CD0_R = (num_R * den_R + num_X * den_X) / den_mag2;
        const ZE_CD0_X = (num_X * den_R - num_R * den_X) / den_mag2;

        // Step 3: + 1/(j*w*VVC1) in series
        // 1/(j*w*VVC1) = -j/(w*VVC1)
        const XVVC1 = -1.0 / (w * VVC1);
        const ZD_R = ZE_CD0_R;
        const ZD_X = ZE_CD0_X + XVVC1;

        // Step 4: ZD || 1/(j*w*CC1)
        const XCC1 = -1.0 / (w * CONST.CC1);

        // ZD * (j*XCC1)
        num_R = -ZD_X * XCC1;
        num_X = ZD_R * XCC1;

        // ZD + (j*XCC1)
        den_R = ZD_R;
        den_X = ZD_X + XCC1;

        den_mag2 = den_R * den_R + den_X * den_X;
        if (den_mag2 < 1e-30) {
            return { R: Rpm, X: Xpm };
        }

        const ZD_CC1_R = (num_R * den_R + num_X * den_X) / den_mag2;
        const ZD_CC1_X = (num_X * den_R - num_R * den_X) / den_mag2;

        // Step 5: C circuit branch: (RC0 + j*w*LC0) || 1/(j*w*CC0)
        const ZLC_R = CONST.RC0;
        const ZLC_X = w * CONST.LC0;
        const XCC0 = -1.0 / (w * CONST.CC0);

        // ZLC * (j*XCC0)
        num_R = -ZLC_X * XCC0;
        num_X = ZLC_R * XCC0;

        // ZLC + (j*XCC0)
        den_R = ZLC_R;
        den_X = ZLC_X + XCC0;

        den_mag2 = den_R * den_R + den_X * den_X;
        if (den_mag2 < 1e-30) {
            return { R: Rpm, X: Xpm };
        }

        const ZC0_R = (num_R * den_R + num_X * den_X) / den_mag2;
        const ZC0_X = (num_X * den_R - num_R * den_X) / den_mag2;

        // Step 6: ZC = ZD_CC1 + ZC0 (series addition)
        return {
            R: ZD_CC1_R + ZC0_R,
            X: ZD_CC1_X + ZC0_X
        };
    }

    /**
     * Calculate ZA from ZC and ZB
     * ZC = ZA || ZB → ZA = ZB * ZC / (ZB - ZC)
     */
    function calculateZA(ZC_R, ZC_X, ZB_R, ZB_X) {
        // ZA = (ZB * ZC) / (ZB - ZC)
        const num = complexMul(ZB_R, ZB_X, ZC_R, ZC_X);
        const denR = ZB_R - ZC_R;
        const denX = ZB_X - ZC_X;

        const ZA = complexDiv(num.R, num.X, denR, denX);

        // Clamp to reasonable values
        return {
            R: Math.max(0.1, Math.min(500, ZA.R)),
            X: Math.max(-500, Math.min(500, ZA.X))
        };
    }

    /**
     * Calculate Zm (measured input) from ZA
     * Zm = ZA + j*w*Lp - j/(w*Cp) (reverse of input stage)
     * 
     * Actually forward: ZA = (Zm - j*w*Lp) / (1 + j*w*Cp*(Zm - j*w*Lp))
     * Reverse: Zm = ZA * (1 + j*w*Cp*(-j*w*Lp)) + j*w*Lp / (... complex)
     * 
     * Simplified: Use forward calculation structure but reverse
     */
    function calculateZmFromZA(ZA_R, ZA_X) {
        // Forward transformation matrix approach
        // ZA = (Zm - j*w*Lp) / (1 + j*w*Cp*(Zm - j*w*Lp))
        // 
        // Let Y = Zm - j*w*Lp
        // ZA = Y / (1 + j*w*Cp*Y)
        // ZA * (1 + j*w*Cp*Y) = Y
        // ZA + j*w*Cp*ZA*Y = Y
        // ZA = Y - j*w*Cp*ZA*Y
        // ZA = Y * (1 - j*w*Cp*ZA)
        // Y = ZA / (1 - j*w*Cp*ZA)

        const wCp = w * CONST.Cp;

        // 1 - j*w*Cp*ZA
        const denR = 1 - (-wCp * ZA_X);  // Real: 1 + wCp*ZA_X
        const denX = -wCp * ZA_R;        // Imag: -wCp*ZA_R

        // Y = ZA / (1 - j*wCp*ZA)
        const Y = complexDiv(ZA_R, ZA_X, denR, denX);

        // Zm = Y + j*w*Lp
        const wLp = w * CONST.Lp;

        return {
            R: Y.R,
            X: Y.X + wLp
        };
    }

    /**
     * Calculate complete input impedance from VVC positions
     * 
     * New formula (user-provided):
     *   1. ZC = calculateZCFromOutput(Rpm=9, Xpm=10, VVC1)  // Output에서 역산
     *   2. ZB = calculateZB(VVC0)  // VVC0 기반
     *   3. ZCB = ZC || ZB          // 병렬 합성
     *   4. ZA = ZCB || (1/jωCp)    // Cp와 병렬 합성
     *   5. Zm = ZA + jωLp          // Lp 직렬 추가
     */
    function calculateInputImpedance() {
        const device = getDevice();
        if (!device) {
            return { R: 50, X: 0, V: 100, I: 2, phase: 0 };
        }

        // Get capacitances from motors (in pF)
        const VVC0_pF = device.motors[0].getCapacitance() / 100;  // C1: 100-1000 pF
        const VVC1_pF = device.motors[1].getCapacitance() / 100;  // C2: 50-500 pF

        // Step 1: Calculate ZC from Output impedance (Rpm=9, Xpm=10) and VVC1
        const ZC = calculateZCFromOutput(PLASMA_R, PLASMA_X, VVC1_pF);

        // Step 2: Calculate ZB from VVC0
        const ZB = calculateZB(VVC0_pF);

        // Step 3: ZC || ZB (병렬 합성)
        const ZCB = parallelZ(ZC.R, ZC.X, ZB.R, ZB.X);

        // Step 4: ZCB || (1/jωCp)
        // 1/(jωCp) = -j/(ωCp), so real=0, imag = -1/(ω*Cp)
        const XCp = -1.0 / (w * CONST.Cp);
        const ZA = parallelZ(ZCB.R, ZCB.X, 0, XCp);

        // Step 5: Zm = ZA + jωLp (직렬 추가)
        const XLp = w * CONST.Lp;
        const Zm = { R: ZA.R, X: ZA.X + XLp };

        // Add noise (0.1%)
        const R = addNoise(Zm.R, NOISE_PERCENT);
        const X = addNoise(Zm.X, NOISE_PERCENT);

        // Calculate magnitude and phase
        const ZinMag = Math.sqrt(R * R + X * X);
        const ZinPhase = Math.atan2(X, R) * (180 / Math.PI);

        // Calculate V and I from 1000W power dissipation
        // P = I² * R → I = sqrt(P / R)
        // V = |Z| * I = sqrt(R² + X²) * I
        const Pforward = 1000;  // Watts
        const I = Math.sqrt(Pforward / Math.max(R, 0.1));  // Prevent division by zero
        const V = ZinMag * I;

        return {
            R: R,
            X: X,
            V: addNoise(V, NOISE_PERCENT),
            I: addNoise(I, NOISE_PERCENT),
            phase: addNoise(ZinPhase, NOISE_PERCENT)
        };
    }

    /**
     * Calculate output impedance (always fixed at Rp=9, Xp=10)
     * Same 1000W power dissipation at plasma load
     */
    function calculateOutputImpedance() {
        const R = PLASMA_R;
        const X = PLASMA_X;
        const ZpMag = Math.sqrt(R * R + X * X);
        const phase = Math.atan2(X, R) * (180 / Math.PI);

        // Calculate V and I from 1000W power at plasma
        // P = I² * R → I = sqrt(P / R)
        // V = |Z| * I
        const Pforward = 1000;  // Watts
        const I = Math.sqrt(Pforward / R);
        const V = ZpMag * I;

        return {
            R: addNoise(R, NOISE_PERCENT),
            X: addNoise(X, NOISE_PERCENT),
            V: addNoise(V, NOISE_PERCENT),
            I: addNoise(I, NOISE_PERCENT),
            phase: addNoise(phase, NOISE_PERCENT)
        };
    }

    /**
     * Calculate VSWR from impedance
     */
    function calculateVSWR(R, X) {
        const numR = R - CONST.Z0;
        const numX = X;
        const denR = R + CONST.Z0;
        const denX = X;

        const denMagSq = denR * denR + denX * denX;
        if (denMagSq < 1e-10) return 999;

        const gammaR = (numR * denR + numX * denX) / denMagSq;
        const gammaX = (numX * denR - numR * denX) / denMagSq;
        const gammaMag = Math.sqrt(gammaR * gammaR + gammaX * gammaX);

        if (gammaMag >= 1) return 999;
        return (1 + gammaMag) / (1 - gammaMag);
    }

    // ========================================
    // Matching Algorithm (Forward: Rm,Xm → A→B→C→D→E→Plasma)
    // Based on MatchingAlgorithm.hpp
    // ========================================

    // Precomputed matching goal constants (for 50Ω matching)
    // Exactly ported from MatchingAlgorithm.hpp constructor
    const MATCHING = (function () {
        // Frequency powers (from MatchingAlgorithm.hpp constructor)
        const w3 = w2 * w;
        const w4 = w2 * w2;
        const w5 = w4 * w;
        const w6 = w3 * w3;

        // =====================================================
        // ZA (M→A) precomputed coefficients
        // =====================================================
        const Lp = CONST.Lp, Cp = CONST.Cp;
        const Lp2 = Lp * Lp, Cp2 = Cp * Cp;
        const CpLpW2 = Cp * Lp * w2;
        const Cp2W2 = Cp2 * w2;
        const Cp2Lp2W4 = Cp2 * Lp2 * w4;

        const denom_A_const = 1.0 - 2.0 * CpLpW2 + Cp2Lp2W4;
        const denom_A_Rm2 = Cp2W2;
        const denom_A_Xm = 2.0 * Cp * w - 2.0 * Cp2 * Lp * w3;
        const denom_A_Xm2 = Cp2W2;

        const XA_const = -Lp * w + Cp * Lp2 * w3;
        const XA_Rm2 = Cp * w;
        const XA_Xm = 1.0 - 2.0 * Cp * Lp * w2;
        const XA_Xm2 = Cp * w;

        // =====================================================
        // ZB (VVC0 branch) precomputed coefficients
        // =====================================================
        const LB0 = CONST.LB0, RB0 = CONST.RB0, CB0 = CONST.CB0;
        const LB02 = LB0 * LB0, CB02 = CB0 * CB0, RB02 = RB0 * RB0;
        const CB0LB0W2 = CB0 * LB0 * w2;
        const CB02W2_RB02_LB02W2 = CB02 * w2 * (RB02 + LB02 * w2);
        const denomB_const = 1.0 - 2.0 * CB0LB0W2 + CB02W2_RB02_LB02W2;

        const RB_const = RB0 / denomB_const;  // RB is completely constant!

        // XB = -(XB_numer_const + XB_numer_VVC0 * VVC0) / (VVC0 * XB_denom_factor)
        const XB_numer_const = 1.0 + CB02W2_RB02_LB02W2 - 2.0 * CB0 * LB0 * w2;
        const XB_numer_VVC0 = -LB0 * w2 + CB0 * RB02 * w2 + CB0 * LB02 * w4;
        const XB_denom_factor = w * denomB_const;

        // =====================================================
        // ZD (C→D) precomputed coefficients
        // EXACTLY from MatchingAlgorithm.hpp lines 217-263
        // =====================================================
        const RC0 = CONST.RC0, LC0 = CONST.LC0, CC0 = CONST.CC0, CC1 = CONST.CC1;
        const RC02 = RC0 * RC0, LC02 = LC0 * LC0;
        const CC02 = CC0 * CC0, CC12 = CC1 * CC1;

        // Denominator coefficients (grouped by RC, XC powers)
        // Constant term (no RC, no XC)
        const D_const = 1.0 - 2.0 * CC0 * LC0 * w2 - 2.0 * CC1 * LC0 * w2
            + CC02 * RC02 * w2 + 2.0 * CC0 * CC1 * RC02 * w2 + CC12 * RC02 * w2
            + CC02 * LC02 * w4 + 2.0 * CC0 * CC1 * LC02 * w4 + CC12 * LC02 * w4;

        // RC² coefficient
        const D_RC2 = CC12 * w2 - 2.0 * CC0 * CC12 * LC0 * w4 + CC02 * CC12 * RC02 * w4
            + CC02 * CC12 * LC02 * w6;

        // RC coefficient (from -2*CC12*RC*RC0*w²)
        const D_RC = -2.0 * CC12 * RC0 * w2;

        // XC coefficient
        const D_XC = 2.0 * CC1 * w - 4.0 * CC0 * CC1 * LC0 * w3 - 2.0 * CC12 * LC0 * w3
            + 2.0 * CC02 * CC1 * RC02 * w3 + 2.0 * CC0 * CC12 * RC02 * w3
            + 2.0 * CC02 * CC1 * LC02 * w5 + 2.0 * CC0 * CC12 * LC02 * w5;

        // XC² coefficient
        const D_XC2 = CC12 * w2 - 2.0 * CC0 * CC12 * LC0 * w4
            + CC02 * CC12 * RC02 * w4 + CC02 * CC12 * LC02 * w6;

        // RD numerator coefficients: RD = (RD_numer) / denom
        const RD_const = -RC0;
        const RD_RC = 1.0 - 2.0 * CC0 * LC0 * w2 + CC02 * RC02 * w2 + CC02 * LC02 * w4;

        // XD numerator coefficients: XD = (XD_numer) / denom
        // Constant terms (no RC, no XC)
        const XD_const = -LC0 * w + CC0 * RC02 * w + CC1 * RC02 * w
            + CC0 * LC02 * w3 + CC1 * LC02 * w3;

        // RC² coefficient
        const XD_RC2 = CC1 * w - 2.0 * CC0 * CC1 * LC0 * w3 + CC02 * CC1 * RC02 * w3
            + CC02 * CC1 * LC02 * w5;

        // RC coefficient
        const XD_RC = -2.0 * CC1 * RC0 * w;

        // XC coefficient
        const XD_XC = 1.0 - 2.0 * CC0 * LC0 * w2 - 2.0 * CC1 * LC0 * w2
            + CC02 * RC02 * w2 + 2.0 * CC0 * CC1 * RC02 * w2
            + CC02 * LC02 * w4 + 2.0 * CC0 * CC1 * LC02 * w4;

        // XC² coefficient
        const XD_XC2 = CC1 * w - 2.0 * CC0 * CC1 * LC0 * w3
            + CC02 * CC1 * RC02 * w3 + CC02 * CC1 * LC02 * w5;

        // =====================================================
        // Matching Goals precomputed values
        // RAGoal, XAGoal (50Ω target at point A)
        // =====================================================
        const Z0 = CONST.Z0;
        const Z2 = Z0 * Z0;  // 2500
        const denomGoal = 1.0 + Z2 * Cp2 * w2 - 2.0 * Cp * Lp * w2 + Cp2 * Lp2 * w4;
        const RAGoal = Z0 / denomGoal;
        const XAGoal = w * (Z2 * Cp - Lp + Cp * Lp2 * w2) / denomGoal;
        const RAGoal2 = RAGoal * RAGoal;
        const XAGoal2 = XAGoal * XAGoal;

        // RB² for matching calculations (RB is constant)
        const RB2 = RB_const * RB_const;

        // =====================================================
        // Discriminant coefficients for XBGoal/XCGoal
        // EXACTLY from MatchingAlgorithm.hpp lines 281-288
        // =====================================================
        const RAGoal3 = RAGoal * RAGoal2;
        const disc_const = RAGoal3 * RB_const - RAGoal2 * RB2 + RAGoal * RB_const * XAGoal2;
        const disc_RC_coef = RAGoal3 - 3.0 * RAGoal2 * RB_const + 2.0 * RAGoal * RB2
            + RAGoal * XAGoal2 - RB_const * XAGoal2;
        const disc_RC2_coef = -RAGoal2 + 2.0 * RAGoal * RB_const - RB2;

        return {
            // ZA coefficients
            denom_A_const, denom_A_Rm2, denom_A_Xm, denom_A_Xm2,
            XA_const, XA_Rm2, XA_Xm, XA_Xm2,
            // ZB coefficients
            RB_const, XB_numer_const, XB_numer_VVC0, XB_denom_factor,
            // ZD coefficients (denominator)
            D_const, D_RC2, D_RC, D_XC, D_XC2,
            // ZD coefficients (RD numerator)
            RD_const, RD_RC,
            // ZD coefficients (XD numerator)
            XD_const, XD_RC2, XD_RC, XD_XC, XD_XC2,
            // Matching goal constants
            RAGoal, XAGoal, RAGoal2, XAGoal2, RB2, RAGoal3,
            disc_const, disc_RC_coef, disc_RC2_coef
        };
    })();

    /**
     * Calculate ZA from measured impedance (Rm, Xm)
     * ZA = (Zm - jωLp) / (1 + jωCp(Zm - jωLp))
     */
    function calculateZA(Rm, Xm) {
        const Rm2 = Rm * Rm;
        const Xm2 = Xm * Xm;
        const M = MATCHING;

        const denom = M.denom_A_const + M.denom_A_Rm2 * Rm2
            + M.denom_A_Xm * Xm + M.denom_A_Xm2 * Xm2;

        const RA = Rm / denom;
        const XA = (M.XA_const + M.XA_Rm2 * Rm2 + M.XA_Xm * Xm + M.XA_Xm2 * Xm2) / denom;

        return { R: RA, X: XA };
    }

    /**
     * Calculate ZB from VVC0 (using optimized formula)
     */
    function calculateZBFromVVC0(VVC0_pF) {
        const VVC0 = VVC0_pF * CONST.pF;
        const M = MATCHING;

        const RB = M.RB_const;  // Constant!
        const numer = -(M.XB_numer_const + M.XB_numer_VVC0 * VVC0);
        const XB = numer / (VVC0 * M.XB_denom_factor);

        return { R: RB, X: XB };
    }

    /**
     * Calculate ZC from ZA and ZB (parallel combination)
     * ZC = ZA || ZB
     */
    function calculateZC(RA, XA, RB, XB) {
        const RA2 = RA * RA;
        const RB2 = RB * RB;
        const XA2 = XA * XA;
        const XB2 = XB * XB;

        const denom = RA2 - 2.0 * RA * RB + RB2 + XA2 - 2.0 * XA * XB + XB2;

        if (Math.abs(denom) < 1e-12) {
            return { R: RA, X: XA };
        }

        const RC = (-RA2 * RB + RA * RB2 - RB * XA2 + RA * XB2) / denom;
        const XC = (RB2 * XA - RA2 * XB - XA2 * XB + XA * XB2) / denom;

        return { R: RC, X: XC };
    }

    /**
     * Calculate ZD from ZC (C→D transformation)
     * EXACTLY from MatchingAlgorithm.hpp::calculateZD() lines 470-487
     */
    function calculateZD(RC, XC) {
        const RC2 = RC * RC;
        const XC2 = XC * XC;
        const M = MATCHING;

        const denom = M.D_const + M.D_RC2 * RC2 + M.D_RC * RC + M.D_XC * XC + M.D_XC2 * XC2;

        if (Math.abs(denom) < 1e-20) {
            return { R: RC, X: XC };
        }

        // RD numerator: RD_const + RD_RC * RC
        const RD_numer = M.RD_const + M.RD_RC * RC;
        const RD = RD_numer / denom;

        // XD numerator: XD_const + XD_RC2 * RC² + XD_RC * RC + XD_XC * XC + XD_XC2 * XC²
        const XD_numer = M.XD_const + M.XD_RC2 * RC2 + M.XD_RC * RC + M.XD_XC * XC + M.XD_XC2 * XC2;
        const XD = XD_numer / denom;

        return { R: RD, X: XD };
    }

    /**
     * Calculate ZE from ZD and VVC1
     */
    function calculateZEFromZD(RD, XD, VVC1_pF) {
        const VVC1 = VVC1_pF * CONST.pF;
        const VVC12 = VVC1 * VVC1;
        const RD2 = RD * RD;
        const XD2 = XD * XD;
        const CD0 = CONST.CD0;
        const CD02 = CD0 * CD0;

        const denomE = CD02 + 2.0 * CD0 * VVC1 + VVC12
            + CD02 * w2 * RD2 * VVC12
            + 2.0 * CD02 * w * VVC1 * XD
            + 2.0 * CD0 * w * VVC12 * XD
            + CD02 * w2 * VVC12 * XD2;

        if (Math.abs(denomE) < 1e-30) {
            return { R: RD, X: XD };
        }

        const RE = RD * VVC12 / denomE;
        const XE_numer = CD0 + VVC1
            + CD0 * w2 * RD2 * VVC12
            + 2.0 * CD0 * w * VVC1 * XD
            + VVC12 * w * XD
            + CD0 * w2 * VVC12 * XD2;
        const XE = XE_numer / (w * denomE);

        return { R: RE, X: XE };
    }

    /**
     * Calculate Plasma impedance from ZE
     */
    function calculateZPFromZE(RE, XE) {
        const Rp = RE - CONST.RE0;
        const Xp = XE - w * CONST.LE0;
        return { R: Rp, X: Xp };
    }

    /**
     * Calculate all impedance points from measured input impedance and VVC values
     * Used by AMC command
     */
    function calculateAllImpedances(Rm, Xm, VVC0_pF, VVC1_pF) {
        const ZA = calculateZA(Rm, Xm);
        const ZB = calculateZBFromVVC0(VVC0_pF);
        const ZC = calculateZC(ZA.R, ZA.X, ZB.R, ZB.X);
        const ZD = calculateZD(ZC.R, ZC.X);
        const ZE = calculateZEFromZD(ZD.R, ZD.X, VVC1_pF);
        const ZP = calculateZPFromZE(ZE.R, ZE.X);

        // Calculate VSWR
        const vswr = calculateVSWR(Rm, Xm);

        return {
            RA: ZA.R, XA: ZA.X,
            RB: ZB.R, XB: ZB.X,
            RC: ZC.R, XC: ZC.X,
            RD: ZD.R, XD: ZD.X,
            RE: ZE.R, XE: ZE.X,
            Rp: ZP.R, Xp: ZP.X,
            VSWR: vswr
        };
    }

    /**
     * Get target ZA for 50Ω matching
     */
    function getRAGoal() {
        return { R: MATCHING.RAGoal, X: MATCHING.XAGoal };
    }

    /**
     * Calculate XD from XC (for matching goal calculation)
     * Uses precomputed D coefficients from MATCHING
     */
    function calcXDFromXC(RC, XC_in) {
        const RC2 = RC * RC;
        const XC2_in = XC_in * XC_in;
        const M = MATCHING;

        const denom = M.D_const + M.D_RC2 * RC2 + M.D_RC * RC + M.D_XC * XC_in + M.D_XC2 * XC2_in;
        const XD_numer = M.XD_const + M.XD_RC2 * RC2 + M.XD_RC * RC + M.XD_XC * XC_in + M.XD_XC2 * XC2_in;

        if (Math.abs(denom) < 1e-20) return XC_in;
        return XD_numer / denom;
    }

    /**
     * Calculate matching goals (target VVC values for 50Ω matching)
     * Used by AMG/AMR commands
     */
    function calculateMatchingGoals(Rm, Xm, VVC0_pF, VVC1_pF, motor0, motor1) {
        const M = MATCHING;
        const pF = CONST.pF;

        const goals = {
            VVC0Goal0: 0, VVC1Goal0: 0, step0Goal0: 0, step1Goal0: 0, valid0: false,
            VVC0Goal1: 0, VVC1Goal1: 0, step0Goal1: 0, step1Goal1: 0, valid1: false,
            RAGoal: M.RAGoal, XAGoal: M.XAGoal,
            XBGoal0: 0, XBGoal1: 0,
            XDGoal0: 0, XDGoal1: 0
        };

        // Calculate current impedances
        const pts = calculateAllImpedances(Rm, Xm, VVC0_pF, VVC1_pF);
        const RC = pts.RC;
        const XC = pts.XC;
        const XD = pts.XD;
        const XB = pts.XB;
        const RC2 = RC * RC;

        // Calculate discriminant
        const discriminant = 4.0 * (M.disc_const + M.disc_RC_coef * RC + M.disc_RC2_coef * RC2);

        if (discriminant < 0) {
            return goals;  // No valid solution
        }

        const sqrtD = Math.sqrt(discriminant);
        const denom_XB = 2.0 * (M.RAGoal - RC);

        if (Math.abs(denom_XB) < 1e-12) {
            return goals;  // Division by zero
        }

        goals.XBGoal0 = (-2.0 * RC * M.XAGoal - sqrtD) / denom_XB;
        goals.XBGoal1 = (-2.0 * RC * M.XAGoal + sqrtD) / denom_XB;

        // VVC0 goal calculation
        const VVC0 = VVC0_pF * pF;
        const VVC1 = VVC1_pF * pF;

        const denom0_VVC0 = 1.0 + VVC0 * w * XB - VVC0 * w * goals.XBGoal0;
        const denom1_VVC0 = 1.0 + VVC0 * w * XB - VVC0 * w * goals.XBGoal1;

        if (Math.abs(denom0_VVC0) > 1e-20) {
            goals.VVC0Goal0 = (VVC0 / denom0_VVC0) / pF;
            goals.valid0 = goals.VVC0Goal0 > 0;
        }

        if (Math.abs(denom1_VVC0) > 1e-20) {
            goals.VVC0Goal1 = (VVC0 / denom1_VVC0) / pF;
            goals.valid1 = goals.VVC0Goal1 > 0;
        }

        // XCGoal and XDGoal calculation
        const denom_XC = M.RAGoal - M.RB_const;
        if (Math.abs(denom_XC) > 1e-12) {
            const sqrtD_XC = sqrtD / 2.0;
            const XCGoal0 = (-M.RB_const * M.XAGoal + sqrtD_XC) / denom_XC;
            const XCGoal1 = (-M.RB_const * M.XAGoal - sqrtD_XC) / denom_XC;

            goals.XDGoal0 = calcXDFromXC(RC, XCGoal0);
            goals.XDGoal1 = calcXDFromXC(RC, XCGoal1);
        }

        // VVC1 goal calculation
        const denom0_VVC1 = 1.0 + VVC1 * w * XD - VVC1 * w * goals.XDGoal0;
        const denom1_VVC1 = 1.0 + VVC1 * w * XD - VVC1 * w * goals.XDGoal1;

        if (Math.abs(denom0_VVC1) > 1e-20) {
            goals.VVC1Goal0 = (VVC1 / denom0_VVC1) / pF;
            if (goals.VVC1Goal0 < 0) goals.valid0 = false;
        } else {
            goals.valid0 = false;
        }

        if (Math.abs(denom1_VVC1) > 1e-20) {
            goals.VVC1Goal1 = (VVC1 / denom1_VVC1) / pF;
            if (goals.VVC1Goal1 < 0) goals.valid1 = false;
        } else {
            goals.valid1 = false;
        }

        // Convert capacitance to motor steps
        if (motor0) {
            goals.step0Goal0 = motor0.getPositionFromCap(Math.round(goals.VVC0Goal0 * 100));
            goals.step0Goal1 = motor0.getPositionFromCap(Math.round(goals.VVC0Goal1 * 100));
        }

        if (motor1) {
            goals.step1Goal0 = motor1.getPositionFromCap(Math.round(goals.VVC1Goal0 * 100));
            goals.step1Goal1 = motor1.getPositionFromCap(Math.round(goals.VVC1Goal1 * 100));
        }

        return goals;
    }

    // ========================================
    // Motor Physics
    // ========================================

    /**
     * Update motor positions toward target
     * Called periodically during simulation
     * @returns {boolean} True if any motor moved
     */
    function updateMotorPositions() {
        const device = getDevice();
        if (!device) return false;

        if (!device) return false;

        // stepsPerUpdate is now calculated per motor based on its RPM
        let anyMoved = false;

        device.motors.forEach((motor, idx) => {
            if (motor.position !== motor.targetPosition) {
                // Determine RPM to use (should be set by runMotor)
                const currentRpm = motor.rpm > 0 ? motor.rpm : 100;
                // 1 turn = 6000 steps. RPM X = X turns/min = X/60 turns/sec = X * 100 steps/sec
                const stepsPerSec = currentRpm * 100;
                const stepsPerUpdate = Math.floor(stepsPerSec * SIMULATION_RATE_MS / 1000);

                const diff = motor.targetPosition - motor.position;
                // Ensure at least 1 step if moving
                const stepMag = Math.max(1, Math.min(Math.abs(diff), stepsPerUpdate));
                const step = Math.sign(diff) * stepMag;

                motor.position += step;
                // motor.rpm is already set by runMotor, do not overwrite it here
                anyMoved = true;

                // Check if reached target
                if (motor.position === motor.targetPosition) {
                    motor.rpm = 0;
                }
            } else {
                motor.rpm = 0;
            }
        });

        return anyMoved;
    }

    /**
     * Check if any motor is currently moving
     */
    function isAnyMotorMoving() {
        const device = getDevice();
        if (!device) return false;

        return device.motors.some(m => m.position !== m.targetPosition);
    }

    /**
     * Send motor position update (MPB format)
     */
    function sendMotorPositionUpdate() {
        const device = getDevice();
        if (!device) return;

        const m0 = device.motors[0];
        const m1 = device.motors[1];

        const pos0 = m0.position;
        const pct0 = m0.getPositionPercent();
        const cap0 = m0.getCapacitance();  // pF × 100

        const pos1 = m1.position;
        const pct1 = m1.getPositionPercent();
        const cap1 = m1.getCapacitance();  // pF × 100

        const response = `MPB,${pos0},${pct0},${cap0},${pos1},${pct1},${cap1},EN\r\n`;
        sendResponse(response);
    }

    /**
     * Start motor position streaming during movement
     */
    function startMotorStream() {
        if (motorStreamInterval) return;

        motorStreamInterval = setInterval(() => {
            if (isAnyMotorMoving()) {
                sendMotorPositionUpdate();
            } else {
                // Send final position and stop streaming
                sendMotorPositionUpdate();
                stopMotorStream();
            }
        }, 50);  // 50ms interval (20Hz) for smooth updates
    }

    /**
     * Stop motor position streaming
     */
    function stopMotorStream() {
        if (motorStreamInterval) {
            clearInterval(motorStreamInterval);
            motorStreamInterval = null;
        }
    }

    // ========================================
    // Simulation Control
    // ========================================

    /**
     * Start physics simulation
     */
    function startSimulation() {
        if (simulationInterval) return;

        simulationInterval = setInterval(() => {
            updateMotorPositions();
        }, SIMULATION_RATE_MS);

        console.log('[PhysicsSimulator] Simulation started (RPM 100, 10000 steps/sec)');
    }

    /**
     * Stop physics simulation
     */
    function stopSimulation() {
        if (simulationInterval) {
            clearInterval(simulationInterval);
            simulationInterval = null;
        }
        stopMotorStream();
        console.log('[PhysicsSimulator] Simulation stopped');
    }

    // ========================================
    // AMS (Auto Matching with Sensor) Loop
    // ========================================

    let amsInterval = null;
    let amsState = {
        enabled: false,
        matching: false,  // false = monitoring, true = matching
        startTime: 0,
        lastMatchTime: 0,
        intervalMs: 100,
        timeoutMs: 5000,  // 0 = no timeout
        logInterval: 10,
        logCounter: 0
    };

    /**
     * AMS matching step - calculate and move to target
     */
    function amsMatchingStep() {
        const device = getDevice();
        if (!device) return;

        // Get current VVC positions
        const VVC0_pF = device.motors[0].getCapacitance() / 100;
        const VVC1_pF = device.motors[1].getCapacitance() / 100;

        // Calculate current input impedance (simulated)
        const input = calculateInputImpedance();
        const Rm = input.R;
        const Xm = input.X;

        // Calculate VSWR
        const vswr = calculateVSWR(Rm, Xm);

        // Log progress (every N iterations)
        amsState.logCounter++;
        const shouldLog = amsState.logCounter >= amsState.logInterval;
        if (shouldLog) {
            amsState.logCounter = 0;
            // Send ZI response
            const response = `ZI,${formatFloat(Rm, 2)},${formatFloat(Xm, 2)},${formatFloat(input.V, 2)},${formatFloat(input.I, 2)},${formatFloat(input.phase, 2)},EN\r\n`;
            sendResponse(response);
        }

        // Check if matched (VSWR < vswrStop)
        const vswrStop = device.vswrStop || 1.5;
        const vswrRestart = device.vswrRestart || 2.0;

        if (amsState.matching) {
            // Currently matching - check if matched
            if (vswr <= vswrStop) {
                amsState.matching = false;  // Switch to monitoring
                sendResponse(`AMS,MATCHED,${formatFloat(vswr, 2)},EN\r\n`);
                return;
            }

            // Still matching - calculate and move
            const goals = calculateMatchingGoals(
                Rm, Xm, VVC0_pF, VVC1_pF,
                device.motors[0], device.motors[1]
            );

            // Select valid goal
            const m0 = device.motors[0];
            const m1 = device.motors[1];

            const cap0Goal0 = Math.round(goals.VVC0Goal0 * 100);
            const cap1Goal0 = Math.round(goals.VVC1Goal0 * 100);
            const goal0_valid = goals.valid0 &&
                cap0Goal0 >= m0.minCap && cap0Goal0 <= m0.maxCap &&
                cap1Goal0 >= m1.minCap && cap1Goal0 <= m1.maxCap;

            const cap0Goal1 = Math.round(goals.VVC0Goal1 * 100);
            const cap1Goal1 = Math.round(goals.VVC1Goal1 * 100);
            const goal1_valid = goals.valid1 &&
                cap0Goal1 >= m0.minCap && cap0Goal1 <= m0.maxCap &&
                cap1Goal1 >= m1.minCap && cap1Goal1 <= m1.maxCap;

            if (goal0_valid) {
                m0.runMotor(goals.step0Goal0);
                m1.runMotor(goals.step1Goal0);
            } else if (goal1_valid) {
                m0.runMotor(goals.step0Goal1);
                m1.runMotor(goals.step1Goal1);
            }
        } else {
            // Monitoring mode - check if need to restart matching
            if (vswr > vswrRestart) {
                amsState.matching = true;  // Switch to matching
                sendResponse(`AMS,RESTART,${formatFloat(vswr, 2)},EN\r\n`);
            }
        }
    }

    /**
     * Start AMS loop
     */
    function startAMS(intervalMs = 100, timeoutMs = 5000) {
        if (amsInterval) {
            stopAMS();
        }

        amsState.enabled = true;
        amsState.matching = true;  // Start in matching mode
        amsState.startTime = Date.now();
        amsState.lastMatchTime = 0;
        amsState.intervalMs = intervalMs;
        amsState.timeoutMs = timeoutMs;
        amsState.logCounter = 0;

        // Send start response
        const device = getDevice();
        const input = calculateInputImpedance();
        const vswr = calculateVSWR(input.R, input.X);
        sendResponse(`AMS,RUN,${formatFloat(vswr, 2)},EN\r\n`);

        amsInterval = setInterval(() => {
            if (!amsState.enabled) {
                stopAMS();
                return;
            }

            // Check timeout
            if (amsState.timeoutMs > 0) {
                const elapsed = Date.now() - amsState.startTime;
                if (elapsed >= amsState.timeoutMs) {
                    sendResponse(`AMS,TIMEOUT,${elapsed},EN\r\n`);
                    stopAMS();
                    return;
                }
            }

            amsMatchingStep();
        }, intervalMs);

        console.log(`[AMS] Started (interval=${intervalMs}ms, timeout=${timeoutMs}ms)`);
    }

    /**
     * Stop AMS loop
     */
    function stopAMS() {
        if (amsInterval) {
            clearInterval(amsInterval);
            amsInterval = null;
        }
        amsState.enabled = false;
        amsState.matching = false;
        console.log('[AMS] Stopped');
    }

    /**
     * Check if AMS is running
     */
    function isAMSRunning() {
        return amsState.enabled;
    }

    // ========================================
    // Export API
    // ========================================

    if (typeof RF.mock === 'undefined') {
        RF.mock = {};
    }

    // AMS module
    RF.mock.ams = {
        start: startAMS,
        stop: stopAMS,
        isRunning: isAMSRunning,
        getState: function () { return amsState; }
    };

    RF.mock.physics = {
        // Simulation control
        start: startSimulation,
        stop: stopSimulation,

        // Motor physics
        updateMotorPositions: updateMotorPositions,
        isAnyMotorMoving: isAnyMotorMoving,

        // Motor streaming
        startMotorStream: startMotorStream,
        stopMotorStream: stopMotorStream,
        sendMotorPositionUpdate: sendMotorPositionUpdate,

        // Impedance calculations (for streaming)
        calculateInputImpedance: calculateInputImpedance,
        calculateOutputImpedance: calculateOutputImpedance,
        calculateVSWR: calculateVSWR,

        // Matching algorithm functions (for AMC/AMG/AMR)
        calculateAllImpedances: calculateAllImpedances,
        calculateMatchingGoals: calculateMatchingGoals,
        getRAGoal: getRAGoal,
        calculateZA: calculateZA,
        calculateZBFromVVC0: calculateZBFromVVC0,
        calculateZC: calculateZC,
        calculateZD: calculateZD,
        calculateZEFromZD: calculateZEFromZD,
        calculateZPFromZE: calculateZPFromZE,

        // Low-level functions (for testing/debugging)
        addNoise: addNoise,
        calculateZE: calculateZE,
        calculateZB: calculateZB,

        // Constants
        CONST: CONST,
        MATCHING: MATCHING,
        MOTOR_STEPS_PER_SEC: MOTOR_STEPS_PER_SEC,
        PLASMA_R: PLASMA_R,
        PLASMA_X: PLASMA_X,
        NOISE_PERCENT: NOISE_PERCENT
    };

    console.log('PhysicsSimulator initialized (f=' + (CONST.FREQ / 1e6) + ' MHz, Plasma=' + PLASMA_R + '+j' + PLASMA_X + 'Ω)');
})();
