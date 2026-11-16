import {axes} from './face-shape.js';

// Work in the sitter's eye-aligned coordinates. The inside and outside lip
// contours let an open smile close by actually bringing its two edges together.
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const gaussian=(a,b)=>Math.exp(-.5*(a*a+b*b));
function span(polygon,x){
  const hits=[];
  for(let i=0;i<polygon.length;i++){
    const [ax,ay]=polygon[i],[bx,by]=polygon[(i+1)%polygon.length];
    if(x<Math.min(ax,bx)||x>=Math.max(ax,bx))continue;
    hits.push(ay+(by-ay)*(x-ax)/(bx-ax));
  }
  return hits.length>=2?[Math.min(...hits),Math.max(...hits)]:null;
}

// A second, naturally relaxed exposure can supply a lip line in eye-aligned
// coordinates. Retain only the geometry, never composite another photograph.
export function mouthPose(face,width,height){
  if(!face.innerLips?.length || !face.lips?.length || !face.nose?.length)return null;
  const place=p=>[p[0]*width,p[1]*height],axis=axes(face,place);
  const local=points=>points.map(p=>axis.local(place(p)));
  const inside=local(face.innerLips),outer=local(face.lips).sort((a,b)=>a[0]-b[0]);
  const top=inside.slice(0,Math.floor(inside.length/2));
  const bottom=inside.slice(top.length).reverse();
  if(top.length<2 || top.length!==bottom.length)return null;
  const line=top.map(([x,y],i)=>[(x+bottom[i][0])*.5,(y+bottom[i][1])*.5]);
  const gap=top.reduce((n,p,i)=>n+Math.abs(bottom[i][1]-p[1]),0)/top.length;
  const nose=local(face.nose),tip=nose.reduce((a,b)=>a[1]>b[1]?a:b);
  return {line:[outer[0],...line,outer.at(-1)].sort((a,b)=>a[0]-b[0]),gap,tip};
}

export function restingLine(opening,relaxed){
  if(!opening || !relaxed || relaxed.gap>.065 || opening.gap-relaxed.gap<.058)return null;
  const dx=opening.tip[0]-relaxed.tip[0],dy=opening.tip[1]-relaxed.tip[1];
  if(Math.hypot(dx,dy)>.115)return null;
  const line=relaxed.line.map(([x,y])=>[x+dx,y+dy]);
  const a=opening.line,b=line,wide=a.at(-1)[0]-a[0][0],ratio=(b.at(-1)[0]-b[0][0])/wide;
  if(ratio<.55 || ratio>1.12 || Math.abs(a[0][1]-b[0][1])>.23 || Math.abs(a.at(-1)[1]-b.at(-1)[1])>.23)return null;
  return line;
}

