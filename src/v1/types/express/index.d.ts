import { Users } from "../../../generated/prisma/client";

declare global {
    namespace Express {
        export interface Request {
            user?: Users & {
                role?: {
                    id: string;
                    name: string;
                    permissions: string[]; // Optimized permissions as names
                } | null;
            }
        }
    }
}