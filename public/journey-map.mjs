import { routeGeometry } from './route-geometry.mjs';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clock=n=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
const labels={hair:'Haircut',ramen:'Ramen',movie:'Movie'};
const colors=['#426c56','#8c599e','#bc7432','#397694'];
let canvas,map,googleMaps,loading,config,markers=[],lines=[],bounds,revision='',current=null,token=0,loadError='';
export function mapPanel(result,plan,configured){
  const missing=routeGeometry(plan).filter(l=>!l.stationary&&!l.segments.length).length;
  return `<aside class="card journey-map-panel" aria-label="Current Plan Route Map"><div class="journey-map-heading"><div><span class="eyebrow">YOUR AFTERNOON, MAPPED</span><h3>Walking Through Today</h3></div><button type="button" class="button outline" data-map-fit>View Full Route</button></div><p>${esc(plan.name)} · ${esc(result.constraints.date)} · ${plan.travel} minutes commute</p><details class="journey-map-disclosure" open><summary>Expand / Collapse Map</summary><div id="journey-map-host" aria-label="Google Itinerary Map"></div></details><p class="journey-map-status" role="status">${configured?'Loading Google Maps…':'The map is not configured with a browser key; route details can still be viewed via the links below.'}</p><div class="journey-map-legend"><span>┄ Walking</span><span>━ Public Transit</span><span>Color‑code each segment</span></div>${missing?`<p class="notice">${missing} Segments lack route shapes; only points are shown. Regenerate to get the latest routes.</p>`:''}<div class="journey-map-stops"><button type="button" data-map-origin><b>Start / End</b> ${esc(result.origin.name)}</button>${plan.stops.map((s,i)=>`<button type="button" data-map-stop="${i}"><b>${i+1}</b><span>${esc(s.label||labels[s.kind]||'Activity ')} · ${esc(result.places[s.placeId]?.name)}<small>${clock(s.start)}–${clock(s.end)}${s.locked?' · Locked':''}</small></span></button>`).join('')}</div><p class="muted">The route corresponds to the query time of this plan; please check schedules again before navigating. Map actions do not modify the calendar.</p></aside>`;
}
function notice(text){const el=document.querySelector('.journey-map-status');if(el)el.textContent=text;}
async function load(){
  if(loading)return loading;
  loading=(async()=>{
    const r=await fetch('/api/maps/config');if(!r.ok)throw Error('Failed to load map configuration; please refresh the page and try again.');config=await r.json();
    if(!config.key)throw Error('The map lacks a browser key. Please configure it and refresh the page; you can still open each segment Google Maps Navigation links.');
    await new Promise((resolve,reject)=>{
      const script=document.createElement('script');const timer=setTimeout(()=>reject(Error('Map load timed out. Check your network and refresh; trip and calendar features remain usable.')),20000);
      window.daylightMapsReady=()=>{clearTimeout(timer);resolve();delete window.daylightMapsReady;};
      window.gm_authFailure=()=>{loadError='Google Map authorization failed; please check website restrictions for the browser key,API and quota.';notice(loadError);clearTimeout(timer);reject(Error(loadError));};
      script.async=true;script.referrerPolicy='strict-origin-when-cross-origin';
      script.src='https://maps.googleapis.com/maps/api/js?'+new URLSearchParams({key:config.key,v:'quarterly',loading:'async',libraries:'marker',callback:'daylightMapsReady',language:'en-GB',region:'SE'});
      script.onerror=()=>{clearTimeout(timer);reject(Error('The map failed to load; please check your network and refresh the page.'));};document.head.append(script);
    });
    googleMaps=window.google.maps;
  })();return loading;
}
function highlight(type,index){
  document.querySelectorAll('.map-selected').forEach(e=>e.classList.remove('map-selected'));
  document.querySelectorAll(`[data-map-${type}="${index}"]`).forEach(e=>e.classList.add('map-selected'));
  markers.forEach((m,i)=>{m.zIndex=type==='stop'&&i===index+1?30:9+i;});
  lines.forEach(l=>l.line.setOptions({strokeWeight:l.index===index&&type==='leg'?7:4,zIndex:l.index===index&&type==='leg'?3:1}));
}
function reveal(type,index){const el=document.getElementById(`journey-${type}-${index}`);el?.scrollIntoView({behavior:'smooth',block:'center'});highlight(type,index);}
function fit(b){if(map&&b&&!b.isEmpty())map.fitBounds(b,45);}
function point(location){return location&&Number.isFinite(location.latitude)&&Number.isFinite(location.longitude)?{lat:location.latitude,lng:location.longitude}:null;}
function draw(result,plan){
  markers.forEach(m=>{m.map=null;});lines.forEach(l=>l.line.setMap(null));markers=[];lines=[];bounds=new googleMaps.LatLngBounds();
  const addMarker=(place,title,glyph,index)=>{
    const position=point(place?.location);if(!position)return;bounds.extend(position);
    const nearby=markers.some(m=>Math.abs(m.position.lat-position.lat)<.00035&&Math.abs(m.position.lng-position.lng)<.0005);
    const pin=document.createElement('div');pin.className='journey-map-pin'+(nearby?' pin-below':'');pin.textContent=glyph;pin.style.background=index===-1?'#293e37':colors[index%colors.length];
    const marker=new googleMaps.marker.AdvancedMarkerElement({map,position,title,gmpClickable:true,anchorTop:nearby?'0%':'-100%',zIndex:index===-1?9:10+index});
    marker.appendChild(pin);marker.addEventListener('gmp-click',()=>{if(index>=0)reveal('stop',index);notice(title);});markers.push(marker);
  };
  addMarker(result.origin,'Departure and Return · '+result.origin.name,'Start',-1);
  plan.stops.forEach((s,i)=>addMarker(result.places[s.placeId],`${i+1} · ${esc(s.label||labels[s.kind]||'Activity ')} · ${result.places[s.placeId]?.name} · ${clock(s.start)}–${clock(s.end)}`,String(i+1),i));
  const geometry=routeGeometry(plan);
  for(const leg of geometry)for(const segment of leg.segments){
    segment.path.forEach(p=>bounds.extend(p));const color=colors[leg.index%colors.length];
    const line=new googleMaps.Polyline({map,path:segment.path,strokeColor:color,strokeWeight:4,strokeOpacity:segment.mode==='walk'?0:.85,icons:segment.mode==='walk'?[{icon:{path:'M 0,-1 0,1',strokeColor:color,strokeOpacity:1,strokeWeight:3,scale:2},offset:'0',repeat:'12px'}]:[],zIndex:1});
    line.addListener('click',()=>{reveal('leg',leg.index);notice(legText(leg.index));});lines.push({line,index:leg.index});
  }
  canvas.dataset.planId=plan.id;canvas.dataset.sessionId=result.id;canvas.dataset.segmentCount=String(lines.length);
  fit(bounds);
  const missing=geometry.filter(l=>!l.stationary&&!l.segments.length).length;
  notice(missing?`Locations displayed;${missing} Segment lacks route shape; please view the corresponding navigation link.`:`Displayed ${plan.legs.length} segment route · ${clock(plan.homeAt)} Return to start point`);
}
function legText(i){const l=current.plan.legs[i];return `Stop  ${i+1}  leg · ${current.result.places[l.from]?.name} → ${current.result.places[l.to]?.name} · ${clock(l.depart)}–${clock(l.arrive)} · ${l.minutes}  minutes`;}
export async function mountJourneyMap(result,plan){
  const version=++token,host=document.getElementById('journey-map-host');
  if(!host||!plan){current=null;return;}
  current={result,plan};
  // Reattach one map instance across the app's full HTML renders. Selection and
  // calendar form changes must not create new billable map instances.
  if(!canvas){canvas=document.createElement('div');canvas.className='journey-map-canvas';}
  host.replaceChildren(canvas);
  try{
    await load();if(version!==token||!host.isConnected)return;if(loadError)throw Error(loadError);
    if(!map)map=new googleMaps.Map(canvas,{center:point(result.origin.location)||{lat:59.33,lng:18.06},zoom:13,mapId:config.mapId,renderingType:googleMaps.RenderingType.RASTER,gestureHandling:'cooperative',streetViewControl:false,mapTypeControl:false,fullscreenControl:true});
    googleMaps.event.trigger(map,'resize');
    const next=result.id+':'+plan.id;
    if(revision!==next){draw(result,plan);revision=next;}else{const missing=routeGeometry(plan).filter(l=>!l.stationary&&!l.segments.length).length;notice(missing?`Locations displayed;${missing} Segment lacks route shape; please view the corresponding navigation link.`:`Displayed ${plan.legs.length} segment route · ${clock(plan.homeAt)} Return to start point`);}
  }catch(e){if(version===token)notice(e.message);}
}
function focusMap(e){
  if(e.target.closest('a,input,select,textarea'))return;
  const el=e.target.closest('[data-map-fit],[data-map-stop],[data-map-leg],[data-map-origin]');if(!el||!map||!current||!document.getElementById('journey-map-host'))return;
  if(e.type==='keydown'&&!['Enter',' '].includes(e.key))return;if(e.type==='keydown')e.preventDefault();
  const disclosure=document.querySelector('.journey-map-disclosure');disclosure.open=true;googleMaps.event.trigger(map,'resize');
  if(el.hasAttribute('data-map-fit')){fit(bounds);highlight('none',-1);const missing=routeGeometry(current.plan).filter(l=>!l.stationary&&!l.segments.length).length;notice(missing?`${missing} Segment lacks route shape; please check the navigation link.`:`Displayed ${current.plan.legs.length} segment route · ${clock(current.plan.homeAt)} Return to start point`);return;}
  if(el.hasAttribute('data-map-leg')){const i=Number(el.dataset.mapLeg),b=new googleMaps.LatLngBounds();routeGeometry(current.plan)[i]?.segments.forEach(s=>s.path.forEach(p=>b.extend(p)));fit(b);highlight('leg',i);notice(legText(i));}
  else{const i=el.hasAttribute('data-map-origin')?-1:Number(el.dataset.mapStop),place=i===-1?current.result.origin:current.result.places[current.plan.stops[i]?.placeId],p=point(place?.location);if(p){map.panTo(p);map.setZoom(16);}if(i>=0)highlight('stop',i);notice((i===-1?'Departure and Return':`Stop  ${i+1} stop`)+' · '+place?.name);}
  if(matchMedia('(max-width:1100px)').matches)document.querySelector('.journey-map-panel')?.scrollIntoView({behavior:'smooth',block:'start'});
}
document.addEventListener('click',focusMap);document.addEventListener('keydown',focusMap);
document.addEventListener('toggle',e=>{if(e.target.matches?.('.journey-map-disclosure')&&e.target.open&&map){googleMaps.event.trigger(map,'resize');fit(bounds);}},true);
