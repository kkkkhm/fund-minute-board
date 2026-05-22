const sourceRoot = document.querySelector("#app");
const rowTarget = document.querySelector("#fund-rows");
const filterInput = document.querySelector("#fund-filter");
const sortSelect = document.querySelector("#fund-sort");
const canvas = document.querySelector("#curve");
const chartEmpty = document.querySelector("#chart-empty");
const storageKey = "fund-minute-board:v1";
const minuteMs = 60 * 1000;

const state = {
  funds: [],
  markets: [],
  history: loadHistory(),
  lastCaptureAt: 0,
  selectedId: "",
  sourceTime: "",
  sourceChangedAt: 0
};

function shanghaiDay(timestamp = Date.now()) {
  return new Date(timestamp).toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
}

function minuteBucket(timestamp = Date.now()) {
  return Math.floor(timestamp / minuteMs) * minuteMs;
}

function loadHistory() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
    return saved.day === shanghaiDay() && saved.points ? saved.points : {};
  } catch {
    return {};
  }
}

function saveHistory() {
  localStorage.setItem(storageKey, JSON.stringify({
    day: shanghaiDay(),
    points: state.history
  }));
}

function byOrderText(container) {
  if (!container) return "";
  return [...container.querySelectorAll(".sc:not(.sc-d)")]
    .map((node, index) => ({
      index,
      order: Number.parseInt(node.style.order || "0", 10),
      text: node.textContent || ""
    }))
    .sort((left, right) => left.order - right.order || left.index - right.index)
    .map((part) => part.text)
    .join("")
    .replace(/\s+/g, "")
    .trim();
}

