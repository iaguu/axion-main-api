const state = {
  token: localStorage.getItem('axion_api_token') || '',
  selectedAppId: '',
  env: 'prod',
  locale: 'pt-BR',
  registryApps: [],
  configStats: [],
  originalCatalogSummary: [],
  configItems: [],
  originalByKey: {},
  dirtyEditors: new Set(),
  selectedEndpointId: '',
  charts: {
    eventsLine: null,
    eventType: null,
    origin: null,
  },
  analyticsDays: 30,
  analyticsBucket: 'day',
  latestAnalytics: null,
  latestHealth: null,
  activeTab: 'overview',
};

const q = (id) => document.getElementById(id);

const api = async (url, opts = {}) => {
  const headers = {
    'Content-Type': 'application/json',
    ...(opts.headers || {}),
  };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(url, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.detail || 'Erro na API');
  return data;
};

const parseJsonText = (raw, fallback) => {
  const source = String(raw || '').trim();
  if (!source) return fallback;
  return JSON.parse(source);
};

const safeSerialize = (value) => {
  try {
    return JSON.stringify(value ?? null, null, 2);
  } catch {
    return JSON.stringify(String(value ?? ''), null, 2);
  }
};

const inferValueType = (value) => {
  if (Array.isArray(value)) return 'json';
  if (value && typeof value === 'object') return 'json';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'string';
};

const editorValueFor = (item) => {
  const valueType = item.valueType || inferValueType(item.value);
  if (valueType === 'json') return safeSerialize(item.value);
  if (item.value === null || item.value === undefined) return '';
  return String(item.value);
};

const parseEditorValue = (item, raw) => {
  const valueType = item.valueType || inferValueType(item.value);
  const text = String(raw ?? '');
  const trimmed = text.trim();

  if (!trimmed) {
    if (valueType === 'json') return null;
    if (valueType === 'number') return 0;
    if (valueType === 'boolean') return false;
    return '';
  }

  if (valueType === 'json' || ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']')))) {
    return JSON.parse(trimmed);
  }

  if (valueType === 'number') {
    const n = Number(trimmed);
    if (Number.isNaN(n)) throw new Error(`Numero invalido em ${item.namespace}.${item.key}`);
    return n;
  }

  if (valueType === 'boolean') {
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    throw new Error(`Booleano invalido em ${item.namespace}.${item.key} (use true/false)`);
  }

  return text;
};

const keyOf = (item) => `${item.namespace}.${item.key}`;

const getSelectedApp = () => state.registryApps.find((item) => item.appId === state.selectedAppId) || null;

const setActiveTab = (tab) => {
  state.activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === tab);
  });
  document.querySelectorAll('.tab-pane').forEach((pane) => {
    pane.classList.toggle('hidden', pane.id !== `pane-${tab}`);
  });
};

