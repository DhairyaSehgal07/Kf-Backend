import mongoose, { Schema, Document, Types, Model } from 'mongoose';

/* =======================
   ENUMS
======================= */
const oneDecimalFloat = (value: number) => {
  if (typeof value !== 'number') return value;
  return Math.round(value * 10) / 10;
};

export enum BagType {
  JUTE = 'JUTE',
  LENO = 'LENO',
}

export enum AllocationStatus {
  UNALLOCATED = 'UNALLOCATED',
  PARTIALLY_ALLOCATED = 'PARTIALLY_ALLOCATED',
  FULLY_ALLOCATED = 'FULLY_ALLOCATED',
}

/* =======================
   INTERFACES
======================= */

interface IOrderDetail {
  size: string;
  bagType: BagType;
  currentQuantity: number;
  initialQuantity: number;
  weightPerBagKg: number;
}

export interface IGradingGatePass extends Document {
  farmerStorageLinkId: Types.ObjectId;
  incomingGatePassId: Types.ObjectId;
  createdBy?: Types.ObjectId;

  gatePassNo: number;
  manualGatePassNumber?: number;
  date: Date;
  variety: string;

  orderDetails: IOrderDetail[];

  allocationStatus: AllocationStatus;

  remarks?: string;

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

    bagType: {
      type: String,
      enum: Object.values(BagType),
      required: true,
    },

    currentQuantity: {
      type: Number,
      required: true,
      min: 0,
      set: oneDecimalFloat,
    },

    initialQuantity: {
      type: Number,
      required: true,
      min: 0,
      set: oneDecimalFloat,
    },

    weightPerBagKg: {
      type: Number,
      required: true,
      min: 0,
      set: oneDecimalFloat,
    },
  },
  { _id: false }
);

/* =======================
   MAIN SCHEMA
======================= */

const GradingGatePassSchema = new Schema<IGradingGatePass>(
  {
    farmerStorageLinkId: {
      type: Schema.Types.ObjectId,
      ref: 'FarmerStorageLink',
      required: true,
      index: true,
    },

    incomingGatePassId: {
      type: Schema.Types.ObjectId,
      ref: 'IncomingGatePass',
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

    allocationStatus: {
      type: String,
      enum: Object.values(AllocationStatus),
      default: AllocationStatus.UNALLOCATED,
      index: true,
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

// Farmer storage link lookup
GradingGatePassSchema.index({ farmerStorageLinkId: 1, date: -1 });

// One incoming → many grading passes (chronological)
GradingGatePassSchema.index({ incomingGatePassId: 1, createdAt: -1 });

// Gate passes by date for reporting
GradingGatePassSchema.index({ date: -1 });

// Allocation status queries
GradingGatePassSchema.index({ allocationStatus: 1, date: -1 });

// Order detail size for bulk update filters (optimistic locking)
GradingGatePassSchema.index({ 'orderDetails.size': 1 });

// Created by user lookup
// createdBy is indexed via field-level index: true

/* =======================
   MODEL
======================= */

export const GradingGatePass: Model<IGradingGatePass> =
  mongoose.models.GradingGatePass ||
  mongoose.model<IGradingGatePass>('GradingGatePass', GradingGatePassSchema);
