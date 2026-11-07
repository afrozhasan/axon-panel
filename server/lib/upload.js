import multer from "multer";
import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../config.js";

export const UPLOAD_DIR = `${loadConfig().backupDir}/uploads`;

function ensureUploadDir() {
  if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true, mode: 0o700 });
  return UPLOAD_DIR;
}

const storage = multer.diskStorage({
  destination: (_req, _file, done) => {
    try {
      done(null, ensureUploadDir());
    } catch (error) {
      done(error);
    }
  },
  filename: (_req, file, done) => {
    const safe = path.basename(file.originalname).replace(/[^A-Za-z0-9._-]/g, "_").slice(-120);
    done(null, `${Date.now()}-${safe || "upload.bin"}`);
  },
});

export const upload = multer({
  storage,
  limits: { fileSize: loadConfig().maxUploadMb * 1024 * 1024, files: 50 },
});

export function ensureUploadDirExists() {
  return ensureUploadDir();
}
