import { z } from "zod";

export const createFolderSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80, "Name is too long"),
});

export const renameFolderSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80, "Name is too long"),
});

export const folderParamsSchema = z.object({
  id: z.string().min(1, "workspace id is required"),
  folderId: z.string().min(1, "folder id is required"),
});

export type CreateFolderInput = z.infer<typeof createFolderSchema>;
export type RenameFolderInput = z.infer<typeof renameFolderSchema>;
