/* global BF2042Portal, _Blockly */
(function () {
    "use strict";

    const plugin = BF2042Portal.Plugins.getPlugin("jsCodeStock");
    const STORAGE_KEY = "BF2042Portal_JSCodeStock_v1";
    // Category counts are fixed: 4 parent categories, 6 child categories each.
    const PARENT_COUNT = 4;
    const CHILD_COUNT = 6;
    const COLOR_COUNT = 8;
    const DEFAULT_PARENTS = ["A", "B", "C", "D"];
    const DEFAULT_CHILDREN = [
        ["A-0", "A-1", "A-2", "A-3", "A-4", "A-5"],
        ["B-0", "B-1", "B-2", "B-3", "B-4", "B-5"],
        ["C-0", "C-1", "C-2", "C-3", "C-4", "C-5"],
        ["D-0", "D-1", "D-2", "D-3", "D-4", "D-5"]
    ];
    const DEFAULT_PALETTE = [
        "#e74c3c", "#f39c12", "#f1c40f", "#2ecc71",
        "#3498db", "#9b59b6", "#666666", "#ffffff"
    ];

    let state = {
        items: [],
        parents: DEFAULT_PARENTS.slice(),
        children: DEFAULT_CHILDREN.map(x => x.slice()),
        palette: DEFAULT_PALETTE.slice(),
        filterParent: 0,
        filterChild: [0, 0, 0, 0],
        filterColor: null,
        currentColor: 0
    };
    let editingIdValue = null;
    let lastEditingId = null; // ★ 編集中のアイテムIDを追跡
    let inputHidden = false;
    let selectedIds = new Set();
    let lastSelected = null;
    let internalClipboard = [];
    let clipboardMode = null; // "copy" | "cut"
    let cutIds = new Set();

    let isPinned = true; // 🔒️ ロック状態（falseだと操作後に自動で閉じる）
    let isCollapsed = false; // ⬒ 折りたたみ最小化状態
    let isTempExpanded = false; // メニューから呼ばれた際の一時展開フラグ
    let savedPanelHeight = "600px";
    let panel = null;
    let listEl = null;
    let searchEl = null;
    let titleEl = null;
    let bodyEl = null;
    let statusEl = null;
    let folderClipboard = null; // ★ フォルダ丸ごとコピー用（{ type, name, childrenNames, items }）
    let interactionMode = "normal";
    let pendingBlockData = null;
    let lastMouseEvent = null;
    let lastContextMenuEvent = null;

    const DB_NAME = "BF2042Portal_JSCodeStock_DB";
    const DB_STORE = "state_store";

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

    function cloneDefault() {
        return {
            items: [],
            parents: DEFAULT_PARENTS.slice(),
            children: DEFAULT_CHILDREN.map(x => x.slice()),
            palette: DEFAULT_PALETTE.slice(),
            filterParent: 0,
            filterChild: [0, 0, 0, 0],
            filterColor: null,
            currentColor: 0,
            parentCount: 4, // ★ 親タブ数
            childCount: 6,  // ★ 子タブ数
            windowBounds: { left: null, top: null, width: 400, height: 600 }
        };
    }

    async function loadState() {
        try {
            let saved = null;
            // 1. 大容量 IndexedDB から読み込み
            try {
                saved = await idbGet("app_state");
            } catch (_) { }

            // 2. 初回のみ従来の localStorage から自動移行
            if (!saved) {
                const raw = localStorage.getItem(STORAGE_KEY);
                if (raw) {
                    saved = JSON.parse(raw);
                    idbSet("app_state", saved).catch(() => { });
                }
            }

            if (!saved) return;
            const d = cloneDefault();
            state = Object.assign(d, saved);

            state.filterParent = 0;
            state.filterChild = Array(8).fill(0);
            if (!state.parentCount) state.parentCount = 4;
            if (!state.childCount) state.childCount = 6;

            if (Array.isArray(saved.parents)) state.parents = saved.parents.slice();
            if (Array.isArray(saved.children)) state.children = saved.children.map(arr => Array.isArray(arr) ? arr.slice() : []);
            if (Array.isArray(saved.palette) && saved.palette.length === COLOR_COUNT) state.palette = saved.palette;
            if (!Array.isArray(state.items)) state.items = [];

            if (panel) renderPanel();
        } catch (e) {
            console.error("[JS Code Stock] load failed", e);
        }
    }

    function saveState() {
        // 大容量 IndexedDB に保存（数百MB〜数GB対応）
        idbSet("app_state", state).then(() => {
            setStatus("Saved");
        }).catch(err => {
            console.warn("[JS Code Stock] IndexedDB save failed, fallback to local:", err);
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
                setStatus("Saved");
            } catch (e) {
                setStatus("Save failed");
            }
        });
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
            if (!svg || svg._jsCodeStockMouseTrackingAttached) return;
            svg._jsCodeStockMouseTrackingAttached = true;
            svg.addEventListener("mousemove", e => { lastMouseEvent = e; }, { passive: true });
            svg.addEventListener("contextmenu", e => { lastContextMenuEvent = e; lastMouseEvent = e; }, { passive: true });
        } catch (e) {
            console.warn("[JS Code Stock] mouse tracking failed:", e);
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

    function injectStyle() {
        if (document.getElementById("js-code-stock-style")) return;
        const style = document.createElement("style");
        style.id = "js-code-stock-style";
        style.textContent = `
#js-code-stock-panel{position:fixed;left:18px;top:58px;width:400px;height:600px;min-width:320px;min-height:320px;max-width:calc(100vw - 36px);max-height:calc(100vh - 76px);z-index:2147483646;background:#111;color:#fff;border:1px solid #333;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.6);font-family:sans-serif;display:flex;flex-direction:column;overflow:hidden;padding:6px;resize:both;user-select:none;-webkit-user-select:none}
#js-code-stock-panel *{box-sizing:border-box}
#js-code-stock-panel .jcs-container{display:flex;flex-direction:column;height:100%;padding:0 4px;min-height:0}
#js-code-stock-panel .jcs-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
#js-code-stock-panel .jcs-title{font-size:18px;text-align:left;cursor:grab;user-select:none;flex:1}
#js-code-stock-panel .jcs-title:active{cursor:grabbing}
#js-code-stock-panel .jcs-tools{display:flex;gap:4px;align-items:center}
#js-code-stock-panel button{background:#333;color:#fff;border:none;border-radius:2px;cursor:pointer}
#js-code-stock-panel button:hover{background:#3b3b3b}
#js-code-stock-panel .jcs-tools button{font-size:11px;padding:5px 7px}
#js-code-stock-panel .jcs-close{font-size:18px;padding:1px 6px;background:#7a2020}
#js-code-stock-panel .jcs-close:hover{background:#a52a2a}
#js-code-stock-panel .jcs-tabs{display:flex;gap:0;background:#1f1f1f;padding:2px 12px 0;overflow:hidden}
#js-code-stock-panel .jcs-tab{flex:1;max-width:240px;height:36px;background:#2d2d2d;color:#9aa0a6;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;position:relative;border:none;border-top-left-radius:4px;border-top-right-radius:4px;border-bottom-left-radius:0;border-bottom-right-radius:0;transform:perspective(40px) rotateX(6deg);transform-origin:bottom;z-index:1;box-shadow:0 2px 0 0 #fff}
#js-code-stock-panel .jcs-tab:hover{background:#35363a;color:#e8eaed;z-index:2}
#js-code-stock-panel .jcs-tab.active{background:#35363a;color:#fff;z-index:3;box-shadow:-2px 0 0 0 #fff,2px 0 0 0 #fff,0 -2px 0 0 #fff}
#js-code-stock-panel .jcs-child{margin-bottom:4px}
#js-code-stock-panel .jcs-colors{display:flex;gap:4px;background:transparent;padding:0 0 3px;overflow:visible;width:100%}
#js-code-stock-panel .jcs-colors .jcs-tab{flex:1;min-width:0;height:18px;padding:0;box-shadow:none;transform:none;border-radius:2px}
#js-code-stock-panel .jcs-colors .jcs-tab.active{border:2px solid #fff;box-shadow:inset 0 0 0 1px rgba(0,0,0,.35);z-index:4}
#js-code-stock-panel .jcs-input-section{margin-bottom:6px}
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
#js-code-stock-panel .jcs-filter{padding:0 0 3px;border-bottom:1px solid #333}
#js-code-stock-panel .jcs-filter-colors{display:flex;gap:4px;background:transparent;padding:0;overflow:visible;width:100%}
#js-code-stock-panel .jcs-filter-colors .jcs-tab{flex:1;min-width:0;height:24px;padding:0;box-shadow:none;transform:none;border-radius:2px;font-size:11px;display:flex;align-items:center;justify-content:center}
#js-code-stock-panel .jcs-filter-colors .jcs-tab.active{border:2px solid #fff;box-shadow:inset 0 0 0 1px rgba(0,0,0,.35);z-index:4}
#js-code-stock-panel .jcs-search{height:30px;font-size:18px;margin-top:3px}
#js-code-stock-panel .jcs-list{flex:1;overflow:auto;margin-top:4px;min-height:0;padding-right:2px}
#js-code-stock-panel .jcs-list::-webkit-scrollbar{width:10px}
#js-code-stock-panel .jcs-list::-webkit-scrollbar-track{background:#1e1e1e}
#js-code-stock-panel .jcs-list::-webkit-scrollbar-thumb{background:#444;border-radius:6px}
#js-code-stock-panel .jcs-list::-webkit-scrollbar-thumb:hover{background:#666}

/* アイテム項目 */
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
#js-code-stock-panel .jcs-foot{padding-top:4px;border-top:1px solid #333;display:flex;justify-content:space-between;align-items:center}
#js-code-stock-panel .jcs-status{color:#aaa;font-size:11px}
#js-code-stock-panel .jcs-foot-tools{display:flex;gap:4px}
#js-code-stock-panel .jcs-hidden{display:none!important}
#js-code-stock-panel input:focus,#js-code-stock-panel textarea:focus{outline:1px solid #4a7bd4}
#js-code-stock-panel .jcs-pin{font-size:13px;padding:3px 5px;background:#333}
#js-code-stock-panel .jcs-pin.unlocked{opacity:0.45;filter:grayscale(1)}
#js-code-stock-panel .jcs-collapse{font-size:13px;padding:3px 5px;background:#333}
#js-code-stock-panel.collapsed{height:auto!important;min-height:0!important;resize:none}
#js-code-stock-panel .jcs-gear{font-size:13px;padding:3px 6px;background:#333}
#jcs-settings-menu{position:fixed;background:#222;border:1px solid #555;border-radius:6px;padding:8px;z-index:2147483647;box-shadow:0 6px 20px rgba(0,0,0,0.8);display:flex;flex-direction:column;gap:6px;min-width:160px}
#jcs-settings-menu button.jcs-menu-btn{width:100%;padding:5px 8px;font-size:12px;background:#333;color:#fff;border:none;border-radius:3px;cursor:pointer;text-align:center}
#jcs-settings-menu button.jcs-menu-btn:hover{background:#4a7bd4}
.jcs-menu-sep{height:1px;background:#444;margin:2px 0}
.jcs-menu-row{display:flex;align-items:center;justify-content:space-between;font-size:12px;color:#ddd;padding:2px 4px}
.jcs-counter{display:flex;align-items:center;gap:4px}
.jcs-counter button{width:22px;height:22px;padding:0;text-align:center;font-size:13px;line-height:20px;background:#333;color:#fff;border:1px solid #555;border-radius:3px;cursor:pointer}
.jcs-counter button:hover{background:#555}
.jcs-counter span{min-width:18px;text-align:center;font-weight:bold;color:#fff}
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

    function showPrompt(x, y, text, value, yes) {
        const old = document.getElementById("uiPrompt");
        if (old) old.remove();
        const box = document.createElement("div");
        box.id = "uiPrompt";
        box.style.position = "fixed";
        box.style.left = Math.min(x, window.innerWidth - 200) + "px";
        box.style.top = Math.min(y, window.innerHeight - 120) + "px";
        box.style.background = "#1e1e1e";
        box.style.border = "1px solid #444";
        box.style.borderRadius = "6px";
        box.style.padding = "10px";
        box.style.zIndex = 2147483647;
        box.style.color = "#ddd";
        box.style.fontSize = "12px";
        box.style.boxShadow = "0 4px 14px rgba(0,0,0,0.6)";

        const t = document.createElement("div");
        t.textContent = text;
        t.style.marginBottom = "6px";

        const input = document.createElement("input");
        input.value = value;
        input.style.width = "160px";
        input.style.background = "#2a2a2a";
        input.style.border = "1px solid #555";
        input.style.color = "#ddd";
        input.style.padding = "4px";
        input.style.borderRadius = "4px";
        input.style.marginBottom = "8px";

        const ok = makeButton("OK", () => { yes(input.value); box.remove(); });
        const cancel = makeButton("Cancel", () => box.remove());
        [ok, cancel].forEach(b => {
            b.style.background = "#2d2d2d";
            b.style.border = "1px solid #555";
            b.style.color = "#ddd";
            b.style.padding = "4px 12px";
            b.style.marginRight = "6px";
            b.style.borderRadius = "4px";
            b.style.cursor = "pointer";
        });

        box.append(t, input, document.createElement("br"), ok, cancel);
        document.body.appendChild(box);
        input.focus();
    }

    function showConfirm(x, y, text, yes) {
        const old = document.getElementById("uiConfirm");
        if (old) old.remove();
        const box = document.createElement("div");
        box.id = "uiConfirm";
        box.style.position = "fixed";
        box.style.left = Math.min(x, window.innerWidth - 180) + "px";
        box.style.top = Math.min(y, window.innerHeight - 100) + "px";
        box.style.background = "#1e1e1e";
        box.style.border = "1px solid #444";
        box.style.borderRadius = "6px";
        box.style.padding = "10px";
        box.style.zIndex = 2147483647;
        box.style.color = "#ddd";
        box.style.fontSize = "12px";
        box.style.boxShadow = "0 4px 14px rgba(0,0,0,0.6)";

        const t = document.createElement("div");
        t.textContent = text;
        t.style.marginBottom = "10px";

        const ok = makeButton("OK", () => { yes(); box.remove(); });
        const cancel = makeButton("Cancel", () => box.remove());
        [ok, cancel].forEach(b => {
            b.style.background = "#2d2d2d";
            b.style.border = "1px solid #555";
            b.style.color = "#ddd";
            b.style.padding = "4px 12px";
            b.style.marginRight = "6px";
            b.style.borderRadius = "4px";
            b.style.cursor = "pointer";
        });

        box.append(t, ok, cancel);
        document.body.appendChild(box);
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

        // ★ 枠外をクリックしたらメニューを自動で閉じる（キャンセル）
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
            console.warn("[JS Code Stock] block append failed:", e);
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
        const SNAP_RADIUS = 75; // 吸い付き判定範囲を広げてはめ込みやすく調整

        // 1. ドラッグしたブロック側の接続口
        const myConns = [];
        if (createdBlock.outputConnection) myConns.push(createdBlock.outputConnection);
        if (createdBlock.previousConnection) myConns.push(createdBlock.previousConnection);
        const lastBlock = createdBlock.lastConnectionInStack ? createdBlock.lastConnectionInStack() : createdBlock;
        if (lastBlock && lastBlock.nextConnection) myConns.push(lastBlock.nextConnection);

        if (myConns.length === 0) return;

        // 2. ワークスペース内の接続候補を探す
        let bestDist = SNAP_RADIUS;
        let bestMyConn = null;
        let bestTargetConn = null;

        const allBlocks = ws.getAllBlocks(false);
        for (const other of allBlocks) {
            if (other === createdBlock || other.getRootBlock() === createdBlock) continue;

            const targetConns = [];
            if (other.previousConnection) targetConns.push(other.previousConnection);
            if (other.nextConnection) targetConns.push(other.nextConnection);

            // ブロック内の穴（数値や条件、枠の中など）
            if (other.inputList) {
                for (const input of other.inputList) {
                    if (input.connection) targetConns.push(input.connection);
                }
            }

            // 既にデフォルト値（シャドウブロック）が刺さっている穴もターゲットにする
            if (typeof other.isShadow === "function" && other.isShadow()) {
                if (other.outputConnection && other.outputConnection.targetConnection) {
                    targetConns.push(other.outputConnection.targetConnection);
                }
            }

            for (const myC of myConns) {
                for (const targetC of targetConns) {
                    if (!targetC) continue;

                    // 接続可能か判定（型チェック等）
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

                    // 2つの接続口の距離を測定
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

        // 3. 最寄りの穴・コネクタに合体・挿入
        if (bestMyConn && bestTargetConn) {
            try {
                // 親の穴（INPUT_VALUE / NEXT_STATEMENT）から接続してシャドウ値を正しく上書き
                if (bestTargetConn.type === 1 || bestTargetConn.type === 3) {
                    bestTargetConn.connect(bestMyConn);
                } else {
                    bestMyConn.connect(bestTargetConn);
                }

                createdBlock.render();
                const root = createdBlock.getRootBlock();
                if (root && typeof root.render === "function") root.render();
            } catch (err) {
                console.warn("[JS Code Stock] autoConnect failed:", err);
            }
        }
    }

    // ドラッグ＆ドロップ配置：逃げないように弾き飛ばし処理を撤廃し、数値穴へも確実に結合
    function attachDragOutListener(item, nameEl) {
        nameEl.addEventListener("mousedown", (e) => {
            if (e.button !== 0) return;
            if (interactionMode === "blockEntry") return;

            e.preventDefault();

            const startX = e.clientX, startY = e.clientY;
            let isDragging = false;
            let createdBlock = null;
            let ws = null;

            const onMouseMove = (moveEvent) => {
                if (!panel) return;
                const rect = panel.getBoundingClientRect();
                const isOutside = moveEvent.clientX < rect.left || moveEvent.clientX > rect.right ||
                    moveEvent.clientY < rect.top || moveEvent.clientY > rect.bottom;

                // パネル外へ出た瞬間に生成
                if (!isDragging && isOutside) {
                    isDragging = true;
                    ws = _Blockly.getMainWorkspace && _Blockly.getMainWorkspace();
                    if (ws) {
                        createdBlock = createBlockInstance(ws, item);
                    }
                }

                // マウス追従
                if (isDragging && createdBlock && ws) {
                    const coords = getWorkspaceCoords(ws, moveEvent);
                    const Coordinate = (_Blockly.utils && _Blockly.utils.Coordinate) || function (x, y) { this.x = x; this.y = y; };
                    if (typeof createdBlock.moveTo === "function") {
                        createdBlock.moveTo(new Coordinate(coords.x, coords.y));
                    }
                    if (typeof createdBlock.select === "function") {
                        createdBlock.select();
                    }
                }
            };

            const onMouseUp = (upEvent) => {
                document.removeEventListener("mousemove", onMouseMove);
                document.removeEventListener("mouseup", onMouseUp);

                if (isDragging) {
                    if (createdBlock && ws) {
                        const coords = getWorkspaceCoords(ws, upEvent);
                        const Coordinate = (_Blockly.utils && _Blockly.utils.Coordinate) || function (x, y) { this.x = x; this.y = y; };
                        if (typeof createdBlock.moveTo === "function") {
                            createdBlock.moveTo(new Coordinate(coords.x, coords.y));
                        }
                        if (typeof createdBlock.render === "function") createdBlock.render();

                        // ★ 数値の穴やブロック間にパチンとはめ込む
                        autoConnectBlock(createdBlock);

                        if (typeof createdBlock.select === "function") createdBlock.select();
                        // ※ bumpNeighbours（弾き飛ばして逃げる原因）は完全撤廃しました
                    }

                    if (isTempExpanded) {
                        isTempExpanded = false;
                        isCollapsed = true;
                        renderPanel();
                    } else if (!isPinned) {
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

    // クリック時の処理：貼り付けモード時もパネルを閉じない
    function handleItemClick(item, nameEl) {
        if (interactionMode === "workspacePaste") {
            pasteSerializedStock(item.body).then(() => {
                setStatus("Pasted into workspace");

                // ★ 一時展開されていた場合はその場で再び折りたたむ
                if (isTempExpanded) {
                    isTempExpanded = false;
                    isCollapsed = true;
                    renderPanel();
                } else if (!isPinned) {
                    closePanel();
                }
            }).catch(e => setStatus(String(e)));
        } else {
            copyText(item.body).then(() => {
                const msg = document.createElement("span");
                msg.textContent = " COPY OK!";
                msg.style.color = "#4a7bd4";
                msg.style.fontSize = "13px";
                msg.style.fontWeight = "bold";
                msg.style.transition = "opacity 0.5s";
                nameEl.appendChild(msg);
                setTimeout(() => {
                    msg.style.opacity = "0";
                    setTimeout(() => msg.remove(), 500);
                }, 500);
            }).catch(e => setStatus(String(e)));
        }
    }

    

    // ⚙️ 設定プルダウンメニュー
    function showSettingsMenu(anchorBtn) {
        const old = document.getElementById("jcs-settings-menu");
        if (old) { old.remove(); return; }

        const rect = anchorBtn.getBoundingClientRect();
        const menu = document.createElement("div");
        menu.id = "jcs-settings-menu";
        menu.style.left = Math.min(rect.left, window.innerWidth - 220) + "px";
        menu.style.top = (rect.bottom + 4) + "px";

        // 1. 全体 EXPORT / IMPORT ボタン
        const expBtn = makeButton("EXPORT", () => { exportData(); menu.remove(); }, "jcs-menu-btn");
        const impBtn = makeButton("IMPORT", () => { importData(); menu.remove(); }, "jcs-menu-btn");

        // 2. タグ専用 TagsExport / TagsImport ボタン
        const tagsExpBtn = makeButton("TagsExport", () => {
            exportCurrentTagData();
            menu.remove();
        }, "jcs-menu-btn");
        tagsExpBtn.style.background = "#3d4b3d";
        tagsExpBtn.onmouseenter = () => tagsExpBtn.style.background = "#4e6a4e";
        tagsExpBtn.onmouseleave = () => tagsExpBtn.style.background = "#3d4b3d";

        const tagsImpBtn = makeButton("TagsImport", () => {
            importCurrentTagData();
            menu.remove();
        }, "jcs-menu-btn");
        tagsImpBtn.style.background = "#3d4b3d";
        tagsImpBtn.onmouseenter = () => tagsImpBtn.style.background = "#4e6a4e";
        tagsImpBtn.onmouseleave = () => tagsImpBtn.style.background = "#3d4b3d";

        const sep1 = document.createElement("div");
        sep1.className = "jcs-menu-sep";

        // 3. PARENT カウンター行 [ - 4 + ]
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
                    for (let c = 0; c < 8; c++) newChildren.push(char + "-" + c);
                    state.children.push(newChildren);
                }
                pVal.textContent = state.parentCount;
                saveState();
                renderPanel();
            }
        });
        pCounter.append(pMinus, pVal, pPlus);
        pRow.append(pLabel, pCounter);

        // 4. CHILD カウンター行 [ - 6 + ]
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
                        arr.push(pChar + "-" + arr.length);
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

        // 5. 初期化ボタン
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

        // メニューの配置（EXPORT / IMPORT / TagsExport / TagsImport / PARENT / CHILD / RESET）
        menu.append(expBtn, impBtn, tagsExpBtn, tagsImpBtn, sep1, pRow, cRow, sep2, resetBtn);
        document.body.appendChild(menu);

        setTimeout(() => {
            document.addEventListener("click", (e) => {
                if (!menu.contains(e.target) && e.target !== anchorBtn) {
                    menu.remove();
                }
            }, { once: true });
        }, 10);
    }

    function renderPanel() {
        if (!panel) return;
        // ★ 再描画前に入力欄に入っている内容を一時退避
        const preservedTitle = titleEl ? titleEl.value : null;
        const preservedBody = bodyEl ? bodyEl.value : null;
        panel.innerHTML = "";

        const container = document.createElement("div");
        container.className = "jcs-container";

        const head = document.createElement("div");
        head.className = "jcs-head";
        const ttl = document.createElement("div");
        ttl.className = "jcs-title";
        // 折りたたみ時はタイトルの横にマークを表示して分かりやすく
        ttl.textContent = isCollapsed ? "🐛JS Stock ▶" : "🐛JS Stock ▼";
        ttl.title = "Click to minimize/expand (drag to move)";

        const tools = document.createElement("div");
        tools.className = "jcs-tools";

        // ⚙️ 設定ボタン
        const gearBtn = makeButton("⚙️", (e) => {
            e.stopPropagation();
            showSettingsMenu(gearBtn);
        }, "jcs-gear");
        gearBtn.title = "Settings (EXPORT / IMPORT / Change Number of Tabs)";

        // 🔒️ / 🔓️ ピン留めボタン
        const pinBtn = makeButton(isPinned ? "🔒️" : "🔓️", () => {
            isPinned = !isPinned;
            renderPanel();
        }, "jcs-pin" + (isPinned ? "" : " unlocked"));
        pinBtn.title = isPinned ? "Locked(does not close after use)" : "Unlocked(closes automatically after use)";

        // ✕ 閉じるボタン
        const close = makeButton("✕", closePanel, "jcs-close");
        close.title = "Close";

        // ★ 並び順：⚙️ 🔒️ ✕ （⬒ボタンは撤廃）
        tools.append(gearBtn, pinBtn, close);
        head.append(ttl, tools);

        // 最小化（折りたたみ）時はタイトルバーのみ描画して終了
        if (isCollapsed) {
            panel.classList.add("collapsed");
            container.appendChild(head);
            panel.appendChild(container);
            return;
        }

        panel.classList.remove("collapsed");

        // ★ 修正：600pxで上書きせず、記憶された高さ（または変更後の高さ）を適用
        if (state.windowBounds && state.windowBounds.height) {
            panel.style.height = state.windowBounds.height + "px";
        } else if (savedPanelHeight) {
            panel.style.height = savedPanelHeight;
        }

        // 親タブ
        const parentTabs = document.createElement("div");
        parentTabs.className = "jcs-tabs";
        state.parents.slice(0, state.parentCount || 4).forEach((name, i) => {
            const b = makeButton(name, () => { state.filterParent = i; renderPanel(); }, "jcs-tab" + (state.filterParent === i ? " active" : ""));
            b.oncontextmenu = e => {
                e.preventDefault();
                showFolderMenu(e, "parent", i); // ★ 親フォルダメニューを表示
            };
            parentTabs.appendChild(b);
        });

        // 子タブ
        const childTabs = document.createElement("div");
        childTabs.className = "jcs-tabs jcs-child";
        (state.children[state.filterParent] || []).slice(0, state.childCount || 6).forEach((name, i) => {
            const b = makeButton(name, () => { state.filterChild[state.filterParent] = i; renderPanel(); }, "jcs-tab" + (state.filterChild[state.filterParent] === i ? " active" : ""));
            b.oncontextmenu = e => {
                e.preventDefault();
                showFolderMenu(e, "child", i); // ★ 子フォルダメニューを表示
            };
            childTabs.appendChild(b);
        });

        const colorTabs = document.createElement("div");
        colorTabs.className = "jcs-tabs jcs-colors";
        state.palette.slice(0, COLOR_COUNT).forEach((c, i) => {
            const b = makeButton("", () => { state.currentColor = i; renderPanel(); }, "jcs-tab" + (state.currentColor === i ? " active" : ""));
            b.style.background = c;
            b.title = "Color " + (i + 1) + " — right click to change";
            b.oncontextmenu = e => {
                e.preventDefault();
                const picker = document.createElement("input");
                picker.type = "color"; picker.value = state.palette[i];
                picker.onchange = () => { state.palette[i] = picker.value; saveState(); renderPanel(); };
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
        titleEl = document.createElement("input");
        titleEl.placeholder = "🏷️Code name";
        const clearTitle = makeButton("✕", () => { titleEl.value = ""; titleEl.focus(); }, "jcs-clear");
        titleWrap.append(titleEl, clearTitle);

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
        const clearBody = makeButton("✕", () => { bodyEl.value = ""; bodyEl.focus(); }, "jcs-clear");
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
            if (inputHidden) editingIdValue = null;
            renderPanel();
            if (!inputHidden && titleEl) titleEl.focus();
        });
        toggle.id = "jcs-toggle-input";
        inputSection.appendChild(toggle);

        if (inputHidden) {
            inputRow.classList.add("jcs-hidden");
            colorTabs.classList.add("jcs-hidden");
        } else if (hasEditingId()) {
            const item = state.items.find(x => x.id === editingIdValue);
            if (item) {
                // ★ 新しくEDITを押した時はアイテムのコードと名称を確実にセット
                if (lastEditingId !== editingIdValue) {
                    titleEl.value = item.title;
                    bodyEl.value = item.body;
                    lastEditingId = editingIdValue;
                } else {
                    // 同じアイテムの編集中にタブや色を変えた時は編集中の文字を維持
                    titleEl.value = preservedTitle !== null ? preservedTitle : item.title;
                    bodyEl.value = preservedBody !== null ? preservedBody : item.body;
                }
                titleEl.style.borderLeft = "6px solid " + state.palette[item.color || 0];
                titleEl.style.paddingLeft = "6px";
            }
        } else {
            lastEditingId = null;
            if (preservedTitle !== null) titleEl.value = preservedTitle;
            if (preservedBody !== null) bodyEl.value = preservedBody;
            titleEl.style.borderLeft = "6px solid " + state.palette[state.currentColor];
            titleEl.style.paddingLeft = "6px";
        }

        const filter = document.createElement("div");
        filter.className = "jcs-filter";
        const fc = document.createElement("div");
        fc.className = "jcs-tabs jcs-filter-colors";

        const all = makeButton("ALL", () => { state.filterColor = null; renderPanel(); }, "jcs-tab" + (state.filterColor === null ? " active" : ""));
        fc.appendChild(all);
        state.palette.slice(0, COLOR_COUNT).forEach((c, i) => {
            const b = makeButton("", () => { state.filterColor = state.filterColor === i ? null : i; renderPanel(); }, "jcs-tab" + (state.filterColor === i ? " active" : ""));
            b.style.background = c;
            fc.appendChild(b);
        });
        searchEl = document.createElement("input");
        searchEl.className = "jcs-search";
        searchEl.placeholder = "🔎search";
        searchEl.oninput = renderList;
        filter.append(fc, searchEl);

        listEl = document.createElement("div");
        listEl.className = "jcs-list";

        const foot = document.createElement("div");
        foot.className = "jcs-foot";
        statusEl = document.createElement("span");
        statusEl.className = "jcs-status";
        statusEl.textContent = "Ready";
        foot.appendChild(statusEl);

        container.append(head, parentTabs, childTabs, colorTabs, inputSection, filter, listEl, foot);
        panel.appendChild(container);
        renderList();
    }

    function hasEditingId() { return !!editingIdValue; }

    function renderList() {
        if (!listEl) return;
        listEl.innerHTML = "";
        const q = searchEl ? searchEl.value.toLowerCase() : "";
        let filtered = state.items.filter(item =>
            item.parent === state.filterParent &&
            item.child === state.filterChild[state.filterParent] &&
            (state.filterColor === null || (item.color || 0) === state.filterColor) &&
            String(item.title).toLowerCase().includes(q)
        );
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

            // Drag handle (リスト内順序並び替え用)
            const drag = document.createElement("button");
            drag.className = "jcs-drag" + (selectedIds.has(id) ? " active" : "");
            drag.textContent = "≡";
            drag.draggable = true;

            drag.oncontextmenu = (e) => {
                e.preventDefault();
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

            // コード名要素（ドラッグアウトでワークスペース配置、クリックでコピー）
            const name = document.createElement("div");
            name.className = "jcs-name";
            name.style.borderLeftColor = state.palette[item.color || 0];
            name.textContent = item.title;
            name.title = "Drag and drop onto the workspace / Click to copy";
            attachDragOutListener(item, name);

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
                    showConfirm(e.clientX, e.clientY, "delete it?", () => {
                        state.items = state.items.filter(i => !selectedIds.has(String(i.id)));
                        selectedIds.clear();
                        lastSelected = null;
                        reorderGroup(item.parent, item.child);
                        saveState();
                        renderList();
                    });
                }, "jcs-btn-del")
            );

            row.append(drag, name, actions);
            listEl.appendChild(row);
        });

        // リスト最下部のドロップ・貼り付けエリア
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

        if (!filtered.length) {
            const empty = document.createElement("div");
            empty.style.padding = "20px";
            empty.style.textAlign = "center";
            empty.style.color = "#888";
            empty.textContent = "No snippets";
            listEl.appendChild(empty);
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

    // カテゴリタブの右クリックメニュー（名称変更 ＆ TAB丸ごとCopy/Paste上書き）
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
        box.style.Width = "100px";

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
        const pasteBtn = makeButton("Folder: Paste ", () => {
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

        box.append(t, input, rowBtn, sep, copyBtn, pasteBtn);
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

    async function pasteSerializedStock(text) {
        const ws = _Blockly.getMainWorkspace && _Blockly.getMainWorkspace();
        if (!ws) throw new Error("No workspace available");
        let data;
        try { data = JSON.parse(text); }
        catch (_) { throw new Error("Code Stock entry is not valid JSON"); }

        const varDefs = extractVariableDefinitions(data);
        if (varDefs.length > 0) registerVariablesBeforePaste(ws, varDefs);
        data = renameSubroutineIfNeeded(ws, data);
        data = sanitizeForWorkspace(ws, data);

        const originalX = typeof data.x === "number" ? data.x : ((data.blocks && data.blocks[0] && data.blocks[0].x) || 0);
        const originalY = typeof data.y === "number" ? data.y : ((data.blocks && data.blocks[0] && data.blocks[0].y) || 0);
        let mousePos = null;
        try {
            let canvas = typeof ws.getCanvas === "function" ? ws.getCanvas() : null;
            if (!canvas) canvas = document.querySelector(".blocklyBlockCanvas");
            const pointerEvent = lastContextMenuEvent || lastMouseEvent;
            if (pointerEvent && canvas && canvas.ownerSVGElement && typeof canvas.getScreenCTM === "function") {
                const pt = canvas.ownerSVGElement.createSVGPoint();
                pt.x = pointerEvent.clientX; pt.y = pointerEvent.clientY;
                const ctm = canvas.getScreenCTM();
                if (ctm && typeof ctm.inverse === "function") {
                    const p = pt.matrixTransform(ctm.inverse());
                    mousePos = { x: p.x, y: p.y };
                }
            }
        } catch (_) { }
        if (!mousePos) {
            try { mousePos = plugin.getMouseCoords ? plugin.getMouseCoords() : null; } catch (_) { }
        }
        if (!mousePos) {
            const metrics = ws.getMetrics ? ws.getMetrics() : {};
            mousePos = { x: (metrics.viewLeft || 0) + (metrics.viewWidth || 0) / 2, y: (metrics.viewTop || 0) + (metrics.viewHeight || 0) / 2 };
        }
        const dx = mousePos.x - originalX, dy = mousePos.y - originalY;
        traverseSerializedBlocks(data, b => { b.x = (b.x || 0) + dx; b.y = (b.y || 0) + dy; });

        if (_Blockly.serialization && _Blockly.serialization.blocks && typeof _Blockly.serialization.blocks.append === "function") {
            _Blockly.serialization.blocks.append(data, ws);
        } else if (data._legacyXml && typeof Blockly !== "undefined" && Blockly.Xml) {
            const dom = Blockly.Xml.textToDom(data._legacyXml);
            Blockly.Xml.domToWorkspace(dom, ws);
        } else throw new Error("No compatible Blockly paste API");
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
        state.filterParent = 0;
        state.filterChild = Array(PARENT_COUNT).fill(0);

        // ★ 折りたたみ中なら一時展開
        if (isCollapsed) {
            isTempExpanded = true;
            isCollapsed = false;
        }

        openPanel();
        renderPanel();
        setStatus("Select or drag a code entry into workspace");
    }

    function openBlockEntryMode(block) {
        try {
            const data = extractBlockForClipboard(block);
            if (!data) throw new Error("Unable to serialize block");
            pendingBlockData = data;
            copyText(JSON.stringify(data, null, 2)).catch(() => { });
            interactionMode = "blockEntry";
            editingIdValue = null;
            inputHidden = false;

            // ★ 親0・子0へのリセットを削除（現在選択中のカテゴリをそのまま維持）

            if (isCollapsed) {
                isTempExpanded = true;
                isCollapsed = false;
            }

            openPanel();
            renderPanel();
            titleEl.value = blockTypeName(data);
            bodyEl.value = JSON.stringify(data, null, 2);
            setStatus("Block copied — ADD to save, CANCEL to close");
            setTimeout(() => titleEl && titleEl.focus(), 0);
        } catch (e) {
            BF2042Portal.Shared.logError("JS Code Stock block entry", String(e));
        }
    }


    function addItem() {
        const title = titleEl && titleEl.value.trim();
        const body = bodyEl ? bodyEl.value : "";
        if (!title) return setStatus("Code name is required");

        if (editingIdValue) {
            const item = state.items.find(x => x.id === editingIdValue);
            if (item) {
                item.title = title;
                item.body = body;
                item.parent = state.filterParent;
                item.child = state.filterChild[state.filterParent];
                item.color = state.currentColor;
            }
        } else {
            state.items.push({
                id: uid(),
                title,
                body,
                parent: state.filterParent,
                child: state.filterChild[state.filterParent],
                order: nextOrder(),
                color: state.currentColor
            });
        }

        // 編集モードを終了して保存
        editingIdValue = null;
        lastEditingId = null;
        saveState();

        // ★ コード・名称欄をクリアし、入力パネルを閉じる
        if (titleEl) titleEl.value = "";
        if (bodyEl) bodyEl.value = "";
        inputHidden = true;

        // ブロックから直接登録した場合の終了処理
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

    function nextOrder() {
        const group = state.items.filter(x =>
            x.parent === state.filterParent &&
            x.child === state.filterChild[state.filterParent]
        );
        return group.length;
    }

    function editItem(item) {
        editingIdValue = item.id;
        lastEditingId = null; // ★ リセットして必ずアイテムのデータを読み込ませる
        state.filterParent = item.parent;
        state.filterChild[item.parent] = item.child;
        state.currentColor = item.color || 0;
        inputHidden = false;
        renderPanel();
        if (titleEl) titleEl.focus();
    }

    function cancelEdit() {
        editingIdValue = null;
        lastEditingId = null;
        if (titleEl) titleEl.value = "";
        if (bodyEl) bodyEl.value = "";

        // ★ 入力欄を閉じた状態（≡ NEW ENTRY ≡）にする
        inputHidden = true;

        // ブロックから直接登録（新規入力モード）をキャンセルした場合
        if (interactionMode === "blockEntry") {
            interactionMode = "normal";
            pendingBlockData = null;

            // ⬒から一時展開されていた場合はその場で再折りたたみ
            if (isTempExpanded) {
                isTempExpanded = false;
                isCollapsed = true;
                renderPanel();
                return;
            }

            // 🔓️（アンロック）ならパネルごと閉じる、🔒️（ロック）ならパネルは開いたまま入力欄だけ閉じる
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

    function exportData() {
        const data = {
            items: state.items,
            config: {
                parentCount: state.parentCount || 4,
                childCount: state.childCount || 6,
                parents: state.parents,   // ★ カスタム親カテゴリ名
                children: state.children, // ★ カスタム子カテゴリ名
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
                    if (!confirm("Overwrite current JS Code Stock data?")) return;
                    if (Array.isArray(data.items)) state.items = data.items;
                    if (data.config) {
                        // ★ カテゴリ数設定の復元
                        if (data.config.parentCount) state.parentCount = Math.max(1, Math.min(8, Number(data.config.parentCount) || 4));
                        if (data.config.childCount) state.childCount = Math.max(1, Math.min(8, Number(data.config.childCount) || 6));

                        // ★ 変更した親カテゴリ名・子カテゴリ名の完全復元
                        if (Array.isArray(data.config.parents)) {
                            state.parents = data.config.parents.slice();
                        }
                        if (Array.isArray(data.config.children)) {
                            state.children = data.config.children.map(arr => Array.isArray(arr) ? arr.slice() : []);
                        }
                        if (Array.isArray(data.config.palette) && data.config.palette.length === COLOR_COUNT) {
                            state.palette = data.config.palette.slice();
                        }
                    }
                    saveState();
                    renderPanel();
                    setStatus("Import complete");
                } catch (e) {
                    setStatus("Loading failed");
                    BF2042Portal.Shared.logError("JS Code Stock import", String(e));
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }

    // 現在選択しているタグ（親・子）のコードリストのみをエクスポート
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
            items: targetItems.map(i => ({
                title: i.title,
                body: i.body,
                color: i.color || 0
            }))
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

    // 現在選択しているタグへ、純粋にコードリストのみを末尾追加
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
            reader.onload = () => {
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

                    importList.forEach(item => {
                        if (item && item.title) {
                            state.items.push({
                                id: uid(),
                                title: item.title,
                                body: item.body || "",
                                parent: pIdx,
                                child: cIdx,
                                order: nextOrderNum++,
                                color: (item.color !== undefined) ? item.color : state.currentColor
                            });
                            addedCount++;
                        }
                    });

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


    // ウィンドウの位置とサイズを記憶
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
            // ★ ユーザーが変更した高さを記憶値として更新
            savedPanelHeight = h + "px";
            saveState();
        }
    }

    // 記憶した位置とサイズを適用
    function applySavedWindowBounds() {
        if (!panel || !state.windowBounds) return false;
        const b = state.windowBounds;
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        // ★ サイズ（幅・高さ）はお好みの大きさを常に維持
        if (b.width) panel.style.width = Math.max(320, Math.min(b.width, vw - 16)) + "px";
        if (b.height) panel.style.height = Math.max(200, Math.min(b.height, vh - 16)) + "px";

        // ★ 位置（座標）は「🔒️（ロック中）」の時だけ記憶位置に固定する
        if (isPinned && b.left !== null && b.top !== null) {
            const maxL = Math.max(8, vw - (b.width || 400) - 8);
            const maxT = Math.max(8, vh - (b.height || 600) - 8);
            panel.style.left = Math.max(8, Math.min(b.left, maxL)) + "px";
            panel.style.top = Math.max(8, Math.min(b.top, maxT)) + "px";
            panel.style.right = "auto";
            return true; // 位置固定完了
        }

        return false; // ロック解除（🔓️）中なのでカーソル位置へ移動させる
    }

    function openPanel() {
        if (panel) {
            panel.style.display = "flex";
            renderPanel();
            enablePanelDragging();

            // 🔒️なら記憶位置に固定、🔓️ならマウスカーソルのすぐ近くに表示
            const isPositionFixed = applySavedWindowBounds();
            if (!isPositionFixed) {
                requestAnimationFrame(positionPanelAtContext);
            }
            return;
        }

        injectStyle();
        panel = document.createElement("div");
        panel.id = "js-code-stock-panel";
        document.body.appendChild(panel);
        renderPanel();
        enablePanelDragging();

        // 🔒️なら記憶位置に固定、🔓️ならマウスカーソルのすぐ近くに表示
        const isPositionFixed = applySavedWindowBounds();
        if (!isPositionFixed) {
            requestAnimationFrame(positionPanelAtContext);
        }
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

    function enablePanelDragging() {
        if (!panel || panel._dragInitialized) return;
        panel._dragInitialized = true;

        panel.addEventListener("mouseup", () => {
            if (!isCollapsed) saveWindowBounds();
        });

        panel.addEventListener("mousedown", e => {
            if (e.button !== 0) return;
            const title = e.target.closest(".jcs-title");
            if (!title) return;

            e.preventDefault();
            const r = panel.getBoundingClientRect();
            const startX = e.clientX, startY = e.clientY;
            const startLeft = r.left, startTop = r.top;
            let hasMoved = false;

            const move = ev => {
                const dist = Math.hypot(ev.clientX - startX, ev.clientY - startY);
                // 5px以上動いた時だけ「ドラッグ移動」と判定
                if (dist > 5) {
                    hasMoved = true;
                    const maxLeft = Math.max(8, window.innerWidth - panel.offsetWidth - 8);
                    const maxTop = Math.max(8, window.innerHeight - panel.offsetHeight - 8);
                    panel.style.left = Math.max(8, Math.min(startLeft + ev.clientX - startX, maxLeft)) + "px";
                    panel.style.top = Math.max(8, Math.min(startTop + ev.clientY - startY, maxTop)) + "px";
                    panel.style.right = "auto";
                }
            };

            const up = () => {
                document.removeEventListener("mousemove", move);
                document.removeEventListener("mouseup", up);

                if (hasMoved) {
                    // ★ 移動させた場合：位置を保存（折りたたみは行わない）
                    saveWindowBounds();
                } else {
                    // ★ 移動させずにクリックした場合：最小化 / 展開をトグル
                    isCollapsed = !isCollapsed;
                    if (isCollapsed && panel.style.height && panel.style.height !== "auto") {
                        savedPanelHeight = panel.style.height;
                    }
                    renderPanel();
                }
            };

            document.addEventListener("mousemove", move);
            document.addEventListener("mouseup", up);
        });
    }

    function openPanel() {
        if (panel) {
            panel.style.display = "flex";
            renderPanel();
            enablePanelDragging();

            // 記憶された位置・サイズを復元（初回など未保存の場合のみカーソル位置へ）
            const hasBounds = applySavedWindowBounds();
            if (!hasBounds && !isPinned) {
                requestAnimationFrame(positionPanelAtContext);
            }
            return;
        }

        injectStyle();
        panel = document.createElement("div");
        panel.id = "js-code-stock-panel";
        document.body.appendChild(panel);
        renderPanel();
        enablePanelDragging();

        const hasBounds = applySavedWindowBounds();
        if (!hasBounds) {
            requestAnimationFrame(positionPanelAtContext);
        }
    }

    function closePanel() {
        if (isTempExpanded) {
            isTempExpanded = false;
            isCollapsed = true;
        }
        if (panel) panel.style.display = "none";
        interactionMode = "normal";
        pendingBlockData = null;
    }

    let menusRegistered = false;

    function registerMenus() {
        if (menusRegistered) return;
        const Scope = _Blockly.ContextMenuRegistry.ScopeType;

        const workspaceItem = {
            id: "jsCodeStockWorkspace",
            displayText: "JS Code Stock",
            scopeType: Scope.WORKSPACE,
            weight: 90,
            preconditionFn: () => "enabled",
            callback: () => openWorkspacePasteMode()
        };
        plugin.registerItem(workspaceItem);
        _Blockly.ContextMenuRegistry.registry.register(workspaceItem);

        const blockItem = {
            id: "jsCodeStockBlock",
            displayText: "JS Code Stock",
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
        await loadState(); // IndexedDB から読み込み
        try { registerMenus(); } catch (e) { BF2042Portal.Shared.logError("JS Code Stock menu registration", String(e)); }
        try {
            const ws = _Blockly.getMainWorkspace && _Blockly.getMainWorkspace();
            attachMouseTracking(ws);
        } catch (_) { }
    };

})();
