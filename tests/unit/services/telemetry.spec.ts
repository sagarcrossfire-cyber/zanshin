// 2.0 M1 — client telemetry in services/errorReport.ts: events follow the
// schema shared with the diag function, carry no keys or long user text,
// wait until Settings decide, dedupe by fingerprint per session, survive
// offline in memory, go by sendBeacon (fetch keepalive as the fallback), and
// the boot self-test runs once per release.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DIAG_URL, SELFTEST_MARKER_KEY, TELEMETRY_PREF_KEY, beaconTransport, configureTelemetry, fingerprintOf, flushTelemetry,
  intelHealthState, queueTelemetry, recordError, resetTelemetryForTests, runBootSelfTest, setBootIdbOpenMs,
  setTelemetryEnabled, siteHostsDiag, telemetryEnabled, telemetryKindFor, telemetryQueueForTests, telemetryText, topFrame, uaClassOf,
} from '../../../src/services/errorReport';
import { DIAG_TEXT_MAX, diagEventSchema, type DiagEvent } from '../../../src/server/diag/schema';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
  };
}

function setup(options: { online?: boolean; storage?: ReturnType<typeof memoryStorage>; result?: boolean } = {}) {
  const sent: DiagEvent[] = [];
  let online = options.online ?? true;
  let result = options.result ?? true;
  const storage = options.storage ?? memoryStorage();
  configureTelemetry({
    online: () => online,
    release: '2.0.0-beta.1',
    route: () => '/today',
    schema: 5,
    storage,
    transport: async (body) => {
      if (!result) return false;
      sent.push(JSON.parse(body) as DiagEvent);
      return true;
    },
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36',
  });
  return {
    sent,
    setOnline: (value: boolean) => { online = value; },
    setResult: (value: boolean) => { result = value; },
    storage,
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  resetTelemetryForTests();
});

