const $=s=>document.querySelector(s); const logEl=$('#log');
function log(m){const t=new Date().toLocaleTimeString();logEl.textContent+=`[${t}] ${m}\n`;logEl.scrollTop=logEl.scrollHeight}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let cameraStream=null,audioStream=null,outStream=null,vdo=null,currentFacing='environment',isPublishing=false,lastRemoteTs=0;
let explicitDeviceId='', openingCamera=false;
let peerIds=new Set();
let measuredCameraFps=0, frameMeterGeneration=0, telemetryTimer=null;
let smartProfile='ปกติ';
const video=$('#cameraVideo');
const UA=navigator.userAgent||'';
const IS_ANDROID=/Android/i.test(UA);
const IS_IOS=/iPhone|iPad|iPod/i.test(UA) || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1);
const IS_SAMSUNG=/SamsungBrowser/i.test(UA);
const PLATFORM=IS_ANDROID?'Android':IS_IOS?'iOS':'Browser';
const BROWSER=IS_SAMSUNG?'Samsung Internet':/CriOS|Chrome/i.test(UA)?'Chrome':/Safari/i.test(UA)?'Safari':'Web Browser';
function shortId(){try{return crypto.randomUUID().replace(/-/g,'').slice(0,4)}catch{return Math.random().toString(36).slice(2,6)}}
function normId(v){return String(v||'').trim().replace(/[^\w]/g,'_')}
function initIdentity(){
  const savedRoom=localStorage.getItem('remoteCamRoom');
  const savedStream=localStorage.getItem('remoteCamStreamId');
  const savedName=localStorage.getItem('remoteCamName');
  const id=normId(savedStream||`cam_${shortId()}`);
  $('#room').value=savedRoom||'remote-cam-test';
  $('#streamId').value=id;
  $('#cameraName').value=savedName||`${PLATFORM} ${id.slice(-4).toUpperCase()}`;
  $('#platformBadge').textContent=`${PLATFORM} • ${BROWSER}`;
  $('#statPlatform').textContent=`${PLATFORM} / ${BROWSER}`;
  $('#cameraHelp').textContent=IS_ANDROID?'Android: ใช้ “กล้องหน้า / กล้องหลัง” เป็นหลัก ครั้งแรกถ้าเบราว์เซอร์ถามให้เลือก “อัตโนมัติ” และจดจำตัวเลือกถ้ามี':'ใช้ “กล้องหน้า / กล้องหลัง” เป็นหลัก รายชื่อเลนส์รายตัวอยู่ในตัวเลือกขั้นสูง';
  ['room','streamId','cameraName'].forEach(id=>$('#'+id).addEventListener('input',()=>{
    localStorage.setItem('remoteCamRoom',$('#room').value.trim());
    localStorage.setItem('remoteCamStreamId',$('#streamId').value.trim());
    localStorage.setItem('remoteCamName',$('#cameraName').value.trim());
  }));
}
function generateNewStreamId(){const id=`cam_${shortId()}`;$('#streamId').value=id;localStorage.setItem('remoteCamStreamId',id);if(!$('#cameraName').value.trim()||/^((iOS|Android|Browser) )[A-Z0-9]{4}$/.test($('#cameraName').value.trim())){$('#cameraName').value=`${PLATFORM} ${id.slice(-4).toUpperCase()}`;localStorage.setItem('remoteCamName',$('#cameraName').value.trim())}log(`สร้าง Stream ID ใหม่: ${id}`)}

