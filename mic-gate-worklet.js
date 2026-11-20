/* Remote Camera v0.11.40 — gentle audio noise gate on Web Audio rendering thread.
   This is a voice-level gate, NOT speech recognition / AI denoising. */
class RemoteCameraGateProcessor extends AudioWorkletProcessor {
  constructor(){
    super();this.enabled=false;this.gain=1;this.holdSamples=0;
    this.port.onmessage=e=>{
      const d=e.data||{};
      if(typeof d.enabled==='boolean')this.enabled=d.enabled;
      if(!this.enabled){this.gain=1;this.holdSamples=0}
    };
  }
  process(inputs,outputs){
    const channels=inputs[0]||[];
    const out=outputs[0]||[];
    const n=out[0]?.length||128;
    if(!channels.length){for(const o of out)o.fill(0);return true}
    if(!this.enabled){
      for(let c=0;c<out.length;c++)out[c].set(channels[Math.min(c,channels.length-1)]||channels[0]);
      this.gain=1;return true;
    }
    let power=0,count=0;
    for(const ch of channels){
      for(let i=0;i<ch.length;i++){power+=ch[i]*ch[i];count++}
    }
    const rms=Math.sqrt(power/Math.max(1,count));
    if(rms>=0.010)this.holdSamples=Math.round(sampleRate*.42);
    else this.holdSamples=Math.max(0,this.holdSamples-n);
    const target=this.holdSamples>0?1:.42; // gentle, avoid chopping quiet first syllables
    const attack=1-Math.exp(-1/(sampleRate*.012));
    const release=1-Math.exp(-1/(sampleRate*.11));
    for(let i=0;i<n;i++){
      const coeff=target>this.gain?attack:release;
      this.gain+=(target-this.gain)*coeff;
      for(let c=0;c<out.length;c++){
        const src=channels[Math.min(c,channels.length-1)]||channels[0];
        out[c][i]=(src[i]||0)*this.gain;
      }
    }
    return true;
  }
}
registerProcessor('remote-camera-gate-v1140',RemoteCameraGateProcessor);
