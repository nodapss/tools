#pragma once

// MatchingAlgorithm.hpp - RF Matching Algorithm Library
// Implements impedance matching calculations based on circuit topology
// Header-only library for MatFW_001 integration
// 
// OPTIMIZED: All circuit-constant expressions are precomputed in constructor
// Runtime variables: Rm, Xm, VVC0, VVC1 only

#include <stdint.h>
#include <math.h>
#include "MotionBoard.hpp"

// ============================================================================
// Circuit Constants (SI Units)
// ============================================================================

namespace MatchingConst {
    // Unit conversion constants
    static constexpr double nH = 1.0e-9;
    static constexpr double pF = 1.0e-12;
    static constexpr double uH = 1.0e-6;
    
    // Operating frequency: 13.56 MHz
    static constexpr double FREQ = 13.56e6;
    static constexpr double PI = 3.14159265358979323846;
    static constexpr double OMEGA = 2.0 * PI * FREQ;  // Angular frequency (rad/s)
    
    // Input stage (M → A)
    static constexpr double Lp = 36.0 * nH;      // 36 nH
    static constexpr double Cp = 15.3 * pF;      // 15.3 pF
    
    // B circuit (VVC0 branch)
    static constexpr double LB0 = 157.0 * nH;    // 157 nH
    static constexpr double RB0 = 0.2;           // 0.2 Ω
    static constexpr double CB0 = 1.9 * pF;      // 1.9 pF
    
    // C circuit (intermediate)
    static constexpr double RC0 = 0.2;           // 0.2 Ω
    static constexpr double LC0 = 1.03 * uH;     // 1.03 μH
    static constexpr double CC0 = 2.0 * pF;      // 2.0 pF
    static constexpr double CC1 = 1.5 * pF;      // 1.5 pF
    
    // D circuit (VVC1 branch)
    static constexpr double CD0 = 31.0 * pF;     // 31 pF
    
    // E circuit (output stage before plasma)
    static constexpr double RE0 = 0.2;           // 0.2 Ω
    static constexpr double LE0 = 15.0 * nH;     // 15 nH
    
    // Target impedance for matching
    static constexpr double Z_TARGET = 50.0;     // 50 Ω
}

// ============================================================================
// Utility Functions
// ============================================================================

// Calculate VSWR from R, X (resistance and reactance)
// Returns VSWR value (1.0 = perfect match, higher = worse)
static inline double calculateVSWR(double R, double X, double Z0 = 50.0) {
    double denom = (R + Z0) * (R + Z0) + X * X;
    double numer = (R - Z0) * (R - Z0) + X * X;
    if (denom < 1e-12) return 999.0;  // Prevent division by zero
    double gamma = sqrt(numer / denom);
    if (gamma >= 1.0) return 999.0;  // Prevent division by zero
    return (1.0 + gamma) / (1.0 - gamma);
}

// ============================================================================
// Data Structures
// ============================================================================

// Impedance at each circuit point
struct ImpedancePoints {
    double RA, XA;  // Point A (after Lp, Cp)
    double RB, XB;  // Point B (VVC0 branch)
    double RC, XC;  // Point C (A || B parallel)
    double RD, XD;  // Point D (after CC0, CC1, LC0)
    double RE, XE;  // Point E (after CD0, VVC1)
    double Rp, Xp;  // Plasma impedance
};

// Coefficients for RC calculation from Output Sensor (Rpm, Xpm)
// RC = (N_const + N_Rpm*Rpm + N_Rpm2*Rpm² + N_Xpm*Xpm + N_Xpm2*Xpm²) /
//      (D_const + D_Rpm*Rpm + D_Rpm2*Rpm² + D_Xpm*Xpm + D_Xpm2*Xpm²)
// These coefficients depend on VVC1 and circuit constants
struct RCFromOutputCoeffs {
    double N_const, N_Rpm, N_Rpm2, N_Xpm, N_Xpm2;
    double D_const, D_Rpm, D_Rpm2, D_Xpm, D_Xpm2;
};

// Result structure for ZC calculation from Output Sensor
// Contains both real (RC) and imaginary (XC) parts of ZC
struct ZCFromOutput {
    double RC;  // Real part of ZC
    double XC;  // Imaginary part of ZC
};

// Matching goal results
struct MatchingGoals {
    // Solution 0
    double VVC0Goal0;       // Target VVC0 capacitance (pF)
    double VVC1Goal0;       // Target VVC1 capacitance (pF)
    int32_t step0Goal0;     // Motor 0 target position (steps)
    int32_t step1Goal0;     // Motor 1 target position (steps)
    bool valid0;            // Solution 0 validity
    
