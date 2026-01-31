import mongoose, { Schema, Document, Types, Model } from 'mongoose';
import { BagType } from '../grading-gate-pass/grading-gate-pass.model';

/* =======================
   ENUMS
======================= */

export enum MoistureStatus {
  DRY = 'DRY',
  WET = 'WET',
}

/* =======================
   INTERFACES
======================= */

interface IOutgoingOrderDetail {
  size: string;
  storageGatePassId: Types.ObjectId;
  quantityAvailable: number;
  quantityIssued: number;
  bagType: BagType;
  status: MoistureStatus;
}

/** Snapshot of a storage gate pass at creation time (remaining quantities) */
export interface IOutgoingStorageGatePassSnapshotBagSize {
  size: string;
  currentQuantity: number;
  initialQuantity: number;
  location: string;
}

export interface IOutgoingStorageGatePassSnapshot {
  _id: Types.ObjectId;
  gatePassNo: number;
  bagSizes: IOutgoingStorageGatePassSnapshotBagSize[];
}

export interface IOutgoingGatePass extends Document {
  /** Legacy: single storage pass (optional when storageGatePassIds is used) */
  storageGatePassId?: Types.ObjectId;

  /** Storage gate passes from which quantities were issued */
  storageGatePassIds: Types.ObjectId[];

  /** Snapshot of each storage gate pass state (remaining qty) when this outgoing pass was created */
  storageGatePassSnapshots?: IOutgoingStorageGatePassSnapshot[];

  gatePassNo: number;
  manualGatePassNumber?: number;
  date: Date;
  variety: string;

  from: string;
  to: string;

  truckNumber: string;

  orderDetails: IOutgoingOrderDetail[];

  remarks?: string;

  idempotencyKey?: string;

  createdAt: Date;
  updatedAt: Date;
}

/* =======================
   SUB SCHEMAS
======================= */

const OutgoingOrderDetailSchema = new Schema<IOutgoingOrderDetail>(
  {
    size: {
      type: String,
      required: true,
      trim: true,
    },

    storageGatePassId: {
      type: Schema.Types.ObjectId,
      ref: 'StorageGatePass',
      required: true,
    },

    quantityAvailable: {
      type: Number,
      required: true,
      min: 0,
    },

    quantityIssued: {
      type: Number,
      required: true,
      min: 0,
    },

    bagType: {
      type: String,
      enum: Object.values(BagType),
      required: true,
    },

    status: {
      type: String,
      enum: Object.values(MoistureStatus),
      required: true,
    },
  },
  { _id: false }
);

const OutgoingStorageGatePassSnapshotBagSizeSchema =
  new Schema<IOutgoingStorageGatePassSnapshotBagSize>(
    {
      size: { type: String, required: true, trim: true },
      currentQuantity: { type: Number, required: true, min: 0 },
      initialQuantity: { type: Number, required: true, min: 0 },
      location: { type: String, required: true, trim: true },
    },
    { _id: false }
  );

const OutgoingStorageGatePassSnapshotSchema =
  new Schema<IOutgoingStorageGatePassSnapshot>(
    {
      _id: {
        type: Schema.Types.ObjectId,
        ref: 'StorageGatePass',
        required: true,
      },
      gatePassNo: { type: Number, required: true },
      bagSizes: {
        type: [OutgoingStorageGatePassSnapshotBagSizeSchema],
        required: true,
        default: [],
      },
    },
    { _id: false }
  );

/* =======================
   MAIN SCHEMA
======================= */

const OutgoingGatePassSchema = new Schema<IOutgoingGatePass>(
  {
    storageGatePassId: {
      type: Schema.Types.ObjectId,
      ref: 'StorageGatePass',
      required: false,
      index: true,
    },

    storageGatePassIds: {
      type: [Schema.Types.ObjectId],
      ref: 'StorageGatePass',
      required: true,
      validate: {
        validator: (ids: Types.ObjectId[]) => ids.length > 0,
        message: 'At least one storage gate pass ID is required',
      },
      index: true,
    },

    storageGatePassSnapshots: {
      type: [OutgoingStorageGatePassSnapshotSchema],
      default: undefined,
      select: true,
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

    from: {
      type: String,
      required: true,
      trim: true,
    },

    to: {
      type: String,
      required: true,
      trim: true,
    },

    truckNumber: {
      type: String,
      required: true,
      trim: true,
    },

    orderDetails: {
      type: [OutgoingOrderDetailSchema],
      required: true,
      validate: {
        validator: (details: IOutgoingOrderDetail[]) => details.length > 0,
        message: 'At least one order detail is required',
      },
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

OutgoingGatePassSchema.index(
  { idempotencyKey: 1 },
  { unique: true, sparse: true }
);

// One storage → many outgoing passes (chronological)
OutgoingGatePassSchema.index({ storageGatePassId: 1, createdAt: -1 });
OutgoingGatePassSchema.index({ storageGatePassIds: 1, createdAt: -1 });

// Gate passes by date for reporting
OutgoingGatePassSchema.index({ date: -1 });

// Gate pass number lookup (already indexed via unique)

/* =======================
   MODEL
======================= */

export const OutgoingGatePass: Model<IOutgoingGatePass> =
  mongoose.models.OutgoingGatePass ||
  mongoose.model<IOutgoingGatePass>('OutgoingGatePass', OutgoingGatePassSchema);
