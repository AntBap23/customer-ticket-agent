// Support staff have an independent Cloudflare Access session.
// Researcher cookies, roles and browser-supplied identity headers are not accepted.
import {createRemoteJWKSet,jwtVerify} from 'jose';
export const SUPPORT_COOKIE='__Host-qual_support_staff';
export function readSupportToken(request){
 const assertion=request.headers.get('Cf-Access-Jwt-Assertion');
 if(assertion)return assertion;
 const pair=(request.headers.get('Cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(SUPPORT_COOKIE+'='));
 return pair?pair.slice(SUPPORT_COOKIE.length+1):null;
}
export function staffAllowed(email,allowlist){return typeof email==='string'&&(allowlist||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean).includes(email.toLowerCase());}
export async function verifySupportToken(token,env,keySet){
 if(!env.SUPPORT_AUTH_DOMAIN||!env.SUPPORT_ACCESS_AUD)throw new Error('Support staff sign-in is not configured');
 const issuer='https://'+env.SUPPORT_AUTH_DOMAIN;
 const keys=keySet||createRemoteJWKSet(new URL(issuer+'/cdn-cgi/access/certs'));
 const {payload}=await jwtVerify(token,keys,{issuer,audience:env.SUPPORT_ACCESS_AUD,algorithms:['RS256'],requiredClaims:['exp','iat','sub','email']});
 if(!staffAllowed(payload.email,env.STAFF_EMAILS))throw new Error('Staff account is not approved');
 return {user:{id:'support:'+payload.sub,email:payload.email,staff:true},expiresAt:payload.exp};
}
export async function supportSession(request,env,keySet){
 const temporary=(request.headers.get('Cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('__Host-qual_support_temporary='));
 if(temporary){const session=await temporarySession(temporary.split('=')[1],env);if(session.user)return session;}
 const token=readSupportToken(request);if(!token)return {user:null};
 try{return await verifySupportToken(token,env,keySet);}catch{return {user:null};}
}
export function supportCookie(token,expiresAt){
 const seconds=Math.max(0,Math.min(28800,Math.floor(expiresAt-Date.now()/1000)));
 return `${SUPPORT_COOKIE}=${token}; Path=/; Max-Age=${seconds}; HttpOnly; Secure; SameSite=Lax`;
}
export const clearSupportCookies=[`${SUPPORT_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,'CF_Authorization=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax'];

// Temporary owner access is opt-in, high entropy, and stops at a fixed server deadline.
export async function temporarySession(token,env){
 const expiresAt=Number(env.SUPPORT_TEMPORARY_EXPIRES);
 if(!Number.isFinite(expiresAt)||expiresAt<=Date.now()/1000||!env.SUPPORT_TEMPORARY_HASH||!env.SUPPORT_TEMPORARY_EMAIL)return {user:null};
 if(!staffAllowed(env.SUPPORT_TEMPORARY_EMAIL,env.STAFF_EMAILS)||typeof token!=='string'||!/^t_[a-f0-9]{64}$/.test(token))return {user:null};
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join('');
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.SUPPORT_TEMPORARY_HASH),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
 const signature=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(env.SUPPORT_TEMPORARY_HASH));
 if(!await crypto.subtle.verify('HMAC',key,signature,new TextEncoder().encode(hash)))return {user:null};
 return {user:{id:'support:temporary-owner',email:env.SUPPORT_TEMPORARY_EMAIL,staff:true},expiresAt};
}
export function temporaryCookie(token,expiresAt){return supportCookie(token,expiresAt).replace(SUPPORT_COOKIE+'=','__Host-qual_support_temporary=');}
clearSupportCookies.push('__Host-qual_support_temporary=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax');
