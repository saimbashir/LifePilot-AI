export type Page = 'welcome' | 'overview' | 'inbox' | 'read' | 'compose' | 'voice' | 'summary' | 'approvals' | 'settings' | 'activity';
export type MailFolder = 'inbox' | 'sent' | 'archive';
export type MailCategory = 'Academic' | 'Work' | 'Personal' | 'Updates' | 'Primary' | 'Social' | 'Promotions' | 'Forums';
export interface Mail {
  id: string; from: string; email: string; to: string; subject: string;
  preview: string; body: string; date: string; unread: boolean; starred: boolean;
  important: boolean; folder: MailFolder; category: MailCategory; attachments: string[];
  thread?: { from: string; date: string; body: string }[];
  attachmentDetails?: {id:string;name:string;size:number;mimeType?:string}[]; threadId?:string;
}
export type DraftStatus = 'pending' | 'draft' | 'rejected' | 'sent' | 'unknown' | 'sending';
export type Tone = 'Professional' | 'Warm' | 'Concise';
export type ReplyLength = 'Short' | 'Medium' | 'Detailed';
export type Language = 'English' | 'Roman Urdu' | 'Professional English';
export interface Draft {
  id: string; to: string; cc: string; bcc: string; subject: string; body: string;
  status: DraftStatus; tone: Tone; length: ReplyLength; createdAt: string;
  sourceEmailId?: string; attachments: string[];
  attachmentDetails?:{id:string;name:string;size:number}[]; version?:number; contentHash?:string; sendOutcome?:"sent"|"unknown"; gmailMessageId?:string;
}
export interface Activity {
  id: string; title: string; detail: string; time: string;
  kind: 'summary' | 'draft' | 'approval' | 'mail' | 'voice' | 'system';
}
export interface Preferences {
  theme: 'light' | 'dark'; language: Language; tone: Tone; length: ReplyLength;
  greeting: string; closing: string; voiceReplies: boolean; notifications: boolean; privacyMode: boolean;
}
export interface Summary {
  title: string; intro: string; points: string[]; dates: string[];
  actions: string[]; suggestedReply: string;
}
