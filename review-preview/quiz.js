/* =========================================================================
   吉他推薦系統
   資料來源：Google Sheet（三個分頁：吉他標籤 / 題目 / 標籤設定）
   沒設定網址時，改用檔案底部的內建示範資料。
   ========================================================================= */

const URL_PARAMS = new URLSearchParams(location.search);
const DEBUG = URL_PARAMS.has("debug");
const PREVIEW = URL_PARAMS.has("preview") || DEBUG;
const CFG = window.QUIZ_CONFIG || { sheetUrl: "", sheets: {} };

let GUITARS = [];     // [{name, tags:{維度:[標籤]}}]
let QUESTIONS = [];   // [{id, title, multi, options:[{text, tags, weight, price}]}]
let TAGDEF = {};      // 標籤 -> {dim, note}
let PRODUCTS = [];    // 網站商品（含圖片、價格）
let BY_NAME = {};     // 正規化後的商品名稱 -> 商品
let USING_DEMO = true;
const WARN = [];      // 檢查模式要顯示的問題

/* ===================== 小工具 ===================== */

function splitTags(s){
  return String(s || "").split(/[,，、]/).map(x => x.trim()).filter(Boolean);
}

/* 名稱比對用：去掉空白、全形括號逗號驚嘆號統一成半形 */
function normName(s){
  return String(s || "")
    .replace(/\s+/g, "")
    .replace(/（/g, "(").replace(/）/g, ")")
    .replace(/，/g, ",").replace(/！/g, "!")
    .replace(/：/g, ":")
    .toLowerCase();
}

function esc(s){
  return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}

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

/* 逗號分隔檔解析（處理引號包住的欄位與換行） */
function parseCSV(text){
  const rows = [];
  let row = [], cur = "", inQuote = false;
  for(let i = 0; i < text.length; i++){
    const c = text[i];
    if(inQuote){
      if(c === '"'){
        if(text[i + 1] === '"'){ cur += '"'; i++; }
        else inQuote = false;
      }else cur += c;
    }else{
      if(c === '"') inQuote = true;
      else if(c === ','){ row.push(cur); cur = ""; }
      else if(c === '\n'){ row.push(cur); rows.push(row); row = []; cur = ""; }
      else if(c !== '\r') cur += c;
    }
  }
  if(cur !== "" || row.length){ row.push(cur); rows.push(row); }
  return rows;
}

/* ===================== 讀 Google Sheet ===================== */

function sheetIdOf(url){
  const m = /\/spreadsheets\/d\/([a-zA-Z0-9\-_]+)/.exec(String(url || ""));
  return m ? m[1] : "";
}

async function fetchSheet(id, tabName){
  const url = "https://docs.google.com/spreadsheets/d/" + id +
              "/gviz/tq?tqx=out:csv&sheet=" + encodeURIComponent(tabName) +
              "&_=" + Date.now();                    // 擋快取
  const res = await fetch(url);
  if(!res.ok) throw new Error("分頁「" + tabName + "」讀取失敗（HTTP " + res.status + "）");
  const text = await res.text();
  if(/^\s*</.test(text)) throw new Error("分頁「" + tabName + "」讀到的不是資料，多半是試算表沒開放檢視權限");
  return parseCSV(text);
}

/* ===================== 三個分頁的解析 ===================== */

/* 吉他標籤：第一欄是吉他名稱，其餘每一欄是一個維度（「備註」開頭的欄不算） */
function parseGuitars(rows){
  if(!rows.length) return { dims: [], guitars: [] };
  const head = rows[0].map(s => String(s || "").trim());
  const dimCols = [];
  for(let i = 1; i < head.length; i++){
    if(head[i] && !/^備註/.test(head[i])) dimCols.push({ i, name: head[i] });
  }
  const guitars = [];
  for(const r of rows.slice(1)){
    const name = String(r[0] || "").trim();
    if(!name) continue;
    if(name.startsWith("（範例）") || name.startsWith("【")) continue;   // 範例列 / 說明列
    const tags = {};
    for(const c of dimCols){
      const list = splitTags(r[c.i]);
      if(list.length) tags[c.name] = list;
    }
    guitars.push({ name, tags });
  }
  return { dims: dimCols.map(c => c.name), guitars };
}

