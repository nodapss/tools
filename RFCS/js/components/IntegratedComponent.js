/**
 * IntegratedComponent.js
 * Represents a group of components integrated into a single block.
 * Stores internal circuit data (Virtual Circuit) for simulation.
 */
class IntegratedComponent extends Component {
    constructor(x, y) {
        super('INTEGRATED', x, y);

        // Reference IDs instead of embedded copies
        this.componentIds = [];
        this.wireIds = [];

        this.internalPortConfig = {
            inputTerminal: null,
            groundTerminal: null
        };

        // Visual dimensions
        this.width = 100;
        this.height = 60;

        // Integrated Component is a Visual Group, so no external terminals
        this.terminals = {};

        // Label position relative to center
        this.labelX = 0;
        this.labelY = -40;
    }

    /**
     * Set internal circuit reference
     * @param {Array} componentIds - List of component IDs
     * @param {Array} wireIds - List of wire IDs
     * @param {Object} config - Port configuration
     */
    setInternalCircuit(componentIds, wireIds, config) {
        this.componentIds = componentIds || [];
        this.wireIds = wireIds || [];
        this.internalPortConfig = { ...config };

        // Dimensions will be updated by Circuit or render loop
        this.updateDimensions();
    }

    /**
     * Update dimensions based on referenced components
     */
    updateDimensions() {
        if (!window.circuit) return;

        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        let hasItems = false;

        this.componentIds.forEach(id => {
            const comp = window.circuit.getComponent(id);
            if (comp) {
                // Approximate bounding box of component (standard size usually 40-60)
                // Using center +/- 30 as a safe margin for visuals
                minX = Math.min(minX, comp.x - 30);
                minY = Math.min(minY, comp.y - 30);
                maxX = Math.max(maxX, comp.x + 30);
                maxY = Math.max(maxY, comp.y + 30);
                hasItems = true;
            }
        });

        // Also check wires if strictly needed, but component bounds usually define the area well enough.
        // If wires go way out, we might want to include them.
        this.wireIds.forEach(id => {
            const wire = window.circuit.getWire(id);
            if (wire) {
                minX = Math.min(minX, wire.startX, wire.endX);
                minY = Math.min(minY, wire.startY, wire.endY);
                maxX = Math.max(maxX, wire.startX, wire.endX);
                maxY = Math.max(maxY, wire.startY, wire.endY);
                hasItems = true;
            }
        });

        if (hasItems) {
            const padding = 20;
            minX -= padding;
            minY -= padding;
            maxX += padding;
            maxY += padding;

            this.width = maxX - minX;
            this.height = maxY - minY;
            this.x = minX + this.width / 2;
            this.y = minY + this.height / 2;

            // Adjust label position to be at top
            this.labelY = -(this.height / 2) - 15;
        }
    }

    /**
     * Override renderLabel to place it above the box
     */
    renderLabel() {
        return `<text class="component-label" x="0" y="${this.labelY}" text-anchor="middle" 
                      pointer-events="none" style="user-select: none; font-weight: bold; fill: #555;">${this.id}</text>`;
    }

    /**
     * Override renderTerminals to do nothing (No external terminals)
     */
    renderTerminals() {
        return '';
    }

    /**
     * Override renderHitbox to do nothing (Use renderBody for events)
     */
    renderHitbox() {
        return '';
    }

    renderBody() {
        // Draw a transparent box representing the group
        // Centered at 0,0 (Component local coords) which maps to this.x, this.y
        const w = this.width;
        const h = this.height;
        const x = -w / 2;
        const y = -h / 2;

        // Uses explicit pointer-events: all to capture clicks on the background
        return `
            <rect class="component-body group-box" x="${x}" y="${y}" width="${w}" height="${h}" 
                  rx="10" ry="10" 
                  fill="rgba(200, 220, 255, 0.1)" 
                  stroke="#89a" stroke-width="2" stroke-dasharray="5,5" 
                  style="pointer-events: all;" />
        `;
    }

    /**
     * Override toJSON to include references
     */
    toJSON() {
        const base = super.toJSON();
        return {
            ...base,
            componentIds: this.componentIds,
            wireIds: this.wireIds,
            internalPortConfig: this.internalPortConfig
        };
    }

    /**
     * Factory method
     */
    static fromJSON(data) {
        const comp = new IntegratedComponent(data.x, data.y);
        comp.id = data.id;
        comp.rotation = data.rotation;
        comp.params = { ...data.params };

        // Restore ID references
        if (data.componentIds) comp.componentIds = data.componentIds;
        if (data.wireIds) comp.wireIds = data.wireIds;

        // Fallback for old Embedded format (migration)
        if (data.subComponents && !data.componentIds) {
            // If loading old file, we might lose data if we don't restore them to circuit?
            // But 'fromJSON' is usually used when loading a whole circuit.
            // If the global file has internal data, we should probably instantiate them?
            // This is complex. For now, assume new format or empty.
            // Or keep data for legacy impedence calc only?
            // The user said "grouping". 
            console.warn('Legacy IntegratedComponent detected. Grouping might be empty.');
        }

        if (data.internalPortConfig) comp.internalPortConfig = data.internalPortConfig;
        if (data.impedanceConfig) comp.internalPortConfig = data.impedanceConfig; // Legacy

        return comp;
    }

