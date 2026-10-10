const normalize=p=>({id:p.id,name:p.displayName?.text||'',address:p.formattedAddress,location:p.location,url:p.googleMapsUri,rating:p.rating,reviews:p.userRatingCount,hours:p.regularOpeningHours?.weekdayDescriptions||[],periods:p.regularOpeningHours?.periods??null,website:p.websiteUri||null,attributions:p.attributions||[]});
export function createMaps(key,fetchImpl=fetch) {
  async function request(url,body,fields,method='POST') {
    if(!key)throw new Error('not configured Google Maps key. please fill in .env fill in GOOGLE_MAPS_API_KEY and restart.');
    const res=await fetchImpl(url,{method,signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/json','X-Goog-Api-Key':key,'X-Goog-FieldMask':fields},...(method==='POST'?{body:JSON.stringify(body)}:{})});
    if(!res.ok)throw new Error(`Google Maps Returned ${res.status}, please check the key, API  API enablement and quota.`);
    return res.json();
  }
  return {
    async search(query,type,center={latitude:59.3293,longitude:18.0686}) {
      if(typeof query!=='string'||!query.trim()||query.length>200)throw new Error('Please enter  1–200  characters for a place name.');
      const body={textQuery:query+' Stockholm Sweden',languageCode:'en',regionCode:'SE',pageSize:5,locationBias:{circle:{center,radius:5000}}};
      if(type)Object.assign(body,{includedType:type,strictTypeFiltering:true});
      const result=await request('https://places.googleapis.com/v1/places:searchText',body,'places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri,places.businessStatus,places.regularOpeningHours,places.rating,places.userRatingCount,places.attributions,places.websiteUri');
      return (result.places||[]).filter(p=>p.location&&p.businessStatus!=='CLOSED_PERMANENTLY'&&p.businessStatus!=='CLOSED_TEMPORARILY').map(normalize);
    },
    async details(id,languageCode='en'){
      if(!['en','sv'].includes(languageCode))throw Error('Unsupported place language');
      const p=await request('https://places.googleapis.com/v1/places/'+encodeURIComponent(id)+'?languageCode='+languageCode,null,'id,displayName,formattedAddress,location,googleMapsUri,businessStatus,regularOpeningHours,rating,userRatingCount,attributions,websiteUri','GET');
      if(!p.location||p.businessStatus==='CLOSED_PERMANENTLY'||p.businessStatus==='CLOSED_TEMPORARILY')throw Error('verified or locked location currently unavailable, please first confirm the original arrangement.');return normalize(p);
    },
    async route(origin,destination,departure,mode) {
      const body={origin:{placeId:origin},destination:{placeId:destination},travelMode:mode==='walk'?'WALK':'TRANSIT',languageCode:'en',units:'METRIC'};
      if(mode!=='walk')body.departureTime=departure;
      const fields='routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.steps.polyline.encodedPolyline,routes.legs.steps.travelMode,routes.legs.steps.staticDuration,routes.legs.steps.transitDetails,routes.travelAdvisory.transitFare';
      let result=await request('https://routes.googleapis.com/directions/v2:computeRoutes',body,fields),walkingFallback=false;
      if(!result.routes?.length&&mode==='transit'){
        delete body.departureTime;body.travelMode='WALK';
        result=await request('https://routes.googleapis.com/directions/v2:computeRoutes',body,fields);walkingFallback=true;mode='walk';
      }
      const r=result.routes?.[0];if(!r||!/^\d+(\.\d+)?s$/.test(r.duration||''))throw new Error('this route segment has no available results; please adjust time or location.');
      const steps=r.legs?.flatMap(l=>l.steps||[])||[];
      if(steps.length&&steps.every(s=>s.travelMode==='WALK'))mode='walk';
      // Include any wait before a scheduled service, even if the reported duration starts later.
      let cursor=Date.parse(departure);
      for(const s of steps){const arrival=Date.parse(s.transitDetails?.stopDetails?.arrivalTime);cursor=Number.isFinite(arrival)?Math.max(cursor,arrival):cursor+parseFloat(s.staticDuration||'0s')*1000;}
      const minutes=Math.ceil(Math.max(parseFloat(r.duration),(cursor-Date.parse(departure))/1000)/60);
      return {polyline:r.polyline?.encodedPolyline||null,segments:steps.map(s=>({mode:s.travelMode==='WALK'?'walk':'transit',polyline:s.polyline?.encodedPolyline||null})),minutes,meters:r.distanceMeters||0,walking:mode==='walk'?minutes:Math.ceil(steps.filter(s=>s.travelMode==='WALK').reduce((n,s)=>n+parseFloat(s.staticDuration||'0'),0)/60),mode,walkingFallback,fare:mode==='walk'?{currencyCode:'SEK',units:'0'}:r.travelAdvisory?.transitFare||null,lines:steps.filter(s=>s.transitDetails).map(s=>({name:s.transitDetails.transitLine?.nameShort||s.transitDetails.transitLine?.name||'Transit',headsign:s.transitDetails.headsign,from:s.transitDetails.stopDetails?.departureStop?.name,to:s.transitDetails.stopDetails?.arrivalStop?.name,departure:s.transitDetails.stopDetails?.departureTime,arrival:s.transitDetails.stopDetails?.arrivalTime}))};
    }
  };
}
