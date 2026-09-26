/* ===== 取得商品資料 =====
   正式網站一律使用 data.js。只有網址明確帶有 ?preview=1 時，
   才讀取管理後台存在 IndexedDB/localStorage 的草稿。 */
let DATA = { acoustic:[], electric:[], accessories:[] };
const DRAFT_PREVIEW = new URLSearchParams(location.search).has("preview");

/* 圖片編號（img_ 開頭）＝存在瀏覽器資料庫裡的圖片 */
function isImgId(s){ return typeof s === "string" && s.indexOf("img_") === 0; }

/* 把草稿裡的圖片編號換成可顯示的網址 */
async function resolveDraftImages(data){
  const cache = {};
  for(const cat of ["acoustic", "electric", "accessories"]){
    const products = Array.isArray(data && data[cat]) ? data[cat] : [];
    for(const p of products){
      if(!p || typeof p !== "object") continue;
      const out = [];
      for(const ref of imgsOf(p)){
        if(isImgId(ref)){
          if(!(ref in cache)){
            let u = "";
            try{
              const b = await GDB.getImage(ref);
              if(b) u = URL.createObjectURL(b);
            }catch(e){}
            cache[ref] = u;
          }
          // 資料庫沒有檔案時，退而求其次用網站 images 資料夾裡的檔案
          out.push(cache[ref] || ("images/" + ref + ".jpg"));
        }else{
          out.push(ref);
        }
      }
      p.imgs = out;
      p.img = out[0] || "";
    }
  }
}

async function loadData(){
  if(DRAFT_PREVIEW){
    if(window.GDB){
      try{
        const draft = await GDB.getDraft();
        if(draft){ await resolveDraftImages(draft); return draft; }
      }catch(e){}
    }
    try{
      const backup = localStorage.getItem("storeDataBackup");
      if(backup){
        const d = JSON.parse(backup);
        await resolveDraftImages(d);   // 備份裡是圖片編號，也要轉成可顯示的網址
        return d;
      }
    }catch(e){}
    try{
      const saved = localStorage.getItem("storeData");
      if(saved) return JSON.parse(saved);
    }catch(e){}
  }
  return window.STORE_DATA || { acoustic:[], electric:[], accessories:[] };
}

const TITLES = { acoustic:"木吉他", electric:"電吉他", accessories:"配件" };
let currentCat = "acoustic";
let currentSection = "products";
const INFO_SECTIONS = {
  reviews:{ title:"客戶評價", empty:"客戶評價整理中，敬請期待。" },
  knowledge:{ title:"吉他小知識", empty:"吉他小知識文章準備中，敬請期待。" }
};
let currentSort = "num";     // 預設：依商品編號由小到大
let searchQuery = "";

function safeColor(value){
  const s = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(s) ? s : "#d9c08a";
}

