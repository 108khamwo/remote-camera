/* Remote Camera v0.11.39 — sender quality command ACK + receiver stats fixes */
const $=s=>document.querySelector(s);
const logEl=$('#log');
let discoveryVdo=null, discoveryCtl=null, discoveryTimer=null, nativePresenceVdo=null;
let dataPeerCount=0;
let connectedStreamId='', lastTelemetry=null, smartFallbackActive=false, smartOriginalPreset=null,lastSmartQualityChange=0;
const pendingCommands=new Map();
let commandSeq=0;
let cameras=[];
const controlMessages=[];let controlMessageToastTimer=null;
const pendingMessageAcks=new Map();let messageSeq=0;
function nextMessageId(){messageSeq=(messageSeq+1)%100000;return `msg_${Date.now().toString(36)}_${messageSeq.toString(36)}`}
const CAMERA_STORE='remoteCamAutoCamerasV4';
const SELECTED_CAMERA_STORE='remoteCamSelectedCameraV1';
const FIXED_SLOT_STORE='remoteCamPermanentSlotsV1';
const RECEIVER_PROFILE_STORE='remoteCamReceiverProfilesV1';
const VIDEO_PRESET_KEYS=new Set(['1080_30','720_30','1080_60','720_60','1080_24_detail']);
const RECEIVER_CONTROLS=['networkMode','bitrate','buffer','codec','smartMin','smartFallback'];
let receiverProfiles={};let loadedProfileId='';
const lastVideoSync=new Map();
const QUALITY_PRESETS={
  '1080_30':[1920,1080], '720_30':[1280,720],
  '1080_60':[1920,1080], '720_60':[1280,720],
  '1080_24_detail':[1920,1080]
};
const qualityErrorUntil=new Map();
function qualityMatchesActual(preset,actual){
  const dim=QUALITY_PRESETS[preset];if(!dim)return false;
  const w=Number(actual?.width||0),h=Number(actual?.height||0);
  return !!(w&&h&&((Math.abs(w-dim[0])<=16&&Math.abs(h-dim[1])<=16)||
                      (Math.abs(h-dim[0])<=16&&Math.abs(w-dim[1])<=16)));
}
function setQualityStatus(message,{retry=false}={}){
  const el=$('#receiverQualityStatus'),btn=$('#retryVideoPreset');
  if(el)el.textContent=message;
  if(btn)btn.hidden=!retry;
}
function actualQualityLabel(d){
  const a=d?.actual||{};
  if(!a.width&&!a.height)return 'ยังไม่ทราบขนาดจริง';
  const fps=Number(a.fps||0);
  return `${a.width||'?'}×${a.height||'?'}${fps?' · '+fps.toFixed(0)+' FPS':''}`;
}
function qualityCaptureStatus(preset,d){
  const fps=Number(d?.actual?.fps||0);
  const target=preset==='1080_60'||preset==='720_60'?60:
               preset==='1080_24_detail'?24:30;
  const text='กล้องจับภาพ '+actualQualityLabel(d);
  if(fps&&fps<target-5){
    return text+` · ได้ ${fps.toFixed(0)}/${target} FPS`;
  }
  return text+' · ตรงความละเอียด';
}
try{receiverProfiles=JSON.parse(localStorage.getItem(RECEIVER_PROFILE_STORE)||'{}')}catch{receiverProfiles={}}
if(!receiverProfiles||typeof receiverProfiles!=='object'||Array.isArray(receiverProfiles))receiverProfiles={};
function storeReceiverProfile(id=activeId()){
  if(!id||!$('#videoPreset'))return;
  receiverProfiles[id]={videoPreset:$('#videoPreset').value,
    ...Object.fromEntries(RECEIVER_CONTROLS.map(k=>[k,$('#'+k).value]))};
  try{localStorage.setItem(RECEIVER_PROFILE_STORE,JSON.stringify(receiverProfiles))}catch{}
}
function loadReceiverProfile(id){
  if(!id||loadedProfileId===id)return;
  loadedProfileId=id;
  const saved=receiverProfiles[id]||{};
  const video=VIDEO_PRESET_KEYS.has(saved.videoPreset)?saved.videoPreset:'1080_30';
  $('#videoPreset').value=video;
  const fixed=isFixedSlot(id);
  if(fixed){
    const defaults={networkMode:'smart',bitrate:'6000',buffer:'350',codec:'h264',smartMin:'1800',smartFallback:'0'};
    for(const [key,value]of Object.entries(defaults))$('#'+key).value=value;
  }else{
    const defaults={networkMode:'smart',bitrate:'6000',buffer:'350',codec:'h264',smartMin:'1800',smartFallback:'0'};
    for(const key of RECEIVER_CONTROLS){
      const control=$('#'+key);
      const value=String(saved[key]??defaults[key]);
      control.value=[...control.options].some(o=>o.value===value)?value:defaults[key];
    }
  }
  for(const key of RECEIVER_CONTROLS)$('#'+key).disabled=fixed;
  $('#fixedNetworkNote').hidden=!fixed;
  setQualityStatus('รอมือถือเชื่อมต่อ');
}
// All quality changes are now performed by the Sender. Never send a remote
// 'quality' command, including during telemetry/discovery/reconnect.
function syncVideoPreset(){return;}

