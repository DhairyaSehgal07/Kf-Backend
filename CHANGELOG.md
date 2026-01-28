# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
