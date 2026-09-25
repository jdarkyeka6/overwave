(() => {
'use strict';

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const $ = id => document.getElementById(id);
const ui = {
  wave:$('waveValue'), cash:$('cashValue'), lives:$('livesValue'), best:$('bestValue'),
  pause:$('pauseButton'), speed:$('speedButton'), shop:$('towerShop'),
  selected:$('selectedPanel'), badge:$('selectedBadge'), progress:$('waveProgress'),
  enemyCount:$('enemyCount'), dps:$('dpsValue'), countdown:$('countdownValue'),
  announcement:$('announcement'), tip:$('tip')
};

const TAU = Math.PI * 2;
const clamp = (v,a,b) => Math.max(a, Math.min(b,v));
const lerp = (a,b,t) => a + (b-a)*t;
const dist = (a,b) => Math.hypot(a.x-b.x, a.y-b.y);
const money = n => '$' + Math.floor(n).toLocaleString();

const towerTypes = {
  pulse:{name:'Pulse Cannon',icon:'●',color:'#4ed8ff',cost:180,blurb:'Fast all-round fire',damage:16,range:132,rate:.34,speed:620,upgrade:'More damage, fire rate and range.'},
  rail:{name:'Rail Blaster',icon:'◆',color:'#ff6ec7',cost:420,blurb:'Heavy long-range hits',damage:72,range:205,rate:1.22,speed:1050,pierce:3,upgrade:'Massive damage and extra pierce.'},
  frost:{name:'Frost Node',icon:'✦',color:'#80aaff',cost:300,blurb:'Slows entire rushes',damage:10,range:146,rate:.62,speed:520,slow:.58,slowTime:1.45,upgrade:'Stronger slow, damage and radius.'},
  arc:{name:'Arc Coil',icon:'ϟ',color:'#a8ff69',cost:550,blurb:'Chains through crowds',damage:31,range:142,rate:.72,speed:9999,chain:3,upgrade:'Chains farther and hits harder.'}
};

const enemyTypes = {
  basic:{color:'#ff5d78',hp:1,speed:1,reward:1,size:1},
  runner:{color:'#ffbc55',hp:.72,speed:1.72,reward:1.15,size:.82},
  brute:{color:'#bd72ff',hp:3.8,speed:.67,reward:2.5,size:1.3},
  armor:{color:'#80a1b8',hp:7.2,speed:.54,reward:4.5,size:1.45,armor:.22},
  boss:{color:'#ff395f',hp:48,speed:.42,reward:34,size:2.25,boss:true}
};

const pathNorm=[[-.04,.68],[.14,.68],[.14,.24],[.34,.24],[.34,.78],[.55,.78],[.55,.40],[.76,.40],[.76,.68],[1.04,.68]];

const s = {
  width:0,height:0,dpr:1,path:[],segments:[],pathLength:1,
  wave:1,cash:1900,lives:100,best:Number(localStorage.getItem('overwave-best')||0),
  speed:2,paused:false,gameOver:false,
  enemies:[],towers:[],projectiles:[],particles:[],beams:[],
  placing:null,selectedTower:null,mouse:{x:0,y:0,inside:false},
  spawnQueue:[],spawnTimer:0,waveTotal:0,waveSpawned:0,waveKilled:0,intermission:0,
  dpsDamage:0,dpsClock:0,displayedDps:0,elapsed:0,nextId:1
};

function resize(){
  const r=canvas.getBoundingClientRect();
  s.dpr=Math.min(2,window.devicePixelRatio||1);
  canvas.width=Math.floor(r.width*s.dpr);
  canvas.height=Math.floor(r.height*s.dpr);
  s.width=r.width; s.height=r.height;
  ctx.setTransform(s.dpr,0,0,s.dpr,0,0);
  buildPath();
}

function buildPath(){
  s.path=pathNorm.map(([x,y])=>({x:x*s.width,y:y*s.height}));
  s.segments=[]; s.pathLength=0;
  for(let i=0;i<s.path.length-1;i++){
    const a=s.path[i], b=s.path[i+1], length=dist(a,b);
    s.segments.push({a,b,length,start:s.pathLength});
    s.pathLength+=length;
  }
}

function pointOnPath(p){
  const target=clamp(p,0,1)*s.pathLength;
  for(const seg of s.segments){
    if(target<=seg.start+seg.length){
      const t=(target-seg.start)/seg.length;
      return {x:lerp(seg.a.x,seg.b.x,t),y:lerp(seg.a.y,seg.b.y,t)};
    }
  }
  return s.path.at(-1)||{x:0,y:0};
}

function distanceToSegment(px,py,a,b){
  const vx=b.x-a.x, vy=b.y-a.y;
  const wx=px-a.x, wy=py-a.y;
  const c1=vx*wx+vy*wy;
  if(c1<=0) return Math.hypot(px-a.x,py-a.y);
  const c2=vx*vx+vy*vy;
  if(c2<=c1) return Math.hypot(px-b.x,py-b.y);
  const t=c1/c2;
  return Math.hypot(px-(a.x+t*vx),py-(a.y+t*vy));
}

function pathDistance(x,y){
  let best=Infinity;
  for(const seg of s.segments) best=Math.min(best,distanceToSegment(x,y,seg.a,seg.b));
  return best;
}

function waveScale(w){ return Math.pow(1.115, Math.max(0,w-1)); }
function baseHp(w){ return 30 * waveScale(w) * (1 + Math.floor((w-1)/10)*.28); }

function buildWave(w){
  const count = Math.min(170, 22 + Math.floor(w*3.3));
  const q=[];
  for(let i=0;i<count;i++){
    let type='basic';
    const r=Math.random();
    if(w>=4 && r<.20) type='runner';
    if(w>=7 && r<.12) type='brute';
    if(w>=12 && r<.08) type='armor';
    if(w>=20 && r<.15) type='runner';
    q.push(type);
  }
  if(w%10===0) q.splice(Math.floor(q.length*.62),0,'boss');
  return q;
}

function startWave(){
  s.spawnQueue=buildWave(s.wave);
  s.waveTotal=s.spawnQueue.length;
  s.waveSpawned=0;
  s.waveKilled=0;
  s.spawnTimer=.1;
  s.intermission=0;
  announce(s.wave%10===0 ? 'BOSS SURGE' : 'WAVE '+s.wave, s.wave%10===0 ? 'HEAVY TARGET INBOUND' : 'NO WARM-UP. GO.');
}

function spawnEnemy(type){
  const cfg=enemyTypes[type];
  const scale=baseHp(s.wave);
  const hp=scale*cfg.hp;
  s.enemies.push({
    id:s.nextId++, type, cfg, progress:0, hp, maxHp:hp,
    speed:(46+Math.min(60,s.wave*1.5))*cfg.speed,
    reward:(10+s.wave*.75)*cfg.reward, slowUntil:0, slowFactor:1, dead:false
  });
}

function deployStarter(type,x,y){
  const cfg=towerTypes[type];
  s.towers.push(makeTower(type,x,y,1,cfg.cost));
}

function makeTower(type,x,y,level=1,spent=0){
  return {id:s.nextId++,type,x,y,level,cooldown:Math.random()*.25,spent,angle:0,kills:0,totalDamage:0};
}

function towerStats(t){
  const c=towerTypes[t.type], l=t.level-1;
  return {
    damage:c.damage*Math.pow(1.58,l),
    range:c.range*(1+l*.065),
    rate:Math.max(.075,c.rate*Math.pow(.88,l)),
    speed:c.speed,
    pierce:(c.pierce||1)+Math.floor(l/2),
    slow:Math.max(.26,(c.slow||1)-l*.055),
    slowTime:(c.slowTime||0)+l*.15,
    chain:(c.chain||0)+Math.floor(l/2)
  };
}

function upgradeCost(t){
  const base=towerTypes[t.type].cost;
  return Math.floor(base*(1.1 + t.level*.82)*Math.pow(1.38,t.level-1));
}

function canPlace(x,y){
  if(x<25||y<25||x>s.width-25||y>s.height-25) return false;
  if(pathDistance(x,y)<50) return false;
  return !s.towers.some(t=>Math.hypot(t.x-x,t.y-y)<48);
}

function buyTower(type){
  s.placing=type;
  s.selectedTower=null;
  renderSelected();
  renderShop();
  ui.tip.textContent='Place '+towerTypes[type].name+' on open ground.';
}

function placeTower(type,x,y){
  const c=towerTypes[type];
  if(!canPlace(x,y)||s.cash<c.cost) return false;
  s.cash-=c.cost;
  const t=makeTower(type,x,y,1,c.cost);
  s.towers.push(t);
  s.selectedTower=t;
  s.placing=null;
  burst(x,y,c.color,16);
  renderSelected();renderShop();syncUi();
  ui.tip.textContent='Tower deployed. Click it to upgrade.';
  return true;
}

function targetFor(t,range){
  let best=null,bestP=-1;
  for(const e of s.enemies){
    if(e.dead) continue;
    const p=pointOnPath(e.progress);
    if(Math.hypot(p.x-t.x,p.y-t.y)<=range && e.progress>bestP){best=e;bestP=e.progress;}
  }
  return best;
}

function damageEnemy(e,amount,tower){
  if(!e||e.dead) return 0;
  const actual=amount*(1-(e.cfg.armor||0));
  e.hp-=actual;
  tower.totalDamage+=actual;
  s.dpsDamage+=actual;
  if(e.hp<=0){
    e.dead=true;
    tower.kills++;
    s.waveKilled++;
    s.cash+=e.reward;
    const p=pointOnPath(e.progress);
    burst(p.x,p.y,e.cfg.color,e.cfg.boss?40:8);
  }
  return actual;
}

function fireTower(t){
  const st=towerStats(t), target=targetFor(t,st.range);
  if(!target) return;
  const tp=pointOnPath(target.progress);
  t.angle=Math.atan2(tp.y-t.y,tp.x-t.x);
  t.cooldown=st.rate;

  if(t.type==='arc'){
    let hit=target;
    let from={x:t.x,y:t.y};
    const used=new Set();
    for(let i=0;i<st.chain+1 && hit;i++){
      used.add(hit.id);
      const pos=pointOnPath(hit.progress);
      s.beams.push({a:{...from},b:{...pos},life:.12,color:towerTypes[t.type].color});
      damageEnemy(hit,st.damage*Math.pow(.82,i),t);
      from=pos;
      let next=null,bd=85;
      for(const e of s.enemies){
        if(e.dead||used.has(e.id)) continue;
        const ep=pointOnPath(e.progress),dd=dist(ep,pos);
        if(dd<bd){bd=dd;next=e;}
      }
      hit=next;
    }
    return;
  }

  s.projectiles.push({
    x:t.x,y:t.y,target,targetId:target.id,speed:st.speed,damage:st.damage,
    color:towerTypes[t.type].color,pierce:st.pierce,slow:st.slow,slowTime:st.slowTime,
    owner:t,life:2.5
  });
}

function updateTowers(dt){
  for(const t of s.towers){
    t.cooldown-=dt;
    if(t.cooldown<=0) fireTower(t);
  }
}

function updateProjectiles(dt){
  for(const p of s.projectiles){
    p.life-=dt;
    if(p.life<=0){p.dead=true;continue;}
    const target=s.enemies.find(e=>e.id===p.targetId&&!e.dead);
    if(!target){p.dead=true;continue;}
    const tp=pointOnPath(target.progress);
    const dx=tp.x-p.x,dy=tp.y-p.y,dd=Math.hypot(dx,dy);
    if(dd<Math.max(10,p.speed*dt)){
      damageEnemy(target,p.damage,p.owner);
      if(p.slow<1){target.slowFactor=p.slow;target.slowUntil=s.elapsed+p.slowTime;}
      p.dead=true;
    } else {
      p.x+=dx/dd*p.speed*dt;
      p.y+=dy/dd*p.speed*dt;
    }
  }
  s.projectiles=s.projectiles.filter(p=>!p.dead);
}

function updateEnemies(dt){
  for(const e of s.enemies){
    if(e.dead) continue;
    if(s.elapsed>e.slowUntil)e.slowFactor=1;
    e.progress += (e.speed*e.slowFactor*dt)/s.pathLength;
    if(e.progress>=1){
      e.dead=true;
      const leak=e.cfg.boss?22:Math.max(1,Math.round(e.cfg.hp*.75));
      s.lives-=leak;
      if(s.lives<=0) endGame();
    }
  }
  s.enemies=s.enemies.filter(e=>!e.dead);
}

function updateSpawning(dt){
  if(s.spawnQueue.length){
    s.spawnTimer-=dt;
    if(s.spawnTimer<=0){
      spawnEnemy(s.spawnQueue.shift());
      s.waveSpawned++;
      const pressure=Math.min(.72,s.wave*.012);
      s.spawnTimer=Math.max(.07,.34-pressure*.28);
    }
  } else if(s.enemies.length===0 && !s.gameOver){
    if(s.intermission<=0){
      const bonus=120+Math.floor(s.wave*18);
      s.cash+=bonus;
      s.best=Math.max(s.best,s.wave);
      localStorage.setItem('overwave-best',String(s.best));
      s.wave++;
      s.intermission=1.45;
      syncUi();
    } else {
      s.intermission-=dt;
      if(s.intermission<=0) startWave();
    }
  }
}

function burst(x,y,color,count){
  for(let i=0;i<count;i++){
    const a=Math.random()*TAU,sp=25+Math.random()*100;
    s.particles.push({x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:.25+Math.random()*.38,max:.63,color,size:1+Math.random()*2});
  }
}

function updateEffects(dt){
  for(const p of s.particles){p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vx*=.96;p.vy*=.96;}
  s.particles=s.particles.filter(p=>p.life>0);
  for(const b of s.beams)b.life-=dt;
  s.beams=s.beams.filter(b=>b.life>0);
}

function endGame(){
  s.gameOver=true;s.paused=true;
  s.best=Math.max(s.best,s.wave);
  localStorage.setItem('overwave-best',String(s.best));
  announce('CORE LOST','WAVE '+s.wave+' · CLICK TO RESTART',false);
}

function restart(){
  s.wave=1;s.cash=1900;s.lives=100;s.enemies=[];s.towers=[];s.projectiles=[];s.particles=[];s.beams=[];
  s.placing=null;s.selectedTower=null;s.gameOver=false;s.paused=false;s.elapsed=0;s.displayedDps=0;s.dpsDamage=0;s.dpsClock=0;
  deployStarter('pulse',s.width*.24,s.height*.51);
  deployStarter('pulse',s.width*.45,s.height*.58);
  deployStarter('frost',s.width*.66,s.height*.55);
  deployStarter('rail',s.width*.86,s.height*.44);
  renderSelected();renderShop();startWave();syncUi();
}

function upgradeSelected(){
  const t=s.selectedTower;if(!t)return;
  const cost=upgradeCost(t);
  if(s.cash<cost)return;
  s.cash-=cost;t.spent+=cost;t.level++;
  burst(t.x,t.y,towerTypes[t.type].color,22);
  renderSelected();renderShop();syncUi();
}

function sellSelected(){
  const t=s.selectedTower;if(!t)return;
  s.cash+=Math.floor(t.spent*.7);
  s.towers=s.towers.filter(x=>x!==t);
  s.selectedTower=null;
  renderSelected();renderShop();syncUi();
}

function renderShop(){
  ui.shop.innerHTML='';
  Object.entries(towerTypes).forEach(([key,c],i)=>{
    const b=document.createElement('button');
    b.className='tower-card'+(s.placing===key?' active':'')+(s.cash<c.cost?' poor':'');
    b.style.setProperty('--tower',c.color);
    b.innerHTML='<div class="tower-icon">'+c.icon+'</div><div class="tower-info"><strong>'+c.name+'</strong><span>'+c.blurb+'</span></div><div class="tower-cost">'+money(c.cost)+'</div>';
    b.onclick=()=>buyTower(key); ui.shop.appendChild(b);
  });
}

function renderSelected(){
  const t=s.selectedTower;
  if(!t){
    ui.badge.textContent='NONE';
    ui.selected.className='selected-panel empty';
    ui.selected.innerHTML='<div class="empty-icon">⌖</div><p>Select a deployed tower to upgrade it.</p>';
    return;
  }
  const c=towerTypes[t.type],st=towerStats(t),cost=upgradeCost(t);
  ui.badge.textContent=c.name.toUpperCase();
  ui.selected.className='selected-panel';
  ui.selected.innerHTML=
    '<div class="selected-title"><strong style="color:'+c.color+'">'+c.name+'</strong><span class="level-pill">LV '+t.level+'</span></div>'+
    '<div class="stat-grid">'+
      '<div class="mini-stat"><span>DMG</span><strong>'+Math.round(st.damage)+'</strong></div>'+
      '<div class="mini-stat"><span>RANGE</span><strong>'+Math.round(st.range)+'</strong></div>'+
      '<div class="mini-stat"><span>KILLS</span><strong>'+t.kills+'</strong></div>'+
    '</div>'+
    '<button id="upgradeSelected" class="upgrade-btn" '+(s.cash<cost?'disabled':'')+'>UPGRADE · '+money(cost)+'</button>'+
    '<button id="sellSelected" class="sell-btn">SELL · '+money(t.spent*.7)+'</button>'+
    '<div class="upgrade-note">'+c.upgrade+'</div>';
  $('upgradeSelected').onclick=upgradeSelected;
  $('sellSelected').onclick=sellSelected;
}

function syncUi(){
  ui.wave.textContent=s.wave;
  ui.cash.textContent=money(s.cash);
  ui.lives.textContent=Math.max(0,s.lives);
  ui.best.textContent=s.best;
  ui.enemyCount.textContent=s.enemies.length+' target'+(s.enemies.length===1?'':'s');
  ui.dps.textContent=Math.round(s.displayedDps).toLocaleString()+' DPS';
  const total=Math.max(1,s.waveTotal);
  ui.progress.style.width=(100*clamp((s.waveKilled + Math.max(0,s.waveSpawned-s.enemies.length))/total,0,1))+'%';
  ui.countdown.textContent=s.spawnQueue.length||s.enemies.length?'LIVE':(s.intermission>0?s.intermission.toFixed(1)+'s':'LIVE');
}

function announce(title,subtitle,autoHide=true){
  ui.announcement.innerHTML='<strong>'+title+'</strong><span>'+subtitle+'</span>';
  ui.announcement.classList.remove('hidden');
  if(autoHide)setTimeout(()=>ui.announcement.classList.add('hidden'),1100);
}

function drawGrid(){
  const g=44;
  ctx.strokeStyle='rgba(255,255,255,.028)';ctx.lineWidth=1;
  ctx.beginPath();
  for(let x=(s.elapsed*3)%g;x<s.width;x+=g){ctx.moveTo(x,0);ctx.lineTo(x,s.height);}
  for(let y=0;y<s.height;y+=g){ctx.moveTo(0,y);ctx.lineTo(s.width,y);}
  ctx.stroke();
}

function drawPath(){
  ctx.lineCap='round';ctx.lineJoin='round';
  ctx.strokeStyle='rgba(0,0,0,.48)';ctx.lineWidth=56;ctx.beginPath();
  s.path.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();
  ctx.strokeStyle='rgba(111,127,167,.16)';ctx.lineWidth=44;ctx.stroke();
  ctx.strokeStyle='rgba(168,181,216,.12)';ctx.lineWidth=2;ctx.setLineDash([7,11]);ctx.stroke();ctx.setLineDash([]);
}

function drawTower(t){
  const c=towerTypes[t.type];
  if(t===s.selectedTower){
    const st=towerStats(t);
    ctx.fillStyle='rgba(124,92,255,.045)';ctx.strokeStyle='rgba(124,92,255,.25)';ctx.lineWidth=1;
    ctx.beginPath();ctx.arc(t.x,t.y,st.range,0,TAU);ctx.fill();ctx.stroke();
  }
  ctx.save();ctx.translate(t.x,t.y);
  ctx.shadowColor=c.color;ctx.shadowBlur=18;
  ctx.fillStyle='#151b28';ctx.strokeStyle=c.color;ctx.lineWidth=2;
  ctx.beginPath();ctx.arc(0,0,17,0,TAU);ctx.fill();ctx.stroke();
  ctx.rotate(t.angle);
  ctx.fillStyle=c.color;ctx.fillRect(4,-4,21,8);
  ctx.restore();
  ctx.fillStyle='#fff';ctx.font='800 8px system-ui';ctx.textAlign='center';ctx.fillText(String(t.level),t.x,t.y+3);
}

function drawEnemy(e){
  const p=pointOnPath(e.progress),r=8.5*e.cfg.size;
  ctx.save();ctx.translate(p.x,p.y);
  ctx.shadowColor=e.cfg.color;ctx.shadowBlur=e.cfg.boss?22:10;
  ctx.fillStyle=e.cfg.color;
  if(e.type==='runner'){
    ctx.rotate(Math.PI/4);ctx.fillRect(-r*.72,-r*.72,r*1.44,r*1.44);
  }else{
    ctx.beginPath();ctx.arc(0,0,r,0,TAU);ctx.fill();
  }
  ctx.restore();
  const w=Math.max(18,r*2.2),ratio=clamp(e.hp/e.maxHp,0,1);
  ctx.fillStyle='rgba(0,0,0,.55)';ctx.fillRect(p.x-w/2,p.y-r-8,w,3);
  ctx.fillStyle=e.cfg.color;ctx.fillRect(p.x-w/2,p.y-r-8,w*ratio,3);
}

function draw(){
  ctx.clearRect(0,0,s.width,s.height);
  const grad=ctx.createLinearGradient(0,0,s.width,s.height);
  grad.addColorStop(0,'#0b101a');grad.addColorStop(1,'#080b12');ctx.fillStyle=grad;ctx.fillRect(0,0,s.width,s.height);
  drawGrid();drawPath();

  if(s.placing && s.mouse.inside){
    const c=towerTypes[s.placing],good=canPlace(s.mouse.x,s.mouse.y)&&s.cash>=c.cost;
    ctx.fillStyle=good?'rgba(72,240,164,.045)':'rgba(255,79,112,.05)';
    ctx.strokeStyle=good?'rgba(72,240,164,.3)':'rgba(255,79,112,.35)';
    ctx.beginPath();ctx.arc(s.mouse.x,s.mouse.y,c.range,0,TAU);ctx.fill();ctx.stroke();
    ctx.fillStyle=good?c.color:'#ff4f70';ctx.beginPath();ctx.arc(s.mouse.x,s.mouse.y,15,0,TAU);ctx.fill();
  }

  for(const t of s.towers)drawTower(t);
  for(const e of s.enemies)drawEnemy(e);

  for(const p of s.projectiles){
    ctx.fillStyle=p.color;ctx.shadowColor=p.color;ctx.shadowBlur=10;
    ctx.beginPath();ctx.arc(p.x,p.y,3,0,TAU);ctx.fill();ctx.shadowBlur=0;
  }

  for(const b of s.beams){
    ctx.strokeStyle=b.color;ctx.globalAlpha=clamp(b.life/.12,0,1);ctx.lineWidth=2.5;
    ctx.beginPath();ctx.moveTo(b.a.x,b.a.y);ctx.lineTo(b.b.x,b.b.y);ctx.stroke();ctx.globalAlpha=1;
  }

  for(const p of s.particles){
    ctx.globalAlpha=clamp(p.life/p.max,0,1);ctx.fillStyle=p.color;
    ctx.beginPath();ctx.arc(p.x,p.y,p.size,0,TAU);ctx.fill();
  }
  ctx.globalAlpha=1;

  if(s.paused&&!s.gameOver){
    ctx.fillStyle='rgba(7,10,17,.58)';ctx.fillRect(0,0,s.width,s.height);
    ctx.fillStyle='white';ctx.textAlign='center';ctx.font='900 30px system-ui';ctx.fillText('PAUSED',s.width/2,s.height/2);
    ctx.font='700 11px system-ui';ctx.fillStyle='#8f98ac';ctx.fillText('PRESS SPACE OR Ⅱ TO RESUME',s.width/2,s.height/2+24);
  }
}

function canvasPoint(ev){
  const r=canvas.getBoundingClientRect();
  const src=ev.touches?ev.touches[0]:ev;
  return{x:src.clientX-r.left,y:src.clientY-r.top};
}

canvas.addEventListener('mousemove',e=>{Object.assign(s.mouse,canvasPoint(e),{inside:true});});
canvas.addEventListener('mouseleave',()=>s.mouse.inside=false);
canvas.addEventListener('click',e=>{
  if(s.gameOver){restart();return;}
  const p=canvasPoint(e);
  if(s.placing){placeTower(s.placing,p.x,p.y);return;}
  let hit=null,bd=28;
  for(const t of s.towers){const dd=Math.hypot(t.x-p.x,t.y-p.y);if(dd<bd){hit=t;bd=dd;}}
  s.selectedTower=hit;renderSelected();
});
canvas.addEventListener('touchstart',e=>{
  e.preventDefault();
  if(s.gameOver){restart();return;}
  const p=canvasPoint(e);Object.assign(s.mouse,p,{inside:true});
  if(s.placing){placeTower(s.placing,p.x,p.y);return;}
  let hit=null,bd=34;
  for(const t of s.towers){const dd=Math.hypot(t.x-p.x,t.y-p.y);if(dd<bd){hit=t;bd=dd;}}
  s.selectedTower=hit;renderSelected();
},{passive:false});

ui.pause.onclick=()=>{if(!s.gameOver){s.paused=!s.paused;ui.pause.textContent=s.paused?'▶':'Ⅱ';}};
ui.speed.onclick=()=>{s.speed=s.speed===1?2:s.speed===2?4:1;ui.speed.textContent=s.speed+'×';};

window.addEventListener('keydown',e=>{
  if(e.code==='Space'){e.preventDefault();ui.pause.click();}
  const keys={Digit1:'pulse',Digit2:'rail',Digit3:'frost',Digit4:'arc',Escape:null};
  if(e.code in keys){
    s.placing=keys[e.code];
    if(s.placing)s.selectedTower=null;
    renderShop();renderSelected();
  }
});

let last=performance.now();
function frame(now){
  const raw=Math.min(.05,(now-last)/1000);last=now;
  if(!s.paused&&!s.gameOver){
    const dt=raw*s.speed;
    s.elapsed+=dt;
    updateSpawning(dt);updateEnemies(dt);updateTowers(dt);updateProjectiles(dt);updateEffects(dt);
    s.dpsClock+=dt;
    if(s.dpsClock>=1){s.displayedDps=s.dpsDamage/s.dpsClock;s.dpsDamage=0;s.dpsClock=0;}
  } else updateEffects(raw);
  syncUi();draw();requestAnimationFrame(frame);
}

window.addEventListener('resize',resize);
resize();
renderShop();
restart();
requestAnimationFrame(frame);
})();