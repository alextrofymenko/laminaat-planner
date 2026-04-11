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
import { polygonArea, polygonBounds, pointInPolygon } from './geometry/polygon.js';
import { clipPolygon } from './geometry/clipping.js';
import { fitBoundsToView } from './geometry/transforms.js';
import { initRoomEditor, updateWallsList, getWallLabelAtPosition } from './ui/room-editor.js';
import { initControls, initPanZoom, initFloorDrag, isMobileDevice } from './ui/controls.js';
import { updateStatsDisplay, updateOverlay } from './ui/stats.js';
import { initRoomManager } from './ui/room-manager.js';
import { initStepByStep } from './ui/step-by-step.js';
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
    const stepByStep = initStepByStep(canvas);
    initRoomManager(canvas, { stepByStep });

    // Mobile-specific setup
    if (isMobileDevice()) {
        document.body.classList.add('is-mobile');
        // Auto-lock on mobile if room exists
        const currentState = state.get();
        if (currentState.room.isComplete) {
            state.set('ui.isLocked', true);
        }
        // Show mobile hint
        showMobileHint();
    }

    // Plank click handler - uses capture phase to run before room-editor click handler
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

        // Check if click is on a plank (only if inside room, check in reverse order for top-most)
        if (pointInPolygon(worldPos, currentState.room.vertices)) {
            const planks = generatePlanks(currentState);
            for (let i = planks.length - 1; i >= 0; i--) {
                const plank = planks[i];
                if (isPointInPlank(worldPos, plank)) {
                    // Stop propagation to prevent wall click handler from also firing
                    e.stopImmediatePropagation();
                    // Use row,col as stable identifier (survives grid regeneration)
                    const plankKey = `${plank.row},${plank.col}`;
                    // Toggle selection - clear wall selection when selecting plank
                    if (currentState.ui.selectedPlank === plankKey) {
                        state.set('ui.selectedPlank', null);
                    } else {
                        state.batch({
                            'ui.selectedPlank': plankKey,
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
        }

        // Clicked outside planks - deselect
        if (currentState.ui.selectedPlank !== null) {
            state.set('ui.selectedPlank', null);
        }
    }, true); // Use capture phase

    // Plank and wall label hover tracking
    canvas.addEventListener('mousemove', (e) => {
        const currentState = state.get();
        // Skip hover during dragging
        if (canvas.classList.contains('panning') || canvas.classList.contains('dragging')) {
            const updates = {};
            if (currentState.ui.hoveredPlank !== null) updates['ui.hoveredPlank'] = null;
            if (currentState.ui.hoveredWall !== null) updates['ui.hoveredWall'] = null;
            if (Object.keys(updates).length > 0) state.batch(updates);
            return;
        }
        if (!currentState.room.isComplete || currentState.ui.mode !== 'idle') {
            const updates = {};
            if (currentState.ui.hoveredPlank !== null) updates['ui.hoveredPlank'] = null;
            if (currentState.ui.hoveredWall !== null) updates['ui.hoveredWall'] = null;
            if (Object.keys(updates).length > 0) state.batch(updates);
            return;
        }
        if (e.shiftKey) {
            // Shift mode is for vertex editing
            const updates = {};
            if (currentState.ui.hoveredPlank !== null) updates['ui.hoveredPlank'] = null;
            if (currentState.ui.hoveredWall !== null) updates['ui.hoveredWall'] = null;
            if (Object.keys(updates).length > 0) state.batch(updates);
            return;
        }

        const rect = canvas.getBoundingClientRect();
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        const transform = getTransform();
        const worldPos = transform.screenToWorld(screenX, screenY);

        // Check wall labels FIRST (they're visually on top)
        const wallIndex = getWallLabelAtPosition(screenX, screenY, currentState.room.vertices, transform);
        if (wallIndex !== null) {
            const updates = {};
            if (currentState.ui.hoveredWall !== wallIndex) {
                updates['ui.hoveredWall'] = wallIndex;
            }
            if (currentState.ui.hoveredPlank !== null) {
                updates['ui.hoveredPlank'] = null;
            }
            if (Object.keys(updates).length > 0) {
                state.batch(updates);
            }
            canvas.style.cursor = 'pointer';
            return;
        }

        // Check if hovering over a plank (only if point is inside the room)
        if (pointInPolygon(worldPos, currentState.room.vertices)) {
            const planks = generatePlanks(currentState);
            for (let i = planks.length - 1; i >= 0; i--) {
                const plank = planks[i];
                if (isPointInPlank(worldPos, plank)) {
                    const plankKey = `${plank.row},${plank.col}`;
                    const updates = {};
                    if (currentState.ui.hoveredPlank !== plankKey) {
                        updates['ui.hoveredPlank'] = plankKey;
                    }
                    if (currentState.ui.hoveredWall !== null) {
                        updates['ui.hoveredWall'] = null;
                    }
                    if (Object.keys(updates).length > 0) {
                        state.batch(updates);
                    }
                    canvas.style.cursor = 'pointer';
                    return;
                }
            }
        }

        // Not hovering over anything - clear both and reset cursor
        const updates = {};
        if (currentState.ui.hoveredPlank !== null) updates['ui.hoveredPlank'] = null;
        if (currentState.ui.hoveredWall !== null) updates['ui.hoveredWall'] = null;
        if (Object.keys(updates).length > 0) {
            state.batch(updates);
        }
        canvas.style.cursor = 'default';
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

        // Draw full plank markers (after room so they're on top)
        if (planks.length > 0) {
            renderer.drawFullPlankMarkers(planks, transform, currentState.ui.selectedPlank);
        }

        // Draw dimensions for complete room
        if (currentState.room.isComplete) {
            renderer.drawDimensions(
                currentState.room.vertices,
                transform,
                currentState.ui.selectedWall,
                currentState.ui.hoveredWall
            );
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
        } else if (lastWallsKey !== null) {
            // Clear walls list when room is not complete (e.g., new room)
            lastWallsKey = null;
            updateWallsList([], []);
        }

        // Update overlay
        updateOverlay(currentState.room.vertices.length > 0);
    }

    // Plank preview panel elements
    const previewPanel = document.getElementById('plank-preview-panel');
    const previewCanvas = document.getElementById('plank-preview-canvas');
    const previewInfo = document.getElementById('plank-info');
    const previewCtx = previewCanvas ? previewCanvas.getContext('2d') : null;

    // Row offset controls
    const rowOffsetControls = document.getElementById('row-offset-controls');
    const rowNumberSpan = document.getElementById('row-number');
    const rowOffsetSlider = document.getElementById('row-offset');
    const rowOffsetValueSpan = document.getElementById('row-offset-value');
    const resetRowOffsetBtn = document.getElementById('btn-reset-row-offset');
    let currentSelectedRow = null;

    // Row offset slider handler
    if (rowOffsetSlider) {
        rowOffsetSlider.addEventListener('input', (e) => {
            if (currentSelectedRow === null) return;
            const value = parseInt(e.target.value);
            const fraction = value / 100;

            // Update the rowOffsets for this row
            const currentState = state.get();
            const newRowOffsets = { ...currentState.floor.rowOffsets };
            newRowOffsets[currentSelectedRow] = fraction;

            state.set('floor.rowOffsets', newRowOffsets);

            if (rowOffsetValueSpan) {
                rowOffsetValueSpan.textContent = `${value}%`;
            }
        });
    }

    // Reset row offset button handler
    if (resetRowOffsetBtn) {
        resetRowOffsetBtn.addEventListener('click', () => {
            if (currentSelectedRow === null) return;

            const currentState = state.get();
            const newRowOffsets = { ...currentState.floor.rowOffsets };
            delete newRowOffsets[currentSelectedRow];

            state.set('floor.rowOffsets', newRowOffsets);
        });
    }

    function updatePlankPreview(planks, selectedPlankKey, roomVertices) {
        if (!previewPanel || !previewCanvas || !previewCtx) return;

        if (selectedPlankKey === null) {
            previewPanel.style.display = 'none';
            currentSelectedRow = null;
            return;
        }

        // Find plank by row,col key
        const plank = planks.find(p => `${p.row},${p.col}` === selectedPlankKey);
        if (!plank) {
            previewPanel.style.display = 'none';
            currentSelectedRow = null;
            return;
        }

        previewPanel.style.display = 'block';

        // Update row offset controls
        currentSelectedRow = plank.row;
        const currentState = state.get();
        const { offsetPattern, rowOffsets } = currentState.floor;

        // Calculate what the offset is for this row (custom or calculated)
        let currentOffset;
        let hasCustomOffset = false;
        if (rowOffsets[plank.row] !== undefined) {
            currentOffset = rowOffsets[plank.row];
            hasCustomOffset = true;
        } else {
            // Calculate base offset for this row
            const baseOffset = (plank.row * offsetPattern) % 1;
            currentOffset = baseOffset < 0 ? baseOffset + 1 : baseOffset;
        }

        const offsetPercent = Math.round(currentOffset * 100);

        if (rowNumberSpan) {
            rowNumberSpan.textContent = plank.row;
        }
        if (rowOffsetSlider) {
            rowOffsetSlider.value = offsetPercent;
        }
        if (rowOffsetValueSpan) {
            const customIndicator = hasCustomOffset ? ' <span class="row-offset-custom">(custom)</span>' : '';
            rowOffsetValueSpan.innerHTML = `${offsetPercent}%${customIndicator}`;
        }
        if (resetRowOffsetBtn) {
            resetRowOffsetBtn.style.display = hasCustomOffset ? 'inline-block' : 'none';
        }

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

    // Modal elements
    const modal = document.getElementById('plank-modal');
    const modalClose = document.getElementById('modal-close');
    const modalResetZoom = document.getElementById('modal-reset-zoom');
    const zoomIndicator = document.getElementById('zoom-indicator');
    const detailCanvas = document.getElementById('plank-detail-canvas');
    const detailInfo = document.getElementById('plank-detail-info');
    const detailCtx = detailCanvas ? detailCanvas.getContext('2d') : null;

    // Modal view state for zoom/pan
    const modalView = {
        scale: 1,
        offsetX: 0,
        offsetY: 0,
        baseScale: 1, // Initial fit-to-view scale
        plank: null,
        roomVertices: null,
        pieces: null // Array of { polygon, edges, angles } for each piece
    };

    // Reset modal view to fit
    function resetModalView() {
        modalView.scale = 1;
        modalView.offsetX = 0;
        modalView.offsetY = 0;
        updateZoomIndicator();
        redrawModal();
    }

    function updateZoomIndicator() {
        if (zoomIndicator) {
            const zoomPercent = Math.round(modalView.scale * 100);
            zoomIndicator.textContent = `${zoomPercent}%`;
        }
    }

    function redrawModal() {
        if (modalView.plank && modalView.pieces) {
            drawDetailedPlank(modalView.plank, modalView.roomVertices, modalView.pieces, 400);
        }
    }

    // Make preview canvas clickable to open modal
    if (previewCanvas) {
        previewCanvas.style.cursor = 'pointer';
        previewCanvas.addEventListener('click', () => {
            const currentState = state.get();
            if (currentState.ui.selectedPlank === null) return;

            const planks = generatePlanks(currentState);
            const plank = planks.find(p => `${p.row},${p.col}` === currentState.ui.selectedPlank);
            if (!plank) return;

            openPlankModal(plank, currentState.room.vertices);
        });
    }

    // Modal close handlers
    if (modalClose) {
        modalClose.addEventListener('click', closePlankModal);
    }
    if (modalResetZoom) {
        modalResetZoom.addEventListener('click', resetModalView);
    }
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closePlankModal();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.style.display !== 'none') {
                closePlankModal();
            }
        });
    }

    // Detail canvas zoom/pan handling
    if (detailCanvas) {
        // Mouse wheel zoom - pivot on cursor position
        detailCanvas.addEventListener('wheel', (e) => {
            e.preventDefault();

            const rect = detailCanvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            // Canvas center (use actual CSS size)
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;

            // Position relative to center
            const pivotX = mouseX - centerX;
            const pivotY = mouseY - centerY;

            // Zoom factor (gentler zoom like main canvas)
            const scrollAmount = Math.sign(e.deltaY);
            const zoomFactor = 1 - scrollAmount * 0.08;
            const newScale = Math.max(0.5, Math.min(10, modalView.scale * zoomFactor));

            // Calculate "base" position under cursor (in post-base-transform space)
            // screenPos = centerX + (basePos - centerX) * scale + offset
            // => basePos - centerX = (screenPos - centerX - offset) / scale
            const baseX = (pivotX - modalView.offsetX) / modalView.scale;
            const baseY = (pivotY - modalView.offsetY) / modalView.scale;

            // Calculate new offset to keep same base position under cursor
            modalView.offsetX = pivotX - baseX * newScale;
            modalView.offsetY = pivotY - baseY * newScale;
            modalView.scale = newScale;

            updateZoomIndicator();
            redrawModal();
        }, { passive: false });

        // Drag to pan
        let isPanningModal = false;
        let lastModalPanX = 0;
        let lastModalPanY = 0;

        detailCanvas.addEventListener('mousedown', (e) => {
            if (e.button === 0) {
                isPanningModal = true;
                lastModalPanX = e.clientX;
                lastModalPanY = e.clientY;
                detailCanvas.style.cursor = 'grabbing';
            }
        });

        document.addEventListener('mousemove', (e) => {
            if (!isPanningModal) return;

            const dx = e.clientX - lastModalPanX;
            const dy = e.clientY - lastModalPanY;

            modalView.offsetX += dx;
            modalView.offsetY += dy;

            lastModalPanX = e.clientX;
            lastModalPanY = e.clientY;

            redrawModal();
        });

        document.addEventListener('mouseup', () => {
            if (isPanningModal) {
                isPanningModal = false;
                detailCanvas.style.cursor = 'grab';
            }
        });

        detailCanvas.style.cursor = 'grab';
    }

    function closePlankModal() {
        if (modal) modal.style.display = 'none';
    }

    function openPlankModal(plank, roomVertices) {
        if (!modal || !detailCanvas || !detailCtx) return;

        modal.style.display = 'flex';

        // Set up canvas
        const size = 400;
        const dpr = window.devicePixelRatio || 1;
        detailCanvas.width = size * dpr;
        detailCanvas.height = size * dpr;
        detailCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // Calculate edges directly (works for any room shape)
        const plankCorners = getPlankCorners(plank);
        const edges = plank.isEdgePlank
            ? calculateVisibleEdges(plankCorners, roomVertices)
            : calculateFullPlankEdges(plankCorners);

        // Create single piece structure for compatibility
        const allPieces = [{ edges, angles: [] }];

        // Store data for redrawing during zoom/pan
        modalView.plank = plank;
        modalView.roomVertices = roomVertices;
        modalView.pieces = allPieces;

        // Reset view to fit
        modalView.scale = 1;
        modalView.offsetX = 0;
        modalView.offsetY = 0;
        updateZoomIndicator();

        // Draw detailed view
        drawDetailedPlank(plank, roomVertices, allPieces, size);

        // Update info panel
        updateDetailInfo(plank, allPieces);
    }

    function getPlankCorners(plank) {
        const cos = Math.cos(plank.rotation);
        const sin = Math.sin(plank.rotation);
        const hw = plank.originalWidth / 2;
        const hh = plank.originalHeight / 2;

        return [
            { x: plank.cx + (-hw) * cos - (-hh) * sin, y: plank.cy + (-hw) * sin + (-hh) * cos },
            { x: plank.cx + (hw) * cos - (-hh) * sin, y: plank.cy + (hw) * sin + (-hh) * cos },
            { x: plank.cx + (hw) * cos - (hh) * sin, y: plank.cy + (hw) * sin + (hh) * cos },
            { x: plank.cx + (-hw) * cos - (hh) * sin, y: plank.cy + (-hw) * sin + (hh) * cos }
        ];
    }

    function calculateFullPlankEdges(plankCorners) {
        const edges = [];
        for (let i = 0; i < 4; i++) {
            const p1 = plankCorners[i];
            const p2 = plankCorners[(i + 1) % 4];
            const length = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
            edges.push({
                p1: { ...p1, type: 'plankEdge', plankEdge: i },
                p2: { ...p2, type: 'plankEdge', plankEdge: i },
                length,
                type: 'plank',
                label: `P${i + 1}`
            });
        }
        return edges;
    }

    // Calculate visible edges directly without building a polygon
    // This works correctly for any room shape including non-convex
    function calculateVisibleEdges(plankCorners, roomPoly) {
        const edges = [];
        let plankEdgeCount = 0;
        let cutEdgeCount = 0;

        // For each plank edge, find visible segments
        for (let i = 0; i < 4; i++) {
            const p1 = plankCorners[i];
            const p2 = plankCorners[(i + 1) % 4];

            const visibleSegments = getVisibleSegments(p1, p2, roomPoly);
            for (const seg of visibleSegments) {
                const length = Math.sqrt((seg.end.x - seg.start.x) ** 2 + (seg.end.y - seg.start.y) ** 2);
                if (length > 0.1) {
                    plankEdgeCount++;
                    edges.push({
                        p1: { ...seg.start, type: 'plankEdge', plankEdge: i },
                        p2: { ...seg.end, type: 'plankEdge', plankEdge: i },
                        length,
                        type: 'plank',
                        label: `P${plankEdgeCount}`
                    });
                }
            }
        }

        // For each room edge, find segments inside the plank (these are cuts)
        for (let j = 0; j < roomPoly.length; j++) {
            const r1 = roomPoly[j];
            const r2 = roomPoly[(j + 1) % roomPoly.length];

            const cutSegments = getSegmentInsidePlank(r1, r2, plankCorners);
            for (const seg of cutSegments) {
                const length = Math.sqrt((seg.end.x - seg.start.x) ** 2 + (seg.end.y - seg.start.y) ** 2);
                if (length > 0.1) {
                    cutEdgeCount++;
                    edges.push({
                        p1: { ...seg.start, type: 'roomEdge', roomEdge: j },
                        p2: { ...seg.end, type: 'roomEdge', roomEdge: j },
                        length,
                        type: 'cut',
                        label: `C${cutEdgeCount}`
                    });
                }
            }
        }

        return edges;
    }

    // Get visible segments of a plank edge (parts inside the room)
    function getVisibleSegments(p1, p2, roomPoly) {
        const segments = [];

        // Find all intersections with room edges
        const intersections = [];
        for (let j = 0; j < roomPoly.length; j++) {
            const r1 = roomPoly[j];
            const r2 = roomPoly[(j + 1) % roomPoly.length];
            const inter = segmentIntersection(p1, p2, r1, r2);
            if (inter) {
                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;
                const len = Math.sqrt(dx * dx + dy * dy);
                const t = len > 0.001 ? ((inter.x - p1.x) * dx + (inter.y - p1.y) * dy) / (len * len) : 0;
                if (t > 0.001 && t < 0.999) {
                    intersections.push({ x: inter.x, y: inter.y, t });
                }
            }
        }

        // Sort by t
        intersections.sort((a, b) => a.t - b.t);

        // Build segments by checking which parts are inside
        const points = [
            { x: p1.x, y: p1.y, t: 0 },
            ...intersections,
            { x: p2.x, y: p2.y, t: 1 }
        ];

        for (let i = 0; i < points.length - 1; i++) {
            const midT = (points[i].t + points[i + 1].t) / 2;
            const midX = p1.x + midT * (p2.x - p1.x);
            const midY = p1.y + midT * (p2.y - p1.y);

            if (pointInPolygon({ x: midX, y: midY }, roomPoly)) {
                segments.push({
                    start: { x: points[i].x, y: points[i].y },
                    end: { x: points[i + 1].x, y: points[i + 1].y }
                });
            }
        }

        return segments;
    }

    // Get segments of a room edge that are inside the plank
    function getSegmentInsidePlank(r1, r2, plankCorners) {
        const segments = [];

        // Find intersections with plank edges
        const intersections = [];
        for (let i = 0; i < 4; i++) {
            const p1 = plankCorners[i];
            const p2 = plankCorners[(i + 1) % 4];
            const inter = segmentIntersection(r1, r2, p1, p2);
            if (inter) {
                const dx = r2.x - r1.x;
                const dy = r2.y - r1.y;
                const len = Math.sqrt(dx * dx + dy * dy);
                const t = len > 0.001 ? ((inter.x - r1.x) * dx + (inter.y - r1.y) * dy) / (len * len) : 0;
                if (t > 0.001 && t < 0.999) {
                    intersections.push({ x: inter.x, y: inter.y, t });
                }
            }
        }

        // Sort by t
        intersections.sort((a, b) => a.t - b.t);

        // Build segments
        const points = [
            { x: r1.x, y: r1.y, t: 0 },
            ...intersections,
            { x: r2.x, y: r2.y, t: 1 }
        ];

        for (let i = 0; i < points.length - 1; i++) {
            const midT = (points[i].t + points[i + 1].t) / 2;
            const midX = r1.x + midT * (r2.x - r1.x);
            const midY = r1.y + midT * (r2.y - r1.y);

            if (pointInPolygon({ x: midX, y: midY }, plankCorners)) {
                segments.push({
                    start: { x: points[i].x, y: points[i].y },
                    end: { x: points[i + 1].x, y: points[i + 1].y }
                });
            }
        }

        return segments;
    }

    // Point in polygon using winding number (works for non-convex)
    function pointInPolygon(point, polygon) {
        let winding = 0;
        const n = polygon.length;

        for (let i = 0; i < n; i++) {
            const p1 = polygon[i];
            const p2 = polygon[(i + 1) % n];

            if (p1.y <= point.y) {
                if (p2.y > point.y) {
                    const cross = (p2.x - p1.x) * (point.y - p1.y) - (point.x - p1.x) * (p2.y - p1.y);
                    if (cross > 0) winding++;
                }
            } else {
                if (p2.y <= point.y) {
                    const cross = (p2.x - p1.x) * (point.y - p1.y) - (point.x - p1.x) * (p2.y - p1.y);
                    if (cross < 0) winding--;
                }
            }
        }

        return winding !== 0;
    }

    // Segment-segment intersection
    function segmentIntersection(p1, p2, p3, p4) {
        const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
        const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
        const cross = d1x * d2y - d1y * d2x;

        if (Math.abs(cross) < 1e-10) return null;

        const dx = p3.x - p1.x, dy = p3.y - p1.y;
        const t1 = (dx * d2y - dy * d2x) / cross;
        const t2 = (dx * d1y - dy * d1x) / cross;

        // Use small epsilon to avoid edge cases
        if (t1 > 0.001 && t1 < 0.999 && t2 > 0.001 && t2 < 0.999) {
            return { x: p1.x + t1 * d1x, y: p1.y + t1 * d1y };
        }
        return null;
    }

    // Helper for rounded rectangles (cross-browser)
    function drawRoundedRect(ctx, x, y, width, height, radius) {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        ctx.lineTo(x + radius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
    }

    function drawDetailedPlank(plank, roomVertices, pieces, size) {
        const ctx = detailCtx;
        const padding = 60;

        // Clear
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, size, size);

        const cos = Math.cos(plank.rotation);
        const sin = Math.sin(plank.rotation);
        const hw = plank.originalWidth / 2;
        const hh = plank.originalHeight / 2;

        // Full plank corners in world coords
        const fullPlank = [
            { x: plank.cx + (-hw) * cos - (-hh) * sin, y: plank.cy + (-hw) * sin + (-hh) * cos },
            { x: plank.cx + (hw) * cos - (-hh) * sin, y: plank.cy + (hw) * sin + (-hh) * cos },
            { x: plank.cx + (hw) * cos - (hh) * sin, y: plank.cy + (hw) * sin + (hh) * cos },
            { x: plank.cx + (-hw) * cos - (hh) * sin, y: plank.cy + (-hw) * sin + (hh) * cos }
        ];

        // Calculate bounds from full plank
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of fullPlank) {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
        }

        const polyWidth = maxX - minX;
        const polyHeight = maxY - minY;
        // Base scale to fit plank in canvas
        const baseScale = Math.min((size - padding * 2) / polyWidth, (size - padding * 2) / polyHeight);
        const baseOffsetX = size / 2 - (minX + polyWidth / 2) * baseScale;
        const baseOffsetY = size / 2 - (minY + polyHeight / 2) * baseScale;

        // Apply modalView transform (zoom/pan) on top of base transform
        const centerX = size / 2;
        const centerY = size / 2;

        function toCanvas(p) {
            // First apply base transform
            const baseX = p.x * baseScale + baseOffsetX;
            const baseY = p.y * baseScale + baseOffsetY;
            // Then apply zoom/pan relative to center
            return {
                x: centerX + (baseX - centerX) * modalView.scale + modalView.offsetX,
                y: centerY + (baseY - centerY) * modalView.scale + modalView.offsetY
            };
        }

        const fullCorners = fullPlank.map(toCanvas);

        // Draw full plank outline (dotted) if edge plank
        if (plank.isEdgePlank) {
            ctx.strokeStyle = '#555';
            ctx.lineWidth = 1;
            ctx.setLineDash([5, 5]);
            ctx.beginPath();
            ctx.moveTo(fullCorners[0].x, fullCorners[0].y);
            for (let i = 1; i < fullCorners.length; i++) {
                ctx.lineTo(fullCorners[i].x, fullCorners[i].y);
            }
            ctx.closePath();
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Draw clipped plank using room polygon as clip path (same as main canvas)
        if (plank.isEdgePlank && roomVertices.length >= 3) {
            ctx.save();

            // Create clipping path from room polygon
            const roomPath = roomVertices.map(toCanvas);
            ctx.beginPath();
            ctx.moveTo(roomPath[0].x, roomPath[0].y);
            for (let i = 1; i < roomPath.length; i++) {
                ctx.lineTo(roomPath[i].x, roomPath[i].y);
            }
            ctx.closePath();
            ctx.clip();

            // Fill full plank (will be clipped to room shape)
            ctx.fillStyle = '#d4a574';
            ctx.strokeStyle = '#8b6914';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(fullCorners[0].x, fullCorners[0].y);
            for (let i = 1; i < fullCorners.length; i++) {
                ctx.lineTo(fullCorners[i].x, fullCorners[i].y);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            ctx.restore();
        } else {
            // Full plank - just draw it
            ctx.fillStyle = '#d4a574';
            ctx.strokeStyle = '#8b6914';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(fullCorners[0].x, fullCorners[0].y);
            for (let i = 1; i < fullCorners.length; i++) {
                ctx.lineTo(fullCorners[i].x, fullCorners[i].y);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        }

        // Draw edge labels with arrows for each piece
        ctx.font = 'bold 11px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        for (const piece of pieces) {
            const { edges } = piece;

            // Draw edges
            for (let i = 0; i < edges.length; i++) {
                const edge = edges[i];
                const p1 = toCanvas(edge.p1);
                const p2 = toCanvas(edge.p2);

                // Edge direction
                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;
                const len = Math.sqrt(dx * dx + dy * dy);
                if (len < 20) continue; // Skip tiny edges

                // Normalize direction
                const ndx = dx / len;
                const ndy = dy / len;

                // Perpendicular for label offset (pointing outward)
                const nx = -ndy * 22;
                const ny = ndx * 22;

                // Determine colors based on edge type
                const isCut = edge.type === 'cut';
                const bgColor = isCut ? 'rgba(255, 107, 107, 0.95)' : 'rgba(74, 158, 255, 0.95)';
                const arrowColor = isCut ? '#ff6b6b' : '#4a9eff';

                // Draw arrow line along the actual edge (no extension beyond endpoints)
                ctx.strokeStyle = arrowColor;
                ctx.lineWidth = 2;
                ctx.setLineDash(isCut ? [6, 4] : []);

                // Draw line along the edge
                ctx.beginPath();
                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.stroke();
                ctx.setLineDash([]);

                // Draw arrowheads at both ends (pointing outward)
                const headLen = 8;
                drawArrowhead(ctx, p1.x, p1.y, ndx, ndy, headLen, arrowColor);
                drawArrowhead(ctx, p2.x, p2.y, -ndx, -ndy, headLen, arrowColor);

                // Label position (midpoint with perpendicular offset)
                const midX = (p1.x + p2.x) / 2;
                const midY = (p1.y + p2.y) / 2;
                let labelX = midX + nx;
                let labelY = midY + ny;

                // Clamp label to canvas if needed
                const label = `${edge.label}: ${round(edge.length, 1)} cm`;
                const labelWidth = ctx.measureText(label).width + 12;
                const labelHeight = 20;

                labelX = Math.max(labelWidth / 2 + 5, Math.min(size - labelWidth / 2 - 5, labelX));
                labelY = Math.max(labelHeight / 2 + 5, Math.min(size - labelHeight / 2 - 5, labelY));

                // Label background (rounded rect)
                ctx.fillStyle = bgColor;
                drawRoundedRect(ctx, labelX - labelWidth / 2, labelY - labelHeight / 2, labelWidth, labelHeight, 4);
                ctx.fill();

                // Label text
                ctx.fillStyle = '#fff';
                ctx.fillText(label, labelX, labelY);
            }
        }
    }

    // Helper to draw arrowhead
    function drawArrowhead(ctx, x, y, dx, dy, len, color) {
        ctx.fillStyle = color;
        ctx.beginPath();
        // Arrow points in direction (-dx, -dy)
        const angle = Math.atan2(-dy, -dx);
        const spread = Math.PI / 6; // 30 degrees
        ctx.moveTo(x, y);
        ctx.lineTo(x + len * Math.cos(angle - spread), y + len * Math.sin(angle - spread));
        ctx.lineTo(x + len * Math.cos(angle + spread), y + len * Math.sin(angle + spread));
        ctx.closePath();
        ctx.fill();
    }

    // Helper to clamp point to canvas bounds
    function clampToCanvas(p, size, margin) {
        return {
            x: Math.max(margin, Math.min(size - margin, p.x)),
            y: Math.max(margin, Math.min(size - margin, p.y))
        };
    }

    function updateDetailInfo(plank, pieces) {
        if (!detailInfo) return;

        // Aggregate all edges from all pieces
        const allEdges = pieces.flatMap(p => p.edges);

        // Separate plank edges and cut edges
        const plankEdges = allEdges.filter(e => e.type === 'plank');
        const cutEdges = allEdges.filter(e => e.type === 'cut');

        const html = `
            <div class="info-section">
                <h3>Plank Info</h3>
                <div class="info-row">
                    <span class="info-label">Plank #</span>
                    <span class="info-value">${plank.id + 1}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Full Size</span>
                    <span class="info-value">${round(plank.originalWidth, 1)} × ${round(plank.originalHeight, 1)} cm</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Type</span>
                    <span class="info-value">${plank.isEdgePlank ? 'Cut required' : 'Full plank'}</span>
                </div>
            </div>
            <div class="info-section">
                <h3>Visible Edges</h3>
                <ul class="edge-list">
                    ${plankEdges.map(e => `<li><span class="edge-plank">${e.label}</span>: <strong>${round(e.length, 1)} cm</strong></li>`).join('')}
                </ul>
                ${cutEdges.length > 0 ? `
                <h3 style="margin-top: 8px;">Cuts</h3>
                <ul class="edge-list">
                    ${cutEdges.map(e => `<li><span class="edge-cut">${e.label}</span>: <strong>${round(e.length, 1)} cm</strong></li>`).join('')}
                </ul>
                ` : ''}
            </div>
        `;

        detailInfo.innerHTML = html;
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

/**
 * Show mobile hint tooltip
 */
function showMobileHint() {
    // Create mobile hint element
    const hint = document.createElement('div');
    hint.className = 'mobile-hint';
    hint.innerHTML = `
        <div class="mobile-hint-content">
            <strong>Mobile View</strong>
            <p>Drag to pan, pinch to zoom</p>
            <p>Tap a plank to see details</p>
            <button class="btn btn-sm" id="dismiss-mobile-hint">Got it</button>
        </div>
    `;
    document.body.appendChild(hint);

    // Show after a short delay
    setTimeout(() => hint.classList.add('visible'), 500);

    // Dismiss on button click or tap outside
    const dismissBtn = hint.querySelector('#dismiss-mobile-hint');
    dismissBtn.addEventListener('click', () => {
        hint.classList.remove('visible');
        setTimeout(() => hint.remove(), 300);
    });

    // Auto-dismiss after 8 seconds
    setTimeout(() => {
        if (hint.parentNode) {
            hint.classList.remove('visible');
            setTimeout(() => hint.remove(), 300);
        }
    }, 8000);
}

// Start app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
