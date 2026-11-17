// Module 4: deterministic, user-opted-in Gmail history synchronization.
// Never sends an email, never forwards mail bodies to AI, never deletes Gmail content.
import {fail} from '../security.mjs';

const MAX_HISTORY_PAGES=30;
const MAX_NEW_MESSAGES=150;
const asISOString=value=>value?new Date(value).toISOString():null;
export function createMonitor({store,gmail,notify=async()=>{},clock=()=>Date.now(),workerConfigured=false}){
  const db=store.db;
  db.exec(`CREATE TABLE IF NOT EXISTS monitor_state (
    account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    enabled INTEGER NOT NULL DEFAULT 0, history_id TEXT, last_checked INTEGER,
    last_success INTEGER, last_error TEXT, last_message_at INTEGER,
    lock_until INTEGER NOT NULL DEFAULT 0, heartbeat_at INTEGER, scheduler_heartbeat INTEGER,
    new_count INTEGER NOT NULL DEFAULT 0, lost_history INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS monitor_events (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL, created_at INTEGER NOT NULL,
    notified_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(account_id,message_id)
  );
  CREATE INDEX IF NOT EXISTS idx_monitor_pending ON monitor_events(account_id,notified_at);`);
  // Additive migrations preserve existing monitoring cursors and message events.
  function addColumn(table,column,definition){
    if(!db.prepare(`PRAGMA table_info(${table})`).all().some(x=>x.name===column))
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
  addColumn('monitor_state','auto_ai_enabled','INTEGER NOT NULL DEFAULT 0');
  addColumn('monitor_state','auto_ai_daily_limit','INTEGER NOT NULL DEFAULT 2');
  addColumn('monitor_state','auto_ai_scope',"TEXT NOT NULL DEFAULT 'primary'");
  addColumn('monitor_events','ai_state',"TEXT NOT NULL DEFAULT 'off'");
  addColumn('monitor_events','ai_attempts','INTEGER NOT NULL DEFAULT 0');
  addColumn('monitor_events','ai_error','TEXT');
  addColumn('monitor_events','summary_cipher','TEXT');
  addColumn('monitor_events','draft_id','TEXT');
  addColumn('monitor_events','processed_at','INTEGER');
  const ensure=a=>db.prepare('INSERT INTO monitor_state(account_id) VALUES(?) ON CONFLICT DO NOTHING').run(a);
  const state=a=>{ensure(a);return db.prepare('SELECT * FROM monitor_state WHERE account_id=?').get(a)};
  function status(a){
    const s=state(a),now=clock(),recent=s.scheduler_heartbeat&&now-s.scheduler_heartbeat<25*60_000;
    const health= !s.enabled?'Paused':s.last_error?.startsWith('Reauthorization')?'Reauthorization Required':
      s.last_error?.startsWith('Provider rate')?'Provider rate-limited':s.last_error?'Degraded':!workerConfigured?'Configured — worker not deployed':recent?'Monitoring':'Waiting for worker';
    return {mode:'scheduled',enabled:Boolean(s.enabled),autoAiEnabled:Boolean(s.auto_ai_enabled),autoAiDailyLimit:s.auto_ai_daily_limit,autoAiScope:s.auto_ai_scope||'primary',status:health,workerConfigured,
      aiPending:db.prepare("SELECT COUNT(*) AS n FROM monitor_events WHERE account_id=? AND ai_state='pending'").get(a).n,aiFailed:db.prepare("SELECT COUNT(*) AS n FROM monitor_events WHERE account_id=? AND ai_state='failed'").get(a).n,aiSkipped:db.prepare("SELECT COUNT(*) AS n FROM monitor_events WHERE account_id=? AND ai_state='skipped'").get(a).n,aiCompleted:db.prepare("SELECT COUNT(*) AS n FROM monitor_events WHERE account_id=? AND ai_state='done'").get(a).n,
      lastCheckedAt:asISOString(s.last_checked),lastSuccessAt:asISOString(s.last_success),
      lastMessageAt:asISOString(s.last_message_at),lastError:s.last_error||null,
      cursorInitialized:Boolean(s.history_id),receivedCount:s.new_count,pendingNotifications:db.prepare('SELECT COUNT(*) AS n FROM monitor_events WHERE account_id=? AND notified_at IS NULL').get(a).n,
      message:workerConfigured?'Monitoring runs only while the deployed worker and durable backend are available.':'Cloud worker not configured; the PC must remain on for local checks.'};
  }
  function enable(a,value){
    if(typeof value!=='boolean')throw fail(400,'enabled must be a boolean');
    ensure(a);db.prepare('UPDATE monitor_state SET enabled=?,last_error=NULL WHERE account_id=?').run(value?1:0,a);
    return status(a);
  }
  function configureAuto(a,{enabled,dailyLimit,scope}={}){
    ensure(a);
    if(typeof enabled!=='boolean')throw fail(400,'autoAi enabled must be boolean');
    if(!Number.isSafeInteger(dailyLimit)||dailyLimit<1||dailyLimit>25)throw fail(400,'Daily AI draft limit must be 1–25');
    const selected=scope??state(a).auto_ai_scope??'primary';
    if(!['primary','all-eligible'].includes(selected))throw fail(400,'Invalid AI monitoring scope');
    db.prepare('UPDATE monitor_state SET auto_ai_enabled=?,auto_ai_daily_limit=?,auto_ai_scope=? WHERE account_id=?').run(Number(enabled),dailyLimit,selected,a);
    if(!enabled)db.prepare("UPDATE monitor_events SET ai_state='skipped',ai_error='Automatic AI review disabled before drafting' WHERE account_id=? AND ai_state='pending'").run(a);
    return status(a);
  }
  const listAccounts=()=>db.prepare('SELECT a.id FROM accounts a JOIN monitor_state m ON m.account_id=a.id WHERE m.enabled=1').all().map(x=>x.id);
  function reserve(a){
    const now=clock();ensure(a);
    const updated=db.prepare('UPDATE monitor_state SET lock_until=?,heartbeat_at=? WHERE account_id=? AND enabled=1 AND lock_until<?')
      .run(now+120_000,now,a,now);
    return updated.changes===1;
  }
  function release(a){db.prepare('UPDATE monitor_state SET lock_until=0 WHERE account_id=?').run(a)}
  function recordError(a,e){
    const message=e?.status===401?'Reauthorization required':e?.externalStatus===429?'Provider rate-limited':
      e?.externalStatus===404?'Gmail history expired':String(e?.message||'Monitoring failed').slice(0,200);
    db.prepare('UPDATE monitor_state SET last_checked=?,last_error=? WHERE account_id=?').run(clock(),message,a);
  }
  async function flushNotifications(a){
    // When Groq review is pending, wait to alert until the approval draft is ready.
    // Failed/skipped review sends a generic inbox notification instead.
    const rows=db.prepare("SELECT message_id,attempts FROM monitor_events WHERE account_id=? AND notified_at IS NULL AND attempts<5 AND ai_state!='pending' ORDER BY created_at LIMIT 25").all(a);
    let delivered=0;
    for(const row of rows){
      try{
        // Opaque Gmail ID only: never include sender/body/subject in push payload.
        const accepted=await notify(a,row.message_id);
        if(!accepted)continue;
        db.prepare('UPDATE monitor_events SET notified_at=?,attempts=attempts+1 WHERE account_id=? AND message_id=? AND notified_at IS NULL').run(clock(),a,row.message_id);
        delivered++;
      }catch{
        db.prepare('UPDATE monitor_events SET attempts=attempts+1 WHERE account_id=? AND message_id=?').run(a,row.message_id);
      }
    }
    return delivered;
  }
  let autoAssistant=null;
  function setAutoAssistant(assistant){autoAssistant=assistant}
  async function sync(a){
    if(!state(a).enabled)return {skipped:'paused'};
    if(!reserve(a))return {skipped:'locked'};
    try{
      const s=state(a);
      if(!s.history_id){
        // First sync establishes a baseline. Old inbox is NOT treated as new mail.
        const profile=await gmail.request(a,'/profile');
        if(!/^\d+$/.test(String(profile.historyId||'')))throw fail(502,'Invalid Gmail history cursor');
        db.prepare('UPDATE monitor_state SET history_id=?,last_checked=?,last_success=?,last_error=NULL,lost_history=0 WHERE account_id=?')
          .run(profile.historyId,clock(),clock(),a);
        return {initialized:true,found:0,notified:await flushNotifications(a)};
      }
      let next='',pages=0,latest=s.history_id;
      const messageIds=new Set();
      try{
        do{
          if(++pages>MAX_HISTORY_PAGES)throw fail(503,'History backlog too large; cursor unchanged; retry required');
          const qs=new URLSearchParams({startHistoryId:s.history_id,historyTypes:'messageAdded',maxResults:'100'});
          if(next)qs.set('pageToken',next);
          const page=await gmail.request(a,`/history?${qs}`);
          if(page.historyId)latest=String(page.historyId);
          for(const item of page.history||[]){
            for(const added of item.messagesAdded||[]){
              const id=String(added.message?.id||'');
              if(id)messageIds.add(id);
            }
          }
          if(messageIds.size>MAX_NEW_MESSAGES)throw fail(503,'More than 150 new items; cursor unchanged; retry with controlled recovery');
          next=String(page.nextPageToken||'');
        }while(next);
      }catch(e){
        if(e?.externalStatus===404){
          // On expired history, re-baseline without inventing or replaying messages.
          const profile=await gmail.request(a,'/profile');
          if(!/^\d+$/.test(String(profile.historyId||'')))throw fail(502,'Invalid reset cursor');
          // Gmail documents 404 as requiring a full sync. We reconcile up to the latest
          // 120 inbox messages from the last seven days, deduplicated against the event DB.
          // If recovery cannot complete, keep the old cursor instead of silently losing mail.
          const recovered=[];let incomplete=false,olderLimit=false;
          if(typeof gmail.list==='function'){
            let pageToken='',pageCount=0;
            do{
              const page=await gmail.list(a,{folder:'inbox',query:'newer_than:7d',limit:40,pageToken});
              for(const mail of page.mails||[]){
                const date=Date.parse(mail.date||'')||clock();
                if(mail.folder==='inbox'&&date>=clock()-7*86400_000)recovered.push({id:mail.id,at:date});
              }
              pageToken=page.nextPageToken||'';
              if(++pageCount>=3){if(pageToken)incomplete=true;break;}
            }while(pageToken);
            olderLimit=true;
          }else incomplete=true;
          store.transaction(()=>{
            for(const mail of recovered){
              db.prepare("INSERT OR IGNORE INTO monitor_events(account_id,message_id,created_at,ai_state) VALUES(?,?,?,CASE WHEN (SELECT auto_ai_enabled FROM monitor_state WHERE account_id=?)=1 THEN 'pending' ELSE 'off' END)").run(a,mail.id,clock(),a);
              db.prepare('UPDATE monitor_state SET last_message_at=MAX(COALESCE(last_message_at,0),?) WHERE account_id=?').run(mail.at,a);
            }
            db.prepare('UPDATE monitor_state SET history_id=?,last_checked=?,last_success=?,last_error=?,lost_history=lost_history+1,new_count=(SELECT COUNT(*) FROM monitor_events WHERE account_id=?) WHERE account_id=?')
              .run(String(profile.historyId),clock(),clock(),'History expired; bounded inbox recovery completed. Older or overflow messages may have been missed; review Gmail manually.',a,a);
          });
          const autoAi=autoAssistant?await autoAssistant.process(a):{skipped:'not configured'};
          const notified=await flushNotifications(a);
          return {rebased:true,found:recovered.length,notified,autoAi,warning:incomplete||olderLimit?'History expired; partial recovery, possible gap. Review full inbox manually.':'History expired; possible gap. Review Gmail manually.'};
        }
        throw e;
      }
      const accepted=[];
      for(const id of messageIds){
        // A history entry may be for an already archived or deleted message.
        let mail;
        try{mail=await gmail.message(a,id)}catch(e){if(e?.externalStatus===404)continue;throw e}
        if(mail.folder!=='inbox')continue;
        accepted.push({id,at:Date.parse(mail.date)||clock()});
      }
      store.transaction(()=>{
        for(const item of accepted){
          db.prepare("INSERT OR IGNORE INTO monitor_events(account_id,message_id,created_at,ai_state) VALUES(?,?,?,CASE WHEN (SELECT auto_ai_enabled FROM monitor_state WHERE account_id=?)=1 THEN 'pending' ELSE 'off' END)").run(a,item.id,clock(),a);
          db.prepare('UPDATE monitor_state SET last_message_at=MAX(COALESCE(last_message_at,0),?) WHERE account_id=?').run(item.at,a);
        }
        db.prepare('UPDATE monitor_state SET history_id=?,last_checked=?,last_success=?,last_error=NULL,new_count=(SELECT COUNT(*) FROM monitor_events WHERE account_id=?) WHERE account_id=?')
          .run(latest,clock(),clock(),a,a);
      });
      // AI is optional; Gmail cursor/notifications remain successful even if Groq is rate-limited.
      const autoAi=autoAssistant?await autoAssistant.process(a):{skipped:'not configured'};
      const notified=await flushNotifications(a);
      return {found:accepted.length,notified,autoAi,cursor:latest};
    }catch(e){recordError(a,e);throw e}
    finally{release(a)}
  }
  async function syncEnabled(){
    const out=[];
    // Only the authenticated scheduled endpoint counts as evidence of a live worker.
    for(const a of listAccounts())db.prepare('UPDATE monitor_state SET scheduler_heartbeat=? WHERE account_id=?').run(clock(),a);
    for(const accountId of listAccounts()){
      try{out.push({accountId,result:await sync(accountId)})}catch(e){out.push({accountId,error:e.status===401?'Reauthorization required':'Monitoring run failed'})}
    }
    return out;
  }
  return {enable,configureAuto,status,sync,syncEnabled,flushNotifications,listAccounts,setAutoAssistant};
}
