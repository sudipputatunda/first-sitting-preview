// The web edition supplies the contours expected by the unchanged Mac renderer.
// dlib's 68 points describe centre lines for the brows and omit pupil centres.
import { describe } from './tracking.js';

let modelLoad;
export function loadModels(){
  if(!modelLoad){
    modelLoad=(async()=>{
      await import('./vendor/face-api/face-api.min.js');
      const api=globalThis.faceapi;
      await Promise.all([
        api.nets.tinyFaceDetector.loadFromUri('./vendor/face-api'),
        api.nets.faceLandmark68TinyNet.loadFromUri('./vendor/face-api')
      ]);
      return api;
    })().catch(error=>{modelLoad=null;throw error;});
  }
  return modelLoad;
}

function mix(a,b,t){
  return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
}
function faceContours(result,width,height,offsetX,offsetY){
  const p=result.landmarks.positions.map(q=>[(q.x+offsetX)/width,(q.y+offsetY)/height]);
  const {x,y,width:w,height:h}=result.detection.box;
  const group=(...indices)=>indices.map(i=>p[i]);
  // Vision begins both eyes and brows at the outer corner and follows the top.
  const eyes=[group(36,37,38,39,40,41),group(45,44,43,42,47,46)];
  const thick=h/height*.016;
  function brow(indices){
    const centre=indices.map(i=>p[i]);
    return [...centre.map(([x,y])=>[x,y-thick*.5]),...centre.reverse().map(([x,y])=>[x,y+thick*.5])];
  }
  const brows=[brow([17,19,21]),brow([26,24,22])];
  const nose=[p[28],mix(p[31],p[28],.39),...group(31,32,33,34,35),mix(p[35],p[28],.39)];
  // The skin relief's first vertex is on the upper left lip, after its corner.
  const lips=[mix(p[48],p[49],.5),...group(49,50,51,52,53),mix(p[53],p[54],.5),...group(54,55,56,57,58,59,48)];
  return {box:[(x+offsetX)/width,(y+offsetY)/height,w/width,h/height],eyes,brows,nose,lips,
    outline:p.slice(0,17).reverse(),innerLips:group(61,62,63,65,66,67),pupils:[[],[]]};
}

// Retry on the portable CPU backend when a mobile WebGL driver cannot run
// the detector. Network tensors remain accessible when switching backends.
export async function useCPU(){
  const api=await loadModels();
  if(api.tf.getBackend()==='cpu')return;
  await api.tf.setBackend('cpu');
}

export async function browserFaces(frame,{fast=false,searchCentre=false}={}){
  const api=await loadModels(),w=frame.width,h=frame.height;
  let input=frame,offsetX=0,offsetY=0;
  if(searchCentre){
    const side=Math.round(Math.min(w,h)*.88);
    offsetX=Math.round((w-side)/2);offsetY=Math.round((h-side)*.38);
    input=document.createElement('canvas');input.width=input.height=side;
    input.getContext('2d').drawImage(frame,offsetX,offsetY,side,side,0,0,side,side);
  }
  const options=new api.TinyFaceDetectorOptions({inputSize:fast ? 320 : 416,scoreThreshold:searchCentre ? .26 : .33});
  const detect=()=>api.detectAllFaces(input,options).withFaceLandmarks(true);
  let results;
  try{results=await detect();}
  catch(error){
    if(api.tf.getBackend()!=='webgl')throw error;
    await useCPU();results=await detect();
  }
  const found=results.map(r=>faceContours(r,w,h,offsetX,offsetY)).filter(f=>f.box[2]>.035 && f.box[3]>.045);
  if(input!==frame){input.width=0;input.height=0;}
  return describe(frame,found);
}
