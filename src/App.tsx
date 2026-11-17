import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, Dispatch, SetStateAction } from 'react';
import {
  Activity as ActivityIcon, Archive, ArrowLeft, ArrowRight, ArrowUpRight, Bell, BookOpen,
  Calendar, Check, CheckCheck, CheckCircle2, ChevronDown, ChevronRight,
  Command, Copy, Download, Edit3, FileText, Filter, Headphones, Inbox, Layers3, LayoutDashboard,
  LockKeyhole, Mail, Menu, Mic, MicOff, Moon, Paperclip, PenLine, Plus,
  RefreshCcw, RotateCcw, Search, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Star,
  Sun, Trash2, Volume2, WandSparkles, X, Zap
} from 'lucide-react';
import type { Activity, Draft, Language, Mail as MailType, Page, Preferences, ReplyLength, Summary, Tone } from './types';
import { initialPreferences, mockActivity, mockDrafts, mockMails } from './data/mock';
import { delay, formatDate, generateMockReply, generateMockSummary, initials, parseMockCommand } from './services/mockEngine';
import {gmailApi, setCsrf, monitorApi} from './services/api';
import type {MonitorEvent} from './services/api';
import type {MonitorStatus,PushDevice} from './services/api';
import {enableWebPush} from './services/push';
import type {GmailSession, GmailCounts} from './services/api';
import {aiApi,toAiLanguage} from './services/ai';
import type {AiStatus,AiSummary,AiPreferences,AiCandidate,AiCommand} from './services/ai';

type InboxView = 'All' | 'Unread' | 'Important' | 'Sent' | 'Drafts' | 'Suggested';
type VoiceState = 'idle' | 'listening' | 'understanding' | 'searching' | 'preparing' | 'awaiting_approval' | 'completed' | 'error';
const allPages: { page: Page; name: string; icon: typeof Inbox }[] = [
  {page:'overview',name:'Overview',icon:LayoutDashboard}, {page:'inbox',name:'Smart inbox',icon:Inbox},
  {page:'compose',name:'AI composer',icon:PenLine}, {page:'voice',name:'Voice assistant',icon:Mic},
  {page:'summary',name:'AI summaries',icon:BookOpen}, {page:'approvals',name:'Approval center',icon:CheckCheck},
  {page:'activity',name:'Activity history',icon:ActivityIcon}, {page:'settings',name:'Settings',icon:Settings2}
];
const categoryColors: Record<string,string> = {Academic:'violet',Work:'blue',Personal:'rose',Updates:'amber',Primary:'blue',Social:'violet',Promotions:'rose',Forums:'blue'};
const localKey = 'lifepilot-prototype-v1-';
function useLocalState<T>(key: string, initial: T) {
  const [value,setValue] = useState<T>(()=>{
    try { const stored=window.localStorage.getItem(localKey+key); return stored ? JSON.parse(stored) as T : initial; }
    catch { return initial; }
  });
  useEffect(()=>{ try { window.localStorage.setItem(localKey+key,JSON.stringify(value)); } catch { /* storage may be unavailable */ } },[key,value]);
  return [value,setValue] as const;
}
function Logo({ compact=false, light=false }: {compact?:boolean;light?:boolean}) {
  return <div className={'brand '+(light?'brand-light':'')}>
    <span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 48 48"><path d="M24 3c5.7 8.5 6.9 14 0 21C17.1 17 18.3 11.5 24 3ZM45 24c-8.5 5.7-14 6.9-21 0 7-6.9 12.5-5.7 21 0ZM24 45c-5.7-8.5-6.9-14 0-21 6.9 7 5.7 12.5 0 21ZM3 24c8.5-5.7 14-6.9 21 0-7 6.9-12.5 5.7-21 0Z"/><circle cx="24" cy="24" r="4"/></svg></span>
    {!compact && <span className="brand-words"><strong>lifepilot<span className="brand-dot">.</span></strong><small>YOUR AI EMAIL COMPANION</small></span>}
  </div>;
}
function Orb({small=false,active=false}: {small?:boolean;active?:boolean}) {
  return <div className={'orb '+(small?'orb-small':'')+(active?' orb-active':'')} aria-hidden="true"><div className="orb-glow"/><div className="orb-ring orb-ring-one"/><div className="orb-ring orb-ring-two"/><div className="orb-core"><svg viewBox="0 0 100 100"><path d="M50 12C67 30 70 40 50 50 30 40 33 30 50 12Z"/><path d="M88 50C70 67 60 70 50 50 60 30 70 33 88 50Z"/><path d="M50 88C33 70 30 60 50 50 70 60 67 70 50 88Z"/><path d="M12 50C30 33 40 30 50 50 40 70 30 67 12 50Z"/></svg></div></div>;
}
function IconButton({children,onClick,label,active=false,disabled=false, className=''}:{children:ReactNode;onClick?:()=>void;label:string;active?:boolean;disabled?:boolean;className?:string}) {
  return <button type="button" className={'icon-button '+(active?'is-active ':'')+className} aria-label={label} title={label} disabled={disabled} onClick={onClick}>{children}</button>;
}
function Kicker({children}:{children:ReactNode}) {return <div className="kicker"><span className="kicker-dot"/>{children}</div>;}
function Empty({icon:Icon=Inbox,title,description,action}:{icon?:typeof Inbox;title:string;description:string;action?:ReactNode}) {
  return <div className="empty-state"><div className="empty-icon"><Icon size={23}/></div><strong>{title}</strong><p>{description}</p>{action}</div>;
}
function PageHead({eyebrow,title,description,action}:{eyebrow:string;title:string;description?:string;action?:ReactNode}) {
  return <div className="page-heading"><div><Kicker>{eyebrow}</Kicker><h1>{title}</h1>{description&&<p className="page-subtitle">{description}</p>}</div>{action&&<div className="heading-actions">{action}</div>}</div>;
}

