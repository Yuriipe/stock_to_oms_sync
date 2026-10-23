// Kontroler Interfejsu Dashboard (XMLsync)
const state = {
  settings: null,
  profiles: [],
  hierarchy: { inventories: [], warehouses: [], priceGroups: [] },
  activeProfile: null
};

// Pomocnik zapytań API
async function api(path, options = {}) {
  const fetchOptions = { ...options };
  const headers = { 'Content-Type': 'application/json', ...(fetchOptions.headers || {}) };

  if (fetchOptions.body && typeof fetchOptions.body === 'object' && !(fetchOptions.body instanceof FormData)) {
    fetchOptions.body = JSON.stringify(fetchOptions.body);
  }

  const res = await fetch('/api' + path, {
    ...fetchOptions,
    headers
  });

  let data;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    data = await res.json();
  } else {
    const text = await res.text();
    try {
      data = JSON.parse(text);
    } catch {
      const stripped = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      throw new Error(stripped || `Żądanie nie powiodło się (${res.status} ${res.statusText})`);
    }
  }

  if (!res.ok) throw new Error(data.error || `Żądanie nie powiodło się (${res.status} ${res.statusText})`);
  return data;
}

// Zakładki nawigacyjne
const tabTitles = {
  dashboard: 'Profile plików i status synchronizacji',
  mapper: 'Wizualne mapowanie pól XML',
  settings: 'Ustawienia BaseLinker i systemu',
  logs: 'Dziennik zdarzeń i synchronizacji',
  manual: 'Instrukcja obsługi programu'
};

document.querySelectorAll('.nav-item').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    button.classList.add('active');
    const tabId = 'tab-' + button.dataset.tab;
    const tabPane = document.getElementById(tabId);
    if (tabPane) tabPane.classList.add('active');

    const pageTitle = document.getElementById('page-title');
    if (pageTitle && tabTitles[button.dataset.tab]) {
      pageTitle.textContent = tabTitles[button.dataset.tab];
    }

    if (button.dataset.tab === 'logs') loadLogs();
    if (button.dataset.tab === 'mapper') populateMapperProfiles();
  });
});

// Ładowanie początkowych danych
async function init() {
  try {
    state.settings = await api('/settings');
    document.getElementById('setting-token').value = state.settings.baseLinkerToken || '';
    document.getElementById('setting-autostart').checked = state.settings.autoStartOnBoot;
    document.getElementById('setting-tray').checked = state.settings.minimizeToTray;
    if (document.getElementById('setting-github-token')) {
      document.getElementById('setting-github-token').value = state.settings.githubToken || '';
    }
    if (document.getElementById('setting-github-repo')) {
      document.getElementById('setting-github-repo').value = state.settings.updateRepo || 'https://github.com/Yuriipe/stock_to_oms_sync.git';
    }

    if (state.settings.baseLinkerToken) {
      loadHierarchy();
    }

    await loadProfiles();
  } catch (e) {
    console.error('Błąd inicjalizacji:', e);
  }
}

// Pobieranie hierarchii BaseLinker
async function loadHierarchy() {
  try {
    state.hierarchy = await api('/baselinker/hierarchy');
    const hBox = document.getElementById('bl-hierarchy-info');
    const badgeContainer = document.getElementById('hierarchy-summary-badges');
    hBox.style.display = 'block';
    badgeContainer.innerHTML = `
      <div class="badge-row">
        <span class="badge badge-success">Katalogi: ${state.hierarchy.inventories.length}</span>
        <span class="badge badge-success">Magazyny: ${state.hierarchy.warehouses.length}</span>
        <span class="badge badge-success">Grupy cenowe: ${state.hierarchy.priceGroups.length}</span>
      </div>
    `;
    populateModalDropdowns();
  } catch (e) {
    alert('Nie udało się pobrać struktury BaseLinker: ' + e.message);
  }
}

document.getElementById('btn-test-bl').addEventListener('click', async () => {
  const token = document.getElementById('setting-token').value.trim();
  if (!token) return alert('Wprowadź token API BaseLinker');
  await api('/settings', { method: 'POST', body: JSON.stringify({ baseLinkerToken: token }) });
  await loadHierarchy();
});

document.getElementById('btn-save-settings').addEventListener('click', async () => {
  try {
    const updated = {
      baseLinkerToken: document.getElementById('setting-token').value.trim(),
      autoStartOnBoot: document.getElementById('setting-autostart').checked,
      minimizeToTray: document.getElementById('setting-tray').checked,
      githubToken: document.getElementById('setting-github-token')?.value.trim() || '',
      updateRepo: document.getElementById('setting-github-repo')?.value.trim() || ''
    };
    await api('/settings', { method: 'POST', body: JSON.stringify(updated) });
    alert('Ustawienia zostały pomyślnie zapisane!');
    checkAppUpdates(false);
  } catch (e) {
    alert('Błąd podczas zapisywania ustawień: ' + e.message);
  }
});

