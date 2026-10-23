import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const root = 'docs/source';
const files = ['MASTER_EXECUTION_PROMPT.md', ...readdirSync(join(root,'mutation_editor_docs')).filter(x=>x.endsWith('.md')).map(x=>'mutation_editor_docs/'+x)];
const rows=[];
for (const file of files) {
  const lines=readFileSync(join(root,file),'utf8').split(/\r?\n/); let heading='', buffer=[], start=0, code=false;
  const flush=()=>{if(!buffer.length)return; const description=buffer.join(' ').replace(/\|/g,' / ').replace(/`/g,'').replace(/\s+/g,' ').trim(); if(description&&!/^[-: ]+$/.test(description))rows.push({id:`REQ-${String(rows.length+1).padStart(4,'0')}`,source:file,line:start+1,section:heading,description,subsystem:/SECURITY/.test(file)?'server/security':/UI_UX/.test(file)?'editor':/ANIMATION/.test(file)?'animation':/LEVEL/.test(file)?'world/campaign':/WORLD/.test(file)?'world/rewards':/AUDIO/.test(file)?'presentation/assets':/MUTATION/.test(file)?'effects/sdk':/PIXEL/.test(file)?'art':'integration',implementation:'—',test:'—',status:'planned'});buffer=[];};
  lines.forEach((line,i)=>{if(line.startsWith('```')){if(!code){flush();start=i;}buffer.push(line);code=!code;if(!code)flush();return;}if(code){buffer.push(line);return;}if(/^#+ /.test(line)){flush();heading=line.replace(/^#+ /,'');return;}if(!line.trim()||/^---+$/.test(line.trim())){flush();return;}if(/^\s*(?:[-*] |\d+[.)] |\|)/.test(line)){flush();start=i;buffer.push(line);flush();return;}if(!buffer.length)start=i;buffer.push(line);});flush();
}
const evidence=JSON.parse(readFileSync('docs/requirement-evidence.json','utf8'));
for(const [id,proof] of Object.entries(evidence)){const row=rows.find(r=>r.id===id);if(!row)throw new Error('Unknown evidence ID '+id);Object.assign(row,proof);}
writeFileSync('docs/requirements.json',JSON.stringify(rows,null,2)+'\n');
writeFileSync('docs/REQUIREMENTS_MATRIX.md',`# Матрица требований\n\n${rows.length} исходных атомов, включая контракты и примеры. Статус planned означает, что полная приёмка этого исходного пункта пока не подтверждена. Фактические проверенные блоки ведутся в IMPLEMENTATION_STATUS.md; это не подмена полной матрицы.\n\n| ID | Источник | Описание | Подсистема | Реализация | Тест | Статус |\n|---|---|---|---|---|---|---|\n`+rows.map(r=>`| ${r.id} | [${r.source}:${r.line}](source/${r.source}#L${r.line}) | ${r.description} | ${r.subsystem} | ${r.implementation} | ${r.test} | ${r.status} |`).join('\n')+'\n');
console.log(`Indexed ${rows.length} source atoms from ${files.length} documents.`);
