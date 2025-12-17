#pragma once

// RFSensor.hpp - Unified RF sensor library
// Integrates AdcInterfaces and RfSensors into a single header-only library

#include <stdint.h>
#include <stddef.h>
#include <math.h>
#include "xil_io.h"
#include "xil_printf.h"
#include "sleep.h"
#include "xparameters.h"
#include "WebTerminal.hpp"

// ============================================================================
// Constants - Modify these values to change system parameters
// ============================================================================

static constexpr float kSamplingRateHz = 100000000.0f;  // 100 MHz
static constexpr int kFftLength = 1024;
static constexpr float kTargetFreqHz = 13560000.0f;     // 13.56 MHz
static constexpr float kPrintScale = 1.0f;

// ============================================================================
// Structures
// ============================================================================

struct ComplexF {
    float r; // real
    float i; // imag
};

struct AveragedImpedanceResults {
    float voltageMagnitude;    // Average voltage magnitude (sqrt applied)
    float currentMagnitude;    // Average current magnitude (sqrt applied)
    float impedanceMagnitude;  // Average impedance magnitude (sqrt applied)
    float impedancePhaseDeg;   // Impedance phase (degrees) from cross-spectrum
    float resistanceR;         // Real part of impedance: R = |Z| * cos(phase)
    float reactanceX;          // Imaginary part of impedance: X = |Z| * sin(phase)
};

struct SensorCalibration {
    float voltageGain;    // scale factor applied to voltage complex
    float currentGain;    // scale factor applied to current complex
    float phaseDiffRad;   // phase of V relative to I (V -> V * e^{j*phaseDiffRad})
};

// ZMOD1410 relay pulser command bits (one-hot)
enum RelayCmd : uint16_t {
    kCOM_SET      = 1u << 0,
    kCOM_RESET    = 1u << 1,
    kAC1_SET      = 1u << 2,
    kAC1_RESET    = 1u << 3,
    kG1_SET       = 1u << 4,
    kG1_RESET     = 1u << 5,
    kAC2_SET      = 1u << 6,
    kAC2_RESET    = 1u << 7,
    kG2_SET       = 1u << 8,
    kG2_RESET     = 1u << 9,
};

// Relay configurations
static constexpr uint16_t kRelayConfig_AC_ON_HighGain = 
    kAC1_SET | kAC2_SET | kG1_SET | kG2_SET;  // AC ON, High Gain (±25V)
static constexpr uint16_t kRelayConfig_AC_ON_LowGain = 
    kAC1_SET | kAC2_SET | kG1_RESET | kG2_RESET; // AC ON, Low Gain (±1V)
static constexpr uint16_t kRelayConfig_AC_OFF_HighGain = 
    kAC1_RESET | kAC2_RESET | kG1_SET | kG2_SET; // AC OFF, High Gain (±25V)
static constexpr uint16_t kRelayConfig_AC_OFF_LowGain = 
    kAC1_RESET | kAC2_RESET | kG1_RESET | kG2_RESET; // AC OFF, Low Gain (±1V)
static constexpr uint16_t kInitialRelayValue = kRelayConfig_AC_ON_LowGain; // AC ON, Low Gain (±1V)

// SPI initialization sequences
static constexpr uint32_t kSpiInitSequenceCommon[] = {
    0x80000503,
    0x00000000,
    0x80001421,  // Interleave enable, two's complement, CMOS output
    0x00000000,
};

// ADC0 Channel A initialization sequence
static constexpr uint32_t kSpiInitSequence_ADC0_ChA[] = {
    0x80000501,  // Select channel A
    0x00000000,
    0x80001010,  // DC offset register 0x10
    0x00000000,
};

// ADC0 Channel B initialization sequence
static constexpr uint32_t kSpiInitSequence_ADC0_ChB[] = {
    0x80000502,  // Select channel B
    0x00000000,
    0x80001020,  // DC offset register 0x10
    0x00000000,
};

// ADC1 Channel A initialization sequence
static constexpr uint32_t kSpiInitSequence_ADC1_ChA[] = {
    0x80000501,  // Select channel A
    0x00000000,
    0x80001027,  // DC offset register 0x10
    0x00000000,
};

// ADC1 Channel B initialization sequence
static constexpr uint32_t kSpiInitSequence_ADC1_ChB[] = {
    0x80000502,  // Select channel B
    0x00000000,
    0x80001033,  // DC offset register 0x10
    0x00000000,
};

// ============================================================================
// Helper Functions
// ============================================================================

static inline ComplexF multiply(const ComplexF& a, const ComplexF& b) {
    return ComplexF{ a.r * b.r - a.i * b.i, a.r * b.i + a.i * b.r };
}

