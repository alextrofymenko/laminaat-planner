/**
 * UI controls for plank settings, view, and interactions
 */

import { state } from '../state.js';
import { fitBoundsToView } from '../geometry/transforms.js';
import { polygonBounds } from '../geometry/polygon.js';

/**
 * Detect if device is mobile/touch
 */
export function isMobileDevice() {
    return (
        'ontouchstart' in window ||
        navigator.maxTouchPoints > 0 ||
        window.matchMedia('(max-width: 768px)').matches
    );
}

/**
 * Initialize all control panel inputs
 */
export function initControls(canvas) {
    const currentState = state.get();

    // Plank dimensions
    const plankLength = document.getElementById('plank-length');
    const plankWidth = document.getElementById('plank-width');

    if (plankLength) {
        plankLength.value = currentState.plank.length;
        plankLength.addEventListener('change', (e) => {
            state.set('plank.length', parseFloat(e.target.value) || 120);
        });
    }

    if (plankWidth) {
        plankWidth.value = currentState.plank.width;
        plankWidth.addEventListener('change', (e) => {
            state.set('plank.width', parseFloat(e.target.value) || 20);
        });
    }

    // Floor rotation
    const rotation = document.getElementById('floor-rotation');
    const rotationValue = document.getElementById('rotation-value');

    if (rotation) {
        rotation.value = currentState.floor.rotation;
        if (rotationValue) {
            rotationValue.textContent = `${currentState.floor.rotation}°`;
        }

        const updateRotation = (e) => {
            const value = Math.round(parseFloat(e.target.value) * 10) / 10; // Round to 0.1°
            e.target.value = value;
            state.set('floor.rotation', value);
            if (rotationValue) {
                rotationValue.textContent = `${value}°`;
            }
        };

        rotation.addEventListener('input', updateRotation);
        rotation.addEventListener('change', updateRotation);
    }

    // Offset pattern
    const offsetPattern = document.getElementById('offset-pattern');
    const customOffsetGroup = document.getElementById('custom-offset-group');
    const customOffset = document.getElementById('custom-offset');
    const customOffsetValue = document.getElementById('custom-offset-value');

    if (offsetPattern) {
        // Sync select to state value
        const stateOffset = currentState.floor.offsetPattern;
        const standardValues = [0.5, 0.333, 0.25];
        const isStandard = standardValues.some(v => Math.abs(v - stateOffset) < 0.01);
        if (isStandard) {
            offsetPattern.value = stateOffset.toString();
            if (customOffsetGroup) customOffsetGroup.style.display = 'none';
        } else {
            offsetPattern.value = 'custom';
            if (customOffsetGroup) customOffsetGroup.style.display = 'block';
            if (customOffset) {
                customOffset.value = Math.round(stateOffset * 100);
                if (customOffsetValue) customOffsetValue.textContent = `${Math.round(stateOffset * 100)}%`;
            }
        }

        offsetPattern.addEventListener('change', (e) => {
            const value = e.target.value;
            if (value === 'custom') {
                customOffsetGroup.style.display = 'block';
                const customVal = parseInt(customOffset.value) / 100;
                state.set('floor.offsetPattern', customVal);
            } else {
                customOffsetGroup.style.display = 'none';
                state.set('floor.offsetPattern', parseFloat(value));
            }
        });
    }

    if (customOffset) {
        customOffset.addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            state.set('floor.offsetPattern', value / 100);
            if (customOffsetValue) {
                customOffsetValue.textContent = `${value}%`;
            }
        });
    }

    // Minimum visible width setting
    const minWidth = document.getElementById('min-width');

    if (minWidth) {
        minWidth.value = currentState.minimums.width;
        minWidth.addEventListener('change', (e) => {
            state.set('minimums.width', parseFloat(e.target.value) || 5);
        });
    }

    // Wall gap
    const wallGapInput = document.getElementById('wall-gap');
    if (wallGapInput) {
        wallGapInput.value = currentState.wallGap !== undefined ? currentState.wallGap : 0.5;
        wallGapInput.addEventListener('change', (e) => {
            state.set('wallGap', parseFloat(e.target.value) || 0);
        });
    }

    // View controls
    const fitViewBtn = document.getElementById('btn-fit-view');
    const resetPositionBtn = document.getElementById('btn-reset-position');

    if (fitViewBtn) {
        fitViewBtn.addEventListener('click', () => {
            const currentState = state.get();
            if (currentState.room.vertices.length >= 3) {
                const bounds = polygonBounds(currentState.room.vertices);
                const viewParams = fitBoundsToView(bounds, canvas);
                state.batch({
                    'view.scale': viewParams.scale,
                    'view.offsetX': viewParams.offsetX,
                    'view.offsetY': viewParams.offsetY
                });
            }
        });
    }

    if (resetPositionBtn) {
        resetPositionBtn.addEventListener('click', () => {
            state.batch({
                'floor.offsetX': 0,
                'floor.offsetY': 0
            });
        });
    }
}