    // Solution 1
    double VVC0Goal1;       // Target VVC0 capacitance (pF)
    double VVC1Goal1;       // Target VVC1 capacitance (pF)
    int32_t step0Goal1;     // Motor 0 target position (steps)
    int32_t step1Goal1;     // Motor 1 target position (steps)
    bool valid1;            // Solution 1 validity
    
    // Intermediate values for debugging
    double RAGoal, XAGoal;  // Target A impedance
    double XBGoal0, XBGoal1;// Target B reactance (two solutions)
    double XDGoal0, XDGoal1;// Target D reactance (two solutions)
    
    // Debug values for output sensor calculation
    double RC_calculated;   // RC used (from input or output sensor)
    double XC_calculated;   // XC used (from input or output sensor)
    double XD_calculated;   // XD used (from input or output sensor)
};

// ============================================================================
// MatchingAlgorithm Class
// ============================================================================

class MatchingAlgorithm {
public:
    // Constructor - precompute ALL circuit-constant expressions
    MatchingAlgorithm() {
        using namespace MatchingConst;
        
        // =====================================================
        // Basic frequency powers
        // =====================================================
        w_ = OMEGA;
        w2_ = w_ * w_;
        w3_ = w2_ * w_;
        w4_ = w2_ * w2_;
        w5_ = w4_ * w_;
        w6_ = w3_ * w3_;
        
        // =====================================================
        // ZA (M→A) precomputed coefficients
        // denom = denom_A_const + denom_A_Rm2 * Rm² + denom_A_Xm * Xm + denom_A_Xm2 * Xm²
        // RA = Rm / denom
        // XA = (XA_const + XA_Rm2 * Rm² + XA_Xm * Xm + XA_Xm2 * Xm²) / denom
        // =====================================================
        double Lp2 = Lp * Lp;
        double Cp2 = Cp * Cp;
        double CpLpW2 = Cp * Lp * w2_;
        double Cp2W2 = Cp2 * w2_;
        double Cp2Lp2W4 = Cp2 * Lp2 * w4_;
        
        denom_A_const_ = 1.0 - 2.0 * CpLpW2 + Cp2Lp2W4;
        denom_A_Rm2_ = Cp2W2;
        denom_A_Xm_ = 2.0 * Cp * w_ - 2.0 * Cp2 * Lp * w3_;
        denom_A_Xm2_ = Cp2W2;
        
        XA_const_ = -Lp * w_ + Cp * Lp2 * w3_;
        XA_Rm2_ = Cp * w_;
        XA_Xm_ = 1.0 - 2.0 * Cp * Lp * w2_;
        XA_Xm2_ = Cp * w_;
        
        // =====================================================
        // ZB (VVC0 branch) precomputed coefficients
        // RB is completely constant!
        // XB = (XB_const + XB_VVC0_coef / VVC0) / VVC0  (simplified)
        // =====================================================
        double LB02 = LB0 * LB0;
        double CB02 = CB0 * CB0;
        double RB02 = RB0 * RB0;
        double CB0LB0W2 = CB0 * LB0 * w2_;
        double CB02W2_RB02_LB02W2 = CB02 * w2_ * (RB02 + LB02 * w2_);
        denomB_const_ = 1.0 - 2.0 * CB0LB0W2 + CB02W2_RB02_LB02W2;
        
        RB_const_ = RB0 / denomB_const_;  // RB is completely constant!
        
        // XB numerator: -(1 - LB0*VVC0*w² + CB02W2_RB02_LB02W2 + CB0*w²*(-2*LB0 + RB02*VVC0 + LB02*VVC0*w²))
        // Rewrite as: -(XB_numer_const + XB_numer_VVC0 * VVC0) / (VVC0 * w * denomB_const)
        XB_numer_const_ = 1.0 + CB02W2_RB02_LB02W2 - 2.0 * CB0 * LB0 * w2_;
        XB_numer_VVC0_ = -LB0 * w2_ + CB0 * RB02 * w2_ + CB0 * LB02 * w4_;
        XB_denom_factor_ = w_ * denomB_const_;  // VVC0 * w * denomB_const, VVC0 is runtime
        
        // =====================================================
        // ZE (D→E) precomputed coefficients
        // VVC1, RD, XD are runtime, so only CD0-related constants can be precomputed
        // =====================================================
        E_CD0_ = CD0;
        E_CD02_ = CD0 * CD0;
        E_2CD0_ = 2.0 * CD0;
        E_CD0_w_ = CD0 * w_;
        E_2CD0_w_ = 2.0 * CD0 * w_;
        E_CD02_w_ = E_CD02_ * w_;
        E_2CD02_w_ = 2.0 * E_CD02_ * w_;
        E_CD02_w2_ = E_CD02_ * w2_;
        
        // ZP (E→Plasma) precomputed coefficients
        // Rp = RE - RE0, Xp = XE - w*LE0
        RE0_ = RE0;
        LE0_w_ = LE0 * w_;
        
        // =====================================================
        // ZD (C→D) precomputed coefficients
        // These are for the C→D transformation with RC, XC as runtime variables
        // denom = D_const + D_RC2*RC² + D_RC*RC + D_XC*XC + D_XC2*XC² + D_RC2_XC*RC²*XC + D_RC2_XC2*RC²*XC²
        // =====================================================
        double LC02 = LC0 * LC0;
        double CC02 = CC0 * CC0;
        double CC12 = CC1 * CC1;
        double RC02 = RC0 * RC0;
        
        // Denominator coefficients (grouped by RC, XC powers)
        // Constant term (no RC, no XC)
        D_const_ = 1.0 - 2.0 * CC0 * LC0 * w2_ - 2.0 * CC1 * LC0 * w2_
                 + CC02 * RC02 * w2_ + 2.0 * CC0 * CC1 * RC02 * w2_ + CC12 * RC02 * w2_
                 + CC02 * LC02 * w4_ + 2.0 * CC0 * CC1 * LC02 * w4_ + CC12 * LC02 * w4_;
        
        // RC² coefficient
        D_RC2_ = CC12 * w2_ - 2.0 * CC0 * CC12 * LC0 * w4_ + CC02 * CC12 * RC02 * w4_
               + CC02 * CC12 * LC02 * w6_;
        
        // RC coefficient (from -2*CC12*RC*RC0*w²)
        D_RC_ = -2.0 * CC12 * RC0 * w2_;
        
        // XC coefficient
        D_XC_ = 2.0 * CC1 * w_ - 4.0 * CC0 * CC1 * LC0 * w3_ - 2.0 * CC12 * LC0 * w3_
              + 2.0 * CC02 * CC1 * RC02 * w3_ + 2.0 * CC0 * CC12 * RC02 * w3_
              + 2.0 * CC02 * CC1 * LC02 * w5_ + 2.0 * CC0 * CC12 * LC02 * w5_;
        
        // XC² coefficient
        D_XC2_ = CC12 * w2_ - 2.0 * CC0 * CC12 * LC0 * w4_
               + CC02 * CC12 * RC02 * w4_ + CC02 * CC12 * LC02 * w6_;
        
        // RD numerator coefficients: RD = (RD_numer) / denom
        // RD_numer = RC - RC0 - 2*CC0*LC0*RC*w² + CC02*RC*RC02*w² + CC02*LC02*RC*w4
        RD_const_ = -RC0;
        RD_RC_ = 1.0 - 2.0 * CC0 * LC0 * w2_ + CC02 * RC02 * w2_ + CC02 * LC02 * w4_;
        
        // XD numerator coefficients: XD = (XD_numer) / denom
        // Constant terms (no RC, no XC)
        XD_const_ = -LC0 * w_ + CC0 * RC02 * w_ + CC1 * RC02 * w_
                  + CC0 * LC02 * w3_ + CC1 * LC02 * w3_;
        
        // RC² coefficient
        XD_RC2_ = CC1 * w_ - 2.0 * CC0 * CC1 * LC0 * w3_ + CC02 * CC1 * RC02 * w3_
                + CC02 * CC1 * LC02 * w5_;
        
        // RC coefficient
        XD_RC_ = -2.0 * CC1 * RC0 * w_;
        
        // XC coefficient
        XD_XC_ = 1.0 - 2.0 * CC0 * LC0 * w2_ - 2.0 * CC1 * LC0 * w2_
               + CC02 * RC02 * w2_ + 2.0 * CC0 * CC1 * RC02 * w2_
               + CC02 * LC02 * w4_ + 2.0 * CC0 * CC1 * LC02 * w4_;
        
        // XC² coefficient
        XD_XC2_ = CC1 * w_ - 2.0 * CC0 * CC1 * LC0 * w3_
                + CC02 * CC1 * RC02 * w3_ + CC02 * CC1 * LC02 * w5_;
        
        // =====================================================
        // Matching Goals precomputed values
        // RAGoal, XAGoal (50Ω target at point A)
        // =====================================================
        double Z2 = Z_TARGET * Z_TARGET;  // 2500
        double denomGoal = 1.0 + Z2 * Cp2 * w2_ - 2.0 * Cp * Lp * w2_ + Cp2 * Lp2 * w4_;
        RAGoal_ = Z_TARGET / denomGoal;
        XAGoal_ = w_ * (Z2 * Cp - Lp + Cp * Lp2 * w2_) / denomGoal;
        RAGoal2_ = RAGoal_ * RAGoal_;
        XAGoal2_ = XAGoal_ * XAGoal_;
        
        // RB² for matching calculations (RB is constant)
        RB2_ = RB_const_ * RB_const_;
        
        // =====================================================
        // Discriminant coefficients for XBGoal/XCGoal (RC-based factorization)
        // XCGoal disc = disc_const_ + disc_RC_coef_ * RC + disc_RC2_coef_ * RC²
        // XBGoal disc = 4 * XCGoal disc
        // =====================================================
        double RAGoal3 = RAGoal_ * RAGoal2_;
        disc_const_ = RAGoal3 * RB_const_ - RAGoal2_ * RB2_ + RAGoal_ * RB_const_ * XAGoal2_;
        disc_RC_coef_ = RAGoal3 - 3.0 * RAGoal2_ * RB_const_ + 2.0 * RAGoal_ * RB2_ 
                      + RAGoal_ * XAGoal2_ - RB_const_ * XAGoal2_;
        disc_RC2_coef_ = -RAGoal2_ + 2.0 * RAGoal_ * RB_const_ - RB2_;
    }
    
