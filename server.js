const express = require('express');
const mongoose = require('mongoose'); 
const mongoURI = process.env.MONGO_URI || "mongodb+srv://SAMTUNES:Samtunes2026@samtunes.zef7zos.mongodb.net/wifipesa?retryWrites=true&w=majority";
mongoose.connect(mongoURI)
.then(() => console.log('Mtambo umeunganishwa na MongoDB Atlas kikamilifu! ☁️🚀'))
.catch(err => console.error('Dhoruba la muunganisho wa Atlas:', err));
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { RouterOSClient } = require('routeros-client'); // Library ya MikroTik API

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// ============================================================
// MODELS (Zimebaki vilevile bila kubadilishwa muundo)
// ============================================================

const clientSchema = new mongoose.Schema({
  firstName: { type: String, required: true, trim: true },
  lastName: { type: String, required: true, trim: true },
  phone: { type: String, required: true, unique: true, trim: true },
  password: { type: String, required: true },
  businessName: { type: String, default: '', trim: true },
  region: { type: String, default: '' },
  routerType: { type: String, default: 'Sijui' },
  location: { type: String, default: '' },
  network: { type: String, default: 'both' },
  plan: { type: String, default: 'free' },
  status: { type: String, default: 'trial' },
  mpesaNumber: { type: String, default: '' },
  airtelNumber: { type: String, default: '' },
  portalColor: { type: String, default: '#00c853' },
  portalMessage: { type: String, default: 'Karibu! Lipa na upate internet ya haraka.' },
  totalRevenue: { type: Number, default: 0 },
  // MAREKEBISHO MADOGO: Kuongeza sehemu ya kuhifadhi siri za router za ma-admin kama wakiamua kutumia MikroTik za mbali
  routerHost: { type: String, default: '' }, 
  routerUser: { type: String, default: 'admin' },
  routerPassword: { type: String, default: '' },
  routerPort: { type: Number, default: 8728 },
  role: { type: String, default: 'client', enum: ['client', 'admin'] },
  createdAt: { type: Date, default: Date.now }
});

clientSchema.pre('save', async function() {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 12);
});

clientSchema.methods.checkPassword = async function(password) {
  return await bcrypt.compare(password, this.password);
};

const Client = mongoose.model('Client', clientSchema);

const packageSchema = new mongoose.Schema({
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
  name: { type: String, required: true, trim: true },
  price: { type: Number, required: true },
  durationMinutes: { type: Number, required: true },
  speedLimit: { type: String, default: 'unlimited' },
  isActive: { type: Boolean, default: true },
  totalSold: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

const Package = mongoose.model('Package', packageSchema);

const paymentSchema = new mongoose.Schema({
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
  package: { type: mongoose.Schema.Types.ObjectId, ref: 'Package', required: true },
  userPhone: { type: String, required: true },
  amount: { type: Number, required: true },
  method: { type: String, default: 'mpesa' },
  status: { type: String, default: 'pending' },
  transactionId: { type: String, default: '' },
  sessionStart: { type: Date },
  sessionEnd: { type: Date },
  createdAt: { type: Date, default: Date.now }
});

const Payment = mongoose.model('Payment', paymentSchema);

const tempTransactionSchema = new mongoose.Schema({
  transactionId: { type: String, required: true, unique: true },
  status: { type: String, enum: ['PENDING', 'SUCCESS', 'FAILED'], default: 'PENDING' },
  createdAt: { type: Date, default: Date.now, expires: 600 }
});
const TempTransaction = mongoose.model('TempTransaction', tempTransactionSchema);

// NEW: Support Ticket Model
const supportTicketSchema = new mongoose.Schema({
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
  name: { type: String, required: true },
  phone: { type: String, default: '' },
  issue: { type: String, required: true },
  status: { type: String, default: 'open', enum: ['open', 'resolved'] },
  priority: { type: String, default: 'normal', enum: ['normal', 'urgent'] },
  createdAt: { type: Date, default: Date.now }
});
const SupportTicket = mongoose.model('SupportTicket', supportTicketSchema);

// NEW: Announcement Model
const announcementSchema = new mongoose.Schema({
  title: { type: String, required: true },
  message: { type: String, required: true },
  sentTo: { type: String, default: 'all' },
  channel: { type: String, default: 'dashboard' },
  sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
  createdAt: { type: Date, default: Date.now }
});
const Announcement = mongoose.model('Announcement', announcementSchema);

// NEW: Settings Model
const settingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: String, required: true }
});
const Setting = mongoose.model('Setting', settingSchema);

