import {agePassage} from './sitting-age.js';

// Interpolate the sampling coordinates before sampling the face. Throughout
// the change, each eye, skin pore and jaw edge has just one position.
const vertexSource=`
attribute vec2 corner;
varying vec2 uv;
void main(){uv=vec2(corner.x*.5+.5,.5-corner.y*.5);gl_Position=vec4(corner,0.,1.);}
`;
const fragmentSource=`
precision highp float;
varying vec2 uv;
uniform sampler2D opening,aged,ground,displacement,wear,expressionMap,lateMap,latePaint,growMap;
uniform vec2 size;
uniform float years,mood,late,grow;
void main(){
  // Trial (grow): undo the growing first, then age the face where it was photographed.
  vec4 up=texture2D(growMap,uv)*255.;
  vec2 grown=uv+grow*((vec2(up.r*256.+up.g,up.b*256.+up.a)-32768.)/64.)/size;
  vec4 code=texture2D(displacement,grown)*255.;
  vec2 offset=(vec2(code.r*256.+code.g,code.b*256.+code.a)-32768.)/64.;
  vec4 last=texture2D(lateMap,grown)*255.;
  vec2 lateOffset=(vec2(last.r*256.+last.g,last.b*256.+last.a)-32768.)/64.;
  vec2 shaped=grown+(years*offset+late*lateOffset)/size;
  vec4 gesture=texture2D(expressionMap,shaped)*255.;
  vec2 expressionOffset=(vec2(gesture.r*256.+gesture.g,gesture.b*256.+gesture.a)-32768.)/64.;
  vec2 p=shaped+mood*expressionOffset/size;
  vec4 start=texture2D(opening,p),end=texture2D(aged,p);
  float surfaceYears=min(1.,mix(years*years*(2.-years),years*(1.+.30*(1.-years)),end.a));
  vec3 colour=mix(start.rgb,end.rgb,surfaceYears);
  vec4 patina=texture2D(wear,p);
  float onset=patina.a*.80;
  float develop=step(.002,patina.a)*smoothstep(onset,min(1.,onset+.40),years);
  colour+=(patina.rgb-end.rgb)*develop;
  colour+=late*(texture2D(latePaint,p).rgb-vec3(128./255.));
  float inside=step(0.,p.x)*step(p.x,1.)*step(0.,p.y)*step(p.y,1.);
  vec3 dusk=(vec3(.20,.18,.12)*mood+vec3(0.364,0.336,0.238)*late)*(.34+.66*uv.x);
  gl_FragColor=vec4(mix(texture2D(ground,uv).rgb*(1.-dusk),colour,start.a*inside),1.);
}
`;

function gpu(width,height,images) {
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const gl=canvas.getContext('webgl',{alpha:false,antialias:false,depth:false,stencil:false});
  if(!gl)return null;
  const textures=[],shaders=[],program=gl.createProgram();
  let buffer;
  function close(){
    textures.forEach(t=>gl.deleteTexture(t));shaders.forEach(s=>gl.deleteShader(s));
    gl.deleteProgram(program);if(buffer)gl.deleteBuffer(buffer);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
  try{
    for(const [kind,source] of [[gl.VERTEX_SHADER,vertexSource],[gl.FRAGMENT_SHADER,fragmentSource]]){
      const shader=gl.createShader(kind);shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);
      if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));
      gl.attachShader(program,shader);
    }
    gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
    const corner=gl.getAttribLocation(program,'corner');gl.enableVertexAttribArray(corner);gl.vertexAttribPointer(corner,2,gl.FLOAT,false,0,0);
    ['opening','aged','ground','displacement','wear','expressionMap','lateMap','latePaint','growMap'].forEach((name,i)=>{
      const tex=gl.createTexture();textures.push(tex);gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,tex);
      for(const wrap of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,wrap,gl.CLAMP_TO_EDGE);
      for(const filter of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,filter,gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(images[i].buffer));
      gl.uniform1i(gl.getUniformLocation(program,name),i);
    });
    gl.uniform2f(gl.getUniformLocation(program,'size'),width,height);
    const amount=gl.getUniformLocation(program,'years'),gesture=gl.getUniformLocation(program,'mood'),last=gl.getUniformLocation(program,'late'),rise=gl.getUniformLocation(program,'grow');
    return {close,draw(target,t,mood,late,grow){
      if(gl.isContextLost())return false;
      gl.uniform1f(amount,t);gl.uniform1f(gesture,mood);gl.uniform1f(last,late);gl.uniform1f(rise,grow);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);target.drawImage(canvas,0,0);return true;
    }};
  } catch {close();return null;}
}

