/**
 * Circuit Class
 * Manages all components and wires in the circuit
 */
class Circuit {
    constructor() {
        this.components = new Map();
        this.wires = new Map();
        this.nodes = new Map();
        this.selectedItems = new Set();
        this.history = []; // Legacy support (points to circuitHistory)
        this.circuitHistory = [];
        this.paintHistory = [];
        this.circuitHistoryIndex = -1;
        this.paintHistoryIndex = -1;
        this.maxHistory = 50;

        // Event callbacks
        this.onChange = null;
        this.onSelect = null;

        // Group Plots (Sub-circuit simulations)
        this.groupPlots = [];

        // Clipboard
        this.clipboard = null;
    }

    /**
     * Generate Gap-Filled ID
     * Finds the lowest available number for a given prefix (e.g., 'R', 'Wire')
     */
    getGapFilledId(prefix) {
        let maxNum = 0;
        const existingNums = new Set();

        // Check Components
        this.components.forEach(comp => {
            if (comp.id.startsWith(prefix + '_')) {
                const num = parseInt(comp.id.split('_')[1], 10);
                if (!isNaN(num)) existingNums.add(num);
            }
        });

        // Check Wires
        this.wires.forEach(wire => {
            if (wire.id.startsWith(prefix + '_')) {
                const num = parseInt(wire.id.split('_')[1], 10);
                if (!isNaN(num)) existingNums.add(num);
            }
        });

        // Find lowest missing number starting from 1
        let candidate = 1;
        while (existingNums.has(candidate)) {
            candidate++;
        }

        return `${prefix}_${candidate}`;
    }

    /**
     * Copy Selected Items (Multi-support)
     */
    copySelected() {
        if (this.selectedItems.size === 0) return false;

        const items = [];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        let hasCountableItems = false; // To check if we have spatial items (comps/wires)

        this.selectedItems.forEach(id => {
            if (this.components.has(id)) {
                const comp = this.components.get(id);
                items.push({ type: 'component', data: comp.toJSON() });

                // Bounding Box Calculation
                minX = Math.min(minX, comp.x);
                minY = Math.min(minY, comp.y);
                maxX = Math.max(maxX, comp.x);
                maxY = Math.max(maxY, comp.y);
                hasCountableItems = true;
            } else if (this.wires.has(id)) {
                const wire = this.wires.get(id);
                items.push({ type: 'wire', data: wire.toJSON() });

                // Wire bounds
                minX = Math.min(minX, Math.min(wire.startX, wire.endX));
                minY = Math.min(minY, Math.min(wire.startY, wire.endY));
                maxX = Math.max(maxX, Math.max(wire.startX, wire.endX));
                maxY = Math.max(maxY, Math.max(wire.startY, wire.endY));
                hasCountableItems = true;
            }
        });

        if (items.length === 0) return false;

        // Calculate Center
        let centerX = 0, centerY = 0;
        if (hasCountableItems) {
            centerX = Math.round(((minX + maxX) / 2) / 20) * 20;
            centerY = Math.round(((minY + maxY) / 2) / 20) * 20;
        }

        this.clipboard = {
            center: { x: centerX, y: centerY },
            items: items
        };

        console.log(`Copied ${items.length} items to clipboard. Center:`, this.clipboard.center);
        return true;
    }

    /**
     * Get Clipboard Data (for Ghost preview)
     */
    getClipboard() {
        return this.clipboard;
    }