// Smooth Zoom: Safari/PWA does not expose AVFoundation's native zoom ramp,
// so we emulate a camera-like ramp by applying many small hardware-zoom steps.
let zoomState={min:1,max:1,step:.1,current:1,target:1,drive:0,velocity:0,coasting:false,applying:false,timer:null,lastTick:0};
const ZOOM_SPEEDS={slow:.10,normal:.20,fast:.34}; // fraction of the available zoom range / second
function zoomSpeedKey(){return $('#zoomSpeed')?.value||'normal'}
function zoomSpeedRatio(){return ZOOM_SPEEDS[zoomSpeedKey()]||ZOOM_SPEEDS.normal}
function clamp(v,min,max){return Math.max(min,Math.min(max,v))}
function quantizeZoom(v){
  const {min,max,step}=zoomState; const st=Number(step)||.1;
  const n=min+Math.round((clamp(v,min,max)-min)/st)*st;
  return Number(clamp(n,min,max).toFixed(4));
}
function updateZoomUi(v=zoomState.current){
  const z=$('#zoomRange'); if(z&&!z.disabled)z.value=String(v);
  const info=$('#zoomInfo'); if(info)info.textContent=`Zoom ${zoomState.min} – ${zoomState.max} • ตอนนี้ ${Number(v).toFixed(2)}× • ${zoomSpeedKey()==='slow'?'ช้า':zoomSpeedKey()==='fast'?'เร็ว':'ปกติ'}`;
}
async function applyZoomHardware(v){
  const t=cameraStream?.getVideoTracks?.()[0];
  if(!t?.applyConstraints || zoomState.applying)return;
  const caps=t.getCapabilities?.(); if(!caps?.zoom)return;
  const next=quantizeZoom(v);
  if(Math.abs(next-zoomState.current)<Math.max((zoomState.step||.1)*.45,.005))return;
  zoomState.applying=true;
  try{
    await t.applyConstraints({advanced:[{zoom:next}]});
    const actual=Number(t.getSettings?.().zoom);
    zoomState.current=Number.isFinite(actual)?actual:next;
    updateZoomUi();
  }finally{zoomState.applying=false}
}
function ensureZoomLoop(){
  if(zoomState.timer)return;
  zoomState.lastTick=performance.now();
  zoomState.timer=setInterval(async()=>{
    const now=performance.now(); const dt=Math.min(.12,Math.max(.02,(now-zoomState.lastTick)/1000)); zoomState.lastTick=now;
    const range=Math.max(.1,zoomState.max-zoomState.min);
    const maxSpeed=range*zoomSpeedRatio();
    const accel=maxSpeed*5.0;
    let desiredVelocity=0;
    if(zoomState.drive){
      desiredVelocity=zoomState.drive*maxSpeed;
    }else if(zoomState.coasting){
      desiredVelocity=0;
    }else{
      const delta=zoomState.target-zoomState.current;
      if(Math.abs(delta)>Math.max((zoomState.step||.1)*.55,.01)){
        // proportional target tracking: naturally slows as it approaches the requested zoom
        desiredVelocity=clamp(delta*3.2,-maxSpeed,maxSpeed);
      }
    }
    const dv=clamp(desiredVelocity-zoomState.velocity,-accel*dt,accel*dt);
    zoomState.velocity+=dv;
    if(zoomState.coasting && Math.abs(zoomState.velocity)<maxSpeed*.08){
      zoomState.velocity=0;zoomState.coasting=false;zoomState.target=zoomState.current;return;
    }
    if(!zoomState.drive && !zoomState.coasting && Math.abs(zoomState.target-zoomState.current)<=Math.max((zoomState.step||.1)*.55,.01) && Math.abs(zoomState.velocity)<maxSpeed*.08){
      zoomState.velocity=0; zoomState.target=zoomState.current; return;
    }
    let next=zoomState.current+zoomState.velocity*dt;
    if(!zoomState.drive && !zoomState.coasting){
      const before=zoomState.target-zoomState.current, after=zoomState.target-next;
      if(before!==0 && Math.sign(before)!==Math.sign(after)){next=zoomState.target;zoomState.velocity=0}
    }
    if(next<=zoomState.min || next>=zoomState.max){zoomState.velocity=0}
    await applyZoomHardware(clamp(next,zoomState.min,zoomState.max));
  },40); // ~25 updates/s; smooth without flooding iOS applyConstraints
}
function setSmoothZoomTarget(value,{speed}={}){
  if(speed && $('#zoomSpeed'))$('#zoomSpeed').value=speed;
  zoomState.drive=0;zoomState.coasting=false; zoomState.target=clamp(Number(value),zoomState.min,zoomState.max); ensureZoomLoop();
}
function setZoomDrive(direction,{speed}={}){
  if(speed && $('#zoomSpeed'))$('#zoomSpeed').value=speed;
  const dir=clamp(Number(direction)||0,-1,1);
  if(dir){zoomState.drive=dir;zoomState.coasting=false;}
  else{zoomState.drive=0;zoomState.coasting=true;zoomState.target=zoomState.current;}
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
  const caps=track.getCapabilities?track.getCapabilities():{};const z=$('#zoomRange');
  if(caps.zoom){
    const current=Number(track.getSettings().zoom||caps.zoom.min);
    z.disabled=false;z.min=caps.zoom.min;z.max=caps.zoom.max;z.step=caps.zoom.step||0.1;z.value=current;
    zoomState.min=Number(caps.zoom.min);zoomState.max=Number(caps.zoom.max);zoomState.step=Number(caps.zoom.step||0.1);zoomState.current=current;zoomState.target=current;zoomState.drive=0;zoomState.velocity=0;zoomState.coasting=false;
    updateZoomUi(current);ensureZoomLoop();
  }else{
    z.disabled=true;z.min=1;z.max=1;z.value=1;zoomState={...zoomState,min:1,max:1,step:.1,current:1,target:1,drive:0,velocity:0,coasting:false};
    $('#zoomInfo').textContent='Safari/อุปกรณ์นี้ไม่เปิด Zoom API ให้เว็บ';
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

    cameraStream=nextStream;
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
  vdo.addEventListener('publishing',()=>{isPublishing=true;$('#liveBadge').textContent='LIVE';$('#liveBadge').classList.add('ok');$('#statRtc').textContent='PUBLISHING';log('เริ่มส่ง WebRTC แล้ว');startTelemetry()});
  vdo.addEventListener('peerConnected',e=>{const id=e.detail?.uuid;if(id){peerIds.add(id);updatePeerCount();log(`Viewer connected (${peerIds.size})`);setTimeout(sendTelemetry,250)}});
  vdo.addEventListener('peerDisconnected',e=>{const id=e.detail?.uuid;if(id){peerIds.delete(id);updatePeerCount();log(`Viewer disconnected (${peerIds.size})`)}});
  vdo.addEventListener('connectionRecovered',()=>log('WebRTC recovered'));
  vdo.addEventListener('connectionFailed',()=>log('WebRTC connection failed'));
  const onData=e=>{const d=e.detail?.data??e.detail??e.data;if(d&&typeof d==='object')handleRemote(d)};vdo.addEventListener('dataReceived',onData);
  await vdo.connect();await vdo.joinRoom({room});await vdo.publish(stream,{room,streamID,label:streamID});
  isPublishing=true;$('#liveBadge').textContent='LIVE';$('#liveBadge').classList.add('ok');$('#statRtc').textContent='PUBLISHING';startTelemetry();
}

async function handleRemote(d){
  if(d.type!=='remote-camera')return;
  if(d.targetStream && normId(d.targetStream)!==normId($('#streamId').value))return;if(d.ts&&d.ts===lastRemoteTs)return;if(d.ts)lastRemoteTs=d.ts;
  $('#statRemote').textContent=`คำสั่ง: ${d.command}`;log(`Remote: ${d.command}`);
  try{
    if(d.command==='front')await openCamera({facing:'user'});
    if(d.command==='rear')await openCamera({facing:'environment'});
    if(d.command==='zoom'||d.command==='zoomTarget')setSmoothZoomTarget(d.value,{speed:d.speed});
    if(d.command==='zoomDrive')setZoomDrive(d.direction,{speed:d.speed});
    if(d.command==='zoomStop')setZoomDrive(0,{speed:d.speed});
    if(d.command==='device'&&d.deviceId)await openCamera({deviceId:d.deviceId});
    if(d.command==='quality'&&d.value)await setQualityPreset(d.value,d.reason||'Remote quality');
  }catch(e){log(`Remote error: ${e.message}`)}
}

async function stopAll(){
  try{if(vdo){await vdo.stopPublishing?.();await vdo.disconnect?.()}}catch{}
  isPublishing=false;peerIds.clear();updatePeerCount();
  if(telemetryTimer){clearInterval(telemetryTimer);telemetryTimer=null}
  if(zoomState.timer){clearInterval(zoomState.timer);zoomState.timer=null}
  zoomState.drive=0;zoomState.velocity=0;zoomState.coasting=false;
  frameMeterGeneration++;measuredCameraFps=0;
  if(cameraStream){cameraStream.getTracks().forEach(t=>t.stop());cameraStream=null}
  if(audioStream){audioStream.getTracks().forEach(t=>t.stop());audioStream=null}
  outStream=null;
  video.srcObject=null;
  $('#liveBadge').textContent='OFFLINE';$('#liveBadge').classList.remove('ok');$('#statRtc').textContent='OFFLINE';$('#statMic').textContent='-';log('หยุดทั้งหมด')
}

$('#startCamera').onclick=()=>openCamera({facing:currentFacing}).catch(e=>log(`Camera error: ${e.message}`));
$('#startSend').onclick=()=>startPublishing().catch(e=>log(`Publish error: ${e.message}`));
$('#stopBtn').onclick=()=>stopAll();
$('#frontBtn').onclick=()=>openCamera({facing:'user'}).catch(e=>log(`Switch error: ${e.message}`));
$('#rearBtn').onclick=()=>openCamera({facing:'environment'}).catch(e=>log(`Switch error: ${e.message}`));
$('#deviceSelect').onchange=()=>{log('เลือกกล้องขั้นสูงแล้ว — ยังไม่สลับจนกว่าจะกด “ใช้กล้องที่เลือก”')};
$('#applyDeviceBtn').onclick=()=>{const id=$('#deviceSelect').value;if(!id){explicitDeviceId='';log('กลับเป็นโหมดอัตโนมัติ/หน้า-หลัง');return}openCamera({deviceId:id,facing:currentFacing}).catch(x=>log(`Device error: ${x.message}`))};
$('#zoomRange').oninput=e=>setSmoothZoomTarget(e.target.value);
$('#zoomSpeed').onchange=()=>{updateZoomUi();sendTelemetry()};
function bindHoldZoom(btn,dir){
  const start=e=>{e.preventDefault();if($('#zoomRange').disabled)return;setZoomDrive(dir);};
  const stop=e=>{if(e)e.preventDefault();setZoomDrive(0);};
  btn.addEventListener('pointerdown',start);btn.addEventListener('pointerup',stop);btn.addEventListener('pointercancel',stop);btn.addEventListener('pointerleave',e=>{if(e.buttons)stop(e)});
  btn.addEventListener('contextmenu',e=>e.preventDefault());
}
bindHoldZoom($('#zoomOutBtn'),-1);bindHoldZoom($('#zoomInBtn'),1);
$('#quality').onchange=async()=>{
  smartProfile='Manual';$('#statSmartProfile').textContent=smartProfile;
  log(`เปลี่ยนคุณภาพเป็น ${q().label} / hint=${q().hint}`);
  if(cameraStream){try{await openCamera({facing:currentFacing,deviceId:explicitDeviceId})}catch(e){log(`Quality switch error: ${e.message}`)}}
};
window.addEventListener('beforeunload',()=>stopAll());
if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js?v=080').catch(()=>{});
$('#statHint').textContent=q().hint;
$('#statSmartProfile').textContent=smartProfile;
initIdentity();
$('#newStreamId').onclick=generateNewStreamId;
$('#streamId').addEventListener('change',()=>{$('#streamId').value=normId($('#streamId').value);localStorage.setItem('remoteCamStreamId',$('#streamId').value)});
log(`v0.8 พร้อมใช้งาน — ${PLATFORM}/${BROWSER}, multi-camera identity และ Android camera flow ใหม่`);
