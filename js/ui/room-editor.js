/**
 * Room editor - point and click polygon creation
 */

import { state } from '../state.js';
import { distance } from '../utils.js';
import { getWallLengths, polygonCentroid } from '../geometry/polygon.js';

const SNAP_DISTANCE = 20; // pixels
const DEFAULT_LONGEST_WALL = 500; // cm (5 meters)

/**
 * Initialize room editor
 * @param {HTMLCanvasElement} canvas
 * @param {Function} getTransform - Function to get current transform
 */
export function initRoomEditor(canvas, getTransform) {
    let mouseWorldPos = null;

    // Vertex drag state
    let vertexDrag = {
        active: false,
        vertexIndex: null,
        startX: 0,
        startY: 0,
        hasMoved: false
    };

    // Flag to ignore click event after drag
    let ignoreNextClick = false;

    function handleMouseDown(e) {
        const currentState = state.get();

        // Shift+mousedown to start vertex edit/drag
        if (e.shiftKey && currentState.room.isComplete && currentState.ui.mode === 'idle') {
            // ALWAYS stop propagation when Shift is held to prevent panning
            e.preventDefault();
            e.stopImmediatePropagation();

            const transform = getTransform();
            const rect = canvas.getBoundingClientRect();
            // Work in CSS pixels (transform handles DPR via ctx.scale)
            const screenX = e.clientX - rect.left;
            const screenY = e.clientY - rect.top;

            const vertices = currentState.room.vertices;

            // Check if near a vertex
            for (let i = 0; i < vertices.length; i++) {
                const v = vertices[i];
                const vScreen = transform.worldToScreen(v.x, v.y);
                const dist = Math.hypot(screenX - vScreen.x, screenY - vScreen.y);

                if (dist < SNAP_DISTANCE) {
                    vertexDrag = {
                        active: true,
                        vertexIndex: i,
                        startX: e.clientX,
                        startY: e.clientY,
                        hasMoved: false
                    };
                    state.set('ui.isDraggingVertex', true);
                    canvas.style.cursor = 'grabbing';
                    return;
                }
            }
        }
    }

    function handleMouseUp(e) {
        if (vertexDrag.active) {
            const currentState = state.get();
            const vertices = currentState.room.vertices;

            if (!vertexDrag.hasMoved) {
                // It was a click, not a drag - confirm delete
                // Always ignore the click event that follows to prevent adding a vertex
                ignoreNextClick = true;
                if (vertices.length > 3) {
                    const wallLabel = String.fromCharCode(65 + vertexDrag.vertexIndex);
                    if (confirm(`Delete vertex ${wallLabel}?`)) {
                        const newVertices = vertices.filter((_, idx) => idx !== vertexDrag.vertexIndex);
                        state.batch({
                            'room.vertices': newVertices,
                            'room.wallDimensions': [],
                            'ui.isDraggingVertex': false
                        });
                    } else {
                        state.set('ui.isDraggingVertex', false);
                    }
                } else {
                    state.set('ui.isDraggingVertex', false);
                }
            } else {
                // Drag happened - ignore the click event that follows
                ignoreNextClick = true;
                state.set('ui.isDraggingVertex', false);
            }

            vertexDrag = { active: false, vertexIndex: null, startX: 0, startY: 0, hasMoved: false };
            canvas.style.cursor = 'default';
        }
    }

    function handleVertexDrag(e) {
        if (!vertexDrag.active) return;

        const dx = e.clientX - vertexDrag.startX;
        const dy = e.clientY - vertexDrag.startY;
        const moveThreshold = 5;

        if (Math.abs(dx) > moveThreshold || Math.abs(dy) > moveThreshold) {
            vertexDrag.hasMoved = true;

            const transform = getTransform();
            const rect = canvas.getBoundingClientRect();
            // Work in CSS pixels
            const screenX = e.clientX - rect.left;
            const screenY = e.clientY - rect.top;
            const worldPos = transform.screenToWorld(screenX, screenY);

            const currentState = state.get();
            const newVertices = [...currentState.room.vertices];
            newVertices[vertexDrag.vertexIndex] = { x: worldPos.x, y: worldPos.y };

            state.batch({
                'room.vertices': newVertices,
                'room.wallDimensions': []
            });
        }
    }

    function handleClick(e) {
        // Ignore click if it's the result of a vertex drag
        if (ignoreNextClick) {
            ignoreNextClick = false;
            return;
        }

        // Skip click during dragging (panning or floor drag)
        if (canvas.classList.contains('panning') || canvas.classList.contains('dragging')) {
            return;
        }

        const currentState = state.get();

        // Shift+click on wall to add vertex (vertex clicks handled by mousedown/up)
        if (e.shiftKey && currentState.room.isComplete && currentState.ui.mode === 'idle') {
            handleWallClick(e, currentState, getTransform);
            return;
        }

        // Regular click on wall to select it and focus input
        if (!e.shiftKey && currentState.room.isComplete && currentState.ui.mode === 'idle') {
            const wallIndex = getWallAtPosition(e, currentState, getTransform);
            if (wallIndex !== null) {
                // Clear plank selection when selecting wall
                state.batch({
                    'ui.selectedWall': wallIndex,
                    'ui.selectedPlank': null
                });
                // Focus the corresponding input
                const input = document.querySelector(`.wall-dimension-input[data-wall-index="${wallIndex}"]`);
                if (input) {
                    input.focus();
                    input.select();
                }
                return;
            }
        }

        if (currentState.ui.mode !== 'drawing') return;

        const transform = getTransform();
        const rect = canvas.getBoundingClientRect();
        // Work in CSS pixels
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        const worldPos = transform.screenToWorld(screenX, screenY);

        const vertices = currentState.room.vertices;

        // Check if clicking near first vertex to close polygon
        if (vertices.length >= 3) {
            const firstVertex = vertices[0];
            const firstScreen = transform.worldToScreen(firstVertex.x, firstVertex.y);
            const clickDist = Math.hypot(screenX - firstScreen.x, screenY - firstScreen.y);

            if (clickDist < SNAP_DISTANCE) {
                // Close the polygon and scale so longest wall is 5m
                const wallLengths = getWallLengths(vertices);
                const longestWall = Math.max(...wallLengths);

                if (longestWall > 0) {
                    const scale = DEFAULT_LONGEST_WALL / longestWall;
                    const centroid = polygonCentroid(vertices);

                    // Scale vertices around centroid
                    const scaledVertices = vertices.map(v => ({
                        x: centroid.x + (v.x - centroid.x) * scale,
                        y: centroid.y + (v.y - centroid.y) * scale
                    }));

                    // Adjust view to keep room same size and position on screen
                    const currentView = state.get().view;
                    const oldScale = currentView.scale;
                    // Clamp new scale to reasonable bounds (0.5 to 5 pixels per cm)
                    const newViewScale = Math.max(0.5, Math.min(5, oldScale / scale));

                    // Adjust offset to keep centroid at same screen position
                    const newOffsetX = currentView.offsetX + centroid.x * (oldScale - newViewScale);
                    const newOffsetY = currentView.offsetY + centroid.y * (oldScale - newViewScale);

                    state.batch({
                        'room.vertices': scaledVertices,
                        'room.isComplete': true,
                        'room.hasBeenScaled': true,
                        'ui.mode': 'idle',
                        'view.scale': newViewScale,
                        'view.offsetX': newOffsetX,
                        'view.offsetY': newOffsetY
                    });
                } else {
                    state.batch({
                        'room.isComplete': true,
                        'room.hasBeenScaled': true,
                        'ui.mode': 'idle'
                    });
                }
                updateHint(false);
                return;
            }
        }

        // Add new vertex
        const newVertices = [...vertices, { x: worldPos.x, y: worldPos.y }];
        state.set('room.vertices', newVertices);
    }

    function handleMouseMove(e) {
        const currentState = state.get();

        // Skip hover during dragging (panning or floor drag)
        if (canvas.classList.contains('panning') || canvas.classList.contains('dragging')) {
            if (currentState.ui.hoveredWall !== null) {
                state.set('ui.hoveredWall', null);
            }
            return;
        }

        const transform = getTransform();
        const rect = canvas.getBoundingClientRect();
        // Work in CSS pixels
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        const snapDist = SNAP_DISTANCE;

        // Handle cursor and hover state for idle mode (walls are clickable)
        if (!e.shiftKey && currentState.room.isComplete && currentState.ui.mode === 'idle') {
            // Only show wall hover if not hovering over a plank (planks take priority)
            if (currentState.ui.hoveredPlank === null) {
                const wallIndex = getWallAtPosition(e, currentState, getTransform);
                if (wallIndex !== null) {
                    if (currentState.ui.hoveredWall !== wallIndex) {
                        state.set('ui.hoveredWall', wallIndex);
                    }
                    canvas.style.cursor = 'pointer';
                    return;
                }
            }
            // Clear wall hover if not over a wall (or if hovering a plank)
            if (currentState.ui.hoveredWall !== null) {
                state.set('ui.hoveredWall', null);
            }
        }

        // Handle cursor for Shift+edit mode
        if (e.shiftKey && currentState.room.isComplete && currentState.ui.mode === 'idle') {
            // Clear wall hover in shift mode
            if (currentState.ui.hoveredWall !== null) {
                state.set('ui.hoveredWall', null);
            }
            const vertices = currentState.room.vertices;
            const n = vertices.length;

            // Check if near a vertex (can drag or delete)
            for (let i = 0; i < n; i++) {
                const v = vertices[i];
                const vScreen = transform.worldToScreen(v.x, v.y);
                const dist = Math.hypot(screenX - vScreen.x, screenY - vScreen.y);
                if (dist < snapDist) {
                    // Grab cursor - can drag to move or click to delete
                    canvas.style.cursor = 'grab';
                    return;
                }
            }

            // Check if near a wall (add cursor)
            for (let i = 0; i < n; i++) {
                const j = (i + 1) % n;
                const v1 = vertices[i];
                const v2 = vertices[j];
                const worldPos = transform.screenToWorld(screenX, screenY);

                const wallDx = v2.x - v1.x;
                const wallDy = v2.y - v1.y;
                const wallLen = Math.sqrt(wallDx * wallDx + wallDy * wallDy);
                if (wallLen === 0) continue;

                const t = ((worldPos.x - v1.x) * wallDx + (worldPos.y - v1.y) * wallDy) / (wallLen * wallLen);
                if (t < 0.05 || t > 0.95) continue;

                const closestX = v1.x + t * wallDx;
                const closestY = v1.y + t * wallDy;
                const closestScreen = transform.worldToScreen(closestX, closestY);
                const distToWall = Math.hypot(screenX - closestScreen.x, screenY - closestScreen.y);

                if (distToWall < snapDist) {
                    canvas.style.cursor = 'cell';
                    return;
                }
            }

            canvas.style.cursor = 'default';
            return;
        }

        if (currentState.ui.mode !== 'drawing') {
            mouseWorldPos = null;
            canvas.style.cursor = 'default';
            // Clear wall hover when not in idle mode
            if (currentState.ui.hoveredWall !== null) {
                state.set('ui.hoveredWall', null);
            }
            return;
        }

        mouseWorldPos = transform.screenToWorld(screenX, screenY);

        // Check for hover on first vertex
        const vertices = currentState.room.vertices;
        if (vertices.length >= 3) {
            const firstVertex = vertices[0];
            const firstScreen = transform.worldToScreen(firstVertex.x, firstVertex.y);
            const dist = Math.hypot(screenX - firstScreen.x, screenY - firstScreen.y);

            if (dist < snapDist) {
                canvas.style.cursor = 'pointer';
            } else {
                canvas.style.cursor = 'crosshair';
            }
        }
    }

    function handleKeyDown(e) {
        const currentState = state.get();

        // Escape to cancel drawing
        if (e.key === 'Escape' && currentState.ui.mode === 'drawing') {
            state.batch({
                'room.vertices': [],
                'room.isComplete': false,
                'ui.mode': 'idle'
            });
            updateHint(false);
        }

        // Backspace to remove last vertex while drawing
        if (e.key === 'Backspace' && currentState.ui.mode === 'drawing') {
            const vertices = currentState.room.vertices;
            if (vertices.length > 0) {
                state.set('room.vertices', vertices.slice(0, -1));
            }
        }
    }

    function updateHint(visible) {
        const hint = document.getElementById('room-hint');
        if (hint) {
            hint.classList.toggle('visible', visible);
        }
    }

    function getWallAtPosition(e, currentState, getTransform) {
        const transform = getTransform();
        const rect = canvas.getBoundingClientRect();
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        const worldPos = transform.screenToWorld(screenX, screenY);

        const vertices = currentState.room.vertices;
        const n = vertices.length;

        // Check each wall
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            const v1 = vertices[i];
            const v2 = vertices[j];

            const wallDx = v2.x - v1.x;
            const wallDy = v2.y - v1.y;
            const wallLen = Math.sqrt(wallDx * wallDx + wallDy * wallDy);

            if (wallLen === 0) continue;

            // Project click onto wall line
            const t = ((worldPos.x - v1.x) * wallDx + (worldPos.y - v1.y) * wallDy) / (wallLen * wallLen);
            if (t < 0 || t > 1) continue;

            // Distance from click to wall
            const closestX = v1.x + t * wallDx;
            const closestY = v1.y + t * wallDy;
            const closestScreen = transform.worldToScreen(closestX, closestY);
            const distToWall = Math.hypot(screenX - closestScreen.x, screenY - closestScreen.y);

            if (distToWall < SNAP_DISTANCE) {
                return i;
            }
        }

        return null;
    }

    function handleWallClick(e, currentState, getTransform) {
        const transform = getTransform();
        const rect = canvas.getBoundingClientRect();
        // Work in CSS pixels
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        const worldPos = transform.screenToWorld(screenX, screenY);
        const snapDist = SNAP_DISTANCE;

        const vertices = currentState.room.vertices;
        const n = vertices.length;

        // Skip if near a vertex (handled by drag logic)
        for (let i = 0; i < n; i++) {
            const v = vertices[i];
            const vScreen = transform.worldToScreen(v.x, v.y);
            const dist = Math.hypot(screenX - vScreen.x, screenY - vScreen.y);
            if (dist < snapDist) return;
        }

        // Check if clicking near a wall (to add vertex)
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            const v1 = vertices[i];
            const v2 = vertices[j];

            const wallDx = v2.x - v1.x;
            const wallDy = v2.y - v1.y;
            const wallLen = Math.sqrt(wallDx * wallDx + wallDy * wallDy);

            if (wallLen === 0) continue;

            const t = ((worldPos.x - v1.x) * wallDx + (worldPos.y - v1.y) * wallDy) / (wallLen * wallLen);
            if (t < 0.05 || t > 0.95) continue;

            const closestX = v1.x + t * wallDx;
            const closestY = v1.y + t * wallDy;
            const closestScreen = transform.worldToScreen(closestX, closestY);
            const distToWall = Math.hypot(screenX - closestScreen.x, screenY - closestScreen.y);

            if (distToWall < snapDist) {
                const newVertex = { x: closestX, y: closestY };
                const newVertices = [
                    ...vertices.slice(0, i + 1),
                    newVertex,
                    ...vertices.slice(i + 1)
                ];
                state.batch({
                    'room.vertices': newVertices,
                    'room.wallDimensions': []
                });
                return;
            }
        }
    }

    function startDrawing() {
        state.batch({
            'room.vertices': [],
            'room.isComplete': false,
            'room.hasBeenScaled': false,
            'room.wallDimensions': [],
            'ui.mode': 'drawing'
        });
        updateHint(true);
        canvas.style.cursor = 'crosshair';
    }

    function clearRoom() {
        state.batch({
            'room.vertices': [],
            'room.isComplete': false,
            'room.hasBeenScaled': false,
            'room.wallDimensions': [],
            'ui.mode': 'idle'
        });
        updateHint(false);
        canvas.style.cursor = 'default';
    }

    // Event listeners
    canvas.addEventListener('click', handleClick);
    // Use capture phase to ensure this runs before pan handlers
    canvas.addEventListener('mousedown', handleMouseDown, true);
    canvas.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mousemove', handleVertexDrag);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('keydown', handleKeyDown);

    // Button handlers
    const newRoomBtn = document.getElementById('btn-new-room');
    const clearRoomBtn = document.getElementById('btn-clear-room');

    if (newRoomBtn) {
        newRoomBtn.addEventListener('click', startDrawing);
    }

    if (clearRoomBtn) {
        clearRoomBtn.addEventListener('click', clearRoom);
    }

    return {
        getMouseWorldPos: () => mouseWorldPos,
        startDrawing,
        clearRoom
    };
}

