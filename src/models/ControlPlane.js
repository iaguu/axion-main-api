import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { ORIGINAL_TEXT_CATALOG } from '../config/originalTexts.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_FILES = {
  configs: path.join(__dirname, '../../data/control-configs.json'),
  events: path.join(__dirname, '../../data/control-events.json'),
  audit: path.join(__dirname, '../../data/control-audit.json'),
};

const ALLOWED_STATUS = new Set(['draft', 'published']);
const ALLOWED_ORIGINS = new Set(['meta_ads', 'google_ads', 'organic', 'direct', 'email', 'affiliate', 'unknown']);

const safeRead = (filePath, fallback) => {
  try {
    const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '').trim();
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};

const safeWrite = (filePath, value) => {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2));
  fs.renameSync(tempPath, filePath);
};

const normalizeText = (value, max = 200, fallback = '') => {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : fallback;
};

const normalizeSlug = (value, max = 100, fallback = '') => {
  const cleaned = String(value ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned ? cleaned.slice(0, max) : fallback;
};

const toIso = (value) => {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
};

class ControlPlane {
  constructor() {
    this.paths = DEFAULT_FILES;
    this.ensureFiles();
    this.seedMissingOriginalTexts({ actor: 'system_seed', publish: true });
  }

  ensureFiles() {
    safeWrite(this.paths.configs, safeRead(this.paths.configs, { items: [], revisions: [] }));
    safeWrite(this.paths.events, safeRead(this.paths.events, { items: [] }));
    safeWrite(this.paths.audit, safeRead(this.paths.audit, { items: [] }));
  }

  readConfigs() {
    return safeRead(this.paths.configs, { items: [], revisions: [] });
  }

  writeConfigs(payload) {
    safeWrite(this.paths.configs, payload);
  }

  readEvents() {
    return safeRead(this.paths.events, { items: [] });
  }

  writeEvents(payload) {
    safeWrite(this.paths.events, payload);
  }

  readAudit() {
    return safeRead(this.paths.audit, { items: [] });
  }

  writeAudit(payload) {
    safeWrite(this.paths.audit, payload);
  }

  registerAudit({ actor, action, resourceType, resourceId, before = null, after = null }) {
    const audit = this.readAudit();
    audit.items.unshift({
      id: crypto.randomUUID(),
      actor: normalizeText(actor, 120, 'system'),
      action: normalizeSlug(action, 60, 'update'),
      resourceType: normalizeSlug(resourceType, 80, 'resource'),
      resourceId: normalizeText(resourceId, 120, ''),
      before,
      after,
      createdAt: new Date().toISOString(),
    });
    audit.items = audit.items.slice(0, 5000);
    this.writeAudit(audit);
  }

  ingestEvent(payload, context = {}) {
    const events = this.readEvents();
    const event = {
      id: crypto.randomUUID(),
      appId: normalizeSlug(payload.appId, 80, ''),
      sessionId: normalizeText(payload.sessionId, 120, ''),
      userId: normalizeText(payload.userId, 120, ''),
      eventType: normalizeSlug(payload.eventType || payload.type, 80, ''),
      eventName: normalizeSlug(payload.eventName || payload.name || payload.eventType || payload.type, 120, ''),
      eventValue: Number.isFinite(Number(payload.eventValue ?? payload.value)) ? Number(payload.eventValue ?? payload.value) : null,
      path: normalizeText(payload.path, 400, ''),
      referrer: normalizeText(payload.referrer || context.referrer, 500, ''),
      originSource: this.normalizeOriginSource(payload.originSource || payload.utmSource || payload.utm_source),
      utmSource: normalizeText(payload.utmSource || payload.utm_source, 120, ''),
      utmMedium: normalizeText(payload.utmMedium || payload.utm_medium, 120, ''),
      utmCampaign: normalizeText(payload.utmCampaign || payload.utm_campaign, 160, ''),
      metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {},
      ip: normalizeText(context.ip, 80, ''),
      userAgent: normalizeText(context.userAgent, 240, ''),
      createdAt: toIso(payload.timestamp),
    };

    if (!event.appId || !event.eventType) {
      throw new Error('appId and eventType are required');
    }

    if (!event.eventName) event.eventName = event.eventType;

    events.items.unshift(event);
    events.items = events.items.slice(0, 200000);
    this.writeEvents(events);
    return event;
  }

  normalizeOriginSource(value) {
    const normalized = normalizeSlug(value, 30, 'unknown');
    if (!normalized) return 'unknown';
    if (ALLOWED_ORIGINS.has(normalized)) return normalized;
    return 'unknown';
  }

  getPublicConfig(appId, env = 'prod', locale = 'pt-BR') {
    const configs = this.readConfigs();
    const targetApp = normalizeSlug(appId, 80, '');
    const targetEnv = normalizeSlug(env, 20, 'prod');
    const targetLocale = normalizeText(locale, 20, 'pt-BR');

    const items = configs.items
      .filter((item) => item.appId === targetApp && item.env === targetEnv && item.locale === targetLocale && item.status === 'published')
      .sort((a, b) => `${a.namespace}.${a.key}`.localeCompare(`${b.namespace}.${b.key}`));

    const payload = {};
    for (const item of items) {
      if (!payload[item.namespace]) payload[item.namespace] = {};
      payload[item.namespace][item.key] = item.value;
    }

    return { appId: targetApp, env: targetEnv, locale: targetLocale, items, payload, total: items.length };
  }

  listApps() {
    const configs = this.readConfigs();
    const map = {};
    for (const item of configs.items) {
      if (!map[item.appId]) {
        map[item.appId] = { appId: item.appId, totalConfigs: 0, publishedConfigs: 0, lastUpdated: item.updatedAt };
      }
      map[item.appId].totalConfigs += 1;
      if (item.status === 'published') map[item.appId].publishedConfigs += 1;
      if (item.updatedAt > map[item.appId].lastUpdated) map[item.appId].lastUpdated = item.updatedAt;
    }
    return Object.values(map);
  }

  getOriginalCatalog() {
    return ORIGINAL_TEXT_CATALOG.map((entry) => ({
      appId: normalizeSlug(entry.appId, 80, ''),
      env: normalizeSlug(entry.env, 20, 'prod'),
      locale: normalizeText(entry.locale, 20, 'pt-BR'),
      totalItems: Array.isArray(entry.items) ? entry.items.length : 0,
    }));
  }

  getOriginalCatalogItems(appId, env = 'prod', locale = 'pt-BR') {
    const targetApp = normalizeSlug(appId, 80, '');
    const targetEnv = normalizeSlug(env, 20, 'prod');
    const targetLocale = normalizeText(locale, 20, 'pt-BR');
    const match = ORIGINAL_TEXT_CATALOG.find((entry) => {
      return (
        normalizeSlug(entry.appId, 80, '') === targetApp &&
        normalizeSlug(entry.env, 20, 'prod') === targetEnv &&
        normalizeText(entry.locale, 20, 'pt-BR') === targetLocale
      );
    });

    const items = Array.isArray(match?.items)
      ? match.items
          .map((item) => ({
            namespace: normalizeSlug(item.namespace, 120, ''),
            key: normalizeSlug(item.key, 120, ''),
            value: item.value ?? '',
          }))
          .filter((item) => item.namespace && item.key)
      : [];

    return {
      appId: targetApp,
      env: targetEnv,
      locale: targetLocale,
      items,
      total: items.length,
    };
  }

  getConfigAdmin(appId, env = 'prod', locale = 'pt-BR') {
    const configs = this.readConfigs();
    const targetApp = normalizeSlug(appId, 80, '');
    const targetEnv = normalizeSlug(env, 20, 'prod');
    const targetLocale = normalizeText(locale, 20, 'pt-BR');
    const items = configs.items.filter((item) => item.appId === targetApp && item.env === targetEnv && item.locale === targetLocale);
    return { appId: targetApp, env: targetEnv, locale: targetLocale, items, total: items.length };
  }

  upsertConfig({ appId, env = 'prod', locale = 'pt-BR', items = [], actor = 'system' }) {
    const configs = this.readConfigs();
    const changed = [];
    const now = new Date().toISOString();
    const targetApp = normalizeSlug(appId, 80, '');
    const targetEnv = normalizeSlug(env, 20, 'prod');
    const targetLocale = normalizeText(locale, 20, 'pt-BR');

    for (const input of items) {
      const namespace = normalizeSlug(input.namespace, 120, '');
      const key = normalizeSlug(input.key, 120, '');
      if (!namespace || !key) continue;

      const index = configs.items.findIndex((item) => item.appId === targetApp && item.env === targetEnv && item.locale === targetLocale && item.namespace === namespace && item.key === key);

      if (index >= 0) {
        const before = { ...configs.items[index] };
        configs.items[index] = {
          ...configs.items[index],
          value: input.value ?? null,
          valueType: normalizeSlug(input.valueType, 20, 'json'),
          status: 'draft',
          updatedBy: normalizeText(actor, 120, 'system'),
          updatedAt: now,
        };
        changed.push(configs.items[index]);
        this.registerAudit({ actor, action: 'config_update', resourceType: 'control_config', resourceId: configs.items[index].id, before, after: configs.items[index] });
      } else {
        const created = {
          id: crypto.randomUUID(),
          appId: targetApp,
          env: targetEnv,
          locale: targetLocale,
          namespace,
          key,
          value: input.value ?? null,
          valueType: normalizeSlug(input.valueType, 20, 'json'),
          version: 0,
          status: 'draft',
          updatedBy: normalizeText(actor, 120, 'system'),
          createdAt: now,
          updatedAt: now,
        };
        configs.items.push(created);
        changed.push(created);
        this.registerAudit({ actor, action: 'config_create', resourceType: 'control_config', resourceId: created.id, before: null, after: created });
      }
    }

    this.writeConfigs(configs);
    return changed;
  }

  publishConfig({ appId, env = 'prod', locale = 'pt-BR', actor = 'system' }) {
    const configs = this.readConfigs();
    const targetApp = normalizeSlug(appId, 80, '');
    const targetEnv = normalizeSlug(env, 20, 'prod');
    const targetLocale = normalizeText(locale, 20, 'pt-BR');
    const candidates = configs.items.filter((item) => item.appId === targetApp && item.env === targetEnv && item.locale === targetLocale);

    if (!candidates.length) return { version: 0, items: 0 };

    const nextVersion = candidates.reduce((max, item) => Math.max(max, Number(item.version || 0)), 0) + 1;
    const now = new Date().toISOString();

    for (const item of candidates) {
      const before = { ...item };
      item.version = nextVersion;
      item.status = 'published';
      item.updatedBy = normalizeText(actor, 120, 'system');
      item.updatedAt = now;
      this.registerAudit({ actor, action: 'publish', resourceType: 'control_config', resourceId: item.id, before, after: item });
      configs.revisions.unshift({
        id: crypto.randomUUID(),
        configId: item.id,
        appId: item.appId,
        env: item.env,
        locale: item.locale,
        version: nextVersion,
        snapshot: item,
        createdAt: now,
      });
    }

    configs.revisions = configs.revisions.slice(0, 20000);
    this.writeConfigs(configs);
    return { version: nextVersion, items: candidates.length };
  }

  rollbackConfig({ appId, env = 'prod', locale = 'pt-BR', version, actor = 'system' }) {
    const configs = this.readConfigs();
    const targetApp = normalizeSlug(appId, 80, '');
    const targetEnv = normalizeSlug(env, 20, 'prod');
    const targetLocale = normalizeText(locale, 20, 'pt-BR');
    const targetVersion = Number.parseInt(String(version), 10);
    if (!Number.isInteger(targetVersion) || targetVersion <= 0) throw new Error('Invalid version');

    const revisions = configs.revisions.filter((rev) => rev.appId === targetApp && rev.env === targetEnv && rev.locale === targetLocale && Number(rev.version) === targetVersion);
    if (!revisions.length) throw new Error('Version not found');

    let restored = 0;
    const now = new Date().toISOString();
    for (const rev of revisions) {
      const index = configs.items.findIndex((item) => item.id === rev.configId);
      if (index >= 0) {
        const before = { ...configs.items[index] };
        configs.items[index] = {
          ...rev.snapshot,
          version: targetVersion,
          status: 'published',
          updatedBy: normalizeText(actor, 120, 'system'),
          updatedAt: now,
        };
        this.registerAudit({ actor, action: 'rollback', resourceType: 'control_config', resourceId: rev.configId, before, after: configs.items[index] });
        restored += 1;
      }
    }

    this.writeConfigs(configs);
    return { restored, version: targetVersion };
  }

  listAudit({ appId = '', action = '', limit = 100 }) {
    const audit = this.readAudit();
    const targetApp = normalizeSlug(appId, 80, '');
    const targetAction = normalizeSlug(action, 60, '');
    let items = audit.items;
    if (targetAction) items = items.filter((item) => item.action === targetAction);
    if (targetApp) {
      items = items.filter((item) => {
        const afterApp = normalizeSlug(item.after?.appId, 80, '');
        const beforeApp = normalizeSlug(item.before?.appId, 80, '');
        return afterApp === targetApp || beforeApp === targetApp;
      });
    }
    return items.slice(0, limit);
  }

  filterEvents({ appId = '', eventType = '', originSource = '', days = 30, pathFilter = '' }) {
    const events = this.readEvents();
    const since = new Date(Date.now() - Math.max(1, Number(days || 30)) * 24 * 60 * 60 * 1000);
    const targetApp = normalizeSlug(appId, 80, '');
    const targetType = normalizeSlug(eventType, 80, '');
    const targetOrigin = normalizeSlug(originSource, 30, '');
    const targetPath = normalizeText(pathFilter, 300, '');

    return events.items.filter((entry) => {
      if (new Date(entry.createdAt) < since) return false;
      if (targetApp && normalizeSlug(entry.appId, 80, '') !== targetApp) return false;
      if (targetType && normalizeSlug(entry.eventType, 80, '') !== targetType) return false;
      if (targetOrigin && normalizeSlug(entry.originSource, 30, '') !== targetOrigin) return false;
      if (targetPath && !String(entry.path || '').includes(targetPath)) return false;
      return true;
    });
  }

  analyticsOverview(filters = {}) {
    const events = this.filterEvents(filters);
    const byApp = {};
    const byType = {};
    const byOrigin = {};
    let totalClicks = 0;
    let totalPageViews = 0;
    let totalConversions = 0;

    for (const entry of events) {
      const app = normalizeSlug(entry.appId, 80, 'unknown');
      const type = normalizeSlug(entry.eventType, 80, 'unknown');
      const origin = this.normalizeOriginSource(entry.originSource);

      byApp[app] = (byApp[app] || 0) + 1;
      byType[type] = (byType[type] || 0) + 1;
      byOrigin[origin] = (byOrigin[origin] || 0) + 1;

      if (type === 'click' || String(entry.eventName || '').includes('click')) totalClicks += 1;
      if (type === 'page_view') totalPageViews += 1;
      if (['purchase', 'conversion', 'form_submit'].includes(type)) totalConversions += 1;
    }

    return {
      totalEvents: events.length,
      totalClicks,
      totalPageViews,
      totalConversions,
      byApp,
      byType,
      byOrigin,
      generatedAt: new Date().toISOString(),
    };
  }

  analyticsClicks(filters = {}, limit = 10) {
    const events = this.filterEvents(filters).filter((entry) => {
      const type = normalizeSlug(entry.eventType, 80, '');
      return type === 'click' || String(entry.eventName || '').includes('click');
    });
    const grouped = {};
    for (const entry of events) {
      const key = normalizeSlug(entry.eventName || entry.eventType, 120, 'click');
      grouped[key] = (grouped[key] || 0) + 1;
    }
    return Object.entries(grouped)
      .map(([eventName, total]) => ({ eventName, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, limit);
  }

  analyticsTimeseries(filters = {}, bucket = 'day') {
    const events = this
      .filterEvents(filters)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    const normalizedBucket = normalizeSlug(bucket, 10, 'day');
    const grouped = {};

    for (const entry of events) {
      const date = new Date(entry.createdAt);
      if (Number.isNaN(date.getTime())) continue;

      const key =
        normalizedBucket === 'hour'
          ? date.toISOString().slice(0, 13)
          : date.toISOString().slice(0, 10);

      grouped[key] = grouped[key] || {
        bucket: key,
        totalEvents: 0,
        clicks: 0,
        conversions: 0,
        pageViews: 0,
      };

      grouped[key].totalEvents += 1;
      const type = normalizeSlug(entry.eventType, 80, '');
      if (type === 'click' || String(entry.eventName || '').includes('click')) grouped[key].clicks += 1;
      if (type === 'page_view') grouped[key].pageViews += 1;
      if (['purchase', 'conversion', 'form_submit'].includes(type)) grouped[key].conversions += 1;
    }

    return Object.values(grouped).sort((a, b) => String(a.bucket).localeCompare(String(b.bucket)));
  }

  seedMissingOriginalTexts({ actor = 'system_seed', publish = true } = {}) {
    const configs = this.readConfigs();
    const now = new Date().toISOString();
    let inserted = 0;
    const touched = new Map();

    for (const catalogEntry of ORIGINAL_TEXT_CATALOG) {
      const appId = normalizeSlug(catalogEntry.appId, 80, '');
      const env = normalizeSlug(catalogEntry.env, 20, 'prod');
      const locale = normalizeText(catalogEntry.locale, 20, 'pt-BR');
      const seedItems = Array.isArray(catalogEntry.items) ? catalogEntry.items : [];
      if (!appId || !seedItems.length) continue;

      const touchKey = `${appId}:${env}:${locale}`;
      if (!touched.has(touchKey)) touched.set(touchKey, 0);

      for (const seed of seedItems) {
        const namespace = normalizeSlug(seed.namespace, 120, '');
        const key = normalizeSlug(seed.key, 120, '');
        if (!namespace || !key) continue;

        const existingIndex = configs.items.findIndex(
          (item) =>
            item.appId === appId &&
            item.env === env &&
            item.locale === locale &&
            item.namespace === namespace &&
            item.key === key,
        );
        if (existingIndex >= 0) continue;

        const maxVersion = configs.items
          .filter((item) => item.appId === appId && item.env === env && item.locale === locale)
          .reduce((max, item) => Math.max(max, Number(item.version || 0)), 0);

        const created = {
          id: crypto.randomUUID(),
          appId,
          env,
          locale,
          namespace,
          key,
          value: seed.value ?? '',
          valueType: 'string',
          version: publish ? Math.max(1, maxVersion) : 0,
          status: publish ? 'published' : 'draft',
          updatedBy: normalizeText(actor, 120, 'system'),
          createdAt: now,
          updatedAt: now,
        };
        configs.items.push(created);
        inserted += 1;
        touched.set(touchKey, (touched.get(touchKey) || 0) + 1);

        this.registerAudit({
          actor,
          action: 'config_seed_original',
          resourceType: 'control_config',
          resourceId: created.id,
          before: null,
          after: created,
        });
      }
    }

    if (inserted > 0) this.writeConfigs(configs);
    return {
      inserted,
      touchedScopes: Array.from(touched.entries())
        .filter(([, total]) => total > 0)
        .map(([scope, total]) => ({ scope, total })),
    };
  }
}

export default new ControlPlane();
