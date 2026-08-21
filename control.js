const $=s=>document.querySelector(s);let vdo=null;const logEl=$('#log');
function log(m){logEl.textContent+=`[${new Date().toLocaleTimeString()}] ${m}\n`;logEl.scrollTop=logEl.scrollHeight}
function receiverUrl({preview=false}={}){
  const u=new URL('receiver.html',location.href);
  u.searchParams.set('stream',$('#streamId').value.trim());
  u.searchParams.set('bitrate',$('#bitrate').value);
  u.searchParams.set('buffer',$('#buffer').value);
  if($('#codec').value)u.searchParams.set('codec',$('#codec').value);
  if(preview)u.searchParams.set('preview','1');
  return u.href;
}
function updateObs(){
  $('#obsUrl').value=receiverUrl();
  $('#statBitrate').textContent=`${(+$('#bitrate').value/1000).toFixed($('#bitrate').value%1000?1:0)} Mbps`;
  $('#statBuffer').textContent=`${$('#buffer').value} ms`;
  $('#statCodec').textContent=$('#codec').value?$('#codec').value.toUpperCase():'Auto';
}
function reloadPreview(){const f=$('#remoteFrame');if(f.src)f.src=receiverUrl({preview:true})}
updateObs();
['room','streamId','bitrate','buffer','codec'].forEach(id=>$('#'+id).addEventListener('change',()=>{updateObs();reloadPreview()}));
$('#room').addEventListener('input',updateObs);$('#streamId').addEventListener('input',updateObs);

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
  await vdo.connect();await vdo.joinRoom({room});
  // data-only connection: ภาพจริงใช้ VDO.Ninja viewer ที่ร้องขอ bitrate สูงกว่า
  await vdo.view(streamID,{audio:false,video:false,label:'control'});
  $('#remoteFrame').src=receiverUrl({preview:true});
  log(`เปิดภาพ HQ: ${$('#bitrate').value} kbps / buffer ${$('#buffer').value} ms`);
}
async function disconnect(){
  try{if(vdo){await vdo.stopViewing?.($('#streamId').value.trim());await vdo.disconnect?.()}}catch{}
  vdo=null;$('#remoteFrame').src='about:blank';$('#status').textContent='DISCONNECTED';$('#status').classList.remove('ok');$('#latency').textContent='HQ VIEW';log('Disconnected')
}
function send(command,extra={}){if(!vdo){log('ยังไม่ได้เชื่อมต่อ Remote Control');return}const payload={type:'remote-camera',command,...extra,ts:Date.now()};try{vdo.sendData(payload);log(`ส่งคำสั่ง ${command}`)}catch(e){log(`Send error: ${e.message}`)}}
$('#connect').onclick=()=>connect().catch(e=>{log(`Connect error: ${e.message}`);vdo=null});$('#disconnect').onclick=()=>disconnect();$('#front').onclick=()=>send('front');$('#rear').onclick=()=>send('rear');
$('#zoom').oninput=e=>{$('#zoomValue').value=Number(e.target.value).toFixed(1);send('zoom',{value:Number(e.target.value)})};
$('#zoomOut').onclick=()=>{const z=$('#zoom');z.value=Math.max(+z.min,+z.value-.2);z.dispatchEvent(new Event('input'))};$('#zoomIn').onclick=()=>{const z=$('#zoom');z.value=Math.min(+z.max,+z.value+.2);z.dispatchEvent(new Event('input'))};
$('#copy').onclick=async()=>{await navigator.clipboard.writeText($('#obsUrl').value);$('#copy').textContent='คัดลอกแล้ว';setTimeout(()=>$('#copy').textContent='คัดลอก',1200)};
log('v0.4 พร้อม — Preview/OBS ใช้ bitrate ที่กำหนดจากฝั่งรับ');
