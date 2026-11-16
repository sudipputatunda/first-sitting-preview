// Phone: big files are fetched here, so the page can say how far it is and the
// tester's report can say how fast the connection was. The bytes are handed to
// the libraries; nothing is fetched twice.
import {note} from './report.js';
const sizes={'vision_wasm_internal.wasm':9574032,'vision_wasm_nosimd_internal.wasm':9448638,'selfie_multiclass_256x256.tflite':16371837};
const listeners=new Set();
export function onFraction(fn){listeners.add(fn);return()=>listeners.delete(fn);}
function tell(label,fraction){for(const fn of listeners){try{fn(label,fraction);}catch{/* a listener must not stop a download */}}}

export async function fetchBytes(url,label,onPart=null){
  const began=performance.now(),name=url.split('/').pop().split('?')[0];
  const response=await fetch(url);
  if(!response.ok)throw new Error(label+' answered '+response.status);
  const size=sizes[name]||(response.headers.get('content-encoding')?0:Number(response.headers.get('content-length'))||0);
  let bytes;
  if(response.body?.getReader){
    const reader=response.body.getReader(),chunks=[];let got=0,told=0;
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      chunks.push(value);got+=value.length;
      const now=performance.now();
      if(now-told>200){told=now;const part=size?Math.min(1,got/size):0;onPart?.(part);tell(label,part);}
    }
    bytes=new Uint8Array(got);let at=0;
    for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
  }else bytes=new Uint8Array(await response.arrayBuffer());
  onPart?.(1);tell(label,1);
  note(label+' file: '+(bytes.length/1048576).toFixed(1)+' MB here in '+((performance.now()-began)/1000).toFixed(1)+' s');
  return bytes;
}
