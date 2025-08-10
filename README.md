# YouTube Links Scraper

A full-stack application that scrapes YouTube search results and displays them in a clean, dark-themed UI.

## Features

- Search YouTube videos by keyword
- Display search results in a clean, card-based UI
- View detailed information about each video
- Dark theme throughout the application

## Tech Stack

### Backend
- Node.js
- Express
- Puppeteer (for scraping YouTube)

### Frontend
- React
- React Router
- Axios

## Installation

1. Clone the repository
2. Install dependencies for both backend and frontend:

```bash
# Install backend dependencies
npm install

# Install frontend dependencies
cd client
npm install
cd ..
```

## Running the Application

### Development Mode

To run both the backend and frontend in development mode:

```bash
npm run dev
```

This will start:
- Backend server on http://localhost:5000
- Frontend development server on http://localhost:3000

### Backend Only

```bash
npm run server
```

### Frontend Only

```bash
npm run client
```

## API Endpoints

### GET /api/youtube_search

Fetches YouTube search results for a given keyword.

**Parameters:**
- `keyword` (string, required): The search query
- `page` (integer, optional, default 1): Pagination page number

**Response:**
An array of video objects, each containing:
- `title` (string): Video title
- `url` (string): Full YouTube URL to the video
- `channel` (string): Channel name
- `views` (string): Views count (as text)
- `uploadDate` (string): Upload date text

## Notes

- The application uses Puppeteer to scrape YouTube search results, which may be affected by changes to YouTube's UI.
- For production deployment, additional configuration may be required.