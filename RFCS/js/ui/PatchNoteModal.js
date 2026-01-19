/**
 * PatchNoteModal.js
 * Displays the changelog from PatchNote.txt in a modal.
 */
class PatchNoteModal {
    constructor() {
        this.modal = null;
        this.data = null;
        this.init();
    }

    init() {
        this.createModal();
        this.loadData();
    }

    createModal() {
        if (document.getElementById('patchNoteModal')) return;

        // Styles
        const styleId = 'patch-note-styles';
        if (!document.getElementById(styleId)) {
            const style = document.createElement('style');
            style.id = styleId;
            style.textContent = `
                .patch-note-modal {
                    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                    background: rgba(0, 0, 0, 0.5); z-index: 2000;
                    display: none; align-items: center; justify-content: center;
                }
                .patch-note-content {
                    background: var(--bg-secondary);
                    width: 600px; max-width: 90%; max-height: 80vh;
                    border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.5);
                    display: flex; flex-direction: column;
                    border: 1px solid var(--border-primary);
                }
                .patch-note-header {
                    padding: 15px 20px; border-bottom: 1px solid var(--border-primary);
                    display: flex; justify-content: space-between; align-items: center;
                    background: var(--bg-tertiary); border-radius: 8px 8px 0 0;
                }
                .patch-note-header h3 { margin: 0; color: var(--text-primary); font-size: 1.2rem; }
                .patch-note-close {
                    background: none; border: none; color: var(--text-secondary);
                    font-size: 1.5rem; cursor: pointer; padding: 0; line-height: 1;
                }
                .patch-note-close:hover { color: var(--text-primary); }
                .patch-note-body {
                    padding: 20px; overflow-y: auto; color: var(--text-primary);
                }
                .patch-version-block { margin-bottom: 25px; }
                .patch-version-header {
                    font-size: 1.1em; font-weight: bold; color: var(--accent-primary);
                    margin-bottom: 15px; padding-bottom: 5px; border-bottom: 1px solid var(--border-secondary);
                    display: flex; justify-content: space-between;
                }
                .patch-date { font-size: 0.9em; color: var(--text-muted); font-weight: normal; }
                .patch-log-item { margin-bottom: 12px; }
                .patch-log-title { font-weight: 500; margin-bottom: 4px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;}
                .patch-badge {
                    font-size: 0.75em; padding: 2px 6px; border-radius: 4px;
                    background: var(--bg-active); color: var(--text-accent);
                    font-weight: normal;
                }
                .patch-details-list {
                    list-style: none; padding-left: 15px; margin: 0;
                    border-left: 2px solid var(--border-secondary);
                }
                .patch-detail-item {
                    font-size: 0.9em; color: var(--text-secondary); margin-bottom: 3px;
                    position: relative; padding-left: 10px;
                }
                .patch-detail-item::before {
                    content: "•"; position: absolute; left: -2px; color: var(--text-muted);
                }
                .patch-note-footer {
                    padding: 15px 20px; border-top: 1px solid var(--border-primary);
                    display: flex; justify-content: flex-end;
                    background: var(--bg-tertiary); border-radius: 0 0 8px 8px;
                }
            `;
            document.head.appendChild(style);
        }

        // HTML
        const modalDiv = document.createElement('div');
        modalDiv.id = 'patchNoteModal';
        modalDiv.className = 'patch-note-modal';
        modalDiv.innerHTML = `
            <div class="patch-note-content">
                <div class="patch-note-header">
                    <h3>Patch Note</h3>
                    <button class="patch-note-close">&times;</button>
                </div>
                <div class="patch-note-body" id="patchNoteBody">
                    <div style="text-align: center; color: var(--text-muted);">Loading...</div>
                </div>
                <div class="patch-note-footer" style="justify-content: space-between;">
                    <label style="display: flex; align-items: center; color: var(--text-secondary); cursor: pointer; user-select: none;">
                        <input type="checkbox" id="chkDontShowAgain" style="margin-right: 8px;">
                        Don't show for 3 days
                    </label>
                    <button class="btn primary" id="btnClosePatchNote">Close</button>
                </div>
            </div>
        `;

        document.body.appendChild(modalDiv);
        this.modal = modalDiv;

        // Events
        modalDiv.addEventListener('click', (e) => {
            if (e.target === modalDiv) this.close();
        });
        modalDiv.querySelector('.patch-note-close').addEventListener('click', () => this.close());
        modalDiv.querySelector('#btnClosePatchNote').addEventListener('click', () => this.close());
    }

    async loadData() {
        try {
            if (typeof PatchNoteParser === 'undefined') {
                console.error("PatchNoteParser is not loaded.");
                return;
            }

            const response = await fetch('PatchNote.txt');
            if (!response.ok) throw new Error("Failed to load PatchNote.txt");
            const text = await response.text();

            this.data = PatchNoteParser.parse(text);

            // Initialize pagination state
            this.currentMonths = 1; // display range in months
            this.today = new Date();

            this.render();
        } catch (e) {
            console.error("PatchNote load error:", e);
            document.getElementById('patchNoteBody').innerHTML =
                `<div style="color: var(--accent-danger);">Failed to load patch notes.</div>`;
        }
    }