    // Get precomputed RAGoal, XAGoal
    void getRAGoal(double& RAGoal, double& XAGoal) const {
        RAGoal = RAGoal_;
        XAGoal = XAGoal_;
    }
    
    // Calculate ZC (RC and XC) from Output Sensor (Rpm, Xpm) using exact formula
    // Formula from Mathematica derivation:
    // ZC = ((((ZE || CD0) + VVC1) || CC1) + (ZLC || CC0)
    // where ZE = (Rpm + j*Xpm) + (RE0 + j*w*LE0)
    // Input: Rpm, Xpm (output sensor readings), VVC1_pF (current VVC1 capacitance)
    // Output: ZCFromOutput containing RC (real) and XC (imaginary) parts
    ZCFromOutput calculateZCFromOutput(double Rpm, double Xpm, double VVC1_pF) const {
        using namespace MatchingConst;
        
        ZCFromOutput result;
        double VVC1 = VVC1_pF * pF;
        
        // Step 1: ZE = (Rpm + j*Xpm) + (RE0 + j*w*LE0)
        // w*LE0 = omega * 15nH ≈ 1.278 ohm
        double wLE0 = w_ * LE0;
        double ZE_R = Rpm + RE0;
        double ZE_X = Xpm + wLE0;
        
        // Step 2: ZE || 1/(j*w*CD0)
        // 1/(j*w*CD0) = -j/(w*CD0), so real=0, imag = -1/(w*CD0)
        double XCD0 = -1.0 / (w_ * CD0);
        
        // Complex: ZE * (j*XCD0) = (ZE_R + j*ZE_X) * (j*XCD0)
        //        = j*ZE_R*XCD0 + j²*ZE_X*XCD0 = -ZE_X*XCD0 + j*ZE_R*XCD0
        double num_R = -ZE_X * XCD0;
        double num_X = ZE_R * XCD0;
        
        // Complex: ZE + (j*XCD0) = ZE_R + j*(ZE_X + XCD0)
        double den_R = ZE_R;
        double den_X = ZE_X + XCD0;
        
        // Complex division: num / den
        double den_mag2 = den_R * den_R + den_X * den_X;
        if (den_mag2 < 1e-30) {
            result.RC = Rpm;
            result.XC = Xpm;
            return result;
        }
        
        double ZE_CD0_R = (num_R * den_R + num_X * den_X) / den_mag2;
        double ZE_CD0_X = (num_X * den_R - num_R * den_X) / den_mag2;
        
        // Step 3: + 1/(j*w*VVC1) in series
        // 1/(j*w*VVC1) = -j/(w*VVC1)
        double XVVC1 = -1.0 / (w_ * VVC1);
        double ZD_R = ZE_CD0_R;
        double ZD_X = ZE_CD0_X + XVVC1;
        
        // Step 4: ZD || 1/(j*w*CC1)
        double XCC1 = -1.0 / (w_ * CC1);
        
        // ZD * (j*XCC1)
        double num2_R = -ZD_X * XCC1;
        double num2_X = ZD_R * XCC1;
        
        // ZD + (j*XCC1)
        double den2_R = ZD_R;
        double den2_X = ZD_X + XCC1;
        
        double den2_mag2 = den2_R * den2_R + den2_X * den2_X;
        if (den2_mag2 < 1e-30) {
            result.RC = Rpm;
            result.XC = Xpm;
            return result;
        }
        
        double ZD_CC1_R = (num2_R * den2_R + num2_X * den2_X) / den2_mag2;
        double ZD_CC1_X = (num2_X * den2_R - num2_R * den2_X) / den2_mag2;
        
        // Step 5: C circuit branch: (RC0 + j*w*LC0) || 1/(j*w*CC0)
        double ZLC_R = RC0;
        double ZLC_X = w_ * LC0;
        double XCC0 = -1.0 / (w_ * CC0);
        
        // ZLC * (j*XCC0)
        double num3_R = -ZLC_X * XCC0;
        double num3_X = ZLC_R * XCC0;
        
        // ZLC + (j*XCC0)
        double den3_R = ZLC_R;
        double den3_X = ZLC_X + XCC0;
        
        double den3_mag2 = den3_R * den3_R + den3_X * den3_X;
        if (den3_mag2 < 1e-30) {
            result.RC = Rpm;
            result.XC = Xpm;
            return result;
        }
        
        double ZC0_R = (num3_R * den3_R + num3_X * den3_X) / den3_mag2;
        double ZC0_X = (num3_X * den3_R - num3_R * den3_X) / den3_mag2;
        
        // Step 6: ZC = ZD_CC1 + ZC0 (series addition)
        result.RC = ZD_CC1_R + ZC0_R;
        result.XC = ZD_CC1_X + ZC0_X;
        
        return result;
    }
    