const buildAppInventory = () => {
  const registryMap = new Map((state.registryApps || []).map((app) => [app.appId, app]));
  const statsMap = new Map((state.configStats || []).map((item) => [item.appId, item]));
  const catalogIds = new Set((state.originalCatalogSummary || []).map((item) => item.appId));

  const allIds = [...new Set([
    ...registryMap.keys(),
    ...statsMap.keys(),
    ...catalogIds,
  ])].filter(Boolean);

  return allIds.map((appId) => {
    const reg = registryMap.get(appId);
    const stats = statsMap.get(appId);
    return {
      appId,
      name: reg?.name || appId,
      description: reg?.description || 'Aplicacao AXION',
      category: reg?.category || 'general',
      endpoints: Array.isArray(reg?.endpoints) ? reg.endpoints : [],
      totalConfigs: stats?.totalConfigs || 0,
      publishedConfigs: stats?.publishedConfigs || 0,
      lastUpdated: stats?.lastUpdated || null,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
};

const renderAppList = () => {
  const apps = buildAppInventory();
  const container = q('appList');
  container.innerHTML = '';

  apps.forEach((app) => {
    const btn = document.createElement('button');
    btn.className = `app-item ${app.appId === state.selectedAppId ? 'active' : ''}`;
    btn.innerHTML = `
      <strong>${app.name}</strong>
      <span>${app.appId}</span>
      <span>${app.endpoints.length} endpoint(s) | ${app.totalConfigs} config(s)</span>
    `;
    btn.addEventListener('click', async () => {
      await setSelectedApp(app.appId);
    });
    container.appendChild(btn);
  });

  q('cfgApp').innerHTML = apps.map((app) => `<option value="${app.appId}">${app.name} (${app.appId})</option>`).join('');
  if (state.selectedAppId) q('cfgApp').value = state.selectedAppId;
};

const updateTopHeader = () => {
  const app = getSelectedApp();
  q('panelTitle').textContent = app ? `${app.name} | Main Panel` : 'AXION Main Panel';
  q('panelSubtitle').textContent = app
    ? `${app.description} | endpoints: ${app.endpoints.length} | configs: ${app.publishedConfigs}/${app.totalConfigs}`
    : 'Selecione uma app para controlar analytics, configs e endpoints.';
};

const renderKpis = ({ overview, events }) => {
  const app = getSelectedApp();
  const cards = [
    { label: 'Aplicacao', value: app ? app.name : '-', note: app ? app.appId : '-' },
    { label: 'Eventos 30d', value: overview.totalEvents || 0, note: 'janela atual' },
    { label: 'Clicks 30d', value: overview.totalClicks || 0, note: 'eventType click' },
    { label: 'Conversoes 30d', value: overview.totalConversions || 0, note: 'purchase/conversion/form_submit' },
    { label: 'Page views 30d', value: overview.totalPageViews || 0, note: 'eventType page_view' },
    { label: 'Eventos carregados', value: (events.items || []).length, note: 'base para graficos' },
    { label: 'Configs publicadas', value: app?.publishedConfigs || 0, note: 'controle central' },
    { label: 'Endpoints mapeados', value: app?.endpoints.length || 0, note: 'console de consumo' },
  ];

  q('kpiGrid').innerHTML = cards
    .map((card) => `<div class="kpi"><div class="label">${card.label}</div><div class="value">${card.value}</div><div class="muted">${card.note}</div></div>`)
    .join('');
};

const destroyChart = (instance) => {
  if (instance && typeof instance.destroy === 'function') instance.destroy();
};

const renderCharts = ({ overview, events, timeseries }) => {
  if (!window.Chart) return;

  const dayLabels = (timeseries.items || []).map((item) => String(item.bucket).slice(5));
  const dayValues = (timeseries.items || []).map((item) => Number(item.totalEvents || 0));

  const byType = Object.entries(overview.byType || {}).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const byOrigin = Object.entries(overview.byOrigin || {}).sort((a, b) => b[1] - a[1]).slice(0, 6);

  destroyChart(state.charts.eventsLine);
  destroyChart(state.charts.eventType);
  destroyChart(state.charts.origin);

  state.charts.eventsLine = new Chart(q('eventsLineChart'), {
    type: 'line',
    data: {
      labels: dayLabels,
      datasets: [{
        label: 'Eventos',
        data: dayValues,
        borderColor: '#2563eb',
        backgroundColor: 'rgba(37,99,235,.18)',
        fill: true,
        tension: 0.35,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#5c6f8a' }, grid: { color: 'rgba(148,163,184,.25)' } },
        y: { ticks: { color: '#5c6f8a', precision: 0 }, grid: { color: 'rgba(148,163,184,.2)' } },
      },
    },
  });

  state.charts.eventType = new Chart(q('eventTypeChart'), {
    type: 'doughnut',
    data: {
      labels: byType.map((item) => item[0]),
      datasets: [{
        data: byType.map((item) => item[1]),
        backgroundColor: ['#0ea5e9', '#2563eb', '#14b8a6', '#22c55e', '#f59e0b', '#ef4444'],
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom' } },
    },
  });

  state.charts.origin = new Chart(q('originChart'), {
    type: 'bar',
    data: {
      labels: byOrigin.map((item) => item[0]),
      datasets: [{ label: 'Origem', data: byOrigin.map((item) => item[1]), backgroundColor: '#16a34a' }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#5c6f8a' }, grid: { display: false } },
        y: { ticks: { color: '#5c6f8a', precision: 0 }, grid: { color: 'rgba(148,163,184,.2)' } },
      },
    },
  });
};

const renderHealthTable = () => {
  const summary = state.latestHealth;
  const table = q('healthTable');
  const summaryBox = q('healthSummary');
  if (!summary || !Array.isArray(summary.items)) {
    summaryBox.textContent = 'Sem verificacao recente.';
    table.innerHTML = '<tr><td colspan="5" class="muted">Sem dados.</td></tr>';
    return;
  }
  summaryBox.textContent = `Online: ${summary.online} | Offline: ${summary.offline} | Atualizado: ${new Date(summary.generatedAt).toLocaleTimeString('pt-BR')}`;
  table.innerHTML = summary.items
    .map((item) => {
      const statusText = item.ok ? 'online' : 'offline';
      return `<tr>
        <td>${item.name} <div class="muted mono">${item.appId}</div></td>
        <td>${statusText}</td>
        <td>${item.status || '-'}</td>
        <td>${item.durationMs || 0}ms</td>
        <td class="mono">${item.url || '-'}</td>
      </tr>`;
    })
    .join('');
};

const renderAudit = async () => {
  const data = await api(`/api/admin/control/audit?appId=${encodeURIComponent(state.selectedAppId)}&limit=40`);
  const rows = data.items || [];
  q('auditTable').innerHTML = rows
    .map((item) => {
      const when = new Date(item.createdAt).toLocaleString('pt-BR');
      const resource = `${item.resourceType || '-'}:${item.resourceId || '-'}`;
      return `<tr><td>${when}</td><td>${item.action || '-'}</td><td>${item.actor || '-'}</td><td class="mono">${resource}</td></tr>`;
    })
    .join('') || '<tr><td colspan="4" class="muted">Sem auditoria para esta app.</td></tr>';
};

const renderConfigList = () => {
  const container = q('cfgList');
  const search = String(q('cfgSearch').value || '').trim().toLowerCase();

  const grouped = {};
  state.configItems.forEach((item) => {
    const fullKey = keyOf(item);
    if (search && !fullKey.toLowerCase().includes(search)) return;
    if (!grouped[item.namespace]) grouped[item.namespace] = [];
    grouped[item.namespace].push(item);
  });

  const namespaces = Object.keys(grouped).sort((a, b) => a.localeCompare(b));
  if (!namespaces.length) {
    container.innerHTML = '<div class="muted">Sem itens de configuracao para os filtros atuais.</div>';
    return;
  }

  container.innerHTML = '';

  namespaces.forEach((namespace, idx) => {
    const details = document.createElement('details');
    details.className = 'ns';
    if (idx < 2) details.open = true;

    const items = grouped[namespace].sort((a, b) => a.key.localeCompare(b.key));
    const changedCount = items.filter((item) => state.dirtyEditors.has(item.id)).length;
    details.innerHTML = `
      <summary>
        <span>${namespace}</span>
        <span class="muted">${items.length} item(ns) ${changedCount ? `| ${changedCount} alterado(s)` : ''}</span>
      </summary>
      <div class="ns-body" id="ns-${namespace.replace(/[^a-z0-9_-]/gi, '_')}"></div>
    `;

    container.appendChild(details);
    const body = details.querySelector('.ns-body');

    items.forEach((item) => {
      const fullKey = keyOf(item);
      const originalValue = state.originalByKey[fullKey];
      const hasOriginal = originalValue !== undefined;
      const editorId = `editor-${item.id}`;
      const isChanged = state.dirtyEditors.has(item.id);
      const statusBadge = item.status === 'published' ? '<span class="badge live">published</span>' : '<span class="badge draft">draft</span>';

      const wrapper = document.createElement('div');
      wrapper.className = 'editor-item';
      wrapper.innerHTML = `
        <div class="editor-head">
          <strong>${item.key}</strong>
          <div>
            ${statusBadge}
            ${isChanged ? '<span class="badge changed">alterado</span>' : ''}
            <span class="muted">v${item.version || 0} | ${item.valueType || inferValueType(item.value)}</span>
          </div>
        </div>
        <textarea id="${editorId}" class="mono">${editorValueFor(item)}</textarea>
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:6px">
          <button class="btn" data-save="${item.id}">Salvar item</button>
          ${hasOriginal ? `<button class="btn" data-restore="${item.id}">Restaurar original</button>` : ''}
          <span class="muted">${hasOriginal ? `Original: ${safeSerialize(originalValue).slice(0, 90)}` : 'Sem baseline original mapeado.'}</span>
        </div>
      `;

      body.appendChild(wrapper);
    });
  });

  container.querySelectorAll('[data-save]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-save');
      const item = state.configItems.find((entry) => entry.id === id);
      if (!item) return;
      try {
        const raw = q(`editor-${id}`).value;
        const value = parseEditorValue(item, raw);
        await api(`/api/admin/control/config/${state.selectedAppId}`, {
          method: 'POST',
          body: JSON.stringify({
            env: state.env,
            locale: state.locale,
            items: [{
              namespace: item.namespace,
              key: item.key,
              value,
              valueType: item.valueType || inferValueType(value),
            }],
          }),
        });
        state.dirtyEditors.delete(id);
        await loadConfig();
      } catch (error) {
        alert(error.message || 'Falha ao salvar item');
      }
    });
  });

  container.querySelectorAll('[data-restore]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-restore');
      const item = state.configItems.find((entry) => entry.id === id);
      if (!item) return;
      const baseline = state.originalByKey[keyOf(item)];
      if (baseline === undefined) return;

      try {
        await api(`/api/admin/control/config/${state.selectedAppId}`, {
          method: 'POST',
          body: JSON.stringify({
            env: state.env,
            locale: state.locale,
            items: [{
              namespace: item.namespace,
              key: item.key,
              value: baseline,
              valueType: item.valueType || inferValueType(baseline),
            }],
          }),
        });
        state.dirtyEditors.delete(id);
        await loadConfig();
      } catch (error) {
        alert(error.message || 'Falha ao restaurar valor original');
      }
    });
  });

  container.querySelectorAll('textarea[id^="editor-"]').forEach((editor) => {
    editor.addEventListener('input', () => {
      const id = editor.id.replace('editor-', '');
      state.dirtyEditors.add(id);
    });
  });
};

