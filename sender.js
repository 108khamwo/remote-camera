const $=s=>document.querySelector(s); const logEl=$('#log');
function log(m){const t=new Date().toLocaleTimeString();logEl.textContent+=`[${t}] ${m}\n`;logEl.scrollTop=logEl.scrollHeight}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let cameraStream=null,audioStream=null,outStream=null,vdo=null,currentFacing='environment',isPublishing=false,lastRemoteTs=0;
const processedRemoteCommands=new Map();
let explicitDeviceId='', openingCamera=false;
let peerIds=new Set();
let measuredCameraFps=0, frameMeterGeneration=0, telemetryTimer=null;
let smartProfile='ปกติ';
let wakeLockSentinel=null, restHintTimer=null, messageToastTimer=null;
const senderMessages=[];
const processedMessageIds=new Map();const pendingSenderMessageAcks=new Map();let senderMessageSeq=0;
function nextSenderMessageId(){senderMessageSeq=(senderMessageSeq+1)%100000;return `smsg_${Date.now().toString(36)}_${senderMessageSeq.toString(36)}`}
const video=$('#cameraVideo');
const MESSAGE_CORE_VERSION='0.11.2';
function updateSimpleStatus(){
  const el=$('#senderSimpleStatus');
  const sendBtn=$('#sendToggleBtn'), sendLabel=$('#sendToggleLabel'), sendIcon=$('#sendToggleIcon');
  const liveTrack=cameraStream?.getVideoTracks?.().some(t=>t.readyState==='live');
  if(isPublishing){
    if(el){el.textContent='กำลังส่งภาพ';el.className='goodtext'}
    if(sendBtn)sendBtn.classList.add('is-live');
    if(sendLabel)sendLabel.textContent='หยุดส่ง';
    if(sendIcon)sendIcon.textContent='■';
    return;
  }
  if(el){el.textContent=liveTrack?'กล้องพร้อม':'พร้อมส่งภาพ';el.className=liveTrack?'goodtext':''}
  if(sendBtn)sendBtn.classList.remove('is-live');
  if(sendLabel)sendLabel.textContent='ส่งภาพ';
  if(sendIcon)sendIcon.textContent='●';
}

const UA=navigator.userAgent||'';
const IS_ANDROID=/Android/i.test(UA);
const IS_IOS=/iPhone|iPad|iPod/i.test(UA) || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1);
const IS_SAMSUNG=/SamsungBrowser/i.test(UA);
const PLATFORM=IS_ANDROID?'Android':IS_IOS?'iOS':'Browser';
const BROWSER=IS_SAMSUNG?'Samsung Internet':/CriOS|Chrome/i.test(UA)?'Chrome':/Safari/i.test(UA)?'Safari':'Web Browser';
const DEVICE_KEY='remoteCamPhysicalDeviceIdV1';
let DEVICE_ID='';
function shortId(n=8){try{return crypto.randomUUID().replace(/-/g,'').slice(0,n)}catch{return (Math.random().toString(36).slice(2)+Date.now().toString(36)).slice(0,n)}}
function normId(v){return String(v||'').trim().replace(/[^\w]/g,'_')}
function systemRoom(){
  const host=(location.hostname||'remote').replace(/[^\w]/g,'_');
  const project=(location.pathname.split('/').filter(Boolean)[0]||'remote_camera').replace(/[^\w]/g,'_');
  return normId(`rc_${host}_${project}`);
}
function platformSlug(){return IS_IOS?'ios':IS_ANDROID?'android':'web'}
function initIdentity(){
  let stable=normId(localStorage.getItem(DEVICE_KEY)||'');
  if(!stable.startsWith('dev_'))stable=`dev_${platformSlug()}_${shortId(10)}`;
  DEVICE_ID=stable;localStorage.setItem(DEVICE_KEY,DEVICE_ID);
  const savedStream=localStorage.getItem('remoteCamStreamId');
  const savedName=localStorage.getItem('remoteCamName');
  let id=normId(savedStream||'');
  if(!id.startsWith('cam_'))id=`cam_${platformSlug()}_${shortId(8)}`;
  $('#room').value=systemRoom();
  $('#streamId').value=id;
  if($('#roomView'))$('#roomView').value=systemRoom();
  if($('#streamIdView'))$('#streamIdView').value=id;
  $('#cameraName').value=savedName||`${PLATFORM} ${id.slice(-4).toUpperCase()}`;
  localStorage.setItem('remoteCamStreamId',id);
  localStorage.setItem('remoteCamRoom',systemRoom());
  $('#platformBadge').textContent=`${PLATFORM} • ${BROWSER}`;
  $('#statPlatform').textContent=`${PLATFORM} / ${BROWSER}`;
  $('#cameraHelp').textContent=IS_ANDROID?'Android: ใช้ “กล้องหน้า / กล้องหลัง” เป็นหลัก ครั้งแรกถ้าเบราว์เซอร์ถามให้เลือก “อัตโนมัติ” และจดจำตัวเลือกถ้ามี':'ใช้ “กล้องหน้า / กล้องหลัง” เป็นหลัก รายชื่อเลนส์รายตัวอยู่ในตัวเลือกขั้นสูง';
  const syncCameraName=()=>{const name=$('#cameraName').value.trim();localStorage.setItem('remoteCamName',name);if($('#mainCameraName'))$('#mainCameraName').textContent=name||'Remote Camera'};
  $('#cameraName').addEventListener('input',syncCameraName);syncCameraName();
}
function generateNewStreamId(){const id=`cam_${platformSlug()}_${shortId(8)}`;$('#streamId').value=id;if($('#streamIdView'))$('#streamIdView').value=id;localStorage.setItem('remoteCamStreamId',id);$('#cameraName').value=`${PLATFORM} ${id.slice(-4).toUpperCase()}`;localStorage.setItem('remoteCamName',$('#cameraName').value.trim());log(`สร้าง Device ID ใหม่อัตโนมัติ: ${id}`)}
function publisherLabel(){const name=($('#cameraName').value.trim()||$('#streamId').value).replace(/\|/g,' ');return `RCAM2|${DEVICE_ID}|${name}|${PLATFORM}|${BROWSER}`}

