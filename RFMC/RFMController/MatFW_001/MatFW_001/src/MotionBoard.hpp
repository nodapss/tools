#pragma once

// MotionBoard.hpp - Unified motion control library
// Integrates TeensyController (I2C communication) and MotorController (GPIO control)
// Header-only library for MatFW_001 integration

#include <stdint.h>
#include <string.h>
#include <stdio.h>
#include <math.h>
#include "xil_types.h"
#include "xiicps.h"
#include "xparameters.h"
#include "xil_printf.h"
#include "sleep.h"
#include "xstatus.h"
#include "WebTerminal.hpp"
#include "RFSensor.hpp"

// ============================================================================
// Constants
// ============================================================================

/* ---------- I2C ---------- */
#define IIC_DEVICE_ID   XPAR_XIICPS_0_DEVICE_ID
#define IIC_SCLK_RATE   100000   /* 100 kHz */

/* ---------- board addresses ---------- */
#define BOARD1_ADDR     0x50
#define BOARD2_ADDR     0x51

/* ---------- DRV8711 constants ---------- */
#define DRV8711_SPI_MOTOR1       1   /* SPI number for motor 1's DRV8711 */
#define DRV8711_SPI_MOTOR2       2   /* SPI number for motor 2's DRV8711 */
#define DRV8711_CTRL_STANDBY     553 /* Standby state: DTIME: 400ns, ISGAIN: 20V/V, �뒪�넧寃�異�: �궡遺�Back-EMF, Step Mode: 1/32 step, �뒪�뀦諛⑺뼢: �젙�긽, DIR�떊�샇: �젙�긽, 紐⑦꽣異쒕젰: 鍮꾪솢�꽦 */
#define DRV8711_CTRL_DISABLE     552   /* CTRL: Enable=0 (disable motor output) */

/* DRV8711 default register values */
#define DRV8711_DEF_TORQUE       336   /* TORQUE: TORQUE=0x50 (80), SMPLTH=001 (50us) */
#define DRV8711_DEF_OFF          15    /* OFF: TOFF=15 (7.5us), PWMMODE=0 */
#define DRV8711_DEF_BLANK        336   /* BLANK: TBLANK=0x50 (1.5us), ABT=1 */
#define DRV8711_DEF_DECAY        508   /* DECAY: TDECAY=0xFC, DECMOD=001 (slow/mixed) */
#define DRV8711_DEF_STALL        1200  /* STALL: SDTHR=0x4B0, SDCNT=01, VDIV=01 */
#define DRV8711_DEF_DRIVE        5     /* DRIVE: OCPTH=00, OCPDEG=00, TDRIVEN=01, TDRIVEP=01 */

/* ---------- GPIO Channel definitions ---------- */
#define GPIO_CH_TAR_POS          1   /* Target position channel */
#define GPIO_CH_SET_ORIGIN       2   /* Set origin channel */
#define GPIO_CH_NOW_POS          1   /* Current position channel */
#define GPIO_CH_NOW_RPM          2   /* Current RPM channel */

/* ---------- Motor Rewind Configuration ---------- */
#define MOTOR_REWIND_TARGET           (-100000)  /* Rewind target position (negative direction) */
#define MOTOR_REWIND_POLL_MS          (10)       /* Polling interval (ms) */
#define MOTOR_REWIND_OFFSET           (1000)      /* Position offset to stop motor after stall */
#define MOTOR_REWIND_TIMEOUT_MS       (25000)    /* Timeout (ms) */

/* Stall detection parameters (conservative values based on measured data) */
/* Normal movement: ~33 steps/10ms, variation: 30~36 (range 6) */
#define MOTOR_REWIND_THRESHOLD        (15)       /* Min movement threshold (steps/poll) - ~45% of normal */
#define MOTOR_REWIND_STALL_COUNT      (2)        /* Consecutive detections required */
#define MOTOR_REWIND_PRINT_INTERVAL   (10)       /* Log output every N polls (10 = 100ms at 10ms poll) */
#define MOTOR_REWIND_OVERRIDE_RPM     (30)       /* Override RPM during rewind */

/* ---------- command codes ---------- */
#define CMD_READ_REG        0x01
#define CMD_WRITE_REG       0x02
#define CMD_RUN_MOTOR       0x03
#define CMD_GET_STATUS      0x04
#define CMD_RESET           0x05
#define CMD_SET_SLEEP       0x06      /* [cmd, spi, level] */
#define CMD_SET_HW_RESET    0x07      /* [cmd, spi, level] */
#define CMD_FRAM_READ       0x08      /* [cmd, addr_h, addr_l, len] */
#define CMD_FRAM_WRITE      0x09      /* [cmd, addr_h, addr_l, len, data...] */

/* ---------- DRV8711 register order ---------- */
enum { ADDR_CTRL, ADDR_TORQUE, ADDR_OFF, ADDR_BLANK,
       ADDR_DECAY, ADDR_STALL, ADDR_DRIVE, ADDR_STATUS };

struct MotorDriverRegs {
    u16 Ctrl;   // ADDR_CTRL
    u16 Torque; // ADDR_TORQUE
    u16 Off;    // ADDR_OFF
    u16 Blank;  // ADDR_BLANK
    u16 Decay;  // ADDR_DECAY
    u16 Stall;  // ADDR_STALL
    u16 Drive;  // ADDR_DRIVE
};

// ============================================================================
// Forward declarations
// ============================================================================

class MotionBoard;

// ============================================================================
// MotorController (internal implementation)
// ============================================================================

class MotorController {
public:
    MotorController();
    MotorController(uintptr_t outGpioBase, uintptr_t inGpioBase);
    ~MotorController();

    // Initialize GPIO (called from MotionBoard::initialize)
    // Uses direct register access for consistency with RFSensor
    int initializeGpio(uintptr_t outGpioBase, uintptr_t inGpioBase);

    // Per-instance control API
    int SetMotorOrigin(int32_t position = 0);       // Immediate origin set: bit 0 trigger, bits 31~2 = position
    int SetMotorOriginOnIndex(int32_t position = 0); // Origin set on next index signal: bit 1 trigger, bits 31~2 = position
    int RunMotor(int targetPosition, bool printStatus=false, uint32_t afterDelayMs=0);
    int RunMotorForce(int targetPosition, bool printStatus=false, uint32_t afterDelayMs=0);

    // Lazy fields: read on access
    struct Field {
        const MotorController* owner;
        enum Type { POS, RPM } type;
        Field(const MotorController* o, Type t) : owner(o), type(t) {}
        operator u32() const;
    };
    Field Pos;
    Field RPM;

    // Explicit read helpers
    u32 readPosRaw() const;  // Read raw GPIO position (without offset)
    int32_t readPos() const; // Read absolute position (with offset applied)
    u32 readRpm() const;
    
    // Position offset for absolute position tracking across FPGA reboots
    // Final position = GPIO position + posOffset
    // On boot: posOffset = FRAM saved position - GPIO raw position
    int32_t posOffset;

    // Motor limits configuration
    int32_t minValue;
    int32_t maxValue;
    int32_t lowerLimit;
    int32_t upperLimit;
    
    // Capacitance configuration (pF × 100 for 0.01pF precision, stored as int)
    // Example: 123.45 pF is stored as 12345
    int32_t minCap;  // Capacitance at minValue position (pF × 100)
    int32_t maxCap;  // Capacitance at maxValue position (pF × 100)
    
    // Cubic fitting coefficients (NORMALIZED): C(xNorm) = a3*xNorm^3 + a2*xNorm^2 + a1*xNorm + a0
    // where xNorm = (step - minValue) / (maxValue - minValue)
    // Uses Motor Limits (minValue, maxValue) as normalization parameters
    // Stored as floats for precision. Result is in pF, convert to pF×100 for output.
    float fitCoeffs[4];  // [a0, a1, a2, a3] - normalized coefficients
    
    // Motor index for FRAM storage (0~31)
    int motorIndex;
    
    // Extended GPIO for encoder index position and stall detection (GPIO 8/9)
    // Channel 1 (Input): [31] Stall detected + [30:0] Index position
    // Channel 2 (Output): Override RPM (0 = disabled, >0 = fixed RPM)
    int initializeExtGpio(uintptr_t extGpioBase);
    int32_t readIndexPos() const;      // Read encoder index position (lower 31 bits)
    bool isStallDetected() const;      // Read stall detection bit (MSB)
    void setOverrideRpm(uint32_t rpm); // Set override RPM (0 = disable)
    uint32_t getOverrideRpm() const;   // Get current override RPM value
    
    // Index position search result structure
    struct IndexSearchResult {
        bool found;              // Whether index position was found
        int32_t indexPos;        // Found index position (from FPGA)
        int32_t motorPosAtIndex; // Motor position when index was detected
        int32_t finalPos;        // Final motor position after move
    };
    
    // Find encoder index position while moving to target at specified RPM
    // Sets override RPM, moves to targetPos, monitors indexPos for non-zero value
    // Returns result with found index position (if any) and final motor position
    IndexSearchResult findIndexPosition(int32_t targetPos, uint32_t rpm, int pollIntervalUs = 1000);
    
    // Rewind result structure (for end-stop detection)
    struct RewindResult {
        bool completed;      // Whether rewind completed (stall detected)
        int32_t finalPos;    // Final motor position after rewind
        int32_t movement;    // Total movement (always positive, represents absolute distance)
    };
    
    // Rewind motor to physical limit (negative direction)
    // Moves toward MOTOR_REWIND_TARGET, polls position every MOTOR_REWIND_POLL_MS
    // Detects stall when movement per poll < MOTOR_REWIND_THRESHOLD
    // Stops motor by setting TAR_POS = currentPos + MOTOR_REWIND_OFFSET
    RewindResult rewindMotor();
    
    // Get position as percentage (0~100)
    int getPositionPercent() const {
        if (maxValue <= minValue) return 0;
        int32_t pos = (int32_t)readPos();
        int percent = (int)(((pos - minValue) * 100) / (maxValue - minValue));
        return (percent < 0) ? 0 : ((percent > 100) ? 100 : percent);
    }
    
    // Check if fitting coefficients are calibrated (not all zero)
    bool isFittingCalibrated() const {
        return (fitCoeffs[0] != 0.0f || fitCoeffs[1] != 0.0f || 
                fitCoeffs[2] != 0.0f || fitCoeffs[3] != 0.0f);
    }
    
    // Get capacitance (pF × 100) based on current position using cubic polynomial
    // C(step) = a3*step^3 + a2*step^2 + a1*step + a0
    int32_t getCapacitance() const {
        int32_t pos = (int32_t)readPos();
        return getCapacitanceAt(pos);
    }
    
    // Get capacitance (pF × 100) for a specific position using normalized cubic polynomial
    // C(xNorm) = a3*xNorm^3 + a2*xNorm^2 + a1*xNorm + a0
    // where xNorm = (step - minValue) / (maxValue - minValue)
    int32_t getCapacitanceAt(int32_t pos) const {
        // Use Motor Limits as normalization parameters
        float xRange = (float)(maxValue - minValue);
        
        // If fitting coefficients are calibrated, use normalized cubic polynomial
        if (isFittingCalibrated() && xRange > 0.0f) {
            // Calculate normalized x: xNorm = (step - minValue) / (maxValue - minValue)
            float xNorm = ((float)pos - (float)minValue) / xRange;
            
            // Cubic polynomial with normalized x
            float cap = fitCoeffs[3] * xNorm * xNorm * xNorm +
                        fitCoeffs[2] * xNorm * xNorm +
                        fitCoeffs[1] * xNorm +
                        fitCoeffs[0];
            // Convert pF to pF×100 and return as integer
            return (int32_t)(cap * 100.0f);
        }
        
        // Fallback to linear interpolation
        if (maxValue <= minValue) return minCap;
        int64_t range = maxCap - minCap;
        int64_t posRange = maxValue - minValue;
        int64_t posOffset = pos - minValue;
        if (posOffset < 0) posOffset = 0;
        if (posOffset > posRange) posOffset = posRange;
        return minCap + (int32_t)((range * posOffset) / posRange);
    }
    
