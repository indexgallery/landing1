import { test, mock, after } from 'node:test';
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
const memory = newDb();
mock.module('pg', { defaultExport: memory.adapters.createPg() });
process.env.DATABASE_URL='postgres://test';
process.env.APP_ORIGIN='http://localhost:4173';
process.env.ADMIN_PASSWORD='test-password-long-enough';
process.env.SESSION_SECRET='s'.repeat(64);
process.env.S3_BUCKET='catalog';
process.env.S3_REGION='us-east-1';
process.env.S3_ACCESS_KEY_ID='local-test-key';
process.env.S3_SECRET_ACCESS_KEY='local-test-secret';
process.env.S3_FORCE_PATH_STYLE='true';
const { migrate }=await import('../scripts/migrate.mjs');
const { getPool }=await import('../server/db.mjs');
const { handle }=await import('../server/handler.mjs');
const { validateState }=await import('../server/validation.mjs');
const { authenticated, sessionCookie, requireOrigin }=await import('../server/auth.mjs');
await migrate();
const state={ products:[{name:'Ваза',resident:'Автор',type:'art',price:'По запросу',specs:'40 × 40 см',description:'Описание',photo:''}],categories:['art'],site:{} };
await getPool().query('INSERT INTO catalog_state(id,payload) VALUES(1,$1)',[state]);
const request=(route,method='GET',data,session,origin=process.env.APP_ORIGIN)=>new Request(`http://localhost:4173/api/${route}`,{method,headers:{Origin:origin,'Content-Type':'application/json',...(session?{Cookie:session}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
after(async()=>{await getPool().end();});
test('existing catalogue remains valid and keeps all current objects',async()=>{
  const context={window:{}};vm.runInNewContext(await readFile('catalog-data.js','utf8'),context);
  const input={products:context.window.catalogProducts,categories:[...new Set(context.window.catalogProducts.map(p=>p.type))],site:{}};
  assert.equal(validateState(input).products.length,74);
  assert.throws(()=>validateState({...input,products:[{...state.products[0],photo:'javascript:alert(1)'}]}));
});
test('login, published updates, categories, revision conflict and S3 metadata',async()=>{
  assert.equal((await handle(request('catalogue','PUT',{...state,revision:1}))).status,401);
  assert.equal((await handle(request('session','POST',{password:process.env.ADMIN_PASSWORD},null,'https://evil.example'))).status,403);
  assert.equal((await handle(request('session','POST',{password:'wrong'}))).status,401);
  const login=await handle(request('session','POST',{password:process.env.ADMIN_PASSWORD}));
  assert.equal(login.status,200);const session=login.headers.get('set-cookie').split(';')[0];
  const next={...state,revision:1,categories:['art','Керамика'],site:{coverHeading:'Новый заголовок'},products:[{...state.products[0],type:'Керамика',price:'150 000 ₽',variants:[{size:'400 × 400 мм',price:'88 000 ₽'}]}]};
  const saved=await handle(request('catalogue','PUT',next,session));assert.equal(saved.status,200);
  const current=await(await handle(request('catalogue'))).json();assert.equal(current.products[0].price,'150 000 ₽');assert.equal(current.site.coverHeading,'Новый заголовок');assert.ok(current.categories.includes('Керамика'));assert.equal(current.revision,2);
  assert.equal((await handle(request('catalogue','PUT',next,session))).status,409);
  assert.equal((await handle(request('catalogue','PUT',{...current,products:[{...current.products[0],price:''}]},session))).status,400);
  assert.equal((await handle(request('upload','POST',{type:'image/svg+xml',size:30},session))).status,400);
  assert.equal((await handle(request('upload','POST',{type:'image/png',size:9*1024*1024},session))).status,400);
  // Real AWS signing + HTTP HEAD, with a tiny fake S3 endpoint instead of Docker.
  const s3=http.createServer((req,res)=>{res.writeHead(200,{'content-type':'image/png','content-length':'68'});res.end();});
  await new Promise(resolve=>s3.listen(0,'127.0.0.1',resolve));
  const endpoint=`http://127.0.0.1:${s3.address().port}`;
  process.env.S3_ENDPOINT=endpoint;process.env.S3_PUBLIC_ENDPOINT=endpoint;process.env.S3_PUBLIC_URL=`${endpoint}/catalog`;
  try {
    const ticket=await(await handle(request('upload','POST',{type:'image/png',size:68},session))).json();
    assert.ok(ticket.uploadUrl.includes('X-Amz-Signature='));assert.ok(ticket.uploadUrl.startsWith(endpoint));
    assert.equal(new URL(ticket.uploadUrl).searchParams.has('x-amz-checksum-crc32'),false);
    const completed=await handle(request('upload','POST',{key:ticket.key},session));assert.equal(completed.status,200);
    const {url}=await completed.json();const media=await getPool().query('SELECT * FROM media WHERE url=$1',[url]);assert.equal(media.rows[0].content_type,'image/png');assert.equal(media.rows[0].size_bytes,68);
  } finally {await new Promise(resolve=>s3.close(resolve));}
  assert.equal((await handle(request('session','DELETE',undefined,session))).headers.get('set-cookie').includes('Max-Age=0'),true);
});
test('forged and expired sessions cannot authorize writes',()=>{
  const valid=sessionCookie().split(';')[0];assert.equal(authenticated(new Request('http://localhost',{headers:{cookie:valid}})),true);
  assert.equal(authenticated(new Request('http://localhost',{headers:{cookie:valid+'tampered'}})),false);
  assert.equal(authenticated(new Request('http://localhost',{headers:{cookie:'catalog_session=1.fake'}})),false);
});
test('embedded browser can omit Origin only with a verified same-origin Referer',()=>{
  const check=headers=>requireOrigin(new Request('http://localhost:4173/api/session',{headers}));
  assert.doesNotThrow(()=>check({Referer:'http://localhost:4173/admin.html','Sec-Fetch-Site':'same-origin'}));
  assert.doesNotThrow(()=>check({Origin:'http://localhost:4173'}));
  for(const headers of [{},{Referer:'https://evil.example/admin.html'}, {Origin:'null',Referer:'http://localhost:4173/admin.html'}, {Origin:'https://evil.example',Referer:'http://localhost:4173/admin.html'}, {Origin:'http://localhost:4173','Sec-Fetch-Site':'cross-site'}]) assert.throws(()=>check(headers),{status:403});
});
test('login rate limit is stored in database',async()=>{
  for(let i=0;i<10;i++) assert.equal((await handle(request('session','POST',{password:'wrong'}))).status,401);
  assert.equal((await handle(request('session','POST',{password:'wrong'}))).status,429);
});
