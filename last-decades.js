// All distances are relative to the space between the sitter's eyes.
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
const bell=(x,y,rx,ry)=>Math.exp(-.5*((x/rx)**2+(y/ry)**2));

export function lastDecades(face,place,axis,matte,width,height,chin,lip){
  const local=p=>axis.local(place(p)),nose=face.nose.map(local);
  const mouth=face.lips.map(local).sort((a,b)=>a[0]-b[0]);
  const mouthX=mouth.length?(mouth[0][0]+mouth.at(-1)[0])*.5:0;
  const mouthHalf=mouth.length?clamp((mouth.at(-1)[0]-mouth[0][0])*.48,.24,.65):.38;
  // Trial (malice): the side whose mouth corner already sits higher.
  const sneer=mouth.length&&mouth[0][1]<mouth.at(-1)[1]?-1:1;
  const arches=face.brows.filter(g=>g.length).map(g=>g.map(local).sort((a,b)=>Math.abs(b[0])-Math.abs(a[0]))[0]);
  const tip=nose.length?nose.reduce((a,b)=>a[1]>b[1]?a:b):[mouthX,lip*.63];
  const wing=nose.length?clamp((Math.max(...nose.map(p=>p[0]))-Math.min(...nose.map(p=>p[0])))*.5,.17,.48):.30;
  const brows=face.brows.filter(g=>g.length).map(g=>g.map(local).sort((a,b)=>Math.abs(a[0])-Math.abs(b[0]))[0]);
  const eyes=face.eyes.filter(g=>g.length).map(g=>{
    const p=g.map(local),x=p.reduce((s,q)=>s+q[0]/p.length,0);
    return [x,Math.min(...p.map(q=>q[1])),Math.max(.12,(Math.max(...p.map(q=>q[0]))-Math.min(...p.map(q=>q[0])))*.57)];
  });

  // Find each shoulder where the person's matte first rises above the
  // background. A cropped shoulder uses the other samples on the same side.
  function shoulder(side){
    const edges=[];
    for(const distance of [1.32,1.52,1.72,1.92,2.12]){
      let run=0;
      for(let v=chin-.77;v<chin+1.85;v+=.035){
        const [px,py]=axis.point(side*distance,v),x=Math.round(px),y=Math.round(py);
        if(x<0||x>=width||y<0||y>=height)break;
        run=matte[4*(y*width+x)+3]>190?run+1:0;
        if(run===3){edges.push([distance,v-.07]);break;}
      }
    }
    const slope=edges.length>1?clamp((edges.at(-1)[1]-edges[0][1])/(edges.at(-1)[0]-edges[0][0]),.05,.85):.30;
    const levels=edges.map(([u,v])=>v-slope*(u-1.65)).sort((a,b)=>a-b);
    return {level:levels.length?levels[Math.floor(levels.length/2)]:chin+.42,slope};
  }
  const shoulders=[shoulder(-1),shoulder(1)];
  return function at(u,v){
    const z=u-mouthX,abs=Math.abs(z);
    let du=0,dv=0,light=0,clothLight=0,noseX=0,noseY=0,eyeZone=0;
    if(v<chin+.25 && abs<1.60){
      const nx=u-tip[0],ny=v-tip[1];
      // The bridge stays attached between the eyes. Carry the photographed
      // nostrils, tip highlight and surrounding skin down and slightly out.
      const lowerNose=bell(nx,ny,wing*1.36,.23)*smooth(-.42,-.06,ny);
      noseY=-.080*lowerNose;
      // Trial (gaunt): the tip still drops, but the nose is pinched and bony
      // instead of broad. The bridge shows as a ridge between shaded flanks.
      noseX=nx*.045*bell(nx,ny+.02,wing*1.28,.19);
      light+=.045*bell(nx,ny+.36,wing*.26,.34)-.105*bell(Math.abs(nx)-wing*.60,ny+.30,wing*.28,.34);
      light+=.030*bell(nx+wing*.23,ny+.09,wing*.45,.16)
            -.12*bell(nx,ny-.055,wing*.78,.061)-.075*bell(Math.abs(nx)-wing*.93,ny+.03,.060,.11);
      const corner=bell(abs-mouthHalf*.86,v-lip-.035,.145,.175);
      const cheek=bell(abs-.68,v-lip*.69,.25,.28);
      const jaw=bell(abs-.78,v-chin+.27,.23,.37);
      // A downturn at both ends and less lift in the smile cheeks. Taper
      // the motion into the chin so teeth and lip edges still meet.
      // Trial (malice): one corner drops hard and the other barely, a mouth set
      // in contempt instead of both ends falling into one arc. The pull is spread
      // over a longer distance so beard and creases are not stretched to streaks.
      const turn=.100-.085*smooth(-.12,.12,z*sneer);
      dv-=turn*bell(abs-mouthHalf*.86,v-lip-.035,.17,.32)+.040*cheek+.095*jaw;
      du+=Math.sign(z)*(.071*cheek+.033*jaw);
      dv+=.23*(v-lip)*bell(z,v-lip,mouthHalf*.85,.13);
      light-=.145*corner+.10*cheek+.09*jaw;
      const temple=bell(abs-.87,v+.29,.16,.27);
      du+=Math.sign(z)*.042*temple;light-=0.324*temple;
      light+=.10*bell(abs-.71,v-.34,.21,.11)+.045*bell(u,v+.78,.52,.24);
      // Trial (malice): the outer brow lifts as the inner brow comes down.
      for(const [ox,oy] of arches)dv+=.050*bell(u-ox,v-oy,.21,.12);
      for(const [bx,by] of brows){
        const brow=bell(u-bx,v-by,.19,.115);
        du+=Math.sign(bx)*.042*brow;dv-=.080*brow;
        light-=.18*bell(u-bx,v-by-.052,.16,.073);
      }
      for(const [ex,lid,rx] of eyes){
        // Change the upper lid locally, with a very small offset at the iris.
        const hood=bell(u-ex,v-lid+.042,rx*.86,.052);
        dv-=.030*hood;light-=.078*hood;
        light-=.10*bell(u-ex,v-lid-.15,rx*.93,.062);
        // Trial (malice): the socket sinks around an eye that stays lit.
        light-=0.558*bell(u-ex,v-lid-.035,rx*1.55,.25)*(1-bell(u-ex,v-lid-.035,rx*.66,.075));
        light-=0.352*bell(u-ex,v-lid+.09,rx*1.25,.07);
        eyeZone=Math.max(eyeZone,bell(u-ex,v-lid-.035,rx*.62,.07));
      }
    }
    const sh=shoulders[z<0?0:1],across=Math.abs(z);
    const level=sh.level+sh.slope*(across-1.65),depth=v-level;
    const support=smooth(-1.50,-.35,depth)*smooth(.51,1.11,across)*smooth(chin-.58,chin+.29,v);
    // A reduced shoulder span pulls the yoke in. The collar falls outward at
    // the neck, while the outer shoulder drops farther than the button line.
    const sleeve=smooth(.87,2.28,across);
    const body=smooth(chin-.12,chin+.65,v);
    du+=Math.sign(z)*(.30*sleeve*support-.115*body*bell(across-.58,v-chin-.58,.24,.59));
    dv-=support*(.12+.34*sleeve)*(z<0?.86:1.08)+.14*body*bell(z,v-chin-.76,.69,.55);
    if(depth>-.35 && v>chin-.20){
      // Diagonal cloth gathers start under each shoulder. The path bends
      // gently as it hangs; the placket stays free of this lateral pull.
      const h=depth+.04,a=across-(1.20+.26*h+.05*h*h),b=across-(1.84+.14*h);
      const below=smooth(-.10,.42,h)*(1-smooth(2.5,3.7,h))*body;
      const roll=bell(a,h-.88,.16,1.05)-.65*bell(a-.21,h-.78,.14,.95);
      const outer=bell(b,h-.56,.17,.86)-.70*bell(b+.20,h-.64,.15,.90);
      du+=Math.sign(z)*below*(.12*roll+.085*outer);
      clothLight=below*(-.23*roll-.12*outer+.06*bell(across-.47,h-.35,.19,.54));
    }
    return [du,dv,light,clothLight,noseX,noseY,eyeZone];
  };
}