    /**
     * Paste Clipboard at Position (Multi-support)
     * @param {number} x - Target center X
     * @param {number} y - Target center Y
     */
    pasteClipboard(x, y) {
        if (!this.clipboard || !this.clipboard.items || this.clipboard.items.length === 0) return null;

        const { center, items } = this.clipboard;
        // Calculate offset (Target - Source Center), then snap the OFFSET itself
        // This preserves the relative layout of all items
        const rawDx = x - center.x;
        const rawDy = y - center.y;
        const dx = Math.round(rawDx / 20) * 20;
        const dy = Math.round(rawDy / 20) * 20;

        const idMap = new Map(); // Old ID -> New ID
        const newComponents = [];
        const newWires = [];

        // Pass 1: Create Components & Generate IDs
        items.forEach(item => {
            if (item.type === 'component') {
                const data = item.data;
                const oldId = data.id;

                const typePrefix = data.type || (oldId.includes('_') ? oldId.split('_')[0] : 'Comp');
                const newId = this.getGapFilledId(typePrefix);

                idMap.set(oldId, newId);

                // Clone Data
                const newData = JSON.parse(JSON.stringify(data));
                newData.id = newId;

                // Apply Offset (already snapped)
                newData.x = newData.x + dx;
                newData.y = newData.y + dy;

                const CompClass = this.getComponentClass(newData.type);
                if (CompClass) {
                    const newComp = CompClass.fromJSON(newData);
                    // Add via internal map to reserve ID for next iteration check
                    this.components.set(newId, newComp);
                    newComponents.push(newComp);
                }
            }
        });

        // Pass 2: Create Wires and Link Connections
        items.forEach(item => {
            if (item.type === 'wire') {
                const data = item.data;
                const oldId = data.id;

                const newId = this.getGapFilledId('wire');

                idMap.set(oldId, newId);

                const newData = JSON.parse(JSON.stringify(data));
                newData.id = newId;

                // Apply Offset (already snapped)
                newData.startX = newData.startX + dx;
                newData.startY = newData.startY + dy;
                newData.endX = newData.endX + dx;
                newData.endY = newData.endY + dy;

                // Update Connections
                if (newData.startComponent && idMap.has(newData.startComponent)) {
                    newData.startComponent = idMap.get(newData.startComponent);
                } else {
                    newData.startComponent = null;
                    newData.startTerminal = null;
                }

                if (newData.endComponent && idMap.has(newData.endComponent)) {
                    newData.endComponent = idMap.get(newData.endComponent);
                } else {
                    newData.endComponent = null;
                    newData.endTerminal = null;
                }

                const newWire = window.Wire.fromJSON(newData);
                this.wires.set(newId, newWire); // Reserve ID
                newWires.push(newWire);
            }
        });

        // Pass 3: Finalize (Add to History, Select, Notify)
        newComponents.forEach(c => {
            // Already in map, just save history
            this.saveHistory('add', { component: c.toJSON() });
        });
        newWires.forEach(w => {
            this.saveHistory('addWire', { wire: w.toJSON() });
            this.autoConnectWire(w); // Ensure connections are registered in components
        });

        // Select new items
        const newIds = [...newComponents.map(c => c.id), ...newWires.map(w => w.id)];
        this.select(newIds);

        this.notifyChange();
        return newIds;
    }



    /*
    const data = this.clipboard.data;
    const CompClass = this.getComponentClass(data.type);
    if (!CompClass) return null;

    // Generate New ID
    const typePrefix = data.type; // e.g. 'R', 'C'
    const newId = this.getGapFilledId(typePrefix);

    // Create new instance
    // We use fromJSON but override ID and Position
    const newData = JSON.parse(JSON.stringify(data));
    newData.id = newId;
    newData.x = x;
    newData.y = y;

    const newComp = CompClass.fromJSON(newData);
    this.addComponent(newComp);
    this.select(newId);
    return newComp;
}
else if (this.clipboard.type === 'wire') {
    const data = this.clipboard.data;

    // Generate New ID
    const newId = this.getGapFilledId('wire');

    // Calculate offset logic if needed? 
    // For wires, 'x,y' paste usually means centering the wire around mouse?
    // Or just placing start point at mouse?
    // Let's shift the wire so its center is at x,y
    const centerX = (data.startX + data.endX) / 2;
    const centerY = (data.startY + data.endY) / 2;
    const dx = x - centerX;
    const dy = y - centerY;

    const newData = JSON.parse(JSON.stringify(data));
    newData.id = newId;
    newData.startX += dx;
    newData.startY += dy;
    newData.endX += dx;
    newData.endY += dy;

    // Reset connections - pasted wire is disconnected initially
    newData.startComponent = null;
    newData.startTerminal = null;
    newData.endComponent = null;
    newData.endTerminal = null;

    const newWire = window.Wire.fromJSON(newData); // Global Wire class
    this.addWire(newWire);

    // Try auto-connect?
    */



    /**
     * Add component to circuit
     */
    addComponent(component) {
        this.components.set(component.id, component);
        this.saveHistory('add', { component: component.toJSON() });
        this.notifyChange();
        return component;
    }

    /**
     * Remove component from circuit
     */
    removeComponent(id) {
        const component = this.components.get(id);
        if (!component) return false;

        // Visual Group update: Removal from Group
        this.removeFromGroups(id, 'component');

        // Disconnect connected wires instead of removing them
        const connectedWires = this.getWiresConnectedTo(id);
        connectedWires.forEach(wire => {
            if (wire.startComponent === id) {
                wire.startComponent = null;
                wire.startTerminal = null;
            }
            if (wire.endComponent === id) {
                wire.endComponent = null;
                wire.endTerminal = null;
            }
        });

        // Remove from selection
        this.selectedItems.delete(id);

        this.saveHistory('remove', { component: component.toJSON() });
        this.components.delete(id);

        this.updateSpatialConnections(); // Update visuals immediately
        this.notifyChange();
        return true;
    }