/* 商品圖只接受本站圖片、blob 預覽、HTTPS 或舊版 raster data URL。 */
function safeImageSource(value){
  const s = String(value || "").trim();
  if(!s || /[\u0000-\u001f\u007f]/.test(s)) return "";
  if(/^blob:/i.test(s)) return s;
  if(/^https:\/\//i.test(s)) return s;
  if(/^data:image\/(?:jpeg|jpg|png|webp|gif);base64,/i.test(s)) return s;
  if(/^images\//i.test(s)){
    const path = s.split(/[?#]/, 1)[0];
    const parts = path.slice(7).split("/");
    if(parts.some(part => !part || part === "." || part === "..")) return "";
    if(/^images\/[a-z0-9._/-]+\.(?:jpe?g|png|webp|gif|avif)(?:[?#].*)?$/i.test(s)) return s;
  }
  return "";
}

/* 沒放真實圖片時，畫一把佔位吉他 */
function placeholder(p, cat){
  const c = safeColor(p.color);
  if(cat === "accessories") return `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg"><rect x="24" y="30" width="72" height="66" rx="10" fill="${c}"/><path d="M24 48h72M60 30v20" fill="none" stroke="#fff" stroke-width="5"/></svg>`;
  if(cat === "electric"){
    return `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
      <rect x="58" y="6" width="6" height="60" rx="2" fill="#2b2015"/>
      <rect x="54" y="2" width="14" height="9" rx="2" fill="#1d150d"/>
      <path d="M42 70 q-14 6 -10 24 q4 16 22 12 q14-2 24-2 q16 2 18-14 q2-16-14-22 q-12-4-26 0 q-8 1-14 2z" fill="${c}"/>
      <rect x="56" y="60" width="8" height="34" rx="2" fill="#d9c08a"/>
      <rect x="52" y="88" width="16" height="10" rx="2" fill="#111"/>
    </svg>`;
  }
  return `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
    <rect x="56" y="8" width="8" height="46" rx="2" fill="#3a2e22"/>
    <rect x="52" y="4" width="16" height="10" rx="2" fill="#241b13"/>
    <ellipse cx="60" cy="86" rx="34" ry="30" fill="${c}"/>
    <ellipse cx="60" cy="74" rx="26" ry="22" fill="#ffffff55"/>
    <circle cx="60" cy="78" r="9" fill="#1d150d"/>
    <rect x="57" y="92" width="6" height="14" rx="1" fill="#3a2e22"/>
  </svg>`;
}

function placeholderNode(p, cat){
  const template = document.createElement("template");
  template.innerHTML = placeholder(p, cat).trim();
  return template.content.firstElementChild;
}

function textElement(tag, className, text){
  const el = document.createElement(tag);
  if(className) el.className = className;
  el.textContent = text;
  return el;
}
/* 商品的圖片列表（相容舊的單張 img 欄位） */
function imgsOf(p){
  if(Array.isArray(p.imgs)) return p.imgs.filter(s=>typeof s === "string" && s.trim());
  if(typeof p.img === "string" && p.img.trim()) return [p.img];
  return [];
}
function productImageNode(p, cat){
  const list = imgsOf(p);
  const src = list.length ? safeImageSource(list[0]) : "";
  if(!src) return placeholderNode(p, cat);
  const img = document.createElement("img");
  img.src = src;
  img.alt = String(p.name || "");
  img.loading = "lazy";
  img.decoding = "async";
  img.addEventListener("error", ()=> img.replaceWith(placeholderNode(p, cat)), { once:true });
  return img;
}

/* 從商品名稱取出編號，例如「96號面單(原價…)」→ 96。
   沒有「◯◯號」的商品（例如 G1A：寒梅）排到最後面。 */
const NO_NUMBER = Number.MAX_SAFE_INTEGER;
function numOf(p){
  const m = /(\d+)\s*號/.exec(p.name || "");
  return m ? parseInt(m[1], 10) : NO_NUMBER;
}

function sortList(list){
  let arr = list.map((p,i)=>({...p, _i:i}));
  if(searchQuery){
    arr = arr.filter(p => [p.name, p.brand, p.desc]
      .some(v => String(v || "").toLocaleLowerCase("zh-Hant").includes(searchQuery)));
  }
  switch(currentSort){
    case "num":        arr.sort((a,b)=> numOf(a)-numOf(b) || String(a.name||"").localeCompare(String(b.name||""))); break;
    case "new":        arr.reverse(); break;                       // 越後面新增＝越新
    case "old":        break;
    case "price-desc": arr.sort((a,b)=>b.price-a.price); break;
    case "price-asc":  arr.sort((a,b)=>a.price-b.price); break;
  }
  // 已售出的一律排到最後面；釘選的排最前面（越早釘選越前面），其餘照上面選的排序
  const pinned = arr.filter(p=> p.pinned && !p.sold).sort((a,b)=>a.pinned-b.pinned);
  const rest   = arr.filter(p=>!p.pinned && !p.sold);
  const sold   = arr.filter(p=> p.sold);
  return [...pinned, ...rest, ...sold];
}

function render(){
  const grid = document.getElementById("productGrid");
  const isProducts = currentSection === "products";
  document.querySelector(".content-controls").style.display = isProducts ? "" : "none";
  document.getElementById("searchBtn").hidden = !isProducts;
  if(!isProducts){
    closeSearch();
    const section = INFO_SECTIONS[currentSection];
    document.getElementById("pageTitle").textContent = section.title;
    if(currentSection === "reviews"){
      CustomerReviews.mount(grid, DATA);
      return;
    }
    grid.replaceChildren(textElement("p", "info-empty", section.empty));
    return;
  }
  const list = sortList(DATA[currentCat] || []);
  grid.replaceChildren();
  if(!list.length){
    const empty = textElement("p", "product-empty",
      searchQuery ? "找不到符合搜尋條件的商品" : "此分類暫時沒有商品");
    grid.append(empty);
  }else{
    const fragment = document.createDocumentFragment();
    for(const p of list){
      const card = document.createElement("article");
      card.className = "card";
      card.dataset.cat = currentCat;
      card.dataset.i = String(p._i);
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", "查看 " + String(p.name || "商品"));

      const imageWrap = document.createElement("div");
      imageWrap.className = "card-img" + (p.sold ? " is-sold" : "");
      imageWrap.append(productImageNode(p, currentCat));
      if(p.brand && String(p.brand).trim()) imageWrap.append(textElement("span", "card-tag", p.brand));
      if(p.pinned){
        const pin = textElement("span", "card-pin", "🔥");
        pin.title = "主打商品";
        imageWrap.append(pin);
      }
      if(p.sold) imageWrap.append(textElement("span", "sold-strip", "SOLD OUT"));

      card.append(
        imageWrap,
        textElement("div", "card-name", p.name || ""),
        textElement("div", "card-price", "NT$" + Number(p.price || 0).toLocaleString())
      );
      fragment.append(card);
    }
    grid.append(fragment);
  }
  document.getElementById("pageTitle").textContent = searchQuery
    ? TITLES[currentCat] + "搜尋結果"
    : TITLES[currentCat];
}

/* ===== 商品詳情彈窗（含多圖相簿） ===== */
const modal = document.getElementById("detailModal");
let galImgs = [], galIdx = 0, galP = null, galCat = "acoustic";

function renderGallery(){
  const wrap = document.getElementById("modalImg");
  wrap.classList.toggle("is-sold", !!(galP && galP.sold));
  wrap.replaceChildren();
  const src = galImgs.length ? safeImageSource(galImgs[galIdx]) : "";
  if(src){
    const img = document.createElement("img");
    img.src = src;
    img.alt = String((galP && galP.name) || "") + " 第 " + (galIdx + 1) + " 張";
    img.addEventListener("error", ()=> img.replaceWith(placeholderNode(galP || {}, galCat)), { once:true });
    wrap.append(img);
  }else{
    wrap.append(placeholderNode(galP || {}, galCat));
  }
  if(galImgs.length > 1){
    const prev = textElement("button", "gal-btn gal-prev", "‹");
    prev.type = "button"; prev.setAttribute("aria-label", "上一張");
    const next = textElement("button", "gal-btn gal-next", "›");
    next.type = "button"; next.setAttribute("aria-label", "下一張");
    const dots = document.createElement("div");
    dots.className = "gal-dots";
    galImgs.forEach((_, i)=>{
      const dot = document.createElement("span");
      if(i === galIdx) dot.className = "on";
      dots.append(dot);
    });
    wrap.append(prev, next, dots);
  }
  if(galP && galP.sold) wrap.append(textElement("span", "sold-strip", "SOLD OUT"));
}
document.getElementById("modalImg").addEventListener("click", e=>{
  if(!galImgs.length) return;
  if(e.target.closest(".gal-prev")){ galIdx = (galIdx - 1 + galImgs.length) % galImgs.length; renderGallery(); }
  else if(e.target.closest(".gal-next")){ galIdx = (galIdx + 1) % galImgs.length; renderGallery(); }
});

/* 手機：手指左右滑動切換圖片 */
(function(){
  const wrap = document.getElementById("modalImg");
  let sx = 0, sy = 0;
  wrap.addEventListener("touchstart", e=>{
    sx = e.touches[0].clientX; sy = e.touches[0].clientY;
  }, {passive:true});
  wrap.addEventListener("touchend", e=>{
    if(galImgs.length < 2) return;
    const dx = e.changedTouches[0].clientX - sx;
    const dy = e.changedTouches[0].clientY - sy;
    // 水平滑超過 45px 且大於垂直位移，才算滑動（避免和上下捲動打架）
    if(Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)){
      galIdx = (galIdx + (dx < 0 ? 1 : -1) + galImgs.length) % galImgs.length;
      renderGallery();
    }
  }, {passive:true});
})();

function openDetail(cat, i){
  const p = DATA[cat][i];
  if(!p) return;
  galImgs = imgsOf(p); galIdx = 0; galP = p; galCat = cat;
  renderGallery();
  const mb = document.getElementById("modalBrand");
  const brand = String(p.brand || "");
  mb.textContent = brand;
  mb.style.display = brand.trim() ? "" : "none";
  document.getElementById("modalName").textContent = p.name||"";
  document.getElementById("modalPrice").textContent = "NT$"+Number(p.price||0).toLocaleString();
  document.getElementById("modalDesc").textContent = p.desc||"（尚未填寫商品介紹）";
  modal.classList.add("open");
}
document.getElementById("productGrid").addEventListener("click", e=>{
  const card = e.target.closest(".card");
  if(card) openDetail(card.dataset.cat, +card.dataset.i);
});
document.getElementById("productGrid").addEventListener("keydown", e=>{
  if(e.key !== "Enter" && e.key !== " ") return;
  const card = e.target.closest(".card");
  if(card){ e.preventDefault(); openDetail(card.dataset.cat, +card.dataset.i); }
});
document.getElementById("modalClose").addEventListener("click", ()=> modal.classList.remove("open"));
modal.addEventListener("click", e=>{ if(e.target===modal) modal.classList.remove("open"); });

/* ===== 分類切換 ===== */
const productNav = document.getElementById("productNav");
document.querySelectorAll(".nav-section").forEach(button=>{
  button.addEventListener("click",()=>{
    currentSection = button.dataset.section;
    document.querySelectorAll(".nav-section").forEach(item=>item.removeAttribute("aria-current"));
    button.setAttribute("aria-current", "page");
    document.querySelectorAll(".cat-list li").forEach(item=>{
      item.classList.remove("active");
      item.querySelector("button").removeAttribute("aria-current");
    });
    productNav.open = false;
    render();
  });
});
document.addEventListener("click", event=>{
  if(!productNav.contains(event.target)) productNav.open = false;
});
document.addEventListener("keydown", event=>{
  if(event.key === "Escape" && productNav.open){
    productNav.open = false;
    productNav.querySelector("summary").focus();
  }
});
document.querySelectorAll(".cat-list li").forEach(li=>{
  li.addEventListener("click",()=>{
    document.querySelectorAll(".cat-list li").forEach(x=>{
      x.classList.remove("active");
      x.querySelector("button").removeAttribute("aria-current");
    });
    li.classList.add("active");
    li.querySelector("button").setAttribute("aria-current", "true");
    currentCat = li.dataset.cat;
    currentSection = "products";
    document.querySelectorAll(".nav-section").forEach(item=>item.removeAttribute("aria-current"));
    render();
    productNav.open = false;
    productNav.querySelector("summary").focus();
  });
});

/* ===== 排序選單 ===== */
const sortBtn = document.getElementById("sortBtn");
const sortMenu = document.getElementById("sortMenu");
sortBtn.addEventListener("click",e=>{ e.stopPropagation(); sortMenu.classList.toggle("open"); });
document.addEventListener("click",()=> sortMenu.classList.remove("open"));
sortMenu.querySelectorAll("button").forEach(b=>{
  b.addEventListener("click",()=>{ currentSort=b.dataset.sort; sortMenu.classList.remove("open"); render(); });
});

/* ===== 商品搜尋 ===== */
const searchBtn = document.getElementById("searchBtn");
const searchPanel = document.getElementById("searchPanel");
const searchInput = document.getElementById("searchInput");
const searchClear = document.getElementById("searchClear");
function closeSearch(){
  searchPanel.hidden = true;
  searchBtn.setAttribute("aria-expanded", "false");
}
searchBtn.addEventListener("click", ()=>{
  const opening = searchPanel.hidden;
  searchPanel.hidden = !opening;
  searchBtn.setAttribute("aria-expanded", String(opening));
  if(opening) setTimeout(()=>searchInput.focus(), 0);
});
searchInput.addEventListener("input", ()=>{
  searchQuery = searchInput.value.trim().toLocaleLowerCase("zh-Hant");
  render();
});
searchClear.addEventListener("click", ()=>{
  searchInput.value = "";
  searchQuery = "";
  render();
  searchInput.focus();
});
document.addEventListener("keydown", e=>{ if(e.key === "Escape" && !searchPanel.hidden) closeSearch(); });

/* ===== 回到頂端 ===== */
document.getElementById("toTop").addEventListener("click",()=> window.scrollTo({top:0,behavior:"smooth"}));

/* 讀完資料再畫畫面（讀瀏覽器資料庫是非同步的） */
loadData().then(d=>{
  DATA = d && typeof d === "object" ? d : {};
  if(!Array.isArray(DATA.acoustic)) DATA.acoustic = [];
  if(!Array.isArray(DATA.electric)) DATA.electric = [];
  DATA.acoustic = DATA.acoustic.filter(p => p && typeof p === "object");
  DATA.electric = DATA.electric.filter(p => p && typeof p === "object");
  DATA.accessories = Array.isArray(DATA.accessories) ? DATA.accessories.filter(p => p && typeof p === "object") : [];
  render();
});
