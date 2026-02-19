import { z } from 'zod';
import mongoose from 'mongoose';

export const createTemperatureBodySchema = z.object({
  body: z.object({
    chamber: z
      .string()
      .trim()
      .min(1, 'Chamber is required')
      .max(100, 'Chamber must not exceed 100 characters'),

    runningTemperature: z.number({
      message: 'Running temperature is required and must be a number',
    }),

    date: z.coerce.date({
      message: 'Date is required and must be a valid date',
    }),
  }),
});

export const updateTemperatureParamsSchema = z.object({
  params: z.object({
    id: z
      .string()
      .trim()
      .min(1, 'Temperature record ID is required')
      .refine(
        (val) => mongoose.Types.ObjectId.isValid(val),
        'Invalid temperature record ID format'
      ),
  }),
});

export const updateTemperatureBodySchema = z.object({
  body: z
    .object({
      chamber: z
        .string()
        .trim()
        .min(1, 'Chamber must not be empty')
        .max(100, 'Chamber must not exceed 100 characters')
        .optional(),

      runningTemperature: z
        .number({ message: 'Running temperature must be a number' })
        .optional(),

      date: z.coerce.date({ message: 'Date must be a valid date' }).optional(),
    })
    .refine(
      (data) =>
        data.chamber !== undefined ||
        data.runningTemperature !== undefined ||
        data.date !== undefined,
      {
        message:
          'At least one field (chamber, runningTemperature, date) must be provided for update',
      }
    ),
});

export type CreateTemperatureInput = z.infer<
  typeof createTemperatureBodySchema
>['body'];

export type UpdateTemperatureParams = z.infer<
  typeof updateTemperatureParamsSchema
>['params'];

export type UpdateTemperatureInput = z.infer<
  typeof updateTemperatureBodySchema
>['body'];
