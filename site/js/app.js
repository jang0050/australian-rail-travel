// All inputs are local and cached; each readable spec also works independently at site root.
const cache = new Map();
async function readJSON(path) {
  if (!cache.has(path)) cache.set(path, fetch(new URL(path, document.baseURI), {cache:'no-cache'}).then(r => {
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    return r.json();
  }).catch(e => { cache.delete(path); throw e; }));
  return cache.get(path);
}
const views = new Map();
const state = {cityFocus:'All cities', shareYear:'2024-25', baselineMin:5000, grid:'5'};
async function localise(value) {
  if (Array.isArray(value)) return Promise.all(value.map(localise));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key,child] of Object.entries(value)) out[key] = await localise(child);
  if (typeof out.url === 'string' && out.url.startsWith('data/')) {
    const raw = await readJSON(out.url);
    out.values = out.format?.property === 'features' ? raw.features : raw;
    delete out.url; delete out.format;
  }
  return out;
}
let registry = [];
const results = new Map();
function fail(id,error) {
  const element = document.getElementById(id);
  element.replaceChildren();
  const message = document.createElement('p'); message.className = 'error'; message.setAttribute('role','alert');
  message.textContent = `Figure ${element.closest('figure').dataset.figureNumber} could not load. Try again using the button below. The data table remains available.`;
  const retry = document.createElement('button'); retry.className = 'retry'; retry.textContent = 'Retry chart';
  retry.onclick = () => render(registry.find(r => r.id === id));
  element.append(message,retry); element.dataset.renderStatus='failed';
  results.set(id,{id,status:'failed',error:String(error)});
}
async function render(entry) {
  const {id}=entry;const element = document.getElementById(id);
  try {
    if (typeof window.vegaEmbed !== 'function') throw new Error('Local Vega runtime is unavailable');
    const spec = await localise(await readJSON(entry.spec));
    const isLite = spec.$schema.includes('vega-lite');
    const width = Math.floor(element.getBoundingClientRect().width);
    spec.width = width;
    // Leave 2px per side for the waffle's rectangle strokes; keep all cells square.
    if (id === 'C04') {spec.width=width-4;spec.height=spec.width;}
    if (id === 'C12') spec.height = width + 46;
    if (id === 'C01') spec.height = width < 430 ? 350 : 420;
    if (id === 'C05' || id === 'C06') spec.height = width + 64;
    if (id === 'C08' && width < 500) spec.encoding.x.axis.labelAngle=-45;
    if (id === 'C06') spec.layer.find(l=>l.name==='grid').data.values=(await readJSON(`data/bins_${state.grid}.geojson`)).features;
    for (const p of spec.params ?? []) if(p.name in state) p.value=state[p.name];
    views.get(id)?.finalize(); element.replaceChildren();
    const embedded = await window.vegaEmbed(element,spec,{mode:isLite?'vega-lite':'vega',renderer:'svg',actions:false});
    views.set(id,embedded.view); element.dataset.renderStatus='rendered';
    element.dataset.renderWidth=String(width); results.set(id,{id,status:'rendered'});
  } catch(error) { console.error(id,error);fail(id,error); }
  window.__chartResults=[...results.values()];
}
async function signal(id,name,value) {
  state[name]=value;
  try {if(views.has(id))await views.get(id).signal(name,value).runAsync();}
  catch(error){fail(id,error);}
}
document.getElementById('city-focus').addEventListener('change',e=>signal('C02','cityFocus',e.target.value));
document.getElementById('share-year').addEventListener('change',async e=>{
  await signal('C04','shareYear',e.target.value);
  const rows=(await readJSON('data/victoria_annual.json')).filter(r=>r.financial_year===e.target.value);
  const share=100*rows.find(r=>r.service==='Regional').journeys/rows.reduce((s,r)=>s+r.journeys,0);
  document.getElementById('share-summary').textContent=`${e.target.value.replace(/-(\d{2})$/, '–20$1')}: regional trains account for ${share.toFixed(1)}% of train journeys (${Math.round(share)} squares).`;
});
document.getElementById('baseline-min').addEventListener('change',async e=>{
  await signal('C09','baselineMin',Number(e.target.value));
  const s=(await readJSON('data/summary.json')).histogram_threshold_sensitivity[e.target.value];
  document.getElementById('hist-summary').textContent=`${s.count} matched stations · median recovery ${s.median.toFixed(1)}`;
});
document.getElementById('grid-size').addEventListener('change',async e=>{
  state.grid=e.target.value;await render(registry.find(r=>r.id==='C06'));
  const s=(await readJSON('data/summary.json')).grid_sensitivity.find(r=>r.grid===state.grid);
  document.getElementById('grid-summary').textContent=`${s.occupied_cells} occupied cells · 222 stations · 178.48 million entries · largest cell share: ${s.largest_cell_share.toFixed(1)}%`;
});
try {
  await document.fonts.ready;
  registry=await readJSON('specs/chart_registry.json');
  await Promise.all(registry.map(render));
} catch(error) {
  for(const element of document.querySelectorAll('.chart'))fail(element.id,error);
}
// Re-render only after a real width change; finalise old views and preserve local controls.
let timer;
const observer=new ResizeObserver(()=>{
  clearTimeout(timer);timer=setTimeout(()=>{
    for(const entry of registry){const el=document.getElementById(entry.id);if(Math.abs(el.getBoundingClientRect().width-Number(el.dataset.renderWidth))>2)render(entry);}
  },180);
});
for(const element of document.querySelectorAll('.chart'))observer.observe(element);
// Vega's cursor fallback can place longer full-word tooltips outside a narrow viewport.
let tooltipElement;
const boundTooltip=()=>{
  if(!tooltipElement?.classList.contains('visible'))return;
  const rect=tooltipElement.getBoundingClientRect();
  const left=Math.max(12,Math.min(rect.left,innerWidth-rect.width-12));
  const top=Math.max(12,Math.min(rect.top,innerHeight-rect.height-12));
  if(Math.abs(left-rect.left)>.5)tooltipElement.style.left=`${left}px`;
  if(Math.abs(top-rect.top)>.5)tooltipElement.style.top=`${top}px`;
};
const tooltipBoundsObserver=new MutationObserver(boundTooltip);
// The shared tooltip element is created lazily on the first hover.
const attachTooltipBounds=()=>{
  tooltipElement=document.getElementById('vg-tooltip-element');
  if(!tooltipElement)return;
  tooltipBoundsObserver.observe(tooltipElement,{attributes:true,attributeFilter:['style','class']});
  tooltipCreationObserver.disconnect();
  boundTooltip();
};
const tooltipCreationObserver=new MutationObserver(attachTooltipBounds);
tooltipCreationObserver.observe(document.body,{childList:true,subtree:true});
attachTooltipBounds();
window.addEventListener('resize',boundTooltip);
window.addEventListener('pagehide',()=>{observer.disconnect();tooltipCreationObserver.disconnect();tooltipBoundsObserver.disconnect();window.removeEventListener('resize',boundTooltip);clearTimeout(timer);for(const view of views.values())view.finalize();},{once:true});
// Read-only handles support repeatable browser assertions of actual Vega signals and data.
window.__railViews=views;
