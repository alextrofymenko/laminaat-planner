/**
 * Step-by-step room builder.
 *
 * Lets the user enter walls one at a time (length + interior angle) and
 * reconciles small measurement residuals into a closed polygon when done.
 */

import { state } from '../state.js';
import { wallLabel, round } from '../utils.js';
import {
    buildPolylineFromSteps,
    polylineClosureResidual,
    closeAndDistribute,
    polygonBounds
} from '../geometry/polygon.js';
import { fitBoundsToView } from '../geometry/transforms.js';

// Closure tolerance — Done is enabled while residual stays below this.
const MAX_DIST_TOLERANCE_CM = 2;

export function initStepByStep(canvas) {
    // Entry list: { type: 'wall' | 'angle', value: number }
    // Walls and angles strictly alternate starting with a wall.
    let entries = [];
    let active = false;

    const panel = document.getElementById('step-panel');
    const wallsList = document.getElementById('step-walls-list');
    const currentContainer = document.getElementById('step-current');
    const residualEl = document.getElementById('step-residual');
    const doneBtn = document.getElementById('step-done');
    const cancelBtn = document.getElementById('step-cancel');

    function getSegmentsAndTurns() {
        const segments = [];
        const turns = [];
        for (const e of entries) {
            if (e.type === 'wall') segments.push(e.value);
            else turns.push(e.value);
        }
        return { segments, turns };
    }

    /** What the next input should ask for. */
    function nextPhase() {
        // Empty -> need first wall; ends-in-wall -> need angle; ends-in-angle -> need wall
        if (entries.length === 0) return 'wall';
        return entries[entries.length - 1].type === 'wall' ? 'angle' : 'wall';
    }

    function computePreview() {
        const { segments, turns } = getSegmentsAndTurns();
        if (segments.length < 1) return { polyline: [], residual: null };

        const polyline = buildPolylineFromSteps(segments, turns);
        // Residual only makes sense when we have at least 3 walls AND no dangling angle.
        const canClose = segments.length >= 3 && turns.length === segments.length - 1;
        const residual = canClose ? polylineClosureResidual(polyline) : null;
        return { polyline, residual };
    }

    function writePreviewToState(polyline) {
        state.batch({
            'room.vertices': polyline,
            'room.isComplete': false,
            'room.wallDimensions': [],
            'room.hasBeenScaled': false,
            'ui.mode': 'step-by-step'
        });
    }

    function fitViewToPreview(polyline) {
        if (polyline.length < 2) return;
        const bounds = polygonBounds(polyline);
        const viewParams = fitBoundsToView(bounds, canvas);
        state.batch({
            'view.scale': viewParams.scale,
            'view.offsetX': viewParams.offsetX,
            'view.offsetY': viewParams.offsetY
        });
    }

    function render(opts = {}) {
        if (!active) return;
        const shouldFocusCurrent = opts.focus === true;
        const shouldRefit = opts.refit === true;

        const { segments, turns } = getSegmentsAndTurns();
        const { polyline, residual } = computePreview();

        writePreviewToState(polyline);
        if (shouldRefit) fitViewToPreview(polyline);

        // Build the walls/angles list
        wallsList.innerHTML = '';
        for (let i = 0; i < segments.length; i++) {
            const row = document.createElement('div');
            row.className = 'step-row';

            const label = document.createElement('div');
            label.className = 'step-row-label';
            label.textContent = wallLabel(i);
            row.appendChild(label);

            // Wall length input (editable)
            const lenCell = document.createElement('div');
            lenCell.className = 'step-row-value';
            const lenInput = document.createElement('input');
            lenInput.type = 'number';
            lenInput.min = '1';
            lenInput.step = '0.1';
            lenInput.value = round(segments[i], 1);
            lenInput.addEventListener('change', () => {
                const v = parseFloat(lenInput.value);
                if (Number.isFinite(v) && v > 0) {
                    const entryIndex = findEntryIndex('wall', i);
                    if (entryIndex !== -1) {
                        entries[entryIndex].value = v;
                        render();
                    }
                }
            });
            lenCell.appendChild(lenInput);
            const lenUnit = document.createElement('span');
            lenUnit.className = 'unit';
            lenUnit.textContent = 'cm';
            lenCell.appendChild(lenUnit);
            row.appendChild(lenCell);

            // Outgoing angle (editable if exists, muted "—" if it's the last wall)
            const angCell = document.createElement('div');
            angCell.className = 'step-row-value';
            if (i < turns.length) {
                const angInput = document.createElement('input');
                angInput.type = 'number';
                angInput.min = '1';
                angInput.max = '359';
                angInput.step = '0.1';
                angInput.value = round(turns[i], 1);
                angInput.title = 'Interior angle at the corner on your right';
                angInput.addEventListener('change', () => {
                    const v = parseFloat(angInput.value);
                    if (Number.isFinite(v) && v > 0 && v < 360) {
                        const entryIndex = findEntryIndex('angle', i);
                        if (entryIndex !== -1) {
                            entries[entryIndex].value = v;
                            render();
                        }
                    }
                });
                angCell.appendChild(angInput);
                const angUnit = document.createElement('span');
                angUnit.className = 'unit';
                angUnit.textContent = '°';
                angCell.appendChild(angUnit);
            } else {
                angCell.classList.add('muted');
                angCell.textContent = '—';
            }
            row.appendChild(angCell);

            // Remove button — only on the very last entry (wall or dangling angle)
            const removeCell = document.createElement('div');
            const isLastRow = (i === segments.length - 1);
            const lastEntryIsAngleOnThisRow = (i < turns.length && i === turns.length - 1 && turns.length === segments.length);
            if (isLastRow || lastEntryIsAngleOnThisRow) {
                const btn = document.createElement('button');
                btn.className = 'step-row-remove';
                btn.title = 'Remove last step';
                btn.textContent = '×';
                btn.addEventListener('click', () => {
                    entries.pop();
                    render({ focus: true, refit: true });
                });
                removeCell.appendChild(btn);
            }
            row.appendChild(removeCell);

            wallsList.appendChild(row);
        }

        // Current-input prompt
        renderCurrent(segments.length, turns.length, shouldFocusCurrent);

        // Residual readout
        renderResidual(residual, segments.length, turns.length);

        // Done button gating
        const canClose = segments.length >= 3 && turns.length === segments.length - 1;
        const closeOk = canClose && residual && residual.distanceCm < MAX_DIST_TOLERANCE_CM;
        doneBtn.disabled = !closeOk;
    }

    function findEntryIndex(type, occurrence) {
        let count = 0;
        for (let i = 0; i < entries.length; i++) {
            if (entries[i].type === type) {
                if (count === occurrence) return i;
                count++;
            }
        }
        return -1;
    }

    function renderCurrent(numWalls, numTurns, shouldFocus) {
        currentContainer.innerHTML = '';
        const phase = nextPhase();

        const label = document.createElement('div');
        label.className = 'step-current-label';
        if (phase === 'wall') {
            label.textContent = `Wall ${wallLabel(numWalls)} length`;
        } else {
            label.textContent = `Interior angle after Wall ${wallLabel(numWalls - 1)} (corner on your right)`;
        }
        currentContainer.appendChild(label);

        const inputRow = document.createElement('div');
        inputRow.className = 'step-current-input';

        const input = document.createElement('input');
        input.type = 'number';
        input.step = '0.1';
        if (phase === 'wall') {
            input.placeholder = 'e.g. 420';
            input.min = '1';
        } else {
            input.placeholder = 'e.g. 90';
            input.min = '1';
            input.max = '359';
        }
        inputRow.appendChild(input);

        const unit = document.createElement('span');
        unit.className = 'unit';
        unit.textContent = phase === 'wall' ? 'cm' : '°';
        inputRow.appendChild(unit);

        currentContainer.appendChild(inputRow);

        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'step-current-add';
        addBtn.textContent = phase === 'wall' ? 'Add wall' : 'Add corner';
        addBtn.addEventListener('click', () => submitCurrent(input));
        currentContainer.appendChild(addBtn);

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                submitCurrent(input);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cancel();
            }
        });

        if (shouldFocus) {
            setTimeout(() => input.focus(), 0);
        }
    }

    function submitCurrent(input) {
        const v = parseFloat(input.value);
        if (!Number.isFinite(v) || v <= 0) return;
        const phase = nextPhase();
        if (phase === 'angle' && v >= 360) return;

        entries.push({ type: phase, value: v });
        input.value = '';
        render({ focus: true, refit: true });
    }

    function renderResidual(residual, numWalls, numTurns) {
        if (numWalls < 3 || numTurns !== numWalls - 1) {
            residualEl.className = 'step-residual';
            residualEl.innerHTML = `
                <div class="step-residual-row">
                    <span>Status</span>
                    <strong>${numWalls < 3 ? 'Need at least 3 walls' : 'Enter next wall or remove last angle'}</strong>
                </div>
            `;
            return;
        }
        const distCm = residual.distanceCm;
        const distMm = distCm * 10;
        const ok = distCm < MAX_DIST_TOLERANCE_CM;
        residualEl.className = 'step-residual ' + (ok ? 'ok' : 'warn');
        residualEl.innerHTML = `
            <div class="step-residual-row">
                <span>Gap to close</span>
                <strong>${distMm.toFixed(0)} mm</strong>
            </div>
            <div class="step-residual-row">
                <span>Tolerance</span>
                <span>&lt; ${MAX_DIST_TOLERANCE_CM * 10} mm</span>
            </div>
        `;
    }

    function start() {
        entries = [];
        active = true;
        panel.style.display = 'block';
        state.batch({
            'room.vertices': [],
            'room.isComplete': false,
            'room.wallDimensions': [],
            'room.hasBeenScaled': false,
            'ui.mode': 'step-by-step'
        });
        // Hide the point-and-click hint — we have our own
        const hint = document.getElementById('room-hint');
        if (hint) hint.classList.remove('visible');
        canvas.style.cursor = 'default';
        render({ focus: true, refit: true });
    }

    function cancel() {
        if (!active) return;
        active = false;
        entries = [];
        panel.style.display = 'none';
        wallsList.innerHTML = '';
        currentContainer.innerHTML = '';
        residualEl.innerHTML = '';
        state.batch({
            'room.vertices': [],
            'room.isComplete': false,
            'room.wallDimensions': [],
            'ui.mode': 'idle'
        });
    }

    function finish() {
        const { segments, turns } = getSegmentsAndTurns();
        if (segments.length < 3 || turns.length !== segments.length - 1) return;

        const polyline = buildPolylineFromSteps(segments, turns);
        const residual = polylineClosureResidual(polyline);
        if (!residual || residual.distanceCm >= MAX_DIST_TOLERANCE_CM) return;

        const closed = closeAndDistribute(polyline);

        active = false;
        entries = [];
        panel.style.display = 'none';
        wallsList.innerHTML = '';
        currentContainer.innerHTML = '';
        residualEl.innerHTML = '';

        state.batch({
            'room.vertices': closed,
            'room.isComplete': true,
            'room.hasBeenScaled': true,
            'room.wallDimensions': [],
            'ui.mode': 'idle',
            'ui.selectedWall': null,
            'ui.selectedPlank': null
        });

        // Fit the final polygon to view
        const bounds = polygonBounds(closed);
        const viewParams = fitBoundsToView(bounds, canvas);
        state.batch({
            'view.scale': viewParams.scale,
            'view.offsetX': viewParams.offsetX,
            'view.offsetY': viewParams.offsetY
        });
    }

    cancelBtn.addEventListener('click', cancel);
    doneBtn.addEventListener('click', finish);

    return { start, cancel, isActive: () => active };
}
