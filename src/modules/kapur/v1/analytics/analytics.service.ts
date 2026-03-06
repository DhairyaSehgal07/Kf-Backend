import mongoose from 'mongoose';
import type { FastifyBaseLogger } from 'fastify';
import { IncomingGatePass } from '../incoming-gate-pass/incoming-gate-pass.model.js';
import { GradingGatePass } from '../grading-gate-pass/grading-gate-pass.model.js';
import { BagType } from '../grading-gate-pass/grading-gate-pass.model.js';
import { FarmerStorageLink } from '../farmer-storage-link/farmer-storage-link.model.js';
import { StorageGatePass } from '../storage-gate-pass/storage-gate-pass.model.js';
import { OutgoingGatePass } from '../outgoing-gate-pass/outgoing-gate-pass.model.js';
import { NikasiGatePass } from '../nikasi-gate-pass/nikasi-gate-pass.model.js';
import { ValidationError, AppError } from '../../../../utils/errors.js';

/** Bag type tare weight in kg (weight of empty bag) */
const BAG_TYPE_WEIGHT_KG: Record<BagType, number> = {
  [BagType.JUTE]: 0.7,
  [BagType.LENO]: 0.06,
};

export interface OverviewDateFilters {
  dateFrom?: string; // ISO date YYYY-MM-DD, start of day
  dateTo?: string; // ISO date YYYY-MM-DD, end of day
}

export interface OverviewResult {
  totalIncomingBags: number;
  totalIncomingWeight: number;
  totalUngradedBags: number;
  totalUngradedWeight: number;
  totalGradingBags: {
    initialQuantity: number;
    currentQuantity: number;
  };
  totalGradingWeight: number;
  totalBagsStored: number;
  totalBagsDispatched: number;
  totalOutgoingBags: number;
}

/**
 * Get analytics overview for a cold storage with optional date filters.
 * - totalIncomingBags: sum of bags received (IncomingGatePass.bagsReceived)
 * - totalIncomingWeight: sum of (gross - tare) - (bagsReceived * 0.7) per pass (net minus bardana/JUTE bag weight)
 * - totalGradingBags: sum of initial and current quantities from grading order details
 * - totalGradingWeight: sum over grading lines of (quantity * (weightPerBagKg - bagTypeWeight)), JUTE=0.7kg, LENO=0.06kg
 * - totalUngradedBags / totalUngradedWeight: incoming vouchers that have no grading voucher associated (same weight formula as incoming)
 * - totalBagsStored: sum of bagSizes[].initialQuantity across all storage gate passes
 * - totalBagsDispatched: sum of orderDetails[].quantityIssued across nikasi (dispatch) gate passes
 * - totalOutgoingBags: sum of orderDetails[].quantityIssued across outgoing gate passes
 */
