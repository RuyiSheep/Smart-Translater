/*** Settings ***/
const MODEL = "gpt-4o-mini";
const TARGET_LANG = "English";
const MAX_CHARS = 280;

/* Styles */
const style = document.createElement('style');
style.textContent = `
.wb-pop{position:fixed;z-index:2147483647;max-width:520px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;
  box-shadow:0 12px 26px rgba(0,0,0,.16);padding:10px 12px;font:13px/1.4 ui-sans-serif,system-ui;color:#111}
.wb-pop h4{margin:0 0 6px 0;font-size:13px}
.wb-pop small{color:#6b7280}
.wb-row{margin-top:6px}
.wb-btn{display:inline-block;margin-right:6px;padding:5px 9px;border-radius:9px;border:1px solid #e5e7eb;cursor:pointer;background:#f9fafb}
.wb-btn:hover{background:#f3f4f6}
.wb-right{float:right}
`;
document.head.appendChild(style);

let lastSelection = "";

/* Cache selected text */
document.addEventListener("mouseup", () => { 
  setTimeout(() => {
    lastSelection = getActiveSelection().trim();
  }, 10);
}, true);

document.addEventListener("keyup", (e) => { 
  if (e.key === "Escape") lastSelection = ""; 
}, true);

/* Hotkeys */
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === "t") { 
    e.preventDefault(); 
    translateSelection(); 
  }
  if (e.ctrlKey && e.key.toLowerCase() === "e") { 
    e.preventDefault(); 
    exportCSV(); 
  }
}, true);

/* ---------- Core actions ---------- */
async function translateSelection(){
  const text = (lastSelection || getActiveSelection()).trim();
  if (!text) return toast("Select some text first.");
  if (text.length > MAX_CHARS) return toast(`Selection too long (${text.length}). Limit ${MAX_CHARS}.`);

  // Check if API key exists
  const { OPENAI_API_KEY } = await chrome.storage.local.get('OPENAI_API_KEY');
  if (!OPENAI_API_KEY) {
    toast("⚠️ Please set your API key in the extension popup");
    return;
  }

  const pop = makePopupAtSelection("Translating…");
  
  try {
    const payload = {
      model: MODEL,
      response_format: { type: "json_object" },
      temperature: 0,
      messages: [
        { role: "system", content:
         "Return ONLY a JSON object with keys: term, gloss, pos, source_lang, target_lang, example, example_translation." },
        { role: "user", content:
         `Target language: ${TARGET_LANG}\nText: """${text}"""` }
      ]
    };

    // Send to background script for API call
    const response = await chrome.runtime.sendMessage({
      action: 'callOpenAI',
      payload: payload,
      apiKey: OPENAI_API_KEY
    });

    if (response.error) {
      throw new Error(response.error);
    }

    const data = response.data;
    if (!data || !data.term) {
      pop.innerHTML = `<h4>Couldn't parse.</h4><div class="wb-row"><small>${escapeHtml(JSON.stringify(data).slice(0,240))}</small></div>`;
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
  pop.querySelector(".wb-add").onclick = () => { 
    addToWordbook(card); 
    pop.querySelector(".wb-status").textContent = "Saved ✓"; 
  };
  pop.querySelector(".wb-copy").onclick = () => { 
    navigator.clipboard.writeText(`${card.term} — ${card.gloss}`); 
  };
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
async function addToWordbook(item){
  const { wordbook } = await chrome.storage.local.get('wordbook');
  const arr = wordbook || [];
  
  // dedupe by (term + gloss)
  const id = `${item.term}__${item.gloss}`;
  if (!arr.find(x => `${x.term}__${x.gloss}` === id)) {
    arr.push(item);
  }
  
  await chrome.storage.local.set({ wordbook: arr });
}

async function exportCSV(){
  const { wordbook } = await chrome.storage.local.get('wordbook');
  const arr = wordbook || [];
  
  if (!arr.length) { 
    toast("Wordbook is empty."); 
    return; 
  }
  
  const header = ["term","gloss","pos","example","example_translation","page_title","page_url","target_lang","ts"];
  const rows = arr.map(o => header.map(h => csvEscape(o[h] ?? "")));
  const csv = [header.join(","), ...rows.map(r => r.join(","))].join("\n");
  const name = `wordbook_${new Date().toISOString().slice(0,10)}.csv`;
  
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  
  chrome.runtime.sendMessage({
    action: 'download',
    url: url,
    filename: name
  });
  
  toast(`Exported ${arr.length} items.`);
}

/* ---------- Utilities ---------- */
function makePopupAtSelection(text){
  const pop = document.createElement("div"); 
  pop.className = "wb-pop"; 
  pop.textContent = text;
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

  const ae = document.activeElement;
  if (ae && ae.shadowRoot) {
    try {
      const s = ae.shadowRoot.getSelection ? ae.shadowRoot.getSelection() : null;
      if (s && !s.isCollapsed) return s.getRangeAt(0);
    } catch {}
  }
  
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