    /**
     * Helper to remove item references from IntegratedComponents
     */
    removeFromGroups(id, type) {
        this.components.forEach(comp => {
            if (comp.type === 'INTEGRATED') {
                let changed = false;
                if (type === 'component') {
                    const idx = comp.componentIds.indexOf(id);
                    if (idx !== -1) {
                        comp.componentIds.splice(idx, 1);
                        changed = true;
                    }
                } else if (type === 'wire') {
                    const idx = comp.wireIds.indexOf(id);
                    if (idx !== -1) {
                        comp.wireIds.splice(idx, 1);
                        changed = true;
                    }
                }

                if (changed) {
                    comp.updateDimensions();
                    // If empty, remove group? Optional.
                }
            }
        });
    }

    /**
     * Internal rename helper (no history)
     */
    _silentRename(oldId, newId) {
        const component = this.components.get(oldId);
        if (!component) return;

        component.id = newId;
        this.components.delete(oldId);
        this.components.set(newId, component);

        // Update DOM element ID
        if (component.element) {
            component.element.setAttribute('data-id', newId);
            component.render(); // Update label
        }

        this.getAllWires().forEach(wire => {
            if (wire.startComponent === oldId) wire.startComponent = newId;
            if (wire.endComponent === oldId) wire.endComponent = newId;
        });

        if (this.selectedItems.has(oldId)) {
            this.selectedItems.delete(oldId);
            this.selectedItems.add(newId);
        }
    }

    /**
     * Rename component
     * returns true if successful, false if ID exists or invalid
     */
    renameComponent(oldId, newId) {
        if (!newId || newId === oldId) return false;
        if (this.components.has(newId)) return false; // ID already exists

        const component = this.components.get(oldId);
        if (!component) return false;

        // 1. Update component internal ID
        component.id = newId;

        // 2. Update Map (Delete old, Set new)
        this.components.delete(oldId);
        this.components.set(newId, component);

        // 3. Update DOM element ID explicitly
        if (component.element) {
            component.element.setAttribute('data-id', newId);
            component.render(); // Update label
        }

        // 4. Update Wires referencing this component
        // Wait, getWiresConnectedTo checks startComponent/endComponent which are STRINGS.
        // So we need to update wires MANUALLY since they still hold the old string ID.

        this.getAllWires().forEach(wire => {
            let changed = false;
            if (wire.startComponent === oldId) {
                wire.startComponent = newId;
                changed = true;
            }
            if (wire.endComponent === oldId) {
                wire.endComponent = newId;
                changed = true;
            }
            // If wire was referencing old connections map in component, that's already memory-linked to component object?
            // Component.connections stores WIRE IDs, so component -> wire link is fine.
            // Wire -> component link is via ID string, so we just updated it.
        });

        // 4. Update Selection Set
        if (this.selectedItems.has(oldId)) {
            this.selectedItems.delete(oldId);
            this.selectedItems.add(newId);
        }

        // 5. Save History
        this.saveHistory('rename', {
            oldId: oldId,
            newId: newId
        });

        // 6. Notify
        this.notifyChange();
        return true;
    }

    /**
     * Get component by ID
     */
    getComponent(id) {
        return this.components.get(id);
    }

    /**
     * Get all components
     */
    getAllComponents() {
        return Array.from(this.components.values());
    }

    /**
     * Add wire to circuit
     */
    addWire(wire) {
        this.wires.set(wire.id, wire);
        this.saveHistory('addWire', { wire: wire.toJSON() });
        this.notifyChange();
        return wire;
    }

    /**
     * Remove wire from circuit
     */
    removeWire(id) {
        const wire = this.wires.get(id);
        if (!wire) return false;

        // Disconnect from components
        if (wire.startComponent) {
            const comp = this.components.get(wire.startComponent);
            if (comp && comp.connections[wire.startTerminal] === id) {
                const otherWire = this.findOtherWireConnectedTo(wire.startComponent, wire.startTerminal, id);
                comp.connections[wire.startTerminal] = otherWire ? otherWire.id : null;
            }
        }
        if (wire.endComponent) {
            const comp = this.components.get(wire.endComponent);
            if (comp && comp.connections[wire.endTerminal] === id) {
                const otherWire = this.findOtherWireConnectedTo(wire.endComponent, wire.endTerminal, id);
                comp.connections[wire.endTerminal] = otherWire ? otherWire.id : null;
            }
        }

        this.selectedItems.delete(id);
        this.removeFromGroups(id, 'wire');
        this.saveHistory('removeWire', { wire: wire.toJSON() });
        this.wires.delete(id);
        this.notifyChange();
        return true;
    }

    /**
     * Get wire by ID
     */
    getWire(id) {
        return this.wires.get(id);
    }

    /**
     * Get all wires
     */
    getAllWires() {
        return Array.from(this.wires.values());
    }

    /**
     * Get wires connected to a component
     */
    getWiresConnectedTo(componentId) {
        return this.getAllWires().filter(wire =>
            wire.startComponent === componentId || wire.endComponent === componentId
        );
    }

