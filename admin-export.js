/* Small dependency-free ZIP writer. Files are stored without compression. */
window.buildUpdateFiles = function (products, categories, site) {
  const json = (value) => JSON.stringify(value).replace(/</g, '\\u003c');
  return {
    'catalog-data.js': '/* Edited with Design Index Gallery editor. */\nwindow.catalogCategories = ' + json(categories) + ';\nwindow.catalogProducts = ' + json(products) + ';\n',
    'site-data.js': 'window.siteContent = ' + json(site) + ';\n',
    'README.txt': 'Это снимок данных для разработчика. Актуальные данные сайта находятся в PostgreSQL; замена JS-файлов не обновляет базу. Для восстановления через админку используйте резервную копию JSON. Архив содержит ссылки на фотографии, а не сами файлы.\n',
  };
};
window.createUpdateZip = function (files) {
  const encoder = new TextEncoder();
  const blocks = [], directory = [];
  let offset = 0, directoryLength = 0;
  const crc = (bytes) => {
    let value = 0xffffffff;
    for (const byte of bytes) { value ^= byte; for (let i = 0; i < 8; i++) value = (value >>> 1) ^ (0xedb88320 & -(value & 1)); }
    return (value ^ 0xffffffff) >>> 0;
  };
  for (const [name, text] of Object.entries(files)) {
    const path = encoder.encode(name), data = encoder.encode(text), checksum = crc(data);
    const local = new Uint8Array(30 + path.length), lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x800, true);
    lv.setUint32(14, checksum, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, path.length, true); local.set(path, 30);
    const central = new Uint8Array(46 + path.length), cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x800, true);
    cv.setUint32(16, checksum, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, path.length, true); cv.setUint32(42, offset, true); central.set(path, 46);
    blocks.push(local, data); directory.push(central); offset += local.length + data.length; directoryLength += central.length;
  }
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, directory.length, true); ev.setUint16(10, directory.length, true); ev.setUint32(12, directoryLength, true); ev.setUint32(16, offset, true);
  return new Blob([...blocks, ...directory, end], { type: 'application/zip' });
};
