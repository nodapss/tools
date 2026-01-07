/**
 * Shortcut Handler
 * Handles global keyboard shortcuts, customizable key bindings, and persistence.
 */
class ShortcutHandler {
    constructor(circuit, canvasManager, canvasElementId = 'circuitCanvas') {
        this.circuit = circuit;
        this.canvasManager = canvasManager;
        this.canvasElement = document.getElementById(canvasElementId);

        // Default Shortcuts Definition
        // Format: 'Action Name': { keys: ['key1', 'key2'], description: 'Description' }
        // keys: normalized lowercase, e.g., 'ctrl+z', 'shift+r', 'delete', 'escape', '1'
        this.defaults = {
            // Tools
            'select_mode': { keys: ['s'], description: 'Select Mode' },
            'wire_mode': { keys: ['w'], description: 'Wire Mode' },
            'paint_mode': { keys: ['p'], description: 'Paint Mode' },
            'component_mode': { keys: ['c'], description: 'Place Components Mode' },

            // Component Placement
            'place_resistor': { keys: ['r'], description: 'Place Resistor' },
            'place_inductor': { keys: ['l'], description: 'Place Inductor' },
            'place_capacitor': { keys: ['c'], description: 'Place Capacitor' },
            'place_ground': { keys: ['g'], description: 'Place Ground' },
            'place_transmission_line': { keys: ['t'], description: 'Place Transmission Line' },
            'place_port': { keys: ['p'], description: 'Place Port' },

            // Clipboard
            'copy': { keys: ['ctrl+c'], description: 'Copy Selected' },
            'paste': { keys: ['ctrl+v'], description: 'Paste' },

            // Edit Operations
            'undo': { keys: ['ctrl+z'], description: 'Undo' },
            'redo': { keys: ['ctrl+y', 'ctrl+shift+z'], description: 'Redo' },
            'delete_selected': { keys: ['delete', 'backspace'], description: 'Delete Selected' },
            'rotate_selected': { keys: ['space'], description: 'Rotate Selected' },
            'select_all': { keys: ['ctrl+a'], description: 'Select All' },
            'cancel_action': { keys: ['escape'], description: 'Cancel / Deselect' },

            // View
            'zoom_in': { keys: ['ctrl+='], description: 'Zoom In' },
            'zoom_out': { keys: ['ctrl+-'], description: 'Zoom Out' },
            'reset_view': { keys: ['ctrl+0'], description: 'Reset View' },

            // Drawing / Paint Colors
            'paint_color_1': { keys: ['1'], description: 'Paint Color 1 (Red)' },
            'paint_color_2': { keys: ['2'], description: 'Paint Color 2 (Blue)' },
            'paint_color_3': { keys: ['3'], description: 'Paint Color 3 (White)' },
            'paint_color_4': { keys: ['4'], description: 'Paint Custom Color' },
        };

        this.shortcuts = {};
        this.loadShortcuts();

        this.init();
    }

    init() {
        this.updateTooltip();
        // We do NOT bind global keydown here if we want to delegate to specific contexts?
        // Actually, main.js usually handles global keys, but it's cleaner if specific managers ask "did this match?"
        // OR we handle common global ones here (like Undo/Redo) and let others query.
        // For backward compatibility, we will keep the global handler for Undo/Redo/Zoom, 
        // but expose a 'matches(e, action)' method for other classes.

        document.addEventListener('keydown', (e) => this.handleGlobalKeyboard(e));
    }

    loadShortcuts() {
        const stored = localStorage.getItem('rf_circuit_shortcuts');
        if (stored) {
            try {
                // Merge stored with defaults to ensure new actions exist
                const parsed = JSON.parse(stored);
                // Deep merge or just overwrite keys?
                // We map them to our internal structure
                this.shortcuts = JSON.parse(JSON.stringify(this.defaults)); // Deep copy defaults

                Object.keys(parsed).forEach(action => {
                    if (this.shortcuts[action]) {
                        this.shortcuts[action].keys = parsed[action];
                    }
                });

                // Ensure new defaults are present if missing in storage
                Object.keys(this.defaults).forEach(action => {
                    if (!parsed[action] && this.defaults[action]) {
                        this.shortcuts[action] = JSON.parse(JSON.stringify(this.defaults[action]));
                    }
                });
            } catch (e) {
                console.error('Failed to load shortcuts', e);
                this.shortcuts = JSON.parse(JSON.stringify(this.defaults));
            }
        } else {
            this.shortcuts = JSON.parse(JSON.stringify(this.defaults));
        }
    }

