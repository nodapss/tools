/**
 * IntegratedComponent.js
 * Represents a group of components integrated into a single block.
 * Stores internal circuit data (Virtual Circuit) for simulation.
 */
class IntegratedComponent extends Component {
    constructor(x, y) {
        super('INTEGRATED', x, y);
        this.id = this.id.replace('INTEGRATED', 'BLOCK');

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

        // Cache for Virtual Circuit
        this.virtualCircuit = null;
        this._internalAnalyzer = null;
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

        // Eager Build: Create virtual circuit immediately (and cache it)
        this.rebuildVirtualCircuit();
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

        // Restore Virtual Circuit (rebuild on load)
        if (comp.componentIds.length > 0) {
            // Check if window.circuit is ready? 
            // fromJSON is usually called DURING circuit load, so getting components might fail if they are not yet added?
            // Circuit.load uses a 2-pass approach or adds all first.
            // But we can't rebuild here if valid refs don't exist yet.
            // So we mark it as "needs rebuild" or rely on lazy load for the VERY FIRST time?
            // Actually, strategy said "Create Integrated Component" triggers rebuild.
            // Loading from file is different. Let's start with null and let lazy mechanism or circuit post-load handle it.
        }

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
            wire.id = id; // Preserve ID (Safe since it's an isolated circuit)

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
            idMap.set(id, wire);
        });

        // 3. Attach Input Port (Same logic as before, but using live-cloned Map)
        // 3. Attach Input Port
        const [inIdRaw, inTermRaw] = (this.internalPortConfig.inputTerminal || '').split(':');
        let inTarget = null;
        let inPos = null;
        let inIsWire = false;

        // Determine Input Target & Position
        if (inIdRaw === 'Wire') {
            if (idMap.has(inTermRaw)) {
                inTarget = idMap.get(inTermRaw);
                inPos = {
                    x: (inTarget.startX + inTarget.endX) / 2,
                    y: (inTarget.startY + inTarget.endY) / 2
                };
                inIsWire = true;
            }
        } else if (inIdRaw && idMap.has(inIdRaw)) {
            inTarget = idMap.get(inIdRaw);
            inPos = inTarget.getTerminalPosition(inTermRaw);
        }

        if (inTarget && inPos) {
            const port = new window.Port(inPos.x - 60, inPos.y, 1, 50);
            tempCircuit.addComponent(port);

            const wire = new window.Wire(port.x + 20, port.y, inPos.x, inPos.y);
            wire.startComponent = port.id;
            wire.startTerminal = 'start';

            if (!inIsWire) {
                wire.endComponent = inIdRaw;
                wire.endTerminal = inTermRaw;
            }
            tempCircuit.addWire(wire);
        }

        // 4. Attach Ground
        const [gndIdRaw, gndTermRaw] = (this.internalPortConfig.groundTerminal || '').split(':');
        let gndTarget = null;
        let gndPos = null;
        let gndIsWire = false;

        // Determine Ground Target & Position
        if (gndIdRaw === 'Wire') {
            if (idMap.has(gndTermRaw)) {
                gndTarget = idMap.get(gndTermRaw);
                gndPos = {
                    x: (gndTarget.startX + gndTarget.endX) / 2,
                    y: (gndTarget.startY + gndTarget.endY) / 2
                };
                gndIsWire = true;
            }
        } else if (gndIdRaw && idMap.has(gndIdRaw)) {
            gndTarget = idMap.get(gndIdRaw);
            gndPos = gndTarget.getTerminalPosition(gndTermRaw);
        }

        if (gndTarget && gndPos) {
            const gnd = new window.Ground(gndPos.x + 60, gndPos.y);
            tempCircuit.addComponent(gnd);

            const wire = new window.Wire(gndPos.x, gndPos.y, gnd.x, gnd.y - 20);

            if (!gndIsWire) {
                wire.startComponent = gndIdRaw;
                wire.startTerminal = gndTermRaw;
            }

            wire.endComponent = gnd.id;
            wire.endTerminal = 'start';
            tempCircuit.addWire(wire);
        }

        return tempCircuit;
    }

    /**
     * Rebuild Virtual Circuit (Eager / Refresh)
     */
    rebuildVirtualCircuit() {
        this.virtualCircuit = this.buildInternalSimulationModel();
        // Clear analyzer cache since circuit changed
        this._internalAnalyzer = null;
        console.log(`[Block] Virtual Circuit Rebuilt for ${this.id}`);

        // Notify UI that this VC has been rebuilt
        window.dispatchEvent(new CustomEvent('integrated-component-rebuilt', {
            detail: { id: this.id }
        }));

        return this.virtualCircuit;
    }

    getImpedance(frequency) {
        // Use Cached Virtual Circuit
        if (!this.virtualCircuit) {
            // Fallback: Try to build (if not built yet, e.g. after load)
            this.rebuildVirtualCircuit();
        }

        if (!this.virtualCircuit) return { real: Infinity, imag: 0 };

        // Analyzer also needs caching? 
        // We clear _internalAnalyzer when virtualCircuit is rebuilt.
        if (!this._internalAnalyzer) {
            this._internalAnalyzer = new window.NetworkAnalyzer(this.virtualCircuit);
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
        // If Eager strategy, we Rebuild immediately? 
        // Or just clear and wait for next use?
        // User said "rebuild OR invalidate". 
        // Let's Invalidate (Clear) here, and if UI needs it, it calls getter.
        // But Strategy said "Circuit.notifyChange -> update".
        // Let's just Clear here. Rebuild happens on next getImpedance or View.
        // Wait, if "Create" is eager, "Update" should maybe be eager too?
        // For performance, let's keep invalidation lazy-rebuild-on-demand IF heavy updates happen frequently (like dragging).
        // But user asked for Eager. Let's do Rebuild.

        this.rebuildVirtualCircuit();
    }
}

window.IntegratedComponent = IntegratedComponent;
