/**
 * Context Menu
 * Handles right-click context menu for components and wires
 */
class ContextMenu {
    constructor() {
        this.menuElement = null;
        this.target = null;
        this.targetType = null; // 'component' or 'wire'
        this.impedanceModal = new ImpedanceConfigModal();
        this.init();
    }

    init() {
        // Create menu element
        this.menuElement = document.createElement('div');
        this.menuElement.className = 'custom-context-menu';
        this.menuElement.style.display = 'none';
        this.menuElement.style.position = 'absolute';
        this.menuElement.style.zIndex = '1000';
        this.menuElement.style.backgroundColor = 'var(--bg-panel)';
        this.menuElement.style.border = '1px solid var(--border-color)';
        this.menuElement.style.borderRadius = '4px';
        this.menuElement.style.padding = '5px 0';
        this.menuElement.style.minWidth = '150px';
        this.menuElement.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';

        document.body.appendChild(this.menuElement);

        // Global click to close
        document.addEventListener('mousedown', (e) => {
            if (!this.menuElement.contains(e.target)) {
                this.hide();
            }
        });

        // Prevent default context menu on this menu
        this.menuElement.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    show(x, y, target, type) {
        this.target = target;
        this.targetType = type;

        this.updateMenuItems();

        // Position
        this.menuElement.style.left = `${x}px`;
        this.menuElement.style.top = `${y}px`;
        this.menuElement.style.display = 'block';

        // Adjust if off-screen
        const rect = this.menuElement.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            this.menuElement.style.left = `${window.innerWidth - rect.width - 5}px`;
        }
        if (rect.bottom > window.innerHeight) {
            this.menuElement.style.top = `${window.innerHeight - rect.height - 5}px`;
        }
    }

    hide() {
        this.menuElement.style.display = 'none';
        this.target = null;
        this.targetType = null;
    }

