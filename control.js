const $=s=>document.querySelector(s);
const logEl=$('#log');
let discoveryVdo=null, discoveryCtl=null, discoveryTimer=null;
let connectedStreamId='', lastTelemetry=null, smartFallbackActive=false, smartOriginalPreset=null,lastSmartQualityChange=0;
let cameras=[];
const CAMERA_STORE='remoteCamAutoCamerasV3';
const LEGACY_CAMERA_STORE='remoteCamAutoCamerasV2';
// Presence is confirmed by telemetry from the actual Sender. Do not mark a camera
// offline just because one transient WebRTC/data peer disconnects during recovery.
const OFFLINE_MS=12000;
const discoveryCandidates=new Map();

function log(m){logEl.textContent+=`[${new Date().toLocaleTimeString()}] ${m}\n`;logEl.scrollTop=logEl.scrollHeight}
function cleanId(v){return String(v||'').trim().replace(/[^\w]/g,'_')}
function systemRoom(){
  const host=(location.hostname||'remote').replace(/[^\w]/g,'_');
  const project=(location.pathname.split('/').filter(Boolean)[0]||'remote_camera').replace(/[^\w]/g,'_');
  return cleanId(`rc_${host}_${project}`);
}
function isSmart(){return $('#networkMode').value==='smart'}
function activeId(){return cleanId($('#streamId').value||$('#cameraSelect').value)}
function activeCamera(){return cameras.find(c=>c.id===activeId())||null}
function activeName(){const c=activeCamera();return c?.name||activeId()||'กล้อง'}
function saveCameras(){
  const persist=cameras.map(({id,deviceId,name,platform,browser})=>({id,deviceId,name,platform,browser}));
  localStorage.setItem(CAMERA_STORE,JSON.stringify(persist));
}
function loadCameras(){
  // v0.9 could persist provisional listing peers as if they were cameras. Start a
  // clean v3 registry once so those ghost/duplicate entries do not survive upgrade.
  if(!localStorage.getItem(CAMERA_STORE)) localStorage.removeItem(LEGACY_CAMERA_STORE);
  try{cameras=JSON.parse(localStorage.getItem(CAMERA_STORE)||'[]')}catch{cameras=[]}
  if(!Array.isArray(cameras))cameras=[];
  cameras=cameras.filter(x=>x?.id&&cleanId(x.id).startsWith('cam_')).map(x=>({id:cleanId(x.id),deviceId:cleanId(x.deviceId||''),name:String(x.name||x.id),platform:x.platform||'',browser:x.browser||'',online:false,lastSeen:0,uuid:''}));
}
function parseLabel(label,id){
  const raw=String(label||'');
  if(raw.startsWith('RCAM|')){
    const p=raw.split('|');
    return {name:p[1]||id,platform:p[2]||'',browser:p[3]||''};
  }
  return {name:raw&&raw!==id?raw:id};
}
function upsertCamera(info,{render=true}={}){
  const id=cleanId(info?.id||info?.streamID||info?.streamId||'');
  const deviceId=cleanId(info?.deviceId||info?.deviceID||'');
  if(!id.startsWith('cam_'))return null;
  // Device ID is the stable identity; stream ID is its current video endpoint.
  // If a Sender reconnects with a changed stream ID, merge it into the same card.
  let c=deviceId?cameras.find(x=>x.deviceId===deviceId):null;
  if(!c)c=cameras.find(x=>x.id===id);
  if(!c){c={id,deviceId,name:id,platform:'',browser:'',online:false,lastSeen:0,uuid:''};cameras.push(c);log(`พบกล้องจริงจาก Sender: ${id}`)}
  else if(c.id!==id)c.id=id;
  if(deviceId)c.deviceId=deviceId;
  if(info.label){const p=parseLabel(info.label,id);if(p.name)c.name=p.name;if(p.platform)c.platform=p.platform;if(p.browser)c.browser=p.browser}
  if(info.name)c.name=String(info.name);
  if(info.platform)c.platform=String(info.platform);
  if(info.browser)c.browser=String(info.browser);
  if(info.uuid)c.uuid=String(info.uuid);
  c.online=true;
  c.lastSeen=Date.now();
  saveCameras();
  if(render)renderRegistry();
  return c;
}
function markOffline(){
  const now=Date.now();let changed=false;
  for(const c of cameras){const on=!!c.lastSeen&&(now-c.lastSeen)<OFFLINE_MS;if(c.online!==on){c.online=on;changed=true}}
  if(changed)renderRegistry();
}
function onlineCount(){return cameras.filter(c=>c.online).length}

