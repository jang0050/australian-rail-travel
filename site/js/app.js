// Shared inputs are fetched once; failed requests leave the cache for Retry.
const cache = new Map();
// Bind JSON assets to the same build as the renderer, including after browser reloads.
const buildVersion = new URL(import.meta.url).searchParams.get("v") ?? "local";
async function readJSON(path) {
  const url = new URL(path, document.baseURI);
  url.searchParams.set("v", buildVersion);
  if (!cache.has(path))
    cache.set(
      path,
      fetch(url, { cache: "no-cache" })
        .then((response) => {
          if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
          return response.json();
        })
        .catch((error) => {
          cache.delete(path);
          throw error;
        }),
    );
  return cache.get(path);
}
const views = new Map();
const finalizers = new Map();
function positionChartActions(element, id) {
  // SVG padding and legends are outside the visible plotting area.
  const selector = ["C01", "C05", "C06"].includes(id)
    ? "svg .mark-shape.role-mark"
    : "svg .role-frame > g > path.background";
  const plots =
    id === "C04"
      ? [...element.querySelectorAll("svg .mark-rect.role-mark")]
      : [element.querySelector(selector)].filter(Boolean);
  if (!plots.length) return;
  const rectangles = plots.map((plot) => plot.getBoundingClientRect());
  const bounds = {
    top: Math.min(...rectangles.map((r) => r.top)),
    right: Math.max(...rectangles.map((r) => r.right)),
  };
  const container = element.getBoundingClientRect();
  element.style.setProperty("--actions-top", `${bounds.top - container.top}px`);
  element.style.setProperty(
    "--actions-right",
    `${id === "C04" && container.width < 430 ? 0 : container.right - bounds.right + 8}px`,
  );
  element.style.removeProperty("--actions-offset");
  if (id !== "C01") {
    const button = element.querySelector("summary").getBoundingClientRect();
    let clearTop = button.top;
    for (const label of element
      .closest("figure")
      .querySelectorAll("figcaption p,.chart-summary p,.figure-controls button,.figure-controls select")) {
      const range = document.createRange();
      range.selectNodeContents(label);
      for (const rect of range.getClientRects())
        if (
          rect.width &&
          rect.left < button.right &&
          rect.right > button.left &&
          rect.top < button.bottom &&
          rect.bottom > button.top
        )
          clearTop = Math.max(clearTop, rect.bottom + 4);
    }
    if (clearTop > button.top) element.style.setProperty("--actions-offset", `${clearTop - bounds.top}px`);
  }
}
// One tab stop per chart, with optional arrow-key inspection of exact values.
// Marks retain Vega's own tooltip formatting; no parallel data calculation is used.
function enableKeyboardInspection(element) {
  const svg = element.querySelector("svg");
  if (!svg) return;
  svg.setAttribute("tabindex", "0");
  svg.setAttribute("aria-describedby", "chart-keyboard-help");
  let index = -1;
  svg.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const seen = new Set();
    // Native Vega marks may omit per-item ARIA roles; inspect their real tooltip data too.
    const marks = [...svg.querySelectorAll('[role="graphics-symbol"], .role-mark path')].filter((mark) => {
      const value = mark.__data__?.tooltip;
      if (!value || typeof value !== "object") return false;
      const key = JSON.stringify(value);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!marks.length) return;
    event.preventDefault();
    index =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? marks.length - 1
          : (index + (event.key === "ArrowLeft" ? -1 : 1) + marks.length) % marks.length;
    const mark = marks[index];
    mark.scrollIntoView({ block: "nearest" });
    const box = mark.getBoundingClientRect();
    mark.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        clientX: box.x + box.width / 2,
        clientY: box.y + box.height / 2,
      }),
    );
    const reading = Object.entries(mark.__data__.tooltip)
      .map(([key, value]) => `${key}: ${value}`)
      .join(". ");
    document.getElementById("chart-inspector").textContent = reading;
    let output = element.querySelector(".keyboard-reading");
    if (!output) {
      output = document.createElement("p");
      output.className = "keyboard-reading";
      output.setAttribute("aria-hidden", "true");
      element.append(output);
    }
    output.textContent = reading;
  });
  svg.addEventListener("blur", () => {
    if (element.id === "C07") views.get("C07")?.signal("inspectService", null).runAsync();
    document.getElementById("vg-tooltip-element")?.classList.remove("visible");
    element.querySelector(".keyboard-reading")?.remove();
  });
}
const state = { cityFocus: "All cities", baselineMin: 5000, grid: "5" };
// Preload local chart data so a missing file produces the visible retry state.
// Vega-Lite still receives the same rows and performs every visual transform.
async function localise(value) {
  if (Array.isArray(value)) return Promise.all(value.map(localise));
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) out[key] = await localise(child);
  if (typeof out.url === "string" && out.url.startsWith("data/")) {
    const raw = await readJSON(out.url);
    out.values = out.format?.property === "features" ? raw.features : raw;
    delete out.url;
    delete out.format;
  }
  return out;
}
let registry = [];
const results = new Map();
function fail(id, error) {
  const element = document.getElementById(id);
  element.replaceChildren();
  const message = document.createElement("p");
  message.className = "error";
  message.setAttribute("role", "alert");
  message.textContent = `Figure ${element.closest("figure").dataset.figureNumber} could not load. Try again using the button below. Source links are available in the Sources section.`;
  const retry = document.createElement("button");
  retry.className = "retry";
  retry.textContent = "Retry chart";
  retry.onclick = () => {
    const entry = registry.find((r) => r.id === id);
    cache.delete(entry.spec);
    return render(entry);
  };
  element.append(message, retry);
  element.dataset.renderStatus = "failed";
  results.set(id, { id, status: "failed", error: String(error) });
}
async function render(entry) {
  const { id } = entry;
  const element = document.getElementById(id);
  try {
    if (typeof window.vegaEmbed !== "function") throw new Error("Local Vega runtime is unavailable");
    const spec = structuredClone(await readJSON(entry.spec));
    const width = Math.floor(element.getBoundingClientRect().width);
    spec.width = width;
    // Both years remain visible; each facet retains a square 10-by-10 grid.
    if (id === "C04") {
      delete spec.width;
      delete spec.height;
      spec.spec.width = Math.floor((width - 32) / 2);
      spec.spec.height = spec.spec.width;
      if (width < 340) spec.facet.column.header.labelFontSize = 12;
    }
    if (id === "C12") {
      const paired =
        getComputedStyle(element.closest(".summary-pair")).gridTemplateColumns.split(" ").length === 2;
      const waffleSide = Math.floor((width - 32) / 2);
      // The shared header allowance aligns the plot with the waffle's year/share labels.
      spec.height = paired ? waffleSide : Math.max(240, Math.min(360, waffleSide));
      spec.padding.top = paired ? (width < 500 ? 38 : 37) : 12;
      if (width < 500)
        for (const layer of spec.layer)
          if (layer.encoding?.y?.field) {
            layer.encoding.y.title = ["Recovery index", "(2018–2019 = 100)"];
          }
    }
    if (id === "C07") {
      spec.width = width - 4;
      spec.height =
        spec.width >= 760 ? 408 : (spec.width < 430 ? 270 : 340) + (spec.width >= 600 ? 148 : 320);
    }
    if (id === "C01") {
      spec.height = width < 430 ? 320 : width < 600 ? 460 : 600;
      // Place Sydney's value beside its circle, clear of Brisbane's mark.
      if (width < 500) {
        for (const layer of spec.layer) if (layer.mark?.type === "text") layer.mark.fontSize = 13;
        spec.layer[2].mark.align = {
          expr: "datum.city === 'Sydney' ? 'left' : datum.city === 'Perth' && width < 340 ? 'left' : datum.city === 'Brisbane' && width < 340 ? 'right' : 'center'",
        };
        spec.layer[2].mark.dx = { expr: "datum.city === 'Sydney' ? 33 : 0" };
        spec.layer[2].mark.dy = { expr: "datum.city === 'Sydney' ? 0 : -32" };
        spec.layer[2].mark.fontSize = 12;
        spec.layer[2].encoding.text = {
          value: {
            expr: "datum.city === 'Sydney' ? ['Sydney', format(datum.journeys_million, '.1f')] : datum.city_value",
          },
        };
      }
      if (width < 430) spec.layer[3].mark.dx = width < 340 ? 12 : 60;
    }
    // Equal plotting dimensions keep geographic scale and sight lines identical.
    // Legends add their own space below; they do not shrink either map.
    if (["C05", "C06"].includes(id)) {
      spec.autosize = { type: "pad" };
      // Both maps retain the same fit; a bounded height avoids giant stacked squares.
      spec.width = width - 12;
      spec.height = Math.min(spec.width, 600);
      if (id === "C05" && width < 460) spec.layer[1].encoding.color.legend.columns = 1;
    }
    if (id === "C03" && width < 500) {
      for (const layer of spec.layer)
        if (layer.encoding?.x?.field) {
          layer.encoding.x.scale = { domain: [0, 1050] };
          layer.encoding.x.title = ["Estimated heavy-rail journeys", "(million)"];
          layer.encoding.x.axis = { title: ["Estimated heavy-rail journeys", "(million)"], tickCount: 4 };
        }
    }
    if (id === "C11" && width < 340)
      for (const layer of spec.layer.filter((l) => l.encoding?.x?.field)) {
        // Shared axes must agree on their title, including layered text marks.
        layer.encoding.x.title = ["Change in annual station entries", "(million)"];
        layer.encoding.x.axis = {
          ...layer.encoding.x.axis,
          title: ["Change in annual station entries", "(million)"],
        };
        if (layer.mark?.type === "text" && layer.mark.align === "left") {
          layer.mark.align = "right";
          layer.mark.dx = -6;
        }
      }
    if (id === "C08") {
      spec.height = width < 500 ? 510 : 450;
      for (const layer of spec.layer ?? [spec]) {
        layer.encoding.x.axis.labelAngle = width < 500 ? -45 : 0;
        layer.encoding.x.axis.labelFontSize = width < 500 ? 12 : 14;
        if (layer.encoding.color) layer.encoding.color.legend.gradientLength = Math.min(240, width - 136);
      }
    }
    if (width < 500 && spec.$schema.includes("vega-lite")) {
      spec.config.axis.labelFontSize = 12;
      spec.config.axis.titleFontSize = 13;
      spec.config.legend.labelFontSize = 13;
      spec.config.legend.titleFontSize = 13;
    }
    if (id === "C06") spec.layer.find((l) => l.name === "grid").data.url = `data/bins_${state.grid}.geojson`;
    for (const p of spec.params ?? []) if (p.name in state) p.value = state[p.name];
    finalizers.get(id)?.();
    element.replaceChildren();
    const embedded = await window.vegaEmbed(element, await localise(spec), {
      renderer: "svg",
      actions: { export: true, source: false, compiled: false, editor: false },
    });
    finalizers.set(id, embedded.finalize);
    element
      .querySelector("summary")
      .setAttribute("aria-label", `Actions for figure ${element.closest("figure").dataset.figureNumber}`);
    positionChartActions(element, id);
    enableKeyboardInspection(element);
    views.set(id, embedded.view);
    element.dataset.renderStatus = "rendered";
    element.dataset.renderWidth = String(width);
    results.set(id, { id, status: "rendered" });
  } catch (error) {
    console.error(id, error);
    fail(id, error);
  }
  window.__chartResults = [...results.values()];
}
async function signal(id, name, value) {
  state[name] = value;
  try {
    if (views.has(id)) await views.get(id).signal(name, value).runAsync();
  } catch (error) {
    fail(id, error);
  }
}
for (const button of document.querySelectorAll("[data-city]"))
  button.addEventListener("click", async () => {
    const city = button.dataset.city === state.cityFocus ? "All cities" : button.dataset.city;
    await signal("C02", "cityFocus", city);
    for (const item of document.querySelectorAll("[data-city]"))
      item.setAttribute("aria-pressed", String(item.dataset.city === city));
    const latest = (await readJSON("data/national_history.json")).find(
      (r) => r.city === city && r.year_end === 2025,
    );
    document.getElementById("city-summary").textContent = latest
      ? `${city} · 2024–2025: ${latest.recovery_index.toFixed(1)} on the recovery index · ${latest.trips_million.toFixed(1)} million journeys`
      : "100 marks each city’s 2018–2019 level. Select a city for its latest result.";
  });
