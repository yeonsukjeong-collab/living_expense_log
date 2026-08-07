"use strict";

const openIds = new Set();

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
function formatKstShort(iso) {
  const d = toKstDate(iso);
  return `${pad2(d.getUTCMonth() + 1)}.${pad2(d.getUTCDate())}<br>${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}
function formatDateShort(iso) {
  const d = toKstDate(iso);
  return `${pad2(d.getUTCMonth() + 1)}.${pad2(d.getUTCDate())}`;
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
const apiDelete = (url) => apiFetch(url, { method: "DELETE" });

// ---- summary ----
function renderSummary(s) {
  document.getElementById("stat-total").textContent = money(s.total);
  document.getElementById("stat-count").textContent = s.count + "건";
  document.getElementById("stat-range").textContent = s.count
    ? `${formatDateShort(s.earliest)} – ${formatDateShort(s.latest)}`
    : "-";
  document.getElementById("meta-line").textContent = s.count ? `총 ${s.count}건 수집됨` : "아직 거래가 없습니다";

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
  const hasItems = t.items && t.items.length;
  const open = openIds.has(String(t.id));
  return `
    <li class="tx" data-id="${t.id}">
      <div class="tx-row" data-action="toggle">
        <div class="tx-date num">${formatKstShort(t.occurred_at)}</div>
        <div class="tx-merchant">${esc(t.merchant)}${t.method ? `<span class="method">${esc(t.method)}</span>` : ""}</div>
        <div class="tx-amount num">${money(t.amount)}</div>
        <div>${hasItems ? `<span class="chip filled">영수증 ${t.items.length}개</span>` : `<span class="chip">영수증 미등록</span>`}</div>
      </div>
      <div class="tx-detail ${open ? "open" : ""}" data-detail>
        ${renderTxDetail(t)}
      </div>
    </li>
  `;
}

function renderTxDetail(t) {
  const items = t.items || [];
  const itemsSum = items.reduce((a, i) => a + i.price * i.qty, 0);
  const mismatch = items.length && itemsSum !== t.amount;

  return `
    <div class="view-block">
      <ul class="items-list">
        ${
          items.length
            ? items
                .map(
                  (i) => `
          <li class="item-row" data-item-id="${i.id}">
            <span class="name">${esc(i.name)}</span>
            <span class="qty">x${i.qty}</span>
            <span class="price num">${money(i.price * i.qty)}</span>
            <button class="btn btn-sm btn-ghost" data-action="delete-item" data-item-id="${i.id}" aria-label="항목 삭제">삭제</button>
          </li>`
                )
                .join("")
            : '<p class="hint" style="margin:8px 0 0">등록된 영수증 항목이 없습니다.</p>'
        }
      </ul>
      <form class="item-form" data-action="add-item" data-tx-id="${t.id}">
        <input type="text" name="name" placeholder="항목명" required />
        <input type="number" name="price" placeholder="가격" min="0" required />
        <input type="number" name="qty" placeholder="수량" min="1" value="1" />
        <button type="submit" class="btn btn-sm">추가</button>
      </form>
      ${
        items.length
          ? `<p class="items-sum ${mismatch ? "mismatch" : ""}">항목 합계 ${money(itemsSum)}${mismatch ? ` · 결제금액과 ${money(Math.abs(itemsSum - t.amount))} 차이` : " · 결제금액과 일치"}</p>`
          : ""
      }
      <p class="hint" style="margin:10px 0 0">${t.balance_label ? esc(t.balance_label) + " " + money(t.balance_amount) : "누적/잔액 정보 없음"}</p>
      <div class="actions">
        <button class="btn btn-sm" data-action="edit-tx">거래 정보 수정</button>
        <button class="btn btn-sm btn-danger" data-action="delete-tx" data-tx-id="${t.id}">거래 삭제</button>
      </div>
    </div>
    <form class="field-grid edit-form" data-action="save-edit" data-tx-id="${t.id}" style="display:none; margin-top:10px;">
      <label>카드사 <input name="card_company" value="${esc(t.card_company)}" required /></label>
      <label>카드 표시 <input name="card_label" value="${esc(t.card_label || "")}" /></label>
      <label>가맹점 <input name="merchant" value="${esc(t.merchant)}" required /></label>
      <label>결제방식 <input name="method" value="${esc(t.method || "")}" /></label>
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
          <label>결제방식 <input name="method" value="${esc(d.method || "")}" /></label>
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
        <label>결제방식 <input name="method" placeholder="선택" /></label>
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

// ---- refresh ----
async function refreshAll() {
  const [summary, list] = await Promise.all([apiGet("/api/summary"), apiGet("/api/transactions")]);
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

  const delItem = e.target.closest('[data-action="delete-item"]');
  if (delItem) {
    if (!confirm("이 항목을 삭제할까요?")) return;
    try {
      await apiDelete(`/api/items/${delItem.dataset.itemId}`);
      await refreshAll();
    } catch (err) {
      showToast(err.message, true);
    }
    return;
  }

  const delTx = e.target.closest('[data-action="delete-tx"]');
  if (delTx) {
    if (!confirm("이 거래를 삭제할까요? 영수증 항목도 함께 삭제됩니다.")) return;
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
  const addItemForm = e.target.closest('[data-action="add-item"]');
  if (addItemForm) {
    e.preventDefault();
    const fd = new FormData(addItemForm);
    const body = { name: fd.get("name"), price: Number(fd.get("price")), qty: Number(fd.get("qty") || 1) };
    try {
      await apiPost(`/api/transactions/${addItemForm.dataset.txId}/items`, body);
      openIds.add(addItemForm.dataset.txId);
      showToast("영수증 항목을 추가했습니다.");
      await refreshAll();
    } catch (err) {
      showToast(err.message, true);
    }
    return;
  }

  const editForm = e.target.closest('[data-action="save-edit"]');
  if (editForm) {
    e.preventDefault();
    const fd = new FormData(editForm);
    const body = Object.fromEntries(fd.entries());
    body.occurred_at = fromKstInputValue(body.occurred_at);
    body.amount = Number(body.amount);
    body.balance_amount = body.balance_amount ? Number(body.balance_amount) : null;
    try {
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

refreshAll().catch((err) => showToast(err.message, true));
