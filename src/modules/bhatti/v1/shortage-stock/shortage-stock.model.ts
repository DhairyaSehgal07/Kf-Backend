import mongoose, { Schema, Document, Types, Model } from 'mongoose';

/* =======================
   HELPERS
======================= */

const oneDecimalFloat = (value: number) => {
  if (typeof value !== 'number') return value;
  return Math.round(value * 10) / 10;
};

/* =======================
   INTERFACES
======================= */

interface IShortageDetail {
  size: string;
  quantityShort: number;
}

export interface IShortageStock extends Document {
  farmerStorageLinkId: Types.ObjectId;

  shortageDetails: IShortageDetail[];

  date: Date;
  variety: string;

  remarks?: string;

  createdAt: Date;
  updatedAt: Date;
}

/* =======================
   SUB SCHEMA
======================= */

const ShortageDetailSchema = new Schema<IShortageDetail>(
  {
    size: {
      type: String,
      required: true,
      trim: true,
    },

    quantityShort: {
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

const ShortageStockSchema = new Schema<IShortageStock>(
  {
    farmerStorageLinkId: {
      type: Schema.Types.ObjectId,
      ref: 'FarmerStorageLink',
      required: true,
      index: true,
    },

    shortageDetails: {
      type: [ShortageDetailSchema],
      required: true,
      validate: {
        validator: (details: IShortageDetail[]) => details.length > 0,
        message: 'At least one shortage detail is required',
      },
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

// Farmer-wise shortage lookups
ShortageStockSchema.index({ farmerStorageLinkId: 1, date: -1 });

// Variety based reporting
ShortageStockSchema.index({ variety: 1, date: -1 });

// Date based reports
ShortageStockSchema.index({ date: -1 });

// Filter by bag size
ShortageStockSchema.index({ 'shortageDetails.size': 1 });

/* =======================
   MODEL
======================= */

export const ShortageStock: Model<IShortageStock> =
  mongoose.models.ShortageStock ||
  mongoose.model<IShortageStock>('ShortageStock', ShortageStockSchema);
