import { createServer } from 'node:http';
import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = fileURLToPath(new URL('.', import.meta.url));
const dataDirectory = join(root, 'data');
const distDirectory = join(root, 'dist');
const port = Number(process.env.PORT || 4173);
await mkdir(dataDirectory, { recursive: true });
const db = new DatabaseSync(join(dataDirectory, 'creator-storefront.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS creators (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, handle TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL) STRICT;
  CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL) STRICT;
  CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE, type TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, price_minor INTEGER NOT NULL CHECK(price_minor >= 0), currency TEXT NOT NULL, color TEXT NOT NULL, mark TEXT NOT NULL, badge TEXT, active INTEGER NOT NULL DEFAULT 1, sold INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL) STRICT;
  CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, creator_id TEXT NOT NULL REFERENCES creators(id), product_id TEXT NOT NULL REFERENCES products(id), buyer_name TEXT NOT NULL, buyer_email TEXT NOT NULL, amount_minor INTEGER NOT NULL, currency TEXT NOT NULL, state TEXT NOT NULL, provider TEXT NOT NULL, created_at TEXT NOT NULL) STRICT;
`);

const now = () => new Date().toISOString();
const first = (sql, ...parameters) => db.prepare(sql).get(...parameters);
const all = (sql, ...parameters) => db.prepare(sql).all(...parameters);
const run = (sql, ...parameters) => db.prepare(sql).run(...parameters);
const productId = () => `prod_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
const passwordHash = (password) => { const salt = randomBytes(16).toString('hex'); return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`; };
const safeEqual = (left, right) => left.length === right.length && timingSafeEqual(left, right);
const passwordMatches = (password, saved) => { const [salt, digest] = saved.split(':'); return Boolean(salt && digest) && safeEqual(scryptSync(password, salt, 64), Buffer.from(digest, 'hex')); };

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
const serializeCreator = (row) => ({ id: row.id, name: row.name, handle: row.handle, email: row.email });
const serializeProduct = (row) => ({ id: row.id, type: row.type, title: row.title, desc: row.description, price: row.price_minor, currency: row.currency, color: row.color, mark: row.mark, badge: row.badge, active: Boolean(row.active), sold: row.sold });
function parseCookies(req) { return Object.fromEntries((req.headers.cookie || '').split(';').map((part) => part.trim().split(/=(.*)/s)).filter(([key]) => key).map(([key, value]) => [key, decodeURIComponent(value || '')])); }
function sessionCreator(req) { const token = parseCookies(req).creator_session; if (!token) return null; return first('SELECT creators.id, creators.name, creators.handle, creators.email FROM sessions JOIN creators ON creators.id = sessions.creator_id WHERE sessions.token = ? AND sessions.expires_at > ?', token, now()) || null; }
function setSession(res, creatorId) { const token = randomBytes(32).toString('base64url'); run('INSERT INTO sessions (token, creator_id, expires_at, created_at) VALUES (?, ?, ?, ?)', token, creatorId, new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(), now()); res.setHeader('Set-Cookie', `creator_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`); }
function clearSession(req, res) { const token = parseCookies(req).creator_session; if (token) run('DELETE FROM sessions WHERE token = ?', token); res.setHeader('Set-Cookie', 'creator_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'); }
function json(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }
function readBody(req) { return new Promise((resolve, reject) => { let body = ''; req.on('data', (chunk) => { body += chunk; if (body.length > 100_000) reject(new Error('Request body is too large.')); }); req.on('end', () => resolve(body)); req.on('error', reject); }); }
async function readJson(req) { const body = await readBody(req); try { return body ? JSON.parse(body) : {}; } catch { throw new Error('Invalid JSON body.'); } }
function requireCreator(req, res) { const creator = sessionCreator(req); if (!creator) { json(res, 401, { error: 'Sign in to continue.' }); return null; } return creator; }
const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value || '');
const validHandle = (value) => /^[a-z0-9][a-z0-9-]{2,29}$/.test(value || '');

function dashboard(creatorId) {
  const products = all('SELECT * FROM products WHERE creator_id = ? ORDER BY created_at DESC', creatorId).map(serializeProduct);
  const recentOrders = all('SELECT orders.*, products.title AS product_title FROM orders JOIN products ON products.id = orders.product_id WHERE orders.creator_id = ? ORDER BY orders.created_at DESC LIMIT 5', creatorId).map((order) => ({ id: order.id, buyerName: order.buyer_name, amountMinor: order.amount_minor, currency: order.currency, state: order.state, createdAt: order.created_at, product: { title: order.product_title } }));
  const totals = first("SELECT COALESCE(SUM(amount_minor), 0) AS sales, COUNT(*) AS orders FROM orders WHERE creator_id = ? AND state IN ('paid', 'test_paid')", creatorId);
  return { summary: { totalSalesMinor: totals.sales, orderCount: totals.orders, visits: 0, conversion: 0 }, products, recentOrders };
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/storefront') { const handle = (url.searchParams.get('handle') || 'mayahq').toLowerCase(); const creator = first('SELECT * FROM creators WHERE handle = ?', handle); if (!creator) return json(res, 404, { error: 'Storefront not found.' }); return json(res, 200, { creator: serializeCreator(creator), products: all('SELECT * FROM products WHERE creator_id = ? AND active = 1 ORDER BY created_at DESC', creator.id).map(serializeProduct) }); }
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
  if (req.method === 'POST' && url.pathname === '/api/products') { const creator = requireCreator(req, res); if (!creator) return; const { title, description, priceMinor, type = 'Digital download' } = await readJson(req); if (String(title || '').trim().length < 3 || String(description || '').trim().length < 10 || !Number.isInteger(priceMinor) || priceMinor < 0) return json(res, 400, { error: 'Add a title, 10-character description, and non-negative INR price.' }); const product = { id: productId(), creatorId: creator.id, type: String(type).slice(0, 40), title: String(title).trim().slice(0, 100), description: String(description).trim().slice(0, 500), priceMinor, currency: 'INR', color: colors[Math.floor(Math.random() * colors.length)], mark: '✦', createdAt: now() }; run('INSERT INTO products (id, creator_id, type, title, description, price_minor, currency, color, mark, active, sold, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?)', product.id, product.creatorId, product.type, product.title, product.description, product.priceMinor, product.currency, product.color, product.mark, product.createdAt); return json(res, 201, { product: serializeProduct({ ...product, price_minor: product.priceMinor, active: 1, sold: 0, badge: null }) }); }
  if (req.method === 'POST' && url.pathname === '/api/checkout') { const { productId: requestedId, email } = await readJson(req); if (!validEmail(email)) return json(res, 400, { error: 'Enter a valid email address.' }); const product = first('SELECT * FROM products WHERE id = ? AND active = 1', requestedId); if (!product) return json(res, 404, { error: 'This product is unavailable.' }); if (process.env.PAYMENT_MODE === 'live') return json(res, 503, { error: 'Live payment is not configured yet.' }); const order = { id: `ord_${randomUUID().replaceAll('-', '').slice(0, 16)}`, creatorId: product.creator_id, productId: product.id, buyerName: String(email).split('@')[0], buyerEmail: String(email).toLowerCase(), amountMinor: product.price_minor, currency: product.currency, state: 'test_paid', provider: 'local_test', createdAt: now() }; run('INSERT INTO orders (id, creator_id, product_id, buyer_name, buyer_email, amount_minor, currency, state, provider, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', order.id, order.creatorId, order.productId, order.buyerName, order.buyerEmail, order.amountMinor, order.currency, order.state, order.provider, order.createdAt); run('UPDATE products SET sold = sold + 1 WHERE id = ?', product.id); return json(res, 201, { order, message: 'Test order recorded. No money was collected.' }); }
  if (req.method === 'POST' && url.pathname === '/api/webhooks/razorpay') { const body = await readBody(req); const secret = process.env.RAZORPAY_WEBHOOK_SECRET; const incoming = req.headers['x-razorpay-signature']; const expected = secret && createHmac('sha256', secret).update(body).digest('hex'); if (!secret || typeof incoming !== 'string' || !safeEqual(Buffer.from(incoming), Buffer.from(expected))) return json(res, 401, { error: 'Invalid webhook signature.' }); return json(res, 202, { received: true }); }
  return json(res, 404, { error: 'API route not found.' });
}

const mime = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon' };
async function serveStatic(res, pathname) { const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, ''); const path = normalize(join(distDirectory, relative)); if (!path.startsWith(distDirectory)) return json(res, 403, { error: 'Forbidden' }); try { const info = await stat(path); if (!info.isFile()) throw new Error('not file'); const file = await readFile(path); res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream' }); return res.end(file); } catch { if (extname(relative)) return json(res, 404, { error: 'Not found' }); const file = await readFile(join(distDirectory, 'index.html')); res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(file); } }
const server = createServer(async (req, res) => { try { const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url); return await serveStatic(res, url.pathname); } catch (error) { console.error(error); return json(res, 500, { error: 'Unexpected server error.' }); } });
server.on('error', (error) => { if (error.code === 'EADDRINUSE') { console.error(`Port ${port} is already in use. Open http://127.0.0.1:${port} or run: PORT=${port + 1} npm start`); process.exitCode = 1; return; } throw error; });
server.listen(port, () => console.log(`Creator storefront running at http://127.0.0.1:${port}`));