const collectDirtyItems = () => {
  const changedItems = [];
  state.dirtyEditors.forEach((id) => {
    const item = state.configItems.find((entry) => entry.id === id);
    const editor = q(`editor-${id}`);
    if (!item || !editor) return;
    const value = parseEditorValue(item, editor.value);
    changedItems.push({
      namespace: item.namespace,
      key: item.key,
      value,
      valueType: item.valueType || inferValueType(value),
    });
  });
  return changedItems;
};

const loadConfig = async () => {
  const [configData, originalData] = await Promise.all([
    api(`/api/admin/control/config/${state.selectedAppId}?env=${encodeURIComponent(state.env)}&locale=${encodeURIComponent(state.locale)}`),
    api(`/api/admin/control/catalog/original-texts/${state.selectedAppId}?env=${encodeURIComponent(state.env)}&locale=${encodeURIComponent(state.locale)}`),
  ]);

  state.configItems = configData.items || [];
  state.originalByKey = {};

  (originalData.items || []).forEach((item) => {
    state.originalByKey[`${item.namespace}.${item.key}`] = item.value;
  });

  renderConfigList();
};

const renderEndpointMenu = () => {
  const app = getSelectedApp();
  const endpoints = app?.endpoints || [];
  const menu = q('endpointMenu');

  if (!endpoints.length) {
    menu.innerHTML = '<div class="muted">Sem endpoints cadastrados para esta aplicacao.</div>';
    q('endpointMeta').textContent = '-';
    q('endpointBody').value = '';
    q('endpointQuery').value = '';
    q('endpointHeaders').value = '';
    return;
  }

  if (!endpoints.some((ep) => ep.id === state.selectedEndpointId)) {
    state.selectedEndpointId = endpoints[0].id;
  }

  menu.innerHTML = '';

  endpoints.forEach((endpoint) => {
    const btn = document.createElement('button');
    btn.className = `ep-item ${endpoint.id === state.selectedEndpointId ? 'active' : ''}`;
    btn.innerHTML = `<strong>${endpoint.name}</strong><div class="muted mono">${endpoint.method} ${endpoint.path}</div>`;
    btn.addEventListener('click', () => {
      state.selectedEndpointId = endpoint.id;
      renderEndpointMenu();
    });
    menu.appendChild(btn);
  });

  const selected = endpoints.find((ep) => ep.id === state.selectedEndpointId) || endpoints[0];
  q('endpointMeta').innerHTML = `<span class="mono">${selected.method} ${selected.url}</span><br>${selected.description || ''}`;
  q('endpointQuery').value = '{}';
  q('endpointHeaders').value = selected.requiresHeaders?.length
    ? safeSerialize(Object.fromEntries(selected.requiresHeaders.map((name) => [name, ''])))
    : '{}';
  q('endpointBody').value = selected.bodyTemplate ? safeSerialize(selected.bodyTemplate) : '{}';
};

