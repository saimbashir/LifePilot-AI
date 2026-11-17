// Basic repository secret-pattern check, NOT a substitute for GitHub secret scanning.
import fs from 'node:fs';
import path from 'node:path';
const skip=new Set(['node_modules','.git','dist','private','.gradle','screenshots']);
const checks=[
  new RegExp('gs'+'k_[A-Za-z0-9]{20,}','g'),
  new RegExp('ya2'+'9\\.[A-Za-z0-9._-]{20,}','g'),
  new RegExp('-----BEGIN '+'(?:RSA |EC |OPENSSH )?PRIVATE KEY-----','g')
];
const bad=[];
function walk(folder){
  for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
    if(skip.has(entry.name))continue;
    const target=path.join(folder,entry.name);
    if(entry.isDirectory()){walk(target);continue}
    if(!entry.isFile())continue;
    if(entry.name==='.env'||entry.name.startsWith('.env.local')||entry.name.endsWith('.jks')||entry.name.endsWith('.keystore')){bad.push(target+' private file present');continue}
    if(!/\.(mjs|js|ts|tsx|json|html|xml|md|toml|yaml|yml|properties|gradle|example|css|svg|txt)$/.test(entry.name))continue;
    const content=fs.readFileSync(target,'utf8');
    for(const regex of checks){regex.lastIndex=0;if(regex.test(content))bad.push(target+' recognizable credential marker')}
  }
}
walk(process.cwd());
if(bad.length){console.error('Sensitive file/pattern found:',bad.join('\n'));process.exit(1)}
console.log('Basic secret scan: no recognizable private credentials or .env files.');