let fixedSlots=[];
function loadFixedSlots(){
  try{fixedSlots=JSON.parse(localStorage.getItem(FIXED_SLOT_STORE)||'[]')}catch{fixedSlots=[]}
  if(!Array.isArray(fixedSlots))fixedSlots=[];
  fixedSlots=fixedSlots.filter(s=>s&&/^cam_fixed_[a-f0-9]{32}$/.test(s.id)&&typeof s.name==='string');
  fixedSlots=[...new Map(fixedSlots.map(s=>[s.id,{id:s.id,name:s.name.slice(0,70)}])).values()];
}
function saveFixedSlots(){localStorage.setItem(FIXED_SLOT_STORE,JSON.stringify(fixedSlots))}
function isFixedSlot(id){return fixedSlots.some(s=>s.id===id)}
function slotById(id){return fixedSlots.find(s=>s.id===id)}
function permanentSenderUrl(id){const u=new URL('sender.html',location.href);u.searchParams.set('s',id);return u.href}
function permanentObsUrl(id){const u=new URL('r.html',location.href);u.searchParams.set('s',id);return u.href}
function seedFixedSlots(){
  for(const slot of fixedSlots){
    const c=cameras.find(x=>x.id===slot.id);
    if(c){c.name=slot.name;c.transport='room';}
    else cameras.push({id:slot.id,deviceId:'',name:slot.name,platform:'',browser:'',transport:'room',online:false,lastSeen:0,uuid:''});
  }
}
function newFixedSlotId(){
  if(!crypto?.getRandomValues)throw new Error('การสร้างลิงก์ถาวรต้องเปิดผ่าน HTTPS');
  const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);
  return `cam_fixed_${[...bytes].map(n=>n.toString(16).padStart(2,'0')).join('')}`;
}
async function copyPermanentLink(value,btn){
  try{
    await navigator.clipboard.writeText(value);
    const prev=btn.textContent;btn.textContent='คัดลอกแล้ว';setTimeout(()=>btn.textContent=prev,1200);
  }catch{
    const input=btn.parentElement?.querySelector('input');if(input){input.focus();input.select()}
    alert('กรุณาคัดลอกลิงก์จากช่องข้อความ');
  }
}
function permanentLinkRow(label,url){
  const wrap=document.createElement('div');wrap.className='perma-url-line';
  const title=document.createElement('span');title.className='mini';title.textContent=label;
  const input=document.createElement('input');input.type='text';input.readOnly=true;input.value=url;input.setAttribute('aria-label',label);
  const button=document.createElement('button');button.type='button';button.className='ghost';button.textContent='คัดลอก';
  button.addEventListener('click',()=>copyPermanentLink(url,button));
  wrap.append(title,input,button);return wrap;
}
function renderFixedSlots(){
  const box=$('#permanentSlotList');if(!box)return;box.replaceChildren();
  if(!fixedSlots.length){const empty=document.createElement('div');empty.className='mini';empty.textContent='ยังไม่มีคู่ลิงก์';box.append(empty);return}
  for(const slot of fixedSlots){
    const card=document.createElement('div');card.className='perma-slot-card';
    const head=document.createElement('div');head.className='perma-slot-head';
    const name=document.createElement('strong');name.textContent=slot.name;
    const actions=document.createElement('div');actions.className='perma-slot-actions';
    const select=document.createElement('button');select.className='ghost';select.type='button';select.textContent='ดูกล้อง';
    select.addEventListener('click',()=>selectCamera(slot.id,{fromUser:true}).catch(e=>log(`เลือกกล้อง: ${e.message}`)));
    const del=document.createElement('button');del.className='ghost perma-delete';del.type='button';del.textContent='ลบรายการ';
    del.addEventListener('click',()=>{
      if(!confirm(`ลบคู่ลิงก์ “${slot.name}” ออกจากรายการ?\nลิงก์เดิมจะยังเชื่อมต่อได้จนกว่าจะเลิกใช้งาน`))return;
      fixedSlots=fixedSlots.filter(s=>s.id!==slot.id);saveFixedSlots();renderFixedSlots();
      // Do not remove an active video endpoint or break someone using an old URL.
      const c=cameras.find(c=>c.id===slot.id);if(c&&!c.online){cameras=cameras.filter(x=>x!==c);saveCameras();if(selectedCameraId===slot.id){rememberSelectedCamera('');if(connectedStreamId===slot.id)closeSelected();}}
      registrySignature='';renderRegistry(null,{force:true});
    });
    actions.append(select,del);head.append(name,actions);
    card.append(head,permanentLinkRow('ลิงก์ผู้ส่ง',permanentSenderUrl(slot.id)),permanentLinkRow('ลิงก์ OBS',permanentObsUrl(slot.id)));
    box.append(card);
  }
}
function addFixedSlot(name,id=null){
  const label=String(name||'').trim().slice(0,70)||`กล้อง ${fixedSlots.length+1}`;
  const stream=id||newFixedSlotId();
  if(!/^cam_fixed_[a-f0-9]{32}$/.test(stream))throw new Error('Stream ID ไม่ถูกต้อง');
  if(fixedSlots.some(s=>s.id===stream))throw new Error('ลิงก์นี้อยู่ในรายการแล้ว');
  fixedSlots.push({name:label,id:stream});saveFixedSlots();seedFixedSlots();saveCameras();
  registrySignature='';renderRegistry(null,{force:true});renderFixedSlots();
  return stream;
}

