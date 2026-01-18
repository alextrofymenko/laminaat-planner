/**
 * Sutherland-Hodgman polygon clipping algorithm
 * Clips a subject polygon against a convex clip polygon
 */

// Compute intersection point of two line segments
function lineIntersection(p1, p2, p3, p4) {
    const x1 = p1.x, y1 = p1.y;
    const x2 = p2.x, y2 = p2.y;
    const x3 = p3.x, y3 = p3.y;
    const x4 = p4.x, y4 = p4.y;

    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(denom) < 1e-10) return null;

    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;

    return {
        x: x1 + t * (x2 - x1),
        y: y1 + t * (y2 - y1)
    };
}

// Check if point is on the left side of edge (inside for CCW polygon)
function isInside(point, edgeStart, edgeEnd) {
    return (edgeEnd.x - edgeStart.x) * (point.y - edgeStart.y) -
           (edgeEnd.y - edgeStart.y) * (point.x - edgeStart.x) >= 0;
}

// Clip polygon against a single edge
function clipAgainstEdge(polygon, edgeStart, edgeEnd) {
    if (polygon.length === 0) return [];

    const output = [];
    const n = polygon.length;

    for (let i = 0; i < n; i++) {
        const current = polygon[i];
        const next = polygon[(i + 1) % n];

        const currentInside = isInside(current, edgeStart, edgeEnd);
        const nextInside = isInside(next, edgeStart, edgeEnd);

        if (currentInside) {
            output.push(current);
            if (!nextInside) {
                const intersection = lineIntersection(current, next, edgeStart, edgeEnd);
                if (intersection) output.push(intersection);
            }
        } else if (nextInside) {
            const intersection = lineIntersection(current, next, edgeStart, edgeEnd);
            if (intersection) output.push(intersection);
        }
    }

    return output;
}

/**
 * Clip subject polygon against clip polygon using Sutherland-Hodgman
 * Both polygons should be in counter-clockwise order
 * @param {Array} subject - Subject polygon vertices [{x, y}, ...]
 * @param {Array} clip - Clip polygon vertices [{x, y}, ...]
 * @returns {Array} Clipped polygon vertices
 */
export function clipPolygon(subject, clip) {
    if (subject.length < 3 || clip.length < 3) return [];

    let output = [...subject];
    const n = clip.length;

    for (let i = 0; i < n; i++) {
        if (output.length === 0) break;

        const edgeStart = clip[i];
        const edgeEnd = clip[(i + 1) % n];

        output = clipAgainstEdge(output, edgeStart, edgeEnd);
    }

    return output;
}

/**
 * Clip a rectangle (plank) against a polygon (room)
 * Rectangle defined by center, width, height, and rotation
 * @param {Object} rect - {cx, cy, width, height, rotation}
 * @param {Array} clipPolygon - Room polygon vertices
 * @returns {Array} Clipped polygon vertices
 */
export function clipRectangle(rect, clipPoly) {
    const { cx, cy, width, height, rotation } = rect;

    // Create rectangle vertices (centered at origin, then rotated and translated)
    const hw = width / 2;
    const hh = height / 2;

    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);

    // Rectangle corners before rotation (relative to center)
    const corners = [
        { x: -hw, y: -hh },
        { x: hw, y: -hh },
        { x: hw, y: hh },
        { x: -hw, y: hh }
    ];

    // Rotate and translate to final position
    const rectPoly = corners.map(c => ({
        x: cx + c.x * cos - c.y * sin,
        y: cy + c.x * sin + c.y * cos
    }));

    return clipPolygon(rectPoly, clipPoly);
}

/**
 * Calculate area of clipped polygon
 */
