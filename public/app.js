"use strict";

const openIds = new Set();
let lastTransactions = [];
let uploadingTxId = null;
let filePickResolved = false;

// ---- helpers ----
function esc(str) {
  return String(str ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function money(n) {
  return (n ?? 0).toLocaleString("ko-KR") + "원";
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function cardKey(company) {
  if (!company) return "other";
  if (company.includes("KB")) return "kb";
  if (company.includes("현대")) return "hyundai";
  if (company.includes("신한")) return "shinhan";
  if (company.includes("하나")) return "hana";
  if (company.includes("컬리")) return "kurly";
  return "other";
}

function toKstDate(iso) {
  return new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
}
function toKstInputValue(iso) {
  const d = toKstDate(iso);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}
function fromKstInputValue(value) {
  return `${value}:00+09:00`;
}
const WEEKDAYS_KO = ["일", "월", "화", "수", "목", "금", "토"];
function formatKstDateTimeWithWeekday(iso) {
  const d = toKstDate(iso);
  const weekday = WEEKDAYS_KO[d.getUTCDay()];
  return `${pad2(d.getUTCMonth() + 1)}.${pad2(d.getUTCDate())} (${weekday}) ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}
function showToast(msg, isError) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.toggle("error", !!isError);
  el.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove("show"), 2600);
}

// ---- api ----
async function apiFetch(url, opts = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (res.status === 401) {
    location.href = "/login.html?redirect=" + encodeURIComponent(location.pathname);
    throw new Error("로그인이 필요합니다.");
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `요청 실패 (${res.status})`);
  }
  if (res.status === 204) return null;
  return res.json();
}
const apiGet = (url) => apiFetch(url);
const apiPost = (url, body) => apiFetch(url, { method: "POST", body: JSON.stringify(body) });
const apiPatch = (url, body) => apiFetch(url, { method: "PATCH", body: JSON.stringify(body) });
const apiPut = (url, body) => apiFetch(url, { method: "PUT", body: JSON.stringify(body) });
const apiDelete = (url) => apiFetch(url, { method: "DELETE" });

// ---- summary ----
function populateCardFilter(byCard) {
  const select = document.getElementById("card-filter");
  const current = select.value;
  const companies = byCard.map((c) => c.card_company);
  select.innerHTML =
    `<option value="">전체</option>` +
    companies.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  select.value = companies.includes(current) ? current : "";
}

function filterByCard(list) {
  const val = document.getElementById("card-filter").value;
  return val ? list.filter((t) => t.card_company === val) : list;
}

function renderSummary(s) {
  document.getElementById("stat-total").textContent = money(s.total);

  const bar = document.getElementById("bar");
  const legend = document.getElementById("legend");
  bar.innerHTML = "";
  legend.innerHTML = "";
  populateCardFilter(s.byCard);
  if (!s.total) return;
  s.byCard.forEach((c) => {
    const pct = (c.total / s.total) * 100;
    const key = cardKey(c.card_company);
    bar.insertAdjacentHTML("beforeend", `<div class="seg" style="width:${pct}%; background:var(--${key})"></div>`);
    legend.insertAdjacentHTML(
      "beforeend",
      `<span class="legend-item"><span class="legend-dot" style="background:var(--${key})"></span>${esc(c.card_company)} <span class="num">${c.count}건 ${money(c.total)}</span> (${pct.toFixed(1)}%)</span>`
    );
  });
}

// ---- transaction cards ----
function groupTransactions(list) {
  const map = new Map();
  for (const t of list) {
    const key = t.card_company + "|" + (t.card_label || "");
    if (!map.has(key)) map.set(key, { card_company: t.card_company, card_label: t.card_label, items: [], subtotal: 0 });
    const g = map.get(key);
    g.items.push(t);
    g.subtotal += t.amount;
  }
  return [...map.values()];
}

function renderCards(list) {
  const root = document.getElementById("cards");
  if (!list.length) {
    root.innerHTML = '<div class="empty-state">아직 등록된 거래가 없습니다. 위에서 카드 문자를 붙여넣어 추가해 보세요.</div>';
    return;
  }
  root.innerHTML = groupTransactions(list).map(renderGroup).join("");
}

function renderGroup(g) {
  const key = cardKey(g.card_company);
  const labelBadge = g.card_label ? `<span class="no num">${esc(g.card_label)}</span>` : "";
  return `
    <article class="card-group">
      <div class="card-head">
        <span class="dot" style="background:var(--${key})"></span>
        <h2>${esc(g.card_company)} ${labelBadge}</h2>
        <span class="subtotal num">${g.items.length}건 ${money(g.subtotal)}</span>
      </div>
      <ul class="tx-list">${g.items.map(renderTxRow).join("")}</ul>
    </article>
  `;
}

function renderTxRow(t) {
  const open = openIds.has(String(t.id));
  return `
    <li class="tx" data-id="${t.id}">
      <div class="tx-row" data-action="toggle">
        <div class="tx-line1">
          <span class="tx-merchant">${esc(t.merchant)}</span>
          <span class="badges">
            ${
              t.has_receipt_image
                ? `<button type="button" class="chip filled chip-btn" data-action="view-receipt" data-tx-id="${t.id}">영수증</button>`
                : `<button type="button" class="chip chip-btn" data-action="register-receipt" data-tx-id="${t.id}">영수증 등록</button>`
            }
          </span>
          <span class="tx-amount num">${money(t.amount)}</span>
        </div>
        <div class="tx-line2">
          <span class="tx-date num">${formatKstDateTimeWithWeekday(t.occurred_at)}</span>
          ${t.memo ? `<span class="tx-memo">${esc(t.memo)}</span>` : ""}
        </div>
      </div>
      <div class="tx-detail ${open ? "open" : ""}" data-detail>
        ${renderTxDetail(t)}
      </div>
    </li>
  `;
}

function renderTxDetail(t) {
  return `
    <div class="view-block">
      <div class="actions">
        <button class="btn btn-sm" data-action="edit-tx">거래 정보 수정</button>
        <button class="btn btn-sm btn-danger" data-action="delete-tx" data-tx-id="${t.id}">거래 삭제</button>
      </div>
    </div>
    <form class="field-grid edit-form" data-action="save-edit" data-tx-id="${t.id}" style="display:none; margin-top:10px;">
      <label>카드사 <input name="card_company" value="${esc(t.card_company)}" required /></label>
      <label>카드 표시 <input name="card_label" value="${esc(t.card_label || "")}" /></label>
      <label>가맹점 <input name="merchant" value="${esc(t.merchant)}" required /></label>
      <label>메모 <input name="memo" value="${esc(t.memo || "")}" placeholder="예: 목장모임 준비" /></label>
      <input type="hidden" name="method" value="${esc(t.method || "")}" />
      <label>금액 <input name="amount" type="number" min="0" value="${t.amount}" required /></label>
      <label>거래일시 <input name="occurred_at" type="datetime-local" value="${toKstInputValue(t.occurred_at)}" required /></label>
      <label>누적/잔액 라벨 <input name="balance_label" value="${esc(t.balance_label || "")}" /></label>
      <label>누적/잔액 금액 <input name="balance_amount" type="number" min="0" value="${t.balance_amount ?? ""}" /></label>
      <div class="span2 preview-actions">
        <button type="button" class="btn btn-sm btn-ghost" data-action="cancel-edit">취소</button>
        <button type="submit" class="btn btn-sm btn-primary">저장</button>
      </div>
    </form>
  `;
}

// ---- receipt photo (registration + view) ----
function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("이미지를 불러올 수 없습니다."));
    };
    img.src = url;
  });
}

// ---- crop modal ----
let cropObjectUrl = null;

function openCropModal(objectUrl) {
  cropObjectUrl = objectUrl;
  const imgEl = document.getElementById("crop-image");
  imgEl.onload = initCropBox;
  imgEl.src = objectUrl;
  document.getElementById("crop-modal").classList.add("open");
}

function closeCropModal() {
  document.getElementById("crop-modal").classList.remove("open");
  document.getElementById("crop-image").removeAttribute("src");
  if (cropObjectUrl) {
    URL.revokeObjectURL(cropObjectUrl);
    cropObjectUrl = null;
  }
}

// 영수증(밝은 종이)이 배경보다 밝다고 가정하고, Otsu 임계값으로 이진화한 뒤
// 가장 큰 밝은 영역의 경계 상자를 찾아 자동 크롭 영역으로 사용한다.
function autoDetectReceiptBox(imgEl) {
  const maxSample = 400;
  const scale = Math.min(1, maxSample / Math.max(imgEl.naturalWidth, imgEl.naturalHeight));
  const sw = Math.max(1, Math.round(imgEl.naturalWidth * scale));
  const sh = Math.max(1, Math.round(imgEl.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(imgEl, 0, 0, sw, sh);

  let data;
  try {
    data = ctx.getImageData(0, 0, sw, sh).data;
  } catch {
    return null;
  }

  const gray = new Uint8ClampedArray(sw * sh);
  const hist = new Array(256).fill(0);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const g = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    gray[p] = g;
    hist[g]++;
  }

  // Otsu's method: 클래스 간 분산이 최대가 되는 임계값을 찾는다.
  // 분산이 여러 t에 걸쳐 동일한 최댓값(plateau)을 가질 수 있어, 그 구간의 중간값을 최종 임계값으로 쓴다.
  const total = sw * sh;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0,
    wB = 0,
    maxVar = -1,
    plateauStart = 0,
    plateauEnd = 0;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const varBetween = wB * wF * (mB - mF) * (mB - mF);
    if (varBetween > maxVar) {
      maxVar = varBetween;
      plateauStart = t;
      plateauEnd = t;
    } else if (varBetween === maxVar) {
      plateauEnd = t;
    }
  }
  const threshold = Math.round((plateauStart + plateauEnd) / 2);

  const mask = new Uint8Array(sw * sh);
  for (let p = 0; p < gray.length; p++) mask[p] = gray[p] >= threshold ? 1 : 0;

  // 가장 큰 연결된 밝은 영역을 BFS로 찾는다.
  const visited = new Uint8Array(sw * sh);
  const stack = new Int32Array(sw * sh);
  let best = null;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visited[start]) continue;
    let stackLen = 0;
    stack[stackLen++] = start;
    visited[start] = 1;
    let minX = sw,
      maxX = 0,
      minY = sh,
      maxY = 0,
      count = 0;
    while (stackLen > 0) {
      const idx = stack[--stackLen];
      const x = idx % sw;
      const y = (idx / sw) | 0;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0 && mask[idx - 1] && !visited[idx - 1]) {
        visited[idx - 1] = 1;
        stack[stackLen++] = idx - 1;
      }
      if (x < sw - 1 && mask[idx + 1] && !visited[idx + 1]) {
        visited[idx + 1] = 1;
        stack[stackLen++] = idx + 1;
      }
      if (y > 0 && mask[idx - sw] && !visited[idx - sw]) {
        visited[idx - sw] = 1;
        stack[stackLen++] = idx - sw;
      }
      if (y < sh - 1 && mask[idx + sw] && !visited[idx + sw]) {
        visited[idx + sw] = 1;
        stack[stackLen++] = idx + sw;
      }
    }
    if (!best || count > best.count) best = { count, minX, maxX, minY, maxY };
  }

  if (!best) return null;
  const boxArea = (best.maxX - best.minX) * (best.maxY - best.minY);
  const totalArea = sw * sh;
  // 너무 작으면(노이즈) 또는 화면 전체를 덮으면(구분 실패) 자동 인식을 포기한다.
  if (boxArea < totalArea * 0.05 || boxArea > totalArea * 0.98) return null;

  const padX = (best.maxX - best.minX) * 0.03;
  const padY = (best.maxY - best.minY) * 0.03;
  const minX = Math.max(0, best.minX - padX);
  const minY = Math.max(0, best.minY - padY);
  const maxX = Math.min(sw, best.maxX + padX);
  const maxY = Math.min(sh, best.maxY + padY);

  return {
    left: minX / sw,
    top: minY / sh,
    width: (maxX - minX) / sw,
    height: (maxY - minY) / sh,
  };
}

function initCropBox() {
  const imgEl = document.getElementById("crop-image");
  const box = document.getElementById("crop-box");
  const hint = document.getElementById("crop-hint");
  const rect = imgEl.getBoundingClientRect();

  let detected = null;
  try {
    detected = autoDetectReceiptBox(imgEl);
  } catch (err) {
    console.error("영수증 자동 인식 실패:", err);
    detected = null;
  }
  const frac = detected || { left: 0.075, top: 0.075, width: 0.85, height: 0.85 };
  hint.textContent = detected
    ? "영수증 영역을 자동으로 인식했습니다. 필요하면 모서리를 끌어 조정하세요."
    : "영수증 영역을 자동으로 인식하지 못했습니다. 모서리를 끌어 직접 맞춰주세요.";

  Object.assign(box.style, {
    left: `${frac.left * rect.width}px`,
    top: `${frac.top * rect.height}px`,
    width: `${frac.width * rect.width}px`,
    height: `${frac.height * rect.height}px`,
  });
}

(function setupCropBoxInteraction() {
  const stage = document.getElementById("crop-stage");
  const box = document.getElementById("crop-box");
  let mode = null;
  let startPointer = { x: 0, y: 0 };
  let startBox = { left: 0, top: 0, width: 0, height: 0 };

  function clamp(v, min, max) {
    return Math.min(Math.max(v, min), max);
  }

  function beginDrag(e, dragMode) {
    mode = dragMode;
    startPointer = { x: e.clientX, y: e.clientY };
    startBox = {
      left: parseFloat(box.style.left) || 0,
      top: parseFloat(box.style.top) || 0,
      width: parseFloat(box.style.width) || 0,
      height: parseFloat(box.style.height) || 0,
    };
    e.preventDefault();
  }

  box.addEventListener("pointerdown", (e) => {
    if (e.target.classList.contains("crop-handle")) return;
    beginDrag(e, "move");
  });
  box.querySelectorAll(".crop-handle").forEach((handle) => {
    handle.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      beginDrag(e, handle.dataset.handle);
    });
  });

  window.addEventListener("pointermove", (e) => {
    if (!mode) return;
    const dx = e.clientX - startPointer.x;
    const dy = e.clientY - startPointer.y;
    const stageW = stage.clientWidth;
    const stageH = stage.clientHeight;
    const minSize = 30;
    let { left, top, width, height } = startBox;

    if (mode === "move") {
      left = clamp(startBox.left + dx, 0, Math.max(0, stageW - startBox.width));
      top = clamp(startBox.top + dy, 0, Math.max(0, stageH - startBox.height));
    } else {
      if (mode.includes("e")) width = clamp(startBox.width + dx, minSize, stageW - startBox.left);
      if (mode.includes("s")) height = clamp(startBox.height + dy, minSize, stageH - startBox.top);
      if (mode.includes("w")) {
        const newLeft = clamp(startBox.left + dx, 0, startBox.left + startBox.width - minSize);
        width = startBox.width + (startBox.left - newLeft);
        left = newLeft;
      }
      if (mode.includes("n")) {
        const newTop = clamp(startBox.top + dy, 0, startBox.top + startBox.height - minSize);
        height = startBox.height + (startBox.top - newTop);
        top = newTop;
      }
    }

    Object.assign(box.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
  });

  window.addEventListener("pointerup", () => {
    mode = null;
  });
})();

async function performCropAndUpload(txId) {
  if (!txId) {
    closeCropModal();
    showToast("등록할 거래를 찾지 못했습니다. 다시 시도해 주세요.", true);
    return;
  }
  try {
    const imgEl = document.getElementById("crop-image");
    const box = document.getElementById("crop-box");
    const displayRect = imgEl.getBoundingClientRect();
    const boxRect = {
      left: parseFloat(box.style.left) || 0,
      top: parseFloat(box.style.top) || 0,
      width: parseFloat(box.style.width) || 0,
      height: parseFloat(box.style.height) || 0,
    };
    if (!imgEl.naturalWidth || !displayRect.width || !boxRect.width || !boxRect.height) {
      throw new Error("자를 영역을 아직 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
    const scaleX = imgEl.naturalWidth / displayRect.width;
    const scaleY = imgEl.naturalHeight / displayRect.height;
    const sx = boxRect.left * scaleX;
    const sy = boxRect.top * scaleY;
    const sw = boxRect.width * scaleX;
    const sh = boxRect.height * scaleY;

    const maxDim = 1600;
    const scale = Math.min(1, maxDim / Math.max(sw, sh));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
    canvas.getContext("2d").drawImage(imgEl, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);

    closeCropModal();
    showToast("영수증 이미지를 등록하는 중입니다…");
    await apiPut(`/api/transactions/${txId}/receipt-image`, { image: dataUrl });
    showToast("영수증 이미지를 등록했습니다.");
    await refreshAll();
  } catch (err) {
    closeCropModal();
    showToast(err.message || "영수증 이미지 등록에 실패했습니다.", true);
  } finally {
    uploadingTxId = null;
  }
}

function openReceiptModal(imageSrc, txId) {
  const modal = document.getElementById("receipt-modal");
  document.getElementById("receipt-modal-img").src = imageSrc;
  modal.dataset.txId = txId;
  modal.classList.add("open");
}

function closeReceiptModal() {
  const modal = document.getElementById("receipt-modal");
  modal.classList.remove("open");
  document.getElementById("receipt-modal-img").src = "";
}

// ---- preview (parse) ----
let previewSeq = 0;

function renderPreview(failedResults) {
  const root = document.getElementById("preview-list");
  root.innerHTML = failedResults.map(renderManualEntryCard).join("");
}

function renderManualEntryCard(p) {
  const localId = "p" + previewSeq++;
  return `
    <div class="preview-card failed" data-local-id="${localId}">
      <span class="chip">인식 실패 · 직접 입력해 주세요</span>
      <div class="raw">${esc(p.raw)}</div>
      <div class="field-grid">
        <label>카드사 <input name="card_company" placeholder="예: KB국민카드" /></label>
        <label>카드 표시 <input name="card_label" placeholder="선택" /></label>
        <label>가맹점 <input name="merchant" placeholder="가맹점명" /></label>
        <label>메모 <input name="memo" placeholder="예: 목장모임 준비" /></label>
        <input type="hidden" name="method" />
        <label>금액 <input name="amount" type="number" min="0" /></label>
        <label>거래일시 <input name="occurred_at" type="datetime-local" /></label>
        <label>누적/잔액 라벨 <input name="balance_label" placeholder="선택" /></label>
        <label>누적/잔액 금액 <input name="balance_amount" type="number" min="0" /></label>
      </div>
      <div class="preview-actions">
        <span></span>
        <button class="btn btn-primary btn-sm" data-action="save-preview">저장</button>
      </div>
    </div>
  `;
}

// ---- duplicate check ----
async function checkDuplicateTx(occurredAt, cardCompany, excludeId) {
  if (!occurredAt) return { exists: false, matches: [] };
  const qs = new URLSearchParams({ occurred_at: occurredAt, card_company: cardCompany || "" });
  if (excludeId) qs.set("exclude_id", excludeId);
  try {
    return await apiGet(`/api/transactions/check-duplicate?${qs}`);
  } catch {
    return { exists: false, matches: [] };
  }
}

function confirmDuplicateOverride(matches) {
  const m = matches[0];
  return confirm(
    `같은 날짜·시간에 이미 등록된 거래가 있습니다.\n${m.card_company} · ${m.merchant} · ${money(m.amount)}\n\n그래도 저장할까요?`
  );
}

// ---- refresh ----
function applyPresetToDates(days) {
  const fromInput = document.getElementById("period-from");
  const toInput = document.getElementById("period-to");
  const to = new Date();
  const from = new Date(to.getTime() - Number(days) * 24 * 60 * 60 * 1000);
  toInput.value = to.toISOString().slice(0, 10);
  fromInput.value = from.toISOString().slice(0, 10);
}

function getPeriodQuery() {
  const fromVal = document.getElementById("period-from").value;
  const toVal = document.getElementById("period-to").value;
  if (!fromVal || !toVal) return "";
  const qs = new URLSearchParams({
    from: new Date(`${fromVal}T00:00:00+09:00`).toISOString(),
    to: new Date(`${toVal}T23:59:59+09:00`).toISOString(),
  });
  return `?${qs}`;
}

async function refreshAll() {
  const query = getPeriodQuery();
  const [summary, list] = await Promise.all([apiGet(`/api/summary${query}`), apiGet(`/api/transactions${query}`)]);
  lastTransactions = list;
  renderSummary(summary);
  renderCards(filterByCard(list));
}

// ---- events ----
document.getElementById("save-sms-btn").addEventListener("click", async () => {
  const textEl = document.getElementById("sms-input");
  const text = textEl.value;
  if (!text.trim()) return showToast("문자 내용을 입력해 주세요.", true);

  const btn = document.getElementById("save-sms-btn");
  btn.disabled = true;
  try {
    const { results } = await apiPost("/api/parse", { text });
    const recognized = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);

    let savedCount = 0;
    for (const r of recognized) {
      const dup = await checkDuplicateTx(r.data.occurred_at, r.data.card_company);
      if (dup.exists && !confirmDuplicateOverride(dup.matches)) continue;
      await apiPost("/api/transactions", r.data);
      savedCount++;
    }

    renderPreview(failed);
    if (savedCount) textEl.value = "";

    if (savedCount && failed.length) {
      showToast(`${savedCount}건 저장했습니다. ${failed.length}건은 인식하지 못해 아래에서 직접 입력해 주세요.`, true);
    } else if (savedCount) {
      showToast(`${savedCount}건 저장했습니다.`);
    } else if (failed.length) {
      showToast("인식하지 못했습니다. 아래에서 직접 입력해 주세요.", true);
    } else {
      showToast("저장할 내용이 없습니다.", true);
    }

    if (savedCount) await refreshAll();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("clear-sms-btn").addEventListener("click", () => {
  document.getElementById("sms-input").value = "";
  document.getElementById("preview-list").innerHTML = "";
});

document.getElementById("preview-list").addEventListener("click", async (e) => {
  const btn = e.target.closest('[data-action="save-preview"]');
  if (!btn) return;
  const card = btn.closest(".preview-card");
  const body = {};
  card.querySelectorAll("input").forEach((inp) => (body[inp.name] = inp.value));
  body.occurred_at = body.occurred_at ? fromKstInputValue(body.occurred_at) : "";
  body.amount = Number(body.amount);
  body.balance_amount = body.balance_amount ? Number(body.balance_amount) : null;

  btn.disabled = true;
  try {
    const dup = await checkDuplicateTx(body.occurred_at, body.card_company);
    if (dup.exists && !confirmDuplicateOverride(dup.matches)) {
      btn.disabled = false;
      return;
    }
    await apiPost("/api/transactions", body);
    card.remove();
    showToast("거래를 저장했습니다.");
    await refreshAll();
  } catch (err) {
    showToast(err.message, true);
    btn.disabled = false;
  }
});

document.getElementById("cards").addEventListener("click", async (e) => {
  const registerBtn = e.target.closest('[data-action="register-receipt"]');
  if (registerBtn) {
    if (uploadingTxId) return showToast("다른 영수증을 등록하는 중입니다. 잠시 후 다시 시도하세요.", true);
    uploadingTxId = registerBtn.dataset.txId;
    document.getElementById("receipt-choice-modal").classList.add("open");
    return;
  }

  const viewBtn = e.target.closest('[data-action="view-receipt"]');
  if (viewBtn) {
    const txId = viewBtn.dataset.txId;
    try {
      const { image } = await apiGet(`/api/transactions/${txId}/receipt-image`);
      openReceiptModal(image, txId);
    } catch (err) {
      showToast(err.message, true);
    }
    return;
  }

  const toggle = e.target.closest('[data-action="toggle"]');
  if (toggle) {
    const li = toggle.closest(".tx");
    const id = li.dataset.id;
    if (openIds.has(id)) openIds.delete(id);
    else openIds.add(id);
    li.querySelector("[data-detail]").classList.toggle("open");
    return;
  }

  const editBtn = e.target.closest('[data-action="edit-tx"]');
  if (editBtn) {
    const detail = editBtn.closest(".tx-detail");
    detail.querySelector(".view-block").style.display = "none";
    detail.querySelector(".edit-form").style.display = "grid";
    return;
  }

  const cancelBtn = e.target.closest('[data-action="cancel-edit"]');
  if (cancelBtn) {
    const detail = cancelBtn.closest(".tx-detail");
    detail.querySelector(".view-block").style.display = "";
    detail.querySelector(".edit-form").style.display = "none";
    return;
  }

  const delTx = e.target.closest('[data-action="delete-tx"]');
  if (delTx) {
    if (!confirm("이 거래를 삭제할까요?")) return;
    try {
      await apiDelete(`/api/transactions/${delTx.dataset.txId}`);
      showToast("거래를 삭제했습니다.");
      await refreshAll();
    } catch (err) {
      showToast(err.message, true);
    }
    return;
  }
});

document.getElementById("cards").addEventListener("submit", async (e) => {
  const editForm = e.target.closest('[data-action="save-edit"]');
  if (editForm) {
    e.preventDefault();
    const fd = new FormData(editForm);
    const body = Object.fromEntries(fd.entries());
    body.occurred_at = fromKstInputValue(body.occurred_at);
    body.amount = Number(body.amount);
    body.balance_amount = body.balance_amount ? Number(body.balance_amount) : null;
    try {
      const dup = await checkDuplicateTx(body.occurred_at, body.card_company, editForm.dataset.txId);
      if (dup.exists && !confirmDuplicateOverride(dup.matches)) return;
      await apiPatch(`/api/transactions/${editForm.dataset.txId}`, body);
      openIds.add(editForm.dataset.txId);
      showToast("거래 정보를 수정했습니다.");
      await refreshAll();
    } catch (err) {
      showToast(err.message, true);
    }
    return;
  }
});

document.getElementById("logout-btn").addEventListener("click", async () => {
  await apiPost("/api/logout", {}).catch(() => {});
  location.href = "/login.html";
});

document.getElementById("period-select").addEventListener("change", () => {
  applyPresetToDates(document.getElementById("period-select").value);
  refreshAll().catch((err) => showToast(err.message, true));
});

document.getElementById("period-from").addEventListener("change", () => {
  refreshAll().catch((err) => showToast(err.message, true));
});
document.getElementById("period-to").addEventListener("change", () => {
  refreshAll().catch((err) => showToast(err.message, true));
});

document.getElementById("card-filter").addEventListener("change", () => {
  renderCards(filterByCard(lastTransactions));
});

document.getElementById("receipt-choice-modal").addEventListener("click", (e) => {
  const closeBtn = e.target.closest('[data-action="close-receipt-choice"]');
  if (closeBtn) {
    document.getElementById("receipt-choice-modal").classList.remove("open");
    uploadingTxId = null;
    return;
  }

  const cameraBtn = e.target.closest('[data-action="choose-camera"]');
  const galleryBtn = e.target.closest('[data-action="choose-gallery"]');
  if (!cameraBtn && !galleryBtn) return;

  document.getElementById("receipt-choice-modal").classList.remove("open");
  const fileInput = document.getElementById("receipt-file-input");
  if (cameraBtn) fileInput.setAttribute("capture", "environment");
  else fileInput.removeAttribute("capture");

  filePickResolved = false;
  fileInput.click();

  // 파일 선택을 취소했을 때 잠금을 풀기 위한 두 가지 안전장치.
  // "window focus" 시점은 모바일 브라우저에서 신뢰할 수 없어(사진을 실제로 골라도
  // 너무 이르게 발생하는 경우가 있음) 더 이상 사용하지 않는다.
  // 1) 취소를 지원하는 브라우저는 표준 'cancel' 이벤트로 즉시 감지한다.
  fileInput.addEventListener(
    "cancel",
    () => {
      if (!filePickResolved) uploadingTxId = null;
    },
    { once: true }
  );
  // 2) 'cancel' 이벤트를 지원하지 않는 브라우저를 위한 넉넉한 최후의 안전장치.
  setTimeout(() => {
    if (!filePickResolved) uploadingTxId = null;
  }, 60000);
});

document.getElementById("receipt-file-input").addEventListener("change", async (e) => {
  filePickResolved = true;
  const file = e.target.files[0];
  e.target.value = "";
  const txId = uploadingTxId;
  if (!file || !txId) {
    uploadingTxId = null;
    return;
  }
  openIds.add(txId);
  try {
    const { url } = await loadImageFromFile(file);
    openCropModal(url);
  } catch (err) {
    uploadingTxId = null;
    showToast(err.message || "이미지를 불러오지 못했습니다.", true);
  }
});

document.getElementById("crop-modal").addEventListener("click", (e) => {
  if (e.target.closest('[data-action="cancel-crop"]')) {
    closeCropModal();
    uploadingTxId = null;
    return;
  }
  if (e.target.closest('[data-action="confirm-crop"]')) {
    performCropAndUpload(uploadingTxId);
  }
});

document.getElementById("receipt-modal").addEventListener("click", async (e) => {
  if (e.target.closest('[data-action="close-receipt-modal"]')) {
    closeReceiptModal();
    return;
  }
  const delBtn = e.target.closest('[data-action="delete-receipt-image"]');
  if (delBtn) {
    if (!confirm("등록된 영수증 이미지를 삭제할까요?")) return;
    const txId = document.getElementById("receipt-modal").dataset.txId;
    try {
      await apiDelete(`/api/transactions/${txId}/receipt-image`);
      closeReceiptModal();
      showToast("영수증 이미지를 삭제했습니다.");
      await refreshAll();
    } catch (err) {
      showToast(err.message, true);
    }
  }
});

applyPresetToDates(document.getElementById("period-select").value);
refreshAll().catch((err) => showToast(err.message, true));
