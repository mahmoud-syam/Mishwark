#!/usr/bin/env node
/**
 * Mishwark Backend API documentation generator.
 *
 * Derives the API surface DIRECTLY from the source of truth (the Express
 * route definitions + Zod request schemas) so the output never drifts from
 * the actual implementation. Regenerating after any route change is safe.
 *
 * Outputs:
 *   api-docs/mishwarak.postman_collection.json  (Postman Collection v2.1)
 *   api-docs/mishwarak.openapi.json             (OpenAPI 3.0)
 *
 * Run:  node build-api-docs.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const ROUTES_DIR = path.join(ROOT, "src", "v1", "routes");
const SCHEMAS_DIR = path.join(ROOT, "src", "v1", "schemas");
const OUT_DIR = path.join(ROOT, "api-docs");

const AUTH_HEADER = { key: "Authorization", value: "Bearer {{token}}", type: "text" };

// ---------------------------------------------------------------
// 1. Discover & parse every route file
// ---------------------------------------------------------------
function readRouteFiles() {
  const files = fs
    .readdirSync(ROUTES_DIR)
    .filter((f) => /\.(route|routes)\.ts$/.test(f));
  // order by the namespace used at mount time in src/v1/routes/index.ts
  const MOUNT_ORDER = ["auth", "vehicles", "booking", "driver", "review", "payment", "waitlist", "package", "chat", "referral", "wallet", "notification", "admin", "places", "pricing"];
  files.sort((a, b) => {
    const ma = MOUNT_ORDER.indexOf(a.replace(/\.(route|routes)\.ts$/, ""));
    const mb = MOUNT_ORDER.indexOf(b.replace(/\.(route|routes)\.ts$/, ""));
    return (ma === -1 ? 99 : ma) - (mb === -1 ? 99 : mb);
  });
  const groups = [];
  for (const file of files) {
    const mount = file.replace(/\.(route|routes)\.ts$/, "").replace("routes", "");
    const content = fs.readFileSync(path.join(ROUTES_DIR, file), "utf8");
    const endpoints = [];
    // match: router.get("/path", [mw], errorHandler(handler))
    const re = /[A-Za-z]+RouterV?\d*\.(get|post|put|patch|delete)\(\s*"([^"?]+)"([\s\S]*?)\);/g;
    let m;
    while ((m = re.exec(content)) !== null) {
      const method = m[1].toUpperCase();
      let p = m[2].trim();
      // strip optional trailing middleware that includes authMiddleware
      const full = m[3];
      const authRequired = /authMiddleware/.test(full);
      // normalize Express ':param' to '{param}' curly style and collapse a
      // bare "/" path to "" so it joins cleanly onto the module mount
      let normalized = p
        .replace(/:[A-Za-z0-9_]+/g, (s) => `{${s.slice(1)}}`)
        .replace(/\/+$/, "");
      if (normalized === "/") normalized = "";
      endpoints.push({ method, path: normalized, auth: authRequired });
    }
    if (endpoints.length) {
      const base = file.replace(/\.(route|routes)\.ts$/, "");
      groups.push({ name: base, mount: MOUNTS[base] || "", file, endpoints });
    }
  }
  return groups;
}

// ---------------------------------------------------------------
// 2. Admin router is guarded by adminMiddleware at mount time (index.ts),
//    so mark every /admin endpoint as requiring an admin role.
// ---------------------------------------------------------------
const ADMIN_ROUTES = new Set(["admin"]);

// mount namespace per route-file base, matching src/v1/routes/index.ts
const MOUNTS = {
  auth: "/auth",
  vehicles: "/vehicles",
  booking: "/bookings",
  driver: "/driver",
  review: "/reviews",
  payment: "/payments",
  waitlist: "/waitlist",
  package: "/packages",
  chat: "/chat",
  referral: "/referrals",
  wallet: "/wallet",
  notification: "/notifications",
  admin: "/admin",
  places: "/places",
  pricing: "/pricing",
};

// ---------------------------------------------------------------
// 3. Manual request-body + query schema map, sourced from src/v1/schemas
//    (kept in sync with the Zod schemas above).
// ---------------------------------------------------------------
const BODY_EXAMPLES = {
  // auth
  "/auth/signup": {
    name: "Ahmed Ali",
    email: "ali@mishwarak.com",
    pic: "",
    password: "secret123",
    phoneNumbers: [{ number: "+201011111111" }],
    // Account type flag. "customer" (default) or "driver".
    // Admin roles can never be self-assigned at signup.
    role: "driver",
    // Required only when role is "driver".
    licenseNumber: "LIC-998877",
    licenseExpiry: "2030-12-31",
    // Driver papers (optional here, can also be sent later to POST /driver/documents).
    nationalIdFront: "",
    nationalIdBack: "",
    licenseFront: "",
    licenseBack: "",
    criminalRecord: "",
    // Optional referral code captured during signup.
    referralCode: "",
    // Legacy employee fields, still accepted for backwards compatibility.
    code: "EMP001",
    position: "Driver",
    birth_date: "1995-05-01",
    joining_date: "2024-01-01",
    medical_insurance: true,
  },
  "/auth/login": { email: "admin@mishwarak.com", password: "secret123" },
  "/auth/otp/request": { phoneNumber: "+201011111111", role: "customer", name: "Ahmed Ali" },
  "/auth/otp/verify": { phoneNumber: "+201011111111", code: "0000" },
  "/auth/verify-2fa": { loginToken: "{{loginToken}}", token: "123456" },
  "/auth/verify-2fa-setup": { loginToken: "{{loginToken}}", token: "123456" },
  "/auth/set-password": { loginToken: "{{loginToken}}", newPassword: "MyOwnPass#2026" },
  // The controller reads `secret` from the body, not `otpCode`.
  "/auth/2fa/verify": { token: "123456", secret: "JBSWY3DPEHPK3PXP" },
  // The current code is required while 2FA is on.
  "/auth/2fa/disable": { token: "123456" },

  // bookings
  "/bookings/estimate-distance": {
    startPoint: { latitude: 30.0444, longitude: 31.2357 },
    endPoint: { latitude: 31.2001, longitude: 29.9187 },
  },
  "/bookings/estimate-price": {
    vehicleCategory: "VAN",
    startPoint: { latitude: 30.0444, longitude: 31.2357 },
    endPoint: { latitude: 31.2001, longitude: 29.9187 },
    distanceKm: 25,
    durationMinutes: 120,
    isPeakHour: false,
    surgeMultiplier: 1.0,
    packageDiscount: 10,
    referralDiscount: 5,
    vehicleId: "{{vehicleId}}",
    packageId: "",
    referralCode: "",
  },
  "POST /bookings": {
    customerId: "",
    vehicleId: "{{vehicleId}}",
    driverId: "",
    bookingDate: "2026-09-15",
    startTime: "10:00",
    endTime: "12:00",
    startPoint: { latitude: 30.0444, longitude: 31.2357 },
    endPoint: { latitude: 31.2001, longitude: 29.9187 },
    distanceKm: 30,
    durationMinutes: 120,
    notes: "Airport pickup",
    driverNotes: "",
    packageId: "",
    eventType: "wedding",
    isPeakHour: false,
    surgeMultiplier: 1.0,
  },
  "/bookings/{id}/status": { status: "CONFIRMED" },
  "/bookings/{id}/trip-status": { tripStatus: "INPROGRESS" },
  "/bookings/{id}": { reason: "Change of plans" },

  // driver
  "/driver/profile": { fullName: "Ahmed Driver", licenseNumber: "DL123456", licenseExpiry: "2030-12-31", pic: "" },
  "/driver/status": { status: "ACTIVE" },
  "/driver/vehicles": { vehicleId: "{{vehicleId}}", isPrimary: true },

  // reviews
  "/reviews": {
    bookingId: "{{bookingId}}",
    reviewerType: "CUSTOMER_TO_DRIVER",
    revieweeId: "{{driverUserId}}",
    overallRating: 5,
    vehicleRating: 5,
    punctualityRating: 4,
    comment: "Excellent trip!",
  },

  // payments
  "/payments": { bookingId: "{{bookingId}}", amount: 100, paymentMethod: "CASH" },
  "/payments/{id}/status": { status: "SUCCESS", transactionRef: "ref-12345" },

  // waitlist
  "/waitlist": { vehicleId: "{{vehicleId}}", requestedDate: "2026-09-15", requestedTime: "10:00" },

  // packages
  "/packages": { packageName: "Wedding Package", packageType: "MULTI_CAR" },
  "/packages/{id}/booking": { packageId: "{{packageId}}" },

  // chat
  "/chat/{conversationId}/messages": { content: "Hello", messageType: "TEXT" },

  // referrals
  "/referrals/apply": { referralCode: "MRK123" },

  // wallet
  "/wallet/credit": { amount: 25, type: "REFERRAL_REWARD", description: "Referral reward" },
  "/wallet/debit": { amount: 10, type: "PAYMENT_DEDUCTION", description: "Trip payment" },

  // admin
  "/admin/drivers/{id}/status": { status: "OFF" },
  "/admin/users/role": { userId: "{{userId}}", roleId: "{{roleId}}" },
  "/admin/settings": { depositRate: 25, bookingBufferMinutes: 45, categoryRates: { CAR: { basePrice: 60, pricePerKm: 10, pricePerHour: 25 } } },
  "/admin/drivers/{id}/commission": { commissionRate: 20 },
  "/admin/packages/{id}/discount": { discountPercentage: 10 },
  "/admin/customers": { name: "Hind Abdelrahman", phoneNumber: "+201012345678" },
  "/admin/bookings": {
    customerId: "{{userId}}",
    vehicleId: "{{vehicleId}}",
    bookingDate: "2026-12-20",
    startTime: "19:00",
    endTime: "22:00",
    startPoint: { latitude: 30.0566, longitude: 31.3301, label: "Wedding hall, Nasr City" },
    endPoint: { latitude: 30.0911, longitude: 31.3253, label: "Fairmont, Cairo" },
    eventType: "Wedding",
    markPaid: false,
  },
  // fleet page (needs vehicle:manage)
  "POST /admin/vehicles": {
    make: "Mercedes", model: "S-Class", year: 2024, plateNumber: "أ ب ج 123", color: "Black", capacity: 4, category: "LUXURY",
    basePrice: 0, pricePerKm: 0, pricePerHour: 0, luggage: 3, features: ["تكييف", "واي فاي"], description: "Luxury car for weddings",
  },
  "/admin/vehicles/{id}": { basePrice: 1800, luggage: 3, features: ["تكييف", "مقاعد جلد"] },
  "/admin/vehicles/{id}/retire": { reason: "Sold" },
  "/admin/vehicles/{id}/reactivate": {},
  "POST /admin/destinations": { name: "مطار القاهرة الدولي", latitude: 30.1219, longitude: 31.4056, includedKm: null, prices: { LUXURY: 2200, VAN: 1700 } },
  "PATCH /admin/destinations/{id}": { prices: { CLASSIC: 2600 }, includedKm: 200 },
  "/admin/vehicles/{id}/drivers": { driverIds: ["{{driverId}}"], primaryDriverId: "{{driverId}}" },
  "/admin/vehicles/{id}/images": { images: "" },
  "/auth/me/photo": { photo: "" },
  "/auth/me/password": { currentPassword: "secret123", newPassword: "a-new-password" },
  "POST /driver/documents": { type: "NATIONAL_ID_FRONT", file: "" },
  "/admin/reviews/{id}": { handled: true, note: "كلمنا العميل واعتذرنا، ونبّهنا على السواق" },
  "/admin/driver-documents/{id}": { status: "REJECTED", note: "الصورة مش واضحة" },
  "/admin/vehicles/{id}/images/{imageId}/cover": {},
  "/admin/vehicles/{id}/maintenance": { maintenanceType: "صيانة دورية", startDate: "2026-12-01", endDate: "2026-12-02", cost: 1500, notes: "" },
  "/admin/maintenance/{id}/complete": { cost: 1450, notes: "Done" },

  // change password: admin-permissioned, no oldPassword, optionally resets 2FA
  "/auth/change-password/{userId}": { newPassword: "NewPass#2026", reset2FA: false },
  // Team page (Super Admin only)
  "POST /admin/team": { name: "Sara Ahmed", email: "sara@company.com", role: "ADMIN" },
  "/admin/team/{id}/reset-2fa": {},
  "/admin/team/{id}/reset-password": {},
  "/admin/team/{id}/role": { role: "SUPER_ADMIN" },
  "/admin/team/{id}/disable": {},
  "/admin/team/{id}/enable": {},
  "/auth/reset-2fa/{userId}": {},
};

const QUERY_EXAMPLES = {
  "/places/search": [{ key: "q", value: "قاعة الماسة" }, { key: "lat", value: "30.0444" }, { key: "lng", value: "31.2357" }],
  "/places/reverse": [{ key: "lat", value: "30.0749" }, { key: "lng", value: "31.3462" }],
  "/admin/bookings/search": [{ key: "q", value: "" }, { key: "status", value: "" }, { key: "paymentStatus", value: "" }, { key: "scope", value: "upcoming" }, { key: "page", value: "1" }, { key: "limit", value: "25" }],
  "/vehicles": [{ key: "category", value: "VAN" }, { key: "status", value: "AVAILABLE" }],
  "/vehicles/{id}/availability": [{ key: "month", value: "2026-09" }],
  "/bookings/estimate-price": [],
  "GET /bookings": [{ key: "page", value: "1" }, { key: "limit", value: "10" }, { key: "status", value: "" }],
  "/driver/bookings": [{ key: "filter", value: "today" }, { key: "page", value: "1" }, { key: "limit", value: "10" }],
  "/driver/stats": [{ key: "startDate", value: "2026-01-01" }, { key: "endDate", value: "2026-09-30" }],
  "/reviews/me": [{ key: "page", value: "1" }, { key: "limit", value: "10" }],
  "/wallet/transactions": [{ key: "page", value: "1" }, { key: "limit", value: "20" }, { key: "type", value: "" }],
  "/notifications": [{ key: "page", value: "1" }, { key: "limit", value: "20" }, { key: "status", value: "" }],
  "/admin/stats/summary": [{ key: "startDate", value: "" }, { key: "endDate", value: "" }],
  "/admin/bookings/calendar": [{ key: "month", value: "2026-09" }],
  "/admin/bookings": [{ key: "date", value: "2026-09-15" }, { key: "page", value: "1" }, { key: "limit", value: "10" }],
  "/admin/drivers": [{ key: "status", value: "" }],
  "/admin/users": [{ key: "role", value: "" }],
};

const BODY_ENDPOINTS = new Set(
  Object.keys(BODY_EXAMPLES).filter((p) => BODY_EXAMPLES[p] && Object.keys(BODY_EXAMPLES[p]).length)
);

// Endpoints that return a usable identifier. Running them fills the matching
// environment variable, so the follow-up requests (which reference
// {{bookingId}} and friends) work without hand-copying ids.
const ID_CAPTURE = {
  "GET /vehicles": { var: "vehicleId", expr: "const list = (json.data && json.data.items) || json.data || []; return Array.isArray(list) ? (list[0] && (list[0].vehicleId || list[0].id)) : null;" },
  "POST /bookings": { var: "bookingId", expr: "return json.data && json.data.id;" },
  "POST /payments": { var: "paymentId", expr: "return json.data && json.data.id;" },
  "POST /reviews": { var: "reviewId", expr: "return json.data && json.data.id;" },
  "POST /waitlist": { var: "waitlistId", expr: "return json.data && json.data.id;" },
  "POST /packages": { var: "packageId", expr: "return json.data && (json.data.id || json.data.packageId);" },
  "POST /referrals/generate-code": { var: "referralCode", expr: "return (json.data && json.data.code) || json.referralCode;" },
};

// ---------------------------------------------------------------
// 4. Descriptions + success responses per endpoint
// ---------------------------------------------------------------
const DESCRIPTIONS = {
  "/auth/login": "Email/password sign-in, step 1. Limits: 5 wrong passwords for one account from one device (IP) block that device from that account for 15 minutes (429, `errors.retryAfterSeconds`); the owner on another device is unaffected. 403 for a disabled account. Never returns a session: it answers with the next step and a `loginToken` (signed, 5 minutes): `passwordChangeRequired` (temporary password: call /auth/set-password), `twoFactorSetupRequired` (with `secret` + `qrCodeDataURL`: call /auth/verify-2fa-setup) or `twoFactorRequired` (call /auth/verify-2fa). 400 on a wrong email or password.",
  "/auth/set-password": "Sign-in step after a temporary password (accounts created or reset from the Team page): the user picks their own password (8+ characters, not the temporary one). Answers with the next step and a new `loginToken`. 400 if the pass is missing, expired or already used.",
  "/auth/signup": "A driver can attach the papers here as file fields nationalIdFront, nationalIdBack, licenseFront, licenseBack, criminalRecord: they are stored privately and the response lists them in `documents` (PENDING, or FAILED with the reason; a bad file never undoes the signup). Other file fields are dropped. Create a customer or driver account. Multipart/form-data — fields may arrive as JSON strings or files. The `role` flag defaults to 'customer'; admin roles cannot be self-assigned.",
  "/auth/otp/request": "Public. Sends a 4-digit OTP to the phone; only phoneNumber is required (a new customer can give the name later with PATCH /auth/me). 403 for dashboard accounts. 01…, +20… and 0020… are the same number (stored as +20…). In dev the code is returned as dev_otp.",
  "/auth/otp/verify": "Public. Verifies the OTP and returns a JWT valid for APP_SESSION_DAYS (default 30) plus `profileComplete`. Dashboard accounts get 403 (they sign in with email, password and 2FA). Dev bypass code: 0000. Response drives role-based home screen.",
  "/auth/logout": "Signs out: clears the auth cookie and revokes the token sent with the request (it gets 401 afterwards). Always 200.",
  "/auth/logout-all-devices": "Bumps tokenVersion, invalidating every session for the user.",
  "/auth/verify-2fa": "Last sign-in step when 2FA is on: `loginToken` from /auth/login plus the 6-digit code. Sets the session cookie and returns `user`. Each pass works once; a wrong code changes nothing. A bare `userId` is no longer accepted (400).",
  "/auth/verify-2fa-setup": "Last sign-in step when 2FA isn't set up yet: `loginToken` plus the code from the authenticator app. The secret is the one inside the pass (the one shown in the QR); any `secret` in the body is ignored. Sets the session cookie and returns `user`. A bare `userId` is no longer accepted (400).",
  "/auth/2fa/setup": "Returns TOTP secret + QR code data URL for authenticator enrollment.",
  "/auth/2fa/verify": "Validates an OTP to enable 2FA.",
  "/auth/2fa/disable": "Disables 2FA for the authenticated user. Needs the current 6-digit code in `token` (400 without it).",
  "/auth/change-password/{userId}": "Needs user_password:manage. Sets a user's password (8+ characters) and optionally resets 2FA; signs the user out everywhere. Dashboard accounts (Admin, Super Admin) only by a Super Admin (403); use the Team page for them.",
  "/auth/reset-2fa/{userId}": "Needs user_password:manage. Resets a user's 2FA and signs them out everywhere. Dashboard accounts (Admin, Super Admin) only by a Super Admin (403).",
  "GET /admin/team": "Team page (Super Admin only, 403 otherwise): dashboard accounts (Admin and Super Admin) with role, `twoFactorEnabled`, `mustChangePassword` (hasn't replaced the temporary password yet) and `lastLoginAt`. Super Admins first.",
  "POST /admin/team": "The temporary password works for Settings `tempPasswordDays` (default 7; `member.tempPasswordExpiresAt`); after that sign-in gets 403 \"This temporary password has expired\". Creates a dashboard account (Super Admin only). Returns `member` and a `temporaryPassword`, shown this once (only its hash is stored). At first sign-in the member picks their own password, then sets up 2FA. 409 if the email is taken. Audit-logged.",
  "/admin/team/{id}/reset-2fa": "Lost phone: the member sets up 2FA again at the next sign-in. Signs them out everywhere. Super Admin only; not on your own account (400) or on non-team accounts (404). Audit-logged.",
  "/admin/team/{id}/reset-password": "The temporary password works for Settings `tempPasswordDays` (default 7; `member.tempPasswordExpiresAt`); after that sign-in gets 403 \"This temporary password has expired\". Forgotten password: returns a new `temporaryPassword` (shown once); the old password stops working and the member picks a new one at sign-in. Signs them out everywhere. Super Admin only. Audit-logged.",
  "/admin/team/{id}/disable": "Disables a team account (someone left): signed out everywhere at once, can't sign in (403 \"This account is disabled\"), history and audit entries kept. Any account but your own, Super Admins included. Super Admin only. Audit-logged.",
  "/admin/team/{id}/enable": "Enables a disabled team account again; the member signs in as before (password + 2FA). Super Admin only. Audit-logged.",
  "/admin/team/{id}/role": "Changes a member's role (ADMIN or SUPER_ADMIN). Signs them out so the new permissions apply. Super Admin only; not on your own account. Audit-logged.",
  "/bookings/estimate-price": "PUBLIC. Server-side price. Send `serviceType` (WEDDING, TRIP, VIP) with `vehicleId`: WEDDING/VIP = the car's own fixed price (or the default) covering included hours and km, plus every started extra hour (send `startTime`/`endTime`) and every extra km; TRIP = from the company (Settings origin, unless startPoint is sent) to a listed `destinationId` (fixed price per car category) or to `endPoint` (the category's \"another place\" price), plus extra km beyond the included ones. The response adds `lines` (itemised: wedding|vip|trip|trip_other, extra_hours, extra_km, package_discount, referral_discount with quantity, unitPrice, included), `bookedMinutes`, `depositRate`, `destination`, the points used and `route` (source haversine = straight-line estimate). Without serviceType the older per-km price applies. 400 for a retired car or an inactive destination.",
  "/bookings/estimate-distance": "PUBLIC. Resolves startPoint/endPoint (coordinates or a place name) into distanceKm and durationMinutes. Coordinates are passed through; free text is geocoded via OpenRouteService. Without ORS_API_KEY the server falls back to a straight-line estimate and says so in `source` and `warning`.",
  "/bookings/{id}/status": "Transitions booking status. PENDING→CONFIRMED/CANCELLED, CONFIRMED→COMPLETED/CANCELLED.",
  "/bookings/{id}/trip-status": "NOTSTARTED→INPROGRESS→ARRIVED→COMPLETED. Trip COMPLETED auto-completes the booking and releases the driver.",
  "/bookings/{id}": "Cancels a booking (DELETE). Settles the money paid by the cancellation policy (Settings `freeCancellationHours`, default 48): cancelled that long before the start, everything paid goes back to the customer's wallet; later, the deposit is kept and anything above it goes back. An admin may send `refundDeposit: true|false` to decide either way (ignored from a customer). The booking gets `cancelledAt`, `depositOutcome` (REFUNDED, KEPT or null when nothing was paid) and `depositRefunded`; the response also has `cancellation` (paid, refund, kept). Releases availability & driver and promotes waitlist position #1. Cancelling twice changes nothing.",
  "/bookings/{id}/cancellation": "What cancelling now would do to the money paid: `paid`, `refund` (to the wallet), `kept`, `outcome`, `freeUntil` (last moment for a full refund) and `freeCancellationHours`. Show it before the customer confirms. The booking's customer or an admin (404 otherwise).",
  "/pricing": "PUBLIC. Every price and rule the apps need before booking: `origin` (where private trips start), `depositRate`, `wedding` and `vip` ({ defaultPrice, includedHours, includedKm, extraHourPrice, extraKmPrice }; a car's own price is `weddingPrice` / `vipPrice` on the vehicle), `trip` ({ includedKm, extraKmPrice, otherPrices per car category }) and the active `destinations` with their price per category. The final price always comes from POST /bookings/estimate-price.",
  "GET /admin/destinations": "Pricing page: every private-trip destination (inactive too) with the prices entered (`prices`), the prices each car category actually gets (`effectivePrices`: a missing category uses Settings.tripOtherPrices), `effectiveIncludedKm` and how many bookings use it.",
  "POST /admin/destinations": "Adds a private-trip destination (settings:manage). `prices` per car category; `includedKm` null = Settings.tripIncludedKm. Audit-logged.",
  "PATCH /admin/destinations/{id}": "Edits a destination (settings:manage). `prices` is merged per category (send only the ones that change). `active: false` hides it from booking. Audit-logged.",
  "DELETE /admin/destinations/{id}": "Deletes a destination nobody booked; one with bookings is switched off instead (`deactivated: true`) so history keeps it. settings:manage. Audit-logged.",
  "PUT /auth/me/photo": "Sets the signed-in user's own photo: multipart/form-data, field `photo` (JPG, PNG or WEBP, checked by content; 5 MB, 413 above). Replaces the previous photo and deletes its file. Returns the same shape as GET /auth/me, with `pic` (a path such as /uploads/employees/pic-<uuid>.jpg).",
  "DELETE /auth/me/photo": "Removes the signed-in user's own photo. Returns the same shape as GET /auth/me (`pic` is \"\").",
  "/auth/me/password": "A dashboard account (Admin, Super Admin) changes its own password: `{ currentPassword, newPassword }` (8+ characters, different from the current one). A wrong current password is a 400 and counts toward the sign-in lockout. Other sessions are signed out; the response sets a fresh session cookie so this one carries on. 403 for app accounts (they sign in with a phone code).",
  "GET /admin/reviews": "Reviews with who wrote them (`reviewer`), about whom (`reviewee`; `driverId` set when that person is a driver) and the trip (`booking.ref`, date, car). Query: `kind` complaints (default) or all; `state` open (default), handled or all (complaints only); `direction` CUSTOMER_TO_DRIVER or DRIVER_TO_CUSTOMER (with kind=all); `rating` 1-5; `driverId` (either side); `customerId` (either side); `q` (names, phone, MW- reference, comment); `page`, `limit`. A complaint is a customer's review of a driver at or below the `complaintMaxRating` setting. Also returns `counts` (openComplaints, handledComplaints, all, averageDriverRating) for the same driver/customer filter.",
  "GET /admin/reviews/{id}": "One review, same shape as the list.",
  "PATCH /admin/reviews/{id}": "Marks a complaint handled with what was done (`{ handled: true, note }`, note 3+ characters, 422 otherwise) or opens it again (`{ handled: false }`). 400 for a review that isn't a complaint. Open complaints feed the home alerts and `kpis.openComplaints`. Audit-logged.",
  "PUT /driver/profile": "The signed-in driver updates `fullName`, `licenseNumber`, `licenseExpiry` (YYYY-MM-DD); other fields are ignored (the photo is PUT /auth/me/photo). A new licence number or expiry sends both licence photos back to review: the reply's `documentsBackToReview` says how many.",
  "GET /driver/documents": "The signed-in driver's papers: every required type (NATIONAL_ID_FRONT, NATIONAL_ID_BACK, LICENSE_FRONT, LICENSE_BACK, CRIMINAL_RECORD) with `status` MISSING, PENDING, APPROVED or REJECTED (+ `reviewNote`, the reason to show), and `summary.state` (MISSING, PENDING, REJECTED, APPROVED). 403 for non-drivers.",
  "POST /driver/documents": "Uploads one paper as multipart/form-data: `type` + `file` (JPG, PNG, WEBP or PDF, checked by content; 10 MB, 413 above). Replaces an earlier one of that type and puts it back to review (PENDING). Stored privately, never at a public URL. 201 with the document.",
  "/driver/documents/{id}/file": "The driver's own paper (the dashboard team can open it too); 404 for anyone else. Sent inline with Cache-Control: private, no-store.",
  "/admin/drivers/{id}/documents": "A driver's papers with their review state (same shape as GET /driver/documents).",
  "/admin/driver-documents/{id}/file": "Opens a driver's paper (dashboard only).",
  "/admin/driver-documents/{id}": "Approves or rejects a paper: `{ status: APPROVED }` or `{ status: REJECTED, note }` (the reason is required and shown to the driver). Audit-logged.",
  "/places/search": "PUBLIC. Place search for the booking map, anywhere in Egypt (OpenStreetMap through Photon). `q` (2-120 characters); optional `lat`/`lng` rank nearby places first (send the map's centre). Returns up to 8 `{ name, detail, label, latitude, longitude, kind }`; send `{ latitude, longitude, label }` as startPoint/endPoint. 502 when the provider is down (let the user drop a pin instead). Cached for a day; limited per IP (PLACES_RATE_LIMIT, default 300 per 15 minutes).",
  "/places/reverse": "PUBLIC. The address at a pin (`lat`, `lng`, inside Egypt; 400 otherwise), from Nominatim with Photon as fallback, in Arabic. Same shape as a search result, with the pin's own coordinates. If both providers are down the label is the coordinates.",
  "/admin/bookings/search": "Dashboard bookings page. `q` matches a reference (MW-1A2B3C), the customer's name or phone (01…, +20… or 0020…). Filters: `status`, `paymentStatus`, `scope` (upcoming = today onwards, soonest first [default]; past = latest first; all), `from`/`to` (YYYY-MM-DD), `page`, `limit` (max 100). Returns `data` (same shape as a day's bookings, plus cancellation fields), `counts` per status for the same search, and `pagination`.",
  "/driver/{id}": "PUBLIC. Returns a driver's profile by id (rating included).",
  "/referrals/{id}/complete": "PUBLIC. Credits both referrer & referee wallets when the refereed user completes their first booking.",
  "/driver/bookings": "Driver's trips. filter=today|upcoming|completed.",
  "/reviews": "Blind rating: only visible to the other party after both submit OR 48h. Driver rating recalculated.",
  "/payments": "Creates a PENDING payment. paymentMethod: PAYMOB|FAWRY|CASH|WALLET.",
  "/payments/{id}/status": "Updates payment record and recomputes booking aggregate paymentStatus.",
  "/payments/summary/{bookingId}": "Returns totalPrice, totalPaid, remaining.",
  "/waitlist": "Joins the waitlist at the next open position; cancellation promotes position #1.",
  "/packages": "Creates a package for the authenticated customer. Its discount % is set by an admin afterwards (discountPercentage in the body is ignored). Bookings created with this packageId get that % off.",
  "/chat/booking/{id}": "Auto-creates the conversation for a booking on first call.",
  "/chat/{conversationId}/messages": "Sends a chat message. messageType: TEXT|QUICK_REPLY.",
  "/referrals/apply": "Applies someone's referral code to the authenticated customer. Only before their first booking (400 after). The customer then gets Settings.referredDiscountAmount off their first booking automatically, and the code owner is credited when that trip completes.",
  "/referrals/generate-code": "Generates/returns the user's referral code.",
  "/wallet/credit": "Credits the wallet. type: REFERRAL_REWARD|REFUND|MANUAL_ADJUSTMENT|PAYMENT_DEDUCTION|DEPOSIT.",
  "/admin/settings": "Business settings edited from the dashboard Settings page: deposit %, gap between trips, early trip start, new-driver commission, referral reward, peak surge, dashboard alert thresholds and default prices per vehicle category. GET for any admin; PUT needs settings:manage (Super Admin by default), sends only the fields to change, applies to new bookings only and is audit-logged. Out-of-range or unknown fields return 422.",
  "/admin/users/role": "Changes a user's role.",
  "/admin/bookings/calendar": "Bookings grouped by day for a month (YYYY-MM).",
  "/admin/bookings": "GET: bookings for a date (YYYY-MM-DD). POST: book on behalf of a customer (confirmed immediately; priceOverride is Super Admin only; markPaid records a manual payment).",
  "/admin/overview": "Web dashboard KPIs: today vs yesterday bookings, month revenue vs same span last month, fleet availability, 7-day occupancy and revenue, maintenance/complaint alerts.",
  "/admin/days/{date}": "Everything booked on one day (YYYY-MM-DD) with stats and per-driver assignments.",
  "/admin/trips/live": "Trips in progress with elapsed/remaining minutes and delay detection.",
  "/admin/drivers-summary": "Drivers ranked by this month's revenue, with rating, reviews and complaints (rating <= 2). ?limit=",
  "/admin/drivers-assignable": "Drivers that can be assigned to a new booking. With ?vehicleId= only that car's free drivers, main driver first (the only ones allowed to drive it).",
  "/admin/drivers/{id}/analytics": "Driver income vs company commission. ?period=day|month|year",
  "/admin/drivers/{id}/commission": "Sets the company commission percentage for a driver (0-100). Audit-logged.",
  "/admin/packages": "Customer packages for the dashboard, newest first, with customer, booking counts and the discount given so far. ?status=ACTIVE|COMPLETED|CANCELLED|EXPIRED&page=&limit=",
  "/admin/packages/{id}/discount": "Sets an active package's discount % (0-100). Needs booking:manage. Bookings in the package that nothing has been paid on yet (PENDING, depositPaid 0) are re-priced; paid ones keep their price. Returns the package plus `repriced` (count). Audit-logged.",
  "/admin/customers/search": "Customer search by name or phone. ?q=",
  "/admin/customers": "Quick-creates a customer account (name + phone). Audit-logged.",
  "/admin/customers/{id}/analytics": "Customer spend, bookings, wallet and referrals. ?period=day|month|year",
  "GET /admin/vehicles": "Fleet page list: every car with its derived status for today (AVAILABLE, BOOKED, MAINTENANCE, RETIRED), drivers (main first), cover photo, effective prices (0 = the category price from Settings), next maintenance and upcoming bookings, plus a summary (total, available, booked, maintenance, retired, withoutDriver). ?search=&category=&status=",
  "POST /admin/vehicles": "Adds a car. Needs vehicle:manage. Prices of 0 use the category price from Settings. Plate numbers are unique (409). Unknown fields such as `status` return 422: status is derived, never stored by hand. A new car has no driver, so it stays hidden from the app until drivers are assigned. Audit-logged.",
  "GET /admin/vehicles/{id}": "One car for the fleet page: details, category prices, photos (cover first), drivers, maintenance history with state (SCHEDULED, IN_PROGRESS, OVERDUE, DONE), the next 10 bookings and trip/revenue stats. 404 if not found.",
  "PATCH /admin/vehicles/{id}": "Edits a car's details, prices, luggage, features or description. Needs vehicle:manage. Send only the fields to change (an empty body or `status` returns 422). Audit-logged.",
  "/admin/vehicle-features": "Suggested feature labels for the fleet form (the defaults plus every feature already used on a car).",
  "/admin/vehicles/{id}/retire": "Takes a car out of service instead of deleting it: hidden from the app and from new bookings, history kept. Needs vehicle:manage. 409 with `errors.bookings` (the upcoming bookings) while any are pending or confirmed. Audit-logged.",
  "/admin/vehicles/{id}/reactivate": "Puts a retired car back in service. Needs vehicle:manage. Audit-logged.",
  "/admin/vehicles/{id}/drivers": "Sets the car's drivers (up to 10) and the main driver. Needs vehicle:manage. Only these drivers can drive the car: a booking without a driver tries the main driver first, then the others, skipping drivers off, on leave or busy. Drivers can no longer attach themselves to cars. An empty list hides the car from the app. Audit-logged. 409 with errors.bookings when a driver being removed still has upcoming trips on this car.",
  "/admin/vehicles/{id}/images": "Uploads car photos as multipart/form-data, field `images` (up to 8 per request, 12 per car). JPG, PNG or WEBP only, checked by the file's content; 5 MB each (413 over). The first photo becomes the cover. Needs vehicle:manage.",
  "/admin/vehicles/{id}/images/{imageId}": "Deletes a photo. If it was the cover, the next photo becomes the cover. Needs vehicle:manage.",
  "/admin/vehicles/{id}/images/{imageId}/cover": "Makes this photo the cover (shown first in the app). Needs vehicle:manage.",
  "/admin/vehicles/{id}/maintenance": "Schedules maintenance (startDate to endDate, at most 60 days, not in the past). Needs vehicle:manage. The days are blocked for bookings and the car shows as MAINTENANCE while it runs. 409 with `errors.bookings` if the car has pending or confirmed bookings on those days, or if another maintenance overlaps. Audit-logged.",
  "/admin/maintenance/{id}/complete": "Marks maintenance done (optionally with the final cost and notes) and frees its remaining days from today. Needs vehicle:manage. Audit-logged.",
  "DELETE /admin/maintenance/{id}": "Cancels maintenance that isn't done yet and frees its days. Needs vehicle:manage. Audit-logged.",
  "/admin/audit-logs": "Append-only audit trail. ?action=CREATE|UPDATE|DELETE&page=&limit=",
  "/admin/audit-logs/export": "Audit trail as an .xlsx download. ?action=",
  "GET /auth/me": "The signed-in user: id, name, email, phoneNumber, preferredLanguage, role (re-read from the database) and `profileComplete` (false while a customer who signed up with the phone number only has no name yet).",
  "PATCH /auth/me": "The signed-in user completes or edits their own details: `name` (2-80), `email` (or null to clear; 409 if taken), `preferredLanguage` (ar|en). The phone number can't change here (422 for unknown fields). Dashboard accounts can't change their email here (403). Returns the GET /auth/me shape.",
  "GET /vehicles": "Cars customers can book: in service and with at least one driver (retired or driverless cars are hidden). Each car has `luggage`, `features`, photos (cover first) and a status derived for today (AVAILABLE, BOOKED or MAINTENANCE). ?category=&status=",
  "GET /vehicles/{id}": "One bookable car with photos (cover first), features and luggage. 404 if it doesn't exist, is retired or has no driver.",
  "POST /driver/vehicles": "Retired: always 403. Cars are assigned to drivers by the administration (PUT /admin/vehicles/{id}/drivers).",
  "DELETE /driver/vehicles/{vehicleId}": "Retired: always 403. Cars are assigned to drivers by the administration (PUT /admin/vehicles/{id}/drivers).",
  "POST /bookings": "Creates a booking (PENDING). Send `serviceType` (WEDDING, TRIP, VIP) and, for a trip, `destinationId` (then startPoint/endPoint are optional: the trip starts at the company and ends at the destination). Priced exactly like POST /bookings/estimate-price; the booking keeps `serviceType`, `destinationId` and `priceLines`. An endTime earlier than startTime means the trip ends the next morning (e.g. 22:00 to 01:00); it must end by Settings `overnightLatestEndHour` (default 06:00; 400 otherwise, and 0 turns trips past midnight off). Also 400 for a trip shorter than `minTripMinutes` (default 30), more than `maxAdvanceBookingDays` ahead (default 365), or a start more than 15 minutes in the past today. Clashes with the car, the driver or maintenance are checked across midnight. Only the car's own drivers can drive it: a chosen driver must be one of them (400 \"This driver isn't assigned to this car\"); otherwise the main driver is tried first, then the others. 400 \"This car has no driver assigned yet\", 400 on a retired car or a maintenance day, 409 when the car is too close to another trip or none of its drivers is free.",
};

const SUCCESS_RESPONSES = {
  "/bookings/estimate-price": { success: true, data: { basePrice: 100, distancePrice: 30, timePrice: 20, surgeMultiplier: 1, discountAmount: 5, totalPrice: 145, depositPaid: 30 }, route: { distanceKm: 230, durationMinutes: 165, source: "openrouteservice", start: { latitude: 30.0444, longitude: 31.2357 }, end: { latitude: 31.2001, longitude: 29.9187 } }, comparison: { serverDistanceKm: 230, serverDurationMinutes: 165, claimedDistanceKm: null, claimedDurationMinutes: null, distanceDifferenceKm: null, withinTolerance: true } },
  "/bookings/estimate-distance": { success: true, data: { distanceKm: 230.4, durationMinutes: 168, source: "openrouteservice", start: { latitude: 30.0444, longitude: 31.2357 }, end: { latitude: 31.2001, longitude: 29.9187 } } },
  "POST /bookings": { success: true, data: { id: "{{bookingId}}", vehicleId: "{{vehicleId}}", status: "PENDING", tripStatus: "NOTSTARTED", totalPrice: 145 } },
  "/payments": { success: true, data: { id: "{{paymentId}}", bookingId: "{{bookingId}}", amount: 100, paymentMethod: "CASH", status: "PENDING" } },
  "/reviews": { success: true, data: { id: "{{reviewId}}", bookingId: "{{bookingId}}", overallRating: 5, visible: false } },
  "/waitlist": { success: true, data: { id: "{{waitlistId}}", position: 2, status: "WAITING" } },
  "/auth/otp/request": { message: "OTP sent successfully", dev_otp: "1234" },
  "/auth/otp/verify": { success: true, token: "{{token}}", user: { id: "{{userId}}", name: "John Customer", phoneNumber: "+201011111111", role: "Customer" } },
  "/auth/login": { message: "2FA required", twoFactorRequired: true, userId: "{{userId}}", loginToken: "eyJhbGciOi..." },
  "/auth/verify-2fa": { message: "Login successful", user: { id: "{{userId}}", email: "admin@mishwarak.com" } },
  "POST /admin/team": { success: true, data: { member: { id: "UUID", name: "Sara Ahmed", email: "sara@company.com", role: "ADMIN", twoFactorEnabled: false, mustChangePassword: true, lastLoginAt: null }, temporaryPassword: "Kp7m-Qx3a-Wd9e" } },
};

// ---------------------------------------------------------------
// 5. Common reusable OpenAPI request/response schemas
// ---------------------------------------------------------------
const REQUEST_SCHEMAS = {
  "/auth/signup": "SignupBody",
  "/auth/login": "LoginBody",
  "/auth/otp/request": "OtpRequest",
  "/auth/otp/verify": "OtpVerify",
  "/auth/verify-2fa": "Verify2faBody",
  "/auth/verify-2fa-setup": "Verify2faSetupBody",
  "/auth/set-password": "SetPasswordBody",
  "POST /admin/team": "TeamCreateBody",
  "/admin/team/{id}/role": "TeamRoleBody",
  "/auth/2fa/verify": "Verify2faEnableBody",
  "/auth/change-password/{userId}": "ChangePasswordBody",
  "/bookings/estimate-distance": "EstimateDistanceBody",
  "/bookings/estimate-price": "PriceEstimateBody",
  "POST /bookings": "CreateBookingBody",
  "/bookings/{id}/status": "UpdateBookingStatusBody",
  "/bookings/{id}/trip-status": "UpdateTripStatusBody",
  "/bookings/{id}": "CancelBookingBody",
  "/driver/profile": "UpdateDriverProfileBody",
  "/driver/status": "DriverStatusBody",
  "/driver/vehicles": "AssignVehicleBody",
  "/reviews": "CreateReviewBody",
  "/payments": "InitiatePaymentBody",
  "/payments/{id}/status": "UpdatePaymentStatusBody",
  "/waitlist": "JoinWaitlistBody",
  "/packages": "CreatePackageBody",
  "/packages/{id}/booking": "AddPackageBookingBody",
  "/chat/{conversationId}/messages": "SendMessageBody",
  "/referrals/apply": "ApplyReferralBody",
  "/wallet/credit": "WalletOperationBody",
  "/wallet/debit": "WalletOperationBody",
  "/admin/drivers/{id}/status": "DriverStatusBody",
  "/admin/users/role": "UpdateUserRoleBody",
  "/admin/settings": "SystemSettingsBody",
  "POST /admin/vehicles": "VehicleCreateBody",
  "PATCH /admin/vehicles/{id}": "VehicleUpdateBody",
  "/admin/vehicles/{id}/retire": "RetireVehicleBody",
  "/admin/vehicles/{id}/drivers": "VehicleDriversBody",
  "/admin/vehicles/{id}/images": "VehicleImagesBody",
  "/admin/vehicles/{id}/maintenance": "MaintenanceCreateBody",
  "/admin/maintenance/{id}/complete": "MaintenanceCompleteBody",
};

const VEHICLE_FIELDS = {
  make: { type: "string", maxLength: 60 }, model: { type: "string", maxLength: 60 }, year: { type: "integer", minimum: 1950, description: "Up to next year." },
  plateNumber: { type: "string", maxLength: 20, description: "Unique across the fleet (409 if taken)." }, color: { type: "string", maxLength: 30 },
  capacity: { type: "integer", minimum: 1, maximum: 60 }, category: { type: "string", enum: ["CAR", "VAN", "BUS", "TRUCK", "CLASSIC", "LUXURY"] },
  basePrice: { type: "number", minimum: 0, description: "0 = the category price from Settings." },
  pricePerKm: { type: "number", minimum: 0, description: "0 = the category price from Settings." },
  pricePerHour: { type: "number", minimum: 0, description: "0 = the category price from Settings." },
  luggage: { type: "integer", minimum: 0, maximum: 30 },
  features: { type: "array", maxItems: 20, items: { type: "string", maxLength: 30 }, description: "Shown in the app. Duplicates are removed." },
  description: { type: "string", maxLength: 1000 },
};
const openapiSchemas = {
  VehicleCreateBody: { type: "object", additionalProperties: false, properties: VEHICLE_FIELDS, required: ["make", "model", "year", "plateNumber", "capacity", "category"] },
  VehicleUpdateBody: { type: "object", additionalProperties: false, minProperties: 1, properties: VEHICLE_FIELDS, description: "Only the fields to change. `status` is not accepted: it is derived." },
  RetireVehicleBody: { type: "object", properties: { reason: { type: "string", maxLength: 200 } } },
  VehicleDriversBody: { type: "object", properties: { driverIds: { type: "array", maxItems: 10, items: { type: "string", format: "uuid" } }, primaryDriverId: { type: "string", format: "uuid", description: "Must be in driverIds; defaults to the first." } }, required: ["driverIds"] },
  VehicleImagesBody: { type: "object", properties: { images: { type: "array", maxItems: 8, items: { type: "string", format: "binary" }, description: "JPG, PNG or WEBP, 5 MB each." } }, required: ["images"] },
  MaintenanceCreateBody: { type: "object", properties: { maintenanceType: { type: "string", maxLength: 100 }, startDate: { type: "string", format: "date" }, endDate: { type: "string", format: "date", description: "Defaults to startDate; at most 60 days." }, cost: { type: "number", minimum: 0 }, notes: { type: "string", maxLength: 500 } }, required: ["maintenanceType", "startDate"] },
  MaintenanceCompleteBody: { type: "object", properties: { cost: { type: "number", minimum: 0 }, notes: { type: "string", maxLength: 500 } } },
  SignupBody: { type: "object", properties: { name: { type: "string" }, email: { type: "string", format: "email" }, password: { type: "string", minLength: 8 }, pic: { type: "string" }, role: { type: "string", enum: ["customer", "driver"], default: "customer", description: "Account type. Admin roles cannot be self-assigned." }, licenseNumber: { type: "string", description: "Required when role is 'driver'." }, licenseExpiry: { type: "string", description: "Required when role is 'driver'." }, nationalIdFront: { type: "string", format: "binary", description: "Driver paper (JPG, PNG, WEBP or PDF, 10 MB). Stored privately; result in `documents`." }, nationalIdBack: { type: "string", format: "binary", description: "Driver paper (JPG, PNG, WEBP or PDF, 10 MB). Stored privately; result in `documents`." }, licenseFront: { type: "string", format: "binary", description: "Driver paper (JPG, PNG, WEBP or PDF, 10 MB). Stored privately; result in `documents`." }, licenseBack: { type: "string", format: "binary", description: "Driver paper (JPG, PNG, WEBP or PDF, 10 MB). Stored privately; result in `documents`." }, criminalRecord: { type: "string", format: "binary", description: "Driver paper (JPG, PNG, WEBP or PDF, 10 MB). Stored privately; result in `documents`." }, referralCode: { type: "string" }, phoneNumbers: { type: "array", items: { type: "object", properties: { number: { type: "string" } } } } }, required: ["name", "email", "password", "phoneNumbers"] },
  LoginBody: { type: "object", properties: { email: { type: "string", format: "email" }, password: { type: "string", minLength: 6 } }, required: ["email", "password"] },
  OtpRequest: { type: "object", properties: { phoneNumber: { type: "string", minLength: 8 } }, required: ["phoneNumber"] },
  OtpVerify: { type: "object", properties: { phoneNumber: { type: "string" }, code: { type: "string", minLength: 4, maxLength: 4 } }, required: ["phoneNumber", "code"] },
  // The controller reads `userId`, `token` (the 6-digit TOTP) and `secret`.
  // POST /auth/verify-2fa: the challenge is answered with the TOTP code only.
  // The secret was already stored server-side when 2FA was enabled, so this
  // controller reads just `userId` and `token`.
  Verify2faBody: {
    type: "object",
    properties: { loginToken: { type: "string", description: "From POST /auth/login (twoFactorRequired)." }, token: { type: "string", description: "6-digit code" } },
    required: ["loginToken", "token"],
  },
  SetPasswordBody: {
    type: "object",
    properties: { loginToken: { type: "string", description: "From POST /auth/login (passwordChangeRequired)." }, newPassword: { type: "string", minLength: 8, maxLength: 100 } },
    required: ["loginToken", "newPassword"],
  },
  TeamCreateBody: {
    type: "object",
    additionalProperties: false,
    properties: { name: { type: "string", minLength: 2, maxLength: 80 }, email: { type: "string", format: "email" }, role: { type: "string", enum: ["ADMIN", "SUPER_ADMIN"] } },
    required: ["name", "email", "role"],
  },
  TeamRoleBody: { type: "object", properties: { role: { type: "string", enum: ["ADMIN", "SUPER_ADMIN"] } }, required: ["role"] },
  // POST /auth/verify-2fa-setup: first-time enrolment. `secret` is the value
  // POST /auth/login returned as `secret` (also shown in the QR code), and the
  // controller verifies the code against it before persisting it.
  Verify2faSetupBody: {
    type: "object",
    properties: { loginToken: { type: "string", description: "From POST /auth/login or /auth/set-password (twoFactorSetupRequired). It carries the secret." }, token: { type: "string", description: "6-digit code from the authenticator app" } },
    required: ["loginToken", "token"],
  },
  // Authenticated 2FA enrolment: `secret` comes from GET /auth/2fa/setup.
  Verify2faEnableBody: {
    type: "object",
    properties: { token: { type: "string" }, secret: { type: "string" } },
    required: ["token", "secret"],
  },
  // Admin-driven reset. There is no oldPassword: the caller holds
  // user_password:manage. Every call bumps tokenVersion, so the target user's
  // other sessions are signed out.
  ChangePasswordBody: {
    type: "object",
    properties: { newPassword: { type: "string", minLength: 8, maxLength: 100 }, reset2FA: { type: "boolean" } },
    required: ["newPassword"],
  },
  LocationInput: {
    description: "Either resolved coordinates, or free text the server geocodes.",
    oneOf: [
      { type: "object", properties: { latitude: { type: "number", minimum: -90, maximum: 90 }, longitude: { type: "number", minimum: -180, maximum: 180 } }, required: ["latitude", "longitude"] },
      { type: "object", properties: { lat: { type: "number", minimum: -90, maximum: 90 }, lng: { type: "number", minimum: -180, maximum: 180 } }, required: ["lat", "lng"] },
      { type: "string", example: "Maadi, Cairo" },
    ],
  },
  DistanceComparison: {
    type: "object",
    description: "What the client claimed next to what the server computed. Used for auditing only - the client's figures never affect the price.",
    properties: {
      serverDistanceKm: { type: "number" },
      serverDurationMinutes: { type: "number" },
      claimedDistanceKm: { type: "number", nullable: true },
      claimedDurationMinutes: { type: "number", nullable: true },
      distanceDifferenceKm: { type: "number", nullable: true },
      withinTolerance: { type: "boolean", description: "True when the claim is within 10% of the server figure." },
    },
  },
  RouteInfo: {
    type: "object",
    properties: {
      distanceKm: { type: "number" },
      durationMinutes: { type: "number" },
      source: { type: "string", enum: ["openrouteservice", "haversine"], description: "haversine means no ORS_API_KEY or the provider was unreachable - the figure is a straight-line estimate." },
      start: { type: "object", properties: { latitude: { type: "number" }, longitude: { type: "number" } } },
      end: { type: "object", properties: { latitude: { type: "number" }, longitude: { type: "number" } } },
      warning: { type: "string" },
    },
  },
  EstimateDistanceBody: { type: "object", properties: { startPoint: { $ref: "#/components/schemas/LocationInput" }, endPoint: { $ref: "#/components/schemas/LocationInput" } }, required: ["startPoint", "endPoint"] },
  PriceEstimateBody: { type: "object", properties: { vehicleCategory: { type: "string", enum: ["CAR", "VAN", "BUS", "TRUCK", "CLASSIC", "LUXURY"] }, startPoint: { $ref: "#/components/schemas/LocationInput" }, endPoint: { $ref: "#/components/schemas/LocationInput" }, distanceKm: { type: "number", description: "Optional hint. Recomputed server-side and never priced." }, durationMinutes: { type: "number", description: "Optional hint. Recomputed server-side and never priced." }, isPeakHour: { type: "boolean" }, surgeMultiplier: { type: "number", deprecated: true, description: "Ignored. The server applies the peak surge from Settings when isPeakHour is true." }, packageDiscount: { type: "number", deprecated: true, description: "Ignored. Computed from packageId." }, referralDiscount: { type: "number", deprecated: true, description: "Ignored. Computed from referralCode." }, vehicleId: { type: "string" }, packageId: { type: "string" }, referralCode: { type: "string", deprecated: true, description: "Ignored. Apply the code with POST /referrals/apply." }, customerId: { type: "string", description: "Admins only: quote with this customer's discounts." } } },
  CreateBookingBody: { type: "object", properties: { customerId: { type: "string" }, vehicleId: { type: "string" }, driverId: { type: "string" }, bookingDate: { type: "string", example: "2026-09-15" }, startTime: { type: "string", example: "10:00" }, endTime: { type: "string", example: "12:00" }, startPoint: { $ref: "#/components/schemas/LocationInput" }, endPoint: { $ref: "#/components/schemas/LocationInput" }, distanceKm: { type: "number", description: "Optional hint. Recomputed server-side and never priced." }, durationMinutes: { type: "number", description: "Optional hint. Recomputed server-side and never priced." }, notes: { type: "string" }, driverNotes: { type: "string" }, packageId: { type: "string" }, eventType: { type: "string" }, isPeakHour: { type: "boolean" }, surgeMultiplier: { type: "number", deprecated: true, description: "Ignored. The server applies the peak surge from Settings when isPeakHour is true." } }, required: ["vehicleId", "bookingDate", "startTime", "endTime", "startPoint", "endPoint"] },
  UpdateBookingStatusBody: { type: "object", properties: { status: { type: "string", enum: ["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED"] } }, required: ["status"] },
  UpdateTripStatusBody: { type: "object", properties: { tripStatus: { type: "string", enum: ["NOTSTARTED", "INPROGRESS", "ARRIVED", "COMPLETED"] } }, required: ["tripStatus"] },
  CancelBookingBody: { type: "object", properties: { reason: { type: "string" }, refundDeposit: { type: "boolean", description: "Admin only: refund everything paid (true) or keep the deposit (false), whatever the policy says" } } },
  UpdateDriverProfileBody: { type: "object", properties: { fullName: { type: "string" }, licenseNumber: { type: "string" }, licenseExpiry: { type: "string" }, pic: { type: "string" } } },
  DriverStatusBody: { type: "object", properties: { status: { type: "string", enum: ["ACTIVE", "OFF", "ONLEAVE"] } }, required: ["status"] },
  AssignVehicleBody: { type: "object", properties: { vehicleId: { type: "string" }, isPrimary: { type: "boolean" } }, required: ["vehicleId"] },
  CreateReviewBody: { type: "object", properties: { bookingId: { type: "string" }, reviewerType: { type: "string", enum: ["CUSTOMER_TO_DRIVER", "DRIVER_TO_CUSTOMER"] }, revieweeId: { type: "string" }, overallRating: { type: "integer", minimum: 1, maximum: 5 }, vehicleRating: { type: "integer", minimum: 1, maximum: 5 }, punctualityRating: { type: "integer", minimum: 1, maximum: 5 }, comment: { type: "string" } }, required: ["bookingId", "reviewerType", "revieweeId", "overallRating"] },
  InitiatePaymentBody: { type: "object", properties: { bookingId: { type: "string" }, amount: { type: "number", minimum: 1 }, paymentMethod: { type: "string", enum: ["PAYMOB", "FAWRY", "CASH", "WALLET"] } }, required: ["bookingId", "amount", "paymentMethod"] },
  UpdatePaymentStatusBody: { type: "object", properties: { status: { type: "string", enum: ["SUCCESS", "FAILED", "REFUNDED"] }, transactionRef: { type: "string" } }, required: ["status"] },
  JoinWaitlistBody: { type: "object", properties: { vehicleId: { type: "string" }, requestedDate: { type: "string", example: "2026-09-15" }, requestedTime: { type: "string", example: "10:00" } }, required: ["vehicleId", "requestedDate"] },
  CreatePackageBody: { type: "object", properties: { packageName: { type: "string" }, packageType: { type: "string", enum: ["MULTI_CAR", "MULTI_EVENT"] }, discountPercentage: { type: "number", deprecated: true, description: "Ignored. An admin sets the package discount." } }, required: ["packageName", "packageType"] },
  AddPackageBookingBody: { type: "object", properties: { packageId: { type: "string" } }, required: ["packageId"] },
  SendMessageBody: { type: "object", properties: { content: { type: "string", minLength: 1 }, messageType: { type: "string", enum: ["TEXT", "QUICK_REPLY"] } }, required: ["content"] },
  ApplyReferralBody: { type: "object", properties: { referralCode: { type: "string" } }, required: ["referralCode"] },
  CompleteReferralBody: { type: "object", properties: { bookingId: { type: "string" } }, required: ["bookingId"] },
  WalletOperationBody: { type: "object", properties: { amount: { type: "number", minimum: 1 }, type: { type: "string", enum: ["REFERRAL_REWARD", "REFUND", "MANUAL_ADJUSTMENT", "PAYMENT_DEDUCTION", "DEPOSIT"] }, description: { type: "string" } }, required: ["amount", "type"] },
  UpdateUserRoleBody: { type: "object", properties: { userId: { type: "string" }, roleId: { type: "string" } }, required: ["userId", "roleId"] },
  SystemSettingsBody: { type: "object", additionalProperties: false, properties: { depositRate: { type: "number", minimum: 0, maximum: 100, description: "Percent of the total price" }, bookingBufferMinutes: { type: "integer", minimum: 0, maximum: 720 }, tripEarlyStartMinutes: { type: "integer", minimum: 0, maximum: 1440 }, defaultCommissionRate: { type: "number", minimum: 0, maximum: 100 }, referralRewardAmount: { type: "number", minimum: 0 }, peakSurgeMultiplier: { type: "number", minimum: 1, maximum: 5 }, vipSpendThreshold: { type: "number", minimum: 0 }, delayAlertMinutes: { type: "integer", minimum: 1, maximum: 240 }, punctualityGraceMinutes: { type: "integer", minimum: 0, maximum: 240 }, complaintMaxRating: { type: "integer", minimum: 1, maximum: 4 }, maintenanceAlertDays: { type: "integer", minimum: 1, maximum: 90 }, categoryRates: { type: "object", description: "Only the categories to change", properties: { CAR: { type: "object", properties: { basePrice: { type: "number", minimum: 0 }, pricePerKm: { type: "number", minimum: 0 }, pricePerHour: { type: "number", minimum: 0 } } }, VAN: { type: "object", properties: { basePrice: { type: "number", minimum: 0 }, pricePerKm: { type: "number", minimum: 0 }, pricePerHour: { type: "number", minimum: 0 } } }, BUS: { type: "object", properties: { basePrice: { type: "number", minimum: 0 }, pricePerKm: { type: "number", minimum: 0 }, pricePerHour: { type: "number", minimum: 0 } } }, TRUCK: { type: "object", properties: { basePrice: { type: "number", minimum: 0 }, pricePerKm: { type: "number", minimum: 0 }, pricePerHour: { type: "number", minimum: 0 } } }, CLASSIC: { type: "object", properties: { basePrice: { type: "number", minimum: 0 }, pricePerKm: { type: "number", minimum: 0 }, pricePerHour: { type: "number", minimum: 0 } } }, LUXURY: { type: "object", properties: { basePrice: { type: "number", minimum: 0 }, pricePerKm: { type: "number", minimum: 0 }, pricePerHour: { type: "number", minimum: 0 } } } } }, performanceHistoryVisible: { type: "boolean" }, evaluationsVisible: { type: "boolean" }, selfAppraisalsVisible: { type: "boolean" }, maxAdvanceBookingDays: { type: "integer", minimum: 1, maximum: 1095 }, minTripMinutes: { type: "integer", minimum: 0, maximum: 720 }, overnightLatestEndHour: { type: "integer", minimum: 0, maximum: 12, description: "Latest hour a trip past midnight may end; 0 = no trips past midnight" }, freeCancellationHours: { type: "integer", minimum: 0, maximum: 720 }, tempPasswordDays: { type: "integer", minimum: 1, maximum: 90 } } },
  // ---------- response schemas ----------
  PriceEstimate: { type: "object", properties: { success: { type: "boolean" }, data: { type: "object", properties: { basePrice: { type: "number" }, distancePrice: { type: "number" }, timePrice: { type: "number" }, surgeMultiplier: { type: "number" }, discountAmount: { type: "number" }, packageDiscount: { type: "number" }, referralDiscount: { type: "number" }, totalPrice: { type: "number" }, depositRequired: { type: "number" }, depositPaid: { type: "number", deprecated: true } } }, route: { $ref: "#/components/schemas/RouteInfo" }, comparison: { $ref: "#/components/schemas/DistanceComparison" } } },
  EstimateDistanceResponse: { type: "object", properties: { success: { type: "boolean" }, data: { $ref: "#/components/schemas/RouteInfo" } } },
  Booking: { type: "object", properties: { success: { type: "boolean" }, data: { type: "object", properties: { id: { type: "string" }, vehicleId: { type: "string" }, customerId: { type: "string" }, driverId: { type: "string" }, bookingDate: { type: "string" }, startTime: { type: "string" }, endTime: { type: "string" }, distanceKm: { type: "number", description: "Server-computed road distance." }, durationMinutes: { type: "number", description: "Server-computed travel time." }, distanceSource: { type: "string", enum: ["openrouteservice", "haversine"], description: "haversine means a straight-line estimate, because ORS_API_KEY was missing or the provider was unreachable." }, startLat: { type: "number", nullable: true }, startLng: { type: "number", nullable: true }, endLat: { type: "number", nullable: true }, endLng: { type: "number", nullable: true }, claimedDistanceKm: { type: "number", nullable: true, description: "What the client declared, kept for auditing only." }, claimedDurationMinutes: { type: "number", nullable: true, description: "What the client declared, kept for auditing only." }, totalPrice: { type: "number" }, status: { type: "string", enum: ["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED"] }, tripStatus: { type: "string", enum: ["NOTSTARTED", "INPROGRESS", "ARRIVED", "COMPLETED"] } } } } },
  PagedBooking: { type: "object", properties: { success: { type: "boolean" }, data: { type: "array", items: { $ref: "#/components/schemas/Booking" } }, pagination: { type: "object", properties: { page: { type: "integer" }, limit: { type: "integer" }, total: { type: "integer" }, totalPages: { type: "integer" } } } } },
  Vehicle: { type: "object", properties: { message: { type: "string" }, data: { type: "array", items: { type: "object", properties: { id: { type: "string" }, make: { type: "string" }, model: { type: "string" }, category: { type: "string", enum: ["CAR", "VAN", "BUS", "TRUCK", "CLASSIC", "LUXURY"] }, status: { type: "string", enum: ["AVAILABLE", "BOOKED", "MAINTENANCE"] }, basePrice: { type: "number" }, pricePerKm: { type: "number" }, pricePerHour: { type: "number" } } } } } },
  Payment: { type: "object", properties: { success: { type: "boolean" }, data: { type: "object", properties: { id: { type: "string" }, bookingId: { type: "string" }, amount: { type: "number" }, paymentMethod: { type: "string", enum: ["PAYMOB", "FAWRY", "CASH", "WALLET"] }, status: { type: "string", enum: ["PENDING", "SUCCESS", "FAILED", "REFUNDED"] } } } } },
  Review: { type: "object", properties: { success: { type: "boolean" }, data: { type: "object", properties: { id: { type: "string" }, bookingId: { type: "string" }, overallRating: { type: "integer" }, vehicleRating: { type: "integer" }, punctualityRating: { type: "integer" }, comment: { type: "string" }, visible: { type: "boolean" } } } } },
  WaitlistEntry: { type: "object", properties: { success: { type: "boolean" }, data: { type: "object", properties: { id: { type: "string" }, vehicleId: { type: "string" }, requestedDate: { type: "string" }, requestedTime: { type: "string" }, position: { type: "integer" }, status: { type: "string", enum: ["WAITING", "NOTIFIED", "CONVERTED", "EXPIRED"] } } } } },
  Package: { type: "object", properties: { success: { type: "boolean" }, data: { type: "object", properties: { id: { type: "string" }, packageName: { type: "string" }, packageType: { type: "string", enum: ["MULTI_CAR", "MULTI_EVENT"] }, discountPercentage: { type: "number" }, totalPrice: { type: "number" }, status: { type: "string", enum: ["ACTIVE", "COMPLETED", "CANCELLED", "EXPIRED"] } } } } },
  Message: { type: "object", properties: { success: { type: "boolean" }, data: { type: "object", properties: { id: { type: "string" }, conversationId: { type: "string" }, content: { type: "string" }, messageType: { type: "string", enum: ["TEXT", "QUICK_REPLY"] }, senderType: { type: "string", enum: ["CUSTOMER", "DRIVER", "SYSTEM"] }, read: { type: "boolean" }, createdAt: { type: "string", format: "date-time" } } } } },
  DefaultSuccess: { type: "object", properties: { success: { type: "boolean" }, data: { type: "object" } } },
  PagedDefault: { type: "object", properties: { success: { type: "boolean" }, data: { type: "array", items: { type: "object" } }, pagination: { type: "object" } } },
};

// map request path format -> response schema ref
const RESPONSE_SCHEMA_BY_PATH = {
  "/bookings/estimate-distance": "EstimateDistanceResponse",
  "/bookings/estimate-price": "PriceEstimate",
  "/bookings": "Booking",
  "/bookings/{id}": "Booking",
  "/bookings/{id}/status": "Booking",
  "/bookings/{id}/trip-status": "Booking",
  "/payments": "Payment",
  "/payments/{id}": "Payment",
  "/payments/booking/{bookingId}": "Payment",
  "/payments/{id}/status": "Payment",
  "/payments/{id}/refund": "Payment",
  "/reviews": "Review",
  "/reviews/{id}": "Review",
  "/reviews/booking/{id}": "Review",
  "/waitlist": "WaitlistEntry",
  "/waitlist/{id}": "WaitlistEntry",
  "/waitlist/me": "WaitlistEntry",
  "/packages": "Package",
  "/packages/{id}": "Package",
  "/chat/{conversationId}/messages": "Message",
};

// ---------------------------------------------------------------
// 6. Helpers
// ---------------------------------------------------------------
function braceToColon(p) {
  return p.replace(/\{([^}]+)\}/g, ":$1");
}
function braceToCurly(p) {
  return p.replace(/\{([^}]+)\}/g, "{$1}");
}
// method-aware map lookup: try "METHOD /path" then bare "/path"
function lookup(map, method, fullPath) {
  if (!map) return undefined;
  const key = method + " " + fullPath;
  if (key in map) return map[key];
  return map[fullPath];
}

// ---------------------------------------------------------------
// 7. Build Postman collection
// ---------------------------------------------------------------
function buildPostman(groups) {
  const collection = {
    info: {
      _postman_id: "mishwarak-backend",
      name: "Mishwark Backend API",
      description:
        "Mishwark car-rental & chauffeur booking backend.\n\n" +
        "AUTH: POST /auth/otp/verify returns a JWT. Send it as `Authorization: Bearer <token>`.\n" +
        "Role routing: Customer, Driver, Super Admin.\n\n" +
        "SETUP: set baseUrl=http://localhost:5000, then run Verify OTP and copy the token into {token}.\n" +
        "Dev OTP bypass: code=\"0000\".\n\n" +
        "RESPONSE ENVELOPE: { success, data, pagination? }. Errors: { message, errorCode, errors }.",
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    variable: [
      { key: "baseUrl", value: "http://localhost:5000" },
      { key: "token", value: "" },
      { key: "vehicleId", value: "" },
      { key: "bookingId", value: "" },
      { key: "driverUserId", value: "" },
      { key: "driverId", value: "" },
      { key: "userId", value: "" },
      { key: "loginToken", value: "" },
      { key: "paymentId", value: "" },
      { key: "waitlistId", value: "" },
      { key: "packageId", value: "" },
      { key: "conversationId", value: "" },
      { key: "roleId", value: "" },
    ],
    item: [],
  };

  for (const group of groups) {
    const isAdmin = ADMIN_ROUTES.has(group.name);
    const folder = { name: mountLabel(group.name), item: [] };

    for (const ep of group.endpoints) {
      const fullPath = (group.mount + ep.path) || ep.path; // namespaced, uses {} braces
      const fullCurly = braceToCurly(fullPath);
      const body = lookup(BODY_EXAMPLES, ep.method, fullCurly);
      const hasBody = body && Object.keys(body).length > 0 && /POST|PUT|PATCH/.test(ep.method);
      const query = lookup(QUERY_EXAMPLES, ep.method, fullCurly) || [];
      const protectedRoute = ep.auth || isAdmin;

      const header = [];
      if (protectedRoute) header.push(Object.assign({}, AUTH_HEADER));

      const p = braceToColon(fullPath);
      const raw = "{{baseUrl}}/api/v1" + p;
      // Postman concatenates host + path, so {{baseUrl}} must appear only in
      // host - leaving it in the path segment list doubles it in the URL.
      const url = {
        raw,
        host: ["{{baseUrl}}"],
        path: ["api", "v1", ...p.split("/").filter(Boolean)],
      };
      if (query.length) url.query = query.map((q) => ({ key: q.key, value: q.value || "", disabled: !q.value }));

      const request = { method: ep.method, header, url };
      if (hasBody) {
        // Multipart routes are mounted behind multer server-side, so a raw JSON
        // body would be rejected with 400. Mirror the real wire format.
        if (MULTIPART_ROUTES.has(fullCurly)) {
          const fileFields = MULTIPART_FILE_FIELDS[fullCurly] || new Set();
          request.body = {
            mode: "formdata",
            formdata: Object.entries(body).map(([key, value]) => {
              if (fileFields.has(key)) return { key, type: "file", src: [] };
              if (value === null || value === undefined || value === "") return { key, value: "", type: "text" };
              if (typeof value === "object" && !Array.isArray(value)) return { key, value: JSON.stringify(value), type: "text" };
              if (Array.isArray(value)) return { key, value: JSON.stringify(value), type: "text" };
              return { key, value: String(value), type: "text" };
            }),
          };
        } else {
          request.body = { mode: "raw", raw: JSON.stringify(body, null, 2), options: { raw: { language: "json" } } };
        }
      }
      const desc = lookup(DESCRIPTIONS, ep.method, fullCurly);
      if (desc) request.description = desc;

      const events = [];
      if (protectedRoute) {
        events.push({
          listen: "prerequest",
          script: {
            type: "text/javascript",
            exec: [
              "if (!pm.environment.get('token')) {",
              "  console.warn('No token in environment. Run POST /auth/otp/verify (code 0000) first.');",
              "}",
            ],
          },
        });
      }
      const tokenSource = TOKEN_CAPTURE_ROUTES[fullCurly];
      if (tokenSource) {
        events.push({
          listen: "test",
          script: {
            type: "text/javascript",
            exec: [
              "let json = {};",
              "try { json = pm.response.json(); } catch (e) { /* non-JSON body */ }",
              tokenSource === "body"
                ? "const token = json.token;"
                : [
                      "// this endpoint returns the JWT only as a `token` cookie,",
                      "// so read it back out of the cookie jar.",
                      "const token = pm.cookies.get('token');",
                    ],
              "if (token) {",
              "  pm.environment.set('token', token);",
              "  console.log('token captured:', String(token).slice(0, 24) + '...');",
              "} else {",
              "  console.warn('No token returned. Check the response body/cookies.');",
              "}",
              "const role = json.role || (json.user && json.user.role && json.user.role.name);",
              "if (role) pm.environment.set('role', role);",
              "const uid = json.userId || (json.user && json.user.id);",
              "if (uid) pm.environment.set('userId', uid);",
            ],
          },
        });
      }
      if (LOGIN_STEP_ROUTES.has(fullCurly)) {
        events.push({
          listen: "test",
          script: {
            type: "text/javascript",
            exec: [
              "let json = {};",
              "try { json = pm.response.json(); } catch (e) { /* non-JSON body */ }",
              "// /auth/login is 2FA-gated and returns no token. It hands back the",
              "// userId needed by POST /auth/verify-2fa (or /verify-2fa-setup).",
              "// Each sign-in step needs the loginToken the previous step returned.",
              "if (json.loginToken) pm.environment.set('loginToken', json.loginToken);",
              "if (json.userId) {",
              "  pm.environment.set('userId', json.userId);",
              "  console.log('2FA required for userId:', json.userId);",
              "}",
              "if (json.twoFactorSetupRequired) console.log('Enable 2FA first: POST /auth/verify-2fa-setup');",
            ],
          },
        });
      }
      const idCapture = ID_CAPTURE[`${ep.method} ${fullCurly}`];
      if (idCapture) {
        events.push({
          listen: "test",
          script: {
            type: "text/javascript",
            exec: [
              "let json = {};",
              "try { json = pm.response.json(); } catch (e) { /* non-JSON body */ }",
              "if (pm.response.code >= 200 && pm.response.code < 300) {",
              `  const pick = (json) => { ${idCapture.expr} };`,
              "  const value = pick(json);",
              "  if (value) {",
              `    pm.environment.set('${idCapture.var}', String(value));`,
              `    console.log('${idCapture.var} =', value);`,
              "  }",
              "}",
            ],
          },
        });
      }
      const displayPath = braceToColon(fullPath);
      const name = `${ep.method} ${displayPath}`;
      const response = { name, request, response: [] };
      // Postman/Apidog read scripts from the item, as a sibling of `request` -
      // nesting them under `request` silently drops them on import.
      if (events.length) response.event = events;
      const successResp = lookup(SUCCESS_RESPONSES, ep.method, fullCurly);
      if (successResp) {
        response.response.push({
          name: "200 Success",
          originalRequest: { method: ep.method, header, url },
          status: "OK",
          code: 200,
          header: [{ key: "Content-Type", value: "application/json" }],
          body: JSON.stringify(successResp, null, 2),
        });
      }
      folder.item.push(response);
    }
    collection.item.push(folder);
  }
  return collection;
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
// proper display names per module
const MOUNT_LABELS = {
  auth: "Auth",
  vehicles: "Vehicles",
  booking: "Bookings",
  driver: "Drivers",
  review: "Reviews",
  payment: "Payments",
  waitlist: "Waitlist",
  package: "Packages",
  chat: "Chat",
  referral: "Referrals",
  wallet: "Wallet",
  notification: "Notifications",
  admin: "Admin",
};
function mountLabel(n) {
  return MOUNT_LABELS[n] || capitalize(n + "s");
}

