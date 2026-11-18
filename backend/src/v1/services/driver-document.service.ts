import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import multer from "multer";
import { DocumentStatus, DriverDocumentType } from "../../../generated/prisma";
import prismaClient from "../utils/prismaClientHelper";
import { BadRequestException, NotFoundException } from "../utils/errors";
import { imageTypeOf } from "../middlewares/multer.middleware";

/**
 * Driver papers (ID, licence, criminal record).
 *
 * Stored in a private folder that is never served as static files
 * (DRIVER_DOCUMENTS_DIR, default ./storage/driver-documents): every download
 * goes through an endpoint that checks the caller is the driver or the
 * dashboard team. Keep this folder on a persistent volume in production.
 */
export const DOCUMENTS_DIR = path.resolve(process.cwd(), process.env.DRIVER_DOCUMENTS_DIR || "storage/driver-documents");
const MAX_BYTES = 10 * 1024 * 1024;

/** Every type a driver must upload, in the order the app shows them. */
export const REQUIRED_DOCUMENTS: DriverDocumentType[] = [
  DriverDocumentType.NATIONAL_ID_FRONT,
  DriverDocumentType.NATIONAL_ID_BACK,
  DriverDocumentType.LICENSE_FRONT,
  DriverDocumentType.LICENSE_BACK,
  DriverDocumentType.CRIMINAL_RECORD,
];

/** Multipart field names accepted with POST /auth/signup (role driver). */
export const SIGNUP_FIELDS: Record<string, DriverDocumentType> = {
  nationalIdFront: DriverDocumentType.NATIONAL_ID_FRONT,
  nationalIdBack: DriverDocumentType.NATIONAL_ID_BACK,
  licenseFront: DriverDocumentType.LICENSE_FRONT,
  licenseBack: DriverDocumentType.LICENSE_BACK,
  criminalRecord: DriverDocumentType.CRIMINAL_RECORD,
};

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

/** The real type from the file's first bytes (a renamed file is refused). */
export const documentTypeOf = (filePath: string): string | null => {
  const image = imageTypeOf(filePath);
  if (image) return image;
  const head = Buffer.alloc(5);
  const fd = fs.openSync(filePath, "r");
  try {
    fs.readSync(fd, head, 0, 5, 0);
  } finally {
    fs.closeSync(fd);
  }
  return head.toString("ascii") === "%PDF-" ? "application/pdf" : null;
};

/** Uploads land in a temp folder, are checked, then moved into the private folder. */
export const documentUpload = multer({
  dest: path.join(os.tmpdir(), "mishwark-doc-uploads"),
  limits: { fileSize: MAX_BYTES, files: 5 },
  fileFilter: (_req, file, cb) => {
    if (Object.keys(EXT).includes(file.mimetype)) cb(null, true);
    else cb(new BadRequestException("Documents must be JPG, PNG, WEBP or PDF"));
  },
});

const shape = (d: { id: string; type: DriverDocumentType; mimeType: string; size: number; status: DocumentStatus; reviewNote: string | null; reviewedAt: Date | null; createdAt: Date; updatedAt: Date }) => ({
  id: d.id,
  type: d.type,
  mimeType: d.mimeType,
  size: d.size,
  status: d.status,
  reviewNote: d.reviewNote,
  reviewedAt: d.reviewedAt,
  uploadedAt: d.updatedAt,
});

export class DriverDocumentService {
  /**
   * Saves one uploaded file as the driver's document of that type, replacing
   * any earlier one (which goes back to review). The temp file is always removed.
   */
  public static async save(driverId: string, type: DriverDocumentType, file: Express.Multer.File) {
    try {
      const real = documentTypeOf(file.path);
      if (!real || !EXT[real]) throw new BadRequestException("This file isn't a real JPG, PNG, WEBP or PDF");
      fs.mkdirSync(path.join(DOCUMENTS_DIR, driverId), { recursive: true });
      const fileName = `${driverId}/${type.toLowerCase()}-${crypto.randomUUID()}.${EXT[real]}`;
      fs.copyFileSync(file.path, path.join(DOCUMENTS_DIR, fileName));
      const previous = await prismaClient.driverDocuments.findUnique({ where: { driverId_type: { driverId, type } } });
      const row = await prismaClient.driverDocuments.upsert({
        where: { driverId_type: { driverId, type } },
        create: { driverId, type, fileName, mimeType: real, size: file.size },
        update: { fileName, mimeType: real, size: file.size, status: DocumentStatus.PENDING, reviewNote: null, reviewedById: null, reviewedAt: null },
      });
      if (previous) fs.rmSync(path.join(DOCUMENTS_DIR, previous.fileName), { force: true });
      return shape(row);
    } finally {
      fs.rmSync(file.path, { force: true });
    }
  }

  /** The driver's documents plus what is still missing. */
  public static async list(driverId: string) {
    const rows = await prismaClient.driverDocuments.findMany({ where: { driverId } });
    const byType = new Map(rows.map((r) => [r.type, r]));
    const documents = REQUIRED_DOCUMENTS.map((type) => {
      const r = byType.get(type);
      return r ? shape(r) : { type, status: "MISSING" as const };
    });
    return { documents, summary: this.summarize(rows) };
  }

  /** MISSING (something not uploaded), REJECTED, PENDING (waiting for review) or APPROVED (all approved). */
  public static summarize(rows: { type: DriverDocumentType; status: DocumentStatus }[]) {
    const got = new Map(rows.map((r) => [r.type, r.status]));
    const missing = REQUIRED_DOCUMENTS.filter((t) => !got.has(t)).length;
    const rejected = rows.filter((r) => r.status === DocumentStatus.REJECTED).length;
    const pending = rows.filter((r) => r.status === DocumentStatus.PENDING).length;
    const state = rejected ? "REJECTED" : missing ? "MISSING" : pending ? "PENDING" : "APPROVED";
    return { state, missing, pending, rejected, approved: rows.filter((r) => r.status === DocumentStatus.APPROVED).length, required: REQUIRED_DOCUMENTS.length };
  }

  /** The file for a download, after the caller's access was checked. */
  public static async file(id: string) {
    const d = await prismaClient.driverDocuments.findUnique({ where: { id }, include: { driver: { select: { id: true, userId: true, fullName: true } } } });
    if (!d) throw new NotFoundException("Document not found");
    const full = path.join(DOCUMENTS_DIR, d.fileName);
    // Never outside the documents folder, whatever the row says.
    if (!full.startsWith(DOCUMENTS_DIR + path.sep) || !fs.existsSync(full)) throw new NotFoundException("Document file not found");
    return { doc: d, full };
  }

  public static async review(id: string, status: "APPROVED" | "REJECTED", note: string | undefined, reviewerId: string) {
    const d = await prismaClient.driverDocuments.findUnique({ where: { id }, include: { driver: { select: { fullName: true } } } });
    if (!d) throw new NotFoundException("Document not found");
    if (status === "REJECTED" && !note?.trim()) throw new BadRequestException("Write why it was rejected, the driver will see it");
    const row = await prismaClient.driverDocuments.update({
      where: { id },
      data: { status, reviewNote: status === "REJECTED" ? note!.trim() : null, reviewedById: reviewerId, reviewedAt: new Date() },
    });
    return { before: d, after: shape(row), driverName: d.driver.fullName };
  }
}

export default DriverDocumentService;
