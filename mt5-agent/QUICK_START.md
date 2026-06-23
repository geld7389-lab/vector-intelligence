# QUICK START — 5 Minutes to Launch

## 1. Install Python (if not installed)
Download from https://python.org → install → check "Add to PATH"

## 2. Install dependencies
```
cd mt5-agent
pip install -r requirements.txt
```

## 3. Create .env file
Copy `.env.example` to `.env` and fill in:
- Your MT5 login, password, server name
- Your Groq API key (free at console.groq.com)
- Your Telegram bot token (optional)

## 4. Launch
```
python main.py
```

## 5. Open dashboard
Go to http://localhost:8000 in your browser.

**Done.** All 10 agents start automatically.

---

## Common Issues

**"MT5 not installed"** — Install MetaTrader 5 from your broker's website first.

**"Symbol not found"** — Check your broker's exact symbol names in MT5 Market Watch. Update `config/settings.py`.

**"Connection refused"** — Make sure MT5 is open and logged in before running `python main.py`.

**"Invalid API key"** — Check your Groq key in `.env`. Get one free at console.groq.com.
