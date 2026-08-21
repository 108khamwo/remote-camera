const $=s=>document.querySelector(s);
const logEl=$('#log');
let discoveryVdo=null, discoveryCtl=null, discoveryTimer=null;
let connectedStreamId='', lastTelemetry=null, smartFallbackActive=false, smartOriginalPreset=null,lastSmartQualityChange=0;
const pendingCommands=new Map();
let commandSeq=0;
let cameras=[];
const controlMessages=[];let controlMessageToastTimer=null;
const pendingMessageAcks=new Map();let messageSeq=0;
function nextMessageId(){messageSeq=(messageSeq+1)%100000;return `msg_${Date.now().toString(36)}_${messageSeq.toString(36)}`}
const CAMERA_STORE='remoteCamAutoCamerasV3';
const SELECTED_CAMERA_STORE='remoteCamSelectedCameraV1';
let selectedCameraId=cleanId(localStorage.getItem(SELECTED_CAMERA_STORE)||'');
let userSelectionLocked=false;
let autoOpenPending=false;
let registrySignature='';
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
function activeId(){return cleanId(selectedCameraId||$('#streamId').value||$('#cameraSelect').value)}
function rememberSelectedCamera(id){selectedCameraId=cleanId(id);if(selectedCameraId)localStorage.setItem(SELECTED_CAMERA_STORE,selectedCameraId);else localStorage.removeItem(SELECTED_CAMERA_STORE)}
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
  else if(c.id!==id){const oldId=c.id;c.id=id;if(selectedCameraId===oldId)rememberSelectedCamera(id);if(connectedStreamId===oldId)connectedStreamId=id;}
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
function renderRegistry(preferred=null,{force=false}={}){
  const ordered=[...cameras].sort((a,b)=>(Number(b.online)-Number(a.online))||a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
  const wanted=cleanId(preferred||selectedCameraId||$('#streamId').value||$('#cameraSelect').value);
  let chosen=ordered.find(c=>c.id===wanted)?.id||wanted||'';
  const chosenCamera=ordered.find(c=>c.id===chosen);
  // Keep the last selected stream even when discovery/telemetry is temporarily unavailable.
  // The video viewer is independent from discovery, so a known Stream ID can still be viewed.
  if((!chosen||(!userSelectionLocked&&chosenCamera&&!chosenCamera.online))&&ordered.length){
    chosen=ordered.find(c=>c.online)?.id||chosen||ordered[0].id;
  }
  if(chosen)rememberSelectedCamera(chosen);

  const signature=ordered.map(c=>[c.id,c.name,c.platform,c.browser,c.online?'1':'0'].join('|')).join(';;');
  const structuralChanged=force||signature!==registrySignature;
  const sel=$('#cameraSelect');
  if(structuralChanged){
    sel.innerHTML='';
    if(!ordered.length){
      if(chosen){const o=document.createElement('option');o.textContent=`◌ กล้องล่าสุด • ${chosen}`;o.value=chosen;sel.appendChild(o);sel.disabled=false}
      else{const o=document.createElement('option');o.textContent='ยังไม่พบกล้อง';o.value='';sel.appendChild(o);sel.disabled=true}
    } else {
      sel.disabled=false;ordered.forEach(c=>{const o=document.createElement('option');o.value=c.id;o.textContent=`${c.online?'🟢':'⚫'} ${c.name}`;sel.appendChild(o)});
      if(chosen&&!ordered.some(c=>c.id===chosen)){const o=document.createElement('option');o.value=chosen;o.textContent=`◌ กล้องล่าสุด • ${chosen}`;sel.appendChild(o)}
    }
    const chips=$('#cameraChips');chips.innerHTML='';
    ordered.forEach(c=>{const b=document.createElement('button');b.type='button';b.className='camera-chip'+(c.online?' online':' offline');b.dataset.id=c.id;b.innerHTML=`<span class="presence-dot"></span>${c.name} <small>${c.platform||''}</small>`;chips.appendChild(b)});
    registrySignature=signature;renderMultiObs();
  }
  if(chosen){sel.value=chosen;$('#streamId').value=chosen}else{$('#streamId').value=''}
  document.querySelectorAll('#cameraChips [data-id]').forEach(b=>b.classList.toggle('active',cleanId(b.dataset.id)===chosen));
  const count=onlineCount();
  $('#discoveryStatus').textContent=count?`${count} กล้องออนไลน์`:(chosen?'กำลังค้นหา • เปิดกล้องล่าสุดไว้แล้ว':'กำลังค้นหากล้อง…');
  updateObs();
  maybeAutoOpen();
}
function maybeAutoOpen(){
  if(autoOpenPending)return;
  const id=activeId();
  if(!id)return;
  // Do not wait for discovery/telemetry. OBS and the Control preview both use the same
  // receiver path, so a known Stream ID should be opened immediately.
  if(connectedStreamId===id&&$('#remoteFrame').src&&$('#remoteFrame').src!=='about:blank')return;
  autoOpenPending=true;
  Promise.resolve().then(()=>openSelected()).catch(e=>log(`Auto view error: ${e.message}`)).finally(()=>{autoOpenPending=false});
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
function setStatVisible(valueId,labelId,visible,value){
  const v=$('#'+valueId),l=$('#'+labelId);if(!v||!l)return;
  v.classList.toggle('hidden',!visible);l.classList.toggle('hidden',!visible);
  if(value!==undefined)v.textContent=value;
}
function updateLiveStatusBase(){
  const smart=isSmart();
  $('#statNetworkMode').textContent=smart?'SMART — ปรับอัตโนมัติ':'MANUAL — คง bitrate';
  $('#smartTargetLabel').textContent=smart?'Target':'Bitrate';
  $('#smartTarget').textContent=`${(Number($('#bitrate').value)/1000).toFixed(Number($('#bitrate').value)%1000?1:0)} Mbps`;
  // Manual mode intentionally shows only values we truly know: mode + configured bitrate.
  if(!smart){
    setStatVisible('smartState','smartStateLabel',false,'-');
    setStatVisible('smartActual','smartActualLabel',false,'-');
    setStatVisible('smartLoss','smartLossLabel',false,'-');
    setStatVisible('smartRtt','smartRttLabel',false,'-');
    setStatVisible('smartJitter','smartJitterLabel',false,'-');
  }
}
function updateObs(){
  $('#obsUrl').value=receiverUrl();
  updateLiveStatusBase();
  $('#smartMinWrap').classList.toggle('hidden',!isSmart());
  $('#smartFallbackWrap').classList.toggle('hidden',!isSmart());
  $('#smartBadge').textContent=isSmart()?'SMART':'MANUAL';
}
function reloadPreview(){const f=$('#remoteFrame');if(connectedStreamId&&f.src&&f.src!=='about:blank')f.src=receiverUrl({preview:true,streamId:connectedStreamId})}


function commandId(){
  commandSeq=(commandSeq+1)%100000;
  return `cmd_${Date.now().toString(36)}_${commandSeq.toString(36)}`;
}
function setControlStatus(text,kind=''){
  const el=$('#controlAck');if(!el)return;
  el.textContent=text;el.classList.remove('ok','warn','bad');if(kind)el.classList.add(kind);
}
function routeRemotePayload(payload,{fallback=false,broadcast=false}={}){
  if(!discoveryVdo)throw new Error('ช่องควบคุมยังไม่พร้อม');
  if(broadcast)return discoveryVdo.sendData(payload,{allowFallback:true,preference:'any'});
  const id=cleanId(payload?.targetStream||activeId());
  if(!id)throw new Error('ยังไม่ได้เลือกกล้อง');
  const c=activeCamera();
  const target={streamID:id,allowFallback:true,preference:'any'};
  if(!fallback&&c?.uuid)target.uuid=c.uuid;
  return discoveryVdo.sendData(payload,target);
}
function handleCommandAck(d,uuid=''){
  const id=String(d?.commandId||'');if(!id)return;
  const pending=pendingCommands.get(id);if(!pending)return;
  pendingCommands.delete(id);
  clearTimeout(pending.retryTimer);clearTimeout(pending.failTimer);
  if(d.ok===false){
    setControlStatus(`คำสั่งไม่สำเร็จ: ${d.message||pending.command}`,'bad');
    log(`✗ ${pending.command}: ${d.message||'มือถือปฏิเสธคำสั่ง'}`);
  }else{
    setControlStatus(`มือถือรับคำสั่งแล้ว • ${pending.label}`,'ok');
    if(!String(pending.command).startsWith('zoom'))log(`✓ มือถือรับ ${pending.command}`);
  }
}

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
function cleanMessageText(v){return String(v??'').replace(/\s+/g,' ').trim().slice(0,300)}
function renderControlMessages(){
  const box=$('#controlMessageHistory');if(!box)return;box.innerHTML='';
  if(!controlMessages.length){box.innerHTML='<div class="mini">ยังไม่มีข้อความ</div>';return}
  controlMessages.slice(-60).reverse().forEach(m=>{
    const row=document.createElement('div');row.className=`control-msg-item ${m.mine?'from-control':'from-sender'}`;
    const meta=document.createElement('div');meta.className='control-msg-meta';
    const status=m.mine&&m.status?` • ${m.status}`:'';
    meta.textContent=`${m.mine?'Control':m.from||'กล้อง'} • ${new Date(m.ts).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})}${status}`;
    const text=document.createElement('div');text.textContent=m.text;row.append(meta,text);box.appendChild(row);
  });
}
function addControlMessage(text,{mine=false,from='',ts=Date.now(),messageId='',status=''}={}){
  text=cleanMessageText(text);if(!text)return;
  controlMessages.push({text,mine,from,ts,messageId,status});if(controlMessages.length>80)controlMessages.splice(0,controlMessages.length-80);renderControlMessages();
}
function updateControlMessageStatus(messageId,status){
  if(!messageId)return;
  const m=[...controlMessages].reverse().find(x=>x.messageId===messageId&&x.mine);
  if(m){m.status=status;renderControlMessages()}
}
function showControlMessageToast(text,from='กล้อง'){
  const toast=$('#controlMessageToast');if(!toast)return;
  $('#controlMessageToastFrom').textContent=`ข้อความจาก ${from}`;$('#controlMessageToastText').textContent=text;toast.hidden=false;
  if(controlMessageToastTimer)clearTimeout(controlMessageToastTimer);controlMessageToastTimer=setTimeout(()=>toast.hidden=true,9000);
}
function sendMessageAckToSender(d){
  if(!discoveryVdo||!d?.messageId)return;
  const ack={
    type:'remote-camera-message-ack',
    messageId:d.messageId,
    targetRole:'sender',
    targetStream:cleanId(d.streamID||''),
    ts:Date.now()
  };
  try{discoveryVdo.sendData(ack)}catch{}
}
function handleIncomingSenderMessage(d){
  if(d?.targetRole&&d.targetRole!=='control')return;
  const text=cleanMessageText(d?.text);if(!text)return;
  const from=cleanMessageText(d?.cameraName)||cleanId(d?.streamID)||'กล้อง';
  addControlMessage(text,{mine:false,from,ts:Number(d?.ts)||Date.now(),messageId:String(d?.messageId||'')});
  showControlMessageToast(text,from);log(`ข้อความจาก ${from}: ${text}`);
  sendMessageAckToSender(d);
}
function handleMessageAck(d){
  if(d?.targetRole&&d.targetRole!=='control')return;
  const messageId=String(d?.messageId||'');if(!messageId)return;
  const pending=pendingMessageAcks.get(messageId);
  if(!pending)return;
  const from=cleanId(d?.streamID||d?.fromStream||'');
  if(from)pending.acks.add(from);
  if(pending.broadcast){
    updateControlMessageStatus(messageId,`ถึง ${pending.acks.size} กล้อง`);
    if(!pending.cleanupTimer)pending.cleanupTimer=setTimeout(()=>pendingMessageAcks.delete(messageId),5000);
  }else{
    clearTimeout(pending.retryTimer);clearTimeout(pending.failTimer);
    pendingMessageAcks.delete(messageId);
    updateControlMessageStatus(messageId,'ส่งถึงแล้ว');
    log(`✓ ข้อความถึง ${pending.name||pending.target}`);
  }
}
function broadcastControlMessage(payload){
  if(!discoveryVdo)throw new Error('ช่องข้อความยังไม่พร้อม');
  return discoveryVdo.sendData(payload);
}
function sendControlMessage(text,{broadcast=false}={}){
  text=cleanMessageText(text);if(!text)return false;
  const id=broadcast?'':activeId();if(!broadcast&&!id){log('ส่งข้อความไม่ได้: ยังไม่ได้เลือกกล้อง');return false}
  if(!discoveryVdo){log('ส่งข้อความไม่ได้: ช่องข้อความยังไม่พร้อม');return false}
  const messageId=nextMessageId();
  const payload={
    type:'remote-camera-message',
    messageId,
    targetRole:'sender',
    from:'control',
    text,
    ts:Date.now()
  };
  if(id)payload.targetStream=id;
  try{
    broadcastControlMessage(payload);
    addControlMessage(text,{mine:true,from:broadcast?'ทุกกล้อง':activeName(),ts:payload.ts,messageId,status:broadcast?'ส่งเข้าห้องแล้ว':'กำลังส่ง…'});
    const pending={broadcast,target:id,name:broadcast?'ทุกกล้อง':activeName(),acks:new Set(),payload,retryTimer:null,failTimer:null,cleanupTimer:null};
    pendingMessageAcks.set(messageId,pending);
    if(!broadcast){
      pending.retryTimer=setTimeout(()=>{
        if(!pendingMessageAcks.has(messageId))return;
        try{broadcastControlMessage(payload);updateControlMessageStatus(messageId,'กำลังส่งซ้ำ…')}catch{}
      },700);
      pending.failTimer=setTimeout(()=>{
        if(!pendingMessageAcks.has(messageId))return;
        pendingMessageAcks.delete(messageId);
        updateControlMessageStatus(messageId,'ยังไม่ยืนยัน');
        log(`⚠ ไม่มี ACK ข้อความจาก ${id}`);
      },2600);
    }else{
      pending.cleanupTimer=setTimeout(()=>pendingMessageAcks.delete(messageId),5000);
    }
    return true;
  }catch(e){log(`ส่งข้อความไม่สำเร็จ: ${e.message}`);return false}
}
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
  discoveryVdo.addEventListener('dataReceived',e=>{const d=extractData(e),uuid=extractUuid(e);if(d?.type==='remote-camera-telemetry')setTelemetry(d,uuid);else if(d?.type==='remote-camera-ack')handleCommandAck(d,uuid);else if(d?.type==='remote-camera-message')handleIncomingSenderMessage(d);else if(d?.type==='remote-camera-message-ack')handleMessageAck(d);});
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
  const smart=isSmart();
  const num=v=>Number.isFinite(Number(v));
  if(d.currentBitrate)$('#smartTarget').textContent=`${(d.currentBitrate/1000).toFixed(d.currentBitrate%1000?1:0)} Mbps`;
  if(smart){
    const hasState=!!d.state&&d.state!=='waiting';
    setStatVisible('smartState','smartStateLabel',hasState,hasState?stateThai(d.state):'-');
    setStatVisible('smartActual','smartActualLabel',num(d.bitrateKbps)&&Number(d.bitrateKbps)>0,num(d.bitrateKbps)&&Number(d.bitrateKbps)>0?`${(Number(d.bitrateKbps)/1000).toFixed(2)} Mbps`:'-');
    setStatVisible('smartLoss','smartLossLabel',num(d.lossPct),num(d.lossPct)?fmt(d.lossPct,2,'%'):'-');
    setStatVisible('smartRtt','smartRttLabel',num(d.rttMs),num(d.rttMs)?fmt(d.rttMs,0,' ms'):'-');
    setStatVisible('smartJitter','smartJitterLabel',num(d.jitterMs),num(d.jitterMs)?fmt(d.jitterMs,0,' ms'):'-');
  }else updateLiveStatusBase();
  const badge=$('#smartBadge');badge.textContent=smart?(d.state&&d.state!=='waiting'?`SMART ${stateThai(d.state)}`:'SMART'):'MANUAL';badge.classList.toggle('ok',d.state==='good');
  if(d.action==='bitrate'&&d.reason&&smart)log(`Smart Network → ${(d.currentBitrate/1000).toFixed(1)} Mbps (${d.reason})`);
  // v0.11.5: unavailable receiver metrics are hidden instead of showing placeholder dashes.
}
function resetTelemetry(){lastTelemetry=null;$('#telName').textContent=activeName();$('#telPlatform').textContent=activeCamera()?.platform||'-';$('#telRequested').textContent='รอข้อมูล…';['telActual','telMeasured','telCamera','telVerdict','telSmartProfile'].forEach(id=>$('#'+id).textContent='-')}

async function openSelected(){
  const id=activeId();if(!id)throw new Error('ยังไม่พบกล้อง');
  const c=activeCamera();if(!c?.online)log('เปิด Preview จาก Stream ID โดยตรง — ไม่รอ Auto Discovery');
  connectedStreamId=id;smartFallbackActive=false;smartOriginalPreset=null;resetTelemetry();
  $('#remoteFrame').src=receiverUrl({preview:true,streamId:id});
  $('#status').textContent='กำลังรับภาพ';$('#status').classList.add('ok');
  log(`เปิดภาพ ${activeName()} (${id}) • ${$('#bitrate').value} kbps • ${isSmart()?'Smart':'Manual'}`);
  try{discoveryVdo?.sendData({type:'remote-camera-discover',targetStream:id,ts:Date.now()},{streamID:id,allowFallback:true})}catch{}
}
function closeSelected(){
  connectedStreamId='';$('#remoteFrame').src='about:blank';smartFallbackActive=false;smartOriginalPreset=null;
  $('#status').textContent='รอกล้องออนไลน์';$('#status').classList.remove('ok');$('#latency').textContent='HQ VIEW';
  $('#smartTarget').textContent=`${(Number($('#bitrate').value)/1000).toFixed(Number($('#bitrate').value)%1000?1:0)} Mbps`;
  ['smartState','smartActual','smartLoss','smartRtt','smartJitter'].forEach(id=>{const label=id+'Label';setStatVisible(id,label,false,'-')});
  log('ปิดภาพกล้องที่เลือก');
}
function send(command,extra={}){
  const id=activeId();
  if(!discoveryVdo||!id){setControlStatus('ยังไม่พบ/เชื่อมมือถือ','bad');log('Auto Discovery ยังไม่พร้อมหรือยังไม่พบกล้อง');return}
  const cid=commandId();
  const payload={type:'remote-camera',command,commandId:cid,...extra,ts:Date.now(),targetStream:id};
  const label=command==='front'?'กล้องหน้า':command==='rear'?'กล้องหลัง':command==='zoomDrive'?'Zoom ต่อเนื่อง':command==='zoomStop'?'หยุด Zoom':command==='zoomTarget'?'ตำแหน่ง Zoom':command;
  setControlStatus(`กำลังส่ง • ${label}`,'warn');
  try{routeRemotePayload(payload)}catch(e){setControlStatus(`ส่งไม่สำเร็จ: ${e.message}`,'bad');log(`Send error: ${e.message}`);return}
  const item={command,label,payload,retryTimer:null,failTimer:null};
  pendingCommands.set(cid,item);
  item.retryTimer=setTimeout(()=>{
    if(!pendingCommands.has(cid))return;
    try{routeRemotePayload(payload,{fallback:true});setControlStatus(`กำลังลองซ้ำ • ${label}`,'warn')}catch{}
  },650);
  item.failTimer=setTimeout(()=>{
    if(!pendingCommands.has(cid))return;
    try{routeRemotePayload(payload,{broadcast:true})}catch{}
    setTimeout(()=>{
      if(!pendingCommands.has(cid))return;
      pendingCommands.delete(cid);
      setControlStatus(`มือถือไม่ตอบรับ • ${label}`,'bad');
      log(`⚠ ไม่มี ACK สำหรับ ${command} → ${id}`);
    },1100);
  },1450);
}
async function selectCamera(id,{fromUser=true}={}){
  id=cleanId(id);if(!id)return;
  const previous=activeId();
  if(fromUser)userSelectionLocked=true;
  rememberSelectedCamera(id);
  $('#streamId').value=id;$('#cameraSelect').value=id;renderRegistry(id);resetTelemetry();
  if(connectedStreamId&&connectedStreamId!==id)closeSelected();
  // Selection controls the viewer directly; discovery is only for presence/name metadata.
  await openSelected();
  if(previous!==id)log(`เลือกกล้อง: ${activeName()} (${id})`);
  try{discoveryVdo?.sendData({type:'remote-camera-discover',targetStream:id,ts:Date.now()},{streamID:id,allowFallback:true})}catch{}
}

loadCameras();$('#room').value=systemRoom();if($('#roomText'))$('#roomText').textContent=$('#room').value;renderRegistry();updateObs();resetTelemetry();setControlStatus('ควบคุมกล้องจากหน้ามือถือ');
setTimeout(()=>maybeAutoOpen(),350);
['bitrate','buffer','codec','networkMode','smartMin','smartFallback'].forEach(id=>$('#'+id).addEventListener('change',()=>{updateObs();renderMultiObs();reloadPreview()}));
$('#cameraSelect').addEventListener('change',e=>selectCamera(e.target.value,{fromUser:true}).catch(x=>log(`Select error: ${x.message}`)));
$('#cameraChips').addEventListener('click',e=>{const b=e.target.closest('[data-id]');if(b){e.preventDefault();selectCamera(b.dataset.id,{fromUser:true}).catch(x=>log(`Select error: ${x.message}`))}});
$('#controlMessageOpen').onclick=()=>{$('#controlMessagePanel').hidden=!$('#controlMessagePanel').hidden;renderControlMessages()};
$('#controlMessageSendSelected').onclick=()=>{const input=$('#controlMessageInput');if(sendControlMessage(input.value,{broadcast:false}))input.value=''};
$('#controlMessageSendAll').onclick=()=>{const input=$('#controlMessageInput');if(sendControlMessage(input.value,{broadcast:true}))input.value=''};
$('#controlMessageInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('#controlMessageSendSelected').click()}});
$('#controlMessageToast').addEventListener('click',()=>{$('#controlMessagePanel').hidden=false;$('#controlMessageToast').hidden=true;renderControlMessages()});
$('#refreshDiscovery').onclick=()=>restartDiscovery().catch(e=>log(`Discovery restart error: ${e.message}`));
$('#forgetOffline').onclick=()=>{cameras=cameras.filter(c=>c.online);if(selectedCameraId&&!cameras.some(c=>c.id===selectedCameraId))rememberSelectedCamera('');registrySignature='';saveCameras();renderRegistry(null,{force:true});log('ล้างรายการ Offline แล้ว')};
window.addEventListener('message',e=>{if(e.source!==$('#remoteFrame').contentWindow)return;const d=e.data;if(d?.type==='remote-camera-receiver-stats')handleReceiverStats(d)});

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
log(`v0.11.5 พร้อม — Preview เปิดจาก Stream ID โดยตรง + เลือกกล้องแสดงตลอด • Offline grace ${OFFLINE_MS/1000}s`);
