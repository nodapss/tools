#pragma once

// AutoMatchingMode.hpp - Auto matching mode control library
// Handles automatic impedance matching functionality

#include "xil_printf.h"
#include "xstatus.h"
#include "sleep.h"
#include "RFSensor.hpp"
#include "MotionBoard.hpp"
#include "WebTerminal.hpp"

// ============================================================================
// AutoMatchingMode Class
// ============================================================================

class AutoMatchingMode {
public:
    // Constructor
    AutoMatchingMode(RFSensor* sensor, MotionBoard* mBoard = nullptr) 
        : sensor_(sensor), mBoard_(mBoard),
          motorPosReportRate_(100),
          lastMotorPosReportTime_(0),
          loopCounter_(0) {
    }

    // Set motor position report rate (ms)
    void setMotorPosReportRate(int rate) {
        if (rate >= 10 && rate <= 5000) {
            motorPosReportRate_ = rate;
        }
    }

    // Start auto matching process
    void AutoMatchStart() {
        loopCounter_++;
        unsigned long currentTime = loopCounter_ * 100; // Based on 100ms loop delay in main.cpp
        
        if (sensor_) {
            // Calculate averaged impedance using sensor's avgCount setting
            AveragedImpedanceResults result = sensor_->calculateAveragedImpedance(-1); // Use class avgCount_
            
            // Send impedance data using OpCode format (ZI = Input impedance)
            // Format: ZI,R,X,V,I,Phase,EN
            WebTerminal::sendImpedance(result.resistanceR, result.reactanceX, result.voltageMagnitude, result.currentMagnitude, result.impedancePhaseDeg, true);
        }

        // Report motor positions at configured rate
        // Condition: always true (HW will configure this later)
        bool shouldReportMotorPos = true;
        if (shouldReportMotorPos && mBoard_) {
            unsigned long elapsedMs = currentTime - lastMotorPosReportTime_;
            if (elapsedMs >= (unsigned long)motorPosReportRate_) {
                WebTerminal::sendMotorPositionBoth(
                    mBoard_->M1.readPos(), mBoard_->M1.getPositionPercent(), mBoard_->M1.getCapacitance(),
                    mBoard_->M2.readPos(), mBoard_->M2.getPositionPercent(), mBoard_->M2.getCapacitance()
                );
                lastMotorPosReportTime_ = currentTime;
            }
        }
    }

private:
    RFSensor* sensor_;
    MotionBoard* mBoard_;
    int motorPosReportRate_;
    unsigned long lastMotorPosReportTime_;
    unsigned long loopCounter_;
    // Future auto matching state and methods will be added here
};

