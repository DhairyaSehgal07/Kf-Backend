import { z } from 'zod';
import mongoose from 'mongoose';

/* =======================
   Create (from grading gate passes)
======================= */

const nikasiAllocationSchema = z.object({
  size: z.string().trim().min(1, 'Size is required'),
  quantityToAllocate: z.coerce
    .number()
    .int()
    .min(0, 'Quantity to allocate must be non-negative'),
});

const nikasiGradingGatePassAllocationSchema = z.object({
  gradingGatePassId: z
    .string()
    .trim()
    .min(1, 'Grading gate pass ID is required')
    .refine(
      (val) => mongoose.Types.ObjectId.isValid(val),
      'Invalid grading gate pass ID format'
    ),
  variety: z
    .string()
    .trim()
    .min(1, 'Variety is required for each grading gate pass')
    .max(100, 'Variety must not exceed 100 characters'),
  allocations: z
    .array(nikasiAllocationSchema)
    .min(1, 'At least one allocation is required'),
});

export const createNikasiGatePassSchema = z.object({
  body: z.object({
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
      .max(100, 'Variety must not exceed 100 characters')
      .optional(),

    from: z.string().trim().min(1, 'From is required').max(200),
    toField: z.string().trim().min(1, 'To is required').max(200),

    gradingGatePasses: z
      .array(nikasiGradingGatePassAllocationSchema)
      .min(1, 'At least one grading gate pass with allocations is required'),

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
  }),
});

export type CreateNikasiGatePassBody = z.infer<
  typeof createNikasiGatePassSchema
>['body'];

/* =======================
   Bulk create
======================= */

export const createBulkNikasiGatePassSchema = z.object({
  body: z.object({
    passes: z
      .array(createNikasiGatePassSchema.shape.body)
      .min(1, 'At least one pass is required'),
  }),
});

export type CreateBulkNikasiGatePassBody = z.infer<
  typeof createBulkNikasiGatePassSchema
>['body'];
