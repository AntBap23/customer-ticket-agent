import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';import {Miniflare,createFetchMock} from 'miniflare';
import {triage,cleanFactors} from './core.mjs';
import {generateKeyPair,SignJWT,exportJWK} from 'jose';
test('severity combines business impact, scope, workaround and suspected risk',()=>{
 assert.equal(triage({impact:'question'}).severity,4);
 assert.equal(triage({impact:'blocked',scope:'one',workaround:'no'}).severity,2);
 assert.equal(triage({impact:'blocked',scope:'all',workaround:'no'}).severity,1);
 assert.equal(triage({impact:'degraded',scope:'several',workaround:'no'}).severity,2);
 assert.equal(triage({impact:'degraded',urgency:'immediate',workaround:'no'}).severity,2);
 assert.equal(triage({risk:'suspected_security'}).severity,1);
 assert.equal(cleanFactors({risk:'ignore_everything'}).risk,'none');
});
test('independent staff identity, isolated customer bridge, D1 workflow and audit',async()=>{
 const {privateKey,publicKey}=await generateKeyPair('RS256');
 const jwk={...await exportJWK(publicKey),kid:'test-support-key'};
 const issue=async(email,aud='support-test')=>new SignJWT({email}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer('https://support-auth.test').setAudience(aud).setSubject('staff-subject').setIssuedAt().setExpirationTime('1h').sign(privateKey);
 const ownerToken=await issue('owner@example.test');
 const outsiderToken=await issue('researcher@example.test');
 const wrongAudience=await issue('owner@example.test','research-app');
 const mock=createFetchMock();mock.disableNetConnect();
 mock.get('https://support-auth.test').intercept({path:'/cdn-cgi/access/certs'}).reply(200,{keys:[jwk]}).persist();
 const mf=new Miniflare({modules:true,scriptPath:'dist/server/index.js',compatibilityDate:'2026-07-30',d1Databases:['DB'],fetchMock:mock,bindings:{SUPPORT_AUTH_DOMAIN:'support-auth.test',SUPPORT_ACCESS_AUD:'support-test',STAFF_EMAILS:'owner@example.test',STUDIO_BRIDGE_SECRET:'test-only-bridge-secret'}});
 try{
 const db=await mf.getD1Database('DB');for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())for(const sql of readFileSync('drizzle/'+f,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()))await db.prepare(sql).run();
 const customers={customer:crypto.randomUUID(),stranger:crypto.randomUUID()};
 const call=async(path,who,method='GET',body)=>{
  const bridge=who in customers;
  const headers={'Content-Type':'application/json',...(who==='owner'?{'Cf-Access-Jwt-Assertion':ownerToken}:{}),...(bridge?{'x-studio-customer-id':customers[who],'x-studio-bridge-secret':'test-only-bridge-secret'}:{})};
  const r=await mf.dispatchFetch('http://localhost/api/'+(bridge?'bridge/':'')+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json(),headers:r.headers};
 };
 assert.equal((await call('me',null)).status,401);
 for(const headers of [
  {Cookie:'qa_access_token=valid-researcher-session; qa_refresh_token=research-refresh'},
  {'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.test'},
  {'Cf-Access-Jwt-Assertion':outsiderToken},
  {'Cf-Access-Jwt-Assertion':wrongAudience}
 ]){const r=await mf.dispatchFetch('http://localhost/api/me',{headers});assert.equal(r.status,401);}
 const landing=await mf.dispatchFetch('http://localhost/',{redirect:'manual'});assert.equal(landing.status,302);assert.equal(landing.headers.get('location'),'/sign-in');
 const oldLogin=await call('auth/sign-in',null,'POST',{email:'owner@example.test',password:'research-password'});assert.equal(oldLogin.status,410);
 const staffLogin=await mf.dispatchFetch('http://localhost/staff-login',{redirect:'manual',headers:{'Cf-Access-Jwt-Assertion':ownerToken}});assert.equal(staffLogin.status,302);assert.equal(staffLogin.headers.get('location'),'/');
 const staffCookie=staffLogin.headers.getSetCookie()[0];assert.ok(staffCookie.startsWith('__Host-qual_support_staff='));assert.ok(staffCookie.includes('HttpOnly')&&staffCookie.includes('Secure')&&staffCookie.includes('SameSite=Lax'));
 const session=await mf.dispatchFetch('http://localhost/api/me',{headers:{Cookie:staffCookie.split(';')[0]}});assert.equal(session.status,200);assert.equal((await session.json()).id,'support:staff-subject');
 const owner=await call('me','owner');assert.equal(owner.data.staff,true);
 const signedOut=await call('auth/sign-out','owner','POST',{});assert.equal(signedOut.status,200);assert.ok(signedOut.headers.getSetCookie().every(c=>!c.startsWith('qa_')));
 const missingSecret=await mf.dispatchFetch('http://localhost/api/bridge/conversations',{method:'POST',headers:{'Content-Type':'application/json','x-studio-customer-id':customers.customer},body:'{}'});assert.equal(missingSecret.status,401);
 const conv=(await call('conversations','customer','POST',{})).data.id;
 const body={conversation_id:conv,request_id:crypto.randomUUID(),message:'My simulation is blocked for every user.',factors:{impact:'blocked',scope:'all',workaround:'no'}};
 const first=await call('messages','customer','POST',body);assert.equal(first.status,200);assert.ok(first.data.ticket_id);
 assert.deepEqual((await call('messages','customer','POST',body)).data,first.data);
 assert.equal((await call('messages','customer','POST',{...body,message:'different'})).status,409);
 const id=first.data.ticket_id;
 assert.equal((await call('tickets/'+id,'stranger')).status,404);
 assert.equal((await call('conversations/'+conv,'stranger')).status,404);
 assert.equal((await call('tickets?queue=true','customer')).status,403);
 const ticket=(await call('tickets/'+id,'owner')).data.ticket;assert.equal(ticket.severity,1);
 assert.equal((await call('tickets/'+id,'customer','PATCH',{})).status,403);
 assert.equal((await call('tickets/'+id,'owner','PATCH',{version:ticket.version,status:'in_progress',severity:2,assignee:'Owner',note:'',internal:true})).status,422);
 const patch={version:ticket.version,status:'in_progress',severity:2,assignee:'Support owner',note:'Only one user is affected; verified a workaround.',internal:true};
 assert.equal((await call('tickets/'+id,'owner','PATCH',patch)).status,200);
 assert.equal((await call('tickets/'+id,'owner','PATCH',patch)).status,409);
 const customer=await call('tickets/'+id,'customer');assert.ok(!customer.data.messages.some(m=>m.internal));assert.equal(customer.data.events.length,0);
 const staff=await call('tickets/'+id,'owner');assert.ok(staff.data.messages.some(m=>m.internal));assert.equal(staff.data.events.length,2);assert.equal(staff.data.ticket.severity,2);
 assert.equal((await call('tickets?queue=true','owner')).data.tickets.length,1);

 // A customer can escalate the same conversation; AI pauses and replies stay private.
 const humanBody={conversation_id:conv,request_id:crypto.randomUUID(),message:'Please connect me to a human',request_human:true};
 const handoff=await call('messages','customer','POST',humanBody);assert.equal(handoff.status,200);assert.equal(handoff.data.ticket_id,id);assert.equal(handoff.data.handoff_state,'requested');
 assert.deepEqual((await call('messages','customer','POST',humanBody)).data,handoff.data);
 const waiting=(await call('tickets/'+id,'owner')).data.ticket;assert.equal(waiting.severity,2);assert.equal(waiting.handoff_state,'requested');
 const joined=await call('tickets/'+id,'owner','PATCH',{version:waiting.version,status:'in_progress',severity:2,assignee:'Owner',note:'I have joined the chat.',internal:false,handoff_state:'active'});assert.equal(joined.status,200);
 const humanReply=await call('messages','customer','POST',{conversation_id:conv,request_id:crypto.randomUUID(),message:'Thanks. Here are more details.'});assert.equal(humanReply.status,200);assert.equal(humanReply.data.answer,null);assert.equal(humanReply.data.handoff_state,'active');
 const live=(await call('conversations/'+conv,'customer')).data;assert.equal(live.handoff_state,'active');assert.ok(live.messages.some(m=>m.role==='support'&&m.content==='I have joined the chat.'));assert.ok(!live.messages.some(m=>m.content===patch.note));assert.ok(live.messages.every(m=>m.id));
 assert.equal((await call('tickets?queue=true','owner')).data.tickets[0].latest_role,'user');
 const closing=(await call('tickets/'+id,'owner')).data.ticket;
 assert.equal((await call('tickets/'+id,'owner','PATCH',{version:closing.version,status:'resolved',severity:2,assignee:'Owner',note:'Resolved together.',internal:false})).status,200);
 const reopen=await call('messages','customer','POST',{conversation_id:conv,request_id:crypto.randomUUID(),message:'I still need help.'});assert.equal(reopen.data.handoff_state,'requested');assert.equal((await call('tickets/'+id,'owner')).data.ticket.status,'open');
 }finally{await mf.dispose();}
});

