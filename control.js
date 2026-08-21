const $=s=>document.querySelector(s);
const logEl=$('#log');
let vdo=null,connectedStreamId='',targetPeerUUID='';
let lastTelemetry=null,smartFallbackActive=false,smartOriginalPreset=null,lastSmartQualityChange=0;
const CAMERA_STORE='remoteCamControlCamerasV1';
const ROOM_STORE='remoteCamControlRoomV1';
let cameras=[];

function log(m){logEl.textContent+=`[${new Date().toLocaleTimeString()}] ${m}\n`;logEl.scrollTop=logEl.scrollHeight}
function isSmart(){return $('#networkMode').value==='smart'}
function cleanId(v){return String(v||'').trim().replace(/[^\w]/g,'_')}
function loadRegistry(){
  try{cameras=JSON.parse(localStorage.getItem(CAMERA_STORE)||'[]')}catch{cameras=[]}
  if(!Array.isArray(cameras)||!cameras.length)cameras=[{name:'CAM 01',id:'cam01'}];
  cameras=cameras.filter(x=>x&&x.id).map(x=>({name:String(x.name||x.id),id:cleanId(x.id)}));
  $('#room').value=localStorage.getItem(ROOM_STORE)||'remote-cam-test';
}
function saveRegistry(){localStorage.setItem(CAMERA_STORE,JSON.stringify(cameras));localStorage.setItem(ROOM_STORE,$('#room').value.trim())}
function activeName(){const id=cleanId($('#streamId').value);return cameras.find(c=>c.id===id)?.name||id||'กล้อง'}

function receiverUrl({preview=false,streamId=null}={}){
  const u=new URL('receiver.html',location.href);
  u.searchParams.set('room',$('#room').value.trim());
  u.searchParams.set('stream',cleanId(streamId??$('#streamId').value));
  u.searchParams.set('bitrate',$('#bitrate').value);
  u.searchParams.set('buffer',$('#buffer').value);
  if($('#codec').value)u.searchParams.set('codec',$('#codec').value);
  if(isSmart()){u.searchParams.set('smart','1');u.searchParams.set('minbitrate',$('#smartMin').value)}
  if(preview)u.searchParams.set('preview','1');
  return u.href;
}

function renderRegistry(selectedId=null){
  const current=cleanId(selectedId||$('#streamId').value||cameras[0]?.id);
  const sel=$('#cameraSelect');sel.innerHTML='';
  cameras.forEach(c=>{const o=document.createElement('option');o.value=c.id;o.textContent=`${c.name} • ${c.id}`;sel.appendChild(o)});
  const chosen=cameras.some(c=>c.id===current)?current:cameras[0]?.id||'cam01';
  sel.value=chosen;$('#streamId').value=chosen;

  const chips=$('#cameraChips');chips.innerHTML='';
  cameras.forEach(c=>{
    const b=document.createElement('button');b.type='button';b.className='camera-chip'+(c.id===chosen?' active':'');b.dataset.id=c.id;b.innerHTML=`${c.name} <small>${c.id}</small>`;chips.appendChild(b)
  });
  renderMultiObs();
}

