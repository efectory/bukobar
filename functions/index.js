const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');

// eWeLink modul (V7.24) — re-exportuje ewelink* funkce
Object.assign(exports, require('./ewelink'));

const LOXONE_URL = defineSecret('LOXONE_URL');
const LOXONE_USER = defineSecret('LOXONE_USER');
const LOXONE_PASS = defineSecret('LOXONE_PASS');
const LOXONE_SENSOR = defineSecret('LOXONE_SENSOR');

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

  const endpoint = `${baseUrl}/dev/sps/io/${encodeURIComponent(sensor)}`;
  const auth = Buffer.from(`${user}:${pass}`).toString('base64');

  try {
    const res = await fetch(endpoint, {
      headers: { 'Authorization': `Basic ${auth}` },
      signal: AbortSignal.timeout(10000)
    });

    if (!res.ok) {
      throw new Error(`Loxone HTTP ${res.status} ${res.statusText}`);
    }

    const text = await res.text();
    const ct = res.headers.get('content-type') || '';
    console.log('[loxone] status=' + res.status + ' content-type=' + ct + ' body[0..200]=' + text.slice(0, 200));

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

    if (valueStr === undefined || valueStr === null || valueStr === '') {
      throw new Error('No value in Loxone response: ' + text.slice(0, 200));
    }

    const normalized = String(valueStr).replace(',', '.').replace(/[^\d.-]/g, '');
    const temperature = parseFloat(normalized);

    if (isNaN(temperature)) {
      throw new Error('Cannot parse temperature: ' + valueStr);
    }

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
