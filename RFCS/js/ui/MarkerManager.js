/**
 * MarkerManager.js
 * Manages graph markers and the marker table UI.
 */
class MarkerManager {
    constructor() {
        this.markers = [];
        this.counter = 1;
        this.tableContainer = document.getElementById('markerTableContainer');
        this.tableBody = document.getElementById('markerTableBody');

        // Measurement Mode (sparameter vs impedance)
        this.measurementMode = 'sparameter';

        this.colors = [
            '#FF6B6B', // Red
            '#4ECDC4', // Teal 
            '#FFE66D', // Yellow
            '#1A535C', // Dark Teal
            '#FF9F1C', // Orange
            '#2EC4B6', // Light Blue
            '#E71D36', // Dark Red
            '#011627'  // Navy
        ];

        // Highlight state
        this.highlightedId = null;

        // Current Headers
        this.xLabel = 'Frequency';
        this.yLabel = 'Value';

        // Table Mode: 'cartesian' or 'smith'
        this.tableMode = 'cartesian';

        // Display Mode: 0 = R+jX, 1 = Mag/Phase, 2 = Component Value
        this.displayMode = 0;

        // Configuration
        this.markerSize = 6; // Default size
        this.tableLayout = 2; // Default: 2 Cols
        this.maxRows = 3;     // Default: 3 Rows
        this.fontSize = 12;   // Default: 12px
        this.showValueOnMarker = false; // Default: Hidden

        this._headerClickHandler = this._handleHeaderClick.bind(this);

        this._injectStyles();

        // Initialize with default method to set CSS vars
        // We need to wait for DOM or just rely on init? 
        // MarkerManager is created in SParameterGraph, tableContainer might exist.
        if (this.tableContainer) {
            this.setFontSize(this.fontSize);
        }
    }

    _injectStyles() {
        const styleId = 'marker-table-fixed-styles';
        if (!document.getElementById(styleId)) {
            const style = document.createElement('style');
            style.id = styleId;
            style.textContent = `
                #markerTableContainer table {
                    table-layout: fixed;
                    width: 100%;
                }
                #markerTableContainer th, #markerTableContainer td {
                    overflow: hidden;
                    white-space: nowrap;
                    text-overflow: ellipsis;
                }
                /* Define column widths for standard table */
                #markerTableContainer th:nth-child(1) { width: 15%; }
                #markerTableContainer th:nth-child(2) { width: 10%; }
                #markerTableContainer th:nth-child(3) { width: 25%; }
                #markerTableContainer th:nth-child(4) { width: 40%; }
                #markerTableContainer th:nth-child(5) { width: 10%; text-align: center; }
                
                /* Input Selection Style */
                .marker-edit-input::selection {
                    background: #000;
                    color: #fff;
                }
            `;
            document.head.appendChild(style);
        }

        const styleId2 = 'marker-manager-styles';
        if (document.getElementById(styleId2)) return;

        const style2 = document.createElement('style');
        style2.id = styleId2;
        style2.textContent = `
            .marker-settings-modal {
                position: absolute;
                background: rgba(30, 30, 30, 0.95);
                border: 1px solid #555;
                padding: 10px;
                border-radius: 6px;
                z-index: 1000;
                color: #fff;
                font-family: sans-serif;
                font-size: 12px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.5);
                width: 220px;
            }
            .marker-settings-header {
                display: flex;
                justify-content: space-between;
                margin-bottom: 8px;
                font-weight: bold;
                border-bottom: 1px solid #555;
                padding-bottom: 4px;
            }
            .marker-settings-content {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            .setting-item {
                display: flex;
                justify-content: flex-start; /* Changed from space-between */
                align-items: center;
                gap: 12px; /* Added gap */
            }
            .layout-options label {
                margin-left: 6px;
                cursor: pointer;
            }
        `;
        document.head.appendChild(style2);
    }



    _toggleSettingsModal() {
        let modal = document.querySelector('.marker-settings-modal');
        if (modal) {
            modal.remove(); // Toggle off if exists
            return;
        }

        this._createSettingsModal();
    }

