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

export interface INikasiGatePass extends Document {
  gatePassNo: number;
  date: Date;
  variety: string;

  from: string;
  toField: string;

  orderDetails: INikasiOrderDetail[];

  remarks?: string;

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

/* =======================
   MAIN SCHEMA
======================= */

const NikasiGatePassSchema = new Schema<INikasiGatePass>(
  {
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
  },
  {
    timestamps: true,
  }
);

/* =======================
   INDEXES
======================= */

// Gate passes by date for reporting
NikasiGatePassSchema.index({ date: -1 });

// Gate pass number lookup (already indexed via unique)

/* =======================
   MODEL
======================= */

export const NikasiGatePass: Model<INikasiGatePass> =
  mongoose.models.NikasiGatePass ||
  mongoose.model<INikasiGatePass>('NikasiGatePass', NikasiGatePassSchema);
