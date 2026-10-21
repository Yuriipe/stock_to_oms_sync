// Dashboard UI Controller
const state = {
  settings: null,
  profiles: [],
  hierarchy: { inventories: [], warehouses: [], priceGroups: [] },
  activeProfile: null
};

// API Helpers
async function api(path, options = {}) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// Navigation Tabs
document.querySelectorAll('.nav-item').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    button.classList.add('active');
    const tabId = 'tab-' + button.dataset.tab;
    document.getElementById(tabId).classList.add('active');

    if (button.dataset.tab === 'logs') loadLogs();
    if (button.dataset.tab === 'mapper') populateMapperProfiles();
  });
});

// Load Initial Data
async function init() {
  try {
    state.settings = await api('/settings');
    document.getElementById('setting-token').value = state.settings.baseLinkerToken || '';
    document.getElementById('setting-autostart').checked = state.settings.autoStartOnBoot;
    document.getElementById('setting-tray').checked = state.settings.minimizeToTray;

    if (state.settings.baseLinkerToken) {
      loadHierarchy();
    }

    await loadProfiles();
  } catch (e) {
    console.error('Init error:', e);
  }
}

// BaseLinker Discovery
async function loadHierarchy() {
  try {
    state.hierarchy = await api('/baselinker/hierarchy');
    const hBox = document.getElementById('bl-hierarchy-info');
    const badgeContainer = document.getElementById('hierarchy-summary-badges');
    hBox.style.display = 'block';
    badgeContainer.innerHTML = `
      <div class="badge-row">
        <span class="badge badge-success">Inventories: ${state.hierarchy.inventories.length}</span>
        <span class="badge badge-success">Warehouses: ${state.hierarchy.warehouses.length}</span>
        <span class="badge badge-success">Price Groups: ${state.hierarchy.priceGroups.length}</span>
      </div>
    `;
    populateModalDropdowns();
  } catch (e) {
    alert('Failed to load BaseLinker hierarchy: ' + e.message);
  }
}

document.getElementById('btn-test-bl').addEventListener('click', async () => {
  const token = document.getElementById('setting-token').value.trim();
  if (!token) return alert('Please enter a BaseLinker token');
  await api('/settings', { method: 'POST', body: JSON.stringify({ baseLinkerToken: token }) });
  await loadHierarchy();
});

document.getElementById('btn-save-settings').addEventListener('click', async () => {
  try {
    const updated = {
      baseLinkerToken: document.getElementById('setting-token').value.trim(),
      autoStartOnBoot: document.getElementById('setting-autostart').checked,
      minimizeToTray: document.getElementById('setting-tray').checked
    };
    await api('/settings', { method: 'POST', body: JSON.stringify(updated) });
    alert('Settings saved successfully!');
  } catch (e) {
    alert('Error saving settings: ' + e.message);
  }
});