    saveShortcuts() {
        // We only save the key arrays to save space and allow description updates
        const toSave = {};
        Object.keys(this.shortcuts).forEach(action => {
            toSave[action] = this.shortcuts[action].keys;
        });
        localStorage.setItem('rf_circuit_shortcuts', JSON.stringify(toSave));
        this.updateTooltip();
    }

    resetDefaults() {
        this.shortcuts = JSON.parse(JSON.stringify(this.defaults));
        this.saveShortcuts();
        // Notify user? 
    }

    importShortcuts(jsonString) {
        try {
            const parsed = JSON.parse(jsonString);
            Object.keys(parsed).forEach(action => {
                if (this.shortcuts[action]) {
                    this.shortcuts[action].keys = parsed[action];
                }
            });
            this.saveShortcuts();
            return true;
        } catch (e) {
            console.error('Import failed', e);
            return false;
        }
    }

    exportShortcuts() {
        const toSave = {};
        Object.keys(this.shortcuts).forEach(action => {
            toSave[action] = this.shortcuts[action].keys;
        });
        return JSON.stringify(toSave, null, 2);
    }

    /**
     * Check if event matches an action
     * @param {KeyboardEvent} e 
     * @param {string} actionName 
     */
    matches(e, actionName) {
        if (!this.shortcuts[actionName]) return false;

        const keys = this.shortcuts[actionName].keys;
        return keys.some(k => this.checkKey(e, k));
    }

    checkKey(e, keyString) {
        const parts = keyString.split('+');
        const mainKey = parts[parts.length - 1].toLowerCase();

        const ctrl = parts.includes('ctrl');
        const shift = parts.includes('shift');
        const alt = parts.includes('alt');
        const meta = parts.includes('meta'); // Command on Mac

        // Check modifiers
        if (e.ctrlKey !== ctrl && e.metaKey !== ctrl) return false; // Treat Ctrl/Cmd same usually
        if (e.shiftKey !== shift) return false;
        if (e.altKey !== alt) return false;

        // Check key
        // Special mapping for keys
        let eventKey = e.key.toLowerCase();

        // Fix for 'delete'
        if (eventKey === 'delete') eventKey = 'delete';
        if (eventKey === 'escape') eventKey = 'escape';
        if (eventKey === ' ') eventKey = 'space';

        // Comparison
        return eventKey === mainKey;
    }

    updateTooltip() {
        if (!this.canvasElement) return;

        // Generate tooltip text from current shortcuts
        // We pick the first keybinding for display
        const lines = Object.keys(this.shortcuts).map(action => {
            const binding = this.shortcuts[action];
            const keys = binding.keys[0]; // Just show primary
            if (!keys) return null;
            return `${keys.toUpperCase()}: ${binding.description}`;
        }).filter(Boolean);

        this.canvasElement.setAttribute('title', lines.join('\n'));
    }

    handleGlobalKeyboard(e) {
        // Ignore inputs
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;

        // Global Actions handled here (Undo/Redo, Zoom)
        // Note: DragDropHandler and others will query 'matches' in their own listeners of document or canvas.
        // We need to prevent double handling if they are handled elsewhere.
        // However, standard app-wide shortcuts like Undo/Redo are best handled here.

        if (this.matches(e, 'undo')) {
            e.preventDefault();
            this.circuit.undo();
            this.canvasManager.renderComponents();
        } else if (this.matches(e, 'redo')) {
            e.preventDefault();
            this.circuit.redo();
            this.canvasManager.renderComponents();
        } else if (this.matches(e, 'zoom_in')) {
            e.preventDefault();
            this.canvasManager.zoomIn(); // Assuming method exists
        } else if (this.matches(e, 'zoom_out')) {
            e.preventDefault();
            this.canvasManager.zoomOut();
        } else if (this.matches(e, 'reset_view')) {
            e.preventDefault();
            this.canvasManager.resetView(); // Assuming method exists
        } else if (this.matches(e, 'copy')) {
            e.preventDefault();
            if (this.circuit.copySelected()) {
                // Visual feedback? 
                console.log('Copied to clipboard');
            }
        } else if (this.matches(e, 'paste')) {
            e.preventDefault();
            if (window.dragDropHandler) {
                window.dragDropHandler.startPasteMode();
            }
        }

        // Other keys are handled by specific managers logic (e.g., 'r' for resistor in dragging)
    }

    getActionKey(actionName) {
        if (this.shortcuts[actionName] && this.shortcuts[actionName].keys.length > 0) {
            return this.shortcuts[actionName].keys[0];
        }
        return '';
    }
}
