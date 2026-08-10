"use strict";

const openIds = new Set();
let lastTransactions = [];
let uploadingTxId = null;

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
function renderSummary(s) {
  document.getElementById("stat-total").textContent = money(s.total);
  document.getElementById("stat-count").textContent = s.count + "건";

  const bar = document.getElementById("bar");
  const legend = document.getElementById("legend");
  bar.innerHTML = "";
  legend.innerHTML = "";
  if (!s.total) return;
  s.byCard.forEach((c) => {
    const pct = (c.total / s.total) * 100;
    const key = cardKey(c.card_company);
    bar.insertAdjacentHTML("beforeend", `<div class="seg" style="width:${pct}%; background:var(--${key})"></div>`);
    legend.insertAdjacentHTML(
      "beforeend",
      `<span class="legend-item"><span class="legend-dot" style="background:var(--${key})"></span>${esc(c.card_company)} <span class="num">${money(c.total)}</span> (${pct.toFixed(1)}%)</span>`
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
        <span class="subtotal num">${money(g.subtotal)}</span>
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
                ? `<button type="button" class="chip filled chip-btn" data-action="view-receipt" data-tx-id="${t.id}">영수증 사진</button>`
                : `<button type="button" class="chip chip-btn" data-action="register-receipt" data-tx-id="${t.id}">영수증 사진 등록</button>`
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
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("이미지를 불러올 수 없습니다."));
    };
    img.src = url;
  });
}

async function compressImageToDataUrl(file, maxDim = 1600, quality = 0.82) {
  const img = await loadImageFromFile(file);
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
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

function renderPreview(results) {
  const root = document.getElementById("preview-list");
  root.innerHTML = results.map(renderPreviewCard).join("");
}

function renderPreviewCard(p) {
  const localId = "p" + previewSeq++;
  if (p.ok) {
    const d = p.data;
    return `
      <div class="preview-card" data-local-id="${localId}">
        <div class="field-grid">
          <label>카드사 <input name="card_company" value="${esc(d.card_company)}" /></label>
          <label>카드 표시 <input name="card_label" value="${esc(d.card_label || "")}" /></label>
          <label>가맹점 <input name="merchant" value="${esc(d.merchant)}" /></label>
          <label>메모 <input name="memo" placeholder="예: 목장모임 준비" /></label>
          <input type="hidden" name="method" value="${esc(d.method || "")}" />
          <label>금액 <input name="amount" type="number" min="0" value="${d.amount}" /></label>
          <label>거래일시 <input name="occurred_at" type="datetime-local" value="${toKstInputValue(d.occurred_at)}" /></label>
          <label>누적/잔액 라벨 <input name="balance_label" value="${esc(d.balance_label || "")}" /></label>
          <label>누적/잔액 금액 <input name="balance_amount" type="number" min="0" value="${d.balance_amount ?? ""}" /></label>
        </div>
        <div class="preview-actions">
          <span class="chip filled">인식됨</span>
          <button class="btn btn-primary btn-sm" data-action="save-preview">저장</button>
        </div>
      </div>
    `;
  }
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
async function checkDuplicateTx(occurredAt, excludeId) {
  if (!occurredAt) return { exists: false, matches: [] };
  const qs = new URLSearchParams({ occurred_at: occurredAt });
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
  renderCards(list);
}

// ---- events ----
document.getElementById("parse-btn").addEventListener("click", async () => {
  const text = document.getElementById("sms-input").value;
  if (!text.trim()) return showToast("문자 내용을 입력해 주세요.", true);
  try {
    const { results } = await apiPost("/api/parse", { text });
    renderPreview(results);
  } catch (err) {
    showToast(err.message, true);
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
    const dup = await checkDuplicateTx(body.occurred_at);
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
    const fileInput = document.getElementById("receipt-file-input");
    fileInput.click();
    // 파일 선택 창을 취소하면 change 이벤트가 발생하지 않으므로,
    // 창이 닫혀 포커스가 돌아왔는데도 파일이 선택되지 않았다면 잠금을 풀어준다.
    window.addEventListener(
      "focus",
      () => {
        setTimeout(() => {
          if (fileInput.files.length === 0) uploadingTxId = null;
        }, 500);
      },
      { once: true }
    );
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
      const dup = await checkDuplicateTx(body.occurred_at, editForm.dataset.txId);
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

document.getElementById("receipt-file-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  const txId = uploadingTxId;
  if (!file || !txId) {
    uploadingTxId = null;
    return;
  }
  openIds.add(txId);
  showToast("영수증 이미지를 등록하는 중입니다…");
  try {
    const dataUrl = await compressImageToDataUrl(file);
    await apiPut(`/api/transactions/${txId}/receipt-image`, { image: dataUrl });
    showToast("영수증 이미지를 등록했습니다.");
    await refreshAll();
  } catch (err) {
    showToast(err.message || "영수증 이미지 등록에 실패했습니다.", true);
  } finally {
    uploadingTxId = null;
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
