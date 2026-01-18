/**
 * Central state management with reactive updates
 * Persists to localStorage
 */

const STORAGE_KEY = 'laminaat-planner-state';
const ROOMS_STORAGE_KEY = 'laminaat-planner-rooms';

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

    // Wall gap (expansion gap) - affects edge plank calculations
    wallGap: 0.5, // cm (5mm default)

    // UI state
    ui: {
        mode: 'drawing', // 'idle', 'drawing', 'editing', 'dragging' - start in drawing mode
        selectedWall: null,
        selectedPlank: null, // Selected plank id
        selectedRow: null,
        hoveredVertex: null,
        hoveredWall: null,
        hoveredPlank: null,
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
            minimums: state.minimums,
            wallGap: state.wallGap
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch (e) {
        console.warn('Failed to save state to localStorage:', e);
    }
}

// Listeners for state changes
const listeners = new Set();

// Deferred auto-save callback (set after roomManager is created)
let autoSaveCallback = null;

// Create reactive state
function createState() {
    const state = loadState();

    // Notify all listeners of state change
    function notify() {
        saveState(state);
        listeners.forEach(fn => fn(state));
        // Trigger room auto-save (deferred to avoid circular dependency)
        if (autoSaveCallback) autoSaveCallback();
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

// Room meta state for multi-room support
const roomMeta = {
    currentRoomId: null,    // null = unsaved, string = saved room
    isDirty: false,         // has unsaved changes (for saved rooms)
    lastSavedSnapshot: null // JSON string for dirty comparison
};

// Flag to prevent autoSave during room operations
let isLoadingRoom = false;

const metaListeners = new Set();

function notifyMetaListeners() {
    metaListeners.forEach(fn => fn(roomMeta));
}

function getStateSnapshot(s) {
    return JSON.stringify({
        room: s.room,
        plank: s.plank,
        floor: s.floor,
        minimums: s.minimums,
        wallGap: s.wallGap
    });
}

function loadRoomsStorage() {
    try {
        const saved = localStorage.getItem(ROOMS_STORAGE_KEY);
        if (saved) {
            return JSON.parse(saved);
        }
    } catch (e) {
        console.warn('Failed to load rooms from localStorage:', e);
    }
    return { rooms: {}, currentRoomId: null };
}

function saveRoomsStorage(data) {
    try {
        localStorage.setItem(ROOMS_STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
        console.warn('Failed to save rooms to localStorage:', e);
    }
}

function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

export const roomManager = {
    getMeta() {
        return { ...roomMeta };
    },

    subscribeMeta(fn) {
        metaListeners.add(fn);
        return () => metaListeners.delete(fn);
    },

    getSavedRooms() {
        const storage = loadRoomsStorage();
        return Object.values(storage.rooms).sort((a, b) =>
            new Date(b.updatedAt) - new Date(a.updatedAt)
        );
    },

    getCurrentRoomName() {
        if (!roomMeta.currentRoomId) return null;
        const storage = loadRoomsStorage();
        const room = storage.rooms[roomMeta.currentRoomId];
        return room ? room.name : null;
    },

    saveCurrentRoom(name) {
        const currentState = state.get();
        const now = new Date().toISOString();
        const storage = loadRoomsStorage();

        if (roomMeta.currentRoomId) {
            // Update existing room
            const existingRoom = storage.rooms[roomMeta.currentRoomId];
            if (existingRoom) {
                existingRoom.updatedAt = now;
                existingRoom.data = {
                    room: currentState.room,
                    plank: currentState.plank,
                    floor: currentState.floor,
                    minimums: currentState.minimums,
                    wallGap: currentState.wallGap
                };
                if (name) existingRoom.name = name;
            }
        } else {
            // Create new room
            const id = generateUUID();
            storage.rooms[id] = {
                id,
                name: name || 'Untitled Room',
                createdAt: now,
                updatedAt: now,
                data: {
                    room: currentState.room,
                    plank: currentState.plank,
                    floor: currentState.floor,
                    minimums: currentState.minimums,
                    wallGap: currentState.wallGap
                }
            };
            roomMeta.currentRoomId = id;
            storage.currentRoomId = id;
        }

        saveRoomsStorage(storage);
        roomMeta.lastSavedSnapshot = getStateSnapshot(currentState);
        roomMeta.isDirty = false;
        notifyMetaListeners();

        return roomMeta.currentRoomId;
    },

    loadRoom(roomId) {
        const storage = loadRoomsStorage();
        const room = storage.rooms[roomId];
        if (!room) return false;

        // Prevent autoSave during load
        isLoadingRoom = true;

        // Load room data into state
        const { data } = room;
        state.batch({
            'room.vertices': data.room.vertices,
            'room.isComplete': data.room.isComplete,
            'room.wallDimensions': data.room.wallDimensions || [],
            'room.hasBeenScaled': data.room.hasBeenScaled || false,
            'plank.length': data.plank.length,
            'plank.width': data.plank.width,
            'floor.rotation': data.floor.rotation,
            'floor.offsetPattern': data.floor.offsetPattern,
            'floor.offsetX': data.floor.offsetX,
            'floor.offsetY': data.floor.offsetY,
            'floor.rowOffsets': data.floor.rowOffsets || {},
            'minimums.length': data.minimums.length,
            'minimums.width': data.minimums.width,
            'wallGap': data.wallGap !== undefined ? data.wallGap : 0.5,
            'ui.mode': data.room.isComplete ? 'idle' : 'drawing',
            'ui.selectedWall': null,
            'ui.selectedPlank': null,
            'ui.selectedRow': null
        });

        // Update roomMeta after state is loaded
        roomMeta.currentRoomId = roomId;
        roomMeta.lastSavedSnapshot = getStateSnapshot(state.get());
        roomMeta.isDirty = false;

        // Update storage with current room
        storage.currentRoomId = roomId;
        saveRoomsStorage(storage);

        isLoadingRoom = false;
        notifyMetaListeners();
        return true;
    },

    deleteRoom(roomId) {
        const storage = loadRoomsStorage();
        if (!storage.rooms[roomId]) return false;

        delete storage.rooms[roomId];

        // If deleting current room, switch to new empty room
        if (roomMeta.currentRoomId === roomId) {
            storage.currentRoomId = null;
            roomMeta.currentRoomId = null;
            roomMeta.lastSavedSnapshot = null;
            roomMeta.isDirty = false;

            // Prevent autoSave during reset
            isLoadingRoom = true;
            state.reset();
            isLoadingRoom = false;
        }

        saveRoomsStorage(storage);
        notifyMetaListeners();
        return true;
    },

    createNewRoom() {
        // Prevent autoSave during reset
        isLoadingRoom = true;
        state.reset();
        isLoadingRoom = false;

        roomMeta.currentRoomId = null;
        roomMeta.lastSavedSnapshot = null;
        roomMeta.isDirty = false;

        // Clear current room from storage
        const storage = loadRoomsStorage();
        storage.currentRoomId = null;
        saveRoomsStorage(storage);

        notifyMetaListeners();
    },

    checkDirty() {
        if (!roomMeta.currentRoomId) {
            // For unsaved rooms, consider dirty if there are any vertices
            const currentState = state.get();
            roomMeta.isDirty = currentState.room.vertices.length > 0;
        } else {
            // For saved rooms, compare snapshots
            const currentSnapshot = getStateSnapshot(state.get());
            roomMeta.isDirty = currentSnapshot !== roomMeta.lastSavedSnapshot;
        }
        return roomMeta.isDirty;
    },

    // Initialize from storage on load
    init() {
        const storage = loadRoomsStorage();
        if (storage.currentRoomId && storage.rooms[storage.currentRoomId]) {
            this.loadRoom(storage.currentRoomId);
        } else {
            // Set snapshot for current (unsaved) state
            roomMeta.lastSavedSnapshot = getStateSnapshot(state.get());
            const currentState = state.get();
            roomMeta.isDirty = currentState.room.vertices.length > 0;
            notifyMetaListeners();
        }
    },

    // Auto-save for saved rooms (call this after state changes)
    autoSave() {
        // Skip autoSave during room load/delete operations
        if (isLoadingRoom) return;

        if (roomMeta.currentRoomId) {
            this.saveCurrentRoom();
        } else {
            this.checkDirty();
            notifyMetaListeners();
        }
    }
};

// Set up auto-save callback now that roomManager exists
autoSaveCallback = () => roomManager.autoSave();
