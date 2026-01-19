/**
 * VirtualCircuitModal.js
 * Modal for viewing the internal "Virtual Circuit" of an Integrated Component.
 */
class VirtualCircuitModal {
    constructor() {
        this.modal = document.getElementById('virtualCircuitModal');
        this.closeBtn = document.getElementById('btnCloseVirtualCircuitModal');
        this.closeBtnFooter = document.getElementById('btnCloseVirtualCircuit');
        this.canvas = document.getElementById('virtualCircuitCanvas');
        this.title = this.modal.querySelector('h3');

        this.setupEventListeners();

        // Current target component
        this.integratedComponent = null;
        // Initialize Interaction State
        this.viewBox = { x: 0, y: 0, w: 800, h: 600 };
        this.isDragging = false;
        this.dragMode = null; // 'pan', 'move'
        this.dragStart = { x: 0, y: 0 };
        this.dragItem = null; // Component or Wire
        this.lastMousePos = { x: 0, y: 0 };

        // Setup Interactive Events
        this.setupInteractiveEvents();

        // Setup Window Dragging
        this.setupDraggable();
    }

    setupDraggable() {
        // Draggable Modal Logic
        const header = this.modal.querySelector('.modal-header');
        const content = this.modal.querySelector('.modal-content');

        if (!header || !content) return;

        let isDraggingWindow = false;
        let startX, startY, initialLeft, initialTop;

        header.addEventListener('mousedown', (e) => {
            // Check if clicking close button
            if (e.target.closest('button')) return;

            isDraggingWindow = true;
            startX = e.clientX;
            startY = e.clientY;

            // Get computed style to handle % or px
            const rect = content.getBoundingClientRect();
            // We want to set style relative to viewport usually, or parent.
            // Since parent is fixed full screen, offsetLeft/Top works relative to it?
            // Actually rect.left/top is relative to viewport.
            // To maintain position, we switch to Px-based positioning after first drag.
            initialLeft = rect.left;
            initialTop = rect.top;

            // Remove transition if any (for smooth resizing, but we don't have it generally)
            content.style.width = getComputedStyle(content).width; // Lock width in px? No, keep % if possible?
            // Dragging usually requires absolute Px.

            // Just use offset logic
            e.preventDefault();
        });

        window.addEventListener('mousemove', (e) => {
            if (!isDraggingWindow) return;
            e.preventDefault();

            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            content.style.left = `${initialLeft + dx}px`;
            content.style.top = `${initialTop + dy}px`;
            // Remove margins if centered by flex/margin
            content.style.margin = '0';
            content.style.transform = 'none'; // Clear any centering transforms
        });

        window.addEventListener('mouseup', () => {
            isDraggingWindow = false;
        });
    }

    setupEventListeners() {
        if (this.closeBtn) {
            this.closeBtn.addEventListener('click', () => this.close());
        }
        if (this.closeBtnFooter) {
            this.closeBtnFooter.addEventListener('click', () => this.close());
        }

        // Close on overlay click
        const overlay = this.modal.querySelector('.modal-overlay');
        if (overlay) {
            overlay.addEventListener('click', () => this.close());
        }

        // Live Sync: Listen for rebuild events
        window.addEventListener('integrated-component-rebuilt', (e) => {
            if (this.integratedComponent && this.integratedComponent.id === e.detail.id) {
                console.log(`[VirtualCircuitModal] Syncing view for ${e.detail.id}`);
                this.render();
            }
        });
    }

    setupInteractiveEvents() {
        const svg = document.getElementById('virtualCircuitCanvas');
        if (!svg) return;

        // Prevent default context menu
        svg.addEventListener('contextmenu', e => e.preventDefault());

        svg.addEventListener('mousedown', e => this.handleMouseDown(e));
        window.addEventListener('mousemove', e => this.handleMouseMove(e));
        window.addEventListener('mouseup', e => this.handleMouseUp(e));
        svg.addEventListener('wheel', e => this.handleWheel(e), { passive: false });
    }

    clientToSvg(x, y) {
        const svg = document.getElementById('virtualCircuitCanvas');
        // Simple manual calculation based on viewBox
        const rect = svg.getBoundingClientRect();
        return {
            x: this.viewBox.x + ((x - rect.left) / rect.width) * this.viewBox.w,
            y: this.viewBox.y + ((y - rect.top) / rect.height) * this.viewBox.h
        };
    }

    snapToGrid(val) {
        return Math.round(val / 20) * 20;
    }

