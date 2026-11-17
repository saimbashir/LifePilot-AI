// Optional owner-run, read-only configuration check. No private Gmail data is accessed.
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {providerConfig} from '../src/ai/provider.mjs';
const envFile=new URL('../.env',import.meta.url);
if(fs.existsSync(envFile)&&process.loadEnvFile)process.loadEnvFile(fileURLToPath(envFile));
const c=providerConfig();
if(!c.configured){console.error('Groq is not configured. Add a new valid API key to local backend/.env only.');process.exit(1)}
try{
  const res=await fetch('https://api.groq.com/openai/v1/models',{headers:{Authorization:`Bearer ${process.env.GROQ_API_KEY}`},signal:AbortSignal.timeout(8000)});
  if(!res.ok){console.error(`Groq model-check failed (HTTP ${res.status}). Check key, account tier and connectivity; no key shown.`);process.exit(1)}
  const body=await res.json();const names=(body.data||[]).map(x=>x.id);
  if(!names.includes(c.model)){console.error('Configured model is not available for this account. Choose an ID from GroqCloud model list.');process.exit(1)}
  console.log(`Groq model available: ${c.model}. This does not validate email summarization or sending.`);
}catch{console.error('Groq model-check unavailable: network error or timeout.');process.exit(1)}
