import mongoose, { Schema, Document, Types, Model } from 'mongoose';
import { BagType } from '../grading-gate-pass/grading-gate-pass.model';

/* =======================
   INTERFACES
======================= */

interface IOrderDetail {
  size: string;
  currentQuantity: number;
  initialQuantity: number;
  weightPerBag: number;
  bagType: BagType;
  chamber: string;
  floor: string;
  row: string;
}

interface IEditHistory {
  editedById?: Types.ObjectId;
  editedAt: Date;
  field: string;
  oldValue: any;
  newValue: any;
  reason?: string;
}

/** Snapshot of a grading gate pass at the time this storage gate pass was created (remaining quantities) */
export interface IGradingGatePassSnapshotBagSize {
  size: string;
  currentQuantity: number;
  initialQuantity: number;
}

export interface IGradingGatePassSnapshot {
  _id: Types.ObjectId;
  gatePassNo: number;
  incomingBagSizes: IGradingGatePassSnapshotBagSize[];
}

export interface IStorageGatePass extends Document {
  farmerStorageLinkId: Types.ObjectId;
  createdBy?: Types.ObjectId;
  gatePassNo: number;
  manualGatePassNumber?: number;
  gradingGatePassIds: Types.ObjectId[];
  /** Snapshot of each grading gate pass state (remaining qty) when this storage pass was created */
  gradingGatePassSnapshots?: IGradingGatePassSnapshot[];

  date: Date;
  variety: string;

  orderDetails: IOrderDetail[];

  editHistory: IEditHistory[];

  remarks?: string;

  /** Idempotency key for create; sparse unique index */
  idempotencyKey?: string;

  createdAt: Date;
  updatedAt: Date;
}

/* =======================
   SUB SCHEMAS
======================= */

const OrderDetailSchema = new Schema<IOrderDetail>(
  {
    size: {
      type: String,
      required: true,
      trim: true,
    },

    currentQuantity: {
      type: Number,
      required: true,
      min: 0,
    },

    initialQuantity: {
      type: Number,
      required: true,
      min: 0,
    },

    weightPerBag: {
      type: Number,
      required: true,
      min: 0,
    },

    bagType: {
      type: String,
      enum: Object.values(BagType),
      required: true,
    },

    chamber: {
      type: String,
      required: true,
      trim: true,
    },

    floor: {
      type: String,
      required: true,
      trim: true,
    },

    row: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { _id: false }
);

const EditHistorySchema = new Schema<IEditHistory>(
  {
    editedById: {
      type: Schema.Types.ObjectId,
      ref: 'StoreAdmin',
    },

    editedAt: {
      type: Date,
      default: Date.now,
    },

    field: {
      type: String,
      required: true,
    },

    oldValue: {
      type: Schema.Types.Mixed,
    },

    newValue: {
      type: Schema.Types.Mixed,
    },

    reason: {
      type: String,
      trim: true,
    },
  },
  { _id: false }
);

const GradingGatePassSnapshotBagSizeSchema =
  new Schema<IGradingGatePassSnapshotBagSize>(
    {
      size: { type: String, required: true, trim: true },
      currentQuantity: { type: Number, required: true, min: 0 },
      initialQuantity: { type: Number, required: true, min: 0 },
    },
    { _id: false }
  );

const GradingGatePassSnapshotSchema = new Schema<IGradingGatePassSnapshot>(
  {
    _id: {
      type: Schema.Types.ObjectId,
      ref: 'GradingGatePass',
      required: true,
    },
    gatePassNo: { type: Number, required: true },
    incomingBagSizes: {
      type: [GradingGatePassSnapshotBagSizeSchema],
      required: true,
      default: [],
    },
  },
  { _id: false }
);

/* =======================
   MAIN SCHEMA
======================= */

const StorageGatePassSchema = new Schema<IStorageGatePass>(
  {
    farmerStorageLinkId: {
      type: Schema.Types.ObjectId,
      ref: 'FarmerStorageLink',
      required: true,
      index: true,
    },

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'StoreAdmin',
      index: true,
    },

    gatePassNo: {
      type: Number,
      required: true,
      unique: true,
      index: true,
    },

    manualGatePassNumber: {
      type: Number,
    },

    gradingGatePassIds: {
      type: [Schema.Types.ObjectId],
      ref: 'GradingGatePass',
      required: true,
      validate: {
        validator: (ids: Types.ObjectId[]) => ids.length > 0,
        message: 'At least one grading gate pass ID is required',
      },
      index: true,
    },

    gradingGatePassSnapshots: {
      type: [GradingGatePassSnapshotSchema],
      default: undefined,
      select: true,
    },

    date: {
      type: Date,
      required: true,
      index: true,
    },

    variety: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    orderDetails: {
      type: [OrderDetailSchema],
      required: true,
      validate: {
        validator: (details: IOrderDetail[]) => details.length > 0,
        message: 'At least one order detail is required',
      },
    },

    editHistory: {
      type: [EditHistorySchema],
      default: [],
    },

    remarks: {
      type: String,
      trim: true,
    },

    idempotencyKey: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

/* =======================
   INDEXES
======================= */

// Idempotency: sparse unique so multiple nulls allowed
StorageGatePassSchema.index(
  { idempotencyKey: 1 },
  { unique: true, sparse: true }
);

// Created by user lookup
StorageGatePassSchema.index({ createdBy: 1 });

// Farmer storage link lookup
StorageGatePassSchema.index({ farmerStorageLinkId: 1, date: -1 });

// Multiple grading → many storage passes (chronological)
StorageGatePassSchema.index({ gradingGatePassIds: 1, createdAt: -1 });

// Gate passes by date for reporting
StorageGatePassSchema.index({ date: -1 });

/* =======================
   MODEL
======================= */

export const StorageGatePass: Model<IStorageGatePass> =
  mongoose.models.StorageGatePass ||
  mongoose.model<IStorageGatePass>('StorageGatePass', StorageGatePassSchema);
