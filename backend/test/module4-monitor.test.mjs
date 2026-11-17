import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createStore} from '../src/store.mjs';
import {createMonitor} from '../src/monitoring/monitor.mjs';
import {createPush} from '../src/monitoring/push.mjs';

const key=Buffer.alloc(32,23);
function setup(){
  const store=createStore(':memory:',key);
  const a=store.upsertAccount('owner@example.com','cipher-for-mock-only');
  const notified=[];
  let response={historyId:'100'};
  let calls=0;
  let mailFolder='inbox';
  const gmail={
    async request(_a,path){calls++;
      if(path==='/profile')return {historyId:'100'};
      if(path.startsWith('/history?'))return response;
      throw Error('Invalid request: '+path);
    },
    async message(_a,id){return {id,folder:mailFolder,date:'2026-11-13T16:00:00Z'};}
  };
  const mon=createMonitor({store,gmail,notify:async(_a,id)=>{notified.push(id);return true},workerConfigured:true});
  return {store,a,mon,notified,gmail,setResponse:x=>{response=x},setFolder:x=>{mailFolder=x},getCalls:()=>calls};
}
test('monitor defaults paused, status never falsely reports monitoring',()=>{
  const s=setup();assert.equal(s.mon.status(s.a).status,'Paused');assert.equal(s.mon.status(s.a).workerConfigured,true);
  assert.equal(s.mon.status(s.a).cursorInitialized,false);s.store.close();
});
test('first sync stores Gmail cursor without replaying entire old inbox',async()=>{
  const s=setup();s.mon.enable(s.a,true);
  const result=await s.mon.sync(s.a);assert.equal(result.initialized,true);assert.equal(s.mon.status(s.a).receivedCount,0);
  assert.deepEqual(s.notified,[]);s.store.close();
});
test('incremental history detects inbox additions and deduplicates across runs',async()=>{
  const s=setup();s.mon.enable(s.a,true);await s.mon.sync(s.a);
  s.setResponse({historyId:'110',history:[{messagesAdded:[{message:{id:'msg1'}},{message:{id:'msg1'}},{message:{id:'msg2'}}]}]});
  let r=await s.mon.sync(s.a);assert.equal(r.found,2);assert.deepEqual(s.notified,['msg1','msg2']);
  r=await s.mon.sync(s.a);assert.equal(s.notified.length,2);assert.equal(s.mon.status(s.a).receivedCount,2);
  s.store.close();
});
test('non-inbox events cannot notify, and paused account cannot sync',async()=>{
  const s=setup();s.mon.enable(s.a,true);await s.mon.sync(s.a);
  s.setFolder('sent');s.setResponse({historyId:'112',history:[{messagesAdded:[{message:{id:'sent1'}}]}]});
  const r=await s.mon.sync(s.a);assert.equal(r.found,0);assert.deepEqual(s.notified,[]);
  s.mon.enable(s.a,false);assert.deepEqual(await s.mon.sync(s.a),{skipped:'paused'});s.store.close();
});
test('expired Gmail history resets cursor with explicit gap warning',async()=>{
  const s=setup();s.mon.enable(s.a,true);await s.mon.sync(s.a);
  s.setResponse({});s.gmail.request=async(_a,p)=>{if(p==='/profile')return {historyId:'200'};const e=new Error('Expired');e.externalStatus=404;throw e};
  const r=await s.mon.sync(s.a);assert.equal(r.rebased,true);assert.match(r.warning,/gap/i);
  assert.equal(s.mon.status(s.a).receivedCount,0);s.store.close();
});
test('provider failure retains prior history cursor and reports degraded',async()=>{
  const s=setup();s.mon.enable(s.a,true);await s.mon.sync(s.a);
  s.gmail.request=async()=>{throw Object.assign(new Error('No network'),{status:429})};
  await assert.rejects(s.mon.sync(s.a),/No network/);
  assert.equal(s.store.db.prepare('SELECT history_id FROM monitor_state WHERE account_id=?').get(s.a).history_id,'100');
  assert.ok(s.mon.status(s.a).lastError);s.store.close();
});
test('notification send errors remain in outbox for later retry',async()=>{
  const s=setup();s.mon.enable(s.a,true);await s.mon.sync(s.a);
  const bad=createMonitor({store:s.store,gmail:s.gmail,notify:async()=>{throw Error('FCM down')},workerConfigured:true});
  s.setResponse({historyId:'111',history:[{messagesAdded:[{message:{id:'m3'}}]}]});
  const r=await bad.sync(s.a);assert.equal(r.found,1);assert.equal(r.notified,0);
  assert.equal(bad.status(s.a).pendingNotifications,1);
  assert.equal(await s.mon.flushNotifications(s.a),1);assert.equal(bad.status(s.a).pendingNotifications,0);
  s.store.close();
});
test('notification backend encrypts device token and rejects unconfigured registration',async()=>{
  const s=setup();const disabled=createPush({store:s.store,key,env:{}});
  assert.throws(()=>disabled.register(s.a,{token:'a'.repeat(70),platform:'android'}),/not configured/);
  const pair=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
  const service={client_email:'test@unit-test.invalid',project_id:'testproject',private_key:pair.privateKey.export({type:'pkcs8',format:'pem'})};
  let sent=0;
  const push=createPush({store:s.store,key,env:{FIREBASE_SERVICE_ACCOUNT_JSON_B64:Buffer.from(JSON.stringify(service)).toString('base64')},fetchImpl:async(url,req)=>{
    if(url.includes('oauth2'))return {ok:true,json:async()=>({access_token:'mock-access-token',expires_in:3600})};
    assert.equal(req.method,'POST');const body=JSON.parse(req.body);assert.equal(body.message.notification.body,'New email available for review.');sent++;
    return {ok:true,json:async()=>({name:'projects/test/messages/1'})};
  }});
  const token='m'.repeat(130);const registered=push.register(s.a,{token,platform:'android'});
  assert.equal(push.list(s.a).length,1);
  const raw=s.store.db.prepare('SELECT token_cipher FROM push_devices WHERE id=?').get(registered.id).token_cipher;
  assert.ok(!raw.includes(token));assert.equal(await push.notify(s.a,'mail-1'),true);assert.equal(sent,1);
  assert.equal(push.remove(s.a,registered.id),true);assert.equal(push.list(s.a).length,0);
  s.store.close();
});

