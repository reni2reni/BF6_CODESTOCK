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
    let editingId = null;
    let inputHidden = false;
    let selectedIds = new Set();
    let panel = null;
    let listEl = null;
    let searchEl = null;
    let titleEl = null;
    let bodyEl = null;
    let statusEl = null;
    // Interaction modes:
    // workspacePaste = blank-area click -> choose stock -> paste into workspace
    // blockEntry = block click -> copy serialized block -> new-entry form
    let interactionMode = "normal";
    let pendingBlockData = null;
    let lastMouseEvent = null;
    let lastContextMenuEvent = null;

    function cloneDefault() {
        return {
            items: [],
            parents: DEFAULT_PARENTS.slice(),
            children: DEFAULT_CHILDREN.map(x => x.slice()),
            palette: DEFAULT_PALETTE.slice(),
            filterParent: 0,
            filterChild: [0, 0, 0, 0],
            filterColor: null,
            currentColor: 0
        };
    }

    function loadState() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            const saved = JSON.parse(raw);
            const d = cloneDefault();
            state = Object.assign(d, saved);

            // 初期のタブ選択は常に 親0、子0 にリセット
            state.filterParent = 0;
            state.filterChild = Array(PARENT_COUNT).fill(0);

            if (!Array.isArray(state.parents) || state.parents.length !== PARENT_COUNT) state.parents = d.parents;
            if (!Array.isArray(state.children) || state.children.length !== PARENT_COUNT) {
                state.children = d.children;
            } else {
                state.children = state.children.map((children, parentIndex) => {
                    const next = Array.isArray(children) ? children.slice(0, CHILD_COUNT) : [];
                    while (next.length < CHILD_COUNT) next.push(d.children[parentIndex][next.length]);
                    return next;
                });
            }
            if (!Array.isArray(state.palette) || state.palette.length !== COLOR_COUNT) state.palette = d.palette;
            if (!Array.isArray(state.items)) state.items = [];
        } catch (e) {
            console.error("[JS Code Stock] load failed", e);
        }
    }

    function saveState() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
            setStatus("Saved");
        } catch (e) {
            setStatus("Save failed");
            BF2042Portal.Shared.logError("JS Code Stock", String(e));
        }
    }

    function uid() {
        if (crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
        return "item-" + Date.now() + "-" + Math.random().toString(16).slice(2);
    }

    function esc(s) {
        return String(s ?? "").replace(/[&<>"']/g, c => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        }[c]));
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

    function pasteText() {
        if (BF2042Portal.Shared && BF2042Portal.Shared.pasteTextFromClipboard) {
            return Promise.resolve(BF2042Portal.Shared.pasteTextFromClipboard());
        }
        if (navigator.clipboard && navigator.clipboard.readText) {
            return navigator.clipboard.readText();
        }
        return Promise.reject(new Error("Clipboard API unavailable"));
    }

    function injectStyle() {
        if (document.getElementById("js-code-stock-style")) return;
        const style = document.createElement("style");
        style.id = "js-code-stock-style";
        style.textContent = `
#js-code-stock-panel{position:fixed;left:18px;top:58px;width:400px;height:600px;min-width:320px;min-height:320px;max-width:calc(100vw - 36px);max-height:calc(100vh - 76px);z-index:2147483646;background:#111;color:#fff;border:1px solid #333;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.6);font-family:sans-serif;display:flex;flex-direction:column;overflow:hidden;padding:6px;resize:both}
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
#js-code-stock-panel .jcs-add,#js-code-stock-panel .jcs-cancel{width:76px;min-width:76px;height:28px}
#js-code-stock-panel .jcs-clear{position:absolute;right:4px;top:50%;transform:translateY(-50%);cursor:pointer;background:#555;color:#fff;border:none;border-radius:3px;width:20px;height:20px;font-size:14px;line-height:18px;z-index:10}
#js-code-stock-panel .jcs-clear:hover{background:#ad1a1a}
#js-code-stock-panel #jcs-toggle-input{width:100%;height:30px;background:#444;border:none;color:#fff;cursor:pointer;margin-top:3px;font-size:13px}
#js-code-stock-panel .jcs-filter{padding:0 0 3px;border-bottom:1px solid #333}
#js-code-stock-panel .jcs-filter-colors{display:flex;gap:4px;background:transparent;padding:0;overflow:visible;width:100%}
#js-code-stock-panel .jcs-filter-colors .jcs-tab{flex:1;min-width:0;height:18px;padding:0;box-shadow:none;transform:none;border-radius:2px;font-size:11px;display:flex;align-items:center;justify-content:center}
#js-code-stock-panel .jcs-filter-colors .jcs-tab.active{border:2px solid #fff;box-shadow:inset 0 0 0 1px rgba(0,0,0,.35);z-index:4}
#js-code-stock-panel .jcs-search{height:30px;font-size:18px;margin-top:3px}
#js-code-stock-panel .jcs-list{flex:1;overflow:auto;margin-top:4px;min-height:0;padding-right:2px}
#js-code-stock-panel .jcs-item{display:flex;background:#262626;padding:4px;margin-bottom:2px;cursor:pointer;font-size:16px;justify-content:space-between;align-items:center;border:1px solid transparent}
#js-code-stock-panel .jcs-item:hover{background:#333}
#js-code-stock-panel .jcs-item.selected{background:#2a2f3a;border-left:3px solid #4da3ff}
#js-code-stock-panel .jcs-drag{background:transparent!important;font-size:18px;padding:2px 4px;cursor:pointer}
#js-code-stock-panel .jcs-name{flex:1;margin-left:6px;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:2px 4px;border-left:6px solid #666}
#js-code-stock-panel .jcs-name:active{background:#555;transform:scale(.9)}
#js-code-stock-panel .jcs-actions{display:flex;gap:3px}
#js-code-stock-panel .jcs-actions button{font-size:12px;padding:3px 5px}
#js-code-stock-panel .jcs-actions button:hover{background:#0984e3}
#js-code-stock-panel .jcs-foot{padding-top:4px;border-top:1px solid #333;display:flex;justify-content:space-between;align-items:center}
#js-code-stock-panel .jcs-status{color:#aaa;font-size:11px}
#js-code-stock-panel .jcs-foot-tools{display:flex;gap:4px}
#js-code-stock-panel .jcs-small{font-size:11px;padding:4px 6px}
#js-code-stock-panel .jcs-hidden{display:none!important}
#js-code-stock-panel input:focus,#js-code-stock-panel textarea:focus{outline:1px solid #4a7bd4}
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

    function renderPanel() {
        if (!panel) return;
        panel.innerHTML = "";

        const container = document.createElement("div");
        container.className = "jcs-container";

        const head = document.createElement("div");
        head.className = "jcs-head";
        const ttl = document.createElement("div");
        ttl.className = "jcs-title";
        ttl.textContent = "🐛JS Stock";
        const tools = document.createElement("div");
        tools.className = "jcs-tools";
        tools.appendChild(makeButton("EXPORT", exportData));
        tools.appendChild(makeButton("IMPORT", importData));
        const close = makeButton("✕", closePanel, "jcs-close");
        close.title = "Close";
        tools.appendChild(close);
        head.append(ttl, tools);

        const parentTabs = document.createElement("div");
        parentTabs.className = "jcs-tabs";
        state.parents.slice(0, PARENT_COUNT).forEach((name, i) => {
            const b = makeButton(name, () => { state.filterParent = i; renderPanel(); }, "jcs-tab" + (state.filterParent === i ? " active" : ""));
            b.oncontextmenu = e => {
                e.preventDefault();
                const name2 = prompt("Folder name", state.parents[i]);
                if (name2 && name2.trim()) { state.parents[i] = name2.trim(); saveState(); renderPanel(); }
            };
            parentTabs.appendChild(b);
        });

        const childTabs = document.createElement("div");
        childTabs.className = "jcs-tabs jcs-child";
        state.children[state.filterParent].slice(0, CHILD_COUNT).forEach((name, i) => {
            const b = makeButton(name, () => { state.filterChild[state.filterParent] = i; renderPanel(); }, "jcs-tab" + (state.filterChild[state.filterParent] === i ? " active" : ""));
            b.oncontextmenu = e => {
                e.preventDefault();
                const name2 = prompt("SubFolder name", state.children[state.filterParent][i]);
                if (name2 && name2.trim()) { state.children[state.filterParent][i] = name2.trim(); saveState(); renderPanel(); }
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
                titleEl.value = item.title;
                bodyEl.value = item.body;
                titleEl.style.borderLeft = "6px solid " + state.palette[item.color || 0];
                titleEl.style.paddingLeft = "6px";
            }
        } else {
            titleEl.style.borderLeft = "6px solid " + state.palette[state.currentColor];
            titleEl.style.paddingLeft = "6px";
        }

        const filter = document.createElement("div");
        filter.className = "jcs-filter";
        const fc = document.createElement("div");
        fc.className = "jcs-tabs jcs-filter-colors";

        // ALLボタン・各カラータグともに均等配置（インライン幅指定を排除）
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
    let editingIdValue = null;

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
            const row = document.createElement("div");
            row.className = "jcs-item" + (selectedIds.has(String(item.id)) ? " selected" : "");
            const drag = makeButton("≡", () => {
                if (selectedIds.has(String(item.id))) selectedIds.delete(String(item.id));
                else { selectedIds.clear(); selectedIds.add(String(item.id)); }
                renderList();
            }, "jcs-drag");
            const name = document.createElement("div");
            name.className = "jcs-name";
            name.style.borderLeftColor = state.palette[item.color || 0];
            name.textContent = item.title;
            name.title = interactionMode === "workspacePaste" ? "Click to paste this code into the workspace" : "Click to copy code";
            name.onclick = async () => {
                if (interactionMode === "workspacePaste") {
                    await pasteSerializedStock(item.body);
                    closePanel();
                    interactionMode = "normal";
                    pendingBlockData = null;
                } else {
                    copyText(item.body).then(() => setStatus("COPY OK!")).catch(e => setStatus(String(e)));
                }
            };
            if (interactionMode !== "workspacePaste") name.ondblclick = () => editItem(item);
            const actions = document.createElement("div");
            actions.className = "jcs-actions";
            actions.append(
                makeButton("EDIT", () => editItem(item), "jcs-small"),
                makeButton("×", () => deleteItem(item), "jcs-small")
            );
            row.append(drag, name, actions);
            listEl.appendChild(row);
        });

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
                let id = null,
                    name = null,
                    type = "";
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
                        varsById.set(key, { id: id, name: name, type: type, isObjectVar: isObjectVar });
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
                        try { existing = varMap.getVariable(v.id); } catch (e) { existing = null; }
                    }
                    if (!existing && varMap && typeof varMap.getVariableById === "function") {
                        try { existing = varMap.getVariableById(v.id); } catch (e) { existing = null; }
                    }
                    if (!existing && varMap && typeof varMap.getVariableByName === "function") {
                        try { existing = varMap.getVariableByName(v.name); } catch (e) { existing = null; }
                    }
                    if (!existing && varMap && typeof varMap.getVariable === "function") {
                        try { existing = varMap.getVariable(v.name); } catch (e) { existing = null; }
                    }

                    if (existing) continue;

                    let created = null;
                    if (varMap && typeof varMap.createVariable === "function") {
                        try {
                            created = varMap.createVariable(v.name, v.type || "", v.id);
                        } catch (e) {
                            try {
                                created = varMap.createVariable(v.name, v.type || "", undefined);
                            } catch (e2) {
                                created = null;
                            }
                        }
                    }
                    if (!created && typeof ws.createVariable === "function") {
                        try {
                            created = ws.createVariable(v.name, v.type || "", v.id);
                        } catch (e) {
                            try {
                                created = ws.createVariable(v.name, v.type || "", undefined);
                            } catch (ee) {
                                created = null;
                            }
                        }
                    }

                    if (!created && typeof Blockly !== "undefined" && typeof Blockly.Variables !== "undefined") {
                        try {
                            if (typeof Blockly.Variables.createVariable === "function") {
                                created = Blockly.Variables.createVariable(ws, v.name, v.type || "", v.id);
                            }
                        } catch (e) {
                            created = null;
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
            try {
                existing = varMap.getVariable(name);
            } catch (e) {
                existing = null;
            }
            if (!existing && typeof varMap.getVariableByName === "function") {
                try {
                    existing = varMap.getVariableByName(name);
                } catch (e) {
                    existing = null;
                }
            }

            if (!existing) {
                if (typeof varMap.createVariable === "function") {
                    return varMap.createVariable(name, type || "", undefined);
                }
                if (typeof ws.createVariable === "function") {
                    return ws.createVariable(name, type || "", undefined);
                }
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
            if (b.type === "variableReferenceBlock") return;
            if (b.type === "subroutineArgumentBlock") return;

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
            }

            if (b.fields) {
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
                    } catch { }
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
        } catch (e) {
            try {
                if (typeof Blockly !== "undefined" && Blockly.Xml) {
                    const xml = Blockly.Xml.blockToDom(block, true);
                    return { _legacyXml: Blockly.Xml.domToText(xml) };
                }
            } catch (_) { }
            return null;
        }
    }

    function getBlockFromEventTarget(target) {
        const ws = _Blockly.getMainWorkspace && _Blockly.getMainWorkspace();
        if (!ws || !target || !target.closest) return null;
        const el = target.closest(".blocklyDraggable");
        if (!el) return null;
        const id = el.getAttribute("data-id") || el.getAttribute("data-block-id");
        if (id && typeof ws.getBlockById === "function") {
            const b = ws.getBlockById(id);
            if (b) return b;
        }
        try {
            const selected = plugin.getSelectedBlocks({}) || [];
            return selected.length === 1 ? selected[0] : null;
        } catch (_) {
            return null;
        }
    }

    async function copyBlockDataToPending(block) {
        const data = extractBlockForClipboard(block);
        if (!data) throw new Error("Unable to serialize block");
        pendingBlockData = data;
        await copyText(JSON.stringify(data, null, 2));
    }

    function renameSubroutineIfNeeded(ws, data) {
        try {
            if (!data || data.type !== "subroutineBlock") return data;

            const originalName =
                data.extraState?.subroutineName ||
                data.fields?.SUBROUTINE_NAME;

            if (!originalName) return data;

            const existingNames = new Set();

            const allBlocks = ws.getAllBlocks(false);
            for (const b of allBlocks) {
                if (b.type === "subroutineBlock") {
                    const name =
                        (b.extraState && b.extraState.subroutineName) ||
                        (b.getField && b.getField("SUBROUTINE_NAME")?.getValue());
                    if (name) existingNames.add(name);
                }
            }

            if (!existingNames.has(originalName)) return data;

            let i = 1;
            let newName = originalName + i;
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
        openPanel();
        renderPanel();
        setStatus("Select a code entry to paste");
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
            state.filterParent = 0;
            state.filterChild = Array(PARENT_COUNT).fill(0);
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
        editingIdValue = null;
        saveState();
        if (interactionMode === "blockEntry") {
            closePanel();
            interactionMode = "normal";
            pendingBlockData = null;
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
        state.filterParent = item.parent;
        state.filterChild[item.parent] = item.child;
        state.currentColor = item.color || 0;
        renderPanel();
        titleEl.focus();
    }

    function cancelEdit() {
        editingIdValue = null;
        if (titleEl) titleEl.value = "";
        if (bodyEl) bodyEl.value = "";
        if (interactionMode === "blockEntry") {
            closePanel();
            interactionMode = "normal";
            pendingBlockData = null;
            return;
        }
        renderPanel();
    }

    function deleteItem(item) {
        if (!confirm("Delete this snippet?")) return;
        state.items = state.items.filter(x => x.id !== item.id);
        selectedIds.delete(String(item.id));
        reorderGroup(item.parent, item.child);
        saveState();
        renderPanel();
    }

    function reorderGroup(parent, child) {
        state.items.filter(x => x.parent === parent && x.child === child)
            .sort((a, b) => (a.order || 0) - (b.order || 0))
            .forEach((x, i) => x.order = i);
    }

    function selectedItems() {
        return state.items.filter(x => selectedIds.has(String(x.id)));
    }

    function exportData() {
        const data = {
            items: state.items,
            config: {
                parents: state.parents,
                children: state.children,
                filterParent: state.filterParent,
                filterChild: state.filterChild,
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
                        if (Array.isArray(data.config.parents) && data.config.parents.length === PARENT_COUNT) {
                            state.parents = data.config.parents;
                        }
                        if (Array.isArray(data.config.children) && data.config.children.length === PARENT_COUNT) {
                            state.children = data.config.children.map((children, parentIndex) => {
                                const next = Array.isArray(children) ? children.slice(0, CHILD_COUNT) : [];
                                while (next.length < CHILD_COUNT) next.push(DEFAULT_CHILDREN[parentIndex][next.length]);
                                return next;
                            });
                        }
                        if (Array.isArray(data.config.palette) && data.config.palette.length === COLOR_COUNT) state.palette = data.config.palette;
                        if (data.config.filterParent !== undefined) state.filterParent = Math.max(0, Math.min(PARENT_COUNT - 1, Number(data.config.filterParent) || 0));
                        if (Array.isArray(data.config.filterChild)) {
                            state.filterChild = [0, 1, 2, 3].map((i) => {
                                const v = Number(data.config.filterChild[i]);
                                return Number.isInteger(v) && v >= 0 && v < CHILD_COUNT ? v : 0;
                            });
                        }
                    }
                    saveState(); renderPanel(); setStatus("Import complete");
                } catch (e) {
                    setStatus("Loading failed");
                    BF2042Portal.Shared.logError("JS Code Stock import", String(e));
                }
            };
            reader.readAsText(file);
        };
        input.click();
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

    // イベント委譲により、renderPanel が何度走っても確実にタイトル部でドラッグできるように修正
    function enablePanelDragging() {
        if (!panel || panel._dragInitialized) return;
        panel._dragInitialized = true;

        panel.addEventListener("mousedown", e => {
            if (e.button !== 0) return;
            const title = e.target.closest(".jcs-title");
            if (!title) return; // タイトルバー以外のクリックは無視

            e.preventDefault();
            const r = panel.getBoundingClientRect();
            const startX = e.clientX, startY = e.clientY;
            const startLeft = r.left, startTop = r.top;

            const move = ev => {
                const maxLeft = Math.max(8, window.innerWidth - panel.offsetWidth - 8);
                const maxTop = Math.max(8, window.innerHeight - panel.offsetHeight - 8);
                panel.style.left = Math.max(8, Math.min(startLeft + ev.clientX - startX, maxLeft)) + "px";
                panel.style.top = Math.max(8, Math.min(startTop + ev.clientY - startY, maxTop)) + "px";
                panel.style.right = "auto";
            };

            const up = () => {
                document.removeEventListener("mousemove", move);
                document.removeEventListener("mouseup", up);
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
            requestAnimationFrame(positionPanelAtContext);
            return;
        }
        injectStyle();
        panel = document.createElement("div");
        panel.id = "js-code-stock-panel";
        document.body.appendChild(panel);
        renderPanel();
        enablePanelDragging();
        requestAnimationFrame(positionPanelAtContext);
    }

    function closePanel() {
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

    plugin.initializeWorkspace = function () {
        loadState();
        try { registerMenus(); } catch (e) { BF2042Portal.Shared.logError("JS Code Stock menu registration", String(e)); }
        try {
            const ws = _Blockly.getMainWorkspace && _Blockly.getMainWorkspace();
            attachMouseTracking(ws);
        } catch (_) { }
    };

})();