// ---------------------------------------------------------------
// 8. Build OpenAPI 3.0
// ---------------------------------------------------------------
function buildOpenapi(groups) {
  const openapi = {
    openapi: "3.0.0",
    info: {
      title: "Mishwark Backend API",
      version: "1.0.0",
      description:
        "Mishwark car-rental & chauffeur booking backend.\n\n" +
        "Base URL: `http://localhost:5000/api/v1`\n\n" +
        "Authentication: JWT Bearer token from `POST /auth/otp/verify`. Protected endpoints require `Authorization: Bearer <token>`.\n\n" +
        "Dev OTP bypass code: `0000`.",
    },
    servers: [{ url: "http://localhost:5000/api/v1" }],
    tags: groups.map((g) => ({ name: mountLabel(g.name) })),
    paths: {},
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
      schemas: openapiSchemas,
    },
  };

  for (const group of groups) {
    const isAdmin = ADMIN_ROUTES.has(group.name);
    const tag = mountLabel(group.name);
    for (const ep of group.endpoints) {
      const fullCurly = braceToCurly((group.mount + ep.path) || ep.path);
      const protectedRoute = ep.auth || isAdmin;
      const key = fullCurly;
      if (!openapi.paths[key]) openapi.paths[key] = {};

      const parameters = [];
      const re = /\{([^}]+)\}/g;
      let m;
      while ((m = re.exec(key)) !== null) parameters.push({ name: m[1], in: "path", required: true, schema: { type: "string" } });
      const query = lookup(QUERY_EXAMPLES, ep.method, key) || [];
      query.forEach((q) => parameters.push({ name: q.key, in: "query", required: false, schema: { type: "string" } }));

      const op = {
        tags: [tag],
        summary: lookup(DESCRIPTIONS, ep.method, key) || `${ep.method} ${key}`,
        security: protectedRoute ? [{ bearerAuth: [] }] : [],
        parameters: parameters.length ? parameters : undefined,
        responses: {
          "200": { description: "Success", content: { "application/json": { schema: { $ref: `#/components/schemas/${lookup(RESPONSE_SCHEMA_BY_PATH, ep.method, key) || "DefaultSuccess"}` } } } },
          "201": { description: "Created" },
          "400": { description: "Bad Request" },
          "401": { description: "Unauthorized" },
          "403": { description: "Forbidden" },
          "404": { description: "Not Found" },
          "409": { description: "Conflict" },
          "500": { description: "Internal Server Error" },
        },
      };

      // request body
      const bodySchema = lookup(REQUEST_SCHEMAS, ep.method, key);
      const hasBody = (BODY_ENDPOINTS.has(key) || !!bodySchema) && /POST|PUT|PATCH/.test(ep.method);
      if (hasBody && bodySchema) {
        op.requestBody = {
          required: true,
          content: { "application/json": { schema: { $ref: `#/components/schemas/${bodySchema}` } } },
        };
      }

      const method = ep.method.toLowerCase();
      openapi.paths[key][method] = op;
    }
  }
  return openapi;
}

