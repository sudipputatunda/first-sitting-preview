import {W,H,surface,linen,paintPortrait} from './portrait.js?rev=person-matte-1';
import {central,follow} from './tracking.js';
import {browserFaces,loadModels,useCPU} from './browser-faces.js?rev=mobile-1';
import {prepareMatte,sitterMatte} from './browser-matte.js?rev=person-matte-1';
import {lensGlare,softenGlare} from './glare.js';
import {ageAt,startingAge,finalAge} from './sitting-age.js';
import {restingLine} from './expression.js';
import {collect,samplingSeconds} from './selection.js';

const $=selector=>document.querySelector(selector);
const painting=$('#painting'), ctx=painting.getContext('2d');
const blank=linen(), video=$('#video');
ctx.drawImage(blank,0,0);
let session=0,stream=null,mode='idle',portrait=null,candidate=null,exposureTimer;
let generation=0,started=0,releaseAt=0,releaseImage=null,missingSince=0,elapsedText='';
let exitTimer,activationPending=false,lastPaint=-Infinity,underpainting=null;
const revealSeconds=18;
const ageInput=$('#starting-age');
let baseline=null,ageSeconds=65;
function clearComparison(){
  if($('#comparison').open)$('#comparison').close();
  for(const id of ['#opening','#closing'])$(id).getContext('2d').clearRect(0,0,W,H);
}
const smooth=x=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const timecode=n=>Math.floor(n/60)+':'+String(Math.floor(n)%60).padStart(2,'0');