    _createSettingsModal() {
        const modal = document.createElement('div');
        modal.className = 'marker-settings-modal';

        modal.innerHTML = `
            <div class="marker-settings-header">
                <span>Marker Settings</span>
                <span class="close-btn" style="cursor:pointer;">&times;</span>
            </div>
            <div class="marker-settings-content">
                <!-- Show Value removed -->
                <div class="setting-item">
                    <label>Marker Size: <span id="markerSizeVal">${this.markerSize}</span>px</label>
                    <input type="range" min="2" max="15" step="1" value="${this.markerSize}" id="markerSizeInput">
                </div>
                <div class="setting-item">
                    <label>Font Size: <span id="markerFontSizeVal">${this.fontSize}</span>px</label>
                    <input type="range" min="10" max="18" step="1" value="${this.fontSize}" id="markerFontSizeInput">
                </div>
                <div class="setting-item">
                    <label>Visible Rows:</label>
                    <input type="number" min="1" max="20" value="${this.maxRows}" id="markerRowsInput" class="marker-rows-input" style="width: 60px; background: rgba(0,0,0,0.2); border: 1px solid #555; color: #fff; padding: 2px 4px; border-radius: 4px;">
                </div>
                <div class="setting-item">
                    <label>Layout Columns:</label>
                    <div class="layout-options">
                        <label><input type="radio" name="tableLayout" value="1" ${this.tableLayout === 1 ? 'checked' : ''}> 1</label>
                        <label><input type="radio" name="tableLayout" value="2" ${this.tableLayout === 2 ? 'checked' : ''}> 2</label>
                        <label><input type="radio" name="tableLayout" value="3" ${this.tableLayout === 3 ? 'checked' : ''}> 3</label>
                    </div>
                </div>
            </div>
        `;

        // Position modal absolute within container or fixed?
        // Container has overflow-y auto, so absolute might get clipped or scroll.
        // Better to append to body and position near the container, or use fixed.
        // But relative to container is easier if container wasn't scrolling content.
        // The container IS the scrolling area for the table.
        // Let's append to the tableContainer's PARENT or just use fixed positioning centered or near mouse.
        // Simple approach: Center in screen or fixed top-right of container (if container is visible).

        // Actually, let's append to body to avoid overflow issues.
        document.body.appendChild(modal);

        // Smart Positioning
        const btn = this.tableContainer.querySelector('.marker-settings-btn');
        if (btn) {
            const btnRect = btn.getBoundingClientRect();
            const viewportHeight = window.innerHeight;
            const spaceBelow = viewportHeight - btnRect.bottom;
            const modalHeightEst = 200; // Estimated height

            modal.style.position = 'fixed';

            // Align Right with Button
            const rightOffset = window.innerWidth - btnRect.right;
            modal.style.right = `${rightOffset}px`;
            modal.style.left = 'auto';

            // Determine Vertical Position (Up or Down)
            // If space below is less than modal height AND space above is larger, go UP.
            if (spaceBelow < modalHeightEst && btnRect.top > modalHeightEst) {
                // Position ABOVE the button
                modal.style.bottom = `${viewportHeight - btnRect.top + 5}px`;
                modal.style.top = 'auto'; // Reset top
            } else {
                // Position BELOW the button (Default)
                modal.style.top = `${btnRect.bottom + 5}px`;
                modal.style.bottom = 'auto'; // Reset bottom
            }
        } else {
            // Fallback
            const containerRect = this.tableContainer.getBoundingClientRect();
            modal.style.position = 'fixed';
            modal.style.top = `${containerRect.top + 30}px`;
            modal.style.right = `${window.innerWidth - containerRect.right + 10}px`;
        }

        // Events
        const closeBtn = modal.querySelector('.close-btn');
        closeBtn.onclick = () => modal.remove();

        // Show Value Checkbox removed from HTML, so removing logic to avoid null error


        const sizeInput = modal.querySelector('#markerSizeInput');
        sizeInput.oninput = (e) => {
            const val = parseInt(e.target.value);
            modal.querySelector('#markerSizeVal').textContent = val;
            this.setMarkerSize(val);
        };

        const rowsInput = modal.querySelector('#markerRowsInput');
        rowsInput.onchange = (e) => {
            let val = parseInt(e.target.value);
            if (val < 1) val = 1;
            this.setMaxRows(val);
        };

        const fontSizeInput = modal.querySelector('#markerFontSizeInput');
        fontSizeInput.oninput = (e) => {
            const val = parseInt(e.target.value);
            modal.querySelector('#markerFontSizeVal').textContent = val;
            this.setFontSize(val);
        };

        const radioBtns = modal.querySelectorAll('input[name="tableLayout"]');
        radioBtns.forEach(btn => {
            btn.onchange = (e) => {
                this.setTableLayout(parseInt(e.target.value));
            };
        });

        // Click outside to close
        const clickOutside = (e) => {
            if (!modal.contains(e.target) && !e.target.classList.contains('marker-settings-btn')) {
                modal.remove();
                document.removeEventListener('click', clickOutside);
            }
        };
        setTimeout(() => document.addEventListener('click', clickOutside), 0);
    }

