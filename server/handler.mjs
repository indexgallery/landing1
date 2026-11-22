import { randomUUID } from 'node:crypto';
import { handleUpload } from '@vercel/blob/client';
import { getPool, readState, saveState } from './db.mjs';
import { authenticated, requireAdmin, requireOrigin, passwordMatches, sessionCookie, cookie, loginKey } from './auth.mjs';
import { driver, imageTypes, maxImageSize, signedUpload, finishUpload, confirmBlob } from './storage.mjs';
import { validateState } from './validation.mjs';
function json(value, status = 200, headers = {}) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
}
async function body(request) {
  const reader = request.body?.getReader(); if (!reader) return {};
  let size = 0; const chunks = [];
  while (true) {
    const part = await reader.read(); if (part.done) break;
    size += part.value.length;
    if (size > 2 * 1024 * 1024) { await reader.cancel(); throw Object.assign(new Error('Слишком много данных. Фото загружаются отдельно.'), { status: 413 }); }
    chunks.push(part.value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('Некорректный JSON.'), { status: 400 }); }
}
export async function handle(request) {
  try {
    const url = new URL(request.url);
    const route = url.searchParams.get('route') || url.pathname.replace(/^\/api\//, '');
    const method = request.method;
    if (route === 'health' && method === 'GET') { await getPool().query('SELECT 1'); return json({ ok: true }); }
    if (route === 'catalogue' && method === 'GET') return json(await readState());
    if (route === 'session' && method === 'GET') return json({ authenticated: authenticated(request), storage: driver() });
    if (route === 'session' && method === 'POST') {
      requireOrigin(request);
      const key = loginKey(request);
      await getPool().query("DELETE FROM login_attempts WHERE started_at < now() - interval '15 minutes'");
      const { rows } = await getPool().query(`INSERT INTO login_attempts(key,attempts) VALUES($1,1) ON CONFLICT(key) DO UPDATE SET attempts=login_attempts.attempts+1 RETURNING attempts`, [key]);
      if (rows[0].attempts > 10) return json({ error: 'Слишком много попыток. Повторите через 15 минут.' }, 429);
      if (!passwordMatches((await body(request)).password)) return json({ error: 'Неверный пароль.' }, 401);
      await getPool().query('DELETE FROM login_attempts WHERE key=$1', [key]);
      return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie() });
    }
    if (route === 'session' && method === 'DELETE') { requireOrigin(request); return json({ ok: true }, 200, { 'Set-Cookie': cookie() }); }
    if (route === 'blob-upload' && method === 'POST' && driver() === 'blob') {
      const input = await body(request);
      const result = await handleUpload({ request, body: input,
        onBeforeGenerateToken: async (pathname) => {
          requireOrigin(request); requireAdmin(request);
          if (!/^images\/[a-f0-9-]+\.(jpg|png|webp)$/.test(pathname)) throw new Error('Invalid image path');
          return { allowedContentTypes: Object.keys(imageTypes), maximumSizeInBytes: maxImageSize, addRandomSuffix: true };
        },
        onUploadCompleted: async ({ blob }) => {
          // handleUpload verifies callback signatures before invoking this callback.
          await confirmBlob(blob.url);
        }
      });
      return json(result);
    }
    requireAdmin(request);
    if (method !== 'GET') requireOrigin(request);
    if (route === 'catalogue' && method === 'PUT') {
      const input = await body(request);
      if (!Number.isSafeInteger(input.revision) || input.revision < 1) return json({ error: 'Некорректная версия каталога.' }, 400);
      return json(await saveState(validateState(input), input.revision));
    }
    if (route === 'upload' && method === 'POST') {
      const input = await body(request);
      if (driver() === 'blob') return json({ url: await confirmBlob(input.url) });
      if (input.key) return json({ url: await finishUpload(input.key) });
      if (!imageTypes[input.type] || !Number.isSafeInteger(input.size) || input.size < 1 || input.size > maxImageSize) return json({ error: 'Используйте JPG, PNG или WebP до 8 МБ.' }, 400);
      const key = `images/${randomUUID()}.${imageTypes[input.type]}`;
      return json({ key, uploadUrl: await signedUpload(key, input.type, input.size) });
    }
    return json({ error: 'Маршрут не найден.' }, 404);
  } catch (error) {
    if (!error.status) console.error('API failure:', error);
    return json({ error: error.status ? error.message : 'Сервис недоступен. Проверьте подключение базы и хранилища.' }, error.status || 503);
  }
}