    // Get position for a target capacitance (pF × 100) - inverse calculation using Newton-Raphson
    // Uses normalized polynomial: C(xNorm) = a3*xNorm^3 + a2*xNorm^2 + a1*xNorm + a0
    // Solves for xNorm, then converts back: step = xNorm * xRange + xMin
    // xMin and xRange are derived from Motor Limits (minValue, maxValue)
    int32_t getPositionFromCap(int32_t targetCap) const {
        // Convert target from pF×100 to pF for calculation
        float targetCapPf = (float)targetCap / 100.0f;
        
        // Use Motor Limits as normalization parameters
        float xRange = (float)(maxValue - minValue);
        
        // If fitting coefficients are calibrated, use Newton-Raphson on normalized x
        if (isFittingCalibrated() && xRange > 0.0f) {
            // Convert limits to normalized range
            float xNormLower = ((float)lowerLimit - (float)minValue) / xRange;
            float xNormUpper = ((float)upperLimit - (float)minValue) / xRange;
            
            // Newton-Raphson on xNorm:
            // f(xNorm) = a3*xNorm^3 + a2*xNorm^2 + a1*xNorm + a0 - targetCap = 0
            // f'(xNorm) = 3*a3*xNorm^2 + 2*a2*xNorm + a1
            float xNorm = (xNormLower + xNormUpper) / 2.0f;  // Initial guess
            const int maxIterations = 20;
            const float tolerance = 0.1f;  // pF tolerance
            
            for (int i = 0; i < maxIterations; i++) {
                float fx = fitCoeffs[3] * xNorm * xNorm * xNorm +
                           fitCoeffs[2] * xNorm * xNorm +
                           fitCoeffs[1] * xNorm +
                           fitCoeffs[0] - targetCapPf;
                float fpx = 3.0f * fitCoeffs[3] * xNorm * xNorm +
                            2.0f * fitCoeffs[2] * xNorm +
                            fitCoeffs[1];
                
                if (fabsf(fx) < tolerance) break;
                if (fabsf(fpx) < 1e-10f) break;  // Avoid division by zero
                
                xNorm = xNorm - fx / fpx;
                
                // Clamp to valid normalized range
                if (xNorm < xNormLower) xNorm = xNormLower;
                if (xNorm > xNormUpper) xNorm = xNormUpper;
            }
            
            // Convert back to actual step position: step = xNorm * xRange + xMin
            float step = xNorm * xRange + (float)minValue;
            return (int32_t)(step + 0.5f);  // Round to nearest integer
        }
        
        // Fallback to linear interpolation
        if (maxCap <= minCap) return minValue;
        int64_t posRange = maxValue - minValue;
        int64_t capRange = maxCap - minCap;
        int64_t capOffset = targetCap - minCap;
        if (capOffset < 0) capOffset = 0;
        if (capOffset > capRange) capOffset = capRange;
        return minValue + (int32_t)((posRange * capOffset) / capRange);
    }

private:
    // GPIO base addresses for direct register access
    uintptr_t gpioOutBase;
    uintptr_t gpioInBase;
    bool gpioInitialized;
    
    // Extended GPIO base address (GPIO 8/9 for encoder index + stall + override RPM)
    uintptr_t extGpioBase;
    bool extGpioInitialized;
    uint32_t overrideRpmValue;  // Cached override RPM value

    // Timing/tolerance
    static constexpr int kMotorTolerance = 0;
    static constexpr int kMotorTimeoutMs = 5000;
    static constexpr int kPositionStableTimeoutMs = 5000;
    static constexpr int kMotorCheckIntervalUs = 100000;
};

// MotorController implementation
MotorController::MotorController()
    : gpioOutBase(0), gpioInBase(0), gpioInitialized(false),
      extGpioBase(0), extGpioInitialized(false), overrideRpmValue(0),
      Pos(this, Field::POS), RPM(this, Field::RPM),
      posOffset(0),  // Position offset for absolute tracking
      minValue(0), maxValue(64000), lowerLimit(4000), upperLimit(60000),
      minCap(0), maxCap(100000),  // pF × 100: 0~1000.00 pF
      fitCoeffs{0.0f, 0.0f, 0.0f, 0.0f},  // [a0, a1, a2, a3] - normalized
      motorIndex(0) {}

MotorController::MotorController(uintptr_t outGpioBase, uintptr_t inGpioBase)
    : gpioOutBase(outGpioBase), gpioInBase(inGpioBase), gpioInitialized(false),
      extGpioBase(0), extGpioInitialized(false), overrideRpmValue(0),
      Pos(this, Field::POS), RPM(this, Field::RPM),
      posOffset(0),  // Position offset for absolute tracking
      minValue(0), maxValue(64000), lowerLimit(4000), upperLimit(60000),
      minCap(0), maxCap(100000),  // pF × 100: 0~1000.00 pF
      fitCoeffs{0.0f, 0.0f, 0.0f, 0.0f},  // [a0, a1, a2, a3] - normalized
      motorIndex(0) {}

MotorController::~MotorController() {}

int MotorController::initializeGpio(uintptr_t outGpioBase, uintptr_t inGpioBase) {
    this->gpioOutBase = outGpioBase;
    this->gpioInBase = inGpioBase;

    if (gpioOutBase == 0U || gpioInBase == 0U) {
        return XST_FAILURE;
    }

    // Get pointers to GPIO registers
    volatile uint32_t *gpioOut = reinterpret_cast<volatile uint32_t *>(gpioOutBase);
    volatile uint32_t *gpioIn = reinterpret_cast<volatile uint32_t *>(gpioInBase);

    // Initialize output GPIO
    // Channel 1 (TAR_POS): output
    gpioOut[1] = 0x00000000U;  // TRI register channel 1 (offset 0x4) - all outputs
    // Channel 2 (SET_ORIGIN): output
    gpioOut[3] = 0x00000000U;  // TRI register channel 2 (offset 0xC) - all outputs

    // Initialize input GPIO
    // Channel 1 (NOW_POS): input
    gpioIn[1] = 0xFFFFFFFFU;  // TRI register channel 1 (offset 0x4) - all inputs
    // Channel 2 (NOW_RPM): input
    gpioIn[3] = 0xFFFFFFFFU;  // TRI register channel 2 (offset 0xC) - all inputs

    gpioInitialized = true;
    return XST_SUCCESS;
}

int MotorController::SetMotorOrigin(int32_t position)
{
    if (!gpioInitialized || gpioOutBase == 0U) return XST_FAILURE;
    volatile uint32_t *gpioOut = reinterpret_cast<volatile uint32_t *>(gpioOutBase);
    
    // Set target position first to prevent motor movement after origin reset
    gpioOut[0] = (uint32_t)position;  // Data register channel 1 (TAR_POS)
    
    // 30-bit SetOrigin: bit 0 = immediate origin trigger, bit 1 = index-wait trigger, bits 31~2 = position value
    // GPIO value = (position << 2) | trigger_bit
    // Example: position=3 -> baseValue=12, trigger sequence: 12 -> 13 -> 12 (bit 0 rising for immediate)
    uint32_t baseValue = ((uint32_t)position) << 2;
    
    gpioOut[2] = baseValue;           // (pos << 2) | 0 - prepare position value
    usleep(200);
    gpioOut[2] = baseValue | 0x1U;    // (pos << 2) | 1 - bit 0 rising edge trigger (immediate origin)
    usleep(200);
    gpioOut[2] = baseValue;           // (pos << 2) | 0 - clear trigger
    usleep(200);
    
    return XST_SUCCESS;
}

int MotorController::SetMotorOriginOnIndex(int32_t position)
{
    if (!gpioInitialized || gpioOutBase == 0U) return XST_FAILURE;
    volatile uint32_t *gpioOut = reinterpret_cast<volatile uint32_t *>(gpioOutBase);
    
    // NOTE: DO NOT set TAR_POS here! This would cause immediate motor movement.
    // SetMotorOriginOnIndex only arms the pending flag for next index detection.
    
    // 30-bit SetOrigin on Index: bit 1 = index-wait origin trigger, bits 31~2 = position value
    // GPIO value = (position << 2) | trigger_bit
    // FPGA will wait for next encoder index signal, then set origin to specified position
    uint32_t baseValue = ((uint32_t)position) << 2;
    
    gpioOut[2] = baseValue;           // (pos << 2) | 0 - prepare position value
    usleep(200);
    gpioOut[2] = baseValue | 0x2U;    // (pos << 2) | 2 - bit 1 rising edge trigger (origin on index)
    usleep(200);
    gpioOut[2] = baseValue;           // (pos << 2) | 0 - clear trigger
    usleep(200);
    
    return XST_SUCCESS;
}

int MotorController::RunMotor(int targetPosition, bool printStatus, uint32_t afterDelayMs)
{
    if (!gpioInitialized || gpioOutBase == 0U) return XST_FAILURE;

    // Clamp targetPosition to lowerLimit~upperLimit range
    int clampedPosition = targetPosition;
    bool wasClamped = false;
    
    if (clampedPosition < lowerLimit) {
        clampedPosition = lowerLimit;
        wasClamped = true;
    } else if (clampedPosition > upperLimit) {
        clampedPosition = upperLimit;
        wasClamped = true;
    }
    
    if (wasClamped) {
        xil_printf("[MOTOR] Target %d clamped to %d (limits: %d~%d)\n", 
            targetPosition, clampedPosition, lowerLimit, upperLimit);
    }

    volatile uint32_t *gpioOut = reinterpret_cast<volatile uint32_t *>(gpioOutBase);
    u32 tarPosValue = (u32)clampedPosition;
    if (printStatus) {
        xil_printf("Before: Pos=%u RPM=%u\n", (u32)Pos, (u32)RPM);
    }
    gpioOut[0] = tarPosValue;  // Data register channel 1 (TAR_POS) - offset 0x0
    if (printStatus) {
        if (afterDelayMs > 0) {
            usleep(afterDelayMs * 1000U);
        } else {
            usleep(100);
        }
        xil_printf("After:  Pos=%u RPM=%u\n", (u32)Pos, (u32)RPM);
    }
    return XST_SUCCESS;
}

// RunMotorForce: Move to target position without limit checking
int MotorController::RunMotorForce(int targetPosition, bool printStatus, uint32_t afterDelayMs)
{
    if (!gpioInitialized || gpioOutBase == 0U) return XST_FAILURE;

    xil_printf("[MOTOR] FORCE MOVE to %d (bypassing limits %d~%d)\n", 
        targetPosition, lowerLimit, upperLimit);

    volatile uint32_t *gpioOut = reinterpret_cast<volatile uint32_t *>(gpioOutBase);
    u32 tarPosValue = (u32)targetPosition;
    if (printStatus) {
        xil_printf("Before: Pos=%u RPM=%u\n", (u32)Pos, (u32)RPM);
    }
    gpioOut[0] = tarPosValue;  // Data register channel 1 (TAR_POS) - offset 0x0
    if (printStatus) {
        if (afterDelayMs > 0) {
            usleep(afterDelayMs * 1000U);
        } else {
            usleep(100);
        }
        xil_printf("After:  Pos=%u RPM=%u\n", (u32)Pos, (u32)RPM);
    }
    return XST_SUCCESS;
}

