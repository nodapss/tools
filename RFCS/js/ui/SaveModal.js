/**
 * SaveModal.js
 * Manages the Save Modal for exporting Circuit data in JSON and Falstad formats.
 */
class SaveModal {
    constructor() {
        this.modal = null;
        this.filenameInput = null;
        this.init();
    }

    init() {
        this.createModal();
        this.bindEvents();
    }

    createModal() {
        // Create modal structure if it doesn't exist
        if (document.getElementById('saveModal')) return;

        const modal = document.createElement('div');
        modal.id = 'saveModal';
        modal.className = 'modal';

        // Simplified structure: Header + Compact Body/Footer
        // Using inline styles for specific sizing requested "adjust size accordingly"
        modal.innerHTML = `
            <div class="modal-overlay"></div>
            <div class="modal-content" style="width: 400px; max-width: 90%; height: auto; display: flex; flex-direction: column;">
                <div class="modal-header">
                    <h3>Save Circuit</h3>
                    <button class="modal-close" id="btnCloseSaveModal">&times;</button>
                </div>
                
                <div class="modal-body" style="padding: 20px; display: flex; flex-direction: column; gap: 15px;">
                    <!-- Paint Toggle -->
                    <div style="display: flex; align-items: center;" title="Include Paint Drawings">
                        <input type="checkbox" id="chkIncludePaint" style="margin-right: 8px;">
                        <label for="chkIncludePaint" style="color: var(--text-primary); font-size: 14px; cursor: pointer;">Include Paint</label>
                    </div>

                    <!-- Filename Input -->
                    <div style="display: flex; flex-direction: column; gap: 5px;">
                        <label style="color: var(--text-primary); font-size: 14px; font-weight: 500;">File Name:</label>
                        <div class="input-group" style="display: flex; align-items: center;">
                            <input type="text" id="saveFilename" value="circuit" 
                                style="padding: 8px; border: 1px solid var(--border-color); border-right: none; border-radius: 4px 0 0 4px; background: var(--bg-primary); color: var(--text-primary); flex: 1;">
                            <span class="input-suffix" 
                                style="padding: 8px 12px; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 0 4px 4px 0; color: var(--text-secondary); font-family: monospace;">.json</span>
                        </div>
                    </div>
                </div>

                <div class="modal-footer" style="padding: 15px 20px; border-top: 1px solid var(--border-color); display: flex; justify-content: flex-end; gap: 10px;">
                    <button class="btn secondary" id="btnCancelSave">Cancel</button>
                    <button class="btn primary" id="btnDownloadSave">Save (Download)</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        this.modal = modal;
        this.filenameInput = document.getElementById('saveFilename');
    }

    bindEvents() {
        // Close / Cancel
        const closeBtn = document.getElementById('btnCloseSaveModal');
        const cancelBtn = document.getElementById('btnCancelSave');
        const overlay = this.modal.querySelector('.modal-overlay');

        const closeAction = () => this.close();
        if (closeBtn) closeBtn.addEventListener('click', closeAction);
        if (cancelBtn) cancelBtn.addEventListener('click', closeAction);
        if (overlay) overlay.addEventListener('click', closeAction);

        // Download
        const downloadBtn = document.getElementById('btnDownloadSave');
        if (downloadBtn) downloadBtn.addEventListener('click', () => this.download());

        // Ctrl+S or Enter on input? (Optional enhancement, not strictly requested but good UX)
        if (this.filenameInput) {
            this.filenameInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') this.download();
            });
        }
    }

    open() {
        if (!this.modal) this.createModal();
        this.modal.classList.add('active');
        // Focus filename input
        if (this.filenameInput) {
            this.filenameInput.focus();
            this.filenameInput.select();
        }
    }

    close() {
        if (this.modal) this.modal.classList.remove('active');
    }

    generateJson() {
        if (!window.circuit) return '{}';

        const circuitData = window.circuit.toJSON();
        const simSettings = {
            freqStart: document.getElementById('freqStart')?.value || 1,
            freqStartUnit: document.getElementById('freqStartUnit')?.value || 1e6,
            freqEnd: document.getElementById('freqEnd')?.value || 100,
            freqEndUnit: document.getElementById('freqEndUnit')?.value || 1e6,
            freqPoints: document.getElementById('freqPoints')?.value || 201
        };

        let graphSettings = {};
        if (window.graphController) {
            graphSettings = window.graphController.getSettings();
        } else if (window.sParamGraph) {
            graphSettings = {
                format: window.sParamGraph.currentFormat,
                meas: window.sParamGraph.currentMeas,
                xAxisScale: window.sParamGraph.currentXAxisScale,
                animation: window.sParamGraph.config.animation
            };
        }

        const saveData = {
            version: '1.0',
            circuit: circuitData,
            simulation: simSettings,
            graph: graphSettings,
            timestamp: new Date().toISOString()
        };

        // Include Paint Data if requested
        const chkIncludePaint = document.getElementById('chkIncludePaint');
        const includePaint = chkIncludePaint?.checked;

        if (includePaint && window.drawingManager) {
            saveData.paint = window.drawingManager.getPaintData();
        }

        return JSON.stringify(saveData, null, 2);
    }

    download() {
        const content = this.generateJson();
        const filename = this.filenameInput.value.trim() || 'circuit';
        const fullFilename = filename + '.json';
        const mimeType = 'application/json';

        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = fullFilename;
        a.click();

        URL.revokeObjectURL(url);
        this.close();
    }
}

window.SaveModal = SaveModal;
