/**
 * ResizeHandler.js
 * 회로 캔버스와 그래프 영역 사이의 리사이즈 핸들러
 */

class ResizeHandler {
    constructor() {
        this.resizeHandle = document.getElementById('resizeHandle');
        this.graphSidebar = document.getElementById('graphSidebar');
        this.mainContent = document.querySelector('.main-content');

        this.isResizing = false;
        this.startX = 0;
        this.startY = 0;
        this.startWidth = 0;
        this.startWidth = 0;
        this.startHeight = 0;
        this.startCircuitHeight = 0; // 회로 영역 높이 저장
        this.minWidth = 250;
        this.minHeight = 200;
        this.minCircuitHeight = 200; // 회로 영역 최소 높이
        this.maxWidthRatio = 0.6; // 최대 60%
        this.maxHeightRatio = 0.8; // 최대 80% (상하 배치 시)

        this.init();
    }

    init() {
        if (!this.resizeHandle || !this.graphSidebar) {
            console.warn('Resize elements not found');
            return;
        }

        // 저장된 레이아웃 복원
        this.restoreLayout();

        // 마우스 이벤트
        this.resizeHandle.addEventListener('mousedown', this.startResize.bind(this));
        document.addEventListener('mousemove', this.resize.bind(this));
        document.addEventListener('mouseup', this.stopResize.bind(this));

        // 터치 이벤트
        this.resizeHandle.addEventListener('touchstart', this.startResize.bind(this), { passive: false });
        document.addEventListener('touchmove', this.resize.bind(this), { passive: false });
        document.addEventListener('touchend', this.stopResize.bind(this));

        // 윈도우 리사이즈 시 제한 체크
        window.addEventListener('resize', this.checkBounds.bind(this));
    }

    startResize(e) {
        // 반응형 모드 체크 제거 (양쪽 모드 지원)
        // if (window.innerWidth < 1200) return;

        e.preventDefault();
        this.isResizing = true;
        this.resizeHandle.classList.add('active');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        // 시작 위치 및 현재 너비 저장
        if (e.type === 'touchstart') {
            this.startX = e.touches[0].clientX;
            this.startY = e.touches[0].clientY;
        } else {
            this.startX = e.clientX;
            this.startY = e.clientY;
        }

        this.startWidth = this.graphSidebar.offsetWidth;
        this.startHeight = this.graphSidebar.offsetHeight; // Graph height (px)
        this.totalHeight = this.mainContent.offsetHeight; // Total container height for % calc

        // Start percentage calculation
        this.startGraphPercent = (this.startHeight / this.totalHeight) * 100;

        // 회로 영역(상단) 높이 측정 (Grid Row 1)
        // 1200 미만일 때 canvas-container (회로 영역)가 첫 번째 row에 해당
        const canvasContainer = document.querySelector('.canvas-container');
        if (canvasContainer) {
            this.startCircuitHeight = canvasContainer.offsetHeight;
        } else {
            this.startCircuitHeight = 0;
        }

        if (window.innerWidth < 1200) {
            document.body.style.cursor = 'row-resize';
        }
    }

    resize(e) {
        if (!this.isResizing) return;

        e.preventDefault();

        const isSmallScreen = window.innerWidth < 1200;

        if (isSmallScreen) {
            // 세로 리사이징 (Vertical)
            const clientY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;
            // Percentage-based resizing
            // deltaY is in pixels. Convert to percentage of total height.
            const deltaY = this.startY - clientY; // Up is positive
            const deltaPercent = (deltaY / this.totalHeight) * 100;

            let newGraphPercent = this.startGraphPercent + deltaPercent;

            // Constraints (e.g., min 20%, max 80%)
            const minPercent = 20;
            const maxPercent = 80;
            newGraphPercent = Math.max(minPercent, Math.min(newGraphPercent, maxPercent));

            const newCircuitPercent = 100 - newGraphPercent;
            this.mainContent.style.gridTemplateRows = `${newCircuitPercent}% ${newGraphPercent}%`;

        } else {
            // 가로 리사이징 (Horizontal)
            const clientX = e.type === 'touchmove' ? e.touches[0].clientX : e.clientX;
            const deltaX = this.startX - clientX;
            let newWidth = this.startWidth + deltaX;

            // 최소/최대 제한
            const maxWidth = this.mainContent.offsetWidth * this.maxWidthRatio;
            newWidth = Math.max(this.minWidth, Math.min(newWidth, maxWidth));

            // 그리드 컬럼 업데이트
            const sidebarWidth = getComputedStyle(document.documentElement)
                .getPropertyValue('--sidebar-width').trim();

            this.mainContent.style.gridTemplateColumns =
                `${sidebarWidth} 1fr ${newWidth}px`;
        }

        // S11Graph 리사이즈 트리거
        if (window.s11Graph) {
            window.s11Graph.resize();
        }
    }

    stopResize() {
        if (!this.isResizing) return;

        this.isResizing = false;
        this.resizeHandle.classList.remove('active');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';

        // 현재 크기 저장
        this.saveLayout();
    }

    saveLayout() {
        if (window.innerWidth < 1200) {
            // Save as percentage
            const height = this.graphSidebar.offsetHeight;
            const total = this.mainContent.offsetHeight;
            const percent = (height / total) * 100;
            localStorage.setItem('graphSidebarPercent', percent.toFixed(2));
            // No need to save circuit percent separately as it's 100 - graph
        } else {
            const width = this.graphSidebar.offsetWidth;
            localStorage.setItem('graphSidebarWidth', width);
        }
    }

    restoreLayout() {
        const sidebarWidth = getComputedStyle(document.documentElement)
            .getPropertyValue('--sidebar-width').trim();

        if (window.innerWidth < 1200) {
            // Restore percentage
            const savedPercent = localStorage.getItem('graphSidebarPercent');
            if (savedPercent) {
                const percent = parseFloat(savedPercent);
                if (!isNaN(percent) && percent >= 10 && percent <= 90) {
                    this.mainContent.style.gridTemplateRows = `${100 - percent}% ${percent}%`;
                    this.mainContent.style.gridTemplateColumns = '';
                    return;
                }
            }
            // Default if no save
            this.mainContent.style.gridTemplateRows = `55% 45%`;
            this.mainContent.style.gridTemplateColumns = '';
        } else {
            // 가로 모드 복원
            const savedWidth = localStorage.getItem('graphSidebarWidth');
            if (savedWidth) {
                const width = parseInt(savedWidth, 10);
                if (width >= this.minWidth) {
                    this.mainContent.style.gridTemplateColumns =
                        `${sidebarWidth} 1fr ${width}px`;
                    // 모드 전환 시 로우 스타일 초기화
                    this.mainContent.style.gridTemplateRows = '';
                }
            }
        }
    }

    checkBounds() {
        // 모드 전환 시 레이아웃 재적용
        this.restoreLayout();
    }

    /**
     * 기본 비율로 리셋
     */
    resetToDefault() {
        this.mainContent.style.gridTemplateColumns = '';
        this.mainContent.style.gridTemplateRows = '';
        localStorage.removeItem('graphSidebarWidth');
        localStorage.removeItem('graphSidebarPercent');
    }
}

// 전역 노출
window.ResizeHandler = ResizeHandler;



