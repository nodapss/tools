/**
 * Canvas Manager
 * Handles SVG canvas rendering, zoom, pan, and grid
 */
class CanvasManager {
    constructor(svgElement, circuit) {
        this.svg = svgElement;
        this.circuit = circuit;

        // Layers
        this.wiresLayer = document.getElementById('wiresLayer');
        this.componentsLayer = document.getElementById('componentsLayer');
        this.overlayLayer = document.getElementById('overlayLayer');
        this.gridBackground = this.svg.querySelector('.grid-background');

        // View transform
        this.viewBox = { x: 0, y: 0, width: 800, height: 600 };
        this.zoom = 1;
        this.minZoom = 0.25;
        this.maxZoom = 4;

        // Pan state
        this.isPanning = false;
        this.panStart = { x: 0, y: 0 };

        // Grid settings
        this.gridSize = 20;
        this.showGrid = true;

        // Initialize
        this.init();

        // Tooltip state
        this.tooltipTimer = null;
        this.hoveredComponent = null;
        this.tooltipElement = document.getElementById('tooltip');
    }

    /**
     * Initialize canvas
     */
    init() {
        this.updateViewBox();
        this.bindEvents();
        this.updateZoomDisplay();
        this.updateGrid();
    }

    /**
     * Update grid visibility and size based on zoom level (LOD)
     */
    updateGrid() {
        const zoom = this.zoom;
        const opacity = Math.min(1, Math.max(0, (zoom - 0.4) / 0.2));

        // Scale compensation for small dots when zoomed out
        // keeps them visible (approx 1.5px screen size min)
        const scaleCompensate = zoom < 1 ? (1 / zoom) : 1;

        const minorSize = 1.0 * scaleCompensate;
        const majorSize = 1.5 * scaleCompensate;

        this.svg.style.setProperty('--grid-minor-opacity', opacity);
        this.svg.style.setProperty('--grid-minor-size', `${minorSize}px`);
        this.svg.style.setProperty('--grid-major-size', `${majorSize}px`);
    }

    /**
     * Bind mouse and keyboard events
     */
    bindEvents() {
        // Mouse wheel zoom
        this.svg.addEventListener('wheel', (e) => this.handleWheel(e), { passive: false });

        // Component Hover Tooltip (Delegate to components layer)
        this.componentsLayer.addEventListener('mouseover', (e) => this.handleComponentHover(e));
        this.componentsLayer.addEventListener('mouseout', (e) => this.handleComponentLeave(e));

        // Pan with middle mouse or space+drag
        this.svg.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        window.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        window.addEventListener('mouseup', (e) => this.handleMouseUp(e));

        // Track mouse position
        this.svg.addEventListener('mousemove', (e) => this.updateCursorPosition(e));

        // Keyboard shortcuts
        window.addEventListener('keydown', (e) => this.handleKeyDown(e));
        window.addEventListener('keyup', (e) => this.handleKeyUp(e));

        // Resize
        window.addEventListener('resize', () => this.handleResize());

        // Initial size
        this.handleResize();
    }