// Read raw GPIO position (without offset) - for internal use and offset calculation
u32 MotorController::readPosRaw() const
{
    if (!gpioInitialized || gpioInBase == 0U) return 0;
    volatile uint32_t *gpioIn = reinterpret_cast<volatile uint32_t *>(gpioInBase);
    return gpioIn[0];  // Data register channel 1 (NOW_POS) - offset 0x0
}

// Read absolute position with offset applied
// Final position = GPIO raw position + posOffset
// This maintains absolute position across FPGA reboots
int32_t MotorController::readPos() const
{
    return (int32_t)readPosRaw() + posOffset;
}

u32 MotorController::readRpm() const
{
    if (!gpioInitialized || gpioInBase == 0U) return 0;
    volatile uint32_t *gpioIn = reinterpret_cast<volatile uint32_t *>(gpioInBase);
    return gpioIn[2];  // Data register channel 2 (NOW_RPM) - offset 0x8
}

// Extended GPIO methods for encoder index position, stall detection, and override RPM
// GPIO 8 for Motor 0, GPIO 9 for Motor 1
// Channel 1 (Input): [31] Stall detected + [30:0] Index position
// Channel 2 (Output): Override RPM (0 = disabled, >0 = fixed RPM)

int MotorController::initializeExtGpio(uintptr_t extBase)
{
    this->extGpioBase = extBase;
    
    if (extGpioBase == 0U) {
        extGpioInitialized = false;
        return XST_FAILURE;
    }
    
    volatile uint32_t *gpio = reinterpret_cast<volatile uint32_t *>(extGpioBase);
    
    // Channel 1 (Index Position + Stall): input
    gpio[1] = 0xFFFFFFFFU;  // TRI register channel 1 (offset 0x4) - all inputs
    
    // Channel 2 (Override RPM): output
    gpio[3] = 0x00000000U;  // TRI register channel 2 (offset 0xC) - all outputs
    
    // Initialize override RPM to 0 (disabled)
    gpio[2] = 0x00000000U;  // Data register channel 2 (offset 0x8)
    overrideRpmValue = 0;
    
    extGpioInitialized = true;
    return XST_SUCCESS;
}

int32_t MotorController::readIndexPos() const
{
    if (!extGpioInitialized || extGpioBase == 0U) return 0;
    volatile uint32_t *gpio = reinterpret_cast<volatile uint32_t *>(extGpioBase);
    uint32_t raw = gpio[0];  // Data register channel 1 (offset 0x0)
    // Lower 31 bits contain the index position
    return (int32_t)(raw & 0x7FFFFFFFU);
}

bool MotorController::isStallDetected() const
{
    if (!extGpioInitialized || extGpioBase == 0U) return false;
    volatile uint32_t *gpio = reinterpret_cast<volatile uint32_t *>(extGpioBase);
    uint32_t raw = gpio[0];  // Data register channel 1 (offset 0x0)
    // MSB (bit 31) contains stall detection flag
    return (raw & 0x80000000U) != 0;
}

void MotorController::setOverrideRpm(uint32_t rpm)
{
    if (!extGpioInitialized || extGpioBase == 0U) return;
    volatile uint32_t *gpio = reinterpret_cast<volatile uint32_t *>(extGpioBase);
    gpio[2] = rpm;  // Data register channel 2 (offset 0x8)
    overrideRpmValue = rpm;
}

uint32_t MotorController::getOverrideRpm() const
{
    return overrideRpmValue;
}

// Find encoder index position while moving to target at specified RPM
// This method:
// 1. Sets override RPM to control motor speed
// 2. Starts moving toward targetPos
// 3. Polls indexPos during movement to detect non-zero value
// 4. Records the first non-zero indexPos and motor position at that moment
// 5. Continues moving until target is reached
// 6. Clears override RPM and returns result
MotorController::IndexSearchResult MotorController::findIndexPosition(int32_t targetPos, uint32_t rpm, int pollIntervalUs)
{
    IndexSearchResult result = { false, 0, 0, 0 };
    
    // Check if extended GPIO is initialized
    if (!extGpioInitialized || extGpioBase == 0U) {
        result.finalPos = readPos();
        return result;
    }
    
    int32_t startPos = readPos();
    int32_t direction = (targetPos > startPos) ? 1 : -1;
    
    // Set override RPM for controlled speed movement
    setOverrideRpm(rpm);
    
    // Start moving to target position (use RunMotorForce to bypass limits for calibration)
    RunMotorForce(targetPos, false, 0);
    
    // Poll for index position while moving
    int32_t prevIndexPos = readIndexPos();
    int32_t currentPos = startPos;
    int printCounter = 0;  // For periodic printing
    int32_t lastMovingPos = startPos;  // For stuck detection
    int stuckCounter = 0;  // Count consecutive checks with no movement
    const int stuckThreshold = 2000;  // Exit if no movement for 2 seconds (2000 * 1ms)
    
    // Calculate timeout based on distance and RPM
    // RPM 30, 6400 microsteps/rev = 3200 steps/sec
    // Timeout = distance / speed * 2 (safety margin)
    int32_t distance = (targetPos > startPos) ? (targetPos - startPos) : (startPos - targetPos);
    int stepsPerSec = (rpm * 6400) / 60;  // microsteps per second
    int timeoutMs = (stepsPerSec > 0) ? ((distance * 1000) / stepsPerSec) * 2 + 5000 : 30000;
    int elapsedUs = 0;
    int timeoutUs = timeoutMs * 1000;
    
    while (elapsedUs < timeoutUs) {
        usleep(pollIntervalUs);
        elapsedUs += pollIntervalUs;
        printCounter++;
        
        currentPos = readPos();
        int32_t currentIndexPos = readIndexPos();
        
        // Print indexPos periodically (every 100ms when pollInterval=1ms)
        // or when value changes
        bool valueChanged = (currentIndexPos != prevIndexPos);
        bool shouldPrint = valueChanged || (printCounter >= 100);
        
        if (shouldPrint) {
            xil_printf("  [%dms] Pos=%d, IdxPos=%d%s\n\r", 
                elapsedUs / 1000, currentPos, currentIndexPos,
                valueChanged ? " *CHANGED*" : "");
            printCounter = 0;
        }
        
        // Check if index position changed to non-zero (and we haven't found one yet)
        if (!result.found && currentIndexPos != 0 && currentIndexPos != prevIndexPos) {
            result.found = true;
            result.indexPos = currentIndexPos;
            result.motorPosAtIndex = currentPos;
            xil_printf("  >>> INDEX FOUND! IdxPos=%d @ MotorPos=%d <<<\n\r", currentIndexPos, currentPos);
        }
        
        prevIndexPos = currentIndexPos;
        
        // Check if we've reached the target
        bool reachedTarget = false;
        if (direction > 0) {
            reachedTarget = (currentPos >= targetPos);
        } else {
            reachedTarget = (currentPos <= targetPos);
        }
        
        // Exit if target reached
        if (reachedTarget) {
            usleep(100000);  // 100ms wait for motor to settle
            break;
        }
        
        // Also check if motor has stopped unexpectedly (RPM = 0)
        if (readRpm() == 0) {
            usleep(50000);  // 50ms
            if (readRpm() == 0) {
                break;  // Motor stopped before reaching target
            }
        }
        
        // Check for stuck condition (no position change for extended period)
        if (currentPos == lastMovingPos) {
            stuckCounter++;
            if (stuckCounter >= stuckThreshold) {
                xil_printf("  >>> MOTOR STUCK! No movement detected for %dms. Aborting. <<<\n\r", 
                    stuckThreshold * pollIntervalUs / 1000);
                break;
            }
        } else {
            lastMovingPos = currentPos;
            stuckCounter = 0;  // Reset counter when position changes
        }
    }
    
    // Clear override RPM
    setOverrideRpm(0);
    
    // Record final position
    result.finalPos = readPos();
    
    return result;
}

// Rewind motor to physical limit (negative direction)
// Moves toward MOTOR_REWIND_TARGET, detects stall when movement slows
MotorController::RewindResult MotorController::rewindMotor()
{
    RewindResult result = { false, 0, 0 };
    
    if (!gpioInitialized || gpioOutBase == 0U) {
        result.finalPos = readPos();
        return result;
    }
    
    int32_t startPos = readPos();
    
    xil_printf("RW P=%d T=%d Thr=%d\n\r", 
        startPos, MOTOR_REWIND_TARGET, MOTOR_REWIND_THRESHOLD);
    
    // Set override RPM for controlled speed during rewind
    setOverrideRpm(MOTOR_REWIND_OVERRIDE_RPM);
    usleep(10000);  // 10ms delay for RPM setting to take effect
    
    // Start moving to rewind target (negative direction)
    RunMotorForce(MOTOR_REWIND_TARGET, false, 0);
    
    // Wait for motor to start moving
    usleep(50000);  // 50ms initial delay
    
    int32_t prevPos = readPos();
    int32_t currentPos = prevPos;
    int stallCount = 0;
    
    // Poll until stall detected or timeout
    int elapsedMs = 0;
    int printCounter = 0;
    
    while (elapsedMs < MOTOR_REWIND_TIMEOUT_MS) {
        usleep(MOTOR_REWIND_POLL_MS * 1000);  // Convert ms to us
        elapsedMs += MOTOR_REWIND_POLL_MS;
        printCounter++;
        
        currentPos = readPos();
        
        // Calculate movement (should be negative for rewind, so prevPos > currentPos)
        int32_t diff = prevPos - currentPos;  // Positive if moving in negative direction
        
        // Print periodically based on MOTOR_REWIND_PRINT_INTERVAL
        if (printCounter >= MOTOR_REWIND_PRINT_INTERVAL) {
            xil_printf("[%d] P=%d D=%d\n\r", elapsedMs, currentPos, diff);
            printCounter = 0;
        }
        
        // Stall detection: threshold-based (low movement indicates stall)
        if (diff < MOTOR_REWIND_THRESHOLD) {
            stallCount++;
            xil_printf("Stall? D=%d %d/%d\n\r", diff, stallCount, MOTOR_REWIND_STALL_COUNT);
            
            if (stallCount >= MOTOR_REWIND_STALL_COUNT) {
                // Stall confirmed - stop motor
                // Set TAR_POS slightly ahead of current position to stop
                int32_t stopPos = currentPos + MOTOR_REWIND_OFFSET;
                
                volatile uint32_t *gpioOut = reinterpret_cast<volatile uint32_t *>(gpioOutBase);
                gpioOut[0] = (uint32_t)stopPos;  // TAR_POS
                
                xil_printf("STALL! P=%d\n\r", currentPos);
                result.completed = true;
                break;
            }
        } else {
            stallCount = 0;  // Reset if normal movement detected
        }
        
        prevPos = currentPos;
    }
    
    // Wait for motor to settle
    usleep(100000);  // 100ms
    
    // Clear override RPM (restore normal operation)
    setOverrideRpm(0);
    usleep(10000);  // 10ms delay for RPM setting to take effect
    
    result.finalPos = readPos();
    result.movement = startPos - result.finalPos;  // Total movement (positive value)
    if (result.movement < 0) result.movement = -result.movement;  // Ensure positive
    
    xil_printf("RW %s P=%d M=%d\n\r", result.completed ? "OK" : "TO", result.finalPos, result.movement);
    
    return result;
}

MotorController::Field::operator u32() const
{
    return (type == POS) ? (u32)owner->readPos() : owner->readRpm();
}


