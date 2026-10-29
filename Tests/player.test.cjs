'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/player-hook.js'), 'utf8');
const entry = { url: 'https://audio.example/123.mp3', durationMs: 180000 };

function harness({ hostname = 'music.yandex.ru', lazy = false } = {}) {
    const events = [], timers = [];
    const nativeSingle = { downloadInfo: { trackId: '123', codec: 'aac', key: 'secret', transport: 'encraw',
        urls: ['native'], normalization: 'native', quality: 'lossless' } };
    const nativeBatch = { fileInfos: [nativeSingle.downloadInfo, { trackId: '456', key: 'preserved' }] };
    class Resource {
        async getFileInfo() { if (this.failure) throw this.failure; return this.deferred ? await this.deferred : nativeSingle; }
        async getFileInfoBatch() { if (this.failure) throw this.failure; return nativeBatch; }
    }
    const require = () => ({ Resource });
    require.m = lazy ? {} : { 1: function () { return 'resources/v2/file-info'; } };
    const chunks = [];
    chunks.push = function (item) { if (item[2]) item[2](require); return Array.prototype.push.call(this, item); };
    class FakeResponse {
        constructor(value, url = 'https://api.music.yandex.net/tracks') { this.value = value; this.url = url; }
        async json() { return this.value; }
    }
    const window = { location: { hostname, origin: 'https://' + hostname }, webpackChunk_N_E: chunks, __fkCensorReplacements: { 123: entry },
        postMessage: (event) => events.push(event),
        fetch() { throw new Error('A listed-only player must never search external catalogs'); },
    };
    const context = vm.createContext({ window, Response: FakeResponse, console,
        setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; } });
    vm.runInContext(source, context);
    return { window, Resource, nativeSingle, nativeBatch, FakeResponse, events, timers, require, chunks, context };
}

test('single replacement is raw MP3 and contains no native encryption or codec metadata', async () => {
    const h = harness();
    const result = await new h.Resource().getFileInfo({ trackId: '123', quality: 'lossless' });
    assert.equal(result.downloadInfo.url, entry.url);
    assert.equal(result.downloadInfo.codec, 'mp3');
    assert.equal(result.downloadInfo.transport, 'raw');
    assert.equal(result.downloadInfo.quality, 'hq');
    assert.equal('key' in result.downloadInfo, false);
    assert.equal('normalization' in result.downloadInfo, false);
    assert.equal(h.nativeSingle.downloadInfo.key, 'secret');
    assert.ok(h.events.some((event) => event.type === 'connected'));
});

test('unlisted tracks return the exact native response and native error', async () => {
    const h = harness(), resource = new h.Resource();
    assert.equal(await resource.getFileInfo({ trackId: '456' }), h.nativeSingle);
    resource.failure = new Error('native failure');
    await assert.rejects(resource.getFileInfo({ trackId: '456' }), (e) => e === resource.failure);
});

test('listed track can play when the original single request fails', async () => {
    const h = harness(), resource = new h.Resource();
    resource.failure = new Error('deleted native track');
    const result = await resource.getFileInfo({ trackId: '123' });
    assert.equal(result.downloadInfo.url, entry.url);
});

test('batch replaces listed entries and keeps unlisted entries intact', async () => {
    const h = harness();
    const result = await new h.Resource().getFileInfoBatch({ trackIds: '123,456' });
    assert.equal(result.fileInfos.length, 2);
    assert.equal(result.fileInfos[0].url, entry.url);
    assert.equal('key' in result.fileInfos[0], false);
    assert.equal(result.fileInfos[1], h.nativeBatch.fileInfos[1]);
    assert.equal(h.nativeBatch.fileInfos[0].key, 'secret');
});

