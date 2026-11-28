/* =====================================================================
   Insurance Global · Migración 002: datos completos del registro de clientes
   Ejecutar UNA vez en el Editor de consultas del portal de Azure
   (con el usuario administrador de SQL). Se puede repetir sin problema.
   ===================================================================== */
IF COL_LENGTH('dbo.ig_users', 'first_names') IS NULL ALTER TABLE dbo.ig_users ADD first_names NVARCHAR(60) NULL;
IF COL_LENGTH('dbo.ig_users', 'last_names')  IS NULL ALTER TABLE dbo.ig_users ADD last_names  NVARCHAR(60) NULL;
IF COL_LENGTH('dbo.ig_users', 'birth_date')  IS NULL ALTER TABLE dbo.ig_users ADD birth_date  DATE NULL;
IF COL_LENGTH('dbo.ig_users', 'consent_at')  IS NULL ALTER TABLE dbo.ig_users ADD consent_at  DATETIME2 NULL;
GO
SELECT name AS columna FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ig_users') AND name IN ('first_names','last_names','birth_date','consent_at');
