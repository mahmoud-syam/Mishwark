# Backend Middleware Guide

This project uses a layered middleware approach to handle authentication and authorization.

## Available Middlewares

### 1. `authMiddleware`
Verifies the `token` cookie (JWT) and populates `req.user`. This is the foundation for all protected routes.

### 2. `requirePermission(permissionName: string)`
Enforces granular access control. It requires `authMiddleware` to be executed first.

---

## Usage Patterns

### Standard Protection
To ensure a user is logged in before accessing a route:

```typescript
import { authMiddleware } from "../middlewares/auth.middleware";

router.get("/my-profile", authMiddleware, getProfileController);
```

### Permission-Based Protection
To ensure a user has a specific permission (e.g., 'user:manage'):

```typescript
import { authMiddleware } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/permission.middleware";

// Note: authMiddleware MUST come before requirePermission
router.post("/employees", 
    authMiddleware, 
    requirePermission("user:manage"), 
    createEmployeeController
);
```

### Multiple Permissions (Any/OR)
If you want to allow access if the user has **at least one** of several permissions, pass an array:

```typescript
// Grant access if user has 'user:manage' OR 'role:manage'
router.get("/security-logs", 
    authMiddleware, 
    requirePermission(["user:manage", "role:manage"]), 
    getLogsController
);
```

### Multiple Permissions (All/AND)
If you want to require the user to have **all** of the listed permissions, pass 'all' as the second argument:

```typescript
// Grant access ONLY if user has both 'user:manage' AND 'role:manage'
router.put("/system-config", 
    authMiddleware, 
    requirePermission(["user:manage", "role:manage"], "all"), 
    updateConfigController
);
```

### Global Router Protection
If every route in a router requires the same permission, you can apply it at the top:

```typescript
const AdminRouter = Router();

AdminRouter.use(authMiddleware);
AdminRouter.use(requirePermission("role:manage"));

AdminRouter.get("/roles", getAllRoles);
AdminRouter.post("/roles", createRole);
```

---

## Key Logic Features

1.  **Super Admin Bypass:**
    Users whose role is `SUPER_ADMIN` automatically pass all `requirePermission` checks, regardless of the permission requested. There is no `isAdmin` flag on the user model; authorization derives solely from the role.

2.  **Type Safety:**
    The `req.user` object is typed to include the user's role and permissions. You can access them in your controllers like this:
    ```typescript
    const permissions = req.user?.role?.permissions; // string[]
    ```

3.  **Error Responses:**
    *   **401 Unauthorized:** Thrown if the token is missing, invalid, or expired.
    *   **403 Forbidden:** Thrown if the user is logged in but doesn't have the required permission name.

4.  **Role freshness:**
    `authMiddleware` re-reads the role from the database on every request, so a change made through `PATCH /admin/users/role` applies immediately. The JWT is only trusted for identity and `tokenVersion`.

## Common Permission Names
Refer to `src/v1/constants/roles.ts` (`PERMISSIONS`) or `prisma/seed/api_seed_roles.ts` for the canonical list. Current names:
*   `dashboard:view`
*   `user:manage`
*   `role:manage`
*   `booking:manage`
*   `vehicle:manage`
*   `driver:manage`
*   `payment:manage`
*   `settings:manage`
*   `review:manage`
*   `wallet:manage`
*   `user_password:manage`

`SUPER_ADMIN` holds all of them. `ADMIN` holds all except `role:manage` and `settings:manage`. `CUSTOMER` and `DRIVER` hold none — they are authorized by role rather than by permission.
