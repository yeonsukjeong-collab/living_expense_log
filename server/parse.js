function toInt(numStr) {
  return parseInt(String(numStr).replace(/,/g, ""), 10);
}

function toIsoKst(mm, dd, hh, mi) {
  const now = new Date();
  let year = now.getFullYear();
  const candidate = new Date(`${year}-${mm}-${dd}T${hh}:${mi}:00+09:00`);
  // 문자에는 연도가 없으므로 현재 연도를 쓰되, 미래 날짜가 되면 작년으로 보정한다.
  if (candidate.getTime() - now.getTime() > 24 * 60 * 60 * 1000) {
    year -= 1;
  }
  return `${year}-${mm}-${dd}T${hh}:${mi}:00+09:00`;
}

function splitMessages(text) {
  const normalized = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  const startRe = /^\[Web발신\]\s*$|^KB국민카드\d|^\[신한.*승인\]/gm;
  const indices = [];
  let m;
  while ((m = startRe.exec(normalized))) indices.push(m.index);
  if (indices.length <= 1) {
    return normalized.split(/\n\s*\n+/).map((s) => s.trim()).filter(Boolean);
  }
  const blocks = [];
  for (let i = 0; i < indices.length; i++) {
    const start = indices[i];
    const end = i + 1 < indices.length ? indices[i + 1] : normalized.length;
    blocks.push(normalized.slice(start, end).trim());
  }
  return blocks;
}

function getLines(text) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^\[.*\]$/.test(l));
}

function parseShinhan(text) {
  const re =
    /\[신한(체크)?승인\]\s*[가-힣*]+\((\d{2,4})\)\s+(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})\s+([\d,]+)원\s+(.+?)\s+(누적|잔액)\s*([\d,]+)원/;
  const m = text.match(re);
  if (!m) return null;
  const [, isCheck, last4, mm, dd, hh, mi, amount, merchant, balanceLabel, balanceAmount] = m;
  return {
    card_company: isCheck ? "신한체크카드" : "신한카드",
    card_label: last4,
    amount: toInt(amount),
    method: null,
    merchant: merchant.trim(),
    occurred_at: toIsoKst(mm, dd, hh, mi),
    balance_label: balanceLabel,
    balance_amount: toInt(balanceAmount),
    raw_sms: text,
  };
}

function parseKb(text) {
  const lines = getLines(text);
  const kbIdx = lines.findIndex((l) => /^KB국민카드\s*(\d+)/.test(l));
  const amountIdx = lines.findIndex((l) => /^[\d,]+\s*원\s*\(/.test(l));
  const timeIdx = lines.findIndex((l) => /^승인시각\s+\d{2}\/\d{2}\s+\d{2}:\d{2}$/.test(l));
  const balanceIdx = lines.findIndex((l) => /(누적|잔액)\s*[\d,]+\s*원/.test(l));

  if (kbIdx === -1 || amountIdx === -1 || timeIdx === -1) return null;

  const cardTail = lines[kbIdx].match(/^KB국민카드\s*(\d+)/)[1];
  const amountMatch = lines[amountIdx].match(/^([\d,]+)\s*원\s*\(([^)]*)\)$/);
  const timeMatch = lines[timeIdx].match(/^승인시각\s+(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})$/);
  const merchant = lines[amountIdx + 1];
  if (!amountMatch || !timeMatch || !merchant) return null;

  let balanceLabel = null;
  let balanceAmount = null;
  if (balanceIdx !== -1) {
    const balanceMatch = lines[balanceIdx].match(/(누적|잔액)\s*([\d,]+)\s*원/);
    if (balanceMatch) {
      balanceLabel = balanceMatch[1];
      balanceAmount = toInt(balanceMatch[2]);
    }
  }

  return {
    card_company: "KB국민카드",
    card_label: cardTail,
    amount: toInt(amountMatch[1]),
    method: amountMatch[2] || null,
    merchant,
    occurred_at: toIsoKst(timeMatch[1], timeMatch[2], timeMatch[3], timeMatch[4]),
    balance_label: balanceLabel,
    balance_amount: balanceAmount,
    raw_sms: text,
  };
}

function parseHyundai(text) {
  const lines = getLines(text);
  const headerIdx = lines.findIndex((l) => /^현대(카드)?\s/.test(l));
  const amountIdx = lines.findIndex((l) => /^[\d,]+\s*원(\s|$)/.test(l));
  const dateIdx = lines.findIndex((l) => /^\d{2}\/\d{2}\s+\d{2}:\d{2}$/.test(l));
  const balanceIdx = lines.findIndex((l) => /(누적|잔액)\s*[\d,]+\s*원/.test(l));

  if (headerIdx === -1 || amountIdx === -1 || dateIdx === -1) return null;

  const headerMatch = lines[headerIdx].match(/^현대(?:카드)?\s*(.*?)\s*승인$/);
  const amountMatch = lines[amountIdx].match(/^([\d,]+)\s*원\s*([가-힣]*)$/);
  const dateMatch = lines[dateIdx].match(/^(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!amountMatch || !dateMatch) return null;

  let merchant = null;
  for (let i = dateIdx + 1; i < lines.length; i++) {
    if (i === balanceIdx) break;
    merchant = lines[i];
    break;
  }
  if (!merchant) return null;

  let balanceLabel = null;
  let balanceAmount = null;
  if (balanceIdx !== -1) {
    const balanceMatch = lines[balanceIdx].match(/(누적|잔액)\s*([\d,]+)\s*원/);
    if (balanceMatch) {
      balanceLabel = balanceMatch[1];
      balanceAmount = toInt(balanceMatch[2]);
    }
  }

  return {
    card_company: "현대카드",
    card_label: headerMatch ? headerMatch[1] || null : null,
    amount: toInt(amountMatch[1]),
    method: amountMatch[2] || null,
    merchant,
    occurred_at: toIsoKst(dateMatch[1], dateMatch[2], dateMatch[3], dateMatch[4]),
    balance_label: balanceLabel,
    balance_amount: balanceAmount,
    raw_sms: text,
  };
}

function parseMessage(text) {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, raw: text };

  if (/신한/.test(trimmed)) {
    const r = parseShinhan(trimmed);
    if (r) return { ok: true, data: r };
  }
  if (/KB국민카드/.test(trimmed)) {
    const r = parseKb(trimmed);
    if (r) return { ok: true, data: r };
  }
  if (/현대카드|^현대\s/m.test(trimmed)) {
    const r = parseHyundai(trimmed);
    if (r) return { ok: true, data: r };
  }
  return { ok: false, raw: text };
}

function parseAll(text) {
  return splitMessages(text).map(parseMessage);
}

module.exports = { parseAll, parseMessage, splitMessages };
