/* 客戶評價 UI。正式模式必須連線共享服務；本機測試資料不會公開。 */
"use strict";
window.CustomerReviews = (()=>{
  const config = window.REVIEWS_CONFIG || {};
  const local = ["localhost", "127.0.0.1"].includes(location.hostname);
  const demo = local && new URLSearchParams(location.search).get("review-demo") === "1";
  const DEMO_KEY = "unlimit-reviews-demo-v1";
  const OWNER_KEY = "unlimit-review-delete-keys-v1";
  let root, list, summary, notice, more, formDialog, requestNumber = 0;
  let filter = { stars:0, photos:false, product:"", sort:"newest", offset:0 };
  let catalog = [], draftPhotos = [], photoBusy = false, submitting = false;
  let items = [];
  let adminToken = "";

  function el(tag, cls, text){
    const node = document.createElement(tag);
    if(cls) node.className = cls;
    if(text !== undefined) node.textContent = text;
    return node;
  }
  function button(text, cls, action){
    const node = el("button", cls, text); node.type = "button";
    node.addEventListener("click", action); return node;
  }
  function readJSON(key, fallback){
    try{ return JSON.parse(localStorage.getItem(key) || "null") || fallback; }
    catch{ return fallback; }
  }
  function ownerKeys(){ return readJSON(OWNER_KEY, {}); }
  function stars(value){
    const node = el("span", "review-stars", "★".repeat(value) + "☆".repeat(5-value));
    node.setAttribute("aria-label", value + " 顆星，滿分 5 星"); return node;
  }
  function imageSource(value){
    if(typeof value !== "string") return "";
    if(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value)) return value;
    try{ const url = new URL(value); return url.protocol === "https:" ? url.href : ""; }
    catch{ return ""; }
  }
  async function request(path, body){
    if(!config.apiBase) throw new Error("評價服務尚未開放，請稍後再試。");
    const base = new URL(config.apiBase);
    if(base.protocol !== "https:" && !(local && base.hostname === location.hostname)) throw new Error("評價服務設定錯誤");
    const response = await fetch(base.href.replace(/\/$/, "") + path, {
      method:body ? "POST" : "GET",
      headers:{...(body ? {"Content-Type":"application/json"} : {}), ...(adminToken ? {Authorization:"Bearer "+adminToken} : {})},
      body:body ? JSON.stringify(body) : undefined,
      cache:"no-store", signal:AbortSignal.timeout(20000)
    });
    const data = await response.json();
    if(!response.ok) throw new Error(data.message || "評價服務暫時無法使用，請稍後再試。");
    return data;
  }
  function demoList(){
    const records = readJSON(DEMO_KEY, []);
    const all = records.filter(r=>!r.hiddenFromList);
    let selected = records.filter(r=>(filter.nickname ? r.nickname===filter.nickname : !r.hiddenFromList) && (!filter.stars || r.rating === filter.stars) &&
      (!filter.photos || r.photos.length) && (!filter.product || r.product === filter.product));
    selected.sort((a,b)=>filter.sort === "highest" ? b.rating-a.rating :
      filter.sort === "lowest" ? a.rating-b.rating : b.createdAt.localeCompare(a.createdAt));
    return { items:selected.slice(filter.offset, filter.offset+20), total:selected.length,
      summary:{ count:all.length, average:all.length ? all.reduce((s,r)=>s+r.rating,0)/all.length : 0,
        photoCount:all.filter(r=>r.photos.length).length } };
  }
  async function refresh(append=false){
    const serial = ++requestNumber;
    if(!append) filter.offset = 0;
    notice.textContent = "正在讀取評價…";
    notice.classList.remove("review-error");
    more.disabled = true;
    try{
      const data = demo ? demoList() : await request("/reviews?" + new URLSearchParams(filter));
      if(serial !== requestNumber || !root.isConnected) return;
      items = append ? [...items, ...data.items] : data.items;
      summary.replaceChildren();
      const score = el("div", "review-score", data.summary.count ? Number(data.summary.average).toFixed(1) : "—");
      score.append(el("small", "", " / 5"));
      const info = el("div");
      if(data.summary.count) info.append(stars(Math.round(data.summary.average)));
      info.append(el("p", "review-muted", data.summary.count + (demo ? " 則測試評價（不計入公開評分）" : " 則評價")));
      summary.append(score, info);
      list.replaceChildren();
      if(!items.length) list.append(el("p", "review-empty", filter.nickname ? "找不到此完整暱稱的評價。" : data.summary.count ? "目前沒有符合條件的評價。" : "還沒有評價，歡迎分享你的使用心得。"));
      items.forEach(renderCard);
      more.hidden = items.length >= data.total;
      notice.textContent = "";
    }catch(error){
      if(serial !== requestNumber || !root.isConnected) return;
      notice.textContent = error.message;
      notice.classList.add("review-error");
    }finally{ more.disabled = false; }
  }
  function renderCard(review){
    const card = el("article", "review-card");
    const head = el("div", "review-card-head");
    head.append(el("span", "review-avatar", (review.nickname || "訪客").slice(0,1)),
      el("span", "review-nickname", review.nickname || "訪客"));
    card.append(head, stars(review.rating));
    if(review.hiddenFromList)card.append(el("p","review-muted","此評價僅透過完整暱稱查詢顯示，不計入公開評分。"));
    if(review.product) card.append(el("p", "review-product", "商品：" + review.product));
    if(review.text) card.append(el("p", "review-text", review.text));
    const photos = el("div", "review-photos");
    (review.photos || []).forEach((source, index)=>{
      const src = imageSource(source); if(!src) return;
      const open = button("", "review-photo", ()=>openPhoto(src));
      open.setAttribute("aria-label", "放大評價照片 " + (index+1));
      const img = el("img"); img.src = src; img.alt = "評價照片 " + (index+1); img.loading = "lazy";
      open.append(img); photos.append(open);
    });
    if(photos.childElementCount) card.append(photos);
    const footer = el("div", "review-footer");
    footer.append(el("time", "review-muted", new Date(review.createdAt).toLocaleDateString("zh-TW")));
    if(demo || adminToken || ownerKeys()[review.id]) footer.append(button("刪除評價", "review-delete", async()=>{
      if(!confirm("確定要刪除這則評價嗎？")) return;
      try{
        if(demo) localStorage.setItem(DEMO_KEY, JSON.stringify(readJSON(DEMO_KEY, []).filter(r=>r.id !== review.id)));
        else await request("/reviews/" + encodeURIComponent(review.id) + "/delete", {deleteKey:ownerKeys()[review.id]});
        await refresh();
      }catch(error){ notice.textContent = error.message; }
    }));
    card.append(footer); list.append(card);
  }
  function openPhoto(src){
    const dialog = el("dialog", "review-dialog review-lightbox");
    const close = button("關閉照片 ×", "review-close", ()=>dialog.close());
    const img = el("img"); img.src = src; img.alt = "評價照片";
    dialog.append(close, img); document.body.append(dialog);
    dialog.addEventListener("close", ()=>dialog.remove(), {once:true}); dialog.showModal();
  }
  async function photoToJpeg(file){
    const url = URL.createObjectURL(file);
    try{
      const image = new Image(); image.src = url; await image.decode();
      const ratio = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(image.naturalWidth*ratio); canvas.height = Math.round(image.naturalHeight*ratio);
      canvas.getContext("2d").drawImage(image,0,0,canvas.width,canvas.height);
      return canvas.toDataURL("image/jpeg",0.84);
    }finally{ URL.revokeObjectURL(url); }
  }
  function openForm(){
    if(formDialog?.open) return;
    draftPhotos = [];
    const submissionId=crypto.randomUUID();
    const submissionKey=crypto.randomUUID()+crypto.randomUUID();
    formDialog = el("dialog", "review-dialog");
    formDialog.setAttribute("aria-label", "新增評價");
    const head = el("div", "review-dialog-head");
    head.append(el("h2", "", demo ? "新增測試評價" : "新增評價"), button("×", "review-close", ()=>{ if(!submitting && !photoBusy) formDialog.close(); }));
    const form = el("form", "review-form");
    function field(title, input, optional=true){
      const label = el("label", "review-field", title);
      if(optional) label.append(el("small", "", "選填"));
      label.append(input); form.append(label); return input;
    }
    const nickname = el("input"); nickname.placeholder = "自訂暱稱，留空顯示「訪客」"; nickname.maxLength = 40;
    field("暱稱", nickname);
    const product = el("select"); product.append(new Option("選擇商品（選填）", ""));
    catalog.forEach(name=>product.append(new Option(name,name))); field("評價的商品",product);
    const rating = el("fieldset", "review-rating"); rating.append(el("legend", "", "你的評分"));
    const options = el("div", "review-star-options");
    for(let n=1;n<=5;n++){
      const label = el("label", "review-star-option", "★");
      const input = el("input"); input.type="radio"; input.name="rating"; input.value=String(n); input.required=true;
      input.setAttribute("aria-label", n + " 顆星");
      input.addEventListener("change",()=>[...options.children].forEach((node,i)=>node.classList.toggle("is-filled",i<n)));
      label.append(input); options.append(label);
    }
    rating.append(options); form.append(rating);
    const content = el("textarea"); content.maxLength=10000; content.placeholder="分享你的使用感受，也可以只留下星等。";
    field("評價內容",content);
    const uploadWrap = el("div", "review-field", "照片"); uploadWrap.append(el("small","","選填"));
    const uploadLabel = el("label", "review-upload", "＋ 新增照片");
    const upload = el("input"); upload.type="file"; upload.accept="image/*"; upload.multiple=true;
    uploadLabel.append(upload); uploadWrap.append(uploadLabel);
    const preview = el("div", "review-preview"); uploadWrap.append(preview); form.append(uploadWrap);
    const status = el("p", "review-form-status"); status.setAttribute("role","status"); form.append(status);
    const submit = el("button", "review-primary review-submit", demo ? "儲存測試評價" : "送出評價"); submit.type="submit"; form.append(submit);
    function renderPreview(){
      preview.replaceChildren();
      draftPhotos.forEach((src,index)=>{
        const wrap = el("div","review-preview-item"); const img = el("img"); img.src=src; img.alt="待上傳照片 "+(index+1);
        const remove = button("×","",()=>{draftPhotos.splice(index,1);renderPreview();}); remove.setAttribute("aria-label","移除照片 "+(index+1));
        remove.disabled = photoBusy || submitting; wrap.append(img,remove);preview.append(wrap);
      });
    }
    upload.addEventListener("change",async()=>{
      photoBusy=true; submit.disabled=true; upload.disabled=true;
      const files=[...upload.files]; upload.value=""; const failed=[];
      for(let i=0;i<files.length;i++){
        status.textContent="正在處理照片 "+(i+1)+" / "+files.length;
        try{ draftPhotos.push(await photoToJpeg(files[i])); }catch{failed.push(files[i].name);}
      }
      photoBusy=false; submit.disabled=false; upload.disabled=false;renderPreview();
      status.textContent=failed.length ? "這些照片無法讀取，請改用 JPG 或 PNG："+failed.join("、") : "";
    });
    form.addEventListener("submit",async event=>{
      event.preventDefault(); if(submitting || photoBusy) return;
      const selected=form.querySelector("input[name=rating]:checked"); if(!selected) return;
      const payload={ id:submissionId, nickname:nickname.value.trim()||"訪客", product:product.value,
        rating:Number(selected.value), text:content.value.trim(), photos:[...draftPhotos] };
      submitting=true; submit.disabled=true; status.textContent="正在送出…";
      const controls=[...form.elements].map(input=>[input,input.disabled]); controls.forEach(([input])=>input.disabled=true);
      try{
        if(demo){
          const records=readJSON(DEMO_KEY,[]); records.unshift({...payload,createdAt:new Date().toISOString()});
          localStorage.setItem(DEMO_KEY,JSON.stringify(records));
        }else{
          const keys=ownerKeys(); const deleteKey=submissionKey;
          keys[payload.id]=deleteKey;
          // 先保存刪除憑證，儲存失敗時不送出無法自行刪除的評價。
          localStorage.setItem(OWNER_KEY,JSON.stringify(keys));
          await request("/reviews",{...payload,deleteKey});
        }
        formDialog.close(); await refresh();
      }catch(error){status.textContent=error.message;status.classList.add("review-error");}
      finally{submitting=false;controls.forEach(([input,disabled])=>input.disabled=disabled);submit.disabled=false;}
    });
    formDialog.addEventListener("cancel",event=>{if(submitting||photoBusy)event.preventDefault();});
    formDialog.addEventListener("close",()=>formDialog.remove(),{once:true});
    formDialog.append(head,form);document.body.append(formDialog);formDialog.showModal();
  }
  function mount(container, data){
    ++requestNumber; filter={stars:0,photos:false,product:"",sort:"newest",offset:0,nickname:""};
    catalog=[...new Set(Object.values(data).flat().map(p=>p.name).filter(Boolean))];
    root=el("section","reviews");root.setAttribute("aria-label","商品評價");
    const top=el("div","review-top");top.append(el("p","","每一份真實心得，都是選琴的參考。"));
    const add=button("＋ 新增評價","review-primary",openForm); top.append(add);root.append(top);
    if(demo)root.append(el("p","review-notice","本機測試模式：所有暱稱、評價和星等只保存在這台裝置，不會公開或計入正式評分。"));
    summary=el("div","review-summary");summary.append(el("span","review-score","—"),el("span","review-muted","尚無評分資料"));root.append(summary);
    const filters=el("div","review-filters");
    const all=button("全部","review-filter",()=>{filter.photos=false;all.setAttribute("aria-pressed","true");withPhotos.setAttribute("aria-pressed","false");refresh();});all.setAttribute("aria-pressed","true");
    const withPhotos=button("附照片","review-filter",()=>{filter.photos=true;all.setAttribute("aria-pressed","false");withPhotos.setAttribute("aria-pressed","true");refresh();});withPhotos.setAttribute("aria-pressed","false");
    function select(label,values,callback){const node=el("select");node.setAttribute("aria-label",label);values.forEach(([value,text])=>node.append(new Option(text,value)));node.addEventListener("change",()=>callback(node.value));return node;}
    filters.append(all,withPhotos,select("星等",[[0,"全部星等"],...[5,4,3,2,1].map(n=>[n,n+" 星"])],v=>{filter.stars=Number(v);refresh();}),
      select("商品",[["","全部商品"],...catalog.map(name=>[name,name])],v=>{filter.product=v;refresh();}),
      select("評價排序",[["newest","最新評價"],["highest","星等由高到低"],["lowest","星等由低到高"]],v=>{filter.sort=v;refresh();}));root.append(filters);
    const search=el("form","review-filters");
    const nickname=el("input");nickname.maxLength=40;nickname.placeholder="輸入評價者完整暱稱";nickname.setAttribute("aria-label","評價者完整暱稱");
    const submitSearch=el("button","review-filter","查詢評價者");submitSearch.type="submit";
    search.append(nickname,submitSearch,button("清除暱稱查詢","review-filter",()=>{nickname.value="";filter.nickname="";refresh();}));
    search.addEventListener("submit",event=>{event.preventDefault();filter.nickname=nickname.value.trim();refresh();});
    root.append(search,el("p","review-muted","請輸入完整暱稱；同名評價會一起顯示。部分評價僅供暱稱查詢，不計入上方公開評分。"));
    notice=el("p","review-form-status");notice.setAttribute("role","status");root.append(notice);
    list=el("div","review-list");root.append(list);
    more=button("載入更多","review-more",()=>{filter.offset=items.length;refresh(true);});more.hidden=true;root.append(more);
    container.replaceChildren(root);
    if(config.apiBase&&!demo){
      const admin=el("details","review-admin");admin.append(el("summary","review-muted","管理員登入"));
      const login=el("form","review-admin-form");
      const email=el("input");email.type="email";email.placeholder="管理員 Email";email.required=true;email.autocomplete="username";email.setAttribute("aria-label","管理員 Email");
      const password=el("input");password.type="password";password.placeholder="密碼";password.required=true;password.autocomplete="current-password";password.setAttribute("aria-label","管理員密碼");
      const signIn=el("button","review-primary","登入");signIn.type="submit";
      const loginStatus=el("p","review-muted");loginStatus.setAttribute("role","status");
      login.append(email,password,signIn,loginStatus);
      const logout=button("登出管理","review-delete",()=>{adminToken="";logout.hidden=true;login.hidden=false;refresh();});
      logout.hidden=!adminToken;login.hidden=Boolean(adminToken);admin.append(login,logout);root.append(admin);
      login.addEventListener("submit",async event=>{
        event.preventDefault();signIn.disabled=true;loginStatus.textContent="登入中…";
        try{const result=await request("/admin/login",{email:email.value,password:password.value});
          adminToken=result.token;password.value="";login.hidden=true;logout.hidden=false;loginStatus.textContent="";await refresh();
        }catch(error){loginStatus.textContent=error.message;}
        finally{signIn.disabled=false;}
      });
    }
    if(!demo&&!config.apiBase){
      add.disabled=true;notice.textContent="評價功能準備中，尚未開放送出。";
      list.append(el("p","review-empty","這裡將顯示顧客的星等、心得與照片。"));
      filters.querySelectorAll("button,select").forEach(node=>node.disabled=true);
    }else refresh();
  }
  return {mount};
})();