// Smooth Zoom v0.11.6
// Adds 0.5× / 1× smooth return presets when the camera capability range supports them.
// PWA browsers do not expose AVFoundation/Camera2 native ramping consistently.
// Strategy:
// 1) +/- buttons use a continuous velocity ramp.
// 2) The range slider is LIVE: it sends only the newest thumb position while dragging.
//    There is no queued "catch-up" after the finger is released.
// 3) Try fine fractional zoom values first; if a browser rejects them, fall back to
//    the hardware-reported step size.
let zoomState={
  min:1,max:1,step:.1,current:1,virtual:1,target:1,
  drive:0,velocity:0,coasting:false,timer:null,lastTick:0,
  applying:false,pending:null,fineUnsupported:false,supported:false
};
const ZOOM_TRAVEL_SECONDS={slow:40,normal:16,fast:7};
function zoomSpeedKey(){return $('#zoomSpeed')?.value||'slow'}
function zoomMaxSpeed(range){
  const seconds=ZOOM_TRAVEL_SECONDS[zoomSpeedKey()]||ZOOM_TRAVEL_SECONDS.normal;
  const floor=zoomSpeedKey()==='slow'?.05:zoomSpeedKey()==='fast'?.35:.14;
  const ceiling=zoomSpeedKey()==='slow'?.26:zoomSpeedKey()==='fast'?1.5:.70;
  return clamp(range/seconds,floor,ceiling);
}
function clamp(v,min,max){return Math.max(min,Math.min(max,v))}
function quantizeZoom(v){
  const {min,max,step}=zoomState; const st=Number(step)||.1;
  const n=min+Math.round((clamp(v,min,max)-min)/st)*st;
  return Number(clamp(n,min,max).toFixed(4));
}
function fineZoom(v){return Number(clamp(Number(v),zoomState.min,zoomState.max).toFixed(3))}
function updateZoomUi(v=zoomState.current){
  const readout=$('#zoomCurrent');
  if(readout)readout.textContent=`${Number(v).toFixed(2)}×`;
  const info=$('#zoomInfo');
  if(info)info.textContent=`ช่วง ${zoomState.min}× – ${zoomState.max}× • ความเร็ว ${zoomSpeedKey()==='slow'?'ช้า':zoomSpeedKey()==='fast'?'เร็ว':'ปกติ'} • กด − / + ค้างเพื่อซูม`;
}
function updateZoomPresetButtons(){
  const b05=$('#zoomPreset05'),b1=$('#zoomPreset1');
  const can=value=>zoomState.supported && value>=zoomState.min-0.001 && value<=zoomState.max+0.001;
  if(b05)b05.hidden=!can(0.5);
  if(b1)b1.hidden=!can(1);
}
function smoothZoomPreset(value){
  if(!zoomState.supported)return;
  // Preset buttons deliberately use the same slow ramp the user liked from press-and-hold zoom.
  if($('#zoomSpeed'))$('#zoomSpeed').value='slow';
  updateZoomUi();
  setSmoothZoomTarget(value,{speed:'slow'});
  log(`Zoom preset ${Number(value).toFixed(value<1?1:0)}× — ซูมสมูทแบบช้า`);
  sendTelemetry();
}
async function applyOneZoom(v,{fine=true}={}){
  const t=cameraStream?.getVideoTracks?.()[0];
  if(!t?.applyConstraints)return;
  const caps=t.getCapabilities?.(); if(!caps?.zoom)return;
  let next=fine&&!zoomState.fineUnsupported?fineZoom(v):quantizeZoom(v);
  if(Math.abs(next-zoomState.current)<.003)return;
  try{
    await t.applyConstraints({advanced:[{zoom:next}]});
  }catch(err){
    // Some Android/Safari builds report zoom.step=0.1 and reject finer values.
    // Fall back once, then remember it for this camera session.
    if(fine&&!zoomState.fineUnsupported){
      zoomState.fineUnsupported=true;
      next=quantizeZoom(v);
      if(Math.abs(next-zoomState.current)<.003)return;
      await t.applyConstraints({advanced:[{zoom:next}]});
    }else throw err;
  }
  const actual=Number(t.getSettings?.().zoom);
  zoomState.current=Number.isFinite(actual)?actual:next;
  // Keep virtual position independent while a smooth ramp is running.
  // This preserves sub-step accumulation even when the browser reports a coarse hardware step.
  updateZoomUi();
}
function queueZoomHardware(v,{fine=true}={}){
  // Coalesce aggressively: keep only the newest requested position. This prevents
  // the old slider positions from being replayed after the user lets go.
  zoomState.pending={value:clamp(Number(v),zoomState.min,zoomState.max),fine};
  if(zoomState.applying)return;
  zoomState.applying=true;
  (async()=>{
    try{
      while(zoomState.pending){
        const req=zoomState.pending;
        zoomState.pending=null;
        try{await applyOneZoom(req.value,{fine:req.fine})}catch(e){log(`Zoom apply error: ${e.message}`)}
      }
    }finally{zoomState.applying=false}
  })();
}
function ensureZoomLoop(){
  if(zoomState.timer)return;
  zoomState.lastTick=performance.now();
  zoomState.timer=setInterval(()=>{
    const now=performance.now();
    const dt=Math.min(.10,Math.max(.018,(now-zoomState.lastTick)/1000));
    zoomState.lastTick=now;
    const range=Math.max(.1,zoomState.max-zoomState.min);
    const maxSpeed=zoomMaxSpeed(range);
    const accel=Math.max(maxSpeed*1.7,.12);
    let desiredVelocity=0;
    if(zoomState.drive)desiredVelocity=zoomState.drive*maxSpeed;
    else if(zoomState.coasting)desiredVelocity=0;
    else{
      const delta=zoomState.target-zoomState.virtual;
      if(Math.abs(delta)>.003)desiredVelocity=clamp(delta*4,-maxSpeed,maxSpeed);
    }
    zoomState.velocity+=clamp(desiredVelocity-zoomState.velocity,-accel*dt,accel*dt);
    if(zoomState.coasting&&Math.abs(zoomState.velocity)<Math.max(maxSpeed*.05,.008)){
      zoomState.velocity=0;zoomState.coasting=false;zoomState.target=zoomState.virtual;return;
    }
    if(!zoomState.drive&&!zoomState.coasting&&Math.abs(zoomState.target-zoomState.virtual)<.004&&Math.abs(zoomState.velocity)<.01){
      zoomState.velocity=0;return;
    }
    let next=clamp(zoomState.virtual+zoomState.velocity*dt,zoomState.min,zoomState.max);
    if(!zoomState.drive&&!zoomState.coasting){
      const before=zoomState.target-zoomState.virtual,after=zoomState.target-next;
      if(before!==0&&Math.sign(before)!==Math.sign(after)){next=zoomState.target;zoomState.velocity=0}
    }
    if(next<=zoomState.min||next>=zoomState.max)zoomState.velocity=0;
    zoomState.virtual=next;
    queueZoomHardware(next,{fine:true});
  },33); // ~30 Hz target updates, with coalescing if applyConstraints is slower
}
function setSmoothZoomTarget(value,{speed}={}){
  if(speed&&$('#zoomSpeed'))$('#zoomSpeed').value=speed;
  zoomState.drive=0;zoomState.coasting=false;
  zoomState.target=clamp(Number(value),zoomState.min,zoomState.max);
  if(!Number.isFinite(zoomState.virtual))zoomState.virtual=zoomState.current;
  ensureZoomLoop();
}
function setZoomDrive(direction,{speed}={}){
  if(speed&&$('#zoomSpeed'))$('#zoomSpeed').value=speed;
  const dir=clamp(Number(direction)||0,-1,1);
  if(dir){zoomState.drive=dir;zoomState.coasting=false;zoomState.target=zoomState.virtual;}
  else{zoomState.drive=0;zoomState.coasting=true;zoomState.target=zoomState.virtual;}
  ensureZoomLoop();
}

