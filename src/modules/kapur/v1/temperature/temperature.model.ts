import mongoose, { Schema, Document, Types, Model } from 'mongoose';

/* =======================
   INTERFACES
======================= */

export interface ITemperature extends Document {
  coldStorageId: Types.ObjectId;
  chamber: string;
  runningTemperature: number;
  date: Date;

  createdAt: Date;
  updatedAt: Date;
}

/* =======================
   SCHEMA
======================= */

const TemperatureSchema = new Schema<ITemperature>(
  {
    coldStorageId: {
      type: Schema.Types.ObjectId,
      ref: 'ColdStorage',
      required: true,
      index: true,
    },

    chamber: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    runningTemperature: {
      type: Number,
      required: true,
    },

    date: {
      type: Date,
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

/* =======================
   INDEXES
======================= */

TemperatureSchema.index({ coldStorageId: 1, date: -1 });
TemperatureSchema.index({ coldStorageId: 1, chamber: 1, date: -1 });

/* =======================
   MODEL
======================= */

export const Temperature: Model<ITemperature> =
  mongoose.models.Temperature ||
  mongoose.model<ITemperature>('Temperature', TemperatureSchema);