let selectedCameraId=cleanId(localStorage.getItem(SELECTED_CAMERA_STORE)||'');
let userSelectionLocked=false;
let autoOpenPending=false;
let registrySignature='';
const LEGACY_CAMERA_STORE='remoteCamAutoCamerasV3';
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
function controlDataStreamId(room=systemRoom()){
  return cleanId(`control_${room}`);
}
function isSmart(){return $('#networkMode').value==='smart'}
function activeId(){return cleanId(selectedCameraId||$('#streamId').value||$('#cameraSelect').value)}
function rememberSelectedCamera(id){selectedCameraId=cleanId(id);if(selectedCameraId)localStorage.setItem(SELECTED_CAMERA_STORE,selectedCameraId);else localStorage.removeItem(SELECTED_CAMERA_STORE)}
function activeCamera(){return cameras.find(c=>c.id===activeId())||null}
function activeName(){const c=activeCamera();return c?.name||activeId()||'กล้อง'}
function saveCameras(){
  const persist=cameras.map(({id,deviceId,name,platform,browser,transport})=>({id,deviceId,name,platform,browser,transport:transport||'room'}));
  localStorage.setItem(CAMERA_STORE,JSON.stringify(persist));
}
function loadCameras(){
  // v0.9 could persist provisional listing peers as if they were cameras. Start a
  // clean v3 registry once so those ghost/duplicate entries do not survive upgrade.
  if(!localStorage.getItem(CAMERA_STORE)) localStorage.removeItem(LEGACY_CAMERA_STORE);
  try{cameras=JSON.parse(localStorage.getItem(CAMERA_STORE)||'[]')}catch{cameras=[]}
  if(!Array.isArray(cameras))cameras=[];
  cameras=cameras.filter(x=>x?.id&&cleanId(x.id).startsWith('cam_')).map(x=>{const transport=x.transport==='direct'?'direct':'room';return {id:cleanId(x.id),deviceId:cleanId(x.deviceId||''),name:String(x.name||x.id),platform:x.platform||'',browser:x.browser||'',transport,online:transport==='direct',lastSeen:transport==='direct'?Number.POSITIVE_INFINITY:0,uuid:''}});
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
  // Permanent slots are keyed by link, NOT by physical device.
  // One phone can successively operate different slots without altering old links.
  let c=cameras.find(x=>x.id===id)||null;
  if(!c&&!isFixedSlot(id))c=deviceId?cameras.find(x=>x.deviceId===deviceId&&!isFixedSlot(x.id)):null;
  if(!c){c={id,deviceId,name:id,platform:'',browser:'',transport:info?.transport==='direct'?'direct':'room',online:false,lastSeen:0,uuid:''};cameras.push(c);log(`พบกล้องจริงจาก Sender: ${id}`)}
  else if(c.id!==id){const oldId=c.id;c.id=id;if(selectedCameraId===oldId)rememberSelectedCamera(id);if(connectedStreamId===oldId)connectedStreamId=id;}
  if(info?.transport==='direct')c.transport='direct';
  else if(info?.transport==='room')c.transport='room';
  else if(!c.transport)c.transport='room';
  if(deviceId)c.deviceId=deviceId;
  if(info.label){const p=parseLabel(info.label,id);if(p.name)c.name=p.name;if(p.platform)c.platform=p.platform;if(p.browser)c.browser=p.browser}
  if(info.name&&!isFixedSlot(id))c.name=String(info.name);
  if(isFixedSlot(id))c.name=slotById(id).name;
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
  for(const c of cameras){if(c.transport==='direct'){if(!c.online){c.online=true;changed=true}continue}const on=!!c.lastSeen&&(now-c.lastSeen)<OFFLINE_MS;if(c.online!==on){c.online=on;changed=true}}
  if(changed)renderRegistry();
}
function onlineCount(){return cameras.filter(c=>c.transport!=='direct'&&c.online).length}
function directCount(){return cameras.filter(c=>c.transport==='direct').length}
function cameraTransport(id=activeId()){return cameras.find(c=>c.id===cleanId(id))?.transport||'room'}
function isIosNativeStream(id){
  id=cleanId(id);
  const c=cameras.find(x=>x.id===id);
  return id.includes('_ios_')||/ios/i.test(String(c?.platform||''));
}
function receiverCodecFor(id,transport){
  // v0.11.25: iOS Native H.264 freezes while VP8 stays stable.
  if(transport==='direct'&&isIosNativeStream(id))return 'vp8';
  return $('#codec').value||'';
}

let monitorAudioEnabled=false; // off by default to prevent feedback in the control room
function updateMonitorAudioUi(){
  const btn=$('#controlListenBtn'),tip=$('#controlListenTip');if(!btn)return;
  btn.disabled=!connectedStreamId;
  btn.setAttribute('aria-pressed',String(monitorAudioEnabled));
  btn.textContent=monitorAudioEnabled?'ปิดฟังเสียง':'ฟังเสียง';
  if(tip)tip.hidden=!monitorAudioEnabled;
}
function receiverUrl({preview=false,streamId=null}={}){
  const id=cleanId(streamId??activeId());
  if(!id)return '';
  const u=new URL('receiver.html',location.href);
  const transport=cameraTransport(id);
  if(transport==='direct')u.searchParams.set('direct','1');
  else u.searchParams.set('room',$('#room').value.trim());
  u.searchParams.set('stream',id);
  u.searchParams.set('bitrate',isFixedSlot(id)?'6000':$('#bitrate').value);
  u.searchParams.set('buffer',isFixedSlot(id)?'350':$('#buffer').value);
  const effectiveCodec=isFixedSlot(id)?'h264':receiverCodecFor(id,transport);
  if(effectiveCodec)u.searchParams.set('codec',effectiveCodec);
  if(isFixedSlot(id)||isSmart()){u.searchParams.set('smart','1');u.searchParams.set('minbitrate',isFixedSlot(id)?'1800':$('#smartMin').value)}
  if(preview){u.searchParams.set('preview','1');if(monitorAudioEnabled)u.searchParams.set('monitoraudio','1')}
  return u.href;
}

