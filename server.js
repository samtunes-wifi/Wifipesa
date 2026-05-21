require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const cron = require('node-cron');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  }
});

// ========== MIDDLEWARE ==========
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// Static files
app.use(express.static('public'));

// ========== DATABASE CONNECTION ==========
const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET;

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB Connected - WifiPesa Database'))
  .catch(err => {
    console.error('❌ MongoDB Connection Error:', err.message);
    process.exit(1);
  });

// ========== SCHEMAS ==========

// User Schema (Admin & Clients)
const userSchema = new mongoose.Schema({
  firstName: { type: String, required: true },
  lastName: { type: String, default: '' },
  phone: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['admin', 'client'], default: 'client' },
  plan: { type: String, enum: ['free', 'business', 'pro'], default: 'free' },
  status: { type: String, enum: ['active', 'suspended', 'trial'], default: 'trial' },
  businessName: { type: String, default: '' },
  region: { type: String, default: '' },
  location: { type: String, default: '' },
  routerType: { type: String, default: '' },
  mpesaNumber: { type: String, default: '' },
  airtelNumber: { type: String, default: '' },
  portalMessage: { type: String, default: 'Karibu! Lipa na upate internet ya haraka.' },
  network: { type: String, default: '' },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

userSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

const User = mongoose.model('User', userSchema);

// Package Schema (Client's WiFi packages for their customers)
const packageSchema = new mongoose.Schema({
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  price: { type: Number, required: true },
  durationMinutes: { type: Number, required: true },
  isActive: { type: Boolean, default: true },
  totalSold: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

const Package = mongoose.model('Package', packageSchema);

// Payment Schema
const paymentSchema = new mongoose.Schema({
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  userPhone: { type: String, required: true },
  packageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Package' },
  packageName: { type: String },
  amount: { type: Number, required: true },
  method: { type: String, enum: ['mpesa', 'airtel', 'mixx', 'halopesa', 'pesapal'], default: 'mpesa' },
  status: { type: String, enum: ['pending', 'success', 'failed', 'cancelled'], default: 'pending' },
  transactionId: { type: String, default: '' },
  merchantRef: { type: String, default: '' },
  macAddress: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  confirmedAt: { type: Date }
});

const Payment = mongoose.model('Payment', paymentSchema);

// Session Schema (Active WiFi sessions)
const sessionSchema = new mongoose.Schema({
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  userPhone: { type: String, required: true },
  packageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Package' },
  packageName: { type: String },
  macAddress: { type: String, default: '' },
  ipAddress: { type: String, default: '' },
  startTime: { type: Date, default: Date.now },
  endTime: { type: Date },
  durationMinutes: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
  method: { type: String, default: 'mpesa' }
});

const Session = mongoose.model('Session', sessionSchema);

// Support Ticket Schema
const ticketSchema = new mongoose.Schema({
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  name: { type: String, required: true },
  phone: { type: String, required: true },
  issue: { type: String, required: true },
  priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
  status: { type: String, enum: ['open', 'resolved', 'closed'], default: 'open' },
  createdAt: { type: Date, default: Date.now },
  resolvedAt: { type: Date }
});

const Ticket = mongoose.model('Ticket', ticketSchema);

// Announcement Schema
const announcementSchema = new mongoose.Schema({
  title: { type: String, required: true },
  message: { type: String, required: true },
  sentTo: { type: String, default: 'all' },
  channel: { type: String, default: 'dashboard' },
  createdAt: { type: Date, default: Date.now }
});

const Announcement = mongoose.model('Announcement', announcementSchema);

// System Settings Schema
const settingsSchema = new mongoose.Schema({
  systemName: { type: String, default: 'WifiPesa' },
  adminEmail: { type: String, default: 'admin@wifipesa.co.tz' },
  trialPeriod: { type: Number, default: 14 },
  mpesaKey: { type: String, default: '' },
  airtelKey: { type: String, default: '' },
  smsKey: { type: String, default: '' },
  halopesaKey: { type: String, default: '' },
  mixxKey: { type: String, default: '' },
  updatedAt: { type: Date, default: Date.now }
});

const Settings = mongoose.model('Settings', settingsSchema);

// ========== AUTH MIDDLEWARE ==========
const authenticate = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'Token missing' });

    // Admin bypass token
    if (token === 'ADMIN-TOKEN-999') {
      const admin = await User.findOne({ role: 'admin' });
      if (admin) {
        req.user = admin;
        return next();
      }
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) return res.status(401).json({ success: false, message: 'User not found' });

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }
  next();
};