    // Calculate coefficients for RC from Output polynomial (advanced version)
    // These coefficients allow: RC = f(Rpm, Xpm) as a rational function
    void calculateRCFromOutputCoeffs(double VVC1_pF, RCFromOutputCoeffs& coeffs) const {
        using namespace MatchingConst;
        
        double VVC1 = VVC1_pF * pF;
        double VVC12 = VVC1 * VVC1;
        
        // These coefficients are derived from the reverse circuit analysis
        // Simplified version - for more accurate results, derive full expressions
        coeffs.N_const = 0.0;
        coeffs.N_Rpm = 1.0;  // First-order: RC ≈ Rpm (adjusted by circuit)
        coeffs.N_Rpm2 = 0.0;
        coeffs.N_Xpm = 0.0;
        coeffs.N_Xpm2 = 0.0;
        
        coeffs.D_const = 1.0;
        coeffs.D_Rpm = 0.0;
        coeffs.D_Rpm2 = 0.0;
        coeffs.D_Xpm = 0.0;
        coeffs.D_Xpm2 = 0.0;
    }
    
    // Calculate impedance at point A from measured impedance (Rm, Xm)
    // ZA = (Zm - jωLp) / (1 + jωCp(Zm - jωLp))
    // OPTIMIZED: Uses precomputed coefficients
    void calculateZA(double Rm, double Xm, double& RA, double& XA) const {
        double Rm2 = Rm * Rm;
        double Xm2 = Xm * Xm;
        
        double denom = denom_A_const_ + denom_A_Rm2_ * Rm2 
                     + denom_A_Xm_ * Xm + denom_A_Xm2_ * Xm2;
        
        RA = Rm / denom;
        XA = (XA_const_ + XA_Rm2_ * Rm2 + XA_Xm_ * Xm + XA_Xm2_ * Xm2) / denom;
    }
    
