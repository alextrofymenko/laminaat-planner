/**
 * Plank grid generation with rotation and offset patterns
 */

import { toRadians } from '../utils.js';
import { polygonBounds, ensureCCW, pointInPolygon, polygonIntersectsRect } from './polygon.js';
import { getClippedDimensions } from './clipping.js';

/**
 * Generate plank grid that covers the room
 * @param {Object} config - Grid configuration
 * @param {Array} config.roomVertices - Room polygon vertices
 * @param {number} config.plankLength - Plank length in cm
 * @param {number} config.plankWidth - Plank width in cm
 * @param {number} config.rotation - Floor rotation in degrees
 * @param {number} config.offsetPattern - Base offset fraction (0.5, 0.333, 0.25, etc)
 * @param {number} config.offsetX - Floor position X offset
 * @param {number} config.offsetY - Floor position Y offset
 * @param {Object} config.rowOffsets - Per-row custom offsets {rowIndex: fraction}
 * @returns {Array} Array of plank objects with clipped geometry
 */
export function generatePlankGrid(config) {
    const {
        roomVertices,
        plankLength,
        plankWidth,
        rotation,
        offsetPattern,
        offsetX = 0,
        offsetY = 0,
        rowOffsets = {}
    } = config;

    if (!roomVertices || roomVertices.length < 3) {
        return [];
    }

    const roomPoly = ensureCCW(roomVertices);
    const bounds = polygonBounds(roomVertices);
    const rotationRad = toRadians(rotation);

    // Calculate grid bounds with extra margin for rotation and offset
    const diagonal = Math.sqrt(
        Math.pow(bounds.width, 2) + Math.pow(bounds.height, 2)
    );
    // Add extra margin for floor offset movement
    const offsetMagnitude = Math.sqrt(offsetX * offsetX + offsetY * offsetY);
    const margin = diagonal * 0.5 + offsetMagnitude;

    // Grid origin (center of room bounds, offset by user adjustment)
    const gridCenterX = (bounds.minX + bounds.maxX) / 2 + offsetX;
    const gridCenterY = (bounds.minY + bounds.maxY) / 2 + offsetY;

    // Calculate how many rows and columns we need
    const gridExtent = diagonal + margin * 2;
    const numRows = Math.ceil(gridExtent / plankWidth) + 4;
    const numCols = Math.ceil(gridExtent / plankLength) + 4;

    const planks = [];
    let plankId = 0;

    const cos = Math.cos(rotationRad);
    const sin = Math.sin(rotationRad);

    // Helper to get plank corners
    function getPlankCorners(cx, cy) {
        const hw = plankLength / 2;
        const hh = plankWidth / 2;
        const corners = [
            { x: -hw, y: -hh },
            { x: hw, y: -hh },
            { x: hw, y: hh },
            { x: -hw, y: hh }
        ];
        return corners.map(c => ({
            x: cx + c.x * cos - c.y * sin,
            y: cy + c.x * sin + c.y * cos
        }));
    }

    // Helper to check if plank intersects room
    function plankIntersectsRoom(cx, cy, corners) {
        // Check if center is inside
        if (pointInPolygon({ x: cx, y: cy }, roomPoly)) return true;
        // Check if any corner is inside
        for (const corner of corners) {
            if (pointInPolygon(corner, roomPoly)) return true;
        }
        // Check if any room vertex is inside plank (for small rooms / large planks)
        for (const rv of roomPoly) {
            // Transform room vertex to plank local coords
            const dx = rv.x - cx;
            const dy = rv.y - cy;
            const localX = dx * cos + dy * sin;
            const localY = -dx * sin + dy * cos;
            if (Math.abs(localX) <= plankLength / 2 && Math.abs(localY) <= plankWidth / 2) {
                return true;
            }
        }
        // Check if any room edge intersects the plank rectangle
        // (catches cases where edge passes through plank without corners/centers inside)
        if (polygonIntersectsRect(roomPoly, corners)) return true;
        return false;
    }

    // Generate grid centered on room
    for (let row = -Math.floor(numRows / 2); row <= Math.floor(numRows / 2); row++) {
        // Calculate cumulative offset: each row shifts by offsetPattern from the previous
        // Use proper modulo to handle negative row indices
        const baseOffset = (row * offsetPattern) % 1;
        const rowOffset = rowOffsets[row] !== undefined
            ? rowOffsets[row]
            : (baseOffset < 0 ? baseOffset + 1 : baseOffset);

        for (let col = -Math.floor(numCols / 2); col <= Math.floor(numCols / 2); col++) {
            const localX = col * plankLength + rowOffset * plankLength + plankLength / 2;
            const localY = row * plankWidth + plankWidth / 2;

            const worldX = gridCenterX + localX * cos - localY * sin;
            const worldY = gridCenterY + localX * sin + localY * cos;

            const corners = getPlankCorners(worldX, worldY);

            if (plankIntersectsRoom(worldX, worldY, corners)) {
                const fullArea = plankLength * plankWidth;

                // Check if any room wall intersects this plank rectangle
                // This is more reliable than corner-based checks for non-convex rooms
                const wallIntersects = polygonIntersectsRect(roomPoly, corners);

                // A plank is full only if no wall intersects it and center is inside
                const centerInside = pointInPolygon({ x: worldX, y: worldY }, roomPoly);
                const isFull = !wallIntersects && centerInside;
                const isEdgePlank = wallIntersects;

                let area = fullArea;
                let clippedLength = plankLength;
                let clippedWidth = plankWidth;

                let minVisibleWidth = plankWidth;

                if (isEdgePlank) {
                    // Calculate clipped dimensions using wall intersections
                    const plankCenter = { x: worldX, y: worldY };
                    const dims = getClippedDimensions(
                        plankCenter,
                        plankLength,
                        plankWidth,
                        rotationRad,
                        roomPoly
                    );
                    clippedLength = dims.length;
                    clippedWidth = dims.width;
                    minVisibleWidth = dims.minVisibleWidth;
                    area = clippedLength * clippedWidth;
                }

                planks.push({
                    id: plankId++,
                    row,
                    col,
                    cx: worldX,
                    cy: worldY,
                    rotation: rotationRad,
                    originalWidth: plankLength,
                    originalHeight: plankWidth,
                    corners,
                    area,
                    fullArea,
                    isFull,
                    isEdgePlank,
                    clippedLength,
                    clippedWidth,
                    minVisibleWidth
                });
            }
        }
    }

    return planks;
}