    setShowValueOnMarker(visible) {
        this.showValueOnMarker = visible;
        window.dispatchEvent(new CustomEvent('marker-display-change'));
    }

    setMarkerSize(size) {
        this.markerSize = size;
        // Trigger Redraw
        window.dispatchEvent(new CustomEvent('marker-size-change', { detail: { size } }));
        // Also trigger display change to be safe or unify?
        window.dispatchEvent(new CustomEvent('marker-display-change'));
    }

    setFontSize(size) {
        this.fontSize = size;
        if (this.tableContainer) {
            this.tableContainer.style.fontSize = `${size}px`;

            // Calculate Row Height (Font * 1.5 + 12px Padding Space)
            const textHeight = Math.round(size * 1.5);
            const rowHeight = textHeight + 12; // 12px vertical spacing

            this.tableContainer.style.setProperty('--marker-row-height', `${rowHeight}px`);
        }
        this._updateContainerHeight();
    }

    setTableLayout(layout) {
        this.tableLayout = layout;
        this.updateTable();
    }

    setMaxRows(rows) {
        this.maxRows = rows;
        this._updateContainerHeight();
    }

    _updateContainerHeight() {
        if (!this.tableContainer) return;

        // Ensure calculation uses exact values injected into CSS
        const textHeight = Math.round(this.fontSize * 1.5);
        const rowHeight = textHeight + 12;

        // Container Height = (RowHeight * (Rows + Header)) + Border
        // Header height is same as row height in this logic
        const totalHeight = (rowHeight * (this.maxRows + 1)) + 1;

        // Apply to container
        this.tableContainer.style.height = `${totalHeight}px`;
        // Ensure max-height isn't constraining it if set elsewhere
        this.tableContainer.style.maxHeight = 'none';
    }

    /**
     * Set Table Mode ('cartesian' or 'smith')
     */
    setTableMode(mode) {
        if (this.tableMode === mode) return;
        this.tableMode = mode;

        if (mode === 'smith') {
            this.xLabel = 'Resistance';
        } else {
            this.xLabel = 'Frequency';
        }

        this.updateTable(); // Re-render with new headers/data
    }

    /**
     * Update Table Headers
     * @param {string} xLabel 
     * @param {string} yLabel 
     */
    updateHeaders(xLabel, yLabel) {
        if (!this.tableContainer) return;

        // If manual update is requested, override but usually mode drives this now
        if (xLabel) this.xLabel = xLabel;
        this.yLabel = yLabel || 'Value';

        // Re-render table will apply headers
        this.updateTable();
    }

    _updateYHeader(headerElement) {
        if (!headerElement) return;

        // Static Header
        headerElement.removeEventListener('click', this._headerClickHandler);
        headerElement.style.cursor = 'default';
        headerElement.title = '';
        headerElement.textContent = 'Value';
    }

    _handleHeaderClick() {
        this.displayMode = (this.displayMode + 1) % 3;

        // Update Header Text immediately
        const ths = this.tableContainer.querySelectorAll('th');
        if (ths.length >= 4) {
            this._updateYHeader(ths[3]);
        }

        // Refresh Table
        this.updateTable();
    }

    /**
     * Set Measurement Mode ('sparameter', 'impedance', etc.)
     */
    setMeasurementMode(mode) {
        if (this.measurementMode === mode) return;
        this.measurementMode = mode;
        this.updateTable();
    }

    /**
     * Add a new marker
     * @param {string} type - 'X Marker', 'Y Marker', or 'Point' (for Smith Chart)
     * @param {object} data - { x: number, y: number, unitX: string, unitY: string, format: string, traceIndex: number }
     */
    addMarker(type, data) {
        // Show table if it's the first marker
        if (this.markers.length === 0) {
            if (this.tableContainer) this.tableContainer.style.display = 'block';
        }

        // Find first available ID number
        // Find first available ID number using Gap Filling
        // Consistent with Component ID generation
        const existingNums = this.markers
            .map(m => {
                const num = parseInt(m.id.substring(1));
                return isNaN(num) ? 0 : num;
            })
            .filter(n => n > 0)
            .sort((a, b) => a - b);

        let newIdNum = 1;
        for (const num of existingNums) {
            if (num === newIdNum) {
                newIdNum++;
            } else if (num > newIdNum) {
                // Found a gap
                break;
            }
        }

        // Counter tracks max just for safety/legacy, though not strictly needed for this algorithm
        if (newIdNum >= this.counter) {
            this.counter = newIdNum + 1;
        }

        // Assign Color based on the reused Number to keep consistency
        const colorIndex = (newIdNum - 1) % this.colors.length;
        const color = this.colors[colorIndex];

        const marker = {
            id: `m${newIdNum}`,
            type: type,
            color: color,
            ...data
        };

        this.markers.push(marker);
        this.updateTable();
        return marker;
    }

