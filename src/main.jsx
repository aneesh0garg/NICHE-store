import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const fallbackProducts = [
  {
    id: 'notion-kit',
    type: 'Digital download',
    title: 'The Freelance OS',
    desc: 'A calm, complete Notion workspace for running your independent business.',
    price: 1499,
    color: 'lavender',
    badge: 'Bestseller',
    mark: '⌘',
  },
  {
    id: 'audit',
    type: '1:1 session',
    title: 'Portfolio audit',
    desc: 'A focused 45-minute review to help your work get the attention it deserves.',
    price: 2499,
    color: 'peach',
    mark: '↗',
  },
  {
    id: 'guide',
    type: 'Digital download',
    title: 'The clear pitch guide',
    desc: 'The scripts and frameworks I use to turn warm leads into kind yeses.',
    price: 599,
    color: 'mint',
    mark: '✦',
  },
];

const fmt = (amount) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);

function Arrow() { return <span className="arrow">→</span>; }

function ProductCard({ product, onBuy }) {
  return <button className="product-card" onClick={() => product.externalUrl ? window.open(product.externalUrl, '_blank', 'noopener,noreferrer') : onBuy(product)} disabled={product.soldOut}>
    <div className={`product-art ${product.color}`}>
      {product.badge && <span className="badge">{product.badge}</span>}
      <span className="art-mark">{product.mark}</span>
      <span className="art-line" />
    </div>
    <div className="product-copy">
      <p className="eyebrow">{product.type}</p>
      <h3>{product.title}</h3>
      <p className="description">{product.desc}</p>
      {product.soldOut ? <span className="sold-out">Sold out</span> : <><span className="product-price">{fmt(product.price)} <Arrow /></span>{product.inventoryRemaining !== null && <span className="inventory-remaining">{product.inventoryRemaining} remaining</span>}</>}
    </div>
  </button>;
}