    parseDate(dateStr) {
        // Expected format: YYYY.MM.DD
        const parts = dateStr.split('.');
        if (parts.length === 3) {
            return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        }
        return null;
    }

    render() {
        const body = document.getElementById('patchNoteBody');
        if (!body || !this.data) return;

        body.innerHTML = '';

        // Calculate cutoff date based on currentMonths
        const cutoffDate = new Date(this.today);
        cutoffDate.setMonth(cutoffDate.getMonth() - this.currentMonths);
        // Reset time portion to start of day for accurate comparison
        cutoffDate.setHours(0, 0, 0, 0);

        // Filter data based on cutoff date
        // Sort versions descending (newest first)
        const allVersions = [...this.data].reverse();

        const filteredVersions = [];
        let hasHiddenItems = false;

        allVersions.forEach(ver => {
            const verDate = this.parseDate(ver.date);
            if (verDate && verDate >= cutoffDate) {
                filteredVersions.push(ver);
            } else {
                hasHiddenItems = true;
            }
        });

        // 렌더링 시작
        let htmlContent = '';

        filteredVersions.forEach(ver => {
            // Build Version Block HTML
            let logItems = '';
            ver.changelogs.forEach(log => {
                let badges = '';
                if (log.requester) badges += `<span class="patch-badge" title="Requester">Req: ${log.requester}</span>`;
                if (log.updater) badges += `<span class="patch-badge" title="Updater">Upd: ${log.updater}</span>`;

                let detailsHtml = '';
                if (log.details && log.details.length > 0) {
                    const lis = log.details.map(detail => `<li class="patch-detail-item">${detail.content}</li>`).join('');
                    detailsHtml = `<ul class="patch-details-list">${lis}</ul>`;
                }

                logItems += `
                    <div class="patch-log-item">
                        <div class="patch-log-title">${log.content} ${badges}</div>
                        ${detailsHtml}
                    </div>
                `;
            });

            htmlContent += `
                <div class="patch-version-block">
                    <div class="patch-version-header">
                        <span>${ver.version}</span>
                        <span class="patch-date">${ver.date}</span>
                    </div>
                    ${logItems}
                </div>
            `;
        });

        // Add More Button if needed
        if (hasHiddenItems) {
            htmlContent += `
                <div style="text-align: center; margin-top: 20px;">
                    <button id="btnLoadMoreNotes" class="btn secondary" style="width: 100%;">
                        Load More (Earlier than ${this.currentMonths} month${this.currentMonths > 1 ? 's' : ''})
                    </button>
                </div>
            `;
        } else if (filteredVersions.length === 0) {
            htmlContent = `<div style="text-align: center; color: var(--text-muted); padding: 20px;">No patch notes found in the last ${this.currentMonths} month(s).</div>`;
            if (hasHiddenItems) {
                htmlContent += `
                    <div style="text-align: center; margin-top: 20px;">
                        <button id="btnLoadMoreNotes" class="btn secondary" style="width: 100%;">
                            Load More
                        </button>
                    </div>
                 `;
            }
        }

        body.innerHTML = htmlContent;

        // Bind Load More Click
        const btnMore = body.querySelector('#btnLoadMoreNotes');
        if (btnMore) {
            btnMore.addEventListener('click', () => {
                this.currentMonths++;
                this.render();
            });
        }
    }

    autoShow() {
        const hideUntil = localStorage.getItem('patchNoteHideUntil');
        if (hideUntil) {
            const expiry = parseInt(hideUntil, 10);
            if (Date.now() < expiry) {
                console.log('PatchNote hidden until:', new Date(expiry));
                return; // Suppressed
            }
        }
        this.show();
    }

    show() {
        if (this.modal) {
            this.modal.style.display = 'flex';

            // Sync checkbox state with localStorage (if active suppression exists, check it)
            const hideUntil = localStorage.getItem('patchNoteHideUntil');
            const checkbox = this.modal.querySelector('#chkDontShowAgain');
            if (checkbox) {
                if (hideUntil && Date.now() < parseInt(hideUntil, 10)) {
                    checkbox.checked = true;
                } else {
                    checkbox.checked = false;
                }
            }
        }
    }

    close() {
        if (this.modal) {
            this.modal.style.display = 'none';

            // Handle Don't Show Again logic
            const checkbox = this.modal.querySelector('#chkDontShowAgain');
            if (checkbox && checkbox.checked) {
                const expiry = Date.now() + (3 * 24 * 60 * 60 * 1000); // 3 days
                localStorage.setItem('patchNoteHideUntil', expiry);
            } else {
                localStorage.removeItem('patchNoteHideUntil');
            }
        }
    }
}

// Global instance
window.patchNoteModal = null; // Will be init in main or self-init if script loaded late
