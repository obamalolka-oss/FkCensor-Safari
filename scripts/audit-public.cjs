'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

function contentIssues(text, privateName = os.userInfo().username) {
    const issues = [];
    const rules = [
        ['токен GitHub', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/],
        ['токен Hugging Face', /\bhf_[A-Za-z0-9]{25,}\b/],
        ['ключ AWS', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
        ['секретный ключ', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
        ['JWT', /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/],
        ['Bearer credential', /Bearer\s+[A-Za-z0-9._~-]{20,}/i],
        ['локальный профиль Windows', /[A-Za-z]:[\\/]Users[\\/][^\\/\s"'<>]+/i],
        ['локальный профиль macOS/Linux', /\/(?:Users|home)\/[A-Za-z0-9_.-]+\//],
        ['пароль в URL', /https?:\/\/[^\s/"'<>]+:[^\s/"'<>]+@/i],
        ['секрет в query URL', /[?&](?:access_token|refresh_token|api_key|token|password|signature|x-amz-signature)=[A-Za-z0-9%_.~-]{8,}/i],
    ];
    for (const [label, pattern] of rules) if (pattern.test(text)) issues.push(label);
    const emails = text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi) || [];
    if (emails.some((email) => !email.toLowerCase().endsWith('@users.noreply.github.com'))) {
        issues.push('email, не являющийся GitHub noreply');
    }
    if (privateName && privateName.length >= 5 && text.toLowerCase().includes(privateName.toLowerCase())) {
        issues.push('имя локального пользователя');
    }
    return issues;
}

function audit(root) {
    root = path.resolve(root);
    if (fs.lstatSync(root).isSymbolicLink()) throw new Error('Каталог публикации не должен быть ссылкой');
    const manifestPath = path.join(root, 'public-files.json');
    if (fs.lstatSync(manifestPath).isSymbolicLink()) throw new Error('Манифест не должен быть ссылкой');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!Array.isArray(manifest) || new Set(manifest).size !== manifest.length || !manifest.includes('public-files.json')) {
        throw new Error('Некорректный public-files.json');
    }
    const allowed = new Set(manifest), problems = [], files = [];
    for (const file of manifest) {
        if (typeof file !== 'string' || !/^[A-Za-z0-9_.\/-]+$/.test(file)
                || file.startsWith('/') || file.split('/').some((part) => !part || part === '..' || part === '.git')) {
            throw new Error('Недопустимый путь в манифесте');
        }
    }
    const visited = new Set();
    function walk(dir, prefix = '') {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const relative = prefix + entry.name, full = path.join(dir, entry.name);
            const info = fs.lstatSync(full);
            if (info.isSymbolicLink()) { problems.push(relative + ': символическая ссылка'); continue; }
            // Metadata is never part of the release archive. This check does not audit Git history.
            if (relative === '.git') continue;
            if (info.isDirectory()) { walk(full, relative + '/'); continue; }
            visited.add(relative);
            if (!info.isFile() || !allowed.has(relative)) {
                problems.push(relative + ': файл не разрешён манифестом'); continue;
            }
            if (info.size > 2 * 1024 * 1024) { problems.push(relative + ': превышен лимит размера'); continue; }
            const bytes = fs.readFileSync(full);
            let text;
            try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
            catch { problems.push(relative + ': нетекстовый файл'); continue; }
            if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) problems.push(relative + ': бинарное содержимое');
            for (const issue of contentIssues(text)) problems.push(relative + ': ' + issue);
            files.push({ file: relative, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
        }
    }
    walk(root);
    for (const file of manifest) if (!visited.has(file)) problems.push(file + ': файл отсутствует');
    if (problems.length) throw new Error(problems.join('\n'));
    return { status: 'passed', files: files.sort((a, b) => a.file.localeCompare(b.file)), gitHistoryScanned: false };
}

if (require.main === module) {
    try {
        const report = audit(path.join(__dirname, '..'));
        if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
        else console.log('Проверено файлов: ' + report.files.length + '. Неожиданных файлов и известных форм секретов не найдено. История Git не проверялась.');
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { audit, contentIssues };
