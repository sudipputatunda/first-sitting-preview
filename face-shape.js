export function mean(points) {
  return points.reduce((sum,p)=>[sum[0]+p[0]/points.length,sum[1]+p[1]/points.length],[0,0]);
}

export function axes(face,place){
  const [x,y,w,h]=face.box;
  const centres=face.eyes.map((g,i)=>place(g.length?mean(g):[x+w*(i?.7:.3),y+h*.38])).sort((a,b)=>a[0]-b[0]);
  const [left,right]=centres, ex=(left[0]+right[0])/2, ey=(left[1]+right[1])/2;
  const span=Math.hypot(right[0]-left[0],right[1]-left[1]);
  const cos=span?(right[0]-left[0])/span:1,sin=span?(right[1]-left[1])/span:0;
  // A turned head foreshortens the eyes; use the box as a lower scale bound.
  const d=Math.max(12,span,(place([x+w,y])[0]-place([x,y])[0])*.32);
  return {ex,ey,d,cos,sin,
    point:(u,v)=>[ex+d*(u*cos-v*sin),ey+d*(u*sin+v*cos)],
    local:([px,py])=>[((px-ex)*cos+(py-ey)*sin)/d, (-(px-ex)*sin+(py-ey)*cos)/d]};
}

// The same landmarks on source and sitter become vertices in a piecewise-affine
// registration. Four forehead rows extend Vision's jaw-and-features coverage.
export function pins(face,place) {
  const axis=axes(face,place),points=[];
  const groups=[...face.eyes,...face.brows,face.nose,face.lips,face.outline];
  const counts=[6,6,5,5,8,12,15];
  for(let j=0;j<groups.length;j++){
    const region=groups[j];
    if(!region?.length)return null;
    for(let k=0;k<counts[j];k++)points.push(place(region[Math.round(k*(region.length-1)/(counts[j]-1))]));
  }
  for(const [v,half] of [[-.38,1.05],[-.67,1.04],[-.94,.96],[-1.17,.78]]){
    for(const u of [-1,-.5,0,.5,1])points.push(axis.point(u*half,v+.09*u*u));
  }
  return points;
}
