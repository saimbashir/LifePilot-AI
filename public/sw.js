/* LifePilot PWA shell. NEVER cache authenticated /api responses or Gmail contents. */
const CACHE='lifepilot-shell-v4';
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(['/','/favicon.svg','/manifest.webmanifest'])));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim()});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET'||new URL(e.request.url).pathname.startsWith('/api/')||new URL(e.request.url).pathname.startsWith('/internal/'))return;
  if(e.request.mode==='navigate'){
    e.respondWith(fetch(e.request).catch(()=>caches.match('/')));return;
  }
  // Only static build artifacts and public icons; never cache private data.
  const u=new URL(e.request.url);
  if(u.origin===self.location.origin&&(/^\/assets\//.test(u.pathname)||/^\/(favicon|icon-|manifest)/.test(u.pathname)))
    e.respondWith(caches.match(e.request).then(cached=>cached||fetch(e.request).then(res=>{if(res.ok){const copy=res.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));}return res})));
});
// Firebase SDK imports are conditional; do not register unless configured.
try{
  importScripts('/firebase-config.js');
  if(self.LIFEPILOT_FIREBASE_CONFIG){
    importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
    importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');
    firebase.initializeApp(self.LIFEPILOT_FIREBASE_CONFIG);
    firebase.messaging().onBackgroundMessage(payload=>{
      // FCM's notification payload is shown by browser SDK. Do not add a second notification here.
    });
  }
}catch(_ignored){/* No FCM config: offline shell remains usable */}
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  const data=e.notification.data||{};
  const requested=data.route||data?.FCM_MSG?.data?.route||'inbox';
  const route=requested==='approvals'?'approvals':'inbox'; // never trust arbitrary push URLs
  const url=new URL('/?open='+route,self.location.origin);
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients=>{
    for(const c of clients){if(new URL(c.url).origin===self.location.origin){await c.focus();await c.navigate(url.href);return;}}
    await self.clients.openWindow(url.href);
  }));
});
