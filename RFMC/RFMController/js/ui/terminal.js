(function () {
    // Terminal settings
    let maxTerminalLines = parseInt(localStorage.getItem('maxTerminalLines')) || 1000;

    // Log function with max line limit
    RF.ui.log = function (msg, isTx = false) {
        const term = document.getElementById('terminal');
        if (!term) return;

        const line = document.createElement('div');
        line.textContent = (isTx ? '> ' : '') + msg;
        if (isTx) line.style.color = '#4ec9b0';
        term.appendChild(line);

        // Remove old lines if exceeds max
        while (term.children.length > maxTerminalLines) {
            term.removeChild(term.firstChild);
        }

        term.scrollTop = term.scrollHeight;
    };

    // Clear terminal
    RF.ui.clearTerminal = function () {
        const term = document.getElementById('terminal');
        if (!term) return;
        term.innerHTML = '';
        RF.ui.log('Terminal cleared');
    };

    // Copy terminal content to clipboard
    RF.ui.copyTerminal = function () {
        const term = document.getElementById('terminal');
        if (!term) return;

        const textContent = Array.from(term.children)
            .map(line => line.textContent)
            .join('\n');

        navigator.clipboard.writeText(textContent).then(() => {
            RF.ui.log('터미널 내용이 클립보드에 복사되었습니다.');
        }).catch(err => {
            console.error('클립보드 복사 실패:', err);
            RF.ui.log('클립보드 복사 실패');
        });
    };

    // Get/Set max terminal lines
    RF.ui.getMaxTerminalLines = function () {
        return maxTerminalLines;
    };

    RF.ui.setMaxTerminalLines = function (value) {
        maxTerminalLines = parseInt(value) || 1000;
        localStorage.setItem('maxTerminalLines', maxTerminalLines);
    };
})();
