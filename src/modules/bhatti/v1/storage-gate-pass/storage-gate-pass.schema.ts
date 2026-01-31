import { z } from 'zod';
import mongoose from 'mongoose';
import { BagType } from '../grading-gate-pass/grading-gate-pass.model';

/* =======================
   Allocation-based Create (from grading gate passes)
======================= */

const allocationSchema = z.object({
  size: z.string().trim().min(1, 'Size is required'),
  quantityToAllocate: z.coerce
    .number()
    .int()
    .min(0, 'Quantity to allocate must be non-negative'),
  chamber: z.string().trim().min(1, 'Chamber is required'),
  floor: z.string().trim().min(1, 'Floor is required'),
  row: z.string().trim().min(1, 'Row is required'),
});

const gradingGatePassAllocationSchema = z.object({
  gradingGatePassId: z
    .string()
    .trim()
    .min(1, 'Grading gate pass ID is required')
    .refine(
      (val) => mongoose.Types.ObjectId.isValid(val),
      'Invalid grading gate pass ID format'
    ),
  allocations: z
    .array(allocationSchema)
    .min(1, 'At least one allocation is required'),
});

/** Single storage gate pass create input (allocations from grading gate passes) */
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

  date: z.coerce.date(),

  variety: z
    .string()
    .trim()
    .min(1, 'Variety is required')
    .max(100, 'Variety must not exceed 100 characters'),

  gradingGatePasses: z
    .array(gradingGatePassAllocationSchema)
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
});

/* =======================
   Update schema (order details for editing existing pass)
======================= */

const orderDetailSchema = z.object({
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
  weightPerBag: z.coerce.number().min(0, 'Weight per bag must be non-negative'),
  chamber: z.string().trim().min(1, 'Chamber is required'),
  floor: z.string().trim().min(1, 'Floor is required'),
  row: z.string().trim().min(1, 'Row is required'),
});

/** Create: one request = one storage gate pass (can reference multiple grading gate passes) */
export const createStorageGatePassSchema = z.object({
  body: singleStorageGatePassCreateSchema,
});

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
    gradingGatePassIds: z
      .array(
        z
          .string()
          .trim()
          .min(1, 'Grading gate pass ID is required')
          .refine(
            (val) => mongoose.Types.ObjectId.isValid(val),
            'Invalid grading gate pass ID format'
          )
      )
      .min(1, 'At least one grading gate pass ID is required')
      .optional(),

    gatePassNo: z.coerce
      .number()
      .int('Gate pass number must be an integer')
      .positive('Gate pass number must be a positive number')
      .optional(),

    date: z.coerce.date().optional(),

    variety: z
      .string()
      .trim()
      .min(1, 'Variety is required')
      .max(100, 'Variety must not exceed 100 characters')
      .optional(),

    orderDetails: z
      .array(orderDetailSchema)
      .min(1, 'At least one order detail is required')
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