// Profile plików
async function loadProfiles() {
  state.profiles = await api('/profiles');
  const container = document.getElementById('profiles-list');

  if (state.profiles.length === 0) {
    container.innerHTML = `
      <div class="panel col-span-full text-center" style="grid-column: 1 / -1; padding: 40px;">
        <h3>Brak skonfigurowanych profili XML</h3>
        <p style="margin: 10px 0 20px; color: var(--text-muted);">Utwórz swój pierwszy profil, aby połączyć plik XML/Atom dostawcy z BaseLinkerem.</p>
        <button class="btn btn-primary" onclick="openProfileModal()">+ Dodaj swój pierwszy plik</button>
      </div>
    `;
    return;
  }

  container.innerHTML = state.profiles.map(p => {
    const statusClass = p.lastSyncStatus === 'success' ? 'badge-success' : p.lastSyncStatus === 'error' ? 'badge-danger' : 'badge-neutral';
    const statusText = p.lastSyncStatus === 'success' ? 'Sukces' : p.lastSyncStatus === 'error' ? 'Błąd' : 'Bezczynny';

    // Format price modification description
    const op = p.priceOperator || '*';
    const modVal = p.priceModifierValue !== undefined && p.priceModifierValue !== null ? p.priceModifierValue : (p.priceMultiplier || 1.0);
    const srcCur = p.priceSourceCurrency || p.priceCurrency || 'PLN';
    const tgtCur = p.priceTargetCurrency || 'PLN';
    
    let modText = `${op}${modVal}`;
    if (op === '*' && modVal === 1.0) modText = 'brak modyfikacji (1:1)';
    const currText = srcCur !== tgtCur ? `${srcCur} ➔ ${tgtCur} (NBP)` : srcCur;

    return `
      <div class="profile-card" id="profile-card-${p.id}">
        <div class="profile-card-header">
          <div>
            <div class="profile-title">${p.name}</div>
            <span class="badge ${statusClass}">${statusText}</span>
          </div>
          <button class="btn btn-secondary" onclick="editProfile('${p.id}')">Edytuj</button>
        </div>

        <div class="profile-meta">
          <span>Źródło: <strong>${p.sourceType.toUpperCase()}</strong> (${p.sourcePath})</span>
          <span>Katalog docelowy: <strong>${p.targetInventoryId}</strong> | Magazyn: <strong>${p.targetWarehouseId}</strong> | Grupa cenowa: <strong>${p.targetPriceGroupId}</strong></span>
          <span>Klucz dopasowania: <strong>${p.identifierField.toUpperCase()}</strong> | Interwał: <strong>${p.syncIntervalMinutes} min</strong>${p.fixedStock !== undefined && p.fixedStock !== null ? ` | Stały stan: <strong>${p.fixedStock} szt.</strong>` : ''}</span>
          <span>Modyfikacja ceny: <strong>${modText}</strong> | Przeliczenie walut: <strong>${currText}</strong>${p.groupPriceModifiers && Object.keys(p.groupPriceModifiers).length > 0 ? ` | Grupy: <strong>${Object.keys(p.groupPriceModifiers).length} reguł</strong>` : ''}</span>
          <span>Produkty w pamięci BaseLinker: <strong style="color: var(--color-primary); cursor: pointer;" onclick="openBaseProductsModal(${p.targetInventoryId})">📦 ${p.baseProductsCount ?? 0} szt.</strong></span>
          <span>Ostatnia synchronizacja: <strong>${p.lastSyncAt ? new Date(p.lastSyncAt).toLocaleString('pl-PL') : 'Nigdy'}</strong></span>
          ${p.lastSyncMessage ? `<div class="profile-status-msg status-${p.lastSyncStatus || 'neutral'}">${p.lastSyncStatus === 'error' ? '⚠️ ' : p.lastSyncStatus === 'success' ? '✅ ' : 'ℹ️ '}${p.lastSyncMessage}</div>` : ''}
        </div>

        <div class="profile-card-actions">
          <button class="btn btn-primary btn-sync-trigger" id="btn-sync-${p.id}" onclick="triggerSync('${p.id}', this)">⚡ Synchronizuj teraz</button>
          <button class="btn btn-danger btn-sync-stop" id="btn-stop-${p.id}" style="display:none;" onclick="stopSync('${p.id}', this)">⏹ Zatrzymaj</button>
          <button class="btn btn-secondary" onclick="openBaseProductsModal(${p.targetInventoryId})">📦 Zobacz produkty BaseLinker (${p.baseProductsCount ?? 0})</button>
          <button class="btn btn-secondary" onclick="goToMapper('${p.id}')">🧩 Edytuj mapowanie</button>
          <button class="btn btn-danger" onclick="deleteProfile('${p.id}')">Usuń</button>
        </div>
      </div>
    `;
  }).join('');
}

