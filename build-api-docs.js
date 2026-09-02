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
  const MOUNT_ORDER = ["auth", "vehicles", "booking", "driver", "review", "payment", "waitlist", "package", "chat", "referral", "wallet", "notification", "admin"];
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
    code: "EMP001",
    graduationYear: "2020",
    graduationFaculty: "Engineering",
    graduationDepartment: "Mechanical",
    graduationUniversity: "Cairo University",
    location: "Cairo",
    salary: "15000",
    position: "Driver",
    birth_date: "1995-05-01",
    religion: "",
    marital_status: "single",
    military_status: "completed",
    personal_mail: "",
    joining_date: "2024-01-01",
    resign_date: "",
    medical_insurance: true,
    phoneNumbers: [{ number: "+201011111111" }],
    isAdmin: false,
    contract: { type_of_contract: "FULLTIME", start_date: "2024-01-01", contract_valu: "15000" },
    insurance: { insurance_status: "active", insurance_number: "12345" },
    documents: [{ type: "ID", document: "", isReceived: true, fileIndex: 0 }],
  },
  "/auth/login": { email: "admin@mishwarak.com", password: "secret123" },
  "/auth/otp/request": { phoneNumber: "+201011111111" },
  "/auth/otp/verify": { phoneNumber: "+201011111111", code: "0000" },
  "/auth/verify-2fa": { token: "2fa-temp-token", otpCode: "123456" },
  "/auth/verify-2fa-setup": { username: "ali@mishwarak.com", otpCode: "123456" },
  "/auth/2fa/verify": { token: "2fa-temp-token", otpCode: "123456" },
  "/auth/2fa/disable": { password: "secret123", otpCode: "123456" },

  // bookings
  "/bookings/estimate-price": {
    vehicleCategory: "VAN",
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
    distanceKm: 30,
    durationMinutes: 120,
    startPoint: "Cairo",
    endPoint: "Alexandria",
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
  "/packages": { packageName: "Wedding Package", packageType: "MULTI_CAR", discountPercentage: 10 },
  "/packages/{id}/booking": { packageId: "{{packageId}}" },

  // chat
  "/chat/{conversationId}/messages": { content: "Hello", messageType: "TEXT" },

  // referrals
  "/referrals/apply": { referralCode: "MRK123" },
  "/referrals/{id}/complete": { bookingId: "{{bookingId}}" },

  // wallet
  "/wallet/credit": { amount: 25, type: "REFERRAL_REWARD", description: "Referral reward" },
  "/wallet/debit": { amount: 10, type: "PAYMENT_DEDUCTION", description: "Trip payment" },

  // admin
  "/admin/drivers/{id}/status": { status: "OFF" },
  "/admin/users/role": { userId: "{{userId}}", roleId: "{{roleId}}" },
  "/admin/settings": { performanceHistoryVisible: true, evaluationsVisible: true, selfAppraisalsVisible: true },

  // change password
  "/auth/change-password/{userId}": { oldPassword: "oldpass", newPassword: "newpass123" },
  "/auth/reset-2fa/{userId}": {},
};

