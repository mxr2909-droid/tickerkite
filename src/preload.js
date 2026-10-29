const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("wire", {
  getNews: () => ipcRenderer.invoke("news:get"),
  getQuotes: () => ipcRenderer.invoke("quotes:get"),
  refresh: () => ipcRenderer.invoke("news:refresh"),
  open: (url) => ipcRenderer.invoke("open-external", url),
  showStory: (id) => ipcRenderer.invoke("show-story", id),
  onNews: (cb) => ipcRenderer.on("news:update", (_e, d) => cb(d)),
  onQuotes: (cb) => ipcRenderer.on("quotes:update", (_e, d) => cb(d)),
  onSelect: (cb) => ipcRenderer.on("news:select", (_e, id) => cb(id)),
  getInstrument: (sym, range, force) => ipcRenderer.invoke("instrument:get", sym, range, force),
  getInstrumentNews: (sym, range) => ipcRenderer.invoke("instrument:news", sym, range),
  getCompany: (sym, force) => ipcRenderer.invoke("company:get", sym, force),
  setSecContact: (c) => ipcRenderer.invoke("company:contact", c),
  addWatch: (sym) => ipcRenderer.invoke("watch:add", sym),
  removeWatch: (sym) => ipcRenderer.invoke("watch:remove", sym),
  getScores: () => ipcRenderer.invoke("score:get"),
  getScoreSeries: (id) => ipcRenderer.invoke("score:series", id),
  refreshScores: () => ipcRenderer.invoke("score:refresh"),
  onScores: (cb) => ipcRenderer.on("score:update", (_e, d) => cb(d)),
  onPage: (cb) => ipcRenderer.on("page:set", (_e, p) => cb(p)),
  popout: (page) => ipcRenderer.invoke("window:popout", page),
  tileWindows: () => ipcRenderer.invoke("window:tile"),
  reportPage: (p) => ipcRenderer.send("window:page", p),
  onPopoutCurrent: (cb) => ipcRenderer.on("popout:current", () => cb()),
  showInstrument: (sym) => ipcRenderer.invoke("show-instrument", sym),
  onInstrument: (cb) => ipcRenderer.on("inst:open", (_e, sym) => cb(sym)),
  // generic bridge for pages added under renderer/<page>.js: only their own channels pass
  page: {
    invoke: (ch, ...a) => (/^(calendar|markets|fed|graphs|recession|board|releases|portfolio|brief|company|curve|factor|monitors|cmd|settings|license|theme):/.test(ch) ? ipcRenderer.invoke(ch, ...a) : Promise.reject(new Error("blocked channel " + ch))),
    on: (ch, cb) => { if (/^(calendar|markets|fed|graphs|recession|board|releases|portfolio|brief|company|curve|factor|monitors|cmd|settings|license|theme):/.test(ch)) ipcRenderer.on(ch, (_e, d) => cb(d)); }
  },
  widget: {
    toggle: () => ipcRenderer.invoke("widget:toggle"),
    close: () => ipcRenderer.invoke("widget:close"),
    setOnTop: (v) => ipcRenderer.invoke("widget:ontop", v),
    state: () => ipcRenderer.invoke("widget:state"),
    onOnTop: (cb) => ipcRenderer.on("widget:ontop", (_e, v) => cb(v))
  }
});
