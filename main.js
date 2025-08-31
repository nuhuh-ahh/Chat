const { app, BrowserWindow } = require("electron");
const path = require("path");
const { spawn } = require("child_process");

let serverProcess;

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
    },
  });

  // Mở web app từ server Node
  win.loadURL("http://localhost:3000");
}

app.whenReady().then(() => {
  // Khởi động server Node (server.js)
  serverProcess = spawn("node", ["server.js"], {
    cwd: __dirname,
    shell: true,
  });

  serverProcess.stdout.on("data", (data) => {
    console.log(`[SERVER] ${data}`);
  });

  serverProcess.stderr.on("data", (data) => {
    console.error(`[SERVER ERROR] ${data}`);
  });

  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    if (serverProcess) serverProcess.kill();
    app.quit();
  }
});
