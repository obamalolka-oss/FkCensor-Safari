'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { parseDocument, mergeCatalogs } = require('../src/catalog-core.js');
const sources = require('../data/sources.json');
const root = path.join(__dirname, '..');
const seed = JSON.parse(fs.readFileSync(path.join(root, 'data/seed-catalog.json')));

async function probeAudio(url) {
    const response = await fetch(url, { headers: { Range: 'bytes=0-4095' }, signal: AbortSignal.timeout(14000) });
    if (!response.ok || !response.body) return { status: response.status, audio: false };
    const reader = response.body.getReader();
    let bytes;
    try { ({ value: bytes } = await reader.read()); } finally { await reader.cancel(); }
    const mp3 = bytes && (Buffer.from(bytes.subarray(0, 3)).toString() === 'ID3'
        || (bytes[0] === 255 && (bytes[1] & 224) === 224));
    return { status: response.status, audio: Boolean(mp3), cors: response.headers.get('access-control-allow-origin') };
}

(async () => {
    const results = await Promise.all(sources.map(async ([id, url]) => {
        try {
            const response = await fetch(url + '?fkc=' + Date.now(), {
                headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(14000),
            });
            if (!response.ok) throw new Error('HTTP ' + response.status);
            const replacements = parseDocument(await response.json());
            console.log(id + ': ' + Object.keys(replacements).length + ' replacements');
            return { id, ok: true, count: Object.keys(replacements).length, replacements };
        } catch (error) { console.log(id + ': ' + error.message); return { id, ok: false, error: error.message }; }
    }));
    const merged = mergeCatalogs(results.map((item) => item.replacements || seed.sources[item.id].replacements));
    const probes = await Promise.all(['base', 'additional', 'liberty'].map(async (id) => {
        const entries = results.find((item) => item.id === id)?.replacements || seed.sources[id].replacements;
        const entry = Object.values(entries)[0];
        try {
            const result = await probeAudio(entry.url);
            console.log(id + ' audio sample: ' + JSON.stringify(result));
            return { id, ...result };
        } catch (error) { console.log(id + ' audio sample: ' + error.message); return { id, audio: false, error: error.message }; }
    }));
    const report = { checkedAt: new Date().toISOString(), total: Object.keys(merged).length,
        sources: results.map(({ replacements, ...rest }) => rest), audioSamples: probes };
    if (process.env.FKC_NETWORK_REPORT) {
        fs.writeFileSync(path.resolve(process.env.FKC_NETWORK_REPORT), JSON.stringify(report, null, 2) + '\n');
    }
    console.log(JSON.stringify(report, null, 2));
    console.log('Merged current total: ' + report.total + '; audio probes read only the first response chunk');
    if (results.some((r) => !r.ok) || probes.some((p) => !p.audio)) process.exitCode = 1;
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
