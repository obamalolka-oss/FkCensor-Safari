(function () {
    'use strict';
    if (window.__fkcSafariPage) return;
    window.__fkcSafariPage = true;
    const channel = 'fkc-ios-1555-v1';
    const pending = new Map(), inflight = new Map(), blobs = new Map();
    let sequence = 0, playingURL = '';
    function send(type, details) {
        window.postMessage({ channel, from: 'player', type, ...details }, window.location.origin);
    }
    function trim() {
        // Retain recent prefetched files and the currently playing HTML audio source.
        for (const [key, entry] of blobs) {
            if (blobs.size <= 8) break;
            if (entry.url === playingURL || Date.now() - entry.used < 120000) continue;
            URL.revokeObjectURL(entry.url); blobs.delete(key);
        }
    }
    document.addEventListener('playing', (event) => { playingURL = event.target?.currentSrc || ''; trim(); }, true);
    window.__fkcSafariAudio = {
        resolve(trackId, sourceURL) {
            const cached = blobs.get(sourceURL);
            if (cached) { cached.used = Date.now(); return Promise.resolve(cached.url); }
            if (inflight.has(sourceURL)) return inflight.get(sourceURL);
            const requestId = ++sequence;
            const promise = new Promise((resolve) => {
                const finish = (url) => {
                    const item = pending.get(requestId);
                    if (!item) return;
                    pending.delete(requestId); clearTimeout(item.timer); resolve(url);
                };
                pending.set(requestId, { sourceURL, finish, timer: setTimeout(() => finish(null), 45000) });
                send('audio-request', { requestId, trackId });
            }).finally(() => inflight.delete(sourceURL));
            inflight.set(sourceURL, promise);
            return promise;
        },
    };
    window.addEventListener('pagehide', (event) => {
        if (event.persisted) return;
        for (const entry of blobs.values()) URL.revokeObjectURL(entry.url);
        blobs.clear();
        for (const item of [...pending.values()]) item.finish(null);
    });
    window.addEventListener('message', (event) => {
        if (event.source !== window || event.origin !== window.location.origin) return;
        const message = event.data;
        if (!message || message.channel !== channel || message.from !== 'loader') return;
        if (message.type === 'audio-result') {
            const item = pending.get(message.requestId);
            if (!item) return;
            try {
                const data = message.bytes;
                if (message.sourceURL !== item.sourceURL || Object.prototype.toString.call(data) !== '[object ArrayBuffer]'
                    || data.byteLength < 4 || data.byteLength > 40000000) { item.finish(null); return; }
                const bytes = new Uint8Array(data);
                if (!((bytes[0] === 73 && bytes[1] === 68 && bytes[2] === 51) || (bytes[0] === 255 && (bytes[1] & 224) === 224))) {
                    item.finish(null); return;
                }
                const url = URL.createObjectURL(new Blob([data], { type: 'audio/mpeg' }));
                blobs.set(item.sourceURL, { url, used: Date.now() });
                trim(); item.finish(url);
            } catch (_) { item.finish(null); }
            return;
        }
        if (message.type === 'ping') {
            window.postMessage({ channel, from: 'player', type: 'page-online' }, window.location.origin);
            return;
        }
        if (message.type !== 'catalog' || !message.replacements || typeof message.replacements !== 'object') return;
        const clean = Object.create(null);
        for (const [id, entry] of Object.entries(message.replacements)) {
            if (!/^\d{1,20}$/.test(id) || !entry || typeof entry.url !== 'string') continue;
            try {
                const url = new URL(entry.url);
                if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) continue;
                clean[id] = { url: url.href };
                if (Number.isFinite(entry.durationMs) && entry.durationMs > 0 && entry.durationMs < 86400000) {
                    clean[id].durationMs = entry.durationMs;
                }
            } catch (_) {}
        }
        if (!Object.keys(clean).length) return;
        window.__fkCensorReplacements = clean;
        if (window.FkCensorIOS) window.FkCensorIOS.updateCatalog(clean);
        window.postMessage({ channel, from: 'player', type: 'catalog-applied', count: Object.keys(clean).length }, window.location.origin);
    });
})();
