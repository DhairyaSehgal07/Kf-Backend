import mongoose, { Schema, Document, Types, Model } from 'mongoose';

/* =======================
   INTERFACES
======================= */

export interface IStorageGatePassAudit extends Document {
  storageGatePassId: Types.ObjectId;
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

const StorageGatePassAuditSchema = new Schema<IStorageGatePassAudit>(
  {
    storageGatePassId: {
      type: Schema.Types.ObjectId,
      ref: 'StorageGatePass',
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

// Audit trail for a specific storage gate pass (chronological)
StorageGatePassAuditSchema.index({ storageGatePassId: 1, createdAt: -1 });

// All edits by a specific user
StorageGatePassAuditSchema.index({ editedById: 1, createdAt: -1 });

// Track edits by field
StorageGatePassAuditSchema.index({ storageGatePassId: 1, field: 1 });

// Date range queries
StorageGatePassAuditSchema.index({ createdAt: -1 });

/* =======================
   MODEL
======================= */

export const StorageGatePassAudit: Model<IStorageGatePassAudit> =
  mongoose.models.StorageGatePassAudit ||
  mongoose.model<IStorageGatePassAudit>(
    'StorageGatePassAudit',
    StorageGatePassAuditSchema
  );
