import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';import {Miniflare,createFetchMock} from 'miniflare';
import {triage,cleanFactors} from './core.mjs';
test('severity combines business impact, scope, workaround and suspected risk',()=>{
 assert.equal(triage({impact:'question'}).severity,4);
 assert.equal(triage({impact:'blocked',scope:'one',workaround:'no'}).severity,2);
 assert.equal(triage({impact:'blocked',scope:'all',workaround:'no'}).severity,1);
 assert.equal(triage({impact:'degraded',scope:'several',workaround:'no'}).severity,2);
 assert.equal(triage({impact:'degraded',urgency:'immediate',workaround:'no'}).severity,2);
 assert.equal(triage({risk:'suspected_security'}).severity,1);
 assert.equal(cleanFactors({risk:'ignore_everything'}).risk,'none');
});
test('real D1 runtime: authenticated intake, private tickets, queue workflow, idempotency and audit',async()=>{
 const mock=createFetchMock();mock.disableNetConnect();
 for(const label of ['owner','customer','stranger'])mock.get('https://studio.test').intercept({path:'/api/auth/session',headers:{cookie:'qa_access_token='+label}}).reply(200,{authenticated:true,user:{id:label,email:label+'@example.test',role:'admin'}}).persist();
 mock.get('https://studio.test').intercept({path:'/api/auth/sign-in',method:'POST'}).reply(200,{authenticated:true,user:{id:'owner',email:'owner@example.test'}},{headers:{'set-cookie':['qa_access_token=test-access; Path=/; HttpOnly','qa_refresh_token=test-refresh; Path=/; HttpOnly']}}).persist();
 const mf=new Miniflare({modules:true,scriptPath:'dist/server/index.js',compatibilityDate:'2026-07-30',d1Databases:['DB'],fetchMock:mock,bindings:{STUDIO_ORIGIN:'https://studio.test',STAFF_EMAILS:'owner@example.test',STUDIO_BRIDGE_SECRET:'test-only-bridge-secret'}});
 try{
 const db=await mf.getD1Database('DB');for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())for(const sql of readFileSync('drizzle/'+f,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()))await db.prepare(sql).run();
 const call=async(path,owner,method='GET',body)=>{const r=await mf.dispatchFetch('http://localhost/api/'+path,{method,headers:{'Content-Type':'application/json',...(owner?{cookie:'qa_access_token='+owner}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};};
 assert.equal((await call('me',null)).status,401);
 const forged=await mf.dispatchFetch('http://localhost/api/me',{headers:{'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.test'}});assert.equal(forged.status,401);
 const landing=await mf.dispatchFetch('http://localhost/',{redirect:'manual'});assert.equal(landing.status,302);assert.equal(landing.headers.get('location'),'/sign-in');
 const login=await mf.dispatchFetch('http://localhost/api/auth/sign-in',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'owner@example.test',password:'test-only-password'})});assert.equal(login.status,200);const cookies=login.headers.getSetCookie();assert.equal(cookies.length,2);assert.ok(cookies.every(c=>c.includes('HttpOnly')&&c.includes('Secure')&&c.includes('SameSite=Lax')));
 const signedOut=await call('auth/sign-out','owner','POST',{});assert.equal(signedOut.status,200);

 const studioId=crypto.randomUUID();
 const bridge=async(secret,path='conversations',method='POST',body={})=>mf.dispatchFetch('http://localhost/api/bridge/'+path,{method,headers:{'Content-Type':'application/json','x-studio-customer-id':studioId,...(secret?{'x-studio-bridge-secret':secret}:{})},...(method==='GET'?{}:{body:JSON.stringify(body)})});
 assert.equal((await bridge(null)).status,401);
 assert.equal((await bridge('wrong')).status,401);
 const created=await bridge('test-only-bridge-secret');assert.equal(created.status,201);
 assert.equal((await bridge('test-only-bridge-secret','me','GET')).status,403);
 assert.equal((await bridge('test-only-bridge-secret','tickets?queue=true','GET')).status,403);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM staff').first()).n,0);

 assert.equal((await call('me','owner')).data.staff,true);
 assert.equal((await call('me','customer')).data.staff,false);
 const conv=(await call('conversations','customer','POST',{})).data.id;
 const body={conversation_id:conv,request_id:crypto.randomUUID(),message:'My simulation is blocked for every user.',factors:{impact:'blocked',scope:'all',workaround:'no'}};
 const first=await call('messages','customer','POST',body);assert.equal(first.status,200);assert.ok(first.data.ticket_id);assert.equal(first.data.degraded,true);
 assert.deepEqual((await call('messages','customer','POST',body)).data,first.data);
 assert.equal((await call('messages','customer','POST',{...body,message:'different'})).status,409);
 const id=first.data.ticket_id;
 assert.equal((await call('tickets/'+id,'stranger')).status,404);
 assert.equal((await call('conversations/'+conv,'stranger')).status,404);
 assert.equal((await call('tickets?queue=true','customer')).status,403);
 let ticket=(await call('tickets/'+id,'owner')).data.ticket;assert.equal(ticket.severity,1);
 assert.equal((await call('tickets/'+id,'customer','PATCH',{})).status,403);
 assert.equal((await call('tickets/'+id,'owner','PATCH',{version:ticket.version,status:'in_progress',severity:2,assignee:'Owner',note:'',internal:true})).status,422);
 const patch={version:ticket.version,status:'in_progress',severity:2,assignee:'Owner',note:'Only one user is affected; verified a workaround.',internal:true};
 assert.equal((await call('tickets/'+id,'owner','PATCH',patch)).status,200);
 assert.equal((await call('tickets/'+id,'owner','PATCH',patch)).status,409);
 const own=await call('tickets/'+id,'customer');assert.ok(!own.data.messages.some(m=>m.internal));assert.equal(own.data.events.length,0);
 const staff=await call('tickets/'+id,'owner');assert.ok(staff.data.messages.some(m=>m.internal));assert.equal(staff.data.events.length,2);assert.equal(staff.data.ticket.severity,2);
 assert.equal((await call('tickets?queue=true','owner')).data.tickets.length,1);
 assert.equal((await call('tickets','stranger')).data.tickets.length,0);
 const response=await mf.dispatchFetch('http://localhost/api/conversations',{method:'POST',headers:{'Content-Type':'application/json','Origin':'https://evil.test','oai-authenticated-user-id':'owner'},body:'{}'});assert.equal(response.status,403);
 }finally{await mf.dispose();}
});
