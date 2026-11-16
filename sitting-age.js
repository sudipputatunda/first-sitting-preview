// One local inference on the chosen exposure. Only the estimated age enters
// the sitting. The selected face crop and prediction are never persisted.
export const finalAge=125;
let modelReady;
async function ageModel(){
  if(!modelReady){
    modelReady=(async()=>{
      await import('./vendor/face-api/face-api.min.js');
      const net=globalThis.faceapi.nets.ageGenderNet;
      await net.loadFromUri('./vendor/face-api');
      return net;
    })().catch(error=>{modelReady=null;throw error;});
  }
  return modelReady;
}

export async function startingAge(frame,face,entered){
  if(Number.isInteger(entered) && entered>=0 && entered<finalAge)return {age:entered,source:'entered'};
  const [x,y,w,h]=face.box;
  const crop=document.createElement('canvas');crop.width=crop.height=112;
  const width=w*frame.width,height=h*frame.height;
  const side=Math.min(frame.width,frame.height,Math.max(width,height)*1.12);
  const left=Math.max(0,Math.min(frame.width-side,(x+w*.5)*frame.width-side*.5));
  const top=Math.max(0,Math.min(frame.height-side,(y+h*.47)*frame.height-side*.5));
  crop.getContext('2d').drawImage(frame,left,top,side,side,0,0,112,112);
  try {
    const net=await ageModel(),prediction=await net.predictAgeAndGender(crop);
    if(Number.isFinite(prediction.age))
      return {age:Math.max(0,Math.min(120,5*Math.round(prediction.age/5))),source:'estimated'};
  }catch(error){console.warn('Age model unavailable for this sitting.',error.message);}
  return {age:45,source:'assumed'};
}

const clamp=x=>Math.max(0,Math.min(1,x));
export function ageAt(start,progress){
  return start+(finalAge-start)*clamp(progress);
}

export function agePassage(start,age){
  const span=finalAge-start,p=clamp((age-start)/span);
  // The portrait already contains the sitter's starting signs of age. Add
  // less structural change to an older starting face, on the same clock.
  const onset=clamp(p/.32),ramp=onset*onset*(3-2*onset);
  const structure=(p+.84*p*(1-p)*ramp)*Math.pow(span/85,.72);
  const last=clamp((age-Math.max(start,95))/(finalAge-Math.max(start,95)));
  const late=last*last*(3-2*last);
  const settle=clamp(p/Math.min(.82,Math.max(.52,(95-start)/span)));
  // Trial (grow): a child first grows up. Complete by 21; nothing for an adult start.
  const grown=start<21?clamp((age-start)/(21-start)):0;
  return {structure,settle:settle*settle*(3-2*settle),late,grow:grown*grown*(3-2*grown)};
}
