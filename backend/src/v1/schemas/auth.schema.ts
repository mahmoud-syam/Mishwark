import { normalizePhone } from "../utils/phone";
import z, { number } from "zod";


const parseMultipartJson = (value: unknown) => {
    if (typeof value !== "string") {
        return value;
    }

    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
};

const parseMultipartBoolean = (value: unknown) => {
    if (typeof value !== "string") {
        return value;
    }

    const normalizedValue = value.trim().toLowerCase();

    if (normalizedValue === "true") {
        return true;
    }

    if (normalizedValue === "false") {
        return false;
    }

    return value;
};


const coerceToString = (value: unknown) => {
    if (value === undefined || value === null) {
        return value;
    }
    return String(value);
};

/**
 * Roles a client may self-assign during signup.
 * Admin roles are intentionally absent - they can only be granted by an existing
 * admin through PATCH /admin/users/role.
 */
export const SELF_SIGNUP_ROLES = ["customer", "driver"] as const;

const parseMultipartEnum = (allowed: readonly string[]) => (value: unknown) => {
    const normalized =
        typeof value === "string" ? value.trim().toLowerCase() : value;

    if (typeof normalized === "string" && allowed.includes(normalized)) {
        return normalized;
    }

    return value;
};

export const SignupSchema = z.object({
    name: z.string().min(1, "Name is required"),
    email: z.string().email("Invalid email address"),
    pic: z.string().optional(),
    password: z.string().min(8, "Password must be at least 8 characters"),
    phoneNumbers: z.preprocess(parseMultipartJson, z.array(z.object({
        number: z.string().min(1)
    }))),
    /**
     * The account type flag. Defaults to "customer" when omitted. Multipart
     * bodies send it as a string, hence the preprocessor.
     */
    role: z.preprocess(
        parseMultipartEnum(SELF_SIGNUP_ROLES),
        z.enum(SELF_SIGNUP_ROLES).default("customer")
    ),
    /** Optional referral code captured at signup time. */
    referralCode: z.string().trim().min(1).optional(),

    // Driver-only fields. Rejected when role is not "driver".
    licenseNumber: z.string().trim().min(1, "License number is required for drivers").optional(),
    licenseExpiry: z.preprocess(
        coerceToString,
        z
            .string()
            .refine((value) => !Number.isNaN(new Date(value).getTime()), {
                message: "licenseExpiry must be a valid date",
            })
            .optional()
    ),

    // Legacy HR/employee fields retained for backwards compatibility with the
    // original ACS fork payload. They are validated but no longer stored.
    code: z.preprocess(coerceToString, z.string().optional()),
    graduationYear: z.preprocess(coerceToString, z.string().optional()),
    graduationFaculty: z.string().optional(),
    graduationDepartment: z.string().optional(),
    graduationUniversity: z.string().optional(),
    location: z.string().optional(),
    salary: z.preprocess(coerceToString, z.string()).optional(),
    position: z.string().optional(),
    birth_date: z.string().optional(),
    religion: z.string().optional(),
    marital_status: z.string().optional(),
    military_status: z.string().optional(),
    personal_mail: z.string().optional(),
    joining_date: z.string().optional(),
    resign_date: z.string().optional(),
    work_certificate_sub_date: z.string().optional(),
    medical_insurance: z.preprocess(parseMultipartBoolean, z.boolean().optional()).optional(),
    teamLeaderOfId: z.string().optional(),
    headOfDepartmentId: z.string().optional(),
    employeeOfId: z.string().optional(),
    reportingToId: z.string().optional(),

    contract: z.preprocess(parseMultipartJson,z.object({
        type_of_contract: z.enum(['FULLTIME','PARTTIME','CONTRACT','INTERN']),
        start_date: z.string().optional(),
        end_date: z.string().optional(),
        contract_valu: z.preprocess(coerceToString, z.string().optional()).optional(),
    })).optional(),
    insurance: z.preprocess(parseMultipartJson,z.object({
        insurance_status: z.string().optional(),
        insurance_number: z.string().optional(),
        insurance_salary: z.preprocess(coerceToString, z.string().optional()).optional(),
        insurance_start_date: z.string().optional(),
    })).optional(),
    documents: z.preprocess(parseMultipartJson,z.array(z.object({
        type: z.enum(['ID', 'BIRTHCERTIFICATE', 'EDUCATIONALCERTIFICATE', 'SOCIALINSURANCEPRINTOUT', 'MILITARYSERVICECERTIFICATE', 'CRIMINALRECORD', 'FORM111', 'FORM6', 'PERSONALPHOTOS', 'LABOR', 'DRIVINGLICENSE', 'CV']),
        document: z.string().optional(),
        isReceived: z.boolean().optional(),
        fileIndex: z.number().optional(),
    }))).optional(),


}).superRefine((data, ctx) => {
    if (data.role === "driver" && !data.licenseNumber) {
        ctx.addIssue({
            code: "custom",
            path: ["licenseNumber"],
            message: "licenseNumber is required when registering as a driver",
        });
    }
});

