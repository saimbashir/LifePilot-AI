import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const code=fs.readFileSync(path.join(here,'../design-preview.js'),'utf8');
function createPreview(){
  const listeners={};
  const root={innerHTML:'',addEventListener(type,fn){listeners[type]=fn;}};
  const ctx={URLSearchParams,location:{search:'',pathname:'/design-preview.html'},document:{documentElement:{dataset:{}},getElementById(id){return id==='root'?root:null},querySelector(){return null},createElement(){return {innerHTML:'',remove(){}}},body:{appendChild(){}}},window:{history:{replaceState(){}},addEventListener(){}},scrollTo(){},setTimeout(){},confirm(){return true;},console};
  vm.createContext(ctx);vm.runInContext(code,ctx);
  const action=(type,id,value)=>listeners.click({target:{closest(){return {dataset:{action:type,id,value}};}}});
  return {root,ctx,action,run:(src)=>vm.runInContext(src,ctx)};
}
test('initial welcome screen has original headline and preview label',()=>{
  const p=createPreview(); assert.match(p.root.innerHTML,/Less inbox/); assert.match(p.root.innerHTML,/FRONTEND PREVIEW/);
});
test('dashboard renders focus area, stats and inbox',()=>{
  const p=createPreview();p.action('overview');assert.match(p.root.innerHTML,/A calmer way to stay ahead/);assert.match(p.root.innerHTML,/Worth your attention/);assert.match(p.root.innerHTML,/Research internship/);
});
test('inbox opens an email, marks it read, and offers draft actions',()=>{
  const p=createPreview();p.action('inbox');assert.match(p.root.innerHTML,/Smart inbox/);p.action('read','m2');assert.match(p.root.innerHTML,/A quick update on our proposal/);assert.equal(p.run("demo.emails.find(m=>m.id==='m2').unread"),false);assert.match(p.root.innerHTML,/Generate reply/);
});
test('draft review requires confirmation and never claims real delivery',()=>{
  const p=createPreview();p.action('read','m1');p.action('reply');assert.match(p.root.innerHTML,/Refine your message/);p.action('request');assert.equal(p.run('demo.drafts[0].status'),'pending');p.action('approve');assert.equal(p.run('demo.drafts[0].status'),'sent');assert.match(p.root.innerHTML,/Simulated sends completed/);
});
test('typed commands route to demo views and themes change',()=>{
  const p=createPreview();p.run("runCommand('Summarize my latest internship email')");assert.equal(p.run('demo.screen'),'summary');p.action('theme');assert.equal(p.run('demo.theme'),'dark');p.run("runCommand('Show my unread emails')");assert.equal(p.run('demo.screen'),'inbox');
});
test('all ten requested screens render',()=>{
  const p=createPreview();for(const [screen,term] of Object.entries({welcome:'Less inbox',overview:'stay ahead',inbox:'Smart inbox',read:'MESSAGE DETAIL',compose:'Refine your message',voice:'Just say what you need',summary:'Clarity in a few lines',approvals:'The final word is yours',settings:'workspace that feels like you',activity:'Every step, accounted for'})){p.run(`demo.screen=${JSON.stringify(screen)};render()`);assert.ok(p.root.innerHTML.includes(term),`missing ${screen}`);}
});