function Checkout({ product, creator, onClose }) {
  const [paid, setPaid] = useState(false);
  const [purchaseLibraryUrl, setPurchaseLibraryUrl] = useState('');
  const [email, setEmail] = useState('');
  const [couponCode, setCouponCode] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  async function openRazorpayCheckout() {
    setSubmitting(true); setError('');
    try {
      if (!window.Razorpay) throw new Error('Secure payment checkout did not load. Please refresh and try again.');
      const response = await fetch('/api/create-order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: product.id, email, couponCode }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not create your order.');
      const checkout = new window.Razorpay({
        key: result.key_id,
        amount: result.amount,
        currency: result.currency,
        name: 'NICHE store',
        description: product.title,
        order_id: result.order_id,
        prefill: { email },
        notes: { product_id: product.id },
        theme: { color: '#7050ba' },
        modal: { ondismiss: () => { setSubmitting(false); setError('Payment was cancelled.'); } },
        handler: async (payment) => {
          try {
            const verification = await fetch('/api/verify-payment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payment) });
            const verified = await verification.json();
            if (!verification.ok) throw new Error(verified.error || 'Payment verification failed.');
            setPurchaseLibraryUrl(verified.purchaseLibraryUrl || ''); setPaid(true);
          } catch (verificationError) { setError(verificationError.message); }
          finally { setSubmitting(false); }
        },
      });
      checkout.on('payment.failed', (response) => { setSubmitting(false); setError(response.error?.description || 'Payment failed. Please try again.'); });
      checkout.open();
    } catch (checkoutError) { setError(checkoutError.message); setSubmitting(false); }
    finally { /* Razorpay callbacks clear the loading state after the modal opens. */ }
  }
  if (paid) return <div className="modal-backdrop"><section className="checkout success" role="dialog" aria-modal="true">
    <button className="close" onClick={onClose}>×</button>
    <div className="success-icon">✓</div>
    <p className="eyebrow">Payment successful</p>
    <h2>It’s yours.</h2>
    <p>Your receipt and access details are ready.</p>
    {purchaseLibraryUrl && <a className="primary-button purchase-link" href={purchaseLibraryUrl}>Open purchase library</a>}
    <button className="primary-button" onClick={onClose}>Back to Maya’s store</button>
  </section></div>;
  return <div className="modal-backdrop"><section className="checkout" role="dialog" aria-modal="true" aria-labelledby="checkout-title">
    <button className="close" onClick={onClose} aria-label="Close checkout">×</button>
    <div className="checkout-brand"><span className="tiny-logo">n</span> NICHE store</div>
    <div className="checkout-summary">
      <div className={`mini-art ${product.color}`}>{product.mark}</div>
      <div><p className="eyebrow">{product.type}</p><h2 id="checkout-title">{product.title}</h2><strong>{fmt(product.price)}</strong></div>
    </div>
    <p className="seller-note">Sold by {creator.name} · Support: <a href={`mailto:${creator.supportEmail}`}>{creator.supportEmail}</a>{creator.deliveryTerms && <> · Delivery: {creator.deliveryTerms}</>}</p>
    <label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoFocus /></label>
    <label>Discount code <small>(optional)</small><input value={couponCode} onChange={(event) => setCouponCode(event.target.value.toUpperCase())} placeholder="WELCOME10" /></label>
    <p className="pay-label">Pay securely with</p>
    <div className="pay-options"><button className="pay-option active"><span className="upi-dot">◉</span> UPI</button><button className="pay-option">Card</button><button className="pay-option">Netbanking</button></div>
    {error && <p className="form-error">{error}</p>}
    <button className="primary-button pay" disabled={submitting} onClick={openRazorpayCheckout}>{submitting ? 'Opening secure payment…' : `Pay ${fmt(product.price)}`} <Arrow /></button>
    <p className="secure-note">Payments are processed securely by Razorpay.</p>
  </section></div>;
}

function PurchaseLibrary({ token, onBack }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { fetch(`/api/purchases/${encodeURIComponent(token)}`).then((response) => response.json().then((result) => ({ response, result }))).then(({ response, result }) => { if (!response.ok) throw new Error(result.error || 'Could not load purchases.'); setData(result); }).catch((loadError) => setError(loadError.message)); }, [token]);
  return <main className="auth-shell"><button className="wordmark" onClick={onBack}><span>n</span> NICHE store</button><section className="auth-card purchase-library"><p className="eyebrow">Purchase library</p><h1>Your purchases.</h1>{error && <p className="form-error">{error}</p>}{!data && !error && <p>Loading your order…</p>}{data?.purchases.map((purchase) => <article key={purchase.id}><h2>{purchase.product.title}</h2><p>{purchase.product.description}</p><small>{purchase.state === 'test_refunded' ? 'Refunded' : 'Paid'} · {fmt(purchase.amountMinor)}</small>{purchase.product.downloadUrl && purchase.state !== 'test_refunded' && <><a className="primary-button purchase-link" href={purchase.product.downloadUrl}>Download {purchase.product.assetName || 'your file'}</a><small className="download-expiry">This private download link expires in 24 hours. Reopen this library to get a new one.</small></>}{purchase.product.bookingUrl && purchase.state !== 'test_refunded' && <a className="primary-button purchase-link" href={purchase.product.bookingUrl} target="_blank" rel="noreferrer">Book your session</a>}{purchase.product.externalUrl && <a className="primary-button purchase-link" href={purchase.product.externalUrl} target="_blank" rel="noreferrer">Open access link</a>}</article>)}</section></main>;
}

const policies = {
  terms: ['Terms of use', 'Creators are responsible for accurate listings, delivery promises, and buyer support. Buyers must use a valid email address. Test-mode purchases do not collect money or create a financial obligation.'],
  privacy: ['Privacy policy', 'NICHE store stores creator account details, buyer email addresses, order records, and technical request information to provide checkout, purchase access, support, and fraud prevention. Personal information is not sold.'],
  refunds: ['Refund policy', 'Buyers should contact the creator with an order reference and reason for a refund. Creators can request one full refund from their dashboard. Live refunds are completed only after confirmation from the payment provider.']
};
function PolicyPage({ policyKey, onBack }) { const [title, body] = policies[policyKey] || policies.terms; return <main className="auth-shell"><button className="wordmark" onClick={onBack}><span>n</span> NICHE store</button><section className="auth-card policy-page"><p className="eyebrow">Buyer information</p><h1>{title}</h1><p>{body}</p><h2>Contact and support</h2><p>For purchase support, contact the creator directly with your order reference. NICHE store policy pages are provided as a local MVP baseline and should be reviewed with qualified counsel before a live launch.</p></section></main>; }

