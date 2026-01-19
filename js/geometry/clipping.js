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
 * Returns both bounding box dimensions and minimum visible width
 */
export function getClippedDimensions(plankCenter, plankLength, plankWidth, rotation, roomPoly) {
    if (!plankCenter || !roomPoly || roomPoly.length < 3) {
        return { length: plankLength, width: plankWidth, minVisibleWidth: plankWidth };
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
        return { length: 0, width: 0, minVisibleWidth: 0 };
    }

    // Project points onto plank's local axes to get bounding box dimensions
    let minLengthPos = Infinity, maxLengthPos = -Infinity;
    let minWidthPos = Infinity, maxWidthPos = -Infinity;

    for (const p of visiblePoints) {
        const dx = p.x - plankCenter.x;
        const dy = p.y - plankCenter.y;
        const localX = dx * cos + dy * sin;
        const localY = -dx * sin + dy * cos;

        minLengthPos = Math.min(minLengthPos, localX);
        maxLengthPos = Math.max(maxLengthPos, localX);
        minWidthPos = Math.min(minWidthPos, localY);
        maxWidthPos = Math.max(maxWidthPos, localY);
    }

    const clippedLength = Math.min(maxLengthPos - minLengthPos, plankLength);
    const clippedWidth = Math.min(maxWidthPos - minWidthPos, plankWidth);

    // Calculate minimum visible width from width edges
    // This catches tapered cuts where one end is thin
    const widthEdgeMin = calculateMinVisibleWidth(
        plankCenter, plankLength, plankWidth, rotation, roomPoly, cos, sin
    );

    // Use the minimum of: width edge analysis and clipped bounding box
    // - widthEdgeMin catches thin slices at the ends
    // - clippedWidth catches thin strips from side cuts
    const minVisibleWidth = Math.min(widthEdgeMin, clippedWidth);

    return {
        length: clippedLength,
        width: clippedWidth,
        minVisibleWidth
    };
}

/**
 * Calculate minimum visible width by finding the visible length of width edges.
 * Uses the same approach as main.js getVisibleSegments to find visible portions.
 */
function calculateMinVisibleWidth(plankCenter, plankLength, plankWidth, rotation, roomPoly, cos, sin) {
    const hw = plankLength / 2;
    const hh = plankWidth / 2;

    // Get plank corners
    const corners = [
        { x: plankCenter.x + (-hw) * cos - (-hh) * sin, y: plankCenter.y + (-hw) * sin + (-hh) * cos },
        { x: plankCenter.x + (hw) * cos - (-hh) * sin, y: plankCenter.y + (hw) * sin + (-hh) * cos },
        { x: plankCenter.x + (hw) * cos - (hh) * sin, y: plankCenter.y + (hw) * sin + (hh) * cos },
        { x: plankCenter.x + (-hw) * cos - (hh) * sin, y: plankCenter.y + (-hw) * sin + (hh) * cos }
    ];

    // Width edges: 1 (corners[1] to corners[2]) and 3 (corners[3] to corners[0])
    const widthEdges = [
        { p1: corners[1], p2: corners[2] },
        { p1: corners[3], p2: corners[0] }
    ];

    let minWidth = plankWidth;

    // For each width edge, calculate total visible length using getVisibleSegments approach
    for (const edge of widthEdges) {
        const visibleLength = getVisibleEdgeLengthDirect(edge.p1, edge.p2, roomPoly);
        if (visibleLength > 0.1 && visibleLength < plankWidth - 0.1) {
            // This width edge is partially visible - indicates a thin slice
            minWidth = Math.min(minWidth, visibleLength);
        }
    }

    // Check for diagonal cuts creating thin slices using ray-casting
    // Sample width at various X positions along the plank
    // This works for any room shape (convex or non-convex)
    const numSamples = 30;

    for (let s = 0; s <= numSamples; s++) {
        // Sample position in local X (along plank length)
        const localX = -hw + (2 * hw) * s / numSamples;

        // Convert to world coordinates for the sample line
        // We'll cast a ray perpendicular to the plank length at this X position
        // The ray goes from localY = -hh to localY = +hh

        // Find all intersections of this vertical line (in local coords) with room edges
        // Transform: world = center + localX * (cos, sin) + localY * (-sin, cos)
        // So points on the line at localX have: worldX = cx + localX*cos - localY*sin
        //                                       worldY = cy + localX*sin + localY*cos

        // For each room edge, find intersection with this parametric line
        const lineBaseX = plankCenter.x + localX * cos;
        const lineBaseY = plankCenter.y + localX * sin;
        const lineDirX = -sin; // Direction along localY
        const lineDirY = cos;

        // Collect all intersections of the sample line with room edges
        const intersections = [];

        for (let i = 0; i < roomPoly.length; i++) {
            const r1 = roomPoly[i];
            const r2 = roomPoly[(i + 1) % roomPoly.length];

            // Line-segment intersection
            // Sample line: P = lineBase + t * lineDir, t in [-hh, +hh] for within plank
            // Room edge: Q = r1 + u * (r2 - r1), u in [0, 1]
            const edgeDx = r2.x - r1.x;
            const edgeDy = r2.y - r1.y;

            const denom = lineDirX * edgeDy - lineDirY * edgeDx;
            if (Math.abs(denom) < 1e-10) continue; // Parallel

            const dx = r1.x - lineBaseX;
            const dy = r1.y - lineBaseY;

            const t = (dx * edgeDy - dy * edgeDx) / denom; // Parameter on sample line
            const u = (dx * lineDirY - dy * lineDirX) / denom; // Parameter on room edge

            if (u >= 0 && u <= 1) {
                // Valid intersection with room edge
                // t is the localY coordinate of the intersection
                intersections.push(t);
            }
        }

        // Sort intersections
        intersections.sort((a, b) => a - b);

        // Find visible segments within plank bounds [-hh, +hh]
        // A point is visible if it's inside the room (odd winding) AND inside plank
        const testPoints = [-hh, ...intersections.filter(t => t > -hh && t < hh), hh];

        for (let i = 0; i < testPoints.length - 1; i++) {
            const midT = (testPoints[i] + testPoints[i + 1]) / 2;

            // Check if midpoint is inside plank
            if (midT < -hh || midT > hh) continue;

            // Check if midpoint is inside room
            const worldX = lineBaseX + midT * lineDirX;
            const worldY = lineBaseY + midT * lineDirY;

            if (pointInPolygonWinding({ x: worldX, y: worldY }, roomPoly)) {
                // This segment is visible
                const segStart = Math.max(testPoints[i], -hh);
                const segEnd = Math.min(testPoints[i + 1], hh);
                const segWidth = segEnd - segStart;

                if (segWidth > 0.1 && segWidth < plankWidth - 0.1) {
                    minWidth = Math.min(minWidth, segWidth);
                }
            }
        }
    }

    return minWidth;
}

