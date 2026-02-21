import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import adminRoutes from './routes/admin.js';
import controlRoutes from './routes/control.js';
import { logger } from './utils/logger.js';
import { errorHandler } from './middleware/errorHandler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Middleware
app.use(helmet());
const allowedOrigins = String(process.env.CORS_ORIGIN || 'http://localhost:3000')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }
    const isExactAllowed = allowedOrigins.includes(origin);
    let isAxionSubdomain = false;
    try {
      isAxionSubdomain = /\.axionenterprise\.cloud$/i.test(new URL(origin).hostname);
    } catch {
      isAxionSubdomain = false;
    }
    if (isExactAllowed || isAxionSubdomain) {
      callback(null, true);
      return;
    }
    callback(new Error('CORS origin not allowed'));
  },
  credentials: true
}));
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));
app.use(limiter);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/control', controlRoutes);

const publicDir = path.join(__dirname, '../public');
app.use(express.static(publicDir));
app.get('/', (_req, res) => {
  res.sendFile(path.join(publicDir, 'dashboard.html'));
});
app.get('/dashboard', (_req, res) => {
  res.sendFile(path.join(publicDir, 'dashboard.html'));
});

app.get('/api', (_req, res) => {
  res.json({
    service: 'axion-main-api',
    status: 'online',
    health: '/health',
    routes: {
      auth: '/api/auth',
      users: '/api/users',
      admin: '/api/admin',
      control: '/api/control'
    }
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'axion-main-api',
    version: '1.0.0'
  });
});

// Error handling
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

export const startServer = (port = PORT) => {
  const server = app.listen(port, () => {
    logger.info(`Axion Main API running on port ${port}`);
    logger.info(`Environment: ${process.env.NODE_ENV}`);
  });
  return server;
};

if (process.env.NODE_ENV !== 'test') {
  startServer(PORT);
}

export default app;
