import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { PaymentHistory, Invoice, Refund, PaymentReminder, VideoProgress, LiveSession, WorkoutPlan, DietPlan } from "./models";
import mongoose from "mongoose";
import { hashPassword, comparePassword, validateEmail, validatePassword } from "./utils/auth";
import { generateAccessToken, generateRefreshToken } from "./utils/jwt";
import { authenticateToken, requireAdmin, requireRole, optionalAuth, requireOwnershipOrAdmin } from "./middleware/auth";
import { exportUserData } from "./utils/data-export";
import { emailService } from "./utils/email";
import { zoomService } from "./services/zoom";
import { upload } from "./middleware/upload";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import { 
  loginRateLimiter, 
  uploadRateLimiter, 
  paymentWebhookRateLimiter,
  signupRateLimiter,
  passwordResetRateLimiter,
  generalApiRateLimiter
} from "./middleware/rate-limit";

const resetTokens = new Map<string, { email: string; expiry: Date }>();

// Cleanup function to fix all string clientIds to ObjectIds
async function fixStringClientIds() {
  try {
    console.log('🔧 Checking for string clientIds to fix...');
    
    // Fix WorkoutPlan clientIds
    const workoutPlans = await WorkoutPlan.find({ clientId: { $type: 'string' } }).lean();
    if (workoutPlans.length > 0) {
      console.log(`Found ${workoutPlans.length} workout plans with string clientIds, fixing...`);
      for (const plan of workoutPlans) {
        try {
          const objectId = new mongoose.Types.ObjectId(plan.clientId);
          await WorkoutPlan.updateOne({ _id: plan._id }, { $set: { clientId: objectId } });
          console.log(`✓ Fixed WorkoutPlan: ${plan.name}`);
        } catch (err: any) {
          console.error(`✗ Error fixing WorkoutPlan ${plan._id}: ${err.message}`);
        }
      }
    }

    // Fix DietPlan clientIds
    const dietPlans = await DietPlan.find({ clientId: { $type: 'string' } }).lean();
    if (dietPlans.length > 0) {
      console.log(`Found ${dietPlans.length} diet plans with string clientIds, fixing...`);
      for (const plan of dietPlans) {
        try {
          const objectId = new mongoose.Types.ObjectId(plan.clientId);
          await DietPlan.updateOne({ _id: plan._id }, { $set: { clientId: objectId } });
          console.log(`✓ Fixed DietPlan: ${plan.name}`);
        } catch (err: any) {
          console.error(`✗ Error fixing DietPlan ${plan._id}: ${err.message}`);
        }
      }
    }

    if (workoutPlans.length === 0 && dietPlans.length === 0) {
      console.log('✅ All clientIds are properly formatted (no string IDs found)');
    } else {
      console.log('✅ ClientID cleanup completed');
    }
  } catch (error: any) {
    console.error('⚠️ Error during clientID cleanup:', error.message);
  }
}

