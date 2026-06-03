// ─── Close CRM Power Bar — Background Service Worker ───────────────────────

const ALARM_NAME = 'close_stats_refresh';

const TRIAGED_STATUSES = new Set([
  'Ta3ban Data',
  'Triaged - Language',
  'Triaged - Time',
  'Triaged - Financial',
  'Triaged - Other'
]);

// ── Helpers ──────────────────────────────────────────────────────────────────

function getAuth(apiKey) {
  return 'Basic ' + btoa(apiKey + ':');
}

function localMidnightISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

async function closeGet(path, apiKey) {
  const resp = await fetch(`https://api.close.com/api/v1${path}`, {
    headers: { Authorization: getAuth(apiKey) }
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Close API error ${resp.status}: ${path} — ${body}`);
  }
  return resp.json();
}

function hasOpportunityStatus(lead, statusLabel) {
  return (lead.opportunities || []).some(o => o.status_label === statusLabel);
}

function classifyLead(lead, oldStatus) {
  const status = oldStatus || lead.status_label || '';
  if (status === 'Potential') return 'outbound';
  if (status === 'Unconfirmed') return 'selfbooking';
  if (status === 'Webinar Registrant') {
    if (hasOpportunityStatus(lead, 'Booked Appt')) return 'selfbooking';
    if (hasOpportunityStatus(lead, 'Scored')) return 'outbound';
  }
  return null;
}

// ── Fetch today's call stats for the current user ────────────────────────────

async function fetchStats(apiKey, meId) {
  const since = localMidnightISO();
  const localMidnight = new Date();
  localMidnight.setHours(0, 0, 0, 0);

  // ── Report API: dials + talk time ─────────────────────────────────────────
  const reportResp = await fetch('https://api.close.com/api/v1/report/activity/', {
    method: 'POST',
    headers: { Authorization: getAuth(apiKey), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'comparison',
      datetime_range: { start: since, end: new Date().toISOString() },
      metrics: ['calls.outbound.all.count', 'calls.outbound.all.sum_duration'],
      users: [meId]
    })
  });
  if (!reportResp.ok) {
    const body = await reportResp.text();
    throw new Error(`Report API error ${reportResp.status}: ${body}`);
  }
  const reportData = await reportResp.json();
  const row = (reportData.data || []).find(r => r.user_id === meId) || {};
  const dials = row['calls.outbound.all.count'] || 0;
  const totalSec = row['calls.outbound.all.sum_duration'] || 0;

  // ── Activity endpoint: calls today ────────────────────────────────────────
  const actData = await closeGet(
    `/activity/call/?date_created__gte=${encodeURIComponent(since)}&user_id=${meId}&_limit=100`,
    apiKey
  );
  const calls = (actData.data || []).filter(c => new Date(c.activity_at) >= localMidnight);
  const connectedCalls = calls.filter(c => c.disposition === 'answered' && (c.duration || 0) >= 60);
  const meaningfulCalls = calls.filter(c => c.disposition === 'answered' && (c.duration || 0) >= 300);
  const calledLeadIds = [...new Set(calls.map(c => c.lead_id))];
  const connectedLeadIds = [...new Set(connectedCalls.map(c => c.lead_id))];
  const meaningfulLeadIds = [...new Set(meaningfulCalls.map(c => c.lead_id))];

  // ── Status changes today by user ──────────────────────────────────────────
  const statusData = await closeGet(
    `/activity/status_change/lead/?user_id=${meId}&date_created__gte=${encodeURIComponent(since)}&_limit=100`,
    apiKey
  );
  const statusChanges = (statusData.data || []).filter(c => new Date(c.activity_at) >= localMidnight);

  const triagedChanges = statusChanges.filter(c => TRIAGED_STATUSES.has(c.new_status_label));
  const triagedLeadIds = [...new Set(triagedChanges.map(c => c.lead_id))];

  const statusChangeMap = {};
  for (const c of [...statusChanges].reverse()) {
    statusChangeMap[c.lead_id] = c.old_status_label;
  }

  // ── Fetch called leads: status + name + opportunities ─────────────────────
  let leadInfoMap = {};
  if (calledLeadIds.length > 0) {
    const leadsData = await closeGet(
      `/lead/?id__in=${calledLeadIds.join(',')}&_fields=id,status_label,display_name,opportunities&_limit=100`,
      apiKey
    );
    for (const l of (leadsData.data || [])) {
      leadInfoMap[l.id] = l;
    }
  }

  // ── Fetch names for triaged leads not in called leads ─────────────────────
  const triagedNotCalled = triagedLeadIds.filter(id => !leadInfoMap[id]);
  if (triagedNotCalled.length > 0) {
    const triagedLeadsData = await closeGet(
      `/lead/?id__in=${triagedNotCalled.join(',')}&_fields=id,display_name,opportunities&_limit=100`,
      apiKey
    );
    for (const l of (triagedLeadsData.data || [])) {
      leadInfoMap[l.id] = l;
    }
  }

  // ── Find earliest call time per lead today (by this user) ─────────────────
  const firstCallTimeMap = {};
  for (const c of calls) {
    if (!firstCallTimeMap[c.lead_id] || c.activity_at < firstCallTimeMap[c.lead_id]) {
      firstCallTimeMap[c.lead_id] = c.activity_at;
    }
  }

  // ── Check if anyone called this lead before the user's first call today ────
  const priorCallChecks = await Promise.all(
    calledLeadIds.map(leadId => {
      const firstCallTime = firstCallTimeMap[leadId] || since;
      return fetch(
        `https://api.close.com/api/v1/activity/call/?lead_id=${leadId}&date_created__lt=${encodeURIComponent(firstCallTime)}&_limit=1`,
        { headers: { Authorization: getAuth(apiKey) } }
      ).then(r => r.json()).then(d => ({ leadId, isNew: (d.data || []).length === 0 }));
    })
  );
  const newLeadIdSet = new Set(priorCallChecks.filter(r => r.isNew).map(r => r.leadId));

  function toLeadList(ids) {
    return ids.map(id => ({
      id,
      name: (leadInfoMap[id] || {}).display_name || id
    }));
  }

  // ── Classify called leads by funnel (new leads only) ──────────────────────
  const outboundLeads = [];
  const selfBookingLeads = [];

  for (const leadId of calledLeadIds) {
    if (!newLeadIdSet.has(leadId)) continue;
    const lead = leadInfoMap[leadId] || {};
    const oldStatus = statusChangeMap[leadId] || null;
    const funnel = classifyLead(lead, oldStatus);
    const entry = { id: leadId, name: lead.display_name || leadId };
    if (funnel === 'outbound') outboundLeads.push(entry);
    else if (funnel === 'selfbooking') selfBookingLeads.push(entry);
  }

  return {
    dials,
    totalSec,
    connected: connectedLeadIds.length,
    connectedLeads: toLeadList(connectedLeadIds),
    meaningful: meaningfulLeadIds.length,
    meaningfulLeads: toLeadList(meaningfulLeadIds),
    triaged: triagedLeadIds.length,
    triagedLeads: toLeadList(triagedLeadIds),
    outbound: outboundLeads.length,
    outboundLeads,
    selfBooking: selfBookingLeads.length,
    selfBookingLeads
  };
}

