const $=s=>document.querySelector(s); const logEl=$('#log');
function log(m){const t=new Date().toLocaleTimeString();logEl.textContent+=`[${t}] ${m}\n`;logEl.scrollTop=logEl.scrollHeight}
let cameraStream=null,audioStream=null,outStream=null,vdo=null,raf=0,currentFacing='environment',isPublishing=false,lastRemoteTs=0;
const video=$('#cameraVideo'),canvas=$('#outCanvas'),ctx=canvas.getContext('2d',{alpha:false});
function q(){const v=$('#quality').value;return v==='1080'?{w:1920,h:1080}:v==='720'?{w:1280,h:720}:{w:960,h:540}}
function videoConstraints(extra={}){const {w,h}=q();return {width:{ideal:w},height:{ideal:h},frameRate:{ideal:30,max:30},...extra}}
async function listDevices(){const ds=await navigator.mediaDevices.enumerateDevices();const cams=ds.filter(d=>d.kind==='videoinput');const sel=$('#deviceSelect');sel.innerHTML='<option value="">อัตโนมัติ</option>';cams.forEach((d,i)=>{const o=document.createElement('option');o.value=d.deviceId;o.textContent=d.label||`Camera ${i+1}`;sel.appendChild(o)});log(`พบกล้อง ${cams.length} รายการ`)}
function setupCanvas(){const {w,h}=q();if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;$('#statOutput').textContent=`${w}×${h} @30`}}
function drawLoop(){setupCanvas();const cw=canvas.width,ch=canvas.height;if(video.readyState>=2&&video.videoWidth){const vw=video.videoWidth,vh=video.videoHeight;const scale=Math.max(cw/vw,ch/vh);const dw=vw*scale,dh=vh*scale;ctx.drawImage(video,(cw-dw)/2,(ch-dh)/2,dw,dh)}raf=requestAnimationFrame(drawLoop)}
async function ensureMic(){if(audioStream)return;audioStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});$('#statMic').textContent='ON';log('เปิดไมโครโฟนแล้ว')}
function stopCameraOnly(){if(cameraStream){cameraStream.getTracks().forEach(t=>t.stop());cameraStream=null}}
async function openCamera({facing=currentFacing,deviceId=''}={}){if(!navigator.mediaDevices?.getUserMedia)throw new Error('เบราว์เซอร์ไม่รองรับ getUserMedia');
  stopCameraOnly(); currentFacing=facing; let vc;
  if(deviceId) vc=videoConstraints({deviceId:{exact:deviceId}}); else vc=videoConstraints({facingMode:{ideal:facing}});
  cameraStream=await navigator.mediaDevices.getUserMedia({video:vc,audio:false}); video.srcObject=cameraStream; await video.play();
  const track=cameraStream.getVideoTracks()[0],s=track.getSettings(); $('#statCamera').textContent=`${s.width||'?'}×${s.height||'?'} ${s.frameRate||''}`;$('#camBadge').textContent=track.label||facing; await configureZoom(track); await listDevices();
  if(!raf)drawLoop(); log(`เปิดกล้อง: ${track.label||facing}`); return track;
}
async function configureZoom(track){const caps=track.getCapabilities?track.getCapabilities():{};const z=$('#zoomRange');if(caps.zoom){z.disabled=false;z.min=caps.zoom.min;z.max=caps.zoom.max;z.step=caps.zoom.step||0.1;z.value=track.getSettings().zoom||caps.zoom.min;$('#zoomInfo').textContent=`Zoom ${caps.zoom.min} – ${caps.zoom.max}`;}else{z.disabled=true;z.min=1;z.max=1;z.value=1;$('#zoomInfo').textContent='Safari/อุปกรณ์นี้ไม่เปิด Zoom API ให้เว็บ';}}
async function setZoom(value){const t=cameraStream?.getVideoTracks()[0];if(!t?.applyConstraints)return;const caps=t.getCapabilities?.();if(!caps?.zoom)return;const v=Math.max(caps.zoom.min,Math.min(caps.zoom.max,Number(value)));await t.applyConstraints({advanced:[{zoom:v}]});$('#zoomRange').value=v;log(`Zoom ${v}`)}
async function buildOutStream(){setupCanvas();if(!raf)drawLoop();const cs=canvas.captureStream(30);await ensureMic();outStream=new MediaStream([...cs.getVideoTracks(),...audioStream.getAudioTracks()]);return outStream}
async function startPublishing(){if(isPublishing)return; if(!cameraStream)await openCamera({facing:currentFacing});const stream=await buildOutStream();const room=$('#room').value.trim(),streamID=$('#streamId').value.trim();if(!room||!streamID)throw new Error('กรุณาระบุ Room และ Stream ID');vdo=new VDONinjaSDK({autoRecover:true,autoRelay:true});
  vdo.addEventListener('connected',()=>{$('#statRtc').textContent='signaling connected';log('เชื่อม signaling แล้ว')});
  vdo.addEventListener('publishing',()=>{isPublishing=true;$('#liveBadge').textContent='LIVE';$('#liveBadge').classList.add('ok');$('#statRtc').textContent='PUBLISHING';log('เริ่มส่ง WebRTC แล้ว')});
  vdo.addEventListener('connectionRecovered',()=>log('WebRTC recovered'));
  vdo.addEventListener('connectionFailed',()=>log('WebRTC connection failed'));
  const onData=e=>{const d=e.detail?.data??e.detail??e.data;if(d&&typeof d==='object')handleRemote(d)};vdo.addEventListener('dataReceived',onData);
  await vdo.connect();await vdo.joinRoom({room});await vdo.publish(stream,{room,streamID,label:streamID});isPublishing=true;$('#liveBadge').textContent='LIVE';$('#liveBadge').classList.add('ok');$('#statRtc').textContent='PUBLISHING';
}
async function handleRemote(d){if(d.type!=='remote-camera')return;if(d.ts&&d.ts===lastRemoteTs)return;if(d.ts)lastRemoteTs=d.ts;$('#statRemote').textContent=`คำสั่ง: ${d.command}`;log(`Remote: ${d.command}`);try{if(d.command==='front')await openCamera({facing:'user'});if(d.command==='rear')await openCamera({facing:'environment'});if(d.command==='zoom')await setZoom(d.value);if(d.command==='device'&&d.deviceId)await openCamera({deviceId:d.deviceId});}catch(e){log(`Remote error: ${e.message}`)}}
async function stopAll(){try{if(vdo){await vdo.stopPublishing?.();await vdo.disconnect?.()}}catch{}isPublishing=false;stopCameraOnly();if(audioStream){audioStream.getTracks().forEach(t=>t.stop());audioStream=null}if(outStream){outStream.getTracks().forEach(t=>t.stop());outStream=null}cancelAnimationFrame(raf);raf=0;ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);$('#liveBadge').textContent='OFFLINE';$('#liveBadge').classList.remove('ok');$('#statRtc').textContent='OFFLINE';$('#statMic').textContent='-';log('หยุดทั้งหมด')}
$('#startCamera').onclick=()=>openCamera({facing:currentFacing}).catch(e=>log(`Camera error: ${e.message}`));
$('#startSend').onclick=()=>startPublishing().catch(e=>log(`Publish error: ${e.message}`));
$('#stopBtn').onclick=()=>stopAll();
$('#frontBtn').onclick=()=>openCamera({facing:'user'}).catch(e=>log(`Switch error: ${e.message}`));
$('#rearBtn').onclick=()=>openCamera({facing:'environment'}).catch(e=>log(`Switch error: ${e.message}`));
$('#deviceSelect').onchange=e=>{if(e.target.value)openCamera({deviceId:e.target.value}).catch(x=>log(`Device error: ${x.message}`))};
$('#zoomRange').oninput=e=>setZoom(e.target.value).catch(x=>log(`Zoom error: ${x.message}`));
$('#zoomOutBtn').onclick=()=>{const z=$('#zoomRange');if(!z.disabled)setZoom(Number(z.value)-Number(z.step||.1))};
$('#zoomInBtn').onclick=()=>{const z=$('#zoomRange');if(!z.disabled)setZoom(Number(z.value)+Number(z.step||.1))};
$('#quality').onchange=()=>{setupCanvas();log('เปลี่ยน Output; หากต้องการให้กล้อง capture ตามความละเอียดใหม่ ให้สลับกล้องหรือเปิดกล้องใหม่')};
window.addEventListener('beforeunload',()=>stopAll());if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});setupCanvas();log('พร้อมใช้งาน — ต้องเปิดผ่าน HTTPS บน iPhone');
