/* global BF2042Portal, _Blockly */
(function () {
    "use strict";

    const plugin = BF2042Portal.Plugins.getPlugin("codeStock");
    const STORAGE_KEY = "BF2042Portal_CODESTOCK_v1";
    const SYNC_ENABLED_KEY = "BF2042Portal_CODESTOCK_SyncEnabled";

const WINDOW_STATE_KEY = "BF2042Portal_CODESTOCK_WindowState_v1";

function readWindowState() {
    try {
        const raw = localStorage.getItem(WINDOW_STATE_KEY);
        if (!raw) return null;
        const data = JSON.parse(raw);
        return data && typeof data === "object" ? data : null;
    } catch (_) {
        return null;
    }
}

function writeWindowState() {
    try {
        const data = {
            left: Number.isFinite(window.screenX) ? window.screenX : null,
            top: Number.isFinite(window.screenY) ? window.screenY : null,
            width: Number.isFinite(window.outerWidth) ? window.outerWidth : null,
            height: Number.isFinite(window.outerHeight) ? window.outerHeight : null,
            savedAt: Date.now()
        };
        localStorage.setItem(WINDOW_STATE_KEY, JSON.stringify(data));
    } catch (_) {}
}

function restoreWindowState() {
    const saved = readWindowState();
    if (!saved) return;

    const width = Number.isFinite(saved.width) && saved.width > 0 ? saved.width : null;
    const height = Number.isFinite(saved.height) && saved.height > 0 ? saved.height : null;
    const left = Number.isFinite(saved.left) ? saved.left : null;
    const top = Number.isFinite(saved.top) ? saved.top : null;

    if (typeof window.resizeTo === "function" && width && height) {
        try { window.resizeTo(width, height); } catch (_) {}
    }
    if (typeof window.moveTo === "function" && left !== null && top !== null) {
        try { window.moveTo(left, top); } catch (_) {}
    }
}

function setupWindowStatePersistence() {
    // Restore the last closed window's geometry on startup.
    setTimeout(() => restoreWindowState(), 0);

    // Keep the most recently changed geometry available so the next launch
    // can restore the last window's position/size. This is deliberately
    // separate from the shared code state and is never loaded by sync.
    let timer = null;
    const saveSoon = () => {
        clearTimeout(timer);
        timer = setTimeout(() => writeWindowState(), 150);
    };

    window.addEventListener("resize", saveSoon);
    window.addEventListener("move", saveSoon);

    // Also save on normal page shutdown.
    window.addEventListener("beforeunload", () => {
        clearTimeout(timer);
        writeWindowState();
    });
}

setupWindowStatePersistence();
    const DB_NAME = "BF2042Portal_CODESTOCK_DB";
    const DB_STORE = "state_store";

    const PARENT_COUNT = 4;
    const CHILD_COUNT = 6;
    const COLOR_COUNT = 8;
    const DEFAULT_PARENTS = ["A", "B", "C", "D"];
    const DEFAULT_CHILDREN = [
        ["A-1", "A-2", "A-3", "A-4", "A-5", "A-6"],
        ["B-1", "B-2", "B-3", "B-4", "B-5", "B-6"],
        ["C-1", "C-2", "C-3", "C-4", "C-5", "C-6"],
        ["D-1", "D-2", "D-3", "D-4", "D-5", "D-6"]
    ];

    const DEFAULT_PALETTE = [
        "#10c476ff",
        "#e4c40fff",
        "#4d25ffff",
        "#dd31ffff",
        "#168aceff",
        "#e06817ff",
        "#a80000ff",
        "#a09e9eff"
    ];

    let state = {
        items: [],
        parents: DEFAULT_PARENTS.slice(),
        children: DEFAULT_CHILDREN.map(x => x.slice()),
        palette: DEFAULT_PALETTE.slice(),
        filterParent: 0,
        filterChild: [0, 0, 0, 0, 0, 0, 0, 0],
        filterColor: null,
        currentColor: 0,
        parentCount: 4,
        childCount: 6,
        listFontSize: 15,    // 12〜30px
        treeNavWidth: 145,   // 左タブの横幅
        windowBounds: { left: null, top: null, width: 400, height: 600 }
    };

    let editingIdValue = null;
    let lastEditingId = null;
    let inputHidden = true;
    let selectedIds = new Set();
    let lastSelected = null;
    let internalClipboard = [];
    let clipboardMode = null;
    let cutIds = new Set();
    let folderClipboard = null;

    let isPinned = true;
    let isCollapsed = false;
    let isTempExpanded = false;
    let savedPanelHeight = "600px";
    let showTreeNav = true;
    let lastTreeNavScrollTop = 0; // ★ 左ツリーのスクロール位置を常に永続記憶する変数

    let panel = null;
    let listEl = null;
    let searchEl = null;
    let titleEl = null;
    let bodyEl = null;
    let statusEl = null;
    let searchScope = "ALL"; // ★ 検索範囲（"TAB" = 選択タブ内 / "ALL" = 全データ検索）
    let syncOnTabOpen = false; // ★ タブを開くたびに共有ストレージから最新データを同期

    let interactionMode = "normal";
    let pendingBlockData = null;
    let lastMouseEvent = null;
    let lastContextMenuEvent = null;

    let scrollToBottomOnRender = false;
    const listScrollPositions = new Map(); // ★ タブごとのスクロール位置を記録（キー: "親_子"）

    function cloneDefault() {
        return {
            items: [],
            parents: DEFAULT_PARENTS.slice(),
            children: DEFAULT_CHILDREN.map(x => x.slice()),
            palette: DEFAULT_PALETTE.slice(),
            filterParent: 0,
            filterChild: [0, 0, 0, 0, 0, 0, 0, 0],
            filterColor: null,
            currentColor: 0,
            parentCount: 4,
            childCount: 6,
            listFontSize: 15,    // 12〜30px
            treeNavWidth: 145,   // 左タブの横幅
            windowBounds: { left: null, top: null, width: 400, height: 600 }
        };
    }

    // --- IndexedDB 大容量ストレージ ---
    function openDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(DB_STORE)) {
                    db.createObjectStore(DB_STORE);
                }
            };
            req.onsuccess = (e) => resolve(e.target.result);
            req.onerror = (e) => reject(e.target.error);
        });
    }

    function idbGet(key) {
        return openDB().then(db => new Promise((resolve, reject) => {
            const tx = db.transaction(DB_STORE, "readonly");
            const req = tx.objectStore(DB_STORE).get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        }));
    }

    function idbSet(key, val) {
        return openDB().then(db => new Promise((resolve, reject) => {
            const tx = db.transaction(DB_STORE, "readwrite");
            const req = tx.objectStore(DB_STORE).put(val, key);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        }));
    }

    function readSyncSetting() {
        try {
            syncOnTabOpen = localStorage.getItem(SYNC_ENABLED_KEY) === "1";
        } catch (_) {
            syncOnTabOpen = false;
        }
        return syncOnTabOpen;
    }

    function writeSyncSetting(enabled) {
        syncOnTabOpen = !!enabled;
        try {
            localStorage.setItem(SYNC_ENABLED_KEY, syncOnTabOpen ? "1" : "0");
        } catch (_) { }
    }

    function getSavedAt(data) {
        const n = Number(data && data.__jcsUpdatedAt);
        return Number.isFinite(n) ? n : 0;
    }

    async function getSharedState() {
        let idbState = null;
        let localState = null;

        try {
            idbState = await idbGet("app_state");
        } catch (_) { }

        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) localState = JSON.parse(raw);
        } catch (_) { }

        // IndexedDB と localStorage のうち、更新日時が新しい方を採用。
        // 旧データ（更新日時なし）は従来どおり IndexedDB を優先する。
        if (idbState && localState) {
            return getSavedAt(localState) > getSavedAt(idbState) ? localState : idbState;
        }
        return idbState || localState || null;
    }

    function applyLoadedState(saved, preserveTab = false) {
        if (!saved) return false;

        const keepParent = state.filterParent;
        const keepChild = Array.isArray(state.filterChild) ? state.filterChild.slice() : Array(8).fill(0);

        const d = cloneDefault();
        state = Object.assign(d, saved);

        if (preserveTab) {
            state.filterParent = keepParent;
            state.filterChild = keepChild;
        } else {
            state.filterParent = 0;
            state.filterChild = Array(8).fill(0);
        }

        if (!state.parentCount) state.parentCount = 4;
        if (!state.childCount) state.childCount = 6;

        if (Array.isArray(saved.parents)) state.parents = saved.parents.slice();
        if (Array.isArray(saved.children)) state.children = saved.children.map(arr => Array.isArray(arr) ? arr.slice() : []);
        if (Array.isArray(saved.palette) && saved.palette.length === COLOR_COUNT) state.palette = saved.palette;
        if (!Array.isArray(state.items)) state.items = [];

        ensureStateIntegrity();
        currentSnapshot = getSnapshotString();
        undoStack = [];
        redoStack = [];
        return true;
    }

    async function loadState() {
        try {
            readSyncSetting();
            const saved = await getSharedState();
            if (!applyLoadedState(saved, false)) return;
            if (panel) renderPanel();
        } catch (e) {
            console.error("[CODE STOCK] load failed", e);
        }
    }

    // ★ 同期ON時だけ、親/子タブを開く直前に共有IndexedDB/localStorageの最新状態を読む。
    async function syncBeforeTabOpen() {
        readSyncSetting();
        if (!syncOnTabOpen) return false;

        try {
            const saved = await getSharedState();
            if (!saved) return false;

            const sharedAt = getSavedAt(saved);
            const currentAt = getSavedAt(state);

            if (sharedAt > 0 && currentAt > sharedAt) return false;

            const sharedData = {
                items: Array.isArray(saved.items) ? saved.items : [],
                parents: saved.parents,
                children: saved.children,
                parentCount: saved.parentCount,
                childCount: saved.childCount,
                palette: saved.palette,
                parentColors: saved.parentColors,
                childColors: saved.childColors,
                iconAtlas: saved.iconAtlas
            };
            const currentData = {
                items: state.items,
                parents: state.parents,
                children: state.children,
                parentCount: state.parentCount,
                childCount: state.childCount,
                palette: state.palette,
                parentColors: state.parentColors,
                childColors: state.childColors,
                iconAtlas: state.iconAtlas
            };

            const sharedHasDifferentData = JSON.stringify(sharedData) !== JSON.stringify(currentData);
            if (!sharedHasDifferentData) return false;

            applyLoadedState(saved, true);
            setStatus("Synced");
            return true;
        } catch (e) {
            console.warn("[CODE STOCK] sync failed:", e);
            return false;
        }
    }

    // --- 履歴管理（Undo / Redo） ---
    const MAX_HISTORY = 30;
    let undoStack = [];
    let redoStack = [];
    let isHistoryAction = false;
    let currentSnapshot = null;

    function getSnapshotString() {
        return JSON.stringify({
            items: state.items,
            parents: state.parents,
            children: state.children,
            parentColors: state.parentColors,
            childColors: state.childColors,
            parentCount: state.parentCount,
            childCount: state.childCount,
            palette: state.palette,
            iconAtlas: state.iconAtlas
        });
    }

    function updateHistoryButtons() {
        if (!panel) return;
        const undoBtn = panel.querySelector(".jcs-history-undo");
        const redoBtn = panel.querySelector(".jcs-history-redo");

        if (undoBtn) {
            const canUndo = (undoStack.length > 0);
            undoBtn.disabled = !canUndo;
            undoBtn.className = "jcs-history-btn jcs-history-undo" + (canUndo ? "" : " disabled");
            undoBtn.title = canUndo ? `Undo (元に戻す) [残り${undoStack.length}回]` : "Undo (履歴なし)";
        }

        if (redoBtn) {
            const canRedo = (redoStack.length > 0);
            redoBtn.disabled = !canRedo;
            redoBtn.className = "jcs-history-btn jcs-history-redo" + (canRedo ? "" : " disabled");
            redoBtn.title = canRedo ? `Redo (やり直す) [残り${redoStack.length}回]` : "Redo (履歴なし)";
        }
    }

    function doUndo() {
        if (undoStack.length === 0) return;
        isHistoryAction = true;

        redoStack.push(getSnapshotString());
        const prevJson = undoStack.pop();
        const prevData = JSON.parse(prevJson);
        Object.assign(state, prevData);
        currentSnapshot = prevJson;

        saveState();
        renderPanel();
        setStatus("Undo");
        isHistoryAction = false;
        updateHistoryButtons();
    }

    function doRedo() {
        if (redoStack.length === 0) return;
        isHistoryAction = true;

        undoStack.push(getSnapshotString());
        const nextJson = redoStack.pop();
        const nextData = JSON.parse(nextJson);
        Object.assign(state, nextData);
        currentSnapshot = nextJson;

        saveState();
        renderPanel();
        setStatus("Redo");
        isHistoryAction = false;
        updateHistoryButtons();
    }

    function saveState() {
        // 共有ストレージ上で「どちらが新しいか」を判定するための更新時刻。
        state.__jcsUpdatedAt = Math.max(Date.now(), getSavedAt(state) + 1);

        if (!isHistoryAction) {
            const nextSnap = getSnapshotString();
            if (currentSnapshot === null) {
                currentSnapshot = nextSnap;
            } else if (nextSnap !== currentSnapshot) {
                undoStack.push(currentSnapshot);
                if (undoStack.length > MAX_HISTORY) undoStack.shift();
                currentSnapshot = nextSnap;
                redoStack = [];
            }
        }

        updateHistoryButtons();

        // IndexedDBを本体として保存しつつ、同期用の共有localStorageにもミラーする。
        // localStorageが容量超過してもIndexedDB側の保存は継続する。
        let localSaved = false;
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
            localSaved = true;
        } catch (_) { }

        idbSet("app_state", state).then(() => {
            setStatus(localSaved ? "Saved" : "Saved (IDB)");
        }).catch(err => {
            console.warn("[CODE STOCK] IndexedDB save failed:", err);
            if (localSaved) {
                setStatus("Saved (local)");
            } else {
                setStatus("Save failed");
            }
        });
    }

    function ensureStateIntegrity() {
        state.parentCount = Math.max(1, Math.min(8, state.parentCount || 4));
        state.childCount = Math.max(1, Math.min(8, state.childCount || 6));

        if (!Array.isArray(state.parents)) state.parents = [];
        while (state.parents.length < 8) {
            state.parents.push(String.fromCharCode(65 + state.parents.length));
        }

        if (!Array.isArray(state.children)) state.children = [];
        while (state.children.length < 8) {
            state.children.push([]);
        }

        for (let p = 0; p < 8; p++) {
            if (!Array.isArray(state.children[p])) state.children[p] = [];
            const pChar = state.parents[p] || String.fromCharCode(65 + p);
            while (state.children[p].length < 8) {
                state.children[p].push(pChar + "-" + (state.children[p].length + 1));
            }
        }

        if (!Array.isArray(state.filterChild)) state.filterChild = Array(8).fill(0);
        while (state.filterChild.length < 8) {
            state.filterChild.push(0);
        }

        if (!Array.isArray(state.parentColors)) state.parentColors = Array(8).fill(null);
        while (state.parentColors.length < 8) state.parentColors.push(null);

        if (!Array.isArray(state.childColors)) state.childColors = [];
        while (state.childColors.length < 8) state.childColors.push(Array(8).fill(null));
        for (let p = 0; p < 8; p++) {
            if (!Array.isArray(state.childColors[p])) state.childColors[p] = Array(8).fill(null);
            while (state.childColors[p].length < 8) state.childColors[p].push(null);
        }

        if (state.filterParent >= state.parentCount || state.filterParent < 0) {
            state.filterParent = 0;
        }
        for (let p = 0; p < 8; p++) {
            if (state.filterChild[p] >= state.childCount || state.filterChild[p] < 0) {
                state.filterChild[p] = 0;
            }
        }
    }

    function uid() {
        if (crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
        return "item-" + Date.now() + "-" + Math.random().toString(16).slice(2);
    }

    function setStatus(text) {
        if (statusEl) statusEl.textContent = text;
    }

    function attachMouseTracking(ws) {
        try {
            const svg = ws && ws.getParentSvg && ws.getParentSvg();
            if (!svg || svg._codeStockMouseTrackingAttached) return;
            svg._codeStockMouseTrackingAttached = true;
            svg.addEventListener("mousemove", e => { lastMouseEvent = e; }, { passive: true });
            svg.addEventListener("contextmenu", e => { lastContextMenuEvent = e; lastMouseEvent = e; }, { passive: true });
        } catch (e) {
            console.warn("[CODE STOCK] mouse tracking failed:", e);
        }
    }

    function copyText(text) {
        if (BF2042Portal.Shared && BF2042Portal.Shared.copyTextToClipboard) {
            return Promise.resolve(BF2042Portal.Shared.copyTextToClipboard(text));
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text);
        }
        return Promise.reject(new Error("Clipboard API unavailable"));
    }

    function saveWindowBounds() {
        if (!panel || isCollapsed) return;
        const rect = panel.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
            const h = Math.round(rect.height);
            state.windowBounds = {
                left: Math.round(rect.left),
                top: Math.round(rect.top),
                width: Math.round(rect.width),
                height: h
            };
            savedPanelHeight = h + "px";
            saveState();
        }
    }

    function applySavedWindowBounds() {
        if (!panel || !state.windowBounds) return false;
        const b = state.windowBounds;
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        if (b.width) panel.style.width = Math.max(320, Math.min(b.width, vw - 16)) + "px";
        if (b.height) panel.style.height = Math.max(200, Math.min(b.height, vh - 16)) + "px";

        if (isPinned && b.left !== null && b.top !== null) {
            const maxL = Math.max(8, vw - (b.width || 400) - 8);
            const maxT = Math.max(8, vh - (b.height || 600) - 8);
            panel.style.left = Math.max(8, Math.min(b.left, maxL)) + "px";
            panel.style.top = Math.max(8, Math.min(b.top, maxT)) + "px";
            panel.style.right = "auto";
            return true;
        }
        return false;
    }

    function positionPanelAtContext() {
        if (!panel) return;
        const e = lastContextMenuEvent || lastMouseEvent;
        if (!e) return;

        const gap = 12;
        const rect = panel.getBoundingClientRect();
        const w = rect.width || 400;
        const h = rect.height || 600;
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        let left = e.clientX + gap;
        if (left + w > vw - 8) left = e.clientX - w - gap;
        left = Math.max(8, Math.min(left, vw - w - 8));

        let top = e.clientY - 20;
        top = Math.max(8, Math.min(top, vh - h - 8));

        panel.style.left = left + "px";
        panel.style.top = top + "px";
        panel.style.right = "auto";
    }

    function injectStyle() {
        if (document.getElementById("js-code-stock-style")) return;
        const style = document.createElement("style");
        style.id = "js-code-stock-style";
        style.textContent = `
#js-code-stock-panel{position:fixed;left:18px;top:58px;width:400px;height:600px;min-width:320px;min-height:320px;max-width:calc(100vw - 36px);max-height:calc(100vh - 76px);z-index:2147483646;background:#111;color:#fff;border:1px solid #333;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.6);font-family:sans-serif;display:flex;flex-direction:column;overflow:hidden;padding:6px;resize:both;user-select:none;-webkit-user-select:none}
#js-code-stock-panel *{box-sizing:border-box}

#js-code-stock-panel .jcs-container{display:flex;flex-direction:column;height:100%;max-height:100%;padding:0 4px;overflow:hidden}
#js-code-stock-panel .jcs-head{flex-shrink:0;display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
#js-code-stock-panel .jcs-title{font-size:18px;text-align:left;cursor:grab;user-select:none;flex:1}
#js-code-stock-panel .jcs-title:active{cursor:grabbing}
#js-code-stock-panel .jcs-tools{display:flex;gap:4px;align-items:center}
#js-code-stock-panel button{background:#333;color:#fff;border:none;border-radius:2px;cursor:pointer}
#js-code-stock-panel button:hover{background:#3b3b3b}
#js-code-stock-panel .jcs-tools button{font-size:11px;padding:5px 7px}
#js-code-stock-panel .jcs-close{font-size:18px;padding:1px 6px;background:#7a2020}
#js-code-stock-panel .jcs-close:hover{background:#a52a2a}

#js-code-stock-panel .jcs-tabs{flex-shrink:0;height:36px;display:flex;gap:0;background:#1f1f1f;padding:2px 12px 0;overflow:hidden}
#js-code-stock-panel .jcs-tab{flex:1;max-width:240px;height:36px;background:#2d2d2d;color:#9aa0a6;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;position:relative;border:none;border-top-left-radius:4px;border-top-right-radius:4px;border-bottom-left-radius:0;border-bottom-right-radius:0;transform:perspective(40px) rotateX(6deg);transform-origin:bottom;z-index:1;box-shadow:0 2px 0 0 #fff}
#js-code-stock-panel .jcs-tab:hover{background:#35363a;color:#e8eaed;z-index:2}
#js-code-stock-panel .jcs-tab.active{background:#35363a;color:#fff;z-index:3;box-shadow:-2px 0 0 0 #fff,2px 0 0 0 #fff,0 -2px 0 0 #fff}
#js-code-stock-panel .jcs-child{flex-shrink:0;height:36px;margin-bottom:4px}
#js-code-stock-panel .jcs-colors{flex-shrink:0;display:flex;gap:4px;background:transparent;padding:0 0 3px;overflow:visible;width:100%}
#js-code-stock-panel .jcs-colors .jcs-tab{flex:1;min-width:0;height:24px;padding:0;box-shadow:none;transform:none;border-radius:2px}
#js-code-stock-panel .jcs-colors .jcs-tab.active{border:2px solid #fff;box-shadow:inset 0 0 0 1px rgba(0,0,0,.35);z-index:4}

#js-code-stock-panel .jcs-input-section{flex-shrink:0;margin-bottom:6px}
#js-code-stock-panel .jcs-input-row{display:flex;gap:4px}
#js-code-stock-panel .jcs-input-left{width:100%;display:flex;flex-direction:column;gap:3px}
#js-code-stock-panel .jcs-input-wrapper{position:relative;width:100%}
#js-code-stock-panel .jcs-input-wrapper input,#js-code-stock-panel .jcs-input-wrapper textarea,#js-code-stock-panel .jcs-search{width:100%;box-sizing:border-box;padding:3px;background:#2a2a2a;border:none;color:#fff;border-radius:0}
#js-code-stock-panel .jcs-input-wrapper input{height:30px;font-size:18px}
#js-code-stock-panel .jcs-input-wrapper textarea{height:80px;font-size:16px;resize:none;font-family:sans-serif}
#js-code-stock-panel .jcs-input-right{display:flex;flex-direction:row;gap:4px;justify-content:flex-start;width:50%}
#js-code-stock-panel .jcs-add{width:76px;min-width:76px;height:28px;background:#2259a8}
#js-code-stock-panel .jcs-add:hover{background:#6b86ff}
#js-code-stock-panel .jcs-cancel{width:76px;min-width:76px;height:28px;background:#482020}
#js-code-stock-panel .jcs-cancel:hover{background:#f36758}
#js-code-stock-panel .jcs-clear{position:absolute;right:4px;top:50%;transform:translateY(-50%);cursor:pointer;background:#555;color:#fff;border:none;border-radius:3px;width:20px;height:20px;font-size:14px;line-height:18px;z-index:10}
#js-code-stock-panel .jcs-clear:hover{background:#ad1a1a}
#js-code-stock-panel #jcs-toggle-input{width:100%;height:30px;background:#444;border:none;color:#fff;cursor:pointer;margin-top:3px;font-size:13px}
#js-code-stock-panel .jcs-filter{flex-shrink:0;padding:0 0 3px;border-bottom:1px solid #333}
#js-code-stock-panel .jcs-filter-colors{display:flex;gap:4px;background:transparent;padding:0;overflow:visible;width:100%}
#js-code-stock-panel .jcs-filter-colors .jcs-tab{flex:1;min-width:0;height:24px;padding:0;box-shadow:none;transform:none;border-radius:2px;font-size:11px;display:flex;align-items:center;justify-content:center}
#js-code-stock-panel .jcs-filter-colors .jcs-tab.active{border:2px solid #fff;box-shadow:inset 0 0 0 1px rgba(0,0,0,.35);z-index:4}
#js-code-stock-panel .jcs-search{height:30px;font-size:18px;margin-top:3px}
#js-code-stock-panel .jcs-body-head{flex-shrink:0;display:flex;align-items:center;gap:8px;padding:3px 0;margin-top:2px;border-bottom:1px solid #333}
#js-code-stock-panel .jcs-tree-toggle{background:#2a2a2a;color:#4da3ff;border:1px solid #444;font-size:11px;padding:2px 6px;cursor:pointer;border-radius:3px;font-weight:bold}
#js-code-stock-panel .jcs-tree-toggle:hover{background:#3a3a3a;color:#fff}
#js-code-stock-panel .jcs-body-title{font-size:12px;font-weight:bold;color:#888}

#js-code-stock-panel .jcs-main-pane{display:flex;flex:1 1 0;min-height:0;height:100%;margin-top:4px;gap:6px;overflow:hidden}

/* 左ツリーの max-width / min-width 制限を解除・調整 */
#js-code-stock-panel .jcs-tree-nav{min-width:0!important;max-width:none!important;height:100%;max-height:100%;background:#181818;border:1px solid #333;border-radius:4px;overflow-y:auto!important;overflow-x:hidden;padding:2px;flex-shrink:0;box-sizing:border-box}

/* ★ 境目をドラッグしてリサイズするためのスプリッター */
#js-code-stock-panel .jcs-splitter{width:6px;cursor:col-resize;background:#222;flex-shrink:0;transition:background 0.15s;margin:0 1px;border-radius:2px}
#js-code-stock-panel .jcs-splitter:hover,#js-code-stock-panel .jcs-splitter.active{background:#4da3ff}

/* ★ 見出し部のフォントサイズコントローラー */
.jcs-font-ctrl{display:inline-flex;align-items:center;gap:3px;margin-left:auto;background:#222;padding:1px 4px;border-radius:3px;border:1px solid #444}
.jcs-font-ctrl button{padding:1px 5px;font-size:10px;height:18px;line-height:16px;background:#333;color:#fff;border:none;border-radius:2px;cursor:pointer}
.jcs-font-ctrl button:hover{background:#4a7bd4}
.jcs-font-val{font-size:11px;min-width:28px;text-align:center;color:#4da3ff;font-weight:bold}
#js-code-stock-panel .jcs-tree-nav::-webkit-scrollbar{width:8px!important;display:block!important}
#js-code-stock-panel .jcs-tree-nav::-webkit-scrollbar-track{background:#161616!important}
#js-code-stock-panel .jcs-tree-nav::-webkit-scrollbar-thumb{background:#555!important;border-radius:4px}
#js-code-stock-panel .jcs-tree-nav::-webkit-scrollbar-thumb:hover{background:#777!important}

#js-code-stock-panel .jcs-tree-parent{font-size:11px;font-weight:bold;color:#888;background:transparent;padding:6px 6px 2px 4px;margin-top:6px;margin-bottom:2px;border:none;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}
#js-code-stock-panel .jcs-tree-parent:hover{color:#ccc;background:rgba(255,255,255,0.04)}
#js-code-stock-panel .jcs-tree-parent.active{border:none;background:transparent;color:#888}

#js-code-stock-panel .jcs-tree-child{font-size:14px;color:#aaa;padding:4px 8px 4px 14px;border-radius:2px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-left:2px solid transparent;display:block;margin-bottom:1px}
#js-code-stock-panel .jcs-tree-child:hover{background:#2a2a2a;color:#ddd}
#js-code-stock-panel .jcs-tree-child.active{color:#fff;background:#35363a;font-weight:bold;border-left-color:#2ecc71}

#js-code-stock-panel .jcs-list{flex:1 1 0;min-width:0;height:100%;max-height:100%;overflow-y:auto!important;padding-right:2px}
#js-code-stock-panel .jcs-list::-webkit-scrollbar{width:8px}
#js-code-stock-panel .jcs-list::-webkit-scrollbar-track{background:#1e1e1e}
#js-code-stock-panel .jcs-list::-webkit-scrollbar-thumb{background:#444;border-radius:6px}
#js-code-stock-panel .jcs-list::-webkit-scrollbar-thumb:hover{background:#666}

#js-code-stock-panel .jcs-item{display:flex;background:#262626;padding:4px;margin-bottom:2px;cursor:pointer;font-size:16px;justify-content:space-between;align-items:center;border:1px solid transparent;position:relative}
#js-code-stock-panel .jcs-item:hover{background:#333}
#js-code-stock-panel .jcs-item.selected{background:#2a2f3a;border-left:3px solid #4da3ff}
#js-code-stock-panel .jcs-item.dragging{opacity:.5}
#js-code-stock-panel .jcs-item.dragTarget{border-top:2px solid #4da3ff}
#js-code-stock-panel .jcs-drag{width:26px;min-width:26px;height:22px;cursor:grab;user-select:none;border:1px solid #555;background:#2a2a2a;border-radius:4px;font-size:14px;padding:0;display:flex;align-items:center;justify-content:center;color:#aaa}
#js-code-stock-panel .jcs-drag.active{background:#4a7bd4;color:#fff}
#js-code-stock-panel .jcs-name{flex:1;margin-left:6px;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:2px 4px;border-left:6px solid #666;display:flex;align-items:center;cursor:grab;user-select:none}
#js-code-stock-panel .jcs-name:active{cursor:grabbing;background:#555}
#js-code-stock-panel .jcs-actions{display:flex;gap:6px;opacity:0;transition:0.1s}
#js-code-stock-panel .jcs-item:hover .jcs-actions{opacity:1}
#js-code-stock-panel .jcs-actions button{font-size:13px;padding:2px 6px;height:22px;line-height:18px;border-radius:3px}
#js-code-stock-panel .jcs-btn-edit:hover{background:#3571b3}
#js-code-stock-panel .jcs-btn-del:hover{background:#e74c3c}

#js-code-stock-panel .jcs-foot{flex-shrink:0;padding-top:4px;border-top:1px solid #333;display:flex;justify-content:space-between;align-items:center}
#js-code-stock-panel .jcs-status{color:#aaa;font-size:11px}
#js-code-stock-panel .jcs-hidden{display:none!important}
#js-code-stock-panel input:focus,#js-code-stock-panel textarea:focus{outline:1px solid #4a7bd4}

#js-code-stock-panel .jcs-gear{font-size:13px;padding:3px 6px;background:#333}
#js-code-stock-panel .jcs-pin{font-size:13px;padding:3px 5px;background:#333}
#js-code-stock-panel .jcs-pin.unlocked{opacity:0.45;filter:grayscale(1)}
#js-code-stock-panel.collapsed{height:auto!important;min-height:0!important;resize:none}

#jcs-settings-menu{position:fixed;background:#222;border:1px solid #555;border-radius:6px;padding:8px;z-index:2147483647;box-shadow:0 6px 20px rgba(0,0,0,0.8);display:flex;flex-direction:column;gap:6px;min-width:180px}
#jcs-settings-menu button.jcs-menu-btn{width:100%;padding:5px 8px;font-size:12px;background:#333;color:#fff;border:none;border-radius:3px;cursor:pointer;text-align:center}
#jcs-settings-menu button.jcs-menu-btn:hover{background:#4a7bd4}
.jcs-menu-sep{height:1px;background:#444;margin:2px 0}
.jcs-menu-row{display:flex;align-items:center;justify-content:space-between;font-size:12px;color:#ddd;padding:2px 4px}
.jcs-counter{display:flex;align-items:center;gap:4px}
.jcs-counter button{width:22px;height:22px;padding:0;text-align:center;font-size:13px;line-height:20px;background:#333;color:#fff;border:1px solid #555;border-radius:3px;cursor:pointer}
.jcs-counter button:hover{background:#555}
.jcs-counter span{min-width:18px;text-align:center;font-weight:bold;color:#fff}
#js-code-stock-panel .jcs-scope-btn{width:46px;min-width:46px;height:30px;font-size:11px;font-weight:bold;background:#2a2a2a;color:#aaa;border:1px solid #444;border-radius:2px;cursor:pointer}
#js-code-stock-panel .jcs-scope-btn:hover{background:#3a3a3a;color:#fff}
#js-code-stock-panel .jcs-scope-btn.active{background:#2259a8;color:#fff;border-color:#4da3ff}
#js-code-stock-panel .jcs-tag-badge{font-size:10px;color:#777;background:#1a1a1a;padding:1px 4px;border-radius:2px;margin-left:6px;border:1px solid #333}
#js-code-stock-panel .jcs-history-btn{font-size:12px;padding:3px 5px;background:#333}
#js-code-stock-panel .jcs-history-btn.disabled{opacity:0.3;cursor:not-allowed;filter:grayscale(1)}

`;
        document.head.appendChild(style);
    }

    function makeButton(text, fn, cls) {
        const b = document.createElement("button");
        b.textContent = text;
        if (cls) b.className = cls;
        b.onclick = fn;
        return b;
    }

    function exportData() {
        const data = {
            items: state.items,
            iconAtlas: state.iconAtlas || null,
            config: {
                parentCount: state.parentCount || 4,
                childCount: state.childCount || 6,
                parents: state.parents,
                children: state.children,
                parentColors: state.parentColors || null,
                childColors: state.childColors || null,
                palette: state.palette
            }
        };
        const text = JSON.stringify(data, null, 2);
        copyText(text).then(() => setStatus("Export JSON copied to clipboard"));
        const blob = new Blob([text], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "CodeStock_" + new Date().toISOString().replace(/[:.]/g, "-") + ".json";
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
    }

    function importData() {
        const input = document.createElement("input");
        input.type = "file"; input.accept = ".json,application/json";
        input.onchange = () => {
            const file = input.files && input.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const data = JSON.parse(reader.result);
                    if (!confirm("Overwrite current CODE STOCK data?")) return;

                    if (Array.isArray(data.items)) state.items = data.items;

                    if (data.iconAtlas && data.iconAtlas.spriteUrl) {
                        state.iconAtlas = data.iconAtlas;
                    }

                    if (data.config) {
                        if (data.config.parentCount) state.parentCount = Math.max(1, Math.min(8, Number(data.config.parentCount) || 4));
                        if (data.config.childCount) state.childCount = Math.max(1, Math.min(8, Number(data.config.childCount) || 6));
                        if (Array.isArray(data.config.parents)) state.parents = data.config.parents.slice();
                        if (Array.isArray(data.config.children)) state.children = data.config.children.map(arr => Array.isArray(arr) ? arr.slice() : []);
                        if (Array.isArray(data.config.palette) && data.config.palette.length === COLOR_COUNT) state.palette = data.config.palette.slice();

                        if (Array.isArray(data.config.parentColors)) state.parentColors = data.config.parentColors.slice();
                        if (Array.isArray(data.config.childColors)) state.childColors = data.config.childColors.map(arr => Array.isArray(arr) ? arr.slice() : []);
                    }

                    saveState();
                    renderPanel();
                    setStatus("Import complete");
                } catch (e) {
                    setStatus("Loading failed");
                    BF2042Portal.Shared.logError("CODE STOCK import", String(e));
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }

    function exportCurrentTagData() {
        const pIdx = state.filterParent;
        const cIdx = state.filterChild[pIdx];
        const pName = state.parents[pIdx] || ("P" + pIdx);
        const cName = (state.children[pIdx] && state.children[pIdx][cIdx]) || ("C" + cIdx);

        const targetItems = state.items
            .filter(i => i.parent === pIdx && i.child === cIdx)
            .sort((a, b) => (a.order || 0) - (b.order || 0));

        if (targetItems.length === 0) {
            alert("No snippets found in the current tag.");
            return;
        }

        const data = {
            type: "CodeStock_TagExport",
            parentName: pName,
            childName: cName,
            items: targetItems.map(i => {
                let iconSrc = null;
                if (i.iconCoord && state.iconAtlas && Array.isArray(state.iconAtlas.sources)) {
                    const idx = Math.floor(i.iconCoord.x / (i.iconCoord.w || ICON_SIZE));
                    iconSrc = state.iconAtlas.sources[idx] || null;
                }
                return {
                    title: i.title,
                    body: i.body,
                    color: i.color || 0,
                    iconSrc: iconSrc
                };
            })
        };

        const text = JSON.stringify(data, null, 2);
        copyText(text).then(() => setStatus("Tag JSON copied to clipboard"));
        const blob = new Blob([text], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `Tag_${pName}_${cName}_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
    }

    function importCurrentTagData() {
        const pIdx = state.filterParent;
        const cIdx = state.filterChild[pIdx];
        const pName = state.parents[pIdx] || ("P" + pIdx);
        const cName = (state.children[pIdx] && state.children[pIdx][cIdx]) || ("C" + cIdx);

        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json,application/json";
        input.onchange = () => {
            const file = input.files && input.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async () => {
                try {
                    const raw = JSON.parse(reader.result);
                    const importList = Array.isArray(raw) ? raw : (raw.items || []);

                    if (!Array.isArray(importList) || importList.length === 0) {
                        alert("No valid snippets found in the file.");
                        return;
                    }

                    if (!confirm(`Add ${importList.length} snippet(s) into current tag [${pName} > ${cName}]?`)) {
                        return;
                    }

                    const currentItems = state.items.filter(i => i.parent === pIdx && i.child === cIdx);
                    let nextOrderNum = currentItems.length;
                    let addedCount = 0;

                    for (const item of importList) {
                        if (item && item.title) {
                            let iconCoord = null;
                            if (item.iconSrc) {
                                try {
                                    iconCoord = await getOrAddIconToAtlas(item.iconSrc);
                                } catch (_) { }
                            }

                            state.items.push({
                                id: uid(),
                                title: item.title,
                                body: item.body || "",
                                parent: pIdx,
                                child: cIdx,
                                order: nextOrderNum++,
                                color: (item.color !== undefined) ? item.color : state.currentColor,
                                iconCoord: iconCoord
                            });
                            addedCount++;
                        }
                    }

                    saveState();
                    renderPanel();
                    alert(`Import complete!\nAdded ${addedCount} snippet(s) into [${pName} > ${cName}].`);
                    setStatus(`TagImport: ${addedCount} items added`);
                } catch (e) {
                    alert("Failed to read the file.");
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }

    const ICON_SIZE = 20;
    let pendingIconCoord = null;

    function extractBlockIcon(block) {
        if (!block) return null;
        if (block.inputList) {
            for (const input of block.inputList) {
                if (input.fieldRow) {
                    for (const field of input.fieldRow) {
                        if (field && field.src_) return field.src_;
                        if (field && typeof field.getValue === "function") {
                            const v = field.getValue();
                            if (typeof v === "string" && (v.startsWith("data:image") || v.includes(".svg") || v.includes(".png"))) {
                                return v;
                            }
                        }
                    }
                }
            }
        }
        const svgRoot = block.getSvgRoot && block.getSvgRoot();
        if (svgRoot) {
            const img = svgRoot.querySelector("image");
            if (img) {
                const href = img.getAttribute("href") || img.getAttribute("xlink:href");
                if (href) return href;
            }
            const use = svgRoot.querySelector("use");
            if (use) {
                const ref = use.getAttribute("href") || use.getAttribute("xlink:href");
                if (ref && ref.startsWith("#")) {
                    const sym = document.querySelector(ref);
                    if (sym) {
                        const vb = sym.getAttribute("viewBox") || "0 0 24 24";
                        const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">${sym.innerHTML}</svg>`;
                        return "data:image/svg+xml;utf8," + encodeURIComponent(svgStr);
                    }
                }
            }
        }
        return null;
    }

    function getOrAddIconToAtlas(iconSrc) {
        if (!iconSrc) return Promise.resolve(null);
        if (!state.iconAtlas) {
            state.iconAtlas = { spriteUrl: null, sources: [] };
        }
        const atlas = state.iconAtlas;
        const existingIdx = atlas.sources.indexOf(iconSrc);

        if (existingIdx !== -1) {
            return Promise.resolve({ x: existingIdx * ICON_SIZE, y: 0, w: ICON_SIZE, h: ICON_SIZE });
        }

        return new Promise(resolve => {
            const img = new Image();
            if (!iconSrc.startsWith("data:")) {
                img.crossOrigin = "anonymous";
            }
            img.onload = () => {
                const idx = atlas.sources.length;
                atlas.sources.push(iconSrc);

                const totalWidth = atlas.sources.length * ICON_SIZE;
                const canvas = document.createElement("canvas");
                canvas.width = totalWidth;
                canvas.height = ICON_SIZE;
                const ctx = canvas.getContext("2d");

                if (atlas.spriteUrl) {
                    const oldSprite = new Image();
                    oldSprite.onload = () => {
                        ctx.drawImage(oldSprite, 0, 0);
                        ctx.drawImage(img, idx * ICON_SIZE, 0, ICON_SIZE, ICON_SIZE);
                        atlas.spriteUrl = canvas.toDataURL("image/png");
                        saveState();
                        resolve({ x: idx * ICON_SIZE, y: 0, w: ICON_SIZE, h: ICON_SIZE });
                    };
                    oldSprite.onerror = () => {
                        ctx.drawImage(img, idx * ICON_SIZE, 0, ICON_SIZE, ICON_SIZE);
                        atlas.spriteUrl = canvas.toDataURL("image/png");
                        saveState();
                        resolve({ x: idx * ICON_SIZE, y: 0, w: ICON_SIZE, h: ICON_SIZE });
                    };
                    oldSprite.src = atlas.spriteUrl;
                } else {
                    ctx.drawImage(img, 0, 0, ICON_SIZE, ICON_SIZE);
                    atlas.spriteUrl = canvas.toDataURL("image/png");
                    saveState();
                    resolve({ x: 0, y: 0, w: ICON_SIZE, h: ICON_SIZE });
                }
            };
            img.onerror = () => resolve(null);
            img.src = iconSrc;
        });
    }

    function showFolderMenu(e, type, index) {
        const old = document.getElementById("uiPrompt");
        if (old) old.remove();

        const isParent = (type === "parent");
        const currentName = isParent ? state.parents[index] : state.children[state.filterParent][index];
        const labelTitle = isParent ? "Folder Name (Parent)" : "SubFolder Name (Child)";

        const box = document.createElement("div");
        box.id = "uiPrompt";
        box.style.position = "fixed";
        box.style.left = Math.min(e.clientX, window.innerWidth - 220) + "px";
        box.style.top = Math.min(e.clientY, window.innerHeight - 200) + "px";
        box.style.background = "#1e1e1e";
        box.style.border = "1px solid #444";
        box.style.borderRadius = "6px";
        box.style.padding = "10px";
        box.style.zIndex = 2147483647;
        box.style.color = "#ddd";
        box.style.fontSize = "12px";
        box.style.boxShadow = "0 6px 18px rgba(0,0,0,0.8)";
        box.style.minWidth = "120px";

        const t = document.createElement("div");
        t.textContent = labelTitle;
        t.style.marginBottom = "6px";
        t.style.fontWeight = "bold";

        const input = document.createElement("input");
        input.value = currentName;
        input.style.width = "100%";
        input.style.boxSizing = "border-box";
        input.style.background = "#2a2a2a";
        input.style.border = "1px solid #555";
        input.style.color = "#ddd";
        input.style.padding = "4px";
        input.style.borderRadius = "3px";
        input.style.marginBottom = "8px";

        const rowBtn = document.createElement("div");
        rowBtn.style.display = "flex";
        rowBtn.style.gap = "6px";

        const ok = makeButton("OK", () => {
            const val = input.value.trim();
            if (val) {
                if (isParent) state.parents[index] = val;
                else state.children[state.filterParent][index] = val;
                saveState();
                renderPanel();
            }
            box.remove();
        });
        ok.style.flex = "1";
        ok.style.padding = "4px";

        const cancel = makeButton("Cancel", () => box.remove());
        cancel.style.flex = "1";
        cancel.style.padding = "4px";
        rowBtn.append(ok, cancel);

        const sep = document.createElement("div");
        sep.style.height = "1px";
        sep.style.background = "#444";
        sep.style.margin = "10px 0 8px";

        const copyBtn = makeButton("Folder: Copy", () => {
            if (isParent) {
                folderClipboard = {
                    type: "parent",
                    name: state.parents[index],
                    childrenNames: (state.children[index] || []).slice(),
                    items: state.items.filter(i => i.parent === index).map(i => ({ ...i }))
                };
                setStatus(`Copied parent folder [${state.parents[index]}]`);
            } else {
                folderClipboard = {
                    type: "child",
                    name: state.children[state.filterParent][index],
                    items: state.items.filter(i => i.parent === state.filterParent && i.child === index).map(i => ({ ...i }))
                };
                setStatus(`Copied subfolder [${state.children[state.filterParent][index]}]`);
            }
            box.remove();
        });
        copyBtn.style.width = "100%";
        copyBtn.style.padding = "5px 6px";
        copyBtn.style.marginBottom = "6px";
        copyBtn.style.background = "#2a5298";
        copyBtn.style.fontSize = "11px";
        copyBtn.onmouseenter = () => copyBtn.style.background = "#3b6fc9";
        copyBtn.onmouseleave = () => copyBtn.style.background = "#2a5298";

        const canPaste = folderClipboard && (folderClipboard.type === type);
        const pasteBtn = makeButton("Folder: Paste", () => {
            if (!folderClipboard) return;
            if (folderClipboard.type !== type) {
                alert(`Type mismatch: A ${folderClipboard.type === "parent" ? "parent" : "sub"} folder is currently copied.`);
                return;
            }

            if (!confirm(`Overwrite TAB [${currentName}] with [${folderClipboard.name}]?\nAll existing snippets in this TAB will be replaced.`)) {
                return;
            }

            if (isParent) {
                state.parents[index] = folderClipboard.name;
                if (Array.isArray(folderClipboard.childrenNames)) {
                    state.children[index] = folderClipboard.childrenNames.slice();
                }
                state.items = state.items.filter(i => i.parent !== index);
                folderClipboard.items.forEach(i => {
                    state.items.push({ ...i, id: uid(), parent: index });
                });
                setStatus(`Pasted parent folder [${folderClipboard.name}]`);
            } else {
                const pIdx = state.filterParent;
                state.children[pIdx][index] = folderClipboard.name;
                state.items = state.items.filter(i => !(i.parent === pIdx && i.child === index));
                folderClipboard.items.forEach(i => {
                    state.items.push({ ...i, id: uid(), parent: pIdx, child: index });
                });
                setStatus(`Pasted subfolder [${folderClipboard.name}]`);
            }

            saveState();
            renderPanel();
            box.remove();
        });
        pasteBtn.style.width = "100%";
        pasteBtn.style.padding = "5px 6px";
        pasteBtn.style.background = canPaste ? "#3d4b3d" : "#333";
        pasteBtn.style.color = canPaste ? "#fff" : "#777";
        pasteBtn.style.fontSize = "11px";
        if (canPaste) {
            pasteBtn.onmouseenter = () => pasteBtn.style.background = "#4e6a4e";
            pasteBtn.onmouseleave = () => pasteBtn.style.background = "#3d4b3d";
        }

        const sepColor = document.createElement("div");
        sepColor.style.height = "1px";
        sepColor.style.background = "#444";
        sepColor.style.margin = "8px 0 6px";

        const colorLabel = document.createElement("div");
        colorLabel.textContent = "Text Color (タブ文字色)";
        colorLabel.style.fontSize = "11px";
        colorLabel.style.color = "#aaa";
        colorLabel.style.marginBottom = "4px";

        const colorRow = document.createElement("div");
        colorRow.style.display = "flex";
        colorRow.style.gap = "4px";
        colorRow.style.alignItems = "center";

        const resetColorBtn = makeButton("✕", () => {
            if (isParent) state.parentColors[index] = null;
            else state.childColors[state.filterParent][index] = null;
            saveState();
            renderPanel();
            box.remove();
        });
        resetColorBtn.title = "Default Color";
        resetColorBtn.style.width = "18px";
        resetColorBtn.style.height = "18px";
        resetColorBtn.style.padding = "0";
        resetColorBtn.style.fontSize = "10px";
        resetColorBtn.style.background = "#333";
        resetColorBtn.style.color = "#888";
        colorRow.appendChild(resetColorBtn);

        state.palette.slice(0, COLOR_COUNT).forEach((c, cIdx) => {
            const b = makeButton("", () => {
                if (isParent) state.parentColors[index] = cIdx;
                else state.childColors[state.filterParent][index] = cIdx;
                saveState();
                renderPanel();
                box.remove();
            });
            b.style.background = c;
            b.style.width = "18px";
            b.style.height = "18px";
            b.style.padding = "0";
            b.style.borderRadius = "2px";
            b.style.border = "1px solid #222";
            b.style.cursor = "pointer";
            colorRow.appendChild(b);
        });

        box.append(t, input, rowBtn, sep, copyBtn, pasteBtn, sepColor, colorLabel, colorRow);
        document.body.appendChild(box);
        input.focus();
        input.select();

        setTimeout(() => {
            const onOutside = (ev) => {
                if (!box.contains(ev.target)) {
                    box.remove();
                    document.removeEventListener("mousedown", onOutside);
                }
            };
            document.addEventListener("mousedown", onOutside);
        }, 10);
    }

    function showSettingsMenu(anchorBtn) {
        const old = document.getElementById("jcs-settings-menu");
        if (old) { old.remove(); return; }

        const rect = anchorBtn.getBoundingClientRect();
        const menu = document.createElement("div");
        menu.id = "jcs-settings-menu";
        menu.style.left = Math.min(rect.left, window.innerWidth - 220) + "px";
        menu.style.top = (rect.bottom + 4) + "px";

        const expBtn = makeButton("EXPORT", () => { exportData(); menu.remove(); }, "jcs-menu-btn");
        const impBtn = makeButton("IMPORT", () => { importData(); menu.remove(); }, "jcs-menu-btn");

        const tagsExpBtn = makeButton("TagsExport (Selected Tag)", () => {
            exportCurrentTagData();
            menu.remove();
        }, "jcs-menu-btn");
        tagsExpBtn.style.background = "#3d4b3d";
        tagsExpBtn.onmouseenter = () => tagsExpBtn.style.background = "#4e6a4e";
        tagsExpBtn.onmouseleave = () => tagsExpBtn.style.background = "#3d4b3d";

        const tagsImpBtn = makeButton("TagsImport (Append to Tag)", () => {
            importCurrentTagData();
            menu.remove();
        }, "jcs-menu-btn");
        tagsImpBtn.style.background = "#3d4b3d";
        tagsImpBtn.onmouseenter = () => tagsImpBtn.style.background = "#4e6a4e";
        tagsImpBtn.onmouseleave = () => tagsImpBtn.style.background = "#3d4b3d";

        const sep1 = document.createElement("div");
        sep1.className = "jcs-menu-sep";

        readSyncSetting();
        const syncRow = document.createElement("label");
        syncRow.className = "jcs-menu-row jcs-sync-row";
        syncRow.style.cursor = "pointer";
        syncRow.title = "ON: 親/子タブを開くたびに共有IndexedDB/localStorageの最新データを読み込む";

        const syncLabel = document.createElement("span");
        syncLabel.textContent = "同期";

        const syncCheck = document.createElement("input");
        syncCheck.type = "checkbox";
        syncCheck.checked = syncOnTabOpen;
        syncCheck.style.cursor = "pointer";
        syncCheck.addEventListener("change", () => {
            writeSyncSetting(syncCheck.checked);
            setStatus(syncCheck.checked ? "Tab Sync: ON" : "Tab Sync: OFF");
        });

        syncRow.append(syncLabel, syncCheck);

        const pRow = document.createElement("div");
        pRow.className = "jcs-menu-row";
        const pLabel = document.createElement("span");
        pLabel.textContent = "PARENT";
        const pCounter = document.createElement("div");
        pCounter.className = "jcs-counter";
        const pVal = document.createElement("span");
        pVal.textContent = state.parentCount;

        const pMinus = makeButton("-", () => {
            if (state.parentCount > 1) {
                state.parentCount--;
                pVal.textContent = state.parentCount;
                if (state.filterParent >= state.parentCount) state.filterParent = state.parentCount - 1;
                saveState();
                renderPanel();
            }
        });
        const pPlus = makeButton("+", () => {
            if (state.parentCount < 8) {
                state.parentCount++;
                while (state.parents.length < state.parentCount) {
                    const char = String.fromCharCode(65 + state.parents.length);
                    state.parents.push(char);
                    const newChildren = [];
                    for (let c = 0; c < 8; c++) newChildren.push(char + "-" + (c + 1));
                    state.children.push(newChildren);
                }
                pVal.textContent = state.parentCount;
                saveState();
                renderPanel();
            }
        });
        pCounter.append(pMinus, pVal, pPlus);
        pRow.append(pLabel, pCounter);

        const cRow = document.createElement("div");
        cRow.className = "jcs-menu-row";
        const cLabel = document.createElement("span");
        cLabel.textContent = "CHILD";
        const cCounter = document.createElement("div");
        cCounter.className = "jcs-counter";
        const cVal = document.createElement("span");
        cVal.textContent = state.childCount;

        const cMinus = makeButton("-", () => {
            if (state.childCount > 1) {
                state.childCount--;
                cVal.textContent = state.childCount;
                state.filterChild = state.filterChild.map(v => Math.min(v, state.childCount - 1));
                saveState();
                renderPanel();
            }
        });
        const cPlus = makeButton("+", () => {
            if (state.childCount < 8) {
                state.childCount++;
                state.children.forEach((arr, pIdx) => {
                    const pChar = state.parents[pIdx] || String.fromCharCode(65 + pIdx);
                    while (arr.length < state.childCount) {
                        arr.push(pChar + "-" + (arr.length + 1));
                    }
                });
                cVal.textContent = state.childCount;
                saveState();
                renderPanel();
            }
        });
        cCounter.append(cMinus, cVal, cPlus);
        cRow.append(cLabel, cCounter);

        const sep2 = document.createElement("div");
        sep2.className = "jcs-menu-sep";

        const resetBtn = makeButton("RESET ALL DATA", () => {
            if (confirm("Reset all snippets, categories, and settings to default?\n(This action cannot be undone.)")) {
                state = cloneDefault();
                saveState();
                renderPanel();
                setStatus("Reset complete");
                menu.remove();
            }
        }, "jcs-menu-btn");
        resetBtn.style.background = "#5a2020";
        resetBtn.onmouseenter = () => resetBtn.style.background = "#ad1a1a";
        resetBtn.onmouseleave = () => resetBtn.style.background = "#5a2020";

        menu.append(expBtn, impBtn, tagsExpBtn, tagsImpBtn, sep1, syncRow, pRow, cRow, sep2, resetBtn);
        document.body.appendChild(menu);

        setTimeout(() => {
            const onOutside = (e) => {
                if (!menu.contains(e.target) && e.target !== anchorBtn) {
                    menu.remove();
                    document.removeEventListener("mousedown", onOutside);
                }
            };
            document.addEventListener("mousedown", onOutside);
        }, 10);
    }

    function renderPanel() {
        if (!panel) return;

        ensureStateIntegrity();

        const preservedTitle = titleEl ? titleEl.value : null;
        const preservedBody = bodyEl ? bodyEl.value : null;

        const prevTreeNav = panel.querySelector(".jcs-tree-nav");
        if (prevTreeNav && prevTreeNav.scrollTop > 0) {
            lastTreeNavScrollTop = prevTreeNav.scrollTop;
        }

        panel.innerHTML = "";

        const container = document.createElement("div");
        container.className = "jcs-container";

        const head = document.createElement("div");
        head.className = "jcs-head";
        const ttl = document.createElement("div");
        ttl.className = "jcs-title";
        ttl.textContent = isCollapsed ? "🐛JS Stock ▶" : "🐛JS Stock ▼";

        attachTitleDragAndToggle(ttl);

        const tools = document.createElement("div");
        tools.className = "jcs-tools";

        const canUndo = (undoStack.length > 0);
        const undoBtn = makeButton("↩️", () => {
            if (undoStack.length > 0) doUndo();
        }, "jcs-history-btn jcs-history-undo" + (canUndo ? "" : " disabled"));
        undoBtn.title = canUndo ? `Undo (元に戻す) [残り${undoStack.length}回]` : "Undo (履歴なし)";
        undoBtn.disabled = !canUndo;

        const canRedo = (redoStack.length > 0);
        const redoBtn = makeButton("↪️", () => {
            if (redoStack.length > 0) doRedo();
        }, "jcs-history-btn jcs-history-redo" + (canRedo ? "" : " disabled"));
        redoBtn.title = canRedo ? `Redo (やり直す) [残り${redoStack.length}回]` : "Redo (履歴なし)";
        redoBtn.disabled = !canRedo;

        const gearBtn = makeButton("⚙️", (e) => {
            e.stopPropagation();
            showSettingsMenu(gearBtn);
        }, "jcs-gear");
        gearBtn.title = "Settings (EXPORT / IMPORT / Tab Count)";

        const pinBtn = makeButton(isPinned ? "🔒️" : "🔓️", () => {
            isPinned = !isPinned;
            renderPanel();
        }, "jcs-pin" + (isPinned ? "" : " unlocked"));
        pinBtn.title = isPinned ? "Locked (Keep open)" : "Unlocked (Auto close)";

        const close = makeButton("✕", closePanel, "jcs-close");
        close.title = "Close";

        tools.append(undoBtn, redoBtn, gearBtn, pinBtn, close);
        head.append(ttl, tools);

        if (isCollapsed) {
            panel.classList.add("collapsed");
            container.appendChild(head);
            panel.appendChild(container);
            return;
        }

        panel.classList.remove("collapsed");
        if (state.windowBounds) {
            if (state.windowBounds.width) panel.style.width = state.windowBounds.width + "px";
            if (state.windowBounds.height) panel.style.height = state.windowBounds.height + "px";
        } else if (savedPanelHeight) {
            panel.style.height = savedPanelHeight;
        }

        const parentTabs = document.createElement("div");
        parentTabs.className = "jcs-tabs";
        state.parents.slice(0, state.parentCount).forEach((name, i) => {
            const isActive = (searchScope === "TAB" && state.filterParent === i);
            const b = makeButton(name, async () => {
                await syncBeforeTabOpen();
                searchScope = "TAB";
                state.filterParent = i;
                if (state.filterParent >= state.parentCount) {
                    state.filterParent = Math.max(0, state.parentCount - 1);
                }
                renderPanel();
            }, "jcs-tab" + (isActive ? " active" : ""));
            b.oncontextmenu = e => {
                e.preventDefault();
                showFolderMenu(e, "parent", i);
            };
            parentTabs.appendChild(b);
        });

        const childTabs = document.createElement("div");
        childTabs.className = "jcs-tabs jcs-child";
        (state.children[state.filterParent] || []).slice(0, state.childCount).forEach((name, i) => {
            const isActive = (searchScope === "TAB" && state.filterChild[state.filterParent] === i);
            const b = makeButton(name, async () => {
                await syncBeforeTabOpen();
                searchScope = "TAB";
                if (!Array.isArray(state.filterChild)) {
                    state.filterChild = Array(8).fill(0);
                }
                if (state.filterParent >= state.parentCount) {
                    state.filterParent = Math.max(0, state.parentCount - 1);
                }
                state.filterChild[state.filterParent] = i;
                renderPanel();
            }, "jcs-tab" + (isActive ? " active" : ""));
            b.oncontextmenu = e => {
                e.preventDefault();
                showFolderMenu(e, "child", i);
            };
            childTabs.appendChild(b);
        });

        const colorTabs = document.createElement("div");
        colorTabs.className = "jcs-tabs jcs-colors";
        state.palette.slice(0, COLOR_COUNT).forEach((c, i) => {
            const b = makeButton("", () => {
                state.currentColor = i;
                renderPanel();
            }, "jcs-tab" + (state.currentColor === i ? " active" : ""));
            b.style.background = c;
            b.title = "Color " + (i + 1) + " — right click to change";
            b.oncontextmenu = e => {
                e.preventDefault();
                const picker = document.createElement("input");
                picker.type = "color";
                picker.value = state.palette[i];
                picker.onchange = () => {
                    state.palette[i] = picker.value;
                    saveState();
                    renderPanel();
                };
                picker.click();
            };
            colorTabs.appendChild(b);
        });

        const inputSection = document.createElement("div");
        inputSection.className = "jcs-input-section";
        const inputRow = document.createElement("div");
        inputRow.className = "jcs-input-row";
        const inputLeft = document.createElement("div");
        inputLeft.className = "jcs-input-left";

        const titleWrap = document.createElement("div");
        titleWrap.className = "jcs-input-wrapper";
        titleWrap.style.display = "flex";
        titleWrap.style.alignItems = "center";
        titleWrap.style.position = "relative";

        inputIconPreview = document.createElement("div");
        inputIconPreview.className = "jcs-input-icon-preview";
        inputIconPreview.style.width = "20px";
        inputIconPreview.style.height = "20px";
        inputIconPreview.style.flexShrink = "0";
        inputIconPreview.style.marginRight = "6px";
        inputIconPreview.style.borderRadius = "2px";
        inputIconPreview.style.display = "none";
        titleWrap.appendChild(inputIconPreview);

        titleEl = document.createElement("input");
        titleEl.placeholder = "🏷️Code name";
        titleEl.style.flex = "1";
        const clearTitle = makeButton("✕", () => {
            titleEl.value = "";
            pendingIconCoord = null;
            updateInputIconPreview();
            titleEl.focus();
        }, "jcs-clear");
        titleWrap.append(titleEl, clearTitle);
        updateInputIconPreview();

        const bodyWrap = document.createElement("div");
        bodyWrap.className = "jcs-input-wrapper";
        bodyEl = document.createElement("textarea");
        bodyEl.placeholder = "📝Code body";
        bodyEl.addEventListener("paste", (e) => {
            const clipboardData = (e.clipboardData || window.clipboardData).getData('text');
            if (titleEl.value.trim() !== "") return;
            try {
                const data = JSON.parse(clipboardData);
                if (data.type) titleEl.value = data.type;
            } catch (_) { }
        });
        const clearBody = makeButton("✕", () => {
            bodyEl.value = "";
            bodyEl.focus();
        }, "jcs-clear");
        bodyWrap.append(bodyEl, clearBody);

        const inputRight = document.createElement("div");
        inputRight.className = "jcs-input-right";
        inputRight.append(
            makeButton(hasEditingId() ? "UPDATE" : "ADD", addItem, "jcs-add"),
            makeButton("CANCEL", cancelEdit, "jcs-cancel")
        );
        inputLeft.append(titleWrap, bodyWrap, inputRight);
        inputRow.appendChild(inputLeft);
        inputSection.appendChild(inputRow);

        const toggle = makeButton(inputHidden ? "≡ NEW ENTRY ≡" : "≡ CLOSE ≡", () => {
            inputHidden = !inputHidden;
            if (inputHidden) {
                editingIdValue = null;
                lastEditingId = null;
                pendingIconCoord = null;
                pendingBlockTitle = null;
                pendingBlockBody = null;
            }
            renderPanel();
            if (!inputHidden && titleEl) titleEl.focus();
        });
        toggle.id = "jcs-toggle-input";
        inputSection.appendChild(toggle);

        if (inputHidden) {
            inputRow.classList.add("jcs-hidden");
            colorTabs.classList.add("jcs-hidden");
        } else if (hasEditingId()) {
            const item = state.items.find(x => x && String(x.id) === String(editingIdValue));
            if (item) {
                titleEl.value = item.title || "";
                bodyEl.value = item.body || "";
                titleEl.style.borderLeft = "6px solid " + (state.palette[state.currentColor] || "#fff");
                titleEl.style.paddingLeft = "6px";
            }
        } else {
            lastEditingId = null;

            if (interactionMode === "blockEntry" && pendingBlockTitle !== null) {
                titleEl.value = pendingBlockTitle;
                bodyEl.value = pendingBlockBody;
                pendingBlockTitle = null;
                pendingBlockBody = null;
            } else {
                if (preservedTitle !== null) titleEl.value = preservedTitle;
                if (preservedBody !== null) bodyEl.value = preservedBody;
            }

            titleEl.style.borderLeft = "6px solid " + state.palette[state.currentColor];
            titleEl.style.paddingLeft = "6px";
        }

        const filter = document.createElement("div");
        filter.className = "jcs-filter";
        const fc = document.createElement("div");
        fc.className = "jcs-tabs jcs-filter-colors";

        const all = makeButton("ALL", () => {
            state.filterColor = null;
            renderPanel();
        }, "jcs-tab" + (state.filterColor === null ? " active" : ""));
        fc.appendChild(all);

        state.palette.slice(0, COLOR_COUNT).forEach((c, i) => {
            const b = makeButton("", () => {
                state.filterColor = state.filterColor === i ? null : i;
                renderPanel();
            }, "jcs-tab" + (state.filterColor === i ? " active" : ""));
            b.style.background = c;
            fc.appendChild(b);
        });

        const searchRow = document.createElement("div");
        searchRow.style.display = "flex";
        searchRow.style.gap = "4px";
        searchRow.style.marginTop = "3px";
        searchRow.style.alignItems = "center";

        const scopeBtn = makeButton(searchScope, () => {
            searchScope = (searchScope === "TAB") ? "ALL" : "TAB";
            renderPanel();
        }, "jcs-scope-btn" + (searchScope === "ALL" ? " active" : ""));
        scopeBtn.title = (searchScope === "TAB") ? "Search in current tab" : "Search in ALL data";

        const searchWrap = document.createElement("div");
        searchWrap.className = "jcs-input-wrapper";
        searchWrap.style.flex = "1";
        searchWrap.style.position = "relative";
        searchWrap.style.display = "flex";
        searchWrap.style.alignItems = "center";

        searchEl = document.createElement("input");
        searchEl.className = "jcs-search";
        searchEl.style.flex = "1";
        searchEl.style.marginTop = "0";
        searchEl.placeholder = (searchScope === "ALL") ? "🔎search in ALL data..." : "🔎search in current tab...";

        const clearSearch = makeButton("✕", () => {
            searchEl.value = "";
            clearSearch.style.display = "none";
            renderList();
            searchEl.focus();
        }, "jcs-clear");
        clearSearch.style.display = "none";

        searchEl.oninput = () => {
            clearSearch.style.display = searchEl.value.trim() ? "block" : "none";
            renderList();
        };

        searchWrap.append(searchEl, clearSearch);
        searchRow.append(scopeBtn, searchWrap);
        filter.append(fc, searchRow);

        const bodyHead = document.createElement("div");
        bodyHead.className = "jcs-body-head";
        const treeToggleBtn = makeButton(showTreeNav ? "TAB ▼" : "TAB ▶", () => {
            showTreeNav = !showTreeNav;
            renderPanel();
        }, "jcs-tree-toggle");
        treeToggleBtn.title = "Toggle left tree sidebar";

        const bodyTitle = document.createElement("span");
        bodyTitle.className = "jcs-body-title";
        bodyTitle.textContent = "CodeLists";

        // ★ フォントサイズ変更ボタン（12〜30px）
        if (!state.listFontSize) state.listFontSize = 15;
        const fontCtrl = document.createElement("div");
        fontCtrl.className = "jcs-font-ctrl";
        const btnFontDec = makeButton("◀", () => {
            if (state.listFontSize > 12) {
                state.listFontSize--;
                saveState();
                renderPanel();
            }
        });
        btnFontDec.title = "Decrease font size";
        const fontVal = document.createElement("span");
        fontVal.className = "jcs-font-val";
        fontVal.textContent = state.listFontSize + "px";
        const btnFontInc = makeButton("▶", () => {
            if (state.listFontSize < 30) {
                state.listFontSize++;
                saveState();
                renderPanel();
            }
        });
        btnFontInc.title = "Increase font size";
        fontCtrl.append(btnFontDec, fontVal, btnFontInc);

        bodyHead.append(treeToggleBtn, bodyTitle, fontCtrl);

        // --- メイン領域（左右スプリッターとフォントサイズの反映） ---
        const mainPane = document.createElement("div");
        mainPane.className = "jcs-main-pane";

        if (showTreeNav) {
            const treeNav = document.createElement("div");
            treeNav.className = "jcs-tree-nav";
            // ★ 初期幅をコンパクトな85pxに設定（余白をなくす）
            const currentWidth = state.treeNavWidth !== undefined ? state.treeNavWidth : 85;
            treeNav.style.width = currentWidth + "px";

            for (let p = 0; p < state.parentCount; p++) {
                const pName = state.parents[p] || ("P" + p);
                if (String(pName).trim() === "-") continue;

                const pEl = document.createElement("div");
                pEl.className = "jcs-tree-parent";
                pEl.textContent = pName;
                pEl.style.fontSize = Math.max(10, (state.listFontSize || 15) - 3) + "px";

                const pColorIdx = state.parentColors ? state.parentColors[p] : null;
                if (pColorIdx !== null && pColorIdx !== undefined && state.palette[pColorIdx]) {
                    pEl.style.color = state.palette[pColorIdx];
                }

                pEl.onclick = async () => {
                    await syncBeforeTabOpen();
                    searchScope = "TAB";
                    state.filterParent = p;
                    if (state.filterParent >= state.parentCount) {
                        state.filterParent = Math.max(0, state.parentCount - 1);
                    }
                    renderPanel();
                };
                pEl.oncontextmenu = (e) => {
                    e.preventDefault();
                    showFolderMenu(e, "parent", p);
                };
                treeNav.appendChild(pEl);

                const cList = state.children[p] || [];
                for (let c = 0; c < state.childCount; c++) {
                    const cName = cList[c] || (state.parents[p] + "-" + (c + 1));
                    if (String(cName).trim() === "-") continue;

                    const cEl = document.createElement("div");
                    const isActive = (searchScope === "TAB" && state.filterParent === p && state.filterChild[p] === c);
                    cEl.className = "jcs-tree-child" + (isActive ? " active" : "");
                    cEl.textContent = cName;
                    cEl.style.fontSize = (state.listFontSize || 15) + "px";

                    const cColorIdx = (state.childColors && state.childColors[p]) ? state.childColors[p][c] : null;
                    if (cColorIdx !== null && cColorIdx !== undefined && state.palette[cColorIdx]) {
                        cEl.style.color = state.palette[cColorIdx];
                    }

                    cEl.onclick = async () => {
                        await syncBeforeTabOpen();
                        searchScope = "TAB";
                        state.filterParent = p;
                        if (!Array.isArray(state.filterChild)) {
                            state.filterChild = Array(8).fill(0);
                        }
                        if (state.filterParent >= state.parentCount) {
                            state.filterParent = Math.max(0, state.parentCount - 1);
                        }
                        if (state.filterParent < state.filterChild.length) {
                            state.filterChild[state.filterParent] = c;
                        }
                        renderPanel();
                    };
                    cEl.oncontextmenu = (e) => {
                        e.preventDefault();
                        showFolderMenu(e, "child", c);
                    };
                    treeNav.appendChild(cEl);
                }
            }

            mainPane.appendChild(treeNav);

            treeNav.addEventListener("scroll", () => {
                lastTreeNavScrollTop = treeNav.scrollTop;
            }, { passive: true });

            treeNav.scrollTop = lastTreeNavScrollTop;

            // ★ スプリッター（最小35px〜最大300pxまで自在に縮小・拡大可能に）
            const splitter = document.createElement("div");
            splitter.className = "jcs-splitter";
            splitter.title = "Drag to resize";

            splitter.addEventListener("mousedown", (e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                splitter.classList.add("active");
                const startX = e.clientX;
                const startWidth = treeNav.getBoundingClientRect().width;

                const onMouseMove = (ev) => {
                    // ★ 最小35pxまで縮められるように制限を緩和
                    const newWidth = Math.max(35, Math.min(300, startWidth + (ev.clientX - startX)));
                    treeNav.style.width = newWidth + "px";
                    state.treeNavWidth = newWidth;
                };

                const onMouseUp = () => {
                    splitter.classList.remove("active");
                    document.removeEventListener("mousemove", onMouseMove);
                    document.removeEventListener("mouseup", onMouseUp);
                    saveState();
                };

                document.addEventListener("mousemove", onMouseMove);
                document.addEventListener("mouseup", onMouseUp);
            });

            mainPane.appendChild(splitter);
        }

        listEl = document.createElement("div");
        listEl.className = "jcs-list";
        mainPane.appendChild(listEl);

        const foot = document.createElement("div");
        foot.className = "jcs-foot";
        statusEl = document.createElement("span");
        statusEl.className = "jcs-status";
        statusEl.textContent = "Ready";
        foot.appendChild(statusEl);

        container.append(head, parentTabs, childTabs, colorTabs, inputSection, filter, bodyHead, mainPane, foot);
        panel.appendChild(container);

        renderList();
    }

    function hasEditingId() { return !!editingIdValue; }

    // ★ リスト項目名（タイトル）のインライン右クリック変更処理
    function startInlineRename(item, nameEl, titleTextEl) {
        if (nameEl.querySelector(".jcs-inline-rename")) return;

        const originalTitle = item.title || "";
        titleTextEl.style.display = "none";

        const editInput = document.createElement("input");
        editInput.type = "text";
        editInput.className = "jcs-inline-rename";
        editInput.value = originalTitle;
        editInput.style.flex = "1";
        editInput.style.background = "#1a1a1a";
        editInput.style.color = "#fff";
        editInput.style.border = "1px solid #4da3ff";
        editInput.style.borderRadius = "2px";
        editInput.style.fontSize = "15px";
        editInput.style.padding = "1px 4px";
        editInput.style.margin = "0";
        editInput.style.outline = "none";
        editInput.style.boxSizing = "border-box";
        editInput.style.minWidth = "60px";

        // マウスやコンテキストメニューの伝播を抑止
        editInput.addEventListener("mousedown", e => e.stopPropagation());
        editInput.addEventListener("click", e => e.stopPropagation());
        editInput.addEventListener("contextmenu", e => e.stopPropagation());

        let finished = false;
        const commit = () => {
            if (finished) return;
            finished = true;
            const newTitle = editInput.value.trim();
            if (newTitle && newTitle !== originalTitle) {
                item.title = newTitle;
                saveState();
            }
            renderList();
        };

        const cancel = () => {
            if (finished) return;
            finished = true;
            renderList();
        };

        editInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                commit();
            } else if (e.key === "Escape") {
                e.preventDefault();
                cancel();
            }
        });

        editInput.addEventListener("blur", () => {
            commit();
        });

        nameEl.appendChild(editInput);

        // フォーカスして、カーソルを一番左に設定
        editInput.focus();
        const len = editInput.value.length;
        if (typeof editInput.setSelectionRange === "function") {
            editInput.setSelectionRange(len, len);
        }
    }

    function renderList() {
        if (!listEl) return;
        listEl.innerHTML = "";

        const currentTabKey = `${state.filterParent}_${state.filterChild[state.filterParent]}`;

        listEl.addEventListener("scroll", () => {
            listScrollPositions.set(currentTabKey, listEl.scrollTop);
        }, { passive: true });

        const q = searchEl ? searchEl.value.toLowerCase() : "";
        let filtered;

        if (searchScope === "ALL") {
            filtered = state.items.filter(item =>
                (state.filterColor === null || (item.color || 0) === state.filterColor) &&
                String(item.title).toLowerCase().includes(q)
            );
        } else {
            filtered = state.items.filter(item =>
                item.parent === state.filterParent &&
                item.child === state.filterChild[state.filterParent] &&
                (state.filterColor === null || (item.color || 0) === state.filterColor) &&
                String(item.title).toLowerCase().includes(q)
            );
        }
        filtered.sort((a, b) => (a.order || 0) - (b.order || 0));

        filtered.forEach(item => {
            const id = String(item.id);
            const row = document.createElement("div");
            row.className = "jcs-item" + (selectedIds.has(id) ? " selected" : "");
            row.dataset.id = id;

            if (cutIds.has(id)) {
                row.style.opacity = "0.4";
                row.style.border = "1px dashed #888";
            }

            const drag = document.createElement("button");
            drag.className = "jcs-drag" + (selectedIds.has(id) ? " active" : "");
            drag.textContent = "≡";
            drag.draggable = true;

            // 一番左のドラッグハンドル上の右クリックは従来通りのメニュー
            drag.oncontextmenu = (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!selectedIds.has(id)) {
                    selectedIds.clear();
                    selectedIds.add(id);
                    lastSelected = id;
                    renderList();
                }
                showMenu(e, item);
            };

            drag.onclick = (e) => {
                e.stopPropagation();
                let group = filtered.map(i => String(i.id));
                if (e.shiftKey && lastSelected) {
                    let a = group.indexOf(lastSelected);
                    let b = group.indexOf(id);
                    selectedIds.clear();
                    let start = Math.min(a, b), end = Math.max(a, b);
                    for (let i = start; i <= end; i++) selectedIds.add(group[i]);
                } else if (e.ctrlKey) {
                    if (selectedIds.has(id)) selectedIds.delete(id);
                    else { selectedIds.add(id); lastSelected = id; }
                } else {
                    if (selectedIds.has(id)) {
                        selectedIds.delete(id);
                        lastSelected = null;
                    } else {
                        selectedIds.clear();
                        selectedIds.add(id);
                        lastSelected = id;
                    }
                }
                renderList();
            };

            drag.ondragstart = () => {
                if (!selectedIds.has(id)) {
                    selectedIds.clear();
                    selectedIds.add(id);
                }
                document.querySelectorAll(".jcs-item").forEach(el => {
                    if (selectedIds.has(el.dataset.id)) el.classList.add("dragging");
                });
            };

            drag.ondragend = () => {
                document.querySelectorAll(".jcs-item").forEach(el => {
                    el.classList.remove("dragging", "dragTarget");
                });
            };

            row.ondragover = (e) => {
                e.preventDefault();
                row.classList.add("dragTarget");
            };
            row.ondragleave = () => {
                row.classList.remove("dragTarget");
            };
            row.ondrop = (e) => {
                e.preventDefault();
                document.querySelectorAll(".jcs-item").forEach(el => el.classList.remove("dragTarget"));
                let group = state.items.filter(i =>
                    i.parent === state.filterParent &&
                    i.child === state.filterChild[state.filterParent]
                );
                group.sort((a, b) => (a.order || 0) - (b.order || 0));

                let moving = group.filter(i => selectedIds.has(String(i.id)));
                if (moving.length === 0 || selectedIds.has(id)) return;

                let targetIndex = group.findIndex(i => String(i.id) === id);
                let targetItem = group[targetIndex];
                let removedBefore = moving.filter(i => (i.order || 0) < (targetItem.order || 0)).length;
                targetIndex -= removedBefore;

                let remain = group.filter(i => !selectedIds.has(String(i.id)));
                remain.splice(targetIndex, 0, ...moving);
                for (let i = 0; i < remain.length; i++) remain[i].order = i;

                selectedIds.clear();
                lastSelected = null;
                saveState();
                renderList();
            };

            const name = document.createElement("div");
            name.className = "jcs-name";
            name.style.fontSize = (state.listFontSize || 15) + "px"; // ★ フォントサイズを反映
            name.style.borderLeftColor = state.palette[item.color || 0];

            if (item.iconCoord && state.iconAtlas && state.iconAtlas.spriteUrl) {
                const iconEl = document.createElement("div");
                iconEl.style.width = item.iconCoord.w + "px";
                iconEl.style.height = item.iconCoord.h + "px";
                iconEl.style.backgroundImage = `url("${state.iconAtlas.spriteUrl}")`;
                iconEl.style.backgroundPosition = `-${item.iconCoord.x}px -${item.iconCoord.y}px`;
                iconEl.style.backgroundRepeat = "no-repeat";
                iconEl.style.flexShrink = "0";
                iconEl.style.marginRight = "6px";
                iconEl.style.borderRadius = "2px";
                name.appendChild(iconEl);
            }

            const titleText = document.createElement("span");
            titleText.textContent = item.title;
            name.appendChild(titleText);

            if (searchScope === "ALL") {
                const pName = state.parents[item.parent] || ("P" + item.parent);
                const cName = (state.children[item.parent] && state.children[item.parent][item.child]) || ("C" + item.child);
                const badge = document.createElement("span");
                badge.className = "jcs-tag-badge";
                badge.textContent = `${pName} > ${cName}`;
                name.appendChild(badge);
            }

            attachDragOutListener(item, name);

            // ★ リスト項目上での右クリックでインライン名称変更を開始
            name.oncontextmenu = (e) => {
                e.preventDefault();
                e.stopPropagation();
                startInlineRename(item, name, titleText);
            };

            const actions = document.createElement("div");
            actions.className = "jcs-actions";
            actions.append(
                makeButton("EDIT", (e) => { e.stopPropagation(); editItem(item); }, "jcs-btn-edit"),
                makeButton("✕", (e) => {
                    e.stopPropagation();
                    if (!selectedIds.has(String(item.id))) {
                        selectedIds.clear();
                        selectedIds.add(String(item.id));
                    }
                    if (confirm("Delete this snippet?")) {
                        state.items = state.items.filter(i => !selectedIds.has(String(i.id)));
                        selectedIds.clear();
                        lastSelected = null;
                        reorderGroup(state.filterParent, state.filterChild[state.filterParent]);
                        saveState();
                        renderList();
                    }
                }, "jcs-btn-del")
            );

            row.append(drag, name, actions);
            listEl.appendChild(row);
        });

        let endDrop = document.createElement("div");
        endDrop.style.height = "16px";
        endDrop.style.marginTop = "2px";
        endDrop.oncontextmenu = (e) => {
            e.preventDefault();
            showMenu(e, null);
        };
        endDrop.ondragover = (e) => {
            e.preventDefault();
            endDrop.style.borderTop = "2px solid #4a7bd4";
        };
        endDrop.ondragleave = () => {
            endDrop.style.borderTop = "none";
        };
        endDrop.ondrop = (e) => {
            e.preventDefault();
            endDrop.style.borderTop = "none";
            let group = state.items.filter(i =>
                i.parent === state.filterParent &&
                i.child === state.filterChild[state.filterParent]
            );
            group.sort((a, b) => (a.order || 0) - (b.order || 0));
            let moving = group.filter(i => selectedIds.has(String(i.id)));
            let remain = group.filter(i => !selectedIds.has(String(i.id)));
            remain.push(...moving);
            for (let i = 0; i < remain.length; i++) remain[i].order = i;

            selectedIds.clear();
            lastSelected = null;
            saveState();
            renderList();
        };
        listEl.appendChild(endDrop);

        if (scrollToBottomOnRender && listEl) {
            scrollToBottomOnRender = false;
            requestAnimationFrame(() => {
                if (listEl) {
                    listEl.scrollTop = listEl.scrollHeight;
                    listScrollPositions.set(currentTabKey, listEl.scrollTop);
                }
            });
        } else if (listEl) {
            const targetScrollTop = listScrollPositions.get(currentTabKey) || 0;
            listEl.scrollTop = targetScrollTop;
            requestAnimationFrame(() => {
                if (listEl) listEl.scrollTop = targetScrollTop;
            });
        }

        if (!filtered.length) {
            const empty = document.createElement("div");
            empty.style.padding = "20px";
            empty.style.textAlign = "center";
            empty.style.color = "#888";
            empty.textContent = "No snippets";
            listEl.appendChild(empty);
        }
    }

    function showMenu(e, targetItem) {
        const old = document.getElementById("popupMenu");
        if (old) old.remove();

        const menu = document.createElement("div");
        menu.id = "popupMenu";
        menu.style.position = "fixed";
        let left = e.clientX, top = e.clientY;
        const menuWidth = 140, menuHeight = 160;
        if (left + menuWidth > window.innerWidth) left = window.innerWidth - menuWidth - 5;
        if (top + menuHeight > window.innerHeight) top = window.innerHeight - menuHeight - 5;

        menu.style.left = left + "px";
        menu.style.top = top + "px";
        menu.style.background = "#2a2a2a";
        menu.style.border = "1px solid #555";
        menu.style.borderRadius = "4px";
        menu.style.boxShadow = "0 4px 14px rgba(0,0,0,0.7)";
        menu.style.zIndex = 2147483647;
        menu.style.fontSize = "13px";

        function addOption(name, fn, isDanger) {
            const b = document.createElement("div");
            b.textContent = name;
            b.style.cursor = "pointer";
            b.style.padding = "6px 20px";
            if (isDanger) b.style.color = "#ff6b6b";
            b.onmouseenter = () => b.style.background = isDanger ? "#5a2020" : "#3a3a3a";
            b.onmouseleave = () => b.style.background = "";
            b.onclick = () => {
                fn();
                renderList();
                menu.remove();
            };
            menu.appendChild(b);
        }

        addOption("Copy", () => {
            internalClipboard = state.items
                .filter(i => selectedIds.has(String(i.id)))
                .map(i => ({ ...i }));
            clipboardMode = "copy";
            cutIds.clear();
            setStatus("Copied " + internalClipboard.length + " items to stock clipboard");
        });

        addOption("Cut", () => {
            internalClipboard = state.items.filter(i => selectedIds.has(String(i.id)));
            clipboardMode = "cut";
            cutIds = new Set(internalClipboard.map(i => String(i.id)));
            setStatus("Cut " + internalClipboard.length + " items");
        });

        addOption("Paste", () => {
            pasteItems(targetItem);
        });

        addOption("Delete", () => {
            const count = selectedIds.size;
            if (count === 0) return;
            if (confirm(`Delete ${count} selected item(s)?`)) {
                state.items = state.items.filter(i => !selectedIds.has(String(i.id)));
                selectedIds.clear();
                lastSelected = null;
                reorderGroup(state.filterParent, state.filterChild[state.filterParent]);
                saveState();
                renderList();
                setStatus(`Deleted ${count} items`);
            }
        }, true);

        document.body.appendChild(menu);

        setTimeout(() => {
            const onOutside = (ev) => {
                if (!menu.contains(ev.target)) {
                    menu.remove();
                    document.removeEventListener("mousedown", onOutside);
                }
            };
            document.addEventListener("mousedown", onOutside);
        }, 10);
    }

    function pasteItems(target) {
        if (internalClipboard.length === 0) return;
        let group = state.items.filter(i =>
            i.parent === state.filterParent &&
            i.child === state.filterChild[state.filterParent]
        );
        group.sort((a, b) => (a.order || 0) - (b.order || 0));

        let index = group.length;
        if (target) {
            index = group.findIndex(i => String(i.id) === String(target.id));
            if (index === -1) index = group.length;
        }

        let insert = [];
        if (clipboardMode === "copy") {
            insert = internalClipboard.map(i => ({
                id: uid(),
                title: i.title,
                body: i.body,
                parent: state.filterParent,
                child: state.filterChild[state.filterParent],
                order: 0,
                color: i.color
            }));
            state.items.push(...insert);
        } else {
            insert = internalClipboard;
            insert.forEach(i => {
                i.parent = state.filterParent;
                i.child = state.filterChild[state.filterParent];
            });
        }

        let remain = group.filter(i => !insert.includes(i));
        remain.splice(index, 0, ...insert);
        for (let i = 0; i < remain.length; i++) {
            let item = state.items.find(x => x.id === remain[i].id);
            if (item) item.order = i;
        }

        if (clipboardMode === "cut") {
            internalClipboard = [];
            selectedIds.clear();
            cutIds.clear();
            clipboardMode = null;
        }
        saveState();
        renderList();
    }

    function getWorkspaceCoords(ws, e) {
        try {
            let canvas = typeof ws.getCanvas === "function" ? ws.getCanvas() : null;
            if (!canvas) canvas = document.querySelector(".blocklyBlockCanvas");
            if (canvas && canvas.ownerSVGElement && typeof canvas.getScreenCTM === "function") {
                const pt = canvas.ownerSVGElement.createSVGPoint();
                pt.x = e.clientX;
                pt.y = e.clientY;
                const ctm = canvas.getScreenCTM();
                if (ctm && typeof ctm.inverse === "function") {
                    const p = pt.matrixTransform(ctm.inverse());
                    return { x: p.x, y: p.y };
                }
            }
        } catch (_) { }
        const metrics = ws.getMetrics ? ws.getMetrics() : {};
        return { x: (metrics.viewLeft || 0) + 50, y: (metrics.viewTop || 0) + 50 };
    }

    function createBlockInstance(ws, item) {
        let data;
        try { data = JSON.parse(item.body); }
        catch (_) { return null; }

        const varDefs = extractVariableDefinitions(data);
        if (varDefs.length > 0) registerVariablesBeforePaste(ws, varDefs);
        data = renameSubroutineIfNeeded(ws, data);
        data = sanitizeForWorkspace(ws, data);

        const existingBlocks = new Set(ws.getAllBlocks(false));
        let createdBlock = null;

        try {
            if (_Blockly.serialization && _Blockly.serialization.blocks && typeof _Blockly.serialization.blocks.append === "function") {
                createdBlock = _Blockly.serialization.blocks.append(data, ws);
            } else if (data._legacyXml && typeof Blockly !== "undefined" && Blockly.Xml) {
                const dom = Blockly.Xml.textToDom(data._legacyXml);
                createdBlock = Blockly.Xml.domToBlock(dom, ws);
            }
        } catch (e) {
            console.warn("[CODE STOCK] block append failed:", e);
        }

        if (!createdBlock || typeof createdBlock.initSvg !== "function") {
            const currentBlocks = ws.getAllBlocks(false);
            for (const b of currentBlocks) {
                if (!existingBlocks.has(b) && !b.getParent()) {
                    createdBlock = b;
                    break;
                }
            }
        }
        return createdBlock;
    }

    function autoConnectBlock(createdBlock) {
        if (!createdBlock || !createdBlock.workspace) return;
        const ws = createdBlock.workspace;
        const SNAP_RADIUS = 75;

        const myConns = [];
        if (createdBlock.outputConnection) myConns.push(createdBlock.outputConnection);
        if (createdBlock.previousConnection) myConns.push(createdBlock.previousConnection);
        const lastBlock = createdBlock.lastConnectionInStack ? createdBlock.lastConnectionInStack() : createdBlock;
        if (lastBlock && lastBlock.nextConnection) myConns.push(lastBlock.nextConnection);

        if (myConns.length === 0) return;

        let bestDist = SNAP_RADIUS;
        let bestMyConn = null;
        let bestTargetConn = null;

        const allBlocks = ws.getAllBlocks(false);
        for (const other of allBlocks) {
            if (other === createdBlock || other.getRootBlock() === createdBlock) continue;

            const targetConns = [];
            if (other.previousConnection) targetConns.push(other.previousConnection);
            if (other.nextConnection) targetConns.push(other.nextConnection);

            if (other.inputList) {
                for (const input of other.inputList) {
                    if (input.connection) targetConns.push(input.connection);
                }
            }

            if (typeof other.isShadow === "function" && other.isShadow()) {
                if (other.outputConnection && other.outputConnection.targetConnection) {
                    targetConns.push(other.outputConnection.targetConnection);
                }
            }

            for (const myC of myConns) {
                for (const targetC of targetConns) {
                    if (!targetC) continue;

                    let canConnect = false;
                    try {
                        if (typeof targetC.canConnectWithReason_ === "function") {
                            const reason = targetC.canConnectWithReason_(myC);
                            canConnect = (reason === 0 || reason === 1);
                        } else if (typeof targetC.isConnectionAllowed === "function") {
                            canConnect = targetC.isConnectionAllowed(myC);
                        } else {
                            canConnect = true;
                        }
                    } catch (_) {
                        canConnect = false;
                    }

                    if (!canConnect) continue;

                    const p1 = { x: myC.x, y: myC.y };
                    const p2 = { x: targetC.x, y: targetC.y };
                    if (p1.x === undefined || p2.x === undefined) continue;

                    const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
                    if (dist < bestDist) {
                        bestDist = dist;
                        bestMyConn = myC;
                        bestTargetConn = targetC;
                    }
                }
            }
        }

        if (bestMyConn && bestTargetConn) {
            try {
                if (bestTargetConn.type === 1 || bestTargetConn.type === 3) {
                    bestTargetConn.connect(bestMyConn);
                } else {
                    bestMyConn.connect(bestTargetConn);
                }

                createdBlock.render();
                const root = createdBlock.getRootBlock();
                if (root && typeof root.render === "function") root.render();
            } catch (err) {
                console.warn("[CODE STOCK] autoConnect failed:", err);
            }
        }
    }

    function attachDragOutListener(item, nameEl) {
        nameEl.addEventListener("mousedown", (e) => {
            if (e.button !== 0) return;
            if (interactionMode === "blockEntry") return;

            e.preventDefault();

            let isDragging = false;
            let previewBlock = null;
            let ws = null;

            const onMouseMove = (moveEvent) => {
                if (!panel) return;
                const rect = panel.getBoundingClientRect();
                const isOutside = moveEvent.clientX < rect.left || moveEvent.clientX > rect.right ||
                    moveEvent.clientY < rect.top || moveEvent.clientY > rect.bottom;

                // ドラッグ開始：マウス追従用のプレビューを表示
                if (!isDragging && isOutside) {
                    isDragging = true;
                    ws = _Blockly.getMainWorkspace && _Blockly.getMainWorkspace();
                    if (ws) {
                        const B = _Blockly || window.Blockly;
                        if (B.Events && typeof B.Events.disable === "function") B.Events.disable();
                        previewBlock = createBlockInstance(ws, item);
                        if (B.Events && typeof B.Events.enable === "function") B.Events.enable();
                    }

                    if (isTempExpanded) {
                        isTempExpanded = false;
                        isCollapsed = true;
                        renderPanel();
                    } else if (!isPinned) {
                        closePanel();
                    }
                }

                // マウス追従移動
                // 重要: プレビュー中の moveTo / select は本体のUNDO履歴に入れない。
                // ここでイベントを有効にしたまま moveTo すると、ドラッグ中の
                // マウス移動回数だけ MOVE イベントがUNDO履歴に積まれ、
                // 最終的な「配置」を1回Undoするまでに余分なUndoが必要になる。
                if (isDragging && previewBlock && ws) {
                    const coords = getWorkspaceCoords(ws, moveEvent);
                    const B = _Blockly || window.Blockly;
                    const events = B && B.Events;
                    const canDisable = events && typeof events.disable === "function";
                    const canEnable = events && typeof events.enable === "function";
                    if (canDisable) events.disable();
                    try {
                        const Coordinate = (_Blockly.utils && _Blockly.utils.Coordinate) || function (x, y) { this.x = x; this.y = y; };
                        if (typeof previewBlock.moveTo === "function") {
                            previewBlock.moveTo(new Coordinate(coords.x - 20, coords.y - 15));
                        }
                        if (typeof previewBlock.select === "function") {
                            previewBlock.select();
                        }
                    } finally {
                        if (canEnable) events.enable();
                    }
                }
            };

            const onMouseUp = (upEvent) => {
                document.removeEventListener("mousemove", onMouseMove);
                document.removeEventListener("mouseup", onMouseUp);

                if (isDragging) {
                    if (ws) {
                        const B = _Blockly || window.Blockly;
                        // 1. ドラッグ中の移動履歴を持ったプレビュー用ブロックを静かに消去
                        if (previewBlock) {
                            if (B.Events && typeof B.Events.disable === "function") B.Events.disable();
                            try { previewBlock.dispose(false); } catch (_) { }
                            if (B.Events && typeof B.Events.enable === "function") B.Events.enable();
                            previewBlock = null;
                        }

                        // 2. 指を離した場所へ、UNDOが100%効く pasteBlockAt で正式配置！
                        const coords = getWorkspaceCoords(ws, upEvent);
                        pasteBlockAt(ws, item, { x: coords.x - 20, y: coords.y - 15 });
                    }

                    if (!isPinned) {
                        closePanel();
                    }
                } else {
                    handleItemClick(item, nameEl);
                }
            };

            document.addEventListener("mousemove", onMouseMove);
            document.addEventListener("mouseup", onMouseUp);
        });
    }

    function getClickPasteCoords(ws) {
        if (isPinned && panel) {
            const rect = panel.getBoundingClientRect();
            const vw = window.innerWidth;

            const cy = rect.top + rect.height / 2;
            let cx = rect.right + 25;

            if (cx + 200 > vw) {
                cx = Math.max(20, rect.left - 230);
            }

            return getWorkspaceCoords(ws, { clientX: cx, clientY: cy });
        } else {
            const ev = lastContextMenuEvent || lastMouseEvent;
            if (ev) {
                return getWorkspaceCoords(ws, ev);
            }
            return getWorkspaceCoords(ws, { clientX: window.innerWidth / 2, clientY: window.innerHeight / 2 });
        }
    }

    function pasteBlockAt(ws, item, targetCoords) {
        const B = _Blockly || window.Blockly;
        if (!ws) return null;

        // ExperienceManager本体のCopy/Pasteと同じ方式にする。
        // append / moveTo / connect が個別のUNDOイベントとして積まれると、
        // 1回の貼り付けを1回のUndoで戻せなくなるため、作成から接続まで
        // 一旦イベントを停止し、最後にBlockCreateを1件だけ発火する。
        const events = B && B.Events;
        const canDisable = events && typeof events.disable === "function";
        const canEnable = events && typeof events.enable === "function";
        const canFire = events && typeof events.fire === "function";

        let createdBlock = null;
        if (canDisable) events.disable();

        try {
            createdBlock = createBlockInstance(ws, item);
            if (!createdBlock) return null;

            const Coordinate = (B.utils && B.utils.Coordinate) || function (x, y) { this.x = x; this.y = y; };
            if (typeof createdBlock.moveTo === "function") {
                createdBlock.moveTo(new Coordinate(targetCoords.x, targetCoords.y));
            }
            if (typeof createdBlock.render === "function") createdBlock.render();
            if (typeof createdBlock.select === "function") createdBlock.select();

            // 自動接続もイベント停止中に行う。
            autoConnectBlock(createdBlock);

            if (typeof ws.resizeContents === "function") ws.resizeContents();
        } finally {
            if (canEnable) events.enable();
        }

        // 「この貼り付け全体」を1つのBlockCreateとしてUNDOに登録。
        // Blocklyの標準UNDOは、このCreateEventを元にブロックと接続状態をまとめて戻せる。
        if (createdBlock && canFire) {
            const CreateEvent = events.BlockCreate || events.Create;
            if (typeof CreateEvent === "function") {
                try {
                    events.fire(new CreateEvent(createdBlock));
                } catch (e) {
                    console.warn("[CODE STOCK] BlockCreate event failed:", e);
                }
            }
        }

        return createdBlock;
    }


    function handleItemClick(item, nameEl) {
        const ws = _Blockly.getMainWorkspace && _Blockly.getMainWorkspace();

        if (ws) {
            const coords = getClickPasteCoords(ws);
            pasteBlockAt(ws, item, coords);
            setStatus("Pasted into workspace");
        } else {
            copyText(item.body).then(() => setStatus("COPY OK!"));
        }

        if (isTempExpanded) {
            isTempExpanded = false;
            isCollapsed = true;
            renderPanel();
        } else if (!isPinned) {
            closePanel();
        }
    }

    function extractVariableDefinitions(serializedRoot) {
        const varsById = new Map();
        traverseSerializedBlocks(serializedRoot, (b) => {
            if (b.fields && b.fields.VAR) {
                const raw = b.fields.VAR;
                let id = null, name = null, type = "";
                if (raw && typeof raw === "object") {
                    id = raw.id || null;
                    name = raw.name || null;
                    type = raw.type || "";
                } else if (typeof raw === "string") {
                    id = null;
                    name = raw;
                    type = "";
                }
                const isObjectVar = !!(b.extraState && b.extraState.isObjectVar);
                if (name) {
                    const key = id || name + "::" + type;
                    if (!varsById.has(key)) {
                        varsById.set(key, { id, name, type, isObjectVar });
                    }
                }
            }
        });
        return Array.from(varsById.values());
    }

    function registerVariablesBeforePaste(ws, varDefs) {
        try {
            const varMap = ws.getVariableMap ? ws.getVariableMap() : null;
            for (const v of varDefs) {
                try {
                    let existing = null;
                    if (varMap && typeof varMap.getVariable === "function") {
                        try { existing = varMap.getVariable(v.id); } catch (_) { existing = null; }
                    }
                    if (!existing && varMap && typeof varMap.getVariableById === "function") {
                        try { existing = varMap.getVariableById(v.id); } catch (_) { existing = null; }
                    }
                    if (!existing && varMap && typeof varMap.getVariableByName === "function") {
                        try { existing = varMap.getVariableByName(v.name); } catch (_) { existing = null; }
                    }
                    if (existing) continue;

                    let created = null;
                    if (varMap && typeof varMap.createVariable === "function") {
                        try {
                            created = varMap.createVariable(v.name, v.type || "", v.id);
                        } catch (_) {
                            try { created = varMap.createVariable(v.name, v.type || "", undefined); } catch (_) { created = null; }
                        }
                    }
                    if (!created && typeof ws.createVariable === "function") {
                        try {
                            created = ws.createVariable(v.name, v.type || "", v.id);
                        } catch (_) {
                            try { created = ws.createVariable(v.name, v.type || "", undefined); } catch (_) { created = null; }
                        }
                    }
                } catch (inner) {
                    console.warn("[CopyPastePlugin] registerVariablesBeforePaste error for", v, inner);
                }
            }
        } catch (err) {
            console.warn("[CopyPastePlugin] registerVariablesBeforePaste failed:", err);
        }
    }

    function ensureVariableExists(ws, name, type) {
        try {
            const varMap = ws.getVariableMap();
            if (!varMap) return null;
            let existing = null;
            try { existing = varMap.getVariable(name); } catch (_) { existing = null; }
            if (!existing && typeof varMap.getVariableByName === "function") {
                try { existing = varMap.getVariableByName(name); } catch (_) { existing = null; }
            }
            if (!existing) {
                if (typeof varMap.createVariable === "function") return varMap.createVariable(name, type || "", undefined);
                if (typeof ws.createVariable === "function") return ws.createVariable(name, type || "", undefined);
            }
            return existing;
        } catch (e) {
            console.warn("[CopyPastePlugin] ensureVariableExists error:", e);
            return null;
        }
    }

    function traverseSerializedBlocks(node, cb) {
        if (!node) return;
        cb(node);
        if (node.inputs && typeof node.inputs === "object") {
            for (const input of Object.values(node.inputs)) {
                if (input && input.block) traverseSerializedBlocks(input.block, cb);
                if (input && input.shadow) traverseSerializedBlocks(input.shadow, cb);
            }
        }
        if (node.next && node.next.block) traverseSerializedBlocks(node.next.block, cb);
    }

    function sanitizeForWorkspace(ws, root) {
        traverseSerializedBlocks(root, (b) => {
            if (b.type === "variableReferenceBlock" || b.type === "subroutineArgumentBlock") return;
            if (b.fields) {
                for (const [key, val] of Object.entries(b.fields)) {
                    const ku = key.toUpperCase();
                    if (ku === "VAR" || ku === "VARIABLE" || ku.startsWith("VAR")) {
                        let varName = val;
                        if (val && typeof val === "object" && val.name) varName = val.name;
                        if (typeof varName === "string" && varName.length > 0) {
                            ensureVariableExists(ws, varName, val?.type || "");
                        }
                    }
                }
                for (const [key, val] of Object.entries(b.fields)) {
                    if (typeof val !== "string") continue;
                    try {
                        const temp = ws.newBlock(b.type);
                        const field = temp.getField(key);
                        if (field && typeof field.getOptions === "function") {
                            const opts = field.getOptions();
                            const values = opts.map((o) => o[1]);
                            if (!values.includes(val)) b.fields[key] = values[0] || "";
                        }
                        temp.dispose(false);
                    } catch (_) { }
                }
            }
        });
        return root;
    }

    function extractBlockForClipboard(block) {
        try {
            const full = _Blockly.serialization.blocks.save(block);
            if (full && full.next) delete full.next;
            return full;
        } catch (_) {
            try {
                if (typeof Blockly !== "undefined" && Blockly.Xml) {
                    const xml = Blockly.Xml.blockToDom(block, true);
                    return { _legacyXml: Blockly.Xml.domToText(xml) };
                }
            } catch (_) { }
            return null;
        }
    }

    function renameSubroutineIfNeeded(ws, data) {
        try {
            if (!data || data.type !== "subroutineBlock") return data;
            const originalName = data.extraState?.subroutineName || data.fields?.SUBROUTINE_NAME;
            if (!originalName) return data;

            const existingNames = new Set();
            const allBlocks = ws.getAllBlocks(false);
            for (const b of allBlocks) {
                if (b.type === "subroutineBlock") {
                    const name = (b.extraState && b.extraState.subroutineName) || (b.getField && b.getField("SUBROUTINE_NAME")?.getValue());
                    if (name) existingNames.add(name);
                }
            }

            if (!existingNames.has(originalName)) return data;

            let i = 1, newName = originalName + i;
            while (existingNames.has(newName)) {
                i++;
                newName = originalName + i;
            }

            if (data.extraState) data.extraState.subroutineName = newName;
            if (data.fields) data.fields.SUBROUTINE_NAME = newName;

            traverseSerializedBlocks(data, (b) => {
                if (b.fields && b.fields.SUBROUTINE_NAME === originalName) {
                    b.fields.SUBROUTINE_NAME = newName;
                }
            });

            return data;
        } catch (err) {
            console.warn("[CopyPastePlugin] renameSubroutineIfNeeded failed:", err);
            return data;
        }
    }

    function blockTypeName(data) {
        if (!data) return "Code";
        if (data.type) return String(data.type);
        return "Code";
    }

    function openWorkspacePasteMode() {
        interactionMode = "workspacePaste";
        editingIdValue = null;
        inputHidden = true;

        if (isCollapsed) {
            isTempExpanded = true;
            isCollapsed = false;
        }

        openPanel();
        renderPanel();
        setStatus("Select or drag a code entry into workspace");
    }

    let inputIconPreview = null;

    function updateInputIconPreview() {
        if (!inputIconPreview) return;
        let coord = pendingIconCoord;
        if (!coord && editingIdValue) {
            const item = state.items.find(x => x && String(x.id) === String(editingIdValue));
            if (item && item.iconCoord) coord = item.iconCoord;
        }
        if (coord && state.iconAtlas && state.iconAtlas.spriteUrl) {
            inputIconPreview.style.display = "block";
            inputIconPreview.style.width = (coord.w || 20) + "px";
            inputIconPreview.style.height = (coord.h || 20) + "px";
            inputIconPreview.style.backgroundImage = `url("${state.iconAtlas.spriteUrl}")`;
            inputIconPreview.style.backgroundPosition = `-${coord.x}px -${coord.y}px`;
            inputIconPreview.style.backgroundRepeat = "no-repeat";
        } else {
            inputIconPreview.style.display = "none";
            inputIconPreview.style.backgroundImage = "none";
        }
    }

    let pendingBlockTitle = null;
    let pendingBlockBody = null;

    function openBlockEntryMode(block) {
        try {
            const data = extractBlockForClipboard(block);
            if (!data) throw new Error("Unable to serialize block");

            pendingBlockData = data;
            copyText(JSON.stringify(data, null, 2)).catch(() => { });

            interactionMode = "blockEntry";
            editingIdValue = null;
            lastEditingId = null;
            inputHidden = false;

            pendingBlockTitle = blockTypeName(data);
            pendingBlockBody = JSON.stringify(data, null, 2);

            if (isCollapsed) {
                isTempExpanded = true;
                isCollapsed = false;
            }

            openPanel();
            setStatus("Block copied — ADD to save, CANCEL to close");

            pendingIconCoord = null;
            try {
                const iconSrc = extractBlockIcon(block);
                if (iconSrc) {
                    getOrAddIconToAtlas(iconSrc).then(coord => {
                        pendingIconCoord = coord;
                        updateInputIconPreview();
                    }).catch(() => { });
                } else {
                    updateInputIconPreview();
                }
            } catch (_) { }

            setTimeout(() => titleEl && titleEl.focus(), 0);
        } catch (e) {
            console.error("[CODE STOCK] block entry error:", e);
            BF2042Portal.Shared.logError("CODE STOCK block entry", String(e));
        }
    }

    function addItem() {
        try {
            const title = titleEl && titleEl.value.trim();
            const body = bodyEl ? bodyEl.value : "";
            if (!title) return setStatus("Code name is required");

            const p = state.filterParent || 0;
            const c = (state.filterChild && state.filterChild[p]) || 0;

            if (editingIdValue) {
                const item = state.items.find(x => x && x.id === editingIdValue);
                if (item) {
                    item.title = title;
                    item.body = body;
                    item.parent = p;
                    item.child = c;
                    item.color = state.currentColor || 0;
                    if (pendingIconCoord) {
                        item.iconCoord = pendingIconCoord;
                    }
                }
            } else {
                state.items.push({
                    id: uid(),
                    title: title,
                    body: body,
                    parent: p,
                    child: c,
                    order: nextOrder(),
                    color: state.currentColor || 0,
                    iconCoord: pendingIconCoord || null
                });
                scrollToBottomOnRender = true;
            }
        } catch (err) {
            console.error("[CODE STOCK] addItem error:", err);
        }

        pendingIconCoord = null;
        editingIdValue = null;
        lastEditingId = null;
        interactionMode = "normal";
        pendingBlockData = null;
        pendingBlockTitle = null;
        pendingBlockBody = null;

        if (titleEl) titleEl.value = "";
        if (bodyEl) bodyEl.value = "";
        if (inputIconPreview) {
            inputIconPreview.style.display = "none";
            inputIconPreview.style.backgroundImage = "none";
        }

        inputHidden = true;

        try { saveState(); } catch (_) { }

        if (isTempExpanded) {
            isTempExpanded = false;
            isCollapsed = true;
            renderPanel();
            return;
        }

        if (!isPinned) {
            closePanel();
            return;
        }

        renderPanel();
    }

    function nextOrder() {
        const group = state.items.filter(x =>
            x.parent === state.filterParent &&
            x.child === state.filterChild[state.filterParent]
        );
        return group.length;
    }

    function editItem(item) {
        if (!item) return;

        editingIdValue = item.id;
        lastEditingId = null;
        interactionMode = "normal";

        const p = Number(item.parent) || 0;
        const c = Number(item.child) || 0;
        state.filterParent = p;
        if (!Array.isArray(state.filterChild)) state.filterChild = Array(8).fill(0);
        state.filterChild[p] = c;
        state.currentColor = (item.color !== undefined) ? Number(item.color) : 0;

        inputHidden = false;

        renderPanel();

        if (titleEl) {
            titleEl.value = item.title || "";
            titleEl.style.borderLeft = "6px solid " + (state.palette[state.currentColor] || "#fff");
            titleEl.style.paddingLeft = "6px";
            titleEl.focus();
        }
        if (bodyEl) {
            bodyEl.value = item.body || "";
        }

        updateInputIconPreview();
    }

    function cancelEdit() {
        pendingIconCoord = null;
        pendingBlockTitle = null;
        pendingBlockBody = null;
        editingIdValue = null;
        lastEditingId = null;

        if (titleEl) titleEl.value = "";
        if (bodyEl) bodyEl.value = "";
        if (inputIconPreview) {
            inputIconPreview.style.display = "none";
            inputIconPreview.style.backgroundImage = "none";
        }
        inputHidden = true;

        if (interactionMode === "blockEntry") {
            interactionMode = "normal";
            pendingBlockData = null;

            if (isTempExpanded) {
                isTempExpanded = false;
                isCollapsed = true;
                renderPanel();
                return;
            }

            if (!isPinned) {
                closePanel();
                return;
            }

            renderPanel();
            return;
        }

        renderPanel();
    }

    function reorderGroup(parent, child) {
        state.items.filter(x => x.parent === parent && x.child === child)
            .sort((a, b) => (a.order || 0) - (b.order || 0))
            .forEach((x, i) => x.order = i);
    }

    function attachTitleDragAndToggle(titleEl) {
        titleEl.style.cursor = "grab";
        titleEl.title = "Click to collapse/expand (Drag to move)";

        titleEl.addEventListener("mousedown", (e) => {
            if (e.button !== 0) return;

            e.preventDefault();
            titleEl.style.cursor = "grabbing";

            const r = panel.getBoundingClientRect();
            const startX = e.clientX, startY = e.clientY;
            const startLeft = r.left, startTop = r.top;
            let hasMoved = false;

            const onMove = (ev) => {
                const dist = Math.hypot(ev.clientX - startX, ev.clientY - startY);
                if (dist > 4) {
                    hasMoved = true;
                    const maxLeft = Math.max(8, window.innerWidth - panel.offsetWidth - 8);
                    const maxTop = Math.max(8, window.innerHeight - panel.offsetHeight - 8);
                    panel.style.left = Math.max(8, Math.min(startLeft + ev.clientX - startX, maxLeft)) + "px";
                    panel.style.top = Math.max(8, Math.min(startTop + ev.clientY - startY, maxTop)) + "px";
                    panel.style.right = "auto";
                }
            };

            const onUp = () => {
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
                titleEl.style.cursor = "grab";

                if (hasMoved) {
                    saveWindowBounds();
                } else {
                    if (!isCollapsed) {
                        saveWindowBounds();
                    }

                    const currentTree = panel.querySelector(".jcs-tree-nav");
                    if (currentTree && currentTree.scrollTop > 0) {
                        lastTreeNavScrollTop = currentTree.scrollTop;
                    }

                    isCollapsed = !isCollapsed;
                    renderPanel();
                }
            };

            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
        });
    }

    function openPanel() {
        if (!panel) {
            panel = document.getElementById("js-code-stock-panel");
        }
        if (!panel) {
            injectStyle();
            panel = document.createElement("div");
            panel.id = "js-code-stock-panel";
            document.body.appendChild(panel);

            let resizeTimer = null;
            const ro = new ResizeObserver(() => {
                if (isCollapsed || panel.style.display === "none") return;
                clearTimeout(resizeTimer);
                resizeTimer = setTimeout(() => {
                    saveWindowBounds();
                }, 150);
            });
            ro.observe(panel);
        }

        panel.style.display = "flex";
        renderPanel();

        const isPositionFixed = applySavedWindowBounds();
        if (!isPositionFixed) {
            requestAnimationFrame(positionPanelAtContext);
        }
    }

    function closePanel() {
        if (listEl) {
            const currentTabKey = `${state.filterParent}_${state.filterChild[state.filterParent]}`;
            listScrollPositions.set(currentTabKey, listEl.scrollTop);
        }

        if (panel) {
            const currentTree = panel.querySelector(".jcs-tree-nav");
            if (currentTree && currentTree.scrollTop > 0) {
                lastTreeNavScrollTop = currentTree.scrollTop;
            }
        }

        if (isTempExpanded) {
            isTempExpanded = false;
            isCollapsed = true;
        }

        if (panel) panel.style.display = "none";
        interactionMode = "normal";
        pendingBlockData = null;

        saveState();
    }

    let menusRegistered = false;

    function registerMenus() {
        if (menusRegistered) return;
        const Scope = _Blockly.ContextMenuRegistry.ScopeType;

        const workspaceItem = {
            id: "codeStockWorkspace",
            displayText: "CODE STOCK",
            scopeType: Scope.WORKSPACE,
            weight: 90,
            preconditionFn: () => "enabled",
            callback: () => openWorkspacePasteMode()
        };
        plugin.registerItem(workspaceItem);
        _Blockly.ContextMenuRegistry.registry.register(workspaceItem);

        const blockItem = {
            id: "codeStockBlock",
            displayText: "CODE STOCK",
            scopeType: Scope.BLOCK,
            weight: 90,
            preconditionFn: () => "enabled",
            callback: scope => {
                const blocks = plugin.getSelectedBlocks(scope) || [];
                if (blocks.length) openBlockEntryMode(blocks[0]);
            }
        };
        plugin.registerItem(blockItem);
        _Blockly.ContextMenuRegistry.registry.register(blockItem);
        menusRegistered = true;
    }

    plugin.initializeWorkspace = async function () {
        await loadState();
        try { registerMenus(); } catch (e) { BF2042Portal.Shared.logError("CODE STOCK menu registration", String(e)); }
        try {
            const ws = _Blockly.getMainWorkspace && _Blockly.getMainWorkspace();
            attachMouseTracking(ws);
        } catch (_) { }
    };

})();
