const express = require('express');
const mongoose = require('mongoose');
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

// Mipangilio ya MikroTik (Tutaitumia kutengeneza unganisho jipya kila ombi linapokuja)
const routerConfig = {
  host: '10.5.50.1',            // IP halisi ya ether2 kutoka WinBox
  user: 'admin',               // Username ya WinBox
  password: 'wifipesa2026',    // Password yako ya router
  port: 8728                   // API Port
};

// ============================================================
// MODELS
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

// MODEL MPYA: Kuhifadhi miamala ya muda wakati mtu anajisajili kabla hajalipia
const tempTransactionSchema = new mongoose.Schema({
  transactionId: { type: String, required: true, unique: true },
  status: { type: String, enum: ['PENDING', 'SUCCESS', 'FAILED'], default: 'PENDING' },
  createdAt: { type: Date, default: Date.now, expires: 600 } // Inajifuta baada ya dk 10 isipolipwa
});
const TempTransaction = mongoose.model('TempTransaction', tempTransactionSchema);


// ============================================================
// MIDDLEWARE
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

// ============================================================
// ROUTES - AUTH & REGISTRATION SYSTEM WITH PAYMENTS
// ============================================================

// 1. ANZA USAJILI NA RUSHA STK PUSH (MAJARIBIO YA ID)
app.post('/api/auth/initiate-signup', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ success: false, message: 'Namba ya simu inahitajika.' });

    // Uhakiki kama tayari ana akaunti
    const existing = await Client.findOne({ phone });
    if (existing) return res.status(400).json({ success: false, message: 'Namba ya simu hii tayari imeshasajiliwa.' });

    // --- HAPA BAADAYE UTAPIGA API YA KAMPUNI YA MALIPO KUTUMA STK PUSH ---
    // Kwa sasa tunaunda ID ya uongo ya majaribio
    const fakeTxnId = "WFP-" + Math.floor(100000 + Math.random() * 900000);

    // Kuhifadhi muamala huu kwenye kumbukumbu ya muda ukiwa PENDING
    await TempTransaction.create({ transactionId: fakeTxnId, status: 'PENDING' });

    res.json({
      success: true,
      message: 'STK Push imerushwa kwenye simu yako.',
      transactionId: fakeTxnId
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Hitilafu ya server.', error: err.message });
  }
});

// 2. KAGUA MALIPO (POLLING KILA BAADA YA SEC 3) NA TENGENEZA AKAUNTI IKIKUBALI
app.post('/api/auth/verify-payment/:txnId', async (req, res) => {
  try {
    const { txnId } = req.params;
    const { firstName, lastName, phone, password, businessName, region, routerType, location, network, plan } = req.body;

    const tempTxn = await TempTransaction.findOne({ transactionId: txnId });
    if (!tempTxn) {
      return res.status(404).json({ success: false, status: 'FAILED', message: 'Muamala haupo au umepitiliza muda.' });
    }

    // Kama mteja bado hajaweka PIN
    if (tempTxn.status === 'PENDING') {
      return res.json({ success: false, status: 'PENDING', message: 'Inasubiri PIN...' });
    }

    // Kama muamala umefeli/umesitishwa
    if (tempTxn.status === 'FAILED') {
      return res.json({ success: false, status: 'FAILED', message: 'Malipo yamefeli.' });
    }

    // MALIPO YAMEKUBALIWA (SUCCESS) -> TENGENEZA AKAUNTI RASMI!
    if (tempTxn.status === 'SUCCESS') {
      // Uhakiki wa ulinzi wa sekunde ya mwisho
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
        status: 'active' // Inakuwa active moja kwa moja kwa sababu amelipa
      });

      // Kutengeneza vile vifurushi vyake vya kwanza (Defaults)
      await createDefaultPackages(client._id);
      const token = createToken(client._id);

      // Futa muamala wa muda ili usirudiwe tena
      await TempTransaction.deleteOne({ transactionId: txnId });

      return res.json({
        success: true,
        status: 'SUCCESS',
        token,
        client: {
          id: client._id,
          firstName: client.firstName,
          lastName: client.lastName,
          phone: client.phone,
          businessName: client.businessName,
          plan: client.plan,
          status: client.status
        }
      });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: 'Hitilafu ya server.', error: err.message });
  }
});

// 3. WEBHOOK YA KAMPUNI YA MALIPO KUGEUZA HALI YA MUAMALA (CALLBACK)
app.post('/api/auth/payment-webhook', async (req, res) => {
  try {
    const { status, reference } = req.body; // Mfano wa muundo: { status: 'COMPLETED', reference: 'WFP-123456' }
    
    const tempTxn = await TempTransaction.findOne({ transactionId: reference });
    if (tempTxn) {
      if (status === 'COMPLETED' || status === 'SUCCESS') {
        tempTxn.status = 'SUCCESS';
      } else {
        tempTxn.status = 'FAILED';
      }
      await tempTxn.save();
    }
    res.status(200).send('OK');
  } catch (err) {
    res.status(500).send('Error');
  }
});