function Storefront({ onDashboard, handle }) {
  const [selected, setSelected] = useState(null);
  const [products, setProducts] = useState(fallbackProducts);
  const [storeCreator, setStoreCreator] = useState({ name: 'Maya Lim', bio: 'Templates, tiny systems, and honest advice for thoughtful freelancers and designers.', socialLinks: {} });
  useEffect(() => { const search = handle ? `?handle=${encodeURIComponent(handle)}` : ''; fetch(`/api/storefront${search}`).then((response) => response.ok ? response.json() : Promise.reject()).then((data) => { setProducts(data.products); setStoreCreator(data.creator); }).catch(() => undefined); }, [handle]);
  return <>
    <main className={`store-shell theme-${storeCreator.theme || 'violet'}`}>
      <header className="store-header">
        <a className="wordmark" href="#top" aria-label="NICHE store home"><span>n</span> NICHE store</a>
        <button className="dashboard-link" onClick={onDashboard}>Creator dashboard <Arrow /></button>
      </header>
      <section className="hero" id="top">
        <div className="portrait"><span>{storeCreator.name.slice(0, 2).toUpperCase()}</span></div>
        <p className="eyebrow">Designing a good independent life</p>
        <h1>Hi, I’m {storeCreator.name.split(' ')[0]}.<br /><em>I make useful things.</em></h1>
        <p className="hero-copy">{storeCreator.bio || 'Templates, tiny systems, and honest advice for thoughtful freelancers and designers.'}</p>
        <div className="socials">{Object.entries(storeCreator.socialLinks || {}).filter(([, href]) => href).map(([network, href]) => <a key={network} href={href} target="_blank" rel="noreferrer">{network}</a>)}</div>
      </section>
      <section className="products" aria-labelledby="products-title">
        <div className="section-heading"><div><p className="eyebrow">Start here</p><h2 id="products-title">Things I’ve made for you</h2></div><span>{products.length} products</span></div>
        <div className="product-grid">{products.map((product) => <ProductCard key={product.id} product={product} onBuy={setSelected} />)}</div>
      </section>
      <section className="note">
        <span className="spark">✳</span><p>Every purchase helps me make more free resources for independent people.</p><span className="spark">✳</span>
      </section>
      <footer><span>© 2026 Maya Lim</span><span>Made with <b>NICHE store</b></span><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/refunds">Refunds</a></footer>
    </main>
    {selected && <Checkout product={selected} creator={storeCreator} onClose={() => setSelected(null)} />}
  </>;
}

