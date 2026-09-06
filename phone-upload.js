"use strict";

const DRAFT_KEY = "unlimit-mobile-listing-draft-v1";
const DB_NAME = "unlimit-mobile-listing-images";
const DB_STORE = "images";
let photos = [];
let photoSeq = 0;

const byId = id => document.getElementById(id);
const fields = {
  category:byId("mCat"), name:byId("mName"), brand:byId("mBrand"),
  price:byId("mPrice"), desc:byId("mDesc")
};

function openImageDB(){
  return new Promise((resolve, reject)=>{
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = ()=> request.result.createObjectStore(DB_STORE, { keyPath:"id" });
    request.onsuccess = ()=> resolve(request.result);
    request.onerror = ()=> reject(request.error || new Error("無法開啟手機照片草稿"));
  });
}

async function readStoredPhotos(){
  const db = await openImageDB();
  return new Promise((resolve, reject)=>{
    const request = db.transaction(DB_STORE).objectStore(DB_STORE).getAll();
    request.onsuccess = ()=> resolve((request.result || []).sort((a,b)=>a.order-b.order));
    request.onerror = ()=> reject(request.error);
  });
}

async function saveStoredPhotos(){
  const db = await openImageDB();
  await new Promise((resolve, reject)=>{
    const tx = db.transaction(DB_STORE, "readwrite");
    const store = tx.objectStore(DB_STORE);
    store.clear();
    photos.forEach((photo, order)=> store.put({ id:photo.id, order, blob:photo.blob, name:photo.name }));
    tx.oncomplete = resolve;
    tx.onerror = ()=> reject(tx.error);
  });
}

async function clearStoredPhotos(){
  const db = await openImageDB();
  await new Promise((resolve, reject)=>{
    const request = db.transaction(DB_STORE, "readwrite").objectStore(DB_STORE).clear();
    request.onsuccess = resolve;
    request.onerror = ()=> reject(request.error);
  });
}

function saveTextDraft(){
  localStorage.setItem(DRAFT_KEY, JSON.stringify({
    category:fields.category.value,
    name:fields.name.value,
    brand:fields.brand.value,
    price:fields.price.value,
    desc:fields.desc.value
  }));
  updateDescCount();
}

function restoreTextDraft(){
  try{
    const data = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
    if(!data || typeof data !== "object") return;
    fields.category.value = data.category === "electric" ? "electric" : "acoustic";
    fields.name.value = String(data.name || "");
    fields.brand.value = String(data.brand || "");
    fields.price.value = String(data.price || "");
    fields.desc.value = String(data.desc || "");
  }catch(error){}
}

function updateDescCount(){ byId("mDescCount").textContent = fields.desc.value.length + " 字"; }
Object.values(fields).forEach(field=> field.addEventListener("input", saveTextDraft));
fields.category.addEventListener("change", saveTextDraft);

function makePhoto(record){
  return { ...record, url:URL.createObjectURL(record.blob) };
}

function replacePhotos(records){
  photos.forEach(photo=> URL.revokeObjectURL(photo.url));
  photos = records.map(makePhoto);
  renderPhotos();
}

function renderPhotos(){
  const wrap = byId("mobilePreview");
  wrap.replaceChildren();
  photos.forEach((photo, index)=>{
    const card = document.createElement("div");
    card.className = "mobile-photo";
    const img = document.createElement("img");
    img.src = photo.url;
    img.alt = "商品照片 " + (index + 1);
    card.append(img);
    if(index === 0){
      const cover = document.createElement("span");
      cover.className = "mobile-cover";
      cover.textContent = "封面";
      card.append(cover);
    }
    const ops = document.createElement("div");
    ops.className = "mobile-photo-ops";
    for(const [action, text, disabled] of [
      ["left", "◀", index === 0], ["delete", "✕", false], ["right", "▶", index === photos.length-1]
    ]){
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.action = action;
      button.dataset.index = String(index);
      button.textContent = text;
      button.disabled = disabled;
      ops.append(button);
    }
    card.append(ops);
    wrap.append(card);
  });
}