function status(text){ if($('#state').textContent!==text) $('#state').textContent=text; }
function error(text=''){ $('#error').hidden=!text; $('#error').textContent=text; }
function resetSitting(){
  document.documentElement.classList.remove('metering');$('#capture-cue').hidden=true;
  clearTimeout(exposureTimer);missingSince=0;
  generation++;portrait?.close();portrait=null;underpainting=null;lastPaint=-Infinity;clearComparison();releaseImage=null;candidate=null;started=0;releaseAt=0;
  ctx.globalAlpha=1;ctx.drawImage(blank,0,0);
  painting.setAttribute('aria-label','Empty linen canvas');
  $('#progress').style.width='0%';$('#elapsed').textContent='0:00';elapsedText='';
  $('#phase').textContent='Waiting for a sitter';$('#duration').disabled=false;ageInput.disabled=false;baseline=null;$('#again').hidden=true;$('#compare').hidden=true;
}
function stopCamera(){
  if(stream)for(const track of stream.getTracks()){
    track.onended=null;track.onunmute=null;track.stop();
  }
  stream=null;video.pause();video.srcObject=null;
  $('#camera-monitor').hidden=true;$('#signal').classList.remove('live');
}
function disconnect(){
  session++;activationPending=false;stopCamera();
  mode='idle';document.documentElement.classList.remove('camera-active');
  resetSitting();$('#camera').textContent='Start camera';$('#camera').disabled=false;
  $('#camera').hidden=false;$('#photo').value='';status('Canvas at rest');
}
function frameOf(image,maxSide,mirror=false){
  const w=image.videoWidth||image.naturalWidth||image.width,h=image.videoHeight||image.naturalHeight||image.height;
  const scale=Math.min(1,maxSide/Math.max(w,h));
  const canvas=surface(Math.max(1,Math.round(w*scale)),Math.max(1,Math.round(h*scale)));
  const c=canvas.getContext('2d',{willReadFrequently:true});
  if(mirror){c.translate(canvas.width,0);c.scale(-1,1);}
  c.drawImage(image,0,0,canvas.width,canvas.height);
  return canvas;
}
async function vision(image,options){
  return browserFaces(frameOf(image,580),options);
}
function withDeadline(promise,ms,message){
  let timer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),ms);});
  return Promise.race([promise,timeout]).finally(()=>clearTimeout(timer));
}
async function sit(frame,face,token,glare=null,rest=null,others=[]){
  $('#capture-cue').hidden=true;
  const revision=++generation;
  status(mode==='captured'?'Exposure chosen · you can step away':'Preparing the sitter’s portrait');$('#phase').textContent='Preparing the portrait';
  ageInput.disabled=true;$('#duration').disabled=true;
  const seconds=Number($('#duration').value);
  const [opening,matte]=await Promise.all([
    startingAge(frame,face,ageInput.valueAsNumber),
    withDeadline(sitterMatte(frame,face,others),45000,'The portrait cutout took too long to load. Check the connection and try another sitting.')
  ]);

  if(token!==session || revision!==generation)return;
  const next=await paintPortrait(softenGlare(frame,glare),face,matte,rest,opening.age);
  if(token!==session || revision!==generation){next.close();return;}
  baseline=opening;ageSeconds=seconds;ageInput.value='';
  portrait=next;document.documentElement.classList.remove('metering');$('#capture-cue').hidden=true;
  underpainting=surface();const under=underpainting.getContext('2d',{willReadFrequently:true});
  portrait.render(under,opening.age,opening.age);
  const tones=under.getImageData(0,0,W,H);
  for(let i=0;i<tones.data.length;i+=4){
    const l=.25*tones.data[i]+.60*tones.data[i+1]+.15*tones.data[i+2];
    tones.data[i]=104+l*.54;tones.data[i+1]=89+l*.54;tones.data[i+2]=68+l*.53;
  }
  under.putImageData(tones,0,0);
  started=performance.now();
  $('#again').hidden=false;$('#compare').hidden=false;
  painting.setAttribute('aria-label','A painted portrait of the central sitter, gradually ageing');
  status(mode==='captured'?'Painting from the chosen exposure':'Still-photo sitting');
}
function release(){
  if(!portrait || releaseAt)return;
  releaseImage=surface();releaseImage.getContext('2d').drawImage(painting,0,0);
  releaseAt=performance.now();clearComparison();$('#compare').hidden=true;$('#again').hidden=true;status('Releasing the sitter');
}
async function paintBest(token){
  if(token!==session || mode!=='camera' || !candidate?.best)return;
  const {best,rest}=candidate;
  candidate=null;mode='captured';stopCamera();$('#camera').hidden=true;
  try{
    await sit(best.frame,best.face,token,best.glare,restingLine(best.pose,rest?.pose),best.others);
  }catch(e){if(token===session){disconnect();error(e.message);}}
}
function observe(faces,frame,token,misses){
  const now=performance.now();
  const whom=candidate ? follow(faces,candidate.last,candidate.first) : central(faces);
  if(!whom){
    $('#capture-cue').hidden=true;
    if(candidate?.best){
      status('Holding your clearest exposure');return;
    }
    if(candidate){
      if(!missingSince)missingSince=now;
      else if(now-missingSince>1100){candidate=null;missingSince=0;}
    }
    $('#phase').textContent='Finding a face';
    status(candidate?'Look back toward the camera':misses<5?'Centre your face in the camera preview':'Move closer and face a light. You can also try a still photo.');
    return;
  }
  missingSince=0;
  candidate??={first:whom,last:whom,best:null,count:0,lastSample:-Infinity};
  candidate.last=whom;
  const previousBest=candidate.best;
  collect(candidate,frame,whom,now);
  if(candidate.best!==previousBest){
    candidate.best.others=faces.filter(face=>face!==whom);
    prepareMatte(candidate.best.others.length>0).catch(()=>{}); // The sitting retries initialization and reports errors.
  }
  // The clock owns the handoff. A lost face or a slow detector must never
  // discard an accepted exposure or postpone the painting.
  if(candidate.best && !previousBest){
    exposureTimer=setTimeout(()=>paintBest(token),samplingSeconds*1000);
  }
  $('#capture-cue').hidden=!candidate.reflection;
  $('#phase').textContent='Comparing exposures';
  status(candidate.reason || 'Studying the sitter · '+candidate.count+(candidate.count===1?' exposure':' exposures'));
}

