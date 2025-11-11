// Handle messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'callOpenAI') {
    callOpenAI(request.payload, request.apiKey)
      .then(data => sendResponse({ data }))
      .catch(error => sendResponse({ error: error.message }));
    return true; // Keep channel open for async response
  }
  
  if (request.action === 'download') {
    chrome.downloads.download({
      url: request.url,
      filename: request.filename,
      saveAs: true
    });
  }
});

async function callOpenAI(payload, apiKey) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const json = await response.json();
  const raw = json?.choices?.[0]?.message?.content?.trim() || "{}";
  
  // Parse JSON response
  let s = raw.replace(/```(?:json)?\s*([\s\S]*?)```/i, '$1').trim();
  const m = s.match(/{[\s\S]*}/);
  return JSON.parse(m ? m[0] : s);
}