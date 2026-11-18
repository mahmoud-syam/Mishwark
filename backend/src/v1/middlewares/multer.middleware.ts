import { Request } from "express";
import fs from "fs";
import multer, { FileFilterCallback } from "multer";
import path from "path";
import { randomUUID } from "crypto";
import { uuid } from "uuidv4"
import { BadRequestException } from "../utils/errors";

const UPLOADS_FOLDER = path.join(process.cwd(), "uploads");
const EMP_UPLOADS_FOLDER = path.join(process.cwd(), "uploads/employees");

if (!fs.existsSync(UPLOADS_FOLDER)) {
  fs.mkdirSync(UPLOADS_FOLDER, { recursive: true });
}

if (!fs.existsSync(EMP_UPLOADS_FOLDER)) {
  fs.mkdirSync(EMP_UPLOADS_FOLDER, { recursive: true });
}

if (!fs.existsSync(UPLOADS_FOLDER)) {
  fs.mkdirSync(UPLOADS_FOLDER, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req: Request, file: Express.Multer.File, cb) => {
    cb(null, UPLOADS_FOLDER)
  },

  filename: (req: Request, file: Express.Multer.File, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '');
    cb(null, `${file.fieldname}-${uniqueSuffix}-${sanitizedName}`);
  }
});

const employeeStorage = multer.diskStorage({
  destination: (req: Request, file: Express.Multer.File, cb) => {
    cb(null, EMP_UPLOADS_FOLDER)
  },

  filename: (req: Request, file: Express.Multer.File, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '');
    cb(null, `${file.fieldname}-${uniqueSuffix}-${sanitizedName}`);
  }
});

const fileFilter = (req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {

  // Allowed MIME types (e.g., for images and PDFs)
  const allowedMimeTypes = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
  ];

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    // Reject file
    cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed types: JPEG, PNG, WEBP, PDF.`));
  }
};

// 4. Export the configured Multer instance
export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB limit
    files: 5, // Maximum 5 files per request
  },
});

export const employeeUpload = multer({
  storage: employeeStorage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB limit
    files: 5, // Maximum 5 files per request
  },
});

// Car photos (fleet page): images only, saved under uploads/vehicles and served
// at /uploads/vehicles/<file>. The file name is random, never the client's.
const VEHICLE_UPLOADS_FOLDER = path.join(process.cwd(), "uploads", "vehicles");
if (!fs.existsSync(VEHICLE_UPLOADS_FOLDER)) {
  fs.mkdirSync(VEHICLE_UPLOADS_FOLDER, { recursive: true });
}
const IMAGE_EXT: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };

export const vehicleImageUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, VEHICLE_UPLOADS_FOLDER),
    filename: (_req, file, cb) => cb(null, `car-${Date.now()}-${Math.round(Math.random() * 1e9)}${IMAGE_EXT[file.mimetype] ?? ""}`),
  }),
  fileFilter: (_req, file, cb) => {
    if (IMAGE_EXT[file.mimetype]) cb(null, true);
    else cb(new BadRequestException(`Unsupported file type: ${file.mimetype}. Use JPG, PNG or WEBP.`));
  },
  limits: { fileSize: 5 * 1024 * 1024, files: 8 },
});

// A team member's or app user's own photo (profile page): images only, saved as
// uploads/employees/pic-<random>, the only names served from that folder.
export const EMPLOYEE_PHOTOS_FOLDER = EMP_UPLOADS_FOLDER;
export const profilePhotoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, EMP_UPLOADS_FOLDER),
    filename: (_req, file, cb) => cb(null, `pic-${randomUUID()}${IMAGE_EXT[file.mimetype] ?? ""}`),
  }),
  fileFilter: (_req, file, cb) => {
    if (IMAGE_EXT[file.mimetype]) cb(null, true);
    else cb(new BadRequestException(`Unsupported file type: ${file.mimetype}. Use JPG, PNG or WEBP.`));
  },
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

/**
 * The type the browser declares can be faked (a text file renamed .jpg), so read
 * the first bytes and check they really are a JPG, PNG or WEBP of that type.
 */
export function imageTypeOf(filePath: string): string | null {
  const head = Buffer.alloc(12);
  const fd = fs.openSync(filePath, "r");
  try {
    fs.readSync(fd, head, 0, 12, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (head.toString("ascii", 0, 4) === "RIFF" && head.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}
