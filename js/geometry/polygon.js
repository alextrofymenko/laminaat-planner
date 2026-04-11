/**
 * Polygon geometry utilities
 */

import { distance, toRadians } from '../utils.js';

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

/**
 * Build an open polyline from step-by-step wall lengths and interior angles.
 *
 * Convention: traverser walks CLOCKWISE around the room. Starting at the origin
 * heading along +X (screen-right). After each wall, the traverser measures the
 * INTERIOR angle at the corner on their right (the angle between the wall they
 * just walked and the next wall, measured inside the room). A right-angle corner
 * is 90 degrees; a perfectly straight continuation is 180 degrees.
 *
 * In screen coordinates (Y pointing down), walking clockwise means each corner
 * is a right turn, and the heading increases by (180 - interior) degrees.
 *
 * @param {number[]} lengths - Wall lengths in cm (N entries).
 * @param {number[]} interiorAngles - Interior angles in degrees between consecutive
 *   walls (N-1 entries). interiorAngles[i] is the corner between lengths[i] and lengths[i+1].
 * @returns {{x:number,y:number}[]} Vertices from V_0 (start) through V_N (end of last wall),
 *   so lengths.length + 1 points. Caller is expected to close / reconcile.
 */
export function buildPolylineFromSteps(lengths, interiorAngles) {
    const vertices = [{ x: 0, y: 0 }];
    let headingRad = 0;

    for (let i = 0; i < lengths.length; i++) {
        const L = lengths[i];
        const prev = vertices[vertices.length - 1];
        vertices.push({
            x: prev.x + Math.cos(headingRad) * L,
            y: prev.y + Math.sin(headingRad) * L
        });

        if (i < lengths.length - 1) {
            const interior = interiorAngles[i];
            // Clockwise traversal = right turn. In screen coords (y-down), right turn
            // increases heading by (180 - interior).
            headingRad += toRadians(180 - interior);
        }
    }

    return vertices;
}

/**
 * Residual closure metrics for an open polyline that "should" close.
 *
 * @param {{x:number,y:number}[]} polyline - Output of buildPolylineFromSteps (N+1 points).
 * @returns {{distanceCm:number, closingTurnDeg:number}|null}
 *   distanceCm: gap from last vertex back to first, in cm.
 *   closingTurnDeg: extra turn in degrees needed so the traverser's heading at the
 *     final vertex aligns with the direction back to the start (useful as a sanity check).
 *   Null if the polyline is too short (<3 walls).
 */
export function polylineClosureResidual(polyline) {
    if (polyline.length < 3) return null;

    const first = polyline[0];
    const last = polyline[polyline.length - 1];
    const dx = first.x - last.x;
    const dy = first.y - last.y;
    const distanceCm = Math.hypot(dx, dy);

    return { distanceCm, closingTurnDeg: 0 }; // closingTurnDeg retained for future use
}

/**
 * Reconcile an open polyline into a closed polygon by spreading the closure
 * residual evenly across every vertex (elastic-band closure).
 *
 * Each intermediate vertex V_k (k in [0..N]) is shifted by -(k/N) * r, where
 * r = V_N - V_0 is the residual. This guarantees V_N lands exactly on V_0 and
 * the error is distributed proportionally along the path. Wall lengths and
 * angles only change by a fraction of the original residual, so small
 * measurement errors become imperceptible.
 *
 * @param {{x:number,y:number}[]} polyline - Open polyline (N+1 points).
 * @returns {{x:number,y:number}[]} Closed polygon vertices (N points).
 */
export function closeAndDistribute(polyline) {
    const N = polyline.length - 1;
    if (N < 3) return polyline.slice(0, Math.max(0, N));

    const first = polyline[0];
    const last = polyline[N];
    const rx = last.x - first.x;
    const ry = last.y - first.y;

    const result = [];
    for (let k = 0; k < N; k++) {
        const t = k / N;
        result.push({
            x: polyline[k].x - rx * t,
            y: polyline[k].y - ry * t
        });
    }
    return result;
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