const runSelectedEndpoint = async () => {
  const app = getSelectedApp();
  if (!app) throw new Error('Selecione uma aplicacao.');

  const endpoint = (app.endpoints || []).find((entry) => entry.id === state.selectedEndpointId);
  if (!endpoint) throw new Error('Selecione um endpoint.');

  const query = parseJsonText(q('endpointQuery').value, {});
  const headers = parseJsonText(q('endpointHeaders').value, {});
  const body = parseJsonText(q('endpointBody').value, {});

  q('endpointResult').textContent = 'Executando...';

  const result = await api('/api/admin/control/registry/proxy', {
    method: 'POST',
    body: JSON.stringify({
      appId: app.appId,
      endpointId: endpoint.id,
      query,
      headers,
      body,
    }),
  });

  q('endpointResult').textContent = safeSerialize(result);
};

const loadAnalytics = async () => {
  const appId = state.selectedAppId;
  const [overview, events, timeseries] = await Promise.all([
    api(`/api/admin/control/analytics/overview?appId=${encodeURIComponent(appId)}&days=${state.analyticsDays}`),
    api(`/api/admin/control/analytics/events?appId=${encodeURIComponent(appId)}&days=${state.analyticsDays}&limit=800`),
    api(`/api/admin/control/analytics/timeseries?appId=${encodeURIComponent(appId)}&days=${state.analyticsDays}&bucket=${encodeURIComponent(state.analyticsBucket)}`),
  ]);

  state.latestAnalytics = { overview, events, timeseries, appId, days: state.analyticsDays, bucket: state.analyticsBucket };
  renderKpis({ overview, events });
  renderCharts({ overview, events, timeseries });
};

