import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** サーバーの返事を順に返す fetch と、sessionStorage を差し替える */
function stub(replies: unknown[]) {
  const ss = new Map<string, string>();
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => ss.get(k) ?? null,
    setItem: (k: string, v: string) => ss.set(k, v),
    removeItem: (k: string) => ss.delete(k),
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      return { ok: true, json: async () => replies.shift() };
    }),
  );
  return { ss, bodies };
}

const EXPIRED = { ok: false, error: 'ログインの有効期限が切れました。アプリを開き直してください。' };

/** liff.ts の「ログインし直しは1回だけ」と同じ動きにする */
async function load(ss: Map<string, string>) {
  const mod = await import('../src/api');
  let relogins = 0;
  mod.configureAuth(
    () => ({ accessToken: 'at', idToken: 'it' }),
    () => {
      if (ss.get('pb:relogin')) return;
      ss.set('pb:relogin', '1');
      relogins++;
    },
  );
  mod.markReady();
  return { mod, relogins: () => relogins };
}

describe('アプリの操作の本人確認', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it('アクセストークンと IDトークンの両方を送る', async () => {
    const { ss, bodies } = stub([{ ok: true, data: 1 }]);
    const { mod } = await load(ss);
    await mod.api('me');
    expect(bodies[0]).toMatchObject({ kind: 'api', accessToken: 'at', idToken: 'it', action: 'me' });
  });

  it('通信が通ると、ログインし直しの印が消える', async () => {
    const { ss } = stub([{ ok: true, data: 1 }]);
    ss.set('pb:relogin', '1');
    const { mod } = await load(ss);
    await mod.api('me');
    expect(ss.has('pb:relogin')).toBe(false);
  });

  it('期限切れが続く間は印が残り、2回目はログインし直さない', async () => {
    const { ss } = stub([EXPIRED, EXPIRED]);
    const { mod, relogins } = await load(ss);
    await expect(mod.api('me')).rejects.toThrow('ログインの有効期限');
    await expect(mod.api('me')).rejects.toThrow('ログインの有効期限');
    expect(relogins()).toBe(1);
    expect(ss.get('pb:relogin')).toBe('1');
  });

  it('通ったあとに再び切れたら、もう一度ログインし直せる', async () => {
    const { ss } = stub([EXPIRED, { ok: true, data: 1 }, EXPIRED]);
    const { mod, relogins } = await load(ss);
    await expect(mod.api('me')).rejects.toThrow();
    await mod.api('me');
    await expect(mod.api('me')).rejects.toThrow();
    expect(relogins()).toBe(2);
  });

  it('参加リンクの操作では印を消さない', async () => {
    const { ss } = stub([{ ok: true, data: 1 }]);
    ss.set('pb:relogin', '1');
    const { mod } = await load(ss);
    await mod.joinApi('view' as never, {} as never);
    expect(ss.get('pb:relogin')).toBe('1');
  });
});
