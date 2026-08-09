## 2026-08-09T08:25:48Z
You are teamwork_preview_test_writer assigned to Milestone T-M3 for Mishwark Backend E2E Test Suite.
Your Working Directory: C:/Projects/Mishwarak-backend/.agents/test_writer_tm3

Context files:
- C:/Projects/Mishwarak-backend/ORIGINAL_REQUEST.md
- C:/Projects/Mishwarak-backend/PROJECT.md
- C:/Projects/Mishwarak-backend/TEST_INFRA.md
- C:/Projects/Mishwarak-backend/.agents/e2e_testing_orch/SCOPE.md
- C:/Projects/Mishwarak-backend/tests/infra/

Task Instructions:
1. Read the context files carefully and inspect existing test infrastructure in `tests/infra/`.
2. Create E2E test suites for Features F8, F9, F10, F11, F12, F13, F14:
   - `tests/tier1/f8_to_f14_supplementary_modules.test.ts`: Tier 1 feature coverage tests (≥35 test cases, ≥5 per feature) covering:
     * F8: Driver profile, shift status toggling (`ACTIVE`/`OFF`), vehicle assignment, availability blockages.
     * F9: Review submission (rider & driver), running average rating computation, blind review 48h visibility window rules.
     * F10: Wallet balances, transaction logging, payment recording (Cash/Fawry/Paymob), deposit deduction, refund processing.
     * F11: Referral code generation, referral tracking, wallet bonus allocation upon first completed booking.
     * F12: In-app chat conversation initialization, sending text/quick-reply messages, mark read status.
     * F13: Multi-vehicle / multi-event package creation, bundle discount calculation, multi-booking balance linking.
     * F14: Scheduled notification queueing (24h, 2h, 30m reminders, post-trip review prompts), notification delivery state transitions.
   - `tests/tier2/f8_to_f14_supplementary_boundaries.test.ts`: Tier 2 boundary, corner case & limit tests (≥35 test cases, ≥5 per feature) covering:
     * F8 Boundaries: Assigning unavailable/unlicensed vehicle, invalid shift transitions during active trip.
     * F9 Boundaries: Out-of-range rating values (<1 or >5), duplicate review submission for same booking, early rating release before blind window expiry.
     * F10 Boundaries: Insufficient wallet balance for debit, negative payment amount rejection, double refund attempt prevention.
     * F11 Boundaries: Self-referral attempt rejection, expired/invalid referral code usage, duplicate reward claim prevention.
     * F12 Boundaries: Message sending on cancelled/invalid booking conversation, message length bounds, unauthorized chat access.
     * F13 Boundaries: Exceeded package trip allowance, expired package usage attempt, invalid bundle discount configuration.
     * F14 Boundaries: Past trigger time notification queueing, duplicate notification dispatch prevention, invalid recipient channel.
3. Execute `npx tsx tests/infra/run-all.ts` to verify compilation and test execution across all test suites in `tests/tier1` and `tests/tier2`.
4. Create `progress.md` and `handoff.md` in your working directory `C:/Projects/Mishwarak-backend/.agents/test_writer_tm3/` detailing test cases created, test execution output, and verification results.
5. Send a message to parent with your final status and artifact paths.
