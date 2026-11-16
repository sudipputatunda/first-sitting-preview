import {pins} from './face-shape.js';

export const detailReady=Promise.all([
  fetch('./assets/age-mesh.json').then(r=>{if(!r.ok)throw Error('Age registration could not load.');return r.json();}),
  (async()=>{
    const image=new Image();image.src='./assets/age-relief.png';await image.decode();
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
    return {width:image.width,height:image.height,data:ctx.getImageData(0,0,image.width,image.height).data};
  })()
]);

export async function registerDetail(face,place,width,height){
  const [mesh,plate]=await detailReady, target=pins(face,place);
  const relief=new Int8Array(width*height);
  if(!target)return {relief,plate};
  for(const tri of mesh.triangles){
    const [a,b,c]=tri.map(i=>target[i]),[p,q,r]=tri.map(i=>mesh.source[i]);
    const bx=b[0]-a[0],by=b[1]-a[1],cx=c[0]-a[0],cy=c[1]-a[1],den=bx*cy-by*cx;
    if(Math.abs(den)<1)continue;
    const xmin=Math.max(0,Math.floor(Math.min(a[0],b[0],c[0]))),xmax=Math.min(width-1,Math.ceil(Math.max(a[0],b[0],c[0])));
    const ymin=Math.max(0,Math.floor(Math.min(a[1],b[1],c[1]))),ymax=Math.min(height-1,Math.ceil(Math.max(a[1],b[1],c[1])));
    for(let y=ymin;y<=ymax;y++)for(let x=xmin;x<=xmax;x++){
      const dx=x-a[0],dy=y-a[1],u=(dx*cy-dy*cx)/den,v=(dy*bx-dx*by)/den;
      if(u<0||v<0||u+v>1)continue;
      const sx=p[0]+u*(q[0]-p[0])+v*(r[0]-p[0]),sy=p[1]+u*(q[1]-p[1])+v*(r[1]-p[1]);
      if(sx<0||sy<0||sx>=plate.width-1||sy>=plate.height-1)continue;
      const ix=Math.floor(sx),iy=Math.floor(sy),k=(iy*plate.width+ix)*4,fx=sx-ix,fy=sy-iy;
      const data=plate.data,below=k+plate.width*4;
      relief[y*width+x]=Math.round((1-fy)*((1-fx)*data[k]+fx*data[k+4])+fy*((1-fx)*data[below]+fx*data[below+4])-128);
    }
  }
  return {relief,plate};
}
