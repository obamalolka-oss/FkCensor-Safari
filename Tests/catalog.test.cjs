'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseDocument, mergeCatalogs, normalizeJSON, satisfies } = require('../src/catalog-core.js');
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/seed-catalog.json')));
const priority = ['base', 'liberty', 'additional', 'ink-fun-v2', 'ink-fun-v1', 'fck-v1'];
const v2 = (...storages) => ({ sources: [{ supportedVersions: '>=2.0.0', tracksStorages: storages }] });

test('bundled snapshot contains all 1555 unique replacements', () => {
    assert.equal(seed.version, 1);
    const catalog = mergeCatalogs(priority.map((id) => seed.sources[id].replacements));
    assert.equal(Object.keys(catalog).length, 1555);
    assert.equal(catalog['149360077'].url, 'https://raw.githubusercontent.com/Hazzz895/FckCensorData/refs/heads/main/tracks/149665384');
    assert.equal(catalog['27317249'].url, 'https://huggingface.co/datasets/naloz/YMliberty/resolve/main/tracks/27317249.mp3');
    assert.equal(catalog['138629224'].durationMs, 134034);
    for (const [id, entry] of Object.entries(catalog)) {
        assert.match(id, /^\d+$/);
        assert.equal(new URL(entry.url).protocol, 'https:');
        assert.equal(new URL(entry.url).username, '');
    }
});

test('v1 supports absolute, schemeless and object URLs', () => {
    const result = parseDocument({ tracks: { 1: 'https://audio.example/one', 2: 'audio.example/two',
        3: { url: 'https://audio.example/three', durationMs: 120000 } } });
    assert.equal(Object.keys(result).length, 3);
    assert.equal(result[2].url, 'https://audio.example/two');
    assert.equal(result[3].durationMs, 120000);
});

test('v2 supports template redirects, numeric/string/object ids and explicit entries', () => {
    const result = parseDocument(v2({ urlTemplate: 'audio.example/%%', tracks: {
        1: 90, 2: { url: 91, durationMs: 1000 }, 3: 'https://other.example/file.mp3',
    }, trackIds: [1, '4', { id: 5, durationMs: 2000 }] }));
    assert.equal(result[1].url, 'https://audio.example/90');
    assert.equal(result[2].url, 'https://audio.example/91');
    assert.equal(result[3].url, 'https://other.example/file.mp3');
    assert.equal(result[4].url, 'https://audio.example/4');
    assert.equal(result[5].durationMs, 2000);
});

test('source and repository priority match the desktop list', () => {
    const catalog = parseDocument({ sources: [
        { tracksStorages: [{ tracks: { 1: 'https://first.example/1' } }] },
        { tracksStorages: [{ tracks: { 1: 'https://later.example/1' } }] },
    ] });
    assert.equal(catalog[1].url, 'https://later.example/1');
    const merged = mergeCatalogs([catalog, { 1: { url: 'https://extra.example/1' }, 2: { url: 'https://extra.example/2' } }]);
    assert.equal(merged[1], catalog[1]);
    assert.equal(merged[2].url, 'https://extra.example/2');
});

test('incompatible and unknown version ranges never enter the player', () => {
    const json = { sources: [
        { supportedVersions: '>2.0.0', tracksStorages: [{ tracks: { 1: 'https://audio.example/1' } }] },
        { supportedVersions: ['>=1.0.0', '<3.0.0'], tracksStorages: [{ tracks: { 2: 'https://audio.example/2' } }] },
        { supportedVersions: 'not-a-version', tracksStorages: [{ tracks: { 3: 'https://audio.example/3' } }] },
    ] };
    assert.deepEqual(Object.keys(parseDocument(json)), ['2']);
    assert.equal(satisfies('2.0.0', '^2.0.0'), true);
    assert.equal(satisfies('2.0.0', '~1.2.0'), false);
    assert.equal(satisfies('0.0.4', '^0.0.3'), false);
    assert.equal(satisfies('2.0.0', '!=2.0.0'), false);
});

test('unsafe URLs, missing templates, invalid ids and durations are rejected', () => {
    const result = parseDocument(v2({ tracks: {
        1: 'javascript:alert(1)', 2: 'http://audio.example/a', 3: 'https://' + 'user:pass' + '@audio.example/a',
        4: 42, 5: { url: 'https://audio.example/5', durationMs: -1 },
        6: 'https://audio.example/a b', 7: 'file:///etc/passwd', '../secret': 'https://audio.example/8',
    }, trackIds: [9] }));
    assert.deepEqual(Object.keys(result), ['5']);
    assert.equal(result[5].durationMs, undefined);
});

test('empty, malformed and changed catalog formats cannot replace a last good source', () => {
    for (const text of ['<html>offline</html>', '{}', '{"sources":[]}', '{"tracks":{}}', 'null']) {
        assert.throws(() => normalizeJSON(text));
    }
    const text = normalizeJSON('{"tracks":{"123":"https://audio.example/123"}}');
    assert.equal(JSON.parse(text)[123].url, 'https://audio.example/123');
});