// ---------------------------------------------------------------
// 8b. Apidog-ready refinements
// ---------------------------------------------------------------

// How each endpoint hands back a JWT. Apidog honours Postman-style "test"
// scripts on import, so the token chains automatically.
//   /auth/otp/verify        -> `token` in the JSON body
//   /auth/verify-2fa       -> `token` COOKIE ONLY (login is 2FA-gated)
//   /auth/verify-2fa-setup -> `token` COOKIE ONLY
// POST /auth/login returns no token at all - only a 2FA-required payload.
const TOKEN_CAPTURE_ROUTES = {
  "/auth/otp/verify": "body",
  "/auth/verify-2fa": "cookie",
  "/auth/verify-2fa-setup": "cookie",
};

// /auth/login is a two-step, 2FA-gated flow and never returns a token itself.
// Remembering the userId it hands back is what makes step 2 followable.
const LOGIN_STEP_ROUTES = new Set(["/auth/login", "/auth/set-password"]);

// /auth/signup is the only route mounted behind multer, so it is the only one
// that must be described as multipart/form-data. Declaring it as JSON makes
// multer skip req.body entirely, so every field arrives undefined.
const MULTIPART_ROUTES = new Set(["/auth/me/photo", "/auth/signup", "/admin/vehicles/{id}/images", "POST /driver/documents", "/driver/documents"]);

