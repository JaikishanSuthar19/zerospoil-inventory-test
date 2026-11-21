/**
 * FreshMart Retail POS & Cold-Chain ERP v4.2
 * Standalone Supermarket Terminal Client for Laptop 2
 * Communicates with Laptop 1 (ZeroSpoil Middleware Server) over LAN
 */

// Global App State
const state = {
  backendUrl: localStorage.getItem('freshmart_backend_url') || 'http://localhost:8000',
  inventoryBatches: [],
  previousQuantities: new Map(), // batchId -> qty (to detect live shopper claims)
  agentAuditLogs: [],
  activeFilter: 'ALL',
  searchQuery: '',
  isPolling: true,
  isConnected: false,
  lastSyncTimestamp: null,
  pollTimer: null,
  isAuditRunning: false
};

// Initial Standby Demo Batches (Shown before Laptop 1 connection is established)
const STANDBY_DEMO_BATCHES = [
  {
    _id: "BATCH-101",
    merchant_name: "FreshMart Supermarket - Panvel",
    sku_name: "Amul Taaza Homogenized Milk (1L)",
    category: "DAIRY",
    quantity: 30,
    unit: "packs",
    wholesale_cost: 48.0,
    retail_price: 56.0,
    current_price: 56.0,
    hours_to_expiry: 14,
    max_recorded_temp_c: 3.8,
    safe_temp_limit_c: 4.0,
    status: "ACTIVE"
  },
  {
    _id: "BATCH-102",
    merchant_name: "FreshMart Supermarket - Panvel",
    sku_name: "Theobroma Fresh Artisan Croissants (Pack of 2)",
    category: "BAKERY",
    quantity: 14,
    unit: "packs",
    wholesale_cost: 85.0,
    retail_price: 160.0,
    current_price: 96.0,
    hours_to_expiry: 8,
    max_recorded_temp_c: 22.0,
    safe_temp_limit_c: 25.0,
    status: "MARKED_DOWN"
  },
  {
    _id: "BATCH-103",
    merchant_name: "FreshMart Supermarket - Panvel",
    sku_name: "Epigamia Greek Yogurt Wild Blueberry (100g)",
    category: "DAIRY",
    quantity: 18,
    unit: "packs",
    wholesale_cost: 38.0,
    retail_price: 60.0,
    current_price: 60.0,
    hours_to_expiry: 11,
    max_recorded_temp_c: 8.6,
    safe_temp_limit_c: 4.0,
    status: "BIOGAS_QUARANTINE"
  },
  {
    _id: "BATCH-104",
    merchant_name: "FreshMart Supermarket - Panvel",
    sku_name: "Fresh Cuts Mixed Bell Peppers & Baby Spinach (300g)",
    category: "PRODUCE",
    quantity: 12,
    unit: "trays",
    wholesale_cost: 40.0,
    retail_price: 85.0,
    current_price: 0.0,
    hours_to_expiry: 5,
    max_recorded_temp_c: 7.2,
    safe_temp_limit_c: 10.0,
    status: "DONATED"
  }
];

// Document Initialization
document.addEventListener('DOMContentLoaded', () => {
  initPOS();
});

function initPOS() {
  // 1. Initialize Backend URL Input
  const urlInput = document.getElementById('backendUrl');
  if (urlInput) {
    urlInput.value = state.backendUrl;
    urlInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') applyBackendUrl();
    });
  }

  // 2. Start Store Clock
  startStoreClock();

  // 3. Preload initial fallback batches so screen looks active immediately
  state.inventoryBatches = [...STANDBY_DEMO_BATCHES];
  state.inventoryBatches.forEach(b => state.previousQuantities.set(b._id || b.id, b.quantity));
  renderUI();

  // 4. Start Polling Loop (every 2 seconds)
  startPolling();

  // 5. Update Loading Display
  const loadingDisplay = document.getElementById('loadingUrlDisplay');
  if (loadingDisplay) loadingDisplay.textContent = state.backendUrl;
}

/* ==========================================================================
   TIME & CLOCK
   ========================================================================== */
function startStoreClock() {
  const clockEl = document.getElementById('liveClock');
  const updateClock = () => {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-IN', { hour12: false });
    if (clockEl) {
      clockEl.textContent = `${timeStr} IST`;
    }
  };
  updateClock();
  setInterval(updateClock, 1000);
}

/* ==========================================================================
   BACKEND URL CONFIG & CONNECT
   ========================================================================== */
function cleanUrl(url) {
  if (!url) return 'http://localhost:8000';
  url = url.trim();
  if (!/^https?:\/\//i.test(url)) {
    url = 'http://' + url;
  }
  return url.replace(/\/+$/, '');
}