const PRESETS={
  '1080_30':{w:1920,h:1080,fps:30,hint:'motion',label:'1080p / 30'},
  '1080_60':{w:1920,h:1080,fps:60,hint:'motion',label:'1080p / สูงสุด 60'},
  '720_60':{w:1280,h:720,fps:60,hint:'motion',label:'720p / สูงสุด 60'},
  '720_30':{w:1280,h:720,fps:30,hint:'motion',label:'720p / 30'},
  '1080_24_detail':{w:1920,h:1080,fps:24,hint:'detail',label:'1080p / 24 detail'}
};
function q(){return PRESETS[$('#quality').value]||PRESETS['1080_30']}
function idealVideoConstraints(extra={}){const {w,h,fps}=q();return {width:{ideal:w},height:{ideal:h},aspectRatio:{ideal:16/9},frameRate:{ideal:fps,max:fps},...extra}}
function strictVideoConstraints(extra={}){const {w,h,fps}=q();return {width:{exact:w},height:{exact:h},frameRate:{exact:fps},...extra}}

async function listDevices(){
  const ds=await navigator.mediaDevices.enumerateDevices();
  const cams=ds.filter(d=>d.kind==='videoinput');
  const sel=$('#deviceSelect');
  const activeId=cameraStream?.getVideoTracks?.()[0]?.getSettings?.().deviceId||'';
  sel.innerHTML='<option value="">อัตโนมัติ / ใช้หน้า-หลัง</option>';
  cams.forEach((d,i)=>{
    const o=document.createElement('option');o.value=d.deviceId;
    let label=(d.label||`Camera ${i+1}`).replace(/^camera\s*/i,'กล้อง ');
    o.textContent=`${i+1}. ${label}${d.deviceId===activeId?' • กำลังใช้':''}`;
    sel.appendChild(o)
  });
  if(explicitDeviceId && [...sel.options].some(o=>o.value===explicitDeviceId))sel.value=explicitDeviceId;
  else sel.value='';
  $('#statDevices').textContent=`${cams.length} กล้อง`;
}

async function ensureMic(){
  if(audioStream)return;
  audioStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
  $('#statMic').textContent='ON';log('เปิดไมโครโฟนแล้ว');
}

async function getCamera(constraints){
  // v0.8: หนึ่งการสั่งเปิด = getUserMedia หนึ่งครั้ง เพื่อลด Android/Samsung camera chooser เด้งซ้ำ
  return navigator.mediaDevices.getUserMedia({video:constraints,audio:false});
}

async function acquireCamera({facing=currentFacing,deviceId=''}={}){
  const target=deviceId?{deviceId:{exact:deviceId}}:{facingMode:{ideal:facing}};
  const constraints=idealVideoConstraints(target);
  log(`ขอกล้อง 1 ครั้ง: ${deviceId?'device ที่เลือก':facing==='user'?'กล้องหน้า':'กล้องหลัง'} / ${q().label}`);
  return getCamera(constraints);
}

function fpsCapabilityText(track){
  try{
    const c=track.getCapabilities?.();
    const f=c?.frameRate;
    if(!f)return 'Safari ไม่รายงาน';
    if(typeof f==='object' && f.min!=null && f.max!=null)return `${Math.round(f.min)}–${Math.round(f.max)} fps`;
    return String(f);
  }catch{return 'ไม่ทราบ'}
}

function startFrameMeter(){
  const myGeneration=++frameMeterGeneration;
  measuredCameraFps=0;
  $('#statMeasuredFps').textContent='กำลังวัด…';
  if(typeof video.requestVideoFrameCallback!=='function'){
    $('#statMeasuredFps').textContent='Safari รุ่นนี้วัดเฟรมจริงไม่ได้';
    return;
  }
  let frames=0, started=performance.now(), lastUpdate=started;
  const onFrame=(now)=>{
    if(myGeneration!==frameMeterGeneration)return;
    frames++;
    const elapsed=now-started;
    if(elapsed>=1800){
      measuredCameraFps=(frames*1000)/elapsed;
      $('#statMeasuredFps').textContent=`${measuredCameraFps.toFixed(1)} fps`;
      frames=0;started=now;lastUpdate=now;
    }
    video.requestVideoFrameCallback(onFrame);
  };
  video.requestVideoFrameCallback(onFrame);
}

