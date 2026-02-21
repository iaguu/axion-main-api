import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const tempDir = path.resolve('temp/axion-main-api-tests');
const usersDbPath = path.join(tempDir, 'users.json');
const port = 3311;
const baseUrl = `http://127.0.0.1:${port}`;

let serverInstance;
let adminToken = '';

const waitForHealth = async (timeoutMs = 20000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('Server did not become healthy in time');
};

test.before(async () => {
  fs.mkdirSync(tempDir, { recursive: true });
  fs.writeFileSync(usersDbPath, JSON.stringify({ users: [] }, null, 2));
  process.env.PORT = String(port);
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-secret-key';
  process.env.USERS_DB_PATH = usersDbPath;
  process.env.RATE_LIMIT_MAX_REQUESTS = '10000';
  process.env.CORS_ORIGIN = 'http://localhost:3000';
  const serverModule = await import('../src/server.js');
  serverInstance = serverModule.startServer(port);

  await waitForHealth();

  const registerRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin-control-test@axion.local',
      password: '123456789',
      role: 'superadmin',
      name: 'Control Test Admin',
    }),
  });
  assert.equal(registerRes.status, 201);
  const registerJson = await registerRes.json();
  adminToken = registerJson?.tokens?.accessToken || '';
  assert.ok(adminToken.length > 10);
});

test.after(() => {
  if (serverInstance && typeof serverInstance.close === 'function') {
    serverInstance.close();
  }
});

const adminGet = async (route) => {
  const res = await fetch(`${baseUrl}${route}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const json = await res.json().catch(() => ({}));
  return { res, json };
};

const adminPost = async (route, body) => {
  const res = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json().catch(() => ({}));
  return { res, json };
};

test('registry apps should return mapped applications', async () => {
  const { res, json } = await adminGet('/api/admin/control/registry/apps');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(json.items));
  assert.ok(json.items.length >= 4);
  assert.ok(json.items.some((app) => app.appId === 'axion-pay'));
});

test('analytics timeseries should return array structure', async () => {
  const { res, json } = await adminGet('/api/admin/control/analytics/timeseries?appId=axion-pay&days=30&bucket=day');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(json.items));
  assert.ok(typeof json.total === 'number');
});

test('registry health should return consolidated online/offline status', async () => {
  const { res, json } = await adminGet('/api/admin/control/registry/health');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(json.items));
  assert.ok(typeof json.online === 'number');
  assert.ok(typeof json.offline === 'number');
  assert.equal(json.items.length, json.total);
});

test('registry proxy should execute mapped endpoint', async () => {
  const { res, json } = await adminPost('/api/admin/control/registry/proxy', {
    appId: 'api-axion-main',
    endpointId: 'health',
    query: {},
    headers: {},
    body: {},
  });
  assert.equal(res.status, 200);
  assert.equal(json.appId, 'api-axion-main');
  assert.equal(json.endpointId, 'health');
  assert.ok(typeof json.status === 'number');
});
