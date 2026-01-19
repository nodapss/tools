/**
 * ImpedanceConfigModal.js
 * Modal to configure Port and Ground terminals for Plot Impedance
 */
class ImpedanceConfigModal {
    constructor() {
        this.modal = null;
        this.component = null;
        this.onPlot = null;
        this.existingGroupId = null; // Track if we are editing an existing group
        this.contextComponent = null; // Reference to IntegratedComponent if applicable
        this.init();
    }

    init() {
        // Create Modal HTML
        const modalHtml = `
            <div id="impedanceConfigModal" class="modal" style="display:none;">
                <div class="modal-content" style="max-width: 400px;">
                    <div class="modal-header">
                        <h2>Plot Impedance Settings</h2>
                        <span class="close">&times;</span>
                    </div>
                    <div class="modal-body">
                        <p style="margin-bottom: 15px; color: #aaa;">
                            Select terminals to connect to the analyzer.<br>
                            <small>This will simulate the component in isolation.</small>
                        </p>
                        
                        <!-- Single Component UI (Dropdowns) -->
                        <div id="uiSingleComponent" style="display: none;">
                            <div class="form-group" style="margin-bottom: 15px;">
                                <label for="selInputTerminal" style="display:block; margin-bottom: 5px;">Input Terminal (Port 1):</label>
                                <select id="selInputTerminal" class="modal-select" style="width: 100%; padding: 8px; border-radius: 4px; border: 1px solid var(--border-primary); background: var(--bg-tertiary); color: var(--text-primary);">
                                </select>
                            </div>
                            <div class="form-group" style="margin-bottom: 15px;">
                                <label for="selGroundTerminal" style="display:block; margin-bottom: 5px;">Ground Terminal (Ref):</label>
                                <select id="selGroundTerminal" class="modal-select" style="width: 100%; padding: 8px; border-radius: 4px; border: 1px solid var(--border-primary); background: var(--bg-tertiary); color: var(--text-primary);">
                                </select>
                            </div>
                        </div>

                        <!-- Group Plot UI (Wire Selection) -->
                        <div id="uiGroupPlot" style="display: none;">
                            <div class="form-group" style="display: flex; align-items: center; gap: 10px; margin-bottom: 15px;">
                                <label style="min-width: 140px; margin-bottom: 0;">Input Terminal (Port 1):</label>
                                <span id="lblInputTerminal" class="value-input" style="flex: 1; padding: 5px 8px; border: 1px solid var(--border-color); background-color: var(--bg-input); color: var(--text-color); border-radius: 4px; line-height: 20px; user-select: none; cursor: default;">None</span>
                                <button id="btnSelInput" class="btn secondary" style="min-width: 30px; padding: 4px 8px;" title="Select Wire from Canvas">🔍</button>
                            </div>

                            <div class="form-group" style="display: flex; align-items: center; gap: 10px; margin-bottom: 15px;">
                                <label style="min-width: 140px; margin-bottom: 0;">Ground Terminal (Ref):</label>
                                <span id="lblGroundTerminal" class="value-input" style="flex: 1; padding: 5px 8px; border: 1px solid var(--border-color); background-color: var(--bg-input); color: var(--text-color); border-radius: 4px; line-height: 20px; user-select: none; cursor: default;">None</span>
                                <button id="btnSelGround" class="btn secondary" style="min-width: 30px; padding: 4px 8px;" title="Select Wire from Canvas">🔍</button>
                            </div>
                        </div>

                        <div class="form-group" style="margin-top: 15px;">
                            <label style="display: flex; align-items: center; cursor: pointer;">
                                <input type="checkbox" id="impEnablePlot" style="margin-right: 8px;">
                                Enable Plot on Simulation
                            </label>
                            <small style="color: #888; display: block; margin-top: 4px;">
                                If enabled, this component's impedance will be plotted automatically during circuit simulation.
                            </small>
                        </div>

                        <div id="impError" style="color: #ff6b6b; margin-top: 10px; font-size: 12px; display: none;"></div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn secondary" id="btnCancelImp">Cancel</button>
                        <button class="btn primary" id="btnPlotImp">Save</button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);

        this.modal = document.getElementById('impedanceConfigModal');
        const closeBtn = this.modal.querySelector('.close');
        const cancelBtn = document.getElementById('btnCancelImp');
        const saveBtn = document.getElementById('btnPlotImp');

        closeBtn.onclick = () => this.hide();
        cancelBtn.onclick = () => this.hide();
        saveBtn.onclick = () => this.handleSave(); // Renamed handler

        // Close on outside click
        window.addEventListener('click', (e) => {
            if (e.target === this.modal) {
                this.hide();
            }
        });

        // Wire Selection Buttons
        const btnSelInput = document.getElementById('btnSelInput');
        const btnSelGround = document.getElementById('btnSelGround');

        btnSelInput.onclick = () => this.startWireSelection('input');
        btnSelGround.onclick = () => this.startWireSelection('ground');
    }

    startWireSelection(type) {
        if (!this.targetGroup) {
            alert("Wire selection is only available for Group Plots.");
            return;
        }

        // Hide modal temporarily
        this.modal.style.display = 'none';

        if (window.dragDropHandler) {
            // Pass this.contextComponent which is the IntegratedComponent (Block) if we are in Group mode
            window.dragDropHandler.selectWireForImpedance(type, (id, terminal) => {
                // Callback when item is selected
                this.modal.style.display = 'block'; // Show modal again

                const labelId = type === 'input' ? 'lblInputTerminal' : 'lblGroundTerminal';
                const labelEl = document.getElementById(labelId);

                let value, label;

                if (terminal) {
                    // Component Terminal Selected
                    value = `${id}:${terminal}`;
                    label = `${id} (${terminal})`;
                } else {
                    // Wire Selected
                    value = `Wire:${id}`;
                    const parts = id.split('_');
                    label = parts.length > 1 ? `Wire #${parts[1]}` : `Wire ${id}`;
                }