function telemetrySnapshot(){
  const t=cameraStream?.getVideoTracks?.()[0];
  const st=t?.getSettings?.()||{};
  const preset=q();
  return {
    type:'remote-camera-telemetry',
    ts:Date.now(),
    requested:{width:preset.w,height:preset.h,fps:preset.fps,label:preset.label},
    actual:{width:st.width||0,height:st.height||0,fps:Number(st.frameRate||0),facingMode:st.facingMode||currentFacing},
    measuredFps:Number(measuredCameraFps||0),
    cameraLabel:t?.label||'',
    cameraName:$('#cameraName').value.trim()||$('#streamId').value.trim(),
    platform:PLATFORM,
    browser:BROWSER,
    deviceID:DEVICE_ID,
    streamID:normId($('#streamId').value.trim()),
    fpsCapability:fpsCapabilityText(t),
    publishing:!!isPublishing,
    presetKey:$('#quality').value,
    zoom:{min:zoomState.min,max:zoomState.max,step:zoomState.step,current:zoomState.current,speed:zoomSpeedKey()},
    smartProfile
  };
}

function sendTelemetry(){
  if(!vdo||!isPublishing)return;
  try{vdo.sendData(telemetrySnapshot())}catch{}
}

function startTelemetry(){
  if(telemetryTimer)clearInterval(telemetryTimer);
  telemetryTimer=setInterval(sendTelemetry,1500);
  setTimeout(sendTelemetry,350);
}

async function requestWakeLock(){
  if(!('wakeLock' in navigator)||wakeLockSentinel)return;
  try{
    wakeLockSentinel=await navigator.wakeLock.request('screen');
    wakeLockSentinel.addEventListener?.('release',()=>{wakeLockSentinel=null});
    log('Screen Wake Lock พร้อม — ป้องกันหน้าจอดับระหว่างส่งภาพ');
  }catch(e){log(`Wake Lock ใช้ไม่ได้: ${e.message}`)}
}
async function releaseWakeLock(){
  try{await wakeLockSentinel?.release?.()}catch{}
  wakeLockSentinel=null;
}
let fullscreenNoticeTimer=null;
function isStandaloneMode(){
  return !!(window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone===true);
}
function fullscreenElement(){return document.fullscreenElement||document.webkitFullscreenElement||null}
function showFullscreenNotice(text,ms=5200){
  const el=$('#fullscreenNotice');if(!el)return;
  el.textContent=text;el.hidden=false;
  if(fullscreenNoticeTimer)clearTimeout(fullscreenNoticeTimer);
  fullscreenNoticeTimer=setTimeout(()=>{el.hidden=true},ms);
}
function syncFullscreenUi(){
  const active=!!fullscreenElement()||isStandaloneMode();
  document.body.classList.toggle('fullscreen-active',!!fullscreenElement()||isStandaloneMode());
  const btn=$('#fullscreenBtn');if(!btn)return;
  btn.classList.toggle('is-active',active);
  btn.setAttribute('aria-label',fullscreenElement()?'ออกจากเต็มจอ':'เต็มจอ');
  btn.title=fullscreenElement()?'ออกจากเต็มจอ':(isStandaloneMode()?'เปิดแบบแอปแล้ว':'เต็มจอ');
}
async function toggleFullscreen(){
  try{
    if(fullscreenElement()){
      if(document.exitFullscreen)await document.exitFullscreen();
      else if(document.webkitExitFullscreen)await document.webkitExitFullscreen();
      return;
    }
    if(isStandaloneMode()){
      syncFullscreenUi();
      showFullscreenNotice('กำลังเปิดแบบแอปเต็มจออยู่แล้ว');
      return;
    }
    const root=document.documentElement;
    const request=root.requestFullscreen||root.webkitRequestFullscreen;
    if(request){
      try{await request.call(root,{navigationUI:'hide'})}
      catch{await request.call(root)}
      syncFullscreenUi();
      return;
    }
    // iPhone Safari commonly does not expose arbitrary-element Fullscreen API.
    // The reliable no-browser-chrome path is launching the installed PWA from Home Screen.
    showFullscreenNotice('iPhone Safari: หากต้องการซ่อนแถบ Browser ทั้งหมด ให้กด Share → เพิ่มไปยังหน้าจอโฮม แล้วเปิด Remote Camera จากไอคอนบนหน้าจอ');
  }catch(e){
    showFullscreenNotice(`เข้าโหมดเต็มจอไม่ได้: ${e?.message||e}`);
  }finally{setTimeout(syncFullscreenUi,80)}
}

function setScreenRest(active){
  const overlay=$('#screenRestOverlay');if(!overlay)return;
  overlay.hidden=!active;
  document.body.classList.toggle('screen-resting',active);
  if(restHintTimer){clearTimeout(restHintTimer);restHintTimer=null}
  if(active){
    overlay.classList.remove('quiet');
    restHintTimer=setTimeout(()=>overlay.classList.add('quiet'),2200);
    // Keep Wake Lock active: true OS screen-off commonly suspends Safari/PWA camera/WebRTC.
    if(isPublishing)requestWakeLock();
  }else overlay.classList.remove('quiet');
}

