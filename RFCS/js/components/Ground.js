/**
 * Ground Component
 * Reference node with zero voltage
 */
class Ground extends Component {
    constructor(x, y) {
        super('GND', x, y);
        this.params = {};

        // Ground has only one terminal (top) - aligned to grid
        this.terminals = {
            start: { x: 0, y: -20 }
        };

        // Re-snap after setting terminals
        this.snapTerminalsToGrid();
    }

    /**
     * Render ground symbol
     */
    renderBody() {
        return `
            <g class="component-body">
                <!-- Vertical line from terminal -->
                <line x1="0" y1="-20" x2="0" y2="0" stroke="currentColor" stroke-width="2"/>
                <!-- Ground bars -->
                <line x1="-12" y1="0" x2="12" y2="0" stroke="currentColor" stroke-width="2"/>
                <line x1="-8" y1="5" x2="8" y2="5" stroke="currentColor" stroke-width="2"/>
                <line x1="-4" y1="10" x2="4" y2="10" stroke="currentColor" stroke-width="2"/>
            </g>
        `;
    }

    /**
     * Render terminals (only one for ground)
     */
    renderTerminals() {
        const offset = this.terminals.start;
        const connected = this.connections.start !== null || (this.directConnections && this.directConnections.start);
        return `<circle class="terminal ${connected ? 'connected' : ''}" 
                       data-terminal="start"
                       cx="${offset.x}" cy="${offset.y}" r="4"/>`;
    }

    /**
     * No value to display
     */
    renderValue() {
        return '';
    }

    /**
     * Custom hitbox for Ground (세로로 긴 형태)
     */
    renderHitbox() {
        return `<rect class="hitbox" 
                      x="-15" y="-25" 
                      width="30" height="40"
                      fill="transparent" 
                      style="pointer-events: all;"/>`;
    }

    /**
     * Ground has zero impedance (short to ground)
     */
    getImpedance(frequency) {
        return { real: 0, imag: 0 };
    }

    /**
     * Check if point is within ground bounds
     */
    containsPoint(x, y) {
        const dx = x - this.x;
        const dy = y - this.y;
        return Math.abs(dx) <= 15 && dy >= -25 && dy <= 15;
    }

    /**
     * Create from JSON
     */
    static fromJSON(data) {
        const ground = new Ground(data.x, data.y);
        ground.id = data.id;
        ground.rotation = data.rotation;
        ground.connections = data.connections;
        return ground;
    }
}

window.Ground = Ground;

