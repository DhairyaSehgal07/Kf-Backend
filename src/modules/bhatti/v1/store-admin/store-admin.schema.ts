import { z } from 'zod';
import { Role } from './store-admin.model';
import mongoose from 'mongoose';

export const createStoreAdminSchema = z.object({
  body: z.object({
    coldStorageId: z
      .string()
      .trim()
      .min(1, 'Cold storage ID is required')
      .refine(
        (val) => mongoose.Types.ObjectId.isValid(val),
        'Invalid cold storage ID format'
      ),

    name: z
      .string()
      .trim()
      .min(2, 'Name must be at least 2 characters long')
      .max(100, 'Name must not exceed 100 characters'),

    mobileNumber: z
      .string()
      .trim()
      .regex(
        /^[6-9]\d{9}$/,
        'Mobile number must be a valid 10-digit Indian mobile number'
      ),

    password: z
      .string()
      .min(6, 'Password must be at least 6 characters long')
      .max(100, 'Password must not exceed 100 characters'),

    role: z.nativeEnum(Role).default(Role.Manager),

    isVerified: z.boolean().optional().default(false),
  }),
});

export const getStoreAdminsQuerySchema = z.object({
  querystring: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(10),
    sortBy: z
      .enum(['createdAt', 'name', 'role', 'mobileNumber'])
      .default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
    coldStorageId: z
      .string()
      .trim()
      .refine(
        (val) => !val || mongoose.Types.ObjectId.isValid(val),
        'Invalid cold storage ID format'
      )
      .optional(),
    role: z.nativeEnum(Role).optional(),
    isVerified: z.coerce.boolean().optional(),
    search: z.string().trim().optional(),
  }),
});

export const getStoreAdminByIdParamsSchema = z.object({
  params: z.object({
    id: z
      .string()
      .trim()
      .min(1, 'ID is required')
      .refine(
        (val) => mongoose.Types.ObjectId.isValid(val),
        'Invalid ID format'
      ),
  }),
});

export const updateStoreAdminSchema = z.object({
  params: z.object({
    id: z
      .string()
      .trim()
      .min(1, 'ID is required')
      .refine(
        (val) => mongoose.Types.ObjectId.isValid(val),
        'Invalid ID format'
      ),
  }),
  body: z.object({
    name: z
      .string()
      .trim()
      .min(2, 'Name must be at least 2 characters long')
      .max(100, 'Name must not exceed 100 characters')
      .optional(),

    mobileNumber: z
      .string()
      .trim()
      .regex(
        /^[6-9]\d{9}$/,
        'Mobile number must be a valid 10-digit Indian mobile number'
      )
      .optional(),

    password: z
      .string()
      .min(6, 'Password must be at least 6 characters long')
      .max(100, 'Password must not exceed 100 characters')
      .optional(),

    role: z.nativeEnum(Role).optional(),

    isVerified: z.boolean().optional(),
  }),
});

export const deleteStoreAdminParamsSchema = z.object({
  params: z.object({
    id: z
      .string()
      .trim()
      .min(1, 'ID is required')
      .refine(
        (val) => mongoose.Types.ObjectId.isValid(val),
        'Invalid ID format'
      ),
  }),
});

export type CreateStoreAdminInput = z.infer<
  typeof createStoreAdminSchema
>['body'];

export type GetStoreAdminsQuery = z.infer<
  typeof getStoreAdminsQuerySchema
>['querystring'];

export type GetStoreAdminByIdParams = z.infer<
  typeof getStoreAdminByIdParamsSchema
>['params'];

export type UpdateStoreAdminInput = z.infer<
  typeof updateStoreAdminSchema
>['body'];

export type UpdateStoreAdminParams = z.infer<
  typeof updateStoreAdminSchema
>['params'];

export type DeleteStoreAdminParams = z.infer<
  typeof deleteStoreAdminParamsSchema
>['params'];
