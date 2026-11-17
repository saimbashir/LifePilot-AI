import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createStore} from '../src/store.mjs';
import {seal} from '../src/security.mjs';
// The real Express route test executes when backend dependencies have been installed.
let express,createAiRouter;
try{express=(await import('express')).default;({createAiRouter}=await import('../src/ai/routes.mjs'));}catch{/* this sandbox cannot resolve npm registry */}
test('AI endpoints: authenticated consent, summaries, draft-only replies, and preferences', {skip:!express?'Express installation unavailable in this environment':false}, async t=>{
  const key=crypto.randomBytes(32),store=createStore(':memory:',key);
  t.after(()=>store.close());const account=store.upsertAccount('owner@example.com',seal('token',key));
  const sent=[];
  const gmail={
    message:async(_a,id)=>({id,from:'Ahmad',email:'ahmad@example.com',to:'owner@example.com',subject:'Application',date:'2026-11-11',body:'Please review my proposal by November 20, 2026.',attachments:[]}),
    replySource:async(_a,id)=>({sourceEmailId:id,threadId:'t1',inReplyTo:'<msg1@example.com>',references:'',originalSender:'ahmad@example.com',to:'ahmad@example.com',subject:'Re: Application'}),
    list:async()=>({mails:[{id:'m1',from:'Ahmad',email:'ahmad@example.com',subject:'Application',date:'2026-11-11'}]}),
    send:async()=>{sent.push('send');throw Error('AI MUST NEVER call Gmail send')}
  };
  const response={summary:'Ahmad ne proposal review karne ko kaha hai.',keyPoints:['Review proposal'],dates:['November 20, 2026'],actionItems:['Review proposal'],uncertainties:[]};
  const model={config:{configured:true,enabled:true,maxInputChars:18000,model:'test-model'},generate:async({system,user})=>{
    if(system.includes('Summarize ONLY'))return {data:response,usage:{promptTokens:10,completionTokens:15}};
    if(system.includes('TASK: Classify'))return {data:{intent:'show_unread',language:'roman-urdu'}};
    return {data:{subject:'AI Suggested',body:'Thank you for your message. I will review it.'},usage:{promptTokens:11,completionTokens:14}};
  }};
  const app=express();app.use(express.json());app.use('/api/ai',(req,res,next)=>{if(req.headers['x-test-auth']!=='yes')return res.status(401).json({error:'Unauthorized'});next()});
  const check=(req,res,next)=>req.headers['x-csrf-token']==='csrf'?next():res.status(403).json({error:'Missing CSRF'});
  app.use('/api/ai',createAiRouter({store,gmail,getAccountId:()=>account,requireCsrf:check,model,routerFactory:()=>express.Router()}));
  const server=app.listen(0,'127.0.0.1');t.after(()=>server.close());
  await new Promise(resolve=>server.once('listening',resolve));const url=`http://127.0.0.1:${server.address().port}/api/ai`;
  const req=async(path,method='GET',body,csrf=true,auth=true)=>{const r=await fetch(url+path,{method,headers:{'Content-Type':'application/json',...(auth?{'x-test-auth':'yes'}:{}),...(csrf?{'x-csrf-token':'csrf'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()}};
  assert.equal((await req('/status','GET',undefined,true,false)).status,401);
  assert.equal((await req('/summarize','POST',{messageId:'m1',language:'roman-urdu'})).status,403);
  assert.equal((await req('/consent','POST',{enabled:true},false)).status,403);
  assert.equal((await req('/consent','POST',{enabled:true})).data.consent,true);
  const summary=await req('/summarize','POST',{messageId:'m1',language:'roman-urdu'});assert.equal(summary.status,200);assert.deepEqual(summary.data.dates,['November 20, 2026']);
  const draft=await req('/reply','POST',{messageId:'m1',instruction:'Politely acknowledge',language:'roman-urdu'});
  assert.equal(draft.status,201);assert.equal(draft.data.to,'ahmad@example.com');assert.equal(draft.data.status,'draft');assert.equal(sent.length,0);
  assert.equal(store.getDraft(account,draft.data.id).body,'Thank you for your message. I will review it.');
  const update=await req('/preferences','PATCH',{closing:'Yours sincerely'});assert.equal(update.data.closing,'Yours sincerely');
  assert.equal((await req('/command','POST',{text:'Show my unread emails',language:'roman-urdu'})).data.folder,'unread');
  assert.equal((await req('/consent','POST',{enabled:false})).data.consent,false);
  assert.equal((await req('/reply','POST',{messageId:'m1',instruction:'Please reply'})).status,403);
  assert.equal(sent.length,0);
});
