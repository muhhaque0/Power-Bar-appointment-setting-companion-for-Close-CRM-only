const $ = id => document.getElementById(id);

// Load saved settings
chrome.storage.local.get(['apiKey', 'repName', 'refreshInterval', 'showLeadPanel', 'showAlways'], data => {
  if (data.apiKey) $('apiKey').value = data.apiKey;
  if (data.repName) $('repName').value = data.repName;
  if (data.refreshInterval) $('refreshInterval').value = data.refreshInterval;
  $('showLeadPanel').checked = data.showLeadPanel !== false;
  $('showAlways').checked = data.showAlways !== false;
});

$('saveBtn').addEventListener('click', async () => {
  const apiKey = $('apiKey').value.trim();
  if (!apiKey) {
    showStatus('Please enter an API key.', 'err');
    return;
  }

  showStatus('Verifying...', '');

  // Test the API key
  try {
    const resp = await fetch('https://api.close.com/api/v1/me/', {
      headers: { 'Authorization': 'Basic ' + btoa(apiKey + ':') }
    });
    if (!resp.ok) throw new Error('Invalid API key');
    const me = await resp.json();

    const settings = {
      apiKey,
      repName: $('repName').value.trim() || me.display_name || me.first_name,
      refreshInterval: parseInt($('refreshInterval').value),
      showLeadPanel: $('showLeadPanel').checked,
      showAlways: $('showAlways').checked,
      meId: me.id,
      orgId: me.organizations?.[0]?.id || ''
    };

    chrome.storage.local.set(settings, () => {
      showStatus(`✓ Connected as ${settings.repName}`, 'ok');
      // Notify background to reset session stats and start polling
      chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED', settings });
    });
  } catch (e) {
    showStatus('❌ ' + (e.message || 'Connection failed'), 'err');
  }
});

function showStatus(msg, cls) {
  const el = $('status');
  el.textContent = msg;
  el.className = cls;
}