    // Calculate impedance at point B (VVC0 branch)
    // ZB = RB0 + jωLB0 + 1/(jωCB0) || 1/(jωVVC0)
    // OPTIMIZED: RB is constant, only XB needs VVC0
    void calculateZB(double VVC0_pF, double& RB, double& XB) const {
        using namespace MatchingConst;
        
        double VVC0 = VVC0_pF * pF;  // Convert to Farads
        
        RB = RB_const_;  // Completely constant!
        
        // XB = -(XB_numer_const + XB_numer_VVC0 * VVC0) / (VVC0 * XB_denom_factor)
        double numer = -(XB_numer_const_ + XB_numer_VVC0_ * VVC0);
        XB = numer / (VVC0 * XB_denom_factor_);
    }
    
    // Calculate impedance at point C (ZA || ZB parallel combination)
    // No optimization possible - depends on RA, XA, RB, XB runtime values
    void calculateZC(double RA, double XA, double RB, double XB, double& RC_out, double& XC_out) const {
        double RA2 = RA * RA;
        double RB2 = RB * RB;
        double XA2 = XA * XA;
        double XB2 = XB * XB;
        
        double denom = RA2 - 2.0*RA*RB + RB2 + XA2 - 2.0*XA*XB + XB2;
        
        if (fabs(denom) < 1e-12) {
            RC_out = RA;
            XC_out = XA;
            return;
        }
        
        RC_out = (-RA2*RB + RA*RB2 - RB*XA2 + RA*XB2) / denom;
        XC_out = (RB2*XA - RA2*XB - XA2*XB + XA*XB2) / denom;
    }
    
