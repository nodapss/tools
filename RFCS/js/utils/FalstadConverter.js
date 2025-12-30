/**
 * FalstadConverter.js
 * Converts internal circuit representation to Falstad Circuit Simulator text format.
 */
class FalstadConverter {
    static SCALE_FACTOR = 0.8; // Convert 20-grid to 16-grid

    /**
     * Export circuit to Falstad text format
     * @param {Circuit} circuit 
     */
    static export(circuit) {
        if (!circuit) return '';

        const lines = [];

        // 1. Header
        lines.push(this.createHeader());

        // 2. Components
        const components = circuit.getAllComponents();
        components.forEach(comp => {
            const line = this.convertComponent(comp);
            if (line) lines.push(line);
        });

        // 3. Wires
        const wires = circuit.getAllWires();
        wires.forEach(wire => {
            const line = this.convertWire(wire);
            if (line) lines.push(line);
        });

        return lines.join('\n');
    }

    static createHeader() {
        // Default settings matching the user's example
        // $ flags time_step sim_speed current_range voltage_range options ...
        return '$ 1 0.000005 10.20027730826997 50 5 43 5e-11';
    }

    static convertComponent(comp) {
        // Coordinate conversion
        // Use component terminals to determine direction/endpoints
        // Falstad defines components by two points (usually terminals)

        const type = comp.type;
        const p1 = comp.getTerminalPosition('start');

        let p2;
        try {
            // Try to get end terminal. If it doesn't exist (e.g. Ground, Port), use component center.
            if (comp.terminals.end) {
                p2 = comp.getTerminalPosition('end');
            } else {
                // For Ground and Port, the "second point" for orientation can be the component center
                // Ground terminal is at (0, -20), Center at (0, 0). Vector (0, 20) points "down" into ground.
                // Port terminal is at (20, 0), Center at (0, 0). Vector (-20, 0) points "back" to source.
                p2 = { x: comp.x, y: comp.y };
            }
        } catch (e) {
            console.warn(`Could not determine p2 for component ${comp.id}, using center.`);
            p2 = { x: comp.x, y: comp.y };
        }

        const x1 = Math.round(p1.x * this.SCALE_FACTOR);
        const y1 = Math.round(p1.y * this.SCALE_FACTOR);
        const x2 = Math.round(p2.x * this.SCALE_FACTOR);
        const y2 = Math.round(p2.y * this.SCALE_FACTOR);

        const flags = 0; // Default flags

        switch (type) {
            case 'R': // Resistor
                // r x1 y1 x2 y2 flags resistance
                return `r ${x1} ${y1} ${x2} ${y2} ${flags} ${comp.params.resistance}`;

            case 'C': // Capacitor
                // c x1 y1 x2 y2 flags capacitance vdiff body_voltage current
                // Falstad defaults: vdiff=0
                return `c ${x1} ${y1} ${x2} ${y2} ${flags} ${comp.params.capacitance || 1e-5} 0`;

            case 'L': // Inductor
                // l x1 y1 x2 y2 flags inductance current
                return `l ${x1} ${y1} ${x2} ${y2} ${flags} ${comp.params.inductance || 1} 0`;

            case 'GND': // Ground
                // g x1 y1 x2 y2 flags
                // Ground in Falstad is a 1-terminal component, but format uses 2 points
                // Usually x2, y2 is just to determine orientation.
                // Our internal Ground is x, y centered, but terminals are at y=0 relative?
                // Wait, let's check Ground.js or just use current logic.
                // Assuming Ground has 'start' terminal only? Or start/end?
                // Start is -40, End is 40 in Component base. Ground overrides?
                // Let's assume standard 2-point for now or check if Ground.js overrides terminals.
                // If single terminal, p2 might be same or offset.
                // FALSTAD: g x1 y1 x2 y2 ... x1,y1 is the connection point.
                return `g ${x1} ${y1} ${x2} ${y2} ${flags} 0`;

            case 'PORT': // Map to Voltage Rail (R) - 1 terminal AC source
                // R x1 y1 x2 y2 flags waveform freq maxV bias phase duty
                // waveform: 0=DC, 1=AC, freq=40, maxV=5
                return `R ${x1} ${y1} ${x2} ${y2} ${flags} 1 40 5 0 0 0.5`;

            // TODO: Implement other types (TL, etc)
            default:
                console.warn(`Unmapped component type for Falstad export: ${type}`);
                return null;
        }
    }

    static convertWire(wire) {
        // w x1 y1 x2 y2 flags
        const x1 = Math.round(wire.startX * this.SCALE_FACTOR);
        const y1 = Math.round(wire.startY * this.SCALE_FACTOR);
        const x2 = Math.round(wire.endX * this.SCALE_FACTOR);
        const y2 = Math.round(wire.endY * this.SCALE_FACTOR);

        return `w ${x1} ${y1} ${x2} ${y2} 0`;
    }
}

window.FalstadConverter = FalstadConverter;
