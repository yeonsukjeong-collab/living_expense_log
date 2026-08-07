const crypto = require("crypto");

const COOKIE_NAME = "session";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30일

function secret() {
  if (!process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET 환경변수가 설정되어 있지 않습니다.");
  }
  return process.env.SESSION_SECRET;
}

function sign(value) {
  const hmac = crypto.createHmac("sha256", secret()).update(value).digest("hex");
  return `${value}.${hmac}`;
}

function verify(token) {
  if (!token || !token.includes(".")) return false;
  const [value, hmac] = token.split(".");
  const expected = crypto.createHmac("sha256", secret()).update(value).digest("hex");
  const a = Buffer.from(hmac);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function checkPassword(candidate) {
  const expected = process.env.APP_PASSWORD || "";
  const a = Buffer.from(String(candidate || ""));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function issueSession(res) {
  const token = sign(`ok:${Date.now()}`);
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE_MS,
  });
}

function clearSession(res) {
  res.clearCookie(COOKIE_NAME);
}

function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (verify(token)) return next();
  if (req.originalUrl.startsWith("/api/")) {
    return res.status(401).json({ error: "로그인이 필요합니다." });
  }
  return res.redirect("/login.html");
}

module.exports = { checkPassword, issueSession, clearSession, requireAuth, COOKIE_NAME };