    handleMouseDown(e) {
        const svg = document.getElementById('virtualCircuitCanvas');
        if (e.target.closest('.modal') !== this.modal) return;

        const pt = this.clientToSvg(e.clientX, e.clientY);
        this.dragStart = { x: e.clientX, y: e.clientY };
        this.lastMousePos = pt;

        // Mid/Right click or Space -> Pan
        if (e.button === 1 || e.button === 2 || e.shiftKey) {
            this.isDragging = true;
            this.dragMode = 'pan';
            svg.style.cursor = 'grabbing';
            return;
        }

        if (e.button === 0) {
            // Left click -> Try to grab component
            // Find component under cursor
            const vc = this.integratedComponent.virtualCircuit;
            let hit = null;

            // Check Components
            for (const comp of vc.components.values()) {
                // Simple box hit test (approximate)
                if (Math.abs(comp.x - pt.x) < 20 && Math.abs(comp.y - pt.y) < 20) {
                    hit = comp;
                    break;
                }
            }

            // Check Wires (if no component hit)
            // if (!hit) { check wires... } -> User asked for wire positions too.
            // For now, let's focus on components as they are easier to grab.
            // Wires require line-point distance.

            if (hit) {
                this.isDragging = true;
                this.dragMode = 'move';
                this.dragItem = hit;
                svg.style.cursor = 'move';
            } else {
                // If clicked empty space, Pan
                this.isDragging = true;
                this.dragMode = 'pan';
                svg.style.cursor = 'grabbing';
            }
        }
    }

    handleMouseMove(e) {
        if (!this.isDragging) return;
        const pt = this.clientToSvg(e.clientX, e.clientY);
        const svg = document.getElementById('virtualCircuitCanvas');

        if (this.dragMode === 'pan') {
            const dx = (e.clientX - this.dragStart.x) * (this.viewBox.w / svg.clientWidth);
            const dy = (e.clientY - this.dragStart.y) * (this.viewBox.h / svg.clientHeight);

            this.viewBox.x -= dx;
            this.viewBox.y -= dy;
            this.dragStart = { x: e.clientX, y: e.clientY };
            this.updateViewBox();
        } else if (this.dragMode === 'move' && this.dragItem) {
            const dx = pt.x - this.lastMousePos.x;
            const dy = pt.y - this.lastMousePos.y;

            // Update Item Position (Snap to grid logic?)
            // We accumulate dx/dy or just set to snapped mouse?
            // Better: Snap the Target Position
            const newX = this.snapToGrid(pt.x);
            const newY = this.snapToGrid(pt.y);

            if (newX !== this.dragItem.x || newY !== this.dragItem.y) {
                // Calculate delta for rubberbanding
                const deltaX = newX - this.dragItem.x;
                const deltaY = newY - this.dragItem.y;

                this.dragItem.x = newX;
                this.dragItem.y = newY;

                // Rubberbanding: Move connected wires
                const vc = this.integratedComponent.virtualCircuit;
                vc.wires.forEach(wire => {
                    if (wire.startComponent === this.dragItem.id) {
                        wire.startX += deltaX;
                        wire.startY += deltaY;
                    }
                    if (wire.endComponent === this.dragItem.id) {
                        wire.endX += deltaX;
                        wire.endY += deltaY;
                    }
                });

                this.render(true); // Preserve View
            }
            this.lastMousePos = pt; // Actually used purely for delta? No, snap handles it.
        }
    }

    handleMouseUp(e) {
        if (this.isDragging) {
            this.isDragging = false;
            this.dragItem = null;
            this.dragMode = null;
            const svg = document.getElementById('virtualCircuitCanvas');
            if (svg) svg.style.cursor = 'default';
        }
    }

    handleWheel(e) {
        e.preventDefault();
        const ZoomRate = 1.1;
        const zoom = e.deltaY > 0 ? ZoomRate : 1 / ZoomRate; // Zoom Out : In

        // Zoom relative to mouse
        const rect = document.getElementById('virtualCircuitCanvas').getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Convert mouse screen pos to % of viewBox
        const px = mouseX / rect.width;
        const py = mouseY / rect.height;

        const newW = this.viewBox.w * zoom;
        const newH = this.viewBox.h * zoom;

        // Adjust x/y to keep point under mouse stationary
        this.viewBox.x -= (newW - this.viewBox.w) * px;
        this.viewBox.y -= (newH - this.viewBox.h) * py;
        this.viewBox.w = newW;
        this.viewBox.h = newH;

        this.updateViewBox();
    }

    updateViewBox() {
        const svg = document.getElementById('virtualCircuitCanvas');
        if (svg) {
            svg.setAttribute('viewBox', `${this.viewBox.x} ${this.viewBox.y} ${this.viewBox.w} ${this.viewBox.h}`);

            // Sync Grid Rect
            // Use specific class to be safe
            const bgRect = svg.querySelector('.grid-background');
            if (bgRect) {
                // Large buffer for infinite feel
                const buffer = 50000;
                bgRect.setAttribute('x', this.viewBox.x - buffer);
                bgRect.setAttribute('y', this.viewBox.y - buffer);
                bgRect.setAttribute('width', this.viewBox.w + buffer * 2);
                bgRect.setAttribute('height', this.viewBox.h + buffer * 2);
            }
        }
    }