/**
 * Update walls list in sidebar
 */
export function updateWallsList(vertices, wallDimensions) {
    const container = document.getElementById('walls-list');
    if (!container) return;

    if (vertices.length < 2) {
        container.innerHTML = '';
        return;
    }

    const n = vertices.length;
    let html = '';

    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const v1 = vertices[i];
        const v2 = vertices[j];
        const actualLength = Math.round(distance(v1, v2) * 10) / 10; // Round to 1 decimal
        const targetLength = wallDimensions[i];
        const wallLabel = String.fromCharCode(65 + i); // A, B, C, ...

        // Check if there's a mismatch between target and actual
        const hasMismatch = targetLength !== undefined && targetLength !== null &&
            Math.abs(targetLength - actualLength) > 0.2;

        html += `
            <div class="wall-item ${hasMismatch ? 'has-mismatch' : ''}">
                <span>Wall ${wallLabel}</span>
                <div class="wall-dimension-group">
                    <input type="number"
                           value="${actualLength}"
                           data-wall-index="${i}"
                           class="wall-dimension-input"
                           min="1"
                           step="0.1"> cm
                    ${hasMismatch ? `<span class="wall-target" title="Target dimension">(target: ${targetLength})</span>` : ''}
                </div>
            </div>
        `;
    }

    container.innerHTML = html;

    // Add event listeners for wall dimension inputs
    container.querySelectorAll('.wall-dimension-input').forEach(input => {
        input.addEventListener('change', (e) => {
            const index = parseInt(e.target.dataset.wallIndex);
            const value = parseFloat(e.target.value);
            handleWallDimensionChange(index, value);
        });

        input.addEventListener('focus', (e) => {
            const index = parseInt(e.target.dataset.wallIndex);
            // Clear plank selection when focusing wall input
            state.batch({
                'ui.selectedWall': index,
                'ui.selectedPlank': null
            });
        });

        input.addEventListener('blur', () => {
            state.set('ui.selectedWall', null);
        });
    });
}

