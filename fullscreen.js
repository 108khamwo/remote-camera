(()=>{
  const $=s=>document.querySelector(s);
  const UA=navigator.userAgent||'';
  const IS_IOS=/iPhone|iPad|iPod/i.test(UA) || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1);
  const btn=$('#fullscreenBtn');
  const noticeEl=$('#fullscreenNotice');

  // Safari/iOS fullscreen on a normal web page is not reliable for this camera UI.
  // Remove the control completely and do not register fullscreen listeners on iOS.
  if(IS_IOS){
    btn?.remove();
    noticeEl?.remove();
    document.body.classList.remove('fullscreen-active');
    return;
  }

  let timer=null;
  const standalone=()=>window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone===true;
  const fsEl=()=>document.fullscreenElement||document.webkitFullscreenElement||null;
  function notice(text,ms=4200){
    const el=$('#fullscreenNotice');if(!el)return;
    el.textContent=text;el.hidden=false;clearTimeout(timer);timer=setTimeout(()=>el.hidden=true,ms);
  }
  function sync(){
    const active=!!fsEl()||standalone();
    document.body.classList.toggle('fullscreen-active',active);
    const b=$('#fullscreenBtn');if(!b)return;
    b.classList.toggle('is-active',active);
    b.title=fsEl()?'ออกจากเต็มจอ':(standalone()?'เปิดแบบแอปแล้ว':'เต็มจอ');
  }
  async function toggle(){
    try{
      if(fsEl()){
        const exit=document.exitFullscreen||document.webkitExitFullscreen;
        if(exit)await exit.call(document);
        return;
      }
      if(standalone()){sync();return}
      const root=document.documentElement;
      const req=root.requestFullscreen||root.webkitRequestFullscreen;
      if(!req){notice('เบราว์เซอร์นี้ไม่รองรับโหมดเต็มจอ');return}
      await req.call(root);
    }catch(e){notice(`เข้าโหมดเต็มจอไม่ได้: ${e?.message||e}`)}finally{setTimeout(sync,80)}
  }
  btn?.addEventListener('click',toggle);
  document.addEventListener('fullscreenchange',sync);
  document.addEventListener('webkitfullscreenchange',sync);
  sync();
})();