afterEach(() => {
  resetTelemetryForTests();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('helpers', () => {
  it('uaClassOf keeps only form factor and browser family', () => {
    expect(uaClassOf('Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36')).toBe('phone-chrome');
    expect(uaClassOf('Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 Version/19.0 Mobile/15E148 Safari/604.1')).toBe('phone-safari');
    expect(uaClassOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36 Edg/141.0')).toBe('desktop-edge');
    expect(uaClassOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0')).toBe('desktop-firefox');
    expect(uaClassOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/19.0 Safari/605.1.15', 5)).toBe('tablet-safari');
    expect(uaClassOf('Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 SamsungBrowser/27.0 Chrome/130.0 Safari/537.36')).toBe('tablet-samsung');
    expect(uaClassOf('')).toBe('desktop-other');
  });

  it('topFrame picks the first positioned frame without query strings', () => {
    expect(topFrame('TypeError: x\n    at go (https://site.test/assets/index-abc.js?v=3:1:200)\n    at b (x.js:2:3)'))
      .toBe('at go (https://site.test/assets/index-abc.js:1:200)');
    expect(topFrame('go@https://site.test/a.js:10:5\n')).toBe('go@https://site.test/a.js:10:5');
    expect(topFrame('no frames here')).toBe('');
    expect(topFrame(undefined)).toBe('');
  });

  it('fingerprintOf is stable 16-hex and changes with its parts', () => {
    const a = fingerprintOf(['error', 'window.error', 'TypeError', 'at go (a.js:1:2)']);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(fingerprintOf(['error', 'window.error', 'TypeError', 'at go (a.js:1:2)'])).toBe(a);
    expect(fingerprintOf(['error', 'route:/today', 'TypeError', 'at go (a.js:1:2)'])).not.toBe(a);
  });

  it('telemetryText redacts keys and long quoted text and stays within 2 KB', () => {
    const text = telemetryText(`Bearer abc.def-123 sk-abcdefghijklmnop api_key=SECRET12345 "${'my private note '.repeat(5)}" 'ok'`);
    expect(text).not.toMatch(/abc\.def-123|sk-abcdefghijklmnop|SECRET12345|private note/);
    expect(text).toContain('"[text]"');
    expect(text).toContain("'ok'");
    expect(telemetryText('x'.repeat(5000)).length).toBeLessThanOrEqual(DIAG_TEXT_MAX);
  });

  it('siteHostsDiag is true on the site only, never on a local server or file://', () => {
    expect(siteHostsDiag({ hostname: 'glistening-conkies-c028b3.netlify.app', protocol: 'https:' })).toBe(true);
    expect(siteHostsDiag({ hostname: 'pr-18--glistening-conkies-c028b3.netlify.app', protocol: 'https:' })).toBe(true);
    for (const hostname of ['localhost', '127.0.0.1', '0.0.0.0', '[::1]', 'app.localhost']) {
      expect(siteHostsDiag({ hostname, protocol: 'http:' })).toBe(false);
    }
    expect(siteHostsDiag({ hostname: '', protocol: 'file:' })).toBe(false);
    expect(siteHostsDiag(undefined)).toBe(false);
  });

  it('on a local server events stay queued instead of posting to a missing function', async () => {
    const beacon = vi.fn(() => true);
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: beacon });
    configureTelemetry({ online: () => true, release: '2.0.0-beta.1', schema: 5, storage: memoryStorage() });
    setTelemetryEnabled(true);
    queueTelemetry('error', 'window.error', new Error('local'));
    await tick();
    expect(beacon).not.toHaveBeenCalled();
    expect(telemetryQueueForTests()).toHaveLength(1);
    Reflect.deleteProperty(navigator, 'sendBeacon');
  });

  it('telemetryKindFor classifies by where and error type', () => {
    const quota = new DOMException('full', 'QuotaExceededError');
    const closed = Object.assign(new Error('closed'), { name: 'DatabaseClosedError' });
    expect(telemetryKindFor('window.error', new Error('x'))).toBe('error');
    expect(telemetryKindFor('window.unhandledrejection', new Error('x'))).toBe('unhandledrejection');
    expect(telemetryKindFor('window.error', quota)).toBe('quota');
    expect(telemetryKindFor('window.error', closed)).toBe('idb');
    expect(telemetryKindFor('migrate.ensureMigratedSafely', new Error('x'))).toBe('idb');
    expect(telemetryKindFor('pwa.registerSW', new Error('x'))).toBe('sw');
    expect(telemetryKindFor('siteAccess.signInAgain', new Error('x'))).toBe('sw');
    expect(telemetryKindFor('intel.research', new Error('x'))).toBe('intel');
    expect(telemetryKindFor('sync.push', new Error('x'))).toBe('sync');
  });
});

describe('the queue', () => {
  it('waits for Settings, then sends schema-valid events with no secrets', async () => {
    const { sent, storage } = setup();
    queueTelemetry('error', 'window.error', new Error('boom with sk-abcdefghijklmnop'), Date.parse('2026-11-01T12:00:00Z'));
    await tick();
    expect(sent).toEqual([]);
    expect(telemetryQueueForTests()).toHaveLength(1);
    setTelemetryEnabled(true);
    await tick();
    expect(sent).toHaveLength(1);
    const [evt] = sent;
    expect(diagEventSchema.safeParse(evt).success).toBe(true);
    expect(evt).toMatchObject({
      at: '2026-11-01T12:00:00.000Z', kind: 'error', online: true, release: '2.0.0-beta.1', route: '/today', schema: 5, uaClass: 'phone-chrome',
    });
    expect(evt?.message).toBe('[window.error] Error: boom with sk-[redacted]');
    expect(JSON.stringify(evt)).not.toContain('sk-abcdefghijklmnop');
    expect(storage.data.get(TELEMETRY_PREF_KEY)).toBe('1');
    expect(telemetryQueueForTests()).toEqual([]);
  });

  it('dedupes by fingerprint within a session', async () => {
    const { sent } = setup();
    setTelemetryEnabled(true);
    const error = new Error('same');
    expect(queueTelemetry('error', 'window.error', error)).toBe(true);
    expect(queueTelemetry('error', 'window.error', error)).toBe(false);
    expect(queueTelemetry('error', 'route:/today', error)).toBe(true);
    await tick();
    expect(sent).toHaveLength(2);
    expect(new Set(sent.map((e) => e.sessionId)).size).toBe(1);
  });

  it('off drops the queue and sends nothing; the choice is mirrored for the next launch', async () => {
    const { sent, storage } = setup();
    queueTelemetry('error', 'window.error', new Error('a'));
    setTelemetryEnabled(false);
    expect(telemetryEnabled()).toBe(false);
    expect(queueTelemetry('error', 'window.error', new Error('b'))).toBe(false);
    await tick();
    expect(sent).toEqual([]);
    expect(telemetryQueueForTests()).toEqual([]);
    expect(storage.data.get(TELEMETRY_PREF_KEY)).toBe('0');

    resetTelemetryForTests();
    setup({ storage });
    expect(telemetryEnabled()).toBe(false);
  });

  it('defaults to on when Settings never load', async () => {
    vi.useFakeTimers();
    const { sent } = setup();
    queueTelemetry('idb', 'bootstrap.load', new Error('OpenFailedError'));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(telemetryEnabled()).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it('keeps events in memory while offline or refused, and sends them when back online', async () => {
    const ctl = setup({ online: false });
    setTelemetryEnabled(true);
    queueTelemetry('error', 'window.error', new Error('offline one'));
    await tick();
    expect(ctl.sent).toEqual([]);
    expect(telemetryQueueForTests()[0]?.online).toBe(false);
    ctl.setOnline(true);
    ctl.setResult(false);
    window.dispatchEvent(new Event('online'));
    await tick();
    expect(ctl.sent).toEqual([]);
    expect(telemetryQueueForTests()).toHaveLength(1);
    ctl.setResult(true);
    await flushTelemetry();
    expect(ctl.sent).toHaveLength(1);
  });

  it('holds at most 20 waiting events and 50 per session', async () => {
    const ctl = setup({ online: false });
    setTelemetryEnabled(true);
    for (let i = 0; i < 30; i += 1) queueTelemetry('error', `where.${i}`, new Error(`e${i}`));
    expect(telemetryQueueForTests()).toHaveLength(20);
    expect(telemetryQueueForTests()[0]?.message).toContain('where.10');
    ctl.setOnline(true);
    await flushTelemetry();
    for (let i = 30; i < 70; i += 1) queueTelemetry('error', `where.${i}`, new Error(`e${i}`));
    await tick();
    expect(ctl.sent).toHaveLength(40);
  });

  it('recordError writes the ring buffer and queues one event', async () => {
    const { sent } = setup();
    setTelemetryEnabled(true);
    recordError('route:/progress', new TypeError('cannot read x'));
    await tick();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'error', message: '[route:/progress] TypeError: cannot read x' });
    expect(sent[0]?.stack).toContain('TypeError');
  });
});

describe('beaconTransport', () => {
  it('uses sendBeacon with a JSON blob', async () => {
    const beacon = vi.fn(() => true);
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: beacon });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect(await beaconTransport('{"a":1}')).toBe(true);
    expect(beacon).toHaveBeenCalledWith(DIAG_URL, expect.any(Blob));
    expect(fetchSpy).not.toHaveBeenCalled();
    Reflect.deleteProperty(navigator, 'sendBeacon');
  });

  it('falls back to fetch keepalive and only retries what could succeed later', async () => {
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: vi.fn(() => false) });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 202 }));
    expect(await beaconTransport('{}')).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(DIAG_URL, expect.objectContaining({ keepalive: true, method: 'POST' }));
    fetchSpy.mockResolvedValue(new Response(null, { status: 400 }));
    expect(await beaconTransport('{}')).toBe(true);
    fetchSpy.mockResolvedValue(new Response(null, { status: 503 }));
    expect(await beaconTransport('{}')).toBe(false);
    fetchSpy.mockResolvedValue(new Response(null, { status: 401 }));
    expect(await beaconTransport('{}')).toBe(false);
    fetchSpy.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await beaconTransport('{}')).toBe(false);
    Reflect.deleteProperty(navigator, 'sendBeacon');
  });
});