function cleanMessageText(v){return String(v??'').replace(/\s+/g,' ').trim().slice(0,300)}
function pruneProcessedMessages(){
  const now=Date.now();for(const [k,t] of processedMessageIds){if(now-t>30000)processedMessageIds.delete(k)}
}
function renderSenderMessages(){
  const box=$('#senderMessageHistory');if(!box)return;
  box.innerHTML='';
  if(!senderMessages.length){const e=document.createElement('div');e.className='sender-message-empty';e.textContent='ยังไม่มีข้อความ';box.appendChild(e);return}
  senderMessages.slice(-60).forEach(m=>{
    const row=document.createElement('div');row.className=`sender-msg ${m.mine?'from-me':'from-control'}`;
    const status=m.mine&&m.status?` • ${m.status}`:'';
    const meta=document.createElement('div');meta.className='sender-msg-meta';meta.textContent=`${m.mine?'เรา':'Control'} • ${new Date(m.ts).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})}${status}`;
    const text=document.createElement('div');text.textContent=m.text;row.append(meta,text);box.appendChild(row);
  });
  box.scrollTop=box.scrollHeight;
}
function addSenderMessage(text,{mine=false,ts=Date.now(),messageId='',status=''}={}){
  text=cleanMessageText(text);if(!text)return;
  senderMessages.push({text,mine,ts,messageId,status});if(senderMessages.length>80)senderMessages.splice(0,senderMessages.length-80);renderSenderMessages();
}
function updateSenderMessageStatus(messageId,status){
  if(!messageId)return;
  const m=[...senderMessages].reverse().find(x=>x.messageId===messageId&&x.mine);
  if(m){m.status=status;renderSenderMessages()}
}
function showIncomingMessage(text){
  text=cleanMessageText(text);if(!text)return;
  const toast=$('#incomingMessageToast'),el=$('#incomingMessageText');if(!toast||!el)return;
  el.textContent=text;toast.hidden=false;
  if(messageToastTimer)clearTimeout(messageToastTimer);
  messageToastTimer=setTimeout(()=>{toast.hidden=true},9000);
  try{navigator.vibrate?.([120,70,120])}catch{}
}
function sendMessageAckToControl(d){
  if(!vdo||!d?.messageId)return;
  const ack={
    type:'remote-camera-message-ack',
    messageId:d.messageId,
    targetRole:'control',
    streamID:normId($('#streamId').value),
    deviceID:DEVICE_ID,
    cameraName:$('#cameraName').value.trim()||$('#streamId').value,
    ts:Date.now()
  };
  try{vdo.sendData(ack)}catch{}
}
function handleIncomingControlMessage(d){
  if(d?.targetRole&&d.targetRole!=='sender')return;
  const myStream=normId($('#streamId').value);
  if(d?.targetStream&&normId(d.targetStream)!==myStream)return;
  const text=cleanMessageText(d?.text);if(!text)return;
  const messageId=String(d?.messageId||'');
  pruneProcessedMessages();
  if(messageId&&processedMessageIds.has(messageId)){sendMessageAckToControl(d);return}
  if(messageId)processedMessageIds.set(messageId,Date.now());
  addSenderMessage(text,{mine:false,ts:Number(d.ts)||Date.now(),messageId});
  showIncomingMessage(text);log(`ข้อความจาก Control: ${text}`);
  sendMessageAckToControl(d);
}
function handleSenderMessageAck(d){
  if(d?.targetRole&&d.targetRole!=='sender')return;
  const myStream=normId($('#streamId').value);
  if(d?.targetStream&&normId(d.targetStream)!==myStream)return;
  const messageId=String(d?.messageId||'');if(!messageId)return;
  const pending=pendingSenderMessageAcks.get(messageId);if(!pending)return;
  clearTimeout(pending.retryTimer);clearTimeout(pending.failTimer);pendingSenderMessageAcks.delete(messageId);
  updateSenderMessageStatus(messageId,'ส่งถึงแล้ว');
}
function sendSenderMessage(text){
  text=cleanMessageText(text);if(!text)return false;
  if(!vdo||!isPublishing){log('ส่งข้อความไม่ได้: ยังไม่ได้เริ่มส่งภาพ');return false}
  const messageId=nextSenderMessageId();
  const payload={
    type:'remote-camera-message',
    messageId,
    targetRole:'control',
    from:'sender',
    text,
    ts:Date.now(),
    streamID:normId($('#streamId').value),
    deviceID:DEVICE_ID,
    cameraName:$('#cameraName').value.trim()||$('#streamId').value
  };
  try{
    vdo.sendData(payload);
    addSenderMessage(text,{mine:true,ts:payload.ts,messageId,status:'กำลังส่ง…'});
    const pending={payload,retryTimer:null,failTimer:null};
    pendingSenderMessageAcks.set(messageId,pending);
    pending.retryTimer=setTimeout(()=>{
      if(!pendingSenderMessageAcks.has(messageId))return;
      try{vdo?.sendData(payload);updateSenderMessageStatus(messageId,'กำลังส่งซ้ำ…')}catch{}
    },700);
    pending.failTimer=setTimeout(()=>{
      if(!pendingSenderMessageAcks.has(messageId))return;
      pendingSenderMessageAcks.delete(messageId);
      updateSenderMessageStatus(messageId,'ยังไม่ยืนยัน');
    },2600);
    return true;
  }catch(e){log(`ส่งข้อความไม่สำเร็จ: ${e.message}`);return false}
}

function updateCameraStatus(track){
  const s=track.getSettings(),{w,h,fps,hint}=q();
  const sw=s.width||video.videoWidth||0,sh=s.height||video.videoHeight||0,sf=Number(s.frameRate||0);
  $('#statRequested').textContent=`${w}×${h} @≤${fps}`;
  $('#statCamera').textContent=`${sw||'?'}×${sh||'?'} @${sf?sf.toFixed(sf%1?1:0):'?'}`;
  $('#statFpsCap').textContent=fpsCapabilityText(track);
  $('#statOutput').textContent=`Direct ${sw||'?'}×${sh||'?'} track`;
  $('#statHint').textContent=hint;
  $('#camBadge').textContent=track.label||currentFacing;
  const landscape=sw>=sh;
  $('#statSharp').textContent=landscape?'แนวนอน ✓':'แนวตั้ง — หมุนมือถือ';
  $('#statSharp').className=landscape?'goodtext':'warntext';
  if(!landscape)log(`⚠ กล้องรายงาน ${sw}×${sh} แนวตั้ง — งาน OBS 16:9 แนะนำหมุนมือถือแนวนอน`);
  if(sf && sf < fps-5) log(`⚠ Requested สูงสุด ${fps}fps แต่ Camera settings ให้ประมาณ ${sf.toFixed(1)}fps`);
}