    /**
     * Update marker data (e.g. during drag)
     */
    updateMarker(id, updates) {
        const marker = this.markers.find(m => m.id === id);
        if (marker) {
            Object.assign(marker, updates);
            this.updateTable(); // Re-render table
        }
    }

    /**
     * Clear all markers
     */
    clear() {
        this.markers = [];
        this.counter = 1;
        this.updateTable();
        if (this.tableContainer) this.tableContainer.style.display = 'none';
    }

    /**
     * Remove specific marker
     */
    removeMarker(id) {
        this.markers = this.markers.filter(m => m.id !== id);
        this.updateTable();
        if (this.markers.length === 0 && this.tableContainer) {
            this.tableContainer.style.display = 'none';
        }
    }

    /**
     * Render the marker table
     */
    /**
     * Render the marker table
     */
    updateTable() {
        if (!this.markers) return;

        // Apply dynamic height
        this._updateContainerHeight();

        // 1. Filter Visible Markers based on Mode
        const visibleMarkers = this.markers.filter(marker => {
            // Smith Mode: Show all (or strictly smith-compatible, but usually all are fine)
            if (this.tableMode === 'smith') return true;

            // Cartesian Mode: Show only if it has a valid X (Frequency)
            // Markers created on Smith Chart 'void' (Points) usually have x=null
            return (marker.x !== null && marker.x !== undefined);
        });

        // Clean up any old grid container if it exists
        const gridContainer = this.tableContainer.querySelector('.marker-grid-container');
        if (gridContainer) gridContainer.remove();

        // 2. Get Containers
        const mainTable = this.tableContainer.querySelector('.marker-table');
        let splitContainer = this.tableContainer.querySelector('.marker-split-container');

        if (this.tableLayout === 1) {
            // === Table Layout (1 Col) ===
            // Hide Split
            if (splitContainer) splitContainer.style.display = 'none';
            // Show Main
            if (mainTable) {
                mainTable.style.display = 'table';
                this._renderSingleTableBody(this.tableBody, visibleMarkers);
            }
        } else {
            // === Split Layout (2-3 Cols) ===
            // Hide Main
            if (mainTable) mainTable.style.display = 'none';
            // Show Split
            this._renderSplitTableLayout(this.tableLayout, visibleMarkers);
        }

        this._placeSettingsIcon();
    }

    _renderSingleTableBody(tbody, markers) {
        if (!tbody) return;
        tbody.innerHTML = '';
        markers.forEach(marker => {
            const row = document.createElement('tr');
            this._populateRowContent(row, marker, 'td');
            tbody.appendChild(row);
        });
    }

    _renderSplitTableLayout(columns, markers) {
        let splitContainer = this.tableContainer.querySelector('.marker-split-container');
        if (!splitContainer) {
            splitContainer = document.createElement('div');
            splitContainer.className = 'marker-split-container';
            this.tableContainer.appendChild(splitContainer);
        }
        splitContainer.style.display = 'flex';
        splitContainer.innerHTML = '';

        // Create Columns and Tables
        const bodies = [];

        for (let i = 0; i < columns; i++) {
            const colDiv = document.createElement('div');
            colDiv.className = 'marker-split-column';

            // Create a clone of the main table structure (Headers included)
            const table = document.createElement('table');
            table.className = 'marker-table';
            table.style.marginBottom = '0'; // Override generic styles

            // Header
            const thead = document.createElement('thead');
            const headerRow = document.createElement('tr');

            // Headers: Type, ID, Freq, Value
            // Reuse logic to sync text with current mode
            headerRow.innerHTML = `
                <th>Type</th>
                <th>ID</th>
                <th>${this.xLabel}</th>
                <th>${this.yLabel}</th> 
                <th></th> 
            `;

            // Add click listener to the Value header (Index 3)
            const yHeader = headerRow.children[3];
            this._updateYHeader(yHeader); // Bind events/text logic

            thead.appendChild(headerRow);
            table.appendChild(thead);

            const tbody = document.createElement('tbody');
            table.appendChild(tbody);

            colDiv.appendChild(table);
            splitContainer.appendChild(colDiv);

            bodies.push(tbody);
        }

        // Distribute Markers (Round Robin) using the FILTERED list
        markers.forEach((marker, index) => {
            const colIndex = index % columns;
            const targetBody = bodies[colIndex];

            const row = document.createElement('tr');
            this._populateRowContent(row, marker, 'td');
            targetBody.appendChild(row);
        });

        this._placeSettingsIcon();
    }

