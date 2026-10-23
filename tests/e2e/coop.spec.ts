import { test, expect } from '@playwright/test';
import type { WorldState } from '../../packages/simulation/src/types';

test('four independent browsers join, ready, transfer leadership and reconnect to the same run',async({browser})=>{
  test.setTimeout(90000);
  const contexts=await Promise.all(Array.from({length:4},()=>browser.newContext()));
  const pages=await Promise.all(contexts.map(c=>c.newPage()));
  const states=pages.map(()=>new Map<number,WorldState>());
  const errors:string[]=[];
  for(const [i,page] of pages.entries()){
    page.on('pageerror',e=>errors.push(e.message));
    page.on('websocket',ws=>ws.on('framereceived',({payload})=>{const m=JSON.parse(payload.toString());if(m.type==='snapshot')states[i].set(m.state.tick,m.state);}));
  }
  try{
    await Promise.all(pages.map(async(page,i)=>{
      await page.goto('/');
      await page.getByLabel('Имя исследователя').fill(`Browser Coop ${i}`);
      await page.getByRole('button',{name:'Создать профиль'}).click();
      await expect(page.getByRole('button',{name:'Начать экспедицию'})).toBeEnabled();
    }));
    await pages[0].getByRole('button',{name:'Начать экспедицию'}).click();
    const code=await pages[0].locator('.lobby .section-heading button').innerText();
    for(const page of pages.slice(1)){
      await page.getByLabel('Код комнаты',{exact:true}).fill(code.trim());
      await page.getByRole('button',{name:'Присоединиться',exact:true}).click();
    }
    await expect(pages[0].locator('.lobby .member')).toHaveCount(4);
    await pages[0].locator('.member').filter({hasText:'Browser Coop 1'}).getByRole('button',{name:'Передать лидерство'}).click();
    for(const page of pages)await page.getByRole('button',{name:'Я готов',exact:true}).click();
    await pages[1].getByRole('button',{name:'Отправиться',exact:true}).click();
    for(const page of pages){await expect(page.locator('.game-canvas canvas')).toBeVisible();await expect(page.getByRole('alert')).toHaveCount(0);}
    await expect.poll(()=>states.every(s=>s.size>4)).toBe(true);
    const common=[...states[0].keys()].reverse().find(t=>states.every(s=>s.has(t)))!;
    const snapshot=states[0].get(common)!;
    expect(snapshot.actors.filter(a=>a.kind==='player')).toHaveLength(4);
    for(const state of states)expect(state.get(common)).toEqual(snapshot);
    await pages[2].reload();
    await expect(pages[2].locator('.game-canvas canvas')).toBeVisible();
    await expect.poll(()=>[...states[2].values()].at(-1)?.tick??0).toBeGreaterThan(common);
    expect([...states[2].values()].at(-1)?.runId).toBe(snapshot.runId);
    await pages[0].screenshot({path:`docs/qa/coop-${Date.now()}.png`,fullPage:true});
    for(const page of pages)await page.getByRole('button',{name:'Покинуть',exact:true}).click();
    expect(errors).toEqual([]);
  }finally{await Promise.all(contexts.map(c=>c.close()));}
});
