# Creator Storefront: product and technical draft

## 1. Vision

Build an India-first commerce layer for independent creators: a public link-in-bio storefront where they can sell downloads, courses, consultations, memberships, and external links. The experience should be as fast to set up as a profile page, but reliable enough to become the creator's main checkout.

**Initial market:** Indian creators selling primarily to Indian buyers.

**Expansion posture:** support additional countries through configuration and payment/tax adapters, rather than duplicating the product per country.

## 2. Who it is for

| User | Core need | First-win moment |
| --- | --- | --- |
| Solo creator | Sell a PDF, template, video bundle, or link without a custom site | Publishes a page and receives a UPI payment |
| Coach / consultant | Turn audience into booked calls | A paid calendar slot appears automatically |
| Buyer | Trust a creator link and pay with a familiar method | Receives a clear receipt and immediate access |
| Operations admin | Keep the marketplace safe and resolve payment issues | Reviews a dispute, refund, or risky seller in one place |

## 3. MVP scope (12–16 weeks)

### Creator experience

- Sign up and create a `yourdomain.com/@handle` storefront.
- Edit profile, avatar, theme, social links, and SEO/share metadata.
- Create products: external link, digital download, paid appointment, and simple fixed-price service.
- Set INR pricing, optional discount codes, inventory caps, and product visibility.
- Receive order/payment notifications and view sales, conversion, and payout status.
- Request a refund from the dashboard; support-assisted partial refunds are an admin action initially.

### Buyer experience

- Fast mobile-first creator page and product detail page.
- Guest checkout with UPI, cards, and net banking supplied by an approved payment partner.
- Payment receipt plus a purchase library delivered by email; signed, expiring download links for files.
- Clear seller name, support contact, delivery terms, refund policy, and privacy links at checkout.

### Internal operations

- Creator review state, product moderation, blocked-product rules, audit log, refund console, and webhook/reconciliation view.
- Lightweight support notes and order search by email, payment ID, creator, and order ID.

### Explicitly out of MVP

- Native mobile apps, a course player/community, affiliate marketplace, physical-shipping workflows, multi-vendor carts, and international payouts.

## 4. Key product decisions

1. **One seller per checkout.** It reduces tax, fulfilment, refund, and settlement complexity. A buyer can make another purchase in a separate checkout.
2. **Platform of record, seller fulfils.** The platform owns the checkout and technical delivery; the creator owns product accuracy and support policy. Legal/tax responsibilities must be confirmed with counsel before launch.
3. **Use a regulated payment partner.** Do not hold customer funds or build payment-token handling. Start with a provider integration and its hosted/SDK checkout; evaluate linked-account routing only when creator settlements are enabled.
4. **India first, not India-only.** Country configuration controls currency, payment methods, required creator fields, checkout copy, tax behavior, and supported payout destinations.

## 5. India launch requirements and open compliance work

