/**
 * ShortcutModal
 * Handles the keyboard shortcut customization UI
 */
class ShortcutModal {
    constructor(shortcutHandler) {
        this.handler = shortcutHandler;
        this.modal = document.getElementById('shortcutModal');
        this.btnClose = document.getElementById('btnCloseShortcut');
        this.btnCloseIcon = document.getElementById('btnCloseShortcutModal');
        this.tbody = document.getElementById('shortcutListBody');

        this.btnExport = document.getElementById('btnExportShortcuts');
        this.btnImport = document.getElementById('btnImportShortcuts');
        this.fileInput = document.getElementById('fileImportShortcuts');
        this.btnReset = document.getElementById('btnResetShortcuts');

        this.listeningRow = null; // Row currently listening for input

        this.init();
    }

    init() {
        if (this.btnClose) this.btnClose.addEventListener('click', () => {
            this.close();
            // Re-open settings? Or just go back to main. User flow: Settings -> Shortcuts -> Back to Settings?
            // "Back" usually implies return to parent.
            if (window.settingsModal) window.settingsModal.open();
        });

        if (this.btnCloseIcon) this.btnCloseIcon.addEventListener('click', () => this.close());

        if (this.btnExport) this.btnExport.addEventListener('click', () => this.handleExport());
        if (this.btnImport) this.btnImport.addEventListener('click', () => this.fileInput.click());
        if (this.fileInput) this.fileInput.addEventListener('change', (e) => this.handleImport(e));
        if (this.btnReset) this.btnReset.addEventListener('click', () => {
            if (confirm('Reset all shortcuts to default?')) {
                this.handler.resetDefaults();
                this.renderList();
            }
        });

        // Outside click
        window.addEventListener('click', (e) => {
            // If clicking outside while modal open, close it
            if (this.modal && e.target === this.modal) {
                this.close();
            }
        });
    }

    open() {
        if (this.modal) {
            this.modal.style.display = 'block';
            this.renderList();
        }
    }

    close() {
        if (this.modal) {
            this.modal.style.display = 'none';
            this.cancelListening();
        }
    }

    renderList() {
        if (!this.tbody) return;
        this.tbody.innerHTML = '';

        const shortcuts = this.handler.shortcuts;

        // Sort by description or action name?
        // Let's sort roughly by category order in defaults if possible, otherwise alphabetical
        // We'll just iterate for now.

        Object.entries(shortcuts).forEach(([action, binding]) => {
            const tr = document.createElement('tr');
            tr.style.borderBottom = '1px solid var(--border-color)';

            const keys = binding.keys.join(', ').toUpperCase();

            tr.innerHTML = `
                <td style="padding: 10px;">${binding.description}</td>
                <td style="padding: 10px;" class="key-display"><span class="kbd">${keys}</span></td>
                <td style="padding: 10px;">
                    <button class="btn-edit-key btn small secondary">Edit</button>
                    ${binding.keys.length > 0 ? '<button class="btn-clear-key btn small danger">Clear</button>' : ''}
                </td>
            `;

            // Edit Handler
            const editBtn = tr.querySelector('.btn-edit-key');
            editBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.startListening(action, tr);
            });

            // Clear Handler
            const clearBtn = tr.querySelector('.btn-clear-key');
            if (clearBtn) {
                clearBtn.addEventListener('click', () => {
                    this.handler.shortcuts[action].keys = [];
                    this.handler.saveShortcuts();
                    this.renderList();
                });
            }

            this.tbody.appendChild(tr);
        });
    }

    startListening(action, tr) {
        this.cancelListening(); // Cancel any existing
        this.listeningRow = tr;

        const keyDisplay = tr.querySelector('.key-display');
        const originalContent = keyDisplay.innerHTML;

        keyDisplay.innerHTML = '<span style="color: var(--primary-color); font-weight: bold;">Press key... (Esc to cancel)</span>';

        const handler = (e) => {
            e.preventDefault();
            e.stopPropagation();

            // Handle Cancel
            if (e.key === 'Escape') {
                this.cancelListening();
                return;
            }

            // Capture Key
            const parts = [];
            if (e.ctrlKey) parts.push('ctrl');
            if (e.shiftKey) parts.push('shift');
            if (e.altKey) parts.push('alt');
            if (e.metaKey) parts.push('meta'); // Command

            // Main key
            // Ignore if it's just a modifier pressed
            if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;

            let mainKey = e.key.toLowerCase();
            if (mainKey === ' ') mainKey = 'space';
            parts.push(mainKey);

            const keyString = parts.join('+');

            // Update Shortcut
            // Ensure uniqueness? 
            // We'll warn if duplicate? Or just allow it (conflicts handled by priority or valid check)
            // Ideally check if used.
            const existingAction = this.findActionByKey(keyString);
            if (existingAction && existingAction !== action) {
                if (!confirm(`Key '${keyString.toUpperCase()}' is already used by '${this.handler.shortcuts[existingAction].description}'. Overwrite?`)) {
                    this.cancelListening();
                    return;
                }
                // Clear old
                this.handler.shortcuts[existingAction].keys = [];
            }

            this.handler.shortcuts[action].keys = [keyString]; // Replace, don't append for now for simplicity
            this.handler.saveShortcuts();

            this.stopListening();
            this.renderList();
        };

        this.currentKeyListener = handler;
        document.addEventListener('keydown', handler, { capture: true, once: true }); // Use capture to grab before app

        // Remove listener if we click away?
        this.clickKiller = (e) => {
            if (!tr.contains(e.target)) {
                this.cancelListening();
            }
        };
        setTimeout(() => window.addEventListener('click', this.clickKiller), 10);
    }

    stopListening() {
        if (this.currentKeyListener) {
            document.removeEventListener('keydown', this.currentKeyListener, { capture: true });
            this.currentKeyListener = null;
        }
        if (this.clickKiller) {
            window.removeEventListener('click', this.clickKiller);
            this.clickKiller = null;
        }
        this.listeningRow = null;
    }

    cancelListening() {
        this.stopListening();
        this.renderList(); // Revert UI
    }

    findActionByKey(keyString) {
        // Naive reverse lookup
        for (const [act, binding] of Object.entries(this.handler.shortcuts)) {
            if (binding.keys.includes(keyString)) return act;
        }
        return null;
    }

    handleExport() {
        const json = this.handler.exportShortcuts();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'rf_simulator_shortcuts.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    handleImport(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const success = this.handler.importShortcuts(event.target.result);
            if (success) {
                alert('Shortcuts imported successfully!');
                this.renderList();
            } else {
                alert('Failed to import shortcuts. Invalid JSON.');
            }
            this.fileInput.value = ''; // Reset
        };
        reader.readAsText(file);
    }
}
