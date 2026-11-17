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
      const hit = cache.get(key);
      if (hit) return JSON.parse(hit);
      // このチャネルが発行したトークンで、期限が残っているかを確かめる
      const v = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify?access_token=' + encodeURIComponent(token), { muteHttpExceptions: true });
      if (v.getResponseCode() !== 200) return null;
      const info = JSON.parse(v.getContentText()) as { client_id?: string; expires_in?: number };
      if (info.client_id !== props.loginChannelId || !(Number(info.expires_in) > 0)) return null;
      const p = UrlFetchApp.fetch('https://api.line.me/v2/profile', { headers: { Authorization: `Bearer ${token}` }, muteHttpExceptions: true });
      if (p.getResponseCode() !== 200) return null;
      const prof = JSON.parse(p.getContentText()) as { userId?: string; displayName?: string };
      if (!prof.userId) return null;
      const user = { userId: prof.userId, name: prof.displayName };
      // トークンの期限まで覚える（キャッシュの上限は6時間）
      const ttl = Math.min(21600, Math.floor(Number(info.expires_in)));
      if (ttl > 0) cache.put(key, JSON.stringify(user), ttl);
      return user;
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
      // トークンの期限まで覚える（キャッシュの上限は6時間）。開くたびに LINE に問い合わせないように
      const ttl = Math.min(21600, Math.floor((claims.exp ?? 0) - Date.now() / 1000));
      if (ttl > 0) cache.put(key, JSON.stringify(user), ttl);
      return user;
    },
  };
}
