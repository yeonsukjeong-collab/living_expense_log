require("dotenv").config();

const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");

const { pool, initSchema } = require("./db");
const { checkPassword, issueSession, clearSession, requireAuth } = require("./auth");
const { parseAll } = require("./parse");

const app = express();
const PUBLIC_DIR = path.join(__dirname, "..", "public");

app.use(express.json({ limit: "8mb" }));
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

function dateRangeClause(req, column) {
  const conditions = [];
  const params = [];
  if (req.query.from) {
    params.push(req.query.from);
    conditions.push(`${column} >= $${params.length}`);
  }
  if (req.query.to) {
    params.push(req.query.to);
    conditions.push(`${column} <= $${params.length}`);
  }
  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", params };
}

api.get("/summary", async (req, res) => {
  const { where, params } = dateRangeClause(req, "occurred_at");
  const totals = await pool.query(
    `SELECT COUNT(*)::int AS count,
            COALESCE(SUM(amount), 0)::int AS total,
            MIN(occurred_at) AS earliest,
            MAX(occurred_at) AS latest
     FROM transactions ${where}`,
    params
  );
  const byCard = await pool.query(
    `SELECT card_company, COALESCE(SUM(amount), 0)::int AS total, COUNT(*)::int AS count
     FROM transactions ${where}
     GROUP BY card_company
     ORDER BY total DESC`,
    params
  );
  res.json({ ...totals.rows[0], byCard: byCard.rows });
});

function transactionsSql(whereClause = "") {
  return `
    SELECT id, card_company, card_label, amount, method, merchant, memo,
           occurred_at, balance_label, balance_amount, raw_sms, created_at,
           (receipt_image IS NOT NULL) AS has_receipt_image
    FROM transactions
    ${whereClause}
  `;
}

function shapeTx(row) {
  const { receipt_image, ...rest } = row;
  return { ...rest, has_receipt_image: receipt_image != null };
}

api.get("/transactions", async (req, res) => {
  const { where, params } = dateRangeClause(req, "occurred_at");
  const { rows } = await pool.query(`${transactionsSql(where)} ORDER BY occurred_at DESC, id DESC`, params);
  res.json(rows);
});

api.get("/transactions/check-duplicate", async (req, res) => {
  const { occurred_at, exclude_id } = req.query;
  if (!occurred_at || Number.isNaN(Date.parse(occurred_at))) {
    return res.json({ exists: false, matches: [] });
  }
  const params = [occurred_at];
  let where = "occurred_at = $1";
  if (exclude_id) {
    params.push(exclude_id);
    where += ` AND id <> $${params.length}`;
  }
  const { rows } = await pool.query(
    `SELECT id, card_company, merchant, amount FROM transactions WHERE ${where}`,
    params
  );
  res.json({ exists: rows.length > 0, matches: rows });
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
       (card_company, card_label, amount, method, merchant, memo, occurred_at, balance_label, balance_amount, raw_sms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      body.card_company,
      body.card_label || null,
      Math.round(Number(body.amount)),
      body.method || null,
      body.merchant,
      body.memo || null,
      body.occurred_at,
      body.balance_label || null,
      body.balance_amount != null ? Math.round(Number(body.balance_amount)) : null,
      body.raw_sms || null,
    ]
  );
  res.status(201).json(shapeTx(rows[0]));
});

api.patch("/transactions/:id", async (req, res) => {
  const body = req.body || {};
  const errors = validateTxBody(body);
  if (errors.length) return res.status(400).json({ error: errors.join(" ") });

  const { rows } = await pool.query(
    `UPDATE transactions SET
       card_company=$1, card_label=$2, amount=$3, method=$4, merchant=$5, memo=$6, occurred_at=$7,
       balance_label=$8, balance_amount=$9
     WHERE id=$10
     RETURNING *`,
    [
      body.card_company,
      body.card_label || null,
      Math.round(Number(body.amount)),
      body.method || null,
      body.merchant,
      body.memo || null,
      body.occurred_at,
      body.balance_label || null,
      body.balance_amount != null ? Math.round(Number(body.balance_amount)) : null,
      req.params.id,
    ]
  );
  if (!rows.length) return res.status(404).json({ error: "거래를 찾을 수 없습니다." });
  res.json(shapeTx(rows[0]));
});

api.delete("/transactions/:id", async (req, res) => {
  const { rowCount } = await pool.query("DELETE FROM transactions WHERE id=$1", [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: "거래를 찾을 수 없습니다." });
  res.status(204).end();
});

api.get("/transactions/:id/receipt-image", async (req, res) => {
  const { rows } = await pool.query("SELECT receipt_image FROM transactions WHERE id=$1", [req.params.id]);
  if (!rows.length || !rows[0].receipt_image) {
    return res.status(404).json({ error: "등록된 영수증 이미지가 없습니다." });
  }
  res.json({ image: rows[0].receipt_image });
});

api.put("/transactions/:id/receipt-image", async (req, res) => {
  const image = req.body && req.body.image;
  if (!image || typeof image !== "string" || !image.startsWith("data:image/")) {
    return res.status(400).json({ error: "올바른 이미지 데이터가 아닙니다." });
  }
  const { rowCount } = await pool.query("UPDATE transactions SET receipt_image=$1 WHERE id=$2", [image, req.params.id]);
  if (!rowCount) return res.status(404).json({ error: "거래를 찾을 수 없습니다." });
  res.json({ ok: true });
});

api.delete("/transactions/:id/receipt-image", async (req, res) => {
  const { rowCount } = await pool.query("UPDATE transactions SET receipt_image=NULL WHERE id=$1", [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: "거래를 찾을 수 없습니다." });
  res.status(204).end();
});

api.get("/export", async (req, res) => {
  const { rows } = await pool.query(`${transactionsSql()} ORDER BY occurred_at DESC`);
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
