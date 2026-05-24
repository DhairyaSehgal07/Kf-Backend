import mongoose, { Schema, Document, Types, Model } from 'mongoose';

/* =======================
   INTERFACES
======================= */

interface INikasiOrderDetail {
  size: string;
  gradingGatePassId: Types.ObjectId;
  quantityAvailable: number;
  quantityIssued: number;
}

/** Snapshot of a grading gate pass at creation time (remaining quantities) */
export interface INikasiGradingGatePassSnapshotBagSize {
  size: string;
  quantity: number;
}

export interface INikasiGradingGatePassSnapshot {
  _id: Types.ObjectId;
  gatePassNo: number;
  incomingBagSizes: INikasiGradingGatePassSnapshotBagSize[];
}

export interface INikasiGatePass extends Document {
  farmerStorageLinkId: Types.ObjectId;
  createdBy?: Types.ObjectId;
  gatePassNo: number;
  manualGatePassNumber?: number;
  gradingGatePassIds: Types.ObjectId[];
  /** Snapshot of each grading gate pass state (remaining qty) when this nikasi pass was created */
  gradingGatePassSnapshots?: INikasiGradingGatePassSnapshot[];

  date: Date;
  variety: string;

  from: string;
  toField: string;

  orderDetails: INikasiOrderDetail[];

  remarks?: string;

  /** Idempotency key for create; sparse unique index */
  idempotencyKey?: string;

  createdAt: Date;
  updatedAt: Date;
}

/* =======================
   SUB SCHEMAS
======================= */

const NikasiOrderDetailSchema = new Schema<INikasiOrderDetail>(
  {
    size: {
      type: String,
      required: true,
      trim: true,
    },

    gradingGatePassId: {
      type: Schema.Types.ObjectId,
      ref: 'GradingGatePass',
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
  },
  { _id: false }
);

const NikasiGradingGatePassSnapshotBagSizeSchema =
  new Schema<INikasiGradingGatePassSnapshotBagSize>(
    {
      size: { type: String, required: true, trim: true },
      quantity: { type: Number, required: true, min: 0 },
    },
    { _id: false }
  );

const NikasiGradingGatePassSnapshotSchema =
  new Schema<INikasiGradingGatePassSnapshot>(
    {
      _id: {
        type: Schema.Types.ObjectId,
        ref: 'GradingGatePass',
        required: true,
      },
      gatePassNo: { type: Number, required: true },
      incomingBagSizes: {
        type: [NikasiGradingGatePassSnapshotBagSizeSchema],
        required: true,
        default: [],
      },
    },
    { _id: false }
  );

/* =======================
   MAIN SCHEMA
======================= */

const NikasiGatePassSchema = new Schema<INikasiGatePass>(
  {
    farmerStorageLinkId: {
      type: Schema.Types.ObjectId,
      ref: 'FarmerStorageLink',
      required: true,
    },

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'StoreAdmin',
      index: true,
    },

    gatePassNo: {
      type: Number,
      required: true,
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
    },

    gradingGatePassSnapshots: {
      type: [NikasiGradingGatePassSnapshotSchema],
      default: undefined,
      select: true,
    },

    date: {
      type: Date,
      required: true,
    },

    variety: {
      type: String,
      required: true,
      trim: true,
    },

    from: {
      type: String,
      required: true,
      trim: true,
    },

    toField: {
      type: String,
      required: true,
      trim: true,
    },

    orderDetails: {
      type: [NikasiOrderDetailSchema],
      required: true,
      validate: {
        validator: (details: INikasiOrderDetail[]) => details.length > 0,
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

NikasiGatePassSchema.index(
  { idempotencyKey: 1 },
  { unique: true, sparse: true }
);

// Farmer storage link lookup
NikasiGatePassSchema.index({ farmerStorageLinkId: 1, date: -1 });

// Voucher number unique per farmer-storage link (same voucher can exist for different cold storages)
NikasiGatePassSchema.index(
  { farmerStorageLinkId: 1, gatePassNo: 1 },
  { unique: true }
);

// Gate passes by date for reporting
NikasiGatePassSchema.index({ date: -1 });

/* =======================
   MODEL
======================= */

export const NikasiGatePass: Model<INikasiGatePass> =
  mongoose.models.NikasiGatePass ||
  mongoose.model<INikasiGatePass>('NikasiGatePass', NikasiGatePassSchema);