function applyBackendUrl() {
  const urlInput = document.getElementById('backendUrl');
  if (!urlInput) return;

  const rawUrl = urlInput.value;
  const cleaned = cleanUrl(rawUrl);
  state.backendUrl = cleaned;
  localStorage.setItem('freshmart_backend_url', cleaned);
  urlInput.value = cleaned;

  showToast(`Updated ZeroSpoil Server URL to ${cleaned}`, 'info', '📡 Configuration Saved');

  // Trigger immediate poll
  forceRefresh();
}

function forceRefresh() {
  setConnectionStatus('connecting', 'POLLING SERVER...');
  fetchStoreState();
}

/* ==========================================================================
   POLLING & API DATA FETCHING (GET /api/state)
   ========================================================================== */
function startPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  fetchStoreState(); // initial fetch
  state.pollTimer = setInterval(fetchStoreState, 2000);
}

async function fetchStoreState() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1900);

    const response = await fetch(`${state.backendUrl}/api/state`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP Error ${response.status}`);
    }

    const data = await response.json();
    handleStateSuccess(data);

  } catch (error) {
    handleStateFailure(error);
  }
}

function handleStateSuccess(data) {
  state.isConnected = true;
  state.lastSyncTimestamp = Date.now();

  // Parse inventory_batches
  if (Array.isArray(data.inventory_batches)) {
    detectStockDecrements(data.inventory_batches);
    state.inventoryBatches = data.inventory_batches;
  } else if (Array.isArray(data)) {
    detectStockDecrements(data);
    state.inventoryBatches = data;
  }

  // Parse agent_audit_logs
  if (Array.isArray(data.agent_audit_logs)) {
    state.agentAuditLogs = data.agent_audit_logs;
  }

  setConnectionStatus('connected', `CONNECTED — Synced just now`);
  renderUI();
}

function handleStateFailure(error) {
  state.isConnected = false;
  setConnectionStatus('disconnected', `STANDALONE TEST MODE (Laptop 1 Offline)`);
  
  const syncText = document.getElementById('lastSyncedText');
  if (syncText) {
    syncText.textContent = 'Operating locally in Sandbox (All features active)';
  }
}

function setConnectionStatus(type, message) {
  const dot = document.getElementById('connDot');
  const text = document.getElementById('connStatusText');

  if (dot) {
    dot.className = 'status-dot';
    if (type === 'connected') dot.classList.add('dot-connected');
    else if (type === 'connecting') dot.classList.add('dot-connecting');
    else dot.classList.add('dot-disconnected');
  }

  if (text) {
    text.textContent = message;
    if (type === 'connected') text.style.color = '#34d399';
    else if (type === 'connecting') text.style.color = '#f59e0b';
    else text.style.color = '#f87171';
  }

  updateConnectionText();
}

function updateConnectionText() {
  const syncText = document.getElementById('lastSyncedText');
  if (!syncText) return;

  if (!state.lastSyncTimestamp) {
    syncText.textContent = 'Awaiting connection to Laptop 1...';
    return;
  }

  const secondsAgo = Math.max(0, Math.floor((Date.now() - state.lastSyncTimestamp) / 1000));
  if (secondsAgo === 0) {
    syncText.textContent = 'Synced < 1s ago';
  } else {
    syncText.textContent = `Synced ${secondsAgo}s ago`;
  }
}

// Check if any item's stock was claimed in real time (e.g. from Laptop 1 consumer feed)
function detectStockDecrements(newBatches) {
  newBatches.forEach(batch => {
    const batchId = batch._id || batch.id;
    if (!batchId) return;

    const oldQty = state.previousQuantities.get(batchId);
    if (oldQty !== undefined && batch.quantity < oldQty) {
      const drop = oldQty - batch.quantity;
      showToast(
        `Shopper claimed deal on ${batch.sku_name}! Stock decremented from ${oldQty} to ${batch.quantity} ${batch.unit || 'packs'} (-${drop})`,
        'success',
        '🛒 LIVE DEAL CLAIM DETECTED'
      );
      // Mark for row visual flash
      triggerRowHighlight(batchId);
    }
    state.previousQuantities.set(batchId, batch.quantity);
  });
}

function triggerRowHighlight(batchId) {
  setTimeout(() => {
    const row = document.querySelector(`tr[data-batch-id="${batchId}"] .stock-value`);
    if (row) {
      row.classList.remove('stock-decremented');
      void row.offsetWidth; // trigger reflow
      row.classList.add('stock-decremented');
    }
  }, 50);
}

/* ==========================================================================
   RENDER PIPELINE (DOM DIFFING / NO FLICKER)
   ========================================================================== */
function renderUI() {
  renderKPIs();
  renderTable();
  renderTicker();
}

function renderKPIs() {
  const batches = state.inventoryBatches || [];
  
  // Total SKUs
  const totalCount = batches.length;
  const activeCount = batches.filter(b => b.status === 'ACTIVE').length;
  
  // Near-Expiry Value (batches <= 24 hours to expiry)
  let nearExpiryValue = 0;
  let nearExpiryCount = 0;
  batches.forEach(b => {
    const hours = Number(b.hours_to_expiry) || 0;
    const price = Number(b.retail_price) || 0;
    const qty = Number(b.quantity) || 0;
    if (hours <= 24 && b.status !== 'DONATED' && b.status !== 'BIOGAS_QUARANTINE') {
      nearExpiryValue += (price * qty);
      nearExpiryCount++;
    }
  });

  // Auto-Cleared / Rescued (MARKED_DOWN + DONATED)
  const markedDownCount = batches.filter(b => b.status === 'MARKED_DOWN').length;
  const donatedCount = batches.filter(b => b.status === 'DONATED').length;
  const rescuedTotal = markedDownCount + donatedCount;

  // Cold-Chain Quarantined Alerts
  const quarantinedCount = batches.filter(b => 
    b.status === 'BIOGAS_QUARANTINE' || 
    (Number(b.max_recorded_temp_c) > Number(b.safe_temp_limit_c))
  ).length;

  // Update DOM Elements
  const elTotal = document.getElementById('kpiTotalSkus');
  const elActive = document.getElementById('kpiActiveSkus');
  if (elTotal) elTotal.textContent = totalCount;
  if (elActive) elActive.textContent = `${activeCount} Active Shelf Batches`;

  const elRiskVal = document.getElementById('kpiAtRiskValue');
  const elRiskCount = document.getElementById('kpiAtRiskCount');
  if (elRiskVal) elRiskVal.textContent = `₹${nearExpiryValue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (elRiskCount) elRiskCount.textContent = `${nearExpiryCount} batches ≤ 24h to expiry`;

  const elRescued = document.getElementById('kpiRescuedCount');
  const elRescuedDetail = document.getElementById('kpiRescuedDetail');
  if (elRescued) elRescued.textContent = rescuedTotal;
  if (elRescuedDetail) elRescuedDetail.textContent = `${markedDownCount} Marked Down • ${donatedCount} Donated`;

  const elQuarantine = document.getElementById('kpiQuarantineCount');
  const elQuarantineDetail = document.getElementById('kpiQuarantineDetail');
  const cardQuarantine = document.getElementById('kpiQuarantineCard');
  if (elQuarantine) elQuarantine.textContent = quarantinedCount;
  if (elQuarantineDetail) elQuarantineDetail.textContent = `${quarantinedCount} Quarantined (Temp > Limit)`;

  if (cardQuarantine) {
    if (quarantinedCount > 0) {
      cardQuarantine.classList.add('has-breaches');
    } else {
      cardQuarantine.classList.remove('has-breaches');
    }
  }
}

function renderTable() {
  const tbody = document.getElementById('inventoryTableBody');
  if (!tbody) return;

  const allBatches = state.inventoryBatches || [];

  // Filter batches
  let filtered = allBatches.filter(batch => {
    // Status Filter
    if (state.activeFilter === 'ACTIVE' && batch.status !== 'ACTIVE') return false;
    if (state.activeFilter === 'MARKED_DOWN' && batch.status !== 'MARKED_DOWN') return false;
    if (state.activeFilter === 'DONATED' && batch.status !== 'DONATED') return false;
    if (state.activeFilter === 'BIOGAS_QUARANTINE' && batch.status !== 'BIOGAS_QUARANTINE') return false;
    if (state.activeFilter === 'BREACH') {
      const isBreached = Number(batch.max_recorded_temp_c) > Number(batch.safe_temp_limit_c);
      if (!isBreached) return false;
    }

    // Search Query
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      const id = (batch._id || batch.id || '').toLowerCase();
      const name = (batch.sku_name || '').toLowerCase();
      const cat = (batch.category || '').toLowerCase();
      if (!id.includes(q) && !name.includes(q) && !cat.includes(q)) {
        return false;
      }
    }

    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" class="text-center py-8" style="padding: 32px 0; color: #64748b;">
          <div>No inventory batches matching current filter (<strong>${state.activeFilter}</strong>).</div>
        </td>
      </tr>
    `;
    return;
  }

  // Smart Keyed DOM Updating (Preserves buttons, avoids full flicker)
  const existingRows = new Map();
  tbody.querySelectorAll('tr[data-batch-id]').forEach(tr => {
    existingRows.set(tr.getAttribute('data-batch-id'), tr);
  });

  // Track rows to keep
  const newRowElements = [];

  filtered.forEach(batch => {
    const batchId = batch._id || batch.id || `BATCH-${Math.random()}`;
    let tr = existingRows.get(batchId);

    if (!tr) {
      tr = document.createElement('tr');
      tr.setAttribute('data-batch-id', batchId);
    }

    tr.innerHTML = generateRowHtml(batch, batchId);
    newRowElements.push(tr);
  });

  // Replace tbody content smoothly
  tbody.replaceChildren(...newRowElements);
}

function generateRowHtml(batch, batchId) {
  const currentPrice = Number(batch.current_price) ?? Number(batch.retail_price);
  const retailPrice = Number(batch.retail_price) || 0;
  const wholesaleCost = Number(batch.wholesale_cost) || 0;
  const maxTemp = Number(batch.max_recorded_temp_c) || 0;
  const safeTemp = Number(batch.safe_temp_limit_c) || 4.0;
  const hoursLeft = Number(batch.hours_to_expiry) || 0;
  const status = batch.status || 'ACTIVE';
  const isBreached = maxTemp > safeTemp;

  // Price Calculation & Strikethrough
  let priceHtml = '';
  if (status === 'MARKED_DOWN' || currentPrice < retailPrice) {
    const pct = retailPrice > 0 ? Math.round(((retailPrice - currentPrice) / retailPrice) * 100) : 0;
    priceHtml = `
      <div class="price-display">
        <span class="strikethrough-price">₹${retailPrice.toFixed(2)}</span>
        <span class="markdown-price-pill">₹${currentPrice.toFixed(2)}</span>
        <span class="discount-tag">(-${pct}% AUTO-MARKDOWN)</span>
      </div>
    `;
  } else {
    priceHtml = `
      <div class="price-display">
        <span class="regular-price">₹${retailPrice.toFixed(2)}</span>
      </div>
    `;
  }

  // Chiller Sensor Badge
  let tempBadgeHtml = '';
  if (isBreached) {
    tempBadgeHtml = `
      <span class="temp-badge temp-breach" title="Temperature exceeded safe threshold of ${safeTemp}°C!">
        <span>⚠️</span> ${maxTemp.toFixed(1)}°C BREACH (Max ${safeTemp.toFixed(1)}°C)
      </span>
    `;
  } else {
    tempBadgeHtml = `
      <span class="temp-badge temp-normal">
        <span>✓</span> ${maxTemp.toFixed(1)}°C (Limit &le;${safeTemp.toFixed(1)}°C)
      </span>
    `;
  }

  // Expiry Pill
  let expiryClass = 'expiry-safe';
  if (hoursLeft <= 12) expiryClass = 'expiry-urgent';
  else if (hoursLeft <= 24) expiryClass = 'expiry-warn';

  // Status Badge
  let statusBadgeHtml = '';
  switch (status) {
    case 'MARKED_DOWN':
      statusBadgeHtml = `
        <div class="status-pill status-MARKED_DOWN">
          <strong>MARKED DOWN</strong>
          <small>Live on ZeroSpoil Feed</small>
        </div>
      `;
      break;
    case 'DONATED':
      statusBadgeHtml = `
        <div class="status-pill status-DONATED">
          <strong>DONATED</strong>
          <small>NGO Pickup Booked</small>
        </div>
      `;
      break;
    case 'BIOGAS_QUARANTINE':
      statusBadgeHtml = `
        <div class="status-pill status-BIOGAS_QUARANTINE">
          <strong>QUARANTINED</strong>
          <small>Blocked: Unsafe Temp</small>
        </div>
      `;
      break;
    case 'PENDING_HITL':
      statusBadgeHtml = `
        <div class="status-pill status-PENDING_HITL">
          <strong>PENDING HITL</strong>
          <small>Manager Margin Review</small>
        </div>
      `;
      break;
    case 'ACTIVE':
    default:
      statusBadgeHtml = `
        <div class="status-pill status-ACTIVE">
          <strong>ACTIVE</strong>
          <small>Standard Shelf Inventory</small>
        </div>
      `;
      break;
  }

  // Row Action Button
  const isSpikeDisabled = isBreached || status === 'BIOGAS_QUARANTINE';

  return `
    <td>
      <span class="sku-badge">${batchId}</span>
    </td>
    <td>
      <div class="product-cell">
        <span class="product-name">${escapeHtml(batch.sku_name || 'Unnamed SKU')}</span>
        <span class="cat-pill cat-${batch.category || 'DAIRY'}">${batch.category || 'DAIRY'}</span>
      </div>
    </td>
    <td class="text-right">
      <span class="stock-value">${batch.quantity}</span>
      <span class="stock-unit">${batch.unit || 'packs'}</span>
    </td>
    <td class="text-right">
      <span class="cost-value">₹${wholesaleCost.toFixed(2)}</span>
    </td>
    <td class="text-right">
      ${priceHtml}
    </td>
    <td>
      ${tempBadgeHtml}
    </td>
    <td>
      <span class="expiry-pill ${expiryClass}">${hoursLeft}h left</span>
    </td>
    <td>
      ${statusBadgeHtml}
    </td>
    <td class="text-center">
      <button 
        type="button" 
        class="btn-temp-spike" 
        onclick="triggerChillerFault('${batchId}')"
        ${isSpikeDisabled ? 'disabled title="Batch is already in temperature breach or quarantined"' : 'title="Simulate chiller breakdown (+5°C spike)"'}
      >
        <span>🔥</span> +5°C Chiller Fault
      </button>
    </td>
  `;
}

function renderTicker() {
  const feed = document.getElementById('tickerFeed');
  const countBadge = document.getElementById('tickerCount');
  if (!feed) return;

  const logs = state.agentAuditLogs || [];
  if (countBadge) countBadge.textContent = `${logs.length} Events Logged`;

  if (logs.length === 0) {
    feed.innerHTML = `
      <div class="ticker-empty">
        Waiting for live autonomous audit stream from Laptop 1 ZeroSpoil Server...
      </div>
    `;
    return;
  }

  // Display the 4 most recent events (reversed)
  const recentLogs = [...logs].reverse().slice(0, 4);

  feed.innerHTML = recentLogs.map(log => {
    let action = '';
    let details = '';
    let timeStr = new Date().toLocaleTimeString('en-IN', { hour12: false });
    let railClass = 'rail-audit';
    let tagClass = 'tag-audit';
    let tagText = 'AUDIT';

    if (typeof log === 'string') {
      details = log;
      if (log.toLowerCase().includes('quarantine') || log.toLowerCase().includes('breach') || log.toLowerCase().includes('temp')) {
        railClass = 'rail-breach';
        tagClass = 'tag-quarantine';
        tagText = 'SAFETY RAIL';
      } else if (log.toLowerCase().includes('markdown') || log.toLowerCase().includes('discount') || log.toLowerCase().includes('%')) {
        railClass = 'rail-pricing';
        tagClass = 'tag-markdown';
        tagText = 'DYNAMIC PRICING';
      } else if (log.toLowerCase().includes('ngo') || log.toLowerCase().includes('rescue') || log.toLowerCase().includes('donat')) {
        railClass = 'rail-ngo';
        tagClass = 'tag-donation';
        tagText = 'NGO RESCUE';
      }
    } else if (typeof log === 'object' && log !== null) {
      action = log.action || log.event || 'AUDIT_ACTION';
      details = log.message || log.description || log.sku_name || JSON.stringify(log);
      if (log.timestamp) {
        timeStr = new Date(log.timestamp).toLocaleTimeString('en-IN', { hour12: false });
      }
      if (action.includes('QUARANTINE') || details.includes('Unsafe') || details.includes('Temp')) {
        railClass = 'rail-breach';
        tagClass = 'tag-quarantine';
        tagText = 'SAFETY RAIL';
      } else if (action.includes('MARKDOWN') || details.includes('Markdown')) {
        railClass = 'rail-pricing';
        tagClass = 'tag-markdown';
        tagText = 'DYNAMIC PRICING';
      } else if (action.includes('DONAT') || details.includes('NGO')) {
        railClass = 'rail-ngo';
        tagClass = 'tag-donation';
        tagText = 'NGO DISPATCH';
      }
    }

    return `
      <div class="ticker-item ${railClass}">
        <span class="ticker-time">${timeStr}</span>
        <span class="ticker-tag ${tagClass}">${tagText}</span>
        <span class="ticker-desc">${escapeHtml(details)}</span>
      </div>
    `;
  }).join('');
}

/* ==========================================================================
   ACTIONS: CHILLER FAULT SIMULATION (POST /api/pos/batches/{id}/temp-spike)
   ========================================================================== */
async function triggerChillerFault(batchId) {
  const btn = document.querySelector(`tr[data-batch-id="${batchId}"] .btn-temp-spike`);
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner spinner-dark" style="width:12px;height:12px;"></span> Spiking...`;
  }

  showToast(
    `Injecting +5°C temperature spike into cold-chiller bay for ${batchId}...`,
    'warning',
    '❄️ SENSOR FAULT TRIGGERED'
  );

  try {
    const response = await fetch(`${state.backendUrl}/api/pos/batches/${encodeURIComponent(batchId)}/temp-spike`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ temp_spike_c: 9.5 })
    });

    if (!response.ok) {
      throw new Error(`Server returned HTTP ${response.status}`);
    }

    showToast(
      `Sensor breach registered! ${batchId} reported 9.5°C (Limit ≤4.0°C). ZeroSpoil Safety Rail alerted!`,
      'danger',
      '🚨 COLD-CHAIN BREACH CONFIRMED'
    );

    // Immediate state fetch to update table and alert status
    await fetchStoreState();

  } catch (error) {
    // If backend isn't responding, simulate the spike locally for flawless live demo reliability
    console.warn('Backend temp spike endpoint unreachable, applying demo simulation:', error);
    applyLocalTempSpike(batchId);
  }
}

