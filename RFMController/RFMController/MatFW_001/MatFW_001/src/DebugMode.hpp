#pragma once

// DebugMode.hpp - Debug mode control library with console command system
// Reads debug mode status from GPIO connected to debug_mode_ctrl_0
// Channel 1: Input - reads debug mode status
// Channel 2: Output - sets debug mode (rising edge = debug, falling edge = auto matching)
// Uses direct register access for consistency with RFSensor

#include <stdint.h>
#include <string.h>
#include <stdlib.h>
#include <math.h>
#include "xil_types.h"
#include "xparameters.h"
#include "xil_printf.h"
#include "xstatus.h"
#include "sleep.h"
#include "Communication.hpp"
#include "RFSensor.hpp"
#include "MotionBoard.hpp"
#include "WebTerminal.hpp"
#include "MatchingAlgorithm.hpp"

// ============================================================================
// DebugMode Class
// ============================================================================

class DebugMode {
public:
    // Constructor: takes GPIO base address and references to sensors/board
    DebugMode(uintptr_t gpio_base, RFSensor* iSensor, RFSensor* oSensor, MotionBoard* mBoard)
        : gpio_base_(gpio_base), initialized_(false), 
          iSensor_(iSensor), oSensor_(oSensor), mBoard_(mBoard),
          impStreamEnabled_i_(false), impStreamEnabled_o_(false),
          viStreamEnabled_i_(false), viStreamEnabled_o_(false),
          motorPosStreamEnabled_(false),
          impStreamRate_i_(100), impStreamRate_o_(100),
          viStreamRate_i_(100), viStreamRate_o_(100),
          motorPosStreamRate_(100),
          lastImpStreamTime_i_(0), lastImpStreamTime_o_(0),
          lastViStreamTime_i_(0), lastViStreamTime_o_(0),
          lastMotorPosStreamTime_(0),
          amsEnabled_(false), amsMatching_(false), amsInterval_(10), amsTimeout_(5000),
          amsStartTime_(0), lastAmsTime_(0), amsVerbose_(true),
          amsLogInterval_(1), amsLogCounter_(0), loopCounter_(0) {
    }

    // Apply stream settings from MotionBoard's matcherInfo (call after loadMatcherInfo)
    void applyStreamSettingsFromBoard() {
        if (mBoard_) {
            impStreamRate_i_ = mBoard_->matcherInfo.impStreamRate;
            impStreamRate_o_ = mBoard_->matcherInfo.impStreamRate;
            viStreamRate_i_ = mBoard_->matcherInfo.viStreamRate;
            viStreamRate_o_ = mBoard_->matcherInfo.viStreamRate;
            motorPosStreamRate_ = mBoard_->matcherInfo.motorPosStreamRate;
            WebTerminal::print("DebugMode: Stream settings applied from FRAM\n\r");
        }
    }

    // Initialize GPIO
    int initialize() {
        if (gpio_base_ == 0U) {
            WebTerminal::print("DebugMode: Invalid GPIO base address\n\r");
            return XST_FAILURE;
        }

        // Get pointer to GPIO registers
        volatile uint32_t *gpio = reinterpret_cast<volatile uint32_t *>(gpio_base_);
        
        // Channel 1 is input (reading debug mode status from debug_mode_ctrl_0)
        // TRI register: 0xFFFFFFFF means all bits are inputs
        gpio[1] = 0xFFFFFFFFU;  // TRI register channel 1 (offset 0x4)
        
        // Channel 2 is output (setting debug mode: rising edge = debug, falling edge = auto matching)
        // TRI register: 0x00000000 means all bits are outputs
        gpio[3] = 0x00000000U;  // TRI register channel 2 (offset 0xC)
        
        // Initialize channel 2 to low (auto matching mode)
        gpio[2] = 0x00000000U;  // Data register channel 2 (offset 0x8)
        
        initialized_ = true;
        return XST_SUCCESS;
    }

    // Check if debug mode is active (reads from channel 1)
    bool isDebugMode() {
        if (!initialized_ || gpio_base_ == 0U) {
            return false;
        }
        
        // Read debug mode status from GPIO channel 1 data register
        volatile uint32_t *gpio = reinterpret_cast<volatile uint32_t *>(gpio_base_);
        u32 debugModeStatus = gpio[0];  // Data register channel 1 (offset 0x0)
        return (debugModeStatus & 0x01) != 0;  // Check bit 0
    }

    // Set debug mode (rising edge on channel 2)
    void setDebugMode() {
        if (!initialized_ || gpio_base_ == 0U) {
            return;
        }
        
        volatile uint32_t *gpio = reinterpret_cast<volatile uint32_t *>(gpio_base_);
        
        // Generate rising edge: low -> high
        gpio[2] = 0x00000000U;  // Data register channel 2 (offset 0x8)
        usleep(1000);  // Small delay
        gpio[2] = 0x00000001U;
        usleep(1000);  // Small delay to ensure signal is stable
    }

    // Set auto matching mode (falling edge on channel 2)
    void setAutoMatchingMode() {
        if (!initialized_ || gpio_base_ == 0U) {
            return;
        }
        
        volatile uint32_t *gpio = reinterpret_cast<volatile uint32_t *>(gpio_base_);
        
        // Generate falling edge: high -> low
        gpio[2] = 0x00000001U;  // Data register channel 2 (offset 0x8)
        usleep(1000);  // Small delay
        gpio[2] = 0x00000000U;
        usleep(1000);  // Small delay to ensure signal is stable
    }

    // Run command loop (called when in debug mode)
    void runCommandLoop() {
        WebTerminal::print("Debug Mode - Command Console\n\r");
        WebTerminal::print("Type 'dh' for available commands\n\r");
        
        char cmdBuffer[256];
        Communication::resetCommandState();
        
        // Buffer for FFT data (static to avoid stack overflow)
        static float fftBuffer[1024];

        while (isDebugMode()) {
            // Check if command received
            if (Communication::isReceiveComplete()) {
                uint16_t len = Communication::getRxBufferIndex();
                const char* rxBuf = Communication::getRxBuffer();
                
                // Copy command to buffer (null-terminate)
                int copyLen = (len < 255) ? len : 255;
                memcpy(cmdBuffer, rxBuf, copyLen);
                cmdBuffer[copyLen] = '\0';
                
                // Process command
                processCommand(cmdBuffer, fftBuffer);
                
                // Reset for next command
                Communication::resetCommandState();
            }
            
            // Handle Streaming
            handleStreaming();

            usleep(10000);  // Small delay to prevent busy loop
        }
        
        WebTerminal::print("Exiting Debug Mode\n\r");
        // Disable all streams on exit
        impStreamEnabled_i_ = false;
        impStreamEnabled_o_ = false;
        viStreamEnabled_i_ = false;
        viStreamEnabled_o_ = false;
        motorPosStreamEnabled_ = false;
    }

private:
    uintptr_t gpio_base_;
    bool initialized_;
    RFSensor* iSensor_;
    RFSensor* oSensor_;
    MotionBoard* mBoard_;
    
    // Streaming state
    bool impStreamEnabled_i_;
    bool impStreamEnabled_o_;
    bool viStreamEnabled_i_;
    bool viStreamEnabled_o_;
    bool motorPosStreamEnabled_;
    
    // Stream refresh rates (ms)
    int impStreamRate_i_;
    int impStreamRate_o_;
    int viStreamRate_i_;
    int viStreamRate_o_;
    int motorPosStreamRate_;
    
    // Last stream transmission times (us - microseconds)
    unsigned long lastImpStreamTime_i_;
    unsigned long lastImpStreamTime_o_;
    unsigned long lastViStreamTime_i_;
    unsigned long lastViStreamTime_o_;
    unsigned long lastMotorPosStreamTime_;
    
    // AMS (Auto Matching with Sensor) state
    bool amsEnabled_;           // AMS overall enabled (monitoring + matching)
    bool amsMatching_;          // Currently in matching mode (false = monitoring mode)
    int amsInterval_;           // Matching interval in ms (default 10)
    int amsTimeout_;            // Timeout in ms (default 5000, 0 = no timeout)
    unsigned long amsStartTime_;
    unsigned long lastAmsTime_;
    bool amsVerbose_;           // Terminal output enable (default true for debug mode)
    int amsLogInterval_;        // Log output every N iterations (default 1 = every time)
    int amsLogCounter_;         // Counter for log interval
    
    // Shared time counter (used by handleStreaming and handleAutoMatchCommand)
    unsigned long loopCounter_;

