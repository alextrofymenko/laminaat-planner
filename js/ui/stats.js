/**
 * Statistics display and updates
 */

import { polygonArea } from '../geometry/polygon.js';
import { round, formatArea } from '../utils.js';

/**
 * Update statistics display
 * @param {Object} stats - Statistics object
 * @param {number} roomArea - Room area in cm²
 */
export function updateStatsDisplay(stats, roomArea) {
    const areaEl = document.getElementById('stat-area');
    const fullPlanksEl = document.getElementById('stat-full-planks');
    const cutPiecesEl = document.getElementById('stat-cut-pieces');
    const tooSmallEl = document.getElementById('stat-too-small');
    const wasteEl = document.getElementById('stat-waste');
    const warningRow = document.getElementById('stat-warning-row');

    if (areaEl) {
        areaEl.textContent = roomArea > 0 ? formatArea(roomArea) : '— m²';
    }

    if (fullPlanksEl) {
        fullPlanksEl.textContent = stats.fullPlanks > 0 ? stats.fullPlanks : '—';
    }

    if (cutPiecesEl) {
        cutPiecesEl.textContent = stats.cutPieces.length > 0 ? stats.cutPieces.length : '—';
    }

    if (tooSmallEl) {
        tooSmallEl.textContent = stats.tooSmall;
    }

    if (warningRow) {
        warningRow.style.display = stats.tooSmall > 0 ? 'flex' : 'none';
    }

    if (wasteEl) {
        if (stats.waste > 0) {
            wasteEl.textContent = `${round(stats.waste, 0)} cm²`;
        } else {
            wasteEl.textContent = '— cm²';
        }
    }
}

/**
 * Update overlay visibility
 */
export function updateOverlay(hasRoom) {
    const overlay = document.getElementById('canvas-overlay');
    if (overlay) {
        overlay.classList.toggle('hidden', hasRoom);
    }
}
