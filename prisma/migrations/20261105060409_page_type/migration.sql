-- CreateEnum
CREATE TYPE "PageType" AS ENUM ('DOC', 'BOARD');

-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "type" "PageType" NOT NULL DEFAULT 'DOC';
