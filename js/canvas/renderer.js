/**
 * Main canvas renderer
 * Handles all drawing operations
 */

import { createTransform } from '../geometry/transforms.js';
import { polygonBounds, getWallLengths, getWallMidpoints, getWallAngles } from '../geometry/polygon.js';
import { round } from '../utils.js';

// Colors
const COLORS = {
    background: '#1a1a2e',
    grid: '#2d3a4f',
    gridMajor: '#3d4a5f',
    room: {
        fill: 'rgba(74, 158, 255, 0.1)',
        stroke: '#4a9eff',
        vertex: '#4a9eff',
        vertexHover: '#6bb3ff'
    },
    plank: {
        fill: '#d4a574',
        stroke: '#8b6914',
        warning: '#ff6b6b',
        warningStroke: '#cc4444'
    },
    dimension: {
        line: '#888',
        text: '#aaa'
    },
    drawingLine: 'rgba(74, 158, 255, 0.5)'
};

/**
 * Create renderer for canvas
 */
export function createRenderer(canvas) {
    const ctx = canvas.getContext('2d');

    function clear() {
        ctx.fillStyle = COLORS.background;
        // Use CSS dimensions (ctx.scale handles DPR)
        ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    }

    function drawGrid(transform, gridSize = 50) {
        const bounds = transform.getVisibleBounds();
        const screenGridSize = transform.worldToScreenDistance(gridSize);

        // Only draw grid if not too zoomed out
        if (screenGridSize < 10) return;

        ctx.strokeStyle = COLORS.grid;
        ctx.lineWidth = 0.5;

        // Use CSS dimensions (ctx.scale handles DPR)
        const canvasWidth = canvas.clientWidth;
        const canvasHeight = canvas.clientHeight;

        // Vertical lines
        const startX = Math.floor(bounds.minX / gridSize) * gridSize;
        for (let x = startX; x <= bounds.maxX; x += gridSize) {
            const screen = transform.worldToScreen(x, 0);
            ctx.beginPath();
            ctx.moveTo(screen.x, 0);
            ctx.lineTo(screen.x, canvasHeight);
            ctx.stroke();
        }

        // Horizontal lines
        const startY = Math.floor(bounds.minY / gridSize) * gridSize;
        for (let y = startY; y <= bounds.maxY; y += gridSize) {
            const screen = transform.worldToScreen(0, y);
            ctx.beginPath();
            ctx.moveTo(0, screen.y);
            ctx.lineTo(canvasWidth, screen.y);
            ctx.stroke();
        }

        // Draw major grid lines (every 100cm = 1m)
        ctx.strokeStyle = COLORS.gridMajor;
        ctx.lineWidth = 1;

        const majorSize = 100;
        const startMajorX = Math.floor(bounds.minX / majorSize) * majorSize;
        for (let x = startMajorX; x <= bounds.maxX; x += majorSize) {
            const screen = transform.worldToScreen(x, 0);
            ctx.beginPath();
            ctx.moveTo(screen.x, 0);
            ctx.lineTo(screen.x, canvasHeight);
            ctx.stroke();
        }

        const startMajorY = Math.floor(bounds.minY / majorSize) * majorSize;
        for (let y = startMajorY; y <= bounds.maxY; y += majorSize) {
            const screen = transform.worldToScreen(0, y);
            ctx.beginPath();
            ctx.moveTo(0, screen.y);
            ctx.lineTo(canvasWidth, screen.y);
            ctx.stroke();
        }
    }

    function drawRoom(vertices, transform, isComplete, hoveredVertex = null, selectedWall = null) {
        if (vertices.length === 0) return;

        const screenVertices = vertices.map(v => transform.worldToScreen(v.x, v.y));

        // Draw fill (only if complete)
        if (isComplete && screenVertices.length >= 3) {
            ctx.fillStyle = COLORS.room.fill;
            ctx.beginPath();
            ctx.moveTo(screenVertices[0].x, screenVertices[0].y);
            for (let i = 1; i < screenVertices.length; i++) {
                ctx.lineTo(screenVertices[i].x, screenVertices[i].y);
            }
            ctx.closePath();
            ctx.fill();
        }

        // Draw edges
        const n = screenVertices.length;
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            if (!isComplete && i === n - 1) break; // Don't close if not complete

            const isSelected = selectedWall === i;
            ctx.strokeStyle = isSelected ? '#ffcc00' : COLORS.room.stroke;
            ctx.lineWidth = isSelected ? 4 : 2;
            ctx.beginPath();
            ctx.moveTo(screenVertices[i].x, screenVertices[i].y);
            ctx.lineTo(screenVertices[j].x, screenVertices[j].y);
            ctx.stroke();
        }

        // Draw vertices
        for (let i = 0; i < screenVertices.length; i++) {
            const v = screenVertices[i];
            const isHovered = hoveredVertex === i;
            const radius = isHovered ? 8 : 6;

            ctx.fillStyle = isHovered ? COLORS.room.vertexHover : COLORS.room.vertex;
            ctx.beginPath();
            ctx.arc(v.x, v.y, radius, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    function drawDimensions(vertices, transform) {
        if (vertices.length < 2) return;

        const lengths = getWallLengths(vertices);
        const midpoints = getWallMidpoints(vertices);
        const angles = getWallAngles(vertices);

        ctx.font = '12px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        for (let i = 0; i < midpoints.length; i++) {
            const mid = transform.worldToScreen(midpoints[i].x, midpoints[i].y);
            const length = round(lengths[i], 1);
            const angle = angles[i];
            const wallLabel = String.fromCharCode(65 + i); // A, B, C, ...

            // Offset text perpendicular to wall
            const offsetDist = 20;
            const offsetX = Math.sin(angle) * offsetDist;
            const offsetY = -Math.cos(angle) * offsetDist;

            // Text with label and dimension
            const text = `${wallLabel}: ${length} cm`;
            const textWidth = ctx.measureText(text).width;

            // Background for text
            ctx.fillStyle = 'rgba(26, 26, 46, 0.8)';
            ctx.fillRect(
                mid.x + offsetX - textWidth / 2 - 4,
                mid.y + offsetY - 8,
                textWidth + 8,
                16
            );

            ctx.fillStyle = COLORS.dimension.text;
            ctx.fillText(text, mid.x + offsetX, mid.y + offsetY);
        }
    }

    function drawPlanks(planks, transform, minLength, minWidth, roomVertices) {
        if (!roomVertices || roomVertices.length < 3) return;

        // Create clipping path from room polygon
        const roomScreen = roomVertices.map(v => transform.worldToScreen(v.x, v.y));

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(roomScreen[0].x, roomScreen[0].y);
        for (let i = 1; i < roomScreen.length; i++) {
            ctx.lineTo(roomScreen[i].x, roomScreen[i].y);
        }
        ctx.closePath();
        ctx.clip();

        // Draw planks (will be clipped to room shape)
        for (const plank of planks) {
            // Only edge planks can be "too small" - full interior planks are never flagged
            const isTooSmall = plank.isEdgePlank &&
                (plank.clippedLength < minLength || plank.clippedWidth < minWidth);

            // Draw full plank rectangle using corners
            const screenCorners = plank.corners.map(v => transform.worldToScreen(v.x, v.y));

            ctx.fillStyle = isTooSmall ? COLORS.plank.warning : COLORS.plank.fill;
            ctx.strokeStyle = isTooSmall ? COLORS.plank.warningStroke : COLORS.plank.stroke;
            ctx.lineWidth = 1;

            ctx.beginPath();
            ctx.moveTo(screenCorners[0].x, screenCorners[0].y);
            for (let i = 1; i < screenCorners.length; i++) {
                ctx.lineTo(screenCorners[i].x, screenCorners[i].y);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        }

        ctx.restore();
    }

    function drawPlankDimensions(planks, transform, showNumbers = true, showDimensions = false) {
        if (!showNumbers && !showDimensions) return;

        ctx.font = '10px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#333';

        for (const plank of planks) {
            const center = transform.worldToScreen(plank.cx, plank.cy);

            if (showNumbers) {
                ctx.fillText(`${plank.id + 1}`, center.x, center.y);
            }

            if (showDimensions && !plank.isFull) {
                const dimText = `${round(plank.clippedLength, 0)}x${round(plank.clippedWidth, 0)}`;
                ctx.fillText(dimText, center.x, center.y + 12);
            }
        }
    }

    function drawDrawingGuide(vertices, mousePos, transform) {
        if (vertices.length === 0 || !mousePos) return;

        const lastVertex = vertices[vertices.length - 1];
        const lastScreen = transform.worldToScreen(lastVertex.x, lastVertex.y);
        const mouseScreen = transform.worldToScreen(mousePos.x, mousePos.y);

        // Line from last vertex to mouse
        ctx.strokeStyle = COLORS.drawingLine;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(lastScreen.x, lastScreen.y);
        ctx.lineTo(mouseScreen.x, mouseScreen.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // If close to first vertex, show snap indicator
        if (vertices.length >= 3) {
            const firstVertex = vertices[0];
            const firstScreen = transform.worldToScreen(firstVertex.x, firstVertex.y);
            const dist = Math.hypot(mouseScreen.x - firstScreen.x, mouseScreen.y - firstScreen.y);

            if (dist < 20) {
                ctx.strokeStyle = COLORS.room.vertexHover;
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.arc(firstScreen.x, firstScreen.y, 12, 0, Math.PI * 2);
                ctx.stroke();
            }
        }
    }

    return {
        clear,
        drawGrid,
        drawRoom,
        drawDimensions,
        drawPlanks,
        drawPlankDimensions,
        drawDrawingGuide,
        getContext: () => ctx,
        createTransform: (view) => createTransform(view, canvas)
    };
}
