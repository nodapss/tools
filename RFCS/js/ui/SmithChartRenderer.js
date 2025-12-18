/**
 * SmithChartRenderer.js
 * Canvas-based Smith Chart renderer for CircuitCalculator
 * Based on RFMController's SmithChart implementation
 */

class SmithChartRenderer {
    constructor(canvasId, markerManager) {
        this.canvas = document.getElementById(canvasId);
        this.markerManager = markerManager;
        if (!this.canvas) {
            console.error('SmithChartRenderer: Canvas not found:', canvasId);
            return;
        }

        this.ctx = this.canvas.getContext('2d');

        // Transform state for zoom/pan
        this.transform = { k: 1, x: 0, y: 0 };
        this.isDragging = false;
        this.lastMouse = { x: 0, y: 0 };

        // Data
        this.matchingRangePaths = [];
        this.loadedMatchingRangePaths = []; // Loaded from CSV
        this.simulationTrace = [];
        this.invertReactance = false;

        // Port Impedance (Target)
        this.portImpedance = { r: 50, x: 0 };

        // Visibility Flags
        this.visible = {
            matchingRange: true,
            loadedMatchingRange: true,
            simulation: true
        };

        // Colors - using CircuitCalculator style
        this.colors = {
            grid: '#444',
            gridMajor: '#555',
            background: '#0d1117',
            rLabels: '#a0a0a0',
            xLabels: '#4fc3f7',
            matchingRange: '#00d4ff', // Cyan
            matchingRangeFill: 'rgba(0, 212, 255, 0.15)',
            loadedMatchingRange: '#ff6b6b', // Red (Distinct color)
            loadedMatchingRangeFill: 'rgba(255, 107, 107, 0.15)',
            trace: '#00ff00',
            highlight: '#00ffff'
        };

        // Highlights from Legend
        this.highlightedDataset = null; // 'matchingRange', 'loadedMatchingRange', 'simulation'

        // Bind events
        this.canvas.addEventListener('wheel', (e) => this.handleWheel(e), { passive: false });
        this.canvas.addEventListener('dblclick', () => this.resetView());
        this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.canvas.addEventListener('contextmenu', (e) => this.handleContextMenu(e));
        window.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        window.addEventListener('mouseup', () => this.handleMouseUp());

        // Initialize canvas
        this.resize();

        // Dynamic Marker Size
        this.markerSize = 4; // Default
        if (this.markerManager) {
            this.markerSize = this.markerManager.markerSize || 4;
            window.addEventListener('marker-size-change', (e) => {
                this.markerSize = e.detail.size;
                this.draw();
            });
        }

        // Use ResizeObserver for more robust resizing (handles sidebar resize)
        this.resizeObserver = new ResizeObserver(() => {
            this.resize();
        });

        if (this.canvas && this.canvas.parentElement) {
            this.resizeObserver.observe(this.canvas.parentElement);
        }

        // Tooltip
        this.initTooltip();
    }

    resize() {
        const parent = this.canvas.parentElement;
        if (!parent) return;

        const dpr = window.devicePixelRatio || 1;
        const rect = parent.getBoundingClientRect();

        const width = Math.max(0, rect.width || 0);
        const height = Math.max(0, rect.height || 0);

        if (width === 0 || height === 0) return;

        // Only update if size changed
        if (this.canvas.width !== width * dpr || this.canvas.height !== height * dpr) {
            this.canvas.width = width * dpr;
            this.canvas.height = height * dpr;

            // Important: Set style to match parent to prevent layout thrashing, 
            // but handle it carefully to avoid infinite resize loops
            this.canvas.style.width = '100%';
            this.canvas.style.height = '100%';

            this.ctx.scale(dpr, dpr);
            this.draw();
        }
    }

    // ============ Coordinate Conversion ============

    gammaToCanvas(gammaR, gammaI) {
        const w = this.canvas.width / (window.devicePixelRatio || 1);
        const h = this.canvas.height / (window.devicePixelRatio || 1);
        const cx = w / 2;
        const cy = h / 2;
        const minDim = Math.min(w, h);
        const r = (minDim / 2) * 0.9;

        const worldX = gammaR * r;
        const worldY = -gammaI * r;

        const scaledX = worldX * this.transform.k;
        const scaledY = worldY * this.transform.k;

        const finalX = scaledX + this.transform.x + cx;
        const finalY = scaledY + this.transform.y + cy;

        return { x: finalX, y: finalY };
    }

