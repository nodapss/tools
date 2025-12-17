/**
 * Base Component Class
 * All circuit components inherit from this class
 */
class Component {
    static idCounter = 0;
    static GRID_SIZE = 20;

    constructor(type, x, y) {
        this.id = `${type}_${++Component.idCounter}`;
        this.type = type;
        this.rotation = 0; // 0, 90, 180, 270 degrees
        this.selected = false;
        this.params = {};
        this.element = null;

        // Terminal positions (relative to component center)
        // Use grid-aligned offsets (multiples of GRID_SIZE)
        this.terminals = {
            start: { x: -40, y: 0 },
            end: { x: 40, y: 0 }
        };

        // Connected wires
        this.connections = {
            start: null,
            end: null
        };

        // Direct connections (spatial, not wire-based) - for visual feedback
        this.directConnections = {
            start: false,
            end: false
        };

        // Set position with terminal-based snapping
        this.x = x;
        this.y = y;
        this.snapTerminalsToGrid();
    }

    /**
     * Snap coordinate to grid
     */
    snapToGrid(value) {
        return Math.round(value / Component.GRID_SIZE) * Component.GRID_SIZE;
    }

    /**
     * Snap component so that its START terminal aligns to grid
     * This ensures terminals are always on grid points for clean connections
     */
    snapTerminalsToGrid() {
        // Get the start terminal's absolute position
        const startTerminal = this.getTerminalPosition('start');

        // Calculate where the start terminal SHOULD be (snapped to grid)
        const snappedX = this.snapToGrid(startTerminal.x);
        const snappedY = this.snapToGrid(startTerminal.y);

        // Adjust component position so terminal lands on grid
        this.x += snappedX - startTerminal.x;
        this.y += snappedY - startTerminal.y;
    }

    /**
     * Get absolute terminal positions considering rotation
     */
    getTerminalPosition(terminal) {
        const terminalOffset = this.terminals[terminal];
        if (!terminalOffset) return { x: this.x, y: this.y };

        const rad = (this.rotation * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);

        return {
            x: this.x + terminalOffset.x * cos - terminalOffset.y * sin,
            y: this.y + terminalOffset.x * sin + terminalOffset.y * cos
        };
    }

    /**
     * Get all terminal positions
     */
    getAllTerminalPositions() {
        return Object.keys(this.terminals).map(key => ({
            terminal: key,
            ...this.getTerminalPosition(key)
        }));
    }

    /**
     * Rotate component by 90 degrees
     */
    rotate() {
        this.rotation = (this.rotation + 90) % 360;
        if (this.element) {
            this.updateElement();
        }
    }

    /**
     * Move component to new position
     * Snaps the START terminal to grid for clean connections
     */
    moveTo(x, y) {
        this.x = x;
        this.y = y;
        this.snapTerminalsToGrid();
        if (this.element) {
            this.updateElement();
        }
    }

    /**
     * Move component by delta
     */
    moveBy(dx, dy) {
        this.moveTo(this.x + dx, this.y + dy);
    }

    /**
     * Select/deselect component
     */
    setSelected(selected) {
        this.selected = selected;
        if (this.element) {
            if (selected) {
                this.element.classList.add('selected');
            } else {
                this.element.classList.remove('selected');
            }
        }
    }

    /**
     * Set matching highlight state
     */
    setMatchingHighlight(highlighted) {
        if (!this.element) return;

        if (highlighted) {
            this.element.classList.add('matching-highlight');
        } else {
            this.element.classList.remove('matching-highlight');
        }
    }

    /**
     * Create SVG element for this component
     * Override in subclasses
     */
    createElement() {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', 'circuit-component');
        g.setAttribute('data-id', this.id);
        g.setAttribute('data-type', this.type);
        this.element = g;
        this.updateElement();
        return g;
    }

    /**
     * Update SVG element position and rotation
     */
    updateElement() {
        if (!this.element) return;
        this.element.setAttribute('transform',
            `translate(${this.x}, ${this.y}) rotate(${this.rotation})`);
    }

    /**
     * Render component body (override in subclasses)
     */
    renderBody() {
        return '';
    }

    /**
     * Render terminals
     */
    renderTerminals() {
        let svg = '';
        for (const [key, offset] of Object.entries(this.terminals)) {
            const connected = this.connections[key] !== null || this.directConnections[key];
            svg += `<circle class="terminal ${connected ? 'connected' : ''}" 
                           data-terminal="${key}"
                           cx="${offset.x}" cy="${offset.y}" r="4"/>`;
        }
        return svg;
    }

    /**
     * Render component label
     */
    renderLabel() {
        return `<text class="component-label" x="0" y="-20" text-anchor="middle" 
                      pointer-events="none" style="user-select: none;">${this.id}</text>`;
    }

    /**
     * Render component value (override in subclasses)
     */
    renderValue() {
        return '';
    }