function receiverUrl({preview=false,streamId=null}={}){
  const id=cleanId(streamId??activeId());
  if(!id)return '';
  const u=new URL('receiver.html',location.href);
  u.searchParams.set('room',$('#room').value.trim());
  u.searchParams.set('stream',id);
  u.searchParams.set('bitrate',$('#bitrate').value);
  u.searchParams.set('buffer',$('#buffer').value);
  if($('#codec').value)u.searchParams.set('codec',$('#codec').value);
  if(isSmart()){u.searchParams.set('smart','1');u.searchParams.set('minbitrate',$('#smartMin').value)}
  if(preview)u.searchParams.set('preview','1');
  return u.href;
}
function renderRegistry(preferred=null){
  const previous=cleanId(preferred||activeId());
  const ordered=[...cameras].sort((a,b)=>(Number(b.online)-Number(a.online))||(b.lastSeen-a.lastSeen)||a.name.localeCompare(b.name));
  const sel=$('#cameraSelect');sel.innerHTML='';
  if(!ordered.length){const o=document.createElement('option');o.textContent='ยังไม่พบกล้องออนไลน์';o.value='';sel.appendChild(o);sel.disabled=true;$('#streamId').value=''}
  else{
    sel.disabled=false;
    ordered.forEach(c=>{const o=document.createElement('option');o.value=c.id;o.textContent=`${c.online?'🟢':'⚫'} ${c.name}${c.platform?` • ${c.platform}`:''}`;sel.appendChild(o)});
    let chosen=ordered.find(c=>c.id===previous)?.id||ordered.find(c=>c.online)?.id||ordered[0].id;
    sel.value=chosen;$('#streamId').value=chosen;
  }
  const chips=$('#cameraChips');chips.innerHTML='';
  ordered.forEach(c=>{const b=document.createElement('button');b.type='button';b.className='camera-chip'+(c.id===activeId()?' active':'')+(c.online?' online':' offline');b.dataset.id=c.id;b.innerHTML=`<span class="presence-dot"></span>${c.name} <small>${c.platform||''}</small>`;chips.appendChild(b)});
  $('#discoveryStatus').innerHTML=`<b>${onlineCount()} กล้องออนไลน์</b><span>${cameras.length} เครื่องที่รู้จัก</span>`;
  updateObs();renderMultiObs();
}
function renderMultiObs(){
  const box=$('#multiObsList');if(!box)return;box.innerHTML='';
  const ordered=[...cameras].sort((a,b)=>Number(b.online)-Number(a.online)||a.name.localeCompare(b.name));
  if(!ordered.length){box.innerHTML='<div class="mini">ยังไม่พบมือถือที่กำลังส่งภาพ</div>';return}
  ordered.forEach(c=>{
    const row=document.createElement('div');row.className='multi-obs-row';
    const name=document.createElement('div');name.innerHTML=`${c.online?'🟢':'⚫'} ${c.name}`;
    const id=document.createElement('div');id.className='mini';id.textContent=c.platform||c.id;
    const input=document.createElement('input');input.readOnly=true;input.value=receiverUrl({streamId:c.id});
    const copy=document.createElement('button');copy.type='button';copy.textContent='คัดลอก';copy.onclick=async()=>{await navigator.clipboard.writeText(input.value);copy.textContent='แล้ว';setTimeout(()=>copy.textContent='คัดลอก',900)};
    row.append(name,id,input,copy);box.appendChild(row)
  });
}
function updateObs(){
  $('#obsUrl').value=receiverUrl();
  $('#statNetworkMode').textContent=isSmart()?'SMART — ปรับอัตโนมัติ':'MANUAL — คง bitrate';
  $('#smartMinWrap').classList.toggle('hidden',!isSmart());
  $('#smartFallbackWrap').classList.toggle('hidden',!isSmart());
  $('#smartBadge').textContent=isSmart()?'SMART':'MANUAL';
}
function reloadPreview(){const f=$('#remoteFrame');if(connectedStreamId&&f.src&&f.src!=='about:blank')f.src=receiverUrl({preview:true,streamId:connectedStreamId})}

