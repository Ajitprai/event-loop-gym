const acorn=require('acorn');const sim=require('../sim.js');
const src=require('fs').readFileSync(require('path').join(__dirname,'../index.html'),'utf8');
const P=eval(src.match(/const PUZZLES=(\[[\s\S]*?\n\]);/)[1]);
const PG=eval(src.match(/const PG_DEFAULT=(`[\s\S]*?`);/)[1]);
const extra=[
{id:'finally',code:`Promise.resolve(1).finally(()=>console.log('fin')).then(v=>console.log('v',v));
Promise.resolve().then(()=>console.log('a')).then(()=>console.log('b')).then(()=>console.log('c')).then(()=>console.log('d'));`},
{id:'all',code:`Promise.all([1, Promise.resolve(2), new Promise(r=>setTimeout(()=>r(3),10))]).then(v=>console.log(v));
setTimeout(()=>console.log('t0'),0);`},
{id:'interval',code:`let n=0; const id=setInterval(()=>{ n++; console.log('tick',n); if(n===3) clearInterval(id); },10);
setTimeout(()=>console.log('25ms'),25);`},
{id:'trycatch',code:`async function f(){ try { await Promise.reject(new Error('boom')); } catch(e){ console.log('caught', e.message); } finally { console.log('finally'); } return 'ok'; }
f().then(v=>console.log(v)); console.log('sync');`},
{id:'letloop',code:`for (let i = 0; i < 3; i++) { setTimeout(() => console.log(i), 0); }`},
{id:'asyncret',code:`async function a(){ return Promise.resolve('x'); }
a().then(v=>console.log(v));
Promise.resolve().then(()=>console.log(1)).then(()=>console.log(2)).then(()=>console.log(3)).then(()=>console.log(4));`},
{id:'objs',code:`const arr=[1,2,3]; const d=arr.map(x=>x*2); console.log(d, {a:1}, \`t \${d.length}\`);
const o={ greet(){ return 'hi ' + this.n; }, n:'A' }; console.log(o.greet());`},

];
(async()=>{
 let bad=0;
 for(const p of [...P,{id:'pg',code:PG},...extra]){
  const real=[];const c={log:(...a)=>real.push(a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' '))};
  try{new Function('console',p.code)(c);}catch(e){real.push('Uncaught '+e)}
  await new Promise(r=>setTimeout(r,150));
  const s=sim(p.code,acorn);
  const norm=a=>a.map(t=>String(t).replace(/["\s]/g,''));
  const ok=!s.error&&JSON.stringify(norm(s.out))===JSON.stringify(norm(real));
  if(!ok)bad++;
  console.log((ok?'OK  ':'DIFF')+' '+p.id.padEnd(14)+' steps='+String(s.steps.length).padEnd(4)+(s.error?' ERR '+s.error:'')+(ok?'':'\n   real: '+real.join(' | ')+'\n   sim : '+s.out.join(' | ')));
 }
 console.log(bad?bad+' mismatch(es)':'All cases match real execution');
 process.exitCode=bad?1:0;
})();
