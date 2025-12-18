/**
 * Drag and Drop Handler
 * Handles component drag from palette and component movement on canvas
 */
class DragDropHandler {
    constructor(canvasManager, circuit) {
        this.canvasManager = canvasManager;
        this.circuit = circuit;
        this.svg = canvasManager.svg;

        // Drag state
        this.isDragging = false;
        this.dragType = null; // 'new' or 'move'
        this.dragItem = null;
        this.dragItemType = null; // 'component' or 'wire'
        this.dragOffset = { x: 0, y: 0 };
        this.lastDragPoint = { x: 0, y: 0 }; // For wire dragging
        this.ghostElement = null;

        // Potential drag (for delayed drag start to allow double-click)
        this.potentialDrag = null;
        this.dragThreshold = 5; // pixels to move before drag starts

        // Selection state
        this.isSelecting = false;
        this.selectionStart = { x: 0, y: 0 };
        this.selectionBox = null;

        // Current mode
        this.mode = null; // 'select', 'wire', 'delete', or null

        // Initialize
        this.init();

        // Shortcut state
        this.waitingForComponent = false;

        // Delayed selection clearing for multi-select drag
        this.clickedSelectedItemId = null;
        this.clickedSelectedItemType = null;

        // History Snapshot
        this.dragStartSnapshot = null;
    }

    /**
     * Create fresh component instance (Factory)
     */
    instantiateComponent(type, x, y) {
        let component;
        switch (type) {
            case 'R': component = new Resistor(x, y); break;
            case 'L': component = new Inductor(x, y); break;
            case 'C': component = new Capacitor(x, y); break;
            case 'GND': component = new Ground(x, y); break;
            case 'TL': component = new TransmissionLine(x, y); break;
            case 'PORT':
                const portCount = this.circuit.getAllComponents().filter(c => c.type === 'PORT').length;
                component = new Port(x, y, portCount + 1);
                break;
            default:
                console.warn('Unknown component type:', type);
                return null;
        }
        return component;
    }

    /**
     * Create ghost component
     */
    createGhost(type) {
        this.removeGhost();

        // Create off-screen initially
        const component = this.instantiateComponent(type, -1000, -1000);
        if (!component) return;

        this.ghostComponent = component;
        const element = component.render();
        element.classList.add('ghost-component');
        this.canvasManager.addOverlay(element);
    }

    /**
     * Remove ghost component
     */
    removeGhost() {
        if (this.ghostComponent) {
            if (this.ghostComponent.element) {
                this.ghostComponent.element.remove();
            }
            this.ghostComponent = null;
        }
    }

    /**
     * Update ghost position
     */
    updateGhostPosition(x, y) {
        if (this.ghostComponent) {
            const snappedX = this.canvasManager.snapToGrid(x);
            const snappedY = this.canvasManager.snapToGrid(y);
            this.ghostComponent.moveTo(snappedX, snappedY);
        }
    }

    /**
     * Initialize event listeners
     */
    init() {
        this.bindPaletteEvents();
        this.bindCanvasEvents();
        this.bindKeyboardEvents();
    }

    /**
     * Bind palette drag events
     */
    bindPaletteEvents() {
        const palette = document.getElementById('componentPalette');
        if (!palette) return;

        // Use Mousedown for Custom Drag (Ghost Visual + Rotation Support)
        palette.addEventListener('mousedown', (e) => {
            const item = e.target.closest('.component-item');
            if (!item) return;

            // Left click only
            if (e.button !== 0) return;

            e.preventDefault(); // Prevent text selection and native DnD

            const type = item.dataset.type;
            if (!type) return;

            // Start Custom Drag
            this.isDragging = true;
            this.dragType = 'new';

            // Disable Drawing Tool if active
            if (window.drawingManager && window.drawingManager.activeTool) {
                window.drawingManager.setTool(null);
            }

            // Create Ghost immediately
            // Convert client coordinates to SVG for initial position
            const point = this.canvasManager.clientToSvg(e.clientX, e.clientY);
            this.createGhost(type);
            this.updateGhostPosition(point.x, point.y);

            // Set current drag-new type
            this.dragNewType = type;
        });

        // Click-to-Place (if user just clicks and releases quickly) logic might overlap.
        // If we want to support both "Drag from Palette" AND "Click to Select Tool",
        // we might need to distinguish click vs drag.
        // However, standard UI usually is:
        // - Click: Select Tool (Ghost follows mouse, next click places)
        // - Drag: Ghost follows mouse, release places.

        // Let's rely on MouseUp for the "Click" case if movement was small?
        // Or simply: Mousedown starts "New" drag.
        // If MouseUp happens effectively at the same place (or inside palette?), we could treat it as "Select Tool" mode?
        // Actually, if we drag `new`, we are showing the ghost.
        // If we release mouse *over the canvas*, we place it.
        // If we release mouse *over the palette* (didn't move much), maybe we act as "Selected Tool".

        // For now, let's implement the Drag flow. 
        // The previous 'click' listener handled the "Select Tool" mode.
        // We should keep the click listener for "Select Tool" behavior if the user *clicks* instead of drags?
        // But mousedown + preventDefault might block 'click'.
        // So we handle the "Click behavior" in window.mouseup if we haven't placed it yet?

        // Actually, simpler approach:
        // Always start 'new' drag.
        // If mouseup happens and we are still over palette/not on canvas, maybe just set mode?
    }