    void handleStreaming() {
        // Get current time in milliseconds (using class member loopCounter_)
        loopCounter_++;
        unsigned long currentTime = loopCounter_ * 10; // Approximate time based on 10ms loop delay
        
        // Impedance Streaming - Input Sensor
        if (impStreamEnabled_i_) {
            unsigned long elapsedMs = currentTime - lastImpStreamTime_i_;
            if (elapsedMs >= (unsigned long)impStreamRate_i_) {
                AveragedImpedanceResults res = iSensor_->calculateAveragedImpedance(-1); // Use class avgCount_
                WebTerminal::sendImpedance(res.resistanceR, res.reactanceX, res.voltageMagnitude, res.currentMagnitude, res.impedancePhaseDeg, true);
                lastImpStreamTime_i_ = currentTime;
            }
        }
        
        // Impedance Streaming - Output Sensor
        if (impStreamEnabled_o_) {
            unsigned long elapsedMs = currentTime - lastImpStreamTime_o_;
            if (elapsedMs >= (unsigned long)impStreamRate_o_) {
                AveragedImpedanceResults res = oSensor_->calculateAveragedImpedance(-1); // Use class avgCount_
                WebTerminal::sendImpedance(res.resistanceR, res.reactanceX, res.voltageMagnitude, res.currentMagnitude, res.impedancePhaseDeg, false);
                lastImpStreamTime_o_ = currentTime;
            }
        }

        // V/I Magnitude Streaming - Input Sensor
        if (viStreamEnabled_i_) {
            unsigned long elapsedMs = currentTime - lastViStreamTime_i_;
            if (elapsedMs >= (unsigned long)viStreamRate_i_) {
                AveragedImpedanceResults res = iSensor_->calculateAveragedImpedance(-1); // Use class avgCount_
                WebTerminal::sendVIMag(res.voltageMagnitude, res.currentMagnitude, true);
                lastViStreamTime_i_ = currentTime;
            }
        }
        
        // V/I Magnitude Streaming - Output Sensor
        if (viStreamEnabled_o_) {
            unsigned long elapsedMs = currentTime - lastViStreamTime_o_;
            if (elapsedMs >= (unsigned long)viStreamRate_o_) {
                AveragedImpedanceResults res = oSensor_->calculateAveragedImpedance(-1); // Use class avgCount_
                WebTerminal::sendVIMag(res.voltageMagnitude, res.currentMagnitude, false);
                lastViStreamTime_o_ = currentTime;
            }
        }

        // Motor Position Streaming - Both Motors (with capacitance)
        if (motorPosStreamEnabled_ && mBoard_) {
            unsigned long elapsedMs = currentTime - lastMotorPosStreamTime_;
            if (elapsedMs >= (unsigned long)motorPosStreamRate_) {
                WebTerminal::sendMotorPositionBoth(
                    mBoard_->M1.readPos(), mBoard_->M1.getPositionPercent(), mBoard_->M1.getCapacitance(),
                    mBoard_->M2.readPos(), mBoard_->M2.getPositionPercent(), mBoard_->M2.getCapacitance()
                );
                lastMotorPosStreamTime_ = currentTime;
            }
        }
        
        // AMS (Auto Matching with Sensor) - continuous monitoring + matching loop
        if (amsEnabled_ && iSensor_ && oSensor_ && mBoard_) {
            unsigned long elapsedTotal = currentTime - amsStartTime_;
            
            // Debug: Log AMS loop entry (every 100 loops to reduce spam, only if verbose)
            static unsigned long amsDebugCounter = 0;
            amsDebugCounter++;
            bool showDebug = amsVerbose_ && (amsDebugCounter % 100 == 1);
            
            if (showDebug) {
                WebTerminal::print("[AMS DEBUG] Loop: mode=%s, elapsed=%lu, timeout=%d\n\r",
                                   amsMatching_ ? "MATCHING" : "MONITORING", elapsedTotal, amsTimeout_);
            }
            
            // Check timeout (only if timeout > 0)
            if (amsTimeout_ > 0 && elapsedTotal >= (unsigned long)amsTimeout_) {
                amsEnabled_ = false;
                amsMatching_ = false;
                amsDebugCounter = 0;
                if (amsVerbose_) {
                    WebTerminal::print("AMS,TIMEOUT,%lu,EN\n\r", elapsedTotal);
                }
                WebTerminal::sendAck("ams", "TIMEOUT");
                return;
            }
            
            // Check interval
            unsigned long elapsedMs = currentTime - lastAmsTime_;
            if (elapsedMs >= (unsigned long)amsInterval_) {
                lastAmsTime_ = currentTime;
                
                // Increment log counter and check if we should output logs this iteration
                amsLogCounter_++;
                bool shouldLog = amsVerbose_ && (amsLogCounter_ >= amsLogInterval_);
                if (shouldLog) {
                    amsLogCounter_ = 0;
                }
                
                // 1. Read impedance from sensors
                AveragedImpedanceResults iRes = iSensor_->calculateAveragedImpedance(-1);
                AveragedImpedanceResults oRes = oSensor_->calculateAveragedImpedance(-1);
                
                double Rm = iRes.resistanceR;
                double Xm = iRes.reactanceX;
                double Rpm = oRes.resistanceR;
                double Xpm = oRes.reactanceX;
                
                // Output sensor values in ZI/ZO format (only every N iterations)
                if (shouldLog) {
                    WebTerminal::sendImpedance(iRes.resistanceR, iRes.reactanceX, 
                                               iRes.voltageMagnitude, iRes.currentMagnitude, 
                                               iRes.impedancePhaseDeg, true);
                    WebTerminal::sendImpedance(oRes.resistanceR, oRes.reactanceX, 
                                               oRes.voltageMagnitude, oRes.currentMagnitude, 
                                               oRes.impedancePhaseDeg, false);
                }
                
                // 2. Calculate VSWR
                double vswr = calculateVSWR(Rm, Xm);
                
                // Debug: Log VSWR (only every N iterations)
                if (shouldLog) {
                    WebTerminal::print("[AMS DEBUG] Mode=%s, VSWR=", amsMatching_ ? "MATCHING" : "MONITORING");
                    WebTerminal::printFloat((float)vswr);
                    WebTerminal::print(", Stop=");
                    WebTerminal::printFloat(mBoard_->matcherInfo.vswrStop);
                    WebTerminal::print(", Restart=");
                    WebTerminal::printFloat(mBoard_->matcherInfo.vswrRestart);
                    WebTerminal::print("\n\r");
                }
                
                // 3. State machine: Matching mode or Monitoring mode
                if (amsMatching_) {
                    // === MATCHING MODE ===
                    // Check if VSWR is below stop threshold -> transition to monitoring mode
                    if (vswr <= mBoard_->matcherInfo.vswrStop) {
                        amsMatching_ = false;  // Transition to monitoring mode
                        if (amsVerbose_) {
                            WebTerminal::print("AMS,MATCHED,");
                            WebTerminal::printFloat((float)vswr);
                            WebTerminal::print(",EN\n\r");
                        }
                        // Do not stop amsEnabled_, continue monitoring
                        return;
                    }
                    
                    // Still matching - run matching algorithm
                    // 4. Get current VVC capacitances
                    double VVC0_pF = (double)mBoard_->M1.getCapacitance() / 100.0;
                    double VVC1_pF = (double)mBoard_->M2.getCapacitance() / 100.0;
                    
                    // 5. Calculate matching goals
                    static MatchingAlgorithm amsMatchAlgo;
                    bool useOutputForRC = (vswr > 2.0);
                    MatchingGoals goals = amsMatchAlgo.calculateMatchingGoals(Rm, Xm, VVC0_pF, VVC1_pF,
                                                                            &mBoard_->M1, &mBoard_->M2,
                                                                            Rpm, Xpm, useOutputForRC);
                    
                    // 6. Check capacitance limits and select goal
                    int32_t cap0Goal0 = (int32_t)(goals.VVC0Goal0 * 100.0);
                    int32_t cap1Goal0 = (int32_t)(goals.VVC1Goal0 * 100.0);
                    int32_t cap0Goal1 = (int32_t)(goals.VVC0Goal1 * 100.0);
                    int32_t cap1Goal1 = (int32_t)(goals.VVC1Goal1 * 100.0);
                    
                    bool goal0_valid = goals.valid0 && 
                                       cap0Goal0 >= mBoard_->M1.minCap && cap0Goal0 <= mBoard_->M1.maxCap &&
                                       cap1Goal0 >= mBoard_->M2.minCap && cap1Goal0 <= mBoard_->M2.maxCap;
                    bool goal1_valid = goals.valid1 && 
                                       cap0Goal1 >= mBoard_->M1.minCap && cap0Goal1 <= mBoard_->M1.maxCap &&
                                       cap1Goal1 >= mBoard_->M2.minCap && cap1Goal1 <= mBoard_->M2.maxCap;
                    
                    if (shouldLog) {
                        WebTerminal::print("[AMS DEBUG] Goal0 valid=%d, Goal1 valid=%d\n\r",
                                           goal0_valid ? 1 : 0, goal1_valid ? 1 : 0);
                    }
                    
                    // 7. Move motors to selected goal
                    int32_t targetStep0 = 0, targetStep1 = 0;
                    int selectedGoal = -1;
                    
                    if (goal0_valid) {
                        selectedGoal = 0;
                        targetStep0 = goals.step0Goal0;
                        targetStep1 = goals.step1Goal0;
                    } else if (goal1_valid) {
                        selectedGoal = 1;
                        targetStep0 = goals.step0Goal1;
                        targetStep1 = goals.step1Goal1;
                    }
                    
                    if (selectedGoal >= 0) {
                        mBoard_->M1.RunMotor(targetStep0, true, 0);
                        mBoard_->M2.RunMotor(targetStep1, true, 0);
                        
                        if (shouldLog) {
                            WebTerminal::print("AMS,RUN,%d,", selectedGoal);
                            WebTerminal::printFloat((float)vswr);
                            WebTerminal::print(",%d,%d,EN\n\r", targetStep0, targetStep1);
                        }
                    } else {
                        if (shouldLog) {
                            WebTerminal::print("[AMS DEBUG] No valid goal!\n\r");
                        }
                    }
                } else {
                    // === MONITORING MODE ===
                    // Check if VSWR exceeds restart threshold -> transition to matching mode
                    if (vswr >= mBoard_->matcherInfo.vswrRestart) {
                        amsMatching_ = true;  // Transition to matching mode
                        if (amsVerbose_) {
                            WebTerminal::print("AMS,RESTART,");
                            WebTerminal::printFloat((float)vswr);
                            WebTerminal::print(",EN\n\r");
                        }
                    }
                    // In monitoring mode, just continue watching VSWR
                }
            }
        }
    }
    
    // Command processing
    void processCommand(const char* cmd, float* fftBuffer) {
        if (cmd == nullptr || strlen(cmd) == 0) {
            return;
        }
        
        // Echo command
        WebTerminal::print("> %s\n\r", cmd);
        
        // Tokenize command
        char tokens[16][64];  // Max 16 tokens, each max 64 chars
        int tokenCount = 0;
        const char* p = cmd;
        char* currentToken = tokens[0];
        int currentLen = 0;
        
        while (*p && tokenCount < 16) {
            if (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n') {
                if (currentLen > 0) {
                    *currentToken = '\0';
                    tokenCount++;
                    currentToken = tokens[tokenCount];
                    currentLen = 0;
                }
            } else if (currentLen < 63) {
                *currentToken++ = *p;
                currentLen++;
            }
            p++;
        }
        
        if (currentLen > 0) {
            *currentToken = '\0';
            tokenCount++;
        }
        
        if (tokenCount == 0) {
            return;
        }
        
        // Convert to lowercase (abbreviations are used as-is)
        expandAbbreviations(tokenCount, tokens);
        
        // Execute command
        executeCommand(tokenCount, tokens, fftBuffer);
    }
    
    // Convert command to lowercase (abbreviations are used as-is, no expansion)
    void expandAbbreviations(int argc, char argv[][64]) {
        if (argc == 0) return;
        
        // Convert all arguments to lowercase
        for (int i = 0; i < argc; i++) {
            char* arg = argv[i];
            int len = strlen(arg);
            for (int j = 0; j < len && j < 63; j++) {
                if (arg[j] >= 'A' && arg[j] <= 'Z') {
                    arg[j] = arg[j] + 32;
                }
            }
        }
    }
    
    void executeCommand(int argc, char argv[][64], float* fftBuffer) {
        if (argc == 0) return;
        
        const char* cmd = argv[0];
        
        // Commands are already lowercase from expandAbbreviations
        // New command pattern: [category][action][target]
        // Categories: r=RF, m=Motor, d=Device
        
        // Device commands (d*)
        if (strcmp(cmd, "dh") == 0) {
            printHelp();
            return;
        }
        if (strcmp(cmd, "da") == 0) {
            WebTerminal::print("Switching to Auto Matching Mode...\n\r");
            setAutoMatchingMode();
            return;
        }
        if (strcmp(cmd, "dsi") == 0 || strcmp(cmd, "dgi") == 0 ||
            strcmp(cmd, "dfb") == 0 || strcmp(cmd, "dfr") == 0 ||
            strcmp(cmd, "dfw") == 0) {
            handleDeviceCommand(argc, argv);
            return;
        }
        
        // RF Sensor commands (r*)
        if (strcmp(cmd, "ri") == 0 ||      // R-Init
            strcmp(cmd, "rrs") == 0 ||     // R-Run-Stream (impedance)
            strcmp(cmd, "rf") == 0 ||      // R-Fft
            strcmp(cmd, "rrv") == 0 ||     // R-Run-Vi
            strcmp(cmd, "rz") == 0 ||      // R-impedance(Z)
            strcmp(cmd, "rk") == 0 ||      // R-coupling(K)
            strcmp(cmd, "rr") == 0 ||      // R-Reset
            strcmp(cmd, "rsc") == 0 ||     // R-Set-Cal
            strcmp(cmd, "rgc") == 0 ||     // R-Get-Cal
            strcmp(cmd, "rsa") == 0 ||     // R-Set-Avg
            strcmp(cmd, "rga") == 0) {     // R-Get-Avg
            handleRfCommand(argc, argv, fftBuffer);
            return;
        }
        
        // Motor commands (m*) - all use 0-based index
        if (strcmp(cmd, "mi") == 0 ||      // M-Init
            strcmp(cmd, "mr") == 0 ||      // M-Run
            strcmp(cmd, "mf") == 0 ||      // M-Force
            strcmp(cmd, "mo") == 0 ||      // M-Origin
            strcmp(cmd, "mgp") == 0 ||     // M-Get-Pos
            strcmp(cmd, "msc") == 0 ||     // M-Set-Ctrl
            strcmp(cmd, "mst") == 0 ||     // M-Set-Torque
            strcmp(cmd, "mgs") == 0 ||     // M-Get-Status
            strcmp(cmd, "msd") == 0 ||     // M-Set-Driver
            strcmp(cmd, "msl") == 0 ||     // M-Set-Limits
            strcmp(cmd, "mgl") == 0 ||     // M-Get-Limits
            strcmp(cmd, "mfc") == 0 ||     // M-Fit-Coefficients
            strcmp(cmd, "mrp") == 0 ||     // M-Run-Position (stream)
            strcmp(cmd, "mss") == 0 ||     // M-Save-Setting
            strcmp(cmd, "msg") == 0 ||     // M-Setting-Get
            strcmp(cmd, "mgi") == 0 ||     // M-Get-Index (encoder index + stall)
            strcmp(cmd, "mor") == 0 ||     // M-Override-Rpm
            strcmp(cmd, "mfi") == 0 ||     // M-Find-Index (search index position)
            strcmp(cmd, "moi") == 0 ||     // M-Origin-on-Index (set origin on next index signal)
            strcmp(cmd, "mrw") == 0 ||     // M-Rewind (rewind to physical limit)
            strcmp(cmd, "mis") == 0 ||     // M-Index-Save (save first index pos to FRAM)
            strcmp(cmd, "msw") == 0 ||     // M-Sleep-Wake (control nSLEEP pin)
            strcmp(cmd, "mhr") == 0) {     // M-HW-Reset (hardware reset DRV8711)
            handleMotorCommand(argc, argv);
            return;
        }
        
        // Auto Matching Algorithm commands (a*)
        if (strcmp(cmd, "amc") == 0 ||     // A-Matching-Calculate (impedances)
            strcmp(cmd, "amg") == 0 ||     // A-Matching-Goals (VVC targets)
            strcmp(cmd, "amr") == 0 ||     // A-Matching-Run (move to goal)
            strcmp(cmd, "ams") == 0 ||     // A-Matching-Sensor (auto loop with sensors)
            strcmp(cmd, "asv") == 0 ||     // A-Set-Vswr (set VSWR thresholds)
            strcmp(cmd, "agv") == 0) {     // A-Get-Vswr (get VSWR thresholds)
            handleAutoMatchCommand(argc, argv);
            return;
        }
        
        WebTerminal::print("Unknown command: %s\n\r", cmd);
        WebTerminal::print("Type 'dh' for available commands\n\r");
    }
    