/* 題目：A題號 B題目 C選項文字 D對應標籤 E權重 F可複選 G選項圖片（一列一個選項） */
function parseQuestions(rows){
  const out = [];
  let cur = null;
  for(const r of rows.slice(1)){
    const id = String(r[0] || "").trim();
    if(!/^\d+$/.test(id)) continue;                  // 空列與說明列自動略過
    const optText = String(r[2] || "").trim();
    if(!optText) continue;
    const title  = String(r[1] || "").trim();
    const parsedWeight = parseFloat(r[4]);
    const weight = Number.isFinite(parsedWeight) && parsedWeight >= 0 ? parsedWeight : 1;
    const multi  = /^(是|y|yes|true|1|v|✓)$/i.test(String(r[5] || "").trim());

    if(!cur || cur.id !== id){
      cur = { id, title, multi, options: [] };
      out.push(cur);
    }
    if(title && !cur.title) cur.title = title;
    if(multi) cur.multi = true;

    // __PRICE__:最低-最高 是硬性價格篩選，不是標籤
    let price = null;
    const tags = [];
    for(const t of splitTags(r[3])){
      const m = /^__PRICE__\s*:\s*(\d+)\s*-\s*(\d+)$/i.exec(t);
      if(m) price = { min: +m[1], max: +m[2] };
      else tags.push(t);
    }
    cur.options.push({ text: optText, tags, weight, price, img: String(r[6] || "").trim() });
  }
  return out.filter(q => q.options.length);
}

/* 標籤設定：A維度 B標籤 C說明 */
function parseTagDefs(rows){
  const defs = {};
  for(const r of rows.slice(1)){
    const dim = String(r[0] || "").trim();
    const tag = String(r[1] || "").trim();
    if(!dim || !tag || dim.startsWith("【")) continue;
    defs[tag] = { dim, note: String(r[2] || "").trim() };
  }
  return defs;
}

/* ===================== 選項圖片 ===================== */

/* Google 雲端硬碟的分享連結不能直接當圖片，轉成可以直接顯示的網址 */
function driveDirect(u){
  const m = /drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]{20,})/.exec(u);
  return m ? "https://lh3.googleusercontent.com/d/" + m[1] : u;
}

/* Sheet 的「選項圖片」欄可以填三種東西：
   1. 商品名稱      → 直接用那把吉他的第一張照片（最方便，不用另外準備圖）
   2. 檔案路徑      → images/xxx.jpg（放在網站資料夾裡）
   3. 圖片網址      → https://...（Google 雲端硬碟連結會自動轉換） */
