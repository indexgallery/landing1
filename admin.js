'use strict';
const $ = (selector) => document.querySelector(selector);
const form = $('#productForm');
let products = structuredClone(window.catalogProducts || []);
let selected = -1;
let draftPhotos = [];
let dirty = false;
let saving = false;
let ready = false;
let siteDraft = structuredClone(window.siteContent || {});
let siteDirty = false;
const baseCategories = { furniture: 'Мебель', art: 'Искусство', light: 'Свет' };
let categories = [...new Set(['furniture', 'art', 'light', ...(window.catalogCategories || []), ...products.map((p) => p.type)])];
const field = (name) => form.elements.namedItem(name);
function ask(message) {
  return new Promise((resolve) => {
    const dialog = $('#confirmDialog'); $('#confirmText').textContent = message;
    const finish = (answer) => { dialog.close(); resolve(answer); };
    $('#confirmYes').onclick = () => finish(true); $('#confirmNo').onclick = () => finish(false);
    dialog.oncancel = (event) => { event.preventDefault(); finish(false); }; dialog.showModal();
  });
}
function askCategory() {
  return new Promise((resolve) => {
    const dialog = $('#categoryDialog'); $('#categoryName').value = '';
    const finish = (value) => { dialog.close(); resolve(value); };
    $('#categoryYes').onclick = () => finish($('#categoryName').value.trim()); $('#categoryNo').onclick = () => finish('');
    dialog.oncancel = (event) => { event.preventDefault(); finish(''); }; dialog.showModal(); $('#categoryName').focus();
  });
}
function renderCategories(value = field('type').value) {
  field('type').replaceChildren(...categories.map((category) => {
    const option = document.createElement('option'); option.value = category;
    option.textContent = Object.hasOwn(baseCategories, category) ? baseCategories[category] : category;
    return option;
  }));
  field('type').value = categories.includes(value) ? value : 'furniture';
}
$('#addCategory').addEventListener('click', async () => {
  const name = await askCategory();
  if (!name || saving) return;
  if (name.length > 80 || name.toLowerCase() === 'all') { status('Название категории: до 80 символов; «all» зарезервировано.', true); return; }
  const existing = categories.find((key) => (Object.hasOwn(baseCategories, key) ? baseCategories[key] : key).toLowerCase() === name.toLowerCase());
  const old = [...categories];
  if (!existing) categories.push(name);
  saving = true;
  try { await persist(products); renderCategories(existing || name); dirty = true; }
  catch (error) { categories = old; status(error.message, true); }
  finally { saving = false; }
});
function addVariant(value = { size: '', price: '' }) {
  const row = document.createElement('div'); row.className = 'variant-row';
  for (const [key, label] of [['size', 'Размер варианта'], ['price', 'Цена варианта']]) {
    const wrapper = document.createElement('label'); wrapper.textContent = label;
    const input = document.createElement('input'); input.dataset.variant = key; input.value = value[key];
    wrapper.append(input); row.append(wrapper);
  }
  row.append(button('×', () => { row.remove(); dirty = true; }, 'Удалить вариант'));
  $('#variantList').append(row);
}
$('#addVariant').addEventListener('click', () => { addVariant(); dirty = true; });
$('#removeCategory').addEventListener('click', async () => {
  const key = field('type').value;
  if (saving) return;
  if (Object.hasOwn(baseCategories, key) || products.some((p) => p.type === key)) { status('Можно удалить только свою категорию без объектов. Сначала перенесите объекты в другую категорию.', true); return; }
  if (!await ask(`Удалить пустую категорию «${key}»?`)) return;
  const previous = [...categories]; categories = categories.filter((c) => c !== key); saving = true;
  try { await persist(products); renderCategories('furniture'); dirty = true; }
  catch (error) { categories = previous; status(error.message, true); }
  finally { saving = false; }
});
const status = (message, error = false) => { $('#status').textContent = message; $('#status').classList.toggle('error', error); };
const button = (text, action, label = text) => {
  const node = document.createElement('button'); node.type = 'button'; node.textContent = text;
  node.setAttribute('aria-label', label); node.addEventListener('click', action); return node;
};
async function persist(next, content = siteDraft) {
  const saved = await window.cloudStore.save(next, categories, content);
  products = saved.products; categories = saved.categories; siteDraft = structuredClone(saved.site);
  status('Сохранено и опубликовано на сайте.');
}
async function canLeave() { return ready && !saving && (!dirty || await ask('Есть несохранённые изменения объекта. Отменить их?')); }
function renderList() {
  const query = $('#search').value.trim().toLowerCase();
  $('#count').textContent = `${products.length} объектов`;
  $('#productList').replaceChildren();
  products.forEach((product, index) => {
    if (!`${product.name} ${product.resident}`.toLowerCase().includes(query)) return;
    const row = document.createElement('div'); row.className = 'list-row' + (index === selected ? ' selected' : '');
    const choose = button(product.name, async () => { if (await canLeave()) select(index); }); choose.className = 'select-product';
    const resident = document.createElement('small'); resident.textContent = product.resident; choose.append(resident);
    const arrows = document.createElement('div'); arrows.className = 'reorder';
    [-1, 1].forEach((step) => {
      const arrow = button(step < 0 ? '↑' : '↓', async () => {
        if (saving || !await canLeave()) return;
        saving = true;
        try {
          const next = structuredClone(products); const other = index + step;
          [next[index], next[other]] = [next[other], next[index]];
          await persist(next); select(other);
        } catch (error) { status(error.message, true); } finally { saving = false; }
      }, step < 0 ? 'Переместить объект выше' : 'Переместить объект ниже');
      arrow.disabled = index + step < 0 || index + step >= products.length; arrows.append(arrow);
    });
    row.append(choose, arrows); $('#productList').append(row);
  });
}
function select(index) {
  selected = index; dirty = false; $('#fields').disabled = false;
  const product = products[index] || { name: '', resident: '', type: 'furniture', price: '', specs: '', description: '' };
  $('#editorTitle').textContent = index < 0 ? 'Новый объект' : 'Редактирование объекта';
  renderCategories(product.type);
  for (const key of ['name', 'resident', 'price', 'specs', 'description']) field(key).value = product[key] || '';
  $('#variantList').replaceChildren();
  (product.variants || []).forEach(addVariant);
  draftPhotos = [...(product.photos?.length ? product.photos : [product.photo].filter(Boolean))];
  $('#removeProduct').disabled = index < 0; $('#photos').value = ''; renderPhotos(); renderList();
}
function renderPhotos() {
  $('#photoList').replaceChildren();
  draftPhotos.forEach((source, index) => {
    const tile = document.createElement('div'); tile.className = 'photo';
    const photo = document.createElement('img'); photo.src = source; photo.alt = `Фото ${index + 1}`;
    const caption = document.createElement('p'); caption.textContent = index ? `Фото ${index + 1}` : 'Главное фото';
    tile.append(photo, caption);
    [-1, 1].forEach((step) => {
      const arrow = button(step < 0 ? '←' : '→', () => {
        [draftPhotos[index], draftPhotos[index + step]] = [draftPhotos[index + step], draftPhotos[index]];
        dirty = true; renderPhotos();
      }, step < 0 ? 'Переместить фото левее' : 'Переместить фото правее');
      arrow.disabled = index + step < 0 || index + step >= draftPhotos.length; tile.append(arrow);
    });
    tile.append(button('×', () => { draftPhotos.splice(index, 1); dirty = true; renderPhotos(); }, 'Убрать фото')); $('#photoList').append(tile);
  });
}
form.addEventListener('input', () => { dirty = true; });
$('#search').addEventListener('input', renderList);
$('#newProduct').addEventListener('click', async () => { if (await canLeave()) { $('#objectsTab').click(); select(-1); field('name').focus(); } });
$('#photos').addEventListener('change', async (event) => {
  if (saving) return;
  saving = true;
  const files = [...event.target.files];
  try {
    if (draftPhotos.length + files.length > 12) throw new Error('Можно добавить до 12 фотографий на объект.');
    const incoming = [];
    for (const file of files) {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Используйте JPG, PNG или WebP.');
      if (file.size > 8 * 1024 * 1024) throw new Error('Каждое фото должно быть меньше 8 МБ.');
      incoming.push(await window.cloudStore.uploadImage(file));
    }
    draftPhotos.push(...incoming); dirty = true; renderPhotos(); status('Фото добавлены. Нажмите «Сохранить объект».');
  } catch (error) { status(error.message || 'Не удалось прочитать фото.', true); }
  finally { saving = false; event.target.value = ''; }
});
form.addEventListener('submit', async (event) => {
  event.preventDefault(); if (saving) return; saving = true;
  try {
    const product = { ...(products[selected] || {}) };
    for (const key of ['name', 'resident', 'type', 'price', 'specs', 'description']) product[key] = field(key).value.trim();
    product.variants = [...$('#variantList').children].map((row, index) => {
      const size = row.querySelector('[data-variant="size"]').value.trim();
      const price = row.querySelector('[data-variant="price"]').value.trim();
      if (!size && !price) return null;
      if (!size || !price) throw new Error(`Вариант ${index + 1}: заполните оба поля или удалите строку. Основные цена и размеры указаны отдельно.`);
      return { size, price };
    }).filter(Boolean);
    product.photo = draftPhotos[0] || ''; product.photos = [...draftPhotos]; product.scene = true;
    const next = structuredClone(products); const index = selected < 0 ? next.length : selected; next[index] = product;
    await persist(next); select(index);
  } catch (error) { status(error.message, true); } finally { saving = false; }
});
$('#removeProduct').addEventListener('click', async () => {
  if (selected < 0 || saving || !await ask(`Удалить «${products[selected].name}» из черновика?`)) return;
  saving = true;
  try { const next = products.filter((_, i) => i !== selected); await persist(next); select(-1); $('#fields').disabled = true; $('#editorTitle').textContent = 'Выберите объект'; }
  catch (error) { status(error.message, true); } finally { saving = false; }
});
function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type })); const link = document.createElement('a');
  link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}