    // Calculate impedance at point D from point C
    // OPTIMIZED: Uses precomputed coefficients
    void calculateZD(double RC, double XC, double& RD, double& XD) const {
        double RC2 = RC * RC;
        double XC2 = XC * XC;
        
        double denom = D_const_ + D_RC2_ * RC2 + D_RC_ * RC + D_XC_ * XC + D_XC2_ * XC2;
        
        if (fabs(denom) < 1e-20) {
            RD = RC;
            XD = XC;
            return;
        }
        
        double RD_numer = RD_const_ + RD_RC_ * RC;
        double XD_numer = XD_const_ + XD_RC2_ * RC2 + XD_RC_ * RC + XD_XC_ * XC + XD_XC2_ * XC2;
        
        RD = RD_numer / denom;
        XD = XD_numer / denom;
    }
    
    // Calculate impedance at point E from point D
    // ZE = (ZD || 1/(jωCD0)) in series with 1/(jωVVC1)
    // Mathematica formula:
    // denomE = CD0² + 2*CD0*VVC1 + VVC1² + CD0²*RD²*VVC1²*w² 
    //        + 2*CD0²*VVC1*w*XD + 2*CD0*VVC1²*w*XD + CD0²*VVC1²*w²*XD²
    // RE = RD*VVC1² / denomE
    // XE = (CD0 + VVC1 + CD0*RD²*VVC1²*w² + 2*CD0*VVC1*w*XD 
    //      + VVC1²*w*XD + CD0*VVC1²*w²*XD²) / (w * denomE)
    void calculateZE(double RD, double XD, double VVC1_pF, double& RE, double& XE) const {
        using namespace MatchingConst;
        
        double VVC1 = VVC1_pF * pF;  // Convert to Farads
        double VVC12 = VVC1 * VVC1;
        double RD2 = RD * RD;
        double XD2 = XD * XD;
        
        // denomE = CD0² + 2*CD0*VVC1 + VVC1² 
        //        + CD0²*RD²*VVC1²*w² 
        //        + 2*CD0²*VVC1*w*XD 
        //        + 2*CD0*VVC1²*w*XD 
        //        + CD0²*VVC1²*w²*XD²
        double denomE = E_CD02_ + E_2CD0_ * VVC1 + VVC12
                      + E_CD02_w2_ * RD2 * VVC12
                      + E_2CD02_w_ * VVC1 * XD
                      + E_2CD0_w_ * VVC12 * XD
                      + E_CD02_w2_ * VVC12 * XD2;
        
        if (fabs(denomE) < 1e-30) {
            RE = RD;
            XE = XD;
            return;
        }
        
        // RE = RD * VVC1² / denomE
        RE = RD * VVC12 / denomE;
        
        // XE numerator = CD0 + VVC1 + CD0*RD²*VVC1²*w² + 2*CD0*VVC1*w*XD 
        //              + VVC1²*w*XD + CD0*VVC1²*w²*XD²
        double XE_numer = E_CD0_ + VVC1 
                        + E_CD0_w_ * w_ * RD2 * VVC12
                        + E_2CD0_w_ * VVC1 * XD
                        + VVC12 * w_ * XD
                        + E_CD0_w_ * w_ * VVC12 * XD2;
        
        XE = XE_numer / (w_ * denomE);
    }
    
    // Calculate plasma impedance (Zp) from point E
    // Simplified: Rp = RE - RE0, Xp = XE - w*LE0
    void calculateZP(double RE, double XE, double& Rp, double& Xp) const {
        Rp = RE - RE0_;
        Xp = XE - LE0_w_;
    }
    
    // Calculate all impedance points from measured impedance and VVC values
    ImpedancePoints calculateImpedances(double Rm, double Xm, double VVC0_pF, double VVC1_pF) {
        ImpedancePoints pts;
        
        calculateZA(Rm, Xm, pts.RA, pts.XA);
        calculateZB(VVC0_pF, pts.RB, pts.XB);
        calculateZC(pts.RA, pts.XA, pts.RB, pts.XB, pts.RC, pts.XC);
        calculateZD(pts.RC, pts.XC, pts.RD, pts.XD);
        calculateZE(pts.RD, pts.XD, VVC1_pF, pts.RE, pts.XE);
        calculateZP(pts.RE, pts.XE, pts.Rp, pts.Xp);
        
        return pts;
    }
    
