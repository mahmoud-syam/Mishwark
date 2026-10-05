import { Users } from "../../../generated/prisma/client";

declare global {
    namespace Express {
        export interface Request {
            /**
             * Populated by authMiddleware. The role is read from the database on
             * every request, so it is always current - but it is nullable because
             * a user row can still predate the role backfill migration.
             */
            user?: Omit<Users, "role"> & {
                role: {
                    id: string;
                    name: string;
                    permissions: string[]; // Optimized permissions as names
                } | null;
            }
        }
    }
}