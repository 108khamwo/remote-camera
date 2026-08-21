const $=s=>document.querySelector(s);let vdo=null;const logEl=$('#log');
let lastTelemetry=null,smartFallbackActive=false,smartOriginalPreset=null,lastSmartQualityChange=0;
function log(m){logEl.textContent+=`[${new Date().toLocaleTimeString()}] ${m}\n`;logEl.scrollTop=logEl.scrollHeight}
function isSmart(){return $('#networkMode').value==='smart'}
function receiverUrl({preview=false}={}){
  const u=new URL('receiver.html',location.href);
  u.searchParams.set('room',$('#room').value.trim());
  u.searchParams.set('stream',$('#streamId').value.trim());
  u.searchParams.set('bitrate',$('#bitrate').value);
  u.searchParams.set('buffer',$('#buffer').value);
  if($('#codec').value)u.searchParams.set('codec',$('#codec').value);
  if(isSmart()){
    u.searchParams.set('smart','1');
    u.searchParams.set('minbitrate',$('#smartMin').value);
  }
  if(preview)u.searchParams.set('preview','1');
  return u.href;
}
function updateObs(){
  $('#obsUrl').value=receiverUrl();
  $('#statBitrate').textContent=`${(+$('#bitrate').value/1000).toFixed($('#bitrate').value%1000?1:0)} Mbps`;
  $('#statBuffer').textContent=`${$('#buffer').value} ms`;
  $('#statCodec').textContent=$('#codec').value?$('#codec').value.toUpperCase():'Auto';
  $('#statNetworkMode').textContent=isSmart()?'SMART — ปรับอัตโนมัติ':'MANUAL — คง bitrate';
  $('#smartMinWrap').classList.toggle('hidden',!isSmart());
  $('#smartFallbackWrap').classList.toggle('hidden',!isSmart());
}
function reloadPreview(){const f=$('#remoteFrame');if(f.src&&f.src!=='about:blank')f.src=receiverUrl({preview:true})}
function setTelemetry(d){
  lastTelemetry=d;
  const req=d?.requested||{}, act=d?.actual||{};
  const reqF=Number(req.fps||0), actF=Number(act.fps||0), meas=Number(d?.measuredFps||0);
  if(!smartFallbackActive && d?.presetKey)smartOriginalPreset=d.presetKey;
  $('#telRequested').textContent=reqF?`${req.width||'?'}×${req.height||'?'} @≤${reqF}`:'-';
  $('#telActual').textContent=(act.width||act.height)?`${act.width||'?'}×${act.height||'?'} @${actF?actF.toFixed(1):'?'} fps`:'-';
  $('#telMeasured').textContent=meas?`${meas.toFixed(1)} fps`:'กำลังวัด…';
  $('#telCamera').textContent=d?.cameraLabel||act.facingMode||'-';
  let verdict='ค่าปกติ';
  if(reqF>=55){
    if(actF && actF<50) verdict=`Safari/กล้องจำกัดที่ ~${actF.toFixed(0)} fps`;
    else if(meas && meas<50) verdict=`settings ใกล้ 60 แต่เฟรมจริง ~${meas.toFixed(0)} fps`;
    else if(meas>=50) verdict=`ฝั่งกล้องผ่าน 60 fps ✓ (${meas.toFixed(1)})`;
    else verdict='กำลังทดสอบ 60 fps…';
  } else if(meas){ verdict=`ฝั่งกล้อง ~${meas.toFixed(1)} fps`; }
  $('#telVerdict').textContent=verdict;
  $('#telSmartProfile').textContent=d?.smartProfile||'ปกติ';
}
function extractData(e){return e?.detail?.data??e?.detail??e?.data}
function fmt(n,d=1,suffix=''){return Number.isFinite(Number(n))?`${Number(n).toFixed(d)}${suffix}`:'-'}
function stateThai(s){return ({good:'ดี',fair:'พอใช้',weak:'อ่อน',critical:'วิกฤต',waiting:'กำลังวัด'})[s]||s||'-'}
function handleReceiverStats(d){
  $('#smartState').textContent=stateThai(d.state);
  $('#smartTarget').textContent=d.currentBitrate?`${(d.currentBitrate/1000).toFixed(d.currentBitrate%1000?1:0)} Mbps`:'-';
  $('#smartActual').textContent=d.bitrateKbps?`${(d.bitrateKbps/1000).toFixed(2)} Mbps`:'-';
  $('#smartLoss').textContent=d.lossPct!=null?fmt(d.lossPct,2,'%'):'-';
  $('#smartRtt').textContent=d.rttMs!=null?fmt(d.rttMs,0,' ms'):'-';
  $('#smartJitter').textContent=d.jitterMs!=null?fmt(d.jitterMs,0,' ms'):'-';
  const badge=$('#smartBadge');
  badge.textContent=isSmart()?`SMART ${stateThai(d.state)}`:'MANUAL';
  badge.classList.toggle('ok',d.state==='good');
  if(d.action==='bitrate'&&d.reason)log(`Smart Network → ${(d.currentBitrate/1000).toFixed(1)} Mbps (${d.reason})`);

  if(!isSmart()||!vdo||$('#smartFallback').value!=='1')return;
  const now=Date.now();
  if(d.fallbackRecommended && !smartFallbackActive && now-lastSmartQualityChange>10000){
    const current=lastTelemetry?.presetKey||smartOriginalPreset||'';
    if(current && current!=='720_30'){
      smartOriginalPreset=smartOriginalPreset||current;
      smartFallbackActive=true;lastSmartQualityChange=now;
      send('quality',{value:'720_30',reason:'Smart Network: ฉุกเฉิน 720p30'});
      log('⚠ Smart Network: bitrate ถึงขั้นต่ำแล้วยังไม่เสถียร → ลดกล้องเป็น 720p30 ชั่วคราว');
    }
  }
  if(d.restoreRecommended && smartFallbackActive && now-lastSmartQualityChange>18000){
    const restore=smartOriginalPreset||'1080_30';
    smartFallbackActive=false;lastSmartQualityChange=now;
    send('quality',{value:restore,reason:`Smart Network: คืน ${restore}`});
    log(`✓ Smart Network: เครือข่ายฟื้น → คืนคุณภาพ ${restore}`);
  }
}

