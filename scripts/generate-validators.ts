import Ajv2020 from "ajv/dist/2020.js";
import standaloneCode from "ajv/dist/standalone/index.js";
import { mkdir, writeFile } from "node:fs/promises";
import { collectionSchemas } from "../packages/content-schemas/src/definitions";
import { extensionCatalog } from "../packages/mutation-extensions/src/generated/catalog";

// Compile trusted schemas during the build. Browsers never need eval/new Function.
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false, code: { source: true } });
const exports: Record<string, string> = {};
for (const [name, schema] of Object.entries(collectionSchemas)) {
  const id = `collection:${name}`;
  ajv.addSchema(schema, id);
  exports[name] = id;
}
for (const extension of extensionCatalog) {
  const id = `extension:${extension.meta.id}`;
  ajv.addSchema(extension.params, id);
  exports[extension.meta.id] = id;
}
const directory = "packages/content-schemas/src/generated";
await mkdir(directory, { recursive: true });
await writeFile(`${directory}/validators.cjs`, standaloneCode(ajv, exports));
await writeFile(`${directory}/validators.d.cts`, 'declare const validators: Record<string, import("ajv").ValidateFunction>;\nexport = validators;\n');
console.log(`Precompiled ${Object.keys(exports).length} CSP-compatible validators`);
