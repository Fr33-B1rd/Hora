import {matchesRequiredName} from './journey.mjs';

export const validLocation=p=>p&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)&&Math.abs(p.latitude)<=90&&Math.abs(p.longitude)<=180;
const words=s=>String(s).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().match(/[\p{L}\p{N}]+/gu)||[];
// Swedish possessive -s is only used alongside independent coordinate evidence.
const tokens=s=>words(s).map(w=>w.length>4?w.replace(/s$/,''):w);
export function eventVenueMatch(place,event){
  if(!event)return null;
  const located=validLocation(event.location)&&validLocation(place.location);
  const meters=located?Math.round(111000*Math.hypot(place.location.latitude-event.location.latitude,(place.location.longitude-event.location.longitude)*Math.cos(event.location.latitude*Math.PI/180))):null;
  if(located&&meters>100)return null;
  const exact=matchesRequiredName(place,{requiredNames:[event.venue]});
  const source=tokens(event.venue);
  const alias=located&&[place.name,...(place.aliases||[])].find(name=>{const ws=tokens(name);return ws.length>=2&&ws.every(w=>source.includes(w));});
  if(!exact&&!alias)return null;
  return {placeId:place.id,sourceVenue:event.venue,mapName:place.name,matchedName:alias||place.name,method:alias?'localized_name_and_coordinates':'source_name',distanceMeters:meters,source:event.url};
}
