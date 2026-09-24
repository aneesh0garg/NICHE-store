# Creator Storefront — project draft

An India-first, multi-country-ready platform that lets creators publish a branded storefront, sell digital products and bookings, collect payments, and see a simple business dashboard.

The detailed product and delivery plan is in [docs/PROJECT_DRAFT.md](docs/PROJECT_DRAFT.md).

## Product thesis

Creators should be able to go from sign-up to a shareable, trustworthy checkout in minutes—without building a website or stitching together payment, delivery, and analytics tools.

## Current implementation

- **Web:** React + Vite
- **API:** Node.js standard-library server
- **Local data:** SQLite (Node's `node:sqlite`); created automatically in `data/`
- **Auth:** Email/password accounts with scrypt password hashes, opaque HttpOnly sessions, and protected creator APIs
- **Payments:** Test checkout only; Razorpay webhook-signature guard is scaffolded but cannot process live payments until merchant credentials and order mapping are added

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

Open `http://127.0.0.1:4173`. The application creates `data/creator-storefront.db` automatically. Test checkout records an order in that database without collecting money. Delete the database (and its `-wal` / `-shm` companion files) to reset local data.

The seeded demo creator uses `maya@mayahq.test` / `demo-password-2026`; create a new account from the Creator dashboard to test an empty storefront.

## Status

This is a functional local MVP foundation: public storefronts, creator accounts, protected dashboards, product publishing, persistent local data, and a test checkout flow. Production still requires managed Postgres, live Razorpay integration/webhook event mapping, email delivery, file storage/secure downloads, legal policies, and operational controls.
