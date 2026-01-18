/**
 * Coordinate transformation utilities
 * Handles conversion between screen pixels and world units (cm)
 */

/**
 * Create a transform context for coordinate conversions
 * @param {Object} view - View state {scale, offsetX, offsetY}
 * @param {HTMLCanvasElement} canvas - Canvas element
 */
export function createTransform(view, canvas) {
    const { scale, offsetX, offsetY } = view;

    // Center of canvas in CSS pixels (not canvas pixels)
    // Use clientWidth/clientHeight for CSS dimensions
    const centerX = canvas.clientWidth / 2;
    const centerY = canvas.clientHeight / 2;

    return {
        // Convert world coordinates (cm) to screen coordinates (pixels)
        worldToScreen(wx, wy) {
            return {
                x: centerX + (wx * scale) + offsetX,
                y: centerY + (wy * scale) + offsetY
            };
        },

        // Convert screen coordinates (pixels) to world coordinates (cm)
        screenToWorld(sx, sy) {
            return {
                x: (sx - centerX - offsetX) / scale,
                y: (sy - centerY - offsetY) / scale
            };
        },

        // Convert a world distance to screen pixels
        worldToScreenDistance(distance) {
            return distance * scale;
        },

        // Convert screen pixels to world distance
        screenToWorldDistance(pixels) {
            return pixels / scale;
        },

        // Get the visible world bounds
        getVisibleBounds() {
            const topLeft = this.screenToWorld(0, 0);
            const bottomRight = this.screenToWorld(canvas.clientWidth, canvas.clientHeight);
            return {
                minX: topLeft.x,
                minY: topLeft.y,
                maxX: bottomRight.x,
                maxY: bottomRight.y,
                width: bottomRight.x - topLeft.x,
                height: bottomRight.y - topLeft.y
            };
        }
    };
}

/**
 * Calculate view parameters to fit bounds in canvas
 * @param {Object} bounds - {minX, minY, maxX, maxY}
 * @param {HTMLCanvasElement} canvas
 * @param {number} padding - Padding in pixels
 */
export function fitBoundsToView(bounds, canvas, padding = 50) {
    const { minX, minY, maxX, maxY } = bounds;
    const width = maxX - minX;
    const height = maxY - minY;

    if (width === 0 || height === 0) {
        return { scale: 2, offsetX: 0, offsetY: 0 };
    }

    // Use CSS pixel dimensions
    const availableWidth = canvas.clientWidth - padding * 2;
    const availableHeight = canvas.clientHeight - padding * 2;

    const scaleX = availableWidth / width;
    const scaleY = availableHeight / height;
    const scale = Math.min(scaleX, scaleY);

    // Center the bounds
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    return {
        scale,
        offsetX: -centerX * scale,
        offsetY: -centerY * scale
    };
}