function impactNumber(text) {
  const parsed = Number.parseFloat(text.replace("%", ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function fundId(name) {
  return name.normalize("NFKC").replace(/\s+/g, "-");
}

function marketId(name) {
  return `market:${fundId(name)}`;
}

function readUpstream() {
  const rows = [...sourceRoot.querySelectorAll(".fund-row")].map((row) => {
    const name = byOrderText(row.querySelector(".fund-name"));
    const changeText = byOrderText(row.querySelector(".fund-impact"));
    return {
      change: impactNumber(changeText),
      changeText,
      id: fundId(name),
      name,
      session: byOrderText(row.querySelector(".session-badge")) || "--"
    };
  }).filter((fund) => fund.name && fund.changeText);

  const summaries = [...sourceRoot.querySelectorAll(".summary-card")].map((card) => {
    const name = card.querySelector(".summary-name")?.textContent?.trim() || "";
    const changeText = card.querySelector(".summary-value")?.textContent?.trim() || "--";
    return {
      change: impactNumber(changeText),
      changeText,
      id: marketId(name),
      name,
      session: "指标",
      type: "market",
      value: changeText
    };
  }).filter((item) => item.name && item.changeText !== "--");

  const sourceTime = sourceRoot.querySelector(".summary-time")?.textContent?.trim() || "";
  return { rows, sourceTime, summaries };
}

function pointList(id) {
  return state.history[id] || [];
}

function recordMinute(items, timestamp = Date.now()) {
  const pointTime = minuteBucket(timestamp);
  for (const item of items) {
    const points = pointList(item.id);
    const previous = points[points.length - 1];
    const next = { change: item.change, time: pointTime };
    if (previous?.time === pointTime) {
      points[points.length - 1] = next;
    } else {
      points.push(next);
    }
    state.history[item.id] = points.filter((point) => shanghaiDay(point.time) === shanghaiDay());
  }
  state.lastCaptureAt = timestamp;
  saveHistory();
}

function signedPercent(value) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(2)}%`;
}

function tone(value) {
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "flat";
}

function renderSummary(payload) {
  document.querySelector("#market-summary").innerHTML = payload.summaries.map((item) => `
    <button type="button" class="market-item ${item.id === state.selectedId ? "is-selected" : ""}" data-curve-id="${escapeHtml(item.id)}">
      <p>${escapeHtml(item.name)}</p>
      <strong class="${tone(item.change)}">${escapeHtml(item.value)}</strong>
    </button>
  `).join("");

  const up = payload.rows.filter((fund) => fund.change > 0).length;
  const down = payload.rows.filter((fund) => fund.change < 0).length;
  document.querySelector("#fund-total").textContent = String(payload.rows.length);
  document.querySelector("#up-total").textContent = String(up);
  document.querySelector("#down-total").textContent = String(down);
  document.querySelector("#connection-label").textContent = "实时采样中";
  document.querySelector("#clock-label").textContent = payload.sourceTime
    ? `${payload.sourceTime}，本页按分钟留痕`
    : "已读取基金涨跌，等待源站更新时间";
  document.querySelector("#live-dot").className = "live-dot is-live";
}

function renderRows() {
  const query = filterInput.value.trim().toLowerCase();
  const items = [...state.markets, ...state.funds]
    .filter((item) => item.name.toLowerCase().includes(query))
    .sort((left, right) => {
      if (sortSelect.value === "change-asc") return left.change - right.change;
      if (sortSelect.value === "name") return left.name.localeCompare(right.name, "zh-CN");
      return right.change - left.change;
    });

  rowTarget.innerHTML = items.map((item) => `
    <tr data-curve-id="${escapeHtml(item.id)}" class="${item.id === state.selectedId ? "is-selected" : ""}">
      <td><button type="button">${escapeHtml(item.name)}</button></td>
      <td>${escapeHtml(item.session)}</td>
      <td><span class="change ${tone(item.change)}">${escapeHtml(item.changeText)}</span></td>
    </tr>
  `).join("");
}

function renderSelected() {
  const item = selectedItem();
  document.querySelector("#selected-name").textContent = item?.name || "等待数据";
  const badge = document.querySelector("#selected-change");
  badge.textContent = item ? item.changeText : "--";
  badge.className = `change-pill ${item ? tone(item.change) : ""}`;
  renderCurve(item);
}

function selectedItem() {
  return [...state.markets, ...state.funds].find((item) => item.id === state.selectedId);
}

function renderCurve(fund) {
  const points = fund ? pointList(fund.id) : [];
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

  const padding = { bottom: 36, left: 54, right: 18, top: 22 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const values = points.map((point) => point.change);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const interval = Math.max(max - min, 0.05);
  const low = min - interval * 0.2;
  const high = max + interval * 0.2;
  const x = (index) => padding.left + (points.length === 1 ? plotWidth / 2 : plotWidth * index / (points.length - 1));
  const y = (value) => padding.top + plotHeight * (high - value) / (high - low);

  context.lineWidth = 1;
  context.font = "12px system-ui, sans-serif";
  context.strokeStyle = "#d9d4cb";
  context.fillStyle = "#675f55";
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

  context.lineWidth = 2.5;
  context.strokeStyle = points[points.length - 1].change >= 0 ? "#b53d37" : "#147c61";
  context.beginPath();
  points.forEach((point, index) => {
    const action = index === 0 ? "moveTo" : "lineTo";
    context[action](x(index), y(point.change));
  });
  context.stroke();

  const last = points[points.length - 1];
  context.fillStyle = context.strokeStyle;
  context.beginPath();
  context.arc(x(points.length - 1), y(last.change), 4.5, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "#675f55";
  context.fillText(timeLabel(points[0].time), padding.left, height - 10);
  const endLabel = timeLabel(last.time);
  context.fillText(endLabel, width - padding.right - context.measureText(endLabel).width, height - 10);

  document.querySelector("#chart-meta").innerHTML = `
    <span>采样点 ${points.length}</span>
    <span>今日区间 ${signedPercent(Math.min(...values))} 至 ${signedPercent(Math.max(...values))}</span>
    <span>最新 ${timeLabel(last.time)}</span>
  `;
}

function timeLabel(timestamp) {
  return new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai"
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function refreshFromSource(forceRecord = false) {
  const payload = readUpstream();
  if (!payload.rows.length) return false;

  state.funds = payload.rows;
  state.markets = payload.summaries;
  state.sourceTime = payload.sourceTime;
  state.sourceChangedAt = Date.now();
  if (!state.selectedId || !selectedItem()) {
    state.selectedId = state.funds[0].id;
  }
  if (forceRecord || minuteBucket(state.lastCaptureAt) !== minuteBucket()) {
    recordMinute([...payload.summaries, ...payload.rows]);
  }
  renderSummary(payload);
  renderRows();
  renderSelected();
  return true;
}

function updateCountdown() {
  const next = minuteBucket() + minuteMs;
  const seconds = Math.max(0, Math.ceil((next - Date.now()) / 1000));
  document.querySelector("#sample-countdown").textContent = `${seconds}s`;
}

rowTarget.addEventListener("click", (event) => {
  const row = event.target.closest("tr[data-curve-id]");
  if (!row) return;
  state.selectedId = row.dataset.curveId;
  renderSummary({ rows: state.funds, summaries: state.markets, sourceTime: state.sourceTime });
  renderRows();
  renderSelected();
});
document.querySelector("#market-summary").addEventListener("click", (event) => {
  const card = event.target.closest("[data-curve-id]");
  if (!card) return;
  state.selectedId = card.dataset.curveId;
  renderSummary({ rows: state.funds, summaries: state.markets, sourceTime: state.sourceTime });
  renderRows();
  renderSelected();
});
filterInput.addEventListener("input", renderRows);
sortSelect.addEventListener("change", renderRows);
window.addEventListener("resize", () => renderSelected());

const observer = new MutationObserver(() => refreshFromSource());
observer.observe(sourceRoot, { childList: true, subtree: true, characterData: true });

const initialWatch = setInterval(() => {
  if (refreshFromSource(true)) clearInterval(initialWatch);
}, 1000);
setTimeout(() => {
  if (!state.funds.length) {
    document.querySelector("#connection-label").textContent = "数据源仍在加载";
    document.querySelector("#clock-label").textContent = "请确认本地代理能访问目标站点";
  }
}, 12000);
setInterval(() => refreshFromSource(), minuteMs);
setInterval(updateCountdown, 1000);
updateCountdown();