    canvasToGamma(x, y) {
        const w = this.canvas.width / (window.devicePixelRatio || 1);
        const h = this.canvas.height / (window.devicePixelRatio || 1);
        const cx = w / 2;
        const cy = h / 2;
        const minDim = Math.min(w, h);
        const r = (minDim / 2) * 0.9;

        const worldX = (x - this.transform.x - cx) / this.transform.k;
        const worldY = (y - this.transform.y - cy) / this.transform.k;

        const gammaR = worldX / r;
        const gammaI = -worldY / r;

        return { gammaR, gammaI };
    }

    // ============ View Controls ============

    resetView() {
        this.transform = { k: 1, x: 0, y: 0 };
        this.draw();
    }

    handleWheel(e) {
        e.preventDefault();

        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const w = rect.width;
        const h = rect.height;
        const cx = w / 2;
        const cy = h / 2;

        const zoomSensitivity = 0.001;
        const delta = -e.deltaY * zoomSensitivity;
        const scaleFactor = 1 + delta;

        const newK = this.transform.k * scaleFactor;

        if (newK < 0.5 || newK > 50) return;

        const worldX = (mouseX - this.transform.x - cx) / this.transform.k;
        const worldY = (mouseY - this.transform.y - cy) / this.transform.k;

        this.transform.x = mouseX - cx - worldX * newK;
        this.transform.y = mouseY - cy - worldY * newK;
        this.transform.k = newK;

        this.draw();
    }

    handleMouseDown(e) {
        // Check if over marker
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (this.markerManager) {
            const markers = this.markerManager.markers.filter(m => m.type === 'Point');
            // Check collision with markers
            for (const m of markers) {
                if (!m.rawGamma) continue;
                const pt = this.gammaToCanvas(m.rawGamma.r, m.rawGamma.i);
                const distSq = (pt.x - x) ** 2 + (pt.y - y) ** 2;
                if (distSq < 100) { // 10px radius
                    this.draggingMarker = m;
                    this.canvas.style.cursor = 'grabbing';
                    return;
                }
            }
        }

        this.isDragging = true;
        this.lastMouse = { x: e.clientX, y: e.clientY };
    }

    handleMouseMove(e) {
        if (this.draggingMarker) {
            const rect = this.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            // Snap Logic
            // Snap Logic
            const nearest = this.findNearestPoint(x, y);
            let gammaR, gammaI;
            let freq = null;

            if (nearest) {
                gammaR = nearest.point.real;
                gammaI = nearest.point.imag;
                if (nearest.point.freq !== undefined && nearest.point.freq !== null) {
                    freq = nearest.point.freq;
                }
            } else {
                const gamma = this.canvasToGamma(x, y);
                gammaR = gamma.gammaR;
                gammaI = gamma.gammaI;
            }

            // Update Marker Data
            const zVal = this.gammaToImpedance(gammaR, gammaI);

            const updates = {
                y: { r: zVal.r, x: zVal.x },
                rawGamma: { r: gammaR, i: gammaI },
                complexData: zVal // Ensure expensive complex data is updated
            };

            if (freq !== null) {
                updates.x = freq;
                updates.unitX = 'Hz';
            } else {
                // Fallback: Set to null so it's hidden in Cartesian
                updates.x = null;
                updates.unitX = '';
            }

            this.markerManager.updateMarker(this.draggingMarker.id, updates);

            this.draw();

        } else if (this.isDragging) {
            const dx = e.clientX - this.lastMouse.x;
            const dy = e.clientY - this.lastMouse.y;

            this.transform.x += dx;
            this.transform.y += dy;

            this.lastMouse = { x: e.clientX, y: e.clientY };
            this.draw();
        } else if (e.target === this.canvas) {
            // Hover cursor change if over marker
            const rect = this.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            let overMarker = false;

            if (this.markerManager) {
                const markers = this.markerManager.markers.filter(m => m.type === 'Point');
                for (const m of markers) {
                    if (!m.rawGamma) continue;
                    const pt = this.gammaToCanvas(m.rawGamma.r, m.rawGamma.i);
                    const distSq = (pt.x - x) ** 2 + (pt.y - y) ** 2;
                    if (distSq < 100) {
                        overMarker = true;
                        break;
                    }
                }
            }
            this.canvas.style.cursor = overMarker ? 'grab' : 'default';

            this.handleTooltipHover(e);
        }
    }

    handleMouseUp() {
        if (this.draggingMarker) {
            this.draggingMarker = null;
            this.canvas.style.cursor = 'grab'; // Remain grab if still over
        }
        this.isDragging = false;
    }

    // ============ Grid Calculation ============

