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

CREATE TABLE IF NOT EXISTS receipt_items (
  id SERIAL PRIMARY KEY,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transactions_occurred_at ON transactions (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_receipt_items_transaction_id ON receipt_items (transaction_id);
`;

async function initSchema() {
  await pool.query(SCHEMA);
}

module.exports = { pool, initSchema };