const loadRegistryHealth = async () => {
  const data = await api('/api/admin/control/registry/health');
  state.latestHealth = data;
  renderHealthTable();
};

const loadInitialSources = async () => {
  const [registryData, appsData, catalogData] = await Promise.all([
    api('/api/admin/control/registry/apps'),
    api('/api/admin/control/apps'),
    api('/api/admin/control/catalog/original-texts'),
  ]);

  state.registryApps = registryData.items || [];
  state.configStats = appsData.items || [];
  state.originalCatalogSummary = catalogData.items || [];

  const inventory = buildAppInventory();
  if (!inventory.length) {
    throw new Error('Nenhuma aplicacao encontrada no control plane.');
  }

  if (!state.selectedAppId || !inventory.some((item) => item.appId === state.selectedAppId)) {
    state.selectedAppId = inventory[0].appId;
  }

  renderAppList();
  updateTopHeader();
};

const setSelectedApp = async (appId) => {
  state.selectedAppId = appId;
  state.dirtyEditors.clear();
  if (q('cfgApp')) q('cfgApp').value = appId;

  renderAppList();
  updateTopHeader();
  renderEndpointMenu();

  await Promise.all([
    loadAnalytics(),
    loadConfig(),
    renderAudit(),
  ]);
};

const refreshAll = async () => {
  await loadInitialSources();
  renderEndpointMenu();
  await Promise.all([
    loadAnalytics(),
    loadConfig(),
    renderAudit(),
    loadRegistryHealth(),
  ]);
};

const bootApp = async () => {
  q('authShell').classList.add('hidden');
  q('panelShell').classList.remove('hidden');

  await loadInitialSources();
  renderEndpointMenu();
  await setSelectedApp(state.selectedAppId);
  await loadRegistryHealth();
};

q('loginBtn').addEventListener('click', async () => {
  try {
    q('authMsg').textContent = 'Entrando...';
    const payload = await api('/api/auth/login', {
      method: 'POST',
      headers: {},
      body: JSON.stringify({
        email: q('email').value,
        password: q('password').value,
      }),
    });

    state.token = payload.tokens?.accessToken || '';
    if (!state.token) throw new Error('Token ausente no login');
    localStorage.setItem('axion_api_token', state.token);
    q('authMsg').textContent = '';
    await bootApp();
  } catch (error) {
    q('authMsg').textContent = error.message || 'Falha no login';
  }
});

q('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('axion_api_token');
  state.token = '';
  location.reload();
});

q('refreshBtn').addEventListener('click', async () => {
  await refreshAll();
});

q('checkHealthBtn').addEventListener('click', async () => {
  try {
    await loadRegistryHealth();
  } catch (error) {
    q('healthSummary').textContent = error.message || 'Falha ao checar saude das apps.';
  }
});

