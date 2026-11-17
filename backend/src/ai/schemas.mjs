import {fail} from '../security.mjs';
export const languages=['roman-urdu','simple-english','professional-english'];
export const tones=['Professional','Warm','Concise'];
export const lengths=['Short','Medium','Detailed'];
export const intents=['search_email','open_email','summarize_email','reply_to_email','compose_email','show_unread','clarify','unsupported'];
export function object(x){return x!==null&&typeof x==='object'&&!Array.isArray(x)}
export function pick(x,options,label){if(typeof x!=='string'||!options.includes(x))throw fail(400,`Invalid ${label}`);return x}
export function text(x,{max=2000,min=1,label='text'}={}){if(typeof x!=='string'||x.trim().length<min||x.length>max)throw fail(400,`Invalid ${label}`);return x.trim()}
export function optionalText(x,max=1000){return x===undefined||x===null?'':text(x,{max,min:0})}
export function outputText(x,{max=10000,label='model text',allowEmpty=false}={}){if(typeof x!=='string'||x.length>max||(!allowEmpty&&!x.trim()))throw fail(502,`Invalid ${label} from AI provider`);return x.trim()}
export function outputArray(x,label,maxEntries=20,maxChars=1200){if(!Array.isArray(x)||x.length>maxEntries||x.some(v=>typeof v!=='string'||v.length>maxChars))throw fail(502,`Invalid ${label} from AI provider`);return x.map(v=>v.trim()).filter(Boolean)}
export function validateSummary(x){if(!object(x))throw fail(502,'Invalid AI summary response');return {
  summary:outputText(x.summary,{max:9000,label:'summary'}),
  keyPoints:outputArray(x.keyPoints,'keyPoints',16),
  dates:outputArray(x.dates,'dates',12),
  actionItems:outputArray(x.actionItems,'actionItems',16),
  uncertainties:outputArray(x.uncertainties,'uncertainties',12)
}}
export function validateDraftOutput(x){if(!object(x))throw fail(502,'Invalid AI draft response');return {
  subject:outputText(x.subject,{max:350,label:'subject'}).replace(/[\r\n\0]/g,' ').trim(),
  body:outputText(x.body,{max:12000,label:'body'})
}}
export function validateIntent(x){if(!object(x)||!intents.includes(x.intent))throw fail(502,'Invalid AI command response');return {
  intent:x.intent,query:typeof x.query==='string'?x.query.slice(0,160).trim():'',
  sender:typeof x.sender==='string'?x.sender.slice(0,120).trim():'',
  instruction:typeof x.instruction==='string'?x.instruction.slice(0,2000).trim():'',
  recipient:typeof x.recipient==='string'?x.recipient.slice(0,254).trim():'',
  language:languages.includes(x.language)?x.language:'roman-urdu',
  clarification:typeof x.clarification==='string'?x.clarification.slice(0,400).trim():''
}}
export const defaultPreferences=Object.freeze({greeting:'Hello',closing:'Best regards',tone:'Professional',length:'Medium',summaryLanguage:'roman-urdu',speechRate:1});
export function preferencesPatch(x){if(!object(x))throw fail(400,'Preference object required');const out={};const allowed=['greeting','closing','tone','length','summaryLanguage','speechRate'];if(Object.keys(x).some(k=>!allowed.includes(k)))throw fail(400,'Unknown preference');
  if('greeting'in x)out.greeting=text(x.greeting,{max:90,label:'greeting'});
  if('closing'in x)out.closing=text(x.closing,{max:90,label:'closing'});
  if('tone'in x)out.tone=pick(x.tone,tones,'tone');
  if('length'in x)out.length=pick(x.length,lengths,'length');
  if('summaryLanguage'in x)out.summaryLanguage=pick(x.summaryLanguage,languages,'summary language');
  if('speechRate'in x){if(typeof x.speechRate!=='number'||!Number.isFinite(x.speechRate)||x.speechRate<0.7||x.speechRate>1.5)throw fail(400,'Speech rate must be 0.7–1.5');out.speechRate=x.speechRate}
  return out;
}