// File fields must be sent as multipart `file` parts, not text.
const MULTIPART_FILE_FIELDS = { "/auth/me/photo": new Set(["photo"]), "/auth/signup": new Set(["pic", "nationalIdFront", "nationalIdBack", "licenseFront", "licenseBack", "criminalRecord"]), "/admin/vehicles/{id}/images": new Set(["images"]), "/driver/documents": new Set(["file"]) };

// Shown in the Apidog sidebar next to each folder.
const TAG_DESCRIPTIONS = {
  Auth: "Registration, login, 2FA and OTP. Signup accepts a `role` flag of 'customer' (default) or 'driver'.",
  Vehicles: "Cars customers can book (in service, with a driver). Public - no token required.",
  Booking: "Trip booking lifecycle: create, cancel, trip status, pricing.",
  Driver: "Driver profile, availability, earnings and assigned bookings.",
  Review: "Two-way reviews between customers and drivers.",
  Payment: "Payment records, refunds and receipts.",
  Waitlist: "Waitlist queue for fully booked vehicles.",
  Package: "Multi-day and multi-event packages.",
  Chat: "Customer/driver conversations and messages.",
  Referral: "Referral codes and rewards.",
  Wallet: "Balance and transactions. Credit/debit require the wallet:manage permission.",
  Notification: "Scheduled and sent notifications.",
  Admin: "Admin-only. Requires the ADMIN or SUPER_ADMIN role.",
};

