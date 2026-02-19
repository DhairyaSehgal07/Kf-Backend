import { Temperature } from './temperature.model.js';
import { ColdStorage } from '../cold-storage/cold-storage.model.js';
import type {
  CreateTemperatureInput,
  UpdateTemperatureInput,
} from './temperature.schema.js';
import {
  NotFoundError,
  ValidationError,
  ForbiddenError,
} from '../../../../utils/errors.js';
import mongoose from 'mongoose';
import type { FastifyBaseLogger } from 'fastify';

/**
 * Create a new temperature record for a cold storage
 */
export async function createTemperature(
  coldStorageId: string,
  payload: CreateTemperatureInput,
  logger?: FastifyBaseLogger
) {
  if (!mongoose.Types.ObjectId.isValid(coldStorageId)) {
    throw new ValidationError('Invalid cold storage ID format', 'INVALID_ID');
  }

  const coldStorage = await ColdStorage.findById(coldStorageId);
  if (!coldStorage) {
    throw new NotFoundError('Cold storage not found', 'COLD_STORAGE_NOT_FOUND');
  }

  const temperature = await Temperature.create({
    coldStorageId: new mongoose.Types.ObjectId(coldStorageId),
    chamber: payload.chamber,
    runningTemperature: payload.runningTemperature,
    date: payload.date,
  });

  logger?.info(
    {
      temperatureId: temperature._id,
      coldStorageId,
      chamber: temperature.chamber,
      date: temperature.date,
    },
    'Temperature record created'
  );

  return temperature;
}

/**
 * Update an existing temperature record (only if it belongs to the user's cold storage)
 */
export async function updateTemperature(
  temperatureId: string,
  coldStorageId: string,
  payload: UpdateTemperatureInput,
  logger?: FastifyBaseLogger
) {
  if (!mongoose.Types.ObjectId.isValid(temperatureId)) {
    throw new ValidationError(
      'Invalid temperature record ID format',
      'INVALID_ID'
    );
  }

  if (!mongoose.Types.ObjectId.isValid(coldStorageId)) {
    throw new ValidationError('Invalid cold storage ID format', 'INVALID_ID');
  }

  const temperature = await Temperature.findById(temperatureId);
  if (!temperature) {
    throw new NotFoundError(
      'Temperature record not found',
      'TEMPERATURE_NOT_FOUND'
    );
  }

  const docColdStorageId = temperature.coldStorageId.toString();
  if (docColdStorageId !== coldStorageId) {
    logger?.warn(
      { temperatureId, coldStorageId, docColdStorageId },
      'Update rejected: temperature record belongs to another cold storage'
    );
    throw new ForbiddenError(
      'You do not have access to this temperature record',
      'COLD_STORAGE_ACCESS_DENIED'
    );
  }

  const update: Partial<UpdateTemperatureInput> = {};
  if (payload.chamber !== undefined) update.chamber = payload.chamber;
  if (payload.runningTemperature !== undefined)
    update.runningTemperature = payload.runningTemperature;
  if (payload.date !== undefined) update.date = payload.date;

  const updated = await Temperature.findByIdAndUpdate(
    temperatureId,
    { $set: update },
    { new: true, runValidators: true }
  ).lean();

  logger?.info(
    { temperatureId, coldStorageId, updatedFields: Object.keys(update) },
    'Temperature record updated'
  );

  return updated;
}
