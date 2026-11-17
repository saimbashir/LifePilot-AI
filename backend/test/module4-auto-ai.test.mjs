import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from '../src/store.mjs';
import {createMonitor} from '../src/monitoring/monitor.mjs';
import {createAutoAssistant,autoEligibility} from '../src/monitoring/assistant.mjs';
import {unseal} from '../src/security.mjs';

const key=Buffer.alloc(32,72);
const mail={id:'mail-new',folder:'inbox',category:'Primary',from:'Professor Ali',email:'prof@example.edu',replyTo:'prof@example.edu',subject:'Research meeting',date:'2026-11-13T10:00:00Z',body:'Please share your available days for our research meeting.',attachments:[],isAutomated:false};
function setup({limit=2}={}){
  const store=createStore(':memory:',key);const a=store.upsertAccount('owner@example.com','mock encrypted token');
  let m={...mail};let history={historyId:'101',history:[{messagesAdded:[{message:{id:'mail-new'}}]}]};
  let calls=0;let error=null;
  const gmail={request:async(_a,p)=>p==='/profile'?{historyId:'100'}:history,
    message:async()=>({...m}),
    replySource:async()=>({sourceEmailId:'mail-new',threadId:'th-1',inReplyTo:'<msg1@example.edu>',references:'',originalSender:m.email,to:m.replyTo||m.email,subject:'Re: '+m.subject})};
  const model={config:{configured:true,enabled:true,maxInputChars:18000},generate:async()=>{
    calls++; if(error)throw error;
    if(calls%2===1)return {data:{summary:'Research meeting days requested.',keyPoints:['Request for meeting days'],dates:['2028-01-01'],actionItems:['Suggest availability'],uncertainties:[]},usage:{promptTokens:10,completionTokens:4}};
    return {data:{subject:'bad model subject ignored',body:'Thank you. I will review my availability and respond.'},usage:{promptTokens:8,completionTokens:5}};
  }};
  const monitor=createMonitor({store,gmail,notify:async()=>false,workerConfigured:true});
  const assistant=createAutoAssistant({store,gmail,model,key,maxPerRun:1});
  monitor.setAutoAssistant(assistant);
  monitor.enable(a,true);monitor.configureAuto(a,{enabled:true,dailyLimit:limit});
  return {store,a,monitor,gmail,assistant,model,setMail:x=>m={...m,...x},setError:x=>error=x,getCalls:()=>calls,setHistory:x=>history=x};
}
async function newMessage(s){await s.monitor.sync(s.a);return s.monitor.sync(s.a)}
test('requires separate auto opt-in and explicit consent before external AI calls',async()=>{
  const s=setup();const r=await newMessage(s);
  assert.equal(r.autoAi.skipped,'external AI consent not granted');assert.equal(s.getCalls(),0);
  assert.equal(s.store.listDrafts(s.a).length,0);s.store.close();
});
test('creates an encrypted Roman Urdu summary and PENDING review-only draft, not a send',async()=>{
  const s=setup();s.store.setAiConsent(s.a,true);const r=await newMessage(s);
  assert.equal(r.autoAi.created,1);
  assert.equal(s.getCalls(),2);
  const drafts=s.store.listDrafts(s.a);
  assert.equal(drafts.length,1);assert.equal(drafts[0].status,'pending');
  assert.equal(drafts[0].to,'prof@example.edu');assert.equal(drafts[0].subject,'Re: Research meeting');
  assert.equal(s.store.db.prepare('SELECT COUNT(*) AS n FROM send_attempts').get().n,0);
  const event=s.store.db.prepare('SELECT * FROM monitor_events WHERE account_id=?').get(s.a);
  assert.equal(event.ai_state,'done');assert.equal(event.draft_id,drafts[0].id);
  assert.equal(JSON.parse(unseal(event.summary_cipher,key)).dates.length,0); // no invented dates
  assert.ok(!event.summary_cipher.includes('Research meeting days requested.'));
  assert.throws(()=>s.store.reserveSend(s.a,drafts[0].id,drafts[0].version,'model-made-id'),/Explicit approval/);
  s.store.close();
});
test('opt-in after event arrival does not retroactively process historical mail',async()=>{
  const s=setup();s.store.setAiConsent(s.a,true);s.monitor.configureAuto(s.a,{enabled:false,dailyLimit:2});
  await newMessage(s);s.monitor.configureAuto(s.a,{enabled:true,dailyLimit:2});
  const out=await s.assistant.process(s.a);assert.equal(out.created,0);assert.equal(s.getCalls(),0);
  assert.equal(s.store.listDrafts(s.a).length,0);s.store.close();
});
test('conservative classifier excludes OTP, automated senders, newsletters, sensitive and long mail',()=>{
  for(const candidate of [{subject:'Your OTP is 1234'},{email:'no-reply@service.com'},{isAutomated:true},{category:'Promotions'},{body:'x'.repeat(15000)},{subject:'Payment receipt'}]){
    assert.equal(autoEligibility({...mail,...candidate},'owner@example.com').eligible,false);
  }
  assert.equal(autoEligibility(mail,'owner@example.com').eligible,true);
});
test('model failure keeps message eligible for bounded retry and never creates a draft',async()=>{
  const s=setup();s.store.setAiConsent(s.a,true);s.setError(Object.assign(new Error('rate limit'),{status:429}));
  const r=await newMessage(s);assert.equal(r.autoAi.failed,1);
  assert.equal(s.store.listDrafts(s.a).length,0);
  for(let i=0;i<2;i++)await s.assistant.process(s.a);
  assert.equal(s.store.db.prepare('SELECT ai_state FROM monitor_events').get().ai_state,'failed');
  assert.equal((await s.assistant.process(s.a)).created,0);s.store.close();
});
test('malformed model output is not recorded as success',async()=>{
  const s=setup();s.store.setAiConsent(s.a,true);s.model.generate=async()=>({data:{summary:'missing required arrays'},usage:{}});
  const r=await newMessage(s);assert.equal(r.autoAi.failed,1);
  assert.equal(s.store.listDrafts(s.a).length,0);s.store.close();
});
test('auto daily limit validates input and keeps the service conservative',()=>{
  const s=setup();assert.throws(()=>s.monitor.configureAuto(s.a,{enabled:true,dailyLimit:999}),/1–25/);
  assert.throws(()=>s.monitor.configureAuto(s.a,{enabled:'true',dailyLimit:1}),/boolean/);s.store.close();
});
test('reply model cannot claim unverified attachments',async()=>{
  const s=setup();s.store.setAiConsent(s.a,true);let n=0;
  s.model.generate=async()=>++n%2?{data:{summary:'Summary',keyPoints:[],dates:[],actionItems:[],uncertainties:[]},usage:{}}:{data:{subject:'Re: meeting',body:'My CV is attached.'},usage:{}};
  const r=await newMessage(s);assert.equal(r.autoAi.failed,1);assert.equal(s.store.listDrafts(s.a).length,0);s.store.close();
});

