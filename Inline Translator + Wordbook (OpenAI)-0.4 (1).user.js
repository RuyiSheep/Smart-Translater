// ==UserScript==
// @name         Inline Translator + Wordbook (OpenAI)
// @namespace    wordbook-inline
// @version      0.4
// @description  Alt+T translate selection; Add to wordbook; Alt+E export CSV for Anki
// @match        *://*/*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_listValues
// @grant        GM_download
// @connect      api.openai.com
// @run-at       document-idle
// ==/UserScript==

/*** 1) Add your OpenAI API key ***/
// save it in local; one-time use
//(async () => {
//  if (!await GM_getValue("OPENAI_API_KEY")) {
//    const key = prompt("Enter your OpenAI API key (it will be saved securely):");
//    if (key) {
//      await GM_setValue("OPENAI_API_KEY", key);
//      alert("✅ API key saved successfully!");
//    }
//  }
//})();

// overwrite it; one-time use
/*
(async () => {
  const newKey = prompt("Enter your new OpenAI API key:");
  if (newKey) {
    await GM_setValue("OPENAI_API_KEY", newKey);
    alert("✅ API key updated!");
  }
})();
*/

const OPENAI_API_KEY = await GM_getValue("OPENAI_API_KEY");

/*** 2) Settings ***/
const MODEL = "gpt-4o-mini";
const TARGET_LANG = "English";   // change to your study language
const MAX_CHARS = 280;           // ignore huge selections

/* ---------- Styles & UI ---------- */
GM_addStyle(`
.wb-pop{position:fixed;z-index:2147483647;max-width:520px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;
  box-shadow:0 12px 26px rgba(0,0,0,.16);padding:10px 12px;font:13px/1.4 ui-sans-serif,system-ui;color:#111}
.wb-pop h4{margin:0 0 6px 0;font-size:13px}
.wb-pop small{color:#6b7280}
.wb-row{margin-top:6px}
.wb-btn{display:inline-block;margin-right:6px;padding:5px 9px;border-radius:9px;border:1px solid #e5e7eb;cursor:pointer;background:#f9fafb}
.wb-btn:hover{background:#f3f4f6}
.wb-right{float:right}
`);

let lastSelection = "";

/* Cache selected text reliably (works better on SPAs / shadow roots) */
document.addEventListener("mouseup", () => { lastSelection = getActiveSelection().trim(); }, true);
document.addEventListener("keyup", (e) => { if (e.key === "Escape") lastSelection = ""; }, true);

/* Hotkeys: Ctrl+T translate, Alt+E export */
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === "t") { e.preventDefault(); translateSelection(); }
  if (e.ctrlKey && e.key.toLowerCase() === "e") { e.preventDefault(); exportCSV(); }
}, true);

/* ---------- Core actions ---------- */
async function translateSelection(){
  const text = (lastSelection || getActiveSelection()).trim();
  if (!text) return toast("Select some text first.");
  if (text.length > MAX_CHARS) return toast(`Selection too long (${text.length}). Limit ${MAX_CHARS}.`);

  const pop = makePopupAtSelection("Translating…");
  try {
      const payload = {
          model: "gpt-4o-mini",
          response_format: { type: "json_object" },   // <— forces raw JSON
          temperature: 0,
          messages: [
              { role: "system", content:
               "Return ONLY a JSON object with keys: term, gloss, pos, source_lang, target_lang, example, example_translation." },
              { role: "user", content:
               `Target language: ${TARGET_LANG}\nText: """${text}"""` }
          ]
      };

    const json = await oai(payload);
    const raw = json?.choices?.[0]?.message?.content?.trim() || "{}";
    const data = safeParseJSON(raw);

    if (!data || !data.term) {
      pop.innerHTML = `<h4>Couldn’t parse.</h4><div class="wb-row"><small>${escapeHtml(raw.slice(0,240))}</small></div>`;
      return;
    }

    const page = { url: location.href, title: document.title };
    const card = {
      term: data.term,
      gloss: data.gloss || "",
      pos: data.pos || "",
      source_lang: data.source_lang || "",
      target_lang: data.target_lang || TARGET_LANG,
      example: data.example || text,
      example_translation: data.example_translation || "",
      page_title: page.title,
      page_url: page.url,
      ts: Date.now()
    };

    pop.innerHTML = renderCard(card);
    wireButtons(pop, card);

  } catch (e) {
    pop.innerHTML = `<h4>Error</h4><div class="wb-row"><small>${escapeHtml(String(e))}</small></div>`;
  }
}

/* Save item, copy, export */
function wireButtons(pop, card){
  pop.querySelector(".wb-add").onclick = () => { addToWordbook(card); pop.querySelector(".wb-status").textContent = "Saved ✓"; };
  pop.querySelector(".wb-copy").onclick = () => { navigator.clipboard.writeText(`${card.term} — ${card.gloss}`); };
  pop.querySelector(".wb-export").onclick = () => exportCSV();
  pop.querySelector(".wb-close").onclick = () => pop.remove();
}

