import mongoose, { Schema, Document, Types, Model } from 'mongoose';

/* =======================
   INTERFACES
======================= */

export interface IGradingGatePassAudit extends Document {
  gradingGatePassId: Types.ObjectId;
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

const GradingGatePassAuditSchema = new Schema<IGradingGatePassAudit>(
  {
    gradingGatePassId: {
      type: Schema.Types.ObjectId,
      ref: 'GradingGatePass',
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

// Audit trail for a specific grading gate pass (chronological)
GradingGatePassAuditSchema.index({ gradingGatePassId: 1, createdAt: -1 });

// All edits by a specific user
GradingGatePassAuditSchema.index({ editedById: 1, createdAt: -1 });

// Track edits by field
GradingGatePassAuditSchema.index({ gradingGatePassId: 1, field: 1 });

// Date range queries
GradingGatePassAuditSchema.index({ createdAt: -1 });

/* =======================
   MODEL
======================= */

export const GradingGatePassAudit: Model<IGradingGatePassAudit> =
  mongoose.models.GradingGatePassAudit ||
  mongoose.model<IGradingGatePassAudit>(
    'GradingGatePassAudit',
    GradingGatePassAuditSchema
  );
