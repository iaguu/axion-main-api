import express from 'express';
import { authenticateToken, requireAdmin, requireSuperAdmin } from '../middleware/auth.js';
import User from '../models/User.js';
import controlPlane from '../models/ControlPlane.js';
import { logger } from '../utils/logger.js';
import { findAppRegistryEntry, findEndpointRegistryEntry, filterOutgoingHeaders, getAppRegistry } from '../config/appRegistry.js';

const router = express.Router();

// All admin routes require authentication
router.use(authenticateToken);

// Get all users (admin only)
router.get('/users', requireAdmin, async (req, res) => {
  try {
    const users = User.getAllUsers();
    res.json({ users });
  } catch (error) {
    logger.error('Get users failed', { error: error.message });
    res.status(500).json({ error: 'Failed to get users' });
  }
});

// Get user by ID (admin only)
router.get('/users/:id', requireAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ user });
  } catch (error) {
    logger.error('Get user failed', { error: error.message });
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// Update user role (superadmin only)
router.put('/users/:id/role', requireSuperAdmin, async (req, res) => {
  try {
    const { role } = req.body;
    
    if (!['user', 'admin', 'superadmin'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const user = await User.updateRole(req.params.id, role);
    
    logger.info('User role updated', { 
      targetUserId: req.params.id, 
      newRole: role, 
      updatedBy: req.user.id 
    });
    
    res.json({
      message: 'User role updated successfully',
      user
    });
  } catch (error) {
    logger.error('Update user role failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Toggle user status (admin only)
router.put('/users/:id/status', requireAdmin, async (req, res) => {
  try {
    const user = await User.toggleUserStatus(req.params.id);
    
    logger.info('User status toggled', { 
      targetUserId: req.params.id, 
      newStatus: user.isActive, 
      updatedBy: req.user.id 
    });
    
    res.json({
      message: 'User status updated successfully',
      user
    });
  } catch (error) {
    logger.error('Toggle user status failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Get system stats (admin only)
router.get('/stats', requireAdmin, async (req, res) => {
  try {
    const users = User.getAllUsers();
    const stats = {
      totalUsers: users.length,
      activeUsers: users.filter(u => u.isActive).length,
      inactiveUsers: users.filter(u => !u.isActive).length,
      admins: users.filter(u => u.role === 'admin').length,
      superAdmins: users.filter(u => u.role === 'superadmin').length,
      regularUsers: users.filter(u => u.role === 'user').length,
      recentLogins: users
        .filter(u => u.lastLogin)
        .sort((a, b) => new Date(b.lastLogin) - new Date(a.lastLogin))
        .slice(0, 10)
    };
    
    res.json({ stats });
  } catch (error) {
    logger.error('Get stats failed', { error: error.message });
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

router.get('/control/apps', requireAdmin, (req, res) => {
  try {
    const items = controlPlane.listApps();
    res.json({ items, total: items.length });
  } catch (error) {
    logger.error('Control apps failed', { error: error.message });
    res.status(500).json({ error: 'Failed to list control apps' });
  }
});

router.get('/control/catalog/original-texts', requireAdmin, (req, res) => {
  try {
    const items = controlPlane.getOriginalCatalog();
    res.json({ items, total: items.length });
  } catch (error) {
    logger.error('Control catalog failed', { error: error.message });
    res.status(500).json({ error: 'Failed to load original text catalog' });
  }
});

router.get('/control/catalog/original-texts/:appId', requireAdmin, (req, res) => {
  try {
    const data = controlPlane.getOriginalCatalogItems(req.params.appId, req.query.env, req.query.locale);
    res.json(data);
  } catch (error) {
    logger.error('Control app catalog failed', { error: error.message });
    res.status(500).json({ error: 'Failed to load app original text catalog' });
  }
});

router.get('/control/registry/apps', requireAdmin, (_req, res) => {
  try {
    const items = getAppRegistry();
    res.json({ items, total: items.length });
  } catch (error) {
    logger.error('Control registry apps failed', { error: error.message });
    res.status(500).json({ error: 'Failed to load app registry' });
  }
});

router.get('/control/registry/apps/:appId', requireAdmin, (req, res) => {
  try {
    const app = findAppRegistryEntry(req.params.appId);
    if (!app) {
      return res.status(404).json({ error: 'App not found in registry' });
    }
    res.json({ app });
  } catch (error) {
    logger.error('Control registry app detail failed', { error: error.message });
    res.status(500).json({ error: 'Failed to load app details' });
  }
});

router.get('/control/registry/health', requireAdmin, async (req, res) => {
  const startedAt = Date.now();
  try {
    const timeoutMsInput = Number.parseInt(String(req.query.timeoutMs || 4000), 10);
    const timeoutMs = Number.isFinite(timeoutMsInput) ? Math.min(Math.max(timeoutMsInput, 1000), 10000) : 4000;
    const apps = getAppRegistry();

    const checks = await Promise.all(
      apps.map(async (app) => {
        const targetUrl = new URL(app.healthPath || '/health', app.baseUrl).toString();
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        const checkStartedAt = Date.now();
        try {
          const response = await fetch(targetUrl, {
            method: 'GET',
            headers: { accept: 'application/json, text/plain;q=0.9, */*;q=0.8' },
            signal: controller.signal,
          });
          const contentType = String(response.headers.get('content-type') || '').toLowerCase();
          const payload = contentType.includes('application/json')
            ? await response.json().catch(() => ({}))
            : await response.text().catch(() => '');
          return {
            appId: app.appId,
            name: app.name,
            url: targetUrl,
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            durationMs: Date.now() - checkStartedAt,
            payload: typeof payload === 'string' ? payload.slice(0, 300) : payload,
          };
        } catch (error) {
          const isAbort = String(error?.name || '') === 'AbortError';
          return {
            appId: app.appId,
            name: app.name,
            url: targetUrl,
            ok: false,
            status: isAbort ? 504 : 502,
            statusText: isAbort ? 'timeout' : 'unreachable',
            durationMs: Date.now() - checkStartedAt,
            error: error.message,
          };
        } finally {
          clearTimeout(timeoutId);
        }
      }),
    );

    res.json({
      items: checks,
      total: checks.length,
      online: checks.filter((item) => item.ok).length,
      offline: checks.filter((item) => !item.ok).length,
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    logger.error('Control registry health failed', { error: error.message });
    res.status(500).json({ error: 'Failed to load registry health' });
  }
});

router.post('/control/registry/proxy', requireAdmin, async (req, res) => {
  const startedAt = Date.now();
  try {
    const appId = req.body?.appId;
    const endpointId = req.body?.endpointId;
    const found = findEndpointRegistryEntry(appId, endpointId);
    if (!found) {
      return res.status(404).json({ error: 'Endpoint not found in app registry' });
    }

    const { app, endpoint } = found;
    const target = new URL(endpoint.path, app.baseUrl);
    const method = String(endpoint.method || 'GET').toUpperCase();

    const query = req.body?.query && typeof req.body.query === 'object' ? req.body.query : {};
    Object.entries(query).forEach(([key, value]) => {
      if (value === null || value === undefined || value === '') return;
      target.searchParams.set(String(key), String(value));
    });

    const outgoingHeaders = {
      accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
      ...filterOutgoingHeaders(req.body?.headers, endpoint.requiresHeaders || []),
    };

    const controller = new AbortController();
    const timeoutMs = 12000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let body;
    if (method !== 'GET' && method !== 'HEAD') {
      body = JSON.stringify(req.body?.body ?? endpoint.bodyTemplate ?? {});
      outgoingHeaders['content-type'] = 'application/json';
    }

    let upstream;
    try {
      upstream = await fetch(target, {
        method,
        headers: outgoingHeaders,
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const contentType = String(upstream.headers.get('content-type') || '').toLowerCase();
    const isJson = contentType.includes('application/json');
    const payload = isJson ? await upstream.json().catch(() => ({})) : await upstream.text();

    const normalizedPayload =
      typeof payload === 'string' && payload.length > 25000
        ? `${payload.slice(0, 25000)}\n...[truncated]`
        : payload;

    res.status(200).json({
      ok: upstream.ok,
      appId: app.appId,
      endpointId: endpoint.id,
      method,
      targetUrl: target.toString(),
      status: upstream.status,
      statusText: upstream.statusText,
      durationMs: Date.now() - startedAt,
      response: normalizedPayload,
    });
  } catch (error) {
    const isAbort = String(error?.name || '') === 'AbortError';
    logger.warn('Control registry proxy failed', {
      error: error.message,
      durationMs: Date.now() - startedAt,
      aborted: isAbort,
    });
    res.status(isAbort ? 504 : 502).json({
      error: isAbort ? 'Upstream timeout' : 'Failed to call upstream endpoint',
      detail: error.message,
      durationMs: Date.now() - startedAt,
    });
  }
});

router.post('/control/bootstrap/original-texts', requireAdmin, (req, res) => {
  try {
    const result = controlPlane.seedMissingOriginalTexts({
      actor: req.user?.email || req.user?.id || 'admin',
      publish: req.body?.publish !== false,
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    logger.error('Control bootstrap original texts failed', { error: error.message });
    res.status(500).json({ error: 'Failed to bootstrap original texts' });
  }
});

router.get('/control/config/:appId', requireAdmin, (req, res) => {
  try {
    const data = controlPlane.getConfigAdmin(req.params.appId, req.query.env, req.query.locale);
    res.json(data);
  } catch (error) {
    logger.error('Control get config failed', { error: error.message });
    res.status(500).json({ error: 'Failed to load config' });
  }
});

router.post('/control/config/:appId', requireAdmin, (req, res) => {
  try {
    const changed = controlPlane.upsertConfig({
      appId: req.params.appId,
      env: req.body?.env || req.query.env,
      locale: req.body?.locale || req.query.locale,
      items: Array.isArray(req.body?.items) ? req.body.items : [req.body],
      actor: req.user?.email || req.user?.id || 'admin',
    });
    res.status(201).json({ ok: true, changedCount: changed.length, items: changed });
  } catch (error) {
    logger.error('Control upsert failed', { error: error.message });
    res.status(400).json({ error: error.message || 'Failed to save config' });
  }
});

router.post('/control/config/:appId/publish', requireAdmin, (req, res) => {
  try {
    const result = controlPlane.publishConfig({
      appId: req.params.appId,
      env: req.body?.env || req.query.env,
      locale: req.body?.locale || req.query.locale,
      actor: req.user?.email || req.user?.id || 'admin',
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    logger.error('Control publish failed', { error: error.message });
    res.status(400).json({ error: error.message || 'Failed to publish config' });
  }
});

router.post('/control/config/:appId/rollback', requireAdmin, (req, res) => {
  try {
    const result = controlPlane.rollbackConfig({
      appId: req.params.appId,
      env: req.body?.env || req.query.env,
      locale: req.body?.locale || req.query.locale,
      version: req.body?.version || req.query.version,
      actor: req.user?.email || req.user?.id || 'admin',
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    logger.error('Control rollback failed', { error: error.message });
    res.status(400).json({ error: error.message || 'Failed to rollback config' });
  }
});

router.get('/control/analytics/overview', requireAdmin, (req, res) => {
  try {
    const data = controlPlane.analyticsOverview({
      appId: req.query.appId,
      eventType: req.query.eventType,
      originSource: req.query.originSource,
      days: req.query.days,
      pathFilter: req.query.path,
    });
    res.json(data);
  } catch (error) {
    logger.error('Control analytics overview failed', { error: error.message });
    res.status(500).json({ error: 'Failed to load analytics overview' });
  }
});

router.get('/control/analytics/clicks', requireAdmin, (req, res) => {
  try {
    const limit = Number.parseInt(String(req.query.limit || 10), 10);
    const items = controlPlane.analyticsClicks(
      {
        appId: req.query.appId,
        eventType: req.query.eventType,
        originSource: req.query.originSource,
        days: req.query.days,
      },
      Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : 10,
    );
    res.json({ items, total: items.length });
  } catch (error) {
    logger.error('Control analytics clicks failed', { error: error.message });
    res.status(500).json({ error: 'Failed to load click analytics' });
  }
});

router.get('/control/analytics/events', requireAdmin, (req, res) => {
  try {
    const limit = Number.parseInt(String(req.query.limit || 200), 10);
    const items = controlPlane
      .filterEvents({
        appId: req.query.appId,
        eventType: req.query.eventType,
        originSource: req.query.originSource,
        days: req.query.days,
        pathFilter: req.query.path,
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, Number.isFinite(limit) && limit > 0 ? Math.min(limit, 2000) : 200);
    res.json({ items, total: items.length });
  } catch (error) {
    logger.error('Control analytics events failed', { error: error.message });
    res.status(500).json({ error: 'Failed to load analytics events' });
  }
});

router.get('/control/analytics/timeseries', requireAdmin, (req, res) => {
  try {
    const items = controlPlane.analyticsTimeseries(
      {
        appId: req.query.appId,
        eventType: req.query.eventType,
        originSource: req.query.originSource,
        days: req.query.days,
        pathFilter: req.query.path,
      },
      req.query.bucket,
    );
    res.json({ items, total: items.length });
  } catch (error) {
    logger.error('Control analytics timeseries failed', { error: error.message });
    res.status(500).json({ error: 'Failed to load analytics timeseries' });
  }
});

router.get('/control/audit', requireAdmin, (req, res) => {
  try {
    const limit = Number.parseInt(String(req.query.limit || 100), 10);
    const items = controlPlane.listAudit({
      appId: req.query.appId,
      action: req.query.action,
      limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 2000) : 100,
    });
    res.json({ items, total: items.length });
  } catch (error) {
    logger.error('Control audit failed', { error: error.message });
    res.status(500).json({ error: 'Failed to load audit logs' });
  }
});

export default router;
