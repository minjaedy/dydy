const mapHosts = new Set([
  'map.naver.com', 'maps.naver.com', 'm.map.naver.com',
  'm.place.naver.com', 'pcmap.place.naver.com', 'place.naver.com', 'naver.me'
]);

function mapUrl(input) {
  if (typeof input !== 'string' || input.length > 2048) return null;
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !mapHosts.has(url.hostname)) return null;
    return url;
  } catch { return null; }
}

export async function resolveNaverLocation(input, read = fetch) {
  let url = mapUrl(input);
  if (!url) return null;
  const signal = AbortSignal.timeout(7000);
  const result = {link: url.href, name: '', coords: null};
  try {
    for (let i = 0; url.hostname === 'naver.me' && i < 3; i++) {
      if (!/^\/[a-zA-Z0-9_-]{4,32}\/?$/.test(url.pathname)) return result;
      const response = await read(url.href, {signal, redirect: 'manual'});
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (response.status < 300 || response.status >= 400 || !location) return result;
      url = mapUrl(new URL(location, url).href);
      if (!url) return result;
      result.link = url.href;
    }
    return result;
  } catch { return result; }
}

export async function travelLocationRoute(request) {
  if (request.method !== 'POST') return Response.json({error: 'POST required'}, {status: 405});
  let input;
  try { input = await request.json(); } catch { return Response.json({error: 'Invalid JSON'}, {status: 400}); }
  const result = await resolveNaverLocation(input?.link);
  return Response.json(result || {error: '네이버 지도 링크를 확인해 주세요.'}, {
    status: result ? 200 : 400, headers: {'Cache-Control': 'no-store'}
  });
}