// Profiles
async function loadProfiles() {
  state.profiles = await api('/profiles');
  const container = document.getElementById('profiles-list');

  if (state.profiles.length === 0) {
    container.innerHTML = `
      <div class="panel col-span-full text-center" style="grid-column: 1 / -1; padding: 40px;">
        <h3>No XML Feed Profiles Configured</h3>
        <p style="margin: 10px 0 20px; color: var(--text-muted);">Create your first profile to connect a supplier XML/Atom file to BaseLinker.</p>
        <button class="btn btn-primary" onclick="openProfileModal()">+ Add Your First Feed</button>
      </div>
    `;
    return;
  }

  container.innerHTML = state.profiles.map(p => {
    const statusClass = p.lastSyncStatus === 'success' ? 'badge-success' : p.lastSyncStatus === 'error' ? 'badge-danger' : 'badge-neutral';
    const statusText = p.lastSyncStatus || 'idle';
    return `
      <div class="profile-card">
        <div class="profile-card-header">
          <div>
            <div class="profile-title">${p.name}</div>
            <span class="badge ${statusClass}">${statusText}</span>
          </div>
          <button class="btn btn-secondary" onclick="editProfile('${p.id}')">Edit</button>
        </div>

        <div class="profile-meta">
          <span>Source: <strong>${p.sourceType.toUpperCase()}</strong> (${p.sourcePath})</span>
          <span>Target Inv: <strong>${p.targetInventoryId}</strong> | Wh: <strong>${p.targetWarehouseId}</strong> | PriceGrp: <strong>${p.targetPriceGroupId}</strong></span>
          <span>Match Key: <strong>${p.identifierField.toUpperCase()}</strong> | Interval: <strong>${p.syncIntervalMinutes}m</strong></span>
          <span>Last Run: <strong>${p.lastSyncAt ? new Date(p.lastSyncAt).toLocaleString() : 'Never'}</strong></span>
          ${p.lastSyncMessage ? `<span style="font-size: 11px; color: var(--text-muted);">${p.lastSyncMessage}</span>` : ''}
        </div>

        <div class="profile-card-actions">
          <button class="btn btn-primary" onclick="triggerSync('${p.id}', this)">⚡ Sync Now</button>
          <button class="btn btn-secondary" onclick="goToMapper('${p.id}')">🧩 Edit Mapping</button>
          <button class="btn btn-danger" onclick="deleteProfile('${p.id}')">Delete</button>
        </div>
      </div>
    `;
  }).join('');
}

// Toast Notification System
function showToast(title, message, type = 'info', duration = 5000) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️';

  toast.innerHTML = `
    <div class="toast-icon">${icon}</div>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      <div class="toast-message">${message}</div>
    </div>
  `;

  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 400);
  }, duration);
}

// Trigger Sync with Live Visual Progress
window.triggerSync = async function(id, btnElement) {
  const profile = state.profiles.find(x => x.id === id);
  const name = profile ? profile.name : id;

  let originalHtml = '';
  if (btnElement) {
    originalHtml = btnElement.innerHTML;
    btnElement.innerHTML = `<span class="spin">⚡</span> Syncing...`;
    btnElement.disabled = true;
  }

  showToast('Sync Started', `Syncing "${name}" with BaseLinker...`, 'info', 3000);

  try {
    const res = await api(`/profiles/${id}/sync`, { method: 'POST' });
    if (res.success) {
      showToast(
        'Sync Successful',
        `<strong>${name}</strong>: ${res.message}`,
        'success',
        6000
      );
    } else {
      showToast('Sync Warning', `${name}: ${res.message}`, 'warning', 6000);
    }
    await loadProfiles();
  } catch (e) {
    showToast('Sync Failed', `${name}: ${e.message}`, 'error', 7000);
  } finally {
    if (btnElement) {
      btnElement.innerHTML = originalHtml;
      btnElement.disabled = false;
    }
  }
};

document.getElementById('btn-sync-all').addEventListener('click', async function() {
  const btn = this;
  const originalHtml = btn.innerHTML;
  btn.innerHTML = `<span class="spin">⚡</span> Syncing All...`;
  btn.disabled = true;

  showToast('Bulk Sync Started', 'Executing sync for all enabled feed profiles...', 'info', 3000);

  let successCount = 0;
  let failCount = 0;

  for (const p of state.profiles) {
    if (p.enabled) {
      try {
        const res = await api(`/profiles/${p.id}/sync`, { method: 'POST' });
        if (res.success) {
          successCount++;
          showToast(`Finished: ${p.name}`, res.message, 'success', 5000);
        } else {
          failCount++;
          showToast(`Issue: ${p.name}`, res.message, 'warning', 5000);
        }
      } catch (err) {
        failCount++;
        showToast(`Failed: ${p.name}`, err.message, 'error', 5000);
      }
    }
  }

  btn.innerHTML = originalHtml;
  btn.disabled = false;

  showToast(
    'Bulk Sync Completed',
    `Processed all profiles (${successCount} succeeded, ${failCount} failed).`,
    failCount === 0 ? 'success' : 'warning',
    6000
  );

  loadProfiles();
});