                labelEl.textContent = label;
                labelEl.dataset.value = value;
                labelEl.style.color = 'var(--text-color)'; // Active color
                labelEl.style.fontStyle = 'normal';
            }, this.contextComponent); // Pass context scope
        }
    }

    open(target, onPlotCallback, secondaryTarget = [], defaultConfig = null, contextComponent = null) {
        this.onPlot = onPlotCallback;
        this.contextComponent = contextComponent;

        let components = [];
        let wires = [];
        let isGroup = false;

        if (Array.isArray(target)) {
            components = target;
            wires = secondaryTarget || [];
            if (components.length > 1) isGroup = true;
            this.component = null; // Clear single component ref
            this.targetGroup = { components, wires }; // Store group ref
        } else {
            this.component = target;
            components = [target];
            isGroup = false;
            this.targetGroup = null;
        }

        // UI Elements
        const uiSingle = document.getElementById('uiSingleComponent');
        const uiGroup = document.getElementById('uiGroupPlot');
        const enableCheckbox = document.getElementById('impEnablePlot');
        const title = this.modal.querySelector('.modal-header h2');
        const err = document.getElementById('impError');
        if (err) err.style.display = 'none';

        // Set Title & Mode
        if (isGroup) {
            title.textContent = "Test Port Configuration";
        } else {
            title.textContent = "Component Simulation Settings";
        }
        uiSingle.style.display = isGroup ? 'none' : 'block';
        uiGroup.style.display = isGroup ? 'block' : 'none';

        // Reset Checkbox
        enableCheckbox.checked = false;

        if (isGroup) {
            // --- Group Plot Logic (Existing) ---
            const inputLabel = document.getElementById('lblInputTerminal');
            const groundLabel = document.getElementById('lblGroundTerminal');

            // Reset Labels
            const setNone = (el) => {
                el.textContent = "None";
                el.dataset.value = "";
                el.style.color = "var(--text-muted)";
                el.style.fontStyle = 'italic';
            };
            setNone(inputLabel);
            setNone(groundLabel);

            // Load Config
            this.existingGroupId = null;
            const currentIds = components.map(c => c.id);
            const existingGroup = this.findMatchingGroup(currentIds);

            if (existingGroup) {
                this.existingGroupId = existingGroup.id;
                enableCheckbox.checked = existingGroup.enabled;

                const inputVal = `${existingGroup.inputLocation.componentId}:${existingGroup.inputLocation.terminal}`;
                const groundVal = `${existingGroup.outputLocation.componentId}:${existingGroup.outputLocation.terminal}`;

                // Helper to restore label text
                const setLabel = (el, val, loc) => {
                    el.dataset.value = val;
                    el.style.color = "var(--text-color)";
                    el.style.fontStyle = 'normal';
                    if (loc.componentId.startsWith('Wire_')) {
                        const parts = loc.componentId.split('_');
                        el.textContent = parts.length > 1 ? `Wire #${parts[1]}` : loc.componentId;
                    } else {
                        el.textContent = `${loc.componentId} (${loc.terminal})`;
                    }
                };

                setLabel(inputLabel, inputVal, existingGroup.inputLocation);
                setLabel(groundLabel, groundVal, existingGroup.outputLocation);
            } else if (this.contextComponent && defaultConfig) {
                // --- CASE: Integrated Component Context ---
                // Pre-fill from internalPortConfig if no global group exists
                if (defaultConfig.inputTerminal) {
                    const [id, term] = defaultConfig.inputTerminal.split(':');
                    const loc = { componentId: id, terminal: term };
                    setLabel(inputLabel, defaultConfig.inputTerminal, loc);
                }
                if (defaultConfig.groundTerminal) {
                    const [id, term] = defaultConfig.groundTerminal.split(':');
                    const loc = { componentId: id, terminal: term };
                    setLabel(groundLabel, defaultConfig.groundTerminal, loc);
                }
            }

        } else {
            // --- Single Component Logic (Restored Dropdown) ---
            const comp = components[0];
            const selInput = document.getElementById('selInputTerminal');
            const selGround = document.getElementById('selGroundTerminal');

            // Populate Dropdowns
            selInput.innerHTML = '';
            selGround.innerHTML = '';

            const terminals = Object.keys(comp.terminals);
            terminals.forEach(term => {
                // Name Mapping: start->Left, end->Right
                let displayName = term;
                if (term === 'start') displayName = 'Left';
                if (term === 'end') displayName = 'Right';

                const opt1 = document.createElement('option');
                opt1.value = term;
                opt1.textContent = displayName;
                selInput.appendChild(opt1);

                const opt2 = document.createElement('option');
                opt2.value = term;
                opt2.textContent = displayName;
                selGround.appendChild(opt2);
            });

            // Load Config or Default
            if (comp.impedanceConfig) {
                if (comp.impedanceConfig.enabled) enableCheckbox.checked = true;
                if (comp.impedanceConfig.inputTerminal) selInput.value = comp.impedanceConfig.inputTerminal;
                if (comp.impedanceConfig.groundTerminal) selGround.value = comp.impedanceConfig.groundTerminal;
            } else {
                // Default: Input=start(Left), Ground=end(Right)
                if (terminals.includes('start')) selInput.value = 'start';
                if (terminals.includes('end')) selGround.value = 'end';
            }
        }

        this.modal.style.display = 'block';
    }

    hide() {
        this.modal.style.display = 'none';
        this.component = null;
        this.targetGroup = null;
        this.contextComponent = null;
        this.onPlot = null;
        const err = document.getElementById('impError');
        if (err) err.style.display = 'none';
    }

    handleSave() {
        const enabled = document.getElementById('impEnablePlot').checked;
        let inputTermVal = "";
        let groundTermVal = "";

        if (this.targetGroup) {
            // Group Mode: Read from Labels
            const inputLabel = document.getElementById('lblInputTerminal');
            const groundLabel = document.getElementById('lblGroundTerminal');
            inputTermVal = inputLabel ? inputLabel.dataset.value : "";
            groundTermVal = groundLabel ? groundLabel.dataset.value : "";
        } else {
            // Single Mode: Read from Dropdowns
            const selInput = document.getElementById('selInputTerminal');
            const selGround = document.getElementById('selGroundTerminal');
            inputTermVal = selInput ? selInput.value : "";
            groundTermVal = selGround ? selGround.value : "";
        }

        // Validation
        if (!inputTermVal || !groundTermVal) {
            const err = document.getElementById('impError');
            err.textContent = "Please select both Input and Ground terminals.";
            err.style.display = 'block';
            return;
        }

        if (inputTermVal === groundTermVal) {
            const err = document.getElementById('impError');
            err.textContent = "Input and Ground terminals cannot be the same.";
            err.style.display = 'block';
            return;
        }

        // Save Logic
        if (this.targetGroup) {
            // CASE: Group Plot
            const inputParts = inputTermVal.split(':');
            const groundParts = groundTermVal.split(':');

            let groupName = `Group Plot ${window.circuit.groupPlots.length + 1}`;
            let targetIndex = window.circuit.groupPlots.length;

            if (this.existingGroupId) {
                const existingIdx = window.circuit.groupPlots.findIndex(g => g.id === this.existingGroupId);
                if (existingIdx >= 0) targetIndex = existingIdx;
            }

            const hue = (targetIndex * 137.5) % 360;
            let groupColor = `hsl(${hue}, 70%, 50%)`;

            if (this.existingGroupId) {
                const existing = window.circuit.groupPlots.find(g => g.id === this.existingGroupId);
                if (existing) {
                    groupName = existing.name;
                    if (existing.color && existing.color !== '#ff00ff') groupColor = existing.color;
                }
            }

            const groupConfig = {
                id: this.existingGroupId || `group_${Date.now()}`,
                name: groupName,
                componentIds: this.targetGroup.components.map(c => c.id),
                wireIds: this.targetGroup.wires.map(w => w.id),
                inputLocation: { componentId: inputParts[0], terminal: inputParts[1] },
                outputLocation: { componentId: groundParts[0], terminal: groundParts[1] },
                enabled: enabled,
                color: groupColor,
                integratedComponentId: this.contextComponent ? this.contextComponent.id : null
            };

            window.circuit.addGroupPlot(groupConfig);

            // --- SYNC: If this group belongs to an IntegratedComponent, update it ---
            if (this.contextComponent) {
                this.contextComponent.internalPortConfig = {
                    inputTerminal: inputParts.join(':'),
                    groundTerminal: groundParts.join(':')
                };
                // Force rebuild of Virtual Circuit so View VC sees the new ports immediately
                if (typeof this.contextComponent.invalidateCache === 'function') {
                    this.contextComponent.invalidateCache();
                }
            }

        } else if (this.component) {
            // CASE: Single Component
            this.component.impedanceConfig = {
                inputTerminal: inputTermVal,
                groundTerminal: groundTermVal,
                enabled: enabled
            };
        }

        // Notify system
        if (window.circuit) {
            window.circuit.notifyChange();
        }

        this.hide();
    }


    findMatchingGroup(componentIds) {
        if (!window.circuit || !window.circuit.groupPlots) return null;

        const sortedIds = [...componentIds].sort();
        const sortedIdsStr = JSON.stringify(sortedIds);

        return window.circuit.groupPlots.find(group => {
            if (!group.componentIds || group.componentIds.length !== sortedIds.length) return false;
            const groupSorted = [...group.componentIds].sort();
            return JSON.stringify(groupSorted) === sortedIdsStr;
        });
    }
}

// Export
window.ImpedanceConfigModal = ImpedanceConfigModal;