// ── Fetch lead info for a given lead ID ──────────────────────────────────────

async function fetchLead(leadId, apiKey) {
  try {
    const lead = await closeGet(`/lead/${leadId}/`, apiKey);
    const contacts = lead.contacts || [];
    const primaryContact = contacts[0];
    const phones = primaryContact?.phones || [];
    const emails = primaryContact?.emails || [];
    return {
      name: lead.display_name || lead.name || '—',
      status: lead.status_label || lead.status_id || '—',
      contactName: primaryContact?.name || '—',
      phone: phones[0]?.phone || '—',
      email: emails[0]?.email || '—',
      url: lead.url || '',
      opportunities: (lead.opportunities || []).length
    };
  } catch (e) {
    return null;
  }
}

// ── Broadcast stats to all Close CRM tabs ────────────────────────────────────

async function broadcastStats() {
  const { apiKey, meId, repName } = await chrome.storage.local.get(
    ['apiKey', 'meId', 'repName']
  );
  if (!apiKey || !meId) return;

  try {
    const stats = await fetchStats(apiKey, meId);
    console.log('[PowerBar] Stats fetched:', stats);
    await chrome.storage.local.set({ cachedStats: stats, lastFetch: Date.now() });

    const tabs = await chrome.tabs.query({ url: 'https://app.close.com/*' });
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'STATS_UPDATE',
        stats,
        repName: repName || 'Rep'
      }).catch(() => {});
    }
  } catch (e) {
    console.error('[PowerBar] Stats fetch failed:', e);
  }
}

// ── Set up polling alarm ──────────────────────────────────────────────────────

async function setupAlarm() {
  await chrome.alarms.clear(ALARM_NAME);
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
}

// ── Event listeners ───────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM_NAME) broadcastStats();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'SETTINGS_UPDATED') {
    setupAlarm();
    broadcastStats();
    return;
  }

  if (msg.type === 'GET_STATS') {
    chrome.storage.local.get(['cachedStats', 'repName'], data => {
      sendResponse({ stats: data.cachedStats || null, repName: data.repName || 'Rep' });
    });
    return true;
  }

  if (msg.type === 'GET_LEAD') {
    chrome.storage.local.get('apiKey', async data => {
      if (!data.apiKey) { sendResponse(null); return; }
      const lead = await fetchLead(msg.leadId, data.apiKey);
      sendResponse(lead);
    });
    return true;
  }

  if (msg.type === 'FORCE_REFRESH') {
    broadcastStats().then(() => sendResponse({ ok: true }));
    return true;
  }
});

// Init on install / startup
chrome.runtime.onInstalled.addListener(setupAlarm);
chrome.runtime.onStartup.addListener(() => {
  setupAlarm();
  broadcastStats();
});
