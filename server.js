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

    // Get video info using ytdl-core
    const info = await ytdl.getInfo(videoUrl);
    const videoDetails = info.videoDetails;

    const result = {
      title: videoDetails.title,
      description: videoDetails.description,
      channelName: videoDetails.author.name,
      embedUrl: `https://www.youtube.com/embed/${videoId}`,
      thumbnail: videoDetails.thumbnails?.[0]?.url,
      duration: videoDetails.lengthSeconds,
      views: videoDetails.viewCount,
      uploadDate: videoDetails.publishDate,
    };

    res.json(result);
  } catch (error) {
    console.error("Error fetching video details:", error);
    res.status(500).json({ error: "Failed to fetch video details" });
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

    // Get video info to check availability
    const info = await ytdl.getInfo(videoUrl);

    // Set appropriate headers
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Accept-Ranges", "bytes");

    // Stream options - get best quality up to 720p
    const streamOptions = {
      filter: (format) => {
        return (
          format.container === "mp4" &&
          format.hasVideo &&
          format.hasAudio &&
          format.height <= 720
        );
      },
      quality: "highest",
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
      console.log(`Streaming format: ${format.quality} ${format.container}`);
    });

    // Pipe the stream to response
    stream.pipe(res);
  } catch (error) {
    console.error("Error streaming video:", error);
    if (!res.headersSent) {
      res
        .status(500)
        .json({ error: "Failed to stream video", details: error.message });
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