function renderMultiObs(){
  const box=$('#multiObsList');if(!box)return;box.innerHTML='';
  cameras.forEach(c=>{
    const row=document.createElement('div');row.className='multi-obs-row';
    const name=document.createElement('div');name.textContent=c.name;
    const id=document.createElement('div');id.className='mini';id.textContent=c.id;
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
  renderMultiObs();saveRegistry();
}
function reloadPreview(){const f=$('#remoteFrame');if(f.src&&f.src!=='about:blank')f.src=receiverUrl({preview:true})}

function setTelemetry(d){
  if(d?.streamID && connectedStreamId && cleanId(d.streamID)!==cleanId(connectedStreamId))return;
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
function fmt(n,d=1,suffix=''){return Number.isFinite(Number(n))?`${Number(n).toFixed(d)}${suffix}`:'-'}
function stateThai(s){return ({good:'ดี',fair:'พอใช้',weak:'อ่อน',critical:'วิกฤต',waiting:'กำลังวัด'})[s]||s||'-'}
function handleReceiverStats(d){
  $('#smartState').textContent=stateThai(d.state);$('#smartTarget').textContent=d.currentBitrate?`${(d.currentBitrate/1000).toFixed(d.currentBitrate%1000?1:0)} Mbps`:'-';$('#smartActual').textContent=d.bitrateKbps?`${(d.bitrateKbps/1000).toFixed(2)} Mbps`:'-';$('#smartLoss').textContent=d.lossPct!=null?fmt(d.lossPct,2,'%'):'-';$('#smartRtt').textContent=d.rttMs!=null?fmt(d.rttMs,0,' ms'):'-';$('#smartJitter').textContent=d.jitterMs!=null?fmt(d.jitterMs,0,' ms'):'-';
  const badge=$('#smartBadge');badge.textContent=isSmart()?`SMART ${stateThai(d.state)}`:'MANUAL';badge.classList.toggle('ok',d.state==='good');
  if(d.action==='bitrate'&&d.reason&&isSmart())log(`Smart Network → ${(d.currentBitrate/1000).toFixed(1)} Mbps (${d.reason})`);
  if(!isSmart()||!vdo||$('#smartFallback').value!=='1')return;
  const now=Date.now();
  if(d.fallbackRecommended&&!smartFallbackActive&&now-lastSmartQualityChange>10000){const current=lastTelemetry?.presetKey||smartOriginalPreset||'';if(current&&current!=='720_30'){smartOriginalPreset=smartOriginalPreset||current;smartFallbackActive=true;lastSmartQualityChange=now;send('quality',{value:'720_30',reason:'Smart Network: ฉุกเฉิน 720p30'});log('⚠ Smart Network: ลดกล้องเป็น 720p30 ชั่วคราว')}}
  if(d.restoreRecommended&&smartFallbackActive&&now-lastSmartQualityChange>18000){const restore=smartOriginalPreset||'1080_30';smartFallbackActive=false;lastSmartQualityChange=now;send('quality',{value:restore,reason:`Smart Network: คืน ${restore}`});log(`✓ Smart Network: คืนคุณภาพ ${restore}`)}
}

async function connect(){
  if(vdo)return;const room=$('#room').value.trim(),streamID=cleanId($('#streamId').value.trim());if(!room||!streamID)throw new Error('กรุณาระบุ Room และ Stream ID');
  connectedStreamId=streamID;targetPeerUUID='';lastTelemetry=null;
  log(`กำลังเชื่อม ${activeName()} (${streamID})…`);await loadVDONinjaSDK(({index,total})=>log(`โหลด SDK ${index}/${total}`));
  vdo=new VDONinjaSDK({autoRecover:true,autoRelay:true,salt:'vdo.ninja'});
  vdo.addEventListener('connected',()=>{$('#status').textContent='CONTROL CONNECTED';$('#status').classList.add('ok');log('Remote control signaling connected')});
  vdo.addEventListener('peerConnected',e=>{const id=e.detail?.uuid;if(id){targetPeerUUID=id;log(`Control peer connected ${id.slice(0,8)}…`)}});
  vdo.addEventListener('peerLatency',e=>{const v=e.detail?.latency??e.detail?.rtt??e.detail?.value;if(v!=null)$('#latency').textContent=`${Math.round(v)} ms`});
  vdo.addEventListener('connectionRecovered',()=>log('Control recovered'));vdo.addEventListener('connectionFailed',()=>log('Control connection failed'));
  vdo.addEventListener('dataReceived',e=>{const d=extractData(e);if(d?.type==='remote-camera-telemetry')setTelemetry(d)});
  await vdo.connect();await vdo.joinRoom({room});await vdo.view(streamID,{audio:false,video:false,label:`control_${streamID}`});
  $('#remoteFrame').src=receiverUrl({preview:true,streamId:streamID});log(`เปิดภาพ ${streamID}: ${$('#bitrate').value} kbps / ${isSmart()?'Smart':'Manual'} / buffer ${$('#buffer').value} ms`);
}
async function disconnect(){
  const old=connectedStreamId;try{if(vdo){if(old)await vdo.stopViewing?.(old);await vdo.disconnect?.()}}catch{}
  vdo=null;connectedStreamId='';targetPeerUUID='';$('#remoteFrame').src='about:blank';smartFallbackActive=false;smartOriginalPreset=null;lastTelemetry=null;
  ['telName','telPlatform','telActual','telMeasured','telCamera','telVerdict','telSmartProfile'].forEach(id=>$('#'+id).textContent='-');$('#telRequested').textContent='รอข้อมูล…';
  ['smartState','smartTarget','smartActual','smartLoss','smartRtt','smartJitter'].forEach(id=>$('#'+id).textContent='-');$('#smartBadge').textContent=isSmart()?'SMART':'MANUAL';$('#smartBadge').classList.remove('ok');$('#status').textContent='DISCONNECTED';$('#status').classList.remove('ok');$('#latency').textContent='HQ VIEW';log('Disconnected')
}
function send(command,extra={}){
  if(!vdo||!connectedStreamId){log('ยังไม่ได้เชื่อมต่อ Remote Control');return}
  const payload={type:'remote-camera',command,...extra,ts:Date.now(),targetStream:connectedStreamId};
  try{
    // v0.8: เจาะจง stream เพื่อไม่ให้คำสั่ง Front/Rear/Zoom ไปโดนมือถือเครื่องอื่นใน Room เดียวกัน
    if(targetPeerUUID)vdo.sendData(payload,targetPeerUUID);else vdo.sendData(payload,{streamID:connectedStreamId,allowFallback:true});
    log(`ส่ง ${command} → ${connectedStreamId}`)
  }catch(e){log(`Send error: ${e.message}`)}
}

async function selectCamera(id,{autoConnect=false}={}){
  id=cleanId(id);if(!id)return;if(vdo)await disconnect();$('#streamId').value=id;$('#cameraSelect').value=id;renderRegistry(id);updateObs();resetTelemetry();if(autoConnect)await connect()
}
function resetTelemetry(){lastTelemetry=null;$('#telName').textContent=activeName();$('#telPlatform').textContent='-';$('#telRequested').textContent='รอข้อมูล…';['telActual','telMeasured','telCamera','telVerdict','telSmartProfile'].forEach(id=>$('#'+id).textContent='-')}
function addCamera(){const name=$('#newCameraName').value.trim(),id=cleanId($('#newCameraId').value);if(!id){log('กรุณาใส่ Stream ID จากมือถือ');return}const found=cameras.find(c=>c.id===id);if(found){found.name=name||found.name}else cameras.push({name:name||id,id});saveRegistry();$('#newCameraName').value='';$('#newCameraId').value='';renderRegistry(id);updateObs();log(`เพิ่มกล้อง ${name||id} (${id})`)}
function removeActive(){if(cameras.length<=1){log('ต้องเหลือกล้องอย่างน้อย 1 รายการ');return}const id=cleanId($('#streamId').value);cameras=cameras.filter(c=>c.id!==id);saveRegistry();renderRegistry(cameras[0].id);updateObs();log(`ลบ ${id} ออกจากรายการ Control Center (ไม่กระทบมือถือ)`) }

loadRegistry();renderRegistry();updateObs();resetTelemetry();
['bitrate','buffer','codec','networkMode','smartMin','smartFallback'].forEach(id=>$('#'+id).addEventListener('change',()=>{updateObs();reloadPreview()}));
$('#room').addEventListener('input',()=>{updateObs()});
$('#streamId').addEventListener('change',()=>{const id=cleanId($('#streamId').value);$('#streamId').value=id;renderRegistry(id);updateObs();resetTelemetry()});
$('#cameraSelect').addEventListener('change',e=>selectCamera(e.target.value).catch(x=>log(`Switch control error: ${x.message}`)));
$('#cameraChips').addEventListener('click',e=>{const b=e.target.closest('[data-id]');if(b)selectCamera(b.dataset.id).catch(x=>log(`Switch control error: ${x.message}`))});
$('#addCamera').onclick=addCamera;
// double click selected chip to remove intentionally, avoids accidental small delete buttons on mobile
$('#cameraChips').addEventListener('dblclick',e=>{const b=e.target.closest('[data-id]');if(b&&b.dataset.id===cleanId($('#streamId').value))removeActive()});
window.addEventListener('message',e=>{if(e.source!==$('#remoteFrame').contentWindow)return;const d=e.data;if(d?.type==='remote-camera-receiver-stats')handleReceiverStats(d)});

$('#connect').onclick=()=>connect().catch(e=>{log(`Connect error: ${e.message}`);vdo=null;connectedStreamId=''});$('#disconnect').onclick=()=>disconnect();$('#front').onclick=()=>send('front');$('#rear').onclick=()=>send('rear');
let zoomSendTimer=null;function zoomSpeed(){return $('#zoomSpeed')?.value||'normal'}
$('#zoom').oninput=e=>{const v=Number(e.target.value);$('#zoomValue').value=`${v.toFixed(2)}×`;clearTimeout(zoomSendTimer);zoomSendTimer=setTimeout(()=>send('zoomTarget',{value:v,speed:zoomSpeed()}),35)};
$('#zoomSpeed').onchange=()=>send('zoomTarget',{value:Number($('#zoom').value),speed:zoomSpeed()});
function bindRemoteHoldZoom(btn,dir){const start=e=>{e.preventDefault();send('zoomDrive',{direction:dir,speed:zoomSpeed()})};const stop=e=>{if(e)e.preventDefault();send('zoomStop',{speed:zoomSpeed()})};btn.addEventListener('pointerdown',start);btn.addEventListener('pointerup',stop);btn.addEventListener('pointercancel',stop);btn.addEventListener('pointerleave',e=>{if(e.buttons)stop(e)});btn.addEventListener('contextmenu',e=>e.preventDefault())}
bindRemoteHoldZoom($('#zoomOut'),-1);bindRemoteHoldZoom($('#zoomIn'),1);
$('#copy').onclick=async()=>{await navigator.clipboard.writeText($('#obsUrl').value);$('#copy').textContent='คัดลอกแล้ว';setTimeout(()=>$('#copy').textContent='คัดลอก',1200)};
log('v0.8 พร้อม — Manual เป็นค่าเริ่มต้น, หลายมือถือ และ Remote Control เจาะจง Stream ID');