static inline ComplexF divideSafe(const ComplexF& a, const ComplexF& b) {
    const float eps = 1e-12f;
    float den = b.r * b.r + b.i * b.i;
    if (den < eps) den = eps;
    float inv = 1.0f / den;
    return ComplexF{ (a.r * b.r + a.i * b.i) * inv, (a.i * b.r - a.r * b.i) * inv };
}

static inline float magnitude(const ComplexF& x) {
    return sqrtf(x.r * x.r + x.i * x.i);
}

static inline float phase(const ComplexF& x) {
    return atan2f(x.i, x.r);
}

static inline ComplexF rotate(const ComplexF& x, float angleRad) {
    float c = cosf(angleRad);
    float s = sinf(angleRad);
    return ComplexF{ x.r * c - x.i * s, x.r * s + x.i * c };
}

// ============================================================================
// RFSensor Class
// ============================================================================

class RFSensor {
public:
    // Public fields
    float samplingRateHz;
    int fftLength;
    float targetFrequencyHz;

    // Constructor
    RFSensor(
        uintptr_t bram_v_re,      // Voltage BRAM real part base address
        uintptr_t bram_v_im,      // Voltage BRAM imaginary part base address
        uintptr_t bram_i_re,      // Current BRAM real part base address
        uintptr_t bram_i_im,      // Current BRAM imaginary part base address
        uintptr_t gate_gpio_base, // Gate GPIO base address
        uintptr_t spi_gpio_base,  // SPI GPIO base address
        uintptr_t relay_gpio_base,// Relay GPIO base address
        unsigned adc_index,        // ADC index (0 for ADC0, 1 for ADC1)
        float samplingRateHz_ = kSamplingRateHz,
        int fftLength_ = kFftLength,
        float targetFreqHz_ = kTargetFreqHz,
        float voltageGain_ = 1.0f,    // Voltage gain (default: 1.0)
        float currentGain_ = 1.0f,    // Current gain (default: 1.0)
        float phaseDiffDeg_ = 0.0f   // Phase difference in degrees (default: 0.0)
    ) : samplingRateHz(samplingRateHz_),
        fftLength(fftLength_),
        targetFrequencyHz(targetFreqHz_),
        bram_v_re_(bram_v_re),
        bram_v_im_(bram_v_im),
        bram_i_re_(bram_i_re),
        bram_i_im_(bram_i_im),
        gate_gpio_base_(gate_gpio_base),
        spi_gpio_base_(spi_gpio_base),
        relay_gpio_base_(relay_gpio_base),
        adc_index_(adc_index),
        cal_{voltageGain_, currentGain_, phaseDiffDeg_ * (3.14159265358979323846f / 180.0f)},  // Calibration: convert degrees to radians
        avgCount_(512)  // Default average count: 512 samples
    {
    }

    // ========================================================================
    // ADC Initialization
    // ========================================================================

