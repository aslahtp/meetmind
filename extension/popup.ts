document.addEventListener('DOMContentLoaded', () => {
  const dot  = document.getElementById('status-dot')!;
  const text = document.getElementById('status-text')!;
  const versionBadge = document.getElementById('version-badge')!;

  // Display current extension version from manifest
  try {
    const manifest = chrome.runtime.getManifest();
    if (manifest?.version && versionBadge) {
      versionBadge.textContent = `v${manifest.version}`;
    }
  } catch (_e) {}

  // Check status from background
  const statusRequest: BackgroundRequest = { type: 'GET_STATUS' };
  chrome.runtime.sendMessage<BackgroundRequest, GetStatusResponse | undefined>(statusRequest, (status) => {
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

  document.getElementById('open-app-btn')!.addEventListener('click', () => {
    const request: BackgroundRequest = { type: 'OPEN_APP' };
    chrome.runtime.sendMessage(request);
    window.close();
  });

  document.getElementById('go-to-meet-btn')!.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://meet.google.com' });
    window.close();
  });
});