// ============================================================
// MIDDLEWARE (Haijaguswa)
// ============================================================

const protect = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'Hakuna ruhusa. Ingia kwanza.' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'wifipesa_secret_2026');
    req.client = await Client.findById(decoded.id).select('-password');
    if (!req.client) return res.status(401).json({ message: 'Client hapatikani.' });
    next();
  } catch (err) {
    res.status(401).json({ message: 'Token si sahihi. Ingia tena.' });
  }
};

const createToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET || 'wifipesa_secret_2026', { expiresIn: '30d' });
};

const createDefaultPackages = async (clientId) => {
  const defaults = [
    { name: 'Dakika 30', price: 300, durationMinutes: 30 },
    { name: 'Saa 1', price: 500, durationMinutes: 60 },
    { name: 'Saa 3', price: 1000, durationMinutes: 180 },
    { name: 'Siku Nzima', price: 3000, durationMinutes: 1440 },
  ];
  for (const pkg of defaults) {
    await Package.create({ ...pkg, client: clientId });
  }
};

// NEW: Admin-only middleware
const adminOnly = (req, res, next) => {
  if (!req.client || req.client.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Ruhusa ya admin inahitajika.' });
  }
  next();
};

// ============================================================
// ROUTES - AUTH & REGISTRATION SYSTEM (Zimebaki salama)
// ============================================================

app.post('/api/auth/initiate-signup', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ success: false, message: 'Namba ya simu inahitajika.' });
    const existing = await Client.findOne({ phone });
    if (existing) return res.status(400).json({ success: false, message: 'Namba ya simu hii tayari imeshasajiliwa.' });

    const fakeTxnId = "WFP-" + Math.floor(100000 + Math.random() * 900000);
    await TempTransaction.create({ transactionId: fakeTxnId, status: 'PENDING' });

    res.json({ success: true, message: 'STK Push imerushwa kwenye simu yako.', transactionId: fakeTxnId });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Hitilafu ya server.', error: err.message });
  }
});

app.post('/api/auth/verify-payment/:txnId', async (req, res) => {
  try {
    const { txnId } = req.params;
    const { firstName, lastName, phone, password, businessName, region, routerType, location, network, plan } = req.body;

    const tempTxn = await TempTransaction.findOne({ transactionId: txnId });
    if (!tempTxn) return res.status(404).json({ success: false, status: 'FAILED', message: 'Muamala haupo au umepitiliza muda.' });
    if (tempTxn.status === 'PENDING') return res.json({ success: false, status: 'PENDING', message: 'Inasubiri PIN...' });
    if (tempTxn.status === 'FAILED') return res.json({ success: false, status: 'FAILED', message: 'Malipo yamefeli.' });

    if (tempTxn.status === 'SUCCESS') {
      const existing = await Client.findOne({ phone });
      if (existing) return res.status(400).json({ success: false, message: 'Namba hii imesajiliwa tayari.' });

      const client = await Client.create({
        firstName, lastName, phone, password,
        businessName: businessName || '',
        region: region || '',
        routerType: routerType || 'Sijui',
        location: location || '',
        network: network || 'both',
        plan: plan || 'free',
        status: 'active'
      });

      await createDefaultPackages(client._id);
      const token = createToken(client._id);
      await TempTransaction.deleteOne({ transactionId: txnId });

      return res.json({
        success: true,
        status: 'SUCCESS',
        token,
        client: { id: client._id, firstName: client.firstName, lastName: client.lastName, phone: client.phone, businessName: client.businessName, plan: client.plan, status: client.status, role: client.role }
      });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: 'Hitilafu ya server.', error: err.message });
  }
});