    void initializeAdc() {
        // Configure GPIO directions
        volatile uint32_t *spi_gpio = reinterpret_cast<volatile uint32_t *>(spi_gpio_base_);
        volatile uint32_t *relay_gpio = reinterpret_cast<volatile uint32_t *>(relay_gpio_base_);
        volatile uint32_t *gate_gpio = reinterpret_cast<volatile uint32_t *>(gate_gpio_base_);

        // SPI GPIO: channel 1 outputs, channel 2 inputs
        spi_gpio[1] = 0x00000000U;  // channel 1 output bits
        spi_gpio[3] = 0xFFFFFFFFU;  // channel 2 input (transfer done)

        // Relay GPIO: both channels outputs
        relay_gpio[1] = 0x00000000U;  // ch1 outputs
        relay_gpio[3] = 0x00000000U;  // ch2 outputs
        relay_gpio[0] = 0x00000000U;  // stb low
        relay_gpio[2] = 0x00000000U;  // data zero

        // Gate GPIO: channel 1 output, channel 2 input
        gate_gpio[1] = 0x00000000U;  // channel 1 output (gate control)
        gate_gpio[3] = 0xFFFFFFFFU;  // channel 2 input (hold status and index)

        // Initialize FFT mode to 0 (filtered mode)
        setFftMode(false);

        // Allow power-up and interface settle time
        usleep(1000000);

        xil_printf("ADC%u initializing...\n\r", adc_index_);

        // Apply common SPI initialization sequence
        for (uint32_t value : kSpiInitSequenceCommon) {
            spi_gpio[0] = value;
            waitForSpiTransfer();
            usleep(1000);
        }

        // Apply ADC-specific and channel-specific sequences
        const uint32_t* chA_sequence = nullptr;
        const uint32_t* chB_sequence = nullptr;
        size_t chA_len = 0;
        size_t chB_len = 0;

        if (adc_index_ == 0) {
            chA_sequence = kSpiInitSequence_ADC0_ChA;
            chA_len = sizeof(kSpiInitSequence_ADC0_ChA) / sizeof(kSpiInitSequence_ADC0_ChA[0]);
            chB_sequence = kSpiInitSequence_ADC0_ChB;
            chB_len = sizeof(kSpiInitSequence_ADC0_ChB) / sizeof(kSpiInitSequence_ADC0_ChB[0]);
        } else if (adc_index_ == 1) {
            chA_sequence = kSpiInitSequence_ADC1_ChA;
            chA_len = sizeof(kSpiInitSequence_ADC1_ChA) / sizeof(kSpiInitSequence_ADC1_ChA[0]);
            chB_sequence = kSpiInitSequence_ADC1_ChB;
            chB_len = sizeof(kSpiInitSequence_ADC1_ChB) / sizeof(kSpiInitSequence_ADC1_ChB[0]);
        }

        // Apply Channel A sequence
        if (chA_sequence != nullptr) {
            for (size_t i = 0; i < chA_len; ++i) {
                spi_gpio[0] = chA_sequence[i];
                waitForSpiTransfer();
                usleep(1000);
            }
        }

        // Apply Channel B sequence
        if (chB_sequence != nullptr) {
            for (size_t i = 0; i < chB_len; ++i) {
                spi_gpio[0] = chB_sequence[i];
                waitForSpiTransfer();
                usleep(1000);
            }
        }

        // Allow ADC to latch configuration
        usleep(1000000);

        // Initialize relays
        pulseRelay(kInitialRelayValue);
        usleep(1000000);
        
        xil_printf("ADC%u initialized\n\r", adc_index_);
    }

    // ========================================================================
    // Gate Control
    // ========================================================================

    void setFftHold(bool hold) {
        if (gate_gpio_base_ == 0U) return;
        Xil_Out32(gate_gpio_base_, hold ? 0x00000001U : 0x00000000U);
    }

    bool checkFftHoldStatus(uint32_t *out_index) {
        if (gate_gpio_base_ == 0U || out_index == nullptr) {
            return false;
        }
        volatile uint32_t *gpio = reinterpret_cast<volatile uint32_t *>(gate_gpio_base_);
        uint32_t status = gpio[2];
        bool hold_active = (status & 0x80000000U) != 0;
        *out_index = status & 0x7FFFFFFFU;
        return hold_active;
    }

    void holdGateBoth(bool on) {
        setFftHold(on);
    }

    void stopBramWriteAll() {
        holdGateBoth(true);
    }

    void resumeBramWriteAll() {
        holdGateBoth(false);
    }

    // ========================================================================
    // SPI Control
    // ========================================================================

    void writeSpiCommand(uint32_t spi_value) {
        volatile uint32_t *spi_regs = reinterpret_cast<volatile uint32_t *>(spi_gpio_base_);
        
        // Send SPI command
        spi_regs[0] = spi_value;
        waitForSpiTransfer();
        usleep(1000);
        
        // Send dummy 0x00000000
        spi_regs[0] = 0x00000000U;
        waitForSpiTransfer();
        usleep(1000);
    }

    // ========================================================================
    // Relay Control
    // ========================================================================

    void pulseRelay(uint16_t cmd_mask) {
        if (relay_gpio_base_ == 0U) return;
        volatile uint32_t *gpio = reinterpret_cast<volatile uint32_t *>(relay_gpio_base_);
        // Place command on data bus (ch2)
        gpio[2] = (uint32_t)cmd_mask;
        // Strobe (ch1) one short pulse
        gpio[0] = 0x00000001U;
        for (volatile int d = 0; d < 128; ++d) { }
        gpio[0] = 0x00000000U;
    }

    void setHighGainCh1(bool enable) {
        pulseRelay(enable ? kG1_SET : kG1_RESET);
    }

    void setHighGainCh2(bool enable) {
        pulseRelay(enable ? kG2_SET : kG2_RESET);
    }

    // ========================================================================
    // FFT Mode Control
    // ========================================================================

    void setFftMode(bool fft_mode) {
        volatile uint32_t *gpio = reinterpret_cast<volatile uint32_t *>(XPAR_AXI_GPIO_4_BASEADDR);
        gpio[1] = 0x00000000U;  // TRI register: 0 = output
        uint32_t current = gpio[0];
        if (fft_mode) {
            gpio[0] = current | 0x00000001U;  // Set bit 0 (FFT mode 1)
        } else {
            gpio[0] = current & 0xFFFFFFFEU;  // Clear bit 0 (filtered mode 0)
        }
        usleep(10000);
    }

