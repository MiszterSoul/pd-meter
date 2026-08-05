import { FaceLandmarker, FilesetResolver } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/+esm';

const $ = (id) => document.getElementById(id);
const video = $('video');
const canvas = $('canvas');
const ctx = canvas.getContext('2d');
const stage = $('stage');
const statusEl = $('status');
const stageHint = $('stageHint');

let stream = null;
let facingMode = 'user';
let imageReady = false;
let faceLandmarker = null;
let autoEyes = null;
let eyes = null;
let nose = null;
let cardPoints = [];
let dragTarget = null;
let sourceImage = null;
let mirroredCapture = false;

const CARD_WIDTH_MM = 85.6;

function setStatus(text){ statusEl.textContent = text; }
function dist(a,b){ return Math.hypot(a.x-b.x,a.y-b.y); }
function avg(points){ return {x:points.reduce((s,p)=>s+p.x,0)/points.length,y:points.reduce((s,p)=>s+p.y,0)/points.length}; }
function canvasPoint(event){
  const rect = canvas.getBoundingClientRect();
  const touch = event.touches?.[0] || event.changedTouches?.[0] || event;
  return {x:(touch.clientX-rect.left)*canvas.width/rect.width,y:(touch.clientY-rect.top)*canvas.height/rect.height};
}
function near(point,target,radius=28){ return target && dist(point,target) <= radius*(canvas.width/canvas.clientWidth); }

async function startCamera(){
  stopCamera();
  try{
    stream = await navigator.mediaDevices.getUserMedia({video:{facingMode,width:{ideal:1920},height:{ideal:1080}},audio:false});
    video.srcObject = stream;
    await video.play();
    video.hidden = false;
    canvas.style.position = 'absolute';
    stageHint.classList.add('hidden');
    $('capture').disabled = false;
    $('switchCamera').disabled = false;
    $('retake').disabled = true;
    $('analyze').disabled = true;
    setStatus('Tartsd a kártyát az arcod síkjában, nézz a kamerába, majd készíts képet.');
  }catch(error){
    setStatus(`A kamera nem indítható: ${error.message}`);
  }
}
function stopCamera(){
  stream?.getTracks().forEach(track=>track.stop());
  stream = null;
}
async function switchCamera(){ facingMode = facingMode === 'user' ? 'environment' : 'user'; await startCamera(); }

