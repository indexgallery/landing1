import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const context = { window: {}, document: { querySelector: () => null } };
vm.runInNewContext(readFileSync(new URL('../site-content.js', import.meta.url), 'utf8'), context);
export const siteFields = context.window.siteFields;
export function safePhoto(value) {
  if (typeof value !== 'string' || value.length > 2048) return false;
  if (value === '' || /^(?:img\/)?assets\/[\w./-]+$/.test(value)) return true;
  try { const url = new URL(value); return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname)); } catch { return false; }
}
function invalid(message) { throw Object.assign(new Error(message), { status: 400 }); }
export function validateState(value) {
  if (!value || !Array.isArray(value.products) || value.products.length > 2000 || !Array.isArray(value.categories) || value.categories.length > 200) invalid('Некорректный каталог.');
  const categories = [...new Set(['furniture','art','light', ...value.categories])];
  if (!categories.every(c => typeof c === 'string' && c.trim() && c.length <= 80 && c !== 'all')) invalid('Некорректная категория.');
  const products = value.products.map(p => {
    if (!p || !['name','resident','price','specs','description','type'].every(k => typeof p[k] === 'string' && p[k].length <= (k === 'description' ? 20000 : 3000)) || !p.name.trim() || !p.resident.trim() || !p.price.trim() || !categories.includes(p.type) || !safePhoto(p.photo)) invalid('Заполните название, резидента, цену и категорию объекта.');
    if (p.photos !== undefined && (!Array.isArray(p.photos) || p.photos.length > 12 || !p.photos.every(safePhoto))) invalid('Некорректные фотографии.');
    if (p.variants !== undefined && (!Array.isArray(p.variants) || p.variants.length > 50 || !p.variants.every(v => v && ['size','price'].every(k => typeof v[k] === 'string' && v[k].trim() && v[k].length <= 300)))) invalid('Некорректные варианты.');
    return Object.fromEntries(['name','resident','price','specs','description','type','photo','photos','scene','variants'].filter(k => p[k] !== undefined).map(k => [k, p[k]]));
  });
  let site;
  try { site = context.window.validateSiteContent(value.site || {}); } catch (error) { invalid(error.message); }
  for (const field of siteFields.filter(f => f.kind === 'image')) if (site[field.key] !== undefined && !safePhoto(site[field.key])) invalid('Сначала загрузите изображение в хранилище.');
  return { products, categories, site };
}
