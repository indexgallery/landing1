import { spawn } from 'node:child_process';
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { randomBytes } from 'node:crypto';
const args=process.argv.slice(2);
const origin=args[args.indexOf('--origin')+1];
const scope=args.includes('--scope') ? args[args.indexOf('--scope')+1] : undefined;
if (!args.includes('--origin') || !origin || new URL(origin).protocol!=='https:') throw new Error('Usage: npm run vercel:setup -- --origin https://YOUR-DOMAIN [--scope TEAM] [--deploy]');
function run(command, args, input) {
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{stdio:[input===undefined?'inherit':'pipe','inherit','inherit']});
    if(input!==undefined) child.stdin.end(input);
    child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`${command} failed (${code}). Check the preceding output before restarting.`)));
  });
}
const vc=(args,input)=>run('npx',['--yes','vercel',...args,...(scope?['--scope',scope]:[])],input);
await vc(['whoami']); // If unauthenticated, run npx vercel login first.
try { await readFile('.vercel/project.json'); } catch { await vc(['link']); }
let checkpoint={};
try { checkpoint=JSON.parse(await readFile('.vercel/catalog-setup.json','utf8')); } catch { /* First run. */ }
async function pull() {
  await vc(['env','pull','.env.vercel.local','--environment','production','--yes']);
  await chmod('.env.vercel.local',0o600);
  return parseEnv(await readFile('.env.vercel.local','utf8'));
}
async function provisionOnce(key,command) {
  if(checkpoint[key]) throw new Error(`A previous ${key} provisioning was attempted. Inspect Vercel Storage and connect that resource to this project's production environment, then rerun. A second resource was NOT created.`);
  checkpoint[key]='attempted';await writeFile('.vercel/catalog-setup.json',JSON.stringify(checkpoint));
  await vc(command);
}
let env=await pull();
if(!env.DATABASE_URL && !env.POSTGRES_URL) {
  await provisionOnce('neon',['integration','add','neon','--environment','production','--no-env-pull']);env=await pull();
}
if(!env.DATABASE_URL && env.POSTGRES_URL) { await vc(['env','add','DATABASE_URL','production'],env.POSTGRES_URL);env=await pull(); }
if(!env.BLOB_READ_WRITE_TOKEN && !env.BLOB_STORE_ID) {
  await provisionOnce('blob',['blob','create-store','catalog-images','--access','public','--environment','production','--yes']);env=await pull();
}
// Use a stable token for the off-platform initial import. An OIDC-only store
// needs a read/write token added in Vercel before continuing this script.
if(!env.BLOB_READ_WRITE_TOKEN) throw new Error('Add BLOB_READ_WRITE_TOKEN in Vercel production settings, then rerun. The Blob store has already been created.');
for(const [key,value] of Object.entries({APP_ORIGIN:new URL(origin).origin,STORAGE_DRIVER:'blob',ADMIN_PASSWORD:randomBytes(18).toString('base64url'),SESSION_SECRET:randomBytes(32).toString('hex')})) {
  if(env[key] && ['APP_ORIGIN','STORAGE_DRIVER'].includes(key) && env[key]!==value) throw new Error(`${key} is already configured differently. Update it in Vercel settings and rerun.`);
  if(!env[key]) await vc(['env','add',key,'production'],value);
}
env=await pull();
for(const key of ['DATABASE_URL','BLOB_READ_WRITE_TOKEN','APP_ORIGIN','ADMIN_PASSWORD','SESSION_SECRET']) if(!env[key]) throw new Error(`Missing ${key}`);
await run(process.execPath,['--env-file=.env.vercel.local','scripts/migrate.mjs']);
await run(process.execPath,['--env-file=.env.vercel.local','scripts/seed.mjs']);
console.log('Cloud data ready. ADMIN_PASSWORD is in .env.vercel.local; do not commit or share that file.');
if(args.includes('--deploy')) await vc(['--prod']);
else console.log('To deploy, run npx vercel --prod in the same scope.');