q('syncOriginalBtn').addEventListener('click', async () => {
  try {
    await api('/api/admin/control/bootstrap/original-texts', {
      method: 'POST',
      body: JSON.stringify({ publish: true }),
    });
    await refreshAll();
    alert('Catalogo original sincronizado.');
  } catch (error) {
    alert(error.message || 'Falha ao sincronizar catalogo.');
  }
});

q('cfgApp').addEventListener('change', async (event) => {
  await setSelectedApp(event.target.value);
});

q('cfgEnv').addEventListener('change', async (event) => {
  state.env = event.target.value;
  state.dirtyEditors.clear();
  await loadConfig();
});

q('cfgLocale').addEventListener('change', async (event) => {
  state.locale = event.target.value;
  state.dirtyEditors.clear();
  await loadConfig();
});

q('cfgSearch').addEventListener('input', () => {
  renderConfigList();
});

q('analyticsDays').addEventListener('change', async (event) => {
  state.analyticsDays = Number(event.target.value || 30);
  await loadAnalytics();
});

q('analyticsBucket').addEventListener('change', async (event) => {
  state.analyticsBucket = event.target.value || 'day';
  await loadAnalytics();
});

q('exportAnalyticsBtn').addEventListener('click', () => {
  if (!state.latestAnalytics) {
    alert('Carregue analytics antes de exportar.');
    return;
  }
  const blob = new Blob([JSON.stringify(state.latestAnalytics, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `analytics-${state.selectedAppId}-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
});

q('addTextBtn').addEventListener('click', async () => {
  try {
    const namespace = q('cfgNewNamespace').value.trim();
    const key = q('cfgNewKey').value.trim();
    const value = q('cfgNewValue').value;
    if (!namespace || !key) throw new Error('Informe namespace e key.');

    await api(`/api/admin/control/config/${state.selectedAppId}`, {
      method: 'POST',
      body: JSON.stringify({
        env: state.env,
        locale: state.locale,
        items: [{ namespace, key, value, valueType: 'string' }],
      }),
    });

    q('cfgNewNamespace').value = '';
    q('cfgNewKey').value = '';
    q('cfgNewValue').value = '';
    await loadConfig();
  } catch (error) {
    alert(error.message || 'Falha ao adicionar item.');
  }
});

q('saveAllBtn').addEventListener('click', async () => {
  try {
    const items = collectDirtyItems();
    if (!items.length) {
      alert('Nao ha alteracoes pendentes.');
      return;
    }

    await api(`/api/admin/control/config/${state.selectedAppId}`, {
      method: 'POST',
      body: JSON.stringify({ env: state.env, locale: state.locale, items }),
    });

    state.dirtyEditors.clear();
    await loadConfig();
    alert(`Alteracoes salvas: ${items.length}`);
  } catch (error) {
    alert(error.message || 'Falha ao salvar alteracoes.');
  }
});

q('publishBtn').addEventListener('click', async () => {
  try {
    await api(`/api/admin/control/config/${state.selectedAppId}/publish`, {
      method: 'POST',
      body: JSON.stringify({ env: state.env, locale: state.locale }),
    });
    await Promise.all([loadConfig(), loadAnalytics(), renderAudit()]);
    alert('Configuracao publicada.');
  } catch (error) {
    alert(error.message || 'Falha ao publicar.');
  }
});

q('rollbackBtn').addEventListener('click', async () => {
  try {
    const version = Number(q('rollbackVersion').value);
    if (!version) throw new Error('Informe uma versao valida.');

    await api(`/api/admin/control/config/${state.selectedAppId}/rollback`, {
      method: 'POST',
      body: JSON.stringify({ env: state.env, locale: state.locale, version }),
    });

    await Promise.all([loadConfig(), loadAnalytics(), renderAudit()]);
    alert('Rollback executado com sucesso.');
  } catch (error) {
    alert(error.message || 'Falha no rollback.');
  }
});

q('runEndpointBtn').addEventListener('click', async () => {
  try {
    await runSelectedEndpoint();
  } catch (error) {
    q('endpointResult').textContent = error.message || 'Falha ao executar endpoint.';
  }
});

document.querySelectorAll('.tab-btn').forEach((button) => {
  button.addEventListener('click', () => setActiveTab(button.dataset.tab));
});
setActiveTab(state.activeTab);

if (state.token) {
  bootApp().catch(() => {
    localStorage.removeItem('axion_api_token');
    state.token = '';
  });
}
