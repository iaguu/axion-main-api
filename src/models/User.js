import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class User {
  constructor() {
    const customPath = String(process.env.USERS_DB_PATH || '').trim();
    this.dbPath = customPath
      ? path.resolve(process.cwd(), customPath)
      : path.join(__dirname, '../../data/users.json');
    this.ensureDataFile();
  }

  ensureDataFile() {
    const dataDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    if (!fs.existsSync(this.dbPath)) {
      fs.writeFileSync(this.dbPath, JSON.stringify({ users: [] }, null, 2));
    }
  }

  getUsers() {
    try {
      const data = fs.readFileSync(this.dbPath, 'utf8');
      return JSON.parse(data).users || [];
    } catch (error) {
      return [];
    }
  }

  saveUsers(users) {
    const data = { users };
    fs.writeFileSync(this.dbPath, JSON.stringify(data, null, 2));
  }

  async create(userData) {
    const users = this.getUsers();
    
    // Check if user already exists
    if (users.find(u => u.email === userData.email)) {
      throw new Error('User already exists');
    }

    const hashedPassword = await bcrypt.hash(userData.password, 10);
    
    const newUser = {
      id: uuidv4(),
      email: userData.email,
      password: hashedPassword,
      name: userData.name || '',
      role: userData.role || 'user',
      isActive: true,
      twoFactorEnabled: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastLogin: null
    };

    users.push(newUser);
    this.saveUsers(users);
    
    // Return user without password
    const { password, ...userWithoutPassword } = newUser;
    return userWithoutPassword;
  }

  async findByEmail(email) {
    const users = this.getUsers();
    return users.find(u => u.email === email);
  }

  async findById(id) {
    const users = this.getUsers();
    const user = users.find(u => u.id === id);
    if (user) {
      const { password, ...userWithoutPassword } = user;
      return userWithoutPassword;
    }
    return null;
  }

  async validatePassword(user, password) {
    return await bcrypt.compare(password, user.password);
  }

  generateTokens(user) {
    const payload = {
      id: user.id,
      email: user.email,
      role: user.role
    };

    const accessToken = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d'
    });

    const refreshToken = jwt.sign(
      { id: user.id }, 
      process.env.JWT_SECRET, 
      { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d' }
    );

    return { accessToken, refreshToken };
  }

  async updateLastLogin(userId) {
    const users = this.getUsers();
    const userIndex = users.findIndex(u => u.id === userId);
    
    if (userIndex !== -1) {
      users[userIndex].lastLogin = new Date().toISOString();
      users[userIndex].updatedAt = new Date().toISOString();
      this.saveUsers(users);
    }
  }

  async updateRole(userId, newRole) {
    const users = this.getUsers();
    const userIndex = users.findIndex(u => u.id === userId);
    
    if (userIndex === -1) {
      throw new Error('User not found');
    }

    users[userIndex].role = newRole;
    users[userIndex].updatedAt = new Date().toISOString();
    this.saveUsers(users);
    
    const { password, ...userWithoutPassword } = users[userIndex];
    return userWithoutPassword;
  }

  async toggleUserStatus(userId) {
    const users = this.getUsers();
    const userIndex = users.findIndex(u => u.id === userId);
    
    if (userIndex === -1) {
      throw new Error('User not found');
    }

    users[userIndex].isActive = !users[userIndex].isActive;
    users[userIndex].updatedAt = new Date().toISOString();
    this.saveUsers(users);
    
    const { password, ...userWithoutPassword } = users[userIndex];
    return userWithoutPassword;
  }

  getAllUsers() {
    const users = this.getUsers();
    return users.map(({ password, ...user }) => user);
  }
}

export default new User();