const asAscii = (value) =>
  typeof value === "string"
    ? value.replace(/[\u2010-\u2015\u2018\u2019\u201c\u201d\u2013\u2014\u2212]/g, (c) => {
        const map = { "\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"', "\u2013": "-", "\u2014": "-", "\u2212": "-" };
        return map[c] ?? "-";
      })
    : value;

function applyApidogFixups(spec, groups) {
  spec.servers = [
    { url: "http://localhost:5000/api/v1", description: "Local dev server" },
  ];

  spec.info.description = asAscii(spec.info.description);

  spec.tags = spec.tags.map((t) => ({
    ...t,
    description: asAscii(TAG_DESCRIPTIONS[t.name] || t.name),
  }));

  for (const [key, methods] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      op.summary = asAscii(op.summary);
      op.description = op.description || op.summary;
      op.operationId = `${method}_${key.replace(/[{}]/g, "").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "")}`;

      // Public endpoints should declare an empty security array rather than
      // inheriting nothing, so Apidog does not prompt for a token on signup.
      if (op.security && op.security.length === 0) delete op.security;

      const isMultipart = MULTIPART_ROUTES.has(key);
      if (op.requestBody) {
        const jsonContent = op.requestBody.content["application/json"];
        const schemaRef = jsonContent?.schema?.$ref;
        const schemaName = schemaRef ? schemaRef.split("/").pop() : null;
        const props = (schemaName && spec.components.schemas[schemaName]?.properties) || {};
        // Lookup honours both "POST /bookings" and "/bookings" style keys; a
        // bare index would silently yield {} for method-scoped entries.
        const example = lookup(BODY_EXAMPLES, method.toUpperCase(), key) || {};

        if (isMultipart) {
          // A multipart body must declare each field individually; Apidog will
          // otherwise render a single opaque blob.
          const properties = {};
          for (const [prop, def] of Object.entries(props)) {
            properties[prop] = { ...def, ...(example[prop] !== undefined ? { example: example[prop] } : {}) };
          }
          op.requestBody = {
            required: true,
            content: {
              "multipart/form-data": {
                schema: { type: "object", properties },
                encoding: { pic: { contentType: "image/*" } },
              },
            },
          };
        } else {
          op.requestBody.content["application/json"].example = example;
        }
      }
    }
  }
  return spec;
}

