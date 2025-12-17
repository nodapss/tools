#pragma once

#include <stdint.h>
#include <cstring>
#include "xparameters.h"
#include "xuartps.h"
#include "xscugic.h"
#include "xil_printf.h"
#include "xil_exception.h"

namespace Communication {

// Constants
//constexpr uint32_t UART_BAUDRATE = 115200;
constexpr uint32_t UART_BAUDRATE = 921600;
constexpr size_t UART_RX_BUF_SIZE = 1024;
constexpr size_t UART_TX_BUF_SIZE = 1024;

// Internal device instances
static XUartPs Uart_Ps;
static XScuGic InstGIC;

// Internal buffers and state
static char Rx_buf[UART_RX_BUF_SIZE];
static char Rx_buf_copy[UART_RX_BUF_SIZE];
static unsigned char Tx_buf[UART_TX_BUF_SIZE];
static uint16_t bUart0_BufIndex = 0;
static unsigned int wUart0_TimeOut = 0;
static bool Recv_Complete = false;

// Internal interrupt handler (static, called via C wrapper)
static inline void handler_uart_impl(void* p) {
    u32 isr_status;
    u32 raw_isr_status;
    unsigned int receivedByte;
    XUartPs* inst = static_cast<XUartPs*>(p);

    raw_isr_status = XUartPs_ReadReg(inst->Config.BaseAddress, XUARTPS_ISR_OFFSET);
    isr_status = raw_isr_status & XUartPs_ReadReg(inst->Config.BaseAddress, XUARTPS_IMR_OFFSET);

    while ((XUartPs_ReadReg(inst->Config.BaseAddress, XUARTPS_SR_OFFSET) & XUARTPS_SR_RXEMPTY) == (u32)0) {
        receivedByte = XUartPs_ReadReg(inst->Config.BaseAddress, XUARTPS_FIFO_OFFSET);

        // Guard against RX buffer overflow; handle CR/LF robustly
        if (receivedByte == '\r') {
            Recv_Complete = true;               // end of command
        } else if (receivedByte == '\n') {
            // ignore LF (CRLF terminals)
        } else {
            if (bUart0_BufIndex < static_cast<uint16_t>(UART_RX_BUF_SIZE - 1)) {
                Rx_buf[bUart0_BufIndex++] = static_cast<char>(receivedByte);
            }
            // else: drop until EOL
        }
        wUart0_TimeOut = 0;
    }

    // Clear ALL pending interrupts to prevent infinite loops if a non-enabled interrupt fires
    XUartPs_WriteReg(inst->Config.BaseAddress, XUARTPS_ISR_OFFSET, raw_isr_status);
}

// C-compatible wrapper for interrupt handler
extern "C" {
    inline void handler_uart(void* p) {
        handler_uart_impl(p);
    }
}

// Public API functions

inline int initGic() {
    XScuGic_Config* PConfig;
    int iStatus;

    PConfig = XScuGic_LookupConfig(XPAR_SCUGIC_SINGLE_DEVICE_ID);
    if (PConfig == nullptr) return XST_FAILURE;

    iStatus = XScuGic_CfgInitialize(&InstGIC, PConfig, PConfig->CpuBaseAddress);
    if (iStatus != XST_SUCCESS) return XST_FAILURE;

    return 0;
}

inline int initException() {
    Xil_ExceptionInit();
    Xil_ExceptionRegisterHandler(XIL_EXCEPTION_ID_INT, 
                                  reinterpret_cast<Xil_ExceptionHandler>(XScuGic_InterruptHandler), 
                                  &InstGIC);
    Xil_ExceptionEnable();
    return XST_SUCCESS;
}

inline int init() {
    int iStatus;
    u32 intrmask;
    XUartPs_Config* pConfig;

    pConfig = XUartPs_LookupConfig(XPAR_XUARTPS_0_DEVICE_ID);
    if (pConfig == nullptr) return XST_FAILURE;

    iStatus = XUartPs_CfgInitialize(&Uart_Ps, pConfig, pConfig->BaseAddress);
    if (iStatus != XST_SUCCESS) return XST_FAILURE;

    XScuGic_Connect(
        &InstGIC,
        XPAR_XUARTPS_0_INTR,
        reinterpret_cast<Xil_ExceptionHandler>(handler_uart),
        static_cast<void*>(&Uart_Ps)
    );

    XScuGic_Enable(&InstGIC, XPAR_XUARTPS_0_INTR);

    intrmask = XUARTPS_IXR_TOUT;

    XUartPs_SetInterruptMask(&Uart_Ps, intrmask);
    XUartPs_SetOperMode(&Uart_Ps, XUARTPS_OPER_MODE_NORMAL);
    XUartPs_SetBaudRate(&Uart_Ps, UART_BAUDRATE);
    XUartPs_SetRecvTimeout(&Uart_Ps, 8);

    wUart0_TimeOut = 0;

    return XST_SUCCESS;
}

inline int send(unsigned char* SendBuffer, unsigned char Num_of_SendByte) {
    unsigned int SentCount;
    u32 LoopCount = 0;

    SentCount = XUartPs_Send(&Uart_Ps, SendBuffer, Num_of_SendByte);
    if (SentCount != Num_of_SendByte) return XST_FAILURE;

    while (XUartPs_IsSending(&Uart_Ps)) {
        LoopCount++;
    }

    return XST_SUCCESS;
}

// Accessor functions

inline const char* getRxBuffer() {
    return Rx_buf;
}

inline uint16_t getRxBufferIndex() {
    return bUart0_BufIndex;
}

inline bool isReceiveComplete() {
    return Recv_Complete;
}

inline void resetCommandState() {
    Recv_Complete = false;
    bUart0_BufIndex = 0;
    std::memset(Rx_buf, 0, sizeof(Rx_buf));
    std::memset(Rx_buf_copy, 0, sizeof(Rx_buf_copy));
}

} // namespace Communication

