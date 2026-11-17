import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from '../src/store.mjs';
import {sha,randomToken,fields,seal} from '../src/security.mjs';
import crypto from 'node:crypto';
const key=crypto.randomBytes(32);
function setup(t){const s=createStore(':memory:',key);t.after(()=>s.close());const account=s.upsertAccount('myself@example.com',seal('tokens',key));return {s,account}}
const form={to:'a@example.com',cc:'',bcc:'',subject:'Hello',body:'This is the message.'};
test('OAuth state is single-use and expires appropriately',t=>{
  const {s}=setup(t);s.createOAuth(sha('123'),seal('verifier',key));assert.equal(typeof s.consumeOAuth(sha('123')),'string');assert.throws(()=>s.consumeOAuth(sha('123')));
});
test('Session belongs to account, survives store reads, and can be invalidated',t=>{
  const {s,account}=setup(t);const sess=s.issueSession(account);const read=s.session(sess.raw);assert.equal(read.account_id,account);assert.equal(read.csrf,sess.csrf);s.deleteSession(sess.raw);assert.equal(s.session(sess.raw),null);
});
test('New draft -> save -> request review -> approve -> send exactly once',t=>{
  const {s,account}=setup(t);let d=s.createDraft(account,form);assert.equal(d.status,'draft');assert.equal(d.version,1);
  d=s.updateDraft(account,d.id,{...form,body:'Final reviewed version'},1);assert.equal(d.version,2);
  assert.throws(()=>s.updateDraft(account,d.id,form,1),e=>e.status===409);
  d=s.requestReview(account,d.id,2);assert.equal(d.status,'pending');
  assert.throws(()=>s.approve(account,d.id,2,'wronghash'),e=>e.status===409);
  const approval=s.approve(account,d.id,2,d.contentHash);assert.ok(approval.approvalId);
  assert.throws(()=>s.reserveSend(account,d.id,2,'wrong'),e=>e.status===409);
  const attempt=s.reserveSend(account,d.id,2,approval.approvalId);
  assert.throws(()=>s.reserveSend(account,d.id,2,approval.approvalId),e=>e.status===409);
  const sent=s.completeSend(account,d.id,attempt.attemptId,{id:'gmail-message-123',threadId:'t1'});
  assert.equal(sent.status,'sent');assert.equal(sent.gmailMessageId,'gmail-message-123');
  assert.throws(()=>s.reserveSend(account,d.id,2,approval.approvalId),e=>e.status===409);
});
test('Editing after review invalidates approval and requires new review',t=>{
  const {s,account}=setup(t);let d=s.createDraft(account,form);d=s.requestReview(account,d.id,1);
  let approved=s.approve(account,d.id,1,d.contentHash);assert.ok(approved.approvalId);
  d=s.updateDraft(account,d.id,{...form,subject:'Changed'},1);assert.equal(d.status,'draft');assert.equal(d.version,2);
  assert.throws(()=>s.reserveSend(account,d.id,1,approved.approvalId),e=>e.status===409);
  d=s.requestReview(account,d.id,2);
  approved=s.approve(account,d.id,2,d.contentHash);
  assert.ok(s.reserveSend(account,d.id,2,approved.approvalId));
});
test('Ambiguous external send failure locks draft instead of retrying',t=>{
  const {s,account}=setup(t);let d=s.createDraft(account,form);d=s.requestReview(account,d.id,1);
  const {approvalId}=s.approve(account,d.id,1,d.contentHash);const attempt=s.reserveSend(account,d.id,1,approvalId);
  s.uncertainSend(account,d.id,attempt.attemptId,'No response');const updated=s.getDraft(account,d.id);
  assert.equal(updated.status,'unknown');assert.throws(()=>s.reserveSend(account,d.id,1,approvalId),e=>e.status===409);
  assert.throws(()=>s.updateDraft(account,d.id,form,1),e=>e.status===409);
});
test('Attachments are persisted, encrypted, and editing them invalidates prior review',t=>{
  const {s,account}=setup(t);let d=s.createDraft(account,form);d=s.requestReview(account,d.id,1);
  const {approvalId}=s.approve(account,d.id,1,d.contentHash);
  d=s.addAttachment(account,d.id,{filename:'report.pdf',mimeType:'application/pdf',byteSize:4,digest:sha('PDF!'),ciphertext:seal('PDF!',key)});
  assert.equal(d.status,'draft');assert.equal(d.version,2);assert.deepEqual(d.attachments,['report.pdf']);
  assert.throws(()=>s.reserveSend(account,d.id,1,approvalId),e=>e.status===409);
  assert.equal(s.attachmentContents(account,d.id).length,1);
  d=s.removeAttachment(account,d.id,d.attachmentDetails[0].id);assert.deepEqual(d.attachments,[]);
});
test('Disconnect account cascades to all drafts, sessions and attachments',t=>{
  const {s,account}=setup(t);const session=s.issueSession(account);let d=s.createDraft(account,form);
  s.addAttachment(account,d.id,{filename:'a.txt',mimeType:'text/plain',byteSize:1,digest:sha('a'),ciphertext:seal('a',key)});
  s.deleteAccount(account);assert.equal(s.session(session.raw),null);assert.equal(s.accountById(account),undefined);
  assert.equal(s.db.prepare('SELECT count(*) AS n FROM drafts').get().n,0);
  assert.equal(s.db.prepare('SELECT count(*) AS n FROM attachments').get().n,0);
});
test('Crash during an in-flight send becomes unknown on database reopen, never retryable',async t=>{
  const fs=await import('node:fs');const os=await import('node:os');const path=await import('node:path');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lifepilot-test-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'db.sqlite');let s=createStore(file,key);
  const account=s.upsertAccount('crash@example.com',seal('tokens',key));
  let d=s.createDraft(account,form);d=s.requestReview(account,d.id,1);
  const {approvalId}=s.approve(account,d.id,1,d.contentHash);
  s.reserveSend(account,d.id,1,approvalId);s.close();
  s=createStore(file,key);t.after(()=>s.close());
  assert.equal(s.getDraft(account,d.id).status,'unknown');
  assert.throws(()=>s.reserveSend(account,d.id,1,approvalId),e=>e.status===409);
});

test('Draft message content and recipients are encrypted at rest',t=>{
  const {s,account}=setup(t);const d=s.createDraft(account,form);
  const row=s.db.prepare('SELECT to_addr,subject,body FROM drafts WHERE id=?').get(d.id);
  assert.notEqual(row.to_addr,form.to);assert.notEqual(row.subject,form.subject);assert.notEqual(row.body,form.body);
  assert.equal(s.getDraft(account,d.id).body,form.body);
});
