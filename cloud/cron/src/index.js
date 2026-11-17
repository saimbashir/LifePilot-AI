export default {
  async scheduled(_controller,env,ctx){
    if(!env.MONITOR_CRON_SECRET || !env.LIFEPILOT_BACKEND_URL || env.LIFEPILOT_BACKEND_URL.includes('example.invalid'))return;
    const url=new URL('/internal/cron/monitor',env.LIFEPILOT_BACKEND_URL);
    ctx.waitUntil((async()=>{
      const result=await fetch(url,{method:'POST',headers:{'X-Monitor-Token':env.MONITOR_CRON_SECRET},redirect:'error',signal:AbortSignal.timeout(25000)});
      if(!result.ok)throw new Error('LifePilot backend monitor failed with '+result.status);
    })());
  }
};
