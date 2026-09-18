searchEl = document.createElement("input");
        searchEl.className = "jcs-search";
        searchEl.placeholder = "🔎search";
        searchEl.oninput = renderList;
        filter.append(fc, searchEl);

        // ★ 見出しバー（TAB ▶/▼ 切り替えボタン ＆ CodeLists タイトル）
        const bodyHead = document.createElement("div");
        bodyHead.className = "jcs-body-head";
        const treeToggleBtn = makeButton(showTreeNav ? "TAB ▼" : "TAB ▶", () => {
            showTreeNav = !showTreeNav;
            renderPanel();
        }, "jcs-tree-toggle");
        treeToggleBtn.title = "左タブツリーの表示/非表示を切り替え";
        const bodyTitle = document.createElement("span");
        bodyTitle.className = "jcs-body-title";
        bodyTitle.textContent = "CodeLists";
        bodyHead.append(treeToggleBtn, bodyTitle);

        // ★ メインペイン（左ツリー ＋ 右コードリスト）
        const mainPane = document.createElement("div");
        mainPane.className = "jcs-main-pane";

        // 左側ツリーナビゲーション（showTreeNav が true の時のみ表示）
        if (showTreeNav) {
            const treeNav = document.createElement("div");
            treeNav.className = "jcs-tree-nav";

            const pCount = state.parentCount || 4;
            const cCount = state.childCount || 6;

            for (let p = 0; p < pCount; p++) {
                // 親フォルダ項目 [ 親A ]
                const pEl = document.createElement("div");
                pEl.className = "jcs-tree-parent" + (state.filterParent === p ? " active" : "");
                pEl.textContent = state.parents[p] || ("P" + p);
                pEl.onclick = () => {
                    state.filterParent = p;
                    renderPanel();
                };
                pEl.oncontextmenu = (e) => {
                    e.preventDefault();
                    showFolderMenu(e, "parent", p);
                };
                treeNav.appendChild(pEl);

                // 子フォルダ項目 [ 子A-1 ] 〜 [ 子A-8 ]
                const cList = state.children[p] || [];
                for (let c = 0; c < cCount; c++) {
                    const cEl = document.createElement("div");
                    const isActive = (state.filterParent === p && state.filterChild[p] === c);
                    cEl.className = "jcs-tree-child" + (isActive ? " active" : "");
                    cEl.textContent = cList[c] || (p + "-" + c);
                    cEl.onclick = () => {
                        state.filterParent = p;
                        state.filterChild[p] = c;
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
        }

        // 右側コードリスト
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
