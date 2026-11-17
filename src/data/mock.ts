import type { Mail, Draft, Activity, Preferences } from '../types';

// All identities, addresses, dates and message bodies below are deliberately fictional demonstration data.
export const mockMails: Mail[] = [
  {
    id:'m1', from:'Dr. Amelia Hart', email:'amelia.hart@example.org', to:'alex@example.com',
    subject:'Research internship — next steps',
    preview:'Thank you for your interest in our summer research program. I would love to discuss...',
    body:'Hello Alex,\n\nThank you for your thoughtful note and your interest in our summer research program. We would love to learn more about your work in information retrieval and language models.\n\nCould you send a short project portfolio and your availability for a conversation next week? If possible, please respond by November 19, 2026.\n\nWarm regards,\nDr. Amelia Hart',
    date:'2026-11-13T09:42:00', unread:true, starred:true, important:true, folder:'inbox', category:'Academic', attachments:['Research overview.pdf'],
    thread:[{from:'You',date:'2026-11-10T15:30:00',body:'Dear Dr. Hart, I am interested in learning more about research opportunities for summer 2027.'}]
  },
  {
    id:'m2', from:'Ahmad Farooq', email:'ahmad.farooq@example.com', to:'alex@example.com',
    subject:'A quick update on our proposal', preview:'I have made the changes we discussed and attached the latest version...',
    body:'Hi Alex,\n\nI have updated the proposal with the improvements we discussed. The revised plan includes a clearer timeline and user journey.\n\nWould you be able to review it tomorrow and let me know what you think?\n\nThanks,\nAhmad',
    date:'2026-11-13T08:15:00', unread:true, starred:false, important:true, folder:'inbox', category:'Work', attachments:['Proposal-v3.pdf']
  },
  {
    id:'m3', from:'Career Development Office', email:'career.office@example.edu', to:'alex@example.com',
    subject:'Internship applications: important dates', preview:'Here are the next milestones for the summer internship process...',
    body:'Hello Students,\n\nThe internship application review period is underway. Please ensure that you have submitted your supporting documents.\n\nUpcoming milestones:\n• Document review: November 21, 2026\n• Optional portfolio workshop: November 25, 2026\n\nIf any information is missing, you will receive a separate email.\n\nBest regards,\nCareer Development Office',
    date:'2026-11-12T17:22:00', unread:true, starred:false, important:true, folder:'inbox', category:'Academic', attachments:[]
  },
  {
    id:'m4', from:'Nora Williams', email:'nora.williams@example.net', to:'alex@example.com',
    subject:'Design review notes for LifePilot', preview:'The direction feels focused. I left feedback on spacing and the reading experience...',
    body:'Hey Alex,\n\nThe new direction feels focused and much easier to navigate. I especially like the emphasis on email reading and fewer competing elements.\n\nTwo small suggestions: give the inbox rows a little more breathing room and make the approval state unmissable.\n\nHappy to chat this week.\n\nNora',
    date:'2026-11-12T13:05:00', unread:false, starred:true, important:false, folder:'inbox', category:'Work', attachments:['Review-notes.txt']
  },
  {
    id:'m5', from:'Maya Chen', email:'maya.chen@example.com', to:'alex@example.com',
    subject:'Coffee and a catch-up?', preview:'I will be around on Saturday if you have time for coffee...',
    body:'Hi Alex,\n\nI will be around on Saturday afternoon and thought we could catch up over coffee. Let me know if you are free!\n\nBest,\nMaya',
    date:'2026-11-11T19:48:00', unread:false, starred:false, important:false, folder:'inbox', category:'Personal', attachments:[]
  },
  {
    id:'m6', from:'The Product Letter', email:'hello@newsletter.example', to:'alex@example.com',
    subject:'The case for quieter interfaces', preview:'This week: thoughtful interactions, delightful details, and human-first software...',
    body:'Hello,\n\nThis week we explore why calmer interfaces are easier to learn and more enjoyable to use. Thoughtful hierarchy, helpful empty states, and accessible interactions make everyday software feel effortless.\n\nThe Product Letter',
    date:'2026-11-11T07:10:00', unread:true, starred:false, important:false, folder:'inbox', category:'Updates', attachments:[]
  },
  {
    id:'m7', from:'Oliver Reed', email:'oliver.reed@example.org', to:'alex@example.com',
    subject:'Following up on your portfolio', preview:'Thanks for sharing your work. I have a couple of questions about the retrieval project...',
    body:'Dear Alex,\n\nThank you for sharing your portfolio. Your retrieval project looks promising. Would you be able to explain how you evaluated the quality of the results?\n\nLooking forward to hearing from you.\n\nRegards,\nOliver Reed',
    date:'2026-11-10T11:35:00', unread:false, starred:true, important:false, folder:'inbox', category:'Academic', attachments:[]
  },
  {
    id:'m8', from:'You', email:'alex@example.com', to:'priya.shah@example.net',
    subject:'Thank you for the introduction', preview:'Thank you for connecting us. I really appreciate your support...',
    body:'Hi Priya,\n\nThank you for connecting us. I really appreciate your support and will follow up with the team this week.\n\nKind regards,\nAlex',
    date:'2026-11-09T09:10:00', unread:false, starred:false, important:false, folder:'sent', category:'Personal', attachments:[]
  }
];
export const mockDrafts: Draft[] = [
  { id:'d1',to:'amelia.hart@example.org',cc:'',bcc:'',subject:'Re: Research internship — next steps',
    body:'Dear Dr. Hart,\n\nThank you for your response. I would be happy to share my portfolio and discuss my recent work. I am available next week and can adjust to a time that works best for you.\n\nKind regards,\nAlex',
    status:'pending',tone:'Professional',length:'Medium',createdAt:'2026-11-13T11:05:00',sourceEmailId:'m1',attachments:[] },
  { id:'d2',to:'ahmad.farooq@example.com',cc:'',bcc:'',subject:'Re: A quick update on our proposal',
    body:'Hi Ahmad,\n\nThanks for sharing the updated proposal. I will review it and get back to you tomorrow.\n\nBest,\nAlex',
    status:'draft',tone:'Warm',length:'Short',createdAt:'2026-11-13T09:28:00',sourceEmailId:'m2',attachments:[] }
];
export const mockActivity: Activity[] = [
  {id:'a1',kind:'draft',title:'Reply prepared',detail:'Research internship — next steps',time:'2026-11-13T11:05:00'},
  {id:'a2',kind:'summary',title:'Email summarized',detail:'Internship applications: important dates',time:'2026-11-13T10:28:00'},
  {id:'a3',kind:'draft',title:'Draft saved',detail:'A quick update on our proposal',time:'2026-11-13T09:28:00'}
];
export const initialPreferences: Preferences = {
  theme:'light', language:'English', tone:'Professional', length:'Medium',
  greeting:'Hello',closing:'Kind regards',voiceReplies:false,notifications:true,privacyMode:true
};