function setTelemetry(d,uuid=''){
  const id=cleanId(d?.streamID||'');if(!id)return;
  const c=upsertCamera({id,deviceId:d?.deviceID||d?.deviceId,name:d?.cameraName,platform:d?.platform,browser:d?.browser,uuid,online:true},{render:false});
  if(c)renderRegistry(id===activeId()?id:activeId());
  if(id!==activeId())return;
  lastTelemetry=d;const req=d?.requested||{},act=d?.actual||{};const reqF=Number(req.fps||0),actF=Number(act.fps||0),meas=Number(d?.measuredFps||0);
  if(!smartFallbackActive&&d?.presetKey)smartOriginalPreset=d.presetKey;
  $('#telName').textContent=d?.cameraName||activeName();
  $('#telPlatform').textContent=[d?.platform,d?.browser].filter(Boolean).join(' / ')||'-';
  $('#telRequested').textContent=reqF?`${req.width||'?'}×${req.height||'?'} @≤${reqF}`:'-';
  $('#telActual').textContent=(act.width||act.height)?`${act.width||'?'}×${act.height||'?'} @${actF?actF.toFixed(1):'?'} fps`:'-';
  $('#telMeasured').textContent=meas?`${meas.toFixed(1)} fps`:'กำลังวัด…';$('#telCamera').textContent=d?.cameraLabel||act.facingMode||'-';
  let verdict='ค่าปกติ';if(reqF>=55){if(actF&&actF<50)verdict=`กล้อง/เบราว์เซอร์จำกัดที่ ~${actF.toFixed(0)} fps`;else if(meas&&meas<50)verdict=`settings ใกล้ 60 แต่เฟรมจริง ~${meas.toFixed(0)} fps`;else if(meas>=50)verdict=`ฝั่งกล้องผ่าน 60 fps ✓ (${meas.toFixed(1)})`;else verdict='กำลังทดสอบ 60 fps…'}else if(meas)verdict=`ฝั่งกล้อง ~${meas.toFixed(1)} fps`;
  $('#telVerdict').textContent=verdict;$('#telSmartProfile').textContent=d?.smartProfile||'ปกติ';
  const z=d?.zoom;if(z&&Number.isFinite(Number(z.min))&&Number.isFinite(Number(z.max))){const zr=$('#zoom');zr.min=String(z.min);zr.max=String(z.max);zr.step=String(z.step||.1);if(document.activeElement!==zr)zr.value=String(z.current||z.min);$('#zoomValue').value=`${Number(z.current||z.min).toFixed(2)}×`;if(z.speed&&$('#zoomSpeed'))$('#zoomSpeed').value=z.speed;$('#zoomCap').textContent=`${z.min}× – ${z.max}×`}
}
function extractData(e){return e?.detail?.data??e?.detail??e?.data}
function extractUuid(e){return e?.detail?.uuid??e?.uuid??''}
function collectListing(value,out=[],depth=0){
  if(depth>5||value==null)return out;
  if(Array.isArray(value)){value.forEach(v=>collectListing(v,out,depth+1));return out}
  if(typeof value!=='object')return out;
  const id=cleanId(value.streamID||value.streamId||value.streamid||value.stream||'');
  if(id.startsWith('cam_'))out.push({id,label:value.label||value.name||'',uuid:value.uuid||value.UUID||'',online:true});
  Object.entries(value).forEach(([k,v])=>{if(!['streamID','streamId','streamid','stream','label','name','uuid','UUID'].includes(k))collectListing(v,out,depth+1)});
  return out;
}
function rememberDiscoveryCandidate(item){
  if(!item?.id)return;
  discoveryCandidates.set(item.id,{...item,lastSeen:Date.now()});
}
function handleListing(e){
  // A VDO.Ninja room can expose several transient peer/listing records for one
  // physical phone. Listings are discovery candidates only; a camera is shown
  // after its Sender telemetry confirms streamID + stable deviceID.
  const list=collectListing(e?.detail??e);
  for(const item of list)rememberDiscoveryCandidate(item);
}

