import fs from 'node:fs';
function edit(file,replacements){let s=fs.readFileSync(file,'utf8');for(const[a,b]of replacements)s=s.split(a).join(b);fs.writeFileSync(file,s);}
const byFile={
'agent-http':[['/route drafts/','/route draft/']],
'agent-progress':[['查询已过期','Query expired']],
'agent-runtime':[["event_999999999999'}]}}),/Source/","event_999999999999'}]}}),/Event evidence is expired/"],['plan_itinerary({}),/Source/','plan_itinerary({}),/Travel time source/'],['Fixture 的具体场次未核实，请先查看活动来源。','Fixture has specific occurrences unverified; check the event source first.']],
'calendar':[['/Locked/','/locked/i']],
'chat-http':[['/博物馆/','/museum/']],
'place-website':[['/跳转次数/','/Too many redirects/']],
'planning-repair':[['/不能.*降低费用估计/','/cannot.*lowering cost estimates/']],
'server':[['理发、吃拉面、看电影，预算 180 yuan, Return by 7 pm','Haircut, ramen and a film, budget 180, return by 7 pm'],['/录音/','/recording/i']],
'turn-commit':[['图书馆新增了阅读座位。','The library has added reading seats.'],['可以练习调色并画城市明信片，适合想尝试绘画的人；具体场次待核实。','Practise mixing colours and paint a city postcard; a chance to try painting. Specific sessions are pending verification.'],['/图书馆/','/library/'],['/明信片/','/postcard/'],['/Pending verification/','/pending verification/'],['/遗漏/','/Missing information categories/']],
'verification':[['/Source/','/source/'],['/未代为预约或购票/','/does not make reservations or purchase tickets/']]
};
for(const[file,fixes]of Object.entries(byFile))edit('tests/'+file+'.test.mjs',fixes);
edit('public/voice-core.mjs',[
 ['(?:the |my |current )?(?:plan|itinerary)','(?:(?:the |my )?current |the |my )?(?:plan|itinerary)'],
 ['please check Daylight Is it still running.','please check that Daylight is still running.']
]);
edit('lib/agent.mjs',[
 ['use patch.activitiesSave all user‑stated activities','use patch.activities to save all user-stated activities'],
 ['issues usefinish。','issues use finish.'],['withcomplete.','with complete.'],['use clarify。','use clarify.'],['preference。','preference.']
]);
edit('lib/verification.mjs',[['locally.Daylight Daylight','locally. Daylight']]);
