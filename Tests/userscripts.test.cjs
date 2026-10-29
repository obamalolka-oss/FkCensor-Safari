'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const pageCode = fs.readFileSync(path.join(__dirname, '../userscripts/FkCensor-1-player.user.js'), 'utf8');
const loaderCode = fs.readFileSync(path.join(__dirname, '../userscripts/FkCensor-2-lists.user.js'), 'utf8');
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/seed-catalog.json')));
const clone = (v) => structuredClone(v);
const sourceId = (url) => {
    if (url.includes('/gagayhhad-tech/')) return 'liberty';
    if (url.includes('/seuyh/')) return 'additional';
    if (url.includes('/ink-fun/')) return url.includes('/list_v2.json') ? 'ink-fun-v2' : 'ink-fun-v1';
    return url.includes('/list_v2.json') ? 'base' : 'fck-v1';
};

function browser({ order = 'page-first', network = () => null, cached = null, legacy = false,
    promiseOnly = false, missingGM = false, rejectCache = false, nonce = 'site-nonce', policy = 'nonce',
    lateNonce = false, pageError = false,
    audio = () => new Uint8Array([73, 68, 51, 4, 0, 0, 0, 0]).buffer } = {}) {
    const worlds = [], requests = [], audioRequests = [], saves = [], alerts = [];
    let timerId = 0;
    const timers = new Map(), intervals = new Map();
    const schedule = (collection, fn, ms) => { const id = ++timerId; collection.set(id, { fn, ms }); return id; };
    const messages = [];
    const clock = { now: Date.now() };
    class TestDate extends Date { static now() { return clock.now; } }
    const siteScripts = lateNonce || !nonce ? [] : [{ nonce }], observers = [], injected = [];
    class MutationObserver {
        constructor(fn) { this.fn = fn; observers.push(this); }
        observe() { this.active = true; }
        disconnect() { this.active = false; }
    }
    function world() {
        const listeners = {}, elements = [];
        const document = { visibilityState: 'visible', readyState: 'loading', listeners: {},
            body: { appendChild(element) { elements.push(element); } },
            addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
            querySelectorAll() { return siteScripts; },
            createElement() { const attrs = new Map(); return { style: { setProperty() {} },
                setAttribute(key, value) { attrs.set(key, value); }, getAttribute(key) { return attrs.get(key) ?? null; },
                remove() {}, handlers: {}, addEventListener(type, fn) { this.handlers[type] = fn; } }; },
        };
        const window = { location: { hostname: 'music.yandex.ru', origin: 'https://music.yandex.ru' },
            addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
            postMessage(data, target) {
                assert.equal(target, window.location.origin);
                messages.push(data);
                for (const targetWorld of worlds) queueMicrotask(() => {
                    for (const fn of targetWorld.listeners.message || []) fn({ source: targetWorld.window,
                        origin: window.location.origin, data: clone(data) });
                });
            },
        };
        const storage = new Map();
        const context = vm.createContext({ window, document, console, URL, Blob, Date: TestDate, MutationObserver,
            alert: (text) => alerts.push(text),
            localStorage: { getItem: (k) => storage.get(k), setItem: (k, v) => storage.set(k, v) },
            setTimeout: (fn, ms) => schedule(timers, fn, ms), clearTimeout: (id) => timers.delete(id),
            setInterval: (fn, ms) => schedule(intervals, fn, ms), clearInterval: (id) => intervals.delete(id),
        });
        const value = { window, document, context, listeners, elements };
        worlds.push(value);
        return value;
    }
    const page = world(), content = world();
    const head = { appendChild(node) {
        injected.push(node);
        if (policy === 'none' || (policy === 'nonce' && (!nonce || node.nonce !== nonce))) return;
        page.document.currentScript = node;
        if (pageError) {
            node.setAttribute('data-fkc-result', 'error'); node.setAttribute('data-fkc-error', 'test page failure');
        } else vm.runInContext(node.textContent, page.context);
        page.document.currentScript = null;
    } };
    page.document.head = content.document.head = head;
    const nativeResponse = { downloadInfo: { trackId: '123', key: 'original' } };
    class Resource {
        async getFileInfo() { return nativeResponse; }
        async getFileInfoBatch() { return { fileInfos: [] }; }
    }
    const require = () => ({ Resource });
    require.m = { 1: function () { return 'get-file-info'; } };
    const chunks = [];
    chunks.push = function (item) { item[2](require); return Array.prototype.push.call(this, item); };
    page.window.webpackChunk_N_E = chunks;
    const xhr = (details) => {
        requests.push(details.url);
        const isAudio = details.responseType === 'arraybuffer';
        if (isAudio) audioRequests.push(details.url);
        const result = isAudio ? audio(details.url) : network(sourceId(details.url));
        const response = result ? isAudio ? { status: 200, response: result }
            : { status: 200, responseText: typeof result === 'string' ? result : JSON.stringify(result) }
            : { status: 503, responseText: 'offline' };
        if (legacy) { queueMicrotask(() => details.onload(response)); return { abort() {} }; }
        return Promise.resolve().then(() => { if (!promiseOnly) details.onload(response); return response; });
    };
    if (!missingGM) {
        content.context.GM = { getValue: async () => clone(cached),
            setValue: async (key, value) => { if (rejectCache) throw new Error('storage rejected'); saves.push(clone(value)); },
        };
        if (legacy) content.context.GM_xmlhttpRequest = xhr;
        else content.context.GM.xmlHttpRequest = xhr;
    }
    if (order === 'content-first') { vm.runInContext(loaderCode, content.context); vm.runInContext(pageCode, content.context); }
    else if (order === 'content-only') vm.runInContext(loaderCode, content.context);
    else { vm.runInContext(pageCode, content.context); vm.runInContext(loaderCode, content.context); }
    const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((done) => setImmediate(done)); };
    return { page, content, Resource, nativeResponse, requests, audioRequests, saves, alerts, timers, intervals, clock, messages, flush, injected,
        addNonce() { siteScripts.push({ nonce }); for (const observer of observers) if (observer.active) observer.fn(); },
        domReady() { for (const world of worlds) for (const fn of world.document.listeners.DOMContentLoaded || []) fn(); },
        button: () => content.elements[0],
        report() { content.elements[0].handlers.click(); return alerts.at(-1); },
    };
}