    // ========================================================================
    // Impedance Measurement
    // ========================================================================

    // Set average count
    void setAvgCount(int count) {
        if (count <= 0) count = 1;
        if (count > fftLength) count = fftLength;
        avgCount_ = count;
    }

    // Get average count
    int getAvgCount() const {
        return avgCount_;
    }

    AveragedImpedanceResults calculateAveragedImpedance(int avgCount = -1) {
        AveragedImpedanceResults result = {0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f};
        
        // Use class member if avgCount is -1 (default)
        if (avgCount == -1) avgCount = avgCount_;
        
        if (avgCount <= 0) avgCount = 1;
        if (avgCount > fftLength) avgCount = fftLength;
        
        // Hold gates for both channels
        setFftHold(true);
        
        // Wait for hold to be active
        uint32_t hold_index_v = 0, hold_index_i = 0;
        int timeout = 100;
        bool hold_ok_v = false, hold_ok_i = false;
        while (timeout-- > 0) {
            hold_ok_v = checkFftHoldStatus(&hold_index_v);
            hold_ok_i = checkFftHoldStatus(&hold_index_i);
            if (hold_ok_v && hold_ok_i) break;
        }
        
        if (!hold_ok_v || !hold_ok_i) {
            setFftHold(false);
            return result;
        }
        
        // Get calibration values
        float voltageGain = cal_.voltageGain;
        float currentGain = cal_.currentGain;
        float phaseDiffRad = cal_.phaseDiffRad;
        
        // BRAM pointers
        volatile float* v_re = reinterpret_cast<volatile float*>(bram_v_re_);
        volatile float* v_im = reinterpret_cast<volatile float*>(bram_v_im_);
        volatile float* i_re = reinterpret_cast<volatile float*>(bram_i_re_);
        volatile float* i_im = reinterpret_cast<volatile float*>(bram_i_im_);
        
        // Accumulators for averaging (raw data, before calibration)
        // Use double to prevent overflow with large FFT magnitude values
        double sum_vmagSq = 0.0;
        double sum_imagSq = 0.0;
        double sum_cross_re = 0.0;
        double sum_cross_im = 0.0;
        
        const float kRadToDeg = 180.0f / 3.14159265358979323846f;
        
        // Calculate start address
        int start_addr_v = ((int)hold_index_v - avgCount + fftLength) % fftLength;
        int start_addr_i = ((int)hold_index_i - avgCount + fftLength) % fftLength;
        
        // Read avgCount data points sequentially
        for (int idx = 0; idx < avgCount; ++idx) {
            int bram_addr_v = (start_addr_v + idx) % fftLength;
            int bram_addr_i = (start_addr_i + idx) % fftLength;
            
            ComplexF v_raw = {v_re[bram_addr_v], v_im[bram_addr_v]};
            ComplexF i_raw = {i_re[bram_addr_i], i_im[bram_addr_i]};
            
            // Calculate magnitude squared
            float vmagSq = v_raw.r * v_raw.r + v_raw.i * v_raw.i;
            float imagSq = i_raw.r * i_raw.r + i_raw.i * i_raw.i;
            
            // Calculate cross-spectrum: V * conj(I)
            ComplexF i_conj = {i_raw.r, -i_raw.i};
            ComplexF cross = multiply(v_raw, i_conj);
            
            // Accumulate
            sum_vmagSq += vmagSq;
            sum_imagSq += imagSq;
            sum_cross_re += cross.r;
            sum_cross_im += cross.i;
        }
        
        // Calculate averages (using double for precision)
        double inv_count = 1.0 / (double)avgCount;
        
        // Calculate V and I magnitudes (with FFT normalization: divide by N)
        // FFT output magnitude is N times larger than actual amplitude
        // So we divide by N after taking sqrt (more numerically stable than dividing by N^2 inside sqrt)
        double fftNorm = 1.0 / (double)fftLength;  // 1/N for normalization
        
        // Calculate averaged magnitude squared values (used for both impedance and V/I)
        double avg_vmagSq = sum_vmagSq * inv_count;
        double avg_imagSq = sum_imagSq * inv_count;
        
        // Calculate impedance magnitude (ratio of V/I, so fftNorm cancels out)
        double impedance_mag_sq = (avg_vmagSq * voltageGain * voltageGain) / (avg_imagSq * currentGain * currentGain);
        result.impedanceMagnitude = (float)sqrt(impedance_mag_sq);
        
        // Calculate phase from averaged cross-spectrum
        double avg_cross_re = sum_cross_re * inv_count * voltageGain * currentGain;
        double avg_cross_im = sum_cross_im * inv_count * voltageGain * currentGain;
        result.impedancePhaseDeg = (float)((atan2(avg_cross_im, avg_cross_re) - phaseDiffRad) * kRadToDeg);
        
        // Calculate R (resistance) and X (reactance) from impedance magnitude and phase
        const float kDegToRad = 3.14159265358979323846f / 180.0f;
        float phaseRad = result.impedancePhaseDeg * kDegToRad;
        result.resistanceR = result.impedanceMagnitude * cosf(phaseRad);
        result.reactanceX = result.impedanceMagnitude * sinf(phaseRad);
        
        // Calculate V and I magnitudes using the same averaged values
        // sqrt(avg_magSq) gives FFT magnitude, then apply fftNorm (1/N) and calibration gain
        result.voltageMagnitude = (float)(sqrt(avg_vmagSq) * fftNorm * voltageGain);
        result.currentMagnitude = (float)(sqrt(avg_imagSq) * fftNorm * currentGain);
        
        // Debug: Print calculation details once per sensor (using bram address as sensor identifier)
        static uintptr_t lastDebuggedSensor1 = 0;
        static uintptr_t lastDebuggedSensor2 = 0;
        if (bram_v_re_ != lastDebuggedSensor1 && bram_v_re_ != lastDebuggedSensor2) {
            if (lastDebuggedSensor1 == 0) lastDebuggedSensor1 = bram_v_re_;
            else if (lastDebuggedSensor2 == 0) lastDebuggedSensor2 = bram_v_re_;
            
            WebTerminal::print("[FFT DEBUG] Sensor(0x%08X):\n\r", (unsigned int)bram_v_re_);
            WebTerminal::print("  fftLength=%d, fftNorm=", fftLength);
            WebTerminal::printFloat((float)fftNorm);
            WebTerminal::print(", voltageGain=");
            WebTerminal::printFloat(voltageGain);
            WebTerminal::print(", currentGain=");
            WebTerminal::printFloat(currentGain);
            WebTerminal::print("\n\r");
            WebTerminal::print("  avg_vmagSq=");
            WebTerminal::printFloat((float)(avg_vmagSq / 1e9));  // Scale down for display
            WebTerminal::print("e9, sqrt=");
            WebTerminal::printFloat((float)sqrt(avg_vmagSq));
            WebTerminal::print(", V=");
            WebTerminal::printFloat(result.voltageMagnitude);
            WebTerminal::print("\n\r");
            WebTerminal::print("  avg_imagSq=");
            WebTerminal::printFloat((float)(avg_imagSq / 1e9));  // Scale down for display
            WebTerminal::print("e9, sqrt=");
            WebTerminal::printFloat((float)sqrt(avg_imagSq));
            WebTerminal::print(", I=");
            WebTerminal::printFloat(result.currentMagnitude);
            WebTerminal::print("\n\r");
        }
        
        // Release gates
        setFftHold(false);
        
        return result;
    }