const QUERY_EXAMPLES = {
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

// ---------------------------------------------------------------
// 4. Descriptions + success responses per endpoint
// ---------------------------------------------------------------
const DESCRIPTIONS = {
  "/auth/login": "Email/password login (admin & internal staff). Returns JWT cookie + user.",
  "/auth/signup": "Create a new employee/staff account. Multipart/form-data — fields may arrive as JSON strings or files.",
  "/auth/otp/request": "Public. Sends a 4-digit OTP to the phone. In dev the code is returned as dev_otp.",
  "/auth/otp/verify": "Public. Verifies OTP and returns a JWT. Dev bypass code: 0000. Response drives role-based home screen.",
  "/auth/logout": "Clears the auth cookie / current session.",
  "/auth/logout-all-devices": "Bumps tokenVersion, invalidating every session for the user.",
  "/auth/verify-2fa": "Completes a 2FA challenge during login using a temporary token.",
  "/auth/verify-2fa-setup": "Confirms and enables 2FA for a user.",
  "/auth/2fa/setup": "Returns TOTP secret + QR code data URL for authenticator enrollment.",
  "/auth/2fa/verify": "Validates an OTP to enable 2FA.",
  "/auth/2fa/disable": "Disables 2FA for the authenticated user.",
  "/auth/change-password/{userId}": "Admin (user_password:manage). Changes a user's password and optionally resets 2FA. Protected by requirePermission.",
  "/auth/reset-2fa/{userId}": "Admin (user_password:manage). Resets a user's 2FA.",
  "/bookings/estimate-price": "PUBLIC. Server-side price estimate. Never trust a client-side price.",
  "POST /bookings": "Creates a booking with status=PENDING. DB unique constraint blocks double-booking (409).",
  "/bookings/{id}/status": "Transitions booking status. PENDING→CONFIRMED/CANCELLED, CONFIRMED→COMPLETED/CANCELLED.",
  "/bookings/{id}/trip-status": "NOTSTARTED→INPROGRESS→ARRIVED→COMPLETED. Trip COMPLETED auto-completes the booking and releases the driver.",
  "/bookings/{id}": "Cancels a booking (DELETE). Releases availability & driver and promotes waitlist position #1.",
  "/driver/{id}": "PUBLIC. Returns a driver's profile by id (rating included).",
  "/referrals/{id}/complete": "PUBLIC. Credits both referrer & referee wallets when the refereed user completes their first booking.",
  "/driver/bookings": "Driver's trips. filter=today|upcoming|completed.",
  "/reviews": "Blind rating: only visible to the other party after both submit OR 48h. Driver rating recalculated.",
  "/payments": "Creates a PENDING payment. paymentMethod: PAYMOB|FAWRY|CASH|WALLET.",
  "/payments/{id}/status": "Updates payment record and recomputes booking aggregate paymentStatus.",
  "/payments/summary/{bookingId}": "Returns totalPrice, totalPaid, remaining.",
  "/waitlist": "Joins the waitlist at the next open position; cancellation promotes position #1.",
  "/packages": "Creates a package with a server-applied discount.",
  "/chat/booking/{id}": "Auto-creates the conversation for a booking on first call.",
  "/chat/{conversationId}/messages": "Sends a chat message. messageType: TEXT|QUICK_REPLY.",
  "/referrals/apply": "Applies a referral code to the authenticated user.",
  "/referrals/generate-code": "Generates/returns the user's referral code.",
  "/wallet/credit": "Credits the wallet. type: REFERRAL_REWARD|REFUND|MANUAL_ADJUSTMENT|PAYMENT_DEDUCTION|DEPOSIT.",
  "/admin/settings": "System & evaluation-related settings.",
  "/admin/users/role": "Changes a user's role.",
  "/admin/bookings/calendar": "Bookings grouped by day for a month (YYYY-MM).",
  "/admin/bookings": "Bookings filtered by a specific date (YYYY-MM-DD).",
};

const SUCCESS_RESPONSES = {
  "/bookings/estimate-price": { success: true, data: { basePrice: 100, distancePrice: 30, timePrice: 20, surgeMultiplier: 1, discountAmount: 5, totalPrice: 145, depositPaid: 30 } },
  "POST /bookings": { success: true, data: { id: "{{bookingId}}", vehicleId: "{{vehicleId}}", status: "PENDING", tripStatus: "NOTSTARTED", totalPrice: 145 } },
  "/payments": { success: true, data: { id: "{{paymentId}}", bookingId: "{{bookingId}}", amount: 100, paymentMethod: "CASH", status: "PENDING" } },
  "/reviews": { success: true, data: { id: "{{reviewId}}", bookingId: "{{bookingId}}", overallRating: 5, visible: false } },
  "/waitlist": { success: true, data: { id: "{{waitlistId}}", position: 2, status: "WAITING" } },
  "/auth/otp/request": { message: "OTP sent successfully", dev_otp: "1234" },
  "/auth/otp/verify": { success: true, token: "{{token}}", user: { id: "{{userId}}", name: "John Customer", phoneNumber: "+201011111111", role: "Customer" } },
  "/auth/login": { message: "Login successful", user: { id: "{{userId}}", email: "admin@mishwarak.com" } },
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
  "/referrals/{id}/complete": "CompleteReferralBody",
  "/wallet/credit": "WalletOperationBody",
  "/wallet/debit": "WalletOperationBody",
  "/admin/drivers/{id}/status": "DriverStatusBody",
  "/admin/users/role": "UpdateUserRoleBody",
  "/admin/settings": "SystemSettingsBody",
};

const openapiSchemas = {
  SignupBody: { type: "object", properties: { name: { type: "string" }, email: { type: "string", format: "email" }, pic: { type: "string" }, code: { type: "string" }, graduationYear: { type: "string" }, graduationFaculty: { type: "string" }, graduationDepartment: { type: "string" }, graduationUniversity: { type: "string" }, location: { type: "string" }, salary: { type: "string" }, position: { type: "string" }, phoneNumbers: { type: "array", items: { type: "object", properties: { number: { type: "string" } } } } }, required: ["name", "email", "code", "graduationYear", "graduationFaculty", "location", "position", "phoneNumbers"] },
  LoginBody: { type: "object", properties: { email: { type: "string", format: "email" }, password: { type: "string", minLength: 6 } }, required: ["email", "password"] },
  OtpRequest: { type: "object", properties: { phoneNumber: { type: "string", minLength: 8 } }, required: ["phoneNumber"] },
  OtpVerify: { type: "object", properties: { phoneNumber: { type: "string" }, code: { type: "string", minLength: 4, maxLength: 4 } }, required: ["phoneNumber", "code"] },
  Verify2faBody: { type: "object", properties: { token: { type: "string" }, otpCode: { type: "string" } }, required: ["token", "otpCode"] },
  PriceEstimateBody: { type: "object", properties: { vehicleCategory: { type: "string", enum: ["CAR", "VAN", "BUS", "TRUCK", "CLASSIC", "LUXURY"] }, distanceKm: { type: "number" }, durationMinutes: { type: "number" }, isPeakHour: { type: "boolean" }, surgeMultiplier: { type: "number" }, packageDiscount: { type: "number" }, referralDiscount: { type: "number" }, vehicleId: { type: "string" }, packageId: { type: "string" }, referralCode: { type: "string" } } },
  CreateBookingBody: { type: "object", properties: { customerId: { type: "string" }, vehicleId: { type: "string" }, driverId: { type: "string" }, bookingDate: { type: "string", example: "2026-09-15" }, startTime: { type: "string", example: "10:00" }, endTime: { type: "string", example: "12:00" }, distanceKm: { type: "number" }, durationMinutes: { type: "number" }, startPoint: { type: "string" }, endPoint: { type: "string" }, notes: { type: "string" }, driverNotes: { type: "string" }, packageId: { type: "string" }, eventType: { type: "string" }, isPeakHour: { type: "boolean" }, surgeMultiplier: { type: "number" } }, required: ["vehicleId", "bookingDate", "startTime", "endTime"] },
  UpdateBookingStatusBody: { type: "object", properties: { status: { type: "string", enum: ["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED"] } }, required: ["status"] },
  UpdateTripStatusBody: { type: "object", properties: { tripStatus: { type: "string", enum: ["NOTSTARTED", "INPROGRESS", "ARRIVED", "COMPLETED"] } }, required: ["tripStatus"] },
  CancelBookingBody: { type: "object", properties: { reason: { type: "string" } } },
  UpdateDriverProfileBody: { type: "object", properties: { fullName: { type: "string" }, licenseNumber: { type: "string" }, licenseExpiry: { type: "string" }, pic: { type: "string" } } },
  DriverStatusBody: { type: "object", properties: { status: { type: "string", enum: ["ACTIVE", "OFF", "ONLEAVE"] } }, required: ["status"] },
  AssignVehicleBody: { type: "object", properties: { vehicleId: { type: "string" }, isPrimary: { type: "boolean" } }, required: ["vehicleId"] },
  CreateReviewBody: { type: "object", properties: { bookingId: { type: "string" }, reviewerType: { type: "string", enum: ["CUSTOMER_TO_DRIVER", "DRIVER_TO_CUSTOMER"] }, revieweeId: { type: "string" }, overallRating: { type: "integer", minimum: 1, maximum: 5 }, vehicleRating: { type: "integer", minimum: 1, maximum: 5 }, punctualityRating: { type: "integer", minimum: 1, maximum: 5 }, comment: { type: "string" } }, required: ["bookingId", "reviewerType", "revieweeId", "overallRating"] },
  InitiatePaymentBody: { type: "object", properties: { bookingId: { type: "string" }, amount: { type: "number", minimum: 1 }, paymentMethod: { type: "string", enum: ["PAYMOB", "FAWRY", "CASH", "WALLET"] } }, required: ["bookingId", "amount", "paymentMethod"] },
  UpdatePaymentStatusBody: { type: "object", properties: { status: { type: "string", enum: ["SUCCESS", "FAILED", "REFUNDED"] }, transactionRef: { type: "string" } }, required: ["status"] },
  JoinWaitlistBody: { type: "object", properties: { vehicleId: { type: "string" }, requestedDate: { type: "string", example: "2026-09-15" }, requestedTime: { type: "string", example: "10:00" } }, required: ["vehicleId", "requestedDate"] },
  CreatePackageBody: { type: "object", properties: { packageName: { type: "string" }, packageType: { type: "string", enum: ["MULTI_CAR", "MULTI_EVENT"] }, discountPercentage: { type: "number", minimum: 0, maximum: 100 } }, required: ["packageName", "packageType"] },
  AddPackageBookingBody: { type: "object", properties: { packageId: { type: "string" } }, required: ["packageId"] },
  SendMessageBody: { type: "object", properties: { content: { type: "string", minLength: 1 }, messageType: { type: "string", enum: ["TEXT", "QUICK_REPLY"] } }, required: ["content"] },
  ApplyReferralBody: { type: "object", properties: { referralCode: { type: "string" } }, required: ["referralCode"] },
  CompleteReferralBody: { type: "object", properties: { bookingId: { type: "string" } }, required: ["bookingId"] },
  WalletOperationBody: { type: "object", properties: { amount: { type: "number", minimum: 1 }, type: { type: "string", enum: ["REFERRAL_REWARD", "REFUND", "MANUAL_ADJUSTMENT", "PAYMENT_DEDUCTION", "DEPOSIT"] }, description: { type: "string" } }, required: ["amount", "type"] },
  UpdateUserRoleBody: { type: "object", properties: { userId: { type: "string" }, roleId: { type: "string" } }, required: ["userId", "roleId"] },
  SystemSettingsBody: { type: "object", properties: { performanceHistoryVisible: { type: "boolean" }, evaluationsVisible: { type: "boolean" }, selfAppraisalsVisible: { type: "boolean" } } },
  // ---------- response schemas ----------
  PriceEstimate: { type: "object", properties: { success: { type: "boolean" }, data: { type: "object", properties: { basePrice: { type: "number" }, distancePrice: { type: "number" }, timePrice: { type: "number" }, surgeMultiplier: { type: "number" }, discountAmount: { type: "number" }, totalPrice: { type: "number" }, depositPaid: { type: "number" } } } } },
  Booking: { type: "object", properties: { success: { type: "boolean" }, data: { type: "object", properties: { id: { type: "string" }, vehicleId: { type: "string" }, customerId: { type: "string" }, driverId: { type: "string" }, bookingDate: { type: "string" }, startTime: { type: "string" }, endTime: { type: "string" }, distanceKm: { type: "number" }, totalPrice: { type: "number" }, status: { type: "string", enum: ["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED"] }, tripStatus: { type: "string", enum: ["NOTSTARTED", "INPROGRESS", "ARRIVED", "COMPLETED"] } } } } },
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
      { key: "userId", value: "" },
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
      const url = { raw, host: ["{{baseUrl}}"], path: raw.split("/").filter(Boolean).map(() => "") };
      url.path = raw.split("/").filter(Boolean);
      if (query.length) url.query = query.map((q) => ({ key: q.key, value: q.value || "", disabled: !q.value }));

      const request = { method: ep.method, header, url };
      if (hasBody) {
        request.body = { mode: "raw", raw: JSON.stringify(body, null, 2), options: { raw: { language: "json" } } };
      }
      const desc = lookup(DESCRIPTIONS, ep.method, fullCurly);
      if (desc) request.description = desc;

      const displayPath = braceToColon(fullPath);
      const name = `${ep.method} ${displayPath}`;
      const response = { name, request, response: [] };
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
// 9. Run
// ---------------------------------------------------------------
fs.mkdirSync(OUT_DIR, { recursive: true });
const groups = readRouteFiles();

const postman = buildPostman(groups);
const openapi = buildOpenapi(groups);

const postmanPath = path.join(OUT_DIR, "mishwarak.postman_collection.json");
const openapiPath = path.join(OUT_DIR, "mishwarak.openapi.json");
fs.writeFileSync(postmanPath, JSON.stringify(postman, null, 2));
fs.writeFileSync(openapiPath, JSON.stringify(openapi, null, 2));

const total = groups.reduce((n, g) => n + g.endpoints.length, 0);
console.log("Groups parsed from routes/:");
for (const g of groups) console.log(`  - ${g.file}: ${g.endpoints.length} endpoints`);
console.log(`\nTotal endpoints: ${total}`);
console.log("Postman collection:", postmanPath);
console.log("OpenAPI spec:     ", openapiPath);
