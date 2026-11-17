import crypto from 'node:crypto';
const b64u = b => Buffer.from(b).toString('base64url');
export const randomToken = () => b64u(crypto.randomBytes(32));
export const sha = text => crypto.createHash('sha256').update(text).digest('hex');
export const safeEq = (a,b) => typeof a==='string' && typeof b==='string' && a.length===b.length && crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
export function encryptionKey(env=process.env) {
  const key=Buffer.from(env.TOKEN_ENCRYPTION_KEY_B64||'', 'base64');
  if(key.length!==32) throw new Error('TOKEN_ENCRYPTION_KEY_B64 must be 32 random bytes in base64.');
  return key;
}
export function seal(value,key){
  const iv=crypto.randomBytes(12), cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
  const bytes=Buffer.isBuffer(value)?value:Buffer.from(String(value));
  const out=Buffer.concat([cipher.update(bytes),cipher.final()]);
  return [iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),out.toString('base64url')].join('.');
}
export function unseal(value,key){
  const [a,b,c]=String(value).split('.');
  if(!a||!b||c===undefined) throw new Error('Invalid encrypted payload');
  const d=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(a,'base64url'));
  d.setAuthTag(Buffer.from(b,'base64url'));
  return Buffer.concat([d.update(Buffer.from(c,'base64url')),d.final()]);
}
export const parseCookies=(header='')=>Object.fromEntries(String(header).split(';').map(v=>v.trim()).filter(v=>v.includes('=')).map(v=>{
  const i=v.indexOf('=');let value=v.slice(i+1);
  try{value=decodeURIComponent(value)}catch{/* malformed untrusted cookie must not crash session handling */}
  return [v.slice(0,i),value];
}));
export function cookie(name,value,{maxAge=0,secure=false,clear=false}={}) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax${secure?'; Secure':''}${clear?'; Max-Age=0':maxAge?`; Max-Age=${maxAge}`:''}`;
}
export function validateAddress(value){
  if(typeof value!=='string'||value.length>254||/[\r\n<>]/.test(value)||!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(value)) throw Object.assign(new Error('Invalid email address'),{status:400});
  return value.trim();
}
export function addressList(value=''){
  if(!value)return [];
  if(typeof value!=='string'||value.length>2000) throw Object.assign(new Error('Invalid recipient list'),{status:400});
  const addresses=value.split(',').map(x=>x.trim()).filter(Boolean).map(validateAddress);
  if(addresses.length>20)throw Object.assign(new Error('Too many recipients'),{status:400});
  return addresses;
}
export function cleanLine(value,max=500){
  if(typeof value!=='string'||value.length>max||/[\r\n\0]/.test(value))throw Object.assign(new Error('Invalid header text'),{status:400});
  return value.trim();
}
export function fields(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw Object.assign(new Error('JSON object required'),{status:400});
  const to=addressList(input.to).join(', '),cc=addressList(input.cc).join(', '),bcc=addressList(input.bcc).join(', ');
  const subject=cleanLine(input.subject||'',500);
  const body=input.body;
  if(typeof body!=='string'||body.length>250000)throw Object.assign(new Error('Message body must be text <=250 KB'),{status:400});
  return {to,cc,bcc,subject,body};
}
export function fingerprint(draft,attachments=[]){
  return sha(JSON.stringify({to:draft.to,cc:draft.cc,bcc:draft.bcc,subject:draft.subject,body:draft.body,sourceEmailId:draft.source_email_id,attachments:attachments.map(a=>[a.id,a.filename,a.byte_size,a.digest]).sort((a,b)=>a[0].localeCompare(b[0]))}));
}
export function fail(code,message){return Object.assign(new Error(message),{status:code});}