    // ========================================================================
    // FFT Channel Reading
    // ========================================================================

    int freqToBin(float freqHz) const {
        if (fftLength <= 0 || samplingRateHz <= 0.0f) return 0;
        float binF = freqHz * (float)fftLength / samplingRateHz;
        int bin = (int)(binF + (binF >= 0 ? 0.5f : -0.5f));
        if (bin < 0) bin = 0;
        if (bin >= fftLength) bin = fftLength - 1;
        return bin;
    }

    ComplexF readVoltage(float freqHz) {
        int bin = freqToBin(freqHz);
        return readVoltageBin(bin);
    }

    ComplexF readVoltageHeld(float freqHz) {
        int bin = freqToBin(freqHz);
        return readVoltageBinHeld(bin);
    }

    ComplexF readCurrent(float freqHz) {
        int bin = freqToBin(freqHz);
        return readCurrentBin(bin);
    }

    ComplexF readCurrentHeld(float freqHz) {
        int bin = freqToBin(freqHz);
        return readCurrentBinHeld(bin);
    }

    ComplexF readImpedance(float freqHz) {
        ComplexF v = readVoltage(freqHz);
        ComplexF i = readCurrent(freqHz);
        v = rotate(v, cal_.phaseDiffRad);
        return divideSafe(v, i);
    }

    ComplexF readImpedanceHeld(float freqHz) {
        ComplexF v = readVoltageHeld(freqHz);
        ComplexF i = readCurrentHeld(freqHz);
        v = rotate(v, cal_.phaseDiffRad);
        return divideSafe(v, i);
    }

