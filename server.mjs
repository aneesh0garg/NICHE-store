import { createServer } from 'node:http';
import { createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import Razorpay from 'razorpay';

const root = fileURLToPath(new URL('.', import.meta.url));
process.loadEnvFile?.(join(root, '.env'));
const dataDirectory = join(root, 'data');
const assetDirectory = join(dataDirectory, 'assets');
const distDirectory = join(root, 'dist');
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '127.0.0.1';
const razorpayEnabled = process.env.PAYMENT_MODE === 'razorpay';
const razorpay = razorpayEnabled && process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET
  ? new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET })
  : null;
await mkdir(dataDirectory, { recursive: true });
await mkdir(assetDirectory, { recursive: true });
const db = new DatabaseSync(join(dataDirectory, 'creator-storefront.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS creators (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, handle TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL) STRICT;
  CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL) STRICT;
  CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE, type TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, price_minor INTEGER NOT NULL CHECK(price_minor >= 0), currency TEXT NOT NULL, color TEXT NOT NULL, mark TEXT NOT NULL, badge TEXT, active INTEGER NOT NULL DEFAULT 1, sold INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL) STRICT;
  CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, creator_id TEXT NOT NULL REFERENCES creators(id), product_id TEXT NOT NULL REFERENCES products(id), buyer_name TEXT NOT NULL, buyer_email TEXT NOT NULL, amount_minor INTEGER NOT NULL, currency TEXT NOT NULL, state TEXT NOT NULL, provider TEXT NOT NULL, created_at TEXT NOT NULL) STRICT;
  CREATE TABLE IF NOT EXISTS coupons (id TEXT PRIMARY KEY, creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE, code TEXT NOT NULL, percent_off INTEGER NOT NULL CHECK(percent_off BETWEEN 1 AND 100), active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, UNIQUE(creator_id, code)) STRICT;
  CREATE TABLE IF NOT EXISTS refunds (id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE REFERENCES orders(id), creator_id TEXT NOT NULL REFERENCES creators(id), amount_minor INTEGER NOT NULL CHECK(amount_minor >= 0), state TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL) STRICT;
  CREATE TABLE IF NOT EXISTS audit_events (id TEXT PRIMARY KEY, actor_id TEXT, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL) STRICT;
  CREATE TABLE IF NOT EXISTS webhook_events (id TEXT PRIMARY KEY, provider TEXT NOT NULL, provider_event_id TEXT NOT NULL UNIQUE, event_type TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL, received_at TEXT NOT NULL, processed_at TEXT) STRICT;
  CREATE TABLE IF NOT EXISTS product_assets (id TEXT PRIMARY KEY, product_id TEXT NOT NULL UNIQUE REFERENCES products(id) ON DELETE CASCADE, original_name TEXT NOT NULL, mime_type TEXT NOT NULL, storage_key TEXT NOT NULL UNIQUE, byte_size INTEGER NOT NULL, created_at TEXT NOT NULL) STRICT;
  CREATE TABLE IF NOT EXISTS download_grants (token TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE, asset_id TEXT NOT NULL REFERENCES product_assets(id) ON DELETE CASCADE, expires_at TEXT NOT NULL, download_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL) STRICT;
  CREATE TABLE IF NOT EXISTS email_outbox (id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE, recipient TEXT NOT NULL, subject TEXT NOT NULL, html TEXT NOT NULL, status TEXT NOT NULL, provider_message_id TEXT, failure_reason TEXT, created_at TEXT NOT NULL, sent_at TEXT) STRICT;
  CREATE TABLE IF NOT EXISTS storefront_visits (id TEXT PRIMARY KEY, creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE, visitor_id TEXT NOT NULL, visited_on TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(creator_id, visitor_id, visited_on)) STRICT;
