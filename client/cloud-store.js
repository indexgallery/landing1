import { upload } from '@vercel/blob/client';
const admin = location.pathname.endsWith('/admin.html');
let revision;
let storage;
async function api(path, options = {}) {
  const response = await fetch(`/api/${path}`, { signal: AbortSignal.timeout(20000), ...options, cache: 'no-store', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...options.headers } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(result.error || 'Не удалось связаться с сервером.'), { status: response.status });
  return result;
}
async function login() {
  const session = await api('session'); storage = session.storage;
  if (session.authenticated) return;
  const dialog = document.createElement('dialog'); dialog.id = 'cloudLogin';
  dialog.innerHTML = '<form><h2>Вход в управление сайтом</h2><label>Пароль администратора<input type="password" autocomplete="current-password" required minlength="12"></label><p role="alert"></p><button type="submit">Войти</button></form>';
  document.body.append(dialog); dialog.addEventListener('cancel', event => event.preventDefault()); dialog.showModal();
  await new Promise(resolve => {
    dialog.querySelector('form').addEventListener('submit', async event => {
      event.preventDefault(); const button = dialog.querySelector('button'); button.disabled = true;
      try { await api('session', { method: 'POST', body: JSON.stringify({ password: dialog.querySelector('input').value }) }); dialog.close(); dialog.remove(); resolve(); }
      catch (error) { dialog.querySelector('[role=alert]').textContent = error.message; }
      finally { button.disabled = false; }
    });
  });
}
async function uploadImage(file) {
  if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) throw new Error('Используйте JPG, PNG или WebP до 8 МБ.');
  if (storage === 'blob') {
    const extension = { 'image/jpeg':'jpg','image/png':'png','image/webp':'webp' }[file.type];
    const result = await upload(`images/${crypto.randomUUID()}.${extension}`, file, { access:'public', handleUploadUrl:'/api/blob-upload', contentType: file.type });
    return (await api('upload', { method:'POST', body:JSON.stringify({ url: result.url }) })).url;
  }
  const ticket = await api('upload', { method:'POST', body: JSON.stringify({ type:file.type, size:file.size }) });
  const response = await fetch(ticket.uploadUrl, { method:'PUT', body:file, headers:{ 'Content-Type':file.type } });
  if (!response.ok) throw new Error('Не удалось загрузить фото в S3. Проверьте CORS хранилища.');
  return (await api('upload', { method:'POST', body:JSON.stringify({ key:ticket.key }) })).url;
}
async function uploadEmbedded(value) {
  const copy = structuredClone(value); const cache = new Map();
  async function replace(source) {
    if (!source?.startsWith('data:image/')) return source;
    if (!cache.has(source)) {
      const response = await fetch(source); const blob = await response.blob();
      cache.set(source, await uploadImage(new File([blob], 'import-image', { type:blob.type })));
    }
    return cache.get(source);
  }
  for (const product of copy.products) {
    product.photo = await replace(product.photo);
    if (product.photos) product.photos = await Promise.all(product.photos.map(replace));
  }
  for (const [key, value] of Object.entries(copy.site)) if (typeof value === 'string' && value.startsWith('data:image/')) copy.site[key] = await replace(value);
  return copy;
}
window.cloudStore = {
  uploadImage,
  async save(products, categories, site) {
    const next = await uploadEmbedded({ products, categories, site });
    let saved;
    try { saved = await api('catalogue', { method:'PUT', body:JSON.stringify({ ...next, revision }) }); }
    catch (error) { if (error.status === 409) window.cloudConflictBackup = next; throw error; }
    window.cloudConflictBackup = null;
    revision = saved.revision;
    return saved;
  }
};
function script(src) {
  return new Promise((resolve,reject) => { const el=document.createElement('script'); el.src=src; el.onload=resolve; el.onerror=reject; document.body.append(el); });
}
async function boot() {
  if (admin) await login();
  const state = await api('catalogue'); revision = state.revision;
  window.catalogProducts = state.products; window.catalogCategories = state.categories; window.siteContent = state.site;
  if (admin) {
    await script('admin.js'); await script('admin-site.js');
    const logout = document.createElement('button'); logout.textContent='Выйти'; logout.type='button';
    logout.onclick=async () => { if (!confirm('Выйти? Несохранённые изменения будут потеряны.')) return; await api('session', {method:'DELETE'}); location.reload(); };
    document.querySelector('header').append(logout);
  } else {
    // The editor reads the original markup as its reset baseline, then applies
    // the saved overrides itself. Do not treat published overrides as defaults.
    if (!new URLSearchParams(location.search).has('editor-preview')) window.applySiteContent(document, window.validateSiteContent(state.site));
    await script('app.js');
  }
}
boot().catch(error => {
  console.error(error);
  const notice = document.createElement('p'); notice.setAttribute('role','alert');
  notice.textContent = `Не удалось загрузить сайт: ${error.message} Перезагрузите страницу после восстановления соединения.`;
  notice.style.cssText='padding:24px;background:#fff0ed;color:#7d231b;position:relative;z-index:100';
  document.body.prepend(notice);
});
