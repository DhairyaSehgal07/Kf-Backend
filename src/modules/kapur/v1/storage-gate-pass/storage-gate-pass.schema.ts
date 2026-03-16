import { z } from 'zod';
import mongoose from 'mongoose';
import { BagType } from './storage-gate-pass.model.js';

/* =======================
   Bag size (for create/update)
======================= */

const bagSizeSchema = z.object({
  size: z.string().trim().min(1, 'Size is required'),
  bagType: z.nativeEnum(BagType),
  currentQuantity: z.coerce
    .number()
    .int()
    .min(0, 'Current quantity must be non-negative'),
  initialQuantity: z.coerce
    .number()
    .int()
    .min(0, 'Initial quantity must be non-negative'),
  chamber: z.string().trim().min(1, 'Chamber is required'),
  floor: z.string().trim().min(1, 'Floor is required'),
  row: z.string().trim().min(1, 'Row is required'),
});

/** Single storage gate pass create input (standalone, with bag sizes) */
const singleStorageGatePassCreateSchema = z.object({
  farmerStorageLinkId: z
    .string()
    .trim()
    .min(1, 'Farmer storage link ID is required')
    .refine(
      (val) => mongoose.Types.ObjectId.isValid(val),
      'Invalid farmer storage link ID format'
    ),

  gatePassNo: z.coerce
    .number()
    .int('Gate pass number must be an integer')
    .positive('Gate pass number must be a positive number'),

  manualGatePassNumber: z.coerce
    .number()
    .int('Manual gate pass number must be an integer')
    .positive('Manual gate pass number must be a positive number')
    .optional(),

  date: z.coerce.date(),

  variety: z
    .string()
    .trim()
    .min(1, 'Variety is required')
    .max(100, 'Variety must not exceed 100 characters'),

  storageCategory: z.string().trim().min(1, 'Storage category is required'),

  bagSizes: z.array(bagSizeSchema).min(1, 'At least one bag size is required'),

  remarks: z
    .string()
    .trim()
    .max(500, 'Remarks must not exceed 500 characters')
    .optional(),

  idempotencyKey: z
    .string()
    .trim()
    .min(1, 'Idempotency key must be non-empty if provided')
    .max(128)
    .optional(),
});

/** Create: one request = one storage gate pass */
export const createStorageGatePassSchema = z.object({
  body: singleStorageGatePassCreateSchema,
});

/* =======================
   Bulk create (gatePassNo in payload = starting number; server increments from there per cold storage)
======================= */

export const createBulkStorageGatePassSchema = z.object({
  body: z.object({
    passes: z
      .array(singleStorageGatePassCreateSchema)
      .min(1, 'At least one pass is required'),
  }),
});

export type CreateBulkStorageGatePassBody = z.infer<
  typeof createBulkStorageGatePassSchema
>['body'];

export const updateStorageGatePassSchema = z.object({
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
    gatePassNo: z.coerce
      .number()
      .int('Gate pass number must be an integer')
      .positive('Gate pass number must be a positive number')
      .optional(),

    manualGatePassNumber: z.coerce
      .number()
      .int('Manual gate pass number must be an integer')
      .positive('Manual gate pass number must be a positive number')
      .optional()
      .nullable(),

    date: z.coerce.date().optional(),

    storageCategory: z
      .string()
      .trim()
      .min(1, 'Storage category is required if provided')
      .optional(),

    variety: z
      .string()
      .trim()
      .min(1, 'Variety is required')
      .max(100, 'Variety must not exceed 100 characters')
      .optional(),

    bagSizes: z
      .array(bagSizeSchema)
      .min(1, 'At least one bag size is required')
      .optional(),

    remarks: z
      .string()
      .trim()
      .max(500, 'Remarks must not exceed 500 characters')
      .optional(),

    // Audit fields
    reason: z
      .string()
      .trim()
      .max(500, 'Reason must not exceed 500 characters')
      .optional(),
  }),
});

export type CreateStorageGatePassInput = z.infer<
  typeof singleStorageGatePassCreateSchema
>;

export type CreateStorageGatePassBody = z.infer<
  typeof createStorageGatePassSchema
>['body'];

export type UpdateStorageGatePassInput = z.infer<
  typeof updateStorageGatePassSchema
>['body'];

export type UpdateStorageGatePassParams = z.infer<
  typeof updateStorageGatePassSchema
>['params'];
