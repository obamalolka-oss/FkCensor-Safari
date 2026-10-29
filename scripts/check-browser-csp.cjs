// Optional smoke test using a locally installed Chromium and Playwright.
// Fixtures stay local; this does not sign in to Yandex or test audible playback on iOS.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const playwright = require('./browser-runtime.cjs').loadPlaywright();
const engine = process.env.FKC_ENGINE || 'chromium';
const root = path.join(__dirname, '..');
const player = fs.readFileSync(path.join(root, 'userscripts/FkCensor-1-player.user.js'), 'utf8');
const loader = fs.readFileSync(path.join(root, 'userscripts/FkCensor-2-lists.user.js'), 'utf8');
const gm = `const GM = { getValue: async () => null, setValue: async () => {},
    xmlHttpRequest: async (details) => {
        const response = details.responseType === 'arraybuffer'
            ? { status: 200, response: new Uint8Array([73,68,51,4,0,0,0,0]).buffer }
            : { status: 503, responseText: '' };
        details.onload(response); return response;
    } };`;
const fixture = `class Resource { async getFileInfo() { return { downloadInfo: { url: 'native' } }; } }
    window.testResource = new Resource();
    const appRequire = () => ({ Resource });
    appRequire.m = { 1: function () { return 'get-file-info'; } };
    window.webpackChunk_N_E = [];
    window.webpackChunk_N_E.push = function (chunk) {
        chunk[2](appRequire); return Array.prototype.push.call(this, chunk);
    };`;
(async () => {
    const browser = await playwright[engine].launch({ headless: true,
        ...(process.env.FKC_BROWSER ? { executablePath: process.env.FKC_BROWSER } : {}) });
    try {
        for (const blocked of [false, true]) {
            const context = await browser.newContext();
            await context.route('https://music.yandex.ru/**', (route) => route.fulfill({ status: 200, contentType: 'text/html',
                headers: { 'Content-Security-Policy': blocked ? "script-src 'none'" : "script-src 'nonce-fixture'; media-src blob:" },
                body: '<!doctype html><html><head>' + (blocked ? '' : '<script nonce="fixture">' + fixture + '</script>')
                    + '</head><body>Local CSP fixture</body></html>',
            }));
            const page = await context.newPage();
            page.on('pageerror', (error) => console.error('Page error:', error.message));
            if (engine === 'chromium') {
            const cdp = await context.newCDPSession(page);
            await cdp.send('Page.enable');
            await cdp.send('Runtime.enable');
            cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => console.error('Runtime error:',
                exceptionDetails.exception?.description || exceptionDetails.text));
            await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
                worldName: 'fkc-extension', source: gm + '\n' + player + '\n' + loader,
            });
            } else {
                // WebKit's public API initializes in the page world, not an extension world.
                // CSP still applies to the inline script inserted by our bootstrap.
                await context.addInitScript(gm + '\n' + player + '\n' + loader);
            }
            await page.goto('https://music.yandex.ru/');
            await page.waitForFunction(() => {
                const title = document.querySelector('#fkc-safari-status')?.title || '';
                return /Запуск подмены: (выполнен с nonce|вставка не выполнена)/.test(title);
            }, null, { timeout: 5000 }).catch(async (error) => {
                console.error('Fixture report:', await page.evaluate(() => document.querySelector('#fkc-safari-status')?.title || 'no button'));
                console.error('Page state:', await page.evaluate(() => ({ hook: !!window.FkCensorIOS,
                    scripts: [...document.scripts].map((script) => ({ nonce: script.nonce, result: script.getAttribute('data-fkc-result') })) })));
                throw error;
            });
            const report = () => page.locator('#fkc-safari-status').getAttribute('title');
            if (blocked) {
                assert.match(await report(), /Код страницы: не ответил/);
                assert.equal(await page.evaluate(() => !!window.FkCensorIOS), false);
                console.log('PASS: script-src none is reported as blocked, not ready');
            } else {
                await page.waitForFunction(() => document.querySelector('#fkc-safari-status').title.includes('подключена'));
                assert.match(await report(), /Применено в странице: 1555 треков/);
                const url = await page.evaluate(async () => (await window.testResource.getFileInfo({ trackId: '138629224' })).downloadInfo.url);
                assert.match(url, /^blob:/);
                assert.deepEqual(await page.evaluate(async (url) => [...new Uint8Array(await (await fetch(url)).arrayBuffer())], url),
                    [73,68,51,4,0,0,0,0]);
                await page.waitForFunction(() => document.querySelector('#fkc-safari-status').title.includes('Последняя подмена: 138629224'));
                console.log('PASS: ' + engine + (engine === 'chromium' ? ' isolated content' : ' page-init')
                    + ' bootstrap uses nonce; page hook, catalog and MP3 Blob bridge work');
            }
            await context.close();
        }
    } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