// ============================================================================
// Matcher Information Structure
// ============================================================================
struct MatcherInfo {
    char modelName[32];
    char makeDate[16];
    char serialNum[32];
    float inputCal[3];  // Voltage, Current, Phase
    float outputCal[3]; // Voltage, Current, Phase
    int32_t firstIndexPos[32]; // First encoder index position for each motor (max 32)
    int32_t motorLimits[2][4];  // [motor][min, max, lowerLimit, upperLimit] - 2 motors, 4 values each
    int32_t motorCaps[2][2];    // [motor][minCap, maxCap] - Capacitance in pF × 10
    float motorFitCoeffs[2][4]; // [motor][a0, a1, a2, a3] - Normalized fitting coefficients
    // Note: xMin=minValue, xRange=maxValue-minValue are derived from motorLimits, not stored separately
    // Stream Settings
    int32_t impStreamRate;       // Impedance stream rate (ms), default 100
    int32_t viStreamRate;        // V/I stream rate (ms), default 100
    int32_t motorPosStreamRate;  // Motor position polling rate (ms), default 100
    // VSWR Matching Thresholds
    float vswrStart;      // Start matching when VSWR >= this (default 1.04)
    float vswrStop;       // Stop matching when VSWR <= this (default 1.02)
    float vswrRestart;    // Restart matching if VSWR >= this (default 1.04)
    // AMS Settings
    int32_t amsInterval;      // AMS interval in ms (default 10)
    int32_t amsTimeout;       // AMS timeout in ms (default 0 = no timeout)
    int32_t amsLogInterval;   // AMS log interval (default 10)
};

// FRAM Address Map
enum FramMap {
    FRAM_ADDR_MODEL_NAME = 0x0000,
    FRAM_ADDR_MAKE_DATE  = 0x0020, // +32
    FRAM_ADDR_SERIAL_NUM = 0x0030, // +16
    FRAM_ADDR_INPUT_CAL  = 0x0050, // +32
    FRAM_ADDR_OUTPUT_CAL = 0x005C, // +12 (3 * 4 bytes)
    FRAM_ADDR_INDEX_POS  = 0x0068, // +128 (32 * 4 bytes) - First encoder index positions
    FRAM_ADDR_MOTOR_LIMITS = 0x00E8,  // +32 (2 motors * 4 values * 4 bytes)
    FRAM_ADDR_STREAM_SETTINGS = 0x0108,  // +12 (3 * 4 bytes: impRate, viRate, motorPosRate)
    FRAM_ADDR_MOTOR_CAPS = 0x011C,  // +16 (2 motors * 2 floats * 4 bytes: minCap, maxCap)
    FRAM_ADDR_MOTOR_FIT_COEFFS = 0x012C,  // +32 (2 motors * 4 floats * 4 bytes: a0, a1, a2, a3)
    // Note: xMin/xRange are derived from motorLimits, not stored separately
    FRAM_ADDR_VSWR_SETTINGS = 0x014C,  // +12 (3 floats * 4 bytes: vswrStart, vswrStop, vswrRestart)
    FRAM_ADDR_AMS_SETTINGS = 0x0158   // +12 (3 int32_t * 4 bytes: amsInterval, amsTimeout, amsLogInterval)
    // Next available: 0x0158 + 12 = 0x0164
};

// ============================================================================
// MotionBoard - Main unified class
// ============================================================================

class MotionBoard {
public:
    // Constructor: takes board address, motor indices, GPIO base addresses for both motors,
    // and extended GPIO base addresses for encoder index/stall/override RPM (GPIO 8/9)
    MotionBoard(u8 boardAddr,
                int m1Index, int m2Index,
                uintptr_t m1OutGpioBase, uintptr_t m1InGpioBase,
                uintptr_t m2OutGpioBase, uintptr_t m2InGpioBase,
                uintptr_t m1ExtGpioBase = 0, uintptr_t m2ExtGpioBase = 0);
    
    ~MotionBoard();
    
    // Initialization
    int initialize();
    
    // Motor access proxies
    MotorController M1;
    MotorController M2;
    
    // Matcher Info
    MatcherInfo matcherInfo;

    // DRV8711 driver settings per motor
    struct DriverSettings {
        u16 standbyVal;    // Control register value for standby (default: 553)
        u16 disableVal;    // Control register value for disable (default: 552)
        u16 regCtrl;       // CTRL register init value
        u16 regTorque;     // TORQUE register init value
        u16 regOff;        // OFF register init value
        u16 regBlank;      // BLANK register init value
        u16 regDecay;      // DECAY register init value
        u16 regStall;      // STALL register init value
        u16 regDrive;      // DRIVE register init value
        
        // Default constructor with DRV8711 default values (uses constants from header)
        DriverSettings() : standbyVal(DRV8711_CTRL_STANDBY), disableVal(DRV8711_CTRL_DISABLE), 
                           regCtrl(DRV8711_CTRL_DISABLE),
                           regTorque(DRV8711_DEF_TORQUE), regOff(DRV8711_DEF_OFF), 
                           regBlank(DRV8711_DEF_BLANK), regDecay(DRV8711_DEF_DECAY), 
                           regStall(DRV8711_DEF_STALL), regDrive(DRV8711_DEF_DRIVE) {}
    };
    
    DriverSettings drvSettings[2];  // Index 0 for SPI1, Index 1 for SPI2
    
    // Set driver settings (called from UI/command)
    void setDriverSettings(u8 spi, const DriverSettings& settings);

    // TeensyController methods (I2C communication)
    int initMotorBySpi(u8 spi);
    int HWReset(u8 spi);
    int setCtrlReg(u8 spi, u16 v);
    int setTorque(u8 spi, u16 v);
    int setOff(u8 spi, u16 v);
    int setBlank(u8 spi, u16 v);
    int setDecay(u8 spi, u16 v);
    int setStall(u8 spi, u16 v);
    int setDrive(u8 spi, u16 v);
    
    // FRAM operations
    int framRead(u16 framAddr, u8 len, u8* data);
    int framWrite(u16 framAddr, u8 len, u8* data);
    
    // Matcher Info Storage Methods
    int saveMatcherInfo();
    int loadMatcherInfo(RFSensor* iSensor = nullptr, RFSensor* oSensor = nullptr);
    int saveModelName();
    int saveMakeDate();
    int saveSerialNum();
    int loadProductInfo();  // Loads Model Name, Make Date, Serial Number and outputs SR command
    int saveCalibrationInfo();
    int loadCalibrationInfo(RFSensor* iSensor = nullptr, RFSensor* oSensor = nullptr);  // Applies calibration and outputs GC commands
    int saveFirstIndexPos();
    int loadFirstIndexPos();
    int saveFirstIndexPos(int motorIdx, int32_t pos);
    int saveMotorLimits();
    int loadMotorLimits();  // Applies motor limits and outputs MGL commands
    int saveMotorCaps();
    int loadMotorCaps();    // Loads motor capacitance values
    int saveMotorFitCoeffs();
    int loadMotorFitCoeffs();  // Loads motor fitting coefficients and outputs MFC commands
    int saveStreamSettings();
    int loadStreamSettings();  // Loads stream settings and outputs SST/MST commands
    int saveVswrSettings();
    int loadVswrSettings();    // Loads VSWR settings and outputs VSW command
    int saveAmsSettings();
    int loadAmsSettings();     // Loads AMS settings and outputs AST command
    
    // Motor initialization by encoder index (for boot sequence)
    int initializeMotorByIndex(MotorController& motor, int motorIdx);

    // Register operations (with explicit board address - for multi-board scenarios)
    int readReg(u8 boardAddr, u8 spi, u8 reg, u16* val);
    int writeReg(u8 boardAddr, u8 spi, u8 reg, u16 val);
    int getStatus(u8 boardAddr, u8 spi, u16* regs);
    
    // Control operations
    int resetDrv(u8 boardAddr, u8 spi);
    int setSleep(u8 boardAddr, u8 spi, u8 level);
    int setReset(u8 boardAddr, u8 spi, u8 level);
    
    // Helper functions
    u8 getBoardAddress(int boardNum) { return (boardNum == 1) ? BOARD1_ADDR : BOARD2_ADDR; }
    u8 getBoardAddr() const { return boardAddr; }

private:
    u8 boardAddr;  /* I2C slave address for this board instance */
    XIicPs iic;
    u8 txBuf[256];
    u8 rxBuf[256];
    
    // GPIO base addresses (stored for initialization)
    uintptr_t m1OutGpioBase;
    uintptr_t m1InGpioBase;
    uintptr_t m2OutGpioBase;
    uintptr_t m2InGpioBase;
    
    // Extended GPIO base addresses for encoder index/stall/override RPM (GPIO 8/9)
    uintptr_t m1ExtGpioBase;
    uintptr_t m2ExtGpioBase;
    
    // Low-level I2C communication
    int i2cSend(u8 addr, const u8* buf, u32 len);
    int i2cRecv(u8 addr, u8* buf, u32 len);
};

// MotionBoard implementation
MotionBoard::MotionBoard(u8 boardAddr,
                         int m1Index, int m2Index,
                         uintptr_t m1OutGpioBase, uintptr_t m1InGpioBase,
                         uintptr_t m2OutGpioBase, uintptr_t m2InGpioBase,
                         uintptr_t m1ExtGpioBase, uintptr_t m2ExtGpioBase)
    : boardAddr(boardAddr),
      m1OutGpioBase(m1OutGpioBase),
      m1InGpioBase(m1InGpioBase),
      m2OutGpioBase(m2OutGpioBase),
      m2InGpioBase(m2InGpioBase),
      m1ExtGpioBase(m1ExtGpioBase),
      m2ExtGpioBase(m2ExtGpioBase),
      M1(m1OutGpioBase, m1InGpioBase),
      M2(m2OutGpioBase, m2InGpioBase)
{
    memset(txBuf, 0, sizeof(txBuf));
    memset(rxBuf, 0, sizeof(rxBuf));
    memset(&matcherInfo, 0, sizeof(matcherInfo));
    
    // Set motor indices for FRAM storage
    M1.motorIndex = m1Index;
    M2.motorIndex = m2Index;
    
    // Initialize motor limits with defaults
    matcherInfo.motorLimits[0][0] = 0;      // M1 min
    matcherInfo.motorLimits[0][1] = 64000;  // M1 max
    matcherInfo.motorLimits[0][2] = 4000;   // M1 lowerLimit
    matcherInfo.motorLimits[0][3] = 60000;  // M1 upperLimit
    matcherInfo.motorLimits[1][0] = 0;      // M2 min
    matcherInfo.motorLimits[1][1] = 64000;  // M2 max
    matcherInfo.motorLimits[1][2] = 4000;   // M2 lowerLimit
    matcherInfo.motorLimits[1][3] = 60000;  // M2 upperLimit
    
    // Initialize motor capacitance with defaults (pF × 100)
    matcherInfo.motorCaps[0][0] = 0;        // M1 minCap (0 pF)
    matcherInfo.motorCaps[0][1] = 100000;   // M1 maxCap (1000.00 pF)
    matcherInfo.motorCaps[1][0] = 0;        // M2 minCap (0 pF)
    matcherInfo.motorCaps[1][1] = 100000;   // M2 maxCap (1000.00 pF)
    
    // Initialize motor fitting coefficients with zeros (not calibrated)
    for (int i = 0; i < 2; i++) {
        for (int j = 0; j < 4; j++) {
            matcherInfo.motorFitCoeffs[i][j] = 0.0f;
        }
    }
    
    // Initialize stream settings with defaults
    matcherInfo.impStreamRate = 100;        // 100ms
    matcherInfo.viStreamRate = 100;         // 100ms
    matcherInfo.motorPosStreamRate = 100;   // 100ms
    
    // Initialize VSWR settings with defaults
    matcherInfo.vswrStart = 1.04f;
    matcherInfo.vswrStop = 1.02f;
    matcherInfo.vswrRestart = 1.04f;
    
    // Initialize AMS settings with defaults
    matcherInfo.amsInterval = 10;      // 10ms
    matcherInfo.amsTimeout = 0;        // No timeout (continuous)
    matcherInfo.amsLogInterval = 10;   // Log every 10 iterations
}

