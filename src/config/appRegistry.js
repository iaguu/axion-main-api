const APP_ENDPOINT_REGISTRY = [
  {
    appId: 'axion-pay',
    name: 'Axion Pay',
    category: 'payments',
    description: 'Gateway de pagamentos, dashboard e checkout.',
    baseUrl: 'https://pay.axionenterprise.cloud',
    healthPath: '/health',
    endpoints: [
      { id: 'health', name: 'Health', method: 'GET', path: '/health', description: 'Healthcheck do servico.' },
      { id: 'dashboard', name: 'Dashboard', method: 'GET', path: '/api/dashboard', description: 'Resumo do dashboard de pagamentos.', requiresHeaders: ['authorization'] },
      { id: 'payments_list', name: 'Listar pagamentos', method: 'GET', path: '/api/payments', description: 'Lista transacoes.', requiresHeaders: ['authorization'] },
      { id: 'paytags_list', name: 'Listar pay tags', method: 'GET', path: '/api/pay-tags', description: 'Lista pay tags.', requiresHeaders: ['authorization'] }
    ]
  },
  {
    appId: 'axion-pdv',
    name: 'Axion PDV',
    category: 'retail',
    description: 'Operacao de PDV, pedidos e IA inbox.',
    baseUrl: 'https://pdv.axionenterprise.cloud',
    healthPath: '/health',
    endpoints: [
      { id: 'health', name: 'Health', method: 'GET', path: '/health', description: 'Healthcheck do PDV.' },
      { id: 'orders', name: 'Pedidos', method: 'GET', path: '/api/orders', description: 'Lista de pedidos.', requiresHeaders: ['x-api-key'] },
      { id: 'ai_suggestions', name: 'Sugestoes IA', method: 'GET', path: '/api/ai/orders/suggestions', description: 'Fila de sugestoes IA.', requiresHeaders: ['x-api-key'] }
    ]
  },
  {
    appId: 'axion-ia-panel',
    name: 'Axion IA Panel',
    category: 'ai',
    description: 'Painel de IA com geradores e automacoes.',
    baseUrl: 'https://ai.axionenterprise.cloud',
    healthPath: '/health',
    endpoints: [
      { id: 'health', name: 'Health', method: 'GET', path: '/health', description: 'Healthcheck da IA.' },
      { id: 'api_info', name: 'API info', method: 'GET', path: '/api', description: 'Info e descoberta de rotas.' }
    ]
  },
  {
    appId: 'axion-flow',
    name: 'Axion Flow',
    category: 'automation',
    description: 'Fluxos e automacao operacional.',
    baseUrl: 'https://flow.axionenterprise.cloud',
    healthPath: '/health',
    endpoints: [
      { id: 'health', name: 'Health', method: 'GET', path: '/health', description: 'Healthcheck de flow.' },
      { id: 'api_info', name: 'API info', method: 'GET', path: '/api', description: 'Info de rotas do Flow.' }
    ]
  },
  {
    appId: 'axion-dev',
    name: 'Axion Dev',
    category: 'platform',
    description: 'Landing e captação AXION Dev.',
    baseUrl: 'https://dev.axionenterprise.cloud',
    healthPath: '/health',
    endpoints: [
      { id: 'health', name: 'Health', method: 'GET', path: '/health', description: 'Healthcheck da app.' },
      { id: 'leads', name: 'Leads endpoint', method: 'POST', path: '/api/leads', description: 'Registro de lead', bodyTemplate: { name: 'Lead Test', email: 'lead@example.com', company: 'Axion' } }
    ]
  },
  {
    appId: 'api-axion-main',
    name: 'Axion Main API',
    category: 'control',
    description: 'API central de autenticacao e controle.',
    baseUrl: 'https://api.axionenterprise.cloud',
    healthPath: '/health',
    endpoints: [
      { id: 'health', name: 'Health', method: 'GET', path: '/health', description: 'Healthcheck da API principal.' },
      { id: 'api_info', name: 'API info', method: 'GET', path: '/api', description: 'Info da API principal.' }
    ]
  }
];

const normalizeHeaderName = (value) => String(value || '').trim().toLowerCase();

const toAbsoluteUrl = (baseUrl, relativePath) => {
  try {
    const base = new URL(baseUrl);
    return new URL(relativePath, base).toString();
  } catch {
    return '';
  }
};

export const getAppRegistry = () => {
  return APP_ENDPOINT_REGISTRY.map((app) => ({
    ...app,
    endpoints: (app.endpoints || []).map((endpoint) => ({
      ...endpoint,
      method: String(endpoint.method || 'GET').toUpperCase(),
      url: toAbsoluteUrl(app.baseUrl, endpoint.path),
    })),
  }));
};

export const findAppRegistryEntry = (appId) => {
  const target = String(appId || '').trim().toLowerCase();
  if (!target) return null;
  return getAppRegistry().find((entry) => entry.appId === target) || null;
};

export const findEndpointRegistryEntry = (appId, endpointId) => {
  const app = findAppRegistryEntry(appId);
  if (!app) return null;
  const targetEndpoint = String(endpointId || '').trim().toLowerCase();
  if (!targetEndpoint) return null;
  const endpoint = (app.endpoints || []).find((item) => item.id === targetEndpoint) || null;
  if (!endpoint) return null;
  return { app, endpoint };
};

export const filterOutgoingHeaders = (headers, allowed = []) => {
  const allowedSet = new Set((allowed || []).map((item) => normalizeHeaderName(item)).filter(Boolean));
  if (!allowedSet.size) return {};
  const filtered = {};
  Object.entries(headers || {}).forEach(([key, value]) => {
    const headerName = normalizeHeaderName(key);
    if (!headerName || !allowedSet.has(headerName)) return;
    filtered[headerName] = String(value || '').trim();
  });
  return filtered;
};
