import {lensGlare} from './glare.js';
import {mouthPose} from './expression.js';
// Score the eyes, nose and cheeks at a common scale so camera resolutions and
// sitter distance do not turn into different focus scores. Only the best full
// exposure is retained, together with the landmarks from that exact exposure.
const crop=document.createElement('canvas');
crop.width=crop.height=112;
const ctx=crop.getContext('2d',{willReadFrequently:true});
const limit=(x,a,b)=>Math.max(a,Math.min(b,x));

// Trial (composed): the camera prefers a composed look. Among exposures of the
// same sitter, a closed unsmiling mouth and eyes looking straight at the camera
// score higher. Both terms only subtract from the score, and either one is 0
// whenever it cannot be measured, so a failure never changes v1 behaviour.
const smoothstep=(a,b,x)=>{const t=limit((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const irisSample=document.createElement("canvas");
irisSample.width=64;irisSample.height=32;
const irisCtx=irisSample.getContext("2d",{willReadFrequently:true});

// Smile and open mouth, in eye-distance units so face size does not matter.
// lift: how far the two outer mouth corners sit above the centre of the lip
// line (a smile raises them). gap: how far the inner lips stand apart.
// 0 for a closed level mouth, up to 2.2 for a broad open smile.
function smileLook(frame,face){
  const pose=mouthPose(face,frame.width,frame.height);
  if(!pose || pose.line.length<3)return {smile:0};
  const inner=pose.line.slice(1,-1);
  const centre=inner.reduce((s,p)=>s+p[1],0)/inner.length;
  const lift=centre-(pose.line[0][1]+pose.line.at(-1)[1])/2;
  const smile=1.1*smoothstep(.02,.12,lift)+1.1*smoothstep(.04,.16,pose.gap);
  return {smile:Number.isFinite(smile)?smile:0,lift,gap:pose.gap};
}

// Where the darkest part of one eye (iris and pupil) sits between its two
// corners, read from the pixels inside the eye outline: 0 when centred, +1 or
// -1 at a corner, positive towards the right of the frame.
function irisOffset(frame,ring){
  if(ring.length!==6)return null;
  const P=ring.map(p=>[p[0]*frame.width,p[1]*frame.height]);
  const [a,b]=[P[0],P[3]].sort((p,q)=>p[0]-q[0]);
  const half=Math.hypot(b[0]-a[0],b[1]-a[1])/2;
  if(!(half>=3))return null;
  const ux=(b[0]-a[0])/(2*half),uy=(b[1]-a[1])/(2*half),mx=(a[0]+b[0])/2,my=(a[1]+b[1])/2;
  const xs=P.map(p=>p[0]),ys=P.map(p=>p[1]);
  const x0=Math.min(...xs),y0=Math.min(...ys),w=Math.max(...xs)-x0,h=Math.max(...ys)-y0;
  if(!(w>=4 && h>=1))return null;
  irisCtx.clearRect(0,0,64,32);
  irisCtx.drawImage(frame,x0,y0,w,h,0,0,64,32);
  const rgba=irisCtx.getImageData(0,0,64,32).data,inside=[];
  for(let j=0;j<32;j++)for(let i=0;i<64;i++){
    const px=x0+(i+.5)*w/64,py=y0+(j+.5)*h/32;
    let hit=false;
    for(let k=0,m=5;k<6;m=k++){
      const [xi,yi]=P[k],[xj,yj]=P[m];
      if((yi>py)!==(yj>py) && px<(xj-xi)*(py-yi)/(yj-yi)+xi)hit=!hit;
    }
    if(hit){const o=4*(j*64+i);inside.push([.24*rgba[o]+.60*rgba[o+1]+.16*rgba[o+2],px,py]);}
  }
  if(inside.length<24)return null;
  // The darkest quarter of the eye opening is the iris and pupil.
  inside.sort((p,q)=>p[0]-q[0]);
  const dark=inside.slice(0,Math.max(6,Math.round(inside.length*.25)));
  const cx=dark.reduce((s,p)=>s+p[1],0)/dark.length,cy=dark.reduce((s,p)=>s+p[2],0)/dark.length;
  const offset=((cx-mx)*ux+(cy-my)*uy)/half;
  return Number.isFinite(offset)?offset:null;
}

// Eyes turned aside: the mean of both eyes offsets (both move the same way
// when the sitter looks aside), 0 when centred, up to 2.5 when clearly turned.
// Spectacle reflections make the dark centroid unreliable, so half weight then.
function gazeLook(frame,face,glare){
  const offsets=face.eyes.map(ring=>irisOffset(frame,ring));
  if(offsets.length!==2 || offsets.includes(null))return {gaze:0,offsets};
  const mean=(offsets[0]+offsets[1])/2;
  const weight=glare.severity>.13?1.25:2.5;
  const gaze=weight*smoothstep(.10,.35,Math.abs(mean));
  return {gaze:Number.isFinite(gaze)?gaze:0,offsets,mean};
}

function composedLook(frame,face,glare){
  let mouth={smile:0},eyes={gaze:0};
  try{mouth=smileLook(frame,face);}catch(e){mouth={smile:0,error:String(e)};}
  try{eyes=gazeLook(frame,face,glare);}catch(e){eyes={gaze:0,error:String(e)};}
  return {smile:mouth.smile,gaze:eyes.gaze,mouth,eyes};
}

export function assess(frame,face) {
  const [x,y,w,h]=face.box;
  const facePixels=w*frame.width;
  if(facePixels<Math.min(185,frame.width*.155))
    return {reason:'Step a little closer so the eyes and skin resolve clearly'};
  ctx.drawImage(frame,(x+w*.13)*frame.width,(y+h*.15)*frame.height,w*.74*frame.width,h*.64*frame.height,0,0,112,112);
  const rgba=ctx.getImageData(0,0,112,112).data, gray=new Float32Array(112*112);
  let clipped=0,light=0;
  for(let i=0;i<gray.length;i++){
    const k=i*4,l=.24*rgba[k]+.60*rgba[k+1]+.16*rgba[k+2];
    gray[i]=l;light+=l;if(l<12||l>246)clipped++;
  }
  const mean=light/gray.length;
  if(mean<23 || mean>239 || clipped/gray.length>.53)
    return {reason:'Turn towards soft light so the camera can see your features'};
  let edges=0;
  for(let y=1;y<111;y++)for(let x=1;x<111;x++){
    const i=y*112+x;
    const lap=4*gray[i]-gray[i-1]-gray[i+1]-gray[i-112]-gray[i+112];
    edges+=Math.min(1600,lap*lap);
  }
  const focus=Math.sqrt(edges/(110*110));
  if(focus<1.65)return {reason:'Hold still for a sharper exposure'};
  function eyeGeometry(points){
    if(!points.length)return null;
    const xs=points.map(p=>p[0]*frame.width),ys=points.map(p=>p[1]*frame.height);
    return {x:xs.reduce((a,b)=>a+b)/xs.length,y:ys.reduce((a,b)=>a+b)/ys.length,
      open:(Math.max(...ys)-Math.min(...ys))/Math.max(1,Math.max(...xs)-Math.min(...xs))};
  }
  const eyes=face.eyes.map(eyeGeometry).filter(Boolean);
  let pose=0,open=0;
  if(eyes.length===2){
    const distance=Math.abs(eyes[0].x-eyes[1].x);
    pose=limit(distance/facePixels,0,.5)*16-limit(Math.abs(eyes[0].y-eyes[1].y)/Math.max(1,distance),0,.5)*5;
    open=limit(Math.min(eyes[0].open,eyes[1].open),0,.34)*13;
  }
  const exposure=1-Math.abs(mean-117)/145;
  const glare=lensGlare(frame,face);
  if(glare.blocked)return {reason:'Tilt your chin slightly so the reflection moves off your eyes',reflection:true};
  // Trial (composed): v1 score, every term unchanged, less the two penalties.
  const look=composedLook(frame,face,glare);
  const score=2.8*Math.log1p(focus)+pose+open+2.5*exposure+Math.min(2.5,facePixels/170)-12*glare.severity;
  return {glare,score:score-look.smile /* eye direction is measured but not yet trusted: notes/composed_notes.md */,composed:{smile:look.smile,gaze:look.gaze},look};
}

export const samplingSeconds=8;
export function collect(candidate,frame,face,now){
  if(now-candidate.lastSample<650)return;
  candidate.lastSample=now;
  const quality=assess(frame,face);
  candidate.reason=quality.reason;candidate.reflection=Boolean(quality.reflection);
  if(quality.reason)return;
  candidate.count++;
  const pose=mouthPose(face,frame.width,frame.height);
  if(pose && pose.gap<=.065 && (!candidate.rest || quality.score>candidate.rest.score))
    candidate.rest={pose,score:quality.score};
  if(!candidate.best || quality.score>candidate.best.score)
    candidate.best={frame,face,pose,score:quality.score,glare:quality.glare};
}
