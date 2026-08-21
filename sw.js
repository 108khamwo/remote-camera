const CACHE='remote-camera-v0116';
const STATIC_ASSETS=['./manifest.webmanifest'];
self.addEventListener('install',e=>{
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(STATIC_ASSETS).catch(()=>{})));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const url=new URL(e.request.url);
  const isCode=/\.(?:html|js|css)$/.test(url.pathname) || url.pathname.endsWith('/');
  if(isCode){
    // During active development always prefer the newest GitHub Pages files.
    e.respondWith(fetch(new Request(e.request,{cache:'no-store'})).catch(()=>caches.match(e.request)));
    return;
  }
  e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)));
});
