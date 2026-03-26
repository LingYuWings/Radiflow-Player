import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Serve music directory
  let musicDir = path.join(process.cwd(), 'music');
  if (!fs.existsSync(musicDir)) {
    fs.mkdirSync(musicDir);
  }
  
  // Middleware to serve music from dynamic path
  app.use('/music', (req, res, next) => {
    express.static(musicDir)(req, res, next);
  });

  // API to list music files
  app.get("/api/music", (req, res) => {
    try {
      const files = fs.readdirSync(musicDir);
      const audioFiles = files.filter(file => 
        ['.mp3', '.wav', '.flac', '.m4a', '.ogg'].includes(path.extname(file).toLowerCase())
      );
      res.json(audioFiles);
    } catch (error) {
      res.status(500).json({ error: "Failed to list music files" });
    }
  });

  // API to update music directory
  app.post("/api/settings/music-dir", express.json(), (req, res) => {
    const { path: newPath } = req.body;
    if (newPath && fs.existsSync(newPath)) {
      musicDir = newPath;
      res.json({ success: true, path: musicDir });
    } else {
      res.status(400).json({ error: "Invalid path" });
    }
  });

  // API to get current music directory
  app.get("/api/settings/music-dir", (req, res) => {
    res.json({ path: musicDir });
  });

  // Proxy for vkeys API to avoid CORS
  app.get("/api/proxy/search", async (req, res) => {
    const { word } = req.query;
    try {
      const response = await fetch(`https://api.vkeys.cn/v2/music/tencent/search/song?word=${encodeURIComponent(word as string)}`);
      const data = await response.json();
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch from search API" });
    }
  });

  app.get("/api/proxy/lyric", async (req, res) => {
    const { id } = req.query;
    try {
      const response = await fetch(`https://api.vkeys.cn/v2/music/tencent/lyric?id=${id}`);
      const data = await response.json();
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch from lyric API" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