test('expired history attempts bounded Gmail inbox reconciliation without duplicate events',async()=>{
  const s=setup();s.store.setAiConsent(s.a,true);await s.monitor.sync(s.a);
  const initial=await s.monitor.sync(s.a);assert.equal(initial.found,1);
  s.gmail.request=async(_a,p)=>{if(p==='/profile')return {historyId:'900'};throw Object.assign(new Error('expired'),{externalStatus:404})};
  s.gmail.list=async()=>({mails:[{id:'mail-new',folder:'inbox',date:new Date().toISOString()},{id:'extra-mail',folder:'inbox',date:new Date().toISOString()}],nextPageToken:null});
  const result=await s.monitor.sync(s.a);assert.equal(result.rebased,true);
  assert.equal(result.found,2);
  assert.equal(s.store.db.prepare('SELECT COUNT(*) AS n FROM monitor_events').get().n,2);
  assert.equal(s.store.db.prepare('SELECT history_id FROM monitor_state').get().history_id,'900');
  assert.match(result.warning,/gap/i);s.store.close();
});

test('failed Gmail recovery never advances a history cursor or discards pending events',async()=>{
  const s=setup();await s.monitor.sync(s.a);
  s.gmail.request=async(_a,p)=>{if(p==='/profile')return {historyId:'999'};throw Object.assign(new Error('expired'),{externalStatus:404})};
  s.gmail.list=async()=>{throw new Error('recovery offline')};
  await assert.rejects(s.monitor.sync(s.a),/recovery offline/);
  assert.equal(s.store.db.prepare('SELECT history_id FROM monitor_state').get().history_id,'100');s.store.close();
});

