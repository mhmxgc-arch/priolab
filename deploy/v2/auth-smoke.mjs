import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
// Run after installing sites-secure dependencies: node deploy/v2/auth-smoke.mjs [source-directory]
const root=path.resolve(process.argv[2] || 'sites-secure');
const temp=mkdtempSync(path.join(tmpdir(),'priolab-auth-test-'));
const scriptDir=path.dirname(fileURLToPath(import.meta.url));
const esdir=readdirSync(root+'/node_modules/.pnpm').find(x=>/^esbuild@/.test(x));
const {build}=await import(root+'/node_modules/.pnpm/'+esdir+'/node_modules/esbuild/lib/main.js');
writeFileSync(path.join(temp,'entry.ts'),`export {GET, POST} from '${root}/app/api/secure/route.ts'; export * from '${root}/lib/security.ts'; export * from '${root}/lib/auth-policy.ts';`);
await build({entryPoints:[path.join(temp,'entry.ts')],outfile:path.join(temp,'bundle.mjs'),bundle:true,platform:'node',format:'esm',alias:{'@':root},plugins:[{name:'test-env',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'test-env',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const env = globalThis.__PRIOLAB_ENV;'}));}}]});
const file=path.join(temp,'test.sqlite');
const db=new DatabaseSync(file);
for(const f of readdirSync(root+'/drizzle').filter(x=>x.endsWith('.sql')).sort())db.exec(readFileSync(root+'/drizzle/'+f,'utf8').replaceAll('--> statement-breakpoint',''));
class Statement{constructor(sql,params=[]){this.sql=sql;this.params=params;}bind(...p){return new Statement(this.sql,p)}async first(){return db.prepare(this.sql).get(...this.params)||null}async all(){return {results:db.prepare(this.sql).all(...this.params)}}async run(){const r=db.prepare(this.sql).run(...this.params);return{meta:{changes:Number(r.changes)}}}}
const key=randomBytes(32).toString('base64');
globalThis.__PRIOLAB_ENV={DB:{prepare:sql=>new Statement(sql)},APP_ENCRYPTION_KEY:key};
const api=await import(path.join(temp,'bundle.mjs'));
const originalNow=Date.now;let timestamp=1800000000000;Date.now=()=>timestamp;
const req=(action,data={},cookie='')=>new Request('https://priolab.test/api/secure',{method:'POST',headers:{origin:'https://priolab.test','content-type':'application/json','cf-connecting-ip':'192.0.2.1','oai-authenticated-user-id':'owner',cookie},body:JSON.stringify({action,...data})});
const call=async(action,data,cookie)=>{const response=await api.POST(req(action,data,cookie));return{status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie'),retry:response.headers.get('retry-after')}};
const credentials={username:'admin',password:'TestInitial!27'};
assert.equal((await call('bootstrap',credentials)).data.changeRequired,true);
assert.equal((await call('login',credentials)).data.changeRequired,true);
assert.equal((await call('password.change',{...credentials,newPassword:'weak'})).status,400);
const enrollment=await call('password.change',{...credentials,newPassword:'TestReplacement!28'});assert.equal(enrollment.data.enroll,true);
credentials.password='TestReplacement!28';
assert.equal((await call('login',credentials)).data.enroll,true);
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function code(secret,time=timestamp){let bits=0,buffer=0,bytes=[];for(const c of secret){buffer=(buffer<<5)|alphabet.indexOf(c);bits+=5;if(bits>=8){bits-=8;bytes.push((buffer>>>bits)&255)}}const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(time/30000)));const h=createHmac('sha1',Buffer.from(bytes)).update(counter).digest();const offset=h[19]&15;return String((h.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0')}
// Independent RFC 6238 vector confirms the app's TOTP calculation.
Date.now=()=>59000;assert.equal(await api.verifyTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ','287082',-1),1);Date.now=()=>timestamp;
const secret=enrollment.data.secret;const good=code(secret);const wrong=String((Number(good)+500000)%1000000).padStart(6,'0');
for(let i=0;i<4;i++)assert.equal((await call('enroll',{...credentials,otp:wrong})).status,401);
const lock=await call('enroll',{...credentials,otp:wrong});assert.equal(lock.status,429);assert.equal(lock.data.retryAfter,api.LOGIN_LOCKOUT_MS/1000);assert.equal(lock.retry,String(api.LOGIN_LOCKOUT_MS/1000));
assert.equal((await call('enroll',{...credentials,otp:good})).status,429);
timestamp+=api.LOGIN_LOCKOUT_MS-1;assert.equal((await call('enroll',{...credentials,otp:code(secret)})).data.retryAfter,1);
timestamp+=1;const success=await call('enroll',{...credentials,otp:code(secret)});assert.equal(success.data.user.role,'admin');assert.match(success.cookie,/HttpOnly/);
const status=await api.GET(new Request('https://priolab.test/api/secure?action=status',{headers:{cookie:success.cookie.split(';')[0]}}));assert.equal((await status.json()).authenticated,true);
assert.equal((await call('login',credentials)).data.otpRequired,true);
assert.equal((await call('login',{...credentials,otp:code(secret)})).status,401);
// Recovery is local-only and invalidates old admin sessions without touching reports.
db.prepare('INSERT INTO reports VALUES (?,?,?,?,?,?,?,?,?)').run('report','test',2026,1,2,'test.xlsx','[]','admin',timestamp);
const recovery=spawnSync(process.execPath,[path.join(scriptDir,'bootstrap-admin.mjs'),'--recover'],{input:'RecoveryInitial!29',encoding:'utf8',env:{...process.env,APP_ENCRYPTION_KEY:key,PRIOLAB_DB_PATH:file}});
assert.equal(recovery.status,0,recovery.stderr);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reports').get().n,1);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM login_attempts').get().n,0);
assert.equal((await call('login',{username:'admin',password:'RecoveryInitial!29'})).data.changeRequired,true);
Date.now=originalNow;db.close();rmSync(temp,{recursive:true,force:true});console.log('PASS: first login, password policy, RFC TOTP, invalid OTP, timed lock, unlock, admin session, replay rejection and local recovery.');
