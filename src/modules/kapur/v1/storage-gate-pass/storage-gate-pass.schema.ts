import { z } from 'zod';
import mongoose from 'mongoose';
import { BagType } from './storage-gate-pass.model.js';

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

export const createStorageGatePassSchema = z.object({
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

export type CreateStorageGatePassInput = z.infer<
  typeof createStorageGatePassSchema
>;
