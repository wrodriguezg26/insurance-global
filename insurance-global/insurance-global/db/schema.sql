/* =====================================================================
   Insurance Global · Esquema de base de datos (Azure SQL Database)
   Ejecutar una vez en el "Editor de consultas" del portal de Azure.
   Se puede volver a ejecutar: solo crea lo que no existe.
   ===================================================================== */

/* Usuarios: administradores, asesores y clientes */
IF OBJECT_ID('dbo.ig_users', 'U') IS NULL
CREATE TABLE dbo.ig_users (
    id            INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_ig_users PRIMARY KEY,
    email         NVARCHAR(160) NOT NULL CONSTRAINT uq_ig_users_email UNIQUE,
    name          NVARCHAR(120) NOT NULL,
    role          NVARCHAR(12)  NOT NULL CONSTRAINT ck_ig_users_role CHECK (role IN ('admin', 'asesor', 'cliente')),
    office        NVARCHAR(8)   NULL,
    doc_type      NVARCHAR(40)  NULL,
    doc           NVARCHAR(20)  NULL,
    phone         NVARCHAR(20)  NULL,
    pwd_hash      NVARCHAR(256) NOT NULL,
    failed        INT           NOT NULL CONSTRAINT df_ig_users_failed DEFAULT 0,
    locked_until  DATETIME2     NULL,
    active        BIT           NOT NULL CONSTRAINT df_ig_users_active DEFAULT 1,
    must_change   BIT           NOT NULL CONSTRAINT df_ig_users_mc DEFAULT 0,
    created_at    DATETIME2     NOT NULL CONSTRAINT df_ig_users_created DEFAULT SYSUTCDATETIME(),
    last_login    DATETIME2     NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ux_ig_users_doc')
CREATE UNIQUE INDEX ux_ig_users_doc ON dbo.ig_users(doc) WHERE doc IS NOT NULL;
GO

/* Contadores para numerar transacciones, pólizas, radicados y correos */
IF OBJECT_ID('dbo.ig_counters', 'U') IS NULL
CREATE TABLE dbo.ig_counters (
    name   NVARCHAR(40) NOT NULL CONSTRAINT pk_ig_counters PRIMARY KEY,
    value  INT          NOT NULL
);
GO

/* Transacciones y pólizas (columnas para consultar + documento JSON completo) */
IF OBJECT_ID('dbo.ig_tx', 'U') IS NULL
CREATE TABLE dbo.ig_tx (
    id             NVARCHAR(16)  NOT NULL CONSTRAINT pk_ig_tx PRIMARY KEY,
    created_at     DATETIME2     NOT NULL,
    channel        NVARCHAR(10)  NOT NULL CONSTRAINT ck_ig_tx_channel CHECK (channel IN ('web', 'oficina')),
    office         NVARCHAR(8)   NULL,
    seller_id      INT           NULL CONSTRAINT fk_ig_tx_seller REFERENCES dbo.ig_users(id),
    customer_id    INT           NULL CONSTRAINT fk_ig_tx_customer REFERENCES dbo.ig_users(id),
    product        NVARCHAR(12)  NOT NULL,
    status         NVARCHAR(16)  NOT NULL,
    policy         NVARCHAR(24)  NULL,
    approval_code  NVARCHAR(32)  NULL,
    client_doc     NVARCHAR(20)  NOT NULL,
    client_email   NVARCHAR(160) NOT NULL,
    total          DECIMAL(18,0) NOT NULL,
    data           NVARCHAR(MAX) NOT NULL CONSTRAINT ck_ig_tx_json CHECK (ISJSON(data) = 1)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ux_ig_tx_policy')
CREATE UNIQUE INDEX ux_ig_tx_policy ON dbo.ig_tx(policy) WHERE policy IS NOT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_ig_tx_customer')
CREATE INDEX ix_ig_tx_customer ON dbo.ig_tx(customer_id, client_doc);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_ig_tx_office')
CREATE INDEX ix_ig_tx_office ON dbo.ig_tx(channel, office, created_at);
GO

/* Historial de cada transacción */
IF OBJECT_ID('dbo.ig_tx_log', 'U') IS NULL
CREATE TABLE dbo.ig_tx_log (
    id       BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT pk_ig_tx_log PRIMARY KEY,
    tx_id    NVARCHAR(16)  NOT NULL CONSTRAINT fk_ig_tx_log_tx REFERENCES dbo.ig_tx(id),
    at       DATETIME2     NOT NULL,
    ev       NVARCHAR(600) NOT NULL,
    by_name  NVARCHAR(160) NOT NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_ig_tx_log_tx')
CREATE INDEX ix_ig_tx_log_tx ON dbo.ig_tx_log(tx_id, id);
GO

/* Auditoría encadenada: cada registro guarda una huella HMAC que depende del anterior */
IF OBJECT_ID('dbo.ig_audit', 'U') IS NULL
CREATE TABLE dbo.ig_audit (
    n        INT           NOT NULL CONSTRAINT pk_ig_audit PRIMARY KEY,
    at       DATETIME2     NOT NULL,
    tx       NVARCHAR(24)  NOT NULL,
    ev       NVARCHAR(600) NOT NULL,
    by_name  NVARCHAR(160) NOT NULL,
    h        CHAR(64)      NOT NULL
);
GO

/* Beneficios activados */
IF OBJECT_ID('dbo.ig_benefits', 'U') IS NULL
CREATE TABLE dbo.ig_benefits (
    code         NVARCHAR(32)  NOT NULL CONSTRAINT pk_ig_benefits PRIMARY KEY,
    tx_id        NVARCHAR(16)  NOT NULL CONSTRAINT fk_ig_benefits_tx REFERENCES dbo.ig_tx(id),
    policy       NVARCHAR(24)  NOT NULL,
    benefit      NVARCHAR(16)  NOT NULL,
    detail       NVARCHAR(MAX) NULL,
    at           DATETIME2     NOT NULL,
    mail_to      NVARCHAR(160) NOT NULL,
    client_name  NVARCHAR(120) NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_ig_benefits_tx')
CREATE INDEX ix_ig_benefits_tx ON dbo.ig_benefits(tx_id);
GO

/* Siniestros */
IF OBJECT_ID('dbo.ig_claims', 'U') IS NULL
CREATE TABLE dbo.ig_claims (
    id       NVARCHAR(24)   NOT NULL CONSTRAINT pk_ig_claims PRIMARY KEY,
    at       DATETIME2      NOT NULL,
    policy   NVARCHAR(24)   NOT NULL,
    user_id  INT            NULL CONSTRAINT fk_ig_claims_user REFERENCES dbo.ig_users(id),
    tipo     NVARCHAR(60)   NOT NULL,
    fecha    DATE           NOT NULL,
    ciudad   NVARCHAR(60)   NOT NULL,
    descr    NVARCHAR(2000) NOT NULL
);
GO

/* Peticiones, quejas y reclamos */
IF OBJECT_ID('dbo.ig_pqr', 'U') IS NULL
CREATE TABLE dbo.ig_pqr (
    id       NVARCHAR(24)   NOT NULL CONSTRAINT pk_ig_pqr PRIMARY KEY,
    at       DATETIME2      NOT NULL,
    tipo     NVARCHAR(20)   NOT NULL,
    nombre   NVARCHAR(120)  NOT NULL,
    doc      NVARCHAR(20)   NOT NULL,
    email    NVARCHAR(160)  NOT NULL,
    poliza   NVARCHAR(24)   NULL,
    msg      NVARCHAR(2000) NOT NULL,
    due      DATETIME2      NOT NULL,
    user_id  INT            NULL CONSTRAINT fk_ig_pqr_user REFERENCES dbo.ig_users(id)
);
GO

/* Correos enviados (certificados y confirmaciones de beneficios) */
IF OBJECT_ID('dbo.ig_outbox', 'U') IS NULL
CREATE TABLE dbo.ig_outbox (
    id            NVARCHAR(24)  NOT NULL CONSTRAINT pk_ig_outbox PRIMARY KEY,
    at            DATETIME2     NOT NULL,
    to_addr       NVARCHAR(160) NOT NULL,
    subject       NVARCHAR(200) NOT NULL,
    policy        NVARCHAR(24)  NOT NULL,
    tx_id         NVARCHAR(16)  NOT NULL,
    kind          NVARCHAR(10)  NOT NULL CONSTRAINT ck_ig_outbox_kind CHECK (kind IN ('policy', 'benefit')),
    benefit_code  NVARCHAR(32)  NULL,
    status        NVARCHAR(12)  NOT NULL,
    note          NVARCHAR(400) NULL,
    sent_at       DATETIME2     NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_ig_outbox_policy')
CREATE INDEX ix_ig_outbox_policy ON dbo.ig_outbox(policy, kind, status);
GO

/* Usuario de la aplicación con permisos mínimos (recomendado en vez del administrador del servidor).
   Cambia la contraseña antes de ejecutar este bloque y usa este usuario en SQL_CONNECTION_STRING.

CREATE USER ig_app WITH PASSWORD = 'CAMBIA-ESTA-CLAVE-Larga-2026!';
ALTER ROLE db_datareader ADD MEMBER ig_app;
ALTER ROLE db_datawriter ADD MEMBER ig_app;
*/

/* Comprobación */
SELECT name AS tabla FROM sys.tables WHERE name LIKE 'ig[_]%' ORDER BY name;
