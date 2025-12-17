/**
 * Wire Class
 * Represents a connection between two terminals
 */
class Wire {
    static idCounter = 0;

    constructor(startX, startY, endX, endY) {
        this.id = `wire_${++Wire.idCounter}`;
        this.startX = startX;
        this.startY = startY;
        this.endX = endX;
        this.endY = endY;

        // Connected component info
        this.startComponent = null;
        this.startTerminal = null;
        this.endComponent = null;
        this.endTerminal = null;

        this.selected = false;
        this.element = null;
    }

    /**
     * Create SVG element for wire
     */
    createElement() {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', 'wire-group');
        g.setAttribute('data-id', this.id);
        this.element = g;
        return g;
    }

    /**
     * Render wire
     */
    render() {
        if (!this.element) {
            this.createElement();
        }

        // Create straight line path (CircuitJS style)
        const path = this.createStraightPath();

        this.element.innerHTML = `
            <path class="wire ${this.selected ? 'selected' : ''}" 
                  data-id="${this.id}"
                  d="${path}"/>
        `;

        return this.element;
    }

    /**
     * Create straight line path between start and end (CircuitJS style)
     */
    createStraightPath() {
        return `M${this.startX},${this.startY} L${this.endX},${this.endY}`;
    }

    /**
     * Set selected state
     */
    setSelected(selected) {
        this.selected = selected;
        if (this.element) {
            const path = this.element.querySelector('.wire');
            if (path) {
                if (selected) {
                    path.classList.add('selected');
                } else {
                    path.classList.remove('selected');
                }
            }
        }
    }

    /**
     * Update wire positions from connected components
     */
    updateFromComponents(circuit) {
        if (this.startComponent) {
            const comp = circuit.getComponent(this.startComponent);
            if (comp) {
                const pos = comp.getTerminalPosition(this.startTerminal);
                this.startX = pos.x;
                this.startY = pos.y;
            }
        }

        if (this.endComponent) {
            const comp = circuit.getComponent(this.endComponent);
            if (comp) {
                const pos = comp.getTerminalPosition(this.endTerminal);
                this.endX = pos.x;
                this.endY = pos.y;
            }
        }

        this.render();
    }

    /**
     * Move wire by offset
     */
    moveBy(dx, dy) {
        this.startX += dx;
        this.startY += dy;
        this.endX += dx;
        this.endY += dy;
        this.render();
    }

    /**
     * Check if point is on wire (straight line)
     */
    containsPoint(x, y, tolerance = 5) {
        // Check distance to single straight line segment
        return this.distanceToSegment(x, y, this.startX, this.startY, this.endX, this.endY) < tolerance;
    }

    /**
     * Calculate distance from point to line segment
     */
    distanceToSegment(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const lengthSq = dx * dx + dy * dy;

        if (lengthSq === 0) {
            return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
        }

        let t = ((px - x1) * dx + (py - y1) * dy) / lengthSq;
        t = Math.max(0, Math.min(1, t));

        const nearestX = x1 + t * dx;
        const nearestY = y1 + t * dy;

        return Math.sqrt((px - nearestX) ** 2 + (py - nearestY) ** 2);
    }

    /**
     * Serialize wire to JSON
     */
    toJSON() {
        return {
            id: this.id,
            startX: this.startX,
            startY: this.startY,
            endX: this.endX,
            endY: this.endY,
            startComponent: this.startComponent,
            startTerminal: this.startTerminal,
            endComponent: this.endComponent,
            endTerminal: this.endTerminal
        };
    }

    /**
     * Create wire from JSON
     */
    static fromJSON(data) {
        const wire = new Wire(data.startX, data.startY, data.endX, data.endY);
        wire.id = data.id;
        wire.startComponent = data.startComponent;
        wire.startTerminal = data.startTerminal;
        wire.endComponent = data.endComponent;
        wire.endTerminal = data.endTerminal;

        // Update ID counter
        const idNum = parseInt(wire.id.split('_')[1]);
        if (idNum > Wire.idCounter) {
            Wire.idCounter = idNum;
        }

        return wire;
    }
}

