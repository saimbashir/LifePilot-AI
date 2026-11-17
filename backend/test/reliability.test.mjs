import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {parseCookies,seal,unseal} from '../src/security.mjs';
import {createGmail,decodeMessage,buildMime} from '../src/gmail.mjs';
const key=crypto.randomBytes(32);
function gmailPayload(id,headers=[]){return {id,threadId:'thread-'+id,internalDate:'1730000000000',labelIds:['INBOX'],payload:{headers:[{name:'From',value:'Sender <person@example.com>'},{name:'Subject',value:'Testing'},{name:'Message-ID',value:`<${id}@example.com>`},...headers],mimeType:'text/plain',body:{data:Buffer.from('Test message').toString('base64url')}}}}
function accountStore(initial){let tokens=initial;let updates=0;return {store:{accountById:()=>({email:'me@example.com',token_cipher:seal(JSON.stringify(tokens),key)}),updateTokens:(_id,value)=>{tokens=JSON.parse(unseal(value,key));updates++;}},get updates(){return updates}}}
const respond=obj=>({ok:true,status:200,text:async()=>JSON.stringify(obj)});
test('untrusted malformed cookie encoding cannot crash session lookup',()=>{
  const value=parseCookies('lp_session=%not-valid; other=good%20cookie');
  assert.equal(value.lp_session,'%not-valid');assert.equal(value.other,'good cookie');
});
test('reply uses Reply-To header and preserves message threading',async()=>{
  const a=accountStore({access_token:'current',refresh_token:'ref',expires_at:Date.now()+3600e3});
  const fetchImpl=async(url)=>respond(gmailPayload('m1',[{name:'Reply-To',value:'Applications Team <applications@example.org>'}]));
  const svc=createGmail({store:a.store,key,clientId:'x',clientSecret:'y',fetchImpl});
  const reply=await svc.replySource('acct','m1');
  assert.equal(reply.to,'applications@example.org');
  const mail=buildMime({to_addr:reply.to,cc:'',bcc:'',subject:reply.subject,body:'Thanks',thread_id:reply.threadId,in_reply_to:reply.inReplyTo,references_header:'',original_sender:reply.originalSender},{from:'me@example.com',key});
  assert.match(Buffer.from(mail,'base64url').toString(),/In-Reply-To: <m1@example.com>/);
});
test('reply to own sent message targets recipient, not self',async()=>{
  const a=accountStore({access_token:'current',refresh_token:'ref',expires_at:Date.now()+3600e3});
  const sent=gmailPayload('sent1',[{name:'To',value:'Alex <alex@example.net>'},{name:'Reply-To',value:'Me <me@example.com>'}]);
  sent.payload.headers[0]={name:'From',value:'Me <me@example.com>'};
  const fetchImpl=async()=>respond(sent);
  const svc=createGmail({store:a.store,key,clientId:'x',clientSecret:'y',fetchImpl});
  assert.equal((await svc.replySource('acct','sent1')).to,'alex@example.net');
});
test('25-email inbox details use no more than 5 concurrent Gmail requests',async()=>{
  const a=accountStore({access_token:'current',refresh_token:'ref',expires_at:Date.now()+3600e3});
  let active=0,peak=0,detailCalls=0;
  const fetchImpl=async(url)=>{
    const path=new URL(url).pathname;
    if(path.endsWith('/messages'))return respond({messages:Array.from({length:25},(_,i)=>({id:`m${i}`}))});
    if(path.includes('/messages/m')){
      active++;peak=Math.max(peak,active);detailCalls++;
      await new Promise(r=>setTimeout(r,3));active--;
      return respond(gmailPayload(path.split('/').at(-1)));
    }
    throw Error('Unexpected endpoint '+path);
  };
  const svc=createGmail({store:a.store,key,clientId:'x',clientSecret:'y',fetchImpl});
  const result=await svc.list('acct',{limit:25});
  assert.equal(result.mails.length,25);assert.equal(detailCalls,25);
  assert.ok(peak<=5,`Peak concurrency was ${peak}`);assert.ok(peak>1);
});
test('parallel Gmail requests perform only one OAuth refresh',async()=>{
  const a=accountStore({access_token:'expired',refresh_token:'ref',expires_at:Date.now()-1000});
  let refreshes=0;
  const fetchImpl=async(url)=>{
    if(String(url).includes('oauth2.googleapis.com')){refreshes++;await new Promise(r=>setTimeout(r,15));return respond({access_token:'renewed',expires_in:3600})}
    if(String(url).includes('/labels/INBOX'))return respond({messagesTotal:1,messagesUnread:0});
    if(String(url).includes('/labels/IMPORTANT'))return respond({messagesTotal:0,messagesUnread:0});
    throw Error('Unexpected '+url);
  };
  const svc=createGmail({store:a.store,key,clientId:'x',clientSecret:'y',fetchImpl});
  const results=await Promise.all([svc.stats('acct'),svc.stats('acct'),svc.stats('acct')]);
  assert.equal(results.length,3);assert.equal(refreshes,1);assert.equal(a.updates,1);
});
