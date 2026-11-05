-- CreateTable
CREATE TABLE "YjsState" (
    "pageId" TEXT NOT NULL,
    "state" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "YjsState_pkey" PRIMARY KEY ("pageId")
);

-- AddForeignKey
ALTER TABLE "YjsState" ADD CONSTRAINT "YjsState_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
