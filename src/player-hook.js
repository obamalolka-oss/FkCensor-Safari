(function () {
    'use strict';
    const musicHosts = new Set(['music.yandex.ru', 'music.yandex.com', 'music.yandex.kz', 'music.yandex.by', 'music.yandex.uz']);
    if (!musicHosts.has(window.location.hostname) || window.FkCensorIOS) return;

    const patched = new WeakSet(), inspected = new Set(), queues = new WeakSet();
    let replacements = window.__fkCensorReplacements || {};
    let connected = false, scans = 0, scheduled = false;
    const idOf = (value) => /^(\d{1,20})(?::\d{1,20})?$/.exec(String(value))?.[1] || '';
    const entryFor = (value) => replacements[idOf(value)] || null;

    async function playable(id) {
        const entry = entryFor(id);
        if (!entry) return null;
        if (!window.__fkcSafariAudio) return entry;
        const url = await window.__fkcSafariAudio.resolve(idOf(id), entry.url);
        return url && entryFor(id)?.url === entry.url ? { ...entry, url } : null;
    }

    function status(type, details) {
        try {
            window.postMessage({ channel: 'fkc-ios-1555-v1', from: 'player', type, ...details }, window.location.origin);
        } catch (_) {}
    }
    function info(id, entry) {
        // Build fresh raw MP3 metadata. Native encryption keys and codec fields do not belong here.
        return { trackId: String(id), realId: String(id), codec: 'mp3', bitrate: 320,
            transport: 'raw', quality: 'hq', gain: false, urls: [entry.url], url: entry.url };
    }
    function replaced(id) { status('replaced', { trackId: idOf(id) }); }

    function patch(proto) {
        if (!proto || patched.has(proto) || typeof proto.getFileInfo !== 'function') return false;
        patched.add(proto);
        const single = proto.getFileInfo;
        proto.getFileInfo = async function (params, ...rest) {
            const id = params && params.trackId;
            if (!entryFor(id)) return single.call(this, params, ...rest);
            const native = Promise.resolve().then(() => single.call(this, params, ...rest))
                .then((response) => ({ response }), (failure) => ({ failure }));
            const entry = await playable(id).catch(() => null);
            const { response, failure } = await native;
            // A refresh can remove a replacement while the original request is in flight.
            if (!entry || !entryFor(id)) { if (failure) throw failure; return response; }
            const field = response && 'fileInfo' in response ? 'fileInfo' : 'downloadInfo';
            const result = { responseTime: 0, url: '', ...response, [field]: info(id, entry) };
            delete result.error;
            replaced(id);
            return result;
        };
        const batch = proto.getFileInfoBatch;
        if (typeof batch === 'function') proto.getFileInfoBatch = async function (params, ...rest) {
            const raw = params && params.trackIds;
            const ids = [...new Set((Array.isArray(raw) ? raw : String(raw || '').split(',')).map(String).filter(Boolean))];
            if (!ids.some(entryFor)) return batch.call(this, params, ...rest);
            // A mixed batch must preserve errors for unlisted tracks. Never return a partial success.
            const native = Promise.resolve().then(() => batch.call(this, params, ...rest))
                .then((response) => ({ response }), (failure) => ({ failure }));
            const resolved = await Promise.all(ids.filter(entryFor).map(async (id) => [id, await playable(id).catch(() => null)]));
            let { response, failure } = await native;
            const hits = resolved.filter(([id, entry]) => entry && entryFor(id));
            if (failure) {
                if (hits.length !== ids.length) throw failure;
                response = {};
            }
            if (!hits.length) return response;
            const field = response && 'fileInfos' in response ? 'fileInfos' : 'downloadInfos';
            if (response && response[field] != null && !Array.isArray(response[field])) return response;
            const list = response && Array.isArray(response[field]) ? response[field].slice() : [];
            for (const [id, entry] of hits) {
                const index = list.findIndex((item) => item && idOf(item.trackId) === idOf(id));
                const value = info(id, entry);
                if (index < 0) list.push(value); else list[index] = value;
                replaced(id);
            }
            const result = { ...response, [field]: list };
            delete result.error;
            return result;
        };
        return true;
    }

    // Only track DTOs in Yandex API responses receive the listed file's duration/availability.
    function metadata(value, depth = 0, seen = new WeakSet()) {
        if (!value || typeof value !== 'object' || depth > 18 || seen.has(value)) return;
        seen.add(value);
        const entry = entryFor(value.id);
        if (entry && typeof value.title === 'string' && Array.isArray(value.artists)
                && ('durationMs' in value || Array.isArray(value.albums) || 'trackSource' in value)) {
            if (entry.durationMs) value.durationMs = entry.durationMs;
            value.available = true;
            delete value.error;
        }
        for (const child of Object.values(value)) metadata(child, depth + 1, seen);
    }
    if (typeof Response !== 'undefined') {
        const json = Response.prototype.json;
        Response.prototype.json = async function (...args) {
            const value = await json.apply(this, args);
            if (/^https:\/\/api\.music\.yandex\.net\//.test(String(this.url))) {
                try { metadata(value); } catch (_) {}
            }
            return value;
        };
    }

    function scheduleScan() {
        if (scheduled) return;
        scheduled = true;
        Promise.resolve().then(() => { scheduled = false; scan(); });
    }
    function scan() {
        const chunks = window.webpackChunk_N_E;
        if (!chunks || typeof chunks.push !== 'function') return;
        // Observe lazy chunks too: a resource can appear well after the first screen has opened.
        if (!queues.has(chunks.push)) {
            const push = chunks.push;
            const wrapped = function (...items) {
                const result = push.apply(this, items);
                scheduleScan();
                return result;
            };
            queues.add(wrapped);
            chunks.push = wrapped;
        }
        let appRequire;
        // Use the runtime callback directly through the original push to avoid a scan loop.
        const length = chunks.length;
        try {
            // Suppress our queue observer for this synthetic chunk.
            scheduled = true;
            chunks.push([[Symbol('FkCensorIOS')], {}, (require) => { appRequire = require; }]);
            if (chunks.length > length) chunks.pop();
        } catch (_) { return; }
        finally { scheduled = false; }
        if (!appRequire || !appRequire.m) return;
        for (const key of Object.keys(appRequire.m)) {
            const factory = appRequire.m[key];
            if (inspected.has(factory)) continue;
            const source = String(factory);
            if (!/get-file-info|resources\/v2\/file-info/.test(source)) { inspected.add(factory); continue; }
            try {
                const exports = appRequire(key);
                const values = typeof exports === 'function' ? [exports] : Object.values(exports || {});
                let found = false;
                for (const value of values) {
                    if (typeof value === 'function' && value.prototype && typeof value.prototype.getFileInfo === 'function') {
                        found = true;
                        if (patch(value.prototype) && !connected) { connected = true; status('connected', {}); }
                    }
                }
                if (found) inspected.add(factory);
            } catch (_) { /* A lazy module may need another chunk before it can be evaluated. */ }
        }
    }
    window.FkCensorIOS = {
        updateCatalog(value) {
            if (!value || typeof value !== 'object' || Array.isArray(value)) return;
            replacements = value;
            window.__fkCensorReplacements = value;
            scan();
        },
    };
    function tick() {
        scan();
        scans++;
        if (scans === 150 && !connected) status('waiting', {});
        setTimeout(tick, scans < 150 ? 200 : 2000);
    }
    status('ready', { count: Object.keys(replacements).length });
    tick();
})();
