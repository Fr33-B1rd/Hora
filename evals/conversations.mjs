// Fixed evaluation set: scripted conversations with objective checks.
// The world is fictional and deterministic; only the model is real.
const day=offset=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm'}).format(Date.now()+offset*86400000);
export const today=day(0),tomorrow=day(1);

const place=(id,name,latitude,longitude,periods=null)=>({id:'fx-'+id,name,address:name+', Stockholm',location:{latitude,longitude},rating:4.4,hours:periods?['Daily 10:00–17:00']:['Open daily'],periods,website:null,url:'https://maps.example/'+id});
const daily=(open,close)=>[0,1,2,3,4,5,6].map(d=>({open:{day:d,hour:open,minute:0},close:{day:d,hour:close,minute:0}}));
export const places=[
  [/t-?centralen|central station|centralstation|city cent|sergels/i,place('tc','T-Centralen',59.3309,18.0597)],
  [/kth/i,place('kth','KTH Royal Institute of Technology',59.3473,18.0730)],
  [/slussen/i,place('slussen','Slussen',59.3195,18.0722)],
  [/odenplan/i,place('odenplan','Odenplan',59.3429,18.0497)],
  [/östermalmstorg|ostermalmstorg/i,place('ostermalm','Östermalmstorg',59.3350,18.0740)],
  [/vasa/i,place('vasa','Vasamuseet',59.3280,18.0914,daily(10,17))],
  [/nationalmuseum|museum/i,place('national','Nationalmuseum',59.3286,18.0784)],
  [/moderna|museum/i,place('moderna','Moderna Museet',59.3260,18.0847)],
  [/ramen/i,place('ramen','Ramen Ki-Mama',59.3420,18.0580)],
  [/chinese/i,place('chinese','Formosa Restaurang',59.3360,18.0630)],
  [/seafood|fish/i,place('seafood','Sturehof',59.3355,18.0735)],
  [/sushi/i,place('sushi','Råkultur',59.3370,18.0700)],
  [/vete|fika|coffee|caf[eé]/i,place('fika','Vete-Katten',59.3343,18.0580)],
  [/grocer|supermarket|coop|ica/i,place('coop','Coop Centralen',59.3313,18.0590)],
  [/mall|shopping|galleria/i,place('mall','Gallerian',59.3312,18.0672)],
  [/cinema|film|movie|filmstaden/i,place('cinema','Filmstaden Sergel',59.3335,18.0620)],
  [/hair|barber/i,place('hair','Hårteamet',59.3390,18.0610)],
  [/book(shop|store)|bokhandel/i,place('books','Hedengrens Bokhandel',59.3352,18.0745)],
  [/gamla stan|old town/i,place('gamla','Gamla Stan',59.3250,18.0710)],
  [/park|djurgården|walk/i,place('park','Djurgården',59.3265,18.1100)],
  [/fasching|jazz/i,place('fasching','Fasching',59.3320,18.0550)],
  [/abf/i,place('abf','ABF-huset',59.3400,18.0590)],
  [/estniska/i,place('estniska','Estniska Huset',59.3440,18.0560)],
  [/restaurant|dinner|lunch|food/i,place('dinner','Restaurang Tradition',59.3380,18.0650)]
];
const event=(hex,title,description,venue,date,start,end,location)=>({ref:'event_'+hex,title,description,venue,start:date,end:date,url:'https://www.visitstockholm.com/events/'+hex+'/',occurrences:[{date,start,end}],scheduleStatus:'confirmed',ticketStatus:'unknown',categories:['Music'],location,distance:0.6,distanceOrigin:'T-Centralen'});
export const events=[
  event('a1a1a1a1a1a1','Stockholm Jazz Night','An evening concert with a Swedish quartet playing new compositions and standards.','Fasching',tomorrow,'19:00','21:00',{latitude:59.3320,longitude:18.0550}),
  event('b2b2b2b2b2b2','Vintage Flea Market','A flea market with second-hand clothing, records and ceramics from private sellers.','ABF-huset',tomorrow,'09:00','15:00',{latitude:59.3400,longitude:18.0590}),
  event('c3c3c3c3c3c3','Book release party Upon All the Living','Twelve Stockholm-based authors launch an anthology about cultural identity.','Estniska Huset',today,'18:00','20:00',{latitude:59.3440,longitude:18.0560})
];
export const news=[{type:'news',title:'Ny cykelbana öppnar på Södermalm',translatedTitle:'New cycle lane opens on Södermalm',url:'https://www.svt.se/nyheter/lokalt/stockholm/fixture-cykelbana',source:'SVT',publishedAt:new Date().toISOString()}];
export const calendars={'busy-afternoon':{[tomorrow]:[[13*60,17*60]]}};

