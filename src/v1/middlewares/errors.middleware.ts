import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { ErrorCodes, HttpException } from "../exceptions/root";

/**
 * Single place that turns any thrown error into the API's error envelope.
 *
 * Controllers that use try/catch + next(error) bypass errorHandler's mapping,
 * so this middleware must handle raw errors too. Previously a ZodError became a
 * 500, and an unexpected error leaked its raw message (Prisma invocation text
 * with server file paths) to the client.
 */
export const errorMiddleware = (error: any, req: Request, res: Response, _next: NextFunction) => {
    // errorHandler wraps unexpected errors in a 500 InternalException carrying
    // the raw error in `errors`. Never send that to the client: unwrap it so
    // Prisma/Zod errors still get their proper status, otherwise answer generically.
    if (error instanceof HttpException && (error.statusCode || 500) >= 500) {
        const inner = (error as any).errors;
        if (inner && typeof inner === "object" && !Array.isArray(inner)) {
            error = inner;
        } else {
            console.error(`[error] ${req.method} ${req.originalUrl}`, error);
            return res.status(500).json({ message: "Something went wrong", errorCode: ErrorCodes.INTERNAL_EXCEPTION, errors: null });
        }
    }

    if (error instanceof HttpException) {
        return res.status(error.statusCode || 500).json({
            message: error.message || "Internal Server Error",
            errorCode: error.errorCode,
            errors: error.errors ?? null,
        });
    }

    if (error instanceof ZodError) {
        return res.status(422).json({
            message: "Validation failed",
            errorCode: ErrorCodes.UNPROCESSABLE_ENTITY,
            errors: error.issues,
        });
    }

    // Malformed JSON body
    if (error?.type === "entity.parse.failed") {
        return res.status(400).json({ message: "Malformed JSON body", errorCode: ErrorCodes.UNPROCESSABLE_ENTITY, errors: null });
    }

    // Known Prisma request errors (thrown as PrismaClientKnownRequestError)
    const code: string | undefined = error?.code;
    if (typeof code === "string" && /^P\d{4}$/.test(code)) {
        const map: Record<string, [number, string]> = {
            P2002: [409, "A record with these values already exists"],
            P2003: [400, "A referenced record does not exist"],
            P2025: [404, "Record not found"],
        };
        const [status, message] = map[code] ?? [400, "Invalid request"];
        return res.status(status).json({ message, errorCode: status === 404 ? ErrorCodes.USER_NOT_FOUND : ErrorCodes.UNPROCESSABLE_ENTITY, errors: null });
    }
    // Prisma validation errors (e.g. undefined where a value is required)
    if (error?.name === "PrismaClientValidationError") {
        return res.status(400).json({ message: "Invalid request", errorCode: ErrorCodes.UNPROCESSABLE_ENTITY, errors: null });
    }

    console.error(`[error] ${req.method} ${req.originalUrl}`, error);
    return res.status(500).json({ message: "Something went wrong", errorCode: ErrorCodes.INTERNAL_EXCEPTION, errors: null });
};