updateObs();
['room','streamId','bitrate','buffer','codec','networkMode','smartMin','smartFallback'].forEach(id=>$('#'+id).addEventListener('change',()=>{updateObs();reloadPreview()}));
$('#room').addEventListener('input',updateObs);$('#streamId').addEventListener('input',updateObs);
window.addEventListener('message',e=>{
  if(e.source!==$('#remoteFrame').contentWindow)return;
  const d=e.data;if(d?.type==='remote-camera-receiver-stats')handleReceiverStats(d);
});

async function connect(){
  if(vdo)return;
  log('กำลังโหลด WebRTC SDK สำหรับ Remote Control…');
  await loadVDONinjaSDK(({index,total})=>log(`โหลด SDK ${index}/${total}`));
  const room=$('#room').value.trim(),streamID=$('#streamId').value.trim();
  if(!room||!streamID)throw new Error('กรุณาระบุ Room และ Stream ID');
  vdo=new VDONinjaSDK({autoRecover:true,autoRelay:true,salt:'vdo.ninja'});
  vdo.addEventListener('connected',()=>{$('#status').textContent='CONTROL CONNECTED';$('#status').classList.add('ok');log('Remote control signaling connected')});
  vdo.addEventListener('peerLatency',e=>{const v=e.detail?.latency??e.detail?.rtt??e.detail?.value;if(v!=null)$('#latency').textContent=`${Math.round(v)} ms`});
  vdo.addEventListener('connectionRecovered',()=>log('Control recovered'));
  vdo.addEventListener('connectionFailed',()=>log('Control connection failed'));
  vdo.addEventListener('dataReceived',e=>{const d=extractData(e);if(d?.type==='remote-camera-telemetry')setTelemetry(d)});
  await vdo.connect();await vdo.joinRoom({room});
  await vdo.view(streamID,{audio:false,video:false,label:'control'});
  $('#remoteFrame').src=receiverUrl({preview:true});
  log(`เปิดภาพ: สูงสุด ${$('#bitrate').value} kbps / ${isSmart()?'Smart Network':'Manual'} / buffer ${$('#buffer').value} ms`);
}
async function disconnect(){
  try{if(vdo){await vdo.stopViewing?.($('#streamId').value.trim());await vdo.disconnect?.()}}catch{}
  vdo=null;$('#remoteFrame').src='about:blank';smartFallbackActive=false;smartOriginalPreset=null;
  $('#telRequested').textContent='รอข้อมูล…';$('#telActual').textContent='-';$('#telMeasured').textContent='-';$('#telCamera').textContent='-';$('#telVerdict').textContent='-';$('#telSmartProfile').textContent='-';
  $('#smartState').textContent='-';$('#smartTarget').textContent='-';$('#smartActual').textContent='-';$('#smartLoss').textContent='-';$('#smartRtt').textContent='-';$('#smartJitter').textContent='-';$('#smartBadge').textContent='NETWORK';$('#smartBadge').classList.remove('ok');
  $('#status').textContent='DISCONNECTED';$('#status').classList.remove('ok');$('#latency').textContent='HQ VIEW';log('Disconnected')
}
function send(command,extra={}){if(!vdo){log('ยังไม่ได้เชื่อมต่อ Remote Control');return}const payload={type:'remote-camera',command,...extra,ts:Date.now()};try{vdo.sendData(payload);log(`ส่งคำสั่ง ${command}`)}catch(e){log(`Send error: ${e.message}`)}}
$('#connect').onclick=()=>connect().catch(e=>{log(`Connect error: ${e.message}`);vdo=null});$('#disconnect').onclick=()=>disconnect();$('#front').onclick=()=>send('front');$('#rear').onclick=()=>send('rear');
$('#zoom').oninput=e=>{$('#zoomValue').value=Number(e.target.value).toFixed(1);send('zoom',{value:Number(e.target.value)})};
$('#zoomOut').onclick=()=>{const z=$('#zoom');z.value=Math.max(+z.min,+z.value-.2);z.dispatchEvent(new Event('input'))};$('#zoomIn').onclick=()=>{const z=$('#zoom');z.value=Math.min(+z.max,+z.value+.2);z.dispatchEvent(new Event('input'))};
$('#copy').onclick=async()=>{await navigator.clipboard.writeText($('#obsUrl').value);$('#copy').textContent='คัดลอกแล้ว';setTimeout(()=>$('#copy').textContent='คัดลอก',1200)};
log('v0.6 พร้อม — เพิ่ม Smart Network ลด/เพิ่ม bitrate ตาม packet loss, RTT และ jitter');