test('both complete installable scripts work in either injection order while offline', async () => {
    for (const order of ['page-first', 'content-first']) {
        const h = browser({ order }); await h.flush();
        assert.equal(h.requests.length, 6);
        assert.equal(Object.keys(h.page.window.__fkCensorReplacements).length, 1555);
        assert.match(h.button().textContent, /1555.*готово/);
        assert.match(h.report(), /Код страницы: на связи/);
        assert.match(h.report(), /Подмена в плеере: подключена/);
        assert.match(h.report(), /Применено в странице: 1555 треков/);
        assert.match(h.report(), /сеть недоступна/);
        assert.equal(h.saves.length, 0);
        assert.equal(h.audioRequests.length, 0);
        const id = '138629224';
        const result = await new h.Resource().getFileInfo({ trackId: id });
        assert.match(result.downloadInfo.url, /^blob:/);
        assert.equal(h.audioRequests[0], h.page.window.__fkCensorReplacements[id].url);
        assert.equal(await (await fetch(result.downloadInfo.url)).text(), 'ID3\u0004\u0000\u0000\u0000\u0000');
        await h.flush();
        assert.match(h.report(), /Последняя подмена: 138629224/);
    }
});

test('new lists reach an already running player; audio is fetched only on a player request', async () => {
    const base = { ...seed.sources.base.replacements, 123: { url: 'https://audio.example/new.mp3' } };
    const h = browser({ network: (id) => id === 'base' ? { tracks: base } : null });
    await h.flush();
    assert.equal(h.saves.length, 1);
    assert.equal(Object.keys(h.page.window.__fkCensorReplacements).length, 1556);
    assert.equal(h.audioRequests.length, 0);
    assert.match((await new h.Resource().getFileInfo({ trackId: '123' })).downloadInfo.url, /^blob:/);
    assert.equal(h.audioRequests[0], 'https://audio.example/new.mp3');
    assert.match(h.report(), /источников 1\/6/);
    assert.match(h.report(), /обновлённый список сохранён/);
    for (const request of h.requests.slice(0, 6)) assert.match(request, /^https:\/\/raw\.githubusercontent\.com\/.*\/list(?:_v2)?\.json\?fkc=\d+$/);
});