function AuthPanel({ onAuthenticated, onBack }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', handle: '', password: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const update = (key) => (event) => setForm({ ...form, [key]: event.target.value });
  async function submit(event) {
    event.preventDefault(); setSubmitting(true); setError('');
    try {
      const body = mode === 'login' ? { email: form.email, password: form.password } : form;
      const response = await fetch(`/api/auth/${mode === 'login' ? 'login' : 'register'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not continue.'); onAuthenticated(result.creator);
    } catch (authError) { setError(authError.message); } finally { setSubmitting(false); }
  }
  return <main className="auth-shell"><button className="wordmark" onClick={onBack}><span>n</span> NICHE store</button><section className="auth-card"><p className="eyebrow">Creator portal</p><h1>{mode === 'login' ? 'Welcome back.' : 'Start your storefront.'}</h1><p>{mode === 'login' ? 'Sign in to manage your products, orders, and audience.' : 'Create your free creator account in a few minutes.'}</p><form onSubmit={submit}>{mode === 'register' && <><label>Your name<input required value={form.name} onChange={update('name')} placeholder="Maya Lim" /></label><label>Store handle<input required value={form.handle} onChange={update('handle')} placeholder="maya-lim" /></label></>}<label>Email address<input required type="email" value={form.email} onChange={update('email')} placeholder="you@example.com" /></label><label>Password<input required type="password" minLength="10" value={form.password} onChange={update('password')} placeholder="At least 10 characters" /></label>{error && <p className="form-error">{error}</p>}<button className="primary-button auth-submit" disabled={submitting}>{submitting ? 'Please wait…' : mode === 'login' ? 'Sign in →' : 'Create account →'}</button></form><p className="auth-switch">{mode === 'login' ? 'New here?' : 'Already have an account?'} <button onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>{mode === 'login' ? 'Create an account' : 'Sign in'}</button></p><p className="demo-note">Demo account: <b>maya@mayahq.test</b> · <b>demo-password-2026</b></p></section></main>;
}

function ProductComposer({ onClose, onCreated }) {
  const [form, setForm] = useState({ title: '', description: '', price: '', type: 'Digital download', inventoryLimit: '', externalUrl: '', bookingUrl: '', assetFile: null });
  const [error, setError] = useState('');
  async function submit(event) { event.preventDefault(); setError(''); const inventoryLimit = form.inventoryLimit === '' ? null : Number(form.inventoryLimit); const response = await fetch('/api/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: form.title, description: form.description, priceMinor: form.type === 'External link' ? 0 : Math.round(Number(form.price) * 100), type: form.type, inventoryLimit, externalUrl: form.externalUrl, bookingUrl: form.bookingUrl }) }); const result = await response.json(); if (!response.ok) return setError(result.error || 'Could not create product.'); if (form.assetFile) { if (form.assetFile.size > 5 * 1024 * 1024) return setError('Your product was created, but the file must be 5 MB or smaller.'); if (!form.assetFile.type) return setError('Your product was created, but the file type could not be determined.'); const contentBase64 = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('Could not read the selected file.')); reader.readAsDataURL(form.assetFile); }); const assetResponse = await fetch(`/api/products/${encodeURIComponent(result.product.id)}/asset`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileName: form.assetFile.name, mimeType: form.assetFile.type, contentBase64 }) }); const assetResult = await assetResponse.json(); if (!assetResponse.ok) return setError(`Your product was created, but its file could not be uploaded: ${assetResult.error || 'Unknown error.'}`); } onCreated(result.product); }
  return <div className="modal-backdrop"><section className="checkout composer" role="dialog" aria-modal="true" aria-labelledby="product-title"><button className="close" onClick={onClose} aria-label="Close product editor">×</button><p className="eyebrow">New product</p><h2 id="product-title">Make something sellable.</h2><form onSubmit={submit}><label>Product title<input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="The focused freelancer kit" /></label><label>Short description<textarea required minLength="10" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="What buyers will get and why it’s useful." /></label><label>Product type<select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}><option>Digital download</option><option>1:1 session</option><option>Service</option><option>External link</option></select></label>{form.type === 'External link' ? <label>Destination URL<input required type="url" value={form.externalUrl} onChange={(event) => setForm({ ...form, externalUrl: event.target.value })} placeholder="https://example.com" /></label> : <><label>Price in INR<input required min="0" type="number" step="0.01" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} placeholder="999" /></label>{form.type === 'Digital download' && <label>Download file <small>(optional; PDF, ZIP, JSON, CSV, text, PNG, or JPEG; 5 MB max)</small><input type="file" accept=".pdf,.zip,.json,.csv,.txt,.png,.jpg,.jpeg,application/pdf,application/zip,application/json,text/csv,text/plain,image/png,image/jpeg" onChange={(event) => setForm({ ...form, assetFile: event.target.files?.[0] || null })} /></label>}{form.type === '1:1 session' && <label>Scheduling URL<input required type="url" value={form.bookingUrl} onChange={(event) => setForm({ ...form, bookingUrl: event.target.value })} placeholder="https://cal.com/yourname/session" /></label>}</>}<label>Inventory limit <small>(optional; leave empty for unlimited)</small><input min="0" type="number" step="1" value={form.inventoryLimit} onChange={(event) => setForm({ ...form, inventoryLimit: event.target.value })} placeholder="Unlimited" /></label>{error && <p className="form-error">{error}</p>}<button className="primary-button pay">Publish product <Arrow /></button></form></section></div>;
}

function StoreSettings({ creator, onClose, onSaved }) {
  const [form, setForm] = useState({ name: creator.name, bio: creator.bio || '', supportEmail: creator.supportEmail || creator.email, deliveryTerms: creator.deliveryTerms || '', theme: creator.theme || 'violet', instagram: creator.socialLinks?.instagram || '', newsletter: creator.socialLinks?.newsletter || '', linkedin: creator.socialLinks?.linkedin || '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const update = (key) => (event) => setForm({ ...form, [key]: event.target.value });
  async function submit(event) { event.preventDefault(); setSaving(true); setError(''); try { const response = await fetch('/api/creator/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: form.name, bio: form.bio, supportEmail: form.supportEmail, deliveryTerms: form.deliveryTerms, theme: form.theme, socialLinks: { instagram: form.instagram, newsletter: form.newsletter, linkedin: form.linkedin } }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not save store settings.'); onSaved(result.creator); } catch (saveError) { setError(saveError.message); } finally { setSaving(false); } }
  return <div className="modal-backdrop"><section className="checkout composer" role="dialog" aria-modal="true" aria-labelledby="settings-title"><button className="close" onClick={onClose} aria-label="Close store settings">×</button><p className="eyebrow">Store settings</p><h2 id="settings-title">Make your store yours.</h2><form onSubmit={submit}><label>Creator name<input required minLength="2" maxLength="80" value={form.name} onChange={update('name')} /></label><label>Store theme<select value={form.theme} onChange={update('theme')}><option value="violet">Violet</option><option value="sage">Sage</option><option value="terracotta">Terracotta</option></select></label><label>Support email<input required type="email" value={form.supportEmail} onChange={update('supportEmail')} /></label><label>Delivery terms<textarea maxLength="500" value={form.deliveryTerms} onChange={update('deliveryTerms')} placeholder="For example: Access is delivered within 24 hours." /></label><label>Store bio<textarea maxLength="500" value={form.bio} onChange={update('bio')} placeholder="Tell buyers what you make." /></label><label>Instagram URL<input type="url" value={form.instagram} onChange={update('instagram')} placeholder="https://instagram.com/yourname" /></label><label>Newsletter URL<input type="url" value={form.newsletter} onChange={update('newsletter')} placeholder="https://yournewsletter.com" /></label><label>LinkedIn URL<input type="url" value={form.linkedin} onChange={update('linkedin')} placeholder="https://linkedin.com/in/yourname" /></label>{error && <p className="form-error">{error}</p>}<button className="primary-button pay" disabled={saving}>{saving ? 'Saving…' : 'Save store settings'}</button></form></section></div>;
}

function CouponManager({ onClose }) {
  const [coupons, setCoupons] = useState([]);
  const [form, setForm] = useState({ code: '', percentOff: '' });
  const [error, setError] = useState('');
  const reload = () => fetch('/api/coupons').then((response) => response.ok ? response.json() : Promise.reject()).then((data) => setCoupons(data.coupons)).catch(() => setError('Could not load coupons.'));
  useEffect(() => { reload(); }, []);
  async function create(event) { event.preventDefault(); setError(''); const response = await fetch('/api/coupons', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: form.code, percentOff: Number(form.percentOff) }) }); const result = await response.json(); if (!response.ok) return setError(result.error || 'Could not create coupon.'); setForm({ code: '', percentOff: '' }); reload(); }
  async function toggle(coupon) { const response = await fetch(`/api/coupons/${encodeURIComponent(coupon.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !coupon.active }) }); const result = await response.json(); if (!response.ok) return setError(result.error || 'Could not update coupon.'); reload(); }
  return <div className="modal-backdrop"><section className="checkout composer" role="dialog" aria-modal="true" aria-labelledby="coupon-title"><button className="close" onClick={onClose} aria-label="Close discounts">×</button><p className="eyebrow">Discounts</p><h2 id="coupon-title">Offer a reason to buy now.</h2><form onSubmit={create}><label>Coupon code<input required minLength="3" maxLength="24" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} placeholder="WELCOME10" /></label><label>Percent off<input required min="1" max="100" type="number" value={form.percentOff} onChange={(event) => setForm({ ...form, percentOff: event.target.value })} placeholder="10" /></label>{error && <p className="form-error">{error}</p>}<button className="primary-button pay">Create coupon</button></form><div className="coupon-list">{coupons.map((coupon) => <div className="coupon-row" key={coupon.id}><span><b>{coupon.code}</b> · {coupon.percentOff}% off</span><button onClick={() => toggle(coupon)}>{coupon.active ? 'Deactivate' : 'Activate'}</button></div>)}</div></section></div>;
}