    /**
     * Select item(s)
     */
    select(ids, addToSelection = false) {
        if (!addToSelection) {
            this.clearSelection();
        }

        const idArray = Array.isArray(ids) ? ids : [ids];
        const finalIds = new Set(idArray);

        // Find Groups related to selection (Bidirectional)
        this.components.forEach(comp => {
            if (comp.type === 'INTEGRATED') {
                // Check if this Group is being selected
                if (idArray.includes(comp.id)) {
                    // Select all children
                    comp.componentIds.forEach(cid => finalIds.add(cid));
                    comp.wireIds.forEach(wid => finalIds.add(wid));
                }

                // Child -> Group expansion REMOVED to allow atomic child selection
                // Logic moved to DragDropHandler for smart selection.
            }
        });

        finalIds.forEach(id => {
            this.selectedItems.add(id);

            const component = this.components.get(id);
            if (component) {
                component.setSelected(true);
            }

            const wire = this.wires.get(id);
            if (wire) {
                wire.setSelected(true);
            }
        });

        this.notifySelect();
    }

    /**
     * Clear selection
     */
    clearSelection() {
        this.selectedItems.forEach(id => {
            const component = this.components.get(id);
            if (component) {
                component.setSelected(false);
            }

            const wire = this.wires.get(id);
            if (wire) {
                wire.setSelected(false);
            }
        });
        this.selectedItems.clear();
        this.notifySelect();
    }

    /**
     * Get selected items
     */
    getSelectedItems() {
        return Array.from(this.selectedItems);
    }

    /**
     * Get selected components
     */
    getSelectedComponents() {
        return this.getSelectedItems()
            .map(id => this.components.get(id))
            .filter(c => c !== undefined);
    }

    /**
     * Get selected wires
     */
    getSelectedWires() {
        return this.getSelectedItems()
            .map(id => this.wires.get(id))
            .filter(w => w !== undefined);
    }

    /**
     * Create Integrated Component from selection
     */
    /**
     * Create Integrated Component from selection (Grouping)
     */
    createIntegratedComponent(components, wires, config = null) {
        console.log('[Circuit] createIntegratedComponent called (Group)', { components, wires, config });

        if (!components || components.length === 0) return false;

        // 1. Calculate Center Position (for layout purposes)
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        components.forEach(c => {
            minX = Math.min(minX, c.x);
            minY = Math.min(minY, c.y);
            maxX = Math.max(maxX, c.x);
            maxY = Math.max(maxY, c.y);
        });
        const centerX = Math.round((minX + maxX) / 2 / 20) * 20;
        const centerY = Math.round((minY + maxY) / 2 / 20) * 20;

        // 2. Create Integrated Component
        const integratedComp = new window.IntegratedComponent(centerX, centerY);
        const compIds = components.map(c => c.id);
        const wireIds = wires.map(w => w.id);

        integratedComp.setInternalCircuit(compIds, wireIds, config || {});

        // 3. Add New Component (Reference-based, so NO removal of originals)
        this.addComponent(integratedComp);

        // 4. Select New Group (Atomic selection will handle children)
        this.select(integratedComp.id);

        this.notifyChange();
        return integratedComp;
    }

    /**
     * Ungroup Integrated Component
     * Dissolves the group and selects the original components
     */
    ungroupIntegratedComponent(id) {
        const comp = this.components.get(id);
        if (!comp || comp.type !== 'INTEGRATED') return;

        const childIds = [...comp.componentIds, ...comp.wireIds];

        // Only remove the Group Wrapper. 
        // Logic in removeComponent(id) calls removeFromGroups which is circular if we call it on itself?
        // Actually removeComponent just removes it from this.components.
        // It's safe.
        this.removeComponent(id);

        // Restore selection of children
        // Need to wait for render update? No, logical selection is fine.
        this.select(childIds);
        this.notifyChange();
    }

    /**
     * Group Plot Management
     */
    addGroupPlot(config) {
        // Generate ID if missing
        if (!config.id) {
            config.id = `group_plot_${Date.now()}`;
        }

        // Check if updating existing
        const existingIdx = this.groupPlots.findIndex(p => p.id === config.id);
        if (existingIdx >= 0) {
            this.groupPlots[existingIdx] = config;
        } else {
            this.groupPlots.push(config);
        }
        this.notifyChange(); // Verify if this trigger is enough or if we need explicit graph update
        return config;
    }

    removeGroupPlot(id) {
        this.groupPlots = this.groupPlots.filter(p => p.id !== id);
        this.notifyChange();
    }

    getGroupPlots() {
        return this.groupPlots;
    }

    /**
     * Delete selected items
     */
    deleteSelected() {
        const selected = this.getSelectedItems();
        selected.forEach(id => {
            if (this.components.has(id)) {
                this.removeComponent(id);
            } else if (this.wires.has(id)) {
                this.removeWire(id);
            }
        });
    }