`);
// SQLite cannot add a column through CREATE TABLE IF NOT EXISTS. Keep this
// migration inline so existing local MVP databases remain usable.
if (!db.prepare('PRAGMA table_info(products)').all().some((column) => column.name === 'inventory_limit')) {
  db.exec('ALTER TABLE products ADD COLUMN inventory_limit INTEGER CHECK(inventory_limit IS NULL OR inventory_limit >= 0)');
}
const productColumns = db.prepare('PRAGMA table_info(products)').all().map((column) => column.name);
if (!productColumns.includes('external_url')) db.exec('ALTER TABLE products ADD COLUMN external_url TEXT');
if (!productColumns.includes('booking_url')) db.exec('ALTER TABLE products ADD COLUMN booking_url TEXT');
const creatorColumns = db.prepare('PRAGMA table_info(creators)').all().map((column) => column.name);
if (!creatorColumns.includes('bio')) db.exec("ALTER TABLE creators ADD COLUMN bio TEXT NOT NULL DEFAULT ''");
if (!creatorColumns.includes('social_links')) db.exec("ALTER TABLE creators ADD COLUMN social_links TEXT NOT NULL DEFAULT '{}'");
if (!creatorColumns.includes('support_email')) db.exec("ALTER TABLE creators ADD COLUMN support_email TEXT NOT NULL DEFAULT ''");
if (!creatorColumns.includes('delivery_terms')) db.exec("ALTER TABLE creators ADD COLUMN delivery_terms TEXT NOT NULL DEFAULT ''");
if (!creatorColumns.includes('theme')) db.exec("ALTER TABLE creators ADD COLUMN theme TEXT NOT NULL DEFAULT 'violet'");
const orderColumns = db.prepare('PRAGMA table_info(orders)').all().map((column) => column.name);
if (!orderColumns.includes('coupon_code')) db.exec('ALTER TABLE orders ADD COLUMN coupon_code TEXT');
if (!orderColumns.includes('discount_minor')) db.exec('ALTER TABLE orders ADD COLUMN discount_minor INTEGER NOT NULL DEFAULT 0');
if (!orderColumns.includes('access_token')) db.exec('ALTER TABLE orders ADD COLUMN access_token TEXT');
if (!orderColumns.includes('provider_order_id')) db.exec('ALTER TABLE orders ADD COLUMN provider_order_id TEXT');
if (!orderColumns.includes('provider_payment_id')) db.exec('ALTER TABLE orders ADD COLUMN provider_payment_id TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS orders_provider_order_id_unique ON orders(provider_order_id) WHERE provider_order_id IS NOT NULL');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS orders_provider_payment_id_unique ON orders(provider_payment_id) WHERE provider_payment_id IS NOT NULL');
const refundColumns = db.prepare('PRAGMA table_info(refunds)').all().map((column) => column.name);
if (!refundColumns.includes('creator_id')) db.exec("ALTER TABLE refunds ADD COLUMN creator_id TEXT NOT NULL DEFAULT ''");
if (!refundColumns.includes('reason')) db.exec("ALTER TABLE refunds ADD COLUMN reason TEXT NOT NULL DEFAULT ''");
if (!refundColumns.includes('provider_refund_id')) db.exec('ALTER TABLE refunds ADD COLUMN provider_refund_id TEXT');
if (!refundColumns.includes('provider_payment_id')) db.exec('ALTER TABLE refunds ADD COLUMN provider_payment_id TEXT');
if (!refundColumns.includes('processed_at')) db.exec('ALTER TABLE refunds ADD COLUMN processed_at TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS refunds_provider_refund_id_unique ON refunds(provider_refund_id) WHERE provider_refund_id IS NOT NULL');

const now = () => new Date().toISOString();
const first = (sql, ...parameters) => db.prepare(sql).get(...parameters);
const all = (sql, ...parameters) => db.prepare(sql).all(...parameters);
const run = (sql, ...parameters) => db.prepare(sql).run(...parameters);
const audit = (actorId, action, entityType, entityId, metadata = {}) => run('INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', `audit_${randomUUID().replaceAll('-', '').slice(0, 16)}`, actorId, action, entityType, entityId, JSON.stringify(metadata), now());
const productId = () => `prod_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
const passwordHash = (password) => { const salt = randomBytes(16).toString('hex'); return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`; };
const safeEqual = (left, right) => left.length === right.length && timingSafeEqual(left, right);
const passwordMatches = (password, saved) => { const [salt, digest] = saved.split(':'); return Boolean(salt && digest) && safeEqual(scryptSync(password, salt, 64), Buffer.from(digest, 'hex')); };
function settleRazorpayPayment(order, paymentId, source) {
  if (order.state === 'paid' && order.provider_payment_id === paymentId) return { status: 200, body: { success: true, purchaseLibraryUrl: `/purchases/${order.access_token}`, alreadyProcessed: true } };
  if (order.state !== 'payment_pending') return { status: 409, body: { error: 'This payment has already been processed.' } };
  db.exec('BEGIN IMMEDIATE');
  try {
    const inventory = run('UPDATE products SET sold = sold + 1 WHERE id = ? AND active = 1 AND (inventory_limit IS NULL OR sold < inventory_limit)', order.product_id);
    if (inventory.changes !== 1) { db.exec('ROLLBACK'); return { status: 409, body: { error: 'This product sold out before payment could be completed. Contact support for help with your payment.' } }; }
    const updated = run("UPDATE orders SET state = 'paid', provider_payment_id = ? WHERE id = ? AND state = 'payment_pending'", paymentId, order.id);
    if (updated.changes !== 1) { db.exec('ROLLBACK'); return { status: 409, body: { error: 'This payment has already been processed.' } }; }
    audit(null, 'order.paid', 'order', order.id, { creatorId: order.creator_id, productId: order.product_id, amountMinor: order.amount_minor, provider: 'razorpay', providerPaymentId: paymentId, source });
    db.exec('COMMIT');
    queueReceipt(order);
    return { status: 200, body: { success: true, purchaseLibraryUrl: `/purchases/${order.access_token}` } };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
function settleRazorpayRefund(refund, providerRefund, source) {
  if (!refund || !providerRefund?.id || providerRefund.payment_id !== refund.provider_payment_id || providerRefund.amount !== refund.amount_minor) return { status: 409, body: { error: 'Refund details did not match the original payment.' } };
  const providerState = String(providerRefund.status || 'pending');
  if (!['pending', 'processed', 'failed'].includes(providerState)) return { status: 409, body: { error: 'Razorpay returned an unsupported refund status.' } };
  if (refund.state === 'processed' && providerState === 'processed') return { status: 200, body: { success: true, alreadyProcessed: true } };
  db.exec('BEGIN IMMEDIATE');
  try {
    if (providerState === 'processed') {
      run("UPDATE orders SET state = 'refunded' WHERE id = ? AND state = 'paid'", refund.order_id);
      run("UPDATE refunds SET state = 'processed', processed_at = ? WHERE id = ?", now(), refund.id);
      audit(null, 'refund.processed', 'refund', refund.id, { orderId: refund.order_id, providerRefundId: providerRefund.id, source });
    } else {
      run('UPDATE refunds SET state = ? WHERE id = ?', providerState, refund.id);
      audit(null, providerState === 'failed' ? 'refund.failed' : 'refund.pending', 'refund', refund.id, { orderId: refund.order_id, providerRefundId: providerRefund.id, source });
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return { status: 200, body: { success: true, refundState: providerState } };
}

if (!first('SELECT id FROM creators WHERE handle = ?', 'mayahq')) {
  const createdAt = now();
  run('INSERT INTO creators (id, email, name, handle, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)', 'creator_maya', 'maya@mayahq.test', 'Maya Lim', 'mayahq', passwordHash('demo-password-2026'), createdAt);
  const products = [
    ['notion-kit', 'Digital download', 'The Freelance OS', 'A calm, complete Notion workspace for running your independent business.', 1499, 'lavender', '⌘', 'Bestseller', 24],
    ['audit', '1:1 session', 'Portfolio audit', 'A focused 45-minute review to help your work get the attention it deserves.', 2499, 'peach', '↗', null, 11],
    ['guide', 'Digital download', 'The clear pitch guide', 'The scripts and frameworks I use to turn warm leads into kind yeses.', 599, 'mint', '✦', null, 7]
  ];
  for (const product of products) run('INSERT INTO products (id, creator_id, type, title, description, price_minor, currency, color, mark, badge, sold, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', product[0], 'creator_maya', product[1], product[2], product[3], product[4], 'INR', product[5], product[6], product[7], product[8], createdAt);
}

const colors = ['lavender', 'peach', 'mint'];
const parseSocialLinks = (value) => { try { const links = JSON.parse(value || '{}'); return links && typeof links === 'object' && !Array.isArray(links) ? links : {}; } catch { return {}; } };
const serializeCreator = (row) => ({ id: row.id, name: row.name, handle: row.handle, email: row.email, bio: row.bio || '', supportEmail: row.support_email || row.email, deliveryTerms: row.delivery_terms || '', theme: row.theme || 'violet', socialLinks: parseSocialLinks(row.social_links) });
const serializeProduct = (row) => {
  const inventoryLimit = row.inventory_limit ?? null;
  const inventoryRemaining = inventoryLimit === null ? null : Math.max(inventoryLimit - row.sold, 0);
  return { id: row.id, type: row.type, title: row.title, desc: row.description, price: row.price_minor, currency: row.currency, color: row.color, mark: row.mark, badge: row.badge, active: Boolean(row.active), sold: row.sold, externalUrl: row.external_url || null, bookingUrl: row.booking_url || null, inventoryLimit, inventoryRemaining, soldOut: inventoryRemaining === 0 };
};
const serializePublicProduct = (row) => { const { bookingUrl, ...product } = serializeProduct(row); return product; };
const serializeCoupon = (row) => ({ id: row.id, code: row.code, percentOff: row.percent_off, active: Boolean(row.active), createdAt: row.created_at });
function parseCookies(req) { return Object.fromEntries((req.headers.cookie || '').split(';').map((part) => part.trim().split(/=(.*)/s)).filter(([key]) => key).map(([key, value]) => [key, decodeURIComponent(value || '')])); }
function sessionCreator(req) { const token = parseCookies(req).creator_session; if (!token) return null; return first('SELECT creators.id, creators.name, creators.handle, creators.email, creators.bio, creators.social_links, creators.support_email, creators.delivery_terms, creators.theme FROM sessions JOIN creators ON creators.id = sessions.creator_id WHERE sessions.token = ? AND sessions.expires_at > ?', token, now()) || null; }
function setSession(res, creatorId) { const token = randomBytes(32).toString('base64url'); run('INSERT INTO sessions (token, creator_id, expires_at, created_at) VALUES (?, ?, ?, ?)', token, creatorId, new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(), now()); res.setHeader('Set-Cookie', `creator_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`); }
function clearSession(req, res) { const token = parseCookies(req).creator_session; if (token) run('DELETE FROM sessions WHERE token = ?', token); res.setHeader('Set-Cookie', 'creator_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'); }
function json(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }
function csv(res, filename, rows) { const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`; const body = rows.map((row) => row.map(escape).join(',')).join('\n'); res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' }); res.end(body); }
function readBody(req, maxBytes = 100_000) { return new Promise((resolve, reject) => { let body = ''; req.on('data', (chunk) => { body += chunk; if (body.length > maxBytes) reject(new Error('Request body is too large.')); }); req.on('end', () => resolve(body)); req.on('error', reject); }); }
async function readJson(req, maxBytes) { const body = await readBody(req, maxBytes); try { return body ? JSON.parse(body) : {}; } catch { throw new Error('Invalid JSON body.'); } }
function requireCreator(req, res) { const creator = sessionCreator(req); if (!creator) { json(res, 401, { error: 'Sign in to continue.' }); return null; } return creator; }
const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value || '');
const validHandle = (value) => /^[a-z0-9][a-z0-9-]{2,29}$/.test(value || '');
const validInventoryLimit = (value) => value === null || (Number.isInteger(value) && value >= 0);
const validSocialUrl = (value) => { if (value === '') return true; try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; } };
const validCouponCode = (value) => /^[A-Z0-9][A-Z0-9-]{2,23}$/.test(value);
const validThemes = new Set(['violet', 'sage', 'terracotta']);
const allowedAssetMimeTypes = new Set(['application/pdf', 'application/zip', 'application/json', 'text/plain', 'text/csv', 'image/png', 'image/jpeg']);
const maxAssetBytes = 5 * 1024 * 1024;
const safeAssetName = (name) => String(name || 'download').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 120) || 'download';
const htmlEscape = (value) => String(value || '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const purchaseUrl = (token) => `${String(process.env.APP_URL || '').replace(/\/$/, '')}/purchases/${token}`;
function issueDownloadGrant(order, asset) {
  const existing = first('SELECT token, expires_at FROM download_grants WHERE order_id = ? AND asset_id = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 1', order.id, asset.id, now());
  if (existing) return `/api/downloads/${existing.token}`;
  const token = randomBytes(32).toString('base64url');
  run('INSERT INTO download_grants (token, order_id, asset_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)', token, order.id, asset.id, new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(), now());
  return `/api/downloads/${token}`;
}
async function dispatchReceipt(messageId) {
  const message = first('SELECT * FROM email_outbox WHERE id = ? AND status IN (?, ?)', messageId, 'queued', 'failed');
  if (!message || !process.env.RESEND_API_KEY || !process.env.RECEIPT_FROM_EMAIL) return;
  run('UPDATE email_outbox SET status = ?, failure_reason = NULL WHERE id = ?', 'sending', message.id);
  try {
    const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Idempotency-Key': `niche-receipt/${message.order_id}` }, body: JSON.stringify({ from: process.env.RECEIPT_FROM_EMAIL, to: [message.recipient], subject: message.subject, html: message.html }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result?.message || `Resend returned ${response.status}`);
    run('UPDATE email_outbox SET status = ?, provider_message_id = ?, sent_at = ? WHERE id = ?', 'sent', String(result.id || ''), now(), message.id);
  } catch (error) { run('UPDATE email_outbox SET status = ?, failure_reason = ? WHERE id = ?', 'failed', String(error?.message || 'Email delivery failed.').slice(0, 500), message.id); }
}
function queueReceipt(order) {
  const product = first('SELECT title FROM products WHERE id = ?', order.product_id);
  const message = { id: `email_${randomUUID().replaceAll('-', '').slice(0, 16)}`, orderId: order.id, recipient: order.buyer_email, subject: `Your NICHE store receipt — ${product?.title || 'purchase'}`, html: `<main><h1>Thanks for your purchase.</h1><p>Your payment for <strong>${htmlEscape(product?.title || 'your item')}</strong> was received.</p><p><a href="${htmlEscape(purchaseUrl(order.access_token))}">Open your purchase library</a></p><p>Order reference: ${htmlEscape(order.id)}</p></main>`, createdAt: now() };
  const inserted = run('INSERT OR IGNORE INTO email_outbox (id, order_id, recipient, subject, html, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', message.id, message.orderId, message.recipient, message.subject, message.html, 'queued', message.createdAt);
  if (inserted.changes === 1) void dispatchReceipt(message.id);
}
const rateLimitWindows = new Map();
function isRateLimited(req, scope, maxAttempts, windowMs) {
  const timestamp = Date.now();
  const key = `${scope}:${req.socket.remoteAddress || 'unknown'}`;
  const record = rateLimitWindows.get(key);
  if (!record || timestamp - record.startedAt >= windowMs) { rateLimitWindows.set(key, { startedAt: timestamp, count: 1 }); return false; }
  record.count += 1;
  if (record.count > maxAttempts) return true;
  return false;
}

function dashboard(creatorId) {
  const products = all('SELECT * FROM products WHERE creator_id = ? ORDER BY created_at DESC', creatorId).map(serializeProduct);
  const recentOrders = all('SELECT orders.*, products.title AS product_title, refunds.state AS refund_state FROM orders JOIN products ON products.id = orders.product_id LEFT JOIN refunds ON refunds.order_id = orders.id WHERE orders.creator_id = ? ORDER BY orders.created_at DESC LIMIT 5', creatorId).map((order) => ({ id: order.id, buyerName: order.buyer_name, amountMinor: order.amount_minor, currency: order.currency, state: order.state, refundState: order.refund_state || null, createdAt: order.created_at, product: { title: order.product_title } }));
  const totals = first("SELECT COALESCE(SUM(amount_minor), 0) AS sales, COUNT(*) AS orders FROM orders WHERE creator_id = ? AND state IN ('paid', 'test_paid')", creatorId);
  const visits = first('SELECT COUNT(*) AS count FROM storefront_visits WHERE creator_id = ?', creatorId).count;
  const conversion = visits ? Number((totals.orders / visits * 100).toFixed(2)) : 0;
  const topProducts = all("SELECT products.id, products.title, COALESCE(SUM(orders.amount_minor), 0) AS sales_minor, COUNT(orders.id) AS order_count FROM products LEFT JOIN orders ON orders.product_id = products.id AND orders.state IN ('paid', 'test_paid') WHERE products.creator_id = ? GROUP BY products.id ORDER BY sales_minor DESC, order_count DESC, products.created_at DESC LIMIT 5", creatorId).map((row) => ({ id: row.id, title: row.title, salesMinor: row.sales_minor, orderCount: row.order_count }));
  return { summary: { totalSalesMinor: totals.sales, orderCount: totals.orders, visits, conversion }, products, recentOrders, topProducts };
}
function serializeOrder(row) { return { id: row.id, buyerName: row.buyer_name, buyerEmail: row.buyer_email, amountMinor: row.amount_minor, discountMinor: row.discount_minor || 0, couponCode: row.coupon_code || null, currency: row.currency, state: row.state, refundState: row.refund_state || null, createdAt: row.created_at, product: { id: row.product_id, title: row.product_title } }; }
function serializePurchase(row) { return { id: row.id, amountMinor: row.amount_minor, currency: row.currency, state: row.state, purchasedAt: row.created_at, product: { id: row.product_id, title: row.product_title, type: row.product_type, description: row.product_description, externalUrl: row.external_url || null, bookingUrl: row.booking_url || null } }; }

async function handleApi(req, res, url) {
  if (req.method === 'POST' && url.pathname.startsWith('/api/auth/') && isRateLimited(req, 'auth', 10, 60_000)) return json(res, 429, { error: 'Too many sign-in attempts. Please try again in a minute.' });
  if (req.method === 'POST' && ['/api/checkout', '/api/create-order', '/api/verify-payment'].includes(url.pathname) && isRateLimited(req, 'checkout', 30, 60_000)) return json(res, 429, { error: 'Too many checkout attempts. Please try again in a minute.' });
  if (req.method === 'GET' && url.pathname === '/api/storefront') { const handle = (url.searchParams.get('handle') || 'mayahq').toLowerCase(); const creator = first('SELECT * FROM creators WHERE handle = ?', handle); if (!creator) return json(res, 404, { error: 'Storefront not found.' }); const cookies = parseCookies(req); const visitorId = cookies.niche_visitor || randomBytes(18).toString('base64url'); const visitedOn = now().slice(0, 10); run('INSERT OR IGNORE INTO storefront_visits (id, creator_id, visitor_id, visited_on, created_at) VALUES (?, ?, ?, ?, ?)', `visit_${randomUUID().replaceAll('-', '').slice(0, 16)}`, creator.id, visitorId, visitedOn, now()); if (!cookies.niche_visitor) res.setHeader('Set-Cookie', `niche_visitor=${visitorId}; SameSite=Lax; Path=/; Max-Age=31536000`); return json(res, 200, { creator: serializeCreator(creator), products: all('SELECT * FROM products WHERE creator_id = ? AND active = 1 ORDER BY created_at DESC', creator.id).map(serializePublicProduct) }); }
  if (req.method === 'GET' && url.pathname === '/api/auth/me') { const creator = sessionCreator(req); return json(res, 200, { creator: creator ? serializeCreator(creator) : null }); }
  if (req.method === 'POST' && url.pathname === '/api/auth/register') {
    const { name, email, handle, password } = await readJson(req); const normalizedEmail = String(email || '').trim().toLowerCase(); const normalizedHandle = String(handle || '').trim().toLowerCase();
    if (String(name || '').trim().length < 2 || !validEmail(normalizedEmail) || !validHandle(normalizedHandle) || String(password || '').length < 10) return json(res, 400, { error: 'Enter a name, valid email, 3–30 character handle, and password with at least 10 characters.' });
    if (first('SELECT id FROM creators WHERE email = ? OR handle = ?', normalizedEmail, normalizedHandle)) return json(res, 409, { error: 'That email or handle is already in use.' });
    const creator = { id: `creator_${randomUUID().replaceAll('-', '').slice(0, 16)}`, name: String(name).trim(), email: normalizedEmail, handle: normalizedHandle }; run('INSERT INTO creators (id, email, name, handle, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)', creator.id, creator.email, creator.name, creator.handle, passwordHash(password), now()); setSession(res, creator.id); return json(res, 201, { creator });
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/login') { const { email, password } = await readJson(req); const creator = first('SELECT * FROM creators WHERE email = ?', String(email || '').trim().toLowerCase()); if (!creator || !passwordMatches(String(password || ''), creator.password_hash)) return json(res, 401, { error: 'Incorrect email or password.' }); setSession(res, creator.id); return json(res, 200, { creator: serializeCreator(creator) }); }
  if (req.method === 'POST' && url.pathname === '/api/auth/logout') { clearSession(req, res); return json(res, 204, {}); }
  if (req.method === 'GET' && url.pathname === '/api/dashboard') { const creator = requireCreator(req, res); if (!creator) return; return json(res, 200, dashboard(creator.id)); }
  if (req.method === 'GET' && url.pathname === '/api/orders') { const creator = requireCreator(req, res); if (!creator) return; const query = String(url.searchParams.get('q') || '').trim().slice(0, 100); const pattern = `%${query.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`; const orders = query ? all("SELECT orders.*, products.title AS product_title, refunds.state AS refund_state FROM orders JOIN products ON products.id = orders.product_id LEFT JOIN refunds ON refunds.order_id = orders.id WHERE orders.creator_id = ? AND (orders.id LIKE ? ESCAPE '\\' OR orders.buyer_email LIKE ? ESCAPE '\\' OR orders.buyer_name LIKE ? ESCAPE '\\' OR products.title LIKE ? ESCAPE '\\') ORDER BY orders.created_at DESC LIMIT 50", creator.id, pattern, pattern, pattern, pattern) : all('SELECT orders.*, products.title AS product_title, refunds.state AS refund_state FROM orders JOIN products ON products.id = orders.product_id LEFT JOIN refunds ON refunds.order_id = orders.id WHERE orders.creator_id = ? ORDER BY orders.created_at DESC LIMIT 50', creator.id); return json(res, 200, { orders: orders.map(serializeOrder) }); }
  if (req.method === 'GET' && url.pathname === '/api/orders/export.csv') { const creator = requireCreator(req, res); if (!creator) return; const orders = all('SELECT orders.*, products.title AS product_title, refunds.state AS refund_state FROM orders JOIN products ON products.id = orders.product_id LEFT JOIN refunds ON refunds.order_id = orders.id WHERE orders.creator_id = ? ORDER BY orders.created_at DESC', creator.id); return csv(res, `niche-store-orders-${new Date().toISOString().slice(0, 10)}.csv`, [['Order ID', 'Buyer name', 'Buyer email', 'Product', 'Amount minor', 'Currency', 'State', 'Refund status', 'Coupon', 'Discount minor', 'Created at'], ...orders.map((order) => [order.id, order.buyer_name, order.buyer_email, order.product_title, order.amount_minor, order.currency, order.state, order.refund_state, order.coupon_code, order.discount_minor, order.created_at])]); }
  if (req.method === 'GET' && /^\/api\/downloads\/[A-Za-z0-9_-]{32,}$/.test(url.pathname)) {
    const token = url.pathname.split('/')[3];
    const download = first("SELECT download_grants.*, product_assets.original_name, product_assets.mime_type, product_assets.storage_key FROM download_grants JOIN product_assets ON product_assets.id = download_grants.asset_id JOIN orders ON orders.id = download_grants.order_id WHERE download_grants.token = ? AND download_grants.expires_at > ? AND orders.state IN ('paid', 'test_paid')", token, now());
    if (!download) return json(res, 404, { error: 'This download link is unavailable or has expired.' });
    try {
      const file = await readFile(join(assetDirectory, download.storage_key));
      run('UPDATE download_grants SET download_count = download_count + 1 WHERE token = ?', token);
      res.writeHead(200, { 'Content-Type': download.mime_type, 'Content-Disposition': `attachment; filename="${safeAssetName(download.original_name)}"`, 'Content-Length': String(file.length), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
      return res.end(file);
    } catch { return json(res, 404, { error: 'The requested download file is unavailable.' }); }
  }
  if (req.method === 'GET' && /^\/api\/purchases\/[A-Za-z0-9_-]{20,}$/.test(url.pathname)) {
    const accessToken = url.pathname.split('/')[3];
    const purchase = first('SELECT orders.*, products.title AS product_title, products.type AS product_type, products.description AS product_description, products.external_url, products.booking_url, product_assets.id AS asset_id, product_assets.original_name AS asset_name FROM orders JOIN products ON products.id = orders.product_id LEFT JOIN product_assets ON product_assets.product_id = products.id WHERE orders.access_token = ?', accessToken);
    if (!purchase) return json(res, 404, { error: 'Purchase library not found.' });
    const serialized = serializePurchase(purchase);
    if (purchase.asset_id && ['paid', 'test_paid'].includes(purchase.state)) serialized.product.downloadUrl = issueDownloadGrant(purchase, { id: purchase.asset_id });
    if (purchase.asset_name) serialized.product.assetName = purchase.asset_name;
    return json(res, 200, { purchases: [serialized] });
  }
  if (req.method === 'POST' && /^\/api\/orders\/[^/]+\/refund$/.test(url.pathname)) {
    const creator = requireCreator(req, res); if (!creator) return;
    const orderId = decodeURIComponent(url.pathname.split('/')[3]);
    const { reason = '' } = await readJson(req);
    const order = first('SELECT * FROM orders WHERE id = ? AND creator_id = ?', orderId, creator.id);
    if (!order) return json(res, 404, { error: 'Order not found.' });
    if (first('SELECT id FROM refunds WHERE order_id = ?', order.id)) return json(res, 409, { error: 'A refund was already requested for this order.' });
    const refund = { id: `refund_${randomUUID().replaceAll('-', '').slice(0, 16)}`, orderId: order.id, creatorId: creator.id, amountMinor: order.amount_minor, reason: String(reason).trim().slice(0, 280), createdAt: now() };
    if (order.provider === 'local_test') {
      if (order.state !== 'test_paid') return json(res, 409, { error: 'This order cannot be refunded.' });
      refund.state = 'test_refunded';
      db.exec('BEGIN IMMEDIATE');
      try {
        const updated = run("UPDATE orders SET state = 'test_refunded' WHERE id = ? AND state = 'test_paid'", order.id);
        if (updated.changes !== 1) { db.exec('ROLLBACK'); return json(res, 409, { error: 'This order was already refunded.' }); }
        run('INSERT INTO refunds (id, order_id, creator_id, amount_minor, state, reason, created_at, processed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', refund.id, refund.orderId, refund.creatorId, refund.amountMinor, refund.state, refund.reason, refund.createdAt, refund.createdAt);
        audit(creator.id, 'refund.created', 'refund', refund.id, { orderId: order.id, amountMinor: refund.amountMinor, provider: 'local_test' });
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return json(res, 201, { refund });
    }
    if (order.provider !== 'razorpay' || order.state !== 'paid' || !order.provider_payment_id) return json(res, 409, { error: 'This order cannot be refunded.' });
    if (!razorpay) return json(res, 503, { error: 'Razorpay is not configured for refunds.' });
    let providerRefund;
    try {
      providerRefund = await razorpay.payments.refund(order.provider_payment_id, { amount: order.amount_minor, receipt: refund.id, notes: { local_order_id: order.id, reason: refund.reason || 'Creator initiated refund' } });
    } catch (error) {
      console.error('Razorpay refund creation failed:', error?.description || error?.message || error);
      const status = Number(error?.statusCode) === 401 ? 401 : 500;
      return json(res, status, { error: status === 401 ? 'Razorpay authentication failed. Check the server credentials.' : 'Could not create the refund. No refund was recorded; please try again.' });
    }
    if (!providerRefund?.id || providerRefund.payment_id !== order.provider_payment_id || providerRefund.amount !== order.amount_minor) return json(res, 502, { error: 'Razorpay returned an invalid refund response. Contact support before retrying.' });
    refund.state = String(providerRefund.status || 'pending');
    if (!['pending', 'processed', 'failed'].includes(refund.state)) return json(res, 502, { error: 'Razorpay returned an unsupported refund status. Contact support before retrying.' });
    db.exec('BEGIN IMMEDIATE');
    try {
      run('INSERT INTO refunds (id, order_id, creator_id, amount_minor, state, reason, provider_refund_id, provider_payment_id, created_at, processed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', refund.id, refund.orderId, refund.creatorId, refund.amountMinor, refund.state, refund.reason, providerRefund.id, order.provider_payment_id, refund.createdAt, refund.state === 'processed' ? refund.createdAt : null);
      if (refund.state === 'processed') run("UPDATE orders SET state = 'refunded' WHERE id = ? AND state = 'paid'", order.id);
      audit(creator.id, refund.state === 'processed' ? 'refund.processed' : 'refund.requested', 'refund', refund.id, { orderId: order.id, amountMinor: refund.amountMinor, provider: 'razorpay', providerRefundId: providerRefund.id });
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return json(res, 201, { refund, providerStatus: refund.state });
  }
  if (req.method === 'PATCH' && url.pathname === '/api/creator/profile') { const creator = requireCreator(req, res); if (!creator) return; const { name, bio, socialLinks, supportEmail, deliveryTerms, theme } = await readJson(req); const nextName = String(name ?? creator.name).trim(); const nextBio = String(bio ?? '').trim(); const nextDeliveryTerms = String(deliveryTerms ?? (creator.delivery_terms || '')).trim(); const nextTheme = String(theme ?? (creator.theme || 'violet')); const nextSupportEmail = String(supportEmail ?? (creator.support_email || creator.email)).trim().toLowerCase(); const links = socialLinks && typeof socialLinks === 'object' && !Array.isArray(socialLinks) ? { instagram: String(socialLinks.instagram || '').trim(), newsletter: String(socialLinks.newsletter || '').trim(), linkedin: String(socialLinks.linkedin || '').trim() } : null; if (nextName.length < 2 || nextName.length > 80 || nextBio.length > 500 || nextDeliveryTerms.length > 500 || !validEmail(nextSupportEmail) || !validThemes.has(nextTheme)) return json(res, 400, { error: 'Use valid profile details and one of the available storefront themes.' }); if (!links || Object.values(links).some((link) => !validSocialUrl(link))) return json(res, 400, { error: 'Social links must be valid http or https URLs.' }); run('UPDATE creators SET name = ?, bio = ?, social_links = ?, support_email = ?, delivery_terms = ?, theme = ? WHERE id = ?', nextName, nextBio, JSON.stringify(links), nextSupportEmail, nextDeliveryTerms, nextTheme, creator.id); return json(res, 200, { creator: serializeCreator({ ...creator, name: nextName, bio: nextBio, social_links: JSON.stringify(links), support_email: nextSupportEmail, delivery_terms: nextDeliveryTerms, theme: nextTheme }) }); }
  if (req.method === 'GET' && url.pathname === '/api/coupons') { const creator = requireCreator(req, res); if (!creator) return; return json(res, 200, { coupons: all('SELECT * FROM coupons WHERE creator_id = ? ORDER BY created_at DESC', creator.id).map(serializeCoupon) }); }
  if (req.method === 'POST' && url.pathname === '/api/coupons') { const creator = requireCreator(req, res); if (!creator) return; const { code, percentOff } = await readJson(req); const normalizedCode = String(code || '').trim().toUpperCase(); if (!validCouponCode(normalizedCode) || !Number.isInteger(percentOff) || percentOff < 1 || percentOff > 100) return json(res, 400, { error: 'Use a 3–24 character coupon code and a discount from 1% to 100%.' }); if (first('SELECT id FROM coupons WHERE creator_id = ? AND code = ?', creator.id, normalizedCode)) return json(res, 409, { error: 'That coupon code already exists.' }); const coupon = { id: `coupon_${randomUUID().replaceAll('-', '').slice(0, 16)}`, creatorId: creator.id, code: normalizedCode, percentOff, active: 1, createdAt: now() }; run('INSERT INTO coupons (id, creator_id, code, percent_off, active, created_at) VALUES (?, ?, ?, ?, ?, ?)', coupon.id, coupon.creatorId, coupon.code, coupon.percentOff, coupon.active, coupon.createdAt); return json(res, 201, { coupon: serializeCoupon({ ...coupon, percent_off: coupon.percentOff }) }); }
  if (req.method === 'PATCH' && /^\/api\/coupons\/[^/]+$/.test(url.pathname)) { const creator = requireCreator(req, res); if (!creator) return; const couponId = decodeURIComponent(url.pathname.split('/')[3]); const { active } = await readJson(req); if (typeof active !== 'boolean') return json(res, 400, { error: 'Coupon status must be true or false.' }); const coupon = first('SELECT * FROM coupons WHERE id = ? AND creator_id = ?', couponId, creator.id); if (!coupon) return json(res, 404, { error: 'Coupon not found.' }); run('UPDATE coupons SET active = ? WHERE id = ?', active ? 1 : 0, coupon.id); return json(res, 200, { coupon: serializeCoupon({ ...coupon, active: active ? 1 : 0 }) }); }
  if (req.method === 'POST' && url.pathname === '/api/products') { const creator = requireCreator(req, res); if (!creator) return; const body = await readJson(req); const { title, description, priceMinor, type = 'Digital download', externalUrl = '', bookingUrl = '' } = body; const inventoryLimit = Object.hasOwn(body, 'inventoryLimit') ? body.inventoryLimit : null; const normalizedType = String(type).slice(0, 40); const normalizedUrl = String(externalUrl).trim(); const normalizedBookingUrl = String(bookingUrl).trim(); if (String(title || '').trim().length < 3 || String(description || '').trim().length < 10 || !Number.isInteger(priceMinor) || priceMinor < 0) return json(res, 400, { error: 'Add a title, 10-character description, and non-negative INR price.' }); if (normalizedType === 'External link' && !validSocialUrl(normalizedUrl)) return json(res, 400, { error: 'Add a valid destination URL for an external link.' }); if (normalizedType === '1:1 session' && !validSocialUrl(normalizedBookingUrl)) return json(res, 400, { error: 'Add a valid scheduling URL for a 1:1 session.' }); if (!validInventoryLimit(inventoryLimit)) return json(res, 400, { error: 'Inventory limit must be a non-negative whole number or null.' }); const product = { id: productId(), creatorId: creator.id, type: normalizedType, title: String(title).trim().slice(0, 100), description: String(description).trim().slice(0, 500), priceMinor, currency: 'INR', color: colors[Math.floor(Math.random() * colors.length)], mark: '✦', inventoryLimit, externalUrl: normalizedType === 'External link' ? normalizedUrl : null, bookingUrl: normalizedType === '1:1 session' ? normalizedBookingUrl : null, createdAt: now() }; run('INSERT INTO products (id, creator_id, type, title, description, price_minor, currency, color, mark, active, sold, inventory_limit, external_url, booking_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?)', product.id, product.creatorId, product.type, product.title, product.description, product.priceMinor, product.currency, product.color, product.mark, product.inventoryLimit, product.externalUrl, product.bookingUrl, product.createdAt); return json(res, 201, { product: serializeProduct({ ...product, price_minor: product.priceMinor, active: 1, sold: 0, inventory_limit: product.inventoryLimit, external_url: product.externalUrl, booking_url: product.bookingUrl, badge: null }) }); }
  if (req.method === 'POST' && /^\/api\/products\/[^/]+\/asset$/.test(url.pathname)) {
    const creator = requireCreator(req, res); if (!creator) return;
    const productId = decodeURIComponent(url.pathname.split('/')[3]);
    const product = first('SELECT * FROM products WHERE id = ? AND creator_id = ?', productId, creator.id);
    if (!product) return json(res, 404, { error: 'Product not found.' });
    if (product.type !== 'Digital download') return json(res, 400, { error: 'Only digital-download products can have a protected file.' });
    const { fileName, mimeType, contentBase64 } = await readJson(req, 8_000_000);
    if (typeof fileName !== 'string' || typeof mimeType !== 'string' || typeof contentBase64 !== 'string' || !allowedAssetMimeTypes.has(mimeType)) return json(res, 400, { error: 'Upload a supported PDF, ZIP, JSON, CSV, text, PNG, or JPEG file.' });
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(contentBase64) || contentBase64.length % 4 !== 0) return json(res, 400, { error: 'The uploaded file could not be decoded.' });
    const content = Buffer.from(contentBase64, 'base64');
    if (!content.length || content.length > maxAssetBytes) return json(res, 400, { error: 'Files must be between 1 byte and 5 MB.' });
    const asset = { id: `asset_${randomUUID().replaceAll('-', '').slice(0, 16)}`, storageKey: `asset_${randomUUID().replaceAll('-', '')}`, originalName: safeAssetName(fileName), mimeType, byteSize: content.length, createdAt: now() };
    await writeFile(join(assetDirectory, asset.storageKey), content, { flag: 'wx' });
    run('INSERT INTO product_assets (id, product_id, original_name, mime_type, storage_key, byte_size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(product_id) DO UPDATE SET original_name = excluded.original_name, mime_type = excluded.mime_type, storage_key = excluded.storage_key, byte_size = excluded.byte_size, created_at = excluded.created_at', asset.id, product.id, asset.originalName, asset.mimeType, asset.storageKey, asset.byteSize, asset.createdAt);
    audit(creator.id, 'product.asset_uploaded', 'product', product.id, { assetId: asset.id, byteSize: asset.byteSize, mimeType: asset.mimeType });
    return json(res, 201, { asset: { id: asset.id, name: asset.originalName, byteSize: asset.byteSize } });
  }
  if (req.method === 'PATCH' && /^\/api\/products\/[^/]+\/inventory$/.test(url.pathname)) { const creator = requireCreator(req, res); if (!creator) return; const requestedId = decodeURIComponent(url.pathname.split('/')[3]); const { inventoryLimit } = await readJson(req); if (!validInventoryLimit(inventoryLimit)) return json(res, 400, { error: 'Inventory limit must be a non-negative whole number or null.' }); const product = first('SELECT * FROM products WHERE id = ? AND creator_id = ?', requestedId, creator.id); if (!product) return json(res, 404, { error: 'Product not found.' }); if (inventoryLimit !== null && inventoryLimit < product.sold) return json(res, 400, { error: 'Inventory limit cannot be lower than products already sold.' }); run('UPDATE products SET inventory_limit = ? WHERE id = ?', inventoryLimit, product.id); return json(res, 200, { product: serializeProduct({ ...product, inventory_limit: inventoryLimit }) }); }
  if (req.method === 'PATCH' && /^\/api\/products\/[^/]+$/.test(url.pathname)) { const creator = requireCreator(req, res); if (!creator) return; const requestedId = decodeURIComponent(url.pathname.split('/')[3]); const body = await readJson(req); const product = first('SELECT * FROM products WHERE id = ? AND creator_id = ?', requestedId, creator.id); if (!product) return json(res, 404, { error: 'Product not found.' }); if (Object.hasOwn(body, 'active')) { if (typeof body.active !== 'boolean') return json(res, 400, { error: 'Product visibility must be true or false.' }); run('UPDATE products SET active = ? WHERE id = ?', body.active ? 1 : 0, product.id); return json(res, 200, { product: serializeProduct({ ...product, active: body.active ? 1 : 0 }) }); } if (Object.hasOwn(body, 'priceMinor')) { if (product.external_url || !Number.isInteger(body.priceMinor) || body.priceMinor < 0) return json(res, 400, { error: 'Price must be a non-negative whole number of minor currency units.' }); run('UPDATE products SET price_minor = ? WHERE id = ?', body.priceMinor, product.id); audit(creator.id, 'product.price_updated', 'product', product.id, { previousPriceMinor: product.price_minor, priceMinor: body.priceMinor }); return json(res, 200, { product: serializeProduct({ ...product, price_minor: body.priceMinor }) }); } return json(res, 400, { error: 'Provide a supported product update.' }); }
  if (req.method === 'POST' && url.pathname === '/api/create-order') {
    if (!razorpay) return json(res, 503, { error: 'Razorpay is not configured. Add server-side credentials and set PAYMENT_MODE=razorpay.' });
    const { productId: requestedId, email, couponCode } = await readJson(req);
    if (!validEmail(email)) return json(res, 400, { error: 'Enter a valid email address.' });
    const product = first('SELECT * FROM products WHERE id = ? AND active = 1', requestedId);
    if (!product || product.external_url) return json(res, 404, { error: 'This product is unavailable for checkout.' });
    const normalizedCode = String(couponCode || '').trim().toUpperCase();
    const coupon = normalizedCode ? first('SELECT * FROM coupons WHERE creator_id = ? AND code = ? AND active = 1', product.creator_id, normalizedCode) : null;
    if (normalizedCode && !coupon) return json(res, 400, { error: 'That coupon code is invalid or inactive.' });
    const amountMinor = coupon ? Math.round(product.price_minor * (100 - coupon.percent_off) / 100) : product.price_minor;
    if (!Number.isInteger(amountMinor) || amountMinor < 100) return json(res, 400, { error: 'The payment amount must be at least ₹1.00.' });
    if (product.inventory_limit !== null && product.sold >= product.inventory_limit) return json(res, 409, { error: 'This product is sold out.' });
    const order = { id: `ord_${randomUUID().replaceAll('-', '').slice(0, 16)}`, creatorId: product.creator_id, productId: product.id, buyerName: String(email).split('@')[0], buyerEmail: String(email).toLowerCase(), amountMinor, discountMinor: product.price_minor - amountMinor, couponCode: coupon?.code || null, accessToken: randomBytes(24).toString('base64url'), currency: product.currency, state: 'payment_pending', provider: 'razorpay', createdAt: now() };
    let providerOrder;
    try {
      providerOrder = await razorpay.orders.create({ amount: order.amountMinor, currency: order.currency, receipt: order.id, notes: { local_order_id: order.id, product_id: order.productId } });
    } catch (error) {
      console.error('Razorpay order creation failed:', error?.description || error?.message || error);
      const status = Number(error?.statusCode) === 401 ? 401 : 500;
      return json(res, status, { error: status === 401 ? 'Razorpay authentication failed. Check the server credentials.' : 'Could not create the payment order. Please try again.' });
    }
    run('INSERT INTO orders (id, creator_id, product_id, buyer_name, buyer_email, amount_minor, coupon_code, discount_minor, access_token, currency, state, provider, provider_order_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', order.id, order.creatorId, order.productId, order.buyerName, order.buyerEmail, order.amountMinor, order.couponCode, order.discountMinor, order.accessToken, order.currency, order.state, order.provider, providerOrder.id, order.createdAt);
    return json(res, 201, { order_id: providerOrder.id, amount: providerOrder.amount, currency: providerOrder.currency, key_id: process.env.RAZORPAY_KEY_ID });
  }
  if (req.method === 'POST' && url.pathname === '/api/verify-payment') {
    if (!process.env.RAZORPAY_KEY_SECRET) return json(res, 503, { error: 'Razorpay is not configured.' });
    const { razorpay_payment_id: paymentId, razorpay_order_id: providerOrderId, razorpay_signature: signature } = await readJson(req);
    if (![paymentId, providerOrderId, signature].every((value) => typeof value === 'string' && value.length > 0)) return json(res, 400, { error: 'Payment ID, order ID, and signature are required.' });
    const order = first('SELECT * FROM orders WHERE provider = ? AND provider_order_id = ?', 'razorpay', providerOrderId);
    if (!order) return json(res, 400, { error: 'Payment order was not found.' });
    const expectedSignature = createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${order.provider_order_id}|${paymentId}`).digest('hex');
    if (!safeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) return json(res, 400, { error: 'Payment signature verification failed.' });
    const settlement = settleRazorpayPayment(order, paymentId, 'checkout_signature');
    return json(res, settlement.status, settlement.body);
  }
  if (req.method === 'POST' && url.pathname === '/api/checkout') { const { productId: requestedId, email, couponCode } = await readJson(req); if (!validEmail(email)) return json(res, 400, { error: 'Enter a valid email address.' }); const product = first('SELECT * FROM products WHERE id = ? AND active = 1', requestedId); if (!product || product.external_url) return json(res, 404, { error: 'This product is unavailable for checkout.' }); if (razorpayEnabled) return json(res, 409, { error: 'Use the Razorpay checkout flow.' }); const normalizedCode = String(couponCode || '').trim().toUpperCase(); const coupon = normalizedCode ? first('SELECT * FROM coupons WHERE creator_id = ? AND code = ? AND active = 1', product.creator_id, normalizedCode) : null; if (normalizedCode && !coupon) return json(res, 400, { error: 'That coupon code is invalid or inactive.' }); const amountMinor = coupon ? Math.round(product.price_minor * (100 - coupon.percent_off) / 100) : product.price_minor; const order = { id: `ord_${randomUUID().replaceAll('-', '').slice(0, 16)}`, creatorId: product.creator_id, productId: product.id, buyerName: String(email).split('@')[0], buyerEmail: String(email).toLowerCase(), amountMinor, discountMinor: product.price_minor - amountMinor, couponCode: coupon?.code || null, accessToken: randomBytes(24).toString('base64url'), currency: product.currency, state: 'test_paid', provider: 'local_test', createdAt: now() }; db.exec('BEGIN IMMEDIATE'); try { const update = run('UPDATE products SET sold = sold + 1 WHERE id = ? AND active = 1 AND (inventory_limit IS NULL OR sold < inventory_limit)', product.id); if (update.changes !== 1) { db.exec('ROLLBACK'); return json(res, 409, { error: 'This product is sold out.' }); } run('INSERT INTO orders (id, creator_id, product_id, buyer_name, buyer_email, amount_minor, coupon_code, discount_minor, access_token, currency, state, provider, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', order.id, order.creatorId, order.productId, order.buyerName, order.buyerEmail, order.amountMinor, order.couponCode, order.discountMinor, order.accessToken, order.currency, order.state, order.provider, order.createdAt); audit(null, 'order.test_paid', 'order', order.id, { creatorId: product.creator_id, productId: product.id, amountMinor: order.amountMinor }); db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); throw error; } return json(res, 201, { order, purchaseLibraryUrl: `/purchases/${order.accessToken}`, message: 'Test order recorded. No money was collected.' }); }
  if (req.method === 'POST' && url.pathname === '/api/webhooks/razorpay') {
    const body = await readBody(req); const secret = process.env.RAZORPAY_WEBHOOK_SECRET; const incoming = req.headers['x-razorpay-signature']; const expected = secret && createHmac('sha256', secret).update(body).digest('hex');
    if (!secret || typeof incoming !== 'string' || !safeEqual(Buffer.from(incoming), Buffer.from(expected))) return json(res, 401, { error: 'Invalid webhook signature.' });
    let event;
    try { event = JSON.parse(body); } catch { return json(res, 400, { error: 'Invalid webhook payload.' }); }
    const eventType = typeof event.event === 'string' ? event.event : 'unknown';
    const eventId = typeof req.headers['x-razorpay-event-id'] === 'string' ? req.headers['x-razorpay-event-id'] : createHash('sha256').update(body).digest('hex');
    try { run('INSERT INTO webhook_events (id, provider, provider_event_id, event_type, payload, status, received_at) VALUES (?, ?, ?, ?, ?, ?, ?)', `webhook_${randomUUID().replaceAll('-', '').slice(0, 16)}`, 'razorpay', eventId, eventType, body, 'received', now()); }
    catch (error) { if (error?.errcode === 2067 || /UNIQUE constraint failed/.test(String(error?.message))) return json(res, 200, { received: true, duplicate: true }); throw error; }
    if (eventType === 'payment.captured') {
      const payment = event.payload?.payment?.entity;
      const order = payment?.order_id ? first('SELECT * FROM orders WHERE provider = ? AND provider_order_id = ?', 'razorpay', payment.order_id) : null;
      if (!order || !payment?.id || payment.amount !== order.amount_minor || payment.currency !== order.currency) { run('UPDATE webhook_events SET status = ?, processed_at = ? WHERE provider = ? AND provider_event_id = ?', 'ignored', now(), 'razorpay', eventId); return json(res, 202, { received: true, ignored: true }); }
      const settlement = settleRazorpayPayment(order, payment.id, 'payment.captured_webhook');
      run('UPDATE webhook_events SET status = ?, processed_at = ? WHERE provider = ? AND provider_event_id = ?', settlement.status === 200 ? 'processed' : 'failed', now(), 'razorpay', eventId);
      return json(res, settlement.status === 200 ? 202 : settlement.status, { received: true, ...settlement.body });
    }
    if (['refund.created', 'refund.processed', 'refund.failed'].includes(eventType)) {
      const providerRefund = event.payload?.refund?.entity;
      const refund = providerRefund?.id ? first('SELECT * FROM refunds WHERE provider_refund_id = ?', providerRefund.id) : null;
      if (!refund) { run('UPDATE webhook_events SET status = ?, processed_at = ? WHERE provider = ? AND provider_event_id = ?', 'ignored', now(), 'razorpay', eventId); return json(res, 202, { received: true, ignored: true }); }
      const settlement = settleRazorpayRefund(refund, providerRefund, `webhook:${eventType}`);
      run('UPDATE webhook_events SET status = ?, processed_at = ? WHERE provider = ? AND provider_event_id = ?', settlement.status === 200 ? 'processed' : 'failed', now(), 'razorpay', eventId);
      return json(res, settlement.status === 200 ? 202 : settlement.status, { received: true, ...settlement.body });
    }
    run('UPDATE webhook_events SET status = ?, processed_at = ? WHERE provider = ? AND provider_event_id = ?', 'ignored', now(), 'razorpay', eventId);
    return json(res, 202, { received: true, ignored: true });
  }
  return json(res, 404, { error: 'API route not found.' });
}

const mime = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon' };
async function serveStatic(res, pathname) { const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, ''); const path = normalize(join(distDirectory, relative)); if (!path.startsWith(distDirectory)) return json(res, 403, { error: 'Forbidden' }); try { const info = await stat(path); if (!info.isFile()) throw new Error('not file'); const file = await readFile(path); res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream' }); return res.end(file); } catch { if (extname(relative)) return json(res, 404, { error: 'Not found' }); const file = await readFile(join(distDirectory, 'index.html')); res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(file); } }
const server = createServer(async (req, res) => { try { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin'); res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()'); if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains'); const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url); return await serveStatic(res, url.pathname); } catch (error) { console.error(error); return json(res, 500, { error: 'Unexpected server error.' }); } });
server.on('error', (error) => { if (error.code === 'EADDRINUSE') { console.error(`Port ${port} is already in use. Open http://127.0.0.1:${port} or run: PORT=${port + 1} npm start`); process.exitCode = 1; return; } throw error; });
server.listen(port, host, () => console.log(`Creator storefront running at http://${host}:${port}`));
