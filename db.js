/* ===== 瀏覽器資料庫（IndexedDB）共用工具 =====
   後台草稿與圖片都存在這裡，容量比舊的 localStorage（約 5MB）大非常多，
   放上百張照片也沒問題。前台(app.js)與後台(admin.js)都會用到這支檔案。 */
window.GDB = (function(){
  const DB_NAME = "guitarShopDB";
  let dbPromise = null;

  function open(){
    if(dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject)=>{
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = ()=>{
        const db = req.result;
        if(!db.objectStoreNames.contains("draft"))  db.createObjectStore("draft");   // 商品草稿（文字資料）
        if(!db.objectStoreNames.contains("images")) db.createObjectStore("images");  // 圖片檔（圖片編號 → 圖片）
      };
      req.onsuccess = ()=>{
        const db = req.result;
        // 連線若被瀏覽器關掉（例如同時開多個後台分頁互相干擾），下次操作會自動重連
        db.onclose = ()=>{ dbPromise = null; };
        db.onversionchange = ()=>{ try{ db.close(); }catch(e){} dbPromise = null; };
        resolve(db);
      };
      req.onerror = ()=>{ dbPromise = null; reject(req.error); };
    });
    return dbPromise;
  }
  function wait(req){
    return new Promise((resolve, reject)=>{
      req.onsuccess = ()=> resolve(req.result);
      req.onerror   = ()=> reject(req.error);
    });
  }
  async function store(name, mode){
    try{
      const db = await open();
      return db.transaction(name, mode).objectStore(name);
    }catch(e){
      dbPromise = null;                    // 連線已失效 → 重開一次再試
      const db = await open();
      return db.transaction(name, mode).objectStore(name);
    }
  }

  return {
    async getDraft(){        return wait((await store("draft","readonly")).get("storeData")); },
    async setDraft(d){       return wait((await store("draft","readwrite")).put(d, "storeData")); },
    async getMeta(k){        return wait((await store("draft","readonly")).get(k)); },
    async setMeta(k, v){     return wait((await store("draft","readwrite")).put(v, k)); },
    async getImage(id){      return wait((await store("images","readonly")).get(id)); },
    async putImage(id, b){   return wait((await store("images","readwrite")).put(b, id)); },
    async deleteImage(id){   return wait((await store("images","readwrite")).delete(id)); },
    async imageKeys(){       return wait((await store("images","readonly")).getAllKeys()); },
    async clearAll(){
      await wait((await store("draft","readwrite")).clear());
      await wait((await store("images","readwrite")).clear());
    }
  };
})();