function cameraFailed(token,message){
  if(token!==session || mode!=='camera' || !stream)return;
  if(candidate?.best){
    stopCamera();status('Holding your clearest exposure');return;
  }
  disconnect();error(message);
}
async function watch(token){
  const track=stream.getVideoTracks()[0];
  let misses=0,stalledSince=0,frameSerial=0,lastSerial=-1,lastProgress=performance.now(),callback;
  let triedMobileCPU=false;
  const appleMobile=/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1);
  function onFrame(){
    if(token!==session || !stream || mode!=='camera')return;
    frameSerial++;
    callback=video.requestVideoFrameCallback(onFrame);
  }
  if(video.requestVideoFrameCallback)callback=video.requestVideoFrameCallback(onFrame);
  try{
    status('Loading the face tracker…');$('#phase').textContent='Starting face tracking';
    await withDeadline(loadModels(),30000,'The face tracker could not load. Check the connection, then tap Start camera again.');
    while(token===session && mode==='camera' && stream){
      if(document.hidden){lastProgress=performance.now();stalledSince=0;await sleep(300);continue;}
      if(track.readyState==='ended')throw Error('The camera disconnected. Tap Start camera to reconnect.');
      const now=performance.now();
      if(video.readyState<2 || !video.videoWidth || !video.videoHeight || track.muted || video.paused){
        if(!stalledSince)stalledSince=now;
        if(now-stalledSince>12000)throw Error('Camera frames stopped arriving. Close other camera apps, then tap Start camera or choose a still photo.');
        status(candidate?.best?'Holding your clearest exposure':'Waiting for the camera picture…');
        await sleep(170);continue;
      }
      stalledSince=0;
      // Some iOS browser streams draw valid images while currentTime does
      // not advance. Read the drawable video and use frame counters when
      // available to avoid treating one frozen sample as six exposures.
      const serial=frameSerial || video.getVideoPlaybackQuality?.().totalVideoFrames || video.webkitDecodedFrameCount || 0;
      if(serial && serial===lastSerial){
        if(now-lastProgress>12000)throw Error('The camera picture froze. Tap Start camera to reconnect or choose a still photo.');
        await sleep(140);continue;
      }
      lastSerial=serial;lastProgress=now;
      if(!candidate&&misses===0)status('Looking for your face…');
      if(appleMobile && misses>=6 && !triedMobileCPU && !candidate?.best){
        triedMobileCPU=true;status('Trying a more compatible face tracker…');await useCPU();
      }
      const frame=frameOf(video,960,true);
      const faces=await withDeadline(vision(frame,{fast:misses<2,searchCentre:misses>=2 && misses%3===2}),
        25000,'The face tracker stopped responding. Tap Start camera to retry or choose a still photo.');
      if(token!==session || mode!=='camera' || !stream)return;
      misses=faces.length?0:misses+1;
      observe(faces,frame,token,misses);
      await sleep(165);
    }
  }catch(e){cameraFailed(token,e.message);}
  finally{if(callback!==undefined)video.cancelVideoFrameCallback?.(callback);}
}
function resumeVideo(){
  if(mode!=='camera' || document.hidden || !stream)return;
  const token=session;
  video.play().catch(()=>{
    cameraFailed(token,'Tap Start camera to resume the camera after the interruption.');
  });
}
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){if(!candidate?.best)candidate=null;missingSince=0;}
  else resumeVideo();
});
$('#camera').addEventListener('click',async()=>{
  if(mode==='camera' || activationPending){disconnect();error();return;}
  if(!ageInput.reportValidity())return;
  disconnect();error();const token=session;activationPending=true;$('#camera').textContent='Cancel camera';
  status('Waiting for camera permission');
  try {
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Open this page in a browser over HTTPS to enable the camera, or try a still photo.');
    const upright=window.matchMedia('(orientation:portrait)').matches;
    const media=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'user'},
      width:{ideal:upright?720:960},height:{ideal:upright?960:720},frameRate:{ideal:15,max:24}}});
    if(token!==session){media.getTracks().forEach(t=>t.stop());return;}
    stream=media;mode='camera';$('#camera-monitor').hidden=false;
    document.documentElement.classList.add('camera-active','metering');
    video.autoplay=true;video.muted=true;video.defaultMuted=true;video.playsInline=true;
    video.setAttribute('playsinline','');video.setAttribute('webkit-playsinline','');
    video.srcObject=media;
    status('Starting the camera picture…');
    const track=media.getVideoTracks()[0];
    track.onended=()=>cameraFailed(token,'Camera disconnected. Tap Start camera to reconnect or choose a still photo.');
    track.onunmute=()=>{if(token===session)resumeVideo();};
    await withDeadline(video.play(),12000,'The camera could not start playback. Tap Start camera to retry, or choose a still photo.');
    if(token!==session)return;
    activationPending=false;$('#camera').textContent='Stop camera';$('#signal').classList.add('live');
    watch(token);
  } catch(e){
    if(token!==session)return;
    disconnect();
    error(e.name==='NotAllowedError'?'Camera access was declined. Allow it in browser settings, or try a still photo.':e.message);
  }
});
async function photoSitting(frame,token){
  const faces=await vision(frame),face=central(faces);
  if(token!==session)return;
  if(!face)throw new Error('No face found. Try a well-lit photo with the sitter facing forward.');
  const glare=lensGlare(frame,face);
  if(glare.blocked)throw new Error('A reflection covers an eye in this photo. Choose one with visible eyes, or start the camera for a new exposure.');
  await sit(frame,face,token,glare,null,faces.filter(other=>other!==face));
}
$('#photo').addEventListener('change',async event=>{
  const file=event.target.files[0];if(!file)return;
  if(!ageInput.reportValidity()){event.target.value='';return;}
  disconnect();error();const token=session;mode='photo';status('Finding the central sitter in the photo');
  const url=URL.createObjectURL(file),img=new Image();
  try {
    img.src=url;await img.decode();if(token!==session)return;
    await photoSitting(frameOf(img,3200),token);
  } catch(e){if(token===session){disconnect();error(e.message);}}
  finally{URL.revokeObjectURL(url);}
});
$('#again').addEventListener('click',release);
function tick(now){
  if(releaseAt){
    const p=smooth((now-releaseAt)/1800);
    ctx.globalAlpha=1;ctx.drawImage(releaseImage,0,0);ctx.globalAlpha=p;ctx.drawImage(blank,0,0);ctx.globalAlpha=1;
    if(p>=1)disconnect();
  }else if(portrait){
    const duration=revealSeconds+ageSeconds,t=Math.max(0,(now-started)/1000);
    const age=ageAt(baseline.age,(t-revealSeconds)/ageSeconds);
    if(Math.min(t,duration)-lastPaint>=1/18 || (t>=duration && lastPaint<duration)){
      lastPaint=Math.min(t,duration);
      ctx.globalAlpha=1;portrait.render(ctx,age,baseline.age);
      if(t<revealSeconds){
        const colour=smooth((t-4)/(revealSeconds-4)),appearance=smooth(t/14);
        ctx.globalAlpha=1-colour;ctx.drawImage(underpainting,0,0);
        ctx.globalAlpha=1-appearance;ctx.drawImage(blank,0,0);ctx.globalAlpha=1;
      }
    }
    const phase=t<revealSeconds?'Emerging':t<duration?'Portrait age · '+Math.floor(age):'Final portrait · 125';
    if($('#phase').textContent!==phase)$('#phase').textContent=phase;
    const clock=timecode(Math.min(t,duration));
    if(clock!==elapsedText){
      elapsedText=clock;$('#elapsed').textContent=clock;
      $('#progress').style.width=Math.min(100,100*t/duration)+'%';
    }
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
$('#compare').addEventListener('click',()=>{
  if(!portrait || releaseAt)return;
  portrait.render($('#opening').getContext('2d'),baseline.age,baseline.age);
  portrait.render($('#closing').getContext('2d'),finalAge,baseline.age);
  $('#opening-caption').textContent='Opening · '+baseline.source+' age '+baseline.age;
  $('#closing-caption').textContent='Final portrait · imagined age 125';
  $('#comparison').showModal();
});
$('#close-comparison').addEventListener('click',clearComparison);
const gallery=$('#gallery');
function exitView(){
  document.body.classList.remove('installation');$('#leave').hidden=true;
  if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});
}
$('#exhibit').addEventListener('click',()=>{
  document.body.classList.add('installation');$('#leave').hidden=false;
  if(document.documentElement.requestFullscreen)document.documentElement.requestFullscreen().catch(()=>{});
  $('#leave').focus({preventScroll:true});$('#leave').blur();
});
function showExit(){
  if(!document.body.classList.contains('installation'))return;
  gallery.classList.add('show-exit');clearTimeout(exitTimer);exitTimer=setTimeout(()=>gallery.classList.remove('show-exit'),1500);
}
gallery.addEventListener('pointermove',showExit);gallery.addEventListener('pointerdown',showExit);
$('#leave').addEventListener('click',exitView);
document.addEventListener('keydown',e=>{if(e.key==='Escape')exitView();});
document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement)exitView();});
window.addEventListener('pagehide',disconnect);

$('#camera').textContent='Start camera';$('#camera').disabled=false;$('#photo').disabled=false;