export function expression(face,place,axis,image,width,height,rest){
  const coords=p=>axis.local(place(p)),outer=face.lips.map(coords);
  if(outer.length<4)return {at:()=>[0,0,0,0]};
  const byX=outer.slice().sort((a,b)=>a[0]-b[0]),left=byX[0],right=byX.at(-1);
  const cx=(left[0]+right[0])*.5,half=(right[0]-left[0])*.5;
  if(half<.10)return {at:()=>[0,0,0,0]};
  const interior=(face.innerLips||[]).map(coords);
  const top=interior.slice(0,Math.ceil(interior.length/2)).sort((a,b)=>a[0]-b[0]);
  const bottom=interior.slice(top.length).sort((a,b)=>b[0]-a[0]);
  const opening=[left,...top,right,...bottom];
  const centreOpening=span(opening,cx);
  const showTeeth=centreOpening && centreOpening[1]-centreOpening[0]>.025;
  const rows=[],count=97;
  for(let j=0;j<count;j++){
    const u=cx+half*(2*(j+.02)/(count-.96)-1);
    const lips=span(outer,u) || [j<count/2?left[1]:right[1],j<count/2?left[1]:right[1]];
    const mid=(lips[0]+lips[1])*.5;
    let [high,low]=span(opening,u) || [mid,mid];
    // Vision's sparse inner contour sometimes clips the outermost teeth.
    for(let v=lips[0]+.012;showTeeth && v<lips[1]-.012;v+=.007){
      const [x,y]=axis.point(u,v),i=4*(clamp(Math.round(y),0,height-1)*width+clamp(Math.round(x),0,width-1));
      const r=image[i],g=image[i+1],b=image[i+2];
      if(g>107 && r-g<.25*g && g-b<.33*g && b>g*.65){high=Math.min(high,v);low=Math.max(low,v);}
    }
    rows.push([high,Math.max(high,low),lips[0],lips[1]]);
  }
  // Trial (mouth): landmarks alone often report a small opening on a closed
  // mouth, and closing that phantom opening draws a dark straight line across
  // the lip. Trust an opening only where the photograph shows teeth or a dark gap.
  let seen=0,gapPixels=0;
  const pixelAt=(u,v)=>{
    const [x,y]=axis.point(u,v),i=4*(clamp(Math.round(y),0,height-1)*width+clamp(Math.round(x),0,width-1));
    return [image[i],image[i+1],image[i+2]];
  };
  const lightOf=([r,g,b])=>.25*r+.60*g+.15*b;
  for(let j=0;j<=24;j++){
    const u=cx+half*(-.62+1.24*j/24),s=span(opening,u);
    if(!s || s[1]-s[0]<.012)continue;
    const lipLight=.5*(lightOf(pixelAt(u,s[0]-.035))+lightOf(pixelAt(u,s[1]+.035)));
    for(let v=s[0]+.004;v<s[1]-.004;v+=.006){
      const [r,g,b]=pixelAt(u,v);seen++;
      if((g>107 && r-g<.25*g && g-b<.33*g && b>g*.65) || lightOf([r,g,b])<lipLight*.55)gapPixels++;
    }
  }
  if(seen<6 || gapPixels/seen<.30)for(const row of rows){const closed=(row[0]+row[1])*.5;row[0]=row[1]=closed;}
  const central=rows.slice(39,58),mid=central.reduce((s,[a,b])=>s+(a+b)*.5,0)/central.length;
  const gap=central.reduce((s,[a,b])=>s+b-a,0)/central.length;
  const smile=clamp((mid-(left[1]+right[1])*.5)*3+gap*1.4,0,1);
  const brows=face.brows.filter(g=>g.length).map(g=>{
    const pts=g.map(coords).sort((a,b)=>Math.abs(a[0])-Math.abs(b[0]));return pts[0];
  });
  const contraction=rest?clamp(2*half/Math.max(.1,rest.at(-1)[0]-rest[0][0])-1,.01,.18):.032+.10*smile;
  const targets=rows.map((row,j)=>{
    const rel=j*2/(count-1)-1,corner=Math.abs(rel)**1.7;
    const projected=mid-gap*.31+.008+(.032+.014*smile)*corner+.004*rel;
    if(!rest)return projected;
    const x=clamp(cx+half*rel,rest[0][0],rest.at(-1)[0]);
    const k=rest.findIndex((p,i)=>i>0 && p[0]>=x);
    const a=rest[k-1],b=rest[k],f=(x-a[0])/Math.max(.001,b[0]-a[0]);
    const measured=a[1]+(b[1]-a[1])*f+.017*corner;
    // A gap in the original smile hides some lip and moustache texture.
    // Limit travel into that gap so the surrounding fibres keep their shape.
    return projected+.70*clamp(measured-projected,-.055,.055);
  });
  return {smile,at(u,v){
    let du=0,dv=0,cavity=0,lipMask=0,vermilion=0;
    // Trial (malice): a smile holds the corners up. Let them fall with the cheek and
    // close the mouth in that fallen position. Masks stay where the photograph has them.
    const v0=v,fall=(.045+.085*smile)*gaussian((Math.abs(u-cx)-half*.92)/(half*.55),(v-mid-.02)/.30);v-=fall;
    const rel=(u-cx)/half,abs=Math.abs(rel);
    if(abs<1.76 && Math.abs(v-mid)<.67){
      const index=clamp((rel+1)*.5*(count-1),0,count-1),j=Math.floor(index),f=index-j;
      const end=Math.min(j+1,count-1),a=rows[j],b=rows[end];
      const upper=a[0]+f*(b[0]-a[0]),lower=a[1]+f*(b[1]-a[1]),sourceMid=(upper+lower)*.5;
      if(abs<1 && lower-upper>.027)cavity=smooth(upper-.005,upper+.009,v0)*(1-smooth(lower-.009,lower+.005,v0));
      lipMask=(1-smooth(.83,1.08,abs))*(1-smooth(.035,.115,Math.abs(v0-sourceMid)));
      // Trial (malice): the painted lips themselves, from the outer lip contour.
      const top=a[2]+f*(b[2]-a[2]),bottom=a[3]+f*(b[3]-a[3]);
      vermilion=(1-smooth(.80,1.02,abs))*smooth(top-.025,top+.02,v0)*(1-smooth(bottom-.02,bottom+.025,v0));
      const target=targets[j]+f*(targets[end]-targets[j]);
      du=(u-cx)*contraction*gaussian((v-target)/.22,Math.max(0,abs-1)/.32);
      // After narrowing the grin, trace the lip edges at the new source
      // column. This keeps the last slivers of tooth inside the closing mouth.
      const src=clamp((rel+du/half+1)*.5*(count-1),0,count-1),k=Math.floor(src),blend=src-k;
      const l=rows[k],r=rows[Math.min(k+1,count-1)];
      const hi=l[0]+blend*(r[0]-l[0]),lo=l[1]+blend*(r[1]-l[1]);
      const slit=Math.min(.004,Math.max(.0002,(lo-hi)*.45));
      // Map a narrow final opening back onto the photographed mouth. Outside
      // the lips the same motion eases into the philtrum, cheeks and chin.
      if(v<target-slit)dv=(hi-target+slit)*(1-smooth(0,.47,target-slit-v));
      else if(v>target+slit)dv=(lo-target-slit)*(1-smooth(0,.46,v-target-slit));
      else dv=hi+(lo-hi)*(v-target+slit)/(2*slit)-v;
      dv*=1-smooth(.92,1.75,abs);
    }
    for(const [x,y] of brows){
      // The inner brow settles down and inward. Leave the eye itself pinned.
      const influence=gaussian((u-x)/.15,(v-y-.015)/.105)*(1-smooth(-.14,-.055,v));
      du+=Math.sign(x)*.037*influence;dv-=.052*influence;
    }
    return [du,dv-fall,cavity,lipMask,vermilion];
  }};
}
