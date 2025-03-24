# Ghost Userbot

A sophisticated Telegram userbot with AI integration, minimal response style, and web interface control.

## Features

- **AI-Powered Responses**: Multiple AI model support
  - Gemini AI (default)
  - OpenRouter API
  - HuggingFace
  - Together AI
  - DeepInfra

- **Minimal Ghost Persona**
  - Short, concise responses
  - Intelligent and savage when needed
  - Supports both English and Hindi
  - Minimal emoji usage

- **Web Control Interface**
  - Real-time message monitoring
  - Bot status control
  - Custom reply settings
  - System prompt customization
  - Model switching

- **Security Features**
  - Basic authentication
  - Rate limiting (5 messages/10 seconds)
  - Bot detection and filtering
  - MongoDB message history

## Setup

### Prerequisites
- Node.js
- MongoDB
- Telegram API credentials

### Environment Variables (.env)
```env
API_ID=your_telegram_api_id
API_HASH=your_telegram_api_hash
PHONE_NUMBER=your_phone_number
PORT=4000
SESSION_STRING=your_session_string
SUPER_SECRET_PASSWORD=your_admin_password
USERNAME=admin
GEMINI_API_KEY=your_gemini_key
DB_URL=your_mongodb_url
```

### Installation
```bash
npm install
npm start
```

### Available Commands
- `heyanonstart` - Activate the bot
- `heyanonstop` - Deactivate the bot

## Web Interface
Access the control panel at `http://localhost:4000`
- Login credentials:
  - Username: admin
  - Password: (SUPER_SECRET_PASSWORD from .env)

## Features
1. **Message Handling**
   - Automatic responses
   - Chat history tracking
   - User info caching

2. **AI Integration**
   - Multiple model support
   - Customizable system prompts
   - Fallback responses

3. **Rate Limiting**
   - 5 messages per 10 seconds
   - Anti-spam protection

4. **MongoDB Integration**
   - Message history storage
   - Automatic cleanup
   - Fallback to in-memory storage

## Default Response Style
- Minimal and short responses
- Example responses:
  ```
  "hello" → "hey"
  "how are you" → "good"
  "what's up" → "nm"
  ```

## System Requirements
- Node.js 14+
- MongoDB 4.4+
- 512MB RAM minimum
- Stable internet connection

## Error Handling
- Automatic reconnection to MongoDB
- API fallback system
- In-memory backup for chat history

## Security Notes
- Keep your .env file secure
- Regularly rotate API keys
- Use strong admin passwords
- Don't share your SESSION_STRING

## Contributing
Feel free to submit issues and enhancement requests.

## License
MIT License

---
Created with ❤️ by [Your Name]