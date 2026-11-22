// Manual UI verification helper. Never used by Compose or the deployment.
import { mock } from 'node:test';
import { newDb } from 'pg-mem';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
if(process.env.CATALOG_UI_FIXTURE!=='1') throw new Error('Set CATALOG_UI_FIXTURE=1 for this isolated in-memory UI fixture.');
const memory=newDb();mock.module('pg',{defaultExport:memory.adapters.createPg()});
process.env.DATABASE_URL='postgres://fixture';process.env.APP_ORIGIN='http://localhost:4184';process.env.PORT='4184';
process.env.ADMIN_PASSWORD='fixture-only-password';process.env.SESSION_SECRET='fixture-secret'.repeat(4);
const {migrate}=await import('../scripts/migrate.mjs');await migrate();
const {getPool}=await import('../server/db.mjs');
const context={window:{}};for(const file of ['catalog-data.js','site-data.js'])vm.runInNewContext(await readFile(file,'utf8'),context);
await getPool().query('INSERT INTO catalog_state(id,payload) VALUES(1,$1)',[{products:context.window.catalogProducts,categories:['furniture','art','light'],site:context.window.siteContent}]);
await import('../server/local.mjs');
