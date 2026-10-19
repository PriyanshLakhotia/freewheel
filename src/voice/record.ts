export function recordCommand(stream:MediaStream,context:AudioContext,signal:AbortSignal):Promise<{blob:Blob;seconds:number}>{
  return new Promise((resolve,reject)=>{
    const mime=['audio/webm;codecs=opus','audio/mp4','audio/webm'].find(type=>MediaRecorder.isTypeSupported(type));
    const recorder=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);const chunks:Blob[]=[];
    const source=context.createMediaStreamSource(stream);const analyser=context.createAnalyser();source.connect(analyser);analyser.fftSize=1024;
    const buffer=new Float32Array(analyser.fftSize);let spoke=false;let lastVoice=Date.now();const start=Date.now();let aborted=false;
    recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    const end=()=>{if(recorder.state!=='inactive')recorder.stop();};
    const abort=()=>{aborted=true;end();};signal.addEventListener('abort',abort,{once:true});
    const interval=setInterval(()=>{
      analyser.getFloatTimeDomainData(buffer);const rms=Math.sqrt(buffer.reduce((sum,x)=>sum+x*x,0)/buffer.length);
      if(rms>0.018){spoke=true;lastVoice=Date.now();}
      if((spoke&&Date.now()-lastVoice>1600)||(!spoke&&Date.now()-start>9000)||Date.now()-start>45000)end();
    },100);
    recorder.onstop=()=>{clearInterval(interval);source.disconnect();signal.removeEventListener('abort',abort);if(aborted){reject(new Error('Recording cancelled.'));return;}if(!spoke){reject(new Error('No speech heard. Say the wake phrase and try again.'));return;}resolve({blob:new Blob(chunks,{type:recorder.mimeType}),seconds:(Date.now()-start)/1000});};
    recorder.onerror=()=>{clearInterval(interval);source.disconnect();reject(new Error('Recording failed. Check your microphone.'));};
    recorder.start(200);if(signal.aborted)abort();
  });
}
