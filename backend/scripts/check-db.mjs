// Owner-run read-only integrity check of an existing database.
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
const file=process.argv[2];
if(!file||!fs.existsSync(file))throw new Error('Provide the path to an existing .sqlite database');
const db=new DatabaseSync(file,{readOnly:true});
try{const result=db.prepare('PRAGMA integrity_check').get();if(result.integrity_check!=='ok')throw new Error('Database integrity check failed');console.log('SQLite integrity_check: ok')}
finally{db.close()}