// ---------------------------------------------------------------
// 9. Run
// ---------------------------------------------------------------
fs.mkdirSync(OUT_DIR, { recursive: true });
const groups = readRouteFiles();

const postman = buildPostman(groups);
const openapi = applyApidogFixups(buildOpenapi(groups), groups);

// Apidog imports Postman environments natively. `token` is populated by the
// capture script on POST /auth/otp/verify; the id variables are filled in by
// running the matching create/list request. `roleId` and `driverUserId` have no
// endpoint that returns them directly, so set them by hand when needed.
const environment = {
  id: "mishwarak-local-env",
  name: "Mishwark Local",
  values: [
    { key: "baseUrl", value: "http://localhost:5000", type: "default", enabled: true },
    { key: "token", value: "", type: "secret", enabled: true },
    { key: "role", value: "", type: "default", enabled: true },
    { key: "userId", value: "", type: "default", enabled: true },
    { key: "loginToken", value: "", type: "default", enabled: true },
    { key: "vehicleId", value: "", type: "default", enabled: true },
    { key: "bookingId", value: "", type: "default", enabled: true },
    { key: "paymentId", value: "", type: "default", enabled: true },
    { key: "reviewId", value: "", type: "default", enabled: true },
    { key: "waitlistId", value: "", type: "default", enabled: true },
    { key: "packageId", value: "", type: "default", enabled: true },
    { key: "referralCode", value: "", type: "default", enabled: true },
    { key: "driverUserId", value: "", type: "default", enabled: true },
    { key: "driverId", value: "", type: "default", enabled: true },
    { key: "roleId", value: "", type: "default", enabled: true },
  ],
  _postman_variable_scope: "environment",
  _postman_exported_using: "build-api-docs.js",
};

fs.writeFileSync(path.join(OUT_DIR, "mishwarak.postman_environment.json"), JSON.stringify(environment, null, 2));

const postmanPath = path.join(OUT_DIR, "mishwarak.postman_collection.json");
const openapiPath = path.join(OUT_DIR, "mishwarak.openapi.json");
const envPath = path.join(OUT_DIR, "mishwarak.postman_environment.json");
fs.writeFileSync(postmanPath, JSON.stringify(postman, null, 2));
fs.writeFileSync(openapiPath, JSON.stringify(openapi, null, 2));

const total = groups.reduce((n, g) => n + g.endpoints.length, 0);
console.log("Groups parsed from routes/:");
for (const g of groups) console.log(`  - ${g.file}: ${g.endpoints.length} endpoints`);
console.log(`\nTotal endpoints: ${total}`);
console.log("\nApidog import order:");
console.log("  1.", openapiPath, "(or the Postman collection)");
console.log("  2.", envPath, "(select it as the active environment)");
console.log("  3. run POST /auth/otp/verify to capture a token");
console.log("\nPostman collection:", postmanPath);
console.log("OpenAPI spec:     ", openapiPath);
console.log("Environment:      ", envPath);