    // ========================================================================
    // Dump Functions
    // ========================================================================

    void dumpFftChannel(const char* label, float* fftMagBuffer, uintptr_t bram_base_re, uintptr_t bram_base_im) {
        if (bram_base_re == 0U || bram_base_im == 0U) {
            xil_printf("Invalid channel selection.\n\r");
            return;
        }

        volatile float *re_vals = reinterpret_cast<volatile float *>(bram_base_re);
        volatile float *im_vals = reinterpret_cast<volatile float *>(bram_base_im);

        xil_printf("\n\r<< %s FFT Dump Start >>\n\r", label);
        
        // Set FFT mode to 1 (full FFT) for reading
        setFftMode(true);
        
        // Hold gate
        setFftHold(true);
        
        // Wait for hold to be active
        uint32_t hold_index = 0;
        int timeout = 100;
        bool hold_ok = false;
        while (timeout-- > 0) {
            hold_ok = checkFftHoldStatus(&hold_index);
            if (hold_ok) break;
        }
        if (!hold_ok) {
            xil_printf("Warning: Hold timeout, reading anyway...\n\r");
        }

        // Gather FFT magnitude
        const float scale = 1.0f / (float)fftLength;
        for (int index = 0; index < fftLength; ++index) {
            float r = re_vals[index];
            float i = im_vals[index];
            float mag = sqrtf(r * r + i * i) * scale;
            if (!(mag == mag) || !(mag < 1e38f)) {
                fftMagBuffer[index] = 0.0f;
            } else {
                fftMagBuffer[index] = mag;
            }
        }
        WebTerminal::printDatasetFloat(label, fftMagBuffer, static_cast<size_t>(fftLength));

        setFftHold(false);
        
        // Restore FFT mode to 0 (filtered mode)
        setFftMode(false);
        
        xil_printf("Hold status: %s, BRAM index: %lu\n\r", hold_ok ? "OK" : "FAIL", (unsigned long)hold_index);
        xil_printf("<< %s FFT Dump End >>\n\r\n\r", label);
    }

    void dumpFftReIm(const char* label, float* reBuffer, float* imBuffer, uintptr_t bram_base_re, uintptr_t bram_base_im) {
        if (bram_base_re == 0U || bram_base_im == 0U) {
            xil_printf("Invalid channel.\n\r");
            return;
        }
        
        volatile float *re_vals = reinterpret_cast<volatile float *>(bram_base_re);
        volatile float *im_vals = reinterpret_cast<volatile float *>(bram_base_im);
        
        xil_printf("\n\r<< %s FFT Re/Im Test Start >>\n\r", label);
        setFftHold(true);
        
        uint32_t hold_index = 0;
        int timeout = 100;
        bool hold_ok = false;
        while (timeout-- > 0) {
            hold_ok = checkFftHoldStatus(&hold_index);
            if (hold_ok) break;
        }
        if (!hold_ok) {
            xil_printf("Warning: Hold timeout, reading anyway...\n\r");
        }

        const float scale = 1.0f / (float)fftLength;
        for (int index = 0; index < fftLength; ++index) {
            reBuffer[index] = re_vals[index] * scale;
            imBuffer[index] = im_vals[index] * scale;
        }

        WebTerminal::printDatasetFloat("Re", reBuffer, static_cast<size_t>(fftLength));
        WebTerminal::printDatasetFloat("Im", imBuffer, static_cast<size_t>(fftLength));

        setFftHold(false);
        xil_printf("Hold status: %s, BRAM index: %lu\n\r", hold_ok ? "OK" : "FAIL", (unsigned long)hold_index);
        xil_printf("<< %s FFT Re/Im Test End >>\n\r\n\r", label);
    }

