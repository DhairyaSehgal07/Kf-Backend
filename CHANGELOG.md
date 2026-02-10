# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.6.4] - 2026-02-10

### Added

- **Nikasi Gate Pass – Bulk create**
  - POST `/api/bhatti/v1/nikasi-gate-pass/bulk` to create multiple nikasi gate passes in one request
  - All passes created in a single transaction; any failure rolls back everything
  - Gate pass numbers must be unique per cold storage (within request and in DB)
  - Schema `createBulkNikasiGatePassSchema` and handler `createNikasiGatePassBulkHandler` with 201/400/404/409 responses and rate limit 30/min

### Changed

- **Grading Gate Pass**
  - GET `/` (list by cold storage) now uses `getGradingGatePassesByStoreSchema` for querystring validation; description/summary updated to "current logged-in store"
  - `getGradingGatePassesByColdStorage` and `getGradingGatePassesByFarmerStorageLink` populate incoming gate pass with explicit `select` (truckNumber, gatePassNo, manualGatePassNumber, date, variety, farmerStorageLinkId, bagsReceived, weightSlip, status, gradingSummary, remarks, createdAt, updatedAt)

- **Nikasi Gate Pass Service**
  - Refactored single create into `createOneNikasiGatePassWithSession`; single create and new bulk create both use it within a transaction
  - Bulk create validates duplicate gate pass numbers per cold storage within the request before creating

## [1.6.3] - 2026-02-04

### Changed

- **Store Admin Login – Error handling**
  - Login handler now validates request body early and returns consistent JSON for all error paths so clients receive clear messages instead of generic "Network Error"
  - Added `sendLoginError` helper and explicit handling for missing/invalid body, `ValidationError`, and non-Error throws
  - Login route response schema documents 400 (bad request), 401 (invalid credentials / account locked), 429 (rate limit), and 500 (internal error) with `success` and `error: { code, message }`

- **Rate limits relaxed**
  - **Store admin routes**: create/delete 10→30/min; list/get/update 100→200/min; check-mobile 30→60/min; login 50→100/min; logout and others 20→60/min
  - **Incoming, grading, nikasi, storage, outgoing gate pass routes**: 20→60/min and 100→200/min where applicable

## [1.6.0] - 2026-02-02

### Added

- **Preferences Module**
  - Added preferences module (model, service, controller, schema) for cold storage–scoped settings
  - GET `/api/bhatti/v1/cold-storage/:id/preferences` and PATCH `/api/bhatti/v1/cold-storage/:id/preferences` for bag sizes, report format, and custom key-value settings
  - Cold storage creation now creates a linked Preferences document (one-to-one); cold storage responses can populate `preferencesId`
  - Store-admin daybook and related responses include `preferences` when applicable

- **Manual Gate Pass Number**
  - Optional `manualGatePassNumber` on grading, incoming, storage, and nikasi gate pass create payloads and models
  - Daybook and voucher responses (incoming, gradingPasses, storagePasses, nikasiPasses, outgoingPasses) include `manualGatePassNumber` when set

### Changed

- **Cold Storage**
  - Cold storage model adds `preferencesId` reference to Preferences; service creates preferences on create and populates on get
  - Cold storage routes mount preferences GET/PATCH under `/:id/preferences` with rate limiting and schema

- **Gate Pass Schemas**
  - Grading, incoming, nikasi, and storage gate pass create schemas accept optional `manualGatePassNumber` (integer, positive)
  - Incoming gate pass model and nikasi/storage gate pass services persist and return `manualGatePassNumber` when provided

## [1.5.0] - 2026-02-01

### Added

- **Vouchers by Farmer Storage Link**
  - Added GET `/api/bhatti/v1/store-admin/farmer-storage-links/:farmerStorageLinkId/vouchers` to fetch all vouchers (daybook-style entries) for a single farmer-storage-link
  - Returns incoming, grading, storage, nikasi, and outgoing gate passes with summaries; link must belong to the authenticated store admin's cold storage
  - Supports `sortOrder` (asc/desc) and `gatePassType` filter; returns all orders (no pagination)
  - Includes authentication, rate limiting, validation schema, and error handling

### Changed

- **Global Error Handler (app.ts)**
  - Use `AppError` instanceof check for custom errors so `code` and `message` are always sent
  - Handle plugin errors with fallbacks so response never sends empty `error: {}`
  - Safer access to `error.message` with optional chaining

- **Store Admin Daybook**
  - `getDaybook` now accepts optional `overrideFarmerStorageLinkIds` and `unbounded` option for vouchers-by-link
  - Daybook summary uses `initialQuantity` instead of `quantityIssued` for bag totals

- **Gate Pass Models (Indexes)**
  - Removed redundant compound index `{ createdBy: 1 }` from grading, incoming, nikasi, outgoing, and storage gate pass schemas (rely on field-level index)

## [1.4.0] - 2026-01-30

### Added

- **Nikasi Gate Pass Listing by Cold Storage**
  - Added GET `/api/v1/nikasi-gate-pass` to fetch all nikasi gate passes for the authenticated store admin's cold storage
  - Returns nikasi gate passes with populated grading gate pass, incoming gate pass, farmer storage link, farmer, and linked-by details
  - Includes authentication, rate limiting, and error handling

### Changed

- **Nikasi Gate Pass Model**
  - Removed `location` field from nikasi grading gate pass snapshot bag size (interface and schema)