async function startDiscovery(){
  if(discoveryVdo)return;
  $('#discoveryStatus').textContent='กำลังเชื่อม Room…';
  await loadVDONinjaSDK(({index,total})=>log(`โหลด SDK สำหรับ Auto Discovery ${index}/${total}`));
  const room=$('#room').value;
  discoveryVdo=new VDONinjaSDK({autoRecover:true,autoRelay:true,salt:'vdo.ninja',label:'Remote Camera Control Center'});
  discoveryVdo.addEventListener('connected',()=>{log('Auto Discovery signaling connected')});
  discoveryVdo.addEventListener('listing',handleListing);discoveryVdo.addEventListener('peerListing',handleListing);discoveryVdo.addEventListener('room-peer-listing',handleListing);
  discoveryVdo.addEventListener('peerConnected',e=>{
    const d=e.detail||{};const id=cleanId(d.streamID||d.streamId||'');
    if(id.startsWith('cam_')){
      rememberDiscoveryCandidate({id,label:d.label||'',uuid:d.uuid||'',online:true});
      // Ask the actual Sender to identify itself. Do not render this peer yet.
      setTimeout(()=>{try{discoveryVdo?.sendData({type:'remote-camera-discover',targetStream:id,ts:Date.now()},{streamID:id,allowFallback:true})}catch{}},120);
    }
  });
  discoveryVdo.addEventListener('peerDisconnected',e=>{
    const uuid=extractUuid(e);
    // A transient data/viewer peer can disconnect while the published camera is
    // still alive. Clear the stale peer UUID but let telemetry timeout decide
    // ONLINE/OFFLINE, preventing presence from blinking during auto-recovery.
    const c=cameras.find(x=>x.uuid===uuid);if(c)c.uuid='';
  });
  discoveryVdo.addEventListener('peerLatency',e=>{const uuid=extractUuid(e);const c=cameras.find(x=>x.uuid===uuid);if(c?.id===activeId()){const v=e.detail?.latency??e.detail?.rtt??e.detail?.value;if(v!=null)$('#latency').textContent=`${Math.round(v)} ms`}});
  discoveryVdo.addEventListener('dataReceived',e=>{const d=extractData(e);if(d?.type==='remote-camera-telemetry')setTelemetry(d,extractUuid(e));});
  discoveryVdo.addEventListener('connectionRecovered',()=>log('Auto Discovery recovered'));
  discoveryVdo.addEventListener('connectionFailed',()=>log('Auto Discovery connection failed'));
  if(typeof discoveryVdo.autoConnect==='function'){
    discoveryCtl=await discoveryVdo.autoConnect({room,filter:{prefix:'cam_'}});
    log(`Auto Discovery พร้อมใน ${room}`);
  }else{
    await discoveryVdo.connect();await discoveryVdo.joinRoom({room});
    log(`Auto Discovery fallback พร้อมใน ${room}`);
  }
  $('#discoveryStatus').innerHTML='<b>กำลังค้นหา…</b><span>มือถือจะปรากฏเองเมื่อเริ่มส่งภาพ</span>';
  const ping=()=>{try{discoveryVdo?.sendData({type:'remote-camera-discover',ts:Date.now()})}catch{}};
  ping();discoveryTimer=setInterval(ping,3000);
}
async function restartDiscovery(){
  if(discoveryTimer){clearInterval(discoveryTimer);discoveryTimer=null}
  try{await discoveryCtl?.stop?.()}catch{}
  try{await discoveryVdo?.disconnect?.()}catch{}
  discoveryCtl=null;discoveryVdo=null;
  discoveryCandidates.clear();
  cameras.forEach(c=>{c.online=false;c.uuid='';c.lastSeen=0});renderRegistry();
  await startDiscovery();
}