MotionBoard::~MotionBoard() {}

int MotionBoard::initialize() {
    // Initialize I2C
    XIicPs_Config *Cfg = XIicPs_LookupConfig(IIC_DEVICE_ID);
    if(!Cfg) return XST_FAILURE;
    
    if(XIicPs_CfgInitialize(&iic, Cfg, Cfg->BaseAddress) != XST_SUCCESS) 
        return XST_FAILURE;
    
    if(XIicPs_SelfTest(&iic) != XST_SUCCESS) 
        return XST_FAILURE;
    
    if(XIicPs_SetSClk(&iic, IIC_SCLK_RATE) != XST_SUCCESS) 
        return XST_FAILURE;
    
    // Initialize GPIO for motors using base addresses
    if (M1.initializeGpio(m1OutGpioBase, m1InGpioBase) != XST_SUCCESS)
        return XST_FAILURE;
    
    if (M2.initializeGpio(m2OutGpioBase, m2InGpioBase) != XST_SUCCESS)
        return XST_FAILURE;
    
    // Initialize extended GPIO for encoder index/stall/override RPM (GPIO 8/9)
    // These are optional - only initialize if base address is provided
    if (m1ExtGpioBase != 0) {
        if (M1.initializeExtGpio(m1ExtGpioBase) != XST_SUCCESS) {
            xil_printf("Warning: M1 extended GPIO init failed\n\r");
        }
    }
    
    if (m2ExtGpioBase != 0) {
        if (M2.initializeExtGpio(m2ExtGpioBase) != XST_SUCCESS) {
            xil_printf("Warning: M2 extended GPIO init failed\n\r");
        }
    }
    
    return XST_SUCCESS;
}

// Private I2C communication methods
int MotionBoard::i2cSend(u8 addr, const u8* buf, u32 len) {
    if(XIicPs_MasterSendPolled(&iic, (u8*)buf, len, addr) != XST_SUCCESS) 
        return -1;
    while(XIicPs_BusIsBusy(&iic));
    return 0;
}

int MotionBoard::i2cRecv(u8 addr, u8* buf, u32 len) {
    if(XIicPs_MasterRecvPolled(&iic, buf, len, addr) != XST_SUCCESS) 
        return -1;
    while(XIicPs_BusIsBusy(&iic));
    return 0;
}

// Register operations
int MotionBoard::readReg(u8 boardAddr, u8 spi, u8 reg, u16* val) {
    txBuf[0] = CMD_READ_REG; 
    txBuf[1] = spi; 
    txBuf[2] = reg;
    
    if(i2cSend(boardAddr, txBuf, 3)) return -1;
    if(i2cRecv(boardAddr, rxBuf, 2)) return -1;
    
    *val = rxBuf[0] | (rxBuf[1] << 8);
    return 0;
}

int MotionBoard::writeReg(u8 boardAddr, u8 spi, u8 reg, u16 val) {
    txBuf[0] = CMD_WRITE_REG; 
    txBuf[1] = spi; 
    txBuf[2] = reg;
    txBuf[3] = val & 0xFF; 
    txBuf[4] = (val >> 8) & 0xFF;
    
    if(i2cSend(boardAddr, txBuf, 5)) return -1;
    if(i2cRecv(boardAddr, rxBuf, 1)) return -1;
    
    return (rxBuf[0] == 0) ? 0 : -1;
}

int MotionBoard::getStatus(u8 boardAddr, u8 spi, u16* regs) {
    txBuf[0] = CMD_GET_STATUS; 
    txBuf[1] = spi;
    
    if(i2cSend(boardAddr, txBuf, 2)) return -1;
    if(i2cRecv(boardAddr, rxBuf, 16)) return -1;
    
    for(int i = 0; i < 8; i++) {
        regs[i] = rxBuf[i*2] | (rxBuf[i*2+1] << 8);
    }
    return 0;
}

// Control operations
int MotionBoard::resetDrv(u8 boardAddr, u8 spi) {
    txBuf[0] = CMD_RESET; 
    txBuf[1] = spi;
    
    if(i2cSend(boardAddr, txBuf, 2)) return -1;
    if(i2cRecv(boardAddr, rxBuf, 1)) return -1;
    
    return (rxBuf[0] == 0) ? 0 : -1;
}

int MotionBoard::setSleep(u8 boardAddr, u8 spi, u8 level) {
    txBuf[0] = CMD_SET_SLEEP; 
    txBuf[1] = spi; 
    txBuf[2] = level ? 1 : 0;
    
    if(i2cSend(boardAddr, txBuf, 3)) return -1;
    if(i2cRecv(boardAddr, rxBuf, 1)) return -1;
    
    return (rxBuf[0] == 0) ? 0 : -1;
}

int MotionBoard::setReset(u8 boardAddr, u8 spi, u8 level) {
    txBuf[0] = CMD_SET_HW_RESET; 
    txBuf[1] = spi; 
    txBuf[2] = level ? 1 : 0;
    
    if(i2cSend(boardAddr, txBuf, 3)) return -1;
    if(i2cRecv(boardAddr, rxBuf, 1)) return -1;
    
    return (rxBuf[0] == 0) ? 0 : -1;
}

// Set driver settings
void MotionBoard::setDriverSettings(u8 spi, const DriverSettings& settings) {
    if (spi >= 1 && spi <= 2) {
        drvSettings[spi - 1] = settings;
    }
}

// High-level helpers - using instance's board address
int MotionBoard::initMotorBySpi(u8 spi)
{
    // Use dynamic driver settings (SPI 1 = index 0, SPI 2 = index 1)
    int idx = (spi >= 1 && spi <= 2) ? (spi - 1) : 0;
    const DriverSettings& ds = drvSettings[idx];
    
    struct { u8 reg; u16 val; } seq[] = {
        {0, ds.standbyVal},   // CTRL register (standby mode first)
        {0, ds.disableVal},   // CTRL register (disable for configuration)
        {1, ds.regTorque},    // TORQUE register
        {2, ds.regOff},       // OFF register
        {3, ds.regBlank},     // BLANK register
        {4, ds.regDecay},     // DECAY register
        {5, ds.regStall},     // STALL register
        {6, ds.regDrive}      // DRIVE register
    };
    for (unsigned i = 0; i < sizeof(seq)/sizeof(seq[0]); ++i) {
        if (writeReg(boardAddr, spi, seq[i].reg, seq[i].val) != 0) return -1;
        usleep(100000);
    }
    return 0;
}

int MotionBoard::setCtrlReg(u8 spi, u16 v) {
    int ret = writeReg(boardAddr, spi, ADDR_CTRL, v);
    usleep(100000);  // 100ms delay
    return ret;
}

int MotionBoard::HWReset(u8 spi)
{
    // reset_pin board spi 1 -> delay -> reset_pin board spi 0
    if (setReset(boardAddr, spi, 1) != 0) return -1;
    usleep(100000); // 100ms
    if (setReset(boardAddr, spi, 0) != 0) return -1;
    // Re-init motor on this board/spi
    return initMotorBySpi(spi);
}

int MotionBoard::setTorque(u8 spi, u16 v) { return writeReg(boardAddr, spi, ADDR_TORQUE, v); }
int MotionBoard::setOff(u8 spi, u16 v)    { return writeReg(boardAddr, spi, ADDR_OFF,    v); }
int MotionBoard::setBlank(u8 spi, u16 v)  { return writeReg(boardAddr, spi, ADDR_BLANK,  v); }
int MotionBoard::setDecay(u8 spi, u16 v)  { return writeReg(boardAddr, spi, ADDR_DECAY,  v); }
int MotionBoard::setStall(u8 spi, u16 v)  { return writeReg(boardAddr, spi, ADDR_STALL,  v); }
int MotionBoard::setDrive(u8 spi, u16 v)  { return writeReg(boardAddr, spi, ADDR_DRIVE,  v); }

int MotionBoard::framRead(u16 framAddr, u8 len, u8* data)
{
    txBuf[0] = CMD_FRAM_READ; 
    txBuf[1] = (framAddr >> 8) & 0xFF; 
    txBuf[2] = framAddr & 0xFF; 
    txBuf[3] = len;
    
    if(i2cSend(boardAddr, txBuf, 4)) return -1;
    usleep(5000);  /* 5ms delay for command processing */
    
    // Protocol correction: Slave returns [Header, Data...]
    // We read len + 1 bytes and skip the first byte (header)
    if(i2cRecv(boardAddr, rxBuf, len + 1)) return -1;
    
    // Debug print (raw bytes)
    // xil_printf("FRAM Read Addr 0x%04X Len %d Header %02X: ", framAddr, len, rxBuf[0]);
    for(int i = 0; i < len; i++) {
        data[i] = rxBuf[i + 1]; // Skip header byte
        // xil_printf("%02X ", data[i]);
    }
    // xil_printf("\n\r");
    
    return 0;
}

int MotionBoard::framWrite(u16 framAddr, u8 len, u8* data)
{
    txBuf[0] = CMD_FRAM_WRITE; 
    txBuf[1] = (framAddr >> 8) & 0xFF; 
    txBuf[2] = framAddr & 0xFF; 
    txBuf[3] = len;
    
    for(int i = 0; i < len; i++) {
        txBuf[4 + i] = data[i];
    }
    
    if(i2cSend(boardAddr, txBuf, 4 + len)) return -1;
    usleep(5000);  /* 5ms delay for command processing */
    if(i2cRecv(boardAddr, rxBuf, 1)) return -1;
    
    return (rxBuf[0] == 0) ? 0 : -1;
}

// Matcher Info Storage Implementation

int MotionBoard::saveMatcherInfo() {
    if (saveModelName() != 0) return -1;
    if (saveMakeDate() != 0) return -1;
    if (saveSerialNum() != 0) return -1;
    if (saveCalibrationInfo() != 0) return -1;
    if (saveFirstIndexPos() != 0) return -1;
    if (saveMotorLimits() != 0) return -1;
    if (saveMotorCaps() != 0) return -1;
    if (saveMotorFitCoeffs() != 0) return -1;
    return 0;
}

int MotionBoard::loadMatcherInfo(RFSensor* iSensor, RFSensor* oSensor) {
    // Add newline before starting to ensure proper parsing
    WebTerminal::print("\n\r");
    
    // Load each piece of information, print error if failed but continue
    // Each load function handles its own variable application and UI update
    if (loadProductInfo() != 0) {
        WebTerminal::print("Failed to load Product Info from FRAM\n\r");
    }
    
    if (loadCalibrationInfo(iSensor, oSensor) != 0) {
        WebTerminal::print("Failed to load Calibration Info from FRAM\n\r");
    }
    
    if (loadFirstIndexPos() != 0) {
        WebTerminal::print("Failed to load First Index Positions from FRAM\n\r");
    } 
    
    // Load Motor Caps BEFORE Motor Limits so MGL command includes correct cap values
    if (loadMotorCaps() != 0) {
        WebTerminal::print("Failed to load Motor Caps from FRAM\n\r");
    }
    
    // Load Motor Fit Coeffs BEFORE Motor Limits so capacitance calculation is ready
    if (loadMotorFitCoeffs() != 0) {
        WebTerminal::print("Failed to load Motor Fit Coeffs from FRAM\n\r");
    }
    
    if (loadMotorLimits() != 0) {
        WebTerminal::print("Failed to load Motor Limits from FRAM\n\r");
    }
    
    // Report Average Count for both sensors (RGA OpCode)
    if (iSensor) {
        WebTerminal::print("RGA,i,%d,EN\n\r", iSensor->getAvgCount());
        usleep(50000);  // 50ms delay
    }
    if (oSensor) {
        WebTerminal::print("RGA,o,%d,EN\n\r", oSensor->getAvgCount());
        usleep(50000);  // 50ms delay
    }
    
    // Load and report stream settings (SST + MST OpCodes)
    if (loadStreamSettings() != 0) {
        WebTerminal::print("Failed to load Stream Settings from FRAM\n\r");
    }
    
    // Load and report VSWR settings (VSW OpCode)
    if (loadVswrSettings() != 0) {
        WebTerminal::print("Failed to load VSWR Settings from FRAM\n\r");
    }
    
    return 0;
}

