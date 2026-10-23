import { performance } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import { platform, arch, cpus } from 'node:os';
import { loadContent } from './load-content';
import { ContentRegistry } from '../packages/content-loader/src/registry';
import { generateLevel, reachable } from '../packages/procedural-generation/src/index';
import { Simulation } from '../packages/simulation/src/simulation';
const content=await loadContent();
const registry=new ContentRegistry(content,'benchmark');
const timings:number[]=[], failures:string[]=[];
for(const level of registry.all('levels'))for(let seed=1;seed<=100;seed++){
  const start=performance.now();
  try{const map=generateLevel(registry,level.id,seed);if(!reachable(map,map.spawn,map.exit))failures.push(`${level.id}:${seed}: unreachable`);}catch(error){failures.push(`${level.id}:${seed}: ${(error as Error).message}`);}
  timings.push(performance.now()-start);
}
const scenarios=[];
for(const level of content.levels.items){
  const data=structuredClone(content);
  const campaign=data.campaigns.items[0];
  campaign.startNodeId='bench';
  campaign.nodes=[{nodeId:'bench',kind:'level',levelId:level.id,unlockRuleIds:[],difficultyScale:1},{nodeId:'end',kind:'end',unlockRuleIds:[],difficultyScale:1}];
  campaign.edges=[{edgeId:'finish',fromNodeId:'bench',toNodeId:'end',selection:'always',weight:1}];
  const sim=new Simulation(new ContentRegistry(data,'benchmark'),{runId:'bench',seed:52,campaignId:campaign.id,players:Array.from({length:4},(_,i)=>({id:`p${i}`,characterId:data.characters.items[0].id}))});
  // Keep all four stationary targets alive to exercise enemy AI for the entire sample.
  sim.state.actors.filter(a=>a.kind==='player').forEach(a=>{a.hp=a.maxHp=1e9;});
  const samples:number[]=[];
  for(let tick=0;tick<1500;tick++){const start=performance.now();sim.step();if(tick>=300)samples.push(performance.now()-start);}
  scenarios.push({level:level.id,actors:sim.state.actors.length,ticks:sim.state.tick,...stats(samples)});
}
function stats(values:number[]){const sorted=[...values].sort((a,b)=>a-b);return {samples:values.length,p50Ms:sorted[Math.floor(sorted.length*.5)],p95Ms:sorted[Math.floor(sorted.length*.95)],p99Ms:sorted[Math.floor(sorted.length*.99)],maxMs:sorted.at(-1)};}
const report={date:new Date().toISOString(),node:process.version,platform:platform(),arch:arch(),cpu:cpus()[0]?.model,generation:{...stats(timings),failures},simulation:scenarios,note:'Local synthetic measurement; 4 stationary high-health players, 300 warmup + 1200 measured ticks per level. No browser rendering, network or database included.'};
await mkdir('docs/qa',{recursive:true});await writeFile('docs/qa/benchmark.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(failures.length)process.exitCode=1;
