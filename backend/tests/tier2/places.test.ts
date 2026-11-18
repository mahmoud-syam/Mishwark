import http from 'http';
import { AddressInfo } from 'net';
import { describe, test, expect } from '../infra/run-all';
import { createApiClient } from '../infra/api-client';
import PlacesService from '../../src/v1/services/places.service';

/**
 * Booking map: search places in Egypt (Photon) and the address at a pin
 * (Nominatim, Photon as fallback). The providers are replaced by a local fake
 * that answers in their real formats.
 */
describe('Tier 2: place search and reverse geocoding for the booking map', () => {
  const ctx: any = {};
  const calls: string[] = [];
  let nominatimDown = false;

  const photonFeature = (name: string | undefined, lng: number, lat: number, extra: Record<string, string> = {}) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lng, lat] },
    properties: { name, countrycode: 'EG', osm_key: 'amenity', osm_value: 'events_venue', ...extra },
  });

  const setup = async () => {
    if (ctx.ready) return true;
    const server = http.createServer((req, res) => {
      calls.push(req.url!);
      const url = new URL(req.url!, 'http://x');
      res.setHeader('Content-Type', 'application/json');
      if (url.pathname === '/api/') {
        ctx.lastUA = req.headers['user-agent'];
        const q = url.searchParams.get('q') ?? '';
        if (q === 'boom') { res.statusCode = 500; return res.end('{}'); }
        return res.end(JSON.stringify({
          type: 'FeatureCollection',
          features: q.includes('الماسة')
            ? [
                photonFeature('قاعة الماسة', 31.3462, 30.0749, { district: 'مدينة نصر', city: 'القاهرة', state: 'محافظة القاهرة' }),
                photonFeature('قاعة الماسة', 31.3462, 30.0749, { district: 'مدينة نصر', city: 'القاهرة', state: 'محافظة القاهرة' }),
                photonFeature('Almasa Hall', 35.9, 31.9, { countrycode: 'JO' }),
                photonFeature(undefined, 31.2, 30.0, { street: 'شارع التسعين', housenumber: '12', city: 'القاهرة' }),
              ]
            : [],
        }));
      }
      if (url.pathname === '/reverse' && url.searchParams.get('format') === 'jsonv2') {
        if (nominatimDown) { res.statusCode = 503; return res.end('{}'); }
        return res.end(JSON.stringify({
          lat: url.searchParams.get('lat'), lon: url.searchParams.get('lon'), name: 'فندق فيرمونت', category: 'tourism', type: 'hotel',
          address: { road: 'طريق صلاح سالم', suburb: 'مصر الجديدة', city: 'القاهرة', state: 'محافظة القاهرة' },
        }));
      }
      if (url.pathname === '/reverse') {
        return res.end(JSON.stringify({ features: [photonFeature('ميدان التحرير', 31.2357, 30.0444, { city: 'القاهرة' })] }));
      }
      res.statusCode = 404; res.end('{}');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.PHOTON_URL = base;
    process.env.NOMINATIM_URL = base;
    ctx.server = server;
    ctx.api = createApiClient();
    PlacesService.clearCache();
    ctx.ready = true;
    return true;
  };

  test('PLACE-01: search returns places in Egypt with name, detail and coordinates, without an account', async () => {
    await setup();
    const res = await ctx.api.get(`/places/search?q=${encodeURIComponent('قاعة الماسة')}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2); // duplicate and the Jordan result dropped
    const first = res.body.data[0];
    expect(first.name).toBe('قاعة الماسة');
    expect(first.detail).toBe('مدينة نصر، القاهرة، محافظة القاهرة');
    expect(first.label).toBe('قاعة الماسة، مدينة نصر، القاهرة، محافظة القاهرة');
    expect(first.latitude).toBe(30.0749);
    expect(first.longitude).toBe(31.3462);
    // A street with no place name is named by the street.
    expect(res.body.data[1].name).toBe('شارع التسعين 12');
    // Limited to Egypt and sent with an identifying User-Agent.
    expect(calls.some((c) => c.includes('bbox=24.6,21.9,37.1,31.8'))).toBe(true);
    // Arabic search asks for the local (Arabic) names; English for English ones.
    expect(calls.some((c) => c.includes('lang=default'))).toBe(true);
    await ctx.api.get('/places/search?q=Cairo%20Tower');
    expect(calls.some((c) => c.includes('lang=en') && c.includes('Cairo'))).toBe(true);
    expect(String(ctx.lastUA).startsWith('Mishwark/')).toBe(true);
  });

  test('PLACE-02: repeated searches come from the cache; short text is not sent at all', async () => {
    await setup();
    const before = calls.length;
    await ctx.api.get(`/places/search?q=${encodeURIComponent('قاعة الماسة')}`);
    expect(calls.length).toBe(before);
    expect((await ctx.api.get('/places/search?q=a')).body.data.length).toBe(0);
    expect(calls.length).toBe(before);
  });

  test('PLACE-03: a pin gets its address from Nominatim, keeping the pin\'s own position', async () => {
    await setup();
    const res = await ctx.api.get('/places/reverse?lat=30.0911&lng=31.3253');
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('فندق فيرمونت');
    expect(res.body.data.label).toBe('فندق فيرمونت، طريق صلاح سالم، مصر الجديدة، القاهرة، محافظة القاهرة');
    expect(res.body.data.latitude).toBe(30.0911);
    expect(calls.some((c) => c.includes('accept-language=ar'))).toBe(true);
  });

  test('PLACE-04: Nominatim down -> Photon; both down -> the coordinates (not cached)', async () => {
    await setup();
    nominatimDown = true;
    const res = await ctx.api.get('/places/reverse?lat=30.0444&lng=31.2357');
    expect(res.body.data.name).toBe('ميدان التحرير');
    expect(res.body.data.latitude).toBe(30.0444);
    process.env.PHOTON_URL = 'http://127.0.0.1:9';
    const plain = await ctx.api.get('/places/reverse?lat=30.05&lng=31.24');
    expect(plain.status).toBe(200);
    expect(plain.body.data.label).toBe('30.05000, 31.24000');
    // Back up: the same pin now gets a real address (the fallback wasn't cached).
    process.env.PHOTON_URL = process.env.NOMINATIM_URL;
    nominatimDown = false;
    expect((await ctx.api.get('/places/reverse?lat=30.05&lng=31.24')).body.data.name).toBe('فندق فيرمونت');
  });

  test('PLACE-05: bad input and provider failures', async () => {
    await setup();
    expect((await ctx.api.get('/places/reverse?lat=abc&lng=31')).status).toBe(400);
    expect((await ctx.api.get('/places/reverse?lat=48.85&lng=2.35')).status).toBe(400); // Paris
    expect((await ctx.api.get(`/places/search?q=${'x'.repeat(130)}`)).status).toBe(400);
    const down = await ctx.api.get('/places/search?q=boom');
    expect(down.status).toBe(502);
    ctx.server.close();
  });
});
