import { z } from 'zod';
import mongoose from 'mongoose';

const locationSchema = z.object({
  chamber: z.string().trim().min(1, 'Chamber is required'),
  floor: z.string().trim().min(1, 'Floor is required'),
  row: z.string().trim().min(1, 'Row is required'),
});

const bagSizeSchema = z.object({
  name: z.string().trim().min(1, 'Bag size name is required'),
  initialQuantity: z.coerce
    .number()
    .int()
    .min(0, 'Initial quantity must be non-negative'),
  currentQuantity: z.coerce
    .number()
    .int()
    .min(0, 'Current quantity must be non-negative'),
  location: locationSchema,
  paltaiLocation: locationSchema.optional(),
});

export const createRentalStorageGatePassSchema = z.object({
  body: z.object({
    farmerStorageLinkId: z
      .string()
      .trim()
      .min(1, 'Farmer storage link ID is required')
      .refine(
        (val) => mongoose.Types.ObjectId.isValid(val),
        'Invalid farmer storage link ID format'
      ),

    date: z.coerce.date(),

    variety: z.string().trim().min(1, 'Variety is required'),

    truckNumber: z.string().trim().optional(),

    bagSizes: z
      .array(bagSizeSchema)
      .min(1, 'At least one bag size is required'),

    remarks: z.string().trim().optional(),

    manualRentalGatePassNumber: z.string().trim().optional(),

    amount: z.coerce
      .number()
      .positive('Amount must be greater than 0')
      .optional(),

    coldStorageId: z
      .string()
      .trim()
      .refine(
        (val) => !val || mongoose.Types.ObjectId.isValid(val),
        'Invalid cold storage ID format'
      )
      .optional(),

    createdById: z
      .string()
      .trim()
      .refine(
        (val) => !val || mongoose.Types.ObjectId.isValid(val),
        'Invalid createdById format'
      )
      .optional(),
  }),
});

export type CreateRentalStorageGatePassInput = z.infer<
  typeof createRentalStorageGatePassSchema
>['body'];
