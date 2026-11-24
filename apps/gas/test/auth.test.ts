import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CACHE_MAX_SEC, makeVerifiers } from '../src/gas/auth';

const CHANNEL = '1234567890';

interface Res {
  code: number;
  body: string;
}

/** UrlFetchApp・CacheService・Utilities を差し替える。routes は URL の先頭で返事を選ぶ */
function stubGas(routes: Record<string, Res | (() => Res)>) {
  const store = new Map<string, { value: string; ttl: number }>();
  const calls: string[] = [];
  vi.stubGlobal('CacheService', {
    getScriptCache: () => ({
      get: (k: string) => store.get(k)?.value ?? null,
      put: (k: string, value: string, ttl: number) => store.set(k, { value, ttl }),
    }),
  });
  vi.stubGlobal('Utilities', {
    DigestAlgorithm: { SHA_256: 'sha256' },
    Charset: { UTF_8: 'utf8' },
    computeDigest: (_a: string, s: string) => Array.from(s).map((c) => c.charCodeAt(0) % 128),
  });
  vi.stubGlobal('UrlFetchApp', {
    fetch: (url: string) => {
      calls.push(url);
      const hit = Object.keys(routes).find((p) => url.startsWith(p));
      if (!hit) throw new Error(`unexpected ${url}`);
      const r = routes[hit];
      const res = typeof r === 'function' ? r() : r;
      return { getResponseCode: () => res.code, getContentText: () => res.body };
    },
  });
  return { store, calls };
}

const VERIFY = 'https://api.line.me/oauth2/v2.1/verify?access_token=';
const PROFILE = 'https://api.line.me/v2/profile';
const ok = (o: unknown): Res => ({ code: 200, body: JSON.stringify(o) });

const verifiers = () => makeVerifiers({ relaySecret: '', loginChannelId: CHANNEL });

describe('アクセストークンの確認', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('このチャネルの有効なトークンなら、プロフィールの本人を返して覚える', () => {
    const { store } = stubGas({ [VERIFY]: ok({ client_id: CHANNEL, expires_in: 2592000 }), [PROFILE]: ok({ userId: 'U1', displayName: 'あ' }) });
    expect(verifiers().accessToken('tok')).toEqual({ userId: 'U1', name: 'あ' });
    // 覚えるのは長くても15分
    expect(CACHE_MAX_SEC).toBe(900);
    expect([...store.values()][0].ttl).toBe(CACHE_MAX_SEC);
  });

  it('覚えている間は LINE に問い合わせない', () => {
    const { calls } = stubGas({ [VERIFY]: ok({ client_id: CHANNEL, expires_in: 100 }), [PROFILE]: ok({ userId: 'U1' }) });
    const v = verifiers();
    v.accessToken('tok');
    v.accessToken('tok');
    expect(calls).toHaveLength(2);
  });

  it('ほかのチャネルのトークンは通さない', () => {
    stubGas({ [VERIFY]: ok({ client_id: '999', expires_in: 100 }), [PROFILE]: ok({ userId: 'U1' }) });
    expect(verifiers().accessToken('tok')).toBeNull();
  });

  it('期限が切れたトークンは通さない', () => {
    stubGas({ [VERIFY]: { code: 400, body: '{"error":"invalid_request"}' }, [PROFILE]: ok({ userId: 'U1' }) });
    expect(verifiers().accessToken('tok')).toBeNull();
    stubGas({ [VERIFY]: ok({ client_id: CHANNEL, expires_in: 0 }), [PROFILE]: ok({ userId: 'U1' }) });
    expect(verifiers().accessToken('tok')).toBeNull();
  });

  it('プロフィールが取れなければ通さない', () => {
    stubGas({ [VERIFY]: ok({ client_id: CHANNEL, expires_in: 100 }), [PROFILE]: { code: 401, body: '{}' } });
    expect(verifiers().accessToken('tok')).toBeNull();
  });

  it('通信の失敗や JSON 以外の返事でも例外にせず null を返す', () => {
    stubGas({
      [VERIFY]: () => {
        throw new Error('Address unavailable');
      },
    });
    expect(verifiers().accessToken('tok')).toBeNull();
    stubGas({ [VERIFY]: { code: 200, body: '<html>maintenance</html>' } });
    expect(verifiers().accessToken('tok')).toBeNull();
  });
});

describe('IDトークンの確認', () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date('2026-11-17T00:00:00Z') }));
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('覚えるのは長くても1時間', () => {
    const exp = Math.floor(Date.now() / 1000) + 6 * 3600;
    const { store } = stubGas({ 'https://api.line.me/oauth2/v2.1/verify': ok({ sub: 'U1', name: 'あ', exp }) });
    expect(verifiers().idToken('tok')).toEqual({ userId: 'U1', name: 'あ' });
    expect([...store.values()][0].ttl).toBe(CACHE_MAX_SEC);
  });
});
