import {test,expect} from '@playwright/test';
const realMail={id:'gmail-1',threadId:'thread-1',from:'Jane Cooper',email:'jane@example.com',to:'owner@example.com',subject:'Real Gmail test subject',preview:'This email came from a mocked Gmail API.',body:'Hello, this is a test email.',date:'2026-11-13T09:00:00.000Z',unread:true,starred:false,important:true,folder:'inbox',category:'Work',attachments:[]};
async function mockGmail(page:any){
  await page.route('**/api/session',route=>route.fulfill({json:{connected:true,configured:true,email:'owner@example.com',csrf:'test-csrf',monitoring:'Manual refresh'}}));
  await page.route('**/api/mail/stats',route=>route.fulfill({json:{inbox:1,unread:1,important:1}}));
  await page.route('**/api/mail?*',route=>route.fulfill({json:{mails:[realMail],nextPageToken:null,resultSizeEstimate:1}}));
  await page.route('**/api/drafts',route=>route.fulfill({json:{drafts:[]}}));
}
test('demo workspace retains original navigation and colours',async({page})=>{
  await page.route('**/api/session',route=>route.fulfill({json:{connected:false,configured:false,monitoring:'Not deployed'}}));
  await page.goto('/');await page.getByRole('button',{name:/Enter workspace/i}).click();
  await expect(page.getByText('Demo Workspace',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:/Smart inbox/i}).click();
  await expect(page.getByText('Research internship — next steps').first()).toBeVisible();
  await page.getByRole('button',{name:/Settings/i}).first().click();
  await expect(page.getByText('Gmail not connected')).toBeVisible();
});
test('real connected Gmail data replaces fictional inbox and uses Gmail counts',async({page})=>{
  await mockGmail(page);
  await page.goto('/');await page.getByRole('button',{name:/Enter workspace/i}).click();
  await expect(page.getByText('owner@example.com').first()).toBeVisible();
  await page.getByRole('button',{name:/Smart inbox/i}).click();
  await expect(page.getByText('Real Gmail test subject')).toBeVisible();
  await expect(page.getByText('Research internship — next steps')).toHaveCount(0);
});
test('manual reload and backend connection controls visible in Settings',async({page})=>{
  await mockGmail(page);await page.goto('/');await page.getByRole('button',{name:/Enter workspace/i}).click();
  await page.getByRole('button',{name:/Settings/i}).first().click();
  await expect(page.getByText('Gmail connected',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:/Refresh Gmail now/i})).toBeVisible();
  await expect(page.getByRole('button',{name:/Switch to demo/i})).toBeVisible();
});
