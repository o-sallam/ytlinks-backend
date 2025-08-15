const express = require("express");
const cors = require("cors");
const play = require("play-dl");

const app = express();

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

// YouTube search API endpoint using play-dl
app.get("/api/youtube_search", async (req, res) => {
  const { keyword, page = 1 } = req.query;

  if (!keyword) {
    return res.status(400).json({ error: "Keyword parameter is required" });
  }

  try {
    console.log(`Searching YouTube for: ${keyword}`);

    // Use play-dl to search YouTube
    const searchResults = await play.search(keyword, {
      limit: 10,
      source: { youtube: "video" },
    });

    const videos = searchResults.slice(0, 5).map((video) => ({
      title: video.title || "",
      url: video.url || "",
      channel: video.channel?.name || "",
      views: video.views ? video.views.toString() : "",
      uploadDate: video.uploadedAt || "",
      thumbnail: video.thumbnails?.[0]?.url || "",
      duration: video.durationInSec
        ? `${Math.floor(video.durationInSec / 60)}:${(video.durationInSec % 60)
            .toString()
            .padStart(2, "0")}`
        : "",
    }));

    console.log(`Found ${videos.length} videos`);
    res.json(videos);
  } catch (error) {
    console.error("Error searching YouTube:", error);
    res.status(500).json({ error: "Failed to search YouTube videos" });
  }
});

// YouTube video details endpoint using play-dl (more reliable)
app.get("/api/video/:videoId", async (req, res) => {
  const { videoId } = req.params;

  if (!videoId) {
    return res.status(400).json({ error: "Video ID is required" });
  }

  try {
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    console.log(`Getting video info for: ${videoUrl}`);

    // Use play-dl for video info (more reliable than ytdl-core)
    const videoInfo = await play.video_info(videoUrl);
    const videoDetails = videoInfo.video_details;

    const result = {
      title: videoDetails.title || "Unknown Title",
      description: videoDetails.description || "",
      channelName: videoDetails.channel?.name || "Unknown Channel",
      embedUrl: `https://www.youtube.com/embed/${videoId}`,
      thumbnail:
        videoDetails.thumbnails?.[0]?.url ||
        `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
      duration: videoDetails.durationInSec
        ? Math.floor(videoDetails.durationInSec / 60) +
          ":" +
          String(videoDetails.durationInSec % 60).padStart(2, "0")
        : "0:00",
      views: videoDetails.views?.toString() || "0",
      uploadDate: videoDetails.uploadedAt || "Unknown",
    };

    console.log("Video details retrieved successfully:", result.title);
    res.json(result);
  } catch (error) {
    console.error("Error fetching video details:", error.message);
    console.error("Full error:", error);

    // More specific error handling
    if (
      error.message.includes("Video unavailable") ||
      error.message.includes("not found")
    ) {
      res.status(404).json({ error: "Video not found or unavailable" });
    } else if (error.message.includes("private")) {
      res.status(403).json({ error: "Video is private" });
    } else if (error.message.includes("age")) {
      res.status(403).json({ error: "Age-restricted video" });
    } else {
      res.status(500).json({
        error: "Failed to fetch video details",
        details: error.message,
      });
    }
  }
});

// Video streaming endpoint using play-dl
app.get("/api/stream/:videoId", async (req, res) => {
  const { videoId } = req.params;
  console.log("Requested videoId:", videoId);

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

  try {
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    console.log(`Streaming video: ${videoUrl}`);

    // Get stream info using play-dl
    const stream = await play.stream(videoUrl, {
      quality: 2, // 0 = lowest, 1 = medium, 2 = highest available
    });

    if (!stream || !stream.stream) {
      return res
        .status(404)
        .json({ error: "No stream available for this video" });
    }

    // Set appropriate headers
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "no-cache");

    console.log(`Streaming format: ${stream.type} quality: ${stream.quality}`);

    // Handle client disconnect
    req.on("close", () => {
      console.log("Client disconnected, destroying stream");
      if (stream.stream && typeof stream.stream.destroy === "function") {
        stream.stream.destroy();
      }
    });

    // Pipe the stream to response
    stream.stream.pipe(res);

    stream.stream.on("error", (err) => {
      console.error("Stream error:", err);
      if (!res.headersSent) {
        res
          .status(500)
          .json({ error: "Streaming failed", details: err.message });
      }
    });
  } catch (error) {
    console.error("Error streaming video:", error);
    if (!res.headersSent) {
      // More specific error messages
      if (
        error.message.includes("Video unavailable") ||
        error.message.includes("not found")
      ) {
        res.status(404).json({ error: "Video not found or unavailable" });
      } else if (error.message.includes("No stream")) {
        res.status(400).json({ error: "No suitable video format found" });
      } else {
        res
          .status(500)
          .json({ error: "Failed to stream video", details: error.message });
      }
    }
  }
});

// Get available video formats using play-dl
app.get("/api/formats/:videoId", async (req, res) => {
  const { videoId } = req.params;

  if (!videoId) {
    return res.status(400).json({ error: "Video ID is required" });
  }

  try {
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // Get video info using play-dl
    const videoInfo = await play.video_info(videoUrl);

    // Extract format information
    const formats = videoInfo.format.map((format, index) => ({
      id: index,
      quality: format.quality || "unknown",
      container: format.mimeType?.split("/")[1]?.split(";")[0] || "unknown",
      hasVideo: format.hasVideo || false,
      hasAudio: format.hasAudio || false,
      filesize: format.contentLength || "unknown",
    }));

    res.json({ formats });
  } catch (error) {
    console.error("Error getting video formats:", error);
    res
      .status(500)
      .json({ error: "Failed to get video formats", details: error.message });
  }
});

// Serve static assets in production
if (process.env.NODE_ENV === "production") {
  const path = require("path");
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
