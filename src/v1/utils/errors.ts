import { ErrorCodes, HttpException } from "../exceptions/root";

export { HttpException, ErrorCodes };

export class ConflictException extends HttpException {
  constructor(message: string = "Conflict", errorCode: number = ErrorCodes.UNPROCESSABLE_ENTITY, errors: any = null) {
    super(message, errorCode, 409, errors);
  }
}

export class BadRequestException extends HttpException {
  constructor(message: string = "Bad Request", errorCode: number = ErrorCodes.UNPROCESSABLE_ENTITY, errors: any = null) {
    super(message, errorCode, 400, errors);
  }
}

export class NotFoundException extends HttpException {
  constructor(message: string = "Not Found", errorCode: number = ErrorCodes.USER_NOT_FOUND, errors: any = null) {
    super(message, errorCode, 404, errors);
  }
}

export class ForbiddenException extends HttpException {
  constructor(message: string = "Forbidden", errorCode: number = ErrorCodes.FORBIDDEN, errors: any = null) {
    super(message, errorCode, 403, errors);
  }
}

export class UnauthorizedException extends HttpException {
  constructor(message: string = "Unauthorized", errorCode: number = ErrorCodes.UNAUTHORIZED, errors: any = null) {
    super(message, errorCode, 401, errors);
  }
}