/**
 * Initialize pan and zoom controls
 */
export function initPanZoom(canvas) {
    let isPanning = false;
    let lastPanX = 0;
    let lastPanY = 0;

    // Mouse wheel zoom - always relative to cursor position
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();

        const currentState = state.get();
        const { scale, offsetX, offsetY } = currentState.view;

        // Gentler zoom: 3% per scroll step
        const scrollAmount = Math.sign(e.deltaY);
        const zoomFactor = 1 - scrollAmount * 0.03;
        const newScale = Math.max(0.1, Math.min(10, scale * zoomFactor));

        // Pivot on cursor position - keep world point under cursor fixed
        const rect = canvas.getBoundingClientRect();
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const pivotX = e.clientX - rect.left - centerX;
        const pivotY = e.clientY - rect.top - centerY;

        const worldX = (pivotX - offsetX) / scale;
        const worldY = (pivotY - offsetY) / scale;

        const newOffsetX = pivotX - worldX * newScale;
        const newOffsetY = pivotY - worldY * newScale;

        state.batch({
            'view.scale': newScale,
            'view.offsetX': newOffsetX,
            'view.offsetY': newOffsetY
        });
    }, { passive: false });

    // Left-click drag to pan (when not in drawing mode), or middle mouse
    // Note: Shift+drag is reserved for vertex editing
    canvas.addEventListener('mousedown', (e) => {
        // Never pan with Shift held - reserved for vertex editing
        if (e.shiftKey) return;

        const currentState = state.get();
        const isDrawing = currentState.ui.mode === 'drawing';
        const isDraggingVertex = currentState.ui.isDraggingVertex;

        // Don't pan if vertex dragging is active
        if (isDraggingVertex) return;

        // Middle mouse always pans
        // Left mouse pans when not in drawing mode and not holding Ctrl
        if (e.button === 1 || (e.button === 0 && !isDrawing && !e.ctrlKey)) {
            isPanning = true;
            lastPanX = e.clientX;
            lastPanY = e.clientY;
            canvas.classList.add('panning');
            if (e.button === 1) {
                e.preventDefault();
            }
        }
    });

    document.addEventListener('mousemove', (e) => {
        if (!isPanning) return;

        // Stop panning if Shift is pressed or vertex dragging started
        const currentState = state.get();
        if (e.shiftKey || currentState.ui.isDraggingVertex) {
            isPanning = false;
            canvas.classList.remove('panning');
            return;
        }

        const dx = e.clientX - lastPanX;
        const dy = e.clientY - lastPanY;

        state.batch({
            'view.offsetX': currentState.view.offsetX + dx,
            'view.offsetY': currentState.view.offsetY + dy
        });

        lastPanX = e.clientX;
        lastPanY = e.clientY;
    });

    document.addEventListener('mouseup', (e) => {
        if (isPanning) {
            isPanning = false;
            canvas.classList.remove('panning');
        }
    });

    // Prevent context menu on middle click
    canvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
    });

    // Touch support for mobile
    let touchStartDistance = 0;
    let touchStartScale = 1;
    let lastTouchX = 0;
    let lastTouchY = 0;
    let isTouchPanning = false;

    let touchStartTime = 0;
    let touchMoved = false;

    canvas.addEventListener('touchstart', (e) => {
        touchStartTime = Date.now();
        touchMoved = false;

        if (e.touches.length === 1) {
            // Single touch - prepare for pan
            isTouchPanning = true;
            lastTouchX = e.touches[0].clientX;
            lastTouchY = e.touches[0].clientY;
        } else if (e.touches.length === 2) {
            // Two touches - prepare for pinch zoom
            isTouchPanning = false;
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            touchStartDistance = Math.sqrt(dx * dx + dy * dy);
            touchStartScale = state.get().view.scale;
            e.preventDefault(); // Prevent zoom only for pinch
        }
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
        const currentState = state.get();

        if (e.touches.length === 1 && isTouchPanning) {
            // Single touch pan
            const dx = e.touches[0].clientX - lastTouchX;
            const dy = e.touches[0].clientY - lastTouchY;

            // Track if user moved significantly (for tap detection)
            if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
                touchMoved = true;
            }

            state.batch({
                'view.offsetX': currentState.view.offsetX + dx,
                'view.offsetY': currentState.view.offsetY + dy
            });

            lastTouchX = e.touches[0].clientX;
            lastTouchY = e.touches[0].clientY;
            e.preventDefault(); // Prevent scroll during pan
        } else if (e.touches.length === 2) {
            // Pinch zoom
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (touchStartDistance > 0) {
                const zoomFactor = distance / touchStartDistance;
                const newScale = Math.max(0.1, Math.min(10, touchStartScale * zoomFactor));

                // Zoom centered on pinch midpoint
                const rect = canvas.getBoundingClientRect();
                const centerX = rect.width / 2;
                const centerY = rect.height / 2;
                const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
                const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
                const pivotX = midX - rect.left - centerX;
                const pivotY = midY - rect.top - centerY;

                const { offsetX, offsetY, scale } = currentState.view;
                const worldX = (pivotX - offsetX) / scale;
                const worldY = (pivotY - offsetY) / scale;

                const newOffsetX = pivotX - worldX * newScale;
                const newOffsetY = pivotY - worldY * newScale;

                state.batch({
                    'view.scale': newScale,
                    'view.offsetX': newOffsetX,
                    'view.offsetY': newOffsetY
                });
            }
        }
        e.preventDefault();
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
        const touchDuration = Date.now() - touchStartTime;

        if (e.touches.length === 0) {
            // Check if this was a tap (short touch, no significant movement)
            if (!touchMoved && touchDuration < 300 && e.changedTouches.length === 1) {
                // Simulate click for plank selection
                const touch = e.changedTouches[0];
                const clickEvent = new MouseEvent('click', {
                    bubbles: true,
                    clientX: touch.clientX,
                    clientY: touch.clientY
                });
                canvas.dispatchEvent(clickEvent);
            }

            isTouchPanning = false;
            touchStartDistance = 0;
        } else if (e.touches.length === 1) {
            // Switched from pinch to single touch
            isTouchPanning = true;
            lastTouchX = e.touches[0].clientX;
            lastTouchY = e.touches[0].clientY;
            touchMoved = false;
        }
    });
}

