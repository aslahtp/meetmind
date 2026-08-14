document.addEventListener('DOMContentLoaded', () => {
  const dot  = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  const versionBadge = document.getElementById('version-badge');

  // Display current extension version from manifest
  try {
    const manifest = chrome.runtime.getManifest();
    if (manifest?.version && versionBadge) {
      versionBadge.textContent = `v${manifest.version}`;
    }
  } catch (_e) {}

  // Check status from background
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (status) => {
    if (chrome.runtime.lastError) {
      dot.className  = 'dot disconnected';
      text.textContent = 'Extension error';
      return;
    }

    if (status?.wsConnected) {
      dot.className  = 'dot connected';
      text.textContent = 'Connected to desktop app';
    } else {
      dot.className  = 'dot disconnected';
      text.textContent = 'Desktop app not running';
    }
  });

  document.getElementById('open-app-btn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_APP' });
    window.close();
  });

  document.getElementById('go-to-meet-btn').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://meet.google.com' });
    window.close();
  });
});
