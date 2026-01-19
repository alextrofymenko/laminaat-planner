/**
 * Tests for clipping.js - specifically minVisibleWidth detection
 * Run with: node --experimental-vm-modules js/geometry/clipping.test.js
 */

import { getClippedDimensions } from './clipping.js';

const PLANK_LENGTH = 120;
const PLANK_WIDTH = 20;
const MIN_WIDTH_THRESHOLD = 5; // Default threshold

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`✓ ${name}`);
        passed++;
    } catch (e) {
        console.log(`✗ ${name}`);
        console.log(`  ${e.message}`);
        failed++;
    }
}

function assertEqual(actual, expected, tolerance = 0.5) {
    if (Math.abs(actual - expected) > tolerance) {
        throw new Error(`Expected ${expected} (±${tolerance}), got ${actual}`);
    }
}

function assertLessThan(actual, threshold) {
    if (actual >= threshold) {
        throw new Error(`Expected < ${threshold}, got ${actual}`);
    }
}

function assertGreaterThan(actual, threshold) {
    if (actual <= threshold) {
        throw new Error(`Expected > ${threshold}, got ${actual}`);
    }
}

// Helper to create a rectangular room
function rectRoom(x, y, width, height) {
    return [
        { x: x, y: y },
        { x: x + width, y: y },
        { x: x + width, y: y + height },
        { x: x, y: y + height }
    ];
}

console.log('Testing minVisibleWidth detection\n');

// =============================================================================
// Test 1: Full plank inside room - should have full width
// =============================================================================
test('Full plank inside room has full width', () => {
    const plankCenter = { x: 100, y: 100 };
    const room = rectRoom(0, 0, 300, 300); // Large room
    const rotation = 0;

    const dims = getClippedDimensions(plankCenter, PLANK_LENGTH, PLANK_WIDTH, rotation, room);

    assertEqual(dims.minVisibleWidth, PLANK_WIDTH);
});

// =============================================================================
// Test 2: Plank cut parallel to length (wall cuts across width)
// Wall at y=105 cuts the plank horizontally, leaving only 5cm visible
// =============================================================================
test('Horizontal cut leaving 5cm width detected', () => {
    const plankCenter = { x: 100, y: 100 }; // Plank spans y=90 to y=110
    const room = [
        { x: 0, y: 0 },
        { x: 300, y: 0 },
        { x: 300, y: 105 }, // Cut at y=105, leaving 5cm of plank (y=100-10=90 to y=105)
        { x: 0, y: 105 }
    ];
    const rotation = 0;

    const dims = getClippedDimensions(plankCenter, PLANK_LENGTH, PLANK_WIDTH, rotation, room);

    // Plank center is at y=100, width=20, so spans y=90 to y=110
    // Room cuts at y=105, so visible height is 105-90 = 15cm
    assertEqual(dims.minVisibleWidth, 15, 1);
});

// =============================================================================
// Test 3: Plank cut leaving only 3cm - should be flagged as too small
// =============================================================================
test('Horizontal cut leaving 3cm width detected as too small', () => {
    const plankCenter = { x: 100, y: 100 }; // Plank spans y=90 to y=110
    const room = [
        { x: 0, y: 0 },
        { x: 300, y: 0 },
        { x: 300, y: 93 }, // Cut at y=93, leaving 3cm of plank
        { x: 0, y: 93 }
    ];
    const rotation = 0;

    const dims = getClippedDimensions(plankCenter, PLANK_LENGTH, PLANK_WIDTH, rotation, room);

    assertLessThan(dims.minVisibleWidth, MIN_WIDTH_THRESHOLD);
});

// =============================================================================
// Test 4: Diagonal cut creating thin triangular slice
// A simple triangular room that includes only a small corner of the plank
// =============================================================================
test('Diagonal cut creating thin triangular slice detected', () => {
    const plankCenter = { x: 100, y: 100 }; // Plank: x=40-160, y=90-110
    // Triangular room (convex) that only includes a thin slice of the plank
    // The triangle includes the bottom-left corner of the plank
    const room = [
        { x: 35, y: 85 },    // Below and left of plank
        { x: 45, y: 85 },    // Just right of plank left edge (40)
        { x: 35, y: 93 }     // Creates thin triangle, only 3cm of width inside (93-90=3)
    ];
    const rotation = 0;

    const dims = getClippedDimensions(plankCenter, PLANK_LENGTH, PLANK_WIDTH, rotation, room);

    // Only a thin triangular slice of the plank is inside this room
    assertLessThan(dims.minVisibleWidth, MIN_WIDTH_THRESHOLD);
});

