import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import User from '../models/User.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// Get current user profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ user });
  } catch (error) {
    logger.error('Get profile failed', { error: error.message });
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

// Update current user profile
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const { name } = req.body;
    const users = User.getUsers();
    const userIndex = users.findIndex(u => u.id === req.user.id);
    
    if (userIndex === -1) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (name) users[userIndex].name = name;
    users[userIndex].updatedAt = new Date().toISOString();
    
    User.saveUsers(users);
    
    const { password, ...userWithoutPassword } = users[userIndex];
    
    logger.info('Profile updated', { userId: req.user.id });
    
    res.json({
      message: 'Profile updated successfully',
      user: userWithoutPassword
    });
  } catch (error) {
    logger.error('Profile update failed', { error: error.message });
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Change password
router.put('/password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new passwords required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    const users = User.getUsers();
    const userIndex = users.findIndex(u => u.id === req.user.id);
    
    if (userIndex === -1) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isValidPassword = await User.validatePassword(users[userIndex], currentPassword);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const bcrypt = await import('bcryptjs');
    users[userIndex].password = await bcrypt.hash(newPassword, 10);
    users[userIndex].updatedAt = new Date().toISOString();
    
    User.saveUsers(users);
    
    logger.info('Password changed', { userId: req.user.id });
    
    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    logger.error('Password change failed', { error: error.message });
    res.status(500).json({ error: 'Failed to change password' });
  }
});

export default router;
