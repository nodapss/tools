/**
 * Notification Manager
 * Handles toast notifications and style injection
 */
class NotificationManager {
    constructor() {
        this.injectStyles();
    }

    /**
     * Show notification toast
     * @param {string} message 
     * @param {string} type 'info', 'success', 'error'
     */
    show(message, type = 'info') {
        const existing = document.querySelector('.notification-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = `notification-toast ${type}`;

        let icon = 'ℹ️';
        if (type === 'error') icon = '⚠️';
        if (type === 'success') icon = '✅';

        toast.innerHTML = `
            <span class="notification-icon">${icon}</span>
            <span class="notification-message">${message}</span>
            <button class="notification-close" onclick="this.parentElement.remove()">×</button>
        `;

        document.body.appendChild(toast);

        // Auto remove
        setTimeout(() => {
            if (toast.parentElement) {
                toast.style.animation = 'slideUp 0.3s ease reverse';
                setTimeout(() => toast.remove(), 300);
            }
        }, 5000);
    }

    /**
     * Inject CSS for notifications
     */
    injectStyles() {
        if (!document.getElementById('notification-styles')) {
            const style = document.createElement('style');
            style.id = 'notification-styles';
            style.textContent = `
                .notification-toast {
                    position: fixed;
                    bottom: 20px;
                    left: 50%;
                    transform: translateX(-50%);
                    padding: 12px 20px;
                    border-radius: 8px;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    z-index: 10000;
                    font-family: var(--font-sans);
                    font-size: 14px;
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
                    animation: slideUp 0.3s ease;
                }
                .notification-toast.error {
                    background: linear-gradient(135deg, #ff4444, #cc0000);
                    color: white;
                }
                .notification-toast.success {
                    background: linear-gradient(135deg, #00cc66, #009944);
                    color: white;
                }
                .notification-toast.info {
                    background: linear-gradient(135deg, #0088ff, #0066cc);
                    color: white;
                }
                .notification-close {
                    background: none;
                    border: none;
                    color: white;
                    font-size: 20px;
                    cursor: pointer;
                    padding: 0 5px;
                    opacity: 0.7;
                }
                .notification-close:hover {
                    opacity: 1;
                }
                @keyframes slideUp {
                    from {
                        opacity: 0;
                        transform: translateX(-50%) translateY(20px);
                    }
                    to {
                        opacity: 1;
                        transform: translateX(-50%) translateY(0);
                    }
                }
            `;
            document.head.appendChild(style);
        }
    }
}