/**
 * Handle wall dimension change
 * - First edit: scale all walls proportionally
 * - Subsequent edits: move only the endpoint of that wall (changes room shape)
 */
function handleWallDimensionChange(wallIndex, newLength) {
    const currentState = state.get();
    const vertices = currentState.room.vertices;
    const wallDimensions = currentState.room.wallDimensions || [];

    if (vertices.length < 2) return;
    if (newLength <= 0) return;

    const n = vertices.length;
    const i = wallIndex;
    const j = (i + 1) % n;

    const v1 = vertices[i];
    const v2 = vertices[j];
    const currentLength = distance(v1, v2);

    if (currentLength === 0) return;

    // Check if this is the first wall edit (room hasn't been scaled yet)
    const isFirstEdit = !currentState.room.hasBeenScaled;

    let newVertices;

    if (isFirstEdit) {
        // First edit: scale all walls proportionally from centroid
        const scale = newLength / currentLength;

        let cx = 0, cy = 0;
        for (const v of vertices) {
            cx += v.x;
            cy += v.y;
        }
        cx /= n;
        cy /= n;

        newVertices = vertices.map(v => ({
            x: cx + (v.x - cx) * scale,
            y: cy + (v.y - cy) * scale
        }));

        // Adjust view to keep room same size and position on screen
        const oldViewScale = currentState.view.scale;
        // Clamp new scale to reasonable bounds (0.5 to 5 pixels per cm)
        const newViewScale = Math.max(0.5, Math.min(5, oldViewScale / scale));
        const actualScaleChange = newViewScale / oldViewScale;

        // Adjust offset to keep centroid at same screen position
        const newOffsetX = currentState.view.offsetX + cx * (oldViewScale - newViewScale);
        const newOffsetY = currentState.view.offsetY + cy * (oldViewScale - newViewScale);

        // Update wall dimensions and view together
        const newWallDimensions = [];
        while (newWallDimensions.length < n) {
            newWallDimensions.push(undefined);
        }
        newWallDimensions[wallIndex] = newLength;

        state.batch({
            'room.vertices': newVertices,
            'room.wallDimensions': newWallDimensions,
            'room.hasBeenScaled': true,
            'view.scale': newViewScale,
            'view.offsetX': newOffsetX,
            'view.offsetY': newOffsetY
        });
        return;
    } else {
        // Subsequent edits: move only the endpoint of this wall
        // This changes the room shape
        const dx = v2.x - v1.x;
        const dy = v2.y - v1.y;

        // Unit vector along the wall direction
        const ux = dx / currentLength;
        const uy = dy / currentLength;

        // New position for vertex j (endpoint of wall)
        const newV2 = {
            x: v1.x + ux * newLength,
            y: v1.y + uy * newLength
        };

        newVertices = vertices.map((v, idx) => {
            if (idx === j) return newV2;
            return { ...v };
        });
    }

    // Update wall dimensions array
    const newWallDimensions = [...wallDimensions];
    // Ensure array is long enough
    while (newWallDimensions.length < n) {
        newWallDimensions.push(undefined);
    }
    newWallDimensions[wallIndex] = newLength;

    state.batch({
        'room.vertices': newVertices,
        'room.wallDimensions': newWallDimensions
    });
}
