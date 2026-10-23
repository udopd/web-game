import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createApp } from "../../apps/server/src/app";
import { db } from "../../apps/server/src/db";
import { content } from "../fixtures";
import type { WorldState } from "../../packages/simulation/src/types";

let server: Awaited<ReturnType<typeof createApp>>, port: number;
const origin = process.env.APP_ORIGIN!;
const players: {uid:string; cookie:string; csrf:string}[] = [];
const rooms: string[] = [], runs: string[] = [], sockets: WebSocket[] = [];
const request = (index:number, url:string, payload?:Record<string,unknown>) => server.app.inject({method:"POST",url,headers:{origin,cookie:players[index].cookie,"x-csrf-token":players[index].csrf},...(payload===undefined?{}:{payload})});
beforeAll(async()=>{
  server=await createApp({logger:false,serveStatic:false,restoreRooms:false});
  await server.app.listen({host:'127.0.0.1',port:0});
  port=(server.app.server.address() as {port:number}).port;
  for(let i=0;i<5;i++){
    const r=await server.app.inject({method:'POST',url:'/api/register',headers:{origin},payload:{name:`Coop Test ${i}`}});
    expect(r.statusCode).toBe(200);
    players.push({...r.json(),cookie:r.cookies.map(c=>`${c.name}=${c.value}`).join('; ')});
  }
});
afterAll(async()=>{
  sockets.forEach(s=>s.close());
  await server.app.close();
  await db.room.deleteMany({where:{id:{in:rooms}}});
  await db.progressEvent.deleteMany({where:{runId:{in:runs}}});
  await db.participant.deleteMany({where:{runId:{in:runs}}});
  await db.run.deleteMany({where:{id:{in:runs}}});
  await db.unlock.deleteMany({where:{uid:{in:players.map(p=>p.uid)}}});
  await db.user.deleteMany({where:{uid:{in:players.map(p=>p.uid)}}});
  await db.$disconnect();
});
async function connect(index:number,room:string){
  const ws=new WebSocket(`ws://127.0.0.1:${port}/ws/rooms/${room}`,{headers:{origin,cookie:players[index].cookie}});
  sockets.push(ws);
  const snapshots=new Map<number,WorldState>();
  ws.on('message',data=>{const msg=JSON.parse(data.toString());if(msg.type==='snapshot')snapshots.set(msg.state.tick,msg.state);});
  await new Promise<void>((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
  return {ws,snapshots};
}
it('four clients share authoritative snapshots, transfer ownership, reconnect and stop rewarding departed players',async()=>{
  const created=await request(0,'/api/rooms',{campaignId:content.campaigns.items[0].id});
  expect(created.statusCode).toBe(200);
  const room=created.json();rooms.push(room.id);
  for(let i=1;i<4;i++)expect((await request(i,`/api/rooms/${room.id}/join`)).statusCode).toBe(200);
  expect((await request(4,`/api/rooms/${room.id}/join`)).statusCode).toBe(409);
  expect((await request(1,`/api/rooms/${room.id}/start`)).statusCode).toBe(403);
  for(let i=0;i<4;i++)expect((await request(i,`/api/rooms/${room.id}/ready`,{ready:true,characterId:content.characters.items[0].id})).statusCode).toBe(200);
  expect((await request(0,`/api/rooms/${room.id}/transfer`,{uid:players[1].uid})).statusCode).toBe(200);
  const started=await request(1,`/api/rooms/${room.id}/start`);
  expect(started.statusCode).toBe(200);runs.push(started.json().runId);
  const peers=await Promise.all([0,1,2,3].map(i=>connect(i,room.id)));
  for(const [i,peer] of peers.entries())peer.ws.send(JSON.stringify({type:'input',input:{seq:10+i,moveX:0,moveY:0,aim:i,fire:false,interact:false,weaponSlot:0}}));
  await expect.poll(()=>peers.every(p=>p.snapshots.size>=4)).toBe(true);
  const tick=[...peers[0].snapshots.keys()].reverse().find(t=>t>2&&peers.every(p=>p.snapshots.has(t)))!;
  const state=peers[0].snapshots.get(tick)!;
  expect(state.actors.filter(a=>a.kind==='player')).toHaveLength(4);
  expect(state.contentVersion).toBe(room.contentVersion);
  for(const peer of peers)expect(peer.snapshots.get(tick)).toEqual(state);
  for(let i=0;i<4;i++)expect(state.actors.find(a=>a.id===players[i].uid)!.input.seq).toBe(10+i);
  peers[1].ws.close();
  await expect.poll(()=>server.rooms.get(room.id).view.ownerId).toBe(players[0].uid);
  const reconnected=await connect(1,room.id);
  await expect.poll(()=>reconnected.snapshots.size).toBeGreaterThan(0);
  expect([...reconnected.snapshots.values()][0].runId).toBe(state.runId);
  expect((await request(3,`/api/rooms/${room.id}/leave`)).statusCode).toBe(200);
  const live=server.rooms.get(room.id), actor=live.simulation!.state.actors.find(a=>a.id===players[3].uid)!;
  expect(actor.departed).toBe(true);
  const before=await db.user.findUniqueOrThrow({where:{uid:players[3].uid}});
  actor.kills+=100;
  live.simulation!.state.tick++;
  await server.rooms.checkpoint(live);
  expect((await db.user.findUniqueOrThrow({where:{uid:players[3].uid}})).kills).toBe(before.kills);
  expect((await db.participant.findUniqueOrThrow({where:{runId_uid:{runId:state.runId,uid:players[3].uid}}})).canResume).toBe(false);
  live.simulation!.state.status='defeat';
  await expect.poll(()=>server.rooms.get(room.id).view.status).toBe('defeat');
  const profile=await server.app.inject({url:'/api/users/me',headers:{cookie:players[0].cookie}});
  expect(profile.json().rooms[0].runId).toBe(state.runId);
  expect(profile.json().rooms[0].status).toBe('defeat');
});
it('serializes simultaneous room creation for the same identity',async()=>{
  const results=await Promise.all([0,1].map(()=>request(4,'/api/rooms',{campaignId:content.campaigns.items[0].id})));
  for(const r of results)if(r.statusCode===200)rooms.push(r.json().id);
  expect(results.map(r=>r.statusCode).sort()).toEqual([200,409]);
});