describe('boot self-test', () => {
  it('maps the health answer and its failures to a state', async () => {
    const fail = (status: number) => async () => { throw Object.assign(new Error('x'), { status }); };
    expect(await intelHealthState(async () => ({ durableStore: true, keyConfigured: true, ok: true }))).toBe('ok');
    expect(await intelHealthState(async () => ({ keyConfigured: false, ok: true }))).toBe('no-key');
    expect(await intelHealthState(async () => ({ durableStore: false, keyConfigured: true, ok: true }))).toBe('no-blobs');
    expect(await intelHealthState(async () => null)).toBe('missing');
    expect(await intelHealthState(fail(401))).toBe('signed-out');
    expect(await intelHealthState(fail(0))).toBe('offline');
    expect(await intelHealthState(fail(404))).toBe('missing');
    expect(await intelHealthState(fail(504))).toBe('error');
  });

  it('runs once per release with the intel state and IndexedDB open time', async () => {
    const storage = memoryStorage();
    const { sent } = setup({ storage });
    setTelemetryEnabled(true);
    setBootIdbOpenMs(41.6);
    const health = vi.fn(async () => ({ keyConfigured: true, ok: true }));
    expect(await runBootSelfTest({ health, release: '2.0.0-beta.1', storage })).toBe('queued');
    expect(await runBootSelfTest({ health, release: '2.0.0-beta.1', storage })).toBe('skipped');
    await tick();
    expect(health).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      checks: { idbOpenMs: 42, intel: 'ok' }, kind: 'boot-selftest', message: 'Boot self-test 2.0.0-beta.1: intel ok, IndexedDB open 42 ms',
    });
    expect(storage.data.get(SELFTEST_MARKER_KEY)).toBe('2.0.0-beta.1');
    expect(await runBootSelfTest({ health, release: '2.0.0-beta.2', storage })).toBe('queued');
  });

  it('is skipped when telemetry is off and survives storage that throws', async () => {
    setup();
    setTelemetryEnabled(false);
    const health = vi.fn(async () => ({ ok: true }));
    expect(await runBootSelfTest({ health, release: '2.0.0-beta.1' })).toBe('skipped');
    expect(health).not.toHaveBeenCalled();

    resetTelemetryForTests();
    const { sent } = setup();
    setTelemetryEnabled(true);
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(await runBootSelfTest({ health, release: '2.0.0-beta.1', storage: broken })).toBe('queued');
    await tick();
    expect(sent[0]?.checks).toEqual({ intel: 'no-key' });
  });
});
