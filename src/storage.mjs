import {validateSession} from './inventory.mjs';
let dbPromise;
function database(){return dbPromise??=new Promise((resolve,reject)=>{const r=indexedDB.open('survival-log-web',1);r.onupgradeneeded=()=>r.result.createObjectStore('saves');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export async function saveSession(state){const valid=validateSession(state);const db=await database();await new Promise((resolve,reject)=>{const tx=db.transaction('saves','readwrite');tx.objectStore('saves').put({state:valid,savedAt:new Date().toISOString()},'manual');tx.oncomplete=resolve;tx.onabort=tx.onerror=()=>reject(tx.error||new Error('保存失败'));});}
export async function loadSession(){const db=await database();return new Promise((resolve,reject)=>{const r=db.transaction('saves').objectStore('saves').get('manual');r.onsuccess=()=>{try{resolve(r.result?{state:validateSession(r.result.state),savedAt:r.result.savedAt}:null);}catch(e){reject(e)}};r.onerror=()=>reject(r.error);});}