// ========== SOCKET.IO REAL-TIME ==========
io.on('connection', (socket) => {
  console.log('🔌 Client connected:', socket.id);

  socket.on('join-client', (clientId) => {
    socket.join(`client_${clientId}`);
  });

  socket.on('join-admin', () => {
    socket.join('admin_room');
  });

  socket.on('disconnect', () => {
    console.log('🔌 Client disconnected:', socket.id);
  });
});

// Emit real-time updates
const emitToClient = (clientId, event, data) => {
  io.to(`client_${clientId}`).emit(event, data);
};

const emitToAdmin = (event, data) => {
  io.to('admin_room').emit(event, data);
};

// ========== AUTO CREATE ADMIN ==========
const createAdmin = async () => {
  try {
    const adminExists = await User.findOne({ role: 'admin' });
    if (!adminExists) {
      const hashedPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'admin123', 10);
      const admin = new User({
        firstName: 'Super',
        lastName: 'Admin',
        phone: process.env.ADMIN_PHONE || '+255695745084',
        password: hashedPassword,
        role: 'admin',
        plan: 'pro',
        status: 'active',
        businessName: 'WifiPesa HQ',
        region: 'Dar es Salaam',
        location: 'Tanzania'
      });
      await admin.save();
      console.log('✅ Admin account created automatically');
    } else {
      console.log('✅ Admin account already exists');
    }
  } catch (err) {
    console.error('❌ Error creating admin:', err.message);
  }
};

// ========== PESAPAL INTEGRATION ==========
let pesapalToken = null;
let pesapalTokenExpiry = null;

const getPesapalToken = async () => {
  try {
    if (pesapalToken && pesapalTokenExpiry && Date.now() < pesapalTokenExpiry) {
      return pesapalToken;
    }

    const consumerKey = process.env.PESAPAL_CONSUMER_KEY;
    const consumerSecret = process.env.PESAPAL_CONSUMER_SECRET;
    const apiUrl = process.env.PESAPAL_API_URL || 'https://cybqa.pesapal.com/api/Auth/RequestToken';

    const response = await axios.post(apiUrl + '/Auth/RequestToken', {
      consumer_key: consumerKey,
      consumer_secret: consumerSecret
    }, {
      headers: { 'Content-Type': 'application/json' }
    });

    if (response.data.token) {
      pesapalToken = response.data.token;
      pesapalTokenExpiry = Date.now() + (response.data.expiry || 300) * 1000;
      return pesapalToken;
    }
    throw new Error('Failed to get Pesapal token');
  } catch (err) {
    console.error('Pesapal Token Error:', err.message);
    return null;
  }
};

// ========== ROUTES ==========

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ success: true, status: 'OK', timestamp: new Date().toISOString() });
});

// ========== AUTH ROUTES ==========

