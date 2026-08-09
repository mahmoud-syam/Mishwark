// message, status code, error codes, error


export class HttpException extends Error {
    message: string;
    errorCode: any;
    statusCode: number;
    errors: ErrorCodes;

    constructor(message: string, errorCode: any, statusCode: number, errors: any) {
        super(message);
        this.message = message;
        this.errorCode = errorCode;
        this.statusCode = statusCode;
        this.errors = errors;
    }
}

export enum ErrorCodes {
    USER_NOT_FOUND = 1001,
    USER_ALREADY_EXISTS = 1002,


    INCORRECT_PASSWORD = 1004,
    INVALID_CREDENTIALS = 1005,


    UNPROCESSABLE_ENTITY = 2001,
    INTERNAL_EXCEPTION = 3001,
    UNAUTHORIZED = 4001,
    FORBIDDEN = 4003,

    APPLICANT_NOT_FOUND = 5001,
    DEPARTMENT_NOT_FOUND = 6001,
    RECRUITING_PHASE_NOT_FOUND = 7001,
    VACANCY_NOT_FOUND=8001,
    KPI_CATEGORY_NOT_FOUND=9001,
    ROLE_NOT_FOUND=10001,
    PERMISSION_NOT_FOUND=11001,
    PROJECT_NOT_FOUND=12001,
    SERVICE_NOT_FOUND=13001,

}