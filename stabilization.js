/* Remote Camera v0.11.50 — optional visual-only, low-cost motion compensation.
   Does not access, replace, mute, or process microphone/audio tracks.
   Motion is estimated from successive, small grayscale camera frames. No sensor
   permission, server, dependencies or camera re-acquisition is required.
   This reduces modest 2D handheld shake; it is NOT optical/native stabilization.
*/
(function(){
'use strict';
const SAMPLE_W=96, SAMPLE_H=54, SEARCH=5, SAMPLE_PERIOD_MS=74;
const CROP=1.13, MAX_SHIFT_RATIO=.048;
const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
function estimateShift(previous,current,w=SAMPLE_W,h=SAMPLE_H){
  if(!previous||!current||previous.length!==current.length)return {dx:0,dy:0,confidence:0};
  let best=Infinity,bx=0,by=0,zero=Infinity,second=Infinity;
  // Sparse sampling keeps the matcher inexpensive even on older iPhones.
  function cost(dx,dy){
    let total=0,n=0;
    for(let y=SEARCH+3;y<h-SEARCH-3;y+=2){
      const a=y*w, b=(y+dy)*w;
      for(let x=SEARCH+4;x<w-SEARCH-4;x+=2){
        total+=Math.abs(current[a+x]-previous[b+x+dx]);n++;
      }
    }
    return total/(n||1)+.22*(Math.abs(dx)+Math.abs(dy));
  }
  zero=cost(0,0);
  for(let dy=-SEARCH;dy<=SEARCH;dy++){
    for(let dx=-SEARCH;dx<=SEARCH;dx++){
      const c=cost(dx,dy);
      if(c<best){second=best;best=c;bx=dx;by=dy}
      else if(c<second)second=c;
    }
  }
  // A tiny/no improvement means noise/low-texture, not a tracked motion.
  const confidence=(zero-best)/Math.max(2,zero);
  if(!Number.isFinite(confidence)||confidence<.025 || (bx===0&&by===0))return {dx:0,dy:0,confidence:0};
  // Reject large movements at the edge of search: this is usually a pan,
  // scene cut, or the phone turning, not the small jitter we aim to correct.
  if(Math.abs(bx)===SEARCH||Math.abs(by)===SEARCH)return {dx:0,dy:0,confidence};
  // Subpixel refinement reduces visible discrete jumps (at 1080p one sample
  // pixel otherwise equals ~20 pixels of output).
  const refine=(negative,center,positive)=>{
    const d=negative-2*center+positive;
    return d>0?clamp(.5*(negative-positive)/d,-.5,.5):0;
  };
  const sx=bx+refine(cost(bx-1,by),best,cost(bx+1,by));
  const sy=by+refine(cost(bx,by-1),best,cost(bx,by+1));
  return {dx:sx,dy:sy,confidence};
}
function readGray(ctx){
  const {data}=ctx.getImageData(0,0,SAMPLE_W,SAMPLE_H);
  const gray=new Uint8Array(SAMPLE_W*SAMPLE_H);
  for(let i=0,j=0;i<gray.length;i++,j+=4){gray[i]=(data[j]*3+data[j+1]*6+data[j+2])/10}
  return gray;
}
function create(cameraVideo,displayCanvas,{onFailure=()=>{},fps=30}={}){
  if(!displayCanvas?.captureStream||!cameraVideo)throw new Error('เบราว์เซอร์ไม่รองรับภาพกันสั่น');
  const ctx=displayCanvas.getContext('2d',{alpha:false,desynchronized:true});
  if(!ctx)throw new Error('ไม่สามารถเปิดตัวประมวลผลภาพ');
  const small=document.createElement('canvas');small.width=SAMPLE_W;small.height=SAMPLE_H;
  const sampleCtx=small.getContext('2d',{willReadFrequently:true});
  if(!sampleCtx)throw new Error('ไม่สามารถอ่านภาพสำหรับกันสั่น');
  let previous=null,pathX=0,pathY=0,smoothX=0,smoothY=0,offsetX=0,offsetY=0;
  let running=true,readyDone=false,raf=0,renderedFrames=0,perfStarted=0;
  let lowFpsCount=0,lastDraw=0,lastSample=0,currentW=0,currentH=0,failures=0;
  let videoCallbackMode=typeof cameraVideo.requestVideoFrameCallback==='function';
  let resolveReady,rejectReady;
  const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject});
  let readyTimeout=setTimeout(()=>{if(!readyDone){readyDone=true;rejectReady(new Error('กล้องยังไม่มีภาพสำหรับกันสั่น'))}},2200);
  let stream=null,track=null;
  function resetTracking(){previous=null;pathX=pathY=smoothX=smoothY=offsetX=offsetY=0;lastSample=0;perfStarted=0;renderedFrames=0;lowFpsCount=0}
  function doFrame(now){
    if(!running)return;
    if(document.visibilityState==='hidden')return;
    // Maximum 30 fps canvas; high frame rate camera settings remain on raw track.
    if(now-lastDraw<(1000/Math.min(30,Math.max(12,fps)))-3)return;
    if(cameraVideo.readyState<2||!cameraVideo.videoWidth||!cameraVideo.videoHeight)return;
    const w=cameraVideo.videoWidth|0,h=cameraVideo.videoHeight|0;
    if(w!==currentW||h!==currentH){
      currentW=w;currentH=h;displayCanvas.width=w;displayCanvas.height=h;
      resetTracking();
    }
    lastDraw=now;
    try{
      if(now-lastSample>=SAMPLE_PERIOD_MS){
        sampleCtx.drawImage(cameraVideo,0,0,SAMPLE_W,SAMPLE_H);
        const cur=readGray(sampleCtx);
        if(previous){
          const motion=estimateShift(previous,cur);
          if(motion.confidence>.025){
            // Positive image motion must be canceled with a negative offset.
            pathX+= -motion.dx * (w/SAMPLE_W);
            pathY+= -motion.dy * (h/SAMPLE_H);
            smoothX+=(pathX-smoothX)*.28;
            smoothY+=(pathY-smoothY)*.28;
            // Avoid accumulating unbounded drift during long camera pans.
            const maxX=w*MAX_SHIFT_RATIO,maxY=h*MAX_SHIFT_RATIO;
            pathX=clamp(pathX,smoothX-maxX*1.7,smoothX+maxX*1.7);
            pathY=clamp(pathY,smoothY-maxY*1.7,smoothY+maxY*1.7);
          }else{smoothX+=(pathX-smoothX)*.22;smoothY+=(pathY-smoothY)*.22}
        }
        previous=cur;lastSample=now;
      }
      const x=clamp(smoothX-pathX,-w*MAX_SHIFT_RATIO,w*MAX_SHIFT_RATIO);
      const y=clamp(smoothY-pathY,-h*MAX_SHIFT_RATIO,h*MAX_SHIFT_RATIO);
      offsetX+=(x-offsetX)*.32;offsetY+=(y-offsetY)*.32;
      const destW=w*CROP,destH=h*CROP;
      ctx.drawImage(cameraVideo,(w-destW)/2+offsetX,(h-destH)/2+offsetY,destW,destH);
      failures=0;renderedFrames++;
      if(!readyDone){readyDone=true;clearTimeout(readyTimeout);resolveReady()}
      // Guard: if processed frames become persistently slow, fall back to
      // raw camera rather than degrading the live broadcast and microphone.
      if(!perfStarted)perfStarted=now;
      if(now-perfStarted>=3000){
        const actual=renderedFrames*1000/(now-perfStarted);
        if(now>9000&&actual<18)lowFpsCount++;else lowFpsCount=0;
        perfStarted=now;renderedFrames=0;
        if(lowFpsCount>=2){running=false;onFailure(new Error('กันสั่นทำงานช้าเกินไป จึงกลับไปใช้กล้องปกติ'));return}
      }
    }catch(e){
      failures++;
      if(failures>=4){running=false;onFailure(e)}
    }
  }
  function onVideoFrame(now){if(!running)return;doFrame(now);if(running)cameraVideo.requestVideoFrameCallback(onVideoFrame)}
  function onRaf(now){if(!running)return;doFrame(now);raf=requestAnimationFrame(onRaf)}
  // The API emits a camera-sized capture track after first painted frame.
  function begin(){
    if(videoCallbackMode)cameraVideo.requestVideoFrameCallback(onVideoFrame);
    else raf=requestAnimationFrame(onRaf);
  }
  begin();
  const initialize=ready.then(()=>{
    if(!running)throw new Error('กันสั่นถูกปิด');
    stream=displayCanvas.captureStream(Math.min(30,Math.max(12,fps)));
    track=stream.getVideoTracks()[0];
    if(!track)throw new Error('เบราว์เซอร์สร้างแทร็กกันสั่นไม่ได้');
    try{track.contentHint='motion'}catch{}
    return track;
  });
  return {
    ready:initialize,
    get track(){return track},
    resetTracking,
    stop(){running=false;clearTimeout(readyTimeout);if(raf)cancelAnimationFrame(raf);if(stream)stream.getTracks().forEach(t=>{try{t.stop()}catch{}});resetTracking()},
    get running(){return running}
  };
}
window.RemoteCameraStabilizer={create,estimateShift};
})();