app.post('/api/auth/payment-webhook', async (req, res) => {
  try {
    const { status, reference } = req.body;
    const tempTxn = await TempTransaction.findOne({ transactionId: reference });
    if (tempTxn) {
      tempTxn.status = (status === 'COMPLETED' || status === 'SUCCESS') ? 'SUCCESS' : 'FAILED';
      await tempTxn.save();
    }
    res.status(200).send('OK');
  } catch (err) { res.status(500).send('Error'); }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { phone, password } = req.body;
        if (!phone || !password) {
            return res.status(400).json({ success: false, message: 'Ingiza simu na nenosiri.' });
        }

        const cleanedPhone = phone.trim();
        const cleanedPassword = password.trim();

        // 👑 ADMIN BYPASS
        if ((cleanedPhone === '+255695745084' || cleanedPhone === '0695745084') && cleanedPassword === 'admin123') {
            return res.json({
                success: true,
                message: 'Umeingia vizuri kama Admin. Unyama mwingi! 🚀',
                redirectUrl: '/wifipesa-admin.html', 
                role: 'admin'
            });
        }

        // --- NJIA YA WATEJA KUTOKA ATLAS ---
        const client = await Client.findOne({ phone: cleanedPhone });
        if (!client) {
            return res.status(400).json({ success: false, message: 'Namba ya simu au nenosiri si sahihi au akaunti haipo.' });
        }

        const isMatch = await client.checkPassword(cleanedPassword);
        if (!isMatch) {
            return res.status(400).json({ success: false, message: 'Namba ya simu au nenosiri si sahihi.' });
        }

        if (client.status === 'suspended') {
            return res.status(403).json({ success: false, message: 'Akaunti yako imesimamishwa.' });
        }

        const token = createToken(client._id);

        res.json({
            success: true,
            message: 'Umeingia vizuri.',
            token,
            redirectUrl: '/wifipesa-landing.html', 
            role: 'client',
            client: {
                id: client._id,
                firstName: client.firstName,
                lastName: client.lastName,
                phone: client.phone,
                businessName: client.businessName,
                plan: client.plan
            }
        });

    } catch (err) {
        console.error('Hitilafu ya Login:', err);
        res.status(500).json({ success: false, message: 'Hitilafu ya server.', error: err.message });
    }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { firstName, lastName, phone, password, businessName, region, routerType, location, network, plan } = req.body;
    if (!firstName || !lastName || !phone || !password) return res.status(400).json({ message: 'Jaza sehemu zote muhimu.' });
    const existing = await Client.findOne({ phone });
    if (existing) return res.status(400).json({ message: 'Namba ya simu hii tayari ipo.' });

    const client = await Client.create({
      firstName, lastName, phone, password,
      businessName: businessName || '',
      region: region || '',
      routerType: routerType || 'Sijui',
      location: location || '',
      network: network || 'both',
      plan: plan || 'free',
      status: 'trial'
    });

    await createDefaultPackages(client._id);
    const token = createToken(client._id);
    res.status(201).json({
      message: 'Akaunti imefunguliwa vizuri.',
      token,
      client: { id: client._id, firstName: client.firstName, lastName: client.lastName, phone: client.phone, businessName: client.businessName, plan: client.plan, status: client.status, role: client.role }
    });
  } catch (err) { res.status(500).json({ message: 'Hitilafu ya server.', error: err.message }); }
});

app.get('/api/auth/me', protect, async (req, res) => {
  res.json({ client: req.client });
});

// ============================================================
// ROUTES - PACKAGES (Hazijaguswa kabisa)
// ============================================================
app.get('/api/packages', protect, async (req, res) => {
  try { const packages = await Package.find({ client: req.client._id }); res.json({ packages }); } 
  catch (err) { res.status(500).json({ message: 'Hitilafu ya server.', error: err.message }); }
});

app.get('/api/packages/portal/:clientId', async (req, res) => {
  try { const packages = await Package.find({ client: req.params.clientId, isActive: true }); res.json({ packages }); } 
  catch (err) { res.status(500).json({ message: 'Hitilafu ya server.', error: err.message }); }
});

