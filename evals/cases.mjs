// The assistant's fixed evaluation set: real conversations with the running
// agent, each starting from a stated world and judged on what the agent did
// (tools run, state written) and on what its reply may and may not say.
//
// A case: {id, area, seed, turns:[{say, fresh?}], check(ctx) -> [problems]}.
//   seed   memory entries, food likes/dislikes and research topics before the case
//   fresh  start a new conversation for this turn (tests that a fact outlived the last one)
//   ctx    {replies, last, state, before, plan} — state is read after the last turn;
//          plan is the planner's saved record if one was written during the case
import {used,searchedWeb,mentionsAny,ungroundedTimes,clockTimes} from './harness.mjs';

const PORK=['fläsk','kotlett','karré','bacon','skinka','revben','pork','salami','prosciutto'];
const MEAT_FISH=['kyckling','nötstek','nötytterfilé','lax','köttbullar','blandfärs','formbar färs','fläsk','skinka','salami','prosciutto','korv'];
// The offers a reply actually shows are its priced lines; a closing line saying
// what was left out names the avoided food on purpose and is not an offer.
const offered=text=>text.split('\n').filter(line=>/\d\s?kr\b/.test(line)).join('\n');
const has=(list,pattern)=>list.some(p=>pattern.test(p.label)||p.terms.some(t=>pattern.test(t)));
const rag={id:'retrieval-augmented-generation',name:'retrieval-augmented generation'};
const agents={id:'evaluating-llm-agents',name:'evaluating LLM agents'};
const claimsDone=/\b(i(?:'ve| have)? (?:added|booked|reserved|scheduled|put)|has been (?:added|booked|reserved|scheduled)|is now (?:in|on) your calendar|added to your calendar|booking (?:is )?confirmed|table is (?:booked|reserved))\b/i;
const problems=(...list)=>list.filter(Boolean);

export const cases=[
  // ---- groceries ----
  {id:'offers-this-week',area:'groceries',turns:[{say:'What’s on offer this week?'}],
    check:({last})=>problems(
      !used(last,/grocery_offers/)&&'did not read the offers with the tracker',
      searchedWeb(last)&&'answered a groceries question with a web search',
      !/lidl/i.test(last.text)&&'did not say the offers are Lidl’s',
      (last.text.match(/\d\s?kr\b|\d:-/g)||[]).length<3&&'fewer than three priced offers',
      last.text.split('\n').filter(l=>/\d\s?kr\b/.test(l)).length>10&&'more than ten offer lines')},
  {id:'one-product',area:'groceries',turns:[{say:'Is chicken on offer?'}],
    check:({last,state})=>problems(
      !used(last,/grocery_offers/)&&'did not read the offers with the tracker',
      searchedWeb(last)&&'searched the web',
      state.offers.some(t=>/kyckling/i.test(t))&&!/kyckling|chicken/i.test(last.text)&&'chicken is on offer but the reply does not show it',
      state.offers.some(t=>/kyckling/i.test(t))&&!/\d\s?kr\b/.test(last.text)&&'no price given')},
  {id:'dislike-said-once',area:'groceries',turns:[{say:'I hate pork. Never show me pork.'},{say:'What’s on offer this week?',fresh:true}],
    check:({replies,state})=>problems(
      !has(state.dislikes,/pork|fläsk/i)&&'the dislike was not stored for the daily offers',
      has(state.dislikes,/pork|fläsk/i)&&!state.dislikes.some(p=>p.terms.some(t=>/fläsk/i.test(t)))&&'stored without Swedish product words, so it cannot match price tags',
      !/pork/i.test(state.memory)&&'the dislike was not saved to memory',
      mentionsAny(offered(replies[1].text),PORK).length&&'a later conversation still showed pork: '+mentionsAny(offered(replies[1].text),PORK).join(', '),
      !/\d\s?kr\b/.test(replies[1].text)&&'the later conversation showed no offers at all')},
  {id:'dislike-known-from-memory',area:'groceries',seed:{memory:['User hates pork.']},turns:[{say:'Any good grocery deals right now?'}],
    check:({last})=>problems(
      !used(last,/grocery_offers/)&&'did not read the offers with the tracker',
      !/\d\s?kr\b/.test(last.text)&&'no priced offers in the reply',
      mentionsAny(offered(last.text),PORK).length&&'showed pork to a user whose memory says they avoid it: '+mentionsAny(offered(last.text),PORK).join(', '),
      /no (stored |known )?dislikes|haven’t told me|have not told me/i.test(last.text)&&'said the user has no dislikes')},
  {id:'like-said-once',area:'groceries',turns:[{say:'I love salmon, by the way.'}],
    check:({last,state})=>problems(
      !has(state.likes,/salmon|lax/i)&&'the like was not stored',
      has(state.likes,/salmon|lax/i)&&!state.likes.some(p=>p.terms.some(t=>/^lax/i.test(t)))&&'stored without the Swedish word “lax”',
      last.text.length>500&&'a one-line confirmation was expected')},
  {id:'change-of-mind',area:'groceries',seed:{memory:['User hates pork.'],dislikes:[{label:'pork',terms:['pork','fläsk','bacon','skinka']}]},turns:[{say:'Actually pork is fine again, you can show it.'}],
    check:({state})=>problems(
      has(state.dislikes,/pork|fläsk/i)&&'pork is still stored as a dislike',
      /hates pork/i.test(state.memory)&&'memory still says the user hates pork')},
  {id:'vegetarian-reaches-groceries',area:'memory',turns:[{say:'Remember that I’m vegetarian.'},{say:'What’s on offer this week?',fresh:true}],
    check:({replies,state})=>problems(
      !/vegetarian/i.test(state.memory)&&'not saved to memory',
      mentionsAny(offered(replies[1].text),MEAT_FISH).length&&'offered meat or fish to a vegetarian: '+mentionsAny(offered(replies[1].text),MEAT_FISH).join(', '),
      !/\d\s?kr\b/.test(replies[1].text)&&'the later conversation showed no offers at all')},
  {id:'another-shop',area:'groceries',turns:[{say:'Any deals at ICA this week?'}],
    check:({last})=>problems(
      !/lidl/i.test(last.text)&&'did not say that its offers data covers Lidl only',
      searchedWeb(last)&&!/uncheck|not (been )?(checked|verified)|can(?:no|’|')t (verify|confirm)/i.test(last.text)&&'gave web results for another shop without saying they are unchecked',
      !searchedWeb(last)&&/\d\s?kr\b/.test(last.text)&&!/lidl/i.test(last.text)&&'gave prices for a shop it has no data for')},

  // ---- research ----
  {id:'track-a-topic',area:'research',turns:[{say:'Track new papers on diffusion models for protein design.'}],
    check:({last,state})=>problems(
      !state.topics.some(t=>/protein/i.test(t.name))&&'the topic was not added',
      state.topics.length>1&&'added more than one topic',
      /\b(every (day|morning)|daily) at \d|at \d{1,2}(:\d\d)? ?(am|pm)\b/i.test(last.text)&&!used(last,/cron/)&&'promised a delivery time it did not look up')},
  {id:'list-topics',area:'research',seed:{topics:[rag,agents]},turns:[{say:'Which research topics am I following?'}],
    check:({last})=>problems(
      !/retrieval/i.test(last.text)&&'did not list “retrieval-augmented generation”',
      !/agents/i.test(last.text)&&'did not list “evaluating LLM agents”',
      /protein|diffusion/i.test(last.text)&&'listed a topic that is not tracked')},
  {id:'feedback-on-a-topic',area:'research',seed:{topics:[rag,agents]},turns:[{say:'For the RAG topic: skip survey papers, I only want new benchmarks.'}],
    check:({state})=>{const t=state.topics.find(t=>t.id===rag.id),other=state.topics.find(t=>t.id===agents.id);return problems(
      !t&&'the topic disappeared',
      t&&!t.notes.some(n=>/survey/i.test(n))&&'the preference was not saved on the topic',
      other?.notes.length&&'the preference was saved on the wrong topic');}},
  {id:'stop-a-topic',area:'research',seed:{topics:[rag,agents]},turns:[{say:'Stop tracking retrieval-augmented generation.'}],
    check:({state})=>problems(
      state.topics.some(t=>t.id===rag.id)&&'the topic is still tracked',
      !state.topics.some(t=>t.id===agents.id)&&'removed the wrong topic')},

  // ---- going out ----
  {id:'plan-a-day',area:'planner',turns:[{say:'Plan tomorrow: a museum and sushi, starting from Slussen.'}],
    check:({last,plan})=>problems(
      !used(last,/plan_day/)&&'did not call the planner',
      !plan&&'no checked plan was produced',
      plan&&!/slussen/i.test(plan.request.from||'')&&'planned from somewhere other than Slussen',
      plan&&(plan.request.leaveAt||plan.request.backBy||plan.request.budgetSEK!=null)&&'passed a leave time, return time or budget the user never gave',
      plan&&ungroundedTimes(last.text,plan).length&&'reply gives times the planner did not produce: '+ungroundedTimes(last.text,plan).join(', '),
      plan&&clockTimes(last.text).length<2&&'reply gives fewer than two times',
      /what(’|')?s your budget|how much .* spend|when .* (leave|be back)|what time .* (leave|back)/i.test(last.text)&&'asked for a budget or times that are optional')},
  {id:'plan-with-stated-limits',area:'planner',turns:[{say:'Plan tomorrow from T-Centralen: first ramen at 12:30, then Moderna Museet. I must be back at T-Centralen by 17:00.'}],
    check:({last,plan})=>{const r=plan?.request,acts=r?.activities||[];return problems(
      !plan&&'no checked plan was produced',
      r&&r.backBy!=='17:00'&&`return time passed as ${r.backBy||'nothing'}, not 17:00`,
      r&&!acts.some(a=>a.earliest==='12:30')&&'the 12:30 lunch time was not passed as a requirement',
      r&&r.keepOrder!==true&&'the stated order (first… then…) was not kept',
      r&&!acts.some(a=>/moderna/i.test(a.place||''))&&'Moderna Museet was not passed as the named venue',
      r&&r.budgetSEK!=null&&'passed a budget the user never gave',
      plan&&ungroundedTimes(last.text,plan).length&&'reply gives times the planner did not produce: '+ungroundedTimes(last.text,plan).join(', '));}},
  {id:'missing-start',area:'planner',turns:[{say:'Plan a day out tomorrow: a museum and then dinner.'}],
    check:({last,plan})=>problems(
      plan&&'planned without knowing where the user starts',
      !/\?/.test(last.text)&&'did not ask where the user starts',
      (last.text.match(/\?/g)||[]).length>1&&'asked more than one question',
      /budget|how much|what time|when (do|would|will) you/i.test(last.text)&&'asked for optional details')},
  {id:'whats-on',area:'planner',turns:[{say:'What’s on in Stockholm tomorrow?'}],
    check:({last})=>problems(
      !used(last,/find_events/)&&'did not look up events',
      searchedWeb(last)&&'searched the web instead of its events source')},
  {id:'calendar-is-the-users',area:'planner',turns:[{say:'Plan tomorrow: a museum, starting from Slussen, and put it in my calendar.'}],
    check:({last})=>problems(
      claimsDone.test(last.text)&&'claimed to have added the plan to the calendar, which it cannot do',
      !/confirm|yourself|you can add|add to calendar|can(?:no|’|')t add|not able to add|unable to add/i.test(last.text)&&'did not say that adding to the calendar is the user’s step')},
  {id:'no-bookings',area:'planner',turns:[{say:'Book me a table for two at Råkultur tomorrow at 19:00.'}],
    check:({last})=>problems(
      claimsDone.test(last.text)&&'claimed to have made a booking',
      !/can(?:no|’|')t|cannot|not able|unable|don(?:’|')t (make|do)|yourself/i.test(last.text)&&'did not say it cannot book')},

  // ---- memory and manner ----
  {id:'recall-in-a-new-conversation',area:'memory',seed:{memory:['User is allergic to shellfish.','User works on evaluation of language models.']},turns:[{say:'What do you know about me?'}],
    check:({last})=>problems(
      !/shellfish/i.test(last.text)&&'did not recall the shellfish allergy',
      !/evaluat/i.test(last.text)&&'did not recall the user’s work',
      /pork|vegetarian|fridhemsplan/i.test(last.text)&&'recalled something that is not in memory')},
  {id:'small-talk',area:'manner',turns:[{say:'Hi! Thanks for yesterday.'}],
    check:({last})=>problems(
      last.text.length>400&&`a greeting got a ${last.text.length}-character reply`,
      last.tools.length>1&&'ran tools for a greeting: '+last.tools.map(t=>t.tool).join(', '))},
];
