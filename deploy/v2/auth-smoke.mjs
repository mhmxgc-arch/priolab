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
// Upgrade deletes authorized test reports once and preserves identity/security data.
const upgrade=new DatabaseSync(':memory:');
const migrations=readdirSync(root+'/drizzle').filter(x=>x.endsWith('.sql')).sort();
for(const f of migrations.filter(f=>!f.startsWith('0003')))upgrade.exec(readFileSync(root+'/drizzle/'+f,'utf8').replaceAll('--> statement-breakpoint',''));
upgrade.exec("INSERT INTO settings VALUES ('ip_enforced','1'); INSERT INTO users (id,username,salt,password_hash,totp_secret,role,status,created_at) VALUES ('existing','existing','salt','hash','secret','admin','active',1); INSERT INTO reports (id,description,tax_year,from_month,to_month,filename,rows_json,created_by,updated_at) VALUES ('old','test',2026,1,8,'test.xlsx','[]','existing',1)");
upgrade.exec(readFileSync(root+'/drizzle/'+migrations.find(f=>f.startsWith('0003')),'utf8').replaceAll('--> statement-breakpoint',''));
assert.equal(upgrade.prepare('SELECT COUNT(*) AS n FROM reports').get().n,0);
assert.equal(upgrade.prepare('SELECT COUNT(*) AS n FROM users').get().n,1);
assert.equal(upgrade.prepare("SELECT value FROM settings WHERE key='ip_enforced'").get().value,'1');
assert.equal(upgrade.prepare('SELECT COUNT(*) AS n FROM companies').get().n,1);upgrade.close();
class Statement{constructor(sql,params=[]){this.sql=sql;this.params=params;}bind(...p){return new Statement(this.sql,p)}async first(){return db.prepare(this.sql).get(...this.params)||null}async all(){return {results:db.prepare(this.sql).all(...this.params)}}async run(){const r=db.prepare(this.sql).run(...this.params);return{meta:{changes:Number(r.changes)}}}}
const key=randomBytes(32).toString('base64');
globalThis.__PRIOLAB_ENV={DB:{prepare:sql=>new Statement(sql)},APP_ENCRYPTION_KEY:key};
const api=await import(path.join(temp,'bundle.mjs'));
const originalNow=Date.now;let timestamp=1800000000000;Date.now=()=>timestamp;
const req=(action,data={},cookie='')=>new Request('https://priolab.test/api/secure',{method:'POST',headers:{origin:'https://priolab.test','content-type':'application/json','cf-connecting-ip':'192.0.2.1','oai-authenticated-user-id':'owner',cookie},body:JSON.stringify({action,...data,...(action.startsWith('reports')?{companyId:'company-xpress'}:{})})});
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
// Report management: durable hiding, restoring, replacing, deleting and role checks.
const cookie=success.cookie.split(';')[0];
const get=async(action,c=cookie)=>{const r=await api.GET(new Request('https://priolab.test/api/secure?action='+action+(action.startsWith('reports')?'&companyId=company-xpress':''),{headers:{cookie:c}}));return{status:r.status,data:await r.json()}};
const report={description:'Test report',taxYear:2026,from:1,to:3,filename:'test.xlsx',rows:[{section:'הכנסות',name:'sales',group:'sales',account:'100',amount:100},{section:'עלות המכירות',name:'cost',group:'cost',account:'200',amount:40}]};
assert.equal((await get('reports.manage','')).status,401);
const saved=await call('reports.save',report,cookie);assert.equal(saved.status,200);const id=saved.data.id;
assert.equal((await get('reports')).data.reports.length,1);
let metadata=(await get('reports.manage')).data.reports;assert.equal(metadata[0].rowCount,2);assert.equal(metadata[0].hidden,0);assert.equal(metadata[0].rowsJson,undefined);
// Generic expenses from Priority reports are preserved; unknown sections stay rejected.
const withExpenses={...report,rows:[...report.rows,{section:'הוצאות',name:'insurance',group:'general',account:'300',amount:10}]};
assert.equal((await call('reports.save',withExpenses,cookie)).status,200);
assert.equal((await get('reports')).data.reports[0].rows.find(r=>r.section==='הוצאות').amount,10);
assert.equal((await call('reports.save',{...report,rows:[...report.rows,{section:'unknown',name:'x',amount:1}]},cookie)).status,400);
assert.equal((await call('reports.visibility',{id,hidden:true},cookie)).status,200);
assert.equal((await get('reports')).data.reports.length,0);
assert.equal((await get('reports.manage')).data.reports[0].hidden,1);
assert.equal(db.prepare('SELECT hidden FROM reports WHERE id=?').get(id).hidden,1);
assert.equal((await call('reports.visibility',{id,hidden:'false'},cookie)).status,400);
for(const role of ['viewer','editor']){
 db.prepare("UPDATE users SET role=? WHERE username='admin'").run(role);
 db.prepare("INSERT OR IGNORE INTO company_members (company_id,user_id) SELECT 'company-xpress',id FROM users WHERE username='admin'").run();
 assert.equal((await get('reports.manage')).status,403);
 assert.equal((await call('reports.delete',{id},cookie)).status,403);
 assert.equal((await call('reports.visibility',{id,hidden:false},cookie)).status,403);
 assert.equal((await get('reports')).data.reports.length,0);
}
db.prepare("UPDATE users SET role='admin' WHERE username='admin'").run();
assert.equal((await call('reports.visibility',{id,hidden:false},cookie)).status,200);
assert.equal((await get('reports')).data.reports.length,1);
await call('reports.visibility',{id,hidden:true},cookie);
const replacement=await call('reports.save',{...report,filename:'replacement.xlsx'},cookie);assert.equal(replacement.data.id,id);assert.equal(replacement.data.replaced,true);
assert.equal((await get('reports')).data.reports[0].filename,'replacement.xlsx');
assert.equal((await get('reports.manage')).data.reports[0].hidden,0);
assert.equal((await call('reports.delete',{id},cookie)).status,200);
assert.equal((await get('reports')).data.reports.length,0);assert.equal((await get('reports.manage')).data.reports.length,0);
assert.equal((await call('reports.delete',{id},cookie)).status,404);
// Company isolation covers reads, writes, guessed report IDs, memberships and duplicate periods.
const second=await call('companies.create',{name:'Other company'} ,cookie);assert.equal(second.status,201);const otherId=second.data.id;
const scoped=async(action,data,companyId)=>{const response=await api.POST(new Request('https://priolab.test/api/secure',{method:'POST',headers:{origin:'https://priolab.test','content-type':'application/json',cookie},body:JSON.stringify({action,...data,companyId})}));return{status:response.status,data:await response.json()}};
const scopedGet=async(action,companyId)=>{const response=await api.GET(new Request('https://priolab.test/api/secure?action='+action+(companyId?'&companyId='+companyId:''),{headers:{cookie}}));return{status:response.status,data:await response.json()}};
assert.equal((await call('users.create',{username:'member-test',password:'MemberInitial!29',role:'viewer'},cookie)).status,201);
const memberId=db.prepare("SELECT id FROM users WHERE username='member-test'").get().id;
assert.equal((await scoped('companies.membership',{userId:memberId,enabled:true},otherId)).status,200);
assert.equal((await scopedGet('companies.members',otherId)).data.members[0].userId,memberId);
assert.equal((await scoped('companies.membership',{userId:memberId,enabled:false},otherId)).status,200);
assert.equal((await scopedGet('companies.members',otherId)).data.members.length,0);

