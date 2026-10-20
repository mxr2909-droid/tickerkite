// Graph workspace: main-process side. main.js calls register(ctx) once at startup.
// ctx: { ipcMain, send, file, readJSON, writeJSON, bus, get, Notification, showStory, showPage }
//  - IPC channels must start with "graphs:" (the preload only forwards those for this module)
//  - bus emits "news" (stories), "quotes" (quotes), "scores" (scorecard result) after each refresh
//  - get() returns { stories, quotes, watch, scores } right now

function register(ctx) {}

module.exports = { register };
