import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { newDb, DataType } from 'pg-mem';
import http from 'node:http';
const db=newDb();
for(const name of ['pg_advisory_lock','pg_advisory_unlock']) db.public.registerFunction({name,args:[DataType.integer],returns:DataType.integer,implementation:()=>1});
mock.module('pg',{defaultExport:db.adapters.createPg()});
process.env.DATABASE_URL='postgres://seed-test';
process.env.S3_REGION='us-east-1';process.env.S3_BUCKET='catalog';process.env.S3_ACCESS_KEY_ID='test';process.env.S3_SECRET_ACCESS_KEY='test-secret';process.env.S3_FORCE_PATH_STYLE='true';
process.env.STORAGE_DRIVER='s3';
const {getPool,readState}=await import('../server/db.mjs');
const {migrate}=await import('../scripts/migrate.mjs');
test('initial import finds all source photos and repeated import preserves editor changes',async()=>{
  let uploads=0;
  const server=http.createServer((req,res)=>{req.resume();req.on('end',()=>{uploads++;res.writeHead(200,{ETag:'"test"'});res.end();});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  process.env.S3_ENDPOINT=`http://127.0.0.1:${server.address().port}`;
  process.env.S3_PUBLIC_URL=process.env.S3_ENDPOINT+'/catalog';
  try{
    await migrate();
    await import('../scripts/seed.mjs?initial');
    const first=await readState();assert.equal(first.products.length,74);assert.ok(uploads>=74);
    assert.ok(first.products.every(p=>p.photo.startsWith(process.env.S3_PUBLIC_URL)));
    assert.ok(first.site.coverImage.startsWith(process.env.S3_PUBLIC_URL));
    const uploaded=uploads;
    await getPool().query('UPDATE catalog_state SET payload=$1 WHERE id=1',[{...first,site:{...first.site,coverHeading:'Client edit'}}]);
    await import('../scripts/seed.mjs?repeat');
    assert.equal((await readState()).site.coverHeading,'Client edit');assert.equal(uploads,uploaded);
  }finally{await new Promise(resolve=>server.close(resolve));await getPool().end();}
});
