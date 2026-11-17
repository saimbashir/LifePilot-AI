import {fail,fields,validateAddress,addressList} from '../security.mjs';
import {providerConfig,createGroq} from './provider.mjs';
import {summaryPrompt,draftPrompt} from './prompts.mjs';
import {languages,tones,lengths,pick,text,preferencesPatch,validateSummary,validateDraftOutput} from './schemas.mjs';
import {interpretCommand,resolveCommand} from './intent.mjs';

// Summarize selected authorized message only, never entire inbox. Include head + tail + key lines on oversized texts.
export function selectEmailContext(message,limit=18000){
  const original=String(message.body||'');
  const safeLimit=Math.max(1000,limit-1800);
  if(original.length<=safeLimit)return {body:original,truncated:false,totalChars:original.length};
  const head=original.slice(0,Math.floor(safeLimit*0.55));
  const tail=original.slice(-Math.floor(safeLimit*0.27));
  const middle=original.slice(head.length,original.length-tail.length);
  const candidates=middle.split(/\n/).filter(s=>/(deadline|due|by |before |after |until |apply|please|required|attach|date|meeting|submit|interview|202\d|2027|zaroori|aakhri|tareekh)/i.test(s)).slice(0,14);
  const budget=Math.max(0,safeLimit-head.length-tail.length-110);
  const highlights=candidates.join('\n').slice(0,budget);
  return {body:`${head}\n\n[OMITTED MIDDLE — NOT PROVIDED TO AI]\n${highlights}\n\n[END OF EMAIL]\n${tail}`,truncated:true,totalChars:original.length};
}
function requireAllowed(enabled,consent){if(!enabled)throw fail(503,'AI is disabled or unconfigured on this backend.');if(!consent)throw fail(403,'AI consent required. Enable it in Settings after reading the privacy notice.');}
function verifyAttachmentClaims(body,hasAttachments){
  if(!hasAttachments&&/\b(attached|enclosed|attachment included|cv is attached)\b/i.test(body))throw fail(409,'AI draft mentions an attachment but no verified attachment exists. Attach the file manually and edit the message.');
}
function responseDraft(generated,source={}){const subject=source.subject||generated.subject;return fields({to:source.to||'',cc:source.cc||'',bcc:source.bcc||'',subject,body:generated.body})}
function trimArrayDates(summary,body){
  const allowed=summary.dates.filter(x=>body.toLowerCase().includes(x.toLowerCase()));
  if(allowed.length!==summary.dates.length)summary.uncertainties.push('Some suggested dates were not present verbatim in the source; verify the original email.');
  summary.dates=allowed;return summary;
}
export function createAiRouter({store,gmail,getAccountId,requireCsrf,model=createGroq(),env=process.env,routerFactory,onConsentRevoked=()=>{}}={}){
  if(typeof routerFactory!=='function')throw new Error('A trusted Express Router factory is required');
  const router=routerFactory();
  const asyncRoute=fn=>(req,res,next)=>Promise.resolve().then(()=>fn(req,res,next)).catch(next);
  const config=model.config||providerConfig(env);
  const ready=Boolean(config.configured&&config.enabled);
  const id=req=>getAccountId(req);
  const prefs=req=>store.getAiPreferences(id(req));
  const requireAi=(req,_res,next)=>{try{requireAllowed(ready,store.getAiConsent(id(req)));next()}catch(e){next(e)}};
  // Consent does NOT change server AI_ENABLED. Both must be true.
  router.get('/status',asyncRoute(async(req,res)=>res.json({provider:'groq',configured:config.configured,enabled:ready,model:config.model,consent:store.getAiConsent(id(req)),processingNotice:'Only a selected email and necessary thread context may be sent to GroqCloud after opt-in. Email contents leave your backend and are processed by an external AI provider. No email is sent by the AI.',usage:store.getAiUsage(id(req))})));
  router.post('/consent',requireCsrf,asyncRoute(async(req,res)=>{
    if(typeof req.body?.enabled!=='boolean')throw fail(400,'enabled must be boolean');
    store.setAiConsent(id(req),req.body.enabled);
    if(!req.body.enabled)onConsentRevoked(id(req)); // Do not leave queued automatic jobs after opt-out.
    res.json({consent:store.getAiConsent(id(req)),enabled:ready});
  }));
  router.get('/preferences',asyncRoute(async(req,res)=>res.json(prefs(req))));
  router.patch('/preferences',requireCsrf,asyncRoute(async(req,res)=>res.json(store.updateAiPreferences(id(req),preferencesPatch(req.body)))));
  router.delete('/preferences',requireCsrf,asyncRoute(async(req,res)=>res.json(store.resetAiPreferences(id(req)))));
  async function generate(req,system,user){
    const res=await model.generate({system,user:JSON.stringify(user)});
    store.recordAiUsage(id(req),res.usage||{});
    return res.data;
  }
  router.post('/summarize',requireCsrf,requireAi,asyncRoute(async(req,res)=>{
    const messageId=text(req.body?.messageId,{max:160,label:'messageId'});
    const language=pick(req.body?.language,languages,'language');
    const message=await gmail.message(id(req),messageId);
    const context=selectEmailContext(message,config.maxInputChars||18000);
    const data=await generate(req,summaryPrompt(language),{sourceType:'untrusted-email-data',from:message.from,subject:message.subject,date:message.date,body:context.body,sourceTruncated:context.truncated,language});
    const result=trimArrayDates(validateSummary(data),message.body||'');
    if(context.truncated)result.uncertainties.push('This email was longer than the AI input limit. Only selected parts were analyzed; check the full original message.');
    res.json({messageId,language,...result,sourceTruncated:context.truncated,sourceChars:context.totalChars});
  }));
  router.post('/reply',requireCsrf,requireAi,asyncRoute(async(req,res)=>{
    const messageId=text(req.body?.messageId,{max:160,label:'messageId'});
    const userInstruction=text(req.body?.instruction,{max:2000,label:'instruction'});
    const p=prefs(req);const tone=pick(req.body?.tone||p.tone,tones,'tone'),length=pick(req.body?.length||p.length,lengths,'length'),language=pick(req.body?.language||p.summaryLanguage,languages,'language');
    // Authoritative Gmail lookup ensures sender, reply-to, message/thread headers cannot be hallucinated.
    const [message,reply]=await Promise.all([gmail.message(id(req),messageId),gmail.replySource(id(req),messageId)]);
    const ctx=selectEmailContext(message,config.maxInputChars||18000);
    if(ctx.truncated)throw fail(409,'Message exceeds the AI context limit. Read the complete message and use manual reply to avoid missing requirements.');
    const data=await generate(req,draftPrompt({tone,length,language,reply:true}),{sourceType:'untrusted-email-data',email:{from:message.from,email:message.email,subject:message.subject,body:ctx.body,date:message.date},instruction:userInstruction,preferences:p,verifiedAttachments:[]});
    const generated=validateDraftOutput(data);
    const existingForAttachment=req.body?.draftId?store.rawDraft(id(req),String(req.body.draftId)):null;
    verifyAttachmentClaims(generated.body,Boolean(existingForAttachment&&store.attachmentContents(id(req),existingForAttachment.id).length));
    // Explicit manual review required: model cannot choose recipient or alter threading.
    let draft;
    if(req.body?.draftId!==undefined){
      const draftId=text(req.body.draftId,{max:80,label:'draftId'});
      const existing=store.rawDraft(id(req),draftId);
      if(existing.source_email_id!==messageId)throw fail(409,'This draft belongs to a different Gmail message.');
      if(!Number.isSafeInteger(req.body.expectedVersion))throw fail(400,'expectedVersion required');
      draft=store.updateDraft(id(req),draftId,responseDraft(generated,{...reply,cc:existing.cc,bcc:existing.bcc}),req.body.expectedVersion);
    }else draft=store.createDraft(id(req),responseDraft(generated,reply),reply);
    res.status(req.body?.draftId?200:201).json({...draft,aiGenerated:true,sendRequiresApproval:true});
  }));
  router.post('/compose',requireCsrf,requireAi,asyncRoute(async(req,res)=>{
    const recipient=validateAddress(text(req.body?.recipient,{max:254,label:'recipient'}));
    const cc=addressList(req.body?.cc||'').join(', '),bcc=addressList(req.body?.bcc||'').join(', ');
    const instruction=text(req.body?.instruction,{max:2500,label:'instruction'});
    // Attachments must be attached via existing approved file-upload flow, never invented.
    if(/\b(attached|attachment|attach|enclosed|cv attached|see my cv)\b/i.test(instruction))return res.status(409).json({error:'Attachment confirmation required. Create a manual draft, attach the real file, and review it before sending.',clarificationRequired:true});
    const p=prefs(req);const tone=pick(req.body?.tone||p.tone,tones,'tone'),length=pick(req.body?.length||p.length,lengths,'length'),language=pick(req.body?.language||p.summaryLanguage,languages,'language');
    const raw=await generate(req,draftPrompt({tone,length,language,reply:false}),{instruction,recipient,cc,bcc,preferences:p,verifiedAttachments:[]});
    const generated=validateDraftOutput(raw);
    const existingForAttachment=req.body?.draftId?store.rawDraft(id(req),String(req.body.draftId)):null;
    verifyAttachmentClaims(generated.body,Boolean(existingForAttachment&&store.attachmentContents(id(req),existingForAttachment.id).length));
    const form=fields({to:recipient,cc,bcc,subject:generated.subject,body:generated.body});
    let draft;
    if(req.body?.draftId!==undefined){
      const draftId=text(req.body.draftId,{max:80,label:'draftId'});
      const existing=store.rawDraft(id(req),draftId);
      if(existing.source_email_id)throw fail(409,'Cannot convert a reply draft to a new thread.');
      if(!Number.isSafeInteger(req.body.expectedVersion))throw fail(400,'expectedVersion required');
      draft=store.updateDraft(id(req),draftId,form,req.body.expectedVersion);
    }else draft=store.createDraft(id(req),form);
    res.status(req.body?.draftId?200:201).json({...draft,aiGenerated:true,sendRequiresApproval:true});
  }));
  router.post('/command',requireCsrf,requireAi,asyncRoute(async(req,res)=>{
    const command=text(req.body?.text,{max:2000,label:'command'});
    const language=pick(req.body?.language||'roman-urdu',languages,'language');
    const output=await interpretCommand({model:{generate:async x=>({data:await generate(req,x.system,{command,language})})},command,language});
    const resolution=await resolveCommand({parsed:output,accountId:id(req),gmail});
    res.json({...resolution,autoSend:false});
  }));
  return router;
}
