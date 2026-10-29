'use strict';
function loadPlaywright() {
    const candidates = [process.env.FKC_PLAYWRIGHT, 'playwright'].filter(Boolean);
    for (const candidate of candidates) {
        try { return require(candidate); }
        catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
    }
    throw new Error('Playwright not found. Set FKC_PLAYWRIGHT to its package directory.');
}
module.exports = { loadPlaywright };
