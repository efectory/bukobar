// eWeLink Cloud API integrace (V7.24)
// OAuth2 v2 flow + toggle/status zásuvky.
// Secrets: EWELINK_APP_ID, EWELINK_APP_SECRET, EWELINK_REGION (eu/us/as/cn).
// Firestore dokument: config/ewelink (tokens, deviceId, label, icon, enabled).

const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const { getFirestore } = require('firebase-admin/firestore');
const { initializeApp, getApps } = require('firebase-admin/app');
const crypto = require('crypto');

if (getApps().length === 0) initializeApp();
const db = getFirestore();

const EWELINK_APP_ID     = defineSecret('EWELINK_APP_ID');
const EWELINK_APP_SECRET = defineSecret('EWELINK_APP_SECRET');
const EWELINK_REGION     = defineSecret('EWELINK_REGION');

const CONFIG_PATH = 'config/ewelink';
const STATE_TTL_MS = 10 * 60 * 1000; // 10 min — OAuth state expiry

const REGION_ENDPOINTS = {
  eu: 'https://eu-apia.coolkit.cc',
  us: 'https://us-apia.coolkit.cc',
  as: 'https://as-apia.coolkit.cc',
  cn: 'https://cn-apia.coolkit.cn'
};

const COMMON = {
  region: 'europe-west1',
  timeoutSeconds: 15,
  memory: '256MiB',
  maxInstances: 5
};

const hmacBase64 = (msg, secret) => crypto.createHmac('sha256', secret).update(msg).digest('base64');
const makeNonce  = (len = 8) => crypto.randomBytes(Math.ceil(len / 2)).toString('hex').slice(0, len);
const endpointFor = (region) => REGION_ENDPOINTS[region] || REGION_ENDPOINTS.eu;
const cfRedirect  = () => `https://europe-west1-${process.env.GCLOUD_PROJECT}.cloudfunctions.net/ewelinkOAuthCallback`;

const loadCfg = async () => {
  const snap = await db.doc(CONFIG_PATH).get();
  return snap.exists ? snap.data() : {};
};
const saveCfg = (patch) => db.doc(CONFIG_PATH).set(patch, { merge: true });

async function ewelinkApiPost(path, body, accessToken, appId) {
  const json = typeof body === 'string' ? body : JSON.stringify(body);
  const r = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CK-Appid': appId,
      'X-CK-Nonce': makeNonce(8),
      'Authorization': `Bearer ${accessToken}`
    },
    body: json,
    signal: AbortSignal.timeout(10000)
  });
  return r.json();
}

async function ewelinkApiGet(url, accessToken, appId) {
  const r = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-CK-Appid': appId,
      'X-CK-Nonce': makeNonce(8),
      'Authorization': `Bearer ${accessToken}`
    },
    signal: AbortSignal.timeout(10000)
  });
  return r.json();
}

async function ensureValidToken(appId, appSecret) {
  const cfg = await loadCfg();
  if (!cfg.accessToken) {
    throw new HttpsError('failed-precondition', 'eWeLink není autorizován. Otevři Administraci → eWeLink a klikni Autorizovat.');
  }
  const now = Date.now();
  if (cfg.atExpiresAt && cfg.atExpiresAt - now > 3600 * 1000) {
    return { accessToken: cfg.accessToken, region: cfg.region || 'eu' };
  }
  if (!cfg.refreshToken) {
    throw new HttpsError('failed-precondition', 'eWeLink refresh token chybí — znovu autorizovat.');
  }
  if (cfg.rtExpiresAt && cfg.rtExpiresAt < now) {
    throw new HttpsError('failed-precondition', 'eWeLink refresh token expiroval — znovu autorizovat.');
  }
  const ep = endpointFor(cfg.region || 'eu');
  const body = JSON.stringify({ rt: cfg.refreshToken });
  const signature = hmacBase64(body, appSecret);
  const r = await fetch(`${ep}/v2/user/refresh`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CK-Appid': appId,
      'X-CK-Nonce': makeNonce(8),
      'Authorization': `Sign ${signature}`
    },
    body,
    signal: AbortSignal.timeout(10000)
  });
  const data = await r.json();
  if (data.error !== 0) {
    throw new HttpsError('internal', 'Refresh tokenu selhal: ' + JSON.stringify(data));
  }
  const tok = data.data || {};
  await saveCfg({
    accessToken: tok.at,
    refreshToken: tok.rt || cfg.refreshToken,
    atExpiresAt: tok.atExpiredTime || (now + 30 * 24 * 3600 * 1000),
    rtExpiresAt: tok.rtExpiredTime || cfg.rtExpiresAt,
    lastRefreshAt: now
  });
  return { accessToken: tok.at, region: cfg.region || 'eu' };
}