    /**
     * Build internal simulation model with Debugging
     */
    buildInternalSimulationModel() {
        console.log(`[IntegratedComponent] Building Virtual Circuit for ${this.id}`);
        // Ensure dimensions/references are fresh
        this.updateDimensions();

        const tempCircuit = new window.Circuit();
        const idMap = new Map(); // Original ID -> Clone Object

        // 1. Clone Components from LIVE circuit
        this.componentIds.forEach(id => {
            const originalComp = window.circuit.getComponent(id);
            if (!originalComp) {
                console.warn(`[IntegratedComponent] Missing Component: ${id}`);
                return;
            }

            const data = originalComp.toJSON();

            // Factory logic
            let CompClass;
            // Map types to classes (Simple mapping for now, ideally Circuit.getComponentClass)
            switch (data.type) {
                case 'R': CompClass = window.Resistor; break;
                case 'L': CompClass = window.Inductor; break;
                case 'C': CompClass = window.Capacitor; break;
                case 'GND': CompClass = window.Ground; break;
                case 'TL': CompClass = window.TransmissionLine; break;
                case 'Z': CompClass = window.ImpedanceBlock; break;
                case 'PORT': CompClass = window.Port; break;
                default: CompClass = window.Component;
            }

            if (CompClass) {
                const clone = new CompClass(data.x, data.y);
                clone.id = data.id;
                clone.rotation = data.rotation;
                clone.params = { ...data.params };
                if (clone.updateTerminals) clone.updateTerminals();

                tempCircuit.addComponent(clone);
                idMap.set(data.id, clone);
            }
        });

        // 2. Clone Wires from LIVE circuit
        this.wireIds.forEach(id => {
            const originalWire = window.circuit.getWire(id);
            if (!originalWire) return;

            const wireData = originalWire.toJSON();
            const wire = new window.Wire(wireData.startX, wireData.startY, wireData.endX, wireData.endY);

            // Map IDs
            if (wireData.startComponent && idMap.has(wireData.startComponent)) {
                wire.startComponent = wireData.startComponent;
                wire.startTerminal = wireData.startTerminal;
            }
            if (wireData.endComponent && idMap.has(wireData.endComponent)) {
                wire.endComponent = wireData.endComponent;
                wire.endTerminal = wireData.endTerminal;
            }

            tempCircuit.addWire(wire);
        });

        // 3. Attach Input Port (Same logic as before, but using live-cloned Map)
        const [inId, inTerm] = (this.internalPortConfig.inputTerminal || '').split(':');
        const [gndId, gndTerm] = (this.internalPortConfig.groundTerminal || '').split(':');

        if (inId && idMap.has(inId)) {
            const targetComp = idMap.get(inId);
            const pos = targetComp.getTerminalPosition(inTerm);

            const port = new window.Port(pos.x - 60, pos.y, 1, 50);
            tempCircuit.addComponent(port);

            const wire = new window.Wire(port.x + 20, port.y, pos.x, pos.y);
            wire.startComponent = port.id;
            wire.startTerminal = 'start';
            wire.endComponent = inId;
            wire.endTerminal = inTerm;
            tempCircuit.addWire(wire);
        }

        // 4. Attach Ground
        if (gndId && idMap.has(gndId)) {
            const targetComp = idMap.get(gndId);
            const pos = targetComp.getTerminalPosition(gndTerm);

            const gnd = new window.Ground(pos.x + 60, pos.y);
            tempCircuit.addComponent(gnd);

            const wire = new window.Wire(pos.x, pos.y, gnd.x, gnd.y - 20);
            wire.startComponent = gndId;
            wire.startTerminal = gndTerm;
            wire.endComponent = gnd.id;
            wire.endTerminal = 'start';
            tempCircuit.addWire(wire);
        }

        return tempCircuit;
    }

    getImpedance(frequency) {
        // Cache invalidation logic could be added here (e.g. check version ID of circuit)
        // For now, rebuild every time or rely on manual invalidation?
        // User said "Internal calculation... leave it".
        // But with live references, we should probably rebuild if invalid.
        // For performance, let's keep the lazy load but we need a way to know if internals changed.
        // Since we are "Grouping", any change in circuit 'global' might affect us.
        // Safer to rebuild if not extremely heavy. Or subscribe to circuit change.

        // For now, let's Re-build to ensure correctness (Zero-Copy optimization mentioned in history was for embedded)
        // Since we fetch from map now, it's fast.

        // Actually, let's check basic cache.
        if (!this._internalAnalyzer) {
            const tempCircuit = this.buildInternalSimulationModel();
            if (!tempCircuit) return { real: Infinity, imag: 0 };

            this._internalAnalyzer = new window.NetworkAnalyzer(tempCircuit);
            this._internalAnalyzer.analyze();
        }

        try {
            const zin = this._internalAnalyzer.calculateInputImpedance(frequency);
            return { real: zin.real, imag: zin.imag };
        } catch (e) {
            return { real: Infinity, imag: 0 };
        }
    }
    /**
     * Invalidate Cache (Call this when internal params change)
     */
    invalidateCache() {
        this._internalAnalyzer = null;
        console.log(`[IntegratedComponent] Cache invalidated for ${this.id}`);
    }
}

window.IntegratedComponent = IntegratedComponent;
