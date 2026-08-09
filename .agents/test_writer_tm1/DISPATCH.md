## 2026-08-09T08:10:09Z
You are teamwork_preview_test_writer assigned to Milestone T-M1 for Mishwark Backend E2E Test Suite.
Your Working Directory: C:/Projects/Mishwarak-backend/.agents/test_writer_tm1

Context files:
- C:/Projects/Mishwarak-backend/ORIGINAL_REQUEST.md
- C:/Projects/Mishwarak-backend/PROJECT.md
- C:/Projects/Mishwarak-backend/TEST_INFRA.md
- C:/Projects/Mishwarak-backend/.agents/e2e_testing_orch/SCOPE.md

Task Instructions:
1. Read the context files carefully.
2. Build shared test infrastructure under `tests/infra/`:
   - `tests/infra/db-setup.ts`: Database seed and reset helpers.
   - `tests/infra/api-client.ts`: Express application HTTP request agent / API test helper.
   - `tests/infra/auth-helper.ts`: JWT token generator helper for Admin, Rider, and Driver test user roles.
   - `tests/infra/run-all.ts`: Master test runner script that discovers and executes all test suites across `tests/tier1`, `tests/tier2`, `tests/tier3`, `tests/tier4`, formats results, prints pass/fail summary with total counts, and exits with status 0 on success or 1 on failure.
3. Write test suites for Features F1, F2, F3:
   - `tests/tier1/f1_f2_f3_prisma_models.test.ts`: Tier 1 feature coverage tests (≥15 test cases) covering all Prisma models, schema, enums, client types, and seeds.
   - `tests/tier2/f1_f2_f3_prisma_boundaries.test.ts`: Tier 2 boundary & corner case tests (≥15 test cases) covering database constraint violations, invalid model relations, enum type boundaries, and missing seed handling.
4. Execute `npx tsx tests/infra/run-all.ts` to verify compilation and test execution.
5. Create `progress.md` and `handoff.md` in your working directory `C:/Projects/Mishwarak-backend/.agents/test_writer_tm1/` detailing test runner setup, test counts, build/test execution output, and verification results.
6. Send a message to parent with your final status and artifact paths.
