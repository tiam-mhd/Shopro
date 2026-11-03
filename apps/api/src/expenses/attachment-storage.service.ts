import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { lstat, mkdir, open, readFile, unlink } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { MAX_ATTACHMENT_BYTES } from "./attachment-files.js";

const STORAGE_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:pdf|jpg|png|webp)$/i;

@Injectable()
export class AttachmentStorageService {
  async save(storageKey: string, bytes: Buffer) {
    const filePath = await this.filePath(storageKey, true);
    if (!bytes.byteLength || bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new Error("Invalid attachment length.");
    const handle = await open(filePath, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
    } catch (error) {
      await handle.close().catch(() => undefined);
      await unlink(filePath).catch(() => undefined);
      throw error;
    }
    await handle.close();
  }

  async read(storageKey: string) {
    const filePath = await this.filePath(storageKey, false);
    const details = await lstat(filePath);
    if (!details.isFile() || details.isSymbolicLink() || details.size > MAX_ATTACHMENT_BYTES) throw new Error("Stored attachment is invalid.");
    return readFile(filePath);
  }

  async remove(storageKey: string) {
    const filePath = await this.filePath(storageKey, false);
    await unlink(filePath);
  }

  private async filePath(storageKey: string, createRoot: boolean) {
    if (!STORAGE_KEY_PATTERN.test(storageKey)) throw new Error("Invalid attachment storage key.");
    const configured = process.env.ATTACHMENT_STORAGE_DIR?.trim();
    if (!configured || !isAbsolute(configured)) {
      throw new ServiceUnavailableException("فضای نگهداری خصوصی پیوست‌ها تنظیم نشده است.");
    }
    const root = resolve(configured);
    this.assertOutsidePublicRoots(root);
    if (createRoot) await mkdir(root, { recursive: true, mode: 0o700 });
    const rootInfo = await lstat(root).catch(() => null);
    if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink()) throw new ServiceUnavailableException("مسیر خصوصی نگهداری پیوست‌ها در دسترس نیست.");
    return join(root, storageKey);
  }

  private assertOutsidePublicRoots(root: string) {
    const publicRoots = [resolve(process.cwd(), "apps/web/public"), resolve(process.cwd(), "apps/web/dist")];
    for (const publicRoot of publicRoots) {
      const fromPublic = relative(publicRoot, root);
      if (fromPublic === "" || (fromPublic !== ".." && !fromPublic.startsWith(`..${sep}`) && !isAbsolute(fromPublic))) {
        throw new ServiceUnavailableException("مسیر پیوست‌ها نباید در پوشهٔ فایل‌های عمومی وب باشد.");
      }
    }
  }
}
