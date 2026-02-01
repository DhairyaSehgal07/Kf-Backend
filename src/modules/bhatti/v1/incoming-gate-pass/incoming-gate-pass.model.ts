import mongoose, { Schema, Document, Types, Model } from 'mongoose';

/* =======================
   ENUMS
======================= */

export enum GatePassStatus {
  OPEN = 'OPEN',
  PARTIALLY_GRADED = 'PARTIALLY_GRADED',
  FULLY_GRADED = 'FULLY_GRADED',
}

/* =======================
   INTERFACES
======================= */

interface IWeightSlip {
  slipNumber?: string;
  grossWeightKg?: number;
  tareWeightKg?: number;
}

interface IGradingSummary {
  totalGradedBags: number;
}

export interface IIncomingGatePass extends Document {
  farmerStorageLinkId: Types.ObjectId;
  createdBy?: Types.ObjectId;

  gatePassNo: number;
  date: Date;

  variety: string;
  truckNumber: string;

  bagsReceived: number;

  weightSlip?: IWeightSlip;

  status: GatePassStatus;
  gradingSummary: IGradingSummary;

  remarks?: string;

  createdAt: Date;
  updatedAt: Date;
}

/* =======================
   SUB SCHEMAS
======================= */

const WeightSlipSchema = new Schema<IWeightSlip>(
  {
    slipNumber: String,
    grossWeightKg: Number,
    tareWeightKg: Number,
  },
  { _id: false }
);

const GradingSummarySchema = new Schema<IGradingSummary>(
  {
    totalGradedBags: { type: Number, default: 0 },
  },
  { _id: false }
);

/* =======================
   MAIN SCHEMA
======================= */

const IncomingGatePassSchema = new Schema<IIncomingGatePass>(
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

    date: {
      type: Date,
      required: true,
      index: true,
    },

    variety: {
      type: String,
      required: true,
      trim: true,
    },

    truckNumber: {
      type: String,
      required: true,
      trim: true,
    },

    bagsReceived: {
      type: Number,
      required: true,
      min: 0,
    },

    weightSlip: {
      type: WeightSlipSchema,
    },

    status: {
      type: String,
      enum: Object.values(GatePassStatus),
      default: GatePassStatus.OPEN,
      index: true,
    },

    gradingSummary: {
      type: GradingSummarySchema,
      default: () => ({}),
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

// Gate passes by farmer storage link
IncomingGatePassSchema.index({ farmerStorageLinkId: 1, date: -1 });

// Daybook: filter by farmer storage link, sort by date and gate pass number
IncomingGatePassSchema.index({
  farmerStorageLinkId: 1,
  date: -1,
  gatePassNo: -1,
});

// Gate passes by date for reporting
IncomingGatePassSchema.index({ date: -1 });

// Status queries
IncomingGatePassSchema.index({ status: 1, date: -1 });

// Gate pass number lookup (already indexed via unique)
// createdBy lookup
IncomingGatePassSchema.index({ createdBy: 1 });

/* =======================
   MODEL
======================= */

export const IncomingGatePass: Model<IIncomingGatePass> =
  mongoose.models.IncomingGatePass ||
  mongoose.model<IIncomingGatePass>('IncomingGatePass', IncomingGatePassSchema);
