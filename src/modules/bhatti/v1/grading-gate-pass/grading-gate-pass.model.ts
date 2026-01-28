import mongoose, { Schema, Document, Types, Model } from 'mongoose';

/* =======================
   ENUMS
======================= */

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
  incomingGatePassId: Types.ObjectId;
  gradedById?: Types.ObjectId;

  gatePassNo: number;
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
    },

    initialQuantity: {
      type: Number,
      required: true,
      min: 0,
    },

    weightPerBagKg: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: false }
);

/* =======================
   MAIN SCHEMA
======================= */

const GradingGatePassSchema = new Schema<IGradingGatePass>(
  {
    incomingGatePassId: {
      type: Schema.Types.ObjectId,
      ref: 'IncomingGatePass',
      required: true,
      index: true,
    },

    gradedById: {
      type: Schema.Types.ObjectId,
      ref: 'StoreAdmin',
    },

    gatePassNo: {
      type: Number,
      required: true,
      unique: true,
      index: true,
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

// One incoming → many grading passes (chronological)
GradingGatePassSchema.index({ incomingGatePassId: 1, createdAt: -1 });

// Gate passes by date for reporting
GradingGatePassSchema.index({ date: -1 });

// Allocation status queries
GradingGatePassSchema.index({ allocationStatus: 1, date: -1 });

// Order detail size for bulk update filters (optimistic locking)
GradingGatePassSchema.index({ 'orderDetails.size': 1 });

// Graded by user lookup
GradingGatePassSchema.index({ gradedById: 1 });

/* =======================
   MODEL
======================= */

export const GradingGatePass: Model<IGradingGatePass> =
  mongoose.models.GradingGatePass ||
  mongoose.model<IGradingGatePass>('GradingGatePass', GradingGatePassSchema);
