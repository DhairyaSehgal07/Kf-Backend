import { z } from 'zod';
import mongoose from 'mongoose';
import { GatePassStatus } from './incoming-gate-pass.model.js';

const weightSlipSchema = z.object({
  slipNumber: z.string().trim().optional(),
  grossWeightKg: z.number().min(0).optional(),
  tareWeightKg: z.number().min(0).optional(),
});

const gradingSummarySchema = z.object({
  totalGradedBags: z.number().int().min(0).default(0),
});

export const createIncomingGatePassSchema = z.object({
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
      .min(1, 'Variety is required')
      .max(100, 'Variety must not exceed 100 characters'),

    truckNumber: z
      .string()
      .trim()
      .min(1, 'Truck number is required')
      .max(50, 'Truck number must not exceed 50 characters'),

    bagsReceived: z.coerce
      .number()
      .int()
      .min(0, 'Bags received must be non-negative'),

    weightSlip: weightSlipSchema.optional(),

    status: z.nativeEnum(GatePassStatus).default(GatePassStatus.OPEN),

    gradingSummary: gradingSummarySchema.optional(),

    remarks: z
      .string()
      .trim()
      .max(500, 'Remarks must not exceed 500 characters')
      .optional(),
  }),
});

export const updateIncomingGatePassSchema = z.object({
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
    farmerStorageLinkId: z
      .string()
      .trim()
      .min(1, 'Farmer storage link ID is required')
      .refine(
        (val) => mongoose.Types.ObjectId.isValid(val),
        'Invalid farmer storage link ID format'
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

    truckNumber: z
      .string()
      .trim()
      .min(1, 'Truck number is required')
      .max(50, 'Truck number must not exceed 50 characters')
      .optional(),

    bagsReceived: z.coerce
      .number()
      .int()
      .min(0, 'Bags received must be non-negative')
      .optional(),

    weightSlip: weightSlipSchema.optional(),

    status: z.nativeEnum(GatePassStatus).optional(),

    gradingSummary: gradingSummarySchema.optional(),

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

export type CreateIncomingGatePassInput = z.infer<
  typeof createIncomingGatePassSchema
>['body'];

export type UpdateIncomingGatePassInput = z.infer<
  typeof updateIncomingGatePassSchema
>['body'];

export type UpdateIncomingGatePassParams = z.infer<
  typeof updateIncomingGatePassSchema
>['params'];