Use an approved payment partner for UPI/cards/net banking and verify payment signatures on the server. If the business collects and distributes funds to creators, it may be operating in a marketplace/payment-aggregation flow: linked-account onboarding, settlement controls, merchant due diligence, reconciliations, and the contractual/regulatory model need specialist review. Razorpay Route, for example, supports linked accounts, split transfers, reversals, and settlement controls; its order-transfer API documentation specifies INR orders and server-side payment-signature verification. [Razorpay Route](https://razorpay.com/route/) · [Route API checklist](https://razorpay.com/docs/payments/route/apis//?preferred-country=IN)

Design the tax model to preserve seller GSTIN, buyer location, tax rate, invoice fields, and whether a sale is through an e-commerce operator. GST portal guidance includes GSTR-1 reporting for supplies made through e-commerce operators/TCS, but the exact responsibility depends on the legal model and product category. Obtain India tax/legal advice before launch; this document is not legal or tax advice. [GST GSTR-1 guidance](https://tutorial.gst.gov.in/userguide/returns/Creation_of_Outward_Supplies_Return_in_GSTR-1.htm) · [RBI cross-border PA direction](https://rbi.org.in/Scripts/NotificationUser.aspx/upload/Scripts/NotificationUser.aspx?Id=12561)

## 6. Multi-country design

Each country lives in configuration, with explicit fallbacks:

```text
CountryProfile
  countryCode, defaultCurrency, locales, timezone
  paymentMethods, paymentProvider, payoutProvider
  creatorOnboardingRequirements, taxPolicy, invoiceRequirements
  supportedProductTypes, consumerPolicyLinks
```

The core order model stores `currency`, `amountMinor`, `countryCode`, `taxSnapshot`, and a provider-neutral payment state. A `PaymentProvider` interface handles checkout-session creation, webhook verification, refunds, and settlement lookup. The India adapter is first; Stripe/other regional adapters are added without changing storefront or order code.

Cross-border selling is a later phase: it needs country-specific merchant onboarding, FX/settlement rules, buyer tax treatment, refund/dispute handling, and product eligibility review—not merely multi-currency checkout.

## 7. Architecture

```text
Browser
  ├─ Storefront (public pages) ──────────┐
  └─ Creator/Admin dashboard ────────────┤
                                         ▼
                                  Next.js application
                                  ├─ Auth / RBAC
                                  ├─ Catalog & storefronts
                                  ├─ Orders & entitlement service
                                  ├─ Payment adapter
                                  └─ Admin / audit APIs
                                         │
              ┌──────────────────────────┼───────────────────────────┐
              ▼                          ▼                           ▼
        PostgreSQL                 Object storage              Queue worker
   orders + ledger + audit       digital product files      webhooks, email,
                                                        fulfilment, reconciliation
              ▲                          ▲                           ▲
              └──────────────── Payment gateway ──────────────────────┘
```

Suggested initial deployment: Vercel or a comparable edge web host, managed PostgreSQL, S3-compatible storage, Redis-backed queue/rate limiting, transactional email provider, error tracking, and an analytics warehouse/event tool. Keep the webhook endpoint and worker independently retryable.

## 8. Core data model

| Area | Essential entities |
| --- | --- |
| Identity | User, CreatorProfile, TeamMember, Role, Session |
| Store | Storefront, Theme, CustomDomain, Link |
| Catalog | Product, Price, Asset, AvailabilityRule, Coupon |
| Commerce | Checkout, Order, OrderItem, PaymentAttempt, Refund, Invoice, TaxSnapshot |
| Money | LedgerEntry, Settlement, PayoutAccount, Payout |
| Access | Entitlement, DownloadGrant, Booking, CalendarConnection |
| Operations | ReviewCase, RiskSignal, SupportCase, AuditEvent, WebhookEvent |

Important invariants:

- Orders, payment attempts, refunds, and ledger entries are append-only; corrections are new records.
- A webhook event is uniquely stored before processing so retries cannot double-grant access or refund twice.
- Product price and tax are copied to the order item at checkout; never recalculate old orders from current catalog data.
- Digital entitlement is granted only after a verified captured/paid provider event.

## 9. Critical flows

### Paid digital download

1. Buyer creates checkout from a product price snapshot.
2. Server creates a provider checkout/order and records a pending payment attempt.
3. Buyer completes hosted/SDK payment.
4. Provider webhook is signature-verified, stored idempotently, and processed by a worker.
5. Worker marks the order paid, writes ledger entries, creates entitlement, emails receipt, and generates a short-lived asset URL on request.

### Refund

1. Creator/admin submits a refund request against a paid order.
2. Policy and remaining refundable amount are checked.
3. Payment adapter makes an idempotent provider refund request.
4. Provider confirmation webhook updates refund and ledger state; entitlement is revoked only when the product policy requires it.

## 10. Security, trust, and reliability baseline

- Hosted/tokenized payment collection only; no raw PAN/CVV in application logs or database.
- HMAC/signature verification, timestamp checks where offered, idempotency keys, and durable webhook-event storage.
- Encrypt secrets, require MFA for admins, enforce RBAC, rate-limit checkout/auth endpoints, and record audit events for money and access changes.
- Validate uploads by MIME type and size; malware-scan stored files; serve private assets only using signed URLs.
- Use a content policy plus review queue for prohibited/high-risk products; publish buyer support, refund, privacy, and terms pages before accepting payment.
- Daily reconciliation between internal ledger, provider payments/refunds, and settlements; alert on unmatched or delayed records.
- Backups, restore drills, error monitoring, and a documented incident/refund playbook before public launch.

## 11. Delivery plan

| Phase | Length | Deliverable / launch gate |
| --- | ---: | --- |
| 0. Validation | 2 weeks | 15 creator interviews, clickable prototype, legal/payment model chosen, success metrics baselined |
| 1. Foundation | 3 weeks | Auth, profiles, storefront routing, catalog, admin roles, schema/migrations, observability |
| 2. Commerce | 3 weeks | INR checkout, verified webhooks, orders/receipts, digital fulfilment, refunds, reconciliation MVP |
| 3. Creator tools | 3 weeks | Theme editor, coupons, dashboards, bookings, onboarding/review workflow |
| 4. Private beta | 2–4 weeks | 25–50 vetted creators, support runbook, penetration/security review, payment/tax reconciliation validated |
| 5. Public India launch | 1 week | Phased acquisition, incident on-call, weekly metric and fraud review |

## 12. Metrics

- Activation: creator publishes within 30 minutes; first product live within 1 day.
- Commerce: checkout completion, successful-payment rate, GMV, average order value, refund rate.
- Creator retention: 30-day active sellers, repeat sales, time to first sale.
- Trust: payment-webhook mismatch rate, refund turnaround time, support tickets/order, fraud loss rate.
- Reliability: checkout API availability, webhook processing delay, digital delivery success rate.

## 13. Team for the MVP

- 1 product-minded full-stack engineer (frontend/storefront + dashboard)
- 1 backend/payments engineer (commerce, ledger, webhooks, worker)
- 1 product designer (flows, mobile checkout, design system)
- Part-time QA/DevOps plus legal/tax and payment-partner contacts

## 14. Decisions needed before implementation

1. Is the platform merchant of record, marketplace facilitator, or only software/provider of payment links?
2. Will creator funds settle directly via a provider's linked accounts, or does the platform collect first and later pay out?
3. Which categories are allowed at launch (education, templates, consultation, etc.) and which are prohibited?
4. What is the creator pricing model: subscription, transaction fee, or both?
5. Is the initial beta invitation-only and restricted to Indian resident creators?

## 15. Recommended first build slice

Ship one coherent “creator gets paid” path: email sign-in → create storefront → add a PDF product → INR checkout → payment webhook → email receipt → secure download → creator sees the sale. Defer themes, custom domains, calendars, subscriptions, and international checkout until that path has reliable payment, refund, and reconciliation behavior.
