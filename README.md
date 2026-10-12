# NumberPlus v3 — Digital Services Store

Full rebuild of the NumberPlus store: Express + MySQL backend, Arabic RTL + English
frontend, user panel + admin panel, OTP email verification (Resend), Cryptomus USDT
automatic payments, manual payment methods, balance codes, free offers, tickets,
notifications, email broadcast.

## Quick start (local)

```bash
cp .env.example .env   # fill in values
npm install
node server.js
```

Open http://localhost:8080 — `/api/health` should return `{"status":"ok"}`.

## Deploy on Railway

1. Push this repo to GitHub and create a new Railway service from it
   (or `railway up` from this directory).
2. Add a MySQL plugin/service to the same Railway project.
3. In the new service → **Variables**, set (copy DB values from the MySQL service):
   - `MYSQLHOST`, `MYSQLPORT`, `MYSQLUSER`, `MYSQLPASSWORD`, `MYSQLDATABASE`
     (the app also accepts `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`)
   - `JWT_SECRET` — long random string (required, app refuses to boot without it)
   - `RESEND_API_KEY` — Resend API key for OTP emails
   - `RESEND_FROM` — e.g. `NumberPlus <info@numberplus.me>`
   - `ADMIN_EMAILS` — `sajadem88@gmail.com,saladuu77@gmail.com,shhm98@gmail.com`
   - `CRYPTOMUS_API_KEY`, `CRYPTOMUS_MERCHANT_UUID` — for USDT auto-payments
     (https://pay.cryptomus.com/) — optional; manual methods work without it
   - `SIGNUP_BONUS` — e.g. `0.10` new-user bonus (optional)
4. Deploy. Tables are created automatically on first boot; 3 starter products
   are seeded if the catalogue is empty.

## Admin access

Log in with one of the `ADMIN_EMAILS` addresses (auto-promoted to admin on
login/OTP verify), then open `/admin` in the frontend or call the API directly:

- `GET /api/admin/stats` — dashboard numbers
- `GET/POST/PUT/DELETE /api/admin/products` — catalogue management
- `GET /api/admin/orders`, `POST /api/admin/orders/:id/deliver`,
  `POST /api/admin/orders/:id/cancel` (refunds balance + restores stock)
- `GET /api/admin/users?search=`, `POST /api/admin/users/:id/ban|unban|balance|reset-balance`
- `POST /api/admin/balance-codes` `{amount, count}` — gift codes
- `GET /api/admin/tickets`, `POST /api/admin/tickets/:id/reply`
- `POST /api/admin/notifications`, `POST /api/admin/email-broadcast`
- `GET/PUT /api/admin/settings` — support contacts, social links
- `POST/DELETE /api/admin/payment-methods` — manual payment methods

## User API

- `POST /api/auth/register` `{fullName, email (gmail only), username, password}` → OTP email
- `POST /api/auth/verify-otp` `{email, otp}` → JWT + user (6-digit customer_id, avatar)
- `POST /api/auth/login` `{identifier, password}` → OTP email, then
  `POST /api/auth/login-otp` `{email, otp}` → JWT
- `GET /api/products`, `GET /api/products/:category`, `GET /api/products/:category/:subcategory`
- `POST /api/orders` `{productId, quantity, linkValue?, numberValue?}` (Bearer JWT)
- `GET /api/orders`, `GET /api/user/profile`
- `POST /api/balance/redeem` `{code}`
- `POST /api/payment/cryptomus/create` `{amount}` → invoice URL
- `POST /api/payment/cryptomus/webhook` — Cryptomus callback
- `GET/POST /api/tickets`, `GET /api/notifications`, `GET /api/payment/methods`

## Notes

- Passwords hashed with bcryptjs (cost 10); JWT expiry 30 days.
- Order creation is transactional with row locks (stock + balance safe).
- The SPA frontend in `public/` is served statically with an SPA fallback.
- The current `public/index.html` is a localStorage demo shell; wiring it to
  these endpoints (or replacing it) is the remaining frontend step.