function orderPaymentLabel(order) { if (order.state === 'test_refunded' || order.state === 'refunded') return 'Refunded'; if (order.refundState === 'pending') return 'Refund pending'; if (order.refundState === 'failed') return 'Refund failed'; return 'Paid'; }
function OrderManager({ onClose, onRefunded }) {
  const [query, setQuery] = useState('');
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState('');
  const load = async (nextQuery = query) => { try { const response = await fetch(`/api/orders?q=${encodeURIComponent(nextQuery)}`); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not load orders.'); setOrders(result.orders); } catch (loadError) { setError(loadError.message); } };
  useEffect(() => { load(''); }, []);
  const submit = (event) => { event.preventDefault(); load(); };
  const refund = async (order) => { if (!window.confirm(`Refund ${fmt(order.amountMinor)} to ${order.buyerEmail}? This requests a full refund and cannot be undone.`)) return; const response = await fetch(`/api/orders/${encodeURIComponent(order.id)}/refund`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'Creator-issued refund' }) }); const result = await response.json(); if (!response.ok) return setError(result.error || 'Could not refund this order.'); load(); onRefunded(); };
  return <div className="modal-backdrop"><section className="checkout composer orders-manager" role="dialog" aria-modal="true" aria-labelledby="orders-title"><button className="close" onClick={onClose} aria-label="Close orders">×</button><p className="eyebrow">Orders</p><h2 id="orders-title">Find a purchase.</h2><a className="export-link" href="/api/orders/export.csv">Download CSV export</a><form onSubmit={submit}><label>Search buyer email, order ID, payment ID, or product<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="pay_… or buyer@example.com" /></label><button className="primary-button pay">Search</button></form>{error && <p className="form-error">{error}</p>}<div className="order-results">{orders.map((order) => <article key={order.id}><div><strong>{order.buyerEmail}</strong><p>{order.product.title} · {order.id}</p><small>{orderPaymentLabel(order)} · {fmt(order.amountMinor)}{order.providerPaymentId ? ` · ${order.providerPaymentId}` : ''}</small></div>{['test_paid', 'paid'].includes(order.state) && !order.refundState && <button className="refund-button" onClick={() => refund(order)}>Refund</button>}</article>)}{!error && orders.length === 0 && <p>No matching orders.</p>}</div></section></div>;
}