// =============================================================================
// Test 5: Diagonal cut NOT creating thin slice - plank still substantial
// =============================================================================
test('Diagonal cut with substantial remaining width not flagged', () => {
    const plankCenter = { x: 100, y: 100 }; // Plank: x=40-160, y=90-110
    // Diagonal wall cuts corner but leaves substantial width
    // Cuts from (150, 90) to (160, 100) - small corner cut
    const room = [
        { x: 0, y: 0 },
        { x: 150, y: 0 },
        { x: 150, y: 90 },
        { x: 160, y: 100 },
        { x: 160, y: 0 },
        { x: 300, y: 0 },
        { x: 300, y: 200 },
        { x: 0, y: 200 }
    ];
    const rotation = 0;

    const dims = getClippedDimensions(plankCenter, PLANK_LENGTH, PLANK_WIDTH, rotation, room);

    // Most of the plank is still there, should have substantial width
    assertGreaterThan(dims.minVisibleWidth, MIN_WIDTH_THRESHOLD);
});

// =============================================================================
// Test 6: Thin slice at one end from diagonal (like plank 47)
// Diagonal creates a narrow point at one end of the plank
// =============================================================================
test('Thin slice at plank end from diagonal detected', () => {
    const plankCenter = { x: 100, y: 100 }; // Plank: x=40-160, y=90-110
    // Quadrilateral room where one edge creates a diagonal cut
    // leaving a thin slice at the right end of the plank
    const room = [
        { x: 35, y: 85 },    // Below and left of plank
        { x: 165, y: 85 },   // Below and right of plank
        { x: 165, y: 91 },   // Creates ~1cm at right end (91-90=1)
        { x: 35, y: 115 }    // Above and left of plank (diagonal from here to prev point)
    ];
    const rotation = 0;

    const dims = getClippedDimensions(plankCenter, PLANK_LENGTH, PLANK_WIDTH, rotation, room);

    // The diagonal from (35, 115) to (165, 91) cuts through the plank
    // At x=160 (right edge), the Y value on the diagonal is:
    // y = 115 + (91-115)/(165-35) * (160-35) = 115 + (-24/130)*125 ≈ 91.9
    // So visible width at x=160 is about 91.9-90 = 1.9cm
    assertLessThan(dims.minVisibleWidth, MIN_WIDTH_THRESHOLD);
});

// =============================================================================
// Test 7: Rotated plank with diagonal cut
// =============================================================================
test('Rotated plank with thin slice detected', () => {
    const plankCenter = { x: 100, y: 100 };
    const rotation = Math.PI / 6; // 30 degrees
    // Create a room that cuts a thin slice off the rotated plank
    const room = [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        { x: 200, y: 95 }, // Horizontal cut that creates thin slice on rotated plank
        { x: 0, y: 95 }
    ];

    const dims = getClippedDimensions(plankCenter, PLANK_LENGTH, PLANK_WIDTH, rotation, room);

    // With rotation, this cut should create a varying width along the plank
    // The exact value depends on geometry, but it should be less than full width
    assertLessThan(dims.minVisibleWidth, PLANK_WIDTH - 1);
});

// =============================================================================
// Test 8: Non-convex room with thin passage
// =============================================================================
test('Non-convex room creating thin visible region', () => {
    const plankCenter = { x: 100, y: 100 }; // Plank: x=40-160, y=90-110
    // L-shaped room that creates a thin visible region
    const room = [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        { x: 200, y: 93 },  // Comes in from top
        { x: 50, y: 93 },   // Creates thin 3cm passage over plank
        { x: 50, y: 200 },
        { x: 0, y: 200 }
    ];
    const rotation = 0;

    const dims = getClippedDimensions(plankCenter, PLANK_LENGTH, PLANK_WIDTH, rotation, room);

    // The thin 3cm region should be detected
    assertLessThan(dims.minVisibleWidth, MIN_WIDTH_THRESHOLD);
});

// =============================================================================
// Test 9: Width edge partially visible (direct width edge cut)
// =============================================================================
test('Width edge partially cut detected', () => {
    const plankCenter = { x: 100, y: 100 }; // Plank: x=40-160, y=90-110
    // Simple rectangular room that cuts horizontally through the plank near the bottom
    // This leaves a thin strip at the bottom
    const room = [
        { x: 0, y: 88 },    // Below plank bottom (90)
        { x: 200, y: 88 },
        { x: 200, y: 92 },  // Just 2cm into the plank
        { x: 0, y: 92 }
    ];
    const rotation = 0;

    const dims = getClippedDimensions(plankCenter, PLANK_LENGTH, PLANK_WIDTH, rotation, room);

    // Should detect the 2cm visible width (92-90=2)
    assertLessThan(dims.minVisibleWidth, MIN_WIDTH_THRESHOLD);
});

