import {axes,mean} from './face-shape.js';
import {registerDetail} from './age-detail.js';
import {lastDecades} from './last-decades.js';
import {morph} from './morph.js';
import {expression} from './expression.js';
import {makePigmentation} from './surface-age.js';

export const W = 960, H = 1200;
const groundImage = new Image();
groundImage.src = './assets/painted-ground.jpg';
export function surface(w = W, h = H) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  return canvas;
}
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const smooth = (a, b, v) => { const x = clamp((v - a) / (b - a)); return x*x*(3-2*x); };
function noiseSeed(seed) {
  return () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
}

export function linen() {
  const canvas = surface(), ctx = canvas.getContext('2d');
  const pixels = ctx.createImageData(W, H), rng = noiseSeed(487);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = 4 * (y*W+x);
      const fall = 10 * ((x/W-.35)**2 + (y/H-.28)**2);
      const thread = Math.sin(x*2.6 + .2*Math.sin(y*.16)) * 2.2 + Math.cos(y*2.2)*2;
      const light = thread + (rng()-.5)*7 - fall;
      pixels.data.set([219+light,207+light,182+light,255],i);
    }
  }
  ctx.putImageData(pixels,0,0);
  return canvas;
}

// Trial (edge2). One box blur over a plane of the canvas.
function box(src,w,h,r){
  const tmp=new Float32Array(src.length),out=new Float32Array(src.length),span=2*r+1;
  for(let y=0;y<h;y++){
    const row=y*w;let sum=0;
    for(let x=-r;x<=r;x++)sum+=src[row+Math.min(w-1,Math.max(0,x))];
    for(let x=0;x<w;x++){tmp[row+x]=sum/span;sum+=src[row+Math.min(w-1,x+r+1)]-src[row+Math.max(0,x-r)];}
  }
  for(let x=0;x<w;x++){
    let sum=0;
    for(let y=-r;y<=r;y++)sum+=tmp[Math.min(h-1,Math.max(0,y))*w+x];
    for(let y=0;y<h;y++){out[y*w+x]=sum/span;sum+=tmp[Math.min(h-1,y+r+1)*w+x]-tmp[Math.max(0,y-r)*w+x];}
  }
  return out;
}
// The browser cut-out sometimes keeps a patch of the room beside an ear or
// under the hair. Near the edge, compare each pixel with the sitter's colour
// just inside and the room's colour just outside, and drop what belongs to the
// room. Where the two colours are alike the cut-out is left as it was. The
// cut-out is only ever reduced, never extended.
function trimToSitter(matte,rgba,w,h,r){
  const n=w*h,a=new Float32Array(n);
  for(let i=0;i<n;i++)a[i]=matte[4*i+3]/255;
  const soft=box(box(a,w,h,r),w,h,r),inside=new Float32Array(n),outside=new Float32Array(n);
  for(let i=0;i<n;i++){inside[i]=soft[i]>.97?1:0;outside[i]=soft[i]<.03?1:0;}
  const reach=2*r,wi=box(inside,w,h,reach),wo=box(outside,w,h,reach);
  const mean=(mask,k)=>{const s=new Float32Array(n);for(let i=0;i<n;i++)s[i]=mask[i]*rgba[4*i+k];return box(s,w,h,reach);};
  const sitter=[0,1,2].map(k=>mean(inside,k)),room=[0,1,2].map(k=>mean(outside,k));
  const out=new Uint8ClampedArray(n);
  for(let i=0;i<n;i++){
    let v=a[i];
    if(v>0 && soft[i]<.97 && wi[i]>.02 && wo[i]>.02){
      let toSitter=0,toRoom=0,apart=0;
      for(let k=0;k<3;k++){
        const s=sitter[k][i]/wi[i],o=room[k][i]/wo[i],c=rgba[4*i+k];
        toSitter+=(c-s)**2;toRoom+=(c-o)**2;apart+=(s-o)**2;
      }
      toSitter=Math.sqrt(toSitter);toRoom=Math.sqrt(toRoom);apart=Math.sqrt(apart);
      const like=toRoom/(toSitter+toRoom+.001); // 0 is the room's colour, 1 the sitter's
      v*=1-smooth(30,75,apart)*(1-smooth(.22,.42,like));
    }
    out[i]=255*v;
  }
  return out;
}
// Pull the edge in past the rim of room colour, then let it fall away gradually
// so hair and shoulders are lost into the painted ground, as an oil portrait
// loses its edges. A figure that runs off the canvas keeps its full edge.
function seatInGround(alpha,w,h,radius,from=.52,to=.96){
  const n=w*h,a=new Float32Array(n);
  for(let i=0;i<n;i++)a[i]=alpha[i];
  const soft=box(box(a,w,h,radius),w,h,radius),seated=new Uint8ClampedArray(n);
  for(let i=0;i<n;i++)seated[i]=Math.min(alpha[i],255*smooth(from,to,soft[i]/255));
  return seated;
}