/**
 * Initialize floor dragging
 */
export function initFloorDrag(canvas, getTransform) {
    let isDragging = false;
    let lastDragX = 0;
    let lastDragY = 0;

    canvas.addEventListener('mousedown', (e) => {
        const currentState = state.get();

        // Only drag if room is complete, not in drawing mode, and not locked
        // Use right-click or Ctrl+left-click for floor dragging
        if (currentState.room.isComplete &&
            currentState.ui.mode === 'idle' &&
            !currentState.ui.isLocked &&
            (e.button === 2 || (e.button === 0 && e.ctrlKey))) {

            isDragging = true;
            lastDragX = e.clientX;
            lastDragY = e.clientY;
            canvas.classList.add('dragging');
            canvas.style.cursor = 'move';
            e.preventDefault();
        }
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;

        const transform = getTransform();
        const dx = e.clientX - lastDragX;
        const dy = e.clientY - lastDragY;

        // Convert pixel delta to world delta
        const worldDx = transform.screenToWorldDistance(dx);
        const worldDy = transform.screenToWorldDistance(dy);

        const currentState = state.get();
        state.batch({
            'floor.offsetX': currentState.floor.offsetX + worldDx,
            'floor.offsetY': currentState.floor.offsetY + worldDy
        });

        lastDragX = e.clientX;
        lastDragY = e.clientY;
    });

    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            canvas.classList.remove('dragging');
            canvas.style.cursor = 'default';
        }
    });
}
