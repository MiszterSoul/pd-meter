import { FaceLandmarker, FilesetResolver } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/+esm';

const $=id=>document.getElementById(id);
const video=$('video'),overlay=$('overlay'),ctx=overlay.getContext('2d');
const processCanvas=document.createElement('canvas'),pctx=processCanvas.getContext('2d',{willReadFrequently:true});
const CARD_MM=85.6,STORE='pd-live-samples-v2';
let stream=null,facing='user',landmarker=null,running=false,lastFace=0,lastCard=0,face=null,card=null,samples=[],recent=[],lastAccepted=0,audio=null;

const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
const median=a=>{const s=[...a].sort((x,y)=>x-y);return s[Math.floor(s.length/2)]};
const mapPoint=p=>({x:p.x*overlay.width/processCanvas.width,y:p.y*overlay.height/processCanvas.height});

function loadSamples(){try{samples=JSON.parse(localStorage.getItem(STORE)||'[]')}catch{samples=[]}renderAverage()}
function renderAverage(){
  if(!samples.length){$('average').textContent='–';$('sampleCount').textContent='0 mérés';return}
  $('average').textContent=mean(samples.map(x=>x.total)).toFixed(1);
  $('sampleCount').textContent=`${samples.length} mérés`;
}
function beep(){
  try{audio??=new AudioContext();const o=audio.createOscillator(),g=audio.createGain();o.frequency.value=880;g.gain.setValueAtTime(.001,audio.currentTime);g.gain.exponentialRampToValueAtTime(.15,audio.currentTime+.02);g.gain.exponentialRampToValueAtTime(.001,audio.currentTime+.18);o.connect(g).connect(audio.destination);o.start();o.stop(audio.currentTime+.2)}catch{}
}
async function waitForCv(){
  const start=Date.now();
  while(!(window.cv?.Mat)){if(Date.now()-start>15000)throw new Error('Az OpenCV nem töltődött be.');await new Promise(r=>setTimeout(r,100))}
}
async function loadModels(){
  $('message').textContent='Felismerők betöltése…';
  await waitForCv();
  if(!landmarker){
    const vision=await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm');
    landmarker=await FaceLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',delegate:'GPU'},runningMode:'VIDEO',numFaces:1});
  }
}
async function start(){
  try{
    $('start').disabled=true;await loadModels();stop(false);
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:facing,width:{ideal:1920},height:{ideal:1080}},audio:false});
    video.srcObject=stream;await video.play();
    $('.noop');
    document.querySelector('.viewer').classList.toggle('environment',facing==='environment');
    $('start').classList.add('hidden');$('stop').classList.remove('hidden');$('flip').disabled=false;
    $('message').textContent='Tartsd a bankkártyát az arcod mellé, a szemeiddel azonos síkban.';
    running=true;recent=[];requestAnimationFrame(loop);
  }catch(e){$('message').textContent=`Nem indítható: ${e.message}`;$('start').disabled=false}
}
function stop(show=true){
  running=false;stream?.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;
  $('start').classList.remove('hidden');$('stop').classList.add('hidden');$('start').disabled=false;$('flip').disabled=true;
  if(show){$('quality').textContent='Kamera leállítva';$('message').textContent='Nyomd meg az indítást az új méréshez.'}
}
async function flip(){facing=facing==='user'?'environment':'user';stop(false);await start()}