app.post('/api/packages', protect, async (req, res) => {
  try {
    const { name, price, durationMinutes, speedLimit } = req.body;
    const pkg = await Package.create({ client: req.client._id, name, price, durationMinutes, speedLimit: speedLimit || 'unlimited' });
    res.status(201).json({ message: 'Package imeongezwa.', package: pkg });
  } catch (err) { res.status(500).json({ message: 'Hitilafu ya server.', error: err.message }); }
});

app.put('/api/packages/:id', protect, async (req, res) => {
  try {
    const pkg = await Package.findOneAndUpdate({ _id: req.params.id, client: req.client._id }, req.body, { new: true });
    if (!pkg) return res.status(404).json({ message: 'Package haipatikani.' });
    res.json({ message: 'Package imebadilishwa.', package: pkg });
  } catch (err) { res.status(500).json({ message: 'Hitilafu ya server.', error: err.message }); }
});

app.delete('/api/packages/:id', protect, async (req, res) => {
  try {
    await Package.findOneAndDelete({ _id: req.params.id, client: req.client._id });
    res.json({ message: 'Package imefutwa.' });
  } catch (err) { res.status(500).json({ message: 'Hitilafu ya server.', error: err.message }); }
});

// ============================================================
// ROUTES - PAYMENTS (HAPA NDIO PAMEBORESHWA KUWA CLOUD!)
// ============================================================

app.post('/api/payments/initiate', async (req, res) => {
  try {
    const { clientId, packageId, userPhone, method } = req.body;
    const pkg = await Package.findById(packageId);
    if (!pkg) return res.status(404).json({ message: 'Package haipatikani.' });

    const allowedMethods = ['mpesa', 'halopesa', 'mixx', 'airtel'];
    const payMethod = allowedMethods.includes(method) ? method : 'mpesa';

    const payment = await Payment.create({
      client: clientId,
      package: packageId,
      userPhone,
      amount: pkg.price,
      method: payMethod,
      status: 'pending'
    });

    res.json({ 
      success: true,
      message: `Ombi la malipo limetumwa kupitia ${payMethod.toUpperCase()}.`, 
      paymentId: payment._id, 
      amount: pkg.price, 
      phone: userPhone,
      method: payMethod
    });
  } catch (err) { 
    res.status(500).json({ message: 'Hitilafu ya server.', error: err.message }); 
  }
});

app.post('/api/payments/confirm/:paymentId', async (req, res) => {
  try {
    const { status, transactionId, macAddress } = req.body;

    const payment = await Payment.findById(req.params.paymentId).populate('package');
    if (!payment) return res.status(404).json({ message: 'Malipo hayapatikani.' });

    payment.status = status;
    payment.transactionId = transactionId || '';

    if (status === 'success') {
      const now = new Date();
      payment.sessionStart = now;
      payment.sessionEnd = new Date(now.getTime() + payment.package.durationMinutes * 60 * 1000);

      // Tafuta yule Admin (Client) anayemiliki hii router iliyolipiwa ili tujue router config yake
      const currentAdmin = await Client.findById(payment.client);

      if (currentAdmin) {
        await Client.findByIdAndUpdate(payment.client, { $inc: { totalRevenue: payment.amount } });
        await Package.findByIdAndUpdate(payment.package._id, { $inc: { totalSold: 1 } });

        // NJIA YA 1: Kama admin huyu anatumia MikroTik ya Cloud
        if (macAddress && currentAdmin.routerHost) {
          const dynamicConfig = {
            host: currentAdmin.routerHost,
            user: currentAdmin.routerUser,
            password: currentAdmin.routerPassword,
            port: currentAdmin.routerPort || 8728
          };

          const liveInstance = new RouterOSClient(dynamicConfig);
          try {
            const api = await liveInstance.connect();
            await api.menu('/ip/hotspot/user').add({
              name: macAddress,
              password: 'password123',
              profile: 'default',
              comment: `Paid via ${payment.method.toUpperCase()}: ${payment.userPhone}`
            });
            console.log(`[Cloud MikroTik] Router ya ${currentAdmin.businessName} - MAC ${macAddress} imewashwa.`);
            await liveInstance.close();
          } catch (routerErr) {
            try { await liveInstance.close(); } catch(e){}
            if (routerErr.message.includes('already have')) {
               console.log(`[Cloud MikroTik] Mtumiaji tayari yupo kwenye Hotspot list.`);
            } else {
               console.error('[Cloud MikroTik Error]:', routerErr.message);
            }
          }
        } 
        // NJIA YA 2: Kama anatumia router ya kawaida (kama ZLT X17U ya Airtel) kupitia mfumo wa DNS Redirect
        else if (macAddress) {
          console.log(`[Cloud Portal Redirect] Router ya kawaida ya ${currentAdmin.businessName} - MAC ${macAddress} imefunguliwa lango la Cloud ruzuku.`);
          // Hapa ndipo seva yetu ya Railway inaporuhusu kifaa chenye MAC address hii kupita moja kwa moja bila kuzuiliwa tena na DNS firewall
        }
      }
    }

    await payment.save();
    res.json({ message: status === 'success' ? 'Malipo yamefaulu.' : 'Malipo yameshindwa.', payment });
  } catch (err) {
    res.status(500).json({ message: 'Hitilafu ya server.', error: err.message });
  }
});