    _renderTableLayout() {
        // Warning: This method seems redundant or legacy compared to updateTable logic? 
        // But keeping it consistent just in case it's called directly.
        // Ideally should just call updateTable.
        this.updateTable();
    }

    _placeSettingsIcon() {
        if (!this.settingsBtn) {
            this.settingsBtn = document.createElement('div');
            this.settingsBtn.className = 'marker-settings-btn';
            this.settingsBtn.innerHTML = '⚙️';
            this.settingsBtn.title = 'Marker Settings';
            this.settingsBtn.onclick = (e) => {
                e.stopPropagation();
                this._toggleSettingsModal();
            };
        }
        const btn = this.settingsBtn;

        // Find the target header cell (Last TH of the active table)
        let targetTh = null;

        if (this.tableLayout === 1) {
            // Single Table - Explicitly select the main table (first one)
            const mainTable = this.tableContainer.querySelector('.marker-table');
            if (mainTable) {
                const ths = mainTable.querySelectorAll('th');
                if (ths.length > 0) targetTh = ths[ths.length - 1];
            }
        } else {
            // Split Table - Find the last column's table
            const splitCols = this.tableContainer.querySelectorAll('.marker-split-column');
            if (splitCols.length > 0) {
                const lastCol = splitCols[splitCols.length - 1];
                const ths = lastCol.querySelectorAll('th');
                if (ths.length > 0) targetTh = ths[ths.length - 1];
            }
        }

        if (targetTh) {
            // Clear content (remove empty text textNode if any) and append button
            targetTh.innerHTML = '';
            targetTh.appendChild(btn);
            targetTh.style.textAlign = 'center'; // Ensure center alignment
            targetTh.style.padding = '0'; // Minimize padding for fit
        }
    }

