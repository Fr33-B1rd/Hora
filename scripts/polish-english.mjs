import fs from 'node:fs';
function edit(file,pairs){let s=fs.readFileSync(file,'utf8');for(const [a,b] of pairs){if(!s.includes(a))throw Error('Missing copy in '+file+': '+a.slice(0,40));s=s.split(a).join(b);}fs.writeFileSync(file,s);}
edit('lib/agent.mjs',[
 ['Pause specific itinerary planning, save the demand and ask a genuine question that requires the user to decide. First inpatchSave the date, all activities and conditions already mentioned in this round; at least one recorded activity is required. Do not repeat known information. General chatting, seeking inspiration, or activity discovery clarifications usefinish, no itinerary needed. Do not claim that searching, scheduling, or saving has been completed.', 'Pause itinerary planning to ask a question that requires a user decision. First save the known date, every stated activity and other conditions in patch; at least one activity is required. Do not ask for known information. For general conversation, inspiration or event discovery, use finish without requiring an itinerary. Do not claim unfinished searches, scheduling or calendar writes succeeded.'],
 ['End this round’s response, which is not equivalent to completing the whole task. Used when the user is comparing, asking for advice, or discussing trade‑offsdiscussion, retaining the pending planning task; when the user delegates execution, continue tool work and cannot brush off with mere discussion.completeMust have the current schedule result. No external write permission. When requesting news or eventssectionscover each type of information separately,present_eventsdoes not end this round.', 'Deliver this turn’s reply. Use mode=discussion for comparison, advice or trade-offs while retaining the pending task. When the user requests execution, do the tool work first. mode=complete requires a current checked planning result. This tool cannot authorize external writes. For requested news or events, use sections to cover each requested category. present_events prepares cards and does not deliver a reply.'],
 ['In sectionsBriefly describe','In sections, briefly describe'],['skillDoes not exist.','Skill does not exist.'],['then call finish。','then call finish.'],['subsequent processing not completed.','but subsequent processing is incomplete. ']
]);
edit('lib/journey.mjs',[
 ['${c.start}–${c.deadline} can be completed within.','${c.start}–${c.deadline}.'],
 ["`found ${plans.length} sets${pendingSessions?'route drafts':'candidate arrangements'}, having queried traffic and avoided busy periods.","`Found ${plans.length} ${pendingSessions?'route drafts':'candidate plans'} after checking routes and busy periods. "],
 ['Daylight Do not make bookings on behalf of the user.','Daylight does not make bookings on behalf of the user.']
]);
edit('lib/agent-tools.mjs',[
 ['`Already checked per ${c.date} ${c.start}–${c.deadline} check this ${c.activities.length} activities`','`Checked ${c.activities.length} activities for ${c.date}, ${c.start}–${c.deadline}. `'],
 ["}[reason]||'';","}[reason]||'';"],
 ['return prefix+','return (prefix?prefix+\' \':\'\')+']
]);
edit('lib/reply.mjs',[
 ['${c.start}–${c.deadline}Can be adjusted.','${c.start}–${c.deadline}; this can be adjusted.'],
 ['24:00Do not treat midnight','24:00. Do not treat midnight'],
 ['Price reservation and event duration','Cost reserves and activity durations']
]);
edit('lib/local-news.mjs',[
 ["`Stockholm region news: reading SVT recent 72 hours of coverage,${cards.length?`Show latest ${cards.length} items.`:'Currently no matching coverage found.'}This is regional news; cannot be used to judge events happening to you; here we read RSS Read only title and summary, not full story; see original.`", "`Stockholm regional news from SVT over the past 72 hours. ${cards.length?`Showing the latest ${cards.length} items.`:'No matching coverage found.'} These are regional reports, not verified events at your location. Only RSS titles and summaries have been read; open the sources for full reports.`"]
]);
edit('lib/conversation.mjs',[['Resolve today/today or tomorrow','Resolve today or tomorrow']]);
edit('public/app.mjs',[
 ['10 month 4 day, Sunday','Sunday, 4 October'],['Good morning,Zhuoer','Good morning, Zhuoer'],['Zhuoer ’s space',"Zhuoer’s space"],['Discuss ideas, arrange travel, see nearby fresh news.','Discuss ideas, plan outings, and discover local news and events.']
]);
