/**
 * Laminaat Planner - Main Application
 *
 * A tool for planning laminate/PVC floor layouts with:
 * - Custom polygon room shapes
 * - Configurable plank dimensions
 * - Floor rotation and offset patterns
 * - Real-time statistics
 */

import { state } from './state.js';
import { createRenderer } from './canvas/renderer.js';
import { generatePlankGrid, calculateStats } from './geometry/plank-grid.js';
import { polygonArea, polygonBounds } from './geometry/polygon.js';
import { fitBoundsToView } from './geometry/transforms.js';
import { initRoomEditor, updateWallsList } from './ui/room-editor.js';
import { initControls, initPanZoom, initFloorDrag } from './ui/controls.js';
import { updateStatsDisplay, updateOverlay } from './ui/stats.js';
import { throttle } from './utils.js';

// Initialize application
function init() {
    const canvas = document.getElementById('canvas');
    if (!canvas) {
        console.error('Canvas element not found');
        return;
    }

    // Create renderer
    const renderer = createRenderer(canvas);

    // Get current transform helper (works in CSS pixels, ctx.scale handles DPR)
    function getTransform() {
        const currentState = state.get();
        return renderer.createTransform(currentState.view);
    }

    // Initialize UI modules
    const roomEditor = initRoomEditor(canvas, getTransform);
    initControls(canvas);
    initPanZoom(canvas);
    initFloorDrag(canvas, getTransform);

    // Cache for planks (regenerate on relevant state changes)
    let cachedPlanks = [];
    let lastPlankConfig = null;

    // Cache for walls list (only update when vertices/dimensions change)
    let lastWallsKey = null;

    function getPlankConfigKey(s) {
        return JSON.stringify({
            vertices: s.room.vertices,
            plankLength: s.plank.length,
            plankWidth: s.plank.width,
            rotation: s.floor.rotation,
            offsetPattern: s.floor.offsetPattern,
            offsetX: s.floor.offsetX,
            offsetY: s.floor.offsetY,
            rowOffsets: s.floor.rowOffsets
        });
    }

    function generatePlanks(currentState) {
        const configKey = getPlankConfigKey(currentState);

        if (configKey !== lastPlankConfig) {
            lastPlankConfig = configKey;

            if (currentState.room.isComplete && currentState.room.vertices.length >= 3) {
                cachedPlanks = generatePlankGrid({
                    roomVertices: currentState.room.vertices,
                    plankLength: currentState.plank.length,
                    plankWidth: currentState.plank.width,
                    rotation: currentState.floor.rotation,
                    offsetPattern: currentState.floor.offsetPattern,
                    offsetX: currentState.floor.offsetX,
                    offsetY: currentState.floor.offsetY,
                    rowOffsets: currentState.floor.rowOffsets
                });
            } else {
                cachedPlanks = [];
            }
        }

        return cachedPlanks;
    }

    // Main render function
    function render() {
        const currentState = state.get();
        const transform = getTransform();

        // Clear canvas
        renderer.clear();

        // Draw grid
        renderer.drawGrid(transform);

        // Generate planks if room is complete
        const planks = generatePlanks(currentState);

        // Draw planks (before room so room outline is on top)
        if (planks.length > 0) {
            renderer.drawPlanks(
                planks,
                transform,
                currentState.minimums.length,
                currentState.minimums.width,
                currentState.room.vertices
            );
            renderer.drawPlankDimensions(planks, transform, false, false);
        }

        // Draw room
        renderer.drawRoom(
            currentState.room.vertices,
            transform,
            currentState.room.isComplete,
            currentState.ui.hoveredVertex,
            currentState.ui.selectedWall
        );

        // Draw dimensions for complete room
        if (currentState.room.isComplete) {
            renderer.drawDimensions(currentState.room.vertices, transform);
        }

        // Draw drawing guide if in drawing mode
        if (currentState.ui.mode === 'drawing') {
            const mousePos = roomEditor.getMouseWorldPos();
            renderer.drawDrawingGuide(currentState.room.vertices, mousePos, transform);
        }

        // Update stats
        if (currentState.room.isComplete && planks.length > 0) {
            const stats = calculateStats(
                planks,
                currentState.minimums.length,
                currentState.minimums.width
            );
            const roomAreaCm2 = polygonArea(currentState.room.vertices);
            updateStatsDisplay(stats, roomAreaCm2);
        } else {
            updateStatsDisplay({ fullPlanks: 0, cutPieces: [], tooSmall: 0, waste: 0 }, 0);
        }

        // Update walls list only when vertices/dimensions change (not on every hover)
        if (currentState.room.isComplete) {
            const wallsKey = JSON.stringify({
                vertices: currentState.room.vertices,
                wallDimensions: currentState.room.wallDimensions
            });
            if (wallsKey !== lastWallsKey) {
                lastWallsKey = wallsKey;
                updateWallsList(currentState.room.vertices, currentState.room.wallDimensions);
            }
        }

        // Update overlay
        updateOverlay(currentState.room.vertices.length > 0);
    }

    // Set up canvas sizing (must be after render is defined)
    function resizeCanvas() {
        const container = canvas.parentElement;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = container.clientWidth * dpr;
        canvas.height = container.clientHeight * dpr;
        canvas.style.width = `${container.clientWidth}px`;
        canvas.style.height = `${container.clientHeight}px`;

        // Scale context for DPR (setTransform resets and applies in one call)
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // Trigger re-render
        render();
    }

    // Subscribe to state changes
    state.subscribe(throttle(render, 16)); // ~60fps max

    // Set up resize listener and do initial sizing
    window.addEventListener('resize', throttle(resizeCanvas, 100));

    // Initial canvas setup
    resizeCanvas();

    // Check if we have a loaded room from localStorage
    const currentState = state.get();
    const hint = document.getElementById('room-hint');

    if (currentState.room.isComplete && currentState.room.vertices.length >= 3) {
        // Fit view to loaded room
        const bounds = polygonBounds(currentState.room.vertices);
        const viewParams = fitBoundsToView(bounds, canvas);
        state.batch({
            'view.scale': viewParams.scale,
            'view.offsetX': viewParams.offsetX,
            'view.offsetY': viewParams.offsetY
        });
        if (hint) hint.classList.remove('visible');
        canvas.style.cursor = 'default';
    } else {
        // No room loaded - set up for drawing
        state.set('view.scale', 2);
        if (hint) hint.classList.add('visible');
        canvas.style.cursor = 'crosshair';
    }

    console.log('Laminaat Planner initialized');
    console.log('Controls:');
    console.log('- Click to place vertices');
    console.log('- Click near first vertex to close room');
    console.log('- Scroll to zoom');
    console.log('- Shift+drag or middle-mouse to pan');
    console.log('- Ctrl+drag or right-drag to move floor pattern');
}

// Start app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
