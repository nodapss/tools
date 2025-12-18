/**
 * Port Component
 * Represents input/output port for S-parameter measurements
 */
class Port extends Component {
    constructor(x, y, portNumber = 1, impedance = 50) {
        super('PORT', x, y);
        this.params = {
            portNumber: portNumber,
            impedance: impedance  // Reference impedance (typically 50Ω)
        };

        // Port has only one terminal (right side) - aligned to grid
        this.terminals = {
            start: { x: 20, y: 0 }
        };

        // Re-snap after setting terminals
        this.snapTerminalsToGrid();
    }

    /**
     * Render port symbol (circle with P)
     */
    renderBody() {
        return `
            <g class="component-body">
                <!-- Port circle -->
                <circle cx="0" cy="0" r="15" fill="none" stroke="currentColor" stroke-width="2"/>
                <!-- Port number (pointer-events: none to prevent text selection) -->
                <text x="0" y="5" text-anchor="middle" font-size="12" fill="currentColor" font-weight="bold"
                      pointer-events="none" style="user-select: none;">P${this.params.portNumber}</text>
                <!-- Connection line to terminal -->
                <line x1="15" y1="0" x2="20" y2="0" stroke="currentColor" stroke-width="2"/>
            </g>
        `;
    }

    /**
     * Render terminals (only one for port)
     */
    renderTerminals() {
        const offset = this.terminals.start;
        const connected = this.connections.start !== null;
        return `<circle class="terminal ${connected ? 'connected' : ''}" 
                       data-terminal="start"
                       cx="${offset.x}" cy="${offset.y}" r="4"/>`;
    }

    /**
     * Render port impedance value
     */
    renderValue() {
        return `<text class="component-value" x="0" y="28" text-anchor="middle" 
                      pointer-events="none" style="user-select: none;">${this.params.impedance}Ω</text>`;
    }

    /**
     * Override label to show port number
     */
    renderLabel() {
        return ''; // Port number is shown in the body
    }

    /**
     * Custom hitbox for Port (원형 영역 포함하는 사각형)
     */
    renderHitbox() {
        return `<rect class="hitbox" 
                      x="-20" y="-20" 
                      width="45" height="40"
                      fill="transparent" 
                      style="pointer-events: all;"/>`;
    }

    /**
     * Port impedance is the reference impedance
     */
    getImpedance(frequency) {
        return { real: this.params.impedance, imag: 0 };
    }

    /**
     * Check bounds
     */
    containsPoint(x, y) {
        const dx = x - this.x;
        const dy = y - this.y;
        return Math.sqrt(dx * dx + dy * dy) <= 20;
    }

    /**
     * Create from JSON
     */
    static fromJSON(data) {
        const port = new Port(data.x, data.y, data.params.portNumber, data.params.impedance);
        port.id = data.id;
        port.rotation = data.rotation;
        port.connections = data.connections;
        if (data.sliderRange) {
            port.sliderRange = data.sliderRange;
        }
        return port;
    }
}

window.Port = Port;

