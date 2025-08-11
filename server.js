const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const ytdl = require('ytdl-core');

const app = express();

// Enable CORS for all origins
const corsOptions = {
  origin: ["https://ytlinks-backend-production.up.railway.app", "http://localhost:3000"],
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"],
};
app.use(cors(corsOptions));

// Parse JSON bodies
app.use(express.json());

// YouTube search API endpoint
app.get('/api/youtube_search', async (req, res) => {
  const { keyword, page = 1 } = req.query;
  
  if (!keyword) {
    return res.status(400).json({ error: 'Keyword parameter is required' });
  }
  
  try {
    // Launch puppeteer browser
    console.log('Launching Puppeteer browser...');
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
        '--single-process'
      ],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium'
    });
    
    console.log('New page created in Puppeteer.');
    const puppeteerPage = await browser.newPage();
    
    // Navigate to YouTube search page
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(keyword)}`;
    console.log(`Navigating to URL: ${searchUrl}`);
    await puppeteerPage.goto(searchUrl, { waitUntil: 'networkidle2' });
    console.log('Navigation to YouTube search page completed.');
    
    // Extract video information
    console.log('Extracting video information from the page...');
    const videos = await puppeteerPage.evaluate(() => {
      const videoElements = Array.from(document.querySelectorAll('ytd-video-renderer'));
      return videoElements.slice(0, 5).map(videoElement => {
        const titleElement = videoElement.querySelector('#video-title');
        const channelElement = videoElement.querySelector('#channel-name #text');
        const metadataElements = videoElement.querySelectorAll('#metadata-line span');
        const viewsElement = metadataElements[0];
        const uploadDateElement = metadataElements[1];
        
        return {
          title: titleElement ? titleElement.textContent.trim() : '',
          url: titleElement ? titleElement.href : '',
          channel: channelElement ? channelElement.textContent.trim() : '',
          views: viewsElement ? viewsElement.textContent.trim() : '',
          uploadDate: uploadDateElement ? uploadDateElement.textContent.trim() : ''
        };
      });
    });
    
    console.log('Closing Puppeteer browser...');
    await browser.close();
    console.log('Browser closed successfully.');
    
    res.json(videos);
  } catch (error) {
    console.error('Error scraping YouTube:', error);
    console.error('Request details:', { keyword, page });
    res.status(500).json({ error: 'Failed to scrape YouTube search results' });
  }
});

// YouTube video details endpoint
app.get('/api/video/:videoId', async (req, res) => {
  const { videoId } = req.params;
  
  if (!videoId) {
    return res.status(400).json({ error: 'Video ID is required' });
  }
  
  try {
    console.log('Launching Puppeteer browser for video details...');
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
        '--single-process'
      ],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium'
    });
    
    const puppeteerPage = await browser.newPage();
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    console.log(`Navigating to video URL: ${videoUrl}`);
    
    await puppeteerPage.goto(videoUrl, { waitUntil: 'networkidle2' });
    
    // Extract video details
    const videoDetails = await puppeteerPage.evaluate(() => {
      const title = document.querySelector('h1.ytd-video-primary-info-renderer')?.textContent?.trim();
      const description = document.querySelector('ytd-expander#description')?.textContent?.trim();
      const channelName = document.querySelector('ytd-channel-name yt-formatted-string.ytd-channel-name')?.textContent?.trim();
      
      return {
        title,
        description,
        channelName,
        embedUrl: `https://www.youtube.com/embed/${window.location.search.split('v=')[1]}`
      };
    });
    
    await browser.close();
    res.json(videoDetails);
    
  } catch (error) {
    console.error('Error fetching video details:', error);
    res.status(500).json({ error: 'Failed to fetch video details' });
  }
});

// Video streaming endpoint
app.get('/api/stream/:videoId', async (req, res) => {
  const { videoId } = req.params;
  const range = req.headers.range;

  if (!range) {
    return res.status(400).send('Requires Range header');
  }

  try {
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const info = await ytdl.getInfo(videoUrl);
    let format = ytdl.chooseFormat(info.formats, { filter: 'audioandvideo', quality: 'highest' });
    let videoSize = parseInt(format.contentLength || '0', 10);

    // fallback: جرّب فورمات أخرى لو الحجم غير متوفر أو حدث خطأ
    if (!videoSize || !format.url) {
      const fallbackFormat = info.formats.find(f => f.contentLength && f.mimeType && f.mimeType.includes('mp4') && f.qualityLabel && f.hasAudio && f.hasVideo);
      if (fallbackFormat) {
        format = fallbackFormat;
        videoSize = parseInt(format.contentLength, 10);
        console.warn('Using fallback format:', format.qualityLabel, format.mimeType);
      }
    }

    if (!videoSize) {
      return res.status(500).json({ error: 'Could not determine video size.', details: { format } });
    }

    const CHUNK_SIZE = 10 ** 6; // 1MB chunks
    const start = Number(range.replace(/\D/g, ""));
    const end = Math.min(start + CHUNK_SIZE - 1, videoSize - 1);
    const contentLength = end - start + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${videoSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': contentLength,
      'Content-Type': 'video/mp4',
    });

    // تمرير الهيدرز بشكل صريح
    const stream = ytdl(videoUrl, {
      format,
      range: { start, end },
      requestOptions: {
        headers: {
          'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
          'Accept': req.headers['accept'] || '*/*',
          'Referer': 'https://www.youtube.com/'
        }
      }
    });

    stream.on('error', err => {
      if (err && err.message && err.message.includes('410')) {
        console.error('410 error with format:', format.qualityLabel, format.url);
      } else {
        console.error('Streaming error:', err);
      }
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to stream video', details: err.message, format });
      }
    });
    stream.pipe(res);

  } catch (error) {
    console.error('Streaming error:', error);
    res.status(500).json({ error: 'Failed to stream video', details: error.message });
  }
});

// Serve static assets in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static('client/build'));
  
  app.get('*', (req, res) => {
    res.sendFile(path.resolve(__dirname, 'client', 'build', 'index.html'));
  });
}

const PORT = process.env.PORT || 5000;

app.get('/health', (req, res) => {
  res.status(200).send({ status: 'OK' });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));