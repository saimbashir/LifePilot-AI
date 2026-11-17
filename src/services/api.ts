import type {Draft, Mail} from '../types';
export interface GmailSession {connected:boolean;configured:boolean;email?:string;csrf?:string;monitoring:string;monitoringConfigured?:boolean;}
export interface GmailCounts {inbox:number|null;unread:number|null;important:number|null;}
export interface MailPage {mails:Mail[];nextPageToken:string|null;resultSizeEstimate:number;counts?:GmailCounts;checkedAt?:string;}
export class ApiError extends Error {constructor(message:string,public status:number,public unknown=false){super(message);this.name='ApiError'}}
let csrf='';
export const setCsrf=(token='')=>{csrf=token};
export async function request<T>(endpoint:string,{method='GET',body}:{method?:string,body?:unknown}={}){
  const res=await fetch(`/api${endpoint}`,{method,credentials:'same-origin',headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(method!=='GET'?{'X-CSRF-Token':csrf}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const data=await res.json().catch(()=>({error:'The backend returned an invalid response.'}));
  if(!res.ok)throw new ApiError(data.error||`Request failed (${res.status})`,res.status,data.sendStatus==='unknown');
  return data as T;
}
export const gmailApi={
  session:()=>request<GmailSession>('/session'),
  connect:()=>{window.location.assign('/api/auth/google/start')},
  logout:()=>request<{connected:boolean}>('/auth/logout',{method:'POST'}),
  disconnect:()=>request<{connected:boolean}>('/auth/account',{method:'DELETE'}),
  mail:(folder='inbox',q='',pageToken='')=>request<MailPage>(`/mail?${new URLSearchParams({folder,q,...(pageToken?{pageToken}:{})})}`),
  mailDetail:(id:string)=>request<Mail>(`/mail/${encodeURIComponent(id)}`),
  stats:()=>request<GmailCounts>('/mail/stats'),
  refresh:()=>request<MailPage>('/monitoring/refresh',{method:'POST'}),
  monitoring:()=>request<{status:string;mode:string;pushWorkerDeployed:boolean}>('/monitoring'),
  updateMail:(id:string,action:'read'|'star'|'important'|'archive',value:boolean)=>request<{ok:boolean;mail:Mail}>(`/mail/${encodeURIComponent(id)}/labels`,{method:'PATCH',body:{action,value}}),
  drafts:()=>request<{drafts:Draft[]}>('/drafts'),
  createDraft:(value:{to:string;cc:string;bcc:string;subject:string;body:string;sourceEmailId?:string})=>request<Draft>('/drafts',{method:'POST',body:value}),
  saveDraft:(draft:Draft)=>request<Draft>(`/drafts/${encodeURIComponent(draft.id)}`,{method:'PATCH',body:{to:draft.to,cc:draft.cc,bcc:draft.bcc,subject:draft.subject,body:draft.body,expectedVersion:draft.version}}),
  requestReview:(draft:Draft)=>request<Draft>(`/drafts/${encodeURIComponent(draft.id)}/request-review`,{method:'POST',body:{expectedVersion:draft.version}}),
  approve:(draft:Draft)=>request<{draft:Draft;approvalId:string}>(`/drafts/${encodeURIComponent(draft.id)}/approve`,{method:'POST',body:{expectedVersion:draft.version,contentHash:draft.contentHash}}),
  send:(draft:Draft,approvalId:string)=>request<{sent:true;gmailMessageId:string;draft:Draft}>(`/drafts/${encodeURIComponent(draft.id)}/send`,{method:'POST',body:{expectedVersion:draft.version,approvalId}}),
  reject:(id:string)=>request<Draft>(`/drafts/${encodeURIComponent(id)}/reject`,{method:'POST',body:{}}),
  attach:(id:string,filename:string,mimeType:string,data:string)=>request<Draft>(`/drafts/${encodeURIComponent(id)}/attachments`,{method:'POST',body:{filename,mimeType,data}}),
  removeAttachment:(id:string,attachmentId:string)=>request<Draft>(`/drafts/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachmentId)}`,{method:'DELETE'}),
  downloadAttachment:async(messageId:string,attachmentId:string,filename:string)=>{
    const res=await fetch(`/api/mail/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,{credentials:'same-origin'});
    if(!res.ok)throw new ApiError('Could not download attachment',res.status);
    const blob=await res.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
};

export interface MonitorStatus {
  mode:string;enabled:boolean;status:string;workerConfigured:boolean;
  autoAiEnabled:boolean;autoAiDailyLimit:number;autoAiScope:'primary'|'all-eligible';aiPending:number;aiCompleted:number;aiFailed:number;aiSkipped:number;
  lastCheckedAt:string|null;lastSuccessAt:string|null;lastMessageAt:string|null;
  lastError:string|null;cursorInitialized:boolean;receivedCount:number;
  pendingNotifications:number;message:string;
}
export interface MonitorEvent {messageId:string;createdAt:number;notifiedAt:number|null;aiState:string;aiError:string|null;draftId:string|null;summary:null|{language:string;summary:string;keyPoints:string[];actionItems:string[];dates:string[];uncertainties:string[]}}
export interface PushDevice {id:string;platform:string;createdAt:number}
export const monitorApi={
  status:()=>request<MonitorStatus>('/monitoring'),
  enable:(enabled:boolean)=>request<MonitorStatus>('/monitoring',{method:'PATCH',body:{enabled}}),
  configureAutoAi:(enabled:boolean,dailyLimit:number,scope:'primary'|'all-eligible'='primary')=>request<MonitorStatus>('/monitoring/auto-ai',{method:'PATCH',body:{enabled,dailyLimit,scope}}),
  check:()=>request<{result:unknown;status:MonitorStatus}>('/monitoring/check',{method:'POST',body:{}}),
  events:()=>request<{events:MonitorEvent[]}>('/monitoring/events'),
  pushStatus:()=>request<{configured:boolean;devices:PushDevice[]}>('/push/status'),
  registerPush:(token:string,platform:'web'|'android'='web')=>request<PushDevice>('/push/register',{method:'POST',body:{token,platform}}),
  removePush:(deviceId:string)=>request<{removed:boolean}>(`/push/devices/${encodeURIComponent(deviceId)}`,{method:'DELETE'})
};
