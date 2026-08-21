(()=>{
  const $=s=>document.querySelector(s);
  let timer=null;
  const standalone=()=>!!(window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone===true);
  const fsEl=()=>document.fullscreenElement||document.webkitFullscreenElement||null;
  function notice(text,ms=5200){const el=$('#fullscreenNotice');if(!el)return;el.textContent=text;el.hidden=false;clearTimeout(timer);timer=setTimeout(()=>el.hidden=true,ms)}
  function sync(){const active=!!fsEl()||standalone();document.body.classList.toggle('fullscreen-active',active);const b=$('#fullscreenBtn');if(!b)return;b.classList.toggle('is-active',active);b.title=fsEl()?'ออกจากเต็มจอ':(standalone()?'เปิดแบบแอปแล้ว':'เต็มจอ')}
  async function toggle(){
    try{
      if(fsEl()){if(document.exitFullscreen)await document.exitFullscreen();else if(document.webkitExitFullscreen)await document.webkitExitFullscreen();return}
      if(standalone()){sync();notice('กำลังเปิดแบบแอปเต็มจออยู่แล้ว');return}
      const root=document.documentElement, req=root.requestFullscreen||root.webkitRequestFullscreen;
      if(req){try{await req.call(root,{navigationUI:'hide'})}catch{await req.call(root)};sync();return}
      notice('iPhone Safari: กด Share → เพิ่มไปยังหน้าจอโฮม แล้วเปิด Remote Camera จากไอคอน เพื่อซ่อนแถบ Browser');
    }catch(e){notice(`เข้าโหมดเต็มจอไม่ได้: ${e?.message||e}`)}finally{setTimeout(sync,80)}
  }
  $('#fullscreenBtn')?.addEventListener('click',toggle);
  document.addEventListener('fullscreenchange',sync);document.addEventListener('webkitfullscreenchange',sync);
  window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change',sync);
  sync();
})();
