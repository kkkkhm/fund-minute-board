const canvas = document.querySelector("#curve");
const chartEmpty = document.querySelector("#chart-empty");
const rowsTarget = document.querySelector("#curve-rows");
const filterInput = document.querySelector("#curve-filter");
const sortSelect = document.querySelector("#curve-sort");
const state = {
  latest: [],
  points: {},
  selectedId: "",
  status: null,
  sourceTime: ""
};

function signedPercent(value) {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function tone(value) {
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "flat";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function timeLabel(timestamp) {
  return new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    timeZone: "Asia/Shanghai"
  });
}

function pointsFor(id) {
  return state.points[id] || [];
}

function selectedItem() {
  return state.latest.find((item) => item.id === state.selectedId);
}

function renderSummary(payload) {
  const markets = state.latest.filter((item) => item.type === "market");
  const funds = state.latest.filter((item) => item.type === "fund");
  document.querySelector("#market-summary").innerHTML = markets.map((item) => `
    <button type="button" class="market-item ${item.id === state.selectedId ? "is-selected" : ""}" data-curve-id="${escapeHtml(item.id)}">
      <p>${escapeHtml(item.name)}</p>
      <strong class="${tone(item.change)}">${escapeHtml(item.changeText)}</strong>
    </button>
  `).join("");
  document.querySelector("#fund-total").textContent = String(funds.length);
  document.querySelector("#up-total").textContent = String(funds.filter((item) => item.change > 0).length);
  document.querySelector("#down-total").textContent = String(funds.filter((item) => item.change < 0).length);
  document.querySelector("#sample-count").textContent = String(pointsFor(state.selectedId).length || "--");
  document.querySelector("#connection-label").textContent = payload.ready ? "后台采样中" : "等待后台采样";
  document.querySelector("#clock-label").textContent = payload.lastCollectedAt
    ? `${timeLabel(payload.lastCollectedAt)} 已采样${state.sourceTime ? `，${state.sourceTime}` : ""}`
    : payload.lastError || "等待服务端第一批数据";
  document.querySelector("#live-dot").className = `live-dot ${payload.ready ? "is-live" : ""}`;
}

function renderRows() {
  const query = filterInput.value.trim().toLowerCase();
  const items = state.latest
    .filter((item) => item.name.toLowerCase().includes(query))
    .sort((left, right) => {
      if (sortSelect.value === "change-asc") return left.change - right.change;
      if (sortSelect.value === "name") return left.name.localeCompare(right.name, "zh-CN");
      return right.change - left.change;
    });

  rowsTarget.innerHTML = items.map((item) => `
    <tr data-curve-id="${escapeHtml(item.id)}" class="${item.id === state.selectedId ? "is-selected" : ""}">
      <td><button type="button">${escapeHtml(item.name)}</button></td>
      <td>${escapeHtml(item.session)}</td>
      <td><span class="change ${tone(item.change)}">${escapeHtml(item.changeText)}</span></td>
    </tr>
  `).join("");
}

function renderCurve(item) {
  const points = item ? pointsFor(item.id) : [];
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  const context = canvas.getContext("2d");
  context.scale(ratio, ratio);
  context.clearRect(0, 0, width, height);
  chartEmpty.hidden = points.length > 0;
  if (!points.length) {
    document.querySelector("#chart-meta").innerHTML = "";
    return;
  }

  const padding = { bottom: 34, left: 54, right: 18, top: 20 };
  const values = points.map((point) => point.change);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const interval = Math.max(max - min, 0.05);
  const low = min - interval * 0.2;
  const high = max + interval * 0.2;
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const x = (index) => padding.left + (points.length === 1 ? plotWidth / 2 : plotWidth * index / (points.length - 1));
  const y = (value) => padding.top + plotHeight * (high - value) / (high - low);

  context.font = "12px system-ui, sans-serif";
  context.fillStyle = "#675f55";
  context.strokeStyle = "#d9d4cb";
  context.lineWidth = 1;
  for (let index = 0; index < 4; index += 1) {
    const value = low + (high - low) * index / 3;
    const lineY = y(value);
    context.beginPath();
    context.moveTo(padding.left, lineY);
    context.lineTo(width - padding.right, lineY);
    context.stroke();
    context.fillText(signedPercent(value), 4, lineY + 4);
  }
  context.strokeStyle = "#867d72";
  context.setLineDash([5, 5]);
  context.beginPath();
  context.moveTo(padding.left, y(0));
  context.lineTo(width - padding.right, y(0));
  context.stroke();
  context.setLineDash([]);
  context.strokeStyle = points[points.length - 1].change >= 0 ? "#b53d37" : "#147c61";
  context.lineWidth = 2.5;
  context.beginPath();
  points.forEach((point, index) => context[index === 0 ? "moveTo" : "lineTo"](x(index), y(point.change)));
  context.stroke();
  context.fillStyle = context.strokeStyle;
  context.beginPath();
  context.arc(x(points.length - 1), y(points[points.length - 1].change), 4, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#675f55";
  context.fillText(timeLabel(points[0].time), padding.left, height - 9);
  const endText = timeLabel(points[points.length - 1].time);
  context.fillText(endText, width - padding.right - context.measureText(endText).width, height - 9);
  document.querySelector("#chart-meta").innerHTML = `
    <span>采样点 ${points.length}</span>
    <span>今日区间 ${signedPercent(Math.min(...values))} 至 ${signedPercent(Math.max(...values))}</span>
    <span>最新 ${timeLabel(points[points.length - 1].time)}</span>
  `;
}

function renderSelected() {
  const item = selectedItem();
  document.querySelector("#selected-name").textContent = item?.name || "等待数据";
  const badge = document.querySelector("#selected-change");
  badge.textContent = item?.changeText || "--";
  badge.className = `change-pill ${item ? tone(item.change) : ""}`;
  document.querySelector("#sample-count").textContent = String(pointsFor(state.selectedId).length || "--");
  renderCurve(item);
}

async function refresh() {
  const response = await fetch("/server-api/history", { cache: "no-store" });
  const payload = await response.json();
  state.status = payload;
  state.latest = payload.latest || [];
  state.points = payload.points || {};
  state.sourceTime = payload.sourceTime || "";
  if (!state.selectedId || !selectedItem()) {
    state.selectedId = state.latest.find((item) => item.type === "fund")?.id || state.latest[0]?.id || "";
  }
  renderSummary(payload);
  renderRows();
  renderSelected();
}

rowsTarget.addEventListener("click", (event) => {
  const row = event.target.closest("[data-curve-id]");
  if (!row) return;
  state.selectedId = row.dataset.curveId;
  renderRows();
  renderSelected();
});
document.querySelector("#market-summary").addEventListener("click", (event) => {
  const card = event.target.closest("[data-curve-id]");
  if (!card) return;
  state.selectedId = card.dataset.curveId;
  renderSummary(state.status || { ready: true });
  renderRows();
  renderSelected();
});
filterInput.addEventListener("input", renderRows);
sortSelect.addEventListener("change", renderRows);
window.addEventListener("resize", renderSelected);
refresh();
setInterval(refresh, 30000);