    getGridValues(zoomLevel) {
        let rValues = [0.2, 0.5, 1.0, 2.0, 5.0];
        let xValues = [0.5, 1.0, 2.0];

        if (zoomLevel > 2) {
            rValues = rValues.concat([0.1, 0.3, 0.4, 0.6, 0.7, 0.8, 0.9, 1.2, 1.4, 1.6, 1.8, 3.0, 4.0, 10.0]);
            xValues = xValues.concat([0.2, 0.3, 0.4, 0.6, 0.7, 0.8, 0.9, 1.2, 1.4, 1.6, 1.8, 3.0, 4.0, 5.0]);
        }

        if (zoomLevel > 5) {
            rValues = rValues.concat([0.05, 0.15, 0.25, 0.35, 0.45, 1.1, 1.3, 1.5, 1.7, 1.9, 2.2, 2.4, 2.6, 2.8]);
            xValues = xValues.concat([0.1, 0.15, 0.25, 0.35, 0.45, 1.1, 1.3, 1.5, 1.7, 1.9, 2.5]);
        }

        rValues = [...new Set(rValues)].sort((a, b) => a - b);
        xValues = [...new Set(xValues)].sort((a, b) => a - b);

        let allX = [];
        xValues.forEach(x => {
            allX.push(x);
            allX.push(-x);
        });

        return { r: rValues, x: allX };
    }

    formatNumber(num) {
        return parseFloat(num.toFixed(2)).toString();
    }

    isPointVisible(x, y, w, h) {
        const buffer = 50;
        return x >= -buffer && x <= w + buffer && y >= -buffer && y <= h + buffer;
    }

    // ============ Main Draw Function ============

    draw(highlightPoint = null) {
        if (!this.ctx) return;

        const dpr = window.devicePixelRatio || 1;
        const w = this.canvas.width / dpr;
        const h = this.canvas.height / dpr;
        const ctx = this.ctx;

        const cx = w / 2;
        const cy = h / 2;
        const minDim = Math.min(w, h);
        const r = (minDim / 2) * 0.9;

        // Reset transform
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // Background
        ctx.fillStyle = this.colors.background;
        ctx.fillRect(0, 0, w, h);

        // Apply zoom/pan
        ctx.translate(cx + this.transform.x, cy + this.transform.y);
        ctx.scale(this.transform.k, this.transform.k);

        const baseLineWidth = 1 / this.transform.k;
        const fontSize = 12 / this.transform.k;

        // Draw outer circle (r=0)
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, 2 * Math.PI);
        ctx.strokeStyle = this.colors.gridMajor;
        ctx.lineWidth = 2 * baseLineWidth;
        ctx.stroke();

        // Draw horizontal axis
        ctx.beginPath();
        ctx.moveTo(-r, 0);
        ctx.lineTo(r, 0);
        ctx.strokeStyle = this.colors.gridMajor;
        ctx.lineWidth = 1 * baseLineWidth;
        ctx.stroke();

        // Get dynamic grid values
        const grid = this.getGridValues(this.transform.k);

        // Draw resistance circles
        grid.r.forEach(res => {
            const gr = 1 / (res + 1);
            const gc = res / (res + 1);
            const screenR = gr * r;
            const screenCx = gc * r;

            ctx.beginPath();
            ctx.arc(screenCx, 0, screenR, 0, 2 * Math.PI);
            ctx.strokeStyle = this.colors.grid;
            const isMajor = [0.2, 0.5, 1.0, 2.0, 5.0].includes(res);
            ctx.lineWidth = (isMajor ? 1 : 0.5) * baseLineWidth;
            ctx.stroke();
        });

        // Draw reactance arcs
        grid.x.forEach(xVal => {
            const gr = Math.abs(1 / xVal);
            const gcx = 1;
            const gcy = 1 / xVal;

            const screenR = gr * r;
            const screenCx = gcx * r;
            const screenCy = -gcy * r;

            ctx.save();
            ctx.beginPath();
            ctx.arc(0, 0, r, 0, 2 * Math.PI);
            ctx.clip();

            ctx.beginPath();
            ctx.arc(screenCx, screenCy, screenR, 0, 2 * Math.PI);
            ctx.strokeStyle = this.colors.grid;

            const isMajor = [0.5, 1.0, 2.0, -0.5, -1.0, -2.0].includes(xVal);
            ctx.lineWidth = (isMajor ? 1 : 0.5) * baseLineWidth;

            ctx.stroke();
            ctx.restore();
        });

        // Draw labels
        this.drawLabels(ctx, grid, r, baseLineWidth, fontSize, w, h, cx, cy);

        // 1. Draw Loaded Matching Range (if visible)
        if (this.visible.loadedMatchingRange) {
            this.drawPaths(ctx, this.loadedMatchingRangePaths, r, baseLineWidth,
                this.colors.loadedMatchingRange, this.colors.loadedMatchingRangeFill,
                this.highlightedDataset === 'loadedMatchingRange'); // Is highlighted?
        }