    /**
     * Bind canvas events
     */
    bindCanvasEvents() {
        // Drop from palette
        this.svg.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';

            // Show snap position
            const point = this.canvasManager.clientToSvg(e.clientX, e.clientY);
            const snappedX = this.canvasManager.snapToGrid(point.x);
            const snappedY = this.canvasManager.snapToGrid(point.y);
            this.canvasManager.showSnapIndicator(snappedX, snappedY);
        });

        this.svg.addEventListener('dragleave', () => {
            this.canvasManager.hideSnapIndicator();
        });

        this.svg.addEventListener('drop', (e) => {
            e.preventDefault();
            this.canvasManager.hideSnapIndicator();

            const type = e.dataTransfer.getData('componentType');
            if (!type) return;

            const point = this.canvasManager.clientToSvg(e.clientX, e.clientY);

            this.createComponent(type, point.x, point.y);

            // If we were in a component mode, dragging cancels it (or maybe keeps it?)
            // Usually dragging implies immediate action. Let's reset mode if it was a component mode.
            if (this.isComponentMode(this.mode)) {
                this.setMode(null);
            }
        });

        // Mouse events for selection and movement
        this.svg.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        window.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        window.addEventListener('mouseup', (e) => this.handleMouseUp(e));

        // Double-click to edit
        this.svg.addEventListener('dblclick', (e) => this.handleDoubleClick(e));
    }

    /**
     * Bind keyboard events
     */
    bindKeyboardEvents() {
        window.addEventListener('keydown', (e) => {
            // Don't handle if typing in input
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

            const key = e.key.toLowerCase();

            // Handle Component Waiting State (Step 2)
            if (this.waitingForComponent) {
                // If Escape, cancel mode
                if (key === 'escape') {
                    this.waitingForComponent = false;
                    const modeDisplay = document.getElementById('currentMode');
                    if (modeDisplay) modeDisplay.textContent = this.mode ? this.mode : 'None';
                    return;
                }

                // Check for Component Keys
                if (window.shortcutHandler) {
                    let type = null;
                    if (window.shortcutHandler.matches(e, 'place_resistor')) type = 'R';
                    else if (window.shortcutHandler.matches(e, 'place_inductor')) type = 'L';
                    else if (window.shortcutHandler.matches(e, 'place_capacitor')) type = 'C';
                    else if (window.shortcutHandler.matches(e, 'place_ground')) type = 'GND';
                    else if (window.shortcutHandler.matches(e, 'place_transmission_line')) type = 'TL';
                    else if (window.shortcutHandler.matches(e, 'place_port')) type = 'PORT';

                    if (type) {
                        this.setMode(type);
                        this.waitingForComponent = false;
                        return;
                    }
                }

                // If any other key is pressed that is valid (like 'w' for wire?), strictly speaking user said "c -> r". 
                // We should probably consume the event or treat it as invalid unless it's a modifier.
                // But for good UX, if they press 's' maybe they meant select?
                // For now, let's keep it strict or just reset if not matched?
                // User requirement: "c를 입력하면 ... c를 입력한 뒤 r를 누르면..."
                // If they press something else, maybe just exit the mode?
                // Let's exit waiting state on unknown key to avoid getting stuck, UNLESS it's just a modifier.
                if (!['shift', 'control', 'alt', 'meta'].includes(key)) {
                    this.waitingForComponent = false;
                    const modeDisplay = document.getElementById('currentMode');
                    if (modeDisplay) modeDisplay.textContent = this.mode ? this.mode : 'None';
                }
                return;
            }

            if (window.shortcutHandler) {
                // Delete
                if (window.shortcutHandler.matches(e, 'delete_selected')) {
                    if (this.mode === 'select' || (!this.mode && this.circuit.hasSelection())) {
                        this.circuit.deleteSelected();
                        this.canvasManager.renderComponents();
                    }
                    return;
                }

                // Rotate
                if (window.shortcutHandler.matches(e, 'rotate_selected')) {
                    e.preventDefault();
                    if (this.ghostComponent) {
                        this.ghostComponent.rotate();
                    } else {
                        this.rotateSelected();
                    }
                    return;
                }

                // Step 1: Enter Component Mode
                if (window.shortcutHandler.matches(e, 'component_mode')) {
                    this.waitingForComponent = true;
                    const modeDisplay = document.getElementById('currentMode');
                    if (modeDisplay) modeDisplay.textContent = 'Place Components';
                    return;
                }

                // Standard Modes (Direct access)
                if (window.shortcutHandler.matches(e, 'select_mode')) { this.setMode('select'); return; }
                if (window.shortcutHandler.matches(e, 'wire_mode')) { this.setMode('wire'); return; }
                if (window.shortcutHandler.matches(e, 'paint_mode')) { this.setMode('paint'); return; }

                if (window.shortcutHandler.matches(e, 'cancel_action')) {
                    this.cancelCurrentAction();
                    this.setMode(null);
                    this.circuit.clearSelection();
                    window.inlineSlider?.hide();
                    this.waitingForComponent = false;
                    if (document.activeElement) document.activeElement.blur();
                    return;
                }

                if (window.shortcutHandler.matches(e, 'select_all')) {
                    e.preventDefault(); // handled in handler if matches
                    this.selectAll();
                    return;
                }
            }
        });
    }

    /**
     * Find component at point using hitbox (Falstad-style)
     */
    findComponentAtPoint(x, y) {
        const components = this.circuit.getAllComponents();
        let nearest = null;
        let minDist = Infinity;

        for (const comp of components) {
            if (comp.containsPoint(x, y)) {
                // 여러 컴포넌트가 겹치면 가장 가까운 것 선택
                const dist = Math.sqrt((x - comp.x) ** 2 + (y - comp.y) ** 2);
                if (dist < minDist) {
                    minDist = dist;
                    nearest = comp;
                }
            }
        }

        return nearest;
    }

    /**
     * Check if mode is a component placement mode
     */
    isComponentMode(mode) {
        return ['R', 'L', 'C', 'GND', 'TL', 'PORT'].includes(mode);
    }

    /**
     * Handle mouse down on canvas
     */
    handleMouseDown(e) {
        if (e.button !== 0) return; // Only left click
        if (this.canvasManager.spacePressed) return; // Panning

        const point = this.canvasManager.clientToSvg(e.clientX, e.clientY);

        // ** Click-to-Place Component **
        if (this.isComponentMode(this.mode)) {
            this.createComponent(this.mode, point.x, point.y);
            // Stay in mode for multiple placement
            return;
        }

        // Identify what was clicked
        let clickedElement = e.target.closest('.circuit-component');
        const clickedWire = e.target.closest('.wire');
        const clickedTerminal = e.target.closest('.terminal');
        const clickedValue = e.target.closest('.component-value');

        // Hitbox-based selection: if no direct element click, search by coordinates
        let hitboxComponent = null;
        if (!clickedElement && !clickedWire && !clickedTerminal) {
            hitboxComponent = this.findComponentAtPoint(point.x, point.y);
        }

        // ** Auto-Select Logic (Deselect -> Select) **
        // If no mode is selected (Deselect/Null mode), but we clicked a component/wire
        if (!this.mode) {
            // If clicked on a terminal
            if (clickedTerminal) {
                // Check if already connected
                const compId = clickedElement.dataset.id;
                const terminal = clickedTerminal.dataset.terminal;
                const comp = this.circuit.getComponent(compId);
                const connectedWireId = comp.connections[terminal];

                if (connectedWireId) {
                    // EXISTING WIRE: Switch to Select mode and start dragging the endpoint
                    this.setMode('select');
                    // Prevent panning
                    this.canvasManager.isPanning = false;
                    this.svg.classList.remove('panning');
                } else {
                    // NEW WIRE
                    this.setMode('wire');
                    // Prevent panning
                    this.canvasManager.isPanning = false;
                    this.svg.classList.remove('panning');
                    return; // Let WireManager handle the rest
                }
            }

            // If clicked on component, wire, or value, switch to Select mode and CONTINUE
            if (clickedElement || hitboxComponent || clickedWire || clickedValue) {
                this.setMode('select');

                // FORCE DISABLE PANNING (Fix for Drag vs Pan conflict)
                // CanvasManager might have already started panning because mode was null.
                if (this.canvasManager.isPanning) {
                    this.canvasManager.isPanning = false;
                    this.svg.classList.remove('panning');
                    this.canvasManager.panStart = { x: 0, y: 0 }; // Optional reset
                }

                // Intentional Fall-through to allow selection logic below to run
            } else {
                // Clicked empty space in Deselect mode -> Allow Panning (Do nothing here)
                return;
            }
        }

        // Wire mode - let WireManager handle everything
        if (this.mode === 'wire') {
            return; // WireManager will handle the event
        }

        // ** Auto-Wire Logic: If clicked on a terminal in Select mode **
        if (this.mode === 'select' && clickedTerminal) {
            // Check if already connected
            const compId = clickedElement.dataset.id;
            const terminal = clickedTerminal.dataset.terminal;
            const comp = this.circuit.getComponent(compId);
            const connectedWireId = comp.connections[terminal];

            if (connectedWireId) {
                // FALL THROUGH to selection/drag logic below
                e.stopPropagation(); // prevent wire creation
            } else {
                this.setMode('wire');
                return; // Return early, let WireManager handle the event
            }
        }

        // Check if clicked on a component value text (Edit Mode)
        // Only allow this if we are in 'select' mode (which we are, if we passed above)
        if (clickedValue) {
            const componentElement = clickedValue.closest('.circuit-component');
            if (componentElement) {
                const id = componentElement.dataset.id;
                const component = this.circuit.getComponent(id);

                // Ensure component is selected first
                if (component && !component.selected) {
                    this.circuit.clearSelection();
                    this.circuit.select(component.id);
                }

                if (component && window.valueEditor) {
                    window.valueEditor.edit(component, clickedValue);
                    return;
                }
            }
        }

        if (this.mode === 'delete') {
            if (clickedElement || hitboxComponent) {
                const id = clickedElement ? clickedElement.dataset.id : hitboxComponent.id;
                this.circuit.removeComponent(id);
                this.canvasManager.renderComponents();
            } else if (clickedWire) {
                const id = clickedWire.dataset.id;
                this.circuit.removeWire(id);
                this.canvasManager.renderComponents();
            }
            return;
        }

        // Handle component selection (direct click or hitbox)
        const component = clickedElement
            ? this.circuit.getComponent(clickedElement.dataset.id)
            : hitboxComponent;

        if (component) {
            // Check if clicking on a terminal with an existing connection
            if (clickedTerminal) {
                const terminal = clickedTerminal.dataset.terminal;
                const connectedWireId = component.connections[terminal];

                if (connectedWireId) {
                    const wire = this.circuit.getWire(connectedWireId);
                    if (wire) {
                        // Start dragging this wire's endpoint
                        this.isDragging = true;

                        // Snapshot BEFORE modifying (disconnecting)
                        this.dragStartSnapshot = {
                            type: 'wire_edit',
                            wire: wire.toJSON()
                        };

                        this.dragType = 'wire-end';
                        this.dragItem = wire;

                        // Determine which end we are dragging
                        if (wire.startComponent === component.id && wire.startTerminal === terminal) {
                            this.dragHandleType = 'start';
                            // Snap cursor to current terminal pos to start smooth drag
                            const termPos = component.getTerminalPosition(terminal);
                            this.lastDragPoint = { x: termPos.x, y: termPos.y };

                            // Disconnect logically
                            component.connections[terminal] = null;
                            wire.startComponent = null;
                            wire.startTerminal = null;
                        } else if (wire.endComponent === component.id && wire.endTerminal === terminal) {
                            this.dragHandleType = 'end';
                            const termPos = component.getTerminalPosition(terminal);
                            this.lastDragPoint = { x: termPos.x, y: termPos.y };

                            component.connections[terminal] = null;
                            wire.endComponent = null;
                            wire.endTerminal = null;
                        }

                        // Select the wire
                        this.circuit.select(wire.id);
                        this.canvasManager.renderComponents(); // Re-render to show disconnected terminal
                        return;
                    }
                }
            }

            // Select component logic with multi-select support
            const isSelected = component.selected;

            if (isSelected && !e.shiftKey) {
                // If clicking an already selected item without Shift, delay clearing
                // This allows dragging the whole group.
                // If it's just a click (no drag), we clear others in handleMouseUp.
                this.clickedSelectedItemId = component.id;
                this.clickedSelectedItemType = 'component';
                window.inlineSlider?.hide();
            } else {
                // Standard selection behavior
                if (!e.shiftKey && !isSelected) {
                    this.circuit.clearSelection();
                }
                this.circuit.select(component.id, e.shiftKey);

                // Show inline slider (only for single selection)
                if (!e.shiftKey && this.circuit.getSelectedComponents().length === 1) {
                    window.inlineSlider?.show(component, e.clientX, e.clientY);
                } else {
                    window.inlineSlider?.hide();
                }
            }

            // Don't start drag if clicked on terminal (user might want to connect wire)
            if (clickedTerminal) {
                return;
            }

            // Prepare for potential drag (delayed start to allow double-click)
            this.potentialDrag = {
                component: component,
                startX: e.clientX,
                startY: e.clientY,
                offset: {
                    x: point.x - component.x,
                    y: point.y - component.y
                }
            };
        } else if (clickedWire) {
            window.inlineSlider?.hide();
            const id = clickedWire.dataset.id;
            const wire = this.circuit.getWire(id);
            const isSelected = wire.selected;

            if (isSelected && !e.shiftKey) {
                this.clickedSelectedItemId = id;
                this.clickedSelectedItemType = 'wire';
            } else {
                if (!e.shiftKey) {
                    if (!isSelected) {
                        this.circuit.clearSelection();
                        this.circuit.select(id);
                    }
                } else {
                    this.circuit.select(id, true);
                }
            }

            // Check distance to endpoints
            const distStart = Math.sqrt((point.x - wire.startX) ** 2 + (point.y - wire.startY) ** 2);
            const distEnd = Math.sqrt((point.x - wire.endX) ** 2 + (point.y - wire.endY) ** 2);
            const endpointThreshold = 10;

            if (distStart < endpointThreshold) {
                // Drag start endpoint
                this.isDragging = true;

                // Snapshot BEFORE modifying (disconnecting)
                this.dragStartSnapshot = {
                    type: 'wire_edit',
                    wire: wire.toJSON()
                };

                this.dragType = 'wire-end';
                this.dragItem = wire;
                this.dragHandleType = 'start';
                this.lastDragPoint = { x: wire.startX, y: wire.startY };

                // Disconnect if connected
                if (wire.startComponent) {
                    const comp = this.circuit.getComponent(wire.startComponent);
                    if (comp && comp.connections[wire.startTerminal] === wire.id) {
                        comp.connections[wire.startTerminal] = null;
                    }
                    wire.startComponent = null;
                    wire.startTerminal = null;
                }
            } else if (distEnd < endpointThreshold) {
                // Drag end endpoint
                this.isDragging = true;

                // Snapshot BEFORE modifying
                this.dragStartSnapshot = {
                    type: 'wire_edit',
                    wire: wire.toJSON()
                };

                this.dragType = 'wire-end';
                this.dragItem = wire;
                this.dragHandleType = 'end';
                this.lastDragPoint = { x: wire.endX, y: wire.endY };

                // Disconnect if connected
                if (wire.endComponent) {
                    const comp = this.circuit.getComponent(wire.endComponent);
                    if (comp && comp.connections[wire.endTerminal] === wire.id) {
                        comp.connections[wire.endTerminal] = null;
                    }
                    wire.endComponent = null;
                    wire.endTerminal = null;
                }
            } else {
                // Normal wire drag (move entire wire)
                this.potentialDrag = {
                    item: wire,
                    type: 'wire',
                    startX: e.clientX,
                    startY: e.clientY,
                    point: { x: point.x, y: point.y }
                };
            }

        } else {
            // Click on empty space - start selection box
            if (!e.shiftKey) {
                this.circuit.clearSelection();
                window.inlineSlider?.hide();
            }

            this.isSelecting = true;
            this.selectionStart = point;
            this.createSelectionBox(point.x, point.y);
        }
    }





    /**
     * Handle mouse move
     */
    handleMouseMove(e) {
        const point = this.canvasManager.clientToSvg(e.clientX, e.clientY);

        // Update Ghost Position (Common for both 'new' drag and 'tool' mode)
        if (this.ghostComponent) {
            this.updateGhostPosition(point.x, point.y);
        }

        // Check if should start drag (moved more than threshold)
        if (this.potentialDrag && !this.isDragging) {
            const dx = e.clientX - this.potentialDrag.startX;
            const dy = e.clientY - this.potentialDrag.startY;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance > this.dragThreshold) {
                // Start actual drag
                this.isDragging = true;
                window.inlineSlider?.hide(); // Hide slider when drag starts
                this.dragType = 'move';

                if (this.potentialDrag.component) {
                    this.dragItem = this.potentialDrag.component;
                    this.dragItemType = 'component';
                    this.dragOffset = this.potentialDrag.offset;
                    if (this.dragItem.element) {
                        this.dragItem.element.classList.add('dragging');
                    }
                } else if (this.potentialDrag.type === 'wire') {
                    this.dragItem = this.potentialDrag.item;
                    this.dragItemType = 'wire';
                    // For wires, we track the last snapped position
                    this.lastDragPoint = {
                        x: this.canvasManager.snapToGrid(this.potentialDrag.point.x),
                        y: this.canvasManager.snapToGrid(this.potentialDrag.point.y)
                    };
                }

                // Snapshot for MOVE
                if (this.dragType === 'move') {
                    const selectedComps = this.circuit.getSelectedComponents();
                    const selectedWires = this.circuit.getSelectedWires();

                    this.dragStartSnapshot = {
                        type: 'move',
                        items: [
                            ...selectedComps.map(c => ({ id: c.id, type: 'component', x: c.x, y: c.y })),
                            ...selectedWires.map(w => ({ id: w.id, type: 'wire', startX: w.startX, startY: w.startY, endX: w.endX, endY: w.endY }))
                        ]
                    };
                }

                this.potentialDrag = null;
            }
        }



        if (this.isDragging) {
            if (this.dragType === 'wire-end' && this.dragItem) {
                const snappedX = this.canvasManager.snapToGrid(point.x);
                const snappedY = this.canvasManager.snapToGrid(point.y);

                if (this.dragHandleType === 'start') {
                    this.dragItem.startX = snappedX;
                    this.dragItem.startY = snappedY;
                } else {
                    this.dragItem.endX = snappedX;
                    this.dragItem.endY = snappedY;
                }
                this.dragItem.render();
                return;
            }
            if (this.dragType === 'move' && this.dragItem) {
                let dx = 0;
                let dy = 0;

                if (this.dragItemType === 'component') {
                    // Move component logic (absolute positioning for dragged item)
                    const newX = this.canvasManager.snapToGrid(point.x - this.dragOffset.x);
                    const newY = this.canvasManager.snapToGrid(point.y - this.dragOffset.y);

                    dx = newX - this.dragItem.x;
                    dy = newY - this.dragItem.y;
                } else if (this.dragItemType === 'wire') {
                    // Move wire logic (relative delta)
                    const snappedX = this.canvasManager.snapToGrid(point.x);
                    const snappedY = this.canvasManager.snapToGrid(point.y);

                    dx = snappedX - this.lastDragPoint.x;
                    dy = snappedY - this.lastDragPoint.y;

                    // Update last reference point
                    if (dx !== 0 || dy !== 0) {
                        this.lastDragPoint = { x: snappedX, y: snappedY };
                    }
                }

                if (dx !== 0 || dy !== 0) {
                    // Move components
                    const selectedComps = this.circuit.getSelectedComponents();
                    selectedComps.forEach(comp => {
                        comp.moveTo(comp.x + dx, comp.y + dy);
                    });

                    // Move wires
                    const selectedWires = this.circuit.getSelectedWires();
                    selectedWires.forEach(wire => {
                        wire.moveBy(dx, dy);
                        this.checkWireDisconnection(wire);
                    });

                    // Update connected wires for components
                    this.updateConnectedWires();
                }
            } else if (this.dragType === 'new' && this.ghostComponent) {
                // Already handled by common updateGhostPosition above
                // But we maintain this block for clarity or future specific logic
            }
        }

        if (this.isSelecting) {
            this.updateSelectionBox(point.x, point.y);
        }
    }

    /**
     * Handle mouse up
     */
    handleMouseUp(e) {
        // Handle delayed selection clear (Click on selected item without drag)
        if (this.clickedSelectedItemId && !this.isDragging) {
            this.circuit.clearSelection();
            this.circuit.select(this.clickedSelectedItemId);

            // Show slider if it's a component
            if (this.clickedSelectedItemType === 'component') {
                const comp = this.circuit.getComponent(this.clickedSelectedItemId);
                if (comp) window.inlineSlider?.show(comp, e.clientX, e.clientY);
            }
        }
        this.clickedSelectedItemId = null;
        this.clickedSelectedItemType = null;

        // Clear potential drag state
        this.potentialDrag = null;

        if (this.isDragging) {
            if (this.dragType === 'wire-end') {
                this.autoConnectWire(this.dragItem);
                this.circuit.updateSpatialConnections();
                this.circuit.notifyChange(); // Trigger Simulation & Render
                // this.canvasManager.renderComponents(); // Handled by notifyChange -> main.js

                // Save History: Wire Edit
                if (this.dragStartSnapshot && this.dragStartSnapshot.type === 'wire_edit') {
                    const prev = this.dragStartSnapshot.wire;
                    const curr = this.dragItem.toJSON();

                    // Check if actually changed
                    if (JSON.stringify(prev) !== JSON.stringify(curr)) {
                        this.circuit.saveHistory('wire_edit', {
                            id: this.dragItem.id,
                            previous: prev,
                            current: curr
                        });
                    }
                }

            } else if (this.dragType === 'move') {
                // Save History: Move
                if (this.dragStartSnapshot && this.dragStartSnapshot.type === 'move') {
                    const moves = [];

                    this.dragStartSnapshot.items.forEach(startItem => {
                        let currentItem;
                        let dx = 0, dy = 0;

                        if (startItem.type === 'component') {
                            currentItem = this.circuit.getComponent(startItem.id);
                            if (currentItem) {
                                dx = currentItem.x - startItem.x;
                                dy = currentItem.y - startItem.y;
                            }
                        } else {
                            currentItem = this.circuit.getWire(startItem.id);
                            if (currentItem) {
                                // For wires, checking start point diff is enough as they move rigidly
                                dx = currentItem.startX - startItem.startX;
                                dy = currentItem.startY - startItem.startY;
                            }
                        }

                        if (dx !== 0 || dy !== 0) {
                            moves.push({ id: startItem.id, type: startItem.type, dx, dy });
                        }
                    });

                    if (moves.length > 0) {
                        this.circuit.saveHistory('move', { items: moves });
                        this.circuit.notifyChange(); // Trigger Simulation & Render
                    }
                }

                // Cleanup visual state
                if (this.dragItem && this.dragItem.element) {
                    this.dragItem.element.classList.remove('dragging');
                }

                this.circuit.updateSpatialConnections();

            } else if (this.dragType === 'new') {
                // New Component Placement
                if (this.ghostComponent) {
                    // Check if we are inside the canvas
                    // Simple check: if we are over the svg (e.target is svg or child)
                    // But events bubble to window.
                    // Let's use coordinate check or element from point?
                    // Coordinate check relative to SVG limits?
                    // Or just strict: e.target.closest('#circuitCanvas')

                    const onCanvas = e.target.closest('svg') === this.svg;

                    if (onCanvas) {
                        this.createComponent(this.dragNewType, this.ghostComponent.x, this.ghostComponent.y);
                        // Mode: Stay in mode OR Reset?
                        // User expectation for "Drag from Palette": Single placement?
                        // Usually drag-and-drop is one-off.
                        // So we clear mode/ghost.
                        this.setMode(null);
                    } else {
                        // Dropped outside? Cancel.
                        this.setMode(null);
                    }
                }
                this.dragNewType = null;
            } else if (this.dragItem) {
                if (this.dragItemType === 'component' && this.dragItem.element) {
                    this.dragItem.element.classList.remove('dragging');
                    // 이동 후 자동 연결 시도 (For components only)
                    this.autoConnectTerminals(this.dragItem);
                } else if (this.dragItemType === 'wire') {
                    // Wires reconnection
                    this.autoConnectWire(this.dragItem);
                }

                // Update spatial connections and global render (for direct connections)
                this.circuit.updateSpatialConnections();
                this.canvasManager.renderComponents();
            }
            this.isDragging = false;
            this.dragType = null;
            this.dragItem = null;
            this.dragItemType = null;
        }

        if (this.isSelecting) {
            // Auto-Deselect: If selecting empty space (tiny box) in Select Mode
            if (this.mode === 'select' && this.selectionBox) {
                const width = parseFloat(this.selectionBox.getAttribute('width')) || 0;
                const height = parseFloat(this.selectionBox.getAttribute('height')) || 0;
                // Threshold of 5px to distinguish between click and drag
                if (width < 5 && height < 5) {
                    this.setMode(null);
                }
            }

            this.finishSelection();
            this.isSelecting = false;
        }
    }

    /**
     * Handle double-click for editing
     */
    handleDoubleClick(e) {
        e.preventDefault();  // Prevent text selection
        e.stopPropagation();

        const clickedElement = e.target.closest('.circuit-component');
        if (clickedElement) {
            const id = clickedElement.dataset.id;
            const component = this.circuit.getComponent(id);
            if (component) {
                // Hide inline slider before opening modal
                window.inlineSlider?.hide();
                // Open component parameter modal
                window.componentModal?.open(component);
            }
        } else if (!this.mode) {
            // Reset View on double-click empty space (if no tool selected)
            this.canvasManager.resetView();
        }
    }

    /**
     * Create new component
     */
    createComponent(type, x, y) {
        const snappedX = this.canvasManager.snapToGrid(x);
        const snappedY = this.canvasManager.snapToGrid(y);

        const component = this.instantiateComponent(type, snappedX, snappedY);
        if (!component) return null;

        // Ghost 컴포넌트가 있고 타입이 같으면 회전 상태 계승
        if (this.ghostComponent && this.ghostComponent.type === type) {
            component.rotation = this.ghostComponent.rotation;
            component.updateElement(); // 회전 적용을 위해 업데이트
        }

        this.circuit.addComponent(component);
        const element = component.render();
        this.canvasManager.addComponentElement(element);

        // 자동 연결: 컴포넌트 터미널과 Wire 터미널 위치가 같으면 연결
        this.autoConnectTerminals(component);

        // Select new component
        this.circuit.clearSelection();
        this.circuit.select(component.id);

        // Update spatial connections
        this.circuit.updateSpatialConnections();

        // Re-render ALL components to ensure neighbors turn green immediately
        this.canvasManager.renderComponents();

        // Trigger inline value edit
        if (window.valueEditor) {
            // Use setTimeout to ensure DOM is ready and positioned
            setTimeout(() => {
                window.valueEditor.edit(component);
            }, 0);
        }

        return component;
    }



    /**
     * 컴포넌트의 터미널과 Wire 터미널이 같은 위치에 있으면 자동 연결
     */
    autoConnectTerminals(component) {
        const tolerance = 5; // 위치 허용 오차 (픽셀)

        // 컴포넌트의 각 터미널 위치 확인
        for (const terminalKey of Object.keys(component.terminals)) {
            const terminalPos = component.getTerminalPosition(terminalKey);

            // 이미 연결된 터미널은 스킵
            if (component.connections[terminalKey]) continue;

            // 모든 Wire 검사
            const wires = this.circuit.getAllWires();
            for (const wire of wires) {
                // Wire의 start 터미널 확인
                if (!wire.startComponent) {
                    const dist = Math.sqrt(
                        (terminalPos.x - wire.startX) ** 2 +
                        (terminalPos.y - wire.startY) ** 2
                    );
                    if (dist <= tolerance) {
                        // 연결!
                        wire.startComponent = component.id;
                        wire.startTerminal = terminalKey;
                        component.connections[terminalKey] = wire.id;
                        continue;
                    }
                }

                // Wire의 end 터미널 확인
                if (!wire.endComponent) {
                    const dist = Math.sqrt(
                        (terminalPos.x - wire.endX) ** 2 +
                        (terminalPos.y - wire.endY) ** 2
                    );
                    if (dist <= tolerance) {
                        // 연결!
                        wire.endComponent = component.id;
                        wire.endTerminal = terminalKey;
                        component.connections[terminalKey] = wire.id;
                        continue;
                    }
                }
            }
        }

        // 연결 상태 업데이트를 위해 다시 렌더링
        this.canvasManager.renderComponents();
    }

    /**
     * Create selection box
     */
    createSelectionBox(x, y) {
        this.selectionBox = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        this.selectionBox.setAttribute('class', 'selection-box');
        this.selectionBox.setAttribute('x', x);
        this.selectionBox.setAttribute('y', y);
        this.selectionBox.setAttribute('width', 0);
        this.selectionBox.setAttribute('height', 0);
        this.canvasManager.addOverlay(this.selectionBox);
    }

    /**
     * Update selection box
     */
    updateSelectionBox(x, y) {
        if (!this.selectionBox) return;

        const minX = Math.min(this.selectionStart.x, x);
        const minY = Math.min(this.selectionStart.y, y);
        const width = Math.abs(x - this.selectionStart.x);
        const height = Math.abs(y - this.selectionStart.y);

        this.selectionBox.setAttribute('x', minX);
        this.selectionBox.setAttribute('y', minY);
        this.selectionBox.setAttribute('width', width);
        this.selectionBox.setAttribute('height', height);

        // Visual feedback based on direction (Right-to-Left = Crossing, Left-to-Right = Window)
        if (x < this.selectionStart.x) {
            this.selectionBox.classList.add('crossing');
        } else {
            this.selectionBox.classList.remove('crossing');
        }
    }

    /**
     * Finish selection box
     */
    finishSelection() {
        if (!this.selectionBox) return;

        const rect = {
            x: parseFloat(this.selectionBox.getAttribute('x')),
            y: parseFloat(this.selectionBox.getAttribute('y')),
            width: parseFloat(this.selectionBox.getAttribute('width')),
            height: parseFloat(this.selectionBox.getAttribute('height'))
        };

        // Determine selection mode based on direction
        // If current mouse X < start X, it was a Right-to-Left drag -> Crossing Mode
        // We can check the class we added, or recalculate. Checking logic is safer.
        // But we just cleared the box. So we need the info passed or stored.
        // Actually, finishSelection calls clearOverlay AFTER logic. So we can check valid width/height direction?
        // But rect is normalized (minX, minY, width, height).
        // Let's use the class on the element since it's still alive here.
        const isCrossing = this.selectionBox.classList.contains('crossing');

        // Find components within selection box
        const selected = [];
        this.circuit.getAllComponents().forEach(comp => {
            if (isCrossing) {
                // Crossing Mode: Select if INTERSECTS or CONTAINS
                // Check if component center is in rect OR if it intersects
                // For simplicity, we can use a slightly more generous check or specific intersection logic
                // Using existing 'center contains' logic + simplified intersection
                // But user requirement is "Even partial inclusion" -> Intersection.
                if (this.componentIntersectsRect(comp, rect)) {
                    selected.push(comp.id);
                }
            } else {
                // Window Mode: Select ONLY if FULLY CONTAINED
                if (this.componentContainsInRect(comp, rect)) {
                    selected.push(comp.id);
                }
            }
        });

        // Find wires within selection box
        this.circuit.getAllWires().forEach(wire => {
            if (isCrossing) {
                // Crossing Mode: Intersection (Existing Logic)
                if (this.wireIntersectsRect(wire, rect)) {
                    selected.push(wire.id);
                }
            } else {
                // Window Mode: Full Containment
                // Both start and end points must be inside
                if (this.wireContainsInRect(wire, rect)) {
                    selected.push(wire.id);
                }
            }
        });

        if (selected.length > 0) {
            this.circuit.select(selected);
        }

        this.canvasManager.clearOverlay();
        this.selectionBox = null;
    }

    /**
     * Check if wire intersects with selection rectangle
     * Wire의 시작점, 끝점 또는 선분이 rect와 교차하면 true
     */
    wireIntersectsRect(wire, rect) {
        const rectRight = rect.x + rect.width;
        const rectBottom = rect.y + rect.height;

        // 시작점이 rect 안에 있는지 확인
        const startInRect = wire.startX >= rect.x && wire.startX <= rectRight &&
            wire.startY >= rect.y && wire.startY <= rectBottom;

        // 끝점이 rect 안에 있는지 확인
        const endInRect = wire.endX >= rect.x && wire.endX <= rectRight &&
            wire.endY >= rect.y && wire.endY <= rectBottom;

        if (startInRect || endInRect) {
            return true;
        }

        // Wire 선분이 rect를 통과하는지 확인 (선분-사각형 교차)
        return this.lineIntersectsRect(
            wire.startX, wire.startY, wire.endX, wire.endY,
            rect.x, rect.y, rectRight, rectBottom
        );
    }

    /**
     * Check if component is fully contained within rectangle (Window Selection)
     */
    componentContainsInRect(comp, rect) {
        // Check center
        if (!this.pointInRect(comp.x, comp.y, rect)) return false;

        // Check all terminals
        for (const tKey in comp.terminals) {
            const pos = comp.getTerminalPosition(tKey);
            if (!this.pointInRect(pos.x, pos.y, rect)) return false;
        }

        return true;
    }

    /**
     * Check if component intersects with rectangle (Crossing Selection)
     */
    componentIntersectsRect(comp, rect) {
        // 1. If Center is inside, yes
        if (this.pointInRect(comp.x, comp.y, rect)) return true;

        // 2. If any terminal is inside, yes
        const terminals = [];
        for (const tKey in comp.terminals) {
            const pos = comp.getTerminalPosition(tKey);
            if (this.pointInRect(pos.x, pos.y, rect)) return true;
            terminals.push(pos);
        }

        // 3. Check if any "connection line" (center to terminal) intersects rect
        // This approximates the component body as lines from center to terminals
        for (const termPos of terminals) {
            if (this.lineIntersectsRect(comp.x, comp.y, termPos.x, termPos.y,
                rect.x, rect.y, rect.x + rect.width, rect.y + rect.height)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Check if wire is fully contained within rectangle
     */
    wireContainsInRect(wire, rect) {
        return this.pointInRect(wire.startX, wire.startY, rect) &&
            this.pointInRect(wire.endX, wire.endY, rect);
    }

    /**
     * Helper: Point in Rect
     */
    pointInRect(x, y, rect) {
        return x >= rect.x && x <= rect.x + rect.width &&
            y >= rect.y && y <= rect.y + rect.height;
    }

    /**
     * Check if line segment intersects with rectangle
     * (Existing method kept for reference/usage)
     */
    lineIntersectsRect(x1, y1, x2, y2, rx1, ry1, rx2, ry2) {
        // 선분이 사각형의 네 변 중 하나와 교차하는지 확인
        return this.lineIntersectsLine(x1, y1, x2, y2, rx1, ry1, rx2, ry1) || // 상단
            this.lineIntersectsLine(x1, y1, x2, y2, rx1, ry2, rx2, ry2) || // 하단
            this.lineIntersectsLine(x1, y1, x2, y2, rx1, ry1, rx1, ry2) || // 좌측
            this.lineIntersectsLine(x1, y1, x2, y2, rx2, ry1, rx2, ry2);   // 우측
    }

    /**
     * Check if two line segments intersect
     */
    lineIntersectsLine(x1, y1, x2, y2, x3, y3, x4, y4) {
        const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
        if (Math.abs(denom) < 0.0001) return false; // 평행

        const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
        const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;

        return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1;
    }

    /**
     * Rotate selected components
     */
    rotateSelected() {
        const selected = this.circuit.getSelectedComponents();
        selected.forEach(comp => {
            comp.rotate();
        });
        this.updateConnectedWires();

        // Update spatial connections (for visual feedback)
        this.circuit.updateSpatialConnections();
        this.canvasManager.renderComponents();
    }

    /**
     * Update wires connected to selected components
     */
    updateConnectedWires() {
        const selected = this.circuit.getSelectedComponents();
        selected.forEach(comp => {
            const wires = this.circuit.getWiresConnectedTo(comp.id);
            wires.forEach(wire => {
                wire.updateFromComponents(this.circuit);
            });
        });
    }

    /**
     * Select all components
     */
    selectAll() {
        const allIds = this.circuit.getAllComponents().map(c => c.id);
        this.circuit.select(allIds);
    }

    /**
    * Set current mode
    */
    setMode(mode) {
        this.mode = mode;

        // Disable Drawing Tool if entering a specific mode
        if (mode && window.drawingManager && window.drawingManager.activeTool) {
            window.drawingManager.setTool(null);
        }



        this.removeGhost(); // Clear any existing ghost

        if (this.isComponentMode(mode)) {
            this.createGhost(mode);
        }

        // Update UI
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelectorAll('.component-item').forEach(btn => {
            btn.classList.remove('active');
        });

        if (mode === 'wire') {
            const wireBtn = document.getElementById('btnWireComponent');
            if (wireBtn) wireBtn.classList.add('active');
        } else if (this.isComponentMode(mode)) {
            // Highlight component in palette
            const compBtn = document.querySelector(`.component-item[data-type="${mode}"]`);
            if (compBtn) compBtn.classList.add('active');
        } else if (mode) {
            const modeBtn = document.getElementById(`btn${mode.charAt(0).toUpperCase() + mode.slice(1)}`);
            if (modeBtn) modeBtn.classList.add('active');
        } else {
            // Null mode (Deselect)
            const deselectBtn = document.getElementById('btnDeselect');
            if (deselectBtn) deselectBtn.classList.add('active');
        }

        const modeDisplay = document.getElementById('currentMode');
        if (modeDisplay) {
            // Display Deselect for null, or Mode Name
            let displayText = mode ? (mode.charAt(0).toUpperCase() + mode.slice(1)) : 'Deselect';
            // Map type codes to full names
            const typeNames = {
                'R': 'Place Resistor', 'L': 'Place Inductor', 'C': 'Place Capacitor',
                'GND': 'Place Ground', 'TL': 'Place T-Line', 'PORT': 'Place Port'
            };
            if (typeNames[mode]) displayText = typeNames[mode];

            modeDisplay.textContent = displayText;
        }
        // Update canvas cursor
        this.svg.classList.remove('wire-mode');
        if (mode === 'wire') {
            this.svg.classList.add('wire-mode');
        }

        // Notify wire manager of mode change
        if (window.wireManager) {
            window.wireManager.setActive(mode === 'wire');
        }
    }

    /**
     * Cancel current action
     */
    cancelCurrentAction() {
        if (this.isDragging) {
            this.isDragging = false;
            this.dragType = null;
            this.dragComponent = null;
        }

        if (this.isSelecting) {
            this.isSelecting = false;
            this.canvasManager.clearOverlay();
            this.selectionBox = null;
            this.removeGhost(); // Clean up ghost if selecting? No, selecting cancels mode usually.
            // But cancelCurrentAction implicitly often resets things.
            // Wait, this function is called by ESC. ESC sets mode to null.
            // If setMode(null) is called, it already calls removeGhost().
            // So we are good. But redundant safety is fine.
        }

        this.removeGhost();

        this.circuit.clearSelection();
    }

    /**
     * Check if wire should be disconnected from components
     * Called when dragging a wire
     */
    checkWireDisconnection(wire) {
        const threshold = 10; // Disconnection threshold (slightly larger than connection tolerance to prevent flickering)

        // Check start connection
        if (wire.startComponent) {
            const comp = this.circuit.getComponent(wire.startComponent);
            if (comp) {
                const terminalPos = comp.getTerminalPosition(wire.startTerminal);
                const dist = Math.sqrt(
                    (wire.startX - terminalPos.x) ** 2 +
                    (wire.startY - terminalPos.y) ** 2
                );

                if (dist > threshold) {
                    // Disconnect start
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
            const comp = this.circuit.getComponent(wire.endComponent);
            if (comp) {
                const terminalPos = comp.getTerminalPosition(wire.endTerminal);
                const dist = Math.sqrt(
                    (wire.endX - terminalPos.x) ** 2 +
                    (wire.endY - terminalPos.y) ** 2
                );

                if (dist > threshold) {
                    // Disconnect end
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
            const startTerm = this.circuit.findTerminalNear(wire.startX, wire.startY, tolerance);
            if (startTerm) {
                wire.startComponent = startTerm.componentId;
                wire.startTerminal = startTerm.terminal;
                wire.startX = startTerm.x;
                wire.startY = startTerm.y;

                const comp = this.circuit.getComponent(startTerm.componentId);
                if (comp) {
                    comp.connections[startTerm.terminal] = wire.id;
                }
            }
        }

        // End Endpoint
        if (!wire.endComponent) {
            const endTerm = this.circuit.findTerminalNear(wire.endX, wire.endY, tolerance);
            if (endTerm) {
                wire.endComponent = endTerm.componentId;
                wire.endTerminal = endTerm.terminal;
                wire.endX = endTerm.x;
                wire.endY = endTerm.y;

                const comp = this.circuit.getComponent(endTerm.componentId);
                if (comp) {
                    comp.connections[endTerm.terminal] = wire.id;
                }
            }
        }

        wire.render();
    }
}

window.DragDropHandler = DragDropHandler;

