/**
 * Inline Value Editor
 * Allows direct editing of component values on the canvas
 */
class ValueEditor {
    constructor(circuit) {
        this.circuit = circuit;
        this.element = null;
        this.input = null;
        this.activeComponent = null;
        this.activeTextElement = null;

        // Configuration for primary parameters
        this.PARAM_CONFIG = {
            'R': { name: 'resistance', unit: 'Ω' },
            'L': { name: 'inductance', unit: 'H' },
            'C': { name: 'capacitance', unit: 'F' },
            'TL': { name: 'length', unit: 'm' }, // TL usually length?
            'PORT': { name: 'impedance', unit: 'Ω' }
        };

        this.init();
    }

    init() {
        // Create container
        this.element = document.createElement('div');
        this.element.className = 'value-editor-overlay';
        Object.assign(this.element.style, {
            position: 'absolute',
            display: 'none',
            zIndex: '2000', // Above generic overlays
            pointerEvents: 'auto'
        });

        // Create input
        this.input = document.createElement('input');
        this.input.type = 'text';
        this.input.className = 'value-editor-input';
        Object.assign(this.input.style, {
            width: '50px',
            padding: '2px 2px',
            border: '1px solid #444',
            borderRadius: '2px',
            backgroundColor: '#1E1E1E',
            color: '#E0E0E0',
            fontSize: '10px',
            textAlign: 'center',
            boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
            outline: 'none',
            fontFamily: 'JetBrains Mono, monospace'
        });

        this.element.appendChild(this.input);
        document.body.appendChild(this.element);

        // Bind events
        this.input.addEventListener('keydown', (e) => this.handleKeyDown(e));
        // Commit on blur is standard, but sometimes tricky if clicking away cancels. 
        // For productivity, blur=commit is usually best.
        this.input.addEventListener('blur', () => this.commit());
        this.input.addEventListener('mousedown', (e) => e.stopPropagation());

        // Prevent canvas panning when interacting with input
        this.element.addEventListener('mousedown', (e) => e.stopPropagation());
    }

    /**
     * Start editing a component value
     * @param {Component} component The component to edit
     * @param {SVGElement} textElement The SVG text element showing the value
     */
    edit(component, textElement) {
        if (!component) return;

        // If textElement is not provided (e.g. new component), try to find it
        if (!textElement && component.element) {
            textElement = component.element.querySelector('.component-value');
        }

        if (!textElement) {
            // Fallback: If no visible text currently (maybe hidden?), just show at component center
            // But usually render() creates it.
            return;
        }

        this.activeComponent = component;
        this.activeTextElement = textElement;

        const config = this.PARAM_CONFIG[component.type];
        if (!config) return;

        // Hide InlineSlider if active
        if (window.inlineSlider) window.inlineSlider.hide();

        // Get current value string
        const val = component.params[config.name];
        // Format simple for editing (e.g. 10k instead of 10kΩ if possible, but Component.formatValue adds unit)
        // Let's use formatValue and let user edit it.
        // Format string using Component.formatValue (returns e.g. "50Ω" or "10nF")
        let displayVal = Component.formatValue(val, config.unit);

        // Strip the unit character to show only number + prefix (e.g. "50", "10n")
        // We know config.unit is the suffix, so we can replace it.
        // Special case: if unit is not found (unlikely), it stays as is.
        if (config.unit && displayVal.endsWith(config.unit)) {
            displayVal = displayVal.slice(0, -config.unit.length);
        }

        // Position input over text
        const rect = textElement.getBoundingClientRect();

        // Center input on text
        const inputWidth = 50;
        const inputHeight = 20;

        // Calculate centered position
        // rect.left + rect.width/2 is center x
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        this.element.style.left = `${centerX - inputWidth / 2 + window.scrollX}px`;
        this.element.style.top = `${centerY - inputHeight / 2 + window.scrollY}px`;
        this.input.style.width = `${inputWidth}px`;
        this.input.style.height = `${inputHeight}px`;

        this.element.style.display = 'block';

        this.input.value = displayVal;
        this.input.select(); // Select all text for easy replacement
        this.input.focus();
    }

    /**
     * Commit changes
     */
    commit() {
        if (!this.activeComponent || this.element.style.display === 'none') return;

        // Use timeout to allow click events to clear (optional but safe)
        // But here we want immediate update.

        const rawValue = this.input.value;
        const config = this.PARAM_CONFIG[this.activeComponent.type];

        if (config && rawValue) {
            // Parse value
            const parsed = Component.parseValue(rawValue);
            if (!isNaN(parsed)) {

                // Special check: don't allow 0/negative if critical? 
                // InlineSlider had min/max. Component params usually flexible.
                // Keeping it simple: blindly accept valid number.

                // Only update if changed (though parseValue might return slightly diff float)
                const current = this.activeComponent.params[config.name];
                if (Math.abs(current - parsed) > 1e-12) {
                    this.activeComponent.params[config.name] = parsed;

                    // Trigger updates
                    if (this.circuit) this.circuit.notifyChange();
                    if (window.canvasManager) window.canvasManager.renderComponents();
                }
            }
        }

        this.hide();
    }

    /**
     * Cancel editing
     */
    cancel() {
        this.hide();
    }

    /**
     * Hide editor
     */
    hide() {
        this.element.style.display = 'none';
        this.activeComponent = null;
        this.activeTextElement = null;
        // Return focus to body to prevent stuck focus
        if (document.activeElement === this.input) {
            document.body.focus();
        }
    }

    /**
     * Handle key events
     */
    handleKeyDown(e) {
        e.stopPropagation(); // Prevent shortcuts like 's', 'w', etc.

        if (e.key === 'Enter') {
            this.input.blur(); // Triggers commit
        } else if (e.key === 'Escape') {
            this.cancel(); // No commit
        }
    }
}

// Export
window.ValueEditor = ValueEditor;
