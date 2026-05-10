# VECTOR — Trading Intelligence System

Private AI-powered Smart Money Concepts (SMC/ICT) trading intelligence platform.

## Stack
- **Frontend**: Next.js 14 + TypeScript
- **Database**: Supabase (PostgreSQL)
- **AI**: Claude API (Anthropic)
- **Deploy**: Vercel
- **Charts**: Canvas API with custom SMC overlays

## Features
- Live PD Array detection (OB, FVG, BISI, SIBI, IOB, IFVG, IBRK)
- CISD (Change in State of Delivery) scanner
- Draw on Liquidity (DOL) mapping — 5-question framework
- Multi-timeframe confluence scoring (0–100)
- AI analyst powered by Claude — full SMC reasoning per setup
- Setup scanner with real-time alerts
- Knowledge base — all concepts from video course
- Trade history + backtest results

## Setup
```bash
npm install
cp .env.example .env.local
# Fill in your keys
npm run dev
```

## SMC Framework
Based on ICT methodology: PD Arrays → DOL → CISD → Entry model.
All 8 episodes analyzed and encoded into the knowledge base and detection algorithms.