function renderCard(c){
  return `
  <h4>${escapeHtml(c.term)} <small>(${escapeHtml(c.pos)})</small>
    <span class="wb-right"><button class="wb-btn wb-close">Close</button></span></h4>
  <div class="wb-row"><b>Meaning:</b> ${escapeHtml(c.gloss)}</div>
  <div class="wb-row"><b>Example:</b> ${escapeHtml(c.example)}</div>
  <div class="wb-row"><b>Translation:</b> ${escapeHtml(c.example_translation)}</div>
  <div class="wb-row"><small>${escapeHtml(c.page_title)} — ${escapeHtml(c.page_url)}</small></div>
  <div class="wb-row">
    <button class="wb-btn wb-add">Add</button>
    <button class="wb-btn wb-copy">Copy</button>
    <button class="wb-btn wb-export">Export CSV</button>
    <span class="wb-status" style="margin-left:8px;color:#059669"></span>
  </div>`;
}

/* ---------- Storage ---------- */
function addToWordbook(item){
  const key = "wordbook:list";
  const arr = JSON.parse(GM_getValue(key, "[]"));
  // dedupe by (term + gloss)
  const id = `${item.term}__${item.gloss}`;
  if (!arr.find(x => `${x.term}__${x.gloss}` === id)) arr.push(item);
  GM_setValue(key, JSON.stringify(arr));
}

function exportCSV(){
  const key = "wordbook:list";
  const arr = JSON.parse(GM_getValue(key, "[]"));
  if (!arr.length) { toast("Wordbook is empty."); return; }
  const header = ["term","gloss","pos","example","example_translation","page_title","page_url","target_lang","ts"];
  const rows = arr.map(o => header.map(h => csvEscape(o[h] ?? "")));
  const csv = [header.join(","), ...rows.map(r => r.join(","))].join("\n");
  const name = `wordbook_${new Date().toISOString().slice(0,10)}.csv`;
  GM_download({ url: "data:text/csv;charset=utf-8," + encodeURIComponent(csv), name });
  toast(`Exported ${arr.length} items.`);
}

/* ---------- Utilities ---------- */
function makePopupAtSelection(text){
  const pop = document.createElement("div"); pop.className = "wb-pop"; pop.textContent = text;
  const r = rectOfCurrentSelection();
  pop.style.left = `${(r.left||16) + window.scrollX}px`;
  pop.style.top  = `${(r.bottom||16) + window.scrollY + 8}px`;
  document.body.appendChild(pop);
  return pop;
}

function rectOfCurrentSelection(){
  const range = getActiveRange();
  if (!range) return { left:16, top:16, bottom:16 };
  const rects = range.getClientRects();
  return rects.length ? rects[0] : range.getBoundingClientRect();
}

function getActiveRange(){
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed) return sel.getRangeAt(0);

  // Shadow DOM focus
  const ae = document.activeElement;
  if (ae && ae.shadowRoot) {
    try {
      const s = ae.shadowRoot.getSelection ? ae.shadowRoot.getSelection() : null;
      if (s && !s.isCollapsed) return s.getRangeAt(0);
    } catch {}
  }
  // iframes
  for (const f of document.querySelectorAll("iframe")){
    try {
      const s = f.contentWindow.getSelection();
      if (s && !s.isCollapsed) return s.getRangeAt(0);
    } catch {}
  }
  return null;
}

function getActiveSelection(){
  const range = getActiveRange();
  if (!range) return "";
  return (range.toString ? range.toString() : "") || "";
}

function toast(msg){
  const t = document.createElement("div");
  t.style.cssText = "position:fixed;z-index:2147483647;left:16px;bottom:16px;background:#111;color:#fff;padding:8px 12px;border-radius:10px;opacity:.95";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(()=>t.remove(), 1600);
}

function csvEscape(s){ return `"${String(s).replace(/"/g,'""')}"`; }
function escapeHtml(x){return String(x).replace(/[&<>"']/g,m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[m]))}
function safeParseJSON(s){
    if (!s) return null;
    // remove ```...``` and leading "json" label
    s = s.replace(/```(?:json)?\s*([\s\S]*?)```/i, '$1').trim();
    // grab first {...} block if extra text sneaks in
    const m = s.match(/{[\s\S]*}/);
    try { return JSON.parse(m ? m[0] : s); } catch { return null; }
}

/* OpenAI via GM_xmlhttpRequest (CORS/CSP safe) */
function oai(payload){
  if (!OPENAI_API_KEY || OPENAI_API_KEY.includes("REPLACE")) {
    throw new Error("Add your OpenAI API key at the top of the script.");
  }
  return new Promise((resolve,reject)=>{
    GM_xmlhttpRequest({
      method:"POST",
      url:"https://api.openai.com/v1/chat/completions",
      headers:{
        "Content-Type":"application/json",
        "Authorization":`Bearer ${OPENAI_API_KEY}`
      },
      data: JSON.stringify(payload),
      onload: res => {
        if (res.status >= 400) return reject(new Error(`HTTP ${res.status}: ${res.statusText}`));
        try { resolve(JSON.parse(res.responseText)); } catch(e){ reject(e); }
      },
      onerror: ()=>reject(new Error("Network error")),
      timeout: 20000,
      ontimeout: ()=>reject(new Error("Timeout"))
    });
  });
}
