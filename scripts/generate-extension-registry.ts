import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
const root = "packages/mutation-extensions/src";
const folders = (await readdir(root, { withFileTypes: true }))
  .filter((x) => x.isDirectory() && x.name !== "generated")
  .map((x) => x.name)
  .sort();
const ids = new Set<string>();
let source = "// Generated from trusted extension metadata. Do not edit.\n";
let catalog = "// Generated metadata; safe for schema validation and editor fields.\n";
const entries: string[] = [];
for (const [index, folder] of folders.entries()) {
  if (!/^[a-z][a-z0-9-]+$/.test(folder))
    throw new Error("Unsafe extension folder");
  const meta = JSON.parse(
    await readFile(`${root}/${folder}/extension.json`, "utf8"),
  );
  if (
    !/^ext\.[a-z0-9_]+$/.test(meta.id) ||
    !/^\d+\.\d+\.\d+$/.test(meta.version) ||
    ids.has(meta.id) ||
    meta.handlerEntry !== "handler.ts"
  )
    throw new Error("Invalid or duplicate trusted extension metadata");
  ids.add(meta.id);
  source += `import {handler as handler${index}} from '../${folder}/handler';\nimport params${index} from '../${folder}/params.schema.json';\nimport editor${index} from '../${folder}/editor.schema.json';\nimport meta${index} from '../${folder}/extension.json';\n`;
  catalog += `import params${index} from '../${folder}/params.schema.json';\nimport editor${index} from '../${folder}/editor.schema.json';\nimport meta${index} from '../${folder}/extension.json';\n`;
  entries.push(
    `{handler:handler${index},params:params${index},editor:editor${index},meta:meta${index}}`,
  );
}
source += `export const extensions=[${entries.join(",")}];\n`;
catalog += `export const extensionCatalog=[${folders.map((_,i)=>`{params:params${i},editor:editor${i},meta:meta${i}}`).join(',')}];\n`;
await mkdir(`${root}/generated`, { recursive: true });
await writeFile(`${root}/generated/index.ts`, source);
await writeFile(`${root}/generated/catalog.ts`, catalog);
console.log(`Generated ${entries.length} trusted extensions`);
