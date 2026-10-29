'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { audit, contentIssues } = require('../scripts/audit-public.cjs');

function fixture(fn) {
    const parent = path.resolve(os.tmpdir()), prefix = path.join(parent, 'fkc-public-test-');
    const root = fs.mkdtempSync(prefix);
    try {
        fs.writeFileSync(path.join(root, 'public-files.json'), JSON.stringify(['public-files.json', 'README.md']));
        fs.writeFileSync(path.join(root, 'README.md'), '# Публичный проект');
        return fn(root);
    } finally {
        const resolved = path.resolve(root);
        if (path.dirname(resolved) !== parent || !resolved.startsWith(prefix)) throw new Error('Unsafe temporary path');
        fs.rmSync(resolved, { recursive: true, force: true });
    }
}

test('publication audit hashes clean files and rejects an unexpected private file', () => fixture((root) => {
    assert.equal(audit(root).files.length, 2);
    fs.writeFileSync(path.join(root, '.env'), 'PRIVATE_VALUE=local');
    assert.throws(() => audit(root), /не разрешён/);
}));

test('publication audit rejects missing files and binary payloads disguised as source', () => fixture((root) => {
    fs.writeFileSync(path.join(root, 'README.md'), Buffer.from([0, 1, 2]));
    assert.throws(() => audit(root), /бинарное/);
    fs.unlinkSync(path.join(root, 'README.md'));
    assert.throws(() => audit(root), /отсутствует/);
}));

test('publication scanner detects credentials, local paths and personal email without printing their values', () => {
    const samples = [
        'gh' + 'p_' + 'A'.repeat(36),
        'hf' + '_' + 'b'.repeat(30),
        'Bearer ' + 'c'.repeat(30),
        'https://' + 'user:pass' + '@example.invalid/file',
        'C:' + '\\Users\\' + 'private-person\\file',
        'person' + '@' + 'example.invalid',
        'https://example.invalid/?access_' + 'token=' + 'd'.repeat(20),
    ];
    for (const sample of samples) assert.ok(contentIssues(sample, 'unused-private-name').length, 'Synthetic secret must be detected');
    assert.deepEqual(contentIssues('https://github.com/obamalolka-oss', 'unused-private-name'), []);
});

test('publication audit rejects symlinks rather than following them', () => fixture((root) => {
    fs.mkdirSync(path.join(root, 'real'));
    fs.symlinkSync(path.join(root, 'real'), path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => audit(root), /символическая ссылка/);
}));
