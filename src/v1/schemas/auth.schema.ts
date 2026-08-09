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

export const SignupSchema = z.object({
    name: z.string().min(1, "Name is required"),
    email: z.string().email("Invalid email address"),
    pic: z.string().optional(),
    password: z.string().optional(),
    code: z.preprocess(coerceToString, z.string().min(1, "Code is required")),
    graduationYear: z.preprocess(coerceToString, z.string().min(4, "Graduation year is required")),
    graduationFaculty: z.string().min(2, "Graduation faculty is required"),
    graduationDepartment: z.string().optional(),
    graduationUniversity: z.string().optional(),
    location: z.string().min(2, "Location is required"),
    salary: z.preprocess(coerceToString, z.string()).optional(),
    position: z.string().min(2, "Position is required"),
    birth_date: z.string().optional(),
    religion: z.string().optional(),
    marital_status: z.string().optional(),
    military_status: z.string().optional(),
    personal_mail: z.string().optional(),
    joining_date: z.string().optional(),
    resign_date: z.string().optional(),
    work_certificate_sub_date: z.string().optional(),
    medical_insurance:z.preprocess(parseMultipartBoolean, z.boolean().optional()).optional(),
    teamLeaderOfId: z.string().optional(),
    headOfDepartmentId: z.string().optional(),
    employeeOfId: z.string().optional(),
    reportingToId: z.string().optional(),
    phoneNumbers: z.preprocess(parseMultipartJson, z.array(z.object({
        number: z.string().min(1)
    }))),
    isAdmin: z.preprocess(parseMultipartBoolean, z.boolean().optional()).optional(),
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


});

export type SignupSchema = z.infer<typeof SignupSchema>;

export const LoginSchema = z.object({
    email: z.string().email("Invalid email address"),
    password: z.string().min(6, "Password must be at least 6 characters long")
});

export type LoginSchema = z.infer<typeof LoginSchema>;


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
    phoneNumber: z.string().min(8, "Phone number is too short")
});

export const OtpVerifySchema = z.object({
    phoneNumber: z.string().min(8, "Phone number is too short"),
    code: z.string().length(4, "OTP must be 4 digits")
});
