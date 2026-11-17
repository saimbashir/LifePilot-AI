// Optional Firebase Cloud Messaging HTTP v1. Service account stays in backend secrets.
// Only generic notifications: no sender, subject, body or private content in push.
import crypto from 'node:crypto';
import {fail,sha,seal,unseal} from '../security.mjs';

export function createPush({store,key,env=process.env,fetchImpl=fetch,clock=()=>Date.now()}){
  const db=store.db;
  db.exec(`CREATE TABLE IF NOT EXISTS push_devices (
    id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE, token_cipher TEXT NOT NULL,
    platform TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  ); CREATE INDEX IF NOT EXISTS idx_push_owner ON push_devices(account_id);`);
  // At-most-once per message/device after provider acknowledgment. Unknown network
  // outcomes remain locked instead of silently retrying possibly delivered pushes.
  db.exec(`CREATE TABLE IF NOT EXISTS push_delivery (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL REFERENCES push_devices(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(account_id,device_id,message_id)
  );`);
  let service=null;
  if(env.FIREBASE_SERVICE_ACCOUNT_JSON_B64){
    try{
      service=JSON.parse(Buffer.from(env.FIREBASE_SERVICE_ACCOUNT_JSON_B64,'base64').toString('utf8'));
      if(!service.client_email||!service.private_key||!service.project_id)throw new Error('Incomplete service account');
    }catch{throw new Error('Invalid FIREBASE_SERVICE_ACCOUNT_JSON_B64 secret')}
  }
  const enabled=Boolean(service);
  function register(accountId,{token,platform}){
    if(!enabled)throw fail(503,'Push is not configured on the backend');
    if(typeof token!=='string'||token.length<50||token.length>4096||!/^[a-zA-Z0-9:_-]+$/.test(token))throw fail(400,'Invalid registration token');
    if(!['android','web'].includes(platform))throw fail(400,'Invalid platform');
    const tokenHash=sha(token),existing=db.prepare('SELECT id,account_id FROM push_devices WHERE token_hash=?').get(tokenHash);
    if(existing?.account_id && existing.account_id!==accountId)throw fail(409,'Device is linked to another account');
    const count=db.prepare('SELECT COUNT(*) AS n FROM push_devices WHERE account_id=?').get(accountId).n;
    if(!existing&&count>=8)throw fail(429,'Maximum of 8 registered devices');
    const id=existing?.id||crypto.randomUUID();
    db.prepare(`INSERT INTO push_devices(id,account_id,token_hash,token_cipher,platform,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(token_hash) DO UPDATE SET token_cipher=excluded.token_cipher,platform=excluded.platform,updated_at=excluded.updated_at`)
      .run(id,accountId,tokenHash,seal(token,key),platform,clock(),clock());
    return {id,platform,configured:true};
  }
  function list(a){return db.prepare('SELECT id,platform,created_at AS createdAt FROM push_devices WHERE account_id=? ORDER BY created_at DESC').all(a)}
  function remove(a,id){return db.prepare('DELETE FROM push_devices WHERE account_id=? AND id=?').run(a,id).changes>0}
  function removeToken(a,token){return db.prepare('DELETE FROM push_devices WHERE account_id=? AND token_hash=?').run(a,sha(token)).changes>0}
  function clearAccount(a){return db.prepare('DELETE FROM push_devices WHERE account_id=?').run(a).changes}
  let cached=null;
  async function getOAuthToken(){
    if(!enabled)throw fail(503,'Push backend unconfigured');
    if(cached?.exp>clock()+60000)return cached.value;
    const now=Math.floor(clock()/1000);
    const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
    const assertion=[b64({alg:'RS256',typ:'JWT'}),b64({iss:service.client_email,scope:'https://www.googleapis.com/auth/firebase.messaging',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600})].join('.');
    const signed=crypto.sign('RSA-SHA256',Buffer.from(assertion),service.private_key).toString('base64url');
    const res=await fetchImpl('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:assertion+'.'+signed}).toString(),signal:AbortSignal.timeout(12000)});
    if(!res.ok)throw fail(502,'Push authorization failed');
    const response=await res.json();if(!response.access_token)throw fail(502,'Push authorization response invalid');
    cached={value:response.access_token,exp:clock()+Math.max(0,Number(response.expires_in)||3600)*1000};return cached.value;
  }
  async function notify(a,messageId){
    if(!enabled)return false;
    const devices=db.prepare('SELECT id,token_cipher FROM push_devices WHERE account_id=?').all(a);
    if(!devices.length)return false;
    const bearer=await getOAuthToken();let accepted=false,needsRetry=false;
    for(const device of devices){
      const existing=db.prepare('SELECT state,attempts FROM push_delivery WHERE account_id=? AND device_id=? AND message_id=?').get(a,device.id,messageId);
      if(existing?.state==='sent'){accepted=true;continue}
      if(existing?.state==='unknown'||(existing?.attempts||0)>=3)continue;
      // Reservation is DURABLE before FCM. A connection drop gives unknown, never blind retry.
      db.prepare(`INSERT INTO push_delivery(account_id,device_id,message_id,state,attempts,updated_at)
        VALUES(?,?,?,'attempted',1,?)
        ON CONFLICT(account_id,device_id,message_id) DO UPDATE SET state='attempted',attempts=attempts+1,updated_at=excluded.updated_at`)
        .run(a,device.id,messageId,clock());
      try{
        const token=unseal(device.token_cipher,key).toString('utf8');
        const linked=db.prepare('SELECT draft_id FROM monitor_events WHERE account_id=? AND message_id=?').get(a,messageId);
        const route=linked?.draft_id?'approvals':'inbox';
        const payload={message:{token,notification:{title:'LifePilot AI',body:route==='approvals'?'A new draft is ready for your approval.':'New email available for review.'},data:{route,messageId},android:{priority:'normal',notification:{channel_id:'lifepilot_mail',tag:'mail-'+messageId.slice(0,28)}}}};
        const res=await fetchImpl(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(service.project_id)}/messages:send`,{
          method:'POST',headers:{'Authorization':`Bearer ${bearer}`,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(12000)});
        if(res.ok){db.prepare("UPDATE push_delivery SET state='sent',updated_at=? WHERE account_id=? AND device_id=? AND message_id=?").run(clock(),a,device.id,messageId);accepted=true;continue}
        if(res.status===404||res.status===410){db.prepare('DELETE FROM push_devices WHERE account_id=? AND id=?').run(a,device.id);continue}
        if(res.status===429||res.status>=500){db.prepare("UPDATE push_delivery SET state='retryable',updated_at=? WHERE account_id=? AND device_id=? AND message_id=?").run(clock(),a,device.id,messageId);needsRetry=true;continue}
        // Explicit permanent provider rejection; do not retry with malformed credentials.
        db.prepare("UPDATE push_delivery SET state='unknown',updated_at=? WHERE account_id=? AND device_id=? AND message_id=?").run(clock(),a,device.id,messageId);
      }catch{ // May already have been delivered; preserve ambiguous status.
        db.prepare("UPDATE push_delivery SET state='unknown',updated_at=? WHERE account_id=? AND device_id=? AND message_id=?").run(clock(),a,device.id,messageId);
      }
    }
    return accepted&&!needsRetry;
  }
  return {enabled,register,list,remove,removeToken,clearAccount,notify};
}
