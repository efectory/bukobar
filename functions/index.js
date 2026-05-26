const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');

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

    const data = await res.json();
    const valueStr = data && data.LL && (data.LL.value !== undefined ? data.LL.value : data.LL.Value);

    if (valueStr === undefined || valueStr === null) {
      throw new Error('Invalid Loxone response: ' + JSON.stringify(data).slice(0, 200));
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