// ZAMANI: KODI YA LOGIN (SASA IMEBORESHWA UTAMBUZI WA DATABASE)
app.post('/api/auth/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    if (!phone || !password) return res.status(400).json({ message: 'Ingiza simu na nenosiri.' });

    const client = await Client.findOne({ phone });
    // Kama namba haipo kwenye database kabisa
    if (!client) return res.status(400).json({ message: 'Namba ya simu au nenosiri si sahihi au akaunti haipo.' });

    const isMatch = await client.checkPassword(password);
    if (!isMatch) return res.status(400).json({ message: 'Namba ya simu au nenosiri si sahihi.' });

    if (client.status === 'suspended') {
      return res.status(403).json({ message: 'Akaunti yako imesimamishwa.' });
    }

    const token = createToken(client._id);
    res.json({
      message: 'Umeingia vizuri.',
      token,
      client: {
        id: client._id,
        firstName: client.firstName,
        lastName: client.lastName,
        phone: client.phone,
        businessName: client.businessName,
        plan: client.plan,
        status: client.status
      }
    });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ message: 'Hitilafu ya server.', error: err.message });
  }
});

// KODI YA ZAMANI YA REGISTER YA DIRECT (Tumeiacha kwa usalama wako wa kodi za nyuma)
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
      client: { id: client._id, firstName: client.firstName, lastName: client.lastName, phone: client.phone, businessName: client.businessName, plan: client.plan, status: client.status }
    });
  } catch (err) {
    res.status(500).json({ message: 'Hitilafu ya server.', error: err.message });
  }
});

app.get('/api/auth/me', protect, async (req, res) => {
  res.json({ client: req.client });
});

// ============================================================
// ROUTES - PACKAGES
// ============================================================

app.get('/api/packages', protect, async (req, res) => {
  try {
    const packages = await Package.find({ client: req.client._id });
    res.json({ packages });
  } catch (err) {
    res.status(500).json({ message: 'Hitilafu ya server.', error: err.message });
  }
});

app.get('/api/packages/portal/:clientId', async (req, res) => {
  try {
    const packages = await Package.find({ client: req.params.clientId, isActive: true });
    res.json({ packages });
  } catch (err) {
    res.status(500).json({ message: 'Hitilafu ya server.', error: err.message });
  }
});

app.post('/api/packages', protect, async (req, res) => {
  try {
    const { name, price, durationMinutes, speedLimit } = req.body;
    const pkg = await Package.create({
      client: req.client._id,
      name, price, durationMinutes,
      speedLimit: speedLimit || 'unlimited'
    });
    res.status(201).json({ message: 'Package imeongezwa.', package: pkg });
  } catch (err) {
    res.status(500).json({ message: 'Hitilafu ya server.', error: err.message });
  }
});

app.put('/api/packages/:id', protect, async (req, res) => {
  try {
    const pkg = await Package.findOneAndUpdate(
      { _id: req.params.id, client: req.client._id },
      req.body,
      { new: true }
    );
    if (!pkg) return res.status(404).json({ message: 'Package haipatikani.' });
    res.json({ message: 'Package imebadilishwa.', package: pkg });
  } catch (err) {
    res.status(500).json({ message: 'Hitilafu ya server.', error: err.message });
  }
});

app.delete('/api/packages/:id', protect, async (req, res) => {
  try {
    await Package.findOneAndDelete({ _id: req.params.id, client: req.client._id });
    res.json({ message: 'Package imefutwa.' });
  } catch (err) {
    res.status(500).json({ message: 'Hitilafu ya server.', error: err.message });
  }
});

// ============================================================
// ROUTES - PAYMENTS
// ============================================================

app.post('/api/payments/initiate', async (req, res) => {
  try {
    const { clientId, packageId, userPhone, method } = req.body;
    const pkg = await Package.findById(packageId);
    if (!pkg) return res.status(404).json({ message: 'Package haipatikani.' });

    const payment = await Payment.create({
      client: clientId,
      package: packageId,
      userPhone,
      amount: pkg.price,
      method: method || 'mpesa',
      status: 'pending'
    });

    res.json({
      message: 'Ombi la malipo limetumwa.',
      paymentId: payment._id,
      amount: pkg.price,
      phone: userPhone
    });
  } catch (err) {
    res.status(500).json({ message: 'Hitilafu ya server.', error: err.message });
  }
});

