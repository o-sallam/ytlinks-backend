const express = require("express");
const cors = require("cors");
const ytdl = require("ytdl-core");
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

// Video streaming endpoint - Alternative approach using play-dl
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
    console.log(`Getting stream info for: ${videoUrl}`);

    // Get video info first
    const videoInfo = await play.video_info(videoUrl);
    console.log(`Video info retrieved: ${videoInfo.video_details.title}`);

    // Find the best available format
    let bestFormat = null;

    // Try to find MP4 format with both video and audio
    for (const format of videoInfo.format) {
      if (
        format.mimeType &&
        format.mimeType.includes("mp4") &&
        format.hasVideo &&
        format.hasAudio
      ) {
        bestFormat = format;
        break;
      }
    }

    // If no MP4 with both, try any format with both video and audio
    if (!bestFormat) {
      for (const format of videoInfo.format) {
        if (format.hasVideo && format.hasAudio) {
          bestFormat = format;
          break;
        }
      }
    }

    if (!bestFormat) {
      console.log("No suitable format found");
      return res.status(404).json({ error: "No suitable video format found" });
    }

    console.log(
      `Selected format: ${bestFormat.mimeType} - ${bestFormat.quality}`
    );

    // Set headers based on format
    const mimeType = bestFormat.mimeType || "video/mp4";
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Access-Control-Allow-Origin", "*");

    // Get the direct stream URL
    const streamUrl = bestFormat.url;
    console.log("Stream URL obtained, redirecting...");

    // Redirect to the direct stream URL
    res.redirect(302, streamUrl);
  } catch (error) {
    console.error("Error streaming video:", error);
    console.error("Error details:", error.stack);

    if (!res.headersSent) {
      if (
        error.message.includes("Video unavailable") ||
        error.message.includes("not found")
      ) {
        res.status(404).json({ error: "Video not found or unavailable" });
      } else if (error.message.includes("private")) {
        res.status(403).json({ error: "Video is private" });
      } else {
        res
          .status(500)
          .json({ error: "Failed to stream video", details: error.message });
      }
    }
  }
});

// Get direct stream URL
app.get("/api/stream-url/:videoId", async (req, res) => {
  const { videoId } = req.params;

  if (!videoId) {
    return res.status(400).json({ error: "Video ID is required" });
  }

  try {
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    console.log(`Getting stream URL for: ${videoUrl}`);

    // Get video info using play-dl
    const videoInfo = await play.video_info(videoUrl);

    // Find the best available format
    let bestFormat = null;

    // Try to find MP4 format with both video and audio, preferring higher quality
    const mp4Formats = videoInfo.format.filter(
      (f) =>
        f.mimeType && f.mimeType.includes("mp4") && f.hasVideo && f.hasAudio
    );

    if (mp4Formats.length > 0) {
      // Sort by quality and pick the best one
      bestFormat = mp4Formats.sort((a, b) => {
        const qualityA = parseInt(a.quality?.replace("p", "") || "0");
        const qualityB = parseInt(b.quality?.replace("p", "") || "0");
        return qualityB - qualityA; // Higher quality first
      })[0];
    } else {
      // Fallback: any format with both video and audio
      bestFormat = videoInfo.format.find((f) => f.hasVideo && f.hasAudio);
    }

    if (!bestFormat || !bestFormat.url) {
      return res.status(404).json({ error: "No suitable video format found" });
    }

    console.log(
      `Best format found: ${bestFormat.mimeType} - ${bestFormat.quality}`
    );

    res.json({
      streamUrl: bestFormat.url,
      quality: bestFormat.quality,
      mimeType: bestFormat.mimeType,
      hasVideo: bestFormat.hasVideo,
      hasAudio: bestFormat.hasAudio,
    });
  } catch (error) {
    console.error("Error getting stream URL:", error);
    res
      .status(500)
      .json({ error: "Failed to get stream URL", details: error.message });
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
      url: format.url ? "available" : "unavailable",
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
