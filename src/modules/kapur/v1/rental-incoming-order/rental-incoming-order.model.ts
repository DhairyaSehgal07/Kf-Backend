import mongoose, { Schema, Types, Model, HydratedDocument } from 'mongoose';

/* =======================
   INTERFACES
======================= */

export interface IRentalIncomingOrder {
  farmerStorageLinkId: Types.ObjectId;
  gatePassNo: number;
  createdAt: Date;
  updatedAt: Date;
}

export type RentalIncomingOrderDocument =
  HydratedDocument<IRentalIncomingOrder>;

/* =======================
   MAIN SCHEMA
======================= */

const RentalIncomingOrderSchema = new Schema<IRentalIncomingOrder>(
  {
    farmerStorageLinkId: {
      type: Schema.Types.ObjectId,
      ref: 'FarmerStorageLink',
      required: true,
      index: true,
    },
    gatePassNo: {
      type: Number,
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

/* =======================
   INDEXES (for getNextVoucherNumber and listing)
======================= */

RentalIncomingOrderSchema.index({ farmerStorageLinkId: 1, gatePassNo: -1 });

RentalIncomingOrderSchema.index(
  { farmerStorageLinkId: 1, gatePassNo: 1 },
  { unique: true }
);

/* =======================
   MODEL EXPORT
======================= */

export const RentalIncomingOrder: Model<IRentalIncomingOrder> =
  mongoose.models.RentalIncomingOrder ||
  mongoose.model<IRentalIncomingOrder>(
    'RentalIncomingOrder',
    RentalIncomingOrderSchema
  );
