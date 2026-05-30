import { z } from 'zod';

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