// Profile Modal Management
window.openProfileModal = function() {
  document.getElementById('prof-id').value = '';
  document.getElementById('prof-name').value = '';
  document.getElementById('prof-source-type').value = 'url';
  document.getElementById('prof-source-path').value = '';
  document.getElementById('prof-auth-header').value = '';
  document.getElementById('prof-interval').value = '30';
  document.getElementById('modal-title').textContent = 'Add Feed Profile';
  document.getElementById('profile-modal').style.display = 'flex';
  populateModalDropdowns();
};

document.getElementById('btn-add-profile').addEventListener('click', openProfileModal);
document.getElementById('btn-close-modal').addEventListener('click', () => {
  document.getElementById('profile-modal').style.display = 'none';
});
document.getElementById('btn-cancel-profile').addEventListener('click', () => {
  document.getElementById('profile-modal').style.display = 'none';
});

window.editProfile = function(id) {
  const p = state.profiles.find(x => x.id === id);
  if (!p) return;
  document.getElementById('prof-id').value = p.id;
  document.getElementById('prof-name').value = p.name;
  document.getElementById('prof-source-type').value = p.sourceType;
  document.getElementById('prof-source-path').value = p.sourcePath;
  document.getElementById('prof-auth-header').value = p.authHeader || '';
  document.getElementById('prof-interval').value = p.syncIntervalMinutes;
  document.getElementById('modal-title').textContent = 'Edit Profile: ' + p.name;
  populateModalDropdowns(p.targetInventoryId, p.targetWarehouseId, p.targetPriceGroupId);
  document.getElementById('profile-modal').style.display = 'flex';
};

window.deleteProfile = async function(id) {
  if (!confirm('Are you sure you want to delete this profile?')) return;
  await api(`/profiles/${id}`, { method: 'DELETE' });
  loadProfiles();
};

function populateModalDropdowns(invId, whId, pgId) {
  const invSelect = document.getElementById('prof-inventory');
  const whSelect = document.getElementById('prof-warehouse');
  const pgSelect = document.getElementById('prof-pricegroup');

  invSelect.innerHTML = (state.hierarchy.inventories || []).map(i =>
    `<option value="${i.inventory_id}" ${invId == i.inventory_id ? 'selected' : ''}>${i.name} (ID: ${i.inventory_id})</option>`
  ).join('');

  whSelect.innerHTML = (state.hierarchy.warehouses || []).map(w =>
    `<option value="${w.warehouse_id}" ${whId == w.warehouse_id ? 'selected' : ''}>${w.name} (${w.warehouse_id})</option>`
  ).join('');

  pgSelect.innerHTML = (state.hierarchy.priceGroups || []).map(pg =>
    `<option value="${pg.price_group_id}" ${pgId == pg.price_group_id ? 'selected' : ''}>${pg.name} (${pg.currency})</option>`
  ).join('');
}

document.getElementById('btn-save-profile').addEventListener('click', async () => {
  const id = document.getElementById('prof-id').value;
  const existing = state.profiles.find(x => x.id === id);

  const profileData = {
    id: id || undefined,
    name: document.getElementById('prof-name').value.trim(),
    enabled: true,
    sourceType: document.getElementById('prof-source-type').value,
    sourcePath: document.getElementById('prof-source-path').value.trim(),
    authHeader: document.getElementById('prof-auth-header').value.trim() || undefined,
    targetInventoryId: parseInt(document.getElementById('prof-inventory').value, 10),
    targetWarehouseId: document.getElementById('prof-warehouse').value,
    targetPriceGroupId: parseInt(document.getElementById('prof-pricegroup').value, 10),
    identifierField: document.getElementById('prof-id-field').value,
    syncIntervalMinutes: parseInt(document.getElementById('prof-interval').value, 10) || 30,
    mapping: existing ? existing.mapping : {
      itemTag: 'product',
      identifierField: 'sku',
      skuPath: 'sku',
      eanPath: 'ean',
      pricePath: 'price',
      stockPath: 'stock'
    }
  };

  try {
    await api('/profiles', { method: 'POST', body: JSON.stringify(profileData) });
    document.getElementById('profile-modal').style.display = 'none';
    await loadProfiles();
  } catch (e) {
    alert('Failed to save profile: ' + e.message);
  }
});

