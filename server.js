const express = require("express");
const cors = require("cors");
const puppeteer = require("puppeteer");
const ytdl = require("ytdl-core");
const play = require("play-dl");

const app = express();

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const getVideoDuration = require("./utils/getVideoDuration");

// Enable CORS for all origins
const corsOptions = {
  origin: [
    "https://ytlinks-backend-production.up.railway.app",
    "http://localhost:3000",
    "https://ytlinks.vercel.app",
    "https://myblogtest.kesug.com",
  ],
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"],
};
app.use(cors(corsOptions));

// Parse JSON bodies
app.use(express.json());

// YouTube search API endpoint
app.get("/api/youtube_search", async (req, res) => {
  const { keyword, page = 1 } = req.query;

  if (!keyword) {
    return res.status(400).json({ error: "Keyword parameter is required" });
  }

  try {
    // Launch puppeteer browser
    console.log("Launching Puppeteer browser...");
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-zygote",
        "--single-process",
      ],
      executablePath:
        process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium",
    });

    console.log("New page created in Puppeteer.");
    const puppeteerPage = await browser.newPage();

    // Navigate to YouTube search page
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(
      keyword
    )}`;
    console.log(`Navigating to URL: ${searchUrl}`);
    await puppeteerPage.goto(searchUrl, { waitUntil: "networkidle2" });
    console.log("Navigation to YouTube search page completed.");

    // Extract video information
    console.log("Extracting video information from the page...");
    const videos = await puppeteerPage.evaluate(() => {
      const videoElements = Array.from(
        document.querySelectorAll("ytd-video-renderer")
      );
      return videoElements.slice(0, 5).map((videoElement) => {
        const titleElement = videoElement.querySelector("#video-title");
        const channelElement = videoElement.querySelector(
          "#channel-name #text"
        );
        const metadataElements = videoElement.querySelectorAll(
          "#metadata-line span"
        );
        const viewsElement = metadataElements[0];
        const uploadDateElement = metadataElements[1];

        return {
          title: titleElement ? titleElement.textContent.trim() : "",
          url: titleElement ? titleElement.href : "",
          channel: channelElement ? channelElement.textContent.trim() : "",
          views: viewsElement ? viewsElement.textContent.trim() : "",
          uploadDate: uploadDateElement
            ? uploadDateElement.textContent.trim()
            : "",
        };
      });
    });

    console.log("Closing Puppeteer browser...");
    await browser.close();
    console.log("Browser closed successfully.");

    res.json(videos);
  } catch (error) {
    console.error("Error scraping YouTube:", error);
    console.error("Request details:", { keyword, page });
    res.status(500).json({ error: "Failed to scrape YouTube search results" });
  }
});

// YouTube video details endpoint
app.get("/api/video/:videoId", async (req, res) => {
  const { videoId } = req.params;

  if (!videoId) {
    return res.status(400).json({ error: "Video ID is required" });
  }

  try {
    console.log("Launching Puppeteer browser for video details...");
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-zygote",
        "--single-process",
      ],
      executablePath:
        process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium",
    });

    const puppeteerPage = await browser.newPage();
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    console.log(`Navigating to video URL: ${videoUrl}`);

    await puppeteerPage.goto(videoUrl, { waitUntil: "networkidle2" });

    // Extract video details
    const videoDetails = await puppeteerPage.evaluate(() => {
      const title = document
        .querySelector("h1.ytd-video-primary-info-renderer")
        ?.textContent?.trim();
      const description = document
        .querySelector("ytd-expander#description")
        ?.textContent?.trim();
      const channelName = document
        .querySelector("ytd-channel-name yt-formatted-string.ytd-channel-name")
        ?.textContent?.trim();

      return {
        title,
        description,
        channelName,
        embedUrl: `https://www.youtube.com/embed/${
          window.location.search.split("v=")[1]
        }`,
      };
    });

    await browser.close();
    res.json(videoDetails);
  } catch (error) {
    console.error("Error fetching video details:", error);
    res.status(500).json({ error: "Failed to fetch video details" });
  }
});

// Video streaming endpoint

app.all("/api/stream/:videoId", async (req, res) => {
  // Always set CORS header for all responses (adjust origin as needed)
  res.setHeader("Access-Control-Allow-Origin", "http://localhost:3000");
  res.setHeader("Vary", "Origin");

  const { videoId } = req.params;
  const range = req.headers.range;

  // Support HEAD requests for duration header
  if (req.method === "HEAD") {
    let durationSeconds = null;
    try {
      durationSeconds = await getVideoDuration(videoId);
      if (durationSeconds) {
        res.setHeader("X-Video-Duration", durationSeconds.toString());
      }
    } catch (e) {
      console.error("Failed to get video duration from Puppeteer:", e);
    }
    return res.status(200).end();
  }

  if (
    !videoId ||
    typeof videoId !== "string" ||
    videoId.trim() === "" ||
    videoId === "undefined"
  ) {
    return res
      .status(400)
      .json({ error: "Invalid or missing videoId", details: videoId });
  }
  if (!range) {
    return res.status(416).send("Range header required");
  }

  // Get duration from Puppeteer
  let durationSeconds = null;
  try {
    durationSeconds = await getVideoDuration(videoId);
    if (durationSeconds) {
      res.setHeader("X-Video-Duration", durationSeconds.toString());
    }
  } catch (e) {
    console.error("Failed to get video duration from Puppeteer:", e);
  }

  // Prepare local file path (cache)
  const videoPath = path.resolve(__dirname, "video_cache", `${videoId}.mp4`);
  if (!fs.existsSync(path.dirname(videoPath))) {
    fs.mkdirSync(path.dirname(videoPath));
  }

  // Download video if not cached
  if (!fs.existsSync(videoPath)) {
    console.log("Downloading video with yt-dlp...");
    await new Promise((resolve, reject) => {
      const ytDlp = spawn("yt-dlp", [
        "-f",
        "bestvideo[height<=720]+bestaudio/best[height<=720]",
        "-o",
        videoPath,
        `https://www.youtube.com/watch?v=${videoId}`,
      ]);
      ytDlp.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error("yt-dlp failed"));
      });
      ytDlp.stderr.on("data", (d) => console.error("yt-dlp:", d.toString()));
    });
  }

  // Serve video with Range support
  const videoSize = fs.statSync(videoPath).size;
  const CHUNK_SIZE = 1 * 1e6;
  const parts = range.replace(/bytes=/, "").split("-");
  const start = parseInt(parts[0], 10);
  const end = parts[1]
    ? parseInt(parts[1], 10)
    : Math.min(start + CHUNK_SIZE, videoSize - 1);
  const contentLength = end - start + 1;

  res.writeHead(206, {
    "Content-Range": `bytes ${start}-${end}/${videoSize}`,
    "Accept-Ranges": "bytes",
    "Content-Length": contentLength,
    "Content-Type": "video/mp4",
    ...(durationSeconds && { "X-Video-Duration": durationSeconds.toString() }),
    "Access-Control-Allow-Origin": "http://localhost:3000",
    "Vary": "Origin"
  });

  const stream = fs.createReadStream(videoPath, { start, end });
  stream.pipe(res);
});

// Serve static assets in production
if (process.env.NODE_ENV === "production") {
  app.use(express.static("client/build"));

  app.get("*", (req, res) => {
    res.sendFile(path.resolve(__dirname, "client", "build", "index.html"));
  });
}

const PORT = process.env.PORT || 5000;

app.get("/health", (req, res) => {
  res.status(200).send({ status: "OK" });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