    void handleRfCommand(int argc, char argv[][64], float* fftBuffer) {
        const char* cmd = argv[0];
        RFSensor* sensor = nullptr;
        bool isInput = false;
        
        // Determine which sensor to use (i/o as second argument)
        if (argc > 1) {
            const char* arg = argv[1];
            if (strcmp(arg, "i") == 0) {
                sensor = iSensor_;
                isInput = true;
            } else if (strcmp(arg, "o") == 0) {
                sensor = oSensor_;
                isInput = false;
            }
        }
        
        // ri: RF Init
        if (strcmp(cmd, "ri") == 0) {
            if (!sensor) { WebTerminal::print("Usage: ri [i|o]\n\r"); return; }
            WebTerminal::print("Initializing ADC...\n\r");
            sensor->initializeAdc();
            WebTerminal::print("ADC initialized\n\r");
            return;
        }

        // rrs: RF Run Stream (impedance)
        if (strcmp(cmd, "rrs") == 0) {
            if (argc < 3) { WebTerminal::print("Usage: rrs [i|o] [run|stop] [rate_ms]\n\r"); return; }
            bool run = (strcmp(argv[2], "run") == 0);
            
            if (run && argc >= 4) {
                int rate = atoi(argv[3]);
                if (rate >= 10 && rate <= 5000) {
                    if (isInput) impStreamRate_i_ = rate;
                    else impStreamRate_o_ = rate;
                }
            }
            
            if (isInput) impStreamEnabled_i_ = run;
            else impStreamEnabled_o_ = run;
            WebTerminal::sendAck("rrs", run ? "RUN" : "STOP");
        }
        // rf: RF FFT
        else if (strcmp(cmd, "rf") == 0) {
            if (!sensor) { WebTerminal::print("Usage: rf [i|o]\n\r"); return; }
            sensor->getFftData(fftBuffer);
            WebTerminal::sendFftData(fftBuffer, 1024, isInput);
            sensor->getFftDataCurrent(fftBuffer);
            WebTerminal::sendFftDataCurrent(fftBuffer, 1024, isInput);
        }
        // rrv: RF Run V/I stream
        else if (strcmp(cmd, "rrv") == 0) {
            if (argc < 3) { WebTerminal::print("Usage: rrv [i|o] [run|stop] [rate_ms]\n\r"); return; }
            bool run = (strcmp(argv[2], "run") == 0);
            
            if (run && argc >= 4) {
                int rate = atoi(argv[3]);
                if (rate >= 10 && rate <= 5000) {
                    if (isInput) viStreamRate_i_ = rate;
                    else viStreamRate_o_ = rate;
                }
            }
            
            if (isInput) viStreamEnabled_i_ = run;
            else viStreamEnabled_o_ = run;
            WebTerminal::sendAck("rrv", run ? "RUN" : "STOP");
        }
        // rsc: RF Set Calibration
        else if (strcmp(cmd, "rsc") == 0) {
            if (!sensor || argc < 4) { WebTerminal::print("Usage: rsc [i|o] [v|i|p] [value]\n\r"); return; }
            const char* type = argv[2];
            float val = atof(argv[3]);
            
            if (strcmp(type, "v") == 0) sensor->setVoltageGain(val);
            else if (strcmp(type, "i") == 0) sensor->setCurrentGain(val);
            else if (strcmp(type, "p") == 0) sensor->setPhaseDiffDeg(val);
            
            if (mBoard_) {
                float* calArray = (sensor == iSensor_) ? mBoard_->matcherInfo.inputCal : mBoard_->matcherInfo.outputCal;
                if (strcmp(type, "v") == 0) calArray[0] = val;
                else if (strcmp(type, "i") == 0) calArray[1] = val;
                else if (strcmp(type, "p") == 0) calArray[2] = val;
                
                if (mBoard_->saveCalibrationInfo() == 0) {
                    WebTerminal::print("Saved Cal: ");
                    WebTerminal::printFloat(val);
                    WebTerminal::print(" (Type: %s)\n\r", type);
                    WebTerminal::sendAck("rsc", "OK_SAVED");
                } else {
                    WebTerminal::print("Failed to save Cal\n\r");
                    WebTerminal::sendAck("rsc", "OK_SAVE_FAIL");
                }
            } else {
                WebTerminal::sendAck("rsc", "OK");
            }
        }
        // rgc: RF Get Calibration
        else if (strcmp(cmd, "rgc") == 0) {
            if (!sensor) { WebTerminal::print("Usage: rgc [i|o]\n\r"); return; }
            WebTerminal::print("RGC,%s,", isInput ? "i" : "o");
            WebTerminal::printFloat(sensor->voltageGain());
            WebTerminal::print(",");
            WebTerminal::printFloat(sensor->currentGain());
            WebTerminal::print(",");
            WebTerminal::printFloat(sensor->phaseDiffDeg());
            WebTerminal::print(",EN\n\r");
        }
        // rk: RF coupling (relay)
        else if (strcmp(cmd, "rk") == 0) {
            if (!sensor || argc < 3) { WebTerminal::print("Usage: rk [i|o] [ac|dc]\n\r"); return; }
            bool ac = (strcmp(argv[2], "ac") == 0);
            uint16_t config = ac ? kRelayConfig_AC_ON_LowGain : kRelayConfig_AC_OFF_LowGain;
            sensor->pulseRelay(config);
            WebTerminal::sendAck("rk", ac ? "AC" : "DC");
        }
        // rr: RF Reset
        else if (strcmp(cmd, "rr") == 0) {
            if (!sensor) { WebTerminal::print("Usage: rr [i|o]\n\r"); return; }
            sensor->resetSettings();
            WebTerminal::sendAck("rr", "OK");
        }
        // rz: RF impedance (single shot)
        else if (strcmp(cmd, "rz") == 0) {
            if (!sensor) { WebTerminal::print("Usage: rz [i|o] [avg]\n\r"); return; }
            int avg = (argc >= 3) ? atoi(argv[2]) : -1;
            AveragedImpedanceResults res = sensor->calculateAveragedImpedance(avg);
            WebTerminal::sendImpedance(res.resistanceR, res.reactanceX, res.voltageMagnitude, res.currentMagnitude, res.impedancePhaseDeg, isInput);
        }
        // rsa: RF Set Average
        else if (strcmp(cmd, "rsa") == 0) {
            if (!sensor || argc < 3) { 
                WebTerminal::print("Usage: rsa [i|o] [count]\n\r"); 
                return; 
            }
            int count = atoi(argv[2]);
            if (count < 1 || count > 512) {
                WebTerminal::print("Error: Average count must be between 1 and 512\n\r");
                return;
            }
            sensor->setAvgCount(count);
            WebTerminal::print("Set avg count for %s sensor: %d\n\r", isInput ? "input" : "output", count);
            WebTerminal::sendAck("rsa", "OK");
        }
        // rga: RF Get Average
        else if (strcmp(cmd, "rga") == 0) {
            if (!sensor) { WebTerminal::print("Usage: rga [i|o]\n\r"); return; }
            int count = sensor->getAvgCount();
            WebTerminal::print("RGA,%s,%d,EN\n\r", isInput ? "i" : "o", count);
        }
        else {
            WebTerminal::print("Unknown RF command: %s\n\r", cmd);
        }
    }
    
    void handleDeviceCommand(int argc, char argv[][64]) {
        const char* cmd = argv[0];
        
        // dsi: Device Set Info
        if (strcmp(cmd, "dsi") == 0) {
            if (argc < 2) { WebTerminal::print("Usage: dsi [Model,Date,Serial]\n\r"); return; }
            if (mBoard_) {
                char* args = argv[1];
                char* model = args;
                char* date = strchr(model, ',');
                char* serial = nullptr;
                
                if (date) {
                    *date = '\0';
                    date++;
                    serial = strchr(date, ',');
                    if (serial) {
                        *serial = '\0';
                        serial++;
                    }
                }

                if (model && date && serial) {
                    strncpy(mBoard_->matcherInfo.modelName, model, sizeof(mBoard_->matcherInfo.modelName) - 1);
                    strncpy(mBoard_->matcherInfo.makeDate, date, sizeof(mBoard_->matcherInfo.makeDate) - 1);
                    strncpy(mBoard_->matcherInfo.serialNum, serial, sizeof(mBoard_->matcherInfo.serialNum) - 1);
                    
                    if (mBoard_->saveMatcherInfo() == 0) {
                         WebTerminal::print("Info Saved: %s, %s, %s\n\r", 
                            mBoard_->matcherInfo.modelName, 
                            mBoard_->matcherInfo.makeDate, 
                            mBoard_->matcherInfo.serialNum);
                         WebTerminal::sendAck("dsi", "OK");
                    } else {
                        WebTerminal::sendAck("dsi", "SAVE_FAIL");
                    }
                } else {
                    WebTerminal::print("Invalid format. Use: dsi Model,Date,Serial\n\r");
                }
            }
        }
        // dgi: Device Get Info
        else if (strcmp(cmd, "dgi") == 0) {
            if (mBoard_) {
                WebTerminal::print("DGI,%s,%s,%s,EN\n\r", 
                    mBoard_->matcherInfo.modelName, 
                    mBoard_->matcherInfo.makeDate, 
                    mBoard_->matcherInfo.serialNum);
            }
        }
        // dfb: Device FRAM Backup - dump all FRAM data as hex
        // Usage: dfb [length] - default 336 bytes (0x150)
        else if (strcmp(cmd, "dfb") == 0) {
            if (!mBoard_) {
                WebTerminal::print("Error: MotionBoard not available\n\r");
                return;
            }
            
            // FRAM size to backup - can be specified as argument
            u16 FRAM_BACKUP_SIZE = 0x0150;  // Default: 336 bytes
            if (argc >= 2) {
                FRAM_BACKUP_SIZE = (u16)atoi(argv[1]);
                if (FRAM_BACKUP_SIZE > 2048) FRAM_BACKUP_SIZE = 2048;  // Max 2KB
                if (FRAM_BACKUP_SIZE < 16) FRAM_BACKUP_SIZE = 16;  // Min 16 bytes
            }
            const u8 CHUNK_SIZE = 32;  // Read in chunks to avoid buffer overflow
            
            WebTerminal::print("=== FRAM BACKUP START ===\n\r");
            WebTerminal::print("DFB,%d,", FRAM_BACKUP_SIZE);  // Include size in output
            
            u8 buffer[CHUNK_SIZE];
            for (u16 addr = 0; addr < FRAM_BACKUP_SIZE; addr += CHUNK_SIZE) {
                u8 readLen = (addr + CHUNK_SIZE > FRAM_BACKUP_SIZE) ? (FRAM_BACKUP_SIZE - addr) : CHUNK_SIZE;
                
                if (mBoard_->framRead(addr, readLen, buffer) == 0) {
                    for (u8 i = 0; i < readLen; i++) {
                        WebTerminal::print("%02X", buffer[i]);
                    }
                } else {
                    WebTerminal::print("\n\rError reading FRAM at 0x%04X\n\r", addr);
                    return;
                }
                usleep(5000);  // 5ms delay between chunks
            }
            
            WebTerminal::print(",EN\n\r");
            WebTerminal::print("=== FRAM BACKUP END (size=%d bytes) ===\n\r", FRAM_BACKUP_SIZE);
        }
        // dfr: Device FRAM Restore - write hex data to FRAM
        // Usage: dfr [length] [hex_data]
        else if (strcmp(cmd, "dfr") == 0) {
            if (argc < 3) {
                WebTerminal::print("Usage: dfr [length] [hex_data]\n\r");
                WebTerminal::print("  Restore FRAM from hex string (from dfb output)\n\r");
                WebTerminal::print("  Example: dfr 336 4D6F64656C...\n\r");
                return;
            }
            if (!mBoard_) {
                WebTerminal::print("Error: MotionBoard not available\n\r");
                return;
            }
            
            int expectedLen = atoi(argv[1]);
            const char* hexData = argv[2];
            int hexLen = strlen(hexData);
            int byteCount = hexLen / 2;
            
            if (byteCount != expectedLen) {
                WebTerminal::print("Warning: Expected %d bytes, got %d bytes\n\r", expectedLen, byteCount);
            }
            
            if (hexLen % 2 != 0) {
                WebTerminal::print("Error: Hex string must have even length\n\r");
                return;
            }
            
            if (byteCount > 512) {
                WebTerminal::print("Error: Data too large (max 512 bytes)\n\r");
                return;
            }
            
            WebTerminal::print("Restoring FRAM: %d bytes...\n\r", byteCount);
            
            const u8 CHUNK_SIZE = 32;
            u8 buffer[CHUNK_SIZE];
            u16 addr = 0;
            int hexIdx = 0;
            
            while (hexIdx < hexLen) {
                // Parse chunk of hex data
                u8 chunkLen = 0;
                while (chunkLen < CHUNK_SIZE && hexIdx < hexLen) {
                    char highNibble = hexData[hexIdx++];
                    char lowNibble = hexData[hexIdx++];
                    
                    // Convert hex char to value
                    u8 high = (highNibble >= 'A') ? (highNibble - 'A' + 10) : 
                              (highNibble >= 'a') ? (highNibble - 'a' + 10) : (highNibble - '0');
                    u8 low = (lowNibble >= 'A') ? (lowNibble - 'A' + 10) : 
                             (lowNibble >= 'a') ? (lowNibble - 'a' + 10) : (lowNibble - '0');
                    
                    buffer[chunkLen++] = (high << 4) | low;
                }
                
                // Write chunk to FRAM
                if (mBoard_->framWrite(addr, chunkLen, buffer) != 0) {
                    WebTerminal::print("Error writing FRAM at 0x%04X\n\r", addr);
                    return;
                }
                
                addr += chunkLen;
                usleep(5000);  // 5ms delay between chunks
            }
            
            WebTerminal::print("FRAM restored: %d bytes written\n\r", byteCount);
            WebTerminal::sendAck("dfr", "OK");
        }
        // dfw: Device FRAM Write (single address) - for debugging
        else if (strcmp(cmd, "dfw") == 0) {
            if (argc < 3) {
                WebTerminal::print("Usage: dfw [addr_hex] [data_hex]\n\r");
                WebTerminal::print("  Write single byte to FRAM\n\r");
                WebTerminal::print("  Example: dfw 0050 1A\n\r");
                return;
            }
            if (!mBoard_) {
                WebTerminal::print("Error: MotionBoard not available\n\r");
                return;
            }
            
            // Parse address (hex)
            u16 addr = 0;
            const char* addrStr = argv[1];
            for (int i = 0; addrStr[i]; i++) {
                char c = addrStr[i];
                u8 val = (c >= 'A') ? (c - 'A' + 10) : (c >= 'a') ? (c - 'a' + 10) : (c - '0');
                addr = (addr << 4) | val;
            }
            
            // Parse data (hex bytes)
            const char* dataStr = argv[2];
            int dataLen = strlen(dataStr);
            u8 byteCount = dataLen / 2;
            u8 buffer[64];
            
            if (byteCount > 64) byteCount = 64;
            
            for (int i = 0; i < byteCount; i++) {
                char high = dataStr[i * 2];
                char low = dataStr[i * 2 + 1];
                u8 highVal = (high >= 'A') ? (high - 'A' + 10) : (high >= 'a') ? (high - 'a' + 10) : (high - '0');
                u8 lowVal = (low >= 'A') ? (low - 'A' + 10) : (low >= 'a') ? (low - 'a' + 10) : (low - '0');
                buffer[i] = (highVal << 4) | lowVal;
            }
            
            if (mBoard_->framWrite(addr, byteCount, buffer) == 0) {
                WebTerminal::print("FRAM write OK: addr=0x%04X, len=%d\n\r", addr, byteCount);
                WebTerminal::sendAck("dfw", "OK");
            } else {
                WebTerminal::print("FRAM write failed at 0x%04X\n\r", addr);
                WebTerminal::sendAck("dfw", "FAIL");
            }
        }
        else {
            WebTerminal::print("Unknown Device command: %s\n\r", cmd);
        }
    }
    