test('manual checks do not falsely claim scheduled cloud worker is alive',async()=>{
  const s=setup();s.mon.enable(s.a,true);await s.mon.sync(s.a);
  assert.equal(s.mon.status(s.a).status,'Waiting for worker');
  await s.mon.syncEnabled();assert.equal(s.mon.status(s.a).status,'Monitoring');s.store.close();
});

test('push tokens are deleted when owner signs out and account data can be cleaned',()=>{
  const s=setup();
  const pair=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
  const cfg={client_email:'test@unit-test.invalid',project_id:'test',private_key:pair.privateKey.export({type:'pkcs8',format:'pem'})};
  const push=createPush({store:s.store,key,env:{FIREBASE_SERVICE_ACCOUNT_JSON_B64:Buffer.from(JSON.stringify(cfg)).toString('base64')}});
  push.register(s.a,{token:'v'.repeat(140),platform:'web'});
  assert.equal(push.clearAccount(s.a),1);assert.equal(push.list(s.a).length,0);s.store.close();
});

test('FCM partial failures never resend notifications to already-acknowledged devices',async()=>{
  const s=setup();const pair=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
  const service={client_email:'test@unit.invalid',project_id:'project',private_key:pair.privateKey.export({type:'pkcs8',format:'pem'})};
  const attempts=new Map();let failSecond=true;
  const p=createPush({store:s.store,key,env:{FIREBASE_SERVICE_ACCOUNT_JSON_B64:Buffer.from(JSON.stringify(service)).toString('base64')},fetchImpl:async(url,req)=>{
    if(url.includes('oauth2'))return {ok:true,json:async()=>({access_token:'mock',expires_in:3600})};
    const token=JSON.parse(req.body).message.token;attempts.set(token,(attempts.get(token)||0)+1);
    if(token==='Y'.repeat(140)&&failSecond){failSecond=false;return {ok:false,status:429}}
    return {ok:true,json:async()=>({name:'projects/test/messages/1'})};
  }});
  const one='X'.repeat(140),two='Y'.repeat(140);
  p.register(s.a,{token:one,platform:'web'});p.register(s.a,{token:two,platform:'android'});
  assert.equal(await p.notify(s.a,'first-message'),false);
  assert.equal(await p.notify(s.a,'first-message'),true);
  assert.equal(attempts.get(one),1,'successful first device must not be resent');
  assert.equal(attempts.get(two),2,'second device retries only after explicit 429');
  assert.equal(await p.notify(s.a,'first-message'),true);
  assert.equal(attempts.get(one),1);assert.equal(attempts.get(two),2);
  s.store.close();
});