byId("mobilePreview").addEventListener("click", async event=>{
  const button = event.target.closest("button[data-action]");
  if(!button) return;
  const index = Number(button.dataset.index);
  if(button.dataset.action === "delete"){
    URL.revokeObjectURL(photos[index].url);
    photos.splice(index, 1);
  }else if(button.dataset.action === "left" && index > 0){
    [photos[index-1], photos[index]] = [photos[index], photos[index-1]];
  }else if(button.dataset.action === "right" && index < photos.length-1){
    [photos[index+1], photos[index]] = [photos[index], photos[index+1]];
  }
  renderPhotos();
  await saveStoredPhotos();
});

function imageToJpeg(file){
  return new Promise((resolve, reject)=>{
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = ()=>{
      try{
        const max = 1200;
        let width = image.naturalWidth || image.width;
        let height = image.naturalHeight || image.height;
        if(width > max || height > max){
          const ratio = Math.min(max / width, max / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(image, 0, 0, width, height);
        canvas.toBlob(blob=>{
          URL.revokeObjectURL(url);
          blob ? resolve(blob) : reject(new Error("照片轉成 JPG 失敗"));
        }, "image/jpeg", 0.84);
      }catch(error){ URL.revokeObjectURL(url); reject(error); }
    };
    image.onerror = ()=>{
      URL.revokeObjectURL(url);
      reject(new Error("這張照片無法讀取；若是 HEIC，請在 iPhone 相機設定選擇「最相容」後重拍或先轉成 JPG"));
    };
    image.src = url;
  });
}

byId("mImages").addEventListener("change", async event=>{
  const files = Array.from(event.target.files || []);
  event.target.value = "";
  const work = byId("imageWork");
  work.classList.remove("is-error");
  const failed = [];
  for(let index = 0; index < files.length; index++){
    work.textContent = "正在處理照片 " + (index + 1) + " / " + files.length + "…";
    try{
      const blob = await imageToJpeg(files[index]);
      const id = "mobile_" + Date.now().toString(36) + "_" + (++photoSeq) + "_" + Math.random().toString(36).slice(2,7);
      photos.push(makePhoto({ id, blob, name:files[index].name || (id + ".jpg") }));
      renderPhotos();
      await saveStoredPhotos();
    }catch(error){ failed.push((files[index].name || "未命名照片") + "：" + error.message); }
  }
  work.textContent = failed.length
    ? "有 " + failed.length + " 張無法處理：\n" + failed.join("\n")
    : (files.length ? "✔ 照片已保存在這支手機的草稿中" : "");
  work.classList.toggle("is-error", failed.length > 0);
});

function validatedProduct(){
  const name = fields.name.value.trim();
  if(!name){ fields.name.focus(); throw new Error("請先填寫商品名稱"); }
  return {
    category:fields.category.value === "electric" ? "electric" : "acoustic",
    name,
    brand:fields.brand.value.trim(),
    price:Number(fields.price.value) || 0,
    desc:fields.desc.value.trim(),
    images:[]
  };
}

async function buildListingPackage(){
  const product = validatedProduct();
  const zip = new JSZip();
  const stamp = Date.now().toString(36);
  photos.forEach((photo, index)=>{
    const path = "images/mobile_" + stamp + "_" + String(index + 1).padStart(2, "0") + ".jpg";
    product.images.push(path);
    zip.file(path, photo.blob);
  });
  zip.file("listing.json", JSON.stringify({
    format:"unlimit-mobile-listing",
    formatVersion:1,
    createdAt:new Date().toISOString(),
    product
  }, null, 2));
  const blob = await zip.generateAsync({ type:"blob", compression:"DEFLATE", compressionOptions:{ level:6 } });
  const safe = nameForFile(product.name);
  return new File([blob], "Unlimit上架包_" + safe + ".zip", { type:"application/zip" });
}

function nameForFile(value){
  const safe = String(value || "商品").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim();
  return (safe || "商品").slice(0, 50);
}

function status(message, error=false){
  const box = byId("sendStatus");
  box.textContent = message;
  box.classList.toggle("is-error", error);
}

async function withBusy(button, task){
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "處理中…";
  status("");
  try{ await task(); }
  catch(error){ status(error && error.message ? error.message : String(error), true); }
  finally{ button.disabled = false; button.textContent = original; }
}

async function sharePackage(channel){
  const file = await buildListingPackage();
  if(navigator.canShare && navigator.canShare({ files:[file] }) && navigator.share){
    try{
      await navigator.share({
        files:[file],
        title:"Unlimit 手機上架包",
        text:"請使用 Mac 商品後台匯入這個上架包（選擇 " + channel + " 傳送）"
      });
      status("✔ 已交給 " + channel + " 分享；請在 Mac 接收上架包");
    }catch(error){
      if(error && error.name === "AbortError"){
        status("已取消分享");
        return;
      }
      downloadFile(file);
      status("無法開啟分享選單，已改為下載上架包");
    }
  }else{
    downloadFile(file);
    status("這個瀏覽器不支援直接分享，已改為下載上架包");
  }
}

function downloadFile(file){
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 30_000);
}

byId("airdropBtn").addEventListener("click", event=> withBusy(event.currentTarget, ()=>sharePackage("AirDrop")));
byId("lineBtn").addEventListener("click", event=> withBusy(event.currentTarget, ()=>sharePackage("LINE")));
byId("downloadBtn").addEventListener("click", event=> withBusy(event.currentTarget, async()=>{
  downloadFile(await buildListingPackage());
  status("✔ 上架包已下載");
}));

byId("wifiSendBtn").addEventListener("click", event=> withBusy(event.currentTarget, async()=>{
  if(location.protocol !== "http:") throw new Error("同 Wi-Fi 直傳請先在 Mac 雙擊「手機上架.command」，再掃描 Mac 顯示的 QR Code");
  const code = byId("pairCodeInput").value.replace(/\D/g, "");
  if(code.length !== 6) throw new Error("請輸入 Mac 顯示的 6 位數一次性密碼");
  const file = await buildListingPackage();
  const response = await fetch("/__mobile-inbox", {
    method:"POST",
    headers:{ "Content-Type":"application/zip", "X-Unlimit-Mobile-Code":code },
    body:file,
    credentials:"same-origin"
  });
  const result = await response.json().catch(()=>({ ok:false, msg:"Mac 回應格式錯誤" }));
  if(!response.ok || !result.ok) throw new Error(result.msg || "傳送失敗");
  status("✔ 已送到 Mac 待確認區；正式網站尚未發布");
}));

byId("clearDraftBtn").addEventListener("click", async()=>{
  if(!confirm("確定要清除這支手機上的文字與照片草稿嗎？")) return;
  localStorage.removeItem(DRAFT_KEY);
  await clearStoredPhotos();
  replacePhotos([]);
  fields.category.value = "acoustic";
  fields.name.value = "";
  fields.brand.value = "";
  fields.price.value = "";
  fields.desc.value = "";
  updateDescCount();
  status("已清除手機草稿");
});

(async function init(){
  restoreTextDraft();
  updateDescCount();
  try{ replacePhotos(await readStoredPhotos()); }
  catch(error){ status("無法讀取先前照片草稿：" + error.message, true); }
  const params = new URLSearchParams(location.hash.slice(1));
  const code = (params.get("code") || sessionStorage.getItem("unlimit-mobile-code") || "").replace(/\D/g, "").slice(0,6);
  if(code){
    byId("pairCodeInput").value = code;
    sessionStorage.setItem("unlimit-mobile-code", code);
    history.replaceState(null, "", location.pathname + location.search);
  }
  if(location.protocol === "https:"){
    byId("wifiOption").classList.add("is-unavailable");
    byId("pairCodeInput").disabled = true;
    byId("wifiSendBtn").disabled = true;
  }
})();
