// Tester's report (preview builds): what this device did during a sitting.
// It is kept on this device. Nothing is sent anywhere; the sitter may read it,
// copy it, or take a screenshot of it.
const born=performance.now(),events=[],tally=new Map();
const panel=document.querySelector('#report'),text=document.querySelector('#report-text');
let last='',slow=0,current=null,head;
const seconds=ms=>(ms/1000).toFixed(1);
const at=()=>seconds(performance.now()-born).padStart(6)+'s  ';

export function note(line){
  line=String(line).slice(0,170);
  if(line===last)return;
  last=line;events.push(at()+line);
  if(events.length>60)events.splice(10,1);
  if(panel?.open)draw();
}
// Every message shown under the painting: first appearance in the timeline,
// and the time spent under each (numbers folded so counts do not split them).
export function said(message){
  const now=performance.now(),key=String(message).replace(/\d+/g,'#');
  if(current)tally.get(current.key).ms+=now-current.since;
  if(!tally.has(key)){tally.set(key,{ms:0,n:0});note('says: '+message);}
  tally.get(key).n++;current={key,since:now};
}
export async function timed(label,promise){
  const began=performance.now();
  try{const value=await promise;note(label+' ready in '+seconds(performance.now()-began)+' s');return value;}
  catch(error){note('ERROR '+label+': '+(error?.message||error));throw error;}
}
export function waiting(){clearTimeout(slow);slow=setTimeout(()=>{note('still preparing after 25 s');trouble();},25000);}
export function settled(){clearTimeout(slow);}
export function trouble(){if(panel){panel.open=true;draw();}}

function device(){
  const lines=[],ua=navigator.userAgent;
  lines.push((ua.match(/\(([^)]*)\)/)?.[1]||'').slice(0,70)+' · '+(ua.match(/(CriOS|FxiOS|EdgiOS|Chrome|Firefox|Version)\/[\d.]+/)?.[0]||'')+(/Safari/.test(ua)?' Safari':''));
  lines.push('screen '+screen.width+'x'+screen.height+' @'+devicePixelRatio+' · window '+innerWidth+'x'+innerHeight+' · cores '+(navigator.hardwareConcurrency||'?')
    +(navigator.deviceMemory?' · memory '+navigator.deviceMemory+' GB':'')+' · full screen '+(document.documentElement.requestFullscreen?'offered':'not offered'));
  try{
    const c=document.createElement('canvas'),gl=c.getContext('webgl');
    if(!gl)lines.push('webgl: not available');
    else{
      const info=gl.getExtension('WEBGL_debug_renderer_info');
      lines.push('webgl: '+String(info?gl.getParameter(info.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)).slice(0,60)
        +' · '+gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)+' textures at once · largest '+gl.getParameter(gl.MAX_TEXTURE_SIZE)
        +' · highp '+(gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER,gl.HIGH_FLOAT).precision>0?'yes':'NO'));
      gl.getExtension('WEBGL_lose_context')?.loseContext();c.width=c.height=0;
    }
  }catch(error){lines.push('webgl: '+error.message);}
  const net=navigator.connection;
  if(net)lines.push('network '+(net.effectiveType||'?')+(net.downlink?' '+net.downlink+' Mbps':''));
  return lines;
}
function draw(){
  if(!text)return;
  head??=device();
  const now=performance.now();
  const under=[...tally].map(([key,v])=>[key,v.ms+(current?.key===key?now-current.since:0),v.n])
    .sort((a,b)=>b[1]-a[1]).slice(0,12).map(([key,ms,n])=>seconds(ms).padStart(6)+'s  '+n+'x  '+key);
  text.textContent=[document.querySelector('.sitting-title span')?.textContent||'First Sitting',...head,'',...events,
    '','time under each message:',...under].join('\n');
}
panel?.addEventListener('toggle',()=>{if(panel.open)draw();});
document.querySelector('#report-copy')?.addEventListener('click',async event=>{
  draw();
  try{await navigator.clipboard.writeText(text.textContent);event.target.textContent='Copied';}
  catch{
    const range=document.createRange();range.selectNodeContents(text);
    const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
    event.target.textContent='Selected · now copy';
  }
});
addEventListener('error',event=>note('ERROR '+event.message+' @ '+String(event.filename).split('/').pop()+':'+event.lineno));
addEventListener('unhandledrejection',event=>note('ERROR (unhandled) '+(event.reason?.message||event.reason)));
note('page opened');
