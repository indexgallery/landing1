'use strict';
const siteForm = document.querySelector('#siteForm');
const siteFrame = document.querySelector('#sitePreview');
let siteInitialised = false;
let previewDefaults = {};
function readSiteField(doc, field) {
  const element = doc.querySelector(field.selector);
  if (!element) throw new Error(`Не найден раздел: ${field.group}, ${field.label}`);
  if (field.kind === 'url') return element.getAttribute('href');
  if (field.kind === 'image') return element.getAttribute('src');
  if (field.kind === 'list') return [...element.children].map((li) => li.textContent).join('\n');
  const clone = element.cloneNode(true);
  clone.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  return clone.textContent.trim();
}
function collectSiteForm() {
  const next = { ...siteDraft };
  siteForm.querySelectorAll('[data-site-field]').forEach((input) => {
    if (input.value !== previewDefaults[input.dataset.siteField]) next[input.dataset.siteField] = input.value;
    else delete next[input.dataset.siteField];
  });
  return next;
}
function previewSiteChanges() {
  try {
    const next = window.validateSiteContent(collectSiteForm());
    window.applySiteContent(siteFrame.contentDocument, { ...previewDefaults, ...next });
  } catch { /* Validation errors are shown on save. Keep the last valid preview. */ }
}
function initSiteEditor() {
  if (!ready || siteInitialised || !siteFrame.contentDocument?.querySelector('#cover')) return;
  siteInitialised = true;
  const groups = new Map();
  for (const field of window.siteFields) {
    previewDefaults[field.key] = readSiteField(siteFrame.contentDocument, field);
    let group = groups.get(field.group);
    if (!group) {
      group = document.createElement('details'); group.open = field.group === 'Главная';
      const title = document.createElement('summary'); title.textContent = field.group; group.append(title);
      groups.set(field.group, group); siteForm.querySelector('#siteFieldGroups').append(group);
    }
    const label = document.createElement('label'); label.textContent = field.label;
    const input = document.createElement(['text','list'].includes(field.kind) ? 'textarea' : 'input');
    input.dataset.siteField = field.key; input.value = siteDraft[field.key] ?? previewDefaults[field.key];
    if (input.tagName === 'TEXTAREA') input.rows = 3;
    if (field.kind === 'image') {
      input.type = 'hidden';
      const photo = document.createElement('img'); photo.src = input.value; photo.alt = field.label; photo.className = 'site-photo';
      const file = document.createElement('input'); file.type = 'file'; file.accept = 'image/jpeg,image/png,image/webp';
      file.addEventListener('change', async () => {
        const image = file.files[0]; if (!image) return;
        if (saving) return;
        saving = true;
        try {
          if (!['image/jpeg','image/png','image/webp'].includes(image.type) || image.size > 8 * 1024 * 1024) throw new Error('Используйте JPG, PNG или WebP до 8 МБ.');
          input.value = await window.cloudStore.uploadImage(image);
          photo.src = input.value; siteDirty = true; previewSiteChanges();
        } catch (error) { status(error.message, true); }
        finally { saving = false; file.value = ''; }
      });
      label.append(photo, file);
    }
    label.append(input); group.append(label);
  }
  previewSiteChanges();
}
window.addEventListener('editor-ready', initSiteEditor);
window.addEventListener('site-draft-imported', () => {
  siteForm.querySelectorAll('[data-site-field]').forEach((input) => {
    input.value = siteDraft[input.dataset.siteField] ?? previewDefaults[input.dataset.siteField];
    const image = input.closest('label').querySelector('.site-photo');
    if (image) image.src = input.value;
  });
  previewSiteChanges();
});
siteFrame.addEventListener('load', initSiteEditor);
siteForm.addEventListener('input', () => { siteDirty = true; previewSiteChanges(); });
siteForm.addEventListener('submit', async (event) => {
  event.preventDefault(); if (saving) return;
  if (!siteInitialised) { status('Предпросмотр ещё загружается. Откройте редактор через http://localhost:4173/admin.html и дождитесь загрузки.', true); return; }
  saving = true;
  try { const next = window.validateSiteContent(collectSiteForm()); await persist(products, next); siteDirty = false; status('Информация сайта сохранена и опубликована.'); }
  catch (error) { status(error.message, true); }
  finally { saving = false; }
});
for (const [buttonId, panelId] of [['objectsTab','catalogueEditor'], ['siteTab','siteEditor']]) {
  document.querySelector(`#${buttonId}`).addEventListener('click', () => {
    for (const id of ['catalogueEditor','siteEditor']) document.querySelector(`#${id}`).hidden = id !== panelId;
    document.querySelector('#objectsTab').setAttribute('aria-pressed', String(panelId === 'catalogueEditor'));
    document.querySelector('#siteTab').setAttribute('aria-pressed', String(panelId === 'siteEditor'));
    if (panelId === 'siteEditor') initSiteEditor();
  });
}
initSiteEditor();
