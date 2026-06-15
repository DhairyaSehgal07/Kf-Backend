import { z } from 'zod';
import mongoose from 'mongoose';

const nikasiBagSizeSchema = z.object({
  size: z.string().trim().min(1, 'Size is required'),
  variety: z
    .string()
    .trim()
    .min(1, 'Variety is required')
    .max(100, 'Variety must not exceed 100 characters'),
  quantityIssued: z.coerce
    .number()
    .int()
    .min(0, 'Quantity issued must be non-negative'),
});

export const createNikasiGatePassSchema = z.object({
  farmerStorageLinkId: z
    .string()
    .trim()
    .min(1, 'Farmer storage link ID is required')
    .refine(
      (val) => mongoose.Types.ObjectId.isValid(val),
      'Invalid farmer storage link ID format'
    ),

  dispatchLedgerId: z
    .string()
    .trim()
    .min(1, 'Dispatch ledger ID is required')
    .refine(
      (val) => mongoose.Types.ObjectId.isValid(val),
      'Invalid dispatch ledger ID format'
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

  isBooked: z.boolean().optional(),

  billNumber: z.coerce
    .number()
    .int('Bill number must be an integer')
    .positive('Bill number must be a positive number'),

  bitliNumber: z.coerce
    .number()
    .int('Bitli number must be an integer')
    .positive('Bitli number must be a positive number'),

  billBook: z.coerce
    .number()
    .int('Bill book must be an integer')
    .positive('Bill book must be a positive number')
    .optional(),

  biltiBook: z.coerce
    .number()
    .int('Bilti book must be an integer')
    .positive('Bilti book must be a positive number')
    .optional(),

  category: z.string().trim().min(1, 'Category is required'),

  date: z.coerce.date(),

  from: z.string().trim().min(1, 'From location is required'),

  to: z.string().trim().optional(),

  truckNumber: z
    .string()
    .trim()
    .max(50, 'Truck number must not exceed 50 characters')
    .optional(),

  bagSize: z
    .array(nikasiBagSizeSchema)
    .min(1, 'At least one bag size is required'),

  remarks: z
    .string()
    .trim()
    .max(500, 'Remarks must not exceed 500 characters')
    .optional(),

  netWeight: z.coerce.number().optional(),

  averageWeightPerBag: z.coerce.number().optional(),

  idempotencyKey: z
    .string()
    .trim()
    .min(1, 'Idempotency key must be non-empty if provided')
    .max(128)
    .optional(),
});

export type CreateNikasiGatePassInput = z.infer<
  typeof createNikasiGatePassSchema
>;

export const searchNikasiGatePassSchema = z.object({
  body: z.object({
    number: z.coerce
      .number()
      .int('Number must be an integer')
      .positive('Number must be a positive number'),
  }),
});

export type SearchNikasiGatePassInput = z.infer<
  typeof searchNikasiGatePassSchema
>['body'];
