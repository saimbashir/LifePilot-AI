import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createStore} from './store.mjs';
import {createMonitor} from './monitoring/monitor.mjs';
import {createAutoAssistant} from './monitoring/assistant.mjs';
import {createPush} from './monitoring/push.mjs';
import {createAiRouter} from './ai/routes.mjs';
import {createGroq} from './ai/provider.mjs';
import {authUrl,exchangeCode,gmailProfile,createGmail,buildMime} from './gmail.mjs';
import {randomToken,sha,safeEq,seal,unseal,encryptionKey,parseCookies,cookie,fields,validateAddress,fail,cleanLine} from './security.mjs';
if(fs.existsSync(new URL('../.env',import.meta.url)) && process.loadEnvFile)process.loadEnvFile(fileURLToPath(new URL('../.env',import.meta.url)));
const env=process.env;
const key=encryptionKey(env);
const app=express();
if(env.TRUST_PROXY==='true')app.set('trust proxy',1);
app.disable('x-powered-by');
const base=env.BASE_URL||'http://localhost:8787';
const frontend=env.FRONTEND_ORIGIN||'http://localhost:5173';
const prod=env.NODE_ENV==='production';
if(prod&&(!base.startsWith('https://')||!frontend.startsWith('https://')))throw new Error('Production requires HTTPS origins.');
const cookieName=prod?'__Host-lp_session':'lp_session';
const oauthCookie=prod?'__Host-lp_oauth':'lp_oauth';
const store=createStore(env.DB_PATH||'./private/lifepilot.sqlite',key);
const clientId=env.GOOGLE_CLIENT_ID||'',clientSecret=env.GOOGLE_CLIENT_SECRET||'';
const redirectUri=env.GOOGLE_REDIRECT_URI||`${base}/api/auth/google/callback`;
const allowEmail=(env.ALLOWED_GMAIL_ADDRESS||'').trim().toLowerCase();
const configured=Boolean(clientId&&clientSecret&&allowEmail);
const gmail=createGmail({store,key,clientId,clientSecret});
// A scheduler does not persist data. DB_PATH MUST be a durable disk when deployed.
const cronWorkerConfigured=env.MONITOR_WORKER_ENABLED==='true' && Boolean(env.MONITOR_CRON_SECRET && env.MONITOR_CRON_SECRET.length>=32 && !env.MONITOR_CRON_SECRET.startsWith('REPLACE_'));
const internalTimerConfigured=env.MONITOR_INTERNAL_TIMER_ENABLED==='true';
const monitorWorkerConfigured=cronWorkerConfigured||internalTimerConfigured;
const push=createPush({store,key,env});
const monitor=createMonitor({store,gmail,notify:push.notify,workerConfigured:monitorWorkerConfigured});
const model=createGroq({env});
monitor.setAutoAssistant(createAutoAssistant({store,gmail,model,key,maxPerRun:Math.min(5,Math.max(1,Number(env.AUTO_AI_BATCH_SIZE)||3))}));
const asyncRoute=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const fromSession=req=>{const s=store.session(parseCookies(req.headers.cookie)[cookieName]);return s?.email?.toLowerCase()===allowEmail?s:null};
const requireSession=(req,_res,next)=>{req.session=fromSession(req);if(!req.session)return next(fail(401,'Gmail not connected; sign in again.'));next()};
const requireCsrf=(req,_res,next)=>{
  const origin=req.get('Origin');
  if(origin!==frontend)return next(fail(403,'Request origin mismatch'));
  if(!req.session||!safeEq(req.get('X-CSRF-Token'),req.session.csrf))return next(fail(403,'CSRF token missing or incorrect'));
  next();
};
const accountId=req=>req.session.account_id;
app.use((req,res,next)=>{
  res.set('Cache-Control','no-store');
  res.set('X-Content-Type-Options','nosniff');
  res.set('Referrer-Policy','no-referrer');
  res.set('X-Frame-Options','DENY');
  res.set('Permissions-Policy','camera=(), geolocation=()');
  next();
});
app.use('/api',express.json({limit:'9mb'}));
app.get('/api/health',(_req,res)=>res.json({ok:true,service:'lifepilot-gmail',workerConfigured:monitorWorkerConfigured,pushConfigured:push.enabled}));
// Scheduler-only endpoint. It is intentionally outside cookie session middleware and
// guarded by a separately provisioned high-entropy secret, never a browser CSRF token.
app.post('/internal/cron/monitor',asyncRoute(async(req,res)=>{
  if(!cronWorkerConfigured)throw fail(503,'Cloud cron monitor is not enabled');
  const supplied=req.get('X-Monitor-Token')||'';
  if(!supplied||!safeEq(sha(supplied),sha(env.MONITOR_CRON_SECRET)))throw fail(403,'Forbidden');
  const outcome=await monitor.syncEnabled();
  res.json({checked:outcome.length,failed:outcome.filter(x=>x.error).length});
}));
app.get('/api/session',asyncRoute(async(req,res)=>{
  const s=fromSession(req);
  if(!s)return res.json({connected:false,configured,monitoring:'Disconnected'});
  const m=monitor.status(s.account_id);
  return res.json({connected:true,configured,email:s.email,csrf:s.csrf,monitoring:m.status,monitoringConfigured:m.workerConfigured});
}));
app.get('/api/auth/google/start',asyncRoute(async(_req,res)=>{
  if(!configured)throw fail(503,'Set Google OAuth credentials and ALLOWED_GMAIL_ADDRESS in backend/.env first.');
  const state=randomToken(),verifier=randomToken();
  store.createOAuth(sha(state),seal(verifier,key));
  res.setHeader('Set-Cookie',cookie(oauthCookie,state,{maxAge:600,secure:prod}));
  res.redirect(302,authUrl({clientId,redirectUri,state,verifier}));
}));
app.get('/api/auth/google/callback',asyncRoute(async(req,res)=>{
  const state=req.query.state,code=req.query.code;
  const cookieState=parseCookies(req.headers.cookie)[oauthCookie];
  res.setHeader('Set-Cookie',cookie(oauthCookie,'',{secure:prod,clear:true}));
  if(!state||!code||!safeEq(state,cookieState))throw fail(400,'OAuth state verification failed.');
  const verifier=unseal(store.consumeOAuth(sha(state)),key).toString();
  const tokens=await exchangeCode({clientId,clientSecret,redirectUri,code,verifier});
  if(!tokens.access_token||!tokens.refresh_token)throw fail(401,'No refresh token returned. Remove app access in Google settings, then reconnect.');
  const profile=await gmailProfile(tokens.access_token);
  const email=String(profile.emailAddress||'').toLowerCase();
  if(email!==allowEmail)throw fail(403,'This Gmail account is not permitted in this single-user deployment.');
  const account=store.upsertAccount(email,seal(JSON.stringify({...tokens,expires_at:Date.now()+(tokens.expires_in||3600)*1000}),key));
  const session=store.issueSession(account);
  res.setHeader('Set-Cookie',cookie(cookieName,session.raw,{maxAge:7*86400,secure:prod}));
  res.redirect(303,frontend+'/?gmail=connected');
}));
app.post('/api/auth/logout',requireSession,requireCsrf,asyncRoute(async(req,res)=>{
  push.clearAccount(accountId(req)); // Privacy-first logout: stop notifications to every registered device.
  store.deleteSession(parseCookies(req.headers.cookie)[cookieName]);
  res.setHeader('Set-Cookie',cookie(cookieName,'',{secure:prod,clear:true}));res.json({connected:false});
}));
app.delete('/api/auth/account',requireSession,requireCsrf,asyncRoute(async(req,res)=>{
  const a=store.accountById(accountId(req));
  // Local deletion succeeds even if remote revocation is unavailable.
  try{const t=JSON.parse(unseal(a.token_cipher,key));await fetch('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:t.refresh_token||t.access_token}).toString(),signal:AbortSignal.timeout(5000)});}catch{/* user can revoke in Google account settings */}
  store.deleteAccount(accountId(req));
  res.setHeader('Set-Cookie',cookie(cookieName,'',{secure:prod,clear:true}));res.json({connected:false,deleted:true});
}));
app.use('/api',requireSession);
app.use('/api/ai',createAiRouter({store,gmail,getAccountId:accountId,requireCsrf,model,routerFactory:()=>express.Router(),onConsentRevoked:a=>{const st=monitor.status(a);monitor.configureAuto(a,{enabled:false,dailyLimit:st.autoAiDailyLimit,scope:st.autoAiScope})}}));
app.get('/api/monitoring',(req,res)=>res.json(monitor.status(accountId(req))));
app.patch('/api/monitoring',requireCsrf,(req,res)=>res.json(monitor.enable(accountId(req),req.body?.enabled)));
app.patch('/api/monitoring/auto-ai',requireCsrf,(req,res)=>{
  const {enabled,dailyLimit,scope}=req.body||{};
  if(enabled===true&&(!store.getAiConsent(accountId(req))||!model.config.configured||!model.config.enabled))
    throw fail(403,'Enable external AI consent and configure Groq before enabling automatic AI drafts');
  res.json(monitor.configureAuto(accountId(req),{enabled,dailyLimit,scope}));
});
app.post('/api/monitoring/check',requireCsrf,asyncRoute(async(req,res)=>{
  // On-demand incremental sync for verification and fallback; does not send mail.
  res.json({result:await monitor.sync(accountId(req)),status:monitor.status(accountId(req))});
}));
app.get('/api/monitoring/events',(req,res)=>{
  const rows=store.db.prepare('SELECT message_id AS messageId,created_at AS createdAt,notified_at AS notifiedAt,ai_state AS aiState,summary_cipher AS summaryCipher,draft_id AS draftId,ai_error AS aiError FROM monitor_events WHERE account_id=? ORDER BY created_at DESC LIMIT 50').all(accountId(req));
  res.json({events:rows.map(({summaryCipher,...row})=>({...row,summary:summaryCipher?JSON.parse(unseal(summaryCipher,key)):null}))});
});
app.get('/api/push/status',(req,res)=>res.json({configured:push.enabled,devices:push.list(accountId(req))}));
app.post('/api/push/register',requireCsrf,(req,res)=>res.status(201).json(push.register(accountId(req),req.body||{})));
app.delete('/api/push/devices/:deviceId',requireCsrf,(req,res)=>res.json({removed:push.remove(accountId(req),req.params.deviceId)}));
app.post('/api/push/unregister',requireCsrf,(req,res)=>{
  const token=req.body?.token;
  if(typeof token!=='string'||token.length>4096)throw fail(400,'Invalid token');
  res.json({removed:push.removeToken(accountId(req),token)});
});
app.post('/api/monitoring/refresh',requireCsrf,asyncRoute(async(req,res)=>{
  const [mail,counts]=await Promise.all([gmail.list(accountId(req),{folder:'inbox',limit:25}),gmail.stats(accountId(req))]);
  res.json({...mail,counts,checkedAt:new Date().toISOString(),monitoring:monitor.status(accountId(req)).status});
}));
app.get('/api/mail',asyncRoute(async(req,res)=>{
  const folder=String(req.query.folder||'inbox');if(!['inbox','unread','important','sent','archive'].includes(folder))throw fail(400,'Invalid folder');
  const q=String(req.query.q||'').trim();if(q.length>180)throw fail(400,'Search query too long');
  const pageToken=String(req.query.pageToken||'');if(pageToken.length>500)throw fail(400,'Invalid page token');
  res.json(await gmail.list(accountId(req),{folder,query:q,limit:25,pageToken}));
}));
app.get('/api/mail/stats',asyncRoute(async(req,res)=>res.json(await gmail.stats(accountId(req)))));
app.get('/api/mail/:id',asyncRoute(async(req,res)=>{
  const mail=await gmail.message(accountId(req),req.params.id);
  const messages=mail.threadId?await gmail.thread(accountId(req),mail.threadId):[mail];
  res.json({...mail,thread:messages.filter(x=>x.id!==mail.id).map(x=>({from:x.from,date:x.date,body:x.body})),threadMessages:messages});
}));
app.get('/api/mail/:id/attachments/:attachmentId',asyncRoute(async(req,res)=>{
  const mail=await gmail.message(accountId(req),req.params.id);
  const meta=mail.attachmentDetails.find(a=>a.id===req.params.attachmentId);if(!meta)throw fail(404,'Attachment not found in this message');
  const bytes=await gmail.attachment(accountId(req),mail.id,meta.id);
  res.set('Content-Type','application/octet-stream');res.set('Content-Disposition',`attachment; filename="${meta.name.replace(/[\r\n"\\/]/g,'_').slice(0,120)}"`);res.send(bytes);
}));
app.patch('/api/mail/:id/labels',requireCsrf,asyncRoute(async(req,res)=>{
  const actions={read:'UNREAD',star:'STARRED',important:'IMPORTANT',archive:'INBOX'};
  const action=req.body?.action,flag=actions[action];if(!flag||typeof req.body.value!=='boolean')throw fail(400,'Invalid action');
  const value=action==='read'||action==='archive'?!req.body.value:req.body.value;
  await gmail.setFlag(accountId(req),req.params.id,flag,value);
  res.json({ok:true,mail:await gmail.message(accountId(req),req.params.id)});
}));
app.get('/api/drafts',asyncRoute(async(req,res)=>res.json({drafts:store.listDrafts(accountId(req))})));
app.post('/api/drafts',requireCsrf,asyncRoute(async(req,res)=>{
  let form=fields(req.body);
  let reply={};
  if(req.body.sourceEmailId){
    reply=await gmail.replySource(accountId(req),String(req.body.sourceEmailId));
    form={...form,to:reply.to,subject:reply.subject};
  }
  res.status(201).json(store.createDraft(accountId(req),form,reply));
}));
app.get('/api/drafts/:id',asyncRoute(async(req,res)=>res.json(store.getDraft(accountId(req),req.params.id))));
app.patch('/api/drafts/:id',requireCsrf,asyncRoute(async(req,res)=>{
  const version=req.body?.expectedVersion;
  if(!Number.isSafeInteger(version))throw fail(400,'expectedVersion is required');
  res.json(store.updateDraft(accountId(req),req.params.id,fields(req.body),version));
}));
app.post('/api/drafts/:id/attachments',requireCsrf,asyncRoute(async(req,res)=>{
  const b=req.body;
  if(typeof b?.data!=='string'||b.data.length>8_000_000||!/^[A-Za-z0-9+/]*={0,2}$/.test(b.data))throw fail(400,'Base64 attachment required, under 5MB');
  const bytes=Buffer.from(b.data,'base64');if(!bytes.length||bytes.length>5*1024*1024)throw fail(413,'Attachment must be 1 byte to 5MB');
  const filename=cleanLine(b.filename||'attachment',120).replace(/[\\/]/g,'_');
  const mimeType=/^[\w.+-]+\/[\w.+-]+$/.test(b.mimeType||'')?b.mimeType:'application/octet-stream';
  res.status(201).json(store.addAttachment(accountId(req),req.params.id,{filename,mimeType,byteSize:bytes.length,digest:sha(bytes),ciphertext:seal(bytes,key)}));
}));
app.delete('/api/drafts/:id/attachments/:attachmentId',requireCsrf,asyncRoute(async(req,res)=>res.json(store.removeAttachment(accountId(req),req.params.id,req.params.attachmentId))));
app.post('/api/drafts/:id/request-review',requireCsrf,asyncRoute(async(req,res)=>{
  const v=req.body?.expectedVersion;if(!Number.isSafeInteger(v))throw fail(400,'expectedVersion required');
  res.json(store.requestReview(accountId(req),req.params.id,v));
}));
app.post('/api/drafts/:id/approve',requireCsrf,asyncRoute(async(req,res)=>{
  const {expectedVersion,contentHash}=req.body||{};
  if(!Number.isSafeInteger(expectedVersion)||typeof contentHash!=='string')throw fail(400,'Reviewed version and content hash required');
  res.json(store.approve(accountId(req),req.params.id,expectedVersion,contentHash));
}));
app.post('/api/drafts/:id/send',requireCsrf,asyncRoute(async(req,res)=>{
  const {expectedVersion,approvalId}=req.body||{};
  if(!Number.isSafeInteger(expectedVersion)||typeof approvalId!=='string')throw fail(400,'Explicit approval required');
  // Reserve before the outbound request. A second attempt is always refused, including on ambiguous Gmail failures.
  const reserved=store.reserveSend(accountId(req),req.params.id,expectedVersion,approvalId);
  try{
    const account=store.accountById(accountId(req));
    const raw=buildMime(reserved.draft,{from:account.email,attachments:reserved.attachmentRows,key});
    const matchesThread=reserved.draft.thread_id && (!reserved.draft.original_sender || reserved.draft.original_sender.toLowerCase()===reserved.draft.to_addr.toLowerCase());
    const sent=await gmail.send(accountId(req),raw,matchesThread?reserved.draft.thread_id:null);
    if(!sent?.id)throw fail(502,'Gmail did not return a confirmed message ID');
    res.json({sent:true,gmailMessageId:sent.id,gmailThreadId:sent.threadId||null,draft:store.completeSend(accountId(req),req.params.id,reserved.attemptId,sent)});
  }catch(err){store.uncertainSend(accountId(req),req.params.id,reserved.attemptId,'Gmail response not confirmed; inspect your Sent folder before any action.');
    res.status(502).json({error:'Send status unknown. Check your Gmail Sent folder. Automatic retry is blocked.',sendStatus:'unknown'});
  }
}));
app.post('/api/drafts/:id/reject',requireCsrf,asyncRoute(async(req,res)=>res.json(store.reject(accountId(req),req.params.id))));
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../dist');
if(fs.existsSync(root)){
  app.use(express.static(root,{index:false}));
  app.get(/^\/(?!api\/).*/,(_req,res)=>res.sendFile(path.join(root,'index.html')));
}
app.use((err,_req,res,_next)=>{
  if(res.headersSent)return;
  const status=Number(err.status)||500;
  if(status>=500)console.error('[LifePilot server]',err.message);
  res.status(status).json({error:status>=500&&status!==502?'Internal server error':err.message||'Request failed',...(status===401?{reauthorizationRequired:true}:{})});
});
const port=Number(env.PORT||8787);
app.listen(port,'0.0.0.0',()=>console.log(`LifePilot API listening on ${port} · OAuth ${configured?'configured':'not configured'}`));
// Optional scheduled checks on a continuously running, SINGLE-INSTANCE durable VM.
// This is not a cloud service by itself; deployment and uptime must be verified separately.
if(internalTimerConfigured){
  if(!prod)console.warn('Local monitoring timer enabled; it stops if this process stops.');
  const intervalMs=Math.min(3_600_000,Math.max(60_000,Number(env.MONITOR_POLL_INTERVAL_MS)||900_000));
  let running=false;
  const tick=async()=>{if(running)return;running=true;
    try{await monitor.syncEnabled()}catch{console.error('[LifePilot monitor] Scheduled check failed')}finally{running=false}
  };
  const interval=setInterval(tick,intervalMs);interval.unref();
  setTimeout(tick,5_000).unref();
}