function applyLocalTempSpike(batchId) {
  const target = state.inventoryBatches.find(b => (b._id || b.id) === batchId);
  if (target) {
    target.max_recorded_temp_c = 9.5;
    target.status = 'BIOGAS_QUARANTINE';
    state.agentAuditLogs.push({
      action: 'SAFETY_RAIL_BLOCK',
      message: `Safety Rail Triggered: ${batchId} (${target.sku_name}) breached cold-chain threshold at 9.5°C. Quarantined for Biogas/Compost.`,
      timestamp: new Date().toISOString()
    });
    renderUI();
    showToast(
      `${batchId} recorded 9.5°C spike. Safety Rail blocked item from sale!`,
      'danger',
      '🚨 COLD-CHAIN BREACH SIMULATED'
    );
  }
}

/* ==========================================================================
   ACTIONS: RUN 7:00 PM AUTONOMOUS CLEARANCE AUDIT
   (POST /api/agent/run-pos-audit)
   ========================================================================== */
async function triggerAutoClearance() {
  if (state.isAuditRunning) return;

  const btn = document.getElementById('btnRunAudit');
  const spinner = document.getElementById('auditSpinner');

  state.isAuditRunning = true;
  if (btn) btn.disabled = true;
  if (spinner) spinner.classList.remove('hidden');

  showToast(
    'Running autonomous clearance audit across all Panvel Store inventory batches...',
    'info',
    '⚡ 7:00 PM AUDIT INITIATED'
  );

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(`${state.backendUrl}/api/agent/run-pos-audit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ store_id: "FM-PNV-04", audit_time: "19:00:00" }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Server returned HTTP ${response.status}`);
    }

    const result = await response.json();
    handleAuditResult(result);

    // Refresh state immediately to display new marked-down prices and badges
    await fetchStoreState();

  } catch (error) {
    console.warn('Backend run-pos-audit unreachable or failed, applying demo clearance:', error);
    applyLocalAudit();
  } finally {
    state.isAuditRunning = false;
    if (btn) btn.disabled = false;
    if (spinner) spinner.classList.add('hidden');
  }
}

