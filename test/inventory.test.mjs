import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { unlink } from 'node:fs/promises';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

const port = 4301;
const baseUrl = `http://127.0.0.1:${port}`;
const handle = `inventory-test-${Date.now()}`;
const email = `${handle}@niche.local`;
let server;
const assetStorageKeys = [];

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = await response.json();
  return { response, body };
}

test.before(async () => {
  server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: String(port), PAYMENT_MODE: 'local_test' }, stdio: 'ignore' });
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try { await fetch(`${baseUrl}/api/storefront`); return; } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  throw new Error('Test server did not start.');
});

test.after(async () => {
  server?.kill();
  const db = new DatabaseSync('data/creator-storefront.db');
  const creator = db.prepare('SELECT id FROM creators WHERE handle = ?').get(handle);
  if (creator) {
    assetStorageKeys.push(...db.prepare('SELECT storage_key FROM product_assets WHERE product_id IN (SELECT id FROM products WHERE creator_id = ?)').all(creator.id).map((asset) => asset.storage_key));
    db.prepare('DELETE FROM audit_events WHERE actor_id = ? OR metadata LIKE ?').run(creator.id, `%${creator.id}%`);
    db.prepare('DELETE FROM orders WHERE creator_id = ?').run(creator.id);
    db.prepare('DELETE FROM products WHERE creator_id = ?').run(creator.id);
    db.prepare('DELETE FROM creators WHERE id = ?').run(creator.id);
  }
  db.close();
  await Promise.all(assetStorageKeys.map((key) => unlink(`data/assets/${key}`).catch(() => undefined)));
});

test('a limited product accepts one checkout and rejects the next', async () => {
  const registration = await request('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Inventory Test', email, handle, password: 'inventory-test-password' }) });
  assert.equal(registration.response.status, 201);
  const cookie = registration.response.headers.get('set-cookie').split(';')[0];
  const product = await request('/api/products', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ title: 'One unit product', description: 'A product used to verify inventory protection.', priceMinor: 100, inventoryLimit: 1 }) });
  assert.equal(product.response.status, 201);
  const productId = product.body.product.id;
  const first = await request('/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId, email: 'buyer-one@example.test' }) });
  const second = await request('/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId, email: 'buyer-two@example.test' }) });
  assert.equal(first.response.status, 201);
  assert.equal(second.response.status, 409);
  const store = await request(`/api/storefront?handle=${handle}`);
  assert.equal(store.body.products[0].sold, 1);
  assert.equal(store.body.products[0].soldOut, true);
});

test('a paid digital product grants a private, expiring download URL', async () => {
  const login = await request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'inventory-test-password' }) });
  const cookie = login.response.headers.get('set-cookie').split(';')[0];
  const product = await request('/api/products', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ title: 'Private download', description: 'A protected file delivery test product.', priceMinor: 100, type: 'Digital download' }) });
  assert.equal(product.response.status, 201);
  const asset = await request(`/api/products/${product.body.product.id}/asset`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ fileName: 'private.txt', mimeType: 'text/plain', contentBase64: Buffer.from('private download').toString('base64') }) });
  assert.equal(asset.response.status, 201);
  const checkout = await request('/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: product.body.product.id, email: 'asset-buyer@example.test' }) });
  assert.equal(checkout.response.status, 201);
  const library = await request(`/api${checkout.body.purchaseLibraryUrl}`);
  assert.match(library.body.purchases[0].product.downloadUrl, /^\/api\/downloads\//);
  const file = await fetch(`${baseUrl}${library.body.purchases[0].product.downloadUrl}`);
  assert.equal(file.status, 200);
  assert.equal(await file.text(), 'private download');
});
