const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

const app = express();

// Enable CORS for all origins
app.use(cors({ origin: 'https://ytlinks-backend-uzoh.vercel.app' }));

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
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    // Navigate to YouTube search page
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(keyword)}`;
    await page.goto(searchUrl, { waitUntil: 'networkidle2' });
    
    // Extract video information
    const videos = await page.evaluate(() => {
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
    
    await browser.close();
    
    res.json(videos);
  } catch (error) {
    console.error('Error scraping YouTube:', error);
    res.status(500).json({ error: 'Failed to scrape YouTube search results' });
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

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));