function Dashboard({ onStorefront, creator, onLogout, onCreatorUpdated }) {
  const [toast, setToast] = useState('');
  const [data, setData] = useState(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [couponsOpen, setCouponsOpen] = useState(false);
  const [ordersOpen, setOrdersOpen] = useState(false);
  const reload = () => fetch('/api/dashboard').then((response) => response.ok ? response.json() : Promise.reject()).then(setData).catch(() => undefined);
  useEffect(() => { reload(); }, []);
  const notify = (message) => { setToast(message); window.setTimeout(() => setToast(''), 2800); };
  const toggleVisibility = async (product) => { try { const response = await fetch(`/api/products/${encodeURIComponent(product.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !product.active }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not update product visibility.'); reload(); notify(`${product.title} is now ${result.product.active ? 'live' : 'hidden'}`); } catch (visibilityError) { notify(visibilityError.message); } };
  const updatePrice = async (product) => { const value = window.prompt(`Price in INR for “${product.title}”`, (product.price / 100).toFixed(2)); if (value === null) return; const priceMinor = Math.round(Number(value) * 100); if (!Number.isInteger(priceMinor) || priceMinor < 0) return notify('Enter a valid non-negative INR price.'); try { const response = await fetch(`/api/products/${encodeURIComponent(product.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ priceMinor }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not update price.'); reload(); notify(`${product.title} price updated`); } catch (priceError) { notify(priceError.message); } };
  const updateInventory = async (product) => { const current = product.inventoryLimit === null ? '' : String(product.inventoryLimit); const value = window.prompt(`Inventory limit for “${product.title}”\nLeave blank for unlimited. Current sold: ${product.sold}.`, current); if (value === null) return; const inventoryLimit = value.trim() === '' ? null : Number(value); if (!Number.isInteger(inventoryLimit) && inventoryLimit !== null) return notify('Inventory must be a whole number or blank for unlimited.'); try { const response = await fetch(`/api/products/${encodeURIComponent(product.id)}/inventory`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inventoryLimit }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not update inventory.'); reload(); notify(`${product.title} inventory updated`); } catch (inventoryError) { notify(inventoryError.message); } };
  const refundOrder = async (order) => { if (!window.confirm(`Refund ${fmt(order.amountMinor)} to ${order.buyerName}? This requests a full refund and cannot be undone.`)) return; try { const response = await fetch(`/api/orders/${encodeURIComponent(order.id)}/refund`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'Creator-issued refund' }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not refund this order.'); reload(); notify(result.providerStatus === 'pending' ? `Refund requested for ${order.buyerName}` : `Refund recorded for ${order.buyerName}`); } catch (refundError) { notify(refundError.message); } };
  return <main className="dash-shell">
    <header className="dash-header"><button className="wordmark" onClick={onStorefront}><span>n</span> NICHE store</button><div className="dash-actions"><button className="outline-button" onClick={onStorefront}>View store ↗</button><div className="avatar-small">{creator.name.slice(0, 2).toUpperCase()}</div></div></header>
    <div className="dash-layout">
      <aside><div className="creator-mini"><div className="avatar-small">{creator.name.slice(0, 2).toUpperCase()}</div><div><strong>{creator.name}</strong><span>@{creator.handle}</span></div></div><nav><a className="active" href="#overview">Overview</a><a href="#products">Products <span>{data?.products.length ?? 0}</span></a><button onClick={() => setOrdersOpen(true)}>Orders</button><button onClick={() => setCouponsOpen(true)}>Discounts</button><a href="#audience">Audience</a><button onClick={() => setSettingsOpen(true)}>Store settings</button></nav><div className="sidebar-bottom"><a href="#help">Help & resources ↗</a><button onClick={onLogout}>Log out</button></div></aside>
      <section className="dash-content">
        <div className="dash-title"><div><p className="eyebrow">Your creator workspace</p><h1>Good morning, {creator.name.split(' ')[0]} <span>✦</span></h1><p>Here’s what’s happening in your store.</p></div><button className="primary-button" onClick={() => setComposerOpen(true)}>+ New product</button></div>
        <section className="stat-grid"><article><p>Total sales</p><strong>{fmt(data?.summary.totalSalesMinor ?? 0)}</strong><span><i>Paid orders</i></span></article><article><p>Orders</p><strong>{data?.summary.orderCount ?? 0}</strong><span><i>Completed purchases</i></span></article><article><p>Store visits</p><strong>{data?.summary.visits ?? 0}</strong><span><i>Unique daily visitors</i></span></article><article><p>Conversion</p><strong>{data?.summary.conversion ?? 0}%</strong><span><i>Orders per visit</i></span></article></section>
        <div className="dashboard-grid"><section className="panel sales-panel"><div className="panel-head"><div><h2>Sales overview</h2><p>Revenue by product</p></div></div><div className="top-products">{(data?.topProducts ?? []).map((product) => <div key={product.id}><span>{product.title}</span><strong>{fmt(product.salesMinor)}</strong><small>{product.orderCount} paid order{product.orderCount === 1 ? '' : 's'}</small></div>)}{data?.topProducts?.length === 0 && <p>No paid orders yet.</p>}</div></section>
        <section className="panel orders-panel"><div className="panel-head"><div><h2>Recent orders</h2><p>Your latest sales</p></div><button className="text-button" onClick={() => setOrdersOpen(true)}>View all <Arrow /></button></div><div className="orders">{(data?.recentOrders ?? []).map((order) => <Order key={order.id} initials={order.buyerName.slice(0, 2).toUpperCase()} name={order.buyerName} item={order.product?.title ?? 'Product'} price={fmt(order.amountMinor)} state={order.state} refundState={order.refundState} onRefund={() => refundOrder(order)} />)}</div></section></div>
        <section className="panel product-panel"><div className="panel-head"><div><h2>Your products</h2><p>What your audience can buy</p></div><button className="text-button" onClick={() => notify('Product manager opened')}>Manage products <Arrow /></button></div><div className="product-rows">{(data?.products ?? fallbackProducts).map(p => <div className="product-row" key={p.id}><div className={`row-art ${p.color}`}>{p.mark}</div><div><strong>{p.title}</strong><p>{p.type}</p></div><strong>{p.externalUrl ? 'External' : fmt(p.price)}</strong><span className="sold">{p.active === false ? 'Hidden' : p.soldOut ? 'Sold out' : 'Live'} · {p.sold} sold · {p.inventoryRemaining === null ? 'Unlimited' : `${p.inventoryRemaining} remaining`}</span><div className="product-actions">{!p.externalUrl && <button className="visibility-button" onClick={() => updatePrice(p)}>Price</button>}<button className="visibility-button" onClick={() => updateInventory(p)}>Inventory</button><button className="visibility-button" onClick={() => toggleVisibility(p)}>{p.active === false ? 'Make live' : 'Hide'}</button></div></div>)}</div></section>
      </section>
    </div>{toast && <div className="toast">✦ {toast}</div>}{composerOpen && <ProductComposer onClose={() => setComposerOpen(false)} onCreated={() => { setComposerOpen(false); reload(); notify('Product published'); }} />}{settingsOpen && <StoreSettings creator={creator} onClose={() => setSettingsOpen(false)} onSaved={(nextCreator) => { onCreatorUpdated(nextCreator); setSettingsOpen(false); notify('Store settings saved'); }} />}{couponsOpen && <CouponManager onClose={() => setCouponsOpen(false)} />}{ordersOpen && <OrderManager onClose={() => setOrdersOpen(false)} onRefunded={() => { reload(); notify('Refund recorded'); }} />}
  </main>;
}

function Order({ initials, name, item, price, state, refundState, onRefund }) { const refunded = state === 'test_refunded' || state === 'refunded'; const status = refunded ? 'Refunded' : refundState === 'pending' ? 'Refund pending' : refundState === 'failed' ? 'Refund failed' : ''; return <div className="order"><div className="order-avatar">{initials}</div><div><strong>{name}</strong><p>{item}{status ? ` · ${status}` : ''}</p></div><span>{price}</span>{['test_paid', 'paid'].includes(state) && !refundState && <button className="refund-button" onClick={onRefund}>Refund</button>}</div>; }

function App() { const [page, setPage] = useState('store'); const [creator, setCreator] = useState(null); const purchaseMatch = window.location.pathname.match(/^\/purchases\/([A-Za-z0-9_-]{20,})$/); const policyMatch = window.location.pathname.match(/^\/(terms|privacy|refunds)$/); const storefrontMatch = window.location.pathname.match(/^\/@([a-z0-9-]{3,30})$/i); useEffect(() => { fetch('/api/auth/me').then((response) => response.json()).then((data) => setCreator(data.creator)).catch(() => undefined); }, []); const returnHome = () => { window.history.pushState({}, '', '/'); window.location.reload(); }; const signOut = async () => { await fetch('/api/auth/logout', { method: 'POST' }); setCreator(null); setPage('store'); }; if (purchaseMatch) return <PurchaseLibrary token={purchaseMatch[1]} onBack={returnHome} />; if (policyMatch) return <PolicyPage policyKey={policyMatch[1]} onBack={returnHome} />; if (page === 'auth') return <AuthPanel onBack={() => setPage('store')} onAuthenticated={(nextCreator) => { setCreator(nextCreator); setPage('dashboard'); }} />; if (page === 'dashboard' && creator) return <Dashboard creator={creator} onCreatorUpdated={setCreator} onLogout={signOut} onStorefront={() => { window.history.pushState({}, '', `/@${creator.handle}`); setPage('store'); }} />; return <Storefront handle={storefrontMatch?.[1] || creator?.handle} onDashboard={() => setPage(creator ? 'dashboard' : 'auth')} />; }

createRoot(document.getElementById('root')).render(<App />);