test('a good source refresh removes stale ids instead of retaining the entire bundled map', async () => {
    const base = { ...seed.sources.base.replacements };
    delete base['138629224'];
    const h = browser({ network: (id) => id === 'base' ? { tracks: base } : null });
    await h.flush();
    assert.equal(h.page.window.__fkCensorReplacements['138629224'], undefined);
    assert.equal(Object.keys(h.page.window.__fkCensorReplacements).length, 1554);
    assert.equal(await new h.Resource().getFileInfo({ trackId: '138629224' }), h.nativeResponse);
});

test('last good per-source cache survives network and malformed JSON failures on the next launch', async () => {
    const cached = clone(seed);
    cached.sources.base.replacements[123] = { url: 'https://audio.example/cached.mp3' };
    const h = browser({ cached, network: (id) => id === 'base' ? '<html>gateway error</html>' : null });
    await h.flush();
    assert.match((await new h.Resource().getFileInfo({ trackId: '123' })).downloadInfo.url, /^blob:/);
    assert.equal(h.audioRequests[0], 'https://audio.example/cached.mp3');
    assert.match(h.report(), /сохранённый список/);
    assert.match(h.report(), /base: сохранена прежняя копия/);
    assert.equal(h.saves.length, 0);
});

test('the request adapter supports Promise-only and legacy callback GM APIs', async () => {
    for (const variant of [{ promiseOnly: true }, { legacy: true }]) {
        const h = browser({ ...variant, network: (id) => id === 'additional' ? { tracks: { 123: 'https://audio.example/legacy.mp3' } } : null });
        await h.flush();
        assert.equal(h.requests.length, 6);
        assert.match((await new h.Resource().getFileInfo({ trackId: '123' })).downloadInfo.url, /^blob:/);
        assert.equal(h.audioRequests[0], 'https://audio.example/legacy.mp3');
    }
});

test('missing GM permissions preserve the seed and show the actual cause', async () => {
    const h = browser({ missingGM: true }); await h.flush();
    assert.equal(h.requests.length, 0);
    assert.equal(Object.keys(h.page.window.__fkCensorReplacements).length, 1555);
    assert.match(h.report(), /нет разрешения GM.xmlHttpRequest/);
});

test('cache write failures do not prevent an updated map from reaching the player', async () => {
    const h = browser({ rejectCache: true, network: (id) => id === 'base' ? { tracks: seed.sources.base.replacements } : null });
    await h.flush();
    assert.match(h.button().textContent, /готово/);
    assert.match(h.report(), /кэш не сохранён/);
    assert.equal(Object.keys(h.page.window.__fkCensorReplacements).length, 1555);
});

test('missing page injection is visible on the phone even when content scripts run', async () => {
    const h = browser({ order: 'content-only' }); await h.flush();
    for (let i = 0; i < 15; i++) for (const timer of [...h.intervals.values()]) timer.fn();
    assert.match(h.button().textContent, /нет связи/);
    assert.match(h.report(), /Код страницы: не ответил/);
    assert.match(h.report(), /CSP/);
});

test('bootstrap waits for the site nonce at document-start and runs in the page world', async () => {
    const h = browser({ lateNonce: true }); await h.flush();
    assert.equal(h.injected.length, 0);
    assert.match(h.report(), /Запуск подмены: ожидание разрешения сайта/);
    h.addNonce(); await h.flush();
    assert.equal(h.injected.length, 1);
    assert.equal(h.injected[0].nonce, 'site-nonce');
    assert.match(h.report(), /Запуск подмены: выполнен с nonce сайта \(1.0.1\)/);
    assert.match(h.report(), /Код страницы: на связи/);
    assert.equal(h.content.window.FkCensorIOS, undefined);
    assert.ok(h.page.window.FkCensorIOS);
    h.addNonce(); await h.flush();
    assert.equal(h.injected.length, 1);
    assert.match((await new h.Resource().getFileInfo({ trackId: '138629224' })).downloadInfo.url, /^blob:/);
});

test('blocked insertion is diagnosed without pretending the player is online', async () => {
    const h = browser({ nonce: '', policy: 'none' }); await h.flush();
    assert.equal(h.injected.length, 0);
    h.domReady(); await h.flush();
    assert.equal(h.injected.length, 1);
    assert.match(h.report(), /Запуск подмены: вставка не выполнена; nonce сайта не найден/);
    assert.match(h.report(), /Код страницы: не ответил/);
    assert.equal(h.page.window.FkCensorIOS, undefined);
    assert.equal(h.audioRequests.length, 0);
});

