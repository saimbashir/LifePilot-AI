import {validateIntent,text,object} from './schemas.mjs';
import {fail,validateAddress} from '../security.mjs';
export async function interpretCommand({model,command,language='roman-urdu'}){
  text(command,{max:2000,label:'command'});
  const raw=await model.generate({system:(await import('./prompts.mjs')).intentPrompt,user:JSON.stringify({command,language})});
  const parsed=validateIntent(raw.data);
  // Deterministic safety: NEVER trust model-selected recipient, URL, message IDs, or email sends.
  const explicit=command.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)||[];
  parsed.recipient=(explicit.length===1?validateAddress(explicit[0]):'');
  if(parsed.intent==='compose_email'&&!parsed.recipient)return {...parsed,intent:'clarify',clarification:'Please enter the exact recipient email address before creating a draft.'};
  if(['open_email','reply_to_email','summarize_email','search_email'].includes(parsed.intent)&&!parsed.sender&&!parsed.query)return {...parsed,intent:'clarify',clarification:'Who should I search for, or what subject should I look up?'};
  return parsed;
}
export async function resolveCommand({parsed,accountId,gmail}){
  if(parsed.intent==='show_unread')return {...parsed,route:'inbox',folder:'unread'};
  if(parsed.intent==='compose_email')return {...parsed,route:'compose',requiresReview:true};
  if(['unsupported','clarify'].includes(parsed.intent))return {...parsed,route:'voice'};
  const query=(parsed.sender?`from:${parsed.sender.replace(/[^a-zA-Z0-9@._ -]/g,'').slice(0,80)}`:parsed.query).slice(0,160);
  if(!query)return {...parsed,intent:'clarify',clarification:'Please specify a sender or search term.',route:'voice'};
  const search=await gmail.list(accountId,{folder:'inbox',query,limit:20});
  const matches=search.mails||[];
  if(!matches.length)return {...parsed,intent:'clarify',clarification:'No matching Gmail messages were found.',candidates:[],route:'voice'};
  const candidates=matches.map(m=>({id:m.id,from:m.from,email:m.email,subject:m.subject,date:m.date}));
  // If a sender name maps to multiple email addresses, refuse to guess even if one is latest.
  const senderAddresses=new Set(matches.map(m=>m.email?.toLowerCase()).filter(Boolean));
  if(parsed.sender&&senderAddresses.size>1)return {...parsed,intent:'clarify',requestedIntent:parsed.intent,clarification:'Multiple senders match. Select the correct message.',candidates,route:'voice'};
  if(parsed.intent==='search_email')return {...parsed,route:'inbox',query,candidates};
  // If search targets a category or generic subject, selection must be explicit when multiple messages match.
  if(!parsed.sender&&matches.length>1)return {...parsed,intent:'clarify',requestedIntent:parsed.intent,clarification:'Choose the correct email before I continue.',candidates,route:'voice'};
  // Emails returned by Gmail are generally newest first. Compare timestamps to avoid depending on list order.
  const selected=[...matches].sort((a,b)=>new Date(b.date).getTime()-new Date(a.date).getTime())[0];
  return {...parsed,route:parsed.intent==='reply_to_email'?'compose':parsed.intent==='summarize_email'?'summary':'read',messageId:selected.id,selected:{id:selected.id,from:selected.from,email:selected.email,subject:selected.subject,date:selected.date},requiresReview:parsed.intent==='reply_to_email'};
}
