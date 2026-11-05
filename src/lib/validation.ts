import { z } from 'zod';
export const registerSchema = z.object({ name: z.string().trim().min(2).max(60), email: z.email(), password: z.string().min(8).max(100) });
export const loginSchema = z.object({ email: z.email(), password: z.string().min(8).max(100) });
export const workspaceSchema = z.object({ name: z.string().trim().min(2).max(80) });
export const pageSchema = z.object({ title: z.string().trim().min(1).max(120), type: z.enum(['DOC', 'BOARD']).default('DOC') });
export const commentSchema = z.object({ body: z.string().trim().min(1).max(2000) });
export const workspaceRoles = ['OWNER', 'EDITOR', 'COMMENTER', 'VIEWER'] as const;
export const memberSchema = z.object({ email: z.email(), role: z.enum(workspaceRoles).default('EDITOR') });
export const memberRoleSchema = z.object({ role: z.enum(workspaceRoles) });
