## 2026-08-10T07:50:49Z
<USER_REQUEST>
You are an Explorer subagent for Milestone M2: Bookings & Pricing Core Engine.
Your assigned working directory: C:/Projects/Mishwarak-backend/.agents/explorer_m2_1/

Scope & Context Files:
- Original Request: C:/Projects/Mishwarak-backend/ORIGINAL_REQUEST.md
- Project Spec: C:/Projects/Mishwarak-backend/PROJECT.md
- Milestone M2 Scope: C:/Projects/Mishwarak-backend/.agents/sub_orch_m2_gen2/SCOPE.md

Task Instructions:
1. Investigate the Pricing Engine requirements (`src/v1/services/pricing.service.ts`):
   - Calculation formulas for base price, distance price (distanceKm * pricePerKm), duration price (hours * pricePerHour), surge multiplier for peak hours.
   - Discount logic for package bookings (discountPercentage) and valid referral codes.
   - 20% deposit requirement calculation.
   - Inspect existing Prisma schema/models (e.g. `prisma/schema.prisma` or `prisma/models/`), Zod schemas, and system settings to understand existing data types and functions.
2. Outline exact class/function signatures, interface DTOs (`CalculatePriceDTO`, `PriceBreakdown`), and validation rules required.
3. Write your detailed findings and proposed implementation strategy into `C:/Projects/Mishwarak-backend/.agents/explorer_m2_1/analysis.md` and deliver a structured `handoff.md` in the same directory.
4. Send a completion message to the parent orchestrator. Do NOT modify any source code files.
</USER_REQUEST>
