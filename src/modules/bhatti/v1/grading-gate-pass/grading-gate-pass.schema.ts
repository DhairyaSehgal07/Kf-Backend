import { z } from 'zod';
import mongoose from 'mongoose';
import { BagType, AllocationStatus } from './grading-gate-pass.model.js';

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
  weightPerBagKg: z.coerce
    .number()
    .min(0, 'Weight per bag must be non-negative'),
});

export const createGradingGatePassSchema = z.object({
  body: z.object({
    farmerStorageLinkId: z
      .string()
      .trim()
      .min(1, 'Farmer storage link ID is required')
      .refine(
        (val) => mongoose.Types.ObjectId.isValid(val),
        'Invalid farmer storage link ID format'
      ),

    incomingGatePassId: z
      .string()
      .trim()
      .min(1, 'Incoming gate pass ID is required')
      .refine(
        (val) => mongoose.Types.ObjectId.isValid(val),
        'Invalid incoming gate pass ID format'
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

    orderDetails: z
      .array(orderDetailSchema)
      .min(1, 'At least one order detail is required'),

    allocationStatus: z
      .nativeEnum(AllocationStatus)
      .default(AllocationStatus.UNALLOCATED),

    remarks: z
      .string()
      .trim()
      .max(500, 'Remarks must not exceed 500 characters')
      .optional(),
  }),
});

export const updateGradingGatePassSchema = z.object({
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
    incomingGatePassId: z
      .string()
      .trim()
      .min(1, 'Incoming gate pass ID is required')
      .refine(
        (val) => mongoose.Types.ObjectId.isValid(val),
        'Invalid incoming gate pass ID format'
      )
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

    allocationStatus: z.nativeEnum(AllocationStatus).optional(),

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

export type CreateGradingGatePassInput = z.infer<
  typeof createGradingGatePassSchema
>['body'];

export type UpdateGradingGatePassInput = z.infer<
  typeof updateGradingGatePassSchema
>['body'];

export type UpdateGradingGatePassParams = z.infer<
  typeof updateGradingGatePassSchema
>['params'];

export const getGradingGatePassesByFarmerStorageLinkSchema = z.object({
  params: z.object({
    farmerStorageLinkId: z
      .string()
      .trim()
      .min(1, 'Farmer storage link ID is required')
      .refine(
        (val) => mongoose.Types.ObjectId.isValid(val),
        'Invalid farmer storage link ID format'
      ),
  }),
});

export type GetGradingGatePassesByFarmerStorageLinkParams = z.infer<
  typeof getGradingGatePassesByFarmerStorageLinkSchema
>['params'];
