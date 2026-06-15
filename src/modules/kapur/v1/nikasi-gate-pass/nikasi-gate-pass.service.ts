import mongoose, { ClientSession, Types } from 'mongoose';
import type { FastifyBaseLogger } from 'fastify';
import {
  NikasiGatePass,
  type INikasiGatePass,
} from './nikasi-gate-pass.model.js';
import { Booking } from '../booking/booking.model.js';
import { DispatchLedger } from '../dispatch-ledger/dispatch-ledger.model.js';
import type { CreateNikasiGatePassInput } from './nikasi-gate-pass.schema.js';
import {
  AppError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../../../utils/errors.js';

/** Safety cap for exact-number search results within a cold storage */
const NIKASI_GATE_PASS_SEARCH_RESULT_LIMIT = 100;

export interface NikasiGatePassDateFilters {
  dateFrom?: string;
  dateTo?: string;
}

export interface GetPaginatedNikasiGatePassesByColdStorageOptions extends NikasiGatePassDateFilters {
  limit?: number;
  page?: number;
  sortOrder?: 'asc' | 'desc';
}

export interface NikasiGatePassesPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface BookingBagSizeLean {
  size: string;
  variety: string;
  currentQuantity: number;
}

interface BookingLean {
  _id: Types.ObjectId;
  bagSizes: BookingBagSizeLean[];
}

interface BookingDeduction {
  bookingId: Types.ObjectId;
  size: string;
  variety: string;
  deductAmount: number;
}

interface RequestedBagLine {
  size: string;
  variety: string;
  quantityIssued: number;
}

function bagLineKey(size: string, variety: string): string {
  return `${size}::${variety}`;
}

function handleServiceError(error: unknown, logger?: FastifyBaseLogger): never {
  if (
    error instanceof ConflictError ||
    error instanceof ValidationError ||
    error instanceof NotFoundError ||
    error instanceof AppError
  ) {
    throw error;
  }

  if (error instanceof mongoose.Error.ValidationError) {
    const messages = Object.values(error.errors).map((e) => e.message);
    throw new ValidationError(messages.join(', '), 'MONGOOSE_VALIDATION_ERROR');
  }

  const err = error as Error & {
    code?: number;
    keyPattern?: Record<string, unknown>;
  };
  if (err?.code === 11000) {
    const field = Object.keys(err.keyPattern ?? {})[0] ?? 'field';
    throw new ConflictError(`${field} already exists`, 'DUPLICATE_KEY_ERROR');
  }

  logger?.error({ err: error }, 'Unexpected error in nikasi gate pass service');
  throw new AppError(
    'Failed to process nikasi gate pass request',
    500,
    'NIKASI_GATE_PASS_ERROR'
  );
}

function computeFifoBookingDeductions(
  bookings: BookingLean[],
  lines: RequestedBagLine[]
): BookingDeduction[] {
  const aggregated = new Map<
    string,
    { size: string; variety: string; total: number }
  >();

  for (const line of lines) {
    const key = bagLineKey(line.size, line.variety);
    const existing = aggregated.get(key);
    if (existing) {
      existing.total += line.quantityIssued;
    } else {
      aggregated.set(key, {
        size: line.size,
        variety: line.variety,
        total: line.quantityIssued,
      });
    }
  }

  const deductions: BookingDeduction[] = [];

  for (const { size, variety, total } of aggregated.values()) {
    if (total <= 0) {
      continue;
    }

    let remaining = total;
    let available = 0;

    for (const booking of bookings) {
      if (remaining <= 0) {
        break;
      }

      const bag = booking.bagSizes.find(
        (entry) => entry.size === size && entry.variety === variety
      );
      if (!bag || bag.currentQuantity <= 0) {
        continue;
      }

      available += bag.currentQuantity;
      const deductAmount = Math.min(remaining, bag.currentQuantity);
      deductions.push({
        bookingId: booking._id,
        size,
        variety,
        deductAmount,
      });
      remaining -= deductAmount;
    }

    if (remaining > 0) {
      throw new ValidationError(
        `Insufficient booked quantity for size "${size}" variety "${variety}": requested ${total}, available ${available}`,
        'INSUFFICIENT_BOOKING_STOCK'
      );
    }
  }

  return deductions;
}

function prepareBookingBulkOps(
  deductions: BookingDeduction[]
): mongoose.mongo.AnyBulkWriteOperation<typeof Booking.prototype>[] {
  const bulkOps: Array<{
    updateOne: {
      filter: Record<string, unknown>;
      update: Record<string, unknown>;
      arrayFilters?: Array<Record<string, unknown>>;
    };
  }> = [];

  for (const deduction of deductions) {
    bulkOps.push({
      updateOne: {
        filter: { _id: deduction.bookingId },
        update: {
          $inc: {
            'bagSizes.$[elem].currentQuantity': -deduction.deductAmount,
          },
        },
        arrayFilters: [
          {
            'elem.size': deduction.size,
            'elem.variety': deduction.variety,
            'elem.currentQuantity': { $gte: deduction.deductAmount },
          },
        ],
      },
    });
  }

  return bulkOps as mongoose.mongo.AnyBulkWriteOperation<
    typeof Booking.prototype
  >[];
}

async function applyBookingFifoDeductions(
  dispatchLedgerId: string,
  lines: RequestedBagLine[],
  session: ClientSession
): Promise<void> {
  const bookings = await Booking.find({
    dispatchLedgerId: new Types.ObjectId(dispatchLedgerId),
  })
    .sort({ date: 1, gatePassNo: 1 })
    .select('bagSizes')
    .session(session)
    .lean<BookingLean[]>();

  const deductions = computeFifoBookingDeductions(bookings, lines);
  if (deductions.length === 0) {
    return;
  }

  const bulkOps = prepareBookingBulkOps(deductions);
  const updateResult = await Booking.bulkWrite(
    bulkOps as Parameters<typeof Booking.bulkWrite>[0],
    { session }
  );

  if (updateResult.modifiedCount !== bulkOps.length) {
    throw new ConflictError(
      `Expected ${bulkOps.length} booking updates, got ${updateResult.modifiedCount}. Concurrent modification detected.`,
      'CONCURRENT_MODIFICATION'
    );
  }
}

/**
 * Creates a nikasi gate pass. When isBooked is true, deducts quantities from
 * booking gate passes for the dispatch ledger using FIFO (date asc, gatePassNo asc).
 */
export async function createNikasiGatePass(
  coldStorageId: string,
  payload: CreateNikasiGatePassInput,
  logger?: FastifyBaseLogger,
  createdBy?: string
): Promise<INikasiGatePass> {
  if (!mongoose.Types.ObjectId.isValid(coldStorageId)) {
    throw new ValidationError(
      'Invalid cold storage ID format',
      'INVALID_COLD_STORAGE_ID'
    );
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    logger?.info(
      {
        bagSizeCount: payload.bagSize.length,
        gatePassNo: payload.gatePassNo,
        date: payload.date,
        isBooked: payload.isBooked ?? false,
      },
      'Starting nikasi gate pass create'
    );

    if (payload.idempotencyKey) {
      const existing = await NikasiGatePass.findOne({
        idempotencyKey: payload.idempotencyKey,
      })
        .session(session)
        .lean();

      if (existing) {
        logger?.info(
          {
            idempotencyKey: payload.idempotencyKey,
            nikasiGatePassId: existing._id,
          },
          'Idempotency: returning existing nikasi gate pass'
        );
        await session.commitTransaction();
        return existing as INikasiGatePass;
      }
    }

    const dispatchLedger = await DispatchLedger.findOne({
      _id: new Types.ObjectId(payload.dispatchLedgerId),
      coldStorageId: new Types.ObjectId(coldStorageId),
    })
      .session(session)
      .lean();

    if (!dispatchLedger) {
      throw new NotFoundError(
        'Dispatch ledger not found',
        'DISPATCH_LEDGER_NOT_FOUND'
      );
    }

    if (payload.isBooked) {
      await applyBookingFifoDeductions(
        payload.dispatchLedgerId,
        payload.bagSize,
        session
      );
    }

    const nikasiGatePass = new NikasiGatePass({
      farmerStorageLinkId: new Types.ObjectId(payload.farmerStorageLinkId),
      dispatchLedgerId: new Types.ObjectId(payload.dispatchLedgerId),
      ...(createdBy && { createdBy: new Types.ObjectId(createdBy) }),
      gatePassNo: payload.gatePassNo,
      ...(payload.manualGatePassNumber !== undefined && {
        manualGatePassNumber: payload.manualGatePassNumber,
      }),
      ...(payload.isBooked !== undefined && { isBooked: payload.isBooked }),
      billNumber: payload.billNumber,
      bitliNumber: payload.bitliNumber,
      ...(payload.billBook !== undefined && { billBook: payload.billBook }),
      ...(payload.biltiBook !== undefined && { biltiBook: payload.biltiBook }),
      category: payload.category,
      date: payload.date,
      from: payload.from,
      ...(payload.to !== undefined && { to: payload.to }),
      ...(payload.truckNumber !== undefined && {
        truckNumber: payload.truckNumber,
      }),
      bagSize: payload.bagSize,
      ...(payload.remarks !== undefined && { remarks: payload.remarks }),
      ...(payload.netWeight !== undefined && { netWeight: payload.netWeight }),
      ...(payload.averageWeightPerBag !== undefined && {
        averageWeightPerBag: payload.averageWeightPerBag,
      }),
      ...(payload.idempotencyKey !== undefined && {
        idempotencyKey: payload.idempotencyKey,
      }),
    });

    await nikasiGatePass.save({ session });
    await session.commitTransaction();
    return nikasiGatePass;
  } catch (error) {
    await session.abortTransaction().catch(() => {});
    handleServiceError(error, logger);
  } finally {
    session.endSession();
  }
}

/**
 * Retrieves nikasi gate passes for a cold storage with pagination.
 */
export async function getPaginatedNikasiGatePassesByColdStorage(
  coldStorageId: string,
  options: GetPaginatedNikasiGatePassesByColdStorageOptions = {},
  logger?: FastifyBaseLogger
): Promise<{
  nikasiGatePasses: Array<Record<string, unknown>>;
  pagination: NikasiGatePassesPagination;
}> {
  try {
    if (!mongoose.Types.ObjectId.isValid(coldStorageId)) {
      throw new ValidationError(
        'Invalid cold storage ID format',
        'INVALID_COLD_STORAGE_ID'
      );
    }

    const limit = Math.min(Math.max(options.limit ?? 10, 1), 5000);
    const page = Math.max(options.page ?? 1, 1);
    const sortOrder = options.sortOrder ?? 'desc';
    const sortDir = sortOrder === 'desc' ? -1 : 1;

    const coldStorageObjectId = new mongoose.Types.ObjectId(coldStorageId);

    const FarmerStorageLink = mongoose.model('FarmerStorageLink');
    const farmerStorageLinkIds = await FarmerStorageLink.find({
      coldStorageId: coldStorageObjectId,
    })
      .distinct('_id')
      .lean();

    const match: Record<string, unknown> = {
      farmerStorageLinkId: { $in: farmerStorageLinkIds },
    };

    if (options.dateFrom) {
      const start = new Date(options.dateFrom);
      if (Number.isNaN(start.getTime())) {
        throw new ValidationError(
          'Invalid dateFrom format; use YYYY-MM-DD',
          'INVALID_DATE_FROM'
        );
      }
      start.setUTCHours(0, 0, 0, 0);
      match.date = (match.date as Record<string, unknown>) ?? {};
      (match.date as Record<string, unknown>).$gte = start;
    }

    if (options.dateTo) {
      const end = new Date(options.dateTo);
      if (Number.isNaN(end.getTime())) {
        throw new ValidationError(
          'Invalid dateTo format; use YYYY-MM-DD',
          'INVALID_DATE_TO'
        );
      }
      end.setUTCHours(23, 59, 59, 999);
      match.date = (match.date as Record<string, unknown>) ?? {};
      (match.date as Record<string, unknown>).$lte = end;
    }

    const [total, nikasiGatePasses] = await Promise.all([
      NikasiGatePass.countDocuments(match),
      NikasiGatePass.find(match)
        .populate({
          path: 'farmerStorageLinkId',
          select: 'accountNumber farmerId linkedById',
          populate: [
            { path: 'farmerId', select: 'name mobileNumber address' },
            { path: 'linkedById', select: 'name' },
          ],
        })
        .populate({
          path: 'dispatchLedgerId',
          select: 'name address mobileNumber',
        })
        .populate({ path: 'createdBy', select: 'name' })
        .sort({ gatePassNo: sortDir, date: sortDir })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    const totalPages = Math.ceil(total / limit);

    logger?.info(
      {
        coldStorageId,
        count: nikasiGatePasses.length,
        total,
        page,
        limit,
      },
      'Retrieved paginated nikasi gate passes by cold storage'
    );

    return {
      nikasiGatePasses: nikasiGatePasses as unknown as Array<
        Record<string, unknown>
      >,
      pagination: { page, limit, total, totalPages },
    };
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }

    logger?.error(
      { error, coldStorageId },
      'Error retrieving paginated nikasi gate passes by cold storage'
    );

    throw new AppError(
      'Failed to retrieve nikasi gate passes',
      500,
      'GET_NIKASI_GATE_PASSES_ERROR'
    );
  }
}

/**
 * Searches nikasi gate passes within a cold storage by exact gate pass number.
 * Matches documents where `number` equals gatePassNo, manualGatePassNumber,
 * billNumber, bitliNumber, billBook, or biltiBook.
 */
export async function searchNikasiGatePassesByNumber(
  coldStorageId: string,
  number: number,
  logger?: FastifyBaseLogger
): Promise<{ nikasiGatePasses: Array<Record<string, unknown>> }> {
  try {
    if (!mongoose.Types.ObjectId.isValid(coldStorageId)) {
      throw new ValidationError(
        'Invalid cold storage ID format',
        'INVALID_COLD_STORAGE_ID'
      );
    }

    const coldStorageObjectId = new mongoose.Types.ObjectId(coldStorageId);

    const FarmerStorageLink = mongoose.model('FarmerStorageLink');
    const farmerStorageLinkIds = await FarmerStorageLink.find({
      coldStorageId: coldStorageObjectId,
    })
      .distinct('_id')
      .lean();

    if (farmerStorageLinkIds.length === 0) {
      return { nikasiGatePasses: [] };
    }

    const filter = {
      $and: [
        { farmerStorageLinkId: { $in: farmerStorageLinkIds } },
        {
          $or: [
            { gatePassNo: number },
            { manualGatePassNumber: number },
            { billNumber: number },
            { bitliNumber: number },
            { billBook: number },
            { biltiBook: number },
          ],
        },
      ],
    };

    const nikasiGatePasses = await NikasiGatePass.find(filter)
      .populate({
        path: 'farmerStorageLinkId',
        select: 'accountNumber farmerId linkedById',
        populate: [
          { path: 'farmerId', select: 'name mobileNumber address' },
          { path: 'linkedById', select: 'name' },
        ],
      })
      .populate({
        path: 'dispatchLedgerId',
        select: 'name address mobileNumber',
      })
      .populate({ path: 'createdBy', select: 'name' })
      .sort({ gatePassNo: -1, date: -1 })
      .limit(NIKASI_GATE_PASS_SEARCH_RESULT_LIMIT)
      .lean();

    logger?.info(
      { coldStorageId, number, count: nikasiGatePasses.length },
      'Searched nikasi gate passes by number'
    );

    return {
      nikasiGatePasses: nikasiGatePasses as unknown as Array<
        Record<string, unknown>
      >,
    };
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }

    logger?.error(
      { error, coldStorageId, number },
      'Error searching nikasi gate passes by number'
    );

    throw new AppError(
      'Failed to search nikasi gate passes',
      500,
      'SEARCH_NIKASI_GATE_PASSES_ERROR'
    );
  }
}
