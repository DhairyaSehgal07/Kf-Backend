import { z } from 'zod';
import mongoose from 'mongoose';
import { MoistureStatus } from './outgoing-gate-pass.model.js';

/* =======================
   Create (from storage gate passes)
======================= */

const outgoingAllocationSchema = z.object({
  size: z.string().trim().min(1, 'Size is required'),
  quantityToAllocate: z.coerce
    .number()
    .int()
    .min(0, 'Quantity to allocate must be non-negative'),
  chamber: z.string().trim().min(1, 'Chamber is required'),
  floor: z.string().trim().min(1, 'Floor is required'),
  row: z.string().trim().min(1, 'Row is required'),
});

const outgoingStorageGatePassAllocationSchema = z.object({
  storageGatePassId: z
    .string()
    .trim()
    .min(1, 'Storage gate pass ID is required')
    .refine(
      (val) => mongoose.Types.ObjectId.isValid(val),
      'Invalid storage gate pass ID format'
    ),
  allocations: z
    .array(outgoingAllocationSchema)
    .min(1, 'At least one allocation is required'),
});

export const createOutgoingGatePassSchema = z.object({
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
      .min(1, 'Gate pass number is required'),

    date: z.coerce.date(),

    variety: z
      .string()
      .trim()
      .min(1, 'Variety is required')
      .max(100, 'Variety must not exceed 100 characters'),

    from: z.string().trim().min(1, 'From is required').max(200),
    to: z.string().trim().min(1, 'To is required').max(200),

    truckNumber: z.string().trim().min(1, 'Truck number is required').max(50),

    storageGatePasses: z
      .array(outgoingStorageGatePassAllocationSchema)
      .min(1, 'At least one storage gate pass with allocations is required'),

    defaultStatus: z
      .nativeEnum(MoistureStatus)
      .optional()
      .default(MoistureStatus.DRY),

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

export type CreateOutgoingGatePassBody = z.infer<
  typeof createOutgoingGatePassSchema
>['body'];