async function configureZoom(track){
  const caps=track.getCapabilities?track.getCapabilities():{};
  const supported=!!caps.zoom;
  zoomState.supported=supported;
  $('#zoomOutBtn').hidden=!supported;
  $('#zoomInBtn').hidden=!supported;
  $('#zoomPanel').hidden=!supported;
  if($('#zoomPresetFloat'))$('#zoomPresetFloat').hidden=!supported;
  $('#zoomUnsupported').hidden=supported;
  if(supported){
    const current=Number(track.getSettings().zoom||caps.zoom.min);
    zoomState.min=Number(caps.zoom.min);zoomState.max=Number(caps.zoom.max);zoomState.step=Number(caps.zoom.step||0.1);zoomState.current=current;zoomState.virtual=current;zoomState.target=current;zoomState.drive=0;zoomState.velocity=0;zoomState.coasting=false;zoomState.pending=null;zoomState.fineUnsupported=false;zoomState.supported=true;
    if($('#zoomSpeed'))$('#zoomSpeed').value='slow';
    updateZoomUi(current);updateZoomPresetButtons();ensureZoomLoop();
    log(`Zoom API พร้อม: ${zoomState.min}×–${zoomState.max}× • ค่าเริ่มต้นช้า • มีปุ่มระยะลัดตามช่วงที่รองรับ`);
  }else{
    zoomState={...zoomState,min:1,max:1,step:.1,current:1,virtual:1,target:1,drive:0,velocity:0,coasting:false,pending:null,fineUnsupported:false,supported:false};
    updateZoomPresetButtons();
    log(`Zoom API ไม่พร้อมบน ${PLATFORM}/${BROWSER} — ซ่อนปุ่ม Zoom`);
  }
}

async function openCamera({facing=currentFacing,deviceId=''}={}){
  if(openingCamera)return;
  if(!navigator.mediaDevices?.getUserMedia)throw new Error('เบราว์เซอร์ไม่รองรับ getUserMedia');
  openingCamera=true;
  const oldStream=cameraStream;
  const oldTrack=oldStream?.getVideoTracks?.()[0]||null;
  let nextStream=null;
  currentFacing=facing;
  if(deviceId)explicitDeviceId=deviceId;
  else explicitDeviceId='';
  try{
    if(IS_ANDROID && oldTrack){
      // Android หลาย browser เปิดกล้องตัวใหม่พร้อมตัวเดิมไม่ได้ และอาจทำ chooser เด้งรอบสอง
      // ปล่อย track เดิมก่อน แล้วขอ track ใหม่เพียงครั้งเดียว
      oldTrack.stop();
      await sleep(90);
      nextStream=await acquireCamera({facing,deviceId});
    }else{
      try{
        nextStream=await acquireCamera({facing,deviceId});
      }catch(firstErr){
        if(!oldTrack)throw firstErr;
        // iOS บางรุ่นต้องปล่อยกล้องเดิมก่อน แต่ retry นี้เกิดเฉพาะเมื่อ hardware เปิดพร้อมกันไม่ได้
        log(`เปิดกล้องใหม่พร้อม track เดิมไม่ได้ (${firstErr.name}) — ปล่อยกล้องเดิมแล้วลองอีกครั้ง`);
        oldTrack.stop();await sleep(120);
        nextStream=await acquireCamera({facing,deviceId});
      }
    }
    const nextTrack=nextStream.getVideoTracks()[0];
    try{nextTrack.contentHint=q().hint}catch{}

    if(isPublishing&&vdo&&oldTrack){
      try{
        await vdo.replaceTrack(oldTrack,nextTrack);
        if(outStream){try{outStream.removeTrack(oldTrack)}catch{};if(!outStream.getVideoTracks().includes(nextTrack))outStream.addTrack(nextTrack)}
        log('✓ replaceTrack สำเร็จ — WebRTC connection เดิมยังอยู่');
      }catch(e){
        nextStream.getTracks().forEach(t=>t.stop());
        throw new Error(`สลับ WebRTC track ไม่สำเร็จ: ${e.message}`);
      }
    }

    cameraStream=nextStream;updateSimpleStatus();
    video.srcObject=nextStream;await video.play();
    startFrameMeter();updateCameraStatus(nextTrack);await configureZoom(nextTrack);await listDevices();
    if(oldStream&&oldStream!==nextStream){oldStream.getTracks().forEach(t=>{if(t!==oldTrack||t.readyState!=='ended')try{t.stop()}catch{}})}
    log(`เปิดกล้อง: ${nextTrack.label||facing} / ${PLATFORM} / hint=${q().hint}`);
    return nextTrack;
  }finally{openingCamera=false}
}

async function setZoom(value){
  // Backward-compatible command: a requested value becomes a smooth target, not an instant jump.
  setSmoothZoomTarget(value);
}

async function setQualityPreset(value,reason='Remote'){
  if(!PRESETS[value])throw new Error(`ไม่พบ preset ${value}`);
  if($('#quality').value===value){smartProfile=reason;$('#statSmartProfile').textContent=smartProfile;sendTelemetry();return}
  $('#quality').value=value;
  smartProfile=reason;
  $('#statSmartProfile').textContent=smartProfile;
  log(`${reason} → ${q().label}`);
  if(cameraStream)await openCamera({facing:currentFacing,deviceId:explicitDeviceId});
  sendTelemetry();
}

async function buildOutStream(){
  if(!cameraStream)await openCamera({facing:currentFacing});
  await ensureMic();
  const vt=cameraStream.getVideoTracks()[0];
  try{vt.contentHint=q().hint}catch{}
  outStream=new MediaStream([vt,...audioStream.getAudioTracks()]);
  const s=vt.getSettings();
  log(`Output ใช้ Camera Track โดยตรง ${s.width||'?'}×${s.height||'?'} @${Math.round(s.frameRate||0)||'?'} / hint=${q().hint}`);
  return outStream;
}

function updatePeerCount(){ $('#statPeers').textContent=String(peerIds.size); }