/**
 * Wire Manager
 * Handles wire drawing mode and wire creation
 */
class WireManager {
    constructor(canvasManager, circuit) {
        this.canvasManager = canvasManager;
        this.circuit = circuit;
        this.svg = canvasManager.svg;

        // Wire drawing state
        this.isActive = false;
        this.isDrawing = false;
        this.startPoint = null;
        this.startTerminal = null;
        this.previewElement = null;

        // Initialize
        this.init();
    }

    /**
     * Initialize event listeners
     */
    init() {
        this.svg.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.svg.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.svg.addEventListener('mouseup', (e) => this.handleMouseUp(e));
    }

    /**
     * Set wire mode active/inactive
     */
    setActive(active) {
        this.isActive = active;

        if (!active) {
            this.cancelDrawing();
        }

        // Update UI
        const wireBtn = document.getElementById('btnWire');
        if (wireBtn) {
            if (active) {
                wireBtn.classList.add('active');
            } else {
                wireBtn.classList.remove('active');
            }
        }

        // Update mode display
        const modeDisplay = document.getElementById('currentMode');
        if (modeDisplay && active) {
            modeDisplay.textContent = 'Wire';
        }

        // Update canvas cursor
        if (active) {
            this.svg.classList.add('wire-mode');
        } else {
            this.svg.classList.remove('wire-mode');
        }
    }

    /**
     * Toggle wire mode
     */
    toggleActive() {
        if (this.isActive) {
            this.setActive(false);
            if (window.dragDropHandler) {
                window.dragDropHandler.setMode('select');
            }
        } else {
            this.setActive(true);
            if (window.dragDropHandler) {
                window.dragDropHandler.setMode('wire');
            }
        }
    }

    /**
     * Handle mouse down in wire mode
     */
    handleMouseDown(e) {
        if (!this.isActive || e.button !== 0) return;
        if (this.canvasManager.spacePressed) return;

        const point = this.canvasManager.clientToSvg(e.clientX, e.clientY);

        // Check if clicked near a terminal
        const terminal = this.circuit.findTerminalNear(point.x, point.y);

        if (!this.isDrawing) {
            // Start drawing wire
            this.isDrawing = true;

            if (terminal) {
                this.startPoint = { x: terminal.x, y: terminal.y };
                this.startTerminal = terminal;
                this.highlightTerminal(terminal);
            } else {
                // Snap to grid if no terminal nearby
                this.startPoint = {
                    x: this.canvasManager.snapToGrid(point.x),
                    y: this.canvasManager.snapToGrid(point.y)
                };
                this.startTerminal = null;
            }

            this.createPreview();
        } else {
            // Finish drawing wire (Click-Click method: 2nd click)
            this.finishWireCreation(point.x, point.y, terminal);
        }
    }

    /**
     * Handle mouse move
     */
    handleMouseMove(e) {
        if (!this.isActive) return;

        const point = this.canvasManager.clientToSvg(e.clientX, e.clientY);

        // Highlight nearby terminals
        const terminal = this.circuit.findTerminalNear(point.x, point.y);
        this.clearTerminalHighlights();
        if (terminal) {
            this.highlightTerminal(terminal);
        }

        // Update preview if drawing
        if (this.isDrawing && this.previewElement) {
            let endX, endY;

            if (terminal) {
                endX = terminal.x;
                endY = terminal.y;
            } else {
                endX = this.canvasManager.snapToGrid(point.x);
                endY = this.canvasManager.snapToGrid(point.y);
            }

            this.updatePreview(endX, endY);
        }
    }