/**
 * Calculate perpendicular distance from a point to a line defined by two points
 */
function pointToLineDistance(point, lineP1, lineP2) {
    const dx = lineP2.x - lineP1.x;
    const dy = lineP2.y - lineP1.y;
    const lineLen = Math.sqrt(dx * dx + dy * dy);

    if (lineLen < 0.01) return 0;

    // Cross product gives area of parallelogram, divide by base for height
    const cross = Math.abs(dx * (lineP1.y - point.y) - dy * (lineP1.x - point.x));
    return cross / lineLen;
}

/**
 * Get visible length of a plank edge inside the room.
 * Replicates the approach from main.js getVisibleSegments.
 */
function getVisibleEdgeLengthDirect(p1, p2, roomPoly) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const edgeLength = Math.sqrt(dx * dx + dy * dy);

    if (edgeLength < 0.01) return 0;

    // Find all intersections with room edges
    const intersections = [];
    for (let j = 0; j < roomPoly.length; j++) {
        const r1 = roomPoly[j];
        const r2 = roomPoly[(j + 1) % roomPoly.length];
        const inter = getSegmentIntersection(r1, r2, p1, p2);
        if (inter) {
            // Calculate t-value along the edge
            const t = edgeLength > 0.001 ? ((inter.x - p1.x) * dx + (inter.y - p1.y) * dy) / (edgeLength * edgeLength) : 0;
            if (t > 0.001 && t < 0.999) {
                intersections.push({ x: inter.x, y: inter.y, t });
            }
        }
    }

    // Sort by t
    intersections.sort((a, b) => a.t - b.t);

    // Build points array including endpoints
    const points = [
        { x: p1.x, y: p1.y, t: 0 },
        ...intersections,
        { x: p2.x, y: p2.y, t: 1 }
    ];

    // Calculate total visible length
    let totalVisible = 0;
    for (let i = 0; i < points.length - 1; i++) {
        const midT = (points[i].t + points[i + 1].t) / 2;
        const midX = p1.x + midT * dx;
        const midY = p1.y + midT * dy;

        if (pointInPolygonWinding({ x: midX, y: midY }, roomPoly)) {
            const segLength = (points[i + 1].t - points[i].t) * edgeLength;
            totalVisible += segLength;
        }
    }

    return totalVisible;
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