    /**
     * Find component at position
     */
    findComponentAt(x, y) {
        for (const component of this.components.values()) {
            if (component.containsPoint(x, y)) {
                return component;
            }
        }
        return null;
    }

    /**
     * Find terminal near position
     */
    findTerminalNear(x, y, maxDistance = 15) {
        let nearest = null;
        let minDist = maxDistance;

        for (const component of this.components.values()) {
            const terminal = component.getNearestTerminal(x, y, maxDistance);
            if (terminal && terminal.distance < minDist) {
                minDist = terminal.distance;
                nearest = {
                    componentId: component.id,
                    terminal: terminal.terminal,
                    x: terminal.x,
                    y: terminal.y
                };
            }
        }

        return nearest;
    }

    /**
     * Find wire at position
     */
    findWireAt(x, y, tolerance = 5) {
        for (const wire of this.wires.values()) {
            if (wire.containsPoint(x, y, tolerance)) {
                return wire;
            }
        }
        return null;
    }

    /**
     * Save state to history
     * @param {string} action 
     * @param {object} data 
     * @param {boolean} isPaintEvent - If true, saves to paint history stack
     */
    saveHistory(action, data, isPaintEvent = false) {
        const targetHistory = isPaintEvent ? this.paintHistory : this.circuitHistory;
        let targetIndex = isPaintEvent ? this.paintHistoryIndex : this.circuitHistoryIndex;

        // Remove future states if we're not at the end
        if (targetIndex < targetHistory.length - 1) {
            targetHistory.splice(targetIndex + 1);
        }

        targetHistory.push({ action, data, timestamp: Date.now() });

        // Limit history size
        if (targetHistory.length > this.maxHistory) {
            targetHistory.shift();
        } else {
            targetIndex++;
        }

        // Update index
        if (isPaintEvent) {
            this.paintHistoryIndex = targetIndex;
            // Sync legacy pointer just in case, though we rely on split stacks now
            this.paintHistory = targetHistory;
        } else {
            this.circuitHistoryIndex = targetIndex;
            this.circuitHistory = targetHistory;
        }

        console.log(`History Saved (${isPaintEvent ? 'Paint' : 'Circuit'}):`, action, targetIndex);
    }

    /**
     * Undo last action
     */
    undo() {
        // Determine which stack to use based on Paint Mode
        const isPaintMode = window.drawingManager && window.drawingManager.isPaintMode;
        let index = isPaintMode ? this.paintHistoryIndex : this.circuitHistoryIndex;
        const stack = isPaintMode ? this.paintHistory : this.circuitHistory;

        if (index < 0) return false;

        const state = stack[index];
        index--;

        if (isPaintMode) {
            this.paintHistoryIndex = index;
        } else {
            this.circuitHistoryIndex = index;
        }

        // Reverse the action
        switch (state.action) {
            // Circuit Actions
            case 'add':
                this.components.delete(state.data.component.id);
                this.notifyChange();
                break;
            case 'remove':
                const CompClass = this.getComponentClass(state.data.component.type);
                if (CompClass) {
                    const comp = CompClass.fromJSON(state.data.component);
                    this.components.set(comp.id, comp);
                }
                this.notifyChange();
                break;
            case 'addWire':
                const wireToRemove = this.wires.get(state.data.wire.id);
                if (wireToRemove) {
                    this.disconnectWireFromComponents(wireToRemove);
                    this.wires.delete(wireToRemove.id);
                }
                this.notifyChange();
                break;
            case 'removeWire':
                const wire = Wire.fromJSON(state.data.wire);
                this.wires.set(wire.id, wire);
                this.restoreWireConnections(wire);
                this.notifyChange();
                break;
            case 'move':
                state.data.items.forEach(item => {
                    const el = item.type === 'component' ? this.components.get(item.id) : this.wires.get(item.id);
                    if (el) {
                        // Undo: Move BACK by negating dx, dy
                        el.moveBy(-item.dx, -item.dy);
                        if (item.type === 'wire') {
                            this.checkWireDisconnection(el);
                            this.autoConnectWire(el);
                        }
                    }
                });
                this.updateSpatialConnections();
                this.notifyChange();
                break;
            case 'wire_edit':
                const targetWireUndo = this.wires.get(state.data.id);
                if (targetWireUndo) {
                    this.disconnectWireFromComponents(targetWireUndo);
                    const prev = state.data.previous;
                    targetWireUndo.startX = prev.startX;
                    targetWireUndo.startY = prev.startY;
                    targetWireUndo.endX = prev.endX;
                    targetWireUndo.endY = prev.endY;
                    targetWireUndo.startComponent = prev.startComponent;
                    targetWireUndo.startTerminal = prev.startTerminal;
                    targetWireUndo.endComponent = prev.endComponent;
                    targetWireUndo.endTerminal = prev.endTerminal;

                    this.restoreWireConnections(targetWireUndo);
                    targetWireUndo.render();
                }
                this.notifyChange();
                break;
            case 'property_change':
                const compUndo = this.components.get(state.data.id);
                if (compUndo) {
                    Object.assign(compUndo, state.data.previous);
                    if (compUndo.updateLabel) compUndo.updateLabel();
                }
                this.notifyChange();
                break;
            case 'rename':
                this._silentRename(state.data.newId, state.data.oldId);
                this.notifyChange();
                break;

            // Paint Actions
            case 'paint_circuit_add':
                if (window.drawingManager) window.drawingManager.removeCircuitShape(state.data.id);
                break;
            case 'paint_circuit_remove':
                // Undo remove -> Add back
                if (window.drawingManager) window.drawingManager.addCircuitShape(state.data);
                break;
            case 'paint_circuit_move':
                if (window.drawingManager) window.drawingManager.moveShape(state.data.id, -state.data.dx, -state.data.dy);
                break;
            case 'paint_graph_add':
                if (window.drawingManager) window.drawingManager.removeGraphShape(state.data.id);
                break;
            case 'paint_clear':
                if (window.drawingManager) window.drawingManager.restoreSnapshot(state.data.snapshot);
                break;
        }

        return true;
    }

