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

// YouTube video details endpoint using ytdl-core
app.get("/api/video/:videoId", async (req, res) => {
  const { videoId } = req.params;

  if (!videoId) {
    return res.status(400).json({ error: "Video ID is required" });
  }

  try {
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    console.log(`Getting video info for: ${videoUrl}`);

    // Validate URL first
    if (!ytdl.validateURL(videoUrl)) {
      return res.status(400).json({ error: "Invalid YouTube URL" });
    }

    // Get video info using ytdl-core with options for better reliability
    const info = await ytdl.getInfo(videoUrl, {
      requestOptions: {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      },
    });

    const videoDetails = info.videoDetails;

    const result = {
      title: videoDetails.title || "Unknown Title",
      description:
        videoDetails.shortDescription || videoDetails.description || "",
      channelName:
        videoDetails.author?.name ||
        videoDetails.ownerChannelName ||
        "Unknown Channel",
      embedUrl: `https://www.youtube.com/embed/${videoId}`,
      thumbnail:
        videoDetails.thumbnails?.[0]?.url ||
        `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
      duration: videoDetails.lengthSeconds || "0",
      views: videoDetails.viewCount || "0",
      uploadDate:
        videoDetails.publishDate || videoDetails.uploadDate || "Unknown",
    };

    console.log("Video details retrieved successfully:", result.title);
    res.json(result);
  } catch (error) {
    console.error("Error fetching video details:", error.message);
    console.error("Full error:", error);

    // More specific error handling
    if (error.message.includes("Video unavailable")) {
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

// Video streaming endpoint using ytdl-core
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

    // Check if video is available
    if (!ytdl.validateURL(videoUrl)) {
      return res.status(400).json({ error: "Invalid YouTube URL" });
    }

    // Set appropriate headers
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "no-cache");

    // Stream options - get best quality up to 720p
    const streamOptions = {
      filter: (format) => {
        return (
          format.container === "mp4" &&
          format.hasVideo &&
          format.hasAudio &&
          format.height &&
          format.height <= 720
        );
      },
      quality: "highest",
      requestOptions: {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      },
    };

    // Create and pipe the stream
    const stream = ytdl(videoUrl, streamOptions);

    stream.on("error", (err) => {
      console.error("Stream error:", err);
      if (!res.headersSent) {
        res
          .status(500)
          .json({ error: "Streaming failed", details: err.message });
      }
    });

    stream.on("info", (info, format) => {
      console.log(
        `Streaming format: ${format.quality || format.qualityLabel} ${
          format.container
        }`
      );
    });

    stream.on("response", (response) => {
      console.log("Stream response status:", response.statusCode);
    });

    // Handle client disconnect
    req.on("close", () => {
      console.log("Client disconnected, destroying stream");
      stream.destroy();
    });

    // Pipe the stream to response
    stream.pipe(res);
  } catch (error) {
    console.error("Error streaming video:", error);
    if (!res.headersSent) {
      // More specific error messages
      if (error.message.includes("Video unavailable")) {
        res.status(404).json({ error: "Video not found or unavailable" });
      } else if (error.message.includes("No such format found")) {
        res.status(400).json({ error: "No suitable video format found" });
      } else {
        res
          .status(500)
          .json({ error: "Failed to stream video", details: error.message });
      }
    }
  }
});

// Get available video formats
app.get("/api/formats/:videoId", async (req, res) => {
  const { videoId } = req.params;

  if (!videoId) {
    return res.status(400).json({ error: "Video ID is required" });
  }

  try {
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    if (!ytdl.validateURL(videoUrl)) {
      return res.status(400).json({ error: "Invalid YouTube URL" });
    }

    const info = await ytdl.getInfo(videoUrl);
    const formats = info.formats.map((format) => ({
      itag: format.itag,
      quality: format.quality,
      qualityLabel: format.qualityLabel,
      container: format.container,
      hasVideo: format.hasVideo,
      hasAudio: format.hasAudio,
      filesize: format.contentLength,
    }));

    res.json({ formats });
  } catch (error) {
    console.error("Error getting video formats:", error);
    res.status(500).json({ error: "Failed to get video formats" });
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
