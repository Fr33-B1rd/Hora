// Decode only provider geometry. Missing or malformed geometry is never replaced
// by a straight line between venues (which would imply a navigable route).
export function decodePolyline(encoded){
  if(typeof encoded!=='string'||!encoded.length)return [];
  let cursor=0,lat=0,lng=0;const points=[];
  const read=()=>{let value=0,shift=0,b;
    do{if(cursor>=encoded.length||shift>30)throw Error('Invalid polyline');b=encoded.charCodeAt(cursor++)-63;if(b<0||b>63)throw Error('Invalid polyline');value+=(b&31)*2**shift;shift+=5;}while(b>=32);
    return value%2?-(value+1)/2:value/2;
  };
  try{while(cursor<encoded.length){lat+=read();lng+=read();const p={lat:lat/1e5,lng:lng/1e5};if(Math.abs(p.lat)>90||Math.abs(p.lng)>180)return [];points.push(p);}}catch{return [];}
  return points.length>1?points:[];
}
export function legGeometry(leg){
  const steps=(leg.segments||[]).map(s=>({mode:s.mode,path:decodePolyline(s.polyline)}));
  if(steps.length&&steps.every(s=>s.path.length))return steps;
  const path=decodePolyline(leg.polyline);
  return path.length?[{mode:leg.mode==='walk'?'walk':'mixed',path}]:[];
}
export function routeGeometry(plan){return (plan?.legs||[]).map((l,index)=>({index,segments:legGeometry(l),stationary:l.from===l.to}));}
