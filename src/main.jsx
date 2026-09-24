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
  return <button className="product-card" onClick={() => onBuy(product)}>
    <div className={`product-art ${product.color}`}>
      {product.badge && <span className="badge">{product.badge}</span>}
      <span className="art-mark">{product.mark}</span>
      <span className="art-line" />
    </div>
    <div className="product-copy">
      <p className="eyebrow">{product.type}</p>
      <h3>{product.title}</h3>
      <p className="description">{product.desc}</p>
      <span className="product-price">{fmt(product.price)} <Arrow /></span>
    </div>
  </button>;
}

function Checkout({ product, onClose }) {
  const [paid, setPaid] = useState(false);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  async function completeTestCheckout() {
    setSubmitting(true); setError('');
    try {
      const response = await fetch('/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: product.id, email }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not create your order.');
      setPaid(true);
    } catch (checkoutError) { setError(checkoutError.message); }
    finally { setSubmitting(false); }
  }
  if (paid) return <div className="modal-backdrop"><section className="checkout success" role="dialog" aria-modal="true">
    <button className="close" onClick={onClose}>×</button>
    <div className="success-icon">✓</div>
    <p className="eyebrow">Payment successful</p>
    <h2>It’s yours.</h2>
    <p>We’ve sent your receipt and access details to your email.</p>
    <button className="primary-button" onClick={onClose}>Back to Maya’s store</button>
  </section></div>;
  return <div className="modal-backdrop"><section className="checkout" role="dialog" aria-modal="true" aria-labelledby="checkout-title">
    <button className="close" onClick={onClose} aria-label="Close checkout">×</button>
    <div className="checkout-brand"><span className="tiny-logo">m</span> mayahq</div>
    <div className="checkout-summary">
      <div className={`mini-art ${product.color}`}>{product.mark}</div>
      <div><p className="eyebrow">{product.type}</p><h2 id="checkout-title">{product.title}</h2><strong>{fmt(product.price)}</strong></div>
    </div>
    <label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoFocus /></label>
    <p className="pay-label">Pay securely with</p>
    <div className="pay-options"><button className="pay-option active"><span className="upi-dot">◉</span> UPI</button><button className="pay-option">Card</button><button className="pay-option">Netbanking</button></div>
    {error && <p className="form-error">{error}</p>}
    <button className="primary-button pay" disabled={submitting} onClick={completeTestCheckout}>{submitting ? 'Recording order…' : `Complete test payment ${fmt(product.price)}`} <Arrow /></button>
    <p className="secure-note">Test mode — no money is collected · Live checkout connects through a licensed payment partner</p>
  </section></div>;
}

function Storefront({ onDashboard }) {
  const [selected, setSelected] = useState(null);
  const [products, setProducts] = useState(fallbackProducts);
  useEffect(() => { fetch('/api/storefront').then((response) => response.ok ? response.json() : Promise.reject()).then((data) => setProducts(data.products)).catch(() => undefined); }, []);
  return <>
    <main className="store-shell">
      <header className="store-header">
        <a className="wordmark" href="#top" aria-label="Maya home"><span>m</span> mayahq</a>
        <button className="dashboard-link" onClick={onDashboard}>Creator dashboard <Arrow /></button>
      </header>
      <section className="hero" id="top">
        <div className="portrait"><span>ML</span></div>
        <p className="eyebrow">Designing a good independent life</p>
        <h1>Hi, I’m Maya.<br /><em>I make useful things.</em></h1>
        <p className="hero-copy">Templates, tiny systems, and honest advice for thoughtful freelancers and designers.</p>
        <div className="socials"><a href="#instagram">Instagram</a><a href="#newsletter">Newsletter</a><a href="#linkedin">LinkedIn</a></div>
      </section>
      <section className="products" aria-labelledby="products-title">
        <div className="section-heading"><div><p className="eyebrow">Start here</p><h2 id="products-title">Things I’ve made for you</h2></div><span>3 products</span></div>
        <div className="product-grid">{products.map((product) => <ProductCard key={product.id} product={product} onBuy={setSelected} />)}</div>
      </section>
      <section className="note">
        <span className="spark">✳</span><p>Every purchase helps me make more free resources for independent people.</p><span className="spark">✳</span>
      </section>
      <footer><span>© 2026 Maya Lim</span><span>Made with <b>mayahq</b></span><a href="#terms">Terms</a><a href="#privacy">Privacy</a></footer>
    </main>
    {selected && <Checkout product={selected} onClose={() => setSelected(null)} />}
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
  return <main className="auth-shell"><button className="wordmark" onClick={onBack}><span>m</span> mayahq</button><section className="auth-card"><p className="eyebrow">Creator portal</p><h1>{mode === 'login' ? 'Welcome back.' : 'Start your storefront.'}</h1><p>{mode === 'login' ? 'Sign in to manage your products, orders, and audience.' : 'Create your free creator account in a few minutes.'}</p><form onSubmit={submit}>{mode === 'register' && <><label>Your name<input required value={form.name} onChange={update('name')} placeholder="Maya Lim" /></label><label>Store handle<input required value={form.handle} onChange={update('handle')} placeholder="maya-lim" /></label></>}<label>Email address<input required type="email" value={form.email} onChange={update('email')} placeholder="you@example.com" /></label><label>Password<input required type="password" minLength="10" value={form.password} onChange={update('password')} placeholder="At least 10 characters" /></label>{error && <p className="form-error">{error}</p>}<button className="primary-button auth-submit" disabled={submitting}>{submitting ? 'Please wait…' : mode === 'login' ? 'Sign in →' : 'Create account →'}</button></form><p className="auth-switch">{mode === 'login' ? 'New here?' : 'Already have an account?'} <button onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>{mode === 'login' ? 'Create an account' : 'Sign in'}</button></p><p className="demo-note">Demo account: <b>maya@mayahq.test</b> · <b>demo-password-2026</b></p></section></main>;
}