// System powiadomień Toast
function showToast(title, message, type = 'info', duration = 5000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

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

// Zatrzymanie synchronizacji profilu
window.stopSync = async function(id, btnElement) {
  const profile = state.profiles.find(x => x.id === id);
  const name = profile ? profile.name : id;

  if (btnElement) {
    btnElement.disabled = true;
    btnElement.innerHTML = `<span class="spin">⏳</span> Zatrzymywanie...`;
  }

  try {
    const res = await api(`/profiles/${id}/stop`, { method: 'POST' });
    showToast('Zatrzymywanie synchronizacji', `Wysłano sygnał zatrzymania dla „${name}”.`, 'info', 3000);
  } catch (err) {
    showToast('Błąd zatrzymania', err.message, 'error', 4000);
  }
};

// Globalne zatrzymanie synchronizacji
window.stopAllSync = async function() {
  const btnStop = document.getElementById('btn-stop-all');
  if (btnStop) {
    btnStop.disabled = true;
    btnStop.innerHTML = `<span class="spin">⏳</span> Zatrzymywanie...`;
  }
  try {
    await api('/sync/stop', { method: 'POST' });
    showToast('Zatrzymano synchronizację', 'Wysłano sygnał zatrzymania do wszystkich aktywnych zadań.', 'info', 4000);
  } catch (e) {
    showToast('Błąd zatrzymania', e.message, 'error', 4000);
  } finally {
    if (btnStop) {
      btnStop.disabled = false;
      btnStop.innerHTML = `<span class="icon">⏹</span> Zatrzymaj synchronizację`;
      btnStop.style.display = 'none';
    }
  }
};

document.getElementById('btn-stop-all')?.addEventListener('click', window.stopAllSync);

// Uruchamianie synchronizacji z animacją i powiadomieniem
window.triggerSync = async function(id, btnElement) {
  const profile = state.profiles.find(x => x.id === id);
  const name = profile ? profile.name : id;
  const stopBtn = document.getElementById(`btn-stop-${id}`);
  const topStopBtn = document.getElementById('btn-stop-all');

  let originalHtml = '';
  if (btnElement) {
    originalHtml = btnElement.innerHTML;
    btnElement.innerHTML = `<span class="spin">⚡</span> Synchronizowanie...`;
    btnElement.disabled = true;
  }
  if (stopBtn) stopBtn.style.display = 'inline-flex';
  if (topStopBtn) topStopBtn.style.display = 'inline-flex';

  showToast('Rozpoczęto synchronizację', `Synchronizowanie „${name}” z BaseLinker...`, 'info', 3000);

  try {
    const res = await api(`/profiles/${id}/sync`, { method: 'POST' });
    if (res.success) {
      showToast(
        'Synchronizacja zakończona sukcesem',
        `<strong>${name}</strong>: ${res.message}`,
        'success',
        6000
      );
    } else {
      showToast('Status synchronizacji', `${name}: ${res.message}`, 'warning', 6000);
    }
    await loadProfiles();
  } catch (e) {
    showToast('Błąd synchronizacji', `${name}: ${e.message}`, 'error', 7000);
  } finally {
    if (btnElement) {
      btnElement.innerHTML = originalHtml;
      btnElement.disabled = false;
    }
    if (stopBtn) stopBtn.style.display = 'none';
    if (topStopBtn) topStopBtn.style.display = 'none';
  }
};

document.getElementById('btn-sync-all').addEventListener('click', async function() {
  const btn = this;
  const topStopBtn = document.getElementById('btn-stop-all');
  const originalHtml = btn.innerHTML;
  btn.innerHTML = `<span class="spin">⚡</span> Synchronizowanie wszystkich...`;
  btn.disabled = true;
  if (topStopBtn) topStopBtn.style.display = 'inline-flex';

  showToast('Rozpoczęto synchronizację zbiorczą', 'Wykonywanie synchronizacji dla wszystkich aktywnych profili...', 'info', 3000);

  let successCount = 0;
  let failCount = 0;

  for (const p of state.profiles) {
    if (p.enabled) {
      try {
        const res = await api(`/profiles/${p.id}/sync`, { method: 'POST' });
        if (res.success) {
          successCount++;
          showToast(`Zakończono: ${p.name}`, res.message, 'success', 5000);
        } else {
          failCount++;
          showToast(`Informacja: ${p.name}`, res.message, 'warning', 5000);
        }
      } catch (err) {
        failCount++;
        showToast(`Błąd: ${p.name}`, err.message, 'error', 5000);
      }
    }
  }

  btn.innerHTML = originalHtml;
  btn.disabled = false;
  if (topStopBtn) topStopBtn.style.display = 'none';

  showToast(
    'Zakończono synchronizację zbiorczą',
    `Przetworzono wszystkie profile (sukces: ${successCount}, błędy/zatrzymano: ${failCount}).`,
    failCount === 0 ? 'success' : 'warning',
    6000
  );

  loadProfiles();
});

function updateSourceTypeUI() {
  const type = document.getElementById('prof-source-type').value;
  const label = document.getElementById('prof-source-label');
  const input = document.getElementById('prof-source-path');
  const browseBtn = document.getElementById('btn-browse-file');
  const authGroup = document.getElementById('prof-auth-group');

  if (type === 'file') {
    label.textContent = 'Ścieżka do lokalnego pliku XML';
    input.placeholder = 'np. C:\\Katalogi\\dostawca.xml lub /sciezka/plik.xml';
    browseBtn.style.display = 'inline-flex';
    authGroup.style.display = 'none';
  } else {
    label.textContent = 'Adres URL pliku XML';
    input.placeholder = 'https://example.com/feed.xml';
    browseBtn.style.display = 'none';
    authGroup.style.display = 'flex';
  }
}

document.getElementById('prof-source-type').addEventListener('change', updateSourceTypeUI);

document.getElementById('btn-browse-file').addEventListener('click', async () => {
  try {
    const res = await fetch('/api/system/select-file', { method: 'POST' });
    const data = await res.json();
    if (data && data.supported) {
      if (data.filePath) {
        document.getElementById('prof-source-path').value = data.filePath;
      }
      return;
    }
  } catch (err) {
    console.warn('Żądanie wyboru pliku w systemie nie powiodło się, używam pola input:', err);
  }
  // Alternatywa w przeglądarce
  document.getElementById('prof-file-input').click();
});

document.getElementById('prof-file-input').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (file) {
    const filePath = file.path || file.name;
    document.getElementById('prof-source-path').value = filePath;
  }
});

