import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createStore} from '../src/store.mjs';
import {seal,sha} from '../src/security.mjs';
import {createGroq,providerConfig} from '../src/ai/provider.mjs';
import {interpretCommand,resolveCommand} from '../src/ai/intent.mjs';
import {validateSummary,validateDraftOutput,validateIntent,preferencesPatch} from '../src/ai/schemas.mjs';
import {summaryPrompt,draftPrompt,intentPrompt} from '../src/ai/prompts.mjs';
const key=crypto.randomBytes(32);
const setup=t=>{const store=createStore(':memory:',key);t.after(()=>store.close());const a=store.upsertAccount('owner@example.com',seal('token',key));return {store,a}};
const jsonResponse=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
const groqEnv={AI_ENABLED:'true',AI_PROVIDER:'groq',GROQ_MODEL:'openai/gpt-oss-20b',GROQ_API_KEY:'FAKE_TEST_KEY_NEVER_REAL',AI_TIMEOUT_MS:'3000'};
const validSummary={summary:'Sender requests a portfolio.',keyPoints:['Send portfolio'],dates:[],actionItems:['Review portfolio request'],uncertainties:[]};
test('AI off by default: incomplete configuration cannot issue provider calls',async()=>{
  const model=createGroq({env:{},fetchImpl:()=>{throw Error('should not call')}});
  assert.equal(model.config.configured,false);assert.equal(model.config.enabled,false);
  await assert.rejects(model.generate({system:'s',user:'u'}),e=>e.status===503);
});
test('provider sends JSON-only, minimal backend request with no key in output',async()=>{
  let called=0;
  const fetchImpl=async(url,init)=>{called++;assert.equal(url,'https://api.groq.com/openai/v1/chat/completions');assert.equal(init.headers.Authorization,'Bearer '+groqEnv.GROQ_API_KEY);
    const parsed=JSON.parse(init.body);assert.equal(parsed.response_format.type,'json_object');assert.equal(parsed.model,'openai/gpt-oss-20b');
    assert.equal(parsed.messages.length,2);assert.ok(init.signal);return jsonResponse({choices:[{message:{content:JSON.stringify(validSummary)}}],usage:{prompt_tokens:12,completion_tokens:25}})};
  const model=createGroq({env:groqEnv,fetchImpl});const r=await model.generate({system:'s',user:'u'});assert.equal(called,1);assert.deepEqual(r.data,validSummary);assert.equal(r.usage.promptTokens,12);assert.ok(!JSON.stringify(r).includes('FAKE_TEST_KEY'));
});
test('provider rate limiting returns 429 and safe fallback',async()=>{
  const model=createGroq({env:groqEnv,fetchImpl:async()=>jsonResponse({error:{message:'secret'}},429)});
  await assert.rejects(model.generate({system:'s',user:'u'}),e=>e.status===429&&!e.message.includes('secret'));
});
test('provider timeout/network failure returns safe 502',async()=>{
  const model=createGroq({env:groqEnv,fetchImpl:async()=>{throw new Error('key: FAKE_TEST_KEY')}});
  await assert.rejects(model.generate({system:'s',user:'u'}),e=>e.status===502&&!e.message.includes('KEY'));
});
test('provider invalid JSON must not be accepted',async()=>{
  const model=createGroq({env:groqEnv,fetchImpl:async()=>jsonResponse({choices:[{message:{content:'{broken'}}]})});
  await assert.rejects(model.generate({system:'s',user:'u'}),e=>e.status===502);
});
test('provider missing model response must not be accepted',async()=>{
  const model=createGroq({env:groqEnv,fetchImpl:async()=>jsonResponse({choices:[{message:{content:null}}]})});
  await assert.rejects(model.generate({system:'s',user:'u'}),e=>e.status===502);
});
test('provider 401/403 errors never copy remote error details into UI',async()=>{
  for(const status of [401,403,500]){
    const model=createGroq({env:groqEnv,fetchImpl:async()=>jsonResponse({error:'provider_private_info'},status)});
    await assert.rejects(model.generate({system:'s',user:'u'}),e=>e.status===502&&!e.message.includes('provider_private_info'));
  }
});
test('provider input and output token configuration is bounded',()=>{
  const c=providerConfig({...groqEnv,AI_MAX_INPUT_CHARS:'999999',AI_MAX_OUTPUT_TOKENS:'999999',AI_TIMEOUT_MS:'999999'});
  assert.ok(c.maxInputChars<=50000&&c.maxOutputTokens<=3000&&c.timeoutMs<=60000);
});
test('summary schema validates arrays and rejects missing body',()=>{
  assert.deepEqual(validateSummary(validSummary),validSummary);
  assert.throws(()=>validateSummary({...validSummary,summary:undefined}),e=>e.status===502);
  assert.throws(()=>validateSummary({...validSummary,dates:['a',55]}),e=>e.status===502);
});
test('Roman Urdu and simple/professional English prompts emphasize source, dates and injection resistance',()=>{
  for(const lang of ['roman-urdu','simple-english','professional-english']){const p=summaryPrompt(lang);assert.ok(p.includes(lang));assert.match(p,/UNTRUSTED/);assert.match(p,/date/i)}
});
test('draft output validation rejects missing subject, CRLF header injection is removed',()=>{
  assert.deepEqual(validateDraftOutput({subject:'Hi\r\nBcc: unsafe@example.com',body:'Hello'}).subject,'Hi  Bcc: unsafe@example.com');
  assert.throws(()=>validateDraftOutput({subject:'',body:'X'}),e=>e.status===502);
  assert.match(draftPrompt({tone:'Professional',length:'Short',language:'roman-urdu',reply:true}),/Never invent/);
});
test('intent validation rejects unknown tool/action and provider URLs',()=>{
  assert.throws(()=>validateIntent({intent:'send_email_now'}),e=>e.status===502);
  assert.equal(validateIntent({intent:'show_unread',url:'https://untrusted.test'}).intent,'show_unread');
  assert.ok(!('url'in validateIntent({intent:'show_unread',url:'https://untrusted.test'})));
  assert.match(intentPrompt,/never/i);
});
test('command recipient must appear literally in user utterance, never invented by model',async()=>{
  const model={generate:async()=>({data:{intent:'compose_email',recipient:'invented@example.com',instruction:'Hello'}})};
  const result=await interpretCommand({model,command:'Compose a message to Professor about internship'});
  assert.equal(result.intent,'clarify');assert.equal(result.recipient,'');
  const explicit=await interpretCommand({model,command:'Compose to professor@example.com about internship'});
  assert.equal(explicit.intent,'compose_email');assert.equal(explicit.recipient,'professor@example.com');
});
test('voice command never requests an automatic send even when user says send',async()=>{
  const model={generate:async()=>({data:{intent:'compose_email',recipient:'x@y.com',instruction:'Please send now'}})};
  const command=await interpretCommand({model,command:'Compose an email to x@y.com and send now'});
  const result=await resolveCommand({parsed:command,accountId:'a',gmail:{}});
  assert.equal(result.route,'compose');assert.equal(result.requiresReview,true);assert.ok(!('send'in result));
});
test('command search returns clarification with multiple sender identities',async()=>{
  const gmail={list:async()=>({mails:[{id:'a',email:'ahmad.one@example.com',from:'Ahmad',subject:'A',date:'2026-11-01'},{id:'b',email:'ahmad.two@example.com',from:'Ahmad',subject:'B',date:'2026-11-02'}]})};
  const result=await resolveCommand({parsed:{intent:'reply_to_email',sender:'Ahmad',query:''},accountId:'a',gmail});
  assert.equal(result.intent,'clarify');assert.equal(result.requestedIntent,'reply_to_email');assert.equal(result.candidates.length,2);
});
test('only one matching sender selects newest Gmail id and retains explicit reply consent barrier',async()=>{
  const gmail={list:async()=>({mails:[{id:'older',email:'ahmad@example.com',date:'2026-10-01'},{id:'newer',email:'ahmad@example.com',date:'2026-11-01'}]})};
  const result=await resolveCommand({parsed:{intent:'reply_to_email',sender:'Ahmad'},accountId:'a',gmail});
  assert.equal(result.messageId,'newer');assert.equal(result.requiresReview,true);
});
test('unread intent routes to real inbox without Gmail sending',async()=>{
  const result=await resolveCommand({parsed:{intent:'show_unread'},accountId:'a',gmail:{}});
  assert.equal(result.folder,'unread');assert.equal(result.route,'inbox');
});
test('no-match search safely asks to clarify',async()=>{
  const result=await resolveCommand({parsed:{intent:'summarize_email',query:'internship'},accountId:'a',gmail:{list:async()=>({mails:[]})}});
  assert.equal(result.intent,'clarify');assert.deepEqual(result.candidates,[]);
});
test('AI consent is account-scoped and opt-out immediately persists',t=>{
  const {store,a}=setup(t);const b=store.upsertAccount('other@example.com',seal('token',key));
  assert.equal(store.getAiConsent(a),false);store.setAiConsent(a,true);assert.equal(store.getAiConsent(a),true);
  assert.equal(store.getAiConsent(b),false);store.setAiConsent(a,false);assert.equal(store.getAiConsent(a),false);
});
test('AI preferences encrypted at rest, editable and deletable',t=>{
  const {store,a}=setup(t);const p=store.updateAiPreferences(a,preferencesPatch({closing:'Yours sincerely',greeting:'Dear Professor',tone:'Warm'}));
  assert.equal(p.closing,'Yours sincerely');const raw=store.db.prepare('SELECT preferences_cipher FROM ai_accounts WHERE account_id=?').get(a).preferences_cipher;
  assert.ok(!raw.includes('Yours sincerely'));assert.equal(store.getAiPreferences(a).greeting,'Dear Professor');
  store.resetAiPreferences(a);assert.notEqual(store.getAiPreferences(a).closing,'Yours sincerely');
});
test('AI preferences reject unexpected properties, excessively long inputs and invalid speech speeds',()=>{
  assert.throws(()=>preferencesPatch({apiKey:'secret'}),e=>e.status===400);
  assert.throws(()=>preferencesPatch({greeting:'a'.repeat(200)}),e=>e.status===400);
  assert.throws(()=>preferencesPatch({speechRate:3}),e=>e.status===400);
});
test('AI account consent, usage and preferences vanish on account disconnect',t=>{
  const {store,a}=setup(t);store.setAiConsent(a,true);store.updateAiPreferences(a,{closing:'Hi'});store.recordAiUsage(a,{promptTokens:14,completionTokens:9});
  assert.equal(store.getAiUsage(a).requests,1);store.deleteAccount(a);
  assert.equal(store.db.prepare('SELECT COUNT(*) as n FROM ai_accounts').get().n,0);
});
test('AI output revision invalidates previous approval and preserves draft attachment metadata',t=>{
  const {store,a}=setup(t);let d=store.createDraft(a,{to:'ahmad@example.com',cc:'',bcc:'',subject:'Re: Application',body:'Original'}, {sourceEmailId:'m1',threadId:'t1',inReplyTo:'<x@y.com>',originalSender:'ahmad@example.com'});
  d=store.addAttachment(a,d.id,{filename:'cv.pdf',mimeType:'application/pdf',byteSize:1,digest:sha('a'),ciphertext:seal('a',key)});
  d=store.requestReview(a,d.id,d.version);const approved=store.approve(a,d.id,d.version,d.contentHash);
  const update=store.updateDraft(a,d.id,{to:d.to,cc:'',bcc:'',subject:d.subject,body:'AI proposal - needs review'},d.version);
  assert.deepEqual(update.attachments,['cv.pdf']);assert.equal(update.status,'draft');assert.equal(update.version,d.version+1);
  assert.throws(()=>store.reserveSend(a,d.id,d.version,approved.approvalId),e=>e.status===409);
});