/**
 * Calculate statistics from generated planks
 */
export function calculateStats(planks, minLength, minWidth) {
    let fullPlanks = 0;
    const cutPieces = [];
    let tooSmall = 0;
    let totalArea = 0;
    let totalFullArea = 0;

    for (const plank of planks) {
        totalArea += plank.area;
        totalFullArea += plank.fullArea;

        if (plank.isFull) {
            fullPlanks++;
        } else if (plank.isEdgePlank) {
            cutPieces.push({
                id: plank.id,
                length: plank.clippedLength,
                width: plank.clippedWidth,
                area: plank.area
            });

            // Check minimum visible width for edge planks only
            if (plank.minVisibleWidth < minWidth) {
                tooSmall++;
            }
        }
    }

    // Waste is the difference between what we use and what we cut
    // This is approximate - real waste would need to consider which planks can be reused
    const waste = cutPieces.reduce((sum, p) => sum + (p.length * p.width) - p.area, 0);

    return {
        fullPlanks,
        cutPieces,
        tooSmall,
        totalArea,
        totalFullArea,
        waste
    };
}

/**
 * Get row at a given world position (for row offset editing)
 */
export function getRowAtPosition(x, y, config) {
    const {
        plankWidth,
        rotation,
        offsetX = 0,
        offsetY = 0,
        roomVertices
    } = config;

    if (!roomVertices || roomVertices.length < 3) return null;

    const bounds = polygonBounds(roomVertices);
    const gridCenterX = (bounds.minX + bounds.maxX) / 2 + offsetX;
    const gridCenterY = (bounds.minY + bounds.maxY) / 2 + offsetY;

    const rotationRad = toRadians(rotation);
    const cos = Math.cos(-rotationRad);
    const sin = Math.sin(-rotationRad);

    // Transform click position to local grid coordinates
    const dx = x - gridCenterX;
    const dy = y - gridCenterY;
    const localY = dx * sin + dy * cos;

    // Calculate row
    const row = Math.round((localY - plankWidth / 2) / plankWidth);

    return row;
}
