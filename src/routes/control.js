import express from 'express';
import controlPlane from '../models/ControlPlane.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

const requireIngestKeyIfConfigured = (req, res, next) => {
  const ingestKey = String(process.env.CONTROL_INGEST_KEY || '').trim();
  if (!ingestKey) return next();
  const incoming = String(req.headers['x-axion-ingest-key'] || '').trim();
  if (incoming !== ingestKey) return res.status(401).json({ error: 'Invalid ingest key' });
  return next();
};

router.post('/ingest/events', requireIngestKeyIfConfigured, (req, res) => {
  try {
    const event = controlPlane.ingestEvent(req.body || {}, {
      ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
      userAgent: req.headers['user-agent'] || '',
      referrer: req.headers.referer || '',
    });
    res.status(201).json({ ok: true, eventId: event.id });
  } catch (error) {
    logger.warn('Control ingest rejected', { error: error.message });
    res.status(400).json({ error: error.message || 'Invalid event payload' });
  }
});

router.get('/config/:appId', (req, res) => {
  try {
    const data = controlPlane.getPublicConfig(req.params.appId, req.query.env, req.query.locale);
    res.json(data);
  } catch (error) {
    logger.error('Get public control config failed', { error: error.message });
    res.status(500).json({ error: 'Failed to load config' });
  }
});

export default router;