    /**
     * Handle mouse up
     */
    handleMouseUp(e) {
        if (!this.isActive || !this.isDrawing || e.button !== 0) return;

        const point = this.canvasManager.clientToSvg(e.clientX, e.clientY);

        // Calculate drag distance
        // We need to check endpoint relative to start point
        // But handleMouseUp doesn't have local 'terminal' logic duplicated from MouseDown?
        // Actually we do need to calculate endpoint to know distance.

        // Check if ended near a terminal
        const terminal = this.circuit.findTerminalNear(point.x, point.y);

        let endX, endY;

        if (terminal) {
            endX = terminal.x;
            endY = terminal.y;
        } else {
            endX = this.canvasManager.snapToGrid(point.x);
            endY = this.canvasManager.snapToGrid(point.y);
        }

        const dx = endX - this.startPoint.x;
        const dy = endY - this.startPoint.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // If distance > 5px, treat as Drag-Finish.
        // If distance <= 5px, treat as Click (start of Click-Click), so DO NOT finish.
        if (dist > 5) {
            this.finishWireCreation(point.x, point.y, terminal);
        }
    }

    /**
     * Finish wire creation logic (refactored from handleMouseUp)
     */
    finishWireCreation(x, y, terminal) {
        let endX, endY, endTerminal;

        if (terminal) {
            endX = terminal.x;
            endY = terminal.y;
            endTerminal = terminal;
        } else {
            endX = this.canvasManager.snapToGrid(x);
            endY = this.canvasManager.snapToGrid(y);
            endTerminal = null;
        }

        // Create wire if it has length
        const dx = endX - this.startPoint.x;
        const dy = endY - this.startPoint.y;

        // Even for Click-Click, we avoid zero-length wires
        if (Math.abs(dx) > 0 || Math.abs(dy) > 0) {
            this.createWire(endX, endY, endTerminal);
        }

        this.finishDrawing();
    }

    /**
     * Create preview element
     */
    createPreview() {
        this.previewElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        this.previewElement.setAttribute('class', 'wire-preview');
        this.canvasManager.addOverlay(this.previewElement);
    }

    /**
     * Update preview element (straight line)
     */
    updatePreview(endX, endY) {
        if (!this.previewElement) return;

        // Straight line preview (CircuitJS style)
        const path = `M${this.startPoint.x},${this.startPoint.y} L${endX},${endY}`;

        this.previewElement.setAttribute('d', path);
    }

    /**
     * Create actual wire
     */
    createWire(endX, endY, endTerminal) {
        const wire = new Wire(
            this.startPoint.x,
            this.startPoint.y,
            endX,
            endY
        );

        // Connect to start terminal
        if (this.startTerminal) {
            wire.startComponent = this.startTerminal.componentId;
            wire.startTerminal = this.startTerminal.terminal;

            // Update component connection
            const comp = this.circuit.getComponent(this.startTerminal.componentId);
            if (comp) {
                comp.connections[this.startTerminal.terminal] = wire.id;
            }
        }

        // Connect to end terminal
        if (endTerminal) {
            wire.endComponent = endTerminal.componentId;
            wire.endTerminal = endTerminal.terminal;

            // Update component connection
            const comp = this.circuit.getComponent(endTerminal.componentId);
            if (comp) {
                comp.connections[endTerminal.terminal] = wire.id;
            }
        }

        this.circuit.addWire(wire);
        const element = wire.render();
        this.canvasManager.addWireElement(element);

        // Re-render to update terminal states
        this.canvasManager.renderComponents();
    }

    /**
     * Finish drawing
     */
    finishDrawing() {
        this.isDrawing = false;
        this.startPoint = null;
        this.startTerminal = null;

        if (this.previewElement) {
            this.previewElement.remove();
            this.previewElement = null;
        }

        this.clearTerminalHighlights();
    }

    /**
     * Cancel drawing
     */
    cancelDrawing() {
        this.finishDrawing();
    }

    /**
     * Highlight terminal
     */
    highlightTerminal(terminal) {
        const comp = this.circuit.getComponent(terminal.componentId);
        if (comp && comp.element) {
            const terminalEl = comp.element.querySelector(`[data-terminal="${terminal.terminal}"]`);
            if (terminalEl) {
                terminalEl.classList.add('highlight');
            }
        }
    }

    /**
     * Clear all terminal highlights
     */
    clearTerminalHighlights() {
        document.querySelectorAll('.terminal.highlight').forEach(el => {
            el.classList.remove('highlight');
        });
    }
}

window.Wire = Wire;
window.WireManager = WireManager;

