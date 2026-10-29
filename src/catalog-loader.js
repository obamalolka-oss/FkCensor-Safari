/* The bundler supplies CORE, SEED and SOURCES in this closure. Runs in the extension's content world. */
(function () {
    'use strict';
    if (window.__fkcSafariLoader) return;
    window.__fkcSafariLoader = true;
    const channel = 'fkc-ios-1555-v1', cacheKey = 'fkc-ios-catalog-v1';
    const sources = SOURCES;
    let snapshot = JSON.parse(JSON.stringify(SEED));
    let catalog = merged(), pageOnline = false, pageTimedOut = false, hooked = false, waiting = false, appliedCount = null;
    let refreshing = false, lastRefresh = 0, button, lastTrack = '', sourceResults = [], cacheState = 'встроенный список';
    let updateState = 'обновление при открытии', lastUpdate = '';
    let bootstrapState = 'нет ответа от первого скрипта';
    let audioState = 'файлы подмен ещё не запрашивались', audioActive = 0;
    const audioQueue = [], audioPending = new Map();
    const gm = typeof GM === 'object' ? GM : {};

    function merged() { return CORE.mergeCatalogs(sources.map(([id]) => snapshot.sources[id]?.replacements)); }
    function send(type, details) {
        window.postMessage({ channel, from: 'loader', type, ...details }, window.location.origin);
    }
    function sendCatalog() { send('catalog', { replacements: catalog }); }
    function count() { return Object.keys(catalog).length; }
    function report() {
        return [
            'FkCensor Safari 1.0.1',
            'База: ' + count() + ' треков; ' + cacheState,
            'Обновление: ' + updateState + (lastUpdate ? ' (' + lastUpdate + ')' : ''),
            'Запуск подмены: ' + bootstrapState,
            'Код страницы: ' + (pageOnline ? 'на связи' : 'не ответил'),
            'Подмена в плеере: ' + (hooked ? 'подключена' : waiting ? 'ресурс плеера пока не найден' : 'ожидание плеера'),
            'Применено в странице: ' + (appliedCount == null ? 'ожидание' : appliedCount + ' треков'),
            'Последняя подмена: ' + (lastTrack || 'ещё не было'),
            'Загрузка аудио: ' + audioState,
            ...sourceResults,
            '',
            !pageOnline ? 'Нет связи с кодом страницы. Смотрите строку «Запуск подмены»; возможна блокировка CSP.' : '',
            pageOnline && !hooked ? 'Запустите трек. Если статус не изменится, передайте этот отчёт: ресурс веб-плеера пока не найден.' : '',
            'В базу загружаются адреса подмен. Сами аудиофайлы заранее не скачиваются.',
        ].filter(Boolean).join('\n');
    }
    function render() {
        if (!button) return;
        const state = hooked ? 'готово' : pageOnline ? 'ждём плеер' : pageTimedOut ? 'нет связи' : 'ждём страницу';
        button.textContent = 'FK · ' + count() + ' · ' + (refreshing ? '↻' : state);
        button.title = report();
        button.style.setProperty('border-color', hooked ? '#40b37b' : '#d49d35', 'important');
    }
    function mount() {
        if (button || !document.body) return;
        button = document.createElement('button');
        button.id = 'fkc-safari-status';
        button.type = 'button';
        button.setAttribute('aria-label', 'Состояние FkCensor; нажмите для проверки');
        // A compact diagnostic button for testing on the phone without a Mac console.
        const styles = { position: 'fixed', right: '8px', bottom: 'calc(8px + env(safe-area-inset-bottom, 0px))',
            'z-index': '2147483647', padding: '7px 10px', margin: '0', border: '1px solid #d49d35',
            'border-radius': '18px', background: '#202124', color: '#fff', font: '12px system-ui, sans-serif',
            'line-height': '16px', 'max-width': 'calc(100vw - 16px)', 'white-space': 'nowrap', opacity: '0.93', cursor: 'pointer' };
        for (const [key, value] of Object.entries(styles)) button.style.setProperty(key, value, 'important');
        button.addEventListener('click', () => { send('ping'); alert(report()); });
        document.body.appendChild(button);
        render();
    }

    window.addEventListener('message', (event) => {
        if (event.source !== window || event.origin !== window.location.origin) return;
        const message = event.data;
        if (message?.channel === channel && message.from === 'bootstrap' && message.type === 'bootstrap-status') {
            bootstrapState = String(message.state || 'неизвестно') + ' (' + String(message.version || '?') + ')';
            render(); return;
        }
        if (!message || message.channel !== channel || message.from !== 'player') return;
        pageOnline = true;
        if (message.type === 'audio-request') { serveAudio(message).catch(() => {}); return; }
        if (message.type === 'connected') hooked = true;
        if (message.type === 'waiting') waiting = true;
        if (message.type === 'replaced') { hooked = true; lastTrack = CORE.trackId(message.trackId) || lastTrack; }
        if (message.type === 'catalog-applied') appliedCount = Number(message.count);
        if (message.type === 'ready' || message.type === 'page-online') sendCatalog();
        render();
    });

    function audioBytes(url) {
        return new Promise((resolve) => {
            let done = false, handle;
            const finish = (value) => { if (!done) { done = true; clearTimeout(timer); resolve(value); } };
            const abort = () => { finish(null); try { handle?.abort(); } catch (_) {} };
            const timer = setTimeout(abort, 35000);
            const success = async (response) => {
                try {
                    if (response?.status !== 200 && response?.status !== 206) { finish(null); return; }
                    let bytes = response.response;
                    if (typeof Blob !== 'undefined' && bytes instanceof Blob) bytes = await bytes.arrayBuffer();
                    if (ArrayBuffer.isView(bytes)) bytes = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
                    if (Object.prototype.toString.call(bytes) !== '[object ArrayBuffer]' || bytes.byteLength < 4 || bytes.byteLength > 40000000) {
                        finish(null); return;
                    }
                    const view = new Uint8Array(bytes);
                    const mp3 = (view[0] === 73 && view[1] === 68 && view[2] === 51) || (view[0] === 255 && (view[1] & 224) === 224);
                    finish(mp3 ? bytes : null);
                } catch (_) { finish(null); }
            };
            const details = { method: 'GET', url, responseType: 'arraybuffer', timeout: 30000, anonymous: true,
                onload: success, onerror: () => finish(null), ontimeout: () => finish(null), onabort: () => finish(null),
                onprogress: (event) => { if (event.loaded > 40000000) abort(); } };
            try {
                if (typeof gm.xmlHttpRequest === 'function') handle = gm.xmlHttpRequest(details);
                else if (typeof GM_xmlhttpRequest === 'function') handle = GM_xmlhttpRequest(details);
                else { finish(null); return; }
                if (handle && typeof handle.then === 'function') handle.then(success, () => finish(null));
            } catch (_) { finish(null); }
        });
    }
    async function downloadAudio(url) {
        if (audioActive >= 2) await new Promise((resolve) => audioQueue.push(resolve));
        else audioActive++;
        try { return await audioBytes(url); }
        finally {
            if (audioQueue.length) audioQueue.shift()();
            else audioActive--;
        }
    }
    async function serveAudio(message) {
        const id = CORE.trackId(message.trackId), requestId = message.requestId;
        if (!id || !Number.isSafeInteger(requestId) || requestId < 1) return;
        const entry = catalog[id];
        if (!entry || (audioPending.size >= 24 && !audioPending.has(entry.url))) {
            send('audio-result', { requestId, sourceURL: entry?.url, bytes: null }); return;
        }
        audioState = 'загрузка трека ' + id; render();
        if (!audioPending.has(entry.url)) {
            audioPending.set(entry.url, downloadAudio(entry.url).finally(() => audioPending.delete(entry.url)));
        }
        const bytes = await audioPending.get(entry.url);
        audioState = bytes ? 'трек ' + id + ' передан плееру' : 'ошибка файла ' + id + '; остаётся ответ Яндекса';
        send('audio-result', { requestId, sourceURL: entry.url, bytes }); render();
    }

    function bounded(promise, ms, fallback) {
        return new Promise((resolve) => {
            const timer = setTimeout(() => resolve(fallback), ms);
            Promise.resolve(promise).then((value) => { clearTimeout(timer); resolve(value); },
                () => { clearTimeout(timer); resolve(fallback); });
        });
    }
    async function restore() {
        let cached;
        try {
            if (typeof gm.getValue === 'function') cached = await bounded(gm.getValue(cacheKey, null), 1500, null);
            else cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
            if (cached?.version !== 1 || !cached.sources) return;
            for (const [id] of sources) {
                const map = cached.sources[id]?.replacements;
                if (!map || typeof map !== 'object') continue;
                const clean = CORE.parseDocument({ tracks: map });
                if (Object.keys(clean).length) snapshot.sources[id] = { replacements: clean, updatedAt: cached.sources[id].updatedAt };
            }
            catalog = merged();
            cacheState = 'сохранённый список';
            sendCatalog(); render();
        } catch (_) { /* Keep the built-in 1555 entries if storage is unavailable. */ }
    }
    async function save() {
        try {
            if (typeof gm.setValue === 'function') {
                const saved = await bounded(Promise.resolve(gm.setValue(cacheKey, snapshot)).then(() => true), 1500, false);
                if (!saved) throw new Error('storage');
            } else localStorage.setItem(cacheKey, JSON.stringify(snapshot));
            cacheState = 'обновлённый список сохранён';
        } catch (_) { cacheState = 'база в памяти; кэш не сохранён'; render(); }
    }
    function request(url) {
        return new Promise((resolve) => {
            let finished = false, handle;
            const finish = (result) => { if (!finished) { finished = true; clearTimeout(timer); resolve(result); } };
            const success = (response) => {
                if (response?.status !== 200) { finish(null); return; }
                const text = typeof response.responseText === 'string' ? response.responseText : response.response;
                finish(typeof text === 'string' && text.length <= 5000000 ? text : null);
            };
            const timer = setTimeout(() => { finish(null); try { handle?.abort(); } catch (_) {} }, 14000);
            const details = { method: 'GET', url, responseType: 'text', timeout: 12000, anonymous: true,
                headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
                onload: success, onerror: () => finish(null), ontimeout: () => finish(null), onabort: () => finish(null) };
            try {
                if (typeof gm.xmlHttpRequest === 'function') handle = gm.xmlHttpRequest(details);
                else if (typeof GM_xmlhttpRequest === 'function') handle = GM_xmlhttpRequest(details);
                else { finish(null); return; }
                if (handle && typeof handle.then === 'function') handle.then(success, () => finish(null));
            } catch (_) { finish(null); }
        });
    }
    async function refresh() {
        if (refreshing) return;
        refreshing = true; lastRefresh = Date.now(); render();
        let succeeded = 0;
        try {
            sourceResults = await Promise.all(sources.map(async ([id, url]) => {
                const text = await request(url + '?fkc=' + lastRefresh);
                try {
                    if (!text) throw new Error('network');
                    const map = JSON.parse(CORE.normalizeJSON(text));
                    snapshot.sources[id] = { replacements: map, updatedAt: new Date().toISOString() };
                    succeeded++;
                    return id + ': ' + Object.keys(map).length + ' · обновлён';
                } catch (_) { return id + ': сохранена прежняя копия'; }
            }));
            if (succeeded) {
                catalog = merged();
                cacheState = 'обновлённый список в памяти';
                updateState = 'источников ' + succeeded + '/' + sources.length;
                lastUpdate = new Date().toLocaleTimeString();
                sendCatalog();
                await save();
            } else updateState = typeof gm.xmlHttpRequest === 'function' || typeof GM_xmlhttpRequest === 'function'
                ? 'сеть недоступна; прежняя база' : 'нет разрешения GM.xmlHttpRequest; прежняя база';
        } finally { refreshing = false; render(); }
    }

    if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount, { once: true });
    send('ping'); sendCatalog();
    // Both scripts run at document-start; this handshake also covers either injection order.
    let pings = 0;
    const pingTimer = setInterval(() => {
        if (pageOnline || ++pings >= 15) { pageTimedOut = !pageOnline; clearInterval(pingTimer); render(); return; }
        send('ping');
    }, 1000);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && Date.now() - lastRefresh >= 60000) refresh();
    });
    window.addEventListener('pageshow', (event) => {
        if (event.persisted) { send('ping'); if (Date.now() - lastRefresh >= 60000) refresh(); }
    });
    (async () => { await restore(); await refresh(); })().catch(() => { updateState = 'ошибка обновления; прежняя база'; render(); });
})();