app.post('/api/payments/confirm/:paymentId', async (req, res) => {
  try {
    const { status, transactionId, macAddress } = req.body;

    if (req.params.paymentId === '660000000000000000000001') {
      if (status === 'success' && macAddress) {
        const clientInstance = new RouterOSClient(routerConfig);
        try {
          console.log(`[MikroTik Test] Inafungua unganisho la MikroTik kwenye IP ya 10.5.50.1...`);
          const api = await clientInstance.connect();
          await api.menu('/ip/hotspot/user').add({
            name: macAddress,
            password: 'password123',
            profile: 'default',
            comment: `Test Success: ${transactionId}`
          });
          console.log(`[MikroTik Test] Mtumiaji ${macAddress} amewashwa!`);
          await clientInstance.close(); 
          return res.json({ message: "Malipo yamefaulu (Majaribio ya Router Yamekamilika!)." });
        } catch (routerErr) {
          try { await clientInstance.close(); } catch(e){}
          if (routerErr.message.includes('already have')) {
            console.log(`[MikroTik Test] Ilani: Mtumiaji ${macAddress} tayari alikuwa ameshaongezwa.`);
            return res.json({ message: "Malipo yamefaulu (Mumiaji tayari alikuwa amewashwa!)." });
          }
          console.error('[MikroTik API Error]:', routerErr.message);
          return res.status(500).json({ message: "Router imekataa unganisho.", error: routerErr.message });
        }
      }
    }

    const payment = await Payment.findById(req.params.paymentId).populate('package');
    if (!payment) return res.status(404).json({ message: 'Malipo hayapatikani.' });

    payment.status = status;
    payment.transactionId = transactionId || '';

    if (status === 'success') {
      const now = new Date();
      payment.sessionStart = now;
      payment.sessionEnd = new Date(now.getTime() + payment.package.durationMinutes * 60 * 1000);
      await Client.findByIdAndUpdate(payment.client, { $inc: { totalRevenue: payment.amount } });
      await Package.findByIdAndUpdate(payment.package._id, { $inc: { totalSold: 1 } });

      if (macAddress) {
        const liveInstance = new RouterOSClient(routerConfig);
        try {
          const api = await liveInstance.connect();
          await api.menu('/ip/hotspot/user').add({
            name: macAddress,
            password: 'password123',
            profile: 'default',
            comment: `Paid via ${payment.method.toUpperCase()}: ${payment.userPhone}`
          });
          console.log(`[MikroTik Live] MAC ${macAddress} imewashwa.`);
          await liveInstance.close();
        } catch (routerErr) {
          try { await liveInstance.close(); } catch(e){}
          if (routerErr.message.includes('already have')) {
             console.log(`[MikroTik Live] User tayari yupo.`);
          } else {
             console.error('[MikroTik Live API Error]:', routerErr.message);
          }
        }
      }
    }

    await payment.save();
    res.json({ message: status === 'success' ? 'Malipo yamefaulu.' : 'Malipo yameshindwa.', payment });
  } catch (err) {
    res.status(500).json({ message: 'Hitilafu ya server.', error: err.message });
  }
});

app.get('/api/payments/my', protect, async (req, res) => {
  try {
    const payments = await Payment.find({ client: req.client._id })
      .populate('package')
      .sort({ createdAt: -1 })
      .limit(50);
    res.json({ payments });
  } catch (err) {
    res.status(500).json({ message: 'Hitilafu ya server.', error: err.message });
  }
});

// ============================================================
// ROUTES - SESSIONS
// ============================================================

app.get('/api/sessions/active', protect, async (req, res) => {
  try {
    const now = new Date();
    const activeSessions = await Payment.find({
      client: req.client._id,
      status: 'success',
      sessionEnd: { $gt: now }
    }).populate('package').sort({ sessionStart: -1 });

    const sessions = activeSessions.map(s => ({
      id: s._id,
      userPhone: s.userPhone,
      package: s.package.name,
      method: s.method,
      sessionEnd: s.sessionEnd,
      remainingMinutes: Math.floor((s.sessionEnd - now) / 60000)
    }));

    res.json({ sessions, count: sessions.length });
  } catch (err) {
    res.status(500).json({ message: 'Hitilafu ya server.', error: err.message });
  }
});

app.delete('/api/sessions/kick/:sessionId', protect, async (req, res) => {
  try {
    await Payment.findOneAndUpdate(
      { _id: req.params.sessionId, client: req.client._id },
      { sessionEnd: new Date() }
    );
    res.json({ message: 'Mtumiaji ametolewa.' });
  } catch (err) {
    res.status(500).json({ message: 'Hitilafu ya server.', error: err.message });
  }
});

// ============================================================
// ROUTES - CLIENTS
// ============================================================

app.get('/api/clients', protect, async (req, res) => {
  try {
    const clients = await Client.find().select('-password').sort({ createdAt: -1 });
    res.json({ clients });
  } catch (err) {
    res.status(500).json({ message: 'Hitilafu ya server.', error: err.message });
  }
});

app.put('/api/clients/:id/status', protect, async (req, res) => {
  try {
    const { status } = req.body;
    const client = await Client.findByIdAndUpdate(req.params.id, { status }, { new: true }).select('-password');
    if (!client) return res.status(404).json({ message: 'Client hapatikani.' });
    res.json({ message: 'Status imebadilishwa.', client });
  } catch (err) {
    res.status(500).json({ message: 'Hitilafu ya server.', error: err.message });
  }
});

// ============================================================
// DEFAULT ROUTE
// ============================================================

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'wifipesa-landing.html'));
});

// ============================================================
// START SERVER
// ============================================================

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/wifipesa';

mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('Database imeunganika vizuri.');
    app.listen(PORT, () => {
      console.log(`WifiPesa server inafanya kazi kwenye port ${PORT}`);
      console.log(`Fungua browser: http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Database haikuunganika:', err.message);
  });