    updateMenuItems() {
        this.menuElement.innerHTML = '';

        // Handle Multi-Selection
        let effectiveSelection = window.circuit.selectedItems;
        let isGroupSelection = false;

        // ** Check for "Group + Children" Pattern **
        // If the target is an Integrated Component, and the selection consists ONLY of the Group and its children,
        // we treat it as a Single Selection (of the Group).
        if (this.target && this.target.type === 'INTEGRATED') {
            const groupIds = new Set([this.target.id, ...this.target.componentIds, ...this.target.wireIds]);
            const selectedIds = Array.from(window.circuit.selectedItems);

            // Check if ALL selected items are part of this group
            const isPureGroupSelection = selectedIds.every(id => groupIds.has(id));

            if (isPureGroupSelection) {
                isGroupSelection = true;
            }
        }

        // Handle Multi-Selection (bypassed if it's a pure group selection)
        if (!isGroupSelection && window.circuit && window.circuit.selectedItems.size > 1) {
            const selectionCount = window.circuit.selectedItems.size;

            // Title
            this.createTitle(`Selection (${selectionCount})`);

            // Merge Components Option
            const components = Array.from(window.circuit.selectedItems)
                .map(id => window.circuit.getComponent(id))
                .filter(c => c);

            // Only show Merge if we have components (not just wires)
            if (components.length >= 2) {
                // ... Merge item ... (Existing code)

            }


            // --- NEW: Configure Test Ports (Group) ---
            const groupPlotItem = this.createMenuItem('Configure Test Ports', () => {
                // Logic to open modal for group
                const selectedComponents = components; // Already filtered above
                const selectedWires = Array.from(window.circuit.selectedItems)
                    .map(id => window.circuit.getWire(id))
                    .filter(w => w);

                this.hide();
                if (this.impedanceModal) {
                    // Pass array of components to open method
                    this.impedanceModal.open(selectedComponents, (config) => {
                        // Helper callback if needed
                    }, selectedWires);
                }
            });
            this.menuElement.appendChild(groupPlotItem);



            // Check if selection contains any Integrated Components
            const selectedGroups = components.filter(c => c.type === 'INTEGRATED');
            const hasGroup = selectedGroups.length > 0;

            if (hasGroup) {
                // --- Condition: Group(s) Selected -> Show Dissolve ---
                const ungroupItem = this.createMenuItem('Dissolve Test Block', () => {
                    selectedGroups.forEach(group => {
                        if (window.circuit) window.circuit.ungroupIntegratedComponent(group.id);
                    });
                    this.hide();
                });
                ungroupItem.style.borderTop = '1px solid var(--border-color)';
                this.menuElement.appendChild(ungroupItem);
            } else {
                // --- Condition: No Groups -> Show Create Block ---
                const createIntegratedItem = this.createMenuItem('Create Block', () => {
                    const selectedComponents = components;
                    const selectedWires = Array.from(window.circuit.selectedItems)
                        .map(id => window.circuit.getWire(id))
                        .filter(w => w);

                    this.hide();

                    // Direct Creation without Modal
                    if (window.circuit) {
                        window.circuit.createIntegratedComponent(selectedComponents, selectedWires, null);
                    }
                });
                this.menuElement.appendChild(createIntegratedItem);
            }

            // Delete Selection Option
            this.menuElement.appendChild(this.createMenuItem('Delete', () => {
                const items = Array.from(window.circuit.selectedItems);
                items.forEach(id => {
                    if (window.circuit.components.has(id)) window.circuit.removeComponent(id);
                    else if (window.circuit.wires.has(id)) window.circuit.removeWire(id);
                });
                window.circuit.selectedItems.clear();
                this.hide();
            }, true));
            return;
        }


        if (!this.target) return;

        // Title (ID)
        this.createTitle(this.target.id);

        // --- Handles INTEGRATED Component as Group Plot ---
        if (this.target.type === 'INTEGRATED') {
            const currentTarget = this.target; // Capture target locally
            const groupPlotItem = this.createMenuItem('Configure Test Ports', () => {
                const componentIds = currentTarget.componentIds || [];
                const wireIds = currentTarget.wireIds || [];

                // Resolve objects
                const components = componentIds.map(id => window.circuit.getComponent(id)).filter(c => c);
                const wires = wireIds.map(id => window.circuit.getWire(id)).filter(w => w);

                this.hide();
                if (this.impedanceModal) {
                    // ARGUMENTS: targets, callback, secondaryTargets, defaultConfig, contextComponent
                    this.impedanceModal.open(components, null, wires, currentTarget.internalPortConfig, currentTarget);
                }
            });
            this.menuElement.appendChild(groupPlotItem);

            // --- NEW: View Block Circuit Option ---
            const viewVirtualCircuitItem = this.createMenuItem('View Block Circuit', () => {
                if (window.virtualCircuitModal) {
                    window.virtualCircuitModal.open(this.target);
                    // this.hide(); // createMenuItem usually handles click? NO, the callback handles logic.
                    // The createMenuItem helper likely doesn't auto-hide if we provide callback? 
                    // Checking existing code: createMenuItem(text, onClick) -> onClick wrapper usually calls logic.
                    // The existing calls invoke this.hide() manually inside.
                } else {
                    console.error('VirtualCircuitModal not found');
                }
                this.hide();
            });
            viewVirtualCircuitItem.style.borderTop = '1px solid var(--border-color)';
            this.menuElement.appendChild(viewVirtualCircuitItem);

            // --- NEW: Dissolve Option ---
            const ungroupItem = this.createMenuItem('Dissolve Block', () => {
                if (window.circuit) {
                    window.circuit.ungroupIntegratedComponent(this.target.id);
                }
                this.hide();
            });
            // Separator style or just append
            ungroupItem.style.borderTop = '1px solid var(--border-color)';
            this.menuElement.appendChild(ungroupItem);

        } else {
            // Simulate Component Option (Single)
            // Opens configuration modal to invoke single component simulation
            const impedanceItem = this.createMenuItem('Simulate Component', () => {
                const currentTarget = this.target; // Capture target before hiding menu
                this.hide();
                if (this.impedanceModal && currentTarget) {
                    this.impedanceModal.open(currentTarget, (component) => {
                        // Trigger Simulation after config
                        if (window.simulationController && window.simulationController.plotSingleComponentImp) {
                            window.simulationController.plotSingleComponentImp(component);
                        } else {
                            console.error('Simulation Controller not found');
                        }
                    });
                }
            });

            // Add visual indicator if config exists
            if (this.target.impedanceConfig) {
                impedanceItem.innerHTML += ' <span style="color:#4caf50; font-size:10px;">●</span>';
            }
            this.menuElement.appendChild(impedanceItem);
        }

        // Delete (Single)
        this.menuElement.appendChild(this.createMenuItem('Delete', () => {
            if (window.circuit) {
                if (this.targetType === 'component') {
                    window.circuit.removeComponent(this.target.id);
                } else if (this.targetType === 'wire') {
                    window.circuit.removeWire(this.target.id);
                }
            }
            this.hide();
        }, true));
    }

    createTitle(text) {
        const titleItem = document.createElement('div');
        titleItem.className = 'context-menu-item title';
        titleItem.style.padding = '5px 10px';
        titleItem.style.fontWeight = 'bold';
        titleItem.style.borderBottom = '1px solid var(--border-color)';
        titleItem.style.marginBottom = '5px';
        titleItem.textContent = text;
        this.menuElement.appendChild(titleItem);
    }

    createMenuItem(text, onClick, isWarning = false) {
        const item = document.createElement('div');
        item.className = `context-menu-item ${isWarning ? 'warning' : ''}`;
        item.style.padding = '5px 10px';
        item.style.cursor = 'pointer';
        if (isWarning) item.style.color = 'var(--accent-danger)';
        item.textContent = text;

        item.onmouseover = () => item.style.backgroundColor = 'var(--bg-hover)';
        item.onmouseout = () => item.style.backgroundColor = 'transparent';

        item.onclick = onClick;
        return item;
    }

    toggleVoltageShow(show) {
        if (this.target) {
            this.target.showVoltage = show;
            // Trigger visual update
            if (this.target.render) this.target.render();
        }
    }

    toggleImpedanceShow(show) {
        if (this.target) {
            this.target.showImpedance = show;
            // 그래프 갱신
            if (window.sParameterGraph) {
                window.sParameterGraph.refreshData();
            }

            // Run Mode일 경우 시뮬레이션 트리거 (실시간 업데이트)
            if (window.simulationController) {
                window.simulationController.onCircuitChange();
            }
        }
    }
}

window.ContextMenu = ContextMenu;