const bell=(x,y,rx,ry)=>Math.exp(-.5*(x*x/(rx*rx)+y*y/(ry*ry)));
const light=(data,i)=>.25*data[i]+.60*data[i+1]+.15*data[i+2];

export async function paintPortrait(frame,face,matte,rest=null,startAge=30) {
  const [bx,by,bw,bh]=face.box,sw=frame.width,sh=frame.height;
  const input=axes(face,p=>[p[0]*sw,p[1]*sh]);
  const scale=Math.max(W/sw,H/sh,Math.min(W*.48/(bw*sw),H*.42/(bh*sh)));
  const dx=clamp(W*.5-input.ex*scale,W-sw*scale,0);
  const dy=clamp(H*.37-input.ey*scale,H-sh*scale,0);
  const placed=p=>[p[0]*sw*scale+dx,p[1]*sh*scale+dy];
  const axis=axes(face,placed),{ex,ey,d,cos,sin}=axis;
  const lips=axis.local(placed(face.lips.length?mean(face.lips):[bx+bw*.5,by+bh*.76]));
  const jaw=face.outline.map(p=>axis.local(placed(p)));
  const chin=clamp(jaw.length?Math.max(...jaw.map(p=>p[1])):lips[1]+.55,.92,2.35);
  const lip=clamp(lips[1],.58,chin-.12);
  const head=surface(),hc=head.getContext('2d',{willReadFrequently:true});
  hc.imageSmoothingQuality='high';hc.drawImage(frame,dx,dy,sw*scale,sh*scale);
  const original=hc.getImageData(0,0,W,H).data;
  const stencil=surface(),sc=stencil.getContext('2d',{willReadFrequently:true});
  sc.drawImage(matte,dx,dy,sw*scale,sh*scale);
  const silhouette=sc.getImageData(0,0,W,H).data;
  // Trial (masks): what each pixel is, placed on the canvas exactly like the cut-out.
  // 0 background, 1 hair, 2 body skin, 3 face skin, 4 clothes, 5 accessories; null if missing.
  let kind=null,hairMap=null,skinMap=null;
  if(matte.classes){
    const map=matte.classes,small=surface(map.width,map.height),smallCtx=small.getContext('2d'),cells=smallCtx.createImageData(map.width,map.height);
    for(let p=0;p<map.data.length;p++){cells.data[4*p]=map.data[p]*40;cells.data[4*p+3]=255;}
    smallCtx.putImageData(cells,0,0);
    const mapCanvas=surface(),mapCtx=mapCanvas.getContext('2d',{willReadFrequently:true});
    mapCtx.imageSmoothingEnabled=false;mapCtx.drawImage(small,dx,dy,sw*scale,sh*scale);
    const mapPixels=mapCtx.getImageData(0,0,W,H).data,isHair=new Float32Array(W*H),isSkin=new Float32Array(W*H);
    kind=new Uint8Array(W*H);
    for(let p=0;p<W*H;p++){
      const k=mapPixels[4*p+3]>128?Math.round(mapPixels[4*p]/40):0;
      kind[p]=k;isHair[p]=k===1?1:0;isSkin[p]=k===2||k===3?1:0;
    }
    hairMap=box(isHair,W,H,2);skinMap=box(isSkin,W,H,2);
  }
  // Trial (studio): the light of a painted portrait, laid on the photograph itself.
  if(kind){
    const isCloth=new Float32Array(W*H);
    for(let p=0;p<W*H;p++)isCloth[p]=kind[p]===4?1:0;
    const clothSoft=box(isCloth,W,H,3);
    for(let gy=0;gy<H;gy++)for(let gx=0;gx<W;gx++){
      const p=gy*W+gx,i=4*p;
      if(!kind[p]&&clothSoft[p]<.02)continue;
      const gu=((gx-ex)*cos+(gy-ey)*sin)/d,gv=(-(gx-ex)*sin+(gy-ey)*cos)/d;
      const l=.25*original[i]+.60*original[i+1]+.15*original[i+2],c=clothSoft[p];
      // the light is full on the face and dies away toward the shoulders
      const fall=1-.45*smooth(.6,2.0,Math.hypot(gu/1.9,(gv-.55)/2.3));
      // cloth keeps under half of its colour and about half of its light, and leans
      // toward the brown of the ground; skin and hair gain a little depth
      const keep=1+.08*(1-c)-.58*c,dim=(1-.48*c)*fall,depth=1+.07*(1-c);
      const tint=[1+.02*(1-c),1-.03*c,.97-.09*c];
      for(let k=0;k<3;k++)original[i+k]=((128+(l-128)*depth)+(original[i+k]-l)*keep)*dim*tint[k];
    }
  }
  // (masks end)
  // Trial (hair2): a camera frame is enlarged to fill the canvas, and its sensor noise
  // was being read as skin texture and hair strands. Measure fine detail on a lightly
  // smoothed copy when the picture has been enlarged.
  const rawTone=new Float32Array(W*H);
  for(let p=0;p<W*H;p++)rawTone[p]=light(original,4*p);
  const calm=scale>1.25?box(rawTone,W,H,scale>2?2:1):rawTone;
  // The light and shade of the head of hair, and the range of tones it spans.
  const hairBroad=box(rawTone,W,H,Math.max(3,Math.round(d*.03)));
  let hairLow=18,hairHigh=95;
  if(hairMap){
    const tones=[];
    for(let p=0;p<W*H;p+=7)if(hairMap[p]>.6)tones.push(hairBroad[p]);
    if(tones.length>200){tones.sort((a,b)=>a-b);hairLow=tones[Math.floor(tones.length*.08)];hairHigh=tones[Math.floor(tones.length*.92)];}
  }
  const hairSpan=Math.max(24,hairHigh-hairLow),hairGain=Math.min(2,120/hairSpan);
  // Trial (hair3): the hair at the scale of its locks: pixel noise smoothed away, the
  // light and dark of each lock kept. Grey hair is this picture of the hair, re-toned.
  const lockRadius=Math.max(1,Math.round(d*.008));
  const locks=box(box(rawTone,W,H,lockRadius),W,H,lockRadius);
  let lockLow=18,lockHigh=95;
  if(hairMap){
    const tones=[];
    for(let p=0;p<W*H;p+=7)if(hairMap[p]>.6)tones.push(locks[p]);
    if(tones.length>200){tones.sort((a,b)=>a-b);lockLow=tones[Math.floor(tones.length*.05)];lockHigh=tones[Math.floor(tones.length*.92)];}
  }
  const lockSpan=Math.max(30,lockHigh-lockLow);
  // Shoulder finding and skin sampling keep the full matte; only what is painted is trimmed and seated.
  const trimmed=trimToSitter(silhouette,original,W,H,Math.max(6,Math.round(d*.10)));
  if(kind){
    // Trial (cut2): two models must agree that a pixel is the sitter.
    const isSitter=new Float32Array(W*H);
    for(let p=0;p<W*H;p++)isSitter[p]=kind[p]?1:0;
    const agreed=box(isSitter,W,H,3);
    for(let p=0;p<W*H;p++)trimmed[p]*=smooth(.30,.62,agreed[p]);
  }
  // The colour check works pixel by pixel and leaves a ragged, dotted edge on a
  // noisy frame: even it out before seating.
  const evenEdge=new Float32Array(W*H);
  for(let p=0;p<W*H;p++)evenEdge[p]=trimmed[p];
  const seated=seatInGround(box(evenEdge,W,H,scale>1.25?2:1),W,H,Math.max(4,Math.round(d*.045)));
  const backdrop=surface(),bc=backdrop.getContext('2d');
  bc.fillStyle='#52432e';bc.fillRect(0,0,W,H);
  await groundImage.decode();bc.drawImage(groundImage,0,0,W,H);
  const ground=bc.getImageData(0,0,W,H).data;
  const {relief,plate}=await registerDetail(face,placed,W,H);
  const young=new Uint8ClampedArray(original.length),old=new Uint8ClampedArray(original.length);
  const offset=new Uint8Array(original.length),wear=new Uint8ClampedArray(original.length);
  // Relative skin luminance keeps grey hair and skin texture responsive to the sitter's own complexion.
  const samples=[],redSamples=[],blueSamples=[];
  for(const side of [-1,1])for(let v=.29;v<=.56;v+=.045)for(let u=.43;u<=.67;u+=.04){
    const [px,py]=axis.point(side*u,v);
    const idx=4*(clamp(Math.round(py),0,H-1)*W+clamp(Math.round(px),0,W-1));
    if(silhouette[idx+3]>210){
      const l=light(original,idx);samples.push(l);
      redSamples.push((original[idx]-original[idx+1])/(l+20));
      blueSamples.push((original[idx+1]-original[idx+2])/(l+20));
    }
  }
  samples.sort((a,b)=>a-b);
  const skinLuma=samples.length?samples[Math.floor(samples.length/2)]:120;
  const median=a=>a.length?a.sort((x,y)=>x-y)[Math.floor(a.length/2)]:0;
  const skinRed=median(redSamples),skinBlue=median(blueSamples);
  // Trial (hair2): is there a moustache, and is there a beard? Count how much of each
  // zone is clearly darker than the sitter's skin. The shadow under a clean-shaven
  // jaw was being turned white as if it were a beard (panel pan9).
  const darkShare=zone=>{
    let seen=0,darkSeen=0;
    for(let bv=.2;bv<chin+.1;bv+=.04)for(let bu=-1.1;bu<=1.1;bu+=.05){
      if(zone(bu-lips[0],bv)<.5)continue;
      const [px,py]=axis.point(bu,bv),xi=Math.round(px),yi=Math.round(py);
      if(xi<0||yi<0||xi>=W||yi>=H||silhouette[4*(yi*W+xi)+3]<128)continue;
      seen++;if(rawTone[yi*W+xi]<.60*skinLuma)darkSeen++;
    }
    return seen>12?darkSeen/seen:0;
  };
  const moustached=smooth(.30,.55,darkShare((bz,bv)=>bell(bz,bv-lip+.14,.34,.083)));
  const bearded=smooth(.30,.55,darkShare((bz,bv)=>Math.max(bv>.3?bell(Math.abs(bz)-.83,bv-lip*.83,.19,.48):0,bv<chin?bell(bz,bv-chin+.14,.68,.27):0)));
  // Trial (hair3): a full beard, judged on the chin zone alone (a soft or patchy cheek
  // line pulled the combined measure down on Sudip's own sitting: 0.33).
  const fullBearded=smooth(.42,.55,darkShare((bz,bv)=>bv<chin?bell(bz,bv-chin+.14,.68,.27):0));
  // Trial (older): where is there really hair?
  const darkish=new Float32Array(W*H);
  for(let p=0;p<W*H;p++)darkish[p]=silhouette[4*p+3]>128 && light(original,4*p)<.62*skinLuma?1:0;
  const thatchDark=box(darkish,W,H,Math.max(5,Math.round(d*.05)));
  // Is there a dark head of hair at all? Look at the crown, above the forehead.
  let crown=0,crownDark=0;
  for(let cv=-1.55;cv<=-.95;cv+=.06)for(let cu=-.8;cu<=.8;cu+=.08){
    const [px,py]=axis.point(cu,cv),xi=Math.round(px),yi=Math.round(py);
    if(xi<0||yi<0||xi>=W||yi>=H)continue;
    const at=4*(yi*W+xi);
    if(silhouette[at+3]<128)continue;
    crown++;if(light(original,at)<.5*skinLuma)crownDark++;
  }
  const hairy=crown>20?smooth(.10,.30,crownDark/crown):1;
  const expressionMap=new Uint8Array(original.length);
  const lateMap=new Uint8Array(original.length),latePaint=new Uint8ClampedArray(original.length);
  // Trial (grow): how much growing is left. 1 at about six years old, 0 from seventeen.
  const childhood=clamp((17-startAge)/11),stretch=1+.42*childhood,growMap=new Uint8Array(original.length);
  const finalShape=lastDecades(face,placed,axis,silhouette,W,H,chin,lip);
  const mood=expression(face,placed,axis,original,W,H,rest);
  const seed=Math.round(skinLuma*277+lip*9731+skinRed*7919+chin*3313);
  const spots=makePigmentation(axis,original,W,H,noiseSeed(seed));
  const fadedFibre=[173,161,143];
  function packDisplacement(map,i,du,dv,edgeGuard){
    const x=clamp(Math.round(32768+64*d*(du*cos-dv*sin)*edgeGuard),0,65535);
    const y=clamp(Math.round(32768+64*d*(du*sin+dv*cos)),0,65535);
    map[i]=x>>8;map[i+1]=x&255;map[i+2]=y>>8;map[i+3]=y&255;
  }
  const radius=Math.max(3,Math.round(d*.035));
  const rng=noiseSeed(36);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const pixel=y*W+x,i=pixel*4,alpha=seated[pixel];
    const u=((x-ex)*cos+(y-ey)*sin)/d,v=(-(x-ex)*sin+(y-ey)*cos)/d;
    const mid=lips[0]*smooth(-.1,lip,v),z=u-mid,abs=Math.abs(z);
    const jawBand=bell(0,v-lip*.92,1,.47),throat=smooth(chin-.13,chin+.6,v);
    const temples=bell(0,v+.23,1,.32),outer=smooth(.32,1.00,abs);
    // Inverse sampling narrows the lower face, neck and shoulders. Warp the
    // sitter's alpha along with the pigment to reveal the stationary background.
    // Trial (gaunt): fat goes from the cheek and temple while the cheekbone and
    // jaw angle keep their width; the neck thins but does not become a stalk.
    const buccal=bell(0,v-lip*.74,1,.25);
    const inset=(.105*buccal+.045*jawBand+.050*temples)*outer*(1-throat)*smooth(.18,.54,v)+throat*(.085+.02*smooth(1.2,2.5,abs));
    const eyeBag=bell(abs-.48,v-.16,.20,.13),cheek=bell(abs-.69,v-lip*.72,.22,.34);
    const eyeSag=(.072*eyeBag+.045*cheek)*smooth(.26,.53,v);
    const shoulderDrop=throat*(.14+.20*smooth(.65,1.9,abs));
    const du=z*inset,dv=-eyeSag-shoulderDrop-.055*bell(u,v-chin,.55,.20);
    const [mouthX,mouthY,cavity,lipMask,vermilion=0]=mood.at(u,v);
    let [lateX,lateY,faceLight,clothLight,noseX,noseY,eyeZone=0]=finalShape(u,v);
    // Pin the eye sockets through the bottom of the lenses. Ease into the
    // cheeks well below the rim, so the same bit of metal is never sampled twice.
    const rim=smooth(.07,.23,abs)*(1-smooth(1.10,1.45,abs))
             *smooth(-.46,-.21,v)*(1-smooth(.57,1.03,v));
    const earlyDrape=.36*smooth(chin-.32,chin+.22,v);
    const baseX=(du+earlyDrape*lateX)*(1-rim)+.40*noseX;
    const baseY=(dv+earlyDrape*lateY)*(1-rim)+.40*noseY;
    lateX=lateX*(1-rim)*(1-earlyDrape)+.60*noseX;
    lateY=lateY*(1-rim)*(1-earlyDrape)+.60*noseY;
    // At a photo edge, allocate the available fabric to the combined warps.
    // This keeps the sampling curve smooth even if a sleeve fills the crop.
    // Trial (gaunt): a smile lifts the cheeks. Let them come down and in as the
    // mouth closes, below the pinned eye sockets and lens rims.
    const lift=(mood.smile||0)*bell(abs-.64,v-lip*.80,.30,.30)*(1-rim);
    const cheekX=Math.sign(z)*.016*lift,cheekY=-.040*lift;
    const pressure=d*(1.35*Math.abs(baseX*cos-baseY*sin)+Math.abs(lateX*cos-lateY*sin)+Math.abs((mouthX+cheekX)*cos-(mouthY+cheekY)*sin));
    const margin=Math.min(x,W-1-x);
    const edgeGuard=margin/(margin+1.8*pressure+.001);
    packDisplacement(lateMap,i,lateX,lateY,edgeGuard);
    // Trial (grow): the face lengthens below the eyes and carries the neck and
    // shoulders down with it; the jaw and shoulders broaden.
    const reach=(chin-.42)*stretch;
    packDisplacement(growMap,i,-z*childhood*(.10*bell(0,v-lip*stretch,1,.55)*(1-throat)+.16*throat),
                     -(1-1/stretch)*clamp(v-.42,0,reach),1);
    packDisplacement(offset,i,baseX,baseY,edgeGuard);
    packDisplacement(expressionMap,i,mouthX+cheekX,mouthY+cheekY,edgeGuard);
    young[i+3]=alpha;
    if(!alpha){latePaint[i]=latePaint[i+1]=latePaint[i+2]=128;continue;}
    const lum=light(original,i);
    const left=4*(y*W+Math.max(0,x-2)),right=4*(y*W+Math.min(W-1,x+2));
    const up=4*(Math.max(0,y-2)*W+x),down=4*(Math.min(H-1,y+2)*W+x);
    const detail=clamp(calm[pixel]-.25*(calm[left>>2]+calm[right>>2]+calm[up>>2]+calm[down>>2]),-18,18);
    const key=1.04-.105*smooth(.24,.88,x/W)-.09*smooth(.65,1,y/H);
    const grain=(rng()-.5)*1.3;
    young[i]=(original[i]*.99+lum*.01)*key*1.025+detail*.67+grain;
    young[i+1]=original[i+1]*key*.998+detail*.67+grain;
    young[i+2]=(original[i+2]*.97+lum*.03)*key*.961+detail*.67+grain;
    const faceEnvelope=1-smooth(.97,1.16,Math.hypot(z/1.07,(v-.19)/1.84));
    const ridge=bell(abs-.67,v-.33,.24,.12);
    const hollow=bell(abs-.76,v-lip*.73,.22,.23);
    const socket=bell(abs-.48,v-.09,.23,.16);
    // Existing folds pick up contrast as the years pass. Let the borrowed
    // microrelief stay lighter on smooth, evenly lit parts of this face.
    const nearL=4*(y*W+Math.max(0,x-radius)),nearR=4*(y*W+Math.min(W-1,x+radius));
    const nearT=4*(Math.max(0,y-radius)*W+x),nearB=4*(Math.min(H-1,y+radius)*W+x);
    const fold=clamp(calm[pixel]-.25*(calm[nearL>>2]+calm[nearR>>2]+calm[nearT>>2]+calm[nearB>>2]),-15,12);
    const colourGap=Math.abs((original[i]-original[i+1])/(lum+20)-skinRed)
                    +Math.abs((original[i+1]-original[i+2])/(lum+20)-skinBlue);
    const bareSkin=1-smooth(.13,.40,colourGap);
    // Work with the sitter's existing fibres. Only locally raised, lit strands
    // pick up silver. The dark gaps between them retain their original density.
    const ratio=lum/Math.max(20,skinLuma),dark=1-smooth(.43,.89,ratio);
    const strand=smooth(.8,10,.55*Math.max(0,detail)+.85*Math.max(0,fold));
    const hairEvidence=clamp(dark+smooth(.20,.45,colourGap)*smooth(.8,4,Math.abs(detail))*.68);
    // Trial (older): hair on the head must sit among pixels darker than the skin.
    // Fair hair therefore does not turn yet (known gap), and a bare scalp is left alone.
    const thatch=smooth(.25,.60,thatchDark[pixel]);
    const scalpZone=smooth(.43,.90,-v)+smooth(.89,1.13,abs)*(1-smooth(-.23,.03,v));
    const headZone=(1-smooth(1.9,2.5,Math.hypot(u/1.15,(v+.60)/1.38)))*(1-smooth(chin-.1,chin+.25,v));
    const scalp=kind?hairMap[pixel]:clamp(scalpZone)*hairEvidence*thatch*hairy*(1-smooth(1.9,2.5,Math.hypot(u/1.15,(v+.60)/1.38)));
    const sideBeard=bell(abs-.83,v-lip*.83,.19,.48)*smooth(.22,.46,v);
    const moustache=bell(z,v-lip+.14,.34,.083);
    const jawHair=bell(z,v-chin+.14,.68,.27);
    const beardZone=clamp(sideBeard+moustache+jawHair)*(1-lipMask)*smooth(.26,.44,v);
    const beard=beardZone*hairEvidence*clamp(smooth(.12,.35,colourGap)+.67*(1-smooth(.30,.62,ratio)));
    const hair=Math.max(scalp,beard);
    // Trial (older): the whole head of hair turns in the end, not only its brightest
    // strands. Shadowed skin under a fringe is dark but skin-coloured: leave it out.
    const greyable=kind?1:1-bareSkin*smooth(.30,.50,ratio);
    // Only hair with visible strands turns. Smooth black hair has no strand contrast
    // to keep, and turning it gave a flat grey slab (panel pan5, sitter p4); it is
    // left dark until a better method exists.
    // Hair proper, not the skin at its edge: the map's soft border is cut back, and
    // beard counts only where the pixel is clearly darker than the skin (otherwise
    // the skin beside a beard or sideburn was painted white: run rep2).
    // A beard or moustache turns only if the sitter has one (see `bearded`), and never
    // on cloth; below the chin only under a full beard.
    const zoneWeight=(moustached*moustache+bearded*(sideBeard+jawHair))/(moustache+sideBeard+jawHair+.001);
    const below=1-smooth(chin+.10+.40*bearded,chin+.22+.45*bearded,v);
    const beardNear=beard*(1-smooth(.50,.78,ratio))*zoneWeight*below*(kind&&kind[pixel]===4?0:1);
    // Trial (hair3): a full beard is hair wherever the lower face is clearly darker than
    // the skin, down to well below the chin. The model calls a beard skin, so darkness
    // decides; lips, nostrils, cloth and ground are left out.
    const fullBeard=kind&&kind[pixel]>=1&&kind[pixel]<=3?Math.max(bearded,fullBearded)*smooth(.40,.58,v)*(1-smooth(chin+.80,chin+1.20,v))*(1-smooth(1.25,1.55,abs))*(1-lipMask)*(1-bell(z,v-.60*lip,.30,.10))*(1-smooth(.46,.70,ratio)):0;
    // A beard is either there or not: a half-weight veil of grey over skin read as haze.
    const beardHair=smooth(.22,.60,Math.max(beardNear,fullBeard));
    // Wisps at the hairline count as hair where they are darker than the skin, so no
    // dark rim is left between grey hair and the forehead.
    const fringe=kind?smooth(.06,.30,scalp)*(1-smooth(.55,.85,ratio)):0;
    const fibre=clamp(Math.max(kind?Math.max(smooth(.30,.80,scalp),fringe):scalp,beardHair))*greyable;
    // When this bit of hair turns: bright strands and the temples early, in drifts.
    const drift=Math.sin(x*.021+2.1*Math.sin(y*.013))*Math.sin(y*.017+1.3);
    // The temples and the chin turn first, the crown last; never strand by strand.
    const temple=smooth(.75,1.05,abs)*(1-smooth(-.9,-.5,v)),crown=smooth(.7,1.5,-v);
    const turn=Math.round(clamp(beardHair>scalp?52+34*(1-jawHair)+14*drift:74-40*temple+38*crown+18*drift,24,128));
    // Trial (malice): ears age with the face instead of staying young and pink.
    const ear=bell(abs-1.24,v-.20,.17,.44)*bareSkin;
    // Trial (older): the whole head ages, not only an ellipse round the face.
    const skin=(kind?Math.max(faceEnvelope,ear,headZone)*skinMap[pixel]:Math.max(faceEnvelope,ear,headZone*Math.max(1-smooth(.25,.60,colourGap),1-hairy)))*(1-hair)*(1-lipMask);
    const form=clamp(.5*socket+.44*hollow+.27*cheek+.4*smooth(.36,.82,-v)+.38*smooth(3,16,Math.abs(fold)));
    // Trial (palette): the wrinkle plate's deepest creases stop at a floor.
    const etch=relief[pixel]<0?-46*(1-Math.exp(1.45*relief[pixel]/46)):relief[pixel];
    const reliefLight=(etch*(.52+.50*form)+fold*.85+detail*1.3)*skin;
    const farSide=smooth(-.38,1.1,z);
    const innerBrow=bell(abs-.26,v+.22,.18,.09);
    // Trial (gaunt): a form shadow under the cheekbone in place of a round patch.
    const fall=v-(.42+(lip*.80-.42)/(.44-1.02)*(abs-1.02));
    const under=Math.exp(-.5*(fall/(fall<0?.055:.26))**2)*smooth(.34,.60,abs)*(1-smooth(1.02,1.22,abs));
    const sculpt=(.15*ridge-.14*hollow-.16*under-.145*socket-.11*bell(abs-.88,v+.17,.16,.28)
                  -.12*innerBrow-.13*farSide*bell(z-.48,v-.38,.62,.83))*skin;
    const neck=(1-smooth(.62,.93,abs))*smooth(chin-.13,chin+.12,v)
              *(1-smooth(chin+.67,chin+1.03,v))*bareSkin*(1-beard);
    let neckAge=0;
    if(neck>.002){
      const h=v-chin,cordX=.49-.36*h+.025*Math.sin(u*7);
      const tendon=bell(abs-cordX,h-.39,.038,.36)-.83*bell(abs-cordX+.067,h-.35,.046,.30);
      const arch=h+.18*z*z+.022*Math.sin(5*u+1.7);
      let crease=0;
      for(const [level,weight] of [[.24,.86],[.43,.58],[.69,.71]]){
        crease+=weight*(.48*bell(arch-level+.024,z,.018,.54)-bell(arch-level,z,.012,.56));
      }
      const tx=Math.floor((.28+.085*Math.sin(u*4.5+h))*plate.width);
      const ty=Math.floor((.53+.085*Math.sin(h*4.7+u*.2))*plate.height);
      const leather=plate.data[4*(ty*plate.width+tx)]-128;
      neckAge=neck*(leather*.48+fold*.63+(lum+24)*(.16*tendon+.16*crease-.12*bell(z,h-.05,.53,.14)));
    }
    // Trial (older): silver whose broad tone depends little on the hair's colour and
    // whose strand contrast is the hair's own, sharpened. (Scaling the whole tone
    // instead clipped fair and brown hair to a flat pale mask: run kid1.)
    // Grey hair keeps the light and shade of the head of hair; only its tone changes.
    // Trial (hair3): grey hair is the sitter's own hair re-toned, lock by lock: the dark
    // between the locks stays dark, the lit side of each lock goes silver, and nothing
    // ends darker than it began. (hair2 laid one smooth tone over the whole head and
    // drew fine lines on it: a hairnet.)
    const shade=clamp((locks[pixel]-lockLow)/lockSpan,0,1.15);
    const silver=clamp(Math.max(46+150*Math.pow(shade,.72),.92*locks[pixel]+8)+.6*(calm[pixel]-locks[pixel]),34,228);
    old[i+3]=255*clamp(.25+.58*hair+.31*form);
    const pigment=spots.density[pixel]/255*bareSkin*skin;
    const garment=smooth(chin-.13,chin+.31,v+.29*abs)
                 *smooth(.21,.45,colourGap)*(1-beardZone*hairEvidence);
    const collar=bell(0,v-chin-.64+.44*z*z,1,.16)*(1-smooth(1.0,1.53,abs));
    const shoulder=bell(abs-1.60,v-chin-.50,.56,.35);
    const rub=clamp(.22+.56*collar+.35*shoulder+.075*Math.sin(3.1*u+1.7*v)+.05*Math.sin(5.4*v-1.6*u));
    const cloth=garment*clamp(.31+.69*rub);
    // The darkest final changes follow anatomy and existing surface light.
    // Keep black interstices in hair and keep a narrow catchlight in the eyes.
    const skinTone=(faceLight-0.180*under)*faceEnvelope*(1-hair*.8)*.61;
    const falloff=.075+.17*farSide;
    const cast=smooth(-.75,1.25,z+.15*v);
    const skinDusk=(falloff*cast+0.066)*(skin+.73*neck);
    // Trial (hair3, ashen): in the last decades the hair sinks into shadow with the room;
    // the beard, which frames the mouth, sinks less.
    const silverFibre=-.42*(.25*silver+(1-.25)*lum)*fibre*(beardHair>scalp?.55:1);
    const parchment=(etch*.21+fold*.42+detail*.9)*skin;
    const fabric=garment*clothLight;
    const pallor=(skin+neck*.9)*(0.210+.13*cast);
    for(let k=0;k<3;k++){
      const base=young[i+k];
      const aged=(base+(lum-base)*Math.max(.24*skin,.34*vermilion))*(1+sculpt)+neckAge+reliefLight*clamp(.59+lum/180,.7,1.5);
      // Trial (older): hair only dulls with the years here; it turns silver in the
      // wear layer below, where each pixel has its own onset.
      old[i+k]=aged+(lum*.9+10-aged)*.45*fibre;
      const lateTone=(lum-base)*(pallor+.10*vermilion)+(lum+15)*(skinTone+fabric-skinDusk-.03*vermilion)
                    +parchment+silverFibre+neckAge*.38;
      // Trial (dread): sallow skin, and whites of the eyes gone yellow and bloodshot.
      const cool=(k-1)*(3*(skin+neck)+1.8*garment+.5*vermilion)-[1,0,4][k]*0.900*(skin+neck)+[7,-2,-9][k]*1.000*eyeZone;
      latePaint[i+k]=128+clamp(lateTone+cool,-124,124);
      if(cavity>.012){
        const seam=[53,30,29][k];
        wear[i+k]=old[i+k]+cavity*(seam-old[i+k]);
      }else if(fibre>.06){
        wear[i+k]=old[i+k]+(silver+[3,0,-7][k]-old[i+k])*fibre*.25;
      }else if(pigment>.006){
        const umber=k===0?.77:k===1?.64:.53;
        wear[i+k]=old[i+k]*(1-pigment*(1-umber));
      }else if(cloth>.015){
        const grey=lum*(.22+.78*key);
        const fibres=smooth(.6,7,Math.max(detail,fold))*(6+18*rub);
        const worn=base+(grey-base)*(.45+.22*rub)+(fadedFibre[k]-grey)*(.16+.31*rub)
                  +fibres+Math.min(0,fold)*rub*.5;
        wear[i+k]=old[i+k]+cloth*(worn-base);
      }else wear[i+k]=old[i+k];
    }
    if(cavity>.012)wear[i+3]=108;
    else if(fibre>.06)wear[i+3]=turn;
    else if(pigment>.006)wear[i+3]=spots.timing[pixel];
    else if(cloth>.015)wear[i+3]=Math.round(128-69*rub);
  }
  return morph(W,H,young,old,ground,offset,wear,expressionMap,lateMap,latePaint,growMap);
}
