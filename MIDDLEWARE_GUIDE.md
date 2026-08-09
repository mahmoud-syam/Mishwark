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
    Users with the `isAdmin: true` flag or a role named `Super Admin` automatically pass all `requirePermission` checks, regardless of the permission requested.
    
2.  **Type Safety:** 
    The `req.user` object is typed to include the user's role and permissions. You can access them in your controllers like this:
    ```typescript
    const permissions = req.user?.role?.permissions; // string[]
    ```

3.  **Error Responses:**
    *   **401 Unauthorized:** Thrown if the token is missing, invalid, or expired.
    *   **403 Forbidden:** Thrown if the user is logged in but doesn't have the required permission name.

## Common Permission Names
Refer to `prisma/seed/roles.ts` or your database for the current list of permissions. Common ones include:
*   `dashboard:view`
*   `user:manage`
*   `role:manage`
*   `department:manage`
*   `applicant:manage`
*   `kpi_config:manage`
