import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { load } from 'cheerio';
import { getPool } from '../server/db.mjs';
import { importImage, initialiseLocalStorage } from '../server/storage.mjs';
import { siteFields, validateState } from '../server/validation.mjs';
const pool = getPool();
try {
  // Serialize initial imports. A repeat start must never overwrite client edits.
  const lock = await pool.connect();
  try {
    await lock.query('SELECT pg_advisory_lock(924716)');
    const exists = await lock.query('SELECT 1 FROM catalog_state WHERE id=1');
    if (exists.rowCount) console.log('Catalogue already exists; import skipped.');
    else {
      await initialiseLocalStorage();
      const context = { window:{} };
      for (const file of ['catalog-data.js','site-data.js']) vm.runInNewContext(await readFile(file,'utf8'), context);
      const state = { products:context.window.catalogProducts, categories: context.window.catalogCategories || ['furniture','art','light'], site: context.window.siteContent || {} };
      state.categories = [...new Set([...state.categories, ...state.products.map(p=>p.type)])];
      const html = load(await readFile('index.html','utf8'));
      const cache = new Map();
      async function image(source) {
        if (!source || /^https?:\/\//.test(source)) return source;
        if (cache.has(source)) return cache.get(source);
        let bytes, type;
        if (source.startsWith('data:image/')) {
          const match=source.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/); if (!match) throw new Error('Invalid embedded image');
          type=match[1]; bytes=Buffer.from(match[2],'base64');
        } else {
          const filename = path.resolve(decodeURIComponent(source.split('?')[0]));
          if (!filename.startsWith(process.cwd()+path.sep)) throw new Error('Image outside project');
          type = {'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp'}[path.extname(filename).toLowerCase()];
          if (!type) throw new Error(`Unsupported image: ${source}`);
          bytes = await readFile(filename);
        }
        const url = await importImage(bytes,type); cache.set(source,url); return url;
      }
      for (const product of state.products) {
        product.photo=await image(product.photo);
        if(product.photos) product.photos=await Promise.all(product.photos.map(image));
      }
      for(const field of siteFields.filter(f=>f.kind==='image')) state.site[field.key]=await image(state.site[field.key] || html(field.selector).attr('src'));
      await lock.query('INSERT INTO catalog_state(id,payload) VALUES(1,$1) ON CONFLICT(id) DO NOTHING', [validateState(state)]);
      console.log(`Imported ${state.products.length} objects and ${cache.size} images. Existing imports are reused.`);
    }
  } finally { await lock.query('SELECT pg_advisory_unlock(924716)'); lock.release(); }
} finally { await pool.end(); }