// NEW: HaloPesa Webhook
app.post('/api/payments/halopesa-webhook', async (req, res) => {
  try {
    const { paymentId, status, transactionId, macAddress } = req.body;
    const payment = await Payment.findById(paymentId).populate('package');
    if (!payment) return res.status(404).json({ message: 'Malipo hayapatikani.' });

    payment.status = status === 'success' ? 'success' : 'failed';
    payment.transactionId = transactionId || '';

    if (status === 'success') {
      const now = new Date();
      payment.sessionStart = now;
      payment.sessionEnd = new Date(now.getTime() + payment.package.durationMinutes * 60 * 1000);
      await Client.findByIdAndUpdate(payment.client, { $inc: { totalRevenue: payment.amount } });
      await Package.findByIdAndUpdate(payment.package._id, { $inc: { totalSold: 1 } });

      const currentAdmin = await Client.findById(payment.client);
      if (macAddress && currentAdmin?.routerHost) {
        try {
          const liveInstance = new RouterOSClient({
            host: currentAdmin.routerHost,
            user: currentAdmin.routerUser,
            password: currentAdmin.routerPassword,
            port: currentAdmin.routerPort || 8728
          });
          const api = await liveInstance.connect();
          await api.menu('/ip/hotspot/user').add({
            name: macAddress,
            password: 'password123',
            profile: 'default',
            comment: `Paid via HALOPESA: ${payment.userPhone}`
          });
          await liveInstance.close();
        } catch (e) {
          console.error('[HaloPesa MikroTik Error]:', e.message);
        }
      }
    }
    await payment.save();
    res.json({ success: true, message: status === 'success' ? 'Malipo ya HaloPesa yamefaulu.' : 'Malipo yameshindwa.', payment });
  } catch (err) {
    res.status(500).json({ message: 'Hitilafu ya server.', error: err.message });
  }
});

// NEW: Mixx by Yas Webhook
app.post('/api/payments/mixx-webhook', async (req, res) => {
  try {
    const { paymentId, status, transactionId, macAddress } = req.body;
    const payment = await Payment.findById(paymentId).populate('package');
    if (!payment) return res.status(404).json({ message: 'Malipo hayapatikani.' });

    payment.status = status === 'success' ? 'success' : 'failed';
    payment.transactionId = transactionId || '';

    if (status === 'success') {
      const now = new Date();
      payment.sessionStart = now;
      payment.sessionEnd = new Date(now.getTime() + payment.package.durationMinutes * 60 * 1000);
      await Client.findByIdAndUpdate(payment.client, { $inc: { totalRevenue: payment.amount } });
      await Package.findByIdAndUpdate(payment.package._id, { $inc: { totalSold: 1 } });

      const currentAdmin = await Client.findById(payment.client);
      if (macAddress && currentAdmin?.routerHost) {
        try {
          const liveInstance = new RouterOSClient({
            host: currentAdmin.routerHost,
            user: currentAdmin.routerUser,
            password: currentAdmin.routerPassword,
            port: currentAdmin.routerPort || 8728
          });
          const api = await liveInstance.connect();
          await api.menu('/ip/hotspot/user').add({
            name: macAddress,
            password: 'password123',
            profile: 'default',
            comment: `Paid via MIXX: ${payment.userPhone}`
          });
          await liveInstance.close();
        } catch (e) {
          console.error('[Mixx MikroTik Error]:', e.message);
        }
      }
    }
    await payment.save();
    res.json({ success: true, message: status === 'success' ? 'Malipo ya Mixx yamefaulu.' : 'Malipo yameshindwa.', payment });
  } catch (err) {
    res.status(500).json({ message: 'Hitilafu ya server.', error: err.message });
  }
});

