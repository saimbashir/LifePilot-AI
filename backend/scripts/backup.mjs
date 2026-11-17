/**
 * Safe ONLINE SQLite backup. Run only on your private host; contains sensitive
 * encrypted drafts/tokens and some plaintext account metadata. Store offline
 * on encrypted media and never commit it or send it through chat.
 * Usage: DB_PATH=/srv/lifepilot/lifepilot.sqlite node backend/scripts/backup.mjs /private/backup.sqlite
 */
import {DatabaseSync,backup} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
const source=path.resolve(process.env.DB_PATH||'./backend/private/lifepilot.sqlite');
const destination=process.argv[2]&&path.resolve(process.argv[2]);
if(!destination||!destination.endsWith('.sqlite'))throw new Error('Specify an explicit destination ending in .sqlite');
if(!fs.existsSync(source))throw new Error('Source database does not exist');
if(source===destination)throw new Error('Backup destination cannot overwrite the source');
if(fs.existsSync(destination))throw new Error('Refusing to overwrite an existing backup');
fs.mkdirSync(path.dirname(destination),{recursive:true,mode:0o700});
const db=new DatabaseSync(source,{readOnly:true});
try{
  await backup(db,destination);
  fs.chmodSync(destination,0o600);
  const verify=new DatabaseSync(destination,{readOnly:true});
  try{if(verify.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('Backup integrity check failed')}
  finally{verify.close()}
  console.log('SQLite online backup completed and integrity checked. Keep it private and encrypted.');
}finally{db.close()}