        // 2. Draw Current Matching Range (if visible)
        if (this.visible.matchingRange) {
            this.drawPaths(ctx, this.matchingRangePaths, r, baseLineWidth,
                this.colors.matchingRange, this.colors.matchingRangeFill,
                this.highlightedDataset === 'matchingRange'); // Is highlighted?
        }

        // 3. Draw Simulation Trace (if visible)
        if (this.visible.simulation) {
            this.drawSimulationTrace(ctx, r, baseLineWidth, this.highlightedDataset === 'simulation');
        }

        // 4. Draw Port Impedance Marker (Matching Range Mode)
        if (this.visible.matchingRange) {
            this.drawPortImpedance(ctx, r, baseLineWidth);
        }

        // Draw highlight point
        if (highlightPoint) {
            const hX = highlightPoint.gammaR * r;
            const hY = -highlightPoint.gammaI * r;

            // Fixed screen size (radius 3px)
            // transform.k is the zoom level. Dividing by it counteracts the ctx.scale()
            const pointRadius = 3 / this.transform.k;

            ctx.beginPath();
            ctx.arc(hX, hY, pointRadius, 0, 2 * Math.PI);
            ctx.strokeStyle = this.colors.highlight;
            ctx.lineWidth = 2 * baseLineWidth;
            ctx.stroke();
            ctx.fillStyle = 'rgba(0, 255, 255, 0.4)'; // Slightly more opaque
            ctx.fill();
        }

