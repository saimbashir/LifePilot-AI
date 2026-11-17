import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./tests/e2e',use:{baseURL:'http://127.0.0.1:5173',browserName:'chromium',viewport:{width:1280,height:800}},
  webServer:{command:'npm run dev -- --host 127.0.0.1 --port 5173',url:'http://127.0.0.1:5173',reuseExistingServer:!process.env.CI,timeout:30000},
  reporter:'list'
});
