// Optional conservative automated AI triage for NEW inbox events only.
// External Groq processing requires both per-account consent and a separate auto-AI opt-in.
// This module has NO Gmail send capability. All proposals require user review and approval.
import {summaryPrompt,draftPrompt} from '../ai/prompts.mjs';
import {validateSummary,validateDraftOutput} from '../ai/schemas.mjs';
import {selectEmailContext} from '../ai/routes.mjs';
import {seal} from '../security.mjs';

export function autoEligibility(mail,ownAddress='',maxBody=12000,scope='primary'){
  if(!mail||mail.folder!=='inbox')return {eligible:false,reason:'Not an inbox message'};
  // Broad opt-in accepts direct messages in Updates/Forums, never Promotions/Social or spam.
  // Keep the privacy-first Primary-only behavior unless the owner explicitly selects broad mode.
  const allowed=scope==='all-eligible'?['Primary','Updates','Forums']:['Primary'];
  if(!allowed.includes(mail.category))return {eligible:false,reason:'Message category excluded by selected monitoring scope'};
  if(mail.isAutomated||!mail.email||mail.email.toLowerCase()===ownAddress.toLowerCase())return {eligible:false,reason:'Automated or self-originated message'};
  if(/(?:no[._-]?reply|do[._-]?not[._-]?reply|mailer-daemon|postmaster|notification|newsletters?)@/i.test(mail.email))return {eligible:false,reason:'Automated sender'};
  if(/(?:otp|verification|verify your|security code|one[- ]time|password|sign[- ]in|login|bank|invoice|payment|receipt|statement|transaction|tax|medical|health|billing|newsletter|unsubscribe|promotion|suspicious)/i.test(mail.subject||''))
    return {eligible:false,reason:'Sensitive or automated subject'};
  if(typeof mail.body!=='string'||!mail.body.trim()||mail.body.length>maxBody)return {eligible:false,reason:'Empty or long message requires manual review'};
  // Content safety check: a generic subject can still hide a password reset or OTP.
  if(/(?:verification code|one.time password|security code|2fa code|login code|reset your password|bank account details|payment card number)/i.test(mail.body.slice(0,3000)))
    return {eligible:false,reason:'Sensitive content requires manual review'};
  return {eligible:true};
}

