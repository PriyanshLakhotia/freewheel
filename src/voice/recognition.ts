import type { Model, KaldiRecognizer } from 'vosk-browser';
export interface RecognitionCallbacks { final:(text:string)=>void; partial:(text:string)=>void; error:(message:string)=>void; level:(value:number)=>void }
export class Recognition {
  stream?:MediaStream; context?:AudioContext;
  private browser:any; private model?:Model; private recognizer?:KaldiRecognizer;
  private processor?:ScriptProcessorNode; private source?:MediaStreamAudioSourceNode; private frame=0;
  private active=false; private suppressed=false; private restartTimer?:ReturnType<typeof setTimeout>; private failures=0;
  constructor(private callbacks:RecognitionCallbacks){}
  static browserSupported(){return !!((window as any).SpeechRecognition||(window as any).webkitSpeechRecognition);}
  async start(engine:'browser'|'offline'){
    this.active=true;
    try {
      this.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1},video:false});
      if(!this.active){this.stream.getTracks().forEach(t=>t.stop());return;}
      this.stream.getAudioTracks()[0]?.addEventListener('ended',()=>{if(this.active){this.callbacks.error('Microphone disconnected. Reconnect your earphones and start again.');this.stop();}});
      this.context=new AudioContext();await this.context.resume();this.source=this.context.createMediaStreamSource(this.stream);
      const meter=this.context.createAnalyser();meter.fftSize=256;this.source.connect(meter);const values=new Float32Array(meter.fftSize);
      const tick=()=>{if(!this.active)return;meter.getFloatTimeDomainData(values);this.callbacks.level(Math.min(1,Math.sqrt(values.reduce((a,b)=>a+b*b,0)/values.length)*5));this.frame=requestAnimationFrame(tick);};tick();
      if(engine==='offline')await this.offline();else this.webSpeech();
    } catch(error){this.stop();throw error;}
  }
  private async offline(){
    const {createModel}=await import('vosk-browser');this.model=await createModel('/api/model',-1);
    if(!this.active){this.model.terminate();return;}
    this.recognizer=new this.model.KaldiRecognizer(this.context!.sampleRate);
    this.recognizer.on('result',message=>{if(message.event==='result'&&!this.suppressed&&this.active&&message.result.text)this.callbacks.final(message.result.text);});
    this.recognizer.on('partialresult',message=>{if(message.event==='partialresult'&&!this.suppressed&&this.active)this.callbacks.partial(message.result.partial);});
    this.recognizer.on('error',()=>this.callbacks.error('Offline recognition stopped. End the ride and start again.'));
    this.processor=this.context!.createScriptProcessor(4096,1,1);
    this.processor.onaudioprocess=event=>{if(!this.suppressed&&this.active)this.recognizer?.acceptWaveform(event.inputBuffer);};
    this.source!.connect(this.processor);this.processor.connect(this.context!.destination);
  }
  private webSpeech(){
    const Constructor=(window as any).SpeechRecognition||(window as any).webkitSpeechRecognition;
    if(!Constructor)throw new Error('This browser does not support live speech. Use Chrome, or install offline recognition in Connections.');
    this.browser=new Constructor();this.browser.continuous=true;this.browser.interimResults=true;this.browser.lang='en-US';
    this.browser.onresult=(event:any)=>{this.failures=0;for(let i=event.resultIndex;i<event.results.length;i++){if(this.suppressed||!this.active)return;const text=event.results[i][0].transcript.trim();if(event.results[i].isFinal)this.callbacks.final(text);else this.callbacks.partial(text);}};
    this.browser.onerror=(event:any)=>{
      if(!this.active||this.suppressed||event.error==='aborted'||event.error==='no-speech')return;
      if(['not-allowed','service-not-allowed','audio-capture'].includes(event.error)) {this.callbacks.error('Microphone access is unavailable. Allow microphone access for Freewheel in your browser and macOS settings.');this.stop();}
      else if(++this.failures>=3){this.callbacks.error('Browser speech could not reconnect. Check your connection, or use offline recognition.');this.stop();}
    };
    this.browser.onend=()=>this.scheduleRestart();this.browser.start();
  }
  private scheduleRestart(){
    clearTimeout(this.restartTimer);if(!this.active||this.suppressed||!this.browser)return;
    this.restartTimer=setTimeout(()=>{if(this.active&&!this.suppressed)try{this.browser.start();}catch{this.scheduleRestart();}},this.failures?Math.min(4000,500*2**this.failures):200);
  }
  suppress(value:boolean){this.suppressed=value;if(value){clearTimeout(this.restartTimer);this.browser?.abort();}else this.scheduleRestart();}
  stop(){this.active=false;clearTimeout(this.restartTimer);cancelAnimationFrame(this.frame);this.browser?.abort();this.browser=undefined;this.recognizer?.remove();this.recognizer=undefined;this.model?.terminate();this.model=undefined;this.processor?.disconnect();this.source?.disconnect();this.stream?.getTracks().forEach(t=>t.stop());this.stream=undefined;void this.context?.close();this.context=undefined;}
}