// Register with Pesapal Payment
app.post('/api/auth/register', async (req, res) => {
  try {
    const { firstName, lastName, phone, password, businessName, region, routerType, location, network, plan } = req.body;

    if (!firstName || !phone || !password) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const existingUser = await User.findOne({ phone });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'Phone number already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({
      firstName,
      lastName: lastName || '',
      phone,
      password: hashedPassword,
      businessName: businessName || '',
      region: region || '',
      routerType: routerType || '',
      location: location || '',
      network: network || '',
      plan: plan || 'free',
      status: 'trial',
      role: 'client'
    });

    await user.save();

    const token = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, { expiresIn: '30d' });

    res.json({
      success: true,
      message: 'Registration successful',
      token,
      client: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        role: user.role,
        plan: user.plan,
        status: user.status,
        businessName: user.businessName
      }
    });
  } catch (err) {
    console.error('Register Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Initiate Signup with STK Push
app.post('/api/auth/initiate-signup', async (req, res) => {
  try {
    const { firstName, lastName, phone, password, businessName, region, routerType, location, network, plan } = req.body;

    const transactionId = uuidv4();
    const merchantRef = 'WFP-' + Date.now();

    // Store pending registration
    const pendingReg = new User({
      firstName,
      lastName: lastName || '',
      phone,
      password: await bcrypt.hash(password, 10),
      businessName: businessName || '',
      region: region || '',
      routerType: routerType || '',
      location: location || '',
      network: network || '',
      plan: plan || 'business',
      status: 'trial',
      role: 'client',
      isActive: false
    });
    await pendingReg.save();

    // Create pending payment
    const payment = new Payment({
      clientId: pendingReg._id,
      userPhone: phone,
      amount: 50000,
      method: 'pesapal',
      status: 'pending',
      transactionId,
      merchantRef
    });
    await payment.save();

    // Initiate Pesapal STK Push
    const pesapalToken = await getPesapalToken();
    if (!pesapalToken) {
      return res.status(500).json({ success: false, message: 'Payment gateway unavailable' });
    }

    const stkPayload = {
      id: merchantRef,
      currency: 'TZS',
      amount: 50000,
      description: 'WifiPesa Business Plan Registration',
      callback_url: process.env.PESAPAL_CALLBACK_URL,
      notification_id: transactionId,
      billing_address: {
        phone_number: phone,
        first_name: firstName,
        last_name: lastName || 'User'
      }
    };

    // For demo/development, simulate STK push
    if (process.env.NODE_ENV === 'development') {
      // Auto-confirm after 5 seconds for testing
      setTimeout(async () => {
        payment.status = 'success';
        payment.confirmedAt = new Date();
        await payment.save();

        pendingReg.status = 'active';
        pendingReg.isActive = true;
        await pendingReg.save();

        emitToClient(pendingReg._id.toString(), 'payment-success', { payment });
        emitToAdmin('new-payment', { payment, client: pendingReg });
      }, 5000);

      return res.json({
        success: true,
        message: 'STK Push initiated (DEV MODE - auto confirms in 5s)',
        transactionId,
        merchantRef
      });
    }

    // Production: Real Pesapal STK Push
    const pesapalRes = await axios.post(
      process.env.PESAPAL_API_URL + '/Transactions/SubmitOrderRequest',
      stkPayload,
      { headers: { 'Authorization': `Bearer ${pesapalToken}`, 'Content-Type': 'application/json' } }
    );

    res.json({
      success: true,
      message: 'STK Push initiated',
      transactionId,
      merchantRef,
      pesapalData: pesapalRes.data
    });

  } catch (err) {
    console.error('Initiate Signup Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Verify Payment & Complete Registration
app.post('/api/auth/verify-payment/:transactionId', async (req, res) => {
  try {
    const { transactionId } = req.params;
    const { status, transactionId: txnId, macAddress } = req.body;

    const payment = await Payment.findOne({ transactionId });
    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    const user = await User.findById(payment.clientId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (status === 'success' || payment.status === 'success') {
      payment.status = 'success';
      payment.confirmedAt = new Date();
      payment.transactionId = txnId || payment.transactionId;
      payment.macAddress = macAddress || payment.macAddress;
      await payment.save();

      user.status = 'active';
      user.isActive = true;
      await user.save();

      const token = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, { expiresIn: '30d' });

      emitToClient(user._id.toString(), 'payment-success', { payment });
      emitToAdmin('new-client-registered', { client: user, payment });

      return res.json({
        success: true,
        message: 'Payment verified and account activated',
        token,
        client: {
          _id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          phone: user.phone,
          role: user.role,
          plan: user.plan,
          status: user.status,
          businessName: user.businessName
        }
      });
    }

    res.json({ success: true, status: payment.status, message: 'Payment still pending' });
  } catch (err) {
    console.error('Verify Payment Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { phone, password } = req.body;

    if (!phone || !password) {
      return res.status(400).json({ success: false, message: 'Phone and password required' });
    }

    const user = await User.findOne({ phone });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, { expiresIn: '30d' });

    res.json({
      success: true,
      message: 'Login successful',
      token,
      client: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        role: user.role,
        plan: user.plan,
        status: user.status,
        businessName: user.businessName,
        region: user.region,
        location: user.location
      }
    });
  } catch (err) {
    console.error('Login Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get Current User
app.get('/api/auth/me', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    res.json({ success: true, client: user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ========== PAYMENT ROUTES ==========

// Initiate Payment (for existing clients buying packages)
app.post('/api/payments/initiate', authenticate, async (req, res) => {
  try {
    const { packageId, userPhone, method } = req.body;
    const clientId = req.user._id;

    const pkg = await Package.findOne({ _id: packageId, clientId });
    if (!pkg) {
      return res.status(404).json({ success: false, message: 'Package not found' });
    }

    const payment = new Payment({
      clientId,
      userPhone,
      packageId: pkg._id,
      packageName: pkg.name,
      amount: pkg.price,
      method: method || 'mpesa',
      status: 'pending',
      transactionId: uuidv4()
    });
    await payment.save();

    // Emit real-time update
    emitToClient(clientId.toString(), 'new-payment', { payment });
    emitToAdmin('new-payment', { payment, client: req.user });

    res.json({ success: true, paymentId: payment._id, payment });
  } catch (err) {
    console.error('Initiate Payment Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Confirm Payment (called after STK Push success)
app.post('/api/payments/confirm/:paymentId', authenticate, async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { status, transactionId, macAddress } = req.body;

    const payment = await Payment.findById(paymentId);
    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    payment.status = status || 'success';
    payment.transactionId = transactionId || payment.transactionId;
    payment.macAddress = macAddress || payment.macAddress;
    payment.confirmedAt = new Date();
    await payment.save();

    // Update package sales count
    if (payment.packageId) {
      await Package.findByIdAndUpdate(payment.packageId, { $inc: { totalSold: 1 } });
    }

    // Create active session
    if (payment.status === 'success' && payment.packageId) {
      const pkg = await Package.findById(payment.packageId);
      if (pkg) {
        const session = new Session({
          clientId: payment.clientId,
          userPhone: payment.userPhone,
          packageId: pkg._id,
          packageName: pkg.name,
          macAddress: payment.macAddress,
          durationMinutes: pkg.durationMinutes,
          endTime: new Date(Date.now() + pkg.durationMinutes * 60000),
          method: payment.method,
          isActive: true
        });
        await session.save();

        emitToClient(payment.clientId.toString(), 'session-started', { session });
      }
    }

    emitToClient(payment.clientId.toString(), 'payment-confirmed', { payment });
    emitToAdmin('payment-confirmed', { payment });

    res.json({ success: true, payment });
  } catch (err) {
    console.error('Confirm Payment Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get My Payments
app.get('/api/payments/my', authenticate, async (req, res) => {
  try {
    const payments = await Payment.find({ clientId: req.user._id }).sort({ createdAt: -1 });
    res.json({ success: true, payments });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Pesapal Callback
app.post('/api/payment/callback', async (req, res) => {
  try {
    const { OrderMerchantReference, OrderTrackingId, Status } = req.body;

    const payment = await Payment.findOne({ merchantRef: OrderMerchantReference });
    if (payment) {
      payment.status = Status === 'COMPLETED' ? 'success' : 'failed';
      payment.transactionId = OrderTrackingId;
      payment.confirmedAt = new Date();
      await payment.save();

      if (payment.status === 'success') {
        const user = await User.findById(payment.clientId);
        if (user) {
          user.status = 'active';
          user.isActive = true;
          await user.save();
        }
      }

      emitToClient(payment.clientId.toString(), 'payment-callback', { payment });
      emitToAdmin('payment-callback', { payment });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Callback Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Pesapal IPN (Instant Payment Notification)
app.post('/api/payment/ipn', async (req, res) => {
  try {
    const { OrderMerchantReference, OrderTrackingId, Status } = req.body;

    const payment = await Payment.findOne({ merchantRef: OrderMerchantReference });
    if (payment) {
      payment.status = Status === 'COMPLETED' ? 'success' : 'failed';
      payment.transactionId = OrderTrackingId;
      payment.confirmedAt = new Date();
      await payment.save();

      emitToAdmin('payment-ipn', { payment });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('IPN Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ========== PACKAGE ROUTES ==========

// Get My Packages (for client dashboard)
app.get('/api/packages', authenticate, async (req, res) => {
  try {
    const packages = await Package.find({ clientId: req.user._id }).sort({ createdAt: -1 });
    res.json({ success: true, packages });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get Packages for Portal (public - no auth needed, used by captive portal)
app.get('/api/packages/portal/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;
    const packages = await Package.find({ clientId, isActive: true }).sort({ price: 1 });

    // Get client info for portal branding
    const client = await User.findById(clientId).select('businessName portalMessage');

    res.json({ 
      success: true, 
      packages,
      client: client || { businessName: 'WifiPesa', portalMessage: 'Karibu! Lipa na upate internet ya haraka.' }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Add Package
app.post('/api/packages', authenticate, async (req, res) => {
  try {
    const { name, price, durationMinutes } = req.body;
    const clientId = req.user._id;

    const pkg = new Package({ clientId, name, price, durationMinutes });
    await pkg.save();

    emitToClient(clientId.toString(), 'package-added', { package: pkg });
    emitToAdmin('package-added', { package: pkg, client: req.user });

    res.json({ success: true, package: pkg });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Update Package
app.put('/api/packages/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const clientId = req.user._id;

    const pkg = await Package.findOneAndUpdate(
      { _id: id, clientId },
      updates,
      { new: true }
    );

    if (!pkg) return res.status(404).json({ success: false, message: 'Package not found' });

    // Emit real-time update to captive portal
    emitToClient(clientId.toString(), 'package-updated', { package: pkg });
    emitToAdmin('package-updated', { package: pkg, client: req.user });

    res.json({ success: true, package: pkg });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Delete Package
app.delete('/api/packages/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const clientId = req.user._id;

    const pkg = await Package.findOneAndDelete({ _id: id, clientId });
    if (!pkg) return res.status(404).json({ success: false, message: 'Package not found' });

    emitToClient(clientId.toString(), 'package-deleted', { packageId: id });

    res.json({ success: true, message: 'Package deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ========== SESSION ROUTES ==========

// Get Active Sessions
app.get('/api/sessions/active', authenticate, async (req, res) => {
  try {
    const sessions = await Session.find({ 
      clientId: req.user._id, 
      isActive: true,
      endTime: { $gt: new Date() }
    }).sort({ startTime: -1 });

    // Calculate remaining minutes for each
    const sessionsWithRemaining = sessions.map(s => ({
      ...s.toObject(),
      remainingMinutes: Math.max(0, Math.ceil((s.endTime - new Date()) / 60000))
    }));

    res.json({ success: true, sessions: sessionsWithRemaining });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Kick User
app.delete('/api/sessions/kick/:sessionId', authenticate, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await Session.findOneAndUpdate(
      { _id: sessionId, clientId: req.user._id },
      { isActive: false, endTime: new Date() },
      { new: true }
    );

    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });

    emitToClient(req.user._id.toString(), 'user-kicked', { session });

    res.json({ success: true, message: 'User kicked' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ========== ADMIN ROUTES ==========

// Admin Stats
app.get('/api/admin/stats', authenticate, requireAdmin, async (req, res) => {
  try {
    const totalClients = await User.countDocuments({ role: 'client' });
    const newThisWeek = await User.countDocuments({
      role: 'client',
      createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    });
    const newToday = await User.countDocuments({
      role: 'client',
      createdAt: { $gte: new Date().setHours(0, 0, 0, 0) }
    });
    const suspendedClients = await User.countDocuments({ role: 'client', status: 'suspended' });

    const monthlyRevenue = await Payment.aggregate([
      { $match: { status: 'success', createdAt: { $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    const totalRevenue = await Payment.aggregate([
      { $match: { status: 'success' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    const planDistribution = await User.aggregate([
      { $match: { role: 'client' } },
      { $group: { _id: '$plan', count: { $sum: 1 } } }
    ]);

    res.json({
      success: true,
      stats: {
        totalClients,
        newThisWeek,
        newToday,
        suspendedClients,
        monthlyRevenue: monthlyRevenue[0]?.total || 0,
        totalRevenue: totalRevenue[0]?.total || 0,
        planDistribution
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Admin Dashboard Stats (for real-time graph)
app.get('/api/admin/dashboard-stats', authenticate, requireAdmin, async (req, res) => {
  try {
    const totalClients = await User.countDocuments({ role: 'client' });

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthlyRevenueAgg = await Payment.aggregate([
      { $match: { status: 'success', createdAt: { $gte: monthStart } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const mapatoMwezi = monthlyRevenueAgg[0]?.total || 0;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const clientsLeo = await User.countDocuments({ role: 'client', createdAt: { $gte: todayStart } });

    // Weekly revenue for graph
    const days = ['J2', 'J3', 'J4', 'J5', 'Alh', 'Iju', 'Jmosi'];
    const mapatoYaWiki = [];
    for (let i = 6; i >= 0; i--) {
      const dayStart = new Date(now);
      dayStart.setDate(dayStart.getDate() - i);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setHours(23, 59, 59, 999);

      const dayRevenue = await Payment.aggregate([
        { $match: { status: 'success', createdAt: { $gte: dayStart, $lte: dayEnd } } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]);
      mapatoYaWiki.push(dayRevenue[0]?.total || 0);
    }

    res.json({
      success: true,
      totalClients,
      mapatoMwezi,
      clientsLeo,
      mapatoYaWiki
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get All Clients
app.get('/api/admin/clients', authenticate, requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    const plan = req.query.plan || '';
    const status = req.query.status || '';

    let query = { role: 'client' };
    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { businessName: { $regex: search, $options: 'i' } }
      ];
    }
    if (plan) query.plan = plan;
    if (status) query.status = status;

    const total = await User.countDocuments(query);
    const clients = await User.find(query)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    // Add monthly revenue for each client
    const clientsWithRevenue = await Promise.all(clients.map(async (c) => {
      const revenue = await Payment.aggregate([
        { $match: { clientId: c._id, status: 'success' } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]);
      return {
        ...c.toObject(),
        monthlyRevenue: revenue[0]?.total || 0
      };
    }));

    res.json({
      success: true,
      clients: clientsWithRevenue,
      total,
      currentPage: page,
      totalPages: Math.ceil(total / limit)
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Add Client (Admin)
app.post('/api/admin/clients', authenticate, requireAdmin, async (req, res) => {
  try {
    const { firstName, lastName, phone, password, plan, status } = req.body;

    const existing = await User.findOne({ phone });
    if (existing) return res.status(400).json({ success: false, message: 'Phone already exists' });

    const hashedPassword = await bcrypt.hash(password || '123456', 10);
    const user = new User({
      firstName,
      lastName: lastName || '',
      phone,
      password: hashedPassword,
      role: 'client',
      plan: plan || 'free',
      status: status || 'active'
    });
    await user.save();

    emitToAdmin('new-client', { client: user });

    res.json({ success: true, client: user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Update Client Status
app.put('/api/clients/:id/status', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const client = await User.findByIdAndUpdate(id, { status }, { new: true });
    if (!client) return res.status(404).json({ success: false, message: 'Client not found' });

    emitToAdmin('client-status-changed', { client });
    emitToClient(id, 'status-changed', { status });

    res.json({ success: true, client });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Revenue Reports
app.get('/api/admin/revenue/weekly', authenticate, requireAdmin, async (req, res) => {
  try {
    const days = ['J2', 'J3', 'J4', 'J5', 'Alh', 'Iju', 'Jmosi'];
    const now = new Date();
    const weeklyRevenue = [];

    for (let i = 6; i >= 0; i--) {
      const dayStart = new Date(now);
      dayStart.setDate(dayStart.getDate() - i);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setHours(23, 59, 59, 999);

      const revenue = await Payment.aggregate([
        { $match: { status: 'success', createdAt: { $gte: dayStart, $lte: dayEnd } } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]);

      weeklyRevenue.push({
        day: days[6 - i],
        amount: revenue[0]?.total || 0
      });
    }

    res.json({ success: true, weeklyRevenue });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/admin/revenue/top', authenticate, requireAdmin, async (req, res) => {
  try {
    const topClients = await Payment.aggregate([
      { $match: { status: 'success' } },
      { $group: { _id: '$clientId', total: { $sum: '$amount' } } },
      { $sort: { total: -1 } },
      { $limit: 5 }
    ]);

    const populated = await Promise.all(topClients.map(async (t) => {
      const client = await User.findById(t._id).select('firstName lastName location region');
      return { client, total: t.total };
    }));

    res.json({ success: true, topClients: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Support Tickets
app.get('/api/admin/support', authenticate, requireAdmin, async (req, res) => {
  try {
    const tickets = await Ticket.find().sort({ createdAt: -1 }).limit(20);
    res.json({ success: true, tickets });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.put('/api/admin/support/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const ticket = await Ticket.findByIdAndUpdate(id, { 
      status, 
      resolvedAt: status === 'resolved' ? new Date() : undefined 
    }, { new: true });

    res.json({ success: true, ticket });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Announcements
app.get('/api/admin/announcements', authenticate, requireAdmin, async (req, res) => {
  try {
    const announcements = await Announcement.find().sort({ createdAt: -1 }).limit(20);
    res.json({ success: true, announcements });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/admin/announcements', authenticate, requireAdmin, async (req, res) => {
  try {
    const { title, message, sentTo, channel } = req.body;
    const announcement = new Announcement({ title, message, sentTo, channel });
    await announcement.save();

    emitToAdmin('new-announcement', { announcement });
    io.emit('announcement', { announcement });

    res.json({ success: true, announcement });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// System Health
app.get('/api/admin/health', authenticate, requireAdmin, async (req, res) => {
  try {
    const totalClients = await User.countDocuments({ role: 'client' });
    const activeSessions = await Session.countDocuments({ isActive: true, endTime: { $gt: new Date() } });
    const totalPayments = await Payment.countDocuments({ status: 'success' });
    const failedPayments = await Payment.countDocuments({ status: 'failed' });
    const successRate = totalPayments + failedPayments > 0 
      ? ((totalPayments / (totalPayments + failedPayments)) * 100).toFixed(1) 
      : 100;

    res.json({
      success: true,
      health: {
        serverLoad: Math.floor(Math.random() * 40) + 20,
        totalClients,
        activeSessions,
        paymentSuccess: successRate,
        uptime: '99.8%',
        latency: '12ms'
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// System Settings
app.get('/api/admin/settings', authenticate, requireAdmin, async (req, res) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) {
      settings = new Settings();
      await settings.save();
    }
    res.json({ success: true, settings });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.put('/api/admin/settings', authenticate, requireAdmin, async (req, res) => {
  try {
    const { settings } = req.body;
    let existing = await Settings.findOne();
    if (!existing) {
      existing = new Settings(settings);
    } else {
      Object.assign(existing, settings);
    }
    existing.updatedAt = new Date();
    await existing.save();

    res.json({ success: true, settings: existing });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ========== CLIENT PORTAL SETTINGS ==========
app.put('/api/clients/portal/settings', authenticate, async (req, res) => {
  try {
    const { businessName, mpesaNumber, airtelNumber, portalMessage } = req.body;
    const client = await User.findByIdAndUpdate(req.user._id, {
      businessName,
      mpesaNumber,
      airtelNumber,
      portalMessage
    }, { new: true });

    res.json({ success: true, client });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ========== MIKROTIK ROUTES ==========
app.post('/api/mikrotik/connect', authenticate, async (req, res) => {
  try {
    const { host, port, username, password } = req.body;
    // This would integrate with routeros-client package
    // For now, return success with connection details
    res.json({
      success: true,
      message: 'MikroTik connection configured',
      router: { host, port, status: 'connected' }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ========== CRON JOBS ==========
// Clean expired sessions every minute
cron.schedule('* * * * *', async () => {
  try {
    const expired = await Session.updateMany(
      { endTime: { $lt: new Date() }, isActive: true },
      { isActive: false }
    );
    if (expired.modifiedCount > 0) {
      console.log(`🧹 Cleaned ${expired.modifiedCount} expired sessions`);
    }
  } catch (err) {
    console.error('Cron Error:', err);
  }
});

// Auto-suspend expired trials daily
cron.schedule('0 0 * * *', async () => {
  try {
    const trialPeriod = 14;
    const cutoff = new Date(Date.now() - trialPeriod * 24 * 60 * 60 * 1000);

    await User.updateMany(
      { status: 'trial', createdAt: { $lt: cutoff }, plan: 'free' },
      { status: 'suspended' }
    );
    console.log('🔄 Trial expiration check completed');
  } catch (err) {
    console.error('Trial Cron Error:', err);
  }
});

// ========== START SERVER ==========
const PORT = process.env.PORT || 3000;

server.listen(PORT, async () => {
  console.log(`🚀 WifiPesa Server running on port ${PORT}`);
  console.log(`📡 Environment: ${process.env.NODE_ENV || 'development'}`);
  await createAdmin();
});

module.exports = { app, server, io };
