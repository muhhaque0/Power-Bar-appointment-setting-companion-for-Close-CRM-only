// ─── Close CRM Power Bar — Content Script ────────────────────────────────────

(function () {
  'use strict';

  let bar = null;
  let cachedStats = null;
  let activeTooltip = null;
  let hideTimeout = null;

  // ── Utility ───────────────────────────────────────────────────────────────

  function fmtTime(seconds) {
    if (!seconds || seconds < 0) return '0:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m ${String(s).padStart(2, '0')}s`;
  }

  function initials(name) {
    if (!name) return '?';
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  }

  function esc(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── Tooltip ───────────────────────────────────────────────────────────────

  function cancelHide() {
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }
  }

  function scheduleHide() {
    cancelHide();
    hideTimeout = setTimeout(() => {
      if (activeTooltip) {
        activeTooltip.remove();
        activeTooltip = null;
      }
    }, 150);
  }

  function showTooltip(anchorEl, leads) {
    cancelHide();
    if (activeTooltip) { activeTooltip.remove(); activeTooltip = null; }
    if (!leads || !leads.length) return;

    const tooltip = document.createElement('div');
    tooltip.id = 'crm-lead-tooltip';
    tooltip.innerHTML = leads.map(l =>
      `<a class="crm-tooltip-link" href="https://app.close.com/lead/${l.id}/" target="_blank" rel="noopener">${esc(l.name)}</a>`
    ).join('');

    document.body.appendChild(tooltip);
    activeTooltip = tooltip;

    const rect = anchorEl.getBoundingClientRect();
    tooltip.style.left = `${rect.left}px`;
    tooltip.style.top = `${rect.bottom + 4}px`;

    tooltip.addEventListener('mouseenter', cancelHide);
    tooltip.addEventListener('mouseleave', scheduleHide);
  }

  function attachTooltip(id, getLeads) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('mouseenter', () => showTooltip(el, getLeads()));
    el.addEventListener('mouseleave', scheduleHide);
  }

  // ── Build the bar ─────────────────────────────────────────────────────────

  function buildBar(stats, repName) {
    cachedStats = stats;

    const existing = document.getElementById('crm-power-bar');
    if (existing) existing.remove();

    bar = document.createElement('div');
    bar.id = 'crm-power-bar';

    bar.innerHTML = `
      <div class="crm-bar-logo">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="7" fill="#5b6af0"/>
          <path d="M4 7.5L6 9.5L10 5" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Power Bar
      </div>

      <div class="crm-bar-divider"></div>

      <div class="crm-stat">
        <span class="crm-stat-label">DIALS</span>
        <span class="crm-stat-value accent" id="cb-dials">${stats ? stats.dials : '—'}</span>
      </div>

      <div class="crm-bar-divider"></div>

      <div class="crm-stat crm-stat-hoverable" id="cb-connected-wrap">
        <span class="crm-stat-label">PICK UPS</span>
        <span class="crm-stat-value green" id="cb-connected">${stats ? stats.connected : '—'}</span>
      </div>

      <div class="crm-bar-divider"></div>

      <div class="crm-stat">
        <span class="crm-stat-label">TALK TIME</span>
        <span class="crm-stat-value orange" id="cb-talk">${stats ? fmtTime(stats.totalSec) : '—'}</span>
      </div>

      <div class="crm-bar-divider"></div>

      <div class="crm-stat">
        <span class="crm-stat-label">PICK UP RATE</span>
        <span class="crm-stat-value" id="cb-rate">${stats && stats.dials > 0 ? Math.round((stats.connected / stats.dials) * 100) + '%' : '—'}</span>
      </div>

      <div class="crm-bar-divider"></div>

      <div class="crm-stat crm-stat-hoverable" id="cb-meaningful-wrap">
        <span class="crm-stat-label">MEANINGFUL</span>
        <span class="crm-stat-value green" id="cb-meaningful">${stats ? stats.meaningful : '—'}</span>
      </div>

      <div class="crm-bar-divider"></div>

      <div class="crm-stat crm-stat-hoverable" id="cb-triaged-wrap">
        <span class="crm-stat-label">TRIAGED</span>
        <span class="crm-stat-value" id="cb-triaged">${stats ? stats.triaged : '—'}</span>
      </div>

      <div class="crm-bar-divider"></div>

      <div class="crm-stat crm-stat-hoverable" id="cb-outbound-wrap">
        <span class="crm-stat-label">OUTBOUND</span>
        <span class="crm-stat-value accent" id="cb-outbound">${stats ? stats.outbound : '—'}</span>
      </div>

      <div class="crm-bar-divider"></div>

      <div class="crm-stat crm-stat-hoverable" id="cb-selfbooking-wrap">
        <span class="crm-stat-label">SELF BOOK</span>
        <span class="crm-stat-value accent" id="cb-selfbooking">${stats ? stats.selfBooking : '—'}</span>
      </div>

      <div class="crm-bar-spacer"></div>

      <div class="crm-live-dot"></div>

      <button class="crm-refresh-btn" id="cb-refresh">↻ Refresh</button>

      <div class="crm-bar-divider"></div>

      <div class="crm-rep-badge">
        <div class="crm-rep-avatar" id="cb-avatar">${initials(repName)}</div>
        <span class="crm-rep-name" id="cb-repname">${repName || 'Rep'}</span>
      </div>
    `;

    document.body.insertAdjacentElement('afterbegin', bar);
    document.body.classList.add('crm-bar-active');

    document.getElementById('cb-refresh').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'FORCE_REFRESH' });
    });

    attachTooltip('cb-connected-wrap',   () => cachedStats?.connectedLeads || []);
    attachTooltip('cb-meaningful-wrap',  () => cachedStats?.meaningfulLeads || []);
    attachTooltip('cb-triaged-wrap',     () => cachedStats?.triagedLeads || []);
    attachTooltip('cb-outbound-wrap',    () => cachedStats?.outboundLeads || []);
    attachTooltip('cb-selfbooking-wrap', () => cachedStats?.selfBookingLeads || []);
  }

  // ── Update bar stat values (without rebuilding) ───────────────────────────

  function updateBarStats(stats) {
    cachedStats = stats;
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    if (!stats) return;
    set('cb-dials', stats.dials);
    set('cb-connected', stats.connected);
    set('cb-meaningful', stats.meaningful);
    set('cb-triaged', stats.triaged);
    set('cb-outbound', stats.outbound);
    set('cb-selfbooking', stats.selfBooking);
    set('cb-talk', fmtTime(stats.totalSec));
    set('cb-rate', stats.dials > 0 ? Math.round((stats.connected / stats.dials) * 100) + '%' : '—');
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  function init() {
    chrome.runtime.sendMessage({ type: 'GET_STATS' }, ({ stats, repName }) => {
      buildBar(stats, repName);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (!document.getElementById('crm-power-bar')) {
        chrome.runtime.sendMessage({ type: 'GET_STATS' }, ({ stats, repName }) => {
          buildBar(stats, repName);
        });
      }
    }
  }).observe(document.body, { childList: true, subtree: true });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'STATS_UPDATE') updateBarStats(msg.stats);
  });

})();
