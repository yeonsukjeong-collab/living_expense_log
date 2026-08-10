const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL 환경변수가 설정되어 있지 않습니다. .env.example을 참고하세요.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  card_company TEXT NOT NULL,
  card_label TEXT,
  amount INTEGER NOT NULL,
  method TEXT,
  merchant TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  balance_label TEXT,
  balance_amount INTEGER,
  raw_sms TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transactions_occurred_at ON transactions (occurred_at DESC);

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS receipt_image TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS memo TEXT;
`;

async function initSchema() {
  await pool.query(SCHEMA);
}

module.exports = { pool, initSchema };
