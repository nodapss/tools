/**
 * RF Circuit Calculator - Main Entry Point
 * Initializes all modules and starts the application
 */

// Global instances
let circuit;
let canvasManager;
let dragDropHandler;
let wireManager;
let toolbar;
let propertyPanel;
let calculator;

let componentModal;
let inlineSlider;
let valueEditor;

// Controllers & Managers
let simulationController;
let graphController;
let notificationManager;
let shortcutHandler;
let drawingManager;

/**
 * Initialize the application
 */
function initApp() {
    console.log('Initializing RF Circuit Calculator...');

    // Initialize UI Managers
    notificationManager = new NotificationManager();
    window.notificationManager = notificationManager;

    // Initialize circuit model
    circuit = new Circuit();
    window.circuit = circuit;

    // Initialize canvas manager
    const svg = document.getElementById('circuitCanvas');
    canvasManager = new CanvasManager(svg, circuit);
    window.canvasManager = canvasManager;

    // Initialize drag/drop handler
    dragDropHandler = new DragDropHandler(canvasManager, circuit);
    window.dragDropHandler = dragDropHandler;

    // Initialize wire manager
    wireManager = new WireManager(canvasManager, circuit);
    window.wireManager = wireManager;

    // Initialize toolbar
    toolbar = new Toolbar(dragDropHandler, wireManager);
    window.toolbar = toolbar;

    // Initialize property panel
    propertyPanel = new PropertyPanel(circuit);
    window.propertyPanel = propertyPanel;

    // Initialize calculator
    calculator = new Calculator(circuit);
    window.calculator = calculator;

    // Initialize S-Parameter graph
    try {
        sParamGraph = new SParameterGraph('s11Graph');
        window.sParamGraph = sParamGraph;
        window.s11Graph = sParamGraph; // Compatibility
    } catch (error) {
        console.error('Failed to initialize graph:', error);
        if (notificationManager) notificationManager.show('그래프 모듈 초기화 실패: ' + error.message, 'error');
    }

    // Initialize resize handler
    resizeHandler = new ResizeHandler();
    window.resizeHandler = resizeHandler;

    // Initialize component modal
    componentModal = new ComponentModal();
    window.componentModal = componentModal;

    // Initialize inline slider
    inlineSlider = new InlineSlider(circuit);
    window.inlineSlider = inlineSlider;

    // Initialize value editor
    valueEditor = new ValueEditor(circuit);
    window.valueEditor = valueEditor;

    // Initialize script modal
    try {
        scriptModal = new ScriptModal();
        window.scriptModal = scriptModal;
    } catch (error) {
        console.error('Failed to initialize script modal:', error);
    }

    // Initialize Save Modal
    try {
        window.saveModal = new SaveModal();
    } catch (error) {
        console.error('Failed to initialize save modal:', error);
    }

    // --- Initialize Controllers ---

    // Simulation Controller
    simulationController = new SimulationController(calculator, sParamGraph);
    window.simulationController = simulationController;
    simulationController.setupCallbacks();

    // Graph Controller
    graphController = new GraphController(sParamGraph, circuit, simulationController);
    window.graphController = graphController;

    // Connect controllers
    simulationController.setGraphSettingsController(graphController);

    // Bind circuit change event
    circuit.onChange = () => {
        canvasManager.renderComponents();
        toolbar.updateCircuitInfo();
        simulationController.onCircuitChange();
    };

    // Bind Run Mode button
    const btnRunMode = document.getElementById('btnRunMode');
    if (btnRunMode) {
        btnRunMode.addEventListener('click', () => simulationController.toggleRunMode());
    }

    // Bind Single Shot button
    const btnSingleShot = document.getElementById('btnSingleShot');
    if (btnSingleShot) {
        btnSingleShot.addEventListener('click', () => simulationController.runSingleShot());
    }

    // Bind Script button
    const btnScript = document.getElementById('btnScript');
    if (btnScript && scriptModal) {
        btnScript.addEventListener('click', () => scriptModal.open());
    }

    // Bind Frequency Input Triggers
    const freqInputs = ['freqStart', 'freqEnd', 'freqPoints'];
    freqInputs.forEach(id => {
        const input = document.getElementById(id);
        if (!input) return;

        // Trigger simulation when value is committed (Enter or Blur)
        input.addEventListener('change', () => {
            if (simulationController) {
                if (simulationController.isRunMode) {
                    // Update graph view if frequency changed in Run Mode
                    simulationController.runSimulation(true);
                }
            }
        });

        // Force commit on Enter key
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                input.blur(); // Triggers 'change' event if value changed
            }
        });
    });

    // Bind Sidebar Buttons
    const btnToggleSidebar = document.getElementById('btnToggleSidebar');
    const quickSettingsSidebar = document.getElementById('quickSettingsSidebar');












    // Initialize Shortcut Handler
    shortcutHandler = new ShortcutHandler(circuit, canvasManager);
    window.shortcutHandler = shortcutHandler;

    // Initialize Settings Modal & Shortcut Modal
    window.settingsModal = new SettingsModal();
    window.shortcutModal = new ShortcutModal(shortcutHandler);

    // Initialize Drawing Manager
    drawingManager = new DrawingManager(canvasManager);
    window.drawingManager = drawingManager;



    // Initial render
    canvasManager.renderComponents();
    toolbar.updateCircuitInfo();

    // Setup window resize handler
    window.addEventListener('resize', () => {
        if (sParamGraph) sParamGraph.resize();
    });

    console.log('RF Circuit Calculator initialized successfully!');
}

// Start application when DOM is ready
document.addEventListener('DOMContentLoaded', initApp);
