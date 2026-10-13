import test from 'node:test';
import assert from 'node:assert/strict';
import {dotAt,cellNoise} from '../public/atmosphere.mjs';

const calm={t:0,sunX:400,sunY:30,pointer:null,night:false,busySince:null};
const dot=(x,y,noise=0.5)=>({x,y,noise});

test('a dot stays on its grid point unless the pointer bends it, and never grows or brightens without limit',()=>{
  for(let t=0;t<20;t+=0.37)for(const d of [dot(11,11),dot(700,500),dot(1900,1000,0.99)]){
    const at=dotAt(d,{...calm,t});
    assert.equal(at.x,d.x);assert.equal(at.y,d.y);
    assert.ok(at.size>=1&&at.size<=2.2,`size ${at.size}`);assert.ok(at.light>=0.5&&at.light<=5);assert.ok(at.tint>=0&&at.tint<=1);
  }
});

test('the pointer is a lens: nearby dots are pushed away from it and grow, distant ones are untouched',()=>{
  const pointer={x:500,y:400},near=dotAt(dot(520,400),{...calm,pointer}),far=dotAt(dot(900,400),{...calm,pointer}),still=dotAt(dot(900,400),calm);
  assert.ok(near.x>520,'pushed away to the right');assert.equal(near.y,400);assert.ok(near.size>2);assert.ok(near.tint>0.6);
  assert.deepEqual(far,still);
  const onIt=dotAt(dot(500,400),{...calm,pointer});assert.ok(Number.isFinite(onIt.x)&&Number.isFinite(onIt.y));   // exactly under the pointer
});

test('at night the same few dots are stars every time, and they twinkle',()=>{
  assert.equal(cellNoise(3,7),cellNoise(3,7));assert.ok(cellNoise(3,7)>=0&&cellNoise(3,7)<1);
  let stars=0;for(let i=0;i<100;i++)for(let j=0;j<100;j++)if(cellNoise(i,j)>0.955)stars++;
  assert.ok(stars>250&&stars<650,`${stars} stars in ten thousand dots`);
  const star=dot(900,700,0.98),night={...calm,night:true,sunY:-120};
  assert.ok(dotAt(star,night).light>dotAt(star,{...night,night:false}).light+1);
  const lights=new Set(Array.from({length:12},(_,k)=>dotAt(star,{...night,t:k*0.7}).light.toFixed(2)));assert.ok(lights.size>6,'its brightness changes over time');
  assert.equal(dotAt(dot(900,700,0.4),night).size,dotAt(dot(900,700,0.4),{...night,night:false}).size);                     // an ordinary dot is not a star
});

test('while the assistant works, rings run outward from the sun',()=>{
  const d=dot(400,330),idle=dotAt(d,calm);                                     // 300 px straight below the sun
  const hit=dotAt(d,{...calm,busySince:0,t:300/520}),missed=dotAt(d,{...calm,busySince:0,t:0.1,sunX:400});
  assert.ok(hit.size>idle.size+1,'the ring is passing');assert.ok(hit.tint>0.9);
  assert.ok(missed.size<hit.size);
});