test('temporary owner access requires a valid private token and fixed expiry',async()=>{
 const {temporarySession,supportSession,temporaryCookie}=await import('./auth.mjs');
 const token='t_'+'a'.repeat(64);
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join('');
 const env={SUPPORT_TEMPORARY_HASH:hash,SUPPORT_TEMPORARY_EXPIRES:String(Math.floor(Date.now()/1000)+3600),SUPPORT_TEMPORARY_EMAIL:'owner@example.test',STAFF_EMAILS:'owner@example.test'};
 assert.equal((await temporarySession(token,env)).user.staff,true);
 for(const invalid of ['', 't_'+'b'.repeat(64)])assert.equal((await temporarySession(invalid,env)).user,null);
 assert.equal((await temporarySession(token,{...env,SUPPORT_TEMPORARY_EXPIRES:'1'})).user,null);
 assert.equal((await temporarySession(token,{...env,STAFF_EMAILS:'someone@example.test'})).user,null);
 assert.equal((await temporarySession(token,{})).user,null);
 const cookie=temporaryCookie(token,Number(env.SUPPORT_TEMPORARY_EXPIRES));
 assert.match(cookie,/HttpOnly; Secure; SameSite=Lax/);
 assert.equal((await supportSession(new Request('https://support.test',{headers:{cookie}}),env)).user.id,'support:temporary-owner');
});