function sizeCanvas(width,height){
  canvas.width = width;
  canvas.height = height;
  canvas.style.position = 'relative';
  stage.style.minHeight = '0';
}
function resetMeasurement(){
  cardPoints=[]; autoEyes=null; eyes=null; nose=null; dragTarget=null;
  $('calibration').classList.add('hidden'); $('results').classList.add('hidden');
  updateCardState();
}
function capture(){
  if(!video.videoWidth) return;
  sizeCanvas(video.videoWidth,video.videoHeight);
  mirroredCapture = facingMode === 'user';
  ctx.save();
  if(mirroredCapture){ ctx.translate(canvas.width,0); ctx.scale(-1,1); }
  ctx.drawImage(video,0,0,canvas.width,canvas.height);
  ctx.restore();
  sourceImage = ctx.getImageData(0,0,canvas.width,canvas.height);
  imageReady=true;
  video.hidden=true; stopCamera(); resetMeasurement(); redraw();
  $('capture').disabled=true; $('retake').disabled=false; $('analyze').disabled=false;
  setStatus('Kép elkészült. Indítsd el az arcfelismerést.');
}
function loadFile(file){
  if(!file) return;
  const img=new Image();
  img.onload=()=>{
    const max=2200, scale=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));
    sizeCanvas(Math.round(img.naturalWidth*scale),Math.round(img.naturalHeight*scale));
    ctx.drawImage(img,0,0,canvas.width,canvas.height);
    sourceImage=ctx.getImageData(0,0,canvas.width,canvas.height);
    mirroredCapture=false; imageReady=true; video.hidden=true; stopCamera(); resetMeasurement(); redraw();
    stageHint.classList.add('hidden'); $('retake').disabled=false; $('analyze').disabled=false; $('capture').disabled=true;
    URL.revokeObjectURL(img.src); setStatus('Kép betöltve. Indítsd el az arcfelismerést.');
  };
  img.src=URL.createObjectURL(file);
}
async function ensureModel(){
  if(faceLandmarker) return;
  setStatus('Arcfelismerő modell betöltése…');
  const vision=await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm');
  faceLandmarker=await FaceLandmarker.createFromOptions(vision,{
    baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',delegate:'GPU'},
    runningMode:'IMAGE',numFaces:1,outputFaceBlendshapes:false,outputFacialTransformationMatrixes:false
  });
}
async function analyze(){
  if(!imageReady) return;
  try{
    await ensureModel();
    const bitmap=await createImageBitmap(new ImageData(sourceImage,canvas.width,canvas.height));
    const result=faceLandmarker.detect(bitmap); bitmap.close();
    const lm=result.faceLandmarks?.[0];
    if(!lm){ setStatus('Nem találtam arcot. Készíts élesebb, szemből készült képet jobb fényben.'); return; }
    const px=(p)=>({x:p.x*canvas.width,y:p.y*canvas.height});
    const irisA=[468,469,470,471,472].map(i=>px(lm[i]));
    const irisB=[473,474,475,476,477].map(i=>px(lm[i]));
    const a=avg(irisA), b=avg(irisB);
    const ordered=[a,b].sort((p,q)=>p.x-q.x);
    autoEyes={left:{...ordered[0]},right:{...ordered[1]}};
    eyes=structuredClone(autoEyes);
    nose=px(lm[168]);
    $('calibration').classList.remove('hidden'); $('results').classList.remove('hidden');
    setStatus('Arc felismerve. Jelöld meg a referencia négy sarkát, majd ellenőrizd a pupillapontokat.');
    redraw(); updateResults();
  }catch(error){ setStatus(`Az elemzés sikertelen: ${error.message}`); }
}

function drawPoint(p,color,label){
  const r=Math.max(7,canvas.width/170);
  ctx.beginPath(); ctx.arc(p.x,p.y,r,0,Math.PI*2); ctx.fillStyle=color; ctx.fill(); ctx.lineWidth=Math.max(2,canvas.width/700); ctx.strokeStyle='#fff'; ctx.stroke();
  ctx.font=`600 ${Math.max(14,canvas.width/70)}px system-ui`; ctx.fillStyle='#fff'; ctx.fillText(label,p.x+r+5,p.y-r-2);
}
function redraw(){
  if(!sourceImage) return;
  ctx.putImageData(sourceImage,0,0);
  if(cardPoints.length){
    ctx.lineWidth=Math.max(3,canvas.width/500); ctx.strokeStyle='#f59e0b'; ctx.beginPath();
    cardPoints.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y)); if(cardPoints.length===4) ctx.closePath(); ctx.stroke();
    cardPoints.forEach((p,i)=>drawPoint(p,'#f59e0b',String(i+1)));
  }
  if(eyes){ drawPoint(eyes.left,'#22c55e','P'); drawPoint(eyes.right,'#22c55e','P'); }
  if(nose){
    ctx.setLineDash([12,10]); ctx.strokeStyle='#60a5fa'; ctx.lineWidth=Math.max(2,canvas.width/700); ctx.beginPath(); ctx.moveTo(nose.x,Math.max(0,nose.y-canvas.height*.12)); ctx.lineTo(nose.x,Math.min(canvas.height,nose.y+canvas.height*.13)); ctx.stroke(); ctx.setLineDash([]);
  }
}
function referenceLength(){ return document.querySelector('input[name="reference"]:checked').value==='card' ? CARD_WIDTH_MM : Number($('customLength').value); }
function scaleMmPerPx(){
  if(cardPoints.length!==4) return null;
  const top=dist(cardPoints[0],cardPoints[1]), bottom=dist(cardPoints[3],cardPoints[2]);
  const widthPx=(top+bottom)/2;
  return widthPx>0 ? referenceLength()/widthPx : null;
}
function updateCardState(){ $('cardState').textContent=`${cardPoints.length}/4 sarok megadva${cardPoints.length===4?' – kalibráció kész.':'.'}`; updateResults(); }
function updateResults(){
  const scale=scaleMmPerPx();
  if(!scale||!eyes){ ['pdTotal','pdRight','pdLeft'].forEach(id=>$(id).textContent='–'); $('qualityText').textContent='Kalibráció szükséges'; return; }
  const total=dist(eyes.left,eyes.right)*scale;
  const centerX=nose?.x ?? (eyes.left.x+eyes.right.x)/2;
  const leftImage=Math.abs(centerX-eyes.left.x)*scale;
  const rightImage=Math.abs(eyes.right.x-centerX)*scale;
  // A képernyő bal oldali szem a személy jobb szeme szemből nézett képen.
  $('pdTotal').textContent=total.toFixed(1);
  $('pdRight').textContent=leftImage.toFixed(1);
  $('pdLeft').textContent=rightImage.toFixed(1);
  const top=dist(cardPoints[0],cardPoints[1]), bottom=dist(cardPoints[3],cardPoints[2]);
  const skew=Math.abs(top-bottom)/((top+bottom)/2);
  let quality='Mérés kész';
  if(total<50||total>80) quality='Szokatlan eredmény – ellenőrizd a pontokat';
  else if(skew>.12) quality='A referencia perspektívája túl nagy';
  else if(Math.abs(leftImage-rightImage)>6) quality='Ellenőrizd az orr-középvonalat';
  $('qualityText').textContent=quality;
}

