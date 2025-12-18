#pragma once

#include <stdint.h>
#include <stddef.h>
#include "xil_printf.h"

namespace WebTerminal {

// Internal state
static uint32_t g_plotCounter = 0;

// Internal helper functions

inline void printCommaSeparated(const int32_t* data, size_t length) {
    // Print values in safe chunks to avoid huge single printf
    const size_t chunk = 64; // values per chunk
    size_t idx = 0;
    while (idx < length) {
        size_t end = idx + chunk;
        if (end > length) end = length;
        for (size_t i = idx; i < end; ++i) {
            xil_printf("%d", data[i]);
            if (i != length - 1) xil_printf(",");
        }
        idx = end;
    }
}

// Internal helper functions

static inline void printDecimalFixed6_impl(float value) {
    long sign = (value < 0.0f) ? -1 : 1;
    float abs_f = value * static_cast<float>(sign);
    long ip = static_cast<long>(abs_f);
    long fp = static_cast<long>((abs_f - static_cast<float>(ip)) * 1000000.0f + 0.5f);
    if (fp >= 1000000L) { 
        ip += 1; 
        fp -= 1000000L; 
    }
    
    // Print sign for negative values
    if (sign < 0) {
        xil_printf("-");
    }
    
    // Print integer and fractional parts
    xil_printf("%ld.%06ld", ip, fp);
}

// Public API functions

// Print a float value with 6 decimal places (xil_printf doesn't support %f)
inline void printFloat(float value) {
    printDecimalFixed6_impl(value);
}

// Generic print function to wrap xil_printf
template <typename... Args>
inline void print(const char* format, Args... args) {
    xil_printf(format, args...);
}

inline void resetCounter() {
    g_plotCounter = 0;
}

inline void printDataset(const char* caption, const int32_t* data, size_t length) {
    print("[Plot_%04lu: %s]\r\n", static_cast<unsigned long>(g_plotCounter), (caption ? caption : ""));
    print("DataStart,");
    printCommaSeparated(data, length);
    print(",DataEnd\r\n");
    g_plotCounter++;
}

inline void printDatasetFloat(const char* caption, const float* data, size_t length) {
    print("[Plot_%04lu: %s]\r\n", static_cast<unsigned long>(g_plotCounter), (caption ? caption : ""));
    print("DataStart,");
    for (size_t i = 0; i < length; ++i) {
        printDecimalFixed6_impl(data[i]);
        if (i != length - 1) print(",");
    }
    print(",DataEnd\r\n");
    g_plotCounter++;
}

// OpCode-based transmission functions
// Format: OPCODE,value1,value2,...,EN\r\n

inline void sendImpedance(float R, float X, float V, float I, float phaseDeg, bool isInput) {
    // Use ZI for input sensor, ZO for output sensor
    // Format: ZI,R,X,V,I,Phase,EN or ZO,R,X,V,I,Phase,EN
    const char* opcode = isInput ? "ZI" : "ZO";
    
    print("%s,", opcode);
    printDecimalFixed6_impl(R);
    print(",");
    printDecimalFixed6_impl(X);
    print(",");
    printDecimalFixed6_impl(V);
    print(",");
    printDecimalFixed6_impl(I);
    print(",");
    printDecimalFixed6_impl(phaseDeg);
    print(",EN\r\n");
}

inline void sendVIMag(float vMag, float iMag, bool isInput) {
    // Use VI for input sensor, VO for output sensor
    const char* opcode = isInput ? "VI" : "VO";
    
    print("%s,", opcode);
    printDecimalFixed6_impl(vMag);
    print(",");
    printDecimalFixed6_impl(iMag);
    print(",EN\r\n");
}

inline void sendFftData(const float* data, size_t length, bool isInput) {
    // Use FI for input sensor FFT (Voltage), FO for output sensor FFT (Voltage)
    const char* opcode = isInput ? "FI" : "FO";
    
    print("%s,", opcode);
    for (size_t i = 0; i < length; ++i) {
        printDecimalFixed6_impl(data[i]);
        if (i != length - 1) print(",");
    }
    print(",EN\r\n");
}

inline void sendFftDataCurrent(const float* data, size_t length, bool isInput) {
    // Use CI for input sensor FFT (Current), CO for output sensor FFT (Current)
    const char* opcode = isInput ? "CI" : "CO";
    
    print("%s,", opcode);
    for (size_t i = 0; i < length; ++i) {
        printDecimalFixed6_impl(data[i]);
        if (i != length - 1) print(",");
    }
    print(",EN\r\n");
}

inline void sendAck(const char* cmd, const char* status) {
    print("ACK,%s,%s,EN\r\n", cmd, status);
}

inline void sendMotorPositionBoth(uint32_t pos0, int percent0, int32_t cap0, uint32_t pos1, int percent1, int32_t cap1) {
    // Format: MPB,pos0,percent0,cap0,pos1,percent1,cap1,EN
    // Capacitance values are pF×10 (UI divides by 10 for display)
    print("MPB,%u,%d,%d,%u,%d,%d,EN\r\n", pos0, percent0, cap0, pos1, percent1, cap1);
}

inline void sendSensorStreamSettings(int impRate, int viRate) {
    // Format: SST,impRate,viRate,EN
    print("SST,%d,%d,EN\r\n", impRate, viRate);
}

inline void sendMotorSettings(int posStreamRate, int saveRate, int saveEnabled) {
    // Format: MST,posStreamRate,saveRate,saveEnabled,EN
    print("MST,%d,%d,%d,EN\r\n", posStreamRate, saveRate, saveEnabled);
}

} // namespace WebTerminal

