# CampusBite

College canteen ordering for web and Android, built around a React client, FastAPI service, and Supabase as the planned system of record.

## Current milestone

**Phases 1–10 implementation authored.** CampusBite now includes student, staff and admin flows, transactional ordering, Razorpay checkout verification/webhooks, Realtime order tracking with polling fallback, a Capacitor Android project, deployment configuration, and CI. Supabase migrations and live provider/device workflows still need to be configured and verified in their respective environments.

The two handwritten diagrams mentioned in the original brief were not present in the provided attachments. The written brief is the requirements source for now.

## Architecture

- `frontend/`: React, Vite, TypeScript, Tailwind CSS, React Router.
- `backend/`: FastAPI API, Pydantic schemas and modular routes.
- `supabase/`: versioned SQL migrations and seed data (Phase 2).
- `docs/`: business rules, implementation checklist and test guidance.
- `frontend/android/`: generated Capacitor Android project (requires Android Studio/SDK to build and run).

The API will verify Supabase access tokens and enforce roles server-side. PostgreSQL RLS will protect exposed data. Order and payment state will change only through trusted backend operations. Razorpay will remain in test mode until gateway credentials and webhook verification are configured.

The Supabase migrations and development seed are authored but have not been applied to a live project. The schema creates student-only profiles on signup, protects data with RLS, and enables Realtime publication for orders and menu availability. FastAPI verifies user JWTs and reads role/status from the database. Configure and apply all migrations before pilot use.

## Supabase setup

Install the Supabase CLI and Docker Desktop for local Supabase development, then run from the repository root:

    supabase start
    supabase db reset

For a hosted project, authenticate and link it before applying migrations:

    supabase login
    supabase link --project-ref <your-project-ref>
    supabase db push

The sample data is development-only. Review supabase/seed.sql before using it in any shared environment.

## Run locally (PowerShell)

Prerequisites: Node.js and Python 3.12. In this environment, the py launcher currently reports that no Python installation is registered; install Python 3.12 before running the backend commands below.

