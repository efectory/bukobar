const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');

// eWeLink modul (V7.24) — re-exportuje ewelink* funkce
Object.assign(exports, require('./ewelink'));

const LOXONE_URL = defineSecret('LOXONE_URL');
const LOXONE_USER = defineSecret('LOXONE_USER');
const LOXONE_PASS = defineSecret('LOXONE_PASS');
const LOXONE_SENSOR = defineSecret('LOXONE_SENSOR'); // čidlo teploty piva (Tank 2)
const LOXONE_TEMP2 = defineSecret('LOXONE_TEMP2');   // čidlo teploty chladáku (V7.47)
const LOXONE_SWITCH = defineSecret('LOXONE_SWITCH');  // vypínač chlazení chladák (V7.47)

// Společné volání Loxone HTTP API: GET /dev/sps/io/<cmd> s Basic auth.
// Vrací { valueStr } z odpovědi LL (JSON i XML), nebo hodí chybu.
async function loxoneCall(baseUrl, user, pass, cmd) {
  const endpoint = `${baseUrl}/dev/sps/io/${cmd}`;
  const auth = Buffer.from(`${user}:${pass}`).toString('base64');

  const res = await fetch(endpoint, {
    headers: { 'Authorization': `Basic ${auth}` },
    signal: AbortSignal.timeout(10000)
  });

  if (!res.ok) {
    throw new Error(`Loxone HTTP ${res.status} ${res.statusText}`);
  }

  const text = await res.text();
  const ct = res.headers.get('content-type') || '';
  console.log('[loxone] cmd=' + cmd + ' status=' + res.status + ' content-type=' + ct + ' body[0..200]=' + text.slice(0, 200));

  // Loxone vrací buď JSON: {"LL":{"value":"4.9","Code":"200"}}
  // nebo XML: <LL control="..." value="4.9°" Code="200"/>
  let valueStr, codeStr;
  const isXml = ct.includes('xml') || text.trimStart().startsWith('<');
  if (isXml) {
    const codeMatch = text.match(/\bCode="(\d+)"/i);
    codeStr = codeMatch ? codeMatch[1] : null;
    const valueMatch = text.match(/\bvalue="([^"]*)"/i);
    valueStr = valueMatch ? valueMatch[1] : null;
  } else {
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error('Cannot parse Loxone response (content-type=' + ct + '): ' + text.slice(0, 200));
    }
    valueStr = data && data.LL && (data.LL.value !== undefined ? data.LL.value : data.LL.Value);
    codeStr = data && data.LL && (data.LL.Code !== undefined ? data.LL.Code : data.LL.code);
  }

  if (codeStr && String(codeStr) !== '200') {
    throw new Error('Loxone Code=' + codeStr + ': ' + text.slice(0, 200));
  }

  return { valueStr, codeStr };
}

// Přečte teplotu (°C) z čidla daného UUID.
async function fetchLoxoneTemp(baseUrl, user, pass, sensor) {
  const { valueStr } = await loxoneCall(baseUrl, user, pass, encodeURIComponent(sensor));

  if (valueStr === undefined || valueStr === null || valueStr === '') {
    throw new Error('No value in Loxone response');
  }

  const normalized = String(valueStr).replace(',', '.').replace(/[^\d.-]/g, '');
  const temperature = parseFloat(normalized);

  if (isNaN(temperature)) {
    throw new Error('Cannot parse temperature: ' + valueStr);
  }

  return temperature;
}

// Teplota piva (Tank 2) — V7.17
exports.getLoxoneTemp = onCall({
  region: 'europe-west1',
  secrets: [LOXONE_URL, LOXONE_USER, LOXONE_PASS, LOXONE_SENSOR],
  timeoutSeconds: 15,
  memory: '256MiB',
  maxInstances: 5
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Login required');
  }

  const baseUrl = LOXONE_URL.value().replace(/\/$/, '');
  const user = LOXONE_USER.value();
  const pass = LOXONE_PASS.value();
  const sensor = LOXONE_SENSOR.value();

  if (!baseUrl || !user || !pass || !sensor) {
    throw new HttpsError('failed-precondition', 'Loxone config missing');
  }

  try {
    const temperature = await fetchLoxoneTemp(baseUrl, user, pass, sensor);
    return {
      temperature: temperature,
      timestamp: new Date().toISOString(),
      online: true,
      sensor: sensor
    };
  } catch (e) {
    console.error('[loxone] fetch failed:', e.message || e);
    return {
      temperature: null,
      timestamp: new Date().toISOString(),
      online: false,
      error: e.message || String(e)
    };
  }
});

// Teplota chladáku — V7.47
exports.getLoxoneTemp2 = onCall({
  region: 'europe-west1',
  secrets: [LOXONE_URL, LOXONE_USER, LOXONE_PASS, LOXONE_TEMP2],
  timeoutSeconds: 15,
  memory: '256MiB',
  maxInstances: 5
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Login required');
  }

  const baseUrl = LOXONE_URL.value().replace(/\/$/, '');
  const user = LOXONE_USER.value();
  const pass = LOXONE_PASS.value();
  const sensor = LOXONE_TEMP2.value();

  if (!baseUrl || !user || !pass || !sensor) {
    throw new HttpsError('failed-precondition', 'Loxone temp2 config missing');
  }

  try {
    const temperature = await fetchLoxoneTemp(baseUrl, user, pass, sensor);
    return {
      temperature: temperature,
      timestamp: new Date().toISOString(),
      online: true,
      sensor: sensor
    };
  } catch (e) {
    console.error('[loxone/temp2] fetch failed:', e.message || e);
    return {
      temperature: null,
      timestamp: new Date().toISOString(),
      online: false,
      error: e.message || String(e)
    };
  }
});

// Vypínač chlazení chladák — V7.47.
// data.action: 'status' (default) | 'on' | 'off'. Vrací { state: 'on'|'off' }.
exports.loxoneSwitch = onCall({
  region: 'europe-west1',
  secrets: [LOXONE_URL, LOXONE_USER, LOXONE_PASS, LOXONE_SWITCH],
  timeoutSeconds: 15,
  memory: '256MiB',
  maxInstances: 5
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Login required');
  }

  const baseUrl = LOXONE_URL.value().replace(/\/$/, '');
  const user = LOXONE_USER.value();
  const pass = LOXONE_PASS.value();
  const uuid = LOXONE_SWITCH.value();

  if (!baseUrl || !user || !pass || !uuid) {
    throw new HttpsError('failed-precondition', 'Loxone switch config missing');
  }

  const action = (request.data && request.data.action) || 'status';
  let cmd = encodeURIComponent(uuid);
  if (action === 'on') cmd += '/on';
  else if (action === 'off') cmd += '/off';
  // 'status' = holý UUID (přečte aktuální hodnotu)

  try {
    const { valueStr } = await loxoneCall(baseUrl, user, pass, cmd);
    // Loxone u on/off vrací nastavený stav, u čtení aktuální hodnotu (0/1).
    const num = parseFloat(String(valueStr).replace(',', '.').replace(/[^\d.-]/g, ''));
    const state = (!isNaN(num) && num >= 0.5) ? 'on' : 'off';
    return {
      state: state,
      raw: valueStr,
      action: action,
      online: true,
      timestamp: new Date().toISOString()
    };
  } catch (e) {
    console.error('[loxone/switch] failed:', e.message || e);
    return {
      state: null,
      action: action,
      online: false,
      error: e.message || String(e),
      timestamp: new Date().toISOString()
    };
  }
});
