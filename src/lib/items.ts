import { z } from "zod";

// Mirrors the content_items CHECK constraints in 0001_init.sql. Shared by the paste form and the file upload route.
export const itemFields = z.object({
  title: z.string().trim().min(1, "Give the item a title").max(200),
  channel: z.string().trim().min(1).max(60),
  audience: z.string().trim().max(120),
  goal: z.string().trim().max(300, "Keep the goal to one line (300 characters)"),
  publish_date: z.iso.date({ message: "Choose the planned publish date" }),
  reviewer: z.uuid("Choose a reviewer before saving"),
});

export const ACCEPT = ".pdf,.docx,.png,.jpg,.jpeg,.webp";
export const EXT_MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};
export const extOf = (name: string) => (/\.[a-z0-9]+$/i.exec(name)?.[0] ?? "").toLowerCase();
