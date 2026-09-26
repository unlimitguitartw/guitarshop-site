/* ===== 吉他推薦系統：設定檔 =====
   這是唯一需要你手動改的檔案，改完存檔即可。 */

window.QUIZ_CONFIG = {

  /* ★★★ 總開關 ★★★
     false = 還沒準備好：就算有人猜到 quiz.html 這個網址，也只會看到「準備中」。
     true  = 正式對客戶開放。

     你自己要預覽的時候，網址後面加 ?preview=1 就看得到（例如 quiz.html?preview=1），
     不用把開關打開。

     ※ 首頁目前完全沒有測驗的入口按鈕，要放入口再加入即可。            */
  live: false,

  /* 【第 1 步】把你的 Google 試算表網址整段貼在下面的引號中間。
     長得像：https://docs.google.com/spreadsheets/d/1AbCdEfGh.../edit#gid=0
     留空的話，網站會用內建的「示範題目 + 示範標籤」，方便你先看效果。   */
  sheetUrl: "",

  /* 【第 2 步】試算表要設成「知道連結的任何人 → 檢視者」，網站才讀得到。 */

  /* 三個分頁的名稱，跟 Google Sheet 最下方的分頁名要一模一樣。
     你如果把分頁改名，這裡也要跟著改。 */
  sheets: {
    guitars:   "吉他標籤",
    questions: "題目",
    tags:      "標籤設定"
  }
};