$('#exportCatalogue').addEventListener('click', () => {
  if (dirty || siteDirty || saving) { status('Сначала сохраните изменения объекта и информации сайта.', true); return; }
  const bundle = window.createUpdateZip(window.buildUpdateFiles(products, categories, siteDraft));
  download('design-index-update.zip', bundle, 'application/zip');
  status('Копия данных скачана. Изменения на сайте уже сохранены в базе.');
});
$('#backupCatalogue').addEventListener('click', () => {
  if (window.cloudConflictBackup) {
    download('catalogue-conflict-backup.json', JSON.stringify(window.cloudConflictBackup, null, 2), 'application/json');
    status('Ваши правки сохранены в резервную копию. Теперь можно перезагрузить страницу и сверить их с актуальным каталогом.'); return;
  }
  if (dirty || siteDirty || saving) { status('Сначала сохраните изменения объекта и информации сайта.', true); return; }
  download('catalogue-backup.json', JSON.stringify({ products, categories, site: siteDraft }, null, 2), 'application/json');
});
function validateCatalogue(value) {
  if (!Array.isArray(value) || value.length > 2000) throw new Error('Ожидается резервная копия каталога (JSON-массив).');
  const safePhoto = (source) => typeof source === 'string' && (source === '' || /^https?:\/\/[^\s]+$/.test(source) || /^(?:img\/)?assets\/[\w./-]+$/.test(source) || /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(source));
  for (const p of value) {
    if (!p || typeof p !== 'object' || !['name','resident','price','specs','description'].every((key) => typeof p[key] === 'string') || !p.name.trim() || !p.resident.trim() || typeof p.type !== 'string' || !p.type.trim() || p.type.length > 80 || p.type === 'all' || !safePhoto(p.photo)) throw new Error('Некорректные поля объекта в резервной копии.');
    if (p.photos !== undefined && (!Array.isArray(p.photos) || p.photos.length > 12 || !p.photos.every(safePhoto))) throw new Error('Некорректные фотографии.');
    if (p.variants !== undefined && (!Array.isArray(p.variants) || !p.variants.every((v) => v && typeof v.size === 'string' && typeof v.price === 'string'))) throw new Error('Некорректные варианты размеров и цен.');
  }
  return value;
}
$('#importCatalogue').addEventListener('change', async (event) => {
  const file = event.target.files[0]; if (!file || saving) return;
  try {
    if (file.size > 150 * 1024 * 1024) throw new Error('Файл слишком большой (максимум 150 МБ).');
    const data = JSON.parse(await file.text());
    const next = validateCatalogue(Array.isArray(data) ? data : data.products);
    const incomingCategories = Array.isArray(data.categories) ? data.categories : [];
    const incomingSite = window.validateSiteContent(data.site || {});
    if (!incomingCategories.every((c) => typeof c === 'string' && c.trim() && c.length <= 80 && c !== 'all')) throw new Error('Некорректные категории.');
    if (!await ask(`Заменить текущий черновик? В резервной копии ${next.length} объектов. Несохранённые изменения будут отменены.`)) return;
    const previous = categories;
    categories = [...new Set(['furniture', 'art', 'light', ...incomingCategories, ...next.map((p) => p.type)])];
    try { await persist(next, incomingSite); } catch (error) { categories = previous; throw error; }
    siteDirty = false;
    window.dispatchEvent(new Event('site-draft-imported'));
    select(-1); $('#fields').disabled = true; $('#editorTitle').textContent = 'Выберите объект';
  } catch (error) { status(error.message, true); } finally { event.target.value = ''; }
});
window.addEventListener('beforeunload', (event) => { if (dirty || siteDirty) { event.preventDefault(); event.returnValue = ''; } });
ready = true; renderCategories(); renderList(); status('Каталог загружен с сервера. Сохранение сразу публикует изменения.');
window.dispatchEvent(new Event('editor-ready'));