export function clippedArea(vertices) {
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

/**
 * Get dimensions of clipped plank by finding actual wall-plank intersections
 * Works correctly for any room polygon shape
 */
export function getClippedDimensions(plankCenter, plankLength, plankWidth, rotation, roomPoly) {
    if (!plankCenter || !roomPoly || roomPoly.length < 3) {
        return { length: plankLength, width: plankWidth };
    }

    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const hw = plankLength / 2;
    const hh = plankWidth / 2;

    // Get plank corners in world coordinates
    const corners = [
        { x: plankCenter.x + (-hw) * cos - (-hh) * sin, y: plankCenter.y + (-hw) * sin + (-hh) * cos },
        { x: plankCenter.x + (hw) * cos - (-hh) * sin, y: plankCenter.y + (hw) * sin + (-hh) * cos },
        { x: plankCenter.x + (hw) * cos - (hh) * sin, y: plankCenter.y + (hw) * sin + (hh) * cos },
        { x: plankCenter.x + (-hw) * cos - (hh) * sin, y: plankCenter.y + (-hw) * sin + (hh) * cos }
    ];

    // Plank edges
    const plankEdges = [
        [corners[0], corners[1]],
        [corners[1], corners[2]],
        [corners[2], corners[3]],
        [corners[3], corners[0]]
    ];

    // Collect visible polygon points:
    // 1. Plank corners inside the room
    // 2. Intersection points of room walls with plank edges
    const visiblePoints = [];

    for (const corner of corners) {
        if (pointInPolygonWinding(corner, roomPoly)) {
            visiblePoints.push(corner);
        }
    }

    const n = roomPoly.length;
    for (let i = 0; i < n; i++) {
        const wallStart = roomPoly[i];
        const wallEnd = roomPoly[(i + 1) % n];

        for (const [edgeStart, edgeEnd] of plankEdges) {
            const intersection = getSegmentIntersection(wallStart, wallEnd, edgeStart, edgeEnd);
            if (intersection) {
                visiblePoints.push(intersection);
            }
        }
    }

    if (visiblePoints.length < 2) {
        return { length: 0, width: 0 };
    }

    // Project points onto plank's local axes to get dimensions
    let minLength = Infinity, maxLength = -Infinity;
    let minWidth = Infinity, maxWidth = -Infinity;

    for (const p of visiblePoints) {
        const dx = p.x - plankCenter.x;
        const dy = p.y - plankCenter.y;
        const localX = dx * cos + dy * sin;
        const localY = -dx * sin + dy * cos;

        minLength = Math.min(minLength, localX);
        maxLength = Math.max(maxLength, localX);
        minWidth = Math.min(minWidth, localY);
        maxWidth = Math.max(maxWidth, localY);
    }

    return {
        length: Math.min(maxLength - minLength, plankLength),
        width: Math.min(maxWidth - minWidth, plankWidth)
    };
}

// Winding number point-in-polygon (works for any polygon shape)
function pointInPolygonWinding(point, polygon) {
    let winding = 0;
    const n = polygon.length;

    for (let i = 0; i < n; i++) {
        const p1 = polygon[i];
        const p2 = polygon[(i + 1) % n];

        if (p1.y <= point.y) {
            if (p2.y > point.y && crossProduct(p1, p2, point) > 0) {
                winding++;
            }
        } else {
            if (p2.y <= point.y && crossProduct(p1, p2, point) < 0) {
                winding--;
            }
        }
    }

    return winding !== 0;
}

function crossProduct(p0, p1, p2) {
    return (p1.x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (p1.y - p0.y);
}

// Segment intersection
function getSegmentIntersection(p1, p2, p3, p4) {
    const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
    const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
    const cross = d1x * d2y - d1y * d2x;

    if (Math.abs(cross) < 1e-10) return null;

    const dx = p3.x - p1.x, dy = p3.y - p1.y;
    const t1 = (dx * d2y - dy * d2x) / cross;
    const t2 = (dx * d1y - dy * d1x) / cross;

    if (t1 >= 0 && t1 <= 1 && t2 >= 0 && t2 <= 1) {
        return { x: p1.x + t1 * d1x, y: p1.y + t1 * d1y };
    }
    return null;
}
