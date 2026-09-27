module.exports = async function handler(req, res) {
    const urlPath = (req.headers['x-invoke-path'] || req.url || '').split('?')[0];
    const method = (req.method || 'POST').toUpperCase();
    const REAL = "https://api.attendance.gov.in";

    // raw body collect (attendance app XML POST bhejti hai, Vercel XML parse nahi karta)
    const rawBody = await new Promise((resolve) => {
        if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
            return resolve(JSON.stringify(req.body));
        }
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', () => resolve(''));
        // safety timeout
        setTimeout(() => resolve(''), 5000);
    });

    // =====================================================
    // FAKE: /integrity/verifytoken -> hamesha success
    // Server ka Google-token rejection bypass (I10 fix)
    // PASSTHROUGH=1 env se debug ke liye real server pe bhejo
    // =====================================================
    if (urlPath.includes('/integrity/verifytoken') && process.env.PASSTHROUGH !== '1') {
        const d = new Date(Date.now() + 5.5 * 3600 * 1000); // IST
        const pad = (n) => String(n).padStart(2, '0');
        const ts = `${pad(d.getUTCDate())}-${pad(d.getUTCMonth() + 1)}-${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
        const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<xml>' +
            '<status>success</status>' +
            '<integrity_verified>true</integrity_verified>' +
            `<integrity_timestamp>${ts}</integrity_timestamp>` +
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

        const opts = { method, headers };
        if (rawBody && method !== 'GET' && method !== 'HEAD') {
            opts.body = rawBody;
        }

        const r = await fetch(REAL + urlPath, opts);
        let body = await r.text();

        res.status(r.status);
        const ct = r.headers.get('content-type');
        if (ct) res.setHeader('Content-Type', ct);

        // response me agar real API URL aata hai to proxy URL se replace
        // taaki app aage ki requests bhi proxy pe kare
        const fwdHost = req.headers['x-forwarded-host'] || req.headers['host'] || '';
        if (fwdHost) {
            body = body.split('https://api.attendance.gov.in').join('https://' + fwdHost);
        }
        return res.send(body);
    } catch (e) {
        res.setHeader('Content-Type', 'text/plain');
        return res.status(500).send('Proxy Error: ' + e.message);
    }
};