- **Nikasi Gate Pass Service**
  - Added size normalization for bag sizes (handles en-dash, hyphen, and Unicode dash variants) so allocations match correctly across grading and nikasi
  - Fixed bulk update operations to use grading pass map and original `orderDetails.size` in array filters for reliable decrements
  - Snapshot bag sizes no longer include a `location` field

## [1.3.0] - 2026-01-29

### Added

- **Incoming Gate Pass Listing by Cold Storage**
  - Added API to fetch all incoming gate passes for the authenticated store admin's cold storage
  - Includes farmer, linked-by, and received-by details with proper authentication and error handling

- **Gate Pass Voucher Sequencing Utilities**
  - Added utilities to generate the next voucher (gate pass) number per cold storage and voucher type
  - Supports incoming, grading, storage, nikasi, and outgoing gate pass voucher sequencing
  - Added validation schema for voucher type queries using Zod

### Changed

- **Authentication Payload**
  - Updated JWT payload typing to support both string and populated `coldStorageId` values for better compatibility

- **Models and Indexes**
  - Cleaned up Mongoose schema indexes on farmer and gate pass models to simplify idempotency key handling and avoid unnecessary indexes

## [1.2.0] - 2026-01-28

### Added

- **Nikasi Gate Pass Module**
  - Added complete nikasi gate pass module with routes, controller, service, model, and schema
  - Integrated nikasi gate pass routes into main application at `/api/v1/nikasi-gate-pass`
  - Supports creating nikasi gate passes from grading gate pass allocations
  - Includes audit trail functionality with nikasi gate pass audit model
  - Full validation and error handling with rate limiting

- **Outgoing Gate Pass Module**
  - Added complete outgoing gate pass module with routes, controller, service, model, and schema
  - Integrated outgoing gate pass routes into main application at `/api/v1/outgoing-gate-pass`
  - Supports creating outgoing gate passes from storage gate pass allocations
  - Includes audit trail functionality with outgoing gate pass audit model
  - Full validation and error handling with rate limiting

### Changed

- **Application Configuration**
  - Updated `app.ts` to register nikasi gate pass routes
  - Updated `app.ts` to register outgoing gate pass routes
  - Improved route organization and module structure

## [1.1.0] - 2026-01-25

### Added

- **Store Admin Module**
  - Added complete store admin module with routes, controller, service, model, and schema
  - Integrated store admin routes into main application at `/api/bhatti/v1/store-admin`

- **Role Permission Module**
  - Added role permission module structure with routes, controller, service, model, and schema
  - Foundation for role-based access control system

### Changed

- **Cold Storage Module Refactoring**
  - Renamed cold storage module files from kebab-case to camelCase for consistency
  - Updated file naming convention: `cold-storage-controller.ts` → `cold-storage.controller.ts`
  - Updated file naming convention: `cold-storage-model.ts` → `cold-storage.model.ts`
  - Updated file naming convention: `cold-storage-routes.ts` → `cold-storage.routes.ts`
  - Updated file naming convention: `cold-storage-schema.ts` → `cold-storage.schema.ts`
  - Updated file naming convention: `cold-storage-service.ts` → `cold-storage.service.ts`

- **Application Configuration**
  - Updated `app.ts` to register store admin routes
  - Improved route organization and module structure

## [1.0.0] - 2026-01-25

### Added

- **TypeScript Configuration**
  - Added `tsconfig.json` with strict type checking enabled
  - Configured for ES2022 target with ESNext modules
  - Set up source maps and declaration files for better development experience

- **ESLint Setup**
  - Configured ESLint 9 with flat config format (`eslint.config.js`)
  - Integrated TypeScript ESLint plugin for TypeScript-specific linting
  - Added Prettier integration to ensure consistent code formatting
  - Configured rules for unused variables with underscore prefix exception

- **Prettier Configuration**
  - Added `.prettierrc` with consistent formatting rules
  - Configured single quotes, semicolons, and 80 character line width
  - Added `.prettierignore` to exclude build artifacts and dependencies

- **Husky Git Hooks**
  - Set up Husky v9 for Git hooks management
  - Configured pre-commit hook to run lint-staged
  - Added lint-staged configuration to format and lint staged files automatically

- **Package Scripts**
  - `dev`: Development mode with hot reload using tsx
  - `build`: Compile TypeScript to JavaScript
  - `start`: Run production build
  - `lint`: Check for linting errors
  - `lint:fix`: Auto-fix linting errors
  - `format`: Format code with Prettier
  - `format:check`: Check if code is formatted
  - `type-check`: Type check without building

- **Project Structure**
  - Created `src/` directory for source code
  - Added basic `src/index.ts` entry point
  - Configured build output to `dist/` directory

- **Development Dependencies**
  - TypeScript 5.7.2
  - ESLint 9.17.0 with TypeScript support
  - Prettier 3.4.2
  - Husky 9.1.7
  - lint-staged 15.2.11
  - tsx 4.19.2 for development
  - @types/node for Node.js type definitions

### Changed

- Updated package.json to use pnpm as package manager
- Set module type to ES modules

### Technical Details

- All source code is organized in the `src/` directory
- Build output goes to `dist/` directory
- Pre-commit hooks ensure code quality before commits
- Strict TypeScript configuration for type safety
- Modern ESLint flat config format for better maintainability