    // Calculate matching goals (target VVC values for 50Ω matching)
    // OPTIMIZED: Uses precomputed RAGoal², XAGoal², RB², and coefficients
    // Extended: Supports Output Sensor (Rpm, Xpm) for RC calculation when VSWR is high
    MatchingGoals calculateMatchingGoals(double Rm, double Xm, 
                                          double VVC0_pF, double VVC1_pF,
                                          MotorController* m0 = nullptr, 
                                          MotorController* m1 = nullptr,
                                          double Rpm = 0.0, double Xpm = 0.0,
                                          bool useOutputForRC = false) {
        using namespace MatchingConst;
        
        MatchingGoals goals;
        goals.valid0 = false;
        goals.valid1 = false;
        goals.RAGoal = RAGoal_;
        goals.XAGoal = XAGoal_;
        
        // Calculate current impedances
        ImpedancePoints pts = calculateImpedances(Rm, Xm, VVC0_pF, VVC1_pF);
        
        // Runtime variables
        double RC = pts.RC;
        double XC = pts.XC;
        double XD = pts.XD;
        
        // If VSWR is high and output sensor data is available, use output-based RC/XC calculation
        if (useOutputForRC && (Rpm != 0.0 || Xpm != 0.0)) {
            ZCFromOutput zcOut = calculateZCFromOutput(Rpm, Xpm, VVC1_pF);
            RC = zcOut.RC;
            XC = zcOut.XC;
            // Recalculate XD using output-based RC, XC
            double RD_out, XD_out;
            calculateZD(RC, XC, RD_out, XD_out);
            XD = XD_out;
        }
        double XB = pts.XB;
        double RC2 = RC * RC;
        
        // Store debug values
        goals.RC_calculated = RC;
        goals.XC_calculated = XC;
        goals.XD_calculated = XD;
        
        // =====================================================
        // XBGoal calculation using precomputed discriminant coefficients
        // discriminant = 4 * (disc_const_ + disc_RC_coef_ * RC + disc_RC2_coef_ * RC²)
        // =====================================================
        double discriminant = 4.0 * (disc_const_ + disc_RC_coef_ * RC + disc_RC2_coef_ * RC2);
        
        if (discriminant < 0) {
            goals.XBGoal0 = 0.0;
            goals.XBGoal1 = 0.0;
            goals.VVC0Goal0 = 0.0;
            goals.VVC0Goal1 = 0.0;
            goals.VVC1Goal0 = 0.0;
            goals.VVC1Goal1 = 0.0;
            goals.step0Goal0 = 0;
            goals.step0Goal1 = 0;
            goals.step1Goal0 = 0;
            goals.step1Goal1 = 0;
            return goals;
        }
        
        double sqrtD = sqrt(discriminant);
        double denom_XB = 2.0 * (RAGoal_ - RC);
        
        if (fabs(denom_XB) < 1e-12) {
            goals.XBGoal0 = 0.0;
            goals.XBGoal1 = 0.0;
        } else {
            goals.XBGoal0 = (-2.0 * RC * XAGoal_ - sqrtD) / denom_XB;
            goals.XBGoal1 = (-2.0 * RC * XAGoal_ + sqrtD) / denom_XB;
        }
        
        // =====================================================
        // VVC0Goal calculation
        // =====================================================
        double VVC0 = VVC0_pF * pF;
        double VVC1 = VVC1_pF * pF;
        
        double denom0_VVC0 = 1.0 + VVC0 * w_ * XB - VVC0 * w_ * goals.XBGoal0;
        double denom1_VVC0 = 1.0 + VVC0 * w_ * XB - VVC0 * w_ * goals.XBGoal1;
        
        if (fabs(denom0_VVC0) > 1e-20) {
            goals.VVC0Goal0 = (VVC0 / denom0_VVC0) / pF;
            goals.valid0 = (goals.VVC0Goal0 > 0);
        } else {
            goals.VVC0Goal0 = 0.0;
        }
        
        if (fabs(denom1_VVC0) > 1e-20) {
            goals.VVC0Goal1 = (VVC0 / denom1_VVC0) / pF;
            goals.valid1 = (goals.VVC0Goal1 > 0);
        } else {
            goals.VVC0Goal1 = 0.0;
        }
        
        // =====================================================
        // XCGoal calculation using precomputed discriminant coefficients
        // XCGoal = (-RB*XAGoal ± sqrt(discriminant/4)) / (RAGoal - RB)
        // =====================================================
        double denom_XC = RAGoal_ - RB_const_;
        double XCGoal0 = 0.0, XCGoal1 = 0.0;
        
        if (fabs(denom_XC) > 1e-12) {
            double sqrtD_XC = sqrtD / 2.0;  // sqrt(disc/4) = sqrt(disc)/2
            XCGoal0 = (-RB_const_ * XAGoal_ + sqrtD_XC) / denom_XC;
            XCGoal1 = (-RB_const_ * XAGoal_ - sqrtD_XC) / denom_XC;
        }
        
        // =====================================================
        // XDGoal calculation using precomputed D coefficients
        // =====================================================
        auto calcXDFromXC = [this, RC, RC2](double XC_in) -> double {
            double XC2_in = XC_in * XC_in;
            
            double denom = D_const_ + D_RC2_ * RC2 + D_RC_ * RC + D_XC_ * XC_in + D_XC2_ * XC2_in;
            double XD_numer = XD_const_ + XD_RC2_ * RC2 + XD_RC_ * RC + XD_XC_ * XC_in + XD_XC2_ * XC2_in;
            
            if (fabs(denom) < 1e-20) return XC_in;
            return XD_numer / denom;
        };
        
        goals.XDGoal0 = calcXDFromXC(XCGoal0);
        goals.XDGoal1 = calcXDFromXC(XCGoal1);
        
        // =====================================================
        // VVC1Goal calculation
        // =====================================================
        double denom0_VVC1 = 1.0 + VVC1 * w_ * XD - VVC1 * w_ * goals.XDGoal0;
        double denom1_VVC1 = 1.0 + VVC1 * w_ * XD - VVC1 * w_ * goals.XDGoal1;
        
        if (fabs(denom0_VVC1) > 1e-20) {
            goals.VVC1Goal0 = (VVC1 / denom0_VVC1) / pF;
            if (goals.VVC1Goal0 < 0) goals.valid0 = false;
        } else {
            goals.VVC1Goal0 = 0.0;
            goals.valid0 = false;
        }
        
        if (fabs(denom1_VVC1) > 1e-20) {
            goals.VVC1Goal1 = (VVC1 / denom1_VVC1) / pF;
            if (goals.VVC1Goal1 < 0) goals.valid1 = false;
        } else {
            goals.VVC1Goal1 = 0.0;
            goals.valid1 = false;
        }
        
        // Convert capacitance to motor steps
        if (m0 != nullptr) {
            goals.step0Goal0 = m0->getPositionFromCap((int32_t)(goals.VVC0Goal0 * 100.0));
            goals.step0Goal1 = m0->getPositionFromCap((int32_t)(goals.VVC0Goal1 * 100.0));
        } else {
            goals.step0Goal0 = 0;
            goals.step0Goal1 = 0;
        }
        
        if (m1 != nullptr) {
            goals.step1Goal0 = m1->getPositionFromCap((int32_t)(goals.VVC1Goal0 * 100.0));
            goals.step1Goal1 = m1->getPositionFromCap((int32_t)(goals.VVC1Goal1 * 100.0));
        } else {
            goals.step1Goal0 = 0;
            goals.step1Goal1 = 0;
        }
        
        return goals;
    }

private:
    // =====================================================
    // Precomputed constants (calculated once in constructor)
    // =====================================================
    
