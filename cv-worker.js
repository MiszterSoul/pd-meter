let ready=false,cvRef=null;
self.Module={onRuntimeInitialized(){cvRef=self.cv;ready=true;self.postMessage({type:'ready'})}};
self.postMessage({type:'status',text:'OpenCV JavaScript letöltése…'});
importScripts('https://docs.opencv.org/4.x/opencv.js');

const waitReady=()=>new Promise((resolve,reject)=>{
  const started=Date.now();
  const timer=setInterval(()=>{
    if(ready||self.cv?.Mat){clearInterval(timer);cvRef=self.cv;ready=true;self.postMessage({type:'ready'});resolve()}
    else if(Date.now()-started>30000){clearInterval(timer);reject(new Error('Az OpenCV nem indult el 30 másodpercen belül.'))}
  },100);
});
waitReady().catch(error=>self.postMessage({type:'error',message:error.message}));

const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
function orderQuad(points){
  const sum=points.map(p=>p.x+p.y),diff=points.map(p=>p.y-p.x);
  return [points[sum.indexOf(Math.min(...sum))],points[diff.indexOf(Math.min(...diff))],points[sum.indexOf(Math.max(...sum))],points[diff.indexOf(Math.max(...diff))]];
}

self.onmessage=async event=>{
  if(event.data?.type!=='detect')return;
  try{
    if(!ready)await waitReady();
    const {buffer,width,height,id}=event.data;
    const rgba=new Uint8ClampedArray(buffer);
    const imageData=new ImageData(rgba,width,height);
    const cv=cvRef||self.cv;
    const src=cv.matFromImageData(imageData),gray=new cv.Mat(),blur=new cv.Mat(),edges=new cv.Mat(),contours=new cv.MatVector(),hier=new cv.Mat();
    let best=null,bestArea=0,kernel=null;
    try{
      cv.cvtColor(src,gray,cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray,blur,new cv.Size(5,5),0);
      cv.Canny(blur,edges,55,150);
      kernel=cv.Mat.ones(3,3,cv.CV_8U);cv.dilate(edges,edges,kernel);
      cv.findContours(edges,contours,hier,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
      const frameArea=width*height;
      for(let i=0;i<contours.size();i++){
        const c=contours.get(i),area=cv.contourArea(c);
        if(area<frameArea*.018||area>frameArea*.35){c.delete();continue}
        const peri=cv.arcLength(c,true),approx=new cv.Mat();cv.approxPolyDP(c,approx,.025*peri,true);
        if(approx.rows===4&&cv.isContourConvex(approx)){
          const pts=[];for(let j=0;j<4;j++)pts.push({x:approx.intPtr(j,0)[0],y:approx.intPtr(j,0)[1]});
          const q=orderQuad(pts),w=(dist(q[0],q[1])+dist(q[3],q[2]))/2,h=(dist(q[0],q[3])+dist(q[1],q[2]))/2,ratio=w/h;
          if(ratio>1.38&&ratio<1.82&&area>bestArea){best={points:q,width:w,height:h,area};bestArea=area}
        }
        approx.delete();c.delete();
      }
    }finally{kernel?.delete();src.delete();gray.delete();blur.delete();edges.delete();contours.delete();hier.delete()}
    self.postMessage({type:'result',id,card:best});
  }catch(error){self.postMessage({type:'error',message:error.message})}
};