import {randomBytes} from 'node:crypto';import {writeFile,readFile} from 'node:fs/promises';
const secret=()=>randomBytes(32).toString('base64url');const db=secret();
const template=await readFile('.env.example','utf8');
try{await writeFile('.env',template.replace('REPLACE_WITH_32_RANDOM_BYTES',secret()).replaceAll('REPLACE_DB_PASSWORD',db).replace('REPLACE_STORAGE_PASSWORD',secret()),{flag:'wx',mode:0o600});console.log('Created private .env. Administrator token is stored there; never commit it.');}catch(e){if(e.code!=='EEXIST')throw e;console.log('Existing .env preserved.');}