    // Frequency powers
    double w_, w2_, w3_, w4_, w5_, w6_;
    
    // ZA coefficients (M→A transformation)
    double denom_A_const_, denom_A_Rm2_, denom_A_Xm_, denom_A_Xm2_;
    double XA_const_, XA_Rm2_, XA_Xm_, XA_Xm2_;
    
    // ZB coefficients (VVC0 branch)
    double denomB_const_;
    double RB_const_;           // RB is completely constant!
    double XB_numer_const_, XB_numer_VVC0_, XB_denom_factor_;
    
    // ZE coefficients (D→E transformation)
    double E_CD0_;              // CD0
    double E_CD02_;             // CD0²
    double E_2CD0_;             // 2*CD0
    double E_CD0_w_;            // CD0*w
    double E_2CD0_w_;           // 2*CD0*w
    double E_CD02_w_;           // CD0²*w
    double E_2CD02_w_;          // 2*CD0²*w
    double E_CD02_w2_;          // CD0²*w²
    
    // ZP coefficients (E→Plasma)
    double RE0_;                // RE0 constant
    double LE0_w_;              // LE0*w (precomputed)
    
    // ZD coefficients (C→D transformation)
    double D_const_, D_RC2_, D_RC_, D_XC_, D_XC2_;
    double RD_const_, RD_RC_;
    double XD_const_, XD_RC2_, XD_RC_, XD_XC_, XD_XC2_;
    
    // Matching goal constants
    double RAGoal_, XAGoal_;
    double RAGoal2_, XAGoal2_;  // Squared values
    double RB2_;                // RB² (RB is constant)
    
    // Discriminant coefficients (XCGoal base, XBGoal = 4x)
    double disc_const_, disc_RC_coef_, disc_RC2_coef_;
};
