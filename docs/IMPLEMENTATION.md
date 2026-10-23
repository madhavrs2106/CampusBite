# Delivery checklist and workflow

## Requirements captured from written brief

- Student, canteen staff and administrator role experiences.
- Students browse/search/filter menu, manage a cart, place orders, pay online or at pickup, and track orders.
- Staff accept/decline, move orders through valid preparation states, confirm collection/payment, and manage menu data and availability.
- Administrators manage accounts/roles, menu and categories, and date-filtered reports.
- Backend is authoritative for roles, prices, totals, payment confirmation and valid transitions; Supabase RLS and authenticated Realtime subscriptions protect access.
- Responsive web client and Capacitor Android project.

## Diagram inspection

The prompt file was the only item in its attachment manifest. No diagram images or PDFs were available to inspect. Add diagram-derived requirements when the images are supplied.

## Assumptions and unresolved policies

Phase 4 defines cancellation as allowed only for the owner while an order is still `placed`, before staff acceptance. Paid orders cannot be cancelled through this endpoint because refunds require Phase 7. Online orders cannot be accepted until paid. Abandoned online payment expiry and refunds remain decisions for Phase 7; see README.

## Milestones

1. Foundation: Vite/React/TS/Tailwind/Router + FastAPI, sample menu fixture, local commands and startup verification.
2. Supabase: migrations, constraints, indexes, RLS, Auth and token verification.
3. Student UI: auth, menu, cart, checkout, history and tracking.
4. Orders: server-side totals, safe creation, token generation, transitions and cancellation.
5. Canteen: queues, order processing, menu and availability.
6. Admin: accounts, categories, reports and audit.
7. Payments: Razorpay order creation, signature/captured-state verification, signed webhooks and retry reuse.
8. Realtime: RLS-authorized updates and polling/network-resume recovery.
9. Android: Capacitor project and native back button; emulator build/run needs Android Studio/SDK.
10. Production readiness: CI, Vercel/Render config, migration/admin bootstrap and pilot guide.

## Milestone status

- Phase 1 is complete: frontend build passed, Vite and Uvicorn started, and the /health plus /api/menu routes passed an in-process ASGI test.
- Phase 2 has a migration and seed file, FastAPI Supabase JWT verification, database-backed profile roles, role guards, and self-profile endpoints. Twelve unit tests pass, including HS256/ES256 verification and role-tampering restrictions.
- Phase 2 is not complete: the migration and REST profile calls have not been tested against a configured Supabase project. No Supabase CLI or PostgreSQL client is installed in this environment.
- Phase 4 order migration, RPCs, API routes, student checkout/history/tracking calls, and API tests are authored. A real Supabase project is still required to apply the migration and verify transactional behavior and RLS end to end.
- Phase 5 staff queue, order transition controls, menu management endpoints, frontend dashboard, and RLS-limited write grant migration are authored. Live role/RLS verification still requires Supabase.
- Phase 6 admin dashboard, account controls, category/settings maintenance, date reports and SQL reporting functions are authored. A first-admin SQL bootstrap is documented.
- Phase 7 Razorpay order/payment verification API, frontend Checkout handoff, signed webhook endpoint and payment SQL RPCs are authored. No live gateway credentials or Supabase project are configured here; no real payment was processed.
- Phase 8 student order list/tracking use Supabase Realtime with RLS plus refresh fallback. Live subscription behavior needs the configured project and Realtime publication.
- Phase 9 Capacitor v8 Android project was generated and app back-button behavior is wired. Android SDK/JDK/emulator are not present in this environment, so APK/device verification remains.
- Phase 10 GitHub Actions, Vercel and Render configuration plus deployment instructions are authored. No external deployment has been created.

## Manual verification checklist

- [ ] Desktop browser: menu load/search/category filtering/cart interactions.
- [ ] Mobile browser: responsive layout, menu cards and cart drawer.
- [ ] Android emulator/device: navigation, back behavior and production build.
- [ ] Concurrent orders: no overselling or duplicate payment/order records.
- [ ] Network interruption: recover subscriptions and refresh authoritative order state.
- [ ] Payment: success, failure, abandoned checkout, delayed and repeated webhook callbacks.
- [ ] Supabase: apply all migrations in order, bootstrap first admin, and verify RLS and audit logs with separate student/staff/admin accounts.
- [ ] Razorpay: use test credentials and exercise successful capture, failed payment, invalid signature, webhook replay and late capture/refund review.
- [ ] Android: build and open the app on an emulator/device; verify sign-in redirect URLs, network connectivity, refresh and back navigation.
- [ ] Production: deploy frontend/API, set exact CORS origins and HTTPS webhook URL, then confirm health route and secret isolation.

## Phase 1 result

- Frontend: `npm run build` passed; Vite dev server started at http://127.0.0.1:5173.
- Backend: Uvicorn started successfully; in-process ASGI route test passed for /health and /api/menu (1 test).
- The sandbox denied loopback HTTP requests between separate processes; route behavior was verified with httpx.ASGITransport instead.




- Static SQL grammar parsing passed for the migration (63 statements) and seed (2 statements); this is not a substitute for applying and validating them in PostgreSQL/Supabase.

- Current local checks: frontend production build and Capacitor project generation succeeded. Backend source compilation/OpenAPI generation can be run locally. This Windows bundled runtime has previously hung when executing the full async unittest suite; the GitHub Actions Linux runner is configured to execute it. No live database, payment or Android device verification is claimed.
