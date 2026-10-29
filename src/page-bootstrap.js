/* PAGE_SOURCE is bundled locally. This bootstrap runs in the extension's content world. */
(function () {
    'use strict';
    if (window.__fkcSafariBootstrap) return;
    window.__fkcSafariBootstrap = true;
    const channel = 'fkc-ios-1555-v1', attempted = new Set();
    let state = 'ожидание разрешения сайта (nonce)', finished = false, observer, timeout;
    function report() {
        window.postMessage({ channel, from: 'bootstrap', type: 'bootstrap-status', state, version: '1.0.1' }, window.location.origin);
    }
    function stop() {
        finished = true;
        observer?.disconnect();
        clearTimeout(timeout);
    }
    function inject(allowWithoutNonce = false) {
        if (finished) return;
        const parent = document.head || document.documentElement;
        if (!parent) return;
        // getAttribute('nonce') can be empty even when the DOM nonce property is present.
        const nonce = [...document.querySelectorAll('script[nonce]')].map((node) => node.nonce).find(Boolean) || '';
        if ((!nonce && !allowWithoutNonce) || attempted.has(nonce) || attempted.size >= 4) return;
        attempted.add(nonce);
        const node = document.createElement('script');
        if (nonce) node.nonce = nonce;
        node.textContent = '(function () { const node = document.currentScript; try {\n' + PAGE_SOURCE
            + '\nnode.setAttribute("data-fkc-result", "ok");\n} catch (error) {'
            + 'node.setAttribute("data-fkc-result", "error");'
            + 'node.setAttribute("data-fkc-error", String(error.message || error).slice(0, 180)); } })();';
        try {
            parent.appendChild(node);
            const result = node.getAttribute('data-fkc-result');
            if (result === 'ok') {
                state = nonce ? 'выполнен с nonce сайта' : 'выполнен без nonce';
                stop();
            } else if (result === 'error') {
                state = 'ошибка кода: ' + node.getAttribute('data-fkc-error');
                stop();
            } else state = nonce ? 'вставка с nonce не выполнена; возможна блокировка CSP'
                : 'вставка не выполнена; nonce сайта не найден, возможна блокировка CSP';
        } catch (error) { state = 'ошибка вставки: ' + String(error.message || error).slice(0, 180); }
        finally { node.remove(); }
        report();
    }
    window.addEventListener('message', (event) => {
        if (event.source !== window || event.origin !== window.location.origin) return;
        if (event.data?.channel === channel && event.data.from === 'loader' && event.data.type === 'ping') report();
    });
    observer = new MutationObserver(() => inject());
    observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['nonce'] });
    timeout = setTimeout(() => { inject(true); if (!finished) { stop(); report(); } }, 15000);
    document.addEventListener('DOMContentLoaded', () => inject(true), { once: true });
    inject(document.readyState !== 'loading');
    report();
})();
