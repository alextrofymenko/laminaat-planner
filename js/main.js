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
import { clipPolygon } from './geometry/clipping.js';
import { fitBoundsToView } from './geometry/transforms.js';
import { initRoomEditor, updateWallsList } from './ui/room-editor.js';
import { initControls, initPanZoom, initFloorDrag } from './ui/controls.js';
import { updateStatsDisplay, updateOverlay } from './ui/stats.js';
import { throttle, round } from './utils.js';

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

    // Plank click handler - runs before room-editor click handler
    canvas.addEventListener('click', (e) => {
        const currentState = state.get();
        if (!currentState.room.isComplete || currentState.ui.mode !== 'idle') return;
        if (e.shiftKey) return; // Shift+click is for vertex editing
        // Skip if dragging (panning or floor drag)
        if (canvas.classList.contains('panning') || canvas.classList.contains('dragging')) return;

        const rect = canvas.getBoundingClientRect();
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        const transform = getTransform();
        const worldPos = transform.screenToWorld(screenX, screenY);

        // Check if click is on a plank (check in reverse order for top-most)
        const planks = generatePlanks(currentState);
        for (let i = planks.length - 1; i >= 0; i--) {
            const plank = planks[i];
            if (isPointInPlank(worldPos, plank)) {
                // Stop propagation to prevent wall click handler from also firing
                e.stopImmediatePropagation();
                // Toggle selection - clear wall selection when selecting plank
                if (currentState.ui.selectedPlank === plank.id) {
                    state.set('ui.selectedPlank', null);
                } else {
                    state.batch({
                        'ui.selectedPlank': plank.id,
                        'ui.selectedWall': null
                    });
                    // Scroll preview panel into view
                    setTimeout(() => {
                        const previewPanel = document.getElementById('plank-preview-panel');
                        if (previewPanel) {
                            previewPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                        }
                    }, 50);
                }
                return;
            }
        }

        // Clicked outside planks - deselect
        if (currentState.ui.selectedPlank !== null) {
            state.set('ui.selectedPlank', null);
        }
    });

    // Plank hover tracking
    canvas.addEventListener('mousemove', (e) => {
        const currentState = state.get();
        // Skip hover during dragging
        if (canvas.classList.contains('panning') || canvas.classList.contains('dragging')) {
            if (currentState.ui.hoveredPlank !== null) {
                state.set('ui.hoveredPlank', null);
            }
            return;
        }
        if (!currentState.room.isComplete || currentState.ui.mode !== 'idle') {
            if (currentState.ui.hoveredPlank !== null) {
                state.set('ui.hoveredPlank', null);
            }
            return;
        }
        if (e.shiftKey) {
            // Shift mode is for vertex editing, not plank hover
            if (currentState.ui.hoveredPlank !== null) {
                state.set('ui.hoveredPlank', null);
            }
            return;
        }

        const rect = canvas.getBoundingClientRect();
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        const transform = getTransform();
        const worldPos = transform.screenToWorld(screenX, screenY);

        // Check if hovering over a plank
        const planks = generatePlanks(currentState);
        for (let i = planks.length - 1; i >= 0; i--) {
            const plank = planks[i];
            if (isPointInPlank(worldPos, plank)) {
                // Update state - plank hover takes priority over wall hover
                const updates = {};
                if (currentState.ui.hoveredPlank !== plank.id) {
                    updates['ui.hoveredPlank'] = plank.id;
                }
                // Clear wall hover if set (plank takes priority)
                if (currentState.ui.hoveredWall !== null) {
                    updates['ui.hoveredWall'] = null;
                }
                if (Object.keys(updates).length > 0) {
                    state.batch(updates);
                }
                // Set cursor to pointer for plank hover (takes priority over wall)
                canvas.style.cursor = 'pointer';
                return;
            }
        }

        // Not hovering over any plank
        if (currentState.ui.hoveredPlank !== null) {
            state.set('ui.hoveredPlank', null);
        }
    });

    // Clear hover states when mouse leaves canvas
    canvas.addEventListener('mouseleave', () => {
        const currentState = state.get();
        const updates = {};
        if (currentState.ui.hoveredPlank !== null) {
            updates['ui.hoveredPlank'] = null;
        }
        if (currentState.ui.hoveredWall !== null) {
            updates['ui.hoveredWall'] = null;
        }
        if (Object.keys(updates).length > 0) {
            state.batch(updates);
        }
    });

    // Helper to check if point is inside a plank
    function isPointInPlank(point, plank) {
        // Transform point to plank's local coordinate system
        const dx = point.x - plank.cx;
        const dy = point.y - plank.cy;
        const cos = Math.cos(-plank.rotation);
        const sin = Math.sin(-plank.rotation);
        const localX = dx * cos - dy * sin;
        const localY = dx * sin + dy * cos;

        const hw = plank.originalWidth / 2;
        const hh = plank.originalHeight / 2;

        return Math.abs(localX) <= hw && Math.abs(localY) <= hh;
    }

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
                currentState.room.vertices,
                currentState.ui.selectedPlank,
                currentState.ui.hoveredPlank
            );
            renderer.drawPlankDimensions(planks, transform, false, false);
        }

        // Update plank preview if one is selected
        updatePlankPreview(planks, currentState.ui.selectedPlank, currentState.room.vertices);

        // Draw room
        renderer.drawRoom(
            currentState.room.vertices,
            transform,
            currentState.room.isComplete,
            currentState.ui.hoveredVertex,
            currentState.ui.selectedWall,
            currentState.ui.hoveredWall
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

    // Plank preview panel elements
    const previewPanel = document.getElementById('plank-preview-panel');
    const previewCanvas = document.getElementById('plank-preview-canvas');
    const previewInfo = document.getElementById('plank-info');
    const previewCtx = previewCanvas ? previewCanvas.getContext('2d') : null;

    function updatePlankPreview(planks, selectedPlankId, roomVertices) {
        if (!previewPanel || !previewCanvas || !previewCtx) return;

        if (selectedPlankId === null) {
            previewPanel.style.display = 'none';
            return;
        }

        const plank = planks.find(p => p.id === selectedPlankId);
        if (!plank) {
            previewPanel.style.display = 'none';
            return;
        }

        previewPanel.style.display = 'block';

        // Use square dimensions for consistent preview at any rotation
        const width = 180;
        const height = 180;
        const dpr = window.devicePixelRatio || 1;

        // Only resize canvas if needed
        if (previewCanvas.width !== width * dpr || previewCanvas.height !== height * dpr) {
            previewCanvas.width = width * dpr;
            previewCanvas.height = height * dpr;
        }
        previewCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // Clear
        previewCtx.fillStyle = '#1a1a2e';
        previewCtx.fillRect(0, 0, width, height);

        // Calculate scale to fit plank in preview (same orientation as floor)
        const padding = 15;
        const plankWidth = plank.originalWidth;   // The long dimension
        const plankHeight = plank.originalHeight; // The short dimension

        // Account for rotation when calculating bounding box
        const cos = Math.cos(plank.rotation);
        const sin = Math.sin(plank.rotation);
        const hw = plankWidth / 2;
        const hh = plankHeight / 2;

        // Rotated bounding box size
        const rotatedWidth = Math.abs(hw * cos) + Math.abs(hh * sin);
        const rotatedHeight = Math.abs(hw * sin) + Math.abs(hh * cos);

        const scaleX = (width - padding * 2) / (rotatedWidth * 2);
        const scaleY = (height - padding * 2) / (rotatedHeight * 2);
        const scale = Math.min(scaleX, scaleY);

        const offsetX = width / 2;
        const offsetY = height / 2;

        // Transform plank local coords to preview coords (with floor rotation applied)
        function toPreview(localX, localY) {
            // Apply plank rotation to match floor orientation
            const rotX = localX * cos - localY * sin;
            const rotY = localX * sin + localY * cos;
            return {
                x: offsetX + rotX * scale,
                y: offsetY + rotY * scale
            };
        }

        // Draw full plank outline (the whole plank before cutting)
        const fullCorners = [
            toPreview(-hw, -hh),
            toPreview(hw, -hh),
            toPreview(hw, hh),
            toPreview(-hw, hh)
        ];

        // Transform room vertices to plank local coords
        const roomLocal = roomVertices.map(v => {
            const dx = v.x - plank.cx;
            const dy = v.y - plank.cy;
            return {
                x: dx * cos + dy * sin,
                y: -dx * sin + dy * cos
            };
        });

        // Plank corners in local coords (CCW)
        const plankLocal = [
            { x: -hw, y: -hh },
            { x: hw, y: -hh },
            { x: hw, y: hh },
            { x: -hw, y: hh }
        ];

        // Transform room to preview coordinates
        const roomPreview = roomLocal.map(p => toPreview(p.x, p.y));

        if (plank.isEdgePlank) {
            // First draw the full plank outline (dotted) - shows the cut-away area
            previewCtx.strokeStyle = '#888';
            previewCtx.lineWidth = 1;
            previewCtx.setLineDash([4, 4]);

            previewCtx.beginPath();
            previewCtx.moveTo(fullCorners[0].x, fullCorners[0].y);
            for (let i = 1; i < fullCorners.length; i++) {
                previewCtx.lineTo(fullCorners[i].x, fullCorners[i].y);
            }
            previewCtx.closePath();
            previewCtx.stroke();
            previewCtx.setLineDash([]);

            // Draw visible area using canvas clipping (works for any room shape)
            previewCtx.save();

            // Create clipping path from room polygon
            previewCtx.beginPath();
            previewCtx.moveTo(roomPreview[0].x, roomPreview[0].y);
            for (let i = 1; i < roomPreview.length; i++) {
                previewCtx.lineTo(roomPreview[i].x, roomPreview[i].y);
            }
            previewCtx.closePath();
            previewCtx.clip();

            // Draw full plank (will be clipped to room shape)
            previewCtx.fillStyle = '#d4a574';
            previewCtx.strokeStyle = '#8b6914';
            previewCtx.lineWidth = 2;

            previewCtx.beginPath();
            previewCtx.moveTo(fullCorners[0].x, fullCorners[0].y);
            for (let i = 1; i < fullCorners.length; i++) {
                previewCtx.lineTo(fullCorners[i].x, fullCorners[i].y);
            }
            previewCtx.closePath();
            previewCtx.fill();
            previewCtx.stroke();

            previewCtx.restore();

            // Draw cut lines (room walls that intersect the plank) in red
            previewCtx.strokeStyle = '#ff6b6b';
            previewCtx.lineWidth = 2;
            previewCtx.beginPath();

            // Check each room edge for intersection with plank
            for (let i = 0; i < roomLocal.length; i++) {
                const r1 = roomLocal[i];
                const r2 = roomLocal[(i + 1) % roomLocal.length];

                // Check if this room edge intersects the plank rectangle
                if (lineIntersectsRect(r1, r2, hw, hh)) {
                    // Clip the room edge to the plank bounds
                    const clippedEdge = clipLineToRect(r1, r2, hw, hh);
                    if (clippedEdge) {
                        const sp1 = toPreview(clippedEdge.x1, clippedEdge.y1);
                        const sp2 = toPreview(clippedEdge.x2, clippedEdge.y2);
                        previewCtx.moveTo(sp1.x, sp1.y);
                        previewCtx.lineTo(sp2.x, sp2.y);
                    }
                }
            }
            previewCtx.stroke();
        } else {
            // Full plank (no cutting needed)
            previewCtx.fillStyle = '#d4a574';
            previewCtx.strokeStyle = '#8b6914';
            previewCtx.lineWidth = 2;

            previewCtx.beginPath();
            previewCtx.moveTo(fullCorners[0].x, fullCorners[0].y);
            for (let i = 1; i < fullCorners.length; i++) {
                previewCtx.lineTo(fullCorners[i].x, fullCorners[i].y);
            }
            previewCtx.closePath();
            previewCtx.fill();
            previewCtx.stroke();
        }

        // Helper: check if line segment intersects rectangle
        function lineIntersectsRect(p1, p2, hw, hh) {
            // Cohen-Sutherland style check
            const inside = (p) => Math.abs(p.x) <= hw && Math.abs(p.y) <= hh;
            if (inside(p1) || inside(p2)) return true;

            // Check intersection with each rect edge
            const edges = [
                { x1: -hw, y1: -hh, x2: hw, y2: -hh },
                { x1: hw, y1: -hh, x2: hw, y2: hh },
                { x1: hw, y1: hh, x2: -hw, y2: hh },
                { x1: -hw, y1: hh, x2: -hw, y2: -hh }
            ];

            for (const edge of edges) {
                if (segmentsIntersect(p1.x, p1.y, p2.x, p2.y, edge.x1, edge.y1, edge.x2, edge.y2)) {
                    return true;
                }
            }
            return false;
        }

        // Helper: check if two line segments intersect
        function segmentsIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
            const d1 = (x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3);
            const d2 = (x4 - x3) * (y2 - y3) - (y4 - y3) * (x2 - x3);
            const d3 = (x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1);
            const d4 = (x2 - x1) * (y4 - y1) - (y2 - y1) * (x4 - x1);

            if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
                ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
                return true;
            }
            return false;
        }

        // Helper: clip line segment to rectangle, return clipped segment
        function clipLineToRect(p1, p2, hw, hh) {
            let x1 = p1.x, y1 = p1.y, x2 = p2.x, y2 = p2.y;

            // Liang-Barsky algorithm
            const dx = x2 - x1;
            const dy = y2 - y1;
            let t0 = 0, t1 = 1;

            const clips = [
                { p: -dx, q: x1 - (-hw) },
                { p: dx, q: hw - x1 },
                { p: -dy, q: y1 - (-hh) },
                { p: dy, q: hh - y1 }
            ];

            for (const { p, q } of clips) {
                if (p === 0) {
                    if (q < 0) return null;
                } else {
                    const t = q / p;
                    if (p < 0) {
                        if (t > t1) return null;
                        if (t > t0) t0 = t;
                    } else {
                        if (t < t0) return null;
                        if (t < t1) t1 = t;
                    }
                }
            }

            if (t0 >= t1) return null;

            return {
                x1: x1 + t0 * dx,
                y1: y1 + t0 * dy,
                x2: x1 + t1 * dx,
                y2: y1 + t1 * dy
            };
        }

        // Draw dimensions along the plank edges
        previewCtx.fillStyle = '#aaa';
        previewCtx.font = '11px -apple-system, sans-serif';
        previewCtx.textAlign = 'center';
        previewCtx.textBaseline = 'middle';

        // Length label (along the long edge)
        const lengthLabelPos = toPreview(0, -hh - 12 / scale);
        previewCtx.save();
        previewCtx.translate(lengthLabelPos.x, lengthLabelPos.y);
        previewCtx.rotate(plank.rotation);
        previewCtx.fillText(`${round(plankWidth, 1)} cm`, 0, 0);
        previewCtx.restore();

        // Width label (along the short edge)
        const widthLabelPos = toPreview(-hw - 12 / scale, 0);
        previewCtx.save();
        previewCtx.translate(widthLabelPos.x, widthLabelPos.y);
        previewCtx.rotate(plank.rotation - Math.PI / 2);
        previewCtx.fillText(`${round(plankHeight, 1)} cm`, 0, 0);
        previewCtx.restore();

        // Update info panel
        let infoHtml = `
            <div class="dimension-row">
                <span class="dimension-label">Plank #</span>
                <span class="dimension-value">${plank.id + 1}</span>
            </div>
            <div class="dimension-row">
                <span class="dimension-label">Full Size</span>
                <span class="dimension-value">${round(plankWidth, 1)} × ${round(plankHeight, 1)} cm</span>
            </div>
        `;

        if (plank.isEdgePlank) {
            infoHtml += `
                <div class="cut-section">
                    <div class="cut-label">Cut Required</div>
                    <div class="dimension-row">
                        <span class="dimension-label">Visible Size</span>
                        <span class="dimension-value">${round(plank.clippedLength, 1)} × ${round(plank.clippedWidth, 1)} cm</span>
                    </div>
                    <div class="dimension-row">
                        <span class="dimension-label">Cut Length</span>
                        <span class="dimension-value">${round(plankWidth - plank.clippedLength, 1)} cm</span>
                    </div>
                    <div class="dimension-row">
                        <span class="dimension-label">Cut Width</span>
                        <span class="dimension-value">${round(plankHeight - plank.clippedWidth, 1)} cm</span>
                    </div>
                </div>
            `;
        } else {
            infoHtml += `
                <div class="dimension-row">
                    <span class="dimension-label">Status</span>
                    <span class="dimension-value" style="color: #4ade80;">Full plank</span>
                </div>
            `;
        }

        previewInfo.innerHTML = infoHtml;
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