function fmt(n,d=1,suffix=''){return Number.isFinite(Number(n))?`${Number(n).toFixed(d)}${suffix}`:'-'}
function stateThai(s){return ({good:'ดี',fair:'พอใช้',weak:'อ่อน',critical:'วิกฤต',waiting:'กำลังวัด'})[s]||s||'-'}
function handleReceiverStats(d){
  $('#smartState').textContent=stateThai(d.state);$('#smartTarget').textContent=d.currentBitrate?`${(d.currentBitrate/1000).toFixed(d.currentBitrate%1000?1:0)} Mbps`:'-';$('#smartActual').textContent=d.bitrateKbps?`${(d.bitrateKbps/1000).toFixed(2)} Mbps`:'-';$('#smartLoss').textContent=d.lossPct!=null?fmt(d.lossPct,2,'%'):'-';$('#smartRtt').textContent=d.rttMs!=null?fmt(d.rttMs,0,' ms'):'-';$('#smartJitter').textContent=d.jitterMs!=null?fmt(d.jitterMs,0,' ms'):'-';
  const badge=$('#smartBadge');badge.textContent=isSmart()?`SMART ${stateThai(d.state)}`:'MANUAL';badge.classList.toggle('ok',d.state==='good');
  if(d.action==='bitrate'&&d.reason&&isSmart())log(`Smart Network → ${(d.currentBitrate/1000).toFixed(1)} Mbps (${d.reason})`);
  if(!isSmart()||!connectedStreamId||$('#smartFallback').value!=='1')return;
  const now=Date.now();
  if(d.fallbackRecommended&&!smartFallbackActive&&now-lastSmartQualityChange>10000){const current=lastTelemetry?.presetKey||smartOriginalPreset||'';if(current&&current!=='720_30'){smartOriginalPreset=smartOriginalPreset||current;smartFallbackActive=true;lastSmartQualityChange=now;send('quality',{value:'720_30',reason:'Smart Network: ฉุกเฉิน 720p30'});log('⚠ Smart Network: ลดกล้องเป็น 720p30 ชั่วคราว')}}
  if(d.restoreRecommended&&smartFallbackActive&&now-lastSmartQualityChange>18000){const restore=smartOriginalPreset||'1080_30';smartFallbackActive=false;lastSmartQualityChange=now;send('quality',{value:restore,reason:`Smart Network: คืน ${restore}`});log(`✓ Smart Network: คืนคุณภาพ ${restore}`)}
}
function resetTelemetry(){lastTelemetry=null;$('#telName').textContent=activeName();$('#telPlatform').textContent=activeCamera()?.platform||'-';$('#telRequested').textContent='รอข้อมูล…';['telActual','telMeasured','telCamera','telVerdict','telSmartProfile'].forEach(id=>$('#'+id).textContent='-')}

async function openSelected(){
  const id=activeId();if(!id)throw new Error('ยังไม่พบกล้อง');
  const c=activeCamera();if(c&&!c.online)log('กล้องนี้ขึ้น Offline — จะลองเปิดภาพจาก Stream ID ล่าสุด');
  connectedStreamId=id;smartFallbackActive=false;smartOriginalPreset=null;resetTelemetry();
  $('#remoteFrame').src=receiverUrl({preview:true,streamId:id});
  $('#status').textContent='CONTROL ACTIVE';$('#status').classList.add('ok');
  log(`เปิดภาพ ${activeName()} (${id}) • ${$('#bitrate').value} kbps • ${isSmart()?'Smart':'Manual'}`);
  try{discoveryVdo?.sendData({type:'remote-camera-discover',targetStream:id,ts:Date.now()},{streamID:id,allowFallback:true})}catch{}
}
function closeSelected(){
  connectedStreamId='';$('#remoteFrame').src='about:blank';smartFallbackActive=false;smartOriginalPreset=null;
  $('#status').textContent='รอเลือกกล้อง';$('#status').classList.remove('ok');$('#latency').textContent='HQ VIEW';
  ['smartState','smartTarget','smartActual','smartLoss','smartRtt','smartJitter'].forEach(id=>$('#'+id).textContent='-');
  log('ปิดภาพกล้องที่เลือก');
}
function send(command,extra={}){
  const id=activeId();if(!discoveryVdo||!id){log('Auto Discovery ยังไม่พร้อมหรือยังไม่พบกล้อง');return}
  const payload={type:'remote-camera',command,...extra,ts:Date.now(),targetStream:id};
  const c=activeCamera();
  try{
    if(c?.uuid)discoveryVdo.sendData(payload,c.uuid);else discoveryVdo.sendData(payload,{streamID:id,allowFallback:true});
    log(`ส่ง ${command} → ${id}`);
  }catch(e){log(`Send error: ${e.message}`)}
}
async function selectCamera(id,{open=false}={}){
  id=cleanId(id);if(!id)return;
  $('#streamId').value=id;$('#cameraSelect').value=id;renderRegistry(id);resetTelemetry();
  if(connectedStreamId&&connectedStreamId!==id)closeSelected();
  if(open)await openSelected();
  try{discoveryVdo?.sendData({type:'remote-camera-discover',targetStream:id,ts:Date.now()},{streamID:id,allowFallback:true})}catch{}
}

