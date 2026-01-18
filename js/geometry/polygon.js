/**
 * Polygon geometry utilities
 */

import { distance } from '../utils.js';

// Calculate polygon area using shoelace formula
export function polygonArea(vertices) {
    if (vertices.length < 3) return 0;

    let area = 0;
    const n = vertices.length;

    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        area += vertices[i].x * vertices[j].y;
        area -= vertices[j].x * vertices[i].y;
    }

    return Math.abs(area) / 2;
}

// Get bounding box of polygon
export function polygonBounds(vertices) {
    if (vertices.length === 0) {
        return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
    }

    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    for (const v of vertices) {
        minX = Math.min(minX, v.x);
        minY = Math.min(minY, v.y);
        maxX = Math.max(maxX, v.x);
        maxY = Math.max(maxY, v.y);
    }

    return {
        minX, minY, maxX, maxY,
        width: maxX - minX,
        height: maxY - minY
    };
}

// Get centroid of polygon
export function polygonCentroid(vertices) {
    if (vertices.length === 0) return { x: 0, y: 0 };

    let cx = 0, cy = 0;
    for (const v of vertices) {
        cx += v.x;
        cy += v.y;
    }

    return {
        x: cx / vertices.length,
        y: cy / vertices.length
    };
}

// Check if point is inside polygon (ray casting)
export function pointInPolygon(point, vertices) {
    if (vertices.length < 3) return false;

    let inside = false;
    const n = vertices.length;

    for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = vertices[i].x, yi = vertices[i].y;
        const xj = vertices[j].x, yj = vertices[j].y;

        if (((yi > point.y) !== (yj > point.y)) &&
            (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi)) {
            inside = !inside;
        }
    }

    return inside;
}

// Get wall lengths
export function getWallLengths(vertices) {
    const lengths = [];
    const n = vertices.length;

    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        lengths.push(distance(vertices[i], vertices[j]));
    }

    return lengths;
}

// Get wall midpoints
export function getWallMidpoints(vertices) {
    const midpoints = [];
    const n = vertices.length;

    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        midpoints.push({
            x: (vertices[i].x + vertices[j].x) / 2,
            y: (vertices[i].y + vertices[j].y) / 2
        });
    }

    return midpoints;
}

// Get wall angles (in radians)
export function getWallAngles(vertices) {
    const angles = [];
    const n = vertices.length;

    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const dx = vertices[j].x - vertices[i].x;
        const dy = vertices[j].y - vertices[i].y;
        angles.push(Math.atan2(dy, dx));
    }

    return angles;
}

// Scale polygon from centroid
export function scalePolygon(vertices, scale) {
    const centroid = polygonCentroid(vertices);
    return vertices.map(v => ({
        x: centroid.x + (v.x - centroid.x) * scale,
        y: centroid.y + (v.y - centroid.y) * scale
    }));
}

// Translate polygon
export function translatePolygon(vertices, dx, dy) {
    return vertices.map(v => ({
        x: v.x + dx,
        y: v.y + dy
    }));
}

// Rotate polygon around a point
export function rotatePolygon(vertices, angle, center) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    return vertices.map(v => {
        const dx = v.x - center.x;
        const dy = v.y - center.y;
        return {
            x: center.x + dx * cos - dy * sin,
            y: center.y + dx * sin + dy * cos
        };
    });
}

// Check if polygon is clockwise
export function isClockwise(vertices) {
    let sum = 0;
    const n = vertices.length;

    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        sum += (vertices[j].x - vertices[i].x) * (vertices[j].y + vertices[i].y);
    }

    return sum > 0;
}

// Ensure polygon is counter-clockwise (for consistent clipping)
export function ensureCCW(vertices) {
    if (isClockwise(vertices)) {
        return [...vertices].reverse();
    }
    return vertices;
}

// Check if two line segments intersect
export function segmentsIntersect(p1, p2, p3, p4) {
    const d1 = direction(p3, p4, p1);
    const d2 = direction(p3, p4, p2);
    const d3 = direction(p1, p2, p3);
    const d4 = direction(p1, p2, p4);

    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
        ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
        return true;
    }

    // Check collinear cases
    if (d1 === 0 && onSegment(p3, p4, p1)) return true;
    if (d2 === 0 && onSegment(p3, p4, p2)) return true;
    if (d3 === 0 && onSegment(p1, p2, p3)) return true;
    if (d4 === 0 && onSegment(p1, p2, p4)) return true;

    return false;
}

function direction(p1, p2, p3) {
    return (p3.x - p1.x) * (p2.y - p1.y) - (p2.x - p1.x) * (p3.y - p1.y);
}

function onSegment(p1, p2, p) {
    return Math.min(p1.x, p2.x) <= p.x && p.x <= Math.max(p1.x, p2.x) &&
           Math.min(p1.y, p2.y) <= p.y && p.y <= Math.max(p1.y, p2.y);
}

// Check if any wall of a polygon intersects a rectangle defined by corners
export function polygonIntersectsRect(polygon, rectCorners) {
    const n = polygon.length;

    // Check if any polygon edge intersects any rectangle edge
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const wallStart = polygon[i];
        const wallEnd = polygon[j];

        for (let k = 0; k < 4; k++) {
            const rectStart = rectCorners[k];
            const rectEnd = rectCorners[(k + 1) % 4];

            if (segmentsIntersect(wallStart, wallEnd, rectStart, rectEnd)) {
                return true;
            }
        }
    }

    return false;
}

// Get distance from point to line segment
export function pointToSegmentDistance(point, segStart, segEnd) {
    const dx = segEnd.x - segStart.x;
    const dy = segEnd.y - segStart.y;
    const lengthSq = dx * dx + dy * dy;

    if (lengthSq === 0) {
        return Math.hypot(point.x - segStart.x, point.y - segStart.y);
    }

    let t = ((point.x - segStart.x) * dx + (point.y - segStart.y) * dy) / lengthSq;
    t = Math.max(0, Math.min(1, t));

    const projX = segStart.x + t * dx;
    const projY = segStart.y + t * dy;

    return Math.hypot(point.x - projX, point.y - projY);
}