    /**
     * Render transparent hitbox for easier clicking
     * 터미널 위치를 기반으로 동적 히트박스 계산
     */
    renderHitbox() {
        const terminals = Object.values(this.terminals);
        let minX = 0, maxX = 0;

        // 터미널 위치에서 X 범위 계산
        terminals.forEach(t => {
            minX = Math.min(minX, t.x);
            maxX = Math.max(maxX, t.x);
        });

        // Y는 고정 범위 사용 (상하 여유)
        const minY = -15;
        const maxY = 15;
        const width = maxX - minX;
        const height = maxY - minY;

        return `<rect class="hitbox" 
                      x="${minX}" y="${minY}" 
                      width="${width}" height="${height}"
                      fill="transparent" 
                      style="pointer-events: all;"/>`;
    }

    /**
     * Full render
     */
    render() {
        if (!this.element) {
            this.createElement();
        }

        this.element.innerHTML = `
            ${this.renderHitbox()}
            ${this.renderBody()}
            ${this.renderTerminals()}
            ${this.renderLabel()}
            ${this.renderValue()}
        `;

        this.updateElement();
        return this.element;
    }

    /**
     * Calculate impedance at given frequency (override in subclasses)
     * Returns complex number {real, imag}
     */
    getImpedance(frequency) {
        return { real: 0, imag: 0 };
    }

    /**
     * Get component data for serialization
     */
    toJSON() {
        return {
            id: this.id,
            type: this.type,
            x: this.x,
            y: this.y,
            rotation: this.rotation,
            params: { ...this.params },
            connections: { ...this.connections },
            sliderRange: this.sliderRange ? JSON.parse(JSON.stringify(this.sliderRange)) : undefined
        };
    }

    /**
     * Load component from JSON data
     */
    static fromJSON(data) {
        // Implemented in subclasses
        return null;
    }

    /**
     * Check if point is within component bounds (사각형 히트박스)
     * 전체 컴포넌트를 포함하는 사각형으로 클릭하기 쉽게 함
     */
    containsPoint(x, y) {
        // 회전을 고려한 로컬 좌표 변환
        const dx = x - this.x;
        const dy = y - this.y;

        const rad = (-this.rotation * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);

        const localX = dx * cos - dy * sin;
        const localY = dx * sin + dy * cos;

        // 사각형 히트박스 (전체 컴포넌트 포함)
        // - X: 터미널 포함 (±40px)
        // - Y: 본체 + 여유 공간 (±15px)
        const halfWidth = 40;
        const halfHeight = 15;

        return Math.abs(localX) <= halfWidth && Math.abs(localY) <= halfHeight;
    }

    /**
     * Get nearest terminal to a point
     */
    getNearestTerminal(x, y, maxDistance = 20) {
        let nearest = null;
        let minDist = maxDistance;

        for (const [key, _] of Object.entries(this.terminals)) {
            const pos = this.getTerminalPosition(key);
            const dist = Math.sqrt((x - pos.x) ** 2 + (y - pos.y) ** 2);
            if (dist < minDist) {
                minDist = dist;
                nearest = { terminal: key, x: pos.x, y: pos.y, distance: dist };
            }
        }

        return nearest;
    }

    /**
     * Format value with SI prefix
     */
    static formatValue(value, unit) {
        const prefixes = [
            { threshold: 1e12, prefix: 'T', divisor: 1e12 },
            { threshold: 1e9, prefix: 'G', divisor: 1e9 },
            { threshold: 1e6, prefix: 'M', divisor: 1e6 },
            { threshold: 1e3, prefix: 'k', divisor: 1e3 },
            { threshold: 1, prefix: '', divisor: 1 },
            { threshold: 1e-3, prefix: 'm', divisor: 1e-3 },
            { threshold: 1e-6, prefix: 'μ', divisor: 1e-6 },
            { threshold: 1e-9, prefix: 'n', divisor: 1e-9 },
            { threshold: 1e-12, prefix: 'p', divisor: 1e-12 },
            { threshold: 1e-15, prefix: 'f', divisor: 1e-15 }
        ];

        const absValue = Math.abs(value);
        for (const { threshold, prefix, divisor } of prefixes) {
            if (absValue >= threshold) {
                const formatted = (value / divisor).toFixed(2).replace(/\.?0+$/, '');
                return `${formatted}${prefix}${unit}`;
            }
        }
        return `${value.toExponential(2)}${unit}`;
    }

    /**
     * Parse value with SI prefix
     */
    static parseValue(str) {
        const prefixes = {
            'T': 1e12, 'G': 1e9, 'M': 1e6, 'k': 1e3,
            'm': 1e-3, 'u': 1e-6, 'μ': 1e-6, 'n': 1e-9, 'p': 1e-12, 'f': 1e-15
        };

        const match = str.match(/^([\d.eE+-]+)\s*([TGMkmuμnpf])?/);
        if (!match) return NaN;

        const number = parseFloat(match[1]);
        const prefix = match[2];
        const multiplier = prefix ? (prefixes[prefix] || 1) : 1;

        return number * multiplier;
    }
}

// Export for use in other modules
window.Component = Component;

