const $=s=>document.querySelector(s); const logEl=$('#log');
function log(m){const t=new Date().toLocaleTimeString();logEl.textContent+=`[${t}] ${m}\n`;logEl.scrollTop=logEl.scrollHeight}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let cameraStream=null,audioStream=null,outStream=null,vdo=null,currentFacing='environment',isPublishing=false,lastRemoteTs=0;
let peerIds=new Set();
const video=$('#cameraVideo');

const PRESETS={
  '1080_30':{w:1920,h:1080,fps:30,hint:'motion',label:'1080p / 30'},
  '1080_60':{w:1920,h:1080,fps:60,hint:'motion',label:'1080p / 60'},
  '720_60':{w:1280,h:720,fps:60,hint:'motion',label:'720p / 60'},
  '720_30':{w:1280,h:720,fps:30,hint:'motion',label:'720p / 30'},
  '1080_24_detail':{w:1920,h:1080,fps:24,hint:'detail',label:'1080p / 24 detail'}
};
function q(){return PRESETS[$('#quality').value]||PRESETS['1080_30']}
function idealVideoConstraints(extra={}){const {w,h,fps}=q();return {width:{ideal:w},height:{ideal:h},aspectRatio:{ideal:16/9},frameRate:{ideal:fps,max:fps},...extra}}
function strictVideoConstraints(extra={}){const {w,h,fps}=q();return {width:{exact:w},height:{exact:h},frameRate:{exact:fps},...extra}}

async function listDevices(){
  const ds=await navigator.mediaDevices.enumerateDevices();
  const cams=ds.filter(d=>d.kind==='videoinput');
  const sel=$('#deviceSelect'),old=sel.value;
  sel.innerHTML='<option value="">อัตโนมัติ</option>';
  cams.forEach((d,i)=>{const o=document.createElement('option');o.value=d.deviceId;o.textContent=d.label||`Camera ${i+1}`;sel.appendChild(o)});
  if([...sel.options].some(o=>o.value===old))sel.value=old;
  $('#statDevices').textContent=`${cams.length} กล้อง`;
}

async function ensureMic(){
  if(audioStream)return;
  audioStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
  $('#statMic').textContent='ON';log('เปิดไมโครโฟนแล้ว');
}

async function getCamera(vcStrict,vcFallback){
  try{
    const s=await navigator.mediaDevices.getUserMedia({video:vcStrict,audio:false});
    log('ได้ความละเอียด/FPS กล้องตาม preset แบบตรงค่า');
    return s;
  }catch(e){
    log(`Exact capture ไม่สำเร็จ (${e.name}) — ใช้ค่าที่ใกล้ที่สุด`);
    return navigator.mediaDevices.getUserMedia({video:vcFallback,audio:false});
  }
}

async function acquireCamera({facing=currentFacing,deviceId=''}={}){
  const target=deviceId?{deviceId:{exact:deviceId}}:{facingMode:{ideal:facing}};
  return getCamera(strictVideoConstraints(target),idealVideoConstraints(target));
}

function updateCameraStatus(track){
  const s=track.getSettings(),{w,h,fps,hint}=q();
  const sw=s.width||video.videoWidth||0,sh=s.height||video.videoHeight||0,sf=s.frameRate||0;
  $('#statCamera').textContent=`${sw||'?'}×${sh||'?'} @${sf?Math.round(sf):'?'}`;
  $('#statOutput').textContent=`Direct ${sw||'?'}×${sh||'?'} track`;
  $('#statHint').textContent=hint;
  $('#camBadge').textContent=track.label||currentFacing;
  const landscape=sw>=sh;
  $('#statSharp').textContent=landscape?'แนวนอน ✓':'แนวตั้ง — หมุน iPhone';
  $('#statSharp').className=landscape?'goodtext':'warntext';
  if(!landscape)log(`⚠ กล้องรายงาน ${sw}×${sh} แนวตั้ง — งาน OBS 16:9 แนะนำหมุน iPhone แนวนอน`);
  if(sf && sf < fps-5) log(`⚠ ขอ ${fps}fps แต่กล้องให้ประมาณ ${Math.round(sf)}fps`);
}

async function configureZoom(track){
  const caps=track.getCapabilities?track.getCapabilities():{};const z=$('#zoomRange');
  if(caps.zoom){z.disabled=false;z.min=caps.zoom.min;z.max=caps.zoom.max;z.step=caps.zoom.step||0.1;z.value=track.getSettings().zoom||caps.zoom.min;$('#zoomInfo').textContent=`Zoom ${caps.zoom.min} – ${caps.zoom.max}`;}
  else{z.disabled=true;z.min=1;z.max=1;z.value=1;$('#zoomInfo').textContent='Safari/อุปกรณ์นี้ไม่เปิด Zoom API ให้เว็บ';}
}