assert.equal((await scopedGet('reports','')).status,403);
const a=await scoped('reports.save',report,'company-xpress'), b=await scoped('reports.save',report,otherId);assert.equal(a.status,200);assert.equal(b.status,200);assert.notEqual(a.data.id,b.data.id);
assert.equal((await scoped('reports.delete',{id:a.data.id},otherId)).status,404);
assert.equal((await scoped('reports.visibility',{id:a.data.id,hidden:true},otherId)).status,404);
assert.equal((await scopedGet('reports',otherId)).data.reports.length,1);
assert.equal((await scopedGet('reports','company-xpress')).data.reports[0].id,a.data.id);
assert.equal((await scoped('reports.save',{...report,moduleKey:'balance'},otherId)).status,400);
db.prepare("UPDATE users SET role='editor' WHERE username='admin'").run();
assert.equal((await get('companies')).data.companies.length,1);
assert.equal((await scopedGet('reports',otherId)).status,403);
assert.equal((await scoped('reports.save',report,otherId)).status,403);
assert.equal((await scoped('reports.delete',{id:b.data.id},otherId)).status,403);
assert.equal((await call('companies.create',{name:'Forbidden'},cookie)).status,403);
assert.equal((await scoped('companies.membership',{userId:'x',enabled:true},otherId)).status,403);
db.prepare("DELETE FROM company_members WHERE user_id=(SELECT id FROM users WHERE username='admin')").run();
assert.equal((await scopedGet('reports','company-xpress')).status,403);
db.prepare("UPDATE users SET role='admin' WHERE username='admin'").run();
await scoped('reports.delete',{id:a.data.id},'company-xpress');await scoped('reports.delete',{id:b.data.id},otherId);
// Recovery is local-only and invalidates old admin sessions without touching reports.
db.prepare('INSERT INTO reports (id,company_id,module_key,description,tax_year,from_month,to_month,filename,rows_json,created_by,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run('report','company-xpress','pnl','test',2026,1,2,'test.xlsx','[]','admin',timestamp);
const recovery=spawnSync(process.execPath,[path.join(scriptDir,'bootstrap-admin.mjs'),'--recover'],{input:'RecoveryInitial!29',encoding:'utf8',env:{...process.env,APP_ENCRYPTION_KEY:key,PRIOLAB_DB_PATH:file}});
assert.equal(recovery.status,0,recovery.stderr);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reports').get().n,1);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM login_attempts').get().n,0);
assert.equal((await call('login',{username:'admin',password:'RecoveryInitial!29'})).data.changeRequired,true);
Date.now=originalNow;db.close();rmSync(temp,{recursive:true,force:true});console.log('PASS: first login, password policy, RFC TOTP, invalid OTP, timed lock, unlock, admin session, replay rejection, report lifecycle, role permissions, company boundaries, membership grants/revocation, authorized test-data migration and local recovery.');