function pointerDown(e){
  if(!imageReady) return;
  const p=canvasPoint(e);
  if(eyes&&near(p,eyes.left)) dragTarget={type:'eye',key:'left'};
  else if(eyes&&near(p,eyes.right)) dragTarget={type:'eye',key:'right'};
  else{
    const i=cardPoints.findIndex(cp=>near(p,cp));
    if(i>=0) dragTarget={type:'card',index:i};
    else if(cardPoints.length<4){ cardPoints.push(p); updateCardState(); redraw(); }
  }
  if(dragTarget) e.preventDefault();
}
function pointerMove(e){
  if(!dragTarget) return;
  e.preventDefault(); const p=canvasPoint(e);
  if(dragTarget.type==='eye') eyes[dragTarget.key]=p; else cardPoints[dragTarget.index]=p;
  redraw(); updateResults();
}
function pointerUp(){ dragTarget=null; }

$('startCamera').addEventListener('click',startCamera);
$('switchCamera').addEventListener('click',switchCamera);
$('capture').addEventListener('click',capture);
$('retake').addEventListener('click',()=>{ resetMeasurement(); sourceImage=null; imageReady=false; ctx.clearRect(0,0,canvas.width,canvas.height); startCamera(); });
$('analyze').addEventListener('click',analyze);
$('fileInput').addEventListener('change',e=>loadFile(e.target.files[0]));
$('resetCard').addEventListener('click',()=>{cardPoints=[];updateCardState();redraw();});
$('resetEyes').addEventListener('click',()=>{if(autoEyes){eyes=structuredClone(autoEyes);redraw();updateResults();}});
document.querySelectorAll('input[name="reference"]').forEach(el=>el.addEventListener('change',()=>{$('customLengthWrap').classList.toggle('hidden',el.value!=='custom'||!el.checked);updateResults();}));
$('customLength').addEventListener('input',updateResults);
canvas.addEventListener('pointerdown',pointerDown); canvas.addEventListener('pointermove',pointerMove); canvas.addEventListener('pointerup',pointerUp); canvas.addEventListener('pointercancel',pointerUp); canvas.addEventListener('pointerleave',pointerUp);
window.addEventListener('beforeunload',stopCamera);
if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