// Zarządzanie oknem modalnym profilu
window.openProfileModal = function() {
  document.getElementById('prof-id').value = '';
  document.getElementById('prof-name').value = '';
  document.getElementById('prof-source-type').value = 'url';
  document.getElementById('prof-source-path').value = '';
  document.getElementById('prof-file-input').value = '';
  document.getElementById('prof-auth-header').value = '';
  document.getElementById('prof-interval').value = '30';
  document.getElementById('prof-fixed-stock').value = '';
  document.getElementById('prof-price-source-currency').value = 'PLN';
  document.getElementById('prof-price-target-currency').value = 'PLN';
  document.getElementById('prof-price-operator').value = '*';
  document.getElementById('prof-price-multiplier').value = '1.00';
  document.getElementById('prof-group-modifiers').value = '';
  updateNbpCurrencyHint();
  document.getElementById('modal-title').textContent = 'Dodaj profil pliku XML';
  updateSourceTypeUI();
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
  document.getElementById('prof-file-input').value = '';
  document.getElementById('prof-auth-header').value = p.authHeader || '';
  document.getElementById('prof-interval').value = p.syncIntervalMinutes;
  document.getElementById('prof-fixed-stock').value = p.fixedStock !== undefined && p.fixedStock !== null ? p.fixedStock : '';
  
  // Set price options
  document.getElementById('prof-price-source-currency').value = p.priceSourceCurrency || p.priceCurrency || 'PLN';
  document.getElementById('prof-price-target-currency').value = p.priceTargetCurrency || 'PLN';
  document.getElementById('prof-price-operator').value = p.priceOperator || '*';
  
  const modVal = p.priceModifierValue !== undefined && p.priceModifierValue !== null
    ? p.priceModifierValue
    : (p.priceMultiplier !== undefined && p.priceMultiplier !== null ? p.priceMultiplier : '1.00');
  document.getElementById('prof-price-multiplier').value = modVal;
  
  // Format groupPriceModifiers object as text lines
  let groupModifiersText = '';
  if (p.groupPriceModifiers && typeof p.groupPriceModifiers === 'object') {
    groupModifiersText = Object.entries(p.groupPriceModifiers)
      .map(([group, mult]) => `${group}: ${mult}`)
      .join('\n');
  }
  document.getElementById('prof-group-modifiers').value = groupModifiersText;
  updateNbpCurrencyHint();

  document.getElementById('modal-title').textContent = 'Edytuj profil: ' + p.name;
  updateSourceTypeUI();
  populateModalDropdowns(p.targetInventoryId, p.targetWarehouseId, p.targetPriceGroupId);
  document.getElementById('profile-modal').style.display = 'flex';
};

