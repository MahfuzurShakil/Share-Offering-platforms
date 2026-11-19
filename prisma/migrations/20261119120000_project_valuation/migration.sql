-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "description" TEXT,
ADD COLUMN     "total_shares" INTEGER,
ADD COLUMN     "valuation" DECIMAL(18,2),
ADD COLUMN     "valuation_date" DATE;

