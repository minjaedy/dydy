// RFC 8291 (aes128gcm) and RFC 8292 (VAPID), using the Worker's native
// asynchronous crypto instead of the synchronous Node compatibility path.
const utf8 = new TextEncoder();
const bytes = value => new Uint8Array(Buffer.from(value, 'base64url'));
const b64 = value => Buffer.from(value).toString('base64url');
const join = (...parts) => {
  const result = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
};
async function hkdf(secret, salt, info, length) {
  const key = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF', hash:'SHA-256', salt, info}, key, length * 8));
}
const vapidCache = new Map();
async function authorization(env, audience) {
  const now = Math.floor(Date.now() / 1000);
  const cacheKey = audience + '|' + env.VAPID_PUBLIC_KEY + '|' + env.APP_URL;
  const cached = vapidCache.get(cacheKey);
  if (cached && cached.expires > now + 60) return cached.header;
  const publicKey = bytes(env.VAPID_PUBLIC_KEY), privateKey = bytes(env.VAPID_PRIVATE_KEY);
  if (publicKey.length !== 65 || publicKey[0] !== 4 || privateKey.length !== 32) throw Error('Invalid VAPID key');
  const key = await crypto.subtle.importKey('jwk', {kty:'EC', crv:'P-256',
    x:b64(publicKey.slice(1,33)), y:b64(publicKey.slice(33)), d:b64(privateKey)},
    {name:'ECDSA', namedCurve:'P-256'}, false, ['sign']);
  const expires = now + 12 * 3600;
  const token = b64(utf8.encode(JSON.stringify({typ:'JWT', alg:'ES256'}))) + '.' +
    b64(utf8.encode(JSON.stringify({aud:audience, exp:expires, sub:env.APP_URL})));
  const signature = await crypto.subtle.sign({name:'ECDSA', hash:'SHA-256'}, key, utf8.encode(token));
  const header = 'vapid t=' + token + '.' + b64(signature) + ', k=' + env.VAPID_PUBLIC_KEY;
  if (vapidCache.size >= 16) vapidCache.clear();
  vapidCache.set(cacheKey, {expires, header});
  return header;
}
export async function buildPushRequest(env, subscription, payload, topic) {
  const endpoint = new URL(subscription.endpoint);
  if (endpoint.protocol !== 'https:' || !['web.push.apple.com','fcm.googleapis.com','updates.push.services.mozilla.com']
    .some(host => endpoint.hostname === host || endpoint.hostname.endsWith('.' + host))) throw Error('Unsupported push endpoint');
  const receiver = bytes(subscription.keys.p256dh), auth = bytes(subscription.keys.auth);
  if (receiver.length !== 65 || receiver[0] !== 4 || auth.length !== 16) throw Error('Invalid push subscription');
  const plaintext = utf8.encode(payload);
  // One encrypted record; retain space for its header, final delimiter and tag.
  if (plaintext.length > 3993) throw Error('Push payload too large');
  const pair = await crypto.subtle.generateKey({name:'ECDH', namedCurve:'P-256'}, true, ['deriveBits']);
  const sender = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const receiverKey = await crypto.subtle.importKey('raw', receiver, {name:'ECDH', namedCurve:'P-256'}, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH', public:receiverKey}, pair.privateKey, 256));
  const ikm = await hkdf(shared, auth, join(utf8.encode('WebPush: info\0'), receiver, sender), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const [cek, nonce] = await Promise.all([
    hkdf(ikm, salt, utf8.encode('Content-Encoding: aes128gcm\0'), 16),
    hkdf(ikm, salt, utf8.encode('Content-Encoding: nonce\0'), 12)
  ]);
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM', iv:nonce, tagLength:128}, aesKey, join(plaintext, new Uint8Array([2]))));
  const header = new Uint8Array(21);
  header.set(salt); new DataView(header.buffer).setUint32(16, 4096); header[20] = sender.length;
  return {endpoint:endpoint.href, body:join(header, sender, ciphertext), headers:{
    'Content-Encoding':'aes128gcm', 'Content-Type':'application/octet-stream', TTL:'86400',
    Authorization:await authorization(env, endpoint.origin),
    ...(topic ? {Topic:topic.slice(0,32)} : {})
  }};
}