// Helper function to normalize exercises from old nested format to flat format
function normalizeExercises(exercises: any): Record<string, any[]> {
  if (!exercises) return {};
  
  const normalized: Record<string, any[]> = {};
  
  Object.entries(exercises).forEach(([day, data]: [string, any]) => {
    // If it's already an array, use it directly (new format)
    if (Array.isArray(data)) {
      normalized[day] = data;
    } 
    // If it's an object with exercises property, extract it (old nested format)
    else if (data && typeof data === 'object' && Array.isArray(data.exercises)) {
      normalized[day] = data.exercises;
    }
    // Otherwise, treat as empty array
    else {
      normalized[day] = [];
    }
  });
  
  return normalized;
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Run cleanup on startup
  await fixStringClientIds();
  
  // Apply general API rate limiting to all /api routes
  app.use('/api', generalApiRateLimiter);
  
  // Authentication routes
  app.post("/api/auth/signup", signupRateLimiter, async (req, res) => {
    try {
      const { email, password, name, phone } = req.body;
      
      // Validate input
      if (!email || !password || !name) {
        return res.status(400).json({ message: "Email, password, and name are required" });
      }
      
      if (!validateEmail(email)) {
        return res.status(400).json({ message: "Invalid email format" });
      }
      
      const passwordValidation = validatePassword(password);
      if (!passwordValidation.valid) {
        return res.status(400).json({ message: passwordValidation.message });
      }
      
      // Check if user already exists
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ message: "User with this email already exists" });
      }
      
      // Create client in Client collection
      const packages = await storage.getAllPackages();
      const basicPackage = packages.find(p => p.name === 'Basic');
      
      const client = await storage.createClient({
        name,
        phone: phone || '',
        email: email.toLowerCase(),
        packageId: basicPackage?._id?.toString(),
      });
      
      // Hash password and create user
      const hashedPassword = await hashPassword(password);
      const user = await storage.createUser({
        email: email.toLowerCase(),
        password: hashedPassword,
        role: 'client',
        name,
        phone,
        clientId: client._id?.toString(),
      });
      
      // Send welcome email (async, don't wait for it)
      emailService.sendWelcomeEmail(email.toLowerCase(), name, user._id?.toString()).catch(err => {
        console.error('Failed to send welcome email:', err);
      });
      
      // Return user data without password
      const { password: _, ...userWithoutPassword } = user.toObject();
      res.json({
        message: "User created successfully",
        user: userWithoutPassword,
        clientId: client._id?.toString(),
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Generic login endpoint (backward compatibility)
  app.post("/api/auth/login", loginRateLimiter, async (req, res) => {
    try {
      const { email, password } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }
      
      // Find user by email
      let user = await storage.getUserByEmail(email);
      if (!user) {
        return res.status(401).json({ message: "Invalid email or password" });
      }
      
      // CRITICAL FIX: If this is admin account, force the role to be admin
      if (email.toLowerCase() === 'admin@fitpro.com' && user.role !== 'admin') {
        console.warn('⚠️  EMERGENCY: Admin account had wrong role. Forcing fix...');
        await storage.updateUser(user._id.toString(), { role: 'admin' });
        user = await storage.getUserByEmail(email);
        console.log('✅ Admin role forced to admin');
      }
      
      // CRITICAL FIX: If this is trainer account, force the role to be trainer
      if (email.toLowerCase() === 'trainer@fitpro.com' && user.role !== 'trainer') {
        console.warn('⚠️  EMERGENCY: Trainer account had wrong role. Forcing fix...');
        await storage.updateUser(user._id.toString(), { role: 'trainer' });
        user = await storage.getUserByEmail(email);
        console.log('✅ Trainer role forced to trainer');
      }
      
      // Verify password
      const isPasswordValid = await comparePassword(password, user.password);
      if (!isPasswordValid) {
        return res.status(401).json({ message: "Invalid email or password" });
      }
      
      // Get client data if user is a client
      let client = null;
      if (user.role === 'client' && user.clientId) {
        client = await storage.getClient(user.clientId.toString());
        
        // Check if client is active
        if (client && client.status === 'inactive') {
          return res.status(403).json({ 
            message: "Your account has been deactivated. Please contact the administrator for assistance." 
          });
        }
      }
      
      // Generate JWT tokens
      const tokenPayload = {
        userId: String(user._id),
        email: user.email,
        role: user.role || 'client',
        clientId: user.clientId?.toString(),
      };
      
      console.log('✅ Login successful - Token payload:', { email: tokenPayload.email, role: tokenPayload.role });
      
      const accessToken = generateAccessToken(tokenPayload);
      const refreshToken = generateRefreshToken(tokenPayload);
      
      // Set HTTP-only cookies for security
      res.cookie('accessToken', accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      });
      
      res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      });
      
      // Return user data without password
      const { password: _, ...userWithoutPassword } = user.toObject();
      res.json({
        message: "Login successful",
        user: userWithoutPassword,
        client: client,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Admin-specific login endpoint (sets adminToken cookie)
  app.post("/api/admin/login", loginRateLimiter, async (req, res) => {
    try {
      const { email, password } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }
      
      let user = await storage.getUserByEmail(email);
      if (!user) {
        return res.status(401).json({ message: "Invalid email or password" });
      }
      
      if (email.toLowerCase() === 'admin@fitpro.com' && user.role !== 'admin') {
        await storage.updateUser(user._id.toString(), { role: 'admin' });
        user = await storage.getUserByEmail(email);
      }
      
      const isPasswordValid = await comparePassword(password, user.password);
      if (!isPasswordValid) {
        return res.status(401).json({ message: "Invalid email or password" });
      }
      
      if (user.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }
      
      const tokenPayload = {
        userId: String(user._id),
        email: user.email,
        role: 'admin',
        clientId: user.clientId?.toString(),
      };
      
      console.log('✅ Admin login - Token payload:', { email: tokenPayload.email, role: tokenPayload.role });
      
      const accessToken = generateAccessToken(tokenPayload);
      const refreshToken = generateRefreshToken(tokenPayload);
      
      res.cookie('adminToken', accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });
      
      res.cookie('adminRefreshToken', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });
      
      const { password: _, ...userWithoutPassword } = user.toObject();
      res.json({
        message: "Admin login successful",
        token: accessToken,
        user: userWithoutPassword,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Trainer-specific login endpoint (sets trainerToken cookie)
  app.post("/api/trainer/login", loginRateLimiter, async (req, res) => {
    try {
      const { email, password } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }
      
      let user = await storage.getUserByEmail(email);
      if (!user) {
        return res.status(401).json({ message: "Invalid email or password" });
      }
      
      if (email.toLowerCase() === 'trainer@fitpro.com' && user.role !== 'trainer') {
        await storage.updateUser(user._id.toString(), { role: 'trainer' });
        user = await storage.getUserByEmail(email);
      }
      
      const isPasswordValid = await comparePassword(password, user.password);
      if (!isPasswordValid) {
        return res.status(401).json({ message: "Invalid email or password" });
      }
      
      if (user.role !== 'trainer') {
        return res.status(403).json({ message: "Trainer access required" });
      }
      
      const tokenPayload = {
        userId: String(user._id),
        email: user.email,
        role: 'trainer',
        clientId: user.clientId?.toString(),
      };
      
      console.log('✅ Trainer login - Token payload:', { email: tokenPayload.email, role: tokenPayload.role });
      
      const accessToken = generateAccessToken(tokenPayload);
      const refreshToken = generateRefreshToken(tokenPayload);
      
      res.cookie('trainerToken', accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });
      
      res.cookie('trainerRefreshToken', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });
      
      const { password: _, ...userWithoutPassword } = user.toObject();
      res.json({
        message: "Trainer login successful",
        token: accessToken,
        user: userWithoutPassword,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Logout route - clears all session cookies
  app.post("/api/auth/logout", (req, res) => {
    res.clearCookie('accessToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });
    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });
    res.clearCookie('adminToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });
    res.clearCookie('adminRefreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });
    res.clearCookie('trainerToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });
    res.clearCookie('trainerRefreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });
    res.json({ message: "Logged out successfully" });
  });
  
  // Also support /api/logout for backward compatibility
  app.post("/api/logout", (req, res) => {
    res.clearCookie('accessToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });
    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });
    res.clearCookie('adminToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });
    res.clearCookie('adminRefreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });
    res.clearCookie('trainerToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });
    res.clearCookie('trainerRefreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });
    res.json({ message: "Logged out successfully" });
  });
  
  // Request password reset
  app.post("/api/auth/forgot-password", passwordResetRateLimiter, async (req, res) => {
    try {
      const { email } = req.body;
      
      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }
      
      if (!validateEmail(email)) {
        return res.status(400).json({ message: "Invalid email format" });
      }
      
      const normalizedEmail = email.toLowerCase();
      const user = await storage.getUserByEmail(normalizedEmail);
      if (!user) {
        return res.json({ 
          message: "If an account exists with this email, a password reset link has been sent" 
        });
      }
      
      const resetToken = crypto.randomBytes(32).toString('hex');
      const expiry = new Date(Date.now() + 60 * 60 * 1000);
      resetTokens.set(resetToken, { email: user.email, expiry });
      
      setTimeout(() => resetTokens.delete(resetToken), 60 * 60 * 1000);
      
      await emailService.sendPasswordResetEmail(user.email, resetToken, user.name || 'User');
      
      res.json({ 
        message: "If an account exists with this email, a password reset link has been sent" 
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Reset password with token
  app.post("/api/auth/reset-password", passwordResetRateLimiter, async (req, res) => {
    try {
      const { token, newPassword } = req.body;
      
      if (!token || !newPassword) {
        return res.status(400).json({ message: "Token and new password are required" });
      }
      
      const passwordValidation = validatePassword(newPassword);
      if (!passwordValidation.valid) {
        return res.status(400).json({ message: passwordValidation.message });
      }
      
      const tokenData = resetTokens.get(token);
      if (!tokenData || tokenData.expiry < new Date()) {
        if (tokenData) resetTokens.delete(token);
        return res.status(400).json({ message: "Invalid or expired reset token" });
      }
      
      const user = await storage.getUserByEmail(tokenData.email);
      if (!user) {
        resetTokens.delete(token);
        return res.status(404).json({ message: "User not found" });
      }
      
      const hashedPassword = await hashPassword(newPassword);
      await storage.updateUser(String(user._id), { password: hashedPassword });
      
      resetTokens.delete(token);
      
      res.json({ message: "Password reset successfully" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Get current authenticated user
  app.get("/api/auth/me", authenticateToken, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      
      // Check if a specific role was requested via query parameter
      const requestedRole = req.query.role as string;
      if (requestedRole && req.user.role !== requestedRole) {
        // Role mismatch - user token is for a different role
        console.log(`❌ Role mismatch: Token role=${req.user.role}, Requested role=${requestedRole}`);
        return res.status(401).json({ 
          message: `Role mismatch. Expected ${requestedRole} but got ${req.user.role}` 
        });
      }
      
      const user = await storage.getUserById(req.user.userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Get client data if user is a client
      let client = null;
      if (user.role === 'client' && user.clientId) {
        client = await storage.getClient(user.clientId.toString());
      }
      
      // Return user data without password
      const { password: _, ...userWithoutPassword } = user.toObject();
      res.json({
        user: userWithoutPassword,
        client: client,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Admin route to create user account for existing client
  app.post("/api/admin/create-client-user", authenticateToken, requireAdmin, async (req, res) => {
    try {
      const { clientId, email, password } = req.body;
      
      // Validate input
      if (!clientId || !email || !password) {
        return res.status(400).json({ message: "Client ID, email, and password are required" });
      }
      
      if (!validateEmail(email)) {
        return res.status(400).json({ message: "Invalid email format" });
      }
      
      const passwordValidation = validatePassword(password);
      if (!passwordValidation.valid) {
        return res.status(400).json({ message: passwordValidation.message });
      }
      
      // Check if client exists
      const client = await storage.getClient(clientId);
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }
      
      // Check if user already exists for this email
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ message: "User with this email already exists" });
      }
      
      // Hash password and create user account
      const hashedPassword = await hashPassword(password);
      const user = await storage.createUser({
        email: email.toLowerCase(),
        password: hashedPassword,
        role: 'client',
        name: client.name,
        phone: client.phone || '',
        clientId: clientId,
      });
      
      // Update client with email if not set
      if (!client.email || client.email !== email.toLowerCase()) {
        await storage.updateClient(clientId, { email: email.toLowerCase() });
      }
      
      // Return user data without password
      const { password: _, ...userWithoutPassword } = user.toObject();
      res.json({
        message: "User account created successfully for client",
        user: userWithoutPassword,
        client: client,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Admin route to create trainer credentials (protected)
  app.post("/api/admin/trainers", authenticateToken, requireAdmin, upload.fields([
    { name: 'profilePhoto', maxCount: 1 },
    { name: 'documentOne', maxCount: 1 },
    { name: 'documentTwo', maxCount: 1 }
  ]), async (req, res) => {
    try {
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      const { email, password, name, phone } = req.body;
      
      // Validate input
      if (!email || !password || !name) {
        return res.status(400).json({ message: "Email, password, and name are required" });
      }
      
      if (!validateEmail(email)) {
        return res.status(400).json({ message: "Invalid email format" });
      }
      
      const passwordValidation = validatePassword(password);
      if (!passwordValidation.valid) {
        return res.status(400).json({ message: passwordValidation.message });
      }
      
      // Check if user already exists
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ message: "User with this email already exists" });
      }
      
      // Prepare user data
      const userData: any = {
        email: email.toLowerCase(),
        password: await hashPassword(password),
        role: 'trainer',
        name,
        phone: phone || '',
      };
      
      // Handle file uploads
      if (files?.profilePhoto) {
        const file = files.profilePhoto[0];
        const filename = `trainer-profile-${Date.now()}${path.extname(file.originalname)}`;
        const uploadPath = path.join(process.cwd(), 'uploads', 'trainers', filename);
        fs.mkdirSync(path.dirname(uploadPath), { recursive: true });
        fs.renameSync(file.path, uploadPath);
        userData.profilePhoto = `/uploads/trainers/${filename}`;
      }
      
      if (files?.documentOne) {
        const file = files.documentOne[0];
        const filename = `trainer-doc1-${Date.now()}${path.extname(file.originalname)}`;
        const uploadPath = path.join(process.cwd(), 'uploads', 'documents', filename);
        fs.mkdirSync(path.dirname(uploadPath), { recursive: true });
        fs.renameSync(file.path, uploadPath);
        userData.documentOne = `/uploads/documents/${filename}`;
      }
      
      if (files?.documentTwo) {
        const file = files.documentTwo[0];
        const filename = `trainer-doc2-${Date.now()}${path.extname(file.originalname)}`;
        const uploadPath = path.join(process.cwd(), 'uploads', 'documents', filename);
        fs.mkdirSync(path.dirname(uploadPath), { recursive: true });
        fs.renameSync(file.path, uploadPath);
        userData.documentTwo = `/uploads/documents/${filename}`;
      }
      
      // Create trainer user
      const trainer = await storage.createUser(userData);
      
      // Return trainer data without password
      const { password: _, ...trainerWithoutPassword } = trainer.toObject();
      res.json({
        message: "Trainer created successfully",
        trainer: trainerWithoutPassword,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Get all trainers (admin and trainers can view)
  app.get("/api/admin/trainers", authenticateToken, requireRole('admin', 'trainer'), async (req, res) => {
    try {
      const trainers = await storage.getAllTrainers();
      // Remove passwords from response
      let trainersWithoutPasswords = trainers.map(trainer => {
        const { password: _, ...trainerWithoutPassword } = trainer.toObject();
        return trainerWithoutPassword;
      });
      
      // If user is a trainer, only return their own data
      if (req.user?.role === 'trainer') {
        trainersWithoutPasswords = trainersWithoutPasswords.filter(t => 
          t._id?.toString() === req.user?.userId?.toString()
        );
      }
      
      res.json(trainersWithoutPasswords);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Delete trainer (admin only - protected)
  app.delete("/api/admin/trainers/:id", authenticateToken, requireAdmin, async (req, res) => {
    try {
      const deleted = await storage.deleteUser(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Trainer not found" });
      }
      res.json({ message: "Trainer deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get single trainer details (admin only)
  app.get("/api/admin/trainers/:id", authenticateToken, requireAdmin, async (req, res) => {
    try {
      const trainer = await storage.getTrainer(req.params.id);
      if (!trainer) {
        return res.status(404).json({ message: "Trainer not found" });
      }
      const { password: _, ...trainerWithoutPassword } = trainer.toObject();
      res.json(trainerWithoutPassword);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update trainer info (admin only)
  app.patch("/api/admin/trainers/:id", authenticateToken, requireAdmin, upload.fields([
    { name: 'profilePhoto', maxCount: 1 },
    { name: 'documentOne', maxCount: 1 },
    { name: 'documentTwo', maxCount: 1 }
  ]), async (req, res) => {
    try {
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      const { name, email, phone } = req.body;
      const updateData: any = {};
      
      if (name) updateData.name = name;
      if (email) {
        if (!validateEmail(email)) {
          return res.status(400).json({ message: "Invalid email format" });
        }
        updateData.email = email.toLowerCase();
      }
      if (phone !== undefined) updateData.phone = phone;
      
      // Handle file uploads
      if (files?.profilePhoto) {
        const file = files.profilePhoto[0];
        const filename = `trainer-profile-${Date.now()}${path.extname(file.originalname)}`;
        const uploadPath = path.join(process.cwd(), 'uploads', 'trainers', filename);
        fs.mkdirSync(path.dirname(uploadPath), { recursive: true });
        fs.renameSync(file.path, uploadPath);
        updateData.profilePhoto = `/uploads/trainers/${filename}`;
      }
      
      if (files?.documentOne) {
        const file = files.documentOne[0];
        const filename = `trainer-doc1-${Date.now()}${path.extname(file.originalname)}`;
        const uploadPath = path.join(process.cwd(), 'uploads', 'documents', filename);
        fs.mkdirSync(path.dirname(uploadPath), { recursive: true });
        fs.renameSync(file.path, uploadPath);
        updateData.documentOne = `/uploads/documents/${filename}`;
      }
      
      if (files?.documentTwo) {
        const file = files.documentTwo[0];
        const filename = `trainer-doc2-${Date.now()}${path.extname(file.originalname)}`;
        const uploadPath = path.join(process.cwd(), 'uploads', 'documents', filename);
        fs.mkdirSync(path.dirname(uploadPath), { recursive: true });
        fs.renameSync(file.path, uploadPath);
        updateData.documentTwo = `/uploads/documents/${filename}`;
      }
      
      const updatedTrainer = await storage.updateUser(req.params.id, updateData);
      if (!updatedTrainer) {
        return res.status(404).json({ message: "Trainer not found" });
      }
      
      const { password: _, ...trainerWithoutPassword } = updatedTrainer.toObject();
      res.json({
        message: "Trainer updated successfully",
        trainer: trainerWithoutPassword,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Toggle trainer status (admin only)
  app.patch("/api/admin/trainers/:id/status", authenticateToken, requireAdmin, async (req, res) => {
    try {
      const { status } = req.body;
      
      if (!status || !['active', 'inactive'].includes(status)) {
        return res.status(400).json({ message: "Invalid status. Must be 'active' or 'inactive'" });
      }
      
      const updatedTrainer = await storage.updateUser(req.params.id, { status });
      if (!updatedTrainer) {
        return res.status(404).json({ message: "Trainer not found" });
      }
      
      const { password: _, ...trainerWithoutPassword } = updatedTrainer.toObject();
      res.json({
        message: `Trainer status updated to ${status}`,
        trainer: trainerWithoutPassword,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Assign clients to trainer (admin only)
  app.patch("/api/admin/trainers/:id/assign-clients", authenticateToken, requireAdmin, async (req, res) => {
    try {
      const { clientIds } = req.body;
      
      if (!Array.isArray(clientIds)) {
        return res.status(400).json({ message: "clientIds must be an array" });
      }
      
      // Update each client with the trainer reference
      for (const clientId of clientIds) {
        await storage.updateClient(clientId, { trainerId: req.params.id });
      }
      
      res.json({
        message: "Clients assigned successfully",
        assignedCount: clientIds.length,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Reset packages (delete all and recreate with new ones)
  app.post("/api/admin/reset-packages", authenticateToken, requireAdmin, async (_req, res) => {
    try {
      // Delete all existing packages
      const existingPackages = await storage.getAllPackages();
      for (const pkg of existingPackages) {
        await storage.updatePackage(pkg._id?.toString(), { deleted: true });
      }
      
      const newPackages = [
        {
          name: "Fit Basics",
          description: "Diet + Workout + Recorded Sessions Access",
          price: 2500,
          features: ["Diet plans", "Workout plans", "Recorded sessions access"],
          dietPlanAccess: true,
          workoutPlanAccess: true,
          recordedSessionsAccess: true,
          videoAccess: true,
          liveSessionsPerMonth: 0,
          personalizedDietAccess: false,
          weeklyCheckInAccess: false,
          liveGroupTrainingAccess: false,
          oneOnOneCallAccess: false,
          habitCoachingAccess: false,
          performanceTrackingAccess: false,
          prioritySupportAccess: false,
        },
        {
          name: "Fit Plus (Main Group Program)",
          description: "Live Group Training + Personalized Diet + Weekly Check-in",
          price: 5000,
          features: ["Live group training", "Personalized diet", "Weekly check-ins", "Workout plans"],
          dietPlanAccess: true,
          workoutPlanAccess: true,
          recordedSessionsAccess: true,
          videoAccess: true,
          liveSessionsPerMonth: 4,
          personalizedDietAccess: true,
          weeklyCheckInAccess: true,
          liveGroupTrainingAccess: true,
          oneOnOneCallAccess: false,
          habitCoachingAccess: false,
          performanceTrackingAccess: false,
          prioritySupportAccess: false,
        },
        {
          name: "Pro Transformation",
          description: "Fit Plus + Weekly 1:1 Call + Habit Coaching",
          price: 7500,
          features: ["Live group training", "Personalized diet", "Weekly check-ins", "Weekly 1:1 calls", "Habit coaching", "Workout plans"],
          dietPlanAccess: true,
          workoutPlanAccess: true,
          recordedSessionsAccess: true,
          videoAccess: true,
          liveSessionsPerMonth: 4,
          personalizedDietAccess: true,
          weeklyCheckInAccess: true,
          liveGroupTrainingAccess: true,
          oneOnOneCallAccess: true,
          habitCoachingAccess: true,
          performanceTrackingAccess: false,
          prioritySupportAccess: false,
        },
        {
          name: "Elite Athlete / Fast Result",
          description: "Pro Transformation + Performance Tracking + Priority Support",
          price: 10000,
          features: ["Live group training", "Personalized diet", "Weekly check-ins", "Weekly 1:1 calls", "Habit coaching", "Performance tracking", "Priority support", "Workout plans"],
          dietPlanAccess: true,
          workoutPlanAccess: true,
          recordedSessionsAccess: true,
          videoAccess: true,
          liveSessionsPerMonth: 8,
          personalizedDietAccess: true,
          weeklyCheckInAccess: true,
          liveGroupTrainingAccess: true,
          oneOnOneCallAccess: true,
          habitCoachingAccess: true,
          performanceTrackingAccess: true,
          prioritySupportAccess: true,
        },
      ];
      
      let createdCount = 0;
      for (const pkg of newPackages) {
        await storage.createPackage(pkg);
        createdCount++;
      }
      
      res.json({ 
        message: "Packages reset successfully", 
        deletedCount: existingPackages.length,
        createdCount 
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Initialize default packages - ALWAYS update to new packages
  app.post("/api/init", async (_req, res) => {
    try {
      const existingPackages = await storage.getAllPackages();
      
      // Always create new packages (delete old ones first)
      for (const pkg of existingPackages) {
        // Mark as deleted instead of hard delete to preserve relationships
        try {
          await storage.updatePackage(pkg._id?.toString(), { name: `${pkg.name}_ARCHIVED` });
        } catch (e) {
          // Continue if update fails
        }
      }

      const defaultPackages = [
        {
          name: "Fit Basics",
          description: "Diet + Workout + Recorded Sessions Access",
          price: 2500,
          features: ["Diet plans", "Workout plans", "Recorded sessions access"],
          dietPlanAccess: true,
          workoutPlanAccess: true,
          recordedSessionsAccess: true,
          videoAccess: true,
          liveSessionsPerMonth: 0,
          personalizedDietAccess: false,
          weeklyCheckInAccess: false,
          liveGroupTrainingAccess: false,
          oneOnOneCallAccess: false,
          habitCoachingAccess: false,
          performanceTrackingAccess: false,
          prioritySupportAccess: false,
        },
        {
          name: "Fit Plus (Main Group Program)",
          description: "Live Group Training + Personalized Diet + Weekly Check-in",
          price: 5000,
          features: ["Live group training", "Personalized diet", "Weekly check-ins", "Workout plans"],
          dietPlanAccess: true,
          workoutPlanAccess: true,
          recordedSessionsAccess: true,
          videoAccess: true,
          liveSessionsPerMonth: 4,
          personalizedDietAccess: true,
          weeklyCheckInAccess: true,
          liveGroupTrainingAccess: true,
          oneOnOneCallAccess: false,
          habitCoachingAccess: false,
          performanceTrackingAccess: false,
          prioritySupportAccess: false,
        },
        {
          name: "Pro Transformation",
          description: "Fit Plus + Weekly 1:1 Call + Habit Coaching",
          price: 7500,
          features: ["Live group training", "Personalized diet", "Weekly check-ins", "Weekly 1:1 calls", "Habit coaching", "Workout plans"],
          dietPlanAccess: true,
          workoutPlanAccess: true,
          recordedSessionsAccess: true,
          videoAccess: true,
          liveSessionsPerMonth: 4,
          personalizedDietAccess: true,
          weeklyCheckInAccess: true,
          liveGroupTrainingAccess: true,
          oneOnOneCallAccess: true,
          habitCoachingAccess: true,
          performanceTrackingAccess: false,
          prioritySupportAccess: false,
        },
        {
          name: "Elite Athlete / Fast Result",
          description: "Pro Transformation + Performance Tracking + Priority Support",
          price: 10000,
          features: ["Live group training", "Personalized diet", "Weekly check-ins", "Weekly 1:1 calls", "Habit coaching", "Performance tracking", "Priority support", "Workout plans"],
          dietPlanAccess: true,
          workoutPlanAccess: true,
          recordedSessionsAccess: true,
          videoAccess: true,
          liveSessionsPerMonth: 8,
          personalizedDietAccess: true,
          weeklyCheckInAccess: true,
          liveGroupTrainingAccess: true,
          oneOnOneCallAccess: true,
          habitCoachingAccess: true,
          performanceTrackingAccess: true,
          prioritySupportAccess: true,
        },
      ];
      
      let createdCount = 0;
      for (const pkg of defaultPackages) {
        await storage.createPackage(pkg);
        createdCount++;
      }
      
      // Initialize default users (admin and client)
      await storage.initializeDefaultUsers();
      
      res.json({ 
        message: "Packages initialized successfully", 
        archived: existingPackages.length,
        created: createdCount 
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Package routes
  app.get("/api/packages", async (_req, res) => {
    try {
      const packages = await storage.getAllPackages();
      res.json(packages);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Create package (admin only - protected)
  app.post("/api/packages", authenticateToken, requireAdmin, async (req, res) => {
    try {
      const pkg = await storage.createPackage(req.body);
      res.json(pkg);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update package (admin only - protected)
  app.patch("/api/packages/:id", authenticateToken, requireAdmin, async (req, res) => {
    try {
      const pkg = await storage.updatePackage(req.params.id, req.body);
      if (!pkg) {
        return res.status(404).json({ message: "Package not found" });
      }
      res.json(pkg);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Client routes (admin and trainers can view)
  app.get("/api/clients", authenticateToken, requireRole('admin', 'trainer'), async (req, res) => {
    try {
      let clients = await storage.getAllClients();
      
      // If user is a trainer, filter to show only their clients
      if (req.user?.role === 'trainer') {
        clients = clients.filter((client: any) => 
          client.trainerId?.toString() === req.user?.userId?.toString()
        );
      }
      
      res.json(clients);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get client by phone (admin only - protected)
  app.get("/api/clients/phone/:phone", authenticateToken, requireAdmin, async (req, res) => {
    try {
      const client = await storage.getClientByPhone(req.params.phone);
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }
      res.json(client);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get client by ID (owner or admin - protected)
  app.get("/api/clients/:id", authenticateToken, requireOwnershipOrAdmin, async (req, res) => {
    try {
      const client = await storage.getClient(req.params.id);
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }
      res.json(client);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Create client (admin only - protected)
  app.post("/api/clients", authenticateToken, requireAdmin, upload.fields([
    { name: 'profilePhoto', maxCount: 1 },
    { name: 'aadharDocument', maxCount: 1 },
    { name: 'otherDocument', maxCount: 1 }
  ]), async (req, res) => {
    try {
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      const clientData: any = { ...req.body };
      
      // Extract password, packageId, and packageDuration before file handling
      const { password, packageId, packageDuration } = req.body;
      
      // Validate required fields
      if (!clientData.email) {
        return res.status(400).json({ message: "Email is required" });
      }
      
      if (!password) {
        return res.status(400).json({ message: "Password is required" });
      }
      
      if (!packageId) {
        return res.status(400).json({ message: "Package is required" });
      }
      
      if (!packageDuration || ![4, 8, 12].includes(parseInt(packageDuration))) {
        return res.status(400).json({ message: "Valid package duration is required (4, 8, or 12 weeks)" });
      }
      
      // Verify package exists
      const pkg = await storage.getPackage(packageId);
      if (!pkg) {
        return res.status(404).json({ message: "Package not found" });
      }
      
      // Check if user with this email already exists
      const existingUser = await storage.getUserByEmail(clientData.email.toLowerCase());
      if (existingUser) {
        return res.status(400).json({ message: "A user with this email already exists" });
      }
      
      // Handle file uploads
      if (files?.profilePhoto) {
        const file = files.profilePhoto[0];
        const filename = `profile-${Date.now()}${path.extname(file.originalname)}`;
        const uploadPath = path.join(process.cwd(), 'uploads', 'clients', filename);
        fs.mkdirSync(path.dirname(uploadPath), { recursive: true });
        fs.renameSync(file.path, uploadPath);
        clientData.profilePhoto = `/uploads/clients/${filename}`;
      }
      
      if (files?.aadharDocument) {
        const file = files.aadharDocument[0];
        const filename = `aadhar-${Date.now()}${path.extname(file.originalname)}`;
        const uploadPath = path.join(process.cwd(), 'uploads', 'documents', filename);
        fs.mkdirSync(path.dirname(uploadPath), { recursive: true });
        fs.renameSync(file.path, uploadPath);
        clientData.aadharDocument = `/uploads/documents/${filename}`;
      }
      
      if (files?.otherDocument) {
        const file = files.otherDocument[0];
        const filename = `doc-${Date.now()}${path.extname(file.originalname)}`;
        const uploadPath = path.join(process.cwd(), 'uploads', 'documents', filename);
        fs.mkdirSync(path.dirname(uploadPath), { recursive: true });
        fs.renameSync(file.path, uploadPath);
        clientData.otherDocument = `/uploads/documents/${filename}`;
      }
      
      // Calculate subscription end date based on package duration
      const startDate = new Date();
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + (parseInt(packageDuration) * 7)); // Convert weeks to days
      
      // Create the client with package and subscription details
      clientData.packageId = packageId;
      clientData.packageDuration = parseInt(packageDuration);
      clientData.subscription = {
        startDate,
        endDate,
        renewalType: 'manual',
        autoRenewal: false,
      };
      
      const client = await storage.createClient(clientData);
      
      // Create user account for the client with hashed password
      const hashedPassword = await hashPassword(password);
      const user = await storage.createUser({
        email: clientData.email.toLowerCase(),
        password: hashedPassword,
        role: 'client',
        name: clientData.name,
        phone: clientData.phone,
        clientId: String(client._id),
        status: 'active',
      });
      
      console.log(`✅ Created client "${clientData.name}" with package "${pkg.name}" (${packageDuration} weeks)`);
      
      res.json({
        message: 'Client created successfully with package access',
        client,
        packageDetails: {
          name: pkg.name,
          duration: packageDuration,
          endDate,
        }
      });
    } catch (error: any) {
      console.error('Error creating client:', error);
      res.status(500).json({ message: error.message });
    }
  });

  // Update client (owner or admin - protected)
  app.patch("/api/clients/:id", authenticateToken, requireOwnershipOrAdmin, upload.fields([
    { name: 'profilePhoto', maxCount: 1 },
    { name: 'aadharDocument', maxCount: 1 },
    { name: 'otherDocument', maxCount: 1 }
  ]), async (req, res) => {
    try {
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      const clientData: any = { ...req.body };
      
      // Handle file uploads
      if (files?.profilePhoto) {
        const file = files.profilePhoto[0];
        const filename = `profile-${Date.now()}${path.extname(file.originalname)}`;
        const uploadPath = path.join(process.cwd(), 'uploads', 'clients', filename);
        fs.mkdirSync(path.dirname(uploadPath), { recursive: true });
        fs.renameSync(file.path, uploadPath);
        clientData.profilePhoto = `/uploads/clients/${filename}`;
      }
      
      if (files?.aadharDocument) {
        const file = files.aadharDocument[0];
        const filename = `aadhar-${Date.now()}${path.extname(file.originalname)}`;
        const uploadPath = path.join(process.cwd(), 'uploads', 'documents', filename);
        fs.mkdirSync(path.dirname(uploadPath), { recursive: true });
        fs.renameSync(file.path, uploadPath);
        clientData.aadharDocument = `/uploads/documents/${filename}`;
      }
      
      if (files?.otherDocument) {
        const file = files.otherDocument[0];
        const filename = `doc-${Date.now()}${path.extname(file.originalname)}`;
        const uploadPath = path.join(process.cwd(), 'uploads', 'documents', filename);
        fs.mkdirSync(path.dirname(uploadPath), { recursive: true });
        fs.renameSync(file.path, uploadPath);
        clientData.otherDocument = `/uploads/documents/${filename}`;
      }
      
      const client = await storage.updateClient(req.params.id, clientData);
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }
      res.json(client);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Toggle client active/inactive status (admin only)
  app.patch("/api/clients/:id/status", authenticateToken, requireAdmin, async (req, res) => {
    try {
      const { status } = req.body;
      
      if (!status || !['active', 'inactive', 'pending'].includes(status)) {
        return res.status(400).json({ message: "Valid status is required (active, inactive, or pending)" });
      }
      
      const client = await storage.updateClient(req.params.id, { status });
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }
      
      res.json({ message: `Client status updated to ${status}`, client });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update client subscription (admin only)
  app.patch("/api/admin/clients/:id/subscription", authenticateToken, requireAdmin, async (req, res) => {
    try {
      const { packageId, accessDurationWeeks } = req.body;
      
      if (!packageId) {
        return res.status(400).json({ message: "Package ID is required" });
      }
      
      if (!accessDurationWeeks || ![4, 8, 12].includes(parseInt(accessDurationWeeks))) {
        return res.status(400).json({ message: "Valid duration required (4, 8, or 12 weeks)" });
      }
      
      // Verify package exists
      const pkg = await storage.getPackage(packageId);
      if (!pkg) {
        return res.status(404).json({ message: "Package not found" });
      }
      
      // Calculate subscription dates
      const subscriptionStartDate = new Date();
      const subscriptionEndDate = new Date();
      subscriptionEndDate.setDate(subscriptionEndDate.getDate() + (parseInt(accessDurationWeeks) * 7));
      
      // Update client with new subscription
      const client = await storage.updateClient(req.params.id, {
        packageId,
        accessDurationWeeks: parseInt(accessDurationWeeks),
        subscriptionStartDate,
        subscriptionEndDate,
      });
      
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }
      
      console.log(`✅ Updated subscription for client "${client.name}" to ${pkg.name} for ${accessDurationWeeks} weeks. Expires: ${subscriptionEndDate.toLocaleDateString()}`);
      
      res.json({
        message: `Subscription updated to ${pkg.name} for ${accessDurationWeeks} weeks`,
        client,
        subscriptionDetails: {
          packageName: pkg.name,
          startDate: subscriptionStartDate,
          endDate: subscriptionEndDate,
          durationWeeks: accessDurationWeeks,
        }
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Delete client permanently (admin only for safety)
  app.delete("/api/clients/:id", authenticateToken, requireAdmin, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      // Only admins can permanently delete clients
      const success = await storage.permanentlyDeleteClient(req.params.id);
      if (!success) {
        return res.status(404).json({ message: "Client not found" });
      }
      return res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Admin Client Management routes (all protected)
  app.get("/api/admin/clients/search", authenticateToken, requireAdmin, async (req, res) => {
    try {
      const { query, status, packageId, sortBy } = req.query;
      const clients = await storage.getAllClients(true); // Include ALL clients (active and inactive)
      
      let filtered = clients;
      
      if (query) {
        const searchQuery = query.toString().toLowerCase();
        filtered = filtered.filter(client => 
          client.name.toLowerCase().includes(searchQuery) ||
          (client.phone && client.phone.includes(searchQuery)) ||
          (client.email && client.email.toLowerCase().includes(searchQuery))
        );
      }
      
      if (status) {
        filtered = filtered.filter(client => client.status === status);
      }
      
      if (packageId) {
        filtered = filtered.filter(client => client.packageId?.toString() === packageId);
      }
      
      if (sortBy === 'name') {
        filtered.sort((a, b) => a.name.localeCompare(b.name));
      } else if (sortBy === 'joinDate') {
        filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      } else if (sortBy === 'lastActivity') {
        filtered.sort((a, b) => {
          const dateA = a.lastActivityDate ? new Date(a.lastActivityDate).getTime() : 0;
          const dateB = b.lastActivityDate ? new Date(b.lastActivityDate).getTime() : 0;
          return dateB - dateA;
        });
      }
      
      res.json(filtered);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/clients/:id/activity", authenticateToken, requireAdmin, async (req, res) => {
    try {
      const clientId = req.params.id;
      
      const workoutSessions = await storage.getClientWorkoutSessions(clientId);
      const liveSessions = await storage.getClientSessions(clientId);
      const workoutPlans = await storage.getClientWorkoutPlans(clientId);
      const dietPlans = await storage.getClientDietPlans(clientId);
      
      const activity = {
        totalWorkouts: workoutSessions.length,
        totalLiveSessions: liveSessions.length,
        assignedWorkoutPlans: workoutPlans.length,
        assignedDietPlans: dietPlans.length,
        recentWorkouts: workoutSessions.slice(0, 10),
        recentSessions: liveSessions.slice(0, 5),
      };
      
      res.json(activity);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/clients/bulk-update", authenticateToken, requireAdmin, async (req, res) => {
    try {
      const { clientIds, updates } = req.body;
      
      if (!clientIds || !Array.isArray(clientIds) || clientIds.length === 0) {
        return res.status(400).json({ message: "Client IDs are required" });
      }
      
      const updatedClients = [];
      for (const clientId of clientIds) {
        const client = await storage.updateClient(clientId, updates);
        if (client) {
          updatedClients.push(client);
        }
      }
      
      res.json({ 
        success: true, 
        updated: updatedClients.length,
        clients: updatedClients 
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/clients/bulk-assign-plan", authenticateToken, requireAdmin, async (req, res) => {
    try {
      const { clientIds, planType, planId } = req.body;
      
      if (!clientIds || !Array.isArray(clientIds) || clientIds.length === 0) {
        return res.status(400).json({ message: "Client IDs are required" });
      }
      
      if (planType === 'workout') {
        const plan = await storage.getWorkoutPlan(planId);
        if (!plan) {
          return res.status(404).json({ message: "Workout plan not found" });
        }
        
        const assignments = [];
        for (const clientId of clientIds) {
          const newPlan = await storage.createWorkoutPlan({
            clientId,
            name: plan.name,
            description: plan.description,
            goal: plan.goal,
            durationWeeks: plan.durationWeeks,
            exercises: plan.exercises,
          });
          assignments.push(newPlan);
        }
        
        res.json({ success: true, assignments: assignments.length });
      } else if (planType === 'diet') {
        const plan = await storage.getDietPlan(planId);
        if (!plan) {
          return res.status(404).json({ message: "Diet plan not found" });
        }
        
        const assignments = [];
        for (const clientId of clientIds) {
          const newPlan = await storage.createDietPlan({
            clientId,
            name: plan.name,
            targetCalories: plan.targetCalories,
            protein: plan.protein,
            carbs: plan.carbs,
            fats: plan.fats,
            meals: plan.meals,
          });
          assignments.push(newPlan);
        }
        
        res.json({ success: true, assignments: assignments.length });
      } else {
        res.status(400).json({ message: "Invalid plan type" });
      }
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/clients/export", authenticateToken, requireAdmin, async (_req, res) => {
    try {
      const clients = await storage.getAllClients();
      const packages = await storage.getAllPackages();
      
      const packageMap = packages.reduce((map, pkg) => {
        map[String(pkg._id)] = pkg.name;
        return map;
      }, {} as Record<string, string>);
      
      const csvHeader = 'ID,Name,Phone,Email,Package,Status,Join Date,Last Activity\n';
      const csvRows = clients.map(client => {
        let packageId: string | null = null;
        if (client.packageId) {
          if (typeof client.packageId === 'object' && '_id' in client.packageId) {
            packageId = String((client.packageId as any)._id);
          } else {
            packageId = String(client.packageId);
          }
        }
        const packageName = packageId ? packageMap[packageId] || '' : '';
        
        return [
          client._id,
          client.name,
          client.phone,
          client.email || '',
          packageName,
          client.status || 'active',
          new Date(client.createdAt).toLocaleDateString(),
          client.lastActivityDate ? new Date(client.lastActivityDate).toLocaleDateString() : 'Never',
        ].map(field => `"${field}"`).join(',');
      }).join('\n');
      
      const csv = csvHeader + csvRows;
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=clients.csv');
      res.send(csv);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Payment History routes (owner or admin - protected)
  app.get("/api/payment-history/:clientId", authenticateToken, requireOwnershipOrAdmin, async (req, res) => {
    try {
      const payments = await storage.getClientPaymentHistory(req.params.clientId);
      res.json(payments);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Create payment record (admin only - protected)
  app.post("/api/payment-history", authenticateToken, requireAdmin, async (req, res) => {
    try {
      const payment = await storage.createPaymentRecord(req.body);
      res.json(payment);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get all payments with filtering (admin only - protected)
  app.get("/api/payments", authenticateToken, requireAdmin, async (req, res) => {
    try {
      const { status, startDate, endDate, packageId } = req.query;
      const query: any = {};
      
      if (status) query.status = status;
      if (packageId) query.packageId = packageId;
      if (startDate || endDate) {
        query.billingDate = {};
        if (startDate) query.billingDate.$gte = new Date(startDate as string);
        if (endDate) query.billingDate.$lte = new Date(endDate as string);
      }

      const payments = await PaymentHistory.find(query)
        .populate('clientId', 'name phone email')
        .populate('packageId', 'name price')
        .sort({ billingDate: -1 });
      
      res.json(payments);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Helper function to calculate prorated revenue for a month based on enrollment weeks
  const calculateMonthlyRevenue = (clients: any[], packages: any[], targetMonth: Date) => {
    // Create package lookup map (avoid N+1)
    const packageMap = new Map();
    packages.forEach(pkg => {
      packageMap.set(pkg._id.toString(), pkg);
    });

    const monthStart = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), 1);
    const monthEnd = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0, 23, 59, 59);
    
    return clients.reduce((sum, client) => {
      // Only count active clients with a package
      if (!client.packageId || client.status !== 'active') {
        return sum;
      }

      const packageId = typeof client.packageId === 'object' ? client.packageId._id.toString() : client.packageId.toString();
      const pkg = packageMap.get(packageId);
      if (!pkg) {
        return sum;
      }

      // Determine subscription dates
      let startDate: Date;
      let endDate: Date;
      
      if (client.subscription?.startDate) {
        startDate = new Date(client.subscription.startDate);
      } else if (client.createdAt) {
        // Fall back to createdAt if subscription.startDate not set
        startDate = new Date(client.createdAt);
      } else {
        // Skip if no start date available
        return sum;
      }

      if (client.subscription?.endDate) {
        endDate = new Date(client.subscription.endDate);
      } else {
        // Calculate endDate based on packageDuration if not set
        const duration = client.packageDuration || 4;
        endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + (duration * 7)); // Convert weeks to days
      }
      
      // Check if subscription overlaps with target month
      if (startDate > monthEnd || endDate < monthStart) {
        return sum;
      }

      // Calculate overlap period in weeks
      const overlapStart = startDate > monthStart ? startDate : monthStart;
      const overlapEnd = endDate < monthEnd ? endDate : monthEnd;
      
      // Calculate weeks in overlap (7 days = 1 week)
      const overlapDays = (overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60 * 60 * 24);
      const overlapWeeks = Math.max(0, overlapDays / 7);
      
      // Get package duration in weeks (default 4 if not set)
      const packageDuration = client.packageDuration || 4;
      
      // Prorate revenue based on overlap weeks vs total package duration
      // If overlap is equal to or greater than package duration, charge full price
      // Otherwise, prorate based on the fraction of weeks used in this month
      const proratedRevenue = overlapWeeks >= packageDuration 
        ? pkg.price 
        : (pkg.price * overlapWeeks) / packageDuration;
      
      return sum + proratedRevenue;
    }, 0);
  };

  // Get payment statistics (admin only - protected)
  app.get("/api/payments/stats", authenticateToken, requireAdmin, async (req, res) => {
    try {
      const now = new Date();
      const clients = await storage.getAllClients();
      const packages = await storage.getPackages();

      // Calculate current month revenue (prorated based on subscription overlap)
      const currentMonthRevenue = calculateMonthlyRevenue(clients, packages, now);

      // Calculate last month revenue
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthRevenue = calculateMonthlyRevenue(clients, packages, lastMonth);

      const growthRate = lastMonthRevenue > 0 
        ? ((currentMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100 
        : (currentMonthRevenue > 0 ? 100 : 0);

      // Get payment data for pending/overdue stats
      const payments = await PaymentHistory.find({});
      const pendingPayments = payments.filter(p => p.status === 'pending');
      const overduePayments = payments.filter(p => p.status === 'overdue');
      const completedPayments = payments.filter(p => p.status === 'completed');
      
      const paymentsDue = pendingPayments.reduce((sum, p) => sum + p.amount, 0);
      const paymentsOverdue = overduePayments.reduce((sum, p) => sum + p.amount, 0);

      res.json({
        totalRevenue: Math.round(currentMonthRevenue),
        paymentsDue,
        paymentsOverdue,
        pendingCount: pendingPayments.length,
        overdueCount: overduePayments.length,
        completedCount: completedPayments.length,
        growthRate: Math.round(growthRate * 10) / 10,
        lastMonthRevenue: Math.round(lastMonthRevenue)
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get monthly revenue trends (admin only - protected)
  app.get("/api/payments/monthly-trends", authenticateToken, requireAdmin, async (req, res) => {
    try {
      const { months = 6 } = req.query;
      const trends = [];
      
      const clients = await storage.getAllClients();
      const packages = await storage.getPackages();
      
      for (let i = parseInt(months as string) - 1; i >= 0; i--) {
        const date = new Date();
        date.setMonth(date.getMonth() - i);
        const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
        const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0);
        
        // Calculate prorated revenue for this month using helper function
        const revenue = calculateMonthlyRevenue(clients, packages, date);
        
        // Count clients who started subscription in this month
        const monthClients = clients.filter(client => {
          if (!client.subscription?.startDate) return false;
          const startDate = new Date(client.subscription.startDate);
          return startDate >= startOfMonth && startDate <= endOfMonth;
        });

        // Count clients with active subscriptions in this month
        const activeClients = clients.filter(client => {
          if (!client.subscription?.startDate || !client.subscription?.endDate) return false;
          const startDate = new Date(client.subscription.startDate);
          const endDate = new Date(client.subscription.endDate);
          return startDate <= endOfMonth && endDate >= startOfMonth;
        });
        
        trends.push({
          month: startOfMonth.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
          revenue: Math.round(revenue),
          clientCount: activeClients.length,
          newClients: monthClients.length
        });
      }
      
      res.json(trends);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Invoice routes (admin only - protected)
  app.get("/api/invoices", authenticateToken, requireAdmin, async (req, res) => {
    try {
      const { status, clientId } = req.query;
      const query: any = {};
      
      if (status) query.status = status;
      if (clientId) query.clientId = clientId;

      const invoices = await Invoice.find(query)
        .populate('clientId', 'name phone email')
        .populate('packageId', 'name price')
        .sort({ issueDate: -1 });
      
      res.json(invoices);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Create invoice (admin only - protected)
  app.post("/api/invoices", authenticateToken, requireAdmin, async (req, res) => {
    try {
      const invoiceCount = await Invoice.countDocuments();
      const invoiceNumber = `INV-${new Date().getFullYear()}-${String(invoiceCount + 1).padStart(5, '0')}`;
      
      const invoiceData = {
        ...req.body,
        invoiceNumber,
        status: 'draft',
        issueDate: req.body.issueDate || new Date(),
      };
      
      const invoice = new Invoice(invoiceData);
      await invoice.save();
      res.json(invoice);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update invoice (admin only - protected)
  app.patch("/api/invoices/:id", authenticateToken, requireAdmin, async (req, res) => {
    try {
      const invoice = await Invoice.findByIdAndUpdate(
        req.params.id,
        { ...req.body, updatedAt: new Date() },
        { new: true }
      );
      res.json(invoice);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Send invoice (admin only - protected)
  app.post("/api/invoices/:id/send", authenticateToken, requireAdmin, async (req, res) => {
    try {
      const invoice = await Invoice.findById(req.params.id)
        .populate('clientId', 'name email')
        .populate('packageId', 'name');
      
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }
      
      const client = invoice.clientId as any;
      if (!client || !client.email) {
        return res.status(400).json({ message: "Client email not found" });
      }
      
      const emailSent = await emailService.sendInvoiceEmail(
        client.email,
        client.name,
        invoice.invoiceNumber,
        invoice.total,
        invoice.dueDate,
        client._id?.toString()
      );
      
      const updatedInvoice = await Invoice.findByIdAndUpdate(
        req.params.id,
        { 
          status: emailSent ? 'sent' : 'failed',
          sentAt: emailSent ? new Date() : undefined,
          sentToEmail: client.email,
          updatedAt: new Date()
        },
        { new: true }
      );
      
      res.json({
        ...updatedInvoice?.toObject(),
        emailSent,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Refund routes (admin only - protected)
  app.get("/api/refunds", authenticateToken, requireAdmin, async (req, res) => {
    try {
      const { status, clientId } = req.query;
      const query: any = {};
      
      if (status) query.status = status;
      if (clientId) query.clientId = clientId;

      const refunds = await Refund.find(query)
        .populate('clientId', 'name phone email')
        .populate('paymentId')
        .sort({ requestedAt: -1 });
      
      res.json(refunds);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Create refund (admin only - protected)
  app.post("/api/refunds", authenticateToken, requireAdmin, async (req, res) => {
    try {
      const refund = new Refund(req.body);
      await refund.save();
      
      if (req.body.processImmediately) {
        await PaymentHistory.findByIdAndUpdate(
          req.body.paymentId,
          { 
            status: 'refunded',
            refundId: refund._id,
            updatedAt: new Date()
          }
        );
      }
      
      res.json(refund);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update refund (admin only - protected)
  app.patch("/api/refunds/:id", authenticateToken, requireAdmin, async (req, res) => {
    try {
      const refund = await Refund.findByIdAndUpdate(
        req.params.id,
        { ...req.body, updatedAt: new Date() },
        { new: true }
      );
      
      if (req.body.status === 'processed' && refund) {
        await PaymentHistory.findByIdAndUpdate(
          refund.paymentId,
          { 
            status: 'refunded',
            refundId: refund._id,
            updatedAt: new Date()
          }
        );
      }
      
      res.json(refund);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Payment reminder routes (admin only - protected)
  app.post("/api/payment-reminders", authenticateToken, requireAdmin, async (req, res) => {
    try {
      const reminder = new PaymentReminder(req.body);
      await reminder.save();
      res.json(reminder);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get pending payment reminders (admin only - protected)
  app.get("/api/payment-reminders/pending", authenticateToken, requireAdmin, async (req, res) => {
    try {
      const reminders = await PaymentReminder.find({
        status: 'pending',
        scheduledFor: { $lte: new Date() }
      })
        .populate('clientId', 'name phone email')
        .populate('invoiceId');
      
      res.json(reminders);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Body Metrics routes (owner or admin only - sensitive health data)
  app.get("/api/body-metrics/:clientId", authenticateToken, requireOwnershipOrAdmin, async (req, res) => {
    try {
      const metrics = await storage.getClientBodyMetrics(req.params.clientId);
      res.json(metrics);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get latest body metrics (owner or admin only)
  app.get("/api/body-metrics/:clientId/latest", authenticateToken, requireOwnershipOrAdmin, async (req, res) => {
    try {
      const metrics = await storage.getLatestBodyMetrics(req.params.clientId);
      res.json(metrics);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Create body metrics (owner or admin only - validates ownership via clientId in body)
  app.post("/api/body-metrics", authenticateToken, async (req, res) => {
    // Check ownership before creating
    if (req.user?.role !== 'admin' && req.user?.clientId?.toString() !== req.body.clientId) {
      return res.status(403).json({ message: 'Access denied. You can only create your own data.' });
    }
    try {
      const metrics = await storage.createBodyMetrics(req.body);
      res.json(metrics);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Calculate body metrics (BMI, BMR, TDEE, etc.)
  app.post("/api/calculate-metrics", async (req, res) => {
    try {
      const { weight, height, age, gender, activityLevel, goal } = req.body;
      
      const heightInM = height / 100;
      const bmi = weight / (heightInM * heightInM);
      
      let bmr;
      if (gender === 'male') {
        bmr = 10 * weight + 6.25 * height - 5 * age + 5;
      } else {
        bmr = 10 * weight + 6.25 * height - 5 * age - 161;
      }
      
      const activityMultipliers: Record<string, number> = {
        sedentary: 1.2,
        light: 1.375,
        moderate: 1.55,
        active: 1.725,
        veryActive: 1.9
      };
      
      const tdee = bmr * (activityMultipliers[activityLevel] || 1.2);
      
      let idealWeight;
      if (gender === 'male') {
        idealWeight = 50 + 0.91 * (height - 152.4);
      } else {
        idealWeight = 45.5 + 0.91 * (height - 152.4);
      }
      
      let targetCalories = tdee;
      if (goal === 'lose') {
        targetCalories = tdee - 500;
      } else if (goal === 'gain') {
        targetCalories = tdee + 300;
      }
      
      res.json({
        bmi: parseFloat(bmi.toFixed(2)),
        bmr: parseFloat(bmr.toFixed(2)),
        tdee: parseFloat(tdee.toFixed(2)),
        idealWeight: parseFloat(idealWeight.toFixed(2)),
        targetCalories: parseFloat(targetCalories.toFixed(2))
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Helper function to ensure boolean flags are set for legacy documents
  const ensureVideoFlags = (video: any) => {
    return {
      ...video.toObject ? video.toObject() : video,
      hasVideoData: video.hasVideoData !== undefined ? video.hasVideoData : !!video.videoData,
      hasThumbnailData: video.hasThumbnailData !== undefined ? video.hasThumbnailData : !!video.thumbnailData,
    };
  };

  // Video routes
  app.get("/api/videos", async (_req, res) => {
    try {
      const videos = await storage.getAllVideos();
      const videosWithFlags = videos.map(ensureVideoFlags);
      res.json(videosWithFlags);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/videos/:id", async (req, res) => {
    try {
      const video = await storage.getVideo(req.params.id);
      if (!video) {
        return res.status(404).json({ message: "Video not found" });
      }
      res.json(ensureVideoFlags(video));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Upload video file with optional thumbnail
  app.post("/api/videos/upload", uploadRateLimiter, upload.fields([{ name: 'video', maxCount: 1 }, { name: 'thumbnailFile', maxCount: 1 }]), async (req, res) => {
    try {
      const files = req.files as any;
      if (!files?.video || !files.video[0]) {
        return res.status(400).json({ message: "No video file uploaded" });
      }

      const videoFile = files.video[0];
      const thumbnailFile = files.thumbnailFile?.[0];
      
      // Read video file into memory as Buffer
      const videoBuffer = fs.readFileSync(videoFile.path);
      
      // Read thumbnail file into memory if provided
      let thumbnailBuffer;
      let thumbnailContentType;
      if (thumbnailFile) {
        thumbnailBuffer = fs.readFileSync(thumbnailFile.path);
        thumbnailContentType = thumbnailFile.mimetype;
      }

      // Parse additional fields from form data
      const videoData = {
        title: req.body.title,
        description: req.body.description,
        videoData: videoBuffer,
        thumbnailData: thumbnailBuffer,
        hasVideoData: true,
        hasThumbnailData: !!thumbnailBuffer,
        contentType: videoFile.mimetype,
        thumbnailContentType: thumbnailContentType,
        fileSize: videoFile.size,
        originalFileName: videoFile.originalname,
        category: req.body.category,
        duration: req.body.duration ? parseInt(req.body.duration) : undefined,
        intensity: req.body.intensity,
        difficulty: req.body.difficulty,
        trainer: req.body.trainer,
        equipment: req.body.equipment ? JSON.parse(req.body.equipment) : [],
        isDraft: req.body.isDraft === 'true',
      };

      const video = await storage.createVideo(videoData);
      
      // Clean up temp files
      fs.unlinkSync(videoFile.path);
      if (thumbnailFile) {
        fs.unlinkSync(thumbnailFile.path);
      }
      
      // Return video data without the binary buffers
      const { videoData: _, thumbnailData: __, ...videoResponse } = video.toObject();
      res.json(videoResponse);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/videos", async (req, res) => {
    try {
      const video = await storage.createVideo(req.body);
      res.json(video);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/videos/:id", async (req, res) => {
    try {
      const video = await storage.updateVideo(req.params.id, req.body);
      if (!video) {
        return res.status(404).json({ message: "Video not found" });
      }
      res.json(video);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/videos/:id", async (req, res) => {
    try {
      const success = await storage.deleteVideo(req.params.id);
      if (!success) {
        return res.status(404).json({ message: "Video not found" });
      }
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Stream video from MongoDB
  app.get("/api/videos/:id/stream", async (req, res) => {
    try {
      const video = await storage.getVideo(req.params.id);
      if (!video || !video.videoData) {
        return res.status(404).json({ message: "Video not found" });
      }

      const range = req.headers.range;
      const videoSize = video.videoData.length;

      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : videoSize - 1;
        const chunkSize = (end - start) + 1;
        const videoChunk = video.videoData.slice(start, end + 1);

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${videoSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': video.contentType || 'video/mp4',
        });
        res.end(videoChunk);
      } else {
        res.writeHead(200, {
          'Content-Length': videoSize,
          'Content-Type': video.contentType || 'video/mp4',
        });
        res.end(video.videoData);
      }
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get thumbnail from MongoDB
  app.get("/api/videos/:id/thumbnail", async (req, res) => {
    try {
      const video = await storage.getVideo(req.params.id);
      if (!video || !video.thumbnailData) {
        return res.status(404).json({ message: "Thumbnail not found" });
      }

      res.writeHead(200, {
        'Content-Type': video.thumbnailContentType || 'image/jpeg',
        'Content-Length': video.thumbnailData.length,
      });
      res.end(video.thumbnailData);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Client Video routes (owner or admin only)
  app.get("/api/clients/:clientId/videos", authenticateToken, requireOwnershipOrAdmin, async (req, res) => {
    try {
      const videos = await storage.getClientVideos(req.params.clientId);
      res.json(videos.map(ensureVideoFlags));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Assign video to client (admin only - protected)
  app.post("/api/clients/:clientId/videos/:videoId", authenticateToken, requireAdmin, async (req, res) => {
    try {
      const assignment = await storage.assignVideoToClient(req.params.clientId, req.params.videoId);
      res.json(assignment);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Remove video from client (admin only - protected)
  app.delete("/api/clients/:clientId/videos/:videoId", authenticateToken, requireAdmin, async (req, res) => {
    try {
      const success = await storage.removeVideoFromClient(req.params.clientId, req.params.videoId);
      if (!success) {
        return res.status(404).json({ message: "Video assignment not found" });
      }
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Video Search and Filtering
  app.post("/api/videos/search", async (req, res) => {
    try {
      const { category, duration, intensity, difficulty, trainer, search, isDraft } = req.body;
      const videos = await storage.searchVideos({
        category,
        duration,
        intensity,
        difficulty,
        trainer,
        search,
        isDraft,
      });
      res.json(videos.map(ensureVideoFlags));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Video Analytics routes
  app.post("/api/videos/:id/increment-views", async (req, res) => {
    try {
      await storage.incrementVideoViews(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/videos/:id/increment-completions", async (req, res) => {
    try {
      await storage.incrementVideoCompletions(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Video Assignment routes
  app.get("/api/videos/:id/clients", authenticateToken, requireRole('admin', 'trainer'), async (req, res) => {
    try {
      const clients = await storage.getVideoAssignedClients(req.params.id);
      res.json(clients);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/videos/:id/assign", authenticateToken, requireRole('admin', 'trainer'), async (req, res) => {
    try {
      const { clientIds } = req.body;
      if (!Array.isArray(clientIds) || clientIds.length === 0) {
        return res.status(400).json({ message: "clientIds must be a non-empty array" });
      }
      
      const result = await storage.assignVideoToClients(req.params.id, clientIds);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Video Progress routes (Continue Watching) - Per current authenticated user with optional auth
  app.get("/api/video-progress/:videoId", optionalAuth, async (req, res) => {
    try {
      console.log('GET /api/video-progress/:videoId');
      console.log('User object:', (req as any).user);
      const userId = (req as any).user?.userId;
      console.log('Extracted userId:', userId);
      if (!userId) {
        console.log('No userId - returning empty progress');
        return res.json({ watchedDuration: 0, totalDuration: 0 });
      }
      const progress = await VideoProgress.findOne({ 
        userId: new mongoose.Types.ObjectId(userId),
        videoId: new mongoose.Types.ObjectId(req.params.videoId)
      });
      console.log('Found progress:', progress);
      res.json(progress || { watchedDuration: 0, totalDuration: 0 });
    } catch (error: any) {
      console.error('Error in GET /api/video-progress:', error);
      res.status(500).json({ message: error.message });
    }
  });

  // Update video progress for current user with optional auth
  app.post("/api/video-progress/:videoId", optionalAuth, async (req, res) => {
    try {
      console.log('POST /api/video-progress/:videoId');
      console.log('User object:', (req as any).user);
      console.log('Request body:', req.body);
      const userId = (req as any).user?.userId;
      console.log('Extracted userId:', userId);
      if (!userId) {
        console.log('No userId - returning empty progress');
        return res.json({ watchedDuration: 0, totalDuration: 0 });
      }
      
      const { watchedDuration, totalDuration } = req.body;
      
      const userObjectId = new mongoose.Types.ObjectId(userId);
      const videoObjectId = new mongoose.Types.ObjectId(req.params.videoId);
      
      console.log('Saving progress - userId:', userObjectId, 'videoId:', videoObjectId, 'duration:', watchedDuration);
      
      // Check if this is the first time watching (increment views)
      const existingProgress = await VideoProgress.findOne({ 
        userId: userObjectId,
        videoId: videoObjectId
      });
      if (!existingProgress || existingProgress.watchedDuration === 0) {
        await storage.incrementVideoViews(req.params.videoId);
      }
      
      // Upsert the progress record
      const progress = await VideoProgress.findOneAndUpdate(
        { userId: userObjectId, videoId: videoObjectId },
        { 
          userId: userObjectId,
          videoId: videoObjectId,
          watchedDuration,
          totalDuration,
          lastWatchedAt: new Date(),
          completed: totalDuration > 0 && watchedDuration >= totalDuration * 0.95
        },
        { upsert: true, new: true }
      );
      console.log('Progress saved successfully:', progress);
      res.json(progress);
    } catch (error: any) {
      console.error('Error in POST /api/video-progress:', error);
      res.status(500).json({ message: error.message });
    }
  });

  // Legacy routes for client-based progress (kept for backwards compatibility)
  app.get("/api/clients/:clientId/video-progress/:videoId", authenticateToken, requireOwnershipOrAdmin, async (req, res) => {
    try {
      const progress = await storage.getVideoProgress(req.params.clientId, req.params.videoId);
      res.json(progress);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update video progress (owner or admin only)
  app.post("/api/clients/:clientId/video-progress/:videoId", authenticateToken, requireOwnershipOrAdmin, async (req, res) => {
    try {
      const { watchedDuration, totalDuration } = req.body;
      
      // Check if this is the first time watching (increment views)
      const existingProgress = await storage.getVideoProgress(req.params.clientId, req.params.videoId);
      if (!existingProgress || existingProgress.watchedDuration === 0) {
        await storage.incrementVideoViews(req.params.videoId);
      }
      
      const progress = await storage.updateVideoProgress(
        req.params.clientId,
        req.params.videoId,
        watchedDuration,
        totalDuration
      );
      res.json(progress);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get continue watching videos (owner or admin only)
  app.get("/api/clients/:clientId/continue-watching", authenticateToken, requireOwnershipOrAdmin, async (req, res) => {
    try {
      const videos = await storage.getContinueWatching(req.params.clientId);
      res.json(videos.map(ensureVideoFlags));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Video Bookmark routes (owner or admin only)
  app.get("/api/clients/:clientId/bookmarks", authenticateToken, requireOwnershipOrAdmin, async (req, res) => {
    try {
      const bookmarks = await storage.getVideoBookmarks(req.params.clientId);
      res.json(bookmarks.map(ensureVideoFlags));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Create bookmark (owner or admin only)
  app.post("/api/clients/:clientId/bookmarks/:videoId", authenticateToken, requireOwnershipOrAdmin, async (req, res) => {
    try {
      const bookmark = await storage.createVideoBookmark(req.params.clientId, req.params.videoId);
      res.json(bookmark);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Delete bookmark (owner or admin only)
  app.delete("/api/clients/:clientId/bookmarks/:videoId", authenticateToken, requireOwnershipOrAdmin, async (req, res) => {
    try {
      const success = await storage.deleteVideoBookmark(req.params.clientId, req.params.videoId);
      if (!success) {
        return res.status(404).json({ message: "Bookmark not found" });
      }
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Check if video is bookmarked (owner or admin only)
  app.get("/api/clients/:clientId/bookmarks/:videoId/check", authenticateToken, requireOwnershipOrAdmin, async (req, res) => {
    try {
      const isBookmarked = await storage.isVideoBookmarked(req.params.clientId, req.params.videoId);
      res.json({ isBookmarked });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Progress Photo routes (owner or admin only)
  app.get("/api/clients/:clientId/progress-photos", authenticateToken, requireOwnershipOrAdmin, async (req, res) => {
    try {
      const photos = await storage.getProgressPhotos(req.params.clientId);
      res.json(photos);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Create progress photo (owner or admin only)
  app.post("/api/clients/:clientId/progress-photos", authenticateToken, requireOwnershipOrAdmin, async (req, res) => {
    try {
      const { photoUrl, description, weight } = req.body;
      const photo = await storage.createProgressPhoto({
        clientId: req.params.clientId,
        photoUrl,
        description,
        weight,
      });
      res.json(photo);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Delete progress photo (owner or admin only)
  app.delete("/api/clients/:clientId/progress-photos/:photoId", authenticateToken, requireOwnershipOrAdmin, async (req, res) => {
    try {
      const success = await storage.deleteProgressPhoto(req.params.clientId, req.params.photoId);
      if (!success) {
        return res.status(404).json({ message: "Progress photo not found or access denied" });
      }
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Workout Plan routes
  app.get("/api/workout-plan-templates", authenticateToken, requireRole('admin', 'trainer'), async (req, res) => {
    try {
      let allPlans = await WorkoutPlan.find({ isTemplate: true }).lean();
      
      // Add template source badge
      const templatesWithSource = allPlans.map((plan: any) => {
        const isAdminTemplate = plan.createdBy?.toString().includes('admin') || !plan.createdBy;
        return {
          ...plan,
          templateSource: isAdminTemplate ? 'admin' : 'trainer',
          isTemplate: true
        };
      });
      
      res.json(templatesWithSource);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/workout-plan-templates", authenticateToken, requireRole('admin', 'trainer'), async (req, res) => {
    try {
      const templateData = {
        ...req.body,
        isTemplate: true,
        createdBy: req.user?.userId || req.user?.id || 'admin',
      };
      const template = await storage.createWorkoutPlan(templateData);
      res.json(template);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/workout-plan-templates/:id", authenticateToken, requireRole('admin', 'trainer'), async (req, res) => {
    try {
      const template = await storage.updateWorkoutPlan(req.params.id, req.body);
      if (!template) {
        return res.status(404).json({ message: "Workout plan template not found" });
      }
      res.json(template);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/workout-plan-templates/:id", authenticateToken, requireRole('admin', 'trainer'), async (req, res) => {
    try {
      const success = await storage.deleteWorkoutPlan(req.params.id);
      if (!success) {
        return res.status(404).json({ message: "Workout plan template not found" });
      }
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/workout-plan-templates/:id/clone", authenticateToken, requireRole('admin', 'trainer'), async (req, res) => {
    try {
      const { clientId } = req.body;
      const clonedPlan = await storage.cloneWorkoutPlan(req.params.id, clientId);
      res.json(clonedPlan);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/workout-plans", authenticateToken, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      const user = await storage.getUserById(req.user.userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Clients get their assigned plans, admins/trainers get all plans
      if (user.role === 'client') {
        // clientId might be populated as full object, so extract _id if needed
        let clientId = typeof user.clientId === 'object' && user.clientId?._id 
          ? user.clientId._id.toString()
          : user.clientId?.toString();
        
        // If user doesn't have clientId, find the Client by email
        if (!clientId && user.email) {
          const client = await storage.getClientByEmail(user.email);
          if (client) {
            clientId = client._id.toString();
          }
        }
        
        if (!clientId) {
          console.warn(`[GET /api/workout-plans] No client ID found for user ${user.email}`);
          return res.json([]);
        }
        
        const plans = await storage.getClientWorkoutPlans(clientId);
        
        // Normalize exercises: convert old nested format {Monday: {exercises: [...]}} to flat format {Monday: [...]}
        const normalizedPlans = plans.map(plan => ({
          ...plan.toObject ? plan.toObject() : plan,
          exercises: normalizeExercises(plan.exercises)
        }));
        
        return res.json(normalizedPlans);
      } else if (user.role === 'admin' || user.role === 'trainer') {
        const search = req.query.search as string | undefined;
        const category = req.query.category as string | undefined;
        const plans = await storage.getAllWorkoutPlans(search, category);
        return res.json(plans);
      } else {
        return res.status(403).json({ message: "Unauthorized to access workout plans" });
      }
    } catch (error: any) {
      console.error('[GET /api/workout-plans] Error:', error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/workout-plans/plan/:id", async (req, res) => {
    try {
      const plan = await storage.getWorkoutPlan(req.params.id);
      if (!plan) {
        return res.status(404).json({ message: "Workout plan not found" });
      }
      res.json(plan);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/workout-plans", authenticateToken, requireRole('admin', 'trainer'), async (req, res) => {
    try {
      const plan = await storage.createWorkoutPlan(req.body);
      res.json(plan);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/workout-plans/:id", authenticateToken, requireRole('admin', 'trainer'), async (req, res) => {
    try {
      const plan = await storage.updateWorkoutPlan(req.params.id, req.body);
      if (!plan) {
        return res.status(404).json({ message: "Workout plan not found" });
      }
      res.json(plan);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/workout-plans/:id", authenticateToken, requireRole('admin', 'trainer'), async (req, res) => {
    try {
      const success = await storage.deleteWorkoutPlan(req.params.id);
      if (!success) {
        return res.status(404).json({ message: "Workout plan not found" });
      }
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/workout-plans", authenticateToken, requireRole('admin', 'trainer'), async (req, res) => {
    try {
      const success = await storage.deleteAllWorkoutPlans();
      res.json({ success, message: "All workout plans cleared successfully" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Diet Plan routes
  app.get("/api/diet-plans", authenticateToken, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      const user = await storage.getUserById(req.user.userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Check for query parameter clientId - allows admins/trainers to view specific client's plans
      const queryClientId = req.query.clientId as string;
      console.log(`[Diet Plans API] User: ${user.email}, Role: ${user.role}, Query clientId: ${queryClientId}`);
      
      // Extract clientId from user - clientId might be populated as full object, so extract _id if needed
      let clientId = typeof user.clientId === 'object' && user.clientId?._id 
        ? user.clientId._id.toString()
        : user.clientId?.toString();
      
      // If admin/trainer specified a clientId in query, use that (allows admins to view client dashboards)
      if (queryClientId && (user.role === 'admin' || user.role === 'trainer')) {
        clientId = queryClientId;
        console.log(`[Diet Plans] Admin/Trainer using query clientId: ${clientId}`);
      }
      
      // If user doesn't have clientId but has email, try to find by email lookup
      if (!clientId && user.email) {
        console.log(`[Diet Plans] User ${user.email} missing clientId, looking up by email...`);
        const client = await storage.getClientByEmail(user.email);
        if (client) {
          clientId = client._id.toString();
          // UPDATE the user record to save clientId for future requests
          await storage.updateUser(user._id.toString(), { clientId: clientId });
          console.log(`[Diet Plans] Updated user ${user.email} with clientId ${clientId}`);
        }
      }
      
      // Clients get their assigned plans, admins/trainers get all plans (unless clientId specified)
      if (clientId) {
        console.log(`[Diet Plans] 🔵 GOING CLIENT PATH - fetching ASSIGNED plans for clientId: ${clientId}`);
        const plans = await storage.getClientDietPlans(clientId);
        console.log(`[Diet Plans] ✅ CLIENT PATH - Retrieved ${plans.length} ASSIGNED diet plans for client ${clientId}`);
        return res.json(plans);
      } else if (user.role === 'admin' || user.role === 'trainer') {
        console.log(`[Diet Plans] 🔴 GOING ADMIN PATH - role: ${user.role}, no clientId`);
        const plans = await storage.getAllDietPlansWithAssignments();
        console.log(`[Diet Plans] ✅ ADMIN PATH - Returned ${plans.length} all plans`);
        return res.json(plans);
      } else {
        console.warn(`[Diet Plans] User ${user.email} has no clientId and is not admin/trainer (role: ${user.role})`);
        return res.json([]);
      }
    } catch (error: any) {
      console.error(`[Diet Plans] Error:`, error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/diet-plans/plan/:id", async (req, res) => {
    try {
      const plan = await storage.getDietPlan(req.params.id);
      if (!plan) {
        return res.status(404).json({ message: "Diet plan not found" });
      }
      res.json(plan);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/diet-plans", authenticateToken, requireRole('admin', 'trainer'), async (req, res) => {
    try {
      // Log incoming meals data to verify nutritional values
      const meals = req.body.meals;
      if (meals && typeof meals === 'object') {
        Object.entries(meals).forEach(([day, dayMeals]: [string, any]) => {
          Object.entries(dayMeals).forEach(([mealType, mealData]: [string, any]) => {
            console.log(`[DIET CREATE] ${day} - ${mealType}: calories=${mealData.calories}, protein=${mealData.protein}, carbs=${mealData.carbs}, fats=${mealData.fats}`);
          });
        });
      }
      const plan = await storage.createDietPlan(req.body);
      res.json(plan);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/diet-plans/:id", authenticateToken, requireRole('admin', 'trainer'), async (req, res) => {
    try {
      const updateData = req.body;
      
      // Remove restricted fields to prevent unintended changes
      delete updateData._id;
      delete updateData.clientId;
      delete updateData.createdAt;
      
      const plan = await storage.updateDietPlan(req.params.id, updateData);
      if (!plan) {
        return res.status(404).json({ message: "Diet plan not found" });
      }
      
      console.log(`[Diet Update] Successfully updated diet plan ${req.params.id}`);
      res.json({ 
        message: "Diet template updated successfully",
        plan 
      });
    } catch (error: any) {
      console.error(`[Diet Update] Error updating diet plan:`, error);
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/diet-plans/:id", authenticateToken, requireRole('admin', 'trainer'), async (req, res) => {
    try {
      const success = await storage.deleteDietPlan(req.params.id);
      if (!success) {
        return res.status(404).json({ message: "Diet plan not found" });
      }
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Workout Plans Routes
  app.get("/api/clients/:clientId/workout-plans", authenticateToken, async (req, res) => {
    try {
      const plans = await storage.getClientWorkoutPlans(req.params.clientId);
      res.json(plans);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/clients/:clientId/workout-plans", authenticateToken, async (req, res) => {
    try {
      const success = await storage.clearClientWorkoutAssignments(req.params.clientId);
      res.json({ success, message: "All assigned workout plans cleared" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Workout Bookmarks Routes
  app.get("/api/clients/:clientId/workout-bookmarks", authenticateToken, async (req, res) => {
    try {
      const bookmarks = await storage.getClientWorkoutBookmarks(req.params.clientId);
      res.json(bookmarks);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/clients/:clientId/workout-bookmarks/:planId", authenticateToken, async (req, res) => {
    try {
      await storage.toggleWorkoutBookmark(req.params.clientId, req.params.planId);
      const bookmarks = await storage.getClientWorkoutBookmarks(req.params.clientId);
      res.json(bookmarks);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/clients/:clientId/workout-bookmarks/:planId", authenticateToken, async (req, res) => {
    try {
      await storage.toggleWorkoutBookmark(req.params.clientId, req.params.planId);
      const bookmarks = await storage.getClientWorkoutBookmarks(req.params.clientId);
      res.json(bookmarks);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Workout History Routes
  app.get("/api/clients/:clientId/workout-history", authenticateToken, async (req, res) => {
    try {
      const history = await storage.getClientWorkoutHistory(req.params.clientId);
      res.json(history);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/clients/:clientId/workout-history", authenticateToken, async (req, res) => {
    try {
      const { workoutPlanId, workoutName, duration, notes } = req.body;
      if (!workoutName || !duration) {
        return res.status(400).json({ message: "Workout name and duration are required" });
      }
      const session = await storage.createWorkoutSession({
        clientId: req.params.clientId,
        workoutPlanId,
        workoutName,
        duration,
        notes,
        completedAt: new Date(),
        caloriesBurned: 0
      });
      res.json(session);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Workout Notes Routes
  app.get("/api/clients/:clientId/workout-notes", authenticateToken, async (req, res) => {
    try {
      const notes = await storage.getAllWorkoutNotes(req.params.clientId);
      const notesMap: any = {};
      notes.forEach((note: any) => {
        notesMap[note.workoutPlanId.toString()] = note.notes;
      });
      res.json(notesMap);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/clients/:clientId/workout-notes/:planId", authenticateToken, async (req, res) => {
    try {
      const { notes } = req.body;
      const savedNote = await storage.saveWorkoutNote(req.params.clientId, req.params.planId, notes || '');
      res.json(savedNote);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Package-Based Access & Assignment Endpoints
  app.get("/api/client-access/:clientId", authenticateToken, async (req, res) => {
    try {
      const clientId = req.params.clientId;
      const packageDetails = await storage.getClientPackageDetails(clientId);
      
      if (!packageDetails) {
        return res.status(404).json({ message: "Client not found" });
      }
      
      res.json(packageDetails);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/assign-workout", authenticateToken, requireRole('admin', 'trainer'), async (req, res) => {
    try {
      const { workoutPlanId, clientId } = req.body;
      
      if (!workoutPlanId || !clientId) {
        return res.status(400).json({ message: "Workout plan ID and client ID are required" });
      }
      
      // Check if client's package allows workout access
      const hasAccess = await storage.checkClientPackageAccess(clientId, 'workout');
      if (!hasAccess) {
        return res.status(403).json({ 
          message: "Client's package does not include workout plan access. Upgrade required." 
        });
      }
      
      const plan = await storage.assignWorkoutPlanToClient(workoutPlanId, clientId);
      if (!plan) {
        return res.status(404).json({ message: "Workout plan not found" });
      }
      
      console.log(`[Assign Workout] Successfully assigned workout plan ${workoutPlanId} to client ${clientId}`);
      res.json({ message: "Workout plan assigned successfully", plan });
    } catch (error: any) {
      console.error(`[Assign Workout] Error:`, error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/assign-diet", authenticateToken, requireRole('admin', 'trainer'), async (req, res) => {
    try {
      const { dietPlanId, clientId } = req.body;
      
      if (!dietPlanId || !clientId) {
        return res.status(400).json({ message: "Diet plan ID and client ID are required" });
      }
      
      console.log(`[Assign Diet] Attempting to assign diet plan ${dietPlanId} to client ${clientId}`);
      
      const plan = await storage.assignDietPlanToClient(dietPlanId, clientId);
      if (!plan) {
        return res.status(404).json({ message: "Diet plan not found" });
      }
      
      console.log(`[Assign Diet] Successfully assigned diet plan ${dietPlanId} to client ${clientId}`);
      res.json({ message: "Diet plan assigned successfully", plan });
    } catch (error: any) {
      console.error(`[Assign Diet] Error assigning diet plan:`, error);
      res.status(500).json({ message: error.message });
    }
  });

  // Database Cleanup Endpoints (Admin Only)
  app.delete("/api/admin/cleanup/clients", authenticateToken, requireAdmin, async (req, res) => {
    try {
      const clients = await storage.getAllClients(true);
      let deletedCount = 0;
      
      for (const client of clients) {
        const success = await storage.permanentlyDeleteClient(client._id.toString());
        if (success) deletedCount++;
      }
      
      res.json({ 
        message: `Deleted ${deletedCount} test clients`, 
        deletedCount,
        totalBefore: clients.length 
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/admin/cleanup/trainers", authenticateToken, requireAdmin, async (req, res) => {
    try {
      const trainers = await storage.getAllTrainers();
      let deletedCount = 0;
      
      for (const trainer of trainers) {
        const success = await storage.deleteUser(trainer._id.toString());
        if (success) deletedCount++;
      }
      
      res.json({ 
        message: `Deleted ${deletedCount} test trainers`, 
        deletedCount,
        totalBefore: trainers.length 
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Diet Plan Template routes
  app.get("/api/diet-plan-templates", authenticateToken, async (req, res) => {
    try {
      const category = req.query.category as string | undefined;
      const assigned = req.query.assigned === 'true';
      
      let query: any = { isTemplate: true };
      
      // If assigned=true, fetch assigned plans (those with clientId) instead of templates
      if (assigned) {
        query = { clientId: { $exists: true, $ne: null } };
      }
      
      let allPlans = await DietPlan.find(query);
      
      // Filter by category if provided
      if (category && category !== 'all') {
        allPlans = allPlans.filter((plan: any) => plan.category === category);
      }
      
      // Add template source badge and log meals data
      const templatesWithSource = allPlans.map((plan: any) => {
        const planObj = plan.toObject();
        const isAdminTemplate = plan.createdBy?.toString().includes('admin') || !plan.createdBy;
        
        // Log meals for debugging
        if (planObj.meals && typeof planObj.meals === 'object' && !Array.isArray(planObj.meals)) {
          const mealsKeys = Object.keys(planObj.meals);
          console.log(`[API Diet Templates] Plan: ${plan.name}, assigned=${assigned}, meals days: [${mealsKeys.join(', ')}]`);
        }
        
        return {
          ...planObj,
          templateSource: isAdminTemplate ? 'admin' : 'trainer',
          isTemplate: true
        };
      });
      
      console.log(`[API Diet Templates] Returning ${templatesWithSource.length} plans (assigned=${assigned})`);
      res.json(templatesWithSource);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/diet-plans/:id/clone", async (req, res) => {
    try {
      const { clientId } = req.body;
      const clonedPlan = await storage.cloneDietPlan(req.params.id, clientId);
      res.json(clonedPlan);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get all diet plans (both templates and assigned) for assignment dialogs
  app.get("/api/all-diet-plans", async (req, res) => {
    try {
      let allPlans = await storage.getAllDietPlansWithAssignments();
      res.json(allPlans);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get all workout plans (both templates and assigned) for assignment dialogs
  app.get("/api/all-workout-plans", async (req, res) => {
    try {
      let allPlans = await storage.getAllWorkoutPlansWithAssignments();
      res.json(allPlans);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/diet-plans-with-assignments", authenticateToken, async (req, res) => {
    try {
      const allClients = await storage.getAllClients();
      
      // Filter by trainer if user is a trainer
      let clients = allClients;
      if (req.user?.role === 'trainer') {
        clients = clients.filter((client: any) => client.trainerId?.toString() === req.user?.userId?.toString());
      }
      
      // Get assignments for each client
      const assignments = await Promise.all(
        clients.map(async (client: any) => {
          const dietPlans = await storage.getClientDietPlans(client._id.toString());
          const workoutPlans = await storage.getClientWorkoutPlans(client._id.toString());
          
          return {
            _id: client._id,
            clientName: client.name,
            clientEmail: client.email,
            trainerId: client.trainerId,
            dietPlanName: dietPlans.length > 0 ? dietPlans[0].name : null,
            workoutPlanName: workoutPlans.length > 0 ? workoutPlans[0].name : null,
            dietPlanId: dietPlans.length > 0 ? dietPlans[0]._id : null,
            workoutPlanId: workoutPlans.length > 0 ? workoutPlans[0]._id : null,
          };
        })
      );
      
      // Filter out clients with no assignments
      const assignmentsWithPlans = assignments.filter(
        (a: any) => a.dietPlanName || a.workoutPlanName
      );
      
      res.json(assignmentsWithPlans);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get plan assignments (diet + workout) for clients
  app.get("/api/diet-plan-assignments", authenticateToken, async (req, res) => {
    try {
      let clients = await storage.getAllClients();
      
      // Filter by trainer if user is a trainer
      if (req.user?.role === 'trainer') {
        clients = clients.filter((client: any) => 
          client.trainerId?.toString() === req.user?.userId?.toString()
        );
      }
      
      // Get assignments for each client
      const assignments = await Promise.all(
        clients.map(async (client: any) => {
          const dietPlans = await storage.getClientDietPlans(client._id.toString());
          const workoutPlans = await storage.getClientWorkoutPlans(client._id.toString());
          
          return {
            _id: client._id,
            clientName: client.name,
            clientEmail: client.email,
            dietPlanName: dietPlans.length > 0 ? dietPlans[0].name : null,
            workoutPlanName: workoutPlans.length > 0 ? workoutPlans[0].name : null,
            dietPlanId: dietPlans.length > 0 ? dietPlans[0]._id : null,
            workoutPlanId: workoutPlans.length > 0 ? workoutPlans[0]._id : null,
          };
        })
      );
      
      // Filter out clients with no assignments
      const assignmentsWithPlans = assignments.filter(
        (a: any) => a.dietPlanName || a.workoutPlanName
      );
      
      res.json(assignmentsWithPlans);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ===========================================
  // MEAL COMPLETION & TRACKING ENDPOINTS
  // ===========================================

  // Mark a meal as completed
  app.post("/api/meal-completions", authenticateToken, async (req, res) => {
    try {
      const { clientId, dietPlanId, mealType, calories, protein, carbs, fats, fiber } = req.body;
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const mealCompletion = await storage.createMealCompletion({
        clientId,
        dietPlanId,
        mealType,
        date: today,
        calories,
        protein,
        carbs,
        fats,
        fiber,
      });

      res.status(201).json(mealCompletion);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get meal completions for a specific date
  app.get("/api/meal-completions/:clientId/:date", authenticateToken, async (req, res) => {
    try {
      const { clientId, date } = req.params;
      const completions = await storage.getMealCompletions(clientId, new Date(date));
      res.json(completions);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get today's meal completions for client
  app.get("/api/meal-completions/today/:clientId", authenticateToken, async (req, res) => {
    try {
      const { clientId } = req.params;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const completions = await storage.getMealCompletions(clientId, today);
      res.json(completions);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ===========================================
  // WATER INTAKE TRACKING ENDPOINTS
  // ===========================================

  // Log or update water intake
  app.post("/api/water-intake", authenticateToken, async (req, res) => {
    try {
      const { clientId, glasses, date } = req.body;
      const targetDate = date ? new Date(date) : new Date();
      targetDate.setHours(0, 0, 0, 0);

      const totalMl = glasses * 250; // Each glass = 250ml
      
      // Check if entry exists for today
      const existing = await storage.getWaterIntake(clientId, targetDate);
      
      if (existing) {
        // Update existing entry
        const updated = await storage.updateWaterIntake(existing._id.toString(), {
          glasses,
          totalMl,
          updatedAt: new Date(),
        });
        res.json(updated);
      } else {
        // Create new entry
        const waterIntake = await storage.createWaterIntake({
          clientId,
          date: targetDate,
          glasses,
          totalMl,
          goal: 2000, // Default 2000ml = 8 glasses
        });
        res.status(201).json(waterIntake);
      }
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get water intake for a specific date
  app.get("/api/water-intake/:clientId/:date", authenticateToken, async (req, res) => {
    try {
      const { clientId, date } = req.params;
      const intake = await storage.getWaterIntake(clientId, new Date(date));
      res.json(intake || { glasses: 0, totalMl: 0, goal: 2000 });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get today's water intake
  app.get("/api/water-intake/today/:clientId", authenticateToken, async (req, res) => {
    try {
      const { clientId } = req.params;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const intake = await storage.getWaterIntake(clientId, today);
      res.json(intake || { glasses: 0, totalMl: 0, goal: 2000 });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ===========================================
  // WORKOUT COMPLETION TRACKING ENDPOINTS
  // ===========================================

  // Log workout completion
  app.post("/api/workout-completions", authenticateToken, async (req, res) => {
    try {
      const { clientId, workoutPlanId, exerciseName, sets, reps, weight, duration, caloriesBurned, notes } = req.body;
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const completion = await storage.createWorkoutCompletion({
        clientId,
        workoutPlanId,
        exerciseName,
        sets,
        reps,
        weight,
        duration,
        caloriesBurned: caloriesBurned || 0,
        date: today,
        notes,
      });

      res.status(201).json(completion);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get workout completions for a specific date
  app.get("/api/workout-completions/:clientId/:date", authenticateToken, async (req, res) => {
    try {
      const { clientId, date } = req.params;
      const completions = await storage.getWorkoutCompletions(clientId, new Date(date));
      res.json(completions);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get today's workout completions
  app.get("/api/workout-completions/today/:clientId", authenticateToken, async (req, res) => {
    try {
      const { clientId } = req.params;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const completions = await storage.getWorkoutCompletions(clientId, today);
      res.json(completions);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ===========================================
  // DAILY NUTRITION SUMMARY ENDPOINT
  // ===========================================

  // Get daily nutrition summary (calories + macros from meals and workouts)
  app.get("/api/daily-nutrition/:clientId/:date", authenticateToken, async (req, res) => {
    try {
      const { clientId, date } = req.params;
      const targetDate = new Date(date);
      targetDate.setHours(0, 0, 0, 0);

      // Get meal completions
      const meals = await storage.getMealCompletions(clientId, targetDate);
      
      // Get workout completions
      const workouts = await storage.getWorkoutCompletions(clientId, targetDate);

      // Calculate totals
      const foodCalories = meals.reduce((sum: number, meal: any) => sum + (meal.calories || 0), 0);
      const exerciseCalories = workouts.reduce((sum: number, workout: any) => sum + (workout.caloriesBurned || 0), 0);
      
      const totalProtein = meals.reduce((sum: number, meal: any) => sum + (meal.protein || 0), 0);
      const totalCarbs = meals.reduce((sum: number, meal: any) => sum + (meal.carbs || 0), 0);
      const totalFats = meals.reduce((sum: number, meal: any) => sum + (meal.fats || 0), 0);
      const totalFiber = meals.reduce((sum: number, meal: any) => sum + (meal.fiber || 0), 0);

      // Get client's diet plan for goal
      const dietPlans = await storage.getClientDietPlans(clientId);
      const baseGoal = dietPlans.length > 0 ? dietPlans[0].targetCalories : 2000;

      // Remaining calories = Goal - Food + Exercise
      const remainingCalories = baseGoal - foodCalories + exerciseCalories;

      res.json({
        date: targetDate,
        baseGoal,
        foodCalories,
        exerciseCalories,
        remainingCalories,
        macros: {
          protein: Math.round(totalProtein),
          carbs: Math.round(totalCarbs),
          fats: Math.round(totalFats),
          fiber: Math.round(totalFiber),
        },
        mealsCompleted: meals.length,
        workoutsCompleted: workouts.length,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Delete plan assignment (removes both diet and workout plans from client)
  app.delete("/api/diet-plan-assignments/:id", authenticateToken, requireRole('admin', 'trainer'), async (req, res) => {
    try {
      const clientId = req.params.id;
      
      // Verify client exists
      const client = await storage.getClient(clientId);
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }
      
      // Get all diet and workout plans for this client
      const dietPlans = await storage.getClientDietPlans(clientId);
      const workoutPlans = await storage.getClientWorkoutPlans(clientId);
      
      // Delete all diet plans
      for (const plan of dietPlans) {
        await storage.deleteDietPlan(plan._id.toString());
      }
      
      // Delete all workout plans
      for (const plan of workoutPlans) {
        await storage.deleteWorkoutPlan(plan._id.toString());
      }
      
      res.json({ 
        success: true, 
        message: "Assignment removed successfully",
        deletedDietPlans: dietPlans.length,
        deletedWorkoutPlans: workoutPlans.length
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Meal routes
  app.get("/api/meals", async (req, res) => {
    try {
      const filters = {
        category: req.query.category as string | undefined,
        mealType: req.query.mealType as string | undefined,
        search: req.query.search as string | undefined,
      };
      const meals = await storage.getAllMeals(filters);
      res.json(meals);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/meals/:id", async (req, res) => {
    try {
      const meal = await storage.getMeal(req.params.id);
      if (!meal) {
        return res.status(404).json({ message: "Meal not found" });
      }
      res.json(meal);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/meals", authenticateToken, requireRole('admin', 'trainer'), async (req, res) => {
    try {
      const meal = await storage.createMeal(req.body);
      res.json(meal);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/meals/:id", authenticateToken, requireRole('admin', 'trainer'), async (req, res) => {
    try {
      const meal = await storage.updateMeal(req.params.id, req.body);
      if (!meal) {
        return res.status(404).json({ message: "Meal not found" });
      }
      res.json(meal);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/meals/:id", authenticateToken, requireRole('admin', 'trainer'), async (req, res) => {
    try {
      const success = await storage.deleteMeal(req.params.id);
      if (!success) {
        return res.status(404).json({ message: "Meal not found" });
      }
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/meals/:id/clone", authenticateToken, requireRole('admin', 'trainer'), async (req, res) => {
    try {
      const { clientId } = req.body;
      const meal = await storage.getMeal(req.params.id);
      if (!meal) {
        return res.status(404).json({ message: "Meal not found" });
      }
      
      // If clientId is provided, create a simple diet plan for this meal and assign to client
      if (clientId) {
        // Get client to retrieve trainerId
        const client = await storage.getClient(clientId);
        if (!client) {
          return res.status(404).json({ message: "Client not found" });
        }
        
        // Create a diet plan containing this meal in array format
        // The client diet page expects meals to be an array of meal objects
        const dietPlan = await storage.createDietPlan({
          clientId,
          trainerId: client.trainerId,
          name: `${meal.name} Meal Plan`,
          targetCalories: meal.calories || 0,
          protein: meal.protein || 0,
          carbs: meal.carbs || 0,
          fats: meal.fats || 0,
          category: meal.category || 'Custom',
          meals: [{
            name: meal.name,
            calories: meal.calories || 0,
            protein: meal.protein || 0,
            carbs: meal.carbs || 0,
            fats: meal.fats || 0,
            weekNumber: 1, // Default to week 1
            mealType: meal.mealType || 'lunch',
            ingredients: meal.ingredients || [],
            instructions: meal.instructions || '',
            prepTime: meal.prepTime,
            cookTime: meal.cookTime,
          }],
          isTemplate: false,
          createdBy: req.user?.role || 'admin',
        });
        return res.json(dietPlan);
      }
      
      // Otherwise, create a copy of the meal template
      const clonedMeal = await storage.createMeal({
        ...meal.toObject(),
        _id: undefined,
        name: `${meal.name} (Copy)`,
        createdBy: req.user?.role || 'admin',
      });
      
      res.json(clonedMeal);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Helper function to sanitize session data for clients
  const sanitizeSessionForClient = (session: any, userRole?: string) => {
    // Only admins and trainers can see startUrl and hostId
    if (userRole === 'admin' || userRole === 'trainer') {
      return session;
    }
    
    // For clients, remove sensitive fields
    const { startUrl, hostId, ...clientSafeSession } = session.toObject ? session.toObject() : session;
    return clientSafeSession;
  };

  // Get eligible clients for live sessions (with liveGroupTrainingAccess)
  app.get("/api/sessions/eligible-clients", optionalAuth, async (req, res) => {
    try {
      const allClients = await storage.getAllClients();
      const eligibleClients = [];

      for (const client of allClients) {
        if (client.packageId) {
          const pkg = typeof client.packageId === 'object' ? client.packageId : await storage.getPackage(client.packageId.toString());
          
          if (pkg && (pkg.liveGroupTrainingAccess === true || (pkg.liveSessionsPerMonth && pkg.liveSessionsPerMonth > 0))) {
            if (!client.subscription?.endDate || new Date(client.subscription.endDate) >= new Date()) {
              eligibleClients.push(client);
            }
          }
        }
      }

      res.json(eligibleClients);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Live Session routes
  app.get("/api/sessions", optionalAuth, async (req, res) => {
    try {
      const sessions = await storage.getAllSessions();
      const sanitizedSessions = sessions.map(s => sanitizeSessionForClient(s, req.user?.role));
      res.json(sanitizedSessions);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/sessions/:id", optionalAuth, async (req, res) => {
    try {
      const session = await storage.getSession(req.params.id);
      if (!session) {
        return res.status(404).json({ message: "Session not found" });
      }
      const sanitizedSession = sanitizeSessionForClient(session, req.user?.role);
      res.json(sanitizedSession);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/sessions/client/:clientId", optionalAuth, async (req, res) => {
    try {
      const sessions = await storage.getClientSessions(req.params.clientId);
      const sanitizedSessions = sessions.map(s => sanitizeSessionForClient(s, req.user?.role));
      res.json(sanitizedSessions);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/sessions", authenticateToken, requireRole('admin', 'trainer'), async (req, res) => {
    try {
      const sessionData = { ...req.body };
      // If trainer is creating, set trainerId automatically
      if (req.user?.role === 'trainer') {
        sessionData.trainerId = req.user.userId;
      }
      const session = await storage.createSession(sessionData);
      res.json(session);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/sessions/:id", authenticateToken, requireAdmin, async (req, res) => {
    try {
      const session = await storage.updateSession(req.params.id, req.body);
      if (!session) {
        return res.status(404).json({ message: "Session not found" });
      }
      res.json(session);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get or create universal Zoom link
  app.post("/api/zoom/universal-link", authenticateToken, requireRole('admin'), async (req, res) => {
    try {
      if (!zoomService.isConfigured()) {
        return res.status(503).json({ 
          message: "Zoom integration is not configured. Please add ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, and ZOOM_ACCOUNT_SECRET environment variables." 
        });
      }

      let settings = await storage.getSystemSettings();
      
      // If universal link already exists, return it
      if (settings.universalZoomLink?.joinUrl) {
        return res.json({
          message: "Universal Zoom link retrieved",
          zoomLink: settings.universalZoomLink,
        });
      }

      // Create new universal Zoom meeting (will stay active forever)
      const zoomMeeting = await zoomService.createMeeting({
        topic: 'FitPro Universal Training Session',
        start_time: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour from now
        duration: 480, // 8 hours - effectively permanent
        agenda: 'Universal training session link - active forever',
        password: req.body.password || '',
      });

      // Save universal link to system settings
      const updatedSettings = await storage.updateSystemSettings({
        universalZoomLink: {
          joinUrl: zoomMeeting.join_url,
          startUrl: zoomMeeting.start_url,
          meetingId: String(zoomMeeting.id),
          password: zoomMeeting.password,
          createdAt: new Date(),
        }
      });

      res.json({
        message: "Universal Zoom link created successfully",
        zoomLink: updatedSettings.universalZoomLink,
      });
    } catch (error: any) {
      console.error('Error creating universal Zoom link:', error);
      res.status(500).json({ message: error.message || "Failed to create universal Zoom link" });
    }
  });

  // Create Zoom meeting for a session (admin and trainer)
  app.post("/api/sessions/:id/create-zoom", authenticateToken, requireRole('admin', 'trainer'), async (req, res) => {
    try {
      const session = await storage.getSession(req.params.id);
      if (!session) {
        return res.status(404).json({ message: "Session not found" });
      }

      // Get universal Zoom link from system settings
      const settings = await storage.getSystemSettings();
      const universalLink = settings.universalZoomLink;

      if (universalLink?.joinUrl) {
        // Use universal link instead of creating a new one
        const updatedSession = await storage.updateSession(req.params.id, {
          joinUrl: universalLink.joinUrl,
          startUrl: universalLink.startUrl,
          zoomMeetingId: universalLink.meetingId,
          meetingPassword: universalLink.password,
        });

        return res.json({ 
          message: "Zoom link assigned successfully (using universal link)",
          session: updatedSession,
        });
      }

      // Fallback: create individual Zoom meeting if no universal link exists
      if (!zoomService.isConfigured()) {
        return res.status(503).json({ 
          message: "Zoom integration is not configured. Please add ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, and ZOOM_ACCOUNT_SECRET environment variables." 
        });
      }

      const zoomMeeting = await zoomService.createMeeting({
        topic: session.title,
        start_time: new Date(session.scheduledAt).toISOString(),
        duration: session.duration,
        agenda: session.description || '',
        password: req.body.password,
      });

      // Update session with Zoom details
      const updatedSession = await storage.updateSession(req.params.id, {
        zoomMeetingId: String(zoomMeeting.id),
        joinUrl: zoomMeeting.join_url,
        startUrl: zoomMeeting.start_url,
        hostId: zoomMeeting.host_id,
        meetingPassword: zoomMeeting.password,
      });

      res.json({ 
        message: "Zoom meeting created successfully",
        session: updatedSession,
        zoomMeeting
      });
    } catch (error: any) {
      console.error('Error creating Zoom meeting:', error);
      res.status(500).json({ message: error.message || "Failed to create Zoom meeting" });
    }
  });

  // Clone Session endpoint
  app.post("/api/sessions/:id/clone", authenticateToken, requireRole('admin'), async (req, res) => {
    try {
      const { scheduledAt } = req.body;
      if (!scheduledAt) {
        return res.status(400).json({ message: "scheduledAt is required" });
      }

      // Get original session
      const originalSession = await storage.getSession(req.params.id);
      if (!originalSession) {
        return res.status(404).json({ message: "Session not found" });
      }

      // Create cloned session with new scheduled time
      const clonedSession = await storage.createSession({
        title: originalSession.title,
        description: originalSession.description,
        sessionType: originalSession.sessionType,
        packagePlan: originalSession.packagePlan,
        scheduledAt: new Date(scheduledAt),
        duration: originalSession.duration,
        maxCapacity: originalSession.maxCapacity,
        currentCapacity: 0,
        status: 'upcoming',
        trainerId: originalSession.trainerId,
      });

      res.json({
        message: "Session cloned successfully",
        session: clonedSession,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/sessions/:id", async (req, res) => {
    try {
      const success = await storage.deleteSession(req.params.id);
      if (!success) {
        return res.status(404).json({ message: "Session not found" });
      }
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Session Client routes
  app.post("/api/sessions/:sessionId/clients/:clientId", async (req, res) => {
    try {
      const assignment = await storage.assignClientToSession(req.params.sessionId, req.params.clientId);
      res.json(assignment);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/sessions/:sessionId/clients/:clientId", async (req, res) => {
    try {
      const success = await storage.removeClientFromSession(req.params.sessionId, req.params.clientId);
      if (!success) {
        return res.status(404).json({ message: "Session client assignment not found" });
      }
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/sessions/:sessionId/clients", async (req, res) => {
    try {
      const clients = await storage.getSessionClients(req.params.sessionId);
      res.json(clients);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get session assignments (trainer + clients)
  app.get("/api/sessions/:sessionId/assignments", async (req, res) => {
    try {
      const session = await storage.getSession(req.params.sessionId);
      if (!session) {
        return res.status(404).json({ message: "Session not found" });
      }
      
      const clients = await storage.getSessionClients(req.params.sessionId);
      
      res.json({
        trainerId: session.trainerId?.toString() || null,
        trainerName: session.trainerName || null,
        clients: clients.map((c: any) => c._id.toString()),
        clientCount: clients.length
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Advanced Session Management routes
  app.get("/api/sessions/calendar/:start/:end", async (req, res) => {
    try {
      const startDate = new Date(req.params.start);
      const endDate = new Date(req.params.end);
      const sessions = await storage.getSessionsByDateRange(startDate, endDate);
      res.json(sessions);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/sessions/:id/cancel", async (req, res) => {
    try {
      const session = await storage.cancelSession(req.params.id);
      if (!session) {
        return res.status(404).json({ message: "Session not found" });
      }
      res.json(session);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Session Assignment route
  app.post("/api/sessions/:id/assign", authenticateToken, requireRole('admin', 'trainer'), async (req, res) => {
    try {
      const { clientIds } = req.body;
      if (!Array.isArray(clientIds) || clientIds.length === 0) {
        return res.status(400).json({ message: "clientIds must be a non-empty array" });
      }
      
      // Get session to verify it exists
      const session = await storage.getSession(req.params.id);
      if (!session) {
        return res.status(404).json({ message: "Session not found" });
      }
      
      // Basic validation: check if clients exist
      const validationErrors: string[] = [];
      for (const clientId of clientIds) {
        const client = await storage.getClient(clientId);
        if (!client) {
          validationErrors.push(`Client ${clientId} not found`);
          continue;
        }
        
        // Check if client is already assigned to any other session
        const existingSessions = await storage.getClientSessions(clientId);
        if (existingSessions.some((s: any) => s._id.toString() !== session._id.toString())) {
          validationErrors.push(`Client ${client.name} is already assigned to another session`);
          continue;
        }
      }
      
      if (validationErrors.length > 0) {
        return res.status(400).json({ 
          message: "Some clients cannot be assigned",
          errors: validationErrors 
        });
      }
      
      // Assign clients to session (this now handles trainerId persistence internally)
      const result = await storage.assignSessionToClients(req.params.id, clientIds);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Assign Trainer to Session
  app.post("/api/sessions/:id/assign-trainer", authenticateToken, requireRole('admin'), async (req, res) => {
    try {
      const { trainerId } = req.body;
      if (!trainerId) {
        return res.status(400).json({ message: "trainerId is required" });
      }
      
      const session = await storage.updateSession(req.params.id, { trainerId });
      if (!session) {
        return res.status(404).json({ message: "Session not found" });
      }
      
      res.json(session);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get current session assignments
  app.get("/api/sessions/:id/assignments", authenticateToken, async (req, res) => {
    try {
      const session = await storage.getSession(req.params.id);
      if (!session) {
        return res.status(404).json({ message: "Session not found" });
      }
      
      const assignedClients = await storage.getSessionClients(req.params.id);
      res.json({
        trainerId: session.trainerId,
        clients: assignedClients.map((c: any) => c._id)
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/sessions/recurring", async (req, res) => {
    try {
      const { baseData, pattern, days, endDate } = req.body;
      const sessions = await storage.createRecurringSessions(
        baseData,
        pattern,
        days,
        new Date(endDate)
      );
      res.json(sessions);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/sessions/:id/book", async (req, res) => {
    try {
      const { clientId } = req.body;
      const result = await storage.bookSessionSpot(req.params.id, clientId);
      
      if (!result.success) {
        return res.status(400).json({ message: result.message });
      }
      
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Session Waitlist routes
  app.post("/api/sessions/:id/waitlist", async (req, res) => {
    try {
      const { clientId } = req.body;
      const result = await storage.addToWaitlist(req.params.id, clientId);
      
      if (!result.success) {
        return res.status(400).json({ message: result.message });
      }
      
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/sessions/:id/waitlist/:clientId", async (req, res) => {
    try {
      const success = await storage.removeFromWaitlist(req.params.id, req.params.clientId);
      if (!success) {
        return res.status(404).json({ message: "Waitlist entry not found" });
      }
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/sessions/:id/waitlist", async (req, res) => {
    try {
      const waitlist = await storage.getSessionWaitlist(req.params.id);
      res.json(waitlist);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get client waitlist (owner or admin only)
  app.get("/api/clients/:id/waitlist", authenticateToken, requireOwnershipOrAdmin, async (req, res) => {
    try {
      const waitlist = await storage.getClientWaitlist(req.params.id);
      res.json(waitlist);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Comprehensive seed endpoint for demo data
  app.post("/api/seed-demo-data", async (_req, res) => {
    try {
      const demoClient = await storage.getClientByPhone("8600126395");
      if (!demoClient) {
        return res.status(404).json({ message: "Demo client not found. Run /api/init first." });
      }

      const packages = await storage.getAllPackages();
      const premiumPackage = packages.find(p => p.name === "Premium");
      
      // Check if videos exist
      const existingVideos = await storage.getAllVideos();
      if (existingVideos.length === 0) {
        // Create sample videos
        const videos = [
          { title: "Full Body Strength Training", category: "Strength", duration: 45, url: "https://example.com/video1", description: "Complete full body workout", packageRequirement: premiumPackage?._id?.toString() },
          { title: "Morning Yoga Flow", category: "Yoga", duration: 30, url: "https://example.com/video2", description: "Energizing morning yoga", packageRequirement: premiumPackage?._id?.toString() },
          { title: "HIIT Cardio Blast", category: "Cardio", duration: 25, url: "https://example.com/video3", description: "High intensity cardio", packageRequirement: premiumPackage?._id?.toString() },
          { title: "Upper Body Power", category: "Strength", duration: 40, url: "https://example.com/video4", description: "Focus on upper body", packageRequirement: premiumPackage?._id?.toString() },
          { title: "Flexibility & Stretching", category: "Yoga", duration: 20, url: "https://example.com/video5", description: "Improve flexibility", packageRequirement: premiumPackage?._id?.toString() },
          { title: "Advanced HIIT Circuit", category: "HIIT", duration: 35, url: "https://example.com/video6", description: "Advanced HIIT training", packageRequirement: premiumPackage?._id?.toString() },
          { title: "Core Strength Builder", category: "Strength", duration: 30, url: "https://example.com/video7", description: "Build core strength", packageRequirement: premiumPackage?._id?.toString() },
          { title: "Evening Relaxation Yoga", category: "Yoga", duration: 25, url: "https://example.com/video8", description: "Wind down yoga session", packageRequirement: premiumPackage?._id?.toString() },
          { title: "Beginner Cardio Workout", category: "Cardio", duration: 20, url: "https://example.com/video9", description: "Cardio for beginners", packageRequirement: premiumPackage?._id?.toString() },
        ];
        
        for (const video of videos) {
          await storage.createVideo(video);
        }
      }

      // Check if sessions exist
      const existingSessions = await storage.getAllSessions();
      if (existingSessions.length === 0) {
        // Create sample live sessions
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const dayAfter = new Date(now);
        dayAfter.setDate(dayAfter.getDate() + 2);
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        
        const sessions = [
          { 
            title: "Power Yoga Session", 
            description: "Energizing yoga flow for all levels", 
            sessionType: "Power Yoga",
            scheduledAt: tomorrow, 
            duration: 60, 
            trainerName: "Sarah Johnson",
            maxCapacity: 15,
            currentCapacity: 0,
            status: "upcoming", 
            isRecurring: false,
            meetingLink: "https://meet.example.com/yoga1" 
          },
          { 
            title: "HIIT Training", 
            description: "High intensity interval training", 
            sessionType: "HIIT",
            scheduledAt: dayAfter, 
            duration: 45, 
            trainerName: "Mike Chen",
            maxCapacity: 12,
            currentCapacity: 0,
            status: "upcoming", 
            isRecurring: false,
            meetingLink: "https://meet.example.com/hiit1" 
          },
          { 
            title: "Strength Building", 
            description: "Full body strength workout", 
            sessionType: "Strength Building",
            scheduledAt: yesterday, 
            duration: 50, 
            trainerName: "Alex Rivera",
            maxCapacity: 15,
            currentCapacity: 0,
            status: "completed", 
            isRecurring: false,
            meetingLink: "https://meet.example.com/strength1" 
          },
          { 
            title: "Cardio Bootcamp", 
            description: "Morning cardio session", 
            sessionType: "Cardio Bootcamp",
            scheduledAt: tomorrow, 
            duration: 40, 
            trainerName: "Sarah Johnson",
            maxCapacity: 20,
            currentCapacity: 0,
            status: "upcoming", 
            isRecurring: false,
            meetingLink: "https://meet.example.com/cardio1" 
          },
        ];
        
        for (const session of sessions) {
          await storage.createSession(session);
        }
      }

      // Check if demo client has diet plan
      const clientId = (demoClient as any)._id.toString();
      const existingDietPlans = await storage.getClientDietPlans(clientId);
      if (existingDietPlans.length === 0) {
        await storage.createDietPlan({
          clientId,
          name: "Balanced Nutrition Plan",
          targetCalories: 2200,
          protein: 150,
          carbs: 220,
          fats: 70,
          meals: {
            breakfast: { name: "Oatmeal with Berries", calories: 450, protein: 15, carbs: 65, fats: 12 },
            lunch: { name: "Grilled Chicken Salad", calories: 550, protein: 45, carbs: 40, fats: 18 },
            snack: { name: "Greek Yogurt & Almonds", calories: 300, protein: 20, carbs: 25, fats: 15 },
            dinner: { name: "Salmon with Quinoa", calories: 650, protein: 50, carbs: 55, fats: 20 }
          }
        });
      }

      // Check if demo client has workout plan
      const existingWorkoutPlans = await storage.getClientWorkoutPlans(clientId);
      if (existingWorkoutPlans.length === 0) {
        await storage.createWorkoutPlan({
          clientId,
          name: "4-Week Strength & Conditioning",
          description: "Build strength and improve conditioning",
          goal: "Build Muscle",
          durationWeeks: 4,
          exercises: {
            monday: [
              { name: "Barbell Squat", sets: 4, reps: 8, rest: "2min" },
              { name: "Bench Press", sets: 4, reps: 8, rest: "2min" },
              { name: "Bent-Over Rows", sets: 3, reps: 10, rest: "90s" }
            ],
            wednesday: [
              { name: "Deadlift", sets: 4, reps: 6, rest: "3min" },
              { name: "Overhead Press", sets: 3, reps: 8, rest: "2min" },
              { name: "Pull-ups", sets: 3, reps: "max", rest: "90s" }
            ],
            friday: [
              { name: "Leg Press", sets: 4, reps: 12, rest: "90s" },
              { name: "Dumbbell Bench", sets: 3, reps: 10, rest: "90s" },
              { name: "Cable Rows", sets: 3, reps: 12, rest: "90s" }
            ]
          }
        });
      }

      // Seed workout sessions for the demo client
      const existingWorkoutSessions = await storage.getClientWorkoutSessions(clientId);
      if (existingWorkoutSessions.length === 0) {
        const workoutSessionsData = [
          {
            clientId,
            workoutName: "Morning Strength Training",
            duration: 45,
            caloriesBurned: 350,
            completedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
            exercises: { squats: "4x8", benchPress: "4x8", rows: "3x10" }
          },
          {
            clientId,
            workoutName: "Evening Cardio",
            duration: 30,
            caloriesBurned: 280,
            completedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
            exercises: { running: "20min", cycling: "10min" }
          },
          {
            clientId,
            workoutName: "Full Body Workout",
            duration: 60,
            caloriesBurned: 450,
            completedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
            exercises: { deadlifts: "4x6", overhead: "3x8", pullups: "3xMax" }
          },
          {
            clientId,
            workoutName: "HIIT Session",
            duration: 25,
            caloriesBurned: 320,
            completedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
            exercises: { burpees: "4x10", jumpSquats: "4x12", mountainClimbers: "4x20" }
          },
          {
            clientId,
            workoutName: "Upper Body Focus",
            duration: 50,
            caloriesBurned: 380,
            completedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
            exercises: { benchPress: "5x5", rows: "4x8", curls: "3x12" }
          },
          {
            clientId,
            workoutName: "Leg Day",
            duration: 55,
            caloriesBurned: 420,
            completedAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000),
            exercises: { squats: "5x5", legPress: "4x12", lunges: "3x10" }
          },
          {
            clientId,
            workoutName: "Core & Conditioning",
            duration: 35,
            caloriesBurned: 250,
            completedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
            exercises: { planks: "3x60s", crunches: "3x20", russian: "3x15" }
          },
        ];

        for (const sessionData of workoutSessionsData) {
          await storage.createWorkoutSession(sessionData);
        }

        await storage.createAchievement({
          clientId,
          type: 'first_workout',
          title: 'First Workout Complete',
          description: 'Completed your very first workout session',
        });

        await storage.createAchievement({
          clientId,
          type: 'streak_week',
          title: 'Week Streak Champion',
          description: 'Maintained a 7-day workout streak',
        });
      }

      res.json({ message: "Demo data seeded successfully" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Dashboard routes
  app.get("/api/dashboard/:clientId", async (req, res) => {
    try {
      const { clientId } = req.params;
      
      const [client, stats, achievements, sessions, metrics, workoutPlans, dietPlans] = await Promise.all([
        storage.getClient(clientId),
        storage.getWorkoutSessionStats(clientId),
        storage.getClientAchievements(clientId),
        storage.getClientSessions(clientId),
        storage.getLatestBodyMetrics(clientId),
        storage.getClientWorkoutPlans(clientId),
        storage.getClientDietPlans(clientId),
      ]);
      
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }
      
      const upcomingSessions = sessions
        .filter(s => new Date(s.scheduledAt) > new Date() && s.status === 'scheduled')
        .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
        .slice(0, 3);
      
      const nextSession = upcomingSessions[0] || null;
      
      const initialWeight = metrics?.weight || client.weight || 0;
      const targetWeight = metrics?.idealWeight || 0;
      const currentWeight = metrics?.weight || client.weight || 0;
      const weightProgress = targetWeight ? Math.round(((initialWeight - currentWeight) / (initialWeight - targetWeight)) * 100) : 0;
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const workoutDays = new Set<string>();
      
      for (const session of stats.allSessions) {
        const sessionDate = new Date(session.completedAt);
        sessionDate.setHours(0, 0, 0, 0);
        const dayKey = sessionDate.toISOString().split('T')[0];
        workoutDays.add(dayKey);
      }
      
      const last28Days = [];
      for (let i = 27; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dayKey = date.toISOString().split('T')[0];
        last28Days.push({
          date: dayKey,
          hasWorkout: workoutDays.has(dayKey),
          isToday: i === 0,
        });
      }
      
      res.json({
        client: {
          name: client.name,
          packageName: (client.packageId as any)?.name || 'No Package',
          goal: client.goal || 'General Fitness',
        },
        stats: {
          currentStreak: stats.currentStreak,
          maxStreak: stats.maxStreak,
          totalSessions: stats.totalSessions,
          weekSessions: stats.weekSessions,
          monthSessions: stats.monthSessions,
          totalCalories: stats.totalCalories,
          weekCalories: stats.weekCalories,
        },
        progress: {
          initialWeight,
          currentWeight,
          targetWeight,
          weightProgress: Math.max(0, Math.min(100, weightProgress)),
          weeklyWorkoutCompletion: Math.round((stats.weekSessions / 5) * 100),
          weeklyStats: stats.weeklyStats || [],
        },
        nextSession,
        upcomingSessions,
        recentSessions: stats.recentSessions,
        achievements: achievements.slice(0, 5),
        hasWorkoutPlan: workoutPlans.length > 0,
        hasDietPlan: dietPlans.length > 0,
        calendarData: last28Days,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/workout-sessions/:clientId", async (req, res) => {
    try {
      const sessions = await storage.getClientWorkoutSessions(req.params.clientId);
      res.json(sessions);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/workout-sessions", async (req, res) => {
    try {
      const session = await storage.createWorkoutSession(req.body);
      
      const stats = await storage.getWorkoutSessionStats(req.body.clientId);
      
      if (stats.totalSessions === 1) {
        await storage.createAchievement({
          clientId: req.body.clientId,
          type: 'first_workout',
          title: 'First Workout',
          description: 'Completed your first workout session',
          metadata: { sessionId: session._id },
        });
      }
      
      if (stats.totalSessions === 10) {
        await storage.createAchievement({
          clientId: req.body.clientId,
          type: 'workout_milestone',
          title: '10 Workouts Complete',
          description: 'Completed 10 workout sessions',
          metadata: { sessionId: session._id },
        });
      }
      
      if (stats.currentStreak === 7) {
        await storage.createAchievement({
          clientId: req.body.clientId,
          type: 'streak_week',
          title: 'Week Streak',
          description: '7 day workout streak achieved',
          metadata: { streak: 7 },
        });
      }
      
      if (stats.totalCalories >= 10000) {
        const existingAchievements = await storage.getClientAchievements(req.body.clientId);
        const has10kAchievement = existingAchievements.some(a => a.type === 'calories_10k');
        
        if (!has10kAchievement) {
          await storage.createAchievement({
            clientId: req.body.clientId,
            type: 'calories_10k',
            title: 'Calorie Crusher',
            description: 'Burned 10,000 total calories',
            metadata: { calories: stats.totalCalories },
          });
        }
      }
      
      res.json(session);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get assigned workouts for authenticated client
  app.get("/api/my-workouts", authenticateToken, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      
      const user = await storage.getUserById(req.user.userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Check if user is a client and has clientId
      if (user.role !== 'client' || !user.clientId) {
        return res.status(403).json({ message: "Only clients can access workout plans" });
      }
      
      // Fetch assigned workout plans for this client
      const workoutPlans = await storage.getClientWorkoutPlans(user.clientId.toString());
      res.json(workoutPlans);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/achievements/:clientId", async (req, res) => {
    try {
      const achievements = await storage.getClientAchievements(req.params.clientId);
      res.json(achievements);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Progress Tracking - Weight
  app.get("/api/progress/weight", authenticateToken, async (req, res) => {
    try {
      const clientId = String(req.user?.clientId);
      if (!clientId) {
        return res.status(400).json({ message: "Client ID not found in authentication" });
      }
      
      const history = await storage.getClientWeightHistory(clientId);
      const goal = await storage.getClientWeightGoal(clientId);
      
      res.json({
        current: history[0] || null,
        start: history[history.length - 1]?.weight || history[0]?.weight || 0,
        goal,
        history,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/progress/weight", authenticateToken, async (req, res) => {
    try {
      const clientId = String(req.user?.clientId);
      if (!clientId) {
        return res.status(400).json({ message: "Client ID not found in authentication" });
      }
      
      const { weight, date } = req.body;
      const entry = await storage.createWeightEntry(clientId, weight, date);
      res.json(entry);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/progress/goal", authenticateToken, async (req, res) => {
    try {
      const clientId = String(req.user?.clientId);
      if (!clientId) {
        return res.status(400).json({ message: "Client ID not found in authentication" });
      }
      
      const { goalWeight } = req.body;
      const result = await storage.setClientWeightGoal(clientId, goalWeight);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Progress Tracking - Body Measurements
  app.get("/api/progress/measurements", authenticateToken, async (req, res) => {
    try {
      const clientId = String(req.user?.clientId);
      if (!clientId) {
        return res.status(400).json({ message: "Client ID not found in authentication" });
      }
      
      const history = await storage.getClientBodyMeasurementsHistory(clientId);
      
      res.json({
        current: history[0] || {},
        previous: history[1] || {},
        history,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/progress/measurements", authenticateToken, async (req, res) => {
    try {
      const clientId = String(req.user?.clientId);
      if (!clientId) {
        return res.status(400).json({ message: "Client ID not found in authentication" });
      }
      
      const { date, ...measurements } = req.body;
      const entry = await storage.createBodyMeasurement(clientId, measurements, date);
      res.json(entry);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Progress Tracking - Personal Records
  app.get("/api/progress/records", authenticateToken, async (req, res) => {
    try {
      const clientId = String(req.user?.clientId);
      if (!clientId) {
        return res.status(400).json({ message: "Client ID not found in authentication" });
      }
      
      const records = await storage.getClientPersonalRecords(clientId);
      res.json({ records });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/progress/records", authenticateToken, async (req, res) => {
    try {
      const clientId = String(req.user?.clientId);
      if (!clientId) {
        return res.status(400).json({ message: "Client ID not found in authentication" });
      }
      
      const { category, value, date } = req.body;
      const record = await storage.createPersonalRecord(clientId, category, value, date);
      res.json(record);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Progress Tracking - Weekly Completion
  app.get("/api/progress/weekly-completion", authenticateToken, async (req, res) => {
    try {
      const clientId = String(req.user?.clientId);
      if (!clientId) {
        return res.status(400).json({ message: "Client ID not found in authentication" });
      }
      
      const current = await storage.getClientWeeklyCompletion(clientId);
      const history = await storage.getWeeklyCompletionHistory(clientId);
      res.json({ ...current, history });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Progress Tracking - Achievements (Stats for UI)
  app.get("/api/progress/achievements", authenticateToken, async (req, res) => {
    try {
      const clientId = String(req.user?.clientId);
      if (!clientId) {
        return res.status(400).json({ message: "Client ID not found in authentication" });
      }
      
      // Query WorkoutPlan collection for this client
      const clientIdObj = new mongoose.Types.ObjectId(clientId);
      const workoutPlans = await WorkoutPlan.find({ clientId: clientIdObj }).lean();
      
      // Count completed and assigned workouts
      let completedWorkouts = 0;
      let assignedWorkouts = 0;
      let firstAssignmentDate: Date | null = null;
      
      for (const plan of workoutPlans) {
        if (plan.weeks && Array.isArray(plan.weeks)) {
          for (const week of plan.weeks) {
            if (week.workouts && Array.isArray(week.workouts)) {
              for (const workout of week.workouts) {
                assignedWorkouts++;
                if (workout.completed === true) {
                  completedWorkouts++;
                }
                // Track first assignment date
                if (!firstAssignmentDate && plan.createdAt) {
                  firstAssignmentDate = new Date(plan.createdAt);
                }
              }
            }
          }
        }
      }
      
      // Calculate compliance percentage
      const workoutCompliancePercent = assignedWorkouts > 0 
        ? Math.round((completedWorkouts / assignedWorkouts) * 100)
        : 0;
      
      // Calculate days in program
      let daysInProgram = 0;
      if (firstAssignmentDate) {
        const now = new Date();
        const timeDiff = now.getTime() - firstAssignmentDate.getTime();
        daysInProgram = Math.floor(timeDiff / (1000 * 3600 * 24));
      }
      
      // Check if weight goal is reached
      const weightHistory = await storage.getClientWeightHistory(clientId);
      const goal = await storage.getClientWeightGoal(clientId);
      const currentWeight = weightHistory[0]?.weight || 0;
      const goalReached = goal > 0 && currentWeight === goal;
      
      res.json({
        stats: {
          completedWorkouts,
          assignedWorkouts,
          workoutCompliancePercent,
          goalReached: goalReached || false,
          daysInProgram,
        },
        unlocked: [],
      });
    } catch (error: any) {
      console.error('Error fetching achievements:', error);
      res.status(500).json({ message: error.message });
    }
  });

  // Progress Tracking - Monthly Reports
  app.get("/api/progress/monthly-reports", authenticateToken, async (req, res) => {
    try {
      const clientId = req.user?.clientId;
      if (!clientId) {
        return res.status(400).json({ message: "Client ID not found in authentication" });
      }
      
      const sessions = await storage.getClientWorkoutSessions(clientId);
      const achievements = await storage.getClientAchievements(clientId);
      const weightHistory = await storage.getClientWeightHistory(clientId);
      const weeklyCompletion = await storage.getClientWeeklyCompletion(clientId);
      
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthSessions = sessions.filter((s: any) => new Date(s.date) >= monthStart);
      
      const weightChange = weightHistory.length >= 2 
        ? (weightHistory[0].weight - weightHistory[weightHistory.length - 1].weight).toFixed(1)
        : null;
      
      res.json({
        current: {
          monthYear: now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
          totalWorkouts: monthSessions.length,
          weightChange,
          achievements: achievements.filter((a: any) => 
            new Date(a.unlockedAt || a.createdAt) >= monthStart
          ).length,
          weeklyCompletion: weeklyCompletion.plannedWorkouts > 0
            ? Math.round((weeklyCompletion.completedWorkouts / weeklyCompletion.plannedWorkouts) * 100)
            : 0,
          highlights: [
            `Completed ${monthSessions.length} workout sessions`,
            weightChange ? `Weight ${parseFloat(weightChange) < 0 ? 'lost' : 'gained'} ${Math.abs(parseFloat(weightChange))} kg` : 'No weight change tracked',
          ],
        },
        history: [],
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Goal routes
  app.get("/api/goals", authenticateToken, async (req, res) => {
    try {
      const clientId = req.user?.clientId;
      if (!clientId) {
        return res.status(400).json({ message: "Client ID not found in authentication" });
      }
      
      const goals = await storage.getClientGoals(clientId);
      res.json(goals);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/goals/:id", async (req, res) => {
    try {
      const goal = await storage.getGoal(req.params.id);
      if (!goal) {
        return res.status(404).json({ message: "Goal not found" });
      }
      res.json(goal);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/goals", async (req, res) => {
    try {
      const goal = await storage.createGoal(req.body);
      res.json(goal);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/goals/:id", async (req, res) => {
    try {
      const goal = await storage.updateGoal(req.params.id, req.body);
      if (!goal) {
        return res.status(404).json({ message: "Goal not found" });
      }
      res.json(goal);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/goals/:id", async (req, res) => {
    try {
      const success = await storage.deleteGoal(req.params.id);
      if (!success) {
        return res.status(404).json({ message: "Goal not found" });
      }
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/goals/:id/progress", async (req, res) => {
    try {
      const { currentValue } = req.body;
      if (currentValue === undefined) {
        return res.status(400).json({ message: "Current value is required" });
      }
      const goal = await storage.updateGoalProgress(req.params.id, currentValue);
      if (!goal) {
        return res.status(404).json({ message: "Goal not found" });
      }
      res.json(goal);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Communication - Messages Routes
  app.get("/api/messages/conversations/:clientId", async (req, res) => {
    try {
      const conversations = await storage.getClientConversations(req.params.clientId);
      res.json(conversations);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/messages/:conversationId", async (req, res) => {
    try {
      const messages = await storage.getConversationMessages(req.params.conversationId);
      res.json(messages);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/messages", async (req, res) => {
    try {
      const message = await storage.sendMessage(req.body);
      res.json(message);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/messages/:id/read", async (req, res) => {
    try {
      const message = await storage.markMessageAsRead(req.params.id);
      if (!message) {
        return res.status(404).json({ message: "Message not found" });
      }
      res.json(message);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/messages/unread/:userId", async (req, res) => {
    try {
      const count = await storage.getUnreadMessageCount(req.params.userId);
      res.json({ count });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Communication - Tickets Routes
  app.get("/api/tickets/client/:clientId", async (req, res) => {
    try {
      const tickets = await storage.getClientTickets(req.params.clientId);
      res.json(tickets);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/tickets/:ticketNumber", async (req, res) => {
    try {
      const ticket = await storage.getTicket(req.params.ticketNumber);
      if (!ticket) {
        return res.status(404).json({ message: "Ticket not found" });
      }
      res.json(ticket);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/tickets", async (req, res) => {
    try {
      const ticket = await storage.createTicket(req.body);
      res.json(ticket);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/tickets/:ticketNumber/responses", async (req, res) => {
    try {
      const ticket = await storage.addTicketResponse(req.params.ticketNumber, req.body);
      if (!ticket) {
        return res.status(404).json({ message: "Ticket not found" });
      }
      res.json(ticket);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/tickets/:ticketNumber/status", async (req, res) => {
    try {
      const { status } = req.body;
      if (!status) {
        return res.status(400).json({ message: "Status is required" });
      }
      const ticket = await storage.updateTicketStatus(req.params.ticketNumber, status);
      if (!ticket) {
        return res.status(404).json({ message: "Ticket not found" });
      }
      res.json(ticket);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Communication - Announcements Routes
  app.get("/api/announcements", async (req, res) => {
    try {
      const targetAudience = req.query.targetAudience as string | undefined;
      const announcements = await storage.getAllAnnouncements(targetAudience);
      res.json(announcements);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/announcements/:id", async (req, res) => {
    try {
      const announcement = await storage.getAnnouncement(req.params.id);
      if (!announcement) {
        return res.status(404).json({ message: "Announcement not found" });
      }
      res.json(announcement);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/announcements", async (req, res) => {
    try {
      const announcement = await storage.createAnnouncement(req.body);
      res.json(announcement);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Communication - Forum Routes
  app.get("/api/forum/topics", async (req, res) => {
    try {
      const category = req.query.category as string | undefined;
      const topics = await storage.getAllForumTopics(category);
      res.json(topics);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/forum/topics/:id", async (req, res) => {
    try {
      const topic = await storage.getForumTopic(req.params.id);
      if (!topic) {
        return res.status(404).json({ message: "Topic not found" });
      }
      res.json(topic);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/forum/topics", async (req, res) => {
    try {
      const topic = await storage.createForumTopic(req.body);
      res.json(topic);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/forum/topics/:id/replies", async (req, res) => {
    try {
      const topic = await storage.addForumReply(req.params.id, req.body);
      if (!topic) {
        return res.status(404).json({ message: "Topic not found" });
      }
      res.json(topic);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/forum/topics/:id/views", async (req, res) => {
    try {
      await storage.incrementTopicViews(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/forum/topics/:id/like", async (req, res) => {
    try {
      const { increment } = req.body;
      const topic = await storage.toggleTopicLike(req.params.id, increment);
      if (!topic) {
        return res.status(404).json({ message: "Topic not found" });
      }
      res.json(topic);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Admin Analytics routes
  app.get("/api/analytics/monthly-trends", async (_req, res) => {
    try {
      const clients = await storage.getAllClients();
      const packages = await storage.getAllPackages();

      // Get last 6 months
      const now = new Date();
      const monthsData = [];
      
      for (let i = 5; i >= 0; i--) {
        const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const nextMonthDate = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
        const monthName = monthDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

        // Calculate prorated revenue for this month using helper function
        const monthRevenue = calculateMonthlyRevenue(clients, packages, monthDate);

        // Count new clients in this specific month
        const newClients = clients.filter(c => {
          const createdDate = new Date(c.createdAt);
          return createdDate >= monthDate && createdDate < nextMonthDate;
        }).length;

        // Count clients created up to this month
        const clientsUpToMonth = clients.filter(c => 
          new Date(c.createdAt) < nextMonthDate
        ).length;

        monthsData.push({
          month: monthName,
          revenue: Math.round(monthRevenue),
          clients: clientsUpToMonth,
          newClients: newClients
        });
      }

      res.json(monthsData);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/analytics/growth-metrics", async (_req, res) => {
    try {
      const clients = await storage.getAllClients();
      const packages = await storage.getAllPackages();

      // Calculate this month vs last month
      const now = new Date();
      const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 1);

      const thisMonthClients = clients.filter(c => 
        new Date(c.createdAt) >= thisMonthStart
      ).length;

      const lastMonthClients = clients.filter(c => {
        const createdDate = new Date(c.createdAt);
        return createdDate >= lastMonthStart && createdDate < thisMonthStart;
      }).length;

      const twoMonthsAgoClients = clients.filter(c => {
        const createdDate = new Date(c.createdAt);
        return createdDate >= twoMonthsAgo && createdDate < lastMonthStart;
      }).length;

      // Calculate growth rate
      const growthRate = lastMonthClients > 0 
        ? Math.round(((thisMonthClients - lastMonthClients) / lastMonthClients) * 100)
        : 100;

      const lastMonthGrowthRate = twoMonthsAgoClients > 0
        ? Math.round(((lastMonthClients - twoMonthsAgoClients) / twoMonthsAgoClients) * 100)
        : 100;

      // Package breakdown (exclude archived packages)
      const activePackages = packages.filter((pkg: any) => pkg.status !== 'archived');
      
      const packageById = activePackages.reduce((map: Record<string, any>, pkg: any) => {
        map[pkg._id.toString()] = pkg;
        return map;
      }, {});

      const packageStats = activePackages.map((pkg: any) => {
        const count = clients.filter((c: any) => {
          const packageId = typeof c.packageId === 'object' ? c.packageId._id : c.packageId;
          return packageId?.toString() === pkg._id.toString();
        }).length;
        return {
          name: pkg.name,
          count,
          percentage: clients.length > 0 ? Math.round((count / clients.length) * 100) : 0
        };
      }).filter((stat: any) => stat.count > 0);

      res.json({
        thisMonth: thisMonthClients,
        lastMonth: lastMonthClients,
        growthRate,
        lastMonthGrowthRate,
        totalClients: clients.length,
        packageStats
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/analytics/client-timeline", async (_req, res) => {
    try {
      const clients = await storage.getAllClients();
      
      // Group clients by month for the last 6 months
      const now = new Date();
      const timeline = [];
      
      for (let i = 5; i >= 0; i--) {
        const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const nextMonthDate = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
        const monthName = monthDate.toLocaleDateString('en-US', { month: 'short' });

        const newClients = clients.filter(c => {
          const createdDate = new Date(c.createdAt);
          return createdDate >= monthDate && createdDate < nextMonthDate;
        }).length;

        const totalClients = clients.filter(c => 
          new Date(c.createdAt) < nextMonthDate
        ).length;

        timeline.push({
          month: monthName,
          newClients,
          totalClients
        });
      }

      res.json(timeline);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get('/api/admin/analytics/client-stats', async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      const clients = await storage.getAllClients();
      
      const start = startDate ? new Date(startDate as string) : new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
      const end = endDate ? new Date(endDate as string) : new Date();

      const totalClients = clients.length;
      const activeClients = clients.filter((c: any) => c.status === 'active').length;
      const inactiveClients = clients.filter((c: any) => c.status === 'inactive').length;
      const pendingClients = clients.filter((c: any) => c.status === 'pending').length;

      const filteredClients = clients.filter((c: any) => {
        const createdDate = new Date(c.createdAt);
        return createdDate >= start && createdDate <= end;
      });

      const growthData = [];
      const currentDate = new Date(start);
      while (currentDate <= end) {
        const monthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        const monthEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
        
        const newClients = clients.filter((c: any) => {
          const created = new Date(c.createdAt);
          return created >= monthStart && created <= monthEnd;
        }).length;

        growthData.push({
          month: monthStart.toISOString().slice(0, 7),
          newClients,
          totalClients: clients.filter((c: any) => new Date(c.createdAt) <= monthEnd).length
        });

        currentDate.setMonth(currentDate.getMonth() + 1);
      }

      res.json({
        totalClients,
        activeClients,
        inactiveClients,
        pendingClients,
        newClientsInPeriod: filteredClients.length,
        growthData
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get('/api/admin/analytics/video-performance', async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      const videos = await storage.getAllVideos();
      const videoProgress = await VideoProgress.find();

      const start = startDate ? new Date(startDate as string) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const end = endDate ? new Date(endDate as string) : new Date();

      const videoStats = videos.map((video: any) => {
        const progressRecords = videoProgress.filter((vp: any) => {
          const vpDate = new Date(vp.lastWatchedAt || vp.createdAt);
          return vp.videoId?.toString() === video._id.toString() && vpDate >= start && vpDate <= end;
        });

        const views = progressRecords.length;
        const completions = progressRecords.filter((vp: any) => vp.completed).length;
        const completionRate = views > 0 ? Math.round((completions / views) * 100) : 0;
        const totalWatchTime = progressRecords.reduce((sum: number, vp: any) => sum + (vp.watchDuration || 0), 0);
        const avgWatchTime = views > 0 ? Math.round(totalWatchTime / views) : 0;

        return {
          id: video._id,
          title: video.title,
          category: video.category,
          duration: video.duration,
          views,
          completions,
          completionRate,
          avgWatchTime
        };
      });

      videoStats.sort((a, b) => b.views - a.views);

      res.json({
        totalVideos: videos.length,
        totalViews: videoStats.reduce((sum, v) => sum + v.views, 0),
        totalCompletions: videoStats.reduce((sum, v) => sum + v.completions, 0),
        avgCompletionRate: videoStats.length > 0 
          ? Math.round(videoStats.reduce((sum, v) => sum + v.completionRate, 0) / videoStats.length) 
          : 0,
        topVideos: videoStats.slice(0, 10)
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get('/api/admin/analytics/session-attendance', async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      const start = startDate ? new Date(startDate as string) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const end = endDate ? new Date(endDate as string) : new Date();

      const sessions = await storage.getAllSessions();
      const filteredSessions = sessions.filter((s: any) => {
        const scheduledDate = new Date(s.scheduledAt);
        return scheduledDate >= start && scheduledDate <= end;
      });

      const sessionStats = await Promise.all(filteredSessions.map(async (session: any) => {
        const sessionClients = await storage.getSessionClients(session._id);
        const bookedCount = sessionClients.length;
        const attendedCount = sessionClients.filter((sc: any) => sc.attended).length;
        const attendanceRate = bookedCount > 0 ? Math.round((attendedCount / bookedCount) * 100) : 0;

        return {
          id: session._id,
          title: session.title,
          sessionType: session.sessionType,
          scheduledAt: session.scheduledAt,
          trainerName: session.trainerName,
          maxCapacity: session.maxCapacity,
          bookedCount,
          attendedCount,
          attendanceRate,
          status: session.status
        };
      }));

      const totalSessions = filteredSessions.length;
      const completedSessions = filteredSessions.filter((s: any) => s.status === 'completed').length;
      const totalBooked = sessionStats.reduce((sum: number, s: any) => sum + s.bookedCount, 0);
      const totalAttended = sessionStats.reduce((sum: number, s: any) => sum + s.attendedCount, 0);
      const avgAttendanceRate = totalBooked > 0 ? Math.round((totalAttended / totalBooked) * 100) : 0;

      res.json({
        totalSessions,
        completedSessions,
        totalBooked,
        totalAttended,
        avgAttendanceRate,
        sessionDetails: sessionStats.sort((a: any, b: any) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime())
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get('/api/admin/analytics/revenue', async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      const start = startDate ? new Date(startDate as string) : new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
      const end = endDate ? new Date(endDate as string) : new Date();

      const payments = await PaymentHistory.find({
        createdAt: { $gte: start, $lte: end }
      }).populate('clientId packageId');

      const totalRevenue = payments.reduce((sum, p: any) => sum + parseFloat(p.amount || 0), 0);
      const paidRevenue = payments.filter((p: any) => p.status === 'paid').reduce((sum, p: any) => sum + parseFloat(p.amount || 0), 0);
      const pendingRevenue = payments.filter((p: any) => p.status === 'pending').reduce((sum, p: any) => sum + parseFloat(p.amount || 0), 0);
      const overdueRevenue = payments.filter((p: any) => p.status === 'overdue').reduce((sum, p: any) => sum + parseFloat(p.amount || 0), 0);

      const monthlyRevenue = [];
      const currentDate = new Date(start);
      while (currentDate <= end) {
        const monthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        const monthEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
        
        const monthPayments = payments.filter((p: any) => {
          const pDate = new Date(p.createdAt);
          return pDate >= monthStart && pDate <= monthEnd && p.status === 'paid';
        });

        monthlyRevenue.push({
          month: monthStart.toISOString().slice(0, 7),
          revenue: monthPayments.reduce((sum, p: any) => sum + parseFloat(p.amount || 0), 0),
          count: monthPayments.length
        });

        currentDate.setMonth(currentDate.getMonth() + 1);
      }

      const packages = await storage.getAllPackages();
      const revenueByPackage = packages.map((pkg: any) => {
        const pkgPayments = payments.filter((p: any) => 
          p.packageId?._id?.toString() === pkg._id.toString() && p.status === 'paid'
        );
        return {
          packageName: pkg.name,
          revenue: pkgPayments.reduce((sum, p: any) => sum + parseFloat(p.amount || 0), 0),
          count: pkgPayments.length
        };
      });

      res.json({
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        paidRevenue: Math.round(paidRevenue * 100) / 100,
        pendingRevenue: Math.round(pendingRevenue * 100) / 100,
        overdueRevenue: Math.round(overdueRevenue * 100) / 100,
        totalPayments: payments.length,
        monthlyRevenue,
        revenueByPackage
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get('/api/admin/analytics/retention', async (req, res) => {
    try {
      const clients = await storage.getAllClients();
      const now = new Date();
      
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
      const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

      const activeClients = clients.filter((c: any) => c.status === 'active').length;
      const inactiveClients = clients.filter((c: any) => c.status === 'inactive').length;

      const clientsCreated30DaysAgo = clients.filter((c: any) => 
        new Date(c.createdAt) >= sixtyDaysAgo && new Date(c.createdAt) < thirtyDaysAgo
      );
      
      const stillActive30Days = clientsCreated30DaysAgo.filter((c: any) => c.status === 'active').length;
      const retention30Days = clientsCreated30DaysAgo.length > 0 
        ? Math.round((stillActive30Days / clientsCreated30DaysAgo.length) * 100) 
        : 0;

      const clientsCreated90DaysAgo = clients.filter((c: any) => 
        new Date(c.createdAt) < ninetyDaysAgo
      );
      
      const stillActive90Days = clientsCreated90DaysAgo.filter((c: any) => c.status === 'active').length;
      const retention90Days = clientsCreated90DaysAgo.length > 0 
        ? Math.round((stillActive90Days / clientsCreated90DaysAgo.length) * 100) 
        : 0;

      const churnRate = clients.length > 0 
        ? Math.round((inactiveClients / clients.length) * 100) 
        : 0;

      const packages = await storage.getAllPackages();
      const retentionByPackage = packages.map((pkg: any) => {
        const pkgClients = clients.filter((c: any) => c.packageId?.toString() === pkg._id.toString());
        const pkgActive = pkgClients.filter((c: any) => c.status === 'active').length;
        return {
          packageName: pkg.name,
          totalClients: pkgClients.length,
          activeClients: pkgActive,
          retentionRate: pkgClients.length > 0 ? Math.round((pkgActive / pkgClients.length) * 100) : 0
        };
      });

      res.json({
        totalClients: clients.length,
        activeClients,
        inactiveClients,
        retention30Days,
        retention90Days,
        churnRate,
        retentionByPackage
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get('/api/admin/analytics/peak-usage', async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      const start = startDate ? new Date(startDate as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const end = endDate ? new Date(endDate as string) : new Date();

      const sessions = await storage.getAllSessions();
      const videoProgress = await VideoProgress.find();

      const activity = [
        ...sessions.map((s: any) => ({ timestamp: new Date(s.scheduledAt), type: 'session' })),
        ...videoProgress.map((vp: any) => ({ timestamp: new Date(vp.lastWatchedAt || vp.createdAt), type: 'video' }))
      ].filter((a: any) => a.timestamp >= start && a.timestamp <= end);

      const hourlyActivity = Array(24).fill(0);
      const dailyActivity = Array(7).fill(0);
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

      activity.forEach((a: any) => {
        const date = new Date(a.timestamp);
        hourlyActivity[date.getHours()]++;
        dailyActivity[date.getDay()]++;
      });

      const hourlyData = hourlyActivity.map((count, hour) => ({
        hour: `${hour}:00`,
        activity: count
      }));

      const dailyData = dailyActivity.map((count, day) => ({
        day: dayNames[day],
        activity: count
      }));

      const peakHour = hourlyActivity.indexOf(Math.max(...hourlyActivity));
      const peakDay = dailyActivity.indexOf(Math.max(...dailyActivity));

      res.json({
        hourlyData,
        dailyData,
        peakHour: `${peakHour}:00`,
        peakDay: dayNames[peakDay],
        totalActivity: activity.length
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get('/api/admin/analytics/popular-trainers', async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      const start = startDate ? new Date(startDate as string) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const end = endDate ? new Date(endDate as string) : new Date();

      const sessions = await storage.getAllSessions();
      const filteredSessions = sessions.filter((s: any) => {
        const scheduledDate = new Date(s.scheduledAt);
        return scheduledDate >= start && scheduledDate <= end;
      });

      const trainerStats: Record<string, any> = {};

      for (const session of filteredSessions) {
        const trainer = (session as any).trainerName || 'Unknown';
        if (!trainerStats[trainer]) {
          trainerStats[trainer] = {
            trainerName: trainer,
            totalSessions: 0,
            completedSessions: 0,
            totalBookings: 0,
            totalAttendance: 0,
            avgAttendanceRate: 0
          };
        }

        trainerStats[trainer].totalSessions++;
        if ((session as any).status === 'completed') {
          trainerStats[trainer].completedSessions++;
        }

        const sessionClients = await storage.getSessionClients((session as any)._id);
        trainerStats[trainer].totalBookings += sessionClients.length;
        trainerStats[trainer].totalAttendance += sessionClients.filter((sc: any) => sc.attended).length;
      }

      const trainerList = Object.values(trainerStats).map((trainer: any) => ({
        ...trainer,
        avgAttendanceRate: trainer.totalBookings > 0 
          ? Math.round((trainer.totalAttendance / trainer.totalBookings) * 100) 
          : 0
      }));

      trainerList.sort((a, b) => b.totalSessions - a.totalSessions);

      res.json({
        trainers: trainerList,
        totalTrainers: trainerList.length
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Advanced Analytics - Engagement Scoring & Predictive Indicators
  app.get('/api/admin/analytics/engagement-report', authenticateToken, requireAdmin, async (req, res) => {
    try {
      console.log('[API] Generating engagement report...');
      const { analyticsEngine } = await import('./analytics-engine');
      const report = await analyticsEngine.generateReport();
      res.json(report);
    } catch (error: any) {
      console.error('[API] Error generating engagement report:', error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get('/api/admin/analytics/engagement-scores', authenticateToken, requireAdmin, async (req, res) => {
    try {
      const { analyticsEngine } = await import('./analytics-engine');
      const scores = analyticsEngine.getScoresFromCache();
      
      if (scores.length === 0) {
        await analyticsEngine.calculateEngagementScores();
        const newScores = analyticsEngine.getScoresFromCache();
        return res.json(newScores);
      }
      
      res.json(scores);
    } catch (error: any) {
      console.error('[API] Error getting engagement scores:', error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post('/api/admin/analytics/refresh-engagement', authenticateToken, requireAdmin, async (req, res) => {
    try {
      console.log('[API] Refreshing engagement scores...');
      const { analyticsEngine } = await import('./analytics-engine');
      const scores = await analyticsEngine.calculateEngagementScores();
      res.json({
        message: 'Engagement scores refreshed successfully',
        processedClients: scores.length,
        timestamp: new Date()
      });
    } catch (error: any) {
      console.error('[API] Error refreshing engagement scores:', error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get('/api/admin/analytics/cache-info', authenticateToken, requireAdmin, async (req, res) => {
    try {
      const { analyticsEngine } = await import('./analytics-engine');
      const cacheInfo = analyticsEngine.getCacheInfo();
      res.json(cacheInfo);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // System Settings routes
  app.get("/api/settings", async (_req, res) => {
    try {
      const settings = await storage.getSystemSettings();
      res.json(settings);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  app.put("/api/settings", async (req, res) => {
    try {
      const settings = await storage.updateSystemSettings(req.body);
      res.json(settings);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  app.post("/api/settings/initialize", async (_req, res) => {
    try {
      const settings = await storage.initializeSystemSettings();
      res.json(settings);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  app.post("/api/settings/backup", async (_req, res) => {
    try {
      const settings = await storage.getSystemSettings();
      const timestamp = new Date().toISOString().split('T')[0];
      const backupData = {
        backupDate: new Date(),
        settings,
        clients: await storage.getAllClients(),
        packages: await storage.getAllPackages(),
      };
      
      await storage.updateSystemSettings({
        backup: {
          autoBackup: settings.backup?.autoBackup || false,
          backupFrequency: settings.backup?.backupFrequency || 'weekly',
          lastBackupDate: new Date(),
          backupLocation: settings.backup?.backupLocation,
        }
      });
      
      res.json({ 
        message: "Backup created successfully", 
        filename: `fitpro-backup-${timestamp}.json`,
        data: backupData
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // GDPR Compliance: User Data Export (authenticated users only)
  app.get("/api/user/export-data", authenticateToken, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      const userData = await exportUserData(req.user.userId, req.user.clientId);
      
      // Return as downloadable JSON file
      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `user-data-export-${timestamp}.json`;
      
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.json(userData);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Notification routes
  app.get("/api/notifications", authenticateToken, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      const notifications = await storage.getUserNotifications(req.user.userId);
      res.json(notifications);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/notifications/:id/read", authenticateToken, async (req, res) => {
    try {
      const notification = await storage.markNotificationAsRead(req.params.id);
      if (!notification) {
        return res.status(404).json({ message: "Notification not found" });
      }
      res.json(notification);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/notifications/mark-all-read", authenticateToken, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      const count = await storage.markAllNotificationsAsRead(req.user.userId);
      res.json({ message: `${count} notifications marked as read`, count });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/notifications/unread-count", authenticateToken, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      const count = await storage.getUnreadNotificationCount(req.user.userId);
      res.json({ count });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/notifications/:id", authenticateToken, async (req, res) => {
    try {
      const deleted = await storage.deleteNotification(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Notification not found" });
      }
      res.json({ message: "Notification deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Trainer-specific API endpoints with authorization
  // Get all trainers (for assignment dropdowns)
  app.get("/api/trainers", authenticateToken, async (req, res) => {
    try {
      const trainers = await storage.getAllTrainers();
      res.json(trainers);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get trainer details (public endpoint for clients to access their trainer)
  app.get("/api/trainer/:id", authenticateToken, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      const trainer = await storage.getTrainer(req.params.id);
      if (!trainer) {
        return res.status(404).json({ message: "Trainer not found" });
      }
      res.json(trainer);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/trainers/:id", authenticateToken, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      // Only trainers and admins can access trainer endpoints
      if (req.user.role !== 'trainer' && req.user.role !== 'admin') {
        return res.status(403).json({ message: "Access denied. Trainer or admin role required." });
      }
      
      // Trainers can only access their own data; admins can access any trainer
      if (req.user.role === 'trainer' && String(req.user.userId) !== req.params.id) {
        return res.status(403).json({ message: "Access denied. You can only access your own data." });
      }
      
      const trainer = await storage.getTrainer(req.params.id);
      if (!trainer) {
        return res.status(404).json({ message: "Trainer not found" });
      }
      res.json(trainer);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/trainers/:trainerId/clients", authenticateToken, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      // Only trainers and admins can access trainer endpoints
      if (req.user.role !== 'trainer' && req.user.role !== 'admin') {
        return res.status(403).json({ message: "Access denied. Trainer or admin role required." });
      }
      
      // Trainers can only access their own clients; admins can access any trainer's clients
      if (req.user.role === 'trainer' && String(req.user.userId) !== req.params.trainerId) {
        return res.status(403).json({ message: "Access denied. You can only access your own clients." });
      }
      
      const clients = await storage.getTrainerClients(req.params.trainerId);
      res.json(clients);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/trainers/:trainerId/diet-plans", authenticateToken, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      // Only trainers and admins can access trainer endpoints
      if (req.user.role !== 'trainer' && req.user.role !== 'admin') {
        return res.status(403).json({ message: "Access denied. Trainer or admin role required." });
      }
      
      // Trainers can only access their own diet plans; admins can access any trainer's plans
      if (req.user.role === 'trainer' && String(req.user.userId) !== req.params.trainerId) {
        return res.status(403).json({ message: "Access denied. You can only access your own diet plans." });
      }
      
      const trainerPlans = await storage.getTrainerDietPlans(req.params.trainerId);
      
      // Fetch all templates (both admin and trainer-created) that are marked as templates
      const allPlans = await DietPlan.find({ isTemplate: true }).lean();
      const templates = allPlans.map((plan: any) => {
        const isAdminTemplate = plan.createdBy?.toString().includes('admin') || !plan.createdBy;
        return {
          ...plan,
          templateSource: isAdminTemplate ? 'admin' : 'trainer'
        };
      });
      
      // Combine trainer's plans with all templates
      const combined = [...trainerPlans, ...templates];
      res.json(combined);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/trainers/:trainerId/workout-plans", authenticateToken, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      // Only trainers and admins can access trainer endpoints
      if (req.user.role !== 'trainer' && req.user.role !== 'admin') {
        return res.status(403).json({ message: "Access denied. Trainer or admin role required." });
      }
      
      // Trainers can only access their own workout plans; admins can access any trainer's plans
      if (req.user.role === 'trainer' && String(req.user.userId) !== req.params.trainerId) {
        return res.status(403).json({ message: "Access denied. You can only access your own workout plans." });
      }
      
      const trainerPlans = await storage.getTrainerWorkoutPlans(req.params.trainerId);
      
      // Fetch all templates (both admin and trainer-created) that are marked as templates
      const allPlans = await WorkoutPlan.find({ isTemplate: true }).lean();
      const templates = allPlans.map((plan: any) => {
        const isAdminTemplate = plan.createdBy?.toString().includes('admin') || !plan.createdBy;
        return {
          ...plan,
          templateSource: isAdminTemplate ? 'admin' : 'trainer'
        };
      });
      
      // Combine trainer's plans with all templates
      const combined = [...trainerPlans, ...templates];
      res.json(combined);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/trainers/:trainerId/meals", authenticateToken, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      // Only trainers and admins can access trainer endpoints
      if (req.user.role !== 'trainer' && req.user.role !== 'admin') {
        return res.status(403).json({ message: "Access denied. Trainer or admin role required." });
      }
      
      // Trainers can only access their own meals; admins can access any trainer's meals
      if (req.user.role === 'trainer' && String(req.user.userId) !== req.params.trainerId) {
        return res.status(403).json({ message: "Access denied. You can only access your own meals." });
      }
      
      const meals = await storage.getAllMeals({ search: '' });
      // Filter meals created by this trainer
      const trainerMeals = meals.filter((meal: any) => 
        meal.createdBy?.toString() === req.params.trainerId || 
        meal.createdBy === req.params.trainerId
      );
      res.json(trainerMeals);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/trainers/:trainerId/sessions", authenticateToken, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      // Only trainers and admins can access trainer endpoints
      if (req.user.role !== 'trainer' && req.user.role !== 'admin') {
        return res.status(403).json({ message: "Access denied. Trainer or admin role required." });
      }
      
      // Trainers can only access their own sessions; admins can access any trainer's sessions
      if (req.user.role === 'trainer' && String(req.user.userId) !== req.params.trainerId) {
        return res.status(403).json({ message: "Access denied. You can only access your own sessions." });
      }
      
      // Get trainer's own sessions + admin-created sessions assigned to this trainer
      const trainerSessions = await storage.getTrainerSessions(req.params.trainerId);
      
      // Also fetch all admin-created sessions that are assigned to this trainer
      const allSessions = await LiveSession.find().lean();
      const adminSessions = allSessions.filter((session: any) => {
        // Include sessions created by admin and assigned to this trainer
        const createdByAdmin = session.createdBy && session.createdBy.toString().includes('admin');
        const assignedToTrainer = session.trainerName === req.params.trainerId || session.assignedTrainers?.includes(req.params.trainerId);
        return createdByAdmin && assignedToTrainer;
      });
      
      // Combine trainer's own sessions with assigned admin sessions
      const combined = [...trainerSessions, ...adminSessions];
      res.json(combined);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get client subscriptions (admin dashboard)
  app.get("/api/admin/clients/packages", authenticateToken, requireAdmin, async (req, res) => {
    try {
      const { q } = req.query;
      const clients = await storage.getAllClients(true);
      
      let filtered = clients;
      if (q) {
        const searchQuery = q.toString().toLowerCase();
        filtered = filtered.filter((client: any) =>
          client.name.toLowerCase().includes(searchQuery) ||
          client.email?.toLowerCase().includes(searchQuery) ||
          client.phone?.includes(searchQuery)
        );
      }

      // Map packages to clients
      const clientsWithPackages = await Promise.all(
        filtered.map(async (client: any) => {
          const pkg = client.packageId ? await storage.getPackage(String(client.packageId)) : null;
          return {
            ...client,
            packageName: pkg?.name || 'None',
            packageId: client.packageId,
            subscriptionStartDate: client.subscriptionStartDate,
            subscriptionEndDate: client.subscriptionEndDate,
            accessDurationWeeks: client.accessDurationWeeks || 4,
          };
        })
      );

      res.json(clientsWithPackages);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get subscription status for all clients (for admin notifications)
  app.get("/api/admin/subscription-alerts", authenticateToken, requireAdmin, async (req, res) => {
    try {
      const clients = await storage.getAllClients(true);
      const now = new Date();

      const alerts = {
        expiring_soon: [] as any[],
        expired: [] as any[],
      };

      for (const client of clients) {
        if (!client.subscriptionEndDate) continue;

        const endDate = new Date(client.subscriptionEndDate);
        const daysLeft = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

        if (daysLeft <= 0) {
          alerts.expired.push({
            clientId: client._id,
            clientName: client.name,
            packageName: (client as any).packageName,
            expiredSince: Math.abs(daysLeft),
          });
        } else if (daysLeft <= 7) {
          alerts.expiring_soon.push({
            clientId: client._id,
            clientName: client.name,
            packageName: (client as any).packageName,
            daysLeft,
          });
        }
      }

      res.json(alerts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Import and use encrypted files routes
  const encryptedFilesRouter = await import('./routes/encrypted-files');
  app.use('/api/encrypted-files', encryptedFilesRouter.default);

  const httpServer = createServer(app);

  return httpServer;
}
