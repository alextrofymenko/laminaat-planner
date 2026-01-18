/**
 * Shared utility functions
 */

// Clamp value between min and max
export function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

// Linear interpolation
export function lerp(a, b, t) {
    return a + (b - a) * t;
}

// Distance between two points
export function distance(p1, p2) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    return Math.sqrt(dx * dx + dy * dy);
}

// Angle between two points (radians)
export function angle(p1, p2) {
    return Math.atan2(p2.y - p1.y, p2.x - p1.x);
}

// Degrees to radians
export function toRadians(degrees) {
    return degrees * Math.PI / 180;
}

// Radians to degrees
export function toDegrees(radians) {
    return radians * 180 / Math.PI;
}

// Round to specified decimal places
export function round(value, decimals = 2) {
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
}

// Format area as m² string
export function formatArea(areaCm2) {
    const areaM2 = areaCm2 / 10000;
    return `${round(areaM2, 2)} m²`;
}

// Format length as cm or m string
export function formatLength(cm) {
    if (cm >= 100) {
        return `${round(cm / 100, 2)} m`;
    }
    return `${round(cm, 1)} cm`;
}

// Debounce function calls
export function debounce(fn, delay) {
    let timeoutId;
    return function (...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn.apply(this, args), delay);
    };
}

// Throttle function calls
export function throttle(fn, limit) {
    let inThrottle;
    return function (...args) {
        if (!inThrottle) {
            fn.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// Generate unique ID
export function uid() {
    return Math.random().toString(36).substr(2, 9);
}

// Generate wall label: A, B, ... Z, AA, AB, ... AZ, BA, ...
export function wallLabel(index) {
    let label = '';
    let i = index;
    do {
        label = String.fromCharCode(65 + (i % 26)) + label;
        i = Math.floor(i / 26) - 1;
    } while (i >= 0);
    return label;
}