async function openCamera({facing=currentFacing,deviceId=''}={}){
  if(!navigator.mediaDevices?.getUserMedia)throw new Error('เบราว์เซอร์ไม่รองรับ getUserMedia');
  const oldStream=cameraStream;
  const oldTrack=oldStream?.getVideoTracks?.()[0]||null;
  let nextStream=null;
  currentFacing=facing;
  try{
    // ลองเปิดกล้องใหม่โดยยังไม่ตัด track เดิม เพื่อให้ replaceTrack เนียนที่สุด
    nextStream=await acquireCamera({facing,deviceId});
  }catch(firstErr){
    // iOS บางรุ่นไม่ยอมเปิดกล้องตัวที่สองพร้อมกัน จึงปล่อยกล้องเดิมก่อนแล้วลองอีกครั้ง
    if(!oldTrack)throw firstErr;
    log(`Safari ไม่ยอมเปิดกล้องใหม่พร้อม track เดิม (${firstErr.name}) — สลับแบบปล่อยกล้องเดิมชั่วคราว`);
    oldTrack.stop();
    await sleep(120);
    nextStream=await acquireCamera({facing,deviceId});
  }
  const nextTrack=nextStream.getVideoTracks()[0];
  try{nextTrack.contentHint=q().hint}catch{}

  // เปลี่ยน track ภายใน peer connection เดิม แทนการ publish ใหม่
  if(isPublishing&&vdo&&oldTrack){
    try{
      await vdo.replaceTrack(oldTrack,nextTrack);
      if(outStream){
        try{outStream.removeTrack(oldTrack)}catch{}
        if(!outStream.getVideoTracks().includes(nextTrack))outStream.addTrack(nextTrack);
      }
      log('✓ replaceTrack สำเร็จ — WebRTC connection เดิมยังอยู่');
    }catch(e){
      nextStream.getTracks().forEach(t=>t.stop());
      throw new Error(`สลับ WebRTC track ไม่สำเร็จ: ${e.message}`);
    }
  }

  cameraStream=nextStream;
  video.srcObject=nextStream;
  await video.play();
  updateCameraStatus(nextTrack);
  await configureZoom(nextTrack);
  await listDevices();

  if(oldStream&&oldStream!==nextStream){oldStream.getTracks().forEach(t=>{if(t!==oldTrack||t.readyState!=='ended')try{t.stop()}catch{}})}
  log(`เปิดกล้อง: ${nextTrack.label||facing} / hint=${q().hint}`);
  return nextTrack;
}

async function setZoom(value){
  const t=cameraStream?.getVideoTracks()[0];if(!t?.applyConstraints)return;
  const caps=t.getCapabilities?.();if(!caps?.zoom)return;
  const v=Math.max(caps.zoom.min,Math.min(caps.zoom.max,Number(value)));
  await t.applyConstraints({advanced:[{zoom:v}]});$('#zoomRange').value=v;log(`Zoom ${v}`)
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
  const stream=await buildOutStream(),room=$('#room').value.trim(),streamID=$('#streamId').value.trim();
  if(!room||!streamID)throw new Error('กรุณาระบุ Room และ Stream ID');
  vdo=new VDONinjaSDK({autoRecover:true,autoRelay:true,salt:'vdo.ninja'});
  vdo.addEventListener('connected',()=>{$('#statRtc').textContent='signaling connected';log('เชื่อม signaling แล้ว')});
  vdo.addEventListener('publishing',()=>{isPublishing=true;$('#liveBadge').textContent='LIVE';$('#liveBadge').classList.add('ok');$('#statRtc').textContent='PUBLISHING';log('เริ่มส่ง WebRTC แล้ว')});
  vdo.addEventListener('peerConnected',e=>{const id=e.detail?.uuid;if(id){peerIds.add(id);updatePeerCount();log(`Viewer connected (${peerIds.size})`)}});
  vdo.addEventListener('peerDisconnected',e=>{const id=e.detail?.uuid;if(id){peerIds.delete(id);updatePeerCount();log(`Viewer disconnected (${peerIds.size})`)}});
  vdo.addEventListener('connectionRecovered',()=>log('WebRTC recovered'));
  vdo.addEventListener('connectionFailed',()=>log('WebRTC connection failed'));
  const onData=e=>{const d=e.detail?.data??e.detail??e.data;if(d&&typeof d==='object')handleRemote(d)};vdo.addEventListener('dataReceived',onData);
  await vdo.connect();await vdo.joinRoom({room});await vdo.publish(stream,{room,streamID,label:streamID});
  isPublishing=true;$('#liveBadge').textContent='LIVE';$('#liveBadge').classList.add('ok');$('#statRtc').textContent='PUBLISHING';
}

async function handleRemote(d){
  if(d.type!=='remote-camera')return;if(d.ts&&d.ts===lastRemoteTs)return;if(d.ts)lastRemoteTs=d.ts;
  $('#statRemote').textContent=`คำสั่ง: ${d.command}`;log(`Remote: ${d.command}`);
  try{
    if(d.command==='front')await openCamera({facing:'user'});
    if(d.command==='rear')await openCamera({facing:'environment'});
    if(d.command==='zoom')await setZoom(d.value);
    if(d.command==='device'&&d.deviceId)await openCamera({deviceId:d.deviceId});
  }catch(e){log(`Remote error: ${e.message}`)}
}

async function stopAll(){
  try{if(vdo){await vdo.stopPublishing?.();await vdo.disconnect?.()}}catch{}
  isPublishing=false;peerIds.clear();updatePeerCount();
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
$('#deviceSelect').onchange=e=>{if(e.target.value)openCamera({deviceId:e.target.value}).catch(x=>log(`Device error: ${x.message}`))};
$('#zoomRange').oninput=e=>setZoom(e.target.value).catch(x=>log(`Zoom error: ${x.message}`));
$('#zoomOutBtn').onclick=()=>{const z=$('#zoomRange');if(!z.disabled)setZoom(Number(z.value)-Number(z.step||.1))};
$('#zoomInBtn').onclick=()=>{const z=$('#zoomRange');if(!z.disabled)setZoom(Number(z.value)+Number(z.step||.1))};
$('#quality').onchange=async()=>{
  log(`เปลี่ยนคุณภาพเป็น ${q().label} / hint=${q().hint}`);
  if(cameraStream){try{await openCamera({facing:currentFacing,deviceId:$('#deviceSelect').value})}catch(e){log(`Quality switch error: ${e.message}`)}}
};
window.addEventListener('beforeunload',()=>stopAll());
if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js?v=041').catch(()=>{});
$('#statHint').textContent=q().hint;
log('v0.4.1 พร้อมใช้งาน — Direct Camera Track + replaceTrack + motion profile');