// Checks receive {r, s, reply, trace, plan}: the turn result, saved trip state,
// reply text, tool trace and the selected checked plan (if any).
const bad=['intake_error','output_limit','service_error','limit'];
const used=name=>({trace})=>trace.some(t=>t.action===name&&t.status==='ok');
const unused=name=>({trace})=>!trace.some(t=>t.action===name);
const stop=(...allowed)=>({r})=>allowed.includes(r.stopReason);
const planned=({r})=>(r.journey?.plans.length||0)>0;
const unplanned=({r})=>!(r.journey?.plans.length>0);
const says=re=>({reply})=>re.test(reply);
const silent=re=>({reply})=>!re.test(reply);
const acts=n=>({s})=>s.activities.length===n;
const field=(key,value)=>({s})=>s[key]===value;
const freeOrder=({s})=>s.precedence.length===0||s.labels?.precedence==='assistant';
const labelled=(key,value)=>({s})=>s.labels?.[key]===value;
const asksOrigin=[['asks instead of failing',stop('needs_input','finished')],['does not plan without a departure point',unplanned],['asks for the departure point',says(/where|depart|start|leav|from/i)]];
export const universal=[
  ['turn completes without a system failure',({r})=>!bad.includes(r.stopReason)],
  ['answers within 90 s',({r})=>r.elapsedMs<90000],
  ['reply has no internal identifiers',silent(/eventRef|place_\d|\bact_?\d|budgetMode|windowStart|timeMode|choiceGroups/)],
  ['does not ask for a leave time, return time or budget',silent(/what time (would|do) you (like|want|plan|prefer) to (start|leave|depart|set off|be back|return)|when (would|do) you (like|want|plan) to (start|leave|depart|return|be back)|(what|any|do you have a).{0,20}budget.{0,25}\?/i)],
  ['does not present an unstated limit as a condition',({s,reply})=>!(s.start===null&&/\b(I assumed|assuming) (you('ll| will)? )?(leave|start|depart)/i.test(reply))&&!(s.budgetMode==='unknown'&&/\bno budget (limit|cap) (was|has been) set\b|since you (didn.t|did not) (set|give) a budget/i.test(reply))],
  ['reply is short',({reply})=>reply.length<=1100],
  ['reply is plain prose without markdown',({reply})=>!/\*\*|^\s*#{1,6}\s|^\s*\||^\s*(?:[-•*]|\d+[.)])\s/m.test(reply)],
  ['reply ends on a complete sentence',({reply})=>/[.!?…)"”’:]\s*$/.test(reply.trim())],
  ['reply does not claim a booking',silent(/\b(I|we)(’|')?(ve| have)? (tentatively |already )?(booked|reserved)\b/i)],
  ['a timetable without a checked plan is marked unverified',({r,s,reply,plan})=>!!plan||s.task?.status!=='active'||r.stopReason!=='finished'||!/\b\d{1,2}:\d{2}\b.*\b\d{1,2}:\d{2}\b/s.test(reply)||/not a checked itinerary|not (been )?verified|unverified|couldn.t|cannot|can.t|won.t fit|doesn.t fit|conflict|closed|outside|opening|hours/i.test(reply)],
  ['reply does not claim a calendar write',silent(/\b(I(’|')?ve|I have|has been|have been|was|is now|it(’|')?s been) (saved|added|written)\b[^.]*calendar/i)]
];
const fullPlan='Tomorrow from T-Centralen: ramen, then a film, leaving at 13:00 and home by 20:00, budget 800 SEK. Make a plan.';
const fullPlanChecks=[['produces a checked plan',planned],['origin kept',({s})=>/centralen/i.test(s.origin||'')],['budget is an 800 cap',({s})=>s.budgetMode==='limited'&&s.budget===800],['stated facts labelled as the user’s',({s})=>s.labels?.origin==='user'&&s.labels?.budget==='user'&&s.labels?.start==='user'],['hours kept',({s})=>s.start==='13:00'&&s.deadline==='20:00'],['explicit “then” recorded as order',({s})=>s.precedence.length===1]];
export const conversations=[
  {id:'events-tomorrow',turns:[{say:'any interesting events in city tomorrow?',checks:[['finishes',stop('finished')],['searches events',used('nearby_events')],['searches tomorrow',({trace})=>trace.some(t=>t.action==='nearby_events'&&(!t.input.date||t.input.date===tomorrow))],['mentions a tomorrow event',says(/jazz|flea/i)],['does not present today’s event as tomorrow’s',silent(/book release/i)],['does not read news',unused('read_news')]]}]},
  {id:'events-today',turns:[{say:"what's on in town tonight?",checks:[['finishes',stop('finished')],['mentions tonight’s event',says(/book release|anthology|authors/i)],['does not present tomorrow’s market as tonight',silent(/flea/i)]]}]},
  {id:'news',turns:[{say:'any local news today?',checks:[['finishes',stop('finished')],['reads news',used('read_news')],['does not search events',unused('nearby_events')],['mentions the headline',says(/cycl|cykel|bike|bicycle/i)]]}]},
  {id:'news-and-events',turns:[{say:'give me the local news and what events are on tomorrow',checks:[['finishes',stop('finished')],['reads news',used('read_news')],['searches events',used('nearby_events')],['covers both',({reply})=>/cycl|cykel|bike|bicycle/i.test(reply)&&/jazz|flea/i.test(reply)]]}]},
  {id:'greeting',turns:[{say:'hi! what can you help me with?',checks:[['finishes',stop('finished')],['no planning started',({s})=>!s.activities.length],['quick',({r})=>r.elapsedMs<25000]]}]},
  {id:'brainstorm',turns:[{say:'I have a free afternoon tomorrow, any ideas for what to do?',checks:[['finishes or asks',stop('finished','needs_input')],['offers something concrete',says(/museum|walk|jazz|flea|market|caf|fika|park|concert/i)]]}]},
  {id:'one-shot-plan',turns:[{say:fullPlan,checks:[['finishes',stop('finished')],...fullPlanChecks,['ramen before film in the plan',({plan})=>!!plan&&plan.stops.length===2&&plan.stops[0].start<plan.stops[1].start&&/ramen/i.test(plan.stops[0].label)]]}]},
  {id:'missing-origin',turns:[
    {say:'tomorrow I want to visit a museum and have sushi',checks:[...asksOrigin,['both activities saved',acts(2)],['date saved',field('date',tomorrow)],['no invented order',freeOrder]]},
    {say:'from Slussen',checks:[['finishes',stop('finished')],['produces a checked plan',planned],['origin saved',({s})=>/slussen/i.test(s.origin||'')],['origin labelled as the user’s',labelled('origin','user')],['unstated leave time, return time and budget stay unset',({s})=>s.start===null&&s.deadline===null&&s.budgetMode==='unknown'],['activities kept',acts(2)]]}]},
  {id:'four-activities',turns:[
    {say:'tomorrow I want to go to Jazz Festival, do some shopping in a mall, have some Chinese cuisine and take a walk around Gamla Stan. Make a plan',checks:[...asksOrigin,['all four activities saved',acts(4)],['no invented order',freeOrder]]},
    {say:'I will start from KTH around 10, no budget limit, back whenever',checks:[['finishes',stop('finished')],['produces a checked plan',planned],['budget unlimited',field('budgetMode','unlimited')],['origin saved',({s})=>/kth/i.test(s.origin||'')],['open return time stays unset',field('deadline',null)],['activities kept',acts(4)]]}]},
  {id:'friend-at-kth',turns:[
    {say:'any interesting events in city tomorrow?',checks:[['finishes',stop('finished')]]},
    {say:"I'm interested in the flea market, and I also need to visit a friend in KTH campus tomorrow, we will meet in the morning at 10:00, and we want to have a seafood buffet for lunch. I also need to buy some groceries. Make a plan",checks:[...asksOrigin,['all four activities saved',acts(4)],['no invented order',freeOrder],['meeting time is not the departure time',({s})=>s.start!=='10:00'],['meeting kept at 10:00, labelled as the user’s',({s})=>Object.values(s.activityDefinitions).some(a=>a.windowStart==='10:00'&&s.labels?.['window:'+a.id]==='user')],['market linked to its source',({s})=>Object.values(s.activityDefinitions).some(a=>a.eventRef==='event_b2b2b2b2b2b2')]]},
    {say:"I'll start from T-Centralen and want to be home by 21:00",checks:[['finishes',stop('finished')],['produces a checked plan',planned],['deadline saved',field('deadline','21:00')],['friend met at 10:00',({plan})=>!!plan&&plan.stops.some(st=>st.start===600)],['does not blame closed venues',silent(/closed on|is closed/i)]]}]},
  {id:'budget-correction',turns:[
    {say:'Tomorrow from Odenplan: coffee and a bookshop, between 14:00 and 18:00. Plan it.',checks:[['finishes',stop('finished')],['produces a checked plan',planned]]},
    {say:'make the budget 300 SEK',checks:[['finishes',stop('finished')],['budget is a 300 cap',({s})=>s.budgetMode==='limited'&&s.budget===300],['activities kept',acts(2)],['origin kept',({s})=>/odenplan/i.test(s.origin||'')],['hours kept',({s})=>s.start==='14:00'&&s.deadline==='18:00']]}]},
  {id:'no-limits',turns:[{say:'Tomorrow from Slussen I want ramen and a walk in Gamla Stan. No budget limit and I do not need to be back by any particular time. Plan it.',checks:[['finishes',stop('finished')],['produces a checked plan',planned],['budget unlimited',field('budgetMode','unlimited')],['activities saved',acts(2)]]}]},
  {id:'walking-cap',turns:[
    {say:fullPlan,checks:[['finishes',stop('finished')],['produces a checked plan',planned]]},
    {say:'keep total walking under 20 minutes',checks:[['walking cap saved',field('maxWalking',20)],['transport unchanged',field('transport','transit')],['budget kept',field('budget',800)],['turn ends normally',stop('finished','partial_result')]]}]},
  {id:'delegated-choice',turns:[{say:'Tomorrow from T-Centralen, leaving at 12:00: either a museum or the cinema, you choose, and afterwards dinner at a Chinese restaurant. Plan it.',checks:[['finishes',stop('finished')],['produces a checked plan',planned],['one of the alternatives scheduled, not both',({plan})=>!!plan&&plan.stops.length===2],['says it chose',says(/chose|picked|suggest|went with|recommend|selected|opted/i)]]}]},
  {id:'recommend-only',turns:[{say:"Tomorrow afternoon I'm torn between a museum and the cinema. Which would you recommend, and why?",checks:[['finishes',stop('finished')],['gives a recommendation',says(/museum|cinema/i)],['does not compute a plan nobody asked for',unplanned]]}]},
  {id:'select-second-plan',turns:[
    {say:'Tomorrow from T-Centralen I want a museum and coffee, between 12:00 and 18:00, no budget limit. Plan it.',checks:[['finishes',stop('finished')],['produces a checked plan',planned]]},
    {say:'go with the second option',checks:[['finishes',stop('finished')],['second plan selected, when there is one',({r,before})=>(before?.journey?.plans.length||0)<2||r.choice==='1']]}]},
  {id:'event-into-plan',turns:[
    {say:"what's on tomorrow evening?",checks:[['finishes',stop('finished')],['mentions the concert',says(/jazz/i)]]},
    {say:"Put the jazz concert in a plan for tomorrow. I'll leave from T-Centralen at 17:00 and want ramen before it.",checks:[['finishes',stop('finished')],['produces a checked plan',planned],['concert linked to its source',({s})=>Object.values(s.activityDefinitions).some(a=>a.eventRef==='event_a1a1a1a1a1a1')],['concert at its published time',({plan})=>!!plan&&plan.stops.some(st=>st.start===1140)],['ramen before the concert',({plan})=>!!plan&&plan.stops.length===2&&plan.stops[0].start<1140]]}]},
  {id:'event-on-wrong-day',turns:[
    {say:"what's on in town tonight?",checks:[['finishes',stop('finished')]]},
    {say:'Plan tomorrow for me: the book release party and sushi, starting from Slussen at 16:00.',checks:[['turn ends normally',stop('finished','needs_input','partial_result')],['says the party is not on tomorrow',says(/today|tonight|not (on|happening|taking place|scheduled|available|verified|confirmed|listed)|no (session|occurrence|listing)|only (on|take|list|show|has)|isn.t (on|happening|scheduled|verified|listed)|couldn.t (confirm|find|verify)/i)],['does not schedule the party as if confirmed',({plan,s})=>!plan||!plan.stops.some(st=>/book|party/i.test(st.label))||/verif|unconfirmed|not confirmed|check/i.test(JSON.stringify(plan.availabilityPending||''))]]}]},
  {id:'calendar-conflict',calendar:'busy-afternoon',turns:[{say:'Tomorrow from T-Centralen: a museum and then coffee, between 12:00 and 18:00, no budget limit. Plan it.',checks:[['finishes',stop('finished','partial_result')],['plan avoids the busy block, or the conflict is explained',({plan,reply})=>plan?plan.stops.every(st=>st.end<=13*60||st.start>=17*60):/calendar|busy|conflict|already|free/i.test(reply)]]}]},
  {id:'closed-venue',turns:[{say:'Tomorrow from T-Centralen I want to go inside Vasamuseet at 19:00 for an hour.',checks:[['turn ends normally',stop('finished','needs_input','partial_result')],['no plan inside closed hours',unplanned],['explains the opening hours',says(/clos|open|17:00|hours/i)]]}]},
  {id:'impossible-window',turns:[{say:'Tomorrow from KTH: a museum, shopping at a mall, the cinema and dinner, all between 12:00 and 13:00. Plan it.',checks:[['turn ends normally',stop('finished','needs_input','partial_result')],['no impossible plan',unplanned],['explains the time problem',says(/time|hour|window|fit|long|enough/i)],['all four activities kept',acts(4)]]}]},
  {id:'topic-switch',turns:[
    {say:'tomorrow I want to visit a museum and have sushi',checks:[...asksOrigin]},
    {say:'actually never mind that for now, is there any local news?',checks:[['finishes',stop('finished')],['reads news',used('read_news')],['mentions the headline',says(/cycl|cykel|bike|bicycle/i)],['trip is kept',acts(2)]]}]},
  {id:'swedish-names',turns:[{say:'Tomorrow from Östermalmstorg I want fika at Vete-Katten at 15:00, no budget limit. Plan it.',checks:[['finishes',stop('finished')],['produces a checked plan',planned],['origin spelled as given',({s})=>(s.origin||'').includes('Östermalmstorg')],['named café scheduled',({plan,r})=>!!plan&&plan.stops.some(st=>r.journey.places[st.placeId].name==='Vete-Katten')],['at the requested time',({plan})=>!!plan&&plan.stops.some(st=>st.start===900)]]}]},
  {id:'save-to-calendar',turns:[
    {say:fullPlan,checks:[['finishes',stop('finished')],['produces a checked plan',planned]]},
    {say:'great, save it to my calendar',checks:[['finishes',stop('finished')],['points to the manual confirmation',says(/confirm|preview|review|button|below|page/i)],['plan kept',({r,before})=>!r.stale&&(r.journey?.plans.length||before?.journey?.plans.length||0)>0]]}]},
  {id:'meeting-point-after-hours',turns:[{say:"Tomorrow I'm meeting a friend outside the Vasamuseet entrance at 18:30, then we'll have dinner at a restaurant. I start from Slussen. Plan it.",checks:[['finishes',stop('finished')],['produces a checked plan',planned],['meeting at 18:30',({plan})=>!!plan&&plan.stops.some(st=>st.start===1110)],['does not blame closed venues',silent(/museum is closed|closed at/i)]]}]}
];
