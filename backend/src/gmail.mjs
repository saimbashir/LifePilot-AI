import crypto from 'node:crypto';
import {unseal,seal,fail,validateAddress,cleanLine} from './security.mjs';
const GMAIL='https://gmail.googleapis.com/gmail/v1/users/me';
const FETCH_TIMEOUT_MS=18000;
const MAIL_FETCH_CONCURRENCY=5;
const OAUTH='https://oauth2.googleapis.com/token';
const SCOPES=['https://www.googleapis.com/auth/gmail.modify'];
const encoded=(s)=>Buffer.from(s,'utf8').toString('base64url');
const decode=(s)=>Buffer.from(s||'','base64url').toString('utf8');
const header=(payload,name)=>payload?.headers?.find(h=>h.name?.toLowerCase()===name.toLowerCase())?.value||'';
const pureAddress=(from='')=>{const m=String(from).match(/<([^<>]+)>/);return (m?m[1]:from).trim()};
const displayName=(from='')=>{const m=String(from).match(/^\s*"?([^"<]+)"?\s*</);return m?m[1].trim():pureAddress(from)};
export function decodeMessage(message){
  const p=message.payload||{}, from=header(p,'From'), addr=pureAddress(from), replyTo=pureAddress(header(p,'Reply-To'));
  function parts(node){
    const out=[];if(node?.body?.data)out.push({mime:node.mimeType||'text/plain',text:decode(node.body.data)});
    for(const child of node?.parts||[])out.push(...parts(child));return out;
  }
  const all=parts(p);
  const plain=all.find(x=>x.mime.startsWith('text/plain'))?.text;
  const html=all.find(x=>x.mime.startsWith('text/html'))?.text||'';
  const body=plain??html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\s{3,}/g,' ').trim();
  function attachments(node){return [...(node?.filename&&node.body?.attachmentId?[{id:node.body.attachmentId,name:node.filename,size:node.body.size||0,mimeType:node.mimeType||'application/octet-stream'}]:[]),...(node?.parts||[]).flatMap(attachments)]}
  const a=attachments(p),labels=message.labelIds||[];
  const category=labels.includes('CATEGORY_UPDATES')?'Updates':labels.includes('CATEGORY_PROMOTIONS')?'Promotions':labels.includes('CATEGORY_SOCIAL')?'Social':labels.includes('CATEGORY_FORUMS')?'Forums':'Primary';
  return {id:message.id,threadId:message.threadId||'',from:displayName(from),email:addr,replyTo:replyTo||'',to:header(p,'To'),cc:header(p,'Cc'),bcc:header(p,'Bcc'),subject:header(p,'Subject')||'(No subject)',preview:message.snippet||body.slice(0,150),body,date:new Date(Number(message.internalDate||Date.now())).toISOString(),unread:labels.includes('UNREAD'),starred:labels.includes('STARRED'),important:labels.includes('IMPORTANT'),folder:labels.includes('SENT')?'sent':labels.includes('INBOX')?'inbox':'archive',category,attachments:a.map(x=>x.name),attachmentDetails:a,rfcMessageId:header(p,'Message-ID'),references:header(p,'References'),isAutomated:Boolean(header(p,'List-Unsubscribe')||header(p,'Auto-Submitted')||header(p,'Precedence')||header(p,'X-Auto-Response-Suppress'))};
}
async function checkedFetch(url,init,fetchImpl=fetch){
  let response;
  try {response=await fetchImpl(url,{...init,signal:init?.signal||AbortSignal.timeout(FETCH_TIMEOUT_MS)})}
  catch(e){throw fail(502,'Google service unavailable or request timed out. Check connectivity and retry the read operation.');}
  const raw=await response.text();let data;try{data=raw?JSON.parse(raw):{}}catch{data={}};
  if(!response.ok){
    const message=data?.error?.message||data?.error_description||`Google API error ${response.status}`;
    const err=fail(response.status===401||response.status===403?401:response.status===429?429:502,message);
    err.externalStatus=response.status;throw err;
  }
  return data;
}
export function authUrl({clientId,redirectUri,state,verifier}){
  const challenge=crypto.createHash('sha256').update(verifier).digest('base64url');
  const u=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  for(const [k,v] of Object.entries({client_id:clientId,redirect_uri:redirectUri,response_type:'code',scope:SCOPES.join(' '),access_type:'offline',prompt:'consent',state,code_challenge:challenge,code_challenge_method:'S256'}))u.searchParams.set(k,v);
  return u.toString();
}
export async function exchangeCode({clientId,clientSecret,redirectUri,code,verifier,fetchImpl=fetch}){
  return checkedFetch(OAUTH,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,redirect_uri:redirectUri,grant_type:'authorization_code',code,code_verifier:verifier}).toString()},fetchImpl);
}
export async function gmailProfile(accessToken,fetchImpl=fetch){return checkedFetch(`${GMAIL}/profile`,{headers:{Authorization:`Bearer ${accessToken}`}},fetchImpl)}
export function createGmail({store,key,clientId,clientSecret,fetchImpl=fetch}){
  // One token refresh per account at a time; inbox pages may trigger multiple parallel Gmail calls.
  const refreshInFlight=new Map();
  async function token(accountId){
    const a=store.accountById(accountId);if(!a)throw fail(401,'Not connected');
    const value=JSON.parse(unseal(a.token_cipher,key).toString());
    if(value.access_token&&value.expires_at>Date.now()+60000)return value.access_token;
    if(!value.refresh_token)throw fail(401,'Reauthorization required: refresh token missing.');
    if(refreshInFlight.has(accountId))return refreshInFlight.get(accountId);
    const refresh=(async()=>{
      let t;
      try{
        t=await checkedFetch(OAUTH,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,grant_type:'refresh_token',refresh_token:value.refresh_token}).toString()},fetchImpl);
      }catch(e){if(e.externalStatus===400||e.externalStatus===401)throw fail(401,'Reauthorization required.');throw e}
      const updated={...value,...t,refresh_token:t.refresh_token||value.refresh_token,expires_at:Date.now()+(t.expires_in||3600)*1000};
      store.updateTokens(accountId,seal(JSON.stringify(updated),key));return updated.access_token;
    })();
    refreshInFlight.set(accountId,refresh);
    try{return await refresh}finally{refreshInFlight.delete(accountId)}
  }
  async function request(accountId,endpoint,{method='GET',body}={}){
    const access=await token(accountId);
    return checkedFetch(`${GMAIL}${endpoint}`,{method,headers:{Authorization:`Bearer ${access}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})},fetchImpl);
  }
  async function list(accountId,{folder='inbox',query='',limit=25,pageToken=''}={}){
    const params=new URLSearchParams({maxResults:String(Math.max(1,Math.min(40,Number(limit)||25)))});
    const labels={inbox:['INBOX'],unread:['INBOX','UNREAD'],important:['INBOX','IMPORTANT'],sent:['SENT'],archive:[]};
    for(const l of labels[folder]||labels.inbox)params.append('labelIds',l);
    if(folder==='archive')params.set('q','-in:inbox -in:sent -in:trash -in:spam');
    if(query)params.set('q',[params.get('q'),query].filter(Boolean).join(' '));
    if(pageToken)params.set('pageToken',pageToken);
    const ids=await request(accountId,`/messages?${params}`);
    // Gmail list gives only IDs; cap parallel detail requests to avoid a 25-request burst.
    const items=ids.messages||[], mails=new Array(items.length);
    let index=0;
    const workers=Array.from({length:Math.min(MAIL_FETCH_CONCURRENCY,items.length)},async()=>{
      while(index<items.length){const i=index++;const m=items[i];
        mails[i]=decodeMessage(await request(accountId,`/messages/${encodeURIComponent(m.id)}?format=full`));
      }
    });
    await Promise.all(workers);
    return {mails,nextPageToken:ids.nextPageToken||null,resultSizeEstimate:ids.resultSizeEstimate||0};
  }
  const message=async(a,id)=>decodeMessage(await request(a,`/messages/${encodeURIComponent(id)}?format=full`));
  async function thread(account,id){
    const t=await request(account,`/threads/${encodeURIComponent(id)}?format=full`);
    return (t.messages||[]).map(decodeMessage);
  }
  async function setFlag(a,id,flag,value){
    if(!['UNREAD','STARRED','IMPORTANT','INBOX'].includes(flag)||typeof value!=='boolean')throw fail(400,'Invalid label change');
    return request(a,`/messages/${encodeURIComponent(id)}/modify`,{method:'POST',body:{addLabelIds:value?[flag]:[],removeLabelIds:value?[]:[flag]}});
  }
  async function stats(a){
    const [inbox,important]=await Promise.all([request(a,'/labels/INBOX'),request(a,'/labels/IMPORTANT')]);
    return {inbox:inbox.messagesTotal??null,unread:inbox.messagesUnread??null,important:important.messagesTotal??null};
  }
  async function attachment(a,messageId,attachmentId){
    const r=await request(a,`/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`);
    return Buffer.from(r.data||'','base64url');
  }
  async function replySource(a,id){
    const r=await message(a,id);
    // Reply-To takes precedence over From. A message in Sent should reply to its recipient, not yourself.
    const self=store.accountById(a)?.email?.toLowerCase();
    const target=r.email?.toLowerCase()===self?pureAddress(r.to):(r.replyTo||r.email);
    return {sourceEmailId:r.id,threadId:r.threadId,inReplyTo:r.rfcMessageId,references:r.references,originalSender:validateAddress(target),to:validateAddress(target),subject:/^re:/i.test(r.subject)?r.subject:`Re: ${r.subject}`};
  }
  async function send(a,raw,threadId){return request(a,'/messages/send',{method:'POST',body:{raw,...(threadId?{threadId}:{})}})}
  return {request,list,message,thread,setFlag,stats,attachment,replySource,send};
}
const word=s=>`=?UTF-8?B?${Buffer.from(s,'utf8').toString('base64')}?=`;
const wrap64=s=>s.match(/.{1,76}/g)?.join('\r\n')||'';
const safeRfcIds=s=>(String(s||'').match(/<[A-Za-z0-9._%+!#$&*=?^`{|}~@-]+>/g)||[]).slice(-20);
export function buildMime(draft,{from,attachments=[],key}){
  validateAddress(from);
  const subject=cleanLine(draft.subject,500);
  const to=cleanLine(draft.to_addr,2000), cc=cleanLine(draft.cc,2000), bcc=cleanLine(draft.bcc,2000);
  const headers=[`From: ${from}`,`To: ${to}`];
  if(cc)headers.push(`Cc: ${cc}`);if(bcc)headers.push(`Bcc: ${bcc}`);
  headers.push(`Subject: ${word(subject)}`,'MIME-Version: 1.0');
  const replyTo=safeRfcIds(draft.in_reply_to).at(-1);
  if(draft.thread_id && (!draft.original_sender||draft.original_sender.toLowerCase()===draft.to_addr.toLowerCase()) && replyTo){
    const refs=safeRfcIds(draft.references_header);
    headers.push(`In-Reply-To: ${replyTo}`,`References: ${[...new Set([...refs,replyTo])].join(' ')}`);
  }
  const text=wrap64(Buffer.from(draft.body,'utf8').toString('base64'));
  if(!attachments.length){headers.push('Content-Type: text/plain; charset="UTF-8"','Content-Transfer-Encoding: base64');return encoded(headers.join('\r\n')+'\r\n\r\n'+text+'\r\n')}
  const boundary=`LifePilot-${crypto.randomBytes(14).toString('hex')}`;
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  const sections=[`--${boundary}\r\nContent-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${text}\r\n`];
  for(const a of attachments){
    const filename=String(a.filename||'attachment');const safe=filename.replace(/[^\x20-\x7E]/g,'_').replace(/[\r\n"\\\/]/g,'_').slice(0,120),type=/^[\w.+-]+\/[\w.+-]+$/.test(a.mime_type)?a.mime_type:'application/octet-stream';
    const bytes=unseal(a.ciphertext,key),payload=wrap64(bytes.toString('base64'));
    sections.push(`--${boundary}\r\nContent-Type: ${type}\r\nContent-Disposition: attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(filename)}\r\nContent-Transfer-Encoding: base64\r\n\r\n${payload}\r\n`);
  }
  return encoded(headers.join('\r\n')+'\r\n\r\n'+sections.join('')+`--${boundary}--\r\n`);
}