    /**
     * Redo undone action
     */
    redo() {
        // Determine which stack to use based on Paint Mode
        const isPaintMode = window.drawingManager && window.drawingManager.isPaintMode;
        let index = isPaintMode ? this.paintHistoryIndex : this.circuitHistoryIndex;
        const stack = isPaintMode ? this.paintHistory : this.circuitHistory;

        if (index >= stack.length - 1) return false;

        index++;
        if (isPaintMode) {
            this.paintHistoryIndex = index;
        } else {
            this.circuitHistoryIndex = index;
        }

        const state = stack[index];

        // Re-apply the action
        switch (state.action) {
            // Circuit Actions
            case 'add':
                const CompClass = this.getComponentClass(state.data.component.type);
                if (CompClass) {
                    const comp = CompClass.fromJSON(state.data.component);
                    this.components.set(comp.id, comp);
                }
                this.notifyChange();
                break;
            case 'remove':
                this.components.delete(state.data.component.id);
                this.notifyChange();
                break;
            case 'property_change':
                const compRedo = this.components.get(state.data.id);
                if (compRedo) {
                    Object.assign(compRedo, state.data.current);
                    if (compRedo.updateLabel) compRedo.updateLabel();
                }
                this.notifyChange();
                break;
            case 'rename':
                this._silentRename(state.data.oldId, state.data.newId);
                this.notifyChange();
                break;
            case 'addWire':
                const wire = Wire.fromJSON(state.data.wire);
                this.wires.set(wire.id, wire);
                this.restoreWireConnections(wire);
                this.notifyChange();
                break;
            case 'removeWire':
                const wireRedoRemove = this.wires.get(state.data.wire.id);
                if (wireRedoRemove) {
                    this.disconnectWireFromComponents(wireRedoRemove);
                    this.wires.delete(wireRedoRemove.id);
                }
                this.notifyChange();
                break;
            case 'move':
                state.data.items.forEach(item => {
                    const el = item.type === 'component' ? this.components.get(item.id) : this.wires.get(item.id);
                    if (el) {
                        el.moveBy(item.dx, item.dy);
                        if (item.type === 'wire') {
                            this.checkWireDisconnection(el);
                            this.autoConnectWire(el);
                        }
                    }
                });
                this.updateSpatialConnections();
                this.notifyChange();
                break;
            case 'wire_edit':
                const targetWireRedo = this.wires.get(state.data.id);
                if (targetWireRedo) {
                    this.disconnectWireFromComponents(targetWireRedo);
                    const curr = state.data.current;
                    targetWireRedo.startX = curr.startX;
                    targetWireRedo.startY = curr.startY;
                    targetWireRedo.endX = curr.endX;
                    targetWireRedo.endY = curr.endY;
                    targetWireRedo.startComponent = curr.startComponent;
                    targetWireRedo.startTerminal = curr.startTerminal;
                    targetWireRedo.endComponent = curr.endComponent;
                    targetWireRedo.endTerminal = curr.endTerminal;

                    this.restoreWireConnections(targetWireRedo);
                    targetWireRedo.render();
                }
                this.notifyChange();
                break;

            // Paint Actions
            case 'paint_circuit_add':
                if (window.drawingManager) window.drawingManager.addCircuitShape(state.data);
                break;
            case 'paint_circuit_remove':
                // Redo remove -> Remove again
                if (window.drawingManager) window.drawingManager.removeCircuitShape(state.data.id);
                break;
            case 'paint_circuit_move':
                if (window.drawingManager) window.drawingManager.moveShape(state.data.id, state.data.dx, state.data.dy);
                break;
            case 'paint_graph_add':
                if (window.drawingManager) window.drawingManager.addGraphShape(state.data);
                break;
            case 'paint_clear':
                if (window.drawingManager) window.drawingManager.clearAll(false); // false = don't save history again
                break;
        }

        return true;
    }