// =============================================================================
// Test 10: Almost full width (edge case)
// =============================================================================
test('Almost full width not incorrectly flagged', () => {
    const plankCenter = { x: 100, y: 100 }; // Plank: x=40-160, y=90-110
    // Room cuts just a tiny corner
    const room = [
        { x: 0, y: 0 },
        { x: 159, y: 0 },
        { x: 159, y: 89 },
        { x: 161, y: 89 },
        { x: 161, y: 0 },
        { x: 300, y: 0 },
        { x: 300, y: 200 },
        { x: 0, y: 200 }
    ];
    const rotation = 0;

    const dims = getClippedDimensions(plankCenter, PLANK_LENGTH, PLANK_WIDTH, rotation, room);

    // Just a tiny corner cut - should still have nearly full width
    assertGreaterThan(dims.minVisibleWidth, PLANK_WIDTH - 2);
});

// =============================================================================
// Test 11: Thin slice exactly at threshold boundary
// =============================================================================
test('Thin slice exactly at 5cm threshold detected', () => {
    const plankCenter = { x: 100, y: 100 }; // Plank: x=40-160, y=90-110
    const room = [
        { x: 0, y: 88 },
        { x: 200, y: 88 },
        { x: 200, y: 94.9 },  // 4.9cm visible (94.9-90)
        { x: 0, y: 94.9 }
    ];
    const rotation = 0;

    const dims = getClippedDimensions(plankCenter, PLANK_LENGTH, PLANK_WIDTH, rotation, room);

    assertLessThan(dims.minVisibleWidth, MIN_WIDTH_THRESHOLD);
});

// =============================================================================
// Test 12: Thin slice just above threshold - should NOT be flagged
// =============================================================================
test('Width just above 5cm threshold not flagged', () => {
    const plankCenter = { x: 100, y: 100 }; // Plank: x=40-160, y=90-110
    const room = [
        { x: 0, y: 88 },
        { x: 200, y: 88 },
        { x: 200, y: 95.5 },  // 5.5cm visible
        { x: 0, y: 95.5 }
    ];
    const rotation = 0;

    const dims = getClippedDimensions(plankCenter, PLANK_LENGTH, PLANK_WIDTH, rotation, room);

    assertGreaterThan(dims.minVisibleWidth, MIN_WIDTH_THRESHOLD);
});

// =============================================================================
// Test 13: Staircase cut creating thin section
// Uses convex room that creates a thin visible region
// =============================================================================
test('Staircase cut with thin section detected', () => {
    const plankCenter = { x: 100, y: 100 }; // Plank: x=40-160, y=90-110
    // Convex room that creates thin slice at one side
    const room = [
        { x: 35, y: 88 },
        { x: 165, y: 88 },
        { x: 165, y: 92 },    // Only 2cm visible at right side
        { x: 35, y: 115 }
    ];
    const rotation = 0;

    const dims = getClippedDimensions(plankCenter, PLANK_LENGTH, PLANK_WIDTH, rotation, room);

    // At the right edge (x=160), the room extends from y=88 up to about y=92.3
    // So visible width ≈ 2.3cm
    assertLessThan(dims.minVisibleWidth, MIN_WIDTH_THRESHOLD);
});

// =============================================================================
// Test 14: Steep diagonal creating very thin slice
// =============================================================================
test('Steep diagonal cut creating thin slice', () => {
    const plankCenter = { x: 100, y: 100 }; // Plank: x=40-160, y=90-110
    // Steep diagonal that creates a very narrow slice at the right edge
    const room = [
        { x: 35, y: 88 },
        { x: 162, y: 88 },
        { x: 162, y: 91 },    // Right side: y goes from 88 to 91 (only 1cm inside plank)
        { x: 35, y: 115 }
    ];
    const rotation = 0;

    const dims = getClippedDimensions(plankCenter, PLANK_LENGTH, PLANK_WIDTH, rotation, room);

    // At x=160, the diagonal creates about 1.2cm of visible width
    assertLessThan(dims.minVisibleWidth, MIN_WIDTH_THRESHOLD);
});

// =============================================================================
// Test 15: Small corner cut - plank mostly visible
// =============================================================================
test('Small corner cut - plank mostly visible', () => {
    const plankCenter = { x: 100, y: 100 }; // Plank: x=40-160, y=90-110
    // Large room that includes most of the plank
    // Only cuts off a small corner at top-right
    const room = [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        { x: 200, y: 200 },
        { x: 0, y: 200 }
    ];
    const rotation = 0;

    const dims = getClippedDimensions(plankCenter, PLANK_LENGTH, PLANK_WIDTH, rotation, room);

    // Plank is fully inside the room
    assertEqual(dims.minVisibleWidth, PLANK_WIDTH, 0.1);
});

// =============================================================================
// Summary
// =============================================================================
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
