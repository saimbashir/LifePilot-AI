// Optional browser/Android PWA push registration. Firebase web config is PUBLIC,
// while the service-account key exists ONLY in the backend secret manager.
import {initializeApp,getApps} from 'firebase/app';
import {getMessaging,getToken,isSupported} from 'firebase/messaging';
import {monitorApi} from './api';
export async function enableWebPush():Promise<string>{
  if(!('serviceWorker' in navigator)||!('Notification' in window))throw new Error('Browser notifications are not supported');
  const permission=await Notification.requestPermission();
  if(permission!=='granted')throw new Error('Notification permission was not granted');
  if(!(await isSupported()))throw new Error('Firebase messaging is unsupported in this browser');
  const firebaseConfig={
    apiKey:import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain:import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId:import.meta.env.VITE_FIREBASE_PROJECT_ID,
    messagingSenderId:import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId:import.meta.env.VITE_FIREBASE_APP_ID
  };
  const vapidKey=import.meta.env.VITE_FIREBASE_WEB_PUSH_VAPID_PUBLIC_KEY;
  if(!firebaseConfig.apiKey||!firebaseConfig.projectId||!vapidKey)throw new Error('Web push has not been configured for this deployment');
  const registration=await navigator.serviceWorker.register('/sw.js');
  const app=getApps()[0]||initializeApp(firebaseConfig);
  const token=await getToken(getMessaging(app),{vapidKey,serviceWorkerRegistration:registration});
  if(!token)throw new Error('The browser did not provide a push token');
  await monitorApi.registerPush(token,'web');
  return 'Device registered for generic, privacy-minded notifications';
}
