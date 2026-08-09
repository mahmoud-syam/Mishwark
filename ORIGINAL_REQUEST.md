# Original User Request

## Initial Request — 2026-08-09T08:05:08Z

<USER_REQUEST>
# Teamwork Project Prompt — Draft

> Status: Launched
> Goal: Get user approval → delegate to teamwork_preview

Complete the Mishwark backend (ride-booking application) by implementing the remaining features (Bookings, Waitlist, Ratings, Driver App, Referrals, and Admin Dashboard) defined in `Mishwark-Data-Model.docx`. Ensure all new code adheres strictly to the existing Clean Architecture pattern (Routes -> Controllers -> Zod Schemas -> Prisma Models).

Working directory: C:/Projects/Mishwarak-backend
Integrity mode: development

## Requirements

### R1. Implement Remaining Prisma Models
Add all missing models from the docx (Waitlist, Conversations, Messages, ScheduledNotifications, Referrals, WalletTransactions, Payments, Reviews, Packages) to the `prisma/models` directory, update enums, and successfully generate the Prisma client.

### R2. Implement Bookings & Pricing Logic
Implement the bookings endpoints, ensuring `POST /bookings/estimate-price` calculates price server-side based on distance and base price. Implement double-booking protection.

### R3. Implement Supplementary Modules
Implement endpoints for Waitlist, Reviews, Referrals, Packages, Payments, Chat, and Scheduled Notifications as mapped in the docx.

### R4. Implement Driver App & Admin Endpoints
Implement driver-scoped queries and trip status updates, as well as the Admin Dashboard statistics endpoints.

## Acceptance Criteria

### Verification & Compliance
- [ ] Code compiles without TypeScript errors (`tsc --noEmit`).
- [ ] Prisma client generates without schema validation errors (`npx prisma generate`).
- [ ] An independent agent-as-judge has reviewed the implemented codebase against `Mishwark-Data-Model.docx` and certified that all missing models, endpoints, and key business logic rules are implemented.
- [ ] All new routes are successfully wired into the main `src/v1/routes/index.ts` router.
</USER_REQUEST>