test('mixed batch errors are preserved, all-listed batch can be restored', async () => {
    const h = harness(), resource = new h.Resource();
    resource.failure = new Error('network error');
    await assert.rejects(resource.getFileInfoBatch({ trackIds: ['123', '456'] }), (e) => e === resource.failure);
    const result = await resource.getFileInfoBatch({ trackIds: ['123', '123'] });
    assert.equal(result.downloadInfos.length, 1);
    assert.equal(result.downloadInfos[0].url, entry.url);
});

test('album-qualified track ids use the same listed track', async () => {
    const h = harness();
    const result = await new h.Resource().getFileInfo({ trackId: '123:987' });
    assert.equal(result.downloadInfo.url, entry.url);
    assert.equal(result.downloadInfo.trackId, '123:987');
});

test('catalog refresh updates an existing hook without reloading the player', async () => {
    const h = harness(), resource = new h.Resource();
    h.window.FkCensorIOS.updateCatalog({ 123: { url: 'https://audio.example/new.mp3' } });
    assert.equal((await resource.getFileInfo({ trackId: '123' })).downloadInfo.url, 'https://audio.example/new.mp3');
    h.window.FkCensorIOS.updateCatalog({});
    assert.equal(await resource.getFileInfo({ trackId: '123' }), h.nativeSingle);
});

test('removing a replacement during an in-flight request restores the native result', async () => {
    const h = harness(), resource = new h.Resource();
    let resolve;
    resource.deferred = new Promise((done) => { resolve = done; });
    const pending = resource.getFileInfo({ trackId: '123' });
    h.window.FkCensorIOS.updateCatalog({});
    resolve(h.nativeSingle);
    assert.equal(await pending, h.nativeSingle);
});

test('duration and availability change only for listed track DTOs from Yandex API', async () => {
    const h = harness();
    const listed = { id: 123, title: 'Track', artists: [], durationMs: 170000, available: false, error: 'unavailable' };
    const unlisted = { id: 456, title: 'Other', artists: [], durationMs: 170000, available: false };
    const album = { id: 123, title: 'Album', artists: [] };
    await new h.FakeResponse({ result: [listed, unlisted, album] }).json();
    assert.equal(listed.durationMs, 180000);
    assert.equal(listed.available, true);
    assert.equal('error' in listed, false);
    assert.equal(unlisted.available, false);
    assert.equal(album.available, undefined);
    const other = { ...listed, durationMs: 1000 };
    await new h.FakeResponse(other, 'https://another.example/metadata').json();
    assert.equal(other.durationMs, 1000);
});

test('lazy chunks are hooked after the initial screen', async () => {
    const h = harness({ lazy: true });
    assert.equal(h.events.some((e) => e.type === 'connected'), false);
    h.require.m[2] = function () { return 'get-file-info'; };
    h.chunks.push([[2], {}, () => {}]);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal((await new h.Resource().getFileInfo({ trackId: '123' })).downloadInfo.url, entry.url);
    assert.equal(h.events.filter((e) => e.type === 'connected').length, 1);
    assert.equal(h.chunks.length, 1); // Synthetic runtime chunks are removed.
});

test('a second injection does not wrap the resource again', () => {
    const h = harness(), method = h.Resource.prototype.getFileInfo;
    vm.runInContext(source, h.context);
    assert.equal(h.Resource.prototype.getFileInfo, method);
    assert.equal(h.events.filter((e) => e.type === 'ready').length, 1);
});

test('the hook does not run on Passport or unrelated pages', () => {
    for (const hostname of ['passport.yandex.ru', 'music.yandex.ru.attacker.example', 'example.com']) {
        const h = harness({ hostname });
        assert.equal(h.window.FkCensorIOS, undefined);
        assert.equal(h.events.length, 0);
        assert.equal(h.timers.length, 0);
    }
});

test('missing player reports waiting and continues looking for late modules', () => {
    const h = harness({ lazy: true });
    for (let i = 0; i < 150; i++) h.timers.shift().fn();
    assert.equal(h.events.filter((e) => e.type === 'waiting').length, 1);
    assert.equal(h.timers.at(-1).ms, 2000);
});