    /**
     * Handle mouse wheel for zoom
     */
    handleWheel(e) {
        this.hideTooltip(); // Hide tooltip on zoom
        e.preventDefault();

        // Convert to SVG coordinates
        const svgPoint = this.clientToSvg(e.clientX, e.clientY);

        // Calculate zoom
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * delta));

        if (newZoom !== this.zoom) {
            window.inlineSlider?.hide();
            // Zoom towards mouse position
            const scale = this.zoom / newZoom;

            this.viewBox.x = svgPoint.x - (svgPoint.x - this.viewBox.x) * scale;
            this.viewBox.y = svgPoint.y - (svgPoint.y - this.viewBox.y) * scale;
            this.viewBox.width *= scale;
            this.viewBox.height *= scale;

            this.zoom = newZoom;
            this.updateViewBox();
            this.updateViewBox();
            this.updateZoomDisplay();
            this.updateGrid();
        }
    }

    /**
     * Handle mouse down for pan
     */
    handleMouseDown(e) {
        // If ValueEditor is open, commit changes first
        if (window.valueEditor && window.valueEditor.element.style.display !== 'none') {
            window.valueEditor.commit();
        }

        // Middle mouse button or space key held, or Left click when no tool selected
        // Note: We check window.dragDropHandler directly as it might not be passed in constructor or might be circular dependency if we try to inject it.
        const noToolSelected = window.dragDropHandler && !window.dragDropHandler.mode;

        // NEW: Check if Drawing Tool is active
        if (window.drawingManager && window.drawingManager.activeTool) {
            const svgPoint = this.clientToSvg(e.clientX, e.clientY);
            window.drawingManager.handleMouseDown(e, svgPoint);
            return; // Stop propagation to Pan/Select
        }

        if (e.button === 1 || (e.button === 0 && (this.shiftPressed || noToolSelected))) {
            e.preventDefault();
            this.hideTooltip(); // Hide tooltip on pan
            this.isPanning = true;
            this.panStart = { x: e.clientX, y: e.clientY };
            this.svg.classList.add('panning');
            window.inlineSlider?.hide();
        }
    }

    /**
     * Handle mouse move for pan
     */
    handleMouseMove(e) {
        if (window.drawingManager && window.drawingManager.isDrawing && window.drawingManager.context === 'circuit') {
            const svgPoint = this.clientToSvg(e.clientX, e.clientY);
            window.drawingManager.handleMouseMove(e, svgPoint);
            return;
        }

        if (this.isPanning) {
            const dx = (e.clientX - this.panStart.x) / this.zoom;
            const dy = (e.clientY - this.panStart.y) / this.zoom;

            this.viewBox.x -= dx;
            this.viewBox.y -= dy;

            this.panStart = { x: e.clientX, y: e.clientY };
            this.updateViewBox();
        }
    }

    /**
     * Handle mouse up
     */
    handleMouseUp(e) {
        if (window.drawingManager && window.drawingManager.isDrawing) {
            window.drawingManager.handleMouseUp(e);
        }

        if (this.isPanning) {
            this.isPanning = false;
            this.svg.classList.remove('panning');
        }
    }

    /**
     * Handle keyboard events
     */
    handleKeyDown(e) {
        // Panning with Shift
        if (e.key === 'Shift' && !this.shiftPressed) {
            this.shiftPressed = true;
            this.svg.style.cursor = 'grab';
        }

        // Zoom shortcuts
        if (e.ctrlKey || e.metaKey) {
            if (e.key === '=' || e.key === '+') {
                e.preventDefault();
                this.zoomIn();
            } else if (e.key === '-') {
                e.preventDefault();
                this.zoomOut();
            } else if (e.key === '0') {
                e.preventDefault();
                this.resetView();
            }
        }
    }

    handleKeyUp(e) {
        if (e.key === 'Shift') {
            this.shiftPressed = false;
            if (!this.isPanning) {
                this.svg.style.cursor = '';
            }
        }
    }

    /**
     * Handle window resize
     */
    handleResize() {
        if (!this.svg || !this.svg.parentElement) return;

        const rect = this.svg.parentElement.getBoundingClientRect();

        // Guard against zero size (e.g. hidden element) to avoid NaN
        if (rect.width === 0 || rect.height === 0) return;

        const aspectRatio = this.viewBox.width / this.viewBox.height;

        // Maintain aspect ratio
        if (rect.width / rect.height > aspectRatio) {
            this.viewBox.height = rect.height / this.zoom;
            this.viewBox.width = this.viewBox.height * (rect.width / rect.height);
        } else {
            this.viewBox.width = rect.width / this.zoom;
            this.viewBox.height = this.viewBox.width / (rect.width / rect.height);
        }

        this.updateViewBox();
    }

    /**
     * Update SVG viewBox attribute
     */
    /**
     * Update grid background rect to match viewBox (Infinite Grid)
     */
    updateGridRect() {
        if (this.gridBackground) {
            // Add a large buffer to avoid edge artifacts
            const buffer = 5000;
            this.gridBackground.setAttribute('x', this.viewBox.x - buffer);
            this.gridBackground.setAttribute('y', this.viewBox.y - buffer);
            this.gridBackground.setAttribute('width', this.viewBox.width + buffer * 2);
            this.gridBackground.setAttribute('height', this.viewBox.height + buffer * 2);
        }
    }

    /**
     * Update SVG viewBox attribute
     */
    updateViewBox() {
        // Guard against NaN
        if (isNaN(this.viewBox.x) || isNaN(this.viewBox.y) ||
            isNaN(this.viewBox.width) || isNaN(this.viewBox.height)) {
            // Restore default if corrupted
            console.warn('CanvasManager: ViewBox NaN detected, resetting to default.');
            this.viewBox = { x: 0, y: 0, width: 800, height: 600 };
            this.zoom = 1;
        }

        this.svg.setAttribute('viewBox',
            `${this.viewBox.x} ${this.viewBox.y} ${this.viewBox.width} ${this.viewBox.height}`);
        this.updateGridRect();
    }

    /**
     * Update zoom level display
     */
    updateZoomDisplay() {
        const zoomEl = document.getElementById('zoomLevel');
        if (zoomEl) {
            zoomEl.textContent = `${Math.round(this.zoom * 100)}%`;
        }
    }

    /**
     * Update cursor position display
     */
    updateCursorPosition(e) {
        const svgPoint = this.clientToSvg(e.clientX, e.clientY);

        const posEl = document.getElementById('cursorPos');
        if (posEl) {
            const snappedX = Math.round(svgPoint.x / this.gridSize) * this.gridSize;
            const snappedY = Math.round(svgPoint.y / this.gridSize) * this.gridSize;
            posEl.textContent = `X: ${snappedX}, Y: ${snappedY}`;
        }
    }

    /**
     * Convert client (screen) coordinates to SVG coordinates
     * Uses getScreenCTM() for accurate transformation considering viewBox and preserveAspectRatio
     */
    clientToSvg(clientX, clientY) {
        const point = this.svg.createSVGPoint();
        point.x = clientX;
        point.y = clientY;

        const ctm = this.svg.getScreenCTM();
        if (ctm) {
            const inverseCTM = ctm.inverse();
            const svgPoint = point.matrixTransform(inverseCTM);
            return { x: svgPoint.x, y: svgPoint.y };
        }

        // Fallback to manual calculation
        const rect = this.svg.getBoundingClientRect();
        return {
            x: this.viewBox.x + (clientX / rect.width) * this.viewBox.width,
            y: this.viewBox.y + (clientY / rect.height) * this.viewBox.height
        };
    }

    /**
     * Convert SVG coordinates to client coordinates
     */
    svgToClient(svgX, svgY) {
        const rect = this.svg.getBoundingClientRect();
        return {
            x: ((svgX - this.viewBox.x) / this.viewBox.width) * rect.width,
            y: ((svgY - this.viewBox.y) / this.viewBox.height) * rect.height
        };
    }

    /**
     * Snap coordinate to grid
     */
    snapToGrid(value) {
        return Math.round(value / this.gridSize) * this.gridSize;
    }

    /**
     * Zoom in
     */
    zoomIn() {
        this.setZoom(this.zoom * 1.2);
    }

    /**
     * Zoom out
     */
    zoomOut() {
        this.setZoom(this.zoom / 1.2);
    }

    /**
     * Set zoom level
     */
    setZoom(newZoom) {
        newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, newZoom));

        if (newZoom !== this.zoom) {
            const centerX = this.viewBox.x + this.viewBox.width / 2;
            const centerY = this.viewBox.y + this.viewBox.height / 2;

            const scale = this.zoom / newZoom;
            this.viewBox.width *= scale;
            this.viewBox.height *= scale;

            this.viewBox.x = centerX - this.viewBox.width / 2;
            this.viewBox.y = centerY - this.viewBox.height / 2;

            this.zoom = newZoom;
            this.updateViewBox();
            this.updateViewBox();
            this.updateZoomDisplay();
            this.updateGrid();
        }
    }

    /**
     * Reset view to default
     */
    resetView() {
        this.zoom = 1;
        this.viewBox = { x: 0, y: 0, width: 800, height: 600 };
        this.handleResize();
        this.handleResize();
        this.updateZoomDisplay();
        this.updateGrid();
    }

    /**
     * Center view on point
     */
    centerOn(x, y) {
        this.viewBox.x = x - this.viewBox.width / 2;
        this.viewBox.y = y - this.viewBox.height / 2;
        this.updateViewBox();
    }

    /**
     * Fit all components in view
     */
    fitToContent() {
        const components = this.circuit.getAllComponents();
        const wires = this.circuit.getAllWires();

        if (components.length === 0 && wires.length === 0) {
            this.resetView();
            return;
        }

        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        components.forEach(comp => {
            minX = Math.min(minX, comp.x - 50);
            minY = Math.min(minY, comp.y - 50);
            maxX = Math.max(maxX, comp.x + 50);
            maxY = Math.max(maxY, comp.y + 50);
        });

        wires.forEach(wire => {
            minX = Math.min(minX, wire.startX, wire.endX);
            minY = Math.min(minY, wire.startY, wire.endY);
            maxX = Math.max(maxX, wire.startX, wire.endX);
            maxY = Math.max(maxY, wire.startY, wire.endY);
        });

        const padding = 50;
        const contentWidth = maxX - minX + padding * 2;
        const contentHeight = maxY - minY + padding * 2;

        const rect = this.svg.getBoundingClientRect();
        const scaleX = rect.width / contentWidth;
        const scaleY = rect.height / contentHeight;
        // Limit max zoom to 100% (1.0)
        const scale = Math.min(scaleX, scaleY, 1.0);

        this.zoom = scale;
        this.viewBox.width = rect.width / scale;
        this.viewBox.height = rect.height / scale;
        this.viewBox.x = minX - padding - (this.viewBox.width - contentWidth) / 2;
        this.viewBox.y = minY - padding - (this.viewBox.height - contentHeight) / 2;

        this.updateViewBox();
        this.updateViewBox();
        this.updateZoomDisplay();
        this.updateGrid();
    }

    /**
     * Render all components
     */
    renderComponents() {
        // Clear layers
        this.componentsLayer.innerHTML = '';
        this.wiresLayer.innerHTML = '';

        // Render wires first (behind components)
        this.circuit.getAllWires().forEach(wire => {
            const element = wire.render();
            this.wiresLayer.appendChild(element);
        });

        // Render components
        this.circuit.getAllComponents().forEach(component => {
            const element = component.render();
            this.componentsLayer.appendChild(element);
        });
    }

    /**
     * Add component element to canvas
     */
    addComponentElement(element) {
        this.componentsLayer.appendChild(element);
    }

    /**
     * Add wire element to canvas
     */
    addWireElement(element) {
        this.wiresLayer.appendChild(element);
    }

    /**
     * Remove element from canvas
     */
    removeElement(element) {
        if (element && element.parentNode) {
            element.parentNode.removeChild(element);
        }
    }

    /**
     * Add overlay element (temporary visuals)
     */
    addOverlay(element) {
        this.overlayLayer.appendChild(element);
    }

    /**
     * Clear overlay layer
     */
    clearOverlay() {
        this.overlayLayer.innerHTML = '';
    }

    /**
     * Create snap indicator at position
     */
    showSnapIndicator(x, y) {
        this.clearOverlay();
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('class', 'snap-indicator');
        circle.setAttribute('cx', x);
        circle.setAttribute('cy', y);
        circle.setAttribute('r', 6);
        this.overlayLayer.appendChild(circle);
    }

    /**
     * Hide snap indicator
     */
    hideSnapIndicator() {
        this.clearOverlay();
    }

    /**
     * Handle component hover for tooltip
     */
    handleComponentHover(e) {
        const componentGroup = e.target.closest('.circuit-component');
        if (!componentGroup) return;

        const componentId = componentGroup.dataset.id;

        // If already hovering this component, do nothing
        if (this.hoveredComponent === componentId) return;

        // Switched to a new component?
        if (this.hoveredComponent) {
            this.hideTooltip();
        }

        this.hoveredComponent = componentId;

        // Start timer
        this.tooltipTimer = setTimeout(() => {
            if (this.hoveredComponent === componentId) {
                this.showComponentTooltip(componentId, componentGroup);
            }
        }, 1200);
    }

    /**
     * Handle component leave
     */
    handleComponentLeave(e) {
        const componentGroup = e.target.closest('.circuit-component');
        if (!componentGroup) return;

        // Check if we moved to a child element (bubbling)
        if (e.relatedTarget && componentGroup.contains(e.relatedTarget)) {
            return;
        }

        // Actually left the component
        if (this.hoveredComponent === componentGroup.dataset.id) {
            this.hoveredComponent = null;
            this.hideTooltip();
        }
    }

    /**
     * Show tooltip with impedance info
     */
    showComponentTooltip(compId, element) {
        // Access global controllers
        const gc = window.graphController;
        const circuit = this.circuit;

        if (!gc || !gc.sParamGraph) return;

        // Check measurement type (S-param or Impedance or Matching Range)
        const allowedMeas = ['S11', 'S21', 'S12', 'S22', 'impedance', 'matchingRange'];
        if (!allowedMeas.includes(gc.settings.meas)) return;

        // Prepare data list (Markers or Single Target Frequency)
        let dataList = [];

        if (gc.settings.meas === 'matchingRange') {
            const freq = gc.settings.matchingRange?.frequency;
            if (freq) {
                dataList.push({ id: 'Target', x: freq });
            }
        } else {
            // Standard markers
            const markers = gc.sParamGraph.markerManager?.markers;
            if (markers && markers.length > 0) {
                dataList = markers;
            }
        }

        if (dataList.length === 0) return;

        // Check component type
        const component = circuit.getComponent(compId);
        if (!component || !['C', 'L'].includes(component.type)) return;

        // Build Content
        let content = `
            <div class="tooltip-grid">
                <div class="tooltip-header">ID</div>
                <div class="tooltip-header align-right">Freq</div>
                <div class="tooltip-header align-right">Imp</div>
        `;

        dataList.forEach(item => {
            const freq = item.x;
            let impStr = '';

            if (component.type === 'C') {
                const cVal = component.params.capacitance;
                if (cVal > 0 && freq > 0) {
                    const xc = -1 / (2 * Math.PI * freq * cVal);
                    // Format: 0 - jX
                    impStr = `-j${this.formatNumber(Math.abs(xc))} Ω`;
                } else {
                    impStr = 'Open';
                }
            } else if (component.type === 'L') {
                const lVal = component.params.inductance;
                const xl = 2 * Math.PI * freq * lVal;
                // Format: jX
                impStr = `j${this.formatNumber(xl)} Ω`;
            }

            const freqStr = window.Component.formatValue(freq, 'Hz');

            content += `
                <div class="tooltip-cell">${item.id}</div>
                <div class="tooltip-cell align-right">${freqStr}</div>
                <div class="tooltip-cell align-right">${impStr}</div>
            `;
        });

        content += '</div>';

        // Render Tooltip
        this.tooltipElement.innerHTML = content;
        this.tooltipElement.style.display = 'block';

        // Position
        const rect = element.getBoundingClientRect();

        // Center horizontally above component
        // Note: rect is relative to viewport, which is what we want for fixed/absolute tooltip usually
        // But layout.css might define .tooltip positioning context.
        // Assuming body or .app-container context.

        const tooltipRect = this.tooltipElement.getBoundingClientRect();
        const left = rect.left + (rect.width - tooltipRect.width) / 2;
        const top = rect.top - tooltipRect.height - 8; // 8px padding

        this.tooltipElement.style.left = `${left}px`;
        this.tooltipElement.style.top = `${top}px`;
    }

    formatNumber(num) {
        if (num >= 1000 || num < 0.01) return num.toExponential(2);
        return num.toFixed(2);
    }

    hideTooltip() {
        if (this.tooltipTimer) {
            clearTimeout(this.tooltipTimer);
            this.tooltipTimer = null;
        }
        if (this.tooltipElement) {
            this.tooltipElement.style.display = 'none';
        }
    }
}

window.CanvasManager = CanvasManager;


