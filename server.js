// server.js — донат-сервер для Railway
// npm install express crypto cors

const express = require('express');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// ====== КОНФІГ ======
const MERCHANT_ACCOUNT = '1millionclub_net';
const MERCHANT_SECRET = '55086e0511f26650f003b2a71574c9ab496cfaca';
const MERCHANT_DOMAIN = 'stebdash.github.io'; // ← домен де буде donate.html
// ====================

// SSE клієнти (OBS підключається сюди)
let clients = [];

app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  // Пінг кожні 25 сек щоб не відключало
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);

  clients.push(res);
  console.log(`OBS підключився. Всього клієнтів: ${clients.length}`);

  req.on('close', () => {
    clearInterval(ping);
    clients = clients.filter(c => c !== res);
    console.log(`OBS відключився. Клієнтів: ${clients.length}`);
  });
});

function sendToOBS(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  clients.forEach(client => client.write(msg));
  console.log('Надіслано в OBS:', data);
}

// Генерація підпису WayForPay
function generateSignature(params) {
  const str = params.join(';');
  return crypto.createHmac('md5', MERCHANT_SECRET).update(str).digest('hex');
}

// Ендпоінт: створити платіж
app.post('/create-payment', (req, res) => {
  const { name, amount, message } = req.body;

  const orderRef = `donate_${Date.now()}`;
  const orderDate = Math.floor(Date.now() / 1000);
  const productName = 'Донат на стрім';
  const productPrice = parseFloat(amount).toFixed(2);
  const productCount = 1;
  const currency = 'UAH';

  const signatureParams = [
    MERCHANT_ACCOUNT,
    MERCHANT_DOMAIN,
    orderRef,
    orderDate,
    productPrice,
    currency,
    productName,
    productCount,
    productPrice,
  ];

  const signature = generateSignature(signatureParams);

  const fields = {
    merchantAccount: MERCHANT_ACCOUNT,
    merchantDomainName: MERCHANT_DOMAIN,
    orderReference: orderRef,
    orderDate: orderDate,
    amount: productPrice,
    currency: currency,
    orderTimeout: 49000,
    productName: productName,
    productPrice: productPrice,
    productCount: productCount,
    clientFirstName: name,
    merchantSignature: signature,
    language: 'UA',
    // Зберігаємо дані для алерту
    clientAccountId: encodeURIComponent(JSON.stringify({ name, message })),
  };

  res.json({ fields });
});

// Webhook від WayForPay після успішної оплати
app.post('/wayforpay-webhook', (req, res) => {
  const data = req.body;
  console.log('Webhook від WayForPay:', data);

  // Перевірка підпису
  const signParams = [
    data.merchantAccount,
    data.orderReference,
    data.amount,
    data.currency,
    data.authCode,
    data.cardPan,
    data.transactionStatus,
    data.reasonCode,
  ];

  const expectedSig = generateSignature(signParams);

  if (data.merchantSignature !== expectedSig) {
    console.warn('Невірний підпис!');
    return res.json({ status: 'error' });
  }

  if (data.transactionStatus === 'Approved') {
    // Витягуємо ім'я та повідомлення
    let name = 'Анонім';
    let message = '';

    try {
      const extra = JSON.parse(decodeURIComponent(data.clientAccountId || '{}'));
      name = extra.name || 'Анонім';
      message = extra.message || '';
    } catch(e) {}

    // Відправляємо алерт в OBS!
    sendToOBS({
      type: 'donation',
      name,
      amount: data.amount,
      message,
    });
  }

  // Відповідь WayForPay
  const now = Math.floor(Date.now() / 1000);
  const responseSignature = generateSignature([data.orderReference, 'accept', now]);

  res.json({
    orderReference: data.orderReference,
    status: 'accept',
    time: now,
    signature: responseSignature,
  });
});

// Health check
app.get('/', (req, res) => res.send('Донат-сервер працює! 💜'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Сервер запущено на порті ${PORT}`));