loadCameras();$('#room').value=systemRoom();renderRegistry();updateObs();resetTelemetry();
['bitrate','buffer','codec','networkMode','smartMin','smartFallback'].forEach(id=>$('#'+id).addEventListener('change',()=>{updateObs();renderMultiObs();reloadPreview()}));
$('#cameraSelect').addEventListener('change',e=>selectCamera(e.target.value).catch(x=>log(`Select error: ${x.message}`)));
$('#cameraChips').addEventListener('click',e=>{const b=e.target.closest('[data-id]');if(b)selectCamera(b.dataset.id).catch(x=>log(`Select error: ${x.message}`))});
$('#refreshDiscovery').onclick=()=>restartDiscovery().catch(e=>log(`Discovery restart error: ${e.message}`));
$('#forgetOffline').onclick=()=>{cameras=cameras.filter(c=>c.online);saveCameras();renderRegistry();log('ล้างรายการ Offline แล้ว')};
window.addEventListener('message',e=>{if(e.source!==$('#remoteFrame').contentWindow)return;const d=e.data;if(d?.type==='remote-camera-receiver-stats')handleReceiverStats(d)});
$('#connect').onclick=()=>openSelected().catch(e=>log(`Open error: ${e.message}`));$('#disconnect').onclick=closeSelected;
$('#front').onclick=()=>send('front');$('#rear').onclick=()=>send('rear');
let zoomSendTimer=null;function zoomSpeed(){return $('#zoomSpeed')?.value||'normal'}
$('#zoom').oninput=e=>{const v=Number(e.target.value);$('#zoomValue').value=`${v.toFixed(2)}×`;clearTimeout(zoomSendTimer);zoomSendTimer=setTimeout(()=>send('zoomTarget',{value:v,speed:zoomSpeed()}),35)};
$('#zoomSpeed').onchange=()=>send('zoomTarget',{value:Number($('#zoom').value),speed:zoomSpeed()});
function bindRemoteHoldZoom(btn,dir){
  let activePointer=null;
  const block=e=>{e.preventDefault();e.stopPropagation()};
  const start=e=>{block(e);activePointer=e.pointerId??'mouse';try{if(e.pointerId!=null)btn.setPointerCapture(e.pointerId)}catch{}btn.classList.add('holding');send('zoomDrive',{direction:dir,speed:zoomSpeed()})};
  const stop=e=>{if(e){e.preventDefault();e.stopPropagation()}if(activePointer===null)return;try{if(e?.pointerId!=null&&btn.hasPointerCapture?.(e.pointerId))btn.releasePointerCapture(e.pointerId)}catch{}activePointer=null;btn.classList.remove('holding');send('zoomStop',{speed:zoomSpeed()})};
  btn.addEventListener('pointerdown',start);btn.addEventListener('pointerup',stop);btn.addEventListener('pointercancel',stop);btn.addEventListener('lostpointercapture',()=>{if(activePointer!==null)stop()});['contextmenu','selectstart','dragstart'].forEach(type=>btn.addEventListener(type,block));
}
bindRemoteHoldZoom($('#zoomOut'),-1);bindRemoteHoldZoom($('#zoomIn'),1);
$('#copy').onclick=async()=>{if(!$('#obsUrl').value)return;await navigator.clipboard.writeText($('#obsUrl').value);$('#copy').textContent='คัดลอกแล้ว';setTimeout(()=>$('#copy').textContent='คัดลอก',1200)};
setInterval(markOffline,2000);
window.addEventListener('beforeunload',()=>{try{discoveryCtl?.stop?.()}catch{};try{discoveryVdo?.disconnect?.()}catch{}});
startDiscovery().catch(e=>{log(`Auto Discovery error: ${e.message}`);$('#discoveryStatus').innerHTML='<b>เชื่อมไม่สำเร็จ</b><span>กด “ค้นหากล้องใหม่” เพื่อลองอีกครั้ง</span>'});
log(`v0.9.2 พร้อม — Discovery ยืนยันจาก Sender / รวม peer ซ้ำ / Offline grace ${OFFLINE_MS/1000}s`);