    /**
     * Get component class by type
     */
    getComponentClass(type) {
        const classes = {
            'R': window.Resistor,
            'L': window.Inductor,
            'C': window.Capacitor,
            'GND': window.Ground,
            'TL': window.TransmissionLine,
            'PORT': window.Port,
            'INTEGRATED': window.IntegratedComponent
        };
        return classes[type];
    }

    /**
     * Notify listeners of change
     */
    notifyChange() {
        if (this.onChange) {
            this.onChange();
        }
        // Dispatch global event for other controllers
        window.dispatchEvent(new CustomEvent('circuit-modified'));
    }

    /**
     * Notify selection callback
     */
    notifySelect() {
        if (this.onSelect) {
            this.onSelect(this.getSelectedItems());
        }
    }

    /**
     * Clear circuit
     */
    clear() {
        this.components.clear();
        this.wires.clear();
        this.nodes.clear();
        this.selectedItems.clear();
        this.history = [];
        this.historyIndex = -1;
        Component.idCounter = 0;
        this.notifyChange();
    }



    /**
     * Export circuit to JSON
     */
    toJSON() {
        return {
            version: '1.0',
            components: this.getAllComponents().map(c => c.toJSON()),
            wires: this.getAllWires().map(w => w.toJSON())
        };
    }

    /**
     * Import circuit from JSON
     */
    fromJSON(data) {
        console.log('[Circuit] fromJSON called. Data:', {
            componentsCount: data.components ? data.components.length : 0,
            wiresCount: data.wires ? data.wires.length : 0,
            hasPaint: !!data.paint, // Log paint existence specifically
            paintData: data.paint   // Log actual paint data object
        });

        console.log('[Circuit] Checking DrawingManager:', !!window.drawingManager); // Check if manager exists

        this.clear();

        if (data.components) {
            data.components.forEach(compData => {
                const CompClass = this.getComponentClass(compData.type);
                if (CompClass) {
                    const component = CompClass.fromJSON(compData);
                    this.components.set(component.id, component);

                    // Update ID counter
                    const idNum = parseInt(component.id.split('_')[1]);
                    if (idNum > Component.idCounter) {
                        Component.idCounter = idNum;
                    }
                } else {
                    console.warn('[Circuit] fromJSON: Unknown component type:', compData.type);
                }
            });
        }

        if (data.wires) {
            data.wires.forEach(wireData => {
                const wire = Wire.fromJSON(wireData);
                this.wires.set(wire.id, wire);
            });
        }

        // Restore Paint Data (if available)
        if (data.paint && window.drawingManager) {
            window.drawingManager.clearAll(false); // Clear existing drawings first (no history)
            window.drawingManager.loadPaintData(data.paint);
        }

        this.updateSpatialConnections(); // Update visuals
        this.notifyChange();
    }

    /**
     * Find another wire connected to the same component terminal
     */
    findOtherWireConnectedTo(componentId, terminal, excludeWireId) {
        for (const wire of this.wires.values()) {
            if (wire.id === excludeWireId) continue;

            if ((wire.startComponent === componentId && wire.startTerminal === terminal) ||
                (wire.endComponent === componentId && wire.endTerminal === terminal)) {
                return wire;
            }
        }
        return null;
    }

