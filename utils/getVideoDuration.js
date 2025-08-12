const puppeteer = require('puppeteer');

// In-memory cache to avoid repeated Puppeteer launches
const durationCache = {};

async function getVideoDuration(videoId) {
  if (durationCache[videoId]) return durationCache[videoId];
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
  const page = await browser.newPage();
  await page.goto(`https://www.youtube.com/watch?v=${videoId}`, { waitUntil: 'networkidle2' });
  const duration = await page.evaluate(() => {
    return window.ytInitialPlayerResponse?.videoDetails?.lengthSeconds || null;
  });
  await browser.close();
  if (duration) durationCache[videoId] = parseInt(duration, 10);
  return duration ? parseInt(duration, 10) : null;
}

module.exports = getVideoDuration;
