import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createStore} from '../src/store.mjs';
import {seal,sha} from '../src/security.mjs';
import {createAiRouter} from '../src/ai/routes.mjs';

function setup(t,modelOutput){
 const key=crypto.randomBytes(32),store=createStore(':memory:',key);t.after(()=>store.close());
 const account=store.upsertAccount('me@example.com',seal('token',key));
 const routeMap=new Map();let providerCalls=0, gmailSends=0, revocations=0;
 const routerFactory=()=>{const router={};for(const verb of ['get','post','patch','delete'])router[verb]=(url,...fns)=>routeMap.set(`${verb.toUpperCase()} ${url}`,fns);return router};
 const message={id:'m1',from:'Ahmad',email:'ahmad@example.com',to:'me@example.com',subject:'Internship',date:'2026-11-12',body:'Deadline November 20, 2026. Send your portfolio.',attachments:[]};
 const gmail={message:async(_,id)=>({...message,id}),replySource:async(_,id)=>({sourceEmailId:id,threadId:'thread1',originalSender:'ahmad@example.com',inReplyTo:'<m1@abc.org>',references:'',subject:'Re: Internship',to:'ahmad@example.com'}),list:async()=>({mails:[message]}),send:async()=>{gmailSends++;throw Error('AI must not call Gmail send')}};
 const model={config:{configured:true,enabled:true,maxInputChars:18000,model:'mock-model'},generate:async({system,user})=>{providerCalls++;return {data:modelOutput({system,user}),usage:{promptTokens:5,completionTokens:7}}}};
 const csrf=(req,_res,next)=>{if(req.csrf==='ok')return next();next(Object.assign(Error('CSRF required'),{status:403}));};
 createAiRouter({store,gmail,getAccountId:()=>account,requireCsrf:csrf,model,routerFactory,onConsentRevoked:a=>{assert.equal(a,account);revocations++}});
 async function invoke(route,body,csrfValue='ok'){
   const fns=routeMap.get(route);assert.ok(fns,route);
   const req={body,csrf:csrfValue}, result={status:200,data:null};
   const res={status(n){result.status=n;return res},json(value){result.data=value;return res}};
   for(const fn of fns){let error;await fn(req,res,e=>{error=e||null});if(error){result.status=error.status||500;result.data={error:error.message};break}}
   return result;
 }
 return {store,account,key,invoke,getCalls:()=>providerCalls,getGmailSends:()=>gmailSends,getRevocations:()=>revocations,gmail};
}
const output=({system})=>{
 if(system.includes('Summarize ONLY'))return {summary:'Ahmad ne deadline batayi.',keyPoints:['Portfolio required'],dates:['November 20, 2026','Invented date'],actionItems:['Send portfolio'],uncertainties:[]};
 if(system.includes('TASK: Classify'))return {intent:'show_unread'};
 return {subject:'Invented subject',body:'Thanks for the note. I will review.'};
};
test('route-level status contains no key and AI requires opt-in',async t=>{
 const a=setup(t,output);const s=await a.invoke('GET /status');assert.equal(s.status,200);assert.equal(s.data.consent,false);assert.ok(!('apiKey'in s.data));
 const r=await a.invoke('POST /summarize',{messageId:'m1',language:'roman-urdu'});assert.equal(r.status,403);assert.equal(a.getCalls(),0);
});
test('route-level CSRF required even to opt into AI',async t=>{
 const a=setup(t,output);assert.equal((await a.invoke('POST /consent',{enabled:true},'bad')).status,403);assert.equal(a.store.getAiConsent(a.account),false);
 assert.equal((await a.invoke('POST /consent',{enabled:true})).data.consent,true);
});
test('route-level summarize Roman Urdu and exclude unsupported dates',async t=>{
 const a=setup(t,output);await a.invoke('POST /consent',{enabled:true});const r=await a.invoke('POST /summarize',{messageId:'m1',language:'roman-urdu'});
 assert.equal(r.status,200);assert.equal(r.data.language,'roman-urdu');assert.deepEqual(r.data.dates,['November 20, 2026']);assert.ok(r.data.uncertainties.length>0);assert.equal(a.getGmailSends(),0);
});
test('route-level English summaries use the chosen language',async t=>{
 let called='';const a=setup(t,({system})=>{called=system;return {summary:'Sender asks for a portfolio.',keyPoints:[],dates:[],actionItems:[],uncertainties:[]}});
 await a.invoke('POST /consent',{enabled:true});for(const lang of ['simple-english','professional-english']){
  const r=await a.invoke('POST /summarize',{messageId:'m1',language:lang});assert.equal(r.status,200);assert.ok(called.includes(lang));
 }
});
test('route-level reply authoritative recipient, subject/thread, draft-only',async t=>{
 const a=setup(t,output);await a.invoke('POST /consent',{enabled:true});const r=await a.invoke('POST /reply',{messageId:'m1',instruction:'Polite acknowledgement',tone:'Warm',length:'Short',language:'roman-urdu'});
 assert.equal(r.status,201);assert.equal(r.data.to,'ahmad@example.com');assert.equal(r.data.subject,'Re: Internship');assert.equal(r.data.status,'draft');assert.equal(a.store.rawDraft(a.account,r.data.id).thread_id,'thread1');assert.equal(a.getGmailSends(),0);
});
test('route-level AI draft revision preserves real attachments and invalidates approval',async t=>{
 const a=setup(t,output);await a.invoke('POST /consent',{enabled:true});const x=await a.invoke('POST /reply',{messageId:'m1',instruction:'Acknowledge'});let d=x.data;
 d=a.store.addAttachment(a.account,d.id,{filename:'report.pdf',mimeType:'application/pdf',byteSize:1,digest:sha('a'),ciphertext:seal('a',a.key)});
 d=a.store.requestReview(a.account,d.id,d.version);const approved=a.store.approve(a.account,d.id,d.version,d.contentHash);
 const r=await a.invoke('POST /reply',{messageId:'m1',instruction:'Rewrite',draftId:d.id,expectedVersion:d.version});assert.equal(r.status,200);assert.equal(r.data.status,'draft');assert.deepEqual(r.data.attachments,['report.pdf']);
 assert.throws(()=>a.store.reserveSend(a.account,d.id,d.version,approved.approvalId),e=>e.status===409);
});
test('route-level cannot modify reply draft for a different source message',async t=>{
 const a=setup(t,output);await a.invoke('POST /consent',{enabled:true});const d=(await a.invoke('POST /reply',{messageId:'m1',instruction:'Write'})).data;
 const r=await a.invoke('POST /reply',{messageId:'other',instruction:'Change',draftId:d.id,expectedVersion:d.version});assert.equal(r.status,409);
});
test('route-level compose refuses vague/invalid recipient and missing attachment',async t=>{
 const a=setup(t,output);await a.invoke('POST /consent',{enabled:true});
 assert.equal((await a.invoke('POST /compose',{recipient:'Professor',instruction:'Hello'})).status,400);
 const r=await a.invoke('POST /compose',{recipient:'prof@example.com',instruction:'My CV is attached.'});assert.equal(r.status,409);assert.ok(r.data.clarificationRequired);assert.equal(a.getCalls(),0);
});
test('route-level compose draft never sends and preserves explicitly selected recipient',async t=>{
 const a=setup(t,output);await a.invoke('POST /consent',{enabled:true});const r=await a.invoke('POST /compose',{recipient:'prof@example.com',instruction:'Ask about internship'});
 assert.equal(r.status,201);assert.equal(r.data.to,'prof@example.com');assert.equal(r.data.status,'draft');assert.equal(a.getGmailSends(),0);
});
test('route-level model hallucinated attachment cannot be sent or stored as a draft',async t=>{
 const a=setup(t,()=>({subject:'Hello',body:'Please see my CV attached.'}));await a.invoke('POST /consent',{enabled:true});
 const r=await a.invoke('POST /compose',{recipient:'prof@example.com',instruction:'Hello'});assert.equal(r.status,409);assert.equal(a.store.listDrafts(a.account).length,0);
});
test('route-level command returns safe structured unread navigation and never sends',async t=>{
 const a=setup(t,output);await a.invoke('POST /consent',{enabled:true});const r=await a.invoke('POST /command',{text:'Show unread Gmail messages',language:'roman-urdu'});
 assert.equal(r.status,200);assert.equal(r.data.route,'inbox');assert.equal(r.data.autoSend,false);assert.equal(a.getGmailSends(),0);
});
test('route-level commands reject long requests and unsupported language',async t=>{
 const a=setup(t,output);await a.invoke('POST /consent',{enabled:true});
 assert.equal((await a.invoke('POST /command',{text:'A'.repeat(2001),language:'roman-urdu'})).status,400);
 assert.equal((await a.invoke('POST /command',{text:'search mail',language:'untrusted'})).status,400);
});
test('route-level opt out prevents any additional external model calls',async t=>{
 const a=setup(t,output);await a.invoke('POST /consent',{enabled:true});await a.invoke('POST /consent',{enabled:false});
 const before=a.getCalls();assert.equal((await a.invoke('POST /reply',{messageId:'m1',instruction:'Reply'})).status,403);assert.equal(a.getCalls(),before);
});
test('route-level preference update requires CSRF and stores preferences encrypted',async t=>{
 const a=setup(t,output);assert.equal((await a.invoke('PATCH /preferences',{closing:'Yours sincerely'},'wrong')).status,403);
 const r=await a.invoke('PATCH /preferences',{closing:'Yours sincerely',tone:'Warm'});assert.equal(r.status,200);assert.equal(r.data.closing,'Yours sincerely');
 assert.ok(!a.store.db.prepare('SELECT preferences_cipher FROM ai_accounts').get().preferences_cipher.includes('Yours sincerely'));
 assert.equal((await a.invoke('DELETE /preferences')).data.closing,'Best regards');
});
test('long-email source is explicitly marked truncated, not quietly treated as complete',async t=>{
 const a=setup(t,output);await a.invoke('POST /consent',{enabled:true});
 a.gmail.message=async()=>({id:'m1',from:'Ahmad',email:'ahmad@example.com',subject:'long',date:'2026-11-11',body:'Hello.\n'+('Additional explanation. '.repeat(1600))+'\nDeadline November 20, 2026.'});
 // This 18k model context can differ from the full 37k source.
 const r=await a.invoke('POST /summarize',{messageId:'m1',language:'roman-urdu'});
 assert.equal(r.status,200);assert.equal(r.data.sourceTruncated,true);assert.ok(r.data.uncertainties.some(x=>x.includes('longer than the AI input')));
});
test('oversized reply is rejected rather than silently responding to partial email',async t=>{
 const a=setup(t,output);await a.invoke('POST /consent',{enabled:true});
 a.gmail.message=async()=>({id:'m1',from:'Ahmad',email:'ahmad@example.com',subject:'Long email',date:'2026-11-11',body:'x'.repeat(40000)});
 const r=await a.invoke('POST /reply',{messageId:'m1',instruction:'Reply politely'});
 assert.equal(r.status,409);assert.equal(a.store.listDrafts(a.account).length,0);
});
test('AI output with missing required JSON keys does not become a stored reply draft',async t=>{
 const a=setup(t,()=>({body:'Only body'}));await a.invoke('POST /consent',{enabled:true});
 const r=await a.invoke('POST /reply',{messageId:'m1',instruction:'Hello'});
 assert.equal(r.status,502);assert.equal(a.store.listDrafts(a.account).length,0);
});

test('revoking external AI consent invokes automatic-review shutdown',async t=>{
 const a=setup(t,output);
 await a.invoke('POST /consent',{enabled:true});assert.equal(a.getRevocations(),0);
 await a.invoke('POST /consent',{enabled:false});assert.equal(a.getRevocations(),1);
 assert.equal(a.store.getAiConsent(a.account),false);
});