function handleAuditResult(result) {
  let markdowns = result.marked_down_count ?? result.markdowns ?? 0;
  let donations = result.donated_count ?? result.donations ?? 0;
  let blocks = result.quarantined_count ?? result.safety_blocks ?? 0;

  // If specific counts aren't in response root, summarize from audits array if present
  if (Array.isArray(result.actions)) {
    markdowns = result.actions.filter(a => (a.action || '').includes('MARKDOWN')).length;
    donations = result.actions.filter(a => (a.action || '').includes('DONAT')).length;
    blocks = result.actions.filter(a => (a.action || '').includes('QUARANTINE')).length;
  }

  showToast(
    `Audit Executed: ${markdowns} Dynamic Markdowns Applied, ${donations} NGO Rescues Booked, ${blocks} Safety-Rail Blocks Enforced.`,
    'success',
    '⚡ 7:00 PM CLEARANCE COMPLETE'
  );
}

function applyLocalAudit() {
  let markdowns = 0;
  let donations = 0;
  let blocks = 0;

  state.inventoryBatches.forEach(b => {
    if (b.status === 'ACTIVE') {
      const hours = Number(b.hours_to_expiry) || 0;
      const temp = Number(b.max_recorded_temp_c) || 0;
      const safe = Number(b.safe_temp_limit_c) || 4.0;

      if (temp > safe) {
        b.status = 'BIOGAS_QUARANTINE';
        blocks++;
      } else if (hours <= 6) {
        b.status = 'DONATED';
        b.current_price = 0.0;
        donations++;
      } else if (hours <= 16) {
        b.status = 'MARKED_DOWN';
        b.current_price = Math.round(Number(b.retail_price) * 0.6); // 40% discount
        markdowns++;
      }
    }
  });

  state.agentAuditLogs.push({
    action: '7PM_CLEARANCE_AUDIT',
    message: `Autonomous Audit: Evaluated shelf-life. Applied ${markdowns} dynamic markdowns, booked ${donations} NGO rescues, enforced ${blocks} safety blocks.`,
    timestamp: new Date().toISOString()
  });

  renderUI();

  showToast(
    `Autonomous Audit: ${markdowns} Markdowns, ${donations} NGO Rescues, ${blocks} Safety Blocks.`,
    'success',
    '⚡ 7:00 PM CLEARANCE COMPLETE (LOCAL SYNC)'
  );
}

