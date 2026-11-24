import {Miniflare,createFetchMock} from 'miniflare';
import {createServer} from 'node:http';
import {readFileSync,existsSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
const bindings={STUDIO_ORIGIN:'https://studio.local',STAFF_EMAILS:'local-owner@example.test'};
if(existsSync('.env'))for(const line of readFileSync('.env','utf8').split('\n')){const i=line.indexOf('=');if(i>0)bindings[line.slice(0,i)]=line.slice(i+1).trim().replace(/^["']|["']$/g,'');}
const fetchMock=createFetchMock();fetchMock.get('https://studio.local').intercept({path:'/api/auth/session'}).reply(200,{authenticated:true,user:{id:'local-owner',email:'local-owner@example.test'}}).persist();
const mf=new Miniflare({modules:true,scriptPath:'dist/server/index.js',compatibilityDate:'2026-07-30',d1Databases:['DB'],d1Persist:'.local/d1',bindings,fetchMock});
const db=await mf.getD1Database('DB');mkdirSync('.local',{recursive:true});
const applied=existsSync('.local/applied.json')?JSON.parse(readFileSync('.local/applied.json','utf8')):[];
for(const file of readdirSync('drizzle').filter(x=>x.endsWith('.sql')).sort())if(!applied.includes(file)){for(const sql of readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').filter(x=>x.trim()))await db.prepare(sql).run();applied.push(file);writeFileSync('.local/applied.json',JSON.stringify(applied));}
const server=createServer(async(req,res)=>{try{const chunks=[];for await(const c of req)chunks.push(c);const headers=new Headers(req.headers);headers.set('Cookie','qa_access_token=local-demo');const response=await mf.dispatchFetch('http://127.0.0.1:8010'+req.url,{method:req.method,headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch{res.writeHead(500);res.end('Local preview failed');}});
server.listen(8010,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:8010'));
async function stop(){server.close();await mf.dispose();process.exit(0);}process.on('SIGINT',stop);process.on('SIGTERM',stop);