document.getElementById("baseline-min").addEventListener("change", async (e) => {
  await signal("C09", "baselineMin", Number(e.target.value));
  const s = (await readJSON("data/summary.json")).histogram_threshold_sensitivity[e.target.value];
  for (const id of ["hist-summary", "hist-method-summary"])
    document.getElementById(id).textContent =
      `${s.count} matched stations · median recovery ${s.median.toFixed(1)}`;
});
document.getElementById("grid-size").addEventListener("change", async (e) => {
  state.grid = e.target.value;
  const s = (await readJSON("data/summary.json")).grid_sensitivity.find((r) => r.grid === state.grid);
  document.getElementById("grid-summary").textContent =
    `${s.occupied_cells} occupied cells · 222 stations · 178.48 million entries · largest cell: ${s.largest_cell_share.toFixed(1)}%`;
  await render(registry.find((r) => r.id === "C06"));
});
try {
  await document.fonts.ready;
  registry = await readJSON("specs/chart_registry.json");
  await Promise.all(registry.map(render));
} catch (error) {
  for (const element of document.querySelectorAll(".chart")) fail(element.id, error);
}
// Re-render only after a real width change; finalise old views and preserve local controls.
let timer;
const observer = new ResizeObserver(() => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    for (const entry of registry) {
      const el = document.getElementById(entry.id);
      if (Math.abs(el.getBoundingClientRect().width - Number(el.dataset.renderWidth)) > 2) render(entry);
    }
  }, 180);
});
for (const element of document.querySelectorAll(".chart")) observer.observe(element);
// Vega's cursor fallback can place longer full-word tooltips outside a narrow viewport.
let tooltipElement;
const boundTooltip = () => {
  if (!tooltipElement?.classList.contains("visible")) return;
  const rect = tooltipElement.getBoundingClientRect();
  const left = Math.max(12, Math.min(rect.left, innerWidth - rect.width - 12));
  const top = Math.max(12, Math.min(rect.top, innerHeight - rect.height - 12));
  if (Math.abs(left - rect.left) > 0.5) tooltipElement.style.left = `${left}px`;
  if (Math.abs(top - rect.top) > 0.5) tooltipElement.style.top = `${top}px`;
};
const tooltipBoundsObserver = new MutationObserver(boundTooltip);
// The shared tooltip element is created lazily on the first hover.
const attachTooltipBounds = () => {
  tooltipElement = document.getElementById("vg-tooltip-element");
  if (!tooltipElement) return;
  tooltipBoundsObserver.observe(tooltipElement, { attributes: true, attributeFilter: ["style", "class"] });
  tooltipCreationObserver.disconnect();
  boundTooltip();
};
const tooltipCreationObserver = new MutationObserver(attachTooltipBounds);
tooltipCreationObserver.observe(document.body, { childList: true, subtree: true });
attachTooltipBounds();
// Vega's SVG hover tooltip needs a pointer move after a touch tap.
let touchTooltipTarget;
const clearTouchTooltip = () => {
  if (touchTooltipTarget) {
    views.get("C07")?.signal("inspectService", null).runAsync();
    tooltipElement?.classList.remove("visible");
    touchTooltipTarget = undefined;
  }
};
document.addEventListener("pointerup", (event) => {
  if (event.pointerType !== "touch") return;
  const mark = event.target.closest?.('.chart svg.marks path,.chart svg.marks [role="graphics-symbol"]');
  if (
    !mark?.__data__?.tooltip ||
    (mark === touchTooltipTarget && tooltipElement?.classList.contains("visible"))
  ) {
    clearTouchTooltip();
    return;
  }
  touchTooltipTarget = mark;
  requestAnimationFrame(() =>
    mark.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerType: "touch",
        clientX: event.clientX,
        clientY: event.clientY,
      }),
    ),
  );
});
window.addEventListener("scroll", clearTouchTooltip, { passive: true });
window.addEventListener("resize", boundTooltip);
window.addEventListener(
  "pagehide",
  () => {
    observer.disconnect();
    tooltipCreationObserver.disconnect();
    tooltipBoundsObserver.disconnect();
    window.removeEventListener("resize", boundTooltip);
    clearTimeout(timer);
    for (const finalize of finalizers.values()) finalize();
  },
  { once: true },
);
// Read-only handles support repeatable browser assertions of actual Vega signals and data.
window.__railViews = views;

// Native details menus also dismiss predictably from the keyboard.
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  views.get("C07")?.signal("inspectService", null).runAsync();
  document.getElementById("vg-tooltip-element")?.classList.remove("visible");
  document.querySelectorAll(".keyboard-reading").forEach((e) => e.remove());
  const openMenus = [...document.querySelectorAll(".chart details[open]")];
  for (const menu of openMenus) menu.open = false;
  openMenus.at(-1)?.querySelector("summary")?.focus();
});