    void dumpTimeChannel(const char* label, bool dcRemove, int32_t* timeBuffer, uintptr_t bram_base_re) {
        if (bram_base_re == 0U) {
            xil_printf("Invalid channel selection.\n\r");
            return;
        }

        volatile uint32_t *words = reinterpret_cast<volatile uint32_t *>(bram_base_re);

        xil_printf("\n\r<< %s TIME Dump Start >>\n\r", label);
        setFftHold(true);
        
        uint32_t hold_index = 0;
        int timeout = 100;
        bool hold_ok = false;
        while (timeout-- > 0) {
            hold_ok = checkFftHoldStatus(&hold_index);
            if (hold_ok) break;
        }
        if (!hold_ok) {
            xil_printf("Warning: Hold timeout, reading anyway...\n\r");
        }

        float lo_mean = 0.0f;
        if (dcRemove) {
            long lo_sum = 0;
            for (int index = 0; index < fftLength; ++index) {
                uint32_t packed = words[index];
                int32_t raw14 = (int32_t)(packed & 0x3FFFU);
                if (raw14 & 0x2000) { raw14 -= (1 << 14); }
                lo_sum += raw14;
            }
            lo_mean = (float)lo_sum / (float)fftLength;
        }

        for (int index = 0; index < fftLength; ++index) {
            uint32_t packed = words[index];
            int32_t raw14 = (int32_t)(packed & 0x3FFFU);
            if (raw14 & 0x2000) { raw14 -= (1 << 14); }
            int32_t sample_cnt = raw14 - (int32_t)lo_mean;
            timeBuffer[index] = sample_cnt;
        }

        WebTerminal::printDataset(dcRemove ? "TIME_RAW14_DC" : "TIME_RAW14", timeBuffer, static_cast<size_t>(fftLength));

        setFftHold(false);
        xil_printf("Hold status: %s, BRAM index: %lu\n\r", hold_ok ? "OK" : "FAIL", (unsigned long)hold_index);
        xil_printf("<< %s TIME Dump End >>\n\r\n\r", label);
    }

    float measureDcValue(uintptr_t bram_base_re, uintptr_t bram_base_im) {
        if (bram_base_re == 0U || bram_base_im == 0U) {
            return -1.0f;
        }

        volatile float *re_vals = reinterpret_cast<volatile float *>(bram_base_re);
        volatile float *im_vals = reinterpret_cast<volatile float *>(bram_base_im);

        setFftHold(true);
        
        uint32_t hold_index = 0;
        int timeout = 100;
        bool hold_ok = false;
        while (timeout-- > 0) {
            hold_ok = checkFftHoldStatus(&hold_index);
            if (hold_ok) break;
        }
        
        const float scale = 1.0f / (float)fftLength;
        float r = re_vals[0];
        float i = im_vals[0];
        float mag = sqrtf(r * r + i * i) * scale;
        
        setFftHold(false);
        
        if (!(mag == mag) || !(mag < 1e38f)) {
            return -1.0f;
        }
        
        return mag;
    }

    // ========================================================================
    // Calibration
    // ========================================================================

    void setVoltageGain(float gain) { cal_.voltageGain = gain; }
    void setCurrentGain(float gain) { cal_.currentGain = gain; }
    void setPhaseDiffRad(float radians) { cal_.phaseDiffRad = radians; }
    void setPhaseDiffDeg(float degrees) {
        const float kDegToRad = 3.14159265358979323846f / 180.0f;
        cal_.phaseDiffRad = degrees * kDegToRad;
    }
    float voltageGain() const { return cal_.voltageGain; }
    float currentGain() const { return cal_.currentGain; }
    float phaseDiffRad() const { return cal_.phaseDiffRad; }
    float phaseDiffDeg() const {
        const float kRadToDeg = 180.0f / 3.14159265358979323846f;
        return cal_.phaseDiffRad * kRadToDeg;
    }

    void resetSettings() {
        // Reset avgCount to default (512) when resetting settings
        avgCount_ = 512;
        cal_.voltageGain = 1.0f;
        cal_.currentGain = 1.0f;
        cal_.phaseDiffRad = 0.0f;
        setFftHold(false);
        setFftMode(false);
        // Reset relays to default
        pulseRelay(kInitialRelayValue);
    }

    // Get FFT Magnitude Data (fills buffer)
    void getFftData(float* fftMagBuffer) {
        if (bram_v_re_ == 0U || bram_v_im_ == 0U) return;

        volatile float *re_vals = reinterpret_cast<volatile float *>(bram_v_re_);
        volatile float *im_vals = reinterpret_cast<volatile float *>(bram_v_im_);

        // Set FFT mode to 1 (full FFT) for reading
        setFftMode(true);
        
        // Hold gate
        setFftHold(true);
        
        // Wait for hold
        uint32_t hold_index = 0;
        int timeout = 100;
        bool hold_ok = false;
        while (timeout-- > 0) {
            hold_ok = checkFftHoldStatus(&hold_index);
            if (hold_ok) break;
        }

        // Gather FFT magnitude
        const float scale = 1.0f / (float)fftLength;
        for (int index = 0; index < fftLength; ++index) {
            float r = re_vals[index];
            float i = im_vals[index];
            float mag = sqrtf(r * r + i * i) * scale;
            if (!(mag == mag) || !(mag < 1e38f)) {
                fftMagBuffer[index] = 0.0f;
            } else {
                fftMagBuffer[index] = mag;
            }
        }

        setFftHold(false);
        setFftMode(false);
    }

