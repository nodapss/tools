/**
 * Drawing Manager
 * Handles user drawings on Circuit (SVG) and Graph (Canvas Overlay)
 */
class DrawingManager {
    constructor(canvasManager) {
        this.canvasManager = canvasManager;

        // UI Elements
        this.toolbar = document.getElementById('drawToolbar');
        this.circuitLayer = document.getElementById('drawingsLayer');
        this.graphOverlay = document.getElementById('graphDrawOverlay');

        // State
        this.activeTool = null; // 'pen', 'circle', 'rect', 'arrow', 'text'
        this.isDrawing = false;
        this.currentShape = null; // SVGShapeElement or object for canvas
        this.startPos = { x: 0, y: 0 };
        this.context = null; // 'circuit' or 'graph'
        this.currentColor = '#ff00ff'; // Default color

        // Graph Drawings (In-memory storage for overlay)
        this.graphDrawings = [];
        this.currentGraphPath = []; // For Pen tool

        this.isPaintMode = false; // Track Paint Mode State

        // Bindings
        this.bindEvents();
    }

    generateId() {
        return 'draw_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    bindEvents() {
        // Toolbar Buttons
        this.toolbar.querySelectorAll('.tool-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tool = btn.dataset.tool;
                if (tool === 'clear') {
                    this.clearAll();
                } else {
                    // This handled by Toolbar.js usually, but if clicked directly:
                    this.setTool(tool === this.activeTool ? null : tool);
                }
            });
        });

        // Toggle Color Menu Logic (Right Click on Paint Button)
        const btnPaint = document.getElementById('btnPaint');
        if (btnPaint) {
            btnPaint.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.openColorMenu(e.clientX, e.clientY);
            });
        }

        // Color Menu Events
        const colorMenu = document.getElementById('paintColorMenu');
        if (colorMenu) {
            // Preset Colors
            colorMenu.querySelectorAll('.color-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const color = btn.dataset.color;
                    this.setColor(color);
                    this.closeColorMenu();
                });
            });

            // Color Picker
            const colorPicker = document.getElementById('paintColorPicker');
            if (colorPicker) {
                colorPicker.addEventListener('input', (e) => {
                    this.setColor(e.target.value);
                });
            }

            // Close menu when clicking outside
            document.addEventListener('mousedown', (e) => {
                if (colorMenu.style.display !== 'none' && !colorMenu.contains(e.target) && e.target !== btnPaint) {
                    this.closeColorMenu();
                }
            });
        }

        // Graph Overlay Events
        // Circuit events are delegated via CanvasManager to avoid conflict
        if (this.graphOverlay) {
            this.graphOverlay.addEventListener('mousedown', (e) => this.handleGraphMouseDown(e));
            window.addEventListener('mousemove', (e) => this.handleGraphMouseMove(e));
            window.addEventListener('mouseup', (e) => this.handleGraphMouseUp(e));
        }

        // Global Key Events
        window.addEventListener('keydown', (e) => {
            if (!window.shortcutHandler) return;

            // Exit Tool (default 'Escape')
            if (window.shortcutHandler.matches(e, 'cancel_action')) {
                if (document.activeElement && document.activeElement.tagName !== 'BODY') {
                    document.activeElement.blur();
                    return;
                }

                if (this.activeTool) {
                    // Step 1: Cancel Tool
                    this.setTool(null);
                } else if (this.isPaintMode) {
                    // Step 2: Exit Paint Mode
                    this.exitPaintMode();
                }
                return;
            }

            // Custom Color Shortcuts (default 1-4)
            // Use 'matches' with specific actions
            if (this.activeTool && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
                if (window.shortcutHandler.matches(e, 'paint_color_1')) {
                    this.setColor('#ff0000'); // Red
                } else if (window.shortcutHandler.matches(e, 'paint_color_2')) {
                    this.setColor('#0000ff'); // Blue
                } else if (window.shortcutHandler.matches(e, 'paint_color_3')) {
                    this.setColor('#ffffff'); // White
                } else if (window.shortcutHandler.matches(e, 'paint_color_4')) {
                    // Custom Color (Last picked)
                    const picker = document.getElementById('paintColorPicker');
                    if (picker) {
                        this.setColor(picker.value);
                    }
                }
            }
        });

        // Resize overlay
        window.addEventListener('resize', () => this.resizeGraphOverlay());
        const observer = new ResizeObserver(() => this.resizeGraphOverlay());
        const graphContainer = document.getElementById('graphContainer');
        if (graphContainer) observer.observe(graphContainer);
        this.resizeGraphOverlay();
    }

    // Color Menu Methods
    openColorMenu(x, y) {
        const menu = document.getElementById('paintColorMenu');
        if (!menu) return;

        menu.style.display = 'block';
        // Position to the right of the mouse cursor as requested
        menu.style.left = `${x + 10}px`;
        menu.style.top = `${y}px`;

        // Adjust if out of bounds (optional basic check)
        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            menu.style.left = `${x - rect.width - 10}px`;
        }
        if (rect.bottom > window.innerHeight) {
            menu.style.top = `${y - rect.height}px`;
        }
    }

    closeColorMenu() {
        const menu = document.getElementById('paintColorMenu');
        if (menu) menu.style.display = 'none';
    }

    setColor(color) {
        this.currentColor = color;
        // Note: We deliberately do NOT update the picker value here.
        // This ensures the picker retains the "Custom" color even when we switch to a preset.
    }

    resizeGraphOverlay() {
        if (!this.graphOverlay) return;
        const rect = this.graphOverlay.parentElement.getBoundingClientRect();
        this.graphOverlay.width = rect.width;
        this.graphOverlay.height = rect.height;
        this.renderGraphOverlay();
    }

    exitPaintMode() {
        this.isPaintMode = false;
        this.setTool(null);

        // Ensure we are back to Sheet mode (Deselect)
        if (window.dragDropHandler) {
            window.dragDropHandler.setMode(null);
        }
    }

    setTool(tool) {
        this.activeTool = tool;

        if (tool) {
            this.isPaintMode = true;
        }

        // GRAB Panel Button Elements
        const btnPaint = document.getElementById('btnPaint');
        const btnDeselect = document.getElementById('btnDeselect');

        // Disable Drag/Drop Mode if tool is selected
        if (tool && window.dragDropHandler) {
            window.dragDropHandler.setMode(null);
            if (window.circuit) window.circuit.clearSelection();

            // Override DragDropHandler's default UI update (which sets Deselect active)
            // Force Paint Active, Deselect Inactive
            if (btnPaint) btnPaint.classList.add('active');
            if (btnDeselect) btnDeselect.classList.remove('active');
        } else {
            // Tool Deactivated (Back to normal OR Idle Paint Mode)

            if (this.isPaintMode) {
                // Idle Paint Mode: Keep Paint button active, Deselect inactive
                if (btnPaint) btnPaint.classList.add('active');
                if (btnDeselect) btnDeselect.classList.remove('active');
            } else {
                // Full Exit: Paint inactive
                if (btnPaint) btnPaint.classList.remove('active');

                // If we are just exiting tool mode without entering another DragDrop mode,
                // DragDropHandler is likely in 'null' mode (Deselect). Ensure it's active.
                if (window.dragDropHandler && !window.dragDropHandler.mode) {
                    if (btnDeselect) btnDeselect.classList.add('active');
                }
            }
        }

        // Update UI
        this.toolbar.querySelectorAll('.tool-btn').forEach(btn => {
            if (btn.dataset.tool === tool) btn.classList.add('active');
            else btn.classList.remove('active');
        });

        // Update Canvas Cursor
        const cursorClass = `drawing-mode-${tool}`;
        document.body.classList.remove('drawing-mode-pen', 'drawing-mode-circle', 'drawing-mode-rect', 'drawing-mode-arrow', 'drawing-mode-text');
        if (tool) {
            document.body.classList.add(cursorClass);
            if (this.graphOverlay) this.graphOverlay.style.pointerEvents = 'auto'; // Enable events on overlay
        } else {
            if (this.graphOverlay) this.graphOverlay.style.pointerEvents = 'none'; // Passthrough when idle
        }
    }

    clearAll(saveHistory = true) {
        if (saveHistory && window.circuit) {
            // Snapshot current state before clearing
            const snapshot = {
                circuitLayer: this.circuitLayer.innerHTML,
                graphDrawings: JSON.parse(JSON.stringify(this.graphDrawings))
            };
            window.circuit.saveHistory('paint_clear', { snapshot }, true);
        }

        // Clear Circuit SVG
        while (this.circuitLayer.firstChild) {
            this.circuitLayer.removeChild(this.circuitLayer.firstChild);
        }

        // Clear Graph Canvas
        this.graphDrawings = [];
        this.renderGraphOverlay();
    }

    // ================== Undo/Redo Helper Methods ==================

    addCircuitShape(data) {
        const shape = this.createSVGShapeFromData(data);
        if (shape) {
            this.circuitLayer.appendChild(shape);
        }
    }

    removeCircuitShape(id) {
        const el = document.getElementById(id);
        if (el && el.parentNode === this.circuitLayer) {
            this.circuitLayer.removeChild(el);
        }
    }

    addGraphShape(data) {
        this.graphDrawings.push(data);
        this.renderGraphOverlay();
    }

    removeGraphShape(id) {
        const index = this.graphDrawings.findIndex(d => d.id === id);
        if (index !== -1) {
            this.graphDrawings.splice(index, 1);
            this.renderGraphOverlay();
        }
    }

    restoreSnapshot(snapshot) {
        if (!snapshot) return;

        // Restore Circuit SVG
        this.circuitLayer.innerHTML = snapshot.circuitLayer;

        // Restore Graph Canvas
        if (snapshot.graphDrawings) {
            this.graphDrawings = JSON.parse(JSON.stringify(snapshot.graphDrawings));
            this.renderGraphOverlay();
        }
    }

    createSVGShapeFromData(data) {
        if (data.type === 'text') {
            const textEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            textEl.setAttribute('id', data.id);
            textEl.setAttribute('x', data.x);
            textEl.setAttribute('y', data.y);
            textEl.setAttribute('fill', data.color);
            textEl.setAttribute('font-size', '14');
            textEl.setAttribute('font-family', 'Inter, sans-serif');

            const lines = data.text.split('\n');
            lines.forEach((line, i) => {
                const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
                tspan.setAttribute('x', data.x);
                tspan.setAttribute('dy', i === 0 ? 0 : '1.2em');
                tspan.textContent = line;
                textEl.appendChild(tspan);
            });
            return textEl;
        }

        let shape = null;
        if (data.type === 'pen') {
            shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            shape.setAttribute('d', data.d);
        } else if (data.type === 'circle') {
            shape = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
            shape.setAttribute('cx', data.cx);
            shape.setAttribute('cy', data.cy);
            shape.setAttribute('rx', data.rx);
            shape.setAttribute('ry', data.ry);
        } else if (data.type === 'rect') {
            shape = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            shape.setAttribute('x', data.x);
            shape.setAttribute('y', data.y);
            shape.setAttribute('width', data.width);
            shape.setAttribute('height', data.height);
        } else if (data.type === 'arrow') {
            shape = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            shape.innerHTML = data.innerHTML; // Simple restoration for group content
        }

        if (shape) {
            shape.setAttribute('id', data.id);
            if (data.fill) shape.setAttribute('fill', data.fill);
            if (data.stroke) shape.setAttribute('stroke', data.stroke);
            if (data.strokeWidth) shape.setAttribute('stroke-width', data.strokeWidth);
        }

        return shape;
    }

    // ================== Circuit Drawing Handlers (SVG) ==================

    handleMouseDown(e, svgPoint) {
        if (!this.activeTool) return;
        // console.log('DrawingManager: handleMouseDown', this.activeTool, e, svgPoint); // Keep debug if needed, or remove
        this.isDrawing = true;
        this.startPos = { x: svgPoint.x, y: svgPoint.y };
        this.context = 'circuit';

        if (this.activeTool === 'text') {
            e.preventDefault(); // Prevent default focus stealing
            this.createTextInput(e.clientX, e.clientY, 'circuit', { svgPoint });
            this.isDrawing = false;
            return;
        }

        if (this.activeTool === 'pen') {
            this.currentShape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            this.currentShape.setAttribute('fill', 'none');
            this.currentShape.setAttribute('stroke', this.currentColor);
            this.currentShape.setAttribute('stroke-width', '2');
            this.currentShape.setAttribute('d', `M ${svgPoint.x} ${svgPoint.y}`);
            this.circuitLayer.appendChild(this.currentShape);
        } else if (this.activeTool === 'circle') {
            this.currentShape = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
            this.currentShape.setAttribute('fill', 'none');
            this.currentShape.setAttribute('stroke', this.currentColor);
            this.currentShape.setAttribute('stroke-width', '2');
            this.currentShape.setAttribute('cx', svgPoint.x);
            this.currentShape.setAttribute('cy', svgPoint.y);
            this.currentShape.setAttribute('rx', 0);
            this.currentShape.setAttribute('ry', 0);
            this.circuitLayer.appendChild(this.currentShape);
        } else if (this.activeTool === 'rect') {
            this.currentShape = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            this.currentShape.setAttribute('fill', 'none');
            this.currentShape.setAttribute('stroke', this.currentColor);
            this.currentShape.setAttribute('stroke-width', '2');
            this.currentShape.setAttribute('x', svgPoint.x);
            this.currentShape.setAttribute('y', svgPoint.y);
            this.currentShape.setAttribute('width', 0);
            this.currentShape.setAttribute('height', 0);
            this.circuitLayer.appendChild(this.currentShape);
        } else if (this.activeTool === 'arrow') {
            // Use Group to hold line and arrowhead path
            this.currentShape = document.createElementNS('http://www.w3.org/2000/svg', 'g');

            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('stroke', this.currentColor);
            line.setAttribute('stroke-width', '2');
            line.setAttribute('x1', svgPoint.x);
            line.setAttribute('y1', svgPoint.y);
            line.setAttribute('x2', svgPoint.x);
            line.setAttribute('y2', svgPoint.y);

            const head = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            head.setAttribute('fill', this.currentColor);
            head.setAttribute('d', ''); // Will be calculated in mousemove

            this.currentShape.appendChild(line);
            this.currentShape.appendChild(head);
            this.circuitLayer.appendChild(this.currentShape);
        }
    }

    handleMouseMove(e, svgPoint) {
        if (!this.activeTool || !this.isDrawing || this.context !== 'circuit' || !this.currentShape) return;

        if (this.activeTool === 'pen') {
            // Append point to path
            const d = this.currentShape.getAttribute('d');
            this.currentShape.setAttribute('d', `${d} L ${svgPoint.x} ${svgPoint.y}`);
        } else if (this.activeTool === 'circle') {
            const rx = Math.abs(svgPoint.x - this.startPos.x);
            const ry = Math.abs(svgPoint.y - this.startPos.y);
            this.currentShape.setAttribute('rx', rx);
            this.currentShape.setAttribute('ry', ry);
        } else if (this.activeTool === 'rect') {
            const x = Math.min(this.startPos.x, svgPoint.x);
            const y = Math.min(this.startPos.y, svgPoint.y);
            const width = Math.abs(svgPoint.x - this.startPos.x);
            const height = Math.abs(svgPoint.y - this.startPos.y);
            this.currentShape.setAttribute('x', x);
            this.currentShape.setAttribute('y', y);
            this.currentShape.setAttribute('width', width);
            this.currentShape.setAttribute('height', height);
        } else if (this.activeTool === 'arrow') {
            const line = this.currentShape.querySelector('line');
            const head = this.currentShape.querySelector('path');

            line.setAttribute('x2', svgPoint.x);
            line.setAttribute('y2', svgPoint.y);

            // Calculate arrowhead
            const x1 = this.startPos.x;
            const y1 = this.startPos.y;
            const x2 = svgPoint.x;
            const y2 = svgPoint.y;

            const headLength = 10;
            const dx = x2 - x1;
            const dy = y2 - y1;
            const angle = Math.atan2(dy, dx);

            // Points for arrowhead
            const arrowX1 = x2 - headLength * Math.cos(angle - Math.PI / 6);
            const arrowY1 = y2 - headLength * Math.sin(angle - Math.PI / 6);
            const arrowX2 = x2 - headLength * Math.cos(angle + Math.PI / 6);
            const arrowY2 = y2 - headLength * Math.sin(angle + Math.PI / 6);

            head.setAttribute('d', `M ${x2} ${y2} L ${arrowX1} ${arrowY1} L ${arrowX2} ${arrowY2} Z`);
        }
    }
    handleMouseUp(e) {
        if (this.context === 'circuit' && this.isDrawing && this.currentShape) {
            this.isDrawing = false;

            // Assign ID
            const id = this.generateId();
            this.currentShape.setAttribute('id', id);

            // Save History
            if (window.circuit) {
                const shapeData = {
                    id: id,
                    type: this.activeTool,
                    color: this.currentColor,
                    stroke: this.currentColor, // Common attribute
                    strokeWidth: '2',          // Common attribute
                    fill: 'none'               // Common attribute (except arrow head)
                };

                if (this.activeTool === 'pen') {
                    shapeData.d = this.currentShape.getAttribute('d');
                } else if (this.activeTool === 'circle') {
                    shapeData.cx = this.currentShape.getAttribute('cx');
                    shapeData.cy = this.currentShape.getAttribute('cy');
                    shapeData.rx = this.currentShape.getAttribute('rx');
                    shapeData.ry = this.currentShape.getAttribute('ry');
                } else if (this.activeTool === 'rect') {
                    shapeData.x = this.currentShape.getAttribute('x');
                    shapeData.y = this.currentShape.getAttribute('y');
                    shapeData.width = this.currentShape.getAttribute('width');
                    shapeData.height = this.currentShape.getAttribute('height');
                } else if (this.activeTool === 'arrow') {
                    // Start arrow is a group
                    shapeData.innerHTML = this.currentShape.innerHTML;
                    // Need to explicitly store attributes if we want to reconstruct cleaner, but innerHTML is easy for Group
                    // For consistency with other shapes, let's keep it simple
                }

                window.circuit.saveHistory('paint_circuit_add', shapeData, true);
            }

            this.currentShape = null;
            this.context = null;
        }
    }

    // ================== Graph Drawing Handlers (Canvas) ==================

    handleGraphMouseDown(e) {
        if (!this.activeTool) return;

        const rect = this.graphOverlay.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        this.isDrawing = true;
        this.startPos = { x, y };
        this.context = 'graph';

        if (this.activeTool === 'pen') {
            this.currentGraphPath = [{ x, y }];
        } else if (this.activeTool === 'text') {
            this.createTextInput(e.clientX, e.clientY, 'graph', { x, y });
            this.isDrawing = false; // Text input is a one-shot action, not a continuous draw
        }
    }

    handleGraphMouseMove(e) {
        if (!this.isDrawing || this.context !== 'graph') return;

        const rect = this.graphOverlay.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (this.activeTool === 'pen') {
            this.currentGraphPath.push({ x, y });
            this.renderGraphOverlay();
        } else {
            // Re-render to show preview shape
            this.renderGraphOverlay();
            const ctx = this.graphOverlay.getContext('2d');
            ctx.strokeStyle = this.currentColor;
            ctx.lineWidth = 2;
            ctx.beginPath();

            if (this.activeTool === 'circle') {
                const rx = Math.abs(x - this.startPos.x);
                const ry = Math.abs(y - this.startPos.y);
                ctx.ellipse(this.startPos.x, this.startPos.y, rx, ry, 0, 0, 2 * Math.PI);
            } else if (this.activeTool === 'rect') {
                const w = x - this.startPos.x;
                const h = y - this.startPos.y;
                ctx.strokeRect(this.startPos.x, this.startPos.y, w, h);
            } else if (this.activeTool === 'arrow') {
                this.drawArrow(ctx, this.startPos.x, this.startPos.y, x, y);
            }
            ctx.stroke();
        }
    }

    handleGraphMouseUp(e) {
        if (this.context !== 'graph') return;

        const rect = this.graphOverlay.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (this.activeTool === 'pen') {
            const data = {
                id: this.generateId(),
                type: 'pen',
                points: [...this.currentGraphPath],
                color: this.currentColor
            };
            this.graphDrawings.push(data);
            if (window.circuit) window.circuit.saveHistory('paint_graph_add', data, true);

        } else if (this.activeTool === 'circle') {
            const data = {
                id: this.generateId(),
                type: 'circle',
                x: this.startPos.x,
                y: this.startPos.y,
                rx: Math.abs(x - this.startPos.x),
                ry: Math.abs(y - this.startPos.y),
                color: this.currentColor
            };
            this.graphDrawings.push(data);
            if (window.circuit) window.circuit.saveHistory('paint_graph_add', data, true);

        } else if (this.activeTool === 'rect') {
            const data = {
                id: this.generateId(),
                type: 'rect',
                x: this.startPos.x,
                y: this.startPos.y,
                w: x - this.startPos.x,
                h: y - this.startPos.y,
                color: this.currentColor
            };
            this.graphDrawings.push(data);
            if (window.circuit) window.circuit.saveHistory('paint_graph_add', data, true);

        } else if (this.activeTool === 'arrow') {
            const data = {
                id: this.generateId(),
                type: 'arrow',
                x1: this.startPos.x,
                y1: this.startPos.y,
                x2: x,
                y2: y,
                color: this.currentColor
            };
            this.graphDrawings.push(data);
            if (window.circuit) window.circuit.saveHistory('paint_graph_add', data, true);
        }

        this.isDrawing = false;
        this.context = null;
        this.renderGraphOverlay();
    }

    renderGraphOverlay() {
        if (!this.graphOverlay) return;
        const ctx = this.graphOverlay.getContext('2d');
        ctx.clearRect(0, 0, this.graphOverlay.width, this.graphOverlay.height);

        this.graphDrawings.forEach(d => {
            ctx.strokeStyle = d.color;
            ctx.fillStyle = d.color;
            ctx.lineWidth = 2;
            ctx.beginPath();

            if (d.type === 'pen') {
                if (d.points.length > 0) {
                    ctx.moveTo(d.points[0].x, d.points[0].y);
                    d.points.forEach(p => ctx.lineTo(p.x, p.y));
                    ctx.stroke();
                }
            } else if (d.type === 'circle') {
                ctx.ellipse(d.x, d.y, d.rx, d.ry, 0, 0, 2 * Math.PI);
                ctx.stroke();
            } else if (d.type === 'rect') {
                ctx.strokeRect(d.x, d.y, d.w, d.h);
            } else if (d.type === 'arrow') {
                this.drawArrow(ctx, d.x1, d.y1, d.x2, d.y2);
                ctx.stroke();
            } else if (d.type === 'text') {
                ctx.font = '14px Inter';
                ctx.textBaseline = 'top'; // Match textarea behavior
                // Handle multi-line text
                const lines = d.text.split('\n');
                lines.forEach((line, i) => {
                    ctx.fillText(line, d.x, d.y + (i * (14 * 1.2))); // Font size * Line Height
                });
            }
        });

        // Draw active pen path (current stroke)
        if (this.isDrawing && this.activeTool === 'pen' && this.currentGraphPath.length > 0) {
            ctx.strokeStyle = this.currentColor;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(this.currentGraphPath[0].x, this.currentGraphPath[0].y);
            this.currentGraphPath.forEach(p => ctx.lineTo(p.x, p.y));
            ctx.stroke();
        }
    }

    drawArrow(ctx, x1, y1, x2, y2) {
        const headLength = 10;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const angle = Math.atan2(dy, dx);

        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);

        // Arrow head
        ctx.lineTo(x2 - headLength * Math.cos(angle - Math.PI / 6), y2 - headLength * Math.sin(angle - Math.PI / 6));
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - headLength * Math.cos(angle + Math.PI / 6), y2 - headLength * Math.sin(angle + Math.PI / 6));
    }

    createTextInput(screenX, screenY, context, data) {
        // Create Textarea for input
        const input = document.createElement('textarea');
        input.className = 'floating-text-input';

        // Basic styles to make it visible and functional
        input.style.position = 'fixed';
        input.style.left = `${screenX}px`;
        input.style.top = `${screenY}px`;
        input.style.zIndex = '10000';
        input.style.background = 'transparent';
        input.style.border = 'none';
        input.style.outline = 'none';
        input.style.color = this.currentColor;
        input.style.caretColor = this.currentColor;
        input.style.padding = '0px';
        input.style.margin = '0px';
        input.style.lineHeight = '1.2';
        input.style.fontFamily = 'Inter, sans-serif';
        input.style.fontSize = '14px';
        input.style.minWidth = '100px';
        input.style.minHeight = '1.5em';
        input.style.overflow = 'hidden';
        input.style.resize = 'none';

        document.body.appendChild(input);

        // Auto focus
        setTimeout(() => input.focus(), 10);

        let isFinished = false;

        const finishInput = () => {
            if (isFinished) return;
            isFinished = true;

            const text = input.value; // Don't trim immediately to allow intentional whitespace if needed, but usually trim is good. Users said "text 입력".
            if (!text.trim()) {
                if (document.body.contains(input)) document.body.removeChild(input);
                return;
            }

            if (context === 'circuit') {
                const lines = text.split('\n');
                const textEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');

                const id = this.generateId();
                textEl.setAttribute('id', id);

                // Use the initial click point
                const x = data.svgPoint ? data.svgPoint.x : 0;
                const y = data.svgPoint ? data.svgPoint.y : 0;

                textEl.setAttribute('x', x);
                textEl.setAttribute('y', y);
                textEl.setAttribute('fill', this.currentColor);
                textEl.setAttribute('font-size', '14');
                textEl.setAttribute('font-family', 'Inter, sans-serif');
                textEl.setAttribute('dominant-baseline', 'hanging'); // Match textarea top alignment

                lines.forEach((line, i) => {
                    const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
                    tspan.setAttribute('x', x);
                    tspan.setAttribute('dy', i === 0 ? 0 : '1.2em');
                    tspan.textContent = line;
                    textEl.appendChild(tspan);
                });

                this.circuitLayer.appendChild(textEl);
                if (window.circuit) {
                    window.circuit.saveHistory('paint_circuit_add', {
                        id: id,
                        type: 'text',
                        x: x,
                        y: y,
                        color: this.currentColor,
                        text: text
                    }, true);
                }

            } else if (context === 'graph') {
                const id = this.generateId();
                const drawingData = {
                    id: id,
                    type: 'text',
                    x: data.x,
                    y: data.y,
                    text: text,
                    color: this.currentColor
                };
                this.graphDrawings.push(drawingData);
                this.renderGraphOverlay();

                if (window.circuit) window.circuit.saveHistory('paint_graph_add', drawingData, true);
            }

            if (document.body.contains(input)) {
                document.body.removeChild(input);
            }
        };

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                if (e.shiftKey) {
                    // Allow default behavior (newline)
                    return;
                } else {
                    e.preventDefault();
                    finishInput();
                }
            } else if (e.key === 'Escape') {
                if (document.body.contains(input)) {
                    document.body.removeChild(input);
                }
            }
        });

        input.addEventListener('blur', () => {
            // When focus is lost, we can either save or cancel. 
            // Usually valid to save unless it was empty.
            finishInput();
        });
    }
}