async function readDeviceState(deviceId, appId, appSecret) {
  const { accessToken, region } = await ensureValidToken(appId, appSecret);
  const ep = endpointFor(region);
  const url = `${ep}/v2/device/thing/status?type=1&id=${encodeURIComponent(deviceId)}&params=switch`;
  const data = await ewelinkApiGet(url, accessToken, appId);
  if (data.error !== 0) {
    throw new HttpsError('internal', 'eWeLink status error: ' + JSON.stringify(data));
  }
  const sw = data.data && data.data.params && data.data.params.switch;
  return { state: sw, raw: data.data };
}

async function writeDeviceState(deviceId, targetState, appId, appSecret) {
  const { accessToken, region } = await ensureValidToken(appId, appSecret);
  const ep = endpointFor(region);
  const data = await ewelinkApiPost(
    `${ep}/v2/device/thing/status`,
    { type: 1, id: deviceId, params: { switch: targetState } },
    accessToken,
    appId
  );
  if (data.error !== 0) {
    throw new HttpsError('internal', 'eWeLink toggle error: ' + JSON.stringify(data));
  }
  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1) OAuth Prepare — vrací login URL (volá admin UI po kliku „Autorizovat")
// ─────────────────────────────────────────────────────────────────────────────
exports.ewelinkOAuthPrepare = onCall({
  ...COMMON,
  secrets: [EWELINK_APP_ID, EWELINK_APP_SECRET, EWELINK_REGION]
}, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Login required');

  // TRIM whitespace/newline — PowerShell pipe často přidá \r\n (viz Loxone V7.17 incident)
  const appId = (EWELINK_APP_ID.value() || '').trim();
  const appSecret = (EWELINK_APP_SECRET.value() || '').trim();
  if (!appId || !appSecret) {
    throw new HttpsError('failed-precondition', 'EWELINK_APP_ID / EWELINK_APP_SECRET secrets nejsou nastavené.');
  }

  const seq = String(Date.now());
  const nonce = makeNonce(8);
  const state = makeNonce(32);
  const redirect = cfRedirect();

  await saveCfg({
    oauthState: state,
    oauthStartedAt: Date.now(),
    oauthInitiatedBy: request.auth.token.email || null
  });

  // Per eWeLink V2 docs: Message = `{clientId}_{seq}`, Key = clientSecret, HMAC-SHA256 → Base64
  const signMsg = `${appId}_${seq}`;
  const signature = hmacBase64(signMsg, appSecret);

  // DIAGNOSTIKA — otisky pro debug, aniž bychom prozradili secret samotný
  // Délka + sha256 hash secretu (= deterministický fingerprint, ne reverzibilní)
  const appSecretHash = crypto.createHash('sha256').update(appSecret).digest('hex').slice(0, 12);
  const appIdHash     = crypto.createHash('sha256').update(appId).digest('hex').slice(0, 12);
  console.log('[ewelink/prepare] appId="' + appId + '" len=' + appId.length + ' hash=' + appIdHash);
  console.log('[ewelink/prepare] appSecret len=' + appSecret.length + ' hash=' + appSecretHash);
  console.log('[ewelink/prepare] signMsg="' + signMsg + '"');
  console.log('[ewelink/prepare] signature="' + signature + '" len=' + signature.length);

  const params = new URLSearchParams({
    clientId: appId,
    seq,
    authorization: signature,
    redirectUrl: redirect,
    grantType: 'authorization_code',
    state,
    nonce,
    showQRCode: 'false'
  });

  const loginUrl = `https://c2ccdn.coolkit.cc/oauth/index.html?${params.toString()}`;
  console.log('[ewelink/prepare] loginUrl=' + loginUrl);

  return {
    loginUrl: loginUrl,
    redirectUri: redirect,
    debug: {
      appIdLength: appId.length,
      appSecretLength: appSecret.length,
      seq: seq,
      signMsg: signMsg,
      signature: signature
    }
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// 2) OAuth Callback — eWeLink sem přesměruje po loginu s ?code=...&region=...
// ─────────────────────────────────────────────────────────────────────────────
exports.ewelinkOAuthCallback = onRequest({
  ...COMMON,
  secrets: [EWELINK_APP_ID, EWELINK_APP_SECRET, EWELINK_REGION],
  cors: false
}, async (req, res) => {
  const code   = req.query.code;
  const state  = req.query.state;
  const region = req.query.region || EWELINK_REGION.value() || 'eu';

  const fail = (msg) => {
    res.status(400).type('text/html; charset=utf-8').send(`
      <!DOCTYPE html><html><head><meta charset="utf-8"><title>Chyba</title>
      <style>body{font-family:sans-serif;background:#fef2f2;padding:2rem;}
      .box{max-width:520px;margin:2rem auto;background:#fff;padding:2rem;border-radius:12px;border:1px solid #fecaca;}
      h1{color:#a4101b;margin-top:0;}pre{background:#f3f4f6;padding:.8rem;border-radius:6px;font-size:12px;white-space:pre-wrap;}</style>
      </head><body><div class="box"><h1>❌ Autorizace selhala</h1><pre>${String(msg).replace(/</g,'&lt;')}</pre>
      <p>Zavři toto okno a zkus to znovu v Administraci.</p></div></body></html>`);
  };

  if (!code) return fail('Chybí parametr ?code v callbacku.');

  const cfg = await loadCfg();
  if (!cfg.oauthState || cfg.oauthState !== state) {
    return fail('Neplatný state (CSRF) — zkus autorizaci spustit znovu z Administrace.');
  }
  if (cfg.oauthStartedAt && Date.now() - cfg.oauthStartedAt > STATE_TTL_MS) {
    return fail('OAuth state expiroval (10 min). Spusť znovu.');
  }

  const appId = (EWELINK_APP_ID.value() || '').trim();
  const appSecret = (EWELINK_APP_SECRET.value() || '').trim();
  const ep = endpointFor(region);

  const body = JSON.stringify({
    code,
    redirectUrl: cfRedirect(),
    grantType: 'authorization_code'
  });
  const signature = hmacBase64(body, appSecret);

  console.log('[ewelink/callback] region=' + region + ' endpoint=' + ep);
  console.log('[ewelink/callback] code=' + code + ' state=' + state);
  console.log('[ewelink/callback] appId len=' + appId.length + ' secret len=' + appSecret.length);
  console.log('[ewelink/callback] body=' + body);
  console.log('[ewelink/callback] signature=' + signature);

  try {
    const r = await fetch(`${ep}/v2/user/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CK-Appid': appId,
        'X-CK-Nonce': makeNonce(8),
        'Authorization': `Sign ${signature}`
      },
      body,
      signal: AbortSignal.timeout(10000)
    });
    const rawText = await r.text();
    console.log('[ewelink/callback] HTTP ' + r.status + ' raw=' + rawText.slice(0, 800));

    let data;
    try { data = JSON.parse(rawText); }
    catch (e) { throw new Error('Non-JSON response (HTTP ' + r.status + '): ' + rawText.slice(0, 300)); }

    if (data.error !== 0 && data.error !== undefined) {
      throw new Error('eWeLink error ' + data.error + ': ' + (data.msg || JSON.stringify(data)));
    }
    // Tolerantní parsing — eWeLink může vrátit tokeny pod různými klíči (at/accessToken, rt/refreshToken)
    const tok = data.data || data || {};
    const accessToken  = tok.at  || tok.accessToken  || tok.access_token  || null;
    const refreshToken = tok.rt  || tok.refreshToken || tok.refresh_token || null;
    const atExpiresAt  = tok.atExpiredTime || tok.atExpire || tok.accessTokenExpiredTime || null;
    const rtExpiresAt  = tok.rtExpiredTime || tok.rtExpire || tok.refreshTokenExpiredTime || null;
    const tokRegion    = tok.region || data.region || region;
    const userInfo     = tok.user || tok.userInfo || data.user || null;

    console.log('[ewelink/callback] parsed accessToken=' + (accessToken ? '[' + accessToken.length + ' chars]' : 'NULL'));
    console.log('[ewelink/callback] parsed refreshToken=' + (refreshToken ? '[' + refreshToken.length + ' chars]' : 'NULL'));
    console.log('[ewelink/callback] atExpiresAt=' + atExpiresAt + ' rtExpiresAt=' + rtExpiresAt + ' region=' + tokRegion);

    if (!accessToken) {
      throw new Error('Token v odpovědi chybí. Plná odpověď: ' + rawText.slice(0, 500));
    }

    await saveCfg({
      accessToken,
      refreshToken: refreshToken || null,
      atExpiresAt,
      rtExpiresAt,
      region: tokRegion,
      userInfo,
      authorizedAt: Date.now(),
      oauthState: null,
      oauthStartedAt: null
    });
    const expStr = atExpiresAt ? new Date(atExpiresAt).toLocaleString('cs-CZ') : '?';
    res.status(200).type('text/html; charset=utf-8').send(`
      <!DOCTYPE html><html><head><meta charset="utf-8"><title>Hotovo</title>
      <style>body{font-family:sans-serif;background:#f0fdf4;padding:2rem;}
      .box{max-width:520px;margin:2rem auto;background:#fff;padding:2.5rem;border-radius:12px;border:1px solid #bbf7d0;text-align:center;}
      h1{color:#15803d;margin-top:0;}p{color:#475569;font-size:14px;}
      button{margin-top:1.4rem;padding:10px 26px;background:#1e293b;color:#fff;border:none;border-radius:6px;font-size:14px;cursor:pointer;}</style>
      </head><body><div class="box"><h1>✓ Autorizováno</h1>
      <p>eWeLink účet byl propojen.</p>
      <p>Region: <strong>${tokRegion}</strong></p>
      <p>Token expiruje: <strong>${expStr}</strong></p>
      <button onclick="window.close()">Zavřít okno</button>
      </div></body></html>`);
  } catch (e) {
    console.error('[ewelink/callback] token exchange failed:', e);
    return fail('Výměna code za token selhala:\n' + (e.message || String(e)));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3) Scheduled refresh — denně 04:00 Europe/Prague
// ─────────────────────────────────────────────────────────────────────────────
exports.ewelinkRefreshScheduled = onSchedule({
  schedule: '0 4 * * *',
  timeZone: 'Europe/Prague',
  region: 'europe-west1',
  secrets: [EWELINK_APP_ID, EWELINK_APP_SECRET],
  retryCount: 1
}, async () => {
  try {
    const cfg = await loadCfg();
    if (!cfg.accessToken) {
      console.log('[ewelink/refresh] no token, skip');
      return;
    }
    // Force refresh by simulating "soon to expire"
    const fakeCfg = { ...cfg, atExpiresAt: Date.now() + 60_000 };
    await db.doc(CONFIG_PATH).set(fakeCfg);
    await ensureValidToken(EWELINK_APP_ID.value(), EWELINK_APP_SECRET.value());
    console.log('[ewelink/refresh] success');
  } catch (e) {
    console.error('[ewelink/refresh] failed:', e);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 4) Toggle device — onCall, vstup { state: 'on'|'off'|'toggle' }
// ─────────────────────────────────────────────────────────────────────────────
exports.ewelinkToggle = onCall({
  ...COMMON,
  secrets: [EWELINK_APP_ID, EWELINK_APP_SECRET]
}, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Login required');

  const appId = EWELINK_APP_ID.value();
  const appSecret = EWELINK_APP_SECRET.value();
  const cfg = await loadCfg();
  if (!cfg.deviceId) {
    throw new HttpsError('failed-precondition', 'Device ID není nastaveno v Administraci.');
  }

  let target = request.data && request.data.state;
  if (target === 'toggle' || !target) {
    const cur = await readDeviceState(cfg.deviceId, appId, appSecret);
    target = cur.state === 'on' ? 'off' : 'on';
  }
  if (target !== 'on' && target !== 'off') {
    throw new HttpsError('invalid-argument', 'state musí být "on", "off" nebo "toggle"');
  }

  await writeDeviceState(cfg.deviceId, target, appId, appSecret);
  return { state: target, timestamp: new Date().toISOString() };
});

// ─────────────────────────────────────────────────────────────────────────────
// 5) Status — onCall, vrací aktuální stav zařízení + config
// ─────────────────────────────────────────────────────────────────────────────
exports.ewelinkStatus = onCall({
  ...COMMON,
  secrets: [EWELINK_APP_ID, EWELINK_APP_SECRET]
}, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Login required');

  const cfg = await loadCfg();
  const base = {
    configured: !!cfg.deviceId,
    authorized: !!cfg.accessToken,
    enabled: !!cfg.enabled,
    alarmWhenOff: !!cfg.alarmWhenOff,
    label: cfg.label || null,
    icon: cfg.icon || '💡',
    deviceId: cfg.deviceId || null
  };

  if (!base.configured || !base.authorized) return base;

  try {
    const result = await readDeviceState(cfg.deviceId, EWELINK_APP_ID.value(), EWELINK_APP_SECRET.value());
    return { ...base, state: result.state, atExpiresAt: cfg.atExpiresAt || null, timestamp: new Date().toISOString() };
  } catch (e) {
    return { ...base, state: null, error: e.message || String(e), timestamp: new Date().toISOString() };
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 6) Auth state — admin UI: vrací jen meta o autorizaci a config (bez tokenu)
// ─────────────────────────────────────────────────────────────────────────────
exports.ewelinkAuthState = onCall({
  ...COMMON
}, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Login required');
  const cfg = await loadCfg();
  return {
    authorized: !!cfg.accessToken,
    atExpiresAt: cfg.atExpiresAt || null,
    rtExpiresAt: cfg.rtExpiresAt || null,
    region: cfg.region || null,
    authorizedAt: cfg.authorizedAt || null,
    accountInfo: cfg.userInfo ? { email: cfg.userInfo.email || null, phoneNumber: cfg.userInfo.phoneNumber || null } : null,
    device: {
      deviceId: cfg.deviceId || '',
      label: cfg.label || '',
      icon: cfg.icon || '💡',
      enabled: !!cfg.enabled,
      alarmWhenOff: !!cfg.alarmWhenOff
    }
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// 7) Set config — uložení deviceId / label / icon / enabled z admin UI
// ─────────────────────────────────────────────────────────────────────────────
exports.ewelinkSetConfig = onCall({
  ...COMMON
}, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Login required');
  const d = request.data || {};
  await saveCfg({
    deviceId:     String(d.deviceId || '').trim(),
    label:        String(d.label    || '').trim(),
    icon:         String(d.icon     || '💡'),
    enabled:      !!d.enabled,
    alarmWhenOff: !!d.alarmWhenOff
  });
  return { ok: true };
});

// ─────────────────────────────────────────────────────────────────────────────
// 8) Device list — pomocný endpoint pro admin (zjistit deviceId v účtu)
// ─────────────────────────────────────────────────────────────────────────────
exports.ewelinkDevices = onCall({
  ...COMMON,
  secrets: [EWELINK_APP_ID, EWELINK_APP_SECRET]
}, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Login required');
  const appId = EWELINK_APP_ID.value();
  const appSecret = EWELINK_APP_SECRET.value();
  const { accessToken, region } = await ensureValidToken(appId, appSecret);
  const ep = endpointFor(region);
  const r = await fetch(`${ep}/v2/device/thing?num=30`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-CK-Appid': appId,
      'X-CK-Nonce': makeNonce(8),
      'Authorization': `Bearer ${accessToken}`
    },
    signal: AbortSignal.timeout(10000)
  });
  const data = await r.json();
  if (data.error !== 0) {
    throw new HttpsError('internal', 'eWeLink devices error: ' + JSON.stringify(data));
  }
  const list = (data.data && data.data.thingList) || [];
  return {
    devices: list.map(t => ({
      itemType: t.itemType,
      deviceid: t.itemData && t.itemData.deviceid,
      name: t.itemData && t.itemData.name,
      productModel: t.itemData && t.itemData.productModel,
      online: t.itemData && t.itemData.online,
      switch: t.itemData && t.itemData.params && t.itemData.params.switch
    }))
  };
});