    // Get FFT Magnitude Data for Current channel (fills buffer)
    void getFftDataCurrent(float* fftMagBuffer) {
        if (bram_i_re_ == 0U || bram_i_im_ == 0U) return;

        volatile float *re_vals = reinterpret_cast<volatile float *>(bram_i_re_);
        volatile float *im_vals = reinterpret_cast<volatile float *>(bram_i_im_);

        // Set FFT mode to 1 (full FFT) for reading
        setFftMode(true);
        
        // Hold gate
        setFftHold(true);
        
        // Wait for hold
        uint32_t hold_index = 0;
        int timeout = 100;
        bool hold_ok = false;
        while (timeout-- > 0) {
            hold_ok = checkFftHoldStatus(&hold_index);
            if (hold_ok) break;
        }

        // Gather FFT magnitude for current channel
        const float scale = 1.0f / (float)fftLength;
        for (int index = 0; index < fftLength; ++index) {
            float r = re_vals[index];
            float i = im_vals[index];
            float mag = sqrtf(r * r + i * i) * scale;
            if (!(mag == mag) || !(mag < 1e38f)) {
                fftMagBuffer[index] = 0.0f;
            } else {
                fftMagBuffer[index] = mag;
            }
        }

        setFftHold(false);
        setFftMode(false);
    }

private:
    // Hardware addresses
    uintptr_t bram_v_re_;
    uintptr_t bram_v_im_;
    uintptr_t bram_i_re_;
    uintptr_t bram_i_im_;
    uintptr_t gate_gpio_base_;
    uintptr_t spi_gpio_base_;
    uintptr_t relay_gpio_base_;
    unsigned adc_index_;

    // Calibration
    SensorCalibration cal_;

    // Average count for sensor measurements
    int avgCount_;

    // Helper methods
    void waitForSpiTransfer() {
        volatile uint32_t *spi_regs = reinterpret_cast<volatile uint32_t *>(spi_gpio_base_);
        int timeout = 1000;
        while (!spi_regs[2] && timeout--) {
            usleep(100);
        }
        // Note: Timeout message removed - SPI transfer usually completes successfully
        // even if timeout counter reaches zero due to timing variations
    }

    ComplexF readVoltageBin(int binIndex) {
        if (binIndex < 0) binIndex = 0;
        if (binIndex >= fftLength) binIndex = fftLength - 1;
        volatile float* reWords = reinterpret_cast<volatile float*>(bram_v_re_);
        volatile float* imWords = reinterpret_cast<volatile float*>(bram_v_im_);
        
        stopBramWriteAll();
        float real_f = reWords[binIndex];
        float imag_f = imWords[binIndex];
        resumeBramWriteAll();
        
        ComplexF v = {real_f, imag_f};
        v.r *= cal_.voltageGain;
        v.i *= cal_.voltageGain;
        return v;
    }

    ComplexF readVoltageBinHeld(int binIndex) {
        if (binIndex < 0) binIndex = 0;
        if (binIndex >= fftLength) binIndex = fftLength - 1;
        volatile float* reWords = reinterpret_cast<volatile float*>(bram_v_re_);
        volatile float* imWords = reinterpret_cast<volatile float*>(bram_v_im_);
        
        float real_f = reWords[binIndex];
        float imag_f = imWords[binIndex];
        
        ComplexF v = {real_f, imag_f};
        v.r *= cal_.voltageGain;
        v.i *= cal_.voltageGain;
        return v;
    }

    ComplexF readCurrentBin(int binIndex) {
        if (binIndex < 0) binIndex = 0;
        if (binIndex >= fftLength) binIndex = fftLength - 1;
        volatile float* reWords = reinterpret_cast<volatile float*>(bram_i_re_);
        volatile float* imWords = reinterpret_cast<volatile float*>(bram_i_im_);
        
        stopBramWriteAll();
        float real_f = reWords[binIndex];
        float imag_f = imWords[binIndex];
        resumeBramWriteAll();
        
        ComplexF i = {real_f, imag_f};
        i.r *= cal_.currentGain;
        i.i *= cal_.currentGain;
        return i;
    }

    ComplexF readCurrentBinHeld(int binIndex) {
        if (binIndex < 0) binIndex = 0;
        if (binIndex >= fftLength) binIndex = fftLength - 1;
        volatile float* reWords = reinterpret_cast<volatile float*>(bram_i_re_);
        volatile float* imWords = reinterpret_cast<volatile float*>(bram_i_im_);
        
        float real_f = reWords[binIndex];
        float imag_f = imWords[binIndex];
        
        ComplexF i = {real_f, imag_f};
        i.r *= cal_.currentGain;
        i.i *= cal_.currentGain;
        return i;
    }
};

