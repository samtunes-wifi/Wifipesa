const mongoose = require('mongoose');

const MONGO_URI = 'mongodb+srv://SAMTUNES:Samtunes2026@samtunes.zef7zos.mongodb.net/';

console.log('🚀 Starting seed script...');
console.log('Connecting to:', MONGO_URI);

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('✅ Connected to MongoDB\n');

    const clientSchema = new mongoose.Schema({
      firstName: String, lastName: String, phone: { type: String, unique: true },
      password: String, businessName: String, region: String, routerType: { type: String, default: 'Sijui' },
      location: String, network: { type: String, default: 'both' }, plan: { type: String, default: 'free' },
      status: { type: String, default: 'trial' }, mpesaNumber: String, airtelNumber: String,
      portalColor: { type: String, default: '#00c853' },
      portalMessage: { type: String, default: 'Karibu! Lipa na upate internet ya haraka.' },
      totalRevenue: { type: Number, default: 0 },
      routerHost: String, routerUser: { type: String, default: 'admin' },
      routerPassword: String, routerPort: { type: Number, default: 8728 },
      role: { type: String, default: 'client', enum: ['client', 'admin'] },
      createdAt: { type: Date, default: Date.now }
    });

    const supportTicketSchema = new mongoose.Schema({
      name: { type: String, required: true }, phone: String,
      issue: { type: String, required: true },
      status: { type: String, default: 'open', enum: ['open', 'resolved'] },
      priority: { type: String, default: 'normal', enum: ['normal', 'urgent'] },
      createdAt: { type: Date, default: Date.now }
    });

    const announcementSchema = new mongoose.Schema({
      title: { type: String, required: true }, message: { type: String, required: true },
      sentTo: { type: String, default: 'all' }, channel: { type: String, default: 'dashboard' },
      sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
      createdAt: { type: Date, default: Date.now }
    });

    const settingSchema = new mongoose.Schema({
      key: { type: String, required: true, unique: true }, value: { type: String, required: true }
    });

    const Client = mongoose.model('Client', clientSchema);
    const SupportTicket = mongoose.model('SupportTicket', supportTicketSchema);
    const Announcement = mongoose.model('Announcement', announcementSchema);
    const Setting = mongoose.model('Setting', settingSchema);

    try {
      // 1. CREATE/UPDATE ADMIN - SAMWEL
      console.log('Step 1: Creating/Updating Admin SAMWEL...');
      const adminExists = await Client.findOne({ phone: '+255695745084' });
      if (adminExists) {
        await Client.updateOne(
          { phone: '+255695745084' },
          { $set: { firstName: 'SAMWEL', lastName: 'Admin', role: 'admin' } }
        );
        console.log('✅ Admin updated to SAMWEL\n');
      } else {
        await Client.create({
          firstName: 'SAMWEL', lastName: 'Admin', phone: '+255695745084',
          password: '$2b$12$ItVF7baaq.mbCNeeiJKSbecf0U32Ur.tmRI/nJ1VuYpFsSJyLMQDK',
          businessName: 'WifiPesa HQ', region: 'Dar es Salaam', routerType: 'Sijui',
          location: 'Head Office', network: 'both', plan: 'pro', status: 'active',
          mpesaNumber: '+255695745084', airtelNumber: '', portalColor: '#00c853',
          portalMessage: 'Karibu! Lipa na upate internet ya haraka.', totalRevenue: 0,
          routerHost: '', routerUser: 'admin', routerPassword: '', routerPort: 8728,
          role: 'admin'
        });
        console.log('✅ Admin SAMWEL created\n');
      }

      // 2. CREATE SUPPORT TICKETS
      console.log('Step 2: Creating support tickets...');
      const tCount = await SupportTicket.countDocuments();
      if (tCount === 0) {
        await SupportTicket.insertMany([
          { name: 'Grace Temba', phone: '+255 762 006 006', issue: 'Payment inashindwa kupita. M-Pesa inakataa.', status: 'open', priority: 'urgent', createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
          { name: 'Amina Salim', phone: '+255 755 004 004', issue: 'Captive portal haitoki baada ya kulipa.', status: 'open', priority: 'normal', createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000) },
          { name: 'Lucia Mwangi', phone: '+255 767 010 010', issue: 'Nataka kubadilisha namba ya M-Pesa yangu.', status: 'open', priority: 'normal', createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        ]);
        console.log('✅ Support tickets created\n');
      } else {
        console.log('⚠️ Tickets already exist\n');
      }

      // 3. CREATE ANNOUNCEMENTS
      console.log('Step 3: Creating announcements...');
      const aCount = await Announcement.countDocuments();
      if (aCount === 0) {
        await Announcement.insertMany([
          { title: 'Matengenezo ya Mfumo', message: 'Mfumo utafanyiwa matengenezo Jumapili saa 4 asubuhi.', sentTo: 'Clients Wote', channel: 'dashboard', sentBy: null, createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) },
          { title: 'Bei Mpya za Mtaalamu', message: 'Bei ya mpango Mtaalamu imebaki ile ile kwa mwezi ujao.', sentTo: 'Mtaalamu', channel: 'dashboard', sentBy: null, createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
        ]);
        console.log('✅ Announcements created\n');
      } else {
        console.log('⚠️ Announcements already exist\n');
      }

      // 4. CREATE SETTINGS
      console.log('Step 4: Creating settings...');
      const sCount = await Setting.countDocuments();
      if (sCount === 0) {
        await Setting.insertMany([
          { key: 'systemName', value: 'WifiPesa' },
          { key: 'adminEmail', value: 'admin@wifipesa.co.tz' },
          { key: 'trialPeriod', value: '14' },
          { key: 'mpesaKey', value: 'sk_live_xxxxxxxxxxx' },
          { key: 'airtelKey', value: 'airtel_live_xxxxxxxx' },
          { key: 'smsKey', value: 'sms_live_xxxxxxxxx' },
          { key: 'halopesaKey', value: 'halopesa_live_xxxxxx' },
          { key: 'mixxKey', value: 'mixx_live_xxxxxxxxx' }
        ]);
        console.log('✅ Settings created\n');
      } else {
        console.log('⚠️ Settings already exist\n');
      }

      // VERIFY
      console.log('========================================');
      console.log('✅ SEED COMPLETE!');
      console.log('========================================');
      console.log('Clients:', await Client.countDocuments());
      console.log('Admins:', await Client.countDocuments({ role: 'admin' }));
      console.log('Support Tickets:', await SupportTicket.countDocuments());
      console.log('Announcements:', await Announcement.countDocuments());
      console.log('Settings:', await Setting.countDocuments());
      console.log('\nAdmin Login: SAMWEL / +255695745084 / admin123');
      console.log('========================================');

    } catch (err) {
      console.error('\n❌ Error during seed:', err.message);
      console.error(err.stack);
    }

    await mongoose.disconnect();
    console.log('\n🔌 Disconnected');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Connection failed:', err.message);
    process.exit(1);
  });