// v0.11.26: compact OBS link for static hosting.
// r.html expands these compact parameters back to receiver.html locally,
// so no external URL shortener, database, API key, or server-side service is required.
function compactObsUrl({streamId=null}={}){
  const id=cleanId(streamId??activeId());
  if(!id)return '';
  if(isFixedSlot(id))return permanentObsUrl(id);
  const transport=cameraTransport(id);
  const effectiveCodec=receiverCodecFor(id,transport);
  const bitrate=String($('#bitrate').value||'8000');
  const buffer=String($('#buffer').value||'200');
  const minBitrate=String($('#smartMin').value||'1800');
  const parts=[`s=${encodeURIComponent(id)}`];
  if(transport==='direct')parts.push('d=1');
  if(bitrate!=='8000')parts.push(`b=${encodeURIComponent(bitrate)}`);
  if(buffer!=='200')parts.push(`u=${encodeURIComponent(buffer)}`);
  // H.264 is the compact receiver default. Explicitly encode Auto/VP8/VP9.
  if(effectiveCodec!=='h264'){
    const code=effectiveCodec===''?'a':effectiveCodec==='vp8'?'8':effectiveCodec==='vp9'?'9':effectiveCodec;
    parts.push(`c=${encodeURIComponent(code)}`);
  }
  if(isSmart()){parts.push('m=1');if(minBitrate!=='1800')parts.push(`n=${encodeURIComponent(minBitrate)}`)}
  const u=new URL('r.html',location.href);
  u.search=parts.join('&');
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
    ordered.forEach(c=>{const b=document.createElement('button');b.type='button';b.className='camera-chip'+(c.transport==='direct'?' direct':(c.online?' online':' offline'));b.dataset.id=c.id;const suffix=c.transport==='direct'?'NATIVE DIRECT':(c.platform||'');const dot=document.createElement('span');dot.className='presence-dot';const title=document.createTextNode(c.name+' ');const small=document.createElement('small');small.textContent=suffix;b.append(dot,title,small);chips.appendChild(b)});
    registrySignature=signature;renderMultiObs();
  }
  if(chosen){sel.value=chosen;$('#streamId').value=chosen}else{$('#streamId').value=''}
  if(chosen&&loadedProfileId!==chosen)loadReceiverProfile(chosen);
  document.querySelectorAll('#cameraChips [data-id]').forEach(b=>b.classList.toggle('active',cleanId(b.dataset.id)===chosen));
  const count=onlineCount(),direct=directCount();
  $('#discoveryStatus').textContent=count&&direct?`${count} กล้องออนไลน์ • ${direct} Native Direct`:count?`${count} กล้องออนไลน์`:direct?`${direct} Native Direct บันทึกไว้`:(chosen?'กำลังค้นหา • เปิดกล้องล่าสุดไว้แล้ว':'กำลังค้นหากล้อง…');
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
    const name=document.createElement('div');name.textContent=`${c.transport==='direct'?'🔵':(c.online?'🟢':'⚫')} ${c.name}`;
    const id=document.createElement('div');id.className='mini';id.textContent=c.transport==='direct'?`Native Direct • ${c.id}`:(c.platform||c.id);
    const input=document.createElement('input');input.readOnly=true;input.value=compactObsUrl({streamId:c.id});
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
  $('#obsUrl').value=compactObsUrl();
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
  // VDO.Ninja's data-only peer UUID can change independently of video UUID.
  // Using a stale UUID may silently drop a command (sendData returning void
  // does NOT prove delivery). Quality commands therefore use data broadcast;
  // Sender filters by targetStream *before* executing any command.
  if(payload?.command==='quality'||broadcast||fallback){
    return discoveryVdo.sendData(payload,{allowFallback:true,preference:'any'})!==false;
  }
  const c=cameras.find(x=>x.id===id);
  const target={allowFallback:true,preference:'any'};
  if(c?.uuid)target.uuid=c.uuid;
  const sent=discoveryVdo.sendData(payload,target);
  if(sent!==false)return true;
  if(target.uuid)return discoveryVdo.sendData(payload,{allowFallback:true,preference:'any'})!==false;
  return false;
}
function handleCommandAck(d,uuid=''){
  const cid=String(d?.commandId||'');if(!cid)return;
  const pending=pendingCommands.get(cid);if(!pending)return;
  // Do not let another sender's ACK complete an unrelated command.
  const target=cleanId(pending.payload?.targetStream||'');
  const from=cleanId(d?.streamID||'');
  if(target&&from&&target!==from)return;
  // First ACK is merely evidence the sender got the instruction. A second,
  // final ACK + fresh video telemetry is required before claiming success.
  if(d.phase==='received'){
    pending.received=true;
    if(pending.command==='quality'&&target===activeId()){
      setQualityStatus('มือถือรับคำสั่งแล้ว · กำลังปรับกล้อง');
    }
    setControlStatus(`มือถือรับคำสั่งแล้ว • ${pending.label}`,'warn');
    return;
  }
  pendingCommands.delete(cid);
  clearTimeout(pending.retryTimer);clearTimeout(pending.failTimer);
  if(d.ok===false){
    if(pending.command==='quality'){
      qualityErrorUntil.set(target,Date.now()+60000);
      if(target===activeId())setQualityStatus('เปลี่ยนไม่สำเร็จ: '+(d.message||'กล้องไม่รองรับ'),{retry:true});
    }
    setControlStatus(`คำสั่งไม่สำเร็จ: ${d.message||pending.command}`,'bad');
    log(`✗ ${pending.command}: ${d.message||'มือถือปฏิเสธคำสั่ง'}`);
  }else{
    if(pending.command==='quality'&&target===activeId()){
      const preset=String(pending.payload?.value||'');
      if(preset===$('#videoPreset').value&&lastTelemetry?.presetKey===preset&&qualityMatchesActual(preset,lastTelemetry.actual)){
        setQualityStatus(qualityCaptureStatus(preset,lastTelemetry));
      }else setQualityStatus('มือถือรับคำสั่งแล้ว · รอยืนยันภาพจริง');
    }
    setControlStatus(`มือถือรับคำสั่งแล้ว • ${pending.label}`,'ok');
    if(!String(pending.command).startsWith('zoom'))log(`✓ มือถือรับ ${pending.command}`);
  }
}

