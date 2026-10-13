// Speaking: what the assistant says aloud is not what it writes. The written
// answer stays on screen in full; the voice gets one short line made for the
// ear, plus brief phrases that cover the wait. This module makes that line with
// a Nemotron model and turns text into audio with Google's Chirp 3 HD voices.
// Only those short lines ever reach the speech service: never the user's audio,
// and never the detailed answer.
import {createSign} from 'node:crypto';
import {readFileSync} from 'node:fs';

const fail=(message,status=400)=>Object.assign(Error(message),{status});
export const acknowledgements=['On it.','Sure, one moment.','Let me check.','Okay, give me a second.'];
// What is said while a step takes a while, keyed by the same progress steps the page shows.
export const waitingPhrases=[
  [/grocery_offers/,'I’m reading this week’s offers.'],[/job_matches/,'I’m going through the job postings.'],[/job_application_advice/,'I’m reading the posting against your CV.'],
  [/plan_day/,'I’m checking places, opening hours and travel times.'],[/find_events/,'I’m looking at what’s on.'],[/local_news/,'I’m reading the local news.'],
  [/calendar_/,'I’m looking at your calendar.'],[/research_topics/,'I’m checking your research topics.'],[/todo/,'I’m opening your list.'],[/^/,'Still working on it.'],
];
export const waitingPhrase=tool=>waitingPhrases.find(([pattern])=>pattern.test(String(tool||'')))[1];

// ---- the line made for the ear ----
const numbersIn=text=>new Set((String(text).match(/\d+(?:[.,:]\d+)*/g)||[]).map(n=>n.replace(/[.,:]$/,'')));
// A spoken line may not bring in anything the written answer lacks. Numbers are the part
// that can be checked exactly, so a line with a number the answer does not contain is refused.
export function acceptable(line,written){
  const text=String(line||'').replace(/\s+/g,' ').trim();
  if(!text||text.length>260||/https?:|www\.|[*_#|`]/.test(text))return null;
  const known=numbersIn(written);
  for(const n of numbersIn(text))if(!known.has(n))return null;
  return text;
}
// Used when no model is available or its line is refused: honest, and points at the screen.
export function plainLine(written){
  const first=String(written).split(/(?<=[.!?])\s+|\n+/).map(s=>s.trim()).find(s=>s.length>8&&s.length<=160&&!/https?:|\d{2}:\d{2}.*\d{2}:\d{2}/.test(s));
  return first&&String(written).trim().length<=160&&!/\n/.test(String(written).trim())?first:'Here’s what I found. The details are on the screen.';
}
// When the written answer ends by asking the user something (above all “shall I add it?”),
// the question is spoken word for word. A paraphrase by the model once announced “I've
// scheduled a meeting” for an event that was only being proposed.
export function closingQuestion(written){
  const text=String(written).trim();if(!/\?\s*$/.test(text))return null;
  const sentences=text.split(/(?<=[.!?])\s+|\n+/).map(s=>s.trim()).filter(Boolean),question=sentences.at(-1);
  if(question.length>200)return 'I have a question for you. It’s on the screen.';
  return (sentences.length>1?'The details are on the screen. ':'')+question;
}
export async function spokenLine({asked,written},model,{fetchImpl=fetch}={}){
  const question=closingQuestion(written);if(question)return {line:question,by:'rule'};
  const fallback=plainLine(written);
  if(!model?.key||String(written).length<60)return {line:acceptable(written,written)&&String(written).length<=160?String(written).trim():fallback,by:'rule'};
  try{
    const r=await fetchImpl(model.base.replace(/\/$/,'')+'/chat/completions',{method:'POST',signal:AbortSignal.timeout(12000),headers:{Authorization:'Bearer '+model.key,'Content-Type':'application/json'},
      body:JSON.stringify({model:model.model,temperature:0.3,max_tokens:1500,messages:[
        {role:'system',content:'You write what a voice assistant says aloud while the full written answer is shown on a screen. One or two short, natural sentences, at most 35 words. Say what was found or done in general terms and, if it fits, offer to go into detail. Do not read out lists, times, prices, links or addresses; mention at most one name. If the written answer asks the user a question or asks them to confirm something, say that question plainly. Never state anything that is not in the written answer. Reply with the spoken words only.'},
        {role:'user',content:`The user said: ${String(asked||'').slice(0,300)}\n\nThe written answer on screen:\n${String(written).slice(0,3000)}`}]})});
    if(!r.ok)throw Error('status '+r.status);
    const line=acceptable(((await r.json()).choices?.[0]?.message?.content||'').replace(/^["“]|["”]$/g,''),written);
    return line?{line,by:'model'}:{line:fallback,by:'rule'};
  }catch{return {line:fallback,by:'rule'};}
}

// ---- text to audio ----
// Google sign-in for a service account: a signed statement exchanged for a short-lived token.
export function createGoogleSpeech({credentialsFile,credentials,voice='en-GB-Chirp3-HD-Aoede',fetchImpl=fetch,now=()=>Date.now()}={}){
  let account=credentials||null,problem='';
  if(!account&&credentialsFile){try{account=JSON.parse(readFileSync(credentialsFile,'utf8'));}catch{problem='The speech credentials file could not be read.';}}
  const configured=!!(account?.client_email&&account?.private_key);
  let token=null;const cache=new Map();
  async function accessToken(){
    if(token&&token.expires>now()+60000)return token.value;
    const at=Math.floor(now()/1000),part=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned=part({alg:'RS256',typ:'JWT'})+'.'+part({iss:account.client_email,scope:'https://www.googleapis.com/auth/cloud-platform',aud:account.token_uri||'https://oauth2.googleapis.com/token',iat:at,exp:at+3600});
    const assertion=unsigned+'.'+createSign('RSA-SHA256').update(unsigned).sign(account.private_key,'base64url');
    const r=await fetchImpl(account.token_uri||'https://oauth2.googleapis.com/token',{method:'POST',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})});
    if(!r.ok)throw fail('The speech service refused this server’s credentials.',502);
    const body=await r.json();token={value:body.access_token,expires:now()+(body.expires_in||3600)*1000};return token.value;
  }
  return {
    status:()=>({configured,voice:configured?voice:null,error:problem}),
    // MP3 audio for one short line, as base64. Repeated phrases are served from memory.
    async say(text){
      const line=String(text||'').replace(/\s+/g,' ').trim();
      if(!line||line.length>300)throw fail('Only a short line can be spoken.');
      if(!configured)throw fail('A voice is not set up on this server.',503);
      if(cache.has(line))return cache.get(line);
      const r=await fetchImpl('https://texttospeech.googleapis.com/v1/text:synthesize',{method:'POST',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+await accessToken(),'Content-Type':'application/json'},
        body:JSON.stringify({input:{text:line},voice:{languageCode:voice.split('-').slice(0,2).join('-'),name:voice},audioConfig:{audioEncoding:'MP3'}})});
      if(!r.ok){if(r.status===401||r.status===403)token=null;throw fail(r.status===403?'The speech service is not enabled for this project, or these credentials may not use it.':'The speech service could not produce audio ('+r.status+').',502);}
      const audio=(await r.json()).audioContent;if(!audio)throw fail('The speech service returned no audio.',502);
      if(cache.size>=200)cache.delete(cache.keys().next().value);
      cache.set(line,audio);return audio;
    }
  };
}