/* ==========================================================================
   ACTIONS: INWARD NEAR-EXPIRY STOCK (POST /api/pos/batches)
   ========================================================================== */
async function handleInwardSubmit(event) {
  event.preventDefault();

  const btn = document.getElementById('btnSubmitBatch');
  if (btn) btn.disabled = true;

  const payload = {
    sku_name: document.getElementById('skuName').value.trim(),
    category: document.getElementById('category').value,
    quantity: parseInt(document.getElementById('quantity').value, 10),
    unit: document.getElementById('unit').value,
    wholesale_cost: parseFloat(document.getElementById('wholesaleCost').value),
    retail_price: parseFloat(document.getElementById('retailPrice').value),
    hours_to_expiry: parseInt(document.getElementById('hoursToExpiry').value, 10),
    max_recorded_temp_c: parseFloat(document.getElementById('maxTemp').value),
    safe_temp_limit_c: parseFloat(document.getElementById('safeTemp').value)
  };

  showToast(`Inwarding batch "${payload.sku_name}" to POS terminal...`, 'info', '📥 RECEIVING DOCK');

  try {
    const response = await fetch(`${state.backendUrl}/api/pos/batches`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Server returned HTTP ${response.status}`);
    }

    const created = await response.json();
    const batchId = created._id || created.id || 'NEW-BATCH';

    showToast(
      `Successfully inwarded ${payload.quantity} ${payload.unit} of "${payload.sku_name}" (${batchId})!`,
      'success',
      '✅ STOCK INWARDED'
    );

    resetInwardForm();
    await fetchStoreState();

  } catch (error) {
    console.warn('Backend inward endpoint unreachable, adding locally for demo:', error);
    applyLocalInward(payload);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function applyLocalInward(payload) {
  const newId = `BATCH-${100 + state.inventoryBatches.length + 1}`;
  const isBreached = payload.max_recorded_temp_c > payload.safe_temp_limit_c;

  const newBatch = {
    _id: newId,
    merchant_name: "FreshMart Supermarket - Panvel",
    ...payload,
    current_price: payload.retail_price,
    status: isBreached ? "BIOGAS_QUARANTINE" : "ACTIVE"
  };

  state.inventoryBatches.unshift(newBatch);
  state.previousQuantities.set(newId, newBatch.quantity);

  state.agentAuditLogs.push({
    action: 'INWARD_BATCH',
    message: `Received batch ${newId} (${newBatch.sku_name}) — Qty: ${newBatch.quantity} ${newBatch.unit}. Sensor temp: ${newBatch.max_recorded_temp_c}°C.`,
    timestamp: new Date().toISOString()
  });

  renderUI();
  resetInwardForm();

  showToast(
    `Locally recorded ${newBatch.quantity} ${newBatch.unit} of ${newBatch.sku_name} (${newId})!`,
    'success',
    '✅ STOCK INWARDED'
  );
}

/* ==========================================================================
   FORM PRESETS & HELPERS
   ========================================================================== */
const PRESETS = {
  BAKERY_SAFE: {
    sku_name: 'Artisan Multigrain Sourdough Boule (500g)',
    category: 'BAKERY',
    quantity: 18,
    unit: 'packs',
    wholesale_cost: 45.0,
    retail_price: 95.0,
    hours_to_expiry: 14,
    max_recorded_temp_c: 21.0,
    safe_temp_limit_c: 25.0
  },
  WARM_DAIRY: {
    sku_name: 'Mother Dairy Cream Yogurt Strawberry (200g)',
    category: 'DAIRY',
    quantity: 26,
    unit: 'packs',
    wholesale_cost: 35.0,
    retail_price: 58.0,
    hours_to_expiry: 10,
    max_recorded_temp_c: 8.8, // Spike > 4.0
    safe_temp_limit_c: 4.0
  },
  PRODUCE_DISCOUNT: {
    sku_name: 'Hydroponic Baby Spinach Crisp (250g)',
    category: 'PRODUCE',
    quantity: 20,
    unit: 'packs',
    wholesale_cost: 28.0,
    retail_price: 65.0,
    hours_to_expiry: 16,
    max_recorded_temp_c: 7.2,
    safe_temp_limit_c: 10.0
  }
};

function fillPreset(presetKey) {
  const preset = PRESETS[presetKey];
  if (!preset) return;

  document.getElementById('skuName').value = preset.sku_name;
  document.getElementById('category').value = preset.category;
  document.getElementById('quantity').value = preset.quantity;
  document.getElementById('unit').value = preset.unit;
  document.getElementById('wholesaleCost').value = preset.wholesale_cost;
  document.getElementById('retailPrice').value = preset.retail_price;
  document.getElementById('hoursToExpiry').value = preset.hours_to_expiry;
  document.getElementById('maxTemp').value = preset.max_recorded_temp_c;
  document.getElementById('safeTemp').value = preset.safe_temp_limit_c;

  showToast(`Loaded "${preset.sku_name}" preset data into receiving dock.`, 'info', '⚡ PRESET LOADED');
}

function handleCategoryChange() {
  const category = document.getElementById('category').value;
  const safeTempInput = document.getElementById('safeTemp');
  const maxTempInput = document.getElementById('maxTemp');

  switch (category) {
    case 'DAIRY':
      safeTempInput.value = '4.0';
      maxTempInput.value = '3.5';
      break;
    case 'BAKERY':
      safeTempInput.value = '25.0';
      maxTempInput.value = '22.0';
      break;
    case 'PRODUCE':
      safeTempInput.value = '10.0';
      maxTempInput.value = '7.5';
      break;
    case 'READY_TO_EAT':
      safeTempInput.value = '5.0';
      maxTempInput.value = '3.8';
      break;
  }
}

function resetInwardForm() {
  const form = document.getElementById('inwardForm');
  if (form) form.reset();
  handleCategoryChange();
}

/* ==========================================================================
   TABLE FILTERS & SEARCH
   ========================================================================== */
function setFilter(filterType) {
  state.activeFilter = filterType;

  // Update pills UI
  const pills = document.querySelectorAll('#filterPills .pill');
  pills.forEach(pill => {
    if (pill.getAttribute('data-filter') === filterType) {
      pill.classList.add('active');
    } else {
      pill.classList.remove('active');
    }
  });

  renderTable();
}

function handleSearch(query) {
  state.searchQuery = query.trim();
  renderTable();
}

/* ==========================================================================
   TOAST NOTIFICATION ENGINE
   ========================================================================== */
function showToast(message, type = 'info', title = '') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  let icon = 'ℹ️';
  if (type === 'success') icon = '✅';
  if (type === 'danger') icon = '🚨';
  if (type === 'warning') icon = '⚠️';

  toast.innerHTML = `
    <div class="toast-icon">${icon}</div>
    <div class="toast-content">
      ${title ? `<div class="toast-title">${escapeHtml(title)}</div>` : ''}
      <div class="toast-msg">${escapeHtml(message)}</div>
    </div>
  `;

  container.appendChild(toast);

  // Auto remove
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 250);
  }, 4200);
}

/* ==========================================================================
   STANDALONE TESTING & SIMULATION CONTROLS (FOR LAPTOP 2)
   ========================================================================== */
function simulateShopperClaim() {
  // Find a batch that has stock and preferably marked down or active
  let target = state.inventoryBatches.find(b => b.status === 'MARKED_DOWN' && b.quantity > 0);
  if (!target) {
    target = state.inventoryBatches.find(b => b.quantity > 0);
  }

  if (!target) {
    showToast('No in-stock batches available to claim. Inward new stock first!', 'warning', '🛒 NO STOCK');
    return;
  }

  const batchId = target._id || target.id;
  const oldQty = target.quantity;
  const decrement = Math.min(oldQty, 1);
  const newQty = oldQty - decrement;

  target.quantity = newQty;

  // Trigger real-time decrement detector
  detectStockDecrements(state.inventoryBatches);

  // Add audit log
  state.agentAuditLogs.push({
    action: 'SHOPPER_CLAIM',
    message: `ZeroSpoil Consumer Deal Claim: 1 ${target.unit || 'pack'} of "${target.sku_name}" (${batchId}) purchased by verified shopper. In-store stock auto-synced.`,
    timestamp: new Date().toISOString()
  });

  renderUI();
}

function simulateQuickSpike() {
  // Find an active dairy batch or any batch not yet breached
  let target = state.inventoryBatches.find(b => 
    b.category === 'DAIRY' && 
    Number(b.max_recorded_temp_c) <= Number(b.safe_temp_limit_c)
  );

  if (!target) {
    target = state.inventoryBatches.find(b => 
      Number(b.max_recorded_temp_c) <= Number(b.safe_temp_limit_c)
    );
  }

  if (!target) {
    showToast('All items are already in temperature breach! Click "Reset Demo Data" to test again.', 'info', '❄️ ALL BREACHED');
    return;
  }

  const batchId = target._id || target.id;
  triggerChillerFault(batchId);
}

function resetToDemoBatches() {
  state.inventoryBatches = JSON.parse(JSON.stringify(STANDBY_DEMO_BATCHES));
  state.previousQuantities.clear();
  state.inventoryBatches.forEach(b => state.previousQuantities.set(b._id || b.id, b.quantity));

  state.agentAuditLogs = [
    {
      action: 'SYSTEM_BOOT',
      message: 'FreshMart POS Terminal Bay #02 initialized. Cold-chain IoT sensors active.',
      timestamp: new Date().toISOString()
    }
  ];

  state.activeFilter = 'ALL';
  state.searchQuery = '';

  const searchInput = document.getElementById('searchTable');
  if (searchInput) searchInput.value = '';

  const pills = document.querySelectorAll('#filterPills .pill');
  pills.forEach(pill => {
    if (pill.getAttribute('data-filter') === 'ALL') pill.classList.add('active');
    else pill.classList.remove('active');
  });

  renderUI();
  showToast('Restored initial supermarket stock & sensor telemetry.', 'info', '🔄 DEMO DATA RESET');
}

/* ==========================================================================
   UTILITY HELPERS
   ========================================================================== */
function escapeHtml(str) {
  if (typeof str !== 'string') return String(str);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
