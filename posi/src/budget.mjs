// Dedicated POSI staging state: one aggregate daily counter, no chat or PII.
// This namespace must never be shared with order/customer storage.
const KEY = 'daily-budget-v1';
const OBJECT_NAME = 'posi-ai-daily-v1';
const RESERVE_URL = 'https://posi-budget.internal/reserve';
const MAX_DAILY = 100;

function dailyLimit(value) {
  if (value === undefined) return MAX_DAILY;
  if (typeof value === 'string' && /^[1-9]\d{0,8}$/.test(value)) value = Number(value);
  return Number.isSafeInteger(value) && value > 0 ? Math.min(MAX_DAILY, value) : 0;
}
function json(allowed, status) {
  return new Response(JSON.stringify({ allowed }), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  } });
}
function validRecord(value) {
  const day = typeof value?.day === 'string' ? Date.parse(value.day + 'T00:00:00.000Z') : NaN;
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === 'day,used' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.day) &&
    Number.isFinite(day) && new Date(day).toISOString().slice(0, 10) === value.day &&
    Number.isSafeInteger(value.used) && value.used >= 0 && value.used <= MAX_DAILY;
}

export class PosiAiBudget {
  constructor(state, env = {}, { now = Date.now } = {}) {
    this.storage = state.storage;
    this.limit = dailyLimit(env.POSI_AI_DAILY_LIMIT);
    this.now = now;
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.href !== RESERVE_URL) return json(false, 404);
    if (request.method !== 'POST') return json(false, 405);
    // Caller cannot supply a date, count, limit, user identifier or reset flag.
    if (request.body !== null) return json(false, 400);
    if (!this.limit || !this.storage?.transaction) return json(false, 503);
    try {
      const allowed = await this.storage.transaction(async txn => {
        const day = new Date(this.now()).toISOString().slice(0, 10);
        const previous = await txn.get(KEY);
        if (previous !== undefined && !validRecord(previous)) throw Error('Invalid budget state');
        // Do not reopen a used budget if the server clock ever moves backwards.
        if (previous && previous.day > day) return false;
        const used = previous?.day === day ? previous.used : 0;
        if (used >= this.limit) return false;
        await txn.put(KEY, { day, used: used + 1 });
        return true;
      });
      return json(allowed, allowed ? 200 : 429);
    } catch {
      // An ambiguous reservation consumes its slot; never retry or refund.
      return json(false, 503);
    }
  }
}

export async function reserveAiBudget(env, { timeoutMs = 1000 } = {}) {
  const namespace = env?.POSI_AI_BUDGET;
  if (!namespace?.idFromName || !namespace?.get) return false;
  let timer;
  try {
    const wait = Number.isSafeInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 1000 ? timeoutMs : 1000;
    return await Promise.race([
      Promise.resolve().then(async () => {
        const id = namespace.idFromName(OBJECT_NAME);
        const response = await namespace.get(id).fetch(new Request(RESERVE_URL, { method: 'POST' }));
        if (response.status !== 200) return false;
        const text = await response.text();
        if (text.length > 128) return false;
        const result = JSON.parse(text);
        return Boolean(result && typeof result === 'object' && !Array.isArray(result) &&
          Object.keys(result).join(',') === 'allowed' && result.allowed === true);
      }),
      new Promise(resolve => { timer = setTimeout(() => resolve(false), wait); }),
    ]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
