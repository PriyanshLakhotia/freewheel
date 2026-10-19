import { mkdtemp, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dataDir } from './store.js';
const exec=promisify(execFile);
let installing:Promise<void>|undefined;
export function installModel():Promise<void> {
  if(installing)return installing;
  installing=download().finally(()=>{installing=undefined;});return installing;
}
async function download() {
  const folder=await mkdtemp(join(tmpdir(),'freewheel-model-'));
  try {
    const response=await fetch('https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip',{signal:AbortSignal.timeout(120000)});
    if(!response.ok)throw new Error('The offline speech model could not be downloaded. Try again later.');
    const chunks:Uint8Array[]=[];let size=0;
    const reader=response.body!.getReader();
    while(true){const {done,value:chunk}=await reader.read();if(done)break;size+=chunk.length;if(size>75*1024*1024){await reader.cancel();throw new Error('Speech model exceeded the download limit.');}chunks.push(chunk);}
    const archive=join(folder,'model.zip');await writeFile(archive,Buffer.concat(chunks));
    const {stdout}=await exec('unzip',['-Z1',archive],{maxBuffer:1024*1024});
    if(stdout.split('\n').filter(Boolean).some(path=>!path.startsWith('vosk-model-small-en-us-0.15/')||path.split('/').includes('..')))throw new Error('Unexpected speech model archive.');
    await exec('unzip',['-q',archive,'-d',folder]);
    await mkdir(dataDir,{recursive:true,mode:0o700});
    await exec('tar',['-czf',join(dataDir,'model.tar.gz.tmp'),'-C',folder,'vosk-model-small-en-us-0.15']);
    await rename(join(dataDir,'model.tar.gz.tmp'),join(dataDir,'model.tar.gz'));
  } finally {await rm(folder,{recursive:true,force:true});}
}
