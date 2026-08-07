require("dotenv").config();

const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");

const { pool, initSchema } = require("./db");
const { checkPassword, issueSession, clearSession, requireAuth } = require("./auth");
const { parseAll } = require("./parse");

const app = express();
const PUBLIC_DIR = path.join(__dirname, "..", "public");

app.use(express.json());
app.use(cookieParser());

// ---- 인증 ----
app.post("/api/login", (req, res) => {
  if (checkPassword(req.body && req.body.password)) {
    issueSession(res);
    return res.json({ ok: true });
  }
  res.status(401).json({ error: "비밀번호가 올바르지 않습니다." });
});

app.post("/api/logout", (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

app.get("/login.html", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "login.html"));
});

app.use(express.static(PUBLIC_DIR, { index: false }));

app.get(["/", "/index.html"], requireAuth, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

// ---- API ----
const api = express.Router();
api.use(requireAuth);

api.get("/summary", async (req, res) => {
  const totals = await pool.query(
    `SELECT COUNT(*)::int AS count,
            COALESCE(SUM(amount), 0)::int AS total,
            MIN(occurred_at) AS earliest,
            MAX(occurred_at) AS latest
     FROM transactions`
  );
  const byCard = await pool.query(
    `SELECT card_company, COALESCE(SUM(amount), 0)::int AS total, COUNT(*)::int AS count
     FROM transactions
     GROUP BY card_company
     ORDER BY total DESC`
  );
  res.json({ ...totals.rows[0], byCard: byCard.rows });
});

const TX_WITH_ITEMS_SQL = `
  SELECT t.id, t.card_company, t.card_label, t.amount, t.method, t.merchant,
         t.occurred_at, t.balance_label, t.balance_amount, t.raw_sms, t.created_at,
         COALESCE(
           json_agg(
             json_build_object('id', ri.id, 'name', ri.name, 'price', ri.price, 'qty', ri.qty)
             ORDER BY ri.id
           ) FILTER (WHERE ri.id IS NOT NULL),
           '[]'
         ) AS items
  FROM transactions t
  LEFT JOIN receipt_items ri ON ri.transaction_id = t.id
  GROUP BY t.id
`;

api.get("/transactions", async (req, res) => {
  const { rows } = await pool.query(`${TX_WITH_ITEMS_SQL} ORDER BY t.occurred_at DESC, t.id DESC`);
  res.json(rows);
});

api.post("/parse", (req, res) => {
  const text = req.body && req.body.text;
  if (!text || !text.trim()) {
    return res.status(400).json({ error: "문자 내용을 입력해 주세요." });
  }
  res.json({ results: parseAll(text) });
});

function validateTxBody(body) {
  const errors = [];
  if (!body.card_company || !String(body.card_company).trim()) errors.push("카드사가 필요합니다.");
  if (!body.merchant || !String(body.merchant).trim()) errors.push("가맹점명이 필요합니다.");
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) errors.push("금액이 올바르지 않습니다.");
  if (!body.occurred_at || Number.isNaN(Date.parse(body.occurred_at))) errors.push("거래 일시가 올바르지 않습니다.");
  return errors;
}

api.post("/transactions", async (req, res) => {
  const body = req.body || {};
  const errors = validateTxBody(body);
  if (errors.length) return res.status(400).json({ error: errors.join(" ") });

  const { rows } = await pool.query(
    `INSERT INTO transactions
       (card_company, card_label, amount, method, merchant, occurred_at, balance_label, balance_amount, raw_sms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      body.card_company,
      body.card_label || null,
      Math.round(Number(body.amount)),
      body.method || null,
      body.merchant,
      body.occurred_at,
      body.balance_label || null,
      body.balance_amount != null ? Math.round(Number(body.balance_amount)) : null,
      body.raw_sms || null,
    ]
  );
  res.status(201).json({ ...rows[0], items: [] });
});

api.patch("/transactions/:id", async (req, res) => {
  const body = req.body || {};
  const errors = validateTxBody(body);
  if (errors.length) return res.status(400).json({ error: errors.join(" ") });

  const { rows } = await pool.query(
    `UPDATE transactions SET
       card_company=$1, card_label=$2, amount=$3, method=$4, merchant=$5, occurred_at=$6,
       balance_label=$7, balance_amount=$8
     WHERE id=$9
     RETURNING *`,
    [
      body.card_company,
      body.card_label || null,
      Math.round(Number(body.amount)),
      body.method || null,
      body.merchant,
      body.occurred_at,
      body.balance_label || null,
      body.balance_amount != null ? Math.round(Number(body.balance_amount)) : null,
      req.params.id,
    ]
  );
  if (!rows.length) return res.status(404).json({ error: "거래를 찾을 수 없습니다." });
  res.json(rows[0]);
});

api.delete("/transactions/:id", async (req, res) => {
  const { rowCount } = await pool.query("DELETE FROM transactions WHERE id=$1", [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: "거래를 찾을 수 없습니다." });
  res.status(204).end();
});

api.post("/transactions/:id/items", async (req, res) => {
  const body = req.body || {};
  const price = Number(body.price);
  const qty = body.qty ? Number(body.qty) : 1;
  if (!body.name || !String(body.name).trim()) return res.status(400).json({ error: "항목명이 필요합니다." });
  if (!Number.isFinite(price) || price < 0) return res.status(400).json({ error: "가격이 올바르지 않습니다." });
  if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ error: "수량이 올바르지 않습니다." });

  const { rows } = await pool.query(
    `INSERT INTO receipt_items (transaction_id, name, price, qty)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [req.params.id, body.name.trim(), Math.round(price), Math.round(qty)]
  );
  res.status(201).json(rows[0]);
});

api.delete("/items/:id", async (req, res) => {
  const { rowCount } = await pool.query("DELETE FROM receipt_items WHERE id=$1", [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: "항목을 찾을 수 없습니다." });
  res.status(204).end();
});

api.get("/export", async (req, res) => {
  const { rows } = await pool.query(`${TX_WITH_ITEMS_SQL} ORDER BY t.occurred_at DESC`);
  res.setHeader("Content-Disposition", `attachment; filename="ledger-export-${Date.now()}.json"`);
  res.json(rows);
});

app.use("/api", api);

const PORT = process.env.PORT || 3000;

initSchema()
  .then(() => {
    app.listen(PORT, () => console.log(`가계부 서버 실행 중: http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error("DB 스키마 초기화 실패:", err);
    process.exit(1);
  });
