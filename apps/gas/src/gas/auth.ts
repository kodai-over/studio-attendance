import type { Verifiers } from '../app/router';

function hex(bytes: number[]): string {
  return bytes.map((b) => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0')).join('');
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Worker と同じく HMAC-SHA256(RELAY_SECRET, `${ts}.${body}`) の16進 */
export function relayMac(secret: string, ts: number, body: string): string {
  return hex(Utilities.computeHmacSha256Signature(`${ts}.${body}`, secret, Utilities.Charset.UTF_8));
}

/** 確かめた結果を覚えておく長さ（秒） */
export const CACHE_MAX_SEC = 3600;

export function makeVerifiers(props: { relaySecret: string; loginChannelId: string }): Verifiers {
  const cache = CacheService.getScriptCache();
  // チャネルを変えたときに古いチャネルのトークンを通さないよう、チャネルIDもキーに入れる
  const keyOf = (kind: string, token: string) =>
    `${kind}:${props.loginChannelId}:` + hex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token, Utilities.Charset.UTF_8));
  return {
    relay(ts, body, mac) {
      if (!props.relaySecret) return false;
      return safeEqual(relayMac(props.relaySecret, ts, body), mac.toLowerCase());
    },
    accessToken(token) {
      if (!props.loginChannelId) return null;
      const key = keyOf('act', token);
      // 通信の失敗や JSON 以外の返事でも例外を外に出さず null を返し、IDトークンでの確認に回す
      // （IDトークンのほうは例外のままにして、LINE の障害時にログインし直しへ進ませず「エラーが起きました」を出す）
      try {
        const hit = cache.get(key);
        if (hit) return JSON.parse(hit);
        // このチャネルが発行したトークンで、期限が残っているかを確かめる
        const v = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify?access_token=' + encodeURIComponent(token), { muteHttpExceptions: true });
        if (v.getResponseCode() !== 200) return null;
        const info = JSON.parse(v.getContentText()) as { client_id?: string; expires_in?: number };
        const expiresIn = Number(info.expires_in);
        if (info.client_id !== props.loginChannelId || !(expiresIn > 0)) return null;
        const p = UrlFetchApp.fetch('https://api.line.me/v2/profile', { headers: { Authorization: `Bearer ${token}` }, muteHttpExceptions: true });
        if (p.getResponseCode() !== 200) return null;
        const prof = JSON.parse(p.getContentText()) as { userId?: string; displayName?: string };
        if (!prof.userId) return null;
        const user = { userId: prof.userId, name: prof.displayName };
        // 取り消しや表示名の変更が遅れて届くのを抑えるため、覚えるのはトークンの期限か1時間の短いほう
        const ttl = Math.min(CACHE_MAX_SEC, Math.floor(expiresIn));
        if (ttl > 0) cache.put(key, JSON.stringify(user), ttl);
        return user;
      } catch {
        return null;
      }
    },
    idToken(token) {
      if (!props.loginChannelId) return null;
      const key = keyOf('idt', token);
      const hit = cache.get(key);
      if (hit) return JSON.parse(hit);
      const res = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify', {
        method: 'post',
        payload: { id_token: token, client_id: props.loginChannelId },
        muteHttpExceptions: true,
      });
      if (res.getResponseCode() !== 200) return null;
      const claims = JSON.parse(res.getContentText()) as { sub?: string; name?: string; exp?: number };
      if (!claims.sub) return null;
      const user = { userId: claims.sub, name: claims.name };
      // トークンの期限まで覚える（最大1時間）。開くたびに LINE に問い合わせないように
      const ttl = Math.min(CACHE_MAX_SEC, Math.floor((claims.exp ?? 0) - Date.now() / 1000));
      if (ttl > 0) cache.put(key, JSON.stringify(user), ttl);
      return user;
    },
  };
}