int MotionBoard::saveModelName() {
    return framWrite(FRAM_ADDR_MODEL_NAME, sizeof(matcherInfo.modelName), (u8*)matcherInfo.modelName);
}

int MotionBoard::saveMakeDate() {
    return framWrite(FRAM_ADDR_MAKE_DATE, sizeof(matcherInfo.makeDate), (u8*)matcherInfo.makeDate);
}

int MotionBoard::saveSerialNum() {
    return framWrite(FRAM_ADDR_SERIAL_NUM, sizeof(matcherInfo.serialNum), (u8*)matcherInfo.serialNum);
}

int MotionBoard::loadProductInfo() {
    // Load Model Name, Make Date, and Serial Number from FRAM
    int ret1 = framRead(FRAM_ADDR_MODEL_NAME, sizeof(matcherInfo.modelName), (u8*)matcherInfo.modelName);
    if (ret1 != 0) {
        WebTerminal::print("Failed to load Model Name from FRAM\n\r");
    }
    
    int ret2 = framRead(FRAM_ADDR_MAKE_DATE, sizeof(matcherInfo.makeDate), (u8*)matcherInfo.makeDate);
    if (ret2 != 0) {
        WebTerminal::print("Failed to load Make Date from FRAM\n\r");
    }
    
    int ret3 = framRead(FRAM_ADDR_SERIAL_NUM, sizeof(matcherInfo.serialNum), (u8*)matcherInfo.serialNum);
    if (ret3 != 0) {
        WebTerminal::print("Failed to load Serial Number from FRAM\n\r");
    }
    
    // Output DGI command after all product info is loaded (Model, Date, Serial)
    // Format: DGI,Model,Date,Serial,EN
    WebTerminal::print("DGI,%s,%s,%s,EN\n\r",
        matcherInfo.modelName, matcherInfo.makeDate, matcherInfo.serialNum);
    usleep(50000);  // 50ms delay before next command
    
    return (ret1 != 0 || ret2 != 0 || ret3 != 0) ? -1 : 0;
}

int MotionBoard::saveCalibrationInfo() {
    int ret = framWrite(FRAM_ADDR_INPUT_CAL, sizeof(matcherInfo.inputCal), (u8*)matcherInfo.inputCal);
    if (ret != 0) return ret;
    return framWrite(FRAM_ADDR_OUTPUT_CAL, sizeof(matcherInfo.outputCal), (u8*)matcherInfo.outputCal);
}

int MotionBoard::loadCalibrationInfo(RFSensor* iSensor, RFSensor* oSensor) {
    int ret = framRead(FRAM_ADDR_INPUT_CAL, sizeof(matcherInfo.inputCal), (u8*)matcherInfo.inputCal);
    if (ret != 0) {
        // Initialize with defaults if load failed
        matcherInfo.inputCal[0] = 1.0f;
        matcherInfo.inputCal[1] = 1.0f;
        matcherInfo.inputCal[2] = 0.0f;
    }
    
    int ret2 = framRead(FRAM_ADDR_OUTPUT_CAL, sizeof(matcherInfo.outputCal), (u8*)matcherInfo.outputCal);
    if (ret2 != 0) {
        // Initialize with defaults if load failed
        matcherInfo.outputCal[0] = 1.0f;
        matcherInfo.outputCal[1] = 1.0f;
        matcherInfo.outputCal[2] = 0.0f;
    }
    
    // Apply calibration to sensors if provided
    if (iSensor && oSensor) {
        iSensor->setVoltageGain(matcherInfo.inputCal[0]);
        iSensor->setCurrentGain(matcherInfo.inputCal[1]);
        iSensor->setPhaseDiffDeg(matcherInfo.inputCal[2]);
        
        oSensor->setVoltageGain(matcherInfo.outputCal[0]);
        oSensor->setCurrentGain(matcherInfo.outputCal[1]);
        oSensor->setPhaseDiffDeg(matcherInfo.outputCal[2]);
    }
    
    // Output UI update commands (RGC format)
    // Format: RGC,[i|o],[v_gain],[i_gain],[phase_deg],EN
    // Input sensor calibration
    WebTerminal::print("RGC,i,");
    WebTerminal::printFloat(matcherInfo.inputCal[0]);
    WebTerminal::print(",");
    WebTerminal::printFloat(matcherInfo.inputCal[1]);
    WebTerminal::print(",");
    WebTerminal::printFloat(matcherInfo.inputCal[2]);
    WebTerminal::print(",EN\n\r");
    
    usleep(50000);  // 50ms delay
    
    // Output sensor calibration
    WebTerminal::print("RGC,o,");
    WebTerminal::printFloat(matcherInfo.outputCal[0]);
    WebTerminal::print(",");
    WebTerminal::printFloat(matcherInfo.outputCal[1]);
    WebTerminal::print(",");
    WebTerminal::printFloat(matcherInfo.outputCal[2]);
    WebTerminal::print(",EN\n\r");
    
    usleep(50000);  // 50ms delay before next command
    
    return (ret != 0 || ret2 != 0) ? -1 : 0;
}

int MotionBoard::saveFirstIndexPos() {
    return framWrite(FRAM_ADDR_INDEX_POS, sizeof(matcherInfo.firstIndexPos), (u8*)matcherInfo.firstIndexPos);
}

int MotionBoard::loadFirstIndexPos() {
    int ret = framRead(FRAM_ADDR_INDEX_POS, sizeof(matcherInfo.firstIndexPos), (u8*)matcherInfo.firstIndexPos);
    
    WebTerminal::print("[LOAD] First Index Positions: M1=%d, M2=%d\n\r",
        matcherInfo.firstIndexPos[0], matcherInfo.firstIndexPos[1]);
    
    return ret;
}

int MotionBoard::saveFirstIndexPos(int motorIdx, int32_t pos) {
    if (motorIdx < 0 || motorIdx >= 32) return -1;
    matcherInfo.firstIndexPos[motorIdx] = pos;
    // Calculate address for this specific motor
    u16 addr = FRAM_ADDR_INDEX_POS + (motorIdx * sizeof(int32_t));
    return framWrite(addr, sizeof(int32_t), (u8*)&matcherInfo.firstIndexPos[motorIdx]);
}

int MotionBoard::saveMotorLimits() {
    WebTerminal::print("[SAVE] Saving motor limits to FRAM (addr=0x%04X, size=%d)\n\r",
        FRAM_ADDR_MOTOR_LIMITS, sizeof(matcherInfo.motorLimits));
    WebTerminal::print("[SAVE] Values to save:\n\r");
    WebTerminal::print("[SAVE]   M1: [0]=%d, [1]=%d, [2]=%d, [3]=%d\n\r",
        matcherInfo.motorLimits[0][0], matcherInfo.motorLimits[0][1],
        matcherInfo.motorLimits[0][2], matcherInfo.motorLimits[0][3]);
    WebTerminal::print("[SAVE]   M2: [0]=%d, [1]=%d, [2]=%d, [3]=%d\n\r",
        matcherInfo.motorLimits[1][0], matcherInfo.motorLimits[1][1],
        matcherInfo.motorLimits[1][2], matcherInfo.motorLimits[1][3]);
    
    // Save M1 and M2 separately to avoid FRAM page boundary or I2C buffer issues
    // M1: addr 0x00E8, size 16 bytes (4 int32_t values)
    int ret1 = framWrite(FRAM_ADDR_MOTOR_LIMITS, sizeof(matcherInfo.motorLimits[0]), (u8*)matcherInfo.motorLimits[0]);
    if (ret1 != 0) {
        WebTerminal::print("[SAVE] M1 FRAM write failed (ret=%d)\n\r", ret1);
        return ret1;
    }
    WebTerminal::print("[SAVE] M1 FRAM write successful\n\r");
    
    usleep(5000);  // 5ms delay between writes
    
    // M2: addr 0x00F8, size 16 bytes (4 int32_t values)
    u16 m2Addr = FRAM_ADDR_MOTOR_LIMITS + sizeof(matcherInfo.motorLimits[0]);
    int ret2 = framWrite(m2Addr, sizeof(matcherInfo.motorLimits[1]), (u8*)matcherInfo.motorLimits[1]);
    if (ret2 != 0) {
        WebTerminal::print("[SAVE] M2 FRAM write failed (ret=%d)\n\r", ret2);
        return ret2;
    }
    WebTerminal::print("[SAVE] M2 FRAM write successful\n\r");
    
    // Verify by reading back immediately
    int32_t verifyLimits[2][4];
    int verifyRet = framRead(FRAM_ADDR_MOTOR_LIMITS, sizeof(verifyLimits), (u8*)verifyLimits);
    if (verifyRet == 0) {
        WebTerminal::print("[SAVE] Verification read - M1: [0]=%d, [1]=%d, [2]=%d, [3]=%d\n\r",
            verifyLimits[0][0], verifyLimits[0][1], verifyLimits[0][2], verifyLimits[0][3]);
        WebTerminal::print("[SAVE] Verification read - M2: [0]=%d, [1]=%d, [2]=%d, [3]=%d\n\r",
            verifyLimits[1][0], verifyLimits[1][1], verifyLimits[1][2], verifyLimits[1][3]);
        
        if (verifyLimits[0][3] != matcherInfo.motorLimits[0][3]) {
            WebTerminal::print("[SAVE] ERROR: M1[3] mismatch! Written=%d, Read=%d\n\r",
                matcherInfo.motorLimits[0][3], verifyLimits[0][3]);
        }
        if (verifyLimits[1][3] != matcherInfo.motorLimits[1][3]) {
            WebTerminal::print("[SAVE] ERROR: M2[3] mismatch! Written=%d, Read=%d\n\r",
                matcherInfo.motorLimits[1][3], verifyLimits[1][3]);
        }
    } else {
        WebTerminal::print("[SAVE] Verification read failed (ret=%d)\n\r", verifyRet);
    }
    
    return (ret1 == 0 && ret2 == 0) ? 0 : -1;
}