window.deleteProfile = async function(id) {
  if (!confirm('Czy na pewno chcesz usunąć ten profil?')) return;
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

// Live NBP exchange rate fetcher for currency conversion hint
let cachedNbpRates = {};
async function updateNbpCurrencyHint() {
  const hintEl = document.getElementById('nbp-currency-hint');
  if (!hintEl) return;

  const srcCurr = (document.getElementById('prof-price-source-currency')?.value || 'PLN').toUpperCase().trim();
  const tgtCurr = (document.getElementById('prof-price-target-currency')?.value || 'PLN').toUpperCase().trim();

  if (srcCurr === tgtCurr) {
    hintEl.textContent = `Brak przewalutowania (${srcCurr} = ${tgtCurr}, mnożnik 1:1)`;
    return;
  }

  hintEl.textContent = `Pobieranie aktualnego kursu NBP dla ${srcCurr} ➔ ${tgtCurr}...`;
  try {
    if (!cachedNbpRates[srcCurr] || !cachedNbpRates[tgtCurr]) {
      const res = await api('/nbp/rates');
      if (res && res.rates) {
        cachedNbpRates['PLN'] = 1.0;
        for (const item of res.rates) {
          cachedNbpRates[item.code] = item.rate;
        }
      }
    }
    const srcRate = cachedNbpRates[srcCurr] || (srcCurr === 'PLN' ? 1.0 : null);
    const tgtRate = cachedNbpRates[tgtCurr] || (tgtCurr === 'PLN' ? 1.0 : null);

    if (srcRate && tgtRate) {
      const ratio = srcRate / tgtRate;
      hintEl.textContent = `Przelicznik NBP: 1 ${srcCurr} = ${ratio.toFixed(4)} ${tgtCurr} (1 ${tgtCurr} = ${(1 / ratio).toFixed(4)} ${srcCurr})`;
    } else {
      hintEl.textContent = `Kurs dla ${srcCurr} ➔ ${tgtCurr} zostanie pobrany automatycznie podczas synchronizacji.`;
    }
  } catch (err) {
    hintEl.textContent = `Kurs NBP pobierany automatycznie przed synchronizacją.`;
  }
}

document.getElementById('prof-price-source-currency')?.addEventListener('change', updateNbpCurrencyHint);
document.getElementById('prof-price-target-currency')?.addEventListener('change', updateNbpCurrencyHint);

document.getElementById('btn-save-profile').addEventListener('click', async () => {
  const id = document.getElementById('prof-id').value;
  const existing = state.profiles.find(x => x.id === id);
  const fixedStockVal = document.getElementById('prof-fixed-stock').value.trim();
  const multiplierVal = parseFloat(document.getElementById('prof-price-multiplier').value) || 1.0;
  const srcCurrencyVal = document.getElementById('prof-price-source-currency').value || 'PLN';
  const tgtCurrencyVal = document.getElementById('prof-price-target-currency').value || 'PLN';
  const operatorVal = document.getElementById('prof-price-operator').value || '*';

  // Parse groupPriceModifiers lines
  const groupLines = document.getElementById('prof-group-modifiers').value.split('\n');
  const groupModifiers = {};
  for (const line of groupLines) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes(':')) continue;
    const parts = trimmed.split(':');
    const groupName = parts[0].trim();
    const modVal = parseFloat(parts[1].trim());
    if (groupName && !isNaN(modVal) && modVal > 0) {
      groupModifiers[groupName] = modVal;
    }
  }

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
    fixedStock: fixedStockVal !== '' ? parseInt(fixedStockVal, 10) : null,
    priceMultiplier: multiplierVal,
    priceCurrency: srcCurrencyVal,
    priceSourceCurrency: srcCurrencyVal,
    priceTargetCurrency: tgtCurrencyVal,
    priceOperator: operatorVal,
    priceModifierValue: multiplierVal,
    groupPriceModifiers: Object.keys(groupModifiers).length > 0 ? groupModifiers : null,
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
    alert('Nie udało się zapisać profilu: ' + e.message);
  }
});

// Logika mapowania pól XML
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
  document.getElementById('map-image-path').value = p.mapping.imagePath || '';
}

window.goToMapper = function(profileId) {
  document.querySelector('[data-tab="mapper"]').click();
  document.getElementById('mapper-profile-select').value = profileId;
  loadProfileMapping(profileId);
};

// Wykrywanie tagów kandydujących XML
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
    ).join('') + '<br><div style="margin-top: 8px;"><strong>Przykładowe tagi właściwości:</strong></div>' +
    res.sampleProperties.slice(0, 20).map(prop =>
      `<span class="badge-tag" onclick="copyTagToActive('${prop}')">${prop}</span>`
    ).join('');
  } catch (e) {
    alert('Błąd inspekcji XML: ' + e.message);
  }
});