async function startPublishing(){
  if(isPublishing)return;
  $('#statRtc').textContent='กำลังโหลด SDK…';
  await loadVDONinjaSDK(({index,total})=>{ $('#statRtc').textContent=`โหลด SDK ${index}/${total}`; log(`กำลังโหลด WebRTC SDK (${index}/${total})`); });
  log(`VDO.Ninja SDK พร้อมใช้งาน v${window.VDONinjaSDK?.VERSION || '?'}`);
  if(!cameraStream)await openCamera({facing:currentFacing});
  const stream=await buildOutStream(),room=$('#room').value.trim(),streamID=normId($('#streamId').value.trim());
  $('#streamId').value=streamID;localStorage.setItem('remoteCamStreamId',streamID);
  if(!room||!streamID)throw new Error('กรุณาระบุ Room และ Stream ID');
  vdo=new VDONinjaSDK({autoRecover:true,autoRelay:true,salt:'vdo.ninja'});
  vdo.addEventListener('connected',()=>{$('#statRtc').textContent='signaling connected';log('เชื่อม signaling แล้ว')});
  vdo.addEventListener('publishing',()=>{isPublishing=true;$('#liveBadge').textContent='LIVE';updateSimpleStatus();$('#liveBadge').classList.add('ok');$('#statRtc').textContent='PUBLISHING';log('เริ่มส่ง WebRTC แล้ว');startTelemetry();requestWakeLock()});
  vdo.addEventListener('peerConnected',e=>{const id=e.detail?.uuid;if(id){peerIds.add(id);updatePeerCount();log(`Viewer connected (${peerIds.size})`);setTimeout(sendTelemetry,250)}});
  vdo.addEventListener('peerDisconnected',e=>{const id=e.detail?.uuid;if(id){peerIds.delete(id);updatePeerCount();log(`Viewer disconnected (${peerIds.size})`)}});
  vdo.addEventListener('connectionRecovered',()=>log('WebRTC recovered'));
  vdo.addEventListener('connectionFailed',()=>log('WebRTC connection failed'));
  const onData=e=>{const d=e.detail?.data??e.detail??e.data;const uuid=e.detail?.uuid??e.uuid??'';if(d&&typeof d==='object')handleRemote(d,uuid)};vdo.addEventListener('dataReceived',onData);
  await vdo.connect();await vdo.joinRoom({room});await vdo.publish(stream,{room,streamID,label:publisherLabel()});
  isPublishing=true;$('#liveBadge').textContent='LIVE';updateSimpleStatus();$('#liveBadge').classList.add('ok');$('#statRtc').textContent='PUBLISHING';startTelemetry();requestWakeLock();
}


function pruneProcessedCommands(){
  const now=Date.now();for(const [k,t] of processedRemoteCommands){if(now-t>15000)processedRemoteCommands.delete(k)}
}
function sendRemoteAck(d,sourceUuid,{ok=true,message=''}={}){
  if(!vdo||!d?.commandId)return;
  const ack={type:'remote-camera-ack',commandId:d.commandId,command:d.command,ok,message,ts:Date.now(),streamID:normId($('#streamId').value),deviceID:DEVICE_ID,currentFacing,zoomCurrent:zoomState.current};
  try{
    if(sourceUuid)vdo.sendData(ack,{uuid:sourceUuid,allowFallback:true,preference:'any'});
    else vdo.sendData(ack);
  }catch{try{vdo.sendData(ack)}catch{}}
}

async function handleRemote(d,sourceUuid=''){
  if(d?.type==='remote-camera-message'){handleIncomingControlMessage(d);return}
  if(d?.type==='remote-camera-message-ack'){handleSenderMessageAck(d);return}
  if(d?.type==='remote-camera-discover'){if(!d.targetStream||normId(d.targetStream)===normId($('#streamId').value))sendTelemetry();return}
  if(d?.type!=='remote-camera')return;
  if(d.targetStream && normId(d.targetStream)!==normId($('#streamId').value))return;
  pruneProcessedCommands();
  if(d.commandId&&processedRemoteCommands.has(d.commandId)){sendRemoteAck(d,sourceUuid,{ok:true,message:'duplicate acknowledged'});return}
  if(d.commandId)processedRemoteCommands.set(d.commandId,Date.now());
  else {if(d.ts&&d.ts===lastRemoteTs)return;if(d.ts)lastRemoteTs=d.ts}
  $('#statRemote').textContent=`คำสั่ง: ${d.command}`;log(`Remote: ${d.command}`);
  try{
    let known=true;
    if(d.command==='front')await openCamera({facing:'user'});
    else if(d.command==='rear')await openCamera({facing:'environment'});
    else if(d.command==='zoom'||d.command==='zoomTarget')setSmoothZoomTarget(d.value,{speed:d.speed});
    else if(d.command==='zoomDrive')setZoomDrive(d.direction,{speed:d.speed});
    else if(d.command==='zoomStop')setZoomDrive(0,{speed:d.speed});
    else if(d.command==='device'&&d.deviceId)await openCamera({deviceId:d.deviceId});
    else if(d.command==='quality'&&d.value)await setQualityPreset(d.value,d.reason||'Remote quality');
    else known=false;
    if(!known)throw new Error(`ไม่รู้จักคำสั่ง ${d.command}`);
    sendRemoteAck(d,sourceUuid,{ok:true});
    setTimeout(sendTelemetry,80);
  }catch(e){log(`Remote error: ${e.message}`);sendRemoteAck(d,sourceUuid,{ok:false,message:e.message})}
}
async function stopAll(){
  try{if(vdo){await vdo.stopPublishing?.();await vdo.disconnect?.()}}catch{}
  isPublishing=false;peerIds.clear();updatePeerCount();
  if(telemetryTimer){clearInterval(telemetryTimer);telemetryTimer=null}
  if(zoomState.timer){clearInterval(zoomState.timer);zoomState.timer=null}
  zoomState.drive=0;zoomState.velocity=0;zoomState.coasting=false;zoomState.virtual=zoomState.current;
  frameMeterGeneration++;measuredCameraFps=0;
  if(cameraStream){cameraStream.getTracks().forEach(t=>t.stop());cameraStream=null}
  if(audioStream){audioStream.getTracks().forEach(t=>t.stop());audioStream=null}
  outStream=null;
  video.srcObject=null;
  setScreenRest(false);releaseWakeLock();
  $('#liveBadge').textContent='OFFLINE';updateSimpleStatus();$('#liveBadge').classList.remove('ok');$('#statRtc').textContent='OFFLINE';$('#statMic').textContent='-';log('หยุดทั้งหมด')
}