export function createAutoAssistant({store,gmail,model,key,clock=()=>Date.now(),maxPerRun=3}={}){
  const db=store.db;
  const pending=db.prepare("SELECT message_id FROM monitor_events WHERE account_id=? AND ai_state='pending' AND ai_attempts<3 ORDER BY created_at ASC LIMIT ?");
  function mark(accountId,messageId,state,error=''){
    db.prepare("UPDATE monitor_events SET ai_state=?,ai_attempts=ai_attempts+1,ai_error=? WHERE account_id=? AND message_id=? AND ai_state='pending'")
      .run(state,error.slice(0,160),accountId,messageId);
  }
  async function process(accountId){
    const s=db.prepare('SELECT enabled,auto_ai_enabled,auto_ai_daily_limit,auto_ai_scope FROM monitor_state WHERE account_id=?').get(accountId);
    if(!s?.enabled||!s.auto_ai_enabled)return {skipped:'auto AI off'};
    if(!store.getAiConsent(accountId))return {skipped:'external AI consent not granted'};
    if(!model?.config?.configured||!model?.config?.enabled)return {skipped:'Groq backend unavailable'};
    const start=new Date(clock());start.setUTCHours(0,0,0,0);
    const used=db.prepare("SELECT COUNT(*) AS n FROM monitor_events WHERE account_id=? AND ai_state='done' AND processed_at>=?").get(accountId,start.valueOf()).n;
    if(used>=s.auto_ai_daily_limit)return {skipped:'daily limit reached'};
    const queue=pending.all(accountId,Math.min(maxPerRun,s.auto_ai_daily_limit-used));
    let created=0,skipped=0,failed=0;
    for(const entry of queue){
      const messageId=entry.message_id;
      try{
        const message=await gmail.message(accountId,messageId);
        const verdict=autoEligibility(message,store.accountById(accountId)?.email||'',Math.min(12000,Math.max(1000,(model.config.maxInputChars||18000)-1800)),s.auto_ai_scope);
        if(!verdict.eligible){mark(accountId,messageId,'skipped',verdict.reason);skipped++;continue}
        const reply=await gmail.replySource(accountId,messageId);
        const prefs=store.getAiPreferences(accountId);
        const context=selectEmailContext(message,model.config.maxInputChars||18000);
        if(context.truncated){mark(accountId,messageId,'skipped','Full email exceeds safe AI context; manual review required');skipped++;continue}
        const source={sourceType:'untrusted-email-data',email:{from:message.from,email:message.email,subject:message.subject,date:message.date,body:context.body},preferences:prefs};
        const sumResponse=await model.generate({system:summaryPrompt(prefs.summaryLanguage),user:JSON.stringify({...source,language:prefs.summaryLanguage})});
        const summary=validateSummary(sumResponse.data);
        // Never persist model-proposed dates that cannot be found verbatim in the source.
        summary.dates=summary.dates.filter(x=>message.body.toLowerCase().includes(x.toLowerCase()));
        if(!store.getAiConsent(accountId)||!db.prepare('SELECT enabled,auto_ai_enabled FROM monitor_state WHERE account_id=?').get(accountId)?.auto_ai_enabled)
          throw Object.assign(new Error('AI consent or automatic review was disabled'),{status:403});
        const draftResponse=await model.generate({system:draftPrompt({tone:prefs.tone,length:prefs.length,language:prefs.summaryLanguage,reply:true}),
          user:JSON.stringify({...source,instruction:'Suggest a cautious acknowledgment or helpful next-step reply. Do not promise any action, deadline, consent or attachment. The owner will decide whether to send.',verifiedAttachments:[]})});
        const proposal=validateDraftOutput(draftResponse.data);
        if(/\b(attached|enclosed|attachment included|cv is attached)\b/i.test(proposal.body))throw new Error('Unsafe attachment claim in model proposal');
        // Atomic synchronous commit: a crash cannot leave a draft with no matching event.
        if(!store.getAiConsent(accountId)||!db.prepare('SELECT enabled,auto_ai_enabled FROM monitor_state WHERE account_id=?').get(accountId)?.auto_ai_enabled)
          throw Object.assign(new Error('AI consent or automatic review was disabled'),{status:403});
        store.transaction(()=>{
          const current=db.prepare('SELECT ai_state FROM monitor_events WHERE account_id=? AND message_id=?').get(accountId,messageId);
          if(current?.ai_state!=='pending'||!store.getAiConsent(accountId))return;
          const draft=store.createDraft(accountId,{to:reply.to,cc:'',bcc:'',subject:reply.subject,body:proposal.body},reply);
          db.prepare("UPDATE drafts SET status='pending',approval_id=NULL,approval_hash=NULL,approved_version=NULL WHERE id=? AND account_id=?").run(draft.id,accountId); // review-only, NEVER approved
          db.prepare("UPDATE monitor_events SET ai_state='done',processed_at=?,summary_cipher=?,draft_id=?,ai_error=NULL WHERE account_id=? AND message_id=?")
            .run(clock(),seal(JSON.stringify({messageId,language:prefs.summaryLanguage,...summary}),key),draft.id,accountId,messageId);
          store.recordAiUsage(accountId,{promptTokens:(sumResponse.usage?.promptTokens||0)+(draftResponse.usage?.promptTokens||0),completionTokens:(sumResponse.usage?.completionTokens||0)+(draftResponse.usage?.completionTokens||0)});
          created++;
        });
      }catch(e){
        const attempts=db.prepare('SELECT ai_attempts FROM monitor_events WHERE account_id=? AND message_id=?').get(accountId,messageId)?.ai_attempts||0;
        const status=attempts>=2?'failed':'pending';
        mark(accountId,messageId,status,e?.status===429?'Groq rate-limited':e?.status===401?'Gmail reauthorization required':'Automated draft unavailable; retry or compose manually');
        failed++;
      }
    }
    return {created,skipped,failed};
  }
  return {process};
}
