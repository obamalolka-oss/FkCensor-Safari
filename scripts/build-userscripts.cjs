'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { mergeCatalogs } = require('../src/catalog-core.js');
const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const seed = JSON.parse(read('data/seed-catalog.json'));
const sources = JSON.parse(read('data/sources.json'));
const order = sources.map(([id]) => id);
const flat = mergeCatalogs(order.map((id) => seed.sources[id].replacements));
if (Object.keys(flat).length !== 1555) throw new Error('The bundled snapshot must have 1555 tracks');
function metadata(name, description, context, grants) {
    return ['// ==UserScript==', '// @name         ' + name, '// @namespace    fkcensor-ios',
        '// @version      1.0.1', '// @description  ' + description,
        ...['ru', 'com', 'kz', 'by', 'uz'].map((tld) => '// @match        https://music.yandex.' + tld + '/*'),
        '// @run-at       document-start', '// @inject-into  ' + context, '// @noframes',
        ...grants.map((grant) => '// @grant        ' + grant),
        ...(grants.includes('GM.xmlHttpRequest') ? ['// @connect      raw.githubusercontent.com', '// @connect      huggingface.co',
            '// @connect      hf.co', '// @connect      xethub.hf.co', '// @connect      cdn-lfs.huggingface.co',
            '// @connect      cas-bridge.xethub.hf.co'] : []),
        '// ==/UserScript==', ''].join('\n');
}
const pageSource = '(function () {\nif (window.__fkcSafariPage && window.FkCensorIOS) return;\nwindow.__fkCensorReplacements = ' + JSON.stringify(flat) + ';\n'
    + read('src/page-bridge.js') + '\n' + read('src/player-hook.js') + '\n})();\n';
const page = metadata('FkCensor iOS — 1. Подмена', '1555 готовых подмен. Запускает код с nonce сайта; включите вместе со вторым скриптом.', 'content', ['none'])
    + '(function () {\nconst PAGE_SOURCE = ' + JSON.stringify(pageSource) + ';\n' + read('src/page-bootstrap.js') + '\n})();\n';
const loader = metadata('FkCensor iOS — 2. Списки и проверка', 'Обновляет списки при открытии страницы. Кнопка FK показывает результат проверки.', 'content',
    ['GM.xmlHttpRequest', 'GM_xmlhttpRequest', 'GM.getValue', 'GM.setValue'])
    + '(function () {\nconst CORE = (function () { const module = { exports: {} };\n'
    + read('src/catalog-core.js') + '\nreturn module.exports; })();\nconst SEED = ' + JSON.stringify(seed)
    + ';\nconst SOURCES = ' + JSON.stringify(sources) + ';\n'
    + read('src/catalog-loader.js') + '\n})();\n';
const output = path.join(root, 'userscripts');
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'FkCensor-1-player.user.js'), page);
fs.writeFileSync(path.join(output, 'FkCensor-2-lists.user.js'), loader);
console.log('Built both Safari userscripts with 1555 bundled tracks');
