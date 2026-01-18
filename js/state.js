/**
 * Central state management with reactive updates
 * Persists to localStorage
 */

const STORAGE_KEY = 'laminaat-planner-state';

const initialState = {
    // Room polygon (array of {x, y} points in cm)
    room: {
        vertices: [],
        isComplete: false,
        wallDimensions: [], // Manually entered dimensions for each wall
        hasBeenScaled: false // Set to true after first proportional scale
    },

    // Plank configuration
    plank: {
        length: 120, // cm
        width: 20,   // cm
    },

    // Floor layout configuration
    floor: {
        rotation: 0,           // degrees (-90 to 90)
        offsetPattern: 0.5,    // fraction (0.5 = 1/2, 0.333 = 1/3, 0.25 = 1/4)
        offsetX: 0,            // cm - floor position offset
        offsetY: 0,            // cm - floor position offset
        rowOffsets: {},        // per-row custom offsets: { rowIndex: fraction }
    },

    // Minimum dimension thresholds
    minimums: {
        length: 30, // cm
        width: 5,   // cm
    },

    // UI state
    ui: {
        mode: 'drawing', // 'idle', 'drawing', 'editing', 'dragging' - start in drawing mode
        selectedWall: null,
        selectedRow: null,
        hoveredVertex: null,
        isDraggingVertex: false, // Vertex drag in progress
    },

    // View/canvas state
    view: {
        scale: 1,      // pixels per cm
        offsetX: 0,    // pan offset in pixels
        offsetY: 0,
        isDragging: false,
        isPanning: false,
    },

    // Computed statistics (updated by stats module)
    stats: {
        area: 0,
        fullPlanks: 0,
        cutPieces: [],
        tooSmall: 0,
        waste: 0,
    }
};

// Deep clone helper
function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

// Load state from localStorage
function loadState() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            // Merge with initial state to ensure all keys exist
            return {
                ...deepClone(initialState),
                ...parsed,
                // Always reset UI state on load
                ui: {
                    ...deepClone(initialState.ui),
                    mode: parsed.room?.isComplete ? 'idle' : 'drawing'
                },
                // Always reset view state on load
                view: deepClone(initialState.view)
            };
        }
    } catch (e) {
        console.warn('Failed to load state from localStorage:', e);
    }
    return deepClone(initialState);
}

// Save state to localStorage
function saveState(state) {
    try {
        // Only save persistent parts of state (not UI or view)
        const toSave = {
            room: state.room,
            plank: state.plank,
            floor: state.floor,
            minimums: state.minimums
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch (e) {
        console.warn('Failed to save state to localStorage:', e);
    }
}

// Listeners for state changes
const listeners = new Set();

// Create reactive state
function createState() {
    const state = loadState();

    // Notify all listeners of state change
    function notify() {
        saveState(state);
        listeners.forEach(fn => fn(state));
    }

    // Simple setter that triggers updates
    function setState(path, value) {
        const keys = path.split('.');
        let obj = state;
        for (let i = 0; i < keys.length - 1; i++) {
            obj = obj[keys[i]];
        }
        obj[keys[keys.length - 1]] = value;
        notify();
    }

    // Batch multiple updates
    function batchUpdate(updates) {
        for (const [path, value] of Object.entries(updates)) {
            const keys = path.split('.');
            let obj = state;
            for (let i = 0; i < keys.length - 1; i++) {
                obj = obj[keys[i]];
            }
            obj[keys[keys.length - 1]] = value;
        }
        notify();
    }

    return {
        get: () => state,
        set: setState,
        batch: batchUpdate,
        subscribe: (fn) => {
            listeners.add(fn);
            return () => listeners.delete(fn);
        },
        reset: () => {
            Object.assign(state, deepClone(initialState));
            notify();
        }
    };
}

export const state = createState();