window.copyTagToActive = function(prop) {
  const lower = prop.toLowerCase();
  if (lower.includes('price') || lower.includes('cena')) document.getElementById('map-price-path').value = prop;
  else if (lower.includes('stock') || lower.includes('qty') || lower.includes('quantity') || lower.includes('stan') || lower.includes('ilosc')) document.getElementById('map-stock-path').value = prop;
  else if (lower.includes('sku') || lower.includes('code') || lower.includes('kod')) document.getElementById('map-sku-path').value = prop;
  else if (lower.includes('ean') || lower.includes('barcode')) document.getElementById('map-ean-path').value = prop;
  else if (lower.includes('image') || lower.includes('zdjecie') || lower.includes('photo') || lower.includes('picture') || lower.includes('img')) document.getElementById('map-image-path').value = prop;
  else if (lower.includes('name') || lower.includes('title') || lower.includes('nazwa')) document.getElementById('map-name-path').value = prop;
};

// Podgląd mapowania
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
    namePath: document.getElementById('map-name-path').value.trim() || undefined,
    imagePath: document.getElementById('map-image-path').value.trim() || undefined
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
        <td class="preview-img-cell">${item.imageUrl ? `<a href="${item.imageUrl}" target="_blank" rel="noopener" class="preview-img-link" title="${item.imageUrl}">🖼️ Podgląd URL</a>` : '-'}</td>
      </tr>
    `).join('');
  } catch (e) {
    alert('Błąd podglądu: ' + e.message);
  }
});

// Zapisywanie mapowania do profilu
document.getElementById('btn-save-mapping').addEventListener('click', async () => {
  const profileId = document.getElementById('mapper-profile-select').value;
  const p = state.profiles.find(x => x.id === profileId);
  if (!p) return alert('Nie wybrano żadnego profilu');

  p.identifierField = document.getElementById('map-id-field').value;
  p.mapping = {
    itemTag: document.getElementById('map-item-tag').value.trim(),
    identifierField: p.identifierField,
    skuPath: document.getElementById('map-sku-path').value.trim(),
    eanPath: document.getElementById('map-ean-path').value.trim(),
    pricePath: document.getElementById('map-price-path').value.trim(),
    stockPath: document.getElementById('map-stock-path').value.trim(),
    namePath: document.getElementById('map-name-path').value.trim() || undefined,
    imagePath: document.getElementById('map-image-path').value.trim() || undefined
  };

  try {
    await api('/profiles', { method: 'POST', body: JSON.stringify(p) });
    alert('Mapowanie zostało pomyślnie zapisane w profilu: ' + p.name);
    loadProfiles();
  } catch (e) {
    alert('Nie udało się zapisać mapowania: ' + e.message);
  }
});

// Dziennik zdarzeń (Logs)
async function loadLogs() {
  try {
    const logs = await api('/logs');
    const tbody = document.getElementById('logs-tbody');
    tbody.innerHTML = logs.map(l => `
      <tr>
        <td>${new Date(l.timestamp).toLocaleString('pl-PL')}</td>
        <td>${l.profileId || 'Globalny'}</td>
        <td><span class="badge ${l.status === 'success' ? 'badge-success' : 'badge-danger'}">${l.status === 'success' ? 'Sukces' : 'Błąd'}</span></td>
        <td>${l.itemsProcessed}</td>
        <td>${l.pricesUpdated}</td>
        <td>${l.stocksUpdated}</td>
        <td>${l.message}</td>
      </tr>
    `).join('');
  } catch (e) {
    console.error('Błąd ładowania dziennika:', e);
  }
}

document.getElementById('btn-refresh-logs').addEventListener('click', loadLogs);

// Kontroler aktualizacji aplikacji
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
          `${data.commitsBehind || 1} nowa(e) zmiana(y) dostępna(e) w repozytorium zdalnym '${data.branch}'. Bieżąca wersja: ${data.currentShortCommit} ➔ Zdalna: ${data.remoteShortCommit}`;
      }
      if (settingStatusBadge) {
        settingStatusBadge.innerHTML = `<span class="badge badge-warning">Dostępna aktualizacja (${data.commitsBehind} oczekujących)</span>`;
      }
      if (btnApply) btnApply.style.display = 'inline-block';

      if (commitsPreview && commitList && data.commitMessages && data.commitMessages.length > 0) {
        commitsPreview.style.display = 'block';
        commitList.innerHTML = data.commitMessages.map(msg => `<li>${msg}</li>`).join('');
      }

      if (isManual) {
        showToast('Dostępna aktualizacja', `Znaleziono ${data.commitsBehind} nowych zmian na gałęzi ${data.branch}`, 'info');
      }
    } else {
      if (updateBadge) updateBadge.style.display = 'none';
      if (updateBanner) updateBanner.style.display = 'none';
      if (settingStatusBadge) {
        settingStatusBadge.innerHTML = `<span class="badge badge-success">Wersja aktualna (${data.currentShortCommit})</span>`;
      }
      if (btnApply) btnApply.style.display = 'none';
      if (commitsPreview) commitsPreview.style.display = 'none';

      if (isManual) {
        showToast('Wersja aktualna', `Aplikacja działa w najnowszej wersji (${data.currentShortCommit})`, 'success');
      }
    }
  } catch (err) {
    console.error('Błąd sprawdzania aktualizacji:', err);
    if (isManual) {
      showToast('Błąd sprawdzania aktualizacji', err.message, 'error');
    }
  } finally {
    if (btnTop) btnTop.querySelector('.icon').classList.remove('spin');
    if (btnSettings) btnSettings.disabled = false;
  }
}

async function triggerApplyUpdate() {
  const btnBanner = document.getElementById('btn-banner-update');
  const btnSettings = document.getElementById('btn-settings-apply-update');

  const confirmed = confirm('Czy na pewno chcesz zaktualizować aplikację do najnowszej wersji?');
  if (!confirmed) return;

  try {
    if (btnBanner) {
      btnBanner.disabled = true;
      btnBanner.textContent = 'Aktualizowanie...';
    }
    if (btnSettings) {
      btnSettings.disabled = true;
      btnSettings.textContent = 'Aktualizowanie...';
    }

    showToast('Aktualizowanie aplikacji', 'Weryfikacja i przygotowywanie aktualizacji...', 'info');

    const result = await api('/updates/apply', { method: 'POST' });

    if (result.needsRestart === false) {
      // Wersja binarna / instalator (brak gita)
      const downloadLink = result.downloadUrl || 'https://github.com/Yuriipe/stock_to_oms_sync/releases';
      const msg = `Dostępny jest nowy instalator:<br><a href="${downloadLink}" target="_blank" rel="noopener noreferrer" style="font-weight: 600; display: inline-block; margin-top: 4px;">⬇️ Kliknij tutaj, aby pobrać nowy instalator</a>`;
      showToast('Aktualizacja aplikacji', msg, 'success', 12000);

      // Otwórz link do pobierania w nowej karcie / oknie
      window.open(downloadLink, '_blank');

      if (btnBanner) {
        btnBanner.disabled = false;
        btnBanner.textContent = '⬇️ Pobierz instalator';
        btnBanner.onclick = () => window.open(downloadLink, '_blank');
      }
      if (btnSettings) {
        btnSettings.disabled = false;
        btnSettings.textContent = '⬇️ Pobierz najnowszy instalator';
        btnSettings.onclick = () => window.open(downloadLink, '_blank');
      }
      return;
    }

    // Tryb repozytorium Git (git pull + npm run build)
    showToast('Aktualizacja powiodła się', `${result.message} Ponowne uruchamianie aplikacji...`, 'success');

    // Uruchomienie restartu
    setTimeout(async () => {
      try {
        await api('/updates/restart', { method: 'POST' });
      } catch (e) {
        // Oczekiwane w przypadku zamknięcia serwera
      }
      // Przeładowanie strony po restarcie
      setTimeout(() => {
        window.location.reload();
      }, 3000);
    }, 1500);

  } catch (err) {
    console.error('Błąd instalacji aktualizacji:', err);
    showToast('Aktualizacja nie powiodła się', err.message, 'error');
    if (btnBanner) {
      btnBanner.disabled = false;
      btnBanner.textContent = '⚡ Zaktualizuj teraz';
    }
    if (btnSettings) {
      btnSettings.disabled = false;
      btnSettings.textContent = '⚡ Zaktualizuj aplikację teraz';
    }
  }
}

// Nasłuchiwanie zdarzeń aktualizacji
document.getElementById('btn-check-updates')?.addEventListener('click', () => checkAppUpdates(true));
document.getElementById('btn-settings-check-update')?.addEventListener('click', () => checkAppUpdates(true));
document.getElementById('btn-banner-update')?.addEventListener('click', triggerApplyUpdate);
document.getElementById('btn-settings-apply-update')?.addEventListener('click', triggerApplyUpdate);
document.getElementById('btn-banner-dismiss')?.addEventListener('click', () => {
  document.getElementById('update-banner').style.display = 'none';
});

let currentModalInventoryId = null;

// Logika okna modalnego produktów BaseLinker
window.openBaseProductsModal = async function(inventoryId) {
  currentModalInventoryId = inventoryId;
  const modal = document.getElementById('base-products-modal');
  const tbody = document.getElementById('base-products-tbody');
  const summary = document.getElementById('base-products-summary');
  const title = document.getElementById('base-products-modal-title');

  title.textContent = `Katalog produktów BaseLinker (ID katalogu: ${inventoryId})`;
  summary.textContent = 'Ładowanie produktów z lokalnej bazy...';
  tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">Ładowanie...</td></tr>';
  modal.style.display = 'flex';

  await loadBaseProductsList(inventoryId);
};

window.deleteBaseProductRow = async function(inventoryId, productId) {
  if (!confirm(`Czy na pewno usunąć produkt ${productId} z lokalnej tabeli katalogu?`)) return;
  try {
    await api(`/baselinker/products/${inventoryId}/${productId}`, { method: 'DELETE' });
    showToast('Produkt usunięty', `Produkt ${productId} został usunięty z lokalnej tabeli.`, 'info', 3000);
    await loadBaseProductsList(inventoryId);
    await loadProfiles();
  } catch (err) {
    showToast('Błąd usuwania', err.message, 'error', 4000);
  }
};

async function loadBaseProductsList(inventoryId) {
  const tbody = document.getElementById('base-products-tbody');
  const summary = document.getElementById('base-products-summary');

  try {
    const res = await api(`/baselinker/products?inventoryId=${inventoryId}&limit=100`);
    summary.innerHTML = `Łącznie w bazie lokalnej: <strong>${res.total}</strong> (pokazano najnowsze ${res.products.length})`;

    if (res.products.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 24px;">Brak produktów w pamięci podręcznej. Kliknij „🔄 Odśwież z BaseLinker” lub uruchom synchronizację.</td></tr>';
      return;
    }

    tbody.innerHTML = res.products.map(p => {
      const isMissingIdentifiers = (!p.sku || p.sku.trim() === '') && (!p.ean || p.ean.trim() === '');
      return `
        <tr ${isMissingIdentifiers ? 'style="background: rgba(239, 68, 68, 0.08);"' : ''}>
          <td class="font-mono"><strong>${p.productId}</strong> ${isMissingIdentifiers ? '<span style="color:var(--color-danger); font-size: 0.75rem;">(Brak SKU/EAN)</span>' : ''}</td>
          <td class="font-mono">${p.sku || '<span style="color:var(--text-muted);">-</span>'}</td>
          <td class="font-mono">${p.ean || '<span style="color:var(--text-muted);">-</span>'}</td>
          <td style="font-size: 0.8rem; color: var(--text-muted);">${new Date(p.updatedAt).toLocaleString('pl-PL')}</td>
          <td style="text-align: center;">
            <button class="btn btn-danger btn-sm" style="padding: 3px 8px; font-size: 0.75rem;" onclick="deleteBaseProductRow(${inventoryId}, ${p.productId})" title="Usuń z lokalnej tabeli">🗑️</button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    summary.textContent = 'Błąd podczas ładowania produktów';
    tbody.innerHTML = `<tr><td colspan="5" style="color: var(--color-danger); text-align: center;">${err.message}</td></tr>`;
  }
}

