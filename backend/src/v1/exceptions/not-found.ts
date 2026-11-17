import { ErrorCodes, HttpException } from "./root";

export class NotFoundException extends HttpException {
    constructor(message: string, errorCode: ErrorCodes | number,) {
        super(message, errorCode, 404, null);
    }
}