function setTelemetry(d,uuid=''){
  const id=cleanId(d?.streamID||'');if(!id)return;
  const transport=d?.transport==='direct'?'direct':'room';
  const c=upsertCamera({id,deviceId:d?.deviceID||d?.deviceId,name:d?.cameraName,platform:d?.platform,browser:d?.browser,transport,uuid,online:true},{render:false});
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
  if(d.publishing===true)syncVideoPreset(id,String(d.presetKey||''));
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
function sendMessageAckToSender(d,sourceUuid=''){
  if(!discoveryVdo||!d?.messageId)return;
  const ack={
    type:'remote-camera-message-ack',
    messageId:d.messageId,
    targetRole:'sender',
    targetStream:cleanId(d.streamID||''),
    ts:Date.now()
  };
  try{
    if(sourceUuid)discoveryVdo.sendData(ack,{uuid:sourceUuid,preference:'any'});
    else discoveryVdo.sendData(ack,{preference:'any'});
  }catch{}
}
function revealMessagePanelForIncoming(){
  const panel=$('#controlMessagePanel');
  if(!panel)return false;
  const wasHidden=panel.hidden;
  if(wasHidden){
    panel.hidden=false;
    const openBtn=$('#controlMessageOpen');
    if(openBtn)openBtn.setAttribute('aria-expanded','true');
  }
  const toast=$('#controlMessageToast');if(toast)toast.hidden=true;
  requestAnimationFrame(()=>{
    const history=$('#controlMessageHistory');
    if(history)history.scrollTop=0;
    if(wasHidden)panel.scrollIntoView({behavior:'smooth',block:'nearest'});
  });
  return wasHidden;
}
function handleIncomingSenderMessage(d,sourceUuid=''){
  if(d?.targetRole&&d.targetRole!=='control')return;
  const text=cleanMessageText(d?.text);if(!text)return;
  const from=cleanMessageText(d?.cameraName)||cleanId(d?.streamID)||'กล้อง';
  addControlMessage(text,{mine:false,from,ts:Number(d?.ts)||Date.now(),messageId:String(d?.messageId||'')});
  revealMessagePanelForIncoming();
  log(`ข้อความจาก ${from}: ${text}`);
  sendMessageAckToSender(d,sourceUuid);
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
  return discoveryVdo.sendData(payload,{preference:'any'});
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
  if(depth>6||value==null)return out;
  if(Array.isArray(value)){value.forEach(v=>collectListing(v,out,depth+1));return out}
  if(typeof value!=='object')return out;
  let rawId=cleanId(value.streamID||value.streamId||value.streamid||value.stream||'');
  const isPresence=rawId.startsWith('presence_cam_');
  if(isPresence)rawId=rawId.slice('presence_'.length);
  if(rawId.startsWith('cam_'))out.push({id:rawId,label:value.label||value.name||'',uuid:value.uuid||value.UUID||'',online:true,presence:isPresence});
  Object.entries(value).forEach(([k,v])=>{if(!['streamID','streamId','streamid','stream','label','name','uuid','UUID'].includes(k))collectListing(v,out,depth+1)});
  return out;
}
function rememberDiscoveryCandidate(item){
  if(!item?.id)return;
  discoveryCandidates.set(item.id,{...item,lastSeen:Date.now()});
}
function nativePlatformFromId(id){
  id=cleanId(id);
  if(id.includes('_android_'))return 'Android Native';
  if(id.includes('_ios_'))return 'iOS Native';
  return 'Native';
}
function nativeAutoName(id){
  const platform=nativePlatformFromId(id).replace(' Native','');
  const tail=cleanId(id).split('_').pop()?.slice(-8).toUpperCase()||'CAM';
  return `${platform} ${tail}`;
}
function upsertAutoDirect(item){
  const id=cleanId(item?.id||item?.streamID||item?.streamId||'');
  if(!id.startsWith('cam_'))return false;
  let c=cameras.find(x=>x.id===id);
  // Web Sender streams also appear in the room listing. Keep an already-confirmed
  // room/telemetry camera as room transport; only unconfirmed/native streams become Direct.
  if(c?.transport==='room'&&c.deviceId)return false;
  const isNew=!c;
  if(!c){
    c={id,deviceId:'',name:nativeAutoName(id),platform:nativePlatformFromId(id),browser:'',transport:'direct',online:true,lastSeen:Number.POSITIVE_INFINITY,uuid:''};
    cameras.push(c);
  }else{
    c.transport='direct';
    c.online=true;
    c.lastSeen=Number.POSITIVE_INFINITY;
    if(!c.platform)c.platform=nativePlatformFromId(id);
    if(!c.name||c.name===c.id||c.name==='Native'||c.name==='Android Native'||c.name==='iOS Native')c.name=nativeAutoName(id);
  }
  if(item?.uuid)c.uuid=String(item.uuid);
  if(item?.label&&String(item.label).trim())c.name=String(item.label).trim();
  if(isNew)log(`พบ Native Sender อัตโนมัติ: ${id}`);
  return true;
}
function handleListing(e){
  // v0.11.24: Native video stays Direct. A separate data-only Presence peer
  // announces presence_cam_* in the room; normalize it back to cam_* here.
  const list=collectListing(e?.detail??e);
  let changed=false;
  for(const item of list){
    rememberDiscoveryCandidate(item);
    if(upsertAutoDirect(item))changed=true;
  }
  if(changed){saveCameras();registrySignature='';renderRegistry(null,{force:true})}
}

async function startNativePresenceDiscovery(){
  if(nativePresenceVdo)return;
  const room=$('#room').value;
  // Native Sender v0.3.5 uses a separate SDK presence peer. This scanner joins
  // the same plain presence room without touching the existing encrypted Data Hub.
  nativePresenceVdo=new VDONinjaSDK({autoRecover:true,autoRelay:true,salt:'vdo.ninja',label:'Native Presence Scanner'});
  nativePresenceVdo.addEventListener('listing',handleListing);
  nativePresenceVdo.addEventListener('videoaddedtoroom',handleListing);
  nativePresenceVdo.addEventListener('someonejoined',handleListing);
  nativePresenceVdo.addEventListener('peerConnected',handleListing);
  nativePresenceVdo.addEventListener('connected',()=>log('Native Presence: signaling connected'));
  nativePresenceVdo.addEventListener('connectionRecovered',()=>log('Native Presence: recovered'));
  nativePresenceVdo.addEventListener('connectionFailed',e=>log(`Native Presence connection failed${e?.detail?.reason?`: ${e.detail.reason}`:''}`));
  await nativePresenceVdo.connect();
  await nativePresenceVdo.joinRoom({room,password:false});
  log(`Native Presence พร้อม: ${room}`);
}

async function startDiscovery(){
  if(discoveryVdo)return;
  $('#discoveryStatus').textContent='กำลังเปิดช่องข้อมูล…';
  await loadVDONinjaSDK(({index,total})=>log(`โหลด SDK สำหรับช่องข้อมูล ${index}/${total}`));
  const room=$('#room').value;
  await startNativePresenceDiscovery().catch(e=>log(`Native Presence เริ่มไม่สำเร็จ: ${e.message}`));
  const controlStream=controlDataStreamId(room);
  discoveryVdo=new VDONinjaSDK({autoRecover:true,autoRelay:true,salt:'remote-camera-data-v1',label:'Remote Camera Control'});
  discoveryVdo.addEventListener('connected',()=>log('ช่องข้อมูล Control: signaling connected'));
  discoveryVdo.addEventListener('peerConnected',e=>{
    dataPeerCount++;
    log(`มือถือเชื่อมช่องข้อมูลแล้ว (${dataPeerCount})`);
    $('#discoveryStatus').innerHTML=`<b>เชื่อมแล้ว</b><span>${dataPeerCount} ช่องข้อมูล</span>`;
    setTimeout(()=>{try{discoveryVdo?.sendData({type:'remote-camera-discover',ts:Date.now()},{preference:'any'})}catch{}},100);
  });
  discoveryVdo.addEventListener('peerDisconnected',()=>{
    dataPeerCount=Math.max(0,dataPeerCount-1);
    log(`มือถือหลุดจากช่องข้อมูล (${dataPeerCount})`);
    if(!dataPeerCount)$('#discoveryStatus').innerHTML='<b>กำลังรอมือถือ…</b><span>เปิด Sender และเริ่มส่งภาพ</span>';
  });
  discoveryVdo.addEventListener('peerLatency',e=>{const uuid=extractUuid(e);const c=cameras.find(x=>x.uuid===uuid);if(c?.id===activeId()){const v=e.detail?.latency??e.detail?.rtt??e.detail?.value;if(v!=null)$('#latency').textContent=`${Math.round(v)} ms`}});
  discoveryVdo.addEventListener('dataReceived',e=>{
    const d=extractData(e),uuid=extractUuid(e);
    if(d?.type==='remote-camera-telemetry')setTelemetry(d,uuid);
    else if(d?.type==='remote-camera-ack')handleCommandAck(d,uuid);
    else if(d?.type==='remote-camera-message')handleIncomingSenderMessage(d,uuid);
    else if(d?.type==='remote-camera-message-ack')handleMessageAck(d);
  });
  discoveryVdo.addEventListener('connectionRecovered',()=>log('ช่องข้อมูล Control recovered'));
  discoveryVdo.addEventListener('connectionFailed',e=>log(`ช่องข้อมูล Control connection failed${e?.detail?.reason?`: ${e.detail.reason}`:''}`));
  await discoveryVdo.connect();
  await discoveryVdo.joinRoom({room});
  await discoveryVdo.announce({streamID:controlStream,label:'Remote Camera Control'});
  log(`ช่องข้อมูล Control พร้อม: ${controlStream}`);
  $('#discoveryStatus').innerHTML='<b>กำลังรอมือถือ…</b><span>มือถือจะเชื่อมเข้ามาอัตโนมัติ</span>';
  const ping=()=>{try{discoveryVdo?.sendData({type:'remote-camera-discover',ts:Date.now()},{preference:'any'})}catch{}};
  ping();discoveryTimer=setInterval(ping,3000);
}
async function restartDiscovery(){
  if(discoveryTimer){clearInterval(discoveryTimer);discoveryTimer=null}
  try{await discoveryCtl?.stop?.()}catch{}
  try{await discoveryVdo?.stopPublishing?.()}catch{}
  try{await discoveryVdo?.disconnect?.()}catch{}
  try{await nativePresenceVdo?.disconnect?.()}catch{}
  discoveryCtl=null;discoveryVdo=null;nativePresenceVdo=null;
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
  // v0.11.2: unavailable receiver metrics are hidden instead of showing placeholder dashes.
}
function resetTelemetry(){lastTelemetry=null;setQualityStatus('รอมือถือเชื่อมต่อ');$('#telName').textContent=activeName();$('#telPlatform').textContent=activeCamera()?.platform||'-';$('#telRequested').textContent='รอข้อมูล…';['telActual','telMeasured','telCamera','telVerdict','telSmartProfile'].forEach(id=>$('#'+id).textContent='-')}

async function openSelected(){
  const id=activeId();if(!id)throw new Error('ยังไม่พบกล้อง');
  const c=activeCamera();if(c?.transport==='direct')log('เปิด Native Direct จาก Stream ID โดยตรง');else if(!c?.online)log('เปิด Preview จาก Stream ID โดยตรง — ไม่รอ Auto Discovery');
  connectedStreamId=id;smartFallbackActive=false;smartOriginalPreset=null;resetTelemetry();updateMonitorAudioUi();
  $('#remoteFrame').src=receiverUrl({preview:true,streamId:id});
  $('#status').textContent='กำลังรับภาพ';$('#status').classList.add('ok');
  log(`เปิดภาพ ${activeName()} (${id}) • ${$('#bitrate').value} kbps • ${isSmart()?'Smart':'Manual'}`);
  if(c?.transport!=='direct'){try{discoveryVdo?.sendData({type:'remote-camera-discover',targetStream:id,ts:Date.now()},{streamID:id,allowFallback:true})}catch{}}
}
function closeSelected(){
  connectedStreamId='';$('#remoteFrame').src='about:blank';smartFallbackActive=false;smartOriginalPreset=null;updateMonitorAudioUi();
  $('#status').textContent='รอกล้องออนไลน์';$('#status').classList.remove('ok');$('#latency').textContent='HQ VIEW';
  $('#smartTarget').textContent=`${(Number($('#bitrate').value)/1000).toFixed(Number($('#bitrate').value)%1000?1:0)} Mbps`;
  ['smartState','smartActual','smartLoss','smartRtt','smartJitter'].forEach(id=>{const label=id+'Label';setStatVisible(id,label,false,'-')});
  log('ปิดภาพกล้องที่เลือก');
}
function send(command,extra={}){
  const id=activeId();
  if(!discoveryVdo||!id){setControlStatus('ยังไม่พบ/เชื่อมมือถือ','bad');log('Auto Discovery ยังไม่พร้อมหรือยังไม่พบกล้อง');return null}
  const cid=commandId();
  const payload={type:'remote-camera',command,commandId:cid,...extra,ts:Date.now(),targetStream:id};
  const label=command==='front'?'กล้องหน้า':command==='rear'?'กล้องหลัง':command==='zoomDrive'?'Zoom ต่อเนื่อง':command==='zoomStop'?'หยุด Zoom':command==='zoomTarget'?'ตำแหน่ง Zoom':command;
  setControlStatus(`กำลังส่ง • ${label}`,'warn');
  try{
    if(!routeRemotePayload(payload)){
      setControlStatus(`ช่องควบคุมยังส่งคำสั่งไม่ได้ • ${label}`,'bad');
      log(`ส่ง ${command} ไม่สำเร็จ: ไม่พบช่อง Data Channel ที่เปิดอยู่`);
      return null;
    }
  }catch(e){setControlStatus(`ส่งไม่สำเร็จ: ${e.message}`,'bad');log(`Send error: ${e.message}`);return null}
  const item={command,label,payload,retryTimer:null,failTimer:null};
  pendingCommands.set(cid,item);
  item.retryTimer=setTimeout(()=>{
    if(!pendingCommands.has(cid))return;
    if(pendingCommands.get(cid)?.received)return; // do not restart active camera change
    try{routeRemotePayload(payload,{fallback:true});setControlStatus(`กำลังลองซ้ำ • ${label}`,'warn')}catch{}
  },command==='quality'?2800:650);
  item.failTimer=setTimeout(()=>{
    if(!pendingCommands.has(cid))return;
    if(!pendingCommands.get(cid)?.received){
      try{routeRemotePayload(payload,{broadcast:true})}catch{}
    }
    setTimeout(()=>{
      if(!pendingCommands.has(cid))return;
      pendingCommands.delete(cid);
      const sawReceipt=!!item.received;
      setControlStatus(`${sawReceipt?'ปรับยังไม่เสร็จ':'มือถือไม่ตอบรับ'} • ${label}`,'bad');
      log(`⚠ ${sawReceipt?'ไม่มี ACK ผลลัพธ์':'ไม่มี ACK'} สำหรับ ${command} → ${id}`);
      if(command==='quality'&&id===activeId()){
        const requested=String(payload.value||'');
        if(lastTelemetry?.presetKey===requested&&qualityMatchesActual(requested,lastTelemetry.actual)){
          // Telemetry is independent confirmation when the ACK packet was lost.
          setQualityStatus(qualityCaptureStatus(requested,lastTelemetry));
        }else{
          qualityErrorUntil.set(id,Date.now()+15000);
          setQualityStatus((sawReceipt?'มือถือรับคำสั่งแต่ยังไม่ยืนยันผล':'มือถือไม่ตอบรับ')+' · กล้องจริง '+actualQualityLabel(lastTelemetry),{retry:true});
        }
      }
    },1100);
  },command==='quality'?16000:1450);
  return cid;
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
  if(lastTelemetry?.publishing)syncVideoPreset(id,String(lastTelemetry.presetKey||''));
  try{discoveryVdo?.sendData({type:'remote-camera-discover',targetStream:id,ts:Date.now()},{streamID:id,allowFallback:true})}catch{}
}


function parseNativeDirect(value){
  let raw=String(value||'').trim();if(!raw)return '';
  try{const u=new URL(raw);raw=u.searchParams.get('view')||u.searchParams.get('stream')||raw}catch{}
  const id=cleanId(raw);return id.startsWith('cam_')?id:'';
}
function addNativeDirect(value){
  const id=parseNativeDirect(value);if(!id)throw new Error('ไม่พบ Stream ID ที่ถูกต้อง');
  let c=cameras.find(x=>x.id===id);
  const platform=id.includes('_android_')?'Android Native':id.includes('_ios_')?'iOS Native':'Native';
  if(!c){c={id,deviceId:'',name:platform,platform, browser:'',transport:'direct',online:true,lastSeen:Number.POSITIVE_INFINITY,uuid:''};cameras.push(c)}
  else{c.transport='direct';c.platform=platform;c.name=c.name&&c.name!==c.id?c.name:platform;c.online=true;c.lastSeen=Number.POSITIVE_INFINITY}
  saveCameras();registrySignature='';renderRegistry(id,{force:true});selectCamera(id,{fromUser:true}).catch(e=>log(`Native Direct open error: ${e.message}`));
  log(`เพิ่ม Native Direct: ${id}`);return id;
}
function removeSelectedDirect(){
  const id=activeId(),c=cameras.find(x=>x.id===id);if(!c||c.transport!=='direct'){log('กล้องที่เลือกไม่ใช่ Native Direct');return}
  cameras=cameras.filter(x=>x.id!==id);if(selectedCameraId===id)rememberSelectedCamera('');if(connectedStreamId===id)closeSelected();saveCameras();registrySignature='';renderRegistry(null,{force:true});log(`ลบ Native Direct: ${id}`);
}

loadFixedSlots();loadCameras();seedFixedSlots();renderFixedSlots();updateMonitorAudioUi();$('#room').value=systemRoom();if($('#roomText'))$('#roomText').textContent=$('#room').value;renderRegistry();updateObs();resetTelemetry();setControlStatus('ควบคุมกล้องจากหน้ามือถือ');
setTimeout(()=>maybeAutoOpen(),350);
RECEIVER_CONTROLS.forEach(id=>$('#'+id).addEventListener('change',()=>{
  if(isFixedSlot(activeId()))return;
  storeReceiverProfile();updateObs();renderMultiObs();reloadPreview();
}));
$('#cameraSelect').addEventListener('change',e=>selectCamera(e.target.value,{fromUser:true}).catch(x=>log(`Select error: ${x.message}`)));
$('#createPermanentSlot').addEventListener('click',()=>{
  const input=$('#permanentSlotName');
  try{const id=addFixedSlot(input.value);input.value='';selectCamera(id,{fromUser:true}).catch(()=>{});}
  catch(e){alert(e.message)}
});
$('#permanentSlotName').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('#createPermanentSlot').click()}});
$('#importPermanentSlot').addEventListener('click',()=>{
  const value=$('#importPermanentUrl').value.trim();
  const match=value.match(/cam_fixed_[a-f0-9]{32}/);
  if(!match){alert('กรุณาวางลิงก์ผู้ส่งหรือ OBS ที่สร้างจากระบบนี้');return}
  try{addFixedSlot($('#importPermanentName').value,match[0]);$('#importPermanentUrl').value='';$('#importPermanentName').value=''}
  catch(e){alert(e.message)}
});
$('#cameraChips').addEventListener('click',e=>{const b=e.target.closest('[data-id]');if(b){e.preventDefault();selectCamera(b.dataset.id,{fromUser:true}).catch(x=>log(`Select error: ${x.message}`))}});
$('#controlListenBtn').onclick=()=>{
  if(!connectedStreamId)return;
  monitorAudioEnabled=!monitorAudioEnabled;
  updateMonitorAudioUi();
  // A fresh connection is necessary: the silent preview deliberately excluded
  // incoming audio tracks. Only this Control preview reloads; OBS is unchanged.
  reloadPreview();
};
$('#controlMessageOpen').onclick=()=>{const p=$('#controlMessagePanel');p.hidden=!p.hidden;$('#controlMessageOpen').setAttribute('aria-expanded',String(!p.hidden));renderControlMessages()};
$('#controlMessageSendSelected').onclick=()=>{const input=$('#controlMessageInput');if(sendControlMessage(input.value,{broadcast:false}))input.value=''};
$('#controlMessageSendAll').onclick=()=>{const input=$('#controlMessageInput');if(sendControlMessage(input.value,{broadcast:true}))input.value=''};
$('#controlMessageInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('#controlMessageSendAll').click()}});
$('#controlMessageToast').addEventListener('click',()=>{$('#controlMessagePanel').hidden=false;$('#controlMessageToast').hidden=true;renderControlMessages()});
$('#refreshDiscovery').onclick=()=>restartDiscovery().catch(e=>log(`Discovery restart error: ${e.message}`));
$('#forgetOffline').onclick=()=>{cameras=cameras.filter(c=>c.online||isFixedSlot(c.id));if(selectedCameraId&&!cameras.some(c=>c.id===selectedCameraId))rememberSelectedCamera('');registrySignature='';saveCameras();renderRegistry(null,{force:true});log('ล้างรายการ Offline แล้ว')};
$('#addNativeDirect').onclick=()=>{try{const id=addNativeDirect($('#nativeDirectInput').value);$('#nativeDirectInput').value='';$('#nativeDirectInput').placeholder=`เพิ่มแล้ว: ${id}`}catch(e){log(`เพิ่ม Native Direct ไม่สำเร็จ: ${e.message}`);$('#nativeDirectInput').focus()}};
$('#nativeDirectInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('#addNativeDirect').click()}});
$('#removeSelectedDirect').onclick=removeSelectedDirect;
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
window.addEventListener('beforeunload',()=>{try{discoveryCtl?.stop?.()}catch{};try{discoveryVdo?.stopPublishing?.()}catch{};try{discoveryVdo?.disconnect?.()}catch{};try{nativePresenceVdo?.disconnect?.()}catch{}});
startDiscovery().catch(e=>{log(`Auto Discovery error: ${e.message}`);$('#discoveryStatus').innerHTML='<b>เชื่อมไม่สำเร็จ</b><span>กด “ค้นหากล้องใหม่” เพื่อลองอีกครั้ง</span>'});
log(`v0.11.32 พร้อม — Sender controls 720p/1080p / Native Direct + Auto Discovery + Native Telemetry • Offline grace ${OFFLINE_MS/1000}s`);