document.getElementById('btn-refresh-base-products')?.addEventListener('click', async function() {
  if (!currentModalInventoryId) return;
  const btn = this;
  const originalText = btn.textContent;
  btn.textContent = '⏳ Pobieranie z BaseLinker...';
  btn.disabled = true;

  try {
    const res = await api('/baselinker/products/refresh', {
      method: 'POST',
      body: JSON.stringify({ inventoryId: currentModalInventoryId })
    });
    const msg = `Zsynchronizowano ${res.count} produktów z BaseLinker${res.deleted ? ` (usunięto ${res.deleted} usuniętych/pustych pozycji)` : ''}.`;
    showToast('Odświeżono katalog', msg, 'success', 4000);
    await loadBaseProductsList(currentModalInventoryId);
    await loadProfiles();
  } catch (err) {
    showToast('Błąd odświeżania', err.message, 'error', 5000);
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
});

document.getElementById('btn-clean-empty-base-products')?.addEventListener('click', async function() {
  if (!currentModalInventoryId) return;
  const btn = this;
  btn.disabled = true;
  try {
    const res = await api('/baselinker/products/cleanup-empty', {
      method: 'POST',
      body: JSON.stringify({ inventoryId: currentModalInventoryId })
    });
    showToast('Czyszczenie zakończone', `Usunięto ${res.count} produkt(ów) bez identyfikatorów SKU/EAN.`, 'success', 4000);
    await loadBaseProductsList(currentModalInventoryId);
    await loadProfiles();
  } catch (err) {
    showToast('Błąd czyszczenia', err.message, 'error', 4000);
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('btn-close-base-products-modal')?.addEventListener('click', () => {
  document.getElementById('base-products-modal').style.display = 'none';
});
document.getElementById('btn-close-base-products')?.addEventListener('click', () => {
  document.getElementById('base-products-modal').style.display = 'none';
});

// Inicjalizacja przy starcie strony
init();
checkAppUpdates(false);