// XML Field Mapper Logic
function populateMapperProfiles() {
  const select = document.getElementById('mapper-profile-select');
  select.innerHTML = state.profiles.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  if (state.profiles.length > 0) {
    loadProfileMapping(select.value);
  }
}

document.getElementById('mapper-profile-select').addEventListener('change', (e) => {
  loadProfileMapping(e.target.value);
});

function loadProfileMapping(profileId) {
  const p = state.profiles.find(x => x.id === profileId);
  if (!p) return;
  document.getElementById('map-item-tag').value = p.mapping.itemTag || 'product';
  document.getElementById('map-id-field').value = p.identifierField || 'sku';
  document.getElementById('map-sku-path').value = p.mapping.skuPath || '';
  document.getElementById('map-ean-path').value = p.mapping.eanPath || '';
  document.getElementById('map-price-path').value = p.mapping.pricePath || '';
  document.getElementById('map-stock-path').value = p.mapping.stockPath || '';
  document.getElementById('map-name-path').value = p.mapping.namePath || '';
}

window.goToMapper = function(profileId) {
  document.querySelector('[data-tab="mapper"]').click();
  document.getElementById('mapper-profile-select').value = profileId;
  loadProfileMapping(profileId);
};

// Inspect XML candidate tags
document.getElementById('btn-inspect-xml').addEventListener('click', async () => {
  const profileId = document.getElementById('mapper-profile-select').value;
  const p = state.profiles.find(x => x.id === profileId);
  const sampleXml = document.getElementById('sample-xml-input').value.trim();

  try {
    const payload = {
      sampleXml: sampleXml || undefined,
      sourceType: p ? p.sourceType : 'url',
      sourcePath: p ? p.sourcePath : undefined,
      authHeader: p ? p.authHeader : undefined
    };

    const res = await api('/xml/inspect', { method: 'POST', body: JSON.stringify(payload) });

    const box = document.getElementById('detected-tags-box');
    const list = document.getElementById('detected-tags-list');
    box.style.display = 'block';

    list.innerHTML = res.detectedItemTags.map(t =>
      `<span class="badge-tag" onclick="document.getElementById('map-item-tag').value = '${t}'">${t}</span>`
    ).join('') + '<br><div style="margin-top: 8px;"><strong>Sample Child Tags:</strong></div>' +
    res.sampleProperties.slice(0, 20).map(prop =>
      `<span class="badge-tag" onclick="copyTagToActive('${prop}')">${prop}</span>`
    ).join('');
  } catch (e) {
    alert('Inspection error: ' + e.message);
  }
});

window.copyTagToActive = function(prop) {
  // Convenience helper: set into price/stock/sku depending on name pattern
  if (prop.includes('price')) document.getElementById('map-price-path').value = prop;
  else if (prop.includes('stock') || prop.includes('qty')) document.getElementById('map-stock-path').value = prop;
  else if (prop.includes('sku') || prop.includes('code')) document.getElementById('map-sku-path').value = prop;
  else if (prop.includes('ean') || prop.includes('barcode')) document.getElementById('map-ean-path').value = prop;
  else if (prop.includes('name') || prop.includes('title')) document.getElementById('map-name-path').value = prop;
};

