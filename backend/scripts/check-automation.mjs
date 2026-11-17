// Safe, read-only setup report. Never prints any credentials or message data.
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const filename=fileURLToPath(new URL('../.env',import.meta.url));
if(fs.existsSync(filename)&&process.loadEnvFile)process.loadEnvFile(filename);
const env=process.env;
const bool=name=>env[name]==='true';
const present=name=>Boolean(env[name]&&!/^(YOUR_|REPLACE_|your_|$)/.test(env[name]));
const rows={
  'Google credentials configured':present('GOOGLE_CLIENT_ID')&&present('GOOGLE_CLIENT_SECRET')&&present('ALLOWED_GMAIL_ADDRESS'),
  'Groq AI enabled':bool('AI_ENABLED')&&present('GROQ_API_KEY'),
  'Internal monitoring timer requested':bool('MONITOR_INTERNAL_TIMER_ENABLED'),
  'Cloud cron requested':bool('MONITOR_WORKER_ENABLED'),
  'Cron token configured':present('MONITOR_CRON_SECRET'),
  'Firebase push configured':present('FIREBASE_SERVICE_ACCOUNT_JSON_B64'),
  'Production mode':env.NODE_ENV==='production',
  'HTTPS backend origin':String(env.BASE_URL||'').startsWith('https://')
};
console.log('LifePilot automation configuration (no secret values):');
for(const [key,value] of Object.entries(rows))console.log(`  ${value?'YES':'NO '}  ${key}`);
console.log('\nThis checks configuration only, NOT cloud uptime, live Groq, Gmail history or notification delivery.');
if(bool('MONITOR_INTERNAL_TIMER_ENABLED')&&env.NODE_ENV!=='production')console.log('WARNING: Internal timer on your local PC STOPS when the PC is off.');
if(bool('MONITOR_WORKER_ENABLED')&&!present('MONITOR_CRON_SECRET'))console.log('WARNING: Cloud cron enabled but the shared scheduler secret is not configured.');
if(env.NODE_ENV==='production'&&!String(env.BASE_URL||'').startsWith('https://'))console.log('WARNING: Production backend must use a real HTTPS origin.');