    _renderGridLayout() {
        // Hide Table
        const table = this.tableContainer.querySelector('.marker-table');
        if (table) table.style.display = 'none';

        // Create or Clear Grid Container
        let gridContainer = this.tableContainer.querySelector('.marker-grid-container');
        if (!gridContainer) {
            gridContainer = document.createElement('div');
            gridContainer.className = 'marker-grid-container';
            this.tableContainer.appendChild(gridContainer);
        }
        gridContainer.style.display = 'grid';
        gridContainer.style.gridTemplateColumns = `repeat(${this.tableLayout}, 1fr)`;
        gridContainer.style.gap = '8px';
        gridContainer.style.padding = '8px';

        gridContainer.innerHTML = '';

        // Filter for Grid Layout as well
        const visibleMarkers = this.markers.filter(marker => {
            if (this.tableMode === 'smith') return true;
            return (marker.x !== null && marker.x !== undefined);
        });

        visibleMarkers.forEach(marker => {
            const card = document.createElement('div');
            card.className = 'marker-card';
            // Mimic row structure but in a card
            // We can reuse logic or write custom card content

            // Format values
            const valX = this.formatValue(marker.x, marker.unitX);
            const displayY = this.getMarkerValueString(marker);

            card.innerHTML = `
                <div class="marker-card-header">
                    <span class="marker-id" style="color:${marker.color}">${marker.type} ${marker.id}</span>
                    <span class="remove-btn" style="cursor:pointer; float:right;">&times;</span>
                </div>
                <div class="marker-card-body">
                    <div class="editable-cell" data-field="x">${valX}</div>
                    <div class="" data-field="y" style="cursor: pointer;">${displayY}</div>
                </div>
            `;

            // Re-bind editable events
            const xCell = card.querySelector('.editable-cell[data-field="x"]');
            if (xCell) {
                xCell.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.makeEditable(xCell, marker.id, 'x');
                });
            }
            // Bind cycle format event for Y
            const yCell = card.querySelector('.marker-value-cell'); // Using a different class or selecting by field
            // Note: In template above I need to change class for Y
            // But let's select carefully
            const yCells = card.querySelectorAll('div[data-field="y"]');
            yCells.forEach(cell => {
                cell.style.cursor = 'pointer';
                cell.title = 'Click to toggle format';
                cell.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._headerClickHandler(); // Re-using header handler logic which cycles mode
                });
            });

            // Remove Btn
            card.querySelector('.remove-btn').onclick = (e) => {
                e.stopPropagation();
                this.removeMarker(marker.id);
                window.dispatchEvent(new CustomEvent('marker-removed', { detail: { id: marker.id } }));
            };

            // Hover
            card.addEventListener('mouseenter', () => {
                this.highlightedId = marker.id;
                window.dispatchEvent(new CustomEvent('marker-hover', { detail: { id: marker.id, hovering: true } }));
            });
            card.addEventListener('mouseleave', () => {
                if (this.highlightedId === marker.id) {
                    this.highlightedId = null;
                    window.dispatchEvent(new CustomEvent('marker-hover', { detail: { id: marker.id, hovering: false } }));
                }
            });

            gridContainer.appendChild(card);
        });
    }

    _populateRowContent(row, marker, cellTag) {
        // Format values
        let valX = '';

        if (this.tableMode === 'smith') {
            // Smith Chart: Show Resistance (real part of Z) or rawGamma if available
            // Priority: complexData.r -> rawGamma -> x (if we assume x means something else?)
            // Just use formatted Real part
            if (marker.complexData) {
                // Cartesian marker with complex info
                valX = marker.complexData.r.toFixed(2) + ' Ω';
            } else if (marker.rawGamma) {
                // Smith Chart marker (Free Cursor or Point)
                // Need to convert rawGamma to Impedance if not already in marker.y
                if (typeof marker.y === 'object' && marker.y.r !== undefined) {
                    valX = marker.y.r.toFixed(2) + ' Ω';
                } else {
                    // Fallback: If we only have rawGamma, we ideally need Z0 to calculate Z.
                    // But assume normalized or standard 50 ohm? 
                    // Usually marker.y holds the Impedance for Smith Chart markers added via addMarker.
                    // If marker.y is missing, we can try to calculate but usually SmithChartRenderer sets y correctly.
                    // Let's check marker.y again or rawGamma.
                    // If we are here, it means we have rawGamma but maybe y is not in {r,x} format?
                    // Actually SmithChartRenderer sets: y: { r: zVal.r, x: zVal.x }
                    // So marker.y.r should be there.
                    if (marker.y && marker.y.r !== undefined) {
                        valX = marker.y.r.toFixed(2) + ' Ω';
                    } else {
                        valX = 'Z?';
                    }
                }
            } else {
                // If added on Smith Chart directly (Point), y is {r, x}
                if (typeof marker.y === 'object' && marker.y.r !== undefined) {
                    valX = marker.y.r.toFixed(2) + ' Ω';
                } else {
                    valX = '-';
                }
            }
        } else {
            // Cartesian: Frequency
            valX = this.formatValue(marker.x, marker.unitX);
        }

        const displayY = this.getMarkerValueString(marker);

        // Create Color Box


        // Create Color Box
        const colorBox = `<span class="marker-color-box" style="background-color: ${marker.color};"></span>`;

        row.innerHTML = `
            <${cellTag}>${colorBox} ${marker.type}</${cellTag}>
            <${cellTag}>${marker.id}</${cellTag}>
            <${cellTag} class="editable-cell" data-field="x">${valX}</${cellTag}>
            <${cellTag} data-field="y" style="cursor: pointer;" title="Click to toggle format">${displayY}</${cellTag}>
            <${cellTag} style="text-align: center;">
                <span class="delete-marker-btn" style="cursor: pointer; color: #ff6b6b; font-weight: bold;">✕</span>
            </${cellTag}>
        `;

        // Bind Delete Event
        const deleteBtn = row.querySelector('.delete-marker-btn');
        if (deleteBtn) {
            deleteBtn.onclick = (e) => {
                e.stopPropagation();
                // No confirm needed or maybe a quick one? User asked to just press x to delete.
                // "x버튼을 누르면 해당 마커가 지워지도록 해줘" implies direct action or standard flow.
                // I will delete directly as implied by "changing the way... from right click confirm".
                this.removeMarker(marker.id);
                window.dispatchEvent(new CustomEvent('marker-removed', { detail: { id: marker.id } }));
            };
        }

        // Make cells editable (X only)
        const xCells = row.querySelectorAll('.editable-cell[data-field="x"]');
        xCells.forEach(cell => {
            cell.addEventListener('click', (e) => {
                e.stopPropagation();
                this.makeEditable(cell, marker.id, 'x');
            });

            // Add Wheel Listener for Frequency (x) field
            cell.addEventListener('wheel', (e) => {
                e.preventDefault();

                const now = Date.now();
                // Lazy Init State
                if (!this.scrollState) {
                    this.scrollState = { lastTime: 0, multiplier: 1 };
                }

                const dt = now - this.scrollState.lastTime;
                this.scrollState.lastTime = now;

                // Tuning Parameters
                const accelThreshold = 60; // ms
                const resetThreshold = 150; // ms
                const maxMultiplier = 20;
                const accelerationRate = 1;

                // Logic
                if (dt > resetThreshold) {
                    this.scrollState.multiplier = 1;
                } else if (dt < accelThreshold) {
                    this.scrollState.multiplier = Math.min(maxMultiplier, this.scrollState.multiplier + accelerationRate);
                }

                const direction = e.deltaY < 0 ? 1 : -1;
                const steps = direction * Math.floor(this.scrollState.multiplier);

                window.dispatchEvent(new CustomEvent('marker-step-request', {
                    detail: { id: marker.id, steps: steps }
                }));
            }, { passive: false });
        });

        // Toggle Format (Y only)
        const yCells = row.querySelectorAll('[data-field="y"]');
        yCells.forEach(cell => {
            cell.addEventListener('click', (e) => {
                e.stopPropagation();
                this._headerClickHandler(); // Cycle format
            });
        });

        // Hover Events for Highlight
        row.addEventListener('mouseenter', () => {
            this.highlightedId = marker.id;
            window.dispatchEvent(new CustomEvent('marker-hover', {
                detail: { id: marker.id, hovering: true }
            }));
        });

        row.addEventListener('mouseleave', () => {
            if (this.highlightedId === marker.id) {
                this.highlightedId = null;
                window.dispatchEvent(new CustomEvent('marker-hover', {
                    detail: { id: marker.id, hovering: false }
                }));
            }
        });

        // Optional: Add remove button or context menu
        // Optional: Add remove button or context menu
        row.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            // Just prevent default context menu, since we have a button now.
            // Or keep it as secondary option.
        });
    }

    formatValue(val, unit) {
        if (typeof val !== 'number') return val;

        // Simple formatting
        let displayVal = val;
        if (Math.abs(val) >= 1e9) displayVal = (val / 1e9).toFixed(3) + 'G';
        else if (Math.abs(val) >= 1e6) displayVal = (val / 1e6).toFixed(3) + 'M';
        else if (Math.abs(val) >= 1e3) displayVal = (val / 1e3).toFixed(3) + 'k';
        else displayVal = val.toFixed(2);

        if (unit) displayVal += ` ${unit}`;
        return displayVal;
    }

    /**
     * Get the formatted value string for a marker based on current settings
     */
    getMarkerValueString(marker) {
        // Format values
        const valY = this.formatValue(marker.y, marker.unitY);

        // Special handling for Smith Chart or Complex Data
        // Logic:
        // 1. If Smith Chart Mode -> Show Complex
        // 2. If 'Impedance' Measurement Mode -> Show Complex (Requested)
        // 3. Else (Cartesian S-Param) -> Show Scalar valY

        const shouldShowComplex = (this.tableMode === 'smith') || (this.measurementMode === 'impedance');

        if (!shouldShowComplex) {
            return valY;
        }

        let displayY = valY;

        // Check if marker has complex data (from SParameterGraph) or is a Point
        const complexData = marker.complexData || (typeof marker.y === 'object' && marker.y.r !== undefined ? marker.y : null);

        // Determine if we should display complex format
        if (complexData) {
            const r = complexData.r;
            const x = complexData.x; // Reactance
            const freq = marker.x; // Frequency for Component calc

            displayY = this._formatComplexValue(r, x, freq, this.displayMode);
        }

        return displayY;
    }

    _formatComplexValue(r, x, freq, mode) {
        // Mode 0: R + jX
        if (mode === 0) {
            return `${r.toFixed(2)} ${x >= 0 ? '+' : ''}${x.toFixed(2)}j Ω`;
        }

        // Mode 1: Mag / Phase
        if (mode === 1) {
            const mag = Math.sqrt(r * r + x * x);
            const phase = Math.atan2(x, r) * (180 / Math.PI);
            return `${mag.toFixed(2)} Ω ∠ ${phase.toFixed(2)}°`;
        }

        // Mode 2: Component Value
        if (mode === 2) {
            // omega = 2 * pi * f
            // If f is 0 or invalid, just return R
            if (!freq || freq <= 0) {
                return `R: ${r.toFixed(2)} Ω`;
            }

            const omega = 2 * Math.PI * freq;
            let compStr = '';

            if (Math.abs(x) < 0.001) {
                // Resistive only
                return `${r.toFixed(2)} Ω`;
            } else if (x > 0) {
                // Inductive: L = X / omega
                const L = x / omega;
                compStr = this.formatComponentValue(L, 'H');
                return `${r.toFixed(2)}Ω + ${compStr}`;
            } else {
                // Capacitive: C = -1 / (omega * X)
                const C = -1 / (omega * x);
                compStr = this.formatComponentValue(C, 'F');
                return `${r.toFixed(2)}Ω + ${compStr}`; // 'x' is negative, so it implies C
            }
        }

        return `${r} + j${x}`;
    }

    formatComponentValue(val, unit) {
        if (val === 0) return `0 ${unit}`;

        const absVal = Math.abs(val);
        let prefix = '';
        let num = val;

        if (absVal < 1e-12) { num = val * 1e15; prefix = 'f'; }
        else if (absVal < 1e-9) { num = val * 1e12; prefix = 'p'; }
        else if (absVal < 1e-6) { num = val * 1e9; prefix = 'n'; }
        else if (absVal < 1e-3) { num = val * 1e6; prefix = 'µ'; }
        else if (absVal < 1) { num = val * 1e3; prefix = 'm'; }

        return `${num.toFixed(2)}${prefix}${unit}`;
    }

    makeEditable(cell, markerId, field) {
        // Find actual marker data for precision
        const marker = this.markers.find(m => m.id === markerId);
        if (!marker) return;

        const originalValue = marker[field]; // x or y

        // Use current text as placeholder/initial value, but we might want the exact number
        // Or just show the formatted string so user knows what they are editing?
        // User wants to INPUT 'k', but usually wants to see the current value.
        // Let's pre-fill with the Number value by default, or the formatted value?
        // If we pre-fill formatted (e.g. "1.00 k"), user can edit it.
        // If we pre-fill raw "1000", user can add 'k'.
        // Let's stick to showing the simplified number (or formatted) and letting them type.
        // Actually, previous logic tried to parse text. 
        // Best UX: Show the number they see, but allow them to type.
        // But if they see "1.000 k", parsing "1.000" gives 1, which is WRONG if they don't type 'k'.
        // So we should format the RAW value to a simple string, OR just use the text content but handle the unit properly.
        // Safest: Use the current RAW value.

        // Capture parent styles before clearing content
        const style = window.getComputedStyle(cell);
        const fontFamily = style.fontFamily;
        const fontSize = style.fontSize;
        const color = style.color;
        const textAlign = style.textAlign;
        const fontWeight = style.fontWeight;

        cell.innerHTML = '';
        const input = document.createElement('input');
        input.type = 'text'; // Allow letters
        input.value = originalValue; // Start with raw number

        // Match parent styles
        input.style.fontFamily = fontFamily;
        input.style.fontSize = fontSize;
        input.style.color = color;
        input.style.textAlign = textAlign;
        input.style.fontWeight = fontWeight;

        // Seamless overlay styles
        input.style.width = '100%';
        input.style.height = '100%';
        input.style.padding = '0';
        input.style.margin = '0';
        input.style.border = 'none';
        input.style.outline = 'none';
        input.style.background = 'transparent';
        input.style.display = 'block';

        input.className = 'marker-edit-input'; // For selection styling

        const commit = () => {
            const rawText = input.value;
            // Use Component.parseValue if available (it handles k, M, etc.)
            // Assuming Component is globally available as checks in previous steps suggested.
            let newValue;
            if (typeof Component !== 'undefined' && typeof Component.parseValue === 'function') {
                newValue = Component.parseValue(rawText);
            } else {
                newValue = parseFloat(rawText);
            }

            if (!isNaN(newValue)) {
                // Request update via event
                window.dispatchEvent(new CustomEvent('marker-edit-request', {
                    detail: { id: markerId, field: field, value: newValue }
                }));
            } else {
                // If invalid, revert.
                this.updateTable();
            }
        };

        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                input.blur();
            }
        });

        cell.appendChild(input);
        input.focus();
        input.select(); // Auto-select text
    }
}