    /**
     * Update spatial connections for visual feedback
     * Checks if component terminals are overlapping and updates directConnections state
     */
    updateSpatialConnections() {
        const components = this.getAllComponents();
        const tolerance = 5;

        // Reset all direct connections first
        components.forEach(comp => {
            if (!comp.directConnections) comp.directConnections = {};
            Object.keys(comp.terminals).forEach(key => {
                comp.directConnections[key] = false;
            });
        });

        // Check for overlaps (O(N^2))
        for (let i = 0; i < components.length; i++) {
            for (let j = i + 1; j < components.length; j++) {
                const c1 = components[i];
                const c2 = components[j];

                for (const t1 of Object.keys(c1.terminals)) {
                    const p1 = c1.getTerminalPosition(t1);

                    for (const t2 of Object.keys(c2.terminals)) {
                        const p2 = c2.getTerminalPosition(t2);

                        const distSq = (p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2;
                        if (distSq < tolerance * tolerance) {
                            c1.directConnections[t1] = true;
                            c2.directConnections[t2] = true;
                        }
                    }
                }
            }
        }
    }

    /**
     * Get circuit statistics
     */
    getStats() {
        const components = this.getAllComponents();
        return {
            totalComponents: components.length,
            totalWires: this.wires.size,
            resistors: components.filter(c => c.type === 'R').length,
            inductors: components.filter(c => c.type === 'L').length,
            capacitors: components.filter(c => c.type === 'C').length,
            grounds: components.filter(c => c.type === 'GND').length,
            transmissionLines: components.filter(c => c.type === 'TL').length,
            ports: components.filter(c => c.type === 'PORT').length
        };
    }
    /**
     * Helper to restore wire connections to components
     */
    restoreWireConnections(wire) {
        // Clear old connections first? No, we trust the state object to have correct IDs
        // But we need to make sure the components know about this wire.

        if (wire.startComponent) {
            const comp = this.components.get(wire.startComponent);
            if (comp) comp.connections[wire.startTerminal] = wire.id;
        }
        if (wire.endComponent) {
            const comp = this.components.get(wire.endComponent);
            if (comp) comp.connections[wire.endTerminal] = wire.id;
        }
    }

    /**
     * Helper to disconnect wire from components
     */
    disconnectWireFromComponents(wire) {
        if (wire.startComponent) {
            const comp = this.components.get(wire.startComponent);
            if (comp && comp.connections[wire.startTerminal] === wire.id) {
                // Check if there is another valid wire? 
                const otherWire = this.findOtherWireConnectedTo(wire.startComponent, wire.startTerminal, wire.id);
                comp.connections[wire.startTerminal] = otherWire ? otherWire.id : null;
            }
        }
        if (wire.endComponent) {
            const comp = this.components.get(wire.endComponent);
            if (comp && comp.connections[wire.endTerminal] === wire.id) {
                const otherWire = this.findOtherWireConnectedTo(wire.endComponent, wire.endTerminal, wire.id);
                comp.connections[wire.endTerminal] = otherWire ? otherWire.id : null;
            }
        }
    }

    /**
     * Check if wire should be disconnected from components
     */
    checkWireDisconnection(wire) {
        const threshold = 10;

        // Check start connection
        if (wire.startComponent) {
            const comp = this.components.get(wire.startComponent);
            if (comp) {
                const terminalPos = comp.getTerminalPosition(wire.startTerminal);
                const dist = Math.sqrt(
                    (wire.startX - terminalPos.x) ** 2 +
                    (wire.startY - terminalPos.y) ** 2
                );

                if (dist > threshold) {
                    if (comp.connections[wire.startTerminal] === wire.id) {
                        comp.connections[wire.startTerminal] = null;
                    }
                    wire.startComponent = null;
                    wire.startTerminal = null;
                }
            }
        }

        // Check end connection
        if (wire.endComponent) {
            const comp = this.components.get(wire.endComponent);
            if (comp) {
                const terminalPos = comp.getTerminalPosition(wire.endTerminal);
                const dist = Math.sqrt(
                    (wire.endX - terminalPos.x) ** 2 +
                    (wire.endY - terminalPos.y) ** 2
                );

                if (dist > threshold) {
                    if (comp.connections[wire.endTerminal] === wire.id) {
                        comp.connections[wire.endTerminal] = null;
                    }
                    wire.endComponent = null;
                    wire.endTerminal = null;
                }
            }
        }
    }

    /**
     * Auto-connect wire terminals to nearby components
     */
    autoConnectWire(wire) {
        const tolerance = 10;

        // Start Endpoint
        if (!wire.startComponent) {
            const startTerm = this.findTerminalNear(wire.startX, wire.startY, tolerance);
            if (startTerm) {
                wire.startComponent = startTerm.componentId;
                wire.startTerminal = startTerm.terminal;
                wire.startX = startTerm.x;
                wire.startY = startTerm.y;

                const comp = this.components.get(startTerm.componentId);
                if (comp) {
                    comp.connections[startTerm.terminal] = wire.id;
                }
            }
        }

        // End Endpoint
        if (!wire.endComponent) {
            const endTerm = this.findTerminalNear(wire.endX, wire.endY, tolerance);
            if (endTerm) {
                wire.endComponent = endTerm.componentId;
                wire.endTerminal = endTerm.terminal;
                wire.endX = endTerm.x;
                wire.endY = endTerm.y;

                const comp = this.components.get(endTerm.componentId);
                if (comp) {
                    comp.connections[endTerm.terminal] = wire.id;
                }
            }
        }

        wire.render();
    }



    // Helper: Get neighboring components
    getNeighbors(compId) {
        const neighbors = new Set();
        const wires = this.getWiresConnectedTo(compId);
        wires.forEach(w => {
            if (w.startComponent === compId && w.endComponent) neighbors.add(w.endComponent);
            else if (w.endComponent === compId && w.startComponent) neighbors.add(w.startComponent);
        });
        return Array.from(neighbors);
    }




}

// Export for use in other modules
window.Circuit = Circuit;
