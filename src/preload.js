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
  showInstrument: (sym) => ipcRenderer.invoke("show-instrument", sym),
  onInstrument: (cb) => ipcRenderer.on("inst:open", (_e, sym) => cb(sym)),
  widget: {
    toggle: () => ipcRenderer.invoke("widget:toggle"),
    close: () => ipcRenderer.invoke("widget:close"),
    setOnTop: (v) => ipcRenderer.invoke("widget:ontop", v),
    state: () => ipcRenderer.invoke("widget:state"),
    onOnTop: (cb) => ipcRenderer.on("widget:ontop", (_e, v) => cb(v))
  }
});