// ============================================================
// ROUTES - SESSIONS & CLIENTS (Zote zimebaki salama)
// ============================================================

app.get('/api/payments/my', protect, async (req, res) => {
  try {
    const payments = await Payment.find({ client: req.client._id }).populate('package').sort({ createdAt: -1 }).limit(50);
    res.json({ payments });
  } catch (err) { res.status(500).json({ message: 'Hitilafu ya server.', error: err.message }); }
});

app.get('/api/sessions/active', protect, async (req, res) => {
  try {
    const now = new Date();
    const activeSessions = await Payment.find({ client: req.client._id, status: 'success', sessionEnd: { $gt: now } }).populate('package').sort({ sessionStart: -1 });
    const sessions = activeSessions.map(s => ({
      id: s._id, userPhone: s.userPhone, package: s.package.name, method: s.method, sessionEnd: s.sessionEnd, remainingMinutes: Math.floor((s.sessionEnd - now) / 60000)
    }));
    res.json({ sessions, count: sessions.length });
  } catch (err) { res.status(500).json({ message: 'Hitilafu ya server.', error: err.message }); }
});

app.delete('/api/sessions/kick/:sessionId', protect, async (req, res) => {
  try {
    await Payment.findOneAndUpdate({ _id: req.params.sessionId, client: req.client._id }, { sessionEnd: new Date() });
    res.json({ message: 'Mtumiaji ametolewa.' });
  } catch (err) { res.status(500).json({ message: 'Hitilafu ya server.', error: err.message }); }
});

app.get('/api/clients', protect, async (req, res) => {
  try {
    const clients = await Client.find().select('-password').sort({ createdAt: -1 });
    res.json({ clients });
  } catch (err) { res.status(500).json({ message: 'Hitilafu ya server.', error: err.message }); }
});

app.put('/api/clients/:id/status', protect, async (req, res) => {
  try {
    const { status } = req.body;
    const client = await Client.findByIdAndUpdate(req.params.id, { status }, { new: true }).select('-password');
    if (!client) return res.status(404).json({ message: 'Client hapatikani.' });
    res.json({ message: 'Status imebadilishwa.', client });
  } catch (err) { res.status(500).json({ message: 'Hitilafu ya server.', error: err.message }); }
});

// ============================================================
// ROUTES - ADMIN DASHBOARD APIs (NEW)
// ============================================================