### Backend

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn app.main:app --reload --port 8000 --env-file .env
```

### Frontend (second terminal)

```powershell
cd frontend
npm install
Copy-Item .env.example .env
npm run dev
```

Open <http://localhost:5173>. API health: <http://localhost:8000/health>; interactive docs: <http://localhost:8000/docs>.

## Configuration

Copy the example env files to `.env` and configure service values locally. Never commit secrets or place Supabase service-role/Razorpay secrets in frontend variables. `VITE_API_URL` is public API routing only. Supabase and Razorpay values are listed in `backend/.env.example`; they are not required for the Phase 1 sample menu.

## Delivery checklist

For authenticated routes, set SUPABASE_URL and SUPABASE_ANON_KEY in backend/.env. Set SUPABASE_SERVICE_ROLE_KEY only for signed payment webhook processing; it must remain server-only. Set RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET on the backend for online payments. Asymmetric Supabase signing keys are verified through the project's JWKS endpoint. Set SUPABASE_JWT_SECRET only for legacy HS256 projects. The CampusBite role and account status are read from the database, not token metadata.

- [x] Inspect workspace and supplied attachments.
- [x] Record requirements and business-rule gaps.
- [x] Phase 1: project foundation, frontend build, API startup and in-process route verification.
- [x] Phase 2 implementation: Supabase schema, RLS, authentication and server-side roles. Live migration/integration still needs a configured project.
- [x] Phase 3 UI: student menu, Supabase email auth, profile, browser-persisted cart, checkout review and order/tracking routes.
- [x] Phase 4 implementation: transactional orders, tokens, idempotent create, server-verified prices, student cancellation before acceptance, staff lifecycle transitions, and order history/tracking endpoints.
- [x] Phase 5 implementation: staff order queue, transition actions, menu add/edit, and availability/archive controls. Apply all migrations and verify role access against Supabase before pilot use.
- [x] Phase 5: canteen dashboard and menu/availability management.
- [x] Phase 6 implementation: admin accounts, categories, settings, audit and date-filtered sales reporting.
- [x] Phase 7 implementation: Razorpay order creation, captured-payment/signature verification, signed idempotent webhooks, and retries.
- [x] Phase 8 implementation: RLS-authorized Realtime subscriptions with polling/network-resume fallback.
- [x] Phase 9 implementation: Capacitor Android project and native back-button behavior. Emulator/device verification requires Android Studio/SDK.
- [x] Phase 10 implementation: CI, Vercel/Render deployment files, and pilot setup guidance. Hosted deployment still requires account configuration.

## Business decisions needed before implementation

- Online payment expiry and treatment of late payment for abandoned orders. Late captures are recorded for staff refund review; automatic refund issuance is not implemented.
- Refund policy and who can authorize a refund; automatic refund issuance is not implemented.
- Whether account approval is required for student/staff registration.
- Daily report timezone and definitions of gross sales versus collected payments.

## Backend smoke test

After installing the backend requirements, run `python -m unittest discover -s tests -v` from `backend/`. GitHub Actions runs this suite on Linux alongside the frontend production build. Live transaction, RLS, Razorpay, and browser workflows need configured services.




### Phase 2 auth and profile routes

Authenticated profile routes require SUPABASE_URL and SUPABASE_ANON_KEY in backend/.env. Asymmetric signing keys are verified through the project JWKS endpoint. Set SUPABASE_JWT_SECRET only if the project still issues HS256 tokens. CampusBite role and account status come from the RLS-protected profiles row; token metadata is not used as an application role.

The API exposes GET /api/me, GET /api/me/profile, and PATCH /api/me/profile. The patch allows only full_name and student_id. Run backend unit tests from the backend directory with: python -m unittest discover -s tests -v.

### Phase 3 student web experience

Copy `frontend/.env.example` to `frontend/.env.local` and set the Supabase project URL and public anon key plus the API URL. The browser only uses the anon key; never put a service-role key or payment secret in a Vite variable. Registration sends only full_name and student_id metadata; the database signup trigger assigns the student role. The API loads the authoritative profile and role. The local cart is stored in browser localStorage.

### Phase 4 orders

Apply `supabase/migrations/202610220002_orders.sql` after the initial schema migration. The migration adds an idempotency key and RPCs for transactional order creation and state transitions. The API exposes POST/GET `/api/orders`, GET `/api/orders/{id}`, and POST `/api/orders/{id}/transitions`. The database reads currently available menu items and computes price snapshots and totals in one transaction; the client cannot supply prices. Pickup tokens are random and unique. Students may cancel only their own `placed` order; staff can accept/decline, prepare, mark ready and collect in sequence. Declining requires a reason. Online orders cannot be accepted until payment is confirmed by Phase 7. Collecting a pay-at-pickup order records it paid. An idempotency UUID is required for create requests.

### Phase 5 canteen dashboard

The `/staff` route is available only to active canteen staff/admin profiles. It reads authorized orders and the full menu, and supports order transitions, item editing, availability and archive controls. The API uses the authenticated user's token and Supabase RLS.

### Phases 6–10 setup

Apply migrations in filename order (`202610220001` through `202610220005`) with `supabase db push`. Create the first admin only after the account has signed up and its `profiles` row exists: in the Supabase SQL Editor, run `update public.profiles set role = 'admin', account_status = 'active' where id = (select id from auth.users where email = 'ADMIN_EMAIL');` after replacing the email. SQL Editor uses the project owner role; do not expose this bootstrap capability to the browser. Later role changes use the audited admin UI and prevent disabling the last active admin.

Phase 6 adds the `/admin` dashboard, profile/role controls, categories, canteen settings and daily reports. Reports use UTC date boundaries; gross sales include paid completed orders, and collected payments are shown separately. Phase 7 creates online orders using server-calculated totals, verifies Razorpay signatures and captured amount/order state, and processes signed webhook event IDs once. Configure a Razorpay webhook for `/api/payments/webhook` with `payment.captured`, `payment.failed`, and `order.paid` events. Late captures are recorded for manual refund review. Phase 8 listens to authorized order changes and polls every five seconds if the subscription is unavailable; the Supabase Realtime publication and RLS policies must be active.

For Android, install Android Studio and its SDK/JDK, then from `frontend/` run `npm ci` and `npm run android:sync`; open with `npm run android:open` or run on an attached emulator/device with `npm run android:run`. Set `VITE_API_URL`, `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the frontend build environment. Vercel can deploy `frontend/` using its included `vercel.json`. Render can deploy the API from the repository root using `render.yaml`; set all backend secrets and set `CORS_ALLOWED_ORIGINS` to the exact HTTPS frontend origin(s). Apply Supabase migrations and configure Auth redirect URLs before testing hosted flows. Never expose the service-role key or Razorpay secret to Vite.

GitHub Actions builds the frontend and runs backend unit tests. Review the manual checklist in `docs/IMPLEMENTATION.md` for final browser, Supabase, payment and Android checks. This repository has not been deployed to Vercel/Render or connected to live Supabase/Razorpay accounts.