export type SignupSchema = z.infer<typeof SignupSchema>;

export const LoginSchema = z.object({
    email: z.string().email("Invalid email address"),
    password: z.string().min(6, "Password must be at least 6 characters long")
});

export type LoginSchema = z.infer<typeof LoginSchema>;

/** A password a person chooses (first sign-in, or set by an admin). */
export const PasswordRule = z
    .string()
    .min(8, "Password must be at least 8 characters long")
    .max(100, "Password is too long");

export const NewPasswordSchema = z.object({
    loginToken: z.string().min(1, "Sign in again: loginToken is required"),
    newPassword: PasswordRule,
});


export const DocumentsTypesSchema = z.enum(['ID', 'BIRTHCERTIFICATE', 'EDUCATIONALCERTIFICATE', 'SOCIALINSURANCEPRINTOUT', 'MILITARYSERVICECERTIFICATE', 'CRIMINALRECORD', 'FORM111', 'FORM6', 'PERSONALPHOTOS', 'LABOR', 'DRIVINGLICENSE', 'CV']);

export type DocumentsTypesType = `${z.infer<typeof DocumentsTypesSchema>}`

export const DocumentSchema = z.object({
    type: DocumentsTypesSchema,
    document: z.string().optional(),
    isReceived: z.boolean().optional(),

})

export type Document = z.infer<typeof DocumentSchema>

export const EmploymentTypesSchema = z.enum(['FULLTIME','PARTTIME','CONTRACT','INTERN']);

export type EmploymentTypesType = `${z.infer<typeof EmploymentTypesSchema>}`

export const ContractSchema = z.object({
  type_of_contract: EmploymentTypesSchema,
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  contract_valu: z.string().optional(),

})

export type Contract = z.infer<typeof ContractSchema>


export const InsuranceSchema = z.object({
  insurance_status: z.string().optional(),
  insurance_number: z.string().optional(),
  insurance_salary: z.string().optional(),
  insurance_start_date: z.string().optional(),

})

export type Insurance = z.infer<typeof InsuranceSchema>

export const OtpRequestSchema = z.object({
    phoneNumber: z.string().min(8, "Phone number is too short").transform(normalizePhone),
    /** Account type requested when the phone number is not yet registered. */
    role: z.preprocess(
        parseMultipartEnum(SELF_SIGNUP_ROLES),
        z.enum(SELF_SIGNUP_ROLES).default("customer")
    ),
    name: z.string().trim().min(1).optional(),
    licenseNumber: z.string().trim().min(1).optional(),
});

export type OtpRequestSchema = z.infer<typeof OtpRequestSchema>;

export const OtpVerifySchema = z.object({
    phoneNumber: z.string().min(8, "Phone number is too short").transform(normalizePhone),
    code: z.string().length(4, "OTP must be 4 digits")
});

export type OtpVerifySchema = z.infer<typeof OtpVerifySchema>;
