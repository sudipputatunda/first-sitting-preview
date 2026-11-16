const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=(a,b,v)=>{const t=clamp((v-a)/(b-a),0,1);return t*t*(3-2*t);};
const luma=(p,i)=>.25*p[i]+.60*p[i+1]+.15*p[i+2];
// Build pigmentation once per sitting. Anchor groups to small variations in
// the sitter's own skin, then give their members individual onset times.
export function makePigmentation(axis,source,width,height,random){
  const density=new Uint8Array(width*height),timing=new Uint8Array(width*height);
  function sample(u,v){
    const [x,y]=axis.point(u,v);
    return luma(source,4*(clamp(Math.round(y),0,height-1)*width+clamp(Math.round(x),0,width-1)));
  }
  for(const side of [-1,1]){
    for(let cluster=0;cluster<7;cluster++){
      const forehead=cluster>=5;
      const originU=side*(forehead?.26+random()*.36:.61+random()*.23);
      const originV=forehead?-.56-random()*.25:.24+random()*.43;
      let u=originU,v=originV,best=-Infinity;
      for(let j=0;j<9;j++){
        const cu=originU+(random()-.5)*.13,cv=originV+(random()-.5)*.11;
        const contrast=.5*(sample(cu-.018,cv)+sample(cu+.018,cv))-sample(cu,cv);
        if(contrast>best){best=contrast;u=cu;v=cv;}
      }
      const members=1+Math.floor(random()*3);
      for(let j=0;j<members;j++){
        const [px,py]=axis.point(u+(random()-.5)*.12,v+(random()-.5)*.12);
        const rx=axis.d*(.009+random()**2*.022),ry=rx*(.68+random()*.54);
        const intensity=58+random()*137,onset=35+random()*117,angle=random()*6;
        for(let y=Math.max(0,Math.floor(py-ry*1.4));y<=Math.min(height-1,py+ry*1.4);y++)
          for(let x=Math.max(0,Math.floor(px-rx*1.4));x<=Math.min(width-1,px+rx*1.4);x++){
            const dx=(x-px)/rx,dy=(y-py)/ry,theta=Math.atan2(dy,dx);
            const radius=Math.hypot(dx,dy)/(1+.13*Math.sin(3*theta+angle)+.09*Math.sin(5*theta-angle));
            const strength=intensity*(1-smooth(.32,1.23,radius)),i=y*width+x;
            if(strength>density[i]){density[i]=strength;timing[i]=onset;}
          }
      }
    }
  }
  return {density,timing};
}