export function morph(width,height,young,old,ground,offset,wear,gesture,lateMap,latePaint,growMap){
  const images=[young,old,ground,offset,wear,gesture,lateMap,latePaint,growMap], hardware=gpu(width,height,images);
  let output;
  function render(ctx,age,start){
    const {structure:t,settle:mood,late,grow=0}=agePassage(start,age);
    if(hardware?.draw(ctx,t,mood,late,grow))return;
    // Canvas-only path for browsers with GPU acceleration disabled.
    output??=ctx.createImageData(width,height);
    const out=output.data,fall=[.20*mood+0.364*late,.18*mood+0.336*late,.12*mood+0.238*late];
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const i=(y*width+x)*4;
      // Trial (grow): undo the growing first, as the shader does.
      const grownX=x+grow*(growMap[i]*256+growMap[i+1]-32768)/64,grownY=y+grow*(growMap[i+2]*256+growMap[i+3]-32768)/64;
      const g=4*(Math.max(0,Math.min(height-1,Math.round(grownY)))*width+Math.max(0,Math.min(width-1,Math.round(grownX))));
      const shapedX=grownX+(t*(offset[g]*256+offset[g+1]-32768)+late*(lateMap[g]*256+lateMap[g+1]-32768))/64;
      const shapedY=grownY+(t*(offset[g+2]*256+offset[g+3]-32768)+late*(lateMap[g+2]*256+lateMap[g+3]-32768))/64;
      // Sample the expression at the face's deformed location, as WebGL does.
      const mx=Math.max(0,Math.min(width-1,shapedX)),my=Math.max(0,Math.min(height-1,shapedY));
      const x0=Math.floor(mx),y0=Math.floor(my),rx=mx-x0,ry=my-y0;
      const tl=4*(y0*width+x0),tr=tl+(x0<width-1?4:0);
      const bl=tl+(y0<height-1?width*4:0),br=bl+tr-tl;
      const motion=k=>{
        const a=gesture[tl+k]*256+gesture[tl+k+1],b=gesture[tr+k]*256+gesture[tr+k+1];
        const c=gesture[bl+k]*256+gesture[bl+k+1],d=gesture[br+k]*256+gesture[br+k+1];
        return ((1-ry)*(a+rx*(b-a))+ry*(c+rx*(d-c))-32768)/64;
      };
      const sx=shapedX+mood*motion(0),sy=shapedY+mood*motion(2);
      const shade=.34+.66*(x+.5)/width;
      if(sx<0||sy<0||sx>width-1||sy>height-1){for(let k=0;k<3;k++)out[i+k]=ground[i+k]*(1-fall[k]*shade);out[i+3]=255;continue;}
      const ix=Math.floor(sx),iy=Math.floor(sy),a=4*(iy*width+ix),b=a+(ix+1<width?4:0);
      const c=a+(iy+1<height?width*4:0),d=c+b-a,fx=sx-ix,fy=sy-iy;
      const wa=(1-fx)*(1-fy),wb=fx*(1-fy),wc=(1-fx)*fy,wd=fx*fy;
      const alpha=(wa*young[a+3]+wb*young[b+3]+wc*young[c+3]+wd*young[d+3])/255;
      const early=(wa*old[a+3]+wb*old[b+3]+wc*old[c+3]+wd*old[d+3])/255;
      const slow=t*t*(2-t),surfaceYears=Math.min(1,slow+(t*(1+.30*(1-t))-slow)*early);
      const localOnset=(wa*wear[a+3]+wb*wear[b+3]+wc*wear[c+3]+wd*wear[d+3])/255;
      const onset=localOnset*.80,ratio=Math.max(0,Math.min(1,(t-onset)/(Math.min(1,onset+.40)-onset)));
      const developed=localOnset>=.002?ratio*ratio*(3-2*ratio):0;
      for(let k=0;k<3;k++){
        const start=wa*young[a+k]+wb*young[b+k]+wc*young[c+k]+wd*young[d+k];
        const end=wa*old[a+k]+wb*old[b+k]+wc*old[c+k]+wd*old[d+k];
        const patina=wa*wear[a+k]+wb*wear[b+k]+wc*wear[c+k]+wd*wear[d+k];
        const finish=wa*latePaint[a+k]+wb*latePaint[b+k]+wc*latePaint[c+k]+wd*latePaint[d+k]-128;
        const wall=ground[i+k]*(1-fall[k]*shade);
        out[i+k]=wall+alpha*(start+(end-start)*surfaceYears+(patina-end)*developed+finish*late-wall);
      }
      out[i+3]=255;
    }
    ctx.putImageData(output,0,0);
  }
  return {render,close:()=>hardware?.close()};
}