test('revoking AI consent during an async provider call prevents an automatic draft',async()=>{
  const s=setup();s.store.setAiConsent(s.a,true);
  s.model.generate=async()=>{
    s.store.setAiConsent(s.a,false);
    return {data:{summary:'A request',keyPoints:[],dates:[],actionItems:[],uncertainties:[]},usage:{}};
  };
  const r=await newMessage(s);
  assert.equal(r.autoAi.failed,1);
  assert.equal(s.store.listDrafts(s.a).length,0);
  assert.equal(s.store.getAiConsent(s.a),false);
  s.store.close();
});


test('broad opt-in accepts human Updates/Forums messages but never automated or sensitive mail',()=>{
  assert.equal(autoEligibility({...mail,category:'Updates'},'owner@example.com').eligible,false);
  assert.equal(autoEligibility({...mail,category:'Updates'},'owner@example.com',12000,'all-eligible').eligible,true);
  assert.equal(autoEligibility({...mail,category:'Forums'},'owner@example.com',12000,'all-eligible').eligible,true);
  for(const category of ['Promotions','Social'])assert.equal(autoEligibility({...mail,category},'owner@example.com',12000,'all-eligible').eligible,false);
  assert.equal(autoEligibility({...mail,category:'Updates',subject:'Your verification code'},'owner@example.com',12000,'all-eligible').eligible,false);
});

test('broader scope and 25/day maximum are explicit, persisted and validated',()=>{
  const s=setup();
  const status=s.monitor.configureAuto(s.a,{enabled:true,dailyLimit:25,scope:'all-eligible'});
  assert.equal(status.autoAiDailyLimit,25);assert.equal(status.autoAiScope,'all-eligible');
  assert.equal(s.store.db.prepare('SELECT auto_ai_scope FROM monitor_state WHERE account_id=?').get(s.a).auto_ai_scope,'all-eligible');
  assert.throws(()=>s.monitor.configureAuto(s.a,{enabled:true,dailyLimit:26,scope:'all-eligible'}),/1–25/);
  assert.throws(()=>s.monitor.configureAuto(s.a,{enabled:true,dailyLimit:3,scope:'unlimited'}),/Invalid AI monitoring scope/);
  s.store.close();
});

test('reprocessing the same Gmail message does not create or send duplicate drafts',async()=>{
  const s=setup();s.store.setAiConsent(s.a,true);
  const first=await newMessage(s);assert.equal(first.autoAi.created,1);
  const second=await s.monitor.sync(s.a);
  assert.equal(second.autoAi.created,0);
  assert.equal(s.store.listDrafts(s.a).length,1);
  assert.equal(s.store.db.prepare('SELECT COUNT(*) AS n FROM send_attempts').get().n,0);
  s.store.close();
});


test('notification waits for review draft and opens approvals instead of arriving prematurely',async()=>{
  const s=setup();s.store.setAiConsent(s.a,true);
  // Use the existing notification outbox; after provider success the event has a draft id.
  s.setError(Object.assign(new Error('429'),{status:429}));
  await newMessage(s);
  let evt=s.store.db.prepare('SELECT * FROM monitor_events').get();
  assert.equal(evt.ai_state,'pending');
  assert.equal(evt.notified_at,null);
  s.setError(null);
  let n=0;
  s.model.generate=async()=>++n%2?{data:{summary:'Meeting request',keyPoints:[],dates:[],actionItems:[],uncertainties:[]},usage:{}}:{data:{subject:'Re: meeting',body:'Thank you for the email. I will review your request.'},usage:{}};
  const out=await s.assistant.process(s.a);
  assert.equal(out.created,1);
  evt=s.store.db.prepare('SELECT * FROM monitor_events').get();
  assert.equal(evt.ai_state,'done');
  assert.ok(evt.draft_id);
  assert.equal(s.store.db.prepare('SELECT COUNT(*) AS n FROM send_attempts').get().n,0);
  s.store.close();
});

test('switching off automatic AI clears queued review status without ever sending',async()=>{
  const s=setup();await newMessage(s);
  assert.equal(s.store.db.prepare('SELECT ai_state FROM monitor_events').get().ai_state,'pending');
  s.monitor.configureAuto(s.a,{enabled:false,dailyLimit:2});
  assert.equal(s.store.db.prepare('SELECT ai_state FROM monitor_events').get().ai_state,'skipped');
  assert.equal(s.store.listDrafts(s.a).length,0);
  s.store.close();
});