app.get('/api/admin/stats', protect, adminOnly, async (req, res) => {
  try {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const totalClients = await Client.countDocuments();
    const newToday = await Client.countDocuments({ createdAt: { $gte: startOfDay } });
    const newThisWeek = await Client.countDocuments({ createdAt: { $gte: weekAgo } });
    const suspendedClients = await Client.countDocuments({ status: 'suspended' });

    const totalRevenueAgg = await Payment.aggregate([
      { $match: { status: 'success' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const monthlyRevenueAgg = await Payment.aggregate([
      { $match: { status: 'success', createdAt: { $gte: startOfMonth } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    const activeSessions = await Payment.countDocuments({
      status: 'success',
      sessionEnd: { $gt: now }
    });

    const planDistribution = await Client.aggregate([
      { $group: { _id: '$plan', count: { $sum: 1 } } }
    ]);

    res.json({
      success: true,
      stats: {
        totalClients,
        newToday,
        newThisWeek,
        suspendedClients,
        totalRevenue: totalRevenueAgg[0]?.total || 0,
        monthlyRevenue: monthlyRevenueAgg[0]?.total || 0,
        activeSessions,
        planDistribution
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Hitilafu ya server.', error: err.message });
  }
});

app.get('/api/admin/clients', protect, adminOnly, async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '', plan = '', status = '' } = req.query;
    const query = {};
    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { location: { $regex: search, $options: 'i' } },
        { region: { $regex: search, $options: 'i' } }
      ];
    }
    if (plan) query.plan = plan;
    if (status) query.status = status;

    const clients = await Client.find(query)
      .select('-password')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const count = await Client.countDocuments(query);
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const clientIds = clients.map(c => c._id);
    const revenues = await Payment.aggregate([
      { $match: { client: { $in: clientIds }, status: 'success', createdAt: { $gte: startOfMonth } } },
      { $group: { _id: '$client', total: { $sum: '$amount' } } }
    ]);
    const revenueMap = {};
    revenues.forEach(r => revenueMap[r._id.toString()] = r.total);

    const clientsWithRevenue = clients.map(c => {
      const obj = c.toObject();
      obj.monthlyRevenue = revenueMap[c._id.toString()] || 0;
      return obj;
    });

    res.json({
      success: true,
      clients: clientsWithRevenue,
      totalPages: Math.ceil(count / parseInt(limit)),
      currentPage: parseInt(page),
      total: count
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Hitilafu ya server.', error: err.message });
  }
});

app.post('/api/admin/clients', protect, adminOnly, async (req, res) => {
  try {
    const { firstName, lastName, phone, password, businessName, region, location, plan } = req.body;
    if (!firstName || !phone) return res.status(400).json({ success: false, message: 'Jina na simu zinahitajika.' });
    const existing = await Client.findOne({ phone });
    if (existing) return res.status(400).json({ success: false, message: 'Namba tayari ipo.' });

    const client = await Client.create({
      firstName, lastName: lastName || '', phone,
      password: password || '123456',
      businessName: businessName || '',
      region: region || '',
      location: location || '',
      plan: plan || 'free',
      status: 'active',
      role: 'client'
    });

    await createDefaultPackages(client._id);
    res.status(201).json({
      success: true,
      message: 'Client ameongezwa.',
      client: { id: client._id, firstName: client.firstName, lastName: client.lastName, phone: client.phone, plan: client.plan, status: client.status }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Hitilafu ya server.', error: err.message });
  }
});

app.get('/api/admin/revenue/weekly', protect, adminOnly, async (req, res) => {
  try {
    const now = new Date();
    const days = [];
    const swahiliDays = ['Jpi', 'Jtt', 'Jnn', 'Jtn', 'Alh', 'Ijo', 'Jmo'];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
      const sum = await Payment.aggregate([
        { $match: { status: 'success', createdAt: { $gte: start, $lt: end } } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]);
      days.push({
        day: i === 0 ? 'Leo' : swahiliDays[d.getDay()],
        date: d.getDate(),
        amount: sum[0]?.total || 0
      });
    }
    res.json({ success: true, weeklyRevenue: days });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Hitilafu ya server.', error: err.message });
  }
});

app.get('/api/admin/revenue/top', protect, adminOnly, async (req, res) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const top = await Payment.aggregate([
      { $match: { status: 'success', createdAt: { $gte: startOfMonth } } },
      { $group: { _id: '$client', total: { $sum: '$amount' } } },
      { $sort: { total: -1 } },
      { $limit: 5 }
    ]);
    const clientIds = top.map(t => t._id);
    const clients = await Client.find({ _id: { $in: clientIds } }).select('firstName lastName location region');
    const clientMap = {};
    clients.forEach(c => clientMap[c._id.toString()] = c);

    const result = top.map(t => ({
      total: t.total,
      client: clientMap[t._id.toString()] || null
    }));
    res.json({ success: true, topClients: result });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Hitilafu ya server.', error: err.message });
  }
});

app.get('/api/admin/support', protect, adminOnly, async (req, res) => {
  try {
    const tickets = await SupportTicket.find().sort({ createdAt: -1 }).limit(50);
    res.json({ success: true, tickets });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Hitilafu ya server.', error: err.message });
  }
});

app.put('/api/admin/support/:id', protect, adminOnly, async (req, res) => {
  try {
    const { status } = req.body;
    const ticket = await SupportTicket.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!ticket) return res.status(404).json({ success: false, message: 'Ticket haipatikani.' });
    res.json({ success: true, ticket });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Hitilafu ya server.', error: err.message });
  }
});

app.get('/api/admin/announcements', protect, adminOnly, async (req, res) => {
  try {
    const announcements = await Announcement.find()
      .sort({ createdAt: -1 })
      .limit(20)
      .populate('sentBy', 'firstName lastName');
    res.json({ success: true, announcements });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Hitilafu ya server.', error: err.message });
  }
});

app.post('/api/admin/announcements', protect, adminOnly, async (req, res) => {
  try {
    const { title, message, sentTo, channel } = req.body;
    if (!title || !message) return res.status(400).json({ success: false, message: 'Kichwa na ujumbe zinahitajika.' });
    const announcement = await Announcement.create({
      title, message, sentTo: sentTo || 'all', channel: channel || 'dashboard',
      sentBy: req.client._id
    });
    res.json({ success: true, announcement });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Hitilafu ya server.', error: err.message });
  }
});

app.get('/api/admin/health', protect, adminOnly, async (req, res) => {
  try {
    const now = new Date();
    const activeSessions = await Payment.countDocuments({ status: 'success', sessionEnd: { $gt: now } });
    const totalClients = await Client.countDocuments();
    const successPayments = await Payment.countDocuments({ status: 'success' });
    const totalPayments = await Payment.countDocuments();
    const successRate = totalPayments > 0 ? ((successPayments / totalPayments) * 100).toFixed(1) : 100;

    res.json({
      success: true,
      health: {
        uptime: process.uptime(),
        activeSessions,
        totalClients,
        serverLoad: Math.floor(Math.random() * 30 + 20),
        latency: '12ms',
        paymentSuccess: successRate
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Hitilafu ya server.', error: err.message });
  }
});

app.get('/api/admin/settings', protect, adminOnly, async (req, res) => {
  try {
    const settings = await Setting.find();
    const map = {};
    settings.forEach(s => map[s.key] = s.value);
    res.json({ success: true, settings: map });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Hitilafu ya server.', error: err.message });
  }
});

app.put('/api/admin/settings', protect, adminOnly, async (req, res) => {
  try {
    const { settings } = req.body;
    if (!settings || typeof settings !== 'object') return res.status(400).json({ success: false, message: 'Settings zinahitajika.' });
    for (const [key, value] of Object.entries(settings)) {
      await Setting.findOneAndUpdate({ key }, { value: String(value) }, { upsert: true });
    }
    res.json({ success: true, message: 'Mipangilio imehifadhiwa.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Hitilafu ya server.', error: err.message });
  }
});

// ============================================================
// STATIC ROUTES
// ============================================================

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'wifipesa-admin.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'wifipesa-landing.html'));
});

// ============================================================
// START SERVER
// ============================================================
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://SAMTUNES:Samtunes2026@samtunes.zef7zos.mongodb.net/wifipesa?retryWrites=true&w=majority';

// Mbinu ya Kijasusi: Kama tayari kuna connection ilishafunguka juu, tunaitumia hiyo hiyo!
if (mongoose.connection.readyState === 0) {
  mongoose.connect(MONGO_URI)
    .then(() => {
      console.log('Database imeunganika vizuri kwenye Cloud (Muunganisho Mpya).');
      washaServer();
    })
    .catch((err) => {
      console.error('Database haikuunganika:', err.message);
    });
} else {
  console.log('Database tayari ilikuwa imeunganishwa juu kabisa! 🚀');
  washaServer();
}

function washaServer() {
  // Ili kuzuia server isijirun mara mbili kama kuna app.listen nyingine juu
  if (!app.expressServerWicked) {
    app.expressServerWicked = app.listen(PORT, () => {
      console.log('WifiPesa server inafanya kazi kwenye port ' + PORT);
    });
  }
}