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
 const token=readSupportToken(request);if(!token)return {user:null};
 try{return await verifySupportToken(token,env,keySet);}catch{return {user:null};}
}
export function supportCookie(token,expiresAt){
 const seconds=Math.max(0,Math.min(28800,Math.floor(expiresAt-Date.now()/1000)));
 return `${SUPPORT_COOKIE}=${token}; Path=/; Max-Age=${seconds}; HttpOnly; Secure; SameSite=Lax`;
}
export const clearSupportCookies=[`${SUPPORT_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,'CF_Authorization=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax'];
