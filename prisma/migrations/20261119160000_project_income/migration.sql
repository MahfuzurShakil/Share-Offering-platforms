-- CreateEnum
CREATE TYPE "ProjectIncomeType" AS ENUM ('rent', 'resale', 'operation', 'mixed', 'undecided');

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "expected_hold_months" INTEGER,
ADD COLUMN     "income_type" "ProjectIncomeType" NOT NULL DEFAULT 'undecided';