// Preview Mapping
document.getElementById('btn-preview-mapping').addEventListener('click', async () => {
  const profileId = document.getElementById('mapper-profile-select').value;
  const p = state.profiles.find(x => x.id === profileId);
  const sampleXml = document.getElementById('sample-xml-input').value.trim();

  const mapping = {
    itemTag: document.getElementById('map-item-tag').value.trim(),
    identifierField: document.getElementById('map-id-field').value,
    skuPath: document.getElementById('map-sku-path').value.trim(),
    eanPath: document.getElementById('map-ean-path').value.trim(),
    pricePath: document.getElementById('map-price-path').value.trim(),
    stockPath: document.getElementById('map-stock-path').value.trim(),
    namePath: document.getElementById('map-name-path').value.trim() || undefined
  };

  try {
    const res = await api('/xml/preview', {
      method: 'POST',
      body: JSON.stringify({
        sampleXml: sampleXml || undefined,
        sourceType: p ? p.sourceType : 'url',
        sourcePath: p ? p.sourcePath : undefined,
        mapping
      })
    });

    document.getElementById('preview-results-box').style.display = 'block';
    document.getElementById('preview-count').textContent = res.sampleCount;
    const tbody = document.querySelector('#preview-table tbody');
    tbody.innerHTML = res.sampleItems.map(item => `
      <tr>
        <td><strong>${item.identifier}</strong></td>
        <td>${item.sku || '-'}</td>
        <td>${item.ean || '-'}</td>
        <td>${item.price}</td>
        <td>${item.stock}</td>
        <td>${item.name || '-'}</td>
      </tr>
    `).join('');
  } catch (e) {
    alert('Preview error: ' + e.message);
  }
});

// Save Mapping to Profile
document.getElementById('btn-save-mapping').addEventListener('click', async () => {
  const profileId = document.getElementById('mapper-profile-select').value;
  const p = state.profiles.find(x => x.id === profileId);
  if (!p) return alert('No profile selected');

  p.identifierField = document.getElementById('map-id-field').value;
  p.mapping = {
    itemTag: document.getElementById('map-item-tag').value.trim(),
    identifierField: p.identifierField,
    skuPath: document.getElementById('map-sku-path').value.trim(),
    eanPath: document.getElementById('map-ean-path').value.trim(),
    pricePath: document.getElementById('map-price-path').value.trim(),
    stockPath: document.getElementById('map-stock-path').value.trim(),
    namePath: document.getElementById('map-name-path').value.trim() || undefined
  };

  try {
    await api('/profiles', { method: 'POST', body: JSON.stringify(p) });
    alert('Mapping saved successfully to profile: ' + p.name);
    loadProfiles();
  } catch (e) {
    alert('Failed to save mapping: ' + e.message);
  }
});

// Logs
async function loadLogs() {
  try {
    const logs = await api('/logs');
    const tbody = document.getElementById('logs-tbody');
    tbody.innerHTML = logs.map(l => `
      <tr>
        <td>${new Date(l.timestamp).toLocaleString()}</td>
        <td>${l.profileId || 'Global'}</td>
        <td><span class="badge ${l.status === 'success' ? 'badge-success' : 'badge-danger'}">${l.status}</span></td>
        <td>${l.itemsProcessed}</td>
        <td>${l.pricesUpdated}</td>
        <td>${l.stocksUpdated}</td>
        <td>${l.message}</td>
      </tr>
    `).join('');
  } catch (e) {
    console.error('Logs load error:', e);
  }
}

document.getElementById('btn-refresh-logs').addEventListener('click', loadLogs);