    void handleAutoMatchCommand(int argc, char argv[][64]) {
        const char* cmd = argv[0];
        
        // Create matching algorithm instance (precomputes constants)
        static MatchingAlgorithm matchAlgo;
        
        // amc: Auto Matching Calculate - calculate all impedance points
        // Usage: amc <Rm> <Xm> [Rpm] [Xpm]
        // Output: AMC,RA,XA,RB,XB,RC,XC,RD,XD,RE,XE,Rp,Xp,VSWR,EN
        if (strcmp(cmd, "amc") == 0) {
            if (argc < 3) {
                WebTerminal::print("Usage: amc <Rm> <Xm> [Rpm] [Xpm]\n\r");
                WebTerminal::print("  Calculate impedance at A,B,C,D,P points\n\r");
                WebTerminal::print("  Uses current VVC positions from motors\n\r");
                WebTerminal::print("  Rpm/Xpm: Optional output sensor values\n\r");
                return;
            }
            if (!mBoard_) {
                WebTerminal::print("Error: MotionBoard not available\n\r");
                return;
            }
            
            double Rm = atof(argv[1]);
            double Xm = atof(argv[2]);
            
            // Parse optional output sensor values
            double Rpm = 0.0, Xpm = 0.0;
            if (argc >= 5) {
                Rpm = atof(argv[3]);
                Xpm = atof(argv[4]);
            }
            
            // Calculate VSWR from input sensor
            double vswr = calculateVSWR(Rm, Xm);
            
            // Get current VVC capacitances from motors (pF × 100 → pF)
            double VVC0_pF = (double)mBoard_->M1.getCapacitance() / 100.0;
            double VVC1_pF = (double)mBoard_->M2.getCapacitance() / 100.0;
            
            // Calculate all impedance points
            ImpedancePoints pts = matchAlgo.calculateImpedances(Rm, Xm, VVC0_pF, VVC1_pF);
            
            // Output result (xil_printf doesn't support %f, use printFloat)
            WebTerminal::print("AMC,");
            WebTerminal::printFloat((float)pts.RA); WebTerminal::print(",");
            WebTerminal::printFloat((float)pts.XA); WebTerminal::print(",");
            WebTerminal::printFloat((float)pts.RB); WebTerminal::print(",");
            WebTerminal::printFloat((float)pts.XB); WebTerminal::print(",");
            WebTerminal::printFloat((float)pts.RC); WebTerminal::print(",");
            WebTerminal::printFloat((float)pts.XC); WebTerminal::print(",");
            WebTerminal::printFloat((float)pts.RD); WebTerminal::print(",");
            WebTerminal::printFloat((float)pts.XD); WebTerminal::print(",");
            WebTerminal::printFloat((float)pts.RE); WebTerminal::print(",");
            WebTerminal::printFloat((float)pts.XE); WebTerminal::print(",");
            WebTerminal::printFloat((float)pts.Rp); WebTerminal::print(",");
            WebTerminal::printFloat((float)pts.Xp); WebTerminal::print(",");
            WebTerminal::printFloat((float)vswr); WebTerminal::print(",EN\n\r");
            
            WebTerminal::print("Input:  R=");
            WebTerminal::printFloat((float)Rm);
            WebTerminal::print(", X=");
            WebTerminal::printFloat((float)Xm);
            WebTerminal::print(", VSWR=");
            WebTerminal::printFloat((float)vswr);
            WebTerminal::print("\n\r");
            
            if (Rpm != 0.0 || Xpm != 0.0) {
                WebTerminal::print("Output: R=");
                WebTerminal::printFloat((float)Rpm);
                WebTerminal::print(", X=");
                WebTerminal::printFloat((float)Xpm);
                WebTerminal::print("\n\r");
            }
            
            WebTerminal::print("Current VVC: VVC0=");
            WebTerminal::printFloat((float)VVC0_pF);
            WebTerminal::print(" pF, VVC1=");
            WebTerminal::printFloat((float)VVC1_pF);
            WebTerminal::print(" pF\n\r");
            
            WebTerminal::print("Point A: R=");
            WebTerminal::printFloat((float)pts.RA);
            WebTerminal::print(", X=");
            WebTerminal::printFloat((float)pts.XA);
            WebTerminal::print("\n\r");
            
            WebTerminal::print("Point B: R=");
            WebTerminal::printFloat((float)pts.RB);
            WebTerminal::print(", X=");
            WebTerminal::printFloat((float)pts.XB);
            WebTerminal::print("\n\r");
            
            WebTerminal::print("Point C: R=");
            WebTerminal::printFloat((float)pts.RC);
            WebTerminal::print(", X=");
            WebTerminal::printFloat((float)pts.XC);
            WebTerminal::print("\n\r");
            
            WebTerminal::print("Point D: R=");
            WebTerminal::printFloat((float)pts.RD);
            WebTerminal::print(", X=");
            WebTerminal::printFloat((float)pts.XD);
            WebTerminal::print("\n\r");
            
            WebTerminal::print("Point E: R=");
            WebTerminal::printFloat((float)pts.RE);
            WebTerminal::print(", X=");
            WebTerminal::printFloat((float)pts.XE);
            WebTerminal::print("\n\r");
            
            WebTerminal::print("Plasma:  R=");
            WebTerminal::printFloat((float)pts.Rp);
            WebTerminal::print(", X=");
            WebTerminal::printFloat((float)pts.Xp);
            WebTerminal::print("\n\r");
            
            WebTerminal::sendAck("amc", "OK");
        }
        // amg: Auto Matching Goals - calculate target VVC values for 50Ω matching
        // Usage: amg <Rm> <Xm> [Rpm] [Xpm]
        // Output: AMG,VVC0G0,VVC1G0,Step0G0,Step1G0,Valid0,VVC0G1,VVC1G1,Step0G1,Step1G1,Valid1,EN
        // If Rpm/Xpm are provided and VSWR > 2.0, uses output sensor for RC calculation
        else if (strcmp(cmd, "amg") == 0) {
            if (argc < 3) {
                WebTerminal::print("Usage: amg <Rm> <Xm> [Rpm] [Xpm]\n\r");
                WebTerminal::print("  Calculate VVC goals for 50ohm matching\n\r");
                WebTerminal::print("  Returns two solutions with motor positions\n\r");
                WebTerminal::print("  Rpm/Xpm: Optional output sensor values for high VSWR\n\r");
                return;
            }
            if (!mBoard_) {
                WebTerminal::print("Error: MotionBoard not available\n\r");
                return;
            }
            
            double Rm = atof(argv[1]);
            double Xm = atof(argv[2]);
            
            // Parse optional output sensor values (Option B)
            double Rpm = 0.0, Xpm = 0.0;
            bool hasOutputData = false;
            if (argc >= 5) {
                Rpm = atof(argv[3]);
                Xpm = atof(argv[4]);
                hasOutputData = true;
            }
            
            // Calculate VSWR from input sensor
            double vswr = calculateVSWR(Rm, Xm);
            bool useOutputForRC = hasOutputData && (vswr > 2.0);
            
            // Get current VVC capacitances from motors (pF × 100 → pF)
            double VVC0_pF = (double)mBoard_->M1.getCapacitance() / 100.0;
            double VVC1_pF = (double)mBoard_->M2.getCapacitance() / 100.0;
            
            // First get impedance points for debug output
            ImpedancePoints pts = matchAlgo.calculateImpedances(Rm, Xm, VVC0_pF, VVC1_pF);
            
            // Calculate actual RC, XC, XD used (input-based or output-based)
            double RC_used = pts.RC;
            double XC_used = pts.XC;
            double XD_used = pts.XD;
            if (useOutputForRC) {
                ZCFromOutput zcOut = matchAlgo.calculateZCFromOutput(Rpm, Xpm, VVC1_pF);
                RC_used = zcOut.RC;
                XC_used = zcOut.XC;
                // Recalculate XD using output-based RC, XC
                double RD_out, XD_out;
                matchAlgo.calculateZD(RC_used, XC_used, RD_out, XD_out);
                XD_used = XD_out;
            }
            
            // #region agent log - Debug: Show intermediate values for discriminant calculation
            WebTerminal::print("[DBG] VSWR=");
            WebTerminal::printFloat((float)vswr);
            WebTerminal::print(", useOutput=%s\n\r", useOutputForRC ? "YES" : "NO");
            
            WebTerminal::print("[DBG] VVC1=");
            WebTerminal::printFloat((float)VVC1_pF);
            WebTerminal::print(" pF\n\r");
            
            if (hasOutputData) {
                WebTerminal::print("[DBG] Output: Rpm=");
                WebTerminal::printFloat((float)Rpm);
                WebTerminal::print(", Xpm=");
                WebTerminal::printFloat((float)Xpm);
                WebTerminal::print("\n\r");
            }
            
            WebTerminal::print("[DBG] RC(input)=");
            WebTerminal::printFloat((float)pts.RC);
            if (useOutputForRC) {
                WebTerminal::print(", RC(output)=");
                WebTerminal::printFloat((float)RC_used);
            }
            WebTerminal::print("\n\r");
            
            WebTerminal::print("[DBG] XC(input)=");
            WebTerminal::printFloat((float)pts.XC);
            if (useOutputForRC) {
                WebTerminal::print(", XC(output)=");
                WebTerminal::printFloat((float)XC_used);
            }
            WebTerminal::print("\n\r");
            
            WebTerminal::print("[DBG] XD(input)=");
            WebTerminal::printFloat((float)pts.XD);
            if (useOutputForRC) {
                WebTerminal::print(", XD(output)=");
                WebTerminal::printFloat((float)XD_used);
            }
            WebTerminal::print("\n\r");
            
            WebTerminal::print("[DBG] RB=");
            WebTerminal::printFloat((float)pts.RB);
            WebTerminal::print("\n\r");
            
            double RAGoal, XAGoal;
            matchAlgo.getRAGoal(RAGoal, XAGoal);
            double RAGoal2 = RAGoal * RAGoal;
            double RB2 = pts.RB * pts.RB;
            double RC2 = pts.RC * pts.RC;
            double XAGoal2 = XAGoal * XAGoal;
            
            double innerTerm = RAGoal2 * pts.RB - RAGoal * RB2 + RAGoal2 * pts.RC 
                             - 2.0 * RAGoal * pts.RB * pts.RC + RB2 * pts.RC 
                             + pts.RB * XAGoal2 + pts.RC * XAGoal2;
            double discriminant = 4.0 * RC2 * XAGoal2 - 4.0 * (pts.RC - RAGoal) * innerTerm;
            
            WebTerminal::print("[DBG] innerTerm=");
            WebTerminal::printFloat((float)innerTerm);
            WebTerminal::print(", discriminant=");
            WebTerminal::printFloat((float)discriminant);
            WebTerminal::print("\n\r");
            // #endregion
            
            // Calculate matching goals (with optional output sensor data)
            MatchingGoals goals = matchAlgo.calculateMatchingGoals(Rm, Xm, VVC0_pF, VVC1_pF,
                                                                    &mBoard_->M1, &mBoard_->M2,
                                                                    Rpm, Xpm, useOutputForRC);
            
            // Output result (xil_printf doesn't support %f, use printFloat)
            WebTerminal::print("AMG,");
            WebTerminal::printFloat((float)goals.VVC0Goal0); WebTerminal::print(",");
            WebTerminal::printFloat((float)goals.VVC1Goal0); WebTerminal::print(",");
            WebTerminal::print("%d,%d,%d,", goals.step0Goal0, goals.step1Goal0, goals.valid0 ? 1 : 0);
            WebTerminal::printFloat((float)goals.VVC0Goal1); WebTerminal::print(",");
            WebTerminal::printFloat((float)goals.VVC1Goal1); WebTerminal::print(",");
            WebTerminal::print("%d,%d,%d,EN\n\r", goals.step0Goal1, goals.step1Goal1, goals.valid1 ? 1 : 0);
            
            WebTerminal::print("Current: VVC0=");
            WebTerminal::printFloat((float)VVC0_pF);
            WebTerminal::print(" pF, VVC1=");
            WebTerminal::printFloat((float)VVC1_pF);
            WebTerminal::print(" pF\n\r");
            
            WebTerminal::print("Target A: R=");
            WebTerminal::printFloat((float)goals.RAGoal);
            WebTerminal::print(", X=");
            WebTerminal::printFloat((float)goals.XAGoal);
            WebTerminal::print(" (for 50ohm matching)\n\r");
            
            WebTerminal::print("\n\r--- Solution 0 %s ---\n\r", goals.valid0 ? "(Valid)" : "(Invalid)");
            WebTerminal::print("  VVC0 Goal: ");
            WebTerminal::printFloat((float)goals.VVC0Goal0);
            WebTerminal::print(" pF -> Step %d\n\r", goals.step0Goal0);
            WebTerminal::print("  VVC1 Goal: ");
            WebTerminal::printFloat((float)goals.VVC1Goal0);
            WebTerminal::print(" pF -> Step %d\n\r", goals.step1Goal0);
            WebTerminal::print("  XB Goal: ");
            WebTerminal::printFloat((float)goals.XBGoal0);
            WebTerminal::print("\n\r");
            
            WebTerminal::print("\n\r--- Solution 1 %s ---\n\r", goals.valid1 ? "(Valid)" : "(Invalid)");
            WebTerminal::print("  VVC0 Goal: ");
            WebTerminal::printFloat((float)goals.VVC0Goal1);
            WebTerminal::print(" pF -> Step %d\n\r", goals.step0Goal1);
            WebTerminal::print("  VVC1 Goal: ");
            WebTerminal::printFloat((float)goals.VVC1Goal1);
            WebTerminal::print(" pF -> Step %d\n\r", goals.step1Goal1);
            WebTerminal::print("  XB Goal: ");
            WebTerminal::printFloat((float)goals.XBGoal1);
            WebTerminal::print("\n\r");
            
            WebTerminal::sendAck("amg", "OK");
        }
        // amr: Auto Matching Run - calculate goals and move motors to matching position
        // Usage: amr <Rm> <Xm> [Rpm] [Xpm]
        // If Rpm/Xpm are provided and VSWR > 2.0, uses output sensor for RC calculation
        else if (strcmp(cmd, "amr") == 0) {
            if (argc < 3) {
                WebTerminal::print("Usage: amr <Rm> <Xm> [Rpm] [Xpm]\n\r");
                WebTerminal::print("  Calculate VVC goals and move motors\n\r");
                WebTerminal::print("  Selects goal within motor limits\n\r");
                WebTerminal::print("  Rpm/Xpm: Optional output sensor values for high VSWR\n\r");
                return;
            }
            if (!mBoard_) {
                WebTerminal::print("Error: MotionBoard not available\n\r");
                return;
            }
            
            double Rm = atof(argv[1]);
            double Xm = atof(argv[2]);
            
            // Parse optional output sensor values (Option B)
            double Rpm = 0.0, Xpm = 0.0;
            bool hasOutputData = false;
            if (argc >= 5) {
                Rpm = atof(argv[3]);
                Xpm = atof(argv[4]);
                hasOutputData = true;
            }
            
            // Calculate VSWR from input sensor
            double vswr = calculateVSWR(Rm, Xm);
            bool useOutputForRC = hasOutputData && (vswr > 2.0);
            
            // Get current VVC capacitances from motors (pF × 100 → pF)
            double VVC0_pF = (double)mBoard_->M1.getCapacitance() / 100.0;
            double VVC1_pF = (double)mBoard_->M2.getCapacitance() / 100.0;
            
            // Calculate matching goals (with optional output sensor data)
            MatchingGoals goals = matchAlgo.calculateMatchingGoals(Rm, Xm, VVC0_pF, VVC1_pF,
                                                                    &mBoard_->M1, &mBoard_->M2,
                                                                    Rpm, Xpm, useOutputForRC);
            
            // Check which goals are within capacitance limits (pF → pF×100)
            // Motor 0 (VVC0): minCap ~ maxCap
            // Motor 1 (VVC1): minCap ~ maxCap
            int32_t cap0Goal0 = (int32_t)(goals.VVC0Goal0 * 100.0);
            int32_t cap1Goal0 = (int32_t)(goals.VVC1Goal0 * 100.0);
            int32_t cap0Goal1 = (int32_t)(goals.VVC0Goal1 * 100.0);
            int32_t cap1Goal1 = (int32_t)(goals.VVC1Goal1 * 100.0);
            
            bool goal0_m0_valid = goals.valid0 && 
                                  cap0Goal0 >= mBoard_->M1.minCap && 
                                  cap0Goal0 <= mBoard_->M1.maxCap;
            bool goal0_m1_valid = goals.valid0 && 
                                  cap1Goal0 >= mBoard_->M2.minCap && 
                                  cap1Goal0 <= mBoard_->M2.maxCap;
            bool goal0_valid = goal0_m0_valid && goal0_m1_valid;
            
            bool goal1_m0_valid = goals.valid1 && 
                                  cap0Goal1 >= mBoard_->M1.minCap && 
                                  cap0Goal1 <= mBoard_->M1.maxCap;
            bool goal1_m1_valid = goals.valid1 && 
                                  cap1Goal1 >= mBoard_->M2.minCap && 
                                  cap1Goal1 <= mBoard_->M2.maxCap;
            bool goal1_valid = goal1_m0_valid && goal1_m1_valid;
            
            WebTerminal::print("=== Auto Matching Run ===\n\r");
            WebTerminal::print("Input:  Rm=");
            WebTerminal::printFloat((float)Rm);
            WebTerminal::print(", Xm=");
            WebTerminal::printFloat((float)Xm);
            WebTerminal::print(", VSWR=");
            WebTerminal::printFloat((float)vswr);
            WebTerminal::print("\n\r");
            
            if (hasOutputData) {
                WebTerminal::print("Output: Rpm=");
                WebTerminal::printFloat((float)Rpm);
                WebTerminal::print(", Xpm=");
                WebTerminal::printFloat((float)Xpm);
                WebTerminal::print(" (useOutput=%s)\n\r", useOutputForRC ? "YES" : "NO");
            }
            
            // Display capacitance in pF (cap/100)
            WebTerminal::print("Goal0: VVC0=");
            WebTerminal::printFloat((float)cap0Goal0 / 100.0f);
            WebTerminal::print(" pF (limit ");
            WebTerminal::printFloat((float)mBoard_->M1.minCap / 100.0f);
            WebTerminal::print("~");
            WebTerminal::printFloat((float)mBoard_->M1.maxCap / 100.0f);
            WebTerminal::print(") %s, VVC1=", goal0_m0_valid ? "OK" : "OUT");
            WebTerminal::printFloat((float)cap1Goal0 / 100.0f);
            WebTerminal::print(" pF (limit ");
            WebTerminal::printFloat((float)mBoard_->M2.minCap / 100.0f);
            WebTerminal::print("~");
            WebTerminal::printFloat((float)mBoard_->M2.maxCap / 100.0f);
            WebTerminal::print(") %s\n\r", goal0_m1_valid ? "OK" : "OUT");
            
            WebTerminal::print("Goal1: VVC0=");
            WebTerminal::printFloat((float)cap0Goal1 / 100.0f);
            WebTerminal::print(" pF (limit ");
            WebTerminal::printFloat((float)mBoard_->M1.minCap / 100.0f);
            WebTerminal::print("~");
            WebTerminal::printFloat((float)mBoard_->M1.maxCap / 100.0f);
            WebTerminal::print(") %s, VVC1=", goal1_m0_valid ? "OK" : "OUT");
            WebTerminal::printFloat((float)cap1Goal1 / 100.0f);
            WebTerminal::print(" pF (limit ");
            WebTerminal::printFloat((float)mBoard_->M2.minCap / 100.0f);
            WebTerminal::print("~");
            WebTerminal::printFloat((float)mBoard_->M2.maxCap / 100.0f);
            WebTerminal::print(") %s\n\r", goal1_m1_valid ? "OK" : "OUT");
            
            // Select goal and move motors
            int selectedGoal = -1;
            int32_t targetStep0 = 0, targetStep1 = 0;
            
            if (goal0_valid) {
                selectedGoal = 0;
                targetStep0 = goals.step0Goal0;
                targetStep1 = goals.step1Goal0;
                
                if (goal1_valid) {
                    WebTerminal::print("\n\r*** Note: Goal1 is also valid - alternative matching exists ***\n\r");
                    WebTerminal::print("    Goal1: VVC0=");
                    WebTerminal::printFloat((float)goals.VVC0Goal1);
                    WebTerminal::print(" pF (Step %d), VVC1=", goals.step0Goal1);
                    WebTerminal::printFloat((float)goals.VVC1Goal1);
                    WebTerminal::print(" pF (Step %d)\n\r", goals.step1Goal1);
                }
            } else if (goal1_valid) {
                selectedGoal = 1;
                targetStep0 = goals.step0Goal1;
                targetStep1 = goals.step1Goal1;
            }
            
            if (selectedGoal >= 0) {
                WebTerminal::print("\n\rSelected: Goal%d\n\r", selectedGoal);
                WebTerminal::print("Moving M0 -> %d, M1 -> %d\n\r", targetStep0, targetStep1);
                
                // Move motors
                mBoard_->M1.RunMotor(targetStep0, true, 0);
                mBoard_->M2.RunMotor(targetStep1, true, 0);
                
                // Output result
                WebTerminal::print("AMR,%d,%d,%d,EN\n\r", selectedGoal, targetStep0, targetStep1);
                WebTerminal::sendAck("amr", "OK");
            } else {
                WebTerminal::print("\n\rERROR: No valid goal within motor limits!\n\r");
                WebTerminal::print("Goal0 valid=%d, Goal1 valid=%d\n\r", goals.valid0 ? 1 : 0, goals.valid1 ? 1 : 0);
                WebTerminal::sendAck("amr", "NO_VALID_GOAL");
            }
        }
        // ams: Auto Matching with Sensor - continuous matching using internal sensors
        // Usage: ams [start|stop] [interval] [timeout]
        // interval: matching calculation interval in ms (default 10)
        // timeout: maximum run time in ms (default 5000)
        else if (strcmp(cmd, "ams") == 0) {
            if (argc >= 2 && strcmp(argv[1], "stop") == 0) {
                amsEnabled_ = false;
                amsMatching_ = false;
                WebTerminal::print("AMS stopped\n\r");
                WebTerminal::sendAck("ams", "STOP");
                return;
            }
            
            if (!iSensor_ || !oSensor_ || !mBoard_) {
                WebTerminal::print("Error: Sensors or MotionBoard not available\n\r");
                WebTerminal::sendAck("ams", "ERROR");
                return;
            }
            
            // Parse optional parameters: ams [interval] [timeout] [logInterval]
            if (argc >= 2) {
                amsInterval_ = atoi(argv[1]);
                if (amsInterval_ < 1) amsInterval_ = 1;
                if (amsInterval_ > 1000) amsInterval_ = 1000;
            }
            if (argc >= 3) {
                amsTimeout_ = atoi(argv[2]);
                // 0 = no timeout (continuous mode), otherwise min 100ms
                if (amsTimeout_ != 0 && amsTimeout_ < 100) amsTimeout_ = 100;
                if (amsTimeout_ > 60000) amsTimeout_ = 60000;
            }
            if (argc >= 4) {
                amsLogInterval_ = atoi(argv[3]);
                if (amsLogInterval_ < 1) amsLogInterval_ = 1;
                if (amsLogInterval_ > 1000) amsLogInterval_ = 1000;
            } else {
                amsLogInterval_ = 1;  // Default: log every iteration
            }
            
            // Start AMS loop (use shared loopCounter_ for time sync)
            unsigned long currentTime = loopCounter_ * 10;
            
            amsEnabled_ = true;
            amsMatching_ = true;  // Start in matching mode
            amsVerbose_ = true;   // Enable terminal output in debug mode
            amsLogCounter_ = 0;   // Reset log counter
            amsStartTime_ = currentTime;
            lastAmsTime_ = currentTime;
            
            WebTerminal::print("=== AMS Started (Continuous Mode) ===\n\r");
            WebTerminal::print("Interval: %d ms, Timeout: %d ms%s, LogInterval: %d\n\r", 
                               amsInterval_, amsTimeout_, 
                               amsTimeout_ == 0 ? " (no timeout)" : "",
                               amsLogInterval_);
            WebTerminal::print("VSWR Thresholds - Stop: ");
            WebTerminal::printFloat(mBoard_->matcherInfo.vswrStop);
            WebTerminal::print(", Restart: ");
            WebTerminal::printFloat(mBoard_->matcherInfo.vswrRestart);
            WebTerminal::print("\n\r");
            WebTerminal::print("[AMS DEBUG] Start: mode=MATCHING, loopCounter=%lu\n\r", loopCounter_);
            WebTerminal::sendAck("ams", "START");
        }
        // asv: Auto Set Vswr - set VSWR matching thresholds
        // Usage: asv <start> <stop> <restart>
        else if (strcmp(cmd, "asv") == 0) {
            if (argc < 4) {
                WebTerminal::print("Usage: asv <start> <stop> <restart>\n\r");
                WebTerminal::print("  start: Start matching when VSWR >= this (1.0~10.0)\n\r");
                WebTerminal::print("  stop: Stop matching when VSWR <= this (1.0~5.0)\n\r");
                WebTerminal::print("  restart: Restart matching if VSWR >= this (1.0~10.0)\n\r");
                return;
            }
            if (!mBoard_) {
                WebTerminal::print("Error: MotionBoard not available\n\r");
                return;
            }
            
            float vswrStart = atof(argv[1]);
            float vswrStop = atof(argv[2]);
            float vswrRestart = atof(argv[3]);
            
            // Validate ranges
            if (vswrStart < 1.0f || vswrStart > 10.0f) vswrStart = 1.04f;
            if (vswrStop < 1.0f || vswrStop > 5.0f) vswrStop = 1.02f;
            if (vswrRestart < 1.0f || vswrRestart > 10.0f) vswrRestart = 1.04f;
            
            // Update matcherInfo
            mBoard_->matcherInfo.vswrStart = vswrStart;
            mBoard_->matcherInfo.vswrStop = vswrStop;
            mBoard_->matcherInfo.vswrRestart = vswrRestart;
            
            // Save to FRAM
            int ret = mBoard_->saveVswrSettings();
            if (ret == 0) {
                WebTerminal::print("VSWR settings saved: start=");
                WebTerminal::printFloat(vswrStart);
                WebTerminal::print(", stop=");
                WebTerminal::printFloat(vswrStop);
                WebTerminal::print(", restart=");
                WebTerminal::printFloat(vswrRestart);
                WebTerminal::print("\n\r");
                WebTerminal::sendAck("asv", "OK");
            } else {
                WebTerminal::print("Error: Failed to save VSWR settings to FRAM\n\r");
                WebTerminal::sendAck("asv", "FRAM_ERROR");
            }
        }
        // agv: Auto Get Vswr - get VSWR matching thresholds
        // Usage: agv
        // Output: VSW,start,stop,restart,EN
        else if (strcmp(cmd, "agv") == 0) {
            if (!mBoard_) {
                WebTerminal::print("Error: MotionBoard not available\n\r");
                return;
            }
            
            // Output VSW command for UI
            WebTerminal::print("VSW,");
            WebTerminal::printFloat(mBoard_->matcherInfo.vswrStart);
            WebTerminal::print(",");
            WebTerminal::printFloat(mBoard_->matcherInfo.vswrStop);
            WebTerminal::print(",");
            WebTerminal::printFloat(mBoard_->matcherInfo.vswrRestart);
            WebTerminal::print(",EN\n\r");
            
            WebTerminal::sendAck("agv", "OK");
        }
        // ass: Auto Set AMS Settings - set AMS matching settings
        // Usage: ass <interval> <timeout> <logInterval>
        else if (strcmp(cmd, "ass") == 0) {
            if (argc < 4) {
                WebTerminal::print("Usage: ass <interval> <timeout> <logInterval>\n\r");
                WebTerminal::print("  interval: Matching interval in ms (1~1000)\n\r");
                WebTerminal::print("  timeout: Timeout in ms (0=no timeout, 100~60000)\n\r");
                WebTerminal::print("  logInterval: Log every N iterations (1~1000)\n\r");
                return;
            }
            if (!mBoard_) {
                WebTerminal::print("Error: MotionBoard not available\n\r");
                return;
            }
            
            int interval = atoi(argv[1]);
            int timeout = atoi(argv[2]);
            int logInterval = atoi(argv[3]);
            
            // Validate ranges
            if (interval < 1 || interval > 1000) interval = 10;
            if (timeout != 0 && timeout < 100) timeout = 100;
            if (timeout > 60000) timeout = 60000;
            if (logInterval < 1 || logInterval > 1000) logInterval = 10;
            
            // Update matcherInfo
            mBoard_->matcherInfo.amsInterval = interval;
            mBoard_->matcherInfo.amsTimeout = timeout;
            mBoard_->matcherInfo.amsLogInterval = logInterval;
            
            // Save to FRAM
            int ret = mBoard_->saveAmsSettings();
            if (ret == 0) {
                WebTerminal::print("AMS settings saved: interval=%d, timeout=%d, logInterval=%d\n\r",
                                   interval, timeout, logInterval);
                WebTerminal::sendAck("ass", "OK");
            } else {
                WebTerminal::print("Error: Failed to save AMS settings to FRAM\n\r");
                WebTerminal::sendAck("ass", "FRAM_ERROR");
            }
        }
        // ags: Auto Get AMS Settings - get AMS matching settings
        // Usage: ags
        // Output: AST,interval,timeout,logInterval,EN
        else if (strcmp(cmd, "ags") == 0) {
            if (!mBoard_) {
                WebTerminal::print("Error: MotionBoard not available\n\r");
                return;
            }
            
            // Output AST command for UI
            WebTerminal::print("AST,%d,%d,%d,EN\n\r",
                               mBoard_->matcherInfo.amsInterval,
                               mBoard_->matcherInfo.amsTimeout,
                               mBoard_->matcherInfo.amsLogInterval);
            
            WebTerminal::sendAck("ags", "OK");
        }
        else {
            WebTerminal::print("Unknown Auto Matching command: %s\n\r", cmd);
        }
    }
    
