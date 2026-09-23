-- Run this once in the Azure portal: your database > Query editor
CREATE TABLE dbo.StockCounts (
    Id          INT IDENTITY(1,1) PRIMARY KEY,
    FirstName   NVARCHAR(100) NOT NULL,
    LastName    NVARCHAR(100) NOT NULL,
    Apples      INT NOT NULL CHECK (Apples >= 0),
    Bananas     INT NOT NULL CHECK (Bananas >= 0),
    Sultanas    INT NOT NULL CHECK (Sultanas >= 0),
    SubmittedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
