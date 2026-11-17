import {request} from './api';
import type {Draft,Tone,ReplyLength} from '../types';
export type AiLanguage='roman-urdu'|'simple-english'|'professional-english';
export interface AiStatus {provider:'groq';configured:boolean;enabled:boolean;model:string;consent:boolean;processingNotice:string;usage:{requests:number;prompt_tokens:number;completion_tokens:number}}
export interface AiSummary {messageId:string;language:AiLanguage;summary:string;keyPoints:string[];dates:string[];actionItems:string[];uncertainties:string[];sourceTruncated:boolean;sourceChars:number}
export interface AiPreferences {greeting:string;closing:string;tone:Tone;length:ReplyLength;summaryLanguage:AiLanguage;speechRate:number}
export interface AiCandidate {id:string;from:string;email:string;subject:string;date:string}
export type AiIntent='search_email'|'open_email'|'summarize_email'|'reply_to_email'|'compose_email'|'show_unread'|'clarify'|'unsupported';
export interface AiCommand {intent:AiIntent;requestedIntent?:AiIntent;query?:string;sender?:string;recipient?:string;instruction?:string;language?:AiLanguage;clarification?:string;route:'inbox'|'read'|'compose'|'summary'|'voice';folder?:string;messageId?:string;selected?:AiCandidate;candidates?:AiCandidate[];autoSend:false}
export const toAiLanguage=(lang:string):AiLanguage=>lang==='Roman Urdu'?'roman-urdu':lang==='Professional English'?'professional-english':'simple-english';
export const aiApi={
  status:()=>request<AiStatus>('/ai/status'),
  consent:(enabled:boolean)=>request<{consent:boolean;enabled:boolean}>('/ai/consent',{method:'POST',body:{enabled}}),
  preferences:()=>request<AiPreferences>('/ai/preferences'),
  updatePreferences:(changes:Partial<AiPreferences>)=>request<AiPreferences>('/ai/preferences',{method:'PATCH',body:changes}),
  resetPreferences:()=>request<AiPreferences>('/ai/preferences',{method:'DELETE'}),
  summarize:(messageId:string,language:AiLanguage)=>request<AiSummary>('/ai/summarize',{method:'POST',body:{messageId,language}}),
  reply:(input:{messageId:string;instruction:string;tone?:Tone;length?:ReplyLength;language?:AiLanguage;draftId?:string;expectedVersion?:number})=>request<Draft>('/ai/reply',{method:'POST',body:input}),
  compose:(input:{recipient:string;cc?:string;bcc?:string;instruction:string;tone?:Tone;length?:ReplyLength;language?:AiLanguage;draftId?:string;expectedVersion?:number})=>request<Draft>('/ai/compose',{method:'POST',body:input}),
  command:(text:string,language:AiLanguage)=>request<AiCommand>('/ai/command',{method:'POST',body:{text,language}})
};
