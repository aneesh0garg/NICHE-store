# NICHE store operations guide

## Current architecture

NICHE store is a React/Vite frontend served by a Node.js HTTP server. The server owns authentication, SQLite data, Razorpay order creation/signature verification, webhook processing, protected download delivery, and the email outbox.

Runtime data is deliberately excluded from Git:

- `data/creator-storefront.db` is the SQLite database.
- `data/assets/` contains private creator upload files.
- `logs/` contains local service logs.
- `.env` contains local secrets.

Back up `data/` before changing hosts or making destructive database changes.

## Local and system hosting

For an interactive local session:

```sh
npm run build
npm start
```

The server binds to `127.0.0.1:4173` by default. A public deployment from a personal Mac should use a Cloudflare Tunnel rather than exposing port 4173 through a router.

The example templates in `ops/` show the two persistent macOS LaunchAgents required:

1. `com.pi-coding.niche-store` runs `server.mjs`.
2. `com.pi-coding.niche-store-tunnel` runs the Cloudflare Tunnel and sends `store.pi-coding.com` to `http://127.0.0.1:4173`.

Copy the example files to private local filenames, replace all placeholders, then load them with `launchctl bootstrap gui/<your-uid> <path-to-plist>`. Check status with `launchctl print gui/<your-uid>/com.pi-coding.niche-store` and inspect `logs/` for errors.

## Environment variables

Copy `.env.example` to `.env`; never commit `.env`.

| Variable | Required for | Notes |
| --- | --- | --- |
| `PORT` | Optional | Defaults to `4173`. |
| `HOST` | Optional | Defaults to `127.0.0.1`. |
| `NODE_ENV` | Production | Set to `production` for HSTS and secure session cookies. |
| `PAYMENT_MODE` | Payments | Set `razorpay` for Razorpay Checkout; use `local_test` only for local regression tests. |
| `RAZORPAY_KEY_ID` | Razorpay | Browser-safe key ID; use the live key only at launch. |
| `RAZORPAY_KEY_SECRET` | Razorpay | Server-only secret. |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay webhooks | Configure the same secret in Razorpay’s dashboard. |
| `APP_URL` | Receipts | Public HTTPS base URL, such as `https://store.pi-coding.com`. |
| `RESEND_API_KEY` | Buyer receipts | Server-only Resend credential. |
| `RECEIPT_FROM_EMAIL` | Buyer receipts | A sender address from a Resend-verified domain. |

## Payment lifecycle

1. The browser requests `POST /api/create-order` with the product and buyer email.
2. The server validates price, coupon, availability, and the minimum amount, then creates a Razorpay order.
3. Razorpay Standard Checkout collects payment details; the application never receives card or UPI credentials.
4. The browser submits Razorpay’s payment ID, provider order ID, and signature to `POST /api/verify-payment`.
5. The server verifies the HMAC-SHA256 signature, atomically consumes inventory, marks the order paid, creates an audit record, and queues a receipt.
6. `payment.captured` webhooks are signature-checked, stored idempotently in `webhook_events`, and reconcile the same order safely if the browser flow did not complete.
7. A creator can request one full refund per paid order. Razorpay is asked to create the refund server-side; an order is marked refunded only when Razorpay returns or webhooks a `processed` status. Pending and failed refunds remain visible in the creator dashboard.

Before live payments, configure Razorpay to send `payment.captured`, `payment.failed`, `refund.created`, and `refund.processed` to:

```text
https://store.pi-coding.com/api/webhooks/razorpay
```

## Digital delivery and receipts

Creators can attach one allowed private file to a digital-download product. The server stores it in `data/assets/`; a paid buyer’s purchase library grants a 24-hour signed download URL. Download grants stop working for refunded or unpaid orders.

Each verified Razorpay payment writes one idempotent receipt record to `email_outbox`. If Resend is configured, the server submits the receipt and purchase-library link to Resend with a stable idempotency key. Otherwise it remains queued until sending is configured.

## Verification

Run before every release:

```sh
npm test
npm run build
git diff --check
```

The automated test suite covers inventory oversell protection and paid private-download access.

### Razorpay test payments

Use these only while the application is configured with Razorpay **test-mode** keys. Never enter them into a live checkout.

| Method | Test details |
| --- | --- |
| Card | `4100 2800 0000 1007` · CVV `123` · expiry `12/26` |
| UPI | `test@razorpay` |

## Production checklist

- Replace shared/test keys with newly generated live Razorpay and Resend credentials.
- Remove the public demo creator/account and test products.
- Configure the Razorpay webhook secret and events, including `refund.created`, `refund.processed`, and `refund.failed`.
- Verify the Resend sender domain and set `RECEIPT_FROM_EMAIL`.
- Confirm backups for `data/` and a restore procedure.
- Review terms, privacy, refund rules, creator approval, tax, and payout requirements with qualified advisers.
