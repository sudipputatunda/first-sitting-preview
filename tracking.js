// The descriptors last for one sitting only. Position continuity and coarse
// appearance make it less likely that a passing face will take over the canvas.
export const centre = ([x,y,w,h]) => [x+w/2,y+h/2];
export function central(faces) {
  const distance = face => Math.hypot(...centre(face.box).map(n=>n-.5));
  return faces.reduce((best,f)=>!best || distance(f)<distance(best) ? f : best,null);
}
export function describe(frame,faces) {
  const ctx=frame.getContext('2d',{willReadFrequently:true});
  const px=ctx.getImageData(0,0,frame.width,frame.height).data;
  for(const face of faces){
    const [x,y,w,h]=face.box;
    const cols=6,rows=6,vector=[];
    for(let row=0;row<rows;row++) for(let col=0;col<cols;col++){
      const xx=Math.min(frame.width-1,Math.max(0,Math.round((x+w*(.14+.72*(col+.5)/cols))*frame.width)));
      const yy=Math.min(frame.height-1,Math.max(0,Math.round((y+h*(.12+.76*(row+.5)/rows))*frame.height)));
      const i=(yy*frame.width+xx)*4;
      vector.push(px[i],px[i+1],px[i+2]);
    }
    face.appearance=vector;
  }
  return faces;
}
export function follow(faces,last,first) {
  const [a,b]=centre(last.box),w=last.box[2],h=last.box[3];
  const choices=[];
  for(const face of faces){
    const [x,y]=centre(face.box),travel=Math.hypot((x-a)/w,(y-b)/h);
    const growth=Math.abs(Math.log(face.box[2]/w));
    const delta=face.appearance.reduce((sum,v,i)=>sum+Math.abs(v-first.appearance[i]),0)/(face.appearance.length*255);
    if(travel<.84 && growth<.48 && delta<.26) choices.push({face,score:travel+.65*growth+2.2*delta});
  }
  choices.sort((a,b)=>a.score-b.score);
  if(choices.length>1 && choices[1].score-choices[0].score<.09) return null;
  return choices[0]?.face??null;
}
