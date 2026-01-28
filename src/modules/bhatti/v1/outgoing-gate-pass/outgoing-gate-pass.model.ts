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
  quantityAvailable: number;
  quantityIssued: number;
  bagType: BagType;
  status: MoistureStatus;
}

export interface IOutgoingGatePass extends Document {
  storageGatePassId: Types.ObjectId;

  gatePassNo: string;
  date: Date;
  variety: string;

  from: string;
  to: string;

  truckNumber: string;

  orderDetails: IOutgoingOrderDetail[];

  remarks?: string;

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

/* =======================
   MAIN SCHEMA
======================= */

const OutgoingGatePassSchema = new Schema<IOutgoingGatePass>(
  {
    storageGatePassId: {
      type: Schema.Types.ObjectId,
      ref: 'StorageGatePass',
      required: true,
      index: true,
    },

    gatePassNo: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
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
  },
  {
    timestamps: true,
  }
);

/* =======================
   INDEXES
======================= */

// One storage → many outgoing passes (chronological)
OutgoingGatePassSchema.index({ storageGatePassId: 1, createdAt: -1 });

// Gate passes by date for reporting
OutgoingGatePassSchema.index({ date: -1 });

// Gate pass number lookup (already indexed via unique)

/* =======================
   MODEL
======================= */

export const OutgoingGatePass: Model<IOutgoingGatePass> =
  mongoose.models.OutgoingGatePass ||
  mongoose.model<IOutgoingGatePass>('OutgoingGatePass', OutgoingGatePassSchema);
