import mongoose, { Schema, Document, Types, Model } from 'mongoose';

/* =======================
   INTERFACES
======================= */

export interface IIncomingGatePassAudit extends Document {
  incomingGatePassId: Types.ObjectId;
  editedById?: Types.ObjectId;

  // What changed
  field: string;
  oldValue: any;
  newValue: any;

  // Metadata
  reason?: string;
  ipAddress?: string;
  userAgent?: string;

  createdAt: Date;
}

/* =======================
   SCHEMA
======================= */

const IncomingGatePassAuditSchema = new Schema<IIncomingGatePassAudit>(
  {
    incomingGatePassId: {
      type: Schema.Types.ObjectId,
      ref: 'IncomingGatePass',
      required: true,
      index: true,
    },

    editedById: {
      type: Schema.Types.ObjectId,
      ref: 'StoreAdmin',
      index: true,
    },

    field: {
      type: String,
      required: true,
    },

    oldValue: {
      type: Schema.Types.Mixed,
    },

    newValue: {
      type: Schema.Types.Mixed,
    },

    reason: {
      type: String,
      trim: true,
    },

    ipAddress: {
      type: String,
    },

    userAgent: {
      type: String,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

/* =======================
   INDEXES
======================= */

// Audit trail for a specific gate pass (chronological)
IncomingGatePassAuditSchema.index({ incomingGatePassId: 1, createdAt: -1 });

// All edits by a specific user
IncomingGatePassAuditSchema.index({ editedById: 1, createdAt: -1 });

// Track edits by field
IncomingGatePassAuditSchema.index({ incomingGatePassId: 1, field: 1 });

// Date range queries
IncomingGatePassAuditSchema.index({ createdAt: -1 });

/* =======================
   MODEL
======================= */

export const IncomingGatePassAudit: Model<IIncomingGatePassAudit> =
  mongoose.models.IncomingGatePassAudit ||
  mongoose.model<IIncomingGatePassAudit>(
    'IncomingGatePassAudit',
    IncomingGatePassAuditSchema
  );
