import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT,PLACES,HOME,planDay,overlap,conflicts,validatePlan,parseLocal,calendarEvents,makeICS,travel} from '../public/planner.mjs';

test('default gives three distinct feasible choices',()=>{
  const result=planDay(DEFAULT);
  assert.equal(result.plans.length,3);
  assert.equal(new Set(result.plans.map(p=>p.signature)).size,3);
  assert.ok(result.plans[0].buffer>=45);
  for(const p of result.plans)assert.ok(validatePlan(p,DEFAULT));
});

test('independent budget, calendar, opening-window and movement invariants across scenarios',()=>{
  let count=0;
  for(const budget of [50,130,180,250])for(const start of [780,870,950])for(const deadline of [1140,1200,1320])for(const transport of ['walk','transit']){
    const c={...DEFAULT,budget,start,deadline,transport};
    const meetings=[{start:840,end:900}];
    for(const p of planDay(c,meetings).plans){
      count++;
      assert.ok(p.cost<=budget);assert.ok(p.homeAt<=deadline);
      assert.deepEqual([...new Set(p.stops.map(s=>s.type))].sort(),[...c.activities].sort());
      let cursor=start,from=HOME,total=0;
      for(let i=0;i<p.stops.length;i++){
        const s=p.stops[i],v=PLACES.find(v=>v.id===s.id),leg=p.legs[i],expected=travel(from,v,transport);
        assert.ok(leg.start>=cursor);assert.equal(leg.end-leg.start,expected.minutes);
        assert.ok(s.start>=leg.end+5);assert.equal(s.end-s.start,v.duration);
        assert.ok(s.start>=v.open&&s.end<=v.close);
        if(v.slot!==undefined)assert.equal(s.start,v.slot);
        assert.ok(meetings.every(m=>!overlap(m,s)&&!overlap(m,leg)));
        cursor=s.end;from=v;total+=v.price+expected.cost;
      }
      const last=p.legs.at(-1);assert.ok(last.start>=cursor);assert.equal(last.end,p.homeAt);
      assert.ok(meetings.every(m=>!overlap(m,last)));assert.equal(total+last.cost,p.cost);
    }
  }
  assert.ok(count>50);
});

test('new meeting repairs itinerary while retaining imported ticket venue and time',()=>{
  const old=planDay(DEFAULT).plans[0];
  const film=old.stops.find(s=>s.type==='movie');
  const locks=[{id:film.id,start:film.start}];
  const meetings=[{start:840,end:900}];
  assert.equal(conflicts(old,meetings).length,1);
  const repair=planDay(DEFAULT,meetings,locks);
  assert.ok(repair.plans.length);
  for(const p of repair.plans){assert.ok(validatePlan(p,DEFAULT,meetings,locks));assert.ok(p.stops.some(s=>s.id===film.id&&s.start===film.start));assert.equal(conflicts(p,meetings).length,0);}
});

test('meeting during locked movie is infeasible, never silently rescheduled',()=>{
  const locks=[{id:'cinema-river',start:970}];
  const r=planDay(DEFAULT,[{start:990,end:1020}],locks);
  assert.equal(r.plans.length,0);
  assert.ok(r.reason);
  assert.equal(r.reasonType,'locked-conflict');
});

test('cannot drop a committed movie by changing requested activities',()=>{
  assert.equal(planDay({...DEFAULT,activities:['hair']},[],[{id:'cinema-river',start:970}]).plans.length,0);
});

test('hard budget failure and invalid time are explicit',()=>{
  assert.equal(planDay({...DEFAULT,budget:20}).plans.length,0);
  assert.throws(()=>planDay({...DEFAULT,start:1200,deadline:1100}));
  assert.throws(()=>planDay({...DEFAULT,budget:NaN}));
  assert.throws(()=>planDay(DEFAULT,[{start:900,end:800}]));
});

test('approval validation detects changed cost, stale schedule and duplicate activities',()=>{
  const p=planDay(DEFAULT).plans[0];
  assert.equal(validatePlan({...p,cost:0},DEFAULT),false);
  assert.equal(validatePlan(p,DEFAULT,[{start:p.stops[0].start,end:p.stops[0].end}]),false);
  assert.equal(validatePlan({...p,stops:[p.stops[0],p.stops[0],p.stops[0]]},DEFAULT),false);
});

test('local parsing handles bounded requests and declines unsupported or negative changes',()=>{
  const r=parseLocal('Haircut, ramen and a film, budget 160, return by 8 pm');
  assert.ok(r.supported);assert.equal(r.constraints.budget,160);assert.equal(r.constraints.deadline,1200);
  assert.equal(parseLocal('Do not watch a film').supported,false);
  assert.equal(parseLocal('Book a flight to Tokyo').supported,false);
  assert.equal(parseLocal('Buy cinema tickets').supported,false);
  assert.equal(parseLocal('Budget 120 yuan',DEFAULT).constraints.activities.length,3);
  assert.equal(parseLocal('Return by 7 pm',DEFAULT).constraints.deadline,1140);
  assert.equal(parseLocal('Leave at 14:00, return by 19:30',DEFAULT).constraints.start,840);
  assert.equal(parseLocal('Leave at 14:00, return by 19:30',DEFAULT).constraints.deadline,1170);
});

test('calendar IDs are stable and ICS fields cannot inject events',()=>{
  const p=planDay(DEFAULT).plans[0],events=calendarEvents(p,'2026-10-04');
  assert.equal(events.length,3);
  assert.deepEqual(events.map(e=>e.id),calendarEvents(p,'2026-10-04').map(e=>e.id));
  const text=makeICS([{...events[0],title:'Hello\nEND:VEVENT\nBEGIN:VEVENT,;'}]);
  assert.equal((text.match(/\r\nBEGIN:VEVENT/g)||[]).length,1);
  assert.match(text,/DTSTART:20261004T051800Z/);
  assert.ok(text.includes('Hello\\nEND:VEVENT\\nBEGIN:VEVENT\\,\\;'));
  const long=makeICS([{...events[0],title:'中文很长的日历标题'.repeat(30)}]);
  for(const line of long.split('\r\n'))assert.ok(Buffer.byteLength(line,'utf8')<=75);
});