$('#startCamera').onclick=()=>openCamera({facing:currentFacing}).catch(e=>log(`Camera error: ${e.message}`));
$('#startSend').onclick=()=>startPublishing().catch(e=>log(`Publish error: ${e.message}`));
$('#stopBtn').onclick=()=>stopAll();
$('#sendToggleBtn').onclick=async()=>{
  const btn=$('#sendToggleBtn');if(btn?.dataset.busy==='1')return;btn.dataset.busy='1';
  try{if(isPublishing)await stopAll();else{if(!cameraStream)await openCamera({facing:currentFacing});await startPublishing()}}
  catch(e){log(`Send toggle error: ${e.message}`)}finally{delete btn.dataset.busy;updateSimpleStatus()}
};
$('#frontBtn').onclick=()=>openCamera({facing:'user'}).catch(e=>log(`Switch error: ${e.message}`));
$('#rearBtn').onclick=()=>openCamera({facing:'environment'}).catch(e=>log(`Switch error: ${e.message}`));
$('#deviceSelect').onchange=()=>{log('เลือกกล้องขั้นสูงแล้ว — ยังไม่สลับจนกว่าจะกด “ใช้กล้องที่เลือก”')};
$('#applyDeviceBtn').onclick=()=>{const id=$('#deviceSelect').value;if(!id){explicitDeviceId='';log('กลับเป็นโหมดอัตโนมัติ/หน้า-หลัง');return}openCamera({deviceId:id,facing:currentFacing}).catch(x=>log(`Device error: ${x.message}`))};
$('#zoomSpeed').onchange=()=>{updateZoomUi();sendTelemetry()};
$('#zoomPreset05').onclick=()=>smoothZoomPreset(0.5);
$('#zoomPreset1').onclick=()=>smoothZoomPreset(1);
function bindHoldZoom(btn,dir){
  let activePointer=null;
  const block=e=>{e.preventDefault();e.stopPropagation();};
  const start=e=>{
    block(e);
    if(!zoomState.supported)return;
    activePointer=e.pointerId ?? 'mouse';
    try{if(e.pointerId!=null)btn.setPointerCapture(e.pointerId)}catch{}
    btn.classList.add('holding');
    setZoomDrive(dir);
  };
  const stop=e=>{
    if(e){e.preventDefault();e.stopPropagation()}
    if(activePointer===null)return;
    try{if(e?.pointerId!=null && btn.hasPointerCapture?.(e.pointerId))btn.releasePointerCapture(e.pointerId)}catch{}
    activePointer=null;
    btn.classList.remove('holding');
    setZoomDrive(0);
  };
  btn.addEventListener('pointerdown',start);
  btn.addEventListener('pointerup',stop);
  btn.addEventListener('pointercancel',stop);
  btn.addEventListener('lostpointercapture',()=>{if(activePointer!==null)stop()});
  ['contextmenu','selectstart','dragstart'].forEach(type=>btn.addEventListener(type,block));
}
bindHoldZoom($('#zoomOutBtn'),-1);bindHoldZoom($('#zoomInBtn'),1);
$('#quality').onchange=async()=>{
  smartProfile='Manual';$('#statSmartProfile').textContent=smartProfile;
  log(`เปลี่ยนคุณภาพเป็น ${q().label} / hint=${q().hint}`);
  if(cameraStream){try{await openCamera({facing:currentFacing,deviceId:explicitDeviceId})}catch(e){log(`Quality switch error: ${e.message}`)}}
};
function openSheet(id){const el=$(id);if(el){el.hidden=false;document.body.style.overflow='hidden'}}
function closeSheets(){['#settingsSheet','#messageSheet'].forEach(id=>{const el=$(id);if(el)el.hidden=true});document.body.style.overflow=''}
$('#fullscreenBtn').onclick=()=>toggleFullscreen();
$('#settingsOpenBtn').onclick=()=>openSheet('#settingsSheet');
$('#messageOpenBtn').onclick=()=>openSheet('#messageSheet');
document.querySelectorAll('[data-close-settings],[data-close-message]').forEach(el=>el.addEventListener('click',closeSheets));
$('#screenRestBtn').onclick=()=>setScreenRest(true);
$('#screenRestOverlay').addEventListener('click',()=>setScreenRest(false));
$('#incomingMessageToast').addEventListener('click',()=>openSheet('#messageSheet'));
$('#senderMessageSend').onclick=()=>{const input=$('#senderMessageInput');if(sendSenderMessage(input.value)){input.value=''}};
$('#senderMessageInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('#senderMessageSend').click()}});
document.querySelectorAll('[data-quick-reply]').forEach(btn=>btn.addEventListener('click',()=>{if(sendSenderMessage(btn.dataset.quickReply||''))closeSheets()}));
document.addEventListener('fullscreenchange',syncFullscreenUi);
document.addEventListener('webkitfullscreenchange',syncFullscreenUi);
window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change',syncFullscreenUi);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&isPublishing)requestWakeLock()});
window.addEventListener('beforeunload',()=>stopAll());
if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js?v=0116').catch(()=>{});
$('#statHint').textContent=q().hint;
$('#statSmartProfile').textContent=smartProfile;
initIdentity();updateSimpleStatus();syncFullscreenUi();
$('#newStreamId').onclick=generateNewStreamId;
log(`v0.11.6 พร้อมใช้งาน — Message Core v0.11.2 • ${PLATFORM}/${BROWSER}, Stream ${$('#streamId').value}, Device ${DEVICE_ID}`);