    void handleMotorCommand(int argc, char argv[][64]) {
        const char* cmd = argv[0];
        
        // All motor commands use 0-based index (0 = Motor1/SPI1, 1 = Motor2/SPI2)
        
        // Helper to get motor by 0-based index
        auto getMotor = [this](int idx) -> MotorController* {
            if (idx == 0) return &(mBoard_->M1);
            if (idx == 1) return &(mBoard_->M2);
            return nullptr;
        };
        
        // Helper to convert 0-based index to SPI (1 or 2)
        auto idxToSpi = [](int idx) -> u8 { return (u8)(idx + 1); };
        
        // mi: Motor Init
        if (strcmp(cmd, "mi") == 0) {
            if (argc < 2) {
                WebTerminal::print("Usage: mi [0|1]\n\r");
                return;
            }
            int idx = atoi(argv[1]);
            if (idx == 0 || idx == 1) {
                mBoard_->initMotorBySpi(idxToSpi(idx));
                WebTerminal::print("Motor %d initialized\n\r", idx);
            } else {
                WebTerminal::print("Invalid motor index (0 or 1)\n\r");
            }
        }
        // mr: Motor Run
        else if (strcmp(cmd, "mr") == 0) {
            if (argc < 3) {
                WebTerminal::print("Usage: mr [0|1] [position]\n\r");
                return;
            }
            int idx = atoi(argv[1]);
            MotorController* motor = getMotor(idx);
            if (!motor) {
                WebTerminal::print("Invalid motor index (0 or 1)\n\r");
                return;
            }
            int position = atoi(argv[2]);
            motor->RunMotor(position, true, 0);
        }
        // mf: Motor Force (bypass limits)
        else if (strcmp(cmd, "mf") == 0) {
            if (argc < 3) {
                WebTerminal::print("Usage: mf [0|1] [position] (WARNING: bypasses limits!)\n\r");
                return;
            }
            int idx = atoi(argv[1]);
            MotorController* motor = getMotor(idx);
            if (!motor) {
                WebTerminal::print("Invalid motor index (0 or 1)\n\r");
                return;
            }
            int position = atoi(argv[2]);
            WebTerminal::print("WARNING: Force moving motor %d to %d (bypassing limits)\n\r", idx, position);
            motor->RunMotorForce(position, true, 0);
            WebTerminal::sendAck("mf", "OK");
        }
        // mo: Motor Origin
        else if (strcmp(cmd, "mo") == 0) {
            if (argc < 2) {
                WebTerminal::print("Usage: mo [0|1]\n\r");
                return;
            }
            int idx = atoi(argv[1]);
            MotorController* motor = getMotor(idx);
            if (!motor) {
                WebTerminal::print("Invalid motor index (0 or 1)\n\r");
                return;
            }
            motor->SetMotorOrigin();
            WebTerminal::print("Motor %d origin set\n\r", idx);
        }
        // mgp: Motor Get Position
        else if (strcmp(cmd, "mgp") == 0) {
            if (argc < 2) {
                WebTerminal::print("Usage: mgp [0|1]\n\r");
                return;
            }
            int idx = atoi(argv[1]);
            MotorController* motor = getMotor(idx);
            if (!motor) {
                WebTerminal::print("Invalid motor index (0 or 1)\n\r");
                return;
            }
            // Format: MGP,motorIndex,position,percent,EN
            WebTerminal::print("MGP,%d,%d,%d,EN\n\r",
                idx,
                motor->readPos(),
                motor->getPositionPercent());
        }
        // msc: Motor Set Control
        else if (strcmp(cmd, "msc") == 0) {
            if (argc < 3) {
                WebTerminal::print("Usage: msc [0|1] [value]\n\r");
                return;
            }
            int idx = atoi(argv[1]);
            if (idx != 0 && idx != 1) {
                WebTerminal::print("Invalid motor index (0 or 1)\n\r");
                return;
            }
            u16 value = (u16)atoi(argv[2]);
            mBoard_->setCtrlReg(idxToSpi(idx), value);
            WebTerminal::print("Control register set: Motor %d = 0x%04X\n\r", idx, value);
        }
        // mst: Motor Set Torque
        else if (strcmp(cmd, "mst") == 0) {
            if (argc < 3) {
                WebTerminal::print("Usage: mst [0|1] [value]\n\r");
                return;
            }
            int idx = atoi(argv[1]);
            if (idx != 0 && idx != 1) {
                WebTerminal::print("Invalid motor index (0 or 1)\n\r");
                return;
            }
            u16 value = (u16)atoi(argv[2]);
            mBoard_->setTorque(idxToSpi(idx), value);
            WebTerminal::print("Torque set: Motor %d = %u\n\r", idx, value);
        }
        // msl: Motor Set Limits (with optional capacitance)
        else if (strcmp(cmd, "msl") == 0) {
            if (argc < 3) {
                WebTerminal::print("Usage: msl [0|1] [min,max,lower,upper,minCap,maxCap]\n\r");
                return;
            }
            int idx = atoi(argv[1]);
            MotorController* motor = getMotor(idx);
            if (!motor) {
                WebTerminal::print("Invalid motor index (0 or 1)\n\r");
                return;
            }
            
            // Parse comma-separated values: min,max,lowerLimit,upperLimit,minCap,maxCap
            char* args = argv[2];
            char* minStr = args;
            char* maxStr = strchr(minStr, ',');
            char* lowerLimitStr = nullptr;
            char* upperLimitStr = nullptr;
            char* minCapStr = nullptr;
            char* maxCapStr = nullptr;
            
            if (maxStr) {
                *maxStr = '\0'; maxStr++;
                lowerLimitStr = strchr(maxStr, ',');
                if (lowerLimitStr) {
                    *lowerLimitStr = '\0'; lowerLimitStr++;
                    upperLimitStr = strchr(lowerLimitStr, ',');
                    if (upperLimitStr) {
                        *upperLimitStr = '\0'; upperLimitStr++;
                        minCapStr = strchr(upperLimitStr, ',');
                        if (minCapStr) {
                            *minCapStr = '\0'; minCapStr++;
                            maxCapStr = strchr(minCapStr, ',');
                            if (maxCapStr) {
                                *maxCapStr = '\0'; maxCapStr++;
                            }
                        }
                    }
                }
            }
            
            if (!minStr || !maxStr || !lowerLimitStr || !upperLimitStr) {
                WebTerminal::print("Invalid format. Use: msl [0|1] min,max,lower,upper[,minCap,maxCap]\n\r");
                return;
            }
            
            int32_t minVal = atoi(minStr);
            int32_t maxVal = atoi(maxStr);
            int32_t lowerLimitVal = atoi(lowerLimitStr);
            int32_t upperLimitVal = atoi(upperLimitStr);
            
            motor->minValue = minVal;
            motor->maxValue = maxVal;
            motor->lowerLimit = lowerLimitVal;
            motor->upperLimit = upperLimitVal;
            
            // Update MatcherInfo for limits
            mBoard_->matcherInfo.motorLimits[idx][0] = minVal;
            mBoard_->matcherInfo.motorLimits[idx][1] = maxVal;
            mBoard_->matcherInfo.motorLimits[idx][2] = lowerLimitVal;
            mBoard_->matcherInfo.motorLimits[idx][3] = upperLimitVal;
            
            // Parse capacitance values if provided (input is pF×10, e.g., 1000 = 100.0pF)
            int32_t minCapVal = 0;
            int32_t maxCapVal = 10000;  // Default: 1000.0 pF
            if (minCapStr && maxCapStr) {
                minCapVal = atoi(minCapStr);   // Already pF×10 from UI
                maxCapVal = atoi(maxCapStr);   // Already pF×10 from UI
                motor->minCap = minCapVal;
                motor->maxCap = maxCapVal;
                mBoard_->matcherInfo.motorCaps[idx][0] = minCapVal;
                mBoard_->matcherInfo.motorCaps[idx][1] = maxCapVal;
            }
            
            // Save limits to FRAM
            int limitsRet = mBoard_->saveMotorLimits();
            int capsRet = 0;
            if (minCapStr && maxCapStr) {
                capsRet = mBoard_->saveMotorCaps();
            }
            
            if (limitsRet == 0 && capsRet == 0) {
                if (minCapStr && maxCapStr) {
                    // Display as X.XX pF format (values are pF×100)
                    WebTerminal::print("Motor %d saved: min=%d, max=%d, lower=%d, upper=%d, minCap=", idx, minVal, maxVal, lowerLimitVal, upperLimitVal);
                    WebTerminal::printFloat((float)minCapVal / 100.0f);
                    WebTerminal::print(", maxCap=");
                    WebTerminal::printFloat((float)maxCapVal / 100.0f);
                    WebTerminal::print(" pF\n\r");
                } else {
                    WebTerminal::print("Motor %d limits saved: min=%d, max=%d, lower=%d, upper=%d\n\r",
                        idx, minVal, maxVal, lowerLimitVal, upperLimitVal);
                }
                WebTerminal::sendAck("msl", "OK");
            } else {
                WebTerminal::print("Failed to save motor settings\n\r");
                WebTerminal::sendAck("msl", "SAVE_FAIL");
            }
        }
        // mgl: Motor Get Limits (with capacitance)
        else if (strcmp(cmd, "mgl") == 0) {
            if (argc < 2) {
                WebTerminal::print("Usage: mgl [0|1]\n\r");
                return;
            }
            int idx = atoi(argv[1]);
            MotorController* motor = getMotor(idx);
            if (!motor) {
                WebTerminal::print("Invalid motor index (0 or 1)\n\r");
                return;
            }
            // Format: MGL,idx,min,max,lower,upper,minCap,maxCap,pos,percent,cap,EN
            // Capacitance values are pF×10 (UI divides by 10 for display)
            WebTerminal::print("MGL,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,EN\n\r",
                idx,
                motor->minValue,
                motor->maxValue,
                motor->lowerLimit,
                motor->upperLimit,
                motor->minCap,
                motor->maxCap,
                motor->readPos(),
                motor->getPositionPercent(),
                motor->getCapacitance());
        }
        // mfc: Motor Fitting Coefficients (get/set normalized polynomial coefficients)
        // Format: mfc [idx] a0,a1,a2,a3
        // Normalized coefficients: C(xNorm) = a3*xNorm^3 + a2*xNorm^2 + a1*xNorm + a0
        // where xNorm = (step - minValue) / (maxValue - minValue) (derived from Motor Limits)
        else if (strcmp(cmd, "mfc") == 0) {
            if (argc < 2) {
                WebTerminal::print("Usage: mfc [0|1] [a0,a1,a2,a3]\n\r");
                return;
            }
            int idx = atoi(argv[1]);
            MotorController* motor = getMotor(idx);
            if (!motor) {
                WebTerminal::print("Invalid motor index (0 or 1)\n\r");
                return;
            }
            
            // If only motor index provided, read and return current coefficients
            if (argc < 3) {
                // Format: MFC,idx,a0,a1,a2,a3,EN
                WebTerminal::print("MFC,%d,", idx);
                WebTerminal::printFloat(motor->fitCoeffs[0]);
                WebTerminal::print(",");
                WebTerminal::printFloat(motor->fitCoeffs[1]);
                WebTerminal::print(",");
                WebTerminal::printFloat(motor->fitCoeffs[2]);
                WebTerminal::print(",");
                WebTerminal::printFloat(motor->fitCoeffs[3]);
                WebTerminal::print(",EN\n\r");
                return;
            }
            
            // Parse comma-separated values: a0,a1,a2,a3
            char* args = argv[2];
            char* tokens[4] = {nullptr};
            int tokenCount = 0;
            
            tokens[0] = args;
            tokenCount = 1;
            for (char* p = args; *p && tokenCount < 4; p++) {
                if (*p == ',') {
                    *p = '\0';
                    tokens[tokenCount++] = p + 1;
                }
            }
            
            // Need exactly 4 tokens (a0,a1,a2,a3)
            if (tokenCount < 4) {
                WebTerminal::print("Invalid format. Use: mfc [0|1] a0,a1,a2,a3\n\r");
                return;
            }
            
            // Parse coefficients using simple atof - normalized coeffs are reasonable size
            float a0 = (float)atof(tokens[0]);
            float a1 = (float)atof(tokens[1]);
            float a2 = (float)atof(tokens[2]);
            float a3 = (float)atof(tokens[3]);
            
            // Update motor controller - coefficients only
            // Note: xMin and xRange are derived from Motor Limits (minValue, maxValue)
            motor->fitCoeffs[0] = a0;
            motor->fitCoeffs[1] = a1;
            motor->fitCoeffs[2] = a2;
            motor->fitCoeffs[3] = a3;
            
            // Update MatcherInfo
            mBoard_->matcherInfo.motorFitCoeffs[idx][0] = a0;
            mBoard_->matcherInfo.motorFitCoeffs[idx][1] = a1;
            mBoard_->matcherInfo.motorFitCoeffs[idx][2] = a2;
            mBoard_->matcherInfo.motorFitCoeffs[idx][3] = a3;
            
            // Save to FRAM
            if (mBoard_->saveMotorFitCoeffs() == 0) {
                WebTerminal::print("Motor %d fitting saved: a0=", idx);
                WebTerminal::printFloat(a0);
                WebTerminal::print(", a1=");
                WebTerminal::printFloat(a1);
                WebTerminal::print(", a2=");
                WebTerminal::printFloat(a2);
                WebTerminal::print(", a3=");
                WebTerminal::printFloat(a3);
                WebTerminal::print("\n\r");
                
                // Output MFC opcode for UI sync
                WebTerminal::print("MFC,%d,", idx);
                WebTerminal::printFloat(motor->fitCoeffs[0]);
                WebTerminal::print(",");
                WebTerminal::printFloat(motor->fitCoeffs[1]);
                WebTerminal::print(",");
                WebTerminal::printFloat(motor->fitCoeffs[2]);
                WebTerminal::print(",");
                WebTerminal::printFloat(motor->fitCoeffs[3]);
                WebTerminal::print(",EN\n\r");
                
                WebTerminal::sendAck("mfc", "OK");
            } else {
                WebTerminal::print("Failed to save fitting coefficients\n\r");
                WebTerminal::sendAck("mfc", "SAVE_FAIL");
            }
        }
        // mgs: Motor Get Status
        else if (strcmp(cmd, "mgs") == 0) {
            if (argc < 2) {
                WebTerminal::print("Usage: mgs [0|1]\n\r");
                return;
            }
            int idx = atoi(argv[1]);
            if (idx != 0 && idx != 1) {
                WebTerminal::print("Invalid motor index (0 or 1)\n\r");
                return;
            }
            u8 spi = idxToSpi(idx);
            u16 regs[8];
            if (mBoard_->getStatus(mBoard_->getBoardAddr(), spi, regs) == 0) {
                WebTerminal::print("Motor %d Status:\n\r", idx);
                for (int i = 0; i < 8; i++) {
                    WebTerminal::print("  Reg[%d] = 0x%04X\n\r", i, regs[i]);
                }
                // UI protocol format: MGS,idx,reg0,...,reg7,EN
                WebTerminal::print("MGS,%d,%04X,%04X,%04X,%04X,%04X,%04X,%04X,%04X,EN\n\r",
                    idx, regs[0], regs[1], regs[2], regs[3], regs[4], regs[5], regs[6], regs[7]);
            } else {
                WebTerminal::print("Failed to read status\n\r");
            }
        }
        // msd: Motor Set Driver settings
        else if (strcmp(cmd, "msd") == 0) {
            if (argc < 3) {
                WebTerminal::print("Usage: msd [0|1] <standby,disable,ctrl,torque,off,blank,decay,stall,drive>\n\r");
                return;
            }
            int idx = atoi(argv[1]);
            if (idx != 0 && idx != 1) {
                WebTerminal::print("Invalid motor index (0 or 1)\n\r");
                return;
            }
            
            // Parse comma-separated values
            char* token = strtok(argv[2], ",");
            u16 values[9];
            int count = 0;
            while (token != nullptr && count < 9) {
                values[count++] = (u16)atoi(token);
                token = strtok(nullptr, ",");
            }
            
            if (count < 9) {
                WebTerminal::print("Error: Expected 9 values\n\r");
                return;
            }
            
            MotionBoard::DriverSettings ds;
            ds.standbyVal = values[0];
            ds.disableVal = values[1];
            ds.regCtrl = values[2];
            ds.regTorque = values[3];
            ds.regOff = values[4];
            ds.regBlank = values[5];
            ds.regDecay = values[6];
            ds.regStall = values[7];
            ds.regDrive = values[8];
            
            mBoard_->setDriverSettings(idxToSpi(idx), ds);
            
            WebTerminal::print("Motor %d driver settings updated:\n\r", idx);
            WebTerminal::print("  Standby=%u, Disable=%u\n\r", ds.standbyVal, ds.disableVal);
            WebTerminal::print("  CTRL=%u, TORQUE=%u, OFF=%u, BLANK=%u, DECAY=%u, STALL=%u, DRIVE=%u\n\r", 
                ds.regCtrl, ds.regTorque, ds.regOff, ds.regBlank, ds.regDecay, ds.regStall, ds.regDrive);
            WebTerminal::sendAck("msd", "OK");
        }
        // mrp: Motor Run Position (stream both motors)
        else if (strcmp(cmd, "mrp") == 0) {
            if (argc < 2) {
                WebTerminal::print("Usage: mrp [run|stop] [rate_ms]\n\r");
                return;
            }
            bool run = (strcmp(argv[1], "run") == 0);
            
            if (run && argc >= 3) {
                int rate = atoi(argv[2]);
                if (rate >= 10 && rate <= 5000) {
                    motorPosStreamRate_ = rate;
                }
            }
            
            motorPosStreamEnabled_ = run;
            WebTerminal::sendAck("mrp", run ? "RUN" : "STOP");
        }
        // mss: Motor/Stream Settings (all stream rates + FRAM save settings)
        // Format: mss [impRate] [viRate] [posStreamRate] [saveRate] [0|1]
        else if (strcmp(cmd, "mss") == 0) {
            if (argc < 4) {
                WebTerminal::print("Usage: mss [impRate] [viRate] [posRate]\n\r");
                return;
            }
            int impRate = atoi(argv[1]);
            int viRate = atoi(argv[2]);
            int posRate = atoi(argv[3]);
            
            // Apply to local variables
            if (impRate >= 10 && impRate <= 5000) {
                impStreamRate_i_ = impRate;
                impStreamRate_o_ = impRate;
            }
            if (viRate >= 10 && viRate <= 5000) {
                viStreamRate_i_ = viRate;
                viStreamRate_o_ = viRate;
            }
            if (posRate >= 10 && posRate <= 5000) {
                motorPosStreamRate_ = posRate;
            }
            
            // Save to FRAM via MotionBoard
            if (mBoard_) {
                mBoard_->matcherInfo.impStreamRate = impStreamRate_i_;
                mBoard_->matcherInfo.viStreamRate = viStreamRate_i_;
                mBoard_->matcherInfo.motorPosStreamRate = motorPosStreamRate_;
                
                if (mBoard_->saveStreamSettings() == 0) {
                    WebTerminal::print("Stream Settings saved to FRAM\n\r");
                } else {
                    WebTerminal::print("Failed to save Stream Settings to FRAM\n\r");
                }
            }
            
            WebTerminal::print("Stream Settings: Imp=%dms, VI=%dms, Pos=%dms\n\r", 
                impStreamRate_i_, viStreamRate_i_, motorPosStreamRate_);
            WebTerminal::sendAck("mss", "OK");
        }
        // msg: Motor/Stream Settings Get
        else if (strcmp(cmd, "msg") == 0) {
            // SST: Sensor Stream Settings (Impedance rate, V/I rate)
            WebTerminal::print("SST,%d,%d,EN\n\r", impStreamRate_i_, viStreamRate_i_);
            usleep(10000);  // 10ms delay
            // MST: Motor Settings (position stream rate only)
            WebTerminal::print("MST,%d,EN\n\r", motorPosStreamRate_);
        }
        // mgi: Motor Get Index (encoder index position + stall detection)
        else if (strcmp(cmd, "mgi") == 0) {
            if (argc < 2) {
                WebTerminal::print("Usage: mgi [0|1]\n\r");
                return;
            }
            int idx = atoi(argv[1]);
            MotorController* motor = getMotor(idx);
            if (!motor) {
                WebTerminal::print("Invalid motor index (0 or 1)\n\r");
                return;
            }
            // Format: MXI,idx,indexPos,stallDetected,EN
            int32_t indexPos = motor->readIndexPos();
            int stallDetected = motor->isStallDetected() ? 1 : 0;
            WebTerminal::print("MXI,%d,%d,%d,EN\n\r", idx, indexPos, stallDetected);
        }
        // mis: Motor Index Save - Save first index position to FRAM
        else if (strcmp(cmd, "mis") == 0) {
            if (argc < 3) {
                WebTerminal::print("Usage: mis [0|1] [indexPos]\n\r");
                WebTerminal::print("  Saves first index position to FRAM for calibration\n\r");
                WebTerminal::print("  Use 'mfi' to find index position first\n\r");
                return;
            }
            int idx = atoi(argv[1]);
            if (idx != 0 && idx != 1) {
                WebTerminal::print("Invalid motor index (0 or 1)\n\r");
                return;
            }
            int32_t indexPos = atoi(argv[2]);
            
            if (mBoard_) {
                int ret = mBoard_->saveFirstIndexPos(idx, indexPos);
                if (ret == 0) {
                    WebTerminal::print("Motor %d: First index position %d saved to FRAM\n\r", idx, indexPos);
                    WebTerminal::sendAck("mis", "OK");
                } else {
                    WebTerminal::print("Motor %d: Failed to save index position to FRAM\n\r", idx);
                    WebTerminal::sendAck("mis", "FAIL");
                }
            } else {
                WebTerminal::print("Error: MotionBoard not available\n\r");
            }
        }
        // mor: Motor Override RPM (set override RPM, 0 = disable)
        else if (strcmp(cmd, "mor") == 0) {
            if (argc < 3) {
                // If only motor index provided, show current override RPM
                if (argc == 2) {
                    int idx = atoi(argv[1]);
                    MotorController* motor = getMotor(idx);
                    if (!motor) {
                        WebTerminal::print("Invalid motor index (0 or 1)\n\r");
                        return;
                    }
                    WebTerminal::print("Motor %d Override RPM: %u (0=disabled)\n\r", idx, motor->getOverrideRpm());
                    return;
                }
                WebTerminal::print("Usage: mor [0|1] [rpm] (0=disable override)\n\r");
                return;
            }
            int idx = atoi(argv[1]);
            MotorController* motor = getMotor(idx);
            if (!motor) {
                WebTerminal::print("Invalid motor index (0 or 1)\n\r");
                return;
            }
            uint32_t rpm = (uint32_t)atoi(argv[2]);
            motor->setOverrideRpm(rpm);
            if (rpm == 0) {
                WebTerminal::print("Motor %d Override RPM disabled\n\r", idx);
            } else {
                WebTerminal::print("Motor %d Override RPM set to %u\n\r", idx, rpm);
            }
            WebTerminal::sendAck("mor", "OK");
        }
        // mfi: Motor Find Index (search for encoder index position while moving)
        else if (strcmp(cmd, "mfi") == 0) {
            if (argc < 4) {
                WebTerminal::print("Usage: mfi [0|1] [targetPos] [rpm]\n\r");
                WebTerminal::print("  Moves to targetPos at specified RPM\n\r");
                WebTerminal::print("  Returns first non-zero index position found\n\r");
                return;
            }
            int idx = atoi(argv[1]);
            MotorController* motor = getMotor(idx);
            if (!motor) {
                WebTerminal::print("Invalid motor index (0 or 1)\n\r");
                return;
            }
            int32_t targetPos = atoi(argv[2]);
            uint32_t rpm = (uint32_t)atoi(argv[3]);
            
            WebTerminal::print("Finding index: M%d -> %d @ %u RPM...\n\r", idx, targetPos, rpm);
            
            // Call findIndexPosition method
            MotorController::IndexSearchResult result = motor->findIndexPosition(targetPos, rpm);
            
            // Format: MFI,idx,found,indexPos,motorPosAtIndex,finalPos,EN
            WebTerminal::print("MFI,%d,%d,%d,%d,%d,EN\n\r", 
                idx, 
                result.found ? 1 : 0, 
                result.indexPos, 
                result.motorPosAtIndex, 
                result.finalPos);
        }
        // moi: Motor Origin on Index (set origin when next encoder index signal is detected)
        else if (strcmp(cmd, "moi") == 0) {
            if (argc < 2) {
                WebTerminal::print("Usage: moi [0|1] [position]\n\r");
                WebTerminal::print("  Sets origin to position when next index signal is detected\n\r");
                WebTerminal::print("  position: optional, defaults to 0\n\r");
                return;
            }
            int idx = atoi(argv[1]);
            MotorController* motor = getMotor(idx);
            if (!motor) {
                WebTerminal::print("Invalid motor index (0 or 1)\n\r");
                return;
            }
            int32_t position = (argc >= 3) ? atoi(argv[2]) : 0;
            
            motor->SetMotorOriginOnIndex(position);
            WebTerminal::print("Motor %d: Origin on Index armed (position=%d)\n\r", idx, position);
            WebTerminal::sendAck("moi", "OK");
        }
        // mrw: Motor Rewind (rewind to physical limit, detect stall)
        else if (strcmp(cmd, "mrw") == 0) {
            if (argc < 2) {
                WebTerminal::print("Usage: mrw [0|1]\n\r");
                WebTerminal::print("  Rewinds motor to physical limit (negative direction)\n\r");
                WebTerminal::print("  Detects stall and stops automatically\n\r");
                return;
            }
            int idx = atoi(argv[1]);
            MotorController* motor = getMotor(idx);
            if (!motor) {
                WebTerminal::print("Invalid motor index (0 or 1)\n\r");
                return;
            }
            
            WebTerminal::print("Rewinding Motor %d to physical limit...\n\r", idx);
            
            // Call rewindMotor method
            MotorController::RewindResult result = motor->rewindMotor();
            
            // Format: MRW,idx,completed,finalPos,movement,EN
            WebTerminal::print("MRW,%d,%d,%d,%d,EN\n\r", 
                idx, 
                result.completed ? 1 : 0, 
                result.finalPos, 
                result.movement);
        }
        // msw: Motor Sleep/Wake (control nSLEEP pin of DRV8711)
        else if (strcmp(cmd, "msw") == 0) {
            if (argc < 3) {
                WebTerminal::print("Usage: msw [0|1] [0|1]\n\r");
                WebTerminal::print("  Motor index 0 or 1, Level: 0=Sleep, 1=Wake\n\r");
                WebTerminal::print("  DRV8711 nSLEEP pin: LOW=Sleep mode, HIGH=Active\n\r");
                WebTerminal::print("  If registers show 0xFFF, try: msw 0 1 (wake motor 0)\n\r");
                return;
            }
            int idx = atoi(argv[1]);
            if (idx != 0 && idx != 1) {
                WebTerminal::print("Invalid motor index (0 or 1)\n\r");
                return;
            }
            int level = atoi(argv[2]);
            u8 spi = idxToSpi(idx);
            
            int ret = mBoard_->setSleep(mBoard_->getBoardAddr(), spi, level ? 1 : 0);
            if (ret == 0) {
                WebTerminal::print("Motor %d: nSLEEP set to %s\n\r", idx, level ? "HIGH (Wake)" : "LOW (Sleep)");
                WebTerminal::sendAck("msw", "OK");
            } else {
                WebTerminal::print("Motor %d: Failed to set nSLEEP\n\r", idx);
                WebTerminal::sendAck("msw", "FAIL");
            }
        }
        // mhr: Motor HW Reset (hardware reset DRV8711)
        else if (strcmp(cmd, "mhr") == 0) {
            if (argc < 2) {
                WebTerminal::print("Usage: mhr [0|1]\n\r");
                WebTerminal::print("  Hardware reset DRV8711 and re-initialize\n\r");
                return;
            }
            int idx = atoi(argv[1]);
            if (idx != 0 && idx != 1) {
                WebTerminal::print("Invalid motor index (0 or 1)\n\r");
                return;
            }
            u8 spi = idxToSpi(idx);
            
            WebTerminal::print("Motor %d: Hardware reset...\n\r", idx);
            int ret = mBoard_->HWReset(spi);
            if (ret == 0) {
                WebTerminal::print("Motor %d: HW Reset complete, driver re-initialized\n\r", idx);
                WebTerminal::sendAck("mhr", "OK");
            } else {
                WebTerminal::print("Motor %d: HW Reset failed\n\r", idx);
                WebTerminal::sendAck("mhr", "FAIL");
            }
        }
        else {
            WebTerminal::print("Unknown motor command: %s\n\r", cmd);
        }
    }
    
