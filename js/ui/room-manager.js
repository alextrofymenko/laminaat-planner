/**
 * Room Manager UI
 * Handles room switcher dropdown, save/load/delete functionality
 */

import { state, roomManager, encodeRoomState, decodeRoomState } from '../state.js';
import { polygonBounds } from '../geometry/polygon.js';
import { fitBoundsToView } from '../geometry/transforms.js';

let pendingRoomSwitch = null;
let onSaveComplete = null;

function checkForSharedRoom() {
    const params = new URLSearchParams(window.location.search);
    const encoded = params.get('share');
    if (encoded) {
        return decodeRoomState(encoded);
    }
    return null;
}

export function initRoomManager(canvas) {
    // Check for shared room in URL before initializing
    const sharedData = checkForSharedRoom();
    if (sharedData) {
        roomManager.loadSharedState(sharedData);
        // Clear the URL parameter without reloading
        const url = new URL(window.location);
        url.searchParams.delete('share');
        window.history.replaceState({}, '', url);
        // Fit view to loaded room
        setTimeout(() => fitViewToRoom(), 0);
    } else {
        // Initialize room manager state normally
        roomManager.init();
    }

    // Get UI elements
    const roomSwitcher = document.getElementById('room-switcher');
    const currentRoomBtn = document.getElementById('current-room-btn');
    const currentRoomName = document.getElementById('current-room-name');
    const roomDropdown = document.getElementById('room-dropdown');
    const roomList = document.getElementById('room-list');
    const btnSaveRoom = document.getElementById('btn-save-room');
    const btnNewRoom = document.getElementById('btn-new-room-action');
    const btnDeleteRoom = document.getElementById('btn-delete-room');
    const btnShareRoom = document.getElementById('btn-share-room');
    const btnLockRoom = document.getElementById('btn-lock-room');

    // Save dialog
    const saveDialog = document.getElementById('save-dialog');
    const saveDialogInput = document.getElementById('save-room-name');
    const saveDialogCancel = document.getElementById('save-dialog-cancel');
    const saveDialogConfirm = document.getElementById('save-dialog-confirm');

    // Delete dialog
    const deleteDialog = document.getElementById('delete-dialog');
    const deleteDialogName = document.getElementById('delete-room-name');
    const deleteDialogCancel = document.getElementById('delete-dialog-cancel');
    const deleteDialogConfirm = document.getElementById('delete-dialog-confirm');

    // Unsaved dialog
    const unsavedDialog = document.getElementById('unsaved-dialog');
    const unsavedDialogCancel = document.getElementById('unsaved-dialog-cancel');
    const unsavedDialogDiscard = document.getElementById('unsaved-dialog-discard');
    const unsavedDialogSave = document.getElementById('unsaved-dialog-save');

    function updateUI() {
        const meta = roomManager.getMeta();
        const rooms = roomManager.getSavedRooms();
        const roomName = roomManager.getCurrentRoomName();

        // Update current room display
        if (roomName) {
            currentRoomName.textContent = roomName + (meta.isDirty ? ' *' : '');
        } else {
            currentRoomName.textContent = 'Unsaved Room' + (meta.isDirty ? ' *' : '');
        }

        // Update room list
        roomList.innerHTML = '';

        // Add "New Room" option
        const newItem = document.createElement('div');
        newItem.className = 'room-item room-item-new';
        newItem.innerHTML = '<span class="room-item-icon">+</span> New Room';
        newItem.addEventListener('click', () => {
            closeDropdown();
            handleNewRoom();
        });
        roomList.appendChild(newItem);

        // Add divider if there are saved rooms
        if (rooms.length > 0) {
            const divider = document.createElement('div');
            divider.className = 'room-divider';
            roomList.appendChild(divider);
        }

        // Add saved rooms
        rooms.forEach(room => {
            const item = document.createElement('div');
            item.className = 'room-item';
            if (room.id === meta.currentRoomId) {
                item.classList.add('room-item-active');
            }

            const nameSpan = document.createElement('span');
            nameSpan.className = 'room-item-name';
            nameSpan.textContent = room.name;
            item.appendChild(nameSpan);

            if (room.id === meta.currentRoomId) {
                const activeIndicator = document.createElement('span');
                activeIndicator.className = 'room-item-check';
                activeIndicator.textContent = '✓';
                item.appendChild(activeIndicator);
            }

            item.addEventListener('click', () => {
                if (room.id !== meta.currentRoomId) {
                    closeDropdown();
                    handleRoomSwitch(room.id);
                }
            });

            roomList.appendChild(item);
        });

        // Update delete button visibility
        if (meta.currentRoomId) {
            btnDeleteRoom.style.display = 'inline-block';
        } else {
            btnDeleteRoom.style.display = 'none';
        }
    }

    function closeDropdown() {
        roomDropdown.classList.remove('open');
        roomSwitcher.classList.remove('open');
    }

    function openDropdown() {
        updateUI();
        roomDropdown.classList.add('open');
        roomSwitcher.classList.add('open');
    }

    function handleRoomSwitch(roomId) {
        const meta = roomManager.getMeta();

        if (meta.isDirty) {
            pendingRoomSwitch = roomId;
            unsavedDialog.style.display = 'flex';
        } else {
            switchToRoom(roomId);
        }
    }

    function switchToRoom(roomId) {
        roomManager.loadRoom(roomId);
        fitViewToRoom();
    }

    function fitViewToRoom() {
        const currentState = state.get();
        if (currentState.room.isComplete && currentState.room.vertices.length >= 3) {
            const bounds = polygonBounds(currentState.room.vertices);
            const viewParams = fitBoundsToView(bounds, canvas);
            state.batch({
                'view.scale': viewParams.scale,
                'view.offsetX': viewParams.offsetX,
                'view.offsetY': viewParams.offsetY
            });
        }
    }

    function handleNewRoom() {
        const meta = roomManager.getMeta();

        if (meta.isDirty) {
            pendingRoomSwitch = 'new';
            unsavedDialog.style.display = 'flex';
        } else {
            createNewRoom();
        }
    }

    function createNewRoom() {
        roomManager.createNewRoom();
        state.set('view.scale', 2);
        const hint = document.getElementById('room-hint');
        if (hint) hint.classList.add('visible');
        canvas.style.cursor = 'crosshair';
    }

    function showSaveDialog() {
        const roomName = roomManager.getCurrentRoomName();
        saveDialogInput.value = roomName || '';
        saveDialogInput.placeholder = 'Room name';
        saveDialog.style.display = 'flex';
        saveDialogInput.focus();
        saveDialogInput.select();
    }

    function hideSaveDialog() {
        saveDialog.style.display = 'none';
        // Don't clear onSaveComplete here - let the explicit cancel/close handlers do it
    }

    function showDeleteDialog() {
        const roomName = roomManager.getCurrentRoomName();
        deleteDialogName.textContent = roomName || 'Untitled Room';
        deleteDialog.style.display = 'flex';
    }

    function hideDeleteDialog() {
        deleteDialog.style.display = 'none';
    }

    function hideUnsavedDialog() {
        unsavedDialog.style.display = 'none';
        pendingRoomSwitch = null;
    }

    // Event Listeners

    // Room switcher toggle
    currentRoomBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (roomDropdown.classList.contains('open')) {
            closeDropdown();
        } else {
            openDropdown();
        }
    });

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
        if (!roomSwitcher.contains(e.target)) {
            closeDropdown();
        }
    });

    // Save button
    btnSaveRoom.addEventListener('click', () => {
        const meta = roomManager.getMeta();
        if (meta.currentRoomId) {
            // Already saved, just save again (no dialog needed)
            roomManager.saveCurrentRoom();
        } else {
            // New room, show name dialog
            showSaveDialog();
        }
    });

    // New room button
    btnNewRoom.addEventListener('click', handleNewRoom);

    // Delete button
    btnDeleteRoom.addEventListener('click', showDeleteDialog);

    // Share button
    btnShareRoom.addEventListener('click', () => {
        const currentState = state.get();
        if (!currentState.room.isComplete || currentState.room.vertices.length < 3) {
            return; // Nothing to share
        }

        const encoded = encodeRoomState(currentState);
        const url = new URL(window.location);
        url.searchParams.set('share', encoded);

        // Copy to clipboard
        navigator.clipboard.writeText(url.toString()).then(() => {
            // Show brief feedback
            const originalText = btnShareRoom.textContent;
            btnShareRoom.textContent = 'Copied!';
            setTimeout(() => {
                btnShareRoom.textContent = originalText;
            }, 1500);
        }).catch(() => {
            // Fallback: just update URL
            window.history.replaceState({}, '', url);
            alert('Share URL updated in address bar');
        });
    });

    // Lock button
    function updateLockState() {
        const currentState = state.get();
        const isLocked = currentState.ui.isLocked;

        // Update button appearance
        if (isLocked) {
            btnLockRoom.textContent = 'Unlock';
            btnLockRoom.classList.add('btn-locked');
        } else {
            btnLockRoom.textContent = 'Lock';
            btnLockRoom.classList.remove('btn-locked');
        }

        // Disable/enable sidebar inputs
        const sidebar = document.querySelector('.sidebar');
        const inputs = sidebar.querySelectorAll('input, select');
        const buttons = sidebar.querySelectorAll('.panel button, .room-controls button');

        inputs.forEach(input => {
            input.disabled = isLocked;
        });

        buttons.forEach(btn => {
            btn.disabled = isLocked;
        });
    }

    btnLockRoom.addEventListener('click', () => {
        const currentState = state.get();
        state.set('ui.isLocked', !currentState.ui.isLocked);
    });

    // Subscribe to state changes for lock updates
    state.subscribe(() => updateLockState());

    // Initial lock state
    updateLockState();

    // Save dialog handlers
    function confirmSave() {
        const name = saveDialogInput.value.trim();
        if (name) {
            roomManager.saveCurrentRoom(name);
            hideSaveDialog();
            if (onSaveComplete) {
                const callback = onSaveComplete;
                onSaveComplete = null;
                callback();
            }
        }
    }

    saveDialogCancel.addEventListener('click', () => {
        hideSaveDialog();
        onSaveComplete = null;
    });
    saveDialogConfirm.addEventListener('click', confirmSave);
    saveDialogInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            confirmSave();
        } else if (e.key === 'Escape') {
            hideSaveDialog();
            onSaveComplete = null;
        }
    });
    saveDialog.addEventListener('click', (e) => {
        if (e.target === saveDialog) {
            hideSaveDialog();
            onSaveComplete = null;
        }
    });

    // Delete dialog handlers
    deleteDialogCancel.addEventListener('click', hideDeleteDialog);
    deleteDialogConfirm.addEventListener('click', () => {
        const meta = roomManager.getMeta();
        if (meta.currentRoomId) {
            roomManager.deleteRoom(meta.currentRoomId);
            const hint = document.getElementById('room-hint');
            if (hint) hint.classList.add('visible');
            canvas.style.cursor = 'crosshair';
        }
        hideDeleteDialog();
    });
    deleteDialog.addEventListener('click', (e) => {
        if (e.target === deleteDialog) hideDeleteDialog();
    });

    // Unsaved dialog handlers
    unsavedDialogCancel.addEventListener('click', hideUnsavedDialog);
    unsavedDialogDiscard.addEventListener('click', () => {
        if (pendingRoomSwitch === 'new') {
            createNewRoom();
        } else if (pendingRoomSwitch) {
            switchToRoom(pendingRoomSwitch);
        }
        hideUnsavedDialog();
    });
    unsavedDialogSave.addEventListener('click', () => {
        const meta = roomManager.getMeta();
        const pending = pendingRoomSwitch;
        hideUnsavedDialog();

        if (meta.currentRoomId) {
            // Already saved room, just save
            roomManager.saveCurrentRoom();
            if (pending === 'new') {
                createNewRoom();
            } else if (pending) {
                switchToRoom(pending);
            }
        } else {
            // Show save dialog first, then switch after save
            onSaveComplete = () => {
                if (pending === 'new') {
                    createNewRoom();
                } else if (pending) {
                    switchToRoom(pending);
                }
            };
            showSaveDialog();
        }
    });
    unsavedDialog.addEventListener('click', (e) => {
        if (e.target === unsavedDialog) hideUnsavedDialog();
    });

    // Escape key closes dialogs
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (saveDialog.style.display !== 'none') {
                hideSaveDialog();
                onSaveComplete = null;
            }
            if (deleteDialog.style.display !== 'none') hideDeleteDialog();
            if (unsavedDialog.style.display !== 'none') hideUnsavedDialog();
        }
    });

    // Subscribe to meta changes
    roomManager.subscribeMeta(updateUI);

    // Initial UI update
    updateUI();

    return {
        updateUI
    };
}
