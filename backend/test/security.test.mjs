import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {seal,unseal,fields,randomToken,safeEq,parseCookies,sha} from '../src/security.mjs';
import {authUrl,decodeMessage,buildMime,createGmail} from '../src/gmail.mjs';
const key=crypto.randomBytes(32);
test('AES-256-GCM token and attachment storage roundtrip; tamper rejection',()=>{
  const a=Buffer.from('secret refresh token');const sealed=seal(a,key);
  assert.equal(unseal(sealed,key).toString(),a.toString());
  const [iv,tag,data]=sealed.split('.');const bad=iv+'.'+tag+'.'+(data[0]==='A'?'B':'A')+data.slice(1);
  assert.throws(()=>unseal(bad,key));
});
test('OAuth uses state, offline access, PKCE S256, narrow Gmail modify scope',()=>{
  const u=new URL(authUrl({clientId:'client',redirectUri:'http://localhost/callback',state:'state1',verifier:'verifier1'}));
  assert.equal(u.searchParams.get('access_type'),'offline');
  assert.equal(u.searchParams.get('code_challenge_method'),'S256');
  assert.equal(u.searchParams.get('state'),'state1');
  assert.equal(u.searchParams.get('scope'),'https://www.googleapis.com/auth/gmail.modify');
  assert.ok(!u.search.includes('https%3A%2F%2Fmail.google.com'));
});
test('header injection and malformed recipients are rejected',()=>{
  assert.throws(()=>fields({to:'x@x.com\r\nBcc: bad@ex.com',cc:'',bcc:'',subject:'A',body:'Hi'}));
  assert.throws(()=>fields({to:'invalid',cc:'',bcc:'',subject:'A',body:'Hi'}));
  assert.throws(()=>fields({to:'x@x.com',cc:'',bcc:'subject\nBcc',subject:'A',body:'Hi'}));
});
test('cookie parsing, timing-safe equals and secret hashing',()=>{
  assert.deepEqual(parseCookies('a=hello; lp_session=xyz'),{a:'hello',lp_session:'xyz'});
  assert.ok(safeEq('a','a'));assert.ok(!safeEq('a','b'));
  assert.equal(sha('same'),sha('same'));assert.notEqual(randomToken(),randomToken());
});
test('Gmail decoded message contains correct metadata, UTF-8 body and attachment reference',()=>{
  const msg={id:'m1',threadId:'t1',internalDate:'1730000000000',labelIds:['INBOX','UNREAD','STARRED'],snippet:'hello',payload:{headers:[{name:'From',value:'"Sara Lee" <sara@example.com>'},{name:'To',value:'you@example.com'},{name:'Subject',value:'Test'},{name:'Message-ID',value:'<m@id.com>'}],mimeType:'multipart/mixed',parts:[{mimeType:'text/plain',body:{data:Buffer.from('Hello 🌱').toString('base64url')}},{mimeType:'application/pdf',filename:'receipt.pdf',body:{attachmentId:'att1',size:42}}]}};
  const d=decodeMessage(msg);assert.equal(d.email,'sara@example.com');assert.equal(d.from,'Sara Lee');assert.equal(d.body,'Hello 🌱');assert.equal(d.unread,true);assert.equal(d.attachmentDetails[0].id,'att1');assert.equal(d.rfcMessageId,'<m@id.com>');
});
test('MIME contains correct threading headers, UTF-8 body, and binary attachment',()=>{
  const a={filename:'cv.pdf',mime_type:'application/pdf',ciphertext:seal(Buffer.from('PDF-BYTES'),key)};
  const r={to_addr:'a@example.com',cc:'',bcc:'',subject:'Re: Résumé',body:'Thank you.',thread_id:'thread-1',in_reply_to:'<orig@example.com>',references_header:'<prior@example.com>',original_sender:'a@example.com'};
  const raw=Buffer.from(buildMime(r,{from:'me@example.com',attachments:[a],key}),'base64url').toString('utf8');
  assert.match(raw,/In-Reply-To: <orig@example.com>/);assert.match(raw,/References: <prior@example.com> <orig@example.com>/);
  assert.match(raw,/Content-Disposition: attachment; filename="cv.pdf"/);assert.match(raw,/Content-Transfer-Encoding: base64/);
  assert.ok(raw.includes(Buffer.from('PDF-BYTES').toString('base64'))); // Binary attachment is base64 encoded
});
test('Mocked Gmail: inbox search, read thread, label change and verified send',async()=>{
  const seen=[];const gmailFetch=async(url,options={})=>{
    const u=new URL(url);seen.push([u.pathname,u.search,options.method||'GET']);
    let data={};
    if(u.pathname.endsWith('/messages'))data={messages:[{id:'m1'}],resultSizeEstimate:1};
    else if(u.pathname.endsWith('/messages/m1'))data={id:'m1',threadId:'t1',internalDate:'1730000000000',labelIds:['INBOX'],snippet:'test',payload:{headers:[{name:'From',value:'Ali <ali@example.com>'},{name:'Subject',value:'Subject'},{name:'Message-ID',value:'<id@example.com>'}],mimeType:'text/plain',body:{data:Buffer.from('BODY').toString('base64url')}}};
    else if(u.pathname.endsWith('/threads/t1'))data={messages:[{id:'m1',threadId:'t1',internalDate:'1730000000000',payload:{headers:[{name:'From',value:'Ali <ali@example.com>'}],mimeType:'text/plain',body:{data:Buffer.from('BODY').toString('base64url')}}}]};
    else if(u.pathname.endsWith('/messages/m1/modify'))data={id:'m1'};
    else if(u.pathname.endsWith('/messages/send'))data={id:'SENT-ID',threadId:'t1'};
    return {ok:true,status:200,text:async()=>JSON.stringify(data)};
  };
  const store={accountById:()=>({token_cipher:seal(JSON.stringify({access_token:'mock-token',refresh_token:'mock-refresh',expires_at:Date.now()+3600e3}),key)})};
  const service=createGmail({store,key,clientId:'x',clientSecret:'y',fetchImpl:gmailFetch});
  const r=await service.list('acct',{folder:'inbox',query:'from:ali@example.com'});assert.equal(r.mails.length,1);assert.equal(r.mails[0].subject,'Subject');
  assert.ok(seen.find(x=>x[0].endsWith('/messages')&&x[1].includes('from%3Aali%40example.com')));
  assert.equal((await service.thread('acct','t1')).length,1);
  await service.setFlag('acct','m1','STARRED',true);
  assert.deepEqual(await service.send('acct','RAW','t1'),{id:'SENT-ID',threadId:'t1'});
  assert.ok(seen.find(x=>x[0].endsWith('/messages/send')&&x[2]==='POST'));
});