    open(integratedComponent) {
        this.integratedComponent = integratedComponent;
        if (this.title) {
            this.title.textContent = `Block Circuit View - ${integratedComponent.id}`;
        }

        this.modal.style.display = 'flex';

        // Render and AutoFit initially
        this.render(false);

        console.log(`[VirtualCircuitModal] Opened for ${integratedComponent.id}`);
    }

    close() {
        this.modal.style.display = 'none';
        this.integratedComponent = null;
    }

    render(preserveView = false) {
        if (!this.integratedComponent) return;

        const componentsLayer = document.getElementById('vcComponentsLayer');
        const wiresLayer = document.getElementById('vcWiresLayer');
        const vc = this.integratedComponent.virtualCircuit;

        if (!componentsLayer || !wiresLayer) return;

        // Clear existing
        componentsLayer.innerHTML = '';
        wiresLayer.innerHTML = '';

        // console.log(`[VirtualCircuitModal] Rendering ${vc.components.size} components, ${vc.wires.size} wires`);
        const componentsArray = Array.from(vc.components.values());
        // const types = componentsArray.map(c => c.type);
        // console.log(`  - Component Types: ${types.join(', ')}`);
        // console.log(`  - Component IDs: ${componentsArray.map(c => c.id).join(', ')}`);
        // console.log(`  - Wire Connects: ${Array.from(vc.wires.values()).map(w => `${w.id}(${w.startComponent}->${w.endComponent})`).join(', ')}`);

        // 1. Draw Wires
        vc.wires.forEach(wire => {
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', wire.startX);
            line.setAttribute('y1', wire.startY);
            line.setAttribute('x2', wire.endX);
            line.setAttribute('y2', wire.endY);
            line.setAttribute('stroke', '#00ff00'); // Standard Green
            line.setAttribute('stroke-width', '2');
            wiresLayer.appendChild(line);
        });

        // 2. Draw Components
        // Inject dynamic style if missing (omitted for brevity, assume exists or added)
        if (!document.getElementById('vc-styles')) {
            const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
            style.id = 'vc-styles';
            style.textContent = `
                /* Virtual Circuit Visibility Overrides */
                #virtualCircuitCanvas .terminal { fill: #fff !important; stroke: none !important; }
                #virtualCircuitCanvas text { fill: #fff !important; pointer-events: none; }
                #virtualCircuitCanvas .component-value { fill: #ccc !important; }
                #virtualCircuitCanvas .component-label { fill: #aaa !important; }
            `;
            componentsLayer.appendChild(style);
        }

        vc.components.forEach(comp => {
            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            g.setAttribute('transform', `translate(${comp.x}, ${comp.y}) rotate(${comp.rotation || 0})`);
            g.setAttribute('class', 'circuit-component');
            g.setAttribute('data-type', comp.type);

            if (typeof comp.renderBody === 'function') {
                let innerSVG = comp.renderBody();
                if (typeof comp.renderValue === 'function') innerSVG += comp.renderValue();
                if (typeof comp.renderText === 'function') innerSVG += comp.renderText();
                g.innerHTML = innerSVG;
            } else {
                g.innerHTML = `<rect x="-15" y="-10" width="30" height="20" fill="none" stroke="red" stroke-width="2"/><text x="0" y="0" font-size="10" fill="white">?</text>`;
            }

            g.style.color = 'var(--text-primary, #ffffff)';
            componentsLayer.appendChild(g);
        });

        // Auto-fit ONLY if not preserving view (first open)
        if (!preserveView) {
            this.autoFit(vc);
        }
    }

    autoFit(vc) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        if (vc.components.size === 0 && vc.wires.size === 0) {
            // Default view if empty
            this.viewBox = { x: -400, y: -300, w: 800, h: 600 };
            this.updateViewBox();
            return;
        }

        vc.components.forEach(c => {
            minX = Math.min(minX, c.x - 30);
            maxX = Math.max(maxX, c.x + 30);
            minY = Math.min(minY, c.y - 30);
            maxY = Math.max(maxY, c.y + 30);
        });

        vc.wires.forEach(w => {
            minX = Math.min(minX, w.startX, w.endX);
            maxX = Math.max(maxX, w.startX, w.endX);
            minY = Math.min(minY, w.startY, w.endY);
            maxY = Math.max(maxY, w.startY, w.endY);
        });

        if (minX === Infinity) return;

        const width = maxX - minX;
        const height = maxY - minY;
        const padding = 100;

        this.viewBox.x = minX - padding;
        this.viewBox.y = minY - padding;
        this.viewBox.w = width + padding * 2;
        this.viewBox.h = height + padding * 2;

        this.updateViewBox();
    }

    clearCanvas() {
        // Reset layers
        const layers = ['vcWiresLayer', 'vcComponentsLayer'];
        layers.forEach(id => {
            const g = document.getElementById(id);
            if (g) g.innerHTML = '';
        });
    }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    window.virtualCircuitModal = new VirtualCircuitModal();
});
