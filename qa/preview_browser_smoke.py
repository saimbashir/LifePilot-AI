"""Offline PREVIEW-only visual smoke: this does not exercise the React build or live backend."""
from pathlib import Path
from playwright.sync_api import sync_playwright

root=Path(__file__).resolve().parents[1]
html=(root/'LifePilot-AI-Preview.html').read_text()
views=['overview','inbox','read','compose','voice','summary','approvals','activity','settings']
checks=0;issues=[]
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    for width in [1440,390,320]:
        page=browser.new_page(viewport={'width':width,'height':900},reduced_motion='reduce')
        errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.set_content(html,wait_until='load')
        # about:blank disallows History.replaceState; this is only a preview harness.
        page.evaluate('history.replaceState=function(){}')
        for view in views:
            exists=page.evaluate('(a)=>!!document.querySelector(`[data-action="${a}"]`)',view)
            if not exists:
                issues.append((width,view,'missing navigation action'));continue
            page.evaluate('(a)=>document.querySelector(`[data-action="${a}"]`).click()',view)
            page.wait_for_timeout(25)
            overflow=page.evaluate('document.documentElement.scrollWidth-window.innerWidth')
            checks+=1
            if overflow>1 or errors:issues.append((width,view,f'overflow={overflow},errors={errors}'))
            errors.clear()
        if width==1440:
            page.evaluate('document.querySelector(`[data-action="overview"]`).click()')
            page.screenshot(path=str(root/'docs/screenshots/preview-desktop.png'),full_page=False)
        if width==390:
            page.evaluate('document.querySelector(`[data-action="overview"]`).click()')
            page.screenshot(path=str(root/'docs/screenshots/preview-mobile.png'),full_page=False)
        page.close()
    browser.close()
print(f'Offline preview: {checks} screen/viewport checks; {len(issues)} issues.')
for issue in issues:print(issue)
if issues:raise SystemExit(1)