function optionImage(raw){
  const s = String(raw || "").trim();
  if(!s) return "";
  if(/^https?:\/\//i.test(s)) return safeImageSource(driveDirect(s));
  const p = BY_NAME[normName(s)];
  if(p && p.imgs && p.imgs[0]) return safeImageSource(p.imgs[0]);
  return safeImageSource(s);                  // 當成檔案路徑
}

/* ===================== 網站商品（圖片／價格／介紹） ===================== */

function imgsOf(p){
  if(Array.isArray(p.imgs)) return p.imgs.filter(s => typeof s === "string" && s.trim());
  if(typeof p.img === "string" && p.img.trim()) return [p.img];
  return [];
}

async function loadProducts(){
  let data = null;
  if(PREVIEW && window.GDB){
    try{ data = await GDB.getDraft(); }catch(e){}
  }
  if(PREVIEW && !data){
    try{
      const backup = localStorage.getItem("storeDataBackup");
      if(backup) data = JSON.parse(backup);
    }catch(e){}
  }
  if(!data) data = window.STORE_DATA || {};

  const list = [];
  for(const cat of ["acoustic", "electric"]){
    const products = Array.isArray(data && data[cat]) ? data[cat] : [];
    for(const p of products){
      if(p && typeof p === "object") list.push({ ...p, cat });
    }
  }
  // 圖片編號換成看得到的網址
  const cache = {};
  for(const p of list){
    const out = [];
    for(const ref of imgsOf(p)){
      if(typeof ref === "string" && ref.indexOf("img_") === 0){
        if(!(ref in cache)){
          let u = "";
          try{
            if(PREVIEW && window.GDB){
              const b = await GDB.getImage(ref);
              if(b) u = URL.createObjectURL(b);
            }
          }catch(e){}
          cache[ref] = u;
        }
        out.push(cache[ref] || ("images/" + ref + ".jpg"));
      }else{
        const safe = safeImageSource(ref);
        if(safe) out.push(safe);
      }
    }
    p.imgs = out;
  }
  return list;
}

/* ===================== 組資料 ===================== */

async function loadAll(){
  const id = sheetIdOf(CFG.sheetUrl);
  const tabs = CFG.sheets || {};
  if(id){
    const [g, q, t] = await Promise.all([
      fetchSheet(id, tabs.guitars   || "吉他標籤"),
      fetchSheet(id, tabs.questions || "題目"),
      fetchSheet(id, tabs.tags      || "標籤設定")
    ]);
    GUITARS   = parseGuitars(g).guitars;
    QUESTIONS = parseQuestions(q);
    TAGDEF    = parseTagDefs(t);
    USING_DEMO = false;
  }else{
    GUITARS   = parseGuitars(DEMO.guitars).guitars;
    QUESTIONS = parseQuestions(DEMO.questions);
    TAGDEF    = parseTagDefs(DEMO.tags);
    USING_DEMO = true;
  }

  PRODUCTS = await loadProducts();

  // 把 Sheet 裡的吉他對到網站商品
  BY_NAME = {};
  for(const p of PRODUCTS) BY_NAME[normName(p.name)] = p;
  for(const g of GUITARS){
    g.product = BY_NAME[normName(g.name)] || null;
    if(!g.product) WARN.push("吉他標籤分頁的「" + g.name + "」在網站商品裡找不到同名商品");
  }
  const tagged = new Set(GUITARS.map(g => normName(g.name)));
  for(const p of PRODUCTS){
    if(!p.sold && !tagged.has(normName(p.name)))
      WARN.push("網站商品「" + p.name + "」還沒在 Sheet 裡填標籤，不會被推薦");
  }
  // 標籤錯字檢查
  const used = new Set();
  for(const g of GUITARS) for(const d in g.tags) g.tags[d].forEach(t => used.add(t));
  for(const q of QUESTIONS) for(const o of q.options) o.tags.forEach(t => used.add(t));
  for(const t of used) if(!TAGDEF[t]) WARN.push("標籤「" + t + "」沒有定義在「標籤設定」分頁");
  // 選項圖片檢查
  for(const q of QUESTIONS){
    for(const o of q.options){
      if(!o.img || /^https?:\/\//i.test(o.img)) continue;
      if(BY_NAME[normName(o.img)]) continue;
      if(!/\.(jpe?g|png|webp|gif|avif)$/i.test(o.img))
        WARN.push("選項「" + o.text + "」的圖片欄填的是「" + o.img +
                  "」，既不是商品名稱、也不是圖檔路徑或網址");
    }
  }
}

/* ===================== 計分 ===================== */

/* answers: { 題號: [選項index, ...] }
   規則很單純：客戶每題選到的標籤蒐集起來，哪把吉他命中最多就推薦哪把。 */
function score(answers){
  /* 一個「條件」＝客戶勾的一個選項。
     選項裡若填了多個標籤（例如「面單, 全單」），彼此是「或」，命中任一就算符合。 */
  const wants = [];
  let priceRange = null;

  for(const q of QUESTIONS){
    for(const idx of (answers[q.id] || [])){
      const o = q.options[idx];
      if(!o) continue;
      if(o.price) priceRange = o.price;
      if(!o.tags.length) continue;                    // 像「沒有特別限制」這種不算條件
      wants.push({
        tags: o.tags,
        label: o.tags.join(" 或 "),
        note: (TAGDEF[o.tags[0]] || {}).note || "",
        weight: o.weight
      });
    }
  }
  const totalW = wants.reduce((s, w) => s + w.weight, 0);

  const rows = [];
  for(const g of GUITARS){
    const p = g.product;
    if(!p || p.sold) continue;                        // 沒對到商品、已售出 → 不推薦
    const all = [];
    for(const d in g.tags) all.push(...g.tags[d]);

    const hits = wants.map(w => w.tags.some(t => all.includes(t)));
    const hitW = wants.reduce((s, w, i) => s + (hits[i] ? w.weight : 0), 0);
    const matchedTags = [];
    wants.forEach((w, i) => {
      if(hits[i]) w.tags.forEach(t => { if(all.includes(t) && !matchedTags.includes(t)) matchedTags.push(t); });
    });
    const inBudget = !priceRange ||
      (Number(p.price || 0) >= priceRange.min && Number(p.price || 0) <= priceRange.max);

    rows.push({
      g, p, hits, inBudget,
      matched: matchedTags,
      hit: hits.filter(Boolean).length,
      total: wants.length,
      pct: totalW ? hitW / totalW : 0
    });
  }

  // 預算內優先 → 命中多的優先 → 同分則便宜的優先
  rows.sort((a, b) => (b.inBudget - a.inBudget) || (b.pct - a.pct) ||
                       (Number(a.p.price || 0) - Number(b.p.price || 0)));

  return { rows, wants, priceRange };
}

/* ===================== 畫面 ===================== */

const app = document.getElementById("quizApp");
let answers = {}, step = 0;
app.addEventListener("error", e=>{
  const img = e.target;
  if(!(img instanceof HTMLImageElement) || !img.dataset.quizImg) return;
  if(img.dataset.quizImg === "option"){
    const wrap = img.closest(".qz-opt-img");
    if(wrap) wrap.classList.add("fail");
  }else{
    img.style.display = "none";
  }
}, true);

function renderIntro(){
  step = 0; answers = {};
  app.innerHTML =
    '<section class="qz-intro">' +
      '<p class="qz-kicker">Unlimit 選琴測驗</p>' +
      '<h1>找到屬於你的那一把</h1>' +
      '<p class="qz-lead">回答 ' + QUESTIONS.length + ' 個問題，我們幫你從店裡現有的吉他中，' +
        '挑出符合最多條件的那一把，並告訴你它符合了你的哪些需求。</p>' +
      '<button class="qz-btn qz-btn-main" id="startBtn">開始測驗</button>' +
      '<p class="qz-mini">大約 1 分鐘</p>' +
    '</section>';
  document.getElementById("startBtn").onclick = () => { step = 1; renderStep(); };
}

function renderStep(){
  const q = QUESTIONS[step - 1];
  if(!q) return renderResult();
  const picked = answers[q.id] || [];

  // 只要這題有任何一個選項填了圖片，整題就改用圖片卡排版
  const imgs = q.options.map(o => optionImage(o.img));
  const hasImg = imgs.some(Boolean);

  app.innerHTML =
    '<section class="qz-step">' +
      '<div class="qz-progress"><i style="width:' + (step / QUESTIONS.length * 100) + '%"></i></div>' +
      '<p class="qz-count">第 ' + step + ' 題 / 共 ' + QUESTIONS.length + ' 題</p>' +
      '<h2>' + esc(q.title || "（這一題還沒填題目）") + '</h2>' +
      (q.multi ? '<p class="qz-mini">可以選多個</p>' : '') +
      '<div class="qz-opts' + (hasImg ? ' has-img' : '') + '">' +
        q.options.map((o, i) =>
          '<button class="qz-opt' + (hasImg ? ' img' : '') + (picked.includes(i) ? ' on' : '') +
            '" data-i="' + i + '">' +
            (hasImg
              ? '<span class="qz-opt-img">' +
                  (imgs[i]
                    ? '<img data-quiz-img="option" src="' + esc(imgs[i]) + '" alt="">' // 選項一定在畫面上，不延後載入
                    : '') +
                '</span>'
              : '') +
            '<span class="qz-opt-txt">' + esc(o.text) + '</span>' +
          '</button>').join("") +
      '</div>' +
      '<div class="qz-nav">' +
        (step > 1 ? '<button class="qz-btn qz-btn-ghost" id="prevBtn">上一題</button>' : '<span></span>') +
        (q.multi ? '<button class="qz-btn qz-btn-main" id="nextBtn">下一題</button>' : '<span></span>') +
      '</div>' +
    '</section>';

  app.querySelectorAll(".qz-opt").forEach(b => {
    b.onclick = () => {
      const i = +b.dataset.i;
      const cur = answers[q.id] || [];
      if(q.multi){
        answers[q.id] = cur.includes(i) ? cur.filter(x => x !== i) : cur.concat(i);
        b.classList.toggle("on");
      }else{
        answers[q.id] = [i];
        step++; renderStep(); window.scrollTo({ top: 0 });
      }
    };
  });
  const nb = document.getElementById("nextBtn");
  if(nb) nb.onclick = () => { step++; renderStep(); window.scrollTo({ top: 0 }); };
  const pb = document.getElementById("prevBtn");
  if(pb) pb.onclick = () => { step--; renderStep(); window.scrollTo({ top: 0 }); };
}

function cardHTML(r, big){
  const p = r.p;
  const productImg = p.imgs && p.imgs[0] ? safeImageSource(p.imgs[0]) : "";
  // 主推那張是第一眼就要看到的，不能延後載入
  const img = productImg
    ? '<img data-quiz-img="card" src="' + esc(productImg) + '" alt="' + esc(p.name) + '"' +
      (big ? ' fetchpriority="high"' : ' loading="lazy"') +
      '>'
    : '<span class="qz-noimg">🎸</span>';
  return '<article class="qz-card' + (big ? ' big' : '') + '">' +
    '<div class="qz-card-img">' + img +
      (big ? '<span class="qz-fit">' + r.hit + '<small>/ ' + r.total + ' 項</small></span>' : '') +
    '</div>' +
    '<div class="qz-card-body">' +
      (p.brand ? '<span class="qz-brand">' + esc(p.brand) + '</span>' : '') +
      '<h3>' + esc(p.name) + '</h3>' +
      '<p class="qz-price">NT$' + Number(p.price || 0).toLocaleString() + '</p>' +
      (big ? '' : '<p class="qz-fit-mini">符合 ' + r.hit + ' / ' + r.total + ' 項</p>') +
      (r.matched.length
        ? '<p class="qz-tags">' +
            (big ? r.matched : r.matched.slice(0, 3)).map(t => '<span>' + esc(t) + '</span>').join("") +
            (!big && r.matched.length > 3 ? '<span>+' + (r.matched.length - 3) + '</span>' : '') +
          '</p>'
        : '') +
      (big && p.desc ? '<p class="qz-desc">' + esc(p.desc) + '</p>' : '') +
      (big && !r.inBudget ? '<p class="qz-note">※ 這把超出你選的預算，但它是條件最合的一把</p>' : '') +
    '</div></article>';
}

function renderResult(){
  const s = score(answers);
  const top = s.rows[0];

  let html = '<section class="qz-result">';

  if(!top){
    html += '<h2>目前沒有可以推薦的吉他</h2>' +
      '<p class="qz-lead">可能是標籤還沒填，或是符合條件的琴剛好都售出了。' +
      '直接私訊我們，我們幫你找。</p>';
  }else{
    html += '<p class="qz-kicker">最適合你的是</p>' + cardHTML(top, true);

    if(s.wants.length){
      html += '<div class="qz-checklist"><h3>你的條件對照</h3>' +
        '<p class="qz-mini">你總共選出 ' + s.wants.length + ' 個條件，這把吉他符合其中 ' + top.hit + ' 項。</p>' +
        s.wants.map((w, i) => {
          const on = top.hits[i];
          return '<div class="qz-check' + (on ? " on" : "") + '">' +
            '<span class="qz-check-mark">' + (on ? "✓" : "—") + '</span>' +
            '<span class="qz-check-tag">' + esc(w.label) + '</span>' +
            (w.note ? '<span class="qz-check-note">' + esc(w.note) + '</span>' : '') +
          '</div>';
        }).join("") + '</div>';
    }

    const others = s.rows.slice(1, 3);
    if(others.length){
      html += '<div class="qz-others"><h3>這幾把你也會喜歡</h3>' +
        '<div class="qz-others-grid">' + others.map(r => cardHTML(r, false)).join("") + '</div></div>';
    }
  }

  html +=
    '<div class="qz-actions">' +
      '<button class="qz-btn qz-btn-main" id="againBtn">再測一次</button>' +
      '<a class="qz-btn qz-btn-ghost" href="index.html">看全部吉他</a>' +
      '<a class="qz-btn qz-btn-ig" href="https://www.instagram.com/unlimitguitar_tw/" target="_blank" rel="noopener">私訊我們</a>' +
    '</div></section>';

  app.innerHTML = html;
  document.getElementById("againBtn").onclick = () => { renderIntro(); window.scrollTo({ top: 0 }); };
  window.scrollTo({ top: 0 });
}

/* 示範資料提示 + 檢查模式 */
function renderBanners(){
  const box = document.getElementById("quizBanner");
  let h = "";
  if(USING_DEMO){
    h += '<div class="qz-banner warn">⚠️ 還沒接上 Google Sheet，目前用的是<b>內建的預設標籤</b>' +
         '（從商品介紹的規格欄抽出來的，音色欄是推測值）。新增商品後不會自動更新——' +
         '把試算表網址填進 <code>quiz-config.js</code> 才會改讀你的 Sheet。</div>';
  }
  if(DEBUG && WARN.length){
    h += '<div class="qz-banner check"><b>檢查模式：發現 ' + WARN.length + ' 個問題</b><ul>' +
         WARN.map(w => '<li>' + esc(w) + '</li>').join("") + '</ul></div>';
  }else if(DEBUG){
    h += '<div class="qz-banner ok">檢查模式：沒發現問題，' + GUITARS.length + ' 把吉他、' +
         QUESTIONS.length + ' 題、' + Object.keys(TAGDEF).length + ' 個標籤都對得起來。</div>';
  }
  box.innerHTML = h;
}

/* =========================================================================
   內建示範資料（沒設定 Google Sheet 時使用）
   格式跟 Sheet 完全一樣，所以走的是同一套解析程式。
   ========================================================================= */
const DEMO = {
  guitars: [
    ["吉他名稱", "面板材質", "側背板", "漆面", "顏色", "尺寸", "體型", "音色", "用途", "適合對象", "特色", "備註（不影響推薦）"],
    ["95號面單(原價$7480，出清價只要$3500！)", "桃花心木單板", "桃花心木", "霧面", "粉色", "34吋", "旅行尺寸", "溫暖厚實", "", "", "", "※已售出，不會被推薦"],
    ["104號面單(原價$7480，出清價只要$3500！)", "雲杉單板", "桃花心木", "消光", "原木色", "39吋", "標準尺寸", "明亮清脆", "", "", "", ""],
    ["G1A：寒梅", "", "桃花心木", "亮光", "原木色", "", "", "", "", "", "", "介紹裡沒寫「面板材質、尺寸、體型」，請補填"],
    ["93號面單(原價$7480，出清價只要$3500！)", "雲杉單板", "桃花心木", "亮光", "原木色", "38吋", "標準尺寸", "明亮清脆", "", "", "", ""],
    ["100號面單(原價$7480，出清價只要$3500！)", "桃花心木單板", "桃花心木", "亮光", "黑色", "36吋", "旅行尺寸", "溫暖厚實", "", "", "", ""],
    ["96號面單(原價$7480，出清價只要$3300！)", "桃花心木單板", "桃花心木", "消光", "黑色", "34吋", "旅行尺寸", "溫暖厚實", "", "", "", ""],
    ["106號面單(原價$7480，出清價只要$3500！)", "雲杉單板", "桃花心木", "消光", "黑色", "40吋", "標準尺寸", "明亮清脆", "", "", "", ""],
    ["107號面單(原價$7480，出清價只要$3500！)", "雲杉單板", "玫瑰木", "亮光", "原木色", "40吋", "標準尺寸", "明亮清脆", "", "", "", ""],
    ["103號面單(原價$7480，出清價只要$3500！)", "雲杉單板", "桃花心木", "亮光", "粉色", "36吋", "旅行尺寸", "明亮清脆", "", "", "", ""],
    ["102號面單(原價$7480，出清價只要$3500！)", "桃花心木單板", "桃花心木", "亮光", "原木色", "40吋", "標準尺寸", "溫暖厚實", "", "", "", ""],
    ["97號面單(原價$11980，出清價只要$4480！)", "虎紋楓木單板", "虎紋楓木", "消光", "藍色", "40吋", "標準尺寸", "明亮清脆", "", "", "", ""]
  ],
  questions: [
    ["題號", "題目", "選項文字", "這個選項加分的標籤", "權重", "可複選", "選項圖片（選填）"],
    [1, "你喜歡的音色偏向？", "溫暖、厚實，低音飽滿", "溫暖厚實", "2", "", ""],
    [1, "", "明亮、清脆，顆粒感強", "明亮清脆", "2", "", ""],
    [2, "你喜歡哪種外觀？", "原木色，看得到木頭紋路", "原木色", "", "", "104號面單(原價$7480，出清價只要$3500！)"],
    [2, "", "黑色，低調有質感", "黑色", "", "", "100號面單(原價$7480，出清價只要$3500！)"],
    [2, "", "粉色，甜甜的", "粉色", "", "", "103號面單(原價$7480，出清價只要$3500！)"],
    [2, "", "藍色，特別一點", "藍色", "", "", "97號面單(原價$11980，出清價只要$4480！)"],
    [3, "漆面的質感呢？", "亮光，有光澤看起來精緻", "亮光", "", "", "G1A：寒梅"],
    [3, "", "消光，霧霧的不留指紋", "消光, 霧面", "", "", "104號面單(原價$7480，出清價只要$3500！)"],
    [4, "你會常常帶著它出門嗎？", "會，越輕巧越好", "旅行尺寸", "", "", "100號面單(原價$7480，出清價只要$3500！)"],
    [4, "", "主要在家彈，音量大一點好", "標準尺寸", "", "", "104號面單(原價$7480，出清價只要$3500！)"],
    [5, "你的預算大概是？", "5000 以下", "__PRICE__:0-5000", "", "", ""],
    [5, "", "5000～10000", "__PRICE__:5000-10000", "", "", ""],
    [5, "", "10000 以上", "__PRICE__:10000-999999", "", "", ""],
    [5, "", "沒有特別限制", "", "", "", ""],
    [6, "對木材有偏好嗎？（可複選）", "雲杉單板，聲音open、動態大", "雲杉單板", "", "是", ""],
    [6, "", "桃花心木單板，中頻厚、耐聽", "桃花心木單板", "", "是", ""],
    [6, "", "虎紋楓木，紋路漂亮", "虎紋楓木單板, 虎紋楓木", "", "是", ""],
    [6, "", "玫瑰木側背板，低音更沉", "玫瑰木", "", "是", ""]
  ],
  tags: [
    ["維度", "標籤", "結果頁說明（選填）"],
    ["面板材質", "雲杉單板", "聲音 open、動態大，彈久了會越開聲"],
    ["面板材質", "桃花心木單板", "中頻飽滿、溫暖耐聽"],
    ["面板材質", "虎紋楓木單板", "音色乾淨明亮，紋路漂亮"],
    ["側背板", "桃花心木", "溫暖的中頻底子"],
    ["側背板", "玫瑰木", "低音更沉、泛音豐富"],
    ["側背板", "虎紋楓木", "音色清晰、外觀搶眼"],
    ["漆面", "亮光", "光澤感強，看起來精緻"],
    ["漆面", "消光", "霧面低調，不容易留指紋"],
    ["漆面", "霧面", "手感細膩不黏手"],
    ["顏色", "原木色", "保留木頭原本的樣子"],
    ["顏色", "黑色", "低調百搭，怎麼拍都好看"],
    ["顏色", "粉色", "甜甜的，很好認"],
    ["顏色", "藍色", "少見的顏色，很有個性"],
    ["尺寸", "34吋", "旅行尺寸，最好帶出門"],
    ["尺寸", "36吋", "小巧好抱，手小也沒問題"],
    ["尺寸", "38吋", "介於旅行與標準之間"],
    ["尺寸", "39吋", "接近標準桶的音量"],
    ["尺寸", "40吋", "標準尺寸，共鳴最完整"],
    ["體型", "旅行尺寸", "34～36吋，輕便好帶"],
    ["體型", "標準尺寸", "38吋以上，音量與共鳴最完整"],
    ["音色", "溫暖厚實", "低音飽滿，適合自彈自唱"],
    ["音色", "明亮清脆", "高音顆粒清楚，適合指彈"],
    ["音色", "均衡", "各頻段平均，什麼都能彈"],
    ["用途", "刷唱", "刷和弦、自彈自唱"],
    ["用途", "指彈", "指彈演奏曲"],
    ["適合對象", "新手", "好按好上手，入門首選"],
    ["適合對象", "進階", "細節表現更好，給有經驗的你"],
    ["特色", "缺角", "高把位好按，方便獨奏"],
    ["特色", "電木", "可以插電，表演用得上"]
  ]
};


/* ===================== 啟動（要放在 DEMO 之後） ===================== */

(async function(){
  // 總開關沒打開時，客戶只看得到「準備中」；自己預覽請加 ?preview=1
  if(!CFG.live && !PREVIEW){
    app.innerHTML =
      '<section class="qz-intro">' +
        '<p class="qz-kicker">Unlimit 選琴測驗</p>' +
        '<h1>準備中</h1>' +
        '<p class="qz-lead">這個功能還在整理，很快就會開放。' +
          '想找吉他的話，先看看店裡現有的琴，或直接私訊我們，我們幫你挑。</p>' +
        '<div class="qz-actions">' +
          '<a class="qz-btn qz-btn-main" href="index.html">看全部吉他</a>' +
          '<a class="qz-btn qz-btn-ig" href="https://www.instagram.com/unlimitguitar_tw/" target="_blank" rel="noopener">私訊我們</a>' +
        '</div>' +
      '</section>';
    return;
  }
  try{
    await loadAll();
    if(!QUESTIONS.length){
      app.innerHTML = '<section class="qz-intro"><h1>還沒有題目</h1>' +
        '<p class="qz-lead">請到 Google Sheet 的「題目」分頁把題目填好。</p></section>';
    }else{
      renderIntro();
    }
  }catch(err){
    app.innerHTML = '<section class="qz-intro"><h1>讀不到資料</h1>' +
      '<p class="qz-lead">' + esc(err.message || err) + '</p>' +
      '<p class="qz-mini">請確認 quiz-config.js 的網址正確，而且試算表已設成「知道連結的任何人可檢視」。</p></section>';
  }
  renderBanners();
})();
