// simple-server.js
// Tiny static server + email endpoint for the "Talk to sales" form.
// Now with SMTP verify + a /smtp/debug route to help diagnose config.

const express = require('express');
const path = require('path');
const cors = require('cors');
const nodemailer = require('nodemailer');

const app = express();

// --- config via env ---
const PORT = process.env.PORT || 5500;
const CONTACT_TO = process.env.CONTACT_TO || 'you@example.com'; // where you want to receive inquiries
const CONTACT_FROM = process.env.CONTACT_FROM || 'no-reply@novadeskapp.com'; // from address

// SMTP (use your provider: Google Workspace, SendGrid SMTP, Mailgun SMTP, etc.)
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = +(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';

function digitsOnly(s) {
  return String(s || '').replace(/\D/g, '');
}
function toE164US(input) {
  const d = digitsOnly(input);
  if (d.length !== 10) return null;
  return `+1${d}`;
}
function isValidEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());
}

// static files
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// health
app.get('/health', (_req, res) => res.json({ ok: true }));

// quick SMTP config peek (no secrets)
app.get('/smtp/debug', async (_req, res) => {
  const configured =
    !!SMTP_HOST && !!SMTP_USER && !!SMTP_PASS && !!CONTACT_TO && !!CONTACT_FROM;
  const details = {
    ok: true,
    configured,
    host: SMTP_HOST || '(empty)',
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    haveUser: !!SMTP_USER,
    havePass: !!SMTP_PASS,
    toSet: !!CONTACT_TO,
    fromSet: !!CONTACT_FROM,
  };
  res.json(details);
});

// --- contact endpoint ---
app.post('/contact', async (req, res) => {
  try {
    const { name, email, phone, message } = req.body || {};

    // basic validation (match the browser-side rules)
    if (!name || !isValidEmail(email)) {
      return res.status(400).json({ ok: false, error: 'invalid-input' });
    }
    const e164 = toE164US(phone);
    if (!e164) {
      return res.status(400).json({ ok: false, error: 'invalid-phone' });
    }

    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !CONTACT_TO || !CONTACT_FROM) {
      return res.status(500).json({ ok: false, error: 'server-not-configured' });
    }

    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465, // true for 465, false for 587/25
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });

    // verify SMTP first so we return a clearer error
    try {
      await transporter.verify();
    } catch (e) {
      console.error('SMTP verify failed:', e?.message || e);
      return res.status(500).json({ ok: false, error: 'smtp-verify-failed' });
    }

    const subj = 'New NovaDesk Inquiry';
    const html = `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
        <h2 style="margin:0 0 8px 0">New NovaDesk Inquiry</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Phone:</strong> ${e164}</p>
        ${message ? `<p><strong>Message:</strong><br/>${String(message).replace(/</g,'&lt;')}</p>` : ''}
        <hr/>
        <p style="color:#666;font-size:12px">Sent from novadesk-site</p>
      </div>
    `;
    const text =
`New NovaDesk Inquiry

Name: ${name}
Email: ${email}
Phone: ${e164}
${message ? `Message:\n${message}\n` : ''}`;

    await transporter.sendMail({
      from: CONTACT_FROM,
      to: CONTACT_TO,
      subject: subj,
      text,
      html,
      replyTo: email,
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('contact error:', err?.message || err);
    return res.status(500).json({ ok: false, error: 'send-failed' });
  }
});

// fallback to index.html for root
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`[novadesk-site] listening on http://localhost:${PORT}`);
});