function resize(){
  const dpr=Math.min(devicePixelRatio||1,2),w=Math.round(innerWidth*dpr),h=Math.round(innerHeight*dpr);
  if(overlay.width!==w||overlay.height!==h){overlay.width=w;overlay.height=h}
  const pw=640,ph=Math.round(pw*h/w);if(processCanvas.width!==pw||processCanvas.height!==ph){processCanvas.width=pw;processCanvas.height=ph}
}
function drawVideoCover(){
  const sw=video.videoWidth,sh=video.videoHeight,dw=processCanvas.width,dh=processCanvas.height;
  const scale=Math.max(dw/sw,dh/sh),cw=dw/scale,ch=dh/scale,sx=(sw-cw)/2,sy=(sh-ch)/2;
  pctx.save();pctx.clearRect(0,0,dw,dh);
  if(facing==='user'){pctx.translate(dw,0);pctx.scale(-1,1)}
  pctx.drawImage(video,sx,sy,cw,ch,0,0,dw,dh);pctx.restore();
}
function detectFace(now){
  const result=landmarker.detectForVideo(processCanvas,now),lm=result.faceLandmarks?.[0];
  if(!lm){face=null;return}
  const px=i=>({x:lm[i].x*processCanvas.width,y:lm[i].y*processCanvas.height});
  const avgPts=ids=>({x:mean(ids.map(i=>px(i).x)),y:mean(ids.map(i=>px(i).y))});
  const a=avgPts([468,469,470,471,472]),b=avgPts([473,474,475,476,477]);
  const eyes=[a,b].sort((x,y)=>x.x-y.x);
  face={left:eyes[0],right:eyes[1],nose:px(168)};
}
function orderQuad(points){
  const sum=points.map(p=>p.x+p.y),diff=points.map(p=>p.y-p.x);
  return [points[sum.indexOf(Math.min(...sum))],points[diff.indexOf(Math.min(...diff))],points[sum.indexOf(Math.max(...sum))],points[diff.indexOf(Math.max(...diff))]];
}
function detectCard(){
  const cv=window.cv,src=cv.imread(processCanvas),gray=new cv.Mat(),blur=new cv.Mat(),edges=new cv.Mat(),contours=new cv.MatVector(),hier=new cv.Mat();
  let best=null,bestArea=0;
  try{
    cv.cvtColor(src,gray,cv.COLOR_RGBA2GRAY);cv.GaussianBlur(gray,blur,new cv.Size(5,5),0);cv.Canny(blur,edges,55,150);cv.dilate(edges,edges,cv.Mat.ones(3,3,cv.CV_8U));cv.findContours(edges,contours,hier,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
    const frameArea=processCanvas.width*processCanvas.height;
    for(let i=0;i<contours.size();i++){
      const c=contours.get(i),area=cv.contourArea(c);if(area<frameArea*.018||area>frameArea*.35){c.delete();continue}
      const peri=cv.arcLength(c,true),approx=new cv.Mat();cv.approxPolyDP(c,approx,.025*peri,true);
      if(approx.rows===4&&cv.isContourConvex(approx)){
        const pts=[];for(let j=0;j<4;j++)pts.push({x:approx.intPtr(j,0)[0],y:approx.intPtr(j,0)[1]});
        const q=orderQuad(pts),w=(dist(q[0],q[1])+dist(q[3],q[2]))/2,h=(dist(q[0],q[3])+dist(q[1],q[2]))/2,ratio=w/h;
        if(ratio>1.38&&ratio<1.82&&area>bestArea){best={points:q,width:w,height:h,area};bestArea=area}
      }
      approx.delete();c.delete();
    }
  }finally{src.delete();gray.delete();blur.delete();edges.delete();contours.delete();hier.delete()}
  card=best;
}
function calculate(){
  if(!face||!card)return null;
  const scale=CARD_MM/card.width,total=dist(face.left,face.right)*scale;
  const right=Math.abs(face.nose.x-face.left.x)*scale,left=Math.abs(face.right.x-face.nose.x)*scale;
  if(total<50||total>80||right<24||right>42||left<24||left>42)return null;
  const tilt=Math.abs(face.left.y-face.right.y)/dist(face.left,face.right);
  const cardTilt=Math.abs(card.points[0].y-card.points[1].y)/card.width;
  if(tilt>.08||cardTilt>.16)return null;
  return{total,right,left};
}
function draw(result){
  ctx.clearRect(0,0,overlay.width,overlay.height);ctx.lineWidth=Math.max(3,overlay.width/250);ctx.font=`700 ${Math.max(20,overlay.width/25)}px system-ui`;ctx.textAlign='center';
  if(card){const q=card.points.map(mapPoint);ctx.strokeStyle='#fbbf24';ctx.beginPath();q.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.stroke()}
  if(face){
    const a=mapPoint(face.left),b=mapPoint(face.right);ctx.strokeStyle=result?'#22c55e':'#ef4444';ctx.fillStyle=ctx.strokeStyle;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();[a,b].forEach(p=>{ctx.beginPath();ctx.arc(p.x,p.y,7,0,Math.PI*2);ctx.fill()});
    if(result){const m={x:(a.x+b.x)/2,y:(a.y+b.y)/2};ctx.fillStyle='#07110cdd';const text=`${result.total.toFixed(1)} mm`,tw=ctx.measureText(text).width;ctx.fillRect(m.x-tw/2-10,m.y-44,tw+20,34);ctx.fillStyle='#fff';ctx.fillText(text,m.x,m.y-18)}
  }
}
function updateUi(result){
  if(result){
    $('pd').textContent=result.total.toFixed(1);$('rightPd').textContent=result.right.toFixed(1);$('leftPd').textContent=result.left.toFixed(1);$('quality').textContent='Stabil mérés keresése…';
    recent.push({...result,t:performance.now()});recent=recent.filter(x=>performance.now()-x.t<1800);
    if(recent.length>=8){
      const vals=recent.map(x=>x.total),spread=Math.max(...vals)-Math.min(...vals);
      if(spread<=1.2){
        const stable={total:median(vals),right:median(recent.map(x=>x.right)),left:median(recent.map(x=>x.left))};
        $('quality').textContent='Mérés stabil';
        if(Date.now()-lastAccepted>3500){samples.push(stable);samples=samples.slice(-30);localStorage.setItem(STORE,JSON.stringify(samples));lastAccepted=Date.now();beep();renderAverage()}
      }
    }
  }else{
    $('pd').textContent='–';$('rightPd').textContent='–';$('leftPd').textContent='–';recent=[];
    if(!face&&!card)$('quality').textContent='Arc és bankkártya keresése';else if(!face)$('quality').textContent='Nézz szemből a kamerába';else if(!card)$('quality').textContent='A bankkártya nem látható';else $('quality').textContent='Tartsd egyenesen a fejed és a kártyát';
  }
}
async function loop(now){
  if(!running)return;resize();if(video.readyState>=2){drawVideoCover();if(now-lastFace>90){detectFace(now);lastFace=now}if(now-lastCard>180){detectCard();lastCard=now}const result=calculate();draw(result);updateUi(result)}requestAnimationFrame(loop)
}

$('start').addEventListener('click',start);$('stop').addEventListener('click',()=>stop());$('flip').addEventListener('click',flip);
$('clear').addEventListener('click',()=>{samples=[];localStorage.removeItem(STORE);renderAverage()});
window.addEventListener('beforeunload',()=>stop(false));loadSamples();
