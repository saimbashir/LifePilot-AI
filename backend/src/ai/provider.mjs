import {fail} from '../security.mjs';
// All API credentials stay in the backend environment. Never forward provider failures verbatim to browsers.
export function providerConfig(env=process.env){return {
  configured:env.AI_PROVIDER==='groq'&&Boolean(env.GROQ_API_KEY&&env.GROQ_API_KEY!=='your_groq_api_key_here'),
  enabled:env.AI_ENABLED==='true',model:env.GROQ_MODEL||'openai/gpt-oss-20b',
  maxInputChars:Math.max(1000,Math.min(50000,Number(env.AI_MAX_INPUT_CHARS)||18000)),
  maxOutputTokens:Math.max(300,Math.min(3000,Number(env.AI_MAX_OUTPUT_TOKENS)||850)),
  timeoutMs:Math.max(1500,Math.min(60000,Number(env.AI_TIMEOUT_MS)||18000))
}}
export function createGroq({env=process.env,fetchImpl=fetch}={}){
  const config=providerConfig(env);
  return {config,async generate({system,user}){
    if(!config.configured||!config.enabled)throw fail(503,'AI not configured or enabled on the backend.');
    const signal=AbortSignal.timeout(config.timeoutMs);
    let response;
    try{response=await fetchImpl('https://api.groq.com/openai/v1/chat/completions',{
      method:'POST',headers:{Authorization:`Bearer ${env.GROQ_API_KEY}`,'Content-Type':'application/json'},signal,
      body:JSON.stringify({model:config.model,temperature:0.2,max_completion_tokens:config.maxOutputTokens,
        response_format:{type:'json_object'},messages:[{role:'system',content:system},{role:'user',content:user}]})
    })}catch{throw fail(502,'AI provider unavailable or request timed out. Retry or use manual composer.');}
    if(response.status===429)throw fail(429,'AI provider rate limit reached. Please retry later or compose manually.');
    if(!response.ok)throw fail(502,'AI provider rejected the request. Check the backend AI configuration.');
    let data;try{data=await response.json()}catch{throw fail(502,'AI provider returned unreadable data.');}
    const content=data?.choices?.[0]?.message?.content;
    if(typeof content!=='string'||content.length>40000)throw fail(502,'AI provider returned an invalid message.');
    let parsed;try{parsed=JSON.parse(content)}catch{throw fail(502,'AI provider returned invalid JSON. Please retry.');}
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw fail(502,'AI provider returned an invalid response structure.');
    return {data:parsed,usage:{promptTokens:data.usage?.prompt_tokens||0,completionTokens:data.usage?.completion_tokens||0}};
  }};
}