    void printHelp() {
        WebTerminal::print("\n\r=== Command Reference ===\n\r");
        WebTerminal::print("Pattern: [category][action][target]\n\r");
        WebTerminal::print("  r=RF, m=Motor, d=Device\n\r");
        
        WebTerminal::print("\n\r--- Device (d*) ---\n\r");
        WebTerminal::print("da          Auto Matching Mode\n\r");
        WebTerminal::print("dh          Help (this)\n\r");
        WebTerminal::print("dsi M,D,S   Set Device Info\n\r");
        WebTerminal::print("dgi         Get Device Info\n\r");
        WebTerminal::print("dfb [len]   FRAM Backup (dump hex)\n\r");
        WebTerminal::print("dfr len hex FRAM Restore (write hex)\n\r");
        WebTerminal::print("dfw addr hex  FRAM Write (single)\n\r");
        
        WebTerminal::print("\n\r--- RF Sensor (r*) [i|o] ---\n\r");
        WebTerminal::print("ri  i       Init ADC\n\r");
        WebTerminal::print("rrs i run   Run/Stop Impedance stream\n\r");
        WebTerminal::print("rf  i       Get FFT data\n\r");
        WebTerminal::print("rrv i run   Run/Stop V/I stream\n\r");
        WebTerminal::print("rz  i 10    Single impedance\n\r");
        WebTerminal::print("rk  i ac    Set coupling (ac/dc)\n\r");
        WebTerminal::print("rr  i       Reset settings\n\r");
        WebTerminal::print("rsc i v 1.0 Set Calibration (v/i/p)\n\r");
        WebTerminal::print("rgc i       Get Calibration\n\r");
        WebTerminal::print("rsa i 512   Set Average count\n\r");
        WebTerminal::print("rga i       Get Average count\n\r");
        
        WebTerminal::print("\n\r--- Motor (m*) [0|1] ---\n\r");
        WebTerminal::print("mi  0       Init driver\n\r");
        WebTerminal::print("mr  0 32000 Run to position\n\r");
        WebTerminal::print("mf  0 50000 Force run (no limit)\n\r");
        WebTerminal::print("mo  0       Set origin\n\r");
        WebTerminal::print("mgp 0       Get Position\n\r");
        WebTerminal::print("mrp run 100 Run/Stop Position stream\n\r");
        WebTerminal::print("mss 100 100 100 1000 1  Set All Rates\n\r");
        WebTerminal::print("msg         Get Stream Settings\n\r");
        WebTerminal::print("msc 0 553   Set Control reg\n\r");
        WebTerminal::print("mst 0 100   Set Torque\n\r");
        WebTerminal::print("mgs 0       Get Status regs\n\r");
        WebTerminal::print("msl 0 0,64000,4000,60000,0,1000  Set Limits+Caps\n\r");
        WebTerminal::print("mgl 0       Get Limits\n\r");
        WebTerminal::print("mfc 0       Get Fitting Coefficients\n\r");
        WebTerminal::print("mfc 0 a0,a1,a2,a3  Set Fitting Coefficients\n\r");
        WebTerminal::print("msd 0 553,552,552,320,15,336,508,1200,5  Set Driver\n\r");
        WebTerminal::print("mgi 0       Get Index Pos + Stall\n\r");
        WebTerminal::print("mor 0 1000  Set Override RPM (0=disable)\n\r");
        WebTerminal::print("mfi 0 32000 30  Find Index (target, rpm)\n\r");
        WebTerminal::print("moi 0 [pos] Origin on Index (wait for signal)\n\r");
        WebTerminal::print("mrw 0       Rewind to physical limit\n\r");
        WebTerminal::print("mis 0 [pos] Save Index Pos to FRAM\n\r");
        WebTerminal::print("msw 0 1     Sleep/Wake (0=Sleep, 1=Wake)\n\r");
        WebTerminal::print("mhr 0       HW Reset DRV8711\n\r");
        
        WebTerminal::print("\n\r--- Auto Matching (a*) ---\n\r");
        WebTerminal::print("amc Rm Xm   Calc impedances (A,B,C,D,P)\n\r");
        WebTerminal::print("amg Rm Xm   Calc VVC goals for 50ohm\n\r");
        WebTerminal::print("amr Rm Xm   Calc & Move to matching pos\n\r");
        WebTerminal::print("ams [int] [tout] Auto match using sensors\n\r");
        WebTerminal::print("\n\r");
    }
};

