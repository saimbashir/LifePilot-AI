import type { Mail, Tone, ReplyLength, Language, Summary } from '../types';

export const delay = (milliseconds = 380) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));
const takeFirst = (body: string, max = 180) => body.replace(/\n/g, ' ').slice(0, max).trim();
export function formatDate(date: string, opts?: Intl.DateTimeFormatOptions) {
  return new Date(date).toLocaleDateString('en-US', opts || {month:'short',day:'numeric'});
}
export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0]).join('').toUpperCase();
}
export function generateMockReply(email: Mail | null, tone: Tone, length: ReplyLength, closing = 'Kind regards') {
  const name = email?.from.split(' ')[0] || 'there';
  const opening = tone === 'Warm' ? `Hi ${name},` : `Dear ${name},`;
  let body = `Thank you for your email. I appreciate you reaching out and sharing the details. I will review everything carefully and get back to you with an update.`;
  if (email?.subject.toLowerCase().includes('internship')) body = 'Thank you for sharing the next steps. I would be happy to provide my portfolio and confirm my availability for a conversation next week.';
  if (email?.subject.toLowerCase().includes('proposal')) body = 'Thank you for sending the updated proposal. I will review it and share my feedback tomorrow.';
  if (tone === 'Concise') body = body.split('. ')[0] + '.';
  if (length === 'Short') body = body.split('. ').slice(0,1).join('. ').replace(/\.?$/,'.');
  if (length === 'Detailed') body += '\n\nPlease let me know if there is anything specific you would like me to prepare in advance. I look forward to continuing the conversation.';
  return `${opening}\n\n${body}\n\n${closing},\nAlex`;
}
export function generateMockSummary(email: Mail, language: Language): Summary {
  const lower = (email.subject + ' ' + email.body).toLowerCase();
  const isIntern = lower.includes('internship') || lower.includes('research');
  const isProposal = lower.includes('proposal');
  const dates = Array.from(email.body.matchAll(/(?:November|December|January|February|March|April|May|June|July|August|September|October)\s+\d{1,2}(?:,\s*\d{4})?/gi)).map(x=>x[0]);
  const rawPoints = email.body.split(/[.\n]+/).map(x=>x.trim()).filter(x=>x.length>25).slice(0,3);
  const points = rawPoints.length ? rawPoints.map(x=>x.slice(0,125)) : [takeFirst(email.body,140)];
  if(language === 'Roman Urdu') return {
    title: `${email.subject} — Roman Urdu`,
    intro: isIntern ? `${email.from} ne internship/research ke next steps share kiye hain. Unhon ne tumse portfolio aur availability ki information maangi hai.` : isProposal ? `${email.from} ne proposal ki updated version bheji hai aur tumhari feedback chahiye.` : `${email.from} ki email ka main maqsad neeche asaan alfaaz mein diya gaya hai.`,
    points: isIntern ? ['Sender ne tumhari interest ka jawab diya hai.','Portfolio ya supporting documents share karne ki request hai.','Conversation ya application se related dates ko check karo.'] : isProposal ? ['Revised proposal share hua hai.','Sender review aur feedback chahta hai.','Reply mein sirf wohi commitments do jo tum approve karo.'] : points,
    dates, actions: isIntern ? ['Portfolio tayyar karo','Deadline confirm karo','Reply draft review karo'] : ['Email ki request check karo','Reply approve karne se pehle verify karo'],
    suggestedReply:'Thank you for your email. I will review the details and get back to you.'
  };
  return {
    title: `${email.subject} — Summary`,
    intro: isIntern ? 'This message discusses internship or research next steps and requests follow-up information.' : isProposal ? 'The sender shared an updated proposal and would like your feedback.' : `A short, simulated overview of the message from ${email.from}.`,
    points, dates,
    actions:isIntern ? ['Review the requested documents','Check all dates and deadlines','Prepare a reply for approval'] : ['Review the request','Decide whether a response is needed'],
    suggestedReply:'Thank you for your email. I will review the details and get back to you.'
  };
}
export type ParsedCommand = {intent: 'open'|'reply'|'compose'|'summary'|'unread'|'search'|'unknown', email?: Mail, recipient?: string, message: string};
export function parseMockCommand(text: string, mails: Mail[]): ParsedCommand {
  const cmd = text.toLowerCase().trim();
  const sorted = [...mails].filter(x=>x.folder==='inbox').sort((a,b)=>b.date.localeCompare(a.date));
  const named = sorted.find(mail=>cmd.includes(mail.from.toLowerCase().split(' ')[0]) || cmd.includes(mail.email.toLowerCase().split('@')[0]));
  const matching = named || (cmd.includes('internship') ? sorted.find(x=>x.subject.toLowerCase().includes('internship')) : undefined) || sorted[0];
  if(!cmd) return {intent:'unknown',message:'Enter a command to begin.'};
  if(/unread|unseen|parhi nahi|important unread/.test(cmd)) return {intent:'unread',message:'Showing unread messages from demo inbox.'};
  if(/summari[sz]e|summary|khulasa|samjhao|summarize/.test(cmd)) return {intent:'summary',email:matching,message:`Prepared a mock summary for “${matching?.subject || 'your email'}”.`};
  if(/reply|jawab|respond|response/.test(cmd)) return {intent:'reply',email:matching,message:`Prepared a reply draft to ${matching?.from || 'the sender'} for your approval.`};
  if(/open|kholo|read|dekho/.test(cmd)) return {intent:'open',email:matching,message:`Opened “${matching?.subject || 'a demo email'}”.`};
  if(/write|compose|email likho|draft|new email/.test(cmd)) return {intent:'compose',recipient:named?.email || '',message:'Opening a new draft for review.'};
  if(/search|find|dhoondo/.test(cmd)) return {intent:'search',message:'Opened inbox search.'};
  return {intent:'unknown',message:'Demo commands supported: open an email, summarize an email, prepare a reply, compose an email, or show unread emails.'};
}
