import { createHmac, timingSafeEqual } from 'node:crypto';
const lifetime = 8 * 60 * 60;
function secret() {
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32 || !process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 12) throw new Error('Configure ADMIN_PASSWORD (12+ characters) and SESSION_SECRET (32+ characters)');
  return process.env.SESSION_SECRET;
}
function sign(value) { return createHmac('sha256', secret()).update(value).digest('base64url'); }
export function passwordMatches(value) {
  return typeof value === 'string' && timingSafeEqual(Buffer.from(sign(value)), Buffer.from(sign(process.env.ADMIN_PASSWORD)));
}
export function sessionCookie() {
  const payload = String(Math.floor(Date.now() / 1000) + lifetime);
  return cookie(`${payload}.${sign(`${payload}:${process.env.ADMIN_PASSWORD}`)}`, lifetime);
}
export function cookie(value = '', age = 0) {
  const secure = new URL(process.env.APP_ORIGIN || 'http://localhost:4173').protocol === 'https:';
  return `catalog_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? '; Secure' : ''}`;
}
export function authenticated(request) {
  const token = (request.headers.get('cookie') || '').split('; ').find(v => v.startsWith('catalog_session='))?.slice(16);
  if (!token) return false;
  const [expires, signature] = token.split('.');
  if (!/^\d+$/.test(expires) || Number(expires) < Date.now() / 1000 || !signature) return false;
  const expected = sign(`${expires}:${process.env.ADMIN_PASSWORD}`);
  return signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
export function requireAdmin(request) {
  if (!authenticated(request)) throw Object.assign(new Error('Войдите в админку.'), { status: 401 });
}
export function requireOrigin(request) {
  const expected = process.env.APP_ORIGIN ? new URL(process.env.APP_ORIGIN).origin : null;
  const origin = request.headers.get('origin');
  let referrerOrigin = null;
  try { referrerOrigin = new URL(request.headers.get('referer')).origin; } catch { /* Missing or malformed referrer. */ }
  // Some embedded browsers omit Origin. An exact same-origin Referer is a
  // browser-controlled fallback; never use it to override an explicit bad Origin.
  const validSource = origin !== null ? origin === expected : referrerOrigin === expected;
  const crossSite = request.headers.get('sec-fetch-site') === 'cross-site';
  if (!expected || !validSource || crossSite) throw Object.assign(new Error('Недопустимый источник запроса. Откройте админку по основному адресу сайта и обновите страницу.'), { status: 403 });
}
export function loginKey(request) {
  const ip = process.env.VERCEL ? request.headers.get('x-vercel-forwarded-for') || 'unknown' : 'local';
  return sign(ip);
}