test('a nonce can arrive after an unsuccessful plain insertion', async () => {
    const h = browser({ lateNonce: true }); h.domReady(); await h.flush();
    assert.equal(h.injected.length, 1);
    assert.match(h.report(), /Код страницы: не ответил/);
    h.addNonce(); await h.flush();
    assert.equal(h.injected.length, 2);
    assert.match(h.report(), /Код страницы: на связи/);
});

test('bootstrap supports pages without a nonce when inline scripts are allowed', async () => {
    const h = browser({ nonce: '', policy: 'inline' }); h.domReady(); await h.flush();
    assert.match(h.report(), /Запуск подмены: выполнен без nonce/);
    assert.match(h.report(), /Подмена в плеере: подключена/);
});

test('bootstrap distinguishes an execution error from blocked insertion', async () => {
    const h = browser({ pageError: true }); await h.flush();
    assert.match(h.report(), /Запуск подмены: ошибка кода: test page failure/);
    assert.match(h.report(), /Код страницы: не ответил/);
});

test('page bridge rejects foreign messages and unsafe catalog URLs', async () => {
    const h = browser(); await h.flush();
    const original = h.page.window.__fkCensorReplacements;
    const receive = (origin, source, replacements) => {
        for (const fn of h.page.listeners.message) fn({ origin, source, data: {
            channel: 'fkc-ios-1555-v1', from: 'loader', type: 'catalog', replacements,
        } });
    };
    receive('https://other.example', h.page.window, { 123: { url: 'https://audio.example/evil' } });
    receive('https://music.yandex.ru', {}, { 123: { url: 'https://audio.example/evil' } });
    assert.equal(h.page.window.__fkCensorReplacements, original);
    receive('https://music.yandex.ru', h.page.window, { 123: { url: 'javascript:alert(1)' } });
    assert.equal(h.page.window.__fkCensorReplacements, original);
});

test('returning to a live tab refreshes only after a minute without reloading the site', async () => {
    const h = browser(); await h.flush();
    const visible = () => { for (const fn of h.content.document.listeners.visibilitychange) fn(); };
    visible(); await h.flush(); assert.equal(h.requests.length, 6);
    h.clock.now += 61000;
    visible(); await h.flush(); assert.equal(h.requests.length, 12);
    assert.match(h.button().textContent, /готово/);
});

test('duplicate audio requests share one download and reuse the resulting blob', async () => {
    const h = browser(); await h.flush();
    const resource = new h.Resource();
    const [a, b] = await Promise.all([resource.getFileInfo({ trackId: '138629224' }), resource.getFileInfo({ trackId: '138629224' })]);
    assert.equal(a.downloadInfo.url, b.downloadInfo.url);
    assert.equal(h.audioRequests.length, 1);
    const c = await resource.getFileInfo({ trackId: '138629224' });
    assert.equal(c.downloadInfo.url, a.downloadInfo.url);
    assert.equal(h.audioRequests.length, 1);
});

test('failed or non-audio responses keep the native result and report the audio error', async () => {
    for (const audio of [() => null, () => new TextEncoder().encode('<html>offline</html>').buffer]) {
        const h = browser({ audio }); await h.flush();
        assert.equal(await new h.Resource().getFileInfo({ trackId: '138629224' }), h.nativeResponse);
        await h.flush();
        assert.match(h.report(), /ошибка файла 138629224/);
        assert.match(h.report(), /Последняя подмена: ещё не было/);
    }
});

test('Blob responses from a script manager are also accepted', async () => {
    const h = browser({ audio: () => new Blob([new Uint8Array([255, 251, 0, 0, 0])], { type: 'audio/mpeg' }) });
    await h.flush();
    const result = await new h.Resource().getFileInfo({ trackId: '138629224' });
    assert.match(result.downloadInfo.url, /^blob:/);
});

test('an audio message cannot instruct the extension to fetch an arbitrary URL', async () => {
    const h = browser(); await h.flush();
    for (const fn of h.content.listeners.message) fn({ origin: 'https://music.yandex.ru', source: h.content.window,
        data: { channel: 'fkc-ios-1555-v1', from: 'player', type: 'audio-request', requestId: 999,
            trackId: '99999999999999999999', url: 'https://unrelated.example/private' } });
    await h.flush();
    assert.equal(h.audioRequests.length, 0);
});
