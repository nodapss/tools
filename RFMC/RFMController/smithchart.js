class SmithChart {
    constructor(canvasId) {
        this.inputPoints = [];
        this.outputPoints = [];
        this.settings = {
            showInput: true,
            showOutput: false,
            traceLength: 1,
            traceMode: 'points', // 'points' or 'line'
            showVswrStart: false,   // Show Start VSWR circle
            showVswrStop: true,     // Show Stop VSWR circle
            showVswrRestart: false, // Show Restart VSWR circle
            vswrStart: 1.04,        // Start matching threshold
            vswrStop: 1.02,         // Stop matching threshold
            vswrRestart: 1.04       // Restart matching threshold
        };
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');

        // Transform state
        this.transform = { k: 1, x: 0, y: 0 };
        this.isDragging = false;
        this.lastMouse = { x: 0, y: 0 };

        // Bind events
        this.canvas.addEventListener('wheel', (e) => this.handleWheel(e), { passive: false });
        this.canvas.addEventListener('dblclick', () => this.resetView());
        this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        window.addEventListener('mousemove', (e) => this.handleMouseMove(e)); // Window for drag
        window.addEventListener('mouseup', () => this.handleMouseUp());

        // Initial resize
        this.resize();
        window.addEventListener('resize', () => this.resize());

        this.initTooltip();
        this.lastClosest = null;
    }

    resize() {
        const parent = this.canvas.parentElement;
        if (!parent) return;
        
        const dpr = window.devicePixelRatio || 1;

        // Use full container size
        const rect = parent.getBoundingClientRect();
        
        // Safety check: ensure valid dimensions
        const width = Math.max(0, rect.width || 0);
        const height = Math.max(0, rect.height || 0);
        
        // Skip resize if dimensions are invalid
        if (width === 0 || height === 0) return;

        this.canvas.width = width * dpr;
        this.canvas.height = height * dpr;

        this.canvas.style.width = `${width}px`;
        this.canvas.style.height = `${height}px`;

        this.ctx.scale(dpr, dpr);
        this.draw();
    }

    updateSettings(newSettings) {
        this.settings = { ...this.settings, ...newSettings };
        this.draw();
    }

    // Convert Gamma (Reflection Coefficient) to Canvas Coordinates
    gammaToCanvas(gammaR, gammaI) {
        const w = this.canvas.width / (window.devicePixelRatio || 1);
        const h = this.canvas.height / (window.devicePixelRatio || 1);
        const cx = w / 2;
        const cy = h / 2;
        const minDim = Math.min(w, h);
        const r = (minDim / 2) * 0.9; // 90% padding base radius

        // Center of chart in "World" coords (relative to canvas center)
        const worldX = gammaR * r;
        const worldY = -gammaI * r;

        // Apply Scale
        const scaledX = worldX * this.transform.k;
        const scaledY = worldY * this.transform.k;

        // Apply Pan and Center Offset
        const finalX = scaledX + this.transform.x + cx;
        const finalY = scaledY + this.transform.y + cy;

        return { x: finalX, y: finalY };
    }

    // Inverse: Canvas to Gamma
    canvasToGamma(x, y) {
        const w = this.canvas.width / (window.devicePixelRatio || 1);
        const h = this.canvas.height / (window.devicePixelRatio || 1);
        const cx = w / 2;
        const cy = h / 2;
        const minDim = Math.min(w, h);
        const r = (minDim / 2) * 0.9;

        // Mouse = (World * k) + Trans + Center
        // World = (Mouse - Trans - Center) / k

        const worldX = (x - this.transform.x - cx) / this.transform.k;
        const worldY = (y - this.transform.y - cy) / this.transform.k;

        // World = gammaR * r, -gammaI * r
        const gammaR = worldX / r;
        const gammaI = -worldY / r;

        return { gammaR, gammaI };
    }

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

        // Zoom factor
        const zoomSensitivity = 0.001;
        const delta = -e.deltaY * zoomSensitivity;
        const scaleFactor = 1 + delta;

        const newK = this.transform.k * scaleFactor;

        // Limit zoom
        if (newK < 0.5 || newK > 50) return;

        // Zoom towards mouse logic
        const worldX = (mouseX - this.transform.x - cx) / this.transform.k;
        const worldY = (mouseY - this.transform.y - cy) / this.transform.k;

        this.transform.x = mouseX - cx - worldX * newK;
        this.transform.y = mouseY - cy - worldY * newK;
        this.transform.k = newK;

        this.draw();
    }

    handleMouseDown(e) {
        this.isDragging = true;
        this.lastMouse = { x: e.clientX, y: e.clientY };
    }

    handleMouseMove(e) {
        if (this.isDragging) {
            const dx = e.clientX - this.lastMouse.x;
            const dy = e.clientY - this.lastMouse.y;

            this.transform.x += dx;
            this.transform.y += dy;

            this.lastMouse = { x: e.clientX, y: e.clientY };
            this.draw();
        } else {
            // Tooltip logic (only if on canvas)
            if (e.target === this.canvas) {
                this.handleTooltipHover(e);
            }
        }
    }

    handleMouseUp() {
        this.isDragging = false;
    }

    getGridValues(zoomLevel) {
        // Base values
        let rValues = [0.2, 0.5, 1.0, 2.0, 5.0];
        let xValues = [0.5, 1.0, 2.0];

        // Level 1 Detail (Zoom > 2)
        if (zoomLevel > 2) {
            rValues = rValues.concat([0.1, 0.3, 0.4, 0.6, 0.7, 0.8, 0.9, 1.2, 1.4, 1.6, 1.8, 3.0, 4.0, 10.0]);
            xValues = xValues.concat([0.2, 0.3, 0.4, 0.6, 0.7, 0.8, 0.9, 1.2, 1.4, 1.6, 1.8, 3.0, 4.0, 5.0]);
        }

        // Level 2 Detail (Zoom > 5)
        if (zoomLevel > 5) {
            rValues = rValues.concat([0.05, 0.15, 0.25, 0.35, 0.45, 1.1, 1.3, 1.5, 1.7, 1.9, 2.2, 2.4, 2.6, 2.8]);
            xValues = xValues.concat([0.1, 0.15, 0.25, 0.35, 0.45, 1.1, 1.3, 1.5, 1.7, 1.9, 2.5]);
        }

        // Sort and unique
        rValues = [...new Set(rValues)].sort((a, b) => a - b);
        xValues = [...new Set(xValues)].sort((a, b) => a - b);

        // Add negatives for X
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

    // Check if a point is within the visible canvas area
    isPointVisible(x, y, w, h) {
        const buffer = 50; // Increased buffer to prevent premature culling
        return x >= -buffer && x <= w + buffer && y >= -buffer && y <= h + buffer;
    }

    draw(highlightPoint = null) {
        const dpr = window.devicePixelRatio || 1;
        const w = this.canvas.width / dpr;
        const h = this.canvas.height / dpr;
        const ctx = this.ctx;

        const cx = w / 2;
        const cy = h / 2;
        const minDim = Math.min(w, h);
        const r = (minDim / 2) * 0.9;

        // Reset Transform to Identity
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        // Apply Zoom/Pan for Geometry
        ctx.translate(cx + this.transform.x, cy + this.transform.y);
        ctx.scale(this.transform.k, this.transform.k);

        const baseLineWidth = 1 / this.transform.k;
        const fontSize = 12 / this.transform.k;

        // Draw Outer Circle (r=0)
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, 2 * Math.PI);
        ctx.strokeStyle = '#555';
        ctx.lineWidth = 2 * baseLineWidth;
        ctx.stroke();

        // Draw Horizontal Axis
        ctx.beginPath();
        ctx.moveTo(-r, 0);
        ctx.lineTo(r, 0);
        ctx.strokeStyle = '#555';
        ctx.lineWidth = 1 * baseLineWidth;
        ctx.stroke();

        // Get Dynamic Grid Values
        const grid = this.getGridValues(this.transform.k);

        // Draw Resistance Circles
        grid.r.forEach(res => {
            const gr = 1 / (res + 1);
            const gc = res / (res + 1);
            const screenR = gr * r;
            const screenCx = gc * r;

            ctx.beginPath();
            ctx.arc(screenCx, 0, screenR, 0, 2 * Math.PI);
            ctx.strokeStyle = '#444';
            const isMajor = [0.2, 0.5, 1.0, 2.0, 5.0].includes(res);
            ctx.lineWidth = (isMajor ? 1 : 0.5) * baseLineWidth;
            ctx.stroke();
        });

        // Draw Reactance Arcs
        grid.x.forEach(xVal => {
            const gr = Math.abs(1 / xVal);
            const gcx = 1;
            const gcy = 1 / xVal;

            const screenR = gr * r;
            const screenCx = gcx * r;
            const screenCy = -gcy * r;

            ctx.beginPath();
            ctx.save();
            ctx.beginPath();
            ctx.arc(0, 0, r, 0, 2 * Math.PI);
            ctx.clip();

            ctx.beginPath();
            ctx.arc(screenCx, screenCy, screenR, 0, 2 * Math.PI);
            ctx.strokeStyle = '#444';

            const isMajor = [0.5, 1.0, 2.0, -0.5, -1.0, -2.0].includes(xVal);
            ctx.lineWidth = (isMajor ? 1 : 0.5) * baseLineWidth;

            ctx.stroke();
            ctx.restore();
        });

        // --- VSWR CIRCLES ---
        // VSWR circle: radius in Gamma plane = (S - 1) / (S + 1)
        // where S is the VSWR value
        const drawVswrCircle = (vswr, color, label, dashPattern = []) => {
            if (vswr <= 1.0) return; // Invalid VSWR
            
            const gamma = (vswr - 1) / (vswr + 1);
            const circleR = gamma * r;
            
            ctx.beginPath();
            ctx.arc(0, 0, circleR, 0, 2 * Math.PI);
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5 * baseLineWidth;
            ctx.setLineDash(dashPattern.map(d => d * baseLineWidth));
            ctx.stroke();
            ctx.setLineDash([]);
            
            // Draw label
            const labelX = circleR * Math.cos(-Math.PI / 4);
            const labelY = circleR * Math.sin(-Math.PI / 4);
            ctx.fillStyle = color;
            ctx.font = `bold ${fontSize * 0.9}px Inter, sans-serif`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'bottom';
            ctx.fillText(`VSWR=${vswr.toFixed(2)} ${label}`, labelX + 5 * baseLineWidth, labelY - 3 * baseLineWidth);
        };
        
        // Draw Stop VSWR circle (inner - match complete) - Green solid
        if (this.settings.showVswrStop) {
            drawVswrCircle(this.settings.vswrStop, '#4caf50', '(Stop)', []);
        }
        
        // Draw Start VSWR circle (outer - start matching) - Red dashed
        if (this.settings.showVswrStart) {
            drawVswrCircle(this.settings.vswrStart, '#f44336', '(Start)', [6, 3]);
        }
        
        // Draw Restart VSWR circle - Orange dotted
        if (this.settings.showVswrRestart) {
            drawVswrCircle(this.settings.vswrRestart, '#ff9800', '(Restart)', [3, 3]);
        }

        // --- LABEL DRAWING ---

        // Helper to get screen pos of intersection (r, x)
        const getScreenPos = (rVal, xVal) => {
            // Gamma = (Z-1)/(Z+1)
            const denom = (rVal + 1) * (rVal + 1) + xVal * xVal;
            const gR = (rVal * rVal + xVal * xVal - 1) / denom;
            const gI = (2 * xVal) / denom;

            const worldX = gR * r;
            const worldY = -gI * r;

            // Apply Transform
            const screenX = (worldX * this.transform.k) + this.transform.x + cx;
            const screenY = (worldY * this.transform.k) + this.transform.y + cy;

            return { x: screenX, y: screenY };
        };

        // Check if Default View
        if (this.transform.k <= 1.1) {
            // --- DEFAULT VIEW (Fixed Labels) ---

            // R Labels on Horizontal Axis (X=0)
            ctx.fillStyle = '#aaa';
            ctx.font = `${fontSize}px Inter, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            grid.r.forEach(rVal => {
                const labelGamma = (rVal - 1) / (rVal + 1);
                const labelX = labelGamma * r;
                ctx.fillText(this.formatNumber(rVal * 50), labelX, -10 * baseLineWidth);
            });

            // X Labels on Unit Circle (R=0)
            ctx.fillStyle = '#4fc3f7';
            ctx.font = `italic ${fontSize}px Inter, sans-serif`;

            grid.x.forEach(xVal => {
                if (xVal === 0) return;

                // Intersection with Unit Circle (R=0)
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
                const labelText = this.formatNumber(xOhms) + 'j'; // Keep negative sign
                ctx.fillText(labelText, finalX, finalY);
            });

        } else {
            // --- ZOOMED VIEW (Anchored Labels) ---

            // 1. Find Anchor X (for R labels)
            // We want to find an X-arc that has visible intersections with the R-circles.
            // Sort all X values by absolute value (Ascending)
            const sortedX = [...grid.x].sort((a, b) => Math.abs(a) - Math.abs(b));

            // Filter to only those that have at least one visible intersection with any R circle
            const validX = [];
            // Optimization: Check against a few key R values (min, max, mid)
            // Or iterate all R values? Iterating all is safer for robustness.

            for (const xVal of sortedX) {
                let visibleCount = 0;
                for (const rVal of grid.r) {
                    const pos = getScreenPos(rVal, xVal);
                    if (this.isPointVisible(pos.x, pos.y, w, h)) {
                        visibleCount++;
                    }
                }
                if (visibleCount > 0) {
                    validX.push(xVal);
                }
            }

            // Now select the best anchor from validX
            let anchorX = 0;
            if (validX.length > 0) {
                // Find the "center-most" (smallest abs) valid X
                // Since validX is already sorted by abs, it's the first one.
                const bestX = validX[0];

                // Filter validX to only same sign as bestX
                const sameSignX = validX.filter(v => (bestX >= 0 ? v >= 0 : v < 0));

                // Determine Offset based on Zoom Level
                const k = this.transform.k;
                let offset = 0;

                if (k <= 5) {
                    offset = -1; // Move closer to center (or opposite direction)
                } else if (k <= 10) {
                    offset = 0;
                } else if (k <= 20) {
                    offset = 1;
                } else if (k <= 30) {
                    offset = 2;
                } else {
                    offset = 3;
                }

                // Apply offset to index
                // If bestX is positive, we want larger positive -> higher index
                // If bestX is negative, we want larger negative (abs) -> higher index
                // Since sameSignX is sorted by Abs, higher index always means "deeper" / "more outward from center line"

                // Wait, user said: "5이하일때는 -1 추가해줘. 찾은 허수축이 음수일때는 반대겠지?"
                // If bestX is positive (upper half), offset +1 means move UP (larger X).
                // If bestX is negative (lower half), offset +1 means move DOWN (larger abs X, more negative).
                // Since sameSignX is sorted by ABS value:
                // Index 0 is smallest abs (closest to center line).
                // Index N is largest abs (furthest from center line).

                // So increasing index ALWAYS moves away from center line.
                // If offset is -1, we want to move TOWARDS center line?
                // But index 0 is already closest. We can't go lower than 0.
                // Maybe user meant "index - 1" relative to some standard?
                // Or maybe user meant "if zoom <= 5, use index 0 but maybe previous logic was index 3?"

                // Let's assume "offset" is the target index directly.
                // k <= 5 -> index 0 (or clamped -1 -> 0)
                // k > 10 -> index 1
                // ...

                // Actually, let's re-read carefully: "5이하일때는 -1 추가해줘."
                // Previous logic was fixed at index 3.
                // New logic:
                // k <= 5: offset = -1 (relative to what? relative to 0? No, that's impossible)
                // Ah, maybe user means relative to the "best visible" one?
                // But "best visible" IS index 0 of validX.

                // Let's interpret "offset" as the Target Index in the sorted `sameSignX` array.
                // k <= 5: Target Index = 0 (Can't go lower)
                // k <= 10: Target Index = 0
                // k <= 20: Target Index = 1
                // k <= 30: Target Index = 2
                // k > 30: Target Index = 3

                // Wait, if k <= 5, maybe we should just use index 0.
                // Let's stick to the plan:
                // k <= 10: 0
                // k <= 20: 1
                // ...

                // But user added: "5이하일때는 -1 추가해줘"
                // Maybe they mean "Index - 1"? But if Index is 0, it becomes -1 (invalid).
                // Unless they mean "Move in the opposite direction"?
                // If we are at index 0 (closest visible), we can't go closer.
                // Maybe they mean "If zoom is small, don't push it in so much"?

                // Let's implement the mapping:
                // Zoom <= 5: Index 0
                // Zoom 5-10: Index 0
                // Zoom 10-20: Index 1
                // Zoom 20-30: Index 2
                // Zoom > 30: Index 3

                let targetIdx = 0;
                if (k <= 5) targetIdx = 0;
                else if (k <= 10) targetIdx = 0;
                else if (k <= 20) targetIdx = 1;
                else if (k <= 30) targetIdx = 2;
                else targetIdx = 3;

                targetIdx = Math.min(targetIdx, sameSignX.length - 1);
                anchorX = sameSignX[targetIdx];
            }


            // 2. Find Anchor R (for X labels)
            // Sort all R values by value (Descending)
            const sortedR = [...grid.r].sort((a, b) => b - a);

            // Filter to only those that have visible intersections with X arcs
            const validR = [];
            for (const rVal of sortedR) {
                let visibleCount = 0;
                for (const xVal of grid.x) {
                    const pos = getScreenPos(rVal, xVal);
                    if (this.isPointVisible(pos.x, pos.y, w, h)) {
                        visibleCount++;
                    }
                }
                if (visibleCount > 0) {
                    validR.push(rVal);
                }
            }

            let anchorR = 0;
            if (validR.length > 0) {
                // Select index + 2 (3rd largest)
                let targetIdx = 2;
                targetIdx = Math.min(targetIdx, validR.length - 1);
                anchorR = validR[targetIdx];
            }


            // Draw Resistance Labels (along anchorX)
            ctx.fillStyle = '#aaa';
            ctx.font = `${fontSize}px Inter, sans-serif`;
            ctx.textAlign = 'center';

            if (anchorX >= 0) {
                ctx.textBaseline = 'bottom';
            } else {
                ctx.textBaseline = 'top';
            }

            grid.r.forEach(rVal => {
                const denom = (rVal + 1) * (rVal + 1) + anchorX * anchorX;
                const gR = (rVal * rVal + anchorX * anchorX - 1) / denom;
                const gI = (2 * anchorX) / denom;

                const labelX = gR * r;
                const labelY = -gI * r;

                const screenPos = getScreenPos(rVal, anchorX);

                if (this.isPointVisible(screenPos.x, screenPos.y, w, h)) {
                    const offset = (anchorX >= 0) ? -5 : 5;
                    ctx.fillText(this.formatNumber(rVal * 50), labelX, labelY + offset * baseLineWidth);
                }
            });

            // Draw Reactance Labels (along anchorR)
            ctx.fillStyle = '#4fc3f7';
            ctx.font = `italic ${fontSize}px Inter, sans-serif`;
            ctx.textAlign = 'right'; // Left of the line
            ctx.textBaseline = 'middle';

            grid.x.forEach(xVal => {
                if (xVal === 0) return;

                const denom = (anchorR + 1) * (anchorR + 1) + xVal * xVal;
                const gR = (anchorR * anchorR + xVal * xVal - 1) / denom;
                const gI = (2 * xVal) / denom;

                const labelX = gR * r;
                const labelY = -gI * r;

                const screenPos = getScreenPos(anchorR, xVal);

                if (this.isPointVisible(screenPos.x, screenPos.y, w, h)) {
                    const xOhms = xVal * 50;
                    const labelText = this.formatNumber(xOhms) + 'j'; // Keep sign
                    ctx.fillText(labelText, labelX - 8 * baseLineWidth, labelY);
                }
            });
        }


        // Draw Points
        if (this.settings.showInput) {
            this.drawTrace(this.inputPoints, '#4ec9b0', baseLineWidth);  // Teal color
        }
        if (this.settings.showOutput) {
            this.drawTrace(this.outputPoints, '#dcdcaa', baseLineWidth);  // Gold/Yellow color
        }

        // Draw Highlight
        if (highlightPoint) {
            const hX = highlightPoint.gammaR * r;
            const hY = -highlightPoint.gammaI * r;

            ctx.beginPath();
            ctx.arc(hX, hY, 8 * baseLineWidth, 0, 2 * Math.PI);
            ctx.strokeStyle = '#00ffff';
            ctx.lineWidth = 2 * baseLineWidth;
            ctx.stroke();
            ctx.fillStyle = 'rgba(0, 255, 255, 0.2)';
            ctx.fill();
        }
    }

    drawTrace(points, color, baseLineWidth) {
        if (points.length === 0) return;
        const ctx = this.ctx;
        const dpr = window.devicePixelRatio || 1;
        const w = this.canvas.width / dpr;
        const h = this.canvas.height / dpr;
        const minDim = Math.min(w, h);
        const r = (minDim / 2) * 0.9;

        if (this.settings.traceMode === 'line') {
            if (points.length > 1) {
                ctx.beginPath();
                const startX = points[0].gammaR * r;
                const startY = -points[0].gammaI * r;
                ctx.moveTo(startX, startY);

                for (let i = 1; i < points.length; i++) {
                    const pX = points[i].gammaR * r;
                    const pY = -points[i].gammaI * r;
                    ctx.lineTo(pX, pY);
                }

                ctx.strokeStyle = color;
                ctx.lineWidth = 2 * baseLineWidth;
                ctx.globalAlpha = 0.6;
                ctx.stroke();
                ctx.globalAlpha = 1.0;
            }

            const newest = points[0];
            const nX = newest.gammaR * r;
            const nY = -newest.gammaI * r;
            ctx.beginPath();
            ctx.arc(nX, nY, 5 * baseLineWidth, 0, 2 * Math.PI);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1 * baseLineWidth;
            ctx.stroke();

            if (points.length > 1) {
                const oldest = points[points.length - 1];
                const oX = oldest.gammaR * r;
                const oY = -oldest.gammaI * r;
                const size = 8 * baseLineWidth;

                ctx.beginPath();
                ctx.rect(oX - size / 2, oY - size / 2, size, size);
                ctx.strokeStyle = color;
                ctx.lineWidth = 2 * baseLineWidth;
                ctx.stroke();
            }

        } else {
            points.forEach((p, i) => {
                const pX = p.gammaR * r;
                const pY = -p.gammaI * r;

                ctx.beginPath();
                ctx.arc(pX, pY, 4 * baseLineWidth, 0, 2 * Math.PI);

                const opacity = 1 - (i / this.settings.traceLength);
                ctx.fillStyle = color;
                ctx.globalAlpha = Math.max(0.1, opacity);
                ctx.fill();
                ctx.globalAlpha = 1.0;
            });
        }
    }

    addPoint(gammaR, gammaI, isInput = true) {
        const mag = Math.sqrt(gammaR * gammaR + gammaI * gammaI);
        if (mag > 1.0) {
            gammaR /= mag;
            gammaI /= mag;
        }

        const point = { gammaR, gammaI };
        const targetArray = isInput ? this.inputPoints : this.outputPoints;

        targetArray.unshift(point);

        if (targetArray.length > this.settings.traceLength) {
            targetArray.length = this.settings.traceLength;
        }

        this.draw();
    }

    clear() {
        this.inputPoints = [];
        this.outputPoints = [];
        this.draw();
    }

    initTooltip() {
        this.tooltip = document.getElementById('graphTooltip');
        this.canvas.addEventListener('mouseout', () => this.hideTooltip());
    }

    handleTooltipHover(e) {
        if (!this.tooltip) return;

        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const allPoints = [...this.inputPoints.map(p => ({ ...p, type: 'Input' })), ...this.outputPoints.map(p => ({ ...p, type: 'Output' }))];
        if (allPoints.length === 0) return;

        let closest = null;
        let minDist = Infinity;

        allPoints.forEach(p => {
            const pos = this.gammaToCanvas(p.gammaR, p.gammaI);
            const dx = x - pos.x;
            const dy = y - pos.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < minDist) {
                minDist = dist;
                closest = p;
            }
        });

        if (minDist < 20 && closest) {
            if (this.lastClosest !== closest) {
                this.lastClosest = closest;
                this.draw(closest);
            }
            this.showTooltip(e.clientX, e.clientY, closest);
        } else {
            if (this.lastClosest !== null) {
                this.lastClosest = null;
                this.draw(null);
            }
            this.hideTooltip();
        }
    }

    showTooltip(x, y, point) {
        const gr = point.gammaR;
        const gi = point.gammaI;
        const Z0 = 50;

        const denom = (1 - gr) * (1 - gr) + gi * gi;
        const rNorm = (1 - gr * gr - gi * gi) / denom;
        const xNorm = (2 * gi) / denom;

        const rVal = rNorm * Z0;
        const xVal = xNorm * Z0;

        const zMag = Math.sqrt(rVal * rVal + xVal * xVal);
        const zPhase = Math.atan2(xVal, rVal) * (180 / Math.PI);

        const html = `
            <div class="tooltip-row"><span class="tooltip-label">Type:</span><span class="tooltip-value">${point.type}</span></div>
            <div class="tooltip-row"><span class="tooltip-label">R:</span><span class="tooltip-value">${rVal.toFixed(2)}</span></div>
            <div class="tooltip-row"><span class="tooltip-label">X:</span><span class="tooltip-value">${xVal.toFixed(2)}</span></div>
            <div class="tooltip-row"><span class="tooltip-label">Mag:</span><span class="tooltip-value">${zMag.toFixed(2)}</span></div>
            <div class="tooltip-row"><span class="tooltip-label">Phase:</span><span class="tooltip-value">${zPhase.toFixed(2)}°</span></div>
        `;

        this.tooltip.innerHTML = html;
        this.tooltip.style.display = 'block';
        this.tooltip.style.left = x + 'px';
        this.tooltip.style.top = y + 'px';
    }

    hideTooltip() {
        if (this.tooltip) {
            this.tooltip.style.display = 'none';
        }
    }
}
