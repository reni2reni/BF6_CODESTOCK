const head = document.createElement("div");
        head.className = "jcs-head";
        const ttl = document.createElement("div");
        ttl.className = "jcs-title";
        // 折りたたみ時はタイトルの横にマークを表示して分かりやすく
        ttl.textContent = isCollapsed ? "🐛JS Stock ▶" : "🐛JS Stock ▼";
        ttl.title = "クリックで最小化/展開（ドラッグで移動）";

        const tools = document.createElement("div");
        tools.className = "jcs-tools";

        // ⚙️ 設定ボタン
        const gearBtn = makeButton("⚙️", (e) => {
            e.stopPropagation();
            showSettingsMenu(gearBtn);
        }, "jcs-gear");
        gearBtn.title = "設定（EXPORT / IMPORT / タブ数変更）";

        // 🔒️ / 🔓️ ピン留めボタン
        const pinBtn = makeButton(isPinned ? "🔒️" : "🔓️", () => {
            isPinned = !isPinned;
            renderPanel();
        }, "jcs-pin" + (isPinned ? "" : " unlocked"));
        pinBtn.title = isPinned ? "ロック中（操作後も閉じない）" : "アンロック（操作後に自動で閉じる）";

        // ✕ 閉じるボタン
        const close = makeButton("✕", closePanel, "jcs-close");
        close.title = "Close";

        // ★ 並び順：⚙️ 🔒️ ✕ （⬒ボタンは撤廃）
        tools.append(gearBtn, pinBtn, close);
        head.append(ttl, tools);
