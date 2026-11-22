'use strict';
window.siteFields = [
  ['coverHeading', 'Главная', 'Заголовок', '#cover-title', 'text'],
  ['coverIntro', 'Главная', 'Описание галереи', '.cover-intro', 'text'],
  ['coverDate', 'Главная', 'Город и год', '.cover .eyebrow', 'text'],
  ['coverImage', 'Главная', 'Обложка', '.cover-image', 'image'],
  ['aboutHeading', 'О галерее', 'Заголовок', '#about-title', 'text'],
  ['aboutDescription', 'О галерее', 'Описание', '.about-copy > p', 'text'],
  ['aboutImage', 'О галерее', 'Фотография', '.about-image img', 'image'],
  ['aboutCaption', 'О галерее', 'Подпись к фото', '.about-image figcaption', 'text'],
  ['collectionHeading', 'Коллекция', 'Заголовок', '#catalogue-title', 'text'],
  ['collectionIntro', 'Коллекция', 'Подсказка', '.catalogue-head > p', 'text'],
  ['focusHeading', 'В фокусе', 'Заголовок', '.feature-copy blockquote', 'text'],
  ['focusIntro', 'В фокусе', 'Описание', '.feature-lead', 'text'],
  ['focusList', 'В фокусе', 'Пункты — каждый с новой строки', '.feature-list', 'list'],
  ['focusImage', 'В фокусе', 'Фотография', '.feature-image img', 'image'],
  ['serviceHeading', 'Сервис', 'Заголовок', '#collaboration-title', 'text'],
  ['serviceIntro', 'Сервис', 'Описание', '.collab-title > p:last-child', 'text'],
  ...Array.from({ length: 8 }, (_, i) => [
    [`serviceTitle${i}`, 'Сервис', `Услуга ${i + 1}: название`, `.services li:nth-child(${i + 1}) h3${i === 7 ? ' a' : ''}`, 'text'],
    [`serviceText${i}`, 'Сервис', `Услуга ${i + 1}: описание`, `.services li:nth-child(${i + 1}) p`, 'text'],
  ]).flat(),
  ['customHeading', 'Заказная мебель', 'Заголовок', '#custom-furniture-title', 'text'],
  ['customText', 'Заказная мебель', 'Описание', '.custom-furniture-copy > p:last-child', 'text'],
  ['customImage', 'Заказная мебель', 'Фотография кухни', '.custom-furniture img', 'image'],
  ['address', 'Контакты', 'Адрес (также на главной)', '.cover-address, .contact-list > div:first-child a', 'text'],
  ['contactImage', 'Контакты', 'Фотография', '.contact-image', 'image'],
  ['mapUrl', 'Контакты', 'Ссылка на карту', '.cover-address, .contact-list > div:first-child a', 'url'],
  ['managerPhone', 'Контакты', 'Телефон менеджера', '#managerPhone .manager-number', 'phone'],
  ['managerLabel', 'Контакты', 'Подпись менеджера', '.manager-label', 'text'],
  ['phone2', 'Контакты', 'Второй телефон', '.contact-phones > a:nth-of-type(2)', 'phone'],
  ['phone3', 'Контакты', 'Третий телефон', '.contact-phones > a:nth-of-type(3)', 'phone'],
  ['email', 'Контакты', 'Электронная почта', '.contact-list a[href^="mailto:"]', 'email'],
  ['channelLabel', 'Контакты', 'Подпись канала', '.contact-list > div:last-child > span', 'text'],
  ['channelName', 'Контакты', 'Название канала', '.contact-list > div:last-child a', 'text'],
  ['channelUrl', 'Контакты', 'Ссылка на канал', '.contact-list > div:last-child a', 'url'],
  ['managerTelegram', 'Контакты', 'Telegram кнопки «Связаться»', '.contact-cta', 'url'],
].map(([key, group, label, selector, kind]) => ({ key, group, label, selector, kind }));
window.validateSiteContent = function (value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Некорректные настройки сайта.');
  const result = {};
  for (const field of window.siteFields) {
    if (!Object.hasOwn(value, field.key)) continue;
    const text = value[field.key];
    if (typeof text !== 'string' || text.length > (field.kind === 'image' ? 12 * 1024 * 1024 : 20000)) throw new Error(`${field.label}: неверное значение.`);
    if (field.kind === 'url' && !/^https?:\/\/[^\s]+$/i.test(text)) throw new Error(`${field.label}: укажите ссылку, начинающуюся с https://.`);
    if (field.kind === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) throw new Error('Укажите корректный адрес электронной почты.');
    if (field.kind === 'phone' && !/^\+?[\d ()-]{7,25}$/.test(text)) throw new Error(`${field.label}: укажите телефон цифрами.`);
    if (field.kind === 'image' && !/^(?:https?:\/\/[^\s]+|(?:img\/)?assets\/[^\r\n]+|img\/[^\r\n]+|data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+)$/.test(text)) throw new Error(`${field.label}: загрузите JPG, PNG или WebP.`);
    result[field.key] = text;
  }
  return result;
};
window.applySiteContent = function (doc, content) {
  for (const field of window.siteFields) {
    if (!Object.hasOwn(content, field.key)) continue;
    const value = content[field.key];
    for (const element of doc.querySelectorAll(field.selector)) {
      if (field.kind === 'url') element.setAttribute('href', value);
      else if (field.kind === 'image') element.setAttribute('src', value);
      else if (field.kind === 'list') {
        element.replaceChildren(...value.split('\n').filter((line) => line.trim()).map((line) => { const li = doc.createElement('li'); li.textContent = line; return li; }));
      } else if (field.kind === 'phone') {
        element.textContent = value;
        (element.closest('a') || element).setAttribute('href', `tel:${value.replace(/[^\d+]/g, '')}`);
      } else if (field.kind === 'email') {
        element.textContent = value; element.setAttribute('href', `mailto:${value}`);
      } else {
        element.replaceChildren(...value.split('\n').flatMap((line, i) => i ? [doc.createElement('br'), doc.createTextNode(line)] : [doc.createTextNode(line)]));
      }
    }
  }
};
if (document.querySelector('#cover')) {
  try { window.applySiteContent(document, window.validateSiteContent(window.siteContent || {})); }
  catch (error) { console.error('Не удалось применить настройки сайта:', error); }
}
