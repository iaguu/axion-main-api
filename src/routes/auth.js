import express from 'express';
import { body, validationResult } from 'express-validator';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// Validation middleware
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array()
    });
  }
  next();
};

// Register
router.post('/register', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('name').optional().isLength({ min: 2 }),
  body('role').optional().isIn(['user', 'admin', 'superadmin'])
], handleValidationErrors, async (req, res) => {
  try {
    const { email, password, name, role } = req.body;
    
    const user = await User.create({ email, password, name, role });
    const tokens = User.generateTokens(user);
    
    await User.updateLastLogin(user.id);
    
    logger.info('User registered successfully', { userId: user.id, email });
    
    res.status(201).json({
      message: 'User registered successfully',
      user,
      tokens
    });
  } catch (error) {
    logger.error('Registration failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

// Login
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty()
], handleValidationErrors, async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const user = await User.findByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!user.isActive) {
      return res.status(401).json({ error: 'Account disabled' });
    }

    const isValidPassword = await User.validatePassword(user, password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const tokens = User.generateTokens(user);
    await User.updateLastLogin(user.id);
    
    const { password: _, ...userWithoutPassword } = user;
    
    logger.info('User logged in successfully', { userId: user.id, email });
    
    res.json({
      message: 'Login successful',
      user: userWithoutPassword,
      tokens
    });
  } catch (error) {
    logger.error('Login failed', { error: error.message });
    res.status(500).json({ error: 'Login failed' });
  }
});

// Refresh token
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      return res.status(401).json({ error: 'Refresh token required' });
    }

    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    const tokens = User.generateTokens(user);
    
    res.json({ tokens });
  } catch (error) {
    logger.error('Token refresh failed', { error: error.message });
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

// Logout (client-side token invalidation)
router.post('/logout', (req, res) => {
  res.json({ message: 'Logout successful' });
});

export default router;
