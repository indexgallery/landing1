import { mkdir, cp, rm, readdir } from 'node:fs/promises';
import { build } from 'esbuild';
await rm('public', { recursive:true, force:true });
await mkdir('public');
// Only publish frontend files. Never serve the repository, server code or .env.
for (const name of await readdir('.')) {
  if (/\.(html|css)$/.test(name) || ['app.js','admin.js','admin-site.js','admin-export.js','site-content.js','site-data.js','ADMIN-GUIDE.md'].includes(name) || /\.pdf$/i.test(name)) await cp(name, `public/${name}`);
}
// img/ is deliberately excluded from Git. A deployed, seeded site uses S3 URLs.
try { await cp('img', 'public/img', { recursive:true }); }
catch (error) { if (error.code !== 'ENOENT') throw error; console.log('No local img/ directory; images will load from object storage.'); }
await build({ entryPoints:['client/cloud-store.js'], bundle:true, format:'iife', target:['es2022'], outfile:'public/cloud-store.js', minify:true });
console.log('Frontend built in public/');
