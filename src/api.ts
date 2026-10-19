let csrf='';
export function setCsrf(value:string){csrf=value;}
export async function api<T=any>(path:string,body?:unknown,method=body===undefined?'GET':'POST'):Promise<T>{
  const res=await fetch(`/api${path}`,{method,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),'X-Freewheel-CSRF':csrf},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await res.json();if(!res.ok)throw new Error(data.error||'The companion could not complete this request.');return data;
}
export async function speechAudio(text:string):Promise<Blob>{
  const res=await fetch('/api/audio/speech',{method:'POST',headers:{'Content-Type':'application/json','X-Freewheel-CSRF':csrf},body:JSON.stringify({text})});
  if(!res.ok)throw new Error((await res.json()).error);return res.blob();
}
export async function transcribe(blob:Blob,seconds:number):Promise<string>{
  const res=await fetch(`/api/audio/transcribe?seconds=${Math.min(60,seconds).toFixed(2)}`,{method:'POST',headers:{'Content-Type':blob.type.split(';')[0],'X-Freewheel-CSRF':csrf},body:blob});
  const data=await res.json();if(!res.ok)throw new Error(data.error);return data.text;
}
