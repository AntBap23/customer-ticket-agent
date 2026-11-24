// The dashboard reuses Qual AI authentication. No identity headers are trusted.
export const cookieNames=['qa_access_token','qa_refresh_token'];
export function sessionCookieHeader(request){
 return (request.headers.get('Cookie')||'').split(';').map(s=>s.trim()).filter(s=>cookieNames.some(name=>s.startsWith(name+'='))).join('; ');
}
export function sessionCookies(headers){
 return headers.getSetCookie().filter(c=>cookieNames.some(n=>c.startsWith(n+'='))).map(c=>c.split(';').filter((s,i)=>i===0||!/^\s*(domain|path|secure|httponly|samesite)\b/i.test(s)).join(';')+'; Path=/; HttpOnly; Secure; SameSite=Lax');
}
export function staffAllowed(email,allowlist){return typeof email==='string'&&(allowlist||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean).includes(email.toLowerCase());}
export async function studioSession(request,env,fetcher=fetch){
 const cookie=sessionCookieHeader(request);
 if(!cookie)return {user:null,cookies:[]};
 const origin=env.STUDIO_ORIGIN;
 if(!origin?.startsWith('https://'))throw new Error('Studio authentication is not configured');
 const response=await fetcher(origin+'/api/auth/session',{headers:{Cookie:cookie,Accept:'application/json'},signal:AbortSignal.timeout(15000),redirect:'manual'});
 if(!response.ok)return {user:null,cookies:[]};
 const s=await response.json();
 if(!s.authenticated||!s.user?.id||!s.user?.email)return {user:null,cookies:sessionCookies(response.headers)};
 return {user:{id:'studio:'+s.user.id,email:s.user.email,staff:staffAllowed(s.user.email,env.STAFF_EMAILS)},cookies:sessionCookies(response.headers)};
}
