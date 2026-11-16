// Look for connected lens reflections crossing the pupil. White sclera and
// the small catchlight of a normally lit eye should remain in the portrait.
const size=48;
const sample=document.createElement('canvas');sample.width=sample.height=size;
const ctx=sample.getContext('2d',{willReadFrequently:true});
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const luma=(p,i)=>.24*p[i]+.60*p[i+1]+.16*p[i+2];

function inspectEye(frame,points,pupil){
  const xs=points.map(p=>p[0]*frame.width),ys=points.map(p=>p[1]*frame.height);
  const w=Math.max(...xs)-Math.min(...xs);
  if(w<5)return null;
  const cx=(Math.max(...xs)+Math.min(...xs))*.5,cy=(Math.max(...ys)+Math.min(...ys))*.5;
  const width=w*1.65,height=w*1.05,x=cx-width/2,y=cy-height/2;
  ctx.clearRect(0,0,size,size);ctx.drawImage(frame,x,y,width,height,0,0,size,size);
  const p=ctx.getImageData(0,0,size,size).data,n=size*size;
  const px=clamp(((pupil?pupil[0]*frame.width:cx)-x)/width*size,17,31);
  const py=clamp(((pupil?pupil[1]*frame.height:cy)-y)/height*size,17,31);
  const ambient=[];
  for(let j=35;j<46;j++)for(let i=5;i<43;i+=2)ambient.push(luma(p,4*(j*size+i)));
  ambient.sort((a,b)=>a-b);
  const skinLight=ambient[Math.floor(ambient.length*.48)];
  const candidate=new Uint8Array(n),core=new Uint8Array(n),mask=new Uint8Array(n);
  let coreArea=0;
  for(let j=0;j<size;j++)for(let i=0;i<size;i++){
    const k=j*size+i,o=k*4,r=p[o],g=p[o+1],b=p[o+2],l=luma(p,o);
    const pale=l>Math.max(167,Math.min(225,skinLight+39)) && Math.max(r,g,b)-Math.min(r,g,b)<62;
    const tinted=(b-r>19 || g-r>20) && Math.max(b,g)>117 && l>Math.max(63,skinLight*.66);
    candidate[k]=Number(pale||tinted);
    if(((i-px)/5.0)**2+((j-py)/6.7)**2<1){core[k]=1;coreArea++;}
  }
  const queue=new Int32Array(n);let severity=0;
  for(let seed=0;seed<n;seed++){
    if(!candidate[seed])continue;
    candidate[seed]=0;let count=1,head=0,iris=0,lo=size,hi=0;queue[0]=seed;
    while(head<count){
      const k=queue[head++],i=k%size,j=Math.floor(k/size);
      iris+=core[k];lo=Math.min(lo,j);hi=Math.max(hi,j);
      for(const next of [i>0?k-1:-1,i+1<size?k+1:-1,k-size,k+size]){
        if(next>=0 && next<n && candidate[next]){candidate[next]=0;queue[count++]=next;}
      }
    }
    if(count<25 || hi-lo<4)continue;
    const coverage=iris/Math.max(1,coreArea);
    // A broad bright patch extending above/below the open eye is unlike sclera.
    const crossesLid=hi-lo>9 && (lo<py-4 || hi>py+5);
    const risk=coverage*(crossesLid?1.5:.70)+Math.min(.13,count/n*.40);
    if(risk<.13)continue;
    severity=Math.max(severity,risk);
    for(let q=0;q<count;q++)mask[queue[q]]=255;
  }
  return {x,y,width,height,mask,severity};
}

export function lensGlare(frame,face){
  const eyes=face.eyes.map((g,i)=>g.length?inspectEye(frame,g,face.pupils?.[i]?.[0]):null).filter(Boolean);
  const severity=Math.max(0,...eyes.map(eye=>eye.severity));
  return {eyes:eyes.filter(e=>e.severity>.13),severity,blocked:severity>.63};
}

export function softenGlare(frame,result){
  if(!result?.eyes.length || result.blocked)return frame;
  const out=document.createElement('canvas');out.width=frame.width;out.height=frame.height;
  const target=out.getContext('2d',{willReadFrequently:true});target.drawImage(frame,0,0);
  for(const eye of result.eyes){
    const x=Math.max(0,Math.floor(eye.x)),y=Math.max(0,Math.floor(eye.y));
    const w=Math.min(out.width-x,Math.ceil(eye.width)),h=Math.min(out.height-y,Math.ceil(eye.height));
    if(w<=0||h<=0)continue;
    const region=target.getImageData(x,y,w,h),p=region.data;
    for(let j=0;j<h;j++)for(let i=0;i<w;i++){
      const sx=Math.round((x+i-eye.x)*size/eye.width),sy=Math.round((y+j-eye.y)*size/eye.height);
      if(sx<1||sy<1||sx>=size-1||sy>=size-1)continue;
      let support=0;for(let yy=-1;yy<=1;yy++)for(let xx=-1;xx<=1;xx++)support+=eye.mask[(sy+yy)*size+sx+xx];
      const a=support/(9*255),k=4*(j*w+i),r=p[k],g=p[k+1],b=p[k+2];
      // Attenuate additive reflected light only where detail is still visible.
      p[k]=r-a*(12+8*eye.severity);p[k+1]=g-a*(13+Math.max(0,g-r)*.44);
      p[k+2]=b-a*(14+Math.max(0,b-r)*.58);
    }
    target.putImageData(region,x,y);
  }
  return out;
}
