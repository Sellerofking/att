module.exports = async function handler(req, res) {
    const urlPath = (req.headers['x-invoke-path'] || req.url || '').split('?')[0];
    const method = (req.method || 'POST').toUpperCase();
    const REAL = "https://api.attendance.gov.in";

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
        const d = new Date(Date.now() + 5.5 * 3600 * 1000);
        return `${pad(d.getUTCDate())}-${pad(d.getUTCMonth() + 1)}-${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
    };
    const xmlHeader = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

    // =====================================================
    // HEALTH: real server connectivity + diagnostics
    // =====================================================
    if (urlPath === '/health') {
        const diag = {};
        // 1. plain https to attendance.gov.in root
        try {
            const r1 = await fetch('https://attendance.gov.in/', { method: 'GET' });
            diag.gov_root = 'HTTP ' + r1.status;
        } catch (e) {
            diag.gov_root = 'FAIL: ' + (e.cause && e.cause.message ? e.cause.message : e.message);
        }
        // 2. api host ping/versioncheck
        try {
            const r2 = await fetch(REAL + '/ping/versioncheck', {
                method: 'POST',
                headers: { 'content-type': 'application/xml' },
                body: '<xml/>'
            });
            diag.api_ping = 'HTTP ' + r2.status;
        } catch (e) {
            diag.api_ping = 'FAIL: ' + (e.cause && e.cause.message ? e.cause.message : e.message);
        }
        // 3. dns check
        try {
            const dns = await import('dns').then(m => m.default || m);
            const p = dns.promises;
            const ip = await p.lookup('api.attendance.gov.in');
            diag.dns = ip.address;
        } catch (e) {
            diag.dns = 'FAIL: ' + e.message;
        }
        return res.status(200).json(diag);
    }

    // =====================================================
    // FAKE: /integrity/nonce
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

        // ==========================================
        // PROTECTION: Vercel/trace headers remove karo
        // taaki real server ko proxy pata na chale
        // ==========================================
        const headersToRemove = [
            'x-request-id', 'x-b3-traceid', 'x-b3-spanid', 'x-b3-parentspanid',
            'x-b3-sampled', 'x-b3-flags', 'x-cloud-trace-context', 'x-vercel-',
            'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-port',
            'x-forwarded-server', 'x-original-host', 'x-real-host',
            'x-vercel-deployment-url', 'x-vercel-id', 'x-vercel-proxy',
            'x-vercel-ip-country', 'x-vercel-ip-city', 'x-vercel-ip-latitude',
            'x-vercel-ip-longitude', 'x-vercel-ip-country-region',
            'x-vercel-ip-continent', 'x-vercel-ip-timezone', 'x-vercel-ip-as',
            'x-vercel-ip-asn', 'x-vercel-ip-org', 'x-vercel-proxied',
            'x-vercel-skip', 'x-vercel-cache', 'x-vercel-preview',
            'x-vercel-protection', 'x-vercel-security', 'x-vercel-tls',
            'x-vercel-http', 'x-vercel-request-id', 'x-vercel-request-time',
            'x-vercel-request-count', 'x-vercel-proxy-request', 'x-vercel-env',
            'x-vercel-region', 'x-vercel-runtime', 'x-vercel-architecture',
            'x-vercel-function', 'x-vercel-dpl', 'x-vercel-deployment',
            'x-vercel-project', 'x-vercel-team', 'x-vercel-user',
            'x-vercel-token', 'x-vercel-session', 'x-vercel-edge',
            'x-vercel-edge-request', 'x-vercel-edge-location', 'x-vercel-edge-ip',
            'x-vercel-edge-region', 'x-vercel-edge-city', 'x-vercel-edge-country',
            'x-invoke-path', 'content-length', 'accept-encoding'
        ];
        headersToRemove.forEach(key => {
            Object.keys(headers).forEach(header => {
                if (header.toLowerCase().startsWith(key.toLowerCase()) || header.toLowerCase() === key.toLowerCase()) {
                    delete headers[header];
                }
            });
        });

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