        this.drawMarkers(ctx);
    }

    drawLabels(ctx, grid, r, baseLineWidth, fontSize, w, h, cx, cy) {
        // R Labels on horizontal axis
        ctx.fillStyle = this.colors.rLabels;
        ctx.font = `${fontSize}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        grid.r.forEach(rVal => {
            const labelGamma = (rVal - 1) / (rVal + 1);
            const labelX = labelGamma * r;
            ctx.fillText(this.formatNumber(rVal * 50), labelX, -10 * baseLineWidth);
        });

        // X Labels on unit circle
        ctx.fillStyle = this.colors.xLabels;
        ctx.font = `italic ${fontSize}px Inter, sans-serif`;

        grid.x.forEach(xVal => {
            if (xVal === 0) return;

            const gReal = (xVal * xVal - 1) / (xVal * xVal + 1);
            const gImag = (2 * xVal) / (xVal * xVal + 1);

            const labelX = gReal * r;
            const labelY = -gImag * r;

            const dist = Math.sqrt(labelX * labelX + labelY * labelY);
            const padding = 15 * baseLineWidth;
            const finalX = (labelX / dist) * (dist + padding);
            const finalY = (labelY / dist) * (dist + padding);

            if (xVal > 0) {
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
            } else {
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
            }

            const xOhms = xVal * 50;
            const labelText = this.formatNumber(xOhms) + 'j';
            ctx.fillText(labelText, finalX, finalY);
        });
    }

    getCornerPoints(points) {
        // For rectangle path, return 4 corners
        if (points.length < 4) return points;

        const step = Math.floor(points.length / 4);
        return [
            points[0],
            points[step],
            points[step * 2],
            points[step * 3]
        ];
    }

    // Generic Path Drawer (Replaces drawMatchingRangePaths)
    drawPaths(ctx, paths, r, baseLineWidth, strokeColor, fillColor, isHighlighted) {
        if (!paths || paths.length === 0) return;

        const lineWidth = isHighlighted ? 4 * baseLineWidth : 2 * baseLineWidth;
        const opacity = isHighlighted ? 1.0 : 0.8;

        paths.forEach(pathData => {
            const points = pathData.points;
            if (!points || points.length === 0) return;

            // Draw filled area
            ctx.beginPath();
            const startX = points[0].real * r;
            const startY = -points[0].imag * r;
            ctx.moveTo(startX, startY);

            for (let i = 1; i < points.length; i++) {
                const pX = points[i].real * r;
                const pY = -points[i].imag * r;
                ctx.lineTo(pX, pY);
            }

            ctx.closePath();
            ctx.fillStyle = fillColor;
            ctx.fill();

            // Draw outline
            ctx.beginPath();
            ctx.moveTo(startX, startY);

            for (let i = 1; i < points.length; i++) {
                const pX = points[i].real * r;
                const pY = -points[i].imag * r;
                ctx.lineTo(pX, pY);
            }

            ctx.closePath();
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = lineWidth;
            ctx.stroke();
        });
    }

    drawSimulationTrace(ctx, r, baseLineWidth, isHighlighted) {
        if (!this.simulationTrace || this.simulationTrace.length === 0) return;

        const lineWidth = isHighlighted ? 4 * baseLineWidth : 2 * baseLineWidth;

        // Draw line
        ctx.beginPath();
        const startX = this.simulationTrace[0].real * r;
        const startY = -this.simulationTrace[0].imag * r;
        ctx.moveTo(startX, startY);

        for (let i = 1; i < this.simulationTrace.length; i++) {
            const pX = this.simulationTrace[i].real * r;
            const pY = -this.simulationTrace[i].imag * r;
            ctx.lineTo(pX, pY);
        }

        ctx.strokeStyle = this.colors.trace;
        ctx.lineWidth = lineWidth;
        ctx.stroke();

        // Draw start point
        const newest = this.simulationTrace[0];
        const nX = newest.real * r;
        const nY = -newest.imag * r;
        ctx.beginPath();
        ctx.arc(nX, nY, 5 * baseLineWidth, 0, 2 * Math.PI);
        ctx.fillStyle = this.colors.trace;
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1 * baseLineWidth;
        ctx.stroke();
    }

    drawPortImpedance(ctx, r, baseLineWidth) {
        if (!this.portImpedance) return;

        // Convert Z -> Gamma
        const gamma = this.impedanceToGamma(this.portImpedance.r, this.portImpedance.x);

        // Convert to Screen Coords (relative to center)
        const x = gamma.gammaR * r;
        const y = -gamma.gammaI * r; // Flip Y for canvas

        const size = 6 * baseLineWidth; // Size scaling

        ctx.beginPath();
        // Inverted Triangle
        // Top Left
        ctx.moveTo(x - size, y - size);
        // Top Right
        ctx.lineTo(x + size, y - size);
        // Bottom Center
        ctx.lineTo(x, y + size);
        ctx.closePath();

        ctx.fillStyle = '#FFFF00'; // Yellow
        ctx.fill();

        ctx.strokeStyle = '#000'; // Black outline for contrast
        ctx.lineWidth = 1 * baseLineWidth;
        ctx.stroke();

        // Draw Impedance Text
        ctx.fillStyle = '#FFFF00'; // Match marker color
        // Adjust font size based on zoom but clamp it so it doesn't get too huge or tiny
        // baseLineWidth = 1 / k. If k is large (zoomed in), baseLineWidth is small.
        // We want constant screen font size roughly, or slightly scaling.
        // The previous usage was `fontSize = 12 / transform.k`.
        const fontSize = 12 / this.transform.k;
        ctx.font = `${fontSize}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';

        const rVal = this.portImpedance.r;
        const xVal = this.portImpedance.x;
        const sign = xVal >= 0 ? '+' : '-';
        const absX = Math.abs(xVal);
        const text = `${rVal.toFixed(2)} ${sign} j${absX.toFixed(2)}`;

        // Position above the triangle
        // The triangle top is at y - size. slightly more padding.
        ctx.fillText(text, x, y - size - (4 * baseLineWidth));
    }

    // ============ Data Methods ============

    setMatchingRangeData(data, invertReactance = false) {
        this.invertReactance = invertReactance;

        if (data && data.paths) {
            this.matchingRangePaths = data.paths;
            // Optionally, if data contains port impedance, set it here
            // this.portImpedance = data.portImpedance || { r: 50, x: 0 };
        } else {
            this.matchingRangePaths = [];
        }

        this.draw();
    }

    setLoadedMatchingRangeData(paths) {
        this.loadedMatchingRangePaths = paths || [];
        this.draw();
    }

    setSimulationTrace(gammaPoints) {
        this.simulationTrace = gammaPoints || [];
        this.draw();
    }

    // ============ Legend Interaction ============

    toggleVisibility(datasetName) {
        if (this.visible.hasOwnProperty(datasetName)) {
            this.visible[datasetName] = !this.visible[datasetName];
            this.draw();
        }
    }

    setHighlightDataset(datasetName) {
        this.highlightedDataset = datasetName;
        this.draw();
    }

    clear() {
        this.matchingRangePaths = [];
        this.loadedMatchingRangePaths = [];
        this.simulationTrace = [];
        this.draw();
    }

    // ============ Tooltip ============

    initTooltip() {
        this.tooltip = document.getElementById('graphTooltip') || document.getElementById('tooltip');
        if (this.tooltip) {
            this.canvas.addEventListener('mouseout', () => this.hideTooltip());
        }
    }

    findNearestPoint(mouseX, mouseY) {
        const threshold = 10; // px
        const thresholdSq = threshold * threshold;

        let nearest = null;
        let minDestSq = Infinity;

        // Helper to check a list of points
        const checkPoints = (points) => {
            if (!points) return;
            for (let i = 0; i < points.length; i++) {
                const p = points[i];
                // Convert to screen space
                const screenPos = this.gammaToCanvas(p.real, p.imag);
                const dx = screenPos.x - mouseX;
                const dy = screenPos.y - mouseY;
                const distSq = dx * dx + dy * dy;

                if (distSq < thresholdSq && distSq < minDestSq) {
                    minDestSq = distSq;
                    nearest = {
                        point: p,
                        screen: screenPos,
                        distSq: distSq
                    };
                }
            }
        };

        // 1. Check Simulation Trace
        if (this.visible.simulation) {
            checkPoints(this.simulationTrace);
        }

        // 2. Check Matching Range Paths
        if (this.visible.matchingRange && this.matchingRangePaths) {
            this.matchingRangePaths.forEach(path => checkPoints(path.points));
        }

        // 3. Check Loaded Matching Range Paths
        if (this.visible.loadedMatchingRange && this.loadedMatchingRangePaths) {
            this.loadedMatchingRangePaths.forEach(path => checkPoints(path.points));
        }

        return nearest;
    }

    // Ray-casting algorithm to check if point is inside polygon
    isPointInPolygon(gammaR, gammaI, paths) {
        if (!paths) return false;

        let inside = false;

        paths.forEach(path => {
            const vs = path.points;
            if (!vs || vs.length < 3) return;

            // Use ray-casting
            for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
                const xi = vs[i].real, yi = vs[i].imag;
                const xj = vs[j].real, yj = vs[j].imag;

                const intersect = ((yi > gammaI) !== (yj > gammaI))
                    && (gammaR < (xj - xi) * (gammaI - yi) / (yj - yi) + xi);
                if (intersect) inside = !inside;
            }
        });

        return inside;
    }

    handleTooltipHover(e) {
        if (!this.tooltip) return;

        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // 0. Check Port Impedance Marker (Yellow Triangle) - Priority Check
        if (this.visible.matchingRange && this.portImpedance) {
            // Convert Port Impedance to Gamma
            const gamma = this.impedanceToGamma(this.portImpedance.r, this.portImpedance.x);
            // Get Screen Position
            const pt = this.gammaToCanvas(gamma.gammaR, gamma.gammaI);

            // Check Collision (Radius ~8px)
            const distSq = (x - pt.x) ** 2 + (y - pt.y) ** 2;
            if (distSq < 64) { // 8px * 8px
                this.showTooltip(rect.left + pt.x, rect.top + pt.y, {
                    r: this.portImpedance.r,
                    x: this.portImpedance.x,
                    mag: Math.sqrt(this.portImpedance.r ** 2 + this.portImpedance.x ** 2),
                    phase: Math.atan2(this.portImpedance.x, this.portImpedance.r) * (180 / Math.PI),
                    gammaR: gamma.gammaR,
                    gammaI: gamma.gammaI
                });
                return;
            }
        }

        // 1. Try to find nearest point (Snap)
        const nearest = this.findNearestPoint(x, y);

        if (nearest) {
            // Snapped behavior
            const p = nearest.point;

            this.draw({ gammaR: p.real, gammaI: p.imag });

            const rVal = this.gammaToImpedance(p.real, p.imag);

            this.showTooltip(rect.left + nearest.screen.x, rect.top + nearest.screen.y, {
                ...rVal,
                gammaR: p.real,
                gammaI: p.imag
            });
            return;
        }

        // 2. If no nearest point, check if inside Matching Range (Free Cursor)
        const gamma = this.canvasToGamma(x, y);
        let isInside = false;

        if (this.visible.matchingRange) {
            isInside = this.isPointInPolygon(gamma.gammaR, gamma.gammaI, this.matchingRangePaths);
        }

        if (isInside) {
            // Free cursor inside polygon
            this.draw({ gammaR: gamma.gammaR, gammaI: gamma.gammaI });

            const rVal = this.gammaToImpedance(gamma.gammaR, gamma.gammaI);

            this.showTooltip(e.clientX, e.clientY, {
                ...rVal,
                gammaR: gamma.gammaR,
                gammaI: gamma.gammaI
            });
            return;
        }

        // 3. Neither -> Hide
        this.hideTooltip();
    }

    gammaToImpedance(gr, gi) {
        const Z0 = 50;
        const denom = (1 - gr) * (1 - gr) + gi * gi;
        const rNorm = (1 - gr * gr - gi * gi) / denom;
        const xNorm = (2 * gi) / denom;

        const rVal = rNorm * Z0;
        const xVal = xNorm * Z0;
        const zMag = Math.sqrt(rVal * rVal + xVal * xVal);
        const zPhase = Math.atan2(xVal, rVal) * (180 / Math.PI);

        return { r: rVal, x: xVal, mag: zMag, phase: zPhase };
    }

    showTooltip(x, y, data) {
        const html = `
            <div style="font-size: 11px; line-height: 1.4;">
                <div><b>Z:</b> ${data.r.toFixed(1)} ${data.x >= 0 ? '+' : ''}${data.x.toFixed(1)}j Ω</div>
                <div><b>|Z|:</b> ${data.mag.toFixed(1)} Ω</div>
                <div><b>∠Z:</b> ${data.phase.toFixed(1)}°</div>
                <div style="color: #888; margin-top: 4px;">
                    <b>Γ:</b> ${data.gammaR.toFixed(3)} ${data.gammaI >= 0 ? '+' : ''}${data.gammaI.toFixed(3)}j
                </div>
            </div>
        `;

        this.tooltip.innerHTML = html;
        this.tooltip.style.display = 'block';
        // Adjust tooltip position to not cover the point
        this.tooltip.style.left = (x + 15) + 'px';
        this.tooltip.style.top = (y + 15) + 'px';
    }

    hideTooltip() {
        if (this.tooltip) {
            this.tooltip.style.display = 'none';
        }
        // Clear highlight point
        this.draw(null);
    }

    impedanceToGamma(r, x) {
        // Normalized Z = (R + jX) / Z0
        // Gamma = (Z_norm - 1) / (Z_norm + 1)

        const Z0 = 50;
        const rNorm = r / Z0;
        const xNorm = x / Z0;

        const den = (rNorm + 1) * (rNorm + 1) + xNorm * xNorm;
        if (den === 0) return { gammaR: 1, gammaI: 0 }; // Short?

        const gr = ((rNorm * rNorm) + (xNorm * xNorm) - 1) / den;
        const gi = (2 * xNorm) / den;

        return { gammaR: gr, gammaI: gi };
    }

    updateMarkerFromValue(id, field, value) {
        if (!this.markerManager) return;
        const marker = this.markerManager.markers.find(m => m.id === id);
        if (!marker) return;

        // Ensure marker has current X/R data
        // marker.x is usually R (Resistance label)
        // marker.y is { r, x }

        let currentR = (typeof marker.y === 'object') ? marker.y.r : (marker.x || 0);
        let currentX = (typeof marker.y === 'object') ? marker.y.x : 0;

        if (field === 'x') {
            // In Matching Range, 'x' field in table is Resistance (Col 3)
            currentR = value;
        } else if (field === 'y') {
            // In Matching Range, 'y' field in table is Reactance (Col 4)
            currentX = value;
        }

        // Calculate new Gamma
        const gamma = this.impedanceToGamma(currentR, currentX);

        // Update Marker
        this.markerManager.updateMarker(id, {
            x: currentR, // X-col is Resistance
            y: { r: currentR, x: currentX }, // Y-col is Complex
            rawGamma: { r: gamma.gammaR, i: gamma.gammaI }
        });

        this.draw();
    }

    // ============ Marker Logic ============

    handleContextMenu(e) {
        e.preventDefault();

        const contextMenu = document.getElementById('graphContextMenu');
        if (!contextMenu) return;

        contextMenu.innerHTML = '';
        const addMenuItem = (text, icon, onClick) => {
            const li = document.createElement('li');
            li.className = 'context-menu-item';
            li.innerHTML = `<span class="icon">${icon}</span> ${text}`;
            li.onclick = (evt) => {
                evt.stopPropagation();
                contextMenu.style.display = 'none';
                onClick();
            };
            contextMenu.appendChild(li);
        };

        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        addMenuItem('Add Marker', '📍', () => {
            this.addMarker(x, y);
        });

        contextMenu.style.display = 'block';
        contextMenu.style.left = `${e.clientX}px`;
        contextMenu.style.top = `${e.clientY}px`;
    }

    addMarker(x, y) {
        if (!this.markerManager) return;

        const nearest = this.findNearestPoint(x, y);
        let gammaR, gammaI;
        let freq = null;

        if (nearest) {
            gammaR = nearest.point.real;
            gammaI = nearest.point.imag;
            // Capture Frequency if available (Passed from SParameterGraph)
            if (nearest.point.freq !== undefined && nearest.point.freq !== null) {
                freq = nearest.point.freq;
            }
        } else {
            const gamma = this.canvasToGamma(x, y);
            gammaR = gamma.gammaR;
            gammaI = gamma.gammaI;
        }

        const zVal = this.gammaToImpedance(gammaR, gammaI);

        // If we have frequency, use it as 'x' (compatible with Cartesian)
        // MarkerManager will display it as 'Resistance' in Smith Mode, but 'Frequency' in Cartesian

        let markerX, unitX;

        if (freq !== null) {
            markerX = freq;
            unitX = 'Hz';
        } else {
            // No frequency (Free Cursor)
            // Fix: Set x to null so it doesn't show up in Cartesian
            markerX = null;
            unitX = ''; // No unit
        }

        this.markerManager.addMarker('Point', {
            x: markerX,
            y: { r: zVal.r, x: zVal.x },
            unitX: unitX,
            unitY: 'Ω',
            rawGamma: { r: gammaR, i: gammaI },
            complexData: zVal
        });

        // Ensure immediate redraw
        this.ctx.save();
        this.draw();
        this.ctx.restore();
    }

    drawMarkers(ctx) {
        if (!this.markerManager) return;
        // Filter removed: Render ALL markers (Cartesian markers have type 'Marker', 'X Marker', etc.)
        const markers = this.markerManager.markers;

        if (markers.length === 0) return;

        // Reset Transform for absolute screen coordinates OR use Gamma to Canvas with current Transform?
        // gammaToCanvas uses current Transform. drawing with those coords under current Transform applies it twice.
        // We should draw using Gamma coordinates directly if we want to honor the transform, OR reset transform.

        // Easier: Reset transform, use gammaToCanvas, then restore.
        // ctx is already transforming in `draw()`. So we must undo it or draw differently.
        const currentTransform = ctx.getTransform();

        const dpr = window.devicePixelRatio || 1;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // Reset to screen space + DPR

        markers.forEach(marker => {
            let gamma = marker.rawGamma;

            // If no rawGamma (e.g. Cartesian Marker), try to calculate from complexData
            if (!gamma) {
                if (marker.complexData) {
                    // complexData is usually {r, x} or {real, imag}
                    const r = marker.complexData.r !== undefined ? marker.complexData.r : marker.complexData.real;
                    const x = marker.complexData.x !== undefined ? marker.complexData.x : marker.complexData.imag;

                    if (r !== undefined && x !== undefined) {
                        gamma = this.impedanceToGamma(r, x);
                    }
                }
                // If still no gamma, try marker.y if it looks like complex data
                else if (typeof marker.y === 'object' && marker.y.r !== undefined && marker.y.x !== undefined) {
                    gamma = this.impedanceToGamma(marker.y.r, marker.y.x);
                }
            }

            // If still no gamma, we cannot draw this marker on Smith Chart
            if (!gamma) return;

            const pt = this.gammaToCanvas(gamma.gammaR || gamma.r, gamma.gammaI || gamma.i);

            ctx.beginPath();
            // Use dynamic marker size
            const radius = this.markerSize || 4;
            ctx.arc(pt.x, pt.y, radius, 0, 2 * Math.PI);
            const markerColor = marker.color || '#ffcc00';
            ctx.fillStyle = markerColor;
            ctx.fill();

            // Highlight if dragging
            if (this.draggingMarker === marker) {
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 2;
            } else {
                ctx.strokeStyle = '#000';
                ctx.lineWidth = 1;
            }
            ctx.stroke();

            ctx.fillStyle = markerColor;

            // Calculate Dynamic Font Sizes based on Marker Size
            const size = this.markerManager.markerSize || 6;
            const scaleDelta = Math.max(0, size - 6);
            const idFontSize = 12 + scaleDelta;
            const valFontSize = 12 + scaleDelta;

            // 1. Label (ID) - Below Marker
            ctx.font = `bold ${idFontSize}px sans-serif`;
            ctx.fillStyle = this.colors.text || '#a0a0a0';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';

            // Position ID below the marker
            // marker.type check for label positioning if needed?
            // Unified positioning for now
            ctx.fillText(marker.id, pt.x, pt.y + radius + 5);

            // 2. Value - Above Marker (if enabled)
            if (this.markerManager.showValueOnMarker) {
                ctx.save();
                ctx.font = `${valFontSize}px sans-serif`;
                ctx.fillStyle = markerColor; // Use marker color for value
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';

                // Get formatted value string
                let displayVal = this.markerManager.getMarkerValueString(marker);

                // For Smith Chart, we might want to show Z value if available
                // But getMarkerValueString likely handles formatted string based on current settings?
                // If Cartesian marker, it shows Y value.
                // Let's stick to default string.

                // Position above the marker (pt.y - radius - padding)
                ctx.fillText(displayVal, pt.x, pt.y - radius - 5);
                ctx.restore();
            }
        });

        // Restore Transform
        ctx.setTransform(currentTransform);
    }

    // ============ Cleanup ============

    destroy() {
        window.removeEventListener('mousemove', this.handleMouseMove);
        window.removeEventListener('mouseup', this.handleMouseUp);

        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
    }
}

// Global export
window.SmithChartRenderer = SmithChartRenderer;

