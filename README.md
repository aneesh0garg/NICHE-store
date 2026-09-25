# NICHE store — project draft

An India-first, multi-country-ready platform that lets creators publish a branded storefront, sell digital products and bookings, collect payments, and see a simple business dashboard.

The detailed product and delivery plan is in [docs/PROJECT_DRAFT.md](docs/PROJECT_DRAFT.md).
Deployment, system-hosting, payment, delivery, and operational procedures are in [docs/OPERATIONS.md](docs/OPERATIONS.md).

## Product thesis

Creators should be able to go from sign-up to a shareable, trustworthy checkout in minutes—without building a website or stitching together payment, delivery, and analytics tools.

## Current implementation

- **Web:** React + Vite
- **API:** Node.js standard-library server
- **Local data:** SQLite (Node's `node:sqlite`); created automatically in `data/`
- **Auth:** Email/password accounts with scrypt password hashes, opaque HttpOnly sessions, and protected creator APIs
- **Payments:** Razorpay Standard Web Checkout creates provider orders server-side and verifies payment signatures before granting purchase access. Local test checkout remains available only with `PAYMENT_MODE=local_test`.

## Principles

- Model money in integer minor units and keep an immutable payment ledger.
- Treat payment-provider webhooks as the source of truth, with idempotent processing.
- Keep provider, tax, currency, and country logic behind explicit interfaces.
- Do not collect or store raw card data.

## Run locally

```sh
npm install
npm run build
npm start
```

Open `http://127.0.0.1:4173`. Public storefronts are available at `http://127.0.0.1:4173/@handle` (for example, `/@mayahq`). The application creates `data/creator-storefront.db` automatically. Test checkout records an order in that database without collecting money. Delete the database (and its `-wal` / `-shm` companion files) to reset local data.

The seeded demo creator uses `maya@mayahq.test` / `demo-password-2026`; create a new account from the Creator dashboard to test an empty storefront.

### Razorpay setup

Copy `.env.example` to `.env`, use Razorpay **test-mode** credentials, and set `PAYMENT_MODE=razorpay`. The server creates the provider order at `POST /api/create-order`; the browser opens Standard Checkout and sends its response to `POST /api/verify-payment`, where the server verifies the HMAC signature before marking the order paid. API secrets remain server-side.

For live payments, use live-mode credentials, enable automatic payment capture in Razorpay, set `RAZORPAY_WEBHOOK_SECRET`, and configure the HTTPS webhook endpoint at `/api/webhooks/razorpay` before launch.

### Protected digital downloads

Creators can attach one supported file (PDF, ZIP, JSON, CSV, text, PNG, or JPEG; up to 5 MB) to a digital-download product. Files are stored outside the public build in `data/assets/`. A paid buyer's purchase library issues a private download URL that expires after 24 hours; reopening the library creates a new valid link. Replace this local adapter with private object storage before production.

### Purchase receipts

Every verified Razorpay payment queues a buyer receipt and a creator sale notification in local outboxes. Set `APP_URL`, `RESEND_API_KEY`, and `RECEIPT_FROM_EMAIL` to send them through Resend; the sender domain must be verified in Resend. Delivery uses a stable idempotency key per order and retries queued or failed messages every 15 minutes, so webhook/browser retries do not duplicate email. [Resend's email API](https://resend.com/vercel) accepts a server-side Bearer API key and an `Idempotency-Key` header for this flow.

## Status

This is a functional local MVP foundation: public storefronts, creator accounts, protected dashboards, product publishing, Razorpay test checkout, provider-confirmed full refunds, persistent local data, and purchase access. Production still requires managed Postgres, receipt sender configuration, production object storage/secure downloads, legal policies, and operational controls.
