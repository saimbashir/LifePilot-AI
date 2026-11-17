import {test,expect} from '@playwright/test';
const email={id:'g1',threadId:'t1',from:'Ahmad',email:'ahmad@example.com',to:'owner@example.com',subject:'Internship status update',preview:'Please send your portfolio.',body:'Please send your portfolio before November 20, 2026.',date:'2026-11-13T09:00:00.000Z',unread:true,starred:false,important:true,folder:'inbox',category:'Primary',attachments:[]};
const prefs={greeting:'Hello',closing:'Best regards',tone:'Professional',length:'Medium',summaryLanguage:'roman-urdu',speechRate:1};
async function mockLifePilot(page:any){
  let consent=false;
  await page.route('**/api/session',route=>route.fulfill({json:{connected:true,configured:true,email:'owner@example.com',csrf:'csrf',monitoring:'Manual refresh'}}));
  await page.route('**/api/mail/stats',route=>route.fulfill({json:{inbox:1,unread:1,important:1}}));
  await page.route('**/api/mail?*',route=>route.fulfill({json:{mails:[email],nextPageToken:null,resultSizeEstimate:1}}));
  await page.route('**/api/mail/g1',route=>route.fulfill({json:email}));
  await page.route('**/api/drafts',route=>route.fulfill({json:{drafts:[]}}));
  await page.route('**/api/ai/status',route=>route.fulfill({json:{provider:'groq',configured:true,enabled:true,model:'openai/gpt-oss-20b',consent,processingNotice:'external provider',usage:{requests:0,prompt_tokens:0,completion_tokens:0}}}));
  await page.route('**/api/ai/preferences',route=>route.fulfill({json:prefs}));
  await page.route('**/api/ai/consent',async route=>{consent=JSON.parse(route.request().postData()||'{}').enabled;await route.fulfill({json:{consent,enabled:true}})});
  await page.route('**/api/ai/summarize',route=>route.fulfill({json:{messageId:'g1',language:'roman-urdu',summary:'Ahmad ne portfolio maanga hai.',keyPoints:['Portfolio request'],dates:['November 20, 2026'],actionItems:['Portfolio review'],uncertainties:[],sourceTruncated:false,sourceChars:50}}));
  await page.route('**/api/ai/command',route=>route.fulfill({json:{intent:'show_unread',route:'inbox',folder:'unread',autoSend:false}}));
  await page.route('**/api/ai/reply',route=>route.fulfill({status:201,json:{id:'d1',to:'ahmad@example.com',cc:'',bcc:'',subject:'Re: Internship status update',body:'Thank you for the message.',status:'draft',tone:'Professional',length:'Medium',createdAt:'2026-11-13T09:00:00.000Z',sourceEmailId:'g1',attachments:[],version:1,contentHash:'hash'}}));
  return {getConsent:()=>consent};
}
test('Groq opt-in is off by default and requires deliberate consent',async({page})=>{
  const ctx=await mockLifePilot(page);await page.goto('/');await page.getByRole('button',{name:/Enter workspace/i}).click();
  await page.getByRole('button',{name:/Settings/i}).first().click();
  await expect(page.getByText(/Groq AI · External processing consent/i)).toBeVisible();
  await expect(page.getByRole('switch',{name:/Allow external Groq AI processing/i})).toHaveAttribute('aria-checked','false');
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('switch',{name:/Allow external Groq AI processing/i}).click();
  await expect(page.getByRole('switch',{name:/Allow external Groq AI processing/i})).toHaveAttribute('aria-checked','true');
  expect(ctx.getConsent()).toBe(true);
});
test('connected Gmail summary comes from mocked provider, not demo template',async({page})=>{
  await mockLifePilot(page);await page.goto('/');await page.getByRole('button',{name:/Enter workspace/i}).click();
  await page.getByRole('button',{name:/Settings/i}).first().click();page.once('dialog',d=>d.accept());
  await page.getByRole('switch',{name:/Allow external Groq AI processing/i}).click();
  await page.getByRole('button',{name:/Smart inbox/i}).click();
  await page.getByText('Internship status update').first().click();
  await page.getByRole('button',{name:/Summarize this email/i}).click();
  await expect(page.getByText('Ahmad ne portfolio maanga hai.')).toBeVisible();
  await expect(page.getByText('November 20, 2026')).toBeVisible();
  await expect(page.getByText('MOCK AI SUMMARY')).toHaveCount(0);
});
test('typed voice fallback routes unread to real Gmail without microphone',async({page})=>{
  await mockLifePilot(page);await page.goto('/');await page.getByRole('button',{name:/Enter workspace/i}).click();
  await page.getByRole('button',{name:/Settings/i}).first().click();page.once('dialog',d=>d.accept());
  await page.getByRole('switch',{name:/Allow external Groq AI processing/i}).click();
  await page.getByRole('button',{name:/Voice assistant/i}).first().click();
  await page.getByRole('textbox',{name:/Voice command fallback/i}).fill('Show my unread Gmail messages');
  await page.getByRole('button',{name:/Run command/i}).click();
  await expect(page.getByRole('button',{name:/Unread/i}).first()).toBeVisible();
});
test('320px and 390px viewports preserve navigation with motion disabled',async({page})=>{
  await mockLifePilot(page);
  for(const width of [320,390]){
    await page.setViewportSize({width,height:740});await page.emulateMedia({reducedMotion:'reduce'});
    await page.goto('/');await page.getByRole('button',{name:/Enter workspace/i}).click();
    await expect(page.getByRole('navigation',{name:'Mobile navigation'})).toBeVisible();
    await page.getByRole('button',{name:'Inbox',exact:true}).last().click();
    await expect(page.getByText('Internship status update')).toBeVisible();
    // Avoid asserting zero page-wide overflow: animated orb intentionally draws outside decorative boundary.
  }
});