export async function getOverview(
  coldStorageId: string,
  filters: OverviewDateFilters,
  logger?: FastifyBaseLogger
): Promise<OverviewResult> {
  try {
    if (!mongoose.Types.ObjectId.isValid(coldStorageId)) {
      throw new ValidationError(
        'Invalid cold storage ID format',
        'INVALID_COLD_STORAGE_ID'
      );
    }

    // Scope all data to this cold storage only (caller must pass the logged-in user's coldStorageId)
    const coldStorageObjectId = new mongoose.Types.ObjectId(coldStorageId);
    const farmerStorageLinkIds = await FarmerStorageLink.find({
      coldStorageId: coldStorageObjectId,
    })
      .distinct('_id')
      .lean();

    if (farmerStorageLinkIds.length === 0) {
      return {
        totalIncomingBags: 0,
        totalIncomingWeight: 0,
        totalUngradedBags: 0,
        totalUngradedWeight: 0,
        totalGradingBags: { initialQuantity: 0, currentQuantity: 0 },
        totalGradingWeight: 0,
        totalBagsStored: 0,
        totalBagsDispatched: 0,
        totalOutgoingBags: 0,
      };
    }

    // Incoming and grading gate passes only for farmer-storage links belonging to this cold storage
    const matchIncoming: Record<string, unknown> = {
      farmerStorageLinkId: { $in: farmerStorageLinkIds },
    };
    const matchGrading: Record<string, unknown> = {
      farmerStorageLinkId: { $in: farmerStorageLinkIds },
    };

    if (filters.dateFrom) {
      const start = new Date(filters.dateFrom);
      if (Number.isNaN(start.getTime())) {
        throw new ValidationError(
          'Invalid dateFrom format; use YYYY-MM-DD',
          'INVALID_DATE_FROM'
        );
      }
      start.setUTCHours(0, 0, 0, 0);
      matchIncoming.date = matchIncoming.date ?? {};
      (matchIncoming.date as Record<string, unknown>).$gte = start;
      matchGrading.date = matchGrading.date ?? {};
      (matchGrading.date as Record<string, unknown>).$gte = start;
    }
    if (filters.dateTo) {
      const end = new Date(filters.dateTo);
      if (Number.isNaN(end.getTime())) {
        throw new ValidationError(
          'Invalid dateTo format; use YYYY-MM-DD',
          'INVALID_DATE_TO'
        );
      }
      end.setUTCHours(23, 59, 59, 999);
      matchIncoming.date = matchIncoming.date ?? {};
      (matchIncoming.date as Record<string, unknown>).$lte = end;
      matchGrading.date = matchGrading.date ?? {};
      (matchGrading.date as Record<string, unknown>).$lte = end;
    }

    const matchStorage: Record<string, unknown> = {
      farmerStorageLinkId: { $in: farmerStorageLinkIds },
    };
    const matchOutgoing: Record<string, unknown> = {
      farmerStorageLinkId: { $in: farmerStorageLinkIds },
    };
    const matchNikasi: Record<string, unknown> = {
      farmerStorageLinkId: { $in: farmerStorageLinkIds },
    };
    if (filters.dateFrom) {
      const start = new Date(filters.dateFrom);
      start.setUTCHours(0, 0, 0, 0);
      matchStorage.date = matchStorage.date ?? {};
      (matchStorage.date as Record<string, unknown>).$gte = start;
      matchOutgoing.date = matchOutgoing.date ?? {};
      (matchOutgoing.date as Record<string, unknown>).$gte = start;
      matchNikasi.date = matchNikasi.date ?? {};
      (matchNikasi.date as Record<string, unknown>).$gte = start;
    }
    if (filters.dateTo) {
      const end = new Date(filters.dateTo);
      end.setUTCHours(23, 59, 59, 999);
      matchStorage.date = matchStorage.date ?? {};
      (matchStorage.date as Record<string, unknown>).$lte = end;
      matchOutgoing.date = matchOutgoing.date ?? {};
      (matchOutgoing.date as Record<string, unknown>).$lte = end;
      matchNikasi.date = matchNikasi.date ?? {};
      (matchNikasi.date as Record<string, unknown>).$lte = end;
    }

    // Incoming: aggregate bagsReceived and net weight (gross - tare)
    const [incomingAgg] = await IncomingGatePass.aggregate<{
      totalIncomingBags: number;
      totalIncomingWeight: number;
    }>([
      { $match: matchIncoming },
      {
        $group: {
          _id: null,
          totalIncomingBags: { $sum: '$bagsReceived' },
          totalIncomingWeight: {
            $sum: {
              $cond: {
                if: {
                  $and: [
                    { $ne: ['$weightSlip.grossWeightKg', null] },
                    { $ne: ['$weightSlip.tareWeightKg', null] },
                  ],
                },
                then: {
                  $subtract: [
                    {
                      $subtract: [
                        { $ifNull: ['$weightSlip.grossWeightKg', 0] },
                        { $ifNull: ['$weightSlip.tareWeightKg', 0] },
                      ],
                    },
                    { $multiply: ['$bagsReceived', 0.7] },
                  ],
                },
                else: 0,
              },
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          totalIncomingBags: 1,
          totalIncomingWeight: { $round: ['$totalIncomingWeight', 2] },
        },
      },
    ]);

    const totalIncomingBags = incomingAgg?.totalIncomingBags ?? 0;
    const totalIncomingWeight = incomingAgg?.totalIncomingWeight ?? 0;

    // Ungraded incoming: incoming vouchers that have no grading voucher associated
    const gradedIncomingIds = await GradingGatePass.distinct(
      'incomingGatePassIds',
      matchGrading
    );
    const matchUngradedIncoming: Record<string, unknown> = {
      ...matchIncoming,
      _id: { $nin: gradedIncomingIds },
    };
    const [ungradedAgg] = await IncomingGatePass.aggregate<{
      totalUngradedBags: number;
      totalUngradedWeight: number;
    }>([
      { $match: matchUngradedIncoming },
      {
        $group: {
          _id: null,
          totalUngradedBags: { $sum: '$bagsReceived' },
          totalUngradedWeight: {
            $sum: {
              $cond: {
                if: {
                  $and: [
                    { $ne: ['$weightSlip.grossWeightKg', null] },
                    { $ne: ['$weightSlip.tareWeightKg', null] },
                  ],
                },
                then: {
                  $subtract: [
                    {
                      $subtract: [
                        { $ifNull: ['$weightSlip.grossWeightKg', 0] },
                        { $ifNull: ['$weightSlip.tareWeightKg', 0] },
                      ],
                    },
                    { $multiply: ['$bagsReceived', 0.7] },
                  ],
                },
                else: 0,
              },
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          totalUngradedBags: 1,
          totalUngradedWeight: { $round: ['$totalUngradedWeight', 2] },
        },
      },
    ]);
    const totalUngradedBags = ungradedAgg?.totalUngradedBags ?? 0;
    const totalUngradedWeight = ungradedAgg?.totalUngradedWeight ?? 0;

    // Grading: unwind orderDetails, sum initial/current quantities and weight per line
    const gradingDocs = await GradingGatePass.find(matchGrading)
      .select('orderDetails')
      .lean();

    let totalGradingInitial = 0;
    let totalGradingCurrent = 0;
    let totalGradingWeight = 0;

    for (const doc of gradingDocs) {
      const details = doc.orderDetails ?? [];
      for (const d of details) {
        const initial = Number(d.initialQuantity) || 0;
        const current = Number(d.currentQuantity) || 0;
        totalGradingInitial += initial;
        totalGradingCurrent += current;

        const weightPerBagKg = Number(d.weightPerBagKg) || 0;
        const bagType = (d.bagType as BagType) ?? BagType.JUTE;
        const bagTareKg =
          BAG_TYPE_WEIGHT_KG[bagType] ?? BAG_TYPE_WEIGHT_KG[BagType.JUTE];
        // Grading weight = initialQuantity * (weightPerBagKg - bag type weight); JUTE=0.7kg, LENO=0.06kg
        const netWeightPerBag = Math.max(0, weightPerBagKg - bagTareKg);
        totalGradingWeight += initial * netWeightPerBag;
      }
    }

    totalGradingWeight = Math.round(totalGradingWeight * 100) / 100;

    // Storage gate pass: sum of bagSizes[].initialQuantity across all storage gate passes (bags stored)
    const [storageAgg] = await StorageGatePass.aggregate<{
      totalBagsStored: number;
    }>([
      { $match: matchStorage },
      { $unwind: '$bagSizes' },
      {
        $group: {
          _id: null,
          totalBagsStored: { $sum: '$bagSizes.initialQuantity' },
        },
      },
      { $project: { _id: 0, totalBagsStored: 1 } },
    ]);
    const totalBagsStored = storageAgg?.totalBagsStored ?? 0;

    // Outgoing gate pass: sum of orderDetails[].quantityIssued (total outgoing bags)
    const [outgoingAgg] = await OutgoingGatePass.aggregate<{
      totalOutgoingBags: number;
    }>([
      { $match: matchOutgoing },
      { $unwind: '$orderDetails' },
      {
        $group: {
          _id: null,
          totalOutgoingBags: { $sum: '$orderDetails.quantityIssued' },
        },
      },
      { $project: { _id: 0, totalOutgoingBags: 1 } },
    ]);
    const totalOutgoingBags = outgoingAgg?.totalOutgoingBags ?? 0;

    // Nikasi gate pass: sum of orderDetails[].quantityIssued (bags dispatched)
    const [nikasiAgg] = await NikasiGatePass.aggregate<{
      totalBagsDispatched: number;
    }>([
      { $match: matchNikasi },
      { $unwind: '$orderDetails' },
      {
        $group: {
          _id: null,
          totalBagsDispatched: { $sum: '$orderDetails.quantityIssued' },
        },
      },
      { $project: { _id: 0, totalBagsDispatched: 1 } },
    ]);
    const totalBagsDispatched = nikasiAgg?.totalBagsDispatched ?? 0;

    logger?.info(
      {
        coldStorageId,
        filters,
        totalIncomingBags,
        totalIncomingWeight,
        totalUngradedBags,
        totalUngradedWeight,
        totalGradingBags: {
          initialQuantity: totalGradingInitial,
          currentQuantity: totalGradingCurrent,
        },
        totalGradingWeight,
        totalBagsStored,
        totalOutgoingBags,
        totalBagsDispatched,
      },
      'Analytics overview computed'
    );

    return {
      totalIncomingBags,
      totalIncomingWeight,
      totalUngradedBags,
      totalUngradedWeight,
      totalGradingBags: {
        initialQuantity: totalGradingInitial,
        currentQuantity: totalGradingCurrent,
      },
      totalGradingWeight,
      totalBagsStored,
      totalBagsDispatched,
      totalOutgoingBags,
    };
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    logger?.error(
      { error, coldStorageId, filters },
      'Error computing analytics overview'
    );
    throw new AppError(
      'Failed to compute analytics overview',
      500,
      'ANALYTICS_OVERVIEW_ERROR'
    );
  }
}

/**
 * Analytics service – placeholder for future analytics logic
 */
export function getAnalyticsMessage(): string {
  return 'Send analytics data';
}