function ProductComposer({ onClose, onCreated }) {
  const [form, setForm] = useState({ title: '', description: '', price: '', type: 'Digital download' });
  const [error, setError] = useState('');
  async function submit(event) { event.preventDefault(); setError(''); const response = await fetch('/api/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: form.title, description: form.description, priceMinor: Math.round(Number(form.price) * 100), type: form.type }) }); const result = await response.json(); if (!response.ok) return setError(result.error || 'Could not create product.'); onCreated(result.product); }
  return <div className="modal-backdrop"><section className="checkout composer" role="dialog" aria-modal="true" aria-labelledby="product-title"><button className="close" onClick={onClose} aria-label="Close product editor">×</button><p className="eyebrow">New product</p><h2 id="product-title">Make something sellable.</h2><form onSubmit={submit}><label>Product title<input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="The focused freelancer kit" /></label><label>Short description<textarea required minLength="10" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="What buyers will get and why it’s useful." /></label><label>Product type<select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}><option>Digital download</option><option>1:1 session</option><option>Service</option></select></label><label>Price in INR<input required min="0" type="number" step="0.01" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} placeholder="999" /></label>{error && <p className="form-error">{error}</p>}<button className="primary-button pay">Publish product <Arrow /></button></form></section></div>;
}

function Dashboard({ onStorefront, creator, onLogout }) {
  const [toast, setToast] = useState('');
  const [data, setData] = useState(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const reload = () => fetch('/api/dashboard').then((response) => response.ok ? response.json() : Promise.reject()).then(setData).catch(() => undefined);
  useEffect(() => { reload(); }, []);
  const notify = (message) => { setToast(message); window.setTimeout(() => setToast(''), 2800); };
  return <main className="dash-shell">
    <header className="dash-header"><button className="wordmark" onClick={onStorefront}><span>m</span> mayahq</button><div className="dash-actions"><button className="outline-button" onClick={onStorefront}>View store ↗</button><div className="avatar-small">{creator.name.slice(0, 2).toUpperCase()}</div></div></header>
    <div className="dash-layout">
      <aside><div className="creator-mini"><div className="avatar-small">{creator.name.slice(0, 2).toUpperCase()}</div><div><strong>{creator.name}</strong><span>@{creator.handle}</span></div></div><nav><a className="active" href="#overview">Overview</a><a href="#products">Products <span>{data?.products.length ?? 0}</span></a><a href="#orders">Orders</a><a href="#audience">Audience</a><a href="#settings">Store settings</a></nav><div className="sidebar-bottom"><a href="#help">Help & resources ↗</a><button onClick={onLogout}>Log out</button></div></aside>
      <section className="dash-content">
        <div className="dash-title"><div><p className="eyebrow">Your creator workspace</p><h1>Good morning, {creator.name.split(' ')[0]} <span>✦</span></h1><p>Here’s what’s happening in your store.</p></div><button className="primary-button" onClick={() => setComposerOpen(true)}>+ New product</button></div>
        <section className="stat-grid"><article><p>Total sales</p><strong>{fmt(data?.summary.totalSalesMinor ?? 48720)}</strong><span className="positive">↑ 18.4% <i>vs last month</i></span></article><article><p>Orders</p><strong>{data?.summary.orderCount ?? 42}</strong><span className="positive">↑ 12.0% <i>vs last month</i></span></article><article><p>Store visits</p><strong>{data?.summary.visits ?? 1284}</strong><span className="positive">↑ 8.2% <i>vs last month</i></span></article><article><p>Conversion</p><strong>{data?.summary.conversion ?? '3.27'}%</strong><span className="negative">↓ 0.4% <i>vs last month</i></span></article></section>
        <div className="dashboard-grid"><section className="panel sales-panel"><div className="panel-head"><div><h2>Sales overview</h2><p>Revenue over the last 30 days</p></div><button className="select-button">Last 30 days⌄</button></div><div className="chart"><div className="chart-labels"><span>₹8k</span><span>₹6k</span><span>₹4k</span><span>₹2k</span><span>₹0</span></div><div className="chart-area"><svg viewBox="0 0 560 200" preserveAspectRatio="none" aria-label="Sales chart"><defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#9d84df" stopOpacity=".34"/><stop offset="1" stopColor="#9d84df" stopOpacity="0"/></linearGradient></defs><path d="M0,172 C15,165 22,148 42,155 S72,121 91,137 S114,124 132,129 S159,104 178,115 S204,83 224,94 S246,112 267,91 S294,77 314,83 S340,45 360,66 S385,54 403,61 S426,31 448,49 S478,35 496,42 S526,12 560,18 L560,200 L0,200Z" fill="url(#fill)"/><path d="M0,172 C15,165 22,148 42,155 S72,121 91,137 S114,124 132,129 S159,104 178,115 S204,83 224,94 S246,112 267,91 S294,77 314,83 S340,45 360,66 S385,54 403,61 S426,31 448,49 S478,35 496,42 S526,12 560,18" fill="none" stroke="#7454c6" strokeWidth="3"/></svg><div className="chart-days"><span>Aug 24</span><span>Aug 31</span><span>Sep 7</span><span>Sep 14</span><span>Sep 21</span></div></div></div></section>
        <section className="panel orders-panel"><div className="panel-head"><div><h2>Recent orders</h2><p>Your latest sales</p></div><button className="text-button">View all <Arrow /></button></div><div className="orders">{(data?.recentOrders ?? []).map((order) => <Order key={order.id} initials={order.buyerName.slice(0, 2).toUpperCase()} name={order.buyerName} item={order.product?.title ?? 'Product'} price={fmt(order.amountMinor)} />)}</div></section></div>
        <section className="panel product-panel"><div className="panel-head"><div><h2>Your products</h2><p>What your audience can buy</p></div><button className="text-button" onClick={() => notify('Product manager opened')}>Manage products <Arrow /></button></div><div className="product-rows">{(data?.products ?? fallbackProducts).map(p => <div className="product-row" key={p.id}><div className={`row-art ${p.color}`}>{p.mark}</div><div><strong>{p.title}</strong><p>{p.type}</p></div><strong>{fmt(p.price)}</strong><span className="sold">{p.sold} sold</span><button onClick={() => notify(`${p.title} editor opened`)}>···</button></div>)}</div></section>
      </section>
    </div>{toast && <div className="toast">✦ {toast}</div>}{composerOpen && <ProductComposer onClose={() => setComposerOpen(false)} onCreated={() => { setComposerOpen(false); reload(); notify('Product published'); }} />}
  </main>;
}

function Order({ initials, name, item, price }) { return <div className="order"><div className="order-avatar">{initials}</div><div><strong>{name}</strong><p>{item}</p></div><span>{price}</span></div>; }

function App() { const [page, setPage] = useState('store'); const [creator, setCreator] = useState(null); useEffect(() => { fetch('/api/auth/me').then((response) => response.json()).then((data) => setCreator(data.creator)).catch(() => undefined); }, []); const signOut = async () => { await fetch('/api/auth/logout', { method: 'POST' }); setCreator(null); setPage('store'); }; if (page === 'auth') return <AuthPanel onBack={() => setPage('store')} onAuthenticated={(nextCreator) => { setCreator(nextCreator); setPage('dashboard'); }} />; if (page === 'dashboard' && creator) return <Dashboard creator={creator} onLogout={signOut} onStorefront={() => setPage('store')} />; return <Storefront onDashboard={() => setPage(creator ? 'dashboard' : 'auth')} />; }

createRoot(document.getElementById('root')).render(<App />);
