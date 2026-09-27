module.exports = async function handler(req, res) {
    const urlPath = (req.headers['x-invoke-path'] || req.url || '').split('?')[0];
    const method = (req.method || 'POST').toUpperCase();
    const REAL = "https://api.attendance.gov.in";

    // raw body collect (attendance app XML POST bhejti hai)
    const rawBody = await new Promise((resolve) => {
        if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
            return resolve(JSON.stringify(req.body));
        }
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', () => resolve(''));
        setTimeout(() => resolve(''), 5000);
    });

    const pad = (n) => String(n).padStart(2, '0');
    const istTs = () => {
        const d = new Date(Date.now() + 5.5 * 3600 * 1000); // IST
        return `${pad(d.getUTCDate())}-${pad(d.getUTCMonth() + 1)}-${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
    };
    const xmlHeader = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

    // =====================================================
    // HEALTH: real server connectivity check
    // =====================================================
    if (urlPath === '/health') {
        try {
            const r = await fetch(REAL + '/ping/versioncheck', { method: 'POST', headers: { 'content-type': 'application/xml' }, body: '<xml/>' });
            return res.status(200).send('REAL_SERVER: status=' + r.status);
        } catch (e) {
            return res.status(500).send('REAL_SERVER: ' + e.message);
        }
    }

    // =====================================================
    // FAKE: /integrity/nonce -> random nonce (Google token ke liye)
    // =====================================================
    if (urlPath.includes('/integrity/nonce')) {
        const nonce = require('crypto').randomBytes(16).toString('hex');
        const xml = xmlHeader + '<xml>' +
            '<status>noncegenerated</status>' +
            `<nonce>${nonce}</nonce>` +
            '<expires_at>' + Math.floor(Date.now() / 1000) + 3600 + '</expires_at>' +
            '</xml>';
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        return res.status(200).send(xml);
    }

    // =====================================================
    // FAKE: /integrity/verifytoken -> hamesha success (I10 fix)
    // =====================================================
    if (urlPath.includes('/integrity/verifytoken')) {
        const xml = xmlHeader + '<xml>' +
            '<status>success</status>' +
            '<integrity_verified>true</integrity_verified>' +
            `<integrity_timestamp>${istTs()}</integrity_timestamp>` +
            `<runtime_secret>ATT_PROXY_${Date.now()}_SECRET</runtime_secret>` +
            '</xml>';
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        return res.status(200).send(xml);
    }

    // =====================================================
    // PASSTHROUGH baaki sab kuchh
    // =====================================================
    try {
        const headers = { ...req.headers };
        headers['host'] = 'api.attendance.gov.in';
        delete headers['content-length'];
        delete headers['x-invoke-path'];
        delete headers['x-forwarded-host'];

        const opts = { method, headers };
        if (rawBody && method !== 'GET' && method !== 'HEAD') {
            opts.body = rawBody;
        }

        const r = await fetch(REAL + urlPath, opts);
        let body = await r.text();

        res.status(r.status);
        const ct = r.headers.get('content-type');
        if (ct) res.setHeader('Content-Type', ct);
        return res.send(body);
    } catch (e) {
        res.setHeader('Content-Type', 'text/plain');
        return res.status(500).send('Proxy Error: ' + e.message);
    }
};
