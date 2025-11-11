// Load saved API key
chrome.storage.local.get('OPENAI_API_KEY', (result) => {
  if (result.OPENAI_API_KEY) {
    document.getElementById('apiKey').value = result.OPENAI_API_KEY;
  }
});

// Save API key
document.getElementById('save').addEventListener('click', () => {
  const apiKey = document.getElementById('apiKey').value.trim();
  
  if (!apiKey) {
    document.getElementById('status').textContent = '⚠️ Please enter an API key';
    return;
  }
  
  chrome.storage.local.set({ OPENAI_API_KEY: apiKey }, () => {
    document.getElementById('status').textContent = '✅ Settings saved!';
    setTimeout(() => {
      document.getElementById('status').textContent = '';
    }, 2000);
  });
});