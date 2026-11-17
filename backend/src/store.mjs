import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fingerprint,fail,randomToken,sha,seal,unseal} from './security.mjs';
import {defaultPreferences} from './ai/schemas.mjs';
export function createStore(filename=':memory:',key){
  if(!Buffer.isBuffer(key)||key.length!==32)throw new Error('A 32-byte storage encryption key is required.');
  const enc=x=>x==null?null:seal(String(x),key);
  const dec=x=>x==null?null:unseal(x,key).toString('utf8');
  const decodeRow=r=>r?{...r,to_addr:dec(r.to_addr),cc:dec(r.cc),bcc:dec(r.bcc),subject:dec(r.subject),body:dec(r.body),thread_id:dec(r.thread_id),in_reply_to:dec(r.in_reply_to),references_header:dec(r.references_header),original_sender:dec(r.original_sender)}:undefined;
  if(filename!==':memory:')fs.mkdirSync(path.dirname(path.resolve(filename)),{recursive:true,mode:0o700});
  const db=new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=4000;
    CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, token_cipher TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS oauth_states (hash TEXT PRIMARY KEY, verifier_cipher TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS drafts (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      to_addr TEXT NOT NULL DEFAULT '', cc TEXT NOT NULL DEFAULT '', bcc TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '',
      source_email_id TEXT, thread_id TEXT, in_reply_to TEXT, references_header TEXT, original_sender TEXT,
      status TEXT NOT NULL DEFAULT 'draft', version INTEGER NOT NULL DEFAULT 1,
      approval_id TEXT, approval_hash TEXT, approved_version INTEGER,
      gmail_message_id TEXT, gmail_thread_id TEXT, failure TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_drafts_account ON drafts(account_id,updated_at DESC);
    CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY, draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
      filename TEXT NOT NULL, mime_type TEXT NOT NULL, byte_size INTEGER NOT NULL, digest TEXT NOT NULL, ciphertext TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS send_attempts (draft_id TEXT PRIMARY KEY REFERENCES drafts(id) ON DELETE CASCADE,
      attempt_id TEXT UNIQUE NOT NULL, state TEXT NOT NULL, gmail_message_id TEXT, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS ai_accounts (account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE, consent INTEGER NOT NULL DEFAULT 0, preferences_cipher TEXT, prompt_tokens INTEGER NOT NULL DEFAULT 0, completion_tokens INTEGER NOT NULL DEFAULT 0, requests INTEGER NOT NULL DEFAULT 0);
  `);
  // A process may die after reserving a Gmail send. Never silently retry it on restart.
  db.exec(`UPDATE drafts SET status='unknown', failure='Server restarted during send; check Gmail Sent before any action' WHERE status='sending';
           UPDATE send_attempts SET state='unknown' WHERE state='sending';`);
  const now=()=>Date.now();
  const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const v=fn();db.exec('COMMIT');return v}catch(e){db.exec('ROLLBACK');throw e}};
  const attachments=id=>db.prepare('SELECT id,filename,mime_type,byte_size,digest FROM attachments WHERE draft_id=? ORDER BY rowid').all(id);
  const getRaw=(accountId,id)=>decodeRow(db.prepare('SELECT * FROM drafts WHERE id=? AND account_id=?').get(id,accountId));
  const present=r=>r?({id:r.id,to:r.to_addr,cc:r.cc,bcc:r.bcc,subject:r.subject,body:r.body,
    status:r.status==='approved'?'pending':r.status,tone:'Professional',length:'Medium',createdAt:new Date(r.created_at).toISOString(),
    sourceEmailId:r.source_email_id||undefined,attachments:attachments(r.id).map(x=>x.filename),attachmentDetails:attachments(r.id).map(x=>({id:x.id,name:x.filename,size:x.byte_size})),
    version:r.version,contentHash:fingerprint({...r,to:r.to_addr,cc:r.cc,bcc:r.bcc,source_email_id:r.source_email_id},attachments(r.id)),
    approvalId:r.approval_id||undefined,sendOutcome:r.status==='unknown'?'unknown':r.status==='sent'?'sent':undefined,
    gmailMessageId:r.gmail_message_id||undefined}) : null;
  const requireDraft=(a,id)=>{const r=getRaw(a,id);if(!r)throw fail(404,'Draft not found');return r};
  return {db, transaction, close:()=>db.close(),
    createOAuth(hash,verifierCipher){db.prepare('DELETE FROM oauth_states WHERE created_at<?').run(now()-10*60*1000);db.prepare('INSERT INTO oauth_states VALUES(?,?,?)').run(hash,verifierCipher,now())},
    consumeOAuth(hash){return transaction(()=>{const r=db.prepare('SELECT * FROM oauth_states WHERE hash=?').get(hash);if(!r||r.created_at<now()-10*60*1000)throw fail(400,'OAuth state expired');db.prepare('DELETE FROM oauth_states WHERE hash=?').run(hash);return r.verifier_cipher})},
    accountByEmail:email=>db.prepare('SELECT * FROM accounts WHERE email=?').get(email),
    accountById:id=>db.prepare('SELECT * FROM accounts WHERE id=?').get(id),
    upsertAccount(email,tokenCipher){const old=db.prepare('SELECT id FROM accounts WHERE email=?').get(email);const id=old?.id||crypto.randomUUID();db.prepare(`INSERT INTO accounts(id,email,token_cipher,created_at) VALUES(?,?,?,?)
      ON CONFLICT(email) DO UPDATE SET token_cipher=excluded.token_cipher`).run(id,email,tokenCipher,now());return id},
    updateTokens:(id,cipher)=>db.prepare('UPDATE accounts SET token_cipher=? WHERE id=?').run(cipher,id),
    issueSession(accountId){const raw=randomToken(),csrf=randomToken(),exp=now()+7*24*3600*1000;db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sha(raw),accountId,csrf,exp);return {raw,csrf}},
    session(raw){if(!raw)return null;const r=db.prepare(`SELECT sessions.*,accounts.email FROM sessions JOIN accounts ON accounts.id=sessions.account_id
      WHERE sessions.hash=? AND sessions.expires_at>?`).get(sha(raw),now());return r||null},
    deleteSession:(raw)=>raw&&db.prepare('DELETE FROM sessions WHERE hash=?').run(sha(raw)),
    deleteAccount:id=>transaction(()=>db.prepare('DELETE FROM accounts WHERE id=?').run(id)),
    getAiConsent(a){return Boolean(db.prepare('SELECT consent FROM ai_accounts WHERE account_id=?').get(a)?.consent)},
    setAiConsent(a,value){if(typeof value!=='boolean')throw fail(400,'Invalid AI consent');db.prepare('INSERT INTO ai_accounts(account_id,consent) VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET consent=excluded.consent').run(a,value?1:0);return value},
    getAiPreferences(a){const row=db.prepare('SELECT preferences_cipher FROM ai_accounts WHERE account_id=?').get(a);return row?.preferences_cipher?{...defaultPreferences,...JSON.parse(dec(row.preferences_cipher))}:{...defaultPreferences}},
    updateAiPreferences(a,patch){const current=this.getAiPreferences(a);const next={...current,...patch};db.prepare('INSERT INTO ai_accounts(account_id,preferences_cipher) VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET preferences_cipher=excluded.preferences_cipher').run(a,enc(JSON.stringify(next)));return next},
    resetAiPreferences(a){db.prepare('INSERT INTO ai_accounts(account_id,preferences_cipher) VALUES(?,NULL) ON CONFLICT(account_id) DO UPDATE SET preferences_cipher=NULL').run(a);return {...defaultPreferences}},
    recordAiUsage(a,usage){const p=Math.max(0,Math.min(1000000,Math.floor(Number(usage.promptTokens)||0))),c=Math.max(0,Math.min(1000000,Math.floor(Number(usage.completionTokens)||0)));db.prepare('INSERT INTO ai_accounts(account_id,prompt_tokens,completion_tokens,requests) VALUES(?,?,?,1) ON CONFLICT(account_id) DO UPDATE SET prompt_tokens=prompt_tokens+excluded.prompt_tokens,completion_tokens=completion_tokens+excluded.completion_tokens,requests=requests+1').run(a,p,c)},
    getAiUsage(a){const row=db.prepare('SELECT requests,prompt_tokens,completion_tokens FROM ai_accounts WHERE account_id=?').get(a);return row||{requests:0,prompt_tokens:0,completion_tokens:0}},
    getDraft:(a,id)=>present(requireDraft(a,id)), rawDraft:requireDraft,
    listDrafts:a=>db.prepare('SELECT * FROM drafts WHERE account_id=? ORDER BY updated_at DESC').all(a).map(r=>present(decodeRow(r))),
    createDraft(a,form,reply={}){const id=crypto.randomUUID(),t=now();db.prepare(`INSERT INTO drafts(id,account_id,to_addr,cc,bcc,subject,body,source_email_id,thread_id,in_reply_to,references_header,original_sender,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,a,enc(form.to),enc(form.cc),enc(form.bcc),enc(form.subject),enc(form.body),reply.sourceEmailId||null,enc(reply.threadId||null),enc(reply.inReplyTo||null),enc(reply.references||null),enc(reply.originalSender||null),t,t);return present(getRaw(a,id))},
    updateDraft(a,id,form,expectedVersion){return transaction(()=>{const r=requireDraft(a,id);if(['sending','sent','unknown'].includes(r.status))throw fail(409,'Draft cannot be edited after sending has started');if(r.version!==expectedVersion)throw fail(409,'Draft was changed elsewhere; refresh it first');db.prepare(`UPDATE drafts SET to_addr=?,cc=?,bcc=?,subject=?,body=?,status='draft',version=version+1,approval_id=NULL,approval_hash=NULL,approved_version=NULL,updated_at=? WHERE id=?`).run(enc(form.to),enc(form.cc),enc(form.bcc),enc(form.subject),enc(form.body),now(),id);return present(getRaw(a,id))})},
    addAttachment(a,id,item){return transaction(()=>{const r=requireDraft(a,id);if(['sent','sending','unknown'].includes(r.status))throw fail(409,'Draft locked');const count=db.prepare('SELECT COALESCE(SUM(byte_size),0) AS total FROM attachments WHERE draft_id=?').get(id).total;if(count+item.byteSize>12*1024*1024)throw fail(413,'Attachment total exceeds 12MB');const aid=crypto.randomUUID();db.prepare('INSERT INTO attachments VALUES(?,?,?,?,?,?,?)').run(aid,id,item.filename,item.mimeType,item.byteSize,item.digest,item.ciphertext);db.prepare(`UPDATE drafts SET version=version+1,status='draft',approval_id=NULL,approval_hash=NULL,approved_version=NULL,updated_at=? WHERE id=?`).run(now(),id);return present(getRaw(a,id))})},
    removeAttachment(a,id,aid){return transaction(()=>{const r=requireDraft(a,id);if(['sent','sending','unknown'].includes(r.status))throw fail(409,'Draft locked');const d=db.prepare('DELETE FROM attachments WHERE id=? AND draft_id=?').run(aid,id);if(!d.changes)throw fail(404,'Attachment not found');db.prepare(`UPDATE drafts SET version=version+1,status='draft',approval_id=NULL,approval_hash=NULL,approved_version=NULL,updated_at=? WHERE id=?`).run(now(),id);return present(getRaw(a,id))})},
    attachmentContents:(a,id)=>{requireDraft(a,id);return db.prepare('SELECT * FROM attachments WHERE draft_id=? ORDER BY rowid').all(id)},
    requestReview(a,id,expectedVersion){return transaction(()=>{const r=requireDraft(a,id);if(r.version!==expectedVersion)throw fail(409,'Draft version mismatch');if(r.status!=='draft'&&r.status!=='rejected')throw fail(409,'Draft not editable');if(!r.to_addr||!r.subject||!r.body.trim())throw fail(400,'Recipient, subject and body are required');db.prepare(`UPDATE drafts SET status='pending',approval_id=NULL,approval_hash=NULL,approved_version=NULL,updated_at=? WHERE id=?`).run(now(),id);return present(getRaw(a,id))})},
    approve(a,id,expectedVersion,expectedHash){return transaction(()=>{const r=requireDraft(a,id);if(r.status!=='pending'||r.version!==expectedVersion)throw fail(409,'Draft no longer matches reviewed version');const h=fingerprint({...r,to:r.to_addr,cc:r.cc,bcc:r.bcc},attachments(id));if(h!==expectedHash)throw fail(409,'Draft content changed; review again');const approvalId=randomToken();db.prepare(`UPDATE drafts SET status='approved',approval_id=?,approval_hash=?,approved_version=?,updated_at=? WHERE id=?`).run(approvalId,h,r.version,now(),id);return {draft:present(getRaw(a,id)),approvalId}})},
    reserveSend(a,id,version,approvalId){return transaction(()=>{const r=requireDraft(a,id);if(r.status!=='approved'||r.version!==version||r.approval_id!==approvalId||r.approved_version!==version)throw fail(409,'Explicit approval required for current draft');const h=fingerprint({...r,to:r.to_addr,cc:r.cc,bcc:r.bcc},attachments(id));if(h!==r.approval_hash)throw fail(409,'Draft changed after approval');if(db.prepare('SELECT draft_id FROM send_attempts WHERE draft_id=?').get(id))throw fail(409,'Send already attempted; never automatically retry');const attemptId=randomToken();db.prepare(`INSERT INTO send_attempts VALUES(?,?,?,?,?)`).run(id,attemptId,'sending',null,now());db.prepare(`UPDATE drafts SET status='sending',updated_at=? WHERE id=?`).run(now(),id);return {draft:getRaw(a,id),attachmentRows:db.prepare('SELECT * FROM attachments WHERE draft_id=?').all(id),attemptId}})},
    completeSend(a,id,attemptId,res){return transaction(()=>{requireDraft(a,id);const attempt=db.prepare('SELECT * FROM send_attempts WHERE draft_id=? AND attempt_id=?').get(id,attemptId);if(!attempt||attempt.state!=='sending')throw fail(409,'Send attempt already resolved');db.prepare(`UPDATE send_attempts SET state='sent',gmail_message_id=? WHERE draft_id=?`).run(res.id,id);db.prepare(`UPDATE drafts SET status='sent',gmail_message_id=?,gmail_thread_id=?,failure=NULL,updated_at=? WHERE id=?`).run(res.id,res.threadId||null,now(),id);return present(getRaw(a,id))})},
    uncertainSend(a,id,attemptId,reason){return transaction(()=>{requireDraft(a,id);const attempt=db.prepare('SELECT * FROM send_attempts WHERE draft_id=? AND attempt_id=?').get(id,attemptId);if(!attempt||attempt.state!=='sending')return;db.prepare(`UPDATE send_attempts SET state='unknown' WHERE draft_id=?`).run(id);db.prepare(`UPDATE drafts SET status='unknown',failure=?,updated_at=? WHERE id=?`).run(String(reason).slice(0,250),now(),id)})},
    reject(a,id){return transaction(()=>{const r=requireDraft(a,id);if(['sent','sending','unknown'].includes(r.status))throw fail(409,'Cannot reject a sent/attempted email');db.prepare(`UPDATE drafts SET status='rejected',approval_id=NULL,approval_hash=NULL,approved_version=NULL WHERE id=?`).run(id);return present(getRaw(a,id))})}
  };
}