int MotionBoard::loadMotorLimits() {
    WebTerminal::print("[LOAD] Reading motor limits from FRAM (addr=0x%04X, size=%d)\n\r",
        FRAM_ADDR_MOTOR_LIMITS, sizeof(matcherInfo.motorLimits));
    
    int ret = framRead(FRAM_ADDR_MOTOR_LIMITS, sizeof(matcherInfo.motorLimits), (u8*)matcherInfo.motorLimits);
    
    // If FRAM read failed, use defaults
    if (ret != 0) {
        WebTerminal::print("[LOAD] FRAM read failed (ret=%d), using defaults\n\r", ret);
        // FRAM read failed, use defaults
        M1.minValue = 0;
        M1.maxValue = 64000;
        M1.lowerLimit = 4000;
        M1.upperLimit = 60000;
        matcherInfo.motorLimits[0][0] = 0;
        matcherInfo.motorLimits[0][1] = 64000;
        matcherInfo.motorLimits[0][2] = 4000;
        matcherInfo.motorLimits[0][3] = 60000;
        
        M2.minValue = 0;
        M2.maxValue = 64000;
        M2.lowerLimit = 4000;
        M2.upperLimit = 60000;
        matcherInfo.motorLimits[1][0] = 0;
        matcherInfo.motorLimits[1][1] = 64000;
        matcherInfo.motorLimits[1][2] = 4000;
        matcherInfo.motorLimits[1][3] = 60000;
        
        WebTerminal::print("[LOAD] Applied defaults - M1: min=%d, max=%d, lowerLimit=%d, upperLimit=%d\n\r",
            M1.minValue, M1.maxValue, M1.lowerLimit, M1.upperLimit);
        WebTerminal::print("[LOAD] Applied defaults - M2: min=%d, max=%d, lowerLimit=%d, upperLimit=%d\n\r",
            M2.minValue, M2.maxValue, M2.lowerLimit, M2.upperLimit);
    } else {
        // FRAM read successful, use loaded values (including 0 values)
        WebTerminal::print("[LOAD] FRAM read successful. Raw values from FRAM:\n\r");
        WebTerminal::print("[LOAD]   M1: [0]=%d, [1]=%d, [2]=%d, [3]=%d\n\r",
            matcherInfo.motorLimits[0][0], matcherInfo.motorLimits[0][1],
            matcherInfo.motorLimits[0][2], matcherInfo.motorLimits[0][3]);
        WebTerminal::print("[LOAD]   M2: [0]=%d, [1]=%d, [2]=%d, [3]=%d\n\r",
            matcherInfo.motorLimits[1][0], matcherInfo.motorLimits[1][1],
            matcherInfo.motorLimits[1][2], matcherInfo.motorLimits[1][3]);
        
        M1.minValue = matcherInfo.motorLimits[0][0];
        M1.maxValue = matcherInfo.motorLimits[0][1];
        M1.lowerLimit = matcherInfo.motorLimits[0][2];
        M1.upperLimit = matcherInfo.motorLimits[0][3];
        
        M2.minValue = matcherInfo.motorLimits[1][0];
        M2.maxValue = matcherInfo.motorLimits[1][1];
        M2.lowerLimit = matcherInfo.motorLimits[1][2];
        M2.upperLimit = matcherInfo.motorLimits[1][3];
        
        WebTerminal::print("[LOAD] Applied values - M1: min=%d, max=%d, lowerLimit=%d, upperLimit=%d\n\r",
            M1.minValue, M1.maxValue, M1.lowerLimit, M1.upperLimit);
        WebTerminal::print("[LOAD] Applied values - M2: min=%d, max=%d, lowerLimit=%d, upperLimit=%d\n\r",
            M2.minValue, M2.maxValue, M2.lowerLimit, M2.upperLimit);
    }
    
    // Output UI update commands (MGL format with capacitance)
    // Format: MGL,idx,min,max,lower,upper,minCap,maxCap,pos,percent,cap,EN
    // Capacitance values are pF×10 (UI divides by 10 for display)
    WebTerminal::print("MGL,0,%d,%d,%d,%d,%d,%d,%d,%d,%d,EN\n\r",
        M1.minValue, M1.maxValue, M1.lowerLimit, M1.upperLimit,
        M1.minCap, M1.maxCap,
        M1.readPos(), M1.getPositionPercent(), M1.getCapacitance());
    
    usleep(50000);  // 50ms delay
    
    WebTerminal::print("MGL,1,%d,%d,%d,%d,%d,%d,%d,%d,%d,EN\n\r",
        M2.minValue, M2.maxValue, M2.lowerLimit, M2.upperLimit,
        M2.minCap, M2.maxCap,
        M2.readPos(), M2.getPositionPercent(), M2.getCapacitance());
    
    return ret;
}

int MotionBoard::saveMotorCaps() {
    WebTerminal::print("[SAVE] Saving motor caps to FRAM (addr=0x%04X, size=%d)\n\r",
        FRAM_ADDR_MOTOR_CAPS, sizeof(matcherInfo.motorCaps));
    // Values stored as pF×10, display as X.X pF
    WebTerminal::print("[SAVE] M1: minCap=%d.%d, maxCap=%d.%d | M2: minCap=%d.%d, maxCap=%d.%d pF\n\r",
        matcherInfo.motorCaps[0][0]/10, matcherInfo.motorCaps[0][0]%10,
        matcherInfo.motorCaps[0][1]/10, matcherInfo.motorCaps[0][1]%10,
        matcherInfo.motorCaps[1][0]/10, matcherInfo.motorCaps[1][0]%10,
        matcherInfo.motorCaps[1][1]/10, matcherInfo.motorCaps[1][1]%10);
    
    // Also update MotorController instances
    M1.minCap = matcherInfo.motorCaps[0][0];
    M1.maxCap = matcherInfo.motorCaps[0][1];
    M2.minCap = matcherInfo.motorCaps[1][0];
    M2.maxCap = matcherInfo.motorCaps[1][1];
    
    return framWrite(FRAM_ADDR_MOTOR_CAPS, sizeof(matcherInfo.motorCaps), (u8*)matcherInfo.motorCaps);
}

int MotionBoard::loadMotorCaps() {
    int ret = framRead(FRAM_ADDR_MOTOR_CAPS, sizeof(matcherInfo.motorCaps), (u8*)matcherInfo.motorCaps);
    
    if (ret != 0) {
        // FRAM read failed, use defaults (pF × 100)
        matcherInfo.motorCaps[0][0] = 0;
        matcherInfo.motorCaps[0][1] = 100000;  // 1000.00 pF
        matcherInfo.motorCaps[1][0] = 0;
        matcherInfo.motorCaps[1][1] = 100000;  // 1000.00 pF
    }
    
    // Apply to MotorController instances
    M1.minCap = matcherInfo.motorCaps[0][0];
    M1.maxCap = matcherInfo.motorCaps[0][1];
    M2.minCap = matcherInfo.motorCaps[1][0];
    M2.maxCap = matcherInfo.motorCaps[1][1];
    
    // Values stored as pF×100, display as X.XX pF
    WebTerminal::print("[LOAD] Motor Caps: M1=");
    WebTerminal::printFloat((float)M1.minCap / 100.0f);
    WebTerminal::print("~");
    WebTerminal::printFloat((float)M1.maxCap / 100.0f);
    WebTerminal::print(" pF, M2=");
    WebTerminal::printFloat((float)M2.minCap / 100.0f);
    WebTerminal::print("~");
    WebTerminal::printFloat((float)M2.maxCap / 100.0f);
    WebTerminal::print(" pF\n\r");
    
    return ret;
}

int MotionBoard::saveMotorFitCoeffs() {
    WebTerminal::print("[SAVE] Saving motor fitting coefficients to FRAM (addr=0x%04X, size=%d)\n\r",
        FRAM_ADDR_MOTOR_FIT_COEFFS, sizeof(matcherInfo.motorFitCoeffs));
    
    // Update MotorController instances - coefficients only
    // Note: xMin and xRange are derived from motorLimits (minValue, maxValue)
    for (int i = 0; i < 4; i++) {
        M1.fitCoeffs[i] = matcherInfo.motorFitCoeffs[0][i];
        M2.fitCoeffs[i] = matcherInfo.motorFitCoeffs[1][i];
    }
    
    WebTerminal::print("[SAVE] M1 Fit: a0=");
    WebTerminal::printFloat(matcherInfo.motorFitCoeffs[0][0]);
    WebTerminal::print(", a1=");
    WebTerminal::printFloat(matcherInfo.motorFitCoeffs[0][1]);
    WebTerminal::print(", a2=");
    WebTerminal::printFloat(matcherInfo.motorFitCoeffs[0][2]);
    WebTerminal::print(", a3=");
    WebTerminal::printFloat(matcherInfo.motorFitCoeffs[0][3]);
    WebTerminal::print("\n\r");
    
    WebTerminal::print("[SAVE] M2 Fit: a0=");
    WebTerminal::printFloat(matcherInfo.motorFitCoeffs[1][0]);
    WebTerminal::print(", a1=");
    WebTerminal::printFloat(matcherInfo.motorFitCoeffs[1][1]);
    WebTerminal::print(", a2=");
    WebTerminal::printFloat(matcherInfo.motorFitCoeffs[1][2]);
    WebTerminal::print(", a3=");
    WebTerminal::printFloat(matcherInfo.motorFitCoeffs[1][3]);
    WebTerminal::print("\n\r");
    
    // Save coefficients in two separate writes (16 bytes each) to avoid I2C buffer overflow
    // M1 coefficients: 4 floats = 16 bytes at base address
    int ret1 = framWrite(FRAM_ADDR_MOTOR_FIT_COEFFS, sizeof(matcherInfo.motorFitCoeffs[0]), (u8*)matcherInfo.motorFitCoeffs[0]);
    if (ret1 != 0) {
        WebTerminal::print("[SAVE] M1 FitCoeffs FRAM write failed\n\r");
        return ret1;
    }
    usleep(5000);  // 5ms delay between writes
    
    // M2 coefficients: 4 floats = 16 bytes at base address + 16
    u16 m2Addr = FRAM_ADDR_MOTOR_FIT_COEFFS + sizeof(matcherInfo.motorFitCoeffs[0]);
    int ret2 = framWrite(m2Addr, sizeof(matcherInfo.motorFitCoeffs[1]), (u8*)matcherInfo.motorFitCoeffs[1]);
    if (ret2 != 0) {
        WebTerminal::print("[SAVE] M2 FitCoeffs FRAM write failed\n\r");
        return ret2;
    }
    
    WebTerminal::print("[SAVE] Motor FitCoeffs saved successfully (M1 @ 0x%04X, M2 @ 0x%04X)\n\r",
        FRAM_ADDR_MOTOR_FIT_COEFFS, m2Addr);
    
    return 0;
}

