# Testing the API in Apidog

Generated artifacts live in `api-docs/`. Regenerate them with:

```bash
node build-api-docs.js
node check-api-docs.js
```

## Import

1. `api-docs/mishwarak.openapi.json` — import as an OpenAPI 3 project.
   `api-docs/mishwarak.postman_collection.json` works too, and carries the
   pre-request/test scripts described below.
2. `api-docs/mishwarak.postman_environment.json` — import as an environment and
   select it. It defines `baseUrl`, `token`, `role`, `userId` and the id
   variables.
3. Set `baseUrl` for your target. The shipped value is
   `http://localhost:5000` (the port in `.env`). A second machine needs its own
   value — `192.168.100.15:5438` in `.env` is Postgres, not the API.

## Authentication

Two entry points, because they behave differently.

### OTP (simplest)

`POST /auth/otp/request` returns `dev_otp` in non-production, then
`POST /auth/otp/verify` returns the JWT in the body. Its test script writes
`token`, `role` and `userId` into the environment, so every protected request
authorizes itself afterwards.

### Login (2FA-gated)

`POST /auth/login` **never** returns a token. It returns either
`twoFactorSetupRequired` or `twoFactorRequired` plus a `userId`. Its test script
saves that `userId`; then:

- `twoFactorSetupRequired` → `POST /auth/verify-2fa-setup` (pass `secret` from
  step 1 as well as a fresh TOTP code)
- `twoFactorRequired` → `POST /auth/verify-2fa`

Both set the JWT as a `token` **cookie only**, with no token in the body. Their
test scripts read it back from the cookie jar, so keep cookie handling enabled
for the Apidog environment.

### Signup

`POST /auth/signup` is multipart. `role` takes `customer` (default) or `driver`;
`pic` is a file part; `phoneNumbers` is a JSON-encoded array in a text part.
Admin roles cannot be self-assigned — use `PATCH /admin/users/role`.

Signup does not return a token. Sign in afterwards to get one.

## Auto-filled variables

Running these requests populates the matching environment variable, so the
follow-up requests that reference it work without copying ids by hand:

| Run this | Sets |
| --- | --- |
| `GET /vehicles` | `vehicleId` (first vehicle) |
| `POST /bookings` | `bookingId` |
| `POST /payments` | `paymentId` |
| `POST /reviews` | `reviewId` |
| `POST /waitlist` | `waitlistId` |
| `POST /packages` | `packageId` |
| `POST /referrals/generate-code` | `referralCode` |

Two variables have no endpoint that returns them, so set them by hand:
`driverUserId` (a `Users.id` of a driver, used as `revieweeId` in
`POST /reviews`) and `roleId` (a `Role.id`, used by
`PATCH /admin/users/role`).

## Suggested order

```
1. GET  /vehicles                      -> vehicleId
2. POST /auth/signup                   (role=customer, multipart)
3. POST /auth/otp/request  ->  POST /auth/otp/verify
4. POST /bookings/estimate-price
5. POST /bookings                      -> bookingId
6. POST /payments                      -> paymentId
7. GET  /admin/bookings                (switch to an admin token)
```

Protected requests send `Authorization: Bearer {{token}}`. A pre-request script
warns when the token is missing, but a missing token still returns 401 rather
than being skipped.
