import { NextFunction, Request, Response } from "express"
import { ErrorCodes, HttpException } from "./v1/exceptions/root"
import { InternalException } from "./v1/exceptions/internal-exceptions"
import { ZodError } from "zod"
import { UnprocessableEntity } from "./v1/exceptions/validation"

export const errorHandler = (method: Function) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            await method(req, res, next)
        } catch (error: any) {
            if (error instanceof HttpException) {
                next(error)
                return
            }

            if (error instanceof ZodError) {
                next(new UnprocessableEntity(error.issues, "Validation failed", ErrorCodes.UNPROCESSABLE_ENTITY))
                return
            }

            next(new InternalException("Something went wrong", error, ErrorCodes.INTERNAL_EXCEPTION))

        }
    }
}