test('an uncertain FCM network result is not blindly retried',async()=>{
  const s=setup();const pair=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
  const cfg={client_email:'test@unit.invalid',project_id:'project',private_key:pair.privateKey.export({type:'pkcs8',format:'pem'})};
  let calls=0;
  const push=createPush({store:s.store,key,env:{FIREBASE_SERVICE_ACCOUNT_JSON_B64:Buffer.from(JSON.stringify(cfg)).toString('base64')},fetchImpl:async(url)=>{
    if(url.includes('oauth2'))return {ok:true,json:async()=>({access_token:'mock',expires_in:3600})};
    calls++;throw new Error('network interrupted after request');
  }});
  push.register(s.a,{token:'Z'.repeat(140),platform:'android'});
  assert.equal(await push.notify(s.a,'uncertain-message'),false);
  assert.equal(await push.notify(s.a,'uncertain-message'),false);
  assert.equal(calls,1,'ambiguous result should not trigger duplicate send');
  assert.equal(s.store.db.prepare('SELECT state FROM push_delivery').get().state,'unknown');
  s.store.close();
});

test('push notification routes to review center for a pending automatic draft',async()=>{
  const s=setup();const pair=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
  const cfg={client_email:'test@unit.invalid',project_id:'project',private_key:pair.privateKey.export({type:'pkcs8',format:'pem'})};
  let route='';let body='';
  const push=createPush({store:s.store,key,env:{FIREBASE_SERVICE_ACCOUNT_JSON_B64:Buffer.from(JSON.stringify(cfg)).toString('base64')},fetchImpl:async(url,req)=>{
    if(url.includes('oauth2'))return {ok:true,json:async()=>({access_token:'mock',expires_in:3600})};
    const msg=JSON.parse(req.body).message;route=msg.data.route;body=msg.notification.body;
    return {ok:true,json:async()=>({name:'projects/test/messages/2'})};
  }});
  push.register(s.a,{token:'Q'.repeat(140),platform:'web'});
  s.store.db.prepare("INSERT INTO monitor_events(account_id,message_id,created_at,ai_state,draft_id) VALUES(?, ?, ?, 'done', ?)").run(s.a,'review-me',Date.now(),'a-private-draft-id');
  assert.equal(await push.notify(s.a,'review-me'),true);
  assert.equal(route,'approvals');assert.match(body,/approval/i);
  s.store.close();
});

test('push delivery waits for a review draft while opted-in AI processing is pending',async()=>{
  const s=setup();s.mon.enable(s.a,true);
  s.mon.configureAuto(s.a,{enabled:true,dailyLimit:5,scope:'all-eligible'});
  await s.mon.sync(s.a);
  s.setResponse({historyId:'200',history:[{messagesAdded:[{message:{id:'pending-reply'}}]}]});
  const first=await s.mon.sync(s.a);
  assert.equal(first.found,1);
  assert.deepEqual(s.notified,[], 'must not notify inbox while an approval draft may still be prepared');
  assert.equal(s.mon.status(s.a).aiPending,1);
  // Simulate a validated draft commit; notification is routed to Approval Center by push layer.
  s.store.db.prepare("UPDATE monitor_events SET ai_state='done',draft_id='draft-for-review' WHERE account_id=? AND message_id='pending-reply'").run(s.a);
  assert.equal(await s.mon.flushNotifications(s.a),1);
  assert.deepEqual(s.notified,['pending-reply']);
  s.store.close();
});