// Application Updates Controller
async function checkAppUpdates(isManual = false) {
  const btnTop = document.getElementById('btn-check-updates');
  const btnSettings = document.getElementById('btn-settings-check-update');
  const commitBadge = document.getElementById('app-commit-badge');
  const updateBadge = document.getElementById('app-update-badge');
  const updateBanner = document.getElementById('update-banner');
  const settingCommit = document.getElementById('setting-current-commit');
  const settingBranch = document.getElementById('setting-active-branch');
  const settingStatusBadge = document.getElementById('setting-update-status-badge');
  const btnApply = document.getElementById('btn-settings-apply-update');
  const commitsPreview = document.getElementById('update-commits-preview');
  const commitList = document.getElementById('incoming-commits-list');

  try {
    if (btnTop) btnTop.querySelector('.icon').classList.add('spin');
    if (btnSettings) btnSettings.disabled = true;

    const data = await api('/updates/status');

    if (commitBadge) commitBadge.textContent = `${data.branch}@${data.currentShortCommit}`;
    if (settingCommit) settingCommit.textContent = `${data.currentShortCommit} (${data.currentCommit})`;
    if (settingBranch) settingBranch.textContent = data.branch;

    if (data.hasUpdate) {
      if (updateBadge) updateBadge.style.display = 'inline-block';
      if (updateBanner) {
        updateBanner.style.display = 'flex';
        document.getElementById('update-banner-desc').textContent = 
          `${data.commitsBehind || 1} new commit(s) available on remote '${data.branch}'. Current: ${data.currentShortCommit} ➔ Remote: ${data.remoteShortCommit}`;
      }
      if (settingStatusBadge) {
        settingStatusBadge.innerHTML = `<span class="badge badge-warning">Update Available (${data.commitsBehind} behind)</span>`;
      }
      if (btnApply) btnApply.style.display = 'inline-block';

      if (commitsPreview && commitList && data.commitMessages && data.commitMessages.length > 0) {
        commitsPreview.style.display = 'block';
        commitList.innerHTML = data.commitMessages.map(msg => `<li>${msg}</li>`).join('');
      }

      if (isManual) {
        showToast('Update Available', `Found ${data.commitsBehind} new commit(s) on ${data.branch}`, 'info');
      }
    } else {
      if (updateBadge) updateBadge.style.display = 'none';
      if (updateBanner) updateBanner.style.display = 'none';
      if (settingStatusBadge) {
        settingStatusBadge.innerHTML = `<span class="badge badge-success">Up to date (${data.currentShortCommit})</span>`;
      }
      if (btnApply) btnApply.style.display = 'none';
      if (commitsPreview) commitsPreview.style.display = 'none';

      if (isManual) {
        showToast('Up to Date', `Application is running the latest version (${data.currentShortCommit})`, 'success');
      }
    }
  } catch (err) {
    console.error('Update check error:', err);
    if (isManual) {
      showToast('Update Check Failed', err.message, 'error');
    }
  } finally {
    if (btnTop) btnTop.querySelector('.icon').classList.remove('spin');
    if (btnSettings) btnSettings.disabled = false;
  }
}

async function triggerApplyUpdate() {
  const btnBanner = document.getElementById('btn-banner-update');
  const btnSettings = document.getElementById('btn-settings-apply-update');

  const confirmed = confirm('Are you sure you want to pull the latest code updates and rebuild the application?');
  if (!confirmed) return;

  try {
    if (btnBanner) {
      btnBanner.disabled = true;
      btnBanner.textContent = 'Updating...';
    }
    if (btnSettings) {
      btnSettings.disabled = true;
      btnSettings.textContent = 'Updating & Building...';
    }

    showToast('Updating Application', 'Pulling latest code and building...', 'info');

    const result = await api('/updates/apply', { method: 'POST' });

    showToast('Update Success', `${result.message} Restarting application...`, 'success');

    // Trigger restart
    setTimeout(async () => {
      try {
        await api('/updates/restart', { method: 'POST' });
      } catch (e) {
        // Expected if server shuts down
      }
      // Reload UI after restart
      setTimeout(() => {
        window.location.reload();
      }, 3000);
    }, 1500);

  } catch (err) {
    console.error('Apply update error:', err);
    showToast('Update Failed', err.message, 'error');
    if (btnBanner) {
      btnBanner.disabled = false;
      btnBanner.textContent = '⚡ Update Now';
    }
    if (btnSettings) {
      btnSettings.disabled = false;
      btnSettings.textContent = '⚡ Update Application Now';
    }
  }
}

// Update Event Listeners
document.getElementById('btn-check-updates')?.addEventListener('click', () => checkAppUpdates(true));
document.getElementById('btn-settings-check-update')?.addEventListener('click', () => checkAppUpdates(true));
document.getElementById('btn-banner-update')?.addEventListener('click', triggerApplyUpdate);
document.getElementById('btn-settings-apply-update')?.addEventListener('click', triggerApplyUpdate);
document.getElementById('btn-banner-dismiss')?.addEventListener('click', () => {
  document.getElementById('update-banner').style.display = 'none';
});

// Toast notification helper
function showToast(title, message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <div class="toast-icon">${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</div>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      <div class="toast-message">${message}</div>
    </div>
  `;

  container.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Initialize on page load
init();
checkAppUpdates(false);

