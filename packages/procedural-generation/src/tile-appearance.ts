import type { Definition } from '../../content-schemas/src/definitions';
import { Rng } from '../../game-core/src/math';

/** Four-neighbour mask: north=1, east=2, south=4, west=8. Cosmetic RNG is cell-local. */
export function tileAppearance(palette:Definition<'tilePalettes'>,cells:readonly(string|null)[],width:number,height:number,seed:number): (string|null)[]{
  const definitions=new Map(palette.tiles.map(tile=>[tile.id,tile]));
  return cells.map((id,index)=>{
    if(!id)return null;
    const tile=definitions.get(id);
    if(!tile)throw new Error(`Unknown palette tile ${id}`);
    const x=index%width,y=Math.floor(index/width);
    const mask=(y>0&&cells[index-width]===id?1:0)|(x<width-1&&cells[index+1]===id?2:0)|(y<height-1&&cells[index+width]===id?4:0)|(x>0&&cells[index-1]===id?8:0);
    if(tile.autotile?.[String(mask)])return tile.autotile[String(mask)];
    if(tile.variants.length){const random=new Rng((seed^Math.imul(index+1,0x9e3779b9))>>>0);return random.weighted(tile.variants,v=>v.weight).spriteId;}
    return tile.spriteId;
  });
}
