/* Shared by the Safari userscript and Node checks. No network or player code. */
(function (root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.FkCatalog = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
    'use strict';
    const VERSION = '2.0.0';
    const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
    const trackId = (v) => /^(\d{1,20})(?::\d{1,20})?$/.exec(String(v))?.[1] || null;

    function compare(a, b) {
        const x = a.split('.').map(Number), y = b.split('.').map(Number);
        for (let i = 0; i < Math.max(x.length, y.length); i++) {
            if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0) ? -1 : 1;
        }
        return 0;
    }

    function satisfies(actual, constraint) {
        const m = String(constraint).trim().match(/^(>=|<=|!=|[><=^~])?\s*(\d+(?:\.\d+)*)$/);
        if (!m) return false;
        const op = m[1] || '>=', v = m[2], c = compare(actual, v);
        if (op === '>') return c > 0;
        if (op === '>=') return c >= 0;
        if (op === '<') return c < 0;
        if (op === '<=') return c <= 0;
        if (op === '=') return c === 0;
        if (op === '!=') return c !== 0;
        const p = v.split('.').map(Number), [major = 0, minor = 0, patch = 0] = p;
        let upper;
        if (op === '~') upper = p.length === 1 ? `${major + 1}.0.0` : `${major}.${minor + 1}.0`;
        else if (major > 0 || p.length === 1) upper = `${major + 1}.0.0`;
        else if (minor > 0 || p.length === 2) upper = `0.${minor + 1}.0`;
        else upper = `0.0.${patch + 1}`;
        return c >= 0 && compare(actual, upper) < 0;
    }

    function supported(source) {
        const range = source.supportedVersions;
        if (range == null || range === '') return true;
        return (Array.isArray(range) ? range : String(range).split('&'))
            .every((part) => satisfies(VERSION, part));
    }

    function audioURL(value, template) {
        if (typeof value !== 'string' && typeof value !== 'number') return null;
        let url = String(value).trim();
        if (/^\d+$/.test(url)) {
            if (typeof template !== 'string' || !template.includes('%%')) return null;
            url = template.replace(/%%/g, url);
        }
        if (!url.includes('://')) url = 'https://' + url.replace(/^\/\//, '');
        // Keep this parser independent of browser APIs. Only absolute HTTPS locations are accepted.
        if (!/^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d+)?(?:[/?#][^\s]*)?$/i.test(url)) return null;
        return url;
    }

    function parseDocument(json) {
        if (!object(json)) throw new Error('Expected a catalog object');
        let storages;
        if (Array.isArray(json.sources)) {
            storages = [];
            // Same priority as the desktop player: later compatible sources win.
            for (const source of json.sources) {
                if (!object(source) || !supported(source)) continue;
                if (Array.isArray(source.tracksStorages)) storages.unshift(...source.tracksStorages);
            }
        } else if (object(json.tracks)) storages = [{ tracks: json.tracks }];
        else throw new Error('Unknown catalog format');

        const result = Object.create(null);
        function add(id, raw, template, duration) {
            id = trackId(id);
            if (!id || result[id]) return;
            const item = object(raw) ? raw : { url: raw };
            const url = audioURL(item.url, template);
            if (!url) return;
            const entry = { url };
            const ms = item.durationMs ?? duration;
            if (Number.isFinite(ms) && ms > 0 && ms < 86400000) entry.durationMs = ms;
            result[id] = entry;
        }
        for (const storage of storages) {
            if (!object(storage)) continue;
            if (object(storage.tracks)) {
                for (const [id, value] of Object.entries(storage.tracks)) add(id, value, storage.urlTemplate);
            }
            if (typeof storage.urlTemplate !== 'string' || !storage.urlTemplate.includes('%%')) continue;
            for (const item of Array.isArray(storage.trackIds) ? storage.trackIds : []) {
                const id = trackId(object(item) ? item.id : item);
                if (id) add(id, id, storage.urlTemplate, object(item) ? item.durationMs : undefined);
            }
        }
        return result;
    }

    // Across repositories the base wins, then extras in their configured order.
    function mergeCatalogs(catalogs) {
        const result = Object.create(null);
        for (const catalog of catalogs) {
            for (const [id, entry] of Object.entries(catalog || {})) {
                if (trackId(id) === id && !result[id] && object(entry) && audioURL(entry.url)) result[id] = entry;
            }
        }
        return result;
    }

    function normalizeJSON(text) {
        const result = parseDocument(JSON.parse(text));
        if (!Object.keys(result).length) throw new Error('Catalog contains no compatible replacements');
        return JSON.stringify(result);
    }

    return { parseDocument, mergeCatalogs, normalizeJSON, satisfies, trackId };
});