export default function App() {
  const [page,setPage]=useState<Page>('welcome');
  const [demoMails,setDemoMails]=useLocalState<MailType[]>('mails',mockMails);
  const [demoDrafts,setDemoDrafts]=useLocalState<Draft[]>('drafts',mockDrafts);
  const [demoActivity,setDemoActivity]=useLocalState<Activity[]>('activity',mockActivity);
  const [realMails,setRealMails]=useState<MailType[]>([]);
  const [realDrafts,setRealDrafts]=useState<Draft[]>([]);
  const [realActivity,setRealActivity]=useState<Activity[]>([]);
  const [connection,setConnection]=useState<GmailSession|null>(null);
  const [workspaceMode,setWorkspaceMode]=useState<'demo'|'live'>('demo');
  const [syncing,setSyncing]=useState(false);
  const [syncError,setSyncError]=useState('');
  const [monitorStatus,setMonitorStatus]=useState<MonitorStatus|null>(null);
  const [monitorEvents,setMonitorEvents]=useState<MonitorEvent[]>([]);
  const [monitorBusy,setMonitorBusy]=useState(false);
  const [pushConfigured,setPushConfigured]=useState(false);
  const [pushDevices,setPushDevices]=useState<PushDevice[]>([]);
  const [realCounts,setRealCounts]=useState<GmailCounts|null>(null);
  const [nextPage,setNextPage]=useState<string|null>(null);
  const liveRequestId=useRef(0);
  const aiSummaryRequestId=useRef(0);
  const [sendConfirmed,setSendConfirmed]=useState(false);
  const live=connection?.connected===true&&workspaceMode==='live';
  const mails=live?realMails:demoMails;
  const drafts=live?realDrafts:demoDrafts;
  const activity=live?realActivity:demoActivity;
  const setMails:Dispatch<SetStateAction<MailType[]>>=live?setRealMails:setDemoMails;
  const setDrafts:Dispatch<SetStateAction<Draft[]>>=live?setRealDrafts:setDemoDrafts;
  const setActivity:Dispatch<SetStateAction<Activity[]>>=live?setRealActivity:setDemoActivity;
  const [prefs,setPrefs]=useLocalState<Preferences>('preferences',initialPreferences);
  const [selectedMailId,setSelectedMailId]=useState('m1');
  const [editingDraftId,setEditingDraftId]=useState<string|null>(null);
  const [activeInboxView,setActiveInboxView]=useState<InboxView>('All');
  const [search,setSearch]=useState('');
  const [category,setCategory]=useState('All categories');
  const [sort,setSort]=useState('Newest first');
  const [mobileOpen,setMobileOpen]=useState(false);
  const [toast,setToast]=useState('');
  const [busy,setBusy]=useState(false);
  const [confirmDraft,setConfirmDraft]=useState<Draft|null>(null);
  const [summaryEmailId,setSummaryEmailId]=useState('m1');
  const [summaryLanguage,setSummaryLanguage]=useState<Language>('Roman Urdu');
  const [command,setCommand]=useState('');
  const [voiceState,setVoiceState]=useState<VoiceState>('idle');
  const [voiceResult,setVoiceResult]=useState('');
  const [recordedCommand,setRecordedCommand]=useState('');
  const [aiStatus,setAiStatus]=useState<AiStatus|null>(null);
  const [aiPrefs,setAiPrefs]=useState<AiPreferences|null>(null);
  const [aiSummary,setAiSummary]=useState<AiSummary|null>(null);
  const [aiBusy,setAiBusy]=useState(false);
  const [aiInstruction,setAiInstruction]=useState('Please draft a polite, factual response without making commitments.');
  const [voiceLocale,setVoiceLocale]=useState<'en-US'|'ur-PK'>('en-US');
  const [commandCandidates,setCommandCandidates]=useState<AiCandidate[]>([]);
  const [pendingAiCommand,setPendingAiCommand]=useState<AiCommand|null>(null);
  const recognitionRef=useRef<{start:()=>void;stop:()=>void}|null>(null);
  const searchRef=useRef<HTMLInputElement>(null);
  const currentMail=mails.find(m=>m.id===selectedMailId)||(live?undefined:mails[0]);
  const summaryMail=mails.find(m=>m.id===summaryEmailId)||currentMail;
  const inboxMails=mails.filter(m=>m.folder==='inbox');
  const unread=live?(realCounts?.unread??0):inboxMails.filter(m=>m.unread).length;
  const priorities=live?(realCounts?.important??0):inboxMails.filter(m=>m.important).length;
  const pending=drafts.filter(d=>d.status==='pending').length;
  const aiReady=live&&Boolean(aiStatus?.enabled&&aiStatus.consent);

  const notify=useCallback((message:string)=>setToast(message),[]);
  useEffect(()=>{
    let mounted=true;
    gmailApi.session().then(session=>{
      if(!mounted)return;
      setConnection(session);setCsrf(session.csrf||'');
      if(session.connected)setWorkspaceMode('live');
    }).catch(()=>{if(mounted)setConnection({connected:false,configured:false,monitoring:'Backend unavailable'})});
    return()=>{mounted=false};
  },[]);
  useEffect(()=>{
    if(!connection?.connected)return;
    let active=true;
    Promise.all([aiApi.status(),aiApi.preferences()]).then(([status,preferences])=>{
      if(!active)return;
      setAiStatus(status);setAiPrefs(preferences);
      setPrefs(old=>({...old,tone:preferences.tone,length:preferences.length,greeting:preferences.greeting,closing:preferences.closing}));
    }).catch(()=>{if(active)setAiStatus(null)});
    return()=>{active=false};
  },[connection?.connected]);
  const refreshMonitor=async()=>{
    if(!connection?.connected)return;
    try{
      const [next,push,events]=await Promise.all([monitorApi.status(),monitorApi.pushStatus(),monitorApi.events()]);
      setMonitorStatus(next);setPushConfigured(push.configured);setPushDevices(push.devices);setMonitorEvents(events.events);
    }catch(e){setMonitorStatus(null)}
  };
  useEffect(()=>{if(!connection?.connected)return;void refreshMonitor();const interval=window.setInterval(()=>void refreshMonitor(),60000);return ()=>window.clearInterval(interval);},[connection?.connected]);
  useEffect(()=>{
    const requested=new URLSearchParams(window.location.search).get('open');
    if(requested==='inbox'||requested==='approvals'||requested==='settings'){
      setPage(requested);
      window.history.replaceState(null,'',window.location.pathname);
    }
  },[]);
  const toggleMonitor=async(enabled:boolean)=>{
    if(!connection?.connected)return;
    try{setMonitorBusy(true);setMonitorStatus(await monitorApi.enable(enabled));
      notify(enabled?'Monitoring preference enabled. It will work automatically only after a real cloud scheduler is running.':'Monitoring paused on the backend.');
    }catch(e){apiProblem(e)}finally{setMonitorBusy(false)}
  };
  const toggleAutoAi=async(enabled:boolean)=>{
    if(enabled&&!window.confirm('Automatic AI processing sends the content of eligible NEW inbox messages to GroqCloud on your deployed backend. It can prepare up to '+(monitorStatus?.autoAiDailyLimit||2)+' review-only drafts per UTC day. Sensitive and automated messages are filtered, but always check the original. No email is sent automatically. Continue?'))return;
    try{setMonitorBusy(true);setMonitorStatus(await monitorApi.configureAutoAi(enabled,monitorStatus?.autoAiDailyLimit||2,monitorStatus?.autoAiScope||'primary'));notify(enabled?'Automatic AI triage enabled with a daily limit. Only NEW eligible messages are considered.':'Automatic AI triage disabled.');}
    catch(e){apiProblem(e)}finally{setMonitorBusy(false)}
  };
  const changeAutoLimit=async(value:number)=>{
    try{setMonitorBusy(true);setMonitorStatus(await monitorApi.configureAutoAi(Boolean(monitorStatus?.autoAiEnabled),value,monitorStatus?.autoAiScope||'primary'));notify('Daily automatic AI draft limit updated.');}
    catch(e){apiProblem(e)}finally{setMonitorBusy(false)}
  };
  const changeAutoScope=async(scope:'primary'|'all-eligible')=>{
    if(scope==='all-eligible'&&!window.confirm('Broader monitoring will send content from eligible Primary, Updates and Forums messages to GroqCloud. Promotions, Social, automated, financial, authentication and other sensitive messages remain excluded. Confirm?'))return;
    try{setMonitorBusy(true);setMonitorStatus(await monitorApi.configureAutoAi(Boolean(monitorStatus?.autoAiEnabled),monitorStatus?.autoAiDailyLimit||2,scope));notify('Automatic AI inbox scope saved.');}
    catch(e){apiProblem(e)}finally{setMonitorBusy(false)}
  };
  const checkMonitor=async()=>{
    try{setMonitorBusy(true);const r=await monitorApi.check();setMonitorStatus(r.status);
      notify('Gmail history checked. First check establishes a baseline without retroactive notifications.');
    }catch(e){apiProblem(e)}finally{setMonitorBusy(false)}
  };
  const removeDevice=async(id:string)=>{
    if(!window.confirm('Stop push alerts for this registered device?'))return;
    try{setMonitorBusy(true);await monitorApi.removePush(id);notify('Push registration removed.');await refreshMonitor();}
    catch(e){apiProblem(e)}finally{setMonitorBusy(false)}
  };
  const enableNotifications=async()=>{
    try{setMonitorBusy(true);notify(await enableWebPush());await refreshMonitor();}
    catch(e){apiProblem(e)}finally{setMonitorBusy(false)}
  };
  const saveAiPreferences=async()=>{
    if(!live)return;
    try{setAiBusy(true);const next=await aiApi.updatePreferences({tone:prefs.tone,length:prefs.length,greeting:prefs.greeting,closing:prefs.closing,summaryLanguage:toAiLanguage(prefs.language),speechRate:aiPrefs?.speechRate||1});setAiPrefs(next);notify('Writing preferences saved securely on backend.')}catch(e){apiProblem(e)}finally{setAiBusy(false)}
  };
  const updateAiConsent=async(enabled:boolean)=>{
    if(!connection?.connected){notify('Connect Gmail first.');return;}
    if(enabled&&!window.confirm('GroqCloud may process selected Gmail message content and draft instructions. Separately enabling automatic AI review below also permits processing newly arrived eligible messages. No email will be sent without separate approval. Allow this external processing?'))return;
    try{setAiBusy(true);await aiApi.consent(enabled);setAiStatus(old=>old?{...old,consent:enabled}:old);if(!enabled)setAiSummary(null);notify(enabled?'AI processing enabled for this Gmail account.':'AI processing disabled.')}catch(e){apiProblem(e)}finally{setAiBusy(false)}
  };
  const loadReal=async(view:InboxView='All',searchQuery='',append=false,token='')=>{
    if(!connection?.connected)return;
    const requestId=++liveRequestId.current;
    setSyncing(true);setSyncError('');
    try{
      const folder=view==='Sent'?'sent':view==='Unread'?'unread':view==='Important'||view==='Suggested'?'important':'inbox';
      // Drafts are local backend records; do not trigger 25 Gmail message reads for that tab.
      // AI suggestions cannot be fetched in Module 2, so do not generate misleading results.
      if(view==='Drafts'||view==='Suggested'){
        const [counts,draftData]=await Promise.all([gmailApi.stats(),gmailApi.drafts()]);
        if(requestId!==liveRequestId.current)return;
        setRealMails([]);setNextPage(null);setRealCounts(counts);setRealDrafts(draftData.drafts);
        return;
      }
      const [pageData,counts,draftData]=await Promise.all([
        gmailApi.mail(folder,searchQuery,token),gmailApi.stats(),gmailApi.drafts()
      ]);
      if(requestId!==liveRequestId.current)return;
      setRealMails(old=>append?[...old,...pageData.mails.filter(m=>!old.some(x=>x.id===m.id))]:pageData.mails);
      setNextPage(pageData.nextPageToken);setRealCounts(counts);setRealDrafts(draftData.drafts);
      if(!append&&pageData.mails[0])setSelectedMailId(pageData.mails[0].id);
    }catch(e){if(requestId!==liveRequestId.current)return;setSyncError(e instanceof Error?e.message:'Gmail refresh failed');
      if((e as {status?:number}).status===401){setConnection(old=>old?{...old,connected:false,monitoring:'Reauthorization Required'}:old);setWorkspaceMode('demo');setPage('settings')}
    }finally{if(requestId===liveRequestId.current)setSyncing(false)}
  };
  useEffect(()=>{if(connection?.connected&&workspaceMode==='live')void loadReal(activeInboxView,search);},[connection?.connected,workspaceMode]);
  useEffect(()=>{
    if(!live)return;
    const timer=window.setTimeout(()=>{void loadReal(activeInboxView,search);},450);
    return()=>window.clearTimeout(timer);
  },[search,activeInboxView]);
  const apiProblem=(error:unknown)=>{const msg=error instanceof Error?error.message:'The request failed';notify(msg);setSyncError(msg);if((error as {status?:number})?.status===401){setConnection(old=>old?{...old,connected:false,monitoring:'Reauthorization Required'}:old);setWorkspaceMode('demo');setPage('settings')}};
  const changeLiveMode=(mode:'demo'|'live')=>{setWorkspaceMode(mode);setSyncError('');go('overview')};
  const disconnect=async()=>{if(!window.confirm('Disconnect Gmail and delete locally stored Gmail tokens, drafts, and attachments?'))return;
    try{await gmailApi.disconnect();setConnection({connected:false,configured:true,monitoring:'Disconnected'});setCsrf('');setWorkspaceMode('demo');setRealMails([]);setRealDrafts([]);setRealCounts(null);setAiStatus(null);setAiPrefs(null);setAiSummary(null);notify('Gmail disconnected; demo workspace remains available.')}catch(e){apiProblem(e)}
  };
  useEffect(()=>{if(!toast)return;const timeout=window.setTimeout(()=>setToast(''),3600);return()=>window.clearTimeout(timeout)},[toast]);
  useEffect(()=>{document.documentElement.dataset.theme=prefs.theme;document.documentElement.lang=prefs.language==='Roman Urdu'?'ur-Latn':'en';},[prefs.theme,prefs.language]);
  const go=(to:Page)=>{setPage(to);setMobileOpen(false);window.scrollTo({top:0,behavior:'smooth'});};
  const addActivity=(title:string,detail:string,kind:Activity['kind'])=>setActivity(old=>[{id:crypto.randomUUID(),title,detail,kind,time:new Date().toISOString()},...old].slice(0,90));
  const patchMail=async(id:string,update:Partial<MailType>)=>{
    if(!live){setMails(old=>old.map(mail=>mail.id===id?{...mail,...update}:mail));return}
    try{
      const [field,value]=Object.entries(update)[0]||[];
      const action=field==='unread'?'read':field==='starred'?'star':field==='important'?'important':'archive';
      const response=await gmailApi.updateMail(id,action,action==='read'?!value:action==='archive'?true:Boolean(value));
      setRealMails(old=>old.map(mail=>mail.id===id?{...mail,...response.mail}:mail));
      const count=await gmailApi.stats();setRealCounts(count);
    }catch(e){apiProblem(e)}
  };
  const openMail=async(id:string)=>{
    setSelectedMailId(id);go('read');
    const mail=mails.find(m=>m.id===id);
    if(live){try{const detail=await gmailApi.mailDetail(id);setRealMails(old=>old.some(x=>x.id===id)?old.map(x=>x.id===id?detail:x):[detail,...old]);}catch(e){apiProblem(e)}}
    if(mail?.unread)void patchMail(id,{unread:false});
  };
  const enterInbox=(view:InboxView='All')=>{setActiveInboxView(view);setCategory('All categories');go('inbox');};
  const createDraft=async(source?:MailType)=>{
    if(live){try{setBusy(true);const next=await gmailApi.createDraft({to:'',cc:'',bcc:'',subject:'',body:'',...(source?{sourceEmailId:source.id}:{})});setRealDrafts(old=>[next,...old]);setEditingDraftId(next.id);go('compose');notify(source?'Reply created. You can write manually or generate with Groq after consent.':'New Gmail draft created on LifePilot backend.');}catch(e){apiProblem(e)}finally{setBusy(false)}return}
    const next:Draft={id:crypto.randomUUID(),to:source?.email||'',cc:'',bcc:'',subject:source?`Re: ${source.subject.replace(/^Re:\s*/i,'')}`:'',
      body:source?generateMockReply(source,prefs.tone,prefs.length,prefs.closing):'',status:'draft',tone:prefs.tone,length:prefs.length,createdAt:new Date().toISOString(),sourceEmailId:source?.id,attachments:[]};
    setDrafts(old=>[next,...old]);setEditingDraftId(next.id);go('compose');addActivity('Composer opened',next.subject||'New email','draft');
  };
  const updateDraft=(id:string,updates:Partial<Draft>)=>setDrafts(old=>old.map(d=>d.id===id?{...d,...updates}:d));
  const persistDraft=async(d:Draft)=>{
    if(!live)return d;
    const saved=await gmailApi.saveDraft(d);
    setRealDrafts(old=>old.map(x=>x.id===d.id?saved:x));return saved;
  };
  const requestDraftApproval=async(d:Draft)=>{
    if(!d.to.includes('@')||!d.to.includes('.')){notify('Please enter a valid recipient email.');return}
    if(!d.subject.trim()||!d.body.trim()){notify('Add a subject and message before requesting approval.');return}
    if(live){try{setBusy(true);const saved=await persistDraft(d);const pending=await gmailApi.requestReview(saved);setRealDrafts(old=>old.map(x=>x.id===d.id?pending:x));notify('Stored on backend for approval. Nothing sent.');go('approvals')}catch(e){apiProblem(e)}finally{setBusy(false)}return}
    updateDraft(d.id,{status:'pending'});addActivity('Approval requested',d.subject,'approval');notify('Added to Approval Center. Nothing has been sent.');go('approvals');
  };
  const saveCurrentDraft=async(d:Draft)=>{
    if(live){try{setBusy(true);await persistDraft(d);notify('Draft stored on LifePilot backend.');go('approvals')}catch(e){apiProblem(e)}finally{setBusy(false)}return}
    updateDraft(d.id,{status:'draft'});notify('Draft saved to this browser.');addActivity('Draft saved',d.subject||'(No subject)','draft');go('approvals');
  };
  const rejectDraft=async(d:Draft)=>{if(live){try{const next=await gmailApi.reject(d.id);setRealDrafts(old=>old.map(x=>x.id===d.id?next:x));notify('Draft rejected without sending.')}catch(e){apiProblem(e)}return}updateDraft(d.id,{status:'rejected'});addActivity('Draft rejected',d.subject,'approval');notify('Draft rejected — no send.');};
  const uploadFiles=async(d:Draft,files:FileList|null)=>{
    const items=Array.from(files||[]);if(!items.length)return;
    if(!live){updateDraft(d.id,{attachments:[...d.attachments,...items.map(f=>f.name)]});notify('Demo filenames only — contents are not uploaded.');return}
    setBusy(true);
    try{
      // Ensure text/recipient edits are persisted before an attachment API response replaces local state.
      await persistDraft(d);
      for(const file of items){if(file.size>5*1024*1024)throw new Error('Each attachment must be 5 MB or smaller');
        const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]||'');reader.onerror=()=>reject(new Error('File reading failed'));reader.readAsDataURL(file)});
        const result=await gmailApi.attach(d.id,file.name,file.type||'application/octet-stream',data);
        setRealDrafts(old=>old.map(x=>x.id===d.id?result:x));
      }
      notify('Attachment securely stored on backend.');
    }catch(e){apiProblem(e)}finally{setBusy(false)}
  };
  const removeDraftAttachment=async(d:Draft,name:string)=>{
    if(!live){updateDraft(d.id,{attachments:d.attachments.filter(x=>x!==name)});return}
    const meta=d.attachmentDetails?.find(a=>a.name===name);if(!meta)return;
    try{await persistDraft(d);const result=await gmailApi.removeAttachment(d.id,meta.id);setRealDrafts(old=>old.map(x=>x.id===d.id?result:x))}catch(e){apiProblem(e)}
  };
  const openDraft=(id:string)=>{setEditingDraftId(id);go('compose');};
  const markApproved=(d:Draft)=>{setSendConfirmed(false);setConfirmDraft(d);};
  const confirmSend=async()=>{
    if(!confirmDraft)return;
    const d=confirmDraft;
    if(live){
      if(!sendConfirmed){notify('Review all details and check the confirmation box first.');return}
      setBusy(true);
      try{
        const approved=await gmailApi.approve(d);
        // The server checks approval ID, exact revision, content fingerprint and prior send attempts.
        const sent=await gmailApi.send(approved.draft,approved.approvalId);
        if(!sent.sent||!sent.gmailMessageId)throw new Error('Gmail did not confirm the send');
        setRealDrafts(old=>old.map(x=>x.id===d.id?sent.draft:x));setConfirmDraft(null);setSendConfirmed(false);
        notify(`Gmail accepted the message: ${sent.gmailMessageId}`);go('approvals');
      }catch(e){setConfirmDraft(null);setSendConfirmed(false);apiProblem(e);void gmailApi.drafts().then(x=>setRealDrafts(x.drafts)).catch(()=>{});}finally{setBusy(false)}
      return;
    }
    setConfirmDraft(null);setBusy(true);await delay(450);
    updateDraft(d.id,{status:'sent'});
    setMails(old=>[{id:crypto.randomUUID(),from:'You',email:'alex@example.com',to:d.to,subject:d.subject||'(No subject)',preview:d.body.slice(0,90),body:d.body,date:new Date().toISOString(),unread:false,starred:false,important:false,folder:'sent',category:'Personal',attachments:d.attachments},...old]);
    addActivity('Simulated send approved',`To ${d.to} · ${d.subject}`,'approval');setBusy(false);notify('Simulation complete — no real email was sent.');go('approvals');
  };
  const loadAiSummary=async(messageId:string,language:Language)=>{
    if(!aiReady){notify('Connect Gmail and enable Groq in Settings, including consent.');go('settings');return;}
    const requestId=++aiSummaryRequestId.current;setSummaryEmailId(messageId);setSummaryLanguage(language);setAiSummary(null);setAiBusy(true);go('summary');
    try{const result=await aiApi.summarize(messageId,toAiLanguage(language));if(requestId!==aiSummaryRequestId.current)return;setAiSummary(result);addActivity('AI summary generated',`Gmail message ${messageId} · ${language}`,'summary');}
    catch(e){if(requestId===aiSummaryRequestId.current)apiProblem(e)}finally{if(requestId===aiSummaryRequestId.current)setAiBusy(false)}
  };
  const generateSummary=(mail:MailType)=>{
    if(live){void loadAiSummary(mail.id,summaryLanguage);return;}
    setSummaryEmailId(mail.id);setSummaryLanguage(prefs.language);addActivity('Mock summary created',mail.subject,'summary');go('summary');
  };
  const createAiReplyFromId=async(messageId:string,instruction:string)=>{
    if(!aiReady){notify('Enable Groq AI and consent in Settings.');go('settings');return;}
    const prompt=instruction.trim();if(!prompt){notify('Please enter what you want the reply to say.');return;}
    setAiBusy(true);setVoiceState('preparing');
    try{const draft=await aiApi.reply({messageId,instruction:prompt,tone:prefs.tone,length:prefs.length,language:toAiLanguage(prefs.language)});
      setRealDrafts(old=>[draft,...old]);setEditingDraftId(draft.id);setVoiceState('awaiting_approval');addActivity('Groq suggested reply',draft.subject,'draft');go('compose');notify('AI draft created. Review and request approval; nothing was sent.');}
    catch(e){setVoiceState('error');apiProblem(e)}finally{setAiBusy(false)}
  };

  const filteredMails=useMemo(()=>{
    const q=search.trim().toLowerCase();
    let result=mails.filter(mail=>{
      const matchFolder=activeInboxView==='Sent'?mail.folder==='sent':mail.folder==='inbox';
      const matchFilter=activeInboxView==='Unread'?mail.unread:activeInboxView==='Important'?mail.important:activeInboxView==='Suggested'?mail.important&&mail.folder==='inbox':true;
      const matchCategory=category==='All categories'||mail.category===category;
      const matchText=live||!q||`${mail.from} ${mail.email} ${mail.subject} ${mail.preview} ${mail.body}`.toLowerCase().includes(q);
      return matchFolder&&matchFilter&&matchCategory&&matchText;
    });
    result=[...result].sort((a,b)=>sort==='Oldest first'?a.date.localeCompare(b.date):sort==='Sender A–Z'?a.from.localeCompare(b.from):b.date.localeCompare(a.date));
    return result;
  },[mails,activeInboxView,category,search,sort]);
  const todayLabel=new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});
  const isRoman=prefs.language==='Roman Urdu';
  const translations: Record<string,string> = {Overview:'Jaiza','Smart inbox':'Smart inbox','AI composer':'AI likhai','Voice assistant':'Voice assistant','AI summaries':'Email khulasa','Approval center':'Manzoori center','Activity history':'Activity history',Settings:'Settings'};
  useEffect(()=>{
    const handleKey=(ev:KeyboardEvent)=>{
      if((ev.ctrlKey||ev.metaKey)&&ev.key.toLowerCase()==='k'){ev.preventDefault();if(page==='welcome')go('overview');window.setTimeout(()=>searchRef.current?.focus(),0);}
      if(ev.key==='Escape'){setConfirmDraft(null);setMobileOpen(false);}
    };
    window.addEventListener('keydown',handleKey);return()=>window.removeEventListener('keydown',handleKey);
  },[page]);

  const processCommand=async(input:string)=>{
    if(!input.trim()){notify('Type a voice command first.');return;}
    setRecordedCommand(input);setCommand(input);setVoiceResult('');setVoiceState('understanding');setBusy(true);
    await delay(220);
    if(live){
      if(!aiReady){setVoiceState('error');setVoiceResult('Groq is not enabled or consent has not been given. Open Settings or use Gmail manually.');setBusy(false);return;}
      try{
        setCommandCandidates([]);setPendingAiCommand(null);
        const result=await aiApi.command(input,toAiLanguage(prefs.language));
        setPendingAiCommand(result);
        if(result.intent==='clarify'||result.intent==='unsupported'){
          setVoiceState('completed');setVoiceResult(result.clarification||'Please clarify the request. You can use manual Gmail controls.');setCommandCandidates(result.candidates||[]);return;
        }
        if(result.intent==='show_unread'){setVoiceState('completed');setVoiceResult('Showing real unread Gmail messages.');enterInbox('Unread');return;}
        if(result.intent==='search_email'){setVoiceState('completed');setVoiceResult('Showing real Gmail search results.');setSearch(result.query||'');enterInbox('All');return;}
        if(result.intent==='compose_email'){
          if(!result.recipient){setVoiceResult('Provide a verified recipient email address.');setVoiceState('completed');return;}
          setVoiceState('preparing');const draft=await aiApi.compose({recipient:result.recipient,instruction:result.instruction||input,tone:prefs.tone,length:prefs.length,language:toAiLanguage(prefs.language)});
          setRealDrafts(old=>[draft,...old]);setEditingDraftId(draft.id);setVoiceState('awaiting_approval');setVoiceResult('Draft created for your review. No email sent.');go('compose');return;
        }
        if(result.messageId){
          setVoiceState('searching');
          if(result.intent==='open_email'){await openMail(result.messageId);setVoiceResult('Opened the selected real Gmail message.');}
          if(result.intent==='summarize_email'){await loadAiSummary(result.messageId,result.language==='roman-urdu'?'Roman Urdu':'English');setVoiceResult('Generated summary from the selected real email.');}
          if(result.intent==='reply_to_email'){await createAiReplyFromId(result.messageId,result.instruction||'Write a polite acknowledgement without promises.');setVoiceResult('Prepared a draft for review. No email sent.');}
          if(result.intent!=='reply_to_email')setVoiceState('completed');return;
        }
        setVoiceResult('Please select the correct Gmail message.');setCommandCandidates(result.candidates||[]);setVoiceState('completed');
      }catch(e){setVoiceState('error');setVoiceResult(e instanceof Error?e.message:'Could not process command. Use manual Gmail controls.');apiProblem(e)}
      finally{setBusy(false)}
      return;
    }
    const result=parseMockCommand(input,mails);
    if(['open','summary','reply'].includes(result.intent)){setVoiceState('searching');await delay(240);}
    if(['reply','compose'].includes(result.intent)){setVoiceState('preparing');await delay(240);}
    setVoiceResult(result.message);setVoiceState(result.intent==='unknown'?'error':result.intent==='reply'?'awaiting_approval':'completed');setBusy(false);
    addActivity('Typed / voice command',input,'voice');
    if(result.intent==='unread') enterInbox('Unread');
    if(result.intent==='search') enterInbox('All');
    if(result.intent==='open'&&result.email)openMail(result.email.id);
    if(result.intent==='summary'&&result.email)generateSummary(result.email);
    if(result.intent==='reply'&&result.email){createDraft(result.email);notify('Mock reply prepared — review before approving.');}
    if(result.intent==='compose'){
      const d:Draft={id:crypto.randomUUID(),to:result.recipient||'',cc:'',bcc:'',subject:'',body:'',status:'draft',tone:prefs.tone,length:prefs.length,createdAt:new Date().toISOString(),attachments:[]};
      setDrafts(old=>[d,...old]);setEditingDraftId(d.id);go('compose');
    }
  };
  const chooseCommandCandidate=async(candidate:AiCandidate)=>{
    const pending=pendingAiCommand;
    setCommandCandidates([]);
    if(!pending)return;
    if((pending.requestedIntent||pending.intent)==='open_email'){await openMail(candidate.id);setVoiceResult('Opened selected message.');}
    else if((pending.requestedIntent||pending.intent)==='summarize_email'){await loadAiSummary(candidate.id,pending.language==='roman-urdu'?'Roman Urdu':'English');}
    else if((pending.requestedIntent||pending.intent)==='reply_to_email'){await createAiReplyFromId(candidate.id,pending.instruction||'Please draft a polite factual reply.');}
    else await openMail(candidate.id);
  };
  const startListening=()=>{
    const root=window as Window & {SpeechRecognition?:new()=>SpeechRecognitionLike;webkitSpeechRecognition?:new()=>SpeechRecognitionLike};
    const API=root.SpeechRecognition||root.webkitSpeechRecognition;
    if(!API){setVoiceState('error');notify('Speech recognition is not available here. Please type your command.');return;}
    if(voiceState==='listening'){recognitionRef.current?.stop();setVoiceState('idle');return;}
    try{
      const recog=new API();recog.lang=voiceLocale;recog.interimResults=true;recog.continuous=false;
      recog.onresult=(event)=>{const text=Array.from(event.results).map(x=>x[0].transcript).join(' ');setCommand(text);if(event.results[event.results.length-1].isFinal){recognitionRef.current=null;setVoiceState('idle');notify('Transcript ready. Check the text, then click Run command.');}};
      recog.onerror=()=>{setVoiceState('error');notify('Microphone unavailable or permission denied. Try typing instead.');};
      recog.onend=()=>setVoiceState(current=>current==='listening'?'idle':current);
      recognitionRef.current=recog;setVoiceState('listening');recog.start();
    }catch{setVoiceState('error');notify('Microphone could not start. Use the text command field.');}
  };
  const speak=(text:string)=>{
    if(!('speechSynthesis' in window)){notify('Speech playback is not supported in this browser.');return;}
    window.speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(text);utterance.rate=live?(aiPrefs?.speechRate||1):.93;window.speechSynthesis.speak(utterance);notify(live?'Playing browser speech. Pronunciation varies by installed voices.':'Reading demonstration text aloud.');
  };
  const resetDemo=()=>{if(!window.confirm('Reset all fictional inbox data, drafts, settings, and activity?'))return;setDemoMails(mockMails);setDemoDrafts(mockDrafts);setDemoActivity(mockActivity);setPrefs(initialPreferences);notify('Demo workspace restored.');go('overview');};

  function MailRow({mail}:{mail:MailType}) {
    return <div className={'mail-row '+(mail.unread?'mail-unread':'')}>
      <button className="mail-hit" type="button" onClick={()=>openMail(mail.id)} aria-label={`Open ${mail.subject}`}>
        <span className={'avatar avatar-'+categoryColors[mail.category]}>{initials(mail.from)}</span>
        <span className="mail-text"><span className="mail-sender">{mail.from}{mail.unread&&<span className="unread-dot"/>}</span><span className="mail-subject">{mail.subject}</span><span className="mail-preview">{mail.preview}</span></span>
      </button>
      <div className="mail-side"><span className="mail-time">{formatDate(mail.date)}</span><div className="mail-row-actions">
        {mail.attachments.length>0&&<Paperclip size={13} className="muted-icon"/>}
        <button type="button" aria-label={mail.starred?'Remove star':'Star email'} title="Toggle star" className={'tiny-icon '+(mail.starred?'gold':'')} onClick={()=>patchMail(mail.id,{starred:!mail.starred})}><Star size={16} fill={mail.starred?'currentColor':'none'}/></button>
        <button type="button" aria-label={mail.unread?'Mark read':'Mark unread'} title="Toggle read" className="tiny-icon" onClick={()=>patchMail(mail.id,{unread:!mail.unread})}><Mail size={16}/></button>
      </div></div>
    </div>;
  }
  function MailList({items,limit}:{items:MailType[];limit?:number}) {
    const display=typeof limit==='number'?items.slice(0,limit):items;
    if(display.length===0)return <Empty title={live&&syncing?'Loading Gmail…':'All clear for now'} description={live&&syncing?'Retrieving messages from your connected account.':'Nothing matches this view. Try changing your filters.'}/>;
    return <div className="mail-list">{display.map(mail=><MailRow key={mail.id} mail={mail}/>)}</div>;
  }
  function Dashboard(){
    const latest=[...inboxMails].sort((a,b)=>b.date.localeCompare(a.date));
    return <div className="page-enter dashboard-page">{live&&<div className="sync-banner"><ShieldCheck size={16}/> Connected as {connection?.email} · Gmail content · Manual refresh <button onClick={()=>void loadReal('All')}>Refresh now</button></div>}
      <div className="dashboard-heading"><div><Kicker>{todayLabel} <span className="kicker-separator">/</span> YOUR WORKSPACE</Kicker><h1>{isRoman?'Aaj ka din, zyada asaan.':'A calmer way to stay ahead.'}</h1><p>{live?`Connected to ${connection?.email}. Your Gmail inbox is shown below.`:'Demo workspace · fictional messages and simulated AI.'}</p></div><div className="dashboard-heading-actions"><button className="button secondary" onClick={()=>enterInbox('All')}><Inbox size={17}/> Open inbox</button><button className="button primary" onClick={()=>createDraft()}><Plus size={17}/> Compose email</button></div></div>
      <div className="metrics-strip">
        <div className="metric"><div className="metric-icon mint"><Mail size={19}/></div><div><strong>{live?(realCounts?.inbox??'—'):inboxMails.length}</strong><span>Inbox messages</span></div><ArrowUpRight size={15}/></div>
        <button className="metric metric-button" onClick={()=>enterInbox('Unread')}><div className="metric-icon peach"><Inbox size={19}/></div><div><strong>{live?(realCounts?.unread??'—'):unread}</strong><span>Unread</span></div><ArrowUpRight size={15}/></button>
        <button className="metric metric-button" onClick={()=>enterInbox('Important')}><div className="metric-icon lavender"><Star size={19}/></div><div><strong>{live?(realCounts?.important??'—'):priorities}</strong><span>Important (Gmail)</span></div><ArrowUpRight size={15}/></button>
        <button className="metric metric-button" onClick={()=>go('approvals')}><div className="metric-icon sky"><CheckCircle2 size={19}/></div><div><strong>{pending}</strong><span>Awaiting approval</span></div><ArrowUpRight size={15}/></button>
      </div>
      <div className="hero-and-focus">
        <div className="assistant-card"><div className="assistant-copy"><div className="eyebrow-on-dark"><span className="online-dot"/> YOUR INTELLIGENT WORKSPACE</div><h2>A little less inbox.<br/><em>A lot more clarity.</em></h2><p>Ask LifePilot to find, understand, or draft the right email. Every send stays in your hands.</p><div className="assistant-buttons"><button className="button lime" onClick={()=>go('voice')}><Mic size={17}/> Talk to LifePilot <ArrowRight size={16}/></button><button className="text-button light" onClick={()=>go('summary')}>Explore summaries <ArrowUpRight size={15}/></button></div></div><div className="assistant-visual"><div className="orbit-label orbit-top"><Sparkles size={14}/> A thoughtful assistant</div><Orb/><div className="orbit-label orbit-bottom"><span className="signal-bar"/> Ready when you are</div></div></div>
        <div className="focus-card"><div className="panel-eyebrow"><Sparkles size={15}/> LIFE PILOT INSIGHT <span>{live?'LIVE':'MOCK'}</span></div><div className="focus-art"><span>✳</span><span>02</span></div><h3>Worth your attention.</h3><p>{live?`Gmail reports ${realCounts?.important??'—'} important messages. Review your latest conversations directly.`:`There are ${priorities} important demo conversations. Start with the research internship next steps.`}</p><button className="link-action" onClick={()=>live?enterInbox('Important'):void openMail('m1')}>Review priority email <ArrowRight size={16}/></button></div>
      </div>
      <div className="dashboard-lower">
        <section className="surface inbox-preview"><div className="section-heading"><div><h2>From your inbox</h2><p>Recent conversations, without the noise.</p></div><button className="link-action" onClick={()=>enterInbox('All')}>View all <ArrowRight size={16}/></button></div><MailList items={latest} limit={4}/></section>
        <section className="surface activity-preview"><div className="section-heading"><div><h2>Recent activity</h2><p>Your AI workspace, at a glance.</p></div><button className="icon-button" onClick={()=>go('activity')} aria-label="View activity"><ArrowUpRight size={18}/></button></div><div className="mini-timeline">{activity.slice(0,3).map((a,i)=><div className="timeline-row" key={a.id}><div className="timeline-rail"><span className={'timeline-spot '+(i===0?'active':'')}/></div><div><strong>{a.title}</strong><p>{a.detail}</p><small>{formatDate(a.time)}</small></div></div>)}</div><div className="simulation-note"><ShieldCheck size={17}/> {live?'Gmail connected · Manual refresh · AI enabled only with Groq setup and consent.':'Demo workspace. No live Gmail emails shown.'}</div></section>
      </div>
    </div>;
  }
  function InboxPage(){return <div className="page-enter"><PageHead eyebrow="YOUR MESSAGES" title="Smart inbox" description="Everything important, beautifully organized." action={<button className="button primary" onClick={()=>createDraft()}><Plus size={17}/> New message</button>}/>
    <div className="surface mail-surface">{live&&<div className="sync-banner inbox-sync"><span>{syncing?'Refreshing Gmail…':syncError?'Gmail sync error: '+syncError:'Gmail connected · '+(realMails.length)+' messages loaded · '+(monitorStatus?.status||'Manual refresh')}</span><button onClick={()=>void loadReal(activeInboxView,search)}>Refresh</button></div>}<div className="inbox-tabs">{(['All','Unread','Important','Sent','Drafts','Suggested'] as InboxView[]).map(v=><button key={v} className={'tab '+(activeInboxView===v?'active':'')} onClick={()=>{setActiveInboxView(v);setSearch('');}}>{v}{v==='Unread'&&<span className="tab-count">{unread}</span>}{v==='Drafts'&&<span className="tab-count">{drafts.filter(d=>d.status==='draft').length}</span>}</button>)}</div>
    <div className="inbox-toolbar"><div className="select-wrap"><Filter size={15}/><select aria-label="Category" value={category} onChange={e=>setCategory(e.target.value)}>{(live?['All categories','Primary','Social','Promotions','Updates','Forums']:['All categories','Academic','Work','Personal','Updates']).map(c=><option key={c}>{c}</option>)}</select><ChevronDown size={14}/></div><div className="toolbar-spacer"/><div className="select-wrap"><SlidersHorizontal size={15}/><select aria-label="Sort emails" value={sort} onChange={e=>setSort(e.target.value)}>{['Newest first','Oldest first','Sender A–Z'].map(x=><option key={x}>{x}</option>)}</select><ChevronDown size={14}/></div><span className="toolbar-count">{activeInboxView==='Drafts'?drafts.filter(d=>d.status==='draft').length:filteredMails.length} items</span></div>
    {live&&activeInboxView==='Suggested'?<Empty icon={Sparkles} title="AI suggestions require consent" description="Suggested replies are available when you open an email; AI processing needs explicit consent. No simulated Gmail suggestions are shown here."/>:activeInboxView==='Drafts'?<div className="draft-list">{drafts.filter(d=>d.status==='draft').length===0?<Empty icon={FileText} title="No saved drafts" description="A fresh start. Create a message when you are ready."/>:drafts.filter(d=>d.status==='draft').map(d=><button className="draft-list-row" onClick={()=>openDraft(d.id)} key={d.id}><span className="avatar avatar-violet"><FileText size={17}/></span><span><strong>{d.subject||'(No subject)'}</strong><small>To: {d.to||'Recipient not added'} · {d.body.slice(0,90)}</small></span><ArrowRight size={17}/></button>)}</div>:<><MailList items={filteredMails}/>{live&&nextPage&&<div className="load-more-row"><button disabled={syncing} className="button secondary" onClick={()=>void loadReal(activeInboxView,search,true,nextPage)}>{syncing?'Loading…':'Load more Gmail messages'}</button></div>}</>}
    </div></div>;}
  function ReadPage(){
    if(!currentMail)return <Empty title="Message unavailable" description="Select an email from the inbox." action={<button className="button secondary" onClick={()=>enterInbox()}>Back to inbox</button>}/>;
    return <div className="page-enter"><div className="reader-back"><button className="plain-back" onClick={()=>enterInbox('All')}><ArrowLeft size={17}/> Back to inbox</button><span>INBOX / MESSAGE DETAIL</span></div><div className="reader-layout"><article className="surface reader-panel"><div className="reader-actions"><span className="pill muted-pill"><span className="status-dot"/> {live?'Gmail message':'Demo message'}</span><div className="reader-icon-actions"><IconButton label={currentMail.starred?'Unstar message':'Star message'} onClick={()=>patchMail(currentMail.id,{starred:!currentMail.starred})} active={currentMail.starred}><Star size={18}/></IconButton><IconButton label="Archive" onClick={()=>{patchMail(currentMail.id,{folder:'archive'});notify(live?'Gmail archive request submitted.':'Message archived (demo).');enterInbox();}}><Archive size={18}/></IconButton><IconButton label="Mark important" active={currentMail.important} onClick={()=>patchMail(currentMail.id,{important:!currentMail.important})}><Zap size={18}/></IconButton></div></div>
      <span className={'category-tag '+categoryColors[currentMail.category]}>{currentMail.category}</span><h1>{currentMail.subject}</h1><div className="reader-contact"><span className={'avatar avatar-large avatar-'+categoryColors[currentMail.category]}>{initials(currentMail.from)}</span><div><strong>{currentMail.from}</strong><p>{currentMail.email} <span>to {currentMail.to}</span></p></div><time>{formatDate(currentMail.date,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</time></div>
      {currentMail.thread?.map((item,i)=><details className="thread-history" key={i}><summary><span><Mail size={15}/> Earlier message from {item.from}</span><small>{formatDate(item.date)}</small></summary><p className="email-body">{item.body}</p></details>)}
      <div className="email-body">{currentMail.body}</div>{currentMail.attachments.length>0&&<div className="attachment-area"><h3>Attachments <span>{currentMail.attachments.length}</span></h3>{currentMail.attachments.map(a=><div className="attachment" key={a}><FileText size={19}/><span>{a}<small>{live?'Gmail attachment':'Demo file · content unavailable'}</small></span><IconButton label="Download attachment" onClick={()=>{if(!live){notify('Demo attachment has no file contents.');return;}const detail=currentMail.attachmentDetails?.find(x=>x.name===a);if(!detail){notify('Attachment details unavailable.');return;}void gmailApi.downloadAttachment(currentMail.id,detail.id,a).catch(apiProblem);}}><Download size={17}/></IconButton></div>)}</div>}
      <div className="reader-footer"><button className="button primary" onClick={()=>live?void createAiReplyFromId(currentMail.id,aiInstruction):createDraft(currentMail)}><WandSparkles size={17}/> {live?'Draft with Groq':'Generate reply'}</button><button className="button secondary" onClick={()=>{createDraft(currentMail);notify('You can edit the entire reply before approval.');}}><Edit3 size={17}/> Reply manually</button><button className="button ghost" onClick={()=>generateSummary(currentMail)}><BookOpen size={17}/> Summarize</button></div></article>
      <aside className="reader-aside"><div className="intelligence-panel"><div className="panel-eyebrow"><Sparkles size={15}/> AI ASSISTANCE</div><Orb small/><h3>Understand first.<br/>Respond with care.</h3><p>Turn a long email into a clear summary, or create a reply you can review before sending.</p>{live&&<label className="field-label ai-instruction-label">Reply instruction<textarea aria-label="AI reply instruction" rows={3} value={aiInstruction} onChange={e=>setAiInstruction(e.target.value)} placeholder="Tell LifePilot what your reply should say"/></label>}<button className="button lime full" onClick={()=>generateSummary(currentMail)}>Summarize this email <ArrowRight size={16}/></button></div><div className="side-tip"><ShieldCheck size={17}/><p>{live?'Groq works only after backend setup and consent. AI prepares drafts only; the original backend approval controls real sending.':'AI actions are simulated. No real email is sent from the demo.'}</p></div></aside></div></div>;
  }
  const activeDraft=drafts.find(d=>d.id===editingDraftId)||null;
  const [expandedCc,setExpandedCc]=useState(false);
  const [composerBusy,setComposerBusy]=useState(false);
  const editorRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(page==='compose'&&editorRef.current){editorRef.current.textContent=activeDraft?.body||'';}},[page,editingDraftId]);
  const regenerate=async(d:Draft)=>{
    if(live){
      if(!aiReady){notify('Enable Groq AI and consent in Settings.');return;}
      if(!window.confirm('Replace the current draft text with a new AI proposal? Your real attachments will remain. You will need to request approval again.'))return;
      if(!aiInstruction.trim()){notify('Enter an instruction for the AI proposal first.');return;}
      setComposerBusy(true);
      try{
        const saved=await persistDraft(d);
        const base={instruction:aiInstruction,tone:d.tone,length:d.length,language:toAiLanguage(prefs.language),draftId:saved.id,expectedVersion:saved.version};
        const next=d.sourceEmailId?await aiApi.reply({...base,messageId:d.sourceEmailId}):await aiApi.compose({...base,recipient:saved.to,cc:saved.cc,bcc:saved.bcc});
        setRealDrafts(old=>old.map(x=>x.id===d.id?next:x));
        if(editorRef.current)editorRef.current.textContent=next.body;
        notify('Groq proposal saved as editable draft. Prior approval invalidated. Nothing sent.');
      }catch(e){apiProblem(e)}finally{setComposerBusy(false)}
      return;
    }
    setComposerBusy(true);await delay(550);
    const source=mails.find(m=>m.id===d.sourceEmailId)||null;
    const body=generateMockReply(source,d.tone,d.length,prefs.closing);
    updateDraft(d.id,{body});if(editorRef.current)editorRef.current.textContent=body;
    setComposerBusy(false);notify('New simulated draft prepared. Review before approving.');
  };
  function ComposerPage(){
    if(!activeDraft)return <div className="page-enter"><PageHead eyebrow="AI WRITING STUDIO" title="Write with intention." description="Create a polished message and stay in full control."/><div className="surface compose-start"><Orb small/><h2>Make a good first impression.</h2><p>Start a new message, or choose an email and prepare a thoughtful reply.</p><button className="button primary" onClick={()=>createDraft()}><Plus size={17}/> Start a new email</button></div></div>;
    const d=activeDraft;
    return <div className="page-enter"><div className="reader-back"><button className="plain-back" onClick={()=>go('approvals')}><ArrowLeft size={17}/> Back to drafts</button><span>AI STUDIO / COMPOSE</span></div>
      <div className="compose-layout"><div className="surface compose-panel"><div className="compose-header"><div><Kicker>THE WRITING STUDIO</Kicker><h1>{d.subject?'Refine your message.':'Start with a thought.'}</h1><p>Every word is yours to review.</p></div><span className="pill mock-pill"><span className="status-dot"/> {live?'GMAIL · EDITABLE AI DRAFT':'SIMULATION'}</span></div>
        <div className="compose-meta"><div className="input-line"><label htmlFor="compose-to">To</label><input id="compose-to" type="email" multiple placeholder="recipient@example.com" value={d.to} onChange={e=>updateDraft(d.id,{to:e.target.value,status:'draft'})}/><button className="small-link" onClick={()=>setExpandedCc(v=>!v)}>Cc / Bcc</button></div>
          {expandedCc&&<><div className="input-line"><label htmlFor="compose-cc">Cc</label><input id="compose-cc" type="text" placeholder="Optional copies" value={d.cc} onChange={e=>updateDraft(d.id,{cc:e.target.value,status:'draft'})}/></div><div className="input-line"><label htmlFor="compose-bcc">Bcc</label><input id="compose-bcc" type="text" placeholder="Optional private copies" value={d.bcc} onChange={e=>updateDraft(d.id,{bcc:e.target.value,status:'draft'})}/></div></>}
          <div className="input-line"><label htmlFor="compose-subject">Subject</label><input id="compose-subject" placeholder="A clear, thoughtful subject" value={d.subject} onChange={e=>updateDraft(d.id,{subject:e.target.value,status:'draft'})}/></div></div>
        <div className="editor-frame"><div className="editor-toolbar"><span>{live?'MESSAGE · PLAIN TEXT':'MESSAGE'}</span><div><button title="Bold selection" aria-label="Bold selection" onMouseDown={e=>e.preventDefault()} disabled={live} onClick={()=>document.execCommand('bold')}><b>B</b></button><button title="Italic selection" aria-label="Italic selection" onMouseDown={e=>e.preventDefault()} disabled={live} onClick={()=>document.execCommand('italic')}><i>I</i></button><button title="Bullet list" aria-label="Insert bullet list" onMouseDown={e=>e.preventDefault()} disabled={live} onClick={()=>document.execCommand('insertUnorderedList')}>☷</button><span className="toolbar-divider"/><span className="word-indicator">{d.body.trim()?d.body.trim().split(/\s+/).length:0} words</span></div></div>
          <div ref={editorRef} className="editable-message" role="textbox" aria-label="Email message body" contentEditable suppressContentEditableWarning data-placeholder="Write your message here, or let LifePilot prepare a starting point…" onInput={e=>updateDraft(d.id,{body:e.currentTarget.innerText,status:'draft'})}/></div>
        {d.attachments.length>0&&<div className="attached-chips">{d.attachments.map(a=><span key={a}><Paperclip size={13}/>{a}<button aria-label={`Remove ${a}`} onClick={()=>void removeDraftAttachment(d,a)}><X size={13}/></button></span>)}</div>}
        <div className="compose-footer"><div className="compose-tools"><label className="icon-button file-input" title={live?'Upload encrypted draft attachment':'Attach demo filename'}><Paperclip size={18}/><input type="file" disabled={busy} multiple aria-label="Attach files" onChange={e=>{void uploadFiles(d,e.target.files);e.target.value='';}}/></label><IconButton label="Copy message" onClick={()=>{void navigator.clipboard?.writeText(d.body).then(()=>notify('Message copied.')).catch(()=>notify('Clipboard unavailable.'));}}><Copy size={18}/></IconButton><span className="saved-hint"><Check size={13}/> {live?'Save to backend before approval':'Local demo draft'}</span></div><div className="compose-submit"><button className="button ghost" disabled={busy} onClick={()=>void saveCurrentDraft(d)}>Save draft</button><button className="button primary" disabled={busy} onClick={()=>void requestDraftApproval(d)}><CheckCheck size={17}/> Request approval <ArrowRight size={16}/></button></div></div>
      </div><aside className="compose-aside"><div className="writing-card"><div className="panel-eyebrow"><Sparkles size={15}/> {live?'GROQ WRITING ASSISTANT':'MOCK WRITING ASSISTANT'}</div><Orb small/><h3>Find the right words.</h3><p>Adjust the tone, choose a length, then generate a new suggested message.</p>{live&&<label className="field-label ai-instruction-label">Tell AI what to write<textarea value={aiInstruction} rows={4} onChange={e=>setAiInstruction(e.target.value)} aria-label="AI draft instruction"/></label>}<label className="field-label">Writing tone</label><div className="segmented">{(['Professional','Warm','Concise'] as Tone[]).map(t=><button key={t} className={d.tone===t?'active':''} onClick={()=>updateDraft(d.id,{tone:t})}>{t}</button>)}</div><label className="field-label">Response length</label><div className="segmented">{(['Short','Medium','Detailed'] as ReplyLength[]).map(l=><button key={l} className={d.length===l?'active':''} onClick={()=>updateDraft(d.id,{length:l})}>{l}</button>)}</div><button className="button lime full" disabled={composerBusy||busy||(live&&!aiReady)} onClick={()=>void regenerate(d)}><RefreshCcw size={16}/>{composerBusy?'Preparing…':'Regenerate suggestion'}</button><small>{live?'AI requires backend setup and explicit consent. Draft text is never auto-sent.':'Template-based simulation, not a connected AI model.'}</small></div><div className="side-tip"><LockKeyhole size={17}/><p>{live?'Backend approval is required before real Gmail sending. Uploaded attachments are encrypted at rest.':'Approval is required for simulated sends. Demo attachments are names only.'}</p></div></aside></div>
    </div>;
  }
  function VoicePage(){
    return <div className="page-enter"><PageHead eyebrow="LIFEPILOT VOICE" title="Just say what you need." description="A thoughtful interface for the way you naturally speak." action={<span className="pill mock-pill"><span className="status-dot"/> Speech support varies by browser</span>}/>
      <div className="voice-layout"><div className="voice-hero"><div className="voice-hero-head"><span>YOUR PERSONAL ASSISTANT</span><span>01 / VOICE STUDIO</span></div><div className="voice-visual"><Orb active={voiceState==='listening'||voiceState==='understanding'}/><div className="voice-wave" aria-hidden="true">{Array.from({length:21},(_,i)=><span key={i} style={{height:`${12+Math.round(48*Math.abs(Math.sin(i*1.37)))}px`}}/>)}</div></div><div className="voice-status"><span className={'status-led '+voiceState}/>{voiceState==='idle'?'Ready to listen':voiceState==='listening'?'Listening to your voice…':voiceState==='understanding'?'Understanding your command…':voiceState==='searching'?(live?'Opening Gmail inbox…':'Searching fictional emails…'):voiceState==='preparing'?(live?'Preparing an editable AI draft…':'Preparing a mock draft…'):voiceState==='awaiting_approval'?'Draft awaiting your approval':voiceState==='error'?'Typed command recommended':(live?'Command processed':'Command processed (demo)')}</div><h2>{voiceState==='listening'?'I’m listening.':'Your words, your workflow.'}</h2><p>Speak a command or type it below. Real speech recognition is used only if your browser supports it and you give permission.</p><button className={'mic-cta '+(voiceState==='listening'?'mic-listening':'')} onClick={startListening}>{voiceState==='listening'?<MicOff size={21}/>:<Mic size={21}/>} {voiceState==='listening'?'Stop listening':'Start speaking'}</button></div>
      <div className="voice-controls"><div className="command-box"><div className="command-box-header"><span><Command size={16}/> TYPE A COMMAND</span><span className="mini-demo">{live?(aiReady?'GROQ · CONSENTED':'AI OFF'):'DEMO ENGINE'}</span></div><label className="field-label">Recognition language <select aria-label="Recognition language" value={voiceLocale} onChange={e=>setVoiceLocale(e.target.value as 'en-US'|'ur-PK')}><option value="en-US">English</option><option value="ur-PK">Urdu (browser support varies)</option></select></label><textarea aria-label="Voice command fallback" rows={3} placeholder="Try: Summarize my latest internship email in Roman Urdu…" value={command} onChange={e=>setCommand(e.target.value)}/><div className="command-actions"><span>Press the button to process your typed command.</span><button className="button primary" disabled={busy} onClick={()=>void processCommand(command)}><Sparkles size={16}/> {busy?'Processing…':'Run command'}</button></div></div>
        {commandCandidates.length>0&&<div className="surface ai-choice"><strong>Select the correct Gmail message</strong><p>Multiple matches found. LifePilot will not guess.</p>{commandCandidates.map(m=><button key={m.id} className="example-command" onClick={()=>void chooseCommandCandidate(m)}>{m.from} · {m.subject} · {new Date(m.date).toLocaleDateString()}</button>)}</div>}{recordedCommand&&<div className="command-result"><div className="panel-eyebrow"><CheckCircle2 size={15}/> LATEST COMMAND</div><strong>“{recordedCommand}”</strong><p>{voiceResult||'Command routed to the relevant demo screen.'}</p><button className="small-link" onClick={()=>speak(voiceResult||recordedCommand)}><Volume2 size={15}/> Read result aloud</button><button className="small-link" onClick={()=>window.speechSynthesis?.cancel()}><MicOff size={15}/> Stop speech</button></div>}
        <div className="examples-card"><div className="section-heading"><h3>Try asking LifePilot</h3><span>EXAMPLES</span></div>{['Show my unread emails','Summarize my latest internship email in Roman Urdu','Open the latest email from Ahmad','Reply to Ahmad about his proposal','Write a new email'].map(x=><button className="example-command" key={x} onClick={()=>{setCommand(x);void processCommand(x)}}><span>{x}</span><ArrowUpRight size={15}/></button>)}</div>
      </div></div>
    </div>;
  }
  function SummaryPage(){
    if(live)return <div className="page-enter"><PageHead eyebrow="GROQ EMAIL UNDERSTANDING" title="An accurate summary, in your words." description="Only the selected authorized Gmail email is processed after AI consent." action={<button className="button secondary" onClick={()=>enterInbox()}><Inbox size={17}/> Choose email</button>}/>
      <div className="summary-grid"><section className="surface summary-main"><div className="summary-topline"><span className="category-tag violet"><Sparkles size={13}/> {aiReady?'REAL GROQ AI':'AI NOT ENABLED'}</span><label className="language-picker">Language <select aria-label="Summary language" value={summaryLanguage} onChange={e=>{const lang=e.target.value as Language;setSummaryLanguage(lang);void loadAiSummary(summaryEmailId,lang)}}><option>Roman Urdu</option><option>English</option><option>Professional English</option></select></label></div>
      {!aiReady?<Empty icon={ShieldCheck} title="AI consent and backend key required" description="Enable Groq and approve external AI processing in Settings. No real email is sent to AI without consent." action={<button className="button secondary" onClick={()=>go('settings')}>AI Settings</button>}/>:aiBusy?<p role="status">Groq is analyzing your selected message…</p>:!aiSummary?<Empty icon={BookOpen} title="No AI summary yet" description="Select an email in Gmail and choose Summarize, or retry this message." action={<button className="button secondary" onClick={()=>void loadAiSummary(summaryEmailId,summaryLanguage)}>Retry summary</button>}/>:<><h2>What the sender says</h2><p className="summary-intro">{aiSummary.summary}</p><div className="summary-section"><div><h3>Key points</h3><ul>{aiSummary.keyPoints.map((v,i)=><li key={i}>{v}</li>)}</ul></div></div><div className="summary-section"><div><h3>Dates from source</h3><ul>{aiSummary.dates.length?aiSummary.dates.map((v,i)=><li key={i}>{v}</li>):<li>No verified date in source.</li>}</ul></div></div><div className="summary-section"><div><h3>Possible action items</h3><ul>{aiSummary.actionItems.map((v,i)=><li key={i}>{v}</li>)}</ul></div></div><div className="summary-section"><div><h3>What is uncertain</h3><ul>{aiSummary.uncertainties.length?aiSummary.uncertainties.map((v,i)=><li key={i}>{v}</li>):<li>No uncertainty explicitly identified. Verify the original email.</li>}</ul></div></div>{aiSummary.sourceTruncated&&<p role="alert">Long source was only partially analyzed. Review original before relying on this summary.</p>}<div className="summary-bottom"><button className="button primary" onClick={()=>void createAiReplyFromId(aiSummary.messageId,aiInstruction)}><PenLine size={16}/> Draft response</button><button className="button secondary" onClick={()=>speak(aiSummary.summary)}><Volume2 size={16}/> Read aloud</button><button className="button ghost" onClick={()=>window.speechSynthesis?.cancel()}>Stop voice</button></div></>}</section>
      <aside className="summary-right"><div className="reference-card"><strong>Original Gmail message</strong><p>AI summary is not a substitute for the original email. Names, dates and commitments must be verified.</p><button className="link-action" onClick={()=>void openMail(summaryEmailId)}>Open source email <ArrowRight size={16}/></button></div></aside></div></div>;
    if(!summaryMail)return <Empty title="No message selected" description="Choose an email to summarize."/>;
    const summary:Summary=generateMockSummary(summaryMail,summaryLanguage);
    return <div className="page-enter"><PageHead eyebrow="AI READING ROOM" title="Clarity in a few lines." description="A reading companion for long conversations and important details." action={<button className="button secondary" onClick={()=>enterInbox()}><Inbox size={17}/> Choose another email</button>}/>
      <div className="summary-grid"><div className="surface summary-main"><div className="summary-topline"><span className="category-tag violet"><Sparkles size={13}/> MOCK AI SUMMARY</span><div className="language-picker"><span>Language</span><select aria-label="Summary language" value={summaryLanguage} onChange={e=>setSummaryLanguage(e.target.value as Language)}><option>Roman Urdu</option><option>English</option><option>Professional English</option></select><ChevronDown size={14}/></div></div><div className="summary-selector"><label htmlFor="summary-email">SELECT AN EMAIL TO SUMMARIZE</label><select id="summary-email" value={summaryEmailId} onChange={e=>setSummaryEmailId(e.target.value)}>{inboxMails.map(m=><option key={m.id} value={m.id}>{m.subject}</option>)}</select></div><h2>{summary.title}</h2><p className="summary-intro">{summary.intro}</p><div className="summary-rule"/><div className="summary-section"><div className="summary-section-icon"><Layers3 size={18}/></div><div><h3>Key takeaways</h3><ul>{summary.points.map((p,i)=><li key={i}>{p}</li>)}</ul></div></div><div className="summary-section"><div className="summary-section-icon amber"><Calendar size={18}/></div><div><h3>Dates mentioned in email</h3>{summary.dates.length?summary.dates.map((d,i)=><span className="date-chip" key={i}><Calendar size={13}/>{d}</span>):<p className="muted-text">No explicit calendar dates detected.</p>}</div></div><div className="summary-section"><div className="summary-section-icon blue"><Check size={18}/></div><div><h3>Suggested next steps</h3><ul>{summary.actions.map((p,i)=><li key={i}>{p}</li>)}</ul></div></div><div className="summary-bottom"><button className="button primary" onClick={()=>createDraft(summaryMail)}><PenLine size={17}/> Prepare a reply</button><button className="button secondary" onClick={()=>speak(summary.intro)}><Volume2 size={17}/> Read aloud</button><button className="button ghost" onClick={()=>void navigator.clipboard?.writeText(`${summary.intro}\n${summary.points.join('\n')}`).then(()=>notify('Summary copied.')).catch(()=>notify('Clipboard unavailable.'))}><Copy size={17}/> Copy summary</button></div></div>
      <aside className="summary-right"><div className="reference-card"><div className="panel-eyebrow">SOURCE MESSAGE</div><div className="reference-sender"><span className={'avatar avatar-'+categoryColors[summaryMail.category]}>{initials(summaryMail.from)}</span><div><strong>{summaryMail.from}</strong><small>{formatDate(summaryMail.date)}</small></div></div><h3>{summaryMail.subject}</h3><p>{summaryMail.preview}</p><button className="link-action" onClick={()=>openMail(summaryMail.id)}>View original email <ArrowRight size={16}/></button></div><div className="simulation-note"><ShieldCheck size={17}/> Summaries use local templates, not Groq or Gmail. Verify all dates against the original email.</div></aside></div>
    </div>;
  }
  function ApprovalsPage(){
    return <div className="page-enter"><PageHead eyebrow="HUMAN-IN-THE-LOOP" title="The final word is yours." description="Review every AI-generated message before it goes anywhere." action={<button className="button primary" onClick={()=>createDraft()}><Plus size={17}/> New draft</button>}/>
      <div className="approval-note"><ShieldCheck size={22}/><div><strong>Nothing sends without your approval.</strong><p>{live?'Your backend verifies the exact message content before each Gmail send.':'Simulation only — no real email is sent.'}</p></div><span>{live?'GMAIL ACTIVE':'DEMO SAFE'}</span></div>
      <div className="approvals-grid"><div><div className="section-title"><h2>Awaiting your review</h2><span>{drafts.filter(d=>d.status==='pending').length} pending</span></div>
        {drafts.filter(d=>d.status==='pending').length===0?<div className="surface"><Empty icon={CheckCheck} title="Everything reviewed" description="New AI-generated drafts will appear here when you request approval."/></div>:drafts.filter(d=>d.status==='pending').map(d=><div className="surface approval-card" key={d.id}><div className="approval-card-top"><span className="pill review-pill"><span className="review-dot"/> Awaiting approval</span><small>{formatDate(d.createdAt)}</small></div><h3>{d.subject}</h3><p className="approval-recipient">To <strong>{d.to}</strong></p><p className="approval-excerpt">{d.body.slice(0,190)}{d.body.length>190?'…':''}</p><div className="approval-card-actions"><button className="button primary" onClick={()=>markApproved(d)}><Check size={16}/> Review & approve</button><button className="button secondary" onClick={()=>openDraft(d.id)}><Edit3 size={16}/> Preview / edit</button><button className="button ghost" disabled={live} title={live?'Open the draft to regenerate with Groq':'Regenerate template'} onClick={()=>{const source=mails.find(m=>m.id===d.sourceEmailId)||null;const body=generateMockReply(source,d.tone,d.length,prefs.closing);updateDraft(d.id,{body,status:'draft'});openDraft(d.id);notify('New mock suggestion prepared. Review it and request approval again.');}}><RefreshCcw size={15}/> Regenerate</button><button className="button ghost" onClick={()=>{if(live){void openDraft(d.id);}else{updateDraft(d.id,{status:'draft'});notify('Returned to saved drafts.');}}}><FileText size={15}/> Edit</button><IconButton label="Reject draft" onClick={()=>void rejectDraft(d)}><X size={18}/></IconButton></div></div>)}
        <div className="section-title section-spaced"><h2>Saved drafts</h2><span>{drafts.filter(d=>d.status==='draft').length} drafts</span></div><div className="surface compact-drafts">{drafts.filter(d=>d.status==='draft').length===0?<Empty icon={FileText} title="No unfinished drafts" description="A clean slate for your next message."/>:drafts.filter(d=>d.status==='draft').map(d=><button className="compact-draft" onClick={()=>openDraft(d.id)} key={d.id}><span className="draft-icon"><FileText size={17}/></span><span><strong>{d.subject||'Untitled message'}</strong><small>To {d.to||'Add a recipient'}</small></span><ArrowRight size={16}/></button>)}</div></div>
      <aside><div className="approval-steps"><div className="panel-eyebrow"><ShieldCheck size={15}/> APPROVAL BY DESIGN</div><h3>You stay in control.</h3>{['LifePilot prepares a draft','You review every detail','You explicitly approve',live?'Gmail confirms before sent status':'A simulated send is recorded'].map((x,i)=><div className="approval-step" key={x}><span>{String(i+1).padStart(2,'0')}</span><p>{x}</p></div>)}</div><div className="mini-status"><div className="mini-status-title"><CheckCircle2 size={18}/> {live?'Gmail confirmed':'Simulation history'}</div><strong>{drafts.filter(d=>d.status==='sent').length}</strong><p>{live?'Gmail API confirmed sends':'Simulated sends completed'}</p></div></aside></div>
      {drafts.some(d=>d.status==='sent'||d.status==='rejected'||d.status==='unknown'||d.status==='sending')&&<div className="surface completed-drafts"><div className="section-heading"><h2>Previously reviewed</h2><span>{live?'Backend draft history':'Demo history'}</span></div>{drafts.filter(d=>d.status==='sent'||d.status==='rejected'||d.status==='unknown'||d.status==='sending').map(d=><div className="history-row" key={d.id}><span className={'status-mark '+(d.status==='sent'?'done':'rejected')}>{d.status==='sent'?<Check size={15}/>:<X size={15}/>}</span><span><strong>{d.subject}</strong><small>{d.status==='unknown'||d.status==='sending'?'SEND STATUS UNKNOWN — check Gmail Sent; retry blocked':d.status==='sent'?(live?'Gmail confirmed':'Simulated send — not delivered'):'Rejected without sending'} · {d.to}</small></span><button className="small-link" onClick={()=>openDraft(d.id)}>View</button></div>)}</div>}
    </div>;
  }
  function SettingsPage(){
    const updatePrefs=(p:Partial<Preferences>)=>setPrefs(old=>({...old,...p}));
    return <div className="page-enter"><PageHead eyebrow="MAKE IT YOURS" title="A workspace that feels like you." description="Fine-tune your writing preferences, voice, and personal experience."/>
      <div className="settings-layout"><div><section className="surface settings-section"><div className="settings-section-head"><div className="settings-icon"><SlidersHorizontal size={20}/></div><div><h2>Writing preferences</h2><p>How LifePilot prepares your messages.</p></div></div><div className="settings-fields"><label>Default language<select value={prefs.language} onChange={e=>updatePrefs({language:e.target.value as Language})}><option>English</option><option>Roman Urdu</option><option>Professional English</option></select></label><label>Default writing tone<select value={prefs.tone} onChange={e=>updatePrefs({tone:e.target.value as Tone})}><option>Professional</option><option>Warm</option><option>Concise</option></select></label><label>Default reply length<select value={prefs.length} onChange={e=>updatePrefs({length:e.target.value as ReplyLength})}><option>Short</option><option>Medium</option><option>Detailed</option></select></label><label>Greeting style<input value={prefs.greeting} onChange={e=>updatePrefs({greeting:e.target.value})} placeholder="Hello"/></label><label>Preferred closing<input value={prefs.closing} onChange={e=>updatePrefs({closing:e.target.value})} placeholder="Kind regards"/></label></div></section>
        {connection?.connected&&<section className="surface settings-section"><div className="settings-section-head"><div className="settings-icon lavender"><Sparkles size={20}/></div><div><h2>Groq AI · External processing consent</h2><p>{aiStatus?.configured?`Model: ${aiStatus.model}`:'Set GROQ_API_KEY and AI_ENABLED=true in backend/.env.'}</p></div></div><p className="muted-text">Selected emails are shared with GroqCloud after this consent. Optional automatic processing also requires a separate explicit opt-in below. AI cannot send messages. Disable at any time.</p><div className="switch-row"><span><strong>Allow AI to process selected Gmail messages</strong><small>{aiStatus?.enabled?(aiStatus.consent?'Enabled · user consent recorded':'Consent required'):'AI disabled on backend'}</small></span><button role="switch" aria-label="Allow external Groq AI processing" aria-checked={Boolean(aiStatus?.consent)} disabled={aiBusy||!aiStatus?.enabled} className={'switch '+(aiStatus?.consent?'on':'')} onClick={()=>void updateAiConsent(!aiStatus?.consent)}><span/></button></div><label className="field-label">Speech rate <input type="number" min="0.7" max="1.5" step="0.1" value={aiPrefs?.speechRate||1} onChange={e=>setAiPrefs(old=>old?{...old,speechRate:Number(e.target.value)}:old)}/></label><div className="connection-actions"><button className="button primary" disabled={aiBusy} onClick={()=>void saveAiPreferences()}>Save AI writing preferences</button><button className="button secondary" disabled={aiBusy} onClick={()=>{if(window.confirm('Forget stored AI writing preferences for this account?'))void aiApi.resetPreferences().then(setAiPrefs).then(()=>notify('AI preferences reset.')).catch(apiProblem)}}>Forget AI preferences</button></div><small>Provider requests: {aiStatus?.usage.requests??0} (session status may be stale; refresh Settings). Private mail and API key are not stored in browser preferences.</small></section>}
        {connection?.connected&&<section className="surface settings-section"><div className="settings-section-head"><div className="settings-icon sky"><RefreshCcw size={20}/></div><div><h2>Gmail monitoring</h2><p>Genuine scheduled history checks, never automatic sending.</p></div></div>
          <div className="switch-row"><span><strong>Monitor new inbox messages</strong><small>{monitorStatus?.status||'Checking status'} · {monitorStatus?.workerConfigured?'Scheduler configured':'Cloud scheduler not deployed'}</small></span>
            <button role="switch" aria-label="Enable Gmail monitoring" aria-checked={Boolean(monitorStatus?.enabled)} disabled={monitorBusy} className={'switch '+(monitorStatus?.enabled?'on':'')} onClick={()=>void toggleMonitor(!monitorStatus?.enabled)}><span/></button></div>
          <div className="switch-row"><span><strong>Optional automatic AI summaries and review-only drafts</strong><small>Additional consent required. Groq receives only eligible newly-arrived email text. Automated, sensitive and non-primary messages are excluded. Never auto-send.</small></span><button role="switch" aria-label="Allow automatic AI review drafts for new eligible messages" aria-checked={Boolean(monitorStatus?.autoAiEnabled)} disabled={monitorBusy||(!monitorStatus?.autoAiEnabled&&(!monitorStatus?.enabled||!aiStatus?.consent||!aiStatus.enabled))} className={'switch '+(monitorStatus?.autoAiEnabled?'on':'')} onClick={()=>void toggleAutoAi(!monitorStatus?.autoAiEnabled)}><span/></button></div>
          <label className="field-label">Maximum automatically drafted replies per UTC day
            <select aria-label="Automatic AI daily draft limit" value={monitorStatus?.autoAiDailyLimit||2} disabled={monitorBusy||!connection?.connected} onChange={e=>void changeAutoLimit(Number(e.target.value))}>{[1,2,3,5,10,15,20,25].map(v=><option key={v} value={v}>{v}</option>)}</select>
          </label>
          <label className="field-label">Which incoming emails should AI review?
            <select aria-label="Automatic AI monitoring inbox scope" value={monitorStatus?.autoAiScope||'primary'} disabled={monitorBusy||!connection?.connected} onChange={e=>void changeAutoScope(e.target.value as 'primary'|'all-eligible')}><option value="primary">Primary inbox only (recommended)</option><option value="all-eligible">All eligible inbox (Primary, Updates, Forums)</option></select>
          </label>
          <p className="muted-text">Automatic AI drafts created: {monitorStatus?.aiCompleted||0} · Awaiting eligible processing: {monitorStatus?.aiPending||0} · Excluded: {monitorStatus?.aiSkipped||0} · Failed (manual review needed): {monitorStatus?.aiFailed||0}. Generated drafts go to Approval Center for your review. Messages beyond your daily limit remain queued, not automatically sent.</p>
          {monitorEvents.some(e=>e.aiState==='done')&&<div className="settings-fields"><strong>Recent automatic summaries</strong>{monitorEvents.filter(e=>e.aiState==='done').slice(0,3).map(e=><div key={e.messageId} className="switch-row"><span><small>Message {e.messageId.slice(0,12)} · {e.summary?.language||'Summary'}</small><span>{e.summary?.summary?.slice(0,220)||'Summary unavailable'}</span></span><button className="button secondary" onClick={()=>{if(e.draftId){setEditingDraftId(e.draftId);go('approvals')}}}>Review draft</button></div>)}</div>}
          <p className="muted-text">{monitorStatus?.message||'Real monitoring status is available after connecting your Gmail account.'}</p>
          <p className="muted-text">Last successful sync: {monitorStatus?.lastSuccessAt?new Date(monitorStatus.lastSuccessAt).toLocaleString():'Never'} · New messages recorded: {monitorStatus?.receivedCount??0} · Pending push alerts: {monitorStatus?.pendingNotifications??0}</p>
          {monitorStatus?.lastError&&<p className="sync-error" role="alert">{monitorStatus.lastError}</p>}
          <div className="connection-actions"><button className="button secondary" disabled={monitorBusy||!monitorStatus?.enabled} onClick={()=>void checkMonitor()}>Check Gmail changes now</button><button className="button secondary" disabled={monitorBusy} onClick={()=>void refreshMonitor()}>Refresh monitoring status</button></div>
          <div className="switch-row"><span><strong>Phone / browser push notifications</strong><small>{pushConfigured?'Firebase backend available. Permission is optional.':'Firebase backend not configured. No push notifications will be claimed.'}</small></span>
          <button className="button secondary" disabled={monitorBusy||!pushConfigured} onClick={()=>void enableNotifications()}>Enable notifications</button></div>
          {pushDevices.length>0&&<div className="settings-fields"><small>Registered devices · {pushDevices.length}</small>{pushDevices.map(device=><div className="switch-row" key={device.id}><span><strong>{device.platform==='web'?'Browser / Android PWA':'Android device'}</strong><small>Generic notifications only</small></span><button className="button secondary" disabled={monitorBusy} onClick={()=>void removeDevice(device.id)}>Remove</button></div>)}</div>}
        </section>}
        <section className="surface settings-section"><div className="settings-section-head"><div className="settings-icon sky"><Sun size={20}/></div><div><h2>Appearance</h2><p>Choose the atmosphere that works for you.</p></div></div><div className="theme-choices"><button className={'theme-choice '+(prefs.theme==='light'?'chosen':'')} onClick={()=>updatePrefs({theme:'light'})}><span className="theme-sample light-sample"><span/><span/><span/></span><strong><Sun size={15}/> Light & airy</strong>{prefs.theme==='light'&&<CheckCircle2 size={16}/>}</button><button className={'theme-choice '+(prefs.theme==='dark'?'chosen':'')} onClick={()=>updatePrefs({theme:'dark'})}><span className="theme-sample dark-sample"><span/><span/><span/></span><strong><Moon size={15}/> Deep forest</strong>{prefs.theme==='dark'&&<CheckCircle2 size={16}/>}</button></div></section>
        <section className="surface settings-section"><div className="settings-section-head"><div className="settings-icon lavender"><Headphones size={20}/></div><div><h2>Voice & notifications</h2><p>Adjust the signals you want to receive.</p></div></div><div className="switch-row"><span><strong>Voice responses</strong><small>Allow browser speech playback for results.</small></span><button role="switch" aria-checked={prefs.voiceReplies} className={'switch '+(prefs.voiceReplies?'on':'')} onClick={()=>updatePrefs({voiceReplies:!prefs.voiceReplies})}><span/></button></div><div className="switch-row"><span><strong>In-app notifications</strong><small>Show gentle confirmations for your actions.</small></span><button role="switch" aria-checked={prefs.notifications} className={'switch '+(prefs.notifications?'on':'')} onClick={()=>updatePrefs({notifications:!prefs.notifications})}><span/></button></div><div className="switch-row"><span><strong>Privacy-minded previews</strong><small>Keep sensitive integrations disconnected in demo mode.</small></span><button role="switch" aria-checked={prefs.privacyMode} className={'switch '+(prefs.privacyMode?'on':'')} onClick={()=>updatePrefs({privacyMode:!prefs.privacyMode})}><span/></button></div></section></div>
        <aside className="settings-aside"><div className="connection-card"><div className="panel-eyebrow"><ShieldCheck size={15}/> ACCOUNT CONNECTION</div><span className="connection-illustration"><Mail size={28}/><span>{connection?.connected?<Check size={12}/>:<X size={12}/>}</span></span><h3>{connection?.connected?'Gmail connected':connection?.monitoring==='Reauthorization Required'?'Reauthorization required':'Gmail not connected'}</h3><p>{connection?.connected?`${connection.email} · ${live?'Real Gmail mode':'Demo preview mode'} · ${monitorStatus?.status||'Manual refresh'}`:'Connect your authorized Gmail account through Google OAuth. Until then, everything remains fictional demo data.'}</p>
          {connection?.connected?<div className="connection-actions"><button className="button primary full" onClick={()=>changeLiveMode('live')} disabled={live}>Use real Gmail</button><button className="button secondary full" onClick={()=>changeLiveMode('demo')} disabled={!live}>Switch to demo</button><button className="button secondary full" onClick={()=>void loadReal('All')} disabled={syncing}>Refresh Gmail now</button><button className="button ghost full" onClick={()=>void disconnect()}>Disconnect & delete backend data</button></div>:<button className="button primary full" disabled={!connection?.configured} onClick={()=>gmailApi.connect()}><LockKeyhole size={16}/>{connection?.configured?'Connect Gmail securely':'Set up backend OAuth first'}</button>}
          <small>Monitoring: {connection?.connected?(monitorStatus?.status||'Not yet checked'):'Disconnected'} · Cloud checks require a deployed scheduler and durable hosting.</small></div><div className="reset-card"><h3>Demo workspace</h3><p>Fictional data is saved locally in your browser.</p><button className="reset-button" onClick={resetDemo}><RotateCcw size={16}/> Reset demo data</button></div></aside>
      </div>
    </div>;
  }
  function ActivityPage(){
    const icons:Record<Activity['kind'],typeof Inbox>={summary:BookOpen,draft:PenLine,approval:CheckCheck,mail:Mail,voice:Mic,system:ShieldCheck};
    return <div className="page-enter"><PageHead eyebrow="A CLEAR RECORD" title="Every step, accounted for." description={live?'Actions performed in this browser session (not a full Gmail audit log).':'A transparent history of actions in your demo workspace.'} action={<button className="button secondary" onClick={()=>{if(window.confirm('Clear demo activity history?')){setActivity([]);notify('Demo activity cleared.');}}}><Trash2 size={16}/> Clear history</button>}/>
      <div className="activity-layout"><section className="surface activity-full"><div className="section-heading"><div><h2>Activity timeline</h2><p>Newest actions appear first.</p></div><span className="pill muted-pill">{activity.length} events</span></div>{activity.length===0?<Empty icon={ActivityIcon} title="No events yet" description="Actions you take in the demo will show up here."/>:activity.map(a=>{const Icon=icons[a.kind];return <div className="activity-event" key={a.id}><div className="event-icon"><Icon size={19}/></div><div><strong>{a.title}</strong><p>{a.detail}</p><small>{formatDate(a.time,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</small></div><span className="event-demo">{live?'SESSION':'DEMO'}</span></div>})}</section><aside><div className="activity-note"><ShieldCheck size={24}/><h3>A trustworthy timeline.</h3><p>{live?'Activity shown here is local session history; backend drafts and Gmail sends are recorded separately.':'All activity here is local and simulated. No external emails are accessed or sent.'}</p></div></aside></div>
    </div>;
  }
  function Landing(){return <div className="landing"><div className="landing-glow"/><header className="landing-header"><Logo/><nav aria-label="Landing navigation"><button onClick={()=>go('overview')}>The experience</button><button onClick={()=>go('settings')}>Privacy & control</button><button className="landing-cta" onClick={()=>go('overview')}>Enter workspace <ArrowUpRight size={16}/></button></nav></header><main className="landing-main"><div className="landing-copy"><div className="intro-tag"><span className="online-dot"/> INTRODUCING LIFEPILOT AI <span className="intro-tag-end">/ 001</span></div><h1>Less inbox.<br/><span>More life.</span></h1><p>Meet your more thoughtful email companion. Understand the important conversations, compose with confidence, and stay in complete control—by voice or by text.</p><div className="landing-actions"><button className="button landing-primary" onClick={()=>go('overview')}>Explore the experience <ArrowUpRight size={19}/></button><button className="landing-secondary" onClick={()=>go('voice')}><span><Mic size={18}/></span> See voice assistant</button></div><div className="landing-trust"><span className="trust-icon"><ShieldCheck size={20}/></span><span>Designed around your approval.<br/><strong>Every message stays in your hands.</strong></span></div></div><div className="landing-art"><div className="art-halo halo-one"/><div className="art-halo halo-two"/><div className="landing-orb"><Orb active/></div><div className="floating-note note-one"><span className="floating-note-icon"><Sparkles size={17}/></span><span><small>YOUR DAY, SIMPLIFIED</small><strong>3 conversations need you</strong></span></div><div className="floating-mail"><div className="floating-mail-title"><span className="mini-avatar">AH</span><span><strong>Research internship</strong><small>Dr. Amelia Hart · 9:42 AM</small></span><span className="tiny-ring"/></div><p>Thank you for your interest. Could you share your portfolio and availability?</p><div className="floating-mail-footer"><span><Sparkles size={13}/> Summary ready</span><span>Review <ArrowRight size={13}/></span></div></div><div className="floating-note note-two"><span className="approved-check"><Check size={17}/></span><span><strong>You're in control</strong><small>Every draft needs approval</small></span></div><div className="art-caption">INTELLIGENCE, WITH INTENTION <span>✳</span></div></div></main><footer className="landing-footer"><span>THOUGHTFUL BY DESIGN. HUMAN BY DEFAULT.</span><span>{live?'GMAIL CONNECTED':'DEMO MODE'} <span className="footer-divider">•</span> MODULE 4</span></footer></div>}

  return <>
    {page==='welcome'?Landing():<div className="app-shell"><aside className={'sidebar '+(mobileOpen?'sidebar-open':'')}><div className="sidebar-top"><Logo/><IconButton label="Close menu" className="mobile-close" onClick={()=>setMobileOpen(false)}><X size={19}/></IconButton></div><div className="workspace-select"><span className="workspace-avatar">{live?connection?.email?.[0]?.toUpperCase():'A'}</span><span><strong>{live?'Gmail Workspace':'Demo Workspace'}</strong><small>{live?connection?.email:'Personal account · Demo'}</small></span><ChevronDown size={14}/></div><div className="sidebar-section-label">WORKSPACE</div><nav className="side-navigation" aria-label="Main navigation">{allPages.slice(0,6).map(item=>{const Icon=item.icon;return <button key={item.page} className={'side-link '+(page===item.page||(page==='read'&&item.page==='inbox')?'active':'')} onClick={()=>item.page==='inbox'?enterInbox('All'):item.page==='compose'?createDraft():go(item.page)}><Icon size={18} strokeWidth={1.9}/><span>{isRoman?translations[item.name]:item.name}</span>{item.page==='inbox'&&unread>0&&<span className="side-count">{unread}</span>}{item.page==='approvals'&&pending>0&&<span className="side-count purple">{pending}</span>}</button>})}</nav><div className="sidebar-section-label second">PREFERENCES</div><nav className="side-navigation" aria-label="Account navigation">{allPages.slice(6).map(item=>{const Icon=item.icon;return <button key={item.page} className={'side-link '+(page===item.page?'active':'')} onClick={()=>go(item.page)}><Icon size={18} strokeWidth={1.9}/><span>{isRoman?translations[item.name]:item.name}</span></button>})}</nav><div className="sidebar-bottom"><div className="sidebar-assistant"><Orb small/><div><strong>LifePilot is ready</strong><span>Ask anything, your way.</span></div><button onClick={()=>go('voice')} aria-label="Open voice assistant"><ArrowUpRight size={17}/></button></div><div className="connection-indicator"><span className="offline-dot"/><span>{live?`Gmail · ${monitorStatus?.status||'Manual refresh'}`:connection?.connected?'Demo mode · Gmail linked':'Gmail disconnected'}</span><button onClick={()=>go('settings')}>Details</button></div></div></aside>{mobileOpen&&<button className="sidebar-backdrop" onClick={()=>setMobileOpen(false)} aria-label="Close navigation"/>}
      <div className="main-shell"><header className="app-topbar"><div className="top-left"><IconButton className="menu-button" label="Open menu" onClick={()=>setMobileOpen(true)}><Menu size={20}/></IconButton><div className="breadcrumb">Workspace <ChevronRight size={14}/><strong>{page==='read'?'Email detail':page==='compose'?'AI composer':allPages.find(x=>x.page===page)?.name||'Overview'}</strong></div></div><div className="top-actions"><div className="top-search"><Search size={17}/><input ref={searchRef} value={search} placeholder="Search emails, people..." aria-label="Search emails" onChange={e=>{setSearch(e.target.value);if(page!=='inbox')setPage('inbox');}}/><kbd>⌘ K</kbd></div><IconButton label="Toggle light or dark theme" onClick={()=>setPrefs(old=>({...old,theme:old.theme==='light'?'dark':'light'}))}>{prefs.theme==='light'?<Moon size={19}/>:<Sun size={19}/>}</IconButton><IconButton label="Notifications" onClick={()=>notify(prefs.notifications?(live?(monitorStatus?`Monitoring: ${monitorStatus.status}. ${monitorStatus.pendingNotifications} notification(s) pending.`:'Open Settings to check monitoring status.'):'You’re all caught up — demo notifications only.'):'Notifications are disabled in settings.')}><Bell size={19}/></IconButton><span className="profile-avatar" title={live?connection?.email:'Demo profile'}>{live?connection?.email?.[0]?.toUpperCase():'A'}</span></div></header><main className="app-content">{live&&syncError&&<div className="sync-error" role="alert">{syncError} <button onClick={()=>void loadReal(activeInboxView,search)}>Retry</button></div>}{page==='overview'&&Dashboard()}{page==='inbox'&&InboxPage()}{page==='read'&&ReadPage()}{page==='compose'&&ComposerPage()}{page==='voice'&&VoicePage()}{page==='summary'&&SummaryPage()}{page==='approvals'&&ApprovalsPage()}{page==='settings'&&SettingsPage()}{page==='activity'&&ActivityPage()}</main><footer className="app-footer"><span><ShieldCheck size={14}/> LifePilot AI · Module 4</span><span>{live?(aiReady?'Gmail connected · Groq consented · Approval required':`Gmail connected · AI off · ${monitorStatus?.status||'Manual refresh'}`):'Fictional data · Demo mode'} <span className="footer-divider">·</span> Module 4</span></footer></div>
      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">{[{p:'overview' as Page,n:'Home',i:LayoutDashboard},{p:'inbox' as Page,n:'Inbox',i:Inbox},{p:'voice' as Page,n:'Voice',i:Mic},{p:'approvals' as Page,n:'Approve',i:CheckCheck},{p:'settings' as Page,n:'Settings',i:Settings2}].map(x=>{const Icon=x.i;return <button key={x.p} aria-label={x.n} className={page===x.p?'active':''} onClick={()=>x.p==='inbox'?enterInbox():go(x.p)}><Icon size={21}/><span>{x.n}</span></button>})}</nav></div>}
    {confirmDraft&&<div className="modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setConfirmDraft(null)}}><section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="approval-title"><div className="confirm-icon"><ShieldCheck size={25}/></div><button className="confirm-x" onClick={()=>setConfirmDraft(null)} aria-label="Close"><X size={19}/></button><Kicker>FINAL APPROVAL REQUIRED</Kicker><h2 id="approval-title">Ready to approve this draft?</h2><p>{live?'This will send a REAL Gmail message. Verify every field and attachment.':'You’re approving a simulation only. No real email will be sent.'}</p><div className="confirm-summary"><div><span>Recipient</span><strong>{confirmDraft.to}</strong></div>{confirmDraft.cc&&<div><span>Cc</span><strong>{confirmDraft.cc}</strong></div>}{confirmDraft.bcc&&<div><span>Bcc</span><strong>{confirmDraft.bcc}</strong></div>}<div><span>Subject</span><strong>{confirmDraft.subject}</strong></div><div><span>Complete message</span><p className="full-email-review">{confirmDraft.body}</p></div><div><span>Attachments</span><strong>{confirmDraft.attachments.length?confirmDraft.attachments.join(', '):'None'}</strong></div></div>{live&&<label className="approval-check"><input type="checkbox" checked={sendConfirmed} onChange={e=>setSendConfirmed(e.target.checked)}/> I verified recipients, complete message and attachments. Send via Gmail.</label>}<div className="confirm-actions"><button className="button secondary" onClick={()=>setConfirmDraft(null)}>Cancel</button><button className="button primary" disabled={busy||(live&&!sendConfirmed)} onClick={()=>void confirmSend()}><CheckCircle2 size={17}/> {live?'Approve & send via Gmail':'Approve simulated send'}</button></div><small><LockKeyhole size={13}/> {live?'Server enforces one-time approval and Gmail confirmation.':'Simulation only · no message delivery'}</small></section></div>}
    {toast&&prefs.notifications&&<div className="toast" role="status"><CheckCircle2 size={18}/><span>{toast}</span><button onClick={()=>setToast('')} aria-label="Dismiss notification"><X size={15}/></button></div>}
  </>;
}
interface RecognitionResult {isFinal:boolean;[index:number]:{transcript:string}}
interface SpeechRecognitionLike { lang:string;interimResults:boolean;continuous:boolean;onresult:(event:{results: ArrayLike<RecognitionResult>})=>void;onerror:()=>void;onend:()=>void;start:()=>void;stop:()=>void; }
