(function () {
  const POLL_INTERVAL = 30000; // 30 seconds

  function updateDot(state) {
    const dot   = document.getElementById('conn-status-dot');
    const label = document.getElementById('conn-status-label');
    if (!dot || !label) return;
    dot.className     = 'status-dot status-' + state;
    const text = { connected: 'Connected', disconnected: 'Disconnected', checking: 'Checking...' };
    label.textContent = text[state] || state;
  }

  async function checkHealth() {
    try {
      const res = await fetch('/health', { cache: 'no-store' });
      updateDot(res.ok ? 'connected' : 'disconnected');
    } catch {
      updateDot('disconnected');
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    checkHealth();
    setInterval(checkHealth, POLL_INTERVAL);
  });
})();
