import html from './index.html';
import knowledge from './knowledge.json';
import sources from './sources.json';
import prompt from './prompts.md';
import {triage,cleanFactors,outputSchema,validDiagnosis,fallback,boundedHistory,statuses} from './core.mjs';
const security={'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':'SAMEORIGIN','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self' https://chatgpt.com https://*.chatgpt.com"};
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{...security,'Content-Type':'application/json'}});
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const now=()=>new Date().toISOString();
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
async function readBody(req){
 if(!req.headers.get('content-type')?.includes('application/json'))fail(415,'Use JSON content');
 const reader=req.body?.getReader(); if(!reader)fail(400,'Missing request body');
 let total=0,chunks=[];
 while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>24000){await reader.cancel();fail(413,'Message too large');}chunks.push(value);}
 const bytes=new Uint8Array(total);let p=0;for(const c of chunks){bytes.set(c,p);p+=c.length;}
 try{return JSON.parse(new TextDecoder().decode(bytes));}catch{fail(400,'Invalid JSON');}
}
function references(ids){return [...new Set(ids)].map(id=>knowledge.find(k=>k.id===id)).filter(Boolean).map(k=>({id:k.id,title:k.title,url:sources.find(s=>s.id===k.source)?.url}));}
async function identity(req,env){
 // Dispatch verifies these headers. Never expose this Worker outside that boundary.
 const id=req.headers.get('oai-authenticated-user-id'); if(!id)fail(401,'Sign in to continue');
 const email=req.headers.get('oai-authenticated-user-email')||'';
 const row=await stmt(env.DB,'SELECT id FROM staff WHERE id=?',id).first();
 return {id,email,staff:!!row};
}
async function getConversation(db,id,owner){
 const c=await stmt(db,'SELECT * FROM conversations WHERE id=? AND owner=?',id,owner).first();
 if(!c)fail(404,'Conversation not found');return c;
}
async function model(message,history,env){
 if(!env.OPENAI_API_KEY)return {diagnosis:fallback(message,knowledge),degraded:true};
 try{
 const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(35000),body:JSON.stringify({model:env.OPENAI_MODEL||'gpt-6-luna',store:false,instructions:prompt+'\nUse factors only as reported; unknown facts stay unknown. Return facts for severity assessment, not a numeric severity.\nKnowledge:\n'+JSON.stringify(knowledge),input:[...boundedHistory(history),{role:'user',content:message}],reasoning:{effort:'low'},max_output_tokens:1800,text:{format:{type:'json_schema',name:'support_diagnosis',strict:true,schema:outputSchema}}})});
 if(!r.ok)throw new Error('Provider unavailable');
 const result=await r.json();const text=result.output?.flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('');const d=JSON.parse(text||'null');
 if(!validDiagnosis(d))throw new Error('Invalid model result');return {diagnosis:d,degraded:false};
 }catch{return {diagnosis:fallback(message,knowledge),degraded:true};}
}
async function sendMessage(req,env,user){
 const b=await readBody(req);
 if(typeof b.message!=='string'||!b.message.trim()||b.message.length>6000)fail(422,'Enter a message of up to 6,000 characters');
 if(!uuid(b.request_id)||!uuid(b.conversation_id))fail(422,'Valid conversation and request IDs are required');
 const requestId=user.id+':'+b.request_id;
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(b))))).map(v=>v.toString(16).padStart(2,'0')).join('');
 const cached=await stmt(env.DB,'SELECT * FROM requests WHERE id=? AND owner=?',requestId,user.id).first();
 if(cached){if(cached.fingerprint!==hash)fail(409,'Request ID was already used for different content');if(cached.response)return json(JSON.parse(cached.response));fail(409,'That message is still processing. Refresh the conversation before retrying.');}
 const count=await stmt(env.DB,'SELECT count(*) AS n FROM requests WHERE owner=? AND created_at>?',user.id,new Date(Date.now()-60000).toISOString()).first();
 if(count.n>=12)fail(429,'Please wait a minute before sending more messages');
 const conv=await getConversation(env.DB,b.conversation_id,user.id);
 const hist=await stmt(env.DB,'SELECT role,content FROM messages WHERE conversation_id=? AND internal=0 ORDER BY created_at DESC LIMIT 8',conv.id).all();
 const existing=await stmt(env.DB,'SELECT * FROM tickets WHERE conversation_id=? AND owner=?',conv.id,user.id).first();
 // Reserve idempotency key before spending tokens.
 const reserved=await stmt(env.DB,'INSERT OR IGNORE INTO requests(id,owner,fingerprint,response,created_at) VALUES(?,?,?,NULL,?)',requestId,user.id,hash,now()).run();
 if(!reserved.meta.changes)fail(409,'Message is already processing');
 try{
 const {diagnosis:d,degraded}=await model(b.message,hist.results.reverse(),env);
 const supplied=Object.fromEntries(Object.entries(b.factors||{}).filter(([k,v])=>v!=='unknown'&&!(k==='risk'&&v==='none')));
 const factors=cleanFactors({...d.factors,...supplied});
 // Even in fallback mode, reported serious incidents always need human review.
 if(/(data (was |is )?(lost|deleted)|lost (all |my )?(data|transcripts)|data breach|another user.s data|unauthori[sz]ed access)/i.test(b.message))factors.risk=/breach|another|unauthor/i.test(b.message)?'suspected_security':'suspected_data_loss';
 const t=triage(factors),refs=references(d.knowledge_ids);
 const needs=existing||b.create_ticket===true||d.needs_ticket||t.severity<=2;
 const ticketId=existing?.id||(needs?'TKT-'+crypto.randomUUID().slice(0,8).toUpperCase():null);
 const result={answer:d.answer,sources:refs,degraded,conversation_id:conv.id,ticket_id:ticketId,ticket_notice:ticketId?`${existing?'Updated':'Created'} ${ticketId}. Saved for support review; no email has been sent.`:null};
 const stamp=now();
 const batch=[stmt(env.DB,'UPDATE conversations SET version=version+1,last_request=? WHERE id=? AND version=?',requestId,conv.id,conv.version),
 // Conditional CAS ensures competing replies do not overwrite the ticket.
 stmt(env.DB,"INSERT INTO messages(id,conversation_id,ticket_id,owner,role,content,internal,created_at) SELECT ?,?,?,?,?,?,0,? WHERE (SELECT last_request FROM conversations WHERE id=?)=?",crypto.randomUUID(),conv.id,existing?.id||null,user.id,'user',b.message,stamp,conv.id,requestId)];
 if(needs){
 if(existing){batch.push(stmt(env.DB,"UPDATE tickets SET diagnosis=?,factors=?,severity=min(severity,?),severity_reason=CASE WHEN ?<=severity THEN ? ELSE severity_reason END,updated_at=?,version=version+1 WHERE id=? AND (SELECT last_request FROM conversations WHERE id=?)=?",JSON.stringify({...d,sources:refs}),JSON.stringify(factors),t.severity,t.severity,t.reason,stamp,ticketId,conv.id,requestId));}
 else batch.push(stmt(env.DB,"INSERT INTO tickets(id,conversation_id,owner,subject,description,area,status,severity,severity_reason,factors,diagnosis,assignee,created_at,updated_at,version) SELECT ?,?,?,?,?,?,'open',?,?,?,?, '',?,?,1 WHERE (SELECT last_request FROM conversations WHERE id=?)=?",ticketId,conv.id,user.id,d.subject||b.message.slice(0,100),b.message,d.area,t.severity,t.reason,JSON.stringify(factors),JSON.stringify({...d,sources:refs}),stamp,stamp,conv.id,requestId));
 batch.push(stmt(env.DB,"INSERT INTO events(id,ticket_id,actor,details,created_at) SELECT ?,?,?,?,? WHERE (SELECT last_request FROM conversations WHERE id=?)=?",crypto.randomUUID(),ticketId,'agent',existing?'Agent updated diagnosis; existing higher severity preserved':'Ticket created: '+t.reason,stamp,conv.id,requestId));
 }
 batch.push(stmt(env.DB,"INSERT INTO messages(id,conversation_id,ticket_id,owner,role,content,internal,created_at) SELECT ?,?,?,?,?,?,0,? WHERE (SELECT last_request FROM conversations WHERE id=?)=?",crypto.randomUUID(),conv.id,ticketId,user.id,'assistant',d.answer,stamp,conv.id,requestId));
 batch.push(stmt(env.DB,'UPDATE requests SET response=? WHERE id=?',JSON.stringify(result),requestId));
 const outcome=await env.DB.batch(batch);
 if(!outcome[0].meta.changes){await stmt(env.DB,'DELETE FROM requests WHERE id=?',requestId).run();fail(409,'Conversation changed; reload it before retrying');}
 return json(result);
 }catch(e){await stmt(env.DB,'DELETE FROM requests WHERE id=? AND response IS NULL',requestId).run();throw e;}
}
async function handler(req,env){
 const u=new URL(req.url);let p=u.pathname;
 if(p==='/health')return json({status:'ok'});
 if(p==='/'&&req.method==='GET')return new Response(html,{headers:{...security,'Content-Type':'text/html; charset=utf-8'}});
 if(!p.startsWith('/api/'))return json({error:'Not found'},404);
 if(!env.DB)fail(503,'Database is not configured');
 if(!['GET','HEAD'].includes(req.method)){const origin=req.headers.get('origin');if(origin&&origin!==u.origin)fail(403,'Origin not allowed');}
 let user;
 if(p.startsWith('/api/bridge/')){
 const supplied=req.headers.get('x-studio-bridge-secret')||'';
 if(!env.STUDIO_BRIDGE_SECRET||supplied.length>512)fail(401,'Invalid service credentials');
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.STUDIO_BRIDGE_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
 const signature=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(env.STUDIO_BRIDGE_SECRET));
 if(!await crypto.subtle.verify('HMAC',key,signature,new TextEncoder().encode(supplied)))fail(401,'Invalid service credentials');
 const customer=req.headers.get('x-studio-customer-id');if(!uuid(customer))fail(401,'Valid customer identity required');
 p=p.replace('/api/bridge/','/api/');
 if(!/^\/api\/(conversations(?:\/[a-f0-9-]+)?|messages|tickets(?:\/TKT-[A-Z0-9-]+)?)$/.test(p)||!['GET','POST'].includes(req.method))fail(403,'Customer operation not allowed');
 user={id:'studio:'+customer,email:'',staff:false};
 }else user=await identity(req,env);
 if(p==='/api/me'&&req.method==='GET'){
 // Enabled only for initial owner-private publication. Persistent staff table
 // prevents a later visitor from taking ownership. Never enable on a public Site.
 if(env.BOOTSTRAP_OWNER==='true')await stmt(env.DB,'INSERT OR IGNORE INTO staff(id,label) SELECT ?,? WHERE NOT EXISTS (SELECT 1 FROM staff)',user.id,user.email||'Support owner').run();
 const me=await stmt(env.DB,'SELECT id FROM staff WHERE id=?',user.id).first();return json({...user,staff:!!me,ai_ready:!!env.OPENAI_API_KEY,model:env.OPENAI_MODEL||'gpt-6-luna'});
 }
 if(p==='/api/conversations'&&req.method==='POST'){const id=crypto.randomUUID();await stmt(env.DB,'INSERT INTO conversations(id,owner,version,created_at) VALUES(?,?,0,?)',id,user.id,now()).run();return json({id},201);}
 if(p.startsWith('/api/conversations/')&&req.method==='GET'){
 const id=p.split('/')[3];await getConversation(env.DB,id,user.id);const ms=await stmt(env.DB,'SELECT role,content,created_at FROM messages WHERE conversation_id=? AND internal=0 ORDER BY created_at,rowid',id).all();const t=await stmt(env.DB,'SELECT id FROM tickets WHERE conversation_id=? AND owner=?',id,user.id).first();return json({messages:ms.results,ticket_id:t?.id||null});
 }
 if(p==='/api/messages'&&req.method==='POST')return sendMessage(req,env,user);
 if(p==='/api/tickets'&&req.method==='GET'){
 const staff=u.searchParams.get('queue')==='true';if(staff&&!user.staff)fail(403,'Support access required');
 const rows=await stmt(env.DB,staff?'SELECT * FROM tickets ORDER BY severity,updated_at DESC LIMIT 200':'SELECT * FROM tickets WHERE owner=? ORDER BY updated_at DESC LIMIT 200',...(staff?[]:[user.id])).all();return json({tickets:rows.results});
 }
 const match=p.match(/^\/api\/tickets\/(TKT-[A-Z0-9-]+)$/);
 if(match){
 const ticket=await stmt(env.DB,'SELECT * FROM tickets WHERE id=?',match[1]).first();if(!ticket||(!user.staff&&ticket.owner!==user.id))fail(404,'Ticket not found');
 if(req.method==='GET'){
 const msgs=await stmt(env.DB,'SELECT role,content,internal,created_at FROM messages WHERE conversation_id=? AND (?=1 OR internal=0) ORDER BY created_at,rowid',ticket.conversation_id,user.staff?1:0).all();
 const ev=user.staff?await stmt(env.DB,'SELECT * FROM events WHERE ticket_id=? ORDER BY created_at,rowid',ticket.id).all():{results:[]};
 return json({ticket,messages:msgs.results,events:ev.results});
 }
 if(req.method==='PATCH'){
 if(!user.staff)fail(403,'Support access required');const b=await readBody(req);
 if(b.version!==ticket.version)fail(409,'Ticket changed. Reload before saving');
 if(!statuses.includes(b.status)||![1,2,3,4].includes(b.severity)||typeof b.assignee!=='string'||b.assignee.length>120||typeof b.note!=='string'||b.note.length>6000)fail(422,'Invalid ticket update');
 if(b.severity!==ticket.severity&&!b.note.trim())fail(422,'Add a reason when overriding severity');
 const stamp=now();const note=b.note.trim();const updateId=crypto.randomUUID();
 const batch=[stmt(env.DB,'UPDATE tickets SET status=?,severity=?,severity_reason=?,assignee=?,updated_at=?,version=version+1,last_update=? WHERE id=? AND version=?',b.status,b.severity,b.severity!==ticket.severity?'Support override: '+note:ticket.severity_reason,b.assignee,stamp,updateId,ticket.id,ticket.version),stmt(env.DB,'INSERT INTO events(id,ticket_id,actor,details,created_at) SELECT ?,?,?,?,? WHERE (SELECT last_update FROM tickets WHERE id=?)=?',crypto.randomUUID(),ticket.id,user.id,`Status: ${b.status}; severity: P${b.severity}; assignee: ${b.assignee||'Unassigned'}${note?'; '+note:''}`,stamp,ticket.id,updateId)];
 if(note)batch.push(stmt(env.DB,'INSERT INTO messages(id,conversation_id,ticket_id,owner,role,content,internal,created_at) SELECT ?,?,?,?,?,?,?,? WHERE (SELECT last_update FROM tickets WHERE id=?)=?',crypto.randomUUID(),ticket.conversation_id,ticket.id,ticket.owner,'support',note,b.internal===false?0:1,stamp,ticket.id,updateId));
 const done=await env.DB.batch(batch);if(!done[0].meta.changes)fail(409,'Ticket changed. Reload before saving');return json({ok:true});
 }
 }
 return json({error:'Not found'},404);
}
export default {async fetch(req,env){try{return await handler(req,env);}catch(e){if(!e.status)console.error(JSON.stringify({event:'request_failed',type:e.name||'Error'}));return json({error:e.status?e.message:'Request could not be completed. Please retry.'},e.status||500);}}};
