import mongoose from 'mongoose';
import type { FastifyBaseLogger } from 'fastify';
import { NikasiGatePass } from './nikasi-gate-pass.model.js';
import { AppError, ValidationError } from '../../../../utils/errors.js';

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