int MotionBoard::loadMotorFitCoeffs() {
    // Read coefficients in two separate reads (16 bytes each) to avoid I2C buffer overflow
    // M1 coefficients: 4 floats = 16 bytes at base address
    int ret1 = framRead(FRAM_ADDR_MOTOR_FIT_COEFFS, sizeof(matcherInfo.motorFitCoeffs[0]), (u8*)matcherInfo.motorFitCoeffs[0]);
    if (ret1 != 0) {
        WebTerminal::print("[LOAD] M1 FitCoeffs FRAM read failed\n\r");
        for (int j = 0; j < 4; j++) {
            matcherInfo.motorFitCoeffs[0][j] = 0.0f;
        }
    }
    usleep(5000);  // 5ms delay between reads
    
    // M2 coefficients: 4 floats = 16 bytes at base address + 16
    u16 m2Addr = FRAM_ADDR_MOTOR_FIT_COEFFS + sizeof(matcherInfo.motorFitCoeffs[0]);
    int ret2 = framRead(m2Addr, sizeof(matcherInfo.motorFitCoeffs[1]), (u8*)matcherInfo.motorFitCoeffs[1]);
    if (ret2 != 0) {
        WebTerminal::print("[LOAD] M2 FitCoeffs FRAM read failed\n\r");
        for (int j = 0; j < 4; j++) {
            matcherInfo.motorFitCoeffs[1][j] = 0.0f;
        }
    }
    
    int ret = (ret1 != 0 || ret2 != 0) ? -1 : 0;
    
    // Apply to MotorController instances - coefficients only
    // Note: xMin and xRange are derived from motorLimits (minValue, maxValue)
    for (int i = 0; i < 4; i++) {
        M1.fitCoeffs[i] = matcherInfo.motorFitCoeffs[0][i];
        M2.fitCoeffs[i] = matcherInfo.motorFitCoeffs[1][i];
    }
    
    // Debug log: verify coefficients before sending
    WebTerminal::print("[DEBUG] M1 FitCoeffs: a0=");
    WebTerminal::printFloat(M1.fitCoeffs[0]);
    WebTerminal::print(", a1=");
    WebTerminal::printFloat(M1.fitCoeffs[1]);
    WebTerminal::print(", a2=");
    WebTerminal::printFloat(M1.fitCoeffs[2]);
    WebTerminal::print(", a3=");
    WebTerminal::printFloat(M1.fitCoeffs[3]);
    WebTerminal::print("\n\r");
    
    WebTerminal::print("[DEBUG] M2 FitCoeffs: a0=");
    WebTerminal::printFloat(M2.fitCoeffs[0]);
    WebTerminal::print(", a1=");
    WebTerminal::printFloat(M2.fitCoeffs[1]);
    WebTerminal::print(", a2=");
    WebTerminal::printFloat(M2.fitCoeffs[2]);
    WebTerminal::print(", a3=");
    WebTerminal::printFloat(M2.fitCoeffs[3]);
    WebTerminal::print("\n\r");
    
    usleep(100000);  // 100ms delay to ensure UART buffer is flushed
    
    // Output MFC commands for UI update
    // Format: MFC,idx,a0,a1,a2,a3,EN
    WebTerminal::print("MFC,0,");
    WebTerminal::printFloat(M1.fitCoeffs[0]);
    WebTerminal::print(",");
    WebTerminal::printFloat(M1.fitCoeffs[1]);
    WebTerminal::print(",");
    WebTerminal::printFloat(M1.fitCoeffs[2]);
    WebTerminal::print(",");
    WebTerminal::printFloat(M1.fitCoeffs[3]);
    WebTerminal::print(",EN\n\r");
    usleep(100000);  // 100ms delay between messages to prevent UART buffer overflow
    
    WebTerminal::print("MFC,1,");
    WebTerminal::printFloat(M2.fitCoeffs[0]);
    WebTerminal::print(",");
    WebTerminal::printFloat(M2.fitCoeffs[1]);
    WebTerminal::print(",");
    WebTerminal::printFloat(M2.fitCoeffs[2]);
    WebTerminal::print(",");
    WebTerminal::printFloat(M2.fitCoeffs[3]);
    WebTerminal::print(",EN\n\r");
    usleep(100000);  // 100ms delay after last message
    
    WebTerminal::print("[LOAD] Motor Fit Coeffs loaded from FRAM\n\r");
    
    return ret;
}

int MotionBoard::saveStreamSettings() {
    // Pack stream settings into a temporary buffer (3 values only)
    int32_t settings[3] = {
        matcherInfo.impStreamRate,
        matcherInfo.viStreamRate,
        matcherInfo.motorPosStreamRate
    };
    return framWrite(FRAM_ADDR_STREAM_SETTINGS, sizeof(settings), (u8*)settings);
}

int MotionBoard::loadStreamSettings() {
    int32_t settings[3];
    int ret = framRead(FRAM_ADDR_STREAM_SETTINGS, sizeof(settings), (u8*)settings);
    
    if (ret != 0) {
        // FRAM read failed, use defaults
        WebTerminal::print("[LOAD] Stream Settings: FRAM read failed, using defaults\n\r");
        matcherInfo.impStreamRate = 100;
        matcherInfo.viStreamRate = 100;
        matcherInfo.motorPosStreamRate = 100;
    } else {
        // Validate and apply loaded values
        matcherInfo.impStreamRate = (settings[0] >= 10 && settings[0] <= 5000) ? settings[0] : 100;
        matcherInfo.viStreamRate = (settings[1] >= 10 && settings[1] <= 5000) ? settings[1] : 100;
        matcherInfo.motorPosStreamRate = (settings[2] >= 10 && settings[2] <= 5000) ? settings[2] : 100;
        
        WebTerminal::print("[LOAD] Stream Settings: imp=%d, vi=%d, motorPos=%d\n\r",
            matcherInfo.impStreamRate, matcherInfo.viStreamRate, matcherInfo.motorPosStreamRate);
    }
    
    // Output UI update commands
    // SST: Sensor Stream Settings (Impedance rate, V/I rate)
    WebTerminal::print("SST,%d,%d,EN\n\r", matcherInfo.impStreamRate, matcherInfo.viStreamRate);
    usleep(50000);
    
    // MST: Motor Settings (position stream rate only)
    WebTerminal::print("MST,%d,EN\n\r", matcherInfo.motorPosStreamRate);
    usleep(50000);
    
    return ret;
}

int MotionBoard::saveVswrSettings() {
    float settings[3] = {
        matcherInfo.vswrStart,
        matcherInfo.vswrStop,
        matcherInfo.vswrRestart
    };
    
    WebTerminal::print("[SAVE] VSWR Settings: start=");
    WebTerminal::printFloat(matcherInfo.vswrStart);
    WebTerminal::print(", stop=");
    WebTerminal::printFloat(matcherInfo.vswrStop);
    WebTerminal::print(", restart=");
    WebTerminal::printFloat(matcherInfo.vswrRestart);
    WebTerminal::print("\n\r");
    
    return framWrite(FRAM_ADDR_VSWR_SETTINGS, sizeof(settings), (u8*)settings);
}

int MotionBoard::loadVswrSettings() {
    float settings[3];
    int ret = framRead(FRAM_ADDR_VSWR_SETTINGS, sizeof(settings), (u8*)settings);
    
    if (ret != 0) {
        // FRAM read failed, use defaults
        WebTerminal::print("[LOAD] VSWR Settings: FRAM read failed, using defaults\n\r");
        matcherInfo.vswrStart = 1.04f;
        matcherInfo.vswrStop = 1.02f;
        matcherInfo.vswrRestart = 1.04f;
    } else {
        // Validate and apply loaded values
        matcherInfo.vswrStart = (settings[0] >= 1.0f && settings[0] <= 10.0f) ? settings[0] : 1.04f;
        matcherInfo.vswrStop = (settings[1] >= 1.0f && settings[1] <= 5.0f) ? settings[1] : 1.02f;
        matcherInfo.vswrRestart = (settings[2] >= 1.0f && settings[2] <= 10.0f) ? settings[2] : 1.04f;
        
        WebTerminal::print("[LOAD] VSWR Settings: start=");
        WebTerminal::printFloat(matcherInfo.vswrStart);
        WebTerminal::print(", stop=");
        WebTerminal::printFloat(matcherInfo.vswrStop);
        WebTerminal::print(", restart=");
        WebTerminal::printFloat(matcherInfo.vswrRestart);
        WebTerminal::print("\n\r");
    }
    
    // Output VSW command for UI update
    // Format: VSW,start,stop,restart,EN
    WebTerminal::print("VSW,");
    WebTerminal::printFloat(matcherInfo.vswrStart);
    WebTerminal::print(",");
    WebTerminal::printFloat(matcherInfo.vswrStop);
    WebTerminal::print(",");
    WebTerminal::printFloat(matcherInfo.vswrRestart);
    WebTerminal::print(",EN\n\r");
    usleep(50000);
    
    return ret;
}

int MotionBoard::saveAmsSettings() {
    int32_t settings[3] = {
        matcherInfo.amsInterval,
        matcherInfo.amsTimeout,
        matcherInfo.amsLogInterval
    };
    
    WebTerminal::print("[SAVE] AMS Settings: interval=%d, timeout=%d, logInterval=%d\n\r",
                       matcherInfo.amsInterval, matcherInfo.amsTimeout, matcherInfo.amsLogInterval);
    
    return framWrite(FRAM_ADDR_AMS_SETTINGS, sizeof(settings), (u8*)settings);
}

int MotionBoard::loadAmsSettings() {
    int32_t settings[3];
    int ret = framRead(FRAM_ADDR_AMS_SETTINGS, sizeof(settings), (u8*)settings);
    
    if (ret != 0) {
        // FRAM read failed, use defaults
        WebTerminal::print("[LOAD] AMS Settings: FRAM read failed, using defaults\n\r");
        matcherInfo.amsInterval = 10;
        matcherInfo.amsTimeout = 0;
        matcherInfo.amsLogInterval = 10;
    } else {
        // Validate and apply loaded values
        matcherInfo.amsInterval = (settings[0] >= 1 && settings[0] <= 1000) ? settings[0] : 10;
        matcherInfo.amsTimeout = (settings[0] >= 0 && settings[1] <= 60000) ? settings[1] : 0;
        matcherInfo.amsLogInterval = (settings[2] >= 1 && settings[2] <= 1000) ? settings[2] : 10;
        
        WebTerminal::print("[LOAD] AMS Settings: interval=%d, timeout=%d, logInterval=%d\n\r",
                           matcherInfo.amsInterval, matcherInfo.amsTimeout, matcherInfo.amsLogInterval);
    }
    
    // Output AST command for UI update
    // Format: AST,interval,timeout,logInterval,EN
    WebTerminal::print("AST,%d,%d,%d,EN\n\r",
                       matcherInfo.amsInterval, matcherInfo.amsTimeout, matcherInfo.amsLogInterval);
    usleep(50000);
    
    return ret;
}

// Initialize motor by encoder index position
// 1. Rewind motor to physical limit
// 2. ARM origin-on-index (FPGA waits for index signal)
// 3. Move motor to find index (FPGA auto-sets origin when index detected)
int MotionBoard::initializeMotorByIndex(MotorController& motor, int motorIdx) {
    WebTerminal::print("[INIT] Motor %d: Starting index-based initialization...\n\r", motorIdx);
    
    // Step 1: Rewind motor to physical limit
    WebTerminal::print("[INIT] Motor %d: Rewinding to physical limit...\n\r", motorIdx);
    MotorController::RewindResult rewindResult = motor.rewindMotor();
    
    if (!rewindResult.completed) {
        WebTerminal::print("[INIT] Motor %d: Rewind timeout! Final pos=%d\n\r", motorIdx, rewindResult.finalPos);
        // Continue anyway, but log the warning
    } else {
        WebTerminal::print("[INIT] Motor %d: Rewind complete. Final pos=%d, movement=%d\n\r", 
            motorIdx, rewindResult.finalPos, rewindResult.movement);
    }
    
    // Step 2: ARM origin-on-index BEFORE moving
    // FPGA will wait for next encoder index signal and set origin to savedIndexPos
    int32_t savedIndexPos = matcherInfo.firstIndexPos[motorIdx];
    WebTerminal::print("[INIT] Motor %d: Arming origin-on-index (savedPos=%d)...\n\r", motorIdx, savedIndexPos);
    motor.SetMotorOriginOnIndex(savedIndexPos);
    usleep(10000);  // 10ms delay for FPGA to register
    
    // Step 3: Move motor to find index (FPGA will auto-set origin when index detected)
    int32_t indexSearchTarget = 15000;  // First index + margin (6400 steps per revolution)
    WebTerminal::print("[INIT] Motor %d: Searching for encoder index...\n\r", motorIdx);
    
    MotorController::IndexSearchResult indexResult = motor.findIndexPosition(indexSearchTarget, MOTOR_REWIND_OVERRIDE_RPM);
    
    if (!indexResult.found) {
        WebTerminal::print("[INIT] Motor %d: ERROR - Encoder index not found!\n\r", motorIdx);
        return -1;
    }
    
    WebTerminal::print("[INIT] Motor %d: Index found! IndexPos=%d, MotorPosAtIndex=%d\n\r", 
        motorIdx, indexResult.indexPos, indexResult.motorPosAtIndex);
    
    // Step 4: Origin is already set by FPGA when index was detected
    // No need to call SetMotorOrigin() - FPGA handled it automatically
    usleep(10000);  // 10ms delay for position to stabilize
    
    WebTerminal::print("[INIT] Motor %d: Initialization complete. Current pos=%d\n\r", 
        motorIdx, motor.readPos());
    
    return 